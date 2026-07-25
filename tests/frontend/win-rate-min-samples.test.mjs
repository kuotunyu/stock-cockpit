// D-27：勝率的最小樣本門檻。舊行為只要 1 筆結案就給百分比、還依 >=50% 染成紅／綠，
// 視覺上跟累積數十筆的結論長得一模一樣。而且 winRate 的分母只算已結案，
// 達標／停損常 1~3 天就結案、超時要等第 15 個交易日 → 累積初期分母偏向快速觸價的極端樣本，
// 勝率會先高後低，看起來像策略壞掉，其實只是分母組成在變。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const renderScenarios = (scenarios) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  swingVerifyState.data = {
    ok: true,
    scenarios: ${JSON.stringify(scenarios)},
    recent: [],
    pendingCount: 0,
    formulaVersions: [],
    notes: [],
  };
  state.screen = "strategy";
  renderSwingVerifyPanel();
  const panel = el.swingVerify;
  const chip = panel.querySelector(".sv-chip");
  const rate = chip ? chip.querySelector(".sv-rate") : null;
  return {
    text: rate ? rate.textContent.replace(/\\s+/g, " ").trim() : "",
    classes: rate ? rate.className : "",
  };
})())`));

const scenario = (over) => ({
  scenario: "midBandDefense", samples: 30, wins: 1, losses: 1, expired: 0, pending: 28,
  resolved: 2, winRate: null, winRateMinSamples: 20, avgResultPct: null, avgDaysHeld: null, ...over,
});

test("樣本不足時顯示累積進度，且不得染紅綠", () => {
  const result = renderScenarios([scenario({})]);
  assert.match(result.text, /累積中 2\/20/, `實際：${result.text}`);
  assert.doesNotMatch(result.text, /%/, "不得給出百分比");
  assert.doesNotMatch(result.classes, /is-up|is-down/, "不足以當結論就不能染色");
});

test("累積達門檻後照常顯示百分比並染色", () => {
  const win = renderScenarios([scenario({ wins: 14, losses: 6, resolved: 20, winRate: 70 })]);
  assert.match(win.text, /70%/);
  assert.match(win.classes, /is-up/, "≥50% 染綠（上漲語意）");

  const lose = renderScenarios([scenario({ wins: 6, losses: 14, resolved: 20, winRate: 30 })]);
  assert.match(lose.text, /30%/);
  assert.match(lose.classes, /is-down/);
});

test("完全沒有結案時退回 --，不顯示 0/20 之類的假進度", () => {
  const result = renderScenarios([scenario({ wins: 0, losses: 0, expired: 0, resolved: 0, pending: 30 })]);
  assert.match(result.text, /--/, `實際：${result.text}`);
  assert.doesNotMatch(result.text, /累積中/, "一筆都還沒結案時講「累積中」沒有意義");
});

test("後端沒給 winRateMinSamples 時前端仍要有安全預設", () => {
  const result = renderScenarios([scenario({ winRateMinSamples: undefined })]);
  assert.match(result.text, /累積中 2\/20/, "退回預設 20，不可顯示 NaN 或 undefined");
});

// 個股卡片旁的回測 chip：樣本是「這檔在回測窗內觸發訊號的次數」，常常只有一兩次。
// 門檻用 5（比場景勝率的 20 寬鬆）——它是個股參考提示不是策略結論，次數本身照樣顯示。
const backtestChip = (backtest) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  const host = document.createElement("div");
  host.innerHTML = renderBacktestChips(${JSON.stringify(backtest)});
  return { text: host.textContent.replace(/\s+/g, " ").trim() };
})())`));

test("個股回測 chip：觸發次數太少時不給達成率百分比，但次數要照顯示", () => {
  const few = backtestChip({ sampleSize: 1, hitPlus2Rate: 1, avgCloseReturn: 5.2 });
  assert.match(few.text, /1次/, "次數要看得到，使用者才知道樣本多小");
  assert.doesNotMatch(few.text, /100%/, "1 次觸發的「100%」沒有統計意義");
  assert.match(few.text, /樣本不足/);
});

test("個股回測 chip：樣本足夠時照常顯示達成率", () => {
  const many = backtestChip({ sampleSize: 8, hitPlus2Rate: 0.5, avgCloseReturn: 1.2 });
  assert.match(many.text, /8次/);
  assert.match(many.text, /50/, `實際：${many.text}`);
  assert.doesNotMatch(many.text, /樣本不足/);
});

test("個股回測 chip：完全沒有樣本時沿用既有的「樣本不足」空狀態", () => {
  const none = backtestChip({ sampleSize: 0 });
  assert.match(none.text, /樣本不足/);
});
