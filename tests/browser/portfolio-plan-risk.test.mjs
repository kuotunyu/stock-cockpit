import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, visibleNav } from '../helpers/browser-fixtures.mjs';

test('持股情境風險與明確投入金額在四尺寸及200%文字可讀、鍵盤可操作', { timeout: 120000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: 'populated' });
  try {
    const { page } = fixture;
    const plan = { planId: 'risk-plan', code: '6488', exchange: 'TWSE', strategy: 'swing', status: 'active', quantity: 400, stopPrice: 400, entryPrice: 420, expiresOn: '2026-09-08', reason: '風險情境', initial: null, revisions: [] };
    await page.route('**/api/trade-plans', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rev: 1, plans: [plan] }) }));
    await visibleNav(page, 'strategy').click();
    await page.locator('[data-risk-toggle]').click();
    await page.locator('#swingCapital').fill('100000');
    await page.locator('#swingRiskPct').fill('5');
    assert.match(await page.locator('.swing-stat-size').first().textContent(), /資金未檢查/);
    await page.locator('#swingAvailableCash').fill('100000');
    assert.match(await page.locator('.swing-stat-size').first().textContent(), /含買入手續費/);
    const summary = page.locator('.swing-stat-size summary').first();
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await summary.evaluate(n => n.parentElement.open), true);
    for (const width of [375, 768, 1280, 1440]) for (const factor of [1, 2]) {
      await page.setViewportSize({ width, height: 1000 });
      await fixture.emulateTextZoom(factor, ['#swingAvailableCash', '.swing-stat-size summary']);
      const bounds = await page.locator('.swing-risk-bar input:visible, .swing-risk-bar label:visible, .swing-stat-size').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, id: n.id, left: n.getBoundingClientRect().left, right: n.getBoundingClientRect().right, scroll: n.scrollWidth, client: n.clientWidth })));
      for (const box of bounds) assert.ok(box.left >= 0 && box.right <= width + 1 && box.scroll <= box.client + 1, JSON.stringify({ width, factor, box }));
      await page.locator('.swing-risk-bar').scrollIntoViewIfNeeded();
      await fixture.captureSnapshot(`portfolio-size-${width}-text${factor * 100}`);
      if (factor === 1 && [375, 1440].includes(width)) { await page.locator(".swing-stat-size").first().scrollIntoViewIfNeeded(); await fixture.captureSnapshot(`portfolio-size-detail-${width}`); }
    }
    await fixture.emulateTextZoom(1, []);
    await visibleNav(page, 'watchlist').click();
    await page.locator('[data-watch-list="hold"]').click();
    // Keep the real polling cycle, but fix this scenario's producer inputs too.
    // The shared fixture otherwise synthesizes a price for every requested code.
    await page.route('**/api/quotes?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sourceKey: 'official', generatedAt: '2026-09-07T02:00:00.000Z', realtimeCount: 1, quotes: [{ code: '6488', name: '環球晶', exchange: 'TWSE', price: 425, source: 'TWSE MIS', sourceKind: 'realtime', asOf: '2026-09-07T02:00:00.000Z', priceStale: false }] }) }));
    await page.evaluate(plan => {
      tradePlansState.loaded = true; tradePlansState.plans = [plan];
      tradesState.portfolio = { holdings: [{ code: '6488', shares: 1000, avgCost: 400, cost: 400000 }, { code: '9999', shares: 500, avgCost: 50, cost: 25000 }], totals: { cost: 425000 }, realized: [] };
      tradesState.records = [{ id: 'risk-buy', code: '6488', market: 'TWSE', side: 'buy', date: '20260904', shares: 1000, price: 400, fee: 342, tax: 0 }];
      const stock = stocks.find(s => s.code === '6488'); mergeOfficialQuote(stock, { price: 425, exchange: 'TWSE', source: 'TWSE MIS', sourceKind: 'realtime', asOf: '2026-09-07T02:00:00.000Z' });
      document.activeElement.blur(); renderHoldingsPanel();
    }, plan);
    const risk = page.locator('.hold-plan-risk');
    assert.match(await risk.textContent(), /未知 600 股/);
    await fixture.advancePollingCycle();
    assert.match(await risk.textContent(), /市值覆蓋 未知/);
    const warning = risk.locator('[name=alertPct]'); await warning.fill('4');
    await risk.locator('[type=submit]').focus(); await page.keyboard.press('Enter');
    assert.match(await risk.textContent(), /你設定的 4%/);
    const detail = risk.locator('summary').filter({ hasText: '同股與產業集中度' }); await detail.focus(); await page.keyboard.press('Enter');
    assert.equal(await detail.evaluate(n => n.parentElement.open), true);
    for (const width of [375, 768, 1280, 1440]) for (const factor of [1, 2]) {
      await page.setViewportSize({ width, height: 1000 });
      await fixture.emulateTextZoom(factor, ['.hold-plan-risk-heading strong', '.hold-plan-risk summary']);
      assert.ok(await risk.evaluate(n => n.querySelector('.hold-plan-risk-heading').getBoundingClientRect().left - n.getBoundingClientRect().left >= 12), '風險內容保留面板內距');
      const boxes = await risk.locator('input,button').evaluateAll(nodes => nodes.map(n => ({ left: n.getBoundingClientRect().left, right: n.getBoundingClientRect().right, height: n.getBoundingClientRect().height })));
      for (const box of boxes) assert.ok(box.left >= 0 && box.right <= width + 1 && box.height >= 44, JSON.stringify({ width, factor, box }));
      assert.ok(await risk.evaluate(n => n.scrollWidth <= n.clientWidth + 1));
      await risk.scrollIntoViewIfNeeded(); await fixture.captureSnapshot(`portfolio-risk-${width}-text${factor * 100}`);
    }
    await fixture.emulateTextZoom(1, []);
    const link = risk.locator('[data-holding-plan-id]'); await link.focus(); await page.keyboard.press('Enter');
    await page.locator('#tradePlanForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#tradePlanForm [name=stopPrice]').inputValue(), '400');
    await page.evaluate(plan => applyTradePlansPayload({ ok: true, rev: 2, plans: [{ ...plan, stopPrice: 410 }] }), plan);
    assert.match(await risk.textContent(), /情境減值 6,000/);
    await page.keyboard.press('Escape'); assert.equal(await link.evaluate(n => n === document.activeElement), true);
    await visibleNav(page, 'strategy').click(); await page.locator('#swingAvailableCash').focus();
    await page.evaluate(() => activateAuthenticatedUser({ id: 'second-risk-user', username: 'second' }));
    assert.equal(await page.locator('#swingAvailableCash').inputValue(), '');
    for (const operation of ['switch', '401']) {
      await page.evaluate(() => activateAuthenticatedUser({ id: 'private-cash-owner', username: 'cash-owner' }));
      await visibleNav(page, 'strategy').click();
      await page.locator('#swingAvailableCash').fill('12345');
      assert.match(await page.locator('.swing-stat-size').first().textContent(), /已按你提供的 12,345 檢查/);
      await visibleNav(page, 'more').click();
      assert.equal(await page.locator('#strategyBoard').isVisible(), false);
      assert.match(await page.locator('#strategyBoard').textContent(), /12,345/);
      if (operation === 'switch') {
        await page.evaluate(() => { activateAuthenticatedUser({ id: 'next-cash-owner', username: 'next' }); render(); });
      } else {
        await page.route('**/api/trade-plans', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'AUTH_REQUIRED', error: '登入已到期' }) }));
        await page.evaluate(async () => { try { await fetchApi('/api/trade-plans'); } catch (error) { handleAuthRequired(error); } });
        await page.locator('#loginGate').waitFor({ state: 'visible' });
      }
      assert.equal(await page.locator('#swingAvailableCash').inputValue(), '');
      assert.equal(await page.locator('.swing-stat-size').count(), 0, 'hidden quantities, required cash and checks must be erased synchronously');
      assert.equal(await page.evaluate(() => /12,345|已按你提供的/.test(document.body.textContent)), false);
      await fixture.captureSnapshot(`portfolio-cash-reset-hidden-${operation}`);
    }
    assert.equal(fixture.externalRequests.length, 0);
  } catch (error) { await fixture.captureFailure('portfolio-plan-risk'); throw error; }
  finally { await fixture.close(); }
});
