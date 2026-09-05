// 決策工具（第三欄）：部位控管（建議張數）、計畫→到價提醒一鍵、市場位階一行、持股集中度、
// 驗證口徑並陳（次日開盤進場／全版本合併）。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("positionSizeLots：資金 × 風險% ÷ 每張損失，向下取整；停損不在進場下方或資金未填回 null", () => {
  assert.deepEqual(json(`positionSizeLots(500000, 1, 100, 95)`), { lots: 1, budget: 5000, perLotLoss: 5000, lotCost: 100000 });
  assert.deepEqual(json(`positionSizeLots(1000000, 2, 50, 47)`), { lots: 6, budget: 20000, perLotLoss: 3000, lotCost: 50000 });
  assert.equal(json(`positionSizeLots(0, 1, 100, 95)`), null);
  assert.equal(json(`positionSizeLots(500000, 1, 95, 100)`), null);
  assert.equal(json(`positionSizeLots(500000, 1, 100, null)`), null);
});

test("波段卡片：填了資金才顯示建議張數，且以買得起的張數封頂；卡片有『建立三筆到價提醒』鈕", () => {
  const pick = { code: "2330", name: "台積電", price: 100, changePct: 1, score: 80, scenario: { key: "midBandDefense", name: "中軌攻防" }, plan: { entry: 100, structuralStop: 95, initialStop: 95, trailingTrigger: 105, target: 110, rr: 2, rrNet: 1.8 }, reasons: [], warnings: [] };
  const without = String(app.evalIn(`(() => { savePositionSizing({ capital: 0, riskPct: 1 }); return renderSwingCard(${JSON.stringify(pick)}, 1); })()`));
  assert.doesNotMatch(without, /建議張數/);
  assert.match(without, /data-plan-alerts="2330"/);
  assert.match(without, /data-plan-stop="95"/);
  const withCapital = String(app.evalIn(`(() => { savePositionSizing({ capital: 2000000, riskPct: 1 }); return renderSwingCard(${JSON.stringify(pick)}, 1); })()`));
  assert.match(withCapital, /建議張數/);
  assert.match(withCapital, /<strong>4 張<\/strong>/, "20000 ÷ 5000 ＝ 4 張，且 200 萬買得起");
  const capped = String(app.evalIn(`(() => { savePositionSizing({ capital: 250000, riskPct: 5 }); return renderSwingCard(${JSON.stringify(pick)}, 1); })()`));
  assert.match(capped, /<strong>2 張<\/strong>/, "12500 ÷ 5000 ＝ 2.5 → 2；25 萬買得起 2 張");
  assert.equal(json(`localStorage.getItem("stock1.capital.v1")`), "250000");
  app.evalIn(`savePositionSizing({ capital: 0, riskPct: 1 })`);
});

test("計畫→提醒：登入後一鍵建立三筆（停損 ≤、目標 ≥、移停 ≥），再按一次不重複；未登入只提示", () => {
  const result = json(`(() => {
    const prevUser = authState.user;
    authState.user = null;
    priceAlertsState.alerts = [];
    const anon = createPlanAlerts("2330", { structuralStop: 95, target: 110, trailingTrigger: 105 });
    authState.user = { id: "u1", username: "me", role: "user" };
    const first = createPlanAlerts("2330", { structuralStop: 95, target: 110, trailingTrigger: 105 });
    const alerts = priceAlertsState.alerts.map((a) => [a.code, a.op, a.price, a.note]);
    const second = createPlanAlerts("2330", { structuralStop: 95, target: 110, trailingTrigger: 105 });
    const count = priceAlertsState.alerts.length;
    priceAlertsState.alerts = [];
    authState.user = prevUser;
    return { anon, first, alerts, second, count };
  })()`);
  assert.deepEqual(result.anon, { created: 0, skipped: 0 });
  assert.deepEqual(result.first, { created: 3, skipped: 0 });
  assert.deepEqual(result.alerts, [["2330", "<=", 95, "結構停損"], ["2330", ">=", 110, "目標"], ["2330", ">=", 105, "啟動移停"]]);
  assert.deepEqual(result.second, { created: 0, skipped: 3 });
  assert.equal(result.count, 3);
});

