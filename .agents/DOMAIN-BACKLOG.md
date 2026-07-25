# Stock1 金融領域待辦清單

稽核日期：2026-07-26（Asia/Taipei）。**這是 living document**——修完的項目請在原地標註完成日期與對應測試，不要刪除歷史（沿用 `AUDIT.md` 的慣例）。

`AUDIT.md` 記錄的是**工程面**稽核（XSS、持久化、auth、無障礙…）。這份記錄的是**股票／金融專業面**：計算正確性、回測與前向驗證的方法論、台股市場結構、以及金額與時點的語意。兩份互補，都從 `stock1-domain` 的規格書出發。

## 怎麼讀這份

- **位置一律以函式名為主**，行號只是抓取當下（2026-07-26）的提示。專案慣例是 grep 函式名，行號會漂移。
- 每條標了 **證據強度**：
  - `已實測` ＝ 本輪實際跑過程式碼、看到錯誤數字。
  - `已查證` ＝ 由獨立審查員提出、再經對抗式查證通過，但未逐一重跑。
  - `待實測` ＝ 需要真實上游 payload 才能定論。
- **不要修的東西**：`stock1-domain` 明文記載的刻意決策（兩個選股引擎並存、中軌攻防常 0 檔、進場價＝當日收盤、注意／處置股顯示不排除、候選池 240／260 差異、MACD 用 8/17/9 參數）。這份清單已排除它們。

## 現況總表

| 層級 | 項目數 | 說明 |
|---|---|---|
| 已完成 | 6 | 2026-07-26 修畢，皆有測試與突變抽查 |
| 第一層 待處理 | 12（D-01～D-12） | 明確錯誤，正確答案沒有爭議 |
| 第二層 需拍板 | 14（D-20～D-33） | 真實缺陷，但修法牽涉口徑選擇 |
| 第三層 待查／限制 | 6（D-40～D-45） | 需重查官方原文，或現有資料源做不到 |

**建議的下一步**：第一層挑 D-01（補完除權息還原的回測缺口）與 D-05（tradeValue 恆 null 導致每一檔都掛「低流動性」）先做，兩者都不需要口徑決策；第二層先決定 D-20（毛報酬揭露），因為它同時影響 D-25 的 RR 門檻要不要納入成本。

---

## 已完成（2026-07-26）

| 項目 | 位置 | 測試 |
|---|---|---|
| 波段與隔日沖驗證的除權息還原（見下方 **D-01** 的剩餘部分） | `replaySwingVerificationHistory` / `observeSignalSnapshot` | `verification-corporate-actions.test.mjs` |
| 舊版 dayTrade 無 tax 時繞過有效日期套 1.5‰ | `normalizeTradeRecordV2` 的 legacy 分支 | `trades-v2.test.mjs` 既有案例未回歸 |
| 除權事件缺 `stockRatio` 卻算出 `ratio=1` 並蓋 official 章 | `officialCorporateActionRatio` | `corporate-actions-edge.test.mjs` 既有案例未回歸 |
| Yahoo 升格沿用不同交易日的昨收與量能 | `getQuotes` 的 Yahoo 升格區塊 | `yahoo-quote-freshness.test.mjs` |
| `realtimeCount` 把 `priceStale` 算成即時 | `getQuotes` 回傳的 `dataQuality` | — |
| 庫存報酬率分母含未報價部位 | `renderHoldingsPanel`（app.js） | — |

**實作中差點放行的回歸（值得記住）**：隔日沖側最初只比 `bar.previousClose` 與 `pick.price` 的大小就換基準價，但兩者來自不同來源與時點，正常差異就會誤觸發並**靜靜改掉所有報酬數字**。正確作法是先由 `corporateActionHistoryForCode` 確認當日真有官方事件。守門測試已釘住（「歸檔沒有事件時，價差再大也不可自作主張換基準價」）。

---

## 第一層：明確錯誤，可直接修

### D-01. 隔日沖**回測**仍用未還原股價（除權息還原的剩餘缺口）
`buildBacktestUncached`（server.mjs:7362，報酬計算約 7378 一帶的 `nextDayPerformance`）
證據強度：`已實測`（驗證側已修，回測側未動）

驗證引擎（`observeSignalSnapshot`、`replaySwingVerificationHistory`）已於 2026-07-26 修好，但**回測是第三條路徑**，`nextDayPerformance(history, index)` 直接拿 `next.open − signal.close` 算，歷史序列未還原。除權息日在回測樣本裡仍會產生假跌幅。

還有兩個未處理的子項：
1. **官方欄位不完整時不得推進**：`officialCorporateActionRatio` 回 null（`formulaComplete=false`）時，波段驗證目前仍會照常用原始價判定。應新增 `entry.corporateActionPending` 走既有停等模式，**不要沿用 `dataGap` 語意**（那只代表缺 K）。
2. **無償配股／現增會改變股數**，`shareFactor` 同時失真，只調價位不夠。

**修法**：回測側套用與掃描端相同的 `corporateActionHistoryForCode + backAdjustForCorporateActions`。
**測試**：`overnight-engine.test.mjs` 的回測案例。

### D-02. 隔日沖 `changePct` 與量比在除權息日用錯基準
`computeMetrics`（6371）、`preselectQuotes`（6595）
證據強度：`已查證`

候選池用 `quote.previousClose`（官方 `close − Change`，除權息日即參考價），`computeMetrics` 卻用「陣列前一根 close」。**同一天同一檔算出兩個漲跌幅**：一個決定進不進候選池，另一個決定分數與畫面數字。

- 配息 8 元、除息前收 100、參考價 92、除息日收 93：候選池算 `+1.09%`（＝交易所公告值），`computeMetrics` 算 `−7.00%`。三群門檻分別要 ≥3 / (≥5 或振幅≥6) / ≥0 → **除權息日的個股當天一律無法入選**（系統性偽陰性）。
- 量比更直接：除權（配股 30%）當日 `volumeLots` 是配股後股數、`avgVol5/avgVol20` 是配股前，`volumeRatio5` 憑空 ×1.3，直接撞上爆量高危的 `>= 3` 門檻。

