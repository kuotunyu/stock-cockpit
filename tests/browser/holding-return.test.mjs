// 含息模型的真實Chromium呈現：兩頁四尺寸/200%與原生details鍵盤。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';
test('假設含息持有兩頁四尺寸及200%：模型、缺值、成本說明完整可讀', {timeout:120000}, async()=>{
  const fixture=await createBrowserFixture({scenario:'populated'});
  try {
    const {page}=fixture;
    const payloads=await page.evaluate(async()=>Promise.all(['/api/swing/verify','/api/overnight/verify/history'].map(async url=>(await fetch(url)).json())));
    for(const [i,payload] of payloads.entries()) {
      const strategy=i===0?'swing':'overnight';
      for(const model of payload.cohort.models) {
        if(model.identity.entryModel==='next-open-price-observation')continue;
        model.identity={...model.identity,evaluationVersion:strategy+'-hypothetical-holding-v1',costModelVersion:'initial-notional-flat-0.471pct-v1',returnBasis:'cash-holding-return'};
        model.modelKey=JSON.stringify(model.identity);
        const coverage={totalCount:20,validCount:19,returnValidCount:18,missingCount:1,unsupportedCount:1};
        model.holdingCoverage=i===0?coverage:{open:coverage,close:coverage};
      }
      payload.cohort.headline=payload.cohort.models[0];
      payload.cohort.selectedModelKey=payload.cohort.headline.modelKey;
      if(i===0) payload.recent[0].holdingOutcome={netPnl:-2.1,holdingReturnPct:-2.1};
      await page.route(i===0?'**/api/swing/verify':'**/api/overnight/verify/history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
    }
    for(const screen of ['strategy','overnight']) {
      await visibleNav(page,screen).click();
      if(screen==='overnight')await page.locator('[data-overnight-view="performance"]').click();
      const panel=page.locator(screen==='strategy'?'#swingVerify':'.verify-history');
      await panel.getByText(/假設 1 股含息持有結果/).waitFor();
      const fold=panel.locator('.verification-denominators');
      const summary=fold.locator(':scope > summary');
      await summary.focus();await page.keyboard.press('Enter');assert.equal(await fold.evaluate(n=>n.open),true);
      assert.match(await fold.textContent(),/報酬率有效 18\/20/);
      assert.match(await fold.textContent(),/補充保費/);
      for(const width of [375,768,1280,1440])for(const factor of [1,2]) {
        await page.setViewportSize({width,height:1000});
        await fixture.emulateTextZoom(factor,[`${screen==='strategy'?'#swingVerify':'.verify-history'} .verification-denominators > summary`]);
        const boxes=await panel.locator('.verification-measurement,.verification-model').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,scroll:n.scrollWidth,client:n.clientWidth})));
        assert.ok(boxes.length>1);for(const b of boxes){assert.ok(b.width>0);assert.ok(b.left>=-1&&b.right<=width+1);assert.ok(b.scroll<=b.client+1);}
        await panel.locator('.verification-measurement').scrollIntoViewIfNeeded();
        await fixture.captureSnapshot(`holding-${screen}-${width}-text${factor*100}`);
      }
      await fixture.emulateTextZoom(1,[]);await summary.focus();await page.keyboard.press('Enter');
      assert.equal(await fold.evaluate(n=>n.open),false);assert.equal(await summary.evaluate(n=>n===document.activeElement),true);
    }
  } catch(error){await fixture.captureFailure('holding-model');throw error;} finally{await fixture.close();}
});
