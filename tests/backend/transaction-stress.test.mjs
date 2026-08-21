// Transaction queue 的並發不變量：大量同時提交也不得 lost update、不得被失敗污染。
//
// 既有測試都是「兩三筆精心編排的競態」（transaction-queue-tail、api-persistence-rollback、
// trades-concurrent-provenance），證明的是特定劇本。這支補的是**量**：一次丟數百筆同時提交，
// 讓「read-modify-write 之間有 await」這個 lost update 窗口有機會真的被撞開。
//
// 刻意不用 sleep 當同步手段——時間不是正確性證明。這裡靠的是：所有 operation 在同一個
// tick 同時建立，之後由 queue 自己決定順序，而不變量必須與順序無關。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-tx-stress-"));
const { mod } = await importServer({ routes: [], dataDir });

const CONCURRENT_OPS = 200;
const FAILS_EVERY = 7; // index % 7 === 6 的那些故意丟業務錯誤

test("數百筆同時提交：不 lost update、失敗不污染、磁碟與記憶體一致", async () => {
  await mod.loadDb();
  const epochBefore = mod.getDbMutationEpochForTest();

  const expectedFailures = [];
  const expectedSuccesses = [];
  for (let index = 0; index < CONCURRENT_OPS; index += 1) {
    (index % FAILS_EVERY === FAILS_EVERY - 1 ? expectedFailures : expectedSuccesses).push(index);
  }

  // 全部在同一個 tick 建立，不 await 前一筆。
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENT_OPS }, (_, index) => mod.commitDbMutation(async (draft) => {
      draft.companyProfiles ||= {};
      const counter = (draft.companyProfiles.__stress ||= { count: 0, seen: [] });
      if (index % FAILS_EVERY === FAILS_EVERY - 1) {
        throw Object.assign(new Error(`業務錯誤 ${index}`), { status: 400 });
      }
      // read → await → write：queue 若沒有真的序列化，這裡就是 lost update 的窗口。
      const next = counter.count + 1;
      await Promise.resolve();
      await Promise.resolve();
      counter.count = next;
      counter.seen.push(index);
    })),
  );

  const fulfilled = results.filter((entry) => entry.status === "fulfilled");
  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, expectedSuccesses.length, "成功筆數必須完全符合預期");
  assert.equal(rejected.length, expectedFailures.length);

  // 業務錯誤只能是業務錯誤：不可以因為併發而退化成 PERSISTENCE_FAILED。
  for (const entry of rejected) {
    assert.equal(entry.reason?.status, 400, `非預期的失敗：${entry.reason?.message}`);
    assert.notEqual(entry.reason?.code, "PERSISTENCE_FAILED");
  }

  const db = await mod.loadDb();
  const stress = db.companyProfiles.__stress;
  assert.equal(stress.count, expectedSuccesses.length, "計數器必須等於成功筆數（沒有任何一筆被蓋掉）");
  assert.equal(stress.seen.length, expectedSuccesses.length, "沒有重複提交，也沒有漏掉的");
  assert.deepEqual(
    [...stress.seen].sort((a, b) => a - b),
    expectedSuccesses,
    "每一筆成功的 mutation 都要留下痕跡，失敗的一個都不能留",
  );

  // epoch 每次 saveDb 嘗試遞增一次；業務錯誤在 saveDb 之前就丟出，所以不該貢獻。
  assert.equal(
    mod.getDbMutationEpochForTest() - epochBefore,
    expectedSuccesses.length,
    "失敗的 mutation 不得觸發落盤，也就不該推進 epoch",
  );

  // read-after-write：記憶體與磁碟必須是同一個版本。
  const onDisk = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.deepEqual(onDisk.companyProfiles.__stress, stress, "落盤內容必須等於已發布的記憶體版本");

  // queue tail 沒有被前面 34 筆 rejection 弄壞。
  const after = await mod.commitDbMutation(async (draft) => {
    draft.companyProfiles.__stress.finalized = true;
    return { ok: true };
  });
  assert.deepEqual(after, { ok: true });
  assert.equal((await mod.loadDb()).companyProfiles.__stress.finalized, true);
});

test("同時提交的 rev bump 不得互相覆蓋（每一筆都要看到前一筆的結果）", async () => {
  // watchLists 的 rev 是「整包 PUT」的蓋寫防護，也是最容易被併發打壞的東西。
  const db = await mod.loadDb();
  const userId = db.users[0].id;
  const observed = [];

  const operations = Array.from({ length: 120 }, () => mod.commitDbMutation(async (draft) => {
    draft.dataRevs ||= {};
    const bucket = (draft.dataRevs[userId] ||= {});
    const current = Number(bucket.stressRev || 0);
    await Promise.resolve();
    bucket.stressRev = current + 1;
    observed.push(current);
  }));
  await Promise.all(operations);

  const finalRev = Number((await mod.loadDb()).dataRevs[userId].stressRev);
  assert.equal(finalRev, 120, `rev 必須嚴格遞增到 120，實際 ${finalRev}`);
  // 每一筆讀到的起始值都必須互不相同且連續——有重複就代表兩筆看到同一個版本。
  assert.deepEqual(
    [...observed].sort((a, b) => a - b),
    Array.from({ length: 120 }, (_, index) => index),
    "任何兩筆都不得從同一個 rev 出發",
  );
});
