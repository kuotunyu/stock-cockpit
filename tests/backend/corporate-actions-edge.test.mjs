// 波段還原權息邊界：不完整公告、降級來源、多事件累乘與股數調整後成交量。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { candles } from "../helpers/fixtures.mjs";

const { mod } = await importServer();
const {
  corporateActionGapRatio,
  officialCorporateActionRatio,
  computeSwingFeatures,
} = mod;

const compactDate = (row) => row.date.replaceAll("-", "");

function scaleAfter(rows, index, ratio) {
  return rows.map((row, rowIndex) => rowIndex < index ? { ...row } : {
    ...row,
    open: Number((row.open * ratio).toFixed(6)),
    high: Number((row.high * ratio).toFixed(6)),
    low: Number((row.low * ratio).toFixed(6)),
    close: Number((row.close * ratio).toFixed(6)),
  });
}

// 這幾筆是 2026-07-25 從實機 fundamentals-cache.json 抄下來的真實形狀。
// 官方對「沒有現增」的表達就是把現增欄位留空，配股不配現增又是除權息的常態
// （實測 59 筆除權事件裡 31 筆長這樣），所以它必須是可以精確還原的完整公告。
test("官方常態形狀：配股不配現增（現增欄位為 null）必須算得出精確參考價", () => {
  const previousClose = 100;
  const stockOnly = {
    exDate: "20260730",
    kind: "除權息",
    cashDividend: 1.5,
    stockRatio: 0.09999999,
    subscriptionRatio: null,
    subscriptionPrice: null,
  };
  const ratio = officialCorporateActionRatio(stockOnly, previousClose);
  const expected = (previousClose - 1.5) / (1 + 0.09999999) / previousClose;
  assert.ok(ratio !== null, "把這種常態公告判成「公式不齊」會讓過半配股公司被踢出波段板");
  assert.ok(Math.abs(ratio - expected) < 1e-12, `${ratio} 應為 ${expected}`);

  // 真的有現增時官方兩個欄位都會填，照樣精確。
  const withRights = {
    exDate: "20260721",
    kind: "除權息",
    cashDividend: 0.5,
    stockRatio: 0.04999999,
    subscriptionRatio: 0.25790632,
    subscriptionPrice: 15,
  };
  const rightsRatio = officialCorporateActionRatio(withRights, previousClose);
  const rightsExpected = (previousClose - 0.5 + 15 * 0.25790632) / (1 + 0.04999999 + 0.25790632) / previousClose;
  assert.ok(Math.abs(rightsRatio - rightsExpected) < 1e-12);
});

// D-41 的防護網。單位已於 2026-07-26 實測確認是「比率」，但上游若改版成「每仟股股數」，
// 除數會從 1.1 變成 101，整段 K 線塌陷卻仍蓋著 official 章、不走 heuristic、毫無告警。
test("配股率量級異常（>100%）一律擋下標未定案，不得無聲算出塌掉的線", () => {
  const previousClose = 100;
  // 上游改成每仟股股數的災難形狀：0.1 變成 100。
  assert.equal(
    officialCorporateActionRatio(
      { exDate: "20260730", kind: "除權", cashDividend: 0, stockRatio: 100, subscriptionRatio: 0, subscriptionPrice: 0 },
      previousClose,
    ),
    null,
    "若放行，參考價會變成 100/101≈0.99 元，事件前整段歷史被壓成 1%",
  );
  assert.equal(
    officialCorporateActionRatio(
      { exDate: "20260730", kind: "除權", cashDividend: 0, stockRatio: 0, subscriptionRatio: 250, subscriptionPrice: 15 },
      previousClose,
    ),
    null,
    "現增比率同樣要防",
  );
  // 邊界：配股 100%（1:1 無償配股）合法且真的存在，不可誤擋。
  const legit = officialCorporateActionRatio(
    { exDate: "20260730", kind: "除權", cashDividend: 0, stockRatio: 1, subscriptionRatio: 0, subscriptionPrice: 0 },
    previousClose,
  );
  assert.ok(Math.abs(legit - 0.5) < 1e-12, `1:1 配股的因子應為 0.5，實際 ${legit}`);
});

test("除權但兩個比率都拿不到值：仍然不得硬算", () => {
  const previousClose = 100;
  // 兩欄全 null → 完全不知道配了多少，只能標 unresolved。
  assert.equal(
    officialCorporateActionRatio(
      { exDate: "20260730", kind: "除權", cashDividend: 0, stockRatio: null, subscriptionRatio: null, subscriptionPrice: null },
      previousClose,
    ),
    null,
  );
  // 現增明確是 0、配股率卻缺漏 → 兩個比率相加為 0 的「除權」在定義上不成立，
  // 不能算出 ratio=1 卻蓋上 official 章（那會在還原序列裡留下一根真實的除權假崩盤）。
  assert.equal(
    officialCorporateActionRatio(
      { exDate: "20260730", kind: "除權", cashDividend: 0, stockRatio: null, subscriptionRatio: 0, subscriptionPrice: 0 },
      previousClose,
    ),
    null,
  );
});

