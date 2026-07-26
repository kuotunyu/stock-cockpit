// 隔日沖／波段（策略雷達）評分與組裝：特徵化測試（用合成 K 線，固定形狀契約與單調性）。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { candles } from "../helpers/fixtures.mjs";

const { mod } = await importServer();
const {
  buildRiskTags, buildReasons, buildPick,
  computeSwingFeatures, classifySwingScenario, stockTickSize, roundToStockTick,
  buildSwingPlan, scoreSwing, buildSwingPick,
} = mod;

// ---- 隔日沖 ----
const riskyMetrics = {
  code: "6127", name: "九豪", exchange: "TPEx", source: "official", date: "2026-06-26",
  close: 93.6, open: 90, changePct: 9.99, volumeLots: 11445,
  tradeValue: 10_000_000, volumeRatio5: 6, volumeRatio20: 4, amplitudePct: 9,
  closePosition: 0.3, ma5: 88, ma20: 80, turnover: null,
};

test("buildRiskTags：五種風險全中／全乾淨", () => {
  const tags = buildRiskTags(riskyMetrics);
  for (const expected of ["低流動性", "爆量過熱", "高振幅", "收盤轉弱", "週轉率N/A"]) {
    assert.ok(tags.includes(expected), `缺 ${expected}`);
  }
  const cleanTags = buildRiskTags({
    ...riskyMetrics, tradeValue: 500_000_000, volumeRatio5: 2, amplitudePct: 4, closePosition: 0.8, turnover: 3.5,
  });
  assert.deepEqual(cleanTags, []);
});

test("buildReasons：三種型態各有理由、含關鍵字", () => {
  const strong = buildReasons(riskyMetrics, "strongContinuation");
  assert.equal(strong.length, 4);
  assert.ok(strong[0].includes("漲幅"));
  const danger = buildReasons(riskyMetrics, "volumeDanger");
  assert.ok(danger.some((r) => r.includes("量比5")));
  const rev = buildReasons(riskyMetrics, "pullbackReversal");
  assert.ok(rev.includes("收紅K"));
  assert.deepEqual(buildReasons(riskyMetrics, "unknownGroup"), []);
});

test("buildPick：形狀契約＋riskTags 內嵌計算", () => {
  const pick = buildPick(riskyMetrics, { group: "volumeDanger", groupName: "爆量高危", score: 77, reasons: ["r1"] });
  assert.equal(pick.code, "6127");
  assert.equal(pick.group, "volumeDanger");
  assert.equal(pick.score, 77);
  assert.equal(pick.price, 93.6);
  assert.ok(Array.isArray(pick.riskTags) && pick.riskTags.includes("爆量過熱"));
  for (const key of ["metrics", "nextDayPerformance", "recentBacktest", "asOf"]) {
    assert.ok(key in pick, `缺欄位 ${key}`);
  }
  assert.equal(pick.metrics.ma20, 80);
});

// ---- 波段（策略雷達）----
const upRows = candles({ n: 120, base: 100, drift: 0.5, wobble: 2 });

test("computeSwingFeatures：<60 根 → null", () => {
  assert.equal(computeSwingFeatures(candles({ n: 59 })), null);
});

test("computeSwingFeatures：上升趨勢的特徵合理", () => {
  const f = computeSwingFeatures(upRows);
  assert.ok(f, "features 不應為 null");
  assert.ok(Number.isFinite(f.ma5) && Number.isFinite(f.ma20) && Number.isFinite(f.ma60));
  assert.ok(f.ma5 > f.ma60, "上升趨勢短均應在長均之上");
  assert.ok(f.ma20Slope > 0, "中軌斜率應為正");
  assert.ok(f.daysAboveMid >= 1, "收盤應站在中軌上");
  assert.ok(Number.isFinite(f.atr) && f.atr > 0);
  assert.ok(Number.isFinite(f.bandSigma));
  assert.equal(f.recentCorporateGap, false); // 平滑合成資料不該有 >10.5% 跳空
  assert.equal(f.rows.length, 120);
});

