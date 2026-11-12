param(
  [switch]$Force
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target=Join-Path $projectRoot 'tools/nginx'
$exe=Join-Path $target 'nginx.exe'
if ((Test-Path -LiteralPath $exe) -and -not $Force) {
  Write-Output $exe
  exit 0
}
$version='1.30.6'
$archive=Join-Path $projectRoot ('.runtime-logs/nginx-download/nginx-'+$version+'.zip')
$expected='c6ee35edb0a861063323f709192ae50d1eefaf2ea7d00678bd2b22d8542dc61e'
$url='https://nginx.org/download/nginx-'+$version+'.zip'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive) | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  try {
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  } catch {
    throw "Could not download Nginx. Download $url manually, extract it, and place nginx.exe at tools\nginx\nginx.exe. $($_.Exception.Message)"
  }
}
$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
if ($hash -ne $expected) {
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  throw "Nginx archive SHA256 mismatch. Expected $expected, got $hash. Do not use this file."
}
$extract=Join-Path $projectRoot '.runtime-logs/nginx-extract'
if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
$inner=Join-Path $extract ('nginx-'+$version)
if (-not (Test-Path -LiteralPath (Join-Path $inner 'nginx.exe'))) { throw 'Nginx archive layout is unexpected.' }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $inner '*') -Destination $target -Recurse -Force
Remove-Item -LiteralPath $extract -Recurse -Force
if (-not (Test-Path -LiteralPath $exe)) { throw 'Nginx extraction failed.' }
& $exe -v 2>&1 | ForEach-Object { Write-Output $_ }
Write-Output $exe
