---
name: stock1-backend
description: Stock1 後端（server.mjs 單檔 Node ESM）開發規範——新增/修改 API 端點的 SOP、fetchJson 逾時、快取與 single-flight、登入與權限、rev 樂觀鎖、交易帳本 v2 遷移/清洗、資料庫持久化與備份、測試掛鉤 export。凡是要動 server.mjs、加端點、接資料、改快取/auth、交易資料契約或遷移，動手前先讀這份。
---

# Stock1 後端開發規範（server.mjs）

單檔約 10,916 行 Node 原生 http（ESM、零框架；fubon-neo 只在券商模式惰性載入）。**改完要提醒使用者重啟正式伺服器（5174）**，Node 不熱載。

## 檔案內部結構（由上而下）

環境變數與常數 → 加解密/密碼（pbkdf2）→ 交易帳本 v2 稅費/遷移/損益引擎 → db 持久化（loadDb/saveDb/writeFileAtomic/備份回復＋`commitDbMutation` runtime transaction）→ auth（session/cookie/登入限流／`requireCurrentMutationAuth`／rev 樂觀鎖）→ 個人資料備份／兩階段復原 → 日期/解析工具 → `fetchJson`（唯一對外出口）→ 行情正規化層 → reference/歷史/Yahoo 備援 → 風險名單 getRiskSets → 處置看板 → 法人/融資券 → 隔日沖引擎 → 前向驗證 → 週月K聚合 → 技術分析 → 波段引擎（SWING_*常數＋SWING_SCENARIOS）→ 波段驗證 → 基本面 → dataProviders（official/broker）→ `handleApi`（全部路由）→ serveStatic → 統一 writer-resource leases／DB_PATH canonical 驗證 → `startServer`／`shutdownServer`／`flushPersistence` → **檔尾 export 測試掛鉤**。

找東西用函式名 grep，不要記行號（行號會漂移）。

## 新增一個 API 端點的 SOP

1. 在 `handleApi` 依既有模式加 `if (requestUrl.pathname === "/api/xxx")` 區塊。路由是 pathname 全等比對、先命中先回；照慣例把更特定的路徑放在較泛用的前面（如 `/api/swing/inspect` 在 `/api/swing` 之前）。
2. 回應一律 `jsonResponse(response, status, body)`；上游失敗用 `apiFailure(response, 502, error)`；body 帶 `ok: true/false`、時間戳用 `generatedAt`。runtime DB 落盤失敗必須由 `mutationErrorResponse()` 統一回 **503 `PERSISTENCE_FAILED`**，不可混成 400 或假裝成功。
3. 部分成功的降級資訊放 `warnings: []`（前端會顯示），不要因單一來源失敗就整包 500。
4. 讀 body 用 `readJsonBody(request)`（預設 128KB 上限＋JSON 驗證，會 throw）。只有個人備份預覽 `POST /api/personal-data/restore/preview` 使用「16 MiB 檔案＋256 KiB HTTP wrapper」的 request cap，解析後仍另外驗證 bundle 本身不得超過 16 MiB；不要為其他端點放大全域預設。
5. 權限：唯讀行情類**免登入**（使用者明確要求）；個人資料入口先用 `ensureAuthed(auth, response)`，但所有需登入的 runtime mutation 還必須在 `commitDbMutation()` queue 內呼叫 `requireCurrentMutationAuth(currentDb, auth, { admin? })`，重驗未過期 session、current user 與角色。請求可能卡在 body／上游／queue，入口 auth 絕不能當提交時權限；admin 專屬不得只檢舊的 `auth.user.role`。
6. 純 GET 端點要加入 `getOnlyApiPaths`，讓錯誤 method 在任何上游請求或重運算前直接回 405；新增其他 method 時則同步調整集合。這個順序必須用 HTTP 測試鎖住。
7. 新端點同步更新 README.md 的 API 清單，並在 tests/backend 補測試。

## fetchJson——所有對外請求的唯一出口

