@echo off
title DeltaORL Desktop Terminal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0ui"
call .\node_modules\.bin\electron.cmd . --disable-gpu-shader-disk-cache --disable-features=DawnGraphite,PersistentCache,SkiaGraphite --log-level=3

