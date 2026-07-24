# Stock1 全面稽核與改善路線圖

稽核日期：2026-07-12（Asia/Taipei）

這是 living document。修復後應在對應項目補上測試與完成日期，而不是刪除歷史。

## 2026-07-13 進度更新

下方 P1／P2 內容保留 2026-07-12 的原始蒐證與行號，供追溯使用，**不代表目前仍未修復**。目前基線為：離線測試 **476／476**（後端 303、前端 173；coverage 編排為 7 項特殊契約＋其餘 469 項）、`server.mjs` 覆蓋率 **line 89.24%／branch 78.31%／function 89.28%**，lockfile 稽核 0 vulnerabilities。Node 支援範圍已以 `engines` 鎖定為 20.19+、22.13+ 或 24+。

本輪已完成並有回歸契約的範圍包括：XSS／production secrets／靜態 allowlist、DB recovery／immutable backup／寫入 queue、API 容量與 auth race、跨日行情與前向驗證、官方公司行動 v16、除權息來源分市場 last-good／半包防護、股利應收與實收分帳、交易帳本 schema v2 的商品／當沖拆模、有效日期稅則、安全遷移、費稅來源與一般交易修正、active-screen render、dialog／tabs／canvas 基礎無障礙，以及處置看板資訊重排。2026-07-13 再補上唯讀 API 的 GET-only 早期 405、隔日訊號／回測的 bounded TTL LRU＋同 key single-flight、每帳號最多 10 組有效 session、手機明細 sheet 的完整 dialog／回焦模型、局部重繪後的 tab ARIA 同步，以及 Service Worker 只清除 `stock1-shell-*` 自有快取。仍需產品決策、不能靜默改動的主要項目是自動當沖資格核對／配對／先賣後買、多券商手續費方案與績效統計口徑；private Git、個人資料匯出與異地備份也保留在後續維護清單。

## 結論

Stock1 已經不是「功能堆出來的 demo」，而是一套有清楚產品決策、資料降級策略、前向驗證、持久化與大量特徵化測試的私人看盤工具。2026-07-12 原始稽核沒有發現 P0；當時列出的跨日資料、前向驗證、持久化、DOM XSS 與主要 dialog 鍵盤風險均已逐項修復並有測試鎖定。現在更值得投入的是可攜式個人備份、程序生命週期／健康檢查、剩餘非同步競態，以及需要使用者決定口徑的股票產品功能，而不是再堆疊未驗證的新畫面。

正式 5174 始終未被占用；2026-07-13 真實 Chromium 驗證使用 5180 與獨立臨時 `DATA_DIR`，完成後已關閉伺服器並移除暫存資料。

### 驗證基線

| 項目 | 結果 |
|---|---|
| 離線測試 | 476 / 476 通過（後端 303、前端 173） |
| 後端覆蓋率 | line 89.24%、branch 78.31%、function 89.28% |
| 上游 live canary | opt-in；本輪未重跑，避免把網路／官方空資料混入離線基線 |
| 依賴漏洞 | `npm audit` 0 |
| 依賴版本 | `npm outdated` 無待更新；`fubon-neo` 2.2.2 為 latest |
| 瀏覽器矩陣 | 本輪 1366×900／390×844：手機 sheet dialog、重繪後回焦、桌機 persistent aside、處置 tabs 全通過，0 console error／warning、0 橫向溢出 |
| UI technical audit | 原始 11 / 20 已作為歷史基線；主要 a11y、重繪與處置卡資訊層級已改善，後續重新完整評分 |

## 做得好的地方（修復時必須保留）

- 後端所有外連集中走有 timeout 的 `fetchJson`；風險名單有 fresh／last-good 降級。
- 主 DB 原子寫入、每日備份、壞檔保留與 rev 樂觀鎖的方向正確。
- PBKDF2、AES-256-GCM、HttpOnly／SameSite cookie、登入防爆破與刪帳限制都已具備。
- 波段最後一根 K 有嚴格新鮮度閘門；同日雙觸採保守 loss、跳空計滑價、15 日超時等驗證框架很成熟。
- 持股加權平均、費稅、股利、賣超阻擋都有手算測試。
- 前端已建立 `escapeHtml`、事件委派、async request-id、in-flight guard 等可複用範本。
- 即時／昨收／收盤／基準日的語意大多清楚；平盤不是紅色，風險股採「保留＋標示＋可隱藏」。
- 深色、方正、高資訊密度的台股看盤語彙很有辨識度；不是行銷型金融 SaaS，也沒有遊戲化交易回饋。
- Service Worker 對 `/api` 永不 cache、shell network-first，避免舊行情的核心方向正確。

