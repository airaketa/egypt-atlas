@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (set "PY=py -3") else (set "PY=python")
echo Prepare Egypt Atlas media for public GitHub Release.
echo Important: review all photo licenses and redistribution terms for generated TTS.
choice /C YN /M "I have confirmed legal rights to distribute the included audio and images"
if errorlevel 2 (echo Cancelled. & pause & exit /b 1)
%PY% tools\pack_media.py --strict --confirm-rights
if errorlevel 1 (echo FAILED. Check missing or stale tracks. & pause & exit /b 1)
echo Created egypt-media.zip. Attach it to Release media-v1.
pause
