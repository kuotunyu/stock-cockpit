---
name: stock1-upstream
description: Stock1 使用的官方資料源目錄與欄位陷阱大全（TWSE/TPEx OpenAPI、MIS 即時、期交所、Yahoo 備援）＋「資料壞了」的除錯 SOP。凡是行情/法人/處置/基本面資料突然對不上或抓不到、要接新的官方資料源、或懷疑官方改版，先讀這份省掉重查一遍的時間。
---

# Stock1 官方資料源目錄與陷阱

所有端點都經過實測（2026-06~07）。欄位名陷阱是真金白銀踩出來的——接新資料源前先掃一遍「通用陷阱」。

## 資料壞了的除錯 SOP

1. 先跑 `npm run test:live`（17 個上游形狀檢查，網路失敗會 skip 不 fail）——fixture 與官方欄位漂移一測便知。
2. 看 API 回應的 `warnings[]`（後端部分失敗會降級並註記，不會整包炸）。
3. 確認是否限流：TWSE 對高並發逐檔歷史限流（回空/403），等一等或降並發；處置/風險名單有 last-good 快取（1h 新鮮/26h 可容忍），短暫失敗會沿用舊名單。
4. 用臨時埠起 server 打端點目測（絕不佔 5174）；必要時加臨時 debug 路由，**查完必移除**。

## 通用陷阱（先讀這段）

- **TWSE 網頁版（www.twse.com.tw）對程式化請求反爬 403（IP 層級）**——一律走 `openapi.twse.com.tw` OpenAPI，不要用網頁版端點。
- TWSE MIS 需要 `referer` header（mis.twse.com.tw / mis.taifex.com.tw 同理）。
- 日期格式混雜：民國 7 碼（"1150612"）、民國斜線（"115/06/12"）、西元 8 碼——一律過 `toCompactDate`（能自動 +1911）；別自己 parse。
- 官方欄位有拼錯字並且**不會修**：TPEx `tpex_daily_qutoes_block`（qutoes）、`ExRrightsExDividendDate`（Rrights）。照抄，別「順手修正」。
- 全形字元：TPEx `tpex_cmode` 的 `AlteredTrading==="Ｙ"` 是**全形Ｙ**；全形數字/負號要正規化。
- 單位陷阱：TWSE 日成交量與 TPEx `TradingShares` 都是**股**（都要 ÷1000 成張）；月營收單位是**千元**。
- 空資料的形狀不一致：有的回 `[]`、有的回**一筆全空白列**（TPEx `tpex_spendi_today`）、有的回單筆空 row——一律用 `/^\d{4}$/` 濾代號＋欄位有效性檢查。
- 處置公告含 6 碼權證列，用 `/^\d{4}$/` 過濾。
- STOCK_DAY_ALL（整批收盤）、逐檔 STOCK_DAY、MIS 即時**更新時間不同步**；逐檔歷史高並發會被限流（詳見 stock1-backend 掃描教訓）。

## 即時行情

- 個股：TWSE MIS `getStockInfo.jsp?ex_ch=tse_XXXX.tw|otc_XXXX.tw`。`z`=最新成交價（**可能是 `-`**）、`pz`/`oz` 備援、`y`=昨收。`z/pz` 都是 `-` 時，`oz` 仍可能回 `0.0000`（例如無即時成交的 7782），這也是**無成交哨兵，不是 0 元股價**；三欄只有可解析且 `>0` 才能當價格。無有效價 → `priceStale=true` 退官方收盤（語意＝昨收／收盤）。
- Yahoo 備援：`query1.finance.yahoo.com/v8/finance/chart/{code}.{TW|TWO}?range=1d` 取 `meta.regularMarketPrice`＋`regularMarketTime`（30 秒、有上限 LRU 快取）；只有交易日等於台北今日才可在 MIS 無 z 時升格即時，並必須改寫成 Yahoo 自己的日期與同日 OHLC，舊日或缺時間不得覆蓋官方收盤。歷史備援同 host（range 2y），timestamp 一律轉 Asia/Taipei 日期。
- 大盤：MIS `tse_t00.tw`。台指期：期交所 MIS `mis.taifex.com.tw/futures/api/getQuoteList`（POST；**日盤夜盤同 URL**，依時段回；fetch-mock 看不到 POST body 所以測試兩時段回同一份）；失敗退期交所日報表；近月選量大者；合約月碼字母→月份、年碼跨十年進位（taifexContractMonthLabel）。

## 收盤/歷史

- 整批收盤：TWSE `exchangeReport/STOCK_DAY_ALL`、TPEx `tpex_mainboard_daily_close_quotes`。兩市場各自 single-flight＋last-good（5 分鐘）；空陣列、無有效代號價格，或已有正常快照後有效筆數驟降至 60% 以下，都視為失敗，不得覆蓋 last-good。兩市場皆新鮮且資料日一致才算完整覆蓋；降級結果 30 秒後重試。
- 逐檔月 K：TWSE `STOCK_DAY?date=&stockNo=`（分頁按月；`addMonthsCompact` 一律回目標月 1 號是刻意特徵）。
- 公司主檔：TWSE `opendata/t187ap03_L`、TPEx `mopsfin_t187ap03_O`，一次解析出發行股數、產業與公司簡稱。兩市場各自 single-flight＋last-good（24 小時），失敗 5 分鐘後重試，同樣有 60% 半包防護。

## 交易日／隔日驗證

