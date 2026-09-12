// 管理者整機匯出：雲端（Zeabur）拿不到 /data 的 shell，這是把整份資料抓回本機的常規出口。
// 只有 admin 能拿；內容是磁碟上最後一次提交的三個檔，逐檔附長度與 sha256，拆檔腳本要能原樣還原。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { bootServer } from "../helpers/test-server.mjs";
import { unpackMachineExport, verifyMachineExportBundle } from "../../scripts/unpack-machine-export.mjs";

let srv;
before(async () => {
  srv = await bootServer();
});
after(async () => {
  await srv.close();
});

async function call(path, init = {}, cookie = "") {
  const res = await srv.raw(path, { ...init, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}

test("未登入 401、一般使用者 403、POST 405；只有 admin 拿得到", async () => {
  assert.equal((await call("/api/admin/machine-export")).status, 401);
  const created = await call("/api/admin/users", { method: "POST", body: JSON.stringify({ username: "friend01", password: "friend-pw-1", displayName: "friend01", role: "user" }) }, srv.cookie);
  assert.equal(created.status, 201);
  const friend = (await call("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "friend01", password: "friend-pw-1" }) })).cookie;
  assert.equal((await call("/api/admin/machine-export", {}, friend)).status, 403);
  assert.equal((await call("/api/admin/machine-export", { method: "POST", body: "{}" }, srv.cookie)).status, 405);
});

test("admin 匯出：三個來源檔（sidecar 缺就略過）、sha256 對得上磁碟 bytes、pendingWrites 與剝除旗標要講", async () => {
  // 先寫一筆共享備註讓 DB 真的落盤過
  const note = await call("/api/notes", { method: "POST", body: JSON.stringify({ code: "2330", text: "export-me" }) }, srv.cookie);
  assert.equal(note.status, 201);
  const res = await call("/api/admin/machine-export", {}, srv.cookie);
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
  const bundle = res.body.bundle;
  assert.equal(bundle.format, "stock1-machine-export");
  assert.equal(bundle.version, 1);
  assert.equal(bundle.consistency, "live-committed", "這不是停機一致備份，要講清楚");
  assert.equal(typeof bundle.pendingWrites, "number");
  assert.equal(bundle.brokerCredentialsStripped, false, "測試密鑰夠強，不剝除");
  const db = bundle.files.find((item) => item.file === "stock1-db.json");
  assert.ok(db, "一定要有主 DB");
  assert.ok(db.content.stockNotes?.["2330"], "內容是解析後的 JSON 物件");
  const onDisk = await readFile(join(srv.dataDir, "stock1-db.json"));
  assert.equal(db.bytes, onDisk.length);
  assert.equal(db.sha256, createHash("sha256").update(onDisk).digest("hex"), "hash 對磁碟上的原始 bytes");
  for (const item of bundle.files) assert.ok(["stock1-db.json", "fundamentals-cache.json", "surveillance-history.json"].includes(item.file), item.file);
  // 拆檔：原樣還原、manifest 記錄一致性與旗標；再拆一次到非空資料夾要拒絕；竄改內容要被 sha256 抓到
  const target = await mkdtemp(join(tmpdir(), "stock1-unpack-"));
  const manifest = await unpackMachineExport(bundle, target);
  assert.equal(manifest.consistency, "live-committed");
  assert.deepEqual((await readdir(target)).sort(), [...bundle.files.map((item) => item.file), "manifest.json"].sort());
  assert.deepEqual(await readFile(join(target, "stock1-db.json")), onDisk, "拆出來的 bytes 與伺服器磁碟上的一模一樣");
  await assert.rejects(unpackMachineExport(bundle, target), /目的資料夾必須是空的/);
  const tampered = structuredClone(bundle);
  tampered.files[0].content.stockNotes["2330"][0].text = "changed";
  assert.throws(() => verifyMachineExportBundle(tampered), /sha256/);
  assert.throws(() => verifyMachineExportBundle({ ...bundle, format: "other" }), /無法辨識/);
});
