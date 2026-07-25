// DOMAIN-BACKLOG 第一層修復的回歸契約（2026-07-26 起逐條清理）：
// D-05 官方成交金額本來就有、只是沒解析 → 當日 K 的 tradeValue 恆 null，害每一檔都被標「低流動性」。
// D-01 回測側 nextDayPerformance 仍用未還原價，隔日除息會憑空記出大跌。
// D-10 同一檔同時命中兩個分群時，整體 summary 的分母把它當成兩個獨立樣本。
// D-12 個股健檢沒有普通股過濾，對無漲跌幅限制的 ETF 套 10.5% 跳空 heuristic。
// D-03 逐月歷史缺月被靜默吞掉，跨月的正常漲跌被 10.5% 門檻誤判成公司行動。
// D-09 股利紀錄被 canonicalize 跳過，client 可自稱 estimated 並夾帶假匯費。
// D-04 computeMacd 沒有 warm-up 保護，月 K 從第 0 根就吐被 seed 主導的假動能。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay, stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

// 觀察日必須是交易日（週末跑測試時日曆今天不成立），所以整份 reference 都釘在 compactTradingDay(0)。
const OBSERVE_DAY = compactTradingDay(0);
const { mod, mock, dataDir } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: [
      { ...stockDayAllRow({ code: "0050", name: "元大台灣50", close: 200 }), Date: OBSERVE_DAY },
      // 訊號價 100 → 觀察日開 103 高 104 低 97 收 102：+3% / +4%（達標）/ −3%（破線）/ +2%
      {
        ...stockDayAllRow({ code: "2330", name: "台積電", close: 102, open: 103, high: 104, low: 97 }),
        Date: OBSERVE_DAY,
        Change: "2.0000",
      },
    ] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: [] },
    { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: { msgArray: [] } },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: [{ Date: OBSERVE_DAY }] },
    { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: [] },
    { match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: { stat: "OK", data: [] } },
  ],
});

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

// ---- D-05 ----

test("D-05：官方整批收盤的成交金額要被解析出來（上市與上櫃）", () => {
  const twse = mod.normalizeDailyTwse(stockDayAllRow({ code: "2330", close: 1000, volume: 30_000_000 }));
  const tpex = mod.normalizeDailyTpex(tpexDailyCloseRow({ code: "6127", close: 90, volume: 100_000 }));
  assert.equal(twse.tradeValue, 30_000_000 * 1000, "TWSE TradeValue 欄位");
  assert.equal(tpex.tradeValue, 100_000 * 90, "TPEx TransactionAmount 欄位");
});

test("D-05：補上去的當日 K 要沿用報價的成交金額，不可寫死 null", () => {
  const base = [{ date: "2026/07/23", rawDate: "20260723", open: 99, high: 101, low: 98, close: 100, volumeLots: 1000 }];
  const quote = {
    code: "2330", exchange: "TWSE", rawDate: "20260724", asOf: "2026/07/24",
    open: 100, high: 103, low: 99, price: 102, previousClose: 100,
    volumeLots: 2000, tradeValue: 204_000_000, transactions: 5000,
  };
  const appended = mod.appendTodayCloseBar(base, quote, "20260724");
  assert.equal(appended.length, 2, "應補上當日 K");
  assert.equal(appended.at(-1).tradeValue, 204_000_000);
});

test("D-05：「成交值未知」與「低流動性」必須分開，權值股不得被誤標", () => {
  const metrics = (tradeValue) => ({ tradeValue, volumeRatio5: 1, amplitudePct: 2, closePosition: 0.8, turnover: 1 });
  assert.deepEqual(mod.buildRiskTags(metrics(3e10)), [], "300 億成交值不該有任何流動性警示");
  assert.deepEqual(mod.buildRiskTags(metrics(1e7)), ["低流動性"], "1000 萬確實偏低");
  assert.deepEqual(mod.buildRiskTags(metrics(null)), ["成交值未知"], "查不到 ≠ 很低");
  assert.deepEqual(mod.buildRiskTags(metrics(undefined)), ["成交值未知"]);
});

// ---- D-01 ----

test("D-01：回測的隔日報酬遇除權息要以交易所官方參考價為基準", () => {
  // 訊號日收 100；隔日除息 5 元（官方昨收＝參考價 95），當天開 95 高 96 低 94.5 收 95.5。
  // 未修正前 lowReturn = (94.5−100)/100 = −5.5% → 必然誤記 brokeMinus2。
  const perf = mod.nextDayPerformance([
    { close: 100 },
    { open: 95, high: 96, low: 94.5, close: 95.5, previousClose: 95, date: "2026/07/27" },
  ], 0);
  assert.equal(perf.openReturn, 0, "以參考價 95 開盤 → 平盤");
  assert.equal(perf.brokeMinus2, false, "除息跳空不是真實跌幅");
  assert.equal(perf.hitPlus2, false);
  assert.ok(Math.abs(perf.closeReturn - 0.5263) < 0.001, `closeReturn=${perf.closeReturn}`);
});

