@echo off
chcp 65001 > nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 download_offline_maps.py --tour karnak
) else (
    python download_offline_maps.py --tour karnak
)
echo.
echo Карта появится в maps\offline\karnak.pmtiles при успешной загрузке.
pause