- 位置：`fetchJson(url, options)`。自帶 `AbortSignal.timeout`（預設 20 秒，`options.timeoutMs` 可覆寫）＋標準 headers。**不要在別處直接呼叫 `fetch`**——沒逾時的話，上游掛死會讓 single-flight 快取存住永不 resolve 的 promise，整個面板卡到重開伺服器（2026-07-07 已修的真實事故模式）。
- `fetchJsonWithRetry(url, options, retries)`：限流敏感的逐檔歷史抓取用它（900ms 間隔重試一次）。
- TWSE MIS 需要 `referer` header；各端點的欄位陷阱見 `stock1-upstream` skill。
- 行情正規化的**價格欄位**（成交／昨收／開高低／Yahoo meta）必須經 `parsePositivePrice()`，只接受有限且 `>0` 的數；`0`／`0.0000` 可能是上游無成交哨兵。成交量、總量與費稅等合法為零的欄位仍用 `parseNumber()`，不可把兩種驗證混在一起。

## 快取模式（五種，選對的用）

1. **TTL 物件**：`{ value, expiresAt }`，如 marketCache（15 秒）。到期重抓、失敗沿用舊值＋warning（last-good 模式）；整組 riskSets 先正規化日期 key 並共用 single-flight，處置看板也有今日 single-flight。
2. **以請求參數為 key 的 Map**：institutionalCache/marginCache（key=請求日期，最多 16 筆，過期/LRU 淘汰；同日期共用 single-flight）。
3. **每日凍結快照**：swingSnapshots（`YYYYMMDD:all`）——同一交易日只算一次、整天回同一份；登入後 `?refresh=1` 才能重算且有 5 分鐘冷卻，同日/同候選數的掃描共用 single-flight；「新結果更完整才覆蓋」，引擎改版靠 `SWING_FORMULA_VERSION` 讓舊快照失效。
4. **逐檔月 K**：historyCache 以 `exchange:code:month` 為 key，per-key single-flight；過期先清、LRU 上限 4096，避免全市場掃描跑久後只增不減。
5. **昂貴請求結果**：隔日訊號 cache 依日期與 `persist/read` 等行為旗標完整組 key，TTL LRU 上限 32；隔日回測 TTL 5 分鐘、上限 8。兩者同 key 共用 pending promise，完成或失敗都必須移除 flight。不要 export 內部 Map 給測試；用 builder 的物件 identity、呼叫次數與 eviction 行為驗契約。
- **惰性初始化若可能被 Promise.all 並發呼叫，必須 single-flight（存 promise、不是存旗標）**——否則兩邊各自初始化互相蓋掉（fundamentals 歷史檔踩過）。
- 同一份資料的不同視圖（例如兩個場景分頁）**共用同一次計算/同一份快照**，不要各算各的——否則計數與時間戳一定對不上（策略雷達踩過）。

## Auth 與安全（現況，勿倒退）

- 密碼 pbkdf2（`hashPassword`/`verifyPassword`）；session cookie `sid`＝HttpOnly＋SameSite=Lax＋（HTTPS 時）Secure，14 天過期。loadDb 會清過期，成功登入也會再清全部過期 session，並只保留同帳號最新 10 組有效 session（含本次）。
- 登入與建帳共用 `isValidUsername`／`USERNAME_PATTERN`（3～32 碼英數、`_`、`.`、`-`）；格式無效與帳密錯誤都回相同的一般 401，格式有效但不存在的帳號仍用固定 dummy hash 跑完整 PBKDF2，避免由回應時間枚舉帳號。
- 登入防爆破：同帳號 15 分鐘 10 次失敗→429。`loginFailures` 是重啟歸零的記憶體 Map，會順手清除超過 15 分鐘的項目，並以 LRU 上限 2048 筆防陌生帳號洪水；成功登入或 admin 重設密碼會解鎖。
- 帳號管理：`POST /api/auth/password` 自改密碼（踢其他裝置 session）；`PATCH /api/admin/users` 重設密碼（踢全部）；`DELETE /api/admin/users?id=` 刪帳號＋連動清 watchLists/priceAlerts/trades/brokerCredentials/dataRevs/sessions（不能刪自己、留最後一個 admin）。
- 券商憑證以 APP_SECRET 派生金鑰 AES 加密存 db；GET 回顯一律遮罩。
- `serveStatic` 只允許 app shell 明確 allowlist（HTML/app/Lucide/CSS/SW/manifest/icon，以及盤中選股使用的三個 IBM Plex Mono woff2）且只接受 GET/HEAD；server、package、tests、`.data` 一律 404。字型 MIME 固定 `font/woff2`，新增或更名時同步更新 SW shell 與靜態安全測試。CSP 的 executable script 只准 `'self'`；style block 只准本機 CSS，動態 style attribute 另以 `style-src-attr` 精準放行。
- production 缺 12+ 字元管理密碼、32+ 字元 APP_SECRET，或仍使用 `.env.example` 已知 placeholder 時拒絕啟動；**非 production 只要 listen host 不是 loopback，或設定了 `PUBLIC_ORIGIN`，也套用同一強度與 placeholder 禁令**。純 loopback 且未設公開來源的本機開發才允許預設值。寫入 API 驗 Origin/`Sec-Fetch-Site` 並要求 JSON。
- Auth 是 TOCTOU 邊界：已登入請求可能在讀 body、查官方資料或等待 transaction queue 時被登出、session 過期、帳號刪除或角色降級；正式 mutation 必須以 draft 內最新資料重驗 `session.id`＋`user.id`＋`expiresAt`＋所需角色，失敗回 401/403 且 draft 不發布。
- 前端渲染的字串安全靠 app.js 的 escapeHtml（見 stock1-frontend），後端只負責長度上限清洗（note 60 字、簡介 800 字等）。

