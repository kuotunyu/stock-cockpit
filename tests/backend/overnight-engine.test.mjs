// 隔日沖訊號引擎本體：computeMetrics（均線/量比/收盤位置手算）、evaluateGroups 三型態門檻
// 恰過/恰不過、score* 手算釘值＋單調性、nextDayPerformance ±2% 邊界。全純函式。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer());
});

// 21 根合成日K：前 20 根平盤（收 100、高 101、低 99、量 1000），最後一根噴出
// （開 101 收 105、高 106、低 100、量 3000）——所有指標都可手算。
function flatThenPop(overridesLast = {}) {
  const rows = [];
  for (let i = 0; i < 20; i += 1) {
    rows.push({
      date: `2026/06/${String(i + 1).padStart(2, "0")}`, code: "2330", name: "台積電",
      exchange: "TWSE", source: "test", open: 100, high: 101, low: 99, close: 100,
      volumeLots: 1000, tradeValue: 100_000_000, transactions: 500,
    });
  }
  rows.push({
    date: "2026/06/21", code: "2330", name: "台積電", exchange: "TWSE", source: "test",
    open: 101, high: 106, low: 100, close: 105, volumeLots: 3000,
    tradeValue: 315_000_000, transactions: 900, ...overridesLast,
  });
  return rows;
}

test("computeMetrics：21 根手算——MA5/MA20、量比（分母不含今天）、收盤位置、漲幅、振幅", () => {
  const m = mod.computeMetrics(flatThenPop());
  assert.equal(m.previousClose, 100);
  assert.equal(m.change, 5);
  assert.equal(m.changePct, 5);
  assert.equal(m.ma5, (100 * 4 + 105) / 5, "MA5 含今天 = 101");
  assert.equal(m.ma20, (100 * 19 + 105) / 20, "MA20 含今天 = 100.25");
  assert.equal(m.volumeRatio5, 3, "量比5 = 今量 3000 ÷ 前五日均量 1000（不含今天）");
  assert.equal(m.volumeRatio20, 3);
  assert.equal(m.closePosition, (105 - 100) / (106 - 100), "收盤位置 = (收−低)/(高−低)");
  assert.equal(m.amplitudePct, ((106 - 100) / 100) * 100, "振幅以昨收為分母 = 6%");
});

test("computeMetrics：一價到底（high==low）→ 收盤位置視為 1；不足 21 根 → null", () => {
  const flat = mod.computeMetrics(flatThenPop({ open: 105, high: 105, low: 105, close: 105 }));
  assert.equal(flat.closePosition, 1);
  assert.equal(mod.computeMetrics(flatThenPop().slice(0, 20)), null);
});

// evaluateGroups 只讀 metrics 欄位 → 直接手造物件打門檻邊界。
// base 刻意讓「只有強勢續攻」命中（open>close 擋掉回檔轉強、量比<3 擋掉爆量高危）。
const base = {
  changePct: 4, volumeRatio5: 2, volumeRatio20: 1.5, closePosition: 0.8,
  ma5: 100, ma20: 99, amplitudePct: 4, close: 105, open: 106,
};
const groupsOf = (m) => mod.evaluateGroups(m).map((g) => g.group);

test("evaluateGroups：強勢續攻五條件同時成立才命中（base 恰好只中這組）", () => {
  assert.deepEqual(groupsOf(base), ["strongContinuation"]);
});

test("evaluateGroups：門檻恰過／恰不過（漲幅 3%、收盤位置 0.7、量比 1.5、站上均線）", () => {
  assert.deepEqual(groupsOf({ ...base, changePct: 3 }), ["strongContinuation"], "漲幅恰 3% 過");
  assert.deepEqual(groupsOf({ ...base, changePct: 2.99 }), [], "2.99% 差一點就不算");
  assert.deepEqual(groupsOf({ ...base, changePct: 9.5 }), ["strongContinuation"], "上限恰 9.5% 過");
  assert.deepEqual(groupsOf({ ...base, changePct: 9.51 }), [], "超過 9.5%（近漲停）不追");
  assert.deepEqual(groupsOf({ ...base, closePosition: 0.7 }), ["strongContinuation"]);
  assert.deepEqual(groupsOf({ ...base, closePosition: 0.69 }), []);
  assert.deepEqual(groupsOf({ ...base, volumeRatio5: 1.5 }), ["strongContinuation"]);
  assert.deepEqual(groupsOf({ ...base, volumeRatio5: 1.49 }), []);
  assert.deepEqual(groupsOf({ ...base, close: 98.9 }), [], "跌破 MA20 不算");
});

