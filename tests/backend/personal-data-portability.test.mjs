// 個人資料可攜性：匯出隔離／不洩密、兩階段預覽與原子還原、共享備註安全合併及還原點。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";
import {
  compactToday,
  stockDayAllRow,
  tpexDailyCloseRow,
  twseCompanyProfileRow,
  tpexCompanyProfileRow,
} from "../helpers/fixtures.mjs";

const EXPORT_PATH = "/api/personal-data/export";
const PREVIEW_PATH = "/api/personal-data/restore/preview";
const RESTORE_PATH = "/api/personal-data/restore";
const ADMIN_PASSWORD = "test-admin-pw";
const ADMIN_NOTE_ID = "n_portable_admin";
const ADMIN_NOTE_TEXT = "ADMIN_OWN_NOTE_SENTINEL";
const OTHER_NOTE_TEXT = "OTHER_USER_NOTE_SENTINEL";
const OTHER_ALERT_TEXT = "OTHER_USER_ALERT_SENTINEL";
const QUARANTINE_SENTINEL = "QUARANTINED_RECORD_MUST_SURVIVE";
const TARGET_PROFILE_SENTINEL = "TARGET_SHARED_PROFILE_MUST_NOT_BE_OVERWRITTEN";
const TRADE_DATE = compactToday(-20);
const OPTIONS = Object.freeze({
  watchLists: "replace",
  alerts: "replace",
  trades: "replace",
  stockNotes: "merge",
  companyProfiles: "skip",
});

let srv;
let db;
let admin;
let otherUser;
let exportedBundle;
let targetState;
let consumedPreviewToken;
let brokerCiphertextSentinel;

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function backupChecksum(bundle) {
  const { integrity: _integrity, ...unsigned } = bundle;
  return createHash("sha256").update(stableStringify(unsigned), "utf8").digest("hex");
}

function resignBundle(bundle) {
  const copy = jsonClone(bundle);
  copy.integrity = {
    algorithm: "sha256",
    contentHash: backupChecksum(copy),
  };
  return copy;
}

function tradeRecord(id, code = "2330", overrides = {}) {
  return {
    id,
    code,
    market: "TWSE",
    instrumentType: "stock",
    instrumentSource: "user",
    side: "buy",
    kind: "stock",
    date: TRADE_DATE,
    tradeDate: TRADE_DATE,
    executedAt: "",
    session: "regular",
    brokerAccountId: "default",
    currency: "TWD",
    price: 100,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    ...overrides,
  };
}

function portableLedger(recordId, { quarantined = false } = {}) {
  return srv.mod.normalizeTradesPayload({
    schemaVersion: 2,
    settings: { feeDiscount: 0.6, minFee: 20 },
    records: [tradeRecord(recordId)],
    quarantinedRecords: quarantined ? [{
      index: 99,
      reasons: ["舊資料待人工整理"],
      record: { id: QUARANTINE_SENTINEL, raw: "保留原始內容" },
    }] : [],
  });
}

function snapshotRelevantState() {
  return jsonClone({
    watchLists: db.watchLists[admin.id],
    alerts: db.priceAlerts[admin.id],
    trades: db.trades[admin.id],
    revs: db.dataRevs[admin.id],
    stockNotes: db.stockNotes,
    companyProfiles: db.companyProfiles,
  });
}

async function readJson(response, expectedStatus) {
  const text = await response.text();
  assert.equal(response.status, expectedStatus, text);
  return text ? JSON.parse(text) : {};
}

async function preview(bundle = exportedBundle) {
  return readJson(await srv.api(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify({ bundle, options: OPTIONS }),
  }), 200);
}

async function waitForPendingWrites(minimum, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readJson(await srv.raw("/api/health"), 200);
    if (health.persistence?.pendingWrites >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`pendingWrites 未在時限內達到 ${minimum}`);
}

function tpexEtfPayload(category) {
  const rows = category === "domestic" ? [["006201", "元大富櫃50", "103/03/10"]] : [];
  return {
    date: compactToday(),
    stat: "OK",
    tables: [{
      fields: ["證券代號", "ETF簡稱", "上櫃日期"],
      data: rows,
      totalCount: rows.length,
    }],
  };
}

