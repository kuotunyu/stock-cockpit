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
