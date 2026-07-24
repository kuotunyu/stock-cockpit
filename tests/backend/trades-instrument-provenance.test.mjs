// 交易商品 provenance：client official 欄位永遠只是未受信任輸入，只有後端官方主檔
// 或既有 server stamp 可以建立 official；未確認的債券 ETF 不得套用停徵優惠。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";
import {
  compactToday,
  stockDayAllRow,
  tpexDailyCloseRow,
  twseCompanyProfileRow,
  tpexCompanyProfileRow,
} from "../helpers/fixtures.mjs";

const SETTINGS = { feeDiscount: 0.6, minFee: 20 };
const TRADE_DATE = "20260710"; // 位於債券指數 ETF 停徵期間內。
const AS_OF = compactToday();
const realNow = Date.now;
let clock = Date.parse("2026-07-13T00:00:00.000Z");
let srv;

function tpexEtfPayload(category) {
  const rows = category === "domestic"
    ? [["006201", "元大富櫃50", "103/03/10"]]
    : [];
  return {
    date: AS_OF,
    stat: "OK",
    tables: [{
      fields: ["證券代號", "ETF簡稱", "上櫃日期"],
      data: rows,
      totalCount: rows.length,
    }],
  };
}

function tradeRecord(overrides = {}) {
  const instrumentType = overrides.instrumentType || "bondIndexEtf";
  return {
    id: "trade-1",
    code: "00999B",
    market: "unknown",
    instrumentType,
    instrumentSource: "user",
    side: "buy",
    kind: instrumentType === "stock" ? "stock" : "etf",
    date: TRADE_DATE,
    tradeDate: TRADE_DATE,
    executedAt: "",
    session: "regular",
    brokerAccountId: "default",
    currency: "TWD",
    price: 10,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    ...overrides,
  };
}

