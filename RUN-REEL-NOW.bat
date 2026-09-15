@echo off
REM MAIS CAR — RUN-REEL-NOW.bat (rev-5, minimal, 2026-09-15).
REM The .bat does nothing but launch PowerShell. ALL logging happens
REM inside run-reel-now.ps1, which does not rely on OneDrive mid-write
REM behavior (PowerShell flushes each Tee-Object append).
cd /d "%~dp0"
echo MAIS CAR - iniciando pipeline...
echo Log em tempo real: packages\backend\.cache\run-reel-now-*.log
echo NAO FECHE ESTA JANELA (~5-15 min).
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-reel-now.ps1"
echo.
echo ============================================================
echo   Pipeline exit: %ERRORLEVEL%
echo   Log: packages\backend\.cache\run-reel-now-*.log
echo ============================================================
pause
