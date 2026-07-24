// Auth TOCTOU：請求讀 body 期間 session 被重設，不得使用入口時的舊 auth 建立帳號。
import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { bootServer } from "../helpers/test-server.mjs";

async function readJson(response) {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

function beginDelayedJsonRequest(baseUrl, path, { cookie, payload }) {
  const serialized = JSON.stringify(payload);
  const splitAt = Math.max(1, Math.floor(serialized.length / 2));
  let readyResolve;
  let readyReject;
  let responseResolve;
  let responseReject;
  let continued = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const response = new Promise((resolve, reject) => {
    responseResolve = resolve;
    responseReject = reject;
  });
  const req = httpRequest(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      expect: "100-continue",
      // 未指定 content-length，Node 會用 Transfer-Encoding: chunked。
    },
  });
  req.once("continue", () => {
    continued = true;
    req.write(serialized.slice(0, splitAt));
    // 100 Continue 代表伺服器已解析標頭；再讓 handler 完成 auth 並停在 body iterator。
    setTimeout(readyResolve, 30);
  });
  req.once("response", (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.once("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!continued) readyReject(new Error(`server responded before 100-continue (${res.statusCode})`));
      responseResolve({
        status: res.statusCode,
        body: text ? JSON.parse(text) : {},
      });
    });
  });
  req.once("error", (error) => {
    readyReject(error);
    responseReject(error);
  });
  req.flushHeaders();

  return {
    ready,
    finish: () => req.end(serialized.slice(splitAt)),
    response,
    abort: () => req.destroy(),
  };
}

test("admin request 延遲 body 時 session 被重設，補完 body 後必須 401 且 DB 無 orphan", async () => {
  const srv = await bootServer();
  let delayed;
  try {
    const created = await readJson(await srv.api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "delayed-admin",
        password: "delayed-admin-old",
        displayName: "Delayed Admin",
        role: "admin",
      }),
    }));
    assert.equal(created.status, 201);

    const loginResponse = await srv.raw("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "delayed-admin", password: "delayed-admin-old" }),
    });
    assert.equal(loginResponse.status, 200);
    await loginResponse.text();
    const delayedCookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];
    assert.match(delayedCookie, /^sid=/);

    const orphanUsername = "must-not-exist";
    const beforeDb = await srv.mod.loadDb();
    const beforeUserIds = beforeDb.users.map((user) => user.id).sort();
    const beforeWatchListIds = Object.keys(beforeDb.watchLists || {}).sort();
    delayed = beginDelayedJsonRequest(srv.baseUrl, "/api/admin/users", {
      cookie: delayedCookie,
      payload: {
        username: orphanUsername,
        password: "orphan-password",
        displayName: "Must Not Exist",
        role: "user",
      },
    });
    await delayed.ready;

    const reset = await readJson(await srv.api("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: created.body.user.id, password: "delayed-admin-new" }),
    }));
    assert.equal(reset.status, 200);

    delayed.finish();
    const lateResult = await delayed.response;
    assert.equal(lateResult.status, 401, JSON.stringify(lateResult.body));
    assert.equal(lateResult.body.code, "AUTH_REQUIRED");

    const db = await srv.mod.loadDb();
    assert.equal(db.users.some((user) => user.username === orphanUsername), false);
    assert.deepEqual(db.users.map((user) => user.id).sort(), beforeUserIds, "失效請求不得留下 user row");
    assert.deepEqual(Object.keys(db.watchLists || {}).sort(), beforeWatchListIds, "失效請求不得留下個資容器");
  } finally {
    delayed?.abort();
    await srv.close();
  }
});