test("D-01：沒有公司行動時基準不變（防線不可過度收緊）", () => {
  const perf = mod.nextDayPerformance([
    { close: 100 },
    { open: 101, high: 102, low: 98, close: 99.5, previousClose: 100, date: "2026/07/27" },
  ], 0);
  assert.equal(perf.openReturn, 1);
  assert.equal(perf.highReturn, 2);
  assert.equal(perf.lowReturn, -2);
  assert.equal(perf.hitPlus2, true);
  assert.equal(perf.brokeMinus2, true);
});

test("D-01：官方昨收缺值時退回訊號日收盤，維持既有行為", () => {
  const perf = mod.nextDayPerformance([
    { close: 100 },
    { open: 101, high: 102, low: 98, close: 99.5, date: "2026/07/27" },
  ], 0);
  assert.equal(perf.openReturn, 1);
  assert.equal(perf.highReturn, 2);
});

// ---- D-10 ----

test("D-10：同一檔命中兩個分群時，整體 summary 的分母只算一次", async () => {
  const D0 = compactTradingDay(-1);
  const D1 = compactTradingDay(0);
  const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  // 同一檔同時進「強勢續攻」與「回檔轉強」——三段 if 沒有 else，這是引擎常態不是異常輸入。
  const pick = (group, groupName, score) => ({
    code: "2330", name: "台積電", exchange: "TWSE", group, groupName, price: 100, score,
  });
  const db = await mod.loadDb();
  db.signalSnapshots = [{
    asOf: iso(D0),
    savedAt: "",
    formulaVersion: mod.OVERNIGHT_FORMULA_VERSION,
    picks: [pick("strongContinuation", "強勢續攻", 80), pick("pullbackReversal", "回檔轉強", 60)],
  }];
  await mod.saveDb(db);

  const body = await mod.buildSignalVerification();
  assert.equal(body.available, true, JSON.stringify(body).slice(0, 200));
  assert.equal(body.rows.length, 2, "逐筆明細仍保留兩筆，分群統計要用");
  assert.equal(body.summary.total, 1, "整體統計的分母以「檔」為單位，同一檔只能算一次");
  assert.equal(body.uniqueSignals, 1);
  assert.equal(body.duplicatedSignals, 1, "要把重複筆數揭露出來");
  assert.equal(body.summaryByGroup.strongContinuation.total, 1);
  assert.equal(body.summaryByGroup.pullbackReversal.total, 1, "分群各自看到自己那筆");
});

// ---- D-03 ----

const gapDay = (iso, close) => ({ date: iso, open: close, high: close * 1.01, low: close * 0.99, close, volumeLots: 1000 });
const closesOf = (rows) => rows.map((row) => Math.round(row.close * 100) / 100);

test("D-03：歷史缺一整月時，跨月的正常漲跌不得被當成公司行動還原", () => {
  // 逐月歷史抓取失敗會被 .catch(() => []) 吞成空陣列，flat().sort() 把缺月前後直接接起來。
  // 100 → 118 是一個月的正常漲幅，舊寫法會被 10.5% 門檻判成公司行動，
  // 缺口以前所有價格被乘上 1.18，MA60／布林／MACD 一起錯。
  const rows = [gapDay("2026/05/28", 99), gapDay("2026/06/01", 100), gapDay("2026/07/01", 118), gapDay("2026/07/02", 119)];
  const adjusted = mod.backAdjustForCorporateActions(rows, null, { allowHeuristicFallback: true });
  assert.deepEqual(closesOf(adjusted), [99, 100, 118, 119], "跨資料缺口不得套用 heuristic");
});

test("D-03：相鄰交易日的真跳空仍要偵測並還原（防線不可過度收緊）", () => {
  const rows = [gapDay("2026/07/01", 99), gapDay("2026/07/02", 100), gapDay("2026/07/03", 88), gapDay("2026/07/06", 89)];
  const adjusted = mod.backAdjustForCorporateActions(rows, null, { allowHeuristicFallback: true });
  assert.ok(adjusted[0].close < 99, "事件前的價格要被回溯調整");
  assert.equal(adjusted[2].close, 88, "事件當日與之後的價格不動");
  assert.equal(adjusted[3].close, 89);
});

