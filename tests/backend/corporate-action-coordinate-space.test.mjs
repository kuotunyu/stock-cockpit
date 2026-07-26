// 還原因子由後往前累乘，index 的因子只作用在**它之前**的列。所以「這些價格在哪個座標系」
// 要問前一列，不是事件日那一列。
//
// 為什麼會踩到：三個入口都是 getStockHistory(allowExternalFallback) → appendTodayCloseBar，
// 官方逐檔被限流時會產生「一整串 Yahoo 列 ＋ 一根用整批收盤補上的官方當日 K」。事件正好落在
// 那根接縫上時，舊寫法看事件列的 source（官方）就跳過 Yahoo 座標系換算，把整段歷史多除了
// 一次配股倍數——而且 unresolvedIndices 是空的、source 還蓋著 exchange-result 官方章。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const PRE_CLOSE = 1030;
const REFERENCE = 779.230769;   // 除權息參考價（配股 30% ＋ 現金）
const SPLIT = 1.3;              // Yahoo 把 30% 配股當分割套下去的倍數
const RAW_RATIO = REFERENCE / PRE_CLOSE;          // 0.756535（原始座標系）
const YAHOO_RATIO = RAW_RATIO * SPLIT;            // 0.983495（Yahoo 座標系）

const resultRow = ["115年06月10日", "6944", "測試", String(PRE_CLOSE), String(REFERENCE), "250.77", "權息", "0", "0", "779", "779", "", "", "", ""];

