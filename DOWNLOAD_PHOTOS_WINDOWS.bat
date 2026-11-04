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
echo Egypt Atlas: downloading missing photos only...
%PY% download_commons_photos.py --delay 2 --timeout 30 --retries 5
if errorlevel 1 (
  echo Some photos are still missing. Run this file again later; existing files will be skipped.
  pause
  exit /b 1
)
echo All available photos are ready.
pause