before(async () => {
  srv = await bootServer({
    routes: [
      {
        match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap47_L/,
        reply: [],
      },
      {
        match: /tpex\.org\.tw\/www\/zh-tw\/ETF\/list/,
        reply: (_url, init) => {
          const category = new URLSearchParams(String(init?.body || "")).get("type") || "";
          return tpexEtfPayload(category);
        },
      },
      {
        match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/,
        reply: [twseCompanyProfileRow({ code: "2330", name: "台積電" })],
      },
      {
        match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/,
        reply: [tpexCompanyProfileRow({ code: "5347", name: "世界" })],
      },
      {
        match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/,
        reply: [stockDayAllRow({ code: "2330", name: "台積電", close: 100 })],
      },
      {
        match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/,
        reply: [tpexDailyCloseRow({ code: "5347", name: "世界", close: 100 })],
      },
    ],
  });

  db = await srv.mod.loadDb();
  admin = db.users.find((user) => user.username === "admin");
  otherUser = {
    id: "u_portable_other",
    username: "portable-other",
    displayName: "其他使用者",
    role: "user",
    passwordHash: srv.mod.hashPassword("other-user-password"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.users.push(otherUser);

  db.watchLists[admin.id] = { 1: ["2330", "0050"], 2: [], 3: [] };
  db.watchLists[otherUser.id] = { 1: ["9999"], 2: [], 3: [] };
  db.priceAlerts ||= {};
  db.priceAlerts[admin.id] = [{
    id: "admin-alert",
    code: "2330",
    op: ">=",
    price: 120,
    note: "突破提醒",
    active: true,
    createdAt: new Date().toISOString(),
    triggeredAt: "",
  }];
  db.priceAlerts[otherUser.id] = [{
    id: "other-alert",
    code: "9999",
    op: ">=",
    price: 1,
    note: OTHER_ALERT_TEXT,
    active: true,
    createdAt: new Date().toISOString(),
    triggeredAt: "",
  }];
  db.trades ||= {};
  db.trades[admin.id] = portableLedger("portable-export-trade", { quarantined: true });
  db.trades[otherUser.id] = portableLedger("other-private-trade");
  db.dataRevs ||= {};
  db.dataRevs[admin.id] = { watchLists: 5, alerts: 6, trades: 7 };
  db.dataRevs[otherUser.id] = { watchLists: 40, alerts: 41, trades: 42 };

  const friendNotes = Array.from({ length: 49 }, (_, index) => ({
    id: `n_other_${index}`,
    code: "1101",
    userId: otherUser.id,
    userName: otherUser.displayName,
    text: index === 0 ? OTHER_NOTE_TEXT : `其他人的既有備註 ${index}`,
    createdAt: new Date(Date.now() - (50 - index) * 1000).toISOString(),
  }));
  db.stockNotes = {
    1101: [...friendNotes, {
      id: ADMIN_NOTE_ID,
      code: "1101",
      userId: admin.id,
      userName: admin.displayName,
      text: ADMIN_NOTE_TEXT,
      createdAt: new Date().toISOString(),
    }],
  };
  db.companyProfiles = {
    2330: {
      code: "2330",
      summary: "來源帳號撰寫的公司簡介",
      updatedAt: new Date().toISOString(),
      updatedBy: admin.id,
      updatedByName: admin.displayName,
    },
    5347: {
      code: "5347",
      summary: "其他使用者撰寫的公司簡介",
      updatedAt: new Date().toISOString(),
      updatedBy: otherUser.id,
      updatedByName: otherUser.displayName,
    },
  };

  db.brokerCredentials ||= {};
  db.brokerCredentials[admin.id] = {
    provider: "fubon",
    encrypted: srv.mod.encryptJson({
      personalId: "A123456789",
      password: "BROKER_PASSWORD_SENTINEL",
      certPath: "C:\\secret\\portable-test.pfx",
      certPassword: "CERT_PASSWORD_SENTINEL",
      apiKey: "BROKER_API_KEY_SENTINEL",
      apiSecret: "BROKER_API_SECRET_SENTINEL",
    }),
    updatedAt: new Date().toISOString(),
  };
  brokerCiphertextSentinel = db.brokerCredentials[admin.id].encrypted.data;
  db.sessions.push({
    id: "s_other_portability",
    userId: otherUser.id,
    tokenHash: "SESSION_HASH_SENTINEL",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await srv.mod.saveDb(db);
});

after(async () => {
  if (srv) {
    srv.mock.restore();
    await srv.close();
  }
});

test("personal-data API：三端點都需登入，且只接受各自指定 method", async () => {
  const anonymousCalls = [
    [EXPORT_PATH, {}],
    [PREVIEW_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: {}, options: OPTIONS }),
    }],
    [RESTORE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: "x", confirmation: "RESTORE", currentPassword: ADMIN_PASSWORD }),
    }],
  ];
  for (const [path, init] of anonymousCalls) {
    const body = await readJson(await srv.raw(path, init), 401);
    assert.equal(body.code, "AUTH_REQUIRED", path);
  }

  const wrongMethods = [
    [EXPORT_PATH, { method: "POST", body: "{}" }],
    [PREVIEW_PATH, {}],
    [RESTORE_PATH, {}],
  ];
  for (const [path, init] of wrongMethods) {
    await readJson(await srv.api(path, init), 405);
  }
});

