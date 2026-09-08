# Stock1 測試套件

`operational-status` 另驗台北午夜前／後同一 HTTP 投影的今日上限、失敗日與計數保留、GET 無寫入及解除 blocker 後仍須真正成功保存才清旗標。`detail-empty-state` 依實際 `loadedOnce/error` 驗初始等待、離線失敗、完成空資料與有效股票保留；PWA 真離線重開同步核對右側占位。

`measurement-diagnostics` 用確定性小型工作量驗全部 renderer 探針的 `missing`／`not-called`／`measured`、巢狀 raw 樣本、安裝錯誤與 finally 復原；Chromium `measurement-probes` 只跑一輪真 renderer 核對序列化接線。`verification-measurement` 的自建空 DB 與 atomic blocker 只在局部捕獲並斷言已知 admin／unlink 訊息，缺訊息或重複訊息會失敗，未知 stderr 與例外保留。這些診斷修正不要求重跑完整 O08 分組，也不改寫歷史量測。

`verification-measurement` 驗診斷樣本至少 50 筆才標描述性 p95、nearest-rank、固定種子、合法規模與合成日期／模型身份／codec；沒有 CI 毫秒門檻。手動完整採樣入口是 `node scripts/verification-diagnostics.mjs --o08`，沿用原先 `node scripts/verification-diagnostics.mjs 5` 的完整候選池 fixture。完整入口依序跑 1／5／20 日的 raw／packed／mixed，各加一日兩策略 pending 與每完成日兩份手動計畫；每組 3 次暖機、50 次保存／並發查詢／摘要，3 個新 Node 程序重啟。每組輸出自己的摘要窗口、真實 DB／各資源 bytes、記憶體、event-loop histogram 及原始樣本。`--o08-worker 5 mixed` 可單獨重現指定組；入口不接受 DB 路徑，helper 清除 ambient DATA_DIR／DB_PATH、只用自建 temp 目錄與 port 0。

效能採樣前須另保存本機、seed／規模／次數、比較預算與量測定義；採樣後不能回頭調預算。預設 seed 8082026、暖樣本 50、冷樣本 3；少量冷樣本只列個別值／範圍，OS 檔案快取未清除。後端並發組實際走 `GET/PUT /api/watchlists`、`GET /api/quotes?codes=2330`，同時執行兩策略 `summarizeVerificationBenchmarks` 及兩筆真實 `commitDbMutation` cursor 保存。queue 指送交到第二筆 mutator 進入，包含前一筆保存等待及本筆 draft clone，不能稱純 queue scheduler 時間。行情是暖過的單一代號離線 fixture 路徑，並非全市場或真上游延遲；背景 workload 是摘要與 cursor 保存，未模擬完整上游採集。故障注入另在樣本外驗 503、pending／失敗不可見、rev 409、根物件 identity、後續保存及重啟 hash。

`--o08-browser 260` 以既有 `createBrowserFixture`、真正 headless Chromium 與 Canvas 量 20／260／1000 輸入列及實際 DOM 列，先於原 populated fixture 量普通 `refreshLiveData`，再於丟棄用 page 持有既有 in-flight guard，隔離純 `renderLiveDataUpdate`、`renderRows` 與排序事件。沒有修改產品計時入口。同步 JS、兩次 rAF frame opportunity、原生 button `.click()` 到 frame opportunity 分開；不是螢幕呈現或 OS 輸入延遲。分 renderer 採樣包含暖機且巢狀成本可能重疊；頁面 reload 不是冷啟整個瀏覽器。採樣時停 tracing、保留真 CSS／字型和 API 外網 tripwire；清理先關閉自有 browser／server，再核對並移除自建 temp。此量測不宣稱正式容量、金融有效性或效能 SLA；超預算只提出有遷移／回復前提的有界後續，不自動重構。

`pwa-lifecycle` 使用獨立 port 0 HTTP origin 和允許 SW 的 Chromium context，直接提供真正外殼檔案與共用合成 API。瀏覽器及 worker 都經實際網路；沒有 page.route 回填 API，離線以 context.setOffline 驗。一般 `createBrowserFixture` 仍預設 `serviceWorkers: "block"`，保持 UI 測試隔離。

