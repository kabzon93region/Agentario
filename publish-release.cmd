@echo off
chcp 65001 >nul
setlocal

rem Publish Agentario to GitHub: commit, tag, gh release + VSIX
rem Docs: config/RELEASE.md

set "AGENTARIO_SRC=%~dp0"
if "%AGENTARIO_SRC:~-1%"=="\" set "AGENTARIO_SRC=%AGENTARIO_SRC:~0,-1%"

echo Source: %AGENTARIO_SRC%
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-release.ps1"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
	echo.
	echo PUBLISH FAILED with exit code %ERR%
	echo See config/RELEASE.md
)

echo.
pause
exit /b %ERR%
