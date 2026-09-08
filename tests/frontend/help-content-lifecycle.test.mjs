import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppWindow } from '../helpers/dom-harness.mjs';

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());
const open = () => app.doc.getElementById('glossaryOpen').click();
const close = () => app.doc.getElementById('glossaryClose').click();
const cat = value => app.doc.querySelector(`[data-glossary-cat="${value}"]`).click();
const search = value => {
  const input = app.doc.getElementById('glossarySearch');
  input.value = value;
  input.dispatchEvent(new app.win.Event('input', { bubbles: true }));
};

test('分類內查無但其他分類有說明時，明講篩選範圍並提供全部分類入口', () => {
  open();
  cat('技術指標');
  search('自選股');
  const empty = app.doc.querySelector('.glossary-empty');
  assert.match(empty.textContent, /技術指標/);
  const recover = empty.querySelector('button[data-glossary-cat=""]');
  assert.ok(recover, '不能要使用者自己猜是分類擋住結果');
  recover.focus();
  recover.click();
  assert.equal(app.doc.getElementById('glossarySearch').value, '自選股');
  assert.match(app.doc.getElementById('glossaryBody').textContent, /自選股（畫面）/);
  assert.equal(app.doc.activeElement, app.doc.querySelector('#glossaryCats .is-active'));
  search('<img src=x onerror=alert(1)>未收錄');
  assert.equal(app.doc.querySelector('#glossaryBody img'), null);
  assert.equal(app.doc.querySelector('.glossary-empty button'), null);
  close();
});

test('重新搜尋、切分類與重新開啟時，說明從內容起點開始', () => {
  open();
  const body = app.doc.getElementById('glossaryBody');
  body.scrollTop = 600;
  cat('看盤基礎');
  assert.equal(body.scrollTop, 0);
  body.scrollTop = 600;
  search('量');
  assert.equal(body.scrollTop, 0);
  body.scrollTop = 600;
  close();
  open();
  assert.equal(body.scrollTop, 0);
  close();
});

test('未知名詞入口以該詞查詢並說明查無，不能默默顯示不相干的整份名詞表', () => {
  const host = app.doc.createElement('div');
  host.innerHTML = app.evalIn('glossLink("測試未知詞", "尚未收錄的測試指標")');
  app.doc.body.append(host);
  try {
    host.querySelector('[data-glossary-term]').click();
    assert.equal(app.doc.getElementById('glossarySearch').value, '尚未收錄的測試指標');
    assert.match(app.doc.querySelector('.glossary-empty')?.textContent || '', /尚未收錄的測試指標/);
    assert.equal(app.doc.querySelectorAll('#glossaryBody dt').length, 0);
  } finally { close(); host.remove(); }
});

test('既有名詞連結、指標映射與七頁入口都有對應說明', () => {
  const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  const staticTerms = [...source.matchAll(/glossLink\(\s*(["'])(.*?)\1(?:\s*,\s*(["'])(.*?)\3)?\s*\)/g)].map(match => match[4] || match[2]);
  const mappedTerms = JSON.parse(app.evalIn('JSON.stringify([...Object.values(METRIC_GLOSS_TERMS), ...Object.values(SCREEN_HELP_TERMS)])'));
  for (const term of new Set([...staticTerms, ...mappedTerms])) {
    assert.ok(app.evalIn(`findGlossaryIndex(${JSON.stringify(term)})`) >= 0, `缺少 ${term} 說明`);
  }
});
