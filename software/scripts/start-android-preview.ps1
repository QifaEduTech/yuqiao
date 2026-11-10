param([int]$VmIndex=0,[switch]$Build)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$manager='D:\APP\MuMuPlayer\nx_main\MuMuManager.exe'
$adb='D:\APP\MuMuPlayer\nx_main\adb.exe'
if(-not(Test-Path -LiteralPath $manager)){throw 'MuMu manager not found. Configure the emulator tool paths first.'}
if($Build){& (Join-Path $PSScriptRoot 'build-android-preview.ps1');if($LASTEXITCODE -ne 0){throw 'Build failed'}}
$health=Invoke-RestMethod 'http://127.0.0.1:5174/api/health'
if($health.service -ne 'yuqiao'){throw 'Computer backend unavailable'}
& $manager control -v $VmIndex launch
$ready=$false
for($attempt=0;$attempt -lt 25;$attempt++){
 $info=(& $manager info -v $VmIndex | Out-String | ConvertFrom-Json)
 if($info.is_android_started -and $info.adb_port){$ready=$true;break}
 Start-Sleep -Seconds 1
}
if(-not $ready){throw 'Emulator not ready; retry after it finishes starting'}
$serial='127.0.0.1:'+$info.adb_port
& $adb connect $serial
& $adb -s $serial reverse tcp:5173 tcp:5173
if($LASTEXITCODE -ne 0){throw 'Cannot connect emulator to localhost service'}
$apk=Join-Path $root 'android/dist/yuqiao-preview.apk'
& $adb -s $serial install -r $apk
if($LASTEXITCODE -ne 0){throw 'APK installation failed'}
& $adb -s $serial shell am start -n cn.yuqiao.app/.MainActivity
if($LASTEXITCODE -ne 0){throw 'App launch failed'}
Write-Output 'Yuqiao opened in the computer emulator. No physical phone targeted.'
