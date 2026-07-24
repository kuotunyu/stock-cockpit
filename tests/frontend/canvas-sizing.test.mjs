import test from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

function setDpr2(win) {
  Object.defineProperty(win, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });
}

function seedTechnicalData(app) {
  app.evalIn(`
    window.__canvasTestData = {
      ok: true,
      code: "2330",
      name: "台積電",
      period: "day",
      candles: Array.from({ length: 40 }, (_, index) => {
        const base = 100 + index;
        return {
          date: "2026-06-" + String((index % 28) + 1).padStart(2, "0"),
          open: base,
          high: base + 3,
          low: base - 2,
          close: base + 1,
          volume: 1000 + index * 10,
          volumeLots: 1000 + index * 10,
          maShort: base + 0.5,
          maMid: base - 0.5,
          macd: { dif: 0.4, dea: 0.2, histogram: 0.2 },
        };
      }),
      trendLines: {},
      fibonacci: { active: false, levels: [] },
    };

    window.__makeCountingCanvas = (cssWidth, cssHeight, initialWidth = 13, initialHeight = 17) => {
      let backingWidth = initialWidth;
      let backingHeight = initialHeight;
      const writes = { width: 0, height: 0 };
      const canvas = {
        style: {},
        get width() { return backingWidth; },
        set width(value) { backingWidth = value; writes.width += 1; },
        get height() { return backingHeight; },
        set height(value) { backingHeight = value; writes.height += 1; },
        getBoundingClientRect: () => ({
          width: cssWidth,
          height: cssHeight,
          left: 0,
          top: 0,
          right: cssWidth,
          bottom: cssHeight,
        }),
        getContext: () => window.__mockCtx(),
      };
      return { canvas, writes };
    };

    window.__instrumentDomCanvas = (canvas, cssWidth, cssHeight, initialWidth = 13, initialHeight = 17) => {
      let backingWidth = initialWidth;
      let backingHeight = initialHeight;
      const writes = { width: 0, height: 0 };
      Object.defineProperty(canvas, "width", {
        configurable: true,
        get: () => backingWidth,
        set: (value) => { backingWidth = value; writes.width += 1; },
      });
      Object.defineProperty(canvas, "height", {
        configurable: true,
        get: () => backingHeight,
        set: (value) => { backingHeight = value; writes.height += 1; },
      });
      canvas.getBoundingClientRect = () => ({
        width: cssWidth,
        height: cssHeight,
        left: 0,
        top: 0,
        right: cssWidth,
        bottom: cssHeight,
      });
      return writes;
    };
  `);
}

test("DPR=2 時隱藏的技術圖與 MACD 連續重畫不會放大 backing store", async () => {
  const app = await createAppWindow({ beforeApp: setDpr2 });
  try {
    seedTechnicalData(app);
    const result = JSON.parse(app.evalIn(`JSON.stringify((() => {
      const main = document.getElementById("technicalChart");
      const macd = document.getElementById("technicalMacdChart");
      main.width = 901;
      main.height = 451;
      macd.width = 777;
      macd.height = 333;
      const hiddenRect = () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });
      main.getBoundingClientRect = hiddenRect;
      macd.getBoundingClientRect = hiddenRect;

      const firstMain = drawTechnicalChart(window.__canvasTestData, { canvas: main });
      const firstMacd = drawTechnicalMacdChart(window.__canvasTestData);
      const secondMain = drawTechnicalChart(window.__canvasTestData, { canvas: main });
      const secondMacd = drawTechnicalMacdChart(window.__canvasTestData);
      return {
        allSkipped: [firstMain, firstMacd, secondMain, secondMacd].every((value) => value === null),
        mainWidth: main.width,
        mainHeight: main.height,
        macdWidth: macd.width,
        macdHeight: macd.height,
      };
    })())`));

    assert.equal(result.allSkipped, true);
    assert.deepEqual(result, {
      allSkipped: true,
      mainWidth: 901,
      mainHeight: 451,
      macdWidth: 777,
      macdHeight: 333,
    });
  } finally {
    app.cleanup();
  }
});

