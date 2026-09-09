// 行情時間與來源用詞要跟時段一致（computer use 心得 F04／CUA-04）：
// 00:01 的頂部寫「官方／即時 44」、明細寫「最後成交 09/08 13:30」，使用者得自己跨區比對才知道凌晨沒有台股成交。
// 一份時段口徑 getQuoteSessionPhase → describeQuoteBatch 供四個出口共用；盤中字串一字不改（既有 data-status-failure 釘住），
// 非盤中改稱「今日收盤／最近行情 MM/DD」與「取得」。jsdom 沒有時鐘注入：純函式吃 now，渲染測試覆寫頂層 function。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));
const phaseAt = (isoUtc, calendar = null) => app.evalIn(`(() => {
  marketSessionState.stock = ${JSON.stringify(calendar)};
  const out = getQuoteSessionPhase(new Date(${JSON.stringify(isoUtc)}));
  marketSessionState.stock = null;
  return out;
})()`);

function renderWithPhase(phase, patch = {}, seedStocks = null) {
  app.evalIn(`
    window.__origPhase = window.__origPhase || getQuoteSessionPhase;
    getQuoteSessionPhase = () => ${JSON.stringify(phase)};
    stocks.length = 0;
    ${seedStocks ? `${JSON.stringify(seedStocks)}.forEach((s) => stocks.push(s));` : ""}
    Object.assign(dataState, {
      mode: "official", source: "TWSE + TPEx", lastUpdated: "10:12:33",
      quoteCount: 120, realtimeCount: 118, fallbackCount: 2,
      warnings: [], degraded: false, error: "", failedSince: "", loadedOnce: true,
    }, ${JSON.stringify(patch)});
    marketSessionState.stock = { date: "1970-01-01", tradingDay: true };
    renderDataStatus();
  `);
  return {
    status: app.evalIn(`document.getElementById("refreshStatus").textContent`),
    title: app.evalIn(`document.getElementById("refreshStatus").title`),
    sourceMeta: app.evalIn(`document.getElementById("sourceMeta").textContent`),
    trust: app.evalIn(`renderDataTrustCompact()`),
    more: app.evalIn(`describeQuoteBatch(getQuoteSessionPhase()).moreDetail`),
  };
}
const restorePhase = () => app.evalIn(`if (window.__origPhase) getQuoteSessionPhase = window.__origPhase;`);

test("S1 getQuoteSessionPhase：日曆優先、週末啟發、09:00–13:35 開盤、其餘依 09:00 分開盤前／收盤後", () => {
  const calendar = { date: "2026-07-02", tradingDay: true };
  assert.equal(phaseAt("2026-07-02T00:59:00Z", calendar), "pre-open", "08:59");
  assert.equal(phaseAt("2026-07-02T01:00:00Z", calendar), "open", "09:00");
  assert.equal(phaseAt("2026-07-02T05:35:00Z", calendar), "open", "13:35");
  assert.equal(phaseAt("2026-07-02T05:36:00Z", calendar), "after-close", "13:36");
  assert.equal(phaseAt("2026-07-02T15:59:00Z", calendar), "after-close", "23:59");
  assert.equal(phaseAt("2026-07-04T02:00:00Z", null), "weekend", "週六無日曆");
  assert.equal(phaseAt("2026-07-04T02:00:00Z", { date: "2026-07-04", tradingDay: true }), "open", "特殊週六補交易由日曆覆寫");
  assert.equal(phaseAt("2026-07-02T02:00:00Z", { date: "2026-07-02", tradingDay: false }), "holiday", "平日官方休市");
  assert.equal(phaseAt("2026-07-02T02:00:00Z", { date: "2026-07-01", tradingDay: false }), "open", "過期日曆不適用，回到啟發");
  assert.equal(phaseAt("2026-07-02T02:00:00Z", { date: "2026-07-02", tradingDay: null }), "open", "tradingDay 未知走週間啟發");
});

test("S4 open：四個出口的盤中字串與舊版完全相同", () => {
  const view = renderWithPhase("open");
  assert.equal(view.status, "官方行情 ・ 即時 118 檔（2 檔為收盤價） ・ 10:12:33 更新");
  assert.match(view.title, /每 10 秒自動更新/);
  assert.equal(view.sourceMeta, "官方 / 即時 118 / 備援 2 / 10:12:33");
  assert.match(view.trust, /即時 118 檔 \/ 收盤備援 2 檔/);
  assert.equal(view.more, "118 檔即時 / 2 檔收盤備援");
  restorePhase();
});

