// 個人計畫：草稿、首次啟用風險、不可變歷史與嚴格輸入。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { importServer } from '../helpers/test-server.mjs';
const {mod, mock, dataDir} = await importServer();
after(async () => { mock.restore(); await rm(dataDir, {recursive:true,force:true}); });
const now = new Date().toISOString();
const future = new Date(Date.now()+86400000*7).toISOString().slice(0,10);
const draft = (extra={}) => ({planId:randomUUID(),signalId:null,code:'2330',exchange:'TWSE',strategy:'swing',scenario:null,status:'draft',entryPrice:null,entryLow:null,entryHigh:null,riskBudgetCash:null,invalidationReason:'',stopPrice:null,targetPrice:null,quantity:null,expiresOn:null,reason:'原始理由',...extra});
const build = (plans, existing, options={}) => mod.canonicalizeTradePlans({schemaVersion:1,plans}, existing, {now,...options});
test('manual incomplete draft freezes initial evidence; first activation and later stop stay distinct', () => {
  assert.equal(typeof mod.canonicalizeTradePlans, 'function');
  const first=build([draft()]); const p=first.plans[0];
  assert.equal(p.initial.intent.entryPrice,null); assert.equal(p.activation,null);
  const second=build([{...p,status:'active',entryPrice:100,stopPrice:95,quantity:1000,expiresOn:future}],first);
  const active=second.plans[0]; assert.equal(active.activation.riskAmount,5000);
  const third=build([{...active,stopPrice:97}],second);
  assert.equal(third.plans[0].activation.intent.stopPrice,95);
  assert.equal(third.plans[0].stopPrice,97); assert.equal(third.plans[0].initial.intent.entryPrice,null);
  assert.equal(third.plans[0].revisions.length,2);
  assert.deepEqual(build(third.plans,third),third);
});
test('rejects bad types, nonpositive risk, missing active fields, expired activation, owner and fake history', () => {
  for(const bad of [{entryPrice:'100'},{entryPrice:0},{stopPrice:-1},{quantity:1.5},{entryPrice:100,targetPrice:99},{status:'active'}, {reason:'a'.repeat(1001)}, {userId:'other'}, {createdAt:now}]) {
    assert.throws(()=>build([draft(bad)]), {status:422});
  }
  assert.throws(()=>build([draft({status:'active',entryPrice:100,stopPrice:95,quantity:100,expiresOn:'2000-01-01'})]),{status:422});
});
test('no deletion, identity or history rewrite, reopening, duplicate ids or silent capacity truncation', () => {
  const first=build([draft(),draft({strategy:'overnight'})]);
  assert.equal(first.plans.length,2);
  assert.throws(()=>build([first.plans[0]],first),{code:'PLAN_REMOVAL_FORBIDDEN'});
  const p=first.plans[0];
  assert.throws(()=>build([{...p,code:'1101'},first.plans[1]],first),{status:422});
  assert.throws(()=>build([{...p,initial:{...p.initial,intent:{...p.initial.intent,reason:'rewrite'}}},first.plans[1]],first),{status:422});
  const cancelled=build([{...p,status:'cancelled'},first.plans[1]],first);
  assert.throws(()=>build([{...cancelled.plans[0],status:'draft'},cancelled.plans[1]],cancelled),{status:422});
  assert.throws(()=>build([p,p]),{status:422});
  assert.throws(()=>build(Array.from({length:1001},()=>draft())),{code:'PLAN_LIMIT_EXCEEDED'});
});
test('exact stored signal identity validates strategy/market/scenario and cannot be fabricated', () => {
  const captureId='c'.repeat(64), signalId='a'.repeat(64);
  const db={verificationPublications:{captures:{[captureId]:{captureId,strategy:'swing',signals:[{code:'2330',exchange:'TWSE',scenario:{key:'midBandDefense'},signalId}]}}}};
  const p=draft({signalId,sourceCaptureId:captureId,scenario:'midBandDefense'});
  assert.equal(build([p],undefined,{db}).plans[0].source.verification,'verified-local');
  assert.throws(()=>build([{...p,scenario:'strongContinuation'}],undefined,{db}),{code:'PLAN_SOURCE_INVALID'});
  assert.throws(()=>build([p]),{code:'PLAN_SOURCE_INVALID'});
});
test('entry range/budget constraints, active trailing above entry, exact revision cap, expired close',()=>{
 for(const bad of [{entryLow:90},{entryLow:110,entryHigh:100},{entryLow:90,entryHigh:100,entryPrice:101},{riskBudgetCash:0},{invalidationReason:'x'.repeat(1001)}])assert.throws(()=>build([draft(bad)]),{status:422});
 assert.throws(()=>build([draft({status:'active',entryPrice:100,stopPrice:101,quantity:1,expiresOn:future})]),{status:422});
 let payload=build([draft({status:'active',entryPrice:100,entryLow:99,entryHigh:101,stopPrice:95,quantity:1000,riskBudgetCash:6000,expiresOn:future})]);
 payload=build([{...payload.plans[0],stopPrice:102}],payload);assert.equal(payload.plans[0].activation.riskAmount,5000);assert.equal(payload.plans[0].riskBudgetCash,6000);
 for(let i=2;i<=100;i++)payload=build([{...payload.plans[0],reason:String(i)}],payload);
 assert.equal(payload.plans[0].revisions.length,100);assert.deepEqual(build(payload.plans,payload),payload);
 assert.throws(()=>build([{...payload.plans[0],reason:'101'}],payload),{code:'PLAN_REVISION_LIMIT_EXCEEDED'});
 const first=build([draft({status:'active',entryPrice:100,stopPrice:95,quantity:1,expiresOn:future})]);
 const closed=build([{...first.plans[0],status:'closed'}],first,{now:new Date(Date.now()+86400000*30).toISOString()});assert.equal(closed.plans[0].status,'closed');
});
test('multibyte canonical quota includes server snapshots and reserves import overhead for no-op/backup roundtrip',()=>{
 const raw=Array.from({length:20},()=>draft({reason:'漢'.repeat(1000)}));
 assert.ok(Buffer.byteLength(JSON.stringify({schemaVersion:1,rev:0,plans:raw}))<128*1024);
 assert.throws(()=>build(raw),{code:'PLAN_STORAGE_TOO_LARGE'});
 let admitted;for(let n=1;n<=20;n++){
  try{admitted=build(raw.slice(0,n));}catch(error){assert.equal(error.code,'PLAN_STORAGE_TOO_LARGE');break;}
 }
 assert.ok(admitted.plans.length>1&&admitted.plans.length<20);
 assert.ok(Buffer.byteLength(JSON.stringify({...admitted,rev:999999}))<128*1024);
 const imported=mod.validatePortableTradePlans(admitted,now);assert.deepEqual(build(imported.plans,imported),imported);
 assert.ok(Buffer.byteLength(JSON.stringify({...imported,rev:999999}))<128*1024);
});