test("可見 canvas 以 CSS 尺寸乘 DPR 配置，重畫相同尺寸不重設 width/height", async () => {
  const app = await createAppWindow({ beforeApp: setDpr2 });
  try {
    seedTechnicalData(app);
    const result = JSON.parse(app.evalIn(`JSON.stringify((() => {
      const main = window.__makeCountingCanvas(320, 180);
      const prepared = prepareCanvas(main.canvas);
      const afterPrepare = { ...main.writes };
      const firstGeometry = drawTechnicalChart(window.__canvasTestData, { canvas: main.canvas });
      const afterFirstDraw = { ...main.writes };
      const secondGeometry = drawTechnicalChart(window.__canvasTestData, { canvas: main.canvas });

      const macdCanvas = document.getElementById("technicalMacdChart");
      const macdWrites = window.__instrumentDomCanvas(macdCanvas, 320, 180);
      drawTechnicalMacdChart(window.__canvasTestData);
      const afterFirstMacdDraw = { ...macdWrites };
      drawTechnicalMacdChart(window.__canvasTestData);

      return {
        prepared: {
          width: prepared.width,
          height: prepared.height,
          ratio: prepared.ratio,
          pixelWidth: prepared.pixelWidth,
          pixelHeight: prepared.pixelHeight,
        },
        mainBacking: { width: main.canvas.width, height: main.canvas.height },
        afterPrepare,
        afterFirstDraw,
        afterSecondDraw: { ...main.writes },
        geometrySizes: [
          [firstGeometry.width, firstGeometry.height],
          [secondGeometry.width, secondGeometry.height],
        ],
        macdBacking: { width: macdCanvas.width, height: macdCanvas.height },
        afterFirstMacdDraw,
        afterSecondMacdDraw: { ...macdWrites },
      };
    })())`));

    assert.deepEqual(result.prepared, {
      width: 320,
      height: 180,
      ratio: 2,
      pixelWidth: 640,
      pixelHeight: 360,
    });
    assert.deepEqual(result.mainBacking, { width: 640, height: 360 });
    assert.deepEqual(result.afterPrepare, { width: 1, height: 1 });
    assert.deepEqual(result.afterFirstDraw, result.afterPrepare);
    assert.deepEqual(result.afterSecondDraw, result.afterPrepare);
    assert.deepEqual(result.geometrySizes, [[320, 180], [320, 180]]);

    assert.deepEqual(result.macdBacking, { width: 640, height: 360 });
    assert.deepEqual(result.afterFirstMacdDraw, { width: 1, height: 1 });
    assert.deepEqual(result.afterSecondMacdDraw, result.afterFirstMacdDraw);
  } finally {
    app.cleanup();
  }
});

test("zoom 280x180 以實際 CSS content size 建立 geometry", async () => {
  const app = await createAppWindow({ beforeApp: setDpr2 });
  try {
    seedTechnicalData(app);
    const result = JSON.parse(app.evalIn(`JSON.stringify((() => {
      const base = document.getElementById("zoomChartCanvas");
      const cross = document.getElementById("zoomCrosshairCanvas");
      window.__instrumentDomCanvas(base, 280, 180, 0, 0);
      window.__instrumentDomCanvas(cross, 280, 180, 0, 0);
      technicalState.data = window.__canvasTestData;
      zoomChartState.open = true;
      zoomChartState.viewStart = 0;
      zoomChartState.viewCount = window.__canvasTestData.candles.length;
      zoomChartState.index = window.__canvasTestData.candles.length - 1;

      drawZoomChart();
      return {
        geometryWidth: zoomChartState.geometry?.width,
        geometryHeight: zoomChartState.geometry?.height,
        baseWidth: base.width,
        baseHeight: base.height,
        crossWidth: cross.width,
        crossHeight: cross.height,
      };
    })())`));

    assert.deepEqual(result, {
      geometryWidth: 280,
      geometryHeight: 180,
      baseWidth: 560,
      baseHeight: 360,
      crossWidth: 560,
      crossHeight: 360,
    });
  } finally {
    app.cleanup();
  }
});

