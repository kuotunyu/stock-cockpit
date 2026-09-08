import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, visibleNav } from '../helpers/browser-fixtures.mjs';

for (const width of [375, 768, 1280, 1440]) {
  test(`說明與篩選 ${width}px：跨分類、閱讀起點、專用說明、篩選範圍`, { timeout: 90_000 }, async () => {
    const fixture = await createBrowserFixture({ scenario: 'populated' });
    const { page } = fixture;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#glossaryOpen').click();
      const body = page.locator('#glossaryBody');
      const scroll = await body.evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
      assert.ok(scroll > 0, '確實捲過長名詞表');
      await page.keyboard.press('Escape');
      await page.locator('#glossaryOpen').click();
      assert.equal(await body.evaluate(node => node.scrollTop), 0, '重開由起點閱讀');
      await page.locator('[data-glossary-cat="技術指標"]').click();
      await page.locator('#glossarySearch').fill('自選股');
      await page.locator('.glossary-empty').getByText(/技術指標/).waitFor();
      await page.locator('.glossary-empty button').click();
      await body.locator('dt').filter({ hasText: '自選股（畫面）' }).waitFor();
      assert.equal(await page.locator('#glossarySearch').inputValue(), '自選股');
      await page.locator('#glossarySearch').fill('漲幅');
      await body.locator('dt').filter({ hasText: '漲跌幅' }).waitFor();
      await fixture.captureSnapshot(`help-recovery-${width}`);
      await page.keyboard.press('Escape');

      for (const [screen, opener, modal, content, closer] of [
        ['strategy', '#strategyLegendToggle', '#strategyLegend', '.legend-modal-body', '#strategyLegendClose'],
        ['technical', '#technicalHelpOpen', '#zoomChartHelp', '.chart-zoom-help-body', '#zoomChartHelpClose'],
        ['surveillance', '#survHelpOpen', '#survHelp', '.surv-help-body', '#survHelpClose'],
      ]) {
        await visibleNav(page, screen).click();
        await page.locator(opener).click();
        await page.locator(modal).waitFor({ state: 'visible' });
        const text = page.locator(`${modal} ${content}`);
        assert.ok((await text.textContent()).trim().length > 40);
        await text.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await page.locator(closer).click();
        await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), opener);
        await page.locator(opener).click();
        assert.equal(await text.evaluate(node => node.scrollTop), 0, `${opener} 重開從說明起點開始`);
        await page.keyboard.press('Escape');
      }

      await page.locator('[data-surv-tab="inDisposition"]').click();
      await page.locator('#survMineToggle').click();
      await page.locator('[data-surv-market="TPEx"]').click();
      await page.locator('#survBoard .surv-empty').getByText(/自選股.*被.*篩選/).waitFor();
      await page.locator('[data-surv-market="all"]').click();
      await page.locator('#survBoard .surv-card').waitFor();

      await visibleNav(page, 'screener').click();
      await page.locator('[data-universe="turnover"]').click();
      await page.locator('[data-focus="danger"]').click();
      await page.locator('[data-universe="strong"]').click();
      await page.locator('[data-universe="turnover"]').click();
      assert.equal(await page.locator('[data-focus="capital"]').getAttribute('aria-selected'), 'true');
      await page.locator('#filterOpen').click();
      await page.locator('#directionFilter').selectOption('up');
      await page.locator('#filterApply').click();
      await visibleNav(page, 'watchlist').click();
      assert.equal(await page.locator('#filterOpen').evaluate(node => node.classList.contains('has-active-filter')), false);
      await page.locator('#filterOpen').click();
      await page.locator('#filterScopeNote').getByText(/目前頁面不受/).waitFor();
      await page.waitForFunction(() => !document.querySelector('#toastStack .toast'));
      if (width === 375) await page.setViewportSize({ width, height: 700 });
      await fixture.emulateTextZoom(2);
      if (width === 375) assert.ok(await page.locator('.filter-drawer').evaluate(node =>
        node.scrollHeight > node.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)),
      '長說明與200%文字須由抽屜本身捲動，不能靠被鎖住的背景頁面');
      await page.locator('#filterApply').scrollIntoViewIfNeeded();
      const rect = await page.locator('#filterApply').boundingBox();
      assert.ok(rect.y >= 0 && rect.y + rect.height <= page.viewportSize().height + 1, '200%文字仍可到達套用按鈕');
      if (width === 375) assert.ok(await page.locator('.filter-drawer').evaluate(node => node.scrollTop > 0), '實際捲動抽屜到套用按鈕');
      await fixture.captureSnapshot(`filter-scope-${width}`);
      await page.locator('#filterApply').click();
      assert.equal(await page.locator('#filterDrawer').isVisible(), false);
    } catch (error) {
      await fixture.captureFailure(`help-state-audit-${width}`);
      throw error;
    } finally { await fixture.close(); }
  });
}
