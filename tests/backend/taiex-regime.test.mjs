// 大盤 regime（加權指數 vs MA20／MA60）：只做成績單分層，不做選股濾網（濾網會改選股→升版）。
// 資料來源是 TWSE rwd FMTQIK 逐月（同一族端點 TWT49U 已實測可用），民國日期＋千分位指數。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

test("parseTaiexMonthlyPayload：民國日期與千分位指數；stat 非 OK 視為抓取失敗", () => {
  const rows = mod.parseTaiexMonthlyPayload({
    stat: "OK",
    data: [
      ["115/09/01", "5,000,000", "300,000,000", "1,000", "24,123.45", "+12.30"],
      ["115/09/02", "1", "1", "1", "24,200.00", "76.55"],
      ["", "", "", "", "", ""],
    ],
  });
  assert.deepEqual(rows, [{ date: "20260901", close: 24123.45 }, { date: "20260902", close: 24200 }]);
  assert.throws(() => mod.parseTaiexMonthlyPayload({ stat: "很抱歉，沒有符合條件的資料!" }), /加權指數/);
  assert.throws(() => mod.parseTaiexMonthlyPayload({ stat: "OK" }), /加權指數/);
});

test("taiexRegime：不足 60 根回 null；足夠時算 MA20／MA60 與位階；asOf 之後的列不可用", () => {
  // 70 根、每根 +10：close_i = 20000 + 10i
  const rows = [...Array(70)].map((_, i) => ({
    date: `2026${String(Math.floor(i / 28) + 6).padStart(2, "0")}${String((i % 28) + 1).padStart(2, "0")}`,
    close: 20000 + i * 10,
  }));
  assert.equal(mod.taiexRegime(rows.slice(0, 59), "20261231"), null);
  const regime = mod.taiexRegime(rows, rows.at(-1).date);
  assert.equal(regime.asOf, rows.at(-1).date);
  assert.equal(regime.close, 20690);
  // MA60 ＝ (20100 + 20690) / 2 ＝ 20395；MA20 ＝ (20500 + 20690) / 2 ＝ 20595
  assert.equal(regime.ma60, 20395);
  assert.equal(regime.ma20, 20595);
  assert.equal(regime.aboveMa20, true);
  assert.equal(regime.aboveMa60, true);
  const older = mod.taiexRegime(rows, rows[64].date);
  assert.equal(older.close, 20640, "asOf 之後的列不可用");
  assert.equal(older.asOf, rows[64].date);
  // 下跌序列：位階在均線下
  const falling = rows.map((row, i) => ({ date: row.date, close: 30000 - i * 10 }));
  const bear = mod.taiexRegime(falling, falling.at(-1).date);
  assert.equal(bear.aboveMa60, false);
  assert.equal(bear.aboveMa20, false);
});

test("regimeBucket：把 regime 對應到成績單分層鍵，缺值一律 unknown", () => {
  assert.equal(mod.regimeBucket({ aboveMa60: true }), "aboveMa60");
  assert.equal(mod.regimeBucket({ aboveMa60: false }), "belowMa60");
  assert.equal(mod.regimeBucket(null), "unknown");
  assert.equal(mod.regimeBucket({}), "unknown");
});
