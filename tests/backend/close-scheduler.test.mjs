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

function withFormal(db) {
  for (const [strategy,formulaVersion] of [['overnight',mod.OVERNIGHT_FORMULA_VERSION],['swing',mod.SWING_FORMULA_VERSION]]) {
    mod.publishVerification(db,strategy,{asOf:iso(today),formulaVersion,requestScope:mod.canonicalVerificationScope(strategy),
      coverage:{complete:true,markets:referenceFor(today,today).markets},candidatePool:[],inputEvidence:[],scanQuality:{candidateCount:0,completedCount:0,reliable:true},groups:{},picks:[]});
  }
  return db;
}

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
    db: withFormal({
      signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
      swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION, provisional: false } } },
    }),
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
  assert.deepEqual(result, { ran: ["overnight", "swing"], skipped: "", persisted: false, captureStatus: {overnight:"incomplete",swing:"incomplete"} }, "loadDb 永遠回 {} → 沒落盤");
  assert.deepEqual(calls[0], ["overnight", { persistSnapshot: true }]);
  assert.deepEqual(calls[1], ["swing"]);

  calls.length = 0;
  result = await mod.runScheduledCloseTasks(deps(withFormal({
    signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
    swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION } } },
  })));
  assert.deepEqual(result, { ran: ["advance"], skipped: "", persisted: true, captureStatus:{overnight:"complete-zero",swing:"complete-zero"} });
  assert.deepEqual(calls, [["advance"]]);

  calls.length = 0;
  result = await mod.runScheduledCloseTasks({ ...deps({}), getReferenceData: async () => referenceFor(today, compactTradingDay(-1)) });
  assert.deepEqual(result, { ran: [], skipped: "reference-not-today", persisted: false, captureStatus:{overnight:"not-captured",swing:"not-captured"},
    inputStatus:{stage:'reference',status:'incomplete',reason:'reference-not-today'} });
  assert.deepEqual(calls, []);
});

test("startCloseScheduler：STOCK1_SKIP_LISTEN（測試行程）下不啟動；stop 是冪等的", () => {
  assert.equal(mod.startCloseScheduler(), null, "測試 import 模式不得留下 interval");
  mod.stopCloseScheduler();
  mod.stopCloseScheduler();
  assert.equal(mod.SCHEDULER_INTERVAL_MS, 10 * 60 * 1000);
});

test('排程回傳採集狀態，來源未齊與上游失敗記實際嘗試；舊capture不補造manifest',async()=>{
  const events=[];const db=withFormal({});
  const deps={lastRunDay:'',loadDb:async()=>db,getReferenceData:async()=>referenceFor(today,today),advanceSwingVerification:async()=>{},
    recordCaptureAttempt:async(...args)=>events.push(args)};
  const result=await mod.runScheduledCloseTasks(deps);
  assert.equal(result.captureStatus?.overnight,'complete-zero');assert.equal(result.captureStatus?.swing,'complete-zero');
  const incomplete=await mod.runScheduledCloseTasks({...deps,getReferenceData:async()=>referenceFor(today,compactTradingDay(-1))});
  assert.equal(incomplete.captureStatus?.overnight,'complete-zero','共用來源未齊不降級已完成formal');assert.equal(events.length,1);
  assert.deepEqual(incomplete.inputStatus,{stage:'reference',status:'incomplete',reason:'reference-not-today'});
  assert.equal(events[0][0],null);assert.equal(events[0][2].stage,'reference');
  await assert.rejects(mod.runScheduledCloseTasks({...deps,getReferenceData:async()=>{throw new Error('source down');}}),/source down/);
  assert.equal(events.at(-1)[2].status,'failed');
  delete db.verificationCaptures;
  assert.equal(mod.closeTasksDue({today,reference:referenceFor(today,today),db,lastRunDay:''}).needOvernight,false,'舊first formal保持權威，不用今天重跑補manifest');
  assert.equal((await mod.runScheduledCloseTasks({...deps})).captureStatus.overnight,'legacy-unknown');
});

test('I1：無formal時讀最新同日canonical manifest/attempt，formal與legacy仍優先',async()=>{
  const db={verificationCaptures:{
    prior:{strategy:'overnight',tradeDate:iso(today),canonical:true,status:'incomplete',capturedAt:'2026-01-01T01:00:00Z'},
    failed:{strategy:'overnight',tradeDate:iso(today),canonical:true,status:'failed',kind:'provisional',capturedAt:'2026-01-01T02:00:00Z'},
    research:{strategy:'overnight',tradeDate:iso(today),canonical:false,status:'complete',capturedAt:'2026-01-01T03:00:00Z'},
    otherDay:{strategy:'swing',tradeDate:'1999-01-01',canonical:true,status:'failed',capturedAt:'2026-01-01T04:00:00Z'},
    swing:{strategy:'swing',tradeDate:iso(today),canonical:true,status:'failed',capturedAt:'2026-01-01T02:00:00Z'},
  }};
  const deps={lastRunDay:'',getReferenceData:async()=>referenceFor(today,today),loadDb:async()=>db,
    buildOvernightSignals:async()=>{},buildSwingBoard:async()=>{},advanceSwingVerification:async()=>{}};
  const result=await mod.runScheduledCloseTasks(deps);
  assert.deepEqual(result.captureStatus,{overnight:'failed',swing:'failed'});assert.equal(result.persisted,false);
  db.verificationCaptures.swing.capturedAt='2026-01-01T05:00:00Z';db.verificationCaptures.swing.status='incomplete';
  assert.equal((await mod.runScheduledCloseTasks(deps)).captureStatus.swing,'incomplete','最新實際attempt優先');
  withFormal(db);assert.deepEqual((await mod.runScheduledCloseTasks(deps)).captureStatus,{overnight:'complete-zero',swing:'complete-zero'});
  for(const id of Object.values(db.verificationPublications.current))delete db.verificationCaptures[id];
  assert.deepEqual((await mod.runScheduledCloseTasks(deps)).captureStatus,{overnight:'legacy-unknown',swing:'legacy-unknown'});
});

