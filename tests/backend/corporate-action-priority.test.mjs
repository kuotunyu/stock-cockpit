// 還原權息的來源優先序與座標系換算。三種來源的可信度天差地遠，順序錯了就會用比較差的數字：
//   exchange-result 上市 TWT49U 計算結果表——交易所自己給的前收盤價與參考價，已套過升降單位。
//   exchange-quote  上櫃逐檔歷史——漲跌價差是相對參考價算的，close − change 就是參考價。
//   official        本機歸檔的除權息預告 ＋ 官方公式（歸檔只從部署後累積，覆蓋率有限）。
//   heuristic       >10.5% 跳空推測，只對有漲跌幅限制的普通股成立。
// 另外，Yahoo 備援序列的價格座標系跟官方逐檔歷史差一個配股倍數（實測：它把配股當分割做過了），
// 官方來源算出來的因子必須換算才能用，由 Yahoo 自身資料推出來的 heuristic 則不能換算。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const resultRow = (date, code, preClose, ref, kind) =>
  [date, code, "測試", String(preClose), String(ref), "0", kind, "0", "0", String(ref), String(ref), "", "", "", ""];

let mod;
let mock;
let dataDir;
before(async () => {
  ({ mod, mock, dataDir } = await importServer({
    routes: [{
      match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/,
      reply: (url) => {
        const start = url.searchParams.get("startDate") || "";
        if (!start.startsWith("202606")) return { stat: "OK", data: [] };
        return {
          stat: "OK",
          data: [
            // 交易所說參考價 90（因子 0.90）；歸檔公告會算出 0.92，兩者刻意不同以便分辨誰贏。
            resultRow("115年06月10日", "1111", 100, 90, "息"),
            // 純現金除息，給 Yahoo 案例用（kind 不含「權」→ 配股倍數 1）。
            resultRow("115年06月10日", "3333", 100, 95, "息"),
            // 除權息：kind 含「權」，Yahoo 需要知道配股倍數才能換算。
            resultRow("115年06月10日", "4444", 100, 89.090909, "權息"),
            resultRow("115年06月10日", "5555", 100, 89.090909, "權息"),
          ],
        };
      },
    }],
  }));
  await mod.ensureCorporateActionResults("20260601", "20260630");
});
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const bar = (date, code, close, extra = {}) => ({
  date, rawDate: date.replace(/\D/g, ""), code, name: "測試", exchange: "TWSE",
  open: close, high: close, low: close, close,
  previousClose: null, exchangePreviousClose: null, exchangeCorporateActionMark: false,
  change: null, volumeShares: 1e6, volumeLots: 1000, tradeValue: 1e8, transactions: 10,
  source: "TWSE STOCK_DAY", ...extra,
});

const cashAction = (exDate, cash) => ({
  exDate, kind: "息", cashDividend: cash, stockRatio: 0,
  subscriptionRatio: 0, subscriptionPrice: 0, formulaComplete: true, status: "active",
});

test("交易所計算結果表贏過歸檔公告：兩者算出不同因子時採用交易所的", () => {
  const rows = [
    bar("2026/06/09", "1111", 100),
    bar("2026/06/10", "1111", 90, { exchangeCorporateActionMark: true }),
    bar("2026/06/11", "1111", 91),
  ];
  // 歸檔公告會算出 (100-8)/100 = 0.92，交易所給的是 90/100 = 0.90。
  const adj = mod.resolveCorporateActionAdjustments(rows, [cashAction("20260610", 8)], { allowHeuristicFallback: true });
  const item = adj.get(1);
  assert.ok(item, "事件那天要有調整");
  assert.equal(item.source, "exchange-result");
  assert.ok(Math.abs(item.ratio - 0.9) < 1e-12, `應採交易所的 0.90，實際 ${item.ratio}`);
  assert.deepEqual(adj.unresolvedIndices, [], "查得到比率就不算未定案");
});

