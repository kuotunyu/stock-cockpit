// D-21：技術分析頁完全不還原權息，與策略雷達（已還原）對同一檔給出相反的型態結論。
// 這裡釘住三件事：
//   1. 還原一定在「日 K」層完成，再彙總成週／月——順序顛倒會憑空長出一根假長黑。
//   2. 揭露只列「真的影響到畫面」的事件，不能讓使用者以為圖上有他看不到的調整。
//   3. 跳空估算還原的前提是 ±10% 漲跌幅，只對普通股開放；官方欄位不齊時不得給型態結論。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer());
});

// 開高低收全部相同的一根 K：還原比率一乘上去就看得出來，不用跟 wobble 打架。
const flatBar = (date, price, volumeLots = 1000) => ({
  date,
  rawDate: date.replace(/\D/g, ""),
  code: "2330",
  name: "台積電",
  exchange: "TWSE",
  open: price,
  high: price,
  low: price,
  close: price,
  previousClose: null,
  change: null,
  volumeShares: volumeLots * 1000,
  volumeLots,
  tradeValue: volumeLots * 1000 * price,
  transactions: 10,
  source: "test",
});

// 2026-06-29（一）～07-03（五）是同一週（history-aggregate.test.mjs 已釘住這個日曆事實）。
// 07/02 除息 8 元：前收 100 → 參考價 92，之後就一直收 92。
// 參考價公式：(100 − 8 + 0×0) ÷ (1 + 0 + 0) = 92 → 還原因子 0.92。
const EX_DATE = "20260702";
const dailyWeek = [
  flatBar("2026/06/29", 100),
  flatBar("2026/06/30", 100),
  flatBar("2026/07/01", 100),
  flatBar("2026/07/02", 92),
  flatBar("2026/07/03", 92),
];
const cashDividendAction = [{
  exDate: EX_DATE,
  kind: "息",
  cashDividend: 8,
  stockRatio: 0,
  subscriptionRatio: 0,
  subscriptionPrice: null,
  formulaComplete: true,
  status: "active",
}];

test("D-21：日 K 先還原再彙總——整根週 K 平盤，不會憑空長出 -8% 長黑", () => {
  const { rows } = mod.buildAdjustedPeriodRows(dailyWeek, cashDividendAction, { period: "week" });
  assert.equal(rows.length, 1, "五個交易日收成一根週 K");
  const week = rows[0];
  assert.ok(Math.abs(week.open - 92) < 1e-9, `週 K 的開盤要是還原後的 92，實際 ${week.open}`);
  assert.equal(week.close, 92, "收盤是實際成交價，不動");
  assert.ok(Math.abs(week.high - 92) < 1e-9, "整週在還原後的座標上是平盤");
  assert.ok(Math.abs(week.low - 92) < 1e-9);

  // 對照組：先彙總再還原（錯誤順序）。除息日 07/02 被吸進整根週 K 裡，
  // 週 K 的 date 是 07/03，跟官方 exDate 對不上 → 還原因子根本套不上去，
  // 於是這根週 K 同時留著「還原前的開盤 100」與「還原後的收盤 92」。
  const wrongOrder = mod.backAdjustForCorporateActions(
    mod.addPreviousClose(mod.aggregateHistoryByPeriod(dailyWeek, "week")),
    cashDividendAction,
    {},
  );
  assert.equal(wrongOrder[0].open, 100, "先彙總再還原：開盤停在還原前");
  assert.equal(wrongOrder[0].close, 92, "收盤卻是還原後 → 一根不存在的 -8% 長黑");
});

