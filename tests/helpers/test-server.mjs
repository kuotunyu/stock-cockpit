// 整合測試共用開機器：臨時 DATA_DIR＋臨時埠（0）＋mock fetch＋一次性 admin 登入。
// 絕不綁 5174（使用者的正式伺服器埠）。每個測試檔一個行程（node --test 預設），
// 所以這裡設定的 process.env 與模組快取都是天然隔離的。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installFetchMock } from "./fetch-mock.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = resolve(here, "../../server.mjs");

async function configureTestEnvironment({ dataDir, dbPath } = {}) {
  const isolatedDataDir = dataDir
    ? resolve(dataDir)
    : await mkdtemp(join(tmpdir(), "stock1-test-"));

  process.env.STOCK1_SKIP_LISTEN = "1";
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  delete process.env.PUBLIC_ORIGIN;
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "test-admin-pw";
  process.env.APP_SECRET = "stock1-test-app-secret-32-characters-minimum";
  delete process.env.ENCRYPTION_KEY;
  delete process.env.SESSION_MAX_AGE_MS;
  delete process.env.COOKIE_SECURE;
  process.env.DATA_DIR = isolatedDataDir;
  if (dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = resolve(dbPath);
  process.env.PORT = "0";

  return isolatedDataDir;
}

// 純函式測試用：設好環境後 import server.mjs（不開伺服器、不打網路）。
export async function importServer({ routes = [], dataDir, dbPath } = {}) {
  const isolatedDataDir = await configureTestEnvironment({ dataDir, dbPath });
  const mock = installFetchMock(routes); // 空表＝tripwire，任何外部呼叫都會 throw
  const mod = await import(pathToFileURL(SERVER_PATH).href);
  return { mod, mock, dataDir: isolatedDataDir };
}

// HTTP 整合測試用：真的把伺服器綁上臨時埠並登入。
export async function bootServer({ routes = [], dataDir: requestedDataDir, dbPath } = {}) {
  const dataDir = await configureTestEnvironment({ dataDir: requestedDataDir, dbPath });
  const mock = installFetchMock(routes);
  let mod = null;
  let server = null;
  let baseUrl = "";
  let cookie = "";
  try {
    mod = await import(pathToFileURL(SERVER_PATH).href);
    server = await mod.startServer(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await mock.realFetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-admin-pw" }),
    });
    if (login.status !== 200) {
      const detail = (await login.text()).slice(0, 300);
      throw new Error(`test-server: admin login failed (${login.status}) ${detail}`);
    }
    cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  } catch (error) {
    try {
      if (mod?.shutdownServer) await mod.shutdownServer({ reason: "test-helper-boot-failed" });
      else if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
    } finally {
      mock.restore();
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
  let closed = false;
  return {
    baseUrl,
    cookie,
    mod,
    mock,
    dataDir,
    // 帶登入 cookie 的便捷呼叫；raw() 則完全不帶 cookie（測 401 政策用）。
    api: (path, init = {}) =>
      mock.realFetch(baseUrl + path, {
        ...init,
        headers: { cookie, "content-type": "application/json", ...(init.headers || {}) },
      }),
    raw: (path, init = {}) => mock.realFetch(baseUrl + path, init),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await mod.shutdownServer({ reason: "test-helper" });
      } finally {
        mock.restore();
        await rm(dataDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

// fire-and-forget 寫檔的等待器：輪詢直到條件成立（預設 1 秒上限）。
export async function pollUntil(fn, { timeout = 1000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("pollUntil: timeout");
    await new Promise((r) => setTimeout(r, interval));
  }
}
