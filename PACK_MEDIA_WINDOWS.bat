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
echo Prepare every Atlas country and city media package for GitHub Release.
echo Required counts are discovered automatically from content\.
echo Important: review all photo licenses and redistribution terms for generated TTS.
choice /C YN /M "I have confirmed legal rights to distribute the included audio and images"
if errorlevel 2 (
  echo Cancelled.
  pause
  exit /b 1
)
%PY% tools\pack_media.py --strict --confirm-rights
if errorlevel 1 (
  echo FAILED. Complete the missing media shown above and run this file again.
  pause
  exit /b 1
)
echo Created atlas-media.zip. Attach this stable filename to a new media-vN Release.
pause
