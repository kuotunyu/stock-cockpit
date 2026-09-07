// 計畫與實際成交：份額、來源失效、檢討歷史、帳號與提交佇列。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {bootServer} from '../helpers/test-server.mjs';
let srv,mod;
before(async()=>{srv=await bootServer();mod=srv.mod;});
after(async()=>srv?.close());
const now=new Date().toISOString(), past=new Date(Date.now()-86400000).toISOString();
const taipeiDay=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10).replaceAll('-','');
const day=taipeiDay(now);
const plan=(extra={})=>({planId:randomUUID(),code:'2330',exchange:'TWSE',strategy:'swing',status:'active',entryPrice:100,stopPrice:95,quantity:1000,expiresOn:new Date(Date.now()+86400000*7).toISOString().slice(0,10),...extra});
const trade=(id,side,shares,extra={})=>({id,code:'2330',market:'TWSE',brokerAccountId:'default',side,shares,dayTrade:{status:'none',matchedShares:0},session:'regular',price:side==='buy'?100:110,date:day,tradeDate:day,executedAt:now,fee:20,tax:0,feeSource:'manual',taxSource:'manual',...extra});
const build=(plans,existing,records=[],time=existing?now:past)=>mod.canonicalizeTradePlans({schemaVersion:1,plans},existing,{records,now:time});
test('partial entry, split exits and close keep actual cash separate from full plan return',()=>{
 const records=[trade('buy','buy',400),trade('sell1','sell',100),trade('sell2','sell',300)];
 let p=build([plan()]);p=build([{...p.plans[0],tradeLinks:[{tradeId:'buy',allocatedShares:400}]}],p,records);
 let e=mod.buildTradePlanLinkEvidence(p,records)[p.plans[0].planId];assert.equal(e.buyShares,400);assert.equal(e.sellShares,0);assert.equal(e.originalRiskCash,2000);assert.equal(e.netR,null);
 p=build([{...p.plans[0],tradeLinks:[...p.plans[0].tradeLinks,{tradeId:'sell1',allocatedShares:100},{tradeId:'sell2',allocatedShares:300}],status:'closed'}],p,records);
 e=mod.buildTradePlanLinkEvidence(p,records)[p.plans[0].planId];assert.equal(e.buyCash,40020);assert.equal(e.sellCash,43960);assert.equal(e.cashDifference,3940);assert.equal(e.planReturn,null);
 assert.equal(p.plans[0].activation.riskAmount,5000);assert.equal(e.originalRiskCash,2000);
 const closed=p.plans[0];p=build([{...closed,review:{decision:'conditions-changed',reason:'條件改變'}}],p,records,now);
 assert.deepEqual(p.plans[0].revisions,closed.revisions);assert.equal(p.plans[0].review.reviewedAt,now);
});
test('cross-plan totals, duplicate, foreign symbol/market/account and chronology are rejected',()=>{
 const records=[trade('b','buy',100),trade('other','buy',100,{brokerAccountId:'second'}),trade('unknown','buy',100,{market:'unknown'}),trade('symbol','buy',100,{code:'1101'})];
 const p=build([plan(),plan()]);
 for(const links of [[{tradeId:'b',allocatedShares:101}],[{tradeId:'b',allocatedShares:1},{tradeId:'b',allocatedShares:2}],[{tradeId:'unknown',allocatedShares:1}],[{tradeId:'symbol',allocatedShares:1}],[{tradeId:'missing',allocatedShares:1}],[{tradeId:'b',allocatedShares:1},{tradeId:'other',allocatedShares:1}]])assert.throws(()=>build([{...p.plans[0],tradeLinks:links},p.plans[1]],p,records),{status:422});
 assert.throws(()=>build(p.plans.map(x=>({...x,tradeLinks:[{tradeId:'b',allocatedShares:60}]})),p,records),{code:'PLAN_LINK_OVERALLOCATED'});
 assert.throws(()=>build([{...p.plans[0],tradeLinks:[{tradeId:'early',allocatedShares:1}]},p.plans[1]],p,[trade('early','buy',10,{executedAt:new Date(Date.parse(past)-1000).toISOString(),date:past.slice(0,10).replaceAll('-','')})]),{code:'PLAN_LINK_TIME_INVALID'});
});
test('correction/deletion keeps snapshot evidence, review stays writable and final metadata can be repaired',()=>{
 const records=[trade('b','buy',100)];let p=build([plan({strategy:'overnight'})]);p=build([{...p.plans[0],tradeLinks:[{tradeId:'b',allocatedShares:100}]}],p,records);
 const original=structuredClone(p.plans[0].tradeLinks);const changed=[{...records[0],shares:50}];
 assert.equal(mod.buildTradePlanLinkEvidence(p,changed)[p.plans[0].planId].links[0].status,'source-changed');
 assert.equal(mod.buildTradePlanLinkEvidence(p,[])[p.plans[0].planId].links[0].status,'source-deleted');
 assert.equal(mod.buildTradePlanLinkEvidence(p,[{...records[0],note:'display only'}])[p.plans[0].planId].links[0].status,'valid');
 p=build([{...p.plans[0],status:'closed',review:{decision:'insufficient-data',reason:'來源修正'}}],p,changed);assert.deepEqual(p.plans[0].tradeLinks,original);
 const priorHistory=structuredClone(p.plans[0].revisions);
 p=build([{...p.plans[0],tradeLinks:[{tradeId:'b',allocatedShares:50}]}],p,changed);assert.deepEqual(p.plans[0].revisions,priorHistory);
 assert.deepEqual(p.plans[0].metadataRevisions[0].tradeLinks,original);
 p=build([{...p.plans[0],tradeLinks:[]}],p,changed);assert.equal(p.plans[0].tradeLinks.length,0);assert.ok(p.plans[0].metadataRevisions.length>=3);
});
test('date-only/unknown broker/import never claim execution-verified original R, zero fees preserved',()=>{
 const records=[trade('b','buy',100,{executedAt:'',brokerAccountId:'legacy-unknown',fee:0,tax:0})];let p=build([plan()]);p=build([{...p.plans[0],tradeLinks:[{tradeId:'b',allocatedShares:20}]}],p,records);
 const e=mod.buildTradePlanLinkEvidence(p,records)[p.plans[0].planId];assert.equal(e.originalRiskCash,null);assert.equal(e.buyCash,2000);assert.equal(e.links[0].snapshot.timePrecision,'date-only');assert.ok(e.reasons.includes('broker-account-unconfirmed'));
 const imported=mod.validatePortableTradePlans(p,now);assert.equal(mod.buildTradePlanLinkEvidence(imported,records)[p.plans[0].planId].originalRiskCash,null);assert.deepEqual(imported.plans[0].tradeLinks,p.plans[0].tradeLinks);
 const old=build([plan()]);for(const item of old.plans){delete item.tradeLinks;delete item.review;delete item.metadataRevisions;}const oldImport=mod.validatePortableTradePlans(old,now);assert.deepEqual(build(oldImport.plans,oldImport),oldImport);
});
test('execution equal to activation can link but cannot prove ex-ante original risk',()=>{
 const records=[trade('equal','buy',100,{executedAt:past,date:taipeiDay(past),tradeDate:taipeiDay(past)})];let p=build([plan()]);
 p=build([{...p.plans[0],tradeLinks:[{tradeId:'equal',allocatedShares:20}]}],p,records);
 const e=mod.buildTradePlanLinkEvidence(p,records)[p.plans[0].planId];assert.equal(e.links[0].status,'valid');assert.equal(e.originalRiskCash,null);
});
test('no-entry and cancelled review do not require trades; metadata tampering and bounded history fail',()=>{
 let p=build([plan({status:'draft'})]);p=build([{...p.plans[0],status:'cancelled',review:{decision:'no-entry',reason:'開盤條件失效'}}],p);
 assert.equal(p.plans[0].tradeLinks.length,0);assert.equal(p.plans[0].review.reason,'開盤條件失效');
 assert.throws(()=>build([{...p.plans[0],metadataRevisions:[]}],p),{code:'PLAN_HISTORY_IMMUTABLE'});
 for(let i=p.plans[0].metadataRevisions.length;i<100;i++)p=build([{...p.plans[0],review:{decision:'no-entry',reason:String(i)}}],p);
 assert.throws(()=>build([{...p.plans[0],review:{decision:'no-entry',reason:'over'}}],p),{code:'PLAN_METADATA_LIMIT_EXCEEDED'});
});
async function json(res,status=200){const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body;}
const api=(path,body,status=200)=>srv.api(path,body?{method:'PUT',body:JSON.stringify(body)}:{}).then(res=>json(res,status));
test('real ledger correction/deletion invalidates saved evidence and final metadata can be repaired',async()=>{
 await json(await srv.raw('/api/trade-plans'),401);
 let plans=await api('/api/trade-plans');plans=await api('/api/trade-plans',{...plans,plans:[plan()]});
 let trades=await api('/api/trades');trades=await api('/api/trades',{...trades,records:[trade('http-buy','buy',100,{executedAt:'',instrumentType:'stock'})]});
 plans=await api('/api/trade-plans',{...plans,plans:[{...plans.plans[0],tradeLinks:[{tradeId:'http-buy',allocatedShares:100}]}]});
 const frozen=structuredClone(plans.plans[0].tradeLinks);assert.equal(plans.linkEvidence[plans.plans[0].planId].links[0].status,'valid');
 trades=await api('/api/trades',{...trades,records:[{...trades.records[0],shares:50}]});
 plans=await api('/api/trade-plans');assert.equal(plans.linkEvidence[plans.plans[0].planId].links[0].status,'source-changed');assert.deepEqual(plans.plans[0].tradeLinks,frozen);
 plans=await api('/api/trade-plans',{...plans,plans:[{...plans.plans[0],status:'closed',review:{decision:'insufficient-data',reason:'成交股數已修正'}}]});
 plans=await api('/api/trade-plans',{...plans,plans:[{...plans.plans[0],tradeLinks:[{tradeId:'http-buy',allocatedShares:50}]}]});
 trades=await api('/api/trades',{...trades,records:[]});plans=await api('/api/trade-plans');assert.equal(plans.linkEvidence[plans.plans[0].planId].links[0].status,'source-deleted');
 plans=await api('/api/trade-plans',{...plans,plans:[{...plans.plans[0],tradeLinks:[],review:{...plans.plans[0].review,reason:'來源刪除，解除關聯'}}]});assert.equal(plans.plans[0].metadataRevisions[0].tradeLinks[0].allocatedShares,100);
});
test('cross-account trade IDs rejected; source changes and auth are revalidated inside queue',async()=>{
 const db=await mod.loadDb(),uid=db.users[0].id;
 const other=(await json(await srv.api('/api/admin/users',{method:'POST',body:JSON.stringify({username:'t11other',password:'t11other-password',role:'user'})}),201)).user;
 const login=await srv.raw('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'t11other',password:'t11other-password'})});const cookie=login.headers.get('set-cookie').split(';')[0];await json(login);
 let trades=await api('/api/trades');trades=await api('/api/trades',{...trades,records:[trade('queue-buy','buy',100,{executedAt:'',instrumentType:'stock'})]});
 const foreign={schemaVersion:1,rev:0,plans:[plan({tradeLinks:[{tradeId:'queue-buy',allocatedShares:1}]})]};
 const rejection=await json(await srv.api('/api/trade-plans',{method:'PUT',headers:{cookie},body:JSON.stringify(foreign)}),422);assert.equal(rejection.code,'PLAN_LINK_SOURCE_MISSING');
 let plans=await api('/api/trade-plans');const raw=plan();plans=await api('/api/trade-plans',{...plans,plans:[...plans.plans,raw]});
 let release,entered;const held=new Promise(resolve=>entered=resolve);const blocker=mod.commitDbMutation(async()=>{entered();await new Promise(resolve=>release=resolve);});await held;
 const correction=mod.commitDbMutation(current=>{current.trades[uid].records[0].shares=10;});
 const pending=srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify({...plans,plans:plans.plans.map(p=>p.planId===raw.planId?{...p,tradeLinks:[{tradeId:'queue-buy',allocatedShares:100}]}:p)})});
 release();await blocker;await correction;assert.equal((await json(await pending,422)).code,'PLAN_LINK_OVERALLOCATED');
 const otherPlans=await json(await srv.api('/api/trade-plans',{headers:{cookie}}));
 let unlock,ready;const locked=new Promise(resolve=>ready=resolve);const block=mod.commitDbMutation(async()=>{ready();await new Promise(resolve=>unlock=resolve);});await locked;
 const revoke=mod.commitDbMutation(current=>{current.sessions=current.sessions.filter(session=>session.userId!==other.id);});
 const sent=new Promise(resolve=>mod.server.once('request',request=>request.once('end',()=>setImmediate(resolve))));
 const stale=srv.api('/api/trade-plans',{method:'PUT',headers:{cookie},body:JSON.stringify({...otherPlans,plans:[plan()]})});await sent;unlock();await block;await revoke;await json(await stale,401);
 assert.equal(db.tradePlans?.[other.id],undefined);
});
test('metadata capacity includes archived snapshots and source chronology uses Taipei trade day',()=>{
 const records=[trade('cap','buy',100)];let p=build([plan()]);
 assert.throws(()=>build([{...p.plans[0],tradeLinks:[{tradeId:'cap',allocatedShares:1}]}],p,[{...records[0],date:'19990101'}]),{code:'PLAN_LINK_TIME_INVALID'});
 p=build([{...p.plans[0],tradeLinks:[{tradeId:'cap',allocatedShares:1}]}],p,records);
 let failed=false;try{for(let i=0;i<100;i++)p=build([{...p.plans[0],review:{decision:'conditions-changed',reason:'漢'.repeat(999)+(i%10)}}],p,records);}catch(error){assert.equal(error.code,'PLAN_STORAGE_TOO_LARGE');failed=true;}assert.ok(failed);
 const bundle=mod.validatePortableTradePlans(p,now);assert.deepEqual(build(bundle.plans,bundle,records),bundle);
});
test('actual personal restore validates against restored ledger; old v2 absence and immutable audits survive',async()=>{
 let plans=await api('/api/trade-plans'),trades=await api('/api/trades');const id=plans.plans.at(-1).planId;
 plans=await api('/api/trade-plans',{...plans,plans:plans.plans.map(p=>p.planId===id?{...p,tradeLinks:[{tradeId:'queue-buy',allocatedShares:10}]}:p)});
 const exported=(await api('/api/personal-data/export')).bundle;
 const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')}}`;
 const sign=b=>{const {integrity,...unsigned}=b;b.integrity={algorithm:'sha256',contentHash:createHash('sha256').update(stable(unsigned)).digest('hex')};return b;};
 const options={watchLists:'replace',alerts:'replace',trades:'replace',stockNotes:'merge',companyProfiles:'skip'};
 const preview=async bundle=>json(await srv.api('/api/personal-data/restore/preview',{method:'POST',body:JSON.stringify({bundle,options})}));
 const changed=structuredClone(exported);changed.data.trades.records=[];sign(changed);
 const p=await preview(changed);assert.equal(p.plan.sections.tradePlans.invalidatedLinkCount,1);
 await json(await srv.api('/api/personal-data/restore',{method:'POST',body:JSON.stringify({previewToken:p.previewToken,confirmation:'RESTORE',currentPassword:'test-admin-pw'})}));
 const current=await api('/api/trade-plans');assert.equal(current.linkEvidence[id].links[0].status,'source-deleted');assert.deepEqual(current.plans.at(-1).metadataRevisions,plans.plans.at(-1).metadataRevisions);
 const old=structuredClone(exported);old.data.tradePlans.plans=old.data.tradePlans.plans.map(plan=>{const p={...plan};delete p.tradeLinks;delete p.review;delete p.metadataRevisions;return p;});sign(old);
 const legacy=await preview(old);await json(await srv.api('/api/personal-data/restore',{method:'POST',body:JSON.stringify({previewToken:legacy.previewToken,confirmation:'RESTORE',currentPassword:'test-admin-pw'})}));
 const restored=await api('/api/trade-plans');assert.equal((restored.plans.at(-1).tradeLinks || []).length,0);await api('/api/trade-plans',restored);
});


