// 手機成績單逐日表／策略卡三段式／庫存摘要條（M4，2026-09-13）：標記與狀態邏輯；幾何在 tests/browser/mobile-shell.test.mjs 量。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

// API 回的是新→舊：index 0 是最新一天
const records = Array.from({ length: 25 }, (_, i) => {
  const day = String(25 - i).padStart(2, "0");
  return {
    asOf: `2026-08-${day}`, observationDate: `2026-08-${day}`, status: "final", complete: true, signals: 3, verified: 3,
    winAtOpenEntry: 2, winAtOpen: 1, winAtClose: 1, hitPlus2: 1, brokeMinus2: 0, avgOpenReturn: 0.5, avgCloseReturn: 0.8,
    openEntryNet: i === 0 ? { count: 3, gain: 2, loss: 1, avg: 0.42 } : null,
    metricCoverage: { winAtOpenEntry: { value: 0.67, validCount: 3, validDays: 1 } },
  };
});

test("逐日表：先給 5 天、其餘 is-older；› 展開只改該列並記進 Set；「顯示更早」+20 天且重繪保留展開", () => {
  app.evalIn(`
    verifyHistoryState.data = ${JSON.stringify({ ok: true, records, totals: null })};
    verifyHistoryState.loaded = true; verifyHistoryState.visibleDays = 5; verifyHistoryState.expanded.clear();
    const host = document.createElement("div"); host.id = "m4host"; document.body.append(host); host.innerHTML = renderVerifyHistory();`);
  const first = json(`(() => {
    const rows = [...document.querySelectorAll("#m4host .verify-history-row:not(.is-head)")];
    return { total: rows.length, older: rows.filter((r) => r.classList.contains("is-older")).length, firstOlder: rows.findIndex((r) => r.classList.contains("is-older")),
      net: rows[0].querySelector(".verify-net-mobile")?.textContent, netMissing: rows[1].querySelector(".verify-net-mobile")?.textContent,
      toggles: document.querySelectorAll("#m4host [data-verify-toggle]").length, more: document.querySelector("#m4host [data-verify-more]")?.textContent };
  })()`);
  assert.equal(first.total, 25);
  assert.equal(first.older, 20);
  assert.equal(first.firstOlder, 5, "最新 5 天不是 older");
  assert.equal(first.net, "▲0.42%");
  assert.equal(first.netMissing, "--", "沒有淨口徑的日子印 --，不用 0");
  assert.equal(first.toggles, 25);
  assert.match(first.more, /顯示更早 20 天（共 25 天）/);
  app.evalIn(`document.querySelector("#m4host [data-verify-toggle]").click()`);
  assert.deepEqual(json(`(() => { const row = document.querySelector("#m4host .verify-history-row:not(.is-head)"); return [row.classList.contains("is-expanded"), row.querySelector("[data-verify-toggle]").getAttribute("aria-expanded"), [...verifyHistoryState.expanded]]; })()`), [true, "true", ["2026-08-25"]]);
  app.evalIn(`document.getElementById("m4host").innerHTML = renderVerifyHistory();`);
  assert.equal(json(`document.querySelector("#m4host .verify-history-row:not(.is-head)").classList.contains("is-expanded")`), true, "重繪保留展開");
  app.evalIn(`document.querySelector("#m4host [data-verify-toggle]").click()`);
  assert.deepEqual(json(`[document.querySelector("#m4host .verify-history-row:not(.is-head)").classList.contains("is-expanded"), verifyHistoryState.expanded.size]`), [false, 0], "再點收回");
  app.evalIn(`document.querySelector("#m4host [data-verify-more]").click()`);
  assert.equal(json(`verifyHistoryState.visibleDays`), 25);
  app.evalIn(`document.getElementById("m4host").innerHTML = renderVerifyHistory();`);
  assert.deepEqual(json(`[document.querySelectorAll("#m4host .verify-history-row.is-older").length, Boolean(document.querySelector("#m4host [data-verify-more]"))]`), [0, false]);
  app.evalIn(`document.getElementById("m4host").remove(); verifyHistoryState.visibleDays = 5; verifyHistoryState.expanded.clear();`);
});

const pick = {
  code: "2330", name: "台積電", rank: 1, score: 82, price: 1000, changePct: 1.2, market: "上市", asOf: "2026-09-12",
  plan: { entry: 1000, initialStop: 950, structuralStop: 960, target: 1100, rr: 2.5, rrNet: 2.2, trailingStart: 1050 },
  scenario: { key: "midBandDefense", name: "中軌攻防", desc: "回檔中軌站穩，MACD 維持金叉", warns: [] },
  indicators: { bollMid: 990, ma5: 995 }, volumeRatio5: 1.3, avgVolLots: 20000,
};
const fakeMedia = `(q) => ({ matches: /max-width: 760px/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })`;

