// DATA_DIR 單一 writer lease：同資料目錄（含 canonical alias）只允許一個程序，owner 結束後可立即接手。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { link, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SERVER_PATH } from "../helpers/test-server.mjs";

const READY_PATTERN = /Stock1 server: http:\/\/.+:(\d+)\//;

function spawnStock1(dataDir, envOverrides = {}) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PUBLIC_ORIGIN: "",
      PORT: "0",
      DATA_DIR: dataDir,
      DB_PATH: "",
      STOCK1_SKIP_LISTEN: "",
      ADMIN_PASSWORD: "test-admin-pw",
      APP_SECRET: "",
      ENCRYPTION_KEY: "",
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let spawnError = null;
  let readyPort = null;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal, error: spawnError }));
  });

  child.once("error", (error) => {
    spawnError = error;
    resolveReady(null);
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    const match = stdout.match(READY_PATTERN);
    if (match && readyPort === null) {
      readyPort = Number(match[1]);
      resolveReady(readyPort);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.once("close", () => resolveReady(null));

  return {
    child,
    ready,
    closed,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

async function waitForClose(proc, timeoutMs = 10000) {
  let timer;
  const result = await Promise.race([
    proc.closed.then((closed) => ({ closed })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (result.closed) return result.closed;

  if (proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill();
  let killTimer;
  const afterKill = await Promise.race([
    proc.closed.then((closed) => ({ closed })),
    new Promise((resolve) => {
      killTimer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);
  clearTimeout(killTimer);
  if (afterKill.closed) {
    throw new Error(`child did not exit in time; killed and closed with ${JSON.stringify(afterKill.closed)}`);
  }
  throw new Error("child did not close after timeout kill");
}

async function waitForReady(proc, timeoutMs = 15000) {
  let timer;
  const result = await Promise.race([
    proc.ready.then((port) => ({ port })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (Number.isInteger(result.port) && result.port > 0) return result.port;
  if (result.timedOut && proc.child.exitCode === null && proc.child.signalCode === null) {
    proc.child.kill();
    await proc.closed;
  }
  throw new Error(`server did not become ready; stderr=${proc.getStderr()}`);
}

async function stopChild(proc) {
  if (proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill();
  return waitForClose(proc);
}

function listenOnTemporaryPort(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("temporary port server did not expose a TCP address"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeNetServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("同一 DATA_DIR（含 canonical alias）競爭會 fail-closed，owner 結束後 successor 可接手", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-instance-lock-"));
  const otherDataDir = await mkdtemp(join(tmpdir(), "stock1-instance-other-"));
  const aliasRoot = await mkdtemp(join(tmpdir(), "stock1-instance-alias-"));
  const aliasDataDir = join(aliasRoot, "data-alias");
  await symlink(dataDir, aliasDataDir, process.platform === "win32" ? "junction" : "dir");

  const owner = spawnStock1(dataDir);
  let successor = null;
  let independent = null;
  let contender = null;
  let aliasContender = null;
  try {
    await waitForReady(owner);

    independent = spawnStock1(otherDataDir);
    await waitForReady(independent);
    assert.match(independent.getStdout(), /Stock1 server:/, "不同 DATA_DIR 可以同時啟動");
    await stopChild(independent);

    contender = spawnStock1(dataDir);
    const contenderResult = await waitForClose(contender);
    assert.notEqual(contenderResult.code, 0);
    assert.match(contender.getStderr(), /DATA_DIR_IN_USE/);
    assert.doesNotMatch(contender.getStdout(), /Stock1 server:/);

    aliasContender = spawnStock1(aliasDataDir);
    const aliasResult = await waitForClose(aliasContender);
    assert.notEqual(aliasResult.code, 0);
    assert.match(aliasContender.getStderr(), /DATA_DIR_IN_USE/);
    assert.doesNotMatch(aliasContender.getStdout(), /Stock1 server:/);

    await stopChild(owner);
    successor = spawnStock1(aliasDataDir);
    await waitForReady(successor);
    assert.match(successor.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(owner).catch(() => {});
    if (contender) await stopChild(contender).catch(() => {});
    if (aliasContender) await stopChild(aliasContender).catch(() => {});
    if (independent) await stopChild(independent).catch(() => {});
    if (successor) await stopChild(successor).catch(() => {});
    await rm(aliasRoot, { recursive: true, force: true }).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    await rm(otherDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("不同 DATA_DIR 不得用同一外部 DB_PATH 繞過 writer lease", async () => {
  const firstDataDir = await mkdtemp(join(tmpdir(), "stock1-db-path-first-"));
  const secondDataDir = await mkdtemp(join(tmpdir(), "stock1-db-path-second-"));
  const externalRoot = await mkdtemp(join(tmpdir(), "stock1-db-path-external-"));
  const externalDbPath = join(externalRoot, "shared-stock1-db.json");
  const first = spawnStock1(firstDataDir, { DB_PATH: externalDbPath });
  const second = spawnStock1(secondDataDir, { DB_PATH: externalDbPath });
  try {
    const [firstResult, secondResult] = await Promise.all([
      waitForClose(first),
      waitForClose(second),
    ]);
    for (const [proc, result] of [[first, firstResult], [second, secondResult]]) {
      assert.notEqual(result.code, 0);
      assert.match(proc.getStderr(), /DB_PATH_OUTSIDE_DATA_DIR/);
      assert.doesNotMatch(proc.getStdout(), /Stock1 server:/);
    }
  } finally {
    await stopChild(first).catch(() => {});
    await stopChild(second).catch(() => {});
    await rm(firstDataDir, { recursive: true, force: true }).catch(() => {});
    await rm(secondDataDir, { recursive: true, force: true }).catch(() => {});
    await rm(externalRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("父子 DATA_DIR 共用同一 DB_PATH 時，parent guard 仍只允許一個 writer", async () => {
  const parentDataDir = await mkdtemp(join(tmpdir(), "stock1-db-resource-parent-"));
  const nestedDataDir = join(parentDataDir, "nested");
  await mkdir(nestedDataDir);
  const sharedDbPath = join(nestedDataDir, "shared-stock1-db.json");
  const owner = spawnStock1(parentDataDir, { DB_PATH: sharedDbPath });
  let contender = null;
  let successor = null;
  try {
    await waitForReady(owner);

    contender = spawnStock1(nestedDataDir, { DB_PATH: sharedDbPath });
    const contenderResult = await waitForClose(contender);
    assert.notEqual(contenderResult.code, 0);
    assert.match(contender.getStderr(), /DATA_DIR_IN_USE/);
    assert.doesNotMatch(contender.getStdout(), /Stock1 server:/);

    await stopChild(owner);
    successor = spawnStock1(nestedDataDir, { DB_PATH: sharedDbPath });
    await waitForReady(successor);
    assert.match(successor.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(owner).catch(() => {});
    if (contender) await stopChild(contender).catch(() => {});
    if (successor) await stopChild(successor).catch(() => {});
    await rm(parentDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("一個 DB 的 atomic temp 不得成為另一個父子 DATA_DIR 實例的主 DB（parent guard）", async () => {
  const parentDataDir = await mkdtemp(join(tmpdir(), "stock1-db-temp-parent-"));
  const nestedDataDir = join(parentDataDir, "nested");
  await mkdir(nestedDataDir);
  const ownerDbPath = join(nestedDataDir, "shared-stock1-db.json");
  const contenderDbPath = `${ownerDbPath}.tmp`;
  const owner = spawnStock1(parentDataDir, { DB_PATH: ownerDbPath });
  let contender = null;
  let successor = null;
  try {
    await waitForReady(owner);

    contender = spawnStock1(nestedDataDir, { DB_PATH: contenderDbPath });
    const contenderResult = await waitForClose(contender);
    assert.notEqual(contenderResult.code, 0);
    assert.match(contender.getStderr(), /DATA_DIR_IN_USE/);
    assert.doesNotMatch(contender.getStdout(), /Stock1 server:/);

    await stopChild(owner);
    successor = spawnStock1(nestedDataDir, { DB_PATH: contenderDbPath });
    await waitForReady(successor);
    assert.match(successor.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(owner).catch(() => {});
    if (contender) await stopChild(contender).catch(() => {});
    if (successor) await stopChild(successor).catch(() => {});
    await rm(parentDataDir, { recursive: true, force: true }).catch(() => {});
  }

  const reverseParentDataDir = await mkdtemp(join(tmpdir(), "stock1-db-temp-reverse-"));
  const reverseDbPath = join(reverseParentDataDir, "stock1-db.json");
  const seed = spawnStock1(reverseParentDataDir);
  await waitForReady(seed);
  await stopChild(seed);
  const reverseTmpPath = `${reverseDbPath}.tmp`;
  await mkdir(reverseTmpPath);
  const reverseNestedDataDir = join(reverseTmpPath, "child");
  const nestedOwner = spawnStock1(reverseNestedDataDir);
  let outerContender = null;
  try {
    await waitForReady(nestedOwner);
    outerContender = spawnStock1(reverseParentDataDir, { DB_PATH: reverseDbPath });
    const result = await waitForClose(outerContender);
    assert.notEqual(result.code, 0);
    assert.match(outerContender.getStderr(), /WRITER_ENTRY_UNSAFE/);
    assert.doesNotMatch(outerContender.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(nestedOwner).catch(() => {});
    if (outerContender) await stopChild(outerContender).catch(() => {});
    await rm(reverseParentDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("一個實例的 backups 目錄不得同時成為另一個實例的 DATA_DIR", async () => {
  const parentDataDir = await mkdtemp(join(tmpdir(), "stock1-backup-resource-parent-"));
  const backupDataDir = join(parentDataDir, "backups");
  await mkdir(backupDataDir);
  const compactToday = new Date(Date.now() + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10).replaceAll("-", "");
  const nestedDbPath = join(backupDataDir, `stock1-db-${compactToday}.json`);
  const owner = spawnStock1(parentDataDir);
  let contender = null;
  let descendantContender = null;
  let successor = null;
  try {
    await waitForReady(owner);

    contender = spawnStock1(backupDataDir, { DB_PATH: nestedDbPath });
    const contenderResult = await waitForClose(contender);
    assert.notEqual(contenderResult.code, 0);
    assert.match(contender.getStderr(), /DATA_DIR_IN_USE/);
    assert.doesNotMatch(contender.getStdout(), /Stock1 server:/);

    descendantContender = spawnStock1(nestedDbPath);
    const descendantResult = await waitForClose(descendantContender);
    assert.notEqual(descendantResult.code, 0);
    assert.match(descendantContender.getStderr(), /DATA_DIR_IN_USE/);
    assert.doesNotMatch(descendantContender.getStdout(), /Stock1 server:/);
    await assert.rejects(stat(nestedDbPath), (error) => error?.code === "ENOENT");

    await stopChild(owner);
    successor = spawnStock1(backupDataDir, { DB_PATH: nestedDbPath });
    await waitForReady(successor);
    assert.match(successor.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(owner).catch(() => {});
    if (contender) await stopChild(contender).catch(() => {});
    if (descendantContender) await stopChild(descendantContender).catch(() => {});
    if (successor) await stopChild(successor).catch(() => {});
    await rm(parentDataDir, { recursive: true, force: true }).catch(() => {});
  }

  const reverseParentDataDir = await mkdtemp(join(tmpdir(), "stock1-backup-resource-reverse-"));
  const reverseBackupDir = join(reverseParentDataDir, "backups");
  await mkdir(reverseBackupDir);
  const reverseNestedDataDir = join(reverseBackupDir, `STOCK1-DB-${compactToday}.JSON`);
  const nestedOwner = spawnStock1(reverseNestedDataDir);
  let outerContender = null;
  try {
    await waitForReady(nestedOwner);
    outerContender = spawnStock1(reverseParentDataDir);
    const result = await waitForClose(outerContender);
    assert.notEqual(result.code, 0);
    assert.match(outerContender.getStderr(), /BACKUP_ENTRY_UNSAFE/);
    assert.doesNotMatch(outerContender.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(nestedOwner).catch(() => {});
    if (outerContender) await stopChild(outerContender).catch(() => {});
    await rm(reverseParentDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("主 DB temp、sidecar 與其未建立子路徑不得被另一個實例當成 DATA_DIR", async () => {
  const parentDataDir = await mkdtemp(join(tmpdir(), "stock1-writer-resource-parent-"));
  const dbParent = join(parentDataDir, "nested");
  await mkdir(dbParent);
  const ownerDbPath = join(dbParent, "shared-stock1-db.json");
  const owner = spawnStock1(parentDataDir, { DB_PATH: ownerDbPath });
  const blockedDataDirs = [
    `${ownerDbPath}.tmp`,
    join(parentDataDir, "risk-cache.json"),
  ];
  const blockedDescendantDataDirs = [
    join(`${ownerDbPath}.tmp`, "child"),
    join(parentDataDir, "risk-cache.json", "child"),
  ];
  const contenders = [];
  let successor = null;
  try {
    await waitForReady(owner);
    for (const blockedDataDir of blockedDataDirs) {
      const contender = spawnStock1(blockedDataDir);
      contenders.push(contender);
      const result = await waitForClose(contender);
      assert.notEqual(result.code, 0, blockedDataDir);
      assert.match(contender.getStderr(), /DATA_DIR_IN_USE/, blockedDataDir);
      assert.doesNotMatch(contender.getStdout(), /Stock1 server:/, blockedDataDir);
      await assert.rejects(
        stat(blockedDataDir),
        (error) => error?.code === "ENOENT",
        `被 lease 拒絕的 contender 不得先建立 writer path：${blockedDataDir}`,
      );
    }
    for (const blockedDataDir of blockedDescendantDataDirs) {
      const contender = spawnStock1(blockedDataDir);
      contenders.push(contender);
      const result = await waitForClose(contender);
      assert.notEqual(result.code, 0, blockedDataDir);
      assert.match(contender.getStderr(), /DATA_DIR_PARENT_MISSING/, blockedDataDir);
      assert.doesNotMatch(contender.getStdout(), /Stock1 server:/, blockedDataDir);
      await assert.rejects(
        stat(dirname(blockedDataDir)),
        (error) => error?.code === "ENOENT",
        `被拒絕的 contender 不得建立 writer parent：${dirname(blockedDataDir)}`,
      );
    }

    await stopChild(owner);
    successor = spawnStock1(blockedDataDirs[0]);
    await waitForReady(successor);
    assert.match(successor.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(owner).catch(() => {});
    for (const contender of contenders) await stopChild(contender).catch(() => {});
    if (successor) await stopChild(successor).catch(() => {});
    await rm(parentDataDir, { recursive: true, force: true }).catch(() => {});
  }


  const reverseParentDataDir = await mkdtemp(join(tmpdir(), "stock1-sidecar-reverse-"));
  const reverseSidecarPath = join(reverseParentDataDir, "risk-cache.json");
  await mkdir(reverseSidecarPath);
  const nestedOwner = spawnStock1(join(reverseSidecarPath, "child"));
  let outerContender = null;
  try {
    await waitForReady(nestedOwner);
    outerContender = spawnStock1(reverseParentDataDir);
    const result = await waitForClose(outerContender);
    assert.notEqual(result.code, 0);
    assert.match(outerContender.getStderr(), /WRITER_ENTRY_UNSAFE/);
    assert.doesNotMatch(outerContender.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(nestedOwner).catch(() => {});
    if (outerContender) await stopChild(outerContender).catch(() => {});
    await rm(reverseParentDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("backups 不可是逃出 DATA_DIR 的 alias，也不可是一般檔案", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-backup-boundary-"));
  const externalDir = await mkdtemp(join(tmpdir(), "stock1-backup-external-"));
  const backupPath = join(dataDir, "backups");
  await symlink(externalDir, backupPath, process.platform === "win32" ? "junction" : "dir");
  const escaped = spawnStock1(dataDir);
  try {
    const result = await waitForClose(escaped);
    assert.notEqual(result.code, 0);
    assert.match(escaped.getStderr(), /BACKUP_DIR_OUTSIDE_DATA_DIR/);
    assert.doesNotMatch(escaped.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(escaped).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    await rm(externalDir, { recursive: true, force: true }).catch(() => {});
  }

  const insideDataDir = await mkdtemp(join(tmpdir(), "stock1-backup-inside-alias-"));
  const archiveDir = join(insideDataDir, "archive");
  const insideBackupAlias = join(insideDataDir, "backups");
  await mkdir(archiveDir);
  await symlink(archiveDir, insideBackupAlias, process.platform === "win32" ? "junction" : "dir");
  const aliasDbPath = join(insideBackupAlias, "stock1-db-20991231.json");
  const insideAlias = spawnStock1(insideDataDir, { DB_PATH: aliasDbPath });
  try {
    const result = await waitForClose(insideAlias);
    assert.notEqual(result.code, 0);
    assert.match(insideAlias.getStderr(), /BACKUP_DIR_ALIAS_UNSAFE/);
    assert.doesNotMatch(insideAlias.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(insideAlias).catch(() => {});
    await rm(insideDataDir, { recursive: true, force: true }).catch(() => {});
  }

  const fileDataDir = await mkdtemp(join(tmpdir(), "stock1-backup-file-"));
  await writeFile(join(fileDataDir, "backups"), "not a directory", "utf8");
  const fileBackups = spawnStock1(fileDataDir);
  try {
    const result = await waitForClose(fileBackups);
    assert.notEqual(result.code, 0);
    assert.match(fileBackups.getStderr(), /BACKUP_DIR_NOT_DIRECTORY/);
    assert.doesNotMatch(fileBackups.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(fileBackups).catch(() => {});
    await rm(fileDataDir, { recursive: true, force: true }).catch(() => {});
  }

  const danglingDataDir = await mkdtemp(join(tmpdir(), "stock1-backup-dangling-"));
  const danglingTarget = join(dirname(danglingDataDir), `${basename(danglingDataDir)}-missing-target`);
  await symlink(danglingTarget, join(danglingDataDir, "backups"), process.platform === "win32" ? "junction" : "dir");
  const danglingBackups = spawnStock1(danglingDataDir);
  try {
    const result = await waitForClose(danglingBackups);
    assert.notEqual(result.code, 0);
    assert.match(danglingBackups.getStderr(), /BACKUP_DIR_ALIAS_UNSAFE/);
    assert.doesNotMatch(danglingBackups.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(danglingBackups).catch(() => {});
    await rm(danglingDataDir, { recursive: true, force: true }).catch(() => {});
    await rm(danglingTarget, { recursive: true, force: true }).catch(() => {});
  }
});

test("DB_PATH 拒絕 sidecar、sidecar 暫存檔與 backups 子樹", async () => {
  const cases = [
    "fundamentals-cache.json",
    "fundamentals-cache.json.tmp",
    "risk-cache.json",
    "risk-cache.json.tmp",
    "surveillance-history.json",
    "surveillance-history.json.tmp",
    join("nested", "risk-cache.json", "custom-main-db.json"),
    join("nested", "surveillance-history.json.tmp", "custom-main-db.json"),
    join("backups", "custom-main-db.json"),
  ];
  for (const relativePath of cases) {
    const dataDir = await mkdtemp(join(tmpdir(), "stock1-db-reserved-"));
    const candidate = join(dataDir, relativePath);
    await mkdir(dirname(candidate), { recursive: true });
    const proc = spawnStock1(dataDir, { DB_PATH: candidate });
    try {
      const result = await waitForClose(proc);
      assert.notEqual(result.code, 0, relativePath);
      assert.match(proc.getStderr(), /DB_PATH_RESERVED/, relativePath);
      assert.doesNotMatch(proc.getStdout(), /Stock1 server:/, relativePath);
    } finally {
      await stopChild(proc).catch(() => {});
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

test("既有 DB_PATH 必須是單一名稱的一般檔案，不可為目錄或 hard link", async () => {
  const directoryDataDir = await mkdtemp(join(tmpdir(), "stock1-db-not-file-"));
  const directoryPath = join(directoryDataDir, "main-db-directory");
  await mkdir(directoryPath);
  const directoryProc = spawnStock1(directoryDataDir, { DB_PATH: directoryPath });
  try {
    const result = await waitForClose(directoryProc);
    assert.notEqual(result.code, 0);
    assert.match(directoryProc.getStderr(), /DB_PATH_NOT_FILE/);
    assert.equal((await stat(directoryPath)).isDirectory(), true, "錯誤 DB_PATH 不可被改名或刪除");
    assert.equal((await readdir(directoryDataDir)).some((name) => name.startsWith("main-db-directory.corrupt-")), false);
  } finally {
    await stopChild(directoryProc).catch(() => {});
    await rm(directoryDataDir, { recursive: true, force: true }).catch(() => {});
  }

  const hardlinkDataDir = await mkdtemp(join(tmpdir(), "stock1-db-hardlink-"));
  const originalPath = join(hardlinkDataDir, "original.json");
  const hardlinkPath = join(hardlinkDataDir, "hardlink.json");
  await writeFile(originalPath, "{}\n", "utf8");
  await link(originalPath, hardlinkPath);
  const hardlinkProc = spawnStock1(hardlinkDataDir, { DB_PATH: hardlinkPath });
  try {
    const result = await waitForClose(hardlinkProc);
    assert.notEqual(result.code, 0);
    assert.match(hardlinkProc.getStderr(), /DB_PATH_HARDLINK_UNSAFE/);
    assert.doesNotMatch(hardlinkProc.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(hardlinkProc).catch(() => {});
    await rm(hardlinkDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("HTTP bind failure 會釋放 DATA_DIR lease，successor 可立即接手", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-bind-failure-"));
  const portOwner = createNetServer();
  const occupiedPort = await listenOnTemporaryPort(portOwner);
  const failed = spawnStock1(dataDir, { PORT: String(occupiedPort) });
  let successor = null;
  try {
    const failedResult = await waitForClose(failed);
    assert.notEqual(failedResult.code, 0);
    assert.match(failed.getStderr(), /EADDRINUSE/);
    assert.doesNotMatch(failed.getStdout(), /Stock1 server:/);

    successor = spawnStock1(dataDir);
    await waitForReady(successor);
    assert.match(successor.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(failed).catch(() => {});
    if (successor) await stopChild(successor).catch(() => {});
    await closeNetServer(portOwner).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});
