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
        stats: [...c.querySelectorAll(".swing-plan > .swing-stat-entry, .swing-plan > .swing-stat:nth-child(3), .swing-plan > .swing-stat:nth-child(5)")].map((s) => Math.round(s.getBoundingClientRect().width)),
        others: [...c.querySelectorAll(".swing-plan > .swing-stat:not(.swing-stat-entry):not(:nth-child(3)):not(:nth-child(5))")].map((s) => Math.round(s.getBoundingClientRect().width)),
        actionsBottomGap: actions ? Math.round(rect.bottom - actions.bottom) : null, actionsWidth: actions ? Math.round(actions.width) : null };
    });
    assert.equal(card.cols, 1, "手機策略卡是單欄（以前 areas 漏了 actions 塌成三欄）");
    assert.ok(card.stats.length === 3 && card.stats.every((w) => w >= 100), `進場／結構停損／目標三格寬度 ${card.stats.join("/")}，每格應 ≥ 100px（以前 28px；M4 起一列三格）`);
    assert.ok(card.others.length >= 3 && card.others.every((w) => w >= 60), `次要計畫項目寬度 ${card.others.join("/")}`);
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
          rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null, headHidden: head ? head.getBoundingClientRect().height <= 1 : null,
          sortVisible: sort ? sort.getBoundingClientRect().height > 0 : false, bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
      }, screen);
      assert.equal(table.bodyFits, true, `${screen} body 不橫溢`);
      assert.ok(table.overflow !== null && table.overflow <= 0, `${screen} 行情表不可橫向捲動（超出 ${table.overflow}px）`);
      assert.equal(table.rowCols, 3, `${screen} 列是三欄兩行`);
      assert.ok(table.rowHeight !== null && table.rowHeight <= 150, `${screen} 列高 ${table.rowHeight}px（以前 94px 高但要橫向捲；fixture 的 16 字名稱折兩行＋處置標籤約 140px）`);
      assert.equal(table.headHidden, true, `${screen} 表頭在手機視覺上藏起來（仍留在無障礙樹）`);
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

test("375px 明細抽屜（M3）：半屏 sheet 有把手、價格一行無色塊、開高低量一列四格、拖上拉滿、拖下關閉", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('.bottom-nav .nav-action[data-screen="watchlist"]').click();
    await page.locator('[data-screen-panel="watchlist"] .quote-stock-open').first().click();
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    await page.waitForTimeout(450);
    const sheet = await page.evaluate(() => {
      const panel = document.querySelector("#detailPanel");
      const header = panel.querySelector(".detail-top");
      const hero = panel.querySelector(".price-hero-main");
      const metrics = panel.querySelector(".chart-metrics");
      const plan = panel.querySelector("[data-trade-plan-open]");
      const help = panel.querySelector(".alert-help-toggle");
      const small = panel.querySelector(".alert-head small");
      const h = (n) => (n ? Math.round(n.getBoundingClientRect().height) : null);
      return { height: h(panel), full: panel.classList.contains("is-full"), handle: getComputedStyle(header, "::before").height,
        heroHeight: h(hero), heroBg: getComputedStyle(hero).backgroundColor,
        metricCols: metrics ? getComputedStyle(metrics).gridTemplateColumns.trim().split(/\s+/).length : null,
        planHeight: h(plan), helpVisible: help ? help.getBoundingClientRect().height > 0 : false,
        smallHidden: small ? getComputedStyle(small).display === "none" : null };
    });
    assert.ok(sheet.height >= 812 * 0.55 && sheet.height <= 812 * 0.62, `半屏 sheet 高度 ${sheet.height}px（應約 58% ≈ 471px；以前 92%）`);
    assert.equal(sheet.full, false);
    assert.equal(sheet.handle, "4px", "標題列上要有把手");
    assert.ok(sheet.heroHeight !== null && sheet.heroHeight <= 64, `價格主列一行：${sheet.heroHeight}px`);
    assert.equal(sheet.heroBg, "rgba(0, 0, 0, 0)", "價格主列不再整塊紅／綠底");
    assert.equal(sheet.metricCols, 4, "開高低量一列四格");
    assert.ok(sheet.planHeight >= 44, `建立計畫鈕 ${sheet.planHeight}px`);
    assert.equal(sheet.helpVisible, true, "到價提醒說明摺進 ⓘ");
    assert.equal(sheet.smallHidden, true, "長說明預設收起");
    // 把手往上拖 → 拉滿
    const header = await rectOf(page, "#detailPanel .detail-top");
    const x = header.left + header.width / 2;
    await page.mouse.move(x, header.top + 8);
    await page.mouse.down();
    await page.mouse.move(x, header.top + 8 - 120, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const full = await page.evaluate(() => { const p = document.querySelector("#detailPanel"); return { full: p.classList.contains("is-full"), height: Math.round(p.getBoundingClientRect().height) }; });
    assert.equal(full.full, true, "往上拖要拉滿");
    assert.ok(full.height >= 812 * 0.9, `拉滿高度 ${full.height}px`);
    // 把手往下拖 → 關閉
    const header2 = await rectOf(page, "#detailPanel .detail-top");
    await page.mouse.move(x, header2.top + 8);
    await page.mouse.down();
    await page.mouse.move(x, header2.top + 8 + 160, { steps: 6 });
    await page.mouse.up();
    await page.locator("#detailPanel.is-open").waitFor({ state: "detached", timeout: 5000 });
  } finally {
    await fixture.close();
  }
});

