// 固定候選池明細：真實Chromium四尺寸/200%文字、原生details與輪詢焦點。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';
test('兩成績單候選池分母、未知與固定期間明細於四尺寸及200%可讀', {timeout:120000}, async()=>{
  const fixture=await createBrowserFixture({scenario:'populated'});
  try {
    const {page}=fixture;
    for(const [strategy,url] of [['swing','/api/swing/verify'],['overnight','/api/overnight/verify/history']]) {
      const payload=await page.evaluate(async url=>(await fetch(url)).json(),url);
      const model={modelKey:strategy+'-full-fixed-model',horizon:strategy==='swing'?'next-open-to-session-15-close':'signal-close-to-next-close',benchmarkSpec:{version:'frozen-pool-fixed-price-v1'},
        pairedCount:2,eligibleCount:3,pairedDays:1,eligibleDays:1,strategyMean:3,benchmarkMean:2,meanDifference:1};
      payload.benchmarks={window:{asOf:'2026-09-07',allModels:true,limit:260,includedCaptures:1,availableCaptures:1,fromDate:'2026-08-03',throughDate:'2026-08-03'},models:[model],cohorts:[{...model,captureId:'frozen',tradeDate:'20260803',status:'pending',cursor:4,reason:'pool-evidence-incomplete',
        poolCoverage:{TWSE:{eligibleCount:4,validCount:4,status:'complete',period:strategy==='swing'?{entryDate:'20260804',exitDate:'20260824'}:{entryDate:'20260803',exitDate:'20260804'},missingReasons:[]},TPEx:{eligibleCount:5,validCount:4,status:'unavailable',missingReasons:['official-session-price-missing']}},
        missingReasons:{'pool-incomplete':1},paired:[{timing:strategy==='swing'?'timing-uncertain':'close-observation-not-executable'}]}]};
      await page.route('**'+url,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
    }
    for(const screen of ['strategy','overnight']) {
      await visibleNav(page,screen).click();if(screen==='overnight')await page.locator('[data-overnight-view="performance"]').click();
      const panel=page.locator(screen==='strategy'?'#swingVerify':'.verify-history');
      const outer=panel.locator('.verification-denominators');await outer.locator(':scope > summary').focus();await page.keyboard.press('Enter');
      const region=panel.locator('.verification-benchmark'),fold=region.locator('details');
      await fold.locator(':scope > summary').focus();await page.keyboard.press('Enter');
      assert.equal(await fold.evaluate(n=>n.open),true);assert.match(await region.textContent(),/配對訊號 2\/3/);assert.match(await region.textContent(),/4\/5 檔/);assert.match(await region.textContent(),/1\.00 個百分點/);
      assert.match(await region.textContent(),/跨模型最多 260/);assert.match(await region.textContent(),/有效日期 1\/1/);
      assert.match(await region.textContent(),screen==='strategy'?/無法證明開盤前可得/:/20260803 → 20260804/);
      if(screen==='overnight'){await fixture.advancePollingCycle();assert.equal(await fold.evaluate(n=>n.open),true);assert.equal(await fold.locator(':scope > summary').evaluate(n=>n===document.activeElement),true);}
      for(const width of [375,768,1280,1440])for(const factor of [1,2]) {
        await page.setViewportSize({width,height:1000});await fixture.emulateTextZoom(factor,[`${screen==='strategy'?'#swingVerify':'.verify-history'} .verification-benchmark summary`]);
        const bounds=await region.evaluate(n=>{const r=n.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,scroll:n.scrollWidth,client:n.clientWidth};});
        assert.ok(bounds.width>0);assert.ok(bounds.left>=-1&&bounds.right<=width+1);assert.ok(bounds.scroll<=bounds.client+1);
        await region.scrollIntoViewIfNeeded();await fixture.captureSnapshot(`benchmark-${screen}-${width}-text${factor*100}`);
      }
      await fixture.emulateTextZoom(1,[]);await fold.locator(':scope > summary').focus();await page.keyboard.press('Enter');
      assert.equal(await fold.evaluate(n=>n.open),false);assert.equal(await fold.locator(':scope > summary').evaluate(n=>n===document.activeElement),true);
    }
  }catch(error){await fixture.captureFailure('verification-benchmark');throw error;}finally{await fixture.close();}
});
