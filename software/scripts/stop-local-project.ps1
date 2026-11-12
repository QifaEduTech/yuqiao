[CmdletBinding(SupportsShouldProcess=$true)]
param()
$ErrorActionPreference='Stop'

function Test-YuqiaoCommandPath($ProcessInfo,[string]$Path) {
  if (-not $ProcessInfo.CommandLine) { return $false }
  $command=$ProcessInfo.CommandLine.Replace('/','\')
  $pattern='(?i)(?:^|[\s"])'+[regex]::Escape($Path.Replace('/','\'))+'(?=$|[\s"])'
  return [regex]::IsMatch($command,$pattern)
}
function Get-YuqiaoStopPlan([string]$Root,[object[]]$Processes,[object[]]$Connections) {
  $byId=@{};foreach($p in $Processes){$byId[[int]$p.ProcessId]=$p}
  $expected=@{5173=(Join-Path $Root 'node_modules/vite/bin/vite.js');5174=(Join-Path $Root 'server/index.mjs')}
  $selected=@{};$front=@();$back=@()
  # Check both ports before stopping anything. A port number alone never establishes ownership.
  foreach($connection in $Connections | Where-Object {$_.LocalPort -in @(5173,5174)}) {
    $owner=[int]$connection.OwningProcess;$p=$byId[$owner]
    if (-not $p -or $p.Name -ne 'node.exe' -or -not (Test-YuqiaoCommandPath $p $expected[[int]$connection.LocalPort])) {
      throw "Port $($connection.LocalPort) is owned by another or unverifiable process. No process stopped."
    }
    $selected[$owner]=$p
    if($connection.LocalPort -eq 5173){$front+=$owner}else{$back+=$owner}
    $parent=$byId[[int]$p.ParentProcessId]
    if($parent -and $parent.Name -eq 'node.exe' -and $parent.CreationDate -le $p.CreationDate -and (Test-YuqiaoCommandPath $parent (Join-Path $Root 'scripts/dev-stack.mjs'))){$selected[[int]$parent.ProcessId]=$parent}
  }
  # Also recover this project's orphaned web/API workers when no port is listening.
  foreach($p in $Processes){
    if($p.Name -eq 'node.exe' -and ((Test-YuqiaoCommandPath $p $expected[5173]) -or (Test-YuqiaoCommandPath $p $expected[5174]) -or (Test-YuqiaoCommandPath $p (Join-Path $Root 'scripts/dev-stack.mjs')))){
      # Test runners use other ports and are deliberately outside this shutdown scope.
      $cursor=$p;$otherInstance=$false
      for($level=0;$level -lt 4 -and $cursor;$level++){
        if($cursor.CommandLine -match '--port[ =]+(\d+)\b' -and [int]$Matches[1] -ne 5173){$otherInstance=$true;break}
        $ancestor=$byId[[int]$cursor.ParentProcessId]
        if($ancestor -and $ancestor.CreationDate -gt $cursor.CreationDate){break}
        $cursor=$ancestor
      }
      if($otherInstance){continue}
      $hasOtherListener=@($Connections | Where-Object {$_.OwningProcess -eq $p.ProcessId -and $_.LocalPort -notin @(5173,5174)}).Count -gt 0
      if(-not $hasOtherListener){$selected[[int]$p.ProcessId]=$p}
    }
  }
  # Descendants inherit ownership only while the parent identity/creation ordering matches.
  $added=$true
  while($added){
    $added=$false
    foreach($p in $Processes){
      $parent=$selected[[int]$p.ParentProcessId]
      if(-not $selected.ContainsKey([int]$p.ProcessId) -and $parent -and $p.CreationDate -ge $parent.CreationDate -and $p.Name -in @('node.exe','python.exe','pythonw.exe','esbuild.exe','powershell.exe','pwsh.exe')){
        $selected[[int]$p.ProcessId]=$p;$added=$true
      }
    }
  }
  return @{Processes=@($selected.Values);Frontend=@($front | Select-Object -Unique);Backend=@($back | Select-Object -Unique)}
}
function Test-Port([int]$Port) { return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0 }
function Get-NginxMarker([string]$Root) {
  $marker=Join-Path $Root '.runtime-logs/nginx-runtime.json'
  if (-not (Test-Path -LiteralPath $marker)) { return $null }
  try { return Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { return $null }
}
function Stop-ProjectCloudflared([string]$Root,[switch]$WhatIf) {
  $marker=Join-Path $Root '.runtime-logs/cloudflared.json'
  if (-not (Test-Path -LiteralPath $marker)) { return $false }
  try { $info=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { return $false }
  if (-not $info.pid) { return $false }
  $processInfo=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$info.pid)" -ErrorAction SilentlyContinue
  if (-not $processInfo) { return $false }
  if ($processInfo.Name -ne 'cloudflared.exe' -or -not $processInfo.CommandLine -or $processInfo.CommandLine -notmatch 'tunnel') { throw 'cloudflared marker does not match the running process; no process stopped.' }
  if ($WhatIf) { Write-Output ('Would stop cloudflared PID '+$info.pid+' ('+$info.url+')'); return $true }
  Stop-Process -Id ([int]$info.pid) -ErrorAction Stop
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  return $true
}
function Stop-ProjectNginx([string]$Root,[switch]$WhatIf) {
  $info=Get-NginxMarker $Root
  if (-not $info) {
    if (Test-Port 8080) { throw 'Port 8080 is occupied but no project Nginx runtime marker was found. No process stopped.' }
    return $false
  }
  if ($WhatIf) { Write-Output ('Would stop Nginx runtime: '+$info.runtime); return $true }
  $exe=Join-Path $info.runtime 'nginx.exe'
  if (Test-Path -LiteralPath $exe) {
    $previous=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try { & $exe -p $info.runtime -c 'conf/yuqiao.conf' -s quit 2>&1 | Out-Null } catch { }
    finally { $ErrorActionPreference=$previous }
  }
  for ($i=0;$i -lt 20;$i++) {
    if (-not (Test-Port 8080) -and -not (Test-Port 8443)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  $connection=@(Get-NetTCPConnection -State Listen -LocalPort 8080,8443 -ErrorAction SilentlyContinue) | Select-Object -First 1
  if (-not $connection) { return $true }
  $owner=[int]$connection.OwningProcess
  $processInfo=Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction Stop
  if ($processInfo.Name -ne 'nginx.exe' -or -not $processInfo.CommandLine -or -not $processInfo.CommandLine.Contains($info.runtime) -or -not $processInfo.CommandLine.Contains('yuqiao.conf')) {
    throw 'Port 8080 is owned by another or unverifiable process. No unrelated process stopped.'
  }
  Stop-Process -Id $owner -ErrorAction Stop
  for ($i=0;$i -lt 20;$i++) {
    if (-not (Test-Port 8080) -and -not (Test-Port 8443)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  throw 'Nginx ports 8080/8443 are still occupied after a graceful stop.'
}

# Dot sourcing exposes the planner for synthetic tests without stopping services.
if($MyInvocation.InvocationName -eq '.'){return}
try {
  $projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  $connections=@(Get-NetTCPConnection -State Listen -ErrorAction Stop)
  # Validate Node/Vite ownership before stopping anything.
  $plan=Get-YuqiaoStopPlan $projectRoot $processes $connections
  if($WhatIfPreference){
    $null=Stop-ProjectCloudflared $projectRoot -WhatIf
    $null=Stop-ProjectNginx $projectRoot -WhatIf
    foreach($p in $plan.Processes){$null=$PSCmdlet.ShouldProcess("$($p.Name) PID $($p.ProcessId)",'Stop this project process')}
    Write-Output 'Preview only. MySQL, independent Ollama, browsers and other projects are not targeted.';exit 0
  }
  $cloudflaredStopped=Stop-ProjectCloudflared $projectRoot
  $nginxStopped=Stop-ProjectNginx $projectRoot
  if(-not $plan.Processes.Count){
    if($cloudflaredStopped -or $nginxStopped){Write-Output 'Yuqiao public tunnel/Nginx stopped. MySQL and independent Ollama are unchanged.';exit 0}
    Write-Output 'Yuqiao Web/API is already stopped. MySQL and independent Ollama are unchanged.';exit 0
  }
  $approved=@{}
  foreach($p in $plan.Processes){if($PSCmdlet.ShouldProcess("$($p.Name) PID $($p.ProcessId)",'Stop this project process')){$approved[[int]$p.ProcessId]=$p}}
  function Stop-Verified($Original) {
    if(-not $Original){return}
    $fresh=Get-CimInstance Win32_Process -Filter "ProcessId=$($Original.ProcessId)" -ErrorAction Stop
    if(-not $fresh){return}
    if($fresh.CreationDate -ne $Original.CreationDate -or $fresh.Name -ne $Original.Name -or $fresh.CommandLine -ne $Original.CommandLine){throw "Process $($Original.ProcessId) changed identity; refused to stop it."}
    try { Stop-Process -Id $fresh.ProcessId -ErrorAction Stop }
    catch { if(Get-Process -Id $fresh.ProcessId -ErrorAction SilentlyContinue){throw} }
  }
  # Closing Vite lets the existing supervisor request normal API shutdown over IPC.
  foreach($owner in $plan.Frontend){Stop-Verified $approved[$owner]}
  if($plan.Frontend.Count){
    for($i=0;$i -lt 20;$i++){
      $live=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -in @(5173,5174,8080,8443)})
      if(-not $live.Count){break};Start-Sleep -Milliseconds 250
    }
  }
  # Clean up only surviving identities from the verified snapshot, newest children first.
  foreach($p in ($approved.Values | Sort-Object CreationDate -Descending)){Stop-Verified $p}
  for($i=0;$i -lt 20;$i++){
    $remaining=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -in @(5173,5174,8080,8443)})
    if(-not $remaining.Count){Write-Output 'Yuqiao cloudflared/Nginx, Web/API and owned runtime workers stopped. MySQL and independent Ollama are unchanged.';exit 0}
    Start-Sleep -Milliseconds 250
  }
  throw 'Project ports remain occupied. No unrelated process will be stopped.'
} catch { Write-Error $_;exit 1 }
