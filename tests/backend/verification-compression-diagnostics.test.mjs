import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import * as codec from '../../verification-evidence.mjs';
import {importServer,SERVER_PATH} from '../helpers/test-server.mjs';
const raw=()=>({status:'complete',capture:{captureId:'synthetic'},calendar:{},calendarAttempt:{},observations:[{status:'complete',payload:'證據'}],result:{pairedCount:1}});

test('I3：聚合區分pending/未分類raw/packed/超限；未知bytes不當0且packed不inflate',()=>{
 assert.equal(typeof codec.prepareCompletedBenchmark,'function');assert.equal(typeof codec.summarizeBenchmarkCompression,'function');
 const old=raw(),pending={...raw(),status:'pending'},packed=codec.prepareCompletedBenchmark(raw());
 assert.strictEqual(codec.prepareCompletedBenchmark(pending),pending);assert.strictEqual(codec.prepareCompletedBenchmark(packed),packed);
 // 若aggregate讀data或解壓就失敗；此處只要求storage envelope分類，解碼另有完整驗證。
 const noInflate={...packed,evidenceBlob:{...packed.evidenceBlob,get data(){throw new Error('aggregate must not inflate');}}};
 const stats=codec.summarizeBenchmarkCompression([old,pending,noInflate]);
 assert.deepEqual(stats.counts,{pending:1,legacyOrUnclassifiedRaw:1,packed:1,skippedSize:0});
 assert.deepEqual(stats.rawEvidenceBytes,{knownBytes:packed.evidenceBlob.rawBytes,knownCount:1,unknownCount:2});
 assert.equal(Object.hasOwn(old,'evidenceCompression'),false);
});

test('I3：真正超32MiB完成memo原raw與pure pack不變，完成狀態章COW保存且coldread仍可分類',async()=>{
 assert.equal(typeof codec.prepareCompletedBenchmark,'function');
 const large=raw();large.observations[0].payload='x'.repeat(codec.BENCHMARK_EVIDENCE_MAX_BYTES);
 const original=JSON.stringify(large);assert.strictEqual(codec.packCompletedBenchmark(large),large);
 const prepared=codec.prepareCompletedBenchmark(large);
 assert.equal(JSON.stringify(large),original);assert.equal(prepared.status,'complete');assert.strictEqual(prepared.observations,large.observations);assert.strictEqual(prepared.capture,large.capture);assert.equal(prepared.evidenceBlob,undefined);
 assert.deepEqual(prepared.evidenceCompression,{status:'skipped-size',codecVersion:1,rawBytes:Buffer.byteLength(JSON.stringify(codec.readBenchmarkEvidence(large)))});
 assert.ok(prepared.evidenceCompression.rawBytes>codec.BENCHMARK_EVIDENCE_MAX_BYTES);assert.strictEqual(codec.prepareCompletedBenchmark(prepared),prepared);
 const expected=codec.summarizeBenchmarkCompression([prepared]);
 assert.deepEqual(expected.counts,{pending:0,legacyOrUnclassifiedRaw:0,packed:0,skippedSize:1});assert.equal(expected.rawEvidenceBytes.unknownCount,0);
 const srv=await importServer();
 try{
  await srv.mod.commitDbMutation(db=>{db.verificationBenchmarks={memos:{large:prepared}};});
  const child=`const {createHash}=await import("node:crypto");const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)});const c=await import(${JSON.stringify(pathToFileURL(SERVER_PATH.replace('server.mjs','verification-evidence.mjs')).href)});const db=await m.loadDb();const x=db.verificationBenchmarks.memos.large;console.log(JSON.stringify({status:x.status,blob:!!x.evidenceBlob,payloadLength:x.observations[0].payload.length,payloadHash:createHash('sha256').update(x.observations[0].payload).digest('hex'),marker:x.evidenceCompression,stats:c.summarizeBenchmarkCompression([x])}));`;
  const cold=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8',env:{...process.env,DATA_DIR:srv.dataDir,PORT:'0',STOCK1_SKIP_LISTEN:'1'}}).trim().split('\n').at(-1));
  assert.deepEqual(cold,{status:'complete',blob:false,payloadLength:codec.BENCHMARK_EVIDENCE_MAX_BYTES,payloadHash:createHash('sha256').update(large.observations[0].payload).digest('hex'),marker:prepared.evidenceCompression,stats:expected});
 }finally{await srv.mod.shutdownServer();srv.mock.restore();await rm(srv.dataDir,{recursive:true,force:true});}
});

test('I3：公開隔離diagnostic使用同完成轉換，前後聚合可讀且沒有假精確raw總量',()=>{
 const lines=execFileSync(process.execPath,['scripts/verification-diagnostics.mjs','1'],{encoding:'utf8'}).trim().split('\n');const report=JSON.parse(lines.at(-1));
 assert.deepEqual(report.before.compression.counts,{pending:0,legacyOrUnclassifiedRaw:2,packed:0,skippedSize:0});assert.equal(report.before.compression.rawEvidenceBytes.unknownCount,2);
 assert.deepEqual(report.after.compression.counts,{pending:0,legacyOrUnclassifiedRaw:0,packed:2,skippedSize:0});assert.equal(report.after.compression.rawEvidenceBytes.unknownCount,0);assert.ok(report.after.compression.rawEvidenceBytes.knownBytes>0);
});
