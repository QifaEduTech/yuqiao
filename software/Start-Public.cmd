@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-project.ps1" -Mode Start -Public -QuickTunnel %*
if errorlevel 1 (pause & exit /b 1)
