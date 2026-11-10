@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts/configure-local-mysql.ps1"
if errorlevel 1 (pause & exit /b 1)
echo Database configuration saved for this Windows account.
pause
