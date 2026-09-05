// 隔日沖長期成績單的信賴區間：以「日」為叢集。同一天選出的 40~60 檔共享大盤 beta，
// 把檔數當獨立樣本會嚴重高估精度；有效樣本數 ≈ 天數，用每日達成率的樣本標準差算標準誤。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

test("n<2 回 null；n≥2 用每日達成率的樣本標準差算 95% 區間並夾在 [0,1]", () => {
  assert.equal(mod.dayClusterCi([{ verified: 10, hitPlus2: 5 }], "hitPlus2"), null);
  const ci = mod.dayClusterCi([
    { verified: 10, hitPlus2: 5 },
    { verified: 10, hitPlus2: 7 },
    { verified: 20, hitPlus2: 12 },
    { verified: 10, hitPlus2: 6 },
  ], "hitPlus2");
  // 日率：0.5、0.7、0.6、0.6 → mean 0.6；樣本變異 = (0.01+0.01+0+0)/3 → sd 0.08165；se 0.04082 → ±0.08
  assert.equal(ci.n, 4);
  assert.equal(ci.mean, 0.6);
  assert.equal(ci.low, 0.52);
  assert.equal(ci.high, 0.68);

  const clamped = mod.dayClusterCi([
    { verified: 5, hitPlus2: 5 }, { verified: 5, hitPlus2: 5 }, { verified: 5, hitPlus2: 0 },
  ], "hitPlus2");
  assert.ok(clamped.high <= 1 && clamped.low >= 0, JSON.stringify(clamped));

  assert.equal(mod.dayClusterCi([{ verified: 0, hitPlus2: 0 }, { verified: 0, hitPlus2: 0 }], "hitPlus2"), null, "驗證數 0 的日子不算叢集");
  assert.equal(mod.dayClusterCi([], "hitPlus2"), null);
});

test("常數：快照留存 260 個交易日、成績單最小 20 天才當結論", () => {
  assert.equal(mod.OVERNIGHT_SNAPSHOT_LIMIT, 260);
  assert.equal(mod.OVERNIGHT_MIN_DAYS, 20);
});
