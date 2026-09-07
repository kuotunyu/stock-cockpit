// 波段驗證成績單前端：場景勝率 chips、最近結案明細、冷啟動空狀態、非策略頁不動。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test('正式成熟cohort取代快結案headline，淨獲利/達標/歷史平均分名並保留最近結案', () => {
  const metric = {value:2,validCount:1,totalCount:2,missingCount:1,validDays:1,reason:'partial-field-coverage'};
  const headline = {issued:3,matureCount:2,immatureCount:1,unknownCount:0,signalDays:1,
    metricCoverage:{avgResultPctNet:metric},scenarios:[{scenario:'midBandDefense',samples:3,wins:0,losses:0,expired:1,pending:1,
      resolved:1,continuousResolved:1,netProfitRate:null,targetHitRate:null,avgResultPct:2.5,avgResultPctNet:2,
      metricCoverage:{netProfitRate:metric,avgResultPctNet:metric}}]};
  app.evalIn(`state.screen='strategy'; swingVerifyState.data=${JSON.stringify({scenarios:[{samples:50,winRate:100}],
    cohort:{headline,models:[{...headline,identity:{entryModel:'signal-close-observation',returnBasis:'adjusted-reference-price'}}]},
    population:{legacy:{samples:8},models:[]},captureCoverage:{fullRecordStartDate:'2026-09-01',expectedDateReason:'official-session-dates-only'},
    recent:[{code:'2330',scenario:'midBandDefense',status:'win',resultPct:5,resolvedAt:'20260902'}]})}; renderSwingVerifyPanel();`);
  const text = app.evalIn('el.swingVerify.textContent');
  assert.match(text,/成熟 2.*未成熟 1/);
  assert.match(text,/淨獲利率/);
  assert.match(text,/達標率/);
  assert.match(text,/歷史平均淨報酬/);
  assert.match(text,/有效 1\/2.*缺 1/);
  assert.match(text,/舊紀錄 8 筆驗證單/);
  assert.doesNotMatch(app.evalIn("el.swingVerify.querySelector('.sv-chips').textContent"),/100%/,'舊結案口徑只留在details，不作主卡');
  assert.equal(json("el.swingVerify.querySelectorAll('.sv-row').length"),1);
  assert.equal(json("el.swingVerify.querySelectorAll('.sv-rate.is-up').length"),0);
});

const sample = {
  ok: true,
  currentFormulaVersion: "swing-v15-valid-min-target",
  formulaVersions: [
    { formulaVersion: "swing-v15-valid-min-target", samples: 20, resolved: 15, pending: 5, dataGaps: 0 },
    { formulaVersion: "swing-v12-bandnames", samples: 101, resolved: 101, pending: 0, dataGaps: 0 },
  ],
  scenarios: [
    { scenario: "midBandDefense", samples: 12, wins: 5, losses: 3, expired: 1, pending: 3, winRate: 55.6, avgResultPct: 2.4, avgDaysHeld: 6.2 },
    { scenario: "strongContinuation", samples: 8, wins: 2, losses: 4, expired: 0, pending: 2, winRate: 33.3, avgResultPct: -1.1, avgDaysHeld: 4.8 },
  ],
  recent: [
    { day: "20260628", code: "2330", name: "台積電", scenario: "midBandDefense", status: "win", resolvedAt: "20260702", resultPct: 10.2, daysHeld: 4 },
    { day: "20260627", code: "1101", name: "台泥", scenario: "strongContinuation", status: "loss", resolvedAt: "20260701", resultPct: -5, daysHeld: 3 },
  ],
  pendingCount: 5,
  notes: ["驗證規則…", "15 個交易日…"],
};