test("computeSwingFeatures：>10.5% 除息跳空——舊價等比例還原、最新價不動、近期旗標亮起", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90; // 距最新 10 根（<22）→ recentCorporateGap 要亮
  const gapped = raw.map((row, i) => (i < gapAt ? { ...row } : {
    ...row,
    open: Number((row.open * 0.85).toFixed(2)),
    high: Number((row.high * 0.85).toFixed(2)),
    low: Number((row.low * 0.85).toFixed(2)),
    close: Number((row.close * 0.85).toFixed(2)),
  }));
  const f = computeSwingFeatures(gapped);
  assert.ok(f, "features 不應為 null");
  assert.equal(f.recentCorporateGap, true, "近 22 根內的除息跳空要標記");
  // 錨定最新棒：可交易的最新價維持原值，只調整久遠歷史。
  assert.equal(f.rows.at(-1).close, gapped.at(-1).close);
  // 還原後序列連續：不再殘留 >10.5% 的單日斷層（均線/中軌/MACD 才不會被污染）。
  for (let i = 1; i < f.rows.length; i += 1) {
    const pc = f.rows[i - 1].close;
    const chg = Math.abs((f.rows[i].close - pc) / pc) * 100;
    assert.ok(chg <= 10.5, `第 ${i} 根還原後仍有 ${chg.toFixed(1)}% 跳空`);
  }
  // 跳空前的舊價被等比例縮小（跳空日開盤/前收 ≈ 0.85）。
  const factor = f.rows[0].close / gapped[0].close;
  assert.ok(factor > 0.8 && factor < 0.9, `還原比例 ${factor} 應接近 0.85`);
});

test("computeSwingFeatures：開盤權息缺口即使收盤追回，也必須還原並亮警示", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90;
  const gapped = raw.map((row, index) => index < gapAt ? { ...row } : {
    ...row,
    open: Number((row.open * 0.85).toFixed(2)),
    high: Number((row.high * 0.85).toFixed(2)),
    low: Number((row.low * 0.85).toFixed(2)),
    close: Number((row.close * 0.85).toFixed(2)),
  });
  const previousClose = gapped[gapAt - 1].close;
  gapped[gapAt] = {
    ...gapped[gapAt],
    open: Number((previousClose * 0.85).toFixed(2)),
    high: Number((previousClose * 0.93).toFixed(2)),
    low: Number((previousClose * 0.84).toFixed(2)),
    close: Number((previousClose * 0.92).toFixed(2)),
  };
  const f = computeSwingFeatures(gapped);
  assert.equal(f.recentCorporateGap, true, "開盤 -15% 即使收盤只 -8% 仍是公司行為缺口");
  const factor = f.rows[0].close / gapped[0].close;
  assert.ok(factor > 0.84 && factor < 0.86, `舊價還原比例 ${factor} 應採開盤缺口約 0.85`);
});

// 官方公告的陣列即代表「官方證據可用」：有同日事件就精確套公式；空陣列則代表已確認當日沒有事件。
// 省略第二參數才代表官方證據暫不可用，允許沿用保守的跳空 heuristic。
test("computeSwingFeatures：官方除權息優先依 TWSE 公式還原，不用開盤缺口猜比例", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90;
  const previousClose = raw[gapAt - 1].close;
  const event = {
    exDate: raw[gapAt].date.replaceAll("-", ""),
    kind: "除權息",
    cashDividend: 2,
    stockRatio: 0.2,
    subscriptionRatio: 0.1,
    subscriptionPrice: 30,
  };
  // TWSE：[(前收－現金股利)＋(認購價×現增配股率)] ÷ (1＋無償配股率＋現增配股率)
  const referencePrice = ((previousClose - 2) + (30 * 0.1)) / (1 + 0.2 + 0.1);
  const officialRatio = referencePrice / previousClose;
  // 當天仍可能有交易漲跌；故刻意讓實際開盤比官方參考價高 4%，證明不能拿 open/前收冒充還原比例。
  const actualMarketRatio = officialRatio * 1.04;
  const gapped = raw.map((row, index) => index < gapAt ? { ...row } : {
    ...row,
    open: Number((row.open * actualMarketRatio).toFixed(4)),
    high: Number((row.high * actualMarketRatio).toFixed(4)),
    low: Number((row.low * actualMarketRatio).toFixed(4)),
    close: Number((row.close * actualMarketRatio).toFixed(4)),
  });

  const f = computeSwingFeatures(gapped, [event]);
  assert.ok(f, "features 不應為 null");
  assert.equal(f.recentCorporateGap, true, "官方事件在近 22 根內仍要亮還原提示");
  assert.equal(f.rows.at(-1).close, gapped.at(-1).close, "最新可交易價不可被改動");
  const factor = f.rows[0].close / gapped[0].close;
  assert.ok(
    Math.abs(factor - officialRatio) < 1e-9,
    `還原比例 ${factor} 應採官方公式 ${officialRatio}，不可採實際開盤缺口 ${actualMarketRatio}`,
  );
});

