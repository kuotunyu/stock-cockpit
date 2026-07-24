// 報價 enrichment 不可原地污染共享 reference last-good 物件。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, twseCompanyProfileRow } from "../helpers/fixtures.mjs";

const { mod, mock, dataDir } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: [stockDayAllRow({ code: "2330", name: "台積電", close: 100, volume: 1500000 })] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: [] },
    { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: { msgArray: [] } },
    { match: /query1\.finance\.yahoo\.com/, reply: { chart: { result: [{ meta: {} }] } } },
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: [twseCompanyProfileRow({ code: "2330", name: "台積電", shares: 1000000000 })] },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: [] },
  ],
});

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("fallback quote enrichment 使用副本", async () => {
  const reference = await mod.getReferenceData();
  const cached = reference.byCode.get("2330");
  const before = structuredClone(cached);
  const body = await mod.getQuotes(["2330"]);
  const quote = body.quotes[0];
  assert.notEqual(quote, cached);
  assert.equal(quote.issuedShares, 1000000000);
  assert.ok(Number.isFinite(quote.turnoverPct));
  assert.deepEqual(cached, before);
  assert.equal(Object.hasOwn(cached, "issuedShares"), false);
  assert.equal(Object.hasOwn(cached, "turnoverPct"), false);
  assert.equal(Object.hasOwn(cached, "dividend"), false);
  assert.deepEqual((await mod.getReferenceData()).byCode.get("2330"), before);
});

test("reference 缺市場時，未知代號同時嘗試上市／上櫃 MIS 與 Yahoo", async () => {
  const body = await mod.getQuotes(["5347"]);
  assert.equal(body.quoteCount, 0);
  const misUrl = mock.callsFor(/mis\.twse\.com\.tw\/stock\/api\/getStockInfo/).at(-1)?.url || "";
  const decodedMis = decodeURIComponent(misUrl);
  assert.ok(decodedMis.includes("tse_5347.tw"), decodedMis);
  assert.ok(decodedMis.includes("otc_5347.tw"), decodedMis);
  const yahooUrls = mock.callsFor(/query1\.finance\.yahoo\.com/).map((call) => call.url);
  assert.ok(yahooUrls.some((url) => url.includes("5347.TW?")), JSON.stringify(yahooUrls));
  assert.ok(yahooUrls.some((url) => url.includes("5347.TWO?")), JSON.stringify(yahooUrls));
});
