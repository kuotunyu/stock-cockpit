// 隔日沖「次日開盤進場」口徑：訊號要等收盤後整批資料才算得出來，訊號日收盤買不到，
// 這一欄才是散戶真的做得到的交易。這裡鎖住：推回公式、去重、獲利因子／連虧、同期大盤同口徑、波段目標穿越。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

test("openEntryReturnOf：新列直接用 openEntryReturn；舊落盤列由 openReturn／currentReturn 推回 close/open − 1；鎖死列 null", () => {
  assert.equal(mod.openEntryReturnOf({ openEntryReturn: 1.2345, openReturn: 3, currentReturn: 2 }), 1.2345);
  // 開盤 +3%、收盤 +2%（相對訊號日收盤）→ 開盤買到收盤賣＝ 102/103 − 1 ＝ −0.9709%
  assert.equal(mod.openEntryReturnOf({ openReturn: 3, currentReturn: 2 }), -0.9709);
  assert.equal(mod.openEntryReturnOf({ openReturn: null, currentReturn: 2 }), null);
  assert.equal(mod.openEntryReturnOf({ openEntryReturn: 1, openEntrySkipped: "limit-up-locked" }), null, "一價漲停鎖死＝開盤買不到");
  assert.equal(mod.openEntryReturnOf(null), null);
});

test("dedupeRowsByCode：同檔同日進兩群只留分數最高那筆", () => {
  const rows = [
    { code: "2330", group: "pullbackReversal", score: 60 },
    { code: "2330", group: "strongContinuation", score: 80 },
    { code: "2317", group: "pullbackReversal", score: 50 },
  ];
  const unique = mod.dedupeRowsByCode(rows);
  assert.equal(unique.length, 2);
  assert.equal(unique.find((row) => row.code === "2330").group, "strongContinuation");
});

test("openEntryNetSummary 與 aggregateOvernightRecords.openEntry：獲利因子＝獲利總和÷虧損總和、最長連虧與最差單日以觀察日為單位", () => {
  const day = (observationDate, rows) => {
    const summary = mod.openEntryNetSummary(rows, true);
    const metricCoverage = mod.overnightMetricCoverage(rows.map((row) => ({ ...row, observationDate })), true, false);
    return { observationDate, verified: rows.length, metricCoverage, openEntryNet: summary };
  };
  // 淨值＝毛值 − 0.471：D1 兩筆 +1.471／−0.529 → 淨 +1／−1；D2 一筆 −1.529 → 淨 −2；D3 一筆 +2.471 → 淨 +2；D4 一筆 −0.529 → 淨 −1
  const records = [
    day("2026-09-01", [{ openEntryReturn: 1.471 }, { openEntryReturn: -0.529 }]),
    day("2026-09-02", [{ openEntryReturn: -1.529 }]),
    day("2026-09-03", [{ openEntryReturn: 2.471 }]),
    day("2026-09-04", [{ openEntryReturn: -0.529 }]),
  ];
  assert.deepEqual(records[0].openEntryNet, { count: 2, gain: 1, loss: 1, avg: 0 });
  const totals = mod.aggregateOvernightRecords(records);
  assert.equal(totals.openEntry.days, 4);
  assert.equal(totals.openEntry.profitFactorNet, 0.75, "獲利 1+2=3 ÷ 虧損 1+2+1=4");
  assert.equal(totals.openEntry.maxConsecutiveLossDays, 1, "D2 虧、D3 賺、D4 虧 → 最長連虧 1 天（D1 平均 0 不算虧）");
  assert.deepEqual(totals.openEntry.worstDay, { day: "2026-09-02", avgNet: -2, count: 1 });
  assert.equal(totals.winAtOpenEntry, 2, "5 筆裡淨值 > 0 的 2 筆");
  assert.equal(totals.metricCoverage.winAtOpenEntry.validCount, 5);
  assert.ok("winAtOpenEntry" in totals.ci, "開盤進場也要有日叢集區間");
  assert.equal(mod.openEntryNetSummary([{ openEntryReturn: 1 }], false), null, "成本模型未知就不算淨值");
  const noLoss = mod.aggregateOvernightRecords([day("2026-09-05", [{ openEntryReturn: 3 }])]);
  assert.equal(noLoss.openEntry.profitFactorNet, null);
  assert.equal(noLoss.openEntry.profitFactorReason, "no-losing-day");
  assert.equal(mod.aggregateOvernightRecords([{ observationDate: "2026-09-06", verified: 1, metricCoverage: mod.overnightMetricCoverage([{ openReturn: 1, currentReturn: 2, observationDate: "2026-09-06" }], true, false) }]).openEntry, null, "沒有 openEntryNet 的舊紀錄形狀不硬算");
});

