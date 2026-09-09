// 技術分析切週期／切股票的等待期間，舊資料不得以新標題出現（computer use 心得 F08／CUA-08）。
// 原稿懷疑標題與摘要混搭；程式碼核實 loading 分支已清標題、摘要、detail grid、markers 與兩張 canvas，
// 真正的外漏在三處：① renderTechnicalSurveillance 在 loading return 之前執行並讀舊 technicalState.data 的處置徽章；
// ② #technicalOhlc 只在 drawTechnicalChart 走到 renderChartOhlc 時清，canvas 無尺寸（隱藏面板、預布局、jsdom）時舊列全留且表頭標日K；
// ③ scheduleCanvasRedraw 無 loading 守衛，resize/rAF 會把舊週期 K 線畫回。requestId／Abort 邏輯不動。
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createAppWindow } from "../helpers/dom-harness.mjs";

function payload(code, period, extra = {}) {
  return {
    ok: true, code, name: `測試${code}`, period,
    candles: Array.from({ length: 60 }, (_, index) => ({ date: new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10), open: 100, high: 103, low: 99, close: 102, volume: 1000 })),
    signals: { checks: {}, risks: [] }, trendLines: {}, fibonacci: { active: false }, corporateActions: { events: [], notes: [] },
    ...extra,
  };
}

async function fixture(t) {
  const app = await createAppWindow();
  const requests = [];
  t.after(async () => {
    requests.forEach((request) => request.reply({ ok: false, error: "fixture cleanup" }));
    await setImmediate();
    app.cleanup();
  });
  app.win.localStorage.setItem("stock1.zoomHelpSeen.v1", "1");
  app.evalIn(`stocks.splice(0); stocks.push({ code: "2330", name: "測試2330", price: 102, change: 2, changeText: "+2%", spark: [100, 102], groups: [], strategies: [], sourceKind: "official" });
    state.screen = "technical"; state.technicalCode = "2330"; state.technicalPeriod = "day"; state.selectedCode = "2330";
    technicalState.data = ${JSON.stringify(payload("2330", "day", { surveillance: { kind: "disposition", label: "處置" } }))}; render();
    // jsdom 的 canvas 沒有尺寸，drawTechnicalChart 不會走到 renderChartOhlc；比照真瀏覽器先把日 K 的 OHLC 表畫出來。
    renderChartOhlc(el.technicalChart, technicalState.data, technicalState.data.candles);`);
  const fetch = app.win.fetch;
  app.win.fetch = (url, init) => {
    if (!String(url).startsWith("/api/technical-analysis?")) return fetch(url, init);
    return new Promise((resolve) => requests.push({ url, reply: (body) => resolve({ ok: true, status: 200, json: async () => body, headers: { get: () => "application/json" } }) }));
  };
  const click = (selector) => { const button = app.doc.querySelector(selector); button.focus(); button.click(); };
  const snapshot = () => JSON.parse(app.evalIn(`JSON.stringify({
    loading: technicalState.loading,
    status: el.technicalStatus.textContent,
    survHidden: el.technicalSurveillance.hidden, survText: el.technicalSurveillance.textContent.replace(/\\s+/g, " ").trim(),
    ohlcRows: document.querySelectorAll("#technicalOhlc tbody tr").length,
    ohlcHead: (document.querySelector("#technicalOhlc p") || {}).textContent || "",
    dataPeriod: technicalState.data ? technicalState.data.period : null,
  })`));
  // 週期按鈕經 analyzeTechnicalFromInput 的 async resolveStockQuery 才發請求，等到請求排進佇列再快照。
  const waitForRequests = async (count) => {
    for (let round = 0; round < 40 && requests.length < count; round += 1) await app.settle(1);
    assert.equal(requests.length >= count, true, `前提：應已發出第 ${count} 個技術分析請求`);
  };
  // 回應後 loadTechnicalAnalysis 還會 await syncDetailQuoteForTechnical 才結束 loading；等到真的閒置再快照。
  return { ...app, requests, click, snapshot, waitForRequests, async reply(index, body) {
    requests[index].reply(body); await setImmediate();
    for (let round = 0; round < 40 && app.evalIn("technicalState.loading") === true; round += 1) await app.settle(1);
    await app.settle();
  } };
}

test("前提：日 K 完成後處置徽章與 60 列 OHLC 表都在", async (t) => {
  const app = await fixture(t);
  const before = app.snapshot();
  assert.equal(before.survHidden, false);
  assert.match(before.survText, /處置/);
  assert.equal(before.ohlcRows, 60);
  assert.match(before.ohlcHead, /2330 日K/);
});

