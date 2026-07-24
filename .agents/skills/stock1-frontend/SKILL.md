---
name: stock1-frontend
description: Stock1 前端（app.js vanilla JS＋styles.css＋index.html）開發規範——state/render/事件委派、escapeHtml 安全、交易帳本 v2 表單/修正流程、字級 token 與 UI 修版心法、localStorage 旗標、preview 驗證。凡是改 UI、交易紀錄互動、字級配色版面、加畫面功能或修「看起來不對」，動手前先讀這份。
---

# Stock1 前端開發規範

零框架 vanilla JS：app.js（約 11,778 行）是 **classic script**（不是 module），頂層 const 進全域——這是測試 harness 的依賴，**不要改成 ESM/打包**。Lucide 1.24.0 自架於 `lucide.min.js`；中文採各平台原生繁中字型，代號、價格、漲跌、量價與計數等資料數字使用 `fonts/` 內自架 IBM Plex Mono 2.5.0 Latin1 三字重。禁止重新引入 runtime CDN。純前端改動交付時提醒使用者 **Ctrl+F5**（SW 是 network-first，重整一次就是新版）。

## 程式模式（跟著既有寫法走）

- **狀態**：每個功能一個模組級 `xxxState` 物件（authState/dataState/strategyState/surveillanceBoardState/personalBackupState…）＋全域 `state`（screen/sort/filter 等）。全域 `stocks` 陣列啟動時為空、由官方報價動態建立。
- **渲染**：`renderXxx()` 函式以 template literal 組 HTML 塞 `innerHTML`。**任何使用者可控字串（備註、簡介、顯示名、id、股名）必過 `escapeHtml()`**——全站已零 XSS 破口，別打破。
- **事件**：集中在少數幾個 document 級委派 listener，用 `event.target.closest("[data-xxx]")` 分發。新互動元素加 `data-*` 屬性接進既有 listener，不要每個元素各掛 listener。
- **API**：一律 `fetchApi(path, options)`（自帶全域載入條計數＋錯誤正規化）。401 錯誤在呼叫端用 `handleAuthRequired(error)` 判斷處理，別自己 parse 狀態碼。
- **提示**：`showToast(message, duration?)`——時長自動隨訊息長度（85ms/字、上限 6.5 秒），重要通知（到價提醒）明確給 8000。頂部滑動進度條/`.mini-spinner` 載入樣式已有整套，沿用別重做。
- **非同步競態**：會被快速切換的載入（如策略雷達切場景）用遞增序號模式——請求時捕捉 `seq`，回來時 `requestId !== currentSeq` 就整包丟棄（`strategyLoadSeq` 是範本）。
- 10 秒輪詢 `refreshLiveData`：只在台股盤中／期貨夜盤打、夜盤只更新指數；`autoRefreshInFlight` 必須在第一個 await 前上鎖，回來後重驗可見性與資料源。市場／個股 loader 用 `renderNow: false` 抑制各自重畫，到價提醒合併進同一輪，最後只呼叫一次 `renderLiveDataUpdate()` 做受保護提交。
- 背景行情提交必須保護尚未送出的 dirty form，並以穩定的 `id`／`data-*` 身分在 DOM 重建後還原鍵盤焦點；不可用一般 `render()` 清掉券商憑證、密碼、帳號或到價草稿。法人與融資券補充資料由 `refreshSupplementalMarketData({ liveUpdate: true })` 合併載入，兩個 loader 都 suppress render，完成後最多再做一次同樣的受保護提交。
- tabs 的 full render 與 partial render 都要呼叫 `syncTabListAccessibility()`，同步 class、role、`aria-selected` 與 roving `tabIndex`；不能只改視覺 active class，否則輪詢後讀屏狀態會漂移。

## 交易帳本 v2 前端慣例

