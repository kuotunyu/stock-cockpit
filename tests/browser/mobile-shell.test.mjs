// 手機外殼（M1，2026-09-13）：375px 下頂欄兩列（標題列＋狀態列）、內容更早開始、來源切換用浮層、策略卡不塌欄、底部導覽留 safe-area。
// 以前頂欄 140px、內容從 206px 開始；策略卡在 375px 因 areas 漏了 actions 而塌成三欄（計畫格 28px）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBrowserFixture } from "../helpers/browser-fixtures.mjs";

const rectOf = (page, selector) => page.evaluate((s) => {
  const node = document.querySelector(s);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
}, selector);

test("375px 頂欄：92px 以內兩列、子元素不重疊、內容從 150px 內開始、來源切換浮層不撐高頂欄", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
    const topbar = await rectOf(page, ".topbar");
    assert.ok(topbar.height <= 96, `頂欄 ${topbar.height}px，應 ≤ 96px（以前 140px）`);
    const title = await rectOf(page, ".topbar h1");
    const actions = await rectOf(page, ".top-actions");
    const help = await rectOf(page, ".screen-help");
    const pill = await rectOf(page, ".market-pill");
    const source = await rectOf(page, ".source-switch");
    assert.ok(Math.abs(title.top - actions.top) <= 8 && Math.abs(help.top - actions.top) <= 2, "標題、「?」與工具鈕在同一列");
    assert.ok(pill.top > title.top + title.height - 4 && Math.abs(pill.top - source.top) <= 4, "台指 pill 與來源在第二列");
    assert.ok(source.width >= 200, `狀態列的來源區要有寬度放更新時間，實際 ${source.width}px`);
    const overlaps = await page.evaluate(() => {
      const items = [...document.querySelector(".topbar").children].map((n) => n.getBoundingClientRect());
      let bad = 0;
      for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i]; const b = items[j];
        if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad += 1;
      }
      return bad;
    });
    assert.equal(overlaps, 0, "頂欄子元素不可重疊");
    const contentTop = await page.evaluate(() => { const n = document.querySelector('[data-screen-panel="overnight"] .overnight-summary, [data-screen-panel="overnight"] .overnight-group, [data-screen-panel="overnight"] section'); return n ? Math.round(n.getBoundingClientRect().top) : null; });
    assert.ok(contentTop !== null && contentTop <= 150, `隔日沖內容從 ${contentTop}px 開始，應 ≤ 150px（以前 206px）`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "body 不橫溢");
    for (const selector of [".top-actions .icon-button", ".screen-help", ".segment-tabs .segment"]) {
      const size = await rectOf(page, selector);
      assert.ok(size.height >= 44, `${selector} 觸控高度 ${size.height}px 應 ≥ 44px`);
    }
    // 來源切換：點開變浮層，頂欄高度不變
    await page.locator("#sourcePill").click();
    await page.waitForTimeout(250);
    const opened = await rectOf(page, ".topbar");
    const buttons = await rectOf(page, ".source-switch-buttons");
    assert.equal(opened.height, topbar.height, "來源切換展開時頂欄不可撐高");
    assert.ok(buttons && buttons.top >= topbar.top + topbar.height - 2 && buttons.width >= 200, `切換按鈕要浮在頂欄下方：${JSON.stringify(buttons)}`);
    await page.keyboard.press("Escape");
  } finally {
    await fixture.close();
  }
});

test("375px 策略卡：單欄、計畫格每格 ≥ 100px、動作列在卡片底部", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('.bottom-nav .nav-action[data-screen="strategy"]').click();
    await page.locator(".swing-card").first().waitFor();
    const card = await page.evaluate(() => {
      const c = document.querySelector(".swing-card");
      const rect = c.getBoundingClientRect();
      const actions = c.querySelector(".swing-actions")?.getBoundingClientRect();
      return { cols: getComputedStyle(c).gridTemplateColumns.trim().split(/\s+/).length, width: Math.round(rect.width),
        stats: [...c.querySelectorAll(".swing-stat")].map((s) => Math.round(s.getBoundingClientRect().width)),
        actionsBottomGap: actions ? Math.round(rect.bottom - actions.bottom) : null, actionsWidth: actions ? Math.round(actions.width) : null };
    });
    assert.equal(card.cols, 1, "手機策略卡是單欄（以前 areas 漏了 actions 塌成三欄）");
    assert.ok(card.stats.length >= 4 && card.stats.every((w) => w >= 100), `計畫格寬度 ${card.stats.join("/")}，每格應 ≥ 100px（以前 28px）`);
    assert.ok(card.actionsWidth >= card.width - 40, "動作列吃滿卡片寬");
    assert.ok(card.actionsBottomGap !== null && card.actionsBottomGap <= 24, "動作列在卡片底部");
  } finally {
    await fixture.close();
  }
});

