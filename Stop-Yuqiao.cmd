@echo off
setlocal
cd /d "%~dp0software"
call "Stop-Yuqiao.cmd" %*
