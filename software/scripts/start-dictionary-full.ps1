param([switch]$RetryFailed,[switch]$Restart,[switch]$StopOnly)
$ErrorActionPreference='Stop'
$workspacePath=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath=Join-Path $workspacePath '.runtime-logs/dictionary-full'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$pythonPath=Join-Path $workspacePath '.venv-sign/Scripts/python.exe'
$crawlerPath=Join-Path $PSScriptRoot 'crawl-dictionary-full.py'
$nodePath=(Get-Command node -ErrorAction Stop).Source
$existing=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*crawl-dictionary-full.py*' -and $_.CommandLine.Contains($crawlerPath) }
if($existing -and ($Restart -or $StopOnly)){foreach($running in $existing){Stop-Process -Id $running.ProcessId -Force -ErrorAction SilentlyContinue};Start-Sleep -Milliseconds 600}
elseif($existing){$existing | Select-Object ProcessId,Name | ConvertTo-Json;exit 0}
if($StopOnly){[pscustomobject]@{Stopped=@($existing).Count;Mode='stopped_by_user'} | ConvertTo-Json;exit 0}
$policyPath=Join-Path $workspacePath 'shared/dictionary-acquisition.json'
if((Test-Path -LiteralPath $policyPath) -and -not (Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json).downloadImages){throw '用户已停用配图采集；仅按需查看原站参考图。'}
$env:PYTHONIOENCODING='utf-8'
$env:PYTHONUNBUFFERED='1'
$env:TEMP=Join-Path $workspacePath '.runtime-logs/tmp'
$env:TMP=$env:TEMP
$taskArguments=@('-B',('"'+$crawlerPath+'"'),'--node',('"'+$nodePath+'"'))
if($RetryFailed){$taskArguments+='--retry-failed'}
$process=Start-Process -FilePath $pythonPath -ArgumentList $taskArguments -WorkingDirectory $workspacePath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'runner.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'runner.stderr.log') -PassThru
[pscustomobject]@{ProcessId=$process.Id;StatusFile=(Join-Path $runtimePath 'status.json');Log=(Join-Path $runtimePath 'runner.stdout.log')} | ConvertTo-Json