test("export：只匯出登入者 canonical 資料，含 checksum／quarantine，但不洩漏任何認證或他人資料", async () => {
  const response = await srv.api(EXPORT_PATH);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await readJson(response, 200);
  assert.equal(body.ok, true);
  exportedBundle = body.bundle;

  assert.equal(exportedBundle.format, "stock1-personal-backup");
  assert.equal(exportedBundle.formatVersion, 1);
  assert.deepEqual(exportedBundle.sourceAccount, {
    username: admin.username,
    displayName: admin.displayName,
  });
  assert.deepEqual(exportedBundle.sourceRevisions, { watchLists: 5, alerts: 6, trades: 7 });
  assert.deepEqual(exportedBundle.data.watchLists, { 1: ["2330", "0050"], 2: [], 3: [] });
  assert.equal(exportedBundle.data.alerts.length, 1);
  assert.equal(exportedBundle.data.trades.schemaVersion, 2);
  assert.equal(exportedBundle.data.trades.records[0].id, "portable-export-trade");
  assert.equal(exportedBundle.data.trades.quarantinedRecords[0].record.id, QUARANTINE_SENTINEL);
  assert.equal("portfolio" in exportedBundle.data.trades, false, "portfolio 是衍生資料，不應寫進備份");

  assert.deepEqual(exportedBundle.sharedContributions.stockNotes.map((note) => note.id), [ADMIN_NOTE_ID]);
  assert.equal("userId" in exportedBundle.sharedContributions.stockNotes[0], false);
  assert.equal("userName" in exportedBundle.sharedContributions.stockNotes[0], false);
  assert.deepEqual(exportedBundle.sharedContributions.companyProfiles.map((profile) => profile.code), ["2330"]);
  assert.equal("updatedBy" in exportedBundle.sharedContributions.companyProfiles[0], false);

  assert.equal(exportedBundle.integrity.algorithm, "sha256");
  assert.match(exportedBundle.integrity.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(exportedBundle.integrity.contentHash, backupChecksum(exportedBundle), "checksum 必須涵蓋 integrity 以外的 canonical bundle");

  const serialized = JSON.stringify(exportedBundle);
  for (const forbidden of [
    "passwordHash",
    "sessions",
    "brokerCredentials",
    admin.passwordHash,
    otherUser.passwordHash,
    brokerCiphertextSentinel,
    "SESSION_HASH_SENTINEL",
    OTHER_NOTE_TEXT,
    OTHER_ALERT_TEXT,
    "other-private-trade",
    admin.id,
    otherUser.id,
  ]) {
    assert.equal(serialized.includes(forbidden), false, `備份不得含 ${forbidden}`);
  }

  // 建立與備份不同的目標狀態；之後 preview 必須只報告、不落資料。
  db.watchLists[admin.id] = { 1: ["1101"], 2: [], 3: [] };
  db.priceAlerts[admin.id] = [{
    id: "target-alert",
    code: "1101",
    op: "<=",
    price: 30,
    note: "目標端現況",
    active: true,
    createdAt: new Date().toISOString(),
    triggeredAt: "",
  }];
  db.trades[admin.id] = portableLedger("target-current-trade");
  db.dataRevs[admin.id] = { watchLists: 11, alerts: 12, trades: 13 };
  db.stockNotes[1101] = db.stockNotes[1101].filter((note) => note.userId !== admin.id);
  db.companyProfiles[2330] = {
    code: "2330",
    summary: TARGET_PROFILE_SENTINEL,
    updatedAt: new Date().toISOString(),
    updatedBy: otherUser.id,
    updatedByName: otherUser.displayName,
  };
  await srv.mod.saveDb(db);
  targetState = snapshotRelevantState();
});

test("preview：dry-run 產生 canonical 差異摘要與一次性 token，不得修改資料或 rev", async () => {
  const beforeState = snapshotRelevantState();
  const body = await preview();
  assert.match(body.previewToken, /^[A-Za-z0-9_-]{32,}$/);
  assert.ok(Date.parse(body.expiresAt) > Date.now());
  assert.deepEqual(body.plan.warnings, []);

  assert.deepEqual(body.plan.sections.watchLists, {
    mode: "replace",
    changed: true,
    beforeCount: 1,
    afterCount: 2,
  });
  assert.deepEqual(body.plan.sections.alerts, {
    mode: "replace",
    changed: true,
    beforeCount: 1,
    afterCount: 1,
  });
  assert.equal(body.plan.sections.trades.mode, "replace");
  assert.equal(body.plan.sections.trades.changed, true);
  assert.equal(body.plan.sections.trades.beforeCount, 1);
  assert.equal(body.plan.sections.trades.afterCount, 1);
  assert.equal(body.plan.sections.trades.quarantinedCount, 1);
  assert.deepEqual(body.plan.sections.trades.portfolio, {
    ok: true,
    holdingsCount: 1,
    realizedCount: 0,
  });
  assert.deepEqual(body.plan.sections.stockNotes, {
    mode: "merge",
    addCount: 1,
    duplicateCount: 0,
    conflictCount: 0,
  });
  assert.deepEqual(body.plan.sections.companyProfiles, {
    mode: "skip",
    archivedCount: 1,
  });

  const alphaBundle = jsonClone(exportedBundle);
  alphaBundle.data.watchLists[2] = ["00725B"];
  alphaBundle.sharedContributions.stockNotes.push({
    id: "n_portable_alpha_etf",
    code: "00725B",
    text: "英數 ETF 的個人共享備註",
    createdAt: new Date().toISOString(),
  });
  const alphaPreview = await preview(resignBundle(alphaBundle));
  assert.equal(alphaPreview.plan.sections.watchLists.afterCount, 3, "合法英數 ETF 自選股不可在復原時遺失");
  assert.equal(alphaPreview.plan.sections.stockNotes.addCount, 2, "合法英數 ETF 備註必須可通過預覽並安全合併");

  const maxBackupBytes = 16 * 1024 * 1024;
  let boundaryBundle = resignBundle({ ...jsonClone(exportedBundle), padding: "" });
  const baseBytes = Buffer.byteLength(JSON.stringify(boundaryBundle), "utf8");
  boundaryBundle.padding = "x".repeat(maxBackupBytes - baseBytes);
  boundaryBundle = resignBundle(boundaryBundle);
  const boundaryRequest = JSON.stringify({ bundle: boundaryBundle, options: OPTIONS });
  assert.equal(Buffer.byteLength(JSON.stringify(boundaryBundle), "utf8"), maxBackupBytes);
  assert.ok(Buffer.byteLength(boundaryRequest, "utf8") > maxBackupBytes, "HTTP wrapper 必然比 16 MiB 備份檔更大");
  const boundaryPreview = await preview(boundaryBundle);
  assert.match(boundaryPreview.previewToken, /^[A-Za-z0-9_-]{32,}$/, "剛好 16 MiB 的合法檔案仍應通過預覽");

  boundaryBundle.padding += "x";
  const oversizedResponse = await readJson(await srv.api(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify({ bundle: resignBundle(boundaryBundle), options: OPTIONS }),
  }), 413);
  assert.equal(oversizedResponse.code, "BACKUP_TOO_LARGE", "檔案本身超過 16 MiB 仍必須拒絕");
  assert.deepEqual(snapshotRelevantState(), beforeState, "preview 絕不可落任何個人或共享資料");
});

