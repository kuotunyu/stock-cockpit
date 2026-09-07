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
        const holdingCoverage=metric=>({totalCount:metric.totalCount,validCount:metric.validCount,returnValidCount:metric.validCount,missingCount:metric.missingCount,unsupportedCount:0});
        const costRisk=metric=>({costSensitivity:{scenarioVersion:'additional-return-bps-v1',scenarios:[0,10,25,50].map(extraCostBps=>({extraCostBps,returnPct:{...metric,value:metric.value-extraCostBps/100}}))},
          netR:{...metric,value:i===0?1.9:null,validCount:i===0?metric.validCount:0,missingCount:i===0?metric.missingCount:metric.totalCount,validDays:i===0?metric.validDays:0,
            reason:i===0?metric.reason:'no-valid-values',missingReasons:i===0?{}:{'initial-risk-cash-missing-or-invalid':metric.validCount,...(metric.missingCount?{'complete-net-pnl-missing':metric.missingCount}:{})}}});
        if(i===0) {
          // 同組成熟現金平均 0.2%，0.25 個百分點壓力後翻負；保留原有效分母。
          model.metricCoverage.avgResultPctNet.value=0.2;model.avgResultPctNet=0.2;
          model.holdingCoverage=holdingCoverage(model.metricCoverage.avgResultPctNet);
          model.costRisk=costRisk(model.metricCoverage.avgResultPctNet);
          model.scenarios=model.scenarios.map(s=>{
            s.metricCoverage.avgResultPctNet.value=0.2;s.avgResultPctNet=0.2;
            const scoped=costRisk(s.metricCoverage.avgResultPctNet);
            return {...s,costRisk:scoped,byRegime:{unknown:{costRisk:scoped}},withPeriodicCall:{costRisk:scoped}};
          });
        } else {
          // 開盤1/20、收盤20/20與各自原始含息平均一致，不互借有效樣本。
          model.costRisk={open:costRisk(model.metricCoverage.avgOpenReturnNet),close:costRisk(model.metricCoverage.avgCloseReturnNet)};
          model.holdingCoverage={open:holdingCoverage(model.metricCoverage.avgOpenReturnNet),close:holdingCoverage(model.metricCoverage.avgCloseReturnNet)};
          model.byRegime={unknown:{costRisk:model.costRisk}};
        }
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
      assert.match(await fold.textContent(),screen==='strategy'?/報酬率有效 38\/38/:/開盤.*報酬率有效 1\/20.*收盤.*報酬率有效 20\/20/s);
      assert.match(await fold.textContent(),/補充保費/);
      assert.match(await fold.textContent(),screen==='strategy'?/額外 25 bps.*▼0.05%/s:/額外 25 bps.*▼0.72%/s);
      assert.match(await fold.textContent(),screen==='strategy'?/1.90R/:/事後 netR.*未定義/s);
      // 在文字放大 fixture 加入暫時 data-browser-text-zoom 前驗原生焦點身分。
      const strata=fold.locator('details').first();
      await strata.locator(':scope > summary').focus();await page.keyboard.press('Enter');
      assert.equal(await strata.evaluate(n=>n.open),true);assert.ok(await strata.locator('.verification-cost-risk:visible').count()>0);
      if(screen==='overnight') {
        await fixture.advancePollingCycle();
        assert.equal(await fold.evaluate(n=>n.open),true);assert.equal(await strata.evaluate(n=>n.open),true);
        assert.equal(await strata.locator(':scope > summary').evaluate(n=>n===document.activeElement),true);
        await fixture.captureSnapshot('cost-risk-overnight-after-refresh');
      }
      await page.keyboard.press('Enter');assert.equal(await strata.evaluate(n=>n.open),false);
      for(const width of [375,768,1280,1440])for(const factor of [1,2]) {
        await page.setViewportSize({width,height:1000});
        await fixture.emulateTextZoom(factor,[`${screen==='strategy'?'#swingVerify':'.verify-history'} .verification-denominators > summary`]);
        const boxes=await panel.locator('.verification-measurement,.verification-model,.verification-cost-risk:visible').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,scroll:n.scrollWidth,client:n.clientWidth})));
        assert.ok(boxes.length>1);for(const b of boxes){assert.ok(b.width>0);assert.ok(b.left>=-1&&b.right<=width+1);assert.ok(b.scroll<=b.client+1);}
        await panel.locator('.verification-measurement').scrollIntoViewIfNeeded();
        await fixture.captureSnapshot(`holding-${screen}-${width}-text${factor*100}`);
        await panel.locator('.verification-cost-risk:visible').first().scrollIntoViewIfNeeded();
        await fixture.captureSnapshot(`cost-risk-${screen}-${width}-text${factor*100}`);
      }
      await fixture.emulateTextZoom(1,[]);await summary.focus();await page.keyboard.press('Enter');
      assert.equal(await fold.evaluate(n=>n.open),false);assert.equal(await summary.evaluate(n=>n===document.activeElement),true);
    }
  } catch(error){await fixture.captureFailure('holding-model');throw error;} finally{await fixture.close();}
});