test("computeSwingFeatures：官方小額現金股利即使缺口不到 10.5% 也必須還原", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90;
  const previousClose = raw[gapAt - 1].close;
  const cashDividend = 3;
  const officialRatio = (previousClose - cashDividend) / previousClose;
  assert.ok((1 - officialRatio) * 100 < 10.5, "fixture 必須真的低於舊 heuristic 門檻");
  const gapped = raw.map((row, index) => index < gapAt ? { ...row } : {
    ...row,
    open: Number((row.open * officialRatio).toFixed(4)),
    high: Number((row.high * officialRatio).toFixed(4)),
    low: Number((row.low * officialRatio).toFixed(4)),
    close: Number((row.close * officialRatio).toFixed(4)),
  });
  const event = {
    exDate: gapped[gapAt].date.replaceAll("-", ""),
    kind: "除息",
    cashDividend,
    stockRatio: 0,
    subscriptionRatio: 0,
    subscriptionPrice: 0,
  };

  const f = computeSwingFeatures(gapped, [event]);
  assert.equal(f.recentCorporateGap, true);
  const factor = f.rows[0].close / gapped[0].close;
  assert.ok(Math.abs(factor - officialRatio) < 1e-9, `小額除息仍應還原：${factor} vs ${officialRatio}`);
});

test("computeSwingFeatures：官方資料已確認無事件時，市場大跌不可誤判或還原成除息", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90;
  const marketCrash = raw.map((row, index) => index < gapAt ? { ...row } : {
    ...row,
    open: Number((row.open * 0.85).toFixed(2)),
    high: Number((row.high * 0.85).toFixed(2)),
    low: Number((row.low * 0.85).toFixed(2)),
    close: Number((row.close * 0.85).toFixed(2)),
  });

  const f = computeSwingFeatures(marketCrash, []);
  assert.equal(f.recentCorporateGap, false, "空官方事件清單代表已查證沒有公司行為，不可標成除息");
  assert.equal(f.rows[0].close, marketCrash[0].close, "沒有官方事件時不可擅自把真實市場跌幅抹平");
});

test("computeSwingFeatures：官方資料不可用時才允許 heuristic，提示必須明說是疑似／估算", () => {
  const raw = candles({ n: 100, base: 100, drift: 0, wobble: 1 });
  const gapAt = 90;
  const gapped = raw.map((row, index) => index < gapAt ? { ...row } : {
    ...row,
    open: Number((row.open * 0.85).toFixed(2)),
    high: Number((row.high * 0.85).toFixed(2)),
    low: Number((row.low * 0.85).toFixed(2)),
    close: Number((row.close * 0.85).toFixed(2)),
  });
  // 未傳官方陣列＝官方證據不可用；保留舊 heuristic 作為降級方案。
  const f = computeSwingFeatures(gapped);
  assert.equal(f.recentCorporateGap, true);
  const factor = f.rows[0].close / gapped[0].close;
  assert.ok(factor > 0.84 && factor < 0.86, `heuristic 還原比例 ${factor} 應接近開盤缺口 0.85`);

  // 強制其餘門檻通過，只檢查 scenario 對 heuristic 的使用者提示。
  Object.assign(f, {
    last: { ...f.last, close: 100 },
    ma20: 99,
    ma60: 95,
    boll: { ...f.boll, mid: 99 },
    daysAboveMid: 3,
    goldenCrossDays: 2,
    pullbackDepthPct: 4,
    ma20Slope: 1,
    bandSigma: 0.5,
    changePct: 0,
  });
  const scenario = classifySwingScenario(f, "midBandDefense");
  assert.ok(scenario, "fixture 應命中中軌攻防，才能檢查 warnings");
  const warningText = scenario.warns.join("；");
  assert.notEqual(warningText, "近期除息(已還原)", "heuristic 不可宣稱一定是除息");
  assert.match(warningText, /疑似|估算|推測|無公告/, `降級提示必須揭露不確定性：${warningText}`);
});