**修法**：`computeMetrics` 優先用該根 K 自己的 `previousClose`，缺值才退前一根 close（`appendTodayCloseBar` 已帶入 `quote.previousClose`，相容）；量比同步套 `shareFactor`。
**⚠ 屬選股行為變更，需升 `OVERNIGHT_FORMULA_VERSION`**（讓舊快照不混入分母）。
**測試**：`overnight-engine.test.mjs`、`picks-swing.test.mjs` 的手算案例要重算。

### D-03. 逐月歷史抓取失敗被靜默吞成空陣列，日期缺口被誤判成公司行動
`getStockHistory`（4780）、`resolveCorporateActionAdjustments`（7918）
證據強度：`已查證`

`months.map(... .catch(() => []))` 把限流失敗吞掉，`flat().sort()` 直接接起來，全程沒有日期連續性檢查；`corporateActionGapRatio` 的基準是陣列前一筆，不保證是前一交易日。掃描端抓 6 個月，少一個月仍約 100 筆 > `fallbackMinRows 60`，最後一筆仍新鮮所以不算 stale，不會退 Yahoo。

缺口前 100、缺口後 118（跨月正常行情）→ 被判成公司行動，缺口以前所有價格被乘 1.18，MA60／布林／MACD 全被抬高；缺口落在最近 21 根內還會對使用者顯示「近期疑似權息跳空(估算還原)」這個**不存在的事件**。誤觸發後 source 只會是 `heuristic`，不進 `unresolvedIndices`，`scanSwingBoard` 的攔截擋不到。

**修法**：(1) `fetchStockHistoryMonth` 失敗往上傳遞並記進 `scanQuality.failureReasons`；(2) 還原之前用交易日表檢查日期連續性，有缺口標 unresolved；(3) `corporateActionGapRatio` 加上「前一筆必須是前一個交易日」前置條件。
**測試**：`history-cache.test.mjs`、`corporate-actions-edge.test.mjs`。

### D-04. `computeMacd` 無 warm-up 保護：月 K 幾乎每一檔都被 seed 污染
`emaSeries`（7496）、`computeMacd`（7518）、`buildTechnicalAnalysis`（7671）
證據強度：`已查證`（審查員實跑）

`emaSeries` 直接把第一個值當 seed，沒有「期數未滿回 null」保護；`movingAverageSeries` 有（所以放大圖前幾根 MA 顯示 `--`），MACD 從第 0 根就回數字。技術分析頁月 K 只抓 24 個月，彙總後常態 24~25 根，seed 在第 24 根權重仍有 **6.66%**——不是邊緣個股偶發，是月 K 常態。

18 根月 K、closes = `[50, 100×17]`（後 17 根零波動）→ 現行 dif **+6.05**、dea **+8.25**、histogram **−2.20**；正確值三者都是 **0**。dif 6.05 相當於股價 6%，是憑空造出的動能，`buildTechnicalSignals` 會據此吐「MACD 負轉正」給使用者。

**修法**：`computeMacd` 加 warm-up 遮罩（`index < slow-1` 的 dif 回 null、`index < slow+signal-2` 的 dea/histogram 回 null），或改 SMA seed。
**⚠ 相依**：月 K 的 `minBars` 從 18 提高到 ≥26 **必須同步放大抓取月數**，否則多數股票會落到「資料不足」而整頁打掉。波段引擎要求 ≥60 根、實抓 6 個月，seed 權重 0.09%，不受影響。
**測試**：`technical-math.test.mjs`。

### D-05. 當日 K 的 `tradeValue` 恆為 null：台積電也被標「低流動性」
`appendTodayCloseBar`（8360）、`buildRiskTags`、`scoreSwing`（8263）
證據強度：`已查證`

逐檔月歷史比整批收盤晚一天是常態（`appendTodayCloseBar` 註解自陳），補上去的當日 K 沒有成交金額，`computeMetrics` 的 tradeValue 取 `history.at(-1)`，於是**整份清單的 tradeValue 都是 null**。

- `!metrics.tradeValue` 對 null 恆為 true → **每一檔 pick 都掛「低流動性」**，包含成交數百億的權值股；標籤變雜訊，真正的低流動性警示一起失效。
- `scoreSwing`：成交金額 5,000 萬、股價 50 元的股票，走 tradeValue 分支得 `log10(5)×5 = 3.49` 分，退 avgVol20 分支（1,000 張）得 `log10(1000)×2.5 = 7.5` 分——同一檔同一天差 4 分（滿分 100），且隨官方月 K 更新快慢逐日跳動，**榜單排序跟著飄**。
- 回測分頁每筆恆掛「週轉率 N/A」：線上掃描有補 `computeTurnoverPct`，`buildBacktestUncached` 沒補。

**修法**：整批收盤 quote **沒有 tradeValue 可抄**——`normalizeDailyTwse` / `normalizeDailyTpex` 根本沒解析成交金額欄位。要嘛在正規器補上 TWSE `TradeValue` / TPEx 成交金額，要嘛用 `close × volumeShares` 估算並標 `estimated`。同時修 `buildRiskTags` 的 null 判斷、`scoreSwing` 兩條公式的尺度校準、回測補 `computeTurnoverPct`。
**測試**：`overnight-engine.test.mjs`、`picks-swing.test.mjs`、`parsers.test.mjs`。

### D-06. 資料可信度的 warnings 前端完全沒接
`app.js` 的 `dataState`（324）、`loadMarketData`
證據強度：`已實測`（`dataState` 確實沒有 `warnings` 欄位）

`realtimeCount` 已於 2026-07-26 修好，但另一半還在：`dataState` 連 `warnings` 欄位都沒有（旁邊的 `institutionalState` / `marketState` / `marginState` 全都有），後端 `getReferenceData` 產出的「上市與上櫃整批收盤資料日尚未對齊」與 last-good 沿用警語，在**主報價畫面完全不顯示**。同一批 warnings 在隔日沖摘要與策略雷達有渲染，所以這是漏接不是決定。

**修法**：`dataState` 加 `warnings: []`，在 `loadMarketData` 收集各批 payload 的 warnings 去重顯示，`dataQuality.degraded` 併入 `getDataTrustTone` 的判定。

### D-07. 處置看板鉅額／全額交割：上櫃硬比對日曆今日、上市不過濾
`getSurveillanceBoard`（5182）
證據強度：`已查證`

`today = toTaipeiCompactDate()` 是**日曆**今天不是最近交易日。TWSE 鉅額（BFIAUU）與全額交割（TWT85U）完全不過濾日期；TPEx 兩條硬比對日曆今日，註解寫「和 TWSE date=today 一致」與實際 URL 不符。

