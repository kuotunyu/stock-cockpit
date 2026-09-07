// 真 HTTP 個人計畫：隔離、併發、寫入回滾、提交時身分與帳號移除。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {bootServer} from '../helpers/test-server.mjs';
let srv,db,admin,other,cookie;
const plan=(extra={})=>({planId:randomUUID(),code:'2330',exchange:'TWSE',strategy:'swing',signalId:null,status:'draft',...extra});
async function json(response,status){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;}
const get=()=>srv.api('/api/trade-plans').then(r=>json(r,200));
const put=(payload,status=200,extra={})=>srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify(payload),...extra}).then(r=>json(r,status));
before(async()=>{
 srv=await bootServer();db=await srv.mod.loadDb();admin=db.users[0];
 other=(await json(await srv.api('/api/admin/users',{method:'POST',body:JSON.stringify({username:'plan-other',password:'plan-other-password',role:'admin'})}),201)).user;
 const login=await srv.raw('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'plan-other',password:'plan-other-password'})});cookie=login.headers.get('set-cookie').split(';')[0];await json(login,200);
});after(async()=>srv?.close());
test('personal GET and PUT require login; method and schema fail explicitly',async()=>{
 for(const method of ['GET','PUT'])await json(await srv.raw('/api/trade-plans',{method}),401);
 await json(await srv.api('/api/trade-plans',{method:'POST'}),405);
 await put({schemaVersion:2,rev:0,plans:[]},422);
 assert.deepEqual((await get()).plans,[]);
 const large=await put({schemaVersion:1,rev:0,plans:[plan({reason:'x'.repeat(140000)})]},413);assert.equal(large.code,'PLAN_BODY_TOO_LARGE');assert.match(large.error,/匯出/);
});
test('same rev concurrent PUT commits once, canonical no-op retry adds no revision',async()=>{
 const results=await Promise.all([plan(),plan({strategy:'overnight'})].map(p=>srv.api('/api/trade-plans',{method:'PUT',body:JSON.stringify({schemaVersion:1,rev:0,plans:[p]})}).then(async r=>({status:r.status,body:await r.json()}))));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const first=await get();assert.equal(first.plans.length,1);
 const noOp=await put(first);assert.deepEqual(noOp,first);assert.equal(noOp.plans[0].revisions.length,0);
 const otherRead=await json(await srv.api('/api/trade-plans',{headers:{cookie}}),200);assert.deepEqual(otherRead.plans,[]);
 await put({...first,plans:[{...first.plans[0],userId:other.id}]},422);
 await put({...first,plans:[{...first.plans[0],initial:{}}]},422);
 await put({...first,plans:[]},422);
});
test('failed disk write never publishes draft/rev; next successful write excludes failed plan',async()=>{
 const before=await get(),epoch=srv.mod.getDbMutationEpochForTest();const blocker=join(srv.dataDir,'stock1-db.json.tmp');
 await mkdir(blocker);
 try{
  const failed=await put({...before,plans:[...before.plans,plan({reason:'FAILED_SENTINEL'})]},503);
  assert.equal(failed.code,'PERSISTENCE_FAILED');assert.deepEqual(await get(),before);
  assert.deepEqual(db.tradePlans[admin.id].plans,before.plans);
  assert.equal(srv.mod.getDbMutationEpochForTest(),epoch+1);
 }finally{await rm(blocker,{recursive:true,force:true});}
 const next=await put({...before,plans:[...before.plans,plan({reason:'SUCCESS_SENTINEL'})]});
 assert.equal(next.rev,before.rev+1);
 assert.doesNotMatch(await readFile(join(srv.dataDir,'stock1-db.json'),'utf8'),/FAILED_SENTINEL/);
});
test('demoted admin still writes their own plans; pending body invalidated session cannot write',async()=>{
 await srv.mod.commitDbMutation(current=>{current.users.find(user=>user.id===other.id).role='user';});
 await put({schemaVersion:1,rev:0,plans:[plan()]},200,{headers:{cookie}});
 const current=await json(await srv.api('/api/trade-plans',{headers:{cookie}}),200);
 let send;const ready=new Promise(resolve=>send=resolve);
 const body=JSON.stringify({...current,plans:[...current.plans,plan({reason:'EXPIRED_SENTINEL'})]});
 let req;
 const response=new Promise((resolve,reject)=>{
  req=request(new URL('/api/trade-plans',srv.baseUrl),{method:'PUT',headers:{cookie,'content-type':'application/json',expect:'100-continue'}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));
  });req.on('error',reject);req.on('continue',()=>{req.write(body.slice(0,10));setTimeout(send,30);});req.flushHeaders();
 });
 try{
  await ready;await json(await srv.api('/api/admin/users',{method:'PATCH',body:JSON.stringify({id:other.id,password:'reset-other-password'})}),200);
  req.end(body.slice(10));const result=await response;assert.equal(result.status,401);assert.equal(result.body.code,'AUTH_REQUIRED');
  assert.equal(db.tradePlans[other.id].plans.length,1);
 }finally{req.destroy();}
});
test('account deletion removes plans and revs without touching another account',async()=>{
 const before=await get();await json(await srv.api('/api/admin/users?id='+other.id,{method:'DELETE'}),200);
 assert.equal(db.tradePlans[other.id],undefined);assert.equal(db.dataRevs[other.id],undefined);assert.deepEqual(await get(),before);
});
