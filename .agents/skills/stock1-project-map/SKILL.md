---
name: stock1-project-map
description: Stock1 台股看盤 App 的架構總覽與專案地圖——檔案結構、資料流、交易帳本 v2、資料庫、快取、鐵律，以及該讀哪個子skill。在這個專案開始任何修改、回顧現況、找「某功能在哪裡」、或不確定改動會影響什麼時，先讀這份。其他五個 stock1-* skills 都從這裡分流。
---

# Stock1 專案地圖

私人台股看盤 Web App：使用者＋2 位朋友各自在自己電腦 `npm start` 跑 localhost，觀察用、不下單。繁體中文介面，回覆使用者一律用繁體中文。**目錄不是 git repo**（使用者更新方式＝整包複製 code 給朋友）。

最後校準：2026-07-16（UI/UX 全面整修：數字字型回 mono＋字重上限 700、紅綠/灰階收斂 token、版面密度回收、桌機三欄斷點 1240→1040、方正風格收斂、小字全站掃除——詳見 stock1-frontend）；最新離線測試 544/544，後續通過狀態仍**以 npm test 最新 TAP 為準**。**改了重大行為請順手更新對應 skill——這些文件同時是使用者的回顧文件。`.agents/skills` 是 canonical；完成後同步鏡像到 `.claude/skills`，避免兩套代理讀到不同規格。**

## 鐵律（違反會直接惹惱使用者）

1. **絕不佔用 5174 埠**——那是使用者的正式伺服器。測試/預覽用 `.claude/launch.json` 的 `stock1-test`（5180）或臨時埠 0。**且換 port 不夠**：兩個 Stock1 程序共用同一個 `.data` 會觸發單一 writer lease 的 `DATA_DIR_IN_USE`（2026-07-16 實際害使用者的 npm start 起不來）。preview/測試伺服器一律用獨立資料目錄（stock1-test 已設 `DATA_DIR=.data-preview`，該目錄是可隨時整個刪除的暫存 DB），**用完必須關掉伺服器再收工**；殺程序用 PowerShell `Stop-Process`（Git Bash 的 kill 對 Windows node PID 常無效）。
2. **改了 server.mjs 要提醒使用者重啟**（Node 不熱載）；純前端改動提醒 **Ctrl+F5**。
3. **特徵化原則**：發現疑似 bug 先回報使用者、不要默默改行為；測試釘現行行為。
4. 行為變更（尤其選股門檻、風險政策）要在總結明列，讓使用者知情。
5. 唯讀 API（行情/訊號/技術分析等）**開放未登入**是使用者明確要求，不要鎖回 401。
6. **所有 writer resource 共用同一個 canonical path lease namespace**；除 DATA_DIR 外，backups、三個 sidecar target＋tmp、DB target＋tmp 都要鎖，canonical alias 也算同一資源。`DATA_DIR` 只容許建立最後一層 leaf，immediate parent 必須預先存在且為目錄；`DB_PATH` 必須留在 canonical `DATA_DIR` 內、父目錄預先存在，任一 path segment 不可占用 backups／sidecar／temp 保留名稱，DB 本身也不可是 symlink、非一般檔案或 hardlink。換版採 stop-old → 等完整結束 → start-new。

## 檔案地圖

```
Stock1/
├─ index.html      單頁殼（約 714 行）：7 個 screen panel＋右側詳情面板＋彈窗
├─ app.js          全部前端（約 11,778 行 vanilla JS，classic script、無打包）
├─ styles.css      全部樣式（約 9,360 行，深色看盤風、方正硬派；LF 換行，勿用 CRLF 編輯器存檔——測試以 \n regex 比對）
├─ lucide.min.js   自架 Lucide 1.24.0（ISC；index.html 的 SRI 會由測試核對）
├─ fonts/           自架 IBM Plex Mono 2.5.0 Latin1 三字重（OFL；全站資料數字使用）
├─ server.mjs      全部後端（約 10,916 行 Node 原生 http、ESM 單檔）
├─ sw.js           PWA Service Worker（shell v5 network-first＋完整離線備援；API 永遠走網路；改前端資產記得 bump CACHE_NAME）
├─ manifest.json / icon.svg   PWA 三件組（index.html 有引用，勿刪）
├─ .env.example    環境變數範本（PORT/APP_SECRET/ADMIN_PASSWORD…）
├─ .data/          JSON 資料庫（gitignore；勿提交勿外流）
│  ├─ stock1-db.json            主資料庫（見下方「資料庫」）
│  ├─ backups/                  真實 canonical directory（禁 alias）；兩類備份各留 14 份
│  ├─ fundamentals-cache.json   月營收/EPS 歷史累積（官方只回最新一期）
│  ├─ risk-cache.json           注意/處置/停牌名單 last-good 快取
│  └─ surveillance-history.json 處置看板每日快照（留 45 天，算「新進/連N天」）
├─ tests/          離線測試＋opt-in live 形狀檢查（數量以 npm test 最新 TAP 為準；見 stock1-testing）
└─ .claude/launch.json   preview 設定：stock1=5174（勿用）、stock1-test=5180
```

