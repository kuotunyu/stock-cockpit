// 我的成績單（帳本側）與 T+2 交割：量的是你自己的成交，不是系統訊號。
// 已實現＝賣出價金−賣出費稅−加權平均成本（成本含買進手續費），與 buildPortfolio 同一個數。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
let mod;
before(async () => {
  srv = await bootServer({ routes: [] });
  mod = srv.mod;
});
after(async () => {
  await srv.close();
});

const RECORDS = [
  { id: "b1", code: "2330", side: "buy", price: 100, shares: 1000, fee: 85, tax: 0, date: "20260803" },
  { id: "s1", code: "2330", side: "sell", price: 110, shares: 1000, fee: 94, tax: 330, date: "20260815" },
  { id: "d1", code: "2330", side: "dividend", price: 5, shares: 1000, fee: 10, status: "received", receivedAmount: 4990, date: "20260820" },
  { id: "d2", code: "2330", side: "dividend", price: 5, shares: 1000, fee: 0, status: "receivable", date: "20260901" },
  { id: "b2", code: "2317", side: "buy", price: 50, shares: 1000, fee: 43, tax: 0, date: "20260901" },
  { id: "s2", code: "2317", side: "sell", price: 48, shares: 1000, fee: 41, tax: 144, date: "20260905" },
];

test("buildPersonalScorecard：按月／按年彙總、勝率／獲利因子／每筆平均／連虧，與 buildPortfolio 的已實現同一個數", () => {
  const payload = { records: RECORDS, settings: { feeDiscount: 0.6, minFee: 20 } };
  const portfolio = mod.buildPortfolio(payload);
  assert.equal(portfolio.ok, true);
  const card = mod.buildPersonalScorecard(payload, portfolio);
  const realizedTotal = portfolio.realized.reduce((sum, r) => sum + r.pnl, 0);
  // 2330：109,576 − 100,085 = +9,491；2317：47,815 − 50,043 = −2,228
  assert.equal(card.overall.trades, 2);
  assert.equal(card.overall.wins, 1);
  assert.equal(card.overall.losses, 1);
  assert.equal(card.overall.winRate, 50);
  assert.equal(card.overall.realizedPnl, realizedTotal);
  assert.equal(card.overall.profitFactor, Math.round((9491 / 2228) * 100) / 100);
  assert.equal(card.overall.expectancy, Math.round(realizedTotal / 2));
  assert.equal(card.overall.maxConsecutiveLosses, 1);
  assert.equal(card.overall.best.code, "2330");
  assert.equal(card.overall.worst.code, "2317");
  assert.equal(card.minTrades, 20);
  const aug = card.months.find((m) => m.key === "202608");
  const sep = card.months.find((m) => m.key === "202609");
  assert.equal(aug.realizedPnl, 9491);
  assert.equal(aug.trades, 1);
  assert.equal(aug.wins, 1);
  assert.equal(aug.fees, 85 + 94, "買進與賣出手續費都算在成交月份");
  assert.equal(aug.taxes, 330);
  assert.equal(aug.dividendsNet, 4990, "只算已入帳；待入帳（receivable）不算");
  assert.equal(sep.realizedPnl, -2228);
  assert.equal(sep.dividendsNet, 0);
  assert.equal(sep.winRate, 0);
  assert.equal(card.months[0].key, "202609", "最新月份在前");
  const year = card.years.find((y) => y.key === "2026");
  assert.equal(year.realizedPnl, 9491 - 2228);
  assert.equal(year.fees, 85 + 94 + 43 + 41);
  assert.equal(year.taxes, 330 + 144);
  assert.equal(year.dividendsNet, 4990);
  assert.equal(year.winRate, 50);
  // 連虧要按時間序：兩筆連虧在最新前面時 buildPortfolio 已把最新放前面，這裡要翻回來算
  const losing = { records: [
    { id: "x1", code: "1101", side: "buy", price: 100, shares: 1000, fee: 20, tax: 0, date: "20260701" },
    { id: "x2", code: "1101", side: "sell", price: 99, shares: 500, fee: 20, tax: 148, date: "20260702" },
    { id: "x3", code: "1101", side: "sell", price: 98, shares: 500, fee: 20, tax: 147, date: "20260703" },
    { id: "x4", code: "2330", side: "buy", price: 100, shares: 1000, fee: 20, tax: 0, date: "20260704" },
    { id: "x5", code: "2330", side: "sell", price: 105, shares: 1000, fee: 20, tax: 315, date: "20260705" },
  ], settings: { feeDiscount: 0.6, minFee: 20 } };
  const losingCard = mod.buildPersonalScorecard(losing);
  assert.equal(losingCard.overall.maxConsecutiveLosses, 2);
  assert.equal(losingCard.overall.trades, 3);
  const empty = mod.buildPersonalScorecard({ records: [] });
  assert.equal(empty.overall.trades, 0);
  assert.equal(empty.overall.winRate, null);
  assert.equal(empty.overall.profitFactorReason, "no-trades");
  assert.deepEqual(empty.months, []);
});

