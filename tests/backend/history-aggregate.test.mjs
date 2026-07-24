// 週K/月K 聚合（open=首日、close=末日、high/low=極值、量=加總）、previousClose 補鏈、
// 波段板的「眾數收盤日」與「補今日官方收盤K」helper。全純函式（聚合本身與今天無關，
// 用固定歷史日期反而最確定；resolveMarketCloseDate/appendTodayCloseBar 用相對日期）。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer());
});

const bar = (date, { open, high, low, close, volumeLots = 100, previousClose = null } = {}) => ({
  date, rawDate: date.replace(/\D/g, ""), code: "2330", name: "台積電", exchange: "TWSE",
  open, high, low, close, previousClose, change: null,
  volumeShares: volumeLots * 1000, volumeLots, tradeValue: volumeLots * 1000 * close, transactions: 10,
  source: "test",
});

// 2026-06-29（一）～07-03（五）同一週；07-06（一）是下一週；06-30/07-01 跨月。
const week1 = [
  bar("2026/06/29", { open: 100, high: 103, low: 99, close: 101, volumeLots: 1000, previousClose: 99.5 }),
  bar("2026/06/30", { open: 101, high: 105, low: 100, close: 104, volumeLots: 1200 }),
  bar("2026/07/01", { open: 104, high: 108, low: 96, close: 107, volumeLots: 900 }),
  bar("2026/07/02", { open: 107, high: 110, low: 105, close: 106, volumeLots: 800 }),
  bar("2026/07/03", { open: 106, high: 109, low: 104, close: 108, volumeLots: 1100 }),
];
const week2 = [bar("2026/07/06", { open: 108, high: 112, low: 107, close: 111, volumeLots: 700 })];

test("aggregateHistoryByPeriod(week)：一週收成一根——開=週一開、收=週五收、高低=極值、量=加總", () => {
  const out = mod.aggregateHistoryByPeriod([...week1, ...week2], "week");
  assert.equal(out.length, 2);
  const [w1, w2] = out;
  assert.equal(w1.open, 100);
  assert.equal(w1.close, 108);
  assert.equal(w1.high, 110);
  assert.equal(w1.low, 96);
  assert.equal(w1.volumeLots, 1000 + 1200 + 900 + 800 + 1100);
  assert.equal(w1.date, "2026/07/03", "整根週K掛在最後一個交易日");
  assert.equal(w1.previousClose, 99.5, "沿用該週第一根的昨收");
  assert.equal(w1.change, 108 - 99.5);
  assert.equal(w2.open, 108);
});

test("aggregateHistoryByPeriod(month)：跨月切開；day 原樣回複本（不共用參照）", () => {
  const out = mod.aggregateHistoryByPeriod(week1, "month");
  assert.equal(out.length, 2, "6 月兩根＋7 月三根 → 兩根月K");
  assert.equal(out[0].close, 104, "6 月收在 06/30");
  assert.equal(out[1].open, 104, "7 月開在 07/01 的開盤");
  const day = mod.aggregateHistoryByPeriod(week1, "day");
  assert.equal(day.length, week1.length);
  assert.notEqual(day[0], week1[0], "day 也要回複本，避免呼叫端改到原始資料");
  assert.deepEqual(day[0], week1[0]);
});

test("getWeekKey：同週同鍵、週日歸前面的週一、跨週不同鍵", () => {
  assert.equal(mod.getWeekKey("2026/06/29"), mod.getWeekKey("2026/07/03"), "週一到週五同一週");
  assert.equal(mod.getWeekKey("2026/07/05"), mod.getWeekKey("2026/06/29"), "週日屬於前面那個週一的週");
  assert.notEqual(mod.getWeekKey("2026/07/06"), mod.getWeekKey("2026/07/03"), "下週一是新的一週");
  assert.match(mod.getWeekKey("2026/07/02"), /^\d{4}-W\d{2}$/);
});

test("addPreviousClose：首根沿用原值、其餘一律接前一根收盤", () => {
  const out = mod.addPreviousClose([
    { close: 10, previousClose: 5 },
    { close: 12, previousClose: 999 },
    { close: 11, previousClose: null },
  ]);
  assert.equal(out[0].previousClose, 5);
  assert.equal(out[1].previousClose, 10, "999 是髒資料，要以序列自身為準");
  assert.equal(out[2].previousClose, 12);
});

test("resolveMarketCloseDate：取眾數收盤日；同票數取較新", () => {
  const dayOld = compactToday(-1);
  const dayNew = compactToday(0);
  const ref = (entries) => ({ byCode: new Map(entries.map((q, i) => [String(i), q])) });
  const majorityOld = ref([
    { rawDate: dayOld }, { rawDate: dayOld }, { rawDate: dayOld }, { rawDate: dayNew }, { rawDate: dayNew },
  ]);
  assert.equal(mod.resolveMarketCloseDate(majorityOld), dayOld, "多數個股還停在舊收盤日 → 板子日期跟多數走");
  const tied = ref([{ rawDate: dayOld }, { rawDate: dayOld }, { rawDate: dayNew }, { rawDate: dayNew }]);
  assert.equal(mod.resolveMarketCloseDate(tied), dayNew, "平手取較新");
});

test("appendTodayCloseBar：整批收盤比逐檔歷史新一天 → 補一根今日K；三種情況不補", () => {
  const histDay = compactToday(-1);
  const today = compactToday(0);
  const history = [bar(`${histDay.slice(0, 4)}/${histDay.slice(4, 6)}/${histDay.slice(6, 8)}`, { open: 100, high: 102, low: 99, close: 101 })];
  const quote = {
    code: "2330", name: "台積電", exchange: "TWSE",
    asOf: `${today.slice(0, 4)}/${today.slice(4, 6)}/${today.slice(6, 8)}`,
    open: 101, high: 104, low: 100, price: 103, previousClose: 101, volumeLots: 900, transactions: 50,
  };
  const appended = mod.appendTodayCloseBar(history, quote, today);
  assert.equal(appended.length, 2);
  const added = appended.at(-1);
  assert.equal(added.close, 103, "close = 整批收盤的現價");
  assert.equal(added.rawDate, today);
  assert.equal(added.volumeShares, 900 * 1000);
  assert.ok(String(added.source).includes("appended"));
  // 不補一：歷史已經有當日
  assert.equal(mod.appendTodayCloseBar(appended, quote, today).length, 2);
  // 不補二：報價日期超過板子基準日（少數更新特別快的個股，不能讓它超前整體）
  assert.equal(mod.appendTodayCloseBar(history, quote, histDay).length, 1);
  // 不補三：OHLC 缺值（半根K會污染指標）
  assert.equal(mod.appendTodayCloseBar(history, { ...quote, high: null }, today).length, 1);
});
