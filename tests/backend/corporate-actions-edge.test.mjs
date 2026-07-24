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
