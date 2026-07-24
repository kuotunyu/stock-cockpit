# Stock1 測試套件

零框架：Node 內建 `node --test`（Node ≥ 20；本專案用 Node 24）＋ `jsdom`（唯一 devDependency，前端用）。

## 怎麼跑

```powershell
npm test              # 後端 + 前端（全離線、臨時埠，絕不碰 5174）
npm run test:backend  # 只跑後端
npm run test:frontend # 只跑前端（jsdom）
npm run test:coverage # 覆蓋率（見下方「覆蓋率說明」）
npm run test:live     # 【選跑】真打 TWSE/TPEx 驗證上游欄位形狀（偵測 fixture 漂移）
```

- 預設 `npm test` **完全離線**：`tests/helpers/fetch-mock.mjs` 攔截 `globalThis.fetch`，未接路由的外部 URL 直接 throw。
- 測試伺服器一律 `startServer(0)` 綁**臨時埠**；`boot-preserved.test.mjs` spawn 真正的 `node server.mjs` 時所有案例也都明確設 `PORT=0`，由 OS 配發臨時埠，證明正式啟動路徑未被改變且絕不碰 5174。
- `node --test` **每個測試檔一個行程**：env、模組快取（`survBoardCache`／`referenceMarketCache`／`companyDirectoryMarketCache`／`productDirectoryMarketCache`／`dividendMarketCache`／`tradingCalendarSourceCache` 等）天然隔離。

## 結構

```
tests/
├─ helpers/   fetch-mock（URL 路由 mock）、fixtures（相對今天的資料工廠）、
│             test-server（bootServer/importServer/pollUntil）、dom-harness（jsdom 載入 app.js）
├─ backend/   純函式（dates/parsers/crypto/surveillance-classify/technical-math/picks-swing/
│             quote-normalizers/overnight-engine/history-aggregate）
│             ＋ surveillance-board 離線端對端 ＋ surveillance-history（快照 diff）
│             ＋ institutional-margin / signal-verify / market-summary（fetch-mock 離線）
│             ＋ reference cold-start/single-flight/last-good/date alignment
│             ＋ company-directory single-flight
│             ＋ product-directory parser／七類 TPEx 原子快照／single-flight／last-good
│             ＋ 除權息雙市場 last-good／半包防護／撤回修訂／來源新鮮度
│             ＋ 官方公司行動公式、未完整公告阻擋、scan/inspect 真整合
│             ＋ fallback quote immutability／未知市場雙市場備援
│             ＋ trading-calendar／signal exact-next-trading-day／intraday observation
│             ＋ db-recovery×3（JSON SyntaxError 壞檔恢復三情境，各自獨立行程）
│             ＋ db-read-error（read I/O／型別錯誤 fail-closed，不冒充 JSON corruption）
│             ＋ atomic-write（同一路徑併發落盤不互搶暫存檔）
│             ＋ db-load/save queue（冷啟動 single-flight＋失敗後可恢復）／每日備份同日重試
│             ＋ trades-v2 / trades-v2-api / trades-migration-load（商品與當沖拆模、
│               有效日期稅則、實際 0 元費稅、v1 遷移備份與 quarantine）
│             ＋ trades-instrument-provenance／trades-concurrent-provenance（官方分類、
│               估算金額信任邊界、上市日與同 rev 併發 commit 防護）
│             ＋ api-auth / api-data / api-admin（HTTP 整合：登入政策、資料端點、
│               帳號管理＋自改密碼＋登入防爆破）／login failure store 容量與過期清理
│             ＋ heavy-runtime-cache（隔日訊號／回測的 bounded TTL LRU、同 key single-flight）
│             ＋ fetch-timeout（fetchJson 逾時保護）
│             ＋ personal-data-portability（匯出隱私邊界、checksum、預覽、一次性 token、
│               密碼再驗證、精確還原點、共享資料安全合併與 stale 防護）
│             ＋ auth-delayed-body-race（讀 body 期間 session／角色變動的 TOCTOU 防護）
│             ＋ api-persistence-rollback（copy-on-write runtime mutation 落盤失敗統一 503、
│               draft 不發布，後續成功寫入不得夾帶失敗資料）
│             ＋ transaction-queue-tail（dirty skip guard；business 4xx／安全 503 不污染 tail）
│             ＋ instance-lock（10 cases：統一 writer-resource namespace、路徑邊界與接手）
│             ＋ lifecycle（health readiness、啟動／關機競態、寫入排空與重入安全）
│             ＋ boot-preserved（全案例 PORT=0 的正式入口＋production／對外綁定安全設定）
├─ frontend/  formatters / filter-sort / market-clock / quote-merge /
│             surv-visible-list / surv-render / watchlist-state / accessibility-semantics /
│             detail-freshness / chart-geometry / overnight-verify-render /
│             screener-layout-typography（盤中字型、欄寬與可讀下限）/
│             strategy-layout-typography（策略卡資訊流、字級與響應欄數）/
│             modal-manager / render-lifecycle（輪詢合併、焦點與表單草稿）/
│             trade-v2-form / trade-edit-conflict /
│             trade-product-directory / account-backup（下載、預覽、確認、帳號切換競態）/
│             service-worker（自有 cache namespace 與離線策略）
└─ live/      upstream-shape（25 項 opt-in；含 TWSE/TPEx 公司行動與 ETF 商品主檔契約；網路失敗會 skip 不 fail）
```

