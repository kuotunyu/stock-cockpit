// 真 Chromium 驗 PWA 整包安裝、失敗後可用外殼、更新草稿／身份、離線重開與 API 不假新鮮。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPwaFixture, waitForController, updateWorker } from '../helpers/pwa-fixtures.mjs';
import { visibleNav } from '../helpers/browser-fixtures.mjs';

test('A 安裝後 B 資產失敗仍可重開 A，重試 B 不清舊分頁計畫且新分頁載入 B', { timeout: 90000 }, async () => {
  const f = await createPwaFixture();
  try {
    const page = await f.newPage();
    await waitForController(page);
    assert.equal(await page.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-a');
    assert.equal(await page.evaluate(async () => (await (await caches.open('stock1-shell-test-a')).keys()).length), 11);
    await page.evaluate(() => { window.__originalController = navigator.serviceWorker.controller; window.__documentToken = 'keep-plan'; });
    await visibleNav(page, 'strategy').click();
    await page.locator('.swing-open').first().click();
    await page.locator('#detailPanel [data-trade-plan-open]').click();
    const quantity = page.locator('#tradePlanForm [name=quantity]');
    await quantity.fill('1234');
    await quantity.focus();

    f.setVersion('stock1-shell-test-b');
    f.setFailure({ path: '/app.js', status: 503 });
    assert.equal(await updateWorker(page), 'redundant', '失敗 B 不能啟用');
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === window.__originalController), true);
    assert.equal(await page.evaluate(async () => (await (await caches.open('stock1-shell-test-b')).keys()).length), 0, '失敗 B 未發布半包 cache');
    // 不是只看 controller：同一個仍回 503 的 server 下，必要 app.js 必須可從 A 外殼讀到。
    const failedAsset = await page.evaluate(async () => {
      const response = await fetch('/app.js?failed-update=1');
      return { status: response.status, text: await response.text() };
    });
    assert.equal(failedAsset.status, 200, '新版資產 HTTP 失敗時應提供已保存的可用外殼');
    assert.match(failedAsset.text.slice(0, 300), /const APP_SHELL_VERSION = "stock1-shell-test-a"/);
    const recovered = await f.newPage('/?screen=overnight&failed-update=1');
    assert.equal(await recovered.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-a');
    assert.equal(await updateWorker(recovered), 'redundant', '重開引發的更新檢查也須先完成失敗，才解除故障');
    await recovered.close();
    assert.ok(f.requests.some(r => r.path === '/app.js' && r.version === 'stock1-shell-test-b'));

    f.setFailure(null);
    const networkSource = await page.evaluate(async () => (await fetch('/app.js?network-first=1')).text());
    assert.match(networkSource.slice(0, 300), /const APP_SHELL_VERSION = "stock1-shell-test-b"/, '網路恢復時仍優先取新版');
    assert.equal(await updateWorker(page), 'activated');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== window.__originalController);
    assert.equal(await page.evaluate(() => window.__documentToken), 'keep-plan');
    assert.equal(await quantity.inputValue(), '1234');
    assert.equal(await quantity.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-a');
    await page.locator('[data-trade-plan-close]').click();
    await visibleNav(page, 'more').click();
    await page.locator('[data-setting=version]').click();
    await page.locator('#moreDetail').getByText('需要刷新', { exact: true }).waitFor();
    assert.match(await page.locator('#moreDetail').textContent(), /stock1-shell-test-a/);

    const nextPage = await f.newPage();
    assert.equal(await nextPage.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-b');
    await visibleNav(nextPage, 'more').click();
    await nextPage.locator('[data-setting=version]').click();
    await nextPage.locator('#moreDetail').getByText('最新', { exact: true }).waitFor();
    assert.deepEqual(await nextPage.evaluate(() => caches.keys()), ['stock1-shell-test-b']);
    assert.equal(await page.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-a');
    assert.deepEqual(f.externalRequests, []);
    await f.capture('pwa-update-success');
  } catch (error) { await f.capture('pwa-update-failure'); throw error; }
  finally { await f.close(); }
});

test('離線關閉全部分頁後以 query 重開外殼，行情 API 失敗可見且不讀快取行情', { timeout: 60000 }, async () => {
  const f = await createPwaFixture();
  try {
    const online = await f.newPage();
    await waitForController(online);
    const quote = await online.evaluate(async () => (await fetch('/api/quotes?codes=6488')).json());
    assert.equal(quote.quotes[0].price, 426);
    assert.ok(f.requests.some(r => r.path === '/api/quotes'), '合成 API 必須經真正 HTTP server');
    f.setFailure({ path: '/api/quotes', status: 503 });
    assert.equal(await online.evaluate(async () => (await fetch('/api/quotes?codes=6488')).status), 503, 'API HTTP 失敗不能由先前行情補成成功');
    f.setFailure(null);
    assert.equal(await online.evaluate(async () => (await fetch('/missing.js')).status), 404, '沒有外殼備援的 HTTP 錯誤保留原狀');
    f.setFailure({ path: '/', status: 500 });
    const httpFailure = await f.newPage('/?screen=screener&http-error=1');
    assert.equal(await httpFailure.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-a', 'HTTP 導覽失敗也能讀取已保存外殼');
    await httpFailure.close();
    f.setFailure(null);
    const cachedApis = await online.evaluate(async () => {
      const cachesWithKeys = await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => r.url)));
      return cachesWithKeys.flat().filter(url => new URL(url).pathname.startsWith('/api/'));
    });
    assert.deepEqual(cachedApis, []);
    // 模擬失敗安裝／舊實作留下的非現役 cache；它不能補成現役外殼。
    await online.evaluate(async () => (await caches.open('stock1-shell-failed-install')).put('/unfinished.js', new Response('partial shell')));
    await f.context.setOffline(true);
    await online.close();
    const offline = await f.newPage('/?screen=screener&offline-shortcut=1');
    await waitForController(offline);
    assert.equal(await offline.evaluate(() => APP_SHELL_VERSION), 'stock1-shell-test-a');
    await offline.locator('.empty-state').filter({ hasText: '行情載入失敗' }).waitFor();
    assert.equal(await offline.evaluate(() => stocks.length), 0);
    assert.equal(await offline.evaluate(async () => fetch('/api/quotes?codes=6488').then(() => 'unexpected success', () => 'network failed')), 'network failed');
    assert.equal(await offline.evaluate(async () => fetch('/unfinished.js').then(() => 'partial shell leaked', () => 'network failed')), 'network failed');
    const asset = await offline.evaluate(async () => {
      const response = await fetch('/portfolio-risk.js?v=offline');
      return { ok: response.ok, text: await response.text() };
    });
    assert.equal(asset.ok, true);
    assert.match(asset.text, /Stock1Risk/);
    assert.deepEqual(f.externalRequests, []);
    await f.capture('pwa-offline-success');
  } catch (error) { await f.capture('pwa-offline-failure'); throw error; }
  finally { await f.close(); }
});

