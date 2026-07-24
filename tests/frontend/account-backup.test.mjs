// 個人資料備份前端契約：安全匯出、兩階段復原、檔案防護、對話框與帳號切換競態。
import test from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const USER_A = { id: "backup-user-a", username: "admin", displayName: "管理者", role: "admin" };
const USER_B = { id: "backup-user-b", username: "friend02", displayName: "朋友二號", role: "user" };
const RESTORE_OPTIONS = {
  watchLists: "replace",
  alerts: "replace",
  trades: "replace",
  stockNotes: "merge",
  companyProfiles: "skip",
};

function makeBundle(overrides = {}) {
  const bundle = {
    format: "stock1-personal-backup",
    formatVersion: 1,
    exportedAt: "2026-07-13T12:34:56.000Z",
    sourceAccount: { username: "admin", displayName: "管理者" },
    data: {
      watchLists: { 1: ["2330", "0050"], 2: [], 3: [] },
      alerts: [{ id: "alert-2330", code: "2330", op: ">=", price: 1100, active: true, triggeredAt: "" }],
      trades: {
        schemaVersion: 2,
        settings: { feeDiscount: 0.6, minFee: 20 },
        records: [
          {
            id: "trade-2330",
            code: "2330",
            market: "TWSE",
            instrumentType: "stock",
            instrumentSource: "official",
            side: "buy",
            tradeDate: "20260710",
            date: "20260710",
            executedAt: "2026-07-10T10:30:00+08:00",
            session: "regular",
            brokerAccountId: "default",
            currency: "TWD",
            price: 1000,
            shares: 100,
            dayTrade: { status: "none", matchedShares: 0, pairId: "" },
            feeAmountTwd: 20,
            feeSource: "estimated",
            taxAmountTwd: 0,
            taxSource: "estimated",
          },
        ],
        quarantinedRecords: [],
      },
    },
    sharedContributions: {
      stockNotes: [],
      companyProfiles: [],
    },
    integrity: { algorithm: "sha256", contentHash: "a".repeat(64) },
  };
  return {
    ...bundle,
    ...overrides,
    sourceAccount: { ...bundle.sourceAccount, ...(overrides.sourceAccount || {}) },
    data: { ...bundle.data, ...(overrides.data || {}) },
    sharedContributions: { ...bundle.sharedContributions, ...(overrides.sharedContributions || {}) },
    integrity: { ...bundle.integrity, ...(overrides.integrity || {}) },
  };
}

function makePreview(overrides = {}) {
  const plan = {
    sections: {
      watchLists: { mode: "replace", changed: true, beforeCount: 8, afterCount: 2 },
      alerts: { mode: "replace", changed: true, beforeCount: 3, afterCount: 1 },
      trades: {
        mode: "replace",
        changed: true,
        beforeCount: 4,
        afterCount: 1,
        quarantinedCount: 0,
        portfolio: { ok: true, holdingsCount: 1, realizedCount: 0 },
      },
      stockNotes: { mode: "merge", addCount: 0, duplicateCount: 0, conflictCount: 0 },
      companyProfiles: { mode: "skip", archivedCount: 0 },
    },
    warnings: [],
    ...(overrides.plan || {}),
  };
  return {
    ok: true,
    previewToken: "preview-token-a",
    expiresAt: "2026-07-13T12:44:56.000Z",
    ...overrides,
    plan,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function waitUntil(app, predicate, message) {
  for (let round = 0; round < 30; round += 1) {
    if (predicate()) return;
    await app.settle(1);
  }
  assert.fail(message);
}

function showBackupPanel(app, user = USER_A) {
  app.evalIn(`
    activateAuthenticatedUser(${JSON.stringify(user)});
    authState.checked = true;
    state.screen = "more";
    state.morePanel = "backup";
    render();
  `);
}

async function openRestoreModal(app) {
  showBackupPanel(app);
  const trigger = app.doc.querySelector('[data-action="open-personal-restore"]');
  assert.ok(trigger, "個人資料備份面板應提供復原入口");
  trigger.focus();
  trigger.click();
  await app.settle(4);
  const modal = app.doc.getElementById("personalBackupModal");
  assert.ok(modal, "復原流程必須使用 static managed modal");
  assert.equal(modal.hidden, false);
  return { modal, trigger, fileInput: app.doc.getElementById("personalBackupFile") };
}

async function chooseFile(app, file) {
  const input = app.doc.getElementById("personalBackupFile");
  assert.ok(input, "modal 應包含檔案選擇欄位");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new app.win.Event("change", { bubbles: true }));
  await app.settle(6);
  return input;
}

async function blobText(win, blob) {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsText(blob);
  });
}