test("buildSwingPlan：停損／目標／盈虧比的結構性約束", () => {
  const f = computeSwingFeatures(upRows);
  const plan = buildSwingPlan(f);
  const entry = plan.entry;
  assert.ok(plan.structuralStop < entry, "結構停損須低於進場");
  assert.ok(plan.structuralStop >= entry * 0.82 - 0.01, "結構停損不超過 -18%");
  assert.ok(plan.structuralStop <= entry * 0.98 + 0.01, "至少留 2% 風險");
  assert.ok(plan.target > entry, "目標須高於進場（否則 reward ≤ 0，RR 會自然把它剔除）");
  assert.ok(plan.initialStop < entry && plan.trailingTrigger > entry);
  // rr 與 (target-entry)/(entry-structuralStop) 一致（容忍四捨五入）
  const recomputed = (plan.target - entry) / (entry - plan.structuralStop);
  assert.ok(Math.abs(plan.rr - recomputed) < 0.02, `rr ${plan.rr} vs ${recomputed}`);
});

test("台股升降單位：級距邊界與方向化取整", () => {
  assert.deepEqual(
    [9.99, 10, 49.95, 50, 99.9, 100, 499.5, 500, 999, 1000].map(stockTickSize),
    [0.01, 0.05, 0.05, 0.1, 0.1, 0.5, 0.5, 1, 1, 5],
  );
  assert.equal(roundToStockTick(247.37, "down"), 247);
  assert.equal(roundToStockTick(247.37, "up"), 247.5);
  assert.equal(roundToStockTick(999.9, "up"), 1000);
});

test("buildSwingPlan：所有建議價皆為可申報檔位，RR 以合法價重算", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 252.5;
  f.ma20 = 247.37;
  f.boll = { ...f.boll, lower: 240.12 };
  f.swings = { ...f.swings, lows: [{ price: 247.37 }], highs: [{ price: 260.12 }] };
  const plan = buildSwingPlan(f);
  assert.equal(plan.entry, 252.5);
  for (const key of ["entry", "initialStop", "trailingTrigger", "structuralStop", "target"]) {
    const price = plan[key];
    const tick = stockTickSize(price);
    assert.ok(Math.abs(price / tick - Math.round(price / tick)) < 1e-8, `${key}=${price} 不是合法檔位`);
  }
  const expectedRr = (plan.target - plan.entry) / (plan.entry - plan.structuralStop);
  assert.ok(Math.abs(plan.rr - expectedRr) < 0.01, `rr ${plan.rr} 應以合法價位重算`);
});

// D-25：舊版有一道「目標至少 +3%」的下限（Math.max(target, entry*1.03)），
// 與同一行註解宣稱的「向下取整避免高估報酬」正好相反——上方壓力若只在 +2.1%，
// 下限會把目標硬抬到壓力之上，reward 憑空變大、RR 虛胖，於是本該被 SWING_MIN_RR
// 剔除的設定剛好通過。這個 fixture 過去把錯誤行為釘成期望（assert target === 10.3）。
test("buildSwingPlan：目標取上方壓力並向下取整，不得被 +3% 下限抬過壓力", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 9.99;
  f.ma20 = 9.8;
  f.boll = { ...f.boll, lower: 9.7 };
  f.swings = { ...f.swings, lows: [{ price: 9.8 }], highs: [{ price: 10.2 }] };
  const plan = buildSwingPlan(f);

  assert.equal(plan.entry, 9.99);
  assert.equal(plan.target, 10.2, "目標＝上方最近壓力 10.2，不是被抬到 10.3");
  assert.ok(plan.target < plan.entry * 1.03, "誠實目標只有 +2.1%，本來就不該硬湊到 +3%");
  // 誠實 RR：(10.2−9.99) / (9.99−9.79) ≈ 1.05；舊版是 (10.3−9.99)/0.2 ≈ 1.55。
  assert.ok(Math.abs(plan.rr - 1.05) < 0.05, `誠實 RR 應約 1.05，實際 ${plan.rr}`);
});

