// 更多頁診斷在四尺寸與真正 200% 文字可讀，原生收合／查詢焦點保持且不觸發選股。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, visibleNav } from '../helpers/browser-fixtures.mjs';

test('保存、正式零訊號與補驗受阻保持分列，查詢與鍵盤收合可恢復', { timeout: 90000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: 'populated' });
  try {
    const { page } = fixture;
    const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    let unavailable = false;
    const payload = { ok: true, generatedAt: new Date().toISOString(), asOf,
      persistence: { writable: false, pendingWrites: 0, lastFailureCode: 'ENOSPC', lastFailureAt: new Date().toISOString() }, sidecars: {},
      scheduler: { enabled: false, running: false, failures: 1, failureDay: asOf }, input: { status: 'incomplete', attemptedAt: new Date().toISOString() },
      captures: { overnight: { today: { status: 'published', signalCount: 0 } }, swing: { today: { status: 'published', signalCount: 2 } } },
      history: { overnight: { total: 20, withoutFinal: 3 }, swing: { total: 100, pending: 4 }, benchmarks: { total: 10, pending: 1, unavailable: 1, complete: 8 } } };
    await page.route('**/api/operational-status', route => route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { ok: false, error: '狀態查詢暫時失敗' } : payload }));
    await visibleNav(page, 'more').click(); await page.locator('[data-setting="source"]').click();
    const panel = page.locator('.operational-status'); const summary = page.locator('#operationalStatusToggle');
    assert.equal(await panel.evaluate(node => node.open), false);
    await summary.focus(); await page.keyboard.press('Enter');
    await panel.getByText('保存受阻', { exact: true }).waitFor();
    assert.match(await panel.textContent(), /正式發布・0 筆訊號/);
    assert.match(await panel.textContent(), /排程已關閉/);
    assert.equal(await page.locator('.operational-reasons').evaluate(node => node.open), false);
    for (const width of [375, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const zoom of [1, 2]) {
        await fixture.emulateTextZoom(zoom, ['#operationalStatusToggle', '.operational-rows dt', '.operational-rows dd', '.operational-status button']);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}/${zoom} 無橫向溢出`);
        for (const row of await panel.locator('.operational-rows > div').all()) {
          assert.equal(await row.isVisible(), true); const box = await row.boundingBox(); assert.ok(box.width > 0 && box.height > 0);
          assert.equal(await row.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, '狀態列不截斷');
        }
        await summary.focus(); await page.evaluate(() => renderLiveDataUpdate());
        assert.equal(await page.evaluate(() => document.activeElement.id), 'operationalStatusToggle');
        assert.equal(await panel.evaluate(node => node.open), true);
        await page.mouse.move(0, 0);
        await page.waitForFunction(() => !document.querySelector('#toastStack .toast'));
        await panel.scrollIntoViewIfNeeded(); await fixture.captureSnapshot(`operational-status-${width}-${zoom * 100}`);
      }
    }
    const requests = [];
    const listener = request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); };
    page.on('request', listener);
    unavailable = true;
    await panel.locator('[data-action="refresh-operational-status"]').click();
    await panel.getByText(/本次查詢失敗，狀態未知/).waitFor();
    assert.match(await panel.textContent(), /上次成功查詢/);
    unavailable = false;
    await panel.locator('[data-action="refresh-operational-status"]').click();
    await panel.getByText('保存受阻', { exact: true }).waitFor();
    page.off('request', listener);
    assert.ok(requests.includes('/api/operational-status'));
    assert.equal(requests.some(path => /overnight|swing|verify/.test(path)), false, '重新查詢不呼叫掃描或成績單');
    const reason = page.locator('#operationalReasonsToggle'); await reason.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.operational-reasons').evaluate(node => node.open), true);
    await page.locator('.operational-reasons').getByText(/最近保存的來源不足/).waitFor();
    await fixture.captureSnapshot('operational-status-reasons');
    await summary.focus(); await page.keyboard.press('Enter'); assert.equal(await panel.evaluate(node => node.open), false);
  } catch (error) { await fixture.captureFailure('operational-status', error); throw error; }
  finally { await fixture.close(); }
});
