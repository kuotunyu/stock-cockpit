// 波段驗證推進被「兩市場資料日不同步」整個擋掉的回歸測試。
//
// 現場（2026-07-31 使用者實機資料）：106 筆 pending 有 99 筆卡在 20260716／20260727 動不了，
// 而官方月檔那幾天的 K 一直都在（現抓 2881 富邦金 202607 有 22 列、含 07/27~07/31）。
// 原因是 advanceSwingVerification 用 coverageComplete 當閘門，而 coverageComplete 要求
// twseDate === tpexDate——**上櫃例行性比上市早發布**，收盤後有一段時間上櫃已是 D+1、上市還在 D，
// 那段時間推進被整個擋掉，即使兩個市場對 D 的資料都完整。
//
// 這裡釘的是「可以安全推進到哪一天」的決策本身（純函式），不打網路。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

const market = (asOf, status = "fresh") => ({ asOf, status });

test("兩市場資料日對齊 → 照舊推進到那一天", () => {
  assert.equal(
    mod.swingAdvanceTargetDate(
      { coverageComplete: true, markets: { twse: market("2026-07-30"), tpex: market("2026-07-30") } },
      "20260730",
    ),
    "20260730",
  );
});

test("上櫃跑在前面（上市 D、上櫃 D+1）→ 推進到兩市場都涵蓋的 D，而不是整個不動", () => {
  // 這正是實機當下的狀態：TWSE 停在 07-30、TPEx 已跳 07-31。
  // resolveMarketCloseDate 取的是「最多檔數的那個日期」，上櫃檔數多（4281 vs 1361）→ 會回 20260731。
  const target = mod.swingAdvanceTargetDate(
    { coverageComplete: false, markets: { twse: market("2026-07-30"), tpex: market("2026-07-31") } },
    "20260731",
  );
  assert.equal(target, "20260730", "取較早的資料日：那一天兩個市場都已收盤且都涵蓋，推進到它不需要任何補齊");
});

test("上市跑在前面 → 一樣取較早的那一天（方向不可寫死）", () => {
  assert.equal(
    mod.swingAdvanceTargetDate(
      { coverageComplete: false, markets: { twse: market("2026-07-31"), tpex: market("2026-07-30") } },
      "20260731",
    ),
    "20260730",
  );
});

test("有市場是 last-good（stale）→ 仍然不推進", () => {
  // 這半是原本就正確的保護，不可因為放寬對齊而一起放掉：
  // last-good 是「上一次成功的資料」，拿它當今天的收盤會把舊 K 當新 K。
  assert.equal(
    mod.swingAdvanceTargetDate(
      { coverageComplete: false, markets: { twse: market("2026-07-30", "stale"), tpex: market("2026-07-30") } },
      "20260730",
    ),
    "",
  );
});

test("市場整個抓不到 → 不推進", () => {
  assert.equal(
    mod.swingAdvanceTargetDate(
      { coverageComplete: false, markets: { twse: market("", "unavailable"), tpex: market("2026-07-30") } },
      "20260730",
    ),
    "",
  );
});

test("覆蓋不完整又沒有可驗證的資料日 → 不推進（不可退回 latestDate 硬推）", () => {
  assert.equal(mod.swingAdvanceTargetDate({ coverageComplete: false, markets: {} }, "20260730"), "");
  assert.equal(mod.swingAdvanceTargetDate({ coverageComplete: false }, "20260730"), "");
});

test("沒有 latestDate → 不推進", () => {
  assert.equal(mod.swingAdvanceTargetDate({ coverageComplete: true }, ""), "");
  assert.equal(mod.swingAdvanceTargetDate({ coverageComplete: true }, null), "");
});

test("共同日比 latestDate 晚時取 latestDate（不得推過呼叫端要求的範圍）", () => {
  assert.equal(
    mod.swingAdvanceTargetDate(
      { coverageComplete: false, markets: { twse: market("2026-07-31"), tpex: market("2026-07-31") } },
      "20260730",
    ),
    "20260730",
  );
});

test("沒有帶 coverage 資訊的 reference 維持原行為（既有測試與呼叫端相依）", () => {
  // coverageComplete 為 undefined 時舊碼是放行的（`=== false` 才擋），有測試靠這個行為。
  assert.equal(mod.swingAdvanceTargetDate({}, "20260730"), "20260730");
  assert.equal(mod.swingAdvanceTargetDate(undefined, "20260730"), "20260730");
});