## P1：第一優先

### P1-01 DOM XSS：策略健檢 query 直接進 `innerHTML`

- 位置：`app.js:3896-3944`，核心在 `3937`、`3941`；相同 trust-boundary 漏網另見 `3102`、`3524`、`3616`、`3625`、`3876`、`3967`、`4000-4004`、`7822`。
- 實測：健檢欄輸入帶 `onerror` 的 `<img>`，不等 API 回應，loading HTML 就會執行 JavaScript。
- 影響：可在目前使用者的 origin 內讀畫面、呼叫已登入 API；HttpOnly 只保護 cookie 字串，無法阻止同源操作。
- 修法：query/error/name/market/description/check detail 全部分 context escape；純文字優先 `textContent`。
- 必加測試：惡意 query 與惡意 API 字串不得產生元素或事件屬性。

### P1-02 Production 預設帳密／APP_SECRET 只警告且會誤判

- 位置：`server.mjs:18`、`23-26`、`546-562`、`4994-5004`、`5067-5071`、`5715-5719`。
- 問題：production 可在 `0.0.0.0` 使用 `admin/admin1234` 與固定開發 key 啟動。既有 DB 若先用預設密碼建立，之後只設定 `ADMIN_PASSWORD` 並不會更新 hash，但 warning 反而消失。
- 影響：本機時風險有限；照 README 上雲後可能直接失去管理權。
- 修法：production fail-closed、拒絕 placeholder、DB 記錄 `mustChangePassword`；文件明說 env 密碼只 seed 空 DB。
- 必加測試：兩次 child-process 共用 DB，第二次的實際 hash、warning 與 fail-closed 必須一致。

### P1-03 備份恢復後未立刻重建主檔

- 位置：`server.mjs:489-572`；目前 `tests/backend/db-recovery.test.mjs:37-44` 會手動 `saveDb`，遮住了缺口。
- 重現：壞主檔 → 從好備份載入 → 尚未發生 mutation 就關機 → 再啟動。因壞主檔已改名、恢復內容沒寫回，第二次會建立空 DB。
- 修法：解析備份成功後立即 atomic rewrite；主檔不存在時也先找可用備份。
- 必加測試：兩段獨立 process restart，第二次仍能讀到 backup marker。

### P1-04 一次 DB write 失敗會永久 poison `dbSaveQueue`

- 位置：`server.mjs:478-485`；多個 handler 先 mutate 記憶體再 await 存檔，例如 `5206-5217`。
- 影響：第一次 I/O 失敗後，後續 `.then()` 都不再執行；記憶體 rev 已變、磁碟未變，重啟後資料消失。
- 修法：每個 queue job 獨立 recover；以 clone/transaction 在落盤成功後才交換 `dbCache`；I/O 回 500/503。
- 必加測試：first-fail / second-success，驗證 queue 恢復且 memory/disk/rev 一致。

### P1-05 公開重運算端點與輸入／Map 無上界

- 位置：`server.mjs:72-76`、`1756-1780`、`2377-2452`、`4739`、`4841-4858`、`5384-5390`、`5622-5628`；登入 Map `662-684`、`4980-4991`。
- 問題：平行 `swing?refresh=1` 可重算多次；quotes codes 無數量上限；Yahoo/login Map 可被大量唯一 key 撐大。
- 影響：本機是 self-DoS；公開到 `0.0.0.0` 後可耗 CPU、記憶體與官方配額。
- 修法：保留唯讀 API 免登入政策，但 `refresh=1` 限管理者＋冷卻；codes 嚴格格式且最多 100；bounded LRU/TTL sweep、keyed single-flight、全域 semaphore、IP＋帳號 rate limit。