test("S2 after-close：改稱今日收盤與取得，不再說即時、不再宣稱每 10 秒更新", () => {
  const view = renderWithPhase("after-close");
  assert.match(view.status, /今日收盤 118 檔（2 檔為收盤備援）/);
  assert.match(view.status, /10:12:33 取得/);
  assert.doesNotMatch(view.status, /即時 118 檔/);
  assert.doesNotMatch(view.status, /10:12:33 更新/);
  assert.match(view.title, /已收盤/);
  assert.doesNotMatch(view.title, /每 10 秒自動更新/);
  assert.equal(view.sourceMeta, "官方 / 今日收盤 118 / 備援 2 / 10:12:33");
  assert.match(view.trust, /今日收盤 118 檔 \/ 收盤備援 2 檔/);
  assert.equal(view.more, "118 檔今日收盤 / 2 檔收盤備援");
  restorePhase();
});

test("S3 pre-open／weekend：顯示最近行情與多數行情日，不出現即時", () => {
  const seed = [
    { code: "2330", name: "台積電", price: 2470, asOf: "2026/07/08 13:30:00", spark: [], groups: [], strategies: [] },
    { code: "0050", name: "元大台灣50", price: 109.65, asOf: "2026/07/08 13:30:00", spark: [], groups: [], strategies: [] },
    { code: "2454", name: "聯發科", price: 1200, asOf: "2026/07/07 13:30:00", spark: [], groups: [], strategies: [] },
  ];
  const pre = renderWithPhase("pre-open", {}, seed);
  assert.match(pre.status, /最近行情 07\/08/);
  assert.match(pre.status, /120 檔/);
  assert.match(pre.status, /10:12:33 取得/);
  assert.doesNotMatch(pre.status, /即時/);
  assert.match(pre.title, /尚未開盤/);
  assert.match(pre.sourceMeta, /最近行情 07\/08 120/);
  assert.match(pre.trust, /最近行情 07\/08 ・ 120 檔/);
  assert.equal(pre.more, "120 檔最近行情（07/08）");
  const weekend = renderWithPhase("weekend", {}, seed);
  assert.match(weekend.status, /最近行情 07\/08/);
  assert.match(weekend.title, /非交易日/);
  restorePhase();
});

test("S5 after-close 且部分即時源失敗：仍要講出部分失敗，且不變成整輪失敗", () => {
  const view = renderWithPhase("after-close", { error: "即時源部分失敗：MIS 逾時", realtimeCount: 60 });
  assert.match(view.status, /部分即時源失敗/);
  assert.doesNotMatch(view.status, /更新失敗 ・ 畫面停在/);
  assert.match(view.title, /MIS 逾時/);
  restorePhase();
});

test("S6 開休市日曆未確認時 tooltip 要說明，不假裝知道", () => {
  app.evalIn(`
    window.__origPhase = window.__origPhase || getQuoteSessionPhase;
    getQuoteSessionPhase = () => "after-close";
    Object.assign(dataState, { mode: "official", source: "TWSE + TPEx", lastUpdated: "14:00:00", quoteCount: 120, realtimeCount: 118, fallbackCount: 2, warnings: [], degraded: false, error: "", failedSince: "", loadedOnce: true });
    marketSessionState.stock = null;
    renderDataStatus();
  `);
  assert.match(app.evalIn(`document.getElementById("refreshStatus").title`), /日曆尚未確認/);
  restorePhase();
});

test("S7 資料可信度：只有警告沒有備援時叫「資料降級」，真有備援才叫「部分備援」", () => {
  const labels = json(`(() => {
    // tone 也看 marketState／sourceState 的錯誤與來源選擇；harness 預設路由可能留下錯誤，先清乾淨。
    marketState.error = ""; sourceState.error = ""; sourceState.selected = "official";
    const base = { mode: "official", lastUpdated: "10:12:33", realtimeCount: 44, error: "", degraded: false, loadedOnce: true };
    Object.assign(dataState, base, { warnings: ["上市與上櫃整批收盤資料日尚未對齊"], fallbackCount: 0 });
    const warningsOnly = renderDataTrustCompact();
    Object.assign(dataState, base, { warnings: [], fallbackCount: 2 });
    const fallbackOnly = renderDataTrustCompact();
    Object.assign(dataState, base, { warnings: [], fallbackCount: 0 });
    const clean = renderDataTrustCompact();
    return { warningsOnly, fallbackOnly, clean };
  })()`);
  assert.match(labels.warningsOnly, /資料降級/);
  assert.doesNotMatch(labels.warningsOnly, /部分備援/, "備援 0 檔不能叫部分備援");
  assert.match(labels.fallbackOnly, /部分備援/);
  assert.match(labels.clean, /資料正常/);
});