## 個人資料的 rev 樂觀鎖（多分頁蓋寫防護）

watchLists/priceAlerts/trades 都是「整包 PUT」。模式：GET 回 `rev` → PUT 帶 `rev` → `rejectStaleRev` 不符回 **409 REV_CONFLICT**（帶目前 rev）→ 客戶端重新 GET 再重試。新的「每人一份整包同步」資料照抄這套（`getDataRev`/`bumpDataRev`），不然兩個分頁同時開就會互相蓋資料。

## 個人資料備份與復原契約

- 三端點都要登入：`GET /api/personal-data/export` 匯出、`POST /api/personal-data/restore/preview` 預覽、`POST /api/personal-data/restore` 提交。bundle 固定為 `stock1-personal-backup` v1，以穩定 canonical JSON 做 SHA-256 checksum；只含該帳號自選股、到價提醒、canonical v2 交易（含 quarantine）、本人共享備註與本人公司簡介，必須排除密碼、session、券商憑證、其他使用者與內部作者 id。
- preview 嚴格驗 envelope／版本／checksum／各資料契約，bundle 上限 16 MiB，HTTP wrapper 另預留 256 KiB；伺服器 canonicalize 後回變更摘要與 10 分鐘、單次使用、主要綁定 user＋session＋個人 rev＋共享備註 rev 的 token。`dbMutationEpoch` 只在 preview 生成期間用來確認讀到的 snapshot 未漂移，不存進已發 token、也不是之後 stale 判斷的永久綁定欄位。記憶體 token 最多 8 個，同一 session 只留最新一個。
- commit 必須同時帶 preview token、精確字串 `RESTORE` 與目前密碼；共用登入失敗限流，token 過期／重播／切帳號／任何綁定版本漂移都拒絕。進入 transaction queue 後再用最新 DB 重驗 session／user／rev／shared rev，並對最新 `passwordHash` 再驗一次目前密碼，不能信任排隊前的成功結果。私有 watchLists／priceAlerts／trades 採取代；本人 stockNotes 安全合併且不可擠掉他人備註，備註 id 跨股票全域唯一；companyProfiles 目前只預覽並略過，不覆蓋共享內容。
- 真正寫入前先在 `.data/backups/stock1-pre-restore-*.json` 建立完整還原點；建立期間以 `dbMutationEpoch`＋session／rev 驗 snapshot 穩定，競態時重試、仍無法一致就中止。這是短暫 snapshot guard，不代表 token 綁 epoch。此類還原點獨立保留 14 份。restore mutation 只能改 copy-on-write draft，必須等 save 成功才發布；save 失敗要丟棄整份 draft，不可讓「原鍵原本不存在」等情境留下半套記憶體資料。

## 交易帳本 v2 契約、遷移與覆核

