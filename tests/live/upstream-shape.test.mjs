// 【opt-in】上游 API 形狀檢查：真打 TWSE/TPEx，驗證 fixtures 假造的欄位名在真實回應中存在。
// 目的：偵測「fixture 漂移」（官方改欄位名時，離線測試不會發現）。
// 執行：npm run test:live（不在 npm test 內）。網路失敗／被限流 → skip 不 fail。
import test from "node:test";
import assert from "node:assert/strict";

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  accept: "application/json",
};

const SOURCES = [
  { name: "TWSE 處置", url: "https://openapi.twse.com.tw/v1/announcement/punish", codeField: "Code", fields: ["Code", "DispositionPeriod", "Detail", "ReasonsOfDisposition"] },
  { name: "TWSE 注意", url: "https://openapi.twse.com.tw/v1/announcement/notice", codeField: "Code", fields: ["Code", "NumberOfAnnouncement", "TradingInfoForAttention"] },
  { name: "TWSE 鉅額", url: "https://openapi.twse.com.tw/v1/announcement/BFIAUU", codeField: "Code", fields: ["Code", "Name", "TradeValue"] },
  { name: "TWSE 全額交割", url: "https://openapi.twse.com.tw/v1/exchangeReport/TWT85U", codeField: "Code", fields: ["Code", "Name", "PeriodicCallAuctionTrading"] },
  { name: "TWSE 整批收盤", url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", codeField: "Code", fields: ["Code", "Name", "ClosingPrice", "TradeVolume"] },
  { name: "TWSE 除權息", url: "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL", codeField: "Code", fields: ["Date", "Code", "CashDividend", "StockDividendRatio", "SubscriptionRatio", "SubscriptionPricePerShare"], ratioFields: ["StockDividendRatio", "SubscriptionRatio"] },
  { name: "TPEx 處置", url: "https://www.tpex.org.tw/openapi/v1/tpex_disposal_information", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "DispositionPeriod", "DisposalCondition"] },
  { name: "TPEx 注意", url: "https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "TradingInformation"] },
  { name: "TPEx 鉅額", url: "https://www.tpex.org.tw/openapi/v1/tpex_daily_qutoes_block", codeField: "Code", fields: ["Code", "Name", "TradeValue", "Date"] },
  { name: "TPEx 變更交易", url: "https://www.tpex.org.tw/openapi/v1/tpex_cmode", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "AlteredTrading", "Date"] },
  { name: "TPEx 整批收盤", url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "CompanyName", "Close", "TradingShares"] },
  { name: "TPEx 除權息", url: "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost", codeField: "SecuritiesCompanyCode", fields: ["ExRrightsExDividendDate", "SecuritiesCompanyCode", "CashDividend", "StockDividendRatio", "SubscriptionRatioToNewSharesIssued", "SubscriptionPricePerShare"], ratioFields: ["StockDividendRatio", "SubscriptionRatioToNewSharesIssued"] },
  // 停牌/下市（getRiskSets 的 halted/delisted 來源）
  { name: "TWSE 暫停交易", url: "https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU", codeField: "Code", fields: ["Code", "TradingHaltDate", "TradingResumptionDate"] },
  { name: "TPEx 暫停交易", url: "https://www.tpex.org.tw/openapi/v1/tpex_spendi_history", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "DateOfSuspendedTrading", "DateOfResumedTrading"] },
  { name: "TWSE 終止上市", url: "https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml", codeField: "Code", fields: ["Code", "DelistingDate", "Company"] },
];

