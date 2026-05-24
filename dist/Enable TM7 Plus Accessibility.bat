@echo off
REM Enable safeT PTT hardware-key routing on Inrico TM-7 Plus (Android 10).
REM Requires: radio connected by USB, USB debugging ON, adb on your PC PATH.
REM Run from the dist folder or double-click in File Explorer.

set SERVICE=com.securityradio.ptt/com.securityradio.ptt.device.InricoHardwareService

echo Checking adb connection...
adb devices
if errorlevel 1 (
    echo.
    echo adb failed. Install Android platform-tools and accept the USB debugging prompt on the radio.
    pause
    exit /b 1
)

echo.
echo Enabling accessibility master switch...
adb shell settings put secure accessibility_enabled 1

echo Reading services already enabled...
for /f "delims=" %%i in ('adb shell settings get secure enabled_accessibility_services') do set EXISTING=%%i

echo.
if "%EXISTING%"=="" (
    echo No other services listed; enabling only safeT PTT.
    adb shell settings put secure enabled_accessibility_services %SERVICE%
) else (
    echo %EXISTING% | findstr /C:"%SERVICE%" >nul
    if errorlevel 1 (
        echo Appending safeT PTT to existing services.
        adb shell settings put secure enabled_accessibility_services %EXISTING%:%SERVICE%
    ) else (
        echo safeT PTT is already in the enabled list.
    )
)

echo.
echo Done. Open safeT PTT on the radio — the accessibility warning should clear.
pause
