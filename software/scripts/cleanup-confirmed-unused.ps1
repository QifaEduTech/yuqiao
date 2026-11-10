$ErrorActionPreference='Stop'
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$prefix=$root+'\'
$processes=Get-CimInstance Win32_Process
$unrealActive=@($processes | Where-Object { $_.Name -match '^(UnrealEditor|zenserver|UnrealEditor-Cmd)\.exe$' }).Count -gt 0
$installerActive=@($processes | Where-Object { $_.Name -match '^(python|pip|node|npm)\.exe$' -and $_.CommandLine -match '(?i)(pip|npm).*\binstall\b' }).Count -gt 0
$targets=@(
 @{path='.runtime-logs/pip-cache';type='installer-cache'},
 @{path='.runtime-logs/npm-cache';type='installer-cache'},
 @{path='.runtime-logs/pycache';type='generated-cache'},
 @{path='.runtime-logs/bridge-ppt';type='cancelled-ppt'},
 @{path='.runtime-logs/continuous-candidate/corrnet-plus-source';type='retired-research'},
 @{path='.runtime-logs/unreal/DDC';type='unreal-cache'},
 @{path='.runtime-logs/unreal/Zen';type='unreal-cache'},
 @{path='.runtime-logs/unreal/User/Intermediate';type='unreal-cache'},
 @{path='unreal/YuqiaoAvatarPreview/Intermediate';type='unreal-cache'},
 @{path='unreal/YuqiaoAvatarPreview/DerivedDataCache';type='unreal-cache'},
 @{path='public/dictionary-images';type='user-requested-images'},
 @{path='dist/dictionary-images';type='user-requested-images'}
)
$results=@()
foreach($item in $targets){
 $absolute=[System.IO.Path]::GetFullPath((Join-Path $root $item.path))
 if(-not $absolute.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $absolute -eq $root){throw 'Target outside workspace'}
 if(-not(Test-Path -LiteralPath $absolute)){continue}
 $skip=$null
 if($item.type -eq 'unreal-cache' -and $unrealActive){$skip='Unreal or Zen process is running'}
 if($item.type -eq 'installer-cache' -and $installerActive){$skip='An installer is running'}
 $ancestor=Get-Item -LiteralPath $absolute -Force
 while($ancestor -and $ancestor.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){
  if(($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$skip='Reparse point found';break}
  $ancestor=$ancestor.Parent
 }
 if(-not $skip -and @(Get-ChildItem -LiteralPath $absolute -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count){$skip='Nested reparse point found'}
 if($skip){$results+=@{path=$absolute;status='skipped';reason=$skip};continue}
 $before=(Get-ChildItem -LiteralPath $absolute -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
 $failure=$null
 try{Remove-Item -LiteralPath $absolute -Recurse -Force -ErrorAction Stop}catch{$failure=$_.Exception.Message}
 $after=0
 if(Test-Path -LiteralPath $absolute){$after=(Get-ChildItem -LiteralPath $absolute -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum}
 $results+=@{path=$absolute;status=$(if(Test-Path -LiteralPath $absolute){'partial'}else{'removed'});bytesBefore=[long]$before;bytesRemaining=[long]$after;bytesRemoved=([long]$before-[long]$after);error=$failure}
}
$report=@{date='2026-10-19';workspace=$root;entries=$results;bytesRemoved=($results | Measure-Object bytesRemoved -Sum).Sum;preserved=@('models/gpt-sovits','models/sign-word-baseline','models/sensevoice-small-int8','.venv*','.runtime-logs/anny-cache','data','unreal/YuqiaoAvatarPreview/Content','unreal/YuqiaoAvatarPreview/Saved','source code and source documents')}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root '.runtime-logs/cleanup-confirmed-unused.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 6
