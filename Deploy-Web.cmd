@echo off
setlocal
cd /d "%~dp0software"
call "Deploy-Web.cmd" %*
