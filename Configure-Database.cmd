@echo off
setlocal
cd /d "%~dp0software"
call "Configure-Database.cmd" %*
