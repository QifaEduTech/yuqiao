@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local-project.ps1"
if errorlevel 1 (pause & exit /b 1)
echo Yuqiao services are stopped. You may close the browser tab.
%SystemRoot%\System32\ping.exe -n 4 127.0.0.1 >nul