test('I1：failed→incomplete→重用舊failed時，本輪真實builder的capture優先於原建立時間',async()=>{
  const db={};
  const failure={asOf:iso(today),formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,requestScope:{maxCandidates:260,maxPerGroup:20},
    generatedAt:'2026-01-01T01:00:00Z',provisional:true,coverage:{complete:true,markets:referenceFor(today,today).markets},
    candidatePool:[{code:'2330',exchange:'TWSE',candidateRank:1,price:100,source:'TWSE OpenAPI',sourceAsOf:iso(today)}],
    inputEvidence:[{code:'2330',exchange:'TWSE',outcome:'source-error'}],scanQuality:{candidateCount:1,completedCount:1,reliable:false},groups:{}};
  let body=failure;
  const deps={lastRunDay:'',getReferenceData:async()=>referenceFor(today,today),loadDb:async()=>db,
    buildOvernightSignals:async()=>({publication:mod.publishVerification(db,'overnight',body)}),buildSwingBoard:async()=>{}};
  assert.equal((await mod.runScheduledCloseTasks(deps)).captureStatus.overnight,'failed');
  const first=Object.values(db.verificationPublications.captures)[0];
  body={...failure,generatedAt:'2026-01-01T02:00:00Z',inputEvidence:[{code:'2330',exchange:'TWSE',outcome:'scan-incomplete'}]};
  assert.equal((await mod.runScheduledCloseTasks(deps)).captureStatus.overnight,'incomplete');
  body=failure;
  assert.equal((await mod.runScheduledCloseTasks(deps)).captureStatus.overnight,'failed');
  assert.equal(Object.keys(db.verificationPublications.captures).length,2,'同內容沿用原capture、不虛增revision');
  assert.equal(db.verificationCaptures[first.captureId].capturedAt,'2026-01-01T01:00:00Z','不改首次採集時間');
  assert.ok(db.verificationCaptures[first.captureId].lastAttemptSequence>1,'同毫秒重試也保存實際順序');
  // 補一個早一天的格式起點，讓coverage可以核對這天而不另建本日formal。
  const start={...db.verificationCaptures[first.captureId],tradeDate:iso(compactTradingDay(-1)),kind:'formal',fullRecord:true,status:'complete-zero'};
  const coverage=mod.summarizeCaptureCoverage([...Object.values(db.verificationCaptures),start],[today]);
  assert.equal(coverage.days.find(day=>day.tradeDate===iso(today)).status,'failed','coverage與排程使用同一份最新嘗試證據');
});

test('I2：只記真正失敗的採集策略，尚未開始、已完成與僅advance均不偽造attempt',async t=>{
  for(const mode of ['overnight','swing','advance','reference','load'])await t.test(mode,async()=>{
    const calls=[];const attempts=[];const db=mode==='advance'?withFormal({}):{};
    const deps={lastRunDay:'',getReferenceData:async()=>{calls.push('reference');if(mode==='reference')throw new Error(mode);return referenceFor(today,today);},
      loadDb:async()=>{if(mode==='load')throw new Error(mode);return db;},
      buildOvernightSignals:async()=>{calls.push('overnight');if(mode==='overnight')throw new Error(mode);},
      buildSwingBoard:async()=>{calls.push('swing');if(mode==='swing')throw new Error(mode);},
      advanceSwingVerification:async()=>{calls.push('advance');throw new Error(mode);},
      recordCaptureAttempt:async(strategy,day,evidence)=>attempts.push({strategy,day,...evidence})};
    await assert.rejects(mod.runScheduledCloseTasks(deps),new RegExp(mode));
    assert.deepEqual(attempts.map(a=>a.strategy),mode==='reference'?[null]:['overnight','swing'].includes(mode)?[mode]:[]);
    if(mode==='overnight')assert.deepEqual(calls,['reference','overnight']);
    if(mode==='swing')assert.deepEqual(calls,['reference','overnight','swing']);
    if(mode==='advance')assert.deepEqual(calls,['reference','advance']);
    for(const attempt of attempts){assert.equal(attempt.day,today);assert.equal(attempt.status,'failed');assert.equal(attempt.stage,mode==='reference'?'reference':'capture');}
  });
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
  assert.deepEqual(first, { ran: ["overnight", "swing"], skipped: "", persisted: false, captureStatus: {overnight:"incomplete",swing:"incomplete"} });
  assert.equal(mod.closeSchedulerStateForTest().lastRunDay, "", "沒落盤不可標記今天已跑");
  const second = await mod.runScheduledCloseTasks(deps);
  assert.equal(second.skipped, "", "沒落盤就該重跑，不是 already-ran");
  assert.deepEqual(calls, ["overnight", "swing", "overnight", "swing"]);
});

test("真的落盤才標記今天已跑；之後同一天回 already-ran", async () => {
  mod.resetCloseSchedulerStateForTest();
  const stored = withFormal({
    signalSnapshots: [{ asOf: iso(today), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [] }],
    swingSnapshots: { [`${today}:all`]: { body: { formulaVersion: mod.SWING_FORMULA_VERSION, provisional: false } } },
  });
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
