---
name: stock1-testing
description: Stock1 測試套件的撰寫與執行規範——node:test＋jsdom 架構、離線 fetch-mock、模組快取的測試約束、Windows 陷阱、特徵化原則。凡是要寫測試、改測試、跑測試、或改動需要驗證回歸（幾乎所有程式改動都是），先讀這份＋tests/README.md。
---

# Stock1 測試規範

**tests/README.md 是第一手慣例文件，改測試前先讀它**。這份 skill 補充 README 沒寫的深層陷阱與工作流。

## 現況（2026-07-15）

最新離線測試 543/543（backend 339＋frontend 204），後續通過數仍**以 npm test 最新 TAP 為準**；另有 opt-in live 形狀檢查（`npm run test:live`，網路失敗 skip 不 fail）。最新 `server.mjs` 覆蓋率為行 89.29%／分支 77.30%／函式 89.53%；app.js 因 script 注入拿不到歸屬，品質看測試清單不看百分比。

框架＝Node 內建 `node --test`＋jsdom（唯一 devDependency）。**不要引入任何測試框架**。

## 基本工作流

- 改動後跑 `npm test`；只跑單檔：`node --test tests/backend/xxx.test.mjs`。
- `npm run test:coverage` 由 `scripts/test-coverage.mjs` 編排：先跑 7/7 個 query-string cache-bust 契約（不納入原生 coverage 合併），再對其餘 511/511 個 measurable tests 序列收集覆蓋率。Node 24 會錯誤覆寫同一 ESM 的 query 版本；不要簡化回單一原生 coverage glob。
- **新功能配新測試**是本專案慣例（HTTP 端點進 api-*.test.mjs 或新檔；純函式先加進 server.mjs 檔尾 export 再測）。
- 測試檔開頭寫一行中文註解說明這檔測什麼。
- 驗證測試有效性的手法：**突變抽查**——暫時改壞一個門檻（如 3%→2%）確認測試轉紅，再改回。

## 鐵則（違反會壞在很難查的地方）

1. **絕不綁 5174**：整合測試用 `bootServer()`（臨時埠 0），spawn 真入口的 `boot-preserved` 全案例也必須明確設 `PORT=0`；`node --test` 參數**必須用 glob**（`tests/backend/*.test.mjs`）——Windows 上傳目錄會被當模組執行而 MODULE_NOT_FOUND。
2. **完全離線**：fetch-mock 未匹配的外部 URL 直接 throw。漏接路由會大聲失敗——這是 feature。
3. **特徵化原則**：測試釘「現行行為」；揭露疑似 bug → 先回報使用者，註解標「疑似 bug 已回報」，不默默改產品碼。已知刻意特徵：`formatNumber(null)="0"`、`addMonthsCompact` 回目標月 1 號、enrich 查不到 reference 時 price=undefined、`decryptJson` 竄改密文會 throw。
4. fixtures **日期全用相對今天位移**（fixtures.mjs 的日期工廠），絕不寫死絕對日期。
5. fixture 欄位名 **1:1 抄 server.mjs 消費端**（含官方拼錯字），懷疑漂移跑 test:live。
6. runtime DB mutation 測試不能只看 response：持久化失敗時要同時驗 `503 PERSISTENCE_FAILED`、pending／失敗 draft 從未發布、API 與 `loadDb()` 始終只看到上一個已提交 RAM／rev、失敗 save 仍讓 `dbMutationEpoch` 遞增一次，以及下一筆成功寫入不夾帶失敗資料。`skipDbMutation()` 搭配 dirty draft 必須回 `DB_MUTATION_SKIP_DIRTY`，且 RAM／磁碟／epoch 不變。queue tail 必須永遠 settled：business 4xx／安全丟棄的 503 只拒絕當次 caller，不污染下一筆或 shutdown，也不需要成功 mutation 清洗 queue。
7. 所有需登入的 runtime mutation 都要測提交時 auth：請求在讀 body／查上游／等 queue 期間可能 session 過期、被重設、帳號消失或角色降級；進 queue 後必須重驗最新 session/current user/角色，restore 另對最新 `passwordHash` 重驗目前密碼。DB mutation epoch 只 guard preview 生成與還原點 snapshot 穩定；已發 token 主要綁 session／個人 rev／共享備註 rev。

## 模組級快取的測試約束（單行程單例）

