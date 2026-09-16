<#
.SYNOPSIS
  把「盤勢雷達本機伺服器（5174）」登記成 Windows 工作排程器的登入自動啟動工作，並立刻啟動一次。

.DESCRIPTION
  Zeabur 上線前的過渡方案：伺服器沒開的交易日不會有收盤快照，成績單就少一天。
  這支腳本只做三件事：登記一個「使用者登入時」觸發的工作（在專案目錄用 node 跑 server.mjs、視窗最小化）、
  立刻啟動它、回報 5174 是否已在監聽。不需要系統管理員，只影響目前這個 Windows 帳號。

  這是「登入才啟動」，電腦關機或沒登入時仍然不會採集；13:35 的收盤排程也要電腦當時開著。

  檔案存成 UTF-8 with BOM：Windows PowerShell 5.1 讀沒有 BOM 的 .ps1 會用系統 ANSI（Big5）解碼，中文會變亂碼、連語法都會壞。

.PARAMETER Unregister
  移除這個工作（不會停止已在跑的伺服器）。

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

if ($Unregister) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("[Stock1] 已移除工作排程「{0}」（已在跑的伺服器不受影響）。" -f $taskName)
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
$node = $nodeCommand.Source

# start "…" /min：另開一個最小化的主控台視窗跑伺服器，日誌看得到、也不會擋住登入畫面。
$argument = '/c start "Stock1 server (5174)" /min "' + $node + '" --env-file-if-exists=.env server.mjs'
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $argument -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Description "盤勢雷達本機伺服器：登入時自動啟動 5174（Zeabur 上線前的過渡方案）" `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host ("[Stock1] 已登記工作排程「{0}」：登入 Windows 時自動在 {1} 啟動伺服器。" -f $taskName, $root)

if ($NoStart) { exit 0 }

$listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 5174 }
if ($listening) {
  Write-Host ("[Stock1] 5174 已經有伺服器在跑（PID {0}），這次不再啟動。" -f $listening[0].OwningProcess)
  exit 0
}

Start-ScheduledTask -TaskName $taskName
$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Seconds 2
  $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 5174 }
} until ($listening -or (Get-Date) -gt $deadline)

if ($listening) {
  Write-Host "[Stock1] 伺服器已在 http://127.0.0.1:5174 監聽。瀏覽器按 Ctrl+F5 更新外殼。"
} else {
  Write-Host "[Stock1] 20 秒內沒看到 5174 監聽；請看最小化的「Stock1 server (5174)」視窗裡的訊息。"
  exit 1
}
