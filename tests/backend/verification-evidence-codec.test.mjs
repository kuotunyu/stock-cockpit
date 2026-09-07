// 完成候選池memo無損壓縮；唯一表示、損壞拒絕與大小界線不裁剪證據。
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {packCompletedBenchmark,readBenchmarkEvidence,BENCHMARK_EVIDENCE_MAX_BYTES} from '../../verification-evidence.mjs';
const memo=()=>({status:'complete',capture:{captureId:'synthetic',name:'中文證據'},calendar:{monthEvidence:{202608:{source:'TWSE FMTQIK'}}},calendarAttempt:{through:'20260831'},observations:[{status:'complete',returnPct:0,evidence:{rows:[{date:'20260803',close:100}]}}],result:{pairedCount:1,meanDifference:0},cursor:0});
test('UTF8原字節完整可逆、只留一份blob，summary envelope不改；pending及重複pack不變',()=>{
 const raw=memo(),before=JSON.stringify(raw),packed=packCompletedBenchmark(raw);
 assert.equal(JSON.stringify(raw),before);assert.equal(packed.evidenceBlob.version,1);assert.equal(packed.evidenceBlob.codec,'deflate-base64');
 for(const key of ['capture','calendar','calendarAttempt','observations'])assert.equal(Object.hasOwn(packed,key),false);
 assert.deepEqual(readBenchmarkEvidence(packed),Object.fromEntries(['capture','calendar','calendarAttempt','observations'].map(k=>[k,raw[k]])));
 assert.strictEqual(packed.result,raw.result);assert.strictEqual(packCompletedBenchmark(packed),packed);
 const pending={...raw,status:'pending'};assert.strictEqual(packCompletedBenchmark(pending),pending);
 assert.deepEqual(readBenchmarkEvidence(raw),readBenchmarkEvidence(packed));
});
test('未知codec、版本、SHA、length或壞資料拒絕；解壓限制不能變成missing/recompute',()=>{
 const packed=packCompletedBenchmark(memo());
 for(const patch of [{codec:'unknown'},{version:2},{sha256:'0'.repeat(64)},{rawBytes:1},{rawBytes:BENCHMARK_EVIDENCE_MAX_BYTES+1},{data:'not base64!'},{data:'eA=='}, {rawBytes:0}])
  assert.throws(()=>readBenchmarkEvidence({...packed,evidenceBlob:{...packed.evidenceBlob,...patch}}),e=>e.code==='BENCHMARK_EVIDENCE_INVALID');
});
test('超過32MiB的合法完成memo保留raw；codec界線不是歷史保留上限',()=>{
 const large=memo();large.observations[0].payload='x'.repeat(BENCHMARK_EVIDENCE_MAX_BYTES);
 assert.strictEqual(packCompletedBenchmark(large),large);assert.equal(Object.hasOwn(large,'evidenceBlob'),false);
});
test('4MiB壞blob回具名錯誤，界內高熵資料仍無損且不爆正則堆疊',()=>{
 const packed=packCompletedBenchmark(memo());
 assert.throws(()=>readBenchmarkEvidence({...packed,evidenceBlob:{...packed.evidenceBlob,rawBytes:1,data:'A'.repeat(4*1024*1024)}}),e=>e.code==='BENCHMARK_EVIDENCE_INVALID');
 const entropy=memo();entropy.observations[0].payload=randomBytes(4*1024*1024).toString('base64');
 assert.deepEqual(readBenchmarkEvidence(packCompletedBenchmark(entropy)),readBenchmarkEvidence(entropy));
});
