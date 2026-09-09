// 局部資訊順序（computer use 心得 F07／CUA-07）：核心任務入口不能被說明推到首屏外。
// 隔日沖 warnings 一則一整行、不限則數；已登入零持股仍先渲染整個持股計畫風險區才到「記第一筆」；
// 計畫彈窗容量長文在表單之前；手機技術頁四張摘要卡把圖表推到 830px 以下。這檔釘 DOM／CSS 結構，實際幾何由 browser 測試量。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

const WARNINGS = [
  "上市與上櫃整批收盤資料日尚未對齊（上市 2026/09/07、上櫃 2026/09/08），稍後會自動補齊。",
  "TWSE 注意股抓取失敗：官方今天還沒公布名單（或已清空），這一類先留空、稍後自動重試",
  "上市的收盤資料尚未更新到 2026/09/08，這份清單暫時只涵蓋已更新的市場，稍晚會自動補齊。",
  "官方除權除息計算結果表這一輪有部分月份沒抓到，除權息當天的漲跌幅與近 30 日回測數字可能失真；資料會在下一輪補齊。",
];

function renderOvernight(warnings) {
  return json(`(() => {
    const pick = (code, name) => ({ code, name, exchange: "TPEx", market: "上櫃", price: 55, changePct: 8.06, score: 96, rank: 1, asOf: "2026-09-08", reasons: ["漲幅 8.06%"], metrics: { volumeRatio5: 3.5 } });
    Object.assign(overnightState, { loaded: true, loading: false, error: "", asOf: "2026-09-08", source: "測試", surveillanceCount: 0,
      warnings: ${JSON.stringify(warnings)},
      groups: { strongContinuation: [pick("4923", "力士")], volumeDanger: [pick("5460", "同協")], pullbackReversal: [pick("6021", "美好證")] } });
    state.screen = "overnight"; state.overnightView = "overview";
    renderOvernightGroups();
    const block = el.overnightGroups.querySelector(".overnight-summary-warnings");
    const fold = block ? block.querySelector("details[data-overnight-warnings-fold]") : null;
    return {
      present: Boolean(block),
      // 常駐可見的部分：details 以外的子節點＋details 的 summary（收合時只有 summary 可見）
      visibleText: block ? [...block.children].map((node) => node.tagName === "DETAILS" ? (node.querySelector("summary")?.textContent || "") : node.textContent).join(" ").replace(/\\s+/g, " ") : "",
      foldText: fold ? fold.textContent.replace(/\\s+/g, " ") : null,
      foldOpen: fold ? fold.open : null,
      fullSpans: block ? block.querySelectorAll(".overnight-warning").length : 0,
      stanceButton: Boolean(el.overnightGroups.querySelector("[data-stance-warnings]")),
      summaryFlow: Boolean(el.overnightGroups.querySelector(".overnight-summary")),
    };
  })()`);
}

test("隔日沖四則警告：摘要只列前 2 則＋（另有 2 則），全文在原生 details，⚠ 按鈕與摘要條結構保留", () => {
  const view = renderOvernight(WARNINGS);
  assert.equal(view.present, true);
  assert.match(view.visibleText, /整批收盤資料日尚未對齊/, "第一則關鍵語意要在摘要");
  assert.match(view.visibleText, /注意股抓取失敗/, "第二則也在摘要");
  assert.match(view.visibleText, /另有 2 則/);
  assert.doesNotMatch(view.visibleText, /除權除息計算結果表/, "第 3、4 則全文不在常駐摘要");
  assert.ok(view.foldText, "要有原生 details 放全文（手機沒有 hover，不能只存 title）");
  assert.match(view.foldText, /除權除息計算結果表/);
  assert.match(view.foldText, /收盤資料尚未更新到 2026\/09\/08/);
  assert.equal(view.foldOpen, false, "預設收合");
  // 位階列的 ⚠ 按鈕來自 marketBreadthState 的警告（不是 overnightState.warnings），本檔不種 breadth 資料，不在此驗。
  assert.equal(view.summaryFlow, true);
});

test("隔日沖 ≤2 則警告：直接全文顯示，不需要 details", () => {
  const view = renderOvernight(WARNINGS.slice(0, 2));
  assert.match(view.visibleText, /整批收盤資料日尚未對齊/);
  assert.match(view.visibleText, /注意股抓取失敗/);
  assert.doesNotMatch(view.visibleText, /另有/);
  assert.equal(view.foldText, null);
  assert.equal(renderOvernight([]).present, false, "沒有警告就沒有警告區");
});

test("隔日沖警告 details：使用者展開後，行情重繪仍保持展開", () => {
  renderOvernight(WARNINGS);
  const kept = json(`(() => {
    const fold = el.overnightGroups.querySelector("details[data-overnight-warnings-fold]");
    fold.open = true;
    renderOvernightGroups();
    const after = el.overnightGroups.querySelector("details[data-overnight-warnings-fold]");
    return { open: after ? after.open : null };
  })()`);
  assert.equal(kept.open, true);
  app.evalIn(`el.overnightGroups.querySelector("details[data-overnight-warnings-fold]").open = false; renderOvernightGroups();`);
  assert.equal(json(`el.overnightGroups.querySelector("details[data-overnight-warnings-fold]").open`), false, "手動關閉後保持關閉");
});