## 七個主畫面（bottom-nav 順序）

| screen key | 名稱 | 內容 |
|---|---|---|
| `overnight` | 隔日沖 | 每日訊號三分群＋策略表現回測＋前向驗證成績單 |
| `screener` | 盤中選股 | 即時、本機粗估、10 秒更新（與策略雷達刻意並存，勿合併） |
| `strategy` | 策略雷達 | 波段選股（全市場日K、當日凍結）＋個股型態健檢＋波段驗證 |
| `watchlist` | 自選股 | 三組清單＋摘要卡＋管理模式 |
| `technical` | 技術分析 | 日/週/月 K＋放大互動圖＋基本面＋公司概況＋處置標記 |
| `surveillance` | 處置看板 | 即將處置/處置中/出關/鉅額/注意/全額交割 六分頁 |
| more | 更多 | 資料源狀態、富邦 API、共享備註、帳號管理、個人資料備份／復原、風險規則、名詞解釋 |

## 資料流（一句話版）

官方 API（TWSE/TPEx/期交所 MIS/Yahoo 備援）→ server.mjs 正規化＋快取 → `/api/*` JSON → app.js 各 `xxxState` 物件 → `renderXxx()` 重繪。前端每 10 秒輪詢（只在盤中；夜盤只更新指數；`refreshLiveData` 有 in-flight 防重入）。

即時價三層備援：MIS 有**大於 0**的成交價 z/pz/oz 才用（`-`／`0.0000` 都是無成交哨兵）→ 無有效價退 Yahoo 即時 → 都無標 `priceStale` 顯示官方昨收／收盤。

個人資料可攜流程：更多頁下載 `GET /api/personal-data/export` → 選檔後由 `POST /api/personal-data/restore/preview` 做 16 MB 上限、checksum 與資料契約預覽 → 勾選確認＋目前密碼後以單次 token 呼叫 `POST /api/personal-data/restore`；提交前會建立完整 DB 還原點。token 主要綁 user、session、個人 rev 與共享備註 rev；DB mutation epoch 只用來確認預覽生成與還原點建立期間的 snapshot 穩定，不是已發 token 的持續綁定欄位。備份不含密碼、session、券商憑證、其他使用者或內部作者 id。

服務生命週期：`startServer()` 先驗證 `DATA_DIR` immediate parent 已存在且為目錄，由該 parent 推導 prospective canonical leaf；啟動期間先用同一 namespace 取得 canonical immediate-parent transient guard，再在 **mkdir 前**取得 DATA_DIR lease，不允許遞迴建立 missing ancestor，也不允許在另一 writer 已鎖定的 backups／parent subtree 內搶建 child。接著再鎖 canonical backups、三個 sidecar（fundamentals／risk／surveillance-history）target＋tmp、驗證並鎖 DB target＋tmp，之後才 preload DB 與 listen。全部資源使用同一 path-based namespace，避免父子 DATA_DIR 或 file/tmp／directory 角色互換造成雙 writer。公開唯讀 `GET /api/health` 回 ready／pending writes，未 ready 時為 503。`shutdownServer()` 只有 HTTP 已停止且 pending persistence＝0 才釋放整組 leases；否則保留並 fail-closed。正式程序若意外失去任一 lease 會立即 fail-stop。

## 資料庫（.data/stock1-db.json 頂層鍵）

`users`、`sessions`（14 天過期、載入時清）、`watchLists`（每人三組，鍵 "1"/"2"/"3"）、`priceAlerts`、`trades`（每人一份 schema v2 帳本）、`brokerCredentials`（AES 加密）、`dataRevs`（個人資料樂觀鎖版本號）、`sharedRevs`（共享資料版本號）、`stockNotes`（共享備註，每檔留 50）、`companyProfiles`（手動公司簡介）、`signalSnapshots`（隔日沖快照留 15）、`swingSnapshots`（波段快照，鍵 `YYYYMMDD:all`，留 7 天）、`swingVerification`（波段驗證，留 90 天）。

runtime 寫入一律走 `commitDbMutation()` 的 **copy-on-write transaction queue**，把「重驗條件與 rev → 在隔離 draft 修改 → `saveDb(draft)`／`writeFileAtomic` → 成功後發布 `dbCache`」整段序列化；需登入的 mutation 還要在 queue 內重驗未過期 session、current user 與角色，restore 再對最新 `passwordHash` 驗目前密碼。pending／失敗 draft 不對讀取可見，落盤失敗時已提交 RAM 與 rev 不變，API 統一回 `503 PERSISTENCE_FAILED`，下一筆寫入不得夾帶失敗資料。`skipDbMutation()` 只接受 pristine draft；dirty skip 回 `DB_MUTATION_SKIP_DIRTY`，不寫檔／不發布／不 bump epoch。queue tail 永遠 settled，business 4xx／安全丟棄的 persistence failure 只拒絕當次 caller，不污染下一筆或 shutdown。失敗 save 仍讓 `dbMutationEpoch` 保守遞增一次，供預覽生成／還原點建立期間重驗 snapshot 穩定。每天第一次寫入前自動備份，個人資料復原提交前另建立精確還原點，兩類各保留 14 份。

