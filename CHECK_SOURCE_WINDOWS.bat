@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (py -3 tools\self_check.py) else (python tools\self_check.py)
pause