test("有統計資料：兩張場景卡＋勝率配色＋最近結案明細", () => {
  app.evalIn(`
    state.screen = "strategy";
    swingVerifyState.data = ${JSON.stringify(sample)};
    renderSwingVerifyPanel();
  `);
  assert.equal(json(`el.swingVerify.hidden`), false);
  assert.equal(json(`el.swingVerify.querySelectorAll('.sv-chip').length`), 2);
  assert.equal(json(`el.swingVerify.querySelectorAll('.sv-rate.is-up').length`), 1, "勝率 ≥50% 紅");
  assert.equal(json(`el.swingVerify.querySelectorAll('.sv-rate.is-down').length`), 1, "勝率 <50% 綠");
  const text = app.evalIn(`el.swingVerify.textContent`).replace(/\s+/g, " ");
  assert.ok(text.includes("勝率 55.6%"), `統計數字：${text.slice(0, 160)}`);
  assert.ok(text.includes("中軌攻防"), "場景 key 要翻成中文名");
  assert.ok(text.includes("達標 5"), "結案分佈");
  assert.equal(json(`el.swingVerify.querySelectorAll('.sv-row').length`), 2, "最近結案兩筆");
  assert.ok(text.includes("+10.2%") && text.includes("-5%"), "結果百分比");
});

test("冷啟動（還沒有任何樣本）：顯示「累積中」說明，不顯示空表", () => {
  app.evalIn(`
    swingVerifyState.data = {
      ok: true, currentFormulaVersion: "swing-v15-valid-min-target", scenarios: [], recent: [], pendingCount: 0,
      formulaVersions: [{ formulaVersion: "swing-v12-bandnames", samples: 101, resolved: 101, pending: 0 }], notes: []
    };
    renderSwingVerifyPanel();
  `);
  assert.equal(json(`el.swingVerify.hidden`), false);
  assert.ok(app.evalIn(`el.swingVerify.textContent`).includes("自動記錄"), "冷啟動說明");
  assert.ok(app.evalIn(`el.swingVerify.textContent`).includes("舊公式 101 筆已保留"), "舊版樣本不可像消失一樣");
  assert.equal(json(`el.swingVerify.querySelectorAll('.sv-chip').length`), 0);
});

test("近期 API 回 12 筆時只畫 10 列，標題明示『最近 10（共 12）』", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    day: "20260628", code: String(2300 + index), name: `測${index}`,
    scenario: "midBandDefense", status: "win", resolvedAt: "20260702", resultPct: 5, daysHeld: 4,
  }));
  app.evalIn(`
    state.screen = "strategy";
    swingVerifyState.data = { ...${JSON.stringify(sample)}, recent: ${JSON.stringify(many)} };
    renderSwingVerifyPanel();
  `);
  assert.equal(json(`el.swingVerify.querySelectorAll('.sv-row').length`), 10);
  assert.ok(app.evalIn(`el.swingVerify.querySelector('.sv-details > summary').textContent`).includes("最近 10 筆結案（共 12 筆）"), "場景 chips 也包了一個 details，要指定近期結案那個");
});

test("沒資料 → 隱藏；非策略頁不重繪", () => {
  app.evalIn(`swingVerifyState.data = null; renderSwingVerifyPanel();`);
  assert.equal(json(`el.swingVerify.hidden`), true);
  // 非策略頁：面板內容不被動到（守住 render() 全頁重繪時的無謂工作）
  app.evalIn(`
    swingVerifyState.data = ${JSON.stringify(sample)};
    state.screen = "strategy"; renderSwingVerifyPanel();
    state.screen = "overnight";
    el.swingVerify.dataset.marker = "untouched";
    renderSwingVerifyPanel();
  `);
  assert.equal(app.evalIn(`el.swingVerify.dataset.marker`), "untouched", "非策略頁提前 return");
});

