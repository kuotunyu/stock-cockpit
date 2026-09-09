// 真實 Chromium 390×844：核心任務入口要在首屏（computer use 心得 F07／CUA-07）。
// 隔日沖四則警告下第一張摘要股票卡的上緣要在首屏；已登入零持股時「記第一筆」表單的代號欄在首屏；
// 交易計畫彈窗打開新增表單後第一個欄位可見、容量長文收在關閉的 details 內。warnings 以注入 state 驗呈現（fixture 沒有四則警告情境）。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const WARNINGS = [
  "上市與上櫃整批收盤資料日尚未對齊（上市 2026/09/07、上櫃 2026/09/08），稍後會自動補齊。",
  "TWSE 注意股抓取失敗：官方今天還沒公布名單（或已清空），這一類先留空、稍後自動重試",
  "上市的收盤資料尚未更新到 2026/09/08，這份清單暫時只涵蓋已更新的市場，稍晚會自動補齊。",
  "官方除權除息計算結果表這一輪有部分月份沒抓到，除權息當天的漲跌幅與近 30 日回測數字可能失真；資料會在下一輪補齊。",
];

test("390px：四則警告下第一張摘要股票卡在首屏；零持股首屏有記第一筆入口；計畫表單不被容量長文推開", { timeout: 150_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 390, height: 844 });
    await visibleNav(page, "overnight").click();
    await page.locator("button.today-focus-card").first().waitFor({ state: "visible" });
    await page.evaluate((warnings) => {
      overnightState.warnings = warnings;
      renderOvernightGroups();
      window.scrollTo(0, 0);
    }, WARNINGS);
    await page.evaluate(() => document.fonts.ready);
    const overnight = await page.evaluate(() => {
      const card = document.querySelector("button.today-focus-card");
      const box = card.getBoundingClientRect();
      const fold = document.querySelector("details[data-overnight-warnings-fold]");
      const nav = document.querySelector(".bottom-nav");
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      return {
        scrollY: window.scrollY, cardTop: box.top, cardBottom: box.bottom, navTop, innerHeight: window.innerHeight,
        name: card.querySelector(".focus-pick-name")?.textContent.trim(),
        foldPresent: Boolean(fold), foldOpen: fold ? fold.open : null,
        summaryText: document.querySelector(".overnight-summary-warnings")?.textContent.replace(/\s+/g, " ").trim().slice(0, 120),
      };
    });
    assert.equal(overnight.scrollY, 0);
    assert.ok(overnight.cardTop >= 0 && overnight.cardTop < overnight.navTop - 40, `第一張摘要卡上緣要在首屏主內容內：${JSON.stringify(overnight)}`);
    assert.ok(overnight.name, "名稱可辨");
    assert.equal(overnight.foldPresent, true);
    assert.equal(overnight.foldOpen, false);
    await fixture.captureSnapshot("task-entry-overnight-390");

    await visibleNav(page, "watchlist").click();
    await page.getByRole("button", { name: "庫存損益" }).click();
    await page.locator('#holdingsPanel [data-trade-form] input[name="code"]').waitFor({ state: "attached" });
    await page.evaluate(() => window.scrollTo(0, 0));
    const holdings = await page.evaluate(() => {
      const input = document.querySelector('#holdingsPanel [data-trade-form] input[name="code"]');
      const box = input.getBoundingClientRect();
      const empty = document.querySelector("#holdingsPanel .hold-empty");
      const nav = document.querySelector(".bottom-nav");
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      return { scrollY: window.scrollY, inputTop: box.top, inputBottom: box.bottom, navTop, emptyText: empty ? empty.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : null,
        panelText: document.getElementById("holdingsPanel").textContent.replace(/\s+/g, " ").slice(0, 80) };
    });
    assert.equal(holdings.scrollY, 0);
    assert.ok(holdings.inputBottom > 0 && holdings.inputBottom <= holdings.navTop, `零持股首屏要看得到記第一筆的代號欄：${JSON.stringify(holdings)}`);
    assert.match(holdings.emptyText || "", /沒有庫存/);
    await fixture.captureSnapshot("task-entry-holdings-390");

    await page.evaluate(() => { openTradePlans(); });
    const modal = page.locator("#tradePlanModal");
    await modal.waitFor({ state: "visible" });
    await page.locator("[data-trade-plan-new]").click();
    await page.locator("#tradePlanForm").waitFor({ state: "visible" });
    const plan = await page.evaluate(() => {
      const form = document.getElementById("tradePlanForm");
      const first = form.querySelector("input, select, textarea");
      const box = first.getBoundingClientRect();
      const modalBox = document.querySelector(".trade-plan-modal").getBoundingClientRect();
      const limits = [...document.querySelectorAll("#tradePlanModal details")].find((node) => /保存限制與匯出/.test(node.textContent));
      return { firstTop: box.top, firstBottom: box.bottom, modalTop: modalBox.top, modalBottom: modalBox.bottom, innerHeight: window.innerHeight,
        limitsPresent: Boolean(limits), limitsOpen: limits ? limits.open : null,
        capacityVisible: limits ? Boolean(limits.querySelector("p")?.checkVisibility?.()) : null };
    });
    assert.equal(plan.limitsPresent, true, "容量說明在 details");
    assert.equal(plan.limitsOpen, false, "預設收合");
    assert.equal(plan.capacityVisible, false, "容量長文預設不可見");
    assert.ok(plan.firstTop >= plan.modalTop && plan.firstBottom <= plan.innerHeight, `新增表單第一個欄位要在可視範圍：${JSON.stringify(plan)}`);
    await fixture.captureSnapshot("task-entry-plan-390");
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden" });
  } catch (error) {
    await fixture.captureFailure("task-entry-density");
    throw error;
  } finally {
    await fixture.close();
  }
});
