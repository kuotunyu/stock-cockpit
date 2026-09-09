// 真實 Chromium：手機技術分析頁分析後圖表在首屏（CUA-07）。
// 手機只換兩條 CSS order（圖表卡排在四張摘要卡之前），DOM 順序與桌機視覺不變、Tab 順序不變（摘要卡沒有可聚焦元素）。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const CANDLES = Array.from({ length: 60 }, (_, index) => {
  const base = 100 + index * 0.5;
  const day = new Date(Date.UTC(2026, 5, 1 + index));
  const date = `${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${String(day.getUTCDate()).padStart(2, "0")}`;
  return { date, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + index };
});

test("390px：分析後 canvas 進首屏且至少一半可見、在摘要卡之前；1280 摘要仍在圖表之上、DOM 順序不變", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.route("**/api/technical-analysis?*", async (route) => {
      await route.fulfill({ json: { ok: true, code: "2330", name: "台積電", period: "day", candles: CANDLES, indicators: {}, summary: {}, corporateActions: { alert: false, notes: [] }, source: "fixture", asOf: "2026-09-04" } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await visibleNav(page, "technical").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#technicalCode").fill("2330");
    await page.locator("#technicalForm [type=submit]").click();
    await page.waitForFunction(() => technicalState.data && Array.isArray(technicalState.data.candles) && technicalState.data.candles.length > 0 && !technicalState.loading);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobile = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const canvas = rect("#technicalChart");
      const summary = rect("#technicalSummary");
      const header = rect(".technical-chart-card > header");
      const markers = rect("#technicalChartMarkers");
      const title = rect("#technicalTitle");
      const subtitle = rect("#technicalSubtitle");
      const vh = window.innerHeight;
      const legendChips = [...document.querySelectorAll("#technicalChartMarkers .technical-chart-marker.is-legend")];
      return { scrollY: window.scrollY, width: canvas.width, height: canvas.height, top: canvas.top, summaryTop: summary.top, innerHeight: vh,
        visible: Math.max(0, Math.min(canvas.bottom, vh) - Math.max(canvas.top, 0)),
        headerHeight: header.height, markersHeight: markers.height, legendChips: legendChips.length,
        titleLines: Math.round(title.height / parseFloat(getComputedStyle(document.querySelector("#technicalTitle")).lineHeight)),
        subtitleLines: Math.round(subtitle.height / parseFloat(getComputedStyle(document.querySelector("#technicalSubtitle")).lineHeight)),
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    });
    assert.equal(mobile.scrollY, 0);
    assert.ok(mobile.width > 0 && mobile.height > 0, "canvas 要有實際尺寸");
    assert.equal(mobile.bodyFits, true, "390px body 不可橫向溢出");
    // CUA-07 實測 390px：工具列 192px＋卡片標題 142px＋標記列 109px 之後 canvas 頂約 607px（56% 可見）。
    // 第五批③收斂卡片標題（標題與動作同列、副標獨占一列）與標記列（圖例籤自然寬度），canvas 頂要壓到 560px 內、至少六成可見。
    assert.ok(mobile.headerHeight <= 100, `卡片標題列不得超過 100px：${JSON.stringify(mobile)}`);
    assert.ok(mobile.titleLines <= 1 && mobile.subtitleLines <= 1, `標題與副標各一行：${JSON.stringify(mobile)}`);
    assert.equal(mobile.legendChips, 5, "五個圖例籤都在");
    assert.ok(mobile.markersHeight <= 80, `只有圖例時標記列不得超過 80px：${JSON.stringify(mobile)}`);
    assert.ok(mobile.top <= 560, `canvas 上緣要在 560px 內：${JSON.stringify(mobile)}`);
    assert.ok(mobile.visible >= 0.6 * mobile.height, `canvas 至少六成在首屏：${JSON.stringify(mobile)}`);
    assert.ok(mobile.top < mobile.summaryTop, "手機：圖表在摘要卡之前");
    // 圖真的畫出來了：有尺寸的 canvas 會把可見 K 線寫進 OHLC 表；只驗幾何會讓渲染例外也過關（複審 N8）。
    const ohlcRows = await page.locator("#technicalOhlc tbody tr").count();
    assert.ok(ohlcRows > 0, `OHLC 表要有可見 K 線列：${ohlcRows}`);
    assert.doesNotMatch(await page.locator("#technicalOhlc p").textContent(), /載入中|尚未布局/);
    await fixture.captureSnapshot("technical-mobile-chart-390");

    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const desktop = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const summary = document.getElementById("technicalSummary");
      const chart = document.querySelector(".technical-chart-card");
      return { summaryAboveChart: rect("#technicalSummary").top < rect(".technical-chart-card").top,
        domSummaryFirst: Boolean(summary.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    assert.equal(desktop.summaryAboveChart, true, "桌機：摘要仍在圖表之上");
    assert.equal(desktop.domSummaryFirst, true, "DOM 順序不變");
  } catch (error) {
    await fixture.captureFailure("technical-mobile-chart");
    throw error;
  } finally {
    await fixture.close();
  }
});
