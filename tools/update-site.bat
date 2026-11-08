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
echo.>> "%LOG%"
echo [%date% %time%] run start>> "%LOG%"

node tools\sync-linuxdo.mjs>> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] sync failed, aggregator offline? skip git>> "%LOG%"
  exit /b 0
)

git add -A>> "%LOG%" 2>&1
git diff --cached --quiet
if not errorlevel 1 (
  echo [%date% %time%] no change>> "%LOG%"
  exit /b 0
)

git commit -m "auto: sync netdisk resources">> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] commit failed>> "%LOG%"
  exit /b 0
)

if "%AUTO_PUSH%"=="0" (
  echo [%date% %time%] committed, push skipped by AUTO_PUSH=0>> "%LOG%"
  exit /b 0
)

git push origin main>> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] push failed (check git credential / remote)>> "%LOG%"
) else (
  echo [%date% %time%] pushed>> "%LOG%"
)
exit /b 0
