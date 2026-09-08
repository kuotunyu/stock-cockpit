// 真實 Chromium：策略雷達零候選＋資料警告時，桌面與 390px 都要看得到警告與「本次可用資料」空態，
// 徽章顯示暫定而不是收盤凍結（computer use 心得 F02／CUA-02）。
// fixture 沒有「零筆＋warnings＋provisional」情境，這裡用 page.route 覆蓋 /api/swing；其他 API 沿固定 fixture。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const WARNING = "上市與上櫃整批收盤資料日尚未對齊（上市 2026/09/03、上櫃 2026/09/04），稍後會自動補齊。";

test("零候選＋警告：警告可見、空態不說全市場沒有、徽章為暫定而非收盤凍結", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await page.route("**/api/swing?*", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          asOf: "2026-09-04",
          source: "瀏覽器固定資料",
          generatedAt: "2026-09-07T02:00:00.000Z",
          picks: [],
          matchedCount: 0,
          candidateCount: 240,
          scenarios: [
            { key: "midBandDefense", name: "中軌攻防", count: 0 },
            { key: "strongContinuation", name: "上軌續攻", count: 0 },
          ],
          riskPolicy: "注意與處置只標示",
          provisional: true,
          coverage: { complete: false },
          scanQuality: { reliable: false },
          warnings: [WARNING],
          publication: { kind: "provisional" },
        },
      });
    });

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await visibleNav(page, "strategy").click();
      await page.locator("#strategyBoard").getByText(/本次可用資料未找到符合「中軌攻防」的標的/).waitFor();
      const warning = page.locator("#strategyBoard .strategy-empty.is-error");
      await warning.waitFor({ state: "visible" });
      assert.match(await warning.textContent(), /整批收盤資料日尚未對齊/, `${width}px 警告全文要在畫面上`);
      assert.match(await warning.textContent(), /1 項資料品質問題/);
      assert.equal(await page.locator("#strategyBoard").getByText(/今天沒有符合/).count(), 0, "有警告時不得用安心文案");

      const badge = page.locator("#strategyMeta [data-publication-badge]");
      await badge.waitFor({ state: "visible" });
      const badgeText = await badge.textContent();
      assert.match(badgeText, /暫定/, `${width}px 徽章要顯示暫定`);
      assert.doesNotMatch(badgeText, /收盤凍結/);
      assert.equal(await badge.getAttribute("data-kind"), "estimated");

      const geometry = await page.evaluate(() => {
        const box = document.querySelector("#strategyBoard .strategy-empty.is-error").getBoundingClientRect();
        return { width: box.width, height: box.height, bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
      });
      assert.ok(geometry.width > 0 && geometry.height > 0, `${width}px 警告區需有實際尺寸`);
      assert.equal(geometry.bodyFits, true, `${width}px body 不可橫向溢出`);
      await fixture.captureSnapshot(`strategy-empty-quality-${width}`);
    }
  } catch (error) {
    await fixture.captureFailure("strategy-empty-quality");
    throw error;
  } finally {
    await fixture.close();
  }
});
