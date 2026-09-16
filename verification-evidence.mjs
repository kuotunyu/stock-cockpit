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
// 通用的「陣列欄位 → blob」codec：record[field]（陣列）壓成 record[blobField]（deflate＋sha256＋rows），已 packed 或不是陣列原樣回；
// 讀取 inline 直接回、packed 解回並驗雜湊、兩者都沒有回 null。超過 codec 上限的陣列維持 inline（是 codec 限制，不是保留上限）。
function packRows(record,field,blobField) {
 if(!record||typeof record!=='object'||!Array.isArray(record[field])||record[blobField])return record;
 const raw=Buffer.from(JSON.stringify(record[field]),'utf8');
 if(raw.length>BENCHMARK_EVIDENCE_MAX_BYTES)return record;
 const packed={...record,[blobField]:{version:1,codec:'deflate-base64',rows:record[field].length,rawBytes:raw.length,sha256:hash(raw),data:deflateSync(raw).toString('base64')}};
 delete packed[field];
 return packed;
}
function readRows(record,field,blobField,invalid) {
 if(!record||typeof record!=='object')return null;
 if(Array.isArray(record[field]))return record[field];
 const b=record[blobField];
 if(!b)return null;
 if(!validBlobShape(b)||!Number.isSafeInteger(b.rows)||b.rows<0)throw invalid();
 let decoded;
 try{decoded=inflateBlob(b);}catch{throw invalid();}
 if(!Array.isArray(decoded)||decoded.length!==b.rows)throw invalid();
 return decoded;
}
export function packCaptureOutcomes(manifest) {return packRows(manifest,'outcomes','outcomesBlob');}
// 回 outcomes 陣列；inline 直接回、packed 解回並驗雜湊、兩者都沒有回 null（舊 manifest 本來就沒有證據）。
export function readCaptureOutcomes(manifest) {return readRows(manifest,'outcomes','outcomesBlob',outcomesInvalid);}

// 2026-09-16：候選池（candidates，每策略每天 ≈15 KB）與發布紀錄的正式訊號（signals，≈58 KB）也壓成 blob。
// 兩者都有執行期讀取端（候選池基準 worker、交易計畫來源比對、時間補證），所以一律走這裡的 read／write helper；
// inline 舊資料照讀。發布紀錄另存 signalCount（維運狀態只要數量，不必解壓）。
const candidatesInvalid=()=>Object.assign(new Error('擷取清單的候選池證據無法解碼；請保留原始備份並檢查資料完整性。'),{code:'CAPTURE_EVIDENCE_INVALID'});
const signalsInvalid=()=>Object.assign(new Error('發布紀錄的訊號清單無法解碼；請保留原始備份並檢查資料完整性。'),{code:'PUBLICATION_EVIDENCE_INVALID'});
export function packCaptureCandidates(manifest) {return packRows(manifest,'candidates','candidatesBlob');}
export function readCaptureCandidates(manifest) {return readRows(manifest,'candidates','candidatesBlob',candidatesInvalid);}
export function hasCaptureCandidates(manifest) {return Boolean(manifest)&&(Array.isArray(manifest.candidates)||Boolean(manifest.candidatesBlob));}
export function packPublicationSignals(capture) {
 const packed=packRows(capture,'signals','signalsBlob');
 if(packed!==capture)packed.signalCount=capture.signals.length;
 return packed;
}
export function readPublicationSignals(capture) {return readRows(capture,'signals','signalsBlob',signalsInvalid);}
// 就地換掉訊號清單（時間補證用）：capture 是 commitDbMutation 的 draft 物件；超過 codec 上限時退回 inline。
export function writePublicationSignals(capture,signals) {
 const packed=packRows({signals},'signals','signalsBlob');
 if(packed.signalsBlob){capture.signalsBlob=packed.signalsBlob;delete capture.signals;}
 else{capture.signals=signals;delete capture.signalsBlob;}
 capture.signalCount=signals.length;
 return capture;
}
export function publicationSignalCount(capture) {
 if(!capture||typeof capture!=='object')return null;
 if(Array.isArray(capture.signals))return capture.signals.length;
 if(Number.isSafeInteger(capture.signalsBlob?.rows))return capture.signalsBlob.rows;
 return Number.isSafeInteger(capture.signalCount)?capture.signalCount:null;
}
// 給 API／呼叫端看的發布紀錄：signals inline、不帶 blob 與 signalCount（形狀與 2026-09-16 以前完全相同）。
export function unpackPublicationView(capture) {
 if(!capture||typeof capture!=='object')return capture;
 const {signalsBlob,signalCount,...rest}=capture;
 return {...rest,signals:readPublicationSignals(capture)||[]};
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
