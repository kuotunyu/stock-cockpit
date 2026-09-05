// TRUST_PROXY=on：來源位址要取 x-forwarded-for「最右邊的可信跳點」。代理是附加不是取代——
// 攻擊者自填 X-Forwarded-For: 10.0.0.1，代理送來的是「10.0.0.1, 真實IP」，取第一段等於讓攻擊者決定限流鍵。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

process.env.TRUST_PROXY = "on";
let srv;
before(async () => {
  srv = await bootServer({ routes: [] });
});
after(async () => {
  await srv.close();
  delete process.env.TRUST_PROXY;
});

const attempt = (forwardedFor, i) => srv.raw("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
  body: JSON.stringify({ username: `ghost-${i}-${Math.random().toString(36).slice(2, 8)}`, password: "wrong-password" }),
});

test("forwardedClientAddress（純函式）：最右跳點、hops、清單短於 hops 取最左、cloudflare 模式優先 cf-connecting-ip、off 模式只看 socket", () => {
  const f = srv.mod.forwardedClientAddress;
  assert.equal(f({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }, "127.0.0.1", { mode: "on", hops: 1 }), "203.0.113.9");
  assert.equal(f({ "x-forwarded-for": "10.0.0.1, 203.0.113.9, 198.51.100.2" }, "127.0.0.1", { mode: "on", hops: 2 }), "203.0.113.9", "兩層可信代理：倒數第二段");
  assert.equal(f({ "x-forwarded-for": "203.0.113.9" }, "127.0.0.1", { mode: "on", hops: 3 }), "203.0.113.9", "清單比跳點數短：取最左（能拿到的最外層）");
  assert.equal(f({}, "127.0.0.1", { mode: "on", hops: 1 }), "127.0.0.1", "沒有 header 退回 socket");
  assert.equal(f({ "cf-connecting-ip": "203.0.113.77", "x-forwarded-for": "10.0.0.1, 203.0.113.9" }, "127.0.0.1", { mode: "cloudflare", hops: 1 }), "203.0.113.77");
  assert.equal(f({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }, "127.0.0.1", { mode: "cloudflare", hops: 1 }), "203.0.113.9", "cloudflare 模式沒有 cf 標頭時退回 XFF 最右");
  assert.equal(f({ "x-forwarded-for": "10.0.0.1" }, "127.0.0.1", { mode: "off", hops: 1 }), "127.0.0.1");
});

test("每次換一個最左段（攻擊者自填）不能繞過來源限流：第 51 次 429；換最右段（真實來源）才是另一把鍵", async () => {
  const limit = srv.mod.ADDRESS_FAIL_LIMIT;
  for (let i = 0; i < limit; i += 1) {
    const res = await attempt(`10.0.${Math.floor(i / 250)}.${i % 250}, 203.0.113.9`, i);
    assert.notEqual(res.status, 429, `第 ${i + 1} 次不該被鎖`);
  }
  const blocked = await attempt("10.9.9.9, 203.0.113.9", limit);
  assert.equal(blocked.status, 429, "同一個真實來源第 51 次要 429");
  const other = await attempt("10.9.9.9, 198.51.100.7", limit + 1);
  assert.notEqual(other.status, 429, "不同的真實來源不受影響");
});
