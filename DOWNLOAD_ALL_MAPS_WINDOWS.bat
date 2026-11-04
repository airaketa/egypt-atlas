@echo off
chcp 65001 > nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 download_offline_maps.py --all
) else (
    python download_offline_maps.py --all
)
echo.
echo Готовые файлы будут в maps\offline\ при успешной загрузке.
pause