test("buildSettlementSchedule：T+2 交易日、買付賣收、兩週前的不算、開休市表缺時只跳週末並標明", () => {
  const today = "20260913"; // 週日
  const records = [
    { id: "a", code: "2330", side: "buy", price: 100, shares: 1000, fee: 85, tax: 0, date: "20260911" }, // 週五 → 9/14、9/15
    { id: "b", code: "2317", side: "sell", price: 50, shares: 2000, fee: 43, tax: 300, date: "20260910" }, // 週四 → 9/11、9/14
    { id: "c", code: "2603", side: "buy", price: 30, shares: 1000, fee: 20, tax: 0, date: "20260801" }, // 早就交割完
    { id: "d", code: "2330", side: "dividend", price: 5, shares: 1000, fee: 0, status: "received", date: "20260912" },
  ];
  const plain = mod.buildSettlementSchedule(records, today, []);
  assert.equal(plain.calendarSource, "weekends-only");
  assert.deepEqual(plain.days.map((d) => d.date), ["20260914", "20260915"]);
  const sellDay = plain.days[0];
  assert.equal(sellDay.receivable, 100000 - 43 - 300);
  assert.equal(sellDay.payable, 0);
  assert.equal(sellDay.net, 99657);
  assert.equal(sellDay.items[0].code, "2317");
  const buyDay = plain.days[1];
  assert.equal(buyDay.payable, 100085);
  assert.equal(buyDay.net, -100085);
  // 9/14 休市：賣出交割順延到 9/15，與買進同一天相抵
  const holiday = mod.buildSettlementSchedule(records, today, [{ date: "20260914", name: "測試休市" }]);
  assert.equal(holiday.calendarSource, "cached-official-holiday-schedule");
  assert.deepEqual(holiday.days.map((d) => d.date), ["20260915", "20260916"]);
  assert.equal(holiday.days[0].net, 99657, "賣出：9/10 → 9/11 → 9/15");
  assert.equal(holiday.days[1].net, -100085, "買進：9/11 → 9/15 → 9/16");
  assert.deepEqual(mod.buildSettlementSchedule([], today).days, []);
});

test("GET /api/trades 帶 scorecard 與 settlement；空帳本也有形狀", async () => {
  const res = await srv.api("/api/trades");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scorecard.overall.trades, 0);
  assert.equal(body.scorecard.minTrades, 20);
  assert.deepEqual(body.settlement.days, []);
  assert.ok(["weekends-only", "cached-official-holiday-schedule"].includes(body.settlement.calendarSource));
});

test("currentLossStreak 是尾端連虧；年度股利稅務估算：單筆 ≥ 2 萬才算補充保費、抵減 8.5% 上限 8 萬、分離 28%", () => {
  const records = [
    { id: "b1", code: "2330", side: "buy", price: 100, shares: 2000, fee: 170, tax: 0, date: "20260701" },
    { id: "s1", code: "2330", side: "sell", price: 105, shares: 500, fee: 45, tax: 157, date: "20260702" }, // 賺
    { id: "s2", code: "2330", side: "sell", price: 99, shares: 500, fee: 42, tax: 148, date: "20260703" }, // 虧
    { id: "s3", code: "2330", side: "sell", price: 98, shares: 500, fee: 42, tax: 147, date: "20260704" }, // 虧
    { id: "d1", code: "2330", side: "dividend", price: 50, shares: 500, fee: 0, status: "received", receivedAmount: 25000, date: "20260720" }, // 25,000 ≥ 2 萬
    { id: "d2", code: "2330", side: "dividend", price: 30, shares: 500, fee: 0, status: "receivable", date: "20260910" }, // 15,000 待入帳，稅務仍算給付
  ];
  const card = mod.buildPersonalScorecard({ records, settings: { feeDiscount: 0.6, minFee: 20 } });
  assert.equal(card.overall.currentLossStreak, 2, "最新兩筆都虧");
  assert.equal(card.overall.maxConsecutiveLosses, 2);
  const year = card.years.find((y) => y.key === "2026");
  assert.equal(year.dividendsNet, 25000, "已入帳淨額只算 received");
  const tax = year.dividendTax;
  assert.equal(tax.dividendGross, 40000);
  assert.equal(tax.payments, 2);
  assert.equal(tax.nhiQualifyingCount, 1, "只有 25,000 那筆 ≥ 2 萬");
  assert.equal(tax.nhiPremiumEstimate, Math.round(25000 * 0.0211));
  assert.equal(tax.creditableEstimate, 3400, "40,000 × 8.5%");
  assert.equal(tax.separateTaxEstimate, 11200, "40,000 × 28%");
  assert.equal(tax.rates.creditCap, 80000);
  assert.ok(card.months.some((m) => m.key === "202609"), "只有待入帳股利的月份也要有 bucket，稅務估算才看得到");
  const big = mod.estimateDividendTax({ gross: 2000000, payments: 1, nhiQualifyingCount: 1, nhiPremium: 42200 });
  assert.equal(big.creditableEstimate, 80000, "抵減上限 8 萬");
});
