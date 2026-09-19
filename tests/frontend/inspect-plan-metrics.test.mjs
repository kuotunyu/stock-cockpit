// 健檢毛淨盈虧比與成本後門檻，未知不得變成零。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
let app;
before(async()=>{app=await createAppWindow();});after(()=>app.cleanup());
for(const net of [null,undefined,0,0.87,0.99,1,-0.2]) test(`健檢淨值 ${net}`,()=>{
  const d={code:'2330',name:'<img src=x>',rr:1.3,plan:{rrNet:net},verdict:{status:'near',name:'測試型態',failCount:2}};
  const host=app.doc.createElement('div');host.innerHTML=app.evalIn(`renderInspectCard(${JSON.stringify(d)})`);
  assert.match(host.textContent,/毛 1\.3/);
  assert.ok(host.textContent.includes(`淨 ${net == null ? '--' : net.toFixed(2)}`));
  if(net == null) assert.match(host.textContent,/無法核對成本後門檻/);
  else if(net<1) assert.match(host.textContent,/低於榜單門檻/);
  else assert.doesNotMatch(host.textContent,/低於榜單門檻/);
  assert.equal(host.querySelector('img'),null);
  assert.match(host.textContent,/差 2 項/);
});
test('毛值未知保持 --',()=>{
  assert.match(app.evalIn("renderInspectCard({rr:null,plan:{rrNet:null}})"),/毛 --/);
});
