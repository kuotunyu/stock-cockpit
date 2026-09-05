// 收盤後排程：server.mjs 以前沒有任何 setInterval，快照與驗證推進全靠有人開 App
// （大跌日沒人開就不進分母；朋友第一次 clone 每個畫面都要等冷計算）。
// 這裡釘：決策純函式（何時該跑）、編排（缺什麼就跑什麼，deps 可注入）、關閉開關。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay, compactToday } from "../helpers/fixtures.mjs";

const { mod } = await importServer({ routes: [] });
const today = compactToday();
const iso = (compact) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
const referenceFor = (twse, tpex, coverageComplete = true) => ({
  coverageComplete,
  markets: { twse: { asOf: iso(twse) }, tpex: { asOf: iso(tpex) } },
});

test("closeTasksDue：今天跑過、資料未對齊、覆蓋不完整 → 不跑；兩市場都是今天且缺快照 → 跑並說缺什麼", () => {
  const yesterday = compactTradingDay(-1);
  assert.deepEqual(mod.closeTasksDue({ today, reference: referenceFor(today, today), db: {}, lastRunDay: today }).due, false);
  assert.equal(mod.closeTasksDue({ today, reference: referenceFor(today, today), db: {}, lastRunDay: today }).reason, "already-ran");
  assert.equal(mod.closeTasksDue({ today, reference: referenceFor(today, yesterday), db: {}, lastRunDay: "" }).reason, "reference-not-today");
  assert.equal(mod.closeTasksDue({ today, reference: referenceFor(today, today, false), db: {}, lastRunDay: "" }).reason, "reference-not-today");
  assert.equal(mod.closeTasksDue({ today: "", reference: referenceFor(today, today), db: {}, lastRunDay: "" }).reason, "no-date");

  const nothing = mod.closeTasksDue({ today, reference: referenceFor(today, today), db: {}, lastRunDay: "" });
  assert.deepEqual(nothing, { due: true, reason: "ok", needOvernight: true, needSwing: true });

  const both = mod.closeTasksDue({
    today,
    reference: referenceFor(today, today),
    db: {
      signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
      swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION, provisional: false } } },
    },
    lastRunDay: "",
  });
  assert.deepEqual(both, { due: true, reason: "ok", needOvernight: false, needSwing: false });

  const staleVersion = mod.closeTasksDue({
    today,
    reference: referenceFor(today, today),
    db: {
      signalSnapshots: [{ asOf: iso(today), formulaVersion: "overnight-v0-old", picks: [] }],
      swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION, provisional: true } } },
    },
    lastRunDay: "",
  });
  assert.equal(staleVersion.needOvernight, true, "舊版快照不算今天已落盤");
  assert.equal(staleVersion.needSwing, true, "provisional 快照不算");
});

test("runScheduledCloseTasks：缺什麼跑什麼，都有則只推進驗證；不該跑時什麼都不碰", async () => {
  const calls = [];
  const deps = (db) => ({
    getReferenceData: async () => referenceFor(today, today),
    loadDb: async () => db,
    buildOvernightSignals: async (opts) => { calls.push(["overnight", opts]); },
    buildSwingBoard: async () => { calls.push(["swing"]); },
    advanceSwingVerification: async () => { calls.push(["advance"]); },
    lastRunDay: "",
  });
  let result = await mod.runScheduledCloseTasks(deps({}));
  assert.deepEqual(result, { ran: ["overnight", "swing"], skipped: "", persisted: false }, "loadDb 永遠回 {} → 沒落盤");
  assert.deepEqual(calls[0], ["overnight", { persistSnapshot: true }]);
  assert.deepEqual(calls[1], ["swing"]);

  calls.length = 0;
  result = await mod.runScheduledCloseTasks(deps({
    signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
    swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION } } },
  }));
  assert.deepEqual(result, { ran: ["advance"], skipped: "", persisted: true });
  assert.deepEqual(calls, [["advance"]]);

  calls.length = 0;
  result = await mod.runScheduledCloseTasks({ ...deps({}), getReferenceData: async () => referenceFor(today, compactTradingDay(-1)) });
  assert.deepEqual(result, { ran: [], skipped: "reference-not-today", persisted: false });
  assert.deepEqual(calls, []);
});

test("startCloseScheduler：STOCK1_SKIP_LISTEN（測試行程）下不啟動；stop 是冪等的", () => {
  assert.equal(mod.startCloseScheduler(), null, "測試 import 模式不得留下 interval");
  mod.stopCloseScheduler();
  mod.stopCloseScheduler();
  assert.equal(mod.SCHEDULER_INTERVAL_MS, 10 * 60 * 1000);
});

