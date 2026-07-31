// 開休市表一次只給一個民國年，跨年時「不在表裡」不等於「有開盤」。
//
// 2026-07-31 實測官方 `holidaySchedule` 端點：27 列**全部民國 115**，
// 範圍 1150101 ~ 1151225，一筆 2027 年的都沒有。而判準是
//     return openOverrides.has(day) || (!weekend && !closures.has(day));
// ——沒有人檢查這份表涵不涵蓋你問的那一天。所以進入 2027、證交所還沒換資料集之前，
// 元旦會被判成交易日，而且是用 `confidence: "official-schedule"` 這個**最高信心等級**、
// `degraded: false`、零警語說出來的。
//
// 這是這批稽核裡唯一有硬期限的一條：2027-01-01 必定踩到（或證交所提早換表時 2026-12-25 先踩）。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

// 官方形狀：民國年 + 5 碼（1150101 = 2026-01-01）。
const roc = (compact) => `${Number(compact.slice(0, 4)) - 1911}${compact.slice(4)}`;
const holiday2026 = [
  { date: "20260101", name: "中華民國開國紀念日", description: "" },
  { date: "20260216", name: "春節", description: "" },
  { date: "20261225", name: "行憲紀念日", description: "" },
];

test("holidayCalendarCoversYear：表裡有那一年才算涵蓋", () => {
  assert.equal(mod.holidayCalendarCoversYear(holiday2026, "20260701"), true);
  assert.equal(mod.holidayCalendarCoversYear(holiday2026, "20261225"), true);
  assert.equal(mod.holidayCalendarCoversYear(holiday2026, "20270101"), false, "2027 一筆都沒有");
  assert.equal(mod.holidayCalendarCoversYear(holiday2026, "20250101"), false, "往前也一樣不涵蓋");
});

test("holidayCalendarCoversYear：空表與壞輸入都算沒涵蓋", () => {
  assert.equal(mod.holidayCalendarCoversYear([], "20260701"), false);
  assert.equal(mod.holidayCalendarCoversYear(null, "20260701"), false);
  assert.equal(mod.holidayCalendarCoversYear(holiday2026, ""), false);
  assert.equal(mod.holidayCalendarCoversYear(holiday2026, null), false);
  assert.equal(mod.holidayCalendarCoversYear([{ date: "" }, { name: "沒有日期" }], "20260701"), false);
});

test("holidayCalendarCoversYear：接受官方民國格式（toCompactDate 正規化過）", () => {
  const rocRows = holiday2026.map((row) => ({ ...row, date: roc(row.date) }));
  assert.equal(mod.holidayCalendarCoversYear(rocRows, "20260701"), true, "民國 115 要能對到西元 2026");
  assert.equal(mod.holidayCalendarCoversYear(rocRows, "20270101"), false);
});

// ---- 市場狀態列的信心等級 ----

const evidence = (rows, { status = "fresh", tradingDays = [] } = {}) => ({
  tradingDays,
  holidayRows: rows,
  degraded: false,
  sources: { sessions: { status: "fresh" }, holidays: { status } },
});

test("涵蓋範圍內：維持 official-schedule（既有行為不可被新檢查破壞）", () => {
  // 2026-07-01 是週三、不在休市表裡 → 有開盤，而且表確實講到 2026。
  const status = mod.buildStockMarketCalendarStatus(evidence(holiday2026), "20260701");
  assert.equal(status.stockTradingDay, true);
  assert.equal(status.confidence, "official-schedule");
});

test("表裡明列的休市日照舊是 official-holiday", () => {
  const status = mod.buildStockMarketCalendarStatus(evidence(holiday2026), "20261225");
  assert.equal(status.stockTradingDay, false);
  assert.equal(status.confidence, "official-holiday");
  assert.equal(status.holidayName, "行憲紀念日");
});

test("跨年破口：2027 元旦不得被用最高信心說成交易日", () => {
  // 2027-01-01 是週五。舊行為：不在表裡、不是週末 → true + official-schedule + 零警語。
  const status = mod.buildStockMarketCalendarStatus(evidence(holiday2026), "20270101");
  assert.notEqual(status.confidence, "official-schedule", "沒有依據就不可用最高信心等級");
  assert.notEqual(status.stockTradingDay, true, "更不可斷言有開盤");
  assert.equal(status.stockTradingDay, null, "平日 + 表沒涵蓋 = 不知道，不是 false");
  assert.equal(status.confidence, "unknown");
});

test("跨年破口：2027 的週末仍可保守判為休市", () => {
  // 2027-01-02 是週六。週末推定的方向是安全的（不會憑空造出交易日）。
  const status = mod.buildStockMarketCalendarStatus(evidence(holiday2026), "20270102");
  assert.equal(status.stockTradingDay, false);
  assert.equal(status.confidence, "weekend-fallback");
});

test("實際開盤紀錄（FMTQIK）優先於開休市表：有紀錄就是有開盤", () => {
  // 這條是真正的證據，不受表的涵蓋範圍影響——證交所換表之前的空窗期靠它撐住。
  const status = mod.buildStockMarketCalendarStatus(
    evidence(holiday2026, { tradingDays: ["20270104"] }),
    "20270104",
  );
  assert.equal(status.stockTradingDay, true);
  assert.equal(status.confidence, "actual-session");
});

test("開休市表整個抓不到時維持既有的週末推定（不可一起收緊）", () => {
  // 「上游掛了」與「表沒換年份」是兩件事：前者我們手上還有整批收盤這個間接證據，
  // 而且 getTradingCalendarEvidence 已經推過警語。把兩者一起擋掉會讓上游打嗝那天
  // 整個處置看板停止記錄歷史，反而製造 45 天保留窗裡的缺口。
  const weekday = mod.buildStockMarketCalendarStatus(evidence([], { status: "unavailable" }), "20260701");
  assert.equal(weekday.confidence, "unknown", "平日、沒有任何表 → 不知道");
  const weekend = mod.buildStockMarketCalendarStatus(evidence([], { status: "unavailable" }), "20260704");
  assert.equal(weekend.stockTradingDay, false);
  assert.equal(weekend.confidence, "weekend-fallback");
});
