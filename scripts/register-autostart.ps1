<#
.SYNOPSIS
  把「盤勢雷達本機伺服器（5174）」登記成 Windows 工作排程器的登入自動啟動工作（含守門），並立刻啟動一次。

.DESCRIPTION
  Zeabur 上線前的過渡方案：伺服器沒開的交易日不會有收盤快照，成績單就少一天。
  這支腳本登記一個「使用者登入時」觸發的工作：以無視窗方式（conhost --headless）常駐 scripts/stock1-watchdog.ps1（守門），
  守門每 10 分鐘看一次伺服器埠，沒在監聽就在專案目錄用 node 跑 server.mjs——
  伺服器和守門都沒有視窗，當機也會在 10 分鐘內拉回來。登記完立刻啟動一次並回報 5174 是否已在監聽。
  不需要系統管理員，只影響目前這個 Windows 帳號。

  伺服器與守門的訊息都寫在 DATA_DIR/logs/server-YYYYMMDD.log（保留 14 天）。
  這是「登入才啟動」，電腦關機或沒登入時仍然不會採集；收盤排程也要電腦當時開著。
  要更新程式：git pull 後跑這支腳本加 -Restart（等寫入落盤、停掉舊伺服器、用新程式重新啟動）。

  檔案存成 UTF-8 with BOM：Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 會用系統 ANSI（Big5）解碼，中文會變亂碼、連語法都會壞。

.PARAMETER Unregister
  移除自動啟動：停掉守門與伺服器，並刪除這個工作排程。

.PARAMETER Stop
  暫停：停掉守門與伺服器（等寫入落盤），工作排程保留，下次登入 Windows 會自動恢復。手動備份前用這個。

.PARAMETER NoStart
  只登記，不立刻啟動。

.PARAMETER Restart
  程式更新後用：等伺服器手上的寫入都落盤，停掉正在跑的舊伺服器，再用目前的程式重新啟動。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/register-autostart.ps1
  powershell -ExecutionPolicy Bypass -File scripts/register-autostart.ps1 -Restart
  powershell -ExecutionPolicy Bypass -File scripts/register-autostart.ps1 -Stop
  powershell -ExecutionPolicy Bypass -File scripts/register-autostart.ps1 -Unregister
#>
param(
  [switch]$Unregister,
  [switch]$NoStart,
  [switch]$Restart,
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$taskName = "Stock1-server"
$root = Split-Path -Parent $PSScriptRoot
$watchdog = Join-Path $PSScriptRoot "stock1-watchdog.ps1"

function Test-Listening5174 {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)
}

# 停掉所有常駐守門。工作排程的程序是 conhost，守門 powershell 是它的子程序：Stop-ScheduledTask 只收掉 conhost，
# 守門會變成孤兒繼續跑（2026-09-17 實際出現兩個），所以另外照命令列找出來停。-Once 的單次檢查不算。
function Stop-Stock1Watchdogs {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq "Running") { $null = Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
  $guards = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*stock1-watchdog.ps1*" -and $_.CommandLine -notlike "*-Once*" -and $_.ProcessId -ne $PID })
  foreach ($guard in $guards) { Stop-Process -Id $guard.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($guards.Count) { Start-Sleep -Seconds 1 }
  return $guards.Count
}

# 停掉正在跑的盤勢雷達伺服器，讓新程式接手。回傳 "stopped"／"not-running"／"foreign"／"busy"。
# 先等 /api/health 的 pendingWrites 歸零（最多 15 秒）才停：資料檔是原子寫入，停在兩次寫入之間不會壞檔也不會丟資料。
# 以前的做法是「關掉視窗」，那對 node 等同直接終止，這裡至少多了一道「沒有寫到一半」的確認。
function Stop-Stock1Server([int]$Port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return "not-running" }
  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $conn.OwningProcess) -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.Name -ne "node.exe" -or $proc.CommandLine -notlike "*server.mjs*") { return "foreign" }
  $idle = $false
  for ($i = 0; $i -lt 15; $i++) {
    try {
      $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 3
      if ([int]$health.persistence.pendingWrites -eq 0) { $idle = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $idle) { return "busy" }
  Stop-Process -Id $conn.OwningProcess -Force
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 300 }
  return "stopped"
}

