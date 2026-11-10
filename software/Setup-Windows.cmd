@echo off
setlocal
cd /d "%~dp0"
call "%~dp0Deploy-Web.cmd" %*
exit /b %errorlevel%
