// 手機固定導覽真實 200% 文字：所有七標籤、邊界與內容底部留白。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';
test('T11 navigation labels remain distinct at 375px and 200% text', {timeout:90000},async()=>{
 const f=await createBrowserFixture({scenario:'populated'});try{
  const {page}=f;await page.setViewportSize({width:375,height:1000});await f.emulateTextZoom(2,['.bottom-nav .nav-label-wide']);
  await f.captureSnapshot('t11-nav-before-or-after-375-text200');
  const geometry=await page.locator('.bottom-nav .nav-label-wide').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,text:n.textContent};}));
  assert.equal(geometry.length,7);for(const [i,r]of geometry.entries()){assert.ok(r.width>0&&r.height>0);assert.ok(r.left>=0&&r.right<=375,JSON.stringify(r));for(const other of geometry.slice(i+1))assert.ok(r.right<=other.left||other.right<=r.left||r.bottom<=other.top||other.bottom<=r.top,JSON.stringify({r,other}));}
  await visibleNav(page,'more').click();await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  const b=await page.evaluate(()=>({nav:document.querySelector('.bottom-nav').getBoundingClientRect().top,last:document.querySelector('[data-screen-panel="more"]').getBoundingClientRect().bottom}));assert.ok(b.last<=b.nav+1,JSON.stringify(b));
  for(const width of [375,768,1280,1440])for(const factor of [1,2]){
   await page.setViewportSize({width,height:1000});const selector=width<1040?'.bottom-nav .nav-label-wide':'.rail-nav .nav-action span';await f.emulateTextZoom(factor,[selector]);
   const rects=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height};}));
   assert.equal(rects.length,7);for(const [i,r]of rects.entries()){assert.ok(r.w>0&&r.h>0&&r.l>=0&&r.r<=width&&r.t>=0&&r.b<=1000,JSON.stringify({width,factor,r}));for(const x of rects.slice(i+1))assert.ok(r.r<=x.l||x.r<=r.l||r.b<=x.t||x.b<=r.t,JSON.stringify({width,factor,r,x}));}
   await f.captureSnapshot(`t11-nav-${width}-text${factor*100}`);
  }
 }catch(e){await f.captureFailure('t11-review');throw e;}finally{await f.close();}
});
test('T11 quote header semantics and displayed OHLC stay aligned with zoom and period', {timeout:60000},async()=>{
 const f=await createBrowserFixture({scenario:'populated'});try{
  const {page}=f;await page.setViewportSize({width:375,height:1000});await visibleNav(page,'screener').click();
  const header=page.locator('[data-screen-panel=screener] [role=columnheader]').filter({has:page.locator('[data-sort=price]')});await header.locator('button').click();assert.equal(await header.getAttribute('aria-sort'),'descending');
  const table=page.locator('[data-screen-panel=screener] [role=table]');assert.ok(await table.locator('[role=row] [role=cell]').count()>0);assert.match(await table.ariaSnapshot(),/columnheader/);
  const candles=Array.from({length:40},(_,i)=>({date:new Date(Date.now()-(40-i)*86400000).toISOString().slice(0,10).replaceAll('-',''),open:100+i,high:103+i,low:99+i,close:102+i,volume:1000,volumeLots:1000,maShort:100,maMid:100,macd:{dif:1,dea:1,histogram:0}}));
  await page.route('**/api/technical-analysis?**',route=>{const period=new URL(route.request().url()).searchParams.get('period');return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,code:'2330',name:'台積電',period,candles:period==='week'?candles.slice(-24):candles,signals:{checks:{},risks:[]},trendLines:{},fibonacci:{active:false},corporateActions:{events:[],notes:[]}})});});
  await visibleNav(page,'technical').click();await page.locator('#technicalCode').fill('2330');await page.locator('#technicalForm [type=submit]').click();await page.locator('#technicalOhlc tbody tr').first().waitFor({state:'attached'});
  const summary=page.locator('#technicalOhlc > summary');await summary.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#technicalOhlc tbody tr').count(),40);
  await page.locator('[data-analysis-period=week]').click();await page.waitForFunction(()=>document.querySelectorAll('#technicalOhlc tbody tr').length===24);assert.match(await page.locator('#technicalOhlc').textContent(),/週/);
  await page.locator('#technicalZoomOpen').click();await page.locator('#zoomChartHelp').waitFor({state:'visible'});await page.locator('#zoomChartHelpClose').click();const zoom=page.locator('#zoomOhlc > summary');await zoom.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#zoomOhlc tbody tr').count(),24);
  await page.locator('#zoomChartClose').focus();await page.keyboard.press('+');await page.waitForFunction(()=>document.querySelectorAll('#zoomOhlc tbody tr').length<24);
  const actual=await page.evaluate(()=>({rows:[...document.querySelectorAll('#zoomOhlc tbody tr')].map(row=>[...row.children].map(cell=>cell.textContent)),expected:zoomChartState.geometry.candles.slice(zoomChartState.geometry.viewStart,zoomChartState.geometry.viewEnd+1).map(c=>[c.date.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1/$2/$3'),...['open','high','low','close'].map(k=>String(c[k]))])}));assert.deepEqual(actual.rows,actual.expected);
  await page.waitForFunction(()=>!document.querySelector('#toastStack .toast'),null,{timeout:7000});await f.captureSnapshot('t11-ohlc-mobile');await page.keyboard.press('r');await page.waitForFunction(()=>document.querySelectorAll('#zoomOhlc tbody tr').length===24);assert.equal(await page.locator('#zoomOhlc tbody tr').count(),24);
  await f.emulateTextZoom(2,['#zoomOhlc th']);await page.locator('#zoomChartClose').hover();const reader=page.locator('#zoomOhlc .ohlc-scroller');await reader.focus();
  await page.evaluate(()=>document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')window.__ohlcArrowPrevented=e.defaultPrevented;}));
  assert.equal(await reader.evaluate(n=>n.scrollWidth>n.clientWidth),true);await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.__ohlcArrowPrevented),false,'OHLC reader must retain native horizontal keyboard scrolling');await page.waitForFunction(()=>document.querySelector('#zoomOhlc .ohlc-scroller').scrollLeft>0);
  const occlusion=await reader.evaluate(n=>{const r=n.getBoundingClientRect(),readout=document.querySelector('#zoomChartReadout'),s=getComputedStyle(readout),o=readout.getBoundingClientRect();return !readout.hidden&&s.visibility==='visible'&&s.display!=='none'&&o.right>r.left&&o.left<r.right&&o.bottom>r.top&&o.top<r.bottom;});assert.equal(occlusion,false,'focused OHLC table must not be visually covered by chart readout');
  await f.captureSnapshot('t11-ohlc-mobile-text200');assert.equal(await page.evaluate(()=>window.__stock1BrowserTextZoom.running===null),true,'zoom and chart resize observers settle');await page.locator('#zoomChartClose').focus();assert.equal(await page.locator('#zoomChartReadout').evaluate(n=>getComputedStyle(n).visibility),'visible');await page.keyboard.press('Escape');assert.equal(await page.locator('#technicalZoomModal').isVisible(),false);
 }catch(e){await f.captureFailure('t11-ohlc');throw e;}finally{await f.close();}
});
test('T11 plan partial fills, review, source correction and no-entry work on mobile and keyboard', {timeout:120000},async()=>{
 const f=await createBrowserFixture({scenario:'populated'});try{
  const {page,server}=f;let payload={ok:true,schemaVersion:1,rev:0,plans:[]};
  const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10).replaceAll('-','');
  let ledger=server.mod.normalizeTradesPayload({schemaVersion:2,settings:{feeDiscount:.6,minFee:20},records:[['b','buy',400,100],['s1','sell',100,110],['s2','sell',300,110]].map(([id,side,shares,price])=>({id,code:'6488',market:'TWSE',brokerAccountId:'default',instrumentType:'stock',side,shares,price,date:day,executedAt:'',dayTrade:{status:'none',matchedShares:0},session:'regular',fee:20,tax:0,feeSource:'manual',taxSource:'manual'}))});
  await page.route('**/api/trades',async route=>{if(route.request().method()==='PUT')ledger=server.mod.normalizeTradesPayload(route.request().postDataJSON());await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,rev:1,...ledger,portfolio:server.mod.buildPortfolio(ledger)})});});
  await page.route('**/api/trade-plans',async route=>{
   if(route.request().method()==='PUT')try{payload={ok:true,rev:payload.rev+1,...server.mod.canonicalizeTradePlans(route.request().postDataJSON(),payload,{records:ledger.records})};}catch(error){await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({ok:false,error:error.message})});return;}
   await route.fulfill({contentType:'application/json',body:JSON.stringify({...payload,linkEvidence:server.mod.buildTradePlanLinkEvidence(payload,ledger.records)})});
  });
  await page.evaluate(()=>loadTradesFromServer());await page.setViewportSize({width:375,height:1000});
  await visibleNav(page,'strategy').click();await page.locator('.swing-open').first().click();await page.locator('#detailPanel [data-trade-plan-open]').click();
  const form=page.locator('#tradePlanForm');await form.waitFor({state:'visible'});
  for(const [key,value]of Object.entries({entryPrice:'100',stopPrice:'95',targetPrice:'120',quantity:'1000',expiresOn:new Date(Date.now()+7*86400000).toISOString().slice(0,10)}))await form.locator(`[name=${key}]`).fill(value);
  await form.locator('[name=status]').selectOption('active');
  const save=async()=>{const old=payload.rev;await form.locator('[type=submit]').click();await page.waitForFunction(rev=>tradePlansState.rev>rev,old);};await save();
  const reviewSummary=form.locator('.trade-plan-review-fields > summary');await reviewSummary.focus();await page.keyboard.press('Enter');assert.equal(await reviewSummary.evaluate(n=>n.parentElement.open),true);
  const link=async(id,shares)=>{await form.locator('[name=linkTradeId]').selectOption(id);await form.locator('[name=linkShares]').fill(String(shares));await form.locator('[data-trade-link-add]').click();await save();};
  await link('b',400);assert.equal(payload.plans[0].tradeLinks[0].allocatedShares,400);await link('s1',100);await link('s2',300);
  await form.locator('[name=status]').selectOption('closed');await form.locator('[name=reviewDecision]').selectOption('conditions-changed');await form.locator('[name=reviewReason]').fill('條件變了，先檢查資料與成本');await save();
  const comparison=page.locator('.trade-plan-comparison > summary');await comparison.focus();await page.keyboard.press('Enter');
  assert.match(await page.locator('#tradePlanEvidence').textContent(),/完整計畫報酬與 netR：未知/);
  assert.equal(await form.locator('[name=stopPrice]').isDisabled(),true);assert.equal(await form.locator('[name=reviewReason]').isEnabled(),true);
  // 尺寸巡檢從獨立的計畫列表開啟，避免切換桌面斷點時既有手機詳情父層關閉。
  await page.locator('[data-trade-plan-close]').click();await page.keyboard.press('Escape');await visibleNav(page,'watchlist').click();
  await page.locator('[data-trade-plan-open=list]').click();await page.locator('.trade-plan-existing > summary').click();await page.locator('[data-trade-plan-edit]').first().click();
  await comparison.click();if(!await reviewSummary.evaluate(n=>n.parentElement.open))await reviewSummary.click();
  assert.ok(await page.locator('#toastStack [data-toast-key=trade-plan-saved]').count()<=1);
  await page.locator('#toastStack [data-toast-key=trade-plan-saved]').waitFor({state:'detached',timeout:7000});
  for(const width of [375,768,1280,1440])for(const factor of [1,2]){
   await page.setViewportSize({width,height:1000});await f.emulateTextZoom(factor,['#tradePlanForm [name=reviewReason]']);
   const boxes=await page.locator('#tradePlanModal input:visible,#tradePlanModal select:visible,#tradePlanModal textarea:visible,#tradePlanModal button:visible').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};}));
   assert.ok(boxes.length>=18,JSON.stringify({count:boxes.length,open:await reviewSummary.evaluate(n=>n.parentElement.open)}));for(const r of boxes){assert.ok(r.width>0&&r.height>=44,JSON.stringify(r));assert.ok(r.left>=0&&r.right<=width+1,JSON.stringify({width,factor,r}));}
   assert.ok(await form.evaluate(n=>n.scrollWidth<=n.clientWidth+1),JSON.stringify({width,factor,overflow:await form.evaluate(n=>[...n.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>n.getBoundingClientRect().right+1).map(x=>({tag:x.tagName,cls:x.className,text:x.textContent.slice(0,35),font:getComputedStyle(x).fontSize,width:x.getBoundingClientRect().width})).slice(0,12))}));await comparison.scrollIntoViewIfNeeded();await f.captureSnapshot(`t11-review-${width}-text${factor*100}`);
   if(width===375&&factor===2){await page.locator('.trade-plan-compare-grid section').last().scrollIntoViewIfNeeded();await f.captureSnapshot('t11-review-cash-375-text200');await form.locator('[name=reviewReason]').scrollIntoViewIfNeeded();await f.captureSnapshot('t11-review-form-375-text200');}
  }
  await f.emulateTextZoom(1,[]);await page.setViewportSize({width:375,height:1000});
  await page.evaluate(()=>updateTradeRecord('b',{price:101},{successMessage:'修正測試'}));
  assert.match(await page.locator('#tradePlanEvidence').textContent(),/成交已修正，關聯失效/);
  await form.locator('[data-trade-link-remove=b]').click();await save();assert.equal(payload.plans[0].tradeLinks.length,2);
  await link('b',400);assert.equal(payload.plans[0].status,'closed');assert.equal(payload.plans[0].tradeLinks.at(-1).snapshot.price,101);
  await page.locator('[data-trade-plan-new]').click();await form.locator('[name=code]').fill('2330');await form.locator('[name=strategy]').selectOption('overnight');await save();
  await form.locator('[name=status]').selectOption('cancelled');if(!await reviewSummary.evaluate(n=>n.parentElement.open))await reviewSummary.click();
  await form.locator('[name=reviewDecision]').selectOption('no-entry');await form.locator('[name=reviewReason]').fill('PRIVATE_NO_ENTRY 開盤條件不符');await save();assert.equal(payload.plans[1].tradeLinks.length,0);
  await page.locator('[data-trade-plan-close]').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#tradePlanModal').isVisible(),false);
  await page.evaluate(()=>activateAuthenticatedUser({id:'other-account',username:'other'}));assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_NO_ENTRY/);
  assert.equal(await page.locator('#tradePlanLinkDraft').textContent(),'');assert.equal(await form.locator('[name=linkTradeId] option').count(),0);
 }catch(e){await f.captureFailure('t11-plan-review');throw e;}finally{await f.close();}
});


