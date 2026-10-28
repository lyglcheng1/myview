@echo off
rem ------------------------------------------------------------------
rem Vela project launcher for Windows.
rem - Installs dependencies automatically when node_modules is missing.
rem - Default action (15s timeout): start the Vite playground on :5190.
rem - Add new npm scripts to the menu below when they become available
rem   (e.g. desktop:dev once desktop/ is set up).
rem ------------------------------------------------------------------
setlocal enabledelayedexpansion
chcp 65001 >nul
title Vela Project Launcher

cd /d "%~dp0"

echo.
echo ==========================================
echo   Vela Project Launcher
echo   Root: %~dp0
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Please install Node.js first: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] node_modules not found - running npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed.
    echo.
)

:menu
echo.
echo ==========================================
echo   What would you like to do?
echo.
echo   1. Playground  - Vite dev server (http://localhost:5190)
echo   2. Typecheck   - tsc --noEmit
echo   3. Lint        - eslint .
echo   4. Test        - vitest run
echo   5. Build       - tsup (produces dist/)
echo   6. Exit
echo ==========================================
echo.
choice /c 123456 /n /t 15 /d 1 /m "Select 1-6 (default: 1 in 15s): "
set "act=%errorlevel%"
echo.

if "%act%"=="1" (
    echo [RUN] npm run playground
    echo.
    call npm run playground
) else if "%act%"=="2" (
    echo [RUN] npm run typecheck
    echo.
    call npm run typecheck
) else if "%act%"=="3" (
    echo [RUN] npm run lint
    echo.
    call npm run lint
) else if "%act%"=="4" (
    echo [RUN] npm test
    echo.
    call npm test
) else if "%act%"=="5" (
    echo [RUN] npm run build
    echo.
    call npm run build
) else (
    goto :eof
)

echo.
if errorlevel 1 (
    echo [FAILED] Command exited with an error. Check the output above.
) else (
    echo [OK] Command completed successfully.
)
echo.
choice /c YN /m "Back to menu? (Y/N): "
if errorlevel 2 exit /b 0
goto :menu