// Number(null)===0 造假價格的前端防線，以及「載入更多」的焦點回歸。
// 2026-07-25 實測到的三個真實破口：
//   1. checkPriceAlerts／eligibleAlertQuoteCodes 用 Number(stock.price)，無報價的檔位會以「現價 0」
//      立刻誤觸發所有跌破提醒，並把 alert 標成已觸發 → 真正到價時反而不再提醒。
//   2. renderHoldingsPanel 同一個陷阱 → 市值 0、未實現＝全額虧損，還會混進投組總計。
//   3.「載入更多」按鈕真實點擊後焦點留在 button 上，renderHoldingsPanel 為保護表單而 early-return，
//      畫面完全不動；jsdom 的 .click() 不移動焦點，所以舊測試看不出來。
// 2026-09-09 CUA-01 再補一個同類破口：均量比（wire 欄位 metrics.volumeRatio5，合法可為 null）
//      在 upsertStockFromQuote 硬寫 0、在 upsertStockFromPick 用 || 壓成 0，量價摘要於是把
//      「沒資料」畫成「均量比 0・量能狀態一般・估算可用」。修法在入口保留 null，評分門檻沿用 0 語意不變。
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

// ---- CUA-01：均量比缺值不得被當成 0 ----

const metricOf = (detail, label) => detail.metrics.find((metric) => metric.label === label);

const quoteFixture = (code, over = {}) => JSON.stringify({
  code, name: `合成${code}`, exchange: "TWSE", price: 40, previousClose: 39.5, open: 39.6, high: 40.5, low: 39.4,
  change: 0.5, changePct: 1.27, unitLots: 10, volumeLots: 100, turnoverPct: 0.3,
  source: "TWSE 測試", sourceKind: "realtime", asOf: "2026/09/08 13:30:00", priceStale: false, ...over,
});

const pickFixture = (code, volumeRatio5) => JSON.stringify({
  code, name: `合成${code}`, exchange: "TWSE", market: "上市", price: 50, changePct: 2, volumeLots: 800, score: 80,
  group: "strongContinuation", groupName: "強勢續攻", asOf: "2026-09-08", source: "fixture",
  metrics: { volumeRatio5, closePosition: 0.8, turnover: 1.2 },
});

test("量價摘要：/api/quotes 建立的股票沒有均量比，不得顯示 0 與一般量能", () => {
  const result = json(`(() => {
    stocks.length = 0;
    upsertStockFromQuote(${quoteFixture("1101")});
    const stock = stocks.find((item) => item.code === "1101");
    return { avgVol: stock.avgVol, detail: buildIndicatorDetail(stock)["量價摘要"] };
  })()`);
  assert.equal(result.avgVol, null, "報價 API 沒有均量比，入口不得補 0");
  assert.equal(metricOf(result.detail, "均量比").value, "--");
  assert.equal(result.detail.status, "部分資料");
  assert.doesNotMatch(result.detail.note, /量能狀態：一般/, "缺值不得判成一般量能");
  assert.equal(metricOf(result.detail, "總量").value, "100", "已知的總量仍要顯示");
  assert.equal(metricOf(result.detail, "單量").value, "10");
});

test("upsertStockFromPick：volumeRatio5 缺值保留未知、有值才覆寫、合法 0 不被丟掉", () => {
  const sequence = json(`(() => {
    stocks.length = 0;
    const read = () => stocks.find((item) => item.code === "1102").avgVol;
    const out = [];
    upsertStockFromPick(${pickFixture("1102", null)}); out.push(read());
    upsertStockFromPick(${pickFixture("1102", 1.98)}); out.push(read());
    upsertStockFromPick(${pickFixture("1102", null)}); out.push(read());
    upsertStockFromPick(${pickFixture("1102", 0)}); out.push(read());
    return out;
  })()`);
  assert.deepEqual(sequence, [null, 1.98, 1.98, 0]);
});

