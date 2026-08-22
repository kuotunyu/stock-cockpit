# stock-cockpit

[![CI](https://github.com/kuotunyu/stock-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/kuotunyu/stock-cockpit/actions/workflows/ci.yml)
![Node.js 22.13/24 LTS](https://img.shields.io/badge/Node.js-22.13%20%7C%2024%20LTS-339933?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/Runtime%20Deps-1-purple)
![PWA](https://img.shields.io/badge/PWA-Offline%20Shell-orange)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

本專案為無框架 (Framework-less) 實作之台股看盤終端與策略檢驗 Web 系統：整合 TWSE、TPEx 與期交所官方資料源，提供隔日沖與波段選股引擎（含收盤資料前向驗證）、技術分析指標、注意/處置股票看板、自選股與精確交易稅則帳本。後端採用單檔 Node.js 原生 `http` 模組 (`server.mjs`)，前端採用 Vanilla JS 單頁架構 (`app.js`)，執行期僅包含富邦行情 SDK 單一外部依賴。

> **免責聲明**：本專案為個人策略研究工具，所有訊號、統計與損益估算僅供參考，不構成任何投資建議或交易要約；實際交易費稅請以證券商對帳單為準。

---

## 系統介面

### 桌面版看盤終端

| 隔日沖訊號與前向驗證 | 策略雷達 (波段選股) |
|---|---|
| ![隔日沖](docs/assets/screen-overnight.png) | ![策略雷達](docs/assets/screen-strategy.png) |

| 技術分析繪圖 | 注意/處置股票看板 |
|---|---|
| ![技術分析](docs/assets/screen-technical.png) | ![處置看板](docs/assets/screen-surveillance.png) |

| 盤中動態篩選 |
|---|
| ![盤中選股](docs/assets/screen-screener.png) |

### 行動裝置 PWA 介面

<div align="center">

| PWA 行動裝置即時看盤 (390px 響應式介面) |
|:---:|
| <img src="docs/assets/screen-mobile.png" width="460" alt="PWA 行動版介面"> |

</div>

---

## 系統核心機制

1. **選股訊號每日前向驗證 (Forward Validation)**：
   隔日沖與波段選股訊號每日與官方收盤數據對齊後自動凍結正式快照；盤中即時計算結果明確標示為暫定，確保策略檢驗數據不被回溯竄改。
2. **交易帳本 v2 (Tax & Ledger Engine)**：
   商品與交易型態獨立建模，依成交日期自動套用有效日期化證交稅規則（估算值與券商實際值分離），歷史損益一經凍結維護不可變性 (Immutability)。
3. **Copy-on-Write 交易佇列與原子落盤**：
   持久化讀寫採用 Copy-on-Write Transaction Queue 進行隔離與寫入租約 (Writer Lease) 互斥，確保 JSON 資料庫落盤安全性，失敗自動回傳 `503`。
4. **誠實降級與資料品質警告 (Honest Degradation)**：
   官方上游 API 異動或單一市場失敗時自動調用 Last-Good 快取，並於回應附帶品質警告標記 (`warnings` / `dataQuality`)，絕不以過期數據偽裝為即時行情。
5. **全離線測試與 PWA 離線殼**：
   內建離線測試套件 (`node:test` + jsdom，零網路 Mock 上游)，搭配 PWA Network-First 離線殼，API 端點永不強行快取舊行情。

---

## 系統架構與流程

### 系統架構

```mermaid
%%{init: {'themeVariables': {'fontSize': '22px'}}}%%
flowchart TD
    UI["PWA 前端 (app.js / sw.js 離線殼)"] --> API["Node.js 原生 HTTP 網關 (server.mjs)"]
    API --> ENG["選股與策略前向驗證引擎"]
    API --> LEDGER["交易帳本 v2 (有效日期稅則)"]
    ENG & LEDGER --> Q["Copy-on-Write 交易佇列"]
    Q --> DB[("JSON 主資料庫 & 自動備份")]
    ENG --> UP["TWSE / TPEx / 期交所 官方資料源"]
    API -.-> FUBON["富邦行情 SDK (只讀行情)"]

    style Q fill:#fff9db,stroke:#f59f00,stroke-width:2px
```

### 交易佇列與寫入時序

```mermaid
%%{init: {'themeVariables': {'fontSize': '22px', 'actorFontSize': '20px', 'messageFontSize': '18px', 'noteFontSize': '18px'}}}%%
sequenceDiagram
    autonumber
    participant UI as 前端 Web / PWA
    participant API as Node.js HTTP 網關
    participant Queue as Copy-on-Write Queue
    participant DB as JSON 主資料庫 / 備份

    UI->>API: 1. 提交交易/帳本異動 (如: 新增買進紀錄)
    API->>Queue: 2. 派送寫入佇列 (取得 Writer Lease)
    Queue->>Queue: 3. 建立隔離 Draft 記憶體快照
    Queue->>DB: 4. 原子落盤 (.data/stock1-db.json & 14日Rolling備份)
    DB-->>Queue: 5. 寫入確認 (fsync)
    Note over Queue,DB: 確保資料庫寫入原子性<br/>若寫入失敗自動回滾並回傳 503
    Queue-->>API: 6. 發布新版資料庫快取
    API-->>UI: 7. 回應 200 OK 與更新後帳本損益
```

---

## 策略驗證與選股引擎

系統內建兩套獨立策略引擎，均配備官方數據對齊與歷史績效追蹤機制：

| 策略引擎模組 | 選股特徵與演算法 | 驗證機制與對答案邏輯 |
|---|---|---|
| **隔日沖選股引擎 (Overnight)** | 鎖定尾盤強勢動能、高周轉率與法人買超標的 | 每日收盤後自動抓取 TWSE/TPEx 正式數據對齊，凍結對答案成績單 |
| **波段選股雷達 (Swing Strategy)** | 均線多頭排列、量能突破、籌碼集中度與基本面篩選 | 支援自訂參數雷達掃描，歷史數據嚴格隔離不回溯修正 |
| **注意/處置股票看板** | 實時同步官方公告之注意股票、處置股票與全額交割股 | 自動識別處置期間與交易限制（如人工管制撮合時間） |

---

## 交易帳本 v2 稅則與損益試算

交易帳本引擎將商品與交易型態分開建模，並具備完整之台股費稅稽核機制：

- **有效日期化稅則**：依成交日期自動帶入台股證交稅率（普通股 `0.3%`、現股當沖 `0.15%`）。
- **券商手續費折讓**：支援手續費預設 `0.1425%` 與個自訂折扣設定（如 2.8 折、6 折）。
- **估算與實際值隔離**：將預估損益與券商實際對帳單分開存儲，歷史已結算筆數一旦凍結即不可變動。

---

## API 規格與模組分類

唯讀端點未登入即可使用；修改個人或共享資料之端點需通過身分驗證。

| 模組分類 | 主要 API 端點 | 功能說明 |
|---|---|---|
| **服務健康** | `GET /api/health`、`GET /api/app-version` | 系統狀態、上游資料品質警告與數據源連線稽核；本機 build commit 與 GitHub 更新比對 |
| **身分驗證** | `/api/auth/*`、`/api/admin/users` | 管理者帳號登入、Session 管理與權限控制 |
| **行情與大盤** | `/api/quotes`、`/api/markets`、`/api/technical-analysis` | 即時大盤、三大法人、融資融券與技術分析 K 線 |
| **選股引擎** | `/api/overnight*`、`/api/swing*` | 隔日沖、波段選股訊號與每日歷史前向驗證成績單 |
| **注意處置** | `/api/surveillance-board` | 官方注意股票、處置股票與全額交割即時看板 |
| **個人帳本** | `/api/watchlists`、`/api/alerts`、`/api/trades` | 自選股、到價提醒、交易帳本與備份匯出復原 |

---

## 快速開始

需求：Node.js 22.13+ 或 24+，**建議 Node 24 LTS**（Node 20 已於 2026-04-30 EOL，不再提供安全更新）。

### 1. 本地啟動

```powershell
git clone https://github.com/kuotunyu/stock-cockpit.git
cd stock-cockpit
npm install
npm start
```

啟動後開 <http://127.0.0.1:5174>。Windows 也可以直接雙擊專案根目錄的 **`start.bat`**（會自動補跑 `npm install` 並開好瀏覽器），把它「傳送到 → 桌面（建立捷徑）」就不用每次開終端機。

**第一次啟動的預設帳號是 `admin` / `admin1234`**（只在資料庫是空的時候種下去）。登入後請到「更多 → 帳號管理」改掉；沒改的話畫面上會一直有提示。只在自己這台電腦上用（預設綁 `127.0.0.1`，外面連不進來）不改也不會有事，但一旦要對外開放就必須先改。

### 2. 更新到最新版

```powershell
git pull
npm install
```

改到後端（`server.mjs`）必須**重新啟動伺服器**（Node 不會熱載）；只改前端的話瀏覽器 **Ctrl+F5** 一次即可。不確定自己是不是舊版，就到「更多 → 版本與更新」看——那裡會顯示這台跑的 commit，並跟 GitHub 上的最新版比對。

### 3. 從手機／平板看盤（同一個 Wi-Fi）

先在 `.env` 設好強度足夠的密碼與密鑰（對外開放時伺服器會強制檢查，沒設就拒絕啟動），再用 LAN 模式啟動：

```powershell
copy .env.example .env
npm run secret
npm run start:lan
```

`npm run secret` 會印一組隨機字串，貼到 `.env` 的 `APP_SECRET=` 後面；`ADMIN_PASSWORD` 也用同樣方式產生（至少 12 字元）。`npm run start:lan` 啟動後會把手機該輸入的網址印出來。第一次啟動時 Windows 防火牆會跳提示，要選「允許存取」。

> PWA 的「加到主畫面」需要 HTTPS（`localhost` 例外），所以純 http 的區域網路位址只能用瀏覽器開。想要完整 PWA 體驗得自備憑證或走 Tailscale 之類的方案。

### 4. 備份（建議設定一次就好）

```powershell
npm run backup "D:\OneDrive\stock1-backup"
```

`.data/backups/` 的每日還原點**跟主檔在同一顆硬碟**，它防的是「檔案寫壞」，不防「硬碟掛掉或資料夾被誤刪」。這個指令把不可重建的資料複製到你指定的異地位置（雲端同步資料夾、外接硬碟、NAS 都可以），並保留最新 30 份。

最不能重來的不是交易帳本（那還有券商對帳單可對），是**前向驗證紀錄**與**月營收／EPS 的歷史累積**——官方 API 只回最新一期，過去的期數是這個 App 一天一天存下來的。

要自動化就交給 Windows 工作排程器：程式填 `npm`、引數填 `run backup`、起始位置填專案資料夾。

### 5. 執行自動化測試

```powershell
npm test
```

```powershell
npm run test:live
```

`npm test` 是全離線的（上游全部 mock）；`test:live` 會真的打 TWSE／TPEx，用來偵測官方 API 改版，屬選用。

---

## 環境變數說明

把 `.env.example` 複製成 `.env` 即可，`npm start` 與 `start.bat` 都會自動載入（沒有這個檔就沿用預設值，終端機會印一行 `.env not found`，屬正常）。

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=5174
APP_SECRET=長且隨機之加密密鑰 (用於券商憑證與 API 設定加密，至少 32 字元)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=強密碼 (至少 12 字元)
PUBLIC_ORIGIN=https://你的正式網域
COOKIE_SECURE=true
DATA_DIR=/var/app/data
UPDATE_CHECK=on   # 設 off 可關閉「跟 GitHub 比對版本」的對外查詢
```

只在自己電腦上跑（綁 `127.0.0.1`）時這些全部可以留空；**一旦綁到非 loopback 位址或設了 `PUBLIC_ORIGIN`，`ADMIN_PASSWORD` 與 `APP_SECRET` 就是啟動的硬性條件**，不足時伺服器會直接拒絕啟動而不是降級執行。