test("overnightMetricCoverage：舊落盤列沒有 openEntryReturn 也算得出開盤進場三欄；成本未知標 legacy 原因", () => {
  const rows = [
    { openReturn: 3, currentReturn: 2, observationDate: "2026-09-01" }, // 開盤買到收盤 −0.97% → 淨負
    { openReturn: -1, currentReturn: 2, observationDate: "2026-09-01" }, // 103.03% → +3.03% → 淨正
    { openReturn: 1, currentReturn: 2, openEntrySkipped: "limit-up-locked", observationDate: "2026-09-01" },
  ];
  const known = mod.overnightMetricCoverage(rows, true, false);
  assert.equal(known.winAtOpenEntry.validCount, 2, "鎖死列不進分母");
  assert.equal(known.winAtOpenEntry.value, 0.5, "隔日沖的勝率欄位是 0～1 的比率（aggregate 會乘回筆數）");
  assert.equal(known.avgOpenEntryReturn.validCount, 2);
  assert.ok(Math.abs(known.avgOpenEntryReturnNet.value - ((-0.9709 + 3.0303) / 2 - 0.471)) < 0.01, "逐筆淨值各自四捨五入到 0.01 再平均");
  const legacy = mod.overnightMetricCoverage(rows, false, false);
  assert.equal(legacy.winAtOpenEntry.reason, "legacy-unknown-cost-model");
  assert.equal(legacy.avgOpenEntryReturn.validCount, 2, "毛值不需要成本模型");
});

test("taiexPeriodBenchmark：並列同一批日子、同段期間、日等權、不扣成本的訊號平均隔日收", () => {
  const history = [{ date: "20260901", close: 20000 }, { date: "20260902", close: 20200 }, { date: "20260903", close: 20100 }];
  const records = [
    { asOf: "2026-09-01", observationDate: "2026-09-02", avgCloseReturn: 2 },
    { asOf: "2026-09-02", observationDate: "2026-09-03", avgCloseReturn: -1 },
    { asOf: "2026-09-03", observationDate: "2026-09-04", avgCloseReturn: 9 }, // 指數缺值 → 兩邊都不算
  ];
  const bench = mod.taiexPeriodBenchmark(history, records);
  assert.equal(bench.days, 2);
  assert.equal(bench.avgReturn, 0.25, "(+1% − 0.495%) / 2");
  assert.equal(bench.strategyAvgReturn, 0.5, "(2 − 1) / 2，第三天指數缺值所以不算進訊號端");
  assert.equal(bench.basis, "day-equal-weight-gross-close-to-close");
});

test("波段目標是限價單：最高價剛好等於目標只是排隊、不結案；穿越才以目標價結案", () => {
  const make = () => ({ identity: mod.currentVerificationIdentity("swing"), status: "pending", code: "2330", entry: 100, stop: 95, target: 110, daysHeld: 0, lastChecked: "20260901" });
  const queued = make();
  mod.advanceSwingVerificationEntry(queued, { rawDate: "20260902", open: 101, high: 110, low: 99, price: 105 });
  assert.equal(queued.status, "pending", "high === target 只代表有人在那個價位成交過");
  assert.equal(queued.daysHeld, 1);
  const filled = make();
  mod.advanceSwingVerificationEntry(filled, { rawDate: "20260902", open: 101, high: 110.5, low: 99, price: 105 });
  assert.equal(filled.status, "win");
  assert.equal(filled.resultPct, 10, "出場價仍是目標價 110");
});

test("隔日沖 pick：訊號日一價漲停鎖死帶 fillRisk，盤中有開的漲停不帶", () => {
  const metrics = (bar) => ({ code: "2330", name: "台積電", exchange: "TWSE", source: "TWSE", date: "20260901", close: bar.close, high: bar.high, low: bar.low, previousClose: 100, changePct: 10, volumeLots: 500, volumeRatio5: 2, volumeRatio20: 2, closePosition: 1, ma5: 95, ma20: 90, amplitudePct: 0, turnover: null });
  const locked = mod.buildPick(metrics({ close: 110, high: 110, low: 110 }), { group: "strongContinuation", groupName: "強勢續攻", score: 80, reasons: [] });
  assert.equal(locked.fillRisk, "limit-up-locked");
  const open = mod.buildPick(metrics({ close: 110, high: 110, low: 104 }), { group: "strongContinuation", groupName: "強勢續攻", score: 80, reasons: [] });
  assert.equal(open.fillRisk, undefined, "收在漲停但盤中有開，整天買得到");
});