### P1-06 隔日沖混入不同交易日，驗證可把多日後行情叫「隔日」

- 位置：`server.mjs:3342-3359`、`3378-3448`、`3469-3475`、`3593-3631`。
- 重現：TWSE quoteDate=`20260710`、TPEx=`20260711`，`preselectQuotes(...,"20260711")` 仍回兩檔。
- 影響：舊 K 可冠上新 `asOf` 並存成快照；單日 verify 未逐碼驗日期，命中率與報酬可能用錯觀察日。
- 修法：候選與最後一根 K 皆須 `date === latestDate`；驗證使用每碼歷史中第一根 `date > signalDate`；存快照前驗兩市場 coverage。
- 必加測試：落後市場剔除、逐碼下一交易日、同 picks 數但 coverage 更完整仍能覆蓋。

### P1-07 Yahoo 備援會組出「今日 price＋昨日 OHLC」並清掉 stale

- 位置：`server.mjs:1757-1781`、`2443-2467`。
- 問題：Yahoo parser 不保留 `regularMarketTime`；MIS 無 row 時只替換 price，昨日 reference 的 O/H/L/rawDate 仍留下，卻設 `priceStale=false`。
- 影響：到價提醒與隔日驗證可能使用跨日拼接的最高／最低。
- 修法：price/OHLC/date 必須同來源、同交易日；Yahoo timestamp 過舊不得解除 stale。

### P1-08 波段「回檔」沒有時間順序

- 位置：`server.mjs:4214-4220`、`4303`、`4391-4395`。
- 重現：80 根嚴格逐日上升 K 線仍得到 `pullbackDepthPct=4.2233`。
- 影響：單調上漲股可被判定「曾回檔 ≥3%」，錯誤區間又會放大 target、RR 與排名。
- 修法：使用有序 max-drawdown，或有效 swing high 後的 swing low，並回傳高低點日期供稽核。
- 行為變更：需升 `SWING_FORMULA_VERSION`，舊版成績獨立 cohort。

### P1-09 波段前向驗證會翻轉 opening-gap 結果、混版本、漏同日補資料

- 位置：`server.mjs:4575-4598`、`4614-4638`、`4651-4672`、`4682-4715`。
- 重現：entry 100 / stop 98 / target 103；次日 O/H/L/C=105/106/97/100。現行先看 low，輸出 loss -2%；但開盤第一筆已越過 target，應是 win +5%。
- 另兩點：去重與彙總未把 `formulaVersion` 納入；`lastSwingAdvanceDay` 在完成前就鎖日，同日資料補齊或 save 失敗不能重試。
- 修法：先判 open gap，再判日內雙觸；去重／統計依 formula cohort；以逐筆 `lastChecked` 防重並讓失敗可重試。

### P1-10 TPEx 全額交割未進入選股 risk sets，旗標又判太寬

- 位置：`server.mjs:1941-1978`、`2009-2017`、`2265-2273`。
- 問題：`getRiskSets` 沒有 TPEx `AlteredTrading`；處置看板則把任何非空值都當 true，`"Ｎ"` 也可能誤列。
- 影響：TPEx 全額交割股可能無紫色標示且風險開關藏不掉；或反向誤標。
- 修法：新增 TPEx changed source；NFKC 後只接受 Y／全形Ｙ並驗證資料日。

### P1-11 [部分完成 2026-07-13] 交易稅費模型把資產類別與交易型態混成單選

