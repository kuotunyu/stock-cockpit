// 觀察品質檢討的五種合成案例必須由既有摘要產生，保留分母、窗口與未知狀態。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { importServer } from '../helpers/test-server.mjs';
import { buildSyntheticVerificationReviews } from '../helpers/verification-review-fixtures.mjs';

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  await mod.shutdownServer();
  mock.restore();
  assert.equal(dirname(resolve(dataDir)), resolve(tmpdir()));
  assert.ok(basename(dataDir).startsWith('stock1-test-'));
  await rm(dataDir, { recursive: true, force: true });
});

const byId = new Map(buildSyntheticVerificationReviews(mod).map(example => [example.id, example]));

test('完整案例保留成熟母體、固定期間配對與個人現金差額的不同口徑', () => {
  const example = byId.get('complete');
  assert.equal(example.captureCoverage.expectedCount, 1);
  assert.equal(example.captureCoverage.completeCount, 1);
  assert.equal(example.captureCoverage.coverageRate, 100);
  assert.equal(example.cohort.issued, 2);
  assert.equal(example.cohort.matureCount, 2);
  assert.equal(example.cohort.resolved, 2);
  assert.equal(example.cohort.avgResultPctNet, 1.529);
  assert.deepEqual(example.cohort.avgResultPctNetCoverage, { validCount: 2, totalCount: 2, missingCount: 0, reason: null });
  assert.equal(example.benchmark.eligibleCount, 2);
  assert.equal(example.benchmark.pairedCount, 2);
  assert.equal(example.benchmark.eligibleDays, 1);
  assert.equal(example.benchmark.pairedDays, 1);
  assert.equal(example.benchmark.strategyMean, 3);
  assert.equal(example.benchmark.benchmarkMean, 2);
  assert.equal(example.benchmark.meanDifference, 1);
  assert.deepEqual(example.benchmark.period, { entryDate: '20260804', exitDate: '20260824' });
  assert.equal(example.personal.validLinks, 2);
  assert.equal(example.personal.buyCash, 100020);
  assert.equal(example.personal.sellCash, 109815);
  assert.equal(example.personal.cashDifference, 9795);
  assert.equal(example.personal.planReturn, null);
  assert.equal(example.personal.netR, null);
  assert.deepEqual(example.cohort.costRisk.costSensitivity.scenarios.map(row => row.returnPct.value), [1.529, 1.429, 1.279, 1.029]);
  assert.equal(example.cohort.costRisk.netR.value, 0.30579999999999996);
});

test('完整零訊號算採集成功但沒有收益與配對分母', () => {
  const example = byId.get('complete-zero');
  assert.equal(example.captureCoverage.completeCount, 1);
  assert.equal(example.captureCoverage.coverageRate, 100);
  assert.equal(example.cohort.issued, 0);
  assert.equal(example.cohort.matureCount, 0);
  assert.equal(example.cohort.avgResultPctNet, null);
  assert.equal(example.cohortWindow.maxSessions, 1);
  assert.equal(example.benchmark.eligibleCount, 0);
  assert.equal(example.benchmark.pairedCount, 0);
  assert.equal(example.benchmark.meanDifference, null);
});

test('缺月曆時觀察到的100%覆蓋不能升格成完整預期窗口', () => {
  const example = byId.get('calendar-unknown');
  assert.equal(example.captureCoverage.expectedCount, 1);
  assert.equal(example.captureCoverage.coverageRate, 100);
  assert.equal(example.captureCoverage.expectedDateSource, 'unavailable');
  assert.equal(example.cohort.matureCount, 0);
  assert.equal(example.cohort.unknownCount, 1);
  assert.equal(example.cohort.calendarReason, 'official-calendar-coverage-unknown');
  assert.equal(example.cohortWindow.calendarSource, null);
  assert.equal(example.benchmark.status, 'pending');
  assert.equal(example.benchmark.reason, 'official-calendar-source-unavailable');
});

test('缺成本保留毛報酬但淨值與個人現金差額保持未知', () => {
  const example = byId.get('cost-unknown');
  assert.equal(example.cohort.identity.costModelVersion, 'legacy-unknown');
  assert.equal(example.cohort.avgResultPct, 5);
  assert.equal(example.cohort.avgResultPctNet, null);
  assert.deepEqual(example.cohort.avgResultPctNetCoverage, { validCount: 0, totalCount: 1, missingCount: 1, reason: 'no-valid-values' });
  assert.equal(example.personal.buyCash, null);
  assert.equal(example.personal.sellCash, null);
  assert.equal(example.personal.cashDifference, null);
  assert.ok(example.personal.reasons.includes('fee-tax-unknown'));
  assert.deepEqual(example.cohort.costRisk.costSensitivity.scenarios.map(row => row.returnPct.validCount), [0, 0, 0, 0]);
  assert.deepEqual(example.cohort.costRisk.costSensitivity.scenarios.map(row => row.returnPct.totalCount), [1, 1, 1, 1]);
});

test('未成熟案例不因快速結案或管理節點提前進入有效分母', () => {
  const example = byId.get('immature');
  assert.equal(example.cohort.issued, 1);
  assert.equal(example.cohort.matureCount, 0);
  assert.equal(example.cohort.immatureCount, 1);
  assert.equal(example.cohort.avgResultPctNet, null);
  assert.equal(example.observedSessions, 5);
  assert.equal(example.cohortWindow.maxSessions, 15);
  assert.equal(example.reviewCadenceSessions, 20);
  assert.equal(example.benchmark.status, 'pending');
});

test('每例保留來源自己的窗口與完整model key', () => {
  assert.deepEqual([...byId.keys()], ['complete', 'complete-zero', 'calendar-unknown', 'cost-unknown', 'immature']);
  for (const example of byId.values()) {
    assert.ok(example.modelKey.startsWith('{'));
    assert.equal(example.selectedModelKey.startsWith('{'), true);
    assert.equal(example.benchmarkWindow.limit, 260);
    assert.equal(example.benchmarkWindow.allModels, true);
    assert.equal(example.reviewCadenceIsThreshold, false);
  }
});
