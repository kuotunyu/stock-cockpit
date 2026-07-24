// 技術分析數學：EMA／SMA／MACD／擺動點／趨勢線／費波／訊號／ATR（手算小向量驗證）。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer();
const {
  emaSeries, movingAverageSeries, computeMacd, findSwingPoints,
  buildTrendLine, buildFibonacci, buildTechnicalSignals, averageTrueRange,
} = mod;

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("emaSeries：span 3（multiplier 0.5）手算", () => {
  // prev=2 → 4*0.5+2*0.5=3 → 6*0.5+3*0.5=4.5
  assert.deepEqual(emaSeries([2, 4, 6], 3), [2, 3, 4.5]);
});

test("emaSeries：非數值沿用前值", () => {
  assert.deepEqual(emaSeries([2, null, 4], 3), [2, 2, 3]);
  assert.deepEqual(emaSeries([NaN, 2], 3), [null, 2]); // 開頭非數值 → null
});

test("movingAverageSeries：SMA(3)", () => {
  const rows = [1, 2, 3, 4, 5].map((v) => ({ v }));
  assert.deepEqual(movingAverageSeries(rows, "v", 3), [null, null, 2, 3, 4]);
});

test("computeMacd：常數序列 → dif/dea/histogram 全 0", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, close: 100 }));
  const macd = computeMacd(rows);
  for (const row of macd) {
    near(row.dif, 0);
    near(row.dea, 0);
    near(row.histogram, 0);
  }
});

test("computeMacd：上升趨勢尾端 dif > 0（快線在慢線上）且參數 8/17/9", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ date: `d${i}`, close: 100 + i }));
  const macd = computeMacd(rows); // 預設 8/17/9
  const last = macd.at(-1);
  assert.ok(last.dif > 0);
  assert.ok(last.dea > 0);
  // 與顯式參數版本一致（證明預設值 8/17/9）
  const explicit = computeMacd(rows, 8, 17, 9);
  near(last.dif, explicit.at(-1).dif);
});

test("findSwingPoints：鋸齒的峰與谷（windowSize 2）", () => {
  const highs = [5, 6, 7, 20, 7, 6, 5];
  const lows = [10, 9, 8, 1, 8, 9, 10];
  const rows = highs.map((h, i) => ({ date: `d${i}`, high: h, low: lows[i] }));
  const swings = findSwingPoints(rows, 2);
  assert.equal(swings.highs.length, 1);
  assert.equal(swings.highs[0].index, 3);
  assert.equal(swings.highs[0].price, 20);
  assert.equal(swings.lows.length, 1);
  assert.equal(swings.lows[0].index, 3);
  assert.equal(swings.lows[0].price, 1);
});

test("buildTrendLine：取最後兩點的斜率／截距／末端投影", () => {
  const points = [{ index: 0, price: 100 }, { index: 10, price: 110 }];
  const line = buildTrendLine(points, "support", 20);
  near(line.slope, 1);
  near(line.intercept, 100);
  near(line.valueAtLast, 120);
  assert.equal(line.type, "support");
});

test("buildTrendLine：點不足或同 index → null", () => {
  assert.equal(buildTrendLine([{ index: 0, price: 100 }], "support", 5), null);
  assert.equal(buildTrendLine([{ index: 3, price: 1 }, { index: 3, price: 2 }], "support", 5), null);
});

test("buildFibonacci：高 200 低 100 → 0.382/0.5/0.618 水準；收盤貼 0.5 → observation", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    date: `d${i}`, high: 120 + i, low: 95, close: 118 + i,
  }));
  rows[15].high = 200;             // 波段高點
  rows[19].close = 150;            // 收盤剛好在 0.5 回撤
  const swings = { lows: [{ index: 5, date: "d5", price: 100 }], highs: [] };
  const fib = buildFibonacci(rows, swings, true);
  assert.equal(fib.active, true);
  assert.equal(fib.swingHigh.price, 200);
  assert.equal(fib.swingLow.price, 100);
  near(fib.levels[0].price, 200 - 100 * 0.382); // 161.8
  near(fib.levels[1].price, 150);               // 0.5
  near(fib.levels[2].price, 200 - 100 * 0.618); // 138.2
  assert.equal(fib.observation.ratio, 0.5);
});

