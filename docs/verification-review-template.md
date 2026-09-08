# 觀察品質檢討

這份格式用來判斷現有前向驗證資料能不能回答研究問題，以及個人計畫能不能完整檢討。它不是策略績效報告、交易門檻、投資建議或自動排程。隔日沖與波段必須分開填；個人成交也不得混入模型觀察。

空值一律寫「未知」並保留來源原因。不能由其他欄位推回 numerator、denominator、交易日、費稅或完整帳戶報酬。固定期間候選池比較不得直接減掉提前停損／達標的損益；情境損失不得稱為最大可能虧損；有效成交關聯的現金差額也不得稱為計畫報酬。

下方五例全部是固定合成資料。可用以下命令重新取得既有摘要的來源輸出；輸出中的 `id` 對應每例標示的來源路徑。

```powershell
node tests/helpers/verification-review-fixtures.mjs
```

## 空白模板

### 檢討識別

| 欄位 | 人工填寫 |
| --- | --- |
| 檢討名稱／日期 | 〔必填〕 |
| 策略 | 〔`overnight` 或 `swing`；一份只填一種〕 |
| 資料截止 | 〔必填；含時區或明示僅日期〕 |
| 結論 | 〔資料可用／繼續累積／修資料；不寫交易門檻〕 |

### 身份與窗口

| 欄位 | 人工填寫 |
| --- | --- |
| `modelKey` | 〔完整值，不省略七軸〕 |
| `selectedModelKey` | 〔完整值；若本次檢視的模型不是 headline，兩者都保留〕 |
| 成熟母體窗口 | 〔`cohort.policy`、起訖、實際官方交易日證據〕 |
| 固定期間比較窗口 | 〔照抄 `benchmarks.window`；保留 policy、asOf、requestedFromDate、fromDate、throughDate、limit、allModels〕 |
| 實際觀察區間 | 〔只能寫來源已涵蓋的日期〕 |
| 固定期間 `benchmarks` 頁面查詢限制 | 〔隔日最新 260 份；波段近 90 曆日後最新 260 份，或來源實值；不得套到 cohort／headline 的獨立窗口〕 |
| 超出窗口 | 〔未知／未涵蓋；不得聲稱已檢查〕 |

### 採集

| 欄位 | 人工填寫 |
| --- | --- |
| 官方預期日期來源 | 〔fresh／stale／unavailable；缺月曆即寫未知〕 |
| `fullRecordStartDate` | 〔日期或未知〕 |
| 預期／完整 | 〔`expectedCount`／`completeCount`；保留各自來源〕 |
| 完整零訊號 | 〔份數；它是成功採集，但沒有收益分母〕 |
| 未採集 | 〔份數與發現時間；沒有紀錄不能反推當日狀態〕 |
| 研究／provisional | 〔另列，不併正式清單〕 |
| `coverageRate` | 〔值或未知；缺完整官方日期全集時不得解讀為全窗口完整〕 |

### 母體與估值

| 欄位 | 人工填寫 |
| --- | --- |
| issued 等式 | 〔`issued = noEntry + pending + resolved + unresolved`，逐欄填值〕 |
| 成熟／未成熟／不明 | 〔逐欄填值；快速結案不提前成熟〕 |
| 毛報酬 | 〔value、validCount、totalCount、missingCount、validDays、reason〕 |
| 淨報酬 | 〔同上；成本未知即保持未知〕 |
| 其他指標 | 〔每個欄位各自的有效筆數與日期，不借其他欄分母〕 |

### 同期間候選池比較

| 欄位 | 人工填寫 |
| --- | --- |
| `countGrain`／pool policy | 〔通常為 `issued-signal`／`complete-exchange-pool-only`〕 |
| `eligibleCount`／`pairedCount` | 〔逐欄填值；另列 eligibleDays／pairedDays〕 |
| 策略／候選池平均 | 〔同一固定期間的值或未知〕 |
| 平均差 | 〔同一固定期間的差或未知〕 |
| 未配對原因 | 〔來源原值〕 |
| 禁止混算確認 | 〔已確認沒有拿提前退出損益直接減固定期間基準〕 |

### 風險與限制

