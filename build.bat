@echo off
rem Builds dist\FemboyLauncher-Setup-*.exe and dist\FemboyLauncher-Portable-*.exe
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install || (pause & exit /b 1)
)
rem GitHub is often slow or blocked, so build tools are downloaded from the npmmirror mirror
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win --publish never || (pause & exit /b 1)
echo.
echo Done! Files are in the dist folder:
dir /b dist\*.exe
explorer dist
pause
