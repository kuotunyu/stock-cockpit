// 上櫃官方歷史除權息表：完整回應、空事件、單位與失敗隔離。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { importServer } from '../helpers/test-server.mjs';
import { compactTradingDay } from '../helpers/fixtures.mjs';
let mod, mock, dataDir;
before(async () => { ({mod,mock,dataDir} = await importServer({ routes:[] })); });
after(async () => {
 await mod.shutdownServer(); mock.restore();
 assert.equal(dirname(resolve(dataDir)),resolve(tmpdir()));
 assert.ok(basename(dataDir).startsWith('stock1-test-'));
 await rm(dataDir,{recursive:true,force:true});
});
const day = compactTradingDay(-1), from = day.slice(0,6)+'01';
const fields = ['除權息日期','代號','名稱','除權息前收盤價','除權息參考價','權值','息值','權值+息值','權/息','漲停價','跌停價','開始交易基準價','減除股利參考價','現金股利','每仟股無償配股','現金增資股數','現金增資認購價','公開承銷股數','員工認購股數','原股東認購股數','按持股比例仟股認購'];
const row = [day,'5488','測試','100','95','0','5','5','除息','104.5','85.5','95','95','5','0','0','0','0','0','0','0'];
const payload = (rows=[row]) => ({ stat:'ok',date:from+'~'+day,tables:[{fields,data:rows,totalCount:rows.length}] });
test('完整日範圍、成功空清單與每仟股單位均明確', () => {
  const p = mod.parseTpexHoldingActions(payload(),from,day);
  assert.equal(p[0].cashDividend,5); assert.equal(p[0].stockRatio,0);
  assert.deepEqual(mod.parseTpexHoldingActions(payload([]),from,day),[]);
  const share = [...row]; share[8]='除權'; share[13]='0'; share[14]='199.99998018'; share[20]='56.38814929';
  const result = mod.parseTpexHoldingActions(payload([share]),from,day)[0];
  assert.ok(Math.abs(result.stockRatio-0.19999998018)<1e-12); assert.ok(Math.abs(result.subscriptionRatio-0.05638814929)<1e-12);
});
test('錯status、schema、日期、頁面截斷與重複事件不得蓋完整章', () => {
  for (const mutate of [p=>p.stat='error',p=>p.date='wrong',p=>p.tables[0].fields.pop(),p=>p.tables[0].totalCount=2,
    p=>p.tables[0].data[0][0]='19000101',p=>p.tables.push(p.tables[0]),p=>p.tables[0].data[0].pop()]) {
    const p=payload(); p.tables[0].fields=[...fields]; p.tables[0].data=[[...row]]; mutate(p);
    assert.throws(()=>mod.parseTpexHoldingActions(p,from,day));
  }
  assert.throws(()=>mod.parseTpexHoldingActions(payload([row,row]),from,day));
});
test('月份查詢single-flight、明確empty與來源失敗unknown',async()=>{
  const end=mod.addDaysCompact(mod.addMonthsCompact(from,1),-1);
  const p=payload([]);p.date=from+'~'+end;
  const remove=mock.override({match:/bulletin\/exDailyQ/,reply:p});
  const before=mock.calls.length;
  const [a,b]=await Promise.all([mod.getTpexHoldingActionMonth(from.slice(0,6)),mod.getTpexHoldingActionMonth(from.slice(0,6))]);
  assert.equal(a.status,'complete');assert.deepEqual(a,b);assert.equal(mock.calls.length-before,1); remove();
  const other=mod.addMonthsCompact(from,-1).slice(0,6);
  const fail=mock.override({match:/bulletin\/exDailyQ/,reply:{stat:'error'}});
  const unknown=await mod.getTpexHoldingActionMonth(other); assert.equal(unknown.status,'unavailable');assert.equal(unknown.events,null);fail();
});
