// 真 Chromium 小型探針接線驗證；只呼叫一輪 renderer，不執行 O08 效能分組採樣。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser-fixtures.mjs';
import { captureRendererProbes, summarizeRendererProbes, RENDERER_PROBES, withExpectedFixtureDiagnostic } from '../../scripts/verification-measurement.mjs';

test('隔離 Chromium 的六個 renderer 探針均有狀態並復原函式', async () => {
  const fixture=await withExpectedFixtureDiagnostic(()=>createBrowserFixture({scenario:'populated'}),{kind:'admin'});
  try {
    const {page}=fixture;
    await page.waitForFunction(()=>!dataState.loading&&stocks.length>0&&!autoRefreshInFlight);
    await page.evaluate(()=>{autoRefreshInFlight=true;state.screen='screener';render();window.probeOriginalRows=renderRows;});
    const result=await page.evaluate(`(${captureRendererProbes.toString()})(()=>renderLiveDataUpdate(),{names:${JSON.stringify(RENDERER_PROBES)}})`);
    const parts=summarizeRendererProbes(result.parts);
    assert.deepEqual(Object.keys(parts),RENDERER_PROBES);
    assert.equal(parts.renderMarketStrip.status,'missing');
    assert.equal(parts.renderScreenerSummary.status,'missing');
    assert.equal(parts.renderWatchManager.status,'not-called');
    for(const name of ['renderRows','renderStrategies','renderDetail']) {
      assert.equal(parts[name].status,'measured');
      assert.ok(parts[name].count>0);
      assert.ok(parts[name].raw.every(Number.isFinite));
    }
    assert.equal(await page.evaluate(()=>renderRows===window.probeOriginalRows),true);
  } finally {await fixture.close();}
});