test("restore：確認字串或目前密碼錯誤皆拒絕，且不產生部分寫入", async () => {
  const beforeState = snapshotRelevantState();

  const wrongConfirmationPreview = await preview();
  const wrongConfirmation = await readJson(await srv.api(RESTORE_PATH, {
    method: "POST",
    body: JSON.stringify({
      previewToken: wrongConfirmationPreview.previewToken,
      currentPassword: ADMIN_PASSWORD,
      confirmation: "restore",
    }),
  }), 400);
  assert.equal(wrongConfirmation.code, "RESTORE_CONFIRMATION_REQUIRED");
  assert.deepEqual(snapshotRelevantState(), beforeState);

  const wrongPasswordPreview = await preview();
  const wrongPassword = await readJson(await srv.api(RESTORE_PATH, {
    method: "POST",
    body: JSON.stringify({
      previewToken: wrongPasswordPreview.previewToken,
      currentPassword: "definitely-wrong",
      confirmation: "RESTORE",
    }),
  }), 403);
  assert.equal(wrongPassword.code, "REAUTH_FAILED");
  assert.deepEqual(snapshotRelevantState(), beforeState);
});

test("restore：原子 replace 私有資料、保留 quarantine、安全 merge 自己的備註，並先建立完整還原點", async () => {
  const beforeState = snapshotRelevantState();
  const backupsDir = join(srv.dataDir, "backups");
  const beforeFiles = new Set(await readdir(backupsDir).catch(() => []));
  const pending = await preview();
  consumedPreviewToken = pending.previewToken;
  const body = await readJson(await srv.api(RESTORE_PATH, {
    method: "POST",
    body: JSON.stringify({
      previewToken: pending.previewToken,
      currentPassword: ADMIN_PASSWORD,
      confirmation: "RESTORE",
    }),
  }), 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.revisions, { watchLists: 12, alerts: 13, trades: 14 });
  assert.deepEqual(body.applied, {
    watchLists: "replaced",
    alerts: "replaced",
    trades: "replaced",
    stockNotes: { added: 1, duplicates: 0 },
    companyProfiles: "skipped",
  });
  assert.deepEqual(body.warnings, []);
  assert.match(body.restorePoint?.fileName || "", /^stock1-pre-restore-.+\.json$/);
  assert.ok(Date.parse(body.restorePoint?.createdAt) > 0);
  assert.equal(body.restorePoint.fileName.includes("\\"), false, "回應不可暴露本機絕對路徑");
  assert.equal(body.restorePoint.fileName.includes("/"), false, "回應只回 basename");

  const watch = await readJson(await srv.api("/api/watchlists"), 200);
  assert.deepEqual(watch.lists, exportedBundle.data.watchLists);
  assert.equal(watch.rev, 12);
  const alerts = await readJson(await srv.api("/api/alerts"), 200);
  assert.deepEqual(alerts.alerts, exportedBundle.data.alerts);
  assert.equal(alerts.rev, 13);
  const trades = await readJson(await srv.api("/api/trades"), 200);
  assert.equal(trades.rev, 14);
  assert.equal(trades.records[0].id, "portable-export-trade");
  assert.equal(trades.quarantinedRecords[0].record.id, QUARANTINE_SENTINEL);
  assert.equal(trades.portfolio.ok, true);

  const notes = await readJson(await srv.api("/api/notes?code=1101"), 200);
  assert.equal(notes.notes.length, 50, "49 則他人備註＋1 則還原備註都必須保留");
  assert.equal(notes.notes.filter((note) => note.userId === otherUser.id).length, 49, "不得淘汰他人的既有備註");
  const restoredOwnNote = notes.notes.find((note) => note.id === ADMIN_NOTE_ID);
  assert.ok(restoredOwnNote);
  assert.equal(restoredOwnNote.userId, admin.id, "來源作者 id 不可信，必須重新綁定目前登入者");
  assert.equal(restoredOwnNote.userName, admin.displayName);
  assert.equal(restoredOwnNote.text, ADMIN_NOTE_TEXT);

  const company = await readJson(await srv.api("/api/company?code=2330"), 200);
  assert.equal(company.summary, TARGET_PROFILE_SENTINEL, "archive-only 公司簡介不得覆蓋全站共享最新版");

  const afterFiles = await readdir(backupsDir);
  const createdRestorePoints = afterFiles.filter((name) => !beforeFiles.has(name) && /^stock1-pre-restore-.+\.json$/.test(name));
  assert.deepEqual(createdRestorePoints, [body.restorePoint.fileName]);
  const restorePoint = JSON.parse(await readFile(join(backupsDir, body.restorePoint.fileName), "utf8"));
  assert.deepEqual(restorePoint.watchLists[admin.id], beforeState.watchLists);
  assert.deepEqual(restorePoint.priceAlerts[admin.id], beforeState.alerts);
  assert.deepEqual(restorePoint.trades[admin.id], beforeState.trades);
  assert.equal(restorePoint.stockNotes[1101].some((note) => note.id === ADMIN_NOTE_ID), false, "還原點必須是 commit 前狀態");
});

