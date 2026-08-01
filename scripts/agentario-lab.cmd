@echo off
setlocal
:: Agentario Lab CLI ? control test VS Code instance via REST API or harness
:: Usage: agentario-lab.cmd <command> [args...]
::
:: Commands:
::   start   [--workspace PATH] [--vsix PATH] [--skip-build] [--auto-launch] [--visible]
::   status
::   new-task "text"
::   followup "text"
::   wait-idle [--timeout MS]
::   get-messages [--count N]
::   export [outPath]
::   export-context [outPath]
::   collect [outDir]
::   run --text "..." [--workspace PATH] [--timeout MS] [--outDir PATH]
::   screenshot
::   stop

set "SCRIPT_DIR=%~dp0"
set "HARNESS_PORT=19229"
set "HARNESS_URL=http://localhost:%HARNESS_PORT%/api"
set "API_PORT=19231"
set "API_URL=http://localhost:%API_PORT%"

:: Route command
if "%~1"=="" goto :usage
if "%~1"=="start" goto :start
if "%~1"=="status" goto :status
if "%~1"=="new-task" goto :newtask
if "%~1"=="followup" goto :followup
if "%~1"=="wait-idle" goto :waitidle
if "%~1"=="get-messages" goto :getmessages
if "%~1"=="export" goto :export
if "%~1"=="export-context" goto :exportctx
if "%~1"=="collect" goto :collect
if "%~1"=="run" goto :run
if "%~1"=="screenshot" goto :screenshot
if "%~1"=="stop-agent" goto :stopagent
if "%~1"=="clear" goto :clear
if "%~1"=="delete-task" goto :deletetask
if "%~1"=="stop" goto 
:stopagent
curl -s -X POST "%API_URL%/api/stop" -H "Content-Type: application/json" -d "{}" & echo.
goto :eof

:clear
curl -s -X POST "%API_URL%/api/clear" -H "Content-Type: application/json" -d "{}" & echo.
goto :eof

:deletetask
if "%~2"=="" (
  curl -s -X POST "%API_URL%/api/delete_task" -H "Content-Type: application/json" -d "{}" & echo.
) else (
  curl -s -X POST "%API_URL%/api/delete_task" -H "Content-Type: application/json" -d "{\"taskId\":\"%~2\"}" & echo.
)
goto :eof

:stop
echo Unknown command: %~1
goto :usage

:start
set "SERVER_ARGS=--auto-launch --port %HARNESS_PORT%"
shift
:parse_start
if "%~1"=="" goto :do_start
if "%~1"=="--workspace" ( set "SERVER_ARGS=%SERVER_ARGS% --workspace %~2" & shift & shift & goto :parse_start )
if "%~1"=="--vsix" ( set "SERVER_ARGS=%SERVER_ARGS% --vsix %~2" & shift & shift & goto :parse_start )
if "%~1"=="--skip-build" ( set "SERVER_ARGS=%SERVER_ARGS% --skip-build" & shift & goto :parse_start )
if "%~1"=="--visible" ( set "SERVER_ARGS=%SERVER_ARGS% --visible" & shift & goto :parse_start )
if "%~1"=="--auto-launch" ( shift & goto :parse_start )
set "SERVER_ARGS=%SERVER_ARGS% %~1"
shift
goto :parse_start

:do_start
echo Starting Agentario Lab harness on port %HARNESS_PORT%...
start "Agentario-Lab-Harness" bun "%SCRIPT_DIR%..\apps\vscode\src\dev\debug-harness\server.ts" %SERVER_ARGS%
echo Harness starting. Use 'agentario-lab.cmd status' to check.
goto :eof

:status
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 ( curl -s "%API_URL%/api/status" & echo. & goto :eof )
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.status\"}" & echo.
goto :eof

:newtask
if "%~2"=="" ( echo Usage: agentario-lab.cmd new-task "text" & exit /b 1 )
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 ( curl -s -X POST "%API_URL%/api/new_task" -H "Content-Type: application/json" -d "{\"text\":\"%~2\"}" & echo. & goto :eof )
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.new_task\",\"params\":{\"text\":\"%~2\"}}" & echo.
goto :eof

:followup
if "%~2"=="" ( echo Usage: agentario-lab.cmd followup "text" & exit /b 1 )
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 ( curl -s -X POST "%API_URL%/api/followup" -H "Content-Type: application/json" -d "{\"text\":\"%~2\"}" & echo. & goto :eof )
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.followup\",\"params\":{\"text\":\"%~2\"}}" & echo.
goto :eof

:waitidle
set "TIMEOUT=600000"
shift
:parse_wait
if "%~1"=="" goto :do_wait
if "%~1"=="--timeout" ( set "TIMEOUT=%~2" & shift & shift & goto :parse_wait )
shift
goto :parse_wait
:do_wait
echo Waiting for idle (timeout: %TIMEOUT%ms)...
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 ( curl -s "%API_URL%/api/wait_idle?timeout=%TIMEOUT%" & echo. & goto :eof )
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.wait_idle\",\"params\":{\"timeout\":%TIMEOUT%}}" & echo.
goto :eof

:getmessages
set "COUNT=50"
shift
:parse_msgs
if "%~1"=="" goto :do_msgs
if "%~1"=="--count" ( set "COUNT=%~2" & shift & shift & goto :parse_msgs )
shift
goto :parse_msgs
:do_msgs
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 ( curl -s "%API_URL%/api/messages?limit=%COUNT%" & echo. & goto :eof )
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.get_messages\",\"params\":{\"count\":%COUNT%}}" & echo.
goto :eof

