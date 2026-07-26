// 交易帳本 v2 稅費規則、遷移、嚴格驗證與損益稽核欄位契約。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer({ routes: [] }));
});

const SETTINGS = { feeDiscount: 0.6, minFee: 20 };

function v2Record(overrides = {}) {
  return {
    id: "v2-1",
    code: "2330",
    market: "TWSE",
    instrumentType: "stock",
    instrumentSource: "user",
    side: "sell",
    date: "20260710",
    tradeDate: "20260710",
    session: "regular",
    brokerAccountId: "default",
    currency: "TWD",
    price: 100,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    ...overrides,
  };
}

test("computeTradeTaxRule：股票一般、完整與部分當沖皆按實際配對股數分段", () => {
  const general = mod.computeTradeTaxRule({
    side: "sell", price: 100, shares: 1000, date: "20260710", instrumentType: "stock",
  });
  assert.equal(general.amount, 300);
  assert.equal(general.ruleId, "tw-stock-general-0.003");

  const full = mod.computeTradeTaxRule({
    side: "sell", price: 100, shares: 1000, date: "20260710", instrumentType: "stock",
    dayTrade: { status: "brokerConfirmed", matchedShares: 1000 },
  });
  assert.equal(full.amount, 150);
  assert.equal(full.rate, 0.0015);
  assert.equal(full.dayTradeShares, 1000);

  // 部分當沖的樣本改成法律上站得住的數字：賣 3,000 股、其中 2,000 股是當天沖銷掉的。
  // 舊案例用 400 股——那在台股必然是零股交易，而零股**不適用**現股當沖
  //（有價證券當日沖銷交易作業辦法 §1 第 4 項），見下方專門的測試。
  const partial = mod.computeTradeTaxRule({
    side: "sell", price: 100, shares: 3000, date: "20260710", instrumentType: "stock",
    dayTrade: { status: "brokerConfirmed", matchedShares: 2000 },
  });
  assert.equal(partial.amount, 600, "2,000 股 × 1.5‰ + 1,000 股 × 3‰ = 300 + 300");
  assert.equal(partial.rate, null, "混合稅率不可偽裝成單一 rate");
  assert.equal(partial.dayTradeShares, 2000);
});

test("computeTradeTaxRule：當沖優惠與債券指數 ETF 停徵日期邊界", () => {
  const dayTrade = (date) => mod.computeTradeTaxRule({
    side: "sell", price: 100, shares: 1000, date, instrumentType: "stock",
    dayTrade: { status: "brokerConfirmed", matchedShares: 1000 },
  });
  assert.equal(dayTrade("20170427").amount, 300);
  assert.equal(dayTrade("20170428").amount, 150);
  assert.equal(dayTrade("20271231").amount, 150);
  assert.equal(dayTrade("20280101").amount, 300);

  const bondEtf = (date) => mod.computeTradeTaxRule({
    side: "sell", price: 100, shares: 1000, date, instrumentType: "bondIndexEtf",
  });
  assert.equal(bondEtf("20161231").amount, 100);
  assert.equal(bondEtf("20170101").amount, 0);
  assert.equal(bondEtf("20261231").amount, 0);
  assert.equal(bondEtf("20270101").amount, 100);
});

test("computeTradeTaxRule：主動式、槓反與一般 ETF 均為 1‰，ETF 當沖不套股票 1.5‰", () => {
  for (const instrumentType of ["equityEtf", "activeEtf", "leveragedInverseEtf", "etn"]) {
    const result = mod.computeTradeTaxRule({
      side: "sell", price: 100, shares: 1000, date: "20260710", instrumentType,
      dayTrade: { status: "brokerConfirmed", matchedShares: 1000 },
    });
    assert.equal(result.amount, 100, instrumentType);
    assert.equal(result.rate, 0.001, instrumentType);
  }
});