test("restore token：成功後不可 replay；preview 後 rev 變動則整包 409 且其他 section 完全不動", async () => {
  const replay = await readJson(await srv.api(RESTORE_PATH, {
    method: "POST",
    body: JSON.stringify({
      previewToken: consumedPreviewToken,
      currentPassword: ADMIN_PASSWORD,
      confirmation: "RESTORE",
    }),
  }), 409);
  assert.equal(replay.code, "RESTORE_PREVIEW_INVALID");

  const stalePreview = await preview();
  const currentWatch = await readJson(await srv.api("/api/watchlists"), 200);
  await readJson(await srv.api("/api/watchlists", {
    method: "PUT",
    body: JSON.stringify({
      rev: currentWatch.rev,
      lists: { 1: ["2454"], 2: [], 3: [] },
    }),
  }), 200);
  const stateAfterConcurrentWrite = snapshotRelevantState();

  const stale = await readJson(await srv.api(RESTORE_PATH, {
    method: "POST",
    body: JSON.stringify({
      previewToken: stalePreview.previewToken,
      currentPassword: ADMIN_PASSWORD,
      confirmation: "RESTORE",
    }),
  }), 409);
  assert.equal(stale.code, "RESTORE_PREVIEW_STALE");
  assert.equal(stale.currentRevisions.watchLists, stateAfterConcurrentWrite.revs.watchLists);
  assert.deepEqual(snapshotRelevantState(), stateAfterConcurrentWrite, "stale restore 不得局部覆蓋 alerts／trades／notes");
});

