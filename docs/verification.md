# 驗證模型、證據與保存

維護者可用 `node scripts/verification-diagnostics.mjs --o08` 執行離線合成診斷：比較相同候選池的 raw／packed／mixed 與 pending、個人計畫，重複量原子保存、同時查詢、摘要、記憶體及 Chromium renderer。先登記機器、資料規模、採樣次數和比較預算；暖樣本至少 50 筆才報描述性 p95，冷啟動個別列示。命令只建立隔離 temp 資料與臨時埠，詳細量測定義及限制見 [測試指南](../tests/README.md)。這些資料不能證明目前 UI 已慢，也不能換算成正式保存年限或 SQLite 遷移理由；超出事前預算時，先提出有明確範圍、資料遷移與回復契約的下一步。

API 的 `publication` 提供 captureId、版本身份、輸入指紋、request scope、來源日期精度與本機取得／發布時間；寫入失敗回 `kind: "not-persisted"` 並保留重試提示。正式身份與全部修訂保存在主 DB 的 `verificationPublications`，與訊號／驗證單同次原子提交及備份。來源只有日期時不補造時分秒；週一才取得週五清單，不代表週五已能決策。 發布先原子保存清單與 `publicationStartedAt` 下界，再一次性補存真正可讀後的 `availableConfirmedAt` 上界；`publishedAt`／`decisionAvailableAt` 採此保守上界並標 `confirmed-available-upper-bound`。補證失敗不撤銷正式清單，時間保留 null 與原因；之後讀取時用當下真實時間補證，不能回填。跨開盤的提交區間不能直接認定必定晚發布。

評估 metadata 分為 `selectionVersion`、`evaluationVersion`、`costModelVersion`、`cohortPolicyVersion`、`entryModel`、`returnBasis`（schema 2），另保留 `formulaVersion` 相容。舊價格觀察算式為 `overnight-price-observation-v1`／`swing-price-observation-v1`，成本為固定扣 0.471 個百分點的 `flat-round-trip-0.471pct-v1`，母體政策為 `first-canonical-publication-v1`。這些仍是收盤基準的還原座標價格觀察，並非成交或帳戶含息實績。

成績單的 `modelGroups`／`selectedModelKey` 保留各原觀察模型，主卡使用 `cohort.headline`／`cohort.selectedModelKey` 的正式母體比較，不混算新版與舊版。缺少舊 metadata 標 `legacy-unknown`，未知成本不補算淨值，也不把原始勝負布林當成有效淨獲利率分母或 CI。已有 final 觀察保留；舊訊號補算另存 `observationRevisions`，標記事後觀察與本次實際模型，不能補成當時正式發布。舊波段 pending 的 `evaluationApplied` 只證明本次補驗套用的模型，不回填原始進場或當時可得時間。

新建立的正式訊號採 `overnight-hypothetical-holding-v1`／`swing-hypothetical-holding-v1`，`returnBasis=cash-holding-return`。每筆固定 **1 股假設部位**，建立時保存原始日期、價格、投入與風險金額；這不是使用者實際成交。股利不再投入，公告現金股利以假設應收價值計入，支付只改分類、不重複加收益。產品成本 `initial-notional-flat-0.471pct-v1` 為原始價款 × 0.471%，分母仍為原始價款；未計個人股利稅與補充保費。100 元買 1 股、配息 5 元、104.5 元退出，零成本持有報酬為 9.5%，原價格比例觀察為 10%；套產品成本後含息模型為 9.029%。

