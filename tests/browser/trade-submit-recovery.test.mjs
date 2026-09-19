// 真實點擊、焦點與持續錯誤：賣超後改合法股數只保存一筆，修正與取消仍可用。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture,visibleNav} from '../helpers/browser-fixtures.mjs';
test('交易拒絕後保留草稿，錯誤不隨 toast 消失', {timeout:120000},async()=>{
  const f=await createBrowserFixture({scenario:'populated'});
  let canonical={ok:true,schemaVersion:2,rev:1,settings:{feeDiscount:0.6,minFee:20},records:[],portfolio:{holdings:[],totals:{}}};
  try {
    const {page}=f;
    await page.route('**/api/trades',async route=>{
      const body=route.request().postDataJSON();
      if(route.request().method()==='PUT') {
        if(body.records.at(-1).shares>60) return route.fulfill({status:400,json:{error:'賣出 61 股，但當時庫存只有 60 股（賣超）。請核對成交時間與公司行動。'}});
        canonical={...body,ok:true,rev:canonical.rev+1,portfolio:{holdings:[],totals:{}}};
      }
      await route.fulfill({json:canonical});
    });
    await page.setViewportSize({width:390,height:844});
    await visibleNav(page,'watchlist').click();
    await page.locator('[data-watch-list="hold"]').click();
    const form=page.locator('[data-trade-form]');
    await form.locator('[name=code]').fill('2330');
    await form.locator('[name=side]').selectOption('sell');
    await form.locator('[name=price]').fill('2449');
    await form.locator('[name=shares]').fill('61');
    await form.locator('[name=date]').fill('2026-09-04');
    await form.locator('[data-trade-actuals] summary').click();
    await form.locator('[name=feeAmountTwd]').fill('0');
    await form.locator('button[type=submit]').click();
    await form.locator('[data-trade-form-error]:not([hidden])').waitFor();
    assert.equal(await form.locator('[name=side]').inputValue(),'sell');
    assert.equal(await form.locator('[name=price]').inputValue(),'2449');
    assert.equal(await form.locator('[name=shares]').inputValue(),'61');
    assert.equal(await form.locator('[name=feeAmountTwd]').inputValue(),'0');
    assert.equal(await page.evaluate(()=>document.activeElement.name),'shares');
    assert.equal((await page.locator('#toastStack').innerText()).trim(),'未儲存：可賣 60 股，輸入 61 股');
    // 有意等過 toast 最長 6.5 秒，驗證錯誤仍是表單的一部分。
    await page.waitForTimeout(6700);
    assert.match(await form.locator('[role=alert]').innerText(),/未儲存.*60.*61/);
    await f.captureSnapshot('review-trade-rejection-390');
    await form.locator('[name=shares]').fill('60');
    await form.locator('button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('[data-trade-form] [name=shares]').value==='');
    assert.equal(canonical.records.length,1);
    const id=canonical.records[0].id;
    await page.locator('[data-trade-edit]').click();
    await form.locator('[name=shares]').fill('61');
    await form.locator('button[type=submit]').click();
    await form.locator('[data-trade-form-error]:not([hidden])').waitFor();
    assert.equal(await form.locator('[name=shares]').inputValue(),'61');
    assert.equal(canonical.records[0].shares,60);
    assert.equal(canonical.records[0].id,id);
    await form.locator('[data-trade-edit-cancel]').click();
    assert.equal(await form.locator('[name=shares]').inputValue(),'');
    assert.equal(await form.locator('button[type=submit]').isEnabled(),true);
  } catch(e) {await f.captureFailure('trade-submit-recovery');throw e;} finally {await f.close();}
});
