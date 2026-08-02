@echo off
echo Stopping ccc daemon...
taskkill /F /IM ccc.exe 2>nul
timeout /t 2 /nobreak >nul

echo Removing old cocoindex DB from project root...
if exist "Z:\T\Agentario\.cocoindex_code\cocoindex.db" (
    rmdir /S /Q "Z:\T\Agentario\.cocoindex_code\cocoindex.db"
    echo   cocoindex.db removed.
)
if exist "Z:\T\Agentario\.cocoindex_code\target_sqlite.db" (
    del /F "Z:\T\Agentario\.cocoindex_code\target_sqlite.db"
    echo   target_sqlite.db removed.
)

echo.
echo Verifying new isolated location:
dir "C:\Users\Admin\.MCP\cocoindex-code\Agentario\db" 2>nul

echo.
echo Done! settings.yml kept at project root for ccc init.
pause
