// 整批收盤逐市場 last-good：到期後成功市場更新、失敗市場沿用，退化快取避免狂打上游。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

const realNow = Date.now;
let clock = Date.parse("2026-07-13T00:00:00Z");
Date.now = () => clock;
let phase = 0;
const { mod, mock, dataDir } = await importServer({
  routes: [
    {
      match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/,
      reply: () => [stockDayAllRow({ code: "2330", name: "台積電", close: phase ? 101 : 100 })],
    },
    {
      match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/,
      reply: () => {
        if (phase === 1) return { __error: "tpex maintenance" };
        if (phase === 2) return [];
        return [tpexDailyCloseRow({
          code: "5347", name: "世界", close: phase >= 3 ? 51 : 50,
          dateOff: phase === 3 ? -1 : 0,
        })];
      },
    },
  ],
});

after(async () => {
  Date.now = realNow;
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("TTL 後只沿用失敗市場的 last-good", async () => {
  const first = await mod.getReferenceData();
  assert.equal(first.coverageComplete, true);
  assert.equal(first.byCode.get("2330").price, 100);
  assert.equal(first.byCode.get("5347").price, 50);

  phase = 1;
  clock += 5 * 60 * 1000 + 1;
  const second = await mod.getReferenceData();
  assert.equal(second.byCode.get("2330").price, 101, "成功市場要更新，不可整包退回舊 aggregate");
  assert.equal(second.byCode.get("5347").price, 50, "失敗市場要保留 last-good");
  assert.deepEqual(second.counts, { twse: 1, tpex: 1 });
  assert.equal(second.markets.twse.status, "fresh");
  assert.equal(second.markets.tpex.status, "stale");
  assert.ok(second.warnings.some((warning) => warning.includes("上櫃") && warning.includes("沿用")));
  assert.equal(mock.callsFor(/STOCK_DAY_ALL/).length, 2);
  assert.equal(mock.callsFor(/tpex_mainboard_daily_close_quotes/).length, 2);

  const third = await mod.getReferenceData();
  assert.equal(third, second);
  assert.equal(mock.callsFor(/STOCK_DAY_ALL/).length, 2, "退化 aggregate 的短 TTL 內不可重打");
  assert.equal(mock.callsFor(/tpex_mainboard_daily_close_quotes/).length, 2);

  phase = 2;
  clock += 30 * 1000 + 1;
  const emptyPayload = await mod.getReferenceData();
  assert.equal(emptyPayload.byCode.get("5347").price, 50, "空陣列也要視為失敗，不可覆蓋 last-good");
  assert.equal(emptyPayload.markets.tpex.status, "stale");
  assert.equal(mock.callsFor(/STOCK_DAY_ALL/).length, 2, "仍新鮮的上市市場不用陪著重抓");
  assert.equal(mock.callsFor(/tpex_mainboard_daily_close_quotes/).length, 3);

  phase = 3;
  clock += 5 * 60 * 1000 + 1;
  const misaligned = await mod.getReferenceData();
  assert.equal(misaligned.coverageComplete, false, "兩端點都成功但資料日不同仍是 provisional");
  assert.equal(misaligned.markets.twse.status, "fresh");
  assert.equal(misaligned.markets.tpex.status, "fresh");
  assert.ok(misaligned.warnings.some((warning) => warning.includes("資料日尚未對齊")));

  phase = 4;
  clock += 30 * 1000 + 1;
  const recovered = await mod.getReferenceData();
  assert.equal(recovered.coverageComplete, true, "落後市場短 TTL 後補齊應自動恢復完整狀態");
  assert.equal(recovered.byCode.get("5347").price, 51);
});
