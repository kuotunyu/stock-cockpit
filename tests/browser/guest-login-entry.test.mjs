// 真實 Chromium：訪客在庫存空態按原地登入按鈕開登入閘，Escape 關閉後焦點回到同一顆按鈕（CUA-06）。
// expired-session 情境的 /api/auth/me 回 401；fixture 沒有 /api/auth/login，登入成功流程由 jsdom 覆蓋。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

test("訪客庫存空態：登入按鈕可見、Enter 開登入閘且焦點進帳號欄、Escape 關閉後回到按鈕", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "expired-session" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 1280, height: 1000 });
    const gate = page.locator("#loginGate");
    if (await gate.isVisible()) {
      await page.keyboard.press("Escape");
      await gate.waitFor({ state: "hidden" });
    }
    await visibleNav(page, "watchlist").click();
    await page.getByRole("button", { name: "庫存損益" }).click();
    const login = page.locator("#holdingsPanel [data-login-holdings]");
    await login.waitFor({ state: "visible" });
    const box = await login.boundingBox();
    assert.ok(box && box.height >= 44 && box.width > 0, `登入按鈕要有實際尺寸且高度 ≥44：${JSON.stringify(box)}`);
    assert.doesNotMatch(await page.locator("#holdingsPanel").textContent(), /更多 → 帳號管理/);

    await login.focus();
    await page.keyboard.press("Enter");
    await gate.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "loginUsername");
    assert.match(await page.locator("#loginMessage").textContent(), /交易帳本/);

    await page.keyboard.press("Escape");
    await gate.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement && document.activeElement.hasAttribute("data-login-holdings"));
    assert.equal(await login.evaluate((node) => node === document.activeElement), true, "Escape 後焦點回到登入按鈕");
    await fixture.captureSnapshot("guest-login-entry-1280");
  } catch (error) {
    await fixture.captureFailure("guest-login-entry");
    throw error;
  } finally {
    await fixture.close();
  }
});
