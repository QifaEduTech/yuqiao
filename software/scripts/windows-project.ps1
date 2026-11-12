param(
  [ValidateSet('Check','Install','Start')][string]$Mode='Check',
  [switch]$InstallSoftware,
  [switch]$WithJdk,
  [switch]$WithTraining,
  [switch]$Dev,
  [switch]$Http,
  [switch]$Https,
  [switch]$Public,
  [switch]$QuickTunnel,
  [string]$PublicDomain=''
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$script:httpPort=8080
$script:httpsPort=8443
function Invoke-Checked([string]$Program,[string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Program. See docs/Windows-migration.md" }
}
function Refresh-ToolPath {
  $env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[Environment]::GetEnvironmentVariable('PATH','User')+';'+$env:PATH
}
function Install-Package([string]$Id,[string]$Version='') {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Microsoft App Installer (winget), then retry.' }
  $arguments=@('install','--exact','--id',$Id,'--source','winget','--accept-package-agreements','--accept-source-agreements')
  if ($Version) { $arguments+=@('--version',$Version) }
  Invoke-Checked 'winget' $arguments
  Refresh-ToolPath
}
function Test-Port([int]$Port) { return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0 }
function Test-AsciiPath([string]$Value) { return $Value -notmatch '[^\x00-\x7F]' }
function Get-WorkspaceHash {
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath((Join-Path $projectRoot 'web/public')))))).Replace('-','').ToLower().Substring(0,16) }
  finally { $hasher.Dispose() }
}
function Get-Health([string]$Url) {
  try { return Invoke-RestMethod $Url -TimeoutSec 2 } catch { return $null }
}
function Get-LanIp {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown'
  } | Select-Object -First 1 -ExpandProperty IPAddress)
}
function Resolve-NginxRuntime {
  param([switch]$HttpsMode,[switch]$LanHttp,[string]$Domain='')
  $webDist=Join-Path $projectRoot 'web/dist'
  if (-not (Test-Path -LiteralPath (Join-Path $webDist 'index.html'))) {
    Write-Output 'web/dist is missing; building once before starting Nginx.'
    Invoke-Checked 'npm.cmd' @('run','build')
  }
  $nginxExe=$env:NGINX_EXE
  if (-not $nginxExe -or -not (Test-Path -LiteralPath $nginxExe)) { $nginxExe=Join-Path $projectRoot 'tools/nginx/nginx.exe' }
  if (-not (Test-Path -LiteralPath $nginxExe)) { $nginxExe=(& (Join-Path $PSScriptRoot 'install-nginx.ps1') | Select-Object -Last 1) }
  if (-not $nginxExe -or -not (Test-Path -LiteralPath $nginxExe)) { throw 'Nginx was not found. Download it from https://nginx.org/en/download.html and extract to tools\nginx, or set NGINX_EXE.' }
  $runtime=$env:YUQIAO_NGINX_RUNTIME
  if (-not $runtime) { $runtime=Join-Path $env:LOCALAPPDATA 'Yuqiao\nginx-runtime' }
  if (-not (Test-AsciiPath $runtime)) { $runtime='C:\yuqiao-runtime' }
  if (-not (Test-AsciiPath $runtime)) { throw 'Nginx runtime path must be ASCII. Set YUQIAO_NGINX_RUNTIME to an ASCII path such as C:\yuqiao-runtime.' }
  New-Item -ItemType Directory -Force -Path $runtime,(Join-Path $runtime 'conf'),(Join-Path $runtime 'logs'),(Join-Path $runtime 'temp') | Out-Null
  $runtimeExe=Join-Path $runtime 'nginx.exe'
  if ([IO.Path]::GetFullPath($nginxExe) -ne [IO.Path]::GetFullPath($runtimeExe)) { Copy-Item -LiteralPath $nginxExe -Destination $runtimeExe -Force }
  $webLink=Join-Path $runtime 'web'
  if (Test-Path -LiteralPath $webLink) {
    $item=Get-Item -LiteralPath $webLink -Force
    if ($item.LinkType -ne 'Junction') { throw "Nginx runtime web path exists but is not a junction: $webLink. Remove it or set YUQIAO_NGINX_RUNTIME to a clean ASCII path." }
  } else {
    & cmd.exe /c mklink /J $webLink $webDist | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $webLink)) { throw "Could not create junction $webLink -> $webDist" }
  }
  $nginxArgs=@('scripts/prepare-nginx.mjs','--runtime',$runtime,'--http-port',[string]$script:httpPort,'--https-port',[string]$script:httpsPort,'--api-port','5174')
  if ($HttpsMode) {
    $lanIp=Get-LanIp
    if (-not $lanIp) { throw 'No LAN IPv4 address found. Connect to Wi-Fi/Ethernet and retry.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'create-local-cert.ps1') -LanIp $lanIp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Local HTTPS certificate creation failed.' }
    $cert=Join-Path $runtime 'certs/yuqiao-server.crt'
    $key=Join-Path $runtime 'certs/yuqiao-server.key'
    if (-not (Test-Path -LiteralPath $cert) -or -not (Test-Path -LiteralPath $key)) { throw 'Local HTTPS certificate files are missing.' }
    $nginxArgs+=@('--https','--lan-ip',$lanIp,'--cert',$cert,'--key',$key)
  } elseif ($LanHttp) {
    $lanIp=Get-LanIp
    if (-not $lanIp) { throw 'No LAN IPv4 address found. Connect to Wi-Fi/Ethernet and retry.' }
    $nginxArgs+=@('--lan-ip',$lanIp)
  } elseif ($Domain) {
    $nginxArgs+=@('--domain',$Domain)
  }
  Invoke-Checked 'node' $nginxArgs
  $envFile=Join-Path (Join-Path $runtime 'conf') 'env.json'
  $nginxEnv=Get-Content -LiteralPath $envFile -Raw | ConvertFrom-Json
  return @{ Runtime=$runtime; Exe=$runtimeExe; Env=$nginxEnv; Config=(Join-Path (Join-Path $runtime 'conf') 'yuqiao.conf') }
}
function Resolve-Cloudflared {
  $cf=$env:CLOUDFLARED_EXE
  if (-not $cf -or -not (Test-Path -LiteralPath $cf)) { $cf=Join-Path $projectRoot 'tools/cloudflared/cloudflared.exe' }
  if (-not (Test-Path -LiteralPath $cf)) { $cf=(& (Join-Path $PSScriptRoot 'install-cloudflared.ps1') | Select-Object -Last 1) }
  if (-not $cf -or -not (Test-Path -LiteralPath $cf)) { throw 'cloudflared was not found. Set CLOUDFLARED_EXE or retry the installer.' }
  return $cf
}
function Start-QuickTunnel {
  $cf=Resolve-Cloudflared
  $log=Join-Path $projectRoot '.runtime-logs/cloudflared.log'
  $out=Join-Path $projectRoot '.runtime-logs/cloudflared.stdout.log'
  $err=Join-Path $projectRoot '.runtime-logs/cloudflared.stderr.log'
  Remove-Item -LiteralPath $log,$out,$err -Force -ErrorAction SilentlyContinue
  $process=Start-Process -FilePath $cf -ArgumentList @('tunnel','--url','http://127.0.0.1:8080','--no-autoupdate','--logfile',$log,'--loglevel','info') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $domain=$null
  for ($i=0;$i -lt 120;$i++) {
    if ($process.HasExited) { throw 'cloudflared exited during quick-tunnel startup; inspect .runtime-logs/cloudflared.stderr.log.' }
    $text=''
    foreach ($path in @($log,$out,$err)) { if (Test-Path -LiteralPath $path) { $text+=(Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue) } }
    if ($text -match 'https://([a-z0-9-]+\.trycloudflare\.com)') { $domain=$Matches[1]; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $domain) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'cloudflared did not return a quick-tunnel URL; inspect .runtime-logs/cloudflared.stderr.log.'
  }
  @{ pid=$process.Id; url=('https://'+$domain); mode='quick'; log=$log } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.runtime-logs/cloudflared.json') -Encoding UTF8
  return ('https://'+$domain)
}
function Start-NamedTunnel([string]$Domain) {
  if (-not $env:CLOUDFLARE_TUNNEL_TOKEN) { throw 'Set CLOUDFLARE_TUNNEL_TOKEN for a named Cloudflare Tunnel.' }
  if (-not $Domain) { throw 'Use -PublicDomain with a named Cloudflare Tunnel.' }
  $cf=Resolve-Cloudflared
  $log=Join-Path $projectRoot '.runtime-logs/cloudflared.log'
  $out=Join-Path $projectRoot '.runtime-logs/cloudflared.stdout.log'
  $err=Join-Path $projectRoot '.runtime-logs/cloudflared.stderr.log'
  Remove-Item -LiteralPath $log,$out,$err -Force -ErrorAction SilentlyContinue
  $env:TUNNEL_TOKEN=$env:CLOUDFLARE_TUNNEL_TOKEN
  $process=Start-Process -FilePath $cf -ArgumentList @('tunnel','run') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Start-Sleep -Seconds 2
  if ($process.HasExited) { throw 'cloudflared named tunnel exited; inspect .runtime-logs/cloudflared.stderr.log.' }
  @{ pid=$process.Id; url=('https://'+$Domain); mode='named'; log=$log } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.runtime-logs/cloudflared.json') -Encoding UTF8
  return ('https://'+$Domain)
}
function Start-DevStack {
  if ((Test-Port 5173) -or (Test-Port 5174)) { throw 'Web ports occupied; refusing duplicate startup or stopping another project.' }
  $node=(Get-Command node).Source
  $process=Start-Process -FilePath $node -ArgumentList @('scripts/run-local.mjs','dev','--port','5173','--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.runtime-logs/local-service.stdout.log') -RedirectStandardError (Join-Path $projectRoot '.runtime-logs/local-service.stderr.log') -PassThru
  for ($i=0;$i -lt 90;$i++) {
    if ($process -and $process.HasExited) { throw 'Project service exited during startup; inspect .runtime-logs/local-service.stderr.log.' }
    $health=Get-Health 'http://127.0.0.1:5173/api/health'
    if ($health -and $health.workspace -eq $script:expected -and $health.database -eq 'mysql') { Write-Output 'Ready: http://127.0.0.1:5173/ -- dev mode (Vite).'; return }
    Start-Sleep -Milliseconds 500
  }
  throw 'Web readiness failed; inspect .runtime-logs/local-service.stderr.log.'
}
function Start-NginxStack {
  if ($script:Public -and $script:Https) { throw 'Use -Https or -Public, not both.' }
  if ($script:Http -and $script:Https) { throw 'Use -Http or -Https, not both.' }
  $publicUrl=$null
  $domain=$script:PublicDomain
  if ($script:Public) {
    if ($script:QuickTunnel) { $publicUrl=Start-QuickTunnel; $domain=([uri]$publicUrl).Host }
    elseif (-not $domain) { throw 'Public mode needs -PublicDomain plus CLOUDFLARE_TUNNEL_TOKEN, or -QuickTunnel.' }
  }
  $httpsMode=[bool]$script:Https
  if ($script:Public) { $nginx=Resolve-NginxRuntime -Domain $domain }
  elseif ($httpsMode) { $nginx=Resolve-NginxRuntime -HttpsMode }
  else { $nginx=Resolve-NginxRuntime -LanHttp }
  $expectedOrigin=if($script:Public){'https://'+$domain}elseif($httpsMode){'https://127.0.0.1:'+$script:httpsPort}else{'http://127.0.0.1:'+$script:httpPort}
  $apiPort=[int]$nginx.Env.apiPort
  $apiHealth=Get-Health ('http://127.0.0.1:'+$apiPort+'/api/health')
  $apiReady=($apiHealth -and $apiHealth.service -eq 'yuqiao' -and $apiHealth.database -eq 'mysql' -and $apiHealth.workspace -eq $script:expected -and @($apiHealth.origins) -contains $expectedOrigin)
  if (-not $apiReady) {
    if (Test-Port $apiPort) { throw "API port $apiPort is occupied by a service with a different origin set. Run Stop-Yuqiao.cmd first, then start again." }
    $node=(Get-Command node).Source
    $env:API_PORT=[string]$apiPort
    $env:APP_ORIGINS=$nginx.Env.appOrigins
    $env:COOKIE_SECURE=if($script:Public -or $httpsMode){'true'}else{'false'}
    $apiScript=Join-Path $projectRoot 'server/index.mjs'
    $apiProcess=Start-Process -FilePath $node -ArgumentList @($apiScript) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.runtime-logs/nginx-api.stdout.log') -RedirectStandardError (Join-Path $projectRoot '.runtime-logs/nginx-api.stderr.log') -PassThru
    $apiReady=$false
    for ($i=0;$i -lt 90;$i++) {
      if ($apiProcess -and $apiProcess.HasExited) { throw 'Node API exited during startup; inspect .runtime-logs/nginx-api.stderr.log.' }
      $apiHealth=Get-Health ('http://127.0.0.1:'+$apiPort+'/api/health')
      if ($apiHealth -and $apiHealth.workspace -eq $script:expected -and $apiHealth.database -eq 'mysql' -and @($apiHealth.origins) -contains $expectedOrigin) { $apiReady=$true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $apiReady) { throw 'Node API readiness failed; inspect .runtime-logs/nginx-api.stderr.log.' }
  }
  if (Test-Port $script:httpPort) {
    if ($httpsMode -or $script:Public) { throw "Port $($script:httpPort) is already in use by an earlier Nginx stack. Run Stop-Yuqiao.cmd, then start again." }
    $proxyHealth=Get-Health ('http://127.0.0.1:'+$script:httpPort+'/api/health')
    if ($proxyHealth -and $proxyHealth.service -eq 'yuqiao' -and $proxyHealth.workspace -eq $script:expected) { Write-Output ('Ready: http://127.0.0.1:'+$script:httpPort+'/ -- Nginx already running.'); return }
    throw "Port $($script:httpPort) is occupied by another service; refusing to start another Nginx."
  }
  if ($httpsMode -and (Test-Port $script:httpsPort)) { throw "HTTPS port $($script:httpsPort) is occupied; refusing to start another Nginx." }
  if (-not $httpsMode -and -not $script:Public -and (Test-Port $script:httpsPort)) { throw "Port $($script:httpsPort) is occupied by another service. Run Stop-Yuqiao.cmd first, or use -Https only after freeing it." }
  $nginxProcess=Start-Process -FilePath $nginx.Exe -ArgumentList @('-p',$nginx.Runtime,'-c','conf/yuqiao.conf') -WorkingDirectory $nginx.Runtime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $nginx.Runtime 'logs/nginx.stdout.log') -RedirectStandardError (Join-Path $nginx.Runtime 'logs/nginx.stderr.log') -PassThru
  for ($i=0;$i -lt 60;$i++) {
    if ($nginxProcess -and $nginxProcess.HasExited) { throw ('Nginx exited during startup; inspect '+$nginx.Env.errorLog) }
    $proxyHealth=Get-Health ('http://127.0.0.1:'+$script:httpPort+'/api/health')
    if ($proxyHealth -and $proxyHealth.service -eq 'yuqiao' -and $proxyHealth.workspace -eq $script:expected) {
      if ($script:Public) {
        if (-not $publicUrl) { $publicUrl=Start-NamedTunnel $domain }
        Write-Output ('Ready: '+$publicUrl+'/ -- public tunnel; sign in and fill your own API Key.')
        Start-Process $publicUrl
        return
      }
      if ($httpsMode) {
        $lanIp=$nginx.Env.lanIp
        Write-Output ('Ready: https://127.0.0.1:'+$script:httpsPort+'/ -- local HTTPS; LAN: https://'+$lanIp+':'+$script:httpsPort+'/ ; HTTP '+$script:httpPort+' redirects.')
        return
      }
      $lanIp=$nginx.Env.lanIp
      Write-Output ('Ready: http://127.0.0.1:'+$script:httpPort+'/ -- LAN: http://'+$lanIp+':'+$script:httpPort+'/ -- sign in, then Settings > API Key')
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw ('Nginx readiness failed; inspect '+$nginx.Env.errorLog)
}
try {
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This recipe requires Windows x64; ARM64 has not been validated.' }
  if ($Mode -eq 'Check') {
    foreach ($name in @('node','npm.cmd','py','winget','java','ollama','nginx')) { $item=Get-Command $name -ErrorAction SilentlyContinue; Write-Output ($name+': '+$(if($item){$item.Source}else{'not on PATH'})) }
    foreach ($path in @('.venv/Scripts/python.exe','.venv-sign/Scripts/python.exe','models/sign-word-baseline/dynamic_gesture_classifier.tflite','models/help-video-tcn/v1/weights.npz','models/need-video-tcn/experimental-v1/weights.npz','models/me-video-tcn/experimental-v1/weights.npz','web/dist/index.html','tools/nginx/nginx.exe','tools/cloudflared/cloudflared.exe')) { Write-Output ($path+': '+(Test-Path -LiteralPath $path)) }
    Write-Output ('LAN IPv4: '+(Get-LanIp))
    Write-Output ('Nginx runtime: '+(Join-Path $env:LOCALAPPDATA 'Yuqiao\nginx-runtime'))
    Write-Output 'Check only: presence is not readiness. No secrets read, no downloads, no services changed.'
    exit 0
  }
  New-Item -ItemType Directory -Force -Path '.runtime-logs/tmp' | Out-Null
  $env:TEMP=Join-Path $projectRoot '.runtime-logs/tmp';$env:TMP=$env:TEMP
  $env:PIP_CACHE_DIR=Join-Path $projectRoot '.runtime-logs/pip-cache'
  $env:NPM_CONFIG_CACHE=Join-Path $projectRoot '.runtime-logs/npm-cache'
  if ($Mode -eq 'Install' -and $InstallSoftware) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Install-Package 'OpenJS.NodeJS.LTS' '24.21.0' }
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { Install-Package 'Python.Python.3.12' }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue) -and -not (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe'))) { Install-Package 'Ollama.Ollama' }
    if ($WithJdk -and -not (Get-Command java -ErrorAction SilentlyContinue)) { Install-Package 'EclipseAdoptium.Temurin.17.JDK' }
    if (-not (Test-Path (Join-Path $env:WINDIR 'System32/vcruntime140.dll'))) { Install-Package 'Microsoft.VCRedist.2015+.x64' }
    & (Join-Path $PSScriptRoot 'install-nginx.ps1') | Out-Null
  }
  $nodeVersion=& node -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^24\.') { throw 'Node.js 24.x required (reference: 24.21.0).' }
  if ($Mode -eq 'Install') {
    Invoke-Checked 'py' @('-3.12','-c','import sys; assert sys.maxsize > 2**32')
    Invoke-Checked 'npm.cmd' @('ci')
    foreach ($envInfo in @(@('.venv','server/requirements-speech.txt'),@('.venv-sign','server/requirements-sign-lock.txt'))) {
      $python=Join-Path $projectRoot ($envInfo[0]+'/Scripts/python.exe')
      if (Test-Path -LiteralPath $envInfo[0]) { Invoke-Checked $python @('-c','import sys; assert sys.version_info[:2] == (3,12)') }
      else { Invoke-Checked 'py' @('-3.12','-m','venv',$envInfo[0]) }
      Invoke-Checked $python @('-m','pip','--isolated','install','--index-url','https://pypi.org/simple','-r',$envInfo[1])
    }
    if ($Mode -eq 'Install' -or $WithTraining) {
      if (-not (Test-Path '.venv-anny')) { Invoke-Checked 'py' @('-3.12','-m','venv','.venv-anny') }
      Invoke-Checked '.venv-anny/Scripts/python.exe' @('-m','pip','install','--index-url','https://download.pytorch.org/whl/cpu','torch==2.7.1')
      Invoke-Checked '.venv-anny/Scripts/python.exe' @('-m','pip','--isolated','install','--index-url','https://pypi.org/simple','numpy==2.5.4')
      Invoke-Checked '.venv-anny/Scripts/python.exe' @('-m','pip','check')
      Invoke-Checked '.venv-anny/Scripts/python.exe' @('-c','import torch,numpy; print(torch.__version__); print(numpy.__version__)')
    }
    if (-not (Test-Path 'models/sign-word-baseline/dynamic_gesture_classifier.tflite')) { Invoke-Checked 'node' @('scripts/setup-sign-assets.mjs') }
    Invoke-Checked 'node' @('scripts/download-speech-mirror.mjs')
    foreach ($path in @('models/help-video-tcn/v1/weights.npz','models/need-video-tcn/experimental-v1/weights.npz','models/me-video-tcn/experimental-v1/weights.npz')) { if (-not (Test-Path $path)) { throw "Copy trained model from the source project: $path (no public download)." } }
    Invoke-Checked '.venv-sign/Scripts/python.exe' @('-B','scripts/check-windows-runtime.py')
    & (Join-Path $PSScriptRoot 'start-local-language.ps1') -Pull
    if ($LASTEXITCODE -ne 0) { throw 'Ollama model setup failed.' }
    Invoke-Checked 'npm.cmd' @('run','build')
  }
  $webEntries=@('node_modules/vite/bin/vite.js','node_modules/react/index.js','node_modules/react-dom/client.js','node_modules/mysql2/promise.js','node_modules/three/build/three.module.js','node_modules/@vitejs/plugin-react/dist/index.js')
  $missingEntries=@($webEntries | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
  if ($missingEntries.Count -gt 0) {
    throw ('Web dependencies are missing or incomplete: '+($missingEntries -join ', ')+'. Run npm.cmd ci --offline=false in the project folder, then retry Start-Yuqiao.cmd. This restores package-lock.json versions without changing user data.')
  }
  if (-not (Test-Path 'data/secrets/mysql.json')) { throw 'Ask the new Agent to create/configure the local yuqiao database per docs/Windows-migration.md, then run Start-Yuqiao.cmd. No blank SQLite will be created.' }
  $script:expected=Get-WorkspaceHash
  if ($Dev) { Start-DevStack } else { Start-NginxStack }
} catch { Write-Error $_; exit 1 }
