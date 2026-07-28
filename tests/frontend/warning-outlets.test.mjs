// 「伺服器算對了、payload 也送出來了、前端出口是死的」——這個 repo 反覆出現的病。
// 2026-07-27 的多維度體檢又抓到兩個現場：
//
// P3 策略雷達：strategyState.warnings 有宣告、有寫入、有清空，**全檔零讀取點**。
//    server.mjs 組裝那批 warnings 的地方自己寫著「這個失敗模式在開發期間三天內出現三次
//    （證交所限流），而且畫面上完全沒有跡象」——到今天仍然沒有跡象，因為出口是死的。
//
// P2 技術頁基本面：warnings 只印第 [0] 則。而 buildFundamentals 是把「比率量級異常」
//    （疑似上游把單位從比率改成每仟股股數 → 整段 K 線塌陷）unshift 之後，才 unshift
//    各來源的新鮮度警告，於是那條最嚴重的被擠到 index 1，在最需要時顯示不出來。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

// ---- P3：策略雷達 ----

const renderBoard = (warnings, picks = 1) => app.evalIn(`(() => {
  strategyState.loaded = true;
  strategyState.loading = false;
  strategyState.error = "";
  strategyState.scenario = "midBandDefense";
  strategyState.warnings = ${JSON.stringify(warnings)};
  strategyState.picks = ${JSON.stringify(Array.from({ length: picks }, (_, i) => ({
    code: `123${i}`, name: "測試股", exchange: "TWSE", market: "上市",
    scenario: { key: "midBandDefense", name: "中軌攻防", desc: "" },
    score: 80, price: 100, changePct: 1, avgVolLots: 500, volumeRatio5: 1.2,
    plan: { entry: 100, initialStop: 95, structuralStop: 96, trailingTrigger: 105, target: 115, rr: 3, rrNet: 2.8, nearestResistance: null },
    indicators: { ma5: 99, ma20: 96, ma60: 90, bollMid: 96, bollUpper: 110, bollLower: 88, goldenCrossDays: 5, pullbackDepthPct: 0 },
    asOf: "2026/07/24", reasons: [],
  })))};
  state.screen = "strategy";
  renderStrategyBoard();
  return el.strategyBoard.innerHTML;
})()`);

test("P3：掃描品質警告必須渲染出來，不能只存在 state 裡", () => {
  const html = renderBoard([
    "上櫃整批收盤抓取失敗，目前結果暫時不含上櫃市場。",
    "3 檔的公司行動欄位不齊，已標未定案並排除。",
  ]);
  assert.match(html, /上櫃整批收盤抓取失敗/, "警告內容要真的出現在畫面上");
  assert.match(html, /2 項資料品質問題/, "要講清楚有幾項");
  assert.match(html, /可能不完整或不準確/, "要說明它對下面名單的意義");
});

test("P3：有警告時名單仍要照常顯示（警告不取代內容）", () => {
  const html = renderBoard(["上櫃整批收盤抓取失敗。"], 2);
  assert.match(html, /上櫃整批收盤抓取失敗/);
  assert.equal((html.match(/swing-card/g) || []).length >= 2, true, "兩張卡片都要在");
});

test("P3：沒有警告時不得亮（天天亮的提示等於沒有提示）", () => {
  const html = renderBoard([]);
  assert.doesNotMatch(html, /資料品質問題/);
  assert.doesNotMatch(html, /is-error/);
});

test("P3：警告很多時只列前 3 則並講出剩餘則數", () => {
  const html = renderBoard(["警告一", "警告二", "警告三", "警告四", "警告五"]);
  assert.match(html, /警告三/);
  assert.doesNotMatch(html, /警告四/, "只列前 3 則，避免洗版");
  assert.match(html, /另有 2 則/);
});

// ---- P2：技術頁基本面 ----