test('T11 quote buttons reopen after Escape and retain identity through real polling', {timeout:60000},async()=>{
 const f=await createBrowserFixture({scenario:'populated'});try{
  const {page}=f;await page.setViewportSize({width:375,height:900});
  for(const screen of ['screener','watchlist']){
   await visibleNav(page,screen).click();const button=page.locator(`[data-screen-panel=${screen}] .quote-stock-open`).first();await button.waitFor();const code=await button.getAttribute('data-code');
   const open=async()=>{await button.focus();await page.keyboard.press('Enter');await page.locator('#detailPanel.is-open').waitFor({state:'visible'});};
   const close=async()=>{await page.keyboard.press('Escape');await page.locator('#detailPanel.is-open').waitFor({state:'detached'});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await button.evaluate(n=>n===document.activeElement),true,JSON.stringify(await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role'),code:document.activeElement.dataset.code}))));};
   await open();await close();await open();
   await page.evaluate(selector=>window.__quoteOpenerBeforePoll=document.querySelector(selector),`[data-screen-panel=${screen}] .quote-stock-open[data-code="${code}"]`);await f.advancePollingCycle();assert.equal(await page.evaluate(()=>window.__quoteOpenerBeforePoll.isConnected),false);await close();
   await button.locator('xpath=ancestor::*[@role="row"]').locator('.stock-cell').last().click();await page.locator('#detailPanel.is-open').waitFor({state:'visible'});await close();
  }
 }catch(e){await f.captureFailure('t11-fix1-quote-focus');throw e;}finally{await f.close();}
});
