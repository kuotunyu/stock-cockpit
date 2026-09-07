// 真實 Chromium 排版基準：固定情境逐一量測主要區塊，空資料不能以略過換綠燈。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const VIEWPORTS = [375, 768, 1280, 1440];

test("populated：四種寬度的頂欄、波段動作列、明細與成績單不互相遮擋", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 1000 });
      await visibleNav(page, "strategy").click();
      await page.locator(".swing-card").first().waitFor({ state: "visible" });
      const scoreFold = page.locator("#swingVerify details.sv-fold");
      if (await scoreFold.count() && !(await scoreFold.evaluate((node) => node.open))) {
        await scoreFold.locator("summary").click();
      }
      await page.locator("#swingVerify .sv-chip").first().waitFor({ state: "visible" });
      const measured = await page.evaluate(() => {
        const topbar = document.querySelector(".topbar");
        const card = document.querySelector(".swing-card");
        const actions = card?.querySelector(".swing-actions");
        const buttons = [...(actions?.querySelectorAll("button") || [])];
        const scorecard = document.querySelector("#swingVerify .sv-chip");
        const rect = (node) => node?.getBoundingClientRect().toJSON();
        const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          counts: { cards: document.querySelectorAll(".swing-card").length, actions: buttons.length, scorecards: document.querySelectorAll("#swingVerify .sv-chip").length },
          topbar: rect(topbar), card: rect(card), actions: rect(actions), scorecard: rect(scorecard),
          actionOverlap: buttons.length === 2 ? overlaps(buttons[0].getBoundingClientRect(), buttons[1].getBoundingClientRect()) : true,
          longName: card?.querySelector(".swing-nm")?.textContent || "",
        };
      });
      assert.equal(measured.counts.cards, 1, `${width}px fixture 應有且只有一張中軌卡`);
      assert.equal(measured.counts.actions, 2, `${width}px 動作列必須有兩個實際按鈕`);
      assert.equal(measured.counts.scorecards, 2, `${width}px 成績單必須有兩個場景`);
      assert.equal(measured.bodyFits, true, `${width}px body 不可橫向溢出`);
      assert.equal(measured.actionOverlap, false, `${width}px 波段主要操作不可重疊`);
      assert.match(measured.longName, /環球晶圓先進材料科技/, `${width}px 長中文股票名不得被 fixture 省略`);
      for (const [name, box] of Object.entries({ topbar: measured.topbar, card: measured.card, actions: measured.actions, scorecard: measured.scorecard })) {
        assert.ok(box && box.width > 0 && box.height > 0, `${width}px ${name} 必須存在且可量測`);
        assert.ok(box.left >= -1 && box.right <= width + 1, `${width}px ${name} 應位於 viewport 內：${JSON.stringify(box)}`);
      }

      const opener = page.locator(".swing-open").first();
      await opener.click();
      await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
      const detail = await page.locator("#detailPanel").evaluate((node) => ({
        box: node.getBoundingClientRect().toJSON(),
        name: node.querySelector("#detailName")?.textContent || "",
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      }));
      assert.match(detail.name, /環球晶圓先進材料科技/);
      assert.equal(detail.bodyFits, true, `${width}px 開明細後 body 不可橫向溢出`);
      assert.ok(detail.box.width > 0 && detail.box.left >= -1 && detail.box.right <= width + 1, `${width}px 明細應完整位於 viewport`);
      await page.keyboard.press("Escape");
    }
  } catch (error) {
    await fixture.captureFailure("layout-smoke");
    throw error;
  } finally {
    await fixture.close();
  }
});

test("empty 與 partial：明確驗證零張卡及部分資料警告", { timeout: 60_000 }, async (t) => {
  await t.test("empty 恰為零張卡且顯示空狀態", async () => {
    const fixture = await createBrowserFixture({ scenario: "empty" });
    try {
      await visibleNav(fixture.page, "strategy").click();
      await fixture.page.getByText("今天沒有符合「中軌攻防」的標的").waitFor();
      assert.equal(await fixture.page.locator(".swing-card").count(), 0);
    } catch (error) {
      await fixture.captureFailure("layout-empty");
      throw error;
    } finally {
      await fixture.close();
    }
  });

  await t.test("partial 保留一張真卡並揭露資料不完整", async () => {
    const fixture = await createBrowserFixture({ scenario: "partial" });
    try {
      await visibleNav(fixture.page, "strategy").click();
      await fixture.page.locator(".swing-card").waitFor();
      assert.equal(await fixture.page.locator(".swing-card").count(), 1);
      await fixture.page.locator("#strategyBoard").getByText(/部分市場資料暫缺/).waitFor();
    } catch (error) {
      await fixture.captureFailure("layout-partial");
      throw error;
    } finally {
      await fixture.close();
    }
  });
});
