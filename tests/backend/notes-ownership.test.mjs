// 備註作者與管理權分離，A/B/admin回應及刪除權均走真HTTP。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {bootServer} from '../helpers/test-server.mjs';
let srv;
before(async()=>{srv=await bootServer();await srv.mod.commitDbMutation(db=>{
 for(const id of ['author-a','author-b']){db.users.push({id,username:id,displayName:id,role:'user'});db.sessions.push({id:'session-'+id,tokenHash:srv.mod.hashToken('session-'+id),userId:id,expiresAt:new Date(Date.now()+600000).toISOString()});}
 db.stockNotes={'2330':[{id:'note-a',userId:'author-a',userName:'A',text:'第一則',createdAt:new Date().toISOString()},{id:'note-b',userId:'author-b',userName:'B',text:'第二則',createdAt:new Date().toISOString()}]};
});});
after(async()=>srv.close());
const request=(path,cookie,method='GET')=>srv.raw(path,{method,headers:{cookie,'content-type':'application/json'}});
test('作者標示只屬本人；admin可以管理他人備註但不是作者',async()=>{
 for(const [cookie,want]of [['sid=session-author-a',[[true,true],[false,false]]],['sid=session-author-b',[[false,false],[true,true]]],[srv.cookie,[[false,true],[false,true]]],['',[[false,false],[false,false]]]]){
  const res=await request('/api/notes?code=2330',cookie);assert.equal(res.status,200);const body=await res.json();
  assert.deepEqual(body.notes.map(n=>[n.mine,n.canManage]),want);assert.deepEqual(body.notes.map(n=>n.userName),['A','B']);assert.ok(body.notes.every(n=>!Object.hasOwn(n,'userId')));
 }
});
test('B不能刪A；A能刪本人；admin仍能刪B',async()=>{
 for(const [id,cookie,status]of [['note-a','sid=session-author-b',403],['note-a','sid=session-author-a',200],['note-b',srv.cookie,200]]){
  const res=await request('/api/notes?code=2330&id='+id,cookie,'DELETE');assert.equal(res.status,status);await res.json();
 }
 assert.deepEqual((await srv.mod.loadDb()).stockNotes['2330'],[]);
});