test('portable link gross cash rejects malformed audit values and preserves null fallback',()=>{
 const records=[trade('gross','buy',100,{grossAmountTwd:12500})];let p=build([plan()]);p=build([{...p.plans[0],tradeLinks:[{tradeId:'gross',allocatedShares:20}]}],p,records);
 assert.equal(mod.buildTradePlanLinkEvidence(p,records)[p.plans[0].planId].buyCash,2504);
 const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')}}`;
 const changed=value=>{const payload=structuredClone(p),item=payload.plans[0];for(const link of [...item.tradeLinks,...item.metadataRevisions.flatMap(r=>r.tradeLinks)]){link.snapshot.grossAmountTwd=value;link.fingerprint=createHash('sha256').update(stable(link.snapshot)).digest('hex');}return payload;};
 for(const malformed of ['12500',-1,Infinity,NaN])assert.throws(()=>mod.validatePortableTradePlans(changed(malformed),now),{code:'PLAN_LINK_INVALID'});
 const missing=mod.validatePortableTradePlans(changed(null),now);assert.equal(missing.plans[0].tradeLinks[0].snapshot.grossAmountTwd,null);
 assert.equal(mod.buildTradePlanLinkEvidence(missing,[{...records[0],grossAmountTwd:null}])[p.plans[0].planId].buyCash,2004);
 const zero=mod.validatePortableTradePlans(changed(0),now);assert.equal(mod.buildTradePlanLinkEvidence(zero,[{...records[0],grossAmountTwd:0}])[p.plans[0].planId].buyCash,4);
});
