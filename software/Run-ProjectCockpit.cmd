@echo off
setlocal EnableExtensions
title Yuqiao Project Cockpit
cd /d "%~dp0"

set "PY="

rem Prefer the system Python launcher; never trust a copied .venv first.
py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,8) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=py -3"

if not defined PY (
  python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,8) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=python"
)

rem Last resort: use the local venv only if it actually starts on this machine.
if not defined PY if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,8) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=.venv\Scripts\python.exe"
)

if not defined PY (
  echo [ERROR] Python 3.8+ was not found.
  echo Install Python 3 and enable "Add python.exe to PATH", or run Deploy-Web.cmd once.
  pause
  exit /b 1
)

echo Using: %PY%
%PY% "%~dp0scripts\project_cockpit.py" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%
