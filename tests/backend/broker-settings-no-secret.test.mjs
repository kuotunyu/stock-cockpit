// 券商憑證：沒設 APP_SECRET 時拒存——派生金鑰的 secret 與 salt 都在公開 repo 裡，存了等同明文。
// usingDefaultAppSecret 是模組層常數（import 時由環境變數定案），所以這個情境獨立一個行程。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";

const payload = (certPath) => JSON.stringify({ personalId: "A123456789", password: "pw", certPath, certPassword: "cp" });

test("沒有 APP_SECRET：POST /api/broker/settings 回 400 BROKER_SECRET_REQUIRED，DB 不落憑證，狀態揭露 weakEncryption", async () => {
  const srv = await bootServer({ routes: [], env: { APP_SECRET: undefined, ENCRYPTION_KEY: undefined } });
  try {
    await mkdir(join(srv.dataDir, "certs"), { recursive: true });
    await writeFile(join(srv.dataDir, "certs", "me.pfx"), "x");
    const res = await srv.api("/api/broker/settings", { method: "POST", body: payload("me.pfx") });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "BROKER_SECRET_REQUIRED");
    assert.ok(body.error.includes("npm run secret"), "錯誤訊息要教怎麼修");
    const status = await (await srv.api("/api/broker/settings")).json();
    assert.equal(status.configured, false);
    assert.equal(status.weakEncryption, true);
    const db = await srv.mod.loadDb();
    assert.equal(Object.keys(db.brokerCredentials || {}).length, 0, "DB 不得存下憑證");
  } finally {
    await srv.close();
  }
});