// ---- 第二輪第一批：排程的保護缺口 ----
test("provisional 不算已跑：builder 跑完 db 仍缺快照 → persisted=false、不設 lastRunDay、下一輪重跑", async () => {
  mod.resetCloseSchedulerStateForTest();
  const calls = [];
  const deps = {
    now: new Date(),
    getReferenceData: async () => referenceFor(today, today),
    loadDb: async () => ({}), // 歷史覆蓋不足時 builder 只回 provisional、絕不落盤
    buildOvernightSignals: async () => { calls.push("overnight"); },
    buildSwingBoard: async () => { calls.push("swing"); return { provisional: true }; },
    advanceSwingVerification: async () => { calls.push("advance"); },
  };
  const first = await mod.runScheduledCloseTasks(deps);
  assert.deepEqual(first, { ran: ["overnight", "swing"], skipped: "", persisted: false });
  assert.equal(mod.closeSchedulerStateForTest().lastRunDay, "", "沒落盤不可標記今天已跑");
  const second = await mod.runScheduledCloseTasks(deps);
  assert.equal(second.skipped, "", "沒落盤就該重跑，不是 already-ran");
  assert.deepEqual(calls, ["overnight", "swing", "overnight", "swing"]);
});

test("真的落盤才標記今天已跑；之後同一天回 already-ran", async () => {
  mod.resetCloseSchedulerStateForTest();
  const stored = {
    signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
    swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION, provisional: false } } },
  };
  let db = {};
  const deps = {
    getReferenceData: async () => referenceFor(today, today),
    loadDb: async () => db,
    buildOvernightSignals: async () => { db = stored; },
    buildSwingBoard: async () => {},
    advanceSwingVerification: async () => {},
  };
  const result = await mod.runScheduledCloseTasks(deps);
  assert.equal(result.persisted, true);
  assert.equal(mod.closeSchedulerStateForTest().lastRunDay, today);
  assert.equal((await mod.runScheduledCloseTasks(deps)).skipped, "already-ran");
});

test("失敗退避：10→20→40 分鐘後才重試、退避期間不打上游；一天 3 次後停到隔天；成功歸零", async () => {
  mod.resetCloseSchedulerStateForTest();
  let upstreamCalls = 0;
  const base = Date.UTC(2026, 8, 7, 7, 30); // 2026-09-07 15:30 台北
  const failing = (offsetMs) => ({
    now: new Date(base + offsetMs),
    getReferenceData: async () => { upstreamCalls += 1; throw new Error("upstream down"); },
    loadDb: async () => ({}),
  });
  await assert.rejects(mod.runScheduledCloseTasks(failing(0)), /upstream down/);
  let state = mod.closeSchedulerStateForTest();
  assert.equal(state.failures, 1);
  assert.equal(state.retryAt, base + 10 * 60 * 1000);
  assert.deepEqual(await mod.runScheduledCloseTasks(failing(5 * 60 * 1000)), { ran: [], skipped: "backoff", persisted: false });
  assert.equal(upstreamCalls, 1, "退避期間不得打上游");
  await assert.rejects(mod.runScheduledCloseTasks(failing(11 * 60 * 1000)), /upstream down/);
  state = mod.closeSchedulerStateForTest();
  assert.equal(state.failures, 2);
  assert.equal(state.retryAt, base + 11 * 60 * 1000 + 20 * 60 * 1000);
  await assert.rejects(mod.runScheduledCloseTasks(failing(40 * 60 * 1000)), /upstream down/);
  assert.equal(mod.closeSchedulerStateForTest().failures, 3);
  assert.deepEqual(await mod.runScheduledCloseTasks(failing(5 * 60 * 60 * 1000)), { ran: [], skipped: "daily-cap", persisted: false }, "同一天第 4 次不再嘗試");
  assert.equal(upstreamCalls, 3);
  assert.equal(mod.SCHEDULER_MAX_FAILURES_PER_DAY, 3);
  // 隔天歸零：能再跑（這次成功 → failures 歸零）
  const nextDay = base + 24 * 60 * 60 * 1000;
  const ok = await mod.runScheduledCloseTasks({
    now: new Date(nextDay),
    getReferenceData: async () => referenceFor(compactToday(), compactTradingDay(-1)), // not-today → 不跑但算成功
    loadDb: async () => ({}),
  });
  assert.equal(ok.skipped, "reference-not-today");
  assert.equal(mod.closeSchedulerStateForTest().failures, 0);
});
