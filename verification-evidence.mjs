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
