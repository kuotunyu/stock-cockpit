import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;

beforeEach(async () => {
  app = await createAppWindow();
  app.evalIn(`
    resetZoomPointerInteraction();
    window.__rafJobs = new Map();
    window.__rafNextId = 1;
    window.requestAnimationFrame = (callback) => {
      const id = window.__rafNextId++;
      window.__rafJobs.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => window.__rafJobs.delete(id);
    window.__flushRaf = () => {
      const jobs = [...window.__rafJobs.values()];
      window.__rafJobs.clear();
      jobs.forEach((callback) => callback(16));
    };
    el.zoomCrosshairCanvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500,
    });
  `);
});

afterEach(() => app.cleanup());

function dispatchPointer(type, {
  pointerId = 1,
  pointerType = "mouse",
  clientX = 0,
  clientY = 0,
  buttons = 0,
} = {}) {
  const event = new app.win.Event(type, { bubbles: true, cancelable: true });
  Object.entries({ pointerId, pointerType, clientX, clientY, buttons }).forEach(([key, value]) => {
    Object.defineProperty(event, key, { configurable: true, value });
  });
  app.doc.getElementById("zoomCrosshairCanvas").dispatchEvent(event);
  return event;
}

function dispatchWheel({ clientX = 0, clientY = 0, deltaY = 100 } = {}) {
  const event = new app.win.Event("wheel", { bubbles: true, cancelable: true });
  Object.entries({ clientX, clientY, deltaY }).forEach(([key, value]) => {
    Object.defineProperty(event, key, { configurable: true, value });
  });
  app.doc.getElementById("zoomCrosshairCanvas").dispatchEvent(event);
  return event;
}

test("20 pointermove events in one animation frame process only the latest coordinates", () => {
  app.evalIn(`
    zoomChartState.open = true;
    zoomChartState.locked = false;
    drawState.tool = "cursor";
    window.__handledMoves = [];
    handleZoomPointer = (event) => window.__handledMoves.push({
      x: event.clientX,
      y: event.clientY,
      buttons: event.buttons,
    });
  `);

  for (let index = 0; index < 20; index += 1) {
    dispatchPointer("pointermove", { clientX: 100 + index, clientY: 200 + index });
  }

  assert.equal(app.evalIn("window.__rafJobs.size"), 1, "the burst should schedule one frame");
  assert.equal(app.evalIn("window.__handledMoves.length"), 0, "work should wait for the frame");

  app.evalIn("window.__flushRaf()");

  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(window.__handledMoves)")),
    [{ x: 119, y: 219, buttons: 0 }],
  );
});