async function getLedger() {
  const response = await srv.api("/api/trades");
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function putLedger(records, base = null) {
  const current = base || await getLedger();
  const response = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      schemaVersion: 2,
      rev: current.rev,
      settings: current.settings || SETTINGS,
      records,
    }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

function officialFetchCounts() {
  return {
    twseEtf: srv.mock.callsFor(/t187ap47_L/).length,
    tpexEtf: srv.mock.callsFor(/\/www\/zh-tw\/ETF\/list/).length,
    twseCompany: srv.mock.callsFor(/t187ap03_L/).length,
    tpexCompany: srv.mock.callsFor(/mopsfin_t187ap03_O/).length,
    twseReference: srv.mock.callsFor(/STOCK_DAY_ALL/).length,
    tpexReference: srv.mock.callsFor(/tpex_mainboard_daily_close_quotes/).length,
  };
}

before(async () => {
  Date.now = () => clock;
  srv = await bootServer({
    routes: [
      {
        match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap47_L/,
        reply: [{
          "出表日期": AS_OF,
          "基金代號": "00725B",
          "基金簡稱": "國泰投資級公司債",
          "基金類型": "國外成分證券指數股票型基金",
          "基金中文名稱": "國泰10年期以上A等級美元公司債券基金",
          "成立日期": "20170629",
          "上市日期": "20170725",
        }],
      },
      {
        match: /tpex\.org\.tw\/www\/zh-tw\/ETF\/list/,
        reply: (_url, init) => {
          const category = new URLSearchParams(String(init?.body || "")).get("type") || "";
          return tpexEtfPayload(category);
        },
      },
      {
        match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/,
        reply: [twseCompanyProfileRow({ code: "2330", name: "台積電" })],
      },
      {
        match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/,
        reply: [tpexCompanyProfileRow({ code: "5347", name: "世界" })],
      },
      {
        match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/,
        reply: [
          stockDayAllRow({ code: "2330", name: "台積電", close: 100 }),
          stockDayAllRow({ code: "00725B", name: "國泰投資級公司債", close: 40 }),
        ],
      },
      {
        match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/,
        reply: [tpexDailyCloseRow({ code: "5347", name: "世界", close: 100 })],
      },
    ],
  });
});

after(async () => {
  try {
    if (srv) {
      srv.mock.restore();
      await srv.close();
    }
  } finally {
    Date.now = realNow;
  }
});

test("trades instrument provenance：只信任後端主檔與既有 server stamp", async (t) => {
  let ledger = await getLedger();

  await t.test("instrument-profile 是公開唯讀契約，回傳官方／未解析狀態並驗證輸入", async () => {
    const officialResponse = await srv.raw("/api/instrument-profile?code=00725B");
    assert.equal(officialResponse.status, 200);
    const official = await officialResponse.json();
    assert.equal(official.status, "official");
    assert.equal(official.profile.instrumentType, "bondIndexEtf");
    assert.equal(official.profile.instrumentSource, "official");

    const unresolvedResponse = await srv.raw("/api/instrument-profile?code=00999B");
    assert.equal(unresolvedResponse.status, 200);
    const unresolved = await unresolvedResponse.json();
    assert.equal(unresolved.status, "unresolved");
    assert.equal(unresolved.profile, null);
    assert.equal(unresolved.dataQuality.degraded, false);

    assert.equal((await srv.raw("/api/instrument-profile?code=bad!")).status, 400);
    assert.equal((await srv.raw("/api/instrument-profile?code=00725B", { method: "POST" })).status, 405);
  });

  await t.test("client 偽造 official 不成立；未收錄 bondIndexEtf 以一般 ETF 1‰ 估稅並待覆核", async () => {
    const forged = {
      instrumentSource: "official",
      instrumentRuleId: "client-forged-rule",
      instrumentAsOf: "20200101",
    };
    ledger = await putLedger([
      tradeRecord({ id: "unknown-buy", ...forged }),
      tradeRecord({ id: "unknown-sell", side: "sell", ...forged }),
    ], ledger);

    const buy = ledger.records.find((record) => record.id === "unknown-buy");
    const sell = ledger.records.find((record) => record.id === "unknown-sell");
    for (const record of [buy, sell]) {
      assert.equal(record.instrumentType, "bondIndexEtf");
      assert.equal(record.instrumentSource, "user");
      assert.equal(Object.hasOwn(record, "instrumentRuleId"), false);
      assert.equal(Object.hasOwn(record, "instrumentAsOf"), false);
      assert.equal(record.reviewStatus, "needsReview");
      assert.match(record.reviewReasons.join(" "), /後端官方商品主檔|債券指數 ETF/);
    }
    assert.equal(sell.taxAmountTwd, 10, "10 元 × 1,000 股 × 0.1% 應為 10 元");
    assert.equal(sell.taxSource, "estimated");
    assert.equal(sell.taxRuleId, "tw-etf-etn-general-0.001");
  });

  await t.test("estimated／legacy 是後端管理來源：新紀錄不能夾帶任意金額，既有估值也不能被竄改", async () => {
    const forgedMoney = {
      fee: 20,
      feeAmountTwd: 20,
      feeSource: "estimated",
      feeRuleId: "client-estimate",
      tax: 300,
      taxAmountTwd: 300,
      taxSource: "estimated",
      taxRuleId: "client-tax-estimate",
    };
    const forgedLegacy = {
      fee: 0,
      feeAmountTwd: 0,
      feeSource: "legacy",
      feeRuleId: "client-legacy",
      tax: 0,
      taxAmountTwd: 0,
      taxSource: "legacy",
      taxRuleId: "client-legacy",
    };
    ledger = await putLedger([
      tradeRecord({ id: "estimate-buy", code: "2330", instrumentType: "stock", price: 200, ...forgedMoney, tax: 0, taxAmountTwd: 0 }),
      tradeRecord({ id: "estimate-sell", code: "2330", instrumentType: "stock", side: "sell", price: 200, ...forgedMoney }),
      tradeRecord({ id: "legacy-buy", code: "2330", instrumentType: "stock", price: 200, ...forgedLegacy }),
      tradeRecord({ id: "legacy-sell", code: "2330", instrumentType: "stock", side: "sell", price: 200, ...forgedLegacy }),
    ], ledger);

    for (const record of ledger.records) {
      assert.equal(record.feeAmountTwd, 171, `${record.id} 手續費必須由後端依 0.1425% × 0.6 重算`);
      assert.equal(record.feeSource, "estimated");
      assert.equal(record.feeRuleId, "broker-profile-default-estimate");
      assert.equal(record.taxAmountTwd, record.side === "sell" ? 600 : 0);
      assert.equal(record.taxSource, "estimated");
      assert.equal(record.taxRuleId, record.side === "sell" ? "tw-stock-general-0.003" : "not-a-sale");
    }

    const tampered = ledger.records.map((record) => ({
      ...record,
      fee: 1,
      feeAmountTwd: 1,
      feeRuleId: "client-mutated-estimate",
      ...(record.side === "sell" ? {
        tax: 1,
        taxAmountTwd: 1,
        taxRuleId: "client-mutated-tax",
      } : {}),
    }));
    ledger = await putLedger(tampered, ledger);
    for (const record of ledger.records) {
      assert.equal(record.feeAmountTwd, 171, `${record.id} 未改經濟內容時沿用 server 已凍結估值`);
      assert.equal(record.taxAmountTwd, record.side === "sell" ? 600 : 0);
    }

    const repriced = ledger.records.map((record) => ({
      ...record,
      price: 210,
      fee: 1,
      feeAmountTwd: 1,
      ...(record.side === "sell" ? { tax: 1, taxAmountTwd: 1 } : {}),
    }));
    ledger = await putLedger(repriced, ledger);
    for (const record of ledger.records) {
      assert.equal(record.feeAmountTwd, 180, `${record.id} 改價後必須重新估算`);
      assert.equal(record.taxAmountTwd, record.side === "sell" ? 630 : 0);
    }
  });

  await t.test("官方 00725B 由後端覆寫偽造 stamp，並依成交日套用債券 ETF 停徵", async () => {
    const forged = {
      instrumentSource: "official",
      instrumentRuleId: "client-forged-rule",
      instrumentAsOf: "20200101",
    };
    ledger = await putLedger([
      tradeRecord({ id: "official-bond-buy", code: "00725B", instrumentType: "equityEtf", price: 40, ...forged }),
      tradeRecord({ id: "official-bond-sell", code: "00725B", instrumentType: "equityEtf", side: "sell", price: 40, ...forged }),
    ], ledger);

    const buy = ledger.records.find((record) => record.id === "official-bond-buy");
    const sell = ledger.records.find((record) => record.id === "official-bond-sell");
    for (const record of [buy, sell]) {
      assert.equal(record.instrumentType, "bondIndexEtf");
      assert.equal(record.instrumentSource, "official");
      assert.equal(record.instrumentRuleId, "official-product-directory-v1:twse-t187ap47");
      assert.equal(record.instrumentAsOf, AS_OF);
      assert.equal(record.market, "TWSE");
      assert.equal(record.reviewStatus, "ok");
    }
    assert.equal(sell.taxAmountTwd, 0);
    assert.equal(sell.taxSource, "estimated");
    assert.equal(sell.taxRuleId, "tw-bond-index-etf-exempt-20170101-20261231");
  });

  await t.test("同 id／同商品只要成交日改變，就必須重新檢查官方掛牌日", async () => {
    const movedBeforeListing = ledger.records.map((record) => ({
      ...record,
      date: "20170102",
      tradeDate: "20170102",
    }));
    const result = await srv.mod.canonicalizeTradeInstrumentProvenance({
      schemaVersion: 2,
      settings: ledger.settings,
      records: movedBeforeListing,
    }, ledger);
    for (const record of result.payload.records) {
      assert.equal(record.instrumentSource, "user");
      assert.equal(Object.hasOwn(record, "instrumentRuleId"), false);
      assert.match(record.reviewReasons.join(" "), /早於官方商品掛牌日/);
    }
  });

  await t.test("同 id／同 identity 沿用 server stamp 且不重查；換代號才重新核定", async () => {
    clock += 24 * 60 * 60 * 1000 + 1; // 所有官方主檔 TTL 均已過期。
    const beforeSameIdentity = officialFetchCounts();
    const existingRuleId = ledger.records[0].instrumentRuleId;
    const existingAsOf = ledger.records[0].instrumentAsOf;
    const sameIdentityRecords = ledger.records.map((record) => ({
      ...record,
      note: "只修改備註",
      instrumentRuleId: "client-mutated-rule",
      instrumentAsOf: "20200101",
    }));
    ledger = await putLedger(sameIdentityRecords, ledger);

    assert.deepEqual(officialFetchCounts(), beforeSameIdentity, "同 identity 不應重新呼叫任何官方主檔");
    for (const record of ledger.records) {
      assert.equal(record.instrumentRuleId, existingRuleId);
      assert.equal(record.instrumentAsOf, existingAsOf);
      assert.equal(record.instrumentSource, "official");
    }

    const changedCodeRecords = ledger.records.map((record) => {
      const changed = {
        ...record,
        code: "2330",
        instrumentType: "bondIndexEtf", // client hint 故意錯誤，應由公司主檔覆寫成 stock。
        instrumentRuleId: "client-mutated-rule",
        instrumentAsOf: "20200101",
      };
      if (changed.side === "sell") {
        delete changed.tax;
        delete changed.taxAmountTwd;
        delete changed.taxSource;
        delete changed.taxRuleId;
      }
      return changed;
    });
    ledger = await putLedger(changedCodeRecords, ledger);
    const afterChangedCode = officialFetchCounts();

    assert.equal(afterChangedCode.twseEtf, beforeSameIdentity.twseEtf + 1);
    assert.equal(afterChangedCode.tpexEtf, beforeSameIdentity.tpexEtf + 7);
    assert.equal(afterChangedCode.twseCompany, beforeSameIdentity.twseCompany + 1);
    assert.equal(afterChangedCode.tpexCompany, beforeSameIdentity.tpexCompany + 1);
    assert.equal(afterChangedCode.twseReference, beforeSameIdentity.twseReference + 1);
    assert.equal(afterChangedCode.tpexReference, beforeSameIdentity.tpexReference + 1);
    for (const record of ledger.records) {
      assert.equal(record.code, "2330");
      assert.equal(record.instrumentType, "stock");
      assert.equal(record.instrumentSource, "official");
      assert.equal(record.instrumentRuleId, "official-product-directory-v1:company-directory");
      assert.notEqual(record.instrumentRuleId, existingRuleId);
    }
  });

  await t.test("既有無 stamp 的 official normalize 時降級，但 supplied tax 與來源／規則原值凍結", () => {
    const normalized = srv.mod.normalizeTradesPayload({
      schemaVersion: 2,
      settings: SETTINGS,
      records: [tradeRecord({
        id: "legacy-official-without-stamp",
        code: "00888B",
        side: "sell",
        instrumentSource: "official",
        tax: 77,
        taxAmountTwd: 77,
        taxSource: "legacy",
        taxRuleId: "legacy-frozen",
      })],
    }, { todayCompact: AS_OF });
    const record = normalized.records[0];

    assert.equal(record.instrumentSource, "user");
    assert.equal(Object.hasOwn(record, "instrumentRuleId"), false);
    assert.equal(Object.hasOwn(record, "instrumentAsOf"), false);
    assert.equal(record.reviewStatus, "needsReview");
    assert.match(record.reviewReasons.join(" "), /缺少後端驗證憑據/);
    assert.equal(record.taxAmountTwd, 77);
    assert.equal(record.taxSource, "legacy");
    assert.equal(record.taxRuleId, "legacy-frozen");
  });

  await t.test("成交日早於官方掛牌日，不得用日後主檔替歷史紀錄背書", async () => {
    const result = await srv.mod.canonicalizeTradeInstrumentProvenance({
      schemaVersion: 2,
      settings: SETTINGS,
      records: [tradeRecord({
        id: "before-listing",
        code: "00725B",
        date: "20100104",
        tradeDate: "20100104",
      })],
    }, { schemaVersion: 2, settings: SETTINGS, records: [] });
    const record = result.payload.records[0];
    assert.equal(record.instrumentSource, "user");
    assert.equal(Object.hasOwn(record, "instrumentRuleId"), false);
    assert.match(record.reviewReasons.join(" "), /早於官方商品掛牌日/);
  });
});
