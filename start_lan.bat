@echo off
setlocal

echo Starting Kursach Messenger for local network...
echo.
echo Open on this computer:
echo   http://127.0.0.1:8000
echo.
echo To find the phone address, look for IPv4 Address in this output:
echo.
ipconfig | findstr /i "IPv4"
echo.
echo On the phone open:
echo   http://YOUR_IPV4_ADDRESS:8000
echo.
echo Phone and computer must be connected to the same Wi-Fi network.
echo If Windows Firewall asks, allow Python for private networks.
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