- `node --test` 每檔一個行程 → env/模組快取天然隔離；但**同檔內**要注意：
  - `buildVerificationHistory` 為 pending 60 秒／全部完成 10 分鐘快取；同檔仍只呼叫一次並放最後。`getMarketSummary`（15 秒）同理。
  - institutionalCache/marginCache 以請求日期為 key → 每個情境用**不同基準日**（surveillance-board 用遞減基準日）。
  - loadDb 情境（壞檔恢復／備份輪替／read error）**一行程只能測一種** → 先 mkdtemp＋預埋 fixture，再以 `importServer({ dataDir, dbPath })` 顯式傳入；不要手動留下 ambient env。helper 固定 `ADMIN_USERNAME=admin`／`PORT=0`，清除 `SESSION_MAX_AGE_MS`／`COOKIE_SECURE`，未收到 `dbPath` 時再刪除 `process.env.DB_PATH`。
  - lifecycle 測試同檔共用 module 級 server；冷啟動競態、並發 start identity 與 invalid listen listener 要先測，啟動完成後的 health／flush／shutdown 放後面，避免已停止的單例污染前置情境。
  - `instance-lock.test.mjs` 必須 spawn 真 `node server.mjs` 才能驗統一 writer-resource lease；現有 10 個 top-level cases 覆蓋 DATA_DIR/canonical alias、canonical immediate-parent transient guard、外部與父子 DB target、DB tmp、backups、三個 sidecar target＋tmp、DATA_DIR immediate parent 缺失時拒絕遞迴建立、fixed writer entry 的 directory／symlink／hardlink、daily／pre-restore backup entry 的大小寫不敏感安全掃描、backups 外逃／內部／dangling alias 與非目錄、DB reserved path segment，以及 bind failure 接手。不能在同一 imported module 內模擬。
- 有狀態 mock 路由（先 409 後 200）用 fetchRoutes 函式形式＋Node 閉包計數；per-test 覆寫用 `mock.override`（LIFO，回傳移除函式）。
- taifex MIS 日夜盤同 URL 且 fetch-mock 看不到 POST body → 兩時段只能回同一份。
- 測 fetchJson 逾時：把 `globalThis.fetch` 換成「只在 options.signal abort 時 reject」的假 fetch（fetch-mock 的 reply 拿不到 signal，不能用它模擬掛死），測完還原。

## 前端 harness（dom-harness.mjs）

- app.js 必須以 **`<script>` 元素注入**（classic script 頂層 const 才進 global scope，`evalIn` 才讀得到 `state`）；不要改成 `win.eval(整份)`。
- 跨 realm 物件比對先 JSON round-trip（deepStrictEqual 會比 prototype）。canvas 是 Proxy no-op mock（measureText 回 len*7）。
- app.js 尾端有 10 秒 setInterval → 每檔必須 `after(() => app.cleanup())`。不要用 `--test-force-exit` 掩蓋洩漏；Node 24／Windows 在 child-process pipe 關閉中強制退場可能觸發 libuv assertion。
- 需要登入態/資料的渲染測試：evalIn 注入假 state 再呼叫 renderXxx()。

## Windows／整合測試四雷（實踩過）

1. bootServer 整合測試裡 **undici 回應 body 一定要消費完**（`await res.json()` 或 `.text()`），否則 Windows 上會殘留 HTTP handle；獨立小測試檔特別容易中——HTTP 整合測試盡量併進 api-*.test.mjs 既有檔。清理要 `await srv.close()`，讓 helper 透過 `shutdownServer()` 排空寫入後才還原 fetch mock／刪 DATA_DIR；不可直接 `server.close()`。
2. 模組級惰性初始化被 Promise.all 並發呼叫 → 必須 single-flight（存 promise 不是旗標）。
3. pollUntil 讀 fire-and-forget 寫的檔要把 JSON.parse 包 try 回 null（writeFile 非原子，會讀到半個檔）。
4. `api-persistence-rollback`／`transaction-queue-tail` 用建立 `stock1-db.json.tmp` 目錄阻擋 atomic write。故障解除只需移除 blocker；rejected operation 的 queue tail 已自行 settled，可直接驗下一筆 mutation 或 graceful shutdown，禁止再加「先做成功 mutation 洗 queue」的測試前提。

## 測試檔分區（放哪裡）

