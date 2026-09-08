// K 線操作說明的延遲開啟、手動入口與重開／載入失敗生命週期；只用離線 DOM 與可控時鐘。
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
let clock;
let deferred = [];

function controlClock(win) {
  let now = 0;
  let nextId = 1;
  const jobs = new Map();
  win.setTimeout = (callback, delay = 0, ...args) => {
    const id = nextId++;
    jobs.set(id, { at: now + delay, callback: () => callback(...args) });
    return id;
  };
  win.clearTimeout = (id) => jobs.delete(id);
  win.requestAnimationFrame = (callback) => win.setTimeout(() => callback(now), 0);
  win.cancelAnimationFrame = win.clearTimeout;
  return {
    advance(ms = 0) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, job] = next;
        jobs.delete(id);
        now = job.at;
        job.callback();
      }
      now = end;
    },
  };
}

beforeEach(async () => {
  deferred = [];
  app = await createAppWindow();
  app.evalIn(`
    state.screen = "technical";
    render();
    state.technicalCode = "2330";
    state.selectedCode = "2330";
    state.technicalPeriod = "day";
    technicalState.data = {
      ok: true, code: "2330", name: "台積電", period: "day",
      candles: [{ date: "2026-09-01", open: 100, high: 103, low: 99, close: 102, volume: 1000 }],
      signals: { checks: {}, risks: [] }, trendLines: {},
      fibonacci: { active: false }, corporateActions: { events: [], notes: [] }
    };
  `);
  await app.settle();
  clock = controlClock(app.win);
});

afterEach(async () => {
  deferred.forEach((resolve) => resolve({ ok: false, error: "fixture cleanup" }));
  await app.settle();
  try {
    assert.deepEqual(app.jsdomErrors, [], "click handlers must not throw");
  } finally {
    app.cleanup();
  }
});

function click(id) {
  const button = app.doc.getElementById(id);
  assert.ok(button, `missing #${id}`);
  button.focus();
  button.click();
  clock.advance();
}

function helpHidden() { return app.doc.getElementById("zoomChartHelp").hidden; }
function zoomHidden() { return app.doc.getElementById("technicalZoomModal").hidden; }

function deferTechnicalRequests() {
  const originalFetch = app.win.fetch;
  const pending = deferred;
  app.win.fetch = (input, init) => {
    if (!String(input).startsWith("/api/technical-analysis?")) return originalFetch(input, init);
    return new Promise((resolve) => pending.push((body) => resolve({
      ok: true, status: 200, json: async () => body,
      headers: { get: () => "application/json" },
    })));
  };
  return pending;
}

test("closing the chart before first help cancels its delayed dialog and preserves opener focus", () => {
  click("technicalZoomOpen");
  click("zoomChartClose");
  clock.advance(500);
  assert.equal(zoomHidden(), true);
  assert.equal(helpHidden(), true);
  assert.equal(app.evalIn("topDialogLayer()"), null);
  assert.equal(app.doc.activeElement.id, "technicalZoomOpen");
  assert.equal(app.win.localStorage.getItem("stock1.zoomHelpSeen.v1"), null, "unseen help remains eligible next time");
});

test("manually reading and dismissing help cancels the pending automatic reopen", () => {
  click("technicalZoomOpen");
  click("zoomChartHelpOpen");
  click("zoomChartHelpGot");
  clock.advance(500);
  assert.equal(helpHidden(), true);
  assert.equal(zoomHidden(), false);
  assert.equal(app.doc.activeElement.id, "zoomChartHelpOpen");
});

test("another top dialog retains focus when automatic help becomes due", () => {
  click("technicalZoomOpen");
  click("searchOpen");
  assert.equal(app.doc.activeElement.id, "searchInput");
  clock.advance(500);
  assert.equal(helpHidden(), true);
  assert.equal(app.evalIn("topDialogLayer().id"), "searchModal");
  assert.equal(app.doc.activeElement.id, "searchInput");
  assert.equal(app.win.localStorage.getItem("stock1.zoomHelpSeen.v1"), null);
});