test("更多頁提供獨立備份 tile；未登入先開登入 gate；復原 modal 具完整語意與焦點隔離", async (t) => {
  const app = await createAppWindow();
  t.after(() => app.cleanup());

  const modal = app.doc.getElementById("personalBackupModal");
  assert.ok(modal, "匯入 modal 應靜態存在，不能被 More panel 輪詢重繪移除");
  assert.equal(modal.hidden, true);
  const surface = modal.querySelector('[role="dialog"]');
  assert.ok(surface);
  assert.equal(surface.getAttribute("aria-modal"), "true");
  assert.equal(surface.tabIndex, -1);
  const labelledBy = surface.getAttribute("aria-labelledby");
  const describedBy = surface.getAttribute("aria-describedby");
  assert.ok(labelledBy && app.doc.getElementById(labelledBy)?.textContent.trim());
  assert.ok(describedBy && app.doc.getElementById(describedBy)?.textContent.trim());

  app.evalIn(`
    clearUserScopedState({ renderNow: false });
    authState.checked = true;
    state.screen = "more";
    state.morePanel = "source";
    render();
  `);
  const anonymousTile = app.doc.querySelector('[data-setting="backup"]');
  assert.ok(anonymousTile, "More grid 應有個人資料備份 tile");
  assert.match(anonymousTile.textContent, /個人資料備份/);
  assert.match(anonymousTile.textContent, /需登入/);
  anonymousTile.click();
  await app.settle(4);
  assert.equal(app.doc.getElementById("loginGate").hidden, false);
  assert.equal(modal.hidden, true, "匿名使用者不可先看到匯入內容");

  app.evalIn("setLoginGateVisible(false, '')");
  showBackupPanel(app);
  const opener = app.doc.querySelector('[data-action="open-personal-restore"]');
  assert.equal(opener.getAttribute("aria-haspopup"), "dialog");
  assert.equal(opener.getAttribute("aria-controls"), "personalBackupModal");
  opener.focus();
  opener.click();
  await app.settle(4);

  assert.equal(modal.hidden, false);
  assert.equal(app.doc.body.classList.contains("has-modal"), true);
  assert.ok(modal.contains(app.doc.activeElement), "開啟後焦點必須進入復原 modal");
  assert.ok(opener.closest("[inert]"), "modal 背景必須隔離");

  app.doc.querySelector('[data-action="close-personal-backup"]').click();
  await app.settle(4);
  assert.equal(modal.hidden, true);
  assert.equal(app.doc.body.classList.contains("has-modal"), false);
  assert.equal(app.doc.activeElement, opener, "關閉後回到觸發按鈕");
});