test("到價提醒說明：盤中說即時價，收盤後說今日收盤價，非交易日說最近收盤價", () => {
  const hints = json(`(() => {
    window.__origPhase = window.__origPhase || getQuoteSessionPhase;
    authState.user = { id: "u1", username: "admin", role: "admin" };
    const stock = { code: "2330", name: "台積電", price: 2470, spark: [], groups: [], strategies: [] };
    const read = (phase) => { getQuoteSessionPhase = () => phase; renderPriceAlertBox(stock); return el.priceAlertBox.textContent.replace(/\\s+/g, " "); };
    const out = { open: read("open"), afterClose: read("after-close"), weekend: read("weekend") };
    getQuoteSessionPhase = window.__origPhase;
    return out;
  })()`);
  assert.match(hints.open, /最新即時價/);
  assert.match(hints.afterClose, /今日收盤價/);
  assert.doesNotMatch(hints.afterClose, /最新即時價/);
  assert.match(hints.weekend, /最近收盤價/);
});

test("盤中選股 scope note：非盤中不再寫「即時・秒級更新」", () => {
  const notes = json(`(() => {
    window.__origPhase = window.__origPhase || getQuoteSessionPhase;
    const read = (phase) => { getQuoteSessionPhase = () => phase; renderScreenerScopeNote(); return document.querySelector('[data-screen-panel="screener"] .scope-note-text').textContent.replace(/\\s+/g, " "); };
    const out = { open: read("open"), afterClose: read("after-close") };
    getQuoteSessionPhase = window.__origPhase;
    return out;
  })()`);
  assert.match(notes.open, /即時動能/);
  assert.match(notes.open, /秒級更新/);
  assert.match(notes.afterClose, /最近行情動能|收盤後動能/);
  assert.doesNotMatch(notes.afterClose, /秒級更新|即時動能/);
});

test("S8 搜尋：官方清單附取得時間與「漲跌為最近收盤」，資料降級要說；warnings 進 title 且跳脫；無遠端列不顯示", async () => {
  await app.evalIn(`(async () => {
    window.__origFetchApi = fetchApi;
    fetchApi = async () => ({ ok: true, query: "9999", generatedAt: "2026-07-02T05:30:00Z", results: [{ code: "9999", name: "合成遠端", exchange: "TWSE", price: 10, changePct: 2.07 }],
      warnings: ["<img src=x onerror=alert(1)> 上市整批 2026/09/07"], dataQuality: { degraded: true, referenceComplete: false, markets: {} } });
    try {
      stocks.length = 0;
      searchState.query = "9999";
      const token = searchState.token;
      await loadSymbolSearch("9999", token);
    } finally { fetchApi = window.__origFetchApi; }
  })()`);
  const view = json(`(() => {
    const asof = el.searchResults.querySelector(".search-asof");
    return { meta: searchState.remoteMeta, asofText: asof ? asof.textContent.replace(/\\s+/g, " ").trim() : null, asofTitle: asof ? asof.getAttribute("title") : null, imgCount: el.searchResults.querySelectorAll("img").length, html: el.searchResults.innerHTML };
  })()`);
  assert.equal(view.meta.degraded, true);
  assert.match(view.meta.generatedAt, /2026-07-02/);
  assert.ok(view.asofText, "遠端結果上方要有取得時間列");
  assert.match(view.asofText, /取得/);
  assert.match(view.asofText, /最近收盤/);
  assert.match(view.asofText, /資料降級/);
  assert.match(view.asofTitle, /上市整批/);
  // 跳脫的證據是「沒有生成 img 元素、惡意字串只以文字留在 title」：HTML 序列化在屬性值裡不會把 < 寫成 &lt;，
  // 所以不能拿 innerHTML 比對 &lt;img（實測會誤判）。
  assert.equal(view.imgCount, 0, "warnings 必須跳脫，不得生成元素");
  assert.match(view.asofTitle, /<img src=x onerror=alert\(1\)>/, "惡意字串只能是 title 的純文字");
  assert.equal(app.evalIn(`el.searchResults.querySelector(".search-asof").getAttribute("onerror")`), null);
  const empty = json(`(() => { searchState.remote = []; renderSearchResults(); return { asof: el.searchResults.querySelector(".search-asof") !== null }; })()`);
  assert.equal(empty.asof, false, "沒有遠端列就不顯示取得時間");
  app.evalIn(`resetSearchState();`);
  assert.equal(app.evalIn(`searchState.remoteMeta`), null, "重置要清 remoteMeta");
});

test("更多 → 資料源：開休市狀態警告不再只存在 state 裡", () => {
  const html = json(`(() => {
    marketSessionState.warnings = ["開休市狀態暫時無法確認：<b>來源逾時</b>"];
    const out = renderMarketSessionWarnings();
    marketSessionState.warnings = [];
    return { withWarning: out, without: renderMarketSessionWarnings() };
  })()`);
  assert.match(html.withWarning, /開休市狀態暫時無法確認/);
  assert.match(html.withWarning, /&lt;b&gt;/);
  assert.equal(html.without, "");
});
