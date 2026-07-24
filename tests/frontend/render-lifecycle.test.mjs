// 前端生命週期：render 只更新作用中畫面、預覽不碰 5174、背景頁不輪詢，且較舊行情回應不得覆蓋較新資料。
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;

beforeEach(async () => {
  app = await createAppWindow();
});

afterEach(() => app.cleanup());

test("default overnight render neither rebuilds hidden screens nor starts technical lazy APIs", () => {
  const hostIds = ["screenerRows", "strategyBoard", "watchRows", "technicalSummary", "survBoard", "moreDetail"];
  const sentinels = hostIds.map((id) => {
    const host = app.doc.getElementById(id);
    const sentinel = app.doc.createElement("span");
    sentinel.dataset.renderSentinel = id;
    host.appendChild(sentinel);
    return { host, sentinel };
  });

  app.evalIn('state.screen = "overnight"; render()');

  for (const { host, sentinel } of sentinels) {
    assert.equal(sentinel.isConnected, true, `${host.id} should not be rebuilt while hidden`);
    assert.equal(sentinel.parentNode, host);
  }
  assert.equal(app.fetchLog.some(({ path }) => path.startsWith("/api/company")), false);
  assert.equal(app.fetchLog.some(({ path }) => path.startsWith("/api/fundamentals")), false);
});

test("entering a screen renders it from current state while preserving every other hidden screen", () => {
  const activeHost = app.doc.getElementById("screenerRows");
  const activeSentinel = app.doc.createElement("span");
  activeHost.appendChild(activeSentinel);
  const hiddenHost = app.doc.getElementById("strategyBoard");
  const hiddenSentinel = app.doc.createElement("span");
  hiddenHost.appendChild(hiddenSentinel);

  app.evalIn('state.screen = "screener"; state.universe = "strong"; render()');

  assert.equal(activeSentinel.isConnected, false, "the newly active screen should render immediately");
  assert.equal(hiddenSentinel.isConnected, true, "another hidden screen should keep its DOM identity");
});

test("http preview uses same-origin API only and never falls back to reserved port 5174", () => {
  const candidates = JSON.parse(app.evalIn('JSON.stringify(apiCandidates("/api/quotes"))'));
  assert.deepEqual(candidates, ["/api/quotes"]);
});

test("hidden pages skip live refresh and becoming visible coalesces into one immediate refresh", async () => {
  app.evalIn(`
    window.__refreshCounts = { market: 0, quotes: 0 };
    isTaiwanMarketSession = () => true;
    isTaiwanFuturesNightSession = () => false;
    ensureMarketSessionStatus = async () => null;
    loadMarketSummary = async () => { window.__refreshCounts.market += 1; };
    loadMarketData = async () => { window.__refreshCounts.quotes += 1; };
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
  `);

  await app.evalIn("refreshLiveData()");
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__refreshCounts)")), { market: 0, quotes: 0 });

  app.evalIn(`
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  `);
  await app.settle(3);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__refreshCounts)")), { market: 1, quotes: 1 });
});

test("auto refresh locks before awaiting the trading calendar so overlapping ticks share one loader set", async () => {
  app.evalIn(`
    autoRefreshInFlight = false;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    getSelectedSource = () => "official";
    isTaiwanMarketSession = () => true;
    isTaiwanFuturesNightSession = () => false;
    window.__calendarCalls = 0;
    window.__loaderCounts = { market: 0, quotes: 0 };
    window.__calendarGate = new Promise((resolve) => { window.__resolveCalendar = resolve; });
    ensureMarketSessionStatus = async () => {
      window.__calendarCalls += 1;
      return window.__calendarGate;
    };
    loadMarketSummary = async () => { window.__loaderCounts.market += 1; };
    loadMarketData = async () => { window.__loaderCounts.quotes += 1; };
    window.__firstAutoRefresh = refreshLiveData();
    window.__secondAutoRefresh = refreshLiveData();
  `);

  app.evalIn("window.__resolveCalendar(null)");
  await Promise.all([
    app.evalIn("window.__firstAutoRefresh"),
    app.evalIn("window.__secondAutoRefresh"),
  ]);

  assert.equal(app.evalIn("window.__calendarCalls"), 1, "第二個 tick 不應在日曆 await 期間穿透 in-flight lock");
  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(window.__loaderCounts)")),
    { market: 1, quotes: 1 },
    "同一輪只能啟動一組市場與個股 loader"
  );
});

