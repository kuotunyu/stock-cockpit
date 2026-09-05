// 隔日沖長期成績單的信賴區間：以「日」為叢集。同一天選出的 40~60 檔共享大盤 beta，
// 把檔數當獨立樣本會嚴重高估精度；有效樣本數 ≈ 天數，用每日達成率的樣本標準差算標準誤。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

test("n<2 回 null；n≥2 的中心＝Σ達成÷Σ驗證（與畫面勝率同一個數），標準誤用日叢集穩健公式、臨界值用 t(n−1)，夾在 [0,1]", () => {
  assert.equal(mod.dayClusterCi([{ verified: 10, hitPlus2: 5 }], "hitPlus2"), null);
  const ci = mod.dayClusterCi([
    { verified: 10, hitPlus2: 5 },
    { verified: 10, hitPlus2: 7 },
    { verified: 20, hitPlus2: 12 },
    { verified: 10, hitPlus2: 6 },
  ], "hitPlus2");
  // p = 30/50 = 0.6；殘差 x_g − p·n_g = −1、1、0、0 → Σr² = 2；
  // Var = G/(G−1) · Σr² / (Σn)² = (4/3)·2/2500 = 0.0010667 → se 0.03266；t(3) = 3.182 → ±0.1039
  assert.equal(ci.n, 4);
  assert.equal(ci.mean, 0.6);
  assert.equal(ci.low, 0.4961);
  assert.equal(ci.high, 0.7039);
  assert.equal(ci.t, 3.182);

  // 舊算法（日等權平均）的反例：一個 60 檔的日子 15 勝、三個 5 檔的日子幾乎全勝。
  // 畫面顯示 29/75 = 38.7%，日等權卻算出中心 76%、下界 41.5% > 顯示值還會染成綠色。
  const skewed = mod.dayClusterCi([
    { verified: 60, hitPlus2: 15 }, { verified: 5, hitPlus2: 5 }, { verified: 5, hitPlus2: 4 }, { verified: 5, hitPlus2: 5 },
  ], "hitPlus2");
  assert.equal(skewed.mean, 0.3867, "中心必須等於畫面上的檔數加權勝率");
  assert.ok(skewed.low <= skewed.mean && skewed.mean <= skewed.high, JSON.stringify(skewed));
  assert.ok(skewed.low < 0.5, "下界不得高於顯示值、更不得越過 50% 染色門檻");

  const clamped = mod.dayClusterCi([
    { verified: 5, hitPlus2: 5 }, { verified: 5, hitPlus2: 5 }, { verified: 5, hitPlus2: 0 },
  ], "hitPlus2");
  assert.ok(clamped.high <= 1 && clamped.low >= 0, JSON.stringify(clamped));

  assert.equal(mod.dayClusterCi([{ verified: 0, hitPlus2: 0 }, { verified: 0, hitPlus2: 0 }], "hitPlus2"), null, "驗證數 0 的日子不算叢集");
  assert.equal(mod.dayClusterCi([], "hitPlus2"), null);
});

test("tQuantile975：小樣本比 1.96 寬，20 天用 t(19)=2.093，超過 120 自由度才回 1.96", () => {
  assert.equal(mod.tQuantile975(1), 12.706);
  assert.equal(mod.tQuantile975(19), 2.093);
  assert.equal(mod.tQuantile975(30), 2.042);
  assert.equal(mod.tQuantile975(45), 2.0);
  assert.equal(mod.tQuantile975(200), 1.96);
  assert.ok(Number.isNaN(mod.tQuantile975(0)));
});

test("常數：快照留存 260 個交易日、成績單最小 20 天才當結論", () => {
  assert.equal(mod.OVERNIGHT_SNAPSHOT_LIMIT, 260);
  assert.equal(mod.OVERNIGHT_MIN_DAYS, 20);
});