test("策略卡：「為什麼入選」包成 details（手機摺、桌機開）、結構停損／目標標相對進場百分比", () => {
  app.evalIn(`window.__m4Media = window.matchMedia; window.matchMedia = ${fakeMedia};`);
  const mobile = json(`(() => {
    const host = document.createElement("div"); host.innerHTML = renderSwingCard(${JSON.stringify(pick)});
    const why = host.querySelector("details.swing-why");
    return { has: Boolean(why), open: why.hasAttribute("open"), brief: why.querySelector(".swing-why-brief").textContent,
      inside: ["p.swing-reason", ".swing-facts", ".swing-entry-tip"].map((s) => Boolean(why.querySelector(s))),
      pct: [...host.querySelectorAll(".swing-stat-pct")].map((n) => n.textContent) };
  })()`);
  assert.equal(mobile.has, true);
  assert.equal(mobile.open, false, "手機預設摺起");
  assert.match(mobile.brief, /量能放大/);
  assert.match(mobile.brief, /盈虧比 2\.5（淨 2\.2）、相當划算/);
  assert.deepEqual(mobile.inside, [true, true, true], "理由／指標／進場提示都在 details 裡");
  assert.deepEqual(mobile.pct, ["-4.0%", "+10.0%"]);
  app.evalIn(`window.matchMedia = window.__m4Media;`);
  assert.equal(json(`(() => { const host = document.createElement("div"); host.innerHTML = renderSwingCard(${JSON.stringify(pick)}); return host.querySelector("details.swing-why").hasAttribute("open"); })()`), true, "桌機展開（summary 由 CSS 藏）");
});

test("點「為什麼入選」的 summary 不會誤開明細", async () => {
  app.evalIn(`
    const host = document.createElement("div"); host.id = "m4card"; document.body.append(host);
    host.innerHTML = renderSwingCard(${JSON.stringify(pick)});
    host.querySelector(".swing-why > summary").click();`);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(json(`el.detailPanel.classList.contains("is-open")`), false);
  app.evalIn(`document.getElementById("m4card").remove()`);
});

test("庫存摘要條：今日損益只算有昨收的檔、缺昨收另計；本月已實現讀成績單當月桶，沒成績單印 --", () => {
  app.evalIn(`
    authState.user = authState.user || { id: "m4", username: "m4", displayName: "m4", role: "user" };
    tradesState.portfolio = { ok: true, holdings: [{ code: "2330", shares: 1000, avgCost: 100, cost: 100000 }, { code: "1101", shares: 2000, avgCost: 40, cost: 80000 }], realized: [], totals: { cost: 180000, realizedPnl: 0 } };
    tradesState.records = []; tradesState.loaded = true; tradesState.scorecard = null;
    holdingsPlanRiskState.loadAttempted = true; tradePlansState.loaded = true; // 不觸發背景抓計畫，測試結束後才不會有非同步活動
    stocks.length = 0;
    [{ code: "2330", name: "台積電", price: 110, previousClose: 105, groups: [], strategies: [], spark: [] },
     { code: "1101", name: "台泥", price: 38, previousClose: null, groups: [], strategies: [], spark: [] }].forEach((row) => stocks.push(row));
    state.watchList = "hold"; renderHoldingsPanel();`);
  const strip = json(`(() => {
    const s = el.holdingsPanel.querySelector(".hold-strip");
    return { cells: [...s.children].map((c) => [c.querySelector("span").textContent, c.querySelector("strong").textContent, c.querySelector("strong").className, c.querySelector("small")?.textContent || ""]),
      kpi: [...el.holdingsPanel.querySelectorAll(".hold-summary > [data-hold-kpi]")].map((n) => n.dataset.holdKpi) };
  })()`);
  assert.deepEqual(strip.cells.map((c) => c[0]), ["今日損益", "未實現", "市值", "本月已實現"]);
  assert.deepEqual(strip.cells[0].slice(1), ["+5,000", "is-up", "缺 1 檔昨收"], "(110−105)×1000；台泥缺昨收不算也不冒充 0");
  assert.deepEqual(strip.cells[1].slice(1, 3), ["+6,000", "is-up"], "未實現 = (110×1000−100000) + (38×2000−80000)");
  assert.equal(strip.cells[2][1], "186,000");
  assert.equal(strip.cells[3][1], "--");
  assert.deepEqual(strip.kpi, ["value", "unrealized"], "總覽格標記市值／未實現，手機 CSS 藏起來");
  const monthKey = json(`taipeiTodayCompact().slice(0, 6)`);
  app.evalIn(`tradesState.scorecard = { months: [{ key: "${monthKey}", realizedPnl: -1234 }] }; renderHoldingsPanel();`);
  assert.deepEqual(json(`(() => { const c = el.holdingsPanel.querySelector(".hold-strip").children[3]; return [c.querySelector("strong").textContent, c.querySelector("strong").className]; })()`), ["-1,234", "is-down"]);
  app.evalIn(`tradesState.scorecard = { months: [{ key: "200001", realizedPnl: 999 }] }; renderHoldingsPanel();`);
  assert.equal(json(`el.holdingsPanel.querySelector(".hold-strip").children[3].querySelector("strong").textContent`), "+0", "有成績單但本月沒交易＝0，不是 --");
  app.evalIn(`tradesState.scorecard = null; state.watchList = 1; renderHoldingsPanel();`);
});