const { mod, mock, dataDir } = await importServer({
  routes: [{
    match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/,
    reply: (url) => (String(url.searchParams.get("startDate") || "").startsWith("202606")
      ? { stat: "OK", data: [resultRow] }
      : { stat: "OK", data: [] }),
  }],
});
await mod.ensureCorporateActionResults("20260601", "20260630");
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const base = (date, close, source, extra = {}) => ({
  date, rawDate: date.replace(/\//g, ""), code: "6944", name: "測試", exchange: "TWSE",
  open: close, high: close, low: close, close, volumeLots: 1000, source, ...extra,
});
// Yahoo 已把配股當分割還原 → 事件前的收盤是原始價 ÷ 1.3
const yahooPre = [
  base("2026/06/05", PRE_CLOSE / SPLIT, "Yahoo Finance chart fallback"),
  base("2026/06/08", 1036.6 / SPLIT, "Yahoo Finance chart fallback"),
  base("2026/06/09", 1046.5 / SPLIT, "Yahoo Finance chart fallback"),
];
const officialPre = [
  base("2026/06/05", PRE_CLOSE, "TWSE STOCK_DAY"),
  base("2026/06/08", 1036.6, "TWSE STOCK_DAY"),
  base("2026/06/09", 1046.5, "TWSE STOCK_DAY"),
];
const resolve = (rows) => {
  const opts = { allowHeuristicFallback: true };
  return {
    adj: mod.resolveCorporateActionAdjustments(rows, [], opts),
    out: mod.backAdjustForCorporateActions(rows, [], opts),
  };
};

test("純官方序列：用原始座標系的因子", () => {
  const { adj, out } = resolve([...officialPre, base("2026/06/10", 779.23, "TWSE STOCK_DAY")]);
  assert.ok(Math.abs(adj.get(3).ratio - RAW_RATIO) < 1e-9);
  assert.ok(Math.abs(out[0].close - PRE_CLOSE * RAW_RATIO) < 1e-6, "事件前的價格要被還原到參考價附近");
});

test("純 Yahoo 序列：因子換算到 Yahoo 座標系", () => {
  const { adj, out } = resolve([...yahooPre,
    base("2026/06/10", 779.23, "Yahoo Finance chart fallback", { yahooSplitFactor: SPLIT })]);
  assert.ok(Math.abs(adj.get(3).ratio - YAHOO_RATIO) < 1e-9, "要乘上 Yahoo 自己回報的分割倍數");
  // Yahoo 的 1030/1.3 = 792.31 乘上 0.983495 → 779.23，與官方序列的結果一致。
  assert.ok(Math.abs(out[0].close - PRE_CLOSE * RAW_RATIO) < 1e-6, "兩種來源還原後必須落在同一個位置");
});

test("接縫（Yahoo 歷史 ＋ 官方當日 K 就是事件日）：算不出分割倍數就標未定案，不得沿用原始座標系因子", () => {
  const seam = base("2026/06/10", 779.23, "STOCK_DAY_ALL official close (appended)", {
    exchangePreviousClose: null, exchangeCorporateActionMark: false,
  });
  const { adj, out } = resolve([...yahooPre, seam]);

  assert.equal(adj.get(3), undefined, "座標系推導不出來時不可硬套因子");
  assert.deepEqual(adj.unresolvedIndices, [3], "要標成未定案，讓掃描端與健檢端擋下這一檔");
  // 沒有調整 → 事件前維持 Yahoo 原值 792.31。舊寫法會把它壓成 599.41（多除了一次 1.3，低 23%），
  // 而且 unresolvedIndices 是空的、source 蓋著 exchange-result，完全不可觀測。
  assert.ok(Math.abs(out[0].close - PRE_CLOSE / SPLIT) < 1e-6, `不調整就維持原值（實際 ${out[0].close}）`);
  assert.ok(out[0].close > 700, "絕不可壓到 599 那個量級");
});

test("結果表說有配股、歸檔卻推出「股數沒變」→ 矛盾一律當推導不出來", () => {
  // 歸檔的 stockRatio/subscriptionRatio 都是 null（＝沒有配股，倍數 1），但結果表的 kind 是
  // 「權息」。這代表歸檔缺了配股欄位，不是真的沒配股。結果表順位高於歸檔，不可拿 1 去換算
  // ——那會讓事件前的整段歷史少乘一次配股倍數。
  const officialActions = [{
    exDate: "20260610", kind: "除息", cashDividend: 250.77, stockRatio: null, subscriptionRatio: null,
    formulaComplete: true, status: "active",
  }];
  const rows = [...yahooPre, base("2026/06/10", 779.23, "STOCK_DAY_ALL official close (appended)", {
    exchangePreviousClose: null, exchangeCorporateActionMark: false,
  })];
  const adj = mod.resolveCorporateActionAdjustments(rows, officialActions, { allowHeuristicFallback: true });
  assert.deepEqual(adj.unresolvedIndices, [3], "矛盾時要標未定案，不可當成倍數 1");
});

test("結果表說純除息 → 股數必定沒變，接縫上照樣還原得出來", () => {
  // 這是接縫可以安全還原的情形：kind 不含「權」是官方認定「沒有配股」，倍數必為 1，
  // Yahoo 座標系與原始座標系在這個事件上重合。
  const rows = [...yahooPre, base("2026/06/12", 779.23, "STOCK_DAY_ALL official close (appended)", {
    exchangePreviousClose: null, exchangeCorporateActionMark: false,
  })];
  rows[2] = base("2026/06/11", 792.31, "Yahoo Finance chart fallback");
  const officialActions = [{
    exDate: "20260612", kind: "除息", cashDividend: 13.08, stockRatio: null, subscriptionRatio: null,
    formulaComplete: true, status: "active",
  }];
  const adj = mod.resolveCorporateActionAdjustments(rows, officialActions, { allowHeuristicFallback: true });
  assert.ok(adj.get(3), "純除息推得出倍數（1），不該被擋成未定案");
  assert.deepEqual(adj.unresolvedIndices, []);
});

// ---- 量級檢查要由價格公式與股數倍數共用 ----
test("比率明顯不像比率時，股數倍數也要回 null，不能只擋價格那條", () => {
  assert.ok(Math.abs(mod.plausibleShareFactor({ stockRatio: 0.1 }) - 1.1) < 1e-9);
  assert.ok(Math.abs(mod.plausibleShareFactor({ stockRatio: 0.1, subscriptionRatio: 0.05 }) - 1.15) < 1e-9);
  assert.equal(mod.plausibleShareFactor({ stockRatio: null, subscriptionRatio: null }), 1, "沒有配股就是 1");
  assert.equal(
    mod.plausibleShareFactor({ stockRatio: 100 }), null,
    "上游改成「每仟股配 100 股」時要回 null——舊寫法會給 101，直接乘進成交量與 Yahoo 換算倍數",
  );
  assert.equal(mod.plausibleShareFactor({ subscriptionRatio: 100 }), null);
  assert.equal(mod.plausibleShareFactor(null), null);
  // 價格公式對同一筆輸入的結論必須一致（兩條路不可各說各話）
  assert.equal(mod.officialCorporateActionRatio({ kind: "除權", stockRatio: 100, formulaComplete: true }, 100), null);
});

test("量級檢查要真的擋在還原路徑上，不是只擋純函式", () => {
  // 上游若把「無償配股率」改版成「每仟股配股數」，歸檔會存到 stockRatio: 100。
  // 這個值原本會變成股數倍數 101，再乘進 Yahoo 座標系換算 → ratio 0.7565 × 101 ≈ 76.4，
  // 事件前的收盤 792.31 被還原成 60540——整段 K 線飛掉，卻仍蓋著 exchange-result 官方章。
  const officialActions = [{
    exDate: "20260610", kind: "除權息", cashDividend: 0, stockRatio: 100, subscriptionRatio: null,
    formulaComplete: true, status: "active",
  }];
  const rows = [...yahooPre, base("2026/06/10", 779.23, "STOCK_DAY_ALL official close (appended)", {
    exchangePreviousClose: null, exchangeCorporateActionMark: false,
  })];
  const opts = { allowHeuristicFallback: true };
  const adj = mod.resolveCorporateActionAdjustments(rows, officialActions, opts);
  const out = mod.backAdjustForCorporateActions(rows, officialActions, opts);

  assert.equal(adj.get(3), undefined, "推導不出可信的股數倍數就不可調整");
  assert.deepEqual(adj.unresolvedIndices, [3]);
  assert.ok(out[0].close < 1000, `事件前的價格不得被放大（實際 ${out[0].close}）`);
});