test("auto refresh rechecks visibility and selected source after the trading-calendar await", async () => {
  app.evalIn(`
    autoRefreshInFlight = false;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    window.__selectedSource = "official";
    getSelectedSource = () => window.__selectedSource;
    isTaiwanMarketSession = () => true;
    isTaiwanFuturesNightSession = () => false;
    window.__loaderCounts = { market: 0, quotes: 0 };
    loadMarketSummary = async () => { window.__loaderCounts.market += 1; };
    loadMarketData = async () => { window.__loaderCounts.quotes += 1; };

    window.__hiddenCalendarGate = new Promise((resolve) => { window.__resolveHiddenCalendar = resolve; });
    ensureMarketSessionStatus = async () => window.__hiddenCalendarGate;
    window.__hiddenRefresh = refreshLiveData();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    window.__resolveHiddenCalendar(null);
  `);
  await app.evalIn("window.__hiddenRefresh");

  app.evalIn(`
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    window.__selectedSource = "official";
    window.__sourceCalendarGate = new Promise((resolve) => { window.__resolveSourceCalendar = resolve; });
    ensureMarketSessionStatus = async () => window.__sourceCalendarGate;
    window.__sourceRefresh = refreshLiveData();
    window.__selectedSource = "broker";
    window.__resolveSourceCalendar(null);
  `);
  await app.evalIn("window.__sourceRefresh");

  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(window.__loaderCounts)")),
    { market: 0, quotes: 0 },
    "等待日曆期間離開前景或改用券商後，不得再送出官方輪詢"
  );
});

test("stock-session auto refresh suppresses loader renders and commits exactly once after both finish", async () => {
  app.evalIn(`
    autoRefreshInFlight = false;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    getSelectedSource = () => "official";
    ensureMarketSessionStatus = async () => null;
    isTaiwanMarketSession = () => true;
    isTaiwanFuturesNightSession = () => false;
    window.__summaryOptions = [];
    window.__quoteOptions = [];
    window.__liveCommitCount = 0;
    render = () => { window.__liveCommitCount += 1; };
    renderLiveDataUpdate = () => { window.__liveCommitCount += 1; };
    loadMarketSummary = (options) => {
      window.__summaryOptions.push(options);
      return new Promise((resolve) => { window.__resolveSummary = resolve; });
    };
    loadMarketData = (options) => {
      window.__quoteOptions.push(options);
      return new Promise((resolve) => { window.__resolveQuotes = resolve; });
    };
    window.__coalescedRefresh = refreshLiveData();
  `);
  await app.settle(1);

  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(window.__summaryOptions.map((item) => item?.renderNow))")),
    [false],
    "市場摘要 loader 應只更新 state，不自行 render"
  );
  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(window.__quoteOptions.map((item) => item?.renderNow))")),
    [false],
    "個股行情 loader 應只更新 state，不自行 render"
  );
  assert.equal(app.evalIn("window.__liveCommitCount"), 0, "任一 loader 尚未完成前不可提早提交畫面");

  app.evalIn("window.__resolveSummary()");
  await app.settle(1);
  assert.equal(app.evalIn("window.__liveCommitCount"), 0, "第一個 loader 完成後仍需等待另一個 loader");

  app.evalIn("window.__resolveQuotes()");
  await app.evalIn("window.__coalescedRefresh");
  assert.equal(app.evalIn("window.__liveCommitCount"), 1, "兩個 loader 完成後只能提交一次畫面");
});

test("auto refresh restores focus to the same dynamic indicator button after DOM replacement", async () => {
  app.evalIn(`
    autoRefreshInFlight = false;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    getSelectedSource = () => "official";
    ensureMarketSessionStatus = async () => null;
    isTaiwanMarketSession = () => true;
    isTaiwanFuturesNightSession = () => false;
    loadMarketSummary = async (options = {}) => { if (options.renderNow !== false) render(); };
    loadMarketData = async (options = {}) => { if (options.renderNow !== false) render(); };
    const seededStock = upsertStockFromQuote({
      code: "2330", name: "台積電", exchange: "TWSE", price: 1000,
      previousClose: 990, open: 995, high: 1005, low: 988,
      change: 10, changePct: 1.01, volumeLots: 12345, sourceKind: "realtime",
    });
    state.selectedCode = seededStock.code;
    render();
    window.__indicatorBefore = document.querySelector("[data-indicator]");
    window.__indicatorKey = window.__indicatorBefore?.dataset.indicator || "";
    window.__indicatorBefore?.focus();
  `);
  assert.notEqual(app.evalIn("window.__indicatorKey"), "", "測試前提：個股明細應有動態指標按鈕");

  await app.evalIn("refreshLiveData()");

  assert.equal(app.evalIn("window.__indicatorBefore.isConnected"), false, "行情提交應重建動態指標 DOM");
  assert.equal(
    app.evalIn("document.activeElement?.dataset.indicator"),
    app.evalIn("window.__indicatorKey"),
    "重建後應把焦點交還同一個技術指標"
  );
});

