// 基本面前端：detail panel「基本面」籤的 5 顆 chip＋技術頁面板（長條/EPS/估值/除息）三態。
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
  code: "2330",
  shortName: "台積電",
  industry: "半導體業",
  revenue: {
    latest: { yearMonth: "2026-05", revenue: 416975163, yoy: 30.09, mom: 1.52, cumYoy: 29.97 },
    history: [
      { period: "2026-03", revenue: 380000000, yoy: 25.1 },
      { period: "2026-04", revenue: 410000000, yoy: -3.2 },
      { period: "2026-05", revenue: 416975163, yoy: 30.09 },
    ],
  },
  eps: {
    latest: { period: "2026Q1", eps: 22.08 },
    history: [
      { period: "2025Q4", eps: 20.1 },
      { period: "2026Q1", eps: 22.08 },
    ],
  },
  valuation: { pe: 33.68, dividendYield: 0.88, pbr: 11.03, dps: null, asOf: "20260701" },
  dividends: [{ exDate: "20260706", kind: "除息", cashDividend: 4.5, stockRatio: 0 }],
  warnings: [],
};

test("fundamentalsChips：資料齊全 → 5 顆 chip（月營收億／YoY／EPS／本益比／殖利率）", () => {
  const chips = json(`fundamentalsChips({ data: ${JSON.stringify(sample)} })`);
  assert.equal(chips.length, 5);
  assert.equal(chips[0].label, "5月營收");
  assert.ok(chips[0].value.includes("億"), `月營收要換算成億：${chips[0].value}`);
  assert.ok(chips[1].value.includes("30.09"), `YoY：${chips[1].value}`);
  assert.equal(chips[2].label, "EPS Q1");
  assert.equal(chips[3].value, "33.68");
  assert.ok(chips[4].value.endsWith("%"));
});

// 三態必須分辨得出來，但「狀態」不再佔一個數字格——它是句子，塞進 111px 的格子必然截字
// （實測「基本面載入中」溢出 21px），而且會讓 5 格變 6 格、長出只填 1/3 的孤行。
// 改由 fundamentalsNote 承擔，斷言的意圖不變、只換位置。
test("fundamentalsChips／fundamentalsNote：載入中／失敗／無資料 三態", () => {
  assert.equal(json(`fundamentalsNote({ loading: true })`), "基本面載入中");
  assert.match(json(`fundamentalsNote({ error: "boom" })`), /失敗/);
  assert.match(json(`fundamentalsNote(null)`), /尚未取得/);
  assert.equal(json(`fundamentalsNote({ data: { ok: true } })`), "", "有資料就不該再留狀態字");

  // 無資料時 5 格的 label 要與有資料時一一對應，切分頁時格子才不會跳。
  const loading = json(`fundamentalsChips({ loading: true })`);
  assert.equal(loading.length, 5);
  assert.deepEqual(loading.map((c) => c.value), ["N/A", "N/A", "N/A", "N/A", "N/A"]);
  assert.deepEqual(loading.map((c) => c.tone), ["na", "na", "na", "na", "na"], "沒資料時不得有紅綠黃紫");

  // 有 data 但欄位為空是另一種情形：格子仍給 --，不是 N/A。
  const empty = json(`fundamentalsChips({ data: { ok: true, revenue: null, eps: null, valuation: null, dividends: [] } })`);
  assert.equal(empty[0].value, "--");
  assert.equal(empty[3].value, "--", "缺估值 → --");
});

test("renderFundamentalsPanel：長條數＝歷史期數、YoY 負值配綠、顯示實際資料年月與除息", () => {
  app.evalIn(`
    state.technicalCode = "2330";
    fundamentalsState.byCode.set("2330", { loading: false, error: "", at: Date.now(), data: ${JSON.stringify(sample)} });
    renderFundamentalsPanel();
  `);
  assert.equal(json(`el.fundamentalsPanel.hidden`), false);
  assert.equal(json(`el.fundamentalsPanel.querySelectorAll('.rev-bar').length`), 3);
  assert.equal(json(`el.fundamentalsPanel.querySelectorAll('.rev-bar.is-down').length`), 1, "2026-04 YoY 負 → 綠柱");
  const text = app.evalIn(`el.fundamentalsPanel.textContent`);
  assert.ok(text.includes("2026-05"), "要顯示實際資料年月（不能寫死「上月」）");
  assert.ok(text.includes("除息") && text.includes("07/06"), `除息列：${text}`);
  assert.ok(text.includes("33.68"));
  assert.ok(text.includes("22.08"));
});

test("renderFundamentalsPanel：無代號 → 隱藏；載入中 → 顯示載入字樣", () => {
  app.evalIn(`state.technicalCode = ""; renderFundamentalsPanel();`);
  assert.equal(json(`el.fundamentalsPanel.hidden`), true);
  app.evalIn(`
    state.technicalCode = "9999";
    fundamentalsState.byCode.set("9999", { loading: true, error: "", at: Date.now(), data: null });
    renderFundamentalsPanel();
  `);
  assert.ok(app.evalIn(`el.fundamentalsPanel.textContent`).includes("載入中"));

  app.evalIn(`
    state.technicalCode = "2330";
    fundamentalsState.byCode.set("2330", {
      loading: false,
      error: "",
      at: Date.now(),
      data: ${JSON.stringify({ ...sample, dividends: [], freshness: { dividends: { status: "unavailable" } }, warnings: ["上市除權息來源不可用，目前無法確認是否有公告。"] })}
    });
    renderFundamentalsPanel();
  `);
  const unavailableText = app.evalIn(`el.fundamentalsPanel.textContent`);
  assert.match(unavailableText, /除權息來源暫時無法確認/);
  assert.doesNotMatch(unavailableText, /近期無除權息/);

  app.evalIn(`
    fundamentalsState.byCode.set("2330", {
      loading: false,
      error: "",
      at: Date.now(),
      data: ${JSON.stringify({ ...sample, dividends: [], freshness: { dividends: { status: "stale" } }, warnings: ["上市除權息來源更新失敗，目前沿用最後成功資料。"] })}
    });
    renderFundamentalsPanel();
  `);
  assert.match(app.evalIn(`el.fundamentalsPanel.textContent`), /沿用資料中未見近期除權息/);
});
