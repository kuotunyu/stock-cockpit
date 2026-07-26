// D-11：回檔深度必須是「近 20 日高點 → 那個高點**之後**的最低價」。
// 舊寫法 recentHigh 取近 20 根、pullbackLow 取近 12 根，兩個視窗長度不同且沒有順序關係，
// 算出來的是區間振幅。實測 240 檔逐日回放 29,616 次：46.4% 的數值會變、門檻判定翻轉 4.60%，
// 例如 3481 群創 2026/05/25 由 41.65% 變成 0.00%（那天還在創新高，根本沒回檔過）。
//
// D-23：漲停鎖死的那根 K，收盤價掛不到單，而 plan.entry 取的正是當日收盤。
// ⚠ 漲停不是「漲幅 ≥9.5%」：漲停＝前收 ×1.1 再**向下**取到合法申報價位，
//   實測前收 99.5 → 漲停 109（+9.55%）、前收 990 → 1085（+9.60%）。
// ⚠ 也不是「收在漲停就買不到」：實測 3,571 個合格 pick 有 233 個收在漲停，
//   但其中 231 個盤中有開（high > low），整天都買得到。真正買不到的是一價鎖死（2 個）。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

// computeSwingFeatures 需要 ≥60 根。前 40 根固定在 100 當暖身，後面才是要測的形狀。
const build = (tail) => {
  const closes = [...Array(60 - tail.length).fill(100), ...tail];
  return mod.addPreviousClose(closes.map((close, index) => ({
    date: `2026/05/${String(index + 1).padStart(2, "0")}`,
    rawDate: `202605${String(index + 1).padStart(2, "0")}`,
    code: "9999", name: "測試", exchange: "TWSE",
    open: close, high: close + 0.5, low: close - 0.5, close,
    volumeLots: 1000, source: "TWSE STOCK_DAY",
  })));
};
const featuresOf = (tail) => mod.computeSwingFeatures(build(tail), [], { allowHeuristicFallback: false });

test("D-11 低點在高點之前 → 那不是回檔，不可算進深度", () => {
  // 近 20 根：先跌到 90（第 3 根）、再一路漲到 110（第 16 根）、今天收 108。
  // 舊算法：high 110、low 90（低點在高點之前）→ 深度 18.2%，還會把整段漲勢當成量測幅度。
  // 新算法：110 之後的最低價是 108 那幾根 → 深度只有個位數。
  const f = featuresOf([100, 95, 92, 90, 93, 97, 101, 105, 108, 110, 109.5, 109, 108.5, 108, 108, 108, 108, 108, 108, 108]);
  assert.ok(Math.abs(f.recentHigh - 110.5) < 1e-9, `近 20 日最高＝110 那根的 high（實際 ${f.recentHigh}）`);
  // 高點之後的最低價＝107.5（108 那幾根的 low），不是 89.5
  assert.ok(Math.abs(f.pullbackLow - 107.5) < 1e-9, `回檔低點要在高點之後（實際 ${f.pullbackLow}）`);
  const expected = ((110.5 - 107.5) / 110.5) * 100;
  assert.ok(Math.abs(f.pullbackDepthPct - expected) < 1e-9, `深度 ${expected.toFixed(2)}%（實際 ${f.pullbackDepthPct}）`);
  assert.ok(f.pullbackDepthPct < 3, "這檔沒有回檔 3%，不該通過中軌攻防的門檻");
});

test("D-11 還在創新高（高點是最後一根）→ 沒有完成的回檔，深度 0", () => {
  const f = featuresOf([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119]);
  assert.equal(f.pullbackDepthPct, 0, "還沒回檔就是 0，不是拿當日上影線充數");
  assert.equal(f.pullbackLow, null, "沒有完成的回檔 → 沒有回檔低點可言");
});

test("D-11 真的有回檔時照樣算得出來", () => {
  // 漲到 120（第 10 根）後回落到 110，今天 114
  const f = featuresOf([100, 104, 108, 112, 116, 120, 118, 115, 112, 110, 111, 112, 113, 114, 114, 114, 114, 114, 114, 114]);
  assert.ok(Math.abs(f.recentHigh - 120.5) < 1e-9);
  assert.ok(Math.abs(f.pullbackLow - 109.5) < 1e-9, `高點之後的最低價（實際 ${f.pullbackLow}）`);
  const expected = ((120.5 - 109.5) / 120.5) * 100;
  assert.ok(Math.abs(f.pullbackDepthPct - expected) < 1e-9);
  assert.ok(f.pullbackDepthPct >= 3, "9.1% 的回檔要過得了門檻");
});

test("量測幅度退化時退回 2R，不是讓目標等於進場價（rr=0）", () => {
  // 還在創新高 → 沒有回檔 → 量測幅度沒有定義。
  const f = featuresOf([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119]);
  const plan = mod.buildSwingPlan(f);
  assert.ok(plan.target > plan.entry, `目標必須高於進場（實際 目標 ${plan.target} / 進場 ${plan.entry}）`);
  assert.ok(Number.isFinite(plan.rr) && plan.rr > 0, `RR 不可以是 0（實際 ${plan.rr}）`);
  // 上方沒有壓力、量測幅度沒有定義 → 走 2R 兜底
  const risk = plan.entry - plan.structuralStop;
  assert.ok(Math.abs(plan.target - mod.roundToStockTick(plan.entry + risk * 2, "down")) < 1e-9,
    `應該退回 2R（實際 ${plan.target}）`);
});

