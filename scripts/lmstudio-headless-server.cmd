@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem =============================================================================
rem  LM Studio headless server (Windows)
rem  Docs: config/lmstudio-indexing.md
rem  Official: https://lmstudio.ai/docs/developer/core/headless
rem =============================================================================

rem --- Network ---
set "LMSTUDIO_PORT=1234"
set "LMSTUDIO_BIND=0.0.0.0"
rem Use 127.0.0.1 if Agentario on the same PC only.

rem --- Mode ---
rem restore = daemon up + server start (LM Studio restores last saved load state)
rem load    = unload all, load models below with explicit context, then start server
set "MODE=restore"

rem --- Explicit load (MODE=load only). Copy context values from LM Studio GUI. ---
set "CHAT_MODEL=qwen/qwen3.5-9b"
set "CHAT_CONTEXT=100100"
set "EMBED_MODEL=lfm2.5-embedding-350m"
set "EMBED_CONTEXT=20480"
rem EMBED_MODEL must have Domain Type = Embedding in My Models (see config/lmstudio-indexing.md)

rem --- Locate lms CLI ---
set "LMS=%USERPROFILE%\.lmstudio\bin\lms.exe"
if not exist "%LMS%" (
	set "LMS="
	for /f "delims=" %%I in ('where lms 2^>nul') do (
		if not defined LMS set "LMS=%%I"
	)
)
if not defined LMS (
	echo [ERROR] lms CLI not found.
	echo Install LM Studio and open it once, or run: irm https://lmstudio.ai/install.ps1 ^| iex
	exit /b 1
)

echo Using: %LMS%
echo Mode: %MODE%

echo.
echo ==^> Starting LM Studio daemon...
"%LMS%" daemon up
if errorlevel 1 (
	echo [ERROR] lms daemon up failed
	exit /b 1
)

if /I "%MODE%"=="load" (
	echo.
	echo ==^> Unloading all models...
	"%LMS%" unload --all --yes 2>nul

	echo ==^> Loading chat model: %CHAT_MODEL% (context %CHAT_CONTEXT%)...
	"%LMS%" load "%CHAT_MODEL%" --context-length %CHAT_CONTEXT% --yes
	if errorlevel 1 (
		echo [ERROR] Failed to load chat model
		exit /b 1
	)

	echo ==^> Loading embedding model: %EMBED_MODEL% (context %EMBED_CONTEXT%)...
	"%LMS%" load "%EMBED_MODEL%" --context-length %EMBED_CONTEXT% --yes
	if errorlevel 1 (
		echo [ERROR] Failed to load embedding model. Check Domain Type = Embedding in My Models.
		exit /b 1
	)
) else (
	echo.
	echo ==^> Restore mode: server will use last saved LM Studio load state.
	echo     Configure models once in GUI/CLI, then use MODE=restore on next boots.
)

echo.
echo ==^> Starting HTTP server on %LMSTUDIO_BIND%:%LMSTUDIO_PORT% ...
"%LMS%" server start --port %LMSTUDIO_PORT% --bind %LMSTUDIO_BIND%
if errorlevel 1 (
	echo [ERROR] lms server start failed
	exit /b 1
)

echo.
echo ==^> Loaded models:
"%LMS%" ps

echo.
echo ==^> Server status:
"%LMS%" server status

echo.
echo Done. API: http://127.0.0.1:%LMSTUDIO_PORT%
echo       LAN: http://^<this-pc-ip^>:%LMSTUDIO_PORT%
echo Agentario: LM Studio URL and embedding model in Code Index settings.

endlocal
exit /b 0