| 欄位 | 人工填寫 |
| --- | --- |
| 成本敏感度 | 〔0／10／25／50 bps 各自 value 與有效筆數；沒有就寫未知〕 |
| 公司行動／應收 | 〔完整、缺漏或未知及原因〕 |
| 集中度 | 〔有來源才填；否則未知〕 |
| 原始風險／停損 | 〔有鎖定來源才填；未定停損保持未知〕 |
| 最大虧損聲明 | 〔明示目前數字不是最大可能虧損〕 |

### 個人流程

| 欄位 | 人工填寫 |
| --- | --- |
| 未進場原因 | 〔review decision／reason；沒有就寫未記錄〕 |
| 計畫與成交核對 | 〔valid／source-changed／source-deleted 數量、買賣分配股數〕 |
| 費稅 | 〔明確金額與來源；缺任一項即保持現金差額未知〕 |
| 現金差額 | 〔值或未知；只代表目前有效 links〕 |
| `planReturn`／`netR` | 〔照來源；不得用現金差額、結案狀態或帳戶均價補造〕 |
| 事後修改／來源失效 | 〔metadata revision、失效原因〕 |
| 完整帳戶報酬 | 〔目前來源不足時固定寫未知〕 |

### 假設登記與下一步

| 欄位 | 人工填寫 |
| --- | --- |
| 新假設 | 〔規則、觀察窗口、失效條件；沒有就寫無〕 |
| 研究重算身份 | 〔獨立 model key／capture；不得回填原正式名單〕 |
| 下一管理節點 | 〔例如再新增 20 個官方交易日；只作檢討節奏〕 |
| 是否策略門檻 | 固定填「否」 |
| 資料不足時處理 | 〔繼續累積或修資料，不選歷史最好看的結果當確認〕 |

## 合成範例一：完整合成觀察

來源 id：`complete`。

這裡的「完整」只表示本例指定的一日正式採集、15 日成熟母體與固定期間配對都有來源；集中度及完整個人報酬仍是未知。

策略為 `swing`，資料截止 2026-08-24；實際成熟觀察區間為 2026-08-03 至 2026-08-24。模型與 headline 相同：

```text
{"cohortPolicyVersion":"mature-issued-15-official-sessions-v1","costModelVersion":"initial-notional-flat-0.471pct-v1","entryModel":"signal-close-observation","evaluationVersion":"swing-hypothetical-holding-v1","returnBasis":"cash-holding-return","selectionVersion":"swing-v22-net-rr-rank-tpex-exright","snapshotSchemaVersion":2}
```

- 採集：`captureCoverage` 為預期 1 份、完整 1 份、100%，完整格式起點 2026-08-03；來源路徑為 `captureCoverage.expectedCount`、`completeCount`、`coverageRate`、`fullRecordStartDate`。本例官方日期來源標 `fresh`。這個 100% 只描述合成輸入的一個預期日。
- 母體：issued 2 = no-entry 0 + pending 0 + resolved 2 + unresolved 0；成熟 2、未成熟 0、不明 0。毛報酬平均 2%，淨報酬平均 1.529%，淨值有效 2／總數 2／缺值 0；來源為 `cohort.*`。
- 比較：固定期間為 2026-08-04 至 2026-08-24，eligible 2、paired 2、eligibleDays 1、pairedDays 1，策略平均 3%、候選池平均 2%、平均差 1 個百分點；來源為 `benchmark.*`。`countGrain=issued-signal`、`includesSelected=true`、`poolPolicy=complete-exchange-pool-only`，沒有拿提前退出結果相減。
- 比較窗口：`last-90-calendar-days-latest-260-formal-captures-v1`，asOf 2026-08-24、requestedFromDate 2026-05-26、實際 fromDate／throughDate 都是 2026-08-03、limit 260、allModels=true；來源為 `benchmarkWindow.*`。
- 風險：額外成本 0／10／25／50 bps 的淨報酬分別為 1.529%／1.429%／1.279%／1.029%，每格都是有效 2／總數 2；模型 netR 平均 0.3058、有效 2／總數 2。來源為 `cohort.costRisk`。集中度沒有來源，標未知；這些情境也不是最大可能虧損。
- 個人流程：2 筆有效 links，買／賣各 1,000 股；買支出 100,020 元、賣收入 109,815 元、現金差額 9,795 元、原始價差風險估計 5,000 元。`planReturn` 與 `netR` 都是未知，原因含 `corporate-action-and-receivable-coverage-unknown`；來源為 `personal.*`。結論只能是「計畫與成交可核對，完整帳戶報酬仍不可得」。
- 新假設：無。下一管理節點可在新增 20 個官方交易日後再檢討；來源為 `reviewCadenceSessions=20` 與 `reviewCadenceIsThreshold=false`，不是策略有效性門檻。

