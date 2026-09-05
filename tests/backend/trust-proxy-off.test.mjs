// TRUST_PROXY 未開：x-forwarded-for 一律不採信，來源限流以 socket 位址計——帶 header 也繞不過。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
before(async () => {
  delete process.env.TRUST_PROXY;
  srv = await bootServer({ routes: [] });
});
after(async () => { await srv.close(); });

test("帶各種 x-forwarded-for 的 51 次錯密碼仍以 socket 位址計次 → 第 51 次 429", async () => {
  const limit = srv.mod.ADDRESS_FAIL_LIMIT;
  const attempt = (i) => srv.raw("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.${Math.floor(i / 250)}.${i % 250}` },
    body: JSON.stringify({ username: `ghost-${i}`, password: "wrong-password" }),
  });
  for (let i = 0; i < limit; i += 1) assert.notEqual((await attempt(i)).status, 429, `第 ${i + 1} 次不該被鎖`);
  assert.equal((await attempt(limit)).status, 429);
  assert.equal(srv.mod.forwardedClientAddress({ "x-forwarded-for": "1.2.3.4" }, "127.0.0.1"), "127.0.0.1", "預設模式 off");
});