## 重要慣例（改測試前先讀）

1. **一般日期永遠用相對位移**：處置期間等時間性 fixture 由 `fixtures.mjs` 以「相對今天」產生（`compactToday(offset)`），任何日期執行都確定。**不要**在一般 fixture 裡寫死絕對日期。唯一必要例外是法規 effective-date 邊界測試：法定起訖日本身就是契約，必須固定寫出絕對日期。
2. **surveillance-board 測試的日期策略**：同檔內每個測試用「遞減」基準日（today、-1、-2…），快取（以日期為 key）不互撞、先前寫入的歷史快照也不會被誤當「昨天」。歷史 diff 測試獨立成 `surveillance-history.test.mjs`（要在 import server.mjs **之前**預埋快照檔）。
3. **前端 harness**：app.js 必須以 `<script>` 元素注入（classic script 頂層 `const` 才會進 global lexical scope、之後 `evalIn` 才讀得到 `state`）；**不要**改成 `win.eval(整份 app.js)`。跨 realm 比對物件請先 `JSON.stringify` 再 parse（避免 deepStrictEqual 的跨 realm prototype 問題）。
4. **測試檔務必 `after(() => app.cleanup())`**：app.js 載入尾端有 10 秒 `setInterval`，不關 window 行程會掛住。npm scripts 刻意不用 `--test-force-exit`；Node 24／Windows 在仍有 child-process pipe 時強制退場可能觸發 libuv assertion，因此測試必須自行完整清理。
5. **Windows**：`node --test` 的參數用 **glob**（`tests/backend/*.test.mjs`）；這版 Node 24 傳目錄會被當單一模組執行而失敗。動態 import 一律 `pathToFileURL`。
6. **特徵化原則**：測試釘住「現行行為」；若測試揭露疑似 bug，先回報使用者、不要默默改程式行為。
7. fixture 欄位名 1:1 抄自 server.mjs 消費端；懷疑官方改版時跑 `npm run test:live` 驗證。
8. **隔日驗證 fixture 要分清 D0／D1／D2**：D0 是訊號日、D1 是實際下一交易日、D2 是較晚重新開啟 App 的日期；斷言只能採用 D1 的 exact-date OHLC，不能用 `> signalDate` 隨便取較晚資料。盤中測試需分別覆蓋 MIS 原始 O/H/L 完整與缺欄兩種情境。
9. **持久化失敗測試要驗 copy-on-write 可見性、epoch 與下一次落盤**：只斷言 503 不夠；必須確認 pending／失敗 draft 從未發布，`loadDb()` 與 API 讀取始終只看到上一個已提交版本，`dataRevs`／`sharedRevs` 不變，而失敗 save 仍讓 DB mutation epoch 保守遞增一次；解除故障後的成功 mutation 也不能夾帶先前失敗資料。`skipDbMutation()` 只能搭配 pristine draft，dirty skip 必須回 `DB_MUTATION_SKIP_DIRTY`，且 RAM／磁碟／epoch 都不變。`api-persistence-rollback.test.mjs` 以阻擋原子 `.tmp` 路徑製造真實寫入失敗。
10. **transaction queue tail 永遠 settled**：business 4xx 與已安全丟棄 draft 的 `503 PERSISTENCE_FAILED` 只拒絕當次 caller，不得污染下一筆 mutation 或讓 `shutdownServer()` 誤判失敗。故障 blocker 移除後可直接安全關機；不可再要求先做一筆成功 mutation「洗掉」rejected queue。
11. **登入 mutation 防 TOCTOU**：入口 auth 只能用來早期拒絕；真正進入 transaction queue 後要用最新 DB 重驗未過期 session、current user 與角色。restore 還要對最新 `passwordHash` 重驗目前密碼；preview／還原點建立期間用 DB mutation epoch 檢查 snapshot 穩定，已發 token 則主要綁 session、個人 rev 與共享備註 rev。
12. **writer-resource lease 用獨立程序驗**：`instance-lock.test.mjs` 必須 spawn 真入口，現有 **10 個 top-level cases**：①同 DATA_DIR／canonical alias 競爭與接手；②外部 DB_PATH 拒絕；③父子 DATA_DIR 共用 DB target；④DB atomic temp 互斥，反向已存在的 writer directory 以 `WRITER_ENTRY_UNSAFE` 拒絕；⑤backups／其 daily entry 與另一 DATA_DIR 互斥，entry 名稱大小寫不敏感且 directory／symlink／hardlink 以 `BACKUP_ENTRY_UNSAFE` 拒絕；⑥DB temp／三個 sidecar target＋tmp 及其 subtree 不得被當 DATA_DIR，DATA_DIR immediate parent 不存在時不可遞迴建立，反向固定 writer directory 亦拒絕；⑦backups 外逃 alias／內部 alias／一般檔案／dangling symlink；⑧DB_PATH 任一 segment 使用 backups／sidecar／sidecar temp 保留名稱；⑨DB_PATH 是目錄或 hard link；⑩HTTP bind failure 後釋放並接手。啟動會用 canonical immediate-parent transient guard 封住既存 writer subtree；測試清理仍遵守 stop-old → start-new。
13. **DB corruption recovery 只認 JSON `SyntaxError`**：主檔 `readFile` 的 `EACCES`／`EIO`／`EISDIR` 等錯誤必須原樣 fail-closed，不能改名原路徑、不能嘗試備份或空 DB；`db-read-error.test.mjs` 與三個 `db-recovery*` 分別釘住兩條路徑。
14. **atomic temp 不可 follow**：`atomic-write.test.mjs` 預埋 hard-linked `.tmp`，確認 `writeFileAtomic()` 先 unlink、只忽略 `ENOENT`，再以 `wx` 建新檔；sentinel inode 不得被改寫。