週末、國定假日與盤中未公布時段，「鉅額」「全額交割」**只剩上市股票，上櫃全部消失**，counts 跟著少算，`asOf` 仍標日曆今天，warnings 沒有任何覆蓋率提示 → 使用者以為上櫃今天真的沒有全額交割股。

**修法**：上櫃側改比對最近交易日（函式內已有 `tradingCalendar / todayIsTradingDay / nextTradingDate`），或取上游最大日期並一併回傳；任一市場缺當日資料就 push warning。
**測試**：`surveillance-board.test.mjs`、`surveillance-quote-alignment.test.mjs`。

### D-08. 選股用的處置名單沒有日期窗，已出關的股票仍被標「處置」
`loadRiskSets`（4931）對照 `getSurveillanceBoard` 的分類邏輯
證據強度：`已查證`

同一個 `announcement/punish` 端點，看板會用 `DispositionPeriod` 切成「即將處置／處置中／即將出關」，而且對 `daysToRelease < 0` 的列兩個桶都不放——**程式自己就預期清單裡有已過期的列**。`loadRiskSets` 卻把全部代號無條件塞進 surveillance Map。TPEx 變更交易那條反而有做日期比對，**內部標準不一致**。

已出關（最常見的偽陽性）與尚未開始處置的股票今天就被打上處置標籤，開了隱藏開關會誤刪正常交易的標的；反向地，程式手上有 `startsNextTradingDay` 卻沒帶到 pick 上。

**修法**：`loadRiskSets` 解析 `DispositionPeriod`，只把 `start <= 基準日 <= end` 標 disposition，尚未開始另給 `dispositionUpcoming`，並把 `startsNextTradingDay` 帶上 pick。
**⚠ 不要動注意股**：`announcement/notice` 只有 Code / NumberOfAnnouncement / TradingInfoForAttention，**沒有期間欄位**（見 D-44）。
**測試**：`risk-lastgood.test.mjs`、`risk-halted.test.mjs`、`surveillance-classify.test.mjs`。

### D-09. 股利紀錄被 canonicalize 跳過，`fee`/`feeSource` 完全由客戶端決定
`canonicalizeTradeMoneyProvenance`（3830）
證據強度：`已查證`（審查員實測）

規格明訂「estimated／legacy 的金額與 rule id 由伺服器管理」，但這個函式開頭就 `record.side === "dividend" → continue`；驗證層只對 manual/broker 要求附金額，`normalizeTradeRecordV2` 又直接採信 `raw.feeSource`。

送 `{side:"dividend", status:"received", fee:500, feeSource:"estimated"}` → 原樣落盤，伺服器不重算成預設匯費 10 也不降級成 manual。沒填 `receivedAmount` 時 `buildPortfolio` 的 fallback 是 `gross − fee`，這筆假匯費直接吃掉 500 元的已入帳淨額，還掛著「伺服器估算」標籤。

**危害範圍**：現行前端不會產生這個 payload（固定送 `fee: null`、從不帶 `feeSource`），這是**伺服器端資料契約缺口，不是可被外部利用的漏洞**。
**修法**：把 dividend 納入 `canonicalizeAmount`；`tradeMoneyEstimateFingerprint` 補上 dividend 的 status/receivedDate/receivedAmount。
**測試**：`trades-instrument-provenance.test.mjs`。

### D-10. 同一檔同時命中兩個分群時，勝率分母把它當兩個獨立樣本
`evaluateGroups`（6484）、`saveSignalSnapshot`（6747）、`observeSignalSnapshot`（7009）
證據強度：`已查證`

三段 if 是平行的、各自 push，**沒有 else**。`strongContinuation` 的條件是 `pullbackReversal` 的超集加上 `volumeRatio5>=1.5`，所以 changePct∈[3,5] 的紅 K **必定**同時進兩群（台股常見溫和上漲型態）。`saveSignalSnapshot` flat 攤平不去重，`observeSignalSnapshot` 的 `picks.map` 保留重複。

某天 8 檔雙命中 → summary 的 `total` 從 52 變 60，這 8 筆貢獻完全相同的漲跌結果，**分母虛胖、變異數被人為壓低**。分群統計（summaryByGroup）看重複沒問題，錯的是 summary 與 `buildVerificationHistory` 的 totals。

**修法**：summary 與 totals 先依 code 去重（保留 score 最高那筆）再統計，summaryByGroup 維持以 pick 為單位；body 加 `uniqueSignals` / `duplicatedSignals` 兩個欄位。
**測試**：`signal-verify.test.mjs` 的 totals 斷言。

### D-11. `pullbackDepthPct` 不要求低點發生在高點之後
`computeSwingFeatures`（7984）、`buildSwingPlan`（8227）的 measuredMove
證據強度：`已查證`

`recentHigh` 取近 20 根最高、`pullbackLow` 取近 12 根最低，視窗長度不同且**完全沒有要求 pullbackLow 的索引大於 recentHigh 的索引**。算出來的是區間振幅，不是回檔深度；註解自稱「近 20 日高點到站穩前的回檔低點」，程式沒有實作那個「之後」。

- 98~102 橫盤 20 天、今天收 100.5 → `pullbackDepthPct = 3.92% ≥ 3` 通過門檻，但這檔從頭到尾沒回檔，只有 ±2% 雜訊。
- 12 天前見底 90、3 天前創高 110、今收 108（低點在高點之前）→ `measuredMove 128`，rr 衝到 **4.44**，吃滿 `scoreSwing` 的 RR 上限衝到榜首。

**修法**：先定位 `recentHigh` 的索引，`pullbackLow` 限縮成其後的最低價；hIdx 為最後一根時 `pullbackDepthPct` 回 0。`measuredMove` 用同一組有時序約束的 high/low。兩個視窗長度（20/12）統一或寫明理由。
**⚠ 屬選股行為變更，需升 `SWING_FORMULA_VERSION`**。
**測試**：`picks-swing.test.mjs` 的 features 手算案例。

### D-12. `inspectSwingStock` 不限普通股，對無漲跌幅限制的標的套 10.5% heuristic
`inspectSwingStock`（8995）對照 `scanSwingBoard`（8746）有 `.filter(isOrdinaryStock)`
證據強度：`已查證`

