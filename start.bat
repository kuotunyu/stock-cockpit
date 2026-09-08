@echo off
chcp 65001 >nul
REM 雙擊啟動；複雜流程由可測的 Node launcher 處理。
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Stock1] 找不到 Node.js。請先安裝 Node 24 LTS：https://nodejs.org/
  pause
  exit /b 1
)
node scripts/start-local.mjs
set "stock1_exit=%errorlevel%"
echo.
echo [Stock1] 伺服器已停止。若啟動失敗，請查看上方訊息。
pause
exit /b %stock1_exit%
