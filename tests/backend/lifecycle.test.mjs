// 程序生命週期：health 契約、持久化排空與冪等安全關機。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

let srv;
let testDataDir;

before(async () => {
  testDataDir = await mkdtemp(join(tmpdir(), "stock1-lifecycle-test-"));
  srv = await importServer({ routes: [], dataDir: testDataDir });
});

after(async () => {
  try {
    if (srv?.mod.server.listening) await srv.mod.shutdownServer({ reason: "lifecycle-test-cleanup" });
    else await srv?.mod.flushPersistence();
  } finally {
    srv?.mock.restore();
    if (testDataDir) await rm(testDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("冷啟動尚在載入 DB 時立刻 shutdown，不得在關機完成後重新 listen", async () => {
  const starting = srv.mod.startServer(0, "127.0.0.1");
  const stopping = srv.mod.shutdownServer({ reason: "cold-start-race" });

  try {
    const [, stopped] = await Promise.allSettled([starting, stopping]);
    assert.equal(stopped.status, "fulfilled");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(srv.mod.server.listening, false);
    assert.equal(srv.mod.server.address(), null);
  } finally {
    // 紅燈版本會在 shutdown resolve 後才開始監聽；先硬關，避免失敗測試留下 handle。
    if (srv.mod.server.listening) {
      await new Promise((resolve) => srv.mod.server.close(() => resolve()));
    }
  }
});

test("無效 listen 參數不得殘留 error/listening listener，之後可乾淨重試", async () => {
  const errorListeners = srv.mod.server.listeners("error");
  const listeningListeners = srv.mod.server.listeners("listening");

  try {
    await assert.rejects(
      srv.mod.startServer(-1, "127.0.0.1"),
      (error) => error?.code === "ERR_SOCKET_BAD_PORT",
    );

    assert.equal(srv.mod.server.listening, false);
    assert.equal(srv.mod.server.listenerCount("error"), errorListeners.length);
    assert.equal(srv.mod.server.listenerCount("listening"), listeningListeners.length);
  } finally {
    // 紅燈版本會留下匿名 listener；清掉新增者，避免污染下一個 concurrent-start 契約。
    for (const listener of srv.mod.server.listeners("error")) {
      if (!errorListeners.includes(listener)) srv.mod.server.removeListener("error", listener);
    }
    for (const listener of srv.mod.server.listeners("listening")) {
      if (!listeningListeners.includes(listener)) srv.mod.server.removeListener("listening", listener);
    }
  }
});

test("concurrent start 共用同一個 in-flight Promise，且只建立一個 listener", async () => {
  const first = srv.mod.startServer(0, "127.0.0.1");
  const second = srv.mod.startServer(0, "127.0.0.1");
  const samePromise = first === second;
  const results = await Promise.allSettled([first, second]);

  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(srv.mod.server.listening, true);

  const address = srv.mod.server.address();
  assert.equal(typeof address, "object");
  srv.baseUrl = `http://127.0.0.1:${address.port}`;
  srv.raw = (path, init = {}) => srv.mock.realFetch(srv.baseUrl + path, init);
  assert.equal(samePromise, true, "同一輪 start 必須回傳完全相同的 Promise");
});

test("health：公開 GET 回版本、ready 與不洩漏路徑／帳號；錯誤 method 405", async () => {
  const response = await srv.raw("/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "ready");
  assert.match(body.version, /^\d+\.\d+\.\d+/);
  assert.equal(Number.isFinite(body.uptimeSeconds), true);
  assert.equal(typeof body.persistence?.pendingWrites, "number");
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /DATA_DIR|stock1-db|password|admin|\\Users\\|\/home\//i);

  const rejected = await srv.raw("/api/health", { method: "POST" });
  assert.equal(rejected.status, 405);
  await rejected.json();
});

test("flushPersistence 會等候未 await 的 atomic write", async () => {
  const target = join(srv.dataDir, "lifecycle-drain.txt");
  const pending = srv.mod.writeFileAtomic(target, "drained");
  await srv.mod.flushPersistence();
  assert.equal(await readFile(target, "utf8"), "drained");
  await pending;
});

test("shutdownServer 會排空持久化、關閉 listener，且重複呼叫安全", async () => {
  const target = join(srv.dataDir, "shutdown-drain.txt");
  void srv.mod.writeFileAtomic(target, "before-close");

  const first = srv.mod.shutdownServer({ reason: "test" });
  const second = srv.mod.shutdownServer({ reason: "test-again" });
  assert.equal(first, second, "同一輪關機應共用同一個 promise");
  await first;

  assert.equal(await readFile(target, "utf8"), "before-close");
  assert.equal(srv.mod.server.listening, false);
  await srv.mod.shutdownServer({ reason: "already-closed" });
});
