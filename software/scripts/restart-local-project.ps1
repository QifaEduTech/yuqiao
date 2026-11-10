$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $projectRoot 'server/index.mjs'
$owners = @(Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($owner in $owners) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $owner"
  if ($processInfo.Name -ne 'node.exe' -or -not $processInfo.CommandLine.Replace('/','\').Contains($backendPath.Replace('/','\'))) { throw 'Port 5174 is not owned by this project; refusing to stop it.' }
  Stop-Process -Id $owner
}
for ($attempt=0; $attempt -lt 30; $attempt++) {
  if (@(Get-NetTCPConnection -State Listen -LocalPort 5173,5174 -ErrorAction SilentlyContinue).Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
}
if (@(Get-NetTCPConnection -State Listen -LocalPort 5173,5174 -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Project ports are still occupied; no duplicate process started.' }
$nodeExecutable = (Get-Command node).Source
$serviceProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('scripts/run-local.mjs','dev','--port','5173','--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.runtime-logs/local-service.stdout.log') -RedirectStandardError (Join-Path $projectRoot '.runtime-logs/local-service.stderr.log') -PassThru
Write-Output "Started unified project service: $($serviceProcess.Id)"
