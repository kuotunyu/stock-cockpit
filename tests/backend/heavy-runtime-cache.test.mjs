import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday,
  fundamentalsRoutes,
  stockDayAllRow,
  surveillanceRoutes,
  tpexDailyCloseRow,
} from "../helpers/fixtures.mjs";

const today = compactToday();
const overrides = {
  // 只放 ETF：保留完整 reference 資料流，但 maxCandidates=0 時不會跑逐檔歷史。
  reference: [stockDayAllRow({ code: "0050", name: "元大台灣50" })],
  tpexReference: [tpexDailyCloseRow({ code: "00679B", name: "元大美債20年" })],
};
const { mod, mock, dataDir } = await importServer({
  routes: [
    ...surveillanceRoutes(overrides),
    ...fundamentalsRoutes({}),
  ],
});

after(async () => {
  // getRiskSets 會以 fire-and-forget 落地 last-good；等它完成再移除臨時目錄。
  await new Promise((resolve) => setTimeout(resolve, 25));
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("overnight：同 key 併發共用 single-flight，TTL cache 會命中且超過上限淘汰舊 key", async () => {
  const base = { dateCompact: today, maxCandidates: 0, persistSnapshot: false };
  const [first, concurrent] = await Promise.all([
    mod.buildOvernightSignals({ ...base, maxPerGroup: 1 }),
    mod.buildOvernightSignals({ ...base, maxPerGroup: 1 }),
  ]);
  assert.strictEqual(concurrent, first, "同 key 併發應收到同一個 in-flight 結果");
  assert.strictEqual(await mod.buildOvernightSignals({ ...base, maxPerGroup: 1 }), first, "TTL 內應命中 cache");

  for (let key = 2; key <= mod.OVERNIGHT_CACHE_MAX_ENTRIES + 1; key += 1) {
    await mod.buildOvernightSignals({ ...base, maxPerGroup: key });
  }
  const afterEviction = await mod.buildOvernightSignals({ ...base, maxPerGroup: 1 });
  assert.notStrictEqual(afterEviction, first, "容量滿時必須淘汰最舊 overnight key");
});

test("backtest：同 days 併發共用 single-flight，並使用 bounded TTL cache", async () => {
  const [first, concurrent] = await Promise.all([
    mod.buildBacktest({ days: 10 }),
    mod.buildBacktest({ days: 10 }),
  ]);
  assert.strictEqual(concurrent, first, "同 days 回測不可重複計算");
  assert.strictEqual(await mod.buildBacktest({ days: 10 }), first, "TTL 內應命中回測 cache");

  for (let offset = 1; offset <= mod.BACKTEST_CACHE_MAX_ENTRIES; offset += 1) {
    await mod.buildBacktest({ days: 10 + offset });
  }
  const afterEviction = await mod.buildBacktest({ days: 10 });
  assert.notStrictEqual(afterEviction, first, "容量滿時必須淘汰最舊 backtest key");
});
