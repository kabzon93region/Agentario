@echo off
rem Запуск лабораторного VS Code с изолированным профилем Agentario
rem Использование: scripts\start-lab.cmd
setlocal
set "AGENTARIO_API_PORT=19231"
set "CLINE_DIR=C:\Users\Admin\.agentario-lab"
code "S:\temo"
endlocal
