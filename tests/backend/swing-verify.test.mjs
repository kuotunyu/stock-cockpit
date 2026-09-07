// 波段前向驗證（審計 E）：逐日推進規則（達標/停損/超時/雙觸/防重跑）、
// 驗證單記錄（去重/欄位缺漏跳過/每場景上限）、90 天讀取窗口、批次推進＋場景統計。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay, rocSlash } from "../helpers/fixtures.mjs";

let mod, mock;
before(async () => {
  ({ mod, mock } = await importServer({ routes: [] })); // 純函式＋本機 DB，不打網路
});

// 標準驗證單：進場 100、停損 95、目標 110，昨天建立。
function makeEntry(overrides = {}) {
  return {
    code: "2330",
    name: "台積電",
    scenario: "midBandDefense",
    entry: 100,
    stop: 95,
    target: 110,
    rr: 2,
    score: 80,
    formulaVersion: mod?.SWING_FORMULA_VERSION || "swing-v15-valid-min-target",
    status: "pending",
    resolvedAt: null,
    resultPct: null,
    daysHeld: 0,
    lastChecked: compactTradingDay(-1),
    ...overrides,
  };
}
const dayQuote = (over = {}) => ({ rawDate: compactTradingDay(0), open: 102, high: 105, low: 99, price: 103, ...over });
const quoteAt = (rawDate, over = {}) => ({ rawDate, open: 100, high: 105, low: 96, price: 101, ...over });

test('已知不支援模型：直接推進與歷史 replay 都保留價格、結案與缺口原證據', () => {
  for (const mode of ['direct', 'replay']) {
    const entry = makeEntry({ identity: { ...mod.currentVerificationIdentity('swing'), entryModel: 'next-open-simulation' },
      dataGap: { from: compactTradingDay(-1) }, verificationRetry: { reason: 'original' } });
    const before = structuredClone(entry);
    if (mode === 'direct') assert.equal(mod.advanceSwingVerificationEntry(entry, dayQuote({high:120})), false);
    else assert.equal(mod.replaySwingVerificationHistory(entry, [dayQuote({high:120})], compactTradingDay(0)).unavailableReason, 'unsupported-verification-model');
    const { evaluationUnavailable, ...evidence } = entry;
    assert.deepEqual(evidence, before);
    assert.equal(evaluationUnavailable.reason, 'unsupported-verification-model');
  }
});

test("推進：碰到目標＝達標（出場價＝目標；跳空開高用開盤價）", () => {
  const hit = makeEntry();
  assert.equal(mod.advanceSwingVerificationEntry(hit, dayQuote({ high: 111 })), true);
  assert.equal(hit.status, "win");
  assert.equal(hit.resultPct, 10, "(110−100)/100");
  assert.equal(hit.resolvedAt, compactTradingDay(0));
  assert.equal(hit.daysHeld, 1);

  const gapUp = makeEntry();
  mod.advanceSwingVerificationEntry(gapUp, dayQuote({ open: 115, high: 116, low: 112, price: 114 }));
  assert.equal(gapUp.status, "win");
  assert.equal(gapUp.resultPct, 15, "開盤直接跳過目標 → 用開盤價計（更誠實）");
});

test("推進：碰到停損＝停損（跳空開低用開盤價計滑價）；同日雙觸保守記停損", () => {
  const stopHit = makeEntry();
  mod.advanceSwingVerificationEntry(stopHit, dayQuote({ low: 94, high: 99, open: 97 }));
  assert.equal(stopHit.status, "loss");
  assert.equal(stopHit.resultPct, -5, "出場＝停損 95");

  const gapDown = makeEntry();
  mod.advanceSwingVerificationEntry(gapDown, dayQuote({ open: 92, low: 91, high: 96, price: 93 }));
  assert.equal(gapDown.status, "loss");
  assert.equal(gapDown.resultPct, -8, "跳空開低 → 用開盤價 92 計實際出場");

  const both = makeEntry();
  mod.advanceSwingVerificationEntry(both, dayQuote({ low: 94, high: 111 }));
  assert.equal(both.status, "loss", "同日高低都碰到 → 日K無序列，保守記停損");
});

// D-24：「同日雙觸保守記停損」的前提是「不知道盤中先碰哪一邊」。
// 台股開盤是集合競價、是當日第一筆成交且時序完全確定——開盤價若已越過某一邊，
// 掛在那個價位的單就是在那一撮成交的，沒有先後可猜，保守規則的前提不成立。
// 舊寫法把停損判定放在目標之前且不看開盤，偏誤是單向的：只會把真實獲利記成虧損。
test("D-24：開盤已跳空越過目標，即使當日也跌破停損，仍是達標而非停損", () => {
  const gapUpThenDrop = makeEntry();
  // 09:00 集合競價就成交在 112（已越過目標 110），之後才殺到 94。
  mod.advanceSwingVerificationEntry(gapUpThenDrop, dayQuote({ open: 112, high: 113, low: 94, price: 96 }));
  assert.equal(gapUpThenDrop.status, "win", "開盤 112 時掛在 110 的賣單必然已於該撮成交");
  assert.equal(gapUpThenDrop.resultPct, 12, "出場價＝開盤 112，不是停損 95");

  // 反向仍照舊：開盤跌破停損就是停損，即使當日高點也摸到目標。
  const gapDownThenRally = makeEntry();
  mod.advanceSwingVerificationEntry(gapDownThenRally, dayQuote({ open: 92, high: 111, low: 91, price: 108 }));
  assert.equal(gapDownThenRally.status, "loss");
  assert.equal(gapDownThenRally.resultPct, -8, "出場價＝開盤 92");
});