新 API 保留 `resultPct`／隔日 `openReturn` 等價格欄位，含息結果另放波段 `holdingOutcome`、隔日 `holdingOutcomes.open/close`。`cohort` 的含息模型淨欄位使用含息結果，淨獲利率按完整 `netPnl > 0`，與報酬率各有分母；`holdingCoverage` 揭露未知與不支援。新股必須有退出前可處分股數和零碎結算證據；現增參與及投入缺證保持未知，有額外投入時只給絕對損益、不編造多時點報酬率。TWSE 月結果與 [TPEx 歷史除權息計算結果](https://www.tpex.org.tw/zh-tw/announce/market/ex/cal.html) 的覆蓋僅限官方除權息；抓取失敗不等於無事件。

已知舊價格模型 pending 仍依原規則續驗；舊 final／identity 不覆寫、不反推原價。次開另維持原價格模型與退出窗口，不產生次開含息收益。已結案或 final 的含息未知結果依當次證據保存，**本版不會自動補算**；原始部位、退出與缺漏原因可供後續明示修訂模型使用，目前可查閱獨立價格觀察。切回價格讀取不能覆寫新事件證據。

「分母、模型與來源」另列 **0／10／25／50 bps 額外成本壓力**：從完整含息淨報酬再扣假設成本，100 bps＝1 個百分點，不重扣基準 0.471% 或退出價內的跳空。例如基準 1%、額外 25 bps 為 0.75%；這是敏感度投影，不改原始價格或成交模型。基準手續費折數為 6 折（乘 0.6），仍未含最低手續費、個人股利稅及補充保費。

事後 **netR＝完整 `netPnl` ÷ 鎖定的原始風險金額**，風險是（原始進場價−當時有效停損價）×原始股數，分母不加成本；950／500＝1.9R。移停、公司行動與重開報表不改它；缺原始風險、風險非正或缺完整損益則未定義，隔日沖未計畫停損不顯示 R 數值。選股卡淨 RR 與部位預算維持原用途。API 的成熟 `cohort.models[].costRisk` 含成本情境與 R 各自有效筆數／缺值原因；隔日分 `open/close`，波段場景、位階與含分盤敏感度沿用原分層。舊價格、次開及未知模型不補造現金 R，不提供策略期望值或帳戶報酬結論。
成績單逐欄提供 `metricCoverage`：`value`、`validCount`、`totalCount`、`missingCount`、`reason` 與有效日期數 `validDays`；合法 0 保留，空值不當 0 或虧損。開盤缺值不借用收盤筆數或日期計算平均、淨獲利率、最低樣本門檻或日叢集 CI。完整零訊號日算採集成功，不進收益 CI；區間仍受日間相依限制，不能視為精度保證。

波段主比較採 `mature-issued-15-official-sessions-v1`：首次正式訊號日之後已滿 15 個官方交易日的同批訊號，無論快速達標、停損或超時，一起到期才納入。日曆使用有界月份的 TWSE FMTQIK 官方日期；不足時成熟狀態未知；若只能證明至少 15 日，成熟可確定但精確 `ageSessions` 為 null。成熟仍可能有缺 K／公司行動待補，平均只代表有效部分的條件式價格觀察。達標率、淨獲利率與歷史平均淨報酬分開；超時淨正也屬淨獲利，分盤撮合另列。隔日沖主比較為 `complete-issued-next-session-v1`，限完整正式下一交易日觀察。模型展開區可查通過各欄門檻的結果、完整模型身份及缺證據原因；既有最長連虧與最差單日保留在原結案口徑，與成熟主比較分開。這些是摘要投影的母體版本，不改寫保存的發布身份。

兩套主卡保留最近結案／逐日觀察，並在「分母、模型與來源」展開區揭露完整紀錄起點、缺覆蓋、模型及原結案口徑。舊 `totals`／`scenarios` API 欄位相容保留並修正缺值分母，不補造歷史 issued。價格觀察不等於含息報酬；兩者都不代表可成交回測或帳戶收益。

單日隔日驗證與歷史成績單同日優先使用首次正式 capture；無正式發布才顯示標示身份的 legacy 觀察，兩者共用完整觀察 memo。已知不支援的波段 evaluation／entry／return 模型保留原證據，以 `evaluationUnavailable` 與摘要 `unavailableCount` 揭露停等，不借用目前算式結案。隔日逐檔 `sourceEvidence` 分開官方成功、確認空資料及失敗，連同備援狀態判定採集完整性；已確認空資料不等於來源故障。

完整枚舉並保留每個候選終端結果後，已有可評估結果的掃描可正式發布並揭露 degraded／coverage；不要求逐檔來源成功率100%。全部候選僅有來源失敗仍不能發布。TWSE STOCK_DAY 已證明的無資料回應（精確中文 stat、numeric total=0、無 data）可確認空月份；超出查詢範圍或未知錯誤不算空資料，這個形狀不外推至 TPEx。

主 DB 的 `verificationCaptures` 與發布共用 captureId、同次提交，保存真正 preselection 當下的候選順位、原價與來源，以及逐檔終端結果（自 2026-09-12 起以 deflate 壓縮並附 sha256 保存於 `outcomesBlob`，讀取走 `readCaptureOutcomes`）和 issued 清單。完整零訊號、未完成、來源失敗與事後發現缺採集分開記錄；候選池不是畫面切片，也不代表全市場。兩套成績單 API 提供 `captureCoverage`／`population`，主卡以 `cohort` 接正式成熟比較，舊欄位保留。`fullRecordStartDate` 只表示完整格式開始日；覆蓋僅以取得的官方交易日與已有正式紀錄核對，後續缺口仍列出。`not-captured` 保存本次發現時間，不能證明當天伺服器一定沒開；舊 capture 沒有候選證據時維持未知。

兩套成績單另提供 `benchmarks`，在「分母、模型與來源」比較「相對候選池的同期間報酬差」。隔日沖使用凍結的官方收盤到次一官方交易日收盤；波段使用訊號後第 1 個官方交易日開盤到第 15 日收盤，與提前停損／達標及含息持有結果分列。兩邊同採官方還原參考價格，各扣 0.471% 近似成本。候選池含入選股，以原凍結名單在各市場等權計算；每市場完整才配對，缺檔不移出原池。`pairedCount/eligibleCount` 是已發布訊號數，候選檔數及有效日期另列；同股跨場景不代表獨立部位，平均報酬不是帳戶資產曲線。收盤發布不證明可用該收盤成交，次開另揭露晚發布與時間不確定。

`verificationBenchmarks` 保存每版完整模型、原 capture/input 指紋、逐檔來源／時間／公司行動與進度，已完成證據不因來源修訂或快取淘汰重算；舊池不回填。成績單先讀已保存進度：隔日視圖最多回傳截至當日最新 260 份正式採集，波段先限制近 90 個日曆日再取最新 260 份，均跨模型選取但按完整模型分組。`benchmarks.window` 明列截止日、實際日期範圍與回傳／可用筆數；窗口外資料仍保留。背景每輪最多一組採集、四檔、三個月，沿用既有月快取與收盤排程續跑；最多 30 次來源呼叫（含逐檔月 K 的一次重試），來源不足保留原因並於 10 分鐘後可再試，不保證短時間補齊所有歷史。指定期間缺 K、官方日曆覆蓋不足、凍結價無法證明官方收盤或與後來月 K 不一致時保持未知，不順延退出日。這套獨立價格觀察不建立同時段指數開盤、含息候選池或完整成交模擬。

新完成 benchmark 經 `prepareCompletedBenchmark` 保存：可壓縮者保留唯一 evidenceBlob；原 evidence 超過 32 MiB 時保留完整 raw/status=complete，另存 `evidenceCompression={status:'skipped-size',codecVersion:1,rawBytes}`。這是 codec 診斷章，不屬財務 identity。舊 raw 不遷移，也不補造略過原因。`summarizeBenchmarkCompression` 只讀 envelope：計數 pending（含尚未完成的 unavailable）、legacyOrUnclassifiedRaw、packed、skippedSize；rawEvidenceBytes 的 knownBytes／knownCount 僅合計已有長度章的資料，unknownCount 明示其餘未量測紀錄，不把未知當成精確總量。packed 讀 blob.rawBytes 而不解壓；格式分類不是來源或 codec 完整性認證，查原證據仍須通過 reader 驗證。32 MiB 是解壓保護，不是保留上限。

官方日曆 v2 保留每月請求起點、取得時間及原始涵蓋上界；跨月前置月份未完整時保持待補，失敗後的舊快取不以本輪時間補蓋完整章。慢請求跨月底以請求起點判定封月，來源時鐘倒退亦不採信。舊版 memo 仍保存但不作 v2 結果，需足夠新證據才完成；既有 24 小時月快取與來源中斷可能延後恢復。明細另顯示原採集模型 identity，跨模型視圖不混淆選股／評估版本。

排程的 `captureStatus` 優先保留首次正式採集，沒有正式清單才讀當日該策略最後的實際嘗試；內容去重的重試另記 `lastAttemptedAt`／`lastAttemptSequence`，不改原採集與發布時間。共用來源尚未齊全另回 `inputStatus`；其失敗或未完成保存為 `strategy: null`／`stage: "reference"`／`canonical: false`，不表示兩策略已開始掃描。只有真的開始且失敗的策略才記採集失敗；驗證推進、尚未開始或已完成的其他策略不受牽連。

新 issued 母體版本為 `first-canonical-issued-manifest-v1`，逐模型滿足 `issued = noEntry + pending + resolved + unresolved`；鎖死與跳空放棄仍保留訊號，缺 K／卡住是 pending 的原因。波段另有 `next-open-price-observation`／`swing-next-open-price-observation-v1`：沿用原收盤觀察的退出事件與窗口，並非獨立交易模擬。提交開始已晚於次一實際交易日開盤才可判晚發布；可讀確認上界在開盤前才可確認時間來得及，跨開盤或未知時間保持 pending。價格觀察值可另列，不能將時間不明的資料算成可進場樣本。過去未記 noEntry 的紀錄不補建新母體。

漏開程式留下的波段 pending 會分批補判：每輪最多 16 組近期與 4 組歷史標的，舊單每次核對停住月份及下一月份的官方交易日、日 K 與公司行動。無法確認市場或來源時保留原因，歷史重試至少間隔 5 分鐘；缺 K 不跳日，來源失敗不冒充已確認缺口。歷史越多，資料檔與備份也會增長，應保留足夠磁碟空間。舊版已刪除、且沒有備份的紀錄無法恢復，不從後來結果反推訊號。新版本累積證據後，不可直接啟動仍會裁剪歷史的舊版；回復前須完整隔離備份並匯出新證據，驗證恢復後再切換。

---


歷史觀察與成熟日數採 `official-session-interval-v1` 來源完整性檢查。預定交易日仍可由開休市表顯示；歷史推進若需要排除中間交易日，必須有原 TWSE FMTQIK 月份的請求／取得時間與涵蓋區間，不能以日期 min/max 或未驗證個股日期共識當成休市。原先已完整的月份證據即使快取 stale 仍可使用；未完整的 last-good 不因重試而變完整。官方成功價格的精確排定日只在沒有較早官方開市正證據、且已提供的月份章充分時使用。

缺章保留 `calendarEvidencePending`／`calendar-coverage-unknown`，不跳過交易日；近期跨月和舊 pending 會在既有有界批次內補查原月份，同日恢復不被一次收盤節流鎖住。近期與歷史每組最多核對停住月及下一月；隔日觀察最多同樣兩月，超出範圍保持待補。月快取的失敗重試沿用 5 分鐘，成熟摘要沿既有 90 日視窗逐月取證；不足時精確日數未知，至少 15 個真正官方日期僅證明成熟下界。

此修正維持已知價格／含息 v1 的財務評估、進出場、公司行動與成本定義。已知舊 pending 仍可續驗，未知身份保留原限制，既有 final 不重算。實際波段 advance 的 `evaluationApplied` 記錄來源政策版本、原月份證據與 inputFingerprint，`scope=this-advance-only`，不聲稱過去每一步都已通過新檢查。固定期間 benchmark 的獨立 calendarVersion v2 保持原樣。

隔日 evidence adapter 的 `officialDays` 保留已讀官方月 K 裡、訊號日之後的合格正價格日期集，與精確觀察日 bar 分開；較早日期即使不在稀疏市場日曆內，也不能被排定日成功 bar 蓋掉。direct quote 驗原 TWSE/TPEx OpenAPI 或官方月 K 來源及實際使用的正 OHLC／price，保留原 source；Yahoo 或未具名 fallback 不能重貼成官方 final。MIS 使用獨立、同日且正值的官方 intraday 欄位，仍明示盤中。缺足夠官方來源時待補，恢復後才完成。

2026-09-12 起三個口徑補充：（1）波段驗證的觸價停損改記<strong>停損價下方一檔</strong>（台股升降單位）出場，但不低於當日最低價，並在驗證單記 `exitSlippageTicks`（0 或 1）；跳空開低與跌停順延仍用實際開盤價，不另扣。已結案紀錄不重算。（2）成績單的大盤位階分層改看 `distMa60Pct`：|收盤／MA60 − 1| ≤ 1% 歸「季線附近」（`byRegime.nearMa60`），舊紀錄只有布林就照布林、缺值仍 unknown。（3）隔日總覽 `totals.indexBenchmark` 並列同期加權指數：每個完成觀察日「訊號日收盤→觀察日收盤」的指數報酬、日等權平均，指數缺值的日子少算並回報 `missingDays`；與「平均隔日收」看同一段期間，兩邊都是價格觀察，不是可成交回測。

2026-09-13 第二次口徑修正：（1）隔日沖新增<strong>次日開盤進場</strong>口徑並成為成績單第一層主數字——訊號要等 13:30 整批收盤才算得出來，訊號日收盤買不到，「開盤／收盤觀察」只是價格觀察；每列 `openEntryReturn`＝觀察日收盤÷開盤−1（舊落盤列由 openReturn／currentReturn 推回，`openEntryReturnOf`），淨口徑同扣 0.471%；觀察日一價漲停鎖死記 `openEntrySkipped` 不進分母；訊號日一價鎖死的 pick 帶 `fillRisk`。（2）長期逐日紀錄以「檔」去重（`dedupeRowsByCode`，同單日摘要一致），`duplicatedSignals` 記重複數。（3）totals 新增 `winAtOpenEntry`／`avgOpenEntryReturnNet`（淨期望值）與 `openEntry`（獲利因子、最長連虧、最差單日，皆以觀察日彙總）。（4）`indexBenchmark.strategyAvgReturn`：與同期大盤同一批日子、同段期間、同樣日等權且不扣成本的訊號平均隔日收，並列才是同口徑。（5）波段目標是限價單：最高價要「穿越」目標（high > target）才算成交，剛好等於只是排隊；啟動移停只是提醒價，驗證不模擬。
