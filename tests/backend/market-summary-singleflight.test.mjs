// getMarketSummary 只有 15 秒快取、沒有 single-flight：到期瞬間 N 個並發 /api/markets 會打 2N 次 MIS／期交所。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { misQuoteRow, taifexMisRow, compactToday } from "../helpers/fixtures.mjs";

const yd = Number(compactToday().slice(0, 4)) % 10;
const { mod, mock } = await importServer({
  routes: [
    { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({
      msgArray: [{ ...misQuoteRow({ code: "t00", name: "發行量加權股價指數", z: "23000", y: "22500" }), n: "發行量加權股價指數" }],
    }) },
    { match: /mis\.taifex\.com\.tw\/futures\/api\/getQuoteList/, reply: () => ({
      RtData: { QuoteList: [taifexMisRow({ symbolId: `TXFI${yd}-F`, last: 23050, ref: 22900, volume: 50000 })] },
    }) },
  ],
});

test("同時三個 getMarketSummary 只打一次上游，且拿到同一份結果", async () => {
  const results = await Promise.all([mod.getMarketSummary(), mod.getMarketSummary(), mod.getMarketSummary()]);
  assert.equal(mock.callsFor(/mis\.twse\.com\.tw/).length, 1, "加權指數只抓一次");
  assert.ok(results.every((r) => r === results[0]), "並發呼叫共用同一個 promise 的結果");
  assert.equal(results[0].markets.taiex.price, 23000);
});
