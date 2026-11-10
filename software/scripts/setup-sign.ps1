$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$env:TEMP = Join-Path $projectRoot '.runtime-logs/tmp'
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.runtime-logs/pip-cache'
$env:PYTHONPYCACHEPREFIX = Join-Path $projectRoot '.runtime-logs/pycache'
$env:KERAS_HOME = Join-Path $projectRoot '.runtime-logs/keras'
New-Item -ItemType Directory -Path $env:TEMP,$env:PIP_CACHE_DIR,$env:KERAS_HOME -Force | Out-Null
if (-not (Test-Path '.venv-sign/Lib/site-packages/pip')) {
  & '.venv/Scripts/python.exe' -m venv .venv-sign
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$requirements = if (Test-Path 'server/requirements-sign-lock.txt') { 'server/requirements-sign-lock.txt' } else { 'server/requirements-sign.txt' }
& '.venv-sign/Scripts/python.exe' -m pip --isolated install --disable-pip-version-check --cache-dir $env:PIP_CACHE_DIR --index-url https://mirrors.aliyun.com/pypi/simple/ -r $requirements
exit $LASTEXITCODE
