// 券商憑證：舊格式（DB 裡存絕對路徑）的既有設定不再跟著去讀（那正是檔案存在 oracle），
// 狀態回 certPathHint 要求重存；brokerCertFilePath 對檔名以外的值一律回 null。
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";

test("舊格式（絕對路徑）的既有憑證：不跟著讀，狀態回 certPathHint 要求重存", async () => {
  const srv = await bootServer({ routes: [] });
  try {
    const legacy = srv.mod.encryptJson({
      provider: "fubon",
      personalId: "A123456789",
      password: "pw",
      certPath: "C:\\fubon\\old.pfx",
      certPassword: "cp",
      apiKey: "",
      apiSecret: "",
    });
    await srv.mod.commitDbMutation((db) => {
      db.brokerCredentials ||= {};
      db.brokerCredentials[db.users[0].id] = { provider: "fubon", encrypted: legacy, updatedAt: "2026-01-01T00:00:00.000Z" };
    });
    const status = await (await srv.api("/api/broker/settings")).json();
    assert.equal(status.configured, true);
    assert.equal(status.certPathExists, false);
    assert.ok(status.certPathHint.includes("certs"), status.certPathHint);
    assert.equal(srv.mod.brokerCertFilePath({ certPath: "C:\\fubon\\old.pfx" }), null);
    assert.equal(srv.mod.brokerCertFilePath({ certPath: "sub/me.pfx" }), null);
    assert.equal(srv.mod.brokerCertFilePath({ certPath: "me.pfx" }), join(srv.dataDir, "certs", "me.pfx"));
  } finally {
    await srv.close();
  }
});