test("下載備份會把 bundle 直接存成 UTF-8 JSON，檔名安全且 Blob URL 必定回收", async (t) => {
  const bundle = makeBundle();
  const blobs = [];
  const revoked = [];
  const downloads = [];
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/export": { ok: true, bundle },
    },
    beforeApp(win) {
      win.URL.createObjectURL = (blob) => {
        blobs.push(blob);
        return `blob:stock1-backup-${blobs.length}`;
      };
      win.URL.revokeObjectURL = (url) => revoked.push(url);
      win.HTMLAnchorElement.prototype.click = function clickDownload() {
        downloads.push({ href: this.href, download: this.download });
      };
    },
  });
  t.after(() => app.cleanup());

  showBackupPanel(app);
  const button = app.doc.querySelector('[data-action="download-personal-backup"]');
  assert.ok(button);
  button.click();
  await waitUntil(app, () => downloads.length === 1 && revoked.length === 1, "下載完成後應回收 Blob URL");

  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, "application/json;charset=utf-8");
  assert.deepEqual(JSON.parse(await blobText(app.win, blobs[0])), bundle, "不可把 HTTP wrapper 一起寫進檔案");
  assert.equal(downloads[0].href, "blob:stock1-backup-1");
  assert.match(downloads[0].download, /^stock1-admin-[0-9]{8}(?:-[0-9]{6})?\.json$/i);
  assert.doesNotMatch(downloads[0].download, /[\\/:*?"<>|]/);
  assert.deepEqual(revoked, ["blob:stock1-backup-1"]);

  const text = await blobText(app.win, blobs[0]);
  for (const forbidden of ["password", "passwordHash", "tokenHash", "APP_SECRET", "brokerCredentials", "certPassword"]) {
    assert.equal(text.includes(forbidden), false, `下載內容不可出現 ${forbidden}`);
  }
});

test("檔案先在本機擋下空檔、過大、壞 JSON、錯誤格式與未來版本，全部不得送 preview API", async (t) => {
  let previewCalls = 0;
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/restore/preview": () => {
        previewCalls += 1;
        return makePreview();
      },
    },
  });
  t.after(() => app.cleanup());
  await openRestoreModal(app);

  const invalidCases = [
    { file: new app.win.File([], "empty.json", { type: "application/json" }), message: /空白|沒有內容/ },
    { file: new app.win.File([new Uint8Array(16 * 1024 * 1024 + 1)], "too-large.json", { type: "application/json" }), message: /過大|16\s*MB/i },
    { file: new app.win.File(["{not-json"], "broken.json", { type: "application/json" }), message: /JSON|格式/ },
    { file: new app.win.File([JSON.stringify({ format: "not-stock1", formatVersion: 1 })], "wrong-format.json", { type: "application/json" }), message: /Stock1|備份格式/ },
    { file: new app.win.File([JSON.stringify(makeBundle({ formatVersion: 99 }))], "future.json", { type: "application/json" }), message: /版本|新版/ },
  ];

  for (const item of invalidCases) {
    await chooseFile(app, item.file);
    const status = app.doc.getElementById("personalBackupStatus");
    assert.ok(status);
    assert.equal(status.getAttribute("role"), "alert");
    assert.match(status.textContent, item.message, item.file.name);
    assert.equal(previewCalls, 0, `${item.file.name} 不得送到後端`);
  }
});

test("合法檔案只做 server dry-run，顯示正規化前後摘要；密碼與確認框未完成前不能復原", async (t) => {
  const bundle = makeBundle();
  let previewBody = null;
  let restoreCalls = 0;
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/restore/preview": (_raw, init) => {
        previewBody = JSON.parse(init.body);
        return makePreview();
      },
      "/api/personal-data/restore": () => {
        restoreCalls += 1;
        return { ok: true };
      },
    },
  });
  t.after(() => app.cleanup());
  await openRestoreModal(app);
  await chooseFile(app, new app.win.File([JSON.stringify(bundle)], "stock1-admin.json", { type: "application/json" }));
  await waitUntil(app, () => previewBody !== null, "合法檔案應送 server preview");

  assert.deepEqual(previewBody, { bundle, options: RESTORE_OPTIONS });
  const preview = app.doc.getElementById("personalBackupPreview");
  assert.ok(preview);
  assert.match(preview.textContent, /尚未變更|尚未寫入/);
  assert.match(preview.textContent, /管理者/);
  assert.match(preview.textContent, /自選股/);
  assert.match(preview.textContent, /8\s*(?:→|變成)\s*2/);
  assert.match(preview.textContent, /到價提醒|提醒/);
  assert.match(preview.textContent, /3\s*(?:→|變成)\s*1/);
  assert.match(preview.textContent, /交易/);
  assert.match(preview.textContent, /4\s*(?:→|變成)\s*1/);

  const confirm = app.doc.getElementById("personalBackupConfirm");
  const password = app.doc.getElementById("personalBackupPassword");
  const apply = app.doc.querySelector('[data-action="restore-personal-backup"]');
  assert.equal(confirm?.type, "checkbox");
  assert.equal(confirm.checked, false);
  assert.equal(password?.type, "password");
  assert.equal(password.autocomplete, "current-password");
  assert.equal(apply?.disabled, true);

  password.value = "correct-horse-battery";
  password.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  assert.equal(apply.disabled, true, "只有密碼仍不可執行");
  confirm.checked = true;
  confirm.dispatchEvent(new app.win.Event("change", { bubbles: true }));
  assert.equal(apply.disabled, false, "密碼＋明確確認兩者完成才可執行");
  assert.equal(restoreCalls, 0, "dry-run 與填表階段不得變更資料");
});