PWA 案例涵蓋 A 整包安裝、B app.js HTTP 503 安裝失敗仍可讀取／重開 A、B 重試成功，以及舊分頁草稿／焦點／已載入身份保留、新分頁載入 B。關閉所有分頁後離線 query 重開、帶 query 資產、API HTTP 與離線失敗、非現役殘留 cache 不作外殼、沒有備援時保留 HTTP 錯誤都有斷言。專用 loopback proxy 拒絕轉送外網（另以真 worker 探針驗證），setup 失敗及一般完成均關閉自有 context／browser／server；不啟正式後端、不讀 `.env`／`.data`。截圖、trace 和 HTTP 請求紀錄在 `test-results/browser/pwa-*`。

```powershell
node --test tests/browser/pwa-lifecycle.test.mjs
```

外殼仍 network-first；網路／HTTP 失敗只從現役 worker cache 備援，API 不快取。整包安裝成功才啟用不等於多檔案部署具有交易原子性；網路成功時可能取得更新中的資產，外殼身份也只是已載入 app.js 的發行宣告。此套驗 Chromium 的同 context 離線重開，不聲稱已驗瀏覽器程序重啟、OS 安裝捷徑、Safari／iOS 或任意破壞性的跨版檔案相容。

`operational-status` 後端／DOM／Chromium 驗更多→資料來源的預設收合診斷：行情成功與保存受阻分離、完整零訊號正式發布、來源不足、正式後補驗失敗、排程關閉與查不到。`GET /api/operational-status` 公開白名單直接讀已提交 RAM，不寫入、不排背景工作、不解壓候選池證據；待補以全部保存版本的份／筆／批分列，沒有套用成績單最近窗口。保存旗標是本程序未恢復的已知失敗，不是新的磁碟探測。DOM 包含真 `fetchApi` body deadline 與重試，Chromium 包含四尺寸／200% 文字、原生 details 和輪詢焦點。

`runtime-version` 以臨時 Git repo／worktree 與冷程序鎖住模組載入身份：首次版本查詢前後改檔、重啟、dirty、無 Git 與純文件 commit；後端指紋只涵蓋公開來源及相依宣告，不代表實際套件或環境設定。`app-version-panel` 與 Chromium `app-version` 分辨執行後端／磁碟／載入 app.js 的外殼宣告，驗舊新分頁、舊後端缺身份、重啟／刷新優先訊息，以及 375／768／1280／1440 px 和 200% 文字。外殼改動須同步 `APP_SHELL_VERSION` 與 SW `CACHE_NAME`。

`windows-launcher` 使用臨時 `.env`／DATA_DIR／port 0 或 OS 配發後保留的自訂埠、真 server child 與離線 preload，驗 Node runtime 範圍、安裝失敗／lock 改變／實際缺檔／保留既有 dev 安裝、本次 IPC＋health 身份、占用埠、初始化／安全門檻、排程啟動、Ctrl+C 處理器、ready 逾時，以及模組載入前後父程序斷線。測試不開真瀏覽器或新視窗；開頁動作以局部注入記錄 URL，npm 安裝用臨時套件替身，不連 registry。Windows IPC 斷線後以 child `exit` 判斷程序結束，不能等待可能不送出的 `close`。可先跑 `node --test tests/backend/runtime-version.test.mjs tests/backend/windows-launcher.test.mjs tests/frontend/app-version-panel.test.mjs`。

`request-deadline` 驗 UI 分級等待上限、headers／JSON body、取消與來源切換、401、唯讀 fallback、寫入不跨候選重送，以及搜尋／分析／掃描的舊 finally 護欄。`write-outcome` 驗原 payload／rev／穩定 ID 的未確認恢復、背景 canonical 與後續草稿、watchlists／alerts 停止自動重送、復原未知與秘密不持久化；`backend/write-confirmation` 用 port 0、臨時 DATA_DIR、真實 transaction queue 驗同 rev 最多提交一次及正規資料確認。`trade-plan-outcome` 另鎖成交關聯與部分檢討 delta 的 canonical 確認、保存中意圖不可變、背景 GET 先到後修改草稿的恢復順序。未知後 GET 尚未看見資料不是失敗證據；只有使用者再次操作才可重試原 CAS payload，不能改 rev 盲重放。

