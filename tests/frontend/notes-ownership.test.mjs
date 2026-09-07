// 備註作者名稱不隨管理權改變，刪除按鈕只消費canManage。
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
const app=await createAppWindow();after(()=>app.cleanup());
test('A/B/admin保留原作者名稱，mine不作管理權fallback',()=>{
 for(const [role,mine,canManage,want]of [['user',true,true,1],['user',false,false,0],['admin',false,true,1],['admin',true,false,0]]){
  const result=JSON.parse(app.evalIn(`JSON.stringify((()=>{authState.user={id:'viewer',role:${JSON.stringify(role)}};state.selectedCode='2330';dataState.quotes=[{code:'2330',name:'台積電'}];notesState.code='2330';notesState.notes=[{id:'one',userName:'作者A',text:'備註',mine:${mine},canManage:${canManage}}];renderStockNotes({code:'2330'});return {count:document.querySelectorAll('[data-note-delete]').length,text:document.querySelector('.note-meta strong')?.textContent};})())`));
  assert.equal(result.count,want);assert.equal(result.text,'作者A');
 }
});