test("v1→v2 migration：費稅原值凍結、ETF/當沖待覆核、異常紀錄隔離且重跑冪等", () => {
  const migratedAt = "2026-07-13T08:00:00.000Z";
  const legacy = {
    settings: SETTINGS,
    records: [
      { id: "stock-buy", code: "2330", side: "buy", kind: "stock", date: "20260701", price: 100, shares: 1000, fee: 86, tax: 0 },
      { id: "old-etf", code: "0050", side: "sell", kind: "etf", date: "20260702", price: 110, shares: 1000, fee: 94, tax: 110 },
      { id: "old-daytrade", code: "2330", side: "sell", kind: "dayTrade", date: "20260703", price: 110, shares: 500, fee: 47, tax: 82 },
      { id: "broken", code: "x", side: "sell", kind: "stock", date: "20260703", price: 10, shares: 1 },
    ],
  };
  const first = mod.migrateTradesPayloadToV2(legacy, { migratedAt });
  assert.equal(first.changed, true);
  assert.equal(first.payload.schemaVersion, 2);
  assert.equal(first.payload.records.length, 3);
  assert.equal(first.payload.quarantinedRecords.length, 1, "異常紀錄不可永久丟掉");
  assert.equal(first.payload.migration.migratedAt, migratedAt);

  const etf = first.payload.records.find((record) => record.id === "old-etf");
  assert.equal(etf.instrumentType, "unknownEtf");
  assert.equal(etf.tax, 110);
  assert.equal(etf.taxSource, "legacy");
  assert.equal(etf.reviewStatus, "needsReview");

  const dayTrade = first.payload.records.find((record) => record.id === "old-daytrade");
  assert.equal(dayTrade.kind, "stock", "v2 alias 不再把當沖偽裝成商品類型");
  assert.equal(dayTrade.instrumentType, "stock");
  assert.equal(dayTrade.legacyKind, "dayTrade");
  assert.deepEqual(dayTrade.dayTrade, { status: "legacyDeclared", matchedShares: 0, pairId: "" });
  assert.equal(dayTrade.tax, 82, "舊版既有稅額必須原值凍結");
  assert.equal(dayTrade.taxRuleId, "legacy-frozen");

  const second = mod.migrateTradesPayloadToV2(first.payload, { migratedAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(second.changed, false);
  assert.deepEqual(second.payload, first.payload);
});

test("v2 canonical：券商實際 0 元可覆寫估算；設定變更不得追溯重算", () => {
  const input = {
    schemaVersion: 2,
    settings: SETTINGS,
    records: [v2Record({
      id: "bond-actual",
      code: "00725B",
      instrumentType: "bondIndexEtf",
      date: "20261231",
      tradeDate: "20261231",
      feeAmountTwd: 0,
      feeSource: "broker",
      taxAmountTwd: 0,
      taxSource: "broker",
    })],
    quarantinedRecords: [],
  };
  const validation = mod.validateTradesMutationInput(input, "20261231");
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const canonical = mod.normalizeTradesPayload(input, { todayCompact: "20261231" });
  const record = canonical.records[0];
  assert.equal(record.code, "00725B");
  assert.equal(record.fee, 0);
  assert.equal(record.feeSource, "broker");
  assert.equal(record.tax, 0);
  assert.equal(record.taxSource, "broker");

  const afterSettingsChange = mod.normalizeTradesPayload({
    ...canonical,
    settings: { feeDiscount: 1, minFee: 100 },
  }, { todayCompact: "20261231" });
  assert.equal(afterSettingsChange.records[0].fee, 0, "歷史費用已凍結，不可因設定改變重算");
  assert.equal(afterSettingsChange.records[0].tax, 0);
});

test("v2 estimated：部分當沖保存 matchedShares、來源與 effective-dated rule id", () => {
  const input = {
    schemaVersion: 2,
    settings: SETTINGS,
    records: [v2Record({
      shares: 3000,
      dayTrade: { status: "brokerConfirmed", matchedShares: 2000, pairId: "pair-1" },
    })],
  };
  const validation = mod.validateTradesMutationInput(input, "20260713");
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const record = mod.normalizeTradesPayload(input, { todayCompact: "20260713" }).records[0];
  assert.equal(record.tax, 600, "2,000 股 × 1.5‰ + 1,000 股 × 3‰");
  assert.equal(record.taxSource, "estimated");
  assert.equal(record.taxRuleId, "tw-stock-daytrade-20170428-20271231");
  assert.equal(record.dayTrade.matchedShares, 2000);
});

test("v2 estimated：未經官方確認的債券 ETF 不套 0 稅率，先按一般 ETF 估算", () => {
  const record = mod.normalizeTradesPayload({
    schemaVersion: 2,
    settings: SETTINGS,
    records: [v2Record({
      id: "bond-needs-review",
      code: "00725B",
      instrumentType: "bondIndexEtf",
      instrumentSource: "user",
      date: "20261231",
      tradeDate: "20261231",
    })],
  }, { todayCompact: "20261231" }).records[0];
  assert.equal(record.tax, 100);
  assert.equal(record.taxSource, "estimated");
  assert.equal(record.taxRuleId, "tw-etf-etn-general-0.001");
  assert.equal(record.reviewStatus, "needsReview");
  assert.match(record.reviewReasons.join(" "), /官方商品主檔|券商實際/);
});

test("v2 strict validation：拒絕未來 schema、非股票當沖、超量配對與缺少實際金額", () => {
  assert.equal(mod.validateTradesMutationInput({ schemaVersion: 3, settings: SETTINGS, records: [] }).ok, false);

  const invalidCases = [
    v2Record({ instrumentType: "equityEtf", dayTrade: { status: "brokerConfirmed", matchedShares: 1000, pairId: "" } }),
    v2Record({ dayTrade: { status: "brokerConfirmed", matchedShares: 1001, pairId: "" } }),
    v2Record({ feeSource: "broker" }),
    v2Record({ session: "oddLot", dayTrade: { status: "brokerConfirmed", matchedShares: 1000, pairId: "" } }),
    v2Record({ executedAt: "2026-07-10T10:30:00" }),
    v2Record({ dayTrade: { status: "none", matchedShares: 0, pairId: "x".repeat(49) } }),
    v2Record({ dayTrade: undefined }),
    v2Record({ reviewStatus: "pending" }),
    v2Record({ reviewReasons: Array.from({ length: 13 }, (_, index) => `reason-${index}`) }),
    v2Record({ feeRuleId: "x".repeat(81) }),
  ];
  for (const record of invalidCases) {
    const result = mod.validateTradesMutationInput({ schemaVersion: 2, settings: SETTINGS, records: [record] }, "20260713");
    assert.equal(result.ok, false, JSON.stringify(record));
  }
});

test("v2 同日成交依真實 instant 排序，且成交時間的台北日期必須等於成交日", () => {
  const payload = {
    schemaVersion: 2,
    settings: SETTINGS,
    records: [
      v2Record({
        id: "buy-offset",
        side: "buy",
        date: "20260713",
        tradeDate: "20260713",
        executedAt: "2026-07-13T09:10:00+08:00",
      }),
      v2Record({
        id: "sell-zulu",
        side: "sell",
        date: "20260713",
        tradeDate: "20260713",
        executedAt: "2026-07-13T01:20:00Z",
      }),
    ],
  };
  const validation = mod.validateTradesMutationInput(payload, "20260713");
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const normalized = mod.normalizeTradesPayload(payload, { todayCompact: "20260713" });
  assert.deepEqual(normalized.records.map((record) => record.id), ["buy-offset", "sell-zulu"]);
  assert.equal(mod.buildPortfolio(normalized).ok, true, "09:10 買進必須排在台北 09:20 賣出之前");

  const wrongTaipeiDate = {
    ...payload,
    records: [v2Record({
      id: "wrong-local-date",
      side: "buy",
      date: "20260713",
      tradeDate: "20260713",
      executedAt: "2026-07-12T15:30:00Z",
    })],
  };
  const rejected = mod.validateTradesMutationInput(wrongTaipeiDate, "20260713");
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((error) => error.field === "executedAt" && /台北成交日/.test(error.message)));
});

test("buildPortfolio v2 稽核欄位：已實現列與 totals 保留 gross/fee/tax/source", () => {
  const payload = mod.normalizeTradesPayload({
    schemaVersion: 2,
    settings: SETTINGS,
    records: [
      v2Record({ id: "buy", side: "buy", date: "20260701", tradeDate: "20260701", price: 100, feeAmountTwd: 86, feeSource: "broker", taxAmountTwd: 0, taxSource: "estimated" }),
      v2Record({ id: "sell", date: "20260702", tradeDate: "20260702", price: 110, shares: 500, feeAmountTwd: 47, feeSource: "broker", taxAmountTwd: 165, taxSource: "broker" }),
    ],
  }, { todayCompact: "20260713" });
  const portfolio = mod.buildPortfolio(payload);
  assert.equal(portfolio.ok, true);
  assert.equal(portfolio.realized[0].grossProceeds, 55_000);
  assert.equal(portfolio.realized[0].fee, 47);
  assert.equal(portfolio.realized[0].tax, 165);
  assert.equal(portfolio.realized[0].feeSource, "broker");
  assert.equal(portfolio.realized[0].taxSource, "broker");
  assert.equal(portfolio.totals.buyFees, 86);
  assert.equal(portfolio.totals.sellFees, 47);
  assert.equal(portfolio.totals.securitiesTax, 165);
});
