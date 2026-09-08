// 小型探針與局部診斷驗缺席、未呼叫、實測及故障可見性，不重跑整批效能採樣。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { captureRendererProbes, summarizeRendererProbes, RENDERER_PROBES, withExpectedFixtureDiagnostic } from '../../scripts/verification-measurement.mjs';

test('六個探針完整輸出三種狀態，巢狀樣本仍重疊且原函式復原', async () => {
  let tick=0;
  const target={renderRows(){this.renderDetail();return 42;},renderStrategies(){},renderDetail(){},renderWatchManager(){}};
  const originals={...target};
  const result=await captureRendererProbes(()=>target.renderRows(), {names:RENDERER_PROBES,target,now:()=>tick++});
  assert.equal(result.value,42);
  assert.deepEqual(Object.keys(result.parts),RENDERER_PROBES);
  assert.deepEqual(result.parts.renderMarketStrip,{status:'missing',raw:[]});
  assert.deepEqual(result.parts.renderScreenerSummary,{status:'missing',raw:[]});
  assert.deepEqual(result.parts.renderWatchManager,{status:'not-called',raw:[]});
  assert.deepEqual(result.parts.renderStrategies,{status:'not-called',raw:[]});
  assert.deepEqual(result.parts.renderDetail,{status:'measured',raw:[1]});
  assert.deepEqual(result.parts.renderRows,{status:'measured',raw:[3]});
  assert.deepEqual(target,originals);
  const output=summarizeRendererProbes(result.parts);
  assert.deepEqual(Object.keys(output),RENDERER_PROBES);
  assert.deepEqual(output.renderMarketStrip,{status:'missing',count:0,raw:[]});
  assert.deepEqual(output.renderWatchManager,{status:'not-called',count:0,raw:[]});
  assert.deepEqual(output.renderRows,{status:'measured',count:1,min:3,max:3,mean:3,raw:[3]});
});

test('安裝失敗必須拋出且復原先前探針；工作量例外也不被吞', async () => {
  const fn=()=>{};
  const target={good:fn};
  Object.defineProperty(target,'locked',{value:fn,writable:false});
  let ran=false;
  await assert.rejects(captureRendererProbes(()=>{ran=true;}, {names:['good','locked'],target}), /probe.*locked/i);
  assert.equal(ran,false);
  assert.strictEqual(target.good,fn);
  const failure=Error('unexpected workload');
  await assert.rejects(captureRendererProbes(()=>{throw failure;},{names:['good'],target}), error=>error===failure);
  assert.strictEqual(target.good,fn);
});

const admin='[Stock1] Created initial admin user "admin". Set ADMIN_PASSWORD before cloud deployment.';
const persistence='[Stock1] 主資料庫寫入失敗，未發布的記憶體草稿已丟棄：';
function loggerFixture(){const visible=[];return {visible,logger:{warn(...args){visible.push(['warn',...args]);},error(...args){visible.push(['error',...args]);}}};}

test('局部 admin 只捕獲一次已知訊息，未知 stderr 可見，缺訊息與例外照常失敗', async () => {
  const {logger,visible}=loggerFixture(),original=logger.warn;
  const value=await withExpectedFixtureDiagnostic(()=>{logger.warn(admin);logger.warn('unexpected warning');logger.error('unexpected stderr');return 42;},{kind:'admin',logger});
  assert.equal(value,42);
  assert.deepEqual(visible,[['warn','unexpected warning'],['error','unexpected stderr']]);
  assert.strictEqual(logger.warn,original);
  await assert.rejects(withExpectedFixtureDiagnostic(()=>{}, {kind:'admin',logger}), /expected.*1/i);
  await assert.rejects(withExpectedFixtureDiagnostic(()=>{logger.warn(admin);logger.warn(admin);}, {kind:'admin',logger}), /expected.*1/i);
  const failure=Error('unexpected setup');
  await assert.rejects(withExpectedFixtureDiagnostic(()=>{throw failure;}, {kind:'admin',logger}), error=>error===failure);
  assert.strictEqual(logger.warn,original);
});

test('atomic 診斷只接受 owned blocker 的 unlink，不綁 OS errno 且不吞別處故障', async () => {
  const path=await mkdtemp(join(tmpdir(),'stock1-test-final-diagnostic-'));
  const blocker=join(path,'stock1-db.json.tmp');
  try {
    for(const code of ['EPERM','EISDIR']) {
      const {logger,visible}=loggerFixture(),original=logger.error;
      await withExpectedFixtureDiagnostic(()=>{
        logger.error(persistence, `${code}: synthetic, unlink '${blocker}'`);
        logger.error(persistence, `${code}: synthetic, unlink '${join(path,'other.tmp')}'`);
        logger.error(persistence, `${code}: synthetic, open '${blocker}'`);
      },{kind:'atomic',blocker,logger});
      assert.equal(visible.length,2);
      assert.match(visible[0][2],/other.tmp/);
      assert.match(visible[1][2],/open/);
      assert.strictEqual(logger.error,original);
    }
  } finally {assert.equal(dirname(resolve(path)),resolve(tmpdir()));await rm(path,{recursive:true,force:true});}
});
