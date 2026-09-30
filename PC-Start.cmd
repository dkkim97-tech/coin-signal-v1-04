@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
node scripts/init-pc.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
node --env-file=.env.pc server/pc-main.mjs --open
echo PC trading server stopped. Check outstanding orders in Bitget.
pause
