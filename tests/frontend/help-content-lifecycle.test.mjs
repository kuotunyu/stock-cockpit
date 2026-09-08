// 七頁問號、成績單分母、帳本費稅與個人備份首頁的說明內容契約。
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

const screenHelpText = (screen, label) => {
  app.evalIn(`state.screen = ${JSON.stringify(screen)}; openScreenHelp(document.getElementById('screenHelp'))`);
  const term = [...app.doc.querySelectorAll('#glossaryBody dt')].find(node => node.textContent.includes(`${label}（畫面）`));
  assert.ok(term, `${label} 問號應定位到當頁說明`);
  const text = term.parentElement.textContent.replace(/\s+/g, ' ');
  app.evalIn('closeGlossary()');
  return text;
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

test('七頁問號各自回答用途、當前數字、限制與下一步', () => {
  const screens = {
    overnight: '隔日沖',
    screener: '盤中選股',
    strategy: '策略雷達',
    watchlist: '自選股',
    technical: '技術分析',
    surveillance: '處置看板',
    more: '更多',
  };
  for (const [screen, label] of Object.entries(screens)) {
    const text = screenHelpText(screen, label);
    for (const section of ['用途：', '當前數字：', '限制：', '下一步：']) {
      assert.match(text, new RegExp(section), `${label} 缺少「${section}」`);
    }
  }
});

test('策略說明區分已結案未成熟、逐欄有效筆數與信賴區間有效日期', () => {
  const fixture = {
    cohort: {
      headline: {
        matureCount: 1,
        immatureCount: 1,
        unknownCount: 0,
        identity: { returnBasis: 'cash-holding-return' },
        scenarios: [{
          scenario: 'midBandDefense',
          samples: 2,
          matureCount: 1,
          immatureCount: 1,
          unknownCount: 0,
          resolved: 2,
          continuousResolved: 1,
          wins: 1,
          losses: 0,
          expired: 0,
          pending: 0,
          winRateMinSamples: 20,
          netProfitRate: null,
          targetHitRate: null,
          avgResultPctNet: null,
          metricCoverage: {
            netProfitRate: { value: null, validCount: 1, totalCount: 1, missingCount: 0, validDays: 1 },
            targetHitRate: { value: null, validCount: 0, totalCount: 1, missingCount: 1, validDays: 0 },
            avgResultPctNet: { value: null, validCount: 0, totalCount: 1, missingCount: 1, validDays: 0 },
          },
        }],
      },
    },
    scenarios: [],
    recent: [],
  };
  app.evalIn(`state.screen = 'strategy'; swingVerifyState.data = ${JSON.stringify(fixture)}; renderSwingVerifyPanel()`);
  const panelText = app.doc.getElementById('swingVerify').textContent.replace(/\s+/g, ' ');
  assert.match(panelText, /成熟 1・未成熟 1/);
  assert.match(panelText, /達標率 --/);

  const help = screenHelpText('strategy', '策略雷達');
  assert.match(help, /15 個官方交易日/);
  assert.match(help, /已結案但未成熟/);
  assert.match(help, /成熟但該欄缺值.*未知/);
  assert.match(help, /20 筆有效/);
  assert.match(help, /20 個不同有效日期/);
  assert.match(help, /淨獲利率.*達標率/);
  assert.doesNotMatch(help, /20 筆結案才給百分比/);
});

test('自選股說明把費稅留白與券商實際 0 元分開，並說清 v1／v2 計畫還原', () => {
  const actualZero = JSON.parse(app.evalIn(`JSON.stringify((() => {
    const record = { feeAmountTwd: 0, taxAmountTwd: 0, feeSource: 'broker', taxSource: 'manual' };
    return {
      fee: tradeFeeAmountOf(record),
      tax: tradeTaxAmountOf(record),
      feeLabel: tradeCostSourceLabel(record.feeSource),
      taxLabel: tradeCostSourceLabel(record.taxSource),
      feeEditValue: tradeActualAmountForEdit(record, 'feeAmountTwd', 'feeSource'),
      taxEditValue: tradeActualAmountForEdit(record, 'taxAmountTwd', 'taxSource'),
    };
  })())`));
  assert.deepEqual(actualZero, { fee: 0, tax: 0, feeLabel: '實', taxLabel: '手填', feeEditValue: '0', taxEditValue: '0' });

  const watchlistHelp = screenHelpText('watchlist', '自選股');
  assert.match(watchlistHelp, /留白.*估算/);
  assert.match(watchlistHelp, /填入 0 元.*有效/);
  assert.match(watchlistHelp, /估算.*券商實際.*手動.*歷史/);

  const backupText = app.evalIn(`(() => {
    const previousUser = authState.user;
    authState.user = { id: 'u1', username: 'tester', displayName: '測試使用者' };
    const host = document.createElement('div');
    host.innerHTML = renderPersonalBackupPanel();
    authState.user = previousUser;
    return host.textContent.replace(/\\s+/g, ' ');
  })()`);
  assert.match(backupText, /v2.*交易計畫.*取代/);
  assert.match(backupText, /v1.*缺少交易計畫.*保留目前計畫/);
  assert.match(backupText, /先.*預覽.*才.*寫入/);
});