10.5% 門檻的前提是「台股有 10% 漲跌幅限制」。使用者手打代碼的 inspect 完全沒有 `isOrdinaryStock` 過濾，而國外成分／槓桿反向 ETF **無漲跌幅限制**。

輸入 `00631L`、`00646` 這類標的，任何一天 >10.5% 的真實行情都會被當成公司行動——該日以前的全部歷史被乘上假比率，MA／布林／MACD 全錯，前端還顯示「近期疑似權息跳空(估算還原)」這個不存在的事件。

**修法**（低成本）：`inspectSwingStock` 對非 `isOrdinaryStock` 標的直接回「波段引擎只支援上市櫃普通股」，或 `allowHeuristicFallback: false`。
**IPO 的延後風險另計**：新掛牌股當下不足 60 根不會立刻污染，但那幾根無漲跌幅限制的 K 留在 6 個月視窗內，等該股滿 60 根擠進候選後才被 heuristic 追認成公司行動。這部分成本較高，可待 quote 有商品類型欄位後再做。
**測試**：`swing-corporate-actions-integration.test.mjs`。

---

## 第二層：真實缺陷，但修法牽涉口徑選擇

> 這一層**不要自行決定**。每條都列了選項與取捨，請先拍板再動手。

### D-20. 所有驗證／回測數字都是毛報酬，UI 零揭露 ⭐ 建議優先處理
`observeSignalSnapshot` 的 summary、`buildBacktestUncached` 的 notes、`advanceSwingVerificationEntry` 的 `resultPct`（8485）、`buildSwingVerificationSummary`（8674）
證據強度：`已實測`

同一支伺服器已有完整費稅引擎（`computeTradeFee`、`computeTradeTaxRule`），驗證路徑一次都沒引用；四個對外面板全是毛數字，說明文字一個字沒提費稅（全站 grep「未扣／交易成本／毛報酬」**零命中**）。

**量級**：隔日沖是「今日收盤買、次日賣」，非現股當沖，賣出證交稅全額 3‰ → 0.6 折來回成本 `0.0855%×2 + 0.3% = 0.471%`（無折讓 0.585%）。`computeTradeFee` 有每筆最低 20 元，成交金額低於約 23,400 元時單邊費率更高。

- 「達 +2%」實際淨值約 **+1.53%**（打七五折）。
- 真正致命的是平均報酬：`avgCloseReturn` 顯示 +0.35%（綠字）扣完成本是 **−0.12%，正負號翻轉**。
- 波段 `avgResultPct` +3.0% → 淨 +2.53%。

| 選項 | 取捨 |
|---|---|
| A. 毛淨並陳（新增 `avgCloseReturnNet` / `avgResultPctNet`） | 不動既有測試釘住的毛值，資訊最完整，面板要多一欄 |
| B. 直接改顯示淨值 | 最誠實，但既有測試與歷史快照全部要重算，且淨值依賴費率假設 |
| C. 只在 notes／面板加揭露文字 | 成本最低，使用者仍要自己心算 |

**建議 A（並陳）＋ 立刻做 C**。實作限制必須寫進 notes：
- 驗證單只存 entry/stop/target，**沒有股數或部位金額**，套不上 20 元最低手續費 → 只能做「費率版淨報酬」，不可宣稱等同帳本口徑。
- 隔日沖若要算現股當沖 1.5‰，樣本並無真實配對事實，只能標成情境值。
- 0.6 折是專案預設的單一券商估算方案、非法定通則。
- **滑價不建議寫進數字**（會把無法驗證的假設寫進正式統計），只在 notes 揭露「盤中觸價假設限價單在停損／目標價全額成交」。

### D-21. 技術分析頁完全不還原權息，與策略雷達對同一檔給相反結論
`buildTechnicalAnalysis`（7671）對照 `inspectSwingStock` 有還原
證據強度：`已查證`

技術分析頁的 MA5／MA20／MACD／`findSwingPoints`／`buildTrendLine`／`buildFibonacci` 全跑在未還原原始價上，回傳結構裡**連 warning 欄位都沒有**。

配息 8%、除息前連 5 天收 100、除息日收 92 → 技術頁 MA5 = 98.4，看起來「跌破 5 日線 6.5%」、MACD 假死叉、支撐趨勢線被貫破；健檢頁（已還原）看到的是連 5 天貼合均線。**同一檔同一天，兩個畫面型態結論相反**，而技術頁沒有任何「近期除權息」提示。

| 選項 | 取捨 |
|---|---|
| A. 比照健檢還原（日 K 還原後**再**彙總成週／月，順序不可顛倒） | 兩頁一致；但改變你熟悉的圖形，需補 warning 通道 |
| B. 保留原始價視圖 + 在有事件的 K 上打標記，且不用未還原序列產生趨勢線／斐波那契／技術訊號 | 保留看盤習慣，但兩頁數字仍不同，需明確標「本頁未還原／已還原」 |

**建議 A**。附帶必修：技術頁目前沒有 warning 欄位本身，還原後 heuristic 降級必須標「疑似公司行動／估算還原」，所以 warning 通道要一起補。

### D-22. 帳本完全不處理除權／現增／減資，除權日憑空出現大額假虧損
`buildPortfolio`（1359，關鍵在 buy/sell 分支無任何 shareFactor）
證據強度：`已查證`

只認 buy/sell/dividend，dividend 又只有「每股現金 × 股數」一種語意，**沒有任何路徑會增加庫存或稀釋均價**。但報價層已帶 `quote.dividend.stockRatio`，還原引擎也有完整參考價公式——帳本沒接上。前端快速操作還要求 `div.cash > 0`，所以**純除權（配股不配息）連一筆紀錄都不會產生**。

持有 2330 共 1000 股、均價 100（成本 100,000），配股 1 元（stockRatio 0.1）→ 應變成 1100 股、均價 90.91、未實現 0；現行仍是 1000 股／成本 100,000，配 90.91 現價 → 顯示未實現 **−9,090（−9.1%）**。減資（1 股換 0.8 股）方向相反，顯示假獲利。之後所有以成本為分母的報酬率、總市值、總成本全跟著錯。