test("buildSwingPlan：誠實目標讓 RR 低於 1 的設定真的被算出來（不再靠下限矇混）", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 100;
  f.ma20 = 97;
  f.boll = { ...f.boll, lower: 96 };
  // 停損 97（風險 3），上方最近壓力 102.5（reward 2.5）→ 誠實 RR 0.83，應被 SWING_MIN_RR 剔除。
  // 舊版的 +3% 下限會把目標抬到 103，reward 湊成 3、RR 剛好 1.0 通過——這正是這條要擋的事。
  // 壓力刻意取 102.5：它必須大於 entry×1.02 才不會被「只看 +2% 以上壓力」那道過濾吃掉
  //（那道過濾這次刻意保留，是另一個待決的判斷題）。
  f.swings = { ...f.swings, lows: [{ price: 97 }], highs: [{ price: 102.5 }] };
  const plan = buildSwingPlan(f);
  assert.equal(plan.target, 102.5, "目標就是上方壓力，不得抬到 103");
  assert.ok(Math.abs(plan.rr - 0.83) < 0.02, `誠實 RR 應約 0.83，實際 ${plan.rr}`);
  assert.ok(plan.rr < 1, "低於 SWING_MIN_RR，掃描端會剔除它");
});

test("scoreSwing：0–100 整數；RR 與量比單調不減", () => {
  const f = computeSwingFeatures(upRows);
  const plan = buildSwingPlan(f);
  const s = scoreSwing(f, plan);
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 100);
  // RR 越高分數不減
  const low = scoreSwing(f, { ...plan, rr: 1.2 });
  const high = scoreSwing(f, { ...plan, rr: 3 });
  assert.ok(high >= low, `rr 3 (${high}) 應 ≥ rr 1.2 (${low})`);
  // 量比越高（適度範圍內）分數不減
  const fLow = { ...f, volumeRatio5: 1.0 };
  const fHigh = { ...f, volumeRatio5: 1.8 };
  assert.ok(scoreSwing(fHigh, plan) >= scoreSwing(fLow, plan));
});

test("classifySwingScenario：回 null 或 {key,...} 形狀契約", () => {
  const f = computeSwingFeatures(upRows);
  const scenario = classifySwingScenario(f);
  if (scenario !== null) {
    assert.equal(typeof scenario.key, "string");
    assert.ok(scenario.key.length > 0);
  }
  // 指定不存在的 scenarioKey → null
  assert.equal(classifySwingScenario(f, "no-such-scenario"), null);
});

test("buildSwingPick：形狀契約＋上櫃市場標籤", () => {
  const f = computeSwingFeatures(upRows);
  const plan = buildSwingPlan(f);
  const pick = buildSwingPick(
    { code: "5425", name: "台半", exchange: "TPEx" },
    f,
    { key: "midBandDefense", label: "中軌攻防" },
    plan,
    66,
  );
  assert.equal(pick.market, "上櫃");
  assert.equal(pick.score, 66);
  assert.ok(Number.isFinite(pick.price));
  for (const key of ["plan", "indicators", "asOf", "volumeRatio5"]) {
    assert.ok(key in pick, `缺欄位 ${key}`);
  }
  assert.equal(pick.indicators.goldenCrossDays, f.goldenCrossDays);
});

// ---- v21：SWING_MIN_RR 改套在「淨」RR 上 ----
// 來回成本打**兩邊**：吃掉報酬，又墊高實際虧損。
//   淨報酬 = 目標 − 進場 − 成本×進場      淨風險 = 進場 − 停損 + 成本×進場
// 所以淨 RR = 1 的臨界是「reward − risk > 2 × 成本 × 進場價」＝ 進場價的 0.942%。
// 這與 D-25 拿掉 +3% 下限是同一類問題：一道門檻沒有在做它宣稱的事（「風險大於報酬的
// 設定不值得做」用毛價算，邊緣區間根本擋不住）。實測 2026-07-24：毛 RR≥1 的 16 檔裡
// 5 檔的淨 RR <1（中租-KY 1.00→0.63、至上 1.10→0.75、聯強 1.10→0.75）。
test("buildSwingPlan：淨 RR 把成本算在報酬與風險兩邊", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 100;
  f.ma20 = 95;
  f.boll = { ...f.boll, lower: 96 };
  f.swings = { ...f.swings, lows: [{ price: 97 }], highs: [{ price: 103.5 }] };
  const plan = buildSwingPlan(f);

  assert.equal(plan.entry, 100);
  assert.equal(plan.structuralStop, 97, "停損＝上方最近支撐 97");
  assert.equal(plan.target, 103.5, "目標＝上方最近壓力 103.5");
  // 毛：3.5 / 3 = 1.1667；成本 100 × 0.471% = 0.471
  // 淨：(3.5 − 0.471) / (3 + 0.471) = 3.029 / 3.471 = 0.8726
  assert.ok(Math.abs(plan.rr - 1.17) < 0.02, `毛 RR 應約 1.17（實際 ${plan.rr}）`);
  assert.ok(Math.abs(plan.rrNet - 0.87) < 0.02, `淨 RR 應約 0.87（實際 ${plan.rrNet}）`);
  assert.ok(plan.rr >= 1 && plan.rrNet < 1, "這正是「看起來剛好過關、扣掉成本其實賠錢」的區間");
});

