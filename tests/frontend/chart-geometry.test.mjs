// K 線放大圖幾何不變量：右側價格欄永不出畫布、字級自動縮但不低於下限、回傳 laneBadges。
// 用假 canvas（getBoundingClientRect 指定寬度＋mock 2D context）呼叫 drawTechnicalChart。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
  // 造一份含回撤標籤的技術分析資料（60 根上升趨勢；高價股→長標籤「0.382 486.8」考驗縮字）
  app.evalIn(`
    window.__testData = (() => {
      const candles = [];
      for (let i = 0; i < 60; i += 1) {
        const base = 100 + i * 6;
        candles.push({
          date: "2026-0" + (1 + Math.floor(i / 28)) + "-" + String((i % 28) + 1).padStart(2, "0"),
          open: base, high: base + 3, low: base - 3, close: base + 1.2,
          volume: 1000 + i * 8, volumeLots: 1000 + i * 8,
          maShort: base + 0.5, maMid: base - 0.4,
          macd: { dif: 0.2, dea: 0.1, histogram: 0.1 },
        });
      }
      return {
        ok: true, code: "3008", name: "大立光", period: "day", candles,
        trendLines: {},
        fibonacci: { active: true, levels: [
          { ratio: 0.382, price: 486.8, near: false },
          { ratio: 0.5, price: 284.7, near: false },
          { ratio: 0.618, price: 182.6, near: true },
        ]},
      };
    })();
    window.__fakeCanvas = (w, h) => ({
      width: 0, height: 0, style: {},
      getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }),
      getContext: () => window.__mockCtx(),
    });
  `);
});
after(() => app.cleanup());

const geomAt = (width, height = 760) => JSON.parse(app.evalIn(`
  JSON.stringify((() => {
    const g = drawTechnicalChart(window.__testData, {
      canvas: window.__fakeCanvas(${width}, ${height}), enlarged: true, viewStart: 0, viewEnd: 59,
    });
    return {
      width: g.width, plotRight: g.plotRight, laneLabelX: g.laneLabelX,
      laneBadgeWidth: g.laneBadgeWidth, laneFontPx: g.laneFontPx,
      laneBadgeCount: (g.laneBadges || []).length, uiScale: g.uiScale,
      hasConverters: typeof g.priceToY === "function" && typeof g.indexToX === "function",
    };
  })())
`));

for (const width of [1900, 1200, 820]) {
  test(`寬 ${width}：價格欄右緣 ≤ 畫布、字級 ≥ 12、laneBadges 齊備`, () => {
    const g = geomAt(width);
    assert.equal(g.width, width);
    assert.ok(g.laneLabelX + g.laneBadgeWidth <= g.width, `lane 右緣 ${g.laneLabelX + g.laneBadgeWidth} 超出畫布 ${g.width}`);
    assert.ok(g.laneFontPx >= 12, `字級 ${g.laneFontPx} 低於下限 12`);
    assert.ok(g.laneBadgeCount >= 4, `右欄標籤數 ${g.laneBadgeCount}（收＋3 條回撤至少 4）`);
    assert.ok(g.plotRight < g.laneLabelX, "價格欄在繪圖區右側");
    assert.equal(g.hasConverters, true, "geometry 需含座標換算函式");
  });
}

test("字級隨寬度不增（縮小畫布 → 字級單調不增）", () => {
  const wide = geomAt(1900);
  const mid = geomAt(1200);
  const narrow = geomAt(820);
  assert.ok(wide.laneFontPx >= mid.laneFontPx && mid.laneFontPx >= narrow.laneFontPx,
    `${wide.laneFontPx} → ${mid.laneFontPx} → ${narrow.laneFontPx} 應單調不增`);
});

test("mock context 有實際繪製呼叫（sanity）", () => {
  const before = app.canvasOps.count;
  geomAt(1200);
  assert.ok(app.canvasOps.count > before + 50, "drawTechnicalChart 應產生大量繪製呼叫");
});

test("無資料 → 回 null 並畫等待字樣（不炸）", () => {
  const out = app.evalIn(`drawTechnicalChart(null, { canvas: window.__fakeCanvas(800, 600) })`);
  assert.equal(out, null);
});
