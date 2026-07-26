// DOMAIN-BACKLOG 第二層的回歸契約（不改變選股結果，只讓數字誠實／解除卡住）：
// D-26 驗證單因官方日 K 缺漏卡死後永遠不會進分母，90 天後被無差別刪除，損耗完全看不見。
// D-31 同日多筆買賣缺成交時間時只能依記帳先後排序，合法紀錄被判賣超卻沒告訴使用者怎麼解。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};
const pendingEntry = (code, gapFrom) => ({
  code, scenario: "midBandDefense", status: "pending", entry: 100, stop: 95, target: 110,
  lastChecked: "20260601", daysHeld: 2, formulaVersion: mod.SWING_FORMULA_VERSION,
  ...(gapFrom ? { dataGap: { from: gapFrom, through: gapFrom } } : {}),
});

// ---- D-26 ----

test("D-26：缺口久到不可能自行結案的驗證單要被標為卡住並計數", async () => {
  const db = await mod.loadDb();
  db.swingVerification = {
    20260601: [
      pendingEntry("1111", daysAgo(60)), // 缺口 60 天 → 卡住
      pendingEntry("2222", daysAgo(3)),  // 缺口 3 天 → 還在正常等待
      pendingEntry("3333", null),        // 沒有缺口 → 正常 pending
    ],
  };
  await mod.saveDb(db);
  // saveDb 不會動摘要快取（只有 recordSwingVerification／advanceSwingVerification 會），
  // 不清就會拿到前一個測試留下的 10 分鐘快取值。
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  const scenario = summary.scenarios.find((item) => item.scenario === "midBandDefense");

  assert.equal(scenario.pending, 3, "三筆都還沒結案");
  assert.equal(scenario.stalled, 1, "只有久到不可能結案的那筆算卡住");
  assert.equal(summary.stalledCount, 1);
  assert.equal(summary.dataGapCount, 2, "有缺口的是兩筆，但其中一筆還在合理等待期內");

  // 健康的 pending 最多 15 個交易日（約 3 週）就會結案，所以「有缺口」不等於「卡住」，
  // 兩個數字必須分開，否則剛好遇到單日缺 K 的正常單也會被算成損耗。
  assert.notEqual(summary.stalledCount, summary.dataGapCount);
});

test("D-26：分母損耗必須在 notes 明講，不能只放一個數字", async () => {
  const summary = await mod.buildSwingVerificationSummary();
  const note = summary.notes.join(" ");
  assert.match(note, /卡住/);
  assert.match(note, /不會進入勝率分母|永遠不會進入勝率分母/, "要說清楚它們不進分母");
});

// ---- D-01 子項 1（停等的可見性）----

// 停等是自癒的暫時狀態（官方比率通常隔天到齊），但「今天沒有推進」必須跟「今天沒有變化」
// 長得不一樣，否則使用者無從分辨。而久到不可能自癒的停等就是分母損耗，要一起算進「卡住」。
test("D-01：公司行動停等要單獨計數，久到不自癒時併入卡住", async () => {
  const holdEntry = (code, from) => ({
    ...pendingEntry(code, null),
    corporateActionPending: { from, reason: "官方公告", detectedAt: new Date().toISOString() },
  });
  const db = await mod.loadDb();
  db.swingVerification = {
    20260601: [
      holdEntry("4444", daysAgo(1)),  // 昨天的除權息，等官方比率 → 正常停等
      holdEntry("5555", daysAgo(60)), // 60 天還沒解開 → 不可能自癒，算卡住
      pendingEntry("6666", null),     // 正常 pending
    ],
  };
  await mod.saveDb(db);
  // saveDb 不會動摘要快取（只有 recordSwingVerification／advanceSwingVerification 會），
  // 不清就會拿到前一個測試留下的 10 分鐘快取值。
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  const scenario = summary.scenarios.find((item) => item.scenario === "midBandDefense");

  assert.equal(summary.corporateActionPendingCount, 2, "兩筆在等官方比率");
  assert.equal(summary.dataGapCount, 0, "停等不是缺 K，不可混進 dataGap");
  assert.equal(summary.stalledCount, 1, "只有久到不自癒的那筆算卡住");
  assert.equal(scenario.stalled, 1);
  assert.equal(scenario.pending, 3);
});

test("D-01：停等的處理方式要在 notes 說明，不能只給一個數字", async () => {
  const summary = await mod.buildSwingVerificationSummary();
  const note = summary.notes.join(" ");
  assert.match(note, /除權息|公司行動/);
  assert.match(note, /暫停推進|停等/, "要說明它是暫停判定而不是已經判定");
  assert.match(note, /假停損|事件前/, "要講清楚不停等會發生什麼事");
});

// ---- D-31 ----

test("D-31：賣超錯誤訊息要告訴使用者自救方式（補填成交時間、補登公司行動）", () => {
  const settings = { feeDiscount: 0.6, minFee: 20 };
  // 照對帳單謄寫時先記賣出、後記買進：兩筆都沒填成交時間 → 只能依記帳先後排序 → 誤判賣超。
  const payload = mod.normalizeTradesPayload({
    schemaVersion: 2,
    settings,
    records: [
      { id: "s1", code: "2330", side: "sell", instrumentType: "stock", tradeDate: "20260601", price: 110, shares: 1000, dayTrade: { status: "none" }, createdAt: "2026-06-01T10:00:00Z" },
      { id: "b1", code: "2330", side: "buy", instrumentType: "stock", tradeDate: "20260601", price: 100, shares: 1000, dayTrade: { status: "none" }, createdAt: "2026-06-01T11:00:00Z" },
    ],
  });
  const portfolio = mod.buildPortfolio(payload);
  assert.equal(portfolio.ok, false, "特徵化現行行為：同日順序反了就會判賣超");
  assert.match(portfolio.error, /成交時間/, "必須告訴使用者補填成交時間可以解決");
  assert.match(portfolio.error, /除權配股|公司行動/, "另一個常見原因是漏登除權配股");
  assert.match(portfolio.error, /賣超/, "原本的診斷資訊要保留");
});

test("D-31：兩筆都填了成交時間就會正確排序，不再誤判", () => {
  const settings = { feeDiscount: 0.6, minFee: 20 };
  const payload = mod.normalizeTradesPayload({
    schemaVersion: 2,
    settings,
    records: [
      { id: "s1", code: "2330", side: "sell", instrumentType: "stock", tradeDate: "20260601", price: 110, shares: 1000, dayTrade: { status: "none" }, executedAt: "2026-06-01T05:20:00Z", createdAt: "2026-06-01T10:00:00Z" },
      { id: "b1", code: "2330", side: "buy", instrumentType: "stock", tradeDate: "20260601", price: 100, shares: 1000, dayTrade: { status: "none" }, executedAt: "2026-06-01T01:05:00Z", createdAt: "2026-06-01T11:00:00Z" },
    ],
  });
  const portfolio = mod.buildPortfolio(payload);
  assert.equal(portfolio.ok, true, `填了成交時間就該通過：${portfolio.error || ""}`);
});
