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
  assert.ok(app.evalIn(`el.swingVerify.querySelector('summary').textContent`).includes("最近 10 筆結案（共 12 筆）"));
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
