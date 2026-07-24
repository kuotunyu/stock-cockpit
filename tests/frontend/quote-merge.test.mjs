// 報價合併與雜項格式化：mergeOfficialQuote 是「白名單複製」——後端新增 quote 欄位必須
// 手動加一行才會流到前端（曾因漏加 dividend 踩坑），這裡把整張白名單釘住防回歸。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const FULL_QUOTE = {
  price: 101, name: "台積電", changePct: 1.5, unitLots: 30, volumeLots: 8000, turnoverPct: 0.55,
  source: "TWSE MIS", sourceKind: "realtime", exchange: "TWSE", asOf: "2026/07/02 13:30:00",
  open: 99, high: 102, low: 98.5, previousClose: 99.5, change: 1.5, priceStale: false,
  dividend: { exDate: "2026-07-10", kind: "除息", cash: 3, stockRatio: 0, isToday: false, daysUntil: 8 },
};

test("mergeOfficialQuote：白名單全欄位都要複製到 stock（含 priceStale 與 dividend 旗標）", () => {
  const s = JSON.parse(app.evalIn(`(() => {
    const s = { code: "2330", spark: [100], strategies: [], groups: [] };
    mergeOfficialQuote(s, ${JSON.stringify(FULL_QUOTE)});
    return JSON.stringify(s);
  })()`));
  assert.equal(s.price, 101);
  assert.equal(s.change, 1.5);
  assert.equal(s.changeText, "▲1.50%");
  assert.equal(s.signal, "red", "漲 → 紅K");
  assert.equal(s.unit, 30);
  assert.equal(s.total, 8000);
  assert.equal(s.turnover, 0.55);
  assert.equal(s.open, 99);
  assert.equal(s.high, 102);
  assert.equal(s.low, 98.5);
  assert.equal(s.previousClose, 99.5);
  assert.equal(s.priceChange, 1.5);
  assert.equal(s.priceStale, false);
  assert.equal(s.official, true);
  assert.equal(s.exchange, "TWSE");
  assert.deepEqual(s.dividend, FULL_QUOTE.dividend, "除息旗標必須在白名單裡（歷史踩坑點）");
  assert.deepEqual(s.spark.slice(-1), [101], "現價要接進走勢序列");
});

test("mergeOfficialQuote：缺漲跌幅→不動 change；價格非數→不動價與 spark；stale 旗標要跟著更新", () => {
  const s = JSON.parse(app.evalIn(`(() => {
    const s = { code: "2330", price: 100, change: 2, changeText: "▲2.00%", signal: "red", spark: [100], strategies: [], groups: [] };
    mergeOfficialQuote(s, { name: "台積電", price: "no-a-number", priceStale: true });
    return JSON.stringify(s);
  })()`));
  assert.equal(s.price, 100, "壞價格不能蓋掉好價格");
  assert.deepEqual(s.spark, [100]);
  assert.equal(s.change, 2, "沒給 changePct 就不動漲跌");
  assert.equal(s.priceStale, true);
  assert.equal(s.dividend, null, "quote 沒帶 dividend → 明確歸 null（不殘留舊旗標）");
});

