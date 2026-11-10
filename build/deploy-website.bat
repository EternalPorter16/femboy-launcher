@echo off
setlocal
rem Called only after a fresh, successful website build. Never installs tools or changes login.
if not exist "%~dp0website-hosting.json" goto firebase
node "%~dp0website-provider.js"
if errorlevel 2 exit /b 1
if not errorlevel 1 goto spaceweb
goto firebase
:spaceweb
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-spaceweb.ps1" -Production
exit /b %errorlevel%
:firebase
where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI was not found. Install firebase-tools and sign in with firebase login.
  exit /b 1
)
pushd "%~dp0..\website" || exit /b 1
call firebase deploy --only hosting --project femboy-launcher --non-interactive
set "DEPLOY_RESULT=%errorlevel%"
popd
if not "%DEPLOY_RESULT%"=="0" (
  echo Website deployment failed. Check Firebase login and network, then retry the website step.
  exit /b %DEPLOY_RESULT%
)
echo Website is published: https://femboylauncher.ru/
exit /b 0