test("restore 排隊期間若目前密碼已變更，舊密碼不得通過提交時重驗", async (t) => {
  const beforeState = snapshotRelevantState();
  const pending = await preview();
  const changedPassword = "changed-during-restore-123";

  let releaseBlocker;
  let markBlockerStarted;
  const blockerStarted = new Promise((resolve) => { markBlockerStarted = resolve; });
  const blockerGate = new Promise((resolve) => { releaseBlocker = resolve; });
  t.after(() => releaseBlocker?.());
  const blocker = srv.mod.commitDbMutation(async () => {
    markBlockerStarted();
    await blockerGate;
  });
  void blocker.catch(() => {});
  await blockerStarted;

  const passwordChangePromise = srv.api("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: changedPassword }),
  });
  void passwordChangePromise.catch(() => {});
  await waitForPendingWrites(2);

  const restorePromise = srv.api(RESTORE_PATH, {
    method: "POST",
    body: JSON.stringify({
      previewToken: pending.previewToken,
      currentPassword: ADMIN_PASSWORD,
      confirmation: "RESTORE",
    }),
  });
  void restorePromise.catch(() => {});
  await waitForPendingWrites(3);

  releaseBlocker();
  await blocker;
  await readJson(await passwordChangePromise, 200);
  const rejected = await readJson(await restorePromise, 403);
  assert.equal(rejected.code, "REAUTH_FAILED");
  assert.deepEqual(snapshotRelevantState(), beforeState, "舊密碼 restore 不得套用任何 section");

  // 還原測試帳密，並同時證明目前 session 在自行換密碼後仍可正常使用。
  await readJson(await srv.api("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: changedPassword, newPassword: ADMIN_PASSWORD }),
  }), 200);
});

test("preview：畸形格式、未支援未來版本與 checksum 竄改均 422，且不改資料", async () => {
  const beforeState = snapshotRelevantState();
  const malformed = await readJson(await srv.api(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify({ bundle: { formatVersion: 1 }, options: OPTIONS }),
  }), 422);
  assert.equal(malformed.code, "BACKUP_FORMAT_INVALID");

  const future = resignBundle({ ...jsonClone(exportedBundle), formatVersion: 99 });
  const futureResponse = await readJson(await srv.api(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify({ bundle: future, options: OPTIONS }),
  }), 422);
  assert.equal(futureResponse.code, "BACKUP_VERSION_UNSUPPORTED");

  const tampered = jsonClone(exportedBundle);
  tampered.data.watchLists[1].push("2454");
  const checksumResponse = await readJson(await srv.api(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify({ bundle: tampered, options: OPTIONS }),
  }), 422);
  assert.equal(checksumResponse.code, "BACKUP_CHECKSUM_MISMATCH");

  const duplicateId = jsonClone(exportedBundle);
  duplicateId.sharedContributions.stockNotes.push({
    ...duplicateId.sharedContributions.stockNotes[0],
    code: "2330",
  });
  const duplicateResponse = await readJson(await srv.api(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify({ bundle: resignBundle(duplicateId), options: OPTIONS }),
  }), 422);
  assert.equal(duplicateResponse.code, "BACKUP_FORMAT_INVALID", "共享備註 id 必須跨股票全域唯一");
  assert.deepEqual(snapshotRelevantState(), beforeState);
  assert.notDeepEqual(snapshotRelevantState(), targetState, "成功還原後的狀態不應誤回到最初 target fixture");
});
