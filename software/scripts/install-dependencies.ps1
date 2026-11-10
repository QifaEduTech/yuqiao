$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$env:TEMP = Join-Path $projectRoot '.runtime-logs/tmp'
$env:TMP = $env:TEMP
$env:NPM_CONFIG_CACHE = Join-Path $projectRoot '.runtime-logs/npm-cache'
$env:NPM_CONFIG_LOGS_DIR = Join-Path $projectRoot '.runtime-logs/npm-logs'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.runtime-logs/playwright'
foreach ($directory in @($env:TEMP, $env:NPM_CONFIG_CACHE, $env:NPM_CONFIG_LOGS_DIR, $env:PLAYWRIGHT_BROWSERS_PATH)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
npm install --offline=false --prefer-online
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