- `tradesState` 保存 `schemaVersion`、`records`、`quarantinedRecords`、portfolio 與 rev；每次 PUT 明確送 v2。409 後由 `putTradesWithRetry()` 先抓最新版再重放本次新增／修正／刪除，不可直接覆蓋較新的整包。
- 表單把「買賣別」「商品類型」「當沖確認」拆成不同欄位；股票型、債券指數、槓反、主動式 ETF、ETN 與待確認商品不得再塞回舊 `kind`。代號接受 4～6 碼大寫英數（例如 `00725B`），驗證不得退回純數字 regex。
- 「當沖與券商實際費稅」是選填 details。只有股票賣出可選 `brokerConfirmed`／`userConfirmed` 並填實際配對股數；零股與鉅額擋下。實際手續費／證交稅留白代表交給後端估算，填 0 必須保留為明確實際值，不可用 truthy 判斷。
- 卡片顯示商品、當沖配對、費稅來源（估／實／手填／舊）與待覆核 badge；server 回來的 `reviewReasons`／`taxRuleId` 要保留，不能只顯示金額。`quarantinedRecords` 只顯示安全保留提示，前端不能把隔離資料混進損益或自行丟棄。
- 非股利交易可按「修正」回填原紀錄；儲存必須保留 id/createdAt，經濟欄位改變時清舊 estimate 讓後端重算，原本 broker/manual 實際金額可修正，清空則改回估算；未改經濟內容的 legacy 金額保持凍結。股利仍走既有入帳／更正流程，買賣紀錄不得直接改成股利。
- 歷史預設顯示 40 筆，`tradesHistoryLimit` 每次「載入更多」加 40；這是顯示分頁，不可截斷送回伺服器的 `records`。
- 新增或變更代號時用 `/api/instrument-profile` 顯示 TWSE／TPEx 官方商品分類；來源降級／查無時維持使用者選擇與待覆核，負向結果不能自動改成股票。PUT 仍由 server 重新核定，前端不得自行蓋 `official`。現況限制要在 UI 文案與交付說明中說清楚：沒有自動當沖配對與先賣後買；只有 `brokerAccountId="default"` 的單一估算設定，沒有多券商費率方案。表單收集 session/executedAt 只是後續配對資料，不代表功能已完成。

## localStorage 旗標清單（新旗標跟著命名：`stock1.<name>.v1`）

`stock1.showSurveillance.v1`（顯示注意/處置股，預設開）、`stock1.survMineOnly.v1`、`stock1.survSort.v1`、`stock1.zoomHelpSeen.v1`、`stock1.chartDrawings.v1`（畫線，每檔上限 40 筆防塞爆）；較舊的三個：`stock1-selected-code-v1`、`stock1-watch-lists-v1`（登入後以伺服器為準）、`stock1-data-source-v1`。

## 更多頁的個人資料備份／復原

- 更多頁有獨立「個人資料備份」tile；未登入只顯示登入 gate。匯出一律由 `GET /api/personal-data/export` 取 server bundle，再用 Blob＋暫時 URL 下載並 revoke；畫面必須說清楚不含密碼、session、券商憑證與其他使用者資料。
- 復原是固定 `#personalBackupModal` managed dialog：背景 inert、初始焦點、Tab trap、Escape／X／背景點擊關閉與 opener 回焦都沿用全站 modal manager。檔案先在 client 擋超過 16 MB、非 JSON、錯誤 format/version，之後才 POST `/api/personal-data/restore/preview`；未拿到 server preview token 前不得啟用提交。
- 預覽要顯示來源／目標帳號、檔案與各區 before→after、隔離／略過／warning；所有 bundle 與伺服器回傳字串都視為不可信並走 `escapeHtml()`／長度限制。桌機來源 metadata 善用六欄，摘要採平面分隔格而非 card 疊 card；tablet／手機依 2／1 欄收斂，按鈕仍至少 44px。
- 提交前同時要求確認 checkbox 與目前密碼；前端送單次 preview token 並固定帶 `confirmation: "RESTORE"`，成功後重新載入 watchLists／alerts／trades／notes 的伺服器 canonical 資料。關閉 modal、401、登出或切帳號時必須清 file/password/source/token 並遞增 request seq；任何舊 async 回應都要以 auth scope＋seq 丟棄，不能把前一個帳號的預覽畫回來。

## 字級與顏色鐵律（使用者反覆校正出來的，勿退步）

