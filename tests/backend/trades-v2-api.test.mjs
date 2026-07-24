// 交易帳本 API 的 v1 相容升級、v2 往返與未來 schema 拒絕契約。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
before(async () => {
  srv = await bootServer({ routes: [] });
});
after(async () => {
  await srv.close();
});

const settings = { feeDiscount: 0.6, minFee: 20 };

test("trades API v2：v1 PUT 自動升級，GET 永遠回 schemaVersion 2", async () => {
  const initial = await (await srv.api("/api/trades")).json();
  assert.equal(initial.schemaVersion, 2);
  assert.deepEqual(initial.quarantinedRecords, []);

  const response = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      rev: initial.rev,
      settings,
      records: [{
        id: "legacy-buy",
        code: "2330",
        side: "buy",
        kind: "stock",
        date: "20260701",
        price: 100,
        shares: 1000,
        fee: 86,
        tax: 0,
      }],
    }),
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.records[0].instrumentType, "stock");
  assert.equal(saved.records[0].instrumentSource, "legacy");
  assert.equal(saved.records[0].fee, 86);
  assert.equal(saved.records[0].feeSource, "legacy");
  assert.equal(saved.records[0].reviewStatus, "needsReview");

  const again = await (await srv.api("/api/trades")).json();
  assert.equal(again.schemaVersion, 2);
  assert.equal(again.records[0].fee, 86);
});

test("trades API v2：英數 ETF、券商實際 0 元與來源可無損往返", async () => {
  const current = await (await srv.api("/api/trades")).json();
  const bondBuy = {
    id: "bond-buy",
    code: "00725B",
    market: "TWSE",
    instrumentType: "bondIndexEtf",
    instrumentSource: "user",
    side: "buy",
    kind: "etf",
    date: "20260702",
    tradeDate: "20260702",
    executedAt: "",
    session: "regular",
    brokerAccountId: "default",
    currency: "TWD",
    price: 30,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    feeAmountTwd: 0,
    feeSource: "broker",
    taxAmountTwd: 0,
    taxSource: "estimated",
  };
  const response = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      schemaVersion: 2,
      rev: current.rev,
      settings: current.settings,
      records: [...current.records, bondBuy],
    }),
  });
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const saved = JSON.parse(responseText);
  const record = saved.records.find((item) => item.id === "bond-buy");
  assert.equal(record.code, "00725B");
  assert.equal(record.instrumentType, "bondIndexEtf");
  assert.equal(record.feeAmountTwd, 0);
  assert.equal(record.feeSource, "broker");
  assert.equal(record.taxAmountTwd, 0);
  assert.equal(record.taxRuleId, "not-a-sale");
});

test("trades API v2：未來 schema 整包 422，rev 與資料不變", async () => {
  const before = await (await srv.api("/api/trades")).json();
  const rejected = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      schemaVersion: 99,
      rev: before.rev,
      settings: before.settings,
      records: before.records,
    }),
  });
  assert.equal(rejected.status, 422);
  const error = await rejected.json();
  assert.equal(error.code, "VALIDATION_ERROR");
  assert.match(JSON.stringify(error.details), /schemaVersion|版本/);

  const afterPayload = await (await srv.api("/api/trades")).json();
  assert.equal(afterPayload.rev, before.rev);
  assert.deepEqual(afterPayload.records, before.records);
});
