// 分母損耗的可見性。兩個數字在 API 早就有了，但畫面上看不到，等於沒做：
//
// D-26（2026-07-26 補完）：`stalled` 是「因官方日 K 長期缺漏而停在缺口前」的張數。
//   它們永遠不會結案、永遠不進勝率分母，可是畫面把它們算在「追蹤中 N」裡面——
//   讀起來像「還在追蹤」，實際上是死掉的樣本。
// D-01（本次）：`corporateActionPendingCount` 是「偵測到除權息但官方比率還沒到齊」而
//   暫停推進的張數。那是自癒狀態（通常隔天解開），但「今天沒有推進」必須跟
//   「今天沒有變化」長得不一樣，否則使用者無從分辨。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const SCENARIO = {
  scenario: "midBandDefense", samples: 30, wins: 14, losses: 6, expired: 0, pending: 10,
  stalled: 0, resolved: 20, winRate: 70, winRateMinSamples: 20, avgResultPct: 1.2, avgDaysHeld: 4,
};

const render = (over = {}, scenarioOver = {}) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  swingVerifyState.data = {
    ok: true,
    scenarios: [${JSON.stringify({ ...SCENARIO, ...scenarioOver })}],
    recent: [],
    pendingCount: 10,
    formulaVersions: [],
    notes: [],
    ...${JSON.stringify(over)},
  };
  state.screen = "strategy";
  renderSwingVerifyPanel();
  const panel = el.swingVerify;
  const chip = panel.querySelector(".sv-chip");
  const head = panel.querySelector(".sv-head small");
  return {
    chip: chip ? chip.textContent.replace(/\\s+/g, " ").trim() : "",
    chipHtml: chip ? chip.innerHTML : "",
    head: head ? head.textContent.replace(/\\s+/g, " ").trim() : "",
    headTitle: head ? (head.getAttribute("title") || "") : "",
  };
})())`));

test("D-26：卡住的張數要從「追蹤中」裡標出來，不能混在一起", () => {
  const withStalled = render({ stalledCount: 3 }, { pending: 10, stalled: 3 });
  assert.match(withStalled.chip, /追蹤中 10/, "總數照舊顯示");
  assert.match(withStalled.chip, /含卡住 3/, "卡住的要單獨講——它們永遠不會進分母");
  assert.match(withStalled.chipHtml, /title="[^"]*不會進入上面的勝率分母[^"]*"/, "要說清楚後果");
});

test("D-26：沒有卡住就不得亮——天天亮的提示等於沒有提示", () => {
  const clean = render({ stalledCount: 0 }, { stalled: 0 });
  assert.doesNotMatch(clean.chip, /卡住/);
});

test("D-01：等官方除權息比率的張數要顯示在標題列", () => {
  const holding = render({ corporateActionPendingCount: 2 });
  assert.match(holding.head, /2 筆等官方除權息比率/);
  assert.match(holding.headTitle, /暫停推進/, "tooltip 要說明它是暫停判定而不是已判定");
  assert.match(holding.headTitle, /事件前的停損價/, "要講清楚不停等會發生什麼事");
});

test("D-01：沒有停等時不顯示", () => {
  const none = render({ corporateActionPendingCount: 0 });
  assert.doesNotMatch(none.head, /等官方除權息比率/);
});

test("D-01：缺口與停等是兩件事，同時存在時要各自顯示", () => {
  const both = render({ dataGapCount: 1, corporateActionPendingCount: 2 });
  assert.match(both.head, /1 筆待補缺口/, "缺 K 的語意是等資料");
  assert.match(both.head, /2 筆等官方除權息比率/, "停等的語意是等比率");
});

// jsdom harness 不載入 styles.css，getComputedStyle 解不出 CSS 變數，
// 所以照專案慣例改讀 CSS 原文比對。
test("卡住用黃色而非紅色：它是分母損耗的資訊，不是錯誤", () => {
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const rule = styles.match(/\.sv-stalled\s*\{([^}]*)\}/);
  assert.ok(rule, "缺少 .sv-stalled 規則");
  assert.match(rule[1], /color\s*:\s*var\(--yellow\)/);
  assert.doesNotMatch(rule[1], /var\(--red\)/, "不該升級成紅色警示");
});
