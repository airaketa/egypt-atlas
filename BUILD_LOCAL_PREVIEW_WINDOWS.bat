@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PY=py -3"
) else (
  set "PY=python"
)
%PY% tools\build_site.py --media egypt-media.zip --out _site --require-audio
if errorlevel 1 (pause & exit /b 1)
cd _site
%PY% -m http.server 8000
