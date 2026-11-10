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
echo Atlas: downloading every offline attraction map found under content\...
%PY% download_offline_maps.py --all %*
if errorlevel 1 (
  echo ERROR: Offline map download failed. Review the messages above.
  pause
  exit /b 1
)
echo.
echo Done. Each offline map is stored beside its attraction manifest.
pause
