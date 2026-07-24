// Runtime transaction 失敗隔離：一般 business 4xx 不得污染 queue tail 或卡住關機。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";

async function readJson(response) {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

async function within(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("duplicate admin 的 400 不污染 mutation queue，後續寫入與 shutdown 都能完成", async () => {
  const srv = await bootServer();
  const blockerPath = join(srv.dataDir, "stock1-db.json.tmp");
  const dbPath = join(srv.dataDir, "stock1-db.json");
  let blockerActive = false;
  try {
    const baselineRam = JSON.stringify(await srv.mod.loadDb());
    const baselineDisk = await readFile(dbPath, "utf8");
    const baselineEpoch = srv.mod.getDbMutationEpochForTest();
    await assert.rejects(
      srv.mod.commitDbMutation((draft) => {
        draft.companyProfiles.DIRTY_SKIP = { summary: "不可外洩" };
        return srv.mod.skipDbMutation("wrongly skipped");
      }),
      (error) => error?.code === "DB_MUTATION_SKIP_DIRTY",
    );
    assert.equal(JSON.stringify(await srv.mod.loadDb()), baselineRam, "dirty skip 不得發布 RAM draft");
    assert.equal(await readFile(dbPath, "utf8"), baselineDisk, "dirty skip 不得寫入磁碟");
    assert.equal(srv.mod.getDbMutationEpochForTest(), baselineEpoch, "未嘗試 save 不得 bump epoch");

    const first = await readJson(await srv.api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "queue-tail-user",
        password: "queue-tail-password",
        displayName: "Queue Tail User",
        role: "user",
      }),
    }));
    assert.equal(first.status, 201);

    const duplicate = await readJson(await srv.api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "queue-tail-user",
        password: "another-password",
        displayName: "Duplicate",
        role: "user",
      }),
    }));
    assert.equal(duplicate.status, 400, JSON.stringify(duplicate.body));

    const afterFailure = await readJson(await srv.api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "queue-tail-recovered",
        password: "recovered-password",
        displayName: "Recovered",
        role: "user",
      }),
    }));
    assert.equal(afterFailure.status, 201, "rejected transaction 後的下一筆 mutation 仍須成功");

    const current = await readJson(await srv.api("/api/watchlists"));
    assert.equal(current.status, 200);
    await mkdir(blockerPath);
    blockerActive = true;
    const failedSave = await readJson(await srv.api("/api/watchlists", {
      method: "PUT",
      body: JSON.stringify({
        rev: current.body.rev,
        lists: { ...current.body.lists, 1: ["2454"] },
      }),
    }));
    assert.equal(failedSave.status, 503, JSON.stringify(failedSave.body));
    assert.equal(failedSave.body.code, "PERSISTENCE_FAILED");
    await rm(blockerPath, { recursive: true, force: true });
    blockerActive = false;

    await within(
      srv.mod.shutdownServer({ reason: "test-business-4xx-queue-tail" }),
      2_000,
      "shutdownServer",
    );
  } finally {
    if (blockerActive) await rm(blockerPath, { recursive: true, force: true }).catch(() => {});
    await srv.close();
  }
});