`glossary-navigation` 的 DOM／Chromium 測試涵蓋七頁問號入口：首次定位當頁說明，切分類解除系統預填頁名，手動搜尋仍保留。另驗重新開啟、一般名詞表／名詞連結、分類重繪焦點及 Escape 回到問號；瀏覽器驗 375／768／1280／1440 px，截圖為 `test-results/browser/glossary-category-*`。

`help-content-lifecycle` 驗說明映射、分類內查無的恢復入口、未知詞與閱讀起點；`search-query-lifecycle` 以受控 debounce／延遲回應驗舊結果、成功／失敗、ABA、清空與重開。`zoom-help-lifecycle` 驗延遲導覽取消、手動說明及同代號重開競態；`screener-mode-state`、`surveillance-filter-feedback` 與 `filter-scope-feedback` 驗實際策略高亮、複合篩選空訊息與清單篩選作用範圍。Chromium `help-state-audit` 驗四尺寸、專用說明重開與篩選抽屜 200% 文字；`search-help-races` 用真輸入／Enter 與可控時鐘驗查詢切換、關圖取消導覽、首開與獨立說明入口。產物為 `help-recovery-*`、`filter-scope-*`。

`zoom-period-lifecycle` 另驗週期請求返回前關閉／同股或異股重開、日K快取重用、週期 ABA 與失敗後同週期重試；`technical-zoom-loading` 驗分析中不可放大保留的舊圖，但獨立說明仍可用。Chromium 補真延遲週K回應與同股日K快取重開；篩選抽屜在 375×700／200% 文字實際捲動到套用按鈕，隔日沖載入失敗的局部重繪亦須同步篩選提示。

持股情境風險的 `portfolio-plan-risk` 後端／前端測試涵蓋目前停損、部分計畫股數、到達／跌破、過期／多計畫衝突、缺行情與市場衝突、日期／來源有效性及集中度未知分母。共用 `portfolio-risk.js` 由 server 與 classic browser 載入同一份公式；以明確 `asOf` 驗盤中 120 秒產品容忍值與歷史官方收盤參考，不用星期推定最新交易日。可先跑 `node --test tests/backend/portfolio-plan-risk.test.mjs tests/frontend/portfolio-plan-risk.test.mjs tests/frontend/holdings-render.test.mjs`。

新單部位測試驗風險預算與明確投入金額雙上限、買費四捨五入／最低額及整張／零股。`capital` 為本機偏好，`availableCash` 只存本頁 RAM、切帳號清空；未提供則顯示資金未檢查。Chromium 同名案例在 375／768／1280／1440 px 與 100%／200% 文字驗資金欄位、持股風險、原生 details、計畫連結與更新後回焦，產物為 `test-results/browser/portfolio-{size,risk}-*`。此範圍不表示全站 200% 完成；固定底部導覽已由 T11 修正並驗證，詳見下方 T11 範圍。

個人交易計畫的 `trade-plans`、`api-trade-plans`、`trade-plans-portability` 與前端同名測試涵蓋初始草稿／首次啟用、上移停損、100 次修改上限、權限及 409 重放、雙擊、儲存途中輸入、帳號隔離、寫入失敗回滾、v1 保留／v2 匯入未驗證、還原點與隔離冷啟動。可先執行 `node --test tests/backend/trade-plans*.test.mjs tests/backend/api-trade-plans.test.mjs tests/frontend/trade-plans.test.mjs`，再跑完整套件。

