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
echo Prepare the complete Egypt Atlas offline package for GitHub Release.
echo Required: 82 MP3, 82 photos, 6 cartouche photos and 12 PMTiles maps.
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
echo Created egypt-media.zip. Attach it to Release media-v1.
pause
