// API 持久化失敗：回 503，完整回滾 RAM／rev，且下一筆成功寫入不得夾帶失敗資料。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
let blockerPath;
let blockerActive = false;

before(async () => {
  srv = await bootServer({ routes: [] });
  blockerPath = join(srv.dataDir, "stock1-db.json.tmp");
});

after(async () => {
  if (!srv) return;
  try {
    if (blockerActive) {
      await rm(blockerPath, { recursive: true, force: true });
      blockerActive = false;
    }
  } finally {
    await srv.close();
  }
});

function clone(value) {
  return structuredClone(value);
}

async function expectPersistenceRollback(label, request, select) {
  const beforeState = clone(select(await srv.mod.loadDb()));
  const beforeEpoch = srv.mod.getDbMutationEpochForTest();
  const response = await request();
  const body = await response.json();
  assert.equal(response.status, 503, `${label}: ${JSON.stringify(body)}`);
  assert.equal(body.code, "PERSISTENCE_FAILED", label);
  assert.match(body.error, /無法安全儲存/, label);
  const afterState = clone(select(await srv.mod.loadDb()));
  assert.deepEqual(afterState, beforeState, `${label}: RAM 與 rev 必須完整回滾`);
  assert.equal(
    srv.mod.getDbMutationEpochForTest(),
    beforeEpoch + 1,
    `${label}: 失敗寫入只應讓舊預覽保守失效一次`,
  );
}

