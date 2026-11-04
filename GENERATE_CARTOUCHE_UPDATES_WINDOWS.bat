@echo off
chcp 65001 >nul
set "PYTHONUTF8=1"
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  set "PY=python"
) else (
  py -3.12 -c "import sys" >nul 2>nul
  if not errorlevel 1 (
    set "PY=py -3.12"
  ) else (
    py -3.11 -c "import sys" >nul 2>nul
    if not errorlevel 1 (
      set "PY=py -3.11"
    ) else (
      set "PY=py -3"
    )
  )
)
%PY% -m pip install edge-tts mutagen
if errorlevel 1 (echo Dependencies failed & pause & exit /b 1)
for %%I in (KAR-04 KAR-05 LUX-01 HAB-02) do (
    %PY% generate_all.py --only %%I
    if errorlevel 1 (echo TTS failed %%I & pause & exit /b 1)
)
echo Four updated MP3 tracks are ready.
pause
