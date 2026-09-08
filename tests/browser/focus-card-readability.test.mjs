// 真實 Chromium：手機兩欄重點卡的短股名不得逐字直排（computer use 心得 F03／CUA-03）。
// 桌機 strong 是「名稱 minmax(0,1fr) ＋ 漲幅 auto」兩欄，漲幅 nowrap 不讓位；手機兩欄卡把名稱擠到約 60px，
// 「台積電」三字 21px 就一字一行。量實際 rect：3 字內名稱高度 ≤ 行高×1.2、漲幅可見且不與名稱相交、
// body 不橫向溢出；桌機仍是同列兩欄；點卡開同一檔、Escape 回到原 opener。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const MOBILE_WIDTHS = [375, 390, 430];

test("手機重點卡：3 字內股名一行完整，漲幅另起一行不重疊；桌機仍同列兩欄；點卡與回焦不變", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    await visibleNav(page, "overnight").click();
    await page.locator("button.today-focus-card").first().waitFor({ state: "visible" });

    for (const width of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => document.fonts.ready);
      const measured = await page.evaluate(() => {
        const toRect = (node) => {
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        };
        return {
          bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          cards: [...document.querySelectorAll("button.today-focus-card")].map((card) => {
            const name = card.querySelector(".focus-pick-name");
            const pct = card.querySelector("strong > em");
            const style = getComputedStyle(name);
            return {
              text: name.textContent.trim(),
              fontSize: parseFloat(style.fontSize),
              lineHeight: parseFloat(style.lineHeight),
              name: toRect(name),
              pct: toRect(pct),
              pctText: pct.textContent.trim(),
            };
          }),
        };
      });
      assert.equal(measured.bodyFits, true, `${width}px body 不可橫向溢出`);
      assert.equal(measured.cards.length, 3, `${width}px populated fixture 應有三張重點卡`);
      for (const card of measured.cards) {
        assert.ok(card.name.width > 0 && card.name.height > 0, `${width}px「${card.text}」名稱需有實際尺寸`);
        assert.ok(card.pct.width > 0 && card.pct.height > 0, `${width}px「${card.text}」漲幅需可見`);
        assert.ok(card.fontSize >= 21, `${width}px 名稱字級不得縮小：${card.fontSize}`);
        const separated = card.name.right <= card.pct.left + 1 || card.pct.right <= card.name.left + 1
          || card.name.bottom <= card.pct.top + 1 || card.pct.bottom <= card.name.top + 1;
        assert.equal(separated, true, `${width}px「${card.text}」名稱與漲幅不得重疊 ${JSON.stringify([card.name, card.pct])}`);
        if (card.text.length <= 3) {
          assert.ok(card.name.height <= card.lineHeight * 1.2,
            `${width}px「${card.text}」不得逐字直排：高 ${card.name.height} 行高 ${card.lineHeight}`);
        }
        assert.match(card.pctText, /[▲▼]?[+\-−]?\d/, "漲幅文字仍在");
      }
      await fixture.captureSnapshot(`focus-card-${width}`);
    }

    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    const desktop = await page.evaluate(() => {
      const card = document.querySelector("button.today-focus-card");
      const columns = getComputedStyle(card.querySelector("strong")).gridTemplateColumns.trim().split(/\s+/).length;
      const name = card.querySelector(".focus-pick-name").getBoundingClientRect();
      const pct = card.querySelector("strong > em").getBoundingClientRect();
      return { columns, sameRow: Math.abs(name.top - pct.top) < name.height, gridColumns: getComputedStyle(document.querySelector(".today-focus-grid")).gridTemplateColumns.trim().split(/\s+/).length };
    });
    assert.equal(desktop.columns, 2, "桌機 strong 仍是名稱＋漲幅兩欄");
    assert.equal(desktop.sameRow, true, "桌機名稱與漲幅仍同一列");
    assert.equal(desktop.gridColumns, 3, "桌機重點卡仍三欄");

    await page.setViewportSize({ width: 390, height: 844 });
    const first = page.locator("button.today-focus-card").first();
    const code = await first.getAttribute("data-overnight-code");
    assert.ok(code, "重點卡必須帶 data-overnight-code");
    await first.click();
    await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
    assert.match(await page.locator("#detailName").textContent(), new RegExp(code), "點卡要開同一檔");
    await page.keyboard.press("Escape");
    await page.locator("#detailPanel.is-open").waitFor({ state: "hidden" });
    assert.equal(await first.evaluate((node) => node === document.activeElement), true, "Escape 後焦點回到原重點卡");
  } catch (error) {
    await fixture.captureFailure("focus-card-readability");
    throw error;
  } finally {
    await fixture.close();
  }
});