test("上櫃沒有 X 標記，靠 exchangePreviousClose 與前一列收盤不符來偵測", () => {
  const rows = [
    bar("2026/06/09", "2222", 100, { exchange: "TPEx", source: "TPEx tradingStock", exchangePreviousClose: 99 }),
    // 交易所昨收 95（＝官方參考價），但前一列實際收 100 → 有事件，因子 0.95。
    bar("2026/06/10", "2222", 96, { exchange: "TPEx", source: "TPEx tradingStock", exchangePreviousClose: 95 }),
    bar("2026/06/11", "2222", 97, { exchange: "TPEx", source: "TPEx tradingStock", exchangePreviousClose: 96 }),
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1)?.source, "exchange-quote");
  assert.ok(Math.abs(adj.get(1).ratio - 0.95) < 1e-12);
  assert.equal(adj.get(2), undefined, "正常日的交易所昨收等於前一列收盤，不可誤判成事件");
});

test("跨資料缺口不得用 exchangePreviousClose 推事件（缺月會被接起來）", () => {
  const rows = [
    // 逐月歷史抓取失敗被吞成空陣列時，缺月前後會被直接接起來。
    bar("2026/04/10", "2222", 100, { exchange: "TPEx", source: "TPEx tradingStock", exchangePreviousClose: 99 }),
    bar("2026/06/10", "2222", 96, { exchange: "TPEx", source: "TPEx tradingStock", exchangePreviousClose: 95 }),
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1), undefined, "隔了兩個月的「交易所昨收對不上」是缺口造成的，不是公司行動");
});

test("上市 X 標記說有事件、卻查不到比率 → 必須標未定案，不能當作沒事發生", () => {
  const rows = [
    bar("2026/06/09", "9999", 100),
    // 官方漲跌價差欄被遮成 X0.00 → exchangePreviousClose 是 null、標記為 true。
    // 2026-06 這個月在 before() 已經抓成功，所以「查不到 9999」是真的資料不完整。
    bar("2026/06/10", "9999", 98, { exchangeCorporateActionMark: true }),
    bar("2026/06/11", "9999", 99),
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1), undefined, "算不出比率就不能亂調");
  assert.deepEqual(adj.unresolvedIndices, [1], "但一定要揭露這天官方說有事件");
});

// 「沒查到」與「查了發現資料不完整」必須分開。上游暫時掛掉時把標記當成未定案，
// 等於因為官方端點打嗝就把一批大型股踢出候選池（實測整批失敗時誤剔 39 檔）。
test("該月的計算結果表沒抓成功過時，X 標記不得升級成未定案", () => {
  const rows = [
    // 2026-09 這個月在 before() 的路由回空且沒被 ensure 過 → 沒有覆蓋紀錄。
    bar("2026/09/09", "9999", 100),
    bar("2026/09/10", "9999", 98, { exchangeCorporateActionMark: true }),
    bar("2026/09/11", "9999", 99),
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.deepEqual(adj.unresolvedIndices, [], "沒查到不等於資料不完整，不可因此排除標的");
});

test("同一個 X 標記日在計算結果表查得到 → 就不算未定案", () => {
  const rows = [
    bar("2026/06/09", "1111", 100),
    bar("2026/06/10", "1111", 90, { exchangeCorporateActionMark: true }),
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1)?.source, "exchange-result");
  assert.deepEqual(adj.unresolvedIndices, []);
});

// ---- Yahoo 座標系換算 ----

const yahooBar = (date, code, close) => bar(date, code, close, {
  source: "Yahoo Finance chart fallback", exchangePreviousClose: null, exchangeCorporateActionMark: false,
});

test("Yahoo＋純現金除息：配股倍數為 1，因子原樣採用", () => {
  const rows = [yahooBar("2026/06/09", "3333", 100), yahooBar("2026/06/10", "3333", 95)];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.ok(Math.abs(adj.get(1).ratio - 0.95) < 1e-12, "純現金除息 Yahoo 不做分割調整，因子不用換算");
  assert.equal(adj.get(1).shareFactor, 1);
});

