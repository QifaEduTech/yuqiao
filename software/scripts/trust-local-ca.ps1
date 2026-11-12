[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [string]$CaCert=''
)
$ErrorActionPreference='Stop'
$runtime=$env:YUQIAO_NGINX_RUNTIME
if (-not $runtime) { $runtime=Join-Path $env:LOCALAPPDATA 'Yuqiao\nginx-runtime' }
if (-not $CaCert) { $CaCert=Join-Path $runtime 'certs/yuqiao-ca.crt' }
if (-not (Test-Path -LiteralPath $CaCert)) { throw "CA certificate not found: $CaCert. Run scripts/create-local-cert.ps1 first." }
if ($PSCmdlet.ShouldProcess($CaCert,'Trust this CA for the current Windows user')) {
  Import-Certificate -FilePath $CaCert -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
  Write-Output ('Trusted for current user: '+$CaCert)
  Write-Output 'Close and reopen the browser, then use https://127.0.0.1:8443/.'
}
