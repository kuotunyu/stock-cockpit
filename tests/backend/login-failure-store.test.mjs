import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

let srv;

before(async () => {
  srv = await bootServer({ routes: [] });
});

after(async () => {
  await srv.close();
});

async function login(username, password = "wrong-password") {
  const response = await srv.raw("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, body: await response.json() };
}

test("登入帳號先套用建帳格式；非法格式不占失敗追蹤且不洩漏帳號是否存在", async () => {
  srv.mod.resetLoginFailuresForTest();
  const invalidUsernames = ["ab", "a".repeat(33), "bad name", "使用者"];
  const replies = [];
  for (const username of invalidUsernames) replies.push(await login(username));

  assert.deepEqual(
    replies.map(({ status, body }) => ({ status, error: body.error })),
    invalidUsernames.map(() => ({ status: 401, error: "帳號或密碼錯誤" })),
    "非法格式與有效但不存在的帳號都只回傳通用認證失敗",
  );
  assert.equal(srv.mod.getLoginFailureSnapshotForTest().size, 0, "非法格式不得污染有界失敗追蹤");

  const unknown = await login("missing-user");
  assert.deepEqual(
    { status: unknown.status, error: unknown.body.error },
    { status: 401, error: "帳號或密碼錯誤" },
    "不存在帳號不得有可辨識的回應差異",
  );
  assert.equal(srv.mod.getLoginFailureSnapshotForTest().size, 1, "有效格式的失敗登入才進入追蹤");
});

test("登入失敗追蹤會清除過期項目，並以 LRU 限制最大容量", () => {
  srv.mod.resetLoginFailuresForTest();
  const start = 1_000_000;
  const capacity = srv.mod.LOGIN_FAILURE_MAX_ENTRIES;

  for (let index = 0; index < capacity; index += 1) {
    srv.mod.recordLoginFailure(`user-${String(index).padStart(5, "0")}`, start + index);
  }
  let snapshot = srv.mod.getLoginFailureSnapshotForTest();
  assert.equal(snapshot.size, capacity);

  const touched = snapshot.keys[0];
  const evictedNext = snapshot.keys[1];
  srv.mod.recordLoginFailure(touched, start + capacity);
  srv.mod.recordLoginFailure("new-user", start + capacity + 1);
  snapshot = srv.mod.getLoginFailureSnapshotForTest();
  assert.equal(snapshot.size, capacity, "容量不可無界成長");
  assert.ok(snapshot.keys.includes(touched), "近期使用項目要保留");
  assert.ok(!snapshot.keys.includes(evictedNext), "容量滿時淘汰最久未使用項目");

  srv.mod.pruneLoginFailures(start + capacity + srv.mod.LOGIN_FAIL_WINDOW_MS + 2);
  assert.equal(srv.mod.getLoginFailureSnapshotForTest().size, 0, "視窗外項目要主動清除");
});