| 選項 | 取捨 |
|---|---|
| A. 新增公司行動紀錄型別，在 `buildPortfolio` 重放時做 `shares × (1+stockRatio+subscriptionRatio)`、`cost += 認購價×認購股數` | 根治；可複用既有 shareFactor 與參考價公式，權利股數沿用 `date < exDate` 規則。工程量最大 |
| B. 短期折衷：偵測到持股在官方除權日時顯示「已除權、成本尚未調整」警示 | 成本低，但假數字仍在畫面上 |

**建議 A，先上 B 擋著**。「把該檔暫時排除在總計之外」屬呈現決策，請自行拍板。
**⚠ 注意**：本機官方歸檔**不涵蓋減資**，偵測層要保留 unresolved 狀態，不可因 archive 沒事件就當作無公司行動。

### D-23. 漲停鎖死與「一價到底」的 K 完全沒有被辨識
`buildSwingPlan`（8227，entry＝當日收盤）、`computeMetrics`（6371，closePosition）
證據強度：`已實測`（全檔搜尋 `漲停/跌停/limitUp` 只命中 app.js 放大圖的裝飾標籤）

**(a) 波段進場價可能是漲停鎖死價**：「上軌續攻」本來就挑貼上軌的強勢股，收在漲停完全可能通過門檻，`plan.entry` 直接取當日收盤。前收 100、漲停收 110 → 畫面「進場 110／停損 99／目標 121／RR 2.0」**在真實世界買不到**；這張單還會被寫成正式驗證樣本，隔天高點過 121 就記一筆 +10% 灌水勝利。

**(b) `closePosition` 在 `high === low` 時硬給 1**：低流動性個股整天以單一價位成交、漲幅落在 +3%~+9.5%（非鎖死），`closePosition` 免費拿 1 → 通過 ≥0.7 門檻、`scoreStrong` 吃滿 20 分、且不可能被「收盤轉弱」標記，`amplitudePct=0` 連「高振幅」也不會亮。理由欄還印「收盤位置 100%」。

| 選項 | 取捨 |
|---|---|
| A. 加門檻硬排除 | 最乾淨，但**改 evaluate() ＝改版**，須升 `SWING_FORMULA_VERSION`，舊快照失效 |
| B. 只加標示不動門檻（pick 加 `fillRisk:"limit-up"` / `singlePriceBar`，且不建立驗證單） | 風險最低、不動選股結果，但清單上仍會出現買不到的標的 |
| C. `closePosition` 改中性 0.5 | 折衷，但仍是無意義的數字 |

**建議 B 先落地**，再評估 A。
**⚠ 實作注意**：用 `changePct >= 9.5` 判漲停**不精確**——台股漲停＝前收×1.1 後套升降單位向下取，低價股漲停漲幅可能 <10%（前收 10.05、tick 0.05 → 漲停 11.05 → +9.95%）。應用 `roundToStockTick` 反推漲停價再比對收盤，另用 `high === low && changePct > 0` 判鎖死；且波段的 changePct 算在**還原後**的 rows 上，判漲停必須用原始價。
**測試**：`overnight-engine.test.mjs` 以「一價到底（high==low）→ 收盤位置視為 1」**明確釘住現行行為**（屬特徵化釘現況，非規格背書），改動須一併改寫。

### D-24. 同日雙觸：開盤已跳空越過目標卻被記成停損
`advanceSwingVerificationEntry`（8485）
證據強度：`已查證`

停損判定寫在目標判定之前且不看開盤價，只要 `low <= stop` 就一律 loss。台股開盤是集合競價、是當日第一筆成交且**時序確定**——開盤價若已越過目標，掛在目標價的賣單一定在那一撮成交。反向（`open <= stop`）程式反而處理對了，可見是漏了另一半。

entry 100／stop 95／target 110，當日 open 112、high 113、low 94、close 96 → 現行記 **loss −5%**；正確是開盤 112 成交、**win +12%**（誤差 17 個百分點且勝負反向）。

**為什麼需要拍板**：`stock1-domain` 明文寫「同日雙觸保守記 loss」，這種 K 在字面上就是同日雙觸；但同段又寫「跳空用開盤價計滑價」。**兩條規則在此子案例衝突**，需裁決哪條優先。
**建議**：開盤價優先——`if (open <= stop) loss@open; else if (open >= target) win@open; else if (low<=stop && high>=target) 保守 loss@stop`。必須加 finite 守衛（現行只要求 high/low/close 有限，open 允許 NaN），並保持 `open === stop` 仍走 stop 出場。
**測試**：`swing-verify.test.mjs` 的雙觸案例 open 用預設值，沒覆蓋此分支，需補。

### D-25. 目標價跳過 0~2% 內的最近壓力、再套 +3% 下限，RR 被高估到讓 `SWING_MIN_RR` 失效
`buildSwingPlan`（8227）
證據強度：`已實測`（RR 確實以毛價計算）

兩個機制疊起來系統性高估 reward：(1) `price > entry * 1.02` 把上方 0~2% 的擺動高點整個濾掉，rawTarget 掉到通常遠得多的 measuredMove；(2) `Math.max(conservativeTarget, minimumTarget)` 的 +3% 下限把目標推到最近壓力之上。註解寫「向下取整避免高估報酬」，**+3% 下限做的正好相反**。

- entry 100、stop 97（risk 3）、上方最近擺動高點 101.5（<102 被濾掉）→ measuredMove 107、**rr 2.33**；誠實 reward 只有 1.5、**RR 0.5**，本該被剔除。
- overhead 102.5、risk 3 → 誠實 **RR 0.83** 應剔除；程式把 target 抬到 103、**rr 1.0**，剛好通過 `SWING_MIN_RR=1`。

**另外**：RR 全部以毛價計算。目標 +3%、風險 2.9% → 毛 RR 1.03 通過；扣掉 0.47% 來回成本後**淨 RR 只有 0.75**。要不要把成本納入 RR 門檻，與 D-20 一起決定。
**⚠ 測試把錯誤行為釘成期望**：`picks-swing.test.mjs` 的「跨 10 元升降單位仍守住目標至少 +3%」須一併改寫。屬行為變更，需升 `SWING_FORMULA_VERSION`。

### D-26. 波段驗證單會永久卡死，加上 90 天靜默刪除 → 倖存者偏誤
`pruneSwingVerification`（8420）、`advanceSwingVerificationEntry`（8485）
證據強度：`已查證`