Chromium 的 `trade-plans.test.mjs` 以真表單驗保存、上移停損、輪詢草稿、Escape 回焦、切帳號與 session 到期；375／768／1280／1440 px 各驗 100%／實際 200% 文字。使用隔離臨時埠，產物在 `test-results/browser/trade-plans-*`。此範圍不代表全站 200% 完成，固定底部導覽已由 T11 修正，覆蓋界線見下方 T11 範圍。

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

固定期間候選池回歸可跑 `node --test tests/backend/verification-benchmark*.test.mjs`：配對訊號與候選檔數分開、完整市場池才发布、官方第 15 個交易日、收盤凍結來源／價格修訂、公司行動還原、來源取得時刻與跨年月份覆蓋。cache 測試使用真 port 0 API 延遲來源驗先回 pending、4 檔游標由已採集完成的排程續跑、30 次實際來源呼叫上界（含重試）、來源故障／完成 memo 不回退、CAS、shutdown drain及獨立 Node 離線重啟。`holding-return-render` 和 Chromium `verification-benchmark` 驗獨立價格模型、配對與池 coverage、缺值、四尺寸／200% 文字及原生明細焦點；沿用原成績單視覺，不宣稱全站 200% 控制項已完成。
`verification-benchmark-calendar` 使用隔離 port 0 真 worker，重現月底早上快取到前一交易日、跨月來源失敗仍待補、充分證據恢復及完成後不可變；同時驗舊日曆 spec 不借用、共享 helper 預設介面相容、跨月慢請求不能按返回日封月。pure 測試另拒絕來源時間倒退，DOM／瀏覽器明細驗原採集版本可辨識且跳脫。

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

T05 成績單瀏覽器覆蓋包含隔日新 `cohort`／`captureCoverage`：375／768／1280／1440 px 各測原字體及 200% 文字放大，釘開盤僅 1 有效日、收盤 20 日、觸及 19 日及全缺欄位的不同門檻。主摘要與分母區需在 viewport 內，只有逐日明細獨立橫捲；原生 details 以 Enter 展開／收合並精確保留 summary 焦點。fixture 自驗每模型 issued 四狀態等式、完整 modelKey、raw metric 與顯示門檻分離；保留既有現代波段與 legacy fallback、登入失效、refresh 草稿檢查。這是成績單範圍驗證；當時發現的 375 px／200% 固定底部導覽文字互疊，後續已由 T11 修正並驗證；仍不能宣稱全站控制項皆已通過 200%。

### T06 假設含息持有

`verification-holding-return` 手算現金股利與兩個成本分母，涵蓋不再投入、配股／零碎結算、明確交付日期、現增、同事件重跑、應收轉支付、未知股數及事件coverage。`verification-holding-source` 驗 TPEx exDailyQ 的 schema／date／count／成功空清單、每仟股單位及有界single-flight。既有 corporate-actions／swing-verify 增加新舊模型與不可變原始部位的真接線，T05 合成 final fixture 明確提供含息證據。

新 cash identity：`swing-hypothetical-holding-v1`／`overnight-hypothetical-holding-v1`、`initial-notional-flat-0.471pct-v1`、`cash-holding-return`。原價格欄位保留；cash 欄位缺失不能套價格公式補造。`holding-return-render` 驗未知／零／負與模型文字；Chromium `holding-return` 在兩頁四尺寸、100%／200%字體驗模型區域與原生details鍵盤，保留既有價格fixture回歸。當時的固定底部導覽 200% 重疊已由 T11 修正並驗證，仍不代表全站 200% 認證。

`verification-holding-review` 覆蓋 TWSE 貨幣來源的缺表、完整 schema、查詢日期、畸形／重複列、已知截斷及完整空表；原價格月可用章不能替代 `monetaryCoverage`。同時測真 replay／隔日 observe 的不完整公告、重複公告歸檔，以及新 cash entries 保存的價格身份供尾部／次開摘要使用。TWSE 原回應無總筆數欄，無法偵測未宣告的合法 JSON 漏列；已有 sealed 月若缺新完整章會維持 cash unknown，歷史批次重新查詢可取得獨立證據，已結案結果不自動重算。

