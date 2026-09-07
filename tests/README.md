# Stock1 測試套件

Node 內建 `node --test`＋ `jsdom`（前端 DOM 測試）。使用 **Node 22.22.2 以上的 22.x、24.15.0 以上的 24.x，或 ≥26**；精確範圍為 jsdom 30 的 `^22.22.2 || ^24.15.0 || >=26.0.0`，比 App 本身的 `engines` 嚴格。CI 目前測 Node 22.x／24.x。

## 怎麼跑

```powershell
npm test              # 後端 + 前端（全離線、臨時埠，絕不碰 5174）
npm run test:backend  # 只跑後端
npm run test:frontend # 只跑前端（jsdom）
npm run test:browser  # 真實 Chromium UI 基準（node:test，序列執行）
npm run test:coverage # 覆蓋率（見下方「覆蓋率說明」）
npm run test:dates    # 【選跑】把時鐘平移到各種風險日期各跑一次全套（見下方「日期體檢」）
npm run test:live     # 【選跑】真打 TWSE/TPEx 驗證上游欄位形狀（偵測 fixture 漂移）
```

第一次在本機執行瀏覽器測試前，先安裝 Playwright 鎖定版本對應的 Chromium：

```powershell
npx playwright install chromium
```

`test:browser` 沿用 `node:test`，不另加 framework runner。`createBrowserFixture({ scenario })`
固定提供 `populated`／`empty`／`partial`／`expired-session` 四種 UI 消費契約；HTML、CSS、JS
仍由 `bootServer()` 在臨時埠提供，瀏覽器 API 回應則使用完整固定 fixture。它只允許本次 loopback
origin，所有其他網路請求直接中止，因此不會碰 live API、5174、正式 `.data` 或 `.env`。
每個案例都在 `finally` 關閉 page/context/browser，再由正式 `shutdownServer()` 排空伺服器與 timer。
排版案例會等待指定內容及 `document.fonts.ready`，不以 `networkidle` 或任意 sleep 猜完成時間。
失敗時 screenshot 與 trace 寫入 `test-results/browser/`；CI 的 Node 24 Chromium job 會上傳該目錄。

`test:dates` 與 `test:live` 都**不掛在每次 push 的 CI**（一輪好幾分鐘），改由
`.github/workflows/reliability.yml` **每天台北 06:00 排程執行**，也可以在 Actions 頁面手動觸發。
理由：這兩類問題結構上是 push CI 看不到的——日期炸彈平常永遠是綠的、時間到了才自己紅；
上游改版時離線測試用的是 fixture，永遠不會發現。
（`test:live` 網路失敗是 skip 不 fail，所以那個 workflow 另外會擋「半數以上 skip」的假綠燈。）

