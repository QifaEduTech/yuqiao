param(
  [switch]$Force
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target=Join-Path $projectRoot 'tools/cloudflared'
$exe=Join-Path $target 'cloudflared.exe'
if ((Test-Path -LiteralPath $exe) -and -not $Force) {
  Write-Output $exe
  exit 0
}
$version='2026.10.7'
$url="https://github.com/cloudflare/cloudflared/releases/download/$version/cloudflared-windows-amd64.exe"
$expected='2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343'
$download=Join-Path $projectRoot ('.runtime-logs/cloudflared-download/cloudflared-windows-amd64.exe')
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $download),$target | Out-Null
if (-not (Test-Path -LiteralPath $download)) {
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  try {
    Invoke-WebRequest -Uri $url -OutFile $download -UseBasicParsing
  } catch {
    throw "Could not download cloudflared. Download $url manually and place it at tools\cloudflared\cloudflared.exe. $($_.Exception.Message)"
  }
}
$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant()
if ($hash -ne $expected) {
  Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
  throw "cloudflared SHA256 mismatch. Expected $expected, got $hash."
}
Copy-Item -LiteralPath $download -Destination $exe -Force
& $exe --version 2>&1 | ForEach-Object { Write-Output $_ }
Write-Output $exe
