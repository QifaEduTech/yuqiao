param(
  [ValidateSet('Check','Install','Start')][string]$Mode='Check',
  [switch]$InstallSoftware,
  [switch]$WithJdk,
  [switch]$WithTraining
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
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
try {
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This recipe requires Windows x64; ARM64 has not been validated.' }
  if ($Mode -eq 'Check') {
    foreach ($name in @('node','npm.cmd','py','winget','java','ollama')) {
      $item=Get-Command $name -ErrorAction SilentlyContinue
      Write-Output ($name+': '+$(if($item){$item.Source}else{'not on PATH'}))
    }
    foreach ($path in @('.venv/Scripts/python.exe','.venv-sign/Scripts/python.exe','models/sign-word-baseline/dynamic_gesture_classifier.tflite','models/help-video-tcn/v1/weights.npz','models/need-video-tcn/experimental-v1/weights.npz','models/me-video-tcn/experimental-v1/weights.npz')) { Write-Output ($path+': '+(Test-Path -LiteralPath $path)) }
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
  }
  $nodeVersion=& node -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^24\.') { throw 'Node.js 24.x required (reference: 24.21.0).' }
  if ($Mode -eq 'Install') {
    Invoke-Checked 'py' @('-3.12','-c','import sys; assert sys.maxsize > 2**32')
    Invoke-Checked 'npm.cmd' @('ci')
    if (-not (Test-Path 'data/secrets/mysql.json')) {
      & (Join-Path $PSScriptRoot 'configure-local-mysql.ps1')
      if (-not (Test-Path 'data/secrets/mysql.json')) { throw 'Configure your MySQL database before continuing.' }
    }
    foreach ($envInfo in @(@('.venv','server/requirements-speech.txt'),@('.venv-sign','server/requirements-sign-lock.txt'))) {
      $python=Join-Path $projectRoot ($envInfo[0]+'/Scripts/python.exe')
      if (Test-Path -LiteralPath $envInfo[0]) { Invoke-Checked $python @('-c','import sys; assert sys.version_info[:2] == (3,12)') }
      else { Invoke-Checked 'py' @('-3.12','-m','venv',$envInfo[0]) }
      Invoke-Checked $python @('-m','pip','--isolated','install','--index-url','https://pypi.org/simple','-r',$envInfo[1])
    }
    # The Web training workbench requires the isolated CPU trainer by default.
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
  # A partially cleaned node_modules directory can exist while its packages are missing.
  # Check actual entry files before launching a hidden service that can only time out.
  $webEntries=@('node_modules/vite/bin/vite.js','node_modules/react/index.js','node_modules/react-dom/client.js','node_modules/mysql2/promise.js','node_modules/three/build/three.module.js','node_modules/@vitejs/plugin-react/dist/index.js')
  $missingEntries=@($webEntries | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
  if ($missingEntries.Count -gt 0) {
    throw ('Web dependencies are missing or incomplete: '+($missingEntries -join ', ')+'. Run npm.cmd ci --offline=false in the project folder, then retry Start-Yuqiao.cmd. This restores package-lock.json versions without changing user data.')
  }
  if (-not (Test-Path 'data/secrets/mysql.json')) { throw 'Ask the new Agent to create/configure the local yuqiao database per docs/Windows-migration.md, then run Start-Yuqiao.cmd. No blank SQLite will be created.' }
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { $expected=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath((Join-Path $projectRoot 'web/public')))))).Replace('-','').ToLower().Substring(0,16) } finally { $hasher.Dispose() }
  $ready=$false
  try { $health=Invoke-RestMethod 'http://127.0.0.1:5174/api/health' -TimeoutSec 2; $ready=($health.service -eq 'yuqiao' -and $health.database -eq 'mysql' -and $health.workspace -eq $expected) } catch { }
  if (-not $ready) {
    if ((Test-Port 5173) -or (Test-Port 5174)) { throw 'Web ports occupied; refusing duplicate startup or stopping another project.' }
    $node=(Get-Command node).Source
    $process=Start-Process -FilePath $node -ArgumentList @('scripts/run-local.mjs','dev','--port','5173','--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.runtime-logs/local-service.stdout.log') -RedirectStandardError (Join-Path $projectRoot '.runtime-logs/local-service.stderr.log') -PassThru
  }
  for ($i=0;$i -lt 90;$i++) {
    if ($process -and $process.HasExited) { throw 'Project service exited during startup; inspect .runtime-logs/local-service.stderr.log.' }
    try {
      $health=Invoke-RestMethod 'http://127.0.0.1:5173/api/health' -TimeoutSec 2
      if ($health.workspace -eq $expected -and $health.database -eq 'mysql') { Write-Output 'Ready: http://127.0.0.1:5173/ -- sign in, then Settings > API Key'; exit 0 }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  throw 'Web readiness failed; inspect .runtime-logs/local-service.stderr.log.'
} catch { Write-Error $_; exit 1 }
