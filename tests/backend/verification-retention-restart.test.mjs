// 合成歷史經真實備份 script／每日備份還原到新目錄後，以獨立子程序重啟驗內容指紋。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compactTradingDay } from "../helpers/fixtures.mjs";

function run(script, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child=spawn(process.execPath,[resolve(script),...args],{env:{...process.env,PORT:"0",...env},stdio:["ignore","pipe","pipe"]});
    let out="",err="";
    child.stdout.on("data",c=>out+=c); child.stderr.on("data",c=>err+=c);
    child.on("error",reject); child.on("close",code=>resolveRun({code,out,err}));
  });
}
test("1040 日歷史的 load/save、每日與異地備份、還原後獨立程序重啟皆保留同一證據指紋", async () => {
  const root=await mkdtemp(join(tmpdir(),"stock1-retention-restart-"));
  try {
    const source=join(root,"source"), backup=join(root,"backup"), restored=join(root,"restored"), dailyRestored=join(root,"daily-restored");
    for(const dir of [source,backup,restored,dailyRestored])await mkdir(dir);
    const evidence={signalSnapshots:[],swingVerification:{},swingVerificationRetry:{historicalCursor:"2330:TWSE:202001",recentCursor:"1101:TWSE:recent"}};
    for(let i=1040;i>0;i--){
      const day=compactTradingDay(-i);
      evidence.signalSnapshots.push({asOf:day,formulaVersion:i%2?"old-v1":"current-fixture",picks:[{code:"2330",price:100}],
        observed:{status:"final",complete:true,formulaVersion:i%2?"old-v1":"current-fixture",rows:[]}});
      evidence.swingVerification[day]=[
        {code:"2330",status:"pending",lastChecked:day,daysHeld:0,formulaVersion:"old-v1",verificationRetry:{from:day,through:day,reason:"market-unknown",nextRetryAt:Date.now()+300000}},
        {code:"1101",status:"pending",lastChecked:day,daysHeld:0,formulaVersion:"current-fixture",corporateActionPending:{from:day,reason:"官方公告"}},
        {code:"2454",status:"win",lastChecked:day,resolvedAt:day,resultPct:10,formulaVersion:"current-fixture"},
      ];
    }
    const fingerprint=createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    const db={users:[{id:"u1",username:"keeper",displayName:"合成",role:"user",passwordHash:"x",passwordSource:"user-set"}],sessions:[],watchLists:{},...evidence};
    await writeFile(join(source,"stock1-db.json"),JSON.stringify(db));
    const restart=async dir=>{
      const result=await run("tests/helpers/verification-retention-child.mjs",[dir]);
      assert.equal(result.code,0,result.out+result.err);
      const line=result.out.split(/\r?\n/).find(line=>line.startsWith("RETENTION_RESULT:"));
      assert.ok(line,result.out+result.err);
      const actual=JSON.parse(line.slice("RETENTION_RESULT:".length));
      assert.equal(actual.fingerprint,fingerprint); assert.equal(actual.diskFingerprint,fingerprint);
      assert.equal(actual.snapshots,1040); assert.equal(actual.swingDays,1040); assert.equal(actual.pending,2080);
      assert.deepEqual(actual.retry,evidence.swingVerificationRetry);
      assert.notEqual(actual.port,5174); assert.ok(actual.port>0); assert.equal(actual.upstreamRequests,0);
      return actual;
    };
    await restart(source);
    await restart(source); // 同一 DB 新行程真正重啟，非 module cache 模擬。
    const daily=(await readdir(join(source,"backups"))).find(n=>/^stock1-db-\d{8}\.json$/.test(n));
    assert.ok(daily);
    await copyFile(join(source,"backups",daily),join(dailyRestored,"stock1-db.json"));
    await restart(dailyRestored);
    const result=await run("scripts/backup.mjs",[backup],{DATA_DIR:source,DB_PATH:join(source,"stock1-db.json"),STOCK1_ENV_FILE:join(root,"absent.env"),APP_SECRET:"synthetic-retention-backup-secret-32-chars"});
    assert.equal(result.code,0,result.out+result.err);
    const [folder]=await readdir(backup);
    const copy=join(backup,folder,"stock1-db.json");
    assert.ok((await readFile(copy)).length>0);
    await copyFile(copy,join(restored,"stock1-db.json"));
    await restart(restored);
  } finally { await rm(root,{recursive:true,force:true}); }
});
