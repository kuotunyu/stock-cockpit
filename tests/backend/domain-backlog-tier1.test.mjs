// DOMAIN-BACKLOG 第一層修復的回歸契約（2026-07-26 起逐條清理）：
// D-05 官方成交金額本來就有、只是沒解析 → 當日 K 的 tradeValue 恆 null，害每一檔都被標「低流動性」。
// D-01 回測側 nextDayPerformance 仍用未還原價，隔日除息會憑空記出大跌。
// D-10 同一檔同時命中兩個分群時，整體 summary 的分母把它當成兩個獨立樣本。
// D-12 個股健檢沒有普通股過濾，對無漲跌幅限制的 ETF 套 10.5% 跳空 heuristic。
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

// ---- D-12 ----

test("D-12：個股健檢只接受上市櫃普通股，ETF 要明確擋下而不是硬算", async () => {
  const result = await mod.inspectSwingStock("0050");
  assert.equal(result.ok, false);
  assert.match(result.error, /普通股/, `實際錯誤：${result.error}`);
  assert.doesNotMatch(result.error, /找不到/, "0050 存在於 reference，不該回查無此股");
});
