@echo off
REM Registers a vlc:// URL handler for the current user so StreamForest's
REM "Open in VLC" button launches VLC directly (no .m3u download step).
REM Run once by double-clicking this file. No admin rights needed (HKCU).
setlocal

set "DST=%LOCALAPPDATA%\StreamForest"
if not exist "%DST%" mkdir "%DST%"
copy /y "%~dp0vlc-open.vbs" "%DST%\vlc-open.vbs" >nul

reg add "HKCU\Software\Classes\vlc" /ve /d "URL:VLC Protocol" /f >nul
reg add "HKCU\Software\Classes\vlc" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\vlc\shell\open\command" /ve /d "wscript.exe \"%DST%\vlc-open.vbs\" \"%%1\"" /f >nul

echo.
echo Installed vlc:// handler for the current user.
echo Test: press Win+R and run     vlc://http://example.com/stream.ts
echo.
echo To uninstall: reg delete "HKCU\Software\Classes\vlc" /f
echo.
pause