T07 `verification-cost-sensitivity` 與 `verification-r-multiple` 覆蓋 0／10／25／50 bps 單位、不重扣基準、成本反轉、缺值、950／500＝1.9R、負／零損益與非法風險；真成熟摘要、正式隔日 manifest 及公司行動退出接線驗各自分母、模型／成熟／分盤／位階分層、原始風險不隨調價或 JSON 重開改寫。`holding-return-render` 與 Chromium `holding-return` 驗百分比和 R 倍數分開、有效筆數／未知原因、成本反轉及可展開分層，四尺寸及 200% 字體沿用隔離 fixture。情境不更改日期、來源或成交行為，日期 sweep 僅在另有具體日期風險時追加。

```powershell
node --test tests/backend/verification-cost-sensitivity.test.mjs tests/backend/verification-r-multiple.test.mjs
```

```powershell
node --test tests/backend/verification-holding-return.test.mjs tests/backend/verification-holding-source.test.mjs tests/backend/verification-corporate-actions.test.mjs tests/backend/swing-verify.test.mjs
```


### T11 計畫成交關聯、檢討與局部可及性

`trade-plan-links` 同檔包含純規格及真正 HTTP 帳本／計畫保存：部分買入、分批賣出、未進場、結案後修正 metadata、跨計畫份額、來源修正／刪除、同帳號／市場／券商、queue 中最新來源與重新驗證登入。備份測試經實際匯出／預覽／復原核對將還原的帳本，保存已失效快照與檢討歷史，兼容缺新欄位的舊 v2。時間按台北成交日與帶時區的使用者輸入；等於首次啟用時間不能建立事前原風險。完整公司行動與應收覆蓋未知時，不把已關聯現金差額當完整計畫報酬或 netR。

`trade-plan-review` DOM 鎖結案經濟意圖唯讀、檢討仍可改、409 delta 重放、字串跳脫、帳號清除、行情表格角色／aria-sort、OHLC 視窗與保存 toast 去重。Chromium 同名檔驗七項導覽於四寬／100%及200%實際文字的標籤矩形與手機底部留白；由實際計畫表單走部分成交、結案、修正來源、重新關聯與未進場。另驗日／週 K 及放大視窗的 OHLC、鍵盤縮放／R 復位；用可見 rows 完成條件等待 rAF，不以任意 sleep 取代。幾何巡檢從獨立計畫列表開啟；手機詳情父層在切到桌面時原本會關閉，不將此當作新 modal 管理方式。

```powershell
node --test tests/backend/trade-plan-links.test.mjs tests/frontend/trade-plan-review.test.mjs
npm test
npm run test:browser
```

產物 `test-results/browser/t11-*` 包含對照、成交／檢討及 OHLC 截圖。保存通知按正常計時自然消失後才截可讀內容，不由測試刪除通知 DOM。44px 是常用操作的產品目標；WCAG 2.2 AA SC 2.5.8 的最小目標是24×24 CSS px並有例外。這些案例驗特定流程，不宣稱整站 WCAG 認證。

`fixture-lifecycle` 釘住真輪詢替换 DOM 後仍維持 200% 字級、100→200 往返不累乘，以及延遲提醒 API 回應後原生處置卡片回焦／草稿保留。文字放大 helper 僅用同源測試 stylesheet；手機重排停用後等兩幀讀天然字級，合併 childList 更新並等待收斂，不關閉輪詢或放寬產品 CSP。OHLC reader 用原生方向鍵捲動；圖表控制區仍驗加號與 R，首次操作說明以正常關閉完成。

### Actions 固定來源更新

工作流程以官方 `actions` repository 的完整 commit SHA 固定來源，旁註對應版本。更新時先用 `gh api repos/actions/<action>/git/ref/tags/<version>` 核對 tag 指向（annotated tag 另解參照），再讀該 SHA 的 `action.yml`，確認 runtime、inputs 與官方 release notes；最後更新兩份 workflow 並核對實際 GitHub run。保留 Node 22.x／24.x 測試矩陣、獨立 Node 24 Chromium、Reliability 排程／手動觸發及 `contents: read`。本機測試不能代替 GitHub Actions 執行結果。