test("auto refresh preserves focused More/system password value and selection", async () => {
  app.evalIn(`
    autoRefreshInFlight = false;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    getSelectedSource = () => "official";
    ensureMarketSessionStatus = async () => null;
    isTaiwanMarketSession = () => true;
    isTaiwanFuturesNightSession = () => false;
    loadMarketSummary = async (options = {}) => { if (options.renderNow !== false) render(); };
    loadMarketData = async (options = {}) => { if (options.renderNow !== false) render(); };
    state.screen = "more";
    state.morePanel = "system";
    render();
    window.__passwordBefore = document.querySelector('[data-password-form] input[name="currentPassword"]');
    window.__passwordBefore.value = "sensitive-password";
    window.__passwordBefore.focus();
    window.__passwordBefore.setSelectionRange(3, 11, "backward");
  `);
  assert.equal(app.evalIn("document.activeElement === window.__passwordBefore"), true, "測試前提：密碼欄位必須已取得焦點");

  await app.evalIn("refreshLiveData()");

  assert.equal(
    app.evalIn(`document.querySelector('[data-password-form] input[name="currentPassword"]').value`),
    "sensitive-password"
  );
  assert.equal(app.evalIn("document.activeElement?.name"), "currentPassword", "行情輪詢後密碼欄位仍應保有焦點");
  assert.equal(app.evalIn("document.activeElement?.selectionStart"), 3, "選取起點不應跳動");
  assert.equal(app.evalIn("document.activeElement?.selectionEnd"), 11, "選取終點不應跳動");
});

test("已知現貨休市時不輪詢個股，且不誤啟動市場摘要", async () => {
  app.evalIn(`
    window.__refreshCounts = { market: 0, quotes: 0 };
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    isTaiwanMarketSession = () => false;
    isTaiwanFuturesNightSession = () => false;
  `);
  await app.evalIn("refreshLiveData()");
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__refreshCounts)")), { market: 0, quotes: 0 });
});

test("market summary accepts only the newest request when responses arrive out of order", async () => {
  app.evalIn(`
    window.__marketDeferred = [];
    ensureMarketSessionStatus = async () => null;
    fetchApi = () => new Promise((resolve) => window.__marketDeferred.push(resolve));
    window.__marketFirst = loadMarketSummary();
    window.__marketSecond = loadMarketSummary();
  `);

  app.evalIn(`window.__marketDeferred[1]({
    ok: true,
    markets: { taiex: { key: "taiex", label: "較新", price: 2, change: 1, changePct: 1, realtime: true } },
    source: "newer",
    generatedAt: "2026-07-13T02:00:00.000Z"
  })`);
  await app.evalIn("window.__marketSecond");
  app.evalIn(`window.__marketDeferred[0]({
    ok: true,
    markets: { taiex: { key: "taiex", label: "較舊", price: 1, change: -1, changePct: -1, realtime: true } },
    source: "older",
    generatedAt: "2026-07-13T01:00:00.000Z"
  })`);
  await app.evalIn("window.__marketFirst");

  assert.equal(app.evalIn("marketState.source"), "newer");
  assert.equal(app.evalIn("marketState.markets.taiex.price"), 2);
});

