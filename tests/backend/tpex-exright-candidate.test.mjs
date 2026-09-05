// 上櫃除權息日：整批收盤的 Change 是中文「除息」→ previousClose null → 以前兩個候選池都把它濾掉
//（2026-07-24 實測 6 檔上櫃事件當天整批缺席）。現在 getReferenceData 用逐檔月歷史當日列的
// exchangePreviousClose（上櫃逐檔的 close − change 就是官方參考價）補基準；查不到就保留 null 並 warning。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, tpexDailyCloseRow, compactToday } from "../helpers/fixtures.mjs";

const today = compactToday();
const roc = (compact) => `${Number(compact.slice(0, 4)) - 1911}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;

// TPEx tradingStock 列：[日期, 成交仟股, 成交仟元, 開, 高, 低, 收, 漲跌(相對參考價), 筆數]
// 參考價 262.5（前收 270 配息 7.5）、當日收 265 → 漲跌 +2.50。
const routes = [
  { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: () => [stockDayAllRow({ code: "2330", name: "台積電", close: 100 })] },
  {
    match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/,
    reply: () => [
      { ...tpexDailyCloseRow({ code: "6435", name: "大中", close: 265, open: 264, high: 266, low: 261, volume: 900000 }), Change: "除息" },
      tpexDailyCloseRow({ code: "5347", name: "世界", close: 50 }),
    ],
  },
  {
    match: /tpex\.org\.tw\/www\/zh-tw\/afterTrading\/tradingStock\?code=6435/,
    reply: () => ({ name: "大中", tables: [{ data: [[roc(today), "900", "238500", "264", "266", "261", "265", "2.50", "800"]] }] }),
  },
];

const { mod, mock } = await importServer({ routes });

test("整批 Change 是中文時，用逐檔月歷史的官方參考價補基準；候選池不再缺席、不發 warning", async () => {
  const reference = await mod.getReferenceData();
  const quote = reference.byCode.get("6435");
  assert.ok(quote, "上櫃列要在");
  assert.equal(quote.previousClose, 262.5, "參考價＝月歷史當日列的 close − change");
  assert.equal(quote.change, 2.5);
  assert.ok(Math.abs(quote.changePct - (2.5 / 262.5) * 100) < 1e-9, String(quote.changePct));
  assert.equal(quote.corporateActionBaseline, true, "下游要知道這個漲跌是相對參考價");
  assert.ok(!reference.warnings.some((w) => w.includes("查不到官方參考價")), reference.warnings.join(" | "));
  const other = reference.byCode.get("5347");
  assert.equal(other.corporateActionBaseline, undefined, "正常列不動");

  const picks = mod.preselectQuotes(reference, { halted: new Map(), delisted: new Set() }, today, 260);
  const codes = picks.map((item) => item?.quote?.code ?? item?.code);
  assert.ok(codes.includes("6435"), `候選池要含 6435：${codes.join(",")}`);
});

test("查不到參考價：保留 null（候選池仍濾掉）並發 warning；一次最多處理 TPEX_BASELINE_MAX_CODES 檔", async () => {
  const byCode = new Map([
    ["8888", { code: "8888", exchange: "TPEx", price: 30, change: null, previousClose: null, rawDate: today }],
    ["2330", { code: "2330", exchange: "TWSE", price: 100, change: 1, previousClose: 99, rawDate: today }],
  ]);
  const warnings = [];
  const result = await mod.restoreTpexCorporateActionBaselines(byCode, today, warnings);
  assert.deepEqual(result, { restored: 0, unresolved: ["8888"], cached: 0, timedOut: false });
  assert.equal(byCode.get("8888").previousClose, null, "查不到就不猜");
  assert.ok(warnings.some((w) => w.includes("8888") && w.includes("查不到官方參考價")), warnings.join(" | "));
  assert.equal(mod.TPEX_BASELINE_MAX_CODES, 40);
  const picks = mod.preselectQuotes({ byCode, warnings: [] }, { halted: new Map(), delisted: new Set() }, today, 260);
  assert.ok(!picks.some((item) => (item?.quote?.code ?? item?.code) === "8888"), "沒補到基準的仍不進候選池");
});

// ---- 第二輪第一批：參考價當天不會變，不可每 5 分鐘重抓；上游卡住時整批要有預算 ----
test("同一個 code:date 第二次不再打上游（日快取），byCode 照樣補到", async () => {
  const before = mock.callsFor(/tradingStock\?code=6435/).length;
  assert.ok(before >= 1, "第一個測試已經抓過一次");
  const byCode = new Map([["6435", { code: "6435", name: "大中", exchange: "TPEx", price: 265, change: null, previousClose: null, rawDate: today }]]);
  const warnings = [];
  const result = await mod.restoreTpexCorporateActionBaselines(byCode, today, warnings);
  assert.deepEqual(result, { restored: 1, unresolved: [], cached: 1, timedOut: false });
  assert.equal(byCode.get("6435").previousClose, 262.5);
  assert.equal(byCode.get("6435").corporateActionBaseline, true);
  assert.equal(mock.callsFor(/tradingStock\?code=6435/).length, before, "快取命中不得再打上游");
  assert.equal(warnings.length, 0);
});

test("上游永不回應：整批在預算內 resolve，該碼進 unresolved 並警告「逾時」，不卡住 getReferenceData", async () => {
  const byCode = new Map([["7777", { code: "7777", name: "卡住", exchange: "TPEx", price: 30, change: null, previousClose: null, rawDate: today }]]);
  const warnings = [];
  const started = Date.now();
  const result = await mod.restoreTpexCorporateActionBaselines(byCode, today, warnings, { budgetMs: 200 });
  assert.ok(Date.now() - started < 1500, "必須在預算附近就回來");
  assert.deepEqual(result, { restored: 0, unresolved: ["7777"], cached: 0, timedOut: true });
  assert.equal(byCode.get("7777").previousClose, null);
  assert.ok(warnings.some((w) => w.includes("逾時") && w.includes("7777")), warnings.join(" | "));
  assert.equal(mod.TPEX_BASELINE_BUDGET_MS, 8000);
});
