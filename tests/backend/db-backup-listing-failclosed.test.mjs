// 「主檔不存在 → 看 backups/ 有沒有備份」是 fail-closed 的判準。列舉備份時若 readdir 失敗
// （權限、磁碟錯誤、backups 不是目錄），舊寫法回空陣列 → 被當成「第一次啟動」→ 種空 DB 並落盤，
// 正是 2026-07-27 那次修法要擋的情境。現在只有 ENOENT 才算「沒有備份」，其他錯誤原樣往上丟。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

test("backups 是一個檔案（readdir ENOTDIR）→ loadDb 拒絕，不得種空 DB", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stock1-bk-notdir-"));
  await writeFile(join(dir, "backups"), "i am a file, not a directory", "utf8");
  const { mod } = await importServer({ routes: [], dataDir: dir });
  await assert.rejects(
    () => mod.loadDb(),
    (error) => error?.code === "ENOTDIR" || /ENOTDIR|not a directory/i.test(String(error?.message)),
  );
  assert.equal(existsSync(join(dir, "stock1-db.json")), false, "不得落空 DB");
});
