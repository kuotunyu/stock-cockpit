// 紀律提醒（本月虧損上限、連虧停手，本機偏好）與今年稅務估算行：資料由伺服器算好，前端只評估與呈現。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
const thisMonth = today.slice(0, 6);
const thisYear = today.slice(0, 4);

function seed({ monthPnl = -12000, streak = 3 } = {}) {
  app.evalIn(`
    tradesState.records = [{ id: "s1", code: "2330", side: "sell", price: 100, shares: 1000, fee: 85, tax: 300, date: "${thisMonth}05" }];
    tradesState.portfolio = { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: ${monthPnl} } };
    tradesState.scorecard = { basis: "realized-avg-cost-net-of-fees-v1", minTrades: 20,
      overall: { trades: 5, wins: 2, losses: 3, flat: 0, winRate: 40, profitFactor: 0.8, expectancy: -2400, maxConsecutiveLosses: 3, currentLossStreak: ${streak}, best: null, worst: null, realizedPnl: -12000 },
      months: [{ key: "${thisMonth}", realizedPnl: ${monthPnl}, trades: 5, wins: 2, losses: 3, fees: 400, taxes: 900, dividendsNet: 0, winRate: 40 }],
      years: [{ key: "${thisYear}", realizedPnl: ${monthPnl}, trades: 5, wins: 2, losses: 3, fees: 400, taxes: 900, dividendsNet: 25000, winRate: 40,
        dividendTax: { dividendGross: 40000, payments: 2, nhiQualifyingCount: 1, nhiPremiumEstimate: 528, creditableEstimate: 3400, separateTaxEstimate: 11200, rates: { nhiRate: 0.0211, nhiThreshold: 20000, creditRate: 0.085, creditCap: 80000, separateRate: 0.28 } } }] };
    tradesState.settlement = { asOf: "${today}", calendarSource: "weekends-only", days: [] };
    tradesState.loaded = true;
    state.watchList = "hold";
    renderHoldingsPanel();
  `);
}

test("沒設停手線就不提醒；設了本月上限與連虧筆數，達到就在庫存頁與隔日沖總覽顯示橫幅", () => {
  app.evalIn(`saveDiscipline({ monthLossLimit: "", maxConsecutiveLosses: "" })`);
  seed();
  assert.equal(json(`Boolean(el.holdingsPanel.querySelector(".hold-discipline"))`), false);
  assert.equal(app.evalIn(`renderDisciplineBanner("inline")`), "");
  app.evalIn(`saveDiscipline({ monthLossLimit: 10000, maxConsecutiveLosses: 3 })`);
  seed();
  const banner = String(app.evalIn(`el.holdingsPanel.querySelector(".hold-discipline")?.textContent || ""`)).replace(/\s+/g, " ");
  assert.match(banner, /紀律提醒/);
  assert.match(banner, /本月已實現 -12,000，已到你設的本月虧損上限 10,000：這個月不再開新倉/);
  assert.match(banner, /已連虧 3 筆，達到你設的停手線 3 筆/);
  const inline = String(app.evalIn(`renderDisciplineBanner("inline")`));
  assert.match(inline, /hold-discipline is-inline/);
  assert.match(inline, /data-glossary-term="紀律提醒"/);
  // 只差一點就不提醒：本月 −9,999、連虧 2
  seed({ monthPnl: -9999, streak: 2 });
  assert.equal(json(`Boolean(el.holdingsPanel.querySelector(".hold-discipline"))`), false);
  assert.deepEqual(json(`evaluateDiscipline().breaches`), []);
});

test("設定表單：儲存到本機偏好、重繪保留、清空即關閉", () => {
  app.evalIn(`saveDiscipline({ monthLossLimit: "", maxConsecutiveLosses: "" })`);
  seed();
  const saved = json(`(() => {
    const form = el.holdingsPanel.querySelector("[data-discipline-settings]");
    form.elements.monthLossLimit.value = "15000";
    form.elements.maxConsecutiveLosses.value = "4";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return { state: disciplineState, stored: JSON.parse(localStorage.getItem("stock1.discipline.v1")), inputs: [form.elements.monthLossLimit.value, form.elements.maxConsecutiveLosses.value],
      rerendered: [...el.holdingsPanel.querySelectorAll("[data-discipline-settings] input")].map((input) => input.value) };
  })()`);
  assert.deepEqual(saved.state, { monthLossLimit: 15000, maxConsecutiveLosses: 4 });
  assert.deepEqual(saved.stored, { monthLossLimit: 15000, maxConsecutiveLosses: 4 });
  assert.deepEqual(saved.rerendered, ["15000", "4"]);
  const text = String(app.evalIn(`el.holdingsPanel.querySelector("[data-discipline-settings] small").textContent`));
  assert.match(text, /目前連虧 3 筆/);
  app.evalIn(`saveDiscipline({ monthLossLimit: "", maxConsecutiveLosses: "" })`);
  assert.deepEqual(json(`disciplineState`), { monthLossLimit: null, maxConsecutiveLosses: null });
});

test("今年稅務估算行：股利總額、需扣補充保費的筆數與金額、抵減與分離課稅估算、證交稅與手續費，並明講是估算", () => {
  seed();
  const line = String(app.evalIn(`el.holdingsPanel.querySelector(".hold-tax-estimate")?.textContent || ""`)).replace(/\s+/g, " ");
  assert.match(line, /今年稅務估算 股利總額 40,000（2 筆，其中 1 筆 ≥ 2 萬需扣二代健保約 528）；合併計稅可抵減約 3,400、分離課稅約 11,200；證交稅 900、手續費 400。皆為估算，非申報依據。/);
});
