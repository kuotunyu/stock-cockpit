// 波段前向驗證（審計 E）：逐日推進規則（達標/停損/超時/雙觸/防重跑）、
// 驗證單記錄（去重/欄位缺漏跳過/每場景上限）、90 天裁剪、批次推進＋場景統計。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay } from "../helpers/fixtures.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer({ routes: [] })); // 純函式＋本機 DB，不打網路
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

test("pruneSwingVerification：只留最近 90 天", () => {
  const store = {
    [compactTradingDay(-100)]: [makeEntry()],
    [compactTradingDay(-5)]: [makeEntry()],
  };
  mod.pruneSwingVerification(store, 90);
  assert.equal(store[compactTradingDay(-100)], undefined, "超過 90 天的要刪");
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

test("批次推進＋場景統計：相鄰交易日用整批收盤，缺個股報價保留 dataGap", async () => {
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
      ["2330", { code: "2330", rawDate: compactTradingDay(0), open: 104, high: 111, low: 101, price: 108 }],
      ["1101", { code: "1101", rawDate: compactTradingDay(0), open: 39, high: 40, low: 37.5, price: 38.5 }],
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
  assert.equal(summary.dataGapCount, 1, "5555 缺官方 K 棒要標缺口，不能跳過");
  assert.equal(summary.recent.length, 2, "只列已結案");
  assert.equal(summary.currentFormulaVersion, mod.SWING_FORMULA_VERSION);
  assert.ok(summary.formulaVersions.some((item) => item.formulaVersion === "old-v1" && item.samples === 1));
  assert.ok(summary.notes.some((n) => n.includes("保守記停損")), "規則要寫給使用者看");
  assert.ok(summary.notes.some((n) => n.includes("漏開 App") && n.includes("補判")), "漏日補驗規則要透明");
});
