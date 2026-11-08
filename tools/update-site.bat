@echo off
setlocal enableextensions
rem ============================================================
rem  资源AI小站 · 自动更新
rem  1) 从聚合站拉取 LINUX DO 网盘资源并整理
rem  2) 重算 updates.json
rem  3) 提交并推送（GitHub Pages 自动重建）
rem  把 AUTO_PUSH 改成 0，就只整理+提交、不推送。
rem ============================================================
set "AUTO_PUSH=1"
set "ROOT=E:\codex_out\GROK\blog2"
set "LOG=%ROOT%\logs\update.log"

if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
cd /d "%ROOT%"
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format s"') do set "TS=%%i"
echo.>> "%LOG%"
echo [%TS%] run start>> "%LOG%"

node tools\sync-linuxdo.mjs>> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%TS%] sync failed, aggregator offline? skip git>> "%LOG%"
  exit /b 0
)

git add -A>> "%LOG%" 2>&1
git diff --cached --quiet
if not errorlevel 1 (
  echo [%TS%] no change>> "%LOG%"
  exit /b 0
)

git commit -m "auto: sync netdisk resources">> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%TS%] commit failed>> "%LOG%"
  exit /b 0
)

if "%AUTO_PUSH%"=="0" (
  echo [%TS%] committed, push skipped by AUTO_PUSH=0>> "%LOG%"
  exit /b 0
)

git push origin main>> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%TS%] push failed (check git credential / remote)>> "%LOG%"
) else (
  echo [%TS%] pushed>> "%LOG%"
)
exit /b 0
