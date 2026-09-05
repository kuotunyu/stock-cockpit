// 事件日曆與市場寬度（純函式）：期指最後結算日＝第三個星期三（遇休市順延）、月營收截止 10 日、
// 季報截止四個日期；漲跌家數只算資料日等於基準日的列。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

test("thirdWednesday：2026-09 是 09/16、2026-10 是 10/21、2026-12 是 12/16", () => {
  assert.equal(mod.thirdWednesday(2026, 9), "20260916");
  assert.equal(mod.thirdWednesday(2026, 10), "20261021");
  assert.equal(mod.thirdWednesday(2026, 12), "20261216");
});

test("upcomingMarketEvents：7 天窗、只列未來、休市順延到次一營業日、跨月與跨年", () => {
  const events = mod.upcomingMarketEvents("20260910", [], 7);
  assert.deepEqual(events.map((e) => [e.date, e.kind]), [["20260916", "settlement"]], "09/10 當天的營收截止不算未來");
  const rolled = mod.upcomingMarketEvents("20260910", [{ date: "20260916", name: "測試休市", description: "" }], 7);
  assert.deepEqual(rolled.map((e) => e.date), ["20260917"], "結算日遇休市順延");
  const monthEnd = mod.upcomingMarketEvents("20261007", [], 7);
  assert.deepEqual(monthEnd.map((e) => [e.date, e.kind]), [["20261012", "revenue"]], "10/10 是週六 → 順延到 10/12（週一）");
  const yearEnd = mod.upcomingMarketEvents("20261228", [], 7);
  assert.deepEqual(yearEnd.map((e) => e.kind), [], "12/28～01/04 沒有事件（1/10 在窗外）");
  const q1 = mod.upcomingMarketEvents("20260512", [], 7);
  assert.ok(q1.some((e) => e.kind === "report" && e.date === "20260515"), JSON.stringify(q1));
  assert.deepEqual(mod.upcomingMarketEvents("", [], 7), []);
});

test("summarizeMarketBreadth：只算資料日等於基準日、有昨收的列；平盤不算漲跌", () => {
  const quotes = [
    { code: "1101", name: "台泥", change: 1, previousClose: 100, rawDate: "20260904" },
    { code: "2201", name: "裕隆", change: -0.5, previousClose: 50, rawDate: "20260904" },
    { code: "3301", name: "泰安", change: 0, previousClose: 20, rawDate: "20260904" },
    { code: "4401", name: "勤益", change: 3, previousClose: 30, rawDate: "20260903" }, // 落後市場的舊價不算
    { code: "5501", name: "祥豐", change: null, previousClose: null, rawDate: "20260904" }, // 除權息日還沒補參考價
    // 非普通股不進分母：債券 ETF 近百檔跟利率同向，升息日整批下跌會把「漲跌家數」拉偏
    { code: "0050", name: "元大台灣50", change: 1, previousClose: 100, rawDate: "20260904" },
    { code: "00679B", name: "元大美債20年", change: -0.1, previousClose: 30, rawDate: "20260904" },
    { code: "2002A", name: "中鋼特", change: 0.5, previousClose: 20, rawDate: "20260904" },
    { code: "910322", name: "康師傅-DR", change: -1, previousClose: 10, rawDate: "20260904" },
  ];
  assert.deepEqual(mod.summarizeMarketBreadth(quotes, "20260904"), { up: 1, down: 1, flat: 1, total: 3, upRatio: 0.3333 });
  assert.deepEqual(mod.summarizeMarketBreadth([], "20260904"), { up: 0, down: 0, flat: 0, total: 0, upRatio: null });
});
