// 完成memo的無損證據codec；不做IO、不修改原memo、不改統計結果。
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
export const BENCHMARK_EVIDENCE_MAX_BYTES=32*1024*1024;
const fields=['capture','calendar','calendarAttempt','observations'];
const evidenceOf=memo=>Object.fromEntries(fields.filter(k=>Object.hasOwn(memo,k)).map(k=>[k,memo[k]]));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const invalid=()=>Object.assign(new Error('固定期間觀察證據無法解碼；請保留原始備份並檢查資料完整性。'),{code:'BENCHMARK_EVIDENCE_INVALID'});
export function packCompletedBenchmark(memo) {
 if(memo.status!=='complete'||memo.evidenceBlob)return memo;
 const raw=Buffer.from(JSON.stringify(evidenceOf(memo)),'utf8');
 // 是codec限制，不是保留上限；大memo仍以原格式完整保存。
 if(raw.length>BENCHMARK_EVIDENCE_MAX_BYTES)return memo;
 const packed={...memo,evidenceBlob:{version:1,codec:'deflate-base64',rawBytes:raw.length,sha256:hash(raw),data:deflateSync(raw).toString('base64')}};
 for(const field of fields)delete packed[field];
 return packed;
}
export function readBenchmarkEvidence(memo) {
 if(!memo.evidenceBlob)return evidenceOf(memo);
 const b=memo.evidenceBlob;
 if(b.version!==1||b.codec!=='deflate-base64'||!Number.isSafeInteger(b.rawBytes)||b.rawBytes<=0||b.rawBytes>BENCHMARK_EVIDENCE_MAX_BYTES
   ||typeof b.sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.sha256)||typeof b.data!=='string'
   ||b.data.length>Math.ceil((BENCHMARK_EVIDENCE_MAX_BYTES+65536)/3)*4||b.data.length%4!==0)throw invalid();
 try {
  const compressed=Buffer.from(b.data,'base64');
  if(compressed.toString('base64')!==b.data)throw invalid();
  const raw=inflateSync(compressed,{maxOutputLength:b.rawBytes});
  if(raw.length!==b.rawBytes||hash(raw)!==b.sha256)throw invalid();
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!decoded||Array.isArray(decoded)||typeof decoded!=='object'||!decoded.capture||!Array.isArray(decoded.observations)
    ||Object.keys(decoded).some(k=>!fields.includes(k)))throw invalid();
  return decoded;
 }catch{throw invalid();}
}

// 擷取清單的逐檔終端結果（outcomes，260 列 ≈ 177 KB／策略／日）在執行期沒有任何讀取端，只是稽核證據；
// 主 DB 每次 commitDbMutation 都整份序列化，這 177 KB 每天都在付成本。deflate 後存 outcomesBlob（同 memo 的
// 格式與驗證），讀取走 readCaptureOutcomes。不做 IO、不改統計結果；候選池 candidates 有執行期讀取端，不動。
const outcomesInvalid=()=>Object.assign(new Error('擷取清單的逐檔結果證據無法解碼；請保留原始備份並檢查資料完整性。'),{code:'CAPTURE_EVIDENCE_INVALID'});
function validBlobShape(b) {
 return b&&b.version===1&&b.codec==='deflate-base64'&&Number.isSafeInteger(b.rawBytes)&&b.rawBytes>0&&b.rawBytes<=BENCHMARK_EVIDENCE_MAX_BYTES
   &&typeof b.sha256==='string'&&/^[a-f0-9]{64}$/.test(b.sha256)&&typeof b.data==='string'
   &&b.data.length<=Math.ceil((BENCHMARK_EVIDENCE_MAX_BYTES+65536)/3)*4&&b.data.length%4===0;
}
function inflateBlob(b) {
 const compressed=Buffer.from(b.data,'base64');
 if(compressed.toString('base64')!==b.data)throw new Error('base64');
 const raw=inflateSync(compressed,{maxOutputLength:b.rawBytes});
 if(raw.length!==b.rawBytes||hash(raw)!==b.sha256)throw new Error('hash');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}
export function packCaptureOutcomes(manifest) {
 if(!manifest||typeof manifest!=='object'||!Array.isArray(manifest.outcomes)||manifest.outcomesBlob)return manifest;
 const raw=Buffer.from(JSON.stringify(manifest.outcomes),'utf8');
 if(raw.length>BENCHMARK_EVIDENCE_MAX_BYTES)return manifest;
 const packed={...manifest,outcomesBlob:{version:1,codec:'deflate-base64',rows:manifest.outcomes.length,rawBytes:raw.length,sha256:hash(raw),data:deflateSync(raw).toString('base64')}};
 delete packed.outcomes;
 return packed;
}
// 回 outcomes 陣列；inline 直接回、packed 解回並驗雜湊、兩者都沒有回 null（舊 manifest 本來就沒有證據）。
export function readCaptureOutcomes(manifest) {
 if(!manifest||typeof manifest!=='object')return null;
 if(Array.isArray(manifest.outcomes))return manifest.outcomes;
 const b=manifest.outcomesBlob;
 if(!b)return null;
 if(!validBlobShape(b)||!Number.isSafeInteger(b.rows)||b.rows<0)throw outcomesInvalid();
 let decoded;
 try{decoded=inflateBlob(b);}catch{throw outcomesInvalid();}
 if(!Array.isArray(decoded)||decoded.length!==b.rows)throw outcomesInvalid();
 return decoded;
}

// 只供新完成transition呼叫；舊raw的load/summary不自動套用。
export function prepareCompletedBenchmark(memo) {
 if(memo.status!=='complete'||memo.evidenceBlob||isSkippedSize(memo.evidenceCompression))return memo;
 const packed=packCompletedBenchmark(memo);
 if(packed!==memo)return packed;
 return {...memo,evidenceCompression:{status:'skipped-size',codecVersion:1,
  rawBytes:Buffer.byteLength(JSON.stringify(evidenceOf(memo)),'utf8')}};
}
function isSkippedSize(marker) {
 return marker?.status==='skipped-size'&&marker.codecVersion===1&&Number.isSafeInteger(marker.rawBytes)&&marker.rawBytes>BENCHMARK_EVIDENCE_MAX_BYTES;
}
// storage分類不是codec完整性驗證；只讀已保存長度，不inflate或序列化未分類raw。
export function summarizeBenchmarkCompression(memos) {
 const counts={pending:0,legacyOrUnclassifiedRaw:0,packed:0,skippedSize:0};
 const rawEvidenceBytes={knownBytes:0,knownCount:0,unknownCount:0};
 for(const memo of memos) {
  let rawBytes=null;
  if(memo.status!=='complete')counts.pending++;
  else if(memo.evidenceBlob){counts.packed++;rawBytes=memo.evidenceBlob.rawBytes;}
  else if(isSkippedSize(memo.evidenceCompression)){counts.skippedSize++;rawBytes=memo.evidenceCompression.rawBytes;}
  else counts.legacyOrUnclassifiedRaw++;
  if(Number.isSafeInteger(rawBytes)&&rawBytes>0){rawEvidenceBytes.knownBytes+=rawBytes;rawEvidenceBytes.knownCount++;}
  else rawEvidenceBytes.unknownCount++;
 }
 return {counts,rawEvidenceBytes};
}