// ---- D-23 ----
test("漲停價要反推，不能用「漲幅 ≥9.5%」近似", () => {
  // 低價股與高價股的漲停漲幅都不到 10%，剛好落在 9.5 附近 → 近似法會誤判。
  assert.equal(mod.stockLimitUpPrice(100), 110);
  assert.equal(mod.stockLimitUpPrice(99.5), 109, "99.5 的漲停是 109，只有 +9.55%");
  assert.equal(mod.stockLimitUpPrice(990), 1085, "990 的漲停是 1085，只有 +9.60%");
  assert.equal(mod.stockLimitUpPrice(10.05), 11.05);
  assert.equal(mod.stockLimitUpPrice(0), null);
  assert.equal(mod.stockLimitUpPrice(NaN), null);
});

test("一價鎖死才算買不到；盤中有開就不算", () => {
  const prev = { close: 100 };
  assert.equal(
    mod.isLimitUpLockedBar({ open: 110, high: 110, low: 110, close: 110 }, prev), true,
    "整天只有漲停一個價 → 掛不到單",
  );
  assert.equal(
    mod.isLimitUpLockedBar({ open: 104, high: 110, low: 103, close: 110 }, prev), false,
    "收在漲停但盤中有開 → 整天都買得到，不該標記（實測 233 個收漲停的 pick 裡 231 個是這種）",
  );
  assert.equal(
    mod.isLimitUpLockedBar({ open: 105, high: 105, low: 105, close: 105 }, prev), false,
    "一價到底但不是漲停 → 買得到",
  );
  assert.equal(
    mod.isLimitUpLockedBar({ open: 90, high: 90, low: 90, close: 90 }, prev), false,
    "跌停鎖死是賣不掉不是買不到，不歸這條管",
  );
  assert.equal(mod.isLimitUpLockedBar({ open: 110, high: 110, low: 110, close: 110 }, {}), false, "沒有前收就無從判斷");
});

test("漲停鎖死的標的不建立驗證單（否則勝率被灌水），但仍留在看板上", () => {
  const db = {};
  const pick = (over = {}) => ({
    code: "2330", name: "台積電", scenario: { key: "strongContinuation" },
    plan: { entry: 110, structuralStop: 99, target: 121 }, ...over,
  });
  mod.recordSwingVerification(db, {
    asOf: "2026-07-24", formulaVersion: "test-v1", coverage: { complete: true },
    picks: [pick({ fillRisk: "limit-up-locked" }), pick({ code: "2317", name: "鴻海" })],
  });
  const list = db.swingVerification?.["20260724"] || [];
  assert.equal(list.length, 1, "只有買得到的那一檔可以建立驗證單");
  assert.equal(list[0].code, "2317");
});

test("回檔幅度剛好是 0（跳空後一價到底停在高點）→ 仍須退回 2R", () => {
  // 高點 H 出現在第 12 根，之後每一根都是「只有 H 這一個成交價」的一價 K。
  // 於是「高點之後的最低價」＝H，回檔幅度剛好 0——不是 null。沒有 `> 0` 這道守衛的話，
  // 量測幅度會算成 entry + 0 = entry，目標等於進場價、rr = 0。
  const H = 110;
  const bars = [];
  for (let i = 0; i < 48; i += 1) bars.push({ open: 100, high: 100.5, low: 99.5, close: 100 });
  bars.push({ open: 105, high: H, low: 104, close: 108 });          // 第 48 根：本波最高 110
  for (let i = 0; i < 11; i += 1) bars.push({ open: H, high: H, low: H, close: H }); // 之後全部停在 110
  const rows = mod.addPreviousClose(bars.map((bar, index) => ({
    date: `2026/05/${String(index + 1).padStart(2, "0")}`,
    rawDate: `202605${String(index + 1).padStart(2, "0")}`,
    code: "9999", name: "測試", exchange: "TWSE",
    volumeLots: 1000, source: "TWSE STOCK_DAY", ...bar,
  })));
  const f = mod.computeSwingFeatures(rows, [], { allowHeuristicFallback: false });
  assert.ok(Math.abs(f.recentHigh - H) < 1e-9, `最高價＝${H}（實際 ${f.recentHigh}）`);
  assert.ok(Math.abs(f.pullbackLow - H) < 1e-9, `高點之後的最低價也是 ${H}（實際 ${f.pullbackLow}）`);
  assert.equal(f.pullbackDepthPct, 0, "幅度剛好 0");

  const plan = mod.buildSwingPlan(f);
  assert.ok(plan.target > plan.entry, `目標必須高於進場（實際 目標 ${plan.target} / 進場 ${plan.entry}）`);
  assert.ok(plan.rr > 0, `RR 不可以是 0（實際 ${plan.rr}）`);
});