test("市場位階一行：位階、漲跌家數、基差、事件；位階未知與無事件也講得出", () => {
  const html = String(app.evalIn(`(() => {
    marketBreadthState.data = { ok: true, taiex: { close: 24123.45, aboveMa20: true, aboveMa60: false }, breadth: { up: 812, down: 640, flat: 120, total: 1572, upRatio: 0.5165 }, basis: { points: -35.5 }, events: [{ date: "20260916", label: "台指期最後結算日", kind: "settlement" }], warnings: [] };
    return renderMarketStanceLine();
  })()`));
  assert.match(html, /大盤 24,123\.45・季線下・月線上/);
  assert.match(html, /漲 <span class="positive">812<\/span>／跌 <span class="negative">640<\/span>／平 120（上漲 52%）/);
  assert.match(html, /期指基差 -35\.5/);
  assert.match(html, /本週事件：09\/16 台指期最後結算日/);
  const unknown = String(app.evalIn(`(() => { marketBreadthState.data = { ok: true, taiex: null, breadth: { total: 0 }, basis: null, events: [], warnings: ["加權指數歷史暫時抓不到"] }; return renderMarketStanceLine(); })()`));
  assert.match(unknown, /大盤位階未知/);
  assert.match(unknown, /本週無結算／財報截止事件/);
  assert.match(unknown, /market-stance-warn/);
});

test("持股面板：前三大占比；≥60% 標警告色", () => {
  const html = String(app.evalIn(`(() => {
    const prevUser = authState.user;
    authState.user = { id: "u1", username: "me", role: "user" };
    tradesState.loaded = true;
    tradesState.records = [];
    tradesState.quarantinedRecords = [];
    tradesState.portfolio = { ok: true, holdings: [
      { code: "2330", shares: 1000, cost: 100000, avgCost: 100 },
      { code: "2317", shares: 1000, cost: 100000, avgCost: 100 },
      { code: "2454", shares: 1000, cost: 100000, avgCost: 100 },
      { code: "2603", shares: 1000, cost: 100000, avgCost: 100 },
    ], realized: [], totals: { cost: 400000, realizedPnl: 0 } };
    for (const [code, price] of [["2330", 500], ["2317", 100], ["2454", 100], ["2603", 100]]) {
      const existing = stocks.find((s) => s.code === code);
      if (existing) existing.price = price; else stocks.push({ code, name: code, price, change: 0 });
    }
    document.activeElement?.blur?.();
    state.watchList = "hold";
    renderHoldingsPanel();
    const out = el.holdingsPanel.innerHTML;
    authState.user = prevUser;
    return out;
  })()`));
  assert.match(html, /前三大占比/);
  assert.match(html, /<strong class="is-warn">88%<\/strong>/, "(500k+100k+100k) ÷ 800k ＝ 87.5% → 88%");
});

test("場景卡：次日開盤進場口徑與全版本合併一行", () => {
  const html = String(app.evalIn(`(() => {
    state.screen = "strategy";
    swingVerifyState.data = { ok: true, currentFormulaVersion: "v", formulaVersions: [{ formulaVersion: "v", samples: 5 }, { formulaVersion: "old", samples: 30 }], recent: [], pendingCount: 0,
      allVersions: { versions: 2, samples: 35, resolved: 25, wins: 12, winRate: 48 },
      scenarios: [{ scenario: "midBandDefense", samples: 5, wins: 2, losses: 1, expired: 0, pending: 2, resolved: 3, continuousResolved: 3, winRate: null, winRateMinSamples: 20,
        nextOpenEntry: { resolved: 3, wins: 1, winRate: null, avgResultPct: -0.27, gapSkipped: 2 } }] };
    renderSwingVerifyPanel();
    return document.getElementById("swingVerify").innerHTML;
  })()`)).replace(/\s+/g, " ");
  assert.match(html, /次日開盤進場 1\/3（3 筆）・平均 -0\.27%・跳空略過 2/);
  assert.match(html, /全版本合併 48%（25 筆結案）/);
});
