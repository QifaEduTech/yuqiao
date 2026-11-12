@echo off
setlocal
title Yuqiao
cd /d "%~dp0"
echo Starting Yuqiao HTTP LAN on port 8080...
echo First start may take up to a minute. Errors will pause this window.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-project.ps1" -Mode Start %*
if errorlevel 1 (pause & exit /b 1)
if /I "%~1"=="-Dev" (
  start "" "http://127.0.0.1:5173/"
) else if /I "%~1"=="-Public" (
  rem The public URL was opened by the PowerShell launcher.
) else if /I "%~1"=="-Https" (
  start "" "https://127.0.0.1:8443/"
) else (
  start "" "http://127.0.0.1:8080/"
)
exit /b 0
