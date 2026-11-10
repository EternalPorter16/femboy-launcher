@echo off
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install || (pause & exit /b 1)
)
call npm start
