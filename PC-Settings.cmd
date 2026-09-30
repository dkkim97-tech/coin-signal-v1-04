@echo off
cd /d "%~dp0"
node scripts/init-pc.mjs
if errorlevel 1 exit /b 1
notepad .env.pc
