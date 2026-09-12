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

test("regimeStamp：除了兩個布林，還存與均線的距離（日後可用 ±1% 遲滯或連續 N 日重切，不必重抓歷史）", () => {
  const stamp = mod.regimeStamp({ asOf: "20260905", close: 20690, ma20: 20595, ma60: 20395, aboveMa20: true, aboveMa60: true });
  assert.deepEqual(stamp, { asOf: "20260905", aboveMa20: true, aboveMa60: true, distMa20Pct: 0.0046, distMa60Pct: 0.0145 });
  assert.equal(mod.regimeStamp(null), null);
  assert.equal(mod.regimeStamp({ asOf: "x", aboveMa20: false, aboveMa60: false, close: 100, ma20: 0, ma60: null }).distMa60Pct, null, "均線缺值不猜");
});

test("regimeBucket：有距離看距離（±1% 內＝季線附近），舊紀錄只有布林照布林，缺值一律 unknown", () => {
  assert.equal(mod.regimeBucket({ aboveMa60: true }), "aboveMa60");
  assert.equal(mod.regimeBucket({ aboveMa60: false }), "belowMa60");
  assert.equal(mod.regimeBucket(null), "unknown");
  assert.equal(mod.regimeBucket({}), "unknown");
  assert.equal(mod.REGIME_NEAR_MA60_BAND, 0.01);
  assert.equal(mod.regimeBucket({ aboveMa60: true, distMa60Pct: 0.0145 }), "aboveMa60");
  assert.equal(mod.regimeBucket({ aboveMa60: true, distMa60Pct: 0.004 }), "nearMa60", "站上季線 0.4% 是貼著均線，不算季線上");
  assert.equal(mod.regimeBucket({ aboveMa60: false, distMa60Pct: -0.01 }), "nearMa60", "邊界 −1% 含");
  assert.equal(mod.regimeBucket({ aboveMa60: false, distMa60Pct: -0.0101 }), "belowMa60");
  assert.equal(mod.regimeBucket({ aboveMa60: false, distMa60Pct: null }), "belowMa60", "距離缺值退回布林");
});

test("taiexPeriodBenchmark：訊號日收盤→觀察日收盤的指數報酬、日等權平均；缺哪天少算哪天並回報 missingDays", () => {
  const history = [
    { date: "20260901", close: 20000 }, { date: "20260902", close: 20200 }, { date: "20260903", close: 20100 },
    { date: "20260904", close: 20302 }, { date: "20260905", close: null },
  ];
  const records = [
    { asOf: "2026-09-01", observationDate: "2026-09-02" }, // +1%
    { asOf: "2026-09-02", observationDate: "2026-09-03" }, // −0.495…%
    { asOf: "2026-09-03", observationDate: "2026-09-04" }, // +1.0049…%
    { asOf: "2026-09-04", observationDate: "2026-09-05" }, // 指數缺值 → 不算
  ];
  const bench = mod.taiexPeriodBenchmark(history, records);
  assert.equal(bench.days, 3);
  assert.equal(bench.missingDays, 1);
  assert.equal(bench.source, "taiex-close-to-close");
  assert.equal(bench.avgReturn, 0.5, "(1 − 0.495 + 1.005) / 3 ≈ 0.503 → 0.5");
  assert.equal(mod.taiexPeriodBenchmark(null, records), null, "沒有指數歷史就 null，不擋成績單");
  assert.equal(mod.taiexPeriodBenchmark(history, []), null);
});