test("375px 成績單逐日表一天一行＋展開＋顯示更早、策略卡三段式一屏內、庫存摘要條（M4）", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('[data-overnight-view="performance"]').click(); // 隔日沖頁的「成績單」視圖
    await page.locator(".verify-history-row:not(.is-head)").first().waitFor({ state: "attached" });
    await page.waitForTimeout(400);
    const daily = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".verify-history-row:not(.is-head)")];
      const visible = rows.filter((r) => r.getBoundingClientRect().height > 0);
      return { total: rows.length, visible: visible.length, tableHeight: Math.round(document.querySelector(".verify-history-table").getBoundingClientRect().height),
        rowHeight: Math.round(visible[0]?.getBoundingClientRect().height || 0), more: Boolean(document.querySelector("[data-verify-more]")),
        firstLine: ["訊號→觀察", "開盤進場", "淨期望值"].map((col) => visible[0]?.querySelector(`[data-col="${col}"]`)?.getBoundingClientRect().width > 0) };
    });
    assert.ok(daily.total >= 20, `fixture 應有 ≥ 20 天，實際 ${daily.total}`);
    assert.equal(daily.visible, 5, "先給最近 5 天");
    assert.ok(daily.rowHeight <= 72, `一天一行 ${daily.rowHeight}px`);
    assert.ok(daily.tableHeight <= 420, `逐日表 ${daily.tableHeight}px（以前 20 張卡）`);
    assert.equal(daily.more, true, "要有「顯示更早」");
    assert.deepEqual(daily.firstLine, [true, true, true], "收合列印日期／開盤進場／淨期望值三格");
    const toggle = page.locator(".verify-history-row:not(.is-head) [data-verify-toggle]").first();
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    const expanded = await page.evaluate(() => {
      const row = document.querySelector(".verify-history-row.is-expanded");
      return row ? { height: Math.round(row.getBoundingClientRect().height), shown: [...row.querySelectorAll("span[data-col]")].filter((s) => s.getBoundingClientRect().height > 0).length } : null;
    });
    assert.ok(expanded && expanded.shown >= 8 && expanded.height > daily.rowHeight + 40, `展開後其餘欄位顯示：${JSON.stringify(expanded)}`);
    await page.locator("[data-verify-more]").scrollIntoViewIfNeeded();
    await page.locator("[data-verify-more]").click();
    await page.waitForTimeout(500);
    const afterMore = await page.evaluate(() => ({
      visible: [...document.querySelectorAll(".verify-history-row:not(.is-head)")].filter((r) => r.getBoundingClientRect().height > 0).length,
      stillExpanded: document.querySelectorAll(".verify-history-row.is-expanded").length,
    }));
    assert.ok(afterMore.visible >= 20, `顯示更早後 ${afterMore.visible} 天`);
    assert.equal(afterMore.stillExpanded, 1, "重繪後展開狀態保留");
    // 策略卡三段式
    await page.locator('.bottom-nav .nav-action[data-screen="strategy"]').click();
    await page.locator(".swing-card").first().waitFor();
    await page.waitForTimeout(300);
    const card = await page.evaluate(() => {
      const c = document.querySelector(".swing-card");
      const r = (n) => (n ? n.getBoundingClientRect() : null);
      const stats = [...c.querySelectorAll(".swing-plan > .swing-stat")].map((s) => ({ top: Math.round(r(s).top), width: Math.round(r(s).width) }));
      const why = c.querySelector("details.swing-why");
      const order = [".swing-plan", ".swing-rrbar", ".swing-signal-line", ".swing-why", ".swing-actions"].map((s) => c.querySelector(s)).filter(Boolean).map((n) => Math.round(r(n).top));
      return { height: Math.round(r(c).height), stats, whyOpen: why?.open, summaryHeight: Math.round(r(why?.querySelector("summary")).height),
        buttons: [...c.querySelectorAll(".swing-actions button")].map((b) => ({ width: Math.round(r(b).width), height: Math.round(r(b).height) })), order, pct: c.querySelectorAll(".swing-stat-pct").length };
    });
    assert.ok(card.height <= 700, `策略卡 ${card.height}px 應一屏內（812 − 頂欄 92 − 導覽 78）`);
    assert.ok(card.stats.length >= 6 && card.stats[0].top === card.stats[2].top && card.stats[2].top === card.stats[4].top, `進場／結構停損／目標同一列：${JSON.stringify(card.stats)}`);
    assert.ok(card.stats[0].width >= 90 && card.stats[2].width >= 90 && card.stats[4].width >= 90, "三格各 ≥ 90px");
    assert.equal(card.whyOpen, false, "為什麼入選預設摺起");
    assert.ok(card.summaryHeight >= 40, "摺疊列可觸控");
    assert.ok(card.buttons.length === 2 && card.buttons.every((b) => b.height >= 44 && b.width >= 300), `按鈕全寬 44px：${JSON.stringify(card.buttons)}`);
    assert.ok(card.order.every((top, i) => i === 0 || top > card.order[i - 1]), `區塊順序 計畫→盈虧比條→chips→為什麼→按鈕：${card.order.join("/")}`);
    assert.equal(card.pct, 2, "結構停損／目標各標相對進場百分比");
    await page.locator(".swing-card details.swing-why > summary").first().click();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.querySelector(".swing-card details.swing-why").open), true, "點摘要展開");
    assert.equal(await page.locator("#detailPanel.is-open").count(), 0, "點摘要不可誤開明細");
    // 庫存摘要條（fixture 沒持股，注入一檔）
    await page.locator('.bottom-nav .nav-action[data-screen="watchlist"]').click();
    await page.evaluate(() => {
      tradesState.portfolio = { ok: true, holdings: [{ code: "6488", shares: 1000, avgCost: 400, cost: 400000 }], realized: [], totals: { cost: 400000, realizedPnl: 0 } };
      tradesState.records = []; tradesState.loaded = true;
      state.watchList = "hold"; renderHoldingsPanel();
    });
    await page.waitForTimeout(300);
    const strip = await page.evaluate(() => {
      const s = document.querySelector(".hold-strip");
      return { visible: Boolean(s) && s.getBoundingClientRect().height > 0,
        cells: s ? [...s.children].map((c) => ({ w: Math.round(c.getBoundingClientRect().width), label: c.querySelector("span")?.textContent })) : null,
        hiddenTiles: [...document.querySelectorAll(".hold-summary > [data-hold-kpi]")].filter((n) => n.getBoundingClientRect().height === 0).length,
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    });
    assert.equal(strip.visible, true, "手機有摘要條");
    assert.deepEqual(strip.cells.map((c) => c.label), ["今日損益", "未實現", "市值", "本月已實現"]);
    assert.ok(strip.cells.every((c) => c.w >= 80), JSON.stringify(strip.cells));
    assert.equal(strip.hiddenTiles, 2, "總覽格裡重複的市值／未實現在手機藏起來");
    assert.equal(strip.bodyFits, true);
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