test("各類 DB mutation 在 atomic write 失敗時皆 fail-closed 並可恢復", async (t) => {
  let releaseQueuedA;
  let releaseQueuedB;
  t.after(() => {
    releaseQueuedA?.();
    releaseQueuedB?.();
  });
  const dbBeforeSetup = await srv.mod.loadDb();
  const adminId = dbBeforeSetup.users.find((user) => user.username === "admin").id;

  const seedNoteResponse = await srv.api("/api/notes", {
    method: "POST",
    body: JSON.stringify({ code: "2330", text: "保留用基準備註" }),
  });
  assert.equal(seedNoteResponse.status, 201);
  const seedNote = (await seedNoteResponse.json()).notes.at(-1);

  const secondaryResponse = await srv.api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ username: "rollback_user", password: "password-123", displayName: "回滾帳號" }),
  });
  assert.equal(secondaryResponse.status, 201);
  const secondary = (await secondaryResponse.json()).user;

  const baselineDisk = JSON.parse(await readFile(join(srv.dataDir, "stock1-db.json"), "utf8"));
  await mkdir(blockerPath);
  blockerActive = true;

  const watchBefore = await (await srv.api("/api/watchlists")).json();
  await expectPersistenceRollback(
    "watchlists",
    () => srv.api("/api/watchlists", {
      method: "PUT",
      body: JSON.stringify({ rev: watchBefore.rev, lists: { ...watchBefore.lists, 1: ["2454"] } }),
    }),
    (db) => ({ value: db.watchLists[adminId], rev: db.dataRevs?.[adminId]?.watchLists || 0 }),
  );

  const alertsBefore = await (await srv.api("/api/alerts")).json();
  await expectPersistenceRollback(
    "alerts",
    () => srv.api("/api/alerts", {
      method: "PUT",
      body: JSON.stringify({
        rev: alertsBefore.rev,
        alerts: [{ id: "rollback-alert", code: "2330", op: ">=", price: 999, note: "不應留存" }],
      }),
    }),
    (db) => ({ value: db.priceAlerts[adminId] || [], rev: db.dataRevs?.[adminId]?.alerts || 0 }),
  );

  const tradesBefore = await (await srv.api("/api/trades")).json();
  await expectPersistenceRollback(
    "trades",
    () => srv.api("/api/trades", {
      method: "PUT",
      body: JSON.stringify({
        schemaVersion: 2,
        rev: tradesBefore.rev,
        settings: { ...tradesBefore.settings, feeDiscount: 0.55 },
        records: tradesBefore.records,
      }),
    }),
    (db) => ({ value: db.trades[adminId], rev: db.dataRevs?.[adminId]?.trades || 0 }),
  );

  await expectPersistenceRollback(
    "notes POST",
    () => srv.api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ code: "2330", text: "不應留在 RAM" }),
    }),
    (db) => ({ value: db.stockNotes["2330"], rev: db.sharedRevs?.stockNotes || 0 }),
  );

  await expectPersistenceRollback(
    "notes DELETE",
    () => srv.api(`/api/notes?code=2330&id=${encodeURIComponent(seedNote.id)}`, { method: "DELETE" }),
    (db) => ({ value: db.stockNotes["2330"], rev: db.sharedRevs?.stockNotes || 0 }),
  );

  await expectPersistenceRollback(
    "company profile",
    () => srv.api("/api/company", {
      method: "PUT",
      body: JSON.stringify({ code: "2330", summary: "不應留在 RAM 的公司簡介" }),
    }),
    (db) => ({ profiles: db.companyProfiles, dataRevs: db.dataRevs, sharedRevs: db.sharedRevs }),
  );

  await expectPersistenceRollback(
    "login session",
    () => srv.raw("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-admin-pw" }),
    }),
    (db) => db.sessions,
  );

  await expectPersistenceRollback(
    "logout session",
    () => srv.api("/api/auth/logout", { method: "POST", body: "{}" }),
    (db) => db.sessions,
  );

  await expectPersistenceRollback(
    "password change",
    () => srv.api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "test-admin-pw", newPassword: "changed-password-123" }),
    }),
    (db) => ({ users: db.users, sessions: db.sessions }),
  );

  await expectPersistenceRollback(
    "admin create",
    () => srv.api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "must_not_exist", password: "password-123", displayName: "不應建立" }),
    }),
    (db) => ({ users: db.users, watchLists: db.watchLists }),
  );

  await expectPersistenceRollback(
    "admin delete",
    () => srv.api(`/api/admin/users?id=${encodeURIComponent(secondary.id)}`, { method: "DELETE" }),
    (db) => ({
      users: db.users,
      sessions: db.sessions,
      watchLists: db.watchLists,
      priceAlerts: db.priceAlerts,
      trades: db.trades,
      brokerCredentials: db.brokerCredentials,
      dataRevs: db.dataRevs,
      stockNotes: db.stockNotes,
      sharedRevs: db.sharedRevs,
    }),
  );

  await expectPersistenceRollback(
    "broker credentials",
    () => srv.api("/api/broker/settings", {
      method: "POST",
      body: JSON.stringify({
        provider: "fubon",
        personalId: "A123456789",
        password: "broker-password",
        certPath: "C:\\missing\\cert.pfx",
        certPassword: "cert-password",
      }),
    }),
    (db) => db.brokerCredentials,
  );

  const diskAfterFailures = JSON.parse(await readFile(join(srv.dataDir, "stock1-db.json"), "utf8"));
  assert.deepEqual(diskAfterFailures, baselineDisk, "所有失敗 mutation 都不得碰主 DB 檔");

  // 真正的 queue race：A 已改草稿但尚未落盤時，GET 仍只能看舊版；B 必須等 A 結束，
  // 且 A 落盤失敗後，B 要從最後一個已提交版本開始，不能夾帶 A 的內容。
  let markAStarted;
  const aStarted = new Promise((resolve) => { markAStarted = resolve; });
  const aGate = new Promise((resolve) => { releaseQueuedA = resolve; });
  const failedA = srv.mod.commitDbMutation(async (draft) => {
    draft.companyProfiles ||= {};
    draft.companyProfiles.RACE_A = { summary: "未提交的 A" };
    markAStarted();
    await aGate;
  });
  void failedA.catch(() => {});
  await aStarted;
  assert.equal((await srv.mod.loadDb()).companyProfiles?.RACE_A, undefined, "A pending 時不得發布草稿");

  let markBStarted;
  let bHasStarted = false;
  const bStarted = new Promise((resolve) => { markBStarted = resolve; });
  const bGate = new Promise((resolve) => { releaseQueuedB = resolve; });
  const successfulB = srv.mod.commitDbMutation(async (draft) => {
    bHasStarted = true;
    draft.companyProfiles ||= {};
    draft.companyProfiles.RACE_B = { summary: "已提交的 B" };
    markBStarted();
    await bGate;
  });
  void successfulB.catch(() => {});
  await Promise.resolve();
  assert.equal(bHasStarted, false, "B 必須在 transaction queue 等待 A");

  releaseQueuedA();
  await assert.rejects(failedA, (error) => error?.code === "PERSISTENCE_FAILED");
  await bStarted;
  assert.equal((await srv.mod.loadDb()).companyProfiles?.RACE_A, undefined);
  assert.equal((await srv.mod.loadDb()).companyProfiles?.RACE_B, undefined, "B 落盤前也不得發布草稿");

  await rm(blockerPath, { recursive: true, force: true });
  blockerActive = false;
  releaseQueuedB();
  await successfulB;
  assert.equal((await srv.mod.loadDb()).companyProfiles?.RACE_A, undefined);
  assert.equal((await srv.mod.loadDb()).companyProfiles?.RACE_B?.summary, "已提交的 B");

  const currentWatch = await (await srv.api("/api/watchlists")).json();
  const recovered = await srv.api("/api/watchlists", {
    method: "PUT",
    body: JSON.stringify({ rev: currentWatch.rev, lists: { ...currentWatch.lists, 1: ["2317"] } }),
  });
  assert.equal(recovered.status, 200, await recovered.text());

  const persisted = JSON.parse(await readFile(join(srv.dataDir, "stock1-db.json"), "utf8"));
  assert.deepEqual(persisted.watchLists[adminId]["1"], ["2317"]);
  assert.equal(persisted.users.some((user) => user.username === "must_not_exist"), false);
  assert.deepEqual(persisted.priceAlerts[adminId] || [], []);
  assert.equal(persisted.companyProfiles?.["2330"], undefined);
  assert.equal(persisted.companyProfiles?.RACE_A, undefined);
  assert.equal(persisted.companyProfiles?.RACE_B?.summary, "已提交的 B");
  assert.equal(persisted.brokerCredentials?.[adminId], undefined);
  assert.equal(persisted.stockNotes["2330"].some((note) => note.text === "不應留在 RAM"), false);
});