test("確認復原只送 preview token、目前密碼與固定確認字；成功後清除秘密並重載三份 canonical 資料", async (t) => {
  const bundle = makeBundle();
  let restoreBody = null;
  let watchGets = 0;
  let alertGets = 0;
  let tradeGets = 0;
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/restore/preview": makePreview(),
      "/api/personal-data/restore": (_raw, init) => {
        restoreBody = JSON.parse(init.body);
        return {
          ok: true,
          revisions: { watchLists: 17, alerts: 18, trades: 19 },
          applied: { watchLists: 1, alerts: 1, trades: 1, stockNotes: 0, companyProfiles: 0 },
          warnings: [],
        };
      },
      "/api/watchlists": () => {
        watchGets += 1;
        return { ok: true, lists: { 1: ["1101"], 2: [], 3: [] }, rev: 17 };
      },
      "/api/alerts": () => {
        alertGets += 1;
        return { ok: true, alerts: [{ id: "restored-alert", code: "1101", op: ">=", price: 50, active: true }], rev: 18 };
      },
      "/api/trades": () => {
        tradeGets += 1;
        return {
          ok: true,
          schemaVersion: 2,
          settings: { feeDiscount: 0.6, minFee: 20 },
          records: [{ id: "restored-trade", code: "1101", side: "buy", price: 40, shares: 100, date: "20260710" }],
          quarantinedRecords: [],
          portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 } },
          rev: 19,
        };
      },
    },
  });
  t.after(() => app.cleanup());
  await openRestoreModal(app);
  const baseline = { watchGets, alertGets, tradeGets };
  await chooseFile(app, new app.win.File([JSON.stringify(bundle)], "restore-me.json", { type: "application/json" }));

  const password = app.doc.getElementById("personalBackupPassword");
  const confirm = app.doc.getElementById("personalBackupConfirm");
  const apply = app.doc.querySelector('[data-action="restore-personal-backup"]');
  password.value = "current-password-secret";
  password.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  confirm.checked = true;
  confirm.dispatchEvent(new app.win.Event("change", { bubbles: true }));
  apply.click();

  await waitUntil(app, () => restoreBody !== null, "應送出 restore request");
  assert.deepEqual(restoreBody, {
    previewToken: "preview-token-a",
    currentPassword: "current-password-secret",
    confirmation: "RESTORE",
  });
  assert.equal(Object.hasOwn(restoreBody, "bundle"), false, "commit 不應重送整包檔案");
  await waitUntil(
    app,
    () => watchGets > baseline.watchGets && alertGets > baseline.alertGets && tradeGets > baseline.tradeGets,
    "成功後應重新抓自選股、提醒與交易帳本",
  );

  assert.equal(app.doc.getElementById("personalBackupModal").hidden, true);
  assert.equal(app.doc.body.textContent.includes("current-password-secret"), false);
  assert.equal(password.value, "", "成功後密碼欄必須立即清空");
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify([...watchLists[1]])")), ["1101"]);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(priceAlertsState.alerts.map((item) => item.code))")), ["1101"]);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(tradesState.records.map((item) => item.code))")), ["1101"]);
  assert.match(app.doc.getElementById("toastStack").textContent, /復原完成|已復原/);
});