test("first uninterrupted opening shows help once and later chart openings stay unobscured", () => {
  click("technicalZoomOpen");
  assert.equal(helpHidden(), true);
  clock.advance(500);
  assert.equal(helpHidden(), false);
  assert.equal(app.doc.activeElement.id, "zoomChartHelpClose");
  assert.equal(app.win.localStorage.getItem("stock1.zoomHelpSeen.v1"), "1");
  click("zoomChartHelpGot");
  click("zoomChartClose");
  click("technicalZoomOpen");
  clock.advance(500);
  assert.equal(helpHidden(), true);
  assert.equal(zoomHidden(), false);
});

test("technical page help remains available without opening or loading a chart", () => {
  app.evalIn("technicalState.data = null");
  click("technicalHelpOpen");
  assert.equal(helpHidden(), false);
  assert.equal(zoomHidden(), true);
  click("zoomChartHelpClose");
  assert.equal(app.doc.activeElement.id, "technicalHelpOpen");
});

test("reopening a cached stock while help is visible closes help without hiding the chart", () => {
  click("detailZoomOpen");
  clock.advance(500);
  assert.equal(helpHidden(), false);
  click("detailZoomOpen");
  clock.advance(500);
  assert.equal(helpHidden(), true);
  assert.equal(zoomHidden(), false);
  assert.equal(app.evalIn("topDialogLayer().id"), "technicalZoomModal");
});

test("help seen in another tab during the delay suppresses automatic help", () => {
  click("technicalZoomOpen");
  app.win.localStorage.setItem("stock1.zoomHelpSeen.v1", "1");
  clock.advance(500);
  assert.equal(helpHidden(), true);
  assert.equal(zoomHidden(), false);
});

test("closing and reopening a chart gives the new opening its own help delay", () => {
  click("technicalZoomOpen");
  clock.advance(200);
  click("zoomChartClose");
  click("technicalZoomOpen");
  clock.advance(200);
  assert.equal(helpHidden(), true, "the first opening's expired timer must not open help early");
  clock.advance(300);
  assert.equal(helpHidden(), false, "the new opening still receives its first-use guide");
});

test("loading a different stock cancels old help and failed loading leaves both layers closed", async () => {
  const pending = deferTechnicalRequests();
  click("technicalZoomOpen");
  app.evalIn('state.selectedCode = "2317"');
  click("detailZoomOpen");
  assert.equal(pending.length, 1);
  clock.advance(500);
  assert.equal(helpHidden(), true, "old chart help must not appear above the new loading shell");
  pending[0]({ ok: false, error: "offline fixture: unavailable" });
  await app.settle();
  clock.advance(500);
  assert.equal(zoomHidden(), true);
  assert.equal(helpHidden(), true);
  assert.equal(app.evalIn("topDialogLayer()"), null);
});

test("a successful cold load still receives the first-use guide after data is ready", async () => {
  const payload = JSON.parse(app.evalIn("JSON.stringify(technicalState.data)"));
  const pending = deferTechnicalRequests();
  app.evalIn("technicalState.data = null");
  click("detailZoomOpen");
  clock.advance(500);
  assert.equal(zoomHidden(), false);
  assert.equal(helpHidden(), true);
  pending[0](payload);
  await app.settle();
  clock.advance(500);
  assert.equal(helpHidden(), false);
  assert.equal(zoomHidden(), false);
  assert.match(app.doc.getElementById("zoomChartTitle").textContent, /2330/);
});

test("an obsolete same-stock request cannot close a freshly reopened loading chart", async () => {
  const pending = deferTechnicalRequests();
  app.evalIn("technicalState.data = null");
  click("detailZoomOpen");
  click("zoomChartClose");
  click("detailZoomOpen");
  assert.equal(pending.length, 2);
  pending[0]({ ok: false, error: "obsolete request failed" });
  await app.settle();
  clock.advance(500);
  assert.equal(zoomHidden(), false, "the latest request still owns its loading shell");
  assert.equal(helpHidden(), true);
  pending[1]({ ok: false, error: "current request failed" });
  await app.settle();
  clock.advance(500);
  assert.equal(zoomHidden(), true);
  assert.equal(helpHidden(), true);
});
