// D-21 的前端面：技術頁改成跑在還原後的價格上之後，畫面必須把三件事講清楚——
//   1. 圖上的歷史價格已經不是當時的實際成交價（不講就是騙人）。
//   2. 估算還原要標「疑似」，不可寫成一定發生過除權息。
//   3. 後端停掉型態結論時，文案不能沿用「尚未滿足條件」——那是把「沒評估」講成「評估過但沒過」。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const officialCorporateActions = {
  adjusted: true,
  source: "official",
  events: [{ date: "20260612", source: "official", ratio: 0.92 }],
  unresolvedDates: [],
  heuristicAllowed: true,
  alert: false,
  notes: ["圖上歷史價格已依官方除權息公告還原 1 次，與當時的實際成交價不同；最新一根維持實際價格。"],
};

const details = (data) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  const host = document.createElement("div");
  host.innerHTML = renderTechnicalDetails(${JSON.stringify(data)});
  return {
    text: host.textContent.replace(/\\s+/g, " ").trim(),
    hasChecks: Boolean(host.querySelector(".technical-checks")),
  };
})())`));

const activeSignals = {
  breakout: true,
  breakdown: false,
  longWatch: true,
  risks: [],
  signals: ["突破壓力線"],
  checks: { closeAboveResistance: true, macdOk: true, volumeAbove20: true, aboveMovingAverages: true },
};

test("D-21：還原權息明細要列出事件日期、比率與來源", () => {
  const out = details({ signals: activeSignals, fibonacci: { active: false }, corporateActions: officialCorporateActions });
  assert.match(out.text, /還原權息/);
  assert.match(out.text, /06\/12/, `事件日期要看得到：${out.text}`);
  assert.match(out.text, /0\.92/, "還原比率要看得到");
  assert.match(out.text, /官方/);
  assert.match(out.text, /與當時的實際成交價不同/, "必須明講圖上的價格不是當時的成交價");
  assert.equal(out.hasChecks, true, "沒有停判時四項條件照常呈現");
});

test("D-21：估算還原要標成疑似，不得寫成確定的除權息", () => {
  const out = details({
    signals: activeSignals,
    fibonacci: { active: false },
    corporateActions: {
      adjusted: true,
      source: "heuristic",
      events: [{ date: "20260612", source: "heuristic", ratio: 0.88 }],
      unresolvedDates: [],
      heuristicAllowed: true,
      alert: true,
      notes: ["另有 1 次為「疑似公司行動」的跳空估算還原（非官方確認），僅供圖形參考。"],
    },
  });
  assert.match(out.text, /估算/, `來源要標成估算：${out.text}`);
  assert.match(out.text, /疑似公司行動/);
  assert.doesNotMatch(out.text, /依官方除權息公告還原/, "沒有官方公告就不能宣稱依公告還原");
});

test("D-21：後端停判時不得沿用「尚未滿足條件」的說法", () => {
  const out = details({
    signals: {
      breakout: false, breakdown: false, longWatch: false,
      suppressed: "corporate-action-unresolved",
      risks: [], signals: [],
      checks: { closeAboveResistance: false, macdOk: false, volumeAbove20: false, aboveMovingAverages: false },
    },
    fibonacci: { active: false },
    corporateActions: {
      adjusted: false, source: "", events: [], unresolvedDates: ["20260612"],
      heuristicAllowed: true, alert: true,
      notes: ["2026/06/12 官方公司行動的公式欄位尚未齊備，該日之前的價格未經正確還原，暫不提供型態結論。"],
    },
  });
  assert.equal(out.hasChecks, false, "四項條件都沒評估，不能畫成評估過但沒過的灰勾");
  assert.match(out.text, /都沒有評估/);
  assert.match(out.text, /暫不判讀突破與風險/);
  assert.doesNotMatch(out.text, /尚未出現明確突破訊號/, "這句話預設「已經評估過」");
  assert.doesNotMatch(out.text, /目前沒有觸發風險條件/);
});

test("D-21：舊 payload 沒有 corporateActions 欄位時不得炸掉", () => {
  const out = details({ signals: activeSignals, fibonacci: { active: false } });
  assert.doesNotMatch(out.text, /還原權息/, "沒有資料就不要憑空生出一個區塊");
  assert.equal(out.hasChecks, true);
});

// 上方那條醒目提示的升級規則：純官方還原不掛警示（台股年年配息，天天亮等於沒亮），
// 只有估算還原或官方欄位不齊才升級。
const statusBar = (corporateActions, signals) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  technicalState.loading = false;
  technicalState.error = "";
  technicalState.data = {
    ok: true, code: "2330", name: "台積電", period: "day", asOf: "2026/07/03",
    candles: [
      { date: "2026/07/02", open: 92, high: 92, low: 92, close: 92, volumeLots: 1000, maShort: 92, maMid: 92, macd: { dif: 0, dea: 0, histogram: 0 } },
      { date: "2026/07/03", open: 92, high: 92, low: 92, close: 92, volumeLots: 1000, maShort: 92, maMid: 92, macd: { dif: 0, dea: 0, histogram: 0 } }
    ],
    signals: ${JSON.stringify(signals)},
    fibonacci: { active: false },
    trendLines: { support: null, resistance: null },
    corporateActions: ${JSON.stringify(corporateActions)},
  };
  state.technicalCode = "2330";
  state.technicalPeriod = "day";
  renderTechnicalAnalysis();
  return {
    hidden: Boolean(el.technicalStatus.hidden),
    text: (el.technicalStatus.textContent || "").replace(/\\s+/g, " ").trim(),
    badge: (el.technicalBadge.textContent || "").trim(),
    summary: (el.technicalSummary.textContent || "").replace(/\\s+/g, " ").trim(),
  };
})())`));