test("quotes accept only the newest request when automatic and manual refresh overlap", async () => {
  app.evalIn(`
    stocks.length = 0;
    watchLists[1] = new Set(); watchLists[2] = new Set(); watchLists[3] = new Set();
    priceAlertsState.alerts = [];
    tradesState.portfolio = null;
    state.selectedCode = "2330";
    state.technicalCode = "2330";
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    window.__quoteDeferred = [];
    fetchApi = () => new Promise((resolve) => window.__quoteDeferred.push(resolve));
    window.__quoteFirst = loadMarketData();
    window.__quoteSecond = loadMarketData();
  `);
  const today = app.evalIn("getTaiwanClockParts().isoDate.replaceAll('-', '/')");

  app.evalIn(`window.__quoteDeferred[1]({
    ok: true,
    quotes: [{ code: "2330", name: "台積電", exchange: "TWSE", price: 200,
      change: 2, changePct: 1, sourceKind: "realtime", source: "newer", asOf: ${JSON.stringify(today)} + " 10:00:00" }],
    sourceKey: "official", source: "newer", generatedAt: "2026-07-13T02:00:00.000Z",
    quoteCount: 1, realtimeCount: 1, fallbackCount: 0
  })`);
  await app.evalIn("window.__quoteSecond");
  app.evalIn(`window.__quoteDeferred[0]({
    ok: true,
    quotes: [{ code: "2330", name: "台積電", exchange: "TWSE", price: 100,
      change: -1, changePct: -1, sourceKind: "realtime", source: "older", asOf: ${JSON.stringify(today)} + " 09:59:00" }],
    sourceKey: "official", source: "older", generatedAt: "2026-07-13T01:00:00.000Z",
    quoteCount: 1, realtimeCount: 1, fallbackCount: 0
  })`);
  await app.evalIn("window.__quoteFirst");

  assert.equal(app.evalIn('stocks.find((stock) => stock.code === "2330").price'), 200);
  assert.equal(app.evalIn("dataState.source"), "newer");
});

test("more than 100 tracked stocks are fetched in complete 100-code batches", async () => {
  app.evalIn(`
    stocks.length = 0;
    const codes = Array.from({ length: 205 }, (_, index) => String(1000 + index));
    watchLists[1] = new Set(codes.slice(0, 100));
    watchLists[2] = new Set(codes.slice(100, 200));
    watchLists[3] = new Set(codes.slice(200));
    state.selectedCode = codes[0];
    state.technicalCode = codes[0];
    priceAlertsState.alerts = [];
    tradesState.portfolio = null;
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    window.__quoteBatchSizes = [];
    render = () => {};
    fetchApi = async (url) => {
      const raw = new URL(url, "http://local.test").searchParams.get("codes") || "";
      const batch = raw.split(",").filter(Boolean);
      window.__quoteBatchSizes.push(batch.length);
      return {
        ok: true,
        quotes: batch.map((code) => ({ code, name: code, price: 10, changePct: 0, sourceKind: "daily-close" })),
        sourceKey: "official", source: "official", generatedAt: "2026-07-13T02:00:00.000Z",
        quoteCount: batch.length, realtimeCount: 0, fallbackCount: batch.length,
      };
    };
  `);
  await app.evalIn("loadMarketData()");
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__quoteBatchSizes)")), [100, 100, 5]);
  assert.equal(app.evalIn("stocks.length"), 205, "不得靜默截掉第 101 檔以後的自選股");
  assert.equal(app.evalIn("dataState.quoteCount"), 205);
});

test("daily supplemental data is throttled and never starts after the page becomes hidden", async () => {
  app.evalIn(`
    window.__supplementalCounts = { institutional: 0, margin: 0 };
    loadInstitutionalData = async () => { window.__supplementalCounts.institutional += 1; };
    loadMarginData = async () => { window.__supplementalCounts.margin += 1; };
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    supplementalMarketLastRequestedAt = 0;
    supplementalMarketTradeDate = "";
    refreshSupplementalMarketData();
    refreshSupplementalMarketData();
  `);
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__supplementalCounts)")), { institutional: 1, margin: 1 });

  app.evalIn(`
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    refreshSupplementalMarketData({ force: true });
  `);
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__supplementalCounts)")), { institutional: 1, margin: 1 });
});

test("auto-refresh supplemental loaders suppress their own renders and share one protected commit", async () => {
  app.evalIn(`
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    getSelectedSource = () => "official";
    supplementalMarketLastRequestedAt = 0;
    supplementalMarketTradeDate = "";
    window.__supplementalOptions = [];
    window.__supplementalCommits = 0;
    loadInstitutionalData = async (options) => {
      window.__supplementalOptions.push(options);
      return true;
    };
    loadMarginData = async (options) => {
      window.__supplementalOptions.push(options);
      return true;
    };
    renderLiveDataUpdate = () => { window.__supplementalCommits += 1; };
    refreshSupplementalMarketData({ force: true, liveUpdate: true });
  `);
  await app.settle(3);

  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(window.__supplementalOptions.map((item) => item?.renderNow))")),
    [false, false],
    "法人與融資券背景 loader 不得各自重畫"
  );
  assert.equal(app.evalIn("window.__supplementalCommits"), 1, "兩份補充資料完成後只做一次受保護提交");
});