# 伺服器沒有視窗，停它只能靠指令：-Stop（暫停，下次登入恢復）與 -Unregister（移除自動啟動）共用這段。先停守門，免得它把伺服器拉回來。
function Stop-Stock1All {
  $null = Stop-Stock1Watchdogs
  switch (Stop-Stock1Server 5174) {
    "stopped" { Write-Host "[Stock1] 已停止伺服器（寫入都已落盤）。" }
    "not-running" { Write-Host "[Stock1] 5174 沒有伺服器在跑。" }
    "foreign" { Write-Host "[Stock1] 5174 被別的程式占用，不是盤勢雷達伺服器，不動它。" }
    "busy" { Write-Host "[Stock1] 伺服器還有資料在寫入（或 15 秒內沒回應），這次沒有停它；守門已停，稍後再跑一次。"; exit 1 }
  }
}

if ($Stop) {
  Stop-Stock1All
  Write-Host "[Stock1] 已暫停。下次登入 Windows 會自動恢復；要立刻恢復請跑這支腳本（不加參數）。"
  exit 0
}

if ($Unregister) {
  Stop-Stock1All
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("[Stock1] 已移除工作排程「{0}」，之後登入不會再自動啟動。" -f $taskName)
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

# 登入時以「完全沒有視窗」的方式常駐守門腳本；伺服器本身也由守門以沒有視窗的方式啟動，訊息在日誌檔。
# 用 conhost --headless 而不是 powershell -WindowStyle Hidden：預設終端機是 Windows Terminal 的電腦（Windows 11 預設）
# 不理會 Hidden，登入後會多一個一直開著的空白終端機視窗，關掉它守門就沒了（2026-09-17 使用者回報）。
$argument = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $watchdog + '"'
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument $argument -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# 舊守門（含重新登記後留下的孤兒）全部停掉，下面用新設定重新啟動；守門停掉不影響已在跑的伺服器。
$stoppedGuards = Stop-Stock1Watchdogs
if ($stoppedGuards -gt 1) { Write-Host ("[Stock1] 清掉 {0} 個守門程序（其中有舊版登記腳本留下的重複守門）。" -f $stoppedGuards) }

Register-ScheduledTask -TaskName $taskName -Description "盤勢雷達本機伺服器：登入時啟動守門，每 10 分鐘確認 5174 在跑、掛了就重新啟動（Zeabur 上線前的過渡方案）" `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host ("[Stock1] 已登記工作排程「{0}」：登入 Windows 時在 {1} 啟動守門，每 10 分鐘確認伺服器在跑。" -f $taskName, $root)

if ($NoStart) { exit 0 }

if ($Restart) {
  switch (Stop-Stock1Server 5174) {
    "stopped" { Write-Host "[Stock1] 已停止舊的伺服器，接著用目前的程式重新啟動。" }
    "not-running" { Write-Host "[Stock1] 5174 沒有伺服器在跑，直接啟動。" }
    "foreign" { Write-Host "[Stock1] 5174 被別的程式占用，不是盤勢雷達伺服器，不動它。"; exit 1 }
    "busy" { Write-Host "[Stock1] 伺服器還有資料在寫入（或 15 秒內沒回應），這次不重啟，守門照常運作；稍後再跑一次。"; Start-ScheduledTask -TaskName $taskName; exit 1 }
  }
}

if (Test-Listening5174) {
  $owner = (Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue)[0].OwningProcess
  Write-Host ("[Stock1] 5174 已經有伺服器在跑（PID {0}），這次不重啟它。程式更新後要換新版，請加 -Restart 再跑一次。" -f $owner)
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
  Write-Host "[Stock1] 伺服器已在 http://127.0.0.1:5174 背景執行（沒有視窗）；守門每 10 分鐘會再確認一次。瀏覽器按 Ctrl+F5 更新外殼。"
} else {
  Write-Host ("[Stock1] 40 秒內沒看到 5174 監聽；請看 {0} 裡今天的 server-*.log。" -f (Join-Path $root ".data\logs"))
  exit 1
}