- canonical payload 是 `{ schemaVersion: 2, settings, records, quarantinedRecords, migration? }`。紀錄同時保留 `fee/tax/kind/date` 舊 alias，但新邏輯一律讀 `instrumentType`、`tradeDate`、巢狀 `dayTrade`、`feeAmountTwd/taxAmountTwd` 與各自 source/ruleId；`kind` 只做舊版相容。
- 商品型別：`stock/equityEtf/unknownEtf/bondIndexEtf/leveragedInverseEtf/activeEtf/otherEtf/etn/other`；費稅來源：`estimated/broker/manual/legacy`；當沖狀態：`none/brokerConfirmed/userConfirmed/legacyDeclared`。實際金額 **0 也算明確值**，不可用 truthy 判斷吃掉。
- 新寫入先跑 `validateTradesMutationInput()`：拒絕未來 schema、v2 缺商品型別、無效日期/股數/來源、當沖股數超量與不適用商品/時段。PUT 再 `normalizeTradesPayload()`、`buildPortfolio()`；任一時點賣超回 400。修改契約時 validator、normalizer、portfolio、API round-trip 測試要一起改。
- PUT 在 normalize 前先跑 `canonicalizeTradeInstrumentProvenance()` 與 `canonicalizeTradeMoneyProvenance()`。官方商品章只有正向命中且成交日符合掛牌資格才能沿用；成交日改變必須重查。manual／broker 只有明確非負金額才視為實際值；新紀錄或經濟內容變更時，客戶端送來的 estimated／legacy 金額與 rule id 必須丟棄並由後端重算。既有紀錄經濟內容未變時保留凍結值，settings 改變不追溯。review reason 與 tax rule id 要跟著輸出，不能只留結果數字。
- `loadDb()` 會把每位使用者的 v1 payload 自動轉 v2。合法舊 fee/tax（含舊版曾解讀為 0 的 null）凍結為 `legacy`；舊 ETF 轉 `unknownEtf`，舊 dayTrade 轉 `legacyDeclared`。無效、重複 id 或重複股利事件移入 `quarantinedRecords` 保留原始內容，不得靜默刪除。遷移只在內容真的改變時 bump trades rev，後續載入必須冪等；寫檔仍先走每日備份。
- `/api/trades` PUT 以伺服器既有 quarantine 為準，即使前端沒回傳也不能洗掉。未來要提供「修復隔離資料」時應另設明確流程，不要讓一般整包 PUT 同時承擔資料救援。
- 法規估算最後核對日為 **2026-07-13**；具體有效日與產品政策見 `stock1-domain`。目前已有 TWSE／TPEx 官方 ETF 商品主檔與 `/api/instrument-profile`；仍沒有自動當沖配對／先賣後買處理，也沒有多券商費率方案。後端欄位只是為後續功能預留，不能因 schema 有欄位就宣稱能力已存在。`/api/trades` 會在商品查詢 await 後、commit 前二次檢查 rev，移動該檢查會重新打開並發覆寫。

## 資料庫持久化

