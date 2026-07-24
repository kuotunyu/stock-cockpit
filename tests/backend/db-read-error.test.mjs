// 主 DB 的 readFile I/O 錯誤不是 JSON corruption：不得把原路徑改名後回退備份或空 DB。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SERVER_PATH } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-db-read-error-"));
const directoryDbPath = join(dataDir, "stock1-db.json");
await mkdir(directoryDbPath);

process.env.STOCK1_SKIP_LISTEN = "1";
process.env.NODE_ENV = "test";
process.env.HOST = "127.0.0.1";
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = directoryDbPath;
process.env.ADMIN_PASSWORD = "test-admin-pw";
process.env.APP_SECRET = "stock1-test-app-secret-32-characters-minimum";
delete process.env.PUBLIC_ORIGIN;
delete process.env.ENCRYPTION_KEY;

const mod = await import(pathToFileURL(SERVER_PATH).href);

test.after(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test("readFile 的非解析錯誤 fail-closed，原 DB 路徑不被標成 corrupt", async () => {
  await assert.rejects(mod.loadDb(), (error) => (
    ["EISDIR", "EPERM", "EACCES"].includes(error?.code)
  ));
  assert.equal((await stat(directoryDbPath)).isDirectory(), true);
  const names = await readdir(dataDir);
  assert.equal(names.some((name) => name.startsWith("stock1-db.json.corrupt-")), false);
});
