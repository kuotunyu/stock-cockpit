import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, visibleNav } from '../helpers/browser-fixtures.mjs';

test('Chromium：換查詢不能 Enter 選到舊股；關圖後延遲說明不再跳出', { timeout: 90_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: 'populated' });
  const { page } = fixture;
  const secondResponse = Promise.withResolvers();
  const oldPeriodResponse = Promise.withResolvers();
  let pendingRoute;
  let pendingPeriodRoute;
  try {
    await page.setViewportSize({ width: 375, height: 900 });
    const now = await page.evaluate(() => Date.now());
    const candles = Array.from({ length: 60 }, (_, index) => ({
      date: new Date(now - (60 - index) * 86_400_000).toISOString().slice(0, 10),
      open: 100 + index, high: 103 + index, low: 99 + index, close: 102 + index, volume: 1000,
    }));
    await page.route('**/api/technical-analysis?*', route => {
      const query = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: { ok: true, code: query.get('code'), name: '測試圖表', period: query.get('period'),
        candles, signals: { checks: {}, risks: [] }, trendLines: {}, fibonacci: { active: false }, corporateActions: { events: [], notes: [] } } });
    });
    await page.clock.install({ time: now });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#overnightGroups .overnight-pick').first().waitFor();
    await visibleNav(page, 'technical').click();
    await page.waitForFunction(() => technicalState.data?.candles?.length > 0);
    await page.clock.pauseAt(now + 5000);
    await page.route('**/api/symbols?*', async route => {
      const query = new URL(route.request().url()).searchParams.get('q');
      if (query === '9902') {
        pendingRoute = secondResponse.promise.then(() => route.fulfill({ json: { results: [{ code: '9902', name: '新查詢測試股', exchange: 'TWSE' }] } }));
        await pendingRoute;
      } else {
        await route.fulfill({ json: { results: [{ code: '9901', name: '舊查詢測試股', exchange: 'TWSE' }] } });
      }
    });
    await page.locator('#searchOpen').click();
    await page.locator('#searchInput').fill('9901');
    await page.clock.runFor(250);
    await page.locator('#searchResults [data-code="9901"]').waitFor();
    await page.locator('#searchInput').fill('9902');
    assert.equal(await page.locator('#searchResults .search-result').count(), 0);
    await page.locator('#searchInput').press('Enter');
    assert.equal(await page.locator('#searchModal').isVisible(), true, '不能選到上一筆結果而關閉搜尋');
    await page.clock.runFor(250);
    await page.locator('#searchResults').getByText('正在搜尋官方清單...').waitFor();
    secondResponse.resolve();
    await page.locator('#searchResults [data-code="9902"]').waitFor();
    assert.equal(await page.locator('#searchResults [data-code="9901"]').count(), 0);
    await page.keyboard.press('Escape');
    await page.clock.runFor(20);

    await visibleNav(page, 'technical').click();
    await page.locator('#technicalZoomOpen').waitFor();
    assert.ok(await page.evaluate(() => technicalState.data?.candles?.length > 0));
    await page.evaluate(() => localStorage.removeItem('stock1.zoomHelpSeen.v1'));
    await page.locator('#technicalZoomOpen').click();
    await page.clock.runFor(40);
    await page.locator('#zoomChartClose').click();
    await page.clock.runFor(400);
    assert.equal(await page.locator('#zoomChartHelp').isVisible(), false);
    assert.equal(await page.locator('#technicalZoomModal').isVisible(), false);
    await page.locator('#technicalZoomOpen').click();
    await page.clock.runFor(400);
    assert.equal(await page.locator('#zoomChartHelp').isVisible(), true, '真正首次閱讀仍自動提供說明');
    await page.keyboard.press('Escape');
    await page.clock.runFor(20);
    assert.equal(await page.locator('#technicalZoomModal').isVisible(), true, 'Escape 只關最上層說明');
    await page.locator('#zoomChartClose').click();
    await page.clock.runFor(20);
    await page.locator('#technicalHelpOpen').click();
    await page.clock.runFor(20);
    assert.equal(await page.locator('#zoomChartHelp').isVisible(), true, '獨立問號不用先開圖');
    await page.keyboard.press('Escape');
    await page.clock.runFor(20);
    assert.equal(await page.locator('#technicalHelpOpen').evaluate(node => node === document.activeElement), true);

    await page.setViewportSize({ width: 1440, height: 900 });
    const periodStarted = Promise.withResolvers();
    await page.route('**/api/technical-analysis?*', async route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get('period') !== 'week') return route.fallback();
      periodStarted.resolve();
      pendingPeriodRoute = oldPeriodResponse.promise.then(() => route.fulfill({ json: {
        ok: true, code: query.get('code'), name: '舊週期測試', period: 'week', candles,
        signals: { checks: {}, risks: [] }, trendLines: {}, fibonacci: { active: false }, corporateActions: { events: [], notes: [] },
      } }));
      await pendingPeriodRoute;
    });
    await page.locator('#technicalZoomOpen').click();
    await page.clock.runFor(40);
    await page.locator('[data-zoom-period="week"]').click();
    await periodStarted.promise;
    await page.locator('#zoomChartClose').click();
    await page.clock.runFor(20);
    await page.locator('#detailZoomOpen').click();
    await page.clock.runFor(40);
    const title = await page.locator('#zoomChartTitle').textContent();
    assert.match(title, /日K/);
    oldPeriodResponse.resolve();
    await pendingPeriodRoute;
    await page.clock.runFor(40);
    assert.equal(await page.locator('#zoomChartTitle').textContent(), title);
    assert.equal(await page.evaluate(() => technicalState.data.period), 'day', '同股快取重開也須丟棄舊週K回應');
    await page.locator('#zoomChartClose').click();
    await page.clock.runFor(20);
  } catch (error) {
    await fixture.captureFailure('search-help-races');
    throw error;
  } finally {
    secondResponse.resolve();
    oldPeriodResponse.resolve();
    await pendingRoute?.catch(() => {});
    await pendingPeriodRoute?.catch(() => {});
    await fixture.close();
  }
});
