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
%PY% download_cartouche_photos.py
if errorlevel 1 (
  echo ERROR: Cartouche photo download failed.
  pause
  exit /b 1
)
pause
