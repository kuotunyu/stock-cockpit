// 驗證歷史保留與有界補判；所有資料都是相對交易日合成 fixture。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay, rocCompact, stockDayAllRow } from "../helpers/fixtures.mjs";

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => { await mod.flushPersistence(); mock.restore(); await rm(dataDir, { recursive: true, force: true }); });
const old = compactTradingDay(-300);
const today = compactTradingDay(0);
const entry = (over = {}) => ({ code: "2330", exchange: "TWSE", scenario: "midBandDefense", entry: 100, stop: 95, target: 110,
  status: "pending", daysHeld: 0, lastChecked: old, formulaVersion: mod.SWING_FORMULA_VERSION, ...over });

test("紀錄入口保留窗口外 pending、公司行動停等與兩版本結案證據", () => {
  const evidence = [entry(), entry({ corporateActionPending: { from: old, reason: "官方公告" } }),
    entry({ status: "win", resultPct: 10, formulaVersion: "legacy-test" }), entry({ status: "loss", resultPct: -5 })];
  const db = { swingVerification: { [old]: structuredClone(evidence) } };
  mod.recordSwingVerification(db, { asOf: today, formulaVersion: mod.SWING_FORMULA_VERSION, picks: [{ code: "1101", exchange: "TWSE",
    scenario: { key: "midBandDefense" }, plan: { entry: 100, structuralStop: 95, target: 110 } }] });
  assert.deepEqual(db.swingVerification[old], evidence);
});

test("第 261 份隔日沖快照不刪最舊完整觀察", async () => {
  const db = await mod.loadDb();
  const evidence = { asOf: compactTradingDay(-400), formulaVersion: "legacy-test", picks: [], observed: { phase: "final", marker: "keep" } };
  db.signalSnapshots = [evidence, ...Array.from({ length: 259 }, (_, i) => ({ asOf: compactTradingDay(-i - 2), picks: [] }))];
  await mod.saveDb(db);
  await mod.saveSignalSnapshot({ formulaVersion:mod.OVERNIGHT_FORMULA_VERSION, requestScope:{maxCandidates:260,maxPerGroup:20}, coverage:{complete:true}, scanQuality:{candidateCount:0,completedCount:0,reliable:true}, asOf: today, groups: { a: [{ code: "2330", price: 100 }] } });
  assert.equal(db.signalSnapshots.length, 261);
  assert.deepEqual(db.signalSnapshots.find(s => s.asOf === evidence.asOf), evidence);
});

test("90 日窗口含邊界、排除前一天及未來，兩公式版本統計不擴張，函式不改輸入", async () => {
  const cutoff = mod.addDaysCompact(mod.toTaipeiCompactDate(), -90);
  const before = mod.addDaysCompact(cutoff, -1);
  const future = mod.addDaysCompact(mod.toTaipeiCompactDate(), 1);
  const store = { [before]: [entry({ status: "win", resultPct: 10 })], [cutoff]: [entry({ status: "loss", resultPct: -5 })],
    [today]: [entry({ formulaVersion: "legacy-test" })], [future]: [entry()] };
  const frozen = structuredClone(store);
  Object.freeze(store);
  const selected = mod.selectSwingVerificationWindow(store);
  assert.notEqual(selected, store);
  assert.deepEqual(Object.keys(selected).sort(), [cutoff, today].sort());
  assert.deepEqual(store, frozen);
  const db = await mod.loadDb(); db.swingVerification = store;
  mod.invalidateSwingVerifySummaryCache();
  const summary = await mod.buildSwingVerificationSummary();
  assert.equal(summary.scenarios[0].samples, 1);
  assert.equal(summary.formulaVersions.reduce((n, v) => n + v.samples, 0), 2);
});