## 合成範例二：完整零訊號

來源 id：`complete-zero`。

策略為 `overnight`，資料截止與實際採集日都是 2026-08-03。完整 model key／selectedModelKey：

```text
{"cohortPolicyVersion":"complete-issued-next-session-v1","costModelVersion":"initial-notional-flat-0.471pct-v1","entryModel":"signal-close-observation","evaluationVersion":"overnight-hypothetical-holding-v1","returnBasis":"cash-holding-return","selectionVersion":"overnight-v4-tpex-exright","snapshotSchemaVersion":2}
```

- 採集：預期 1 份、完整 1 份、100%，狀態是 `complete-zero`，完整格式起點 2026-08-03；來源為 `captureCoverage.*`。它是成功採集，不是未採集。
- 母體：issued／no-entry／pending／resolved／unresolved 都是 0；成熟、未成熟、不明也都是 0。淨報酬未知，分母 0；來源為 `cohort.*`。
- 比較：eligible 0、paired 0、eligibleDays 0、pairedDays 0，策略平均、候選池平均與平均差都未知；來源為 `benchmark.*`。不得把未知顯示成 0% 報酬。
- 比較窗口：`latest-260-formal-captures-v1`，asOf 2026-08-03，實際 fromDate／throughDate 都是 2026-08-03，limit 260、allModels=true；來源為 `benchmarkWindow.*`。
- 風險：0／10／25／50 bps 各情境都是有效 0／總數 0，數值未知；公司行動、集中度、停損與最大虧損都沒有母體可估，標未知。
- 個人流程：本例沒有合成個人計畫，未進場原因也未記錄；不能因零訊號替使用者建立成交。
- 結論：採集可用，但沒有收益分母；繼續累積。下一個 20 日節點只作管理節奏，不是交易門檻。

## 合成範例三：缺月曆

來源 id：`calendar-unknown`。

策略為 `swing`，資料截止 2026-08-24。完整 model key／selectedModelKey 與範例一相同：

```text
{"cohortPolicyVersion":"mature-issued-15-official-sessions-v1","costModelVersion":"initial-notional-flat-0.471pct-v1","entryModel":"signal-close-observation","evaluationVersion":"swing-hypothetical-holding-v1","returnBasis":"cash-holding-return","selectionVersion":"swing-v22-net-rr-rank-tpex-exright","snapshotSchemaVersion":2}
```

- 採集：現有 union 中預期 1 份、完整 1 份、coverageRate 100%，完整格式起點 2026-08-03；但 `expectedDateSource=unavailable`。來源為 `captureCoverage.*`。因此不能聲稱 2026-08-03 至 2026-08-24 的官方日期全集完整。
- 母體：issued 1 = resolved 1，其餘狀態 0；成熟 0、未成熟 0、不明 1，`calendarReason=official-calendar-coverage-unknown`。毛／淨報酬都未知；來源為 `cohort.*`。已結案不等於已證成熟。
- 比較：eligible 1、paired 0、eligibleDays 1、pairedDays 0，狀態 pending，原因 `official-calendar-source-unavailable`；所有平均與差值未知。來源為 `benchmark.*`。
- 比較窗口仍是 benchmark 自己的近 90 曆日／最多 260 份窗口（asOf 2026-08-24、requestedFromDate 2026-05-26、實際 capture 只有 2026-08-03）；它不能替成熟 cohort 補月曆。
- 風險、個人流程與集中度均沒有足夠來源，標未知；不得用情境值補最大虧損。
- 結論：先修復／補齊官方月曆證據，再判成熟與比較；不是把 100% coverageRate 當完整窗口。

## 合成範例四：缺成本

來源 id：`cost-unknown`。

策略為 `swing`，資料截止 2026-08-24。本次檢視的 model key 是：

```text
{"cohortPolicyVersion":"mature-issued-15-official-sessions-v1","costModelVersion":"legacy-unknown","entryModel":"signal-close-observation","evaluationVersion":"swing-price-observation-v1","returnBasis":"adjusted-reference-price","selectionVersion":"swing-v22-net-rr-rank-tpex-exright","snapshotSchemaVersion":2}
```