test("upsertStockFromPick：報價建立的股票再收到訊號時，同樣的缺值／覆寫／合法 0 規則", () => {
  const sequence = json(`(() => {
    stocks.length = 0;
    const read = () => stocks.find((item) => item.code === "1103").avgVol;
    const out = [];
    upsertStockFromQuote(${quoteFixture("1103")}); out.push(read());
    upsertStockFromPick(${pickFixture("1103", 1.98)}); out.push(read());
    upsertStockFromPick(${pickFixture("1103", null)}); out.push(read());
    upsertStockFromPick(${pickFixture("1103", 0)}); out.push(read());
    return out;
  })()`);
  assert.deepEqual(sequence, [null, 1.98, 1.98, 0]);
});

test("量價摘要：均量比 null／0／1.49／1.5／3 的值、色調與狀態", () => {
  const rows = json(`(() => [null, 0, 1.49, 1.5, 3].map((avgVol) => {
    const detail = buildIndicatorDetail({ ...${JSON.stringify(STOCK_BASE)}, code: "1104", name: "合成", price: 100, spark: [100], unit: 10, total: 100, avgVol })["量價摘要"];
    const metric = detail.metrics.find((item) => item.label === "均量比");
    return { avgVol, value: metric.value, tone: metric.tone, status: detail.status, statusTone: detail.statusTone, note: detail.note };
  }))()`);
  const byAvg = Object.fromEntries(rows.map((row) => [String(row.avgVol), row]));
  assert.equal(byAvg.null.value, "--");
  assert.equal(byAvg.null.tone, "muted");
  assert.equal(byAvg.null.status, "部分資料");
  assert.equal(byAvg.null.statusTone, "pending");
  assert.match(byAvg.null.note, /尚未取得/);
  assert.doesNotMatch(byAvg.null.note, /量能狀態：/);
  assert.equal(byAvg["0"].value, "0", "合法 0 不得被改成未知");
  assert.equal(byAvg["0"].tone, "muted");
  assert.equal(byAvg["0"].status, "估算可用");
  assert.match(byAvg["0"].note, /量能狀態：一般/);
  assert.equal(byAvg["1.49"].value, "1.49");
  assert.equal(byAvg["1.49"].tone, "muted");
  assert.equal(byAvg["1.5"].value, "1.5");
  assert.equal(byAvg["1.5"].tone, "positive");
  assert.match(byAvg["1.5"].note, /量能狀態：放量/);
  assert.equal(byAvg["3"].value, "3");
  assert.equal(byAvg["3"].tone, "warning");
  assert.match(byAvg["3"].note, /量能狀態：爆量/);
});

test("量價摘要：單量／總量缺值顯示 --，狀態降為部分資料；已知 0 仍是 0", () => {
  const rows = json(`(() => [
    { unit: null, total: 100 },
    { unit: 10, total: null },
    { unit: 0, total: 100 },
  ].map((over) => {
    const detail = buildIndicatorDetail({ ...${JSON.stringify(STOCK_BASE)}, code: "1105", name: "合成", price: 100, spark: [100], avgVol: 1, ...over })["量價摘要"];
    return { over, unit: detail.metrics.find((m) => m.label === "單量").value, total: detail.metrics.find((m) => m.label === "總量").value,
      share: detail.metrics.find((m) => m.label === "單量占比").value, status: detail.status };
  }))()`);
  assert.deepEqual(rows[0], { over: { unit: null, total: 100 }, unit: "--", total: "100", share: "無法計算", status: "部分資料" });
  assert.deepEqual(rows[1], { over: { unit: 10, total: null }, unit: "10", total: "--", share: "無法計算", status: "部分資料" });
  assert.deepEqual(rows[2], { over: { unit: 0, total: 100 }, unit: "0", total: "100", share: "0%", status: "估算可用" });
});

