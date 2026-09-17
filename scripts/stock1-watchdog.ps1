<#
.SYNOPSIS
  盤勢雷達本機伺服器的守門：每 10 分鐘看一次伺服器埠有沒有在監聽，沒有就在背景重新啟動（沒有視窗）。

.DESCRIPTION
  由 scripts/register-autostart.ps1 登記的工作排程「Stock1-server」在登入時以無視窗方式（conhost --headless）啟動這支腳本，之後常駐。
  伺服器當機、或登入時 node 還沒裝好，10 分鐘內會再試一次；每次啟動都寫進
  DATA_DIR/logs/server-YYYYMMDD.log（跟 server.mjs 自己的日誌同一個檔），事後看得出「什麼時候掛、什麼時候被拉起來」。

  只認 .env 裡的 PORT 與 DATA_DIR（跟 server.mjs 同一份設定）；沒有 .env 就是 5174 與 .data。
  伺服器和守門都沒有視窗。要暫停：register-autostart.ps1 -Stop；要移除自動啟動：register-autostart.ps1 -Unregister。

  檔案存成 UTF-8 with BOM：Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 會用系統 ANSI（Big5）解碼，中文會變亂碼、連語法都會壞。

.PARAMETER IntervalSeconds
  檢查間隔（秒），預設 600。

.PARAMETER Once
  只檢查一次就結束（register-autostart.ps1 的「立刻啟動」與手動排錯用）。

.PARAMETER Port
  覆寫 .env 的 PORT，只給測試與排錯用（不碰正式 5174）。

.PARAMETER DataDir
  覆寫 .env 的 DATA_DIR（日誌寫到這裡），只給測試與排錯用。
#>
param(
  [int]$IntervalSeconds = 600,
  [switch]$Once,
  [int]$Port = 0,
  [string]$DataDir = ""
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

function Read-DotEnvValue($name, $default) {
  $envFile = Join-Path $root ".env"
  if (-not (Test-Path $envFile)) { return $default }
  foreach ($line in Get-Content $envFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    $eq = $trimmed.IndexOf("=")
    if ($eq -lt 1) { continue }
    if ($trimmed.Substring(0, $eq).Trim() -ne $name) { continue }
    $value = $trimmed.Substring($eq + 1).Trim()
    $value = $value -replace '^"(.*)"$', '$1'
    $value = $value -replace "^'(.*)'$", '$1'
    if ($value -eq "") { return $default }
    return $value
  }
  return $default
}

# PowerShell 變數不分大小寫：$Port 與 $port 是同一個，參數沒給才讀 .env。
if (-not $Port) { $Port = [int](Read-DotEnvValue "PORT" "5174") }
if (-not $DataDir) { $DataDir = Read-DotEnvValue "DATA_DIR" ".data" }
if (-not [System.IO.Path]::IsPathRooted($DataDir)) { $DataDir = Join-Path $root $DataDir }
$logDir = Join-Path $DataDir "logs"

# 同一個埠只允許一個常駐守門（2026-09-17：重新登記時舊守門變成孤兒，出現兩個守門同時在跑）。
# 用具名 mutex：程序結束（含被強制終止）時 Windows 自動釋放。-Once 是登記腳本手動拉起伺服器用的，不搶鎖。
if (-not $Once) {
  $script:guardMutex = New-Object System.Threading.Mutex($false, ("Local\Stock1-watchdog-{0}" -f $port))
  $acquired = $false
  try { $acquired = $script:guardMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { exit 0 }
}

function Write-GuardLog($text) {
  try {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $line = "{0} GUARD {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    Add-Content -Path (Join-Path $logDir ("server-{0}.log" -f (Get-Date -Format "yyyyMMdd"))) -Value $line -Encoding UTF8
  } catch { }
}

function Test-ServerListening {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Start-Stock1Server {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    Write-GuardLog "找不到 node.exe，無法啟動伺服器（請安裝 Node 24 LTS）"
    return $false
  }
  # 沒有視窗（2026-09-17 使用者：「不想每次開機都看到怪東西」）。主控台輸出沒人看，伺服器訊息都在 DATA_DIR/logs 的日誌檔。
  # 用 conhost --headless 而不是 -WindowStyle Hidden：預設終端機是 Windows Terminal 時 Hidden 會被忽略。
  # 伺服器程序是獨立的：停掉守門不會連帶停掉伺服器。
  $argument = '--headless "' + $nodeCommand.Source + '" --env-file-if-exists=.env server.mjs'
  Start-Process -FilePath "conhost.exe" -ArgumentList $argument -WorkingDirectory $root
  return $true
}

do {
  if (-not (Test-ServerListening)) {
    Write-GuardLog ("{0} 沒在監聽，啟動伺服器" -f $port)
    if (Start-Stock1Server) {
      $deadline = (Get-Date).AddSeconds(30)
      do { Start-Sleep -Seconds 2 } until ((Test-ServerListening) -or ((Get-Date) -gt $deadline))
      if (Test-ServerListening) {
        Write-GuardLog ("伺服器已在 http://127.0.0.1:{0} 監聽" -f $port)
      } else {
        Write-GuardLog ("30 秒內沒看到 {0} 監聽；請看這份日誌裡 server.mjs 的訊息，{1} 秒後再試" -f $port, $IntervalSeconds)
      }
    }
  }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)