- `loadDb()` 單例快取；只有主檔 `readFile` 成功後，`JSON.parse` 丟出的 `SyntaxError` 才是 corruption，才可保留壞檔並從 `.data/backups/` 由新到舊回復（全壞才空庫）。`EACCES`／`EIO`／`EISDIR` 等 read I/O／型別錯誤必須原樣 fail-closed，不得把原 DB 路徑改名、不得回退備份或空 DB。每日備份與個人復原前還原點各自保留 14 份，輪替規則不可混在一起。
- **所有 runtime DB mutation 必須走 `commitDbMutation()` 的 copy-on-write transaction queue**：在同一條 queue 內重新檢查 rev／權限條件、從最新已提交 `dbCache` 建立隔離 draft、只對 draft 執行 mutator、原子 `saveDb(draft)`，成功後才一次發布 draft 成為新的 `dbCache`。pending／失敗 draft 不得對 GET 或其他讀取可見；mutator throw 時丟棄 draft，原子落盤失敗則丟棄 draft 並包成 503 `PERSISTENCE_FAILED`，已提交 RAM（含 `dataRevs`／`sharedRevs`）始終不變。只序列化 IO 的 `dbSaveQueue` 不足以保證未提交可見性，禁止在 runtime route／背景流程直接改 `dbCache` 再呼叫 `saveDb()`。
- `skipDbMutation(value)` 是嚴格 no-op：回傳前 draft 必須與 baseline 完全一致。dirty draft 搭配 skip 必須丟 `DB_MUTATION_SKIP_DIRTY`（500），不呼叫 `saveDb()`、不發布 RAM、也不增加 `dbMutationEpoch`；這個 guard 防止「已改資料卻宣稱略過」靜默遺失。
- `dbMutationQueue` tail 必須永遠 settled（用當次 operation 的 catch tail）：business 4xx 與已安全丟棄 draft 的 persistence failure 只 reject 該 caller，不可污染下一筆 mutation，也不可讓 `flushPersistence()`／正常 shutdown 因歷史 rejection 假失敗。測試不需要用成功 mutation 清洗 queue。
- `dbMutationEpoch` 在失敗 save 時仍保守遞增一次；它是單調遞增的 mutation attempt epoch，用於 preview 生成與還原點建立期間的 snapshot 穩定檢查，不是已發 token 的綁定欄位，也不是會隨資料 rev 回退的版本。啟動遷移／初始 admin 的直接 `saveDb()` 若失敗，`loadDb()` 會清掉 `dbCache`，下一次必須重新讀檔與重試，不能留下只活在 RAM 的初始化結果。
- `DB_PATH` 預設在 `DATA_DIR` 內；若自訂，父目錄必須預先存在，再以父目錄 `realpath`＋basename 算出真正 atomic-rename target，且必須位於 canonical `DATA_DIR` 內。任一 relative path segment 都不可是 `backups`，也不可等於三個 sidecar target／`.tmp` 保留名稱；既有 DB 本身不可是 symlink、非一般檔案或 `nlink > 1` 的 hard link，且不能與其他已鎖定 temp resource 衝突。對應 fail-closed code 為 `DB_PATH_PARENT_MISSING`、`DB_PATH_OUTSIDE_DATA_DIR`、`DB_PATH_RESERVED`、`DB_PATH_SYMLINK_UNSAFE`、`DB_PATH_NOT_FILE`、`DB_PATH_HARDLINK_UNSAFE`。
- `DATA_DIR/backups` 最終 identity 必須精確等於 canonical `DATA_DIR/backups`；既有路徑若外逃、即使仍在 DATA_DIR 內但透過 symlink／junction alias、是 dangling symlink，或不是 directory，都要分別以 `BACKUP_DIR_OUTSIDE_DATA_DIR`／`BACKUP_DIR_ALIAS_UNSAFE`／`BACKUP_DIR_NOT_DIRECTORY` 拒絕。啟動還要對 daily／pre-restore backup target＋`.tmp` 做大小寫不敏感掃描；directory、symlink、`nlink > 1` hardlink 一律 `BACKUP_ENTRY_UNSAFE`。不可為了「方便」放寬 alias／entry 型別。
- 每日 DB 備份只有在 rollback point 複製成功，或同日檔案已存在（`EEXIST`）後，才記錄當日節流；暫時性檔案錯誤只警告、不擋主寫入，下一次 `saveDb()` 會在同一天自動重試。
- 寫入只走 `saveDb()`→`writeFileAtomic`（temp+rename 原子換檔）。atomic temp 每次先 `unlink`（只忽略 `ENOENT`），再用 `flag: "wx"` exclusive create，避免跟隨／覆寫殘留 symlink 或 hardlink inode。**旁路檔**（surveillance-history、fundamentals-cache、risk-cache）也各有 load/save；要求 durability 的 fundamentals／公司行動流程會明確 `await`，純快取／歷史維護才可能背景寫入。測試若要讀背景寫入結果，仍須 `pollUntil`＋`JSON.parse` 包 try。
- 新增會長大的資料一定要設上限（現況全有蓋：每日備份 14、復原點 14、快照 15、處置歷史 45 天、波段驗證 90 天、備註 50 則）。

## 健康檢查與服務生命週期