**機制要講對才修得到**：`pruneSwingVerification` 是**無差別**刪除所有超過 90 天的日期 key，已結案的一樣被刪，所以偏誤來源不是刪除有選擇性。真正的來源是更前面一步——**永遠無法結案的 entry 從第一天起就不在 resolved 分母裡**，prune 只是讓它永遠沒機會補回來。`daysHeld` 只在成功推進時 +1，所以 15 天超時結案也永遠碰不到。

**最常見的卡死路徑不是下市**：`advanceSwingVerificationEntry` 要求 high/low/close 皆為有限數且 >0——處置股分盤撮合當日無成交、或官方日 K 回「--」就 return false；而 `resolveNextTradingDate` 之後每次算出同一個 expected 日期，**即使該檔隔天恢復正常交易也永遠追不回來**。

**無爭議部分（可直接做）**：解掉死結——缺 K 或資料形狀不合時允許跳到下一個有效交易日並記錄跳過天數；`pruneSwingVerification` 刪除前先把仍 pending 的 entry 結算成 `status="abandoned"`，summary 加 `abandoned` 計數，讓分母損耗看得見。
**需拍板**：(1) 硬性天數上限（建議 30 個日曆日）；(2) **下市怎麼記（−100%？以最後成交價結案？）是口徑決定**。

### D-27. 勝率／達成率沒有最小樣本門檻
`buildSwingVerificationSummary`（8674）、`app.js` 的驗證面板
證據強度：`已查證`

1. `resolved` 只要 1 筆就給百分比並染色（`>= 50 ? is-up : is-down`）。
2. `winRate` 分母是 resolved，但 win/loss 一碰價就結案（常 1~3 天），expired 一定要等第 15 個交易日——**累積初期分母裡幾乎只有快速觸價的極端樣本**。實務上就是：第一週看到「上軌續攻 勝率 100%（結案 2 筆・追蹤中 31 筆）」綠字，第三週 expired 陸續結案掉到 40% 變紅字，你以為策略壞了，其實只是分母組成變了。
3. 同一天選出的 20~40 檔高度共享大盤 beta，當成獨立樣本會嚴重高估精度。

**現況要更正的部分**：樣本數本身**已經有顯示**（「結案 N・追蹤中 M」），缺的是**門檻、不染色、以及誤差範圍**。

| 選項 | 取捨 |
|---|---|
| A. 低於門檻時 `winRate` 回 null，前端顯示「樣本累積中 n/20」且不染色 | 最有效；**門檻數字需你拍板**（建議 ≥20） |
| B. 另輸出 `winRateIncludingPending` | 揭露分母組成偏移，但兩個勝率並列可能更混淆 |
| C. 只在面板寫明「分母只含已結案 N 筆，超時單會較晚才進統計」 | 成本最低 |

**建議 A + C**。誤差範圍請以「交易日為 cluster」計算，或至少寫明「同日訊號高度相關，有效樣本數遠小於檔數」。

### D-28. 官方 `previousClose`（除權息日即參考價）被 `addPreviousClose` 覆寫
`normalizeTwseHistoryRow`（4569）、`addPreviousClose`（7489）
證據強度：`已查證`；**前置相依 D-43**（漲跌價差欄在事件日的格式必須先實測）

交易所日成交資訊的「漲跌價差」在除權息日是相對參考價算的，`close − change` 就是當天官方參考價；減資、面額變更當天同理。程式已經算出來存進 `row.previousClose`，`addPreviousClose` 卻用「陣列前一根收盤」整排覆蓋。丟掉之後只剩 >10.5% 缺口這種粗糙猜法——而 **archive 不含減資，previousClose 對減資卻是有值且精確的**。

> 2026-07-26 的驗證側修復正是利用了「驗證路徑刻意不經過 `addPreviousClose`」這個事實。這條要處理的是**掃描與技術分析路徑**。

**修法**：新增 `exchangePreviousClose` 欄位保存官方原值、永不被還原改寫；`previousClose` 維持「同尺度前一根收盤」的派生語意；新增偵測器 `exchangePreviousClose / prevRow.close`，偏離 1 超過 0.2% 視為公司行動，優先序排在官方 archive 之後、10.5% heuristic 之前，來源標 `exchange-implied`。
**⚠ 同時修**：還原後除權息當天的 `previousClose` 與前一根還原後 close 差一個 ratio（事件日那根在 factor 乘上 ratio **之前**就被處理）。目前是潛在缺陷——後續計算都走 close/high/low，沒讀 previousClose，所以現階段沒有可見錯誤數字；但只要日後有人用它算漲跌幅，除權息當天就會多出一個等於殖利率大小的假跌幅。**兩條必須合併設計，不可各自落地。**

### D-29. heuristic 還原只調價不調量（`shareFactor` 固定 1）
`resolveCorporateActionAdjustments`（7918）
證據強度：`已查證`（審查員實跑）

本機 archive 只涵蓋除權除息，**不含現金減資、彌補虧損減資、面額變更、股票分割**。這些只走 heuristic，而 heuristic 的 shareFactor 硬寫 1。

實跑：10 根 bar、第 6 根起價 10→25、量 1000→400、無官方事件 → ratio 回 2.5，還原後 close 全部 25（**價格方向正確**），volumeLots 仍是前段 1000／後段 400（**完全沒調**）。
- 減資 60%：`volumeRatio5` 壓到 0.4 → 正常量能看起來像「量能窒息」。
- 1:2 面額分割：反向，`volumeRatio5` 假性放大到 2.0，在隔日沖語彙裡就是**假爆量**。

| 選項 | 取捨 |
|---|---|
| A. 用 `1/ratio` 當 shareFactor 估計值並標「量能為估算」 | 對純股數型事件準確；含現金股利時會高估 |
| B. 用「成交金額 ÷ 成交股數 ≈ 均價」交叉驗證推導股數因子 | 較準，但依賴 tradeValue（見 D-05） |
| C. 最低限度：heuristic 事件發生時把量能指標標為不可靠，跨事件視窗內不讓量能門檻生效 | 零誤差風險，但會損失一批標的 |

**建議 C 先做，再視 D-05 修完的成果評估 B**。

### D-30. 驗證單沒有保存 surveillance，處置股用「連續撮合」假設結案
`recordSwingVerification`（8434）
證據強度：`已查證`；**必須先修 D-08**

