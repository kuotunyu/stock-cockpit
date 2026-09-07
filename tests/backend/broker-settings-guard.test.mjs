// 券商憑證：certPath 只接受 .data/certs/ 內的檔案，DB 只存檔名。
// 任意路徑是本機檔案存在 oracle（existsSync 對任何路徑回答有沒有），Windows 上指 UNC 還會讓伺服器對外發 SMB。
// 全離線，不碰真實富邦 SDK。模組層的 dataDir 在第一次 import 時定案，所以每個檔只 boot 一次。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";

const payload = (certPath) => JSON.stringify({ personalId: "A123456789", password: "pw", certPath, certPassword: "cp" });

let srv;
before(async () => {
  srv = await bootServer({ routes: [] });
});
after(async () => {
  await srv.close();
});

test("certPath 只接受 certs 目錄內的檔案，DB 只存檔名", async () => {
  const absent = await srv.api('/api/broker/settings', {method:'POST',body:payload('missing.pfx')});
  assert.equal(absent.status,400);const absentBody=await absent.json();
  assert.equal(absentBody.code,'BROKER_CERT_PATH_INVALID');assert.equal(absentBody.error.includes(srv.dataDir),false);
  assert.match(absentBody.error,/certs/);
  const certs = join(srv.dataDir, "certs");
  await mkdir(certs, { recursive: true });
  await writeFile(join(certs, "me.pfx"), "x");
  await writeFile(join(srv.dataDir, "outside.pfx"), "x");
  const bad = [
    "\\\\evil\\share\\a.pfx",
    "//evil/share/a.pfx",
    "file:///etc/passwd",
    "C:\\Windows\\win.ini",
    "../outside.pfx",
    join(srv.dataDir, "outside.pfx"),
    "missing.pfx",
    "",
  ];
  for (const certPath of bad) {
    const res = await srv.api("/api/broker/settings", { method: "POST", body: payload(certPath) });
    assert.equal(res.status, 400, `${JSON.stringify(certPath)} 應 400`);
    const body = await res.json();
    assert.equal(body.code, "BROKER_CERT_PATH_INVALID", `${JSON.stringify(certPath)} 要帶 code，實際：${body.code} ${body.error}`);
    assert.equal(body.error.includes(srv.dataDir), false, '對外不回絕對資料路徑');
  }
  const status0 = await (await srv.api("/api/broker/settings")).json();
  assert.equal(status0.configured, false, "全部被擋 → 仍未設定");

  for (const certPath of ["me.pfx", join(certs, "me.pfx")]) {
    const res = await srv.api("/api/broker/settings", { method: "POST", body: payload(certPath) });
    assert.equal(res.status, 200, `${certPath} 應 200`);
    const body = await res.json();
    assert.equal(body.certPathExists, true);
    assert.equal(body.weakEncryption, false);
    assert.equal(body.certPathHint, "");
  }
  const db = await srv.mod.loadDb();
  const saved = Object.values(db.brokerCredentials)[0];
  const plain = srv.mod.decryptJson(saved.encrypted);
  assert.equal(plain.certPath, "me.pfx", "DB 只存檔名，不存路徑");
});

test('非預期API錯誤不洩漏路徑或秘密，內部保留安全診斷碼',async()=>{
  const db=await srv.mod.loadDb(),notes=db.stockNotes;
  const logs=[],original=console.error;
  console.error=(...args)=>logs.push(args);
  const fail=()=>{throw Object.assign(new Error('C:/private/account/cert.pfx password=synthetic-secret'),{code:'EACCES'});};
  db.stockNotes=new Proxy({}, {get:fail,ownKeys:fail});
  try {
    const response=await srv.api('/api/notes?code=2330&secret=synthetic-query-secret');const body=await response.json();
    assert.equal(response.status,500);assert.equal(body.code,'INTERNAL_ERROR');
    assert.match(body.error,/重試|稍後/);assert.doesNotMatch(JSON.stringify(body),/private|synthetic-secret|EACCES/);
    assert.equal(logs.length,1);assert.match(JSON.stringify(logs),/EACCES/);assert.doesNotMatch(JSON.stringify(logs),/private|synthetic-secret/);
    assert.equal(logs[0][1].operation,'GET /api/notes');
    assert.doesNotMatch(JSON.stringify(logs),/2330|synthetic-query-secret|\?/);
    const recent=await srv.api('/api/notes/recent?secret=synthetic-query-secret');await recent.json();
    assert.equal(recent.status,500);assert.equal(logs.length,2);
    assert.equal(logs[1][1].operation,'GET /api/notes/recent','不同失敗操作仍可區分');
    assert.doesNotMatch(JSON.stringify(logs),/2330|private|synthetic-secret|synthetic-query-secret|\?/);
  }finally{db.stockNotes=notes;console.error=original;}
});
