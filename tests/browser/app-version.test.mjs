// 真實 Chromium 驗舊分頁／新分頁載入不同 app.js 宣告、舊後端降級及版本面板重排。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture, visibleNav } from '../helpers/browser-fixtures.mjs';

test('載入時外殼身份不跟 API 漂移，舊後端／重啟與刷新資訊在四尺寸及 200% 可閱讀', { timeout: 90000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: 'populated' });
  let nextPage;
  try {
    const { page, context, server } = fixture;
    const originalShell = await page.evaluate(() => APP_SHELL_VERSION);
    let identity = { runtime: { commit: 'oldcommit', fingerprint: 'a'.repeat(64), dirty: false }, disk: { commit: 'docsonly', fingerprint: 'a'.repeat(64), dirty: false }, shellVersion: 'stock1-shell-fixture-next', restartRequired: false };
    let update = { state: 'current' };
    const payload = () => ({ ok: true, version: '0.1.0', build: { available: true, commit: 'oldcommit', branch: 'main' }, identity, update });
    await page.route('**/api/app-version', route => route.fulfill({ json: payload() }));
    await visibleNav(page, 'more').click(); await page.locator('[data-setting="version"]').click();
    await page.locator('#moreDetail').getByText('需要刷新', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => APP_SHELL_VERSION), originalShell);

    nextPage = await context.newPage();
    const nextSource = (await readFile(resolve('app.js'), 'utf8')).replace(`const APP_SHELL_VERSION = "${originalShell}";`, 'const APP_SHELL_VERSION = "stock1-shell-fixture-next";');
    await nextPage.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(server.baseUrl).origin) return route.abort();
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: nextSource });
      if (url.pathname === '/api/app-version') return route.fulfill({ json: payload() });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: false, error: 'offline fixture' } });
      return route.continue();
    });
    await nextPage.goto(server.baseUrl, { waitUntil: 'domcontentloaded' });
    await visibleNav(nextPage, 'more').click(); await nextPage.locator('[data-setting="version"]').click();
    await nextPage.locator('#moreDetail').getByText('最新', { exact: true }).waitFor();
    assert.equal(await nextPage.evaluate(() => APP_SHELL_VERSION), identity.shellVersion);
    assert.equal(await page.evaluate(() => APP_SHELL_VERSION), originalShell, '原分頁必須仍保留舊程式宣告');
    update = { state: 'behind', behindBy: 1 };
    await nextPage.locator('[data-action="refresh-app-version"]').click();
    await nextPage.locator('#moreDetail').getByText('啟動版落後 1', { exact: true }).waitFor();
    const documentsOnlyText = await nextPage.locator('#moreDetail').textContent();
    assert.match(documentsOnlyText, /未確認磁碟是否追上 GitHub/);
    assert.doesNotMatch(documentsOnlyText, /這台還沒更新|重新啟動伺服器|需要重啟|已是 GitHub 上的最新版本/);
    await nextPage.setViewportSize({ width: 375, height: 1000 });
    assert.equal(await nextPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const versionBadge = nextPage.locator('[data-setting="version"] em');
    assert.equal(await versionBadge.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, '啟動版落後標章可完整顯示');
    await nextPage.locator('#moreDetail').scrollIntoViewIfNeeded();
    await nextPage.screenshot({ path: resolve('test-results/browser/app-version-r1-docs-375.png') });
    update = { state: 'current' };
    identity = null;
    await nextPage.locator('[data-action="refresh-app-version"]').click();
    await nextPage.locator('#moreDetail').getByText('身份未確認', { exact: true }).waitFor();
    identity = { runtime: { commit: 'oldcommit', fingerprint: 'a'.repeat(64), dirty: true }, disk: { commit: 'newcommit', fingerprint: 'b'.repeat(64), dirty: false }, shellVersion: 'stock1-shell-fixture-next', restartRequired: true };
    await page.locator('[data-action="refresh-app-version"]').click();
    await page.locator('#moreDetail').getByText('需要重啟', { exact: true }).waitFor();
    for (const width of [375, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const zoom of [1, 2]) {
        await fixture.emulateTextZoom(zoom, ['#moreDetail p', '#moreDetail dt', '#moreDetail dd', '#moreDetail button', '#appVersionDetailsToggle']);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width} / ${zoom} 無橫向溢出`);
        const details = page.locator('.version-details');
        assert.equal(await details.evaluate(node => node.open), false);
        assert.equal(await page.locator('.version-details p').first().isVisible(), false, '技術說明預設不在前景');
        for (const dd of await page.locator('#moreDetail > .version-identities dd').all()) {
          assert.equal(await dd.evaluate(node => getComputedStyle(node).textOverflow), 'clip');
          assert.equal(await dd.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, '關鍵身份與狀態不截斷');
        }
        const summary = page.locator('#appVersionDetailsToggle'); await summary.focus(); await page.keyboard.press('Enter');
        assert.equal(await details.evaluate(node => node.open), true);
        await page.locator('[data-action="refresh-app-version"]').click();
        await page.waitForFunction(() => !appVersionState.loading);
        assert.equal(await details.evaluate(node => node.open), true, 'API重繪不強制收合');
        await summary.focus(); await page.keyboard.press('Enter');
        const refresh = page.locator('[data-action="refresh-app-version"]'); await refresh.scrollIntoViewIfNeeded(); assert.equal(await refresh.isVisible(), true);
        await fixture.captureSnapshot(`app-version-${width}-${zoom * 100}`);
      }
    }
  } catch (error) { await fixture.captureFailure('app-version', error); throw error; }
  finally { await nextPage?.close(); await fixture.close(); }
});
