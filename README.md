# stock-cockpit

[![CI](https://github.com/kuotunyu/stock-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/kuotunyu/stock-cockpit/actions/workflows/ci.yml)
![Node.js 22/24](https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/Runtime%20Deps-1-purple)
![PWA](https://img.shields.io/badge/PWA-Offline%20Shell-orange)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

本專案為無框架 (Framework-less) 實作之台股看盤終端與策略檢驗 Web 系統：整合 TWSE、TPEx 與期交所官方資料源，提供隔日沖與波段選股引擎（含收盤資料前向驗證）、技術分析指標、注意/處置股票看板、自選股與精確交易稅則帳本。後端採用單檔 Node.js 原生 `http` 模組 (`server.mjs`)，前端採用 Vanilla JS 單頁架構 (`app.js`)，執行期僅包含富邦行情 SDK 單一外部依賴。

> **免責聲明**：本專案為個人策略研究工具，所有訊號、統計與損益估算僅供參考，不構成任何投資建議或交易要約；實際交易費稅請以證券商對帳單為準。

---

## 系統介面

以下為 2026-07-24 的介面示意，保留桌面與手機的主要操作配置；畫面中的行情、統計與部分控制項不代表目前版本或即時資料。

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
   隔日沖與波段選股在收盤資料完整且兩市場日期對齊後保存正式快照，再以後續交易日的官方日 K 驗證；暫定結果不建立正式驗證紀錄。除了畫面請求，伺服器也每 10 分鐘檢查收盤任務（`SCHEDULER=off` 可關）；伺服器沒開的日子不會自動補建當日訊號。紀錄保存公式版本，成績單區分當前版本、樣本數、資料缺口與大盤位階。各引擎的統計口徑見下表。
2. **交易帳本 v2 (Tax & Ledger Engine)**：
   商品與交易型態獨立建模，依成交日期估算費稅，保留估算、券商、手填與舊資料的來源。既有交易可修正；僅修改預設折數時，不追溯改寫歷史費稅。
3. **Copy-on-Write 交易佇列與原子落盤**：
   持久化讀寫採用 Copy-on-Write Transaction Queue 進行隔離與寫入租約 (Writer Lease) 互斥，確保 JSON 資料庫落盤安全性，失敗自動回傳 `503`。
4. **誠實降級與資料品質警告 (Honest Degradation)**：
   官方上游 API 異動或單一市場失敗時自動調用 Last-Good 快取，並於回應附帶品質警告標記 (`warnings` / `dataQuality`)，絕不以過期數據偽裝為即時行情。
5. **全離線測試與 PWA 離線殼**：
   內建離線測試套件 (`node:test` + jsdom，零網路 Mock 上游)，搭配 PWA Network-First 離線殼，API 端點永不強行快取舊行情。

---

## 系統架構與流程

### 系統架構

| 檔案／目錄 | 責任 |
|---|---|
| `index.html`、`app.js`、`styles.css` | 七個主畫面、前端狀態與渲染、Canvas 圖表、桌面／手機樣式；原生 JS，無打包流程 |
| `server.mjs` | 原生 HTTP API、資料來源、快取、選股與驗證、帳本、帳號、持久化及收盤排程 |
| `sw.js`、`manifest.json`、`icon.svg` | PWA 安裝與離線外殼；API 仍需連線 |
| `lucide.min.js`、`fonts/` | 自架圖示與字型；授權分別保留於程式檔頭及字型目錄 |
| `scripts/`、`start.bat` | 啟動、LAN、密鑰產生、外部備份、覆蓋率與日期體檢 |
| `tests/`、`.github/workflows/` | 離線回歸、上游契約檢查、push／PR 與每日可靠性檢查 |
| `docs/assets/` | README 使用的介面截圖 |
| `.data/`（不進版控） | 主資料庫、備份、基本面累積、風險快取與處置歷史 |

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
    API->>Queue: 2. 派送寫入佇列 (程序啟動時已取得 Writer Lease)
    Queue->>Queue: 3. 從已提交資料建立 Draft，重驗權限與 rev
    Queue->>DB: 4. 必要時備份，再寫暫存檔、fsync、rename
    DB-->>Queue: 5. 寫入確認 (fsync)
    Note over Queue,DB: 每日備份與復原前還原點各保留 14 份<br/>寫入失敗丟棄 Draft，已提交資料不變，回傳 503
    Queue-->>API: 6. 發布新版資料庫快取
    API-->>UI: 7. 回應 200 OK 與更新後帳本損益
```

---

## 策略驗證與選股引擎

系統內建兩套收盤策略引擎。另有盤中選股與注意／處置看板，各自使用不同資料範圍：

| 策略引擎模組 | 選股特徵與演算法 | 驗證機制與對答案邏輯 |
|---|---|---|
| **隔日沖選股引擎 (Overnight)** | 以還原權息後的日 K 分三群：強勢續攻（漲 3～9.5%、量比 ≥1.5、收在高檔、站上 MA5/MA20）、爆量高危（量比 ≥3 且振幅大或收盤轉弱）、回檔轉強；候選池為日量 ≥100 張的普通股依動能取前 260 檔。注意／處置與法人資料只做標示，不進判定 | 伺服器排程在兩市場整批收盤對齊後凍結快照，之後以官方認定的實際下一交易日對答案；成績單以開盤賣／收盤賣的淨報酬勝率為主，附以日為叢集的信賴區間與大盤季線上／下分層 |
| **波段選股雷達 (Swing Strategy)** | 全市場日量 ≥500 張的普通股取前 240 檔，掃中軌攻防與上軌續攻；每檔附進場（當日收盤）、結構停損、目標與扣成本後的淨盈虧比（≥1 才上榜），價位套台股升降單位 | 最多追蹤 15 個實際交易日：開盤價優先，同日雙觸保守記停損，跌停鎖死順延出場。除權息有可用官方基準即調整，未解決或缺日 K 則停等。主要勝率是連續競價樣本的達標比例，滿 20 筆結案才顯示；另列次日開盤進場、淨 PF／中位數／連虧天數與分盤樣本 |
| **盤中選股** | 只篩選目前載入的觀察池（自選、搜尋與已載入訊號等）；盤中每 10 秒輪詢更新 | 是本機即時粗估，不是全市場收盤策略或前向驗證 |
| **注意/處置股票看板** | 即將處置、處置中、即將出關、鉅額、注意、全額交割六分頁 | 以本機每日快照比對「新進／連 N 天／出關」，比不了時明講判定中而非印 0 |

隔日沖正式快照與波段驗證單會保留歷史；預設成績單仍分別讀取目前公式最近 260 份快照與近 90 日驗證單。隔日沖未滿 20 個觀察日不把百分比當作結論。卡片的歷史回測只回看今天入選的股票，有取樣偏誤，應與前向驗證分開解讀。注意／處置股預設保留並標示，可切換隱藏；停牌／下市股不進候選池。

正式發布固定掃描範圍：隔日沖 260 候選／每群 20；波段 240 候選／所有場景／每場景 40。首次完整發布可為零訊號；全部來源失敗或未完成採集不算完整零訊號。UI 場景與顯示筆數不改發布母體，研究參數另存 revision。後到資料、重算與手動 refresh 可以留下更正，但不改原正式 signalId、原計畫與首次發布時間。

API 的 `publication` 提供 captureId、版本身份、輸入指紋、request scope、來源日期精度與本機取得／發布時間；寫入失敗回 `kind: "not-persisted"` 並保留重試提示。正式身份與全部修訂保存在主 DB 的 `verificationPublications`，與訊號／驗證單同次原子提交及備份。來源只有日期時不補造時分秒；週一才取得週五清單，不代表週五已能決策。 發布先原子保存清單與 `publicationStartedAt` 下界，再一次性補存真正可讀後的 `availableConfirmedAt` 上界；`publishedAt`／`decisionAvailableAt` 採此保守上界並標 `confirmed-available-upper-bound`。補證失敗不撤銷正式清單，時間保留 null 與原因；之後讀取時用當下真實時間補證，不能回填。跨開盤的提交區間不能直接認定必定晚發布。

評估 metadata 分為 `selectionVersion`、`evaluationVersion`、`costModelVersion`、`cohortPolicyVersion`、`entryModel`、`returnBasis`（schema 2），另保留 `formulaVersion` 相容。此次沿用的價格觀察算式為 `overnight-price-observation-v1`／`swing-price-observation-v1`，成本為固定扣 0.471 個百分點的 `flat-round-trip-0.471pct-v1`，母體政策為 `first-canonical-publication-v1`。這些仍是收盤基準的還原座標價格觀察，並非成交或帳戶含息實績。

成績單的 `modelGroups`／`selectedModelKey` 分開完整模型，headline 不混算新版與舊版。缺少舊 metadata 標 `legacy-unknown`，未知成本不補算淨值。已有 final 觀察保留；舊訊號補算另存 `observationRevisions`，標記事後觀察與本次實際模型，不能補成當時正式發布。舊波段 pending 的 `evaluationApplied` 只證明本次補驗套用的模型，不回填原始進場或當時可得時間。

單日隔日驗證與歷史成績單同日優先使用首次正式 capture；無正式發布才顯示標示身份的 legacy 觀察，兩者共用完整觀察 memo。已知不支援的波段 evaluation／entry／return 模型保留原證據，以 `evaluationUnavailable` 與摘要 `unavailableCount` 揭露停等，不借用目前算式結案。隔日逐檔 `sourceEvidence` 分開官方成功、確認空資料及失敗，連同備援狀態判定採集完整性；已確認空資料不等於來源故障。

漏開程式留下的波段 pending 會分批補判：每輪最多 16 組近期與 4 組歷史標的，舊單每次核對停住月份及下一月份的官方交易日、日 K 與公司行動。無法確認市場或來源時保留原因，歷史重試至少間隔 5 分鐘；缺 K 不跳日，來源失敗不冒充已確認缺口。歷史越多，資料檔與備份也會增長，應保留足夠磁碟空間。舊版已刪除、且沒有備份的紀錄無法恢復，不從後來結果反推訊號。新版本累積證據後，不可直接啟動仍會裁剪歷史的舊版；回復前須完整隔離備份並匯出新證據，驗證恢復後再切換。

---

## 交易帳本 v2 稅則與損益試算

交易帳本依買賣時間重放紀錄，以加權平均成本計算持股與已實現損益，並處理股利、配股與現金增資：

- **有效日期化稅則**：依成交日期、商品分類與使用者確認的當沖配對股數估算；分類不明或資格不足會要求覆核。
- **券商手續費折讓**：內建單一預設估算方案，可自訂折數；實際券商或手填費稅（包括 0 元）優先。
- **歷史修正與來源保留**：可新增、修正或刪除交易。經濟內容未變時保留原費稅；修改成交日期、價格、股數等內容時，估算金額由後端重算。
- **目前邊界**：沒有自動當沖配對、先賣後買或多券商帳戶費率引擎；有欄位不代表已自動驗證資格。

---

## API 規格與模組分類

公開行情、訊號與技術分析端點未登入即可使用；個人資料即使只是讀取也需要登入，修改個人或共享資料同樣需要身分驗證。

| 模組分類 | 主要 API 端點 | 功能說明 |
|---|---|---|
| **服務健康** | `GET /api/health`、`GET /api/app-version`、`GET /api/sources` | 依序為啟動就緒／待寫入狀態、版本比對、資料來源狀態 |
| **身分驗證** | `/api/auth/*`、`/api/admin/users` | 管理者帳號登入、Session 管理與權限控制 |
| **行情與大盤** | `/api/symbols`、`/api/quotes`、`/api/markets`、`/api/market-session`、`/api/market/breadth` | 搜尋、報價、市場時段、大盤位階、漲跌家數與事件；期指日盤顯示基差，夜盤另標與現貨收盤之差 |
| **個股資料** | `/api/institutional`、`/api/margin`、`/api/company`、`/api/fundamentals`、`/api/technical-analysis` | 法人、融資融券、公司概況、基本面與 K 線分析 |
| **選股引擎** | `/api/overnight*`、`/api/swing*` | 隔日沖、波段選股訊號與每日歷史前向驗證成績單 |
| **注意處置** | `/api/surveillance-board` | 官方注意股票、處置股票與全額交割即時看板 |
| **個人資料** | `/api/watchlists`、`/api/alerts`、`/api/trades`、`/api/personal-data/*` | 自選股、到價提醒、交易帳本、個人備份匯出與預覽／確認復原 |
| **券商與備註** | `/api/broker/settings`、`/api/broker/test`、`/api/notes`、`/api/notes/recent` | 登入後管理券商行情設定或新增共享備註；近期共享備註可公開讀取 |

---

## 快速開始

建議使用 **Node.js 24.15.0 以上的 24.x 版本**，或 22.22.2 以上的 22.x。這符合目前 jsdom 30 的安裝／測試需求；只執行 App 的最低版本另見 `package.json` 的 `engines`。Node 20 不支援。

### 1. 本地啟動

```powershell
git clone https://github.com/kuotunyu/stock-cockpit.git
cd stock-cockpit
npm install
npm start
```

啟動後開 <http://127.0.0.1:5174>。Windows 也可以直接雙擊專案根目錄的 **`start.bat`**（會自動補跑 `npm install` 並開好瀏覽器），把它「傳送到 → 桌面（建立捷徑）」就不用每次開終端機。

**第一次啟動的預設帳號是 `admin` / `admin1234`**（未指定管理密碼且資料庫為空時建立）。登入後到「更多 → 帳號管理」修改；預設綁 `127.0.0.1`。既有帳號的密碼不會因為修改 `.env` 而自動重設。

### 2. 更新到最新版

```powershell
git pull --ff-only
npm install
```

改到後端（`server.mjs`）必須**重新啟動伺服器**（Node 不會熱載）；只改前端的話瀏覽器 **Ctrl+F5** 一次即可。不確定自己是不是舊版，就到「更多 → 版本與更新」看——那裡會顯示這台跑的 commit，並跟 GitHub 上的最新版比對。

### 3. 從手機／平板看盤（同一個 Wi-Fi）

先在 `.env` 設好強度足夠的密碼與密鑰（對外開放時伺服器會強制檢查，沒設就拒絕啟動），再用 LAN 模式啟動：

若尚未建立 `.env`，先複製範本，保留既有 `.env` 的設定：

```powershell
Copy-Item .env.example .env
npm run secret
```

`npm run secret` 會印一組隨機字串，貼到 `.env` 的 `APP_SECRET=` 後面；`ADMIN_PASSWORD` 也需設定至少 12 字元的強密碼。已有帳號仍須在 App 中修改密碼。停止原本的伺服器並等它完全結束後，再執行：

```powershell
npm run start:lan
```

LAN 啟動會覆寫 `HOST` 為 `0.0.0.0`，並印出手機網址。第一次啟動時 Windows 防火牆可能要求允許存取。

> LAN 模式是純 http：同一個 Wi-Fi 上的任何裝置都能攔到流量，包括登入密碼與 cookie。只在自己信任的網路（家裡）用；咖啡廳、公司 Wi-Fi 不要開。

> PWA 的「加到主畫面」需要 HTTPS（`localhost` 例外），所以純 http 的區域網路位址只能用瀏覽器開。想要完整 PWA 體驗得自備憑證或走 Tailscale 之類的方案。

### 4. 備份（建議設定一次就好）

```powershell
npm run backup "D:\OneDrive\stock1-backup"
```

`.data/backups/` 的每日還原點**跟主檔在同一顆硬碟**，它防的是「檔案寫壞」，不防「硬碟掛掉或資料夾被誤刪」。這個指令把不可重建的資料複製到你指定的異地位置（雲端同步資料夾、外接硬碟、NAS 都可以），並保留最新 30 份。

最不能重來的不是交易帳本（那還有券商對帳單可對），是**前向驗證紀錄**與**月營收／EPS 的歷史累積**——官方 API 只回最新一期，過去的期數是這個 App 一天一天存下來的。

要自動化可用 Windows 工作排程器：程式填 `npm.cmd` 的完整路徑，引數填 `run backup "D:\OneDrive\stock1-backup"`，起始位置填專案資料夾。也可在 `.env` 設定 `STOCK1_BACKUP_DIR` 後只傳 `run backup`；第一次執行帶入的目標不會自動記住。

### 5. 執行自動化測試

```powershell
npm test
```

```powershell
npm run test:live
```

`npm test` 全離線且使用獨立暫存資料目錄與臨時埠；`test:live` 會連接官方來源與 Yahoo，檢查欄位形狀。push／PR 執行離線測試，每日另排日期體檢與上游檢查。更多命令、隔離規則與覆蓋率限制見 [測試指南](tests/README.md)。

---

## 環境變數說明

本機設定集中在 [.env.example](.env.example)，不要把實際 `.env` 提交至 GitHub。尚未建立 `.env` 時才複製範本；`npm start`、`start:lan`、`backup` 與 `start.bat` 會載入它。沒有此檔也能按本機預設啟動。

```text
NODE_ENV=development
HOST=127.0.0.1
PORT=5174
APP_SECRET=長且隨機之加密密鑰 (用於券商憑證與 API 設定加密，至少 32 字元)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=強密碼 (至少 12 字元)
PUBLIC_ORIGIN=
COOKIE_SECURE=false
DATA_DIR=.data
UPDATE_CHECK=on   # 設 off 可關閉「跟 GitHub 比對版本」的對外查詢
ALLOWED_HOSTS=    # 額外允許的 Host 名稱（逗號分隔）；預設只認 127.0.0.1／localhost 與 LAN 模式列舉的本機位址，其餘回 421
TRUST_PROXY=off   # off｜on｜cloudflare：只有放在反向代理後面才設；on 取 x-forwarded-* 最右可信跳點，cloudflare 優先 cf-connecting-ip
TRUST_PROXY_HOPS=1 # 可信代理層數（on 模式取 x-forwarded-for 從右數第 N 段；代理是附加不是取代，最左段由客戶端自填）
SCHEDULER=on      # 收盤後排程（每 10 分鐘檢查、兩市場對齊後自動掃描與推進驗證）；設 off 回到「有人開 App 才算」
STOCK1_BACKUP_DIR= # 異地備份目標；也可直接傳給 npm run backup
```

伺服器只回應 Host 在允許清單內的請求（其他一律 `421 Misdirected Request`）。這是為了擋 DNS rebinding：瀏覽器裡任何網頁都能把自己的網域指到 127.0.0.1 再打本機 API，Host 是唯一分得出「這是不是你自己開的網址」的線索。

範本預設為本機 HTTP，資料放在專案的 `.data`。**設定 production、綁非 loopback 位址或設定 `PUBLIC_ORIGIN` 時，`ADMIN_PASSWORD` 與 `APP_SECRET` 都必須達到強度要求**，否則拒絕啟動。

若另行部署 HTTPS 服務，再依部署環境設定 `NODE_ENV=production`、`PUBLIC_ORIGIN`、`COOKIE_SECURE=true`、持久資料目錄與可信代理；不要把 HTTPS cookie 設定直接用在純 HTTP LAN。更換啟動方式前先完整停止舊程序，同一資料目錄只能有一個寫入程序。
