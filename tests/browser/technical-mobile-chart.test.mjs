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
    // 標題在 Windows 字型是一行；CI（Linux CJK 後備字型較寬）折成兩行、標題列 97px。預算是「標題列 ≤100px」，標題最多兩行、副標一行。
    assert.ok(mobile.titleLines <= 2 && mobile.subtitleLines <= 1, `標題最多兩行、副標一行：${JSON.stringify(mobile)}`);
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

    // 第五批④：200% 文字下的手機技術頁。標題、副標與圖例籤可以變高或換行，但不得被裁掉、body 不橫向溢出、圖仍在摘要卡之前且有尺寸。
    await fixture.emulateTextZoom(2, ["#technicalTitle", "#technicalSubtitle", "#technicalChartMarkers .technical-chart-marker strong"]);
    const zoomed = await page.evaluate(() => {
      // 「被裁掉」＝文字實際範圍超出任何 overflow 非 visible 的祖先（含自己）；CJK 字形盒比行盒高幾 px 不算。
      const clipped = (node) => {
        const range = document.createRange(); range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.overflowX === "visible" && style.overflowY === "visible") continue;
          const box = ancestor.getBoundingClientRect();
          if (text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1) return true;
        }
        return false;
      };
      const canvas = document.querySelector("#technicalChart").getBoundingClientRect();
      const summary = document.querySelector("#technicalSummary").getBoundingClientRect();
      const header = document.querySelector(".technical-chart-card > header");
      return {
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        canvasWidth: canvas.width, canvasHeight: canvas.height, chartBeforeSummary: canvas.top < summary.top,
        headerFits: header.scrollWidth <= header.clientWidth + 1,
        titleClipped: clipped(document.querySelector("#technicalTitle")),
        subtitleClipped: clipped(document.querySelector("#technicalSubtitle")),
        chips: [...document.querySelectorAll("#technicalChartMarkers .technical-chart-marker")].map((chip) => ({
          text: chip.textContent.trim(), clipped: clipped(chip), fontSize: parseFloat(getComputedStyle(chip.querySelector("strong")).fontSize),
        })),
        zoomButton: (() => { const b = document.querySelector("#technicalZoomOpen").getBoundingClientRect(); return { w: b.width, h: b.height, name: document.querySelector("#technicalZoomOpen").getAttribute("aria-label") }; })(),
      };
    });
    assert.equal(zoomed.bodyFits, true, "200%：body 不可橫向溢出");
    assert.ok(zoomed.canvasWidth > 0 && zoomed.canvasHeight > 0, "200%：canvas 仍有尺寸");
    assert.equal(zoomed.chartBeforeSummary, true, "200%：圖仍在摘要卡之前");
    assert.equal(zoomed.headerFits, true, "200%：標題列內容不得橫向溢出");
    assert.equal(zoomed.titleClipped, false, "200%：標題不得被裁掉");
    assert.equal(zoomed.subtitleClipped, false, "200%：副標不得被裁掉");
    assert.equal(zoomed.chips.length, 5);
    for (const chip of zoomed.chips) {
      assert.ok(chip.fontSize >= 26, `200%：圖例籤「${chip.text}」字級應為 2 倍：${chip.fontSize}`);
      assert.equal(chip.clipped, false, `200%：圖例籤「${chip.text}」不得被裁掉`);
    }
    assert.equal(zoomed.zoomButton.name, "放大 K 線圖", "放大鈕名稱仍在");
    assert.ok(zoomed.zoomButton.w > 0 && zoomed.zoomButton.h > 0, "放大鈕仍可見");
    await fixture.captureSnapshot("technical-mobile-chart-390-200");
    await fixture.emulateTextZoom(1, ["#technicalTitle"]);

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
