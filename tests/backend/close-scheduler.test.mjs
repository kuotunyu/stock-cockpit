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
  assert.deepEqual(result, { ran: ["overnight", "swing"], skipped: "" });
  assert.deepEqual(calls[0], ["overnight", { persistSnapshot: true }]);
  assert.deepEqual(calls[1], ["swing"]);

  calls.length = 0;
  result = await mod.runScheduledCloseTasks(deps({
    signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
    swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION } } },
  }));
  assert.deepEqual(result, { ran: ["advance"], skipped: "" });
  assert.deepEqual(calls, [["advance"]]);

  calls.length = 0;
  result = await mod.runScheduledCloseTasks({ ...deps({}), getReferenceData: async () => referenceFor(today, compactTradingDay(-1)) });
  assert.deepEqual(result, { ran: [], skipped: "reference-not-today" });
  assert.deepEqual(calls, []);
});

test("startCloseScheduler：STOCK1_SKIP_LISTEN（測試行程）下不啟動；stop 是冪等的", () => {
  assert.equal(mod.startCloseScheduler(), null, "測試 import 模式不得留下 interval");
  mod.stopCloseScheduler();
  mod.stopCloseScheduler();
  assert.equal(mod.SCHEDULER_INTERVAL_MS, 10 * 60 * 1000);
});
