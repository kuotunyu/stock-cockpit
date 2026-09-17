<#
.SYNOPSIS
  把「盤勢雷達本機伺服器（5174）」登記成 Windows 工作排程器的登入自動啟動工作（含守門），並立刻啟動一次。

.DESCRIPTION
  Zeabur 上線前的過渡方案：伺服器沒開的交易日不會有收盤快照，成績單就少一天。
  這支腳本登記一個「使用者登入時」觸發的工作：以無視窗方式（conhost --headless）常駐 scripts/stock1-watchdog.ps1（守門），
  守門每 10 分鐘看一次伺服器埠，沒在監聽就在專案目錄用 node 跑 server.mjs（視窗最小化）——
  當機、誤關視窗都會在 10 分鐘內拉回來。登記完立刻啟動一次並回報 5174 是否已在監聽。
  不需要系統管理員，只影響目前這個 Windows 帳號。

  伺服器與守門的訊息都寫在 DATA_DIR/logs/server-YYYYMMDD.log（保留 14 天），視窗關了也查得到。
  這是「登入才啟動」，電腦關機或沒登入時仍然不會採集；收盤排程也要電腦當時開著。
  要更新程式：git pull 後關掉「Stock1 server (5174)」視窗，再跑一次這支腳本（或等守門自己拉起新版）。

  檔案存成 UTF-8 with BOM：Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 會用系統 ANSI（Big5）解碼，中文會變亂碼、連語法都會壞。

.PARAMETER Unregister
  停止守門並移除這個工作（已在跑的伺服器視窗不受影響，要停伺服器請自己關視窗）。

.PARAMETER NoStart
  只登記，不立刻啟動。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/register-autostart.ps1
  powershell -ExecutionPolicy Bypass -File scripts/register-autostart.ps1 -Unregister
#>
param(
  [switch]$Unregister,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$taskName = "Stock1-server"
$root = Split-Path -Parent $PSScriptRoot
$watchdog = Join-Path $PSScriptRoot "stock1-watchdog.ps1"

function Test-Listening5174 {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)
}

if ($Unregister) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.State -eq "Running") { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("[Stock1] 已停止守門並移除工作排程「{0}」（已在跑的伺服器視窗不受影響）。" -f $taskName)
  } else {
    Write-Host ("[Stock1] 沒有找到工作排程「{0}」。" -f $taskName)
  }
  exit 0
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Write-Host "[Stock1] 找不到 Node.js，請先安裝 Node 24 LTS：https://nodejs.org/"
  exit 1
}
if (-not (Test-Path $watchdog)) {
  Write-Host ("[Stock1] 找不到守門腳本 {0}，請先 git pull。" -f $watchdog)
  exit 1
}

# 登入時以「完全沒有視窗」的方式常駐守門腳本；伺服器本身由守門用 start "…" /min 另開最小化視窗跑（日誌看得到、不擋畫面）。
# 用 conhost --headless 而不是 powershell -WindowStyle Hidden：預設終端機是 Windows Terminal 的電腦（Windows 11 預設）
# 不理會 Hidden，登入後會多一個一直開著的空白終端機視窗，關掉它守門就沒了（2026-09-17 使用者回報）。
$argument = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $watchdog + '"'
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument $argument -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# 已在跑的舊守門（可能是看得到的那個空白視窗）先停掉，下面用新設定重新啟動；伺服器若跟著被停，新守門第一輪就會拉起來。
$running = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($running -and $running.State -eq "Running") {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

Register-ScheduledTask -TaskName $taskName -Description "盤勢雷達本機伺服器：登入時啟動守門，每 10 分鐘確認 5174 在跑、掛了就重新啟動（Zeabur 上線前的過渡方案）" `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host ("[Stock1] 已登記工作排程「{0}」：登入 Windows 時在 {1} 啟動守門，每 10 分鐘確認伺服器在跑。" -f $taskName, $root)

if ($NoStart) { exit 0 }

if (Test-Listening5174) {
  $owner = (Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)[0].OwningProcess
  Write-Host ("[Stock1] 5174 已經有伺服器在跑（PID {0}），這次不再啟動。" -f $owner)
}

$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -eq "Running") {
  # 守門已經常駐（上次登入啟動的）：不重啟它，伺服器沒在跑就直接用守門的單次模式立刻拉起來。
  if (-not (Test-Listening5174)) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watchdog -Once }
} else {
  # 第一次登記或守門不在：啟動工作（守門第一輪就會啟動伺服器）。
  Start-ScheduledTask -TaskName $taskName
  $deadline = (Get-Date).AddSeconds(40)
  do { Start-Sleep -Seconds 2 } until ((Test-Listening5174) -or ((Get-Date) -gt $deadline))
}

if (Test-Listening5174) {
  Write-Host "[Stock1] 伺服器已在 http://127.0.0.1:5174 監聽；守門每 10 分鐘會再確認一次。瀏覽器按 Ctrl+F5 更新外殼。"
} else {
  Write-Host ("[Stock1] 40 秒內沒看到 5174 監聽；請看最小化的「Stock1 server (5174)」視窗，或 {0} 裡今天的 server-*.log。" -f (Join-Path $root ".data\logs"))
  exit 1
}
