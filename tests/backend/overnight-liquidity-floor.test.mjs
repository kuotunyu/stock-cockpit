// D-33：隔日沖候選池的絕對成交量下限（2026-07-26 使用者拍板 100 張）。
//
// 為什麼需要：排序權重是 |漲跌%| × log10(量+10)，量那一項的值域只有 1~5，壓不過 0~10 的
// 漲幅項。冷門股靠「相對爆量」很容易擠進 260 檔，而候選池**有上限**，它們會擠掉流動性好的
// 股票——這不只是清單變吵，是真的少看到可交易的標的。
// 實測基準日 2026-07-24：6103 合邦整天成交 5 張（17 萬元）拿到 78 分登上強勢續攻。
//
// 門檻刻意設得比波段（500 張）低很多：只擋「真的買不到」的，其餘維持「低流動性」標籤讓
// 使用者自己判斷，與注意／處置股「顯示＋標示」的既定政策一致。
//
// 另一半：走 Yahoo 備援時最後一根 K 的成交金額恆為 null（chart API 沒有這個欄位），
// 於是「低流動性」全部退化成「成交值未知」——實測連台積電都會這樣，而那正是這條門檻
// 要用來判斷的依據。改由整批收盤把同一天的官方成交金額補回去。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, stockDayAllRow } from "../helpers/fixtures.mjs";

const today = compactToday(0);
const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const quote = (code, name, volumeLots, changePct = 5) => {
  const previousClose = 100;
  const price = previousClose * (1 + changePct / 100);
  return {
    code, name, exchange: "TWSE", asOf: `${today.slice(0, 4)}/${today.slice(4, 6)}/${today.slice(6, 8)}`,
    rawDate: today, price, previousClose, open: previousClose, high: price, low: previousClose,
    volumeLots, tradeValue: volumeLots * 1000 * price, industry: "半導體業",
  };
};
const poolOf = (quotes) => mod.preselectQuotes(
  { byCode: new Map(quotes.map((q) => [q.code, q])) },
  { halted: new Map(), delisted: new Map() },
  today, 260,
).map((q) => q.code);

test("成交量低於下限的股票進不了候選池", () => {
  const pool = poolOf([
    quote("2330", "台積電", 50000),
    quote("6103", "合邦", 5),      // 實機案例：整天 5 張
    quote("4706", "大恭", 58),
    quote("1101", "台泥", 100),    // 剛好在門檻上
    quote("2317", "鴻海", 99),     // 差一張
  ]);
  assert.ok(pool.includes("2330"));
  assert.ok(pool.includes("1101"), "剛好等於門檻要留下（>= 而不是 >）");
  assert.ok(!pool.includes("6103"), "整天 5 張的股票不該進候選池");
  assert.ok(!pool.includes("4706"));
  assert.ok(!pool.includes("2317"), "99 張要被擋");
});

test("冷門股的相對爆量壓不過門檻——它原本可以靠漲幅排到很前面", () => {
  // 漲停的冷門股：momentum = 10 × log10(15) ≈ 11.8，
  // 勝過漲 2% 的大型股 2 × log10(100010) ≈ 10.0 → 舊行為會排在它前面並佔掉名額。
  const hot = quote("9999", "冷門漲停", 5, 10);
  const big = quote("2330", "台積電", 100000, 2);
  const hotMomentum = Math.abs(10) * Math.log10(5 + 10);
  const bigMomentum = Math.abs(2) * Math.log10(100000 + 10);
  assert.ok(hotMomentum > bigMomentum, `前提：舊排序確實讓冷門股勝出（${hotMomentum.toFixed(2)} > ${bigMomentum.toFixed(2)}）`);
  const pool = poolOf([hot, big]);
  assert.deepEqual(pool, ["2330"], "加了門檻之後名額還給流動性好的股票");
});

test("成交量缺值視為不足，不可放行", () => {
  const missing = { ...quote("8888", "缺量", 1000), volumeLots: null };
  assert.ok(!poolOf([missing]).includes("8888"));
});

// ---- 成交金額補回（低流動性標籤的依據）----
const bar = (date, over = {}) => ({
  date: `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}`, rawDate: date,
  code: "2330", name: "台積電", exchange: "TWSE",
  open: 100, high: 101, low: 99, close: 100, volumeLots: 20000,
  tradeValue: null, source: "Yahoo Finance chart fallback", ...over,
});

test("Yahoo 備援的最後一根沒有成交金額 → 由整批收盤補回同一天的官方數字", () => {
  const history = [bar("20260723"), bar(today)];
  const q = { ...quote("2330", "台積電", 20000), tradeValue: 5.84e10 };
  const out = mod.appendTodayCloseBar(history, q, today);
  assert.equal(out.length, 2, "日期已涵蓋就不該再補一根");
  assert.equal(out.at(-1).tradeValue, 5.84e10, "成交金額要補進來，否則低流動性標籤失效");
  assert.equal(history.at(-1).tradeValue, null, "不可就地改動——history 可能來自模組級快取");
});

test("最後一根本來就有成交金額時不覆寫；日期對不上也不補", () => {
  const withValue = [bar("20260723"), bar(today, { tradeValue: 123, source: "TWSE STOCK_DAY" })];
  const q = { ...quote("2330", "台積電", 20000), tradeValue: 5.84e10 };
  assert.equal(mod.appendTodayCloseBar(withValue, q, today).at(-1).tradeValue, 123, "官方逐檔歷史的值優先");

  // 報價是今天、歷史只到昨天 → 走原本的「補一根」路徑，不是補金額
  const stale = [bar("20260722"), bar("20260723")];
  const appended = mod.appendTodayCloseBar(stale, q, today);
  assert.equal(appended.length, 3, "這種情形要補一根新的");
  assert.equal(appended.at(-1).tradeValue, 5.84e10);
});

test("補回成交金額之後，低流動性標籤才判得出來", () => {
  const metrics = (tradeValue) => mod.buildRiskTags({
    tradeValue, volumeRatio5: 1, amplitudePct: 1, closePosition: 0.8, turnover: 0.5,
  });
  assert.ok(metrics(null).includes("成交值未知"), "缺值時只能說不知道");
  assert.ok(!metrics(null).includes("低流動性"), "不知道不等於低");
  assert.ok(metrics(170_000).includes("低流動性"), "17 萬元（合邦實機值）就是低流動性");
  assert.ok(!metrics(5.84e10).includes("低流動性"));
  assert.ok(!metrics(5.84e10).includes("成交值未知"));
});
