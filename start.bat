@echo off
REM 雙擊即可啟動的捷徑：省掉「開終端機 → cd 到資料夾 → npm start」這三步。
REM 想放到桌面的話，對這個檔按右鍵 → 傳送到 → 桌面（建立捷徑）。
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Stock1] 找不到 Node.js。請先安裝 Node 24 LTS：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Stock1] 第一次啟動，正在安裝相依套件...
  call npm install
  if errorlevel 1 (
    echo.
    echo [Stock1] npm install 失敗，請把上面的錯誤訊息貼出來。
    echo.
    pause
    exit /b 1
  )
)

REM 先開瀏覽器再啟動伺服器：伺服器會佔住這個視窗，之後的指令不會執行。
REM 頁面可能比伺服器早零點幾秒開起來，重整一次即可。
start "" "http://127.0.0.1:5174"
node --env-file-if-exists=.env server.mjs

REM 跑到這裡代表伺服器結束了（Ctrl+C 或發生錯誤）——留住視窗讓訊息看得到。
echo.
echo [Stock1] 伺服器已停止。
pause
