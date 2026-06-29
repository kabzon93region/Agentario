@echo off
chcp 65001 >nul
setlocal

rem Project root: works with Z:\T\Agentario, \\SERVANT\reZerv\T\Agentario, or any path
set "AGENTARIO_SRC=%~dp0"
if "%AGENTARIO_SRC:~-1%"=="\" set "AGENTARIO_SRC=%AGENTARIO_SRC:~0,-1%"

echo Source: %AGENTARIO_SRC%
echo Build cache: C:\Users\Admin\Agentario
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
    echo.
    echo BUILD FAILED with exit code %ERR%
    pause
    exit /b %ERR%
)

echo.
pause
exit /b 0
