// Number(null)===0 造假價格的前端防線，以及「載入更多」的焦點回歸。
// 2026-07-25 實測到的三個真實破口：
//   1. checkPriceAlerts／eligibleAlertQuoteCodes 用 Number(stock.price)，無報價的檔位會以「現價 0」
//      立刻誤觸發所有跌破提醒，並把 alert 標成已觸發 → 真正到價時反而不再提醒。
//   2. renderHoldingsPanel 同一個陷阱 → 市值 0、未實現＝全額虧損，還會混進投組總計。
//   3.「載入更多」按鈕真實點擊後焦點留在 button 上，renderHoldingsPanel 為保護表單而 early-return，
//      畫面完全不動；jsdom 的 .click() 不移動焦點，所以舊測試看不出來。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

const STOCK_BASE = {
  groups: [], strategies: [], spark: [], change: 0, changeText: "0%",
  signal: "flat", unit: 0, total: 0, turnover: 0, avgVol: 0,
};

test("到價提醒：沒有成交價的檔位不得以「現價 0」誤觸發", () => {
  const result = json(`(() => {
    stocks.length = 0;
    stocks.push({ ...${JSON.stringify(STOCK_BASE)}, code: "2330", name: "台積電", price: null, priceStale: false });
    priceAlertsState.alerts = [
      { id: "a1", code: "2330", op: "<=", price: 900, active: true, triggeredAt: "" },
      { id: "a2", code: "2330", op: ">=", price: 900, active: true, triggeredAt: "" },
    ];
    const fired = checkPriceAlerts(null, { renderNow: false });
    return {
      fired,
      stillActive: priceAlertsState.alerts.map((alert) => alert.active),
      triggered: priceAlertsState.alerts.map((alert) => alert.triggeredAt),
    };
  })()`);
  assert.equal(result.fired, 0, "無成交價時不得觸發任何提醒");
  assert.deepEqual(result.stillActive, [true, true], "提醒必須保持有效，等真正到價");
  assert.deepEqual(result.triggered, ["", ""], "不得自我標記已觸發");
});

test("到價提醒：有正成交價時仍照常觸發（防線不可過度收緊）", () => {
  const result = json(`(() => {
    stocks.length = 0;
    stocks.push({ ...${JSON.stringify(STOCK_BASE)}, code: "2330", name: "台積電", price: 880, priceStale: false });
    priceAlertsState.alerts = [{ id: "a1", code: "2330", op: "<=", price: 900, active: true, triggeredAt: "" }];
    const fired = checkPriceAlerts(null, { renderNow: false });
    return { fired, active: priceAlertsState.alerts[0].active };
  })()`);
  assert.equal(result.fired, 1);
  assert.equal(result.active, false);
});

test("eligibleAlertQuoteCodes：price 為 null 的即時報價不算合格報價", () => {
  const codes = json(`(() => {
    const today = getTaiwanClockParts().isoDate;
    return [...eligibleAlertQuoteCodes([
      { code: "2330", sourceKind: "realtime", priceStale: false, price: null, asOf: today },
      { code: "1101", sourceKind: "realtime", priceStale: false, price: 0, asOf: today },
      { code: "2454", sourceKind: "realtime", priceStale: false, price: 1200, asOf: today },
    ])];
  })()`);
  assert.deepEqual(codes, ["2454"], "只有真正有正成交價的檔位才算合格");
});

test("庫存損益：無報價的持股顯示未報價，不得算成市值 0／全額虧損", () => {
  const result = json(`(() => {
    authState.user = { id: "u1", username: "admin", role: "admin" };
    state.screen = "watchlist";
    state.watchList = "hold";
    stocks.length = 0;
    stocks.push({ ...${JSON.stringify(STOCK_BASE)}, code: "2330", name: "台積電", price: null, priceStale: false });
    tradesState.schemaVersion = 2;
    tradesState.records = [];
    tradesState.portfolio = {
      holdings: [{ code: "2330", name: "台積電", shares: 1000, cost: 900000, avgPrice: 900 }],
      realized: [],
    };
    renderHoldingsPanel();
    const text = el.holdingsPanel.textContent.replace(/\\s+/g, "");
    return {
      mentionsUnpriced: text.includes("1檔暫無報價"),
      rowShowsDashPrice: text.includes("現價--"),
      rowShowsDashValue: text.includes("市值--"),
      rowShowsDashUnrealized: text.includes("未實現--"),
      fabricatedFullLoss: text.includes("未實現-900,000"),
    };
  })()`);
  assert.equal(result.mentionsUnpriced, true, "應計入『暫無報價』而不是給假數字");
  assert.equal(result.rowShowsDashPrice, true, "現價須顯示 --");
  assert.equal(result.rowShowsDashValue, true, "市值須顯示 --");
  assert.equal(result.rowShowsDashUnrealized, true, "未實現須顯示 --");
  assert.equal(result.fabricatedFullLoss, false, "不得把成本整包算成未實現虧損");
});

test("「載入更多」：真實點擊（焦點在按鈕上）也必須真的展開列表", () => {
  const result = json(`(() => {
    authState.user = { id: "u1", username: "admin", role: "admin" };
    state.screen = "watchlist";
    state.watchList = "hold";
    tradesState.schemaVersion = 2;
    tradesState.records = Array.from({ length: 90 }, (_, index) => ({
      id: "r" + index, code: "2330", name: "台積電", side: "buy", instrumentType: "stock",
      tradeDate: "2026-07-01", price: 100, shares: 1000, createdAt: "2026-07-01T00:00:00Z",
    }));
    tradesState.portfolio = { holdings: [], realized: [] };
    tradesHistoryLimit = 40;
    renderHoldingsPanel();
    const countRows = () => document.querySelectorAll("[data-trade-edit]").length;
    const before = countRows();
    const button = document.querySelector("[data-trade-load-more]");
    button.focus(); // 真實瀏覽器點擊會做這件事
    const focusedBeforeClick = document.activeElement === button;
    button.click();
    return { before, focusedBeforeClick, after: countRows(), limit: tradesHistoryLimit };
  })()`);
  assert.equal(result.before, 40, "預設顯示 40 筆");
  assert.equal(result.focusedBeforeClick, true, "前提：點擊時焦點在按鈕上");
  assert.equal(result.limit, 80);
  assert.equal(result.after, 80, "焦點在按鈕上時畫面仍必須重繪出 80 筆");
});
