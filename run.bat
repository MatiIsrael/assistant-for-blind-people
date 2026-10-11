@echo off
title VisionNav - Voice Assistant
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
echo ========================================================
echo   Starting VisionNav - Voice Assistant for the Blind
echo ========================================================
echo.
echo Opening browser at http://127.0.0.1:8000 ...
start http://127.0.0.1:8000
echo.
python manage.py runserver 127.0.0.1:8000
pause