test("375px 清單改列（M2）：重點卡單欄、分群卡三欄一列且 chips 不換行、行情表兩行列不橫向捲、排序改選單", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
    const overnight = await page.evaluate(() => {
      const grid = document.querySelector(".today-focus-grid");
      const pick = document.querySelector(".overnight-pick");
      const lines = pick ? [...pick.querySelectorAll(".pick-reasons, .pick-risks, .pick-backtest")].map((n) => Math.round(n.getBoundingClientRect().height)) : [];
      return { gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : null,
        cardWidths: [...document.querySelectorAll(".today-focus-card")].map((c) => Math.round(c.getBoundingClientRect().width)),
        pickCols: pick ? getComputedStyle(pick).gridTemplateColumns.trim().split(/\s+/).length : null, lines };
    });
    assert.equal(overnight.gridCols, 1, "訊號重點在手機是單欄");
    assert.ok(overnight.cardWidths.every((w) => w >= 300), `重點卡寬度 ${overnight.cardWidths.join("/")}`);
    assert.equal(overnight.pickCols, 3, "分群卡：徽章｜名稱｜價格 三欄一列");
    assert.ok(overnight.lines.length && overnight.lines.every((h) => h <= 44), `條件／風險／回測各一行不換行：${overnight.lines.join("/")}`);
    for (const screen of ["screener", "watchlist"]) {
      await page.locator(`.bottom-nav .nav-action[data-screen="${screen}"]`).click();
      await page.waitForTimeout(800);
      const table = await page.evaluate((name) => {
        const panel = document.querySelector(`[data-screen-panel="${name}"]`);
        const scroller = panel.querySelector(".watch-table-scroller, .table-scroller");
        // 自選股列轉成 ARIA 表後，.watch-row-select 搬到內層名稱按鈕上；真正的列是 .watch-stock-row
        const row = panel.querySelector(name === "watchlist" ? ".watch-stock-row" : ".stock-row:not(.is-skeleton)");
        const head = panel.querySelector(".table-head");
        const sort = panel.querySelector(".mobile-sort");
        return { overflow: scroller ? scroller.scrollWidth - scroller.clientWidth : null, rowCols: row ? getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/).length : null,
          rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null, headHidden: head ? getComputedStyle(head).display === "none" : null,
          sortVisible: sort ? sort.getBoundingClientRect().height > 0 : false, bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
      }, screen);
      assert.equal(table.bodyFits, true, `${screen} body 不橫溢`);
      assert.ok(table.overflow !== null && table.overflow <= 0, `${screen} 行情表不可橫向捲動（超出 ${table.overflow}px）`);
      assert.equal(table.rowCols, 3, `${screen} 列是三欄兩行`);
      assert.ok(table.rowHeight !== null && table.rowHeight <= 150, `${screen} 列高 ${table.rowHeight}px（以前 94px 高但要橫向捲；fixture 的 16 字名稱折兩行＋處置標籤約 140px）`);
      assert.equal(table.headHidden, true, `${screen} 表頭在手機藏起來`);
      assert.equal(table.sortVisible, true, `${screen} 要有排序選單`);
    }
    // 自選股列的處置標籤不可被拉成整行寬；底部「重新整理」不可折成兩行
    const extras = await page.evaluate(() => {
      const tag = document.querySelector('[data-screen-panel="watchlist"] .watch-stock-row .surv-tag');
      const refresh = document.querySelector("#refreshData");
      const brief = document.querySelector('[data-screen-panel="watchlist"] .watch-brief-top');
      return { tagWidth: tag ? Math.round(tag.getBoundingClientRect().width) : null,
        refreshWidth: Math.round(refresh.getBoundingClientRect().width), refreshHeight: Math.round(refresh.getBoundingClientRect().height),
        briefClipped: brief ? brief.scrollWidth - brief.clientWidth : null };
    });
    assert.ok(extras.briefClipped !== null && extras.briefClipped <= 0, `摘要條「最新最強 股名」不可被裁切（超出 ${extras.briefClipped}px）`);
    assert.ok(extras.tagWidth !== null && extras.tagWidth <= 120, `處置標籤是小藥丸不是整行：${extras.tagWidth}px`);
    assert.ok(extras.refreshWidth >= 60 && extras.refreshHeight <= 48, `「重新整理」單行：${JSON.stringify(extras)}`);
  } finally {
    await fixture.close();
  }
});

test("底部導覽留 safe-area、viewport 用 viewport-fit=cover", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(css, /\.bottom-nav \{ padding-bottom: calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
  assert.match(html, /viewport-fit=cover/);
});
