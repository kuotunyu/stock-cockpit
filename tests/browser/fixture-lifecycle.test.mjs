import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';

test('text zoom stays 200% after real polling replaces the measured DOM', {timeout:30000},async()=>{
 const f=await createBrowserFixture({scenario:'populated'});try{
  const {page}=f;await visibleNav(page,'strategy').click();
  const selector='#swingVerify .verification-denominators > summary';
  await page.locator(selector).waitFor();const [measurement]=await f.emulateTextZoom(2,[selector]);
  await page.evaluate(s=>window.__oldZoomNode=document.querySelector(s),selector);
  await f.advancePollingCycle();
  const evidence=await page.evaluate(s=>({replaced:!window.__oldZoomNode.isConnected,size:parseFloat(getComputedStyle(document.querySelector(s)).fontSize)}),selector);
  assert.equal(evidence.replaced,true);assert.equal(evidence.size,measurement.before*2,JSON.stringify(evidence));
  for(const factor of [1,2,1,2]){const [next]=await f.emulateTextZoom(factor,[selector]);assert.equal(next.before,measurement.before);assert.equal(next.after,measurement.before*factor);}
 }catch(e){await f.captureFailure('t11-textzoom-lifecycle');throw e;}finally{await f.close();}
});
test('late alert synchronization preserves the restored surveillance opener', {timeout:30000},async()=>{
 const f=await createBrowserFixture({scenario:'populated'});try{
  const {page}=f;await page.setViewportSize({width:375,height:900});await visibleNav(page,'surveillance').click();await page.locator('[data-surv-tab=inDisposition]').click();
  const opener=page.locator('.surv-card').first();await opener.focus();await page.keyboard.press('Enter');await page.locator('#detailPanel.is-open').waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.dataset.code==='6488');
  await page.evaluate(()=>window.__oldOpener=document.activeElement);
  let releaseResponse,requestArrived;const arrived=new Promise(resolve=>requestArrived=resolve),released=new Promise(resolve=>releaseResponse=resolve);
  await page.route('**/api/alerts',async route=>{requestArrived();await released;await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,rev:5,alerts:[]})});});
  await page.evaluate(()=>{window.__pendingAlerts=loadAlertsFromServer();});await arrived;assert.equal(await opener.evaluate(n=>n===document.activeElement),true);releaseResponse();await page.evaluate(()=>window.__pendingAlerts);
  const evidence=await page.evaluate(()=>({replaced:!window.__oldOpener.isConnected,active:document.activeElement?.tagName,code:document.activeElement?.dataset.code}));
  assert.equal(evidence.replaced,true);assert.equal(evidence.code,'6488',JSON.stringify(evidence));
  await visibleNav(page,'strategy').click();await page.locator('#strategyInspectInput').fill('尚未送出的同步草稿');await page.evaluate(()=>loadAlertsFromServer());assert.equal(await page.locator('#strategyInspectInput').inputValue(),'尚未送出的同步草稿');
 }catch(e){await f.captureFailure('t11-alert-focus-lifecycle');throw e;}finally{await f.close();}
});
