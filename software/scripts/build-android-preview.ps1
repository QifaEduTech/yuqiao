$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$sdk=Join-Path $root '.runtime-logs/android-sdk'
$work=Join-Path $root '.runtime-logs/android-build'
$dist=Join-Path $root 'android/dist'
New-Item -ItemType Directory -Force -Path $sdk,$work,$dist | Out-Null
function Run-Native([string]$exe,[string[]]$arguments){
 # Some Android native tools still mishandle non-ASCII absolute paths on Windows.
 $localArguments=@($arguments | ForEach-Object {if($_.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){[IO.Path]::GetRelativePath((Get-Location).Path,$_)}else{$_}})
 & $exe @localArguments
 if($LASTEXITCODE -ne 0){throw "Build tool failed: $exe ($LASTEXITCODE)"}
}
function Expand-Verified([string]$name,[string]$sha,[string]$destination,[string]$expected){
 if(Test-Path -LiteralPath $expected){return}
 $archive=Join-Path $root ('.runtime-logs/android-downloads/'+$name)
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA1).Hash.ToLowerInvariant() -ne $sha){throw 'Android SDK archive checksum mismatch'}
 $full=[IO.Path]::GetFullPath($destination)
 if(-not $full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'SDK destination outside workspace'}
 New-Item -ItemType Directory -Force -Path $full | Out-Null
 Expand-Archive -LiteralPath $archive -DestinationPath $full -Force
 if(-not(Test-Path -LiteralPath $expected)){throw 'SDK extraction incomplete'}
}
$androidJar=Join-Path $sdk 'platforms/android-35/android.jar'
$buildTools=Join-Path $sdk 'build-tools/android-15'
Expand-Verified 'platform-35_r02.zip' '0bb560a90a7a2cbd0dd8348224d518b638fe7949' (Join-Path $sdk 'platforms') $androidJar
Expand-Verified 'build-tools_r35_windows.zip' 'af059bb67cf7786f45ee0db85e2d24985df1b4b6' (Join-Path $sdk 'build-tools') (Join-Path $buildTools 'aapt.exe')
Push-Location $root
try{
 Run-Native (Join-Path $root '.venv-sign/Scripts/python.exe') @('-B','scripts/export-android-models.py')
 $generated=Join-Path $work 'generated';$classes=Join-Path $work 'classes';$dex=Join-Path $work 'dex'
 foreach($dir in @($generated,$classes,$dex)){
  $full=[IO.Path]::GetFullPath($dir)
  if(-not $full.StartsWith([IO.Path]::GetFullPath($work)+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Build output outside intended directory'}
  if(Test-Path -LiteralPath $full){if(@(Get-ChildItem -LiteralPath $full -Recurse -Force -Attributes ReparsePoint).Count){throw 'Refusing build symlink'};Remove-Item -LiteralPath $full -Recurse -Force}
  New-Item -ItemType Directory -Force -Path $full | Out-Null
 }
 $unsigned=Join-Path $work 'unsigned.apk';$aligned=Join-Path $work 'aligned.apk';$apk=Join-Path $dist 'yuqiao-preview.apk'
 Run-Native (Join-Path $buildTools 'aapt.exe') @('package','-f','-M',(Join-Path $root 'android/app/AndroidManifest.xml'),'-S',(Join-Path $root 'android/app/res'),'-A',(Join-Path $root '.runtime-logs/android-assets'),'-I',$androidJar,'-J',$generated,'-F',$unsigned)
 $sources=@(Get-ChildItem -LiteralPath (Join-Path $root 'android/app/src'),$generated -Recurse -Filter '*.java' | ForEach-Object {$_.FullName})
 Run-Native 'javac' (@('--release','8','-encoding','UTF-8','-classpath',$androidJar,'-d',$classes)+$sources)
 $compiled=@(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | ForEach-Object {$_.FullName})
 Run-Native 'java' (@('-cp',(Join-Path $buildTools 'lib/d8.jar'),'com.android.tools.r8.D8','--lib',$androidJar,'--min-api','26','--output',$dex)+$compiled)
 Push-Location $dex
 try{Run-Native (Join-Path $buildTools 'aapt.exe') @('add',$unsigned,'classes.dex')}finally{Pop-Location}
 Run-Native (Join-Path $buildTools 'zipalign.exe') @('-f','4',$unsigned,$aligned)
 $key=Join-Path $root '.runtime-logs/android-debug.keystore'
 if(-not(Test-Path -LiteralPath $key)){Run-Native 'keytool' @('-genkeypair','-keystore',$key,'-alias','androiddebugkey','-storepass','android','-keypass','android','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Yuqiao Local Preview,O=Yuqiao,C=CN')}
 Run-Native 'java' @('-jar',(Join-Path $buildTools 'lib/apksigner.jar'),'sign','--ks',$key,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,$aligned)
 Run-Native 'java' @('-jar',(Join-Path $buildTools 'lib/apksigner.jar'),'verify','--verbose',$apk)
 Get-Item -LiteralPath $apk | Select-Object FullName,Length
}finally{Pop-Location}
