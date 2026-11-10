@echo off
chcp 65001 >nul
set "PYTHONUTF8=1"
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  set "PY=python"
) else (
  set "PY=py -3"
)
echo Atlas: generating every audio track found under content\...
%PY% -m pip install edge-tts mutagen
if errorlevel 1 (
  echo ERROR: Could not install dependencies. Check Python and internet access.
  pause
  exit /b 1
)
%PY% generate_all.py --all
if errorlevel 1 (
  echo ERROR: Some tracks are not ready. Run this file again after fixing the error.
  pause
  exit /b 1
)
echo.
echo Done. All country, city and point audio tracks are ready.
pause