test("D-24：開盤落在停損與目標之間時，維持原本的雙觸保守規則", () => {
  const inside = makeEntry();
  // 開盤 102 在區間內 → 盤中先後真的不明 → 保守記停損。
  mod.advanceSwingVerificationEntry(inside, dayQuote({ open: 102, high: 111, low: 94, price: 96 }));
  assert.equal(inside.status, "loss", "開盤沒越過任何一邊，序列不明的前提仍成立");
  assert.equal(inside.resultPct, -5, "出場價＝停損 95");

  // 邊界：開盤恰等於停損 → 仍走停損出場（價格相同，不因改寫而漂移）。
  const atStop = makeEntry();
  mod.advanceSwingVerificationEntry(atStop, dayQuote({ open: 95, high: 111, low: 94, price: 96 }));
  assert.equal(atStop.status, "loss");
  assert.equal(atStop.resultPct, -5);

  // 邊界：開盤恰等於目標 → 達標，出場價＝目標。
  const atTarget = makeEntry();
  mod.advanceSwingVerificationEntry(atTarget, dayQuote({ open: 110, high: 113, low: 94, price: 96 }));
  assert.equal(atTarget.status, "win");
  assert.equal(atTarget.resultPct, 10);
});

test("D-24：開盤價缺值時不得用 NaN 判定，退回既有的高低價規則", () => {
  const noOpen = makeEntry();
  // 官方資料偶爾缺開盤價；num() 會給 NaN，不可讓它靜默通過比較。
  mod.advanceSwingVerificationEntry(noOpen, { rawDate: compactTradingDay(0), open: null, high: 111, low: 94, price: 96 });
  assert.equal(noOpen.status, "loss", "開盤未知 → 序列不明 → 保守記停損");
  assert.equal(noOpen.resultPct, -5);
});

test("推進：15 個交易日沒碰到 → 以收盤結案（超時）；期間內無觸價只累加天數", () => {
  const pending = makeEntry();
  assert.equal(mod.advanceSwingVerificationEntry(pending, dayQuote()), true);
  assert.equal(pending.status, "pending", "沒觸價 → 繼續等");
  assert.equal(pending.daysHeld, 1);

  const old = makeEntry({ daysHeld: 14 });
  mod.advanceSwingVerificationEntry(old, dayQuote({ price: 103 }));
  assert.equal(old.status, "expired");
  assert.equal(old.resultPct, 3, "以第 15 天收盤 103 計");
});

test("推進：日期沒前進不動（同日重跑、上市/上櫃收盤檔落後）；壞報價不動", () => {
  const same = makeEntry({ lastChecked: compactTradingDay(0) });
  assert.equal(mod.advanceSwingVerificationEntry(same, dayQuote()), false, "同日不重複計");
  assert.equal(same.daysHeld, 0);

  const lagging = makeEntry({ lastChecked: compactTradingDay(0) });
  assert.equal(mod.advanceSwingVerificationEntry(lagging, dayQuote({ rawDate: compactTradingDay(-1) })), false, "落後市場的舊報價不推進");

  const badQuote = makeEntry();
  assert.equal(mod.advanceSwingVerificationEntry(badQuote, dayQuote({ high: null })), false, "缺高低價不動");
  assert.equal(badQuote.daysHeld, 0);

  const resolved = makeEntry({ status: "win" });
  assert.equal(mod.advanceSwingVerificationEntry(resolved, dayQuote()), false, "已結案不再動");
});

test("漏開 App 逐日補判：D1 先停損、D2 才達標，必須按時間記 loss", () => {
  const d0 = "20260706", d1 = "20260707", d2 = "20260708";
  const entry = makeEntry({ lastChecked: d0 });
  const result = mod.replaySwingVerificationHistory(entry, [
    quoteAt(d2, { high: 112, low: 100, price: 111 }),
    quoteAt(d1, { high: 103, low: 94, price: 96 }),
  ], d2, { tradingDays: [d0, d1, d2], holidayRows: [] });
  assert.equal(result.missingDate, "");
  assert.equal(entry.status, "loss");
  assert.equal(entry.resolvedAt, d1);
  assert.equal(entry.daysHeld, 1);
});

test("漏開 App 逐日補判：D1 先達標、D2 才停損，必須按時間記 win", () => {
  const d0 = "20260706", d1 = "20260707", d2 = "20260708";
  const entry = makeEntry({ lastChecked: d0 });
  mod.replaySwingVerificationHistory(entry, [
    quoteAt(d1, { high: 112, low: 99, price: 111 }),
    quoteAt(d2, { high: 102, low: 94, price: 95 }),
  ], d2, { tradingDays: [d0, d1, d2], holidayRows: [] });
  assert.equal(entry.status, "win");
  assert.equal(entry.resolvedAt, d1);
});

