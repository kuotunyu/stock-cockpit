import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const screens = {
  overnight: '隔日沖', screener: '盤中選股', strategy: '策略雷達',
  watchlist: '自選股', technical: '技術分析', surveillance: '處置看板', more: '更多',
};
const categories = ['畫面說明', '看盤基礎', '隔日沖（短線）', '策略雷達（波段）', '技術指標', '風險與制度', '成績單與決策', ''];
const clickCategory = cat => app.doc.querySelector(`[data-glossary-cat="${cat}"]`).click();
const openHelp = screen => {
  app.evalIn(`state.screen = ${JSON.stringify(screen)}`);
  app.doc.getElementById('screenHelp').focus();
  app.doc.getElementById('screenHelp').click();
};

for (const [screen, label] of Object.entries(screens)) {
  test(`${label}問號：各分類不受自動填入的頁名阻擋，重開恢復當頁說明`, () => {
    for (const category of categories) {
      openHelp(screen);
      assert.match(app.doc.getElementById('glossaryBody').textContent, new RegExp(`${label}（畫面）`));
      clickCategory(category);
      assert.equal(app.doc.getElementById('glossarySearch').value, '', '分類切換應解除系統預填搜尋');
      assert.equal(app.doc.querySelector('.glossary-empty'), null);
      const headings = [...app.doc.querySelectorAll('#glossaryBody h3')].map(node => node.textContent);
      assert.deepEqual(headings, category ? [category] : categories.filter(Boolean));
      app.evalIn('closeGlossary()');
      assert.equal(app.doc.activeElement, app.doc.getElementById('screenHelp'));
    }
  });
}

test('自行輸入的搜尋保留；重新開啟一般名詞表或名詞連結會重設篩選', () => {
  openHelp('watchlist');
  const input = app.doc.getElementById('glossarySearch');
  input.value = '量比';
  input.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  clickCategory('');
  assert.equal(input.value, '量比');
  assert.match(app.doc.getElementById('glossaryBody').textContent, /量比5/);
  clickCategory('看盤基礎');
  assert.equal(input.value, '量比');
  app.evalIn('closeGlossary()');
  app.doc.getElementById('glossaryOpen').click();
  assert.equal(input.value, '');
  assert.equal(app.doc.querySelectorAll('#glossaryBody h3').length, 7);
  app.evalIn('closeGlossary()');
  openHelp('technical');
  app.evalIn('closeGlossary()');
  const host = app.doc.createElement('div');
  host.innerHTML = app.evalIn('glossLink("量比", "量比5")');
  app.doc.body.append(host);
  host.querySelector('[data-glossary-term]').click();
  assert.equal(input.value, '');
  assert.match(app.doc.getElementById('glossaryBody').textContent, /量比5/);
  app.evalIn('closeGlossary()');
  host.remove();
});