test("evaluateGroups：任一必要指標非數值 → 整組不評（防 NaN 混入）", () => {
  assert.deepEqual(groupsOf({ ...base, volumeRatio20: NaN }), []);
  assert.deepEqual(groupsOf({ ...base, ma20: null }), []);
});

test("evaluateGroups＋scoreDanger：爆量高危（收盤轉弱路徑）＋分數手算 = 89", () => {
  const danger = {
    changePct: 6, volumeRatio5: 5, volumeRatio20: 2, closePosition: 0.5,
    ma5: 100, ma20: 99, amplitudePct: 5, close: 105, open: 106,
  };
  assert.deepEqual(groupsOf(danger), ["volumeDanger"]);
  // min(30,6×4)=24 + min(30,5×8→30)=30 + min(20,5×2)=10 + 收盤<0.55→15 + 量比≥5→10 = 89
  assert.equal(mod.scoreDanger(danger), 89);
});

test("evaluateGroups＋scoreReversal：回檔轉強（紅K站回短均）＋分數手算 = 69", () => {
  const reversal = {
    changePct: 2, volumeRatio5: 1, volumeRatio20: 1, closePosition: 0.7,
    ma5: 100, ma20: 102, amplitudePct: 3, close: 101, open: 100,
  };
  assert.deepEqual(groupsOf(reversal), ["pullbackReversal"]);
  // min(20,2×5)=10 + 紅K18 + min(22,0.7×22)=15.4 + 站回MA5→20 + MA20 沒站上→0 + min(15,1×6)=6 → round(69.4)=69
  assert.equal(mod.scoreReversal(reversal), 69);
});

test("scoreStrong：手算 = 49；漲幅/量比/收盤位置越高分數不減（單調性）", () => {
  // min(35,(4−3)×7)=7 + min(25,(2−1.5)×12)=6 + min(20,0.8×20)=16 + 站上MA5 10 + MA20 10 = 49
  assert.equal(mod.scoreStrong(base), 49);
  assert.ok(mod.scoreStrong({ ...base, changePct: 8 }) >= mod.scoreStrong(base));
  assert.ok(mod.scoreStrong({ ...base, volumeRatio5: 4 }) >= mod.scoreStrong(base));
  assert.ok(mod.scoreStrong({ ...base, closePosition: 0.95 }) >= mod.scoreStrong(base));
});

test("nextDayPerformance：以訊號日收盤為基準；達標看最高、破線看最低（恰 ±2% 算命中）", () => {
  const history = [
    { close: 100 },
    { open: 101, high: 102, low: 98, close: 99.5, date: "2026/06/22" },
  ];
  const perf = mod.nextDayPerformance(history, 0);
  assert.equal(perf.openReturn, 1);
  assert.equal(perf.highReturn, 2);
  assert.equal(perf.hitPlus2, true, "恰好 +2% 算達標（>=）");
  assert.equal(perf.lowReturn, -2);
  assert.equal(perf.brokeMinus2, true, "恰好 -2% 算破線（<=）");
  assert.equal(perf.closeReturn, -0.5);
  // 差一點就不算
  const near = mod.nextDayPerformance([{ close: 100 }, { open: 100, high: 101.9, low: 98.1, close: 100 }], 0);
  assert.equal(near.hitPlus2, false);
  assert.equal(near.brokeMinus2, false);
});

test("nextDayPerformance：最後一根沒有隔日、訊號日無收盤 → null", () => {
  assert.equal(mod.nextDayPerformance([{ close: 100 }], 0), null);
  assert.equal(mod.nextDayPerformance([{ close: 0 }, { open: 1, high: 1, low: 1, close: 1 }], 0), null);
});
