// 真實 Chromium 排版基準：固定情境逐一量測主要區塊，空資料不能以略過換綠燈。
import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedLayout, createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const VIEWPORTS = [375, 768, 1280, 1440];

test("populated：四種寬度的頂欄、波段動作列、明細與成績單不互相遮擋", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 1000 });
      await visibleNav(page, "strategy").click();
      await page.locator(".swing-card").first().waitFor({ state: "visible" });
      await page.evaluate(() => window.scrollTo(0, 0));
      const scoreFold = page.locator("#swingVerify details.sv-fold");
      if (await scoreFold.count() && !(await scoreFold.evaluate((node) => node.open))) {
        await scoreFold.evaluate((node) => { node.open = true; });
      }
      await page.locator("#swingVerify .sv-chip").first().waitFor({ state: "visible" });
      await assertExpectedLayout(page, { width });
      const measured = await page.evaluate(() => {
        const card = document.querySelector(".swing-card");
        return {
          bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          cardCount: document.querySelectorAll(".swing-card").length,
          longName: card?.querySelector(".swing-nm")?.textContent || "",
        };
      });
      assert.equal(measured.cardCount, 1, `${width}px fixture 應有且只有一張中軌卡`);
      assert.equal(measured.bodyFits, true, `${width}px body 不可橫向溢出`);
      assert.match(measured.longName, /環球晶圓先進材料科技/, `${width}px 長中文股票名不得被 fixture 省略`);
      if (width === 375 || width === 1280) await fixture.captureSnapshot(`layout-normal-${width}`);

      const opener = page.locator(".swing-open").first();
      await opener.click();
      await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
      await assertExpectedLayout(page, { width, detailOpen: true });
      const detail = await page.locator("#detailPanel").evaluate((node) => ({
        name: node.querySelector("#detailName")?.textContent || "",
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      }));
      assert.match(detail.name, /環球晶圓先進材料科技/);
      assert.equal(detail.bodyFits, true, `${width}px 開明細後 body 不可橫向溢出`);
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