- `tests/backend/`：純函式（quote-normalizers/overnight-engine/history-aggregate…）、離線端對端（surveillance-board；另以 `surveillance-quote-alignment.test.mjs` 鎖卡片與詳情的 MIS 報價對齊）、HTTP 整合（api-auth/api-data/api-admin）、韌性（reference/company last-good＋single-flight、fallback quote immutability、atomic-write temp link 防護、db-recovery×3／db-read-error／db-backup／fetch-timeout）、交易日與 exact-next-day／盤中觀察驗證、boot-preserved（全案例 `PORT=0` 的真入口＋production／對外綁定安全門檻）。交易帳本 v2 另由 `trades-v2.test.mjs`、`trades-migration-load.test.mjs`、`trades-v2-api.test.mjs` 覆蓋；`personal-data-portability.test.mjs` 鎖備份隔離、checksum、兩階段 token、最新密碼重驗、共享合併／全域 note id、16 MiB bundle 與 wrapper 邊界及還原點，`auth-delayed-body-race.test.mjs` 鎖 body 延遲期間 session 失效的 TOCTOU，`lifecycle.test.mjs` 鎖 health、啟停競態與 persistence drain，`api-persistence-rollback.test.mjs` 鎖 copy-on-write transaction 的 503／draft 不發布／失敗資料不外洩，`transaction-queue-tail.test.mjs` 鎖 dirty skip、business 4xx／安全 503 後的下一筆與 shutdown，`instance-lock.test.mjs` 以 10 cases 鎖統一 writer-resource namespace、DATA_DIR parent guard、fixed／backup entry 型別與接手。
- `tests/frontend/`：jsdom 渲染與領域邏輯（filter-sort/market-clock/quote-merge/holdings-render/swing-verify-render/overnight-verify-render…）；`watchlist-layout-typography.test.mjs` 鎖自選股字級、欄寬與成交價／漲跌幅置中分列；`overnight-layout-typography.test.mjs` 鎖隔日沖摘要、驗證與清單字級，以及資料可信度滿寬狀態列；`screener-layout-typography.test.mjs` 鎖盤中選股自架字型、數字角色、欄寬與可讀下限；`strategy-layout-typography.test.mjs` 鎖策略雷達資訊分組、完整寬度、字級與桌機／手機欄數；交易 v2 表單、來源 badge、隔離提示、載入更多與一般交易修正集中在 `trade-v2-form.test.mjs`；`account-backup.test.mjs` 鎖更多頁 tile、下載安全、檔案預檢、preview／commit、帳號切換競態與 modal a11y。
- `tests/helpers/`：fetch-mock、fixtures（日期工廠＋官方欄位工廠）、test-server（importServer/bootServer/pollUntil）、dom-harness。
- `tests/live/`：upstream-shape（opt-in）。

## 交易帳本 v2 的最低回歸矩陣

- 稅則：一般股票、完整／部分當沖、優惠首尾日、債券指數 ETF 停徵首尾日、股票型／主動式／槓反 ETF 與 ETN、未知商品保守估算；任何有效日調整都要補「前一天／第一天／最後一天／隔天」。法規基準日為 **2026-07-13**，改規則前先重查 `stock1-domain` 所列官方來源。
- 金額來源：manual／broker 明確 0 元要 round-trip；新紀錄或經濟內容變更時，client 自填的 estimated／legacy 金額與 rule id 必須被後端重算；經濟內容未變的既有 estimated／legacy 與 manual／broker 要保留凍結值。settings 改變不能追溯舊紀錄。
- 遷移：v1→v2 的 fee/tax 凍結、舊 ETF／當沖映射、壞紀錄 quarantine、重複 id、冪等第二次載入、只 bump 一次 rev、寫入前每日備份都要釘住。不可只驗正常 records 而漏掉 `quarantinedRecords`。
- API：未來 schema 回 422、v2 欄位嚴格驗證、GET/PUT schemaVersion 與 quarantine 保留、portfolio 稽核欄位、409 重放後仍保留巢狀 dayTrade 與 source；同 rev 並發 PUT 經過官方 await 後只能一筆成功，另一筆必須 409。
- 前端：4～6 碼英數代號（含 `00725B`）、商品與當沖欄位分離、部分配對、券商實際 0 元、股利模式禁用無關欄位、初始 40 筆與載入更多、修正回填／儲存／取消、清空實際費稅回估算、legacy 無經濟變更不重算。
- 官方商品主檔要覆蓋 TWSE 歷史／目前掛牌、TPEx 七類 ETF、來源降級、負向不可確認、成交日早於掛牌日，以及同 id 改成交日重新核定。仍沒有自動配對／先賣後買或多券商方案；測試應把後三者當**已知限制**，不要用假 fixture 讓產品看似已有能力。

## 已知 backlog（評估過投報比，暫不做）

scanSwingBoard 全市場離線端對端（要 mock 數百條月歷史路由）、富邦 SDK 深度 mock、app.js 覆蓋率歸屬（技術限制）。
