// 除息日快速鈕上的權利股數必須把配股／現增取得的股數算進去。
//
// 現場：`dividendEntitlementShares` 只重放 buy/sell，沒有 corporateAction 分支。
// 配過股的持股每年除息都少記——買 10,000 股、之後連兩年各配股 10%，正確是 12,100 股，
// 前端算 10,000，少 17.4%。而這顆鈕**只有除息當天出現**，按下去就寫進帳本。
//
// 使用者在同一個畫面上會看到矛盾：上方持股列顯示 11,000 股、按鈕寫 10,000 股，兩個數字並排
// 而沒有任何警示。後端有正確的 sharesHeldBeforeExDate，但收到股利紀錄時照單全收
// （已一併改成伺服器覆算，見 dividend-entitlement-corporate-actions.test.mjs）。
//
// 判準必須與後端逐字一致，**包含兩者各自 floor** 而不是先加總再取整。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const EX = "2025-08-01";
const EX_COMPACT = "20250801";

// records 直接塞進 tradesState，不經過畫面。
function seedRecords(records) {
  app.evalIn(`tradesState.records = ${JSON.stringify(records)};`);
}
const entitled = (code = "2881", exDate = EX) =>
  Number(app.evalIn(`dividendEntitlementShares(tradesState.records, "${code}", "${exDate}")`));

const buy = (id, shares, date) => ({ id, code: "2881", side: "buy", price: 100, shares, date });
const sell = (id, shares, date) => ({ id, code: "2881", side: "sell", price: 120, shares, date });
const ca = (id, date, stockRatio, subscriptionRatio = 0) =>
  ({ id, code: "2881", side: "corporateAction", price: 0, shares: 0, date, stockRatio, subscriptionRatio });

test("配股取得的股數也有領息權利：連兩年各配 10% → 12,100 股", () => {
  seedRecords([buy("b1", 10000, "20230715"), ca("c1", "20230801", 0.1), ca("c2", "20240801", 0.1)]);
  assert.equal(entitled(), 12100, "10000 → 11000 → 12100，不是停在 10000");
});

test("現增取得的股數同樣算進權利", () => {
  seedRecords([buy("b1", 10000, "20230715"), ca("c1", "20240801", 0, 0.05)]);
  assert.equal(entitled(), 10500);
});

test("配股與現增同一天：兩者各自 floor，不是先加總再取整", () => {
  // 999 股、配股 10% ＋ 現增 15%
  //   各自 floor：floor(99.9)=99、floor(149.85)=149 → +248 → 1247   ← 與後端一致
  //   先加總　　：floor(999×0.25)=249 → 1248
  seedRecords([buy("b1", 999, "20230715"), ca("c1", "20240801", 0.1, 0.15)]);
  assert.equal(entitled(), 1247);
});

test("除息日之後才發生的公司行動不算進權利", () => {
  seedRecords([buy("b1", 10000, "20230715"), ca("c1", "20251001", 0.2)]);
  assert.equal(entitled(), 10000);
});

test("除息日當天的公司行動不算（與買賣同一條界線）", () => {
  seedRecords([buy("b1", 10000, "20230715"), ca("c1", EX_COMPACT, 0.2)]);
  assert.equal(entitled(), 10000, "除息日當天除權，這次除息的權利基準是前一日收盤");
});

test("賣掉一部分之後配股：基準是當時剩下的股數", () => {
  seedRecords([buy("b1", 10000, "20230715"), sell("s1", 6000, "20230720"), ca("c1", "20240801", 0.1)]);
  assert.equal(entitled(), 4400);
});

test("既有規則不可被新分支破壞：除息日買進不算、當天賣出仍有權利", () => {
  seedRecords([buy("b1", 10000, "20230715"), buy("b2", 5000, EX_COMPACT)]);
  assert.equal(entitled(), 10000, "除息日當天買進沒有權利");
  seedRecords([buy("b1", 10000, "20230715"), sell("s1", 4000, EX_COMPACT)]);
  assert.equal(entitled(), 10000, "除息日當天賣出仍有權利");
});

test("其他代號的公司行動不會誤算進來", () => {
  seedRecords([
    buy("b1", 10000, "20230715"),
    { id: "c-other", code: "2330", side: "corporateAction", price: 0, shares: 0, date: "20240801", stockRatio: 0.5 },
  ]);
  assert.equal(entitled(), 10000);
});

test("比率缺值或壞值視為 0，不得產生 NaN", () => {
  seedRecords([buy("b1", 10000, "20230715"), { id: "c1", code: "2881", side: "corporateAction", price: 0, shares: 0, date: "20240801" }]);
  assert.equal(entitled(), 10000);
  seedRecords([buy("b1", 10000, "20230715"), ca("c1", "20240801", null, "abc")]);
  assert.equal(entitled(), 10000);
});

test("快速鈕上顯示的股數就是含配股的數字", () => {
  app.evalIn(`
    tradesState.records = ${JSON.stringify([buy("b1", 10000, "20230715"), ca("c1", "20240801", 0.1)])};
    tradesState.portfolio = { ok: true, holdings: [{ code: "2881", shares: 11000, avgCost: 100, cost: 1000000 }],
      realized: [], totals: { cost: 1000000, realizedPnl: 0 } };
    tradesState.loaded = true;
    stocks.length = 0;
    stocks.push({ code: "2881", name: "\\u5bcc\\u90a6\\u91d1", exchange: "TWSE", price: 120,
      groups: [], strategies: [], spark: [],
      dividend: { exDate: "${EX}", kind: "\\u9664\\u606f", cash: 3.5, isToday: true, daysUntil: 0 } });
    state.watchList = "hold";
    renderHoldingsPanel();
  `);
  const shares = app.evalIn(`el.holdingsPanel.querySelector('[data-dividend-quick]')?.dataset.shares`);
  assert.equal(shares, "11000", "按鈕帶的股數要含配股，否則按下去就把少掉的金額寫進帳本");
  const text = app.evalIn(`el.holdingsPanel.textContent`);
  assert.ok(text.includes("11,000 股") || text.includes("11000 股"), `按鈕文案要顯示同一個數字（實際：${text.slice(0, 200)}）`);
  // 同一畫面上的持股列是 11,000 股——兩個數字必須一致，這正是原本矛盾的地方。
  assert.ok(text.includes("11,000"), "持股列與按鈕不可再各說各話");
});
