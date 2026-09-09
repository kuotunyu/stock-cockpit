// 真實 Chromium 互動基準：鍵盤焦點、內層操作、輪詢草稿及登入失效。
import test from "node:test";
import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertExpectedLayout, createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

test("fixture 啟動失敗：保留原錯誤、screenshot/trace 並排空資源", { timeout: 60_000 }, async () => {
  const screenshotPath = resolve("test-results/browser/setup-populated.png");
  const tracePath = resolve("test-results/browser/setup-populated.zip");
  await Promise.all([rm(screenshotPath, { force: true }), rm(tracePath, { force: true })]);
  const originalError = new Error("可控啟動失敗");
  let resources;
  await assert.rejects(
    createBrowserFixture({
      scenario: "populated",
      setupFailure: ({ server, browser, page }) => {
        resources = { baseUrl: server.baseUrl, browser, page };
        throw originalError;
      },
    }),
    (error) => error === originalError,
    "fixture 必須保留啟動時的原始錯誤",
  );
  assert.equal(resources.page.isClosed(), true, "setup 失敗後 page 必須關閉");
  assert.equal(resources.browser.isConnected(), false, "setup 失敗後 browser 必須關閉");
  await assert.rejects(fetch(resources.baseUrl, { signal: AbortSignal.timeout(1_000) }), "setup 失敗後 server 必須停止監聽");
  for (const artifactPath of [screenshotPath, tracePath]) {
    const artifact = await stat(artifactPath);
    assert.ok(artifact.size > 0, `setup 失敗產物不可為空：${artifactPath}`);
  }
});

test("populated：Tab/Enter/Escape 操作真按鈕、內層提醒不誤開明細且輪詢保留草稿", { timeout: 90_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 900 });
    await visibleNav(page, "strategy").click();
    await page.locator(".swing-card").waitFor();

    const denominators = page.locator('#swingVerify .verification-denominators > summary');
    await denominators.focus();
    await page.keyboard.press('Enter');
    assert.equal(await denominators.evaluate(node => node.parentElement.open), true, '正式cohort分母可用鍵盤展開');
    await page.locator('#swingVerify .verification-denominators').getByText(/次開價格觀察沿用原收盤退出與窗口/).waitFor();
    assert.match(await page.locator('#swingVerify .verification-denominators').textContent(), /舊紀錄 12 筆驗證單/);
    assert.match(await page.locator('#swingVerify .verification-denominators').textContent(), /有效 20\/38・缺 18/);
    assert.match(await page.locator('#swingVerify .verification-model').nth(1).textContent(), /歷史平均淨報酬：▲1\.10%/);
    await fixture.captureSnapshot('measurement-denominators-375');
    await page.keyboard.press('Enter');
    assert.equal(await denominators.evaluate(node => node.parentElement.open), false);
    assert.equal(await denominators.evaluate(node => node === document.activeElement), true, '收合後精確保留在原summary');

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

    const scoreFold = page.locator("#swingVerify details.sv-fold");
    if (!(await scoreFold.evaluate((node) => node.open))) await scoreFold.locator("summary").click();
    const zoomMeasurements = await fixture.emulateTextZoom(2);
    assert.equal(zoomMeasurements.length, 4);
    const scrollY = await page.evaluate(() => {
      window.scrollTo(0, 0);
      return window.scrollY;
    });
    assert.equal(scrollY, 0, "量 viewport 幾何前必須回到頁頂");
    await assertExpectedLayout(page, { width: 375 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      true,
      "375px、文字 200% 後 body 不可橫向溢出",
    );
    await alertButton.focus();
    assert.equal(await alertButton.evaluate((node) => node === document.activeElement), true, "文字 200% 後建立提醒按鈕仍可聚焦");
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    await fixture.emulateTextZoom(2);
    await scoreFold.evaluate((node) => { node.open = true; });
    await assertExpectedLayout(page, { width: 375, detailOpen: true });
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
    assert.equal(
      await page.evaluate(() => document.activeElement?.matches('.swing-open[data-swing-code="6488"]')),
      true,
      `應精確回到 .swing-open[data-swing-code="6488"]，實際 ${active.selector}`,
    );
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

test("populated：建立提醒後的背景同步晚到，不得把處置看板 Escape 後剛回焦的卡換掉", { timeout: 90_000 }, async () => {
  // 慢機器上的真實序列（見 .agents/reports/cua-2026-09-09 的 trace 分析）：PUT /api/alerts 在 350ms 防抖後才送出，
  // 回應落在使用者已切到處置看板、Escape 關明細回焦之後。這裡把 PUT 的回應扣住到回焦之後才放行，讓競態每次都發生。
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 375, height: 900 });
    const heldPuts = [];
    let holdPuts = false;
    await page.route("**/api/alerts", async (route) => {
      if (holdPuts && route.request().method() === "PUT") { heldPuts.push(route); return; }
      await route.fallback();
    });
    await visibleNav(page, "strategy").click();
    await page.locator(".swing-card").waitFor();
    holdPuts = true;
    await page.locator(".swing-plan-alerts").first().click();

    await visibleNav(page, "surveillance").click();
    await page.locator('[data-surv-tab="inDisposition"]').click();
    const surveillanceOpener = page.locator(".surv-card").first();
    await surveillanceOpener.focus();
    await page.keyboard.press("Enter");
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#detailPanel.is-open").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.dataset.code === "6488");

    // 等防抖後的 PUT 真的送出，再放行它的回應。
    for (let round = 0; round < 60 && heldPuts.length === 0; round += 1) await page.waitForTimeout(50);
    assert.equal(heldPuts.length, 1, "前提：建立提醒後應有一次 PUT /api/alerts 被扣住");
    holdPuts = false;
    await heldPuts[0].fallback();
    await page.waitForResponse((response) => response.url().endsWith("/api/alerts") && response.request().method() === "PUT");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const active = await page.evaluate(() => ({
      code: document.activeElement?.dataset.code || "",
      selector: document.activeElement?.className || document.activeElement?.tagName || "",
      alertsSynced: priceAlertsState.rev,
    }));
    assert.equal(active.code, "6488", `提醒同步回應晚到的重繪不得把剛回焦的處置卡換掉，實際 ${active.selector}`);
  } catch (error) {
    await fixture.captureFailure("interaction-smoke-alert-sync-focus");
    throw error;
  } finally {
    await fixture.close();
  }
});
