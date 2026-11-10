$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/stop-local-project.ps1')
$root='E:\Test Workspace\Yuqiao'
function Process-Example([int]$Id,[int]$Parent,[string]$Name,[string]$Command,[int]$Second=1){return [pscustomobject]@{ProcessId=$Id;ParentProcessId=$Parent;Name=$Name;CommandLine=$Command;CreationDate=[datetime]::new(2026,10,29,0,0,$Second)}}
function Assert-Ids($Plan,[int[]]$Ids){$actual=@($Plan.Processes|ForEach-Object{[int]$_.ProcessId}|Sort-Object);$expected=@($Ids|Sort-Object);if(($actual -join ',') -ne ($expected -join ',')){throw "Wrong targets: $actual expected $expected"}}
$stack=Process-Example 10 1 node.exe ('node "'+$root+'\scripts\dev-stack.mjs" dev --port 5173')
$front=Process-Example 11 10 node.exe ('node "'+$root+'\node_modules\vite\bin\vite.js" --port 5173') 2
$back=Process-Example 12 10 node.exe ('node "'+$root+'\server\index.mjs"') 2
$worker=Process-Example 13 12 python.exe ('python "'+$root+'\server\realtime_worker.py"') 3
$mysql=Process-Example 14 1 mysqld.exe 'mysqld'
$ollama=Process-Example 15 1 ollama.exe 'ollama serve'
$other=Process-Example 16 1 node.exe 'node D:\Other\server\index.mjs'
$connections=@([pscustomobject]@{LocalPort=5173;OwningProcess=11},[pscustomobject]@{LocalPort=5174;OwningProcess=12})
Assert-Ids (Get-YuqiaoStopPlan $root @($stack,$front,$back,$worker,$mysql,$ollama,$other) $connections) @(10,11,12,13)
$threw=$false;try{Get-YuqiaoStopPlan $root @($other,$back) @([pscustomobject]@{LocalPort=5173;OwningProcess=16}) | Out-Null}catch{$threw=$true};if(-not $threw){throw 'Foreign listener accepted'}
$similar=Process-Example 17 1 node.exe ('node "'+$root+'\server\index.mjs.backup"')
Assert-Ids (Get-YuqiaoStopPlan $root @($similar) @()) @()
$testStack=Process-Example 20 1 node.exe ('node "'+$root+'\scripts\dev-stack.mjs" dev --port 5183')
$testApi=Process-Example 21 20 node.exe ('node "'+$root+'\server\index.mjs"') 2
Assert-Ids (Get-YuqiaoStopPlan $root @($testStack,$testApi) @([pscustomobject]@{LocalPort=5184;OwningProcess=21})) @()
Assert-Ids (Get-YuqiaoStopPlan $root @($testStack,$testApi) @()) @()
$reused=Process-Example 30 10 python.exe 'python other.py' 0
Assert-Ids (Get-YuqiaoStopPlan $root @($stack,$reused) @()) @(10)
Assert-Ids (Get-YuqiaoStopPlan $root @($mysql,$ollama,$other) @()) @()
Write-Output '7 stop-planner checks passed. No real process was stopped.'
