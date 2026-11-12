param(
  [string]$LanIp='',
  [string[]]$ExtraDns=@(),
  [switch]$Force,
  [switch]$NewCa
)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime=$env:YUQIAO_NGINX_RUNTIME
if (-not $runtime) { $runtime=Join-Path $env:LOCALAPPDATA 'Yuqiao\nginx-runtime' }
if ($runtime -match '[^\x00-\x7F]') { $runtime='C:\yuqiao-runtime' }
if ($runtime -match '[^\x00-\x7F]') { throw 'Certificate runtime path must be ASCII. Set YUQIAO_NGINX_RUNTIME.' }
$certDir=Join-Path $runtime 'certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
function Invoke-OpenSsl([string[]]$Arguments) {
  $previous=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try { & openssl @Arguments 2>&1 | Out-Null; return $LASTEXITCODE }
  catch { return 1 }
  finally { $ErrorActionPreference=$previous }
}

if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) { throw 'OpenSSL is required. Install Git for Windows or OpenSSL and retry.' }
if (-not $LanIp) {
  $LanIp=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown'
  } | Select-Object -First 1 -ExpandProperty IPAddress)
}
if (-not $LanIp) { throw 'No LAN IPv4 address found. Pass -LanIp explicitly.' }

$caKey=Join-Path $certDir 'yuqiao-ca.key'
$caCert=Join-Path $certDir 'yuqiao-ca.crt'
$serverKey=Join-Path $certDir 'yuqiao-server.key'
$serverCert=Join-Path $certDir 'yuqiao-server.crt'
$serverCsr=Join-Path $certDir 'yuqiao-server.csr'
$caConf=Join-Path $certDir 'ca.cnf'
$serverConf=Join-Path $certDir 'server.cnf'
$infoPath=Join-Path $certDir 'cert-info.json'

$needsGenerate=$Force -or -not (Test-Path -LiteralPath $serverCert) -or -not (Test-Path -LiteralPath $serverKey) -or -not (Test-Path -LiteralPath $caCert)
if (-not $needsGenerate) {
  $previous=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { $text=& openssl x509 -in $serverCert -noout -text 2>$null } catch { $text='' } finally { $ErrorActionPreference=$previous }
  if (-not ($text -match [regex]::Escape($LanIp))) { $needsGenerate=$true }
}
if (-not $needsGenerate) {
  Write-Output ('Local certificate already covers '+$LanIp+': '+$serverCert)
  Write-Output ('CA certificate for phone/PC trust: '+$caCert)
  exit 0
}

$altLines=@('DNS.1=yuqiao.local','DNS.2=localhost','IP.1=127.0.0.1',('IP.2='+$LanIp))
$index=3
foreach ($dns in $ExtraDns) {
  if ($dns -and $dns -notin @('yuqiao.local','localhost')) { $altLines+=('DNS.'+$index+'='+$dns); $index++ }
}
$caConfig=@"
[req]
distinguished_name=dn
x509_extensions=v3_ca
prompt=no
[dn]
CN=Yuqiao Local CA
[v3_ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
"@
$serverConfig=@"
[req]
distinguished_name=dn
prompt=no
[dn]
CN=yuqiao.local
[v3_req]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt
[alt]
$($altLines -join "`n")
"@
Set-Content -LiteralPath $caConf -Value $caConfig -Encoding ASCII
Set-Content -LiteralPath $serverConf -Value $serverConfig -Encoding ASCII

$needsCa=$NewCa -or -not (Test-Path -LiteralPath $caKey) -or -not (Test-Path -LiteralPath $caCert)
if ($needsCa) {
  if ((Invoke-OpenSsl @('req','-x509','-newkey','rsa:2048','-nodes','-keyout',$caKey,'-out',$caCert,'-days','3650','-config',$caConf)) -ne 0) { throw 'Failed to create local CA.' }
}
if ((Invoke-OpenSsl @('req','-newkey','rsa:2048','-nodes','-keyout',$serverKey,'-out',$serverCsr,'-config',$serverConf)) -ne 0) { throw 'Failed to create server CSR.' }
if ((Invoke-OpenSsl @('x509','-req','-in',$serverCsr,'-CA',$caCert,'-CAkey',$caKey,'-CAcreateserial','-out',$serverCert,'-days','825','-sha256','-extfile',$serverConf,'-extensions','v3_req')) -ne 0) { throw 'Failed to sign server certificate.' }
if ((Invoke-OpenSsl @('verify','-CAfile',$caCert,$serverCert)) -ne 0) { throw 'Local certificate verification failed.' }
Remove-Item -LiteralPath $serverCsr -Force -ErrorAction SilentlyContinue

$info=[ordered]@{
  createdAt=(Get-Date).ToString('s')
  lanIp=$LanIp
  dns=@('yuqiao.local','localhost')+@($ExtraDns | Where-Object { $_ })
  caCert=$caCert
  serverCert=$serverCert
  serverKey=$serverKey
  httpsPort=8443
}
$info | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $infoPath -Encoding UTF8
Write-Output ('Created local CA and server certificate for '+$LanIp)
Write-Output ('CA certificate for phone/PC trust: '+$caCert)
Write-Output ('Server certificate: '+$serverCert)
Write-Output ('Server key (keep private): '+$serverKey)
