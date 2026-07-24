// 選股清單的過濾與排序（filterStocks/getSortValue/stockMatchesWatchFilter）：
// 方向/週轉率/只看自選/處置開關の疊加，與表頭五鍵排序（同值以代號穩定排序）。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
  // 種四檔測試股（C 帶注意股標記、D 不屬於 strong 池）；策略設成不存在 → 走 groups 過濾路徑。
  app.evalIn(`
    stocks.length = 0;
    stocks.push(
      { code: "1101", name: "台泥", change: 2, turnover: 6, total: 500, unit: 1, high: 40, price: 39, avgVol: 1, spark: [38, 39], groups: ["strong"], strategies: [], surveillance: null },
      { code: "2330", name: "台積電", change: -1, turnover: 2, total: 9000, unit: 5, high: 1010, price: 1000, avgVol: 2, spark: [1010, 1000], groups: ["strong"], strategies: [], surveillance: null },
      { code: "3008", name: "大立光", change: 5, turnover: 12, total: 3000, unit: 2, high: 2000, price: 1990, avgVol: 4, spark: [1900, 1990], groups: ["strong"], strategies: [], surveillance: { kind: "attention", label: "注意" } },
      { code: "9999", name: "別池", change: 1, turnover: 1, total: 100, unit: 1, high: 10, price: 9, avgVol: 1, spark: [9, 9], groups: ["weak"], strategies: [], surveillance: null },
    );
    state.universe = "strong"; state.strategy = "＿不存在的策略＿";
    state.sort = "flow"; state.sortDir = "desc";
    state.direction = "all"; state.minTurnover = 0; state.watchOnly = false; state.showSurveillance = true;
    // auth 隔離後，離線 harness 不再可依賴 app.js 的展示用預設清單；本測試明確建立「只看自選」fixture。
    watchLists[1] = new Set(["2330", "0050"]);
  `);
});
after(() => app.cleanup());

const codes = (setup = "") => JSON.parse(app.evalIn(`(() => {
  ${setup}
  return JSON.stringify(filterStocks("screener").map(s => s.code));
})()`));

test("filterStocks：universe 池過濾＋預設總量排序（大→小）", () => {
  assert.deepEqual(codes(), ["2330", "3008", "1101"], "9999 不在 strong 池；依 total 遞減");
});

test("filterStocks：方向（漲/跌）、週轉率下限、只看自選、隱藏注意/處置 各自生效", () => {
  assert.deepEqual(codes(`state.direction = "up";`), ["3008", "1101"]);
  assert.deepEqual(codes(`state.direction = "down";`), ["2330"]);
  assert.deepEqual(codes(`state.direction = "all"; state.minTurnover = 5;`), ["3008", "1101"]);
  assert.deepEqual(codes(`state.minTurnover = 0; state.watchOnly = true;`), ["2330"], "預設清單 1 只有 2330/0050");
  assert.deepEqual(codes(`state.watchOnly = false; state.showSurveillance = false;`), ["2330", "1101"], "關掉開關 → 注意股 3008 隱藏");
  app.evalIn(`state.showSurveillance = true;`);
});

test("filterStocks：表頭五鍵排序與昇冪切換", () => {
  assert.deepEqual(codes(`state.sort = "price"; state.sortDir = "desc";`), ["3008", "1101", "2330"], "price 鍵＝漲跌幅");
  assert.deepEqual(codes(`state.sort = "price"; state.sortDir = "asc";`), ["2330", "1101", "3008"]);
  assert.deepEqual(codes(`state.sort = "signal"; state.sortDir = "asc";`), ["1101", "2330", "3008"], "signal 鍵＝代號數值");
  assert.deepEqual(codes(`state.sort = "stage"; state.sortDir = "desc";`), ["3008", "2330", "1101"], "stage 鍵＝最高價");
  assert.deepEqual(codes(`state.sort = "turnover"; state.sortDir = "desc";`), ["3008", "1101", "2330"]);
  app.evalIn(`state.sort = "flow"; state.sortDir = "desc";`);
});

test("filterStocks：排序同值時以代號穩定排序（不會隨機跳動）", () => {
  const order = codes(`
    stocks.find(s => s.code === "1101").total = 3000; // 與 3008 同總量
    state.sort = "flow"; state.sortDir = "desc";
  `);
  assert.deepEqual(order, ["2330", "1101", "3008"], "3000 平手 → 1101 在 3008 前（代號序）");
  app.evalIn(`stocks.find(s => s.code === "1101").total = 500;`);
});

test("getSortValue：stage 鍵的最高價排序（high 缺值一律退回現價）；未知鍵退回總量", () => {
  const val = (stock, key) => Number(app.evalIn(`getSortValue(${JSON.stringify(stock)}, ${JSON.stringify(key)})`));
  assert.equal(val({ code: "2330", high: 100, price: 99, total: 5 }, "stage"), 100);
  // 修過的 bug：high=null 曾因 Number(null)=0 是有限數而排序值變 0；現在 null／undefined 都退回現價。
  assert.equal(val({ code: "2330", high: null, price: 99, total: 5 }, "stage"), 99, "high=null 退回現價");
  assert.equal(val({ code: "2330", price: 99, total: 5 }, "stage"), 99, "high=undefined 退回現價");
  assert.equal(val({ code: "2330", total: 777 }, "unknown-key"), 777);
});

test("stockMatchesWatchFilter：強波動三擇一門檻（|漲跌|≥5 或 量比≥3 或 週轉≥5）", () => {
  const hit = (stock, filter) => app.evalIn(`stockMatchesWatchFilter(${JSON.stringify(stock)}, ${JSON.stringify(filter)})`);
  assert.equal(hit({ change: 5.1, avgVol: 0, turnover: 0 }, "active"), true);
  assert.equal(hit({ change: -5.1, avgVol: 0, turnover: 0 }, "active"), true, "跌深也是強波動");
  assert.equal(hit({ change: 0, avgVol: 3, turnover: 0 }, "active"), true);
  assert.equal(hit({ change: 0, avgVol: 0, turnover: 5 }, "active"), true);
  assert.equal(hit({ change: 4.9, avgVol: 2.9, turnover: 4.9 }, "active"), false);
  assert.equal(hit({ change: 0.1 }, "up"), true);
  assert.equal(hit({ change: 0 }, "up"), false, "平盤不算上漲");
  assert.equal(hit({ change: -0.1 }, "down"), true);
});