test("評分與分類：avgVol 未知與 0 的結果必須相同（不改選股門檻）", () => {
  const probes = json(`(() => {
    const base = { ...${JSON.stringify(STOCK_BASE)}, code: "1106", name: "合成", price: 100, spark: [98, 99, 100], change: 2.4,
      unit: 30, total: 3000, flow: 1500, turnover: 4, stage: 1, slope: 3, streak: 5, signal: "up",
      groups: ["overnight", "watch"], strategies: ["強勢續攻"] };
    const labels = getAllStrategyMeta().map((meta) => meta.label);
    const probe = (avgVol) => {
      const stock = { ...base, avgVol };
      return {
        intraday: stockIntradayScore(stock),
        matches: labels.map((label) => [label, stockMatchesStrategy(stock, label)]),
        strategyScore: getStrategyScore(stock),
        reason: getStockReason(stock, "screener"),
        watchActive: stockMatchesWatchFilter(stock, "active"),
        row: rowTemplate(stock, "watchlist"),
        risk: buildIndicatorDetail(stock)["風險提醒"].metrics,
      };
    };
    return { unknown: probe(null), zero: probe(0) };
  })()`);
  assert.deepEqual(probes.unknown, probes.zero);
});

// ---- 第五批 ②：隔日沖訊號建立的股票沒有「單量」，入口不得硬寫 0 ----

test("upsertStockFromPick：訊號沒有單量欄位 → unit 保留未知，列表與明細顯示 --，總量照常；報價到了才有值", () => {
  const result = json(`(() => {
    stocks.length = 0;
    upsertStockFromPick(${pickFixture("1106", 1.8)});
    const stock = stocks.find((item) => item.code === "1106");
    const detail = buildIndicatorDetail(stock)["量價摘要"];
    const row = rowTemplate(stock, "watchlist");
    const flowCell = (row.match(/<span class="stock-cell metric-stack[^"]*">\\s*<span>([^<]*)<\\/span>\\s*<span class="flow-split">/) || [])[1] || "";
    // 先記下訊號階段的值：之後的報價會就地合併到同一個物件。
    const unitBefore = stock.unit; const totalBefore = stock.total;
    upsertStockFromQuote(${quoteFixture("1106")});
    const after = stocks.find((item) => item.code === "1106");
    return {
      unit: unitBefore, total: totalBefore,
      detailUnit: detail.metrics.find((m) => m.label === "單量").value,
      detailShare: detail.metrics.find((m) => m.label === "單量占比").value,
      detailTotal: detail.metrics.find((m) => m.label === "總量").value,
      status: detail.status,
      flowCell,
      unitAfterQuote: after.unit,
    };
  })()`);
  assert.equal(result.unit, null, "訊號 API 沒有單量，入口不得補 0");
  assert.equal(result.total, 800, "總量來自 volumeLots，照常保留");
  assert.equal(result.detailUnit, "--");
  assert.equal(result.detailShare, "無法計算", "沒有單量就不能算單量占比（不得算成 0%）");
  assert.equal(result.detailTotal, "800");
  assert.equal(result.status, "部分資料");
  assert.equal(result.flowCell, "--", "列表單量欄顯示 --，不是 0");
  assert.equal(result.unitAfterQuote, 10, "官方報價到了就用報價的單量");
});

test("評分與分類：unit 未知與 0 的結果必須相同（單量不參與門檻）", () => {
  const same = json(`(() => {
    const base = { ...${JSON.stringify(STOCK_BASE)}, code: "1107", name: "合成", price: 100, spark: [98, 100], total: 800, avgVol: 1.8, turnover: 1.2, flow: 120, streak: 80, stage: 1.8, slope: 8, groups: ["overnight"], strategies: ["強勢續攻"] };
    const compute = (unit) => {
      const stock = { ...base, unit };
      return {
        intraday: stockIntradayScore(stock),
        strategyScore: getStrategyScore(stock),
        reason: getStockReason(stock),
        matches: ["momentum", "breakout", "pullback", "volume"].map((key) => { try { return stockMatchesStrategy(stock, key); } catch { return "n/a"; } }),
      };
    };
    return { asNull: compute(null), asZero: compute(0) };
  })()`);
  assert.deepEqual(same.asNull, same.asZero);
});