## 覆蓋率說明

- 現況（2026-07-15）：最新 `npm test` 共 **543/543 項離線測試**（後端 339、前端 204；後續仍以最新 TAP 為準）；`npm run test:live` 共 **25 項 opt-in 契約**。`server.mjs` 覆蓋率為**行 89.29%／分支 77.30%／函式 89.53%**。
- Node 24 原生 coverage 無法正確合併「同一 ESM 加 query-string cache bust」的多份來源。`scripts/test-coverage.mjs` 會先正常跑 **7/7** 項 cache-bust 契約（不納入原生 coverage 合併），再把其餘 **511/511** 項 measurable tests 用 `--test-concurrency=1` 收集可信聯集；不要把它改回單一 glob coverage 指令，否則報表會假降到約 16%。
- `app.js` 在 jsdom 內以 script 注入執行 → **拿不到覆蓋率歸屬**（eval 類執行的既知限制；c8 亦同）。前端品質由測試清單保證，不看百分比。

## server.mjs 的測試掛鉤（唯一產品碼改動）

- 檔尾 `export { ... }`：純函式＋資料層＋`server`／`startServer`／`shutdownServer`／`flushPersistence`。
- `if (!process.env.STOCK1_SKIP_LISTEN) startServer();`：測試 import 前設 `STOCK1_SKIP_LISTEN=1`，再自行 `startServer(0)`。
- `importServer({ routes, dataDir, dbPath })`／`bootServer({ routes, dataDir, dbPath })` 會在 import 前以**顯式 options**設定隔離環境；需要預埋 DB／備份的測試先建立目錄與 fixture，再把路徑傳入 helper。helper 固定 `ADMIN_USERNAME=admin`、`PORT=0`，清除 ambient `SESSION_MAX_AGE_MS`／`COOKIE_SECURE`；未傳 `dbPath` 時也必須刪除 `process.env.DB_PATH`，不可讓外部 shell 或前一情境污染測試。一般測試一律走 helper 的顯式 options，不直接修改 ambient `DATA_DIR`／`DB_PATH`。
- `bootServer().close()` 會走正式 `shutdownServer()`：HTTP listener、未完成的持久化寫入與券商清理都必須排空；測試不得只直接呼叫 `server.close()` 留下背景工作。
- runtime DB 寫入走 `commitDbMutation()`；queue tail 會自行吸收當次 rejection 並保持 fulfilled，`flushPersistence()` 仍會等待所有 pending mutation。測試製造 business 4xx 或已安全丟棄的 persistence failure 後，只需移除暫時性故障 blocker，即可直接驗證後續 mutation 或安全關機；不要額外做一筆成功 mutation 來「清洗」queue。