主 DB corruption recovery 僅限成功 `readFile` 後 `JSON.parse` 的 `SyntaxError`；`EACCES`／`EIO`／`EISDIR` 等 read error 原樣 fail-closed，不可改名原路徑或退回備份／空 DB。`backups` 若已存在必須是真正的 canonical `DATA_DIR/backups` directory，不可為外逃、內部或 dangling alias，也不可為一般檔案。DB 與三個 sidecar 的 target＋tmp 若已存在，必須是單一一般檔；daily／pre-restore backup target＋tmp 會做大小寫不敏感掃描，directory／symlink／hardlink 都拒絕。atomic temp 寫入先 unlink（只容許 `ENOENT`）再以 `wx` exclusive create，避免 follow 舊 link。

## 交易帳本 v2 資料流與現況邊界

前端 `tradesState`／交易表單 → `PUT /api/trades`（schemaVersion 2＋rev）→ 嚴格驗證 → 官方商品與伺服器費稅來源 canonicalization → `normalizeTradesPayload()` → `buildPortfolio()` → commit 前二次 rev 檢查 → 原子寫入。GET 回 canonical records、`quarantinedRecords` 與 portfolio；v1 資料在 `loadDb()` 自動遷移，原有費稅凍結，無法安全轉換者進隔離區，不得靜默丟棄。

v2 已有分離的商品類型、成交日/時段/時間、部分當沖股數、費稅金額與來源、rule id、覆核理由、一般交易修正、歷史載入更多及持股/已實現稽核。法規估算最後核對日為 **2026-07-13**，具體規則見 `stock1-domain`。

現況已有 TWSE 歷史 ETF 與目前掛牌狀態、TPEx 七類 ETF 的官方商品主檔；正向命中會依成交日核對掛牌資格並蓋官方章，來源降級或查無時維持待覆核，不拿負向查詢猜商品。仍**沒有自動當沖資格與配對、先賣後買處理、多券商／多帳戶費率方案**；當沖確認由使用者輸入，實際券商／手填費稅可逐筆覆寫。schema 中的 account/session/executedAt/pairId 是未來擴充基礎，不代表上述能力已完成。

## 模組級快取清單（server.mjs，改邏輯前先看有沒有快取擋著）

referenceMarketCache＋referenceCache（上市／上櫃各自 last-good，5 分鐘；降級 30 秒重試）、quoteCache、riskCache（1h 新鮮/26h 可容忍）、marketCache（15 秒）、institutionalCache/marginCache（Map，以請求日期為 key）、historyCache、overnightCache（完整 5 分鐘／provisional 30 秒）、swingCache、verifyHistoryCache（pending 60 秒／完整 10 分鐘）、companyDirectoryMarketCache＋companyDirectoryCache（24 小時；降級 5 分鐘重試）、productDirectoryMarketCache＋productDirectoryCache（官方 ETF 商品主檔，24 小時；降級 5 分鐘重試）、tradingCalendarSourceCache＋tradingCalendarCache（實際交易日 5 分鐘／開休市表 24 小時）、fundamentalsSourceCache（依來源 1~12h）、yahooQuoteCache（30 秒）、surveillanceBoardCache（10 分，硬失敗縮 2 分重試）、dbCache（單例）。

## 分流：接下來讀哪個 skill

- 改 **server.mjs**（端點/資料源/快取/auth/交易 schema 或遷移）→ `stock1-backend`
- 改 **app.js / styles.css / index.html**（UI/UX/字級/渲染/交易表單）→ `stock1-frontend`
- 動 **選股門檻/損益/稅費/商品分類/驗證規則/處置政策**（任何「股票專業邏輯」）→ `stock1-domain`
- **官方資料壞了/欄位對不上/要接新資料源** → `stock1-upstream`
- **寫或改測試** → `stock1-testing`（改前必讀 tests/README.md；交易 v2 改動需同時覆蓋 backend＋frontend）

## 驗證與交付慣例

- 全改動跑 `npm test`（~20 秒全離線）；動到上游 fixture 疑慮時 `npm run test:live`。
- 測試資料路徑透過 `importServer({ dataDir, dbPath })`／`bootServer({ dataDir, dbPath })` 顯式傳入；helper 固定 `ADMIN_USERNAME=admin`／`PORT=0`，清除 ambient `SESSION_MAX_AGE_MS`／`COOKIE_SECURE`，未收到 `dbPath` 時也清除 ambient `DB_PATH`。所有 server 測試用 port 0，5174 永遠保留給使用者。
- 瀏覽器驗證用 preview `stock1-test`（5180）。**preview_screenshot 在此環境常逾時/縮小**——既定慣例改用 preview_eval 讀 getComputedStyle/getBoundingClientRect＋a11y snapshot 驗證；量桌機版面前先 preview_resize 到 ≥1280 寬（預設視窗太窄會誤判換行）。
- 給使用者的總結：改了什麼、行為變更明列、server.mjs 有動就提醒重啟、純前端提醒 Ctrl+F5。
