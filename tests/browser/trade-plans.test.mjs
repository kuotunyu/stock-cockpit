// 個人計畫 Chromium：真表單、四尺寸與實際 200% 文字、鍵盤、輪詢和帳號隔離。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';
test('交易計畫在四尺寸與200%可操作，保存/移停/草稿/回焦與帳號隔離', {timeout:120000},async()=>{
 const fixture=await createBrowserFixture({scenario:'populated'});let payload={ok:true,rev:0,schemaVersion:1,plans:[]};
 try{
  const {page,server}=fixture;
  await page.route('**/api/trade-plans',async route=>{
   if(route.request().method()==='PUT'){
    const input=route.request().postDataJSON();
    try{payload={ok:true,rev:payload.rev+1,...server.mod.canonicalizeTradePlans(input,payload)};}
    catch(error){await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({ok:false,error:error.message})});return;}
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
  });
  await visibleNav(page,'strategy').click();await page.locator('.swing-open').first().click();
  const opener=page.locator('#detailPanel [data-trade-plan-open]');await opener.click();
  const modal=page.locator('#tradePlanModal'),form=page.locator('#tradePlanForm');await form.waitFor({state:'visible'});
  assert.match(await page.locator('#tradePlanEvidence').textContent(),/手動計畫/);
  await form.locator('[name=entryPrice]').fill('100');await form.locator('[name=stopPrice]').fill('95');await form.locator('[name=targetPrice]').fill('120');
  await form.locator('[name=quantity]').fill('1000');await form.locator('[name=reason]').fill('我的第一版停損');
  await form.locator('[name=expiresOn]').fill(new Date(Date.now()+86400000*7).toISOString().slice(0,10));
  await form.locator('[name=status]').selectOption('active');await form.locator('[type=submit]').click();
  await page.locator('#tradePlanEvidence').getByText(/首次保存/).waitFor({state:'attached'});
  assert.equal(payload.plans[0].activation.riskAmount,5000);
  await form.locator('[name=stopPrice]').fill('102');await form.locator('[name=reason]').fill('上移停損');await form.locator('[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#tradePlanEvidence').textContent.includes('#1'));
  assert.equal(payload.plans[0].activation.intent.stopPrice,95);assert.equal(payload.plans[0].stopPrice,102);
  await form.locator('[name=reason]').fill('未送出的私人草稿');await fixture.advancePollingCycle();
  assert.equal(await form.locator('[name=reason]').inputValue(),'未送出的私人草稿');
  const summary=form.getByText('進場區間、風險預算與失效條件',{exact:true});await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.evaluate(n=>n.parentElement.open),true);
  for(const width of [375,768,1280,1440])for(const factor of [1,2]){
   await page.setViewportSize({width,height:1000});await fixture.emulateTextZoom(factor,['#tradePlanForm [type=submit]']);
   const boxes=await modal.locator('input:visible,select:visible,textarea:visible,button:visible').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,height:n.getBoundingClientRect().height})));
   assert.ok(boxes.length>=14);for(const b of boxes){assert.ok(b.width>0&&b.height>=44);assert.ok(b.left>=0&&b.right<=width+1,JSON.stringify({width,factor,b}));}
   assert.ok(await form.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
   await form.locator('[name=stopPrice]').scrollIntoViewIfNeeded();await fixture.captureSnapshot(`trade-plans-${width}-text${factor*100}`);
  }
  await fixture.emulateTextZoom(1,[]);await modal.locator('[data-trade-plan-close]').focus();await page.keyboard.press('Escape');
  assert.equal(await modal.isVisible(),false);assert.equal(await opener.evaluate(n=>n===document.activeElement),true);
  await opener.click();assert.equal(await form.locator('[name=reason]').inputValue(),'未送出的私人草稿');
  await page.evaluate(()=>activateAuthenticatedUser({id:'different-account',username:'second'}));
  assert.equal(await modal.isVisible(),false);await opener.click();assert.equal(await form.locator('[name=reason]').inputValue(),'');
  await page.evaluate(()=>activateAuthenticatedUser({id:'browser-admin',username:'admin'}));await opener.click();
  assert.equal(await form.locator('[name=reason]').inputValue(),'未送出的私人草稿');
  await page.route('**/api/trade-plans',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({ok:false,code:'AUTH_REQUIRED',error:'登入已到期'})}));
  await form.locator('[type=submit]').click();await page.locator('#loginGate').waitFor({state:'visible'});assert.equal(await modal.isVisible(),false);
 }catch(error){await fixture.captureFailure('trade-plans');throw error;}finally{await fixture.close();}
});