test("近期 16／歷史 4 群上限、同月同代號去重、游標公平輪替與冷卻後重試", () => {
  const store = { [today]: Array.from({ length: 30 }, (_, i) => entry({ code: String(1000+i), lastChecked: compactTradingDay(-1) })),
    [old]: Array.from({ length: 10 }, (_, i) => entry({ code: String(3000+i) })) };
  store[old].push(entry({ code: "3000", formulaVersion: "old-v1" }));
  const first = mod.selectSwingVerificationBatch(store, {}, { asOf: today, now: 10 });
  assert.equal(first.jobs.filter(j=>!j.historical).length, 16);
  assert.equal(first.jobs.filter(j=>j.historical).length, 4);
  assert.equal(first.jobs.find(j=>j.key.startsWith("3000:")).entries.length, 2);
  const next = mod.selectSwingVerificationBatch(store, first.cursors, { asOf: today, now: 10 });
  assert.ok(next.jobs.some(j=>j.key.startsWith("3004:")));
  const cooled = { [old]: [entry({ verificationRetry: { nextRetryAt: 20 } })] };
  assert.equal(mod.selectSwingVerificationBatch(cooled, {}, { asOf: today, now: 19 }).jobs.length, 0);
  assert.equal(mod.selectSwingVerificationBatch(cooled, {}, { asOf: today, now: 20 }).jobs.length, 1);
});

