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
echo Egypt Atlas v0.21: генерируем только 9 новых рассказов продолжения
%PY% -m pip install edge-tts mutagen
if errorlevel 1 (
  echo Ошибка установки зависимостей.
  pause
  exit /b 1
)
%PY% generate_all.py --extensions-only
if errorlevel 1 echo Проверь ошибки и повторно запусти этот файл. Готовые MP3 сохранятся.
echo Готово.
pause
