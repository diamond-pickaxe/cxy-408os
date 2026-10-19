@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  for %%F in (*.html) do if /i not "%%F"=="index.html" start "" "%%~fF"
  exit /b
)
node launch.mjs
if errorlevel 1 pause