const renderFundamentals = (over) => app.evalIn(`(() => {
  state.technicalCode = "2330";
  fundamentalsState.byCode.set("2330", { loading: false, error: "", at: Date.now(), data: ${JSON.stringify({
    ok: true,
    revenue: { latest: { yearMonth: "2026-06", revenue: 1000000, yoy: 5 }, history: [] },
    eps: { latest: { period: "2026Q1", eps: 10 }, history: [] },
    valuation: { pe: 20, dividendYield: 2, pbr: 3, dps: null, asOf: "20260701" },
    dividends: [],
    freshness: { dividends: { status: "fresh" } },
    warnings: [],
    ...over,
  })} });
  renderFundamentalsPanel();
  return el.fundamentalsPanel.innerHTML;
})()`);

test("P2：現金與配股同時存在時兩個都要顯示", () => {
  // 6944 的真實形狀：配股 30% ＋ 息 17 元（官方參考價 1030 → 779）。
  // 舊寫法是三元式，有現金就不顯示配股 → 使用者不會去補登除權配股 → 帳本股數一直少。
  const html = renderFundamentals({
    dividends: [{ exDate: "20260723", kind: "除權息", cashDividend: 17, stockRatio: 0.3 }],
  });
  assert.match(html, /現金 17 元/);
  assert.match(html, /配股 30%/, "配股 30% 不可因為有現金就被藏起來");
});

test("P2：比率要同時給百分比與每仟股股數（單位不可留白）", () => {
  const html = renderFundamentals({
    dividends: [{ exDate: "20260730", kind: "除權息", cashDividend: 1.5, stockRatio: 0.1 }],
  });
  // 官方 OpenAPI 回比率（0.1），但同一份報表的網頁版是每仟股股數 → 只印裸的 0.1 會看不懂單位。
  assert.match(html, /配股 10%/);
  assert.match(html, /每仟股 100 股/);
  assert.doesNotMatch(html, /配股 0\.1(?!\d)/, "不可印裸的比率");
});

test("P2：現增也要顯示，含認購價", () => {
  const html = renderFundamentals({
    dividends: [{ exDate: "20260724", kind: "除權", cashDividend: 0, subscriptionRatio: 0.07014093, subscriptionPrice: 230 }],
  });
  assert.match(html, /現增/);
  assert.match(html, /230 元/, "認購價要講，否則算不出參考價");
});

test("P2：警告要顯示前 2 則＋剩餘則數，不是只印第 1 則", () => {
  // 必須比對**可見文字**而不是整段 HTML——完整清單放在 title 屬性裡，
  // 用 innerHTML 比對的話「沒顯示但在 title 裡」也會誤判成通過（實測突變抽查抓到）。
  const visible = JSON.parse(app.evalIn(`JSON.stringify((() => {
    state.technicalCode = "2330";
    fundamentalsState.byCode.set("2330", { loading: false, error: "", at: Date.now(), data: {
      ok: true,
      revenue: { latest: { yearMonth: "2026-06", revenue: 1000000, yoy: 5 }, history: [] },
      eps: { latest: { period: "2026Q1", eps: 10 }, history: [] },
      valuation: { pe: 20, dividendYield: 2, pbr: 3, dps: null, asOf: "20260701" },
      dividends: [], freshness: { dividends: { status: "fresh" } },
      warnings: [
        "上市除權息的配股／現增比率超過 100%（1231 20260730 的無償配股率 100），可能是上游把單位從比率改成每仟股股數。",
        "上市除權息公告暫時更新失敗，已沿用最近一次成功抓取的資料。",
        "月營收來源暫時抓不到。",
      ],
    } });
    renderFundamentalsPanel();
    const node = el.fundamentalsPanel.querySelector(".fund-hint.is-warn");
    return { text: node ? node.textContent : "", title: node ? (node.getAttribute("title") || "") : "" };
  })())`));
  assert.match(visible.text, /超過 100%/, "最嚴重的那則（比率量級異常）必須看得到");
  assert.match(visible.text, /沿用最近一次成功抓取/, "第 2 則也要看得到，不是只印第 1 則");
  assert.match(visible.text, /另有 1 則/);
  assert.doesNotMatch(visible.text, /月營收來源/, "第 3 則不進可見文字，避免洗版");
  assert.match(visible.title, /月營收來源/, "完整清單放 title");
});

test("P2：沒有警告時不得產生空的警告列", () => {
  const html = renderFundamentals({ warnings: [] });
  assert.doesNotMatch(html, /fund-hint is-warn/);
});