test("① 切到沒有處置的另一檔：載入期間不得掛著上一檔的處置徽章；完成後依新資料", async (t) => {
  const app = await fixture(t);
  app.evalIn(`state.technicalCode = "2317"; technicalInputDirty = false; void loadTechnicalAnalysis();`);
  const during = app.snapshot();
  assert.equal(during.loading, true, "前提：正在載入");
  assert.match(during.status, /2317 日K 分析中/);
  assert.equal(during.survHidden, true, "載入中不得顯示上一檔的處置徽章");
  await app.reply(0, payload("2317", "day"));
  const after = app.snapshot();
  assert.equal(after.loading, false);
  assert.equal(after.survHidden, true, "新資料沒有處置就不顯示");
  // 第一次成功後個股明細會自己再要一次同 URL 的日 K（detailHistoryCache），所以技術頁的第二次請求是最新那一筆。
  app.evalIn(`state.technicalCode = "2330"; void loadTechnicalAnalysis();`);
  await app.waitForRequests(3);
  await app.reply(app.requests.length - 1, payload("2330", "day", { surveillance: { kind: "attention", label: "注意" } }));
  assert.match(app.snapshot().survText, /注意/, "完成後顯示這次回應的標籤");
});

test("② 日 K → 週 K：載入期間 OHLC 表清空並標明新週期載入中，不留 60 列日 K 與「日K」表頭", async (t) => {
  const app = await fixture(t);
  app.click('[data-analysis-period="week"]');
  await app.waitForRequests(1);
  const during = app.snapshot();
  assert.equal(during.loading, true);
  assert.equal(during.ohlcRows, 0, "canvas 沒尺寸時也要清掉舊週期的 OHLC 列");
  assert.match(during.ohlcHead, /2330 週K/, "表頭要標新週期");
  assert.match(during.ohlcHead, /載入中/);
  assert.doesNotMatch(during.ohlcHead, /日K/);
  await app.reply(0, payload("2330", "week"));
  assert.equal(app.snapshot().dataPeriod, "week");
});

test("③ 載入期間的 rAF 重繪不得把舊週期 K 線畫回（scheduleCanvasRedraw 要看 loading）", async (t) => {
  const app = await fixture(t);
  app.click('[data-analysis-period="week"]');
  await app.waitForRequests(1);
  assert.equal(app.evalIn("technicalState.loading"), true);
  const painted = JSON.parse(await app.evalIn(`(async () => {
    const calls = [];
    const origChart = drawTechnicalChart, origMacd = drawTechnicalMacdChart;
    drawTechnicalChart = (data) => { calls.push(["chart", data ? data.period : null]); return null; };
    drawTechnicalMacdChart = (data) => { calls.push(["macd", data ? data.period : null]); return null; };
    scheduleCanvasRedraw("technical");
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    drawTechnicalChart = origChart; drawTechnicalMacdChart = origMacd;
    return JSON.stringify(calls);
  })()`));
  assert.ok(painted.length >= 1, "rAF 有觸發重繪");
  for (const [kind, period] of painted) assert.equal(period, null, `${kind} 載入中不得用舊資料（${period}）重繪`);
  await app.reply(0, payload("2330", "week"));
  const after = JSON.parse(await app.evalIn(`(async () => {
    const calls = [];
    const orig = drawTechnicalChart; drawTechnicalChart = (data) => { calls.push(data ? data.period : null); return null; };
    scheduleCanvasRedraw("technical");
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    drawTechnicalChart = orig;
    return JSON.stringify(calls);
  })()`));
  assert.deepEqual(after, ["week"], "完成後重繪用的是新週期資料");
});

test("日 → 週 → 月快速切換：週的回應晚到也不能覆蓋月；完成後三處上下文一致", async (t) => {
  const app = await fixture(t);
  app.click('[data-analysis-period="week"]');
  await app.waitForRequests(1);
  app.click('[data-analysis-period="month"]');
  await app.waitForRequests(2);
  assert.equal(app.requests.length, 2);
  await app.reply(0, payload("2330", "week"));
  const stillLoading = app.snapshot();
  assert.equal(stillLoading.loading, true, "週的回應是過期請求，月仍在載入");
  assert.match(stillLoading.status, /月K 分析中/);
  assert.equal(stillLoading.ohlcRows, 0);
  await app.reply(1, payload("2330", "month"));
  const done = app.snapshot();
  assert.equal(done.loading, false);
  assert.equal(done.dataPeriod, "month");
  assert.equal(done.survHidden, true);
});
