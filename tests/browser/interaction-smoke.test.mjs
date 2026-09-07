// 真實 Chromium 互動基準：鍵盤焦點、內層操作、輪詢草稿及登入失效。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

test("populated：Tab/Enter/Escape 操作真按鈕、內層提醒不誤開明細且輪詢保留草稿", { timeout: 90_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 900 });
    await visibleNav(page, "strategy").click();
    await page.locator(".swing-card").waitFor();

    const alertButton = page.locator(".swing-plan-alerts").first();
    await alertButton.click();
    assert.equal(await page.locator("#detailPanel.is-open").count(), 0, "卡片內提醒按鈕不可誤開明細");

    const opener = page.locator(".swing-open").first();
    await opener.focus();
    await page.keyboard.press("Tab");
    assert.equal(await alertButton.evaluate((node) => node === document.activeElement), true, "Tab 應到第二個原生按鈕");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true, "Shift+Tab 應回到查看明細");
    await page.keyboard.press("Enter");
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#detailPanel.is-open").waitFor({ state: "detached" });

    await visibleNav(page, "surveillance").click();
    await page.locator('[data-surv-tab="inDisposition"]').click();
    const surveillanceOpener = page.locator(".surv-card").first();
    await surveillanceOpener.focus();
    await page.keyboard.press("Enter");
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#detailPanel.is-open").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.dataset.code === "6488");
    const activeAfterClose = await page.evaluate(() => ({
      code: document.activeElement?.dataset.code || "",
      selector: document.activeElement?.className || document.activeElement?.tagName || "",
    }));
    assert.equal(activeAfterClose.code, "6488", `Escape 關閉後應回焦同一檔的實際原生按鈕，實際 ${activeAfterClose.selector}`);

    await visibleNav(page, "strategy").click();
    const draft = page.locator("#strategyInspectInput");
    await draft.fill("環球晶圓草稿尚未送出");
    await fixture.advancePollingCycle();
    assert.equal(await draft.inputValue(), "環球晶圓草稿尚未送出", "10 秒輪詢不可清掉未送出草稿");

    const zoomMeasurements = await fixture.emulateTextZoom(2);
    assert.equal(zoomMeasurements.length, 4);
    const zoomLayout = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".swing-actions button")];
      const [first, second] = buttons.map((node) => node.getBoundingClientRect());
      return {
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        actionCount: buttons.length,
        actionOverlap: first && second ? first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top : true,
      };
    });
    assert.equal(zoomLayout.bodyFits, true, "375px、文字 200% 後 body 不可橫向溢出");
    assert.equal(zoomLayout.actionCount, 2, "文字 200% 後兩個主要操作仍存在");
    assert.equal(zoomLayout.actionOverlap, false, "文字 200% 後主要操作不可重疊");
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    assert.equal(await page.locator("#detailClose").isVisible(), true, "375px、200% 文字放大後仍能完成開啟與關閉主要操作");
    await page.locator("#detailClose").click();
  } catch (error) {
    await fixture.captureFailure("interaction-smoke");
    throw error;
  } finally {
    await fixture.close();
  }
});

test("兩種波段場景與處置狀態都由實際 UI 呈現", { timeout: 60_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await visibleNav(page, "strategy").click();
    await page.locator("#strategyBoard").getByText("環球晶圓先進材料科技股份有限公司", { exact: true }).waitFor();
    await page.locator('[data-swing-scenario="strongContinuation"]').click();
    await page.locator("#strategyBoard").getByText("台灣高效能運算系統整合股份有限公司", { exact: true }).waitFor();
    await visibleNav(page, "surveillance").click();
    await page.locator('[data-surv-tab="inDisposition"]').click();
    await page.locator(".surv-card .surv-iv").getByText("20分盤", { exact: true }).waitFor();
    assert.equal(await page.locator(".surv-card").count(), 1);
  } catch (error) {
    await fixture.captureFailure("interaction-scenarios");
    throw error;
  } finally {
    await fixture.close();
  }
});

test("波段查看明細：Escape 應回到原本的 swing-open 按鈕", { timeout: 60_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 900 });
    await visibleNav(page, "strategy").click();
    const opener = page.locator(".swing-open").first();
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#detailPanel.is-open").waitFor({ state: "detached" });
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
    const active = await page.evaluate(() => ({
      code: document.activeElement?.dataset.swingCode || "",
      selector: document.activeElement?.className || document.activeElement?.tagName || "",
    }));
    assert.equal(active.code, "6488", `應回到 swing-open，實際 ${active.selector}`);
  } catch (error) {
    await fixture.captureFailure("interaction-swing-refocus");
    throw error;
  } finally {
    await fixture.close();
  }
});

test("expired-session：曾登入旗標遇 401 會顯示到期登入閘", { timeout: 60_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "expired-session" });
  try {
    const gate = fixture.page.locator("#loginGate");
    await gate.waitFor({ state: "visible" });
    assert.match(await gate.textContent(), /登入已到期/);
    assert.equal(await fixture.page.locator("#loginUsername").evaluate((node) => node === document.activeElement), true);
  } catch (error) {
    await fixture.captureFailure("interaction-expired-session");
    throw error;
  } finally {
    await fixture.close();
  }
});
