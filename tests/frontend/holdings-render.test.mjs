// 庫存損益前端：面板三態（未登入/空/有持股）、未實現損益配對即時價、CSS 開關 class、交易紀錄列。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

function seed({ portfolio, records = [], stocksRows = [] }) {
  const rows = stocksRows.map((row) => ({ groups: [], strategies: [], spark: [], ...row }));
  app.evalIn(`
    tradesState.portfolio = ${JSON.stringify(portfolio)};
    tradesState.records = ${JSON.stringify(records)};
    tradesState.loaded = true;
    stocks.length = 0;
    ${JSON.stringify(rows)}.forEach((row) => stocks.push(row));
  `);
}

test("watchList=hold 才顯示，並在 watchlist screen 掛上 is-holdings 開關", () => {
  app.evalIn(`state.watchList = "1"; renderHoldingsPanel();`);
  assert.equal(json(`el.holdingsPanel.hidden`), true);
  assert.equal(json(`document.querySelector('[data-screen-panel="watchlist"]').classList.contains("is-holdings")`), false);
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  assert.equal(json(`el.holdingsPanel.hidden`), false);
  assert.equal(json(`document.querySelector('[data-screen-panel="watchlist"]').classList.contains("is-holdings")`), true);
});

test("庫存分頁維持產品名稱，不可被渲染成清單 hold", () => {
  app.evalIn(`state.watchList = "hold"; renderWatchTabs();`);
  const text = app.evalIn(`document.querySelector('[data-watch-list="hold"]').textContent`).replace(/\s+/g, " ").trim();
  assert.equal(text, "庫存損益");
});

test("有持股：未實現損益＝(現價−均價成本)，總覽四格與正紅負綠", () => {
  seed({
    portfolio: {
      ok: true,
      holdings: [
        { code: "2330", shares: 500, avgCost: 100.09, cost: 50043 },
        { code: "1101", shares: 2000, avgCost: 40, cost: 80000 },
      ],
      realized: [{ id: "t2", code: "2330", date: "20260620", shares: 500, sellPrice: 110, avgCost: 100.09, pnl: 4745, pnlPct: 9.48 }],
      totals: { cost: 130043, realizedPnl: 4745 },
    },
    records: [
      { id: "t1", code: "2330", side: "buy", date: "20260610", price: 100, shares: 1000, fee: 86, tax: 0 },
      { id: "t2", code: "2330", side: "sell", date: "20260620", price: 110, shares: 500, fee: 47, tax: 165 },
    ],
    stocksRows: [
      { code: "2330", name: "台積電", price: 110 },   // 未實現 = 110×500 − 50043 = +4,957
      { code: "1101", name: "台泥", price: 38 },      // 未實現 = 38×2000 − 80000 = −4,000
    ],
  });
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  const text = app.evalIn(`el.holdingsPanel.textContent`).replace(/\s+/g, " ");
  assert.ok(text.includes("+4,957"), `2330 未實現：${text.slice(0, 200)}`);
  assert.ok(text.includes("-4,000"), "1101 未實現虧損");
  assert.ok(text.includes("+4,745"), "已實現累計");
  assert.equal(json(`el.holdingsPanel.querySelectorAll('.hold-row').length`), 2);
  assert.equal(json(`el.holdingsPanel.querySelectorAll('.hold-pnl.is-up').length`), 1);
  assert.equal(json(`el.holdingsPanel.querySelectorAll('.hold-pnl.is-down').length`), 1);
  // 交易紀錄：2 筆、賣出列帶已實現、有刪除鈕
  assert.equal(json(`el.holdingsPanel.querySelectorAll('.trade-row').length`), 2);
  assert.equal(json(`el.holdingsPanel.querySelectorAll('[data-trade-remove]').length`), 2);
  assert.equal(json(`!!el.holdingsPanel.querySelector('[data-trade-form]')`), true, "要有記一筆表單");
});

test("暫無報價的持股：不計入市值、顯示 -- 並提示", () => {
  seed({
    portfolio: {
      ok: true,
      holdings: [{ code: "9999", shares: 1000, avgCost: 50, cost: 50000 }],
      realized: [],
      totals: { cost: 50000, realizedPnl: 0 },
    },
    stocksRows: [],
  });
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  const text = app.evalIn(`el.holdingsPanel.textContent`);
  assert.ok(text.includes("暫無報價"), "要提示未計入");
});

