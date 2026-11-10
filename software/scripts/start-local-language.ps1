param([switch]$Pull)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configuration = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'shared/local-language.json') | ConvertFrom-Json
$modelHome = Join-Path $projectRoot 'models/ollama'
$logDirectory = Join-Path $projectRoot '.runtime-logs/ollama'
New-Item -ItemType Directory -Force -Path $modelHome,$logDirectory | Out-Null
$ollamaExecutable = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollamaExecutable) { $ollamaExecutable = Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe' }
if (-not (Test-Path -LiteralPath $ollamaExecutable)) { throw 'Ollama is not installed.' }
$env:OLLAMA_HOST = '127.0.0.1:11435'
$env:OLLAMA_MODELS = $modelHome
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_CONTEXT_LENGTH = '4096'
$env:TEMP = Join-Path $projectRoot '.runtime-logs/tmp'
$env:TMP = $env:TEMP
$running = $false
try { $version = Invoke-RestMethod -Uri ($configuration.baseUrl + '/api/version') -TimeoutSec 2; $running = [bool]$version.version } catch { }
if (-not $running) {
  $ollamaProcess = Start-Process -FilePath $ollamaExecutable -ArgumentList 'serve' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'stdout.log') -RedirectStandardError (Join-Path $logDirectory 'stderr.log') -PassThru
  $ollamaProcess.Id | Set-Content -LiteralPath (Join-Path $logDirectory 'server.pid')
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try { $version = Invoke-RestMethod -Uri ($configuration.baseUrl + '/api/version') -TimeoutSec 2; if ($version.version) { $running=$true; break } } catch { }
  }
}
if (-not $running) { throw 'Local Ollama startup failed. See .runtime-logs/ollama/stderr.log.' }
Write-Output "Local Ollama ready: $($configuration.baseUrl); models: $modelHome"
if ($Pull) { & $ollamaExecutable pull $configuration.model; if ($LASTEXITCODE -ne 0) { throw 'Model download did not complete.' } }