test("buildFibonacci：無突破或資料不足 → inactive", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, high: 110, low: 100, close: 105 }));
  const swings = { lows: [{ index: 5, price: 100 }], highs: [] };
  assert.equal(buildFibonacci(rows, swings, false).active, false);
  assert.equal(buildFibonacci(rows.slice(0, 5), swings, true).active, false);
});

// ---- buildTechnicalSignals：人工排列 rows/macd/ma 強迫特定訊號 ----
function baseRows(n = 25) {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${i}`, open: 99, close: 100, high: 101, low: 98, volumeLots: 1000,
  }));
}
const flatMa = (n, v) => Array.from({ length: n }, () => v);
const flatMacd = (n) => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, dif: 0, dea: 0, histogram: 0 }));
const noSwings = { highs: [], lows: [] };

test("signals：MACD 負轉正＋放量＋站上均線（無趨勢線 → 不判突破）", () => {
  const rows = baseRows();
  const last = rows.at(-1);
  last.close = 105; last.open = 104; last.volumeLots = 3000; // 放量、收高
  const macd = flatMacd(rows.length);
  macd.at(-2).histogram = -0.1;
  macd.at(-1).histogram = 0.2; // 負轉正
  const out = buildTechnicalSignals(rows, macd, flatMa(rows.length, 101), flatMa(rows.length, 102), noSwings, null, null);
  assert.equal(out.checks.histogramTurnPositive, true);
  assert.equal(out.checks.volumeAbove20, true);
  assert.equal(out.checks.aboveMovingAverages, true);
  assert.equal(out.breakout, false); // 沒給壓力線
  assert.equal(out.longWatch, false); // longWatch 需要 breakout
  assert.ok(out.signals.includes("MACD 負轉正"));
  assert.ok(out.signals.includes("成交量大於 20 日均量"));
  assert.ok(out.signals.includes("站上短中期均線"));
});

test("signals：風險面——柱狀圖連縮＋跌破前低＋放量長黑", () => {
  const rows = baseRows();
  const prev = rows.at(-2);
  const last = rows.at(-1);
  prev.close = 100;
  last.open = 100; last.close = 90; last.high = 101; last.low = 89; last.volumeLots = 5000; // 長黑 -10%、爆量
  const macd = flatMacd(rows.length);
  macd.at(-3).histogram = 0.5;
  macd.at(-2).histogram = 0.3;
  macd.at(-1).histogram = 0.1; // 連續縮小
  const swings = { highs: [], lows: [{ index: 10, date: "d10", price: 95 }] }; // 前低 95 > 收盤 90
  const out = buildTechnicalSignals(rows, macd, flatMa(rows.length, 999), flatMa(rows.length, 999), swings, null, null);
  assert.equal(out.checks.histogramShrinking, true);
  assert.equal(out.checks.brokePreviousSwingLow, true);
  assert.equal(out.checks.longBlackVolume, true);
  assert.ok(out.risks.includes("MACD 柱狀圖連續縮小"));
  assert.ok(out.risks.includes("跌破前一個波段低點"));
  assert.ok(out.risks.includes("放量長黑K"));
});

test("signals：突破壓力線 → breakout＋longWatch 條件齊備", () => {
  const rows = baseRows();
  const prev = rows.at(-2);
  const last = rows.at(-1);
  prev.close = 100;
  last.close = 110; last.open = 106; last.volumeLots = 4000;
  const macd = flatMacd(rows.length);
  macd.at(-2).histogram = -0.05;
  macd.at(-1).histogram = 0.3;
  // 壓力線水平 105：前一根 100 ≤ 105、最後一根 110 > 105 → 突破
  const resistance = { slope: 0, intercept: 105 };
  const out = buildTechnicalSignals(rows, macd, flatMa(rows.length, 101), flatMa(rows.length, 102), noSwings, null, resistance);
  assert.equal(out.breakout, true);
  assert.equal(out.longWatch, true);
  assert.ok(out.signals.includes("突破壓力線"));
});

test("averageTrueRange：含跳空的 TR 手算", () => {
  const rows = [
    { high: 10, low: 8, close: 9 },   // TR = 2
    { high: 12, low: 9, close: 11 },  // TR = max(3, |12-9|, |9-9|) = 3
    { high: 11, low: 7, close: 8 },   // TR = max(4, |11-11|, |7-11|) = 4
  ];
  near(averageTrueRange(rows, 14), 3); // (2+3+4)/3
  assert.equal(averageTrueRange([{ high: 1, low: 0, close: 1 }], 14), null); // <2 根
});
