// 管理者整機匯出：帳號管理面板只對 admin 顯示按鈕；按下去打 /api/admin/machine-export、用 Blob 觸發下載、
// toast 講清楚檔數／未落盤筆數／是否剝除券商憑證；非 admin 直接被擋在前端。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const apps = [];
after(() => apps.forEach((app) => app.cleanup()));

const json = (app, expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

const BUNDLE = {
  format: "stock1-machine-export", version: 1, createdAt: "2026-09-13T01:02:03.456Z", consistency: "live-committed",
  pendingWrites: 2, brokerCredentialsStripped: true, files: [{ file: "stock1-db.json", format: "json", bytes: 2, sha256: "ab", content: {} }],
};

async function adminApp() {
  const created = [];
  const app = await createAppWindow({
    fetchRoutes: { "/api/admin/machine-export": { ok: true, bundle: BUNDLE } },
    beforeApp: (win) => {
      win.URL.createObjectURL = (blob) => { created.push(blob); return `blob:stock1/${created.length}`; };
      win.URL.revokeObjectURL = () => {};
    },
  });
  apps.push(app);
  await app.settle();
  return { app, created };
}

test("帳號管理面板：admin 看得到整機匯出按鈕與還原指引；一般使用者看不到", async () => {
  const { app } = await adminApp();
  const admin = String(app.evalIn(`renderAccountManagementPanel()`));
  assert.match(admin, /data-action="download-machine-export"/);
  assert.match(admin, /unpack-machine-export\.mjs/, "面板要告訴人怎麼還原");
  assert.match(admin, /不是停機一致備份/);
  const user = String(app.evalIn(`(() => { const prev = authState.user; authState.user = { ...prev, role: "user" }; const html = renderAccountManagementPanel(); authState.user = prev; return html; })()`));
  assert.doesNotMatch(user, /download-machine-export/);
});

test("按下按鈕：打 /api/admin/machine-export、Blob 下載、檔名帶匯出時間、toast 講檔數／未落盤／剝除", async () => {
  const { app, created } = await adminApp();
  app.fetchLog.length = 0;
  const result = await app.evalIn(`(async () => {
    const host = document.createElement("div");
    host.innerHTML = renderAccountManagementPanel();
    document.body.appendChild(host);
    const button = host.querySelector('[data-action="download-machine-export"]');
    const anchors = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { anchors.push({ download: this.download, href: this.href }); };
    try { await downloadMachineExport(button); } finally { HTMLAnchorElement.prototype.click = originalClick; host.remove(); }
    return JSON.stringify({ anchors, busy: button.hasAttribute("aria-busy"), disabled: button.disabled, toast: document.getElementById("toastStack").lastElementChild?.textContent || "" });
  })()`).then((text) => JSON.parse(text));
  assert.ok(app.fetchLog.some((entry) => entry.path.includes("/api/admin/machine-export")), app.fetchLog.map((e) => e.path).join(", "));
  assert.equal(created.length, 1, "要做一個 Blob 觸發下載");
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].download, "stock1-machine-export-2026-09-13T01-02-03-456Z.json");
  assert.equal(result.busy, false);
  assert.equal(result.disabled, false);
  assert.match(result.toast, /整機匯出已下載（1 個檔，券商憑證已剝除）/);
  assert.match(result.toast, /有 2 筆寫入還沒落盤/);
});

test("非 admin 呼叫：前端直接擋、不打 API", async () => {
  const { app } = await adminApp();
  app.fetchLog.length = 0;
  const toast = String(app.evalIn(`(() => { const prev = authState.user; authState.user = { ...prev, role: "user" }; downloadMachineExport(); authState.user = prev; return document.getElementById("toastStack").lastElementChild?.textContent || ""; })()`));
  assert.match(toast, /只有管理者/);
  assert.equal(app.fetchLog.length, 0);
});
