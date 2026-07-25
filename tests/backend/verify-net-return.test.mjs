// D-20（第二層，採「毛淨並陳」方案）：驗證與回測的百分比原本全是未扣費稅的毛報酬，
// 而且全站零揭露。台股一買一賣約 0.471%（手續費 0.1425% × 0.6 折 × 2 邊 ＋ 賣出證交稅 3‰），
// 隔日沖的平均報酬本來就在 ±0.5% 這個量級——毛值 +0.35% 扣完成本其實是 −0.12%，正負號翻轉。
// 這裡釘住：毛值一律不動（既有測試與歷史快照不受影響），旁邊並陳伺服器算好的淨值。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("來回成本＝手續費（0.1425% × 0.6 折 × 2 邊）＋ 賣出證交稅 3‰", () => {
  // 隔日沖是「今日收盤買、次日賣」，不是現股當沖，所以用全額 3‰ 而非減半的 1.5‰。
  const expected = Math.round((0.001425 * 0.6 * 2 * 100 + 0.003 * 100) * 1000) / 1000;
  assert.equal(mod.VERIFY_ROUND_TRIP_COST_PCT, expected);
  assert.equal(mod.VERIFY_ROUND_TRIP_COST_PCT, 0.471);
});

test("netReturnPct：扣成本後的值，缺值不得變成 −0.471", () => {
  assert.equal(mod.netReturnPct(2), 1.53, "「達 +2%」實際淨值");
  assert.equal(mod.netReturnPct(0.35), -0.12, "毛值 +0.35% 扣完成本會翻成負的——這正是要揭露的原因");
  assert.equal(mod.netReturnPct(3), 2.53);
  assert.equal(mod.netReturnPct(0), -0.47, "roundTo 預設兩位小數，與全站顯示精度一致");
  assert.equal(mod.netReturnPct(null), null, "null 進 null 出");
  assert.equal(mod.netReturnPct(undefined), null);
  assert.equal(mod.netReturnPct(NaN), null);
});

test("揭露文字必須說清楚是估算，且點名未計最低手續費", () => {
  const note = mod.VERIFY_COST_NOTE;
  assert.match(note, /估算/);
  assert.match(note, /0\.471%/);
  assert.match(note, /最低 20 元/, "驗證單沒有股數，套不上每筆最低手續費，必須講明");
  assert.match(note, /滑價/, "盤中觸價假設全額成交，未計滑價也要揭露");
});