for (const source of SOURCES) {
  test(`${source.name}：真實回應含 fixtures 依賴的欄位`, async (t) => {
    let res;
    try {
      res = await fetch(source.url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      t.skip(`網路失敗：${error.message}`);
      return;
    }
    if (!res.ok) {
      t.skip(`HTTP ${res.status}（可能被限流）`);
      return;
    }
    const rows = await res.json();
    assert.ok(Array.isArray(rows), "回應應為陣列");
    const usable = rows.filter((r) => String(r?.[source.codeField] || "").trim());
    if (!usable.length) {
      t.skip("今日無資料列（假日或空名單）");
      return;
    }
    const first = usable[0];
    for (const field of source.fields) {
      assert.ok(field in first, `${source.name} 缺欄位 ${field}；實際欄位：${Object.keys(first).join(", ")}`);
    }
    // D-41／D-53：欄位存在還不夠，**數量級也要釘住**。
    // 除權息報表的欄位名叫 Ratio，但同一份報表的網頁版是以「每仟股無償配股（股）」呈現，
    // 兩者差 1000 倍。上游若改單位，referencePrice 的除數會從 1.1 變成 101，整段 K 線塌陷，
    // 而且 formulaComplete 仍是 true、source 仍蓋著 official 章——只有這條斷言會喊。
    //
    // **2026-08-21 修正判準（D-53）**：原本逐筆斷言 `value < 1`，但那是把 2026-07-27
    // 的樣本上限（29 筆最大 0.5）當成了領域性質。真實市場會出現超過 100% 的無償配股，
    // 這條斷言因此在 2026-08-21 對三筆合法事件誤報（TWSE 6669 1.98、TPEx 5314 3.16、
    // TPEx 8084 現增 1.51），其中 5314 已用官方參考價反推驗證過比率是對的。
    //
    // 要偵測的「單位改版」本來就是**整份分佈一起位移**，不是單筆離群值：
    // 換成每仟股股數後每個值都會乘約 1000，中位數必然遠大於 1。中位數對離群值免疫，
    // 正是這裡要的判準；單筆的絕對上限則放在 1000%（＝伺服器端的
    // DIVIDEND_RATIO_MAX_PLAUSIBLE，兩邊要一起改）。
    if (source.ratioFields) {
      for (const field of source.ratioFields) {
        const values = usable
          .map((row) => Number(String(row?.[field] ?? "").replace(/,/g, "")))
          .filter((value) => Number.isFinite(value) && value > 0)
          .sort((a, b) => a - b);
        for (const value of values) {
          assert.ok(
            value < 1000,
            `${source.name} 的 ${field} 出現 ${value}——單筆超過 100000%，不可能是比率`,
          );
        }
        // 樣本太少時中位數沒有意義（一筆大額配股就會讓它超過 1）。
        if (values.length >= 8) {
          const middle = Math.floor(values.length / 2);
          const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
          assert.ok(
            median < 1,
            `${source.name} 的 ${field} 中位數是 ${median}——整份分佈都 ≥1，上游極可能改成每仟股股數了`,
          );
        }
      }
    }
  });
}

const TRADING_CALENDAR_SOURCES = [
  {
    name: "TWSE 實際交易日",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK",
    fields: ["Date"],
  },
  {
    name: "TWSE 開休市表",
    url: "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule",
    fields: ["Date", "Name", "Description"],
  },
];

for (const source of TRADING_CALENDAR_SOURCES) {
  test(`${source.name}：真實回應含隔日驗證依賴的欄位`, async (t) => {
    let res;
    try {
      res = await fetch(source.url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      t.skip(`網路失敗：${error.message}`);
      return;
    }
    if (!res.ok) {
      t.skip(`HTTP ${res.status}（可能被限流）`);
      return;
    }
    const rows = await res.json();
    assert.ok(Array.isArray(rows), "回應應為陣列");
    const first = rows.find((row) => /^\d{7,8}$/.test(String(row?.Date || "").trim()));
    if (!first) {
      t.skip("官方目前沒有可辨識的交易日期資料列");
      return;
    }
    for (const field of source.fields) {
      assert.ok(field in first, `${source.name} 缺欄位 ${field}；實際欄位：${Object.keys(first).join(", ")}`);
    }
  });
}

test("TWSE ETF 官方主檔：真實回應維持 t187ap47_L 契約", async (t) => {
  let res;
  try {
    res = await fetch("https://openapi.twse.com.tw/v1/opendata/t187ap47_L", {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    t.skip(`網路失敗：${error.message}`);
    return;
  }
  if (!res.ok) {
    t.skip(`HTTP ${res.status}（可能被限流）`);
    return;
  }
  const rows = await res.json();
  assert.ok(Array.isArray(rows) && rows.length >= 100, "ETF 主檔應是非空陣列且維持合理規模");
  const first = rows[0];
  for (const field of ["出表日期", "基金代號", "基金簡稱", "基金類型", "基金中文名稱", "成立日期", "上市日期"]) {
    assert.equal(typeof first?.[field], "string", `TWSE ETF 主檔缺少字串欄位 ${field}`);
  }
});

for (const category of ["domestic", "foreign", "bond", "futures", "leveraged", "active", "multi"]) {
  test(`TPEx ETF ${category}：真實 POST 回應維持表格契約`, async (t) => {
    const body = new URLSearchParams({ type: category });
    if (category === "bond") body.set("bondType", "0");
    body.set("response", "json");
    let res;
    try {
      res = await fetch("https://www.tpex.org.tw/www/zh-tw/ETF/list", {
        method: "POST",
        headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: body.toString(),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      t.skip(`網路失敗：${error.message}`);
      return;
    }
    if (!res.ok) {
      t.skip(`HTTP ${res.status}（可能被限流）`);
      return;
    }
    const payload = await res.json();
    assert.match(String(payload?.date || ""), /^\d{8}$/, "TPEx ETF 回應需要 YYYYMMDD 資料日");
    const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
    assert.deepEqual(table?.fields?.slice(0, 3), ["證券代號", "ETF簡稱", "上櫃日期"]);
    assert.ok(Array.isArray(table?.data), "TPEx ETF table.data 應為陣列，空分類也必須保留陣列");
    assert.equal(Number(table?.totalCount), table.data.length, "totalCount 必須等於 data 長度");
  });
}

// ---- 除權除息計算結果表（TWT49U）：D-46 接上的新來源 ----
// 這是還原權息的第一順位，欄位順序改一格就會讓所有因子算錯，所以連位置一起釘。
test("TWSE 除權除息計算結果表：欄位順序與量級", async (t) => {
  let res;
  try {
    res = await fetch("https://www.twse.com.tw/rwd/zh/exRight/TWT49U?startDate=20260601&endDate=20260630&response=json", {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    t.skip(`網路失敗：${error.message}`);
    return;
  }
  if (!res.ok) {
    t.skip(`HTTP ${res.status}（可能被限流）`);
    return;
  }
  const payload = await res.json();
  if (!Array.isArray(payload?.data) || !payload.data.length) {
    t.skip("該區間沒有除權息資料");
    return;
  }
  assert.deepEqual(
    payload.fields?.slice(0, 7),
    ["資料日期", "股票代號", "股票名稱", "除權息前收盤價", "除權息參考價", "權值+息值", "權/息"],
    "欄位順序是 corporateActionResultRatio 的索引依據，改了就整組算錯",
  );
  const num = (value) => Number(String(value).replace(/,/g, ""));
  for (const row of payload.data.slice(0, 30)) {
    const preClose = num(row[3]);
    const reference = num(row[4]);
    assert.ok(Number.isFinite(preClose) && preClose > 0, `除權息前收盤價應為正數：${row[3]}`);
    assert.ok(Number.isFinite(reference) && reference > 0, `除權息參考價應為正數：${row[4]}`);
    const ratio = reference / preClose;
    // 還原因子必須落在合理區間。>1 代表參考價高於前收（除權息不可能），
    // 過小則代表欄位錯位或單位改變（例如把「權值+息值」讀成參考價）。
    assert.ok(ratio > 0.3 && ratio <= 1, `${row[1]} ${row[0]} 的還原因子 ${ratio} 超出合理區間`);
  }
});

// ---- Yahoo 備援序列的分割事件（D-48）----
// Yahoo 的 indicators.quote 已自行把配股當分割還原，我們要靠它回報的倍數換算座標系。
// 這條端點不回 events 或改了 splits 結構，換算就會失效並讓有配股的股票被判未定案。
test("Yahoo chart：events.splits 結構與 numerator/denominator", async (t) => {
  let res;
  try {
    res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?range=1y&interval=1d&events=div%7Csplit", {
      headers: { "user-agent": HEADERS["user-agent"] },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    t.skip(`網路失敗：${error.message}`);
    return;
  }
  if (!res.ok) {
    t.skip(`HTTP ${res.status}（可能被限流）`);
    return;
  }
  const result = (await res.json())?.chart?.result?.[0];
  assert.ok(result, "Yahoo chart 應回 result[0]");
  assert.ok(Array.isArray(result.timestamp) && result.timestamp.length, "timestamp 應為非空陣列");
  assert.ok(result.indicators?.quote?.[0]?.close, "indicators.quote[0].close 是本專案取用的原始收盤序列");
  // 台積電一年內必有配息 → events 區塊一定要回，否則 parseYahooSplitFactors 只能回 null。
  assert.ok(result.events, "帶 events=div|split 時必須回 events 區塊");
  for (const split of Object.values(result.events.splits || {})) {
    assert.ok(Number.isFinite(Number(split?.date)), "split.date 應為時間戳");
    assert.ok(Number(split?.numerator) > 0, "split.numerator 應為正數");
    assert.ok(Number(split?.denominator) > 0, "split.denominator 應為正數");
  }
});

// ===== 2026-08-23 補上的涵蓋缺口 =====
// 這支原本只檢查「看板類」的官方 OpenAPI（處置／注意／除權息／交易日曆）、TWT49U 與 Yahoo。
// 盤點之後發現一個明顯的洞：**主畫面每天在看的即時報價（MIS）完全沒有被檢查**——
// 它改欄位或改回應結構的話，目前只能等使用者發現價格不對。
// 同批補上台指期、逐檔月歷史、三大法人與融資券，讓每日排程真的涵蓋主要資料路徑。
//
// 這幾條全部只驗「形狀」不驗「值」：盤中／盤後／假日的內容本來就不同，
// 但欄位名與結構任何時候都必須成立。

async function fetchOrSkip(t, url, init = {}) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000), ...init });
  } catch (error) {
    t.skip(`網路失敗：${error.message}`);
    return null;
  }
  if (!res.ok) {
    t.skip(`HTTP ${res.status}（可能被限流）`);
    return null;
  }
  return res.json();
}

test("MIS 即時報價：msgArray 與三層價格備援依賴的欄位", async (t) => {
  // ex_ch 同時要上市個股、上櫃個股與加權指數——三種列的欄位集合不一樣，
  // 只測一種會漏掉另外兩種的改版。
  const payload = await fetchOrSkip(
    t,
    `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|otc_5347.tw|tse_t00.tw&json=1&delay=0&_=${Date.now()}`,
    { headers: { ...HEADERS, referer: "https://mis.twse.com.tw/stock/index.jsp" } },
  );
  if (!payload) return;

  assert.equal(String(payload.rtcode), "0000", `rtcode 非 0000：${JSON.stringify(payload).slice(0, 200)}`);
  const rows = Array.isArray(payload.msgArray) ? payload.msgArray : [];
  assert.ok(rows.length >= 3, `三個 ex_ch 應各回一列，實際 ${rows.length}`);

  const byCode = new Map(rows.map((row) => [String(row.c), row]));
  for (const code of ["2330", "5347", "t00"]) {
    assert.ok(byCode.has(code), `msgArray 少了 ${code}`);
  }

  // 個股：三層價格備援（z → pz → oz）與昨收 y 是 normalizeMisRow 的全部依賴。
  // 值可以是 "-"（無成交哨兵，這正是三層備援存在的理由），但**欄位必須在**。
  for (const code of ["2330", "5347"]) {
    const row = byCode.get(code);
    for (const field of ["c", "n", "z", "pz", "oz", "y", "tv", "v", "d", "t"]) {
      assert.ok(field in row, `${code} 缺欄位 ${field}；實際欄位：${Object.keys(row).join(",")}`);
    }
    assert.match(String(row.d), /^\d{8}$/, `${code} 的資料日期 d 應為 YYYYMMDD，實際 ${row.d}`);
    // 昨收是 priceStale 顯示與漲跌計算的基準，不可能是哨兵。
    assert.ok(Number(row.y) > 0, `${code} 的昨收 y 應為正數，實際 ${row.y}`);
  }

  // 指數列沒有 pz/oz/tv，只有 z 與 y——別把個股的欄位期待套到它身上。
  const index = byCode.get("t00");
  for (const field of ["c", "n", "z", "y", "d"]) {
    assert.ok(field in index, `加權指數缺欄位 ${field}；實際欄位：${Object.keys(index).join(",")}`);
  }
  assert.ok(Number(index.y) > 0, "加權指數昨收應為正數");
});

test("期交所 MIS：TXF 月份契約與 CLastPrice", async (t) => {
  const payload = await fetchOrSkip(t, "https://mis.taifex.com.tw/futures/api/getQuoteList", {
    method: "POST",
    headers: { ...HEADERS, "content-type": "application/json", referer: "https://mis.taifex.com.tw/futures/" },
    body: JSON.stringify({
      MarketType: "0", SymbolType: "F", KindID: "1", CID: "",
      ExpireMonth: "", RowSize: "全部", PageNo: "", SortColumn: "", AscDesc: "A",
    }),
  });
  if (!payload) return;

  const list = payload?.RtData?.QuoteList;
  assert.ok(Array.isArray(list) && list.length, "RtData.QuoteList 應為非空陣列");
  // 產品碼格式是 getTaifexQuote 的過濾條件（排除現貨列與價差單）；格式一改就整批篩空。
  const monthly = list.filter((row) => /^TXF[A-L]\d-(F|M)$/.test(String(row.SymbolID || "")));
  assert.ok(monthly.length >= 1, `找不到任何 TXF 月份契約；SymbolID 範例：${list.slice(0, 3).map((r) => r.SymbolID).join(", ")}`);
  for (const field of ["SymbolID", "CLastPrice", "CRefPrice"]) {
    assert.ok(field in monthly[0], `TXF 契約缺欄位 ${field}；實際欄位：${Object.keys(monthly[0]).join(",")}`);
  }
});

test("TWSE 逐檔月歷史 STOCK_DAY：欄位順序與 ROC 日期", async (t) => {
  const now = new Date();
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}01`;
  const payload = await fetchOrSkip(t, `https://www.twse.com.tw/exchangeReport/STOCK_DAY?date=${month}&stockNo=2330&response=json`);
  if (!payload) return;

  assert.equal(payload.stat, "OK", `stat 非 OK：${payload.stat}`);
  const rows = Array.isArray(payload.data) ? payload.data : [];
  assert.ok(rows.length, "當月應至少有一根 K");
  const [first] = rows;
  // 欄位是「位置」不是「名字」，所以順序改了不會有任何錯誤訊息——只會靜靜算錯。
  // 索引 0=ROC 日期 1=成交股數 2=成交金額 3=開 4=高 5=低 6=收 7=漲跌 8=筆數。
  assert.ok(first.length >= 9, `每列至少 9 欄，實際 ${first.length}`);
  assert.match(String(first[0]), /^\d{3}\/\d{2}\/\d{2}$/, `第 0 欄應為 ROC 日期，實際 ${first[0]}`);
  const numeric = (value) => Number(String(value).replace(/,/g, ""));
  for (const index of [3, 4, 5, 6]) {
    assert.ok(numeric(first[index]) > 0, `第 ${index} 欄（開高低收）應為正數，實際 ${first[index]}`);
  }
  assert.ok(numeric(first[4]) >= numeric(first[5]), "第 4 欄應是最高價、第 5 欄是最低價（順序不可對調）");
});

// 法人與融資券要挑一個真的有資料的交易日：假日與尚未公布的當天都會回非 OK。
// 往回找最多 10 天，全都沒有才 skip——那才是真的異常。
//
// `isUsable` 必須由各測試自己給：**這三個端點的回應形狀不一樣**。
// T86 把資料放 `data`，MI_MARGN 放 `tables[]`（兩張表），TPEx margin 也是 `tables[]`。
// 用一個「假設有 data」的通用判斷，會讓形狀不同的端點永遠 skip——看起來很健康，
// 其實從來沒檢查過（2026-08-23 第一版就是這樣，MI_MARGN 靜靜地 skip 掉）。
async function fetchLatestTradingPayload(t, buildUrl, referer, isUsable) {
  for (let back = 0; back < 10; back += 1) {
    const date = new Date(Date.now() - back * 86400e3);
    const compact = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    let res;
    try {
      res = await fetch(buildUrl(compact), { headers: { ...HEADERS, referer }, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      t.skip(`網路失敗：${error.message}`);
      return null;
    }
    if (!res.ok) continue;
    const payload = await res.json();
    if (isUsable(payload)) return payload;
  }
  t.skip("最近 10 天都沒有取得資料（可能全是假日，或上游改版）");
  return null;
}

test("TWSE 三大法人 T86：stat 與逐檔買賣超欄位", async (t) => {
  const payload = await fetchLatestTradingPayload(
    t,
    (date) => `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`,
    "https://www.twse.com.tw/zh/trading/foreign/t86.html",
    (body) => body?.stat === "OK" && Array.isArray(body.data) && body.data.length > 0,
  );
  if (!payload) return;
  assert.ok(payload.data.length > 100, `全市場法人資料應有數百檔，實際 ${payload.data.length}`);
  assert.ok(Array.isArray(payload.fields) && payload.fields.length >= 5, "fields 應描述欄位順序");
  assert.match(String(payload.data[0][0]).trim(), /^[0-9A-Z]{4,6}$/, `第 0 欄應為代號，實際 ${payload.data[0][0]}`);
});

test("TWSE 融資融券 MI_MARGN：兩張表的結構與「挑對表」的前提", async (t) => {
  const payload = await fetchLatestTradingPayload(
    t,
    (date) => `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${date}&selectType=ALL&response=json`,
    "https://www.twse.com.tw/zh/trading/margin/mi-margn.html",
    (body) => body?.stat === "OK" && Array.isArray(body.tables) && body.tables.length >= 2,
  );
  if (!payload) return;

  // getMarginData 是用「哪張表的列數 > 50」來挑逐檔那張的。所以真正要釘的不是「有兩張表」，
  // 而是**只有一張表的列數會超過 50**——摘要表哪天長胖到 51 列，就會挑錯表而且毫無徵兆。
  const big = payload.tables.filter((table) => Array.isArray(table.data) && table.data.length > 50);
  assert.equal(big.length, 1, `列數 >50 的表應該只有一張（逐檔），實際 ${big.length} 張：${payload.tables.map((tb) => (tb.data || []).length).join("/")}`);
  assert.ok(big[0].data.length > 500, `逐檔融資券應有上千檔，實際 ${big[0].data.length}`);
  assert.match(String(big[0].data[0][0]).trim(), /^[0-9A-Z]{4,6}$/, `第 0 欄應為代號，實際 ${big[0].data[0][0]}`);
});

test("TPEx 融資融券 balance：tables[0] 與逐檔欄位", async (t) => {
  const payload = await fetchLatestTradingPayload(
    t,
    (date) => `https://www.tpex.org.tw/www/zh-tw/margin/balance?date=${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}&response=json`,
    "https://www.tpex.org.tw/zh-tw/mainboard/trading/margin-trading/transactions.html",
    (body) => Array.isArray(body?.tables) && Array.isArray(body.tables[0]?.data) && body.tables[0].data.length > 0,
  );
  if (!payload) return;
  // 上櫃這條**固定讀 tables[0]**（不像上市要挑），所以第一張表就必須是逐檔那張。
  const rows = payload.tables[0].data;
  assert.ok(rows.length > 100, `上櫃逐檔融資券應有數百檔，實際 ${rows.length}`);
  assert.match(String(rows[0][0]).trim(), /^[0-9A-Z]{4,6}$/, `第 0 欄應為代號，實際 ${rows[0][0]}`);
});