- `GET /api/health` 是公開且只允許 GET 的探針；ready 回 200，其他生命週期狀態回 503，內容含版本、啟動時間、uptime 與 `persistence.pendingWrites`，不可在裡面觸發昂貴上游或要求登入。
- 所有 filesystem writer 使用**同一個 canonical path-based lease namespace**（同一 `buildWriterLeaseEndpoint`）：①prospective DATA_DIR、②canonical backups、③三個 sidecar `fundamentals-cache.json`／`risk-cache.json`／`surveillance-history.json` 各自 target＋`.tmp`（6 把）、④canonical DB target＋`.tmp`（2 把）。因此 path 相同就碰撞，不因一邊叫 directory、另一邊叫 file/temp 而繞過；DB target/temp 固定排序取得以避免交叉 deadlock。
- `startServer()` 只允許建立 DATA_DIR 最後一層 leaf：它的 immediate parent 必須預先存在且為 directory，否則以 `DATA_DIR_PARENT_MISSING`／`DATA_DIR_PARENT_NOT_DIRECTORY` fail-closed；由該 parent canonicalize prospective DATA_DIR，先在同一 namespace 取得 canonical immediate-parent transient guard，再**取得 DATA_DIR lease 才能 `mkdir`**。不可遞迴建立 missing ancestor；parent guard 會短暫重試 sibling 啟動，真實 backups／writer parent owner 則以 `DATA_DIR_IN_USE` fail-closed，避免 contender 在已鎖定 subtree 內搶建 child。mkdir 後 realpath identity 必須一致，再依序鎖 backups、sidecars、驗 DB 邊界並鎖 DB target/tmp，完成後才 preload DB 與 listen。同資源競爭以 `DATA_DIR_IN_USE`／`DB_PATH_IN_USE` fail-closed。Windows 用 named pipe、Linux 用 abstract socket，其他平台用 deterministic loopback lease。
- DB target＋tmp 與三個 sidecar target＋tmp 等 fixed writer entry 在各自 lease 取得後若已存在，必須是 `nlink === 1` 的一般檔；symlink、directory、hardlink 統一以 `WRITER_ENTRY_UNSAFE` 拒絕，防止反向角色互換繞過 exact-path lease。
- `startServer()` 並發呼叫共用同一個 promise；啟動中收到 shutdown 要安全中止，listen 參數錯誤也要移除一次性 listener，不能留下下一次啟動才爆的殘件。任何啟動失敗（含 HTTP bind failure）必須釋放 lease，讓 successor 可接手。
- `shutdownServer()` 是冪等且同一輪回傳同一個 promise：先阻止／等待啟動競態，再關 HTTP，接著 `flushPersistence()` 排空 mutation queue、DB save、atomic queue 與背景寫入並等待富邦清理。**只有 HTTP 已確認停止且 `pendingPersistenceCount() === 0` 才可釋放整組 writer-resource leases**；否則保留、回 `DATA_DIR_LEASE_RETAINED` 並 fail-closed。SIGINT／SIGTERM 只設 `process.exitCode`，不得用 `process.exit()` 截斷寫入。
- 任一 writer-resource lease 在運行中 unexpected loss 時先把狀態標成 failed；正式程序（非 `STOCK1_SKIP_LISTEN`）必須立刻 `process.exit(1)` fail-stop，避免仍持續寫入；測試 import 模式則關閉 HTTP 以利觀察。這與正常 shutdown 的受控釋放是兩條不同路徑。
- `flushPersistence()` 需持續 drain 到所有追蹤集合為空，對失敗採 `allSettled` 後彙總拋錯；新增持久化旁路或 background task 時必須接入追蹤，否則 graceful shutdown 只是表面安全。部署換版必須 stop-old → 等退出／lease 釋放 → start-new；共用 DATA_DIR 的重疊 rolling deploy 被拒絕是正確行為。

## 測試掛鉤（唯一允許的「為測試改產品碼」）

檔尾 `export { …純函式與 startServer/shutdownServer/flushPersistence… }` ＋ `if (!process.env.STOCK1_SKIP_LISTEN) startServer()`。新寫的純函式要測就加進 export 清單（依分類擺、附註解）；`node server.mjs` 行為不得改變（boot-preserved.test 會 spawn 真入口驗證）。

## 全市場掃描的血淚教訓（動 scan 類邏輯前必讀）

STOCK_DAY_ALL（整批）、逐檔 STOCK_DAY、MIS 即時三個端點**更新時間不同步**；高並發抓逐檔歷史會被證交所限流、`.catch(()=>[])` 靜默吞掉後拿到過期資料。守則：**嚴格驗新鮮度（最後一根 K 必須等於基準日）、寧缺勿濫、並發壓在 3、當月抓不到就走 Yahoo 備援、絕不讓過期價冠上今日日期**。基準日 `latestDate` 用「官方收盤日眾數」（`resolveMarketCloseDate`），隔日沖的 max 版本是刻意差異勿合併。

處置看板在完成處置期間／狀態分類後，會用既有 `fetchMisQuotes` 對畫面代號做一次批次報價覆蓋。只接受 `!priceStale`、有可解析日期、日期不晚於查詢日且不早於該檔參考日的報價；覆蓋時價格、漲跌、量與 `quoteAsOf/quoteTimestamp/quoteSourceKind` 必須成組更新。MIS 失敗可沿用參考值，但要保留逐檔日期 mismatch 訊號，禁止把不同交易日偽裝成同一報價日。
