$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$env:TEMP = Join-Path $projectRoot '.runtime-logs/tmp'
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.runtime-logs/pip-cache'
$env:PYTHONPYCACHEPREFIX = Join-Path $projectRoot '.runtime-logs/pycache'
New-Item -ItemType Directory -Path $env:TEMP,$env:PIP_CACHE_DIR,$env:PYTHONPYCACHEPREFIX -Force | Out-Null
python -m venv .venv
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (Test-Path -LiteralPath 'server/requirements-speech.txt') {
    & '.venv/Scripts/python.exe' -m pip --isolated install --disable-pip-version-check --cache-dir $env:PIP_CACHE_DIR --index-url https://mirrors.aliyun.com/pypi/simple/ -r server/requirements-speech.txt
} else {
    & '.venv/Scripts/python.exe' -m pip --isolated install --disable-pip-version-check --cache-dir $env:PIP_CACHE_DIR --index-url https://mirrors.aliyun.com/pypi/simple/ 'sherpa-onnx>=1.12,<2' 'numpy>=1.26,<3'
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& '.venv/Scripts/python.exe' -m pip freeze | Set-Content -LiteralPath 'server/requirements-speech.txt' -Encoding utf8