- token（styles.css `:root`）：`--fs-body:15px`（內文下限）、`--fs-note:14px`（備註/頁腳）、`--fs-badge:12.5px`（小徽章下限）、`--muted-2:#c3cbd3`（亮說明灰）。**新元件不要再手寫 11–14px——備註用 `var(--fs-note)`、徽章用 `var(--fs-badge)`，內文/按鈕一律 ≥15px**（2026-07-16 已全站掃除一輪；豁免僅 bottom-nav 12.5、`.segment-count` 13、`.nav-action` 基底 13）。
- 內文 <15px 使用者一定嫌小；說明卡內文 18px 起跳。調字級不要 1–2px 微調，直接跳到舒適下限。
- `--dim`(#656c75) 在深色底上太暗，**不要用在需要讀的文字**；色階＝主要 --text → 次要可讀 `--muted-2` → 真正次要才 --muted。**灰階文字色禁止再手寫 hex**（#a7b1bb/#9aa6b1 之類一律收斂回這三階；2026-07-16 已清過一輪）。
- 手機底部導覽 12.5px 是「4 字 × 7 分頁」的裁切上限，勿再加大。
- **mono 數字字重上限 700**：自架 Plex 只有 500/600/700 三字重，寫 800/900 會合成粗體變醜；body 已設 `font-synthesis-weight: none` 防再犯。canvas 圖表的 `ctx.font` 一律 `'700 <size>px "Stock1 Plex Mono", IBM Plex Mono, …'`——"IBM Plex Mono" 系統沒裝，漏掉自架字型名會 fallback 到 Courier New。
- 台股配色：紅漲綠跌；只有平盤或真正無法判定漲跌才用中性灰。**漲跌語意 token 分三層**：可讀文字用 `--up-text`(#ff6b66)/`--down-text`(#4ce08a)、底色用 `--up-surface`/`--down-surface`、K棒/bar 資料圖形用 `--red`/`--green`——不要再手寫紅綠 hex 碎片。`priceStale` 只表示目前顯示官方收盤／昨收，須以「收盤」文字揭露新鮮度，但**不得抹掉相對昨收的紅綠方向**；跨日 MIS 最後成交同理。判定類 UI（健檢 ✓/✗）用綠=通過/灰=未達成，不要用紅（紅=漲會誤讀）。
- 行情 nullable 欄位不能直接 `Number(value)`：`Number(null) === 0` 會捏造 0 元、0 張或 0.00%。成交價先走 `positivePriceOrNull()`；其他可為負或合法為零的數值走 `finiteNumberOrNull()`；顯示缺值用 `--`。`mergeOfficialQuote()` 與 `upsertStockFromQuote()` 必須保留這道前端防線，即使後端已正規化也不能移除。

## UI 修版心法（「無效空白多、字又小」的既定解法）

1. 先判斷內容該佔多大版面：稀疏中繼資料用**緊湊單行列**，不要硬塞大 KPI 格。同一塊被使用者嫌第二次＝**換 layout 範式**，不是繼續調參數。
2. 「無效空白」兩病因：①短句獨佔一排（右側大片空白）→ **併入既有列或整排砍掉**，資訊量用 title 屬性補回；②grid 等高聯動被最高格撐高。縮 padding 是小錢，砍整排才是大錢。
3. 對齊：使用者偏好**上下置中＋左右置中**（表頭全置中定案）；KPI/tile 內容置中比靠左更能消除右半空白感。
4. flex column 裡**不要用 `<br>`＋裸文字**（匿名 flex item 行為不定）——每行包正式元素、用 gap 控行距。排序箭頭這類裝飾用 `position:absolute` 吊掛，避免擠歪置中文字。
5. 內容區是固定寬「裝置框」（桌機下策略欄約 590–870px、卡片欄約 280px）：「標籤＋數值」用兩行式，別假設有整個桌面寬。
6. 觸控控件 44px 高、字 15px 起（App 觸控規範，處置看板對齊過一輪）。
7. `.empty-state` 的 min-width:704px 已於 2026-07-16 移除（改 min-width:0），窄欄可安全使用；各功能專屬空狀態（如 `.surv-empty`）仍優先。
7b. **方正硬派風格鐵律**（2026-07-16 收斂定案）：圓角尺度 2-4px 微件｜6px 小控件｜8px 卡片/按鈕/輸入框｜12px modal｜16px 大型 modal｜999px 藥丸，勿再混用 5/7/9/10/11px 中間值（zoom 側 tab `14px 0 0 14px` 是貼邊功能性例外）。focus 樣式＝實色邊＋實線 outline（`outline: 1-2px solid var(--orange)`），**禁止半透明光暈 box-shadow**；裝飾性漸層卡底禁止（資料編碼類漸層如 K棒/進度條/載入條可以）。
8. 處置卡的「名稱／代號市場／價格」三群採**固定視覺中心欄＋左右等分剩餘寬度**：中欄固定落在卡片中心，名稱靠左、報價靠右，避免留白全堆在名稱旁而讓中欄黏住報價。資訊層級以名稱／價格最大，代號、上市櫃、分盤、狀態與量都不可低於 16px；極窄手機只調整中心欄與 padding，**不縮主字級**。詳情的即時／均線／法人／基本面四 tab 桌機維持單列，避免產生無效空白；至少量 1366／390／320／280px 的 `scrollWidth <= clientWidth`。
9. 自選股表格優先把列高用在可讀性：名稱 22px、代號 18px、原因 16px、成交價 24px、漲跌 19px、指標值 22px；成交價與漲跌使用 tabular numerals、各自獨立一列且整欄水平置中。桌機不可為了塞滿欄位退回小字，窄螢幕由 `.watch-table-scroller` 承接橫向捲動。
10. 隔日沖總覽的三組訊號各自先拿一欄，自選股與資料可信度使用滿寬橫向狀態列；三欄清單內每檔採「分數／完整名稱與代號＋雙欄報價」兩欄式，禁止以 ellipsis 把股票名稱縮成「鑫…／光…」。寬度不足時讓名稱正常換行或改變卡片結構，不得犧牲名稱資訊。總覽摘要條是**單一 wrap 流**（`.overnight-summary` flex-wrap＋primary/facts `display:contents`，warnings 獨佔整行），勿改回三段垂直堆疊——overnight 測試有釘。
11. 全站資料數字走 `--mono`（自架 IBM Plex Mono）＋tabular numerals，中文名稱／標籤走 `--sans`；盤中選股的欄寬與字級仍以 `.screener-screen` 隔離，`--screener-mono` 應沿用共用 `--mono`，不要再讓 Consolas 成為最終視覺。桌機表格應在主欄完整容納，窄螢幕由 `.table-scroller` 承接橫向捲動。
12. 策略雷達卡片把名稱／代號與收盤／漲跌固定成左右主列，型態／警示另成訊號列；排名只佔前兩列，從上榜理由起必須吃滿卡片寬度。桌機交易計畫維持六欄且名稱 ≥25px、收盤 ≥28px、計畫數字 ≥24px；手機排名改橫向、計畫收成兩欄，column flex 內的說明不得沿用桌機 `flex-basis` 撐出假空白。
13. 盤中選股第一欄是「K棒／標的」雙軌，不是上下兩行的同一中心：表頭與資料列共用 `34px + minmax(0, 1fr)`、6px gap 與相同 padding；K棒置中於固定軌，標的標籤與名稱左緣對齊。欄位最小寬 160px 且不吃掉多餘比例寬度，應把空間留給成交價等數字欄；兩個表頭標籤維持相同字級。`.stock-row` 必須明確 `padding:0`，避免 button 原生左右 6px 讓所有資料欄一起偏移。
14. 自選股表格要把 K棒與標的當成完整的置中群組：第一欄至少 174px；走勢欄只留圖表本身的 86px（而非用無效白邊撐寬）；表頭、一般列與管理模式的 grid 欄位必須同步更新，避免選取模式錯位。

## index.html 結構

7 個 `[data-screen-panel]` 主畫面＋右側個股詳情面板＋彈窗（K 線放大 zoom、處置說明 survHelp、個人資料復原 personalBackup 等 `.modal-backdrop` 模式：X/背景點擊/Esc 三種關法）。新彈窗照這套。桌機三欄工作台斷點是 **1040px**（2026-07-16 從 1240 恢復；styles.css 的 `@media (min-width: 1040px)`、app.js `detailDesktopMedia`、strategy/modal-manager 兩個測試共四處必須同步）。小於 1040px 的個股詳情是 managed modal sheet：closed 必須 inert／`aria-hidden`，open 後移焦、trap Tab、背景 inert、Esc／history 關閉並回焦；桌機則是 persistent aside，不可套 `aria-modal` 或搶焦。行情輪詢會重建股票列，opener 不能只存舊 DOM 節點，必須用 `resolveDetailPanelOpener()` 依穩定 `data-*` 找替代節點。表頭按鈕結構是 `<span>／<em>` 兩行（勿用 `<br>`）。

## 驗證流程（preview）

1. `preview_start` 用 **stock1-test（5180）**，絕不碰 5174。stock1-test 走獨立 `DATA_DIR=.data-preview`（空 DB，與使用者正式伺服器可同時在線；帳號/自選股本來就該用假資料注入，見第 5 點）。**收工前必關 preview 伺服器**——留著會佔 writer lease 害使用者（若忘了，之後遇到 `DATA_DIR_IN_USE` 就是它）。
2. **preview_screenshot 在此環境常逾時或縮小**——既定慣例：用 `preview_eval` 讀 `getComputedStyle`/`getBoundingClientRect`＋`preview_snapshot`（a11y）驗證，截圖成功是加分不是必要。
3. 量桌機版面前先 `preview_resize` 到 ≥1280 寬——fresh preview 視窗很窄，chips 會換行、media query 失效，量出來的高度不準。
4. `preview_click` 可能命中 rect=0 的隱藏元素——改用 `preview_eval` 挑「`getClientRects().length > 0`」的可見元素 `.click()`。
5. 需要登入態的畫面（帳號管理、庫存）：用 preview_eval 注入假 `authState.user`＋假資料再 `render()`，不要真的登入正式資料庫。
6. 改動涉及 app.js 邏輯（非純 CSS）→ tests/frontend 補 jsdom 測試（見 stock1-testing）。