test("ResizeObserver 與 window resize 在同一 frame 合併為每種可見圖一次重畫", async () => {
  const app = await createAppWindow({
    beforeApp(win) {
      setDpr2(win);
      win.__resizeObserverInstances = [];
      win.ResizeObserver = class ResizeObserver {
        constructor(callback) {
          this.callback = callback;
          this.targets = [];
          win.__resizeObserverInstances.push(this);
        }

        observe(target) {
          this.targets.push(target);
        }

        disconnect() {}
      };

      let nextFrameId = 1;
      const frames = new Map();
      win.__testAnimationFrames = frames;
      win.requestAnimationFrame = (callback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      };
      win.cancelAnimationFrame = (id) => frames.delete(id);
      win.__flushTestAnimationFrame = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(win.performance.now()));
      };
    },
  });

  try {
    seedTechnicalData(app);
    // 清掉 initializeApp/render/watchCanvasDpr 在載入期排入的 frame，讓本測試只量 resize 工作。
    for (let index = 0; index < 6; index += 1) {
      const pending = app.evalIn("window.__testAnimationFrames.size");
      if (!pending) break;
      app.evalIn("window.__flushTestAnimationFrame()");
    }

    const observerShape = JSON.parse(app.evalIn(`JSON.stringify((() => {
      const instances = window.__resizeObserverInstances;
      const observer = instances[0];
      return {
        instanceCount: instances.length,
        targetCount: observer?.targets.length || 0,
        targets: (observer?.targets || []).map((target) => ({
          id: target.id,
          className: target.className,
        })),
      };
    })())`));

    assert.equal(observerShape.instanceCount, 1, "全站應共用一個 ResizeObserver");
    assert.equal(observerShape.targetCount, 3, "應觀察 detail、technical、zoom 三個穩定容器");
    assert.deepEqual(
      observerShape.targets.map((target) => target.id),
      ["", "", "zoomChartStage"],
    );
    assert.match(observerShape.targets[0].className, /detail-chart-wrap/);
    assert.match(observerShape.targets[1].className, /technical-chart-card/);

    const result = JSON.parse(app.evalIn(`JSON.stringify((() => {
      window.__resizeDrawCounts = { detail: 0, technical: 0, macd: 0, zoom: 0, readout: 0 };
      drawChart = () => { window.__resizeDrawCounts.detail += 1; };
      drawTechnicalChart = () => { window.__resizeDrawCounts.technical += 1; };
      drawTechnicalMacdChart = () => { window.__resizeDrawCounts.macd += 1; };
      drawZoomChart = () => { window.__resizeDrawCounts.zoom += 1; };
      updateZoomReadout = () => { window.__resizeDrawCounts.readout += 1; };
      state.screen = "technical";
      technicalState.data = window.__canvasTestData;
      zoomChartState.open = true;
      zoomChartState.index = 12;

      const observer = window.__resizeObserverInstances[0];
      const entries = observer.targets.map((target) => ({ target }));
      observer.callback(entries);
      observer.callback(entries);
      observer.callback(entries);
      window.dispatchEvent(new Event("resize"));

      const pendingBeforeFlush = window.__testAnimationFrames.size;
      const beforeFlush = { ...window.__resizeDrawCounts };
      window.__flushTestAnimationFrame();
      return {
        pendingBeforeFlush,
        beforeFlush,
        afterFlush: { ...window.__resizeDrawCounts },
        pendingAfterFlush: window.__testAnimationFrames.size,
      };
    })())`));

    assert.equal(result.pendingBeforeFlush, 1, "同 tick 多次通知只能排入一個 animation frame");
    assert.deepEqual(result.beforeFlush, { detail: 0, technical: 0, macd: 0, zoom: 0, readout: 0 });
    assert.deepEqual(result.afterFlush, { detail: 1, technical: 1, macd: 1, zoom: 1, readout: 1 });
    assert.equal(result.pendingAfterFlush, 0);
  } finally {
    app.cleanup();
  }
});