test("缺中間日 K：停在缺口前、不拿較晚一天替代，也不增加持有日", () => {
  const d0 = "20260706", d1 = "20260707", d2 = "20260708";
  const entry = makeEntry({ lastChecked: d0 });
  const result = mod.replaySwingVerificationHistory(entry, [
    quoteAt(d2, { high: 112, low: 94, price: 100 }),
  ], d2, { tradingDays: [d0, d1, d2], holidayRows: [] });
  assert.equal(result.missingDate, d1);
  assert.equal(entry.status, "pending");
  assert.equal(entry.lastChecked, d0);
  assert.equal(entry.daysHeld, 0);
  assert.equal(entry.dataGap.from, d1);
});

test("15 個實際交易日即超時：週末不算持有日", () => {
  const d0 = "20260615"; // Monday
  const tradingDays = [d0];
  let cursor = new Date(Date.UTC(2026, 5, 15));
  while (tradingDays.length < 16) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
    tradingDays.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}${String(cursor.getUTCDate()).padStart(2, "0")}`);
  }
  const quotes = tradingDays.slice(1).map((day) => quoteAt(day));
  const entry = makeEntry({ lastChecked: d0 });
  mod.replaySwingVerificationHistory(entry, quotes, tradingDays.at(-1), { tradingDays, holidayRows: [] });
  assert.equal(entry.status, "expired");
  assert.equal(entry.daysHeld, 15);
  assert.equal(entry.resolvedAt, tradingDays.at(-1));
});

test("recordSwingVerification：建單、同日去重、缺 plan 欄位跳過、每場景上限 40", () => {
  const db = { swingVerification: {} };
  const pick = (code, scenario = "midBandDefense", plan = { entry: 100, structuralStop: 95, target: 110, rr: 2 }) => ({
    code, name: `測${code}`, scenario: { key: scenario, name: scenario }, score: 70, plan,
  });
  const body = {
    asOf: compactTradingDay(0),
    formulaVersion: mod.SWING_FORMULA_VERSION,
    picks: [
      pick("2330"),
      pick("1101"),
      pick("9999", "midBandDefense", { entry: 100 }), // 缺 stop/target → 跳過
    ],
  };
  mod.recordSwingVerification(db, body);
  const list = db.swingVerification[compactTradingDay(0)];
  assert.equal(list.length, 2, "缺欄位的要跳過");
  assert.equal(list[0].stop, 95, "停損用結構停損");
  assert.equal(list[0].lastChecked, compactTradingDay(0), "建單日不能當天就被推進");
  // 同日重錄（快照補齊情境）→ 不重複
  mod.recordSwingVerification(db, body);
  assert.equal(db.swingVerification[compactTradingDay(0)].length, 2, "同日同檔同場景去重");
  // 每場景上限 40
  const manyBody = {
    asOf: compactTradingDay(0),
    formulaVersion: mod.SWING_FORMULA_VERSION,
    picks: Array.from({ length: 60 }, (_, i) => pick(String(3000 + i))),
  };
  mod.recordSwingVerification(db, manyBody);
  const sameScenario = db.swingVerification[compactTradingDay(0)].filter((e) => e.scenario === "midBandDefense");
  assert.equal(sameScenario.length, 40, "含既有 2 檔在內，同場景最多 40");
});

test("recordSwingVerification：同日同檔不同公式版本分開保留", () => {
  const day = compactTradingDay(0);
  const db = { swingVerification: {} };
  const pick = {
    code: "2330", name: "台積電", scenario: { key: "midBandDefense" }, score: 70,
    plan: { entry: 100, structuralStop: 95, target: 110, rr: 2 },
  };
  mod.recordSwingVerification(db, { asOf: day, formulaVersion: "old-v1", picks: [pick] });
  mod.recordSwingVerification(db, { asOf: day, formulaVersion: mod.SWING_FORMULA_VERSION, picks: [pick] });
  mod.recordSwingVerification(db, { asOf: day, formulaVersion: mod.SWING_FORMULA_VERSION, picks: [pick] });
  assert.equal(db.swingVerification[day].length, 2, "不同版本各留一筆，同版本重跑仍去重");
});

test("recordSwingVerification：provisional 掃描不可建立不可回溯的驗證單", () => {
  const db = { swingVerification: {} };
  mod.recordSwingVerification(db, {
    asOf: compactTradingDay(0),
    provisional: true,
    coverage: { complete: false },
    formulaVersion: "v1",
    picks: [{
      code: "2330", name: "台積電", scenario: { key: "midBandDefense" }, score: 70,
      plan: { entry: 100, structuralStop: 95, target: 110, rr: 2 },
    }],
  });
  assert.deepEqual(db.swingVerification, {}, "資料覆蓋不足時不能新增正式樣本");
});

test("selectSwingVerificationWindow：窗口排除但儲存保留", () => {
  const store = {
    [compactTradingDay(-100)]: [makeEntry()],
    [compactTradingDay(-5)]: [makeEntry()],
  };
  const window = mod.selectSwingVerificationWindow(store, { keepDays: 90 });
  assert.equal(window[compactTradingDay(-100)], undefined, "超過 90 天不進窗口");
  assert.ok(store[compactTradingDay(-100)], "儲存證據仍在");
  assert.ok(store[compactTradingDay(-5)], "近期的要留");
});

test("recordSwingVerification：新增樣本後立即清摘要快取", async () => {
  const db = await mod.loadDb();
  db.swingVerification = {};
  const before = await mod.buildSwingVerificationSummary();
  assert.equal(before.scenarios.length, 0);
  mod.recordSwingVerification(db, {
    asOf: compactTradingDay(0), formulaVersion: mod.SWING_FORMULA_VERSION,
    picks: [{
      code: "2330", name: "台積電", scenario: { key: "midBandDefense" }, score: 80,
      plan: { entry: 100, structuralStop: 95, target: 110, rr: 2 },
    }],
  });
  const after = await mod.buildSwingVerificationSummary();
  assert.equal(after.scenarios.find((item) => item.scenario === "midBandDefense")?.samples, 1);
});

test("批次推進：reference 覆蓋不完整時不鎖日也不推進", async () => {
  const db = await mod.loadDb();
  db.swingVerification = {
    [compactTradingDay(-4)]: [makeEntry({ lastChecked: compactTradingDay(-1) })],
  };
  await mod.advanceSwingVerification({
    coverageComplete: false,
    byCode: new Map([["2330", dayQuote()]]),
  }, compactTradingDay(0));
  assert.equal(db.swingVerification[compactTradingDay(-4)][0].daysHeld, 0);
  assert.equal(db.swingVerification[compactTradingDay(-4)][0].status, "pending");
});

test("批次推進＋場景統計：相鄰交易日用整批收盤，未知市場保留重試原因", async (t) => {
  // 此案例餵完整當日收盤，時刻與跨月來源章也必須一致；不能在跨年時靠無路由失敗。
  const today = compactTradingDay(0);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(`${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6)}T08:00:00Z`) });
  const removeCalendar = mock.override({ match: /rwd\/zh\/afterTrading\/FMTQIK/, reply: (url) => {
    const month = url.searchParams.get('date').slice(0,6);
    return { stat: 'OK', data: Array.from({length:70},(_,i)=>compactTradingDay(-i)).filter(day=>day.startsWith(month)).reverse().map(day=>[rocSlash(day)]) };
  } });
  t.after(() => { removeCalendar(); t.mock.timers.reset(); });
  const db = await mod.loadDb();
  db.swingVerification = {
    [compactTradingDay(-3)]: [
      makeEntry(),                                                        // 2330 → 今天 high 111 → win
      makeEntry({ code: "1101", entry: 40, stop: 38, target: 44 }),       // 1101 → 今天 low 37.5 → loss
      makeEntry({ code: "5555", entry: 50, stop: 47, target: 55 }),       // 不在 reference → 不動
      makeEntry({ code: "9998", formulaVersion: "old-v1", status: "win", resultPct: 10, daysHeld: 2, resolvedAt: compactTradingDay(-1) }),
    ],
  };
  const reference = {
    byCode: new Map([
      ["2330", { code: "2330", source: "TWSE OpenAPI", rawDate: compactTradingDay(0), open: 104, high: 111, low: 101, price: 108 }],
      ["1101", { code: "1101", source: "TWSE OpenAPI", rawDate: compactTradingDay(0), open: 39, high: 40, low: 37.5, price: 38.5 }],
    ]),
  };
  await mod.advanceSwingVerification(reference, compactTradingDay(0));
  const entries = db.swingVerification[compactTradingDay(-3)];
  assert.equal(entries.find((e) => e.code === "2330").status, "win");
  assert.equal(entries.find((e) => e.code === "1101").status, "loss");
  assert.equal(entries.find((e) => e.code === "5555").status, "pending", "查無報價 → 維持等待");

  const summary = await mod.buildSwingVerificationSummary();
  const s = summary.scenarios.find((item) => item.scenario === "midBandDefense");
  assert.equal(s.samples, 3);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.pending, 1);
  // D-27（2026-07-26）：勝率需累積 WIN_RATE_MIN_SAMPLES 筆結案才顯示。
  // 這裡只有 2 筆結案 → winRate 為 null（不是「沒資料」，是「還不足以當結論」）。
  // 計數本身仍要正確，所以改驗 resolved 與各分類數。
  assert.equal(s.resolved, 2, "結案數＝達標＋停損＋超時");
  assert.equal(s.winRate, null, `結案 2 筆低於門檻 ${mod.WIN_RATE_MIN_SAMPLES}，不得給百分比`);
  assert.equal(s.winRateMinSamples, mod.WIN_RATE_MIN_SAMPLES, "前端要靠這個顯示累積進度");
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.dataGapCount, 0, "5555 未知市場不能冒充官方缺 K");
  assert.equal(entries.find(e => e.code === "5555").verificationRetry.reason, "market-unknown");
  assert.equal(summary.recent.length, 2, "只列已結案");
  assert.equal(summary.currentFormulaVersion, mod.SWING_FORMULA_VERSION);
  assert.ok(summary.formulaVersions.some((item) => item.formulaVersion === "old-v1" && item.samples === 1));
  assert.ok(summary.notes.some((n) => n.includes("保守記停損")), "規則要寫給使用者看");
  assert.ok(summary.notes.some((n) => n.includes("漏開 App") && n.includes("補判")), "漏日補驗規則要透明");
});

test("regime 分層：建單時記錄大盤位階（精簡版），summary 依季線上／下分層且各自套最小樣本", async () => {
  const db = {};
  const day = compactTradingDay(0);
  const pick = (code, scenario) => ({ code, name: code, scenario: { key: scenario }, score: 80, plan: { entry: 100, structuralStop: 95, target: 110, rr: 2 } });
  mod.recordSwingVerification(db, {
    asOf: day, formulaVersion: mod.SWING_FORMULA_VERSION,
    regime: { asOf: day, close: 1, ma20: 1, ma60: 1, aboveMa20: true, aboveMa60: false },
    picks: [pick("1101", "midBandDefense")],
  });
  const entry = db.swingVerification[day][0];
  // 兩個布林＋與均線的距離（close/ma − 1）；仍不塞整段均線。close 1／ma 1 → 距離 0。
  assert.deepEqual(entry.regime, { asOf: day, aboveMa20: true, aboveMa60: false, distMa20Pct: 0, distMa60Pct: 0 }, "只留分層用得到的欄位，不塞整段均線");
  mod.recordSwingVerification(db, { asOf: day, formulaVersion: mod.SWING_FORMULA_VERSION, picks: [pick("1102", "midBandDefense")] });
  assert.equal(db.swingVerification[day][1].regime, null, "抓不到 regime 就 null，不猜");
  assert.equal(mod.regimeBucket(entry.regime), "belowMa60");
  assert.equal(mod.regimeBucket(db.swingVerification[day][1].regime), "unknown");
});

test("分佈指標：PF／中位數／最長連虧／最差單日；處置股（分盤）不進 headline 分母、另列 withPeriodicCall", async () => {
  const db = await mod.loadDb();
  const day = compactTradingDay(-10);
  const resolved = (code, status, resultPct, resolvedAt, extra = {}) => makeEntry({ identity:{...mod.currentVerificationIdentity("swing"),evaluationVersion:'swing-price-observation-v1',costModelVersion:'flat-round-trip-0.471pct-v1',returnBasis:'adjusted-reference-price'}, code, status, resultPct, resolvedAt, daysHeld: 3, lastChecked: resolvedAt, ...extra });
  const entries = [];
  // 21 筆連續競價：前 3 筆同一天停損（最長連虧 3、最差單日），之後 11 勝（+5）／7 負（−3）交錯
  const d = (offset) => compactTradingDay(-9 + offset);
  entries.push(resolved("A001", "loss", -3, d(0)), resolved("A002", "loss", -3, d(0)), resolved("A003", "loss", -3, d(0)));
  for (let i = 0; i < 18; i += 1) {
    const win = i % 2 === 0; // 9 勝 9 負 → 加上面 3 負：勝 9、負 12？調整：讓 11 勝 10 負
    entries.push(resolved(`B${String(i).padStart(3, "0")}`, win ? "win" : "loss", win ? 5 : -3, d(1 + Math.floor(i / 2))));
  }
  entries.push(resolved("C001", "win", 5, d(9)), resolved("C002", "win", 5, d(9)));
  // 4 筆分盤撮合（處置股）全勝：不可灌進 headline
  for (let i = 0; i < 4; i += 1) entries.push(resolved(`P${i}`, "win", 8, d(9), { fillModel: "periodicCall5" }));
  db.swingVerification = { [day]: entries };
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  const s = summary.scenarios.find((item) => item.scenario === "midBandDefense");
  // 連續競價：3 負 + 9 勝 9 負 + 2 勝 = 11 勝 12 負 = 23 筆
  assert.equal(s.continuousResolved, 23);
  assert.equal(s.resolved, 27, "計數含處置股");
  assert.equal(s.winRate, Math.round((11 / 23) * 1000) / 10, "headline 勝率分母只算連續競價");
  assert.equal(s.withPeriodicCall.resolved, 27);
  assert.equal(s.withPeriodicCall.wins, 15);
  assert.equal(s.withPeriodicCall.winRate, Math.round((15 / 27) * 1000) / 10);
  // PF ＝ 11×5 ÷ 12×3 ＝ 55/36
  assert.equal(s.profitFactor, Math.round((55 / 36) * 100) / 100);
  assert.equal(s.medianResultPct, -3, "23 筆裡 12 筆 −3、11 筆 +5 → 中位數落在 −3");
  // 淨口徑：勝率用 status、PF 卻用毛正負分——同一批樣本兩種定義。淨 PF ＝ 11×(5−0.471) ÷ 12×(3+0.471)
  assert.equal(s.profitFactorNet, Math.round((11 * mod.netReturnPct(5)) / (12 * Math.abs(mod.netReturnPct(-3))) * 100) / 100);
  assert.equal(s.medianResultPctNet, mod.netReturnPct(-3));
  // 連虧以「結案日」為叢集：同一天 3 筆停損是一個叢集不是三個；之後每天勝負交錯（日平均 +1）→ 最長連虧 1 天
  assert.equal(s.maxConsecutiveLossDays, 1, "同日停損算 1 天，不再依代號排序算出 3");
  assert.equal(s.maxConsecutiveLosses, undefined, "舊的逐筆連虧（同日以 code 排序）已移除");
  assert.deepEqual(s.worstDay, { day: d(0), avgResultPct: -3, count: 3 });
  assert.equal(s.avgResultPct, Math.round(((55 - 36) / 23) * 100) / 100, "平均也只算連續競價");
  // 純函式
  assert.equal(mod.median([3, 1, 2]), 2);
  assert.equal(mod.median([4, 1, 2, 3]), 2.5);
  assert.equal(mod.median([]), null);
  assert.equal(mod.maxConsecutiveLossDays([
    { resultPct: -3, resolvedAt: "20260101" }, { resultPct: 5, resolvedAt: "20260102" },
    { resultPct: -3, resolvedAt: "20260103" }, { resultPct: 0.2, resolvedAt: "20260104" }, { resultPct: -1, resolvedAt: "20260104" }, // 日平均 −0.4 → 虧損日
    { resultPct: 0.3, resolvedAt: "20260105" }, // 毛 +0.3 淨 −0.171 → 仍是虧損日
    { resultPct: 6, resolvedAt: "20260106" },
  ]), 3, "0103、0104、0105 連續三個淨虧損日");
  assert.equal(mod.maxConsecutiveLossDays([]), 0);
  assert.equal(mod.worstResolvedDay([]), null);
});

test("跌停鎖死：碰停損那天賣不掉 → 順延到下一個有開的交易日以開盤價出場，記 exitModel", () => {
  assert.equal(mod.stockLimitDownPrice(100), 90);
  assert.equal(mod.stockLimitDownPrice(99.5), 89.6, "89.55 向上取 0.05 檔 → 89.6");
  assert.equal(mod.isLimitDownLockedBar({ high: 90, low: 90, close: 90 }, { close: 100 }), true);
  assert.equal(mod.isLimitDownLockedBar({ high: 91, low: 90, close: 90 }, { close: 100 }), false, "盤中有開就不算鎖死");
  const entry = makeEntry({ lastChecked: compactTradingDay(-3) });
  const d1 = compactTradingDay(-2);
  const d2 = compactTradingDay(-1);
  // D1 一價跌停鎖死（前收 100 → 90）
  assert.equal(mod.advanceSwingVerificationEntry(entry, quoteAt(d1, { open: 90, high: 90, low: 90, price: 90 }), { price: 100 }), true);
  assert.equal(entry.status, "pending", "當天賣不掉，不結案");
  assert.equal(entry.exitPending.reason, "limit-down-locked");
  assert.equal(entry.daysHeld, 1);
  // D2 開盤 88、盤中有開
  assert.equal(mod.advanceSwingVerificationEntry(entry, quoteAt(d2, { open: 88, high: 91, low: 87, price: 89 }), { price: 90 }), true);
  assert.equal(entry.status, "loss");
  assert.equal(entry.resultPct, -12, "以下一個可成交日開盤 88 出場，不是停損價 95");
  assert.equal(entry.exitModel, "limit-down-deferred");
  assert.equal(entry.exitPending, undefined);
  // 對照：碰停損但非鎖死 → 當天 loss@stop、same-day
  const normal = makeEntry({ lastChecked: compactTradingDay(-3) });
  mod.advanceSwingVerificationEntry(normal, quoteAt(d1, { open: 96, high: 97, low: 94, price: 95.5 }), { price: 100 });
  assert.equal(normal.status, "loss");
  assert.equal(normal.resultPct, -5);
  assert.equal(normal.exitModel, "same-day");
  // 連續兩天鎖死：第二天仍等
  const twice = makeEntry({ lastChecked: compactTradingDay(-3) });
  mod.advanceSwingVerificationEntry(twice, quoteAt(d1, { open: 90, high: 90, low: 90, price: 90 }), { price: 100 });
  mod.advanceSwingVerificationEntry(twice, quoteAt(d2, { open: 81, high: 81, low: 81, price: 81 }), { price: 90 });
  assert.equal(twice.status, "pending");
  assert.equal(twice.daysHeld, 2);
});

test("停牌：pending 單標 halted、單獨計數、不併進「卡住」，解除後恢復推進", async () => {
  const db = await mod.loadDb();
  const target = compactTradingDay(-1);
  const stale = compactTradingDay(-45);
  db.swingVerification = {
    [stale]: [
      makeEntry({ code: "5555", lastChecked: stale, dataGap: { from: stale, through: target } }),
      makeEntry({ code: "6666", lastChecked: stale, dataGap: { from: stale, through: target } }),
    ],
  };
  const reference = { byCode: new Map() };
  const riskSets = { halted: new Map([["5555", "20260801"]]), delisted: new Set() };
  await mod.advanceSwingVerification(reference, target, { riskSets });
  const entries = db.swingVerification[stale];
  const halted = entries.find((e) => e.code === "5555");
  const normal = entries.find((e) => e.code === "6666");
  assert.deepEqual(halted.halted, { since: "20260801" });
  assert.equal(normal.halted, undefined);
  assert.ok(halted.dataGap && normal.dataGap, "既有已確認缺口須保留，未知市場不能清除舊證據");
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  assert.equal(summary.haltedCount, 1);
  assert.equal(summary.stalledCount, 1, "6666 缺口超過 30 天算卡住；5555 是停牌不算");
  // 名單抓不到（riskSets 為 null）：不猜也不撕。一次抓取失敗若讓 haltedCount 歸零、下一輪再標回來，
  // 就是來回抖動＋一次多餘的 DB 寫入，而且與「名單抓不到就不標」的設計相反。
  await mod.advanceSwingVerification(reference, compactTradingDay(0), { riskSets: null });
  assert.deepEqual(db.swingVerification[stale].find((e) => e.code === "5555").halted, { since: "20260801" }, "名單抓不到時保留既有標記");
  // 停牌解除：下一輪名單裡沒有它 → 撕掉 halted（同一天再推進一次要先清掉 de-dup 鍵）
  mod.resetSwingAdvanceKeyForTest();
  await mod.advanceSwingVerification(reference, compactTradingDay(0), { riskSets: { halted: new Map(), delisted: new Set() } });
  // commit 是 copy-on-write：每次推進都換一份新的 store，要重新讀
  assert.equal(db.swingVerification[stale].find((e) => e.code === "5555").halted, undefined);
});

test("口徑並陳：第一根推進記 nextOpen，結案並陳 resultPctNextOpen；summary 有 nextOpenEntry 與 allVersions", async () => {
  const entry = makeEntry({ lastChecked: compactTradingDay(-3) });
  const d1 = compactTradingDay(-2);
  const d2 = compactTradingDay(-1);
  mod.advanceSwingVerificationEntry(entry, quoteAt(d1, { open: 102, high: 104, low: 101, price: 103 }), { price: 100 });
  assert.equal(entry.nextOpen, 102, "第一根的開盤價＝次日開盤進場");
  mod.advanceSwingVerificationEntry(entry, quoteAt(d2, { open: 108, high: 111, low: 107, price: 110 }), { price: 103 });
  assert.equal(entry.status, "win");
  assert.equal(entry.resultPct, 10, "收盤進場口徑：110/100");
  assert.equal(entry.resultPctNextOpen, Math.round(((110 - 102) / 102) * 10000) / 100, "次日開盤進場口徑：110/102");

  const db = await mod.loadDb();
  const day = compactTradingDay(-10);
  const resolved = (code, status, resultPct, resultPctNextOpen, extra = {}) => makeEntry({ identity:{...mod.currentVerificationIdentity("swing"),evaluationVersion:'swing-price-observation-v1',costModelVersion:'flat-round-trip-0.471pct-v1',returnBasis:'adjusted-reference-price'}, code, status, resultPct, resultPctNextOpen, resolvedAt: day, daysHeld: 2, lastChecked: day, ...extra });
  db.swingVerification = {
    [day]: [
      resolved("A1", "win", 5, 3.2),
      resolved("A2", "loss", -3, -4.1),
      resolved("A3", "win", 2, 0.1),  // 淨報酬 0.1 − 0.471 < 0 → 次日開盤口徑算輸
      resolved("A4", "win", 4, null), // 舊單沒有 nextOpen → 不進 nextOpenEntry 分母
      resolved("O1", "win", 9, 8, { formulaVersion: "swing-v12-bandnames" }),
      resolved("O2", "loss", -6, -7, { formulaVersion: "swing-v12-bandnames" }),
    ],
  };
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  const s = summary.scenarios.find((item) => item.scenario === "midBandDefense");
  assert.deepEqual(s.nextOpenEntry, { resolved: 3, wins: 1, winRate: null, avgResultPct: Math.round(((3.2 - 4.1 + 0.1) / 3) * 100) / 100, gapSkipped: 0 });
  assert.equal(summary.allVersions.versions, 2);
  assert.equal(summary.allVersions.resolved, 6);
  assert.equal(summary.allVersions.wins, 4);
  assert.equal(summary.allVersions.winRate, null, "未達 20 筆不給百分比");
  assert.ok(summary.formulaVersions.find((v) => v.formulaVersion === "swing-v12-bandnames").wins === 1);
});

// ---- 第二輪第一批：次日開盤口徑的兩個洞 ----
test("次日開盤口徑：第一根開盤已穿過停損／目標 → 記 nextOpenSkipped=gap、不記 nextOpen、不進 nextOpenEntry 分母", async () => {
  const gapDown = makeEntry({ lastChecked: compactTradingDay(-3) });
  mod.advanceSwingVerificationEntry(gapDown, quoteAt(compactTradingDay(-2), { open: 94, high: 96, low: 93, price: 95 }), { price: 100 });
  assert.equal(gapDown.status, "loss");
  assert.equal(gapDown.resultPct, -6, "收盤進場口徑：以開盤 94 出場");
  assert.equal(gapDown.nextOpen, undefined, "開盤已在停損下方，這筆在次日開盤口徑裡根本不會進場");
  assert.equal(gapDown.nextOpenSkipped, "gap");
  assert.equal(gapDown.resultPctNextOpen, undefined, "不可記成 0%");

  const gapUp = makeEntry({ lastChecked: compactTradingDay(-3) });
  mod.advanceSwingVerificationEntry(gapUp, quoteAt(compactTradingDay(-2), { open: 111, high: 113, low: 110, price: 112 }), { price: 100 });
  assert.equal(gapUp.status, "win");
  assert.equal(gapUp.resultPct, 11);
  assert.equal(gapUp.nextOpenSkipped, "gap");
  assert.equal(gapUp.resultPctNextOpen, undefined, "跳空過目標不可記成 0%（扣費後會變成「輸」）");

  const inside = makeEntry({ lastChecked: compactTradingDay(-3) });
  mod.advanceSwingVerificationEntry(inside, quoteAt(compactTradingDay(-2), { open: 101, high: 103, low: 100, price: 102 }), { price: 100 });
  assert.equal(inside.nextOpen, 101);
  assert.equal(inside.nextOpenSkipped, undefined);

  const db = await mod.loadDb();
  const day = compactTradingDay(-10);
  const resolved = (code, status, resultPct, extra = {}) => makeEntry({ code, status, resultPct, resolvedAt: day, daysHeld: 2, lastChecked: day, ...extra });
  db.swingVerification = {
    [day]: [
      resolved("G1", "loss", -6, { nextOpenSkipped: "gap" }),
      resolved("G2", "win", 11, { nextOpenSkipped: "gap" }),
      resolved("N1", "win", 5, { nextOpen: 101, resultPctNextOpen: 3.96 }),
    ],
  };
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  const s = summary.scenarios.find((item) => item.scenario === "midBandDefense");
  assert.equal(s.nextOpenEntry.resolved, 1, "跳空的兩筆不進分母");
  assert.equal(s.nextOpenEntry.gapSkipped, 2);
  assert.equal(s.resolved, 3, "收盤進場口徑不受影響");
});

test("次日開盤口徑遇除權息：applySwingCorporateAction 同步乘 nextOpen，resultPctNextOpen 含息", () => {
  const entry = makeEntry({ lastChecked: compactTradingDay(-4) });
  mod.advanceSwingVerificationEntry(entry, quoteAt(compactTradingDay(-3), { open: 101, high: 103, low: 100, price: 102 }), { price: 100 });
  assert.equal(entry.nextOpen, 101);
  mod.applySwingCorporateAction(entry, 0.95, compactTradingDay(-2));
  assert.equal(entry.entry, 95);
  assert.equal(entry.target, 104.5);
  assert.equal(entry.nextOpen, 95.95, "除息比率要一併套到次日開盤進場價，否則股利會被算成虧損");
  mod.advanceSwingVerificationEntry(entry, quoteAt(compactTradingDay(-2), { open: 104.5, high: 106, low: 104, price: 105 }), { price: 100 });
  assert.equal(entry.status, "win");
  assert.equal(entry.resultPct, 10, "收盤進場：104.5/95");
  assert.equal(entry.resultPctNextOpen, Math.round(((104.5 - 95.95) / 95.95) * 10000) / 100, "8.91%，不是未調整的 3.47%");
});
test('新publication固定假設股數/原價；重跑不改原始部位，next-open仍舊價格身份',()=>{
  const day=compactTradingDay(-1),db={};
  const pub=mod.publishVerification(db,'swing',{asOf:day,formulaVersion:mod.SWING_FORMULA_VERSION,requestScope:{maxCandidates:240,scenarioKey:'',limit:40},coverage:{complete:true},scanQuality:{reliable:true,candidateCount:1,completedCount:1},
    picks:[{code:'2330',exchange:'TWSE',scenario:{key:'midBandDefense'},plan:{entry:100,structuralStop:95,target:110}}]});
  const e=db.swingVerification[day][0];assert.equal(e.holdingPosition.shares,1);assert.equal(e.holdingPosition.initialNotional,100);
  assert.equal(e.holdingPosition.originalRiskMoney,5);assert.equal(e.holdingPosition.quantitySource,'normalized-one-share-assumption-v1');
  const before=structuredClone(e.holdingPosition);mod.applySwingCorporateAction(e,0.95,compactTradingDay(0));assert.deepEqual(e.holdingPosition,before);
  const next=db.verificationCaptures[pub.captureId].populationModels.find(m=>m.identity.entryModel==='next-open-price-observation');
  assert.equal(next.identity.returnBasis,'adjusted-reference-price');assert.equal(next.identity.costModelVersion,'flat-round-trip-0.471pct-v1');
});