pick 上有 surveillance 標示，寫進驗證單時整個丟掉。處置股在處置期間是每 5 或 20 分鐘一次的分盤集合競價，日 K 的 high/low 只是幾十次撮合的極值，掛在 stop/target 的單未必撮得到。更實際的問題是：因為驗證單沒存 surveillance，**你就算在「更多→風險規則」關掉處置股，成績單仍然含它們，前端連過濾都做不到**。

**修法**：一併保存 `surveillance`（kind／期間）與當時的 `fillModel`（`continuous` / `periodicCall5` / `periodicCall20`），summary 依 fillModel 分開統計。分盤間隔來自 TWSE punish 的 `Detail` 與 TPEx 的 `DisposalCondition`，**`parseDispositionInterval` 可直接重用**。
**需拍板**：這些樣本要「分開統計」「排除在 winRate 外」還是「只標示」。
**⚠ 前置**：目前 `riskSets.surveillance` 沒有日期窗（D-08），直接存進驗證單會把錯誤時點永久釘進歷史樣本。

### D-31. 同日交易在缺成交時間時退回記帳時刻，買賣順序會反
`compareTradeChronology`（1285）
證據強度：`已查證`

`executedAt` 只在**兩筆都有**時才比較，兩筆都沒填時同樣退到 `createdAt` 再退到輸入順序。正確表述是「同日順序在任一筆缺 `executedAt` 時完全由記帳時刻決定」。相對地，**兩筆都填了成交時間就會正確排序——你已有可行的自救方式，只是完全沒被告知**。

對帳單謄寫時先記「13:20 賣出 1000 股」（沒填時間）、再記「09:05 買進 1000 股」（有填時間）→ 賣出排在買進前 → `buildPortfolio` 回「賣超」→ 整包 PUT 被 400 擋下，**資料明明是對的卻記不進去**。

| 選項 | 取捨 |
|---|---|
| A.（建議先做，零風險）賣超錯誤訊息加「同日多筆買賣請補填成交時間以決定順序」 | 把既有自救路徑告訴使用者 |
| B. 兩段式排序：有 `executedAt` 者依它排，缺值者視為時間未知 | 解決多數情境，仍是啟發式 |
| C. ~~同日一律讓 buy 在 sell 之前~~ | **不建議**：會讓真正的先賣後買被靜默接受，與「先賣後買尚不支援」衝突 |

### D-32. 法人「外資＋投信＋自營商」相加不等於同頁的「法人合計」
`app.js` 的法人四格、server.mjs 的 T86 正規化
證據強度：`已查證`

欄位映射與 T86 官方定義一致——外陸資（**不含**外資自營商）、外資自營商、投信、自營商、三大法人合計（**含**外資自營商）。所以畫面四格相加**必然短少 `foreignDealerNet`**。`foreignDealerNet` / `foreignTotalNet` 雖已正規化，全 repo **沒有任何消費端**。

外陸資 +5,000／外資自營商 +100／投信 +1,000／自營商 +500／官方合計 +6,600 → 畫面四格相加得 6,500，**差 100 張**。

| 選項 | 取捨 |
|---|---|
| A. 外資改用 `foreignTotalNet ?? (foreignNet + foreignDealerNet)` | 四格自洽；但「外資」數字會與市面常見的外陸資口徑不同 |
| B. 維持現行口徑，多列一行「外資自營商」 | 資訊最完整，多一列 |
| C. 只改 note 寫明兩者口徑差異 | 最低成本 |

**建議 B 或 C**，由你的看盤習慣決定。
**測試**：`tests/helpers/fixtures.mjs` 的 t86Row 把外資自營商欄寫死 "0"，既有測試看不出差異，需改成非零值。

### D-33. 隔日沖候選池沒有任何絕對流動性下限
`preselectQuotes`（6595）對照 `preselectSwingQuotes`（8328）有 `volumeLots >= 500`
證據強度：`已查證`

過濾條件只有普通股、非停牌下市、日期相符、價格有值、漲幅或振幅門檻——**沒有任何成交量／成交值下限**；排序權重 `log10(volumeLots+10)` 值域只有 1~5，壓不過 0~10 的漲幅權重，冷門股靠「相對爆量」很容易擠進 260 檔。入選門檻也全是相對量。

**需拍板**：加絕對下限（與波段一致的 500 張？成交值 3,000 萬？）會直接改變選股結果並需升 `OVERNIGHT_FORMULA_VERSION`；較保守的替代是把量升級成**排序懲罰**而非硬門檻。
**建議先做 D-05**（讓「低流動性」標籤恢復可信）再評估是否需要硬門檻。

---

## 第三層：需重查官方原文，或屬於現有資料源的已知限制

### D-40. 零股／盤後定價的當沖減半稅：法規待查
`isConfirmedDayTradeStatus`（586）
證據強度：`待實測` — **法規最後核對日 2026-07-13，以下不可直接斷言**

現況：防線只比對使用者自己在下拉選單選的 `session` 值，**完全不看 `matchedShares` 是不是 1000 股的整數倍**。零股賣出 500 股又勾了當沖確認，驗證全部通過，按 1.5‰ 課這 500 股（75 元）；若零股確實不適用減半，應為 150 元。同一行只擋 `oddLot`／`block`，**`afterHoursFixed`（盤後定價）也會通過**。

**待查**：現股當沖減半是否確實排除盤中零股與盤後定價交易——請以財政部《證券交易稅條例》與 TWSE 現股當日沖銷制度 Q&A **原文**核對。

**界線要講清楚**：規格書明載「目前沒有自動當沖配對與資格引擎」「brokerConfirmed 是人工輸入」。所以本條主張的不是「系統應自動判定當沖資格」，而是「規格書宣稱『零股與鉅額會在表單擋下』與實作只比對自報 session 之間有落差」。

**建議保守版落地**：`matchedShares % 1000 !== 0` 時轉 `needsReview` ＋ 附覆核理由（沿用既有機制），**先不硬擋**，避免在法規未複查前擋掉合法輸入。

### D-41. `StockDividendRatio` / `SubscriptionRatio` 的單位從未用真實 payload 驗證
`normalizeDividendMarketRows`（4087）
證據強度：`待實測`

TWSE／TPEx 除權息報表在網頁版是以「每仟股無償配股（股）」呈現，OpenAPI 欄位名叫 Ratio，但實際回傳是比率（0.1）還是每仟股股數（100），**在這個 repo 裡沒有任何真實 payload 或斷言釘住**——fixtures 的值全是自訂，live 形狀測試只檢查欄位存在不檢查數量級。

