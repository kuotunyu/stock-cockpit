import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbqueue-"));
const dbPath = join(dataDir, "blocked-target");
await mkdir(dbPath);

const { mod } = await importServer({ routes: [], dataDir, dbPath });

test("saveDb queue resumes after one atomic write failure", async (t) => {
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  await assert.rejects(() => mod.saveDb({ marker: "blocked" }));
  await rm(dbPath, { recursive: true, force: true });
  await assert.doesNotReject(() => mod.saveDb({ marker: "recovered" }));
  assert.equal(JSON.parse(await readFile(dbPath, "utf8")).marker, "recovered");
});
