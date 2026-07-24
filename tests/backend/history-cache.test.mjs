// 逐檔月 K：同 key 併發共用 single-flight，完成後命中快取，不重複打官方端點。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const today = compactToday();
const month = `${today.slice(0, 6)}01`;
const rocDate = `${Number(today.slice(0, 4)) - 1911}/${today.slice(4, 6)}/${today.slice(6, 8)}`;
const { mod, mock, dataDir } = await importServer({ routes: [{
  match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
  reply: {
    stat: "OK",
    data: [[rocDate, "1,000,000", "100,000,000", "99", "101", "98", "100", "1", "500"]],
  },
}] });

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("fetchStockHistoryMonth：冷快取併發與後續讀取只抓一次", async () => {
  const [a, b] = await Promise.all([
    mod.fetchStockHistoryMonth("2330", "TWSE", month, "台積電"),
    mod.fetchStockHistoryMonth("2330", "TWSE", month, "台積電"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(a[0].close, 100);
  assert.equal(mock.callsFor(/exchangeReport\/STOCK_DAY\?/).length, 1);
  const cached = await mod.fetchStockHistoryMonth("2330", "TWSE", month, "台積電");
  assert.deepEqual(cached, a);
  assert.equal(mock.callsFor(/exchangeReport\/STOCK_DAY\?/).length, 1, "完成後應直接命中 TTL/LRU cache");
});