test("A 帳號的延遲 preview 在切換 B 後作廢，modal 關閉且舊檔名、來源與 token 都不可回到 DOM", async (t) => {
  const pending = deferred();
  let previewStarted = false;
  let restoreCalls = 0;
  const marker = "甲帳號私密備份標記";
  const bundle = makeBundle({ sourceAccount: { displayName: marker } });
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/restore/preview": () => {
        previewStarted = true;
        return pending.promise;
      },
      "/api/personal-data/restore": () => {
        restoreCalls += 1;
        return { ok: true };
      },
    },
  });
  t.after(() => app.cleanup());
  await openRestoreModal(app);
  await chooseFile(app, new app.win.File([JSON.stringify(bundle)], "alpha-private-marker.json", { type: "application/json" }));
  await waitUntil(app, () => previewStarted, "preview request 應已送出");

  app.evalIn(`activateAuthenticatedUser(${JSON.stringify(USER_B)}); render()`);
  await app.settle(4);
  assert.equal(app.doc.getElementById("personalBackupModal").hidden, true, "切帳號要立刻關閉私人復原流程");

  pending.resolve(makePreview({ previewToken: "stale-private-token" }));
  await app.settle(8);
  assert.equal(app.doc.getElementById("personalBackupModal").hidden, true);
  for (const secret of [marker, "alpha-private-marker.json", "stale-private-token"]) {
    assert.equal(app.doc.body.textContent.includes(secret), false, `${secret} 不可污染 B 的 DOM`);
  }
  assert.equal(restoreCalls, 0);

  showBackupPanel(app, USER_B);
  app.doc.querySelector('[data-action="open-personal-restore"]').click();
  await app.settle(4);
  assert.equal(app.doc.getElementById("personalBackupPreview")?.textContent.includes(marker) || false, false);
  assert.equal(app.doc.querySelector('[data-action="restore-personal-backup"]')?.disabled ?? true, true);
});

test("登出／401 會清掉已預覽 bundle 與目前密碼；重新登入後必須重新選檔", async (t) => {
  const marker = "logout-backup-only-marker";
  const bundle = makeBundle({ sourceAccount: { displayName: marker } });
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/restore/preview": makePreview(),
    },
  });
  t.after(() => app.cleanup());
  await openRestoreModal(app);
  await chooseFile(app, new app.win.File([JSON.stringify(bundle)], "logout-private.json", { type: "application/json" }));

  const password = app.doc.getElementById("personalBackupPassword");
  password.value = "must-disappear-now";
  password.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  assert.match(app.doc.getElementById("personalBackupPreview").textContent, /管理者/);

  app.evalIn(`handleAuthRequired(Object.assign(new Error("登入已逾期"), { status: 401, code: "AUTH_REQUIRED" }))`);
  await app.settle(4);
  assert.equal(app.doc.getElementById("personalBackupModal").hidden, true);
  assert.equal(password.value, "");
  assert.equal(app.doc.body.textContent.includes("must-disappear-now"), false);
  assert.equal(app.doc.body.textContent.includes("logout-private.json"), false);

  app.evalIn(`activateAuthenticatedUser(${JSON.stringify(USER_A)}); setLoginGateVisible(false, ""); render()`);
  await openRestoreModal(app);
  assert.equal(app.doc.getElementById("personalBackupPreview")?.textContent.includes(marker) || false, false);
  assert.equal(app.doc.querySelector('[data-action="restore-personal-backup"]')?.disabled ?? true, true);
});

test("不可信檔名與來源帳號只能當文字顯示，不得注入 preview DOM", async (t) => {
  const attack = '<img src=x onerror="window.__backupXss=1">';
  const bundle = makeBundle({ sourceAccount: { displayName: attack } });
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/personal-data/restore/preview": makePreview(),
    },
  });
  t.after(() => app.cleanup());
  await openRestoreModal(app);
  await chooseFile(app, new app.win.File([JSON.stringify(bundle)], `${attack}.json`, { type: "application/json" }));

  const modal = app.doc.getElementById("personalBackupModal");
  assert.equal(modal.querySelector("img"), null);
  assert.equal(app.evalIn("window.__backupXss"), undefined);
  assert.match(modal.textContent, /<img src=x/);
});
