// 真worker完成時壓縮，原子保存失敗不發布；冷啟動／完整備份還原保留證據。
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,readFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {importServer,SERVER_PATH} from '../helpers/test-server.mjs';
import {readBenchmarkEvidence} from '../../verification-evidence.mjs';
const {mod,mock,dataDir}=await importServer({routes:[
 {match:/rwd\/zh\/afterTrading\/FMTQIK/,reply:{stat:'OK',data:[['115/08/03'],['115/08/04']]}},
 {match:/TWT49U/,reply:{stat:'OK',data:[]}},
 {match:/STOCK_DAY\?/,reply:{stat:'OK',data:[['115/08/03','1','100','100','100','100','100','0','1'],['115/08/04','1','104','100','104','99','104','4','1']]}}
]});
after(async()=>{await mod.shutdownServer();mock.restore();await rm(dataDir,{recursive:true,force:true});});
test('完成transition失敗後RAM/disk/epoch/queue保持契約，恢復只留blob且完整備份可讀',async()=>{
 const capture={captureId:'synthetic',inputFingerprint:'frozen',strategy:'overnight',tradeDate:'20260803',identity:mod.currentVerificationIdentity('overnight'),kind:'formal',fullRecord:true,canonical:true,availableConfirmedAt:'2026-08-03T08:00:00Z',candidates:[{code:'2330',exchange:'TWSE',price:100,source:'TWSE OpenAPI',sourceAsOf:'20260803'}],issued:[{signalId:'one',code:'2330',exchange:'TWSE'}]};
 await mod.commitDbMutation(db=>{db.verificationCaptures={synthetic:capture};db.verificationPublications={current:{key:'synthetic'},captures:{synthetic:capture}};});
 const dbPath=join(dataDir,'stock1-db.json'),before=await readFile(dbPath,'utf8'),epoch=mod.getDbMutationEpochForTest();
 await mkdir(dbPath+'.tmp');const logs=[],old=console.error;console.error=(...a)=>logs.push(a);
 try{await assert.rejects(mod.runVerificationBenchmarkBatch(),e=>e.code==='PERSISTENCE_FAILED');assert.equal(logs.length,1);}finally{console.error=old;await rm(dbPath+'.tmp',{recursive:true});}
 assert.equal((await mod.loadDb()).verificationBenchmarks,undefined);assert.equal(await readFile(dbPath,'utf8'),before);assert.equal(mod.getDbMutationEpochForTest(),epoch+1);
 assert.equal((await mod.runVerificationBenchmarkBatch()).status,'complete');
 const saved=Object.values((await mod.loadDb()).verificationBenchmarks.memos)[0];assert.ok(saved.evidenceBlob);assert.equal(saved.observations,undefined);
 const evidence=readBenchmarkEvidence(saved);assert.equal(evidence.observations[0].status,'complete');
 const count=mock.calls.length;assert.equal((await mod.runVerificationBenchmarkBatch()).status,'idle');assert.equal(mock.calls.length,count);
 const backup=join(dataDir,'full-backup.json');await copyFile(dbPath,backup);const restored=join(dataDir,'restored');await mkdir(restored);await copyFile(backup,join(restored,'stock1-db.json'));
 const child=`const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)});const {readBenchmarkEvidence}=await import(${JSON.stringify(pathToFileURL(SERVER_PATH.replace('server.mjs','verification-evidence.mjs')).href)});const d=await m.loadDb();const memo=Object.values(d.verificationBenchmarks.memos)[0];console.log(JSON.stringify({memo,evidence:readBenchmarkEvidence(memo)}));`;
 for(const target of [dataDir,restored]){
  const cold=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8',env:{...process.env,DATA_DIR:target,PORT:'0',STOCK1_SKIP_LISTEN:'1'}}).trim().split('\n').at(-1));
  assert.deepEqual(cold.memo,saved);assert.deepEqual(cold.evidence,evidence);
 }
});
