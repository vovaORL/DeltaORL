@echo off
title DeltaORL UI
echo Starting DeltaORL React UI...
cd /d "%~dp0ui"
call npm.cmd run dev
pause
