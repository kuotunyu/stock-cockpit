// 官方已確認空月份與失敗分開；TWSE no-data 語意不外推至 TPEx 或 malformed 回應。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { importServer } from '../helpers/test-server.mjs';

const { mod, mock, dataDir } = await importServer();
after(async () => { await mod.flushPersistence(); mock.restore(); await rm(dataDir, { recursive: true, force: true }); });
const noData = { stat: '很抱歉，沒有符合條件的資料!', total: 0 };

test('N2：TWSE 7855 上市前 202607 實測 no-data 保留為 confirmed-empty，非 failed month', async () => {
  const remove = mock.override({ match: url => url.pathname === '/exchangeReport/STOCK_DAY', reply: noData });
  try {
    const failedMonths = [], sourceEvidence = {};
    const rows = await mod.getStockHistory({ code: '7855', exchange: 'TWSE' }, '20260701', 1, { requireSourceSuccess: true, failedMonths, sourceEvidence });
    assert.deepEqual(rows, []);
    assert.deepEqual(failedMonths, []);
    assert.deepEqual(sourceEvidence.official, [{ month: '20260701', status: 'confirmed-empty' }]);
    const calls = mock.callsFor(/STOCK_DAY/);
    assert.equal(new URL(calls.at(-1).url).searchParams.get('stockNo'), '7855');
    assert.equal(new URL(calls.at(-1).url).searchParams.get('date'), '20260701');
  } finally { remove(); }
});

test('N2：超出查詢範圍、SERVICE_UNAVAILABLE、缺data與矛盾no-data形狀全部保留failed', async () => {
  const cases = [
    { stat: '查詢日期小於99年1月4日，請重新查詢!', total: 0 },
    { stat: 'SERVICE_UNAVAILABLE', total: 0 }, { stat: 'OK' }, {},
    { stat: noData.stat }, { ...noData, total: '0' }, { ...noData, total: 1 },
    { ...noData, data: null }, { ...noData, data: [] }, { ...noData, data: [['contradictory']] },
  ];
  for (const [index, payload] of cases.entries()) {
    const remove = mock.override({ match: url => url.pathname === '/exchangeReport/STOCK_DAY', reply: payload });
    try {
      const failedMonths = [], sourceEvidence = {};
      await mod.getStockHistory({ code: String(8000 + index), exchange: 'TWSE' }, '19900101', 1, { requireSourceSuccess: true, failedMonths, sourceEvidence });
      assert.equal(failedMonths.length, 1, JSON.stringify(payload));
      assert.equal(sourceEvidence.official[0].status, 'failed');
    } finally { remove(); }
  }
});

test('N2：TWSE no-data 文案不能代替 TPEx 必要資料表，原合法空表仍有效', async () => {
  for (const [index, payload] of [noData, { stat: 'OK' }, { tables: [{ data: [] }] }].entries()) {
    const remove = mock.override({ match: url => url.pathname.includes('/afterTrading/tradingStock'), reply: payload });
    try {
      const failedMonths = [], sourceEvidence = {};
      await mod.getStockHistory({ code: String(8100 + index), exchange: 'TPEx' }, '20260701', 1, { requireSourceSuccess: true, failedMonths, sourceEvidence });
      assert.equal(failedMonths.length, index === 2 ? 0 : 1);
      assert.equal(sourceEvidence.official[0].status, index === 2 ? 'confirmed-empty' : 'failed');
    } finally { remove(); }
  }
});
