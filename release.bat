@echo off
rem Tests, builds and publishes to Object Storage, then the legacy Yandex.Disk mirror.
rem Before running: bump "version" in package.json; the Yandex.Disk app must be running and signed in.
rem Last step: reserve copy on GitHub (needs a token saved with build\setup-github-token.ps1; skipped without it).
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install || (pause & exit /b 1)
)
rem Tests first: a failing test stops the release before anything is built or published
call npm test || (echo. & echo Tests failed - nothing was built or published. & pause & exit /b 1)
rem Check S3 credentials before building. The key stays outside this project.
powershell -NoProfile -ExecutionPolicy Bypass -File build\publish-s3.ps1 -Check || (pause & exit /b 1)
rem Update notes: the "What's new" entry of this version goes to build\release-notes.md, electron-builder puts it into latest.yml and installed
rem launchers show it before updating. Notes of the previous release are deleted first; a failure here never stops the release
if exist build\release-notes.md del build\release-notes.md
node build\release-notes.js || echo Update notes were not generated - continuing without them.
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set CSC_IDENTITY_AUTO_DISCOVERY=false
set PUBLISH=never
rem Separate output folder, so a launcher running from dist does not lock the build
call npx electron-builder --win --publish %PUBLISH% --config.directories.output=dist-release || (pause & exit /b 1)
echo.
rem Main source first: installers, public hash checks, then latest.yml. Stop on failure.
powershell -NoProfile -ExecutionPolicy Bypass -File build\publish-s3.ps1 -Out dist-release || (pause & exit /b 1)
rem Keep the legacy Yandex.Disk channel for old clients and fallback downloads.
powershell -NoProfile -ExecutionPolicy Bypass -File build\publish-yandex.ps1 -Out dist-release || (pause & exit /b 1)
echo.
rem The release is live: installers of older versions are not needed in dist-release any more (the previous one stays in the archive folder on the Disk).
rem This step runs only after a successful publish; a failure here is harmless and never stops anything
node build\clean-dist.js dist-release || echo Old installers were not cleaned - not important.
rem Build and deploy the website only AFTER both launcher uploads succeed.
if exist website\package.json (
  node build\website-release.js dist-release --build && call build\deploy-website.bat || echo WARNING: Launcher is published, but website update failed. Retry: node build/website-release.js dist-release --build ^&^& build\deploy-website.bat
)
rem Reserve copy on GitHub (source push + release with installers). Runs last; skipped without a saved token; a failure never cancels the release.
powershell -NoProfile -ExecutionPolicy Bypass -File build\publish-github.ps1 -Out dist-release || echo WARNING: Launcher is published, but the GitHub reserve step failed. Retry: powershell -File build\publish-github.ps1 -Out dist-release
rem A failed clean-up must not leave an error code behind: the release itself went through
ver >nul
echo.
echo Installed launchers will pick up the new version on next start (or within 2 hours).
pause