// 舊年度跨年 fixture：只有合成官方 FMTQIK 指定的日子開市，不用今天的假日表猜。
const year = Number(today.slice(0,4)) - 2;
const from = `${year}1201`;
const through = `${year+1}0131`;
const weekday = d => ![0,6].includes(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T12:00:00Z`).getUTCDay());
const days = [];
for (let d=from; d<=through; d=mod.addDaysCompact(d,1)) if(weekday(d) && !d.endsWith("0101")) days.push(d);
const d0 = days.filter(d=>d.startsWith(`${year}12`)).at(-1);
const d1 = days.find(d=>d>d0);
const roc = d => `${Number(d.slice(0,4))-1911}/${d.slice(4,6)}/${d.slice(6,8)}`;
let historyFailure = false;
let actionFailure = false;
let actionMode = false;
let missingHistoryDay = "";
let badHistoryMonth = "";
let holdAction;
const removers = [
  mock.override({ match: /exchangeReport\/FMTQIK/, reply: () => [{ Date: roc(today) }] }),
  mock.override({ match: /holidaySchedule/, reply: () => [{ Date: `${Number(today.slice(0,4))-1911}0101`, Name: "休市" }] }),
  mock.override({ match: /afterTrading\/FMTQIK/, reply: url => {
    const month=url.searchParams.get("date").slice(0,6);
    return {stat:"OK", data:days.filter(d=>d.startsWith(month)).map(d=>[roc(d),"1","1","1","20000","0"])};
  }}),
  mock.override({ match: /TWT49U/, reply: async url => {
    if(holdAction)await holdAction();
    if(actionFailure)throw new Error("synthetic action failure");
    const month=url.searchParams.get("startDate").slice(0,6);
    return {stat:"OK",data:actionMode && d1.startsWith(month) ? [[roc(d1),"2330","合成","100","95","5","息","0","0","95","95"]] : []};
  }}),
  mock.override({ match: /STOCK_DAY\?/, reply: url => {
    if(historyFailure)throw new Error("synthetic history failure");
    const month=url.searchParams.get("date").slice(0,6);
    if(month===badHistoryMonth)return {stat:"temporarily unavailable"};
    return {stat:"OK",data:days.filter(d=>d.startsWith(month) && d!==missingHistoryDay).map(d=>{
      const p=actionMode && d>d0?95:100;
      return [roc(d),"1000000","100000000",String(p),String(actionMode?p+1:d===d1?112:105),String(p-1),String(p),actionMode&&d===d1?"X0.00":"0","1000"];
    })};
  }}),
];
after(()=>removers.forEach(remove=>remove()));
const reference = { byCode: new Map(), coverageComplete: true };
async function seedOld(overrides = {}) {
  const db = await mod.loadDb();
  db.swingVerification = { [d0]: [entry({ lastChecked:d0,...overrides })], [old]: [entry({code:"9999",status:"win",resultPct:10})] };
  db.swingVerificationRetry = {};
  mod.resetSwingAdvanceKeyForTest(); mod.resetHistoryCacheForTest();
  await mod.saveDb(db);
  return db;
}

test("舊年度跨年 holiday：查原月份、按實際下一交易日結案，保留既有結案證據", async () => {
  const db = await seedOld(); const before=mock.calls.length;
  await mod.advanceSwingVerification(reference,today,{riskSets:null});
  const result=db.swingVerification[d0][0];
  assert.equal(result.status,"win"); assert.equal(result.resolvedAt,d1);
  assert.equal(result.daysHeld,1); assert.equal(result.dataGap,undefined);
  assert.equal(result.evaluationApplied.kind,"retrospective-legacy-evidence");
  assert.equal(result.evaluationApplied.scope,"this-advance-only");
  assert.equal(result.evaluationApplied.evaluationVersion,"swing-price-observation-v1");
  assert.equal(db.swingVerification[old][0].evaluationApplied,undefined);
  assert.equal(db.swingVerification[old][0].status,"win");
  const requests=mock.calls.slice(before).map(c=>new URL(c.url));
  assert.deepEqual(requests.filter(u=>u.pathname.includes("STOCK_DAY")).map(u=>u.searchParams.get("date")).sort(),[from,`${year+1}0101`]);
  assert.ok(requests.filter(u=>u.pathname.includes("TWT49U")).every(u=>[year,year+1].includes(Number(u.searchParams.get("startDate").slice(0,4)))));
});

test("已封月但被 40 筆上限淘汰的公司行動：批次重查直接量化，不污染全域 archive", async () => {
  actionMode=true;
  try {
    const history=await mod.loadFundamentalsHistory();
    history.corporateActionResultMonths ||= {};
    history.corporateActionResultMonths[d1.slice(0,6)]={status:"ok",sealed:true,rows:100,codes:100};
    history.corporateActionResults ||= {};
    history.corporateActionResults["2330"]=Object.fromEntries(Array.from({length:40},(_,i)=>[compactTradingDay(-i),{preClose:100,referencePrice:99}]));
    const before=structuredClone(history.corporateActionResults["2330"]);
    const db=await seedOld({corporateActionPending:{from:d1,reason:"上市除權息標記"}});
    await mod.advanceSwingVerification(reference,today,{riskSets:null});
    const result=db.swingVerification[d0][0];
    assert.equal(result.entry,95); assert.equal(result.status,"expired");
    assert.equal(result.corporateActionPending,undefined);
    assert.deepEqual(result.corporateActions,[{date:d1,ratio:0.95}]);
    assert.deepEqual(history.corporateActionResults["2330"],before);
  } finally { actionMode=false; }
});

test("歷史公司行動或日 K 來源失敗：保留停等與缺口證據、原因及可恢復游標", async () => {
  for (const reason of ["corporate-action-source-unavailable","history-source-unavailable"]) {
    const db=await seedOld({corporateActionPending:{from:d1,reason:"官方公告"},dataGap:{from:d1,through}});
    actionFailure=reason.startsWith("corporate"); historyFailure=!actionFailure;
    try { await mod.advanceSwingVerification(reference,today,{riskSets:null}); }
    finally {actionFailure=false;historyFailure=false;}
    const result=db.swingVerification[d0][0];
    assert.equal(result.status,"pending"); assert.equal(result.lastChecked,d0);
    assert.deepEqual(result.dataGap,{from:d1,through});
    assert.equal(result.corporateActionPending.from,d1);
    assert.equal(result.verificationRetry.reason,reason);
    assert.ok(result.verificationRetry.nextRetryAt>Date.now());
    assert.ok(db.swingVerificationRetry.historicalCursor);
  }
});

test("已確認歷史交易日真的缺中間 K：不跳到較晚達標日，保留可重試 dataGap", async () => {
  const db=await seedOld(); missingHistoryDay=d1;
  try {await mod.advanceSwingVerification(reference,today,{riskSets:null});}
  finally {missingHistoryDay="";}
  const result=db.swingVerification[d0][0];
  assert.equal(result.status,"pending"); assert.equal(result.lastChecked,d0); assert.equal(result.daysHeld,0);
  assert.equal(result.dataGap.from,d1); assert.equal(result.dataGap.through,through);
  assert.equal(result.verificationRetry.reason,"data-gap");
});

test("月歷史 HTTP 200 但來源回覆失敗，即使尾月完整也不當成真空月", async () => {
  const db=await seedOld(); badHistoryMonth=from.slice(0,6);
  try {await mod.advanceSwingVerification(reference,today,{riskSets:null});}
  finally {badHistoryMonth="";}
  const result=db.swingVerification[d0][0];
  assert.equal(result.status,"pending"); assert.equal(result.dataGap,undefined);
  assert.equal(result.verificationRetry.reason,"history-source-unavailable");
});

test("12 個舊 pending 每輪只查 4 檔，各檔 2 月；同月份日曆與公司行動共用", async () => {
  const db=await seedOld();
  db.swingVerification[d0]=Array.from({length:12},(_,i)=>entry({code:String(5000+i),lastChecked:d0}));
  const before=mock.calls.length;
  await mod.advanceSwingVerification(reference,today,{riskSets:null});
  const calls=mock.calls.slice(before);
  assert.equal(calls.filter(c=>/STOCK_DAY\?/.test(c.url)).length,8);
  assert.equal(calls.filter(c=>/TWT49U/.test(c.url)).length,2);
  assert.ok(calls.filter(c=>/afterTrading\/FMTQIK/.test(c.url)).length<=2);
  assert.equal(db.swingVerification[d0].filter(e=>e.status==="win").length,4);
  await mod.advanceSwingVerification(reference,today,{riskSets:null});
  assert.equal(db.swingVerification[d0].filter(e=>e.status==="win").length,8);
});

test("歷史日曆月份未涵蓋：不以週末推定寫 dataGap，也不抓不可信的股價", async () => {
  const unknown = `${year-3}1230`;
  const db=await seedOld({lastChecked:unknown}); const before=mock.callsFor(/STOCK_DAY\?/).length;
  await mod.advanceSwingVerification(reference,today,{riskSets:null});
  const result=db.swingVerification[d0][0];
  assert.equal(result.verificationRetry.reason,"calendar-unavailable");
  assert.equal(result.dataGap,undefined); assert.equal(result.lastChecked,unknown);
  assert.equal(mock.callsFor(/STOCK_DAY\?/).length,before);
});

test("未知市場公平跳至下一批；同日仍可恢復舊單，重入共用一輪", async () => {
  const db=await seedOld();
  db.swingVerification[d0]=Array.from({length:10},(_,i)=>entry({code:String(4000+i),exchange:undefined,lastChecked:d0}));
  await mod.advanceSwingVerification(reference,today,{riskSets:null});
  assert.equal(db.swingVerification[d0].filter(e=>e.verificationRetry).length,4);
  await Promise.all([mod.advanceSwingVerification(reference,today,{riskSets:null}),mod.advanceSwingVerification(reference,today,{riskSets:null})]);
  assert.equal(db.swingVerification[d0].filter(e=>e.verificationRetry).length,8);
  assert.ok(db.swingVerification[d0].slice(0,8).every(e=>e.verificationRetry.reason==="market-unknown" && !e.dataGap));
});

test("歷史批次失敗落盤與競態：證據、cursor 一起回滾，下一輪不夾帶失敗結果", async () => {
  const db=await seedOld(); const original=structuredClone(db.swingVerification);
  const epoch=mod.getDbMutationEpochForTest();
  const blocker=join(dataDir,"stock1-db.json.tmp");
  await mkdir(blocker);
  try { await mod.advanceSwingVerification(reference,today,{riskSets:null}); }
  finally { await rm(blocker,{recursive:true,force:true}); }
  assert.deepEqual(db.swingVerification,original); assert.deepEqual(db.swingVerificationRetry,{});
  assert.equal(mod.getDbMutationEpochForTest(),epoch+1);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir,"stock1-db.json"),"utf8")).swingVerification,original);
  let release, entered;
  const gate=new Promise(r=>release=r); const started=new Promise(r=>entered=r);
  holdAction=async()=>{entered();await gate;};
  try {
    const advance=mod.advanceSwingVerification(reference,today,{riskSets:null});
    await Promise.race([started, advance.then(()=>{throw new Error("批次未到達公司行動請求");})]);
    assert.deepEqual(db.swingVerification,original,"網路等待中的草稿不可提早發布");
    await mod.commitDbMutation(draft=>{draft.swingVerification[d0][0].auditMarker="concurrent";});
    release(); await advance;
  } finally {release();holdAction=undefined;}
  assert.equal(db.swingVerification[d0][0].auditMarker,"concurrent");
  assert.equal(db.swingVerification[d0][0].status,"pending"); assert.deepEqual(db.swingVerificationRetry,{});
  await mod.advanceSwingVerification(reference,today,{riskSets:null});
  assert.equal(db.swingVerification[d0][0].status,"win");
  assert.equal(db.swingVerification[d0][0].auditMarker,"concurrent");
});

test("隔日沖 headline 仍只讀目前公式最近 260 份，窗口外 pending 不產生歷史請求", async () => {
  const db=await mod.loadDb();
  const version=mod.OVERNIGHT_FORMULA_VERSION;
  db.signalSnapshots=Array.from({length:260},(_,i)=>({asOf:compactTradingDay(-i-1),formulaVersion:version,picks:[{code:"2330",price:100}],
    observed:{complete:true,status:"final",formulaVersion:version,rows:[],observationDate:compactTradingDay(-i),warnings:[]}}));
  const outside={asOf:compactTradingDay(-400),formulaVersion:version,picks:[{code:"9998",price:100}]};
  db.signalSnapshots.unshift(outside);
  const removeTwse=mock.override({match:/STOCK_DAY_ALL/,reply:()=>[{...stockDayAllRow({code:"2330"}),Date:rocCompact(today)}]});
  const removeTpex=mock.override({match:/tpex_mainboard_daily_close_quotes/,reply:()=>[]});
  const before=mock.callsFor(/STOCK_DAY\?/).length;
  try {
    mod.invalidateVerifyHistoryCacheForTest();
    const summary=await mod.buildVerificationHistory();
    assert.equal(summary.records.length,260);
    assert.equal(mock.callsFor(/STOCK_DAY\?/).length,before);
    assert.deepEqual(db.signalSnapshots.find(s=>s.asOf===outside.asOf),outside);
  } finally {removeTwse();removeTpex();}
});

// I1 的固定日期是審查重現契約：1/3 先停損、1/4 才達標，不能因指數缺值跳過 1/3。
async function runCalendarReviewCase(caseYear, extraRow, missingIndex = false) {
  const signal=`${caseYear}0102`, stopDay=`${caseYear}0103`, targetDay=`${caseYear}0104`, tail=`${caseYear}0228`;
  const removeCalendar=mock.override({match:/afterTrading\/FMTQIK/,reply:url=>({stat:"OK",data:
    url.searchParams.get("date").startsWith(`${caseYear}01`)
      ? [[roc(signal),"1","1","1","20000"],[roc(stopDay),"1","1","1",missingIndex?"--":"20000"],
        [roc(targetDay),"1","1","1","20000"],...(extraRow?[extraRow]:[])]
      : [[roc(tail),"1","1","1","20000"]]})});
  const removeHistory=mock.override({match:/STOCK_DAY\?/,reply:url=>({stat:"OK",data:
    (url.searchParams.get("date").startsWith(`${caseYear}01`)
      ? [[signal,105,99],[stopDay,105,90],[targetDay,112,99]] : [[tail,105,99]])
      .map(([date,high,low])=>[roc(date),"1000000","100000000","100",String(high),String(low),"100","0","1000"])})});
  try {
    const db=await mod.loadDb();
    db.swingVerification={[signal]:[entry({lastChecked:signal})]}; db.swingVerificationRetry={};
    mod.resetSwingAdvanceKeyForTest(); mod.resetHistoryCacheForTest();
    await mod.saveDb(db);
    const historyCalls=mock.callsFor(/STOCK_DAY\?/).length;
    await mod.advanceSwingVerification(reference,today,{riskSets:null});
    return {result:db.swingVerification[signal][0],signal,stopDay,historyCalls:mock.callsFor(/STOCK_DAY\?/).length-historyCalls};
  } finally {removeCalendar();removeHistory();}
}

test("I1：有效交易日期但指數 -- 仍保留 1/3 停損日，不得誤判 1/4 win", async () => {
  const {result,stopDay}=await runCalendarReviewCase(2024,null,true);
  assert.equal(result.status,"loss"); assert.equal(result.resolvedAt,stopDay);
  assert.equal(result.resultPct,-5.1); assert.equal(result.daysHeld,1);
});

test("I1：混月份／格式錯誤／不存在日期列不可在 filter 後逃過整月完整性驗證", async () => {
  const cases=[
    [2020,["109/02/03","1","1","1","--"]],
    [2021,["not-a-date","1","1","1","--"]],
    [2022,["111/01/32","1","1","1","20000"]],
    [2019,["108/01/03 trailing text","1","1","1","--"]],
    [2018,[]],
  ];
  for(const [caseYear,row] of cases){
    const {result,signal,historyCalls}=await runCalendarReviewCase(caseYear,row);
    assert.equal(result.status,"pending",String(row[0])); assert.equal(result.lastChecked,signal);
    assert.equal(result.verificationRetry?.reason,"calendar-unavailable"); assert.equal(result.dataGap,undefined);
    assert.equal(historyCalls,0,"日曆無法安全解讀時不可繼續抓 K 判定");
  }
});