test("Yahoo＋配股：因子要乘回配股倍數，否則配股被還原兩次", () => {
  // 原始：前收 100、現金 2、配股 10% → 參考價 89.0909，原始座標因子 0.890909。
  // Yahoo 事件前的收盤已是 100/1.1 = 90.9091，正確因子是 (100-2)/100 = 0.98。
  const rows = [yahooBar("2026/06/09", "4444", 100 / 1.1), yahooBar("2026/06/10", "4444", 89.090909)];
  const action = {
    exDate: "20260610", kind: "權息", cashDividend: 2, stockRatio: 0.1,
    subscriptionRatio: 0, subscriptionPrice: 0, formulaComplete: true, status: "active",
  };
  const adj = mod.resolveCorporateActionAdjustments(rows, [action], { allowHeuristicFallback: true });
  const ratio = adj.get(1).ratio;
  assert.ok(Math.abs(ratio - 0.98) < 1e-6, `Yahoo 座標系的正確因子是 0.98，實際 ${ratio}`);
  assert.ok(Math.abs(ratio - 0.890909) > 0.05, "明確排除未換算的原始座標因子");
  assert.equal(adj.get(1).shareFactor, 1, "Yahoo 的成交量也已按分割調整過，不可再乘一次");
});

test("Yahoo＋配股但查不到配股倍數 → 寧可不調，並標未定案", () => {
  // 5555 在計算結果表裡 kind 是「除權息」，但歸檔沒有這筆公告 → 算不出配股倍數。
  const rows = [yahooBar("2026/06/09", "5555", 90.9091), yahooBar("2026/06/10", "5555", 89.090909)];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1), undefined, "寧可少還原一次現金，也不要把配股還原兩次");
  assert.deepEqual(adj.unresolvedIndices, [1]);
});

// 直接抄 2026-07-27 的真實 Yahoo payload 形狀（6944 兆聯實業，配股 30%）。
// 這兩天連續三個 bug 都源於「離線 fixture 比現實乾淨」，所以這裡刻意保留官方原樣：
// splits 以「時間戳字串」為鍵、值裡另有 date 欄位，numerator/denominator 是數字不是字串。
test("D-48：解析真實 Yahoo splits payload——時間戳換算台北日期、倍數＝分子÷分母", () => {
  const result = {
    events: {
      dividends: { 1784768400: { amount: 17, date: 1784768400 } },
      splits: { 1784768400: { date: 1784768400, numerator: 1300, denominator: 1000, splitRatio: "1300:1000" } },
    },
  };
  const factors = mod.parseYahooSplitFactors(result);
  assert.ok(factors instanceof Map);
  // 1784768400 → 2026-07-23T01:00:00Z → 台北 2026/07/23，正是官方除權息日
  assert.equal(factors.get("20260723"), 1.3);
  assert.equal(factors.size, 1);
});

test("D-48：有 events 但沒有 splits 鍵＝Yahoo 確認沒做分割（純現金個股的實際形狀）", () => {
  // 2002 中鋼實際回傳：events 只有 dividends、完全沒有 splits 鍵。
  const factors = mod.parseYahooSplitFactors({ events: { dividends: { 1784854800: { amount: 0.15, date: 1784854800 } } } });
  assert.ok(factors instanceof Map, "要回空 Map 而不是 null——這代表『查過了，沒有分割』");
  assert.equal(factors.size, 0);
});

test("D-48：整個 events 區塊沒回時必須回 null（未知，不可當成沒有分割）", () => {
  assert.equal(mod.parseYahooSplitFactors({}), null);
  assert.equal(mod.parseYahooSplitFactors(null), null);
});

test("D-48：畸形的 split 欄位一律跳過，不得算出 0、負數或 Infinity 倍數", () => {
  const factors = mod.parseYahooSplitFactors({
    events: {
      splits: {
        a: { date: 1784768400, numerator: 1300, denominator: 0 },      // 除以 0
        b: { date: 1784768400, numerator: 0, denominator: 1000 },      // 倍數 0
        c: { date: 1784768400, numerator: -2, denominator: 1 },        // 負數
        d: { date: "壞掉", numerator: 1300, denominator: 1000 },        // 日期無效
        e: { date: 1784768400, numerator: 1100, denominator: 1000 },   // 唯一合法的一筆
      },
    },
  });
  assert.equal(factors.size, 1);
  assert.ok(Math.abs(factors.get("20260723") - 1.1) < 1e-12);
});