test("adding a second touch for pinch does not accidentally commit a drawing", () => {
  app.evalIn(`
    zoomChartState.open = true;
    zoomChartState.locked = false;
    zoomChartState.viewStart = 0;
    zoomChartState.viewCount = 30;
    zoomChartState.geometry = {
      candles: Array.from({ length: 60 }, (_, index) => ({ date: String(index), close: 100 })),
      chartWidth: 600,
      left: 40,
      indexFromX: () => 10,
    };
    drawState.tool = "horizontal";
    window.__drawCommits = [];
    window.__drawPreviews = [];
    handleDrawPointerDown = (x, y) => window.__drawCommits.push({ x, y });
    handleDrawPointerMove = (x, y) => window.__drawPreviews.push({ x, y });
  `);

  dispatchPointer("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 180, clientY: 220, buttons: 1 });
  dispatchPointer("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 420, clientY: 220, buttons: 1 });
  dispatchPointer("pointerup", { pointerId: 1, pointerType: "touch", clientX: 180, clientY: 220 });
  dispatchPointer("pointerup", { pointerId: 2, pointerType: "touch", clientX: 420, clientY: 220 });

  assert.equal(app.evalIn("window.__drawPreviews.length"), 1, "the first touch may preview the line");
  assert.equal(app.evalIn("window.__drawCommits.length"), 0, "a two-finger gesture must never place a line");
});

test("locked crosshair ignores mouse drag and wheel zoom", () => {
  app.evalIn(`
    zoomChartState.open = true;
    zoomChartState.locked = true;
    zoomChartState.index = 17;
    zoomChartState.viewStart = 8;
    zoomChartState.viewCount = 30;
    zoomChartState.geometry = {
      candles: Array.from({ length: 80 }, (_, index) => ({ date: String(index), close: 100 })),
      step: 10,
      chartWidth: 600,
      left: 40,
      indexFromX: (x) => Math.max(0, Math.min(79, Math.round(x / 10))),
    };
    drawState.tool = "cursor";
    window.__panCalls = 0;
    window.__zoomCalls = 0;
    panViewByBars = () => { window.__panCalls += 1; };
    zoomViewBy = () => { window.__zoomCalls += 1; };
  `);

  dispatchPointer("pointerdown", { pointerId: 7, clientX: 200, clientY: 180, buttons: 1 });
  dispatchPointer("pointermove", { pointerId: 7, clientX: 360, clientY: 180, buttons: 1 });
  app.evalIn("window.__flushRaf()");
  dispatchWheel({ clientX: 360, clientY: 180, deltaY: -120 });
  dispatchPointer("pointerup", { pointerId: 7, clientX: 360, clientY: 180 });

  assert.deepEqual(
    JSON.parse(app.evalIn(`JSON.stringify({
      index: zoomChartState.index,
      viewStart: zoomChartState.viewStart,
      panCalls: window.__panCalls,
      zoomCalls: window.__zoomCalls,
    })`)),
    { index: 17, viewStart: 8, panCalls: 0, zoomCalls: 0 },
  );
});

test("moving within the same candle keeps readout DOM and cached dimensions", () => {
  app.evalIn(`
    technicalState.data = {
      code: "2330",
      period: "day",
      candles: [
        { date: "2026-07-10", open: 990, high: 1005, low: 985, close: 1000, volumeLots: 1000,
          maShort: 995, maMid: 980, macd: { dif: 1, dea: 0.8, histogram: 0.2 } },
        { date: "2026-07-13", open: 1002, high: 1020, low: 998, close: 1015, volumeLots: 1200,
          maShort: 1000, maMid: 985, macd: { dif: 1.2, dea: 0.9, histogram: 0.3 } },
      ],
    };
    zoomChartState.open = true;
    zoomChartState.locked = false;
    zoomChartState.index = 1;
    zoomChartState.pointerY = 150;
    zoomChartState.geometry = {
      candles: technicalState.data.candles,
      left: 50, plotRight: 700, top: 30, priceBottom: 430,
      width: 800, height: 500, uiScale: 1,
      indexToX: (index) => 100 + index * 100,
      priceToY: (price) => 430 - price / 5,
      yToPrice: (y) => (430 - y) * 5,
    };
    invalidateZoomReadoutLayout({ content: true });
    window.__dimensionReads = 0;
    Object.defineProperty(el.zoomChartReadout, "offsetWidth", {
      configurable: true,
      get: () => { window.__dimensionReads += 1; return 320; },
    });
    Object.defineProperty(el.zoomChartReadout, "offsetHeight", {
      configurable: true,
      get: () => { window.__dimensionReads += 1; return 180; },
    });
    updateZoomReadout(1);
    window.__firstReadoutChild = el.zoomChartReadout.firstElementChild;
    window.__readsAfterFirstUpdate = window.__dimensionReads;
    zoomChartState.pointerY = 260;
    updateZoomReadout(1);
  `);

  assert.equal(app.evalIn("el.zoomChartReadout.firstElementChild === window.__firstReadoutChild"), true);
  assert.equal(app.evalIn("window.__dimensionReads"), app.evalIn("window.__readsAfterFirstUpdate"));
});
