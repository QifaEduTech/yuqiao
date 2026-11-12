param(
  [switch]$Dev
)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'stop-local-project.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'windows-project.ps1'),'-Mode','Start')
if ($Dev) { $arguments+='-Dev' }
& powershell.exe @arguments
exit $LASTEXITCODE
