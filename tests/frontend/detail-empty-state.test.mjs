// 無股票詳情區分真正等待、離線失敗與已完成空資料，保留有效股票與價格樣式契約。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

test('無股票詳情不在失敗或空資料時宣稱仍在抓報價', async () => {
  const app = await createAppWindow();
  try {
    app.evalIn(`stocks.splice(0); state.selectedCode=''; Object.assign(dataState, {loadedOnce:false, error:''}); renderDetail();`);
    assert.match(app.doc.getElementById('detailName').textContent, /載入中/);
    assert.match(app.doc.getElementById('detailTags').textContent, /正在抓官方報價/);
    app.evalIn(`Object.assign(dataState, {error:'offline <img src=x onerror=alert(1)>'}); renderDetail();`);
    assert.match(app.doc.getElementById('detailName').textContent, /行情載入失敗/);
    assert.doesNotMatch(app.doc.getElementById('detailTags').textContent, /正在抓|載入中/);
    assert.equal(app.doc.getElementById('detailTags').querySelector('img'), null);
    app.evalIn(`Object.assign(dataState, {loadedOnce:true, error:''}); document.getElementById('priceHero').classList.add('is-up','is-down','is-flat','is-stale'); renderDetail();`);
      assert.match(app.doc.getElementById('detailName').textContent, /尚無.*資料/);
      assert.doesNotMatch(app.doc.getElementById('detailTags').textContent, /正在抓|載入中/);
      assert.equal(app.doc.getElementById('detailPrice').textContent, '--');
      assert.equal(app.doc.getElementById('detailChange').textContent, '');
      assert.ok(!/is-up|is-down|is-flat|is-stale/.test(app.doc.getElementById('priceHero').className));
    app.evalIn(`Object.assign(dataState, {loadedOnce:false, error:''}); renderDetail();`);
    assert.match(app.doc.getElementById('detailName').textContent, /載入中/);
    app.evalIn(`upsertStockFromQuote({code:'2330',name:'有效既有資料',price:100,changePct:1,exchange:'TWSE'}); state.selectedCode='2330'; dataState.error='offline'; renderDetail();`);
    assert.match(app.doc.getElementById('detailName').textContent, /有效既有資料/);
    assert.notEqual(app.doc.getElementById('detailPrice').textContent, '--');
    await app.settle();
  } finally { app.cleanup(); }
});
