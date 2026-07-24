import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbload-"));

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));
const { mod } = await importServer({ routes: [], dataDir });

test("concurrent cold loadDb calls share one initialization", async (t) => {
  t.after(async () => {
    console.warn = originalWarn;
    await rm(dataDir, { recursive: true, force: true });
  });

  const results = await Promise.all(Array.from({ length: 12 }, () => mod.loadDb()));
  assert.ok(results.every((db) => db === results[0]), "all callers should receive the same cached object");
  assert.equal(
    warnings.filter((message) => message.includes("Created initial admin user")).length,
    1,
    "cold initialization must create the default admin only once",
  );
});
