import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, visibleNav } from '../helpers/browser-fixtures.mjs';

const screens = [
  ['overnight', '隔日沖', '看盤基礎'],
  ['screener', '盤中選股', '風險與制度'],
  ['strategy', '策略雷達', '隔日沖（短線）'],
  ['watchlist', '自選股', '技術指標'],
  ['technical', '技術分析', '成績單與決策'],
  ['surveillance', '處置看板', '策略雷達（波段）'],
  ['more', '更多', ''],
];

for (const width of [375, 768, 1280, 1440]) {
  test(`問號說明 ${width}px：七頁入口、分類瀏覽、自訂搜尋與 Escape 回焦`, { timeout: 90_000 }, async () => {
    const fixture = await createBrowserFixture({ scenario: 'populated' });
    const { page } = fixture;
    try {
      await page.setViewportSize({ width, height: 900 });
      for (const [screen, label, category] of screens) {
        await visibleNav(page, screen).click();
        const help = page.locator('#screenHelp');
        await help.focus();
        await page.keyboard.press('Enter');
        await page.locator('#glossaryBody dt').filter({ hasText: `${label}（畫面）` }).waitFor();
        assert.equal(await page.locator('#glossarySearch').inputValue(), label);
        const chip = page.locator(`[data-glossary-cat="${category}"]`);
        await chip.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#glossarySearch').inputValue(), '', '自動頁名不可阻擋分類');
        assert.equal(await page.locator('.glossary-empty').count(), 0);
        assert.ok(await page.locator('#glossaryBody dd').count() > 0);
        assert.equal(await chip.evaluate(node => node === document.activeElement), true, '重繪後保留分類焦點');
        if (screen === 'watchlist') await fixture.captureSnapshot(`glossary-category-${width}`);
        await page.keyboard.press('Escape');
        await page.locator('#glossaryModal').waitFor({ state: 'hidden' });
        assert.equal(await help.evaluate(node => node === document.activeElement), true);
      }
      await page.locator('#screenHelp').click();
      await page.locator('#glossarySearch').fill('量比');
      await page.locator('[data-glossary-cat=""]').click();
      assert.equal(await page.locator('#glossarySearch').inputValue(), '量比');
      await page.locator('#glossaryBody dt').filter({ hasText: '量比5' }).waitFor();
      await page.keyboard.press('Escape');
    } catch (error) {
      await fixture.captureFailure(`glossary-navigation-${width}`);
      throw error;
    } finally {
      await fixture.close();
    }
  });
}
