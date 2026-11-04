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
echo Egypt Atlas: downloading offline maps for all 12 tours...
%PY% download_offline_maps.py --all %*
if errorlevel 1 (
  echo ERROR: Offline map download failed. Review the messages above.
  pause
  exit /b 1
)
echo.
echo Done. Offline maps are stored in maps\offline\.
pause