- 位置：`server.mjs:277-328`、`app.js:1778-1788`。
- 現況正確：一般股 0.3%、一般 ETF 0.1%、股票當沖 0.15% 的單一公式與加權平均有測試。
- 問題：`stock | etf | dayTrade` 無法同時表達「ETF＋當沖」；表單不依代號推定 ETF；2026 年合格債券 ETF 免稅無法表達；稅率沒有 effective date；最低手續費 UI 固定 20 元。
- 官方核對：股票當沖 0.15% 延長至 2027-12-31；一般 ETF 0.1%，合格債券 ETF 至 2026-12-31 免稅；手續費與最低門檻由券商政策決定。
- 修法：拆 `assetClass`、`isDayTrade`、`tradeDate`、`brokerFeePolicy`；官方 metadata 推定並允許覆寫；稅率使用 effective-date table。
- 來源：[財政部當沖稅率](https://www.dot.gov.tw/singlehtml/ch26?cntId=fde9d7d1546d4df8a4db96bf23e2f57c)、[TWSE ETF 交易規則](https://www.twse.com.tw/zh/products/securities/etf/overview/rules.html)、[財政部債券 ETF 免稅](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/securities-transaction-tax/taxation-scope/7r3MjNB)

#### 2026-07-13 實作進度

以下為本輪新增的現行契約；上方 2026-07-12 原始蒐證與建議保留不刪，便於追溯「為何要改」。

- **已完成：schema v2 拆模。** `/api/trades` canonical payload 為 `schemaVersion: 2`；以 `instrumentType` 表達股票、各類 ETF、ETN 或其他商品，`dayTrade` 另存確認狀態、實際配對股數與 pairId。`kind/date/fee/tax` 僅保留舊資料相容，不再把「當沖」偽裝成商品類型。
- **已完成：effective-dated 稅額估算。** 一般股票賣出 3‰；2017-04-28～2027-12-31 內，只對已確認的股票當沖實際配對股數估 1.5‰，未配對股數仍為 3‰；ETF／ETN 為 1‰；符合資格的債券指數 ETF 在 2017-01-01～2026-12-31 估為停徵。主動式與槓反 ETF 不套停徵；尚未完成立法的延長／擴大停徵提案不先行實作。
- **已完成：實際費稅優先且歷史凍結。** `feeSource`／`taxSource` 區分 `estimated`、`broker`、`manual`、`legacy`；券商或手填金額包含 0 元都優先。費稅一經正規化即保存，之後修改預設折數不追溯重算歷史損益；`portfolio` 已實現列與 totals 保留 gross、fee、tax、source、ruleId 與 review 狀態供稽核。
- **已完成：v1 安全遷移。** `loadDb` 遷移前先保留每日 v1 rollback 備份，交易 rev 只 bump 一次且遷移冪等；舊費稅原值凍結，舊 ETF 轉成 `unknownEtf`、舊當沖轉成股票＋`legacyDeclared`，不臆測實際配對。格式錯誤、衝突或重複且不能安全轉換的紀錄進 `quarantinedRecords`，不納入損益、原始內容保留，後續 PUT 也不會靜默刪除。
- **已完成：前端記錄與一般交易修正。** 代號接受 4～6 碼英數，商品與當沖分欄，可填券商實際費稅並顯示「估／實／手填／舊」、當沖股數、待覆核與 quarantine 提醒。非股利交易可完整帶回表單修正並保留 id／createdAt；未變動的配對保留 pairId，改變配對條件則清除 pairId；清空非 legacy 實際費稅會撤銷 override、交由後端重新估算，legacy 金額仍凍結。取消修正不送 PUT，409 後會在最新版帳本重放同一修正。
- **仍未完成：官方商品分類。** 現行 `instrumentSource=user/legacy` 仍依使用者選擇或舊資料；尚未接官方商品主檔自動辨識股票型、債券型、槓反或主動式 ETF。使用者自行選「債券指數 ETF」且沒有官方分類或券商實際稅額時只能算估值，必須標記待覆核。
- **仍未完成：自動當沖資格與配對。** 尚未自動核對同券商／帳戶／日期／證券／數量、處置或變更交易資格，也未建立買賣自動配對；現行只接受明確確認與實際配對股數。庫存重放仍會擋賣超，因此先賣後買尚不支援。
- **仍未完成：多券商費率與整理工具。** `0.1425% × 折數＋最低費用` 仍只是一組預設估算方案，尚無多券商或有效日期化 commission profile；quarantine 目前只有安全保留與筆數提醒，尚無互動式修復／匯出工具。
- 本輪再核對的官方來源：[財政部證券交易稅條例](https://law-out.mof.gov.tw/LawContent.aspx?KeyWord=&id=FL006079)、[TWSE 現股當日沖銷交易](https://wwwc.twse.com.tw/zh/products/system/day-trading.html)、[TWSE 營業細則第 94 條](https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=94)、[TWSE ETF 投資人問答](https://investoredu.twse.com.tw/pages/TWSE_InvestmentQA.aspx?ID=11)。券商對帳單仍是實際費稅的最終依據。

### P1-12 10 秒更新會清掉「更多」頁正在輸入的表單

- 位置：`app.js:2711-2903`、`2931`、`7888-7947`、`8712-8733`。
- 實測：富邦設定輸入 `DO_NOT_CLEAR_WHILE_TYPING`，一次 `render()` 後欄位變空；盤中輪詢會走同一路徑。
- 修法：focused-form guard＋dirty surface render；敏感表單值進 state，無關行情更新不得重建。

### P1-13 策略健檢與行情來源切換有 stale-response race

- 位置：`app.js:3896-3914`、`2906-2955`、`8139-8148`。
- 影響：快速送 A/B 或切官方／券商時，慢的舊回應可覆蓋新查詢／新來源。
- 修法：沿用既有 `strategyLoadSeq`／`technicalState.requestId`／`searchState.token` 模式，必要時 AbortController。

### P1-14 [完成 2026-07-13] Dialog、焦點與畫面外控制未形成可操作的鍵盤模型

- 位置：dialog `index.html:455-674`；開關 `app.js:8535-8630`、`8878-9208`；手機 detail `styles.css:4337-4353`、`app.js:1801-1818`。
- 實測：搜尋 dialog 從最後一個控制 Tab 會離開；Esc 關閉後不回 opener。手機關閉的 detail 只 transform 出畫面，內部控制仍可 Tab 到。
- 修法：共用 dialog controller（保存 opener、背景 inert、focus trap、Esc、回焦）；closed detail 設 inert/aria-hidden，open 後移焦。
- 完成狀態：共用 dialog manager 已涵蓋 opener、背景 inert、Tab trap、Esc 與回焦；小於 1240px 的 detail 是 modal sheet，桌機維持 persistent aside。行情輪詢可能重建 opener，關閉時會依穩定 `data-*` 找到替代節點再回焦，真實 Chromium 與 jsdom 都有契約。

### P1-15 [部分完成 2026-07-13] UI 語意／鍵盤：tabs、表格、canvas、自製 button 不完整

- 位置：tablists `index.html:83-88`、`110-118`、`141-143`、`261-267`、`402-406`；行情列 `app.js:4268-4323`；canvas `index.html:247`、`253`、`415`、`508-510`；swing card `app.js:3616`、`8396-8404`；gloss link `8925-8927`。
- 問題：缺 `role=tab/aria-selected/arrow keys`；視覺表格無欄位語意與 `aria-sort`；canvas 無等價資料；`role=button` 不支援 Enter/Space；多數 focus ring 對比不足。
- 修法：原生 button/table 優先；完整 APG tabs；提供 K 線資料表與 scoped chart keyboard；統一高對比 `:focus-visible` token。
- 完成狀態：主 tabs 與處置／detail 局部重繪會同步 role、`aria-selected` 與 roving `tabIndex`；dialog/detail 鍵盤模型已完成。行情表格等價語意、K 線資料表與更完整的 chart keyboard 仍待續。

## P2：第二階段

1. **Sidecar persistence race**：`server.mjs:451-455`、`1314-1317`、`1855-1877`、`2328` 使用固定 `.tmp` 且 fire-and-forget。平行 20 次實測 16 次 `ENOENT`；改 per-file queue＋unique tmp＋`flushPersistence()`。
2. **Reference data 單點失敗**：`1588-1620` 的 `Promise.all` 讓任一市場失敗拖垮整份；改 `allSettled`＋per-market last-good＋single-flight。
3. **掃描 coverage 不可見**：歷史抓取 `.catch(()=>[])`／`catch{return null}` 會把限流呈現成正常 0 命中；API 應回 attempted/fresh/staleDropped/fallback/failed/byExchange，coverage 不足不凍結快照。
4. **靜態伺服器範圍過大**：`server.mjs:5667-5684` 真 HTTP `/server.mjs`=200，tests/node_modules/憑證檔也可能公開；改成 app-shell allowlist。Windows sibling-prefix traversal 本次實測 404，僅建議防禦性改 `path.relative/realpath`。
5. **certPath 路徑 oracle**：`server.mjs:427-441`、`2723-2746`、`5295-5312` 可測任意路徑存在，UNC 也可能觸發 SMB；限制到專用 `CERT_DIR` 與 server-generated ID。
6. **[部分完成 2026-07-13] Session／JSON DB 長期邊界**：成功登入會清掉所有過期 session，並把同一帳號限制在最新 10 組有效 session；多 process 共用 DATA_DIR 的 single-instance lock 與長期 SQLite 評估仍待續。
7. **[完成 2026-07-13] 官方公司行動**：已以 TWSE／TPEx 除權息公告、完整現增公式欄位、持久化 archive 與 official／heuristic／mixed／unresolved 狀態取代單純缺口猜測；不完整官方事件會阻擋結論，撤回公告保留稽核但不再套用。公式版本為 `swing-v16-official-corporate-actions`。
8. **隔日沖分數／統計契約**：`scoreDanger=105`、`scoreReversal=110`，同碼跨群會在 overall 重複加權；決定 overall 是「訊號數」或 unique stock，修正 0–100 並升公式版。
9. **績效的可交易性**：signal close 是分析基準，不是收盤後可成交價；另建 next-open／limit-entry cohort、合法 tick、gross/net-of-costs，保留原 cohort 不回寫歷史。
10. **[部分完成 2026-07-13] 股利／公司行動 ledger**：現金股利已依除息日前交易回算 entitlement，並拆成應收／已入帳／已認列，官方事件可用同一 id 更正；股票股利、減資與分割合併對庫存成本／股數的 ledger 仍待後續產品設計。
11. **Partial data 被快取成完整**：基本面／法人／融資任一市場有資料就可能停止回溯或吃滿 TTL；改 per-exchange provenance/asOf、修訂 upsert、兩市場獨立 walk-back。
12. **輪詢與全站重繪**：每次行情成功後 render 全畫面、再抓法人／融資並 render；導入 dirty flags、active-screen render、日期＋codes freshness，resize 合併 rAF。
13. **Responsive／a11y polish**：手機 icon 38px、畫線工具 30–38px、色票 18–22px；跌幅綠底白字實測約 3.81:1；320px strategy 內部約 10px overflow；PWA 不應強制 portrait。
14. **[外部依賴已完成 2026-07-13；design tokens 待續]**：Lucide 1.24.0 已以原 SRI 雜湊驗證後自架，繁中字型改走各平台原生字型，兩者都納入 `stock1-shell-v3`；CSP 已收斂為 `script-src 'self'`，inline style 只放行 attribute。真實 Chrome 已驗證伺服器離線、首頁帶 query 時仍由 Service Worker 載入完整 55 個圖示。其後只剩 semantic color/focus/z-index tokens 的長期整理，不必為 token 強加 light mode。
15. **UI 小回歸**：`renderWatchTabs()` 把「庫存損益」改成「清單 hold 0」；桌機 rail 有 7 項但 CSS `repeat(6)`；自選空狀態仍繼承 704px。
16. **[完成 2026-07-13] 文件漂移**：風險股政策、波段／隔日沖語意、還原權息、股利應收／實收、測試數量與來源降級文件已同步，並新增名詞表契約防止舊文案回歸。
17. **前端 reduced-motion／對比**：目前只涵蓋一個動畫；局部仍使用 11–13.5px 與 `--dim` 閱讀文字。
18. **[部分完成 2026-07-13] 維護基線**：`package.json`／lockfile 已鎖定 Node 20.19+、22.13+ 或 24+。目前仍不是 git repo，重大財務邏輯沒有可靠 diff/rollback；建議先做本機 private Git（不必上傳）、版本 tag＋CHANGELOG。`.agents` 指向不存在的 `.Codex/launch.json`，實際只有 `.claude/launch.json`，也仍待清理。

## 下一輪高價值方向（2026-07-13）

1. **個人資料可攜與異地復原**：提供每位使用者的 watchlists／alerts／trades／notes JSON 匯出與可驗證還原；另設不含券商密碼的管理者備份包。這比只靠同機 `.data/backups` 更能處理磁碟故障。
2. **程序生命週期**：加入 SIGINT／SIGTERM graceful shutdown、等待 persistence queue、登出券商 client；補 `/api/health`／版本資訊與啟動資料庫鎖，讓部署更新與異常診斷可觀測。
3. **非同步 latest-intent**：明細連續點 A／B 時，A 的慢回應不可覆蓋 B；登入後冷啟動請求也可合併，降低 waterfall 與重複 render。
4. **產品命名與來源單一化**：重新檢視「盤中選股」是否準確描述目前內容；逐步把重複的 tab／menu 樣板與資料來源收斂成單一設定，避免文案與鍵盤語意漂移。
5. **先做決策再實作的交易功能**：自動當沖配對／資格、先賣後買、多券商費率與績效口徑仍需產品定義，不以猜測方式偷偷上線。

## 測試體系要補的洞

- 維持現有 `node:test + jsdom`，不新增測試框架。
- Persistence failure injection：recovery two-restart、queue first-fail/second-success、20-way sidecar、shutdown flush。
- Domain mutation/boundary：跨市場日、Yahoo timestamp、opening gap、ordered pullback、formula cohort、score 0–100、TPEx 全形旗標。
- Frontend contracts：XSS、A/B deferred promise、focused form、dialog/inert/focus、tabs、hold 文案與 7-row rail。
- `test:live` 增加最脆的法人 19/24 欄、融資 table/index、MIS/Yahoo timestamp、fundamentals 日期/單位；新增 `test:live:strict`，至少 N 個來源真的通過，不能全 skip 仍綠。
- 320 / 390 / 820 / 1440、鍵盤與對比仍走 preview/browser 矩陣；不必為此引入大型 e2e runner。

## 分批改善順序

### Phase 1 — 安全與資料完整性（不改策略公式）

1. P1-01 XSS。
2. P1-02～04 production guard、recovery、DB queue。
3. Sidecar queue／flush。
4. 靜態 allowlist、certPath sandbox、API bounds/single-flight。
5. 針對以上項目補 failure-injection 測試。

### Phase 2 — 股票與驗證正確性（會有明列行為變更）

1. 跨市場日期＋Yahoo 同源 OHLC。
2. TPEx 全額交割。
3. opening-gap 驗證、formula cohort、同日重試。
4. ordered pullback（升 swing formula version）。
5. **[部分完成 2026-07-13]** 稅費 schema v2、effective-date／asset model、安全遷移與一般交易修正已完成；續做官方商品分類、自動當沖資格／配對／先賣後買及多券商方案。
6. coverage/provenance，不完整資料不得凍結。

### Phase 3 — Frontend hardening

1. 表單保存與 async race。
2. dialog/detail focus model。
3. tabs/table/canvas/keyboard semantics。
4. touch target、contrast、orientation、empty state。

### Phase 4 — 效能與維護

1. dirty render、法人/融資 freshness、resize rAF。
2. self-host assets、semantic tokens、reduced motion。
3. live semantic canary、文件契約測試。
4. 本機 Git、版本與 release checklist；再決定是否值得拆單檔，先不要為重構而重構。

## 行為變更提醒

以下修復不能靜默做，實作時必須升公式版或在交付摘要明列：

- ordered pullback 會改變波段候選、target、RR 與排名。
- 隔日沖分數 clamp／權重與 overall 去重口徑會改歷史統計。
- opening-gap 優先順序會改部分既有 win/loss。
- formulaVersion 分 cohort 會讓總樣本數與勝率改變，但舊 entry 不應刪除。
- **[已實作 2026-07-13]** 稅費 asset/effective-date 模型只改新紀錄與缺少實際費稅時的估算；v1 既有費稅在遷移時原值凍結，不回算歷史。後續官方分類、自動配對或多券商方案若會改估算口徑，仍須在交付摘要明列。
- 風險股政策本身維持「顯示＋標示＋可切換隱藏」；只修 TPEx 漏標與錯誤文案。