`test:live` 涵蓋的上游（2026-08-23 補齊主要資料路徑後）：處置／注意／鉅額／全額交割／整批收盤／
除權息／停牌／下市／交易日曆／ETF 主檔／TWT49U 計算結果表／Yahoo chart，
以及 **MIS 即時報價、期交所 MIS、逐檔月歷史 STOCK_DAY、三大法人 T86、上市與上櫃融資融券**。
最後那幾條是主畫面每天在用的資料路徑，先前完全沒有被檢查。
**每個端點的回應形狀不一樣**（`data[]` vs `tables[]`），共用的 `fetchLatestTradingPayload`
因此要求各測試自帶 `isUsable`——第一版用「假設有 data」的通用判斷，讓 MI_MARGN 靜靜地
永遠 skip，看起來很健康但從來沒檢查過。加新端點時要確認它**真的跑起來**，不是 skip 掉。

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
└─ live/      upstream-shape（opt-in 上游契約；網路失敗會 skip，不算已驗證）
```

## 重要慣例（改測試前先讀）

1. **一般日期永遠用相對位移**：處置期間等時間性 fixture 由 `fixtures.mjs` 以「相對今天」產生（`compactToday(offset)`），任何日期執行都確定。**不要**在一般 fixture 裡寫死絕對日期。唯一必要例外是法規 effective-date 邊界測試：法定起訖日本身就是契約，必須固定寫出絕對日期。違反這條的代價是**測試會在某天自己轉紅、而且沒有任何 commit 碰過它**（實例見下方「日期體檢」）；改完日期相關的測試請跑 `npm run test:dates` 驗一次。
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

## Mock 與驗證範圍

- `verification-metric-coverage` 以合法已保存 final 觀察驗證逐欄分母，涵蓋 0、全缺、不同日有效筆數、開盤缺值的 CI 日期，以及真 history API 的正式母體和零訊號採集；未知成本的原 true／false 保留但不進衍生淨勝負分母與 CI。`verification-cohort` 釘官方 15 交易日窗口、休市日、證據不足／下界、快贏快輸超時、缺 K 補齊、版本與分盤／regime 分層，並走真 summary 的日曆失敗及補齊路徑。固定日期案例均傳明確 asOf，涉及 builder 時局部設定測試時鐘。
- Chromium 的 populated／expired-session fixture 使用 `cohort`／`metricCoverage`／`captureCoverage` 新回應，partial 保留舊 payload 相容測試。分母區須能以鍵盤展開及收合，並驗證次開口徑與缺值文字；原四尺寸、200% 字體、精確回焦、登入失效及草稿保護斷言保留。

- `verification-retention` 驗證儲存保留與查詢窗口分離、16／4 組有界補判、歷史月份與跨年日曆、未知市場、來源失敗、已封月但被歸檔上限淘汰的公司行動，以及 copy-on-write 證據／游標回滾。`verification-retention-restart` 使用 1040 日純合成資料，經每日備份與真正 `scripts/backup.mjs` 還原至新臨時目錄，再以獨立程序在埠 0 啟動／關閉並比對 SHA-256；不讀正式資料或 `.env`。
- `node --expose-gc tests/helpers/verification-retention-bench.mjs 260`（或 `1040`）是手動同機量測，不是效能 CI 門檻。量實際冷 load、save、read/parse、summary 冷重建、暖機後函式與 JSON 序列化延遲，以及離線上游呼叫數與 GC 後記憶體；報告需保留同一 fixture 的前後值與量測方法。不要把函式快取命中時間當成完整 HTTP 延遲。

- `fetch-mock.mjs` 的 `match(url, init)` 與 `reply(url, init)` 都能讀取 method、body、headers、signal；`calls` 記錄 url／method／body／headers。同 URL 不同 POST body 可以分流，不必以日期或呼叫次數猜測。
- `dom-harness.mjs` 載入實際 HTML 與 app.js，但 Canvas、`matchMedia` 等由測試替身提供。jsdom 不計算真實 CSS 版面；DOM／樣式原文斷言通過，不代表欄寬、換行、遮擋、Canvas 繪製或手機互動已在瀏覽器驗證。
- UI 排版改動需另用真實瀏覽器驗證。預覽必須使用獨立資料目錄與 5180 或臨時埠，結束後完整關閉；不可連到使用者的正式 5174 進行測試。
- 測試數量與通過情況以這次命令輸出為準，不把某次歷史測量當作目前基準。

## 覆蓋率說明

- 覆蓋率是當次執行的測量，請以 `npm run test:coverage` 輸出為準；不沿用歷史百分比或固定案例數。
- Node 24 原生 coverage 無法正確合併「同一 ESM 加 query-string cache bust」的多份來源。`scripts/test-coverage.mjs` 先執行 `dividend-schedule-resilience.test.mjs` 與 `fundamentals-dividend-source-status.test.mjs` 的 cache-bust 契約（不納入原生 coverage 合併），再將其餘測試以 `--test-concurrency=1` 收集聯集。不要改回單一 glob coverage 指令；來源歸屬錯誤會產生失真的報表。
- `app.js` 在 jsdom 內以 script 注入執行 → **拿不到覆蓋率歸屬**（eval 類執行的既知限制；c8 亦同）。前端品質由測試清單保證，不看百分比。

## 日期體檢（`npm run test:dates`）

`scripts/date-sweep.mjs` 把系統時鐘平移到一組**相對今天算出來的風險日**，每個日子跑一次全套測試。

為什麼需要：fixture 幾乎都以「相對今天」產生，於是有一整類 bug 只在特定日子現形——平常怎麼跑都綠，時間一到自己轉紅，沒有任何 commit 碰過它。已經踩過兩次：

- `007e164`：fixture 只餵「本月」的歷史，今天落在 1~20 號時 MA20 資料不足 → 整檔股票悄悄消失。
- `efc12de`：測試寫死 `asOf "2026-07-24"`，而 `recordSwingVerification` 收尾會 prune 掉 90 天前的資料 → 2026-10-23 起那筆會被同一次呼叫當場刪掉。同一次掃描也抓到 `signal-verify` 每年 1/1 會壞（測試自己 mock 元旦，卻用只跳週末的 `compactTradingDay` 假設「今天是交易日」）。

掃的日期：下個月 1／3／最後一天、年末 12/31、元旦、閏日、下個週六日、**+100／+200／+400 天**（保留期／prune 類炸彈只有推夠遠才現形），以及同一個平日的 02:00／10:00／14:30／23:50 四個時段。日期一律相對今天產生——寫死清單的話這支腳本自己就會過期。

```powershell
npm run test:dates                       # 掃預設風險日（約 5–7 分鐘）
node scripts/date-sweep.mjs 2027-01-01   # 只掃指定日期，用來重現回報的災情
```

實作上兩個關鍵：時鐘用**平移**不是凍結（否則量測經過時間的斷言會失去意義）；jsdom 是**獨立 realm**、有自己的 `Date`，必須另外 patch，否則前端測試會出現「測試檔用假今天、app.js 用真今天」的假失敗。

日期體檢不在每次 push／PR 執行；由 [Reliability workflow](../.github/workflows/reliability.yml) 每日排程或手動執行。它驗證選定日期下的行為，不保證所有未來日期都正確。

## server.mjs 的測試掛鉤

- 檔尾 `export { ... }`：純函式＋資料層＋`server`／`startServer`／`shutdownServer`／`flushPersistence`。
- `STOCK1_SKIP_LISTEN=1`：測試 import 前停用正式自動啟動，再由 helper 呼叫 `startServer(0)`；收盤排程也由測試環境停用。
- `importServer({ routes, dataDir, dbPath })`／`bootServer({ routes, dataDir, dbPath })` 會在 import 前以**顯式 options**設定隔離環境；需要預埋 DB／備份的測試先建立目錄與 fixture，再把路徑傳入 helper。helper 固定 `ADMIN_USERNAME=admin`、`PORT=0`，清除 ambient `SESSION_MAX_AGE_MS`／`COOKIE_SECURE`；未傳 `dbPath` 時也必須刪除 `process.env.DB_PATH`，不可讓外部 shell 或前一情境污染測試。一般測試一律走 helper 的顯式 options，不直接修改 ambient `DATA_DIR`／`DB_PATH`。
- `bootServer().close()` 會走正式 `shutdownServer()`：HTTP listener、未完成的持久化寫入與券商清理都必須排空；測試不得只直接呼叫 `server.close()` 留下背景工作。
- runtime DB 寫入走 `commitDbMutation()`；queue tail 會自行吸收當次 rejection 並保持 fulfilled，`flushPersistence()` 仍會等待所有 pending mutation。測試製造 business 4xx 或已安全丟棄的 persistence failure 後，只需移除暫時性故障 blocker，即可直接驗證後續 mutation 或安全關機；不要額外做一筆成功 mutation 來「清洗」queue。

### 正式發布與模型版本回歸

`verification-capture.test.mjs` 及 `verification-population.test.mjs` 另驗 T04 manifest／issued 契約：候選在 preselection 凍結原始排序、價格與來源、真 builder 全失敗與顯示切片、manifest／正式清單同次落盤和回滾、冷啟動、官方交易日缺口的實際發現時間、週末嘗試不擴大交易日分母。issued 先保存再按各模型投影 noEntry／pending／resolved／unresolved，測跨場景身份、鎖死、跳空、晚發布上下界、缺開盤、行政未解結束及並發補證不覆蓋推進。新 next-open 模型只是沿原退出窗口的獨立價格觀察，測試不宣稱已建立完整交易模擬。

T04 排程修正另鎖真 builder 的 failed provisional 狀態、failed→incomplete→同內容 failed 的同毫秒重試順序及冷啟動、首次 formal／legacy 優先；逐階段注入 overnight／swing／reference／load／advance 失敗，確認每筆 attempt 只代表實際執行的工作。共享 reference 證據不會阻止尚未開始策略記錄 not-captured。

```powershell
node --test tests/backend/verification-capture.test.mjs tests/backend/verification-population.test.mjs tests/backend/close-scheduler.test.mjs
```

`verification-publication.test.mjs` 覆蓋首次完整發布、零訊號、研究 scope、逐檔完整性與 degraded、每場景上限、原計畫凍結、兩 builder 的場景／候選快取、手動 refresh、並發、atomic temp 故障及獨立 Node 冷啟動；另鎖兩階段發布時間、確認寫入失敗重啟、跨 09:00 上下界及並發補證不覆蓋已推進 entry。`verification-model-version.test.mjs` 驗 canonical 模型鍵、非破壞冪等遷移、memo 版本與輸入隔離、未知成本空值與摘要分組。`verify-history-memo.test.mjs` 驗 legacy 事後觀察 revision 落盤與離線重用；legacy final 原始證據不覆寫。數學 fixture 若期待目前成本的淨值，須明確給目前模型 identity，不可假造舊成本已知。

T03 修正回歸另走真實隔日 builder 的 HTTP200 未成功／TPEx 缺表／備援失敗與官方成功空資料；故障 logger 只在注入個案局部 capture、斷言及 finally 還原。模型測試包含部分未知但明確不相容的 pending、全數不支援不抓行情且游標不動；`swing-verify.test.mjs` 釘直接推進與 replay 邊界。`signal-verify.test.mjs` 驗同日 legacy A／formal B 的兩入口一致、完整 memo 價格欄位與 legacy final 原證據不另造 revision。

來源分類另由 `history-failure-propagation.test.mjs` 釘 TWSE 7855 上市前202607的已確認無資料形狀、超出範圍／未知錯誤／矛盾payload，以及TPEx缺表不接受TWSE文案。實際 builder 同時覆蓋9/10可評估的degraded正式發布與全部合法空資料／Yahoo失敗的正式零訊號；不得改成全候選來源100%成功門檻。

```powershell
node --test tests/backend/verification-publication.test.mjs tests/backend/verification-model-version.test.mjs tests/backend/verify-history-memo.test.mjs
```

T05 成績單瀏覽器覆蓋包含隔日新 `cohort`／`captureCoverage`：375／768／1280／1440 px 各測原字體及 200% 文字放大，釘開盤僅 1 有效日、收盤 20 日、觸及 19 日及全缺欄位的不同門檻。主摘要與分母區需在 viewport 內，只有逐日明細獨立橫捲；原生 details 以 Enter 展開／收合並精確保留 summary 焦點。fixture 自驗每模型 issued 四狀態等式、完整 modelKey、raw metric 與顯示門檻分離；保留既有現代波段與 legacy fallback、登入失效、refresh 草稿檢查。這是成績單範圍驗證；375 px／200% 固定底部導覽文字互疊已移交後續手機可及性工作，不能宣稱全站控制項皆已通過 200%。
