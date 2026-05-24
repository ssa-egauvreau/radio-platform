@echo off
REM MP22 daily use: view physical Display 1 only (no PC click/type on Android 8.1).
cd /d "C:\Users\Evan Gauvreau\Desktop\scrcpy-win64-v3.3.3"

adb.exe devices

adb.exe shell am start --display 1 -n com.securityradio.ptt/.DisplayRouterActivity

timeout /t 2 /nobreak >nul

scrcpy.exe -d --display-id=1 --no-control --window-width=800 --window-height=1300 --window-title="MP22 Physical View"

pause