:export
set "OUTPATH=%~2"
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 (
    if "%OUTPATH%"=="" ( curl -s "%API_URL%/api/export_chat" ) else ( set "OUTPATH=%OUTPATH:\=/%" & curl -s "%API_URL%/api/export_chat?outPath=%OUTPATH%" )
    echo. & goto :eof
)
if "%OUTPATH%"=="" ( curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.export_chat\"}" ) else ( set "OUTPATH=%OUTPATH:\=/%" & curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.export_chat\",\"params\":{\"outPath\":\"%OUTPATH%\"}}" )
echo.
goto :eof

:exportctx
set "OUTPATH=%~2"
curl -s "%API_URL%/health" >nul 2>nul
if not errorlevel 1 (
    if "%OUTPATH%"=="" ( curl -s "%API_URL%/api/context" ) else ( curl -s "%API_URL%/api/context" > "%OUTPATH%" )
    echo. & goto :eof
)
if "%OUTPATH%"=="" ( curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.export_context\"}" ) else ( set "OUTPATH=%OUTPATH:\=/%" & curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.export_context\",\"params\":{\"outPath\":\"%OUTPATH%\"}}" )
echo.
goto :eof

:collect
set "OUTDIR=%~2"
if "%OUTDIR%"=="" ( curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.collect_session_files\"}" ) else ( set "OUTDIR=%OUTDIR:\=/%" & curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.collect_session_files\",\"params\":{\"outDir\":\"%OUTDIR%\"}}" )
echo.
goto :eof

:run
set "RUN_TEXT=" & set "RUN_WORKSPACE=" & set "RUN_TIMEOUT=" & set "RUN_OUTDIR="
shift
:parse_run
if "%~1"=="" goto :do_run
if "%~1"=="--text" ( set "RUN_TEXT=%~2" & shift & shift & goto :parse_run )
if "%~1"=="--workspace" ( set "RUN_WORKSPACE=%~2" & shift & shift & goto :parse_run )
if "%~1"=="--timeout" ( set "RUN_TIMEOUT=%~2" & shift & shift & goto :parse_run )
if "%~1"=="--outDir" ( set "RUN_OUTDIR=%~2" & shift & shift & goto :parse_run )
shift
goto :parse_run
:do_run
if "%RUN_TEXT%"=="" ( echo Usage: agentario-lab.cmd run --text "task" [--workspace PATH] [--timeout MS] [--outDir PATH] & exit /b 1 )
set "RUN_WORKSPACE=%RUN_WORKSPACE:\=/%" & set "RUN_OUTDIR=%RUN_OUTDIR:\=/%"
echo Running full automation cycle...
set "JSON_PARAMS={\"text\":\"%RUN_TEXT%\""
if not "%RUN_WORKSPACE%"=="" set "JSON_PARAMS=%JSON_PARAMS%,\"workspace\":\"%RUN_WORKSPACE%\""
if not "%RUN_TIMEOUT%"=="" set "JSON_PARAMS=%JSON_PARAMS%,\"timeout\":%RUN_TIMEOUT%"
if not "%RUN_OUTDIR%"=="" set "JSON_PARAMS=%JSON_PARAMS%,\"outDir\":\"%RUN_OUTDIR%\""
set "JSON_PARAMS=%JSON_PARAMS%}"
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.run\",\"params\":%JSON_PARAMS%}" & echo.
goto :eof

:screenshot
curl -s "%HARNESS_URL%" -d "{\"method\":\"lab.screenshot\"}" & echo.
goto :eof


:stopagent
curl -s -X POST "%API_URL%/api/stop" -H "Content-Type: application/json" -d "{}" & echo.
goto :eof

:clear
curl -s -X POST "%API_URL%/api/clear" -H "Content-Type: application/json" -d "{}" & echo.
goto :eof

:deletetask
if "%~2"=="" (
  curl -s -X POST "%API_URL%/api/delete_task" -H "Content-Type: application/json" -d "{}" & echo.
) else (
  curl -s -X POST "%API_URL%/api/delete_task" -H "Content-Type: application/json" -d "{\"taskId\":\"%~2\"}" & echo.
)
goto :eof

:stop
curl -s "%HARNESS_URL%" -d "{\"method\":\"shutdown\"}" & echo.
goto :eof

:usage
echo Agentario Lab CLI ? control test VS Code instance via REST API or harness
echo.
echo Usage: agentario-lab.cmd ^<command^> [args...]
echo.
echo Commands:
echo   start    [--workspace PATH] [--vsix PATH] [--skip-build]  Start harness + VS Code
echo   status                                                  Show lab status
echo   new-task "text"                                         Create a new task/chat
echo   followup "text"                                         Send followup response
echo   wait-idle [--timeout MS]                                Wait for agent idle
echo   get-messages [--count N]                                Get recent messages
echo   export [outPath]                                        Export chat to markdown
echo   export-context [outPath]                                Export model context
echo   collect [outDir]                                        Collect session files
echo   run --text "..." [--workspace] [--timeout] [--outDir]   Full automation cycle
echo   screenshot                                              Take sidebar screenshot
echo   stop                                                    Shutdown harness
echo.
echo Extension API: %API_PORT% / Harness: %HARNESS_PORT%
goto :eof