**不是待爆地雷**，正確定位是「單位語意未被釘住，且沒有防護網」。若上游真回 100，`referencePrice = (前收−現金)/101`，整段 K 線塌陷且 `formulaComplete=true`、`source=official`，**不會有任何告警**。

**執行順序**：
1. （立刻，不需知道上游真值）`normalizeDividendMarketRows` 加合理性檢查：單次無償配股率 >1 極罕見，>1 一律記 warning 並走 unresolved——這一步就能防住災難分支。
2. （一行成本）`tests/live/upstream-shape.test.mjs` 加「所有非空 `StockDividendRatio` 皆 < 1」的量級斷言。
3. 之後抓一檔已知配股個股的真實 payload，用官方公告參考價反推驗證單位，寫成 fixture 釘死。

### D-42. Yahoo 備援序列的還原語意未實測，可能雙重還原
`normalizeYahooHistoryRows`（4657）
證據強度：`待實測`

**程式碼可證的部分**：取 `indicators.quote[0]` 的原始 OHLC（未取 adjclose），`backAdjustForCorporateActions` **不讀 `row.source`**，掃描端對兩種來源套用完全相同的比率與 heuristic。「來源未被區分」是確定的。

**不可斷言的部分**：「Yahoo `indicators.quote` 對台股配股已回溯調整」無法從本 repo 佐證（沒有 Yahoo payload fixture），因此「雙重還原 → MA60 低估」是**條件式後果，不是既成事實**。

**執行順序**：
1. 實測：挑一檔近三個月除權（有配股）的個股，比對 Yahoo chart 的除權前收盤與 TWSE STOCK_DAY 同日收盤。
2. 確認前先做零風險防禦：把 `row.source` 傳進 `resolveCorporateActionAdjustments`，Yahoo 來源標 `external-unverified-adjustment` 並在 UI 揭露，不要無聲蓋 official 章。
3. 附帶：Yahoo 序列的 previousClose 是自算的，走 Yahoo 時 D-28 想利用的交易所口徑 previousClose 一定不存在。

### D-43. TWSE STOCK_DAY 漲跌價差欄在事件日的實際格式待實測
`normalizeTwseHistoryRow`（4569）— **D-28 的成敗前提**

`parseNumber` 對非數值字串回 null。若事件日回 `X0.00` 這類帶前綴格式，`previousClose` 反而是 null，D-28 的偵測器只能退化成旗標式（「previousClose 為 null ⇒ 疑似事件」）。**先用一檔近期除息與一檔近期減資的個股實測實際值與格式，再決定 D-28 的做法。**

### D-44. 上游端點欄位待查證
- **注意股期間**：`announcement/notice` 只解析 Code / NumberOfAnnouncement / TradingInfoForAttention，**沒有期間欄位**。D-08 給處置股加日期窗時**不要順手改注意股**，須先查證該端點是否真的提供期間。
- **同一 exDate 多列**：「上游會在同一除權息日對同一代號回多列」在 repo 裡**無法佐證**——`normalizeDividendMarketRows` 沒有任何去重，代表作者也沒遇過。正確定位是「資料結構無法表達同日多事件的防禦性缺陷，而非已觀察到的錯誤」。
  - 先做低成本偵測：發現同 code 同 exDate 多列時記 warning 並標 `formulaComplete=false`（unresolved 優於算錯）；這同時消掉 `appendDividendHistoryNow` 的 revision 抖動。
  - 確認上游真的拆列後，再做 `slot[exDate] → events 陣列` 的 schema 升級與合併公式。

### D-45. 現有資料源做不到的已知限制（不必嘗試修，但要在 UI／notes 誠實揭露）
1. **本機公司行動歸檔不涵蓋減資、彌補虧損減資、面額變更、股票分割**。所有偵測層必須保留 unresolved 狀態，**archive 沒有事件 ≠ 官方確認無事件**——這條約束貫穿 D-01、D-22、D-29。
2. **未來除權息預告表會滾出窗**，所以回溯型計算只能靠本機歸檔，命中不到時只能標「不可比」，不能宣稱該日無除權息。
3. **驗證單沒有股數／部位金額**，所以 D-20 的淨報酬只能做費率版，套不上 20 元最低手續費，不可宣稱等同交易帳本口徑。
4. **`STOCK_DAY_ALL` 沒有被解析成交金額欄位**，D-05 的 tradeValue 若不改正規器就只能估算，必須標 `estimated`。

---

## 前置相依關係（排程時注意）

- **D-08 → D-30**：surveillance 日期窗必須先修，否則錯誤時點會被永久釘進驗證樣本。
- **D-28 內部兩條必須合併設計**（新增 `exchangePreviousClose`），不可各自落地。
- **D-43 → D-28**：漲跌價差欄格式實測是 D-28 的成敗前提。
- **D-42 步驟 1 → D-21**：技術分析頁允許 Yahoo 備援，還原前要先確認外部來源語意。
- **D-05 → D-33**：tradeValue 修好之前，流動性門檻的討論沒有可信的輸入。
- **D-04 的月 K minBars 調整**必須與抓取月數同步放大，否則整頁打掉。

## 需要升版本號的改動

依 `stock1-domain`「改門檻＝改版」：

- `SWING_FORMULA_VERSION`：D-11、D-23（選項 A）、D-24、D-25
- `OVERNIGHT_FORMULA_VERSION`：D-02、D-33（若加硬門檻）

---

## 稽核方法與排除範圍

本輪由 6 個獨立審查維度平行進行（費稅與損益、技術指標數學、回測方法論、市場結構、還原權息、報價語意），每個維度再由一個**對抗式查證者**逐條嘗試推翻，過不了的丟棄；原始 57 條中 51 條通過查證，合併根因後為本文件的 6 條已完成 ＋ 32 條待辦。最高價值的除權息項目由 4 個維度獨立指向同一處，並經實跑確認。

**明確排除**：UI／UX（已另行調校）、一般程式品質（見 `AUDIT.md` 2026-07-25 段）、投資建議（不評論策略獲利能力、不建議門檻該設多少）、以及對法規的臆測（凡有疑慮一律標「需重查官方原文」）。

**這份清單不評價策略好壞**，只處理「程式算出來的數字是不是它宣稱的那個數字」。