test("D-21：純官方還原不掛醒目提示，資訊放在下方明細就好", () => {
  const out = statusBar(officialCorporateActions, activeSignals);
  assert.equal(out.hidden, true, "年年配息都亮警示，等於沒有警示");
});

test("D-21：估算還原／官方欄位不齊要升級成醒目提示", () => {
  const estimated = statusBar({
    ...officialCorporateActions,
    source: "heuristic",
    alert: true,
    notes: ["另有 1 次為「疑似公司行動」的跳空估算還原（非官方確認），僅供圖形參考。"],
  }, activeSignals);
  assert.equal(estimated.hidden, false);
  assert.match(estimated.text, /疑似公司行動/);

  const suppressedSignals = {
    breakout: false, breakdown: false, longWatch: false,
    suppressed: "corporate-action-unresolved",
    risks: [], signals: [],
    checks: { closeAboveResistance: false, macdOk: false, volumeAbove20: false, aboveMovingAverages: false },
  };
  const unresolved = statusBar({
    adjusted: false, source: "", events: [], unresolvedDates: ["20260612"],
    heuristicAllowed: true, alert: true,
    notes: ["2026/06/12 官方公司行動的公式欄位尚未齊備，該日之前的價格未經正確還原，暫不提供型態結論。"],
  }, suppressedSignals);
  assert.equal(unresolved.hidden, false);
  assert.match(unresolved.text, /暫不提供型態結論/);
  assert.match(unresolved.badge, /暫不判讀/, "徽章不能還掛著「技術觀察」");
  assert.doesNotMatch(unresolved.summary, /尚未同時滿足/, "沒評估就不能說沒滿足");
});

// 「壓力 3669.71」＋「目前沒有明確突破或跌破」同時出現，而收盤 3750 就在那條線上方
// ——邏輯沒錯（那次突破不是今天），但那句話把「不是今天」講成了「沒有」。
// 2454 聯發科 2026-07-24 實機截圖抓到的。
const trendPanel = (signals) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  technicalState.loading = false;
  technicalState.error = "";
  technicalState.data = {
    ok: true, code: "2454", name: "聯發科", period: "day", asOf: "2026/07/24",
    candles: [
      { date: "2026/07/23", open: 3900, high: 3950, low: 3860, close: 3880, volumeLots: 9000, maShort: 3697, maMid: 3883, macd: { dif: -80.98, dea: -111.09, histogram: 25 } },
      { date: "2026/07/24", open: 3805, high: 4010, low: 3750, close: 3750, volumeLots: 8371, maShort: 3697, maMid: 3883, macd: { dif: -80.98, dea: -111.09, histogram: 30.11 } }
    ],
    signals: ${JSON.stringify(signals)},
    fibonacci: { active: false },
    trendLines: {
      support: null,
      resistance: { valueAtLast: 3669.71, points: [{ date: "2026/06/20", price: 4200 }, { date: "2026/07/10", price: 3900 }] },
    },
    corporateActions: { adjusted: false, source: "", notes: [], events: [] },
  };
  state.technicalCode = "2454";
  state.technicalPeriod = "day";
  renderTechnicalAnalysis();
  const cards = [...el.technicalSummary.querySelectorAll("article")];
  const card = cards.find((c) => (c.querySelector("span")?.textContent || "").trim() === "趨勢線");
  return { state: (card?.querySelector("strong")?.textContent || "").trim(), text: (card?.querySelector("p")?.textContent || "").trim() };
})())`));

test("已站在壓力線上方但不是今天突破：不可說成「沒有明確突破」", () => {
  const out = trendPanel({ breakout: false, breakdown: false, aboveResistance: true, belowSupport: false, risks: [], signals: [], checks: {} });
  assert.equal(out.state, "壓力線上方", `狀態要講出來（實際「${out.state}」）`);
  assert.match(out.text, /已在壓力線上方/);
  assert.match(out.text, /不是今天/, "要點明是狀態不是今天的事件");
  assert.doesNotMatch(out.text, /沒有明確突破/, "價格就在線上方，不可說沒有突破");
});

test("今天剛突破 → 仍講「突破壓力線」", () => {
  const out = trendPanel({ breakout: true, breakdown: false, aboveResistance: true, belowSupport: false, risks: [], signals: ["突破壓力線"], checks: {} });
  assert.equal(out.state, "突破壓力線");
  assert.match(out.text, /收盤價突破近期壓力線/);
});

test("真的在區間內 → 才說「沒有明確突破或跌破」", () => {
  const out = trendPanel({ breakout: false, breakdown: false, aboveResistance: false, belowSupport: false, risks: [], signals: [], checks: {} });
  assert.equal(out.state, "區間觀察");
  assert.match(out.text, /目前沒有明確突破或跌破/);
});
