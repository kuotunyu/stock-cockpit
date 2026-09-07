// 計畫可攜性：v2 匯入非可信歷史、v1 保留、checksum、stale rev 與精確還原點。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {bootServer} from '../helpers/test-server.mjs';
let srv,bundle;
const options={watchLists:'replace',alerts:'replace',trades:'replace',stockNotes:'merge',companyProfiles:'skip'};
async function json(r,status=200){const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;}
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')}}`;
const checksum=({integrity,...b})=>createHash('sha256').update(stable(b)).digest('hex');
const sign=b=>{b.integrity={algorithm:'sha256',contentHash:checksum(b)};return b;};
const preview=(b,status=200)=>srv.api('/api/personal-data/restore/preview',{method:'POST',body:JSON.stringify({bundle:b,options})}).then(r=>json(r,status));
const restore=(token,status=200)=>srv.api('/api/personal-data/restore',{method:'POST',body:JSON.stringify({previewToken:token,confirmation:'RESTORE',currentPassword:'test-admin-pw'})}).then(r=>json(r,status));
before(async()=>{srv=await bootServer();await json(await srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify({schemaVersion:1,rev:0,plans:[{planId:randomUUID(),signalId:null,code:'2330',exchange:'TWSE',strategy:'swing',status:'active',entryPrice:100,stopPrice:95,quantity:1000,expiresOn:new Date(Date.now()+86400000*30).toISOString().slice(0,10)}]})}));bundle=(await json(await srv.api('/api/personal-data/export'))).bundle;});
after(async()=>srv?.close());
test('v2 export includes plans/rev only for current owner and checksum',()=>{
 assert.equal(bundle.formatVersion,2);assert.equal(bundle.data.tradePlans.plans.length,1);assert.equal(bundle.sourceRevisions.tradePlans,1);assert.equal(bundle.integrity.contentHash,checksum(bundle));assert.doesNotMatch(JSON.stringify(bundle),/passwordHash|sessionId|userId/);
});
test('tampered checksum and internally inconsistent history reject whole import',async()=>{
 const bad=structuredClone(bundle);bad.data.tradePlans.plans[0].stopPrice=94;assert.equal((await preview(bad,422)).code,'BACKUP_CHECKSUM_MISMATCH');
 assert.equal((await preview(sign(bad),422)).code,'BACKUP_PLAN_INVALID');
});
test('v1 missing plans preserves existing plans with explicit preview policy',async()=>{
 const old=structuredClone(bundle);old.formatVersion=1;delete old.data.tradePlans;delete old.sourceRevisions.tradePlans;sign(old);
 const p=await preview(old);assert.equal(p.plan.sections.tradePlans.mode,'preserve');assert.match(p.plan.sections.tradePlans.policy,/保留/);
 const result=await restore(p.previewToken);assert.equal(result.applied.tradePlans,'preserved');
 const current=await json(await srv.api('/api/trade-plans'));assert.deepEqual(current.plans,bundle.data.tradePlans.plans);
});
test('plan edit invalidates pending restore preview',async()=>{
 const p=await preview(bundle);const current=await json(await srv.api('/api/trade-plans'));
 await json(await srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify({...current,plans:current.plans.map(plan=>({...plan,stopPrice:102}))})}));
 assert.equal((await restore(p.previewToken,409)).code,'RESTORE_PREVIEW_STALE');
});
test('v2 restore marks imported risk unverified and exact restorepoint keeps pre-restore evidence',async()=>{
 const before=await json(await srv.api('/api/trade-plans'));const p=await preview(bundle);assert.match(p.plan.sections.tradePlans.policy,/未驗證/);
 const result=await restore(p.previewToken);const current=await json(await srv.api('/api/trade-plans'));
 assert.equal(current.plans[0].provenance.kind,'imported');assert.equal(current.plans[0].provenance.historicalEvidence,'unverified');assert.deepEqual(current.plans[0].activation,bundle.data.tradePlans.plans[0].activation);
 const point=JSON.parse(await readFile(join(srv.dataDir,'backups',result.restorePoint.fileName),'utf8'));const user=point.users[0];assert.deepEqual(point.tradePlans[user.id].plans,before.plans);
 await restore(p.previewToken,409);
});
test('valid imported source linkage survives absent local capture, remains unverified',()=>{
 const payload=structuredClone(bundle.data.tradePlans),p=payload.plans[0];p.signalId='a'.repeat(64);p.sourceCaptureId='b'.repeat(64);p.source={signalId:p.signalId,captureId:p.sourceCaptureId,capturedReference:{price:100}};
 const parsed=srv.mod.validatePortableTradePlans(payload);assert.equal(parsed.plans[0].source.verification,'unverified-import');
});
test('v2 rejects missing schema, hidden owner/history fields and v1 disguised plan section',async()=>{
 const missing=structuredClone(bundle);delete missing.data.tradePlans;await preview(sign(missing),422);
 const bad=structuredClone(bundle);bad.data.tradePlans.plans[0].initial.userId='hidden-owner';bad.data.tradePlans.plans[0].activation.userId='hidden-owner';await preview(sign(bad),422);
 const old=structuredClone(bundle);old.formatVersion=1;await preview(sign(old),422);
});
test('saved plans survive actual cold server load in an isolated copied database',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock1-plan-cold-'));
 try{
  const before=await json(await srv.api('/api/trade-plans'));await copyFile(join(srv.dataDir,'stock1-db.json'),join(dir,'stock1-db.json'));
  const script=`import {importServer} from './tests/helpers/test-server.mjs';const {mod,mock}=await importServer({dataDir:process.argv[1]});await mod.startServer(0,'127.0.0.1');const db=await mod.loadDb();process.stdout.write('PLANS:'+JSON.stringify(db.tradePlans[db.users[0].id])+'\\n');await mod.shutdownServer({reason:'plan-cold-test'});mock.restore();`;
  const output=execFileSync(process.execPath,['--input-type=module','-e',script,dir],{encoding:'utf8',timeout:20000});
  const result=JSON.parse(output.split('\n').find(line=>line.startsWith('PLANS:')).slice(6));assert.deepEqual(result.plans,before.plans);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('v2 import cannot create a resource too large for collection PUT; reject without changing plans',async()=>{
 const before=await json(await srv.api('/api/trade-plans'));const disk=await readFile(join(srv.dataDir,'stock1-db.json'),'utf8');const large=structuredClone(bundle);
 large.data.tradePlans.plans=Array.from({length:20},()=>{
  const p=structuredClone(bundle.data.tradePlans.plans[0]);p.planId=randomUUID();p.reason='漢'.repeat(1000);p.initial.intent.reason=p.reason;p.activation.intent.reason=p.reason;return p;
 });
 assert.ok(Buffer.byteLength(JSON.stringify(large))<16*1024*1024);
 const rejected=await preview(sign(large),422);assert.equal(rejected.code,'PLAN_STORAGE_TOO_LARGE');assert.deepEqual(await json(await srv.api('/api/trade-plans')),before);
 assert.equal(await readFile(join(srv.dataDir,'stock1-db.json'),'utf8'),disk);
 assert.equal(rejected.previewToken,undefined);
});
test('near-quota UTF-8 plans reject snapshot expansion atomically, admitted export/restore/no-op still work',async()=>{
 const before=await json(await srv.api('/api/trade-plans'));const disk=await readFile(join(srv.dataDir,'stock1-db.json'),'utf8');
 const additions=Array.from({length:20},()=>({planId:randomUUID(),code:'2330',exchange:'TWSE',strategy:'swing',status:'draft',reason:'漢'.repeat(1000)}));
 const tooLarge={...before,plans:[...before.plans,...additions]};assert.ok(Buffer.byteLength(JSON.stringify(tooLarge))<128*1024);
 const rejected=await json(await srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify(tooLarge)}),422);assert.equal(rejected.code,'PLAN_STORAGE_TOO_LARGE');
 assert.deepEqual(await json(await srv.api('/api/trade-plans')),before);assert.equal(await readFile(join(srv.dataDir,'stock1-db.json'),'utf8'),disk);
 let count=0;for(let n=1;n<=20;n++){
  try{srv.mod.canonicalizeTradePlans({...before,plans:[...before.plans,...additions.slice(0,n)]},before);count=n;}catch(error){assert.equal(error.code,'PLAN_STORAGE_TOO_LARGE');break;}
 }
 assert.ok(count>1&&count<20);
 await json(await srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify({...before,plans:[...before.plans,...additions.slice(0,count)]})}));
 const exported=(await json(await srv.api('/api/personal-data/export'))).bundle;
 const p=await preview(exported);await restore(p.previewToken);
 const current=await json(await srv.api('/api/trade-plans'));assert.ok(Buffer.byteLength(JSON.stringify(current))<128*1024);
 const noOp=await json(await srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify(current)}));assert.deepEqual(noOp,current);
});
