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
  { name: "TWSE 除權息", url: "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL", codeField: "Code", fields: ["Date", "Code", "CashDividend", "StockDividendRatio", "SubscriptionRatio", "SubscriptionPricePerShare"] },
  { name: "TPEx 處置", url: "https://www.tpex.org.tw/openapi/v1/tpex_disposal_information", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "DispositionPeriod", "DisposalCondition"] },
  { name: "TPEx 注意", url: "https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "TradingInformation"] },
  { name: "TPEx 鉅額", url: "https://www.tpex.org.tw/openapi/v1/tpex_daily_qutoes_block", codeField: "Code", fields: ["Code", "Name", "TradeValue", "Date"] },
  { name: "TPEx 變更交易", url: "https://www.tpex.org.tw/openapi/v1/tpex_cmode", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "AlteredTrading", "Date"] },
  { name: "TPEx 整批收盤", url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", codeField: "SecuritiesCompanyCode", fields: ["SecuritiesCompanyCode", "CompanyName", "Close", "TradingShares"] },
  { name: "TPEx 除權息", url: "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost", codeField: "SecuritiesCompanyCode", fields: ["ExRrightsExDividendDate", "SecuritiesCompanyCode", "CashDividend", "StockDividendRatio", "SubscriptionRatioToNewSharesIssued", "SubscriptionPricePerShare"] },
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
