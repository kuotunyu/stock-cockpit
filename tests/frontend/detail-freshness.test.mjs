import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("older trading-date quote is labelled as last trade but keeps its red/green movement", () => {
  const context = json(`getQuoteDisplayContext(
    { sourceKind: "realtime", asOf: "2026/07/09 13:30:00", priceStale: false },
    new Date("2026-07-13T04:00:00+08:00")
  )`);
  assert.equal(context.label, "最後成交 07/09");
  assert.equal(context.stale, true);

  const rendered = json(`(() => {
    const stock = {
      code: "2330", name: "台積電", exchange: "TWSE", official: true,
      sourceKind: "realtime", source: "TWSE MIS", asOf: "2000/01/01 13:30:00",
      priceStale: false, price: 100, change: 1, priceChange: 1, unit: 10, total: 1000,
      open: 99, high: 101, low: 98, previousClose: 99, spark: [99, 100],
      groups: [], strategies: [], avgVol: 0, turnover: 0, institutional: null,
    };
    stocks.length = 0;
    stocks.push(stock);
    state.selectedCode = stock.code;
    renderDetail();
    return {
      tags: document.getElementById("detailTags").textContent,
      heroBackground: document.querySelector(".price-hero > div:first-child").style.background,
    };
  })()`);
  assert.match(rendered.tags, /最後成交 01\/01/);
  assert.equal(rendered.heroBackground, "var(--up-surface)", "有明確 +1% 漲幅時，即使是上一交易日最後成交也要維持紅漲");
});

test("missing live price keeps the close label but still uses its valid red/green direction", () => {
  const rendered = JSON.parse(app.evalIn(`(() => {
    const stock = {
      code: "2330", name: "台積電", exchange: "TWSE", official: true,
      sourceKind: "realtime", source: "TWSE MIS", asOf: "2026/07/13 13:30:00",
      priceStale: true, price: 100, change: 1, priceChange: 1, unit: 10, total: 1000,
      open: 99, high: 101, low: 98, previousClose: 99, spark: [99, 100],
      groups: [], strategies: [], avgVol: 0, turnover: 0, institutional: null,
    };
    stocks.length = 0;
    stocks.push(stock);
    state.selectedCode = stock.code;
    renderDetail();
    return JSON.stringify({
      background: document.querySelector(".price-hero > div:first-child").style.background,
      tags: document.getElementById("detailTags").textContent,
      change: document.getElementById("detailChange").textContent,
    });
  })()`));
  assert.equal(rendered.background, "var(--up-surface)");
  // 盤中與盤後的文案不同，但兩者都必須清楚揭露這不是即時成交價。
  assert.match(rendered.tags, /(?:07\/13 收盤|暫無即時成交・顯示昨收)/);
  assert.match(rendered.change, /收盤 \+1/);
});

test("today's realtime quote keeps the live label", () => {
  const context = json(`(() => {
    const now = new Date("2026-07-13T10:00:00+08:00");
    return getQuoteDisplayContext(
      { sourceKind: "realtime", asOf: "2026/07/13 10:00:00", priceStale: false },
      now
    );
  })()`);
  assert.equal(context.label, "盤中即時");
  assert.equal(context.stale, false);
});
