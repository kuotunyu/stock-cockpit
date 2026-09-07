// 純合成同機量測；獨立 node 行程，PORT=0、臨時資料且外網 tripwire。
import { performance } from "node:perf_hooks";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { importServer } from "./test-server.mjs";
import { compactTradingDay, rocCompact, stockDayAllRow } from "./fixtures.mjs";

const days = Number(process.argv[2] || 260);
const dataDir = await mkdtemp(join(tmpdir(), "stock1-retention-bench-"));
const today = compactTradingDay(0);
const loaded = await importServer({ dataDir, routes: [
  { match: /STOCK_DAY_ALL/, reply: () => [{ ...stockDayAllRow({code:"2330"}), Date:rocCompact(today) }] },
  { match: /tpex_mainboard_daily_close_quotes/, reply: () => [] },
  { match: /exchangeReport\/FMTQIK/, reply: () => [{ Date: rocCompact(today) }] },
  { match: /holidaySchedule/, reply: () => [{ Date: `${Number(today.slice(0,4))-1911}0101`, Name:"休市" }] },
] });
const mock=loaded.mock;
const mod=process.argv[4] ? await import(pathToFileURL(resolve(process.argv[4])).href) : loaded.mod;
const median = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const time = async fn => { const start=performance.now(); await fn(); return performance.now()-start; };
try {
  const seed = { users:[{id:"u1",username:"synthetic",role:"user",passwordHash:"x",passwordSource:"user-set"}],sessions:[],watchLists:{},swingVerification:{},signalSnapshots:[] };
  for (let i=days;i>0;i--) {
    const day=compactTradingDay(-i);
    seed.swingVerification[day]=Array.from({length:40},(_,n)=>({code:String(2000+n),scenario:n%2?"midBandDefense":"strongContinuation",
      formulaVersion:mod.SWING_FORMULA_VERSION,entry:100,stop:95,target:110,status:n%10===0?"pending":"win",resultPct:n%10===0?null:10,
      daysHeld:3,lastChecked:day,resolvedAt:day,fillModel:"continuous"}));
    seed.signalSnapshots.push({asOf:day,formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,picks:[{code:"2330",price:100}],
      observed:{complete:true,status:"final",formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,rows:[],observationDate:day,warnings:[]}});
  }
  const json=JSON.stringify(seed);
  const inputBytes=Buffer.byteLength(json);
  await writeFile(join(dataDir,"stock1-db.json"),json);
  let db;
  const coldLoadMs=await time(async()=>{db=await mod.loadDb();});
  const saveMs=[], loadMs=[], swingColdMs=[], overnightColdMs=[], swingHotMs=[], overnightHotMs=[], swingHotJsonMs=[],overnightHotJsonMs=[];
  await mod.saveDb(db);
  await mod.buildSwingVerificationSummary(); await mod.buildVerificationHistory();
  for(let n=0;n<100000;n++){await mod.buildSwingVerificationSummary();await mod.buildVerificationHistory();}
  for(let k=0;k<9;k++) {
    saveMs.push(await time(()=>mod.saveDb(db)));
    loadMs.push(await time(async()=>JSON.parse(await readFile(join(dataDir,"stock1-db.json"),"utf8"))));
    mod.invalidateSwingVerifySummaryCache();
    swingColdMs.push(await time(()=>mod.buildSwingVerificationSummary()));
    mod.invalidateVerifyHistoryCacheForTest();
    overnightColdMs.push(await time(()=>mod.buildVerificationHistory()));
    swingHotMs.push((await time(async()=>{for(let n=0;n<500000;n++)await mod.buildSwingVerificationSummary();}))/500000);
    overnightHotMs.push((await time(async()=>{for(let n=0;n<500000;n++)await mod.buildVerificationHistory();}))/500000);
    swingHotJsonMs.push((await time(async()=>{for(let n=0;n<1000;n++)JSON.stringify(await mod.buildSwingVerificationSummary());}))/1000);
    overnightHotJsonMs.push((await time(async()=>{for(let n=0;n<1000;n++)JSON.stringify(await mod.buildVerificationHistory());}))/1000);
  }
  global.gc?.();
  const result={days,inputBytes,storedBytes:(await readFile(join(dataDir,"stock1-db.json"))).length,
    coldLoadMs,saveMs:median(saveMs),readParseMs:median(loadMs),swingColdMs:median(swingColdMs),overnightColdMs:median(overnightColdMs),
    swingHotMs:median(swingHotMs),overnightHotMs:median(overnightHotMs),swingHotJsonMs:median(swingHotJsonMs),overnightHotJsonMs:median(overnightHotJsonMs),
    upstreamRequests:mock.calls.length,memory:process.memoryUsage(),samples:{swingHotMs,overnightHotMs,swingHotJsonMs,overnightHotJsonMs}};
  console.log(JSON.stringify(result));
  if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2)+"\n");
} finally { await mod.flushPersistence(); mock.restore(); await rm(dataDir,{recursive:true,force:true}); }