test("mergeOfficialQuote：null／0 價格與 nullable 指標不得被 Number() 捏造成 0", () => {
  const result = JSON.parse(app.evalIn(`(() => {
    const existing = { code: "7782", name: "光速火箭", price: 27.35, change: 4.39, changeText: "▲4.39%", signal: "red",
      unit: 3, total: 20, turnover: 0.09, spark: [26.2, 27.35], strategies: [], groups: ["watch"] };
    mergeOfficialQuote(existing, { price: 0, changePct: null, unitLots: null, volumeLots: null, turnoverPct: null, priceStale: true });
    stocks.length = 0;
    const created = upsertStockFromQuote({ code: "9999", name: "缺價測試", price: null, changePct: null, unitLots: null, volumeLots: null });
    return JSON.stringify({ existing, created, row: rowTemplate(existing, "watchlist") });
  })()`));
  assert.equal(result.existing.price, 27.35, "0 元不能覆蓋既有好價格");
  assert.equal(result.existing.change, 4.39, "null 漲跌不能覆蓋既有漲跌");
  assert.equal(result.existing.unit, 3);
  assert.equal(result.existing.total, 20);
  assert.equal(result.created.price, null, "新股票缺價時保留 null，不偽造 0 元");
  assert.deepEqual(result.created.spark, [], "缺價時不應建立 [0, 0] 假走勢");
  assert.equal(app.evalIn(`formatSignedPercent(null)`), "--", "missing percent must not become a fake 0.00%");
  assert.equal(app.evalIn(`formatSignedPrice(null)`), "--", "missing change must not become a fake zero");
  assert.match(result.row, /quote-value positive is-stale/);
  assert.match(result.row, /quote-kind">收盤/);
  assert.match(result.row, />27\.35</);
  assert.match(result.row, /kbar red/);
  assert.match(result.row, /stroke="var\(--red\)"/);
  assert.doesNotMatch(result.row, /hot-green|▼100\.00%/);
});

test("平盤報價：清單價格、K棒與走勢線全部中性，不能顯示紅漲或綠跌", () => {
  const result = JSON.parse(app.evalIn(`(() => {
    const s = { code: "2330", name: "台積電", spark: [100, 100.004], strategies: [], groups: ["watch"],
      unit: 1, total: 10, turnover: 0, avgVol: 0, change: 0, changeText: "" };
    mergeOfficialQuote(s, { price: 100.004, changePct: 0.004, sourceKind: "realtime" });
    const row = rowTemplate(s, "watchlist");
    return JSON.stringify({ signal: s.signal, text: s.changeText, row });
  })()`));
  assert.equal(result.signal, "white");
  assert.equal(result.text, "0.00%");
  assert.match(result.row, /kbar white/);
  assert.match(result.row, /quote-value muted/);
  assert.match(result.row, /stroke="#aab4be"/);
  assert.doesNotMatch(result.row, /quote-value positive|quote-value negative/);
});

test("策略與處置卡的 0.00% 同樣使用 muted，不各自判成上漲", () => {
  const result = JSON.parse(app.evalIn(`(() => {
    strategyState.asOf = "2026-07-13";
    const swing = renderSwingCard({
      code: "2330", name: "台積電", market: "上市", price: 100, changePct: 0.004,
      score: 70, rank: 1, avgVolLots: 1000, plan: {}, scenario: {}, indicators: {},
    });
    const surveillance = survCard({
      code: "2233", name: "宇隆", exchange: "TWSE", interval: 5,
      price: 100, changePct: -0.004, daysToRelease: 1,
    }, "inDisposition");
    return JSON.stringify({ swing, surveillance });
  })()`));
  assert.match(result.swing, /swing-chg muted">0\.00%/);
  assert.match(result.surveillance, /surv-card-quote muted/);
  assert.doesNotMatch(result.swing, /swing-chg positive|swing-chg negative/);
});

test("upsertStockFromQuote：走勢種子＝[昨收, 開盤, 現價]（時間順序確定的三點），缺值自動縮短", () => {
  const spark3 = JSON.parse(app.evalIn(`(() => {
    stocks.length = 0;
    const s = upsertStockFromQuote({ code: "1101", name: "台泥", price: 101, previousClose: 99.5, open: 100, changePct: 1.5 });
    return JSON.stringify(s.spark);
  })()`));
  assert.deepEqual(spark3, [99.5, 100, 101]);
  const spark2 = JSON.parse(app.evalIn(`(() => {
    stocks.length = 0;
    const s = upsertStockFromQuote({ code: "1102", name: "亞泥", price: 50, changePct: 0 });
    return JSON.stringify(s.spark);
  })()`));
  assert.deepEqual(spark2, [50, 50], "只剩現價 → 补成兩點平線，不假造路徑");
});

test("formatMoney：千分位＋signed 正負號；formatRevenueYi：億/萬門檻換算", () => {
  const run = (expr) => app.evalIn(expr);
  assert.equal(run(`formatMoney(1234567)`), "1,234,567");
  assert.equal(run(`formatMoney(-1234.6)`), "-1,235");
  assert.equal(run(`formatMoney(4745, { signed: true })`), "+4,745");
  assert.equal(run(`formatMoney(-4745, { signed: true })`), "-4,745");
  assert.equal(run(`formatMoney(NaN)`), "--");
  // 千元 → 億：100,000 千元 = 1 億
  assert.equal(run(`formatRevenueYi(100000)`), "1.0 億");
  assert.equal(run(`formatRevenueYi(15000000)`), "150 億", "百億以上不帶小數");
  assert.equal(run(`formatRevenueYi(50000)`), "5,000 萬", "不足 1 億改用萬");
  assert.equal(run(`formatRevenueYi(null)`), "--");
});

test("formatTechnicalValue：整數不砍零（2150 不能變 215）；splitMetricText 拆標籤與數值", () => {
  const run = (expr) => app.evalIn(expr);
  assert.equal(run(`formatTechnicalValue(2150)`), "2150");
  assert.equal(run(`formatTechnicalValue(12.30)`), "12.3");
  // 修過的 bug：null 曾因 Number(null)=0 是有限數而顯示 "0"（放大圖前幾根算不出 MA 時會誤導）；
  // 現在 null／undefined 都顯示 "--"。
  assert.equal(run(`formatTechnicalValue(null)`), "--");
  assert.equal(run(`formatTechnicalValue(undefined)`), "--");
  assert.deepEqual(JSON.parse(run(`JSON.stringify(splitMetricText("漲幅 3.25%"))`)), { label: "漲幅", value: "3.25%" });
  assert.deepEqual(JSON.parse(run(`JSON.stringify(splitMetricText("收紅K"))`)), { label: "收紅K", value: "" });
  assert.deepEqual(JSON.parse(run(`JSON.stringify(splitMetricText("量比5 −1.2"))`)), { label: "量比5", value: "-1.2" }, "全形負號要轉半形");
});
