import test from "node:test";
import assert from "node:assert/strict";
import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-atomic-write-"));

const { mod } = await importServer({ routes: [], dataDir });

test("writeFileAtomic serializes writes and never follows a stale hard-linked temp", async (t) => {
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const targetPath = join(dataDir, "concurrent.json");
  const payloads = Array.from({ length: 32 }, (_, index) => `payload-${index}`);

  await assert.doesNotReject(() =>
    Promise.all(payloads.map((payload) => mod.writeFileAtomic(targetPath, payload)))
  );
  assert.equal(await readFile(targetPath, "utf8"), payloads.at(-1));

  const sentinelPath = join(dataDir, "sentinel.txt");
  const guardedTargetPath = join(dataDir, "guarded.json");
  await writeFile(sentinelPath, "must-not-change", "utf8");
  await link(sentinelPath, `${guardedTargetPath}.tmp`);
  await mod.writeFileAtomic(guardedTargetPath, "safe-payload");
  assert.equal(await readFile(sentinelPath, "utf8"), "must-not-change");
  assert.equal(await readFile(guardedTargetPath, "utf8"), "safe-payload");
});
