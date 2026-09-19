// 第二輪實際使用回歸：中等桌面標題與手機捷徑不應被擠壓或藏於設定。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';

test('七頁標題在各寬度完整且頂欄控制項不重疊', {timeout:120000}, async()=>{
  const f=await createBrowserFixture({scenario:'populated'});
  try {
    for(const width of [1280,1040,1100,1366,1440,390]) {
      await f.page.setViewportSize({width,height:900});
      for(const screen of ['watchlist','overnight','screener','strategy','technical','surveillance','more']) {
        await visibleNav(f.page,screen).click();
        const geometry=await f.page.evaluate(()=>{
          const title=document.querySelector('#screenTitle'), r=title.getBoundingClientRect();
          const nodes=[...document.querySelector('.topbar').children].filter(n=>n.getBoundingClientRect().width>0);
          const rects=nodes.map(n=>n.getBoundingClientRect());
          return {height:r.height,font:parseFloat(getComputedStyle(title).fontSize),width:r.width,scroll:title.scrollWidth,
            overlap:rects.some((a,i)=>rects.slice(i+1).some(b=>a.left<b.right-1 && b.left<a.right-1 && a.top<b.bottom-1 && b.top<a.bottom-1))};
        });
        assert.ok(geometry.height<geometry.font*2,`${width}/${screen}: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.width>=geometry.scroll-1,`${width}/${screen}: 標題裁切`);
        assert.equal(geometry.overlap,false,`${width}/${screen}: 重疊`);
      }
      if([390,1280].includes(width)) await f.captureSnapshot(`review-header-${width}`);
    }
  } catch(e) {await f.captureFailure('review-layout');throw e;} finally {await f.close();}
});

test('健檢毛淨值與庫存小樣本在手機及桌面可讀', {timeout:120000},async()=>{
  const f=await createBrowserFixture({scenario:'populated'});
  try {
    const {page}=f;
    for(const width of [390,1280]) {
      await page.setViewportSize({width,height:844});await visibleNav(page,'strategy').click();
      await page.evaluate(()=>{
        const host=document.querySelector('#strategyInspectResult');host.hidden=false;
        strategyInspectState.data={code:'2330',name:'台積電',market:'上市',price:2460,changePct:1.2,asOf:'2026-09-18',rr:1.3,verdict:{status:'near',name:'上軌續攻',failCount:2},scenarios:[],plan:{entry:2460,initialStop:2335,structuralStop:2410,target:2525,trailingTrigger:2585,rrNet:0.87}};strategyInspectState.loading=false;strategyInspectState.error='';renderStrategyInspect();
      });
      const rr=page.locator('.inspect-card .swing-rr');
      await rr.scrollIntoViewIfNeeded();
      assert.match(await rr.innerText(),/毛 1\.3／淨 0\.87/);
      assert.equal(await rr.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,`${width} 盈虧比不裁切`);
      await f.captureSnapshot(`review-inspect-${width}`);
      await visibleNav(page,'watchlist').click();
      await page.evaluate(()=>{
        state.watchList='hold';tradesState.records=[{id:'r1',code:'2330',side:'sell',date:'20260904',price:2450,shares:40}];tradesState.loaded=true;holdingsPlanRiskState.loadAttempted=true;
        tradesState.portfolio={holdings:[{code:'2330',shares:60,avgCost:2400,cost:144000}],totals:{cost:144000}};
        stocks.find(s=>s.code==='2330') && Object.assign(stocks.find(s=>s.code==='2330'),{price:2460,previousClose:2425,asOf:'2026-09-18'});
        tradesState.scorecard={minTrades:20,overall:{trades:1,winRate:100},months:[{key:'202609',trades:1,winRate:100,realizedPnl:1540,fees:84,taxes:294}],years:[]};
        renderHoldingsPanel();
      });
      const score=page.locator('[data-holdings-scorecard-fold]');if(!await score.evaluate(n=>n.open)) await score.locator('summary').click();
      assert.match(await score.locator('tbody').innerText(),/100%（1\/20 筆・樣本不足）/);
      if(width===390) {
        const help=page.locator('[data-holding-quote-help]');await help.locator('summary').click();
        assert.match(await help.innerText(),/非帳戶當日總損益/);
        assert.ok((await help.boundingBox()).width>300,'說明應有完整手機欄寬');
        await page.locator('.hold-strip').scrollIntoViewIfNeeded();
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await f.captureSnapshot(`review-holdings-${width}`);
    }
  } catch(e) {await f.captureFailure('review-metrics');throw e;} finally {await f.close();}
});

test('手機更多兩步抵達看盤頁，五七籤切換保留當前頁', {timeout:120000},async()=>{
  const f=await createBrowserFixture({scenario:'populated'});
  try {
    const {page}=f;await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{localStorage.setItem('stock1.navTabs.v1','5');applyNavTabsMode();});
    await visibleNav(page,'watchlist').click();await visibleNav(page,'more').click();
    const shortcuts=page.locator('.more-screen-shortcuts');
    assert.equal(await shortcuts.isVisible(),true);
    await shortcuts.locator('[data-go-screen=surveillance]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#screenTitle').innerText(),'處置看板');
    await visibleNav(page,'more').click();
    await shortcuts.locator('[data-go-screen=screener]').focus();await page.keyboard.press('Space');
    assert.equal(await page.locator('#screenTitle').innerText(),'盤中選股');
    await page.evaluate(()=>{localStorage.setItem('stock1.navTabs.v1','7');applyNavTabsMode();});
    assert.equal(await page.locator('.bottom-nav .nav-action:visible').count(),7);
    assert.equal(await page.locator('#screenTitle').innerText(),'盤中選股');
    await page.evaluate(()=>{localStorage.setItem('stock1.navTabs.v1','5');applyNavTabsMode();});
    assert.equal(await page.locator('#screenTitle').innerText(),'盤中選股');
    await visibleNav(page,'more').click();await f.captureSnapshot('review-more-390');
  } catch(e) {await f.captureFailure('review-more');throw e;} finally {await f.close();}
});

test('200% 真實字級的頂欄與來源浮層可操作', {timeout:120000},async()=>{
  const f=await createBrowserFixture({scenario:'populated'});
  try {
    const {page}=f;
    for(const width of [1040,1280,390]) {
      await page.setViewportSize({width,height:900});await visibleNav(page,'technical').click();
      await f.emulateTextZoom(2,['#screenTitle']);
      const out=await page.evaluate(()=>{
        const t=document.querySelector('#screenTitle'),r=t.getBoundingClientRect();
        const controls=[...document.querySelectorAll('.topbar > *')].map(n=>n.getBoundingClientRect()).filter(r=>r.width>0);
        return {width:r.width,scroll:t.scrollWidth,height:r.height,font:parseFloat(getComputedStyle(t).fontSize),
          overlap:controls.some((a,i)=>controls.slice(i+1).some(b=>a.left<b.right-1 && b.left<a.right-1 && a.top<b.bottom-1 && b.top<a.bottom-1)),
          overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(out.overlap,false,`${width}: ${JSON.stringify(out)}`);
      assert.ok(out.height<out.font*2 && out.width>=out.scroll-1,`${width}: 標題不可裁切`);
      assert.equal(out.overflow,false);
      const height=await page.locator('.topbar').evaluate(n=>n.getBoundingClientRect().height);
      await page.locator('#sourcePill').click();
      assert.equal(await page.locator('#sourceSwitchButtons').isVisible(),true);
      assert.equal(await page.locator('.topbar').evaluate(n=>n.getBoundingClientRect().height),height);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#sourceSwitchButtons').isVisible(),false);
      await f.captureSnapshot(`review-header-${width}-200`);
      await f.emulateTextZoom(1,['#screenTitle']);
    }
  } catch(e) {await f.captureFailure('review-200');throw e;} finally {await f.close();}
});
