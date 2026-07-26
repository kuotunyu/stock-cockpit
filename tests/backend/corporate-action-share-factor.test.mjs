// D-29：配股／現增／減資會改變股數，成交量要按同一個倍數還原才可比。倍數推導不出來時
// 只能沿用 1，但**不可以假裝那是事實**——沿用 1 會讓事件前的均量偏低、量比偏高，
// 失效方向是「不該出現的標的出現了」（強勢續攻量比 ≥1.5、爆量高危 ≥3 都是硬門檻）。
//
// 為什麼不用「前收 ÷ 參考價」把倍數推出來（原本 backlog 的提案，實測推翻）：
// 那個等式只對純無償配股成立。實測 6 筆有現增的事件全部偏低，最大偏 14.7%
// （3149 正達：精確 1.2652、估計 1.0787）。TWT49U 的「權值＋息值」欄恆等於
// 「前收 − 參考價」，對配股與現增都成立 → 兩個未知數、一條方程式，這張表分不出來。
//
// 另一半同樣重要：**「不知道」不等於「該警告」**。上櫃沒有 TWT49U 對應端點（實測 1065 個
// 收錄代號裡只有 1 個上櫃），所以每一筆 exchange-quote 上櫃事件都沒有 kind；而全市場 90.6%
// 的事件是純除息、股數根本沒變。對它們全部掛標籤＝260 檔裡標 44 檔（實測 16.9%）＝雜訊。
// 只在拿得到正面證據說股數變了、卻量不出倍數時才標（實測降到 2 檔／0.8%）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const roc = (c) => `${Number(c.slice(0, 4)) - 1911}/${c.slice(4, 6)}/${c.slice(6, 8)}`;
const resultRow = (date, code, pre, ref, kind) =>
  [roc(date), code, "測試", String(pre), String(ref), "0", kind, "0", "0", String(ref), String(ref), "", "", "", ""];

// 2330 純除息、2454 除權（配股）、2317 除權息
const ROWS = [
  resultRow("20260610", "2330", 100, 96, "息"),
  resultRow("20260610", "2454", 100, 95.24, "權"),
  resultRow("20260610", "2317", 100, 92, "權息"),
];

const { mod, mock, dataDir } = await importServer({
  routes: [{
    match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/,
    reply: (url) => (String(url.searchParams.get("startDate") || "").startsWith("202606")
      ? { stat: "OK", data: ROWS }
      : { stat: "OK", data: [] }),
  }],
});
await mod.ensureCorporateActionResults("20260601", "20260630");
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const bar = (date, code, close, extra = {}) => ({
  date: `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}`,
  rawDate: date, code, name: "測試", exchange: "TWSE",
  open: close, high: close, low: close, close, volumeLots: 1000,
  source: "TWSE STOCK_DAY", ...extra,
});
// 三根：06/08、06/09（前收 100）、06/10（事件日）
const series = (code, eventClose, eventExtra = {}) => [
  bar("20260608", code, 100), bar("20260609", code, 100),
  bar("20260610", code, eventClose, eventExtra),
];
const resolve = (rows, actions = []) =>
  mod.resolveCorporateActionAdjustments(rows, actions, { allowHeuristicFallback: true });

test("結果表說純除息 → 股數確定沒變，不是「猜 1」", () => {
  const adj = resolve(series("2330", 96));
  assert.equal(adj.get(2).shareFactor, 1);
  assert.equal(adj.get(2).shareFactorKnown, true, "官方認定沒有配股，這是事實不是預設值");
  assert.deepEqual(adj.shareFactorUnknownIndices, []);
});

test("結果表說有權、歸檔查不到比率 → 標記出來（這是 D-29 的核心）", () => {
  for (const [code, close] of [["2454", 95.24], ["2317", 92]]) {
    const adj = resolve(series(code, close));
    assert.equal(adj.get(2).shareFactorKnown, false, `${code} 股數一定變了，但量不出倍數`);
    assert.equal(adj.get(2).shareFactor, 1, "沒有更好的值，仍沿用 1——但下游要知道那是猜的");
    assert.deepEqual(adj.shareFactorUnknownIndices, [2], `${code} 要進未知清單`);
  }
});

test("結果表說有權、歸檔給得出完整比率 → 用精確值，不標記", () => {
  const actions = [{
    exDate: "20260610", kind: "除權", cashDividend: 0, stockRatio: 0.05, subscriptionRatio: null,
    subscriptionPrice: null, formulaComplete: true, status: "active",
  }];
  const adj = resolve(series("2454", 95.24), actions);
  assert.ok(Math.abs(adj.get(2).shareFactor - 1.05) < 1e-9, "1 ＋ 配股率");
  assert.equal(adj.get(2).shareFactorKnown, true);
  assert.deepEqual(adj.shareFactorUnknownIndices, []);
});

test("上櫃 exchange-quote（沒有 kind 可查）不得掛標籤，否則 16.9% 的股票都在亮警告", () => {
  // 上櫃在除權息日的 exchangePreviousClose 就是官方參考價，偵測得到事件但拿不到 kind。
  // 全市場 90.6% 的事件是純除息、股數沒變，對它們全部示警等於沒有警告。
  const rows = series("6488", 96, { exchangePreviousClose: 96, exchange: "TPEx", source: "TPEx daily" });
  rows[0].exchange = rows[1].exchange = "TPEx";
  const adj = resolve(rows);
  assert.equal(adj.get(2)?.source, "exchange-quote", "這條路徑要走得到");
  assert.equal(adj.get(2).shareFactorKnown, false, "確實不知道");
  assert.deepEqual(adj.shareFactorUnknownIndices, [], "但沒有正面證據說股數變了 → 不標");
});

test("純跳空推測的事件要標：減資／面額變更／股票分割只走這條路", () => {
  // >10.5% 的跳空，純配息解釋不了（那要 10% 以上的殖利率）。本機歸檔不涵蓋減資與分割，
  // 所以這些事件的股數倍數從來沒有可信來源——這正是 D-29 原本的抱怨。
  const rows = [bar("20260701", "9999", 100), bar("20260702", "9999", 100), bar("20260703", "9999", 250)];
  const adj = resolve(rows);
  assert.equal(adj.get(2).source, "heuristic");
  assert.equal(adj.get(2).shareFactorKnown, false);
  assert.deepEqual(adj.shareFactorUnknownIndices, [2], "跳空推測出來的事件，股數倍數當然也是猜的");
});
