@echo off
REM MP22 PC setup: virtual Display 0 — mouse and keyboard work in scrcpy (Android 8.1).
cd /d "C:\Users\Evan Gauvreau\Desktop\scrcpy-win64-v3.3.3"

adb.exe devices

adb.exe shell settings put system accelerometer_rotation 0
adb.exe shell settings put system user_rotation 0

REM App opens on virtual display until you tap MOVE TO PHYSICAL RADIO SCREEN in settings.
adb.exe shell am start -n com.securityradio.ptt/.DisplayRouterActivity

timeout /t 2 /nobreak >nul

REM No --display-id: default mirror = virtual screen (Display 0).
scrcpy.exe -d --window-width=800 --window-height=1300 --window-title="MP22 PC Setup"

pause