test("已登入零持股：總覽之後緊接「記第一筆」入口與表單，風險區收成一句＋details 放在表單後", () => {
  const view = json(`(() => {
    authState.user = { id: "u1", username: "admin", role: "admin" };
    state.screen = "watchlist"; state.watchList = "hold";
    tradesState.schemaVersion = 2; tradesState.records = []; tradesState.quarantinedRecords = [];
    tradesState.portfolio = { holdings: [], realized: [], totals: { cost: 0, marketValue: 0, unrealizedPnl: 0, realizedPnl: 0 } };
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    renderHoldingsPanel();
    const html = el.holdingsPanel.innerHTML;
    const at = (needle) => html.indexOf(needle);
    return {
      summary: at('class="hold-summary"'), empty: at('class="hold-empty"'), form: at('data-trade-form'),
      riskSection: at('class="hold-plan-risk"'), riskFold: at('data-holdings-risk-fold'),
      emptyLine: (el.holdingsPanel.querySelector("[data-holdings-risk-empty]") || {}).textContent || "",
      riskSettingsForm: Boolean(el.holdingsPanel.querySelector("[data-holding-risk-settings]")),
    };
  })()`);
  assert.ok(view.summary >= 0 && view.empty > view.summary, "總覽後接空態");
  assert.ok(view.form > view.empty, "空態後接表單");
  assert.ok(view.riskFold > view.form, "風險區收進 details 且放在表單之後");
  assert.ok(view.riskSection > view.form, "零持股時表單之前不得再出現整個風險區");
  assert.match(view.emptyLine, /沒有庫存/, "零持股要說明沒有需要估算的風險，與「有持股但風險未知」分開");
  assert.equal(view.riskSettingsForm, true, "警示值設定仍可用（在 details 內）");
});

test("有持股時：風險區維持原位（總覽之後、清單之前），不因零持股改版而移動", () => {
  const view = json(`(() => {
    authState.user = { id: "u1", username: "admin", role: "admin" };
    state.screen = "watchlist"; state.watchList = "hold";
    stocks.length = 0; stocks.push({ code: "2330", name: "台積電", price: 1000, spark: [], groups: [], strategies: [], unit: 1, total: 1, turnover: 0, avgVol: null, change: 0, changeText: "0%", signal: "flat" });
    tradesState.schemaVersion = 2; tradesState.records = []; tradesState.quarantinedRecords = [];
    tradesState.portfolio = { holdings: [{ code: "2330", name: "台積電", shares: 1000, cost: 900000, avgPrice: 900 }], realized: [], totals: {} };
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    renderHoldingsPanel();
    const html = el.holdingsPanel.innerHTML;
    const at = (needle) => html.indexOf(needle);
    return { summary: at('class="hold-summary"'), risk: at('class="hold-plan-risk"'), list: at('class="hold-list"'), fold: at('data-holdings-risk-fold') };
  })()`);
  assert.ok(view.risk > view.summary && view.risk < view.list, "有持股時風險區在總覽與清單之間");
  assert.equal(view.fold, -1, "有持股時不收進 details");
});

test("交易計畫彈窗：容量長文收進原生「保存限制與匯出」details，主表單在它之前", () => {
  const modal = html.slice(html.indexOf('id="tradePlanModal"'));
  const form = modal.indexOf('id="tradePlanForm"');
  const limits = modal.indexOf("保存限制與匯出");
  const capacity = modal.indexOf("計畫與完整歷史容量 120 KiB");
  assert.ok(form > 0 && limits > 0 && capacity > 0);
  assert.ok(limits > form, "限制說明在表單之後");
  assert.ok(capacity > limits, "容量句在 details 內");
  const details = modal.slice(limits - 200, limits + 40);
  assert.match(details, /<details[^>]*>\s*<summary[^>]*>[^<]*保存限制與匯出/, "用原生 details＋summary");
  assert.doesNotMatch(modal.slice(0, form), /120 KiB/, "表單之前不再出現容量句");
  assert.match(modal, /data-action="download-personal-backup"/, "匯出入口保留");
});

test("技術頁手機：圖表卡 order 排在摘要卡之前（只在 760px 區塊內），桌機基底 order 不變", () => {
  assert.match(styles, /\.technical-summary\s*\{[^}]*order:\s*4;/, "桌機基底：摘要 4");
  assert.match(styles, /\.technical-chart-card\s*\{[^}]*order:\s*5;/, "桌機基底：圖表 5");
  const gridOverride = styles.search(/\.today-focus-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const mediaStart = styles.lastIndexOf("@media (max-width: 760px)", gridOverride);
  let depth = 0; let mediaEnd = -1;
  for (let index = styles.indexOf("{", mediaStart); index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    else if (styles[index] === "}") { depth -= 1; if (depth === 0) { mediaEnd = index; break; } }
  }
  const mobile = styles.slice(mediaStart, mediaEnd);
  assert.match(mobile, /\.technical-chart-card\s*\{[^}]*order:\s*4;/, "手機：圖表 4");
  assert.match(mobile, /\.technical-summary\s*\{[^}]*order:\s*5;/, "手機：摘要 5");
  const outside = styles.slice(0, mediaStart) + styles.slice(mediaEnd);
  assert.doesNotMatch(outside, /\.technical-chart-card\s*\{[^}]*order:\s*4;/, "圖表 order 4 不得出現在手機區塊外");
  const summaryIndex = html.indexOf('id="technicalSummary"');
  const chartIndex = html.indexOf('class="technical-chart-card"');
  assert.ok(summaryIndex > 0 && chartIndex > summaryIndex, "DOM 順序不變：摘要仍在圖表卡之前（只換 CSS order）");
});