headline 的 selectedModelKey 仍是目前含息模型，不能混算：

```text
{"cohortPolicyVersion":"mature-issued-15-official-sessions-v1","costModelVersion":"initial-notional-flat-0.471pct-v1","entryModel":"signal-close-observation","evaluationVersion":"swing-hypothetical-holding-v1","returnBasis":"cash-holding-return","selectionVersion":"swing-v22-net-rr-rank-tpex-exright","snapshotSchemaVersion":2}
```

- 採集：預期 1、完整 1、coverageRate 100%，完整格式起點 2026-08-03；來源為 `captureCoverage.*`。
- 母體：issued 1 = resolved 1，成熟 1；毛報酬 5%，有效 1。淨報酬未知，有效 0／總數 1／缺值 1、reason=`no-valid-values`；來源為 `cohort.*`。不能套今天的成本回填 legacy。
- 比較：固定期間為 2026-08-04 至 2026-08-24，eligible 1、paired 1、eligibleDays 1、pairedDays 1，策略與候選池都是 2%，平均差 0 個百分點；來源為 `benchmark.*`。這是 benchmark 自己的 `flat-round-trip-0.471pct-v1` 固定期間模型，不能拿來補 cohort 的未知成本。
- 比較窗口：近 90 曆日後最新 260 份，asOf 2026-08-24、requestedFromDate 2026-05-26，實際 capture 只有 2026-08-03；來源為 `benchmarkWindow.*`。
- 風險：0／10／25／50 bps 情境都未知，各為有效 0／總數 1，缺值原因 `cash-model-not-established`；來源為 `cohort.costRisk`。集中度未知，情境未知也不能說是 0 風險。
- 個人流程：2 筆成交 links 有效，買／賣各 1,000 股，但 fee／tax 缺失；`buyCash`、`sellCash`、`cashDifference`、`planReturn`、`netR` 全部未知，reasons 含 `fee-tax-unknown` 與公司行動／應收未知。來源為 `personal.*`。
- 結論：保留毛價格觀察，先補成本與個人實際費稅；不產生淨績效結論。

## 合成範例五：未成熟

來源 id：`immature`。

策略為 `swing`，資料截止 2026-08-10。完整 model key／selectedModelKey：

```text
{"cohortPolicyVersion":"mature-issued-15-official-sessions-v1","costModelVersion":"initial-notional-flat-0.471pct-v1","entryModel":"signal-close-observation","evaluationVersion":"swing-hypothetical-holding-v1","returnBasis":"cash-holding-return","selectionVersion":"swing-v22-net-rr-rank-tpex-exright","snapshotSchemaVersion":2}
```

- 採集：預期 1、完整 1、coverageRate 100%，完整格式起點 2026-08-03；來源為 `captureCoverage.*`。採集完整不代表觀察窗成熟。
- 母體：issued 1 = resolved 1，成熟 0、未成熟 1、不明 0。已觀察 5 個訊號後官方 session，毛／淨報酬仍不進成熟分母；來源為 `cohort.*` 與 `observedSessions=5`。
- 比較：eligible 1、paired 0、eligibleDays 1、pairedDays 0，狀態 pending，原因 `official-session-horizon-unavailable`；所有平均與差值未知。來源為 `benchmark.*`。
- 比較窗口：asOf 2026-08-10、requestedFromDate 2026-05-12、實際 capture 2026-08-03、limit 260、allModels=true；來源為 `benchmarkWindow.*`。
- 風險：0／10／25／50 bps 與 netR 都沒有成熟有效筆數；公司行動、集中度與最大虧損結論均未知。
- 個人流程：沒有合成個人計畫，未進場原因未記錄；模型快速結案也不能代表個人已成交。
- 結論：繼續累積到既有 15 官方 session 成熟定義可判定。另可在新增 20 個官方交易日時做一次管理檢討；`20` 不是策略有效性門檻，也不把 15 日模型窗口改成 20 日。

這五例只驗資料可用性與語意界線。真實資料檢討必須另行確認最小摘要範圍，私人交易明細不得提交公開 repository；新研究假設必須使用獨立身份，不能回填原正式名單或挑歷史最好看的結果當確認。