test('PWA worker 外網也被本機 proxy 攔住，成功與 setup 失敗均完整清理', { timeout: 30000 }, async () => {
  const f = await createPwaFixture();
  try {
    const page = await f.newPage();
    await waitForController(page);
    const worker = f.context.serviceWorkers()[0];
    const result = await worker.evaluate(async () => fetch('http://pwa-tripwire.invalid/worker-probe').then(r => r.status, () => 'blocked'));
    assert.ok(result === 403 || result === 'blocked');
    assert.equal(await worker.evaluate(async () => fetch('https://pwa-tripwire.invalid/worker-probe').then(() => 'unexpected', () => 'blocked')), 'blocked');
    // 仍使用自有臨時埠；不同 loopback origin 也須經 proxy，不能走預設本機 bypass。
    const otherLoopbackOrigin = f.baseUrl.replace('127.0.0.1', 'localhost');
    await worker.evaluate(async url => fetch(`${url}/worker-probe`).catch(() => null), otherLoopbackOrigin);
    assert.deepEqual(f.externalRequests, ['http://pwa-tripwire.invalid/worker-probe', 'CONNECT pwa-tripwire.invalid:443', `${otherLoopbackOrigin}/worker-probe`]);
  } finally { await f.close(); }
  assert.equal(f.browser.isConnected(), false);
  assert.equal(f.server.listening, false);
  assert.equal(f.context.pages().length, 0);
  await f.close();
  let handles;
  const setupError = new Error('intentional PWA setup failure');
  await assert.rejects(createPwaFixture({ setupFailure: async resources => {
    handles = resources;
    const page = await resources.context.newPage();
    await page.goto(resources.baseUrl);
    await waitForController(page);
    throw setupError;
  } }), error => error === setupError);
  assert.equal(handles.browser.isConnected(), false);
  assert.equal(handles.server.listening, false);
  assert.equal(handles.context.pages().length, 0);
});