- 實際交易日：TWSE `exchangeReport/FMTQIK`，取 `Date`；此端點主要涵蓋當月，超出涵蓋範圍時不能拿它否定舊月份交易日。
- 開休市表：TWSE `holidaySchedule/holidaySchedule`，消費 `Date`、`Name`、`Description`；文字含「開始交易」或「最後交易日」視為開市 override，其餘日期視為休市。
- 若排定日遇臨時休市且 FMTQIK 未涵蓋，至少兩檔官方月歷史形成多數共識才可修正觀察日。
- 正式驗證只接受觀察日完全相等的整批收盤或官方逐檔月 K。觀察日盤中只能使用 MIS 原始 `d`＋`o/h/l`，fallback 日 K 的 O/H/L 不得冒充盤中證據。

## 法人／融資券（陣列索引映射，最脆）

- 三大法人：TWSE `fund/T86`（**19 欄陣列**，索引映射見 normalizeTwseInstitutionalRow）、TPEx 對應端點（**24 欄**）。外資含自營的加總檢核：foreignTotalNet ?? (foreignNet+foreignDealerNet)。
- 融資券：TWSE `rwd/zh/marginTrading/MI_MARGN?selectType=ALL`、TPEx `margin/balance`。
- 兩者都有「當日未公布→自動往前找最近交易日（walk-back，最多 6 天）＋warnings」。

## 注意／處置／全額交割／停牌

- TWSE 處置 `v1/announcement/punish`（`DispositionPeriod "115/06/12～115/06/26"`、`Detail` 含「每五分鐘」=5 分盤）；注意 `v1/announcement/notice`（`NumberOfAnnouncement`=累計次數）；鉅額 `v1/announcement/BFIAUU`（逐筆，依代號聚合）；變更交易（=全額交割）`v1/exchangeReport/TWT85U`（`PeriodicCallAuctionTrading` "*"=兼分盤）。
- TPEx 處置 `tpex_disposal_information`（`DispositionPeriod "1150626~1150709"` 波浪號無斜線）；注意 `tpex_trading_warning_information`；鉅額 `tpex_daily_qutoes_block`（filter Date===今天）；全額交割 `tpex_cmode`（AlteredTrading 全形Ｙ、filter Date===今天）。
- **別用**：BFT41U（不是鉅額，是全市場報價）、`tpex_daily_trading_block`（無 Code 欄、是歷史）。
- 停牌：TWSE `exchangeReport/TWTAWU`（**含已恢復歷史列，必須加日期窗**）；TPEx `tpex_spendi_history`（resume 空字串=仍停牌）。下市：TWSE `company/suspendListingCsvAndHtml`（含 2001 年以來全部，**只取近 730 天**防回收代號誤殺）。**TWTB4U 不是停牌清單**（是當沖標的註記）。TPEx 無下櫃名單端點。

## 基本面（Phase A，官方只回最新一期→自建歷史）

- 月營收：TWSE `t187ap05_L`／TPEx `mopsfin_t187ap05_O`——**中文欄名**（`營業收入-當月營收`）、`資料年月` 民國 5 碼（"11505"）、只有最新一個月→`fundamentals-cache.json` 累積（營收 13 期/EPS 9 期）；月初~10 日還是上上月資料。
- EPS：TWSE `t187ap14_L` vs TPEx `mopsfin_t187ap14_O` **欄名不同**（`基本每股盈餘(元)`+`公司代號` vs `基本每股盈餘`+`SecuritiesCompanyCode`）。
- 估值：TWSE `BWIBBU_ALL`（PE/殖利率/PB 日更）、TPEx `tpex_mainboard_peratio_analysis`（多 `DividendPerShare`）。
- 除權息：TWSE `TWT48U_ALL`（`Date`／`Code`／`Exdividend`／`CashDividend`／`StockDividendRatio`／`SubscriptionRatio`／`SubscriptionPricePerShare`）；TPEx `tpex_exright_prepost`（拼錯的 `ExRrightsExDividendDate`，現增比率欄是 `SubscriptionRatioToNewSharesIssued`）。kind 正規化為「除息/除權/除權息」。
- 兩市場各自 single-flight＋last-good（6 小時），失敗市場下一輪可單獨重試，合併層只給降級結果 30 秒 TTL。API 以 `sourceStatus` 保留 fresh/stale/unavailable；基本面頁對該股票所屬市場顯示「沿用」或「無法確認」，不可把 stale 公告標 fresh，也不可把 unavailable 的空陣列解讀成「沒有股利」。
- 每次成功抓到的過去／未來事件都寫 `fundamentals-cache.json`，保存 source、schemaVersion、formulaComplete、observedAt/lastSeenAt、revision。後續完整快照缺少原未來事件時保留紀錄但標 `withdrawn`；只有 active 才能進未來 UI 與公司行動還原。
- HTTP 200 仍可能是半包：已有至少 10 筆未到期 last-good 時，新快照低於 60% 視為失敗，不覆蓋也不誤標 withdrawn。比較分母只算「以本輪台北今日仍未到期」的舊事件，已自然過期的公告不算驟減。

## 接新資料源的 checklist

1. 走 `fetchJson`（自帶 20 秒逾時）；限流敏感用 `fetchJsonWithRetry`。
2. 正規化函式寫成純函式、fixture 欄位 1:1 抄消費端、加離線測試＋live 形狀檢查。
3. 失敗策略想好：last-good 快取？walk-back？warnings 降級？不要讓單一來源失敗炸整個端點。
4. 民國日期過 toCompactDate；單位（股/張、千元）先確認；空資料形狀先打一次真 API 看。