### 有界維護與完整格式診斷

`node scripts/verification-diagnostics.mjs 5`（最大 20 日）只建立隔離的離線合成 DB，不讀正式資料、不啟 HTTP。每天 260／240 候選、20／40 訊號，含真 publication、inputEvidence、manifest、issued、完成的隔日 2 列與波段 15 列 benchmark memo；報告各資源與樣本 cohort 大小、相同資料 raw／壓縮後原子保存、COW、真正冷行程載入、摘要重算及官方日曆 loader 冷熱呼叫數。延遲是單次本機量測，不是 SLA；簡化 pick 與固定合成價格不能代表實際策略表現。

`verification-evidence-codec`／`verification-evidence-persistence`／`verification-compression-diagnostics` 驗 UTF8 無損、SHA256、未知 codec／損壞拒絕、32 MiB 解壓限制、完成 transition 的失敗回滾、queue／epoch、冷啟動與完整 DB 備份還原。只有新完成 memo 自動壓縮；舊 raw memo 不遷移。超過 codec 上限仍完整保留 raw，32 MiB 不是歷史或 cohort 上限。摘要與完成 worker 不需解壓；需查原證據時使用 `readBenchmarkEvidence`，錯誤不能當作缺資料而重算。

`swing-cache-bounds` 驗實際研究 scope 增長、LRU／TTL及場景共用；`notes-ownership` 的 backend／frontend 各驗 A/B/admin 作者與管理權；`broker-settings-guard` 驗對外訊息不洩漏绝對路徑、非預期錯誤安全診斷。鍵盤修改仍需完整 Chromium；DOM 不能代替真實原生按鈕與回焦驗證。
`calendar-evidence-consumers` 與 `calendar-recent-recovery` 驗不完整跨月的停損／達標差異、相互衝突的官方正證據、完整 stale 月份休市、成熟日期覆蓋、已知 v1 與 unknown/final 邊界；包括真正近期／歷史 runner 及隔日 observation 的缺章→恢復。近期案例不重設 advance key，以同一收盤日第二次 tick 確認可補驗。`getSwingHistoricalCalendar` 仍預設回三欄；需要原章的 consumers 明示 `includeSourceEvidence:true`。日期相關修改另跑受影響測試在跨年與跨月情境，無 UI 變更不需重複 Chromium。

`verification-compression-diagnostics` 另驗真實 >32 MiB 完成 raw、純 pack 原物件不變、完成狀態章 COW 與冷讀 hash，以及公開 1 日診斷的 before/after 聚合。新完成超限保存 skipped-size 章；舊 raw 為 legacy-or-unclassified，不自動遷移。knownBytes／knownCount 與 unknownCount 分開，packed 不 inflate，舊 raw 不為統計序列化。

`observation-source-provenance` 驗較早日僅存在官方月 K 的缺章→恢復、direct quote 原來源與正值、close-only 不冒充 price，以及真 getQuotes 的 Yahoo fallback 不變正式 final；原官方整批恢復與 MIS intraday 各有來源／phase 斷言。

## 整機備份一致性回歸

`node --test tests/backend/backup*.test.mjs` 驗證現役 DB_PATH、同分鐘重跑、失敗時舊包 bytes 不變、optional 缺失、manifest hash、成功包輪替與 canonical junction 邊界，並驗證現役 DATA_DIR 本身是有效成功包時仍不會被輪替刪除（含來源 junction alias）。`backup-fs-preload.mjs` 只由測試的 `--import` 載入，透過窄 filesystem 注入控制 read/write/fsync/rename 失敗與 CLI 持鎖時序，產品沒有測試環境後門。真 CLI 與 port 0 server 分程序互斥，並由 bootServer 建立帳本、計畫及正式發布，再停止原服務、還原到新隔離 DB_PATH，以獨立程序驗已載入欄位及基本面。lease-only context 另驗同模組重入與 idempotent release。全程不載入正式 `.env` 或 `.data`。