test("D-21：日 K 視圖——除息前的歷史價一律還原，最新一根維持實際成交價", () => {
  const { rows, corporateActions } = mod.buildAdjustedPeriodRows(dailyWeek, cashDividendAction, { period: "day" });
  assert.equal(rows.length, 5);
  for (const row of rows.slice(0, 3)) {
    assert.ok(Math.abs(row.close - 92) < 1e-9, `${row.date} 應還原成 92，實際 ${row.close}`);
  }
  assert.equal(rows.at(-1).close, 92, "最新可交易價格不動");

  assert.equal(corporateActions.adjusted, true);
  assert.equal(corporateActions.source, "official");
  assert.deepEqual(corporateActions.events.map((event) => event.date), [EX_DATE]);
  assert.equal(corporateActions.events[0].ratio, 0.92);
  assert.deepEqual(corporateActions.unresolvedDates, []);
  assert.match(corporateActions.notes.join(" "), /已依官方除權息公告還原/);
});

test("D-21：只揭露真的影響到畫面的事件——被 maxBars 切掉的事件不列出", () => {
  // 只看最後兩根（07/02、07/03）。07/02 的除息只會調整「它之前」的 K，
  // 那三根全在畫面外，所以這張圖上沒有任何一根被動過。
  const { rows, corporateActions } = mod.buildAdjustedPeriodRows(dailyWeek, cashDividendAction, {
    period: "day",
    maxBars: 2,
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.close), [92, 92], "兩根都是實際成交價");
  assert.equal(corporateActions.adjusted, false, "畫面上沒有任何一根被還原，就不能說「已還原」");
  assert.deepEqual(corporateActions.events, []);

  // 只要多看一根（06/29 進畫面），同一個事件就真的影響到畫面了 → 必須揭露。
  const wider = mod.buildAdjustedPeriodRows(dailyWeek, cashDividendAction, { period: "day", maxBars: 4 });
  assert.equal(wider.corporateActions.adjusted, true);
  assert.deepEqual(wider.corporateActions.events.map((event) => event.date), [EX_DATE]);
});

test("D-21：跳空估算還原只對普通股開放（ETF 無 ±10% 漲跌幅前提）", () => {
  // 沒有任何官方公告，只有一根 -15% 跳空。普通股可以估算還原，槓反 ETF 不行——
  // 它一天真的可以跌 15%，追認成除權息會把之前的歷史全乘上假比率。
  const gapDaily = [
    flatBar("2026/06/29", 100),
    flatBar("2026/06/30", 100),
    flatBar("2026/07/01", 85),
    flatBar("2026/07/02", 85),
  ];
  const ordinary = mod.buildAdjustedPeriodRows(gapDaily, [], { period: "day", allowHeuristicFallback: true });
  assert.equal(ordinary.corporateActions.source, "heuristic");
  assert.ok(Math.abs(ordinary.rows[0].close - 85) < 1e-9, "普通股：跳空前的歷史被估算還原");
  assert.match(ordinary.corporateActions.notes.join(" "), /疑似公司行動/, "估算還原不可宣稱一定是除息");

  const etf = mod.buildAdjustedPeriodRows(gapDaily, [], { period: "day", allowHeuristicFallback: false });
  assert.equal(etf.corporateActions.adjusted, false);
  assert.equal(etf.rows[0].close, 100, "ETF：不套跳空估算，原始價原樣呈現");
  assert.match(etf.corporateActions.notes.join(" "), /不套用跳空估算還原/);
});

test("D-21：官方公司行動欄位不齊 → 標 unresolved 並明講暫不提供型態結論", () => {
  // 除權事件缺 stockRatio：公式算不出來，事件之前的價格等於沒還原。
  const incomplete = [{
    exDate: EX_DATE,
    kind: "權息",
    cashDividend: 2,
    stockRatio: null,
    subscriptionRatio: null,
    subscriptionPrice: null,
    formulaComplete: true,
    status: "active",
  }];
  const { corporateActions } = mod.buildAdjustedPeriodRows(dailyWeek, incomplete, {
    period: "day",
    allowHeuristicFallback: true,
  });
  assert.deepEqual(corporateActions.unresolvedDates, [EX_DATE]);
  assert.match(corporateActions.notes.join(" "), /暫不提供型態結論/);
  // 8% 跳空進不了 10.5% 門檻，heuristic 也救不了 → 這張圖的事件前價格確實沒被還原。
  assert.equal(corporateActions.adjusted, false);
});