// D-30：處置期間是分盤集合競價，日 K 的高低價只是幾十次撮合的極值，
// 掛在停損／目標的單未必真的撮得到。這些樣本仍計入勝率，但筆數必須看得見——
// 否則使用者關掉處置股之後，成績單裡還混著它們卻毫無跡象。
test("分盤撮合樣本數要顯示在摘要行，沒有時不留贅字", () => {
  app.evalIn(`
    state.screen = "strategy";
    swingVerifyState.data = { ...${JSON.stringify(sample)}, periodicCallCount: 3 };
    renderSwingVerifyPanel();
  `);
  const withCount = app.evalIn(`el.swingVerify.querySelector('small').textContent`);
  assert.match(withCount, /3 筆分盤撮合/, `實際：${withCount}`);

  app.evalIn(`
    swingVerifyState.data = { ...${JSON.stringify(sample)}, periodicCallCount: 0 };
    renderSwingVerifyPanel();
  `);
  const without = app.evalIn(`el.swingVerify.querySelector('small').textContent`);
  assert.doesNotMatch(without, /分盤撮合/, "沒有分盤樣本時不該留下空欄位");

  // 舊 payload 完全沒有這個欄位時也不得炸掉或印出 undefined
  app.evalIn(`
    swingVerifyState.data = ${JSON.stringify(sample)};
    renderSwingVerifyPanel();
  `);
  const legacy = app.evalIn(`el.swingVerify.querySelector('small').textContent`);
  assert.doesNotMatch(legacy, /undefined|NaN/, `實際：${legacy}`);
});

test("摘要行的 tooltip 要說明分盤撮合為什麼會讓觸價判定失真", () => {
  app.evalIn(`
    state.screen = "strategy";
    swingVerifyState.data = { ...${JSON.stringify(sample)}, periodicCallCount: 2 };
    renderSwingVerifyPanel();
  `);
  const title = app.evalIn(`el.swingVerify.querySelector('small').getAttribute('title')`);
  assert.match(title, /分盤集合競價/);
  assert.match(title, /未必真的撮得到/, "要講清楚後果，不能只丟名詞");
});

test("場景卡：依大盤季線上／下分層；未達最小樣本只給筆數", () => {
  const html = String(app.evalIn(`(() => {
    state.screen = "strategy";
    swingVerifyState.data = { ok: true, currentFormulaVersion: "v", formulaVersions: [], recent: [], pendingCount: 0,
      scenarios: [{ scenario: "midBandDefense", samples: 30, wins: 12, losses: 8, expired: 2, pending: 8, resolved: 22, winRate: 54.5, winRateMinSamples: 20,
        byRegime: { aboveMa60: { resolved: 20, wins: 12, winRate: 60 }, belowMa60: { resolved: 2, wins: 0, winRate: null }, unknown: { resolved: 0, wins: 0, winRate: null } } }] };
    renderSwingVerifyPanel();
    return document.getElementById("swingVerify").innerHTML;
  })()`)).replace(/\s+/g, " ");
  assert.match(html, /大盤季線上 60%・季線下 0\/2/);
  assert.doesNotMatch(html, /位階未知/);
});

test("場景卡：分佈指標一行（PF／中位／最長連虧／最差單日）與「含處置股」的另一個口徑", () => {
  const html = String(app.evalIn(`(() => {
    state.screen = "strategy";
    swingVerifyState.data = { ok: true, currentFormulaVersion: "v", formulaVersions: [], recent: [], pendingCount: 0,
      scenarios: [{ scenario: "midBandDefense", samples: 30, wins: 15, losses: 12, expired: 0, pending: 3, resolved: 27, continuousResolved: 23,
        winRate: 47.8, winRateMinSamples: 20, avgResultPct: 0.83, profitFactor: 1.53, profitFactorNet: 1.2, medianResultPct: -3, medianResultPctNet: -3.47, maxConsecutiveLossDays: 1,
        worstDay: { day: "20260825", avgResultPct: -3, count: 3 }, withPeriodicCall: { resolved: 27, wins: 15, winRate: 55.6 } }] };
    renderSwingVerifyPanel();
    return document.getElementById("swingVerify").innerHTML;
  })()`)).replace(/\s+/g, " ");
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /獲利因子 淨 1\.2（毛 1\.53）・中位 淨 -3\.47%・最長連虧 1 天・最差單日 08\/25 -3%（3 筆）/, "PF／中位改淨口徑、連虧以結案日為叢集");
  assert.doesNotMatch(text, /PF 1\.53/);
  assert.match(text, /含處置股 55\.6%（27 筆）・主要勝率只算 23 筆連續競價的單/);
});
