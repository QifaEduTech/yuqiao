$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
if(Test-Path -LiteralPath 'data/secrets/mysql.json'){throw 'Existing configuration retained. This entry never overwrites it.'}
if(-not(Test-Path -LiteralPath 'node_modules/mysql2/promise.js')){throw 'Install Node.js 24, then run npm.cmd ci before configuring MySQL.'}
Write-Host 'Create your own local MySQL 8.0 yuqiao database and 10 empty tables first. See README.'
$user=Read-Host 'MySQL user (your own account)'
$portText=Read-Host 'Local MySQL port (Enter for 3306)'
$port=3306
if($portText){$port=[int]$portText}
$secret=Read-Host 'MySQL password (hidden)' -AsSecureString
$pointer=[IntPtr]::Zero
try{
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $payload=@{host='127.0.0.1';port=$port;database='yuqiao';user=$user;password=$password} | ConvertTo-Json -Compress
  $OutputEncoding=New-Object System.Text.UTF8Encoding($false)
  $payload | & node 'scripts/configure-local-mysql.mjs'
  if($LASTEXITCODE -ne 0){throw 'Configuration failed; no database data changed.'}
}finally{
  if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
  $password=$null;$payload=$null;$secret.Dispose()
}
