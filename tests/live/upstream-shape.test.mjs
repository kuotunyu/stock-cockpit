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
    // D-41：欄位存在還不夠，**數量級也要釘住**。
    // 除權息報表的欄位名叫 Ratio，但同一份報表的網頁版是以「每仟股無償配股（股）」呈現，
    // 兩者差 100 倍。上游若改單位，referencePrice 的除數會從 1.1 變成 101，整段 K 線塌陷，
    // 而且 formulaComplete 仍是 true、source 仍蓋著 official 章——只有這條斷言會喊。
    // 2026-07-27 實測：TWSE 18 筆＋TPEx 11 筆真實配股全部落在 (0,1)，最大 0.5。
    if (source.ratioFields) {
      for (const field of source.ratioFields) {
        const values = usable
          .map((row) => Number(String(row?.[field] ?? "").replace(/,/g, "")))
          .filter((value) => Number.isFinite(value) && value > 0);
        for (const value of values) {
          assert.ok(value < 1, `${source.name} 的 ${field} 出現 ${value}——比率不該 ≥1，上游可能改成每仟股股數了`);
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