test("現增認購比率 >0 但認購價為 null：不得冒充 official，大缺口才可降級 heuristic", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90;
  const action = {
    exDate: compactDate(raw[gapAt]),
    kind: "除權",
    cashDividend: 0,
    stockRatio: 0,
    subscriptionRatio: 0.15,
    subscriptionPrice: null,
  };
  assert.equal(
    officialCorporateActionRatio(action, raw[gapAt - 1].close),
    null,
    "未知認購價不能被 Number(null)=0 偷渡成精確官方公式",
  );

  const gapped = scaleAfter(raw, gapAt, 0.8);
  const expectedHeuristic = corporateActionGapRatio(gapped[gapAt], gapped[gapAt - 1].close);
  assert.ok(expectedHeuristic, "fixture 必須形成 >10.5% 大缺口");
  const f = computeSwingFeatures(gapped, [action], { allowHeuristicFallback: true });
  assert.equal(f.recentCorporateGap, true);
  assert.equal(f.recentCorporateActionSource, "heuristic", "不完整公告只能降級估算，不能標 official");
  const factor = f.rows[0].close / gapped[0].close;
  assert.ok(Math.abs(factor - expectedHeuristic) < 1e-9, `${factor} 應採 heuristic ${expectedHeuristic}`);
});

test("不完整現增公告且沒有大缺口：不得硬算，近期來源要標 unresolved", () => {
  const rows = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const eventAt = 90;
  const action = {
    exDate: compactDate(rows[eventAt]),
    kind: "除權",
    cashDividend: 0,
    stockRatio: 0,
    subscriptionRatio: 0.15,
    subscriptionPrice: null,
  };
  const f = computeSwingFeatures(rows, [action], { allowHeuristicFallback: true });
  assert.equal(f.recentCorporateGap, false, "無公式、無大缺口時沒有價格可調整");
  assert.equal(f.corporateActionUnresolved, true, "仍須揭露同日公告資料不完整，不能靜默略過");
  assert.ok(f.corporateActionUnresolvedDates.includes(action.exDate));
  assert.equal(f.rows[0].close, rows[0].close);
});

test("舊 dividends schema 缺 subscription 欄位：不得視為完整官方事件", () => {
  const rows = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const eventAt = 90;
  const legacyAction = {
    exDate: compactDate(rows[eventAt]),
    kind: "除息",
    cashDividend: 3,
    stockRatio: 0,
    // 舊 fundamentals-cache.json 沒有 subscriptionRatio / subscriptionPrice。
  };
  assert.equal(
    officialCorporateActionRatio(legacyAction, rows[eventAt - 1].close),
    null,
    "缺欄位不等於官方明確公告為 0；否則舊快取會被誤認為完整證據",
  );
  const f = computeSwingFeatures(rows, [legacyAction], { allowHeuristicFallback: true });
  assert.equal(f.recentCorporateGap, false);
  assert.equal(f.corporateActionUnresolved, true);
  assert.ok(f.corporateActionUnresolvedDates.includes(legacyAction.exDate));
  assert.equal(f.rows[0].close, rows[0].close, "不足 10.5% 的平滑資料不可 fallback 調價");
});

test("兩次公司行為要由新往舊累乘；近期同時有 official＋heuristic 時 source=mixed", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const officialAt = 84;
  const heuristicAt = 92;
  const action = {
    exDate: compactDate(raw[officialAt]),
    kind: "除權息",
    cashDividend: 2,
    stockRatio: 0.1,
    subscriptionRatio: 0,
    subscriptionPrice: 0,
  };
  const officialRatio = officialCorporateActionRatio(action, raw[officialAt - 1].close);
  assert.ok(officialRatio);
  let rows = scaleAfter(raw, officialAt, officialRatio);
  rows = scaleAfter(rows, heuristicAt, 0.82);
  const heuristicRatio = corporateActionGapRatio(rows[heuristicAt], rows[heuristicAt - 1].close);
  assert.ok(heuristicRatio);

  const f = computeSwingFeatures(rows, [action], { allowHeuristicFallback: true });
  const cumulative = f.rows[0].close / rows[0].close;
  assert.ok(
    Math.abs(cumulative - officialRatio * heuristicRatio) < 1e-9,
    `多事件累乘 ${cumulative} vs ${officialRatio * heuristicRatio}`,
  );
  assert.equal(f.recentCorporateGap, true);
  assert.equal(f.recentCorporateActionSource, "mixed", "同一近期窗混合兩種證據，不能偏稱 official 或 heuristic");
});

test("股票股利／現增前成交量按股數因子反向調整，量比不可被拆股假象污染", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1, volBase: 1000 });
  const eventAt = 97;
  const stockRatio = 0.3;
  const subscriptionRatio = 0.2;
  const shareFactor = 1 + stockRatio + subscriptionRatio;
  const action = {
    exDate: compactDate(raw[eventAt]),
    kind: "除權",
    cashDividend: 0,
    stockRatio,
    subscriptionRatio,
    subscriptionPrice: 30,
  };
  const priceRatio = officialCorporateActionRatio(action, raw[eventAt - 1].close);
  assert.ok(priceRatio);
  const rows = scaleAfter(raw, eventAt, priceRatio).map((row, index) => ({
    ...row,
    // 同一經濟交易量：事件後每一舊股變 1.5 股，原始成交股數自然是事件前的 1.5 倍。
    volume: index < eventAt ? 1000 : 1000 * shareFactor,
    volumeLots: index < eventAt ? 1000 : 1000 * shareFactor,
  }));

  const f = computeSwingFeatures(rows, [action]);
  assert.equal(f.rows[0].volume, 1000 * shareFactor, "價格往下調時，事件前股數要反向乘上配股因子");
  assert.equal(f.rows[0].volumeLots, 1000 * shareFactor);
  assert.equal(f.rows[eventAt].volumeLots, 1000 * shareFactor, "事件日及之後成交量維持原值");
  assert.ok(Math.abs(f.volumeRatio5 - 1) < 1e-12, `經股數校正後量比應為 1，不是拆股造成的假爆量：${f.volumeRatio5}`);
});