test("除息整合：已入帳事件顯示狀態、不再重複提供快速鈕、股利保留六位小數", () => {
  seed({
    portfolio: {
      ok: true,
      holdings: [{
        code: "2330", shares: 1000, avgCost: 100, cost: 100000,
        dividendsRecognizedGross: 3123.456, dividendsReceivableGross: 0, dividends: 3113.456,
      }],
      realized: [],
      totals: {
        cost: 100000, realizedPnl: 0,
        dividendRecognizedGross: 3123.456, dividendReceivableGross: 0, dividendReceivedNet: 3113.456,
      },
    },
    records: [
      { id: "b1", code: "2330", side: "buy", date: "20260630", price: 100, shares: 1000, fee: 86, tax: 0 },
      {
        id: "div:TWSE:2330:20260702", eventId: "cash-dividend:TWSE:2330:20260702", code: "2330", side: "dividend",
        status: "received", date: "20260702", exDate: "20260702", price: 3.123456, shares: 1000,
        fee: 10, tax: 0, receivedDate: "20260710", receivedAmount: 3113.456,
      },
    ],
    stocksRows: [{
      code: "2330", name: "台積電", price: 97,
      exchange: "TWSE",
      dividend: { exDate: "2026-07-02", kind: "除息", cash: 3.123456, stockRatio: 0, isToday: true, daysUntil: 0 },
    }],
  });
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  const html = app.evalIn(`el.holdingsPanel.innerHTML`);
  assert.ok(html.includes("hold-exdiv"), "要有除息 chip");
  assert.ok(!html.includes("data-dividend-quick"), "同一官方事件已記錄，不可再提供快速鈕");
  const text = app.evalIn(`el.holdingsPanel.textContent`).replace(/\s+/g, " ");
  assert.ok(text.includes("已入帳"), "chip 或紀錄要明示股利已入帳");
  assert.ok(text.includes("已認列毛額"), "總覽要顯示權利認列毛額");
  assert.ok(text.includes("已入帳淨額"), "總覽要把實收淨額獨立呈現");
  assert.ok(text.includes("3,113"), "實收淨額要依 receivedAmount 呈現");
  assert.ok(text.includes("每股 3.123456"), "股利紀錄列不可把細位數砍成兩位");
});

test("股利權利股數：只算除息日前買賣，除息日買進不算", () => {
  seed({
    portfolio: {
      ok: true,
      holdings: [{ code: "2330", shares: 1200, avgCost: 100, cost: 120000 }],
      realized: [], totals: { cost: 120000, realizedPnl: 0 },
    },
    records: [
      { id: "b1", code: "2330", side: "buy", date: "20260630", price: 100, shares: 1000 },
      { id: "s1", code: "2330", side: "sell", date: "20260701", price: 101, shares: 400 },
      { id: "b2", code: "2330", side: "buy", date: "20260702", price: 97, shares: 600 },
    ],
    stocksRows: [{
      code: "2330", name: "台積電", exchange: "TWSE", price: 97,
      dividend: { exDate: "2026-07-02", kind: "除息", cash: 3, isToday: true, daysUntil: 0 },
    }],
  });
  assert.equal(json(`dividendEntitlementShares(tradesState.records, "2330", "2026-07-02")`), 600);
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  assert.equal(json(`el.holdingsPanel.querySelector('[data-dividend-quick]').dataset.shares`), "600");
  assert.ok(app.evalIn(`el.holdingsPanel.textContent`).includes("記應收股利 · 600 股"));
});

test("除息日已賣光仍保留權利：在空庫存上方提供快速記錄", () => {
  seed({
    portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0 } },
    records: [
      { id: "b1", code: "2330", side: "buy", date: "20260630", price: 100, shares: 1000 },
      { id: "s1", code: "2330", side: "sell", date: "20260702", price: 97, shares: 1000 },
    ],
    stocksRows: [{
      code: "2330", name: "台積電", exchange: "TWSE", price: 97,
      dividend: { exDate: "2026-07-02", kind: "除息", cash: 3, isToday: true, daysUntil: 0 },
    }],
  });
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  assert.equal(json(`el.holdingsPanel.querySelector('[data-dividend-quick]').dataset.shares`), "1000");
  const text = app.evalIn(`el.holdingsPanel.textContent`).replace(/\s+/g, " ");
  assert.ok(text.includes("即使今天已賣出"), text);
});

test("交易日期以台北今天為上限，且提交時會攔截無效或未來日期", async () => {
  seed({ portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0 } } });
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  const todayIso = app.evalIn(`getTaiwanClockParts().isoDate`);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[name="date"]').max`), todayIso);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[name="date"]').value`), todayIso);
  assert.equal(app.evalIn(`isValidTradeDateInput("2024-02-29", "2024-02-29")`), true, "閏日是真實日期");
  assert.equal(app.evalIn(`isValidTradeDateInput("2024-02-30", "2024-03-01")`), false, "不存在的日期不可通過");
  assert.equal(app.evalIn(`isValidTradeDateInput("2024-03-02", "2024-03-01")`), false, "未來日期不可通過");

  const writesBefore = app.fetchLog.filter((entry) => entry.path.startsWith("/api/trades") && entry.method === "PUT").length;
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.code.value = "2330";
      form.elements.price.value = "100";
      form.elements.shares.value = "1000";
      const future = new Date(form.elements.date.max + "T00:00:00Z");
      future.setUTCDate(future.getUTCDate() + 1);
      form.elements.date.value = future.toISOString().slice(0, 10);
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(1);
  const writesAfter = app.fetchLog.filter((entry) => entry.path.startsWith("/api/trades") && entry.method === "PUT").length;
  assert.equal(writesAfter, writesBefore, "前端攔截後不可送出帳本寫入");
  assert.equal(app.evalIn(`document.querySelector("#toastStack .toast:last-child")?.textContent`), "請選擇有效的成交日，且不可晚於台北今天");
});

test("空庫存與未登入的空狀態", () => {
  seed({ portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0 } } });
  app.evalIn(`state.watchList = "hold"; renderHoldingsPanel();`);
  assert.ok(app.evalIn(`el.holdingsPanel.textContent`).includes("目前沒有庫存"));
  app.evalIn(`const u = authState.user; authState.user = null; renderHoldingsPanel(); authState.user = u;`);
  assert.ok(app.evalIn(`el.holdingsPanel.textContent`).includes("需要登入"));
});