test("buildSwingPlan：報酬夠大時成本只是小幅折損，不該把好設定也擋掉", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 100;
  f.ma20 = 95;
  f.boll = { ...f.boll, lower: 96 };
  f.swings = { ...f.swings, lows: [{ price: 95 }], highs: [{ price: 120 }] };
  const plan = buildSwingPlan(f);
  // 支撐取「低於進場者中最高的那個」＝布林下軌 96（不是擺動低點 95）→ 風險 4、報酬 20。
  // 毛：20 / 4 = 5.0；淨：(20 − 0.471) / (4 + 0.471) = 4.37
  assert.equal(plan.structuralStop, 96, "支撐取最高的那個，不是最低的");
  assert.ok(Math.abs(plan.rr - 5) < 0.05, `毛 RR 應約 5（實際 ${plan.rr}）`);
  assert.ok(Math.abs(plan.rrNet - 4.37) < 0.05, `淨 RR 應約 4.37（實際 ${plan.rrNet}）`);
  assert.ok(plan.rrNet >= 1, "高盈虧比的設定不該被成本擋掉——成本只折損約 13%");
});

// ---- 被 2% 過濾跳過的最近壓力要說出來（Q3 的結論：不改門檻，改成揭露）----
// 那道 `> entry × 1.02` 過濾**刻意保留**：上軌續攻選的就是貼著近期高點的股票，
// 最近擺動高點必然貼著收盤價（實測 11 檔在 +0.11%~+1.81%，拿它們當目標 RR 只有 0.00~0.53，
// 整批會被剔除）。它不是 D-25 那類缺陷——+3% 下限是把目標**抬到壓力之上**（憑空造報酬），
// 這道過濾是**跳過不能用的價位**改用更遠的壓力。但被跳過的價位仍是真實關卡，要顯示。
test("buildSwingPlan：2% 內的壓力不當目標，但要回報給畫面", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 100;
  f.ma20 = 95;
  f.boll = { ...f.boll, lower: 96 };
  // 101 在 +1%（2% 內，不能當目標）；103.5 在 +3.5%（可用）
  f.swings = { ...f.swings, lows: [{ price: 97 }], highs: [{ price: 101 }, { price: 103.5 }] };
  const plan = buildSwingPlan(f);

  assert.equal(plan.target, 103.5, "2% 內的 101 不可當目標，否則 RR 幾乎歸零");
  assert.equal(plan.nearestResistance, 101, "但要把被跳過的關卡回報出來");
});

test("buildSwingPlan：最近壓力就是目標時不重複回報", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 100;
  f.ma20 = 95;
  f.boll = { ...f.boll, lower: 96 };
  f.swings = { ...f.swings, lows: [{ price: 97 }], highs: [{ price: 103.5 }, { price: 110 }] };
  const plan = buildSwingPlan(f);
  assert.equal(plan.target, 103.5);
  assert.equal(plan.nearestResistance, null, "沒有被跳過的關卡就不該顯示");
});

test("buildSwingPlan：上方完全沒有壓力時 nearestResistance 為 null", () => {
  const f = computeSwingFeatures(upRows);
  f.last.close = 100;
  f.ma20 = 95;
  f.boll = { ...f.boll, lower: 96 };
  f.swings = { ...f.swings, lows: [{ price: 97 }], highs: [{ price: 90 }] };
  const plan = buildSwingPlan(f);
  assert.equal(plan.nearestResistance, null);
  assert.ok(plan.target > plan.entry, "沒有壓力時走量測幅度或 2R，目標仍須高於進場");
});
