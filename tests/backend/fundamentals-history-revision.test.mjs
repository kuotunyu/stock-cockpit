// 基本面持久化修訂：官方同一期數值更正時，記憶體回應與磁碟快照都必須原子更新。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday, fundamentalsRoutes, revenueRow, epsRowTwse,
  bwibbuRow, twt48uRow, twseCompanyProfileRow,
} from "../helpers/fixtures.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-fund-revision-"));

const yearMonth = (() => {
  const today = compactToday();
  const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
})();
const epsPeriod = `${compactToday().slice(0, 4)}Q1`;
const cachePath = join(dataDir, "fundamentals-cache.json");

await writeFile(cachePath, JSON.stringify({
  revenue: {
    2330: {
      [yearMonth]: { yearMonth, revenue: 100, mom: 1, yoy: 2, cumYoy: 3 },
    },
  },
  eps: {
    2330: {
      [epsPeriod]: { period: epsPeriod, eps: 1.25 },
    },
  },
  valuation: {},
  dividends: {},
}), "utf8");

let mod;
let mock;
before(async () => {
  ({ mod, mock } = await importServer({
    dataDir,
    routes: fundamentalsRoutes({
      twseRevenue: [revenueRow({ code: "2330", ymOff: -1, revenue: 200, mom: 4, yoy: 5, cumYoy: 6 })],
      twseEps: [epsRowTwse({ code: "2330", quarter: 1, eps: 2.5 })],
      bwibbu: [bwibbuRow({ code: "2330" })],
      twt48u: [twt48uRow({ code: "2330", exOff: 10 })],
      twseCompanyMeta: [twseCompanyProfileRow({ code: "2330", name: "台積電" })],
    }),
  }));
});

after(async () => {
  mock?.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("官方同一期修訂會覆蓋舊營收/EPS，且 build resolve 時已寫入磁碟", async () => {
  const result = await mod.buildFundamentals("2330");

  assert.equal(result.revenue.latest.yearMonth, yearMonth);
  assert.equal(result.revenue.latest.revenue, 200);
  assert.equal(result.revenue.stale, false);
  assert.equal(result.revenue.history.length, 1, "同一期修訂不得變成重複期數");
  assert.equal(result.revenue.history[0].revenue, 200, "response history 應立即反映修訂值");
  assert.equal(result.revenue.history[0].revision, 2, "修訂次數要保留稽核軌跡");
  assert.equal(result.eps.latest.period, epsPeriod);
  assert.equal(result.eps.latest.eps, 2.5);
  assert.equal(result.eps.stale, false);
  assert.equal(result.eps.history.length, 1, "同一季修訂不得變成重複期數");
  assert.equal(result.eps.history[0].eps, 2.5, "EPS history 應立即反映修訂值");
  assert.equal(result.eps.history[0].revision, 2, "EPS 修訂次數要保留稽核軌跡");
  assert.equal(result.freshness.revenue.status, "fresh");
  assert.equal(result.freshness.eps.status, "fresh");

  // 不輪詢：buildFundamentals resolve 即代表本輪 append 已耐久化，避免程序隨後結束而遺失。
  const disk = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(disk.revenue["2330"][yearMonth].revenue, 200);
  assert.equal(disk.revenue["2330"][yearMonth].revision, 2);
  assert.ok(Date.parse(disk.revenue["2330"][yearMonth].observedAt), "修訂要記錄觀察時間");
  assert.equal(disk.eps["2330"][epsPeriod].eps, 2.5);
  assert.equal(disk.eps["2330"][epsPeriod].revision, 2);
  assert.ok(Date.parse(disk.eps["2330"][epsPeriod].observedAt), "EPS 修訂要記錄觀察時間");
});
