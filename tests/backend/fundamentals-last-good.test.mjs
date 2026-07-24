// 基本面冷啟 last-good：上游空資料或失敗時，四個維度都沿用持久化資料並明確警告。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, fundamentalsRoutes, twseCompanyProfileRow } from "../helpers/fixtures.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-fund-last-good-"));

const yearMonth = (() => {
  const today = compactToday();
  const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
})();
const epsPeriod = `${compactToday().slice(0, 4)}Q1`;
const valuationAsOf = compactToday(-1);
const exDate = compactToday(10);

await writeFile(join(dataDir, "fundamentals-cache.json"), JSON.stringify({
  revenue: {
    2330: {
      [yearMonth]: { yearMonth, revenue: 416975163, mom: 1.52, yoy: 30.09, cumYoy: 25.31 },
    },
  },
  eps: {
    2330: {
      [epsPeriod]: { period: epsPeriod, eps: 22.08 },
    },
  },
  valuation: {
    2330: {
      [valuationAsOf]: {
        asOf: valuationAsOf, pe: 33.68, dividendYield: 0.88, pbr: 11.03, dps: null,
      },
    },
  },
  dividends: {
    2330: {
      [exDate]: { kind: "除息", cashDividend: 4.5, stockRatio: 0 },
    },
  },
}), "utf8");

let mod;
let mock;
before(async () => {
  ({ mod, mock } = await importServer({
    dataDir,
    routes: fundamentalsRoutes({
      // 同一輪同時涵蓋「官方成功但空資料」與「網路失敗」兩種事故形狀。
      twseRevenue: [],
      tpexRevenue: [],
      twseEps: { __error: "EPS upstream offline" },
      tpexEps: [],
      bwibbu: [],
      tpexPeratio: { __error: "valuation upstream offline" },
      twt48u: [],
      tpexExright: [],
      twseCompanyMeta: [twseCompanyProfileRow({ code: "2330", name: "台積電" })],
    }),
  }));
});

after(async () => {
  mock?.restore();
  await rm(dataDir, { recursive: true, force: true });
});

function assertSavedFallbackWarning(warnings, label) {
  const warning = warnings.find((item) => item.includes(label));
  assert.ok(warning, `${label} fallback 應有 warning`);
  assert.match(warning, /已沿用本機最後保存/, `${label} warning 要說清楚資料來源與陳舊性`);
}

test("process 冷啟且上游空/失敗時，四維度沿用 fundamentals-cache 最後一份", async () => {
  const result = await mod.buildFundamentals("2330");

  assert.equal(result.revenue.latest.yearMonth, yearMonth);
  assert.equal(result.revenue.latest.revenue, 416975163);
  assert.equal(result.revenue.history[0].revenue, 416975163);
  assert.equal(result.revenue.stale, true);
  assert.equal(result.eps.latest.period, epsPeriod);
  assert.equal(result.eps.latest.eps, 22.08);
  assert.equal(result.eps.stale, true);
  assert.equal(result.valuation.asOf, valuationAsOf);
  assert.equal(result.valuation.pe, 33.68);
  assert.equal(result.valuation.dividendYield, 0.88);
  assert.equal(result.valuation.pbr, 11.03);
  assert.equal(result.valuation.dps, null);
  assert.equal(result.valuation.stale, true);
  assert.equal(result.dividends.length, 1);
  assert.equal(result.dividends[0].exDate, exDate);
  assert.equal(result.dividends[0].kind, "除息");
  assert.equal(result.dividends[0].cashDividend, 4.5);
  assert.equal(result.dividends[0].stockRatio, 0);
  assert.deepEqual(result.freshness, {
    revenue: { status: "stale", asOf: yearMonth },
    eps: { status: "stale", asOf: epsPeriod },
    valuation: { status: "stale", asOf: valuationAsOf },
    dividends: { status: "stale", asOf: exDate },
  });

  assertSavedFallbackWarning(result.warnings, "月營收");
  assertSavedFallbackWarning(result.warnings, "EPS");
  assertSavedFallbackWarning(result.warnings, "本益比／殖利率");
  assertSavedFallbackWarning(result.warnings, "除權息");
});
