$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
function Checked-Path([string]$relative){
 $value=[IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
 if(-not $value.StartsWith($projectRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside workspace'}
 return $value
}
$moves=@(
 @('index.html','web/index.html'),@('learning.html','web/learning.html'),@('realtime.html','web/realtime.html'),
 @('anny-review.html','web/anny-review.html'),@('model-review.html','web/model-review.html'),
 @('continuous-review.html','web/continuous-review.html'),@('sign-dictionary.html','web/sign-dictionary.html'),
 @('public','web/public'),@('docs/project-tree.json','项目计划/项目进度数据.json')
)
foreach($pair in $moves){
 $source=Checked-Path $pair[0];$destination=Checked-Path $pair[1]
 if(-not(Test-Path -LiteralPath $source)){throw "Missing move source: $source"}
 if(Test-Path -LiteralPath $destination){throw "Destination exists: $destination"}
 $entry=Get-Item -LiteralPath $source -Force
 if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing reparse point'}
 if($entry.PSIsContainer -and @(Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint).Count){throw 'Refusing nested reparse point'}
}
foreach($pair in $moves){
 $source=Checked-Path $pair[0];$destination=Checked-Path $pair[1]
 New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
 Move-Item -LiteralPath $source -Destination $destination
}
$moves | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Checked-Path '.runtime-logs/file-organization-moves.json') -Encoding utf8
Write-Output 'Frontend files consolidated under web; plan data moved into 项目计划.'
