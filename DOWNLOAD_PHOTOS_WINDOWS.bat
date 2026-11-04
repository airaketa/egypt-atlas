@echo off
cd /d "%~dp0"
py -3.12 download_commons_photos.py
if errorlevel 1 python download_commons_photos.py
pause
