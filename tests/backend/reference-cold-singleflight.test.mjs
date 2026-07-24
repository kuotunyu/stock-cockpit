// 整批收盤冷啟動：單一市場失敗仍部分成功，並發呼叫共用同一組上游請求。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow } from "../helpers/fixtures.mjs";

let releaseTwse;
const twseGate = new Promise((resolve) => { releaseTwse = resolve; });
const { mod, mock, dataDir } = await importServer({
  routes: [
    {
      match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/,
      reply: async () => {
        await twseGate;
        return [stockDayAllRow({ code: "2330", name: "台積電", close: 100 })];
      },
    },
    {
      match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/,
      reply: { __error: "tpex down" },
    },
  ],
});

after(async () => {
  releaseTwse();
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("冷啟動 partial success＋single-flight", async () => {
  const pending = Array.from({ length: 20 }, () => mod.getReferenceData());
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(mock.callsFor(/STOCK_DAY_ALL/).length, 1);
    assert.equal(mock.callsFor(/tpex_mainboard_daily_close_quotes/).length, 1);
  } finally {
    releaseTwse();
  }
  const results = await Promise.all(pending);
  assert.ok(results.every((result) => result === results[0]), "並發呼叫應取得同一個 aggregate 物件");
  const reference = results[0];
  assert.equal(reference.byCode.get("2330").name, "台積電");
  assert.equal(reference.byCode.has("5347"), false);
  assert.deepEqual(reference.counts, { twse: 1, tpex: 0 });
  assert.equal(reference.degraded, true);
  assert.equal(reference.coverageComplete, false);
  assert.equal(reference.markets.twse.status, "fresh");
  assert.equal(reference.markets.tpex.status, "unavailable");
  assert.ok(reference.warnings.some((warning) => warning.includes("上櫃") && warning.includes("暫時不含")));
});