// D-48：換算倍數應優先用 Yahoo 自己回報的分割事件。舊做法只認本機歸檔的公告，
// 於是「有配股 ＋ 歸檔沒有這筆」的股票會被判 unresolved 而整檔消失（實例 8112 至上）。
// 我們要的本來就是「Yahoo 實際套了多少」，它自己回報的就是定義上的答案。
test("D-48：Yahoo 回報的分割倍數優先於本機歸檔，歸檔沒有也算得出來", () => {
  // 原始：前收 100、現金 2、配股 10% → 參考價 89.0909，原始座標因子 0.890909
  // Yahoo 事件前收盤 = 100/1.1 = 90.9091，正確的 Yahoo 座標因子 = (100-2)/100 = 0.98
  const rows = [
    { ...yahooBar("2026/06/09", "4444", 100 / 1.1), yahooSplitFactor: 1 },
    { ...yahooBar("2026/06/10", "4444", 89.090909), yahooSplitFactor: 1.1 },
  ];
  // 刻意不給任何歸檔公告——這正是舊做法會卡住的情境。
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.ok(adj.get(1), "歸檔沒有這筆時，仍應靠 Yahoo 自己的分割倍數算出來");
  assert.ok(Math.abs(adj.get(1).ratio - 0.98) < 1e-6, `應為 0.98，實際 ${adj.get(1).ratio}`);
  assert.deepEqual(adj.unresolvedIndices, [], "算得出來就不該標未定案");
});

test("D-48：Yahoo 說這天沒有分割（倍數 1）時，官方因子原樣採用", () => {
  // 3333 在計算結果表裡是純除息（參考價 95 ÷ 前收 100），Yahoo 不會做分割調整。
  const rows = [
    { ...yahooBar("2026/06/09", "3333", 100), yahooSplitFactor: 1 },
    { ...yahooBar("2026/06/10", "3333", 95), yahooSplitFactor: 1 },
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.ok(Math.abs(adj.get(1).ratio - 0.95) < 1e-12);
});

test("D-48：Yahoo 沒回 events 區塊時不得假設它沒調整，仍退回既有判斷", () => {
  // yahooSplitFactor 為 null＝未知。5555 在結果表是除權息、歸檔也沒有 → 只能標未定案。
  const rows = [
    { ...yahooBar("2026/06/09", "5555", 90.9091), yahooSplitFactor: null },
    { ...yahooBar("2026/06/10", "5555", 89.090909), yahooSplitFactor: null },
  ];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1), undefined, "未知倍數時寧可不調");
  assert.deepEqual(adj.unresolvedIndices, [1]);
});

test("D-48：Yahoo 分割倍數與歸檔公告不一致時，以 Yahoo 為準", () => {
  // 歸檔說配股 10%（倍數 1.1），但 Yahoo 實際只套了 1.05。
  // 要換算到 Yahoo 座標系，用的必須是 Yahoo 實際套的那個數字。
  const rows = [
    { ...yahooBar("2026/06/09", "4444", 95.2381), yahooSplitFactor: 1 },
    { ...yahooBar("2026/06/10", "4444", 89.090909), yahooSplitFactor: 1.05 },
  ];
  const action = {
    exDate: "20260610", kind: "權息", cashDividend: 2, stockRatio: 0.1,
    subscriptionRatio: 0, subscriptionPrice: 0, formulaComplete: true, status: "active",
  };
  const adj = mod.resolveCorporateActionAdjustments(rows, [action], { allowHeuristicFallback: true });
  // 結果表因子 89.090909/100 = 0.890909；× Yahoo 的 1.05 = 0.935455
  assert.ok(Math.abs(adj.get(1).ratio - 0.890909 * 1.05) < 1e-5, `實際 ${adj.get(1).ratio}`);
});

test("Yahoo 的跳空估算還原不得再換算（它本來就在 Yahoo 座標系）", () => {
  // 沒有任何官方事件，只有一根 -20% 跳空。heuristic 是直接從 Yahoo 自己的兩根算出來的。
  const rows = [yahooBar("2026/06/09", "8888", 100), yahooBar("2026/06/10", "8888", 80), yahooBar("2026/06/11", "8888", 80)];
  const adj = mod.resolveCorporateActionAdjustments(rows, [], { allowHeuristicFallback: true });
  assert.equal(adj.get(1)?.source, "heuristic");
  assert.ok(Math.abs(adj.get(1).ratio - 0.8) < 1e-12, "估算因子原樣使用，不可乘配股倍數");
});
