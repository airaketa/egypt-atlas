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
echo Egypt Atlas: 82 аудиорассказа (73 основных + 9 дополнительных) / Светлана
%PY% -m pip install edge-tts mutagen
if errorlevel 1 (
  echo Не удалось установить зависимости. Проверь интернет/Python.
  pause
  exit /b 1
)
%PY% generate_all.py
if errorlevel 1 (
  echo Некоторые дорожки не готовы. После исправления проблемы этот BAT продолжит с нужного места.
)
echo.
echo Для прослушивания открой listen.html
pause
