// 行為保持證明：以「原始入口」spawn `node server.mjs`（不帶 STOCK1_SKIP_LISTEN），
// 確認正式啟動路徑、安全啟動守門與臨時埠行為；所有案例都用 PORT=0，絕不碰 5174。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVER_PATH } from "../helpers/test-server.mjs";

const STRONG_ADMIN_PASSWORD = "test-admin-password";
const STRONG_APP_SECRET = "test-app-secret-that-is-at-least-32-characters-long";
const READY_PATTERN = /Stock1 server: http:\/\/.+:(\d+)\//;

function spawnStock1({ dataDir, ...envOverrides }) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PUBLIC_ORIGIN: "",
      PORT: "0",
      DATA_DIR: dataDir,
      STOCK1_SKIP_LISTEN: "",
      ADMIN_PASSWORD: "",
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
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  const result = await Promise.race([
    proc.closed.then((closed) => ({ closed })),
    timedOut.then(() => ({ timedOut: true })),
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

test("production 缺少 ADMIN_PASSWORD / APP_SECRET 時拒絕啟動", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-prod-guard-"));
  const proc = spawnStock1({ dataDir, NODE_ENV: "production" });
  try {
    const result = await waitForClose(proc);
    assert.notEqual(result.code, 0);
    assert.match(proc.getStderr(), /production 安全設定不足/);
    assert.doesNotMatch(proc.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(proc).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("production 拒絕 .env.example 的 placeholder", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-prod-placeholder-"));
  const proc = spawnStock1({
    dataDir,
    NODE_ENV: "production",
    ADMIN_PASSWORD: "replace-with-a-strong-password",
    APP_SECRET: "replace-with-a-long-random-secret",
  });
  try {
    const result = await waitForClose(proc);
    assert.notEqual(result.code, 0);
    assert.match(proc.getStderr(), /不可沿用範例值/);
    assert.doesNotMatch(proc.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(proc).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("即使不是 production，對外啟動仍要求強 ADMIN_PASSWORD / APP_SECRET", async (t) => {
  const scenarios = [
    { name: "IPv4 all interfaces", HOST: "0.0.0.0", PUBLIC_ORIGIN: "" },
    { name: "IPv6 all interfaces", HOST: "::", PUBLIC_ORIGIN: "" },
    { name: "reverse proxy public origin", HOST: "127.0.0.1", PUBLIC_ORIGIN: "https://stocks.example.test" },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "stock1-exposure-guard-"));
      const proc = spawnStock1({
        dataDir,
        HOST: scenario.HOST,
        PUBLIC_ORIGIN: scenario.PUBLIC_ORIGIN,
        ADMIN_PASSWORD: "short",
        APP_SECRET: "short",
      });
      try {
        const result = await waitForClose(proc);
        assert.notEqual(result.code, 0);
        assert.match(proc.getStderr(), /對外啟動 安全設定不足/);
        assert.match(proc.getStderr(), /ADMIN_PASSWORD/);
        assert.match(proc.getStderr(), /APP_SECRET/);
        assert.doesNotMatch(proc.getStdout(), /Stock1 server:/);
      } finally {
        await stopChild(proc).catch(() => {});
        await rm(dataDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
});

test("對外 HOST 搭配強 credentials 可以啟動", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-exposure-strong-"));
  const proc = spawnStock1({
    dataDir,
    HOST: "0.0.0.0",
    ADMIN_PASSWORD: STRONG_ADMIN_PASSWORD,
    APP_SECRET: STRONG_APP_SECRET,
  });
  try {
    const port = await waitForReady(proc);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    await res.text();
  } finally {
    await stopChild(proc).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("強 credentials 仍不得略過無效 PUBLIC_ORIGIN 驗證", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-origin-invalid-"));
  const proc = spawnStock1({
    dataDir,
    PUBLIC_ORIGIN: "not-a-valid-origin",
    ADMIN_PASSWORD: STRONG_ADMIN_PASSWORD,
    APP_SECRET: STRONG_APP_SECRET,
  });
  try {
    const result = await waitForClose(proc);
    assert.notEqual(result.code, 0);
    assert.match(proc.getStderr(), /PUBLIC_ORIGIN 必須是有效的 http\/https 網址/);
    assert.doesNotMatch(proc.getStdout(), /Stock1 server:/);
  } finally {
    await stopChild(proc).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("node server.mjs 仍會自行 listen 並提供首頁", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-boot-"));
  const proc = spawnStock1({ dataDir });
  try {
    const port = await waitForReady(proc);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("app.js"), "首頁應載入 app.js 的 HTML");
  } finally {
    await stopChild(proc).catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});