test("D-03：農曆春節連假不得被誤判成資料缺口", () => {
  // 台股春節休市約 5~10 天，門檻若取太小（例如 4 天）每年都會誤報。
  const rows = [gapDay("2026/02/05", 99), gapDay("2026/02/06", 100), gapDay("2026/02/17", 88), gapDay("2026/02/18", 89)];
  const adjusted = mod.backAdjustForCorporateActions(rows, null, { allowHeuristicFallback: true });
  assert.ok(adjusted[0].close < 99, "連假後的真跳空仍必須被偵測到");
});

// ---- D-12 ----

test("D-12：個股健檢只接受上市櫃普通股，ETF 要明確擋下而不是硬算", async () => {
  const result = await mod.inspectSwingStock("0050");
  assert.equal(result.ok, false);
  assert.match(result.error, /普通股/, `實際錯誤：${result.error}`);
  assert.doesNotMatch(result.error, /找不到/, "0050 存在於 reference，不該回查無此股");
});

// ---- D-09 ----

test("D-09：股利紀錄不得由 client 自稱伺服器估算來源並夾帶金額", () => {
  const canon = (record) => mod.canonicalizeTradeMoneyProvenance({ records: [record] }, { records: [] }).records[0];
  const base = { id: "d1", code: "2412", side: "dividend", status: "received", price: 5, shares: 1000 };

  // 破口：規格明訂 estimated／legacy 的金額由伺服器管理，但 canonicalize 以前整個跳過股利，
  // 於是這筆假匯費會原樣落盤、吃掉已入帳淨額，還掛著「伺服器估算」標籤。
  const forged = canon({ ...base, fee: 500, feeSource: "estimated" });
  assert.equal(forged.fee, undefined, "偽造的 estimated 金額要清掉，交回後端重算");
  assert.equal(forged.feeSource, undefined);

  // 前端固定送 fee: null＝「未知，交給後端」，normalizeTradeRecordV2 以 allowNull 尊重它。
  // 這個 null 是有意義的契約，canonicalize 不可以把它洗掉——洗掉會讓已入帳股利的匯費
  // 從 null 變成預設 10，直接改到 dividendReceivedNet。
  const unknown = canon({ ...base, id: "d2", fee: null });
  assert.ok("fee" in unknown, "fee 欄位必須留著");
  assert.equal(unknown.fee, null, "null 語意要保留");

  // 使用者手填的實際匯費仍然是最終值。
  const manual = canon({ ...base, id: "d3", fee: 15, feeSource: "manual" });
  assert.equal(manual.fee, 15);
  assert.equal(manual.feeSource, "manual");
});

// ---- D-04 ----

const macdBars = (closes) => closes.map((close) => ({ close, open: close, high: close, low: close }));

test("D-04：期數未滿時 dea／histogram 必須是 null，訊號不得被 seed 假動能觸發", () => {
  // 18 根月 K、後 17 根零波動：正確的 MACD 三個值都該是 0，但 emaSeries 把第一個值當 seed，
  // 舊寫法會吐 dif +6.05／dea +8.25／histogram −2.20（相當於股價 6% 的憑空動能），
  // buildTechnicalSignals 會據此對使用者宣稱「MACD 負轉正」。
  const macd = mod.computeMacd(macdBars([50, ...Array(17).fill(100)]), 8, 17, 9);
  const last = macd.at(-1);
  assert.equal(last.dea, null, "dea 需要 slow+signal-2 根才成立");
  assert.equal(last.histogram, null, "histogram 依賴 dea，同樣不得輸出");
  // dif 沿用「慢線滿期（slow-1）」的業界慣例；驅動訊號的是 histogram／dea，兩者已擋住。
});

test("D-04：資料充足時照常輸出，且遮罩長度符合定義", () => {
  const macd = mod.computeMacd(macdBars(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5)), 8, 17, 9);
  const validDea = macd.filter((row) => Number.isFinite(row.dea)).length;
  assert.equal(validDea, 40 - (17 + 9 - 2), "前 slow+signal-2 根為 null，其餘有效");
  assert.ok(Number.isFinite(macd.at(-1).dif));
  assert.ok(Number.isFinite(macd.at(-1).histogram));
});

test("D-04：波段引擎（要求 ≥60 根）不受 warm-up 影響", () => {
  const macd = mod.computeMacd(macdBars(Array.from({ length: 60 }, (_, i) => 100 + i * 0.1)), 8, 17, 9);
  assert.ok(Number.isFinite(macd.at(-1).dea), "60 根遠超過 warm-up，最後一根必須有效");
  assert.ok(Number.isFinite(macd.at(-1).histogram));
});
