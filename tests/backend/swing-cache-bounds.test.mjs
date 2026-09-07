// 波段快取按真builder量測工作集，場景切片共用，研究scope過多仍有界。
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {importServer} from '../helpers/test-server.mjs';
import {surveillanceRoutes,fundamentalsRoutes,stockDayAllRow,tpexDailyCloseRow} from '../helpers/fixtures.mjs';
const {mod,mock,dataDir}=await importServer({routes:[...surveillanceRoutes({reference:[stockDayAllRow({code:'0050'})],tpexReference:[tpexDailyCloseRow({code:'00679B'})]}),...fundamentalsRoutes({})]});
after(async()=>{await mod.shutdownServer();mock.restore();await rm(dataDir,{recursive:true,force:true});});
test('24個研究scope超過16工作集時淘汰LRU；相同scope的場景與limit共用結果',async()=>{
 const first=await mod.buildSwingBoard({maxCandidates:1,limit:1});
 const tab=await mod.buildSwingBoard({maxCandidates:1,limit:40,scenarioKey:'midBandDefense'});
 assert.strictEqual(tab.scanQuality,first.scanQuality);
 let oldest;
 for(let i=2;i<=16;i++){const result=await mod.buildSwingBoard({maxCandidates:i});if(i===3)oldest=result;}
 const touched=await mod.buildSwingBoard({maxCandidates:1});assert.strictEqual(touched.scanQuality,first.scanQuality);
 await mod.buildSwingBoard({maxCandidates:2});
 // 重新觸碰1使2成最舊；DB快照刪除僅為觀察memory命中，不export內部Map。
 await mod.buildSwingBoard({maxCandidates:1});
 await mod.buildSwingBoard({maxCandidates:17});
 await mod.commitDbMutation(db=>{db.swingSnapshots={};});
 const evicted=await mod.buildSwingBoard({maxCandidates:3});
 assert.notStrictEqual(evicted.scanQuality,oldest.scanQuality);
 const hot=await mod.buildSwingBoard({maxCandidates:1});assert.strictEqual(hot.scanQuality,first.scanQuality);
 const saved=[];
 for(let i=18;i<=41;i++)saved.push((await mod.buildSwingBoard({maxCandidates:i})).scanQuality);
 await mod.commitDbMutation(db=>{db.swingSnapshots={};});
 // 從最近往前讀，不讓驗證本身淘汰仍存活的key。
 let retained=0;
 for(let i=41;i>=18;i--)if((await mod.buildSwingBoard({maxCandidates:i})).scanQuality===saved[i-18])retained++;
 assert.equal(retained,16,'原Map會保留全部24個scope；目前正常UI僅1個canonical key，16容納近期日與研究scope');
});
test('跨日期與TTL失效後重用既有single-flight，不保留過期scope',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-08T08:00:00Z')});
 try {
  for(const date of ['2026-09-08T08:00:00Z','2026-09-09T08:00:00Z','2026-09-10T08:00:00Z']) {
   t.mock.timers.setTime(Date.parse(date));
   const removes=[...surveillanceRoutes({reference:[stockDayAllRow({code:'0050'})],tpexReference:[tpexDailyCloseRow({code:'00679B'})]}),...fundamentalsRoutes({})].map(r=>mock.override(r));
   try {
    const first=await mod.buildSwingBoard({maxCandidates:50,limit:1});
    const shared=await mod.buildSwingBoard({maxCandidates:50,limit:20,scenarioKey:'midBandDefense'});
    assert.strictEqual(first.scanQuality,shared.scanQuality);
    await mod.commitDbMutation(db=>{db.swingSnapshots={};});
    t.mock.timers.setTime(Date.now()+31*60*1000);
    const expired=await mod.buildSwingBoard({maxCandidates:50});
    assert.notStrictEqual(first.scanQuality,expired.scanQuality);
   } finally {removes.forEach(remove=>remove());}
  }
 } finally {t.mock.timers.reset();}
});
