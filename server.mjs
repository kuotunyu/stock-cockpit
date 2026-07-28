import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { lstat, mkdir, readFile, writeFile, rename, copyFile, readdir, unlink, realpath } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const appVersion = String(require("./package.json")?.version || "0.0.0");
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const dataDir = process.env.DATA_DIR || join(root, ".data");
const dbPath = process.env.DB_PATH || join(dataDir, "stock1-db.json");
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 14);
const MAX_SESSIONS_PER_USER = 10;
const passwordIterations = 210000;
const unsafeExampleSecrets = new Set([
  "replace-with-a-strong-password",
  "replace-with-a-long-random-secret",
]);
const configuredAdminPassword = String(process.env.ADMIN_PASSWORD || "");
const configuredAppSecret = String(process.env.APP_SECRET || process.env.ENCRYPTION_KEY || "");
const usingDefaultAdminPassword = !configuredAdminPassword || unsafeExampleSecrets.has(configuredAdminPassword);
const usingDefaultAppSecret = !configuredAppSecret || unsafeExampleSecrets.has(configuredAppSecret);
const appSecret = usingDefaultAppSecret ? "stock1-local-development-secret" : configuredAppSecret;
const encryptionKey = scryptSync(appSecret, "stock1-broker-credentials-v1", 32);
let lifecycleStatus = "idle";
let serverStartedAt = "";
let startPromise = null;
let shutdownPromise = null;
let shutdownRequested = false;
let serverCloseCleanupPromise = null;
let activeServerClosePromise = null;
let resolveActiveServerClose = null;
let dataDirLeaseServer = null;
let backupDirLeaseServer = null;
let sidecarLeaseServers = [];
let dbPathLeaseServers = [];
let leasedCanonicalDataDir = "";
let leasedCanonicalBackupDir = "";
let dataDirLeasePromise = null;
let dataDirLeaseRequired = false;
let dataDirLeaseHealthy = false;

function isLoopbackHost(value) {
  let normalized = String(value || "").trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function validateStartupSecurity(listenHost) {
  const production = process.env.NODE_ENV === "production";
  const publicOrigin = String(process.env.PUBLIC_ORIGIN || "").trim();
  const externallyReachable = !isLoopbackHost(listenHost) || Boolean(publicOrigin);
  if (!production && !externallyReachable) return;

  const problems = [];
  if (configuredAdminPassword.length < 12 || unsafeExampleSecrets.has(configuredAdminPassword)) {
    problems.push("ADMIN_PASSWORD 至少需要 12 個字元且不可沿用範例值");
  }
  if (configuredAppSecret.length < 32 || unsafeExampleSecrets.has(configuredAppSecret)) {
    problems.push("APP_SECRET 至少需要 32 個字元且不可沿用範例值");
  }
  if (publicOrigin) {
    try {
      const parsed = new URL(publicOrigin);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin === "null") throw new Error("invalid origin");
    } catch {
      problems.push("PUBLIC_ORIGIN 必須是有效的 http/https 網址");
    }
  }
  if (problems.length) {
    const context = production ? "production " : "對外啟動 ";
    throw new Error(`[Stock1] ${context}安全設定不足：${problems.join("；")}。伺服器已拒絕啟動。`);
  }
}

// API 未帶 codes 參數時的示範代碼組（權值股＋ETF），正常使用下前端都會帶明確代碼。
const defaultCodes = ["2330", "0050", "2317", "2454", "2603", "2882"];

const securityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

const jsonHeaders = {
  ...securityHeaders,
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

// 靜態面只需要這些 app shell 檔案。明確 allowlist，避免把 server.mjs、package.json、tests
// 或未來新增的內部檔案意外當成公開下載。
const publicStaticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/lucide.min.js", "lucide.min.js"],
  ["/sw.js", "sw.js"],
  ["/manifest.json", "manifest.json"],
  ["/icon.svg", "icon.svg"],
  ["/fonts/IBMPlexMono-Medium-Latin1.woff2", "fonts/IBMPlexMono-Medium-Latin1.woff2"],
  ["/fonts/IBMPlexMono-SemiBold-Latin1.woff2", "fonts/IBMPlexMono-SemiBold-Latin1.woff2"],
  ["/fonts/IBMPlexMono-Bold-Latin1.woff2", "fonts/IBMPlexMono-Bold-Latin1.woff2"],
]);

const REFERENCE_TTL_MS = 5 * 60 * 1000;
const REFERENCE_RETRY_MS = 30 * 1000;
const referenceMarketCache = {
  twse: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
  tpex: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
};
let referenceCache = { expiresAt: 0, value: null };
let referenceInFlight = null;

let quoteCache = {
  key: "",
  expiresAt: 0,
  value: null,
};

let riskCache = {
  key: "",
  expiresAt: 0,
  value: null,
};
const riskInFlight = new Map();

let marketCache = {
  expiresAt: 0,
  value: null,
};

const institutionalCache = new Map();
const institutionalInFlight = new Map();
const historyCache = new Map();
const historyInFlight = new Map();
const overnightCache = new Map();
const overnightInFlight = new Map();
const backtestCache = new Map();
const backtestInFlight = new Map();
const OVERNIGHT_CACHE_MAX_ENTRIES = 32;
const BACKTEST_CACHE_MAX_ENTRIES = 8;
const BACKTEST_CACHE_TTL_MS = 5 * 60 * 1000;
const marginCache = new Map();
const marginInFlight = new Map();
const swingCache = new Map();
const swingScanInFlight = new Map();
const SWING_FORCE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
let lastSwingForceRefreshAt = 0;

let verifyHistoryCache = {
  expiresAt: 0,
  value: null,
};

function setBoundedDateCache(cache, key, value, maxEntries = 16) {
  const now = Date.now();
  for (const [cachedKey, entry] of cache) {
    if (!entry || entry.expiresAt <= now) cache.delete(cachedKey);
  }
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}

function getFreshTtlCacheEntry(cache, key, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // Map 的插入順序就是 LRU 順序；命中時把 key 移到最後。
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

const COMPANY_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const COMPANY_DIRECTORY_RETRY_MS = 5 * 60 * 1000;
const companyDirectoryMarketCache = {
  twse: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
  tpex: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
};
let companyDirectoryCache = { expiresAt: 0, value: null };
let companyDirectoryInFlight = null;

// ETF 官方商品主檔的更新頻率遠低於行情；逐市場保留 last-good，避免其中一站
// 暫時故障時，把「查不到」誤當成「不是 ETF」。
const PRODUCT_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const PRODUCT_DIRECTORY_RETRY_MS = 5 * 60 * 1000;
const productDirectoryMarketCache = {
  twse: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
  tpex: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
};
let productDirectoryCache = { expiresAt: 0, value: null };
let productDirectoryInFlight = null;

// 上市/上櫃共用的產業別數字代碼 → 中文名稱。官方 t187ap03_L 的「產業別」與
// 上櫃 mopsfin_t187ap03_O 的 SecuritiesIndustryCode 都是這套編碼（例：01=水泥、33=農業科技）。
const INDUSTRY_NAMES = {
  "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維", "05": "電機機械",
  "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業",
  "12": "汽車工業", "14": "建材營造", "15": "航運業", "16": "觀光餐旅", "17": "金融保險業",
  "18": "貿易百貨", "19": "綜合", "20": "其他業", "21": "化學工業", "22": "生技醫療業",
  "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業", "26": "光電業",
  "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
  "31": "其他電子業", "32": "文化創意業", "33": "農業科技業", "34": "電子商務",
  "35": "綠能環保", "36": "數位雲端", "37": "運動休閒", "38": "居家生活", "80": "管理股票",
};

function resolveIndustryName(code) {
  const key = String(code ?? "").trim();
  if (!key) return "";
  return INDUSTRY_NAMES[key] || INDUSTRY_NAMES[key.padStart(2, "0")] || key;
}

const dataSourceLabels = {
  official: "官方資料",
  broker: "券商資料",
};

function normalizeDataSource(value) {
  return value === "broker" ? "broker" : "official";
}

function textResponse(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { ...securityHeaders, "content-type": contentType });
  response.end(body);
}

function jsonResponse(response, status, body) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 4) return "*".repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), salt, passwordIterations, 32, "sha256").toString("hex");
  return `pbkdf2$${passwordIterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [version, iterationsText, salt, expected] = String(storedHash || "").split("$");
  if (version !== "pbkdf2" || !salt || !expected) return false;
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;
  const actual = pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function encryptJson(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: "aes-256-gcm-v1",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptJson(payload) {
  if (!payload?.iv || !payload?.tag || !payload?.data) return null;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) return cookies;
      // decodeURIComponent 對「裸 %」會丟 URIError（例如值裡有 "100%" 或 "50%off"）。
      // 這個函式被 getAuthContext 在**每一支 API 之前**呼叫，所以一個解不開的 cookie
      // 會讓整個 /api/* 回 500 URI malformed：畫面每一格「載入失敗」，
      // 而且自選股與交易紀錄的 PUT 也全部失敗、資料存不進去。
      //
      // 更麻煩的是 cookie 綁 host 不綁 port——同一台機器上**任何其他 localhost 專案**
      // 寫過一次這種 cookie 就會波及這裡，與本專案的 sid 完全無關，使用者不可能查得出原因。
      //
      // 解不開的那一筆直接跳過（等同「沒有這個 cookie」）：最壞情況是視同未登入，
      // 遠好過整個 API 掛掉。其餘 cookie 照常解析，不會被一顆壞的拖累。
      try {
        cookies[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      } catch {
        // 忽略這一筆
      }
      return cookies;
    }, {});
}

function isSecureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https" || process.env.COOKIE_SECURE === "true";
}

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function requestPublicOrigin(request) {
  const configured = String(process.env.PUBLIC_ORIGIN || "").trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { return ""; }
  }
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (request.socket?.encrypted ? "https" : "http");
  const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const requestHost = forwardedHost || String(request.headers.host || "").trim();
  if (!requestHost) return "";
  try { return new URL(`${proto}://${requestHost}`).origin; } catch { return ""; }
}

// Cookie 驗證的寫入 API 再加同源邊界。SameSite=Lax 能擋多數 cross-site 表單，
// 但同站不同 origin（子網域/不同 port）仍可能帶 cookie；有 Origin 時必須精確相同。
function rejectUnsafeMutation(request, response) {
  if (!mutationMethods.has(request.method || "")) return false;
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  const origin = String(request.headers.origin || "").trim();
  const expectedOrigin = requestPublicOrigin(request);
  let originMismatch = fetchSite === "cross-site";
  if (origin) {
    try {
      originMismatch ||= !expectedOrigin || new URL(origin).origin !== expectedOrigin;
    } catch {
      originMismatch = true;
    }
  }
  if (originMismatch) {
    jsonResponse(response, 403, { ok: false, error: "拒絕跨來源的資料修改請求", code: "ORIGIN_FORBIDDEN" });
    return true;
  }
  const hasBody = Number(request.headers["content-length"] || 0) > 0 || Boolean(request.headers["transfer-encoding"]);
  if (hasBody && ["POST", "PUT", "PATCH"].includes(request.method || "")) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      jsonResponse(response, 415, { ok: false, error: "資料修改請求必須使用 application/json", code: "JSON_REQUIRED" });
      return true;
    }
  }
  return false;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return parts.join("; ");
}

function createEmptyDb() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    users: [],
    sessions: [],
    watchLists: {},
    priceAlerts: {},
    trades: {},
    dataRevs: {},
    sharedRevs: {},
    brokerCredentials: {},
    stockNotes: {},
    companyProfiles: {},
    swingSnapshots: {},
    swingVerification: {},
  };
}

// 新帳號的起手清單：兩檔指標性標的當示範，其餘留白讓使用者自己建。
function defaultWatchListPayload() {
  return {
    1: ["2330", "0050"],
    2: [],
    3: [],
  };
}

const MAX_WATCHLIST_CODES_PER_LIST = 100;
const MAX_PRICE_ALERTS = 50;
const SECURITY_CODE_PATTERN = /^[0-9A-Z]{4,6}$/;

function normalizeWatchListsPayload(input) {
  const source = input && typeof input === "object" ? input : {};
  const normalized = {};
  for (const key of ["1", "2", "3"]) {
    const list = Array.isArray(source[key]) ? source[key] : [];
    normalized[key] = [...new Set(list.map(cleanCode).filter((code) => SECURITY_CODE_PATTERN.test(code)))];
  }
  return normalized;
}

// 到價提醒：每人一份、整包同步（比照 watchLists）。伺服器只負責存放與清洗，
// 觸價判斷在前端 10 秒報價輪詢裡做（頁面開著才提醒，本 App 沒有背景推播）。
function normalizeAlertsPayload(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const code = cleanCode(raw.code);
    const op = raw.op === "<=" ? "<=" : ">=";
    const price = Number(raw.price);
    if (!SECURITY_CODE_PATTERN.test(code) || !Number.isFinite(price) || price <= 0) continue;
    const id = String(raw.id || `${code}${op}${price}`).slice(0, 48);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      code,
      op,
      price: Math.round(price * 100) / 100,
      note: String(raw.note || "").trim().slice(0, 60),
      active: raw.active !== false,
      createdAt: String(raw.createdAt || "").slice(0, 40),
      triggeredAt: String(raw.triggeredAt || "").slice(0, 40),
    });
  }
  return out;
}

function capacityValidationError(message, details) {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    error: message,
    details,
  };
}

// ===== 持股損益（完整交易紀錄）=====
// 每人一份 { settings, records }，整包同步（比照自選股/到價提醒）。
// 成本採台股散戶慣用的「加權平均法」：買進手續費計入成本；賣出以平均成本結轉、算已實現損益。
// 費用在「寫入當下」就算好存進紀錄（之後改折數不追溯），使用者也可自行覆寫。
const TRADE_FEE_RATE = 0.001425; // 只作預設估算基準；實際費率、折讓與最低費用由券商自訂。
// 舊版相容常數；v2 正式估算改走 effective-dated computeTradeTaxRule()。
const TRADE_TAX_RATES = { stock: 0.003, etf: 0.001, dayTrade: 0.0015 };

// ---- 前向驗證／回測的交易成本估算（D-20）----
// 驗證單與回測樣本只有價格，沒有股數或部位金額，所以只能做**費率版**淨報酬：
// 買進手續費＋賣出手續費（各 TRADE_FEE_RATE × 預設折數）＋賣出證交稅（一般股票 3‰）。
// 因此它**套不上 computeTradeFee 的每筆最低 20 元**——成交金額低於約 23,400 元時實際費率更高，
// 小額部位的真實成本會比這個數字大。也不等同交易帳本口徑，文案一律標「估算」。
// 隔日沖是「今日收盤買、次日賣」，不是現股當沖，所以用全額 3‰ 而非減半的 1.5‰。
const VERIFY_ROUND_TRIP_FEE_PCT = TRADE_FEE_RATE * 0.6 * 2 * 100;   // 0.171%
const VERIFY_ROUND_TRIP_TAX_PCT = TRADE_TAX_RATES.stock * 100;       // 0.3%
const VERIFY_ROUND_TRIP_COST_PCT = roundTo(VERIFY_ROUND_TRIP_FEE_PCT + VERIFY_ROUND_TRIP_TAX_PCT, 3); // 0.471%
const VERIFY_COST_NOTE = `淨報酬為估算：已扣一買一賣的手續費與證交稅合計約 ${VERIFY_ROUND_TRIP_COST_PCT}%`
  + "（以預設 0.6 折、一般股票 3‰ 計；未計每筆最低 20 元手續費與滑價，小額部位實際成本更高）。";
// 毛報酬扣成本；null 進 null 出，不可讓缺值變成 -0.471。
function netReturnPct(grossPct) {
  return Number.isFinite(grossPct) ? roundTo(grossPct - VERIFY_ROUND_TRIP_COST_PCT) : null;
}
const TRADE_SCHEMA_VERSION = 2;
const TRADE_INSTRUMENT_TYPES = new Set([
  "stock",
  "equityEtf",
  "unknownEtf",
  "bondIndexEtf",
  "leveragedInverseEtf",
  "activeEtf",
  "otherEtf",
  "etn",
  "other",
]);
const TRADE_DAY_TRADE_STATUSES = new Set([
  "none",
  "brokerConfirmed",
  "userConfirmed",
  "legacyDeclared",
]);
const TRADE_MONEY_SOURCES = new Set(["estimated", "broker", "manual", "legacy"]);
const TRADE_REVIEW_STATUSES = new Set(["ok", "needsReview"]);
const TRADE_INSTRUMENT_SOURCES = new Set(["official", "user", "legacy"]);
const TRADE_MARKETS = new Set(["TWSE", "TPEx", "unknown"]);
const TRADE_SESSIONS = new Set(["regular", "afterHoursFixed", "oddLot", "block", "unknown"]);
const STOCK_DAY_TRADE_TAX_FROM = "20170428";
const STOCK_DAY_TRADE_TAX_TO = "20271231";
const BOND_INDEX_ETF_TAX_EXEMPT_FROM = "20170101";
const BOND_INDEX_ETF_TAX_EXEMPT_TO = "20261231";
const MAX_TRADE_RECORDS = 500;

function computeTradeFee(price, shares, settings) {
  const discount = Number.isFinite(settings?.feeDiscount) ? settings.feeDiscount : 0.6;
  const minFee = Number.isFinite(settings?.minFee) ? settings.minFee : 20;
  return Math.max(minFee, Math.round(price * shares * TRADE_FEE_RATE * discount));
}

function computeTradeTax(price, shares, kind = "stock") {
  const rate = TRADE_TAX_RATES[kind] || TRADE_TAX_RATES.stock;
  return Math.floor(price * shares * rate);
}

function legacyInstrumentType(kind) {
  if (kind === "etf") return "unknownEtf";
  return "stock";
}

function normalizeTradeInstrumentType(raw) {
  const explicit = String(raw?.instrumentType || "");
  if (TRADE_INSTRUMENT_TYPES.has(explicit)) return explicit;
  return legacyInstrumentType(raw?.kind);
}

function isEtfLikeInstrument(instrumentType) {
  return new Set([
    "equityEtf",
    "unknownEtf",
    "bondIndexEtf",
    "leveragedInverseEtf",
    "activeEtf",
    "otherEtf",
  ]).has(instrumentType);
}

function hasTrustedOfficialInstrumentProvenance(raw) {
  return raw?.instrumentSource === "official"
    && Boolean(String(raw?.instrumentRuleId || "").trim())
    && isValidCompactCalendarDate(toCompactDate(raw?.instrumentAsOf));
}

// 債券指數 ETF 的停徵優惠必須有後端官方主檔 stamp；只有使用者選項時，
// 先按一般 ETF 0.1% 估算並要求覆核，避免把未確認優惠直接記成 0 元。
function taxEstimateInstrumentType(instrumentType, raw) {
  if (instrumentType === "bondIndexEtf" && !hasTrustedOfficialInstrumentProvenance(raw)) return "equityEtf";
  return instrumentType;
}

function normalizeTradeDayTrade(raw, shares) {
  const src = raw?.dayTrade && typeof raw.dayTrade === "object" ? raw.dayTrade : null;
  let status = src && TRADE_DAY_TRADE_STATUSES.has(src.status) ? src.status : "none";
  let matchedShares = Number(src?.matchedShares);
  if (!Number.isInteger(matchedShares) || matchedShares < 0) matchedShares = 0;
  matchedShares = Math.min(Math.max(0, matchedShares), Number.isInteger(shares) ? shares : 0);
  if (!src && raw?.kind === "dayTrade") {
    status = "legacyDeclared";
    matchedShares = 0;
  }
  if (status === "none" || status === "legacyDeclared") matchedShares = 0;
  const pairId = String(src?.pairId || "").trim().slice(0, 48);
  return { status, matchedShares, pairId };
}

function isConfirmedDayTradeStatus(status) {
  return status === "brokerConfirmed" || status === "userConfirmed";
}

// 現股當沖減半的合格股數必須是一個交易單位（1,000 股）的整數倍。
//
// 法源（2026-07-26 查證官方原文，不是二手新聞）：
//   《證券交易稅條例》§2-2 明文「適用前項規定稅率之股票交易，應依金融主管機關、證券交易所、
//     證券櫃檯買賣中心訂定之**有價證券當日沖銷交易作業相關規定**辦理」→ 作業辦法被稅法引用。
//   《有價證券當日沖銷交易作業辦法》§1 第 4 項：「**零股**、鉅額買賣、依證券交易所營業細則
//     第七十四條之交易…**不適用本辦法**。」TWSE「當日沖銷交易專區」同文。
//   普通交易與盤後定價交易的買賣單位都是 1,000 股，而「零股」的定義就是不足一個交易單位；
//   零股既然被排除，合格的沖銷數量必然是 1,000 的整數倍。
//
// ⚠ 最後一步是**推論**——法規沒有直接寫「配對股數必須是 1000 的倍數」。所以這個函式只用來
//   (a) 保守估稅：不足一整股單位的部分不給減半（與債券 ETF 缺官方 stamp 時「先按一般稅率估、
//       要求覆核」同一套處理），以及 (b) 標記待覆核讓使用者拿對帳單核對。**不硬擋輸入**，
//   因為券商實際稅額永遠優先，而且擋掉合法輸入的代價比高估稅額大。
//
// 順帶記錄兩件查證結果，避免後人重查或誤修：
//   • **盤後定價交易可以當沖**：作業辦法 §1 第 3 項「以普通交易收盤前之買賣間**及普通交易
//     收盤前之買賣與盤後定價交易間**之反向沖銷者為限」。所以 `afterHoursFixed` 不該被擋。
//   • **優惠期間到民國 116 年（2027）12 月 31 日**，`STOCK_DAY_TRADE_TAX_TO` 目前正確。
//     網路上仍能查到「到 2026 年底」的說法，那是舊版修法，已再次延長，不要照著改。
const STOCK_TRADING_UNIT_SHARES = 1000;
function dayTradeEligibleShares(matchedShares) {
  const shares = Number(matchedShares);
  if (!Number.isInteger(shares) || shares <= 0) return 0;
  return Math.floor(shares / STOCK_TRADING_UNIT_SHARES) * STOCK_TRADING_UNIT_SHARES;
}

// Effective-dated estimate only. Broker statement amounts always take precedence in normalization.
function computeTradeTaxRule({
  side = "sell",
  price,
  shares,
  date,
  instrumentType = "stock",
  dayTrade = { status: "none", matchedShares: 0 },
} = {}) {
  const unitPrice = Number(price);
  const quantity = Number(shares);
  const tradeDate = toCompactDate(date);
  const warnings = [];
  if (side !== "sell") {
    return {
      ruleId: "not-a-sale", rate: 0, taxableShares: 0, dayTradeShares: 0,
      amount: 0, effectiveTo: null, warnings,
    };
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
    return {
      ruleId: "invalid-trade", rate: null, taxableShares: 0, dayTradeShares: 0,
      amount: 0, effectiveTo: null,
      warnings: ["成交價或股數不正確，無法估算證交稅"],
    };
  }

  if (instrumentType === "stock") {
    const requestedMatched = isConfirmedDayTradeStatus(dayTrade?.status)
      ? Math.min(quantity, Math.max(0, Number(dayTrade?.matchedShares) || 0))
      : 0;
    const inReliefPeriod = Boolean(tradeDate)
      && tradeDate >= STOCK_DAY_TRADE_TAX_FROM
      && tradeDate <= STOCK_DAY_TRADE_TAX_TO;
    // 零股不適用當沖（作業辦法 §1(4)），所以不足一個交易單位的部分不給減半。
    const eligibleMatched = dayTradeEligibleShares(requestedMatched);
    const dayTradeShares = inReliefPeriod ? eligibleMatched : 0;
    if (requestedMatched > 0 && !inReliefPeriod) {
      warnings.push("成交日不在現股當沖減半課稅期間，已按一般股票稅率估算");
    }
    if (requestedMatched > eligibleMatched) {
      const oddShares = requestedMatched - eligibleMatched;
      warnings.push(`當沖配對股數 ${requestedMatched} 股不是 ${STOCK_TRADING_UNIT_SHARES} 股的整數倍，`
        + `其中 ${oddShares} 股按一般稅率估算（零股不適用現股當沖）。請與券商對帳單核對。`);
    }
    if (dayTrade?.status === "legacyDeclared") {
      warnings.push("舊版當沖標記缺少券商、帳戶與配對股數，未自動套用優惠稅率");
    }
    const regularShares = quantity - dayTradeShares;
    const amount = Math.floor(unitPrice * regularShares * TRADE_TAX_RATES.stock)
      + Math.floor(unitPrice * dayTradeShares * TRADE_TAX_RATES.dayTrade);
    return {
      ruleId: dayTradeShares > 0
        ? "tw-stock-daytrade-20170428-20271231"
        : "tw-stock-general-0.003",
      rate: dayTradeShares === quantity
        ? TRADE_TAX_RATES.dayTrade
        : dayTradeShares === 0 ? TRADE_TAX_RATES.stock : null,
      taxableShares: quantity,
      dayTradeShares,
      amount,
      effectiveTo: dayTradeShares > 0 ? STOCK_DAY_TRADE_TAX_TO : null,
      warnings,
    };
  }

  if (instrumentType === "bondIndexEtf") {
    const exempt = Boolean(tradeDate)
      && tradeDate >= BOND_INDEX_ETF_TAX_EXEMPT_FROM
      && tradeDate <= BOND_INDEX_ETF_TAX_EXEMPT_TO;
    if (!tradeDate) warnings.push("缺少有效成交日，無法判斷債券 ETF 停徵期間，已按 0.1% 估算");
    return {
      ruleId: exempt
        ? "tw-bond-index-etf-exempt-20170101-20261231"
        : "tw-etf-general-0.001",
      rate: exempt ? 0 : TRADE_TAX_RATES.etf,
      taxableShares: exempt ? 0 : quantity,
      dayTradeShares: 0,
      amount: exempt ? 0 : Math.floor(unitPrice * quantity * TRADE_TAX_RATES.etf),
      effectiveTo: exempt ? BOND_INDEX_ETF_TAX_EXEMPT_TO : null,
      warnings,
    };
  }

  if (isEtfLikeInstrument(instrumentType) || instrumentType === "etn") {
    if (isConfirmedDayTradeStatus(dayTrade?.status) && Number(dayTrade?.matchedShares) > 0) {
      warnings.push("股票當沖減半稅率不適用此商品；已依商品的一般稅率估算");
    }
    if (instrumentType === "unknownEtf") warnings.push("舊 ETF 類型未細分，請依官方商品資料覆核");
    return {
      ruleId: "tw-etf-etn-general-0.001",
      rate: TRADE_TAX_RATES.etf,
      taxableShares: quantity,
      dayTradeShares: 0,
      amount: Math.floor(unitPrice * quantity * TRADE_TAX_RATES.etf),
      effectiveTo: null,
      warnings,
    };
  }

  warnings.push("商品類型未能確認；未自動套用任何優惠，暫按一般股票 0.3% 估算");
  return {
    ruleId: "tw-unknown-conservative-0.003",
    rate: TRADE_TAX_RATES.stock,
    taxableShares: quantity,
    dayTradeShares: 0,
    amount: Math.floor(unitPrice * quantity * TRADE_TAX_RATES.stock),
    effectiveTo: null,
    warnings,
  };
}

// ---- 公司行動紀錄（D-22）----
// 帳本原本只認 buy/sell/dividend，而 dividend 只有「每股現金 × 股數」一種語意、不動持股與成本。
// 於是無償配股與現增之後，帳本的股數永遠停在配股前：
//   (a) 顯示面——1000 股均價 100 的持股配股 10% 後，實際是 1100 股均價 90.91、未實現 0，
//       帳本卻仍是 1000 股成本 100,000 配上 90.91 的現價 → 顯示未實現 −9,090（−9.1%）的假虧損；
//   (b) 功能面（更嚴重）——買 1000 股、配股後實際持有 1100 股，想賣 1100 股會被
//       buildPortfolio 的賣超檢查擋下，錯誤訊息還叫使用者「檢查買賣紀錄」，但紀錄是對的。
// 會計上其實很單純：無償配股＝以 0 元取得股票，現增＝以認購價取得股票，兩者都只是
// 「加股數、加成本」，均價自然稀釋。所以這裡只新增一種紀錄型別，portfolio 的數學保持單純。
// 比率欄位刻意與官方歸檔（corporateActionHistoryForCode）一致，之後才能由官方資料直接帶入。
// **減資尚未支援**：本機官方歸檔不涵蓋減資（見 stock1-domain），使用者得手填；而且現金減資的
// 成本處理（沖減成本 vs 認列已實現）是會計口徑選擇，需要使用者拍板，不在這批。
const TRADE_CORPORATE_ACTION_SIDE = "corporateAction";
const TRADE_SIDES = new Set(["buy", "sell", "dividend", TRADE_CORPORATE_ACTION_SIDE]);
function readCorporateActionRatios(raw) {
  const num = (value) => {
    if (value === null || value === undefined || String(value).trim() === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
  };
  return {
    stockRatio: num(raw?.stockRatio),
    subscriptionRatio: num(raw?.subscriptionRatio),
    subscriptionPrice: num(raw?.subscriptionPrice),
  };
}
// 回傳錯誤字串陣列；空陣列＝通過。驗證與正規化共用同一套規則，避免兩邊分岔。
function corporateActionErrors(raw) {
  const errors = [];
  const { stockRatio, subscriptionRatio, subscriptionPrice } = readCorporateActionRatios(raw);
  if (!Number.isFinite(stockRatio)) errors.push("無償配股率必須是 0 或正數");
  if (!Number.isFinite(subscriptionRatio)) errors.push("現增配股率必須是 0 或正數");
  if (!Number.isFinite(subscriptionPrice)) errors.push("現增認購價必須是 0 或正數");
  if (Number.isFinite(stockRatio) && Number.isFinite(subscriptionRatio)
    && stockRatio === 0 && subscriptionRatio === 0) {
    errors.push("公司行動至少要有無償配股率或現增配股率其中一項大於 0");
  }
  // 單次無償配股率超過 1（每股配超過 1 股）極為罕見，多半是把「每仟股配股數」當成比率填進來。
  if (Number.isFinite(stockRatio) && stockRatio > 1) errors.push("無償配股率大於 1，請確認不是每仟股配股數");
  if (Number.isFinite(subscriptionRatio) && subscriptionRatio > 1) errors.push("現增配股率大於 1，請確認單位");
  if (Number.isFinite(subscriptionRatio) && subscriptionRatio > 0
    && (!Number.isFinite(subscriptionPrice) || subscriptionPrice <= 0)) {
    errors.push("有現增配股率時必須提供大於 0 的認購價");
  }
  return errors;
}

function normalizeTradeSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const feeDiscount = Number(src.feeDiscount);
  const minFee = Number(src.minFee);
  return {
    feeDiscount: Number.isFinite(feeDiscount) && feeDiscount > 0 && feeDiscount <= 1
      ? Math.round(feeDiscount * 100) / 100
      : 0.6,
    minFee: Number.isFinite(minFee) && minFee >= 0 && minFee <= 100 ? Math.round(minFee) : 20,
  };
}

function isValidCompactCalendarDate(value) {
  const compact = String(value || "");
  if (!/^\d{8}$/.test(compact)) return false;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function effectiveDividendStatus(raw) {
  if (raw?.status === "receivable" || raw?.status === "received") return raw.status;
  const official = Boolean(String(raw?.eventId || "").trim()) || raw?.source === "official-event";
  return official ? "receivable" : "received";
}

function effectiveTradeFee(raw, side, price, shares, settings, dividendStatus = effectiveDividendStatus(raw)) {
  if (side === "dividend" && raw?.fee === null) return null;
  const supplied = Number(raw?.fee);
  if (Number.isFinite(supplied) && supplied >= 0) return Math.round(supplied);
  if (side === "dividend") return dividendStatus === "received" ? 10 : null;
  return computeTradeFee(price, shares, settings);
}

function tradeEconomicFingerprint(raw, settings) {
  const side = raw.side;
  const kind = raw.kind == null || raw.kind === "" ? "stock" : raw.kind;
  const instrumentType = normalizeTradeInstrumentType(raw);
  const priceValue = Number(raw.price);
  const shares = Number(raw.shares);
  const price = side === "dividend"
    ? Math.round(priceValue * 1e6) / 1e6
    : Math.round(priceValue * 100) / 100;
  const date = toCompactDate(raw.tradeDate || raw.date);
  const dayTrade = normalizeTradeDayTrade(raw, shares);
  const dividendStatus = side === "dividend" ? effectiveDividendStatus(raw) : "";
  const suppliedFee = readSuppliedTradeMoney(raw, "feeAmountTwd", "fee", { allowNull: side === "dividend" });
  const suppliedTax = readSuppliedTradeMoney(raw, "taxAmountTwd", "tax");
  const fee = suppliedFee.valid
    ? suppliedFee.value
    : effectiveTradeFee({}, side, priceValue, shares, settings, dividendStatus);
  const estimatedTax = computeTradeTaxRule({
    side,
    price: priceValue,
    shares,
    date,
    instrumentType: taxEstimateInstrumentType(instrumentType, raw),
    dayTrade,
  });
  const tax = side !== "sell"
    ? 0
    : suppliedTax.valid
      ? suppliedTax.value
      : kind === "dayTrade" && !raw.instrumentType
        ? computeTradeTax(priceValue, shares, "dayTrade")
        : estimatedTax.amount;
  const suppliedReceivedDate = raw.receivedDate ? toCompactDate(raw.receivedDate) : "";
  const receivedDate = dividendStatus === "received"
    ? (suppliedReceivedDate || date)
    : "";
  const suppliedReceivedAmount = Number(raw.receivedAmount);
  const receivedAmount = dividendStatus === "received"
    ? (Number.isFinite(suppliedReceivedAmount) && suppliedReceivedAmount >= 0
        ? Math.round(suppliedReceivedAmount * 100) / 100
        : Math.max(0, Math.round((priceValue * shares - (fee || 0)) * 100) / 100))
    : null;
  return JSON.stringify({
    code: cleanCode(raw.code),
    side,
    kind,
    instrumentType,
    instrumentSource: String(raw.instrumentSource || ""),
    date,
    price,
    shares,
    dayTrade,
    fee,
    feeSource: String(raw.feeSource || ""),
    feeRuleId: String(raw.feeRuleId || ""),
    tax,
    taxSource: String(raw.taxSource || ""),
    taxRuleId: String(raw.taxRuleId || ""),
    market: String(raw.market || ""),
    brokerAccountId: String(raw.brokerAccountId || ""),
    session: String(raw.session || ""),
    executedAt: String(raw.executedAt || ""),
    eventId: side === "dividend" ? String(raw.eventId || "").trim() : "",
    status: dividendStatus,
    receivedDate,
    receivedAmount,
  });
}

// PUT /api/trades 專用的嚴格驗證：任何一筆錯誤都拒絕整包，避免正規化時
// 靜默丟資料後仍回 200。GET 仍走 normalizeTradesPayload 容錯讀取舊資料。
function validateTradesMutationInput(input, todayCompact = toTaipeiCompactDate()) {
  const errors = [];
  const addError = (field, message, index = null) => {
    if (errors.length >= 20) return;
    const error = { field, message };
    if (index != null) error.index = index;
    errors.push(error);
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    addError("body", "交易帳本格式不正確");
    return { ok: false, errors };
  }
  const suppliedSchemaVersion = input.schemaVersion == null ? 1 : Number(input.schemaVersion);
  if (!Number.isInteger(suppliedSchemaVersion) || suppliedSchemaVersion < 1 || suppliedSchemaVersion > TRADE_SCHEMA_VERSION) {
    addError("schemaVersion", `不支援的交易帳本版本；目前最高支援 v${TRADE_SCHEMA_VERSION}`);
  }

  const settingsInput = input.settings;
  if (!settingsInput || typeof settingsInput !== "object" || Array.isArray(settingsInput)) {
    addError("settings", "settings 必須是物件");
  } else {
    const discount = settingsInput.feeDiscount;
    const minFee = settingsInput.minFee;
    if (typeof discount !== "number" || !Number.isFinite(discount) || discount <= 0 || discount > 1) {
      addError("settings.feeDiscount", "手續費折數必須是 0 到 1 之間的數字");
    }
    if (typeof minFee !== "number" || !Number.isInteger(minFee) || minFee < 0 || minFee > 100) {
      addError("settings.minFee", "最低手續費必須是 0 到 100 的整數");
    }
  }

  if (!Array.isArray(input.records)) {
    addError("records", "records 必須是陣列");
    return { ok: false, errors };
  }
  if (input.records.length > MAX_TRADE_RECORDS) {
    addError("records", `交易紀錄最多 ${MAX_TRADE_RECORDS} 筆，請先刪除舊紀錄再新增`);
  }

  const settings = normalizeTradeSettings(settingsInput);
  const today = isValidCompactCalendarDate(String(todayCompact || ""))
    ? String(todayCompact)
    : toTaipeiCompactDate();
  const idFingerprints = new Map();
  const eventFingerprints = new Map();
  for (let index = 0; index < input.records.length && errors.length < 20; index += 1) {
    const raw = input.records[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      addError("record", "每筆交易紀錄都必須是物件", index);
      continue;
    }
    const before = errors.length;
    const code = cleanCode(raw.code);
    const side = raw.side;
    const kind = raw.kind == null || raw.kind === "" ? "stock" : raw.kind;
    const hasExplicitInstrument = raw.instrumentType != null && raw.instrumentType !== "";
    const instrumentType = normalizeTradeInstrumentType(raw);
    const price = Number(raw.price);
    const shares = Number(raw.shares);
    const date = toCompactDate(raw.tradeDate || raw.date);
    const id = String(raw.id || "").trim();
    const eventId = String(raw.eventId || "").trim();
    const dividendStatus = side === "dividend" ? effectiveDividendStatus(raw) : "";

    if (!SECURITY_CODE_PATTERN.test(code)) addError("code", "股票代號必須是 4～6 碼英數字", index);
    if (!TRADE_SIDES.has(side)) addError("side", "買賣類型只接受 buy、sell、dividend 或 corporateAction", index);
    // 公司行動（除權／現增）沒有成交價與股數，走獨立規則；其餘欄位驗證一律跳過，
    // 避免為了遷就它而放寬買賣紀錄的既有防線。
    if (side === TRADE_CORPORATE_ACTION_SIDE) {
      if (!date || !isValidCompactCalendarDate(date)) addError("tradeDate", "除權基準日不是有效日期", index);
      else if (date > today) addError("tradeDate", "除權基準日位於未來", index);
      for (const message of corporateActionErrors(raw)) addError("corporateAction", message, index);
      // 沿用買賣紀錄同一套「同 id 內容衝突」規則：同一筆公司行動重送要冪等，內容不同才是錯誤。
      if (id) {
        const fingerprint = stableJson({
          side, code, date,
          ...readCorporateActionRatios(raw),
        });
        const previous = idFingerprints.get(id);
        if (previous && previous !== fingerprint) addError("id", `重複 id「${id}」的公司行動內容互相衝突`, index);
        else idFingerprints.set(id, fingerprint);
      }
      continue;
    }
    if (raw.kind != null && raw.kind !== "" && !new Set(["stock", "etf", "dayTrade"]).has(kind)) {
      addError("kind", "舊版商品類型只接受 stock、etf 或 dayTrade", index);
    }
    if (hasExplicitInstrument && !TRADE_INSTRUMENT_TYPES.has(String(raw.instrumentType))) {
      addError("instrumentType", "商品類型無法辨識", index);
    } else if (suppliedSchemaVersion === TRADE_SCHEMA_VERSION && !hasExplicitInstrument) {
      addError("instrumentType", "v2 交易紀錄必須提供商品類型", index);
    }
    if (!Number.isFinite(price) || price <= 0) addError("price", "成交價必須是大於 0 的數字", index);
    if (!Number.isInteger(shares) || shares <= 0) addError("shares", "股數必須是大於 0 的整數", index);
    if (raw.instrumentSource != null && !TRADE_INSTRUMENT_SOURCES.has(raw.instrumentSource)) {
      addError("instrumentSource", "商品分類來源無法辨識", index);
    }
    if (raw.instrumentSource === "official" && !hasTrustedOfficialInstrumentProvenance(raw)) {
      addError("instrumentSource", "官方商品分類缺少後端驗證憑據", index);
    }
    if (raw.instrumentRuleId != null && String(raw.instrumentRuleId).length > 80) {
      addError("instrumentRuleId", "商品分類規則代號過長", index);
    }
    if (raw.instrumentAsOf != null && raw.instrumentAsOf !== "") {
      const instrumentAsOf = toCompactDate(raw.instrumentAsOf);
      if (!isValidCompactCalendarDate(instrumentAsOf) || instrumentAsOf > today) {
        addError("instrumentAsOf", "商品分類資料日不是有效日期", index);
      }
    }
    if (raw.market != null && !TRADE_MARKETS.has(raw.market)) addError("market", "市場別無法辨識", index);
    if (raw.session != null && !TRADE_SESSIONS.has(raw.session)) addError("session", "交易時段無法辨識", index);
    if (raw.currency != null && raw.currency !== "TWD") addError("currency", "目前交易帳本只支援新台幣 TWD", index);
    if (raw.brokerAccountId != null && (typeof raw.brokerAccountId !== "string" || raw.brokerAccountId.trim().length > 48)) {
      addError("brokerAccountId", "券商帳戶識別格式不正確", index);
    }
    if (raw.executedAt != null) {
      const executedAt = typeof raw.executedAt === "string" ? raw.executedAt.trim() : "";
      const invalidFormat = (
        typeof raw.executedAt !== "string"
        || raw.executedAt.length > 40
        || (executedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(executedAt))
      );
      if (invalidFormat) {
        addError("executedAt", "成交時間必須是含時區的 ISO 日期時間，或留白", index);
      } else if (executedAt) {
        const executedInstant = new Date(executedAt);
        if (Number.isNaN(executedInstant.getTime())) {
          addError("executedAt", "成交時間不是有效的 ISO 日期時間", index);
        } else if (date && isValidCompactCalendarDate(date) && toTaipeiCompactDate(executedInstant) !== date) {
          addError("executedAt", "成交時間換算後的台北成交日必須與成交日一致", index);
        }
      }
    }
    if (raw.dayTrade != null) {
      if (!raw.dayTrade || typeof raw.dayTrade !== "object" || Array.isArray(raw.dayTrade)) {
        addError("dayTrade", "當沖資料必須是物件", index);
      } else {
        const matched = raw.dayTrade.matchedShares;
        if (!TRADE_DAY_TRADE_STATUSES.has(raw.dayTrade.status)) addError("dayTrade.status", "當沖確認狀態無法辨識", index);
        if (!Number.isInteger(matched) || matched < 0 || (Number.isInteger(shares) && matched > shares)) {
          addError("dayTrade.matchedShares", "當沖配對股數必須是 0 到成交股數之間的整數", index);
        }
        if (isConfirmedDayTradeStatus(raw.dayTrade.status)) {
          if (side !== "sell") addError("dayTrade.status", "當沖優惠只標記在實際沖銷的賣出紀錄", index);
          if (instrumentType !== "stock") addError("dayTrade.status", "股票當沖減半稅率不適用此商品", index);
          if (!Number.isInteger(matched) || matched <= 0) addError("dayTrade.matchedShares", "已確認當沖時必須填實際配對股數", index);
          if (raw.session === "oddLot" || raw.session === "block") addError("session", "零股或鉅額交易不適用現股當沖", index);
        } else if (Number(matched) > 0) {
          addError("dayTrade.matchedShares", "未確認當沖時配對股數必須為 0", index);
        }
        if (raw.dayTrade.pairId != null && (typeof raw.dayTrade.pairId !== "string" || raw.dayTrade.pairId.length > 48)) {
          addError("dayTrade.pairId", "當沖配對識別碼不可超過 48 字元", index);
        }
      }
    } else if (suppliedSchemaVersion === TRADE_SCHEMA_VERSION) {
      addError("dayTrade", "v2 交易紀錄必須提供當沖資料", index);
    }
    if (raw.reviewStatus != null && !TRADE_REVIEW_STATUSES.has(raw.reviewStatus)) {
      addError("reviewStatus", "覆核狀態無法辨識", index);
    }
    if (raw.reviewReasons != null && (
      !Array.isArray(raw.reviewReasons)
      || raw.reviewReasons.length > 12
      || raw.reviewReasons.some((reason) => typeof reason !== "string" || reason.length > 120)
    )) addError("reviewReasons", "覆核原因必須是最多 12 筆、每筆不超過 120 字的文字陣列", index);
    for (const ruleField of ["feeRuleId", "taxRuleId"]) {
      if (raw[ruleField] != null && (typeof raw[ruleField] !== "string" || raw[ruleField].length > 80)) {
        addError(ruleField, "費稅規則識別碼不可超過 80 字元", index);
      }
    }
    if (side === "dividend" && raw.status != null && !["receivable", "received"].includes(raw.status)) {
      addError("status", "股利狀態只接受 receivable 或 received", index);
    }
    if (!date || !isValidCompactCalendarDate(date)) {
      addError("date", "成交日不是有效日期", index);
    } else if (date > today) {
      addError("date", "成交日不可晚於台北今天（不可輸入未來日期）", index);
    }
    for (const [field, label] of [["fee", "手續費"], ["tax", "稅額"], ["feeAmountTwd", "手續費"], ["taxAmountTwd", "證交稅"]]) {
      if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
      const value = raw[field];
      if ((field === "fee" || field === "feeAmountTwd") && side === "dividend" && value === null) continue;
      if (value === null || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) {
        addError(field, `${label}若有提供，必須是大於或等於 0 的數字`, index);
      }
    }
    for (const [field, amountFields] of [["feeSource", ["feeAmountTwd", "fee"]], ["taxSource", ["taxAmountTwd", "tax"]]]) {
      if (raw[field] == null) continue;
      if (!TRADE_MONEY_SOURCES.has(raw[field])) {
        addError(field, "費稅來源無法辨識", index);
        continue;
      }
      if (["manual", "broker"].includes(raw[field])) {
        const hasAmount = amountFields.some((amountField) => {
          if (!Object.prototype.hasOwnProperty.call(raw, amountField)) return false;
          const amount = raw[amountField];
          return amount !== null && amount !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;
        });
        if (!hasAmount) addError(field, "手填或券商實際來源必須同時提供非負金額", index);
      }
    }
    const suppliedTaxAmount = Object.prototype.hasOwnProperty.call(raw, "taxAmountTwd")
      ? Number(raw.taxAmountTwd)
      : Object.prototype.hasOwnProperty.call(raw, "tax") ? Number(raw.tax) : 0;
    if (side !== "sell" && Number.isFinite(suppliedTaxAmount) && suppliedTaxAmount !== 0) {
      addError("taxAmountTwd", "非賣出交易的證交稅必須為 0", index);
    }
    if (id.length > 48) addError("id", "交易識別碼不可超過 48 字元", index);
    if (eventId.length > 64) addError("eventId", "股利事件識別碼不可超過 64 字元", index);
    if (side === "dividend" && raw.exDate != null && raw.exDate !== "") {
      const exDate = toCompactDate(raw.exDate);
      if (!exDate || !isValidCompactCalendarDate(exDate) || exDate > today) {
        addError("exDate", "除息日不是有效日期，或晚於台北今天", index);
      }
    }
    if (side === "dividend" && raw.receivedDate != null && raw.receivedDate !== "") {
      const receivedDate = toCompactDate(raw.receivedDate);
      if (!receivedDate || !isValidCompactCalendarDate(receivedDate) || receivedDate > today) {
        addError("receivedDate", "股利入帳日不是有效日期，或晚於台北今天", index);
      } else if (date && receivedDate < date) {
        addError("receivedDate", "股利入帳日不可早於認列日", index);
      } else if (dividendStatus === "receivable") {
        addError("receivedDate", "待入帳股利不可先填入帳日", index);
      }
    }
    if (side === "dividend" && Object.prototype.hasOwnProperty.call(raw, "receivedAmount")) {
      const receivedAmount = raw.receivedAmount;
      if (receivedAmount === null) {
        // null 是明確未知，不是 0 元；receivable 與舊 received 紀錄都可相容。
      } else if (typeof receivedAmount !== "number" || !Number.isFinite(receivedAmount) || receivedAmount < 0) {
        addError("receivedAmount", "股利實收金額必須是大於或等於 0 的數字", index);
      } else if (dividendStatus === "receivable") {
        addError("receivedAmount", "待入帳股利不可先填實收金額", index);
      }
    }
    if (errors.length !== before) continue;

    const fingerprint = tradeEconomicFingerprint(raw, settings);
    if (id) {
      const previous = idFingerprints.get(id);
      if (previous && previous !== fingerprint) addError("id", `重複 id「${id}」的交易內容互相衝突`, index);
      else idFingerprints.set(id, fingerprint);
    }
    if (side === "dividend" && eventId) {
      const previous = eventFingerprints.get(eventId);
      if (previous && previous !== fingerprint) addError("eventId", `重複股利事件「${eventId}」的內容互相衝突`, index);
      else eventFingerprints.set(eventId, fingerprint);
    }
  }
  return { ok: errors.length === 0, errors };
}

function readSuppliedTradeMoney(raw, canonicalField, legacyField, { allowNull = false } = {}) {
  for (const field of [canonicalField, legacyField]) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    const supplied = raw[field];
    if (allowNull && supplied === null) return { present: true, valid: true, value: null, field };
    if (supplied === null || supplied === "") return { present: true, valid: false, value: null, field };
    const value = Number(supplied);
    if (Number.isFinite(value) && value >= 0) {
      return { present: true, valid: true, value: Math.round(value), field };
    }
    return { present: true, valid: false, value: null, field };
  }
  return { present: false, valid: false, value: null, field: "" };
}

function normalizeReviewReasons(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    .slice(0, 12)
    .map((item) => item.slice(0, 120));
}

function safeQuarantinedRecord(raw) {
  try {
    const text = JSON.stringify(raw);
    if (!text || text.length > 8_000) return { id: String(raw?.id || "").slice(0, 48) };
    return JSON.parse(text);
  } catch {
    return { id: String(raw?.id || "").slice(0, 48) };
  }
}

function normalizeQuarantinedRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TRADE_RECORDS).map((item, index) => ({
    index: Number.isInteger(item?.index) ? item.index : index,
    reasons: normalizeReviewReasons(item?.reasons).length
      ? normalizeReviewReasons(item.reasons)
      : ["舊資料格式無法安全轉換"],
    record: safeQuarantinedRecord(item?.record ?? item),
  }));
}

function tradeRecordCoreErrors(raw, today) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["紀錄不是物件"];
  const code = cleanCode(raw.code);
  const side = TRADE_SIDES.has(raw.side) ? raw.side : "";
  if (side === TRADE_CORPORATE_ACTION_SIDE) {
    // 公司行動沒有成交價、股數與商品類型；共用 corporateActionErrors 避免與 validator 分岔。
    const actionErrors = [];
    if (!SECURITY_CODE_PATTERN.test(cleanCode(raw.code))) actionErrors.push("代號不是 4～6 碼英數字");
    const actionDate = toCompactDate(raw.tradeDate || raw.date);
    if (!actionDate || !isValidCompactCalendarDate(actionDate)) actionErrors.push("除權基準日不是有效日期");
    else if (actionDate > today) actionErrors.push("除權基準日位於未來");
    actionErrors.push(...corporateActionErrors(raw));
    return actionErrors;
  }
  const hasExplicitInstrument = raw.instrumentType != null && raw.instrumentType !== "";
  const legacyKind = raw.kind == null || raw.kind === "" ? "stock" : raw.kind;
  const instrumentType = normalizeTradeInstrumentType(raw);
  const price = Number(raw.price);
  const shares = Number(raw.shares);
  const date = toCompactDate(raw.tradeDate || raw.date);
  if (!SECURITY_CODE_PATTERN.test(code)) errors.push("代號不是 4～6 碼英數字");
  if (!side) errors.push("買賣別無法辨識");
  if (hasExplicitInstrument && !TRADE_INSTRUMENT_TYPES.has(String(raw.instrumentType))) errors.push("商品類型無法辨識");
  if (!hasExplicitInstrument && !["stock", "etf", "dayTrade"].includes(legacyKind)) errors.push("舊商品類型無法辨識");
  if (!TRADE_INSTRUMENT_TYPES.has(instrumentType)) errors.push("商品類型無法安全轉換");
  if (!Number.isFinite(price) || price <= 0) errors.push("成交價不是正數");
  if (!Number.isInteger(shares) || shares <= 0) errors.push("股數不是正整數");
  if (!date || !isValidCompactCalendarDate(date)) errors.push("成交日不是有效日期");
  else if (date > today) errors.push("成交日位於未來");
  return errors;
}

function normalizeTradeRecordV2(raw, { settings, today, index, payloadIsV2 }) {
  const code = cleanCode(raw.code);
  const side = raw.side;
  if (side === TRADE_CORPORATE_ACTION_SIDE) {
    // 公司行動是「事件」不是「成交」：沒有價金、沒有費稅、沒有商品分類與當沖。
    // 只保留代號、基準日與三個比率；不塞 price/shares 假值，免得下游誤把它當成一筆買賣。
    const ratios = readCorporateActionRatios(raw);
    return {
      id: String(raw.id || "").trim() || `ca-${code}-${toCompactDate(raw.tradeDate || raw.date)}`,
      code,
      side: TRADE_CORPORATE_ACTION_SIDE,
      tradeDate: toCompactDate(raw.tradeDate || raw.date),
      date: toCompactDate(raw.tradeDate || raw.date), // 舊 alias，排序與顯示共用
      stockRatio: ratios.stockRatio,
      subscriptionRatio: ratios.subscriptionRatio,
      subscriptionPrice: ratios.subscriptionPrice,
      source: TRADE_INSTRUMENT_SOURCES.has(raw.source) ? raw.source : "user",
      note: String(raw.note || "").slice(0, 60),
      createdAt: String(raw.createdAt || new Date().toISOString()),
      __inputOrder: index,
    };
  }
  const priceValue = Number(raw.price);
  const price = side === "dividend"
    ? Math.round(priceValue * 1e6) / 1e6
    : Math.round(priceValue * 100) / 100;
  const shares = Number(raw.shares);
  const date = toCompactDate(raw.tradeDate || raw.date);
  const instrumentType = normalizeTradeInstrumentType(raw);
  const legacyRecord = !payloadIsV2 && raw.instrumentType == null;
  const requestedInstrumentSource = TRADE_INSTRUMENT_SOURCES.has(raw.instrumentSource)
    ? raw.instrumentSource
    : legacyRecord ? "legacy" : "user";
  const invalidOfficialProvenance = requestedInstrumentSource === "official"
    && !hasTrustedOfficialInstrumentProvenance(raw);
  const instrumentSource = invalidOfficialProvenance ? (legacyRecord ? "legacy" : "user") : requestedInstrumentSource;
  const instrumentRuleId = instrumentSource === "official"
    ? String(raw.instrumentRuleId || "").trim().slice(0, 80)
    : "";
  const instrumentAsOf = instrumentSource === "official" ? toCompactDate(raw.instrumentAsOf) : "";
  const dayTrade = normalizeTradeDayTrade(raw, shares);
  const dividendStatus = side === "dividend" ? effectiveDividendStatus(raw) : "";
  const taxEstimate = computeTradeTaxRule({
    side,
    price,
    shares,
    date,
    instrumentType: taxEstimateInstrumentType(instrumentType, {
      instrumentSource,
      instrumentRuleId,
      instrumentAsOf,
    }),
    dayTrade,
  });
  const feeSupplied = readSuppliedTradeMoney(raw, "feeAmountTwd", "fee", { allowNull: side === "dividend" });
  const taxSupplied = readSuppliedTradeMoney(raw, "taxAmountTwd", "tax");
  const legacyNullFee = legacyRecord
    && side !== "dividend"
    && !Object.prototype.hasOwnProperty.call(raw, "feeAmountTwd")
    && Object.prototype.hasOwnProperty.call(raw, "fee")
    && raw.fee === null;
  const legacyNullTax = legacyRecord
    && !Object.prototype.hasOwnProperty.call(raw, "taxAmountTwd")
    && Object.prototype.hasOwnProperty.call(raw, "tax")
    && raw.tax === null;
  const reviewReasons = normalizeReviewReasons(raw.reviewReasons);

  let fee;
  if (feeSupplied.valid) fee = feeSupplied.value;
  else if (legacyNullFee) fee = 0;
  else fee = effectiveTradeFee({}, side, price, shares, settings, dividendStatus);
  let feeSource = TRADE_MONEY_SOURCES.has(raw.feeSource)
    ? raw.feeSource
    : feeSupplied.valid ? (legacyRecord ? "legacy" : "manual") : (legacyRecord ? "legacy" : "estimated");
  if (feeSupplied.present && !feeSupplied.valid) {
    reviewReasons.push(legacyNullFee
      ? "舊版 null 手續費曾被解讀為 0 元，已原值凍結並待覆核"
      : "原手續費欄位無效，已依舊版估算規則凍結替代值");
    feeSource = legacyRecord ? "legacy" : "estimated";
  }

  let tax;
  let taxSource;
  let taxRuleId;
  if (side !== "sell") {
    tax = 0;
    taxSource = "estimated";
    taxRuleId = "not-a-sale";
  } else if (taxSupplied.valid || legacyNullTax) {
    tax = legacyNullTax ? 0 : taxSupplied.value;
    taxSource = TRADE_MONEY_SOURCES.has(raw.taxSource)
      ? raw.taxSource
      : legacyRecord ? "legacy" : "manual";
    taxRuleId = String(raw.taxRuleId || `${taxSource}-frozen`).slice(0, 80);
  // 舊版 dayTrade 但沒帶 tax 的紀錄：這裡沒有任何金額可以「凍結」，是憑空產生一筆估算。
  // 舊寫法直接呼叫沒有日期參數的 computeTradeTax(..., "dayTrade")，繞過 computeTradeTaxRule 的
  // 有效日期判斷，讓 2017-04-28 減半上路前（以及 2027-12-31 之後）的成交日也享 1.5‰、稅短計一半，
  // 還和同一筆的「未自動套用優惠稅率」warning 自相矛盾。改為落到下方 taxEstimate：
  // legacyDeclared 的 matchedShares 已被 normalizeTradeDayTrade 歸零，自然回 tw-stock-general-0.003
  // 並保有有效日期邊界；taxSource 仍維持 legacy。
  } else {
    tax = taxEstimate.amount;
    taxSource = legacyRecord ? "legacy" : "estimated";
    taxRuleId = taxEstimate.ruleId;
  }
  if (taxSupplied.present && !taxSupplied.valid) {
    reviewReasons.push(legacyNullTax
      ? "舊版 null 證交稅曾被解讀為 0 元，已原值凍結並待覆核"
      : "原證交稅欄位無效，已依估算規則凍結替代值");
  }

  if (invalidOfficialProvenance) reviewReasons.push("舊版官方分類缺少後端驗證憑據，已降級為待覆核");
  if (instrumentSource === "legacy") reviewReasons.push("商品分類來自舊版使用者選項，尚未與官方商品主檔核對");
  if (instrumentSource === "user") reviewReasons.push("商品分類尚未由後端官方商品主檔確認");
  if (instrumentType === "unknownEtf") reviewReasons.push("舊版 ETF 未區分股票、債券、槓反或主動式類型");
  if (instrumentType === "bondIndexEtf" && instrumentSource !== "official" && taxSource !== "broker") {
    reviewReasons.push("債券指數 ETF 停徵資格尚未由官方商品主檔或券商實際稅額確認");
  }
  if (instrumentType === "other") reviewReasons.push("商品類型待確認，稅額僅為保守估算");
  if (dayTrade.status === "legacyDeclared") reviewReasons.push("舊版當沖缺少券商確認與實際配對股數");
  if (dayTrade.status === "userConfirmed" && taxSource !== "broker") reviewReasons.push("當沖資格尚未由券商實際資料確認");
  reviewReasons.push(...taxEstimate.warnings);
  const normalizedReasons = normalizeReviewReasons(reviewReasons);
  const reviewStatus = TRADE_REVIEW_STATUSES.has(raw.reviewStatus)
    ? (normalizedReasons.length ? "needsReview" : raw.reviewStatus)
    : normalizedReasons.length ? "needsReview" : "ok";
  const receivedDateRaw = raw.receivedDate ? toCompactDate(raw.receivedDate) : "";
  const receivedDate = side === "dividend" && dividendStatus === "received"
    ? (receivedDateRaw && isValidCompactCalendarDate(receivedDateRaw) && receivedDateRaw <= today ? receivedDateRaw : date)
    : null;
  const suppliedReceivedAmount = Number(raw.receivedAmount);
  const receivedAmount = side === "dividend" && dividendStatus === "received"
    ? (Number.isFinite(suppliedReceivedAmount) && suppliedReceivedAmount >= 0
        ? Math.round(suppliedReceivedAmount * 100) / 100
        : Math.max(0, Math.round((price * shares - (fee || 0)) * 100) / 100))
    : null;
  const market = TRADE_MARKETS.has(raw.market) ? raw.market : "unknown";
  const session = TRADE_SESSIONS.has(raw.session) ? raw.session : "unknown";
  const brokerAccountId = String(raw.brokerAccountId || (legacyRecord ? "legacy-unknown" : "default"))
    .trim().slice(0, 48) || "default";
  const id = String(raw.id || `${code}-${date}-${index}`).slice(0, 48);
  const normalizedRecord = {
    id,
    code,
    market,
    instrumentType,
    instrumentSource,
    ...(instrumentSource === "official" ? { instrumentRuleId, instrumentAsOf } : {}),
    side,
    kind: instrumentType === "stock" ? "stock" : isEtfLikeInstrument(instrumentType) || instrumentType === "etn" ? "etf" : "stock",
    date,
    tradeDate: date,
    executedAt: String(raw.executedAt || "").trim().slice(0, 40),
    session,
    brokerAccountId,
    currency: "TWD",
    price,
    shares,
    grossAmountTwd: Math.round(price * shares * 100) / 100,
    dayTrade,
    fee,
    feeAmountTwd: fee,
    feeSource,
    feeRuleId: String(raw.feeRuleId || (feeSource === "estimated" ? "broker-profile-default-estimate" : `${feeSource}-frozen`)).slice(0, 80),
    tax,
    taxAmountTwd: tax,
    taxSource,
    taxRuleId,
    reviewStatus,
    reviewReasons: normalizedReasons,
    note: String(raw.note || "").trim().slice(0, 60),
    createdAt: String(raw.createdAt || "").slice(0, 40),
  };
  if (legacyRecord || raw.legacyKind) {
    normalizedRecord.legacyKind = String(raw.legacyKind || (raw.kind == null || raw.kind === "" ? "stock" : raw.kind)).slice(0, 20);
  }
  if (side === "dividend") {
    normalizedRecord.status = dividendStatus;
    normalizedRecord.receivedDate = receivedDate;
    normalizedRecord.receivedAmount = receivedAmount;
    normalizedRecord.entitledShares = shares;
    const eventId = String(raw.eventId || "").trim().slice(0, 64);
    if (eventId) {
      normalizedRecord.eventId = eventId;
      normalizedRecord.exDate = toCompactDate(raw.exDate) || date;
      normalizedRecord.source = String(raw.source || "official-event").slice(0, 32);
    } else if (raw.source) {
      normalizedRecord.source = String(raw.source).slice(0, 32);
    }
  }
  return normalizedRecord;
}

function validTradeInstantMs(value) {
  if (!String(value || "").trim()) return null;
  const instant = Date.parse(String(value));
  return Number.isFinite(instant) ? instant : null;
}

function compareTradeChronology(a, b) {
  const dateSort = String(a?.date || "").localeCompare(String(b?.date || ""));
  if (dateSort) return dateSort;
  const executionA = validTradeInstantMs(a?.executedAt);
  const executionB = validTradeInstantMs(b?.executedAt);
  if (executionA !== null && executionB !== null && executionA !== executionB) return executionA - executionB;
  const createdA = validTradeInstantMs(a?.createdAt);
  const createdB = validTradeInstantMs(b?.createdAt);
  if (createdA !== null && createdB !== null && createdA !== createdB) return createdA - createdB;
  return Number(a?.__inputOrder || 0) - Number(b?.__inputOrder || 0);
}

function normalizeTradesPayload(input, options = {}) {
  const src = input && typeof input === "object" ? input : {};
  const settings = normalizeTradeSettings(src.settings);
  const today = isValidCompactCalendarDate(String(options.todayCompact || ""))
    ? String(options.todayCompact)
    : toTaipeiCompactDate();
  const payloadIsV2 = Number(src.schemaVersion) === TRADE_SCHEMA_VERSION;
  const records = [];
  const quarantinedRecords = normalizeQuarantinedRecords(src.quarantinedRecords);
  const seenIds = new Set();
  const seenDividendEvents = new Set();
  const list = Array.isArray(src.records) ? src.records : [];
  list.forEach((raw, index) => {
    const reasons = tradeRecordCoreErrors(raw, today);
    if (reasons.length) {
      quarantinedRecords.push({ index, reasons, record: safeQuarantinedRecord(raw) });
      return;
    }
    const record = normalizeTradeRecordV2(raw, { settings, today, index, payloadIsV2 });
    if (seenIds.has(record.id)) {
      quarantinedRecords.push({ index, reasons: ["重複交易 id"], record: safeQuarantinedRecord(raw) });
      return;
    }
    if (record.eventId && seenDividendEvents.has(record.eventId)) {
      quarantinedRecords.push({ index, reasons: ["重複官方股利事件"], record: safeQuarantinedRecord(raw) });
      return;
    }
    seenIds.add(record.id);
    if (record.eventId) seenDividendEvents.add(record.eventId);
    records.push({ ...record, __inputOrder: index });
  });
  records.sort(compareTradeChronology);
  records.forEach((record) => { delete record.__inputOrder; });
  const existingMigration = src.migration && typeof src.migration === "object" ? src.migration : null;
  const migration = existingMigration
    ? {
        fromVersion: Number(existingMigration.fromVersion) || 1,
        migratedAt: String(existingMigration.migratedAt || "").slice(0, 40),
      }
    : payloadIsV2 ? null : {
        fromVersion: Number(src.schemaVersion) || 1,
        migratedAt: String(options.migratedAt || new Date().toISOString()).slice(0, 40),
      };
  return {
    schemaVersion: TRADE_SCHEMA_VERSION,
    settings,
    records,
    quarantinedRecords: quarantinedRecords.slice(0, MAX_TRADE_RECORDS),
    ...(migration ? { migration } : {}),
  };
}

function migrateTradesPayloadToV2(input, options = {}) {
  const payload = normalizeTradesPayload(input, options);
  return {
    payload,
    changed: JSON.stringify(input && typeof input === "object" ? input : {}) !== JSON.stringify(payload),
  };
}

// 重放整份紀錄算持股與已實現損益。任何時點「賣出股數 > 當下庫存」→ ok:false（PUT 會被 400 擋下），
// 這同時保護「刪掉舊買單導致後面的賣單變賣超」的情境。
// D-22 補登入口：比對「官方公司行動歸檔」與「帳本已登錄的 corporateAction」，找出漏記的事件。
// 為什麼需要這個：報價層的 quote.dividend 只帶最近一筆**未來**事件，除權日一過就滾出視窗，
// 快速鈕因此只有一天的視窗期。漏記的後果不只是顯示假虧損，而是之後想賣掉含配股的股數會被
// 賣超檢查擋下。所以改由伺服器用本機歸檔回溯比對，讓使用者事後也補得回來。
// 只回報「使用者在該事件基準日之前確實持有」的檔位——沒持股就沒有配股可言。
// 配股／現增的權利股數，一律按「除權基準日**之前**的持股」計算——基準日當天買進不享有權利，
// 基準日當天賣出仍然享有（那天的價格已經是除權後的參考價）。
//
// 這個函式刻意做成兩個呼叫端共用：buildPortfolio 真正加股數的地方，與 findMissingCorporateActions
// 提示「你漏登了 +N 股」的地方。以前後者對、前者用「重放到那一筆時的 pos.shares」，
// 兩邊在同日交易上會給出不同答案：畫面承諾 +100 股、實際加 40 股，而且沒有任何徵兆。
function sharesHeldBeforeExDate(records, code, exDate) {
  let shares = 0;
  for (const record of records) {
    if (record.code !== code) continue;
    const date = toCompactDate(record.tradeDate || record.date);
    if (!date || date >= exDate) continue;
    if (record.side === "buy") shares += Number(record.shares) || 0;
    else if (record.side === "sell") shares -= Number(record.shares) || 0;
    else if (record.side === TRADE_CORPORATE_ACTION_SIDE) {
      shares += Math.floor(shares * (Number(record.stockRatio) || 0))
        + Math.floor(shares * (Number(record.subscriptionRatio) || 0));
    }
  }
  return shares;
}

async function findMissingCorporateActions(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  if (!records.length) return [];
  await loadFundamentalsHistory();
  const logged = new Set(records
    .filter((record) => record.side === TRADE_CORPORATE_ACTION_SIDE)
    .map((record) => `${record.code}|${toCompactDate(record.tradeDate || record.date)}`));
  const sharesBefore = (code, exDate) => sharesHeldBeforeExDate(records, code, exDate);
  const missing = [];
  for (const code of new Set(records.map((record) => record.code))) {
    for (const action of corporateActionHistoryForCode(code)) {
      const exDate = toCompactDate(action.exDate);
      if (!exDate || logged.has(`${code}|${exDate}`)) continue;
      const stockRatio = Number(action.stockRatio) || 0;
      const subscriptionRatio = Number(action.subscriptionRatio) || 0;
      // 純現金股利不影響股數，不在這裡回報（它走既有的股利流程）。
      if (stockRatio <= 0 && subscriptionRatio <= 0) continue;
      const shares = sharesBefore(code, exDate);
      if (shares <= 0) continue;
      missing.push({
        code,
        exDate,
        stockRatio,
        subscriptionRatio,
        subscriptionPrice: Number(action.subscriptionPrice) || 0,
        sharesBefore: shares,
        bonusShares: Math.floor(shares * stockRatio),
        subscribedShares: Math.floor(shares * subscriptionRatio),
      });
    }
  }
  return missing.sort((a, b) => a.exDate.localeCompare(b.exDate)).slice(0, 20);
}

function buildPortfolio(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const positions = new Map(); // code → { shares, cost }
  const dividendsByCode = new Map(); // code → { recognizedGross, receivableGross, receivedNet }
  const realized = [];
  for (const t of records) {
    const pos = positions.get(t.code) || { shares: 0, cost: 0 };
    if (t.side === TRADE_CORPORATE_ACTION_SIDE) {
      // 會計上：無償配股＝以 0 元取得股票，現增＝以認購價取得股票。兩者都只是「加股數、加成本」，
      // 均價自然稀釋，所以這裡不需要任何特殊公式。除息不走這裡（現金股利不動持股與成本）。
      // 權利股數要按「除權基準日**之前**的持股」算，不能用重放到這一筆時的 pos.shares。
      // 兩者在同日交易上會分岔，而且一定會分岔：compareTradeChronology 在缺 executedAt 時
      // 退回 createdAt 排序，而補登配股的快速鈕填的是「按下去的當下」——必然排在同日買賣之後。
      //   6/1 買 1000、7/10 再買 1000、7/10 除權 0.1 → 正確 +100 股，舊寫法給 +200
      //   6/1 買 1000、7/10 賣 600、7/10 除權 0.1   → 正確 +100 股，舊寫法給 +40
      //   6/1 買 2000、7/10 全賣、7/10 除權 0.5     → 正確 +1000 股，舊寫法 pos.shares 是 0
      //                                                → 整批蒸發，之後想賣還會被賣超檢查擋下
      // 基準日當天賣出仍然享有權利（那天的價格已經是除權後的參考價），所以守衛也要看
      // sharesBefore 而不是 pos.shares——否則「當天賣光」這個情境會被整個跳過。
      const entitledShares = sharesHeldBeforeExDate(records, t.code, toCompactDate(t.tradeDate || t.date));
      if (entitledShares > 0) {
        // 不足一股的部分不會給零股而是折現金發放；帳本只追蹤股數，所以無條件捨去，
        // 寧可少算不要多算。
        const bonusShares = Math.floor(entitledShares * (Number(t.stockRatio) || 0));
        const subscribedShares = Math.floor(entitledShares * (Number(t.subscriptionRatio) || 0));
        pos.shares += bonusShares + subscribedShares;
        pos.cost += subscribedShares * (Number(t.subscriptionPrice) || 0);
        positions.set(t.code, pos);
      }
      continue;
    }
    if (t.side === "dividend") {
      // 除息日先認列應收，實際匯入後才進 receivedNet；兩者都不動持股與成本。
      const dividend = dividendsByCode.get(t.code) || { recognizedGross: 0, receivableGross: 0, receivedNet: 0 };
      const gross = t.price * t.shares;
      dividend.recognizedGross += gross;
      if (t.status === "receivable") {
        dividend.receivableGross += gross;
      } else {
        const fallbackNet = Math.max(0, gross - (Number(t.fee) || 0));
        dividend.receivedNet += Number.isFinite(Number(t.receivedAmount))
          ? Math.max(0, Number(t.receivedAmount))
          : fallbackNet;
      }
      dividendsByCode.set(t.code, dividend);
      continue;
    }
    if (t.side === "buy") {
      pos.shares += t.shares;
      pos.cost += t.price * t.shares + t.fee;
    } else {
      if (t.shares > pos.shares) {
        return {
          ok: false,
          // D-31：同日多筆買賣的先後，只在**每一筆都填了成交時間**時才靠 executedAt 判斷；
          // 任一筆缺值就整組退回「記帳時刻／輸入順序」。使用者照對帳單謄寫時常常先記賣出、
          // 後記買進，順序就反了，於是明明合法的紀錄被判成賣超、整包 PUT 被 400 擋下。
          // 補填成交時間就能解，但以前完全沒告訴使用者——這裡把自救路徑直接寫進錯誤訊息。
          error: `${t.date.slice(4, 6)}/${t.date.slice(6, 8)} 賣出 ${t.code} ${t.shares} 股，但當時庫存只有 ${pos.shares} 股（賣超）。`
            + "請檢查買賣紀錄的日期與股數；若同一天有多筆買賣，請在每一筆補填「成交時間」，"
            + "否則系統只能依記帳先後排序，可能把當天較晚的買進排在賣出之後。"
            + "另外，若這檔曾經除權配股或現增，也要補登公司行動，否則股數會停在配股前。",
        };
      }
      const avgCost = pos.cost / pos.shares;
      const costOfSold = avgCost * t.shares;
      const grossProceeds = t.price * t.shares;
      const proceeds = grossProceeds - t.fee - t.tax;
      realized.push({
        id: t.id,
        code: t.code,
        date: t.date,
        shares: t.shares,
        sellPrice: t.price,
        avgCost: Math.round(avgCost * 100) / 100,
        grossProceeds: Math.round(grossProceeds),
        fee: t.fee,
        tax: t.tax,
        netProceeds: Math.round(proceeds),
        costOfSold: Math.round(costOfSold),
        feeSource: t.feeSource || "legacy",
        taxSource: t.taxSource || "legacy",
        taxRuleId: t.taxRuleId || "legacy-unknown",
        reviewStatus: t.reviewStatus || "needsReview",
        pnl: Math.round(proceeds - costOfSold),
        pnlPct: costOfSold > 0 ? Math.round(((proceeds - costOfSold) / costOfSold) * 10000) / 100 : null,
      });
      pos.shares -= t.shares;
      pos.cost -= costOfSold;
      if (pos.shares === 0) pos.cost = 0; // 清倉時歸零，避免浮點殘渣
    }
    positions.set(t.code, pos);
  }
  const holdings = [...positions.entries()]
    .filter(([, pos]) => pos.shares > 0)
    .map(([code, pos]) => {
      const dividend = dividendsByCode.get(code) || { recognizedGross: 0, receivableGross: 0, receivedNet: 0 };
      return {
        code,
        shares: pos.shares,
        avgCost: Math.round((pos.cost / pos.shares) * 100) / 100,
        cost: Math.round(pos.cost),
        dividendsRecognizedGross: Math.round(dividend.recognizedGross),
        dividendsReceivableGross: Math.round(dividend.receivableGross),
        dividends: Math.round(dividend.receivedNet), // 舊欄名保留：現在明確代表「已入帳淨額」
      };
    })
    .sort((a, b) => b.cost - a.cost);
  let dividendRecognizedGross = 0;
  let dividendReceivableGross = 0;
  let dividendReceivedNet = 0;
  for (const value of dividendsByCode.values()) {
    dividendRecognizedGross += value.recognizedGross;
    dividendReceivableGross += value.receivableGross;
    dividendReceivedNet += value.receivedNet;
  }
  return {
    ok: true,
    holdings,
    realized: realized.reverse(), // 最新的在前
    totals: {
      cost: holdings.reduce((sum, h) => sum + h.cost, 0),
      realizedPnl: Math.round(realized.reduce((sum, r) => sum + r.pnl, 0)),
      buyFees: Math.round(records.reduce((sum, record) => record.side === "buy" ? sum + (Number(record.fee) || 0) : sum, 0)),
      sellFees: Math.round(records.reduce((sum, record) => record.side === "sell" ? sum + (Number(record.fee) || 0) : sum, 0)),
      securitiesTax: Math.round(records.reduce((sum, record) => record.side === "sell" ? sum + (Number(record.tax) || 0) : sum, 0)),
      dividendRecognizedGross: Math.round(dividendRecognizedGross),
      dividendReceivableGross: Math.round(dividendReceivableGross),
      dividendReceivedNet: Math.round(dividendReceivedNet),
      dividendIncome: Math.round(dividendReceivedNet), // 舊 API 欄名相容：只代表已入帳淨額
    },
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || "user",
  };
}

function safeBrokerCredentialStatus(credentials, savedPayload) {
  let certPathExists = false;
  try {
    certPathExists = Boolean(credentials?.certPath) && existsSync(credentials.certPath);
  } catch {
    certPathExists = false;
  }
  return {
    configured: Boolean(credentials),
    provider: credentials?.provider || "fubon",
    providerLabel: "富邦新一代 API",
    username: credentials?.personalId ? maskSecret(credentials.personalId) : "",
    certPathSet: Boolean(credentials?.certPath),
    certPathExists,
    updatedAt: savedPayload?.updatedAt || "",
  };
}

let dbCache = null;
let dbLoadPromise = null;
let dbSaveQueue = Promise.resolve();
let dbSavePendingCount = 0;
let dbMutationQueue = Promise.resolve();
let dbMutationPendingCount = 0;
let dbMutationEpoch = 0;
let lastDbBackupDay = "";
const atomicWriteQueues = new Map();
const backgroundTasks = new Map();
const DB_MUTATION_SKIPPED = Symbol("stock1-db-mutation-skipped");

function skipDbMutation(value = undefined) {
  return { [DB_MUTATION_SKIPPED]: true, value };
}

function getDbMutationEpochForTest() {
  return dbMutationEpoch;
}

function persistenceFailure(error) {
  if (error?.code === "PERSISTENCE_FAILED") return error;
  console.error("[Stock1] 主資料庫寫入失敗，未發布的記憶體草稿已丟棄：", error?.message || error);
  return Object.assign(new Error("資料暫時無法安全儲存，請稍後再試。"), {
    code: "PERSISTENCE_FAILED",
    status: 503,
    cause: error,
  });
}

function mutationErrorResponse(response, error, fallbackStatus = 400) {
  if (error?.code === "PERSISTENCE_FAILED") {
    jsonResponse(response, 503, {
      ok: false,
      code: "PERSISTENCE_FAILED",
      error: "資料暫時無法安全儲存，請稍後再試。",
    });
    return;
  }
  jsonResponse(response, Number(error?.status) || fallbackStatus, {
    ok: false,
    ...(error?.code ? { code: error.code } : {}),
    error: error?.message || "資料處理失敗",
  });
}

// 所有 runtime DB mutation 都必須把「重驗條件 → 改草稿 → 原子落盤 → 發布」放進同一條佇列。
// copy-on-write 可避免 A 尚未落盤或最後失敗時，並行 GET 讀到未提交內容；B 也只會從已發布版本開始。
function commitDbMutation(mutator) {
  dbMutationPendingCount += 1;
  const operation = dbMutationQueue
    .then(async () => {
      if (dataDirLeaseRequired && !dataDirLeaseHealthy) {
        throw persistenceFailure(Object.assign(new Error("DATA_DIR writer lease 已失效"), { code: "DATA_DIR_LEASE_LOST" }));
      }
      const liveDb = await loadDb();
      const baselineText = JSON.stringify(liveDb);
      const draft = JSON.parse(baselineText);
      const result = await mutator(draft);
      if (result?.[DB_MUTATION_SKIPPED]) {
        if (JSON.stringify(draft) !== baselineText) {
          throw Object.assign(new Error("skipDbMutation() 不可搭配已修改的 draft"), {
            code: "DB_MUTATION_SKIP_DIRTY",
            status: 500,
          });
        }
        return result.value;
      }
      if (dataDirLeaseRequired && !dataDirLeaseHealthy) {
        throw persistenceFailure(Object.assign(new Error("DATA_DIR writer lease 已失效"), { code: "DATA_DIR_LEASE_LOST" }));
      }
      try {
        await saveDb(draft);
      } catch (error) {
        throw persistenceFailure(error);
      }
      // 保留 dbCache 根物件的 identity，讓既有讀者在落盤成功後原子式看見完整新版本。
      for (const key of Object.keys(liveDb)) delete liveDb[key];
      Object.assign(liveDb, draft);
      return result;
    });
  // queue tail 永遠保持 fulfilled：業務 4xx 或已安全丟棄的 persistence failure
  // 只回給本次 caller，不可污染下一筆 mutation 或讓正常 shutdown 誤判失敗。
  dbMutationQueue = operation.then(() => undefined, () => undefined);
  return operation.finally(() => {
    dbMutationPendingCount = Math.max(0, dbMutationPendingCount - 1);
  });
}

function trackBackgroundTask(promise, label = "background task") {
  const task = Promise.resolve(promise);
  backgroundTasks.set(task, label);
  void task
    .catch((error) => console.warn(`[Stock1] ${label} 失敗：`, error?.message || error))
    .finally(() => backgroundTasks.delete(task));
  return task;
}

async function renameAtomicTemp(tmpPath, targetPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, targetPath);
      return;
    } catch (error) {
      const retryable = ["EPERM", "EACCES", "EBUSY"].includes(error?.code);
      if (!retryable || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)));
    }
  }
}

// 原子寫入：先寫 .tmp 再 rename（Node 的 rename 在 Windows 也會覆蓋既有檔）。
// 寫到一半被殺（Ctrl+C／斷電）最多留下 .tmp 殘檔，原檔永遠是完整 JSON。
function writeFileAtomic(path, data) {
  const previousWrite = atomicWriteQueues.get(path) || Promise.resolve();
  const pendingWrite = previousWrite
    .catch(() => {})
    .then(async () => {
      const tmpPath = `${path}.tmp`;
      // Never follow a stale/hostile temp symlink or overwrite a hard-linked inode.
      // O_EXCL (`wx`) also closes the unlink -> create race against another process.
      await unlink(tmpPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await writeFile(tmpPath, data, { encoding: "utf8", flag: "wx" });
      await renameAtomicTemp(tmpPath, path);
    });

  atomicWriteQueues.set(path, pendingWrite);
  return pendingWrite.finally(() => {
    if (atomicWriteQueues.get(path) === pendingWrite) atomicWriteQueues.delete(path);
  });
}

const dbBackupDir = join(dataDir, "backups");
const DB_BACKUP_KEEP = 14;

// 每天第一次寫入前，把「昨天最後的好版本」複製進 backups/，保留最近 14 份。
// 備份失敗只警告不擋寫入（備份是保險，不是主流程）。
async function backupDbDaily() {
  const today = toTaipeiCompactDate();
  if (lastDbBackupDay === today || !existsSync(dbPath)) return;
  try {
    await mkdir(dbBackupDir, { recursive: true });
    const dailyPath = join(dbBackupDir, `stock1-db-${today}.json`);
    try {
      // 同一天重啟後 lastDbBackupDay 會歸零；EXCL 確保既有 rollback point 永不被覆寫。
      await copyFile(dbPath, dailyPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    // 只有 rollback point 已成功建立（或同日檔案原本就存在）才節流；
    // 暫時性檔案系統錯誤要讓下一次 saveDb 在同一天自動重試。
    lastDbBackupDay = today;
    const files = (await readdir(dbBackupDir)).filter((name) => /^stock1-db-\d{8}\.json$/.test(name)).sort();
    while (files.length > DB_BACKUP_KEEP) {
      await unlink(join(dbBackupDir, files.shift())).catch(() => {});
    }
  } catch (error) {
    console.warn("[Stock1] 每日備份失敗（主資料不受影響）：", error.message);
  }
}

async function saveDb(db) {
  // 同步 bump 讓還原點可偵測 await 期間的任何 DB 寫入嘗試；失敗也保守使舊預覽失效。
  dbMutationEpoch += 1;
  await mkdir(dataDir, { recursive: true });
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  dbSavePendingCount += 1;
  const operation = dbSaveQueue
    .then(() => backupDbDaily())
    .then(() => writeFileAtomic(dbPath, payload));
  const tracked = operation.finally(() => {
    dbSavePendingCount = Math.max(0, dbSavePendingCount - 1);
  });
  // 和 mutation queue 一樣，供後續排隊／shutdown 等待的 tail 必須永遠 fulfilled；
  // 本次 caller 仍會從 tracked 收到原始寫入錯誤。
  dbSaveQueue = tracked.then(() => undefined, () => undefined);
  await tracked;
}

function pendingPersistenceCount() {
  return dbSavePendingCount
    + dbMutationPendingCount
    + atomicWriteQueues.size
    + backgroundTasks.size
    + dividendHistoryMutationPendingCount;
}

async function flushPersistence() {
  // 等待期間可能有背景工作再排入下一個 atomic write，因此以「快照→等待→重驗」收斂。
  const failures = [];
  const observed = new Set();
  for (let pass = 0; pass < 24; pass += 1) {
    const pending = [
      ...(dbLoadPromise ? [dbLoadPromise] : []),
      dbMutationQueue,
      dbSaveQueue,
      dividendHistoryMutationQueue,
      ...backgroundTasks.keys(),
      ...atomicWriteQueues.values(),
    ];
    const results = await Promise.allSettled(pending);
    results.forEach((result, index) => {
      if (result.status === "rejected" && !observed.has(pending[index])) {
        observed.add(pending[index]);
        failures.push(result.reason);
      }
    });
    await Promise.resolve();
    if (pendingPersistenceCount() === 0 && atomicWriteQueues.size === 0 && backgroundTasks.size === 0) {
      if (failures.length) throw new AggregateError(failures, "一或多個持久化工作失敗");
      return;
    }
  }
  throw new AggregateError(failures, "持久化工作未能在安全關機前排空");
}

// 壞檔恢復：主檔 JSON 壞掉（極端情況：舊版非原子寫入被斷電截斷）→
// 把壞檔改名保留鑑識，改用最新備份；沒有備份才起空 DB。全程大聲警告、絕不靜默重建。
async function recoverDbFromBackup(parseError) {
  const stamp = Date.now();
  const corruptPath = `${dbPath}.corrupt-${stamp}.json`;
  try {
    await rename(dbPath, corruptPath);
  } catch {
    // 改名失敗就原地留著，仍嘗試備份
  }
  const backups = await listDbBackupNames();
  while (backups.length) {
    const name = backups.pop(); // 從最新的備份開始試
    try {
      const restored = JSON.parse(await readFile(join(dbBackupDir, name), "utf8"));
      console.warn(
        `[Stock1] ⚠ 主資料庫 JSON 損壞（${parseError.message}）。壞檔已保留為 ${corruptPath}，` +
        `已改用備份 ${name} 繼續運作——備份日之後的變更（自選股/提醒/交易紀錄）需要手動補回。`
      );
      return restored;
    } catch {
      // 這份備份也壞了 → 試更舊的
    }
  }
  console.warn(
    `[Stock1] ⚠ 主資料庫 JSON 損壞（${parseError.message}）且沒有可用備份。壞檔已保留為 ${corruptPath}，` +
    `以空資料庫啟動——如需救回資料，請手動檢查該壞檔。`
  );
  return createEmptyDb();
}

// 依日期排序的每日備份檔名（新的在後）。恢復路徑與「主檔不見了」的偵測共用同一份判準。
async function listDbBackupNames() {
  try {
    return (await readdir(dbBackupDir)).filter((name) => /^stock1-db-\d{8}\.json$/.test(name)).sort();
  } catch {
    return [];
  }
}

async function loadDbOnce() {
  await mkdir(dataDir, { recursive: true });
  let recoveredFromCorruption = false;
  // 主檔不存在但**備份存在** ＝ 這不是第一次啟動，是主檔不見了。
  // 舊行為是直接起一個空 DB 並在下面立刻 saveDb 落盤，畫面上唯一的線索是
  // 「Created initial admin user "admin"」——讀起來就像第一次開機。
  // 而隔天 backupDbDaily 會把這個空 DB 複製成當天的還原點，14 天後好備份全部被輪替掉，
  // 交易帳本、自選股、共享備註全部永久消失。
  //
  // 觸發路徑不罕見：防毒隔離、OneDrive 衝突改名、使用者看到 corrupt 訊息後手動刪檔，
  // 或 corrupt → rename → saveDb 失敗 → 重跑。
  //
  // **刻意 fail-closed 而不是自動還原**：要用哪一份備份、備份日之後的變更怎麼辦，
  // 都是使用者才能決定的事；自動挑一份等於替他做了一個他不知情的選擇。
  // 沒有備份時才是真正的第一次啟動，照舊起空 DB。
  if (!existsSync(dbPath)) {
    const backups = await listDbBackupNames();
    if (backups.length) {
      throw new Error(
        `主資料庫 ${dbPath} 不存在，但 ${dbBackupDir} 裡有 ${backups.length} 份備份`
        + `（最新：${backups.at(-1)}）。這代表主檔遺失而不是第一次啟動，`
        + "為避免以空資料庫覆蓋掉備份，伺服器不會啟動。\n"
        + `  要還原：把 ${join(dbBackupDir, backups.at(-1))} 複製成 ${dbPath} 再啟動。\n`
        + `  確定要全新開始：先把 ${dbBackupDir} 移到別處（不要直接刪，那是你唯一的資料）。`,
      );
    }
  }
  if (existsSync(dbPath)) {
    // 讀檔 I/O 錯誤（EACCES/EIO/EBUSY/EISDIR…）不是 JSON 損壞：必須原錯誤 fail-closed，
    // 絕不能把檔案／目錄改名後再靜默回退備份或空 DB。
    const serialized = await readFile(dbPath, "utf8");
    try {
      dbCache = JSON.parse(serialized);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      dbCache = await recoverDbFromBackup(error);
      recoveredFromCorruption = true;
    }
  } else {
    dbCache = createEmptyDb();
  }
  dbCache.users ||= [];
  dbCache.sessions ||= [];
  dbCache.watchLists ||= {};
  dbCache.priceAlerts ||= {};
  dbCache.trades ||= {};
  dbCache.dataRevs ||= {};
  dbCache.sharedRevs ||= {};
  dbCache.brokerCredentials ||= {};
  dbCache.stockNotes ||= {};
  dbCache.companyProfiles ||= {};
  dbCache.swingSnapshots ||= {};
  dbCache.swingVerification ||= {};

  let changed = recoveredFromCorruption;
  const migrationStamp = new Date().toISOString();
  for (const [userId, tradePayload] of Object.entries(dbCache.trades)) {
    if (!tradePayload || typeof tradePayload !== "object" || Array.isArray(tradePayload)) continue;
    const migrated = migrateTradesPayloadToV2(tradePayload, { migratedAt: migrationStamp });
    if (!migrated.changed) continue;
    dbCache.trades[userId] = migrated.payload;
    bumpDataRev(dbCache, userId, "trades");
    changed = true;
  }
  if (!dbCache.users.length) {
    const now = new Date().toISOString();
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = usingDefaultAdminPassword ? "admin1234" : configuredAdminPassword;
    const admin = {
      id: `u_${randomBytes(8).toString("hex")}`,
      username,
      displayName: "管理者",
      role: "admin",
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
    };
    dbCache.users.push(admin);
    dbCache.watchLists[admin.id] = defaultWatchListPayload();
    changed = true;
    console.warn(`[Stock1] Created initial admin user "${username}". Set ADMIN_PASSWORD before cloud deployment.`);
  }

  const nowTime = Date.now();
  const activeSessions = dbCache.sessions.filter((session) => new Date(session.expiresAt).getTime() > nowTime);
  if (activeSessions.length !== dbCache.sessions.length) {
    dbCache.sessions = activeSessions;
    changed = true;
  }

  if (changed) await saveDb(dbCache);
  return dbCache;
}

function loadDb() {
  if (dbLoadPromise) return dbLoadPromise;
  if (dbCache) return Promise.resolve(dbCache);
  dbLoadPromise = loadDbOnce()
    .catch((error) => {
      // 啟動遷移／初始 admin 落盤失敗時不能留下只活在 RAM 的 cache；下一次必須重讀並重試。
      dbCache = null;
      throw error;
    })
    .finally(() => {
      dbLoadPromise = null;
    });
  return dbLoadPromise;
}

async function readJsonBody(request, maxBytes = 128 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function getAuthContext(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.sid;
  if (!token) return { user: null, session: null };
  const db = await loadDb();
  const tokenHash = hashToken(token);
  const nowTime = Date.now();
  const session = db.sessions.find(
    (item) => item.tokenHash === tokenHash && new Date(item.expiresAt).getTime() > nowTime
  );
  if (!session) return { user: null, session: null };
  const user = db.users.find((item) => item.id === session.userId);
  return { user: user || null, session: user ? session : null };
}

// 請求可能在讀 body、查官方資料或 transaction queue 中等待很久；正式 mutation 前
// 必須用最新 DB 重驗 session、有效期、帳號與角色，不能信任入口時保存的 auth 物件。
function requireCurrentMutationAuth(db, auth, { admin = false } = {}) {
  const sessionId = String(auth?.session?.id || "");
  const expectedUserId = String(auth?.user?.id || "");
  const now = Date.now();
  const session = (Array.isArray(db.sessions) ? db.sessions : []).find((item) => (
    item.id === sessionId
    && item.userId === expectedUserId
    && new Date(item.expiresAt).getTime() > now
  ));
  const user = session && (Array.isArray(db.users) ? db.users : []).find((item) => item.id === session.userId);
  if (!session || !user) {
    throw Object.assign(new Error("登入狀態已失效，請重新登入"), { status: 401, code: "AUTH_REQUIRED" });
  }
  if (admin && user.role !== "admin") {
    throw Object.assign(new Error("需要管理者權限"), { status: 403, code: "ADMIN_REQUIRED" });
  }
  return { user, session };
}

async function requireAuth(request, response) {
  const auth = await getAuthContext(request);
  if (!auth.user) {
    jsonResponse(response, 401, {
      ok: false,
      error: "需要先登入",
      code: "AUTH_REQUIRED",
    });
    return null;
  }
  return auth;
}

// 路由用（auth 已解析）：沒登入 → 回 401 並回 false，呼叫端直接 `return true` 結束該路由。
function ensureAuthed(auth, response) {
  if (auth.user) return true;
  jsonResponse(response, 401, { ok: false, error: "需要先登入", code: "AUTH_REQUIRED" });
  return false;
}

// ===== 個人資料版本號（多分頁蓋寫防護）=====
// 自選股/到價提醒/交易紀錄都是「整包 PUT」：兩個分頁同時開，後寫的會把先寫的整包蓋掉
// （交易紀錄被蓋掉＝記的帳直接消失）。每份資料掛一個遞增 rev，PUT 帶舊 rev → 409 請客戶端先同步。
function getDataRev(db, userId, key) {
  return db.dataRevs?.[userId]?.[key] || 0;
}

function bumpDataRev(db, userId, key) {
  db.dataRevs ||= {};
  db.dataRevs[userId] ||= {};
  db.dataRevs[userId][key] = (db.dataRevs[userId][key] || 0) + 1;
  return db.dataRevs[userId][key];
}

function getSharedRev(db, key) {
  return db.sharedRevs?.[key] || 0;
}

function bumpSharedRev(db, key) {
  db.sharedRevs ||= {};
  db.sharedRevs[key] = (db.sharedRevs[key] || 0) + 1;
  return db.sharedRevs[key];
}

// ===== 個人資料可攜式備份／兩階段安全還原 =====
const PERSONAL_BACKUP_FORMAT = "stock1-personal-backup";
const PERSONAL_BACKUP_VERSION = 1;
const PERSONAL_BACKUP_MAX_BYTES = 16 * 1024 * 1024;
// HTTP body 還包含 { bundle, options } 包裝；檔案本身仍嚴格限制為 16 MiB。
const PERSONAL_BACKUP_REQUEST_MAX_BYTES = PERSONAL_BACKUP_MAX_BYTES + (256 * 1024);
const PERSONAL_RESTORE_TOKEN_TTL_MS = 10 * 60 * 1000;
const PERSONAL_RESTORE_TOKEN_MAX = 8;
const PERSONAL_RESTORE_POINT_KEEP = 14;
const PERSONAL_RESTORE_OPTIONS = Object.freeze({
  watchLists: "replace",
  alerts: "replace",
  trades: "replace",
  stockNotes: "merge",
  companyProfiles: "skip",
});
const personalRestorePreviews = new Map();
let personalRestoreCommitInProgress = false;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function personalBackupChecksum(bundle) {
  const { integrity: _integrity, ...unsigned } = bundle;
  return createHash("sha256").update(stableJson(unsigned), "utf8").digest("hex");
}

function portableError(code, message, status = 422, details = undefined) {
  return Object.assign(new Error(message), { code, status, details });
}

function portableErrorResponse(response, error) {
  jsonResponse(response, Number(error?.status) || 422, {
    ok: false,
    code: error?.code || "BACKUP_FORMAT_INVALID",
    error: error?.message || "備份檔格式不正確",
    ...(error?.details === undefined ? {} : { details: error.details }),
  });
}

function countWatchListCodes(lists) {
  return Object.values(lists || {}).reduce((sum, codes) => sum + (Array.isArray(codes) ? codes.length : 0), 0);
}

function currentPersonalRevisions(db, userId) {
  return {
    watchLists: getDataRev(db, userId, "watchLists"),
    alerts: getDataRev(db, userId, "alerts"),
    trades: getDataRev(db, userId, "trades"),
  };
}

function samePersonalRevisions(left, right) {
  return ["watchLists", "alerts", "trades"].every((key) => Number(left?.[key]) === Number(right?.[key]));
}

function normalizePortableNotes(input) {
  if (!Array.isArray(input)) throw portableError("BACKUP_FORMAT_INVALID", "sharedContributions.stockNotes 必須是陣列");
  const seen = new Set();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw portableError("BACKUP_FORMAT_INVALID", `第 ${index + 1} 則共享備註格式不正確`);
    }
    const rawId = String(raw.id || "").trim();
    const id = rawId;
    const code = cleanCode(raw.code);
    const text = String(raw.text || "").trim();
    const createdAt = String(raw.createdAt || "");
    if (!id || id.length > 64 || !/^[0-9A-Za-z_.-]+$/.test(id)
      || !SECURITY_CODE_PATTERN.test(code) || code !== String(raw.code || "").trim()
      || !text || text !== String(raw.text || "") || text.length > 500
      || !Number.isFinite(Date.parse(createdAt))) {
      throw portableError("BACKUP_FORMAT_INVALID", `第 ${index + 1} 則共享備註內容不正確`);
    }
    if (seen.has(id)) throw portableError("BACKUP_FORMAT_INVALID", `共享備註 id 重複：${id}`);
    seen.add(id);
    return { id, code, text, createdAt };
  });
}

function normalizePortableCompanyProfiles(input) {
  if (!Array.isArray(input)) throw portableError("BACKUP_FORMAT_INVALID", "sharedContributions.companyProfiles 必須是陣列");
  return input.map((raw, index) => {
    const code = cleanCode(raw?.code);
    const summary = String(raw?.summary || "").trim();
    const updatedAt = String(raw?.updatedAt || "");
    if (!code || !summary || summary.length > 800 || !Number.isFinite(Date.parse(updatedAt))) {
      throw portableError("BACKUP_FORMAT_INVALID", `第 ${index + 1} 則公司簡介封存內容不正確`);
    }
    return { code, summary, updatedAt };
  });
}

function validateRestoreOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw portableError("BACKUP_OPTIONS_INVALID", "缺少還原模式");
  }
  for (const [key, expected] of Object.entries(PERSONAL_RESTORE_OPTIONS)) {
    if (options[key] !== expected) {
      throw portableError("BACKUP_OPTIONS_INVALID", `不支援的 ${key} 還原模式`);
    }
  }
  return { ...PERSONAL_RESTORE_OPTIONS };
}

function validatePersonalBackupEnvelope(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || bundle.format !== PERSONAL_BACKUP_FORMAT) {
    throw portableError("BACKUP_FORMAT_INVALID", "這不是有效的 Stock1 個人備份檔");
  }
  if (bundle.formatVersion !== PERSONAL_BACKUP_VERSION) {
    throw portableError("BACKUP_VERSION_UNSUPPORTED", "此備份版本尚未支援，請使用相容版本的 Stock1");
  }
  if (!bundle.data || typeof bundle.data !== "object" || Array.isArray(bundle.data)
    || !bundle.sharedContributions || typeof bundle.sharedContributions !== "object") {
    throw portableError("BACKUP_FORMAT_INVALID", "備份檔缺少必要資料區段");
  }
  if (Buffer.byteLength(JSON.stringify(bundle), "utf8") > PERSONAL_BACKUP_MAX_BYTES) {
    throw portableError("BACKUP_TOO_LARGE", "備份檔超過 16 MB 上限", 413);
  }
  const hash = String(bundle.integrity?.contentHash || "").toLowerCase();
  if (bundle.integrity?.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(hash)) {
    throw portableError("BACKUP_FORMAT_INVALID", "備份檔缺少有效的完整性資訊");
  }
  if (hash !== personalBackupChecksum(bundle)) {
    throw portableError("BACKUP_CHECKSUM_MISMATCH", "備份檔內容已變更或損壞，無法安全還原");
  }
}

function buildPersonalBackup(db, user) {
  const trades = normalizeTradesPayload(db.trades?.[user.id]);
  const stockNotes = Object.values(db.stockNotes || {})
    .flat()
    .filter((note) => note?.userId === user.id)
    .map(({ id, code, text, createdAt }) => ({ id, code, text, createdAt }))
    .sort((a, b) => `${a.code}\u0000${a.createdAt}\u0000${a.id}`.localeCompare(`${b.code}\u0000${b.createdAt}\u0000${b.id}`));
  const companyProfiles = Object.values(db.companyProfiles || {})
    .filter((profile) => profile?.updatedBy === user.id)
    .map(({ code, summary, updatedAt }) => ({ code, summary, updatedAt }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const bundle = {
    format: PERSONAL_BACKUP_FORMAT,
    formatVersion: PERSONAL_BACKUP_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    sourceAccount: {
      username: user.username,
      displayName: user.displayName || user.username,
    },
    sourceRevisions: currentPersonalRevisions(db, user.id),
    data: {
      watchLists: cloneJson(normalizeWatchListsPayload(db.watchLists?.[user.id])),
      alerts: cloneJson(normalizeAlertsPayload(db.priceAlerts?.[user.id])),
      trades: cloneJson(trades),
    },
    sharedContributions: { stockNotes, companyProfiles },
  };
  bundle.integrity = { algorithm: "sha256", contentHash: personalBackupChecksum(bundle) };
  return bundle;
}

function prunePersonalRestorePreviews(now = Date.now()) {
  for (const [token, preview] of personalRestorePreviews) {
    if (!preview || preview.expiresAtMs <= now) personalRestorePreviews.delete(token);
  }
  while (personalRestorePreviews.size >= PERSONAL_RESTORE_TOKEN_MAX) {
    personalRestorePreviews.delete(personalRestorePreviews.keys().next().value);
  }
}

async function prunePersonalRestorePoints() {
  try {
    const files = (await readdir(dbBackupDir))
      .filter((name) => /^stock1-pre-restore-.+\.json$/.test(name))
      .sort();
    while (files.length > PERSONAL_RESTORE_POINT_KEEP) {
      await unlink(join(dbBackupDir, files.shift()));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("[Stock1] 還原點輪替失敗：", error.message);
  }
}

function planPortableNotes(db, user, notes) {
  const additions = [];
  let duplicateCount = 0;
  let conflictCount = 0;
  const additionsPerCode = new Map();
  const existingById = new Map(Object.values(db.stockNotes || {}).flat()
    .map((note) => [String(note?.id || ""), note]));
  for (const note of notes) {
    const sameId = existingById.get(note.id);
    if (sameId) {
      if (sameId.userId === user.id && sameId.code === note.code
        && sameId.text === note.text && sameId.createdAt === note.createdAt) duplicateCount += 1;
      else conflictCount += 1;
      continue;
    }
    additions.push(note);
    additionsPerCode.set(note.code, (additionsPerCode.get(note.code) || 0) + 1);
  }
  for (const [code, count] of additionsPerCode) {
    const currentCount = (db.stockNotes?.[code] || []).length;
    if (currentCount + count > 50) conflictCount += currentCount + count - 50;
  }
  if (conflictCount) {
    throw portableError("BACKUP_NOTE_CONFLICT", "共享備註發生 id 或容量衝突；未修改任何資料", 409, {
      addCount: additions.length,
      duplicateCount,
      conflictCount,
    });
  }
  return { additions, addCount: additions.length, duplicateCount, conflictCount: 0 };
}

function validatePortableQuarantine(value) {
  if (!Array.isArray(value)) throw portableError("BACKUP_FORMAT_INVALID", "交易隔離區必須是陣列");
  if (value.length > MAX_TRADE_RECORDS) throw portableError("BACKUP_CAPACITY_EXCEEDED", "交易隔離區超過容量上限");
  value.forEach((item, index) => {
    const reasons = item?.reasons;
    let recordSize = Infinity;
    try {
      recordSize = Buffer.byteLength(JSON.stringify(item?.record ?? item), "utf8");
    } catch {
      recordSize = Infinity;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)
      || !Number.isInteger(item.index) || item.index < 0
      || !Array.isArray(reasons) || reasons.length < 1 || reasons.length > 12
      || reasons.some((reason) => typeof reason !== "string" || !reason.trim() || reason.length > 120)
      || recordSize > 8_000) {
      throw portableError("BACKUP_FORMAT_INVALID", `第 ${index + 1} 筆交易隔離資料不正確`);
    }
  });
}

async function buildPersonalRestorePreview(db, user, session, bundle, options) {
  const previewEpoch = dbMutationEpoch;
  validateRestoreOptions(options);
  validatePersonalBackupEnvelope(bundle);

  const rawLists = bundle.data.watchLists;
  if (!rawLists || typeof rawLists !== "object" || Array.isArray(rawLists)
    || ["1", "2", "3"].some((key) => !Array.isArray(rawLists[key]))) {
    throw portableError("BACKUP_FORMAT_INVALID", "自選股備份格式不正確");
  }
  for (const key of ["1", "2", "3"]) {
    const rawCodes = rawLists[key];
    if (rawCodes.length > MAX_WATCHLIST_CODES_PER_LIST
      || rawCodes.some((code) => typeof code !== "string" || !SECURITY_CODE_PATTERN.test(code) || cleanCode(code) !== code)
      || new Set(rawCodes).size !== rawCodes.length) {
      throw portableError("BACKUP_FORMAT_INVALID", `自選股清單 ${key} 含有無效、重複或過量代號`);
    }
  }
  const watchLists = normalizeWatchListsPayload(rawLists);
  const overLimit = Object.entries(watchLists).find(([, codes]) => codes.length > MAX_WATCHLIST_CODES_PER_LIST);
  if (overLimit) throw portableError("BACKUP_CAPACITY_EXCEEDED", `自選股清單 ${overLimit[0]} 超過容量上限`);

  if (!Array.isArray(bundle.data.alerts)) throw portableError("BACKUP_FORMAT_INVALID", "到價提醒備份格式不正確");
  const alerts = normalizeAlertsPayload(bundle.data.alerts);
  if (alerts.length !== bundle.data.alerts.length) throw portableError("BACKUP_FORMAT_INVALID", "到價提醒含有無效或重複資料");
  if (alerts.length > MAX_PRICE_ALERTS) throw portableError("BACKUP_CAPACITY_EXCEEDED", "到價提醒超過容量上限");

  const rawTrades = bundle.data.trades;
  if (!rawTrades || typeof rawTrades !== "object" || Array.isArray(rawTrades)) {
    throw portableError("BACKUP_FORMAT_INVALID", "交易帳本備份格式不正確");
  }
  validatePortableQuarantine(rawTrades.quarantinedRecords || []);
  const untrustedTrades = {
    ...rawTrades,
    records: Array.isArray(rawTrades.records) ? rawTrades.records.map((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return record;
      const copy = { ...record };
      copy.instrumentSource = copy.instrumentType == null || copy.instrumentType === "" ? "legacy" : "user";
      delete copy.instrumentRuleId;
      delete copy.instrumentAsOf;
      return copy;
    }) : rawTrades.records,
  };
  const preliminary = validateTradesMutationInput(untrustedTrades);
  if (!preliminary.ok) {
    throw portableError("BACKUP_TRADE_INVALID", preliminary.errors[0]?.message || "交易帳本內容不正確", 422, preliminary.errors);
  }
  // 匯入檔一律視為新來源，不能因 id 撞到目標帳號紀錄而繼承目標端的官方 stamp／凍結費稅。
  const emptyExistingTrades = normalizeTradesPayload();
  const instrumentCanonical = await canonicalizeTradeInstrumentProvenance(rawTrades, emptyExistingTrades);
  const moneyCanonical = canonicalizeTradeMoneyProvenance(instrumentCanonical.payload, emptyExistingTrades);
  const validation = validateTradesMutationInput(moneyCanonical);
  if (!validation.ok) {
    throw portableError("BACKUP_TRADE_INVALID", validation.errors[0]?.message || "交易帳本內容不正確", 422, validation.errors);
  }
  const trades = normalizeTradesPayload({
    ...moneyCanonical,
    quarantinedRecords: rawTrades.quarantinedRecords,
  });
  const portfolio = buildPortfolio(trades);
  if (!portfolio.ok) throw portableError("BACKUP_TRADE_INVALID", portfolio.error);
  const importedInstrumentTypes = new Set(trades.records.map((record) => record.instrumentType));
  const relevantInstrumentWarnings = instrumentCanonical.warnings.filter((warning) => {
    // 官方目錄會一次查股票與 ETF；未匯入 ETF 時，不把無關的 ETF 來源降級誤報給使用者。
    if (/ETF/i.test(warning) && !importedInstrumentTypes.has("etf")) return false;
    return true;
  });

  if (personalRestoreCommitInProgress || dbMutationEpoch !== previewEpoch) {
    throw portableError("RESTORE_PREVIEW_STALE", "預覽期間資料剛好更新，請再試一次", 409, {
      currentRevisions: currentPersonalRevisions(db, user.id),
    });
  }

  const portableNotes = normalizePortableNotes(bundle.sharedContributions.stockNotes || []);
  const archivedProfiles = normalizePortableCompanyProfiles(bundle.sharedContributions.companyProfiles || []);
  const notesPlan = planPortableNotes(db, user, portableNotes);
  const revisions = currentPersonalRevisions(db, user.id);
  const currentLists = normalizeWatchListsPayload(db.watchLists?.[user.id]);
  const currentAlerts = normalizeAlertsPayload(db.priceAlerts?.[user.id]);
  const currentTrades = normalizeTradesPayload(db.trades?.[user.id]);
  const publicPlan = {
    sections: {
      watchLists: {
        mode: "replace",
        changed: stableJson(currentLists) !== stableJson(watchLists),
        beforeCount: countWatchListCodes(currentLists),
        afterCount: countWatchListCodes(watchLists),
      },
      alerts: {
        mode: "replace",
        changed: stableJson(currentAlerts) !== stableJson(alerts),
        beforeCount: currentAlerts.length,
        afterCount: alerts.length,
      },
      trades: {
        mode: "replace",
        changed: stableJson(currentTrades) !== stableJson(trades),
        beforeCount: currentTrades.records.length,
        afterCount: trades.records.length,
        quarantinedCount: trades.quarantinedRecords.length,
        portfolio: { ok: true, holdingsCount: portfolio.holdings.length, realizedCount: portfolio.realized.length },
      },
      stockNotes: {
        mode: "merge",
        addCount: notesPlan.addCount,
        duplicateCount: notesPlan.duplicateCount,
        conflictCount: notesPlan.conflictCount,
      },
      companyProfiles: { mode: "skip", archivedCount: archivedProfiles.length },
    },
    warnings: relevantInstrumentWarnings,
  };
  for (const [existingToken, existing] of personalRestorePreviews) {
    if (existing.userId === user.id && existing.sessionId === session.id) personalRestorePreviews.delete(existingToken);
  }
  prunePersonalRestorePreviews();
  const previewToken = randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + PERSONAL_RESTORE_TOKEN_TTL_MS;
  personalRestorePreviews.set(previewToken, {
    userId: user.id,
    sessionId: session.id,
    expiresAtMs,
    expectedRevisions: revisions,
    expectedStockNotesRev: getSharedRev(db, "stockNotes"),
    publicPlan,
    canonical: { watchLists, alerts, trades, portableNotes },
  });
  return { ok: true, previewToken, expiresAt: new Date(expiresAtMs).toISOString(), plan: publicPlan };
}

function rejectPersonalRestoreBusy(response) {
  if (!personalRestoreCommitInProgress) return false;
  jsonResponse(response, 409, {
    ok: false,
    code: "PERSONAL_RESTORE_IN_PROGRESS",
    error: "個人資料正在還原，請稍後再試。",
  });
  return true;
}

function currentRestoreBinding(db, userId) {
  return {
    revisions: currentPersonalRevisions(db, userId),
    stockNotesRev: getSharedRev(db, "stockNotes"),
  };
}

function isRestorePreviewStale(db, entry) {
  const current = currentRestoreBinding(db, entry.userId);
  return !samePersonalRevisions(current.revisions, entry.expectedRevisions)
    || current.stockNotesRev !== entry.expectedStockNotesRev;
}

async function commitPersonalRestore(db, auth, input) {
  if (input?.confirmation !== "RESTORE") {
    throw portableError("RESTORE_CONFIRMATION_REQUIRED", "請輸入 RESTORE 確認還原", 400);
  }
  const usernameLower = auth.user.username.toLowerCase();
  if (isLoginBlocked(usernameLower)) {
    throw portableError("REAUTH_RATE_LIMITED", "密碼嘗試次數過多，請稍後再試", 429);
  }
  if (!verifyPassword(String(input?.currentPassword || ""), auth.user.passwordHash)) {
    recordLoginFailure(usernameLower);
    throw portableError("REAUTH_FAILED", "目前密碼不正確", 403);
  }
  loginFailures.delete(usernameLower);
  prunePersonalRestorePreviews();
  const token = String(input?.previewToken || "");
  const entry = personalRestorePreviews.get(token);
  if (!entry || entry.userId !== auth.user.id || entry.sessionId !== auth.session?.id) {
    throw portableError("RESTORE_PREVIEW_INVALID", "還原預覽已失效，請重新選擇備份檔", 409);
  }
  if (personalRestoreCommitInProgress) {
    throw portableError("PERSONAL_RESTORE_IN_PROGRESS", "另一個還原作業正在進行，請稍後再試", 409);
  }
  if (!db.sessions.some((session) => session.id === entry.sessionId && session.userId === entry.userId)) {
    personalRestorePreviews.delete(token);
    throw portableError("RESTORE_PREVIEW_INVALID", "登入狀態已變更，請重新登入並預覽", 409);
  }
  // 驗證成功就先消耗，避免同一 token 的平行請求同時越過第一道檢查。
  personalRestorePreviews.delete(token);
  if (isRestorePreviewStale(db, entry)) {
    throw portableError("RESTORE_PREVIEW_STALE", "資料已在預覽後更新，請重新預覽再還原", 409, {
      currentRevisions: currentPersonalRevisions(db, auth.user.id),
    });
  }
  personalRestoreCommitInProgress = true;
  let restorePointPath = "";
  let createdAt = "";
  let fileName = "";
  try {
    const result = await commitDbMutation(async (currentDb) => {
      // 可能在 transaction queue 等待過；正式進入臨界區後必須再驗 session 與 preview binding。
      const { user: currentUser, session: currentSession } = requireCurrentMutationAuth(currentDb, auth);
      const sessionStillValid = currentSession.id === entry.sessionId && currentUser.id === entry.userId;
      if (!sessionStillValid || isRestorePreviewStale(currentDb, entry)) {
        throw portableError("RESTORE_PREVIEW_STALE", "資料已在預覽後更新，請重新預覽再還原", 409, {
          currentRevisions: currentPersonalRevisions(currentDb, entry.userId),
        });
      }
      // 自行改密碼會保留目前 session；因此仍需在 queue 內對最新 passwordHash 再驗一次。
      if (!verifyPassword(String(input?.currentPassword || ""), currentUser.passwordHash)) {
        recordLoginFailure(currentUser.username.toLowerCase());
        throw portableError("REAUTH_FAILED", "目前密碼已變更，請重新輸入並再次預覽", 403);
      }

      await mkdir(dbBackupDir, { recursive: true });
      let stableRestorePoint = false;
      for (let attempt = 0; attempt < 3 && !stableRestorePoint; attempt += 1) {
        createdAt = new Date().toISOString();
        fileName = `stock1-pre-restore-${createdAt.replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`;
        restorePointPath = join(dbBackupDir, fileName);
        const snapshotEpoch = dbMutationEpoch;
        const preCommitSnapshot = `${JSON.stringify(currentDb, null, 2)}\n`;
        await writeFileAtomic(restorePointPath, preCommitSnapshot);
        const stillValid = currentDb.sessions.some(
          (session) => session.id === entry.sessionId
            && session.userId === entry.userId
            && new Date(session.expiresAt).getTime() > Date.now(),
        );
        const personalStateStale = isRestorePreviewStale(currentDb, entry) || !stillValid;
        stableRestorePoint = !personalStateStale && dbMutationEpoch === snapshotEpoch;
        if (stableRestorePoint) break;
        await unlink(restorePointPath).catch(() => {});
        restorePointPath = "";
        if (personalStateStale) {
          throw portableError("RESTORE_PREVIEW_STALE", "資料已在預覽後更新，請重新預覽再還原", 409, {
            currentRevisions: currentPersonalRevisions(currentDb, entry.userId),
          });
        }
      }
      if (!stableRestorePoint) {
        throw portableError("RESTORE_SNAPSHOT_BUSY", "資料庫正在更新，暫時無法建立精確還原點；請稍後重新預覽", 409);
      }

      // 不只依賴 rev：再算一次共享容量，防止外部工具直接改 DB 卻漏 bump 的情況。
      const notesPlan = planPortableNotes(currentDb, currentUser, entry.canonical.portableNotes);
      const sections = entry.publicPlan.sections;
      currentDb.watchLists ||= {};
      currentDb.priceAlerts ||= {};
      currentDb.trades ||= {};
      currentDb.stockNotes ||= {};
      if (sections.watchLists.changed) currentDb.watchLists[currentUser.id] = cloneJson(entry.canonical.watchLists);
      if (sections.alerts.changed) currentDb.priceAlerts[currentUser.id] = cloneJson(entry.canonical.alerts);
      if (sections.trades.changed) currentDb.trades[currentUser.id] = cloneJson(entry.canonical.trades);
      if (sections.watchLists.changed) bumpDataRev(currentDb, currentUser.id, "watchLists");
      if (sections.alerts.changed) bumpDataRev(currentDb, currentUser.id, "alerts");
      if (sections.trades.changed) bumpDataRev(currentDb, currentUser.id, "trades");
      for (const note of notesPlan.additions) {
        currentDb.stockNotes[note.code] ||= [];
        currentDb.stockNotes[note.code].push({
          ...cloneJson(note),
          userId: currentUser.id,
          userName: currentUser.displayName || currentUser.username,
        });
      }
      if (notesPlan.additions.length) bumpSharedRev(currentDb, "stockNotes");

      return {
        ok: true,
        revisions: currentPersonalRevisions(currentDb, currentUser.id),
        applied: {
          watchLists: "replaced",
          alerts: "replaced",
          trades: "replaced",
          stockNotes: { added: notesPlan.addCount, duplicates: notesPlan.duplicateCount },
          companyProfiles: "skipped",
        },
        warnings: entry.publicPlan.warnings,
        restorePoint: { fileName, createdAt },
      };
    });
    await prunePersonalRestorePoints();
    return result;
  } finally {
    personalRestoreCommitInProgress = false;
  }
}

// PUT 前置檢查：rev 不符 → 回 409（帶目前 rev，客戶端重新 GET 後重試）並回 true 結束路由。
function rejectStaleRev(db, userId, key, inputRev, response) {
  const currentRev = getDataRev(db, userId, key);
  const clientRev = Number(inputRev) || 0;
  if (clientRev === currentRev) return false;
  jsonResponse(response, 409, {
    ok: false,
    code: "REV_CONFLICT",
    error: "資料已在其他視窗更新過，請先同步最新版再操作。",
    rev: currentRev,
  });
  return true;
}

// 路由用：統一的失敗回應（502=上游抓不到、4xx=客戶端問題）。
function apiFailure(response, status, error) {
  jsonResponse(response, status, {
    ok: false,
    generatedAt: new Date().toISOString(),
    error: typeof error === "string" ? error : error.message,
  });
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
// 有效格式但不存在的帳號仍跑相同 PBKDF2 成本，降低由回應時間枚舉帳號的可能。
const LOGIN_DUMMY_PASSWORD_HASH = "pbkdf2$210000$9f4a0b16c3d2e1785a6b7c8d9e0f1234$d8cb59449180229ce643dbfa695193d724691239c48204c4ba3356f498fe3ebe";

function isValidUsername(value) {
  return typeof value === "string" && USERNAME_PATTERN.test(value);
}

// 登入防爆破：同帳號 15 分鐘內失敗 10 次先擋下（429）。
// 記憶體版、重啟歸零；容量有上限並以 Map 插入順序維護 LRU，避免陌生帳號洪水吃光記憶體。
const loginFailures = new Map(); // usernameLower → { count, firstAt }
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_MAX_ENTRIES = 2048;

function pruneLoginFailures(now = Date.now()) {
  for (const [usernameLower, entry] of loginFailures) {
    if (now - entry.firstAt > LOGIN_FAIL_WINDOW_MS) loginFailures.delete(usernameLower);
  }
  while (loginFailures.size > LOGIN_FAILURE_MAX_ENTRIES) {
    const oldestKey = loginFailures.keys().next().value;
    if (oldestKey === undefined) break;
    loginFailures.delete(oldestKey);
  }
}

function isLoginBlocked(usernameLower, now = Date.now()) {
  pruneLoginFailures(now);
  const entry = loginFailures.get(usernameLower);
  if (!entry) return false;
  // 讀取也算近期使用，避免容量滿時先淘汰正在被防護的帳號。
  loginFailures.delete(usernameLower);
  loginFailures.set(usernameLower, entry);
  return entry.count >= LOGIN_FAIL_LIMIT;
}

function recordLoginFailure(usernameLower, now = Date.now()) {
  pruneLoginFailures(now);
  const entry = loginFailures.get(usernameLower);
  loginFailures.delete(usernameLower);
  loginFailures.set(usernameLower, entry
    ? { count: entry.count + 1, firstAt: entry.firstAt }
    : { count: 1, firstAt: now });
  pruneLoginFailures(now);
}

function resetLoginFailuresForTest() {
  loginFailures.clear();
}

function getLoginFailureSnapshotForTest() {
  return { size: loginFailures.size, keys: [...loginFailures.keys()] };
}

function pruneSessionsForLogin(db, userId, nowTime = Date.now()) {
  const active = (Array.isArray(db.sessions) ? db.sessions : [])
    .filter((session) => new Date(session?.expiresAt).getTime() > nowTime);
  const sameUser = active
    .filter((session) => session.userId === userId)
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
    });
  const keepExisting = new Set(sameUser.slice(-(MAX_SESSIONS_PER_USER - 1)));
  db.sessions = active.filter((session) => session.userId !== userId || keepExisting.has(session));
}

function createSession(db, userId) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  // 不等重啟才整理：每次成功登入都清全域過期項，並只保留同帳號最新的有效 session。
  pruneSessionsForLogin(db, userId, now.getTime());
  const session = {
    id: `s_${randomBytes(8).toString("hex")}`,
    userId,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionMaxAgeMs).toISOString(),
  };
  db.sessions.push(session);
  return { token, session };
}

function setSessionCookie(response, request, token, maxAgeMs = sessionMaxAgeMs) {
  response.setHeader(
    "Set-Cookie",
    serializeCookie("sid", token, {
      maxAge: maxAgeMs / 1000,
      secure: isSecureRequest(request),
    })
  );
}

function clearSessionCookie(response, request) {
  response.setHeader(
    "Set-Cookie",
    serializeCookie("sid", "", {
      maxAge: 0,
      secure: isSecureRequest(request),
    })
  );
}

async function getUserBrokerCredentials(userId) {
  const db = await loadDb();
  const saved = db.brokerCredentials?.[userId];
  if (!saved?.encrypted) return { credentials: null, saved: null };
  try {
    return { credentials: decryptJson(saved.encrypted), saved };
  } catch (error) {
    return { credentials: null, saved: { ...saved, decryptError: error.message } };
  }
}

function cleanCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

const MAX_REQUESTED_CODES = 100;
function parseRequestedCodes(value, fallback = defaultCodes, maxCodes = MAX_REQUESTED_CODES) {
  if (value === null || value === undefined || value === "") return [...fallback];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  if (!raw.length || raw.length > maxCodes) {
    throw new Error(`股票代號一次最多 ${maxCodes} 檔`);
  }
  const normalized = raw.map((item) => String(item || "").trim().toUpperCase());
  if (normalized.some((code) => !SECURITY_CODE_PATTERN.test(code))) {
    throw new Error("股票代號格式不正確（限 4–6 碼英數字）");
  }
  const codes = [...new Set(normalized)];
  if (!codes.length) throw new Error("至少需要一個股票代號");
  return codes;
}

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text === "-" || text === "--") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// 行情價格不可能是 0 或負數。部分 MIS 欄位（實例：7782 的 oz="0.0000"）
// 會用 0 表示沒有試撮／參考價；若沿用一般 parseNumber，會被誤算成 -100%。
// 數量欄位仍可合法為 0，因此只在價格邊界使用這個 helper。
function parsePositivePrice(value) {
  const parsed = parseNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parsePercentNumber(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[% ,]/g, "").trim();
  if (!text || text === "-" || text === "--") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value) {
  const text = String(value || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
  }
  if (/^\d{7}$/.test(text)) {
    const year = Number(text.slice(0, 3)) + 1911;
    return `${year}/${text.slice(3, 5)}/${text.slice(5, 7)}`;
  }
  return text || "";
}

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const taipeiTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function toTaipeiCompactDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(taipeiDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function toTaipeiTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return taipeiTimeFormatter.format(date);
}

function toCompactDate(value = new Date()) {
  if (value instanceof Date) {
    return toTaipeiCompactDate(value);
  }
  const text = String(value || "").replace(/\D/g, "");
  if (/^\d{8,}/.test(text)) return text.slice(0, 8);
  if (/^\d{7}$/.test(text)) {
    const year = Number(text.slice(0, 3)) + 1911;
    return `${year}${text.slice(3, 5)}${text.slice(5, 7)}`;
  }
  return "";
}

function compactToIsoDate(value) {
  const text = toCompactDate(value);
  if (!text) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function compactToSlashDate(value) {
  const text = toCompactDate(value);
  if (!text) return "";
  return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

function compactToRocSlashDate(value) {
  const text = toCompactDate(value);
  if (!text) return "";
  const year = Number(text.slice(0, 4)) - 1911;
  return `${year}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

function addMonthsCompact(value, delta) {
  const text = toCompactDate(value);
  if (!text) return "";
  const date = new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1 + delta, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01`;
}

function addDaysCompact(value, delta) {
  const text = toCompactDate(value);
  if (!text) return "";
  const date = new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)) + delta));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseHistoricalQueryDate(value, maxPastDays = 3660) {
  if (value === null || value === undefined || value === "") return "";
  const compact = toCompactDate(value);
  if (!/^\d{8}$/.test(compact)) throw new Error("日期格式不正確，請使用 YYYY-MM-DD");
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  const today = toTaipeiCompactDate();
  if (!valid || compact > today || compact < addDaysCompact(today, -maxPastDays)) {
    throw new Error(`日期必須是最近 ${Math.floor(maxPastDays / 365)} 年內、不晚於台北今日的有效日期`);
  }
  return compact;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function isOrdinaryStock(quote) {
  if (!quote || !/^\d{4}$/.test(quote.code)) return false;
  // 00 開頭的四碼是 ETF（0050、0056 等），不屬於普通股母體。
  // 特別股（2002A 之類帶字母）與權證（六碼）本來就過不了四碼檢查，
  // 不能用名稱關鍵字「特」排除——會誤殺特力、邦特這種正常公司。
  if (quote.code.startsWith("00")) return false;
  const name = String(quote.name || "");
  const excluded = ["ETF", "ETN", "債", "權證", "購", "售", "牛", "熊", "DR", "受益", "指數"];
  return !excluded.some((token) => name.includes(token));
}

// 整批收盤檔在除權息日把「漲跌」欄設成 "0.0000"——那是一個**可以正常解析的零**，不是遮罩。
// 於是 previousClose 被算成「今天的收盤」、漲跌變成 0.00%，看起來就像一個正常的平盤日。
// 2026-07-27 實測 07/24 除息的六檔：畫面全部顯示 0.00%／中性灰，實際相對官方參考價
// 是 +1.06%（中鋼）到 -2.68%（榮星）。台股慣例是除權息日的漲跌以**除權息參考價**為基準
// （交易所與券商都這樣報），所以 0.00% 不只是不精確，是錯的。
// 連帶影響：preselectQuotes 的 momentumValue = |changePct| × log10(量) 變成 0 → 排序墊底
// → 除權息當天的股票實質上進不了隔日沖候選池。
//
// 這與專案早就記錄過的「MIS 的 0.0000 是無成交哨兵」是同一類陷阱，只是沒人檢查過這個欄位。
//
// **一定要靠官方事件表判斷，不能看到 0 就當事件**：真正的平盤日同樣回 "0.0000"。
// 查不到官方參考價時維持原值（並由掃描端的降級揭露負責告知）。
function applyCorporateActionQuoteBaseline(quote) {
  if (!quote || quote.change !== 0) return quote;
  const price = Number(quote.price);
  if (!Number.isFinite(price) || price <= 0) return quote;
  const item = corporateActionResultFor(quote.code, quote.rawDate || quote.asOf);
  if (!item) return quote;
  const previousClose = item.referencePrice;
  if (!Number.isFinite(previousClose) || previousClose <= 0) return quote;
  const change = price - previousClose;
  return {
    ...quote,
    previousClose,
    change,
    changePct: (change / previousClose) * 100,
    // 讓下游（UI／揭露）知道這個漲跌是相對除權息參考價算的，不是相對前一日收盤。
    corporateActionBaseline: true,
  };
}

function normalizeDailyTwse(row) {
  const close = parsePositivePrice(row.ClosingPrice);
  const change = parseNumber(row.Change);
  const previousCloseCandidate = close !== null && change !== null ? close - change : null;
  const previousClose = previousCloseCandidate > 0 ? previousCloseCandidate : null;
  return {
    code: cleanCode(row.Code),
    name: row.Name,
    exchange: "TWSE",
    source: "TWSE OpenAPI",
    sourceKind: "daily-close",
    asOf: formatDate(row.Date),
    price: close,
    previousClose,
    open: parsePositivePrice(row.OpeningPrice),
    high: parsePositivePrice(row.HighestPrice),
    low: parsePositivePrice(row.LowestPrice),
    change,
    changePct: close !== null && previousClose ? (change / previousClose) * 100 : null,
    unitLots: null,
    volumeLots: Math.round((parseNumber(row.TradeVolume) || 0) / 1000),
    // 官方整批收盤本來就有成交金額，只是以前沒解析 → 補當日 K 時 tradeValue 恆為 null，
    // 導致每一檔（含成交數百億的權值股）都被 buildRiskTags 標成「低流動性」。
    tradeValue: parseNumber(row.TradeValue),
    transactions: parseNumber(row.Transaction),
    rawDate: row.Date,
  };
}

function normalizeDailyTpex(row) {
  const close = parsePositivePrice(row.Close);
  const change = parseNumber(row.Change);
  const previousCloseCandidate = close !== null && change !== null ? close - change : null;
  const previousClose = previousCloseCandidate > 0 ? previousCloseCandidate : null;
  return {
    code: cleanCode(row.SecuritiesCompanyCode),
    name: row.CompanyName,
    exchange: "TPEx",
    source: "TPEx OpenAPI",
    sourceKind: "daily-close",
    asOf: formatDate(row.Date),
    price: close,
    previousClose,
    open: parsePositivePrice(row.Open),
    high: parsePositivePrice(row.High),
    low: parsePositivePrice(row.Low),
    change,
    changePct: close !== null && previousClose ? (change / previousClose) * 100 : null,
    unitLots: null,
    volumeLots: Math.round((parseNumber(row.TradingShares) || 0) / 1000),
    tradeValue: parseNumber(row.TransactionAmount), // 同上：上櫃側的成交金額欄位
    transactions: parseNumber(row.TransactionNumber),
    rawDate: row.Date,
  };
}

function normalizeMisQuote(row, fallback) {
  // z＝最新成交價、pz/oz＝試撮/參考價。三者皆無代表「目前沒有即時成交價」，
  // 這時只能退回用官方收盤價(fallback.price)當顯示值——但那不是真的現價，也不該算成「0% 平盤」。
  // 標記 priceStale，前端才能誠實顯示「暫無即時成交（顯示收盤價）」而非綠/紅/灰的假漲跌。
  const livePrice = parsePositivePrice(row.z) ?? parsePositivePrice(row.pz) ?? parsePositivePrice(row.oz);
  const fallbackPrice = parsePositivePrice(fallback?.price);
  const price = livePrice ?? fallbackPrice;
  const priceStale = livePrice == null && fallbackPrice !== null;
  const previousClose = parsePositivePrice(row.y) ?? parsePositivePrice(fallback?.previousClose);
  const change = price !== null && previousClose !== null ? price - previousClose : fallback?.change ?? null;
  const exchange = row.ex === "otc" ? "TPEx" : "TWSE";
  const date = formatDate(row.d || row["^"] || fallback?.rawDate);
  const time = row.t || row.ot || row["%"] || "";
  const misOpen = parsePositivePrice(row.o);
  const misHigh = parsePositivePrice(row.h);
  const misLow = parsePositivePrice(row.l);
  const officialIntraday = date && [misOpen, misHigh, misLow].every(Number.isFinite)
    ? { date, open: misOpen, high: misHigh, low: misLow, current: livePrice }
    : null;
  return {
    code: cleanCode(row.c || fallback?.code),
    name: row.n || fallback?.name || "",
    exchange,
    source: "TWSE MIS",
    sourceKind: "realtime",
    asOf: `${date}${time ? ` ${time}` : ""}`.trim(),
    price,
    priceStale,
    previousClose,
    open: misOpen ?? parsePositivePrice(fallback?.open),
    high: misHigh ?? parsePositivePrice(fallback?.high),
    low: misLow ?? parsePositivePrice(fallback?.low),
    change,
    changePct: change !== null && previousClose ? (change / previousClose) * 100 : fallback?.changePct ?? null,
    unitLots: parseNumber(row.s),
    volumeLots: parseNumber(row.v) ?? fallback?.volumeLots ?? null,
    transactions: fallback?.transactions ?? null,
    rawDate: row.d || fallback?.rawDate,
    officialIntraday,
  };
}

function formatFubonTime(value) {
  const text = String(value || "").replace(/\D/g, "");
  if (!text) return "";
  if (text.length >= 10) {
    const numeric = Number(text);
    const epochMs = text.length >= 16 ? numeric / 1000 : text.length >= 13 ? numeric : numeric * 1000;
    return toTaipeiTime(epochMs);
  }
  const padded = text.padStart(6, "0");
  const hh = padded.slice(0, 2);
  const mm = padded.slice(2, 4);
  const ss = padded.slice(4, 6);
  return `${hh}:${mm}:${ss}`;
}

function normalizeFubonQuote(row, fallback) {
  const brokerPrice = parsePositivePrice(row.lastPrice) ?? parsePositivePrice(row.closePrice);
  const fallbackPrice = parsePositivePrice(fallback?.price);
  const usesFallback = brokerPrice === null && fallbackPrice !== null;
  const price = brokerPrice ?? fallbackPrice;
  const change = brokerPrice !== null ? parseNumber(row.change) ?? fallback?.change ?? null : fallback?.change ?? null;
  const previousClose = brokerPrice !== null
    ? parsePositivePrice(row.previousClose) ?? (change !== null ? parsePositivePrice(brokerPrice - change) : parsePositivePrice(fallback?.previousClose))
    : parsePositivePrice(fallback?.previousClose);
  const exchange = row.exchange === "OTC" || row.market === "OTC" ? "TPEx" : "TWSE";
  const tradeVolume = parseNumber(row.total?.tradeVolume ?? row.tradeVolume);
  // 富邦 market-data 的 tradeVolume 單位是張；不可用數值大小猜股/張，否則 100000→100000、100001→100 會斷崖。
  const volumeLots = tradeVolume ?? fallback?.volumeLots ?? null;
  const date = formatDate(brokerPrice !== null ? row.date || fallback?.rawDate : fallback?.rawDate);
  const time = brokerPrice !== null ? formatFubonTime(row.lastUpdated || row.closeTime || row.total?.time) : "";
  return {
    code: cleanCode(row.symbol || fallback?.code),
    name: row.name || fallback?.name || "",
    exchange,
    source: brokerPrice !== null ? "Fubon Neo market data" : fallback?.source || "Official daily close fallback",
    sourceKind: brokerPrice !== null ? "broker-realtime" : fallback?.sourceKind || "daily-close",
    asOf: brokerPrice !== null ? `${date}${time ? ` ${time}` : ""}`.trim() : fallback?.asOf || date,
    price,
    priceStale: brokerPrice !== null ? false : usesFallback ? fallback?.priceStale ?? true : false,
    previousClose,
    open: parsePositivePrice(row.openPrice) ?? parsePositivePrice(fallback?.open),
    high: parsePositivePrice(row.highPrice) ?? parsePositivePrice(fallback?.high),
    low: parsePositivePrice(row.lowPrice) ?? parsePositivePrice(fallback?.low),
    change,
    changePct: parseNumber(row.changePercent) ?? (change !== null && previousClose ? (change / previousClose) * 100 : fallback?.changePct ?? null),
    unitLots: parseNumber(row.lastSize) ?? fallback?.unitLots ?? null,
    volumeLots,
    transactions: parseNumber(row.total?.transaction) ?? fallback?.transactions ?? null,
    rawDate: brokerPrice !== null ? row.date || fallback?.rawDate : fallback?.rawDate,
  };
}

async function fetchJson(url, options = {}) {
  // 一定要有逾時：上游「連線成功但永不回應」時，若沒有這層，single-flight 快取
  // 會存住永不 resolve 的 promise，整個面板卡到重開伺服器為止。
  const { timeoutMs = 20000, ...rest } = options;
  let response;
  try {
    response = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "Stock1 local dashboard/0.1",
        ...rest.headers,
      },
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.cause?.name === "TimeoutError") {
      throw new Error(`上游回應逾時（超過 ${Math.round(timeoutMs / 1000)} 秒）：${new URL(url).host}`);
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function withPromiseTimeout(promise, timeoutMs, label = "操作") {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}逾時（超過 ${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

function normalizeTaiexIndex(row) {
  const price = parseNumber(row.z);
  const previousClose = parseNumber(row.y);
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const date = formatDate(row.d || row["^"]);
  const time = row.t || row["%"] || "";
  return {
    key: "taiex",
    label: "加權",
    name: row.n || "發行量加權股價指數",
    price,
    previousClose,
    change,
    changePct,
    asOf: `${date}${time ? ` ${time}` : ""}`.trim(),
    source: "TWSE MIS",
    sourceKind: "realtime-index",
  };
}

async function fetchTaiexIndex() {
  const timestamp = Date.now();
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${timestamp}`;
  const payload = await fetchJson(url, {
    headers: {
      referer: "https://mis.twse.com.tw/stock/index.jsp",
    },
  });
  const row = Array.isArray(payload.msgArray) ? payload.msgArray[0] : null;
  if (!row) throw new Error("TWSE MIS index payload is empty");
  return normalizeTaiexIndex(row);
}

function normalizeTxFuture(row) {
  const price = parseNumber(row.Last);
  const change = parseNumber(row.Change);
  const changePct = parsePercentNumber(row["%"]);
  return {
    key: "tx",
    label: "台指",
    name: `台股期貨 ${row["ContractMonth(Week)"] || ""}`.trim(),
    price,
    previousClose: price !== null && change !== null ? price - change : null,
    change,
    changePct,
    asOf: `${formatDate(row.Date)} ${row.TradingSession || "日盤"}`.trim(),
    source: "TAIFEX DailyMarketReportFut",
    sourceKind: "daily-futures",
    realtime: false,
    freshnessLabel: "期交所日資料",
    contract: row.Contract,
    contractMonth: row["ContractMonth(Week)"],
    volume: parseNumber(row.Volume),
    settlementPrice: parseNumber(row.SettlementPrice),
  };
}

async function fetchTxFuture() {
  const rows = await fetchJson("https://openapi.taifex.com.tw/v1/DailyMarketReportFut");
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => row.Contract === "TX" && row.TradingSession === "一般" && parseNumber(row.Last) !== null)
    .sort((a, b) => {
      const dateSort = String(b.Date || "").localeCompare(String(a.Date || ""));
      if (dateSort) return dateSort;
      return String(a["ContractMonth(Week)"] || "").localeCompare(String(b["ContractMonth(Week)"] || ""));
    });
  if (!candidates.length) throw new Error("TAIFEX TX daily payload is empty");
  return normalizeTxFuture(candidates[0]);
}

function taifexContractMonthLabel(symbolId) {
  const match = /^TXF([A-L])(\d)/.exec(String(symbolId || ""));
  if (!match) return "";
  const month = match[1].charCodeAt(0) - 64;
  const yearDigit = Number(match[2]);
  const nowYear = Number(toTaipeiCompactDate().slice(0, 4));
  let year = Math.floor(nowYear / 10) * 10 + yearDigit;
  if (year < nowYear - 5) year += 10;
  return `${year}/${String(month).padStart(2, "0")}`;
}

function normalizeTaifexMisTx(row, sessionLabel) {
  const price = parseNumber(row.CLastPrice);
  const previousClose = parseNumber(row.CRefPrice);
  const change = parseNumber(row.CDiff) ?? (price !== null && previousClose !== null ? price - previousClose : null);
  const changePct = parseNumber(row.CDiffRate) ?? (change !== null && previousClose ? (change / previousClose) * 100 : null);
  const date = formatDate(row.CDate);
  const time = formatFubonTime(row.CTime);
  return {
    key: "tx",
    label: "台指",
    name: `台指期 ${taifexContractMonthLabel(row.SymbolID)} ${sessionLabel}`.trim(),
    price,
    previousClose,
    change,
    changePct,
    asOf: `${date}${time ? ` ${time}` : ""}`.trim(),
    source: "TAIFEX MIS",
    sourceKind: "realtime-futures",
    realtime: true,
    session: sessionLabel,
    contract: "TX",
    contractMonth: taifexContractMonthLabel(row.SymbolID),
    volume: parseNumber(row.CTotalVolume),
  };
}

async function fetchTaifexMisTxSession(marketType) {
  const payload = await fetchJson("https://mis.taifex.com.tw/futures/api/getQuoteList", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: "https://mis.taifex.com.tw/futures/",
    },
    body: JSON.stringify({
      MarketType: marketType,
      SymbolType: "F",
      KindID: "1",
      CID: "",
      ExpireMonth: "",
      RowSize: "全部",
      PageNo: "",
      SortColumn: "",
      AscDesc: "A",
    }),
  });
  const rows = Array.isArray(payload?.RtData?.QuoteList) ? payload.RtData.QuoteList : [];
  // 只留月份契約（TXF + 月份碼 + 年碼），排除現貨列與價差單。
  return rows.filter((row) => /^TXF[A-L]\d-(F|M)$/.test(String(row.SymbolID || "")) && parseNumber(row.CLastPrice) !== null);
}

// 從期交所 MIS 抓台指期近即時報價：日盤與夜盤都查，
// 取資料日期最新的時段，再用成交量挑近月契約。
async function fetchTxRealtime() {
  const [dayResult, nightResult] = await Promise.allSettled([
    fetchTaifexMisTxSession("0"),
    fetchTaifexMisTxSession("1"),
  ]);
  const candidates = [];
  if (dayResult.status === "fulfilled") {
    dayResult.value.forEach((row) => candidates.push({ row, session: "日盤" }));
  }
  if (nightResult.status === "fulfilled") {
    nightResult.value.forEach((row) => candidates.push({ row, session: "夜盤" }));
  }
  if (!candidates.length) throw new Error("TAIFEX MIS TX payload is empty");

  const stamp = (item) => `${item.row.CDate || ""}${String(item.row.CTime || "").padStart(6, "0")}`;
  const latest = candidates.reduce((best, item) => (stamp(item) > stamp(best) ? item : best), candidates[0]);
  const sameSession = candidates.filter((item) => item.session === latest.session && item.row.CDate === latest.row.CDate);
  const best = sameSession.reduce(
    (top, item) => ((parseNumber(item.row.CTotalVolume) || 0) > (parseNumber(top.row.CTotalVolume) || 0) ? item : top),
    sameSession[0]
  );
  return normalizeTaifexMisTx(best.row, best.session);
}

async function fetchTxQuote() {
  try {
    return await fetchTxRealtime();
  } catch (error) {
    const daily = await fetchTxFuture();
    daily.staleReason = `台指期即時行情暫時失敗（${error.message}），改用期交所日報表。`;
    return daily;
  }
}

function buildStockMarketCalendarStatus(evidence, dateCompact = toTaipeiCompactDate()) {
  const day = toCompactDate(dateCompact);
  if (!day) return null;
  const tradingDays = unique((evidence?.tradingDays || []).map(toCompactDate).filter(Boolean));
  const holidayRows = evidence?.holidayRows || [];
  const explicitTradingDay = tradingDays.includes(day);
  const holiday = holidayRows.find((row) => toCompactDate(row.date) === day && !isCalendarOpenOverride(row));
  const openOverride = holidayRows.find((row) => toCompactDate(row.date) === day && isCalendarOpenOverride(row));
  const holidaysUsable = ["fresh", "stale"].includes(evidence?.sources?.holidays?.status);
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  let stockTradingDay = null;
  let confidence = "unknown";
  if (explicitTradingDay || openOverride) {
    stockTradingDay = true;
    confidence = explicitTradingDay ? "actual-session" : "calendar-open-override";
  } else if (holiday) {
    stockTradingDay = false;
    confidence = "official-holiday";
  } else if (holidaysUsable) {
    stockTradingDay = isScheduledTradingDate(day, holidayRows);
    confidence = "official-schedule";
  } else if (weekend) {
    stockTradingDay = false;
    confidence = "weekend-fallback";
  }
  return {
    date: compactToIsoDate(day),
    stockTradingDay,
    holidayName: holiday?.name || holiday?.description || "",
    confidence,
    degraded: Boolean(evidence?.degraded),
  };
}

async function getMarketSummary() {
  const now = Date.now();
  if (marketCache.value && marketCache.expiresAt > now) {
    return marketCache.value;
  }

  const warnings = [];
  const [taiexResult, txResult] = await Promise.allSettled([fetchTaiexIndex(), fetchTxQuote()]);
  const markets = {};
  if (taiexResult.status === "fulfilled") {
    markets.taiex = taiexResult.value;
  } else {
    warnings.push(`加權指數更新失敗：${taiexResult.reason.message}`);
  }
  if (txResult.status === "fulfilled") {
    markets.tx = txResult.value;
  } else {
    warnings.push(`台指期更新失敗：${txResult.reason.message}`);
  }

  const taiexDate = toCompactDate(markets.taiex?.asOf);
  const txDate = toCompactDate(markets.tx?.asOf);
  if (markets.tx && taiexDate && txDate && txDate < taiexDate) {
    markets.tx.stale = true;
    markets.tx.staleReason = `台指期資料日期 ${compactToSlashDate(txDate)} 早於加權指數 ${compactToSlashDate(taiexDate)}`;
    warnings.push(markets.tx.staleReason);
  }

  const body = {
    ok: Boolean(markets.taiex || markets.tx),
    generatedAt: new Date().toISOString(),
    sourceKey: "official",
    sourceLabel: dataSourceLabels.official,
    source: "TWSE MIS + TAIFEX MIS",
    markets,
    warnings,
    notes: [
      "加權 uses TWSE MIS tse_t00.tw.",
      "台指 uses TAIFEX MIS realtime quotes (day + after-hours session); falls back to DailyMarketReportFut when MIS is unavailable.",
    ],
  };

  marketCache = {
    expiresAt: now + 15 * 1000,
    value: body,
  };
  return body;
}

async function getMarketSessionStatus() {
  const evidence = await getTradingCalendarEvidence();
  const status = buildStockMarketCalendarStatus(evidence);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Taipei",
    stock: status ? {
      date: status.date,
      tradingDay: status.stockTradingDay,
      holidayName: status.holidayName,
      confidence: status.confidence,
      degraded: status.degraded,
    } : null,
    warnings: evidence.warnings || [],
  };
}

function assertReasonableSnapshotSize(label, nextSize, previousSize) {
  // 上游偶爾回半包 200；只有已經看過足夠大的正常快照時才套比例防護，
  // 避免測試／小型新市場被單筆差異誤判，同時不讓上千筆清單突然縮成幾十筆覆蓋 last-good。
  if (previousSize >= 10 && nextSize < Math.ceil(previousSize * 0.6)) {
    throw new Error(`${label}有效筆數 ${nextSize}，低於最近成功資料的 60%`);
  }
}

const COMPANY_DIRECTORY_SOURCES = {
  twse: {
    label: "上市",
    url: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  },
  tpex: {
    label: "上櫃",
    url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
  },
};

function parseCompanyDirectorySnapshot(marketKey, rows, previous) {
  const source = COMPANY_DIRECTORY_SOURCES[marketKey];
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${source.label}公司主檔回傳空資料`);
  const issuedShares = new Map();
  const companyMeta = new Map();
  for (const row of rows) {
    const code = cleanCode(marketKey === "twse" ? row["公司代號"] : row.SecuritiesCompanyCode);
    if (!code) continue;
    const issued = parseNumber(marketKey === "twse"
      ? row["已發行普通股數或TDR原股發行股數"]
      : row.IssueShares);
    if (issued > 0) issuedShares.set(code, issued);
    const industry = resolveIndustryName(marketKey === "twse" ? row["產業別"] : row.SecuritiesIndustryCode);
    const shortName = String(marketKey === "twse" ? row["公司簡稱"] || "" : row.CompanyAbbreviation || "").trim();
    if (industry || shortName || issued > 0) companyMeta.set(code, { industry, shortName });
  }
  const validCodes = new Set([...issuedShares.keys(), ...companyMeta.keys()]);
  if (!validCodes.size) throw new Error(`${source.label}公司主檔沒有有效公司代號`);
  assertReasonableSnapshotSize(source.label, validCodes.size, previous?.validCount || 0);
  return {
    issuedShares,
    companyMeta,
    count: rows.length,
    validCount: validCodes.size,
    fetchedAt: new Date().toISOString(),
  };
}

// 官方主檔類載入器共用的「TTL 新鮮 → single-flight → 退避期內回 last-good → 失敗保留舊值」骨架。
// 原本 reference／公司主檔／商品主檔／交易日曆四支各自抄了一份同樣的 25 行；抄漏一行
// （例如忘了在 finally 清 inFlight）就會把永不 resolve 的 promise 存進快取，整個面板卡死。
// state 沿用 { value, expiresAt, retryAt, lastError, inFlight } 形狀；load(previousValue) 回新值或 throw。
async function loadWithLastGood(state, { ttlMs, retryMs, load }) {
  const now = Date.now();
  if (state.value && state.expiresAt > now) return { status: "fresh", value: state.value, error: "" };
  if (state.inFlight) return state.inFlight;
  if (state.retryAt > now) {
    return { status: state.value ? "stale" : "unavailable", value: state.value, error: state.lastError };
  }
  state.inFlight = (async () => {
    try {
      const value = await load(state.value);
      state.value = value;
      state.expiresAt = Date.now() + ttlMs;
      state.retryAt = 0;
      state.lastError = "";
      return { status: "fresh", value, error: "" };
    } catch (error) {
      state.lastError = String(error?.message || error || "未知錯誤");
      state.retryAt = Date.now() + retryMs;
      return { status: state.value ? "stale" : "unavailable", value: state.value, error: state.lastError };
    }
  })().finally(() => {
    state.inFlight = null;
  });
  return state.inFlight;
}

async function loadCompanyDirectoryMarket(marketKey) {
  const source = COMPANY_DIRECTORY_SOURCES[marketKey];
  return loadWithLastGood(companyDirectoryMarketCache[marketKey], {
    ttlMs: COMPANY_DIRECTORY_TTL_MS,
    retryMs: COMPANY_DIRECTORY_RETRY_MS,
    load: async (previous) => parseCompanyDirectorySnapshot(marketKey, await fetchJson(source.url), previous),
  });
}

// 公司主檔只抓一次，同時產生「發行股數」與「產業／簡稱」兩種視圖；
// 每個市場獨立 last-good，單一市場故障不會把另一市場的半包結果凍結 24 小時。
async function getCompanyDirectory() {
  const now = Date.now();
  if (companyDirectoryCache.value && companyDirectoryCache.expiresAt > now) return companyDirectoryCache.value;
  if (companyDirectoryInFlight) return companyDirectoryInFlight;
  companyDirectoryInFlight = (async () => {
    const [twse, tpex] = await Promise.all([
      loadCompanyDirectoryMarket("twse"),
      loadCompanyDirectoryMarket("tpex"),
    ]);
    const results = { twse, tpex };
    const issuedShares = new Map();
    const companyMeta = new Map();
    const marketByCode = new Map();
    const warnings = [];
    const markets = {};
    for (const marketKey of ["twse", "tpex"]) {
      const result = results[marketKey];
      const source = COMPANY_DIRECTORY_SOURCES[marketKey];
      if (result.value) {
        for (const [code, shares] of result.value.issuedShares) issuedShares.set(code, shares);
        for (const [code, meta] of result.value.companyMeta) companyMeta.set(code, meta);
        const exchange = marketKey === "twse" ? "TWSE" : "TPEx";
        for (const code of new Set([
          ...result.value.issuedShares.keys(),
          ...result.value.companyMeta.keys(),
        ])) marketByCode.set(code, exchange);
      }
      markets[marketKey] = {
        available: Boolean(result.value),
        stale: result.status === "stale",
        count: result.value?.count || 0,
        validCount: result.value?.validCount || 0,
        fetchedAt: result.value?.fetchedAt || null,
      };
      if (result.status === "stale") {
        warnings.push(`${source.label}公司主檔暫時更新失敗（${result.error}），已沿用最近成功資料。`);
      } else if (result.status === "unavailable") {
        warnings.push(`${source.label}公司主檔抓取失敗（${result.error}），相關產業與週轉率資料暫缺。`);
      }
    }
    const degraded = Object.values(results).some((result) => result.status !== "fresh");
    const finishedAt = Date.now();
    const fullExpiry = Math.min(
      companyDirectoryMarketCache.twse.expiresAt || finishedAt + COMPANY_DIRECTORY_TTL_MS,
      companyDirectoryMarketCache.tpex.expiresAt || finishedAt + COMPANY_DIRECTORY_TTL_MS,
    );
    const value = { issuedShares, companyMeta, marketByCode, warnings: unique(warnings), degraded, markets };
    companyDirectoryCache = {
      expiresAt: degraded ? finishedAt + COMPANY_DIRECTORY_RETRY_MS : fullExpiry,
      value,
    };
    return value;
  })().finally(() => {
    companyDirectoryInFlight = null;
  });
  return companyDirectoryInFlight;
}

async function getIssuedShares() {
  return (await getCompanyDirectory()).issuedShares;
}

async function getCompanyMeta() {
  return (await getCompanyDirectory()).companyMeta;
}

function computeTurnoverPct(volumeLots, issuedShares) {
  if (!Number.isFinite(volumeLots) || !Number.isFinite(issuedShares) || issuedShares <= 0) return null;
  return (volumeLots * 1000 / issuedShares) * 100;
}

// ===== 官方 ETF 商品主檔（交易帳本商品分類）=====
const PRODUCT_DIRECTORY_RULE_VERSION = "official-product-directory-v1";
const TWSE_ETF_DIRECTORY_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap47_L";
const TPEX_ETF_DIRECTORY_URL = "https://www.tpex.org.tw/www/zh-tw/ETF/list";
const TPEX_ETF_CATEGORIES = ["domestic", "foreign", "bond", "futures", "leveraged", "active", "multi"];
const TPEX_ETF_FIELDS = ["證券代號", "ETF簡稱", "上櫃日期"];
const TWSE_ETF_FUND_TYPES = new Set([
  "指數股票型期貨信託基金",
  "國內成分證券主動式交易所交易基金(股票)",
  "國內成分證券指數股票型基金",
  "國外成分證券主動式交易所交易基金(股票)",
  "國外成分證券主動式交易所交易基金(債券)",
  "國外成分證券平衡型指數股票型基金",
  "國外成分證券指數股票型基金",
  "國外成份/加掛外幣證券指數股票型基金",
  "連結式證券指數股票型基金",
  "境外指數股票型基金",
  "槓桿/反向指數股票型基金",
]);

function classifyOfficialEtf(code, { fundType = "", memberships = [] } = {}) {
  const securityCode = cleanCode(code);
  const typeText = String(fundType || "").trim();
  const groups = new Set(Array.isArray(memberships) ? memberships : []);
  if (groups.has("active") || /主動式/.test(typeText) || /[AD]$/.test(securityCode)) return "activeEtf";
  if (groups.has("leveraged") || /槓桿|反向/.test(typeText) || /[LMRS]$/.test(securityCode)) {
    return "leveragedInverseEtf";
  }
  if (/期貨|平衡型|多資產/.test(typeText) || groups.has("futures") || groups.has("multi") || /[UVT]$/.test(securityCode)) {
    return "otherEtf";
  }
  if (groups.has("bond") || /[BC]$/.test(securityCode)) return "bondIndexEtf";
  return "equityEtf";
}

function parseTwseEtfDirectorySnapshot(rows, previous = null) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("上市 ETF 官方主檔回傳空資料");
  const byCode = new Map();
  const sourceDates = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("上市 ETF 官方主檔含有非物件資料列");
    for (const field of ["出表日期", "基金代號", "基金簡稱", "基金類型", "基金中文名稱", "成立日期", "上市日期"]) {
      if (typeof row[field] !== "string" || !row[field].trim()) throw new Error(`上市 ETF 官方主檔缺少必要欄位：${field}`);
    }
    const rawCode = String(row["基金代號"] || "").trim().toUpperCase();
    if (!SECURITY_CODE_PATTERN.test(rawCode)) throw new Error(`上市 ETF 官方主檔含無效代號：${rawCode || "空白"}`);
    const asOf = toCompactDate(row["出表日期"]);
    const listingDate = toCompactDate(row["上市日期"]);
    const inceptionDate = toCompactDate(row["成立日期"]);
    if (!isValidCompactCalendarDate(asOf) || !isValidCompactCalendarDate(listingDate) || !isValidCompactCalendarDate(inceptionDate)) {
      throw new Error(`上市 ETF ${rawCode} 含無效日期`);
    }
    sourceDates.add(asOf);
    const fundType = String(row["基金類型"] || "").trim();
    if (!TWSE_ETF_FUND_TYPES.has(fundType)) throw new Error(`上市 ETF 官方主檔出現未知基金類型：${fundType}`);
    if (byCode.has(rawCode)) throw new Error(`上市 ETF 官方主檔代號重複：${rawCode}`);
    // t187ap47_L 也保留歷史基金；未到 sourceAsOf 上市日的列不當成當時已上市商品。
    if (listingDate > asOf) continue;
    byCode.set(rawCode, {
      code: rawCode,
      name: String(row["基金簡稱"] || row["基金中文名稱"] || "").trim(),
      market: "TWSE",
      instrumentType: classifyOfficialEtf(rawCode, { fundType }),
      officialCategory: fundType,
      memberships: [],
      listingDate,
      membershipStatus: "unknown",
      instrumentSource: "official",
      instrumentRuleId: `${PRODUCT_DIRECTORY_RULE_VERSION}:twse-t187ap47`,
      instrumentAsOf: asOf,
    });
  }
  if (!byCode.size) throw new Error("上市 ETF 官方主檔沒有有效商品");
  if (sourceDates.size !== 1) throw new Error("上市 ETF 官方主檔資料日不一致");
  assertReasonableSnapshotSize("上市 ETF 官方主檔", byCode.size, previous?.validCount || 0);
  return {
    byCode,
    count: rows.length,
    validCount: byCode.size,
    asOf: [...sourceDates][0],
    fetchedAt: new Date().toISOString(),
  };
}

function parseTpexEtfCategory(category, payload) {
  if (!TPEX_ETF_CATEGORIES.includes(category)) throw new Error(`未知的上櫃 ETF 分類：${category}`);
  const asOf = toCompactDate(payload?.date);
  if (!isValidCompactCalendarDate(asOf)) throw new Error(`上櫃 ETF ${category} 缺少有效資料日`);
  const stat = String(payload?.stat || "").trim();
  if (stat.toLowerCase() !== "ok" && stat !== "暫無相關商品") {
    throw new Error(`上櫃 ETF ${category} 回傳狀態異常：${stat || "空白"}`);
  }
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  const fields = Array.isArray(table?.fields) ? table.fields.map((field) => String(field).trim()) : [];
  const data = Array.isArray(table?.data) ? table.data : null;
  if (!data || TPEX_ETF_FIELDS.some((field, index) => fields[index] !== field)) {
    throw new Error(`上櫃 ETF ${category} 欄位契約已變更`);
  }
  const totalCount = Number(table.totalCount);
  if (!Number.isInteger(totalCount) || totalCount !== data.length) {
    throw new Error(`上櫃 ETF ${category} 筆數與 totalCount 不一致`);
  }
  const rows = [];
  const seenCodes = new Set();
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const code = String(row[0] || "").trim().toUpperCase();
    if (!SECURITY_CODE_PATTERN.test(code)) continue;
    if (seenCodes.has(code)) throw new Error(`上櫃 ETF ${category} 代號重複：${code}`);
    seenCodes.add(code);
    const listingDate = toCompactDate(row[2]);
    if (!isValidCompactCalendarDate(listingDate)) throw new Error(`上櫃 ETF ${category} ${code} 含無效上櫃日期`);
    rows.push({ code, name: String(row[1] || "").trim(), listingDate });
  }
  if (totalCount > 0 && rows.length === 0) throw new Error(`上櫃 ETF ${category} 沒有有效商品代號`);
  return { category, asOf, totalCount, rows };
}

function parseTpexEtfDirectorySnapshot(payloads, previous = null) {
  const parsed = TPEX_ETF_CATEGORIES.map((category) => parseTpexEtfCategory(category, payloads?.[category]));
  const sourceDates = new Set(parsed.map((entry) => entry.asOf));
  if (sourceDates.size !== 1) throw new Error("上櫃 ETF 各分類資料日不一致");
  const membershipsByCode = new Map();
  const metaByCode = new Map();
  for (const entry of parsed) {
    for (const row of entry.rows) {
      if (!membershipsByCode.has(row.code)) membershipsByCode.set(row.code, new Set());
      membershipsByCode.get(row.code).add(entry.category);
      const current = metaByCode.get(row.code);
      if (!current || (!current.name && row.name)) metaByCode.set(row.code, row);
    }
  }
  if (!membershipsByCode.size) throw new Error("上櫃 ETF 官方主檔沒有有效商品");
  assertReasonableSnapshotSize("上櫃 ETF 官方主檔", membershipsByCode.size, previous?.validCount || 0);
  const asOf = [...sourceDates][0];
  const byCode = new Map();
  for (const [code, membershipSet] of membershipsByCode) {
    const memberships = TPEX_ETF_CATEGORIES.filter((category) => membershipSet.has(category));
    const meta = metaByCode.get(code) || {};
    byCode.set(code, {
      code,
      name: meta.name || "",
      market: "TPEx",
      instrumentType: classifyOfficialEtf(code, { memberships }),
      officialCategory: memberships.join("+"),
      memberships,
      listingDate: meta.listingDate || "",
      membershipStatus: "current",
      instrumentSource: "official",
      instrumentRuleId: `${PRODUCT_DIRECTORY_RULE_VERSION}:tpex-etf-list`,
      instrumentAsOf: asOf,
    });
  }
  return {
    byCode,
    count: parsed.reduce((sum, entry) => sum + entry.totalCount, 0),
    validCount: byCode.size,
    asOf,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchTpexEtfDirectoryPayloads() {
  const entries = await Promise.all(TPEX_ETF_CATEGORIES.map(async (category) => {
    const body = new URLSearchParams({ type: category });
    if (category === "bond") body.set("bondType", "0");
    body.set("response", "json");
    const payload = await fetchJson(TPEX_ETF_DIRECTORY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
    });
    return [category, payload];
  }));
  return Object.fromEntries(entries);
}

async function loadProductDirectoryMarket(marketKey) {
  return loadWithLastGood(productDirectoryMarketCache[marketKey], {
    ttlMs: PRODUCT_DIRECTORY_TTL_MS,
    retryMs: PRODUCT_DIRECTORY_RETRY_MS,
    load: async (previous) => (marketKey === "twse"
      ? parseTwseEtfDirectorySnapshot(await fetchJson(TWSE_ETF_DIRECTORY_URL), previous)
      : parseTpexEtfDirectorySnapshot(await fetchTpexEtfDirectoryPayloads(), previous)),
  });
}

async function getProductDirectory() {
  const now = Date.now();
  if (productDirectoryCache.value && productDirectoryCache.expiresAt > now) return productDirectoryCache.value;
  if (productDirectoryInFlight) return productDirectoryInFlight;
  productDirectoryInFlight = (async () => {
    const [twse, tpex] = await Promise.all([loadProductDirectoryMarket("twse"), loadProductDirectoryMarket("tpex")]);
    const results = { twse, tpex };
    const byCode = new Map();
    const warnings = [];
    const markets = {};
    for (const marketKey of ["twse", "tpex"]) {
      const result = results[marketKey];
      const label = marketKey === "twse" ? "上市 ETF" : "上櫃 ETF";
      if (result.value) {
        for (const [code, profile] of result.value.byCode) {
          if (byCode.has(code) && byCode.get(code).market !== profile.market) {
            warnings.push(`官方商品主檔代號 ${code} 同時出現在上市與上櫃，暫採上市資料`);
            continue;
          }
          byCode.set(code, profile);
        }
      }
      markets[marketKey] = {
        available: Boolean(result.value),
        stale: result.status === "stale",
        status: result.status,
        count: result.value?.count || 0,
        validCount: result.value?.validCount || 0,
        asOf: result.value?.asOf || null,
        fetchedAt: result.value?.fetchedAt || null,
      };
      if (result.status === "stale") warnings.push(`${label} 主檔更新失敗（${result.error}），沿用最近成功資料`);
      if (result.status === "unavailable") warnings.push(`${label} 主檔暫時無法取得（${result.error}）`);
    }
    const coverageComplete = twse.status === "fresh" && tpex.status === "fresh";
    const finishedAt = Date.now();
    const fullExpiry = Math.min(
      productDirectoryMarketCache.twse.expiresAt || finishedAt + PRODUCT_DIRECTORY_TTL_MS,
      productDirectoryMarketCache.tpex.expiresAt || finishedAt + PRODUCT_DIRECTORY_TTL_MS,
    );
    const value = {
      byCode,
      counts: { twse: twse.value?.validCount || 0, tpex: tpex.value?.validCount || 0 },
      warnings: unique(warnings),
      degraded: !coverageComplete,
      coverageComplete,
      markets,
    };
    productDirectoryCache = { expiresAt: coverageComplete ? fullExpiry : finishedAt + PRODUCT_DIRECTORY_RETRY_MS, value };
    return value;
  })().finally(() => {
    productDirectoryInFlight = null;
  });
  return productDirectoryInFlight;
}

function officialProfileForStock(code, companyDirectory) {
  const market = companyDirectory?.marketByCode?.get(code);
  if (!market) return null;
  const meta = companyDirectory.companyMeta?.get(code) || {};
  return {
    code,
    name: meta.shortName || "",
    market,
    instrumentType: "stock",
    officialCategory: "ordinary-stock-company-directory",
    memberships: [],
    membershipStatus: "current",
    instrumentSource: "official",
    instrumentRuleId: `${PRODUCT_DIRECTORY_RULE_VERSION}:company-directory`,
    instrumentAsOf: toTaipeiCompactDate(),
  };
}

function officialProfileForEtn(code, reference) {
  if (!/^02(?:\d{4}|\d{3}[LRB])$/.test(code)) return null;
  const quote = reference?.byCode?.get(code);
  if (!quote) return null;
  const market = quote.exchange === "TPEx" ? "TPEx" : quote.exchange === "TWSE" ? "TWSE" : "unknown";
  const asOf = toCompactDate(quote.date || quote.asOf) || toTaipeiCompactDate();
  return {
    code,
    name: String(quote.name || "").trim(),
    market,
    instrumentType: "etn",
    officialCategory: "exchange-traded-note",
    memberships: [],
    membershipStatus: "current",
    instrumentSource: "official",
    instrumentRuleId: `${PRODUCT_DIRECTORY_RULE_VERSION}:official-quote-etn-code`,
    instrumentAsOf: asOf,
  };
}

async function resolveOfficialInstruments(codes) {
  const requested = unique((Array.isArray(codes) ? codes : [codes])
    .map((code) => cleanCode(code))
    .filter((code) => SECURITY_CODE_PATTERN.test(code)));
  const [productResult, companyResult, referenceResult] = await Promise.allSettled([
    getProductDirectory(),
    getCompanyDirectory(),
    getReferenceData(),
  ]);
  const productDirectory = productResult.status === "fulfilled" ? productResult.value : null;
  const companyDirectory = companyResult.status === "fulfilled" ? companyResult.value : null;
  const reference = referenceResult.status === "fulfilled" ? referenceResult.value : null;
  const warnings = [
    ...(productDirectory?.warnings || []),
    ...(companyDirectory?.warnings || []),
    ...(reference?.warnings || []),
  ];
  if (productResult.status === "rejected") warnings.push(`ETF 官方主檔暫時無法取得（${productResult.reason?.message || productResult.reason}）`);
  if (companyResult.status === "rejected") warnings.push(`公司官方主檔暫時無法取得（${companyResult.reason?.message || companyResult.reason}）`);
  if (referenceResult.status === "rejected") warnings.push(`官方收盤主檔暫時無法取得（${referenceResult.reason?.message || referenceResult.reason}）`);
  const profiles = new Map();
  for (const code of requested) {
    const productProfile = productDirectory?.byCode?.get(code);
    let profile = productProfile ? { ...productProfile } : null;
    if (profile?.market === "TWSE") {
      if (reference?.byCode?.has(code)) profile.membershipStatus = "current";
      else if (reference?.markets?.twse?.status === "fresh") profile.membershipStatus = "notCurrent";
      else profile.membershipStatus = "unknown";
    }
    profile ||= officialProfileForEtn(code, reference) || officialProfileForStock(code, companyDirectory);
    if (profile) profiles.set(code, profile);
  }
  return {
    profiles,
    warnings: unique(warnings),
    dataQuality: {
      degraded: Boolean(
        !productDirectory?.coverageComplete
        || companyDirectory?.degraded
        || !reference?.coverageComplete
      ),
      productDirectory: productDirectory ? {
        coverageComplete: productDirectory.coverageComplete,
        markets: productDirectory.markets,
      } : { coverageComplete: false, markets: {} },
      companyDirectory: companyDirectory ? {
        degraded: Boolean(companyDirectory.degraded),
        markets: companyDirectory.markets,
      } : { degraded: true, markets: {} },
      reference: reference ? {
        coverageComplete: reference.coverageComplete,
        markets: reference.markets,
      } : { coverageComplete: false, markets: {} },
    },
  };
}

const SYSTEM_INSTRUMENT_REVIEW_PREFIXES = [
  "商品分類尚未由後端官方商品主檔確認",
  "舊版官方分類缺少後端驗證憑據",
  "成交日早於官方商品掛牌日",
  "債券指數 ETF 停徵資格尚未由官方商品主檔或券商實際稅額確認",
];

function withoutSystemInstrumentReviewReasons(value) {
  return normalizeReviewReasons(value).filter((reason) => (
    !SYSTEM_INSTRUMENT_REVIEW_PREFIXES.some((prefix) => reason.startsWith(prefix))
  ));
}

// 僅在已通過 rev 檢查的 PUT 路徑呼叫。客戶端的 official/rule/as-of 一律不是證據：
// 同一筆既有商品沿用伺服器已保存的 stamp；新商品或換代號才查官方主檔重核。
async function canonicalizeTradeInstrumentProvenance(input, existingPayload) {
  const source = input && typeof input === "object" ? input : {};
  const existingById = new Map((existingPayload?.records || []).map((record) => [String(record.id || ""), record]));
  const records = Array.isArray(source.records)
    ? source.records.map((record) => (record && typeof record === "object" ? { ...record } : record))
    : [];
  const pendingCodes = new Set();
  const pendingIndexes = [];

  records.forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return;
    const hasExplicitInstrument = record.instrumentType != null && record.instrumentType !== "";
    if (!hasExplicitInstrument) {
      record.instrumentSource = "legacy";
      delete record.instrumentRuleId;
      delete record.instrumentAsOf;
      return;
    }
    const code = cleanCode(record.code);
    const instrumentType = normalizeTradeInstrumentType(record);
    const existing = existingById.get(String(record.id || ""));
    const sameIdentity = existing
      && cleanCode(existing.code) === code
      && normalizeTradeInstrumentType(existing) === instrumentType
      && toCompactDate(existing.tradeDate || existing.date) === toCompactDate(record.tradeDate || record.date);
    if (sameIdentity) {
      record.market = existing.market || "unknown";
      record.instrumentSource = existing.instrumentSource || "user";
      record.reviewStatus = existing.reviewStatus;
      record.reviewReasons = unique([
        ...normalizeReviewReasons(existing.reviewReasons),
        ...normalizeReviewReasons(record.reviewReasons),
      ]);
      if (hasTrustedOfficialInstrumentProvenance(existing)) {
        record.instrumentRuleId = existing.instrumentRuleId;
        record.instrumentAsOf = existing.instrumentAsOf;
      } else {
        delete record.instrumentRuleId;
        delete record.instrumentAsOf;
      }
      return;
    }
    pendingCodes.add(code);
    pendingIndexes.push(index);
  });

  const resolution = pendingIndexes.length
    ? await resolveOfficialInstruments([...pendingCodes])
    : { profiles: new Map(), warnings: [], dataQuality: { degraded: false } };
  for (const index of pendingIndexes) {
    const record = records[index];
    const code = cleanCode(record.code);
    const profile = resolution.profiles.get(code);
    const tradeDate = toCompactDate(record.tradeDate || record.date);
    const listedForTrade = !profile?.listingDate || !tradeDate || tradeDate >= profile.listingDate;
    record.reviewReasons = withoutSystemInstrumentReviewReasons(record.reviewReasons);
    delete record.reviewStatus;
    if (profile && listedForTrade) {
      record.market = profile.market;
      record.instrumentType = profile.instrumentType;
      record.instrumentSource = "official";
      record.instrumentRuleId = profile.instrumentRuleId;
      record.instrumentAsOf = profile.instrumentAsOf;
    } else {
      record.instrumentSource = "user";
      delete record.instrumentRuleId;
      delete record.instrumentAsOf;
      record.reviewReasons.push(profile && !listedForTrade
        ? `成交日早於官方商品掛牌日 ${compactToIsoDate(profile.listingDate)}，分類保留待覆核`
        : "商品分類尚未由後端官方商品主檔確認");
    }
  }
  return {
    payload: { ...source, records },
    warnings: resolution.warnings,
    dataQuality: resolution.dataQuality,
  };
}

// estimated／legacy 金額與 rule id 都是伺服器管理欄位。這個 fingerprint 只含
// 會影響費稅估算或交易身分的欄位，刻意不含全域 settings：既有估值寫入後應凍結，
// 日後調整折數不能追溯改寫歷史紀錄。
function tradeMoneyEstimateFingerprint(raw) {
  const side = String(raw?.side || "");
  const shares = Number(raw?.shares);
  const priceValue = Number(raw?.price);
  const price = side === "dividend"
    ? Math.round(priceValue * 1e6) / 1e6
    : Math.round(priceValue * 100) / 100;
  const instrumentSource = TRADE_INSTRUMENT_SOURCES.has(raw?.instrumentSource)
    ? raw.instrumentSource
    : "user";
  const dayTrade = normalizeTradeDayTrade(raw, shares);
  return JSON.stringify({
    code: cleanCode(raw?.code),
    market: TRADE_MARKETS.has(raw?.market) ? raw.market : "unknown",
    instrumentType: normalizeTradeInstrumentType(raw),
    instrumentSource,
    instrumentRuleId: instrumentSource === "official" ? String(raw?.instrumentRuleId || "") : "",
    side,
    tradeDate: toCompactDate(raw?.tradeDate || raw?.date),
    price: Number.isFinite(price) ? price : null,
    shares: Number.isInteger(shares) ? shares : null,
    dayTradeStatus: dayTrade.status,
    dayTradeMatchedShares: dayTrade.matchedShares,
    session: TRADE_SESSIONS.has(raw?.session) ? raw.session : "unknown",
    brokerAccountId: String(raw?.brokerAccountId || "default").trim().slice(0, 48) || "default",
    currency: "TWD",
  });
}

function canonicalizeTradeMoneyProvenance(input, existingPayload) {
  const source = input && typeof input === "object" ? input : {};
  const existingRecords = Array.isArray(existingPayload?.records) ? existingPayload.records : [];
  const existingById = new Map(existingRecords
    .map((record) => [String(record?.id || ""), record]));
  const records = Array.isArray(source.records)
    ? source.records.map((record) => (record && typeof record === "object" ? { ...record } : record))
    : [];

  const canonicalizeAmount = (record, existing, sameEconomics, {
    amountField, legacyField, sourceField, ruleField,
  }) => {
    const requestedSource = TRADE_MONEY_SOURCES.has(record[sourceField]) ? record[sourceField] : "";
    const supplied = readSuppliedTradeMoney(record, amountField, legacyField);

    // 只有明確宣告 manual／broker 且帶非負金額，才視為實際帳單值；rule id 仍由後端產生。
    if (requestedSource === "manual" || requestedSource === "broker") {
      if (supplied.valid) {
        record[amountField] = supplied.value;
        record[legacyField] = supplied.value;
      }
      delete record[ruleField];
      return;
    }

    const existingSource = TRADE_MONEY_SOURCES.has(existing?.[sourceField]) ? existing[sourceField] : "";
    const existingAmount = existing
      ? readSuppliedTradeMoney(existing, amountField, legacyField)
      : { valid: false };
    if (
      sameEconomics
      && (existingSource === "estimated" || existingSource === "legacy")
      && existingAmount.valid
    ) {
      record[amountField] = existingAmount.value;
      record[legacyField] = existingAmount.value;
      record[sourceField] = existingSource;
      if (String(existing[ruleField] || "")) record[ruleField] = String(existing[ruleField]).slice(0, 80);
      else delete record[ruleField];
      return;
    }

    // 新紀錄、經濟欄位有變更，或 client 嘗試偽造 estimated／legacy：清掉金額與來源，
    // 交給 normalizeTradeRecordV2 依當下伺服器規則重新估算。
    delete record[amountField];
    delete record[legacyField];
    delete record[sourceField];
    delete record[ruleField];
  };

  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (record.side === "dividend") {
      // 股利只有匯費、沒有證交稅，而且前端固定送 `fee: null`＝「未知，交給後端決定」——
      // normalizeTradeRecordV2 用 allowNull 特別尊重那個 null，把它 canonicalize 掉會讓
      // 已入帳股利的匯費從 null 變成預設 10，直接改到 dividendReceivedNet。
      // 所以這裡只堵真正的破口：client 宣稱 estimated／legacy（規格上由伺服器管理的來源）
      // 卻自帶金額，那是偽造，必須清掉並交回後端重算。現行前端從不帶 feeSource，
      // 因此這條規則對既有資料是 no-op。
      const claimedSource = String(record.feeSource || "");
      if (claimedSource === "estimated" || claimedSource === "legacy") {
        delete record.feeAmountTwd;
        delete record.fee;
        delete record.feeSource;
        delete record.feeRuleId;
      }
      continue;
    }
    const existing = existingById.get(String(record.id || ""));
    const sameEconomics = Boolean(existing)
      && tradeMoneyEstimateFingerprint(existing) === tradeMoneyEstimateFingerprint(record);
    canonicalizeAmount(record, existing, sameEconomics, {
      amountField: "feeAmountTwd",
      legacyField: "fee",
      sourceField: "feeSource",
      ruleField: "feeRuleId",
    });
    canonicalizeAmount(record, existing, sameEconomics, {
      amountField: "taxAmountTwd",
      legacyField: "tax",
      sourceField: "taxSource",
      ruleField: "taxRuleId",
    });
  }

  return { ...source, records };
}

// ===== 基本面（月營收／EPS／估值／除權息）=====
// 一律走官方 OpenAPI（欄名為 2026-07-02 實測真值，TWSE/TPEx 常不一致、還有官方拼錯的欄位）。
// 月營收與 EPS 端點「只回最新一期」→ 每抓到新的資料年月/年季就寫進
// .data/fundamentals-cache.json 累積歷史（技術頁長條圖用；冷啟動時歷史會從部署日開始長出來）。
const fundamentalsSourceCache = new Map(); // sourceKey → { expiresAt, value: Map }
const fundamentalsHistoryPath = join(dataDir, "fundamentals-cache.json");
let fundamentalsHistory = null;
let fundamentalsHistoryPromise = null;

// single-flight：月營收與 EPS 的 append 會在 Promise.all 裡「並發」第一次載入，
// 若各自惰性初始化，後完成的會把先完成那邊剛寫入的快照整個蓋掉。
function loadFundamentalsHistory() {
  fundamentalsHistoryPromise ||= (async () => {
    try {
      fundamentalsHistory = JSON.parse(await readFile(fundamentalsHistoryPath, "utf8")) || {};
    } catch {
      fundamentalsHistory = {};
    }
    fundamentalsHistory.revenue ||= {};
    fundamentalsHistory.eps ||= {};
    fundamentalsHistory.valuation ||= {};
    fundamentalsHistory.dividends ||= {};
    // 官方除權除息計算結果表（TWT49U）的歸檔：與「預告」分開存，
    // 免得事後結果的欄位被預告表的 withdrawn／formulaComplete 邏輯掃到。
    fundamentalsHistory.corporateActionResults ||= {};
    fundamentalsHistory.corporateActionResultMonths ||= {};
    return fundamentalsHistory;
  })();
  return fundamentalsHistoryPromise;
}
async function saveFundamentalsHistory() {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFileAtomic(fundamentalsHistoryPath, JSON.stringify(fundamentalsHistory));
    return true;
  } catch (error) {
    console.warn("[Stock1] fundamentals-cache.json 寫入失敗（營收/EPS/估值/除息歷史這輪沒存到）：", error.message);
    return false;
  }
}

// 民國 5 碼年月 "11505" → "2026-05"
function rocYearMonthToIso(value) {
  const m = String(value || "").trim().match(/^(\d{2,3})(\d{2})$/);
  if (!m) return "";
  return `${Number(m[1]) + 1911}-${m[2]}`;
}

// 各維度共用的 TTL 快取殼：抓失敗且無快取 → 回空 Map（呼叫端補 warning，不擋整頁）。
async function fetchFundamentalsSource(key, ttlMs, fetcher) {
  const cached = fundamentalsSourceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const value = await fetcher();
    if (value.size) {
      fundamentalsSourceCache.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    }
    return cached?.value || value;
  } catch {
    return cached?.value || new Map();
  }
}

// 月營收（TWSE t187ap05_L＋TPEx mopsfin_t187ap05_O，兩邊都是中文欄名且同名）。
// 注意：月初～約 10 日官方仍是「上上月」資料，UI 一律顯示實際資料年月、不要寫死「上月」。
async function getMonthlyRevenue() {
  return fetchFundamentalsSource("revenue", 6 * 3600e3, async () => {
    const map = new Map();
    const results = await Promise.allSettled([
      fetchJsonWithRetry("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", { headers: openapiHeaders }),
      fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", { headers: openapiHeaders }),
    ]);
    for (const result of results) {
      if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
      for (const row of result.value) {
        const code = cleanCode(row["公司代號"]);
        if (!/^\d{4}$/.test(code)) continue;
        const yearMonth = rocYearMonthToIso(row["資料年月"]);
        const revenue = parseNumber(row["營業收入-當月營收"]); // 千元
        if (!yearMonth || !Number.isFinite(revenue)) continue;
        map.set(code, {
          yearMonth,
          revenue,
          mom: parsePercentNumber(row["營業收入-上月比較增減(%)"]),
          yoy: parsePercentNumber(row["營業收入-去年同月增減(%)"]),
          cumYoy: parsePercentNumber(row["累計營業收入-前期比較增減(%)"]),
        });
      }
    }
    if (map.size) await appendFundamentalsHistory("revenue", map, (item) => item.yearMonth, 13);
    return map;
  });
}

// 季 EPS。TWSE 與 TPEx 欄名不同：`基本每股盈餘(元)`+`公司代號` vs `基本每股盈餘`+`SecuritiesCompanyCode`。
async function getQuarterlyEps() {
  return fetchFundamentalsSource("eps", 12 * 3600e3, async () => {
    const map = new Map();
    const [twse, tpex] = await Promise.allSettled([
      fetchJsonWithRetry("https://openapi.twse.com.tw/v1/opendata/t187ap14_L", { headers: openapiHeaders }),
      fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O", { headers: openapiHeaders }),
    ]);
    const ingest = (rows, codeField, epsField, yearField) => {
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        const code = cleanCode(row[codeField]);
        if (!/^\d{4}$/.test(code)) continue;
        const year = Number(String(row[yearField] || "").trim());
        const quarter = Number(String(row["季別"] || "").trim());
        const eps = parseNumber(row[epsField]);
        if (!year || !quarter || !Number.isFinite(eps)) continue;
        map.set(code, { period: `${year + 1911}Q${quarter}`, eps });
      }
    };
    if (twse.status === "fulfilled") ingest(twse.value, "公司代號", "基本每股盈餘(元)", "年度");
    if (tpex.status === "fulfilled") ingest(tpex.value, "SecuritiesCompanyCode", "基本每股盈餘", "Year");
    if (map.size) await appendFundamentalsHistory("eps", map, (item) => item.period, 9);
    return map;
  });
}

// 本益比／殖利率／股價淨值比（日更；虧損股 PE 官方給空值 → null）。TPEx 版多每股股利。
async function getValuations() {
  return fetchFundamentalsSource("valuation", 3600e3, async () => {
    const map = new Map();
    const [twse, tpex] = await Promise.allSettled([
      fetchJsonWithRetry("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", { headers: openapiHeaders }),
      fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis", { headers: openapiHeaders }),
    ]);
    if (twse.status === "fulfilled" && Array.isArray(twse.value)) {
      for (const row of twse.value) {
        const code = cleanCode(row.Code);
        if (!/^\d{4}$/.test(code)) continue;
        map.set(code, {
          pe: parseNumber(row.PEratio),
          dividendYield: parseNumber(row.DividendYield),
          pbr: parseNumber(row.PBratio),
          dps: null,
          asOf: toCompactDate(row.Date) || "",
        });
      }
    }
    if (tpex.status === "fulfilled" && Array.isArray(tpex.value)) {
      for (const row of tpex.value) {
        const code = cleanCode(row.SecuritiesCompanyCode);
        if (!/^\d{4}$/.test(code)) continue;
        map.set(code, {
          pe: parseNumber(row.PriceEarningRatio),
          dividendYield: parseNumber(row.YieldRatio),
          pbr: parseNumber(row.PriceBookRatio),
          dps: parseNumber(row.DividendPerShare),
          asOf: toCompactDate(row.Date) || "",
        });
      }
    }
    if (map.size) {
      await appendFundamentalsHistory(
        "valuation",
        map,
        (item) => item.asOf || toTaipeiCompactDate(),
        7,
      );
    }
    return map;
  });
}

// 未來除權息日程（TWSE TWT48U_ALL 滾動未來窗＋TPEx tpex_exright_prepost）。
// 兩市場各自 single-flight＋last-good：一邊故障不會把另一邊的半包結果凍結六小時。
const DIVIDEND_SCHEDULE_TTL_MS = 6 * 3600e3;
const DIVIDEND_SCHEDULE_DEGRADED_TTL_MS = 30 * 1000;
const DIVIDEND_SOURCES = {
  TWSE: { url: "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL", label: "上市" },
  TPEx: { url: "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost", label: "上櫃" },
};
const dividendMarketCache = {
  TWSE: { value: null, expiresAt: 0, inFlight: null, lastError: "", shapeWarnings: [] },
  TPEx: { value: null, expiresAt: 0, inFlight: null, lastError: "", shapeWarnings: [] },
};

function normalizeDividendKind(value) {
  const text = String(value || "").replace(/除/g, "").trim();
  if (text.includes("權") && text.includes("息")) return "除權息";
  if (text.includes("權")) return "除權";
  if (text.includes("息")) return "除息";
  return text ? `除${text}` : "";
}

// 單次無償配股率／現增比率大於 1（＝配股超過 100%）本來就極罕見。真正要防的不是罕見事件，
// 是**上游把單位從「比率」改成「每仟股股數」**：欄位名叫 Ratio，但同一份報表的網頁版是以
// 「每仟股無償配股（股）」呈現，兩者差 100 倍。若上游改版，referencePrice 的除數會從 1.1 變成 101，
// 整段 K 線塌陷，而且 formulaComplete 仍是 true、source 仍蓋著 official 章——不會有任何告警。
//
// 下游（plausibleShareFactor / officialCorporateActionRatio）已經會把 >1 當成「推導不出來」而
// 走未定案，所以災難分支已經擋住了。這裡補的是**告警**：讓它在資料進來的當下就喊出來，
// 而不是等使用者發現整條均線塌了才去讀 JSON。
//
// 2026-07-27 實測（TWSE 125 筆＋TPEx 138 筆預告）：29 筆真實配股全部落在 (0, 1)，最大 0.5；
// 並用官方計算結果表反推驗證 7 個案例，比率單位算出的參考價與交易所公布值誤差都 ≤ 0.01
// （7740 熙特爾：(157−2.05)/1.12782 = 137.39，官方 137.38）。單位確認是比率。
const DIVIDEND_RATIO_MAX_PLAUSIBLE = 1;
// 每檔除權息事件的歸檔上限。與官方計算結果表（corporateActionResults）的 40 對齊——
// 月配息 ETF 兩年就累積 24 筆，舊的 12 筆會把還原需要的資料吃掉。
const DIVIDEND_HISTORY_MAX_EVENTS_PER_CODE = 40;
function implausibleDividendRatioLabel(item) {
  const stockRatio = Number(item?.stockRatio);
  const subscriptionRatio = Number(item?.subscriptionRatio);
  if (Number.isFinite(stockRatio) && stockRatio > DIVIDEND_RATIO_MAX_PLAUSIBLE) return `無償配股率 ${stockRatio}`;
  if (Number.isFinite(subscriptionRatio) && subscriptionRatio > DIVIDEND_RATIO_MAX_PLAUSIBLE) return `現增比率 ${subscriptionRatio}`;
  return "";
}

function normalizeDividendMarketRows(source, rows, today = toTaipeiCompactDate(), warnings = []) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${DIVIDEND_SOURCES[source].label}除權息來源回傳空資料`);
  const archiveMap = new Map();
  const futureMap = new Map();
  const implausible = [];
  for (const row of rows) {
    const code = cleanCode(source === "TWSE" ? row.Code : row.SecuritiesCompanyCode);
    if (!/^\d{4}$/.test(code)) continue;
    const item = source === "TWSE" ? {
      exDate: toCompactDate(row.Date),
      kind: normalizeDividendKind(row.Exdividend),
      cashDividend: parseNumber(row.CashDividend),
      stockRatio: parseNumber(row.StockDividendRatio),
      subscriptionRatio: parseNumber(row.SubscriptionRatio),
      subscriptionPrice: parseNumber(row.SubscriptionPricePerShare),
      source,
    } : {
      exDate: toCompactDate(row.ExRrightsExDividendDate), // 官方欄名就拼錯 Rrights
      kind: normalizeDividendKind(row.ExRrightsExDividend),
      cashDividend: parseNumber(row.CashDividend),
      stockRatio: parseNumber(row.StockDividendRatio),
      subscriptionRatio: parseNumber(row.SubscriptionRatioToNewSharesIssued),
      subscriptionPrice: parseNumber(row.SubscriptionPricePerShare),
      source,
    };
    if (!item.exDate) continue;
    const implausibleLabel = implausibleDividendRatioLabel(item);
    if (implausibleLabel && implausible.length < 5) implausible.push(`${code} ${item.exDate} 的${implausibleLabel}`);
    const archiveList = archiveMap.get(code) || [];
    archiveList.push(item);
    archiveMap.set(code, archiveList);
    if (item.exDate >= today) {
      const futureList = futureMap.get(code) || [];
      futureList.push(item);
      futureMap.set(code, futureList);
    }
  }
  if (!archiveMap.size) throw new Error(`${DIVIDEND_SOURCES[source].label}除權息來源沒有有效股票代號`);
  // 同一代號同一除權息日的多列。appendDividendHistoryNow 寫的是 slot[exDate]，**後者覆蓋前者**，
  // 所以多列會靜默丟掉一半——若上游哪天把除權息拆成「除權一列＋除息一列」，
  // 參考價就只用半個事件算出來，而且蓋著 official 章、沒有任何告警。
  //
  // 2026-07-27 實測：TWSE 125 列＋TPEx 138 列，**(代號, 除權息日) 全部唯一、0 組重複**。
  // 也就是說這是防禦性偵測，不是已觀察到的錯誤——歸檔裡 revision ≥3 的 7 筆（最高 4）
  // 有更簡單的解釋：7 筆裡 5 筆是除權／除權息，配股條件本來就會分次定案。
  // 刻意**不合併**：合併公式要先確認上游真的怎麼拆，猜錯比不算更糟。
  const duplicates = [];
  for (const [code, list] of archiveMap) {
    const byDate = new Map();
    for (const item of list) byDate.set(item.exDate, (byDate.get(item.exDate) || 0) + 1);
    for (const [exDate, count] of byDate) {
      if (count <= 1) continue;
      for (const item of list) if (item.exDate === exDate) item.duplicateRows = true;
      if (duplicates.length < 5) duplicates.push(`${code} ${exDate}（${count} 列）`);
    }
  }
  if (duplicates.length) {
    warnings.push(
      `${DIVIDEND_SOURCES[source].label}除權息有同一代號同一天多列的情形（${duplicates.join("、")}）`
      + "，資料結構無法表達同日多事件；這些事件已標為未定案，不會用半個事件算出參考價。",
    );
  }
  // 不 throw：真的出現合法的 >100% 配股時，把整個市場的除權息資料丟掉會比算錯更糟。
  // 記 warning 讓它浮到畫面上，實際的比率仍由下游判成未定案。
  if (implausible.length) {
    warnings.push(
      `${DIVIDEND_SOURCES[source].label}除權息的配股／現增比率超過 100%（${implausible.join("、")}）`
      + "，可能是上游把單位從比率改成每仟股股數；這些事件的還原會標為未定案，請查官方原文。",
    );
  }
  for (const map of [archiveMap, futureMap]) {
    for (const list of map.values()) list.sort((a, b) => a.exDate.localeCompare(b.exDate));
  }
  return { archiveMap, futureMap };
}

async function loadDividendMarket(source) {
  const state = dividendMarketCache[source];
  const now = Date.now();
  if (state.value && state.expiresAt > now) return { status: "fresh", value: state.value, error: "" };
  if (state.inFlight) return state.inFlight;
  state.inFlight = (async () => {
    try {
      const rows = await fetchJsonWithRetry(DIVIDEND_SOURCES[source].url, { headers: openapiHeaders });
      const today = toTaipeiCompactDate();
      // 比率量級異常要浮到畫面上，不能只在下游默默判成未定案（見 implausibleDividendRatioLabel）。
      const shapeWarnings = [];
      const normalized = normalizeDividendMarketRows(source, rows, today, shapeWarnings);
      for (const warning of shapeWarnings) console.warn(`[Stock1] ${warning}`);
      state.shapeWarnings = shapeWarnings;
      // 成功 HTTP 不等於完整資料：若尚未到期的公告總數突然少掉四成以上，先視為上游半包。
      // 分母只算「以本次台北今日仍屬未來」的 last-good，已過除權息日的自然縮減不應被誤擋。
      const countUpcoming = (map) => [...(map?.values?.() || [])].reduce(
        (sum, list) => sum + (list || []).filter((item) => item?.exDate >= today).length,
        0,
      );
      assertReasonableSnapshotSize(
        `${DIVIDEND_SOURCES[source].label}除權息公告`,
        countUpcoming(normalized.futureMap),
        countUpcoming(state.value),
      );
      await appendDividendHistory(normalized.archiveMap, { successfulSources: [source] });
      state.value = normalized.futureMap;
      state.expiresAt = Date.now() + DIVIDEND_SCHEDULE_TTL_MS;
      state.lastError = "";
      return { status: "fresh", value: state.value, error: "" };
    } catch (error) {
      state.lastError = String(error?.message || error || "未知錯誤");
      return { status: state.value ? "stale" : "unavailable", value: state.value || new Map(), error: state.lastError };
    }
  })().finally(() => {
    state.inFlight = null;
  });
  return state.inFlight;
}

async function getDividendSchedule() {
  const [twse, tpex] = await Promise.all([loadDividendMarket("TWSE"), loadDividendMarket("TPEx")]);
  const combined = new Map();
  for (const result of [twse, tpex]) {
    for (const [code, list] of result.value) {
      const merged = [...(combined.get(code) || []), ...list]
        .sort((a, b) => a.exDate.localeCompare(b.exDate));
      combined.set(code, merged);
    }
  }
  combined.sourceStatus = { TWSE: twse.status, TPEx: tpex.status };
  // 比率量級異常（疑似上游把單位從比率改成每仟股股數）要跟著資料一起往上傳，
  // 否則它只會留在伺服器 console 裡，使用者看不到自己的均線為什麼塌了。
  combined.shapeWarnings = [
    ...(dividendMarketCache.TWSE.shapeWarnings || []),
    ...(dividendMarketCache.TPEx.shapeWarnings || []),
  ];
  const degraded = twse.status !== "fresh" || tpex.status !== "fresh";
  fundamentalsSourceCache.set("dividends", {
    expiresAt: Date.now() + (degraded ? DIVIDEND_SCHEDULE_DEGRADED_TTL_MS : DIVIDEND_SCHEDULE_TTL_MS),
    value: combined,
  });
  return combined;
}

// 除權息公告只存在「未來滾動窗」，除息日一過官方端點就查不到了 → 見一筆存一筆。
// 這是日後把還原權息從「>10.5% 跳空猜測」升級成「官方日期＋金額精確校正」的資料地基。
let dividendHistoryMutationQueue = Promise.resolve();
let dividendHistoryMutationPendingCount = 0;
function appendDividendHistory(map, options = {}) {
  dividendHistoryMutationPendingCount += 1;
  const operation = dividendHistoryMutationQueue.then(
    () => appendDividendHistoryNow(map, options),
    () => appendDividendHistoryNow(map, options),
  );
  dividendHistoryMutationQueue = operation
    .catch(() => {})
    .finally(() => {
      dividendHistoryMutationPendingCount = Math.max(0, dividendHistoryMutationPendingCount - 1);
    });
  return operation;
}

async function appendDividendHistoryNow(map, { successfulSources = [] } = {}) {
  const history = await loadFundamentalsHistory();
  history.dividends ||= {};
  let dirty = false;
  const observedAt = new Date().toISOString();
  const today = toTaipeiCompactDate();
  const seen = new Set();
  for (const [code, list] of map) {
    const slot = (history.dividends[code] ||= {});
    for (const item of list) {
      if (!item.exDate) continue;
      if (item.source) seen.add(`${item.source}:${code}:${item.exDate}`);
      const kind = String(item.kind || "");
      const hasFiniteField = (value) => value !== null && value !== undefined
        && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
      const hasSubscriptionRatio = hasFiniteField(item.subscriptionRatio);
      const subscriptionRatio = item.subscriptionRatio == null ? 0 : Number(item.subscriptionRatio);
      const formulaComplete = (
        // 同一代號同一除權息日出現多列時，下面的 slot[item.exDate] 是**後者覆蓋前者**，
        // 會靜默丟掉另外那一半（例如上游把除權息拆成「除權一列＋除息一列」），
        // 於是參考價只用半個事件算出來，卻蓋著 formulaComplete=true 與 official 章。
        // 目前實測 0 次（見 normalizeDividendMarketRows），但真的發生時是無聲的錯答案，
        // 所以一律當成算不出來——unresolved 優於算錯。合併公式等確認上游真的拆列再做。
        !item.duplicateRows
        && (!kind.includes("息") || hasFiniteField(item.cashDividend))
        && (!kind.includes("權") || hasFiniteField(item.stockRatio) || hasSubscriptionRatio)
        && Number.isFinite(subscriptionRatio)
        && subscriptionRatio >= 0
        && (subscriptionRatio === 0 || hasFiniteField(item.subscriptionPrice))
      );
      const next = {
        kind: item.kind,
        cashDividend: item.cashDividend,
        stockRatio: item.stockRatio,
        subscriptionRatio: item.subscriptionRatio,
        subscriptionPrice: item.subscriptionPrice,
        source: item.source || "",
        schemaVersion: 2,
        formulaComplete,
        status: "active",
      };
      const previous = slot[item.exDate];
      const changed = !previous || Object.entries(next).some(([key, value]) => previous[key] !== value);
      if (changed || previous?.lastSeenAt !== observedAt) {
        slot[item.exDate] = {
          ...next,
          observedAt: changed ? observedAt : previous.observedAt || observedAt,
          lastSeenAt: observedAt,
          revision: changed && previous ? Math.max(1, Number(previous.revision) || 1) + 1 : Math.max(1, Number(previous?.revision) || 1),
        };
        dirty = true;
      }
    }
    const keys = Object.keys(slot).sort();
    // 每檔保留幾筆事件。40 是與官方計算結果表（corporateActionResults，下方同名上限）
    // 對齊的數字，理由在那裡寫過：月配息 ETF 兩年就累積 24 筆，12 筆會把還原需要的資料吃掉。
    //
    // 這一份比結果表更不能省：**TWT48U_ALL 是滾動未來窗，除息日一過就查不到**
    // （見 DIVIDEND_SOURCES 的註解），被淘汰掉就是永久消失、沒有任何端點補得回來；
    // 而 TWT49U 只涵蓋上市，**上櫃的月配 ETF 只有這一份歸檔**。
    // 消費端（corporateActionHistoryForCode）要的窗是 13 個月到 5 年，12 筆遠遠不夠。
    //
    // 失效時完全沒有徵兆：corporateActionHistoryForCode 對「被淘汰掉」與「那天本來就沒事件」
    // 都回空陣列，unresolved 不會亮，補登提示（findMissingCorporateActions）也一起失效。
    while (keys.length > DIVIDEND_HISTORY_MAX_EVENTS_PER_CODE) {
      delete slot[keys.shift()];
      dirty = true;
    }
  }
  const sourceSet = new Set(successfulSources);
  if (sourceSet.size) {
    for (const [code, slot] of Object.entries(history.dividends)) {
      for (const [exDate, event] of Object.entries(slot || {})) {
        if (
          !sourceSet.has(event?.source)
          || event.status === "withdrawn"
          || exDate < today
          || seen.has(`${event.source}:${code}:${exDate}`)
        ) continue;
        slot[exDate] = {
          ...event,
          status: "withdrawn",
          withdrawnAt: observedAt,
          revision: Math.max(1, Number(event.revision) || 1) + 1,
        };
        dirty = true;
      }
    }
  }
  if (dirty) await saveFundamentalsHistory();
}

// 熱路徑（10 秒級的 getQuotes）用的非阻塞版：只讀快取，過期就背景刷新、先回舊值。
// 冷啟動第一輪拿不到旗標（回 null），6 小時內都是熱的——設計取捨，UI 不承諾「保證顯示」。
let dividendRefreshInFlight = null;
function peekDividendSchedule() {
  const cached = fundamentalsSourceCache.get("dividends");
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!dividendRefreshInFlight) {
    const task = getDividendSchedule().catch(() => null);
    dividendRefreshInFlight = trackBackgroundTask(task, "除權息背景更新");
    void dividendRefreshInFlight.finally(() => {
      if (dividendRefreshInFlight === task) dividendRefreshInFlight = null;
    });
  }
  return cached?.value || null; // stale-while-revalidate
}

// 把「只有最新一期」的官方資料累積成歷史（同期去重、每檔只留最近 keep 期）。
async function appendFundamentalsHistory(kind, map, periodOf, keep) {
  const history = await loadFundamentalsHistory();
  let dirty = false;
  const observedAt = new Date().toISOString();
  for (const [code, item] of map) {
    const slot = (history[kind][code] ||= {});
    const period = periodOf(item);
    if (!period) continue;
    const previous = slot[period];
    const changed = !previous || Object.entries(item).some(([key, value]) => previous[key] !== value);
    if (changed) {
      slot[period] = {
        ...item,
        observedAt,
        revision: previous ? Math.max(1, Number(previous.revision) || 1) + 1 : 1,
      };
      dirty = true;
    }
    const keys = Object.keys(slot).sort();
    while (keys.length > keep) {
      delete slot[keys.shift()];
      dirty = true;
    }
  }
  if (dirty) await saveFundamentalsHistory();
}

function fundamentalsHistoryList(kind, code) {
  const slot = fundamentalsHistory?.[kind]?.[code];
  if (!slot) return [];
  return Object.keys(slot).sort().map((period) => ({ period, ...slot[period] }));
}

function latestFundamentalsHistoryItem(kind, code) {
  const slot = fundamentalsHistory?.[kind]?.[code];
  if (!slot) return null;
  const period = Object.keys(slot).sort().at(-1);
  return period ? { period, ...slot[period] } : null;
}

function futureDividendHistory(code, today = toTaipeiCompactDate()) {
  const slot = fundamentalsHistory?.dividends?.[code];
  if (!slot) return [];
  return Object.keys(slot)
    .filter((exDate) => isValidCompactCalendarDate(exDate) && exDate >= today && slot[exDate]?.status !== "withdrawn")
    .sort()
    .map((exDate) => ({ exDate, ...slot[exDate] }));
}

function corporateActionHistoryForCode(code, fromDate = "", throughDate = "") {
  const slot = fundamentalsHistory?.dividends?.[cleanCode(code)];
  if (!slot) return [];
  const from = toCompactDate(fromDate);
  const through = toCompactDate(throughDate);
  return Object.keys(slot)
    .filter((exDate) => (
      isValidCompactCalendarDate(exDate)
      && slot[exDate]?.status !== "withdrawn"
      && (!from || exDate >= from)
      && (!through || exDate <= through)
    ))
    .sort()
    .map((exDate) => ({ exDate, ...slot[exDate] }));
}

// === 官方除權除息「計算結果表」（TWSE TWT49U）===
//
// 這是事後結果表，不是事前預告表，兩者的價值完全不同：
//   TWT48U_ALL（預告）：只有未來滾動窗，除息日一過就查不到，而且欄位會用 null 表達
//                      「沒有這件事」，得自己套公式還原參考價。
//   TWT49U（結果）  ：可依任意歷史日期區間查詢，直接給「除權息前收盤價」與「除權息參考價」。
//                      兩者相除就是精確的還原因子，不必套公式、不受欄位留空影響，
//                      而且是交易所自己套過升降單位的數字。ETF 的配息也涵蓋在內。
//
// 2026-07-26 實測（真實 API）：
//   - 任意歷史區間都查得到（試到 2024-03 仍有資料），單次六個月回 598 列。
//   - 逐月抓最穩，而且一次請求就涵蓋全市場所有代號，掃描 240 檔候選也只要同樣的月份數。
//   - 這條來源之所以重要：本機預告歸檔只從部署後才累積，實測連台積電（2026-06-11）、
//     鴻海（07-02）、中華電（07-09）的除息日都沒抓到，而它們的跳空（-0.22%／-3.63%／-4.30%）
//     全部遠低於 10.5% heuristic 門檻 → 目前這些股票的均線完全沒有還原。
const CORPORATE_ACTION_RESULT_URL = "https://www.twse.com.tw/rwd/zh/exRight/TWT49U";
const CORPORATE_ACTION_RESULT_CURRENT_TTL_MS = 6 * 3600e3;
const CORPORATE_ACTION_RESULT_MAX_MONTHS = 30; // 技術頁最長抓 24 個月，留一點餘裕
// 補齊範圍必須涵蓋「歷史真正可能退到多遠」，不是「正常情況抓幾個月」。
// 掃描、隔日沖、驗證推進三個入口都開了 allowExternalFallback + fallbackRange "1y"：
// 官方逐檔歷史被限流時整包會退成 Yahoo 的一年序列。只補 5~8 個月的話，第 9~13 個月的
// 除權息在同步的 corporateActionResultFor() 查不到、Yahoo 列又沒有 X 標記與交易所昨收、
// 跳空多半也低於 10.5% → **完全不還原**；而且那幾個月根本沒被請求過，degraded 仍是 false，
// 揭露機制會在最常見的降級情境下回報「一切正常」。
const CORPORATE_ACTION_RESULT_FALLBACK_MONTHS = 13; // Yahoo 備援上限 1y ＋ 1 個月邊界餘裕
const CORPORATE_ACTION_RESULT_RETRY_MS = 5 * 60e3;
// 併發只壓到 2。冷啟動總共也才 8~24 個請求、抓完就落盤永久有效，快個兩秒毫無意義；
// 但證交所會限流，實測併發 6 在掃描流程裡會整批失敗（8 個月全掛），
// 而失敗的代價是那些月份的除權息全部還原不到。穩定遠比快重要。
const CORPORATE_ACTION_RESULT_CONCURRENCY = 2;
const corporateActionResultInFlight = new Map();
// 失敗的月份短期內不再重試：冷啟動要補 24 個月，上游掛掉時若每次開頁都重打
// 就會變成「一次頁面載入打 24 次必失敗的請求」，把頁面拖到不能用。
const corporateActionResultFailures = new Map();

function normalizeCorporateActionResultRows(rows) {
  const byCode = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    // 欄位順序：資料日期 / 股票代號 / 股票名稱 / 除權息前收盤價 / 除權息參考價 / 權值+息值 / 權息 / …
    const exDate = toCompactDate(row?.[0]);
    const code = cleanCode(row?.[1]);
    const preClose = parsePositivePrice(row?.[3]);
    const referencePrice = parsePositivePrice(row?.[4]);
    if (!isValidCompactCalendarDate(exDate) || !SECURITY_CODE_PATTERN.test(code)) continue;
    // 兩個價格缺一就沒有比率可言；不要留半筆讓下游以為「官方確認過」。
    if (preClose === null || referencePrice === null) continue;
    const slot = byCode.get(code) || {};
    slot[exDate] = {
      preClose,
      referencePrice,
      value: parseNumber(row?.[5]),
      kind: normalizeDividendKind(row?.[6]),
    };
    byCode.set(code, slot);
  }
  return byCode;
}

// 往前推 n 個月的月初（只用來算「要補哪些月份」，不需要是實際交易日）。
function compactMonthsBefore(compactDate, months) {
  const compact = toCompactDate(compactDate) || toTaipeiCompactDate();
  let year = Number(compact.slice(0, 4));
  let month = Number(compact.slice(4, 6)) - months;
  while (month < 1) { month += 12; year -= 1; }
  return `${year}${String(month).padStart(2, "0")}01`;
}

function corporateActionResultMonthState(monthCompact) {
  return fundamentalsHistory?.corporateActionResultMonths?.[monthCompact] || null;
}

// 封月（該月結束之後才抓的）＝資料完整且永遠不會再變；未封月的只在 TTL 內算數。
function corporateActionResultMonthUsable(state) {
  if (state?.status !== "ok") return false;
  if (state.sealed) return true;
  return Date.parse(state.observedAt || 0) + CORPORATE_ACTION_RESULT_CURRENT_TTL_MS > Date.now();
}

// TWSE RWD 對「查無符合資料」回 HTTP 200、`stat` 是一句中文抱歉、而且**完全沒有 data 欄位**
// （2026-07-26 實測 20260901~20260931：`{"stat":"很抱歉，沒有符合條件的資料!"}`）。
// 舊寫法只看 `Array.isArray(payload.data)`，於是這種回應被寫成「抓成功、零筆除權息」，
// 配合上面的封月邏輯就是一個**永遠補不回來的空月**。
// 真的沒有事件的月份長什麼樣？實測 2010-02 到 2026-06 共 10 個抽樣月份（含 2011-02、
// 2012-02 這種只有 1 筆的淡月）**全部**是 `stat:"OK"` 且帶 data，找不到 stat 非 OK 的合法空月。
// 所以這裡把 stat 非 OK 一律當上游失敗：最壞情況是某個真空月每 5 分鐘重試一次並亮降級警告，
// 遠好過靜默把一整個月的除權息當成不存在。
function corporateActionResultPayloadRows(payload) {
  if (String(payload?.stat || "").trim().toUpperCase() !== "OK") return null;
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function loadCorporateActionResultMonth(monthCompact) {
  const month = String(monthCompact || "").slice(0, 6);
  if (!/^\d{6}$/.test(month)) return { status: "skipped", rows: 0 };
  await loadFundamentalsHistory();
  const state = corporateActionResultMonthState(month);
  // 「過去月份永遠不會再變」只對**該月結束之後才抓的那一份**成立。當月抓的必然是半成品
  // ——TWT49U 只公布到約 T+1（2026-07-26 查 202607，最後一列是 115年07月27日）。
  // 舊寫法用 `month < currentMonth` 判斷，於是「7 月 3 日抓的 7 月」一跨到 8 月就被鎖成
  // 永久真相，7 月 4 日之後的除權息再也補不回來。改成看抓取當下是不是已經跨月（sealed）。
  // 既有歸檔沒有 sealed 欄位 → 一律當未封月重抓一次，正好把舊資料裡的半成品洗掉。
  if (corporateActionResultMonthUsable(state)) {
    return { status: "cached", rows: state.rows || 0 };
  }
  const failedAt = corporateActionResultFailures.get(month);
  if (failedAt && failedAt + CORPORATE_ACTION_RESULT_RETRY_MS > Date.now()) {
    return { status: "unavailable", rows: 0, error: "上游近期失敗，暫不重試" };
  }
  if (corporateActionResultInFlight.has(month)) return corporateActionResultInFlight.get(month);

  const task = (async () => {
    const start = `${month}01`;
    const end = `${month}31`;
    try {
      // 刻意不重試（fetchJsonWithRetry 的退避是 900ms）。這條來源是「讓還原更精確」的增益，
      // 而且抓成功的過去月份會永久落盤、失敗的月份 5 分鐘後自然會再試。
      // 在這裡重試等於讓上游一掛掉，每次驗證推進與掃描都先空睡好幾秒——
      // 補齊 5 個月 × 900ms 就讓 swing-verify 整合測試在滿載時超時（2026-07-27 實際踩到）。
      const payload = await fetchJson(
        `${CORPORATE_ACTION_RESULT_URL}?startDate=${start}&endDate=${end}&response=json`,
        { headers: { "user-agent": "Mozilla/5.0" } },
      );
      const rows = corporateActionResultPayloadRows(payload);
      if (rows === null) throw new Error(`上游回 stat=${String(payload?.stat || "").slice(0, 40)}`);
      const byCode = normalizeCorporateActionResultRows(rows);
      const history = await loadFundamentalsHistory();
      history.corporateActionResults ||= {};
      history.corporateActionResultMonths ||= {};
      for (const [code, slot] of byCode) {
        const target = (history.corporateActionResults[code] ||= {});
        for (const [exDate, item] of Object.entries(slot)) target[exDate] = item;
        // 每檔只留最近 40 筆：月配息 ETF 兩年就會累積 24 筆，12 筆的舊上限會把還原需要的資料吃掉。
        const keys = Object.keys(target).sort();
        while (keys.length > 40) delete target[keys.shift()];
      }
      history.corporateActionResultMonths[month] = {
        status: "ok",
        rows: rows.length,
        codes: byCode.size,
        observedAt: new Date().toISOString(),
        // 抓取當下已經跨月＝這份資料是完整的、之後不會再變。
        sealed: month < toTaipeiCompactDate().slice(0, 6),
      };
      await saveFundamentalsHistory();
      corporateActionResultFailures.delete(month);
      return { status: "fresh", rows: rows.length };
    } catch (error) {
      // 抓不到就沿用既有歸檔：這條來源是「讓還原更精確」的增益，不該讓整頁失敗。
      corporateActionResultFailures.set(month, Date.now());
      return { status: "unavailable", rows: 0, error: String(error?.message || error || "未知錯誤") };
    }
  })().finally(() => corporateActionResultInFlight.delete(month));
  corporateActionResultInFlight.set(month, task);
  return task;
}

// 把 [fromDate, throughDate] 涵蓋的月份補齊。呼叫端必須 await 過這個之後，
// 才能用同步的 corporateActionResultFor() 查表。
async function ensureCorporateActionResults(fromDate, throughDate) {
  const from = toCompactDate(fromDate);
  const through = toCompactDate(throughDate) || toTaipeiCompactDate();
  if (!from) return { months: 0, degraded: false };
  const months = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(4, 6));
  const endYear = Number(through.slice(0, 4));
  const endMonth = Number(through.slice(4, 6));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    if (months.length > CORPORATE_ACTION_RESULT_MAX_MONTHS * 4) break; // 參數壞掉時的煞車
  }
  // 上限要從**新的那一端**留。舊寫法在迴圈條件裡就停，砍掉的是離今天最近的月份
  // ——那正是還原權息最需要的一段，而且被砍掉的月份根本沒進 results，degraded 還是 false。
  const truncated = Math.max(0, months.length - CORPORATE_ACTION_RESULT_MAX_MONTHS);
  const wanted = truncated ? months.slice(-CORPORATE_ACTION_RESULT_MAX_MONTHS) : months;
  // 一次請求就涵蓋全市場所有代號，所以月份數就是請求數。冷啟動要補 24 個月，
  // 序列化會讓第一次開頁等太久，並行度壓在 6 是「別把官方端點打爆」與「別卡住使用者」的折衷。
  // 抓過的過去月份會落盤，之後每個月只會多一次請求。
  const results = await mapLimit(wanted, CORPORATE_ACTION_RESULT_CONCURRENCY, (item) => loadCorporateActionResultMonth(item));
  // 被上限砍掉的月份等同「沒抓到」，一樣要算降級——否則揭露機制會在最需要它的時候說「一切正常」。
  const degraded = truncated > 0 || results.some((result) => result?.status === "unavailable");
  return { months: wanted.length, degraded, truncated };
}

// 「這個月真的抓成功過」才算查得過。這道區分很重要：
// 上市逐檔歷史的 X 標記說「這天有事件」，但比率要另外查計算結果表。若上游暫時掛掉，
// 那是「沒查到」而不是「查了發現資料不完整」——把它當成 unresolved 會直接把一批大型股
// 踢出候選池（2026-07-26 實測：整批抓取失敗時有 39 檔被誤剔，含聯電、緯創、台塑化、台化）。
// 抓不到時維持舊行為（歸檔公式／跳空估算）並靠 warnings 揭露，不要因為上游打嗝就砍覆蓋率。
function corporateActionResultMonthCovered(dateCompact) {
  const month = String(toCompactDate(dateCompact) || "").slice(0, 6);
  if (!/^\d{6}$/.test(month)) return false;
  // 用與快取同一條「可用」判準：封月的永遠算數；當月抓的那一份只到 T+1，過期就不能再宣稱
  // 「查得過」——否則月底那幾天的除權息會被當成「查了但拿不到比率」而誤標未定案。
  return corporateActionResultMonthUsable(corporateActionResultMonthState(month));
}

function corporateActionResultFor(code, exDate) {
  const slot = fundamentalsHistory?.corporateActionResults?.[cleanCode(code)];
  const item = slot?.[toCompactDate(exDate)];
  if (!item) return null;
  const preClose = Number(item.preClose);
  const referencePrice = Number(item.referencePrice);
  if (!Number.isFinite(preClose) || preClose <= 0) return null;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  return { ...item, preClose, referencePrice };
}

// 交易所自己算的還原因子：參考價 ÷ 除權息前收盤價。
// 比自己套公式可靠——它已經套過升降單位，也不需要現金／配股／現增四個欄位都齊備。
function corporateActionResultRatio(code, exDate) {
  const item = corporateActionResultFor(code, exDate);
  if (!item) return null;
  const ratio = item.referencePrice / item.preClose;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

async function buildFundamentals(codeRaw) {
  const code = cleanCode(codeRaw);
  const warnings = [];
  const [revenueMap, epsMap, valuationMap, dividendMap, companyDirectory] = await Promise.all([
    getMonthlyRevenue(),
    getQuarterlyEps(),
    getValuations(),
    getDividendSchedule(),
    getCompanyDirectory(),
  ]);
  await loadFundamentalsHistory();
  warnings.push(...(companyDirectory.warnings || []));
  const metaMap = companyDirectory.companyMeta;
  const meta = metaMap.get(code) || {};
  const liveRevenue = revenueMap.get(code) || null;
  const liveEps = epsMap.get(code) || null;
  const liveValuation = valuationMap.get(code) || null;
  const liveDividends = dividendMap.get(code) || null;
  const storedRevenue = liveRevenue ? null : latestFundamentalsHistoryItem("revenue", code);
  const storedEps = liveEps ? null : latestFundamentalsHistoryItem("eps", code);
  const storedValuation = liveValuation ? null : latestFundamentalsHistoryItem("valuation", code);
  const storedDividends = liveDividends ? [] : futureDividendHistory(code);
  const dividendSourceStatus = dividendMap.sourceStatus || {};
  const dividendSource = liveDividends?.find((item) => item?.source)?.source
    || storedDividends.find((item) => item?.source)?.source
    || companyDirectory.marketByCode?.get(code)
    || "";
  const dividendMarketStatus = dividendSource
    ? dividendSourceStatus[dividendSource] || (liveDividends ? "fresh" : "unavailable")
    : "";
  const dividendFreshnessStatus = dividendSource
    ? dividendMarketStatus === "fresh" ? "fresh" : dividendMarketStatus === "stale" || storedDividends.length ? "stale" : "unavailable"
    : Object.keys(dividendSourceStatus).length && Object.values(dividendSourceStatus).every((status) => status === "fresh")
      ? "fresh"
      : storedDividends.length ? "stale" : "unavailable";
  const revenue = liveRevenue || storedRevenue;
  const eps = liveEps || storedEps;
  const valuation = liveValuation || storedValuation;
  const dividends = liveDividends || storedDividends;
  if (!liveRevenue && storedRevenue) warnings.unshift(`月營收來源暫時抓不到，已沿用本機最後保存的 ${storedRevenue.yearMonth || storedRevenue.period} 資料。`);
  if (!liveEps && storedEps) warnings.unshift(`EPS 來源暫時抓不到，已沿用本機最後保存的 ${storedEps.period} 資料。`);
  if (!liveValuation && storedValuation) warnings.unshift(`本益比／殖利率來源暫時抓不到，已沿用本機最後保存的 ${compactToSlashDate(storedValuation.asOf || storedValuation.period)} 資料。`);
  // 比率量級異常是「資料可能整批算錯」等級的事，優先於各來源的新鮮度警告。
  for (const warning of dividendMap.shapeWarnings || []) warnings.unshift(warning);
  const dividendSourcesToWarn = dividendSource
    ? [dividendSource]
    : Object.keys(DIVIDEND_SOURCES).filter((source) => dividendSourceStatus[source] !== "fresh");
  for (const source of dividendSourcesToWarn) {
    const status = dividendSourceStatus[source] || "unavailable";
    const label = DIVIDEND_SOURCES[source]?.label || source;
    if (status === "stale") {
      warnings.unshift(`${label}除權息公告暫時更新失敗，已沿用最近一次成功抓取的資料。`);
    } else if (status === "unavailable") {
      const hasStoredSource = storedDividends.some((item) => !item?.source || item.source === source);
      warnings.unshift(hasStoredSource
        ? `${label}除權息公告暫時抓不到，已沿用本機最後保存的未來公告。`
        : `${label}除權息公告抓取失敗，目前無法確認是否有未來公告，稍後會自動重試。`);
    }
  }
  if (!revenue && !revenueMap.size) warnings.push("月營收來源暫時抓不到，稍後會自動重試。");
  if (!eps && !epsMap.size) warnings.push("EPS 來源暫時抓不到，稍後會自動重試。");
  if (!valuation && !valuationMap.size) warnings.push("本益比／殖利率來源暫時抓不到，稍後會自動重試。");
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    code,
    shortName: meta.shortName || "",
    industry: meta.industry || "",
    revenue: revenue ? { latest: revenue, history: fundamentalsHistoryList("revenue", code), stale: !liveRevenue } : null,
    eps: eps ? { latest: eps, history: fundamentalsHistoryList("eps", code), stale: !liveEps } : null,
    valuation: valuation ? { ...valuation, stale: !liveValuation } : null,
    dividends,
    freshness: {
      revenue: { status: liveRevenue ? "fresh" : storedRevenue ? "stale" : "unavailable", asOf: revenue?.yearMonth || revenue?.period || null },
      eps: { status: liveEps ? "fresh" : storedEps ? "stale" : "unavailable", asOf: eps?.period || null },
      valuation: { status: liveValuation ? "fresh" : storedValuation ? "stale" : "unavailable", asOf: valuation?.asOf || valuation?.period || null },
      dividends: { status: dividendFreshnessStatus, asOf: dividends[0]?.exDate || null },
    },
    warnings: unique(warnings),
  };
}

const REFERENCE_SOURCES = {
  twse: {
    label: "上市",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    normalize: normalizeDailyTwse,
  },
  tpex: {
    label: "上櫃",
    url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    normalize: normalizeDailyTpex,
  },
};

function parseReferenceSnapshot(marketKey, rows, previous) {
  const source = REFERENCE_SOURCES[marketKey];
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${source.label}整批收盤回傳空資料`);
  const byCode = new Map();
  for (const row of rows) {
    // 除權息日的漲跌欄是可解析的 "0.0000"，要用官方參考價校正基準（見 applyCorporateActionQuoteBaseline）。
    const quote = applyCorporateActionQuoteBaseline(source.normalize(row));
    if (quote.code && Number.isFinite(quote.price)) byCode.set(quote.code, quote);
  }
  if (!byCode.size) throw new Error(`${source.label}整批收盤沒有有效代號與價格`);
  assertReasonableSnapshotSize(source.label, byCode.size, previous?.validCount || 0);
  return {
    byCode,
    count: rows.length,
    validCount: byCode.size,
    asOf: resolveMarketCloseDate({ byCode }) || "",
    fetchedAt: new Date().toISOString(),
  };
}

async function loadReferenceMarket(marketKey) {
  const source = REFERENCE_SOURCES[marketKey];
  return loadWithLastGood(referenceMarketCache[marketKey], {
    ttlMs: REFERENCE_TTL_MS,
    retryMs: REFERENCE_RETRY_MS,
    load: async (previous) => parseReferenceSnapshot(marketKey, await fetchJson(source.url), previous),
  });
}

// 上市／上櫃各自 single-flight＋last-good。單一市場失敗時回部分成功與明確 warning；
// 只有兩市場都冷失敗才硬失敗。日期未對齊也視為 provisional，短 TTL 重試落後市場。
async function getReferenceData() {
  const now = Date.now();
  if (referenceCache.value && referenceCache.expiresAt > now) return referenceCache.value;
  if (referenceInFlight) return referenceInFlight;
  referenceInFlight = (async () => {
    const [twse, tpex] = await Promise.all([
      loadReferenceMarket("twse"),
      loadReferenceMarket("tpex"),
    ]);
    const results = { twse, tpex };
    const byCode = new Map();
    const warnings = [];
    const markets = {};
    for (const marketKey of ["twse", "tpex"]) {
      const result = results[marketKey];
      const source = REFERENCE_SOURCES[marketKey];
      if (result.value) {
        for (const [code, quote] of result.value.byCode) byCode.set(code, quote);
      }
      markets[marketKey] = {
        available: Boolean(result.value),
        stale: result.status === "stale",
        status: result.status,
        count: result.value?.count || 0,
        validCount: result.value?.validCount || 0,
        asOf: result.value?.asOf ? compactToIsoDate(result.value.asOf) : null,
        fetchedAt: result.value?.fetchedAt || null,
      };
      if (result.status === "stale") {
        const asOf = result.value?.asOf ? compactToSlashDate(result.value.asOf) : "日期不明";
        warnings.push(`${source.label}整批收盤暫時抓取失敗（${result.error}），已沿用 ${asOf} 的最近成功資料。`);
      } else if (result.status === "unavailable") {
        warnings.push(`${source.label}整批收盤抓取失敗（${result.error}），目前結果暫時不含${source.label}市場。`);
      }
    }
    if (!byCode.size) {
      const errors = [twse.error, tpex.error].filter(Boolean).join("；");
      throw new Error(`上市與上櫃整批收盤皆無法取得${errors ? `：${errors}` : ""}`);
    }

    const twseDate = twse.value?.asOf || "";
    const tpexDate = tpex.value?.asOf || "";
    const datesKnown = Boolean(twseDate && tpexDate);
    const datesAligned = datesKnown && twseDate === tpexDate;
    if (twse.value && tpex.value && !datesKnown) {
      warnings.push("上市與上櫃整批收盤資料缺少可驗證的資料日，目前結果視為暫時資料。");
    } else if (twse.value && tpex.value && !datesAligned) {
      warnings.push(`上市與上櫃整批收盤資料日尚未對齊（上市 ${compactToSlashDate(twseDate)}、上櫃 ${compactToSlashDate(tpexDate)}），稍後會自動補齊。`);
      const laggingKey = twseDate < tpexDate ? "twse" : "tpex";
      referenceMarketCache[laggingKey].expiresAt = Math.min(
        referenceMarketCache[laggingKey].expiresAt,
        Date.now() + REFERENCE_RETRY_MS,
      );
    }
    const coverageComplete = Boolean(
      twse.value && tpex.value &&
      twse.status === "fresh" && tpex.status === "fresh" &&
      datesAligned
    );
    const degraded = !coverageComplete;
    const finishedAt = Date.now();
    const fullExpiry = Math.min(
      referenceMarketCache.twse.expiresAt || finishedAt + REFERENCE_TTL_MS,
      referenceMarketCache.tpex.expiresAt || finishedAt + REFERENCE_TTL_MS,
    );
    const value = {
      byCode,
      counts: {
        twse: twse.value?.count || 0,
        tpex: tpex.value?.count || 0,
      },
      warnings: unique(warnings),
      degraded,
      coverageComplete,
      markets,
    };
    referenceCache = {
      expiresAt: degraded ? finishedAt + REFERENCE_RETRY_MS : fullExpiry,
      value,
    };
    return value;
  })().finally(() => {
    referenceInFlight = null;
  });
  return referenceInFlight;
}

// 兩個市場的「漲跌價差」欄在除權息日語意完全不同（2026-07-26 用真實 API 實測 60 檔）：
//   TWSE：整欄被遮成 "X0.00"（X＝除權息，不計算漲跌）→ parseNumber 回 null。實測 28/28 檔皆然，
//         非事件日一律是 "+0.30"／"-1.45" 這種正常數字。所以「close 有值但 change 解析不出來」
//         在上市逐檔歷史裡就是交易所給的除權息日標記，涵蓋全部歷史（本機預告歸檔只從部署後累積）。
//         實測 1140 列裡漏報 0 檔，還額外抓到台積電／鴻海／中華電等歸檔完全沒有的事件。
//         但它只說「有事件」，不說比率——比率要另外查 TWT49U 計算結果表。
//   TPEx：沒有任何標記，change 是相對除權息參考價算的正常數字 → close − change 就是官方參考價
//         （實測 24/32 完全吻合，另 7 檔差在交易所把參考價套了升降單位）。
// addPreviousClose 會把 previousClose 改寫成「前一列的收盤」，等於銷毀上面兩種官方資訊，
// 所以另外保留一份 exchangePreviousClose，它永遠不被覆寫。
function normalizeTwseHistoryRow(row, code, name) {
  const close = parseNumber(row[6]);
  const change = parseNumber(row[7]);
  const previousClose = close !== null && change !== null ? close - change : null;
  return {
    date: formatDate(row[0]),
    rawDate: row[0],
    code,
    name,
    exchange: "TWSE",
    open: parseNumber(row[3]),
    high: parseNumber(row[4]),
    low: parseNumber(row[5]),
    close,
    previousClose,
    exchangePreviousClose: previousClose,
    // 有收盤價卻沒有漲跌價差＝官方的除權息日標記（上市限定）。
    exchangeCorporateActionMark: close !== null && change === null,
    change,
    volumeShares: parseNumber(row[1]),
    volumeLots: Math.round((parseNumber(row[1]) || 0) / 1000),
    tradeValue: parseNumber(row[2]),
    transactions: parseNumber(row[8]),
    source: "TWSE STOCK_DAY",
  };
}

function normalizeTpexHistoryRow(row, code, name) {
  const close = parseNumber(row[6]);
  const change = parseNumber(row[7]);
  const previousClose = close !== null && change !== null ? close - change : null;
  const volumeLots = parseNumber(row[1]);
  return {
    date: formatDate(row[0]),
    rawDate: row[0],
    code,
    name,
    exchange: "TPEx",
    open: parseNumber(row[3]),
    high: parseNumber(row[4]),
    low: parseNumber(row[5]),
    close,
    previousClose,
    // 上櫃沒有 X 標記，但 change 是相對參考價算的，所以這個值在除權息日就是官方參考價。
    exchangePreviousClose: previousClose,
    exchangeCorporateActionMark: false,
    change,
    volumeShares: volumeLots !== null ? volumeLots * 1000 : null,
    volumeLots,
    tradeValue: (parseNumber(row[2]) || 0) * 1000,
    transactions: parseNumber(row[8]),
    source: "TPEx tradingStock",
  };
}

async function fetchStockHistoryMonth(code, exchange, monthCompact, name = "") {
  const cacheKey = `${exchange}:${code}:${monthCompact}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    historyCache.delete(cacheKey);
    historyCache.set(cacheKey, cached);
    return cached.value;
  }
  if (historyInFlight.has(cacheKey)) return historyInFlight.get(cacheKey);

  const task = (async () => {
    let rows = [];
    if (exchange === "TPEx") {
      const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(code)}&date=${compactToSlashDate(monthCompact)}&id=&response=json`;
      const payload = await fetchJsonWithRetry(url, {}, 1);
      const table = Array.isArray(payload.tables) ? payload.tables[0] : null;
      rows = Array.isArray(table?.data) ? table.data.map((row) => normalizeTpexHistoryRow(row, code, payload.name || name)) : [];
    } else {
      const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?date=${monthCompact}&stockNo=${encodeURIComponent(code)}&response=json`;
      const payload = await fetchJsonWithRetry(url, {}, 1);
      rows = Array.isArray(payload.data) ? payload.data.map((row) => normalizeTwseHistoryRow(row, code, name)) : [];
    }

    // 當月資料收盤後會新增今天的 K 棒，快取縮短；過去月份不會再變，可以放久一點。
    const now = Date.now();
    const isCurrentMonth = String(monthCompact).slice(0, 6) === toTaipeiCompactDate().slice(0, 6);
    for (const [key, entry] of historyCache) if (!entry || entry.expiresAt <= now) historyCache.delete(key);
    historyCache.delete(cacheKey);
    historyCache.set(cacheKey, {
      expiresAt: now + (isCurrentMonth ? 5 : 30) * 60 * 1000,
      value: rows,
    });
    while (historyCache.size > 4096) historyCache.delete(historyCache.keys().next().value);
    return rows;
  })().finally(() => historyInFlight.delete(cacheKey));
  historyInFlight.set(cacheKey, task);
  return task;
}

// Yahoo 自己回報的分割事件。這是「Yahoo 到底對這檔做了什麼調整」的權威來源——
// 它的 indicators.quote 已經把台股配股當成分割還原過（實測 6944 回 1300:1000＝配股 30%），
// 而我們要把官方座標系的還原因子換算到 Yahoo 座標系時，需要的正是「Yahoo 實際套了多少」，
// 不是「真實的配股率」。用它比用本機歸檔的公告更準，也不需要歸檔剛好有那一筆。
// 2026-07-27 實測：split 時間戳換算成台北日期正好等於除權息日；純現金個股（2002 中鋼）
// 有 events 區塊但沒有 splits 鍵 → 代表「Yahoo 確認沒有做分割調整」，倍數應視為 1。
function parseYahooSplitFactors(result) {
  const events = result?.events;
  if (!events) return null; // 整個 events 區塊都沒回 → 不能斷言 Yahoo 沒調整
  const byDate = new Map();
  for (const split of Object.values(events.splits || {})) {
    const compact = toCompactDate(new Date(Number(split?.date) * 1000));
    const numerator = parseNumber(split?.numerator);
    const denominator = parseNumber(split?.denominator);
    if (!isValidCompactCalendarDate(compact)) continue;
    if (!Number.isFinite(numerator) || numerator <= 0) continue;
    if (!Number.isFinite(denominator) || denominator <= 0) continue;
    byDate.set(compact, numerator / denominator);
  }
  return byDate;
}

function normalizeYahooHistoryRows(payload, quote, maxDateCompact) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quoteBlock = result?.indicators?.quote?.[0] || {};
  const splitFactors = parseYahooSplitFactors(result);
  const rows = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const date = new Date(Number(timestamps[index]) * 1000);
    const compact = toCompactDate(date);
    if (maxDateCompact && compact > maxDateCompact) continue;
    const open = parseNumber(quoteBlock.open?.[index]);
    const high = parseNumber(quoteBlock.high?.[index]);
    const low = parseNumber(quoteBlock.low?.[index]);
    const close = parseNumber(quoteBlock.close?.[index]);
    const volumeShares = parseNumber(quoteBlock.volume?.[index]);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    rows.push({
      date: compactToSlashDate(compact),
      rawDate: compact,
      code: quote.code,
      name: quote.name,
      exchange: quote.exchange,
      open,
      high,
      low,
      close,
      previousClose: null,
      // Yahoo 沒有「交易所昨收」這個概念，而且它的原始 OHLC 已經自己把配股當分割還原過
      // （2026-07-26 實測），語意跟官方逐檔歷史不同，不可混用。
      exchangePreviousClose: null,
      exchangeCorporateActionMark: false,
      // Yahoo 對這一天實際套用的分割倍數。有 events 區塊卻沒列這天＝Yahoo 沒調整（倍數 1）；
      // 整個 events 區塊都沒回才是 null（未知），此時不可假設它沒調整。
      yahooSplitFactor: splitFactors ? (splitFactors.get(compact) ?? 1) : null,
      change: null,
      volumeShares,
      volumeLots: volumeShares !== null ? Math.round(volumeShares / 1000) : null,
      tradeValue: null,
      transactions: null,
      source: "Yahoo Finance chart fallback",
    });
  }
  rows.sort((a, b) => toCompactDate(a.date).localeCompare(toCompactDate(b.date)));
  for (let index = 0; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    rows[index].previousClose = previous?.close ?? null;
    rows[index].change = previous ? rows[index].close - previous.close : null;
  }
  return rows;
}

async function fetchYahooHistory(quote, dateCompact, range = "2y") {
  const suffix = quote.exchange === "TPEx" ? "TWO" : "TW";
  const symbol = `${quote.code}.${suffix}`;
  // events=div|split：要 Yahoo 一併回報它自己認定的分割與配息事件。分割倍數是把官方還原因子
  // 換算到 Yahoo 座標系的必要輸入（見 parseYahooSplitFactors），少了它，有配股又不在本機
  // 歸檔裡的股票會整檔被判 unresolved 而從板子上消失。
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d&events=div%7Csplit`;
  const payload = await fetchJson(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });
  const rows = normalizeYahooHistoryRows(payload, quote, dateCompact);
  if (!rows.length) throw new Error(`Yahoo history payload is empty for ${symbol}`);
  return rows;
}

// Yahoo 即時報價（meta.regularMarketPrice）：官方 MIS 對部分股票會回 z="-"（無最新成交價），
// 這時用 Yahoo 的即時價補上，盤中才看得到真實現價而不是退回昨收。30 秒快取避免頻繁輪詢狂打 Yahoo。
const yahooQuoteCache = new Map();
const yahooQuoteInFlight = new Map();
const YAHOO_QUOTE_CACHE_MAX = 256;
function pruneYahooQuoteCache(now = Date.now()) {
  for (const [key, entry] of yahooQuoteCache) {
    if (!entry || entry.expiresAt <= now) yahooQuoteCache.delete(key);
  }
  while (yahooQuoteCache.size >= YAHOO_QUOTE_CACHE_MAX) {
    yahooQuoteCache.delete(yahooQuoteCache.keys().next().value);
  }
}
async function fetchYahooQuoteForSuffix(code, suffix) {
  const cacheKey = `${code}:${suffix}`;
  const cached = yahooQuoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (yahooQuoteInFlight.has(cacheKey)) return yahooQuoteInFlight.get(cacheKey);
  const task = (async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}.${suffix}?range=1d&interval=1d`;
    let value = null;
    try {
      const payload = await fetchJson(url, { headers: { "user-agent": "Mozilla/5.0" } });
      const meta = payload?.chart?.result?.[0]?.meta;
      const price = parsePositivePrice(meta?.regularMarketPrice);
      if (meta && price !== null) {
        const marketTime = Number(meta.regularMarketTime);
        const marketDate = Number.isFinite(marketTime) && marketTime > 0
          ? toTaipeiCompactDate(new Date(marketTime * 1000))
          : "";
        value = {
          price,
          previousClose: parsePositivePrice(meta.chartPreviousClose ?? meta.previousClose),
          open: parsePositivePrice(meta.regularMarketOpen),
          high: parsePositivePrice(meta.regularMarketDayHigh),
          low: parsePositivePrice(meta.regularMarketDayLow),
          marketState: meta.marketState || "",
          rawDate: marketDate,
          asOf: marketDate
            ? `${compactToSlashDate(marketDate)} ${toTaipeiTime(marketTime * 1000)}`
            : "",
        };
      }
    } catch {
      value = null;
    }
    pruneYahooQuoteCache();
    yahooQuoteCache.delete(cacheKey);
    yahooQuoteCache.set(cacheKey, { value, expiresAt: Date.now() + 30 * 1000 });
    return value;
  })().finally(() => {
    yahooQuoteInFlight.delete(cacheKey);
  });
  yahooQuoteInFlight.set(cacheKey, task);
  return task;
}

async function fetchYahooQuote(code, exchange) {
  const suffixes = exchange === "TPEx" ? ["TWO"] : exchange === "TWSE" ? ["TW"] : ["TW", "TWO"];
  for (const suffix of suffixes) {
    const value = await fetchYahooQuoteForSuffix(code, suffix);
    if (value) return value;
  }
  return null;
}

async function getStockHistory(quote, dateCompact, monthsBack = 3, options = {}) {
  const months = [];
  for (let offset = 0; offset > -monthsBack; offset -= 1) {
    months.push(addMonthsCompact(dateCompact, offset));
  }
  const monthRows = await Promise.all(
    months.map((month) => fetchStockHistoryMonth(quote.code, quote.exchange, month, quote.name).catch(() => []))
  );
  const rows = monthRows
    .flat()
    .filter((row) => row.close !== null && row.open !== null && toCompactDate(row.date) <= dateCompact)
    .sort((a, b) => toCompactDate(a.date).localeCompare(toCompactDate(b.date)));
  // 新鮮度檢查：官方「逐檔月歷史」的當月資料偶爾比 STOCK_DAY_ALL（整體收盤）晚更新，或在大量並發抓取時
  // 被證交所限流而失敗（fetchStockHistoryMonth 失敗會被上層 .catch 吞成空陣列）。這時 rows 雖有上百筆、
  // 最新一筆卻停在數週前——只看筆數會放行這種「過期但筆數足夠」的歷史，用它算出的距中軌/漲跌幅全是過去式
  // （例：瑞昱 5/29 貼中軌、6/15 早已噴出）。所以最後一筆不夠新時，也要視為資料不足、改走外部備援。
  const latestRowDate = rows.length ? toCompactDate(rows[rows.length - 1].date) : "";
  const stale = !latestRowDate || latestRowDate < addDaysCompact(dateCompact, -(options.freshnessDays ?? 5));
  if (options.allowExternalFallback && (rows.length < (options.fallbackMinRows || 60) || stale)) {
    try {
      return await fetchYahooHistory(quote, dateCompact, options.fallbackRange || "2y");
    } catch {
      return rows;
    }
  }
  return rows;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchJsonWithRetry(url, options = {}, retries = 1) {
  try {
    return await fetchJson(url, options);
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return fetchJsonWithRetry(url, options, retries - 1);
  }
}

// 風險名單的「最後成功快取」：官方公告端點偶爾會 403 限流，
// 注意/處置名單一天才更新一次，被擋時改用上次成功的名單既安全又不嚇人。
const riskSourceMemory = new Map();
const riskMemoryPath = join(dataDir, "risk-cache.json");
let riskMemoryLoaded = false;

async function loadRiskSourceMemory() {
  if (riskMemoryLoaded) return;
  riskMemoryLoaded = true;
  try {
    const raw = JSON.parse(await readFile(riskMemoryPath, "utf8"));
    for (const [name, entry] of Object.entries(raw || {})) {
      if (entry && Array.isArray(entry.codes)) riskSourceMemory.set(name, entry);
    }
  } catch {
    // 第一次啟動還沒有快取檔，正常。
  }
}

function saveRiskSourceMemory() {
  const task = mkdir(dataDir, { recursive: true })
    .then(() => writeFileAtomic(riskMemoryPath, JSON.stringify(Object.fromEntries(riskSourceMemory), null, 1)))
    .catch((error) => console.warn("[Stock1] risk-cache.json 寫入失敗（沿用記憶體快取，重啟後會重抓）：", error.message));
  return trackBackgroundTask(task, "risk-cache.json 背景寫入");
}

// ===== 處置看板「每日快照」持久化（給今日新進/出關、注意升溫、連續天數用）=====
// 沿用 risk-cache.json 的 .data JSON 樣板。格式：{ "yyyymmdd": {disposition:[code], attention:{code:count}, changed:[code], block:[code]} }
const surveillanceHistoryPath = join(dataDir, "surveillance-history.json");
let surveillanceHistory = null;
async function loadSurveillanceHistory() {
  if (surveillanceHistory) return surveillanceHistory;
  try {
    surveillanceHistory = JSON.parse(await readFile(surveillanceHistoryPath, "utf8")) || {};
  } catch {
    surveillanceHistory = {};
  }
  return surveillanceHistory;
}
async function saveSurveillanceHistory() {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFileAtomic(surveillanceHistoryPath, JSON.stringify(surveillanceHistory));
  } catch (error) {
    // 看板本身仍可回應，但一定等到持久化成功或明確失敗才結束這次請求，
    // 避免程序緊接著關閉時遺失「今日新進／出關」的比較基準。
    console.warn("[Stock1] surveillance-history.json 寫入失敗（今日新進/出關判斷可能少一天）：", error.message);
  }
}

// 名單一天才公布一次：一小時內抓過就直接用，不再打官方端點（降低被 403 限流的機率）。
const RISK_SOURCE_FRESH_MS = 60 * 60 * 1000;
const RISK_SOURCE_STALE_MS = 26 * 60 * 60 * 1000;

// 上市注意股端點（`/announcement/notice`，官方說明就寫「集中市場**當日**公布注意股票」）
// 在沒有當日公布時**不是回空陣列，而是回一列所有欄位都是空字串／"0" 的哨兵**
// （2026-07-26 實測：`{"Number":"0","Code":"","Name":"","NumberOfAnnouncement":"0",…}`）。
// 舊寫法用 `/^\d{4}$/` 過濾代號，哨兵被靜默濾掉 → 變成「今天沒有任何上市注意股」這個**事實陳述**。
//
// 這不是假想問題：本機 45 天快照裡 11 個日子共 299 筆注意股，**上市 0 筆、上櫃 299 筆**
// （兩份官方 4 碼清單零重疊，分類可靠）。上市 1,092 檔／上櫃 889 檔，連續 11 天上市掛零
// 而上櫃每天 16~39 檔，機率上不可能——同期 `/announcement/notetrans` 還回著
// 「115年7月23日至115年7月24日連續二次」，證明上市那兩天確實公布過注意資訊。
// 也就是說這份名單一直是空的，而畫面把它當成「乾淨」。
//
// 同一類陷阱在這個專案已經記錄過三次（逐月歷史的 `X0.00`、MIS 的 `0.0000`、
// 整批收盤的 `Change:"0.0000"`）：**上游用「看得像資料的東西」表達「沒有資料」**。
// 回 null 代表「拿不到」，讓呼叫端走 last-good ＋ 警告，而不是宣稱零。
function twseNoticeRowsOrNull(rows) {
  if (!Array.isArray(rows)) return null;
  if (!rows.length) return rows;               // 真正的空陣列（RWD 版就是這樣回）→ 尊重它
  const usable = rows.filter((row) => /^\d{4,6}$/.test(cleanCode(row?.Code)));
  return usable.length ? usable : null;        // 有列但沒有一個代號 → 哨兵，不是零
}

async function resolveRiskSource(name, fetcher, warnings) {
  const cached = riskSourceMemory.get(name);
  const cacheAge = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  if (Array.isArray(cached?.codes) && cacheAge < RISK_SOURCE_FRESH_MS) {
    return cached.codes;
  }
  try {
    const codes = unique(await fetcher());
    riskSourceMemory.set(name, { codes, fetchedAt: new Date().toISOString() });
    while (riskSourceMemory.size > 64) riskSourceMemory.delete(riskSourceMemory.keys().next().value);
    return codes;
  } catch (error) {
    if (cached?.codes?.length) {
      // 同一天內的快取與最新名單等價，靜默沿用；超過一天才需要提醒使用者。
      if (cacheAge < RISK_SOURCE_STALE_MS) {
        return cached.codes;
      }
      const cachedLabel = new Date(cached.fetchedAt).toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      warnings.push(`${name}已超過一天無法更新，目前沿用 ${cachedLabel} 的名單，內容可能略舊。`);
      return cached.codes;
    }
    warnings.push(`${name}抓取失敗：${error.message}`);
    return [];
  }
}

// 把來源名稱（"…注意股"/"…處置股"/"…變更交易"）正規化成統一的監視標籤。
// 同一檔多重命中時取嚴重度較高者（處置 > 全額交割 > 注意）當主標籤。
const SURVEILLANCE_RANK = { attention: 1, changed: 2, disposition: 3 };
function classifySurveillance(sourceName) {
  if (sourceName.includes("處置")) {
    return { kind: "disposition", label: "處置", note: "分盤撮合・預收款券・多不可當沖" };
  }
  if (sourceName.includes("變更交易")) {
    return { kind: "changed", label: "全額交割", note: "預收全額款券" };
  }
  return { kind: "attention", label: "注意", note: "" };
}

async function loadRiskSets(riskDate) {
  const key = riskDate;
  const cached = riskCache.value && riskCache.key === key && riskCache.expiresAt > Date.now();
  if (cached) return riskCache.value;
  await loadRiskSourceMemory();

  // surveillance：注意/處置/變更交易名單改為「標示」而非「排除」（前端可切換隱藏）。
  // halted/delisted：停牌/下市名單則是「硬排除」——掛單也不會成交，出現在選股清單只會誤導。
  const surveillance = new Map();
  const halted = new Map(); // code → 停牌起日（西元 compact，可能為空字串）
  const delisted = new Set();
  const warnings = [];

  const sources = [
    {
      // 改用官方 OpenAPI：www.twse.com.tw 網頁版對程式化請求會反爬蟲回 403。
      name: "TWSE 注意股",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/announcement/notice");
        const usable = twseNoticeRowsOrNull(rows);
        // 拿不到就要拋，讓 resolveRiskSource 走 last-good ＋ 警告；靜默回 [] 等於宣稱「沒有注意股」。
        if (usable === null) throw new Error("官方只回了空白哨兵列，當日名單尚未公布或已清空");
        return usable.map((r) => cleanCode(r.Code)).filter((code) => /^\d{4}$/.test(code));
      },
    },
    {
      // 處置公告清單同時含「已結束」與「尚未開始」的列——看板自己就把它切成即將處置／
      // 處置中／即將出關三桶，代表程式早就預期清單裡有非當期的列。這裡以前卻無條件全收，
      // 已出關的股票今天仍被標「處置・分盤・預收」，開了隱藏開關還會誤刪正常交易的標的。
      // 日期窗在消費端套用（見下方迴圈）而不是塞進 fetcher：riskSourceMemory 以 name 為鍵
      // 並持久化，若把結果變成跟日期相關就必須把 riskDate 加進 name，last-good 會變成每日
      // 獨立、上游失敗時反而沒有備援。改用既有的 `code|...` 字串慣例夾帶期間。
      name: "TWSE 處置股",
      windowed: true,
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/announcement/punish");
        return rows
          .map((r) => {
            const period = parseDispositionPeriod(r.DispositionPeriod);
            return `${cleanCode(r.Code)}|${period.start}|${period.end}`;
          })
          .filter((entry) => /^\d{4}\|/.test(entry));
      },
    },
    {
      name: "TWSE 變更交易",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/exchangeReport/TWT85U");
        return rows.map((row) => cleanCode(row.Code)).filter((code) => /^\d{4}$/.test(code));
      },
    },
    {
      name: "TPEx 注意股",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information");
        return rows.map((row) => cleanCode(row.SecuritiesCompanyCode)).filter((code) => /^\d{4}$/.test(code));
      },
    },
    {
      name: "TPEx 處置股",
      windowed: true,
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_disposal_information");
        return rows
          .map((row) => {
            const period = parseDispositionPeriod(row.DispositionPeriod);
            return `${cleanCode(row.SecuritiesCompanyCode)}|${period.start}|${period.end}`;
          })
          .filter((entry) => /^\d{4}\|/.test(entry));
      },
    },
    {
      name: `TPEx 變更交易:${riskDate}`,
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_cmode");
        return rows
          .filter((row) => ["Ｙ", "Y"].includes(String(row.AlteredTrading || "").trim()))
          .filter((row) => toCompactDate(row.Date) === riskDate)
          .map((row) => cleanCode(row.SecuritiesCompanyCode))
          .filter((code) => /^\d{4}$/.test(code));
      },
    },
  ];

  // 停牌/下市來源。日期窗判斷必須在 fetcher 內做（resolveRiskSource 只存字串陣列）；
  // 停牌來源用 "code|起日" 夾帶停牌日，給技術頁顯示「停牌中（自 MM/DD）」。
  const todayCompact = toTaipeiCompactDate();
  const tradabilitySources = [
    {
      // 清單含「已恢復交易」的歷史列（恢復日已過仍在列），必須用日期窗過濾。
      name: "TWSE 暫停交易",
      target: "halted",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU");
        return rows
          .map((row) => ({ code: cleanCode(row.Code), halt: toCompactDate(row.TradingHaltDate), resume: toCompactDate(row.TradingResumptionDate) }))
          .filter((r) => /^\d{4}$/.test(r.code) && r.halt && r.halt <= todayCompact && (!r.resume || r.resume > todayCompact))
          .map((r) => `${r.code}|${r.halt}`);
      },
    },
    {
      // DateOfResumedTrading 空字串＝仍停牌中。（tpex_spendi_today 無資料時會回一筆全空白列，別用它）
      name: "TPEx 暫停交易",
      target: "halted",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_spendi_history");
        return rows
          .map((row) => ({ code: cleanCode(row.SecuritiesCompanyCode), halt: toCompactDate(row.DateOfSuspendedTrading), resume: toCompactDate(row.DateOfResumedTrading) }))
          .filter((r) => /^\d{4}$/.test(r.code) && r.halt && r.halt <= todayCompact && (!r.resume || r.resume > todayCompact))
          .map((r) => `${r.code}|${r.halt}`);
      },
    },
    {
      // 上櫃「停止交易」旗標（官方值是全形Ｙ）；TPEx 沒有下櫃名單端點，停止交易通常是下櫃前置。
      name: "TPEx 停止交易",
      target: "halted",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_cmode");
        return rows
          .filter((row) => ["Ｙ", "Y"].includes(String(row.SuspensionOfTrading || "").trim()))
          .map((row) => cleanCode(row.SecuritiesCompanyCode))
          .filter((code) => /^\d{4}$/.test(code));
      },
    },
    {
      // 264 筆含 2001 年以來全部下市股：只取近兩年，避免誤殺被回收再發的代號。
      name: "TWSE 終止上市",
      target: "delisted",
      fetcher: async () => {
        const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml");
        const cutoff = addDaysCompact(todayCompact, -730);
        return rows
          .map((row) => ({ code: cleanCode(row.Code), date: toCompactDate(row.DelistingDate) }))
          .filter((r) => /^\d{4}$/.test(r.code) && r.date && r.date >= cutoff && r.date <= todayCompact)
          .map((r) => r.code);
      },
    },
  ];

  await Promise.all([
    ...sources.map(async ({ name, fetcher, windowed = false }) => {
      const entries = await resolveRiskSource(name, fetcher, warnings);
      const info = classifySurveillance(name);
      for (const entry of entries) {
        // 一般來源存純代號；windowed 來源存 `code|起日|迄日`（沿用停牌來源的 `|` 慣例）。
        // 舊的 risk-cache.json 只有純代號，讀到時 start/end 為空 → 保留，向後相容。
        const [code, start = "", end = ""] = String(entry).split("|");
        if (!/^\d{4}$/.test(code)) continue;
        // 期間可解析且不涵蓋基準日 → 已出關或尚未開始，今天不該掛處置標籤。
        // 期間解析不出來時保守保留：對風險標籤而言，寧可多標也不要漏標。
        if (windowed && start && end && !(start <= riskDate && riskDate <= end)) continue;
        const prev = surveillance.get(code);
        if (!prev || SURVEILLANCE_RANK[info.kind] > SURVEILLANCE_RANK[prev.kind]) {
          surveillance.set(code, info);
        }
      }
    }),
    ...tradabilitySources.map(async ({ name, target, fetcher }) => {
      const entries = await resolveRiskSource(name, fetcher, warnings);
      for (const entry of entries) {
        const [code, since = ""] = String(entry).split("|");
        if (!/^\d{4}$/.test(code)) continue;
        if (target === "delisted") {
          delisted.add(code);
        } else if (!halted.has(code) || (since && !halted.get(code))) {
          halted.set(code, since);
        }
      }
    }),
  ]);
  saveRiskSourceMemory();

  riskCache = {
    key,
    expiresAt: Date.now() + 10 * 60 * 1000,
    value: {
      surveillance,
      halted,
      delisted,
      warnings,
    },
  };
  return riskCache.value;
}

function getRiskSets(dateCompact) {
  const riskDate = toCompactDate(dateCompact) || toTaipeiCompactDate();
  if (riskCache.value && riskCache.key === riskDate && riskCache.expiresAt > Date.now()) return Promise.resolve(riskCache.value);
  if (riskInFlight.has(riskDate)) return riskInFlight.get(riskDate);
  const task = loadRiskSets(riskDate).finally(() => riskInFlight.delete(riskDate));
  riskInFlight.set(riskDate, task);
  return task;
}

// ===== 處置／注意／鉅額交易看板 =====
// 一律走官方 OpenAPI（openapi.twse.com.tw / tpex.org.tw/openapi）：
// 網頁版 www.twse.com.tw 對程式化請求有反爬蟲、會回 403。
const openapiHeaders = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "accept": "application/json",
};

// 處置期間文字 "115/05/28～115/06/10" 或 "1150626~1150709" → {start,end}（西元 compact）
function parseDispositionPeriod(text) {
  const parts = String(text || "").split(/[~～至]/);
  return { start: toCompactDate(parts[0] || ""), end: toCompactDate(parts[1] || parts[0] || "") };
}
// TPEx 的鉅額與變更交易端點回的是「最近一個公布日」的整批資料，不是可以指定日期的查詢。
// 以前硬比對日曆今天（toTaipeiCompactDate），於是週末、國定假日與盤中尚未公布的時段，
// 這兩類就只剩上市股票、上櫃整批消失，counts 跟著少算，畫面卻仍標著今天的日期——
// 看起來像「上櫃今天真的沒有全額交割股」。改成取 payload 內「不晚於查詢日的最新日期」。
function latestUpstreamDate(rows, getDate, notAfter = "") {
  let latest = "";
  for (const row of rows || []) {
    const date = toCompactDate(getDate(row));
    if (!date || (notAfter && date > notAfter)) continue;
    if (date > latest) latest = date;
  }
  return latest;
}
// 分盤間隔：處置內容含「每5/五分鐘」→5、「每20/二十分鐘」→20
function parseDispositionInterval(text) {
  const t = String(text || "");
  if (/二十分鐘|20\s*分鐘/.test(t)) return 20;
  if (/五分鐘|5\s*分鐘/.test(t)) return 5;
  return null;
}
function compactDaysDiff(fromCompact, toCompactStr) {
  const a = toCompactDate(fromCompact), b = toCompactDate(toCompactStr);
  if (!a || !b) return null;
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(4, 6)) - 1, Number(a.slice(6, 8)));
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(4, 6)) - 1, Number(b.slice(6, 8)));
  return Math.round((db - da) / 86400000);
}

let surveillanceBoardCache = { key: "", value: null, expiresAt: 0 };
let surveillanceBoardInFlight = null;
// 各來源「上次成功（同日）」的解析結果：官方公告端點偶爾 403 限流，
// 同一天抓失敗就沿用稍早成功的資料（跨日才作廢），避免看板某分頁整個空掉。
const survSourceMemory = new Map();
async function survFetchRecords(key, today, label, warnings, fetcher) {
  try {
    const records = await fetcher();
    survSourceMemory.set(key, { date: today, records });
    return records;
  } catch (error) {
    const cached = survSourceMemory.get(key);
    if (cached && cached.date === today && Array.isArray(cached.records)) {
      warnings.push(`${label}暫時抓取失敗（${error.message}），已沿用稍早成功的資料。`);
      return cached.records;
    }
    warnings.push(`${label}抓取失敗：${error.message}`);
    return [];
  }
}

function surveillanceQuoteFields(quote, fallbackCode = "") {
  if (!quote) return { name: fallbackCode };
  const price = Number(quote.price);
  const previousClose = Number(quote.previousClose);
  const changePct = Number.isFinite(price) && Number.isFinite(previousClose) && previousClose
    ? Number((((price - previousClose) / previousClose) * 100).toFixed(2))
    : Number.isFinite(Number(quote.changePct)) ? Number(Number(quote.changePct).toFixed(2)) : null;
  const quoteDay = toCompactDate(quote.rawDate || quote.asOf);
  return {
    name: quote.name || fallbackCode,
    exchange: quote.exchange,
    price: Number.isFinite(price) ? price : null,
    changePct,
    turnover: Number.isFinite(Number(quote.turnoverPct)) ? Number(quote.turnoverPct) : null,
    volumeLots: Number.isFinite(Number(quote.volumeLots)) ? Number(quote.volumeLots) : null,
    quoteAsOf: compactToIsoDate(quoteDay),
    quoteTimestamp: quote.asOf || compactToIsoDate(quoteDay),
    quoteSourceKind: quote.sourceKind || "daily-close",
    priceStale: quote.priceStale === true,
  };
}

function resolveSurveillanceQuoteDate(items, fallbackDate = "") {
  const counts = new Map();
  const seenCodes = new Set();
  for (const item of items || []) {
    if (!item?.code || seenCodes.has(item.code)) continue;
    seenCodes.add(item.code);
    const day = toCompactDate(item.quoteAsOf || item.quoteTimestamp);
    if (day) counts.set(day, (counts.get(day) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0]
    || toCompactDate(fallbackDate);
}

async function getSurveillanceBoard(dateCompact) {
  const today = dateCompact ? toCompactDate(dateCompact) : toTaipeiCompactDate();
  if (surveillanceBoardCache.value && surveillanceBoardCache.key === today && surveillanceBoardCache.expiresAt > Date.now()) {
    return surveillanceBoardCache.value;
  }
  const warnings = [];
  let reference;
  try {
    reference = await getReferenceData();
    warnings.push(...(reference.warnings || []));
  } catch (error) {
    warnings.push(`整批收盤行情抓取失敗：${error.message}；看板仍會顯示公告，但名稱與價量資料暫缺。`);
    reference = { byCode: new Map(), warnings: [], coverageComplete: false };
  }
  let tradingCalendar = { tradingDays: [], holidayRows: [], warnings: [], degraded: true };
  try {
    tradingCalendar = await getTradingCalendarEvidence();
    warnings.push(...(tradingCalendar.warnings || []));
  } catch (error) {
    warnings.push(`交易日日曆暫時抓取失敗（${error.message}），即將結束分類先依週末／平日保守判定。`);
  }
  const nextTradingDate = resolveNextTradingDate(today, tradingCalendar).date
    || nextScheduledTradingDate(today, tradingCalendar.holidayRows);
  const todayIsTradingDay = isScheduledTradingDate(today, tradingCalendar.holidayRows);
  // 先用整批收盤行情補上名稱與價量；名單完成後再批次用 MIS 覆蓋同日或較新的逐檔行情。
  const enrich = (code) => {
    const q = reference.byCode.get(code);
    return surveillanceQuoteFields(q, code);
  };

  // ---- 處置（TWSE punish + TPEx disposal）----
  const twsePunish = await survFetchRecords("twsePunish", today, "TWSE 處置", warnings, async () => {
    // 用官方 OpenAPI（openapi.twse.com.tw）：網頁版 www.twse.com.tw 會反爬蟲回 403。
    const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/announcement/punish", { headers: openapiHeaders });
    return (rows || []).map((r) => {
      const code = cleanCode(r.Code);
      if (!/^\d{4}$/.test(code)) return null;
      const { start, end } = parseDispositionPeriod(r.DispositionPeriod);
      return { code, market: "TWSE", start, end, interval: parseDispositionInterval(r.Detail), reason: String(r.ReasonsOfDisposition || "").trim() };
    }).filter(Boolean);
  });
  const tpexDisposal = await survFetchRecords("tpexDisposal", today, "TPEx 處置", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_disposal_information");
    return (rows || []).map((r) => {
      const code = cleanCode(r.SecuritiesCompanyCode);
      if (!/^\d{4}$/.test(code)) return null;
      const { start, end } = parseDispositionPeriod(r.DispositionPeriod);
      return { code, market: "TPEx", start, end, interval: parseDispositionInterval(r.DisposalCondition), reason: String(r.DispositionReasons || "").trim() };
    }).filter(Boolean);
  });
  const dispMap = new Map(); // code -> 取迄日最晚的那筆
  for (const rec of [...twsePunish, ...tpexDisposal]) {
    if (!rec.end) continue;
    const prev = dispMap.get(rec.code);
    if (!prev || rec.end > prev.end) dispMap.set(rec.code, rec);
  }

  const aboutToDispose = [], inDisposition = [], aboutToRelease = [];
  for (const rec of dispMap.values()) {
    const daysToStart = compactDaysDiff(today, rec.start);
    const daysToRelease = compactDaysDiff(today, rec.end);
    const item = {
      ...rec, ...enrich(rec.code), daysToStart, daysToRelease,
      startsNextTradingDay: rec.start === nextTradingDate,
      releaseSoon: rec.end === today || rec.end === nextTradingDate,
      releaseOnNextTradingDay: rec.end === nextTradingDate,
      startSlash: compactToSlashDate(rec.start), endSlash: compactToSlashDate(rec.end),
    };
    if (daysToStart != null && daysToStart > 0) aboutToDispose.push(item);
    else if (daysToRelease != null && daysToRelease >= 0) {
      inDisposition.push(item);
      if (item.releaseSoon) aboutToRelease.push(item);
    }
  }
  aboutToDispose.sort((a, b) => (a.daysToStart ?? 99) - (b.daysToStart ?? 99));
  inDisposition.sort((a, b) => (a.daysToRelease ?? 99) - (b.daysToRelease ?? 99));
  aboutToRelease.sort((a, b) => (a.daysToRelease ?? 99) - (b.daysToRelease ?? 99));

  // ---- 注意（TWSE notice + TPEx warning）----
  const twseNotice = await survFetchRecords("twseNotice", today, "TWSE 注意", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/announcement/notice", { headers: openapiHeaders });
    const usable = twseNoticeRowsOrNull(rows);
    if (usable === null) throw new Error("官方只回了空白哨兵列，當日名單尚未公布或已清空");
    return usable.map((r) => {
      const code = cleanCode(r.Code);
      if (!/^\d{4}$/.test(code)) return null;
      // `Date` 欄位官方確實有給（D-44 原記錄說「沒有期間欄位」不精確）——它是**公布日**而不是期間。
      // 對照組：處置股的 tpex_disposal_information 給的是 `DispositionPeriod: "1150727~1150807"`。
      // 注意交易資訊本質上是「逐日公布」的旗標，沒有期間可言，所以 D-08 不給它加日期窗是對的；
      // 但公布日必須保留，否則無法分辨這份名單是今天的還是沿用舊的。
      return {
        code, market: "TWSE", count: Number(r.NumberOfAnnouncement) || 1,
        reason: String(r.TradingInfoForAttention || "").trim(),
        noticeDate: toCompactDate(r.Date) || "",
      };
    }).filter(Boolean);
  });
  const tpexWarning = await survFetchRecords("tpexWarning", today, "TPEx 注意", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information");
    return (rows || []).map((r) => {
      const code = cleanCode(r.SecuritiesCompanyCode);
      if (!/^\d{4}$/.test(code)) return null;
      // 上櫃同樣有公布日（民國 "1150724"），兩邊都留下來才比對得出「哪一邊沿用了舊名單」。
      return {
        code, market: "TPEx", count: 1, reason: String(r.TradingInformation || "").trim(),
        noticeDate: toCompactDate(r.Date) || "",
      };
    }).filter(Boolean);
  });
  const attMap = new Map();
  for (const rec of twseNotice) attMap.set(rec.code, rec);
  for (const rec of tpexWarning) if (!attMap.has(rec.code)) attMap.set(rec.code, rec);
  const attention = [...attMap.values()]
    .map((r) => ({ ...r, ...enrich(r.code) }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  // ---- 鉅額交易（TWSE BFIAUU + TPEx 逐筆 → 依代號聚合）----
  const blockTwse = await survFetchRecords("blockTwse", today, "TWSE 鉅額交易", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/announcement/BFIAUU", { headers: openapiHeaders });
    const agg = new Map();
    for (const r of rows || []) {
      const code = cleanCode(r.Code);
      if (!/^\d{4}$/.test(code)) continue;
      const value = Number(String(r.TradeValue || "").replace(/,/g, "")) || 0;
      const o = agg.get(code) || { code, name: String(r.Name || "").trim(), count: 0, value: 0 };
      o.count += 1;
      o.value += value;
      agg.set(code, o);
    }
    return [...agg.values()];
  });
  const blockTpex = await survFetchRecords("blockTpex", today, "TPEx 鉅額交易", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_daily_qutoes_block");
    // 取上游最近一個公布日（不晚於查詢日），而不是硬比對日曆今天——否則非交易日整批消失。
    const sourceDate = latestUpstreamDate(rows, (r) => r.Date, today);
    const agg = new Map();
    for (const r of rows || []) {
      const code = cleanCode(r.Code);
      if (!/^\d{4}$/.test(code)) continue;
      if (!sourceDate || toCompactDate(r.Date) !== sourceDate) continue;
      const value = Number(String(r.TradeValue || "").replace(/,/g, "")) || 0;
      const o = agg.get(code) || { code, name: String(r.Name || "").trim(), count: 0, value: 0, asOf: sourceDate };
      o.count += 1;
      o.value += value;
      agg.set(code, o);
    }
    return [...agg.values()];
  });
  // 合併兩市場（同代號相加，理論上不重疊）
  const blockMerged = new Map();
  for (const o of [...blockTwse, ...blockTpex]) {
    const prev = blockMerged.get(o.code);
    if (prev) { prev.count += o.count; prev.value += o.value; }
    else blockMerged.set(o.code, { ...o });
  }
  const blockTrades = [...blockMerged.values()]
    .map((o) => ({ ...o, ...enrich(o.code), valueYi: Number((o.value / 1e8).toFixed(2)) }))
    .sort((a, b) => b.value - a.value);

  // ---- 全額交割／變更交易（TWSE TWT85U 即全額交割股清單 + TPEx tpex_cmode 變更交易欄）----
  const changedTwse = await survFetchRecords("changedTwse", today, "TWSE 全額交割", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://openapi.twse.com.tw/v1/exchangeReport/TWT85U", { headers: openapiHeaders });
    return (rows || []).map((r) => {
      const code = cleanCode(r.Code);
      if (!/^\d{4}$/.test(code)) return null;
      // PeriodicCallAuctionTrading 含「*」表示同時為分盤集合競價。
      return { code, market: "TWSE", srcName: String(r.Name || "").trim(), periodic: String(r.PeriodicCallAuctionTrading || "").includes("*") };
    }).filter(Boolean);
  });
  const changedTpex = await survFetchRecords("changedTpex", today, "TPEx 全額交割", warnings, async () => {
    const rows = await fetchJsonWithRetry("https://www.tpex.org.tw/openapi/v1/tpex_cmode");
    const sourceDate = latestUpstreamDate(rows, (r) => r.Date, today); // 同上：不硬比對日曆今天
    if (!sourceDate) return [];
    return (rows || [])
      .filter((r) => ["Ｙ", "Y"].includes(String(r.AlteredTrading || "").trim()) && toCompactDate(r.Date) === sourceDate) // 變更交易方法＝全額交割
      .map((r) => {
        const code = cleanCode(r.SecuritiesCompanyCode);
        if (!/^\d{4}$/.test(code)) return null;
        return { code, market: "TPEx", srcName: String(r.CompanyName || "").trim(), periodic: String(r.PeriodicTrading || "").trim() !== "", asOf: sourceDate };
      }).filter(Boolean);
  });
  // 上櫃兩類的資料日若落後查詢日（非交易日、或當日尚未公布），必須明講——否則使用者會
  // 以為「上櫃今天真的沒有鉅額／全額交割」。只在「確實有資料但日期較舊」時警告；
  // 完全沒有列時無法分辨「當天真的沒有」與「上游還沒公布」，不編造結論。
  for (const [label, records] of [["鉅額交易", blockTpex], ["全額交割", changedTpex]]) {
    const sourceDate = records.find((record) => record.asOf)?.asOf || "";
    if (sourceDate && sourceDate !== today) {
      warnings.push(`上櫃${label}目前是 ${compactToSlashDate(sourceDate)} 的公布資料（查詢日 ${compactToSlashDate(today)}）。`);
    }
  }

  const changedMap = new Map();
  for (const rec of [...changedTwse, ...changedTpex]) if (!changedMap.has(rec.code)) changedMap.set(rec.code, rec);
  const changedTrading = [...changedMap.values()]
    .map((r) => {
      const e = enrich(r.code);
      const found = e.exchange !== undefined || Number.isFinite(e.price);
      // 全額交割股偶爾不在整批報價裡：名稱／交易所用來源資料補回，避免顯示成代號或誤判市場。
      return { ...r, ...e, exchange: e.exchange || r.market, name: found ? e.name : (r.srcName || r.code) };
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  // STOCK_DAY_ALL 是整批端點，但個別股票可能仍停在更早日期；若只拿市場眾數當行情日，
  // 會出現卡片顯示舊價、右側 MIS 顯示新價，卻都被冠上同一個日期。這裡一次批次抓齊名單代號，
  // 只接受「不晚於查詢日、且不比該檔整批資料更舊」的成交價，讓卡片與右側明細使用相同語意。
  const quoteGroups = [aboutToDispose, inDisposition, aboutToRelease, attention, blockTrades, changedTrading];
  const itemsByCode = new Map();
  for (const group of quoteGroups) {
    for (const item of group) {
      if (!itemsByCode.has(item.code)) itemsByCode.set(item.code, new Set());
      itemsByCode.get(item.code).add(item);
    }
  }
  if (itemsByCode.size) {
    try {
      const realtimeRows = await fetchMisQuotes([...itemsByCode.keys()], reference);
      const realtimeByCode = new Map();
      for (const row of realtimeRows) {
        const code = cleanCode(row.c);
        if (!code) continue;
        realtimeByCode.set(code, normalizeMisQuote(row, reference.byCode.get(code)));
      }
      for (const [code, items] of itemsByCode) {
        const realtime = realtimeByCode.get(code);
        const realtimeDay = toCompactDate(realtime?.rawDate || realtime?.asOf);
        const referenceQuote = reference.byCode.get(code);
        const referenceDay = toCompactDate(referenceQuote?.rawDate || referenceQuote?.asOf);
        if (
          !realtime || realtime.priceStale || !Number.isFinite(Number(realtime.price)) ||
          !realtimeDay || realtimeDay > today || (referenceDay && realtimeDay < referenceDay)
        ) continue;
        const fields = surveillanceQuoteFields(realtime, code);
        // MIS 沒有發行股數，無法重算週轉率；保留整批行情已算出的值。
        delete fields.turnover;
        for (const item of items) Object.assign(item, fields);
      }
    } catch (error) {
      warnings.push(`即時行情抓取失敗（${error.message}），卡片暫以逐檔標示日期的官方收盤價顯示。`);
    }
  }

  const allQuoteItems = quoteGroups.flat();
  const boardQuoteDate = resolveSurveillanceQuoteDate(allQuoteItems, resolveMarketCloseDate(reference));
  for (const item of allQuoteItems) {
    const itemQuoteDate = toCompactDate(item.quoteAsOf || item.quoteTimestamp);
    item.quoteDateMismatch = Boolean(itemQuoteDate && boardQuoteDate && itemQuoteDate !== boardQuoteDate);
    item.quoteLagging = Boolean(itemQuoteDate && boardQuoteDate && itemQuoteDate < boardQuoteDate);
  }

  // ---- 歷史快照差異：今日新進/出關、注意升溫、連續天數 ----
  // 抓取失敗要**分類別**看。舊寫法一刀切（任何來源失敗 → prev 設 null、整份歷史停更），
  // 在「TWSE 注意股端點長期只回空白哨兵列」被揭露出來之後（見 twseNoticeRowsOrNull），
  // 等於把新進／出關／連 N 天／接近處置門檻**永久關掉**——而處置、全額交割、鉅額那幾類的
  // 資料其實是完整的，沒有理由陪葬。
  //   失敗的類別 → 不比對（避免把抓不到誤判成出關），也不寫進今天的快照（避免明天看到假新進）。
  //   成功的類別 → 照常比對與落盤。
  const SURVEILLANCE_HISTORY_FIELDS = [
    { field: "disposition", match: /處置/ },
    { field: "attention", match: /注意/ },
    { field: "block", match: /鉅額/ },
    { field: "changed", match: /全額交割/ },
  ];
  const failedFields = new Set();
  for (const warning of warnings) {
    const at = warning.indexOf("抓取失敗：");
    if (at < 0) continue;
    const label = warning.slice(0, at);
    for (const { field, match } of SURVEILLANCE_HISTORY_FIELDS) if (match.test(label)) failedFields.add(field);
  }
  const hadHardFailure = failedFields.size > 0;
  if (hadHardFailure) {
    const names = SURVEILLANCE_HISTORY_FIELDS
      .filter(({ field }) => failedFields.has(field))
      .map(({ match }) => String(match.source));
    warnings.push(`${names.join("、")}的公告來源目前沒有可用資料，這幾類本次不更新每日歷史、也不計算出關`
      + "（避免把抓取失敗誤判成名單異動）；其餘類別照常比對。");
  }
  const history = await loadSurveillanceHistory();
  const pastDates = Object.keys(history).filter((d) => d < today).sort();
  const comparisonAsOf = pastDates.length ? pastDates.at(-1) : "";
  const prev = comparisonAsOf ? history[comparisonAsOf] : null;
  // 兩種問題要分開，否則會關掉本來可信的資訊：
  //  (a) 對照快照**根本沒有這個欄位**（先前那一輪失敗被省略）→ 完全不能比，
  //      否則今天整批都會被標成「新進」。
  //  (b) 這一輪某個來源抓不到 → 該市場的代號今天整批缺席。這時
  //      **「新進」與「連 N 天」仍然可信**——今天出現在名單上的代號，它前一份快照在不在，
  //      是查得到的事實（缺席的市場在雙邊都缺席，不會產生假訊號）；
  //      但**「出關」不可信**，因為代號消失可能只是因為抓不到，不是真的解除。
  // 實例：TWSE 注意股端點長期只回哨兵列，歷史快照裡本來就只有上櫃代號，
  // 那 14 檔上櫃注意股的連續天數是真的，沒有理由一起關掉。
  // 還有第三個條件：**名單組成必須一致**。拿「缺了上市那一半」的名單跟「完整」的名單比，
  // 會把整批上市股當成新進。所以快照要記下當時哪幾類是不完整的（partial），
  // 只在組成相同時才比對。這讓長期缺一個市場的類別（例如上市注意股端點一直只回哨兵列）
  // 仍然能對上櫃那半算連續天數，而不是整個功能停擺；等哪天上市端點恢復，
  // 組成不一致會自動擋掉那一次比對，不會爆出一批假新進。
  // 而且組成不一致的風險是**單向**的：
  //   對照不完整 ＋ 今天完整 → 對照缺的那些代號今天全部看起來像「新進」→ 必須擋。
  //   對照完整 ＋ 今天不完整 → 今天的代號是對照的子集，「它昨天在不在」照樣查得到 → 可以比。
  // （這與 D-24 的裁決同一個形狀：看起來對稱的兩種情形，實際上只有一邊會產生假訊號。）
  const prevPartial = new Set(prev?.partial || []);
  const canCompare = (field) => Boolean(prev) && prev[field] !== undefined
    && !(prevPartial.has(field) && !failedFields.has(field));
  const canTrustRemovals = (field) => canCompare(field) && !failedFields.has(field);
  const comparisonIsPreviousTradingDay = Boolean(
    comparisonAsOf && resolveNextTradingDate(comparisonAsOf, tradingCalendar).date === today
  );
  // 連續天數只沿著相鄰「排定交易日」快照往回數；漏開一天或週末快照都不能虛增連續日。
  const consecutiveDays = (code, field) => {
    let n = 1;
    let cursor = today;
    for (let step = 0; step < 45; step += 1) {
      cursor = previousScheduledTradingDate(cursor, tradingCalendar.holidayRows);
      if (!cursor) break;
      const snap = history[cursor];
      if (!snap) break;
      const inIt = field === "attention" ? !!(snap.attention && code in snap.attention) : (snap[field] || []).includes(code);
      if (inIt) n += 1; else break;
    }
    return n;
  };
  const dispItems = [...aboutToDispose, ...inDisposition]; // aboutToRelease 與 inDisposition 共用同一批物件
  const dispCodesToday = new Set(dispItems.map((i) => i.code));
  const newLabelFor = () => (comparisonIsPreviousTradingDay ? "今日新進" : `較 ${compactToIsoDate(comparisonAsOf)} 新增`);
  const compareDisposition = canCompare("disposition");
  for (const it of dispItems) {
    it.isNew = compareDisposition ? !(prev.disposition || []).includes(it.code) : false;
    it.newLabel = it.isNew ? newLabelFor() : "";
  }
  const compareAttention = canCompare("attention");
  for (const it of attention) {
    const prevCount = compareAttention ? prev.attention?.[it.code] : undefined;
    it.isNew = compareAttention ? !(prev.attention && it.code in prev.attention) : false;
    it.newLabel = it.isNew ? newLabelFor() : "";
    it.daysOnList = compareAttention ? consecutiveDays(it.code, "attention") : null;
    const rising = comparisonIsPreviousTradingDay && prevCount != null && Number(it.count || 0) > Number(prevCount);
    // 接近處置門檻（謹慎、僅供參考）：注意累計次數偏高，或連續多日在注意且次數還在升。
    // 累計次數是這一輪官方給的，即使比對不成立也仍然可信，所以那一半照算。
    it.nearDisposition = Number(it.count || 0) >= 3 || (rising && Number(it.daysOnList || 0) >= 2);
  }
  const compareChanged = canCompare("changed");
  for (const it of changedTrading) {
    it.isNew = compareChanged ? !(prev.changed || []).includes(it.code) : false;
    it.newLabel = it.isNew ? newLabelFor() : "";
  }
  const prevDisp = new Set(compareDisposition ? prev.disposition || [] : []);
  const enteredSinceComparison = compareDisposition ? [...dispCodesToday].filter((c) => !prevDisp.has(c)).length : 0;
  // 出關必須用更嚴的判準：代號從名單消失，可能只是這一輪抓不到。
  const releasedSinceComparison = canTrustRemovals("disposition")
    ? [...prevDisp].filter((c) => !dispCodesToday.has(c)).length
    : 0;
  const enteredToday = comparisonIsPreviousTradingDay ? enteredSinceComparison : 0;
  const releasedToday = comparisonIsPreviousTradingDay ? releasedSinceComparison : 0;

  // 落盤時把「哪幾類不完整」一起記下來（partial），組成不同的兩份名單才不會被拿來互比。
  // 不完整的那一類仍然寫入——長期缺一個市場時（例如上市注意股端點只回哨兵列）省略會讓
  // 隔天完全比不了，寫進去反而能讓上櫃那半持續算連續天數。
  // 同一交易日先抓到的真實資料不因後來失敗而丟掉，所以用 merge 而不是覆寫。
  if (todayIsTradingDay) {
    const snapshot = {
      disposition: [...dispCodesToday],
      attention: Object.fromEntries(attention.map((i) => [i.code, Number(i.count || 1)])),
      changed: changedTrading.map((i) => i.code),
      block: blockTrades.map((i) => i.code),
    };
    // 同一天內若某類別先前那一輪是完整的，就別讓這一輪的殘缺名單蓋過去。
    const previousToday = history[today] || {};
    const previousTodayPartial = new Set(previousToday.partial || []);
    const partial = [];
    for (const { field } of SURVEILLANCE_HISTORY_FIELDS) {
      const wasComplete = previousToday[field] !== undefined && !previousTodayPartial.has(field);
      if (failedFields.has(field) && wasComplete) {
        snapshot[field] = previousToday[field];   // 保留先前完整的那一份
        continue;
      }
      if (failedFields.has(field) || previousTodayPartial.has(field)) partial.push(field);
    }
    history[today] = { ...previousToday, ...snapshot, ...(partial.length ? { partial } : {}) };
    for (const k of Object.keys(history).sort().slice(0, -45)) delete history[k];
    await saveSurveillanceHistory();
  } else {
    warnings.push("今天不是排定交易日，本次只顯示公告，不新增每日快照或連續日數。");
  }

  const value = {
    ok: true,
    asOf: compactToIsoDate(today),
    queryDate: compactToIsoDate(today),
    quoteAsOf: compactToIsoDate(boardQuoteDate),
    nextTradingDate: compactToIsoDate(nextTradingDate),
    comparisonAsOf: compactToIsoDate(comparisonAsOf),
    comparisonIsPreviousTradingDay,
    generatedAt: new Date().toISOString(),
    counts: {
      aboutToDispose: aboutToDispose.length,
      inDisposition: inDisposition.length,
      aboutToRelease: aboutToRelease.length,
      attention: attention.length,
      blockTrades: blockTrades.length,
      changedTrading: changedTrading.length,
    },
    aboutToDispose, inDisposition, aboutToRelease, attention, blockTrades, changedTrading,
    // 「有沒有可用的歷史比對」——至少一個類別真的比對得出來才算，不是單看 prev 存不存在。
    hasHistory: SURVEILLANCE_HISTORY_FIELDS.some(({ field }) => canCompare(field)),
    // 完全無法比對的類別（對照快照缺該欄位）：這些的「新進」一律不標。
    staleHistoryFields: SURVEILLANCE_HISTORY_FIELDS.filter(({ field }) => !canCompare(field)).map(({ field }) => field),
    // 可以比「新進」但不能比「出關」的類別（這一輪來源抓不到，代號消失不代表解除）。
    unreliableRemovalFields: SURVEILLANCE_HISTORY_FIELDS
      .filter(({ field }) => canCompare(field) && !canTrustRemovals(field)).map(({ field }) => field),
    enteredToday,
    releasedToday,
    enteredSinceComparison,
    releasedSinceComparison,
    warnings: unique(warnings),
  };
  // 有「硬失敗」（連同日 last-good 都沒有）時縮短快取，讓它 2 分鐘後就重試、別卡 10 分鐘。
  surveillanceBoardCache = { key: today, value, expiresAt: Date.now() + (hadHardFailure ? 2 : 10) * 60 * 1000 };
  return value;
}

function getSurveillanceBoardSingleFlight(dateCompact) {
  const key = dateCompact ? toCompactDate(dateCompact) : toTaipeiCompactDate();
  if (surveillanceBoardInFlight?.key === key) return surveillanceBoardInFlight.promise;
  const promise = getSurveillanceBoard(key).finally(() => {
    if (surveillanceBoardInFlight?.promise === promise) surveillanceBoardInFlight = null;
  });
  surveillanceBoardInFlight = { key, promise };
  return promise;
}

// 單檔處置/注意狀態（給技術分析頁的小標記用）
function lookupStockSurveillance(code, board) {
  if (!board) return null;
  const clean = cleanCode(code);
  const disp = [...board.aboutToDispose, ...board.inDisposition].find((r) => r.code === clean);
  if (disp) {
    const isFuture = (disp.daysToStart ?? 0) > 0;
    return {
      kind: "disposition",
      label: "處置",
      status: isFuture ? "aboutToDispose" : "inDisposition",
      interval: disp.interval || null,
      startSlash: disp.startSlash, endSlash: disp.endSlash,
      daysToStart: disp.daysToStart, daysToRelease: disp.daysToRelease,
      startsNextTradingDay: Boolean(disp.startsNextTradingDay),
      releaseSoon: Boolean(disp.releaseSoon),
      releaseOnNextTradingDay: Boolean(disp.releaseOnNextTradingDay),
    };
  }
  const chg = board.changedTrading?.find((r) => r.code === clean);
  if (chg) return { kind: "changed", label: "全額交割", status: "changedTrading", note: "預收全額款券" };
  const att = board.attention.find((r) => r.code === clean);
  if (att) return { kind: "attention", label: "注意", status: "attention", count: att.count || 1 };
  return null;
}

async function fetchMisQuotes(codes, reference) {
  const channels = [];
  for (const code of codes) {
    const fallback = reference.byCode.get(code);
    if (fallback?.exchange === "TPEx") {
      channels.push(`otc_${code}.tw`);
    } else if (fallback?.exchange === "TWSE") {
      channels.push(`tse_${code}.tw`);
    } else {
      // reference 在單一市場降級時不能武斷猜上市；兩個 channel 一起詢問，MIS 只會回存在的那檔。
      channels.push(`tse_${code}.tw`, `otc_${code}.tw`);
    }
  }
  if (!channels.length) return [];

  const batches = [];
  for (let index = 0; index < channels.length; index += 50) {
    batches.push(channels.slice(index, index + 50));
  }

  const results = [];
  for (const batch of batches) {
    const timestamp = Date.now();
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(batch.join("|"))}&json=1&delay=0&_=${timestamp}`;
    const payload = await fetchJson(url, {
      headers: {
        referer: "https://mis.twse.com.tw/stock/index.jsp",
      },
    });
    if (Array.isArray(payload.msgArray)) {
      results.push(...payload.msgArray);
    }
  }
  return results;
}

async function getQuotes(codes) {
  const normalizedCodes = [...new Set(codes.map(cleanCode).filter(Boolean))];
  const cacheKey = normalizedCodes.join(",");
  const now = Date.now();
  if (quoteCache.value && quoteCache.key === cacheKey && quoteCache.expiresAt > now) {
    return quoteCache.value;
  }

  const reference = await getReferenceData();
  const fallbackQuotes = new Map();
  for (const code of normalizedCodes) {
    const quote = reference.byCode.get(code);
    if (quote) fallbackQuotes.set(code, quote);
  }

  let realtimeRows = [];
  let realtimeError = null;
  try {
    realtimeRows = await fetchMisQuotes(normalizedCodes, reference);
  } catch (error) {
    realtimeError = error.message;
  }

  const realtimeQuotes = new Map();
  for (const row of realtimeRows) {
    const code = cleanCode(row.c);
    if (code) {
      realtimeQuotes.set(code, normalizeMisQuote(row, fallbackQuotes.get(code)));
    }
  }

  // 官方 MIS 沒給即時成交價（priceStale，price 退回昨收）的股票，改用 Yahoo 即時價補上，
  // 盤中才看得到真實現價而不是昨收。Yahoo 有 30 秒快取，並限制同時抓取數避免狂打。
  const staleCodes = normalizedCodes.filter((code) => {
    const q = realtimeQuotes.get(code);
    return !q || q.priceStale;
  });
  if (staleCodes.length) {
    await mapLimit(staleCodes, 4, async (code) => {
      const ref = fallbackQuotes.get(code);
      const y = await fetchYahooQuote(code, ref?.exchange);
      if (!y || !Number.isFinite(y.price) || y.rawDate !== toTaipeiCompactDate()) return;
      const base = realtimeQuotes.get(code) || ref || {};
      // base 可能是「前一交易日」的整批收盤（盤中 STOCK_DAY_ALL 還沒推進，且 MIS 這輪沒回這檔）。
      // 那份 previousClose 是「前前一個交易日」的收盤，拿來配今天的 Yahoo 價會把漲跌算成兩天份。
      const baseDate = toCompactDate(base.rawDate || base.asOf || "");
      const baseIsSameDay = Boolean(baseDate) && baseDate === y.rawDate;
      // previousClose 是價格欄位，必須走 parsePositivePrice：base.previousClose 合法為 null
      //（官方整批列的 Change 是 "--"、或 MIS 沒有 y 值時），Number(null)===0 是有限值，
      // 舊寫法會挑到 0 而讓 change 變成「整個股價」，changePct 又因為 0 falsy 靜靜變 null。
      const previousClose = (baseIsSameDay ? parsePositivePrice(base.previousClose) : null)
        ?? y.previousClose ?? null;
      const change = previousClose != null ? roundTo(y.price - previousClose) : null;
      // 量能欄位同理：不同交易日的量不能冠上今天的日期。Yahoo chart meta 沒有可用成交量，只能標未知。
      const staleVolumeFields = baseIsSameDay
        ? {}
        : { volumeLots: null, transactions: null, unitLots: null, turnoverPct: null };
      const sameDayIntraday = Boolean(base.officialIntraday)
        && toCompactDate(base.officialIntraday.date) === y.rawDate;
      realtimeQuotes.set(code, {
        ...base,
        source: "Yahoo Finance 即時",
        sourceKind: "realtime",
        asOf: y.asOf,
        rawDate: y.rawDate,
        price: y.price,
        priceStale: false,
        previousClose,
        change,
        changePct: change != null && previousClose ? roundTo((change / previousClose) * 100) : null,
        open: sameDayIntraday ? base.officialIntraday.open : y.open,
        high: sameDayIntraday ? base.officialIntraday.high : y.high,
        low: sameDayIntraday ? base.officialIntraday.low : y.low,
        ...staleVolumeFields,
      });
    });
  }

  const quotes = normalizedCodes
    .map((code) => realtimeQuotes.get(code) || fallbackQuotes.get(code))
    .filter(Boolean)
    // referenceCache 是全站共享的 last-good；後續 enrichment 一律改副本，不能依呼叫順序污染快取。
    .map((quote) => ({ ...quote }));

  const companyDirectory = await getCompanyDirectory();
  const issuedShares = companyDirectory.issuedShares;
  // 除息旗標：給持股頁「即將除息」提示與到價提醒的除息日加註。
  // peek 是非阻塞 O(1)（冷啟動第一輪可能拿不到，屬設計取捨）。
  const dividendMap = peekDividendSchedule();
  const todayCompact = toTaipeiCompactDate();
  for (const quote of quotes) {
    quote.issuedShares = issuedShares.get(quote.code) ?? null;
    quote.turnoverPct = computeTurnoverPct(quote.volumeLots, quote.issuedShares);
    const upcoming = dividendMap?.get(quote.code)?.[0] || null; // 最近一筆未來除權息
    quote.dividend = upcoming
      ? {
          exDate: compactToIsoDate(upcoming.exDate),
          kind: upcoming.kind,
          cash: upcoming.cashDividend,
          stockRatio: upcoming.stockRatio,
          isToday: upcoming.exDate === todayCompact,
          daysUntil: compactDaysDiff(todayCompact, upcoming.exDate),
        }
      : null;
  }

  const body = {
    ok: quotes.length > 0,
    generatedAt: new Date().toISOString(),
    sourceKey: "official",
    sourceLabel: dataSourceLabels.official,
    error: quotes.length ? null : "官方來源查無這些代號的報價",
    requestedCodes: normalizedCodes,
    quoteCount: quotes.length,
    source: realtimeQuotes.size ? "TWSE MIS + official daily close fallback" : "Official daily close fallback",
    // priceStale=true 代表即時源沒有有效成交價、已退回官方收盤——那不是「即時」。
    // 舊寫法用 realtimeQuotes.size 會把它們算進即時，資料可信度指標顯示「即時 N 檔／收盤備援 0 檔」
    // 且判定為良好，但畫面上其實有數十檔掛著「收盤」在顯示昨收。券商路徑本來就用這個語意判斷。
    realtimeCount: quotes.filter((quote) => quote.sourceKind === "realtime" && quote.priceStale !== true).length,
    fallbackCount: quotes.filter((quote) => !(quote.sourceKind === "realtime" && quote.priceStale !== true)).length,
    realtimeError,
    referenceCounts: reference.counts,
    missingCodes: normalizedCodes.filter((code) => !quotes.some((quote) => quote.code === code)),
    warnings: unique([...(reference.warnings || []), ...(companyDirectory.warnings || [])]),
    dataQuality: {
      degraded: Boolean(reference.degraded || companyDirectory.degraded),
      referenceComplete: Boolean(reference.coverageComplete),
      markets: reference.markets,
    },
    notes: [
      "price, open, high, low, previousClose, volumeLots are sourced from official endpoints when available.",
      "strategy fields in the UI are still local screening logic until separate validated datasets are connected.",
    ],
    quotes,
  };

  quoteCache = {
    key: cacheKey,
    expiresAt: now + 10 * 1000,
    value: body,
  };
  return body;
}

const fubonClientCache = new Map(); // userId → { updatedAt, sdk, stockClient }
const fubonClientInFlight = new Map(); // userId → { updatedAt, promise }

async function closeFubonClient(userId) {
  const pending = fubonClientInFlight.get(userId);
  if (pending) {
    fubonClientInFlight.delete(userId);
    await pending.promise.catch(() => {});
  }
  const cached = fubonClientCache.get(userId);
  if (!cached) return;
  fubonClientCache.delete(userId);
  if (typeof cached.sdk?.logout !== "function") return;
  try {
    await withPromiseTimeout(Promise.resolve(cached.sdk.logout()), 3000, "富邦登出");
  } catch (error) {
    console.warn(`[Stock1] 富邦 session 清理失敗（${userId}）：${error.message}`);
  }
}

async function closeAllFubonClients() {
  const userIds = new Set([...fubonClientCache.keys(), ...fubonClientInFlight.keys()]);
  await Promise.allSettled([...userIds].map(closeFubonClient));
}

async function getFubonStockClient(credentials, userId, updatedAt = "") {
  const cached = fubonClientCache.get(userId);
  if (cached?.updatedAt === updatedAt) return cached.stockClient;
  const pending = fubonClientInFlight.get(userId);
  if (pending?.updatedAt === updatedAt) return pending.promise;
  if (pending) await closeFubonClient(userId);
  if (cached) await closeFubonClient(userId);
  const promise = (async () => {
    const { FubonSDK } = await import("fubon-neo");
    const sdk = new FubonSDK();
    try {
      await withPromiseTimeout(
        Promise.resolve(sdk.login(credentials.personalId, credentials.password, credentials.certPath, credentials.certPassword)),
        8000,
        "富邦登入",
      );
      await withPromiseTimeout(Promise.resolve(sdk.initRealtime()), 8000, "富邦即時行情初始化");
      const stockClient = sdk.marketdata.restClient.stock;
      fubonClientCache.set(userId, { updatedAt, sdk, stockClient });
      return stockClient;
    } catch (error) {
      if (typeof sdk.logout === "function") await Promise.resolve(sdk.logout()).catch(() => {});
      throw error;
    }
  })().finally(() => {
    const active = fubonClientInFlight.get(userId);
    if (active?.promise === promise) fubonClientInFlight.delete(userId);
  });
  fubonClientInFlight.set(userId, { updatedAt, promise });
  return promise;
}

function brokerUnavailable(extra = {}) {
  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    sourceKey: "broker",
    sourceLabel: dataSourceLabels.broker,
    source: "Broker API",
    status: "not_configured",
    configured: false,
    error: "券商 API 未設定",
    message: "尚未設定券商 API，已保留 provider 介面。",
    ...extra,
  };
}

async function getConfiguredBrokerQuotes(codes, auth) {
  const requestedCodes = [...new Set(codes.map(cleanCode).filter(Boolean))];
  if (!auth?.user) {
    return brokerUnavailable({
      status: "auth_required",
      error: "需要先登入",
      message: "券商資料需要登入後讀取個人 API 設定。",
      requestedCodes,
      quoteCount: 0,
      realtimeCount: 0,
      fallbackCount: 0,
      quotes: [],
    });
  }

  const { credentials, saved } = await getUserBrokerCredentials(auth.user.id);
  if (!credentials) {
    return brokerUnavailable({
      status: saved?.decryptError ? "credential_error" : "not_configured",
      error: saved?.decryptError ? "券商 API 設定無法解密，請重新設定。" : "券商 API 未設定",
      message: saved?.decryptError ? "券商設定使用的主密鑰可能已變更。" : "尚未設定富邦新一代 API。",
      requestedCodes,
      quoteCount: 0,
      realtimeCount: 0,
      fallbackCount: 0,
      quotes: [],
    });
  }

  if (!credentials.personalId || !credentials.password || !credentials.certPath || !credentials.certPassword) {
    return brokerUnavailable({
      status: "incomplete",
      configured: true,
      error: "富邦 API 設定不完整",
      message: "富邦新一代 SDK 需要身分證字號、登入密碼、憑證檔路徑與憑證密碼。",
      requestedCodes,
      quoteCount: 0,
      realtimeCount: 0,
      fallbackCount: 0,
      quotes: [],
    });
  }

  let officialReference = null;
  try {
    officialReference = await getQuotes(requestedCodes);
  } catch {
    officialReference = null;
  }
  const fallbackByCode = new Map((officialReference?.quotes || []).map((quote) => [quote.code, quote]));

  try {
    const stockClient = await getFubonStockClient(credentials, auth.user.id, saved?.updatedAt || "");
    const warnings = [];
    const quotes = [];
    for (const code of requestedCodes) {
      try {
        const rawQuote = await withPromiseTimeout(stockClient.intraday.quote({ symbol: code }), 8000, `${code} 富邦行情`);
        const quote = normalizeFubonQuote(rawQuote, fallbackByCode.get(code));
        if (Number.isFinite(quote.price)) quotes.push(quote);
        else warnings.push(`${code}: 券商與官方來源皆無有效價格`);
      } catch (error) {
        warnings.push(`${code}: ${error.message}`);
      }
    }
    if (!quotes.length) {
      await closeFubonClient(auth.user.id);
      return brokerUnavailable({
        status: "broker_error",
        configured: true,
        available: false,
        error: "富邦行情讀取失敗",
        message: "富邦行情讀取失敗，前端應切回官方資料。",
        requestedCodes,
        quoteCount: 0,
        realtimeCount: 0,
        fallbackCount: 0,
        warnings,
        quotes: [],
      });
    }
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      sourceKey: "broker",
      sourceLabel: dataSourceLabels.broker,
      requestedCodes,
      quoteCount: quotes.length,
      source: "Fubon Neo market data",
      realtimeCount: quotes.filter((quote) => quote.sourceKind === "broker-realtime" && quote.priceStale !== true).length,
      fallbackCount: quotes.filter((quote) => quote.sourceKind !== "broker-realtime" || quote.priceStale === true).length,
      warnings: unique([...(officialReference?.warnings || []), ...warnings]),
      broker: safeBrokerCredentialStatus(credentials, saved),
      notes: [
        "Fubon provider uses market-data quote endpoint only.",
        "No order, account, position, inventory, or accounting APIs are called.",
      ],
      quotes,
    };
  } catch (error) {
    return brokerUnavailable({
      status: "broker_error",
      configured: true,
      available: false,
      error: "富邦行情初始化失敗",
      message: "富邦 SDK 登入或即時行情初始化失敗，前端應切回官方資料。",
      requestedCodes,
      quoteCount: 0,
      realtimeCount: 0,
      fallbackCount: 0,
      warnings: [error.message],
      quotes: [],
    });
  }
}

async function getConfiguredBrokerMarketSummary(auth) {
  if (!auth?.user) {
    return brokerUnavailable({
      status: "auth_required",
      error: "需要先登入",
      message: "券商資料需要登入後讀取個人 API 設定。",
      markets: {},
    });
  }
  const { credentials, saved } = await getUserBrokerCredentials(auth.user.id);
  if (!credentials) {
    return brokerUnavailable({
      status: saved?.decryptError ? "credential_error" : "not_configured",
      error: saved?.decryptError ? "券商 API 設定無法解密，請重新設定。" : "券商 API 未設定",
      message: saved?.decryptError ? "券商設定使用的主密鑰可能已變更。" : "尚未設定富邦新一代 API。",
      markets: {},
      warnings: ["券商市場指數尚未啟用，未設定時不產生假資料。"],
    });
  }

  const official = await getMarketSummary();
  return {
    ...official,
    sourceKey: "broker",
    sourceLabel: dataSourceLabels.broker,
    source: "Fubon Neo market data + official index fallback",
    broker: safeBrokerCredentialStatus(credentials, saved),
    warnings: [
      ...(official.warnings || []),
      "第一版券商模式的市場指數先沿用官方指數 fallback，個股報價才使用富邦行情。",
    ],
  };
}

async function getBrokerTestQuote(auth, code = "2330") {
  return getConfiguredBrokerQuotes([code], auth);
}

async function getBrokerSettingsStatus(userId) {
  const { credentials, saved } = await getUserBrokerCredentials(userId);
  if (!credentials) {
    return {
      ok: true,
      configured: false,
      provider: "fubon",
      providerLabel: "富邦新一代 API",
      status: saved?.decryptError ? "credential_error" : "not_configured",
      error: saved?.decryptError || "",
      updatedAt: saved?.updatedAt || "",
    };
  }
  return {
    ok: true,
    status: "configured",
    ...safeBrokerCredentialStatus(credentials, saved),
  };
}

async function saveBrokerSettings(auth, input) {
  const provider = input.provider === "fubon" ? "fubon" : "fubon";
  const credentials = {
    provider,
    personalId: String(input.personalId || "").trim(),
    password: String(input.password || ""),
    certPath: String(input.certPath || "").trim(),
    certPassword: String(input.certPassword || ""),
    apiKey: String(input.apiKey || "").trim(),
    apiSecret: String(input.apiSecret || ""),
  };
  if (!credentials.personalId || !credentials.password || !credentials.certPath || !credentials.certPassword) {
    throw new Error("富邦 API 設定不完整：需要身分證字號、登入密碼、憑證檔路徑與憑證密碼。");
  }

  const now = new Date().toISOString();
  const userId = await commitDbMutation((db) => {
    const { user: currentUser } = requireCurrentMutationAuth(db, auth);
    db.brokerCredentials ||= {};
    db.brokerCredentials[currentUser.id] = {
      provider,
      encrypted: encryptJson(credentials),
      updatedAt: now,
    };
    return currentUser.id;
  });
  await closeFubonClient(userId);
  return getBrokerSettingsStatus(userId);
}

async function deleteBrokerSettings(auth) {
  const userId = await commitDbMutation((db) => {
    const { user: currentUser } = requireCurrentMutationAuth(db, auth);
    db.brokerCredentials ||= {};
    delete db.brokerCredentials[currentUser.id];
    return currentUser.id;
  });
  await closeFubonClient(userId);
  return getBrokerSettingsStatus(userId);
}

async function buildSourceStatus(auth) {
  const brokerStatus = auth?.user
    ? await getBrokerSettingsStatus(auth.user.id)
    : { configured: false, status: "auth_required" };
  const brokerConfigured = Boolean(brokerStatus.configured);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    defaultSource: "official",
    selectedFallback: brokerConfigured ? "" : "official",
    sources: {
      official: {
        key: "official",
        label: "官方資料",
        configured: true,
        available: true,
        status: "ready",
        refreshSeconds: 10,
        description: "TWSE MIS 即時/收盤報價，搭配 TWSE/TPEx 官方收盤與歷史資料。",
      },
      broker: {
        key: "broker",
        label: "券商資料",
        configured: brokerConfigured,
        available: brokerConfigured,
        status: brokerStatus.status || (brokerConfigured ? "configured" : "not_configured"),
        refreshSeconds: 10,
        provider: brokerStatus.provider || "fubon",
        providerLabel: brokerStatus.providerLabel || "富邦新一代 API",
        description: brokerConfigured
          ? "已設定富邦新一代 API；只讀取行情，不接下單、庫存或帳務。"
          : "尚未設定富邦 API。切到券商資料時會自動回官方資料，避免誤會。",
        message: brokerConfigured ? "券商 API 已設定" : "券商 API 未設定",
        updatedAt: brokerStatus.updatedAt || "",
      },
    },
  };
}

const dataProviders = {
  official: {
    key: "official",
    label: dataSourceLabels.official,
    configured: true,
    available: true,
    status: "ready",
    getQuotes,
    getMarkets: getMarketSummary,
  },
  broker: {
    key: "broker",
    label: dataSourceLabels.broker,
    configured: false,
    available: false,
    status: "not_configured",
    getQuotes: getConfiguredBrokerQuotes,
    getMarkets: getConfiguredBrokerMarketSummary,
  },
};

function getDataProvider(source) {
  return dataProviders[normalizeDataSource(source)];
}

function normalizeTwseInstitutionalRow(row, dateCompact) {
  return {
    code: cleanCode(row[0]),
    name: String(row[1] || "").trim(),
    exchange: "TWSE",
    source: "TWSE T86",
    sourceKind: "institutional",
    asOf: compactToSlashDate(dateCompact),
    unit: "shares",
    foreignBuy: parseNumber(row[2]),
    foreignSell: parseNumber(row[3]),
    foreignNet: parseNumber(row[4]),
    foreignDealerBuy: parseNumber(row[5]),
    foreignDealerSell: parseNumber(row[6]),
    foreignDealerNet: parseNumber(row[7]),
    trustBuy: parseNumber(row[8]),
    trustSell: parseNumber(row[9]),
    trustNet: parseNumber(row[10]),
    dealerNet: parseNumber(row[11]),
    dealerProprietaryBuy: parseNumber(row[12]),
    dealerProprietarySell: parseNumber(row[13]),
    dealerProprietaryNet: parseNumber(row[14]),
    dealerHedgeBuy: parseNumber(row[15]),
    dealerHedgeSell: parseNumber(row[16]),
    dealerHedgeNet: parseNumber(row[17]),
    totalNet: parseNumber(row[18]),
  };
}

function normalizeTpexInstitutionalRow(row, dateCompact) {
  return {
    code: cleanCode(row[0]),
    name: String(row[1] || "").trim(),
    exchange: "TPEx",
    source: "TPEx 三大法人買賣明細",
    sourceKind: "institutional",
    asOf: compactToSlashDate(dateCompact),
    unit: "shares",
    foreignBuy: parseNumber(row[2]),
    foreignSell: parseNumber(row[3]),
    foreignNet: parseNumber(row[4]),
    foreignDealerBuy: parseNumber(row[5]),
    foreignDealerSell: parseNumber(row[6]),
    foreignDealerNet: parseNumber(row[7]),
    foreignTotalBuy: parseNumber(row[8]),
    foreignTotalSell: parseNumber(row[9]),
    foreignTotalNet: parseNumber(row[10]),
    trustBuy: parseNumber(row[11]),
    trustSell: parseNumber(row[12]),
    trustNet: parseNumber(row[13]),
    dealerProprietaryBuy: parseNumber(row[14]),
    dealerProprietarySell: parseNumber(row[15]),
    dealerProprietaryNet: parseNumber(row[16]),
    dealerHedgeBuy: parseNumber(row[17]),
    dealerHedgeSell: parseNumber(row[18]),
    dealerHedgeNet: parseNumber(row[19]),
    dealerBuy: parseNumber(row[20]),
    dealerSell: parseNumber(row[21]),
    dealerNet: parseNumber(row[22]),
    totalNet: parseNumber(row[23]),
  };
}

async function fetchTwseInstitutional(dateCompact) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateCompact}&selectType=ALLBUT0999&response=json`;
  const payload = await fetchJson(url, {
    headers: {
      referer: "https://www.twse.com.tw/zh/trading/foreign/t86.html",
    },
  });
  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (payload.stat !== "OK" || !rows.length) {
    throw new Error(payload.stat || "TWSE T86 payload is empty");
  }
  return rows
    .map((row) => normalizeTwseInstitutionalRow(row, payload.date || dateCompact))
    .filter((row) => row.code);
}

async function fetchTpexInstitutional(dateCompact) {
  const rocDate = encodeURIComponent(compactToRocSlashDate(dateCompact));
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${rocDate}&s=0,asc`;
  const payload = await fetchJson(url, {
    headers: {
      referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/detail/day.html",
    },
  });
  const table = Array.isArray(payload.tables) ? payload.tables[0] : null;
  const rows = Array.isArray(table?.data) ? table.data : [];
  if (!rows.length) throw new Error("TPEx institutional payload is empty");
  const tableDate = table?.date ? toCompactDate(table.date) || dateCompact : dateCompact;
  return rows
    .map((row) => normalizeTpexInstitutionalRow(row, tableDate))
    .filter((row) => row.code);
}

async function fetchInstitutionalForDate(queryDate) {
  const warnings = [];
  const [twseResult, tpexResult] = await Promise.allSettled([
    fetchTwseInstitutional(queryDate),
    fetchTpexInstitutional(queryDate),
  ]);
  const rows = [];
  if (twseResult.status === "fulfilled") {
    rows.push(...twseResult.value);
  } else {
    warnings.push(`TWSE 三大法人抓取失敗：${twseResult.reason.message}`);
  }
  if (tpexResult.status === "fulfilled") {
    rows.push(...tpexResult.value);
  } else {
    warnings.push(`TPEx 三大法人抓取失敗：${tpexResult.reason.message}`);
  }
  return { rows, warnings };
}

async function getInstitutionalData({ codes = defaultCodes, dateCompact = "" } = {}) {
  const requestedDate = toCompactDate(dateCompact) || toTaipeiCompactDate();
  const cleanCodes = unique((codes || defaultCodes).map(cleanCode)).filter(Boolean);
  const now = Date.now();
  const cached = institutionalCache.get(requestedDate);
  if (cached && cached.expiresAt > now) {
    const records = Object.fromEntries(
      Object.entries(cached.records).filter(([code]) => !cleanCodes.length || cleanCodes.includes(code))
    );
    return { ...cached.body, records, recordCount: Object.keys(records).length };
  }

  let task = institutionalInFlight.get(requestedDate);
  if (!task) {
    task = (async () => {
      // 官方明細收盤後才公布；盤中或假日查不到當天時，往前找最近一個有資料的交易日。
      let usedDate = requestedDate;
      let rows = [];
      let warnings = [];
      for (let offset = 0; offset <= 6; offset += 1) {
        const tryDate = addDaysCompact(requestedDate, -offset);
        const result = await fetchInstitutionalForDate(tryDate);
        if (result.rows.length) {
          usedDate = tryDate;
          rows = result.rows;
          warnings = result.warnings;
          if (offset > 0) warnings.push(`${compactToSlashDate(requestedDate)} 官方明細尚未公布，已改用 ${compactToSlashDate(tryDate)} 的資料。`);
          break;
        }
        warnings = result.warnings;
      }
      const allRecords = Object.fromEntries(rows.map((row) => [row.code, row]));
      const body = {
        ok: rows.length > 0,
        generatedAt: new Date().toISOString(),
        date: compactToIsoDate(usedDate),
        requestedDate: compactToIsoDate(requestedDate),
        source: "TWSE T86 + TPEx 三大法人買賣明細",
        totalCount: rows.length,
        warnings,
      };
      const entry = { expiresAt: Date.now() + 5 * 60 * 1000, records: allRecords, body };
      setBoundedDateCache(institutionalCache, requestedDate, entry);
      return entry;
    })().finally(() => institutionalInFlight.delete(requestedDate));
    institutionalInFlight.set(requestedDate, task);
  }
  const loaded = await task;
  const records = Object.fromEntries(
    Object.entries(loaded.records).filter(([code]) => !cleanCodes.length || cleanCodes.includes(code))
  );
  return { ...loaded.body, records, recordCount: Object.keys(records).length };
}

function normalizeTwseMarginRow(row, dateCompact) {
  const marginBalance = parseNumber(row[6]);
  const marginPrev = parseNumber(row[5]);
  const marginLimit = parseNumber(row[7]);
  const shortBalance = parseNumber(row[12]);
  const shortPrev = parseNumber(row[11]);
  return {
    code: cleanCode(row[0]),
    name: String(row[1] || "").trim(),
    exchange: "TWSE",
    source: "TWSE MI_MARGN",
    asOf: compactToSlashDate(dateCompact),
    unit: "lots",
    marginBalance,
    marginChange: marginBalance !== null && marginPrev !== null ? marginBalance - marginPrev : null,
    marginUsagePct: pct(marginBalance, marginLimit),
    shortBalance,
    shortChange: shortBalance !== null && shortPrev !== null ? shortBalance - shortPrev : null,
    shortMarginRatio: pct(shortBalance, marginBalance),
  };
}

function normalizeTpexMarginRow(row, dateCompact) {
  const marginBalance = parseNumber(row[6]);
  const marginPrev = parseNumber(row[2]);
  const shortBalance = parseNumber(row[14]);
  const shortPrev = parseNumber(row[10]);
  return {
    code: cleanCode(row[0]),
    name: String(row[1] || "").trim(),
    exchange: "TPEx",
    source: "TPEx 融資融券餘額",
    asOf: compactToSlashDate(dateCompact),
    unit: "lots",
    marginBalance,
    marginChange: marginBalance !== null && marginPrev !== null ? marginBalance - marginPrev : null,
    marginUsagePct: parsePercentNumber(row[8]),
    shortBalance,
    shortChange: shortBalance !== null && shortPrev !== null ? shortBalance - shortPrev : null,
    shortMarginRatio: pct(shortBalance, marginBalance),
  };
}

async function fetchMarginForDate(dateCompact) {
  const warnings = [];
  const [twseResult, tpexResult] = await Promise.allSettled([
    fetchJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${dateCompact}&selectType=ALL&response=json`, {
      headers: { referer: "https://www.twse.com.tw/zh/trading/margin/mi-margn.html" },
    }).then((payload) => {
      if (payload.stat !== "OK") throw new Error(payload.stat || "TWSE MI_MARGN payload is empty");
      const table = (payload.tables || []).find((item) => Array.isArray(item.data) && item.data.length > 50) || payload.tables?.[1];
      return Array.isArray(table?.data) ? table.data.map((row) => normalizeTwseMarginRow(row, dateCompact)) : [];
    }),
    fetchJson(`https://www.tpex.org.tw/www/zh-tw/margin/balance?date=${compactToSlashDate(dateCompact)}&response=json`, {
      headers: { referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/margin-trading/transactions.html" },
    }).then((payload) => {
      const table = Array.isArray(payload.tables) ? payload.tables[0] : null;
      const rows = Array.isArray(table?.data) ? table.data : [];
      if (!rows.length) throw new Error("TPEx margin payload is empty");
      return rows.map((row) => normalizeTpexMarginRow(row, dateCompact));
    }),
  ]);
  const rows = [];
  if (twseResult.status === "fulfilled") {
    rows.push(...twseResult.value);
  } else {
    warnings.push(`TWSE 融資券抓取失敗：${twseResult.reason.message}`);
  }
  if (tpexResult.status === "fulfilled") {
    rows.push(...tpexResult.value);
  } else {
    warnings.push(`TPEx 融資券抓取失敗：${tpexResult.reason.message}`);
  }
  return { rows: rows.filter((row) => row.code), warnings };
}

async function getMarginData({ codes = defaultCodes, dateCompact = "" } = {}) {
  const requestedDate = toCompactDate(dateCompact) || toTaipeiCompactDate();
  const cleanCodes = unique((codes || defaultCodes).map(cleanCode)).filter(Boolean);
  const now = Date.now();
  const cached = marginCache.get(requestedDate);
  if (cached && cached.expiresAt > now) {
    const records = Object.fromEntries(
      Object.entries(cached.records).filter(([code]) => !cleanCodes.length || cleanCodes.includes(code))
    );
    return { ...cached.body, records, recordCount: Object.keys(records).length };
  }

  let task = marginInFlight.get(requestedDate);
  if (!task) {
    task = (async () => {
      // 融資券餘額也是收盤後才公布，查不到當天就往前找最近一個交易日。
      let usedDate = requestedDate;
      let rows = [];
      let warnings = [];
      for (let offset = 0; offset <= 6; offset += 1) {
        const tryDate = addDaysCompact(requestedDate, -offset);
        const result = await fetchMarginForDate(tryDate);
        if (result.rows.length) {
          usedDate = tryDate;
          rows = result.rows;
          warnings = result.warnings;
          if (offset > 0) warnings.push(`${compactToSlashDate(requestedDate)} 融資券尚未公布，已改用 ${compactToSlashDate(tryDate)} 的資料。`);
          break;
        }
        warnings = result.warnings;
      }
      const allRecords = Object.fromEntries(rows.map((row) => [row.code, row]));
      const body = {
        ok: rows.length > 0,
        generatedAt: new Date().toISOString(),
        date: compactToIsoDate(usedDate),
        requestedDate: compactToIsoDate(requestedDate),
        source: "TWSE MI_MARGN + TPEx 融資融券餘額",
        totalCount: rows.length,
        warnings,
      };
      const entry = { expiresAt: Date.now() + 10 * 60 * 1000, records: allRecords, body };
      setBoundedDateCache(marginCache, requestedDate, entry);
      return entry;
    })().finally(() => marginInFlight.delete(requestedDate));
    marginInFlight.set(requestedDate, task);
  }
  const loaded = await task;
  const records = Object.fromEntries(
    Object.entries(loaded.records).filter(([code]) => !cleanCodes.length || cleanCodes.includes(code))
  );
  return { ...loaded.body, records, recordCount: Object.keys(records).length };
}

function computeMetrics(history) {
  if (history.length < 21) return null;
  const today = history.at(-1);
  const previousRows = history.slice(0, -1);
  const previous = previousRows.at(-1);
  if (!today || !previous || !today.close || !previous.close) return null;

  const last5 = history.slice(-5);
  const last20 = history.slice(-20);
  const previous5 = previousRows.slice(-5);
  const previous20 = previousRows.slice(-20);
  const ma5 = average(last5.map((row) => row.close));
  const ma20 = average(last20.map((row) => row.close));
  const avgVol5 = average(previous5.map((row) => row.volumeLots));
  const avgVol20 = average(previous20.map((row) => row.volumeLots));
  const changePct = pct(today.close - previous.close, previous.close);
  const amplitudePct = pct(today.high - today.low, previous.close);
  const closePosition = today.high === today.low ? 1 : (today.close - today.low) / (today.high - today.low);
  const volumeRatio5 = avgVol5 ? today.volumeLots / avgVol5 : null;
  const volumeRatio20 = avgVol20 ? today.volumeLots / avgVol20 : null;
  const turnover = null;

  return {
    date: today.date,
    code: today.code,
    name: today.name,
    exchange: today.exchange,
    source: today.source,
    open: today.open,
    high: today.high,
    low: today.low,
    close: today.close,
    previousClose: previous.close,
    change: today.close - previous.close,
    changePct,
    volumeLots: today.volumeLots,
    tradeValue: today.tradeValue,
    transactions: today.transactions,
    ma5,
    ma20,
    avgVol5,
    avgVol20,
    volumeRatio5,
    volumeRatio20,
    closePosition,
    amplitudePct,
    turnover,
  };
}

function scoreStrong(metrics) {
  let score = 0;
  score += Math.min(35, (metrics.changePct - 3) * 7);
  score += Math.min(25, (metrics.volumeRatio5 - 1.5) * 12);
  score += Math.min(20, metrics.closePosition * 20);
  score += metrics.close > metrics.ma5 ? 10 : 0;
  score += metrics.close > metrics.ma20 ? 10 : 0;
  return Math.round(Math.max(0, score));
}

function scoreDanger(metrics) {
  let score = 0;
  score += Math.min(30, Math.max(metrics.changePct, 0) * 4);
  score += Math.min(30, metrics.volumeRatio5 * 8);
  score += Math.min(20, metrics.amplitudePct * 2);
  score += metrics.closePosition < 0.55 ? 15 : 0;
  score += metrics.volumeRatio5 >= 5 ? 10 : 0;
  return Math.round(Math.max(0, score));
}

function scoreReversal(metrics) {
  let score = 0;
  score += Math.min(20, Math.max(metrics.changePct, 0) * 5);
  score += metrics.close > metrics.open ? 18 : 0;
  score += Math.min(22, metrics.closePosition * 22);
  score += metrics.close > metrics.ma5 ? 20 : 0;
  score += metrics.close > metrics.ma20 ? 15 : 0;
  score += Math.min(15, metrics.volumeRatio5 * 6);
  return Math.round(Math.max(0, score));
}

function buildRiskTags(metrics) {
  const tags = [];
  // 「查不到成交值」和「成交值真的很低」是兩件事，不能都叫低流動性——舊寫法用 falsy 判斷，
  // 當日 K 缺 tradeValue 時整份清單每一檔都會掛低流動性，標籤變雜訊、真正的警示跟著失效。
  if (!Number.isFinite(metrics.tradeValue)) tags.push("成交值未知");
  else if (metrics.tradeValue < 30_000_000) tags.push("低流動性");
  if (metrics.volumeRatio5 >= 5) tags.push("爆量過熱");
  if (metrics.amplitudePct >= 8) tags.push("高振幅");
  if (metrics.closePosition < 0.45) tags.push("收盤轉弱");
  if (metrics.turnover === null) tags.push("週轉率N/A");
  return tags;
}

function buildReasons(metrics, group) {
  const reasons = [];
  if (group === "strongContinuation") {
    reasons.push(`漲幅 ${metrics.changePct.toFixed(2)}%`);
    reasons.push(`量比5 ${metrics.volumeRatio5.toFixed(2)}`);
    reasons.push(`收盤位置 ${(metrics.closePosition * 100).toFixed(0)}%`);
    reasons.push("站上 MA5/MA20");
  }
  if (group === "volumeDanger") {
    reasons.push(`量比5 ${metrics.volumeRatio5.toFixed(2)}`);
    reasons.push(`振幅 ${metrics.amplitudePct.toFixed(2)}%`);
    reasons.push(metrics.closePosition < 0.55 ? "收盤位置偏低" : "爆量過熱");
  }
  if (group === "pullbackReversal") {
    reasons.push(`漲幅 ${metrics.changePct.toFixed(2)}%`);
    reasons.push("收紅K");
    reasons.push(`收盤位置 ${(metrics.closePosition * 100).toFixed(0)}%`);
    reasons.push(metrics.close > metrics.ma5 ? "站回 MA5" : "守住 MA20");
  }
  return reasons;
}

function evaluateGroups(metrics) {
  const groups = [];
  const commonOk = [metrics.changePct, metrics.volumeRatio5, metrics.volumeRatio20, metrics.closePosition, metrics.ma5, metrics.ma20, metrics.amplitudePct]
    .every((value) => Number.isFinite(value));
  if (!commonOk) return groups;

  if (
    metrics.changePct >= 3 &&
    metrics.changePct <= 9.5 &&
    metrics.volumeRatio5 >= 1.5 &&
    metrics.closePosition >= 0.7 &&
    metrics.close > metrics.ma5 &&
    metrics.close > metrics.ma20
  ) {
    groups.push({
      group: "strongContinuation",
      groupName: "強勢續攻",
      score: scoreStrong(metrics),
      reasons: buildReasons(metrics, "strongContinuation"),
    });
  }

  if (
    (metrics.changePct >= 5 || metrics.amplitudePct >= 6) &&
    metrics.volumeRatio5 >= 3 &&
    (metrics.closePosition < 0.55 || metrics.volumeRatio5 >= 5 || metrics.amplitudePct >= 9)
  ) {
    groups.push({
      group: "volumeDanger",
      groupName: "爆量高危",
      score: scoreDanger(metrics),
      reasons: buildReasons(metrics, "volumeDanger"),
    });
  }

  if (
    metrics.changePct >= 0 &&
    metrics.changePct <= 5 &&
    metrics.close > metrics.open &&
    metrics.closePosition >= 0.65 &&
    (metrics.close > metrics.ma5 || metrics.close > metrics.ma20)
  ) {
    groups.push({
      group: "pullbackReversal",
      groupName: "回檔轉強",
      score: scoreReversal(metrics),
      reasons: buildReasons(metrics, "pullbackReversal"),
    });
  }
  return groups;
}

function summarizeRecentBacktest(history, group, days = 30) {
  const performances = [];
  const startIndex = Math.max(20, history.length - days - 1);
  for (let index = startIndex; index < history.length - 1; index += 1) {
    const metrics = computeMetrics(history.slice(0, index + 1));
    if (!metrics) continue;
    if (!evaluateGroups(metrics).some((item) => item.group === group)) continue;
    const performance = nextDayPerformance(history, index);
    if (performance) performances.push(performance);
  }
  if (!performances.length) {
    return {
      sampleSize: 0,
      hitPlus2Rate: null,
      avgOpenReturn: null,
      avgHighReturn: null,
      avgCloseReturn: null,
      brokeMinus2Rate: null,
    };
  }
  return {
    sampleSize: performances.length,
    hitPlus2Rate: performances.filter((item) => item.hitPlus2).length / performances.length,
    avgOpenReturn: average(performances.map((item) => item.openReturn)),
    avgHighReturn: average(performances.map((item) => item.highReturn)),
    avgCloseReturn: average(performances.map((item) => item.closeReturn)),
    avgCloseReturnNet: netReturnPct(average(performances.map((item) => item.closeReturn))),
    brokeMinus2Rate: performances.filter((item) => item.brokeMinus2).length / performances.length,
  };
}

function buildPick(metrics, groupInfo, nextDay = null, recentBacktest = null) {
  return {
    code: metrics.code,
    name: metrics.name,
    exchange: metrics.exchange,
    group: groupInfo.group,
    groupName: groupInfo.groupName,
    score: groupInfo.score,
    reasons: groupInfo.reasons,
    riskTags: buildRiskTags(metrics),
    source: metrics.source,
    asOf: metrics.date,
    price: metrics.close,
    changePct: metrics.changePct,
    volumeLots: metrics.volumeLots,
    metrics: {
      volumeRatio5: metrics.volumeRatio5,
      volumeRatio20: metrics.volumeRatio20,
      closePosition: metrics.closePosition,
      ma5: metrics.ma5,
      ma20: metrics.ma20,
      amplitudePct: metrics.amplitudePct,
      turnover: metrics.turnover,
    },
    nextDayPerformance: nextDay,
    recentBacktest,
  };
}

// 隔日沖候選池的絕對成交量下限（D-33，2026-07-26 使用者拍板）。
// 為什麼需要：排序權重是 |漲跌%| × log10(量+10)，量那一項的值域只有 1~5，壓不過 0~10 的
// 漲幅項——冷門股靠「相對爆量」很容易擠進 260 檔，而候選池有上限，它們會**擠掉**流動性
// 好的股票。實測基準日 2026-07-24：6103 合邦整天成交 5 張（17 萬元）拿到 78 分登上強勢續攻。
// 門檻刻意設得低（波段是 500 張）：只擋「真的買不到」的，其餘維持「低流動性」標籤讓使用者
// 自己判斷，與注意／處置股「顯示＋標示」的政策一致。實測 260 檔候選池擋掉 12 檔、上板少 3 檔。
const OVERNIGHT_MIN_VOLUME_LOTS = 100;
function preselectQuotes(reference, riskSets, dateCompact, maxCandidates = 260) {
  // 注意/處置股不再剔除，改在 pick 上標示（前端可切換隱藏）。
  // 停牌/下市股則硬排除：掛單也不會成交，出現在清單只會誤導。
  return [...reference.byCode.values()]
    .filter(isOrdinaryStock)
    .filter((quote) => !riskSets?.halted?.has(quote.code) && !riskSets?.delisted?.has(quote.code))
    .filter((quote) => !dateCompact || toCompactDate(quote.asOf || quote.rawDate) === dateCompact)
    .filter((quote) => Number.isFinite(quote.price) && Number.isFinite(quote.previousClose))
    .filter((quote) => (Number(quote.volumeLots) || 0) >= OVERNIGHT_MIN_VOLUME_LOTS)
    .map((quote) => {
      const changePct = pct(quote.price - quote.previousClose, quote.previousClose) || 0;
      const amplitudePct = pct((quote.high || quote.price) - (quote.low || quote.price), quote.previousClose) || 0;
      const momentumValue = Math.abs(changePct) * Math.log10((quote.volumeLots || 0) + 10);
      return { quote, changePct, amplitudePct, momentumValue };
    })
    .filter((item) => item.changePct >= 0 || item.amplitudePct >= 5.5)
    .sort((a, b) => b.momentumValue - a.momentumValue)
    .slice(0, maxCandidates)
    .map((item) => item.quote);
}

function groupPicks(picks, maxPerGroup = 20) {
  const groups = {
    strongContinuation: [],
    volumeDanger: [],
    pullbackReversal: [],
  };
  for (const pick of picks) {
    groups[pick.group].push(pick);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.score - a.score || (b.changePct || 0) - (a.changePct || 0));
    groups[key] = groups[key].slice(0, maxPerGroup);
  }
  return groups;
}

// v2：訊號判定改吃還原權息後的序列（D-02）。門檻一個都沒動，但除權息當天的漲跌幅與
// 均線基準變了，會改變哪些股票入選，所以舊快照不可與新快照混進同一個分母。
// v3：候選池加上絕對成交量下限 OVERNIGHT_MIN_VOLUME_LOTS（D-33）。
const OVERNIGHT_FORMULA_VERSION = "overnight-v3-liquidity-floor";
// 2026-07-13 前的快照尚未存 formulaVersion；當時只有這一版公式。
// 這個常數刻意與 current 分開，未來升版時不可把缺欄位舊資料誤認成新版。
const LEGACY_OVERNIGHT_FORMULA_VERSION = "overnight-v1-aggressive-controlled";
const OVERNIGHT_SNAPSHOT_LIMIT = 15;

function overnightSnapshotFormulaVersion(snapshot) {
  return String(snapshot?.formulaVersion || LEGACY_OVERNIGHT_FORMULA_VERSION);
}

async function buildOvernightSignalsUncached({
  dateCompact = "", maxPerGroup = 20, maxCandidates = 260, persistSnapshot = true,
  reference, latestDate,
} = {}) {
  const riskSets = await getRiskSets(latestDate);

  // 上市與上櫃的整批收盤檔更新時間不同（傍晚常出現上櫃已更新、上市還是前一日）。
  // 落後的市場會被日期過濾掉，清單只剩半個市場——必須明確警示，避免誤判「今天訊號特別少」。
  const exchangeLatest = new Map();
  for (const quote of reference.byCode.values()) {
    const quoteDate = toCompactDate(quote.asOf || quote.rawDate);
    if (!quoteDate) continue;
    if (quoteDate > (exchangeLatest.get(quote.exchange) || "")) exchangeLatest.set(quote.exchange, quoteDate);
  }
  const laggingMarkets = [...exchangeLatest.entries()]
    .filter(([, date]) => date < latestDate)
    .map(([exchange]) => (exchange === "TWSE" ? "上市" : "上櫃"));

  const candidates = preselectQuotes(reference, riskSets, latestDate, maxCandidates);
  const companyDirectory = await getCompanyDirectory();
  const issuedShares = companyDirectory.issuedShares;
  // 卡片旁的「近 30 日回測」是歷史統計，必須跑在還原權息後的序列上，
  // 否則除權息當天的機械性跳空會被算成真實跌幅，直接墊高 brokeMinus2Rate、壓低達成率。
  const [, corporateActionCoverage] = await Promise.all([
    loadFundamentalsHistory(),
    // 下面 getStockHistory 開了 fallbackRange "1y"，補齊範圍要跟得上最遠可能退到的月份。
    ensureCorporateActionResults(compactMonthsBefore(latestDate, CORPORATE_ACTION_RESULT_FALLBACK_MONTHS), latestDate),
  ]);
  const unresolvedToday = [];
  const enriched = await mapLimit(candidates, 3, async (quote) => {
    let history = await getStockHistory(quote, latestDate, 4, {
      allowExternalFallback: true,
      fallbackMinRows: 60,
      fallbackRange: "1y",
    });
    history = appendTodayCloseBar(history, quote, latestDate);
    // 訊號判定與歷史統計都跑在還原權息後的序列上（D-02）。
    // 沒還原時 computeMetrics 的「前一根收盤」是除權息**前**的價格，算出來的是一個機械性
    // 跌幅而不是真實漲跌——同一天同一檔因此有兩個漲跌幅：候選池用交易所口徑的
    // quote.previousClose（＝參考價），metrics 用前一根 close。還原後前一根 close 就是官方
    // 參考價，兩個數字終於是同一件事。
    // 今天那一根本身永遠不會被還原：factor 從 1 起算、事件當根在 factor 更新前就寫入，
    // 所以卡片上的開高低收與成交量仍是真實成交數字（pinned in overnight-back-adjust.test）。
    const officialActions = corporateActionHistoryForCode(quote.code, history[0]?.date, history.at(-1)?.date);
    const adjustOptions = { allowHeuristicFallback: isOrdinaryStock(quote) };
    const adjustments = resolveCorporateActionAdjustments(history, officialActions, adjustOptions);
    // 交易所說「今天有事件」但比率算不出來 → 還原不會發生，changePct 就退回機械性跌幅，
    // 而且畫面上毫無跡象。與波段掃描同一條規則：算不出來就不給結論，寧可少一檔。
    // 實測 2026-07-24（260 檔／31,137 根 K）：unresolved 只佔 0.016%，落在訊號日的 0 檔。
    if ((adjustments.unresolvedIndices || []).includes(history.length - 1)) {
      unresolvedToday.push(quote.code);
      return [];
    }
    const adjustedHistory = backAdjustForCorporateActions(history, officialActions, adjustOptions);
    const metrics = computeMetrics(adjustedHistory);
    if (!metrics || toCompactDate(metrics.date) !== latestDate) return [];
    metrics.turnover = computeTurnoverPct(metrics.volumeLots, issuedShares.get(metrics.code) ?? NaN);
    // 訊號日本身就是事件日時，畫面上的漲跌幅是相對參考價算的，要說出來——
    // 使用者對照券商 App 看到的是同一個口徑，但對照「昨天的收盤價」會兜不起來。
    const todayAdjustment = adjustments.get(adjustedHistory.length - 1) || null;
    const basisTag = !todayAdjustment ? "" :
      String(todayAdjustment.source || "").startsWith("heuristic") ? "疑似公司行動・漲跌為估算" : "除權息日・漲跌對參考價";
    // 量比的兩道門檻（強勢續攻 ≥1.5、爆量高危 ≥3）拿的是「今日量 ÷ 前 N 日均量」。配股／現增
    // 會改變股數，事件前的量要按同一個倍數放大才可比；倍數推導不出來時沿用 1，均量偏低、
    // 量比就**偏高**——失效方向是「不該出現的標的出現了」。官方那張表分不出配股與現增
    // （見 D-29），所以只能標示不能修正；20 根是量比視窗的長度。
    const volumeUnknown = (adjustments.shareFactorUnknownIndices || [])
      .some((index) => index >= history.length - 20);
    return evaluateGroups(metrics).map((groupInfo) => {
      const pick = buildPick(metrics, groupInfo, null, summarizeRecentBacktest(adjustedHistory, groupInfo.group, 30));
      if (basisTag) {
        pick.riskTags = [...pick.riskTags, basisTag];
        pick.corporateActionBasis = { source: todayAdjustment.source, referencePrice: metrics.previousClose };
      }
      if (volumeUnknown) pick.riskTags = [...pick.riskTags, "配股比率未公告・量比偏高"];
      return pick;
    });
  });

  const picks = enriched.flat();
  // 注意/處置/變更交易股保留並標示（前端可切換隱藏）。
  for (const pick of picks) pick.surveillance = riskSets.surveillance.get(pick.code) || null;
  const groups = groupPicks(picks, maxPerGroup);
  const body = {
    ok: true,
    generatedAt: new Date().toISOString(),
    asOf: compactToIsoDate(latestDate),
    source: "TWSE/TPEx official close + official history",
    universe: "上市櫃普通股",
    riskPolicy: "注意股、處置股、變更交易改為標示、不再排除（前端可切換隱藏）；低流動性只標示",
    formulaVersion: OVERNIGHT_FORMULA_VERSION,
    candidateCount: candidates.length,
    surveillanceCount: picks.filter((p) => p.surveillance).length,
    provisional: !reference.coverageComplete,
    coverage: {
      complete: Boolean(reference.coverageComplete),
      markets: reference.markets,
    },
    warnings: unique([
      ...(reference.warnings || []),
      ...(companyDirectory.warnings || []),
      ...riskSets.warnings,
      ...(laggingMarkets.length
        ? [`${laggingMarkets.join("、")}的收盤資料尚未更新到 ${compactToSlashDate(latestDate)}，這份清單暫時只涵蓋已更新的市場，稍晚會自動補齊。`]
        : []),
      // 訊號判定與卡片旁的「近 30 日回測」都跑在還原後的序列上（D-02）；來源沒抓齊時，
      // 除權息當天的機械性跳空會被算成真實跌幅，回測百分比偏低、當天的訊號也可能整個跑掉。
      ...(corporateActionCoverage?.degraded
        ? ["官方除權除息計算結果表這一輪有部分月份沒抓到，除權息當天的漲跌幅與近 30 日回測數字可能失真；資料會在下一輪補齊。"]
        : []),
      // 「交易所說有事件、我們算不出比率」的股票被排除了，要說出來——否則使用者只會
      // 發現某一檔今天莫名其妙不見了。
      ...(unresolvedToday.length
        ? [`${unresolvedToday.length} 檔今天有官方公司行動但參考價尚未取得（${unresolvedToday.slice(0, 5).join("、")}${unresolvedToday.length > 5 ? "…" : ""}），這些暫時不列入清單，公告補齊後會自動恢復。`]
        : []),
    ]),
    groups,
  };

  if (!dateCompact && persistSnapshot) {
    await saveSignalSnapshot(body).catch(() => {});
  }
  return body;
}

async function buildOvernightSignals({ dateCompact = "", maxPerGroup = 20, maxCandidates = 260, persistSnapshot = true } = {}) {
  const reference = await getReferenceData();
  const latestDate = dateCompact || [...reference.byCode.values()]
    .map((quote) => toCompactDate(quote.asOf || quote.rawDate))
    .filter(Boolean)
    .sort()
    .at(-1);
  const shouldPersistSnapshot = !dateCompact && persistSnapshot;
  const cacheKey = `${latestDate}:${maxPerGroup}:${maxCandidates}:${shouldPersistSnapshot ? "persist" : "read"}`;
  const cached = getFreshTtlCacheEntry(overnightCache, cacheKey);
  if (cached) return cached.value;
  if (overnightInFlight.has(cacheKey)) return overnightInFlight.get(cacheKey);

  const task = buildOvernightSignalsUncached({
    dateCompact,
    maxPerGroup,
    maxCandidates,
    persistSnapshot,
    reference,
    latestDate,
  }).then((body) => {
    setBoundedDateCache(overnightCache, cacheKey, {
      expiresAt: Date.now() + (reference.coverageComplete ? 5 * 60 * 1000 : REFERENCE_RETRY_MS),
      value: body,
    }, OVERNIGHT_CACHE_MAX_ENTRIES);
    return body;
  }).finally(() => {
    if (overnightInFlight.get(cacheKey) === task) overnightInFlight.delete(cacheKey);
  });
  overnightInFlight.set(cacheKey, task);
  return task;
}

// 每天把隔日沖訊號清單存進資料庫，隔天用真實行情驗證表現。
async function saveSignalSnapshot(body) {
  if (!body?.asOf || !body.groups) return;
  // 半市場、last-good 或兩市場資料日未對齊的結果可以暫時顯示，但不可成為正式前向驗證樣本。
  if (body.provisional || body.coverage?.complete === false) return;
  const picks = Object.values(body.groups)
    .flat()
    .map((pick) => ({
      code: pick.code,
      name: pick.name,
      exchange: pick.exchange,
      group: pick.group,
      groupName: pick.groupName,
      score: pick.score,
      price: pick.price,
      changePct: pick.changePct,
  }));
  if (!picks.length) return;
  const formulaVersion = String(body.formulaVersion || OVERNIGHT_FORMULA_VERSION);
  await commitDbMutation((db) => {
    db.signalSnapshots ||= [];
    const existing = db.signalSnapshots.find((item) => (
      item.asOf === body.asOf && overnightSnapshotFormulaVersion(item) === formulaVersion
    ));
    if (existing) {
      const existingComplete = existing.coverage?.complete !== false;
      const needsVersionMigration = !existing.formulaVersion;
      // 完整覆蓋優先於檔數；同為完整時才以檔數避免較短重算覆蓋較完整清單。
      if (existingComplete && picks.length <= existing.picks.length) {
        if (needsVersionMigration) existing.formulaVersion = LEGACY_OVERNIGHT_FORMULA_VERSION;
        else return skipDbMutation();
        return undefined;
      }
      existing.picks = picks;
      existing.savedAt = new Date().toISOString();
      existing.coverage = body.coverage || { complete: true };
      existing.formulaVersion = formulaVersion;
      return undefined;
    }
    db.signalSnapshots.push({
      asOf: body.asOf,
      savedAt: new Date().toISOString(),
      coverage: body.coverage || { complete: true },
      formulaVersion,
      picks,
    });
    db.signalSnapshots = db.signalSnapshots
      .sort((a, b) => String(a.asOf).localeCompare(String(b.asOf)))
      .slice(-OVERNIGHT_SNAPSHOT_LIMIT);
  });
}

const TRADING_CALENDAR_SOURCES = {
  sessions: {
    label: "證交所實際交易日",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK",
    ttlMs: 5 * 60 * 1000,
    retryMs: 60 * 1000,
  },
  holidays: {
    label: "證交所開休市表",
    url: "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule",
    ttlMs: 24 * 60 * 60 * 1000,
    retryMs: 5 * 60 * 1000,
  },
};
const tradingCalendarSourceCache = {
  sessions: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
  holidays: { value: null, expiresAt: 0, retryAt: 0, lastError: "", inFlight: null },
};
let tradingCalendarCache = { expiresAt: 0, value: null };
let tradingCalendarInFlight = null;

function parseTradingCalendarSource(key, rows) {
  const source = TRADING_CALENDAR_SOURCES[key];
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${source.label}回傳空資料`);
  if (key === "sessions") {
    const tradingDays = unique(rows.map((row) => toCompactDate(row.Date)).filter(Boolean)).sort();
    if (!tradingDays.length) throw new Error(`${source.label}沒有有效日期`);
    return { tradingDays, rows: [], fetchedAt: new Date().toISOString() };
  }
  const holidayRows = rows
    .map((row) => ({
      date: toCompactDate(row.Date),
      name: String(row.Name || "").trim(),
      description: String(row.Description || "").trim(),
    }))
    .filter((row) => row.date);
  if (!holidayRows.length) throw new Error(`${source.label}沒有有效日期`);
  return { tradingDays: [], rows: holidayRows, fetchedAt: new Date().toISOString() };
}

async function loadTradingCalendarSource(key) {
  const source = TRADING_CALENDAR_SOURCES[key];
  return loadWithLastGood(tradingCalendarSourceCache[key], {
    ttlMs: source.ttlMs,
    retryMs: source.retryMs,
    load: async () => parseTradingCalendarSource(key, await fetchJson(source.url)),
  });
}

async function getTradingCalendarEvidence() {
  const now = Date.now();
  if (tradingCalendarCache.value && tradingCalendarCache.expiresAt > now) return tradingCalendarCache.value;
  if (tradingCalendarInFlight) return tradingCalendarInFlight;
  tradingCalendarInFlight = (async () => {
    const [sessions, holidays] = await Promise.all([
      loadTradingCalendarSource("sessions"),
      loadTradingCalendarSource("holidays"),
    ]);
    const warnings = [];
    for (const [key, result] of Object.entries({ sessions, holidays })) {
      const source = TRADING_CALENDAR_SOURCES[key];
      if (result.status === "stale") warnings.push(`${source.label}暫時更新失敗（${result.error}），已沿用最近成功資料。`);
      else if (result.status === "unavailable") warnings.push(`${source.label}抓取失敗（${result.error}），下一交易日將以其餘官方證據保守判定。`);
    }
    const degraded = sessions.status !== "fresh" || holidays.status !== "fresh";
    const finishedAt = Date.now();
    const value = {
      tradingDays: sessions.value?.tradingDays || [],
      holidayRows: holidays.value?.rows || [],
      warnings: unique(warnings),
      degraded,
      sources: {
        sessions: { status: sessions.status, fetchedAt: sessions.value?.fetchedAt || null },
        holidays: { status: holidays.status, fetchedAt: holidays.value?.fetchedAt || null },
      },
    };
    const fullExpiry = Math.min(
      tradingCalendarSourceCache.sessions.expiresAt || finishedAt + TRADING_CALENDAR_SOURCES.sessions.ttlMs,
      tradingCalendarSourceCache.holidays.expiresAt || finishedAt + TRADING_CALENDAR_SOURCES.holidays.ttlMs,
    );
    tradingCalendarCache = {
      expiresAt: degraded ? finishedAt + 60 * 1000 : fullExpiry,
      value,
    };
    return value;
  })().finally(() => {
    tradingCalendarInFlight = null;
  });
  return tradingCalendarInFlight;
}

function isCalendarOpenOverride(row) {
  return /開始交易|最後交易日/.test(`${row?.name || ""}${row?.description || ""}`);
}

function nextScheduledTradingDate(signalDate, holidayRows = []) {
  const signal = toCompactDate(signalDate);
  if (!signal) return "";
  const openOverrides = new Set(holidayRows.filter(isCalendarOpenOverride).map((row) => toCompactDate(row.date)));
  const closures = new Set(holidayRows.filter((row) => !isCalendarOpenOverride(row)).map((row) => toCompactDate(row.date)));
  let day = signal;
  for (let offset = 0; offset < 60; offset += 1) {
    day = addDaysCompact(day, 1);
    const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    if (openOverrides.has(day) || (!weekend && !closures.has(day))) return day;
  }
  return "";
}

function isScheduledTradingDate(dateText, holidayRows = []) {
  const day = toCompactDate(dateText);
  if (!day) return false;
  const openOverrides = new Set(holidayRows.filter(isCalendarOpenOverride).map((row) => toCompactDate(row.date)));
  const closures = new Set(holidayRows.filter((row) => !isCalendarOpenOverride(row)).map((row) => toCompactDate(row.date)));
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  return openOverrides.has(day) || (!weekend && !closures.has(day));
}

function previousScheduledTradingDate(dateText, holidayRows = []) {
  let day = toCompactDate(dateText);
  if (!day) return "";
  for (let offset = 0; offset < 60; offset += 1) {
    day = addDaysCompact(day, -1);
    if (isScheduledTradingDate(day, holidayRows)) return day;
  }
  return "";
}

// 唯一合法觀察日＝訊號日後第一個實際交易日。FMTQIK 能證明時優先；
// 超出當月涵蓋範圍時用官方開休市表，若多檔官方歷史一致顯示臨時休市則以共識修正。
function resolveNextTradingDate(signalDate, { tradingDays = [], holidayRows = [], candidateDays = [] } = {}) {
  const signal = toCompactDate(signalDate);
  if (!signal) return { date: "", source: "", scheduledDate: "" };
  const scheduledDate = nextScheduledTradingDate(signal, holidayRows);
  const official = unique(tradingDays.map(toCompactDate).filter(Boolean)).sort();
  const officialNext = official.find((day) => day > signal) || "";
  const officialMin = official[0] || "";
  const officialMax = official.at(-1) || "";
  const officialCoversScheduled = Boolean(
    scheduledDate && officialNext && officialMin <= scheduledDate && officialMax >= scheduledDate
  );
  if (officialCoversScheduled) {
    return { date: officialNext, source: "TWSE FMTQIK", scheduledDate };
  }

  const candidates = candidateDays.map(toCompactDate).filter((day) => day && day > signal);
  if (scheduledDate && candidates.includes(scheduledDate)) {
    return { date: scheduledDate, source: "TWSE holiday schedule + official history", scheduledDate };
  }
  const counts = new Map();
  for (const day of candidates) counts.set(day, (counts.get(day) || 0) + 1);
  const consensus = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (consensus && consensus[0] > scheduledDate && consensus[1] >= 2 && consensus[1] * 2 >= candidates.length) {
    return { date: consensus[0], source: "official history consensus", scheduledDate };
  }
  return {
    date: scheduledDate || officialNext || consensus?.[0] || "",
    source: scheduledDate ? "TWSE holiday schedule" : officialNext ? "TWSE FMTQIK" : consensus ? "official history consensus" : "",
    scheduledDate,
  };
}

async function getOfficialObservationEvidence(quote, signalDate, observationDate) {
  const signal = toCompactDate(signalDate);
  const observation = toCompactDate(observationDate);
  if (!quote || !signal || !observation) return { status: "missing", bar: null, nextDate: "", source: "" };
  const quoteDate = toCompactDate(quote.rawDate || quote.asOf);
  if (quoteDate === observation && [quote.open, quote.high, quote.low, quote.price].every(Number.isFinite)) {
    return {
      status: "ok",
      bar: {
        date: observation, open: quote.open, high: quote.high, low: quote.low, close: quote.price, current: quote.price,
        // 交易所昨收：除權息／減資當天就是官方參考價，用來把訊號日基準價換算到同一尺度。
        previousClose: quote.previousClose ?? null,
      },
      nextDate: observation,
      source: "TWSE/TPEx official daily close",
      phase: "final",
    };
  }
  if (!quote.exchange) return { status: "missing", bar: null, nextDate: "", source: "" };
  try {
    const rows = await fetchStockHistoryMonth(quote.code, quote.exchange, addMonthsCompact(observation, 0), quote.name);
    const next = rows.find((row) => toCompactDate(row.date) > signal);
    const exact = rows.find((row) => toCompactDate(row.date) === observation);
    if (!exact || ![exact.open, exact.high, exact.low, exact.close].every(Number.isFinite)) {
      return { status: "missing", bar: null, nextDate: next ? toCompactDate(next.date) : "", source: "official monthly history" };
    }
    return {
      status: "ok",
      bar: {
        date: observation, open: exact.open, high: exact.high, low: exact.low, close: exact.close, current: exact.close,
        previousClose: exact.previousClose ?? null,
      },
      nextDate: observation,
      source: exact.source || "official monthly history",
      phase: "final",
    };
  } catch (error) {
    return {
      status: "source_error",
      bar: null,
      nextDate: "",
      source: "official monthly history",
      warning: `${quote.code} ${quote.name || ""} 的觀察日行情抓取失敗：${error.message}`.trim(),
    };
  }
}

// 觀察日若是除權息日，要用實測可靠的來源解出「事件後尺度的基準價」。
// 偵測（歸檔 或 計算結果表有這一筆）與量化（比率／官方參考價）分開，判準與波段驗證一致。
// 正常日子這裡不會多打任何請求：沒有候選就直接回空 Map。
async function resolveObservationActionBases(picks, observationCompact, reference) {
  const bases = new Map();
  if (!observationCompact || !Array.isArray(picks) || !picks.length) return bases;
  // 計算結果表既是量化來源、也是比歸檔更完整的偵測來源（歸檔只從部署後累積），所以先補齊當月。
  // 一次請求涵蓋全市場，且有 24 小時／TTL 快取，成本可忽略。
  await ensureCorporateActionResults(compactMonthsBefore(observationCompact, 1), observationCompact);
  const candidates = unique(picks.map((pick) => pick.code).filter(Boolean)).filter((code) => (
    corporateActionHistoryForCode(code, observationCompact, observationCompact).length > 0
    || corporateActionResultFor(code, observationCompact) !== null
  ));
  if (!candidates.length) return bases;
  await mapLimit(candidates, 4, async (code) => {
    // ① 上市：交易所自己算的比率（實測過去 228 筆事件 228 筆都查得到）。
    const ratio = corporateActionResultRatio(code, observationCompact);
    if (ratio !== null) {
      bases.set(code, { ratio, source: "exchange-result" });
      return;
    }
    // ② 上櫃：沒有 TWT49U 對應端點，改查官方逐檔月歷史——那裡的漲跌欄是相對參考價算出來的
    //    正常數字，close − change 就是官方參考價（實測 5/5）。**整批當日收盤不行**，
    //    它的漲跌欄在事件日是中文字串 `"除息"`／`"除權"`。
    const quote = reference?.byCode?.get(code);
    if (!quote?.exchange) {
      bases.set(code, { unresolved: true });
      return;
    }
    try {
      const rows = await fetchStockHistoryMonth(code, quote.exchange, observationCompact, quote.name);
      const exact = rows.find((row) => toCompactDate(row.date) === observationCompact);
      const exchangePreviousClose = Number(exact?.exchangePreviousClose);
      if (Number.isFinite(exchangePreviousClose) && exchangePreviousClose > 0) {
        bases.set(code, { base: exchangePreviousClose, source: "exchange-quote" });
        return;
      }
    } catch {
      // 抓取失敗與「抓到了但欄位被遮」都算解不出來——都不可以拿原始價當基準。
    }
    bases.set(code, { unresolved: true });
  });
  return bases;
}

async function observeSignalSnapshot(snapshot, { allowIntraday = false, reference = null, calendar = null } = {}) {
  const signalCompact = toCompactDate(snapshot?.asOf);
  const picks = Array.isArray(snapshot?.picks) ? snapshot.picks : [];
  const generatedAt = new Date().toISOString();
  if (!signalCompact || !picks.length) {
    return {
      available: false, status: "pending", generatedAt, signalDate: snapshot?.asOf || "",
      observationDate: "", observationPhase: "", expectedSignals: picks.length,
      verifiedSignals: 0, pendingSignals: picks.length, complete: false, rows: [], warnings: [],
    };
  }
  reference ||= await getReferenceData();
  calendar ||= await getTradingCalendarEvidence();
  const todayCompact = toTaipeiCompactDate();
  let resolution = resolveNextTradingDate(signalCompact, calendar);
  let observationCompact = resolution.date;
  const baseWarnings = unique([...(reference.warnings || []), ...(calendar.warnings || [])]);
  if (!observationCompact || observationCompact > todayCompact) {
    return {
      available: false,
      status: "pending",
      generatedAt,
      signalDate: snapshot.asOf,
      observationDate: observationCompact ? compactToIsoDate(observationCompact) : "",
      observationPhase: "pending",
      expectedSignals: picks.length,
      verifiedSignals: 0,
      pendingSignals: picks.length,
      complete: false,
      rows: picks.map((pick) => ({ ...pick, verified: false })),
      warnings: baseWarnings,
      evidence: { calendarSource: resolution.source || "", priceSources: [] },
    };
  }

  const codes = unique(picks.map((pick) => pick.code));
  let quoteBody = null;
  if (allowIntraday && observationCompact === todayCompact) {
    quoteBody = await getQuotes(codes);
  }
  const liveByCode = new Map((quoteBody?.quotes || []).map((quote) => [quote.code, quote]));
  const pickByCode = new Map();
  for (const pick of picks) if (!pickByCode.has(pick.code)) pickByCode.set(pick.code, pick);

  const collectEvidence = async (dateCompact) => {
    const evidenceByCode = new Map();
    await mapLimit(codes, 3, async (code) => {
      const pick = pickByCode.get(code) || {};
      const live = liveByCode.get(code);
      const descriptor = reference.byCode.get(code) || live || {
        code,
        name: pick.name || code,
        exchange: pick.exchange || "",
      };
      const finalExpected = dateCompact < todayCompact || calendar.tradingDays.includes(dateCompact);
      if (!finalExpected && allowIntraday) {
        const intraday = live?.officialIntraday;
        if (intraday && toCompactDate(intraday.date) === dateCompact) {
          evidenceByCode.set(code, {
            status: "ok",
            bar: {
              date: dateCompact,
              open: intraday.open,
              high: intraday.high,
              low: intraday.low,
              close: intraday.current,
              current: intraday.current,
            },
            nextDate: dateCompact,
            source: "TWSE MIS official intraday",
            phase: "intraday",
          });
          return;
        }
      }
      evidenceByCode.set(code, await getOfficialObservationEvidence(descriptor, signalCompact, dateCompact));
    });
    return evidenceByCode;
  };

  let evidenceByCode = await collectEvidence(observationCompact);
  const candidateDays = [...evidenceByCode.values()].map((evidence) => evidence.nextDate).filter(Boolean);
  const refined = resolveNextTradingDate(signalCompact, { ...calendar, candidateDays });
  if (refined.date && refined.date !== observationCompact && refined.date <= todayCompact) {
    observationCompact = refined.date;
    resolution = refined;
    evidenceByCode = await collectEvidence(observationCompact);
  }

  // 下面判定除權息基準要查官方歸檔，先確保它已載入（未載入時 corporateActionHistoryForCode 只會回空陣列）。
  await loadFundamentalsHistory();
  const actionBaseByCode = await resolveObservationActionBases(picks, observationCompact, reference);
  const evidenceWarnings = [...evidenceByCode.values()].map((evidence) => evidence.warning).filter(Boolean);
  const rows = picks.map((pick) => {
    const evidence = evidenceByCode.get(pick.code);
    const signalClose = Number(pick.price);
    const bar = evidence?.bar;
    if (evidence?.status !== "ok" || !bar || !Number.isFinite(signalClose) || signalClose <= 0) {
      return { ...pick, verified: false, pendingReason: evidence?.status || "missing" };
    }
    // 觀察日若是除權息日，價格會機械性跳空，拿訊號日原始收盤當基準會直接記成大跌
    //（配息 5% 就必然觸發 brokeMinus2）。基準價要換成事件後的同一尺度，報酬才是含息總報酬。
    //
    // **絕不可用 `bar.previousClose`**（2026-07-27 實測 20260724 的 18 筆真實事件）：
    //   整批當日收盤／上市：`Change` 是 `"0.0000"` 哨兵（12/12）→ previousClose ＝ 當日收盤，
    //     基準價會變成「觀察日自己的收盤」，currentReturn 恆為 0、高低報酬改成相對收盤衡量。
    //   整批當日收盤／上櫃：`Change` 是**中文字串** `"除息"`／`"除權"`（6/6）→ parseNumber 回 null
    //     → 換不了基準 → 退回訊號日收盤 → 假大跌（6435 配息 7.5 元／股價 270 → −2.7%，觸發 brokeMinus2）。
    //   逐檔月歷史／上市：漲跌欄被遮成 `"X0.00"` → 同樣是 null → 假大跌。
    // 四種組合裡只有「逐檔月歷史／上櫃」是對的，所以基準改由 resolveObservationActionBases
    // 用兩個實測可靠的來源解（上市 TWT49U 228/228、上櫃逐檔月歷史 5/5）。
    //
    // 偵測仍然先行、且擴大為「歸檔 或 計算結果表有這一筆」——歸檔只從部署後累積，
    // 而 TWT49U 涵蓋全部歷史（D-43 實測抓到台積電／鴻海／中華電等歸檔完全沒有的事件）。
    // 偵測到卻解不出基準時**不給結論**：標 unverified 讓它留在 pending，
    // 寧可少一筆樣本，也不要把假大跌灌進成績單（partial 不污染分母是既有設計）。
    const action = actionBaseByCode.get(pick.code) || null;
    if (action?.unresolved) {
      return { ...pick, verified: false, pendingReason: "corporate-action-unresolved" };
    }
    // 結果表給的是比率（參考價 ÷ 除權息前收盤），乘在快照價上；快照價與官方收盤的正常差異
    // 因此不會被吸進報酬裡。上櫃走逐檔月歷史時拿到的是絕對的官方參考價。
    const base = action
      ? (action.ratio != null ? signalClose * action.ratio : action.base)
      : signalClose;
    const corporateActionAdjusted = Boolean(action)
      && Math.abs(base / signalClose - 1) > CORPORATE_ACTION_RATIO_TOLERANCE;
    const openReturn = pct((bar.open ?? NaN) - base, base);
    const highReturn = pct((bar.high ?? NaN) - base, base);
    const lowReturn = pct((bar.low ?? NaN) - base, base);
    const closeValue = evidence.phase === "intraday" ? bar.current : bar.close;
    const currentReturn = pct((closeValue ?? NaN) - base, base);
    return {
      ...pick,
      verified: true,
      currentPrice: closeValue,
      openReturn,
      highReturn,
      lowReturn,
      currentReturn,
      hitPlus2: highReturn !== null && highReturn >= 2,
      brokeMinus2: lowReturn !== null && lowReturn <= -2,
      observationSource: evidence.source,
      observationPhase: evidence.phase || "final",
      ...(corporateActionAdjusted
        ? { corporateActionAdjusted: true, adjustedBase: roundTo(base), signalClose: roundTo(signalClose) }
        : {}),
    };
  });
  const verifiedRows = rows.filter((row) => row.verified);
  const pendingRows = rows.filter((row) => !row.verified);
  const phase = verifiedRows.some((row) => row.observationPhase === "intraday") ? "intraday" : "final";
  const status = !verifiedRows.length ? "pending" : pendingRows.length ? "partial" : phase;
  const warnings = unique([
    ...baseWarnings,
    ...(quoteBody?.warnings || []),
    ...evidenceWarnings,
    ...(pendingRows.length
      ? [`${compactToSlashDate(observationCompact)} 觀察日目前已驗證 ${verifiedRows.length}/${rows.length} 檔，其餘官方行情待補。`]
      : []),
  ]);
  return {
    available: verifiedRows.length > 0,
    status,
    generatedAt,
    signalDate: snapshot.asOf,
    observationDate: compactToIsoDate(observationCompact),
    observationCompact,
    observationPhase: phase,
    expectedSignals: rows.length,
    verifiedSignals: verifiedRows.length,
    pendingSignals: pendingRows.length,
    complete: pendingRows.length === 0 && phase === "final",
    rows,
    warnings,
    evidence: {
      calendarSource: resolution.source || "",
      scheduledDate: resolution.scheduledDate ? compactToIsoDate(resolution.scheduledDate) : "",
      priceSources: unique(verifiedRows.map((row) => row.observationSource)),
    },
    dataQuality: {
      referenceComplete: Boolean(reference.coverageComplete),
      referenceMarkets: reference.markets,
      calendarDegraded: Boolean(calendar.degraded),
    },
  };
}

// 把每天存下來的訊號快照，逐日對照真實的隔日 OHLC，累積成長期成績單。
async function buildVerificationHistory() {
  const now = Date.now();
  if (verifyHistoryCache.value && verifyHistoryCache.expiresAt > now) {
    return verifyHistoryCache.value;
  }
  const generatedAt = new Date().toISOString();
  const db = await loadDb();
  const allSnapshots = (Array.isArray(db.signalSnapshots) ? db.signalSnapshots : [])
    .slice()
    .sort((a, b) => String(a.asOf).localeCompare(String(b.asOf)));
  const formulaVersions = {};
  for (const snapshot of allSnapshots) {
    const version = overnightSnapshotFormulaVersion(snapshot);
    formulaVersions[version] = (formulaVersions[version] || 0) + 1;
  }
  // 成績單只統計畫面目前使用的公式；舊版保留計數但不可混入分母。
  const snapshots = allSnapshots
    .filter((snapshot) => overnightSnapshotFormulaVersion(snapshot) === OVERNIGHT_FORMULA_VERSION)
    .slice(-OVERNIGHT_SNAPSHOT_LIMIT);
  if (!snapshots.length) {
    return {
      ok: true,
      generatedAt,
      records: [],
      totals: null,
      formulaVersion: OVERNIGHT_FORMULA_VERSION,
      formulaVersions,
      message: "尚未累積訊號快照，每天看一次隔日沖清單就會自動記錄。",
    };
  }
  const [reference, calendar] = await Promise.all([getReferenceData(), getTradingCalendarEvidence()]);
  const observations = [];
  for (const snapshot of snapshots) {
    observations.push(await observeSignalSnapshot(snapshot, { allowIntraday: false, reference, calendar }));
  }
  const records = observations.map((observed, index) => {
    const snapshot = snapshots[index];
    const perfs = observed.rows.filter((row) => row.verified);
    return {
      asOf: snapshot.asOf,
      formulaVersion: overnightSnapshotFormulaVersion(snapshot),
      observationDate: observed.observationDate,
      observationPhase: observed.observationPhase,
      status: observed.status,
      signals: snapshot.picks.length,
      verified: perfs.length,
      unverified: Math.max(0, snapshot.picks.length - perfs.length),
      complete: observed.status === "final" && observed.complete,
      pending: observed.status !== "final",
      hitPlus2: perfs.filter((item) => item.hitPlus2).length,
      brokeMinus2: perfs.filter((item) => item.brokeMinus2).length,
      avgHighReturn: average(perfs.map((item) => item.highReturn)),
      avgCloseReturn: average(perfs.map((item) => item.currentReturn)),
      warnings: observed.warnings,
    };
  });

  // 長期正式統計只納入「觀察日已收盤且全部訊號都完成」的日子；partial 先顯示、不污染分母。
  const done = records.filter((record) => record.complete);
  const verifiedTotal = done.reduce((sum, record) => sum + record.verified, 0);
  const totals = done.length
    ? {
        days: done.length,
        signals: verifiedTotal,
        hitPlus2: done.reduce((sum, record) => sum + record.hitPlus2, 0),
        brokeMinus2: done.reduce((sum, record) => sum + record.brokeMinus2, 0),
        avgCloseReturn: verifiedTotal
          ? done.reduce((sum, record) => sum + (record.avgCloseReturn || 0) * record.verified, 0) / verifiedTotal
          : null,
      }
    : null;

  const body = {
    ok: true,
    generatedAt,
    formulaVersion: OVERNIGHT_FORMULA_VERSION,
    formulaVersions,
    records: [...records].reverse(),
    totals,
    warnings: unique(observations.flatMap((observed) => observed.warnings || [])),
    dataQuality: {
      degraded: Boolean(reference.degraded),
      referenceComplete: Boolean(reference.coverageComplete),
      markets: reference.markets,
    },
    notes: [
      "觀察日依證交所實際交易日／開休市表判定，且只接受日期完全相等的官方 OHLC。",
      "基準＝訊號日收盤；達 +2% 看觀察日最高，破 -2% 看觀察日最低。partial 不納入長期正式統計。",
      `所有百分比預設為未扣費稅的毛報酬；${VERIFY_COST_NOTE}`,
    ],
  };
  const hasPending = records.some((record) => !record.complete);
  verifyHistoryCache = {
    expiresAt: now + (hasPending ? 60 * 1000 : 10 * 60 * 1000),
    value: body,
  };
  return body;
}

async function buildSignalVerification() {
  const generatedAt = new Date().toISOString();
  const db = await loadDb();
  const snapshots = (Array.isArray(db.signalSnapshots) ? db.signalSnapshots : [])
    .filter((snapshot) => overnightSnapshotFormulaVersion(snapshot) === OVERNIGHT_FORMULA_VERSION);
  const todayCompact = toTaipeiCompactDate();
  const snapshot = [...snapshots]
    .sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))
    .find((item) => toCompactDate(item.asOf) < todayCompact);
  if (!snapshot) {
    return {
      ok: true,
      available: false,
      generatedAt,
      message: snapshots.length
        ? "最新的訊號是今天收盤後產生的，下一個交易日開盤後就能驗證。"
        : "今天開始記錄每日訊號，下一個交易日起會自動比對隔日表現。",
    };
  }

  const observed = await observeSignalSnapshot(snapshot, { allowIntraday: true });
  if (!observed.available) {
    return {
      ok: true,
      ...observed,
      message: observed.observationDate
        ? `${observed.observationDate} 是實際下一交易日，目前官方行情尚未足以完成驗證。`
        : "尚無法確認下一個實際交易日，稍後會依官方交易日資料自動重試。",
    };
  }
  const verifiedRows = observed.rows.filter((row) => row.verified);
  const unverifiedRows = observed.rows.filter((row) => !row.verified);
  const summarize = (items) => ({
    total: items.length,
    hitPlus2: items.filter((row) => row.hitPlus2).length,
    brokeMinus2: items.filter((row) => row.brokeMinus2).length,
    avgCurrentReturn: average(items.map((row) => row.currentReturn)),
    avgHighReturn: average(items.map((row) => row.highReturn)),
    // 毛報酬保留原值不動；並陳扣掉來回費稅的估算淨值（見 VERIFY_COST_NOTE）。
    // 隔日沖平均報酬本來就在 ±0.5% 這個量級，0.471% 的成本足以讓正負號翻轉。
    avgCurrentReturnNet: netReturnPct(average(items.map((row) => row.currentReturn))),
    avgHighReturnNet: netReturnPct(average(items.map((row) => row.highReturn))),
  });
  // 三個分群是平行判定、沒有 else：strongContinuation 的條件是 pullbackReversal 的超集，
  // 所以溫和上漲的紅 K 必定同時進兩群，同一檔會出現兩筆、貢獻完全相同的漲跌結果。
  // 分群統計（summaryByGroup）以 pick 為單位是對的，但整體 summary 的分母必須以「檔」為單位
  // 去重，否則樣本數虛胖、變異數被人為壓低。同檔取分數最高的那筆代表。
  const dedupeByCode = (items) => {
    const best = new Map();
    for (const row of items) {
      const current = best.get(row.code);
      if (!current || (Number(row.score) || 0) > (Number(current.score) || 0)) best.set(row.code, row);
    }
    return [...best.values()];
  };
  const uniqueVerifiedRows = dedupeByCode(verifiedRows);
  const groups = {};
  for (const row of verifiedRows) {
    groups[row.group] ||= { groupName: row.groupName, rows: [] };
    groups[row.group].rows.push(row);
  }
  const summaryByGroup = Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, { groupName: value.groupName, ...summarize(value.rows) }])
  );

  return {
    ok: true,
    ...observed,
    summary: summarize(uniqueVerifiedRows),
    uniqueSignals: uniqueVerifiedRows.length,
    duplicatedSignals: verifiedRows.length - uniqueVerifiedRows.length,
    summaryByGroup,
    rows: verifiedRows.sort((a, b) => (b.currentReturn ?? -999) - (a.currentReturn ?? -999)),
    unverified: unverifiedRows.map((row) => ({ code: row.code, name: row.name, group: row.group, groupName: row.groupName })),
    notes: [
      "觀察日依證交所實際交易日／開休市表判定，且每檔行情日期必須完全等於該日；不會把重新開啟 App 的日期當成隔日。",
      "報酬以訊號日收盤價為基準；達 +2% 用觀察日最高價判定，破 -2% 用觀察日最低價判定。",
      `所有百分比預設為未扣費稅的毛報酬；${VERIFY_COST_NOTE}`,
    ],
  };
}

function nextDayPerformance(history, signalIndex) {
  const signal = history[signalIndex];
  const next = history[signalIndex + 1];
  if (!signal || !next || !signal.close) return null;
  // 隔日若是除權息／減資日，價格會機械性跳空，拿訊號日收盤當基準會憑空記出大跌。
  // 交易所自己的昨收在事件日就是官方參考價，而且與 signal.close 來自同一份逐檔歷史、
  // 是相鄰兩根，比較基礎一致（不像跨來源比對會誤判）。缺值時退回原行為。
  const officialPreviousClose = Number(next.previousClose);
  const base = Number.isFinite(officialPreviousClose)
    && officialPreviousClose > 0
    && Math.abs(officialPreviousClose / signal.close - 1) > CORPORATE_ACTION_RATIO_TOLERANCE
    ? officialPreviousClose
    : signal.close;
  const openReturn = pct(next.open - base, base);
  const highReturn = pct(next.high - base, base);
  const closeReturn = pct(next.close - base, base);
  const lowReturn = pct(next.low - base, base);
  return {
    date: next.date,
    openReturn,
    highReturn,
    closeReturn,
    lowReturn,
    hitPlus2: highReturn !== null && highReturn >= 2,
    brokeMinus2: lowReturn !== null && lowReturn <= -2,
  };
}

async function buildBacktestUncached({ days = 30 } = {}) {
  // 回測是唯讀研究，不應因呼叫端點而順帶寫入今日正式訊號快照。
  const overnight = await buildOvernightSignals({ maxPerGroup: 20, maxCandidates: 220, persistSnapshot: false });
  const codes = unique(Object.values(overnight.groups).flat().map((pick) => pick.code));
  const reference = await getReferenceData();
  const records = [];

  // D-01：回測是第三條獨立路徑，掃描與前向驗證都已還原權息，只有它還在用原始價。
  // 除權息日的機械性跳空會被算成真實跌幅，直接灌進「隔日開盤平均報酬」這種結論數字。
  // 實測（2026-07-26）候選池裡半數以上的股票 6 個月內都有除權息，這不是邊緣案例。
  const asOfCompact = toCompactDate(overnight.asOf);
  await Promise.all([
    loadFundamentalsHistory(),
    ensureCorporateActionResults(compactMonthsBefore(asOfCompact, 5), asOfCompact),
  ]);

  await mapLimit(codes, 6, async (code) => {
    const quote = reference.byCode.get(code);
    if (!quote) return;
    const rawHistory = await getStockHistory(quote, asOfCompact, 4);
    // 跳空 heuristic 的前提是 ±10% 漲跌幅限制，只對普通股成立。
    const officialActions = corporateActionHistoryForCode(code, rawHistory[0]?.date, rawHistory.at(-1)?.date);
    const history = backAdjustForCorporateActions(rawHistory, officialActions, {
      allowHeuristicFallback: isOrdinaryStock(quote),
    });
    const startIndex = Math.max(20, history.length - days - 1);
    for (let index = startIndex; index < history.length - 1; index += 1) {
      const metrics = computeMetrics(history.slice(0, index + 1));
      if (!metrics) continue;
      for (const groupInfo of evaluateGroups(metrics)) {
        records.push(buildPick(metrics, groupInfo, nextDayPerformance(history, index)));
      }
    }
  });

  const byGroup = groupPicks(records, 500);
  const summary = {};
  for (const [group, groupRecords] of Object.entries(byGroup)) {
    const perf = groupRecords.map((record) => record.nextDayPerformance).filter(Boolean);
    summary[group] = {
      groupName: groupRecords[0]?.groupName || group,
      sampleSize: perf.length,
      avgOpenReturn: average(perf.map((item) => item.openReturn)),
      avgHighReturn: average(perf.map((item) => item.highReturn)),
      avgCloseReturn: average(perf.map((item) => item.closeReturn)),
      // 毛報酬保留原值；並陳扣掉來回費稅的估算淨值（見 VERIFY_COST_NOTE）。
      avgOpenReturnNet: netReturnPct(average(perf.map((item) => item.openReturn))),
      avgHighReturnNet: netReturnPct(average(perf.map((item) => item.highReturn))),
      avgCloseReturnNet: netReturnPct(average(perf.map((item) => item.closeReturn))),
      hitPlus2Rate: perf.length ? perf.filter((item) => item.hitPlus2).length / perf.length : null,
      brokeMinus2Rate: perf.length ? perf.filter((item) => item.brokeMinus2).length / perf.length : null,
    };
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    days,
    source: "Official history for current signal candidates",
    formulaVersion: OVERNIGHT_FORMULA_VERSION,
    sampleCodes: codes,
    warnings: unique([...(overnight.warnings || []), ...(reference.warnings || [])]),
    dataQuality: {
      degraded: Boolean(reference.degraded),
      referenceComplete: Boolean(reference.coverageComplete),
      markets: reference.markets,
    },
    summary,
    records: Object.values(byGroup).flat().sort((a, b) => a.asOf.localeCompare(b.asOf)).slice(-1000),
    notes: [
      "Backtest v1 runs on current signal candidates to keep official endpoint usage practical.",
      "Returns use signal-day close as the observation baseline and next trading day OHLC.",
      "歷史序列已還原權息：除權息日的機械性跳空不是真實跌幅，不還原會直接灌進下方的平均報酬。",
      `所有百分比預設為未扣費稅的毛報酬；${VERIFY_COST_NOTE}`,
    ],
  };
}

async function buildBacktest({ days = 30 } = {}) {
  const cacheKey = String(days);
  const cached = getFreshTtlCacheEntry(backtestCache, cacheKey);
  if (cached) return cached.value;
  if (backtestInFlight.has(cacheKey)) return backtestInFlight.get(cacheKey);

  const task = buildBacktestUncached({ days }).then((body) => {
    setBoundedDateCache(backtestCache, cacheKey, {
      expiresAt: Date.now() + BACKTEST_CACHE_TTL_MS,
      value: body,
    }, BACKTEST_CACHE_MAX_ENTRIES);
    return body;
  }).finally(() => {
    if (backtestInFlight.get(cacheKey) === task) backtestInFlight.delete(cacheKey);
  });
  backtestInFlight.set(cacheKey, task);
  return task;
}

function normalizeAnalysisPeriod(value) {
  if (value === "week" || value === "weekly") return "week";
  if (value === "month" || value === "monthly") return "month";
  return "day";
}

function getWeekKey(dateText) {
  const compact = toCompactDate(dateText);
  if (!compact) return String(dateText || "");
  const date = new Date(Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  const year = date.getUTCFullYear();
  return `${year}-W${String(Math.ceil((((date - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7)).padStart(2, "0")}`;
}

function aggregateHistoryByPeriod(history, period) {
  if (period === "day") return history.map((row) => ({ ...row }));
  const groups = new Map();
  for (const row of history) {
    const key = period === "month" ? toCompactDate(row.date).slice(0, 6) : getWeekKey(row.date);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((rows) => {
    const sorted = rows.slice().sort((a, b) => toCompactDate(a.date).localeCompare(toCompactDate(b.date)));
    const first = sorted[0];
    const last = sorted.at(-1);
    return {
      date: last.date,
      rawDate: last.rawDate,
      code: last.code,
      name: last.name,
      exchange: last.exchange,
      open: first.open,
      high: Math.max(...sorted.map((row) => row.high).filter(Number.isFinite)),
      low: Math.min(...sorted.map((row) => row.low).filter(Number.isFinite)),
      close: last.close,
      previousClose: first.previousClose,
      change: last.close !== null && first.previousClose !== null ? last.close - first.previousClose : null,
      volumeShares: sorted.reduce((sum, row) => sum + (Number(row.volumeShares) || 0), 0),
      volumeLots: sorted.reduce((sum, row) => sum + (Number(row.volumeLots) || 0), 0),
      tradeValue: sorted.reduce((sum, row) => sum + (Number(row.tradeValue) || 0), 0),
      transactions: sorted.reduce((sum, row) => sum + (Number(row.transactions) || 0), 0),
      source: last.source,
    };
  }).sort((a, b) => toCompactDate(a.date).localeCompare(toCompactDate(b.date)));
}

function addPreviousClose(history) {
  return history.map((row, index) => ({
    ...row,
    previousClose: index > 0 ? history[index - 1].close : row.previousClose,
  }));
}

function emaSeries(values, span) {
  const multiplier = 2 / (span + 1);
  const output = [];
  let previous = null;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      output.push(previous);
      continue;
    }
    previous = previous === null ? value : value * multiplier + previous * (1 - multiplier);
    output.push(previous);
  }
  return output;
}

function movingAverageSeries(rows, field, windowSize) {
  return rows.map((_, index) => {
    const slice = rows.slice(Math.max(0, index - windowSize + 1), index + 1).map((row) => row[field]);
    return slice.length >= windowSize ? average(slice) : null;
  });
}

// emaSeries 直接把第一個值當 seed，沒有「期數未滿」保護，所以 MACD 從第 0 根就會吐數字，
// 而那個數字被 seed 主導、不是真的動能。movingAverageSeries 本來就有這道保護（放大圖前幾根
// MA 顯示 "--" 就是它），MACD 卻沒有。技術分析頁月 K 只抓 24 個月，seed 在第 24 根權重仍有
// 6.66%——不是邊緣個股偶發，是月 K 常態；實測 18 根月 K、後 17 根零波動時 dif 仍高達 +6.05
// （相當於股價 6% 的憑空動能），buildTechnicalSignals 會據此吐「MACD 負轉正」給使用者。
// 遮罩規則：dif 要等慢線滿期（index >= slow-1）；dea 是 dif 再取一次 EMA，
// 所以要再等 signal-1 根（index >= slow+signal-2）。兩個消費端都已用 Number.isFinite 守著，
// 資料不足時訊號不觸發即可，不會讓整頁失敗。
function computeMacd(rows, fast = 8, slow = 17, signal = 9) {
  const closes = rows.map((row) => row.close);
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const difWarmupIndex = Math.max(fast, slow) - 1;
  const deaWarmupIndex = difWarmupIndex + signal - 1;
  const dif = closes.map((_, index) => {
    if (index < difWarmupIndex) return null;
    const fastValue = fastEma[index];
    const slowValue = slowEma[index];
    return Number.isFinite(fastValue) && Number.isFinite(slowValue) ? fastValue - slowValue : null;
  });
  const deaRaw = emaSeries(dif, signal);
  const dea = deaRaw.map((value, index) => (index < deaWarmupIndex ? null : value));
  return rows.map((row, index) => ({
    date: row.date,
    dif: dif[index],
    dea: dea[index],
    histogram: Number.isFinite(dif[index]) && Number.isFinite(dea[index]) ? dif[index] - dea[index] : null,
  }));
}

function findSwingPoints(rows, windowSize = 2) {
  const highs = [];
  const lows = [];
  for (let index = windowSize; index < rows.length - windowSize; index += 1) {
    const current = rows[index];
    const around = rows.slice(index - windowSize, index + windowSize + 1);
    const isHigh = around.every((row, aroundIndex) => aroundIndex === windowSize || current.high > row.high);
    const isLow = around.every((row, aroundIndex) => aroundIndex === windowSize || current.low < row.low);
    if (isHigh) highs.push({ index, date: current.date, price: current.high });
    if (isLow) lows.push({ index, date: current.date, price: current.low });
  }
  return { highs, lows };
}

function buildTrendLine(points, type, lastIndex) {
  const usable = points.slice(-5);
  if (usable.length < 2) return null;
  const first = usable.at(-2);
  const second = usable.at(-1);
  if (!first || !second || first.index === second.index) return null;
  const slope = (second.price - first.price) / (second.index - first.index);
  const intercept = first.price - slope * first.index;
  const valueAtLast = slope * lastIndex + intercept;
  return {
    type,
    points: [first, second],
    slope,
    intercept,
    valueAtLast,
  };
}

function valueOnLine(line, index) {
  if (!line) return null;
  return line.slope * index + line.intercept;
}

function buildFibonacci(rows, swings, breakout) {
  if (!breakout || rows.length < 10) return { active: false, levels: [], observation: null };
  const lastIndex = rows.length - 1;
  const recentLow = swings.lows.filter((point) => point.index < lastIndex).at(-1);
  const highCandidates = recentLow
    ? rows.slice(recentLow.index, lastIndex + 1).map((row, offset) => ({ index: recentLow.index + offset, date: row.date, price: row.high }))
    : rows.slice(-60).map((row, offset) => ({ index: Math.max(0, rows.length - 60) + offset, date: row.date, price: row.high }));
  const recentHigh = highCandidates.reduce((best, point) => (!best || point.price > best.price ? point : best), null);
  if (!recentLow || !recentHigh || recentHigh.price <= recentLow.price) return { active: false, levels: [], observation: null };
  const range = recentHigh.price - recentLow.price;
  const lastClose = rows.at(-1).close;
  const tolerance = Math.max(lastClose * 0.015, range * 0.04);
  const levels = [0.382, 0.5, 0.618].map((ratio) => {
    const price = recentHigh.price - range * ratio;
    return {
      ratio,
      price,
      near: Math.abs(lastClose - price) <= tolerance,
    };
  });
  const observation = levels.find((level) => level.near) || null;
  return {
    active: true,
    swingLow: recentLow,
    swingHigh: recentHigh,
    levels,
    observation,
    tolerance,
  };
}

function buildTechnicalSignals(rows, macd, maShort, maMid, swings, supportLine, resistanceLine) {
  const lastIndex = rows.length - 1;
  const last = rows[lastIndex];
  const previous = rows[lastIndex - 1];
  const lastMacd = macd[lastIndex] || {};
  const previousMacd = macd[lastIndex - 1] || {};
  const previous2Macd = macd[lastIndex - 2] || {};
  const supportNow = valueOnLine(supportLine, lastIndex);
  const supportPrevious = valueOnLine(supportLine, lastIndex - 1);
  const resistanceNow = valueOnLine(resistanceLine, lastIndex);
  const resistancePrevious = valueOnLine(resistanceLine, lastIndex - 1);
  const breakout = Number.isFinite(resistanceNow) && last.close > resistanceNow && (!previous || previous.close <= resistancePrevious);
  const breakdown = Number.isFinite(supportNow) && last.close < supportNow && (!previous || previous.close >= supportPrevious);
  const histogramTurnPositive = Number.isFinite(lastMacd.histogram) && Number.isFinite(previousMacd.histogram) && previousMacd.histogram <= 0 && lastMacd.histogram > 0;
  const histogramExpanding = Number.isFinite(lastMacd.histogram)
    && Number.isFinite(previousMacd.histogram)
    && Number.isFinite(previous2Macd.histogram)
    && lastMacd.histogram > previousMacd.histogram
    && previousMacd.histogram > previous2Macd.histogram;
  const histogramShrinking = Number.isFinite(lastMacd.histogram)
    && Number.isFinite(previousMacd.histogram)
    && Number.isFinite(previous2Macd.histogram)
    && lastMacd.histogram < previousMacd.histogram
    && previousMacd.histogram < previous2Macd.histogram;
  const avgVol20 = average(rows.slice(Math.max(0, lastIndex - 20), lastIndex).map((row) => row.volumeLots));
  const volumeAbove20 = Number.isFinite(avgVol20) && last.volumeLots > avgVol20;
  const aboveMa = Number.isFinite(maShort[lastIndex])
    && Number.isFinite(maMid[lastIndex])
    && last.close > maShort[lastIndex]
    && last.close > maMid[lastIndex];
  const previousSwingLow = swings.lows.filter((point) => point.index < lastIndex).at(-1);
  const brokePreviousSwingLow = previousSwingLow ? last.close < previousSwingLow.price : false;
  const bodyPct = previous?.close ? ((last.close - last.open) / previous.close) * 100 : 0;
  const longBlackVolume = last.close < last.open && bodyPct <= -3 && Number.isFinite(avgVol20) && last.volumeLots > avgVol20 * 1.5;
  const longWatch = breakout && (histogramTurnPositive || histogramExpanding) && volumeAbove20 && aboveMa;
  const risks = [];
  if (breakdown) risks.push("收盤價跌破上升趨勢線");
  if (histogramShrinking) risks.push("MACD 柱狀圖連續縮小");
  if (brokePreviousSwingLow) risks.push("跌破前一個波段低點");
  if (longBlackVolume) risks.push("放量長黑K");
  const signals = [];
  if (breakout) signals.push("突破壓力線");
  if (breakdown) signals.push("跌破支撐線");
  if (histogramTurnPositive) signals.push("MACD 負轉正");
  if (histogramExpanding) signals.push("MACD 持續放大");
  if (volumeAbove20) signals.push("成交量大於 20 日均量");
  if (aboveMa) signals.push("站上短中期均線");
  return {
    breakout,
    breakdown,
    // 「站在線的哪一側」是**狀態**，「今天剛穿過」是**事件**（breakout/breakdown 要求前一根還在線的另一側）。
    // 舊寫法只回事件，於是價格早就站上壓力線之後，畫面同時顯示「壓力 3669.71」與
    // 「目前沒有明確突破或跌破」——使用者看到收盤 3750 高於壓力 3670 卻被告知沒突破。
    // 邏輯沒錯（那次突破不是今天），但那句話把「不是今天」講成了「沒有」。
    // 實例：2454 聯發科 2026-07-24（收 3750／壓力線 3669.71）。
    aboveResistance: Number.isFinite(resistanceNow) && last.close > resistanceNow,
    belowSupport: Number.isFinite(supportNow) && last.close < supportNow,
    longWatch,
    risks,
    signals,
    checks: {
      closeAboveResistance: breakout,
      macdOk: histogramTurnPositive || histogramExpanding,
      volumeAbove20,
      aboveMovingAverages: aboveMa,
      histogramTurnPositive,
      histogramExpanding,
      histogramShrinking,
      brokePreviousSwingLow,
      longBlackVolume,
    },
  };
}

async function buildTechnicalAnalysis({ code, period = "day" } = {}) {
  const clean = cleanCode(code);
  // 用全站共用的 4～6 碼英數規則：純數字 regex 會把 00631L／00632R 這類槓反 ETF 擋在門外，
  // 但前端 isValidSecurityCode、/api/symbols 與自選股都認得它們，使用者會看到「請輸入有效的台股代號」。
  if (!SECURITY_CODE_PATTERN.test(clean)) {
    return { ok: false, generatedAt: new Date().toISOString(), error: "請輸入有效的台股代號" };
  }
  const analysisPeriod = normalizeAnalysisPeriod(period);
  const reference = await getReferenceData();
  const quote = reference.byCode.get(clean);
  if (!quote) {
    if (reference.degraded) {
      return {
        ok: false,
        retryable: true,
        generatedAt: new Date().toISOString(),
        code: clean,
        error: "目前官方股票清單只取得部分市場，暫時無法確認這個代號，請稍後重試。",
        warnings: reference.warnings || [],
      };
    }
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      code: clean,
      error: "官方資料查不到這個代號",
      warnings: reference.warnings || [],
    };
  }
  // 用「今天」當歷史資料上限，而不是整批收盤參考資料的日期：
  // STOCK_DAY_ALL 更新比個股月歷史慢，照它過濾會把今天已公布的收盤 K 砍掉。
  const dateCompact = toTaipeiCompactDate();
  // 本機公司行動歸檔（還原權息的依據）要先載入，否則第一次開技術頁會拿到空 archive。
  await loadFundamentalsHistory();
  // 跳空 heuristic 的前提是「台股有 ±10% 漲跌幅限制」，只對普通股成立。
  // 技術頁跟波段健檢不同，它本來就接受 ETF／權證代號（00631L 這類槓反 ETF 無漲跌幅限制），
  // 對它們套跳空猜測會把一天的真實大漲追認成除權息，事件前的歷史全被乘上假比率。
  const allowHeuristicFallback = isOrdinaryStock(quote);
  const prepareRows = (dailyHistory) => buildAdjustedPeriodRows(
    dailyHistory,
    corporateActionHistoryForCode(clean, dailyHistory[0]?.date, dailyHistory.at(-1)?.date),
    { period: analysisPeriod, allowHeuristicFallback },
  );
  let rawHistory = await getStockHistory(quote, dateCompact, 24, {
    allowExternalFallback: true,
    fallbackMinRows: 60,
    fallbackRange: "2y",
  });
  // 官方除權除息計算結果表：resolveCorporateActionAdjustments 是同步的，所以要先把
  // 這段期間的月份補齊，它才查得到。抓過的月份會落盤，之後只會多抓當月。
  let resultCoverage = await ensureCorporateActionResults(rawHistory[0]?.date, rawHistory.at(-1)?.date);
  let historySource = rawHistory.some((row) => row.source === "Yahoo Finance chart fallback")
    ? "Yahoo Finance chart fallback (official history unavailable)"
    : "TWSE/TPEx official history";
  let prepared = prepareRows(rawHistory);
  let rows = prepared.rows;
  const minBars = analysisPeriod === "month" ? 18 : 30;
  if (rows.length < minBars && !rawHistory.some((row) => row.source === "Yahoo Finance chart fallback")) {
    try {
      const fallbackHistory = await fetchYahooHistory(quote, dateCompact, analysisPeriod === "month" ? "5y" : "2y");
      // 這一份比上面那次抓的長很多（月K 退到 5 年），加長的那段月份從來沒被補齊過，
      // 而 prepareRows → resolveCorporateActionAdjustments 是**同步查表**，
      // 所以不先 ensure 就等於那幾十個月一律查不到官方參考價、完全不還原，
      // 而 resultCoverage 還停在第一次的範圍上（degraded 是 false），揭露不會觸發。
      const extendedCoverage = await ensureCorporateActionResults(fallbackHistory[0]?.date, fallbackHistory.at(-1)?.date);
      const fallbackPrepared = prepareRows(fallbackHistory);
      if (fallbackPrepared.rows.length > rows.length) {
        rawHistory = fallbackHistory;
        historySource = "Yahoo Finance chart fallback (official history unavailable)";
        prepared = fallbackPrepared;
        rows = fallbackPrepared.rows;
        resultCoverage = extendedCoverage;
      }
    } catch {
      // Keep the official rows and return the normal insufficient-data message below.
    }
  }
  const corporateActions = prepared.corporateActions;
  // 「Yahoo 的原始 OHLC 是否已自行還原過配股」在這個專案裡從未實測（見 DOMAIN-BACKLOG D-42）。
  // 掃描端早就對兩種來源一視同仁，技術頁跟進不是新的風險類別；但既然這頁現在顯示的是還原後的
  // 價格，就得讓使用者知道這段數字疊了兩層未經核對的處理，不能默默端出去。
  if (corporateActions.adjusted && historySource.startsWith("Yahoo")) {
    corporateActions.notes.push("這段歷史來自 Yahoo 備援序列，它的原始價已自行把配股當分割還原過，"
      + "本頁只補回現金股利那一段；換算不出配股倍數的事件會直接標為未定案。");
    corporateActions.alert = true;
  }
  if (resultCoverage.degraded) {
    // 「抓不到」與「超出補齊範圍」是兩件事：後者在月K 退到 5 年時是必然的（上限 30 個月），
    // 講成「暫時抓不到」會讓使用者以為等一下重整就好。
    corporateActions.notes.push(resultCoverage.truncated
      ? `這張圖最舊的 ${resultCoverage.truncated} 個月超出官方除權除息計算結果表的補齊範圍，那一段改用公告公式或跳空估算還原。`
      : "官方除權除息計算結果表有部分月份暫時抓不到，這段期間改用公告公式或跳空估算還原。");
    corporateActions.alert = true;
  }
  if (rows.length < minBars) {
    const periodLabel = analysisPeriod === "month" ? "月K" : analysisPeriod === "week" ? "週K" : "日K";
    const suggestion = analysisPeriod === "day"
      ? "請稍後重新抓官方資料。"
      : "這通常是官方歷史資料端點暫時擋住較舊月份，不是這檔股票沒有資料。請先切回日K，或之後改用券商/授權歷史行情。";
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      code: clean,
      name: quote.name,
      period: analysisPeriod,
      source: historySource,
      requiredBars: minBars,
      availableBars: rows.length,
      error: `官方${periodLabel}歷史資料不足：目前只抓到 ${rows.length} 根，至少需要 ${minBars} 根。${suggestion}`,
      candles: rows,
      corporateActions,
      warnings: reference.warnings || [],
    };
  }
  const maShort = movingAverageSeries(rows, "close", 5);
  const maMid = movingAverageSeries(rows, "close", 20);
  const macd = computeMacd(rows, 8, 17, 9);
  const swings = findSwingPoints(rows, 2);
  const supportLine = buildTrendLine(swings.lows, "support", rows.length - 1);
  const resistanceLine = buildTrendLine(swings.highs, "resistance", rows.length - 1);
  // 官方已公告當天有公司行動、但公式欄位還不齊 → 事件之前的 K 只能估算或根本沒還原。
  // 依 stock1-domain：圖形可以先估算著看，但不得提供單檔型態結論。
  // 這裡把突破／跌破／做多觀察整組停掉並標 suppressed，前端才不會把「沒評估」畫成「沒滿足條件」。
  const conclusionsSuppressed = corporateActions.unresolvedDates.length > 0;
  const signals = conclusionsSuppressed
    ? {
      breakout: false,
      breakdown: false,
      // suppressed 時連「站在線的哪一側」都不能講：那條線畫在沒有正確還原的價格上。
      aboveResistance: false,
      belowSupport: false,
      longWatch: false,
      suppressed: "corporate-action-unresolved",
      risks: [],
      signals: [],
      checks: {
        closeAboveResistance: false,
        macdOk: false,
        volumeAbove20: false,
        aboveMovingAverages: false,
        histogramTurnPositive: false,
        histogramExpanding: false,
        histogramShrinking: false,
        brokePreviousSwingLow: false,
        longBlackVolume: false,
      },
    }
    : buildTechnicalSignals(rows, macd, maShort, maMid, swings, supportLine, resistanceLine);
  const fibonacci = buildFibonacci(rows, swings, signals.breakout);
  const candles = rows.map((row, index) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volumeLots: row.volumeLots,
    maShort: maShort[index],
    maMid: maMid[index],
    macd: macd[index],
  }));
  // 單檔處置/注意狀態（給技術頁小標記）：優先用看板快取（含期間/出關天數），
  // 沒快取就退回較輕的 getRiskSets（只有 注意/處置 標籤），不額外拖慢技術頁。
  // 停牌狀態一定要查 getRiskSets（10 分快取，通常已熱）。
  let surveillanceStatus = lookupStockSurveillance(clean, surveillanceBoardCache.value);
  let haltedStatus = null;
  try {
    const riskSets = await getRiskSets();
    if (!surveillanceStatus) {
      const m = riskSets.surveillance.get(clean);
      if (m) surveillanceStatus = { kind: m.kind, label: m.label, note: m.note, status: m.kind };
    }
    if (riskSets.halted?.has(clean)) {
      const since = riskSets.halted.get(clean) || "";
      haltedStatus = { since: since ? compactToIsoDate(since) : null };
    }
  } catch { /* 抓不到就不顯示標記 */ }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    code: clean,
    name: quote.name,
    exchange: quote.exchange,
    surveillance: surveillanceStatus,
    halted: haltedStatus,
    period: analysisPeriod,
    source: historySource,
    warnings: reference.warnings || [],
    dataQuality: {
      degraded: Boolean(reference.degraded),
      referenceComplete: Boolean(reference.coverageComplete),
      markets: reference.markets,
    },
    parameters: {
      maShort: 5,
      maMid: 20,
      macd: [8, 17, 9],
      swingWindow: 2,
    },
    asOf: rows.at(-1).date,
    // 還原權息揭露：技術頁與波段健檢從此跑在同一組還原後的價格上，
    // 兩頁不會再對同一檔同一天給出相反的型態結論（除息造成的假跌破／假死叉）。
    corporateActions,
    candles,
    swingHighs: swings.highs.slice(-12),
    swingLows: swings.lows.slice(-12),
    trendLines: {
      support: supportLine,
      resistance: resistanceLine,
    },
    fibonacci,
    signals,
    disclaimer: "本功能只做技術分析與提醒，不提供買賣建議，也不保證股價上漲。",
  };
}

// === 波段策略雷達（中軌攻防等場景選股 + 完整交易計畫）===
// 與隔日沖（1日）、盤中選股（即時）互補的「多日波段」維度。
// 重用既有 getStockHistory / computeMacd / movingAverageSeries / findSwingPoints 等工具，
// 額外補上布林通道（中軌=MA20，需要標準差）與場景分類、交易計畫、評分。

function roundTo(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function standardDeviationValues(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return null;
  const mean = average(usable);
  return Math.sqrt(average(usable.map((value) => (value - mean) ** 2)));
}

// 布林通道：中軌 = MA20，上/下軌 = 中軌 ± mult×σ。回傳逐列序列。
function bollingerSeries(rows, period = 20, mult = 2) {
  const closes = rows.map((row) => row.close);
  return rows.map((_, index) => {
    if (index < period - 1) return { mid: null, upper: null, lower: null, bandwidth: null };
    const window = closes.slice(index - period + 1, index + 1);
    const mid = average(window);
    const sd = standardDeviationValues(window);
    if (!Number.isFinite(mid) || !Number.isFinite(sd)) return { mid: null, upper: null, lower: null, bandwidth: null };
    const upper = mid + mult * sd;
    const lower = mid - mult * sd;
    return { mid, upper, lower, bandwidth: mid ? (upper - lower) / mid : null };
  });
}

function averageTrueRange(rows, period = 14) {
  if (rows.length < 2) return null;
  const trueRanges = rows.map((row, index) => {
    if (index === 0) return row.high - row.low;
    const prev = rows[index - 1];
    return Math.max(row.high - row.low, Math.abs(row.high - prev.close), Math.abs(row.low - prev.close));
  });
  return average(trueRanges.slice(-period));
}

// 由日K列推算波段選股需要的所有指標／型態特徵。
// 還原股價優先使用官方除權息公告；只有呼叫端沒有官方證據時，才以 >10.5% 異常跳空降級估算。
// 大跌／大漲也可能形成跳空，因此 heuristic 只能標「疑似」，絕不能宣稱一定是除息。
// 錨定最新棒（factor 從最後一根的 1 往回累乘）：最近的價格不動，只調整事件以前的歷史。
// 10.5% 跳空 heuristic 的前提是「這兩根是相鄰交易日」。逐月歷史抓取失敗會被
// `.catch(() => [])` 吞成空陣列，`flat().sort()` 直接把缺月前後接起來，於是跨月的正常漲跌
// 會被誤判成公司行動：缺口以前所有價格被乘上假比率，MA60／布林／MACD 一起錯，
// 前端還會顯示「近期疑似權息跳空(估算還原)」這個不存在的事件。而且誤觸發後 source 只會是
// heuristic、不進 unresolvedIndices，scanSwingBoard 的攔截也擋不到。
// 門檻取 14 天：一般週末是 3 天、農曆春節連假約 5～10 天，而缺一整月是 28～31 天，區隔充分。
// 官方事件有明確 exDate 可比對，不受影響；只有 heuristic 需要這道相鄰性檢查。
const HEURISTIC_MAX_GAP_DAYS = 14;
function corporateActionGapRatio(row, previousClose, thresholdPct = 10.5) {
  if (!row || !Number.isFinite(previousClose) || previousClose <= 0) return null;
  const open = Number(row.open);
  const close = Number(row.close);
  const openGap = Number.isFinite(open) && open > 0 ? Math.abs(open / previousClose - 1) * 100 : 0;
  const closeGap = Number.isFinite(close) && close > 0 ? Math.abs(close / previousClose - 1) * 100 : 0;
  if (Math.max(openGap, closeGap) <= thresholdPct) return null;
  const reference = Number.isFinite(open) && open > 0 ? open : close;
  const ratio = reference / previousClose;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

// 證交所／櫃買中心公告公式：
// 除權息參考價＝[(前收－息值)＋(現增認購價×現增配股率)]／(1＋無償配股率＋現增配股率)。
// 回傳「參考價／前收」作為事件前所有價格的回溯調整因子。
const CORPORATE_ACTION_MAX_PLAUSIBLE_RATIO = 1;

// 量級檢查要由價格公式與股數倍數**共用**，否則同一筆事件會被兩條路判出相反的結論。
// 舊寫法只把上限寫在 officialCorporateActionRatio 裡，於是：
//   (a) 上游若把比率改成「每仟股股數」（帳本那側 2026 年就有同名防呆，見「無償配股率大於 1」），
//       價格那條被擋下標未定案，但 1＋stockRatio＋subscriptionRatio 仍算出 101，
//       直接餵給 Yahoo 座標系換算（ratio × 101）與成交量還原因子；
//   (b) 反過來，真正合法的 >100% 無償配股會被價格那條擋成未定案，股數倍數卻照樣給出 2.x。
// 回 null＝「這筆的股數倍數不可信」，呼叫端一律當成推導不出來處理。
function plausibleShareFactor(action) {
  if (!action) return null;
  const clamp = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const stockRatio = clamp(action.stockRatio);
  const subscriptionRatio = clamp(action.subscriptionRatio);
  if (stockRatio > CORPORATE_ACTION_MAX_PLAUSIBLE_RATIO || subscriptionRatio > CORPORATE_ACTION_MAX_PLAUSIBLE_RATIO) return null;
  return 1 + stockRatio + subscriptionRatio;
}

function officialCorporateActionRatio(action, previousClose) {
  if (!action || !Number.isFinite(previousClose) || previousClose <= 0) return null;
  if (action.formulaComplete === false || action.status === "withdrawn") return null;
  const numericOrNull = (value) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const kind = String(action.kind || "");
  const cashRaw = numericOrNull(action.cashDividend);
  const stockRaw = numericOrNull(action.stockRatio);
  const hasSubscriptionSchema = Object.prototype.hasOwnProperty.call(action, "subscriptionRatio");
  const subscriptionRaw = numericOrNull(action.subscriptionRatio);
  const subscriptionPrice = numericOrNull(action.subscriptionPrice);
  // 舊 archive 沒保存現增欄位；不論權或息都不能把「未知」擅自當 0。
  if (!hasSubscriptionSchema) return null;
  if (kind.includes("息") && cashRaw === null) return null;
  // 除權至少要有一個明確的比率欄位。這裡刻意是 AND 不是 OR——
  // 官方對「沒有現增」的表達方式就是把現增欄位留空，而「配股但不配現增」是除權息的常態
  // （2026-07 實測歸檔：59 筆除權事件裡有 31 筆是 stockRatio 有值、subscriptionRatio 為 null）。
  // 要求兩欄都有值等於把過半配股公司判成「公式不齊」，波段健檢打不開、掃描也把它們剔除。
  // 至於原本擔心的「缺漏欄位被當成 0 → ratio 算出 1，一根價都不調卻蓋上 official 章」，
  // 由下方的「兩個比率都是 0 的除權在定義上不成立」防呆負責，這裡不需要重複把關。
  if (kind.includes("權") && stockRaw === null && subscriptionRaw === null) return null;
  const cashDividend = cashRaw || 0;
  const stockRatio = stockRaw || 0;
  const subscriptionRatio = subscriptionRaw || 0;
  // 量級防呆。官方欄位名叫 Ratio，但同一份報表的網頁版是以「每仟股無償配股（股）」呈現。
  // 2026-07-26 實測確認 OpenAPI 回的是比率（0.09999999＝配股 10%），但上游哪天改版成每仟股股數，
  // 除數就會從 1.1 變成 101，整段 K 線塌陷卻仍蓋著 official 章、不走 heuristic、也沒有任何告警。
  // 單次無償配股／現增比率超過 1（＝配股超過 100%）本來就極罕見，一律當資料異常擋下來標未定案，
  // 寧可讓人去查，也不要無聲算出一條塌掉的均線。
  if (stockRatio > CORPORATE_ACTION_MAX_PLAUSIBLE_RATIO || subscriptionRatio > CORPORATE_ACTION_MAX_PLAUSIBLE_RATIO) return null;
  // 現增比率存在但認購價尚未公告時不能假裝精確；留給呼叫端日後資料修訂後再算。
  if (subscriptionRatio > 0 && subscriptionPrice === null) return null;
  const referencePrice = (
    previousClose - cashDividend + (subscriptionPrice || 0) * subscriptionRatio
  ) / (1 + stockRatio + subscriptionRatio);
  // 除權事件算出「完全不用調整」是可疑值（兩個比率都 0 的除權在定義上不成立）→ 當成資料不完整。
  if (kind.includes("權") && stockRatio === 0 && subscriptionRatio === 0) return null;
  const ratio = referencePrice / previousClose;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

// 來源可信度分級（高到低）。前兩級都是交易所自己算出來的參考價，比我們套公式更可信：
//   exchange-result 上市 TWT49U 計算結果表：直接給前收盤價與參考價，已套過升降單位。
//   exchange-quote  上櫃逐檔歷史：漲跌價差是相對參考價算的 → close − change 就是參考價。
//   official        本機歸檔的除權息預告 ＋ 官方公式。
//   heuristic*      >10.5% 跳空推測，只對有漲跌幅限制的普通股成立，一律標「疑似」。
const EXCHANGE_CORPORATE_ACTION_SOURCES = new Set(["exchange-result", "exchange-quote"]);
function isOfficialCorporateActionSource(source) {
  return source === "official" || EXCHANGE_CORPORATE_ACTION_SOURCES.has(source);
}

// Yahoo 備援序列的還原語意跟官方逐檔歷史不同（2026-07-26 實測 4 檔配股個股全部吻合）：
// Yahoo 的 indicators.quote 已經把台股「配股」當成分割自行還原了（30% 配股＝1300:1000），
// 但「現金股利」沒有還原（純現金的對照組 2002 中鋼與官方收盤完全相等）。
// 所以在 Yahoo 的座標系裡，正確的回溯因子是「官方因子 × 配股倍數」——
// 把官方因子裡已經被 Yahoo 做掉的那一段乘回去，否則配股會被還原兩次、事件前的價格被壓低。
function yahooSpaceRatio(rawRatio, shareFactor) {
  if (!Number.isFinite(rawRatio) || rawRatio <= 0) return null;
  if (!Number.isFinite(shareFactor) || shareFactor <= 0) return null;
  const ratio = rawRatio * shareFactor;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function resolveCorporateActionAdjustments(rows, officialActions, { allowHeuristicFallback = false } = {}) {
  const officialAvailable = Array.isArray(officialActions);
  const actionsByDate = new Map();
  if (officialAvailable) {
    for (const action of officialActions) {
      const exDate = toCompactDate(action?.exDate);
      if (exDate) actionsByDate.set(exDate, action);
    }
  }
  const adjustments = new Map(); // row index → { ratio, source, shareFactor }
  const unresolvedIndices = [];
  const historyGapIndices = [];
  const shareFactorUnknownIndices = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const previousRow = rows[index - 1];
    const rowDate = toCompactDate(row?.date);
    const previousDate = toCompactDate(previousRow?.date);
    const gapDays = rowDate && previousDate ? compactDaysDiff(previousDate, rowDate) : null;
    const contiguous = gapDays !== null && gapDays >= 1 && gapDays <= HEURISTIC_MAX_GAP_DAYS;
    if (!contiguous) historyGapIndices.push(index);
    const priorClose = Number(previousRow?.close);
    const officialAction = rowDate ? actionsByDate.get(rowDate) : null;
    // Yahoo 備援序列不能沿用官方逐檔歷史的語意（見 yahooSpaceRatio）。
    // **兩個問法不一樣，不可共用一個旗標**：
    //   fromYahoo（事件日那一列）→ 決定「這一列自己的欄位可不可信」，例如 exchangePreviousClose。
    //   priorFromYahoo（前一列）→ 決定「即將被乘上因子的那些列在哪個座標系」，因子只作用在
    //     index 之前的列，所以座標系要問前一列。
    // 混用會在接縫上取反：三個入口都是 getStockHistory(allowExternalFallback) → appendTodayCloseBar，
    // 官方逐檔被限流時會產生「一整串 Yahoo 列 ＋ 一根官方當日 K」；事件正好落在那根時
    // fromYahoo 是 false，rawSpace 的換算被整組跳過。實測（6944，Yahoo 已套 1.3 分割）：
    // 事件前收盤被壓成 599.41 而不是 779.23——整段歷史低 23%，而且 unresolvedIndices 是空的、
    // source 還蓋著 exchange-result 官方章，掃描端與健檢端都不會攔。
    const fromYahoo = String(row?.source || "").startsWith("Yahoo");
    const priorFromYahoo = String(previousRow?.source || "").startsWith("Yahoo");

    // 無償配股／現增會同時改變股數，成交量要按這個倍數反向調整。
    // 走與價格公式同一道量級檢查（plausibleShareFactor）：比率明顯不像比率時回 null，
    // 讓下游當成「推導不出來」，而不是拿一個 101 倍去乘成交量或 Yahoo 換算倍數。
    const archiveShareFactor = plausibleShareFactor(officialAction);

    // Yahoo 的價格座標系跟官方逐檔歷史差了一個配股倍數（它已自行把配股當分割還原）。
    // 官方來源（計算結果表、公告公式）算出來的因子是「原始座標系」的，必須換算；
    // 由 Yahoo 自身資料推出來的跳空 heuristic 本來就在 Yahoo 座標系，換算會變成錯上加錯。
    const resultKind = rowDate && row?.code ? String(corporateActionResultFor(row.code, rowDate)?.kind || "") : "";
    // 換算倍數的三個來源，依可信度排序：
    //   1. Yahoo 自己回報的分割倍數——我們要的正是「Yahoo 實際套了多少」，這是定義上的答案。
    //   2. 本機歸檔公告的 1＋配股率＋現增率——真實比率，通常等於 Yahoo 套的，但歸檔覆蓋率有限。
    //   3. 官方計算結果表的 kind：純除息代表沒有配股，倍數必為 1。
    // 三者都拿不到就回 null，寧可不調也不要把配股還原兩次。
    // 問的是「前一列（會被乘上因子的那些）在哪個座標系」，所以用 priorFromYahoo；
    // 但分割倍數本身要讀事件日那一列——Yahoo 是在事件當天套上分割的。
    const rowSplitFactor = Number(row?.yahooSplitFactor);
    // 結果表的順位高於歸檔：它說這天有配股（kind 含「權」）而歸檔卻推出「股數沒變」（倍數 1），
    // 代表歸檔缺了配股欄位，不是真的沒配股——這種矛盾一律當推導不出來，別拿 1 去換算。
    const archiveContradictsResult = resultKind.includes("權") && archiveShareFactor === 1;
    const yahooShareFactor = !priorFromYahoo
      ? 1
      : (Number.isFinite(rowSplitFactor) && rowSplitFactor > 0 ? rowSplitFactor : null)
        ?? (archiveContradictsResult ? null : archiveShareFactor)
        ?? ((resultKind && !resultKind.includes("權")) ? 1 : null);
    // 官方公式要用「原始座標系的前收」去算，否則現金股利會被拿去跟已經除過配股的價格相減。
    const rawPriorClose = Number.isFinite(yahooShareFactor) && yahooShareFactor > 0
      ? priorClose * yahooShareFactor
      : priorClose;

    // ---- 第一順位：交易所自己算的參考價 ----
    let ratio = null;
    let source = "";
    let rawSpace = false; // 這個因子是不是「原始座標系」的（Yahoo 需要換算）
    const resultRatio = rowDate && row?.code ? corporateActionResultRatio(row.code, rowDate) : null;
    if (resultRatio !== null) {
      // TWT49U 給的前收盤價本身就是原始價，所以這個比值一定是原始座標系。
      ratio = resultRatio;
      source = "exchange-result";
      rawSpace = true;
    } else if (Number.isFinite(priorClose) && priorClose > 0) {
      // 上櫃：exchangePreviousClose 在事件日就是官方參考價，與前一列實際收盤不符即為事件。
      // 用與波段驗證同一套 0.2% 容忍度，避免把升降單位造成的捨入誤差當成公司行動。
      // 必須要求相鄰：逐月歷史抓取失敗會被吞成空陣列，缺月前後直接接起來之後，
      // 「交易所昨收」講的是真正的前一個交易日、priorClose 卻是幾週前那根，
      // 兩者本來就對不上，沒有這道檢查就會把整段缺口誤判成一次巨大的公司行動。
      const exchangePrev = Number(row?.exchangePreviousClose);
      if (!fromYahoo && contiguous && Number.isFinite(exchangePrev) && exchangePrev > 0) {
        const candidate = exchangePrev / priorClose;
        if (Math.abs(candidate - 1) > CORPORATE_ACTION_RATIO_TOLERANCE) {
          ratio = candidate;
          source = "exchange-quote";
        }
      }
    }

    // ---- 第二順位：本機歸檔的官方公告＋公式 ----
    if (ratio === null && officialAction) {
      const formulaRatio = officialCorporateActionRatio(officialAction, rawPriorClose);
      if (formulaRatio !== null) {
        ratio = formulaRatio;
        source = "official";
        rawSpace = true;
      }
    }

    // 「交易所說今天有事件」但我們算不出比率 → 不能當作沒事發生。
    // 上市的官方標記涵蓋全部歷史，比本機歸檔可靠得多（歸檔只從部署後累積）。
    // 但只有在「該月的計算結果表真的抓成功過」時才算數——否則是我們沒查到，不是資料不完整，
    // 不該因為上游打嗝就把一批股票踢出候選池（見 corporateActionResultMonthCovered）。
    const exchangeMarked = Boolean(row?.exchangeCorporateActionMark);
    const markerActionable = exchangeMarked && corporateActionResultMonthCovered(rowDate);
    const officialUnresolved = Boolean((officialAction || markerActionable) && ratio === null);

    // ---- 第三順位：跳空推測（只對有漲跌幅限制的普通股成立）----
    // 跨越資料缺口時不得套 heuristic：那個「跳空」是缺了幾週的正常漲跌，不是公司行動。
    if (ratio === null && contiguous && (!officialAvailable || allowHeuristicFallback)) {
      ratio = corporateActionGapRatio(row, priorClose);
      source = ratio !== null ? (officialAction || exchangeMarked ? "heuristic-incomplete-official" : "heuristic") : "";
    }

    if (ratio !== null) {
      let shareFactor = archiveShareFactor ?? 1;
      // 股數倍數有三種狀態，前兩種是「知道」，第三種一直被當成「知道是 1」——那是 D-29 的核心。
      //   確定 1     ：官方計算結果表的 kind 不含「權」＝官方認定沒有配股／現增／減資。
      //   確定精確值 ：本機歸檔有完整且合理的配股率＋現增率（1＋r＋q）。
      //   不知道     ：kind 含「權」但歸檔沒有那一筆；或整段只有跳空 heuristic。
      // 第三種目前只能沿用 1（沒有更好的值），但**不可以假裝那是事實**：實測 2026-07-26 的
      // 2,717 筆官方事件裡，256 筆含權、其中 233 筆歸檔查不到，量比在事件後 20 天內被高估。
      // 為什麼不用「前收 ÷ 參考價」推：那個等式只對純無償配股成立。實測 6 筆有現增的事件全部
      // 偏低，最大偏 14.7%（3149 正達：精確 1.2652、估計 1.0787）。TWT49U 的「權值＋息值」欄
      // 恆等於「前收 − 參考價」，對兩種情形都成立，所以這張表在數學上分不出配股與現增。
      let shareFactorKnown = archiveShareFactor !== null
        || Boolean(resultKind && !resultKind.includes("權"));
      // 但「不知道」不等於「該警告」。上櫃沒有 TWT49U 對應端點（實測：1065 個收錄代號裡只有
      // 1 個上櫃），所以每一筆用 exchange-quote 認出來的上櫃事件都沒有 kind——而全市場 90.6%
      // 的事件是純除息、股數根本沒變。對它們全部掛標籤等於在 260 檔裡標 44 檔（實測 16.9%），
      // 那是雜訊不是訊號。只有拿得到**正面證據**說股數真的變了、卻量不出倍數時才值得說。
      const shareChangeLikely = resultKind.includes("權")
        || String(officialAction?.kind || "").includes("權")
        || String(source || "").startsWith("heuristic"); // 跳空 >10.5%，純配息解釋不了
      // 同樣是「被調整的那些列在哪個座標系」的問題 → priorFromYahoo。
      if (priorFromYahoo) {
        if (rawSpace) {
          // 知道配股倍數才能換算到 Yahoo 座標系；換算不出來就寧可不調——
          // 寧可少還原一次現金股利，也不要把配股還原兩次（那會把事件前的價格整段壓低）。
          const converted = yahooSpaceRatio(ratio, yahooShareFactor);
          if (converted === null) {
            unresolvedIndices.push(index);
            continue;
          }
          ratio = converted;
        }
        // Yahoo 的成交量同樣已經按分割調整過，不可再乘一次——這是定義上的 1，不是猜的。
        shareFactor = 1;
        shareFactorKnown = true;
      }
      adjustments.set(index, { ratio, source, shareFactor, shareFactorKnown });
      if (!shareFactorKnown && shareChangeLikely) shareFactorUnknownIndices.push(index);
    }
    if (officialUnresolved) {
      unresolvedIndices.push(index);
    }
  }
  adjustments.unresolvedIndices = unresolvedIndices;
  adjustments.historyGapIndices = historyGapIndices;
  // 有正面證據說股數變了、卻量不出倍數的那些天：成交量沒有按股數還原，
  // 量比（今日量 ÷ 前 N 日均量）會被高估。
  adjustments.shareFactorUnknownIndices = shareFactorUnknownIndices;
  return adjustments;
}

function backAdjustForCorporateActions(rows, officialActions, options) {
  if (rows.length < 2) return rows;
  const adjusted = rows.map((row) => ({ ...row }));
  const adjustments = resolveCorporateActionAdjustments(rows, officialActions, options);
  let factor = 1;
  let volumeFactor = 1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (factor !== 1) {
      for (const field of ["open", "high", "low", "close", "previousClose"]) {
        if (Number.isFinite(rows[i][field])) adjusted[i][field] = rows[i][field] * factor;
      }
    }
    if (volumeFactor !== 1) {
      for (const field of ["volumeLots", "volumeShares", "volume"]) {
        if (Number.isFinite(rows[i][field])) adjusted[i][field] = rows[i][field] * volumeFactor;
      }
    }
    const adjustment = adjustments.get(i);
    if (adjustment) {
      factor *= adjustment.ratio;
      volumeFactor *= adjustment.shareFactor || 1;
    }
  }
  return adjusted;
}

// 還原權息必須在「日 K」層完成，再彙總成週／月，順序不可顛倒。
// 先彙總再還原的話，除權息當天會先跟同週（同月）其他交易日混成一根，事件前後的價格被平均掉，
// 還原因子就再也套不到正確的邊界上：那根週 K 會同時留著「還原前的開盤」與「還原後的收盤」，
// 憑空長出一根假長黑，而且之後每一根的相對位置全歪。
function buildAdjustedPeriodRows(dailyHistory, officialActions, {
  period = "day",
  allowHeuristicFallback = false,
  maxBars = 180,
} = {}) {
  const complete = (row) => [row.open, row.high, row.low, row.close].every(Number.isFinite);
  // 先在日線層濾掉半根 K：缺 close 會直接斷掉還原因子的推導鏈（前收拿不到就算不出比率），
  // 留著只會讓某個事件被靜默跳過。
  const dailyRows = (dailyHistory || []).filter(complete);
  const options = { allowHeuristicFallback };
  const adjustments = resolveCorporateActionAdjustments(dailyRows, officialActions, options);
  const adjustedDaily = backAdjustForCorporateActions(dailyRows, officialActions, options);
  const allPeriods = addPreviousClose(aggregateHistoryByPeriod(adjustedDaily, period)).filter(complete);
  const rows = maxBars > 0 ? allPeriods.slice(-maxBars) : allPeriods;

  // 只有落在可見區間內的事件會影響畫面：還原因子從最後一根往回累乘，一個事件只調整
  // 「它之前」的 K。所以比第一根可見 K 更早的事件對這張圖毫無作用，列出來只會讓使用者
  // 以為圖上有他看不到的調整。事件正好落在第一根可見 K 當天也一樣——被調整的全在畫面外。
  const cut = allPeriods.length - rows.length;
  const lastHiddenDate = cut > 0 ? toCompactDate(allPeriods[cut - 1]?.date) : "";
  // 週／月 K 的 date 是該期間的最後一個交易日，所以可見起點要換算回「日」層再比。
  const firstVisibleDate = dailyRows
    .map((row) => toCompactDate(row.date))
    .find((date) => date && (!lastHiddenDate || date > lastHiddenDate)) || "";
  const dateAt = (index) => toCompactDate(dailyRows[index]?.date);
  const inWindow = (index) => {
    const date = dateAt(index);
    return Boolean(date) && Boolean(firstVisibleDate) && date > firstVisibleDate;
  };
  const events = [...adjustments.entries()]
    .filter(([index]) => inWindow(index))
    .map(([index, adjustment]) => ({
      date: dateAt(index),
      source: adjustment.source,
      ratio: roundTo(adjustment.ratio, 4),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const unresolvedDates = (adjustments.unresolvedIndices || [])
    .filter((index) => inWindow(index))
    .map((index) => dateAt(index))
    .filter(Boolean);

  const hasOfficial = events.some((event) => isOfficialCorporateActionSource(event.source));
  const hasEstimated = events.some((event) => !isOfficialCorporateActionSource(event.source));
  const officialCount = events.filter((event) => isOfficialCorporateActionSource(event.source)).length;
  const estimatedCount = events.length - officialCount;
  // 用詞受 stock1-domain 約束：只有官方公告可以講「除權息」，跳空推測一律寫「疑似／估算還原」，
  // 不能讓使用者以為那天一定發生過公司行動。
  const notes = [];
  if (officialCount > 0) {
    notes.push(`圖上歷史價格已依官方除權息公告還原 ${officialCount} 次，與當時的實際成交價不同；最新一根維持實際價格。`);
  }
  if (estimatedCount > 0) {
    notes.push(`另有 ${estimatedCount} 次為「疑似公司行動」的跳空估算還原（非官方確認），僅供圖形參考。`);
  }
  if (unresolvedDates.length > 0) {
    notes.push(`${unresolvedDates.map(compactToSlashDate).join("、")} 官方公司行動的公式欄位尚未齊備，該日之前的價格未經正確還原，暫不提供型態結論。`);
  }
  if (!allowHeuristicFallback) {
    notes.push("ETF／權證等商品沒有 ±10% 漲跌幅前提，不套用跳空估算還原，只在有官方公告時還原。");
  }
  return {
    rows,
    corporateActions: {
      adjusted: events.length > 0,
      source: hasOfficial && hasEstimated ? "mixed" : hasOfficial ? "official" : hasEstimated ? "heuristic" : "",
      events,
      unresolvedDates,
      heuristicAllowed: Boolean(allowHeuristicFallback),
      // 升級成醒目提示的條件：只要圖上有「非官方確認」的估算還原，或有算不出來的官方事件。
      // 純官方還原是正常且精確的，天天都會發生（台股大多年年配息），不該長年掛著警示。
      alert: unresolvedDates.length > 0 || hasEstimated,
      notes,
    },
  };
}

// 台股漲停＝前收 × 1.1，再**向下**取到合法申報價位。所以「漲幅 ≥ 9.5%」判漲停並不精確：
// 實測前收 99.5 的漲停是 109（+9.55%）、前收 990 是 1085（+9.60%），低價股更接近 9.5 的邊界。
// 一定要反推真實漲停價再比對。
function stockLimitUpPrice(previousClose) {
  if (!Number.isFinite(previousClose) || previousClose <= 0) return null;
  return roundToStockTick(previousClose * 1.1, "down");
}

// 「收在漲停」不等於「買不到」——實測 240 檔逐日回放 3,571 個合格 pick 裡有 233 個（6.52%）
// 收在漲停價，但其中 231 個盤中有開（high > low），整天都買得到，只是收盤剛好落在漲停。
// 真正買不到的是**一價鎖死**：整天只有漲停這一個成交價（2 個，0.06%）。
function isLimitUpLockedBar(row, previousRow) {
  const limit = stockLimitUpPrice(Number(previousRow?.close));
  if (limit === null) return false;
  const high = Number(row?.high);
  const low = Number(row?.low);
  const close = Number(row?.close);
  if (![high, low, close].every(Number.isFinite)) return false;
  return high === low && Math.abs(close - limit) < 1e-9;
}

function computeSwingFeatures(rawRows, officialActions, options) {
  if (rawRows.length < 60) return null;
  const adjustments = resolveCorporateActionAdjustments(rawRows, officialActions, options);
  const recentStart = Math.max(1, rawRows.length - 21);
  const recentAdjustments = [...adjustments.entries()].filter(([index]) => index >= recentStart);
  const recentCorporateGap = recentAdjustments.length > 0; // 舊欄名相容；現在可由官方或降級估算觸發
  const hasRecentOfficial = recentAdjustments.some(([, adjustment]) => isOfficialCorporateActionSource(adjustment.source));
  const hasRecentHeuristic = recentAdjustments.some(([, adjustment]) => !isOfficialCorporateActionSource(adjustment.source));
  const recentCorporateActionSource = hasRecentOfficial && hasRecentHeuristic
    ? "mixed"
    : hasRecentOfficial ? "official" : hasRecentHeuristic ? "heuristic" : "";
  const corporateActionUnresolvedIndices = adjustments.unresolvedIndices || [];
  // 漲停鎖死：整天只有一個成交價、而且那個價就是漲停價 → 掛買單根本排不到，
  // 而 plan.entry 取的正是當日收盤（D-23）。必須用**原始價**判斷：rows 是還原後的，
  // 還原會把事件前的價格整段縮放，拿它比漲停價一定不準。
  const limitUpLocked = isLimitUpLockedBar(rawRows.at(-1), rawRows.at(-2));
  const rows = backAdjustForCorporateActions(rawRows, officialActions, options);
  const lastIndex = rows.length - 1;
  const last = rows[lastIndex];
  const prev = rows[lastIndex - 1];
  if (!last || !prev || !Number.isFinite(last.close) || !Number.isFinite(prev.close)) return null;

  const ma5Series = movingAverageSeries(rows, "close", 5);
  const ma10Series = movingAverageSeries(rows, "close", 10);
  const ma20Series = movingAverageSeries(rows, "close", 20);
  const ma60Series = movingAverageSeries(rows, "close", 60);
  const boll = bollingerSeries(rows, 20, 2);
  const macd = computeMacd(rows, 8, 17, 9);
  const swings = findSwingPoints(rows, 2);

  const ma5 = ma5Series[lastIndex];
  const ma10 = ma10Series[lastIndex];
  const ma20 = ma20Series[lastIndex];
  const ma60 = ma60Series[lastIndex];
  const ma20Prev5 = ma20Series[lastIndex - 5];
  const lastBoll = boll[lastIndex];

  // MACD 金叉狀態與維持天數（DIF 在 DEA 之上）。
  const difDea = macd.map((row) => (Number.isFinite(row.dif) && Number.isFinite(row.dea) ? row.dif - row.dea : null));
  const goldenCross = Number.isFinite(difDea[lastIndex]) && difDea[lastIndex] > 0;
  let goldenCrossDays = 0;
  for (let index = lastIndex; index > 0; index -= 1) {
    if (!(Number.isFinite(difDea[index]) && difDea[index] > 0)) break;
    goldenCrossDays += 1;
  }
  const histRising = Number.isFinite(macd[lastIndex]?.histogram)
    && Number.isFinite(macd[lastIndex - 1]?.histogram)
    && macd[lastIndex].histogram >= macd[lastIndex - 1].histogram;

  // 連續站穩中軌（收盤 ≥ MA20）的天數。
  let daysAboveMid = 0;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const mid = boll[index]?.mid;
    if (Number.isFinite(mid) && rows[index].close >= mid) daysAboveMid += 1;
    else break;
  }

  // 回檔深度：近 20 日高點，到**那個高點之後**的最低價（D-11）。
  // 舊寫法 recentHigh 取近 20 根、pullbackLow 取近 12 根——兩個視窗長度不同，而且完全沒有
  // 要求低點發生在高點之後。算出來的是「區間振幅」，不是回檔深度；註解自稱「高點到站穩前的
  // 回檔低點」，程式沒有實作那個「之後」。實測 240 檔逐日回放 29,616 次：46.4% 的數值會變，
  // 例如 3481 群創 2026/05/25 由 41.65% 變成 0.00%——那 41.65% 是整段漲勢的振幅，
  // 該股當天還在創新高，根本沒有回檔過。
  // 視窗統一成 20 根：時序約束本身就會把搜尋範圍收斂到高點之後，不需要第二個長度。
  const window20 = rows.slice(-20);
  let recentHigh = -Infinity;
  let highIndex = -1;
  for (let index = 0; index < window20.length; index += 1) {
    const high = Number(window20[index].high);
    // 用 `>` 保留**最早**出現的那根高點：同價位再次觸及時，從第一次算起才涵蓋得到中間的回檔。
    if (Number.isFinite(high) && high > recentHigh) { recentHigh = high; highIndex = index; }
  }
  // 高點就是最後一根＝還在創新高，**還沒有一段完成的回檔**。這時 pullbackLow 是 null 而不是
  // 「今天的最低價」——拿當日的上影線當回檔會憑空生出一個幅度，量測幅度也會跟著失真。
  let pullbackLow = highIndex >= 0 && highIndex < window20.length - 1 ? Infinity : null;
  if (pullbackLow !== null) {
    for (let index = highIndex + 1; index < window20.length; index += 1) {
      const low = Number(window20[index].low);
      if (Number.isFinite(low) && low < pullbackLow) pullbackLow = low;
    }
    if (!Number.isFinite(pullbackLow)) pullbackLow = null;
  }
  if (highIndex < 0) recentHigh = NaN;
  const pullbackDepthPct = Number.isFinite(recentHigh) && recentHigh > 0 && Number.isFinite(pullbackLow)
    ? ((recentHigh - pullbackLow) / recentHigh) * 100
    : 0;

  const avgVol5 = average(rows.slice(-6, -1).map((row) => row.volumeLots));
  const avgVol20 = average(rows.slice(-21, -1).map((row) => row.volumeLots));
  const volumeRatio5 = avgVol5 ? last.volumeLots / avgVol5 : null;
  const changePct = prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const ma20Slope = Number.isFinite(ma20) && Number.isFinite(ma20Prev5) && ma20Prev5
    ? ((ma20 - ma20Prev5) / ma20Prev5) * 100
    : 0;
  const distToMidPct = Number.isFinite(lastBoll?.mid) && lastBoll.mid
    ? ((last.close - lastBoll.mid) / lastBoll.mid) * 100
    : null;
  // 距中軌以「σ（標準差）」衡量：0=貼中軌、2=站上軌。比固定 % 更能反映個股波動，
  // 用來判斷是否真的「貼著中軌防守」而非已經噴出去。
  const sigmaUp = Number.isFinite(lastBoll?.upper) && Number.isFinite(lastBoll?.mid)
    ? (lastBoll.upper - lastBoll.mid) / 2
    : null;
  const bandSigma = Number.isFinite(sigmaUp) && sigmaUp > 0
    ? (last.close - lastBoll.mid) / sigmaUp
    : null;

  return {
    last,
    prev,
    changePct,
    ma5,
    ma10,
    ma20,
    ma60,
    ma20Slope,
    boll: lastBoll,
    bollSeries: boll,
    macd,
    swings,
    goldenCross,
    goldenCrossDays,
    histRising,
    daysAboveMid,
    recentHigh,
    pullbackLow,
    pullbackDepthPct,
    avgVol5,
    avgVol20,
    volumeRatio5,
    distToMidPct,
    bandSigma,
    recentCorporateGap,
    recentCorporateActionSource,
    corporateActionUnresolved: corporateActionUnresolvedIndices.length > 0,
    corporateActionUnresolvedDates: corporateActionUnresolvedIndices.map((index) => toCompactDate(rawRows[index]?.date)).filter(Boolean),
    // 歷史序列有日期缺口（多半是逐檔月歷史被限流、失敗被吞成空陣列）：跳空不套 heuristic，
    // 但均線／通道會跨越缺口計算，數值仍不完全可信，必須讓上層看得到。
    historyGap: (adjustments.historyGapIndices || []).length > 0,
    historyGapDates: (adjustments.historyGapIndices || [])
      .map((index) => toCompactDate(rawRows[index]?.date)).filter(Boolean),
    // 配股／現增／減資會改變股數，成交量要按同一個倍數還原才可比。倍數推導不出來時
    // （官方結果表說有「權」但歸檔沒有那一筆，或整段只有跳空推測）沿用 1——這會讓事件前的
    // 均量偏低、量比偏高。只有落在量比視窗（前 20 根）內的才影響得到數字。
    // 進場價（＝當日收盤）今天根本掛不到單：整天只有漲停這一個成交價。
    limitUpLocked,
    volumeFactorUnknown: (adjustments.shareFactorUnknownIndices || [])
      .some((index) => index >= rawRows.length - 20),
    volumeFactorUnknownDates: (adjustments.shareFactorUnknownIndices || [])
      .filter((index) => index >= rawRows.length - 20)
      .map((index) => toCompactDate(rawRows[index]?.date)).filter(Boolean),
    atr: averageTrueRange(rows, 14),
    rows,
  };
}

// 「中軌攻防」型態的可調參數：
const SWING_NEAR_BAND_SIGMA = 1.0; // 距中軌 ≤1.0σ 才算「貼著中軌防守」（0=中軌、2σ=上軌；>1σ 已往上軌走，屬突破/追高，不是中軌攻防）
const SWING_MIN_GOLDEN_DAYS = 2;   // MACD 需「連續≥2天」維持金叉，濾掉單根 K 的臨界假訊號（whipsaw）
const SWING_MAX_DOWN_DAY = -6;     // 「站穩」要件：當日(還原後)跌幅不得超過 6%，擋掉雖在中軌上方但今天正在破底/跌停的股
const SWING_MIN_RR = 1;            // 盈虧比下限，套在**淨** RR（已扣來回成本）上：報酬至少要等於風險才入選。也順帶淘汰「離中軌過遠→停損遠→RR爛」的股
const SWING_MIN_SCAN_COVERAGE = 0.7; // 至少 70% 候選有當日新鮮歷史，才可寫正式每日快照／驗證單。
// 選股邏輯版本：改動後快照版本不符就重算，避免沿用舊邏輯算出的清單（也讓「更完整才覆蓋」只在同版本內比較）。
// v18：拿掉目標價的「至少 +3%」下限（D-25）。那道下限會在上方壓力很近時把目標硬抬過壓力，
// reward 憑空變大、RR 虛胖，讓本該被 SWING_MIN_RR 剔除的設定通過——RR≥1 這道關等於失效。
// 實測 2026-07-24：13 檔通過 RR≥1 的標的裡，有 6 檔的目標是被這道下限抬上去的。
// 必須升版：驗證單記錄的是建立當下的 target，混在同一個分母裡等於把「目標被膨脹過的交易」
// 與「目標誠實的交易」當成同一組樣本統計，而兩者的觸價難度本質上不同。
// v17 只累積了不到一天的 pending 樣本、尚未產生任何已顯示的統計，代價極小。
// v19：回檔深度加上「低點必須在高點之後」的時序約束（D-11）。門檻數字沒動，但
// pullbackDepthPct 與量測幅度的算法變了，會改變哪些標的通過「曾回檔 ≥3%」與 RR≥1。
// v21：SWING_MIN_RR 改套在**淨** RR（已扣 0.471% 來回成本）上。門檻數字沒動，但毛 RR
// 1.0~1.2 那一段會被剔除——那些是「看起來剛好過關、扣掉成本其實賠錢」的設定。
// v20：走 Yahoo 備援時最後一根 K 的成交金額改由整批收盤補回（原本恆為 null）。
// scoreSwing 的流動性項最多 10 分，補回來之後排序會變 → 影響 recordSwingVerification
// 每個場景取前 40 檔的挑選順序，所以要與舊樣本分開統計。
const SWING_FORMULA_VERSION = "swing-v21-net-rr-gate";

// 台股普通股升降單位：策略建議價必須是交易所可申報的價格，不能只四捨五入到小數二位。
function stockTickSize(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 10) return 0.01;
  if (value < 50) return 0.05;
  if (value < 100) return 0.1;
  if (value < 500) return 0.5;
  if (value < 1000) return 1;
  return 5;
}

function roundToStockTick(price, direction = "nearest") {
  const tick = stockTickSize(price);
  if (!tick) return null;
  const units = Number(price) / tick;
  const roundedUnits = direction === "down"
    ? Math.floor(units + 1e-9)
    : direction === "up"
      ? Math.ceil(units - 1e-9)
      : Math.round(units);
  return Number((roundedUnits * tick).toFixed(2));
}

// 場景偵測器：每個偵測器看 features，命中就回傳 {key,name,desc,warns}。
// 波段場景集中在同一組偵測器：目前提供「中軌攻防」與「上軌續攻」。
// 把帶正負號的數字格式化（給檢核明細用，例「+0.5σ」「-3.2%」）。
function signed(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  const v = roundTo(value);
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

const SWING_SCENARIOS = [
  {
    key: "midBandDefense",
    name: "中軌攻防",
    // evaluate：攤出每一條判定門檻的通過與否與實際值，供「型態健檢」逐條顯示；detect 由 evaluate 推導，
    // 對外行為與舊版完全一致（全部通過才算命中）。
    evaluate(f) {
      const haveBase = Number.isFinite(f.ma20) && Number.isFinite(f.boll?.mid);
      const mid = f.boll?.mid;
      const checks = [
        { label: "站上中軌", pass: haveBase && f.last.close >= mid,
          detail: haveBase ? `收 ${roundTo(f.last.close)}・中軌 ${roundTo(mid)}` : "指標資料不足" },
        { label: "站穩中軌 ≥3 天", pass: f.daysAboveMid >= 3, detail: `已站穩 ${f.daysAboveMid} 天` },
        { label: `MACD 維持金叉 ≥${SWING_MIN_GOLDEN_DAYS} 天`, pass: f.goldenCrossDays >= SWING_MIN_GOLDEN_DAYS, detail: `連續 ${f.goldenCrossDays} 天` },
        { label: "曾回檔 ≥3%", pass: f.pullbackDepthPct >= 3, detail: `回檔 ${roundTo(f.pullbackDepthPct)}%` },
        { label: "多頭結構", pass: !Number.isFinite(f.ma60) || f.last.close >= f.ma60 || f.ma20Slope > 0,
          detail: `${Number.isFinite(f.ma60) ? `季線 ${roundTo(f.ma60)}・` : ""}斜率 ${signed(f.ma20Slope)}%` },
        { label: `貼近中軌 ≤${SWING_NEAR_BAND_SIGMA}σ`, pass: Number.isFinite(f.bandSigma) && f.bandSigma <= SWING_NEAR_BAND_SIGMA,
          detail: Number.isFinite(f.bandSigma) ? `距中軌 ${signed(f.bandSigma)}σ` : "指標資料不足" },
        { label: "今日沒大跌", pass: !Number.isFinite(f.changePct) || f.changePct >= SWING_MAX_DOWN_DAY, detail: `今日 ${signed(f.changePct)}%` },
      ];
      const passed = haveBase && checks.every((c) => c.pass);
      const warns = [];
      if (Number.isFinite(f.bandSigma) && f.bandSigma > 0.7) warns.push("略高於中軌");
      if (f.recentCorporateGap) warns.push(f.recentCorporateActionSource === "official"
        ? "近期除權息(官方已還原)"
        : f.recentCorporateActionSource === "mixed" ? "近期權息含疑似跳空(官方＋估算還原)" : "近期疑似權息跳空(估算還原)");
      if (f.corporateActionUnresolved) warns.push("公司行為公式資料未完整");
      if (f.historyGap) warns.push("官方歷史有日期缺口(均線可能失真)");
      if (f.volumeFactorUnknown) warns.push("配股比率未公告(量比可能偏高)");
      return { checks, passed, warns, desc: `回檔中軌後站穩${f.daysAboveMid}天，MACD連續${f.goldenCrossDays}天維持金叉` };
    },
    detect(f) {
      const r = this.evaluate(f);
      return r.passed ? { key: this.key, name: this.name, desc: r.desc, warns: r.warns } : null;
    },
  },
  {
    key: "strongContinuation",
    // 顯示名「上軌續攻」：與「中軌攻防」成對（都以布林軌道命名），也跟「隔日沖」分頁的「強勢續攻」
    // （看當日單根 K 夠不夠強、賭隔天）區隔，避免使用者把兩個不同週期的策略搞混。
    name: "上軌續攻",
    // 沿著布林上軌往上的強勢趨勢續攻：跟「中軌攻防」互補（強勢盤用這個）。
    // 與中軌攻防互斥（一個要 ≤1σ 貼中軌、一個要 ≥1.3σ 貼上軌）。
    evaluate(f) {
      const haveBase = Number.isFinite(f.ma20) && Number.isFinite(f.boll?.mid) && Number.isFinite(f.bandSigma);
      const mid = f.boll?.mid;
      const checks = [
        { label: "站上中軌", pass: haveBase && f.last.close >= mid,
          detail: haveBase ? `收 ${roundTo(f.last.close)}・中軌 ${roundTo(mid)}` : "指標資料不足" },
        { label: "貼上軌 1.3~3σ", pass: haveBase && f.bandSigma >= 1.3 && f.bandSigma <= 3.0,
          detail: Number.isFinite(f.bandSigma) ? `距中軌 ${signed(f.bandSigma)}σ` : "指標資料不足" },
        { label: "站上均線、中軌上揚", pass: f.last.close > f.ma20 && (!Number.isFinite(f.ma60) || f.last.close > f.ma60) && f.ma20Slope > 0,
          detail: `中線 ${roundTo(f.ma20)}・斜率 ${signed(f.ma20Slope)}%` },
        { label: "短均線在上", pass: !Number.isFinite(f.ma5) || !Number.isFinite(f.ma20) || f.ma5 >= f.ma20,
          detail: `MA5 ${roundTo(f.ma5)}・MA20 ${roundTo(f.ma20)}` },
        { label: `MACD 維持金叉 ≥${SWING_MIN_GOLDEN_DAYS} 天`, pass: f.goldenCrossDays >= SWING_MIN_GOLDEN_DAYS, detail: `連續 ${f.goldenCrossDays} 天` },
        { label: "量能不萎縮", pass: !Number.isFinite(f.volumeRatio5) || f.volumeRatio5 >= 0.8,
          detail: Number.isFinite(f.volumeRatio5) ? `量比 ${roundTo(f.volumeRatio5)}` : "指標資料不足" },
        { label: "今日沒大跌", pass: !Number.isFinite(f.changePct) || f.changePct >= SWING_MAX_DOWN_DAY, detail: `今日 ${signed(f.changePct)}%` },
      ];
      const passed = haveBase && checks.every((c) => c.pass);
      const warns = [];
      if (f.bandSigma > 2.0) warns.push("已突破上軌");
      if (Number.isFinite(f.volumeRatio5) && f.volumeRatio5 < 1) warns.push("量縮");
      if (f.recentCorporateGap) warns.push(f.recentCorporateActionSource === "official"
        ? "近期除權息(官方已還原)"
        : f.recentCorporateActionSource === "mixed" ? "近期權息含疑似跳空(官方＋估算還原)" : "近期疑似權息跳空(估算還原)");
      if (f.corporateActionUnresolved) warns.push("公司行為公式資料未完整");
      if (f.historyGap) warns.push("官方歷史有日期缺口(均線可能失真)");
      if (f.volumeFactorUnknown) warns.push("配股比率未公告(量比可能偏高)");
      return { checks, passed, warns, desc: `沿上軌強勢，MACD連續${f.goldenCrossDays}天維持金叉${f.histRising ? "、柱狀放大" : ""}` };
    },
    detect(f) {
      const r = this.evaluate(f);
      return r.passed ? { key: this.key, name: this.name, desc: r.desc, warns: r.warns } : null;
    },
  },
];

function classifySwingScenario(features, scenarioKey = "") {
  for (const detector of SWING_SCENARIOS) {
    if (scenarioKey && detector.key !== scenarioKey) continue;
    const hit = detector.detect(features);
    if (hit) return hit;
  }
  return null;
}

// 交易計畫：進場=收盤；建議停損固定 -5%、啟動移停固定 +5%（對齊參考 App 的簡單規則）；
// 結構停損取「擺動低點 / 布林下軌 / MA20」中最接近價格的支撐；目標取擺動高點，否則用量測幅度。
function buildSwingPlan(features) {
  const entry = roundToStockTick(features.last.close);
  const initialStop = roundToStockTick(entry * 0.95, "down");
  const trailingTrigger = roundToStockTick(entry * 1.05, "up");

  const swingLow = features.swings.lows.at(-1)?.price;
  const supports = [swingLow, features.boll?.lower, features.ma20]
    .filter((value) => Number.isFinite(value) && value < entry);
  let structuralStop = supports.length ? Math.max(...supports) : entry * 0.9;
  structuralStop = Math.max(structuralStop, entry * 0.82);  // 結構停損不超過 -18%
  structuralStop = Math.min(structuralStop, entry * 0.98);  // 也至少留 2% 風險，避免 RR 爆量
  structuralStop = roundToStockTick(structuralStop, "down");

  const risk = entry - structuralStop;
  // 目標優先用「上方最近的壓力」（擺動高點中高於現價者取最低的那個）；
  // 若已創新高、上方無壓力，改用「量測幅度」（本波回檔前的高低差往上投射）。
  // 這樣盈虧比會隨個股結構自然變化（接近壓力 RR 小、剛起漲 RR 大），而不是恆等於 2R。
  // `> entry × 1.02` 這道過濾**刻意保留**，而且它不是 D-25 那類的缺陷。
  // 「上軌續攻」選的就是貼著近期高點的股票，所以最近的擺動高點必然貼著收盤價：
  // 實測 2026-07-24 通過的 16 檔裡有 11 檔的最近擺動高點在 +0.11%~+1.81%（陽明 +0.11%、
  // 聯強 +0.23%、興富發 +0.34%），拿它們當目標算出來的 RR 是 0.00~0.53，整批會被剔除。
  // 那些價位不是「可以獲利了結的壓力」，是收盤價本身的雜訊。
  // 與 D-25 的差別：+3% 下限是把目標**抬到壓力之上**（憑空造出報酬）；這道過濾是**跳過
  // 不能用的價位**改用量測幅度，是不同的操作。
  // 但被跳過的價位仍然是真實的關卡（例如威強電壓力在 +1.81%、目標卻在 +15%），
  // 所以下面把它一起回傳，讓畫面說出來——不改數字，只是不再隱瞞。
  const upperHighs = features.swings.highs
    .map((point) => point.price)
    .filter((price) => Number.isFinite(price) && price > entry);
  const nearestResistance = upperHighs.length ? Math.min(...upperHighs) : null;
  const overheadHighs = upperHighs.filter((price) => price > entry * 1.02);
  const overhead = overheadHighs.length ? Math.min(...overheadHighs) : null;
  // 量測幅度＝「本波回檔的高低差」往上投射。加上 D-11 的時序約束之後，這個幅度可能退化成 0
  // （高點就是最後一根，還沒回檔過）——那時量測幅度是**沒有定義**，不是零。
  // 舊寫法沒有區分，rawTarget 會等於 entry、target 取整後 reward=0、rr=0。
  // 順帶修掉一個死碼：`entry + risk * 2` 這條兜底原本永遠到不了（measuredMove 在兩個呼叫端
  // 都不可能是 null，因為它們已先把列過濾成 OHLC 全部有限），現在它才真的會被用到。
  const swingRange = Number.isFinite(features.recentHigh) && Number.isFinite(features.pullbackLow)
    ? features.recentHigh - features.pullbackLow
    : null;
  const measuredMove = Number.isFinite(swingRange) && swingRange > 0 ? entry + swingRange : null;
  // 結構停損至少留 2% 風險（見上面的 clamp），所以 2R 一定大於一個升降單位，不會退化成 entry。
  const rawTarget = overhead ?? measuredMove ?? entry + risk * 2;
  // D-25：舊寫法是 Math.max(conservativeTarget, roundToStockTick(entry * 1.03, "up"))，
  // 也就是「目標至少 +3%」的下限。它與同一行註解宣稱的「向下取整避免高估報酬」正好相反：
  // 上方壓力若只在 +1%，下限會把目標硬抬到壓力之上，reward 憑空變大、RR 跟著虛胖，
  // 於是本該被 SWING_MIN_RR 剔除的設定剛好通過。實測 2026-07-24：現行 13 檔通過 RR≥1，
  // 其中 6 檔的目標是被這道下限抬上去的（中租-KY 1.0→1.6、興富發 1.0→1.5）。
  // 下限的用意應該是「不要提出目標太小的交易」，但正確的回應是**拒絕這筆交易**（RR 不足），
  // 不是把目標膨脹到通過門檻。拿掉之後 RR≥1 這道關才真的在做它宣稱的事。
  const target = roundToStockTick(rawTarget, "down"); // 一律向下取整，不再有下限

  const reward = target - entry;
  const rr = risk > 0 ? roundTo(reward / risk) : null;
  // 淨盈虧比：來回成本打**兩邊**——它同時吃掉報酬、又墊高實際虧損。
  //   淨報酬 = 目標 − 進場 − 成本×進場       淨風險 = 進場 − 停損 + 成本×進場
  // 所以淨 RR = 1 的臨界是「reward − risk > 2 × 成本 × 進場價」＝ 進場價的 0.942%。
  // 這是 `SWING_MIN_RR` 真正該把關的數字：那道門檻宣稱「風險大於報酬的設定不值得做」，
  // 用毛價算的話在邊緣區間根本沒做到——實測 2026-07-24 通過毛 RR≥1 的 16 檔裡，
  // 5 檔的淨 RR 其實 <1（中租-KY 1.00→0.63、至上 1.10→0.75、聯強 1.10→0.75）。
  // 這與 D-25 拿掉 +3% 下限是同一類問題：一道門檻沒有在做它宣稱的事。
  // 毛 RR 仍然保留並顯示——它是「圖上的結構」；淨 RR 是「值不值得做」，用它把關。
  // 成本本身仍是低估：VERIFY_COST_NOTE 已載明未計每筆最低 20 元手續費與滑價。
  const costPerShare = entry * (VERIFY_ROUND_TRIP_COST_PCT / 100);
  const netRisk = risk + costPerShare;
  const rrNet = netRisk > 0 ? roundTo((reward - costPerShare) / netRisk) : null;
  return {
    entry, initialStop, trailingTrigger, structuralStop, target, rr, rrNet,
    // 被 2% 過濾跳過的最近壓力：不影響目標，但使用者該知道上方還有關卡。
    nearestResistance: nearestResistance !== null && (overhead === null || nearestResistance < overhead)
      ? roundTo(nearestResistance)
      : null,
  };
}

// 0~100 連續評分：趨勢結構 + MACD 動能 + 攻防區位置 + 量能 + 流動性。權重可調。
// 用連續量（斜率、天數、距中軌幅度、量比、成交值）而非單純過門檻，排行榜才有鑑別度。
function scoreSwing(features, plan, scenarioKey = "midBandDefense") {
  let score = 0;
  // 趨勢結構（上限 ~26）
  if (Number.isFinite(features.ma20)) score += features.last.close > features.ma20 ? 8 : 0;
  if (Number.isFinite(features.ma60)) score += features.last.close > features.ma60 ? 6 : 0;
  if (Number.isFinite(features.ma5) && Number.isFinite(features.ma20)) score += features.ma5 > features.ma20 ? 6 : 0;
  score += Math.max(0, Math.min(6, features.ma20Slope * 3));            // 中軌斜率，越陡越高
  // MACD 動能（上限 ~22）
  if (features.goldenCross) score += 6;
  if (features.histRising) score += 6;
  score += Math.max(0, Math.min(10, features.goldenCrossDays));         // 金叉維持天數，封頂 10
  // 位置分（上限 ~16）：依場景不同。中軌攻防越貼中軌越好；強勢續攻越貼上軌越好（沿上軌續攻）。
  if (Number.isFinite(features.bandSigma)) {
    const s = Math.abs(features.bandSigma);
    if (scenarioKey === "strongContinuation") {
      score += s <= 1.8 ? Math.min(14, s * 8) : Math.max(0, 14 - (s - 1.8) * 10); // 約 1.8σ（貼上軌）最高，過度延伸扣分
    } else {
      score += Math.max(0, 16 - s * 8); // 0σ→16、1σ→8、2σ→0
    }
  }
  // 量能（上限 ~10）
  if (Number.isFinite(features.volumeRatio5)) {
    score += Math.max(0, Math.min(10, (features.volumeRatio5 - 0.8) * 8));
  }
  // 流動性（上限 ~10）
  if (Number.isFinite(features.last.tradeValue) && features.last.tradeValue > 0) {
    score += Math.max(0, Math.min(10, Math.log10(features.last.tradeValue / 1e7) * 5));
  } else if (Number.isFinite(features.avgVol20) && features.avgVol20 > 0) {
    score += Math.max(0, Math.min(10, Math.log10(features.avgVol20) * 2.5));
  }
  // 盈虧比（上限 ~16）：把風險報酬納入排名，RR 越高越前面（RR 1→0、2→8、3→16）。
  // 這樣評分＝「型態品質 × 划不划算」，排名才不會把 RR 爛的設定排到前面。
  const rr = Number(plan?.rr);
  if (Number.isFinite(rr)) score += Math.max(0, Math.min(16, (rr - 1) * 8));
  return Math.round(Math.max(0, Math.min(100, score)));
}

function buildSwingPick(quote, features, scenario, plan, score) {
  return {
    code: quote.code,
    name: quote.name,
    exchange: quote.exchange,
    market: quote.exchange === "TPEx" ? "上櫃" : "上市",
    scenario,
    score,
    price: roundTo(features.last.close),
    changePct: roundTo(features.changePct),
    avgVolLots: Math.round(features.avgVol20 || 0),
    volumeRatio5: roundTo(features.volumeRatio5),
    // 今天整天只有漲停這一個成交價 → plan.entry 掛不到單。標示而不剔除：訊號本身是真的
    //（這檔確實強勢），只是今天這個價位進不去，明天的價格也不會是這個 entry。
    fillRisk: features.limitUpLocked ? "limit-up-locked" : null,
    plan,
    indicators: {
      ma5: roundTo(features.ma5),
      ma20: roundTo(features.ma20),
      ma60: roundTo(features.ma60),
      bollMid: roundTo(features.boll?.mid),
      bollUpper: roundTo(features.boll?.upper),
      bollLower: roundTo(features.boll?.lower),
      goldenCrossDays: features.goldenCrossDays,
      pullbackDepthPct: roundTo(features.pullbackDepthPct),
    },
    asOf: features.last.date,
  };
}

// 波段候選池：不限當日紅黑（要找回檔），只用流動性過濾再取前 N 檔送去抓歷史。
function preselectSwingQuotes(reference, riskSets, dateCompact, maxCandidates = 240) {
  // 注意/處置股不再剔除，改在 pick 上標示（前端可切換隱藏）。
  // 停牌/下市股則硬排除：掛單也不會成交，出現在清單只會誤導。
  return [...reference.byCode.values()]
    .filter(isOrdinaryStock)
    .filter((quote) => !riskSets?.halted?.has(quote.code) && !riskSets?.delisted?.has(quote.code))
    .filter((quote) => !dateCompact || !quote.rawDate || toCompactDate(quote.rawDate) <= dateCompact)
    .filter((quote) => Number.isFinite(quote.price) && Number.isFinite(quote.previousClose))
    .filter((quote) => (quote.volumeLots || 0) >= 500)
    .sort((a, b) => (b.volumeLots || 0) - (a.volumeLots || 0))
    .slice(0, maxCandidates)
    .map((quote) => quote);
}

// latestDate：取「最多個股共有的官方收盤日」（眾數），而非最新的單一日期。
// 當日剛收盤時 STOCK_DAY_ALL 常只先更新部分個股、或夾雜少數較新的即時報價日期；用 max 會讓板子
// 標成最新日，但多數個股其實只到前一個交易日的官方收盤 → 標籤與內容對不上（瑞昱事件的延伸）。
// 用眾數＝整體市場真正已結算的收盤日，再配合逐檔歷史一律 cap 在 latestDate，標籤與選股資料才一致。
function resolveMarketCloseDate(reference) {
  const dateCounts = new Map();
  for (const quote of reference.byCode.values()) {
    const day = toCompactDate(quote.rawDate || quote.asOf);
    if (day) dateCounts.set(day, (dateCounts.get(day) || 0) + 1);
  }
  return [...dateCounts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
}

// 補上「今日官方收盤」這一根：逐檔月歷史的當天 K 常比 STOCK_DAY_ALL（整批收盤）晚一天才更新，
// 但整批收盤參考資料(quote)早就有今天的 OHLC。差一天時直接補進去（免額外請求、不會被限流），
// 確保每檔都算到 latestDate；大缺口(>5天)已在 getStockHistory 走 Yahoo 取得完整序列，這裡不會重複補。
// 日期優先取 quote.asOf，只有 rawDate 的測試／備援資料也能經 toCompactDate 正規化。
function appendTodayCloseBar(history, quote, latestDate) {
  const latestHistDate = history.length ? toCompactDate(history[history.length - 1].date) : "";
  const quoteDate = toCompactDate(quote.asOf || quote.rawDate);
  // 歷史已經涵蓋到報價那一天 → 不必補一根，但**成交金額要補回去**。
  // Yahoo 備援序列的每一根 tradeValue 都是 null（chart API 根本沒有這個欄位），走到那條
  // 路徑時整批收盤的成交金額就進不了最後一根 K，下游的「低流動性」全部退化成「成交值未知」
  // ——實測連台積電都會這樣，流動性標籤等於失效，而它正是 D-33 要用來判斷的依據。
  // 兩者是同一個交易日、同一個官方來源（STOCK_DAY_ALL／上櫃整批收盤），補進去就是同一個數字。
  // 用 slice+concat 換掉最後一根而不是就地改：history 可能來自模組級快取，不可就地變更。
  if (quoteDate && quoteDate === latestHistDate && Number.isFinite(quote.tradeValue)
    && !Number.isFinite(history[history.length - 1]?.tradeValue)) {
    history = history.slice(0, -1).concat([{ ...history[history.length - 1], tradeValue: quote.tradeValue }]);
  }
  if (
    !quoteDate || quoteDate <= latestHistDate || quoteDate > latestDate ||
    ![quote.open, quote.high, quote.low, quote.price].every(Number.isFinite)
  ) {
    return history;
  }
  return history.concat([{
    date: compactToSlashDate(quoteDate),
    rawDate: quoteDate,
    code: quote.code,
    name: quote.name,
    exchange: quote.exchange,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.price,
    previousClose: quote.previousClose ?? null,
    // 這是用整批收盤現價補出來的當日 K，不是逐檔歷史，沒有交易所漲跌價差欄可依據。
    exchangePreviousClose: null,
    exchangeCorporateActionMark: false,
    change: null,
    volumeShares: Number.isFinite(quote.volumeLots) ? quote.volumeLots * 1000 : null,
    volumeLots: Number.isFinite(quote.volumeLots) ? quote.volumeLots : null,
    tradeValue: Number.isFinite(quote.tradeValue) ? quote.tradeValue : null,
    transactions: quote.transactions ?? null,
    source: "STOCK_DAY_ALL official close (appended)",
  }]);
}

// 回傳時依「要求的場景＋limit」切片：整份快照含所有場景的 picks，只給該場景的前 limit 檔，
// 並把 matchedCount 設成該場景的命中數（scenarios 那份計數整份共用、兩分頁一致）。
// 同一份快照可服務不同場景與不同 limit。
function sliceSwingBody(body, limit, scenarioKey = "") {
  const all = body.picks || [];
  const filtered = scenarioKey ? all.filter((pick) => pick.scenario?.key === scenarioKey) : all;
  const scenarioMatched = scenarioKey
    ? (body.scenarios || []).find((item) => item.key === scenarioKey)?.count ?? filtered.length
    : body.matchedCount;
  return {
    ...body,
    scenario: scenarioKey || "all",
    picks: filtered.slice(0, Math.max(1, limit)),
    matchedCount: scenarioMatched,
  };
}

// 只保留最近幾個交易日的快照，避免資料庫無限長大。
function pruneSwingSnapshots(store, keepDays = 7) {
  const cutoff = addDaysCompact(toTaipeiCompactDate(), -keepDays);
  for (const key of Object.keys(store)) {
    const datePart = String(key).split(":")[0];
    if (datePart && datePart < cutoff) delete store[key];
  }
}

// ===== 波段前向驗證成績單 =====
// 隔日沖有「隔天對答案」的成績單，波段一直沒有——使用者無從知道各場景的實際勝率。
// 做法：每天把看板選出的 picks（entry/停損/目標）存成驗證單，之後每個交易日用整批收盤的
// 當日高低價「逐日推進」（零額外請求）：先碰目標＝達標、先碰停損＝停損、15 個交易日沒碰＝超時結案。

function pruneSwingVerification(store, keepDays = 90) {
  const cutoff = addDaysCompact(toTaipeiCompactDate(), -keepDays);
  let changed = false;
  for (const key of Object.keys(store)) {
    if (key < cutoff) {
      delete store[key];
      changed = true;
    }
  }
  return changed;
}

// 看板掃描完成時記錄驗證單（同日去重、每場景最多 40 檔＝前端顯示上限）。
// entry 一旦建立就不可回溯刪除——它是「當時真的出現過的建議」；公式改版用 formulaVersion 區分統計。
// D-30：驗證單要記下「這筆訊號成立當時，這檔是怎麼撮合的」。
// 處置期間是分盤集合競價（每 5 或 20 分鐘撮合一次），日 K 的 high/low 只是幾十次撮合的極值，
// 掛在停損／目標的單未必真的撮得到。判定規則刻意不動（改口徑要另外決策），
// 但樣本裡必須留下這個事實，否則成績單分不出「連續競價下真的觸價」與「分盤下理論上碰到」。
// 而且沒存這欄的話，使用者就算在「更多→風險規則」關掉處置股，成績單也過濾不掉它們。
function swingVerificationFillModel(surveillance) {
  if (!surveillance || surveillance.kind !== "disposition") return "continuous";
  const interval = Number(surveillance.interval);
  if (interval === 5) return "periodicCall5";
  if (interval === 20) return "periodicCall20";
  return "periodicCall"; // 確定是處置，但看板沒熱、拿不到分盤間隔
}

function recordSwingVerification(db, body) {
  const day = toCompactDate(body?.asOf);
  if (!day || !Array.isArray(body?.picks) || body.provisional || body.coverage?.complete === false) return;
  db.swingVerification ||= {};
  const list = (db.swingVerification[day] ||= []);
  const bodyVersion = body.formulaVersion || "legacy";
  const seen = new Set(list.map((entry) => `${entry.code}:${entry.scenario}:${entry.formulaVersion || "legacy"}`));
  const perScenario = new Map();
  let changed = false;
  for (const entry of list) {
    const scenarioVersion = `${entry.scenario}:${entry.formulaVersion || "legacy"}`;
    perScenario.set(scenarioVersion, (perScenario.get(scenarioVersion) || 0) + 1);
  }
  for (const pick of body.picks) {
    const scenario = pick.scenario?.key || "unknown";
    const scenarioVersion = `${scenario}:${bodyVersion}`;
    if ((perScenario.get(scenarioVersion) || 0) >= 40) continue;
    const key = `${pick.code}:${scenario}:${bodyVersion}`;
    if (seen.has(key)) continue;
    const plan = pick.plan || {};
    if (!Number.isFinite(plan.entry) || !Number.isFinite(plan.structuralStop) || !Number.isFinite(plan.target)) continue;
    // 漲停鎖死那天的收盤價掛不到單，這筆「交易」在真實世界不存在。建立驗證單等於憑空多一個
    // 起跑點極度有利的樣本——隔天只要高點過目標就記一筆勝利，勝率被灌水（D-23）。
    // 標的本身照樣留在看板上（標 fillRisk），只是不進統計分母。
    if (pick.fillRisk === "limit-up-locked") continue;
    seen.add(key);
    perScenario.set(scenarioVersion, (perScenario.get(scenarioVersion) || 0) + 1);
    // 只留判定用得到的欄位，不整包塞進去：驗證單留 90 天，寫進去的東西就是不可回溯的歷史。
    const surveillance = pick.surveillance ? {
      kind: String(pick.surveillance.kind || ""),
      label: String(pick.surveillance.label || ""),
      interval: Number.isFinite(Number(pick.surveillance.interval)) ? Number(pick.surveillance.interval) : null,
    } : null;
    list.push({
      code: pick.code,
      name: pick.name,
      scenario,
      entry: plan.entry,
      stop: plan.structuralStop, // 用結構停損（RR 與目標都以它為基準）
      target: plan.target,
      rr: plan.rr ?? null,
      score: pick.score ?? null,
      formulaVersion: bodyVersion,
      surveillance,
      fillModel: swingVerificationFillModel(surveillance),
      status: "pending", // pending | win | loss | expired
      resolvedAt: null,
      resultPct: null,
      daysHeld: 0,
      lastChecked: day,
    });
    changed = true;
  }
  if (pruneSwingVerification(db.swingVerification, 90)) changed = true;
  if (changed) invalidateSwingVerifySummaryCache();
  return changed;
}

// 單筆逐日推進（純函式，可測）。回傳「這次有沒有推進」。
// 規則：日期沒前進不動（防同日重跑、天然擋上市/上櫃收盤檔時間差）；
// 同日雙觸（低點破停損且高點過目標）保守記停損——日 K 沒有盤中序列，統計寧可偏保守；
// 跳空直接越過停損/目標時用開盤價計實際出場（更誠實的滑價）；15 個交易日沒碰到＝以收盤結案。
// ---- 勝率的最小樣本門檻（D-27）----
// 舊行為：只要有 1 筆結案就給百分比，前端還依 >=50% 染成紅／綠。問題有三層：
// (1) 樣本數 1 的「勝率 100%」沒有任何統計意義，但視覺上跟累積數十筆的綠字長得一樣；
// (2) winRate 的分母只算已結案，而 win/loss 一碰價就結案（常 1~3 天）、expired 一定要等第 15 個
//     交易日——累積初期分母裡幾乎只有快速觸價的極端樣本，勝率會先高後低，看起來像策略壞掉，
//     其實只是分母組成在變；
// (3) 同一天選出的 20~40 檔高度共享大盤 beta，當成獨立樣本會嚴重高估精度。
// 門檻取 20：低於它一律回 null，讓前端顯示「樣本累積中 n/20」且不染色。
// 這只影響「要不要把百分比當結論呈現」，不改變任何選股結果。
const WIN_RATE_MIN_SAMPLES = 20;
const SWING_VERIFY_MAX_DAYS = 15;
function advanceSwingVerificationEntry(entry, dayQuote) {
  if (!entry || entry.status !== "pending" || !dayQuote) return false;
  const day = toCompactDate(dayQuote.rawDate || dayQuote.asOf);
  if (!day || day <= entry.lastChecked) return false;
  // Number(null)===0 的陷阱：缺值必須先擋掉，否則 high=null 會被當成 0 混進觸價判定。
  const num = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
  const open = num(dayQuote.open);
  const high = num(dayQuote.high);
  const low = num(dayQuote.low);
  const close = num(dayQuote.price);
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || high <= 0 || low <= 0) return false;
  entry.lastChecked = day;
  entry.daysHeld += 1;
  delete entry.dataGap;
  const resolve = (status, exitPrice) => {
    entry.status = status;
    entry.resolvedAt = day;
    entry.resultPct = roundTo(((exitPrice - entry.entry) / entry.entry) * 100);
  };
  // D-24 裁決：開盤價優先於「同日雙觸保守記停損」。
  //
  // 「雙觸保守記停損」的前提是「日 K 沒有盤中序列，不知道先碰哪一邊」。但台股開盤是
  // **集合競價**，是當日第一筆成交且時序完全確定——開盤價若已越過某一邊，掛在那個價位的
  // 單就是在那一撮成交的，沒有先後可猜。前提不成立時，保守規則就不該套用。
  //
  // 舊寫法把停損判定放在目標之前且不看開盤：只要 low <= stop 就一律 loss。
  // entry 100／stop 95／target 110，當日 open 112、high 113、low 94 → 記成 loss −5%，
  // 但實際上 09:00 開盤 112 就成交了，是 win +12%（誤差 17 個百分點，而且勝負反向）。
  // 偏誤是單向的：只會把真實的獲利記成虧損，不會反過來，所以會系統性低估勝率與平均報酬。
  //
  // 舊寫法對「開盤跳空跌破停損」其實處理對了（open < stop 時用 open 出場），
  // 可見作者本來就接受「開盤越過該價位時以開盤價成交」，只是漏了另一半。
  if (Number.isFinite(open) && open <= entry.stop) {
    resolve("loss", open);
    return true;
  }
  if (Number.isFinite(open) && open >= entry.target) {
    resolve("win", open);
    return true;
  }
  if (low <= entry.stop) {
    resolve("loss", entry.stop);
    return true;
  }
  if (high >= entry.target) {
    resolve("win", Number.isFinite(open) && open > entry.target ? open : entry.target);
    return true;
  }
  if (entry.daysHeld >= SWING_VERIFY_MAX_DAYS) {
    resolve("expired", close);
    return true;
  }
  return true;
}

function normalizeSwingVerificationQuote(row) {
  if (!row) return null;
  const day = toCompactDate(row.rawDate || row.asOf || row.date);
  if (!day) return null;
  return {
    rawDate: day,
    open: row.open,
    high: row.high,
    low: row.low,
    price: row.price ?? row.close,
    // 交易所自己的昨收：除權息／減資當天它就是官方參考價（漲跌價差是相對參考價算的）。
    //
    // 一律讀永不被覆寫的 `exchangePreviousClose`，**不可**退回 `previousClose`：
    // Yahoo 備援序列與「用整批收盤補出來的當日 K」都會把 previousClose 填成前一列的收盤
    // （normalizeYahooHistoryRows / appendTodayCloseBar 各自都這麼做），拿它算比率恆等於 1，
    // 於是「算不出比率」會偽裝成「已確認這天沒有公司行動」——正是這批停等要擋的情形。
    exchangePreviousClose: row.exchangePreviousClose ?? null,
    // 上市在除權息日把漲跌價差欄整欄遮成 "X0.00"，交易所自己的事件標記涵蓋全部歷史，
    // 比只從部署後累積的本機歸檔可靠。它只說「有事件」，不說比率。
    exchangeCorporateActionMark: Boolean(row.exchangeCorporateActionMark),
    // Yahoo 的 OHLC 已自行把配股當分割還原過，與官方逐檔歷史不是同一個座標系。
    fromYahoo: String(row.source || "").startsWith("Yahoo"),
  };
}

// 除權息／減資造成的價格跳空是機械性的，不是真的漲跌。驗證單若拿原始價比對含息的
// entry/stop/target，除息當天會被記成假停損（實測：配息 5 元、參考價 95、當天相對參考價
// 收平盤，仍會 low(95) <= stop(95) 記 loss −5%，而投資人同時領到 5 元現金股利）。
// 這裡用「交易所官方昨收 ÷ 前一根實際收盤」推出調整比率，把 entry/stop/target 一起搬到
// 事件後的價格尺度；因為股利已內含在比率裡，之後算出的 resultPct 就是含息總報酬。
const CORPORATE_ACTION_RATIO_TOLERANCE = 0.002; // 0.2%：小於此視為捨入誤差，不動計畫價

// 一個事件日的比率有**三種**結果，呼叫端必須分得開：
//   quantified=true  ／ ratio 有值  → 算出來了，要把計畫價搬到事件後的尺度
//   quantified=true  ／ ratio=null → 算出來了，但幅度在容忍度內＝確認不必調
//   quantified=false               → 算不出來。這**不等於**「沒事發生」
// 舊寫法把後兩者都回單一個 null，於是「算不出比率」與「確認沒有事件」在呼叫端長得一模一樣，
// 兩層來源同時失效時就靜默拿事件前的計畫價去比事件後的價格（＝假停損／假達標）。
function swingVerificationActionRatio(row, previousRow, { adjacent = true } = {}) {
  const unknown = { quantified: false, ratio: null };
  // Yahoo 座標系的列不可拿來推官方比率：它沒有交易所昨收，OHLC 也已自行還原過配股。
  if (row?.fromYahoo || previousRow?.fromYahoo) return unknown;
  // 必須要求相鄰：逐月歷史抓取失敗會被吞成空陣列，缺口前後直接接起來之後，
  // 「交易所昨收」講的是真正的前一個交易日、priorClose 卻是幾週前那根，硬算會把
  // 整段正常漲跌記成一次巨大的公司行動（實測：收平盤的股票被記成 −20% 停損）。
  if (!adjacent) return unknown;
  const exchangePreviousClose = Number(row?.exchangePreviousClose);
  const priorClose = Number(previousRow?.price);
  if (!Number.isFinite(exchangePreviousClose) || exchangePreviousClose <= 0) return unknown;
  if (!Number.isFinite(priorClose) || priorClose <= 0) return unknown;
  const ratio = exchangePreviousClose / priorClose;
  if (!Number.isFinite(ratio) || ratio <= 0) return unknown;
  return { quantified: true, ratio: Math.abs(ratio - 1) > CORPORATE_ACTION_RATIO_TOLERANCE ? ratio : null };
}

// 同一天可能同時來自「官方逐檔月歷史」與「整批收盤」（advanceSwingVerification 直接把兩者
// 接成 [...history, ...directRows]）。OHLC 取後到的整批收盤——那是權威收盤價，與原本
// Map 後者覆蓋前者的語意一致。但公司行動欄位**不可以**跟著被覆蓋：整批收盤補出來的當日 K
// 沒有交易所漲跌價差欄（appendTodayCloseBar 明寫 exchangePreviousClose: null），
// 讓它整列蓋掉官方逐檔列等於把當天唯一的比率來源丟掉，除權息那天就只剩停等。
// 座標系不可混：任一邊來自 Yahoo 時就不繼承對方的官方欄位。
function mergeSwingVerificationQuote(previous, row) {
  const merged = { ...row };
  if (!row.fromYahoo && !previous.fromYahoo) {
    merged.exchangePreviousClose = row.exchangePreviousClose ?? previous.exchangePreviousClose ?? null;
    merged.exchangeCorporateActionMark = Boolean(row.exchangeCorporateActionMark || previous.exchangeCorporateActionMark);
  }
  return merged;
}

// 「這天有公司行動」的**偵測**，與「算得出比率」的**量化**是兩件事。
// 判準刻意與掃描端的 officialUnresolved（resolveCorporateActionAdjustments）一致：
// 同一筆事件不該在看板上被正確還原、在驗證裡卻被當成沒事發生。
function swingVerificationActionDetected(code, day, row) {
  if (corporateActionHistoryForCode(code, day, day).length) return "官方公告";
  // 上市的 X 標記涵蓋全部歷史，但**只有該月計算結果表真的抓成功過**才算數——
  // 否則是我們沒查到，不是資料不完整，不該因為上游打嗝就讓驗證單全部停擺。
  if (row?.exchangeCorporateActionMark && corporateActionResultMonthCovered(day)) return "上市除權息標記";
  return "";
}

function applySwingCorporateAction(entry, ratio, day) {
  entry.entry = roundTo(entry.entry * ratio);
  entry.stop = roundTo(entry.stop * ratio);
  entry.target = roundTo(entry.target * ratio);
  const adjustments = Array.isArray(entry.corporateActions) ? entry.corporateActions : [];
  adjustments.push({ date: day, ratio: roundTo(ratio, 6) });
  entry.corporateActions = adjustments.slice(-8);
}

// 依實際交易日逐根重放。任何中間日缺 K 都停在缺口之前，絕不拿較晚一天替代；
// 這樣「D1 先停損、D2 才達標」不會被錯記成勝利，15 天也是真實交易日而非開 App 次數。
function replaySwingVerificationHistory(entry, dayQuotes, latestDate, calendar = {}) {
  if (!entry || entry.status !== "pending") return { changed: false, missingDate: "" };
  const latest = toCompactDate(latestDate);
  if (!latest || latest <= toCompactDate(entry.lastChecked)) return { changed: false, missingDate: "" };
  // 同一天可能同時來自兩個來源：advanceSwingVerification 直接把「官方逐檔月歷史」與
  // 「整批收盤」接成 [...history, ...directRows]，中間沒有去重，而官方當月歷史在收盤後
  // 就會長出當日 K。不先收斂成「每天一列」的話，下面用「陣列前一格」找前一交易日時會抓到
  // 同一天的另一列，把當日漲跌幅算成公司行動比率，把 entry／停損／目標整組乘上假比率並落盤。
  // 後到的整批收盤優先，與原本 byDate（Map 後者覆蓋前者）的語意一致。
  const sortedRows = (Array.isArray(dayQuotes) ? dayQuotes : [])
    .map(normalizeSwingVerificationQuote)
    .filter(Boolean)
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  const byDate = new Map();
  for (const row of sortedRows) {
    const previous = byDate.get(row.rawDate);
    byDate.set(row.rawDate, previous ? mergeSwingVerificationQuote(previous, row) : row);
  }
  const candidateDays = [...byDate.keys()].sort();
  const rows = candidateDays.map((date) => byDate.get(date));
  const indexByDate = new Map(candidateDays.map((date, index) => [date, index]));
  let changed = false;
  for (let step = 0; step < 90 && entry.status === "pending"; step += 1) {
    const resolution = resolveNextTradingDate(entry.lastChecked, {
      tradingDays: calendar.tradingDays || [],
      holidayRows: calendar.holidayRows || [],
      candidateDays,
    });
    const expected = toCompactDate(resolution.date);
    if (!expected || expected > latest) break;
    const row = byDate.get(expected);
    // 判定觸價之前先把公司行動的機械性跳空吸收掉，否則除權息當天必然誤判成停損。
    if (row) {
      const rowIndex = indexByDate.get(expected) ?? -1;
      const previousRow = rowIndex > 0 ? rows[rowIndex - 1] : null;
      // 只有「真的相鄰」的兩根才能拿來推公司行動。逐月歷史抓取失敗會被 .catch(() => []) 吞成
      // 空陣列，缺口前後被直接接起來之後，兩根之間隔了幾週的正常漲跌本來就對不上「昨收」，
      // 硬算會把整段漲跌記成一次巨大的公司行動（實測：收平盤的股票被記成 −20% 停損）。
      const gapDays = previousRow ? compactDaysDiff(previousRow.rawDate, expected) : null;
      const adjacent = gapDays !== null && gapDays >= 1 && gapDays <= HEURISTIC_MAX_GAP_DAYS;
      // 官方計算結果表優先：上市在除權息日的漲跌價差欄被遮成 "X0.00"，交易所昨收因此是 null，
      // 只靠昨收比值推比率其實**只有上櫃有效**（2026-07-26 實測）。也就是說這道除權息保護
      // 過去對上市股票從來沒有生效過，除息當天照樣被記成假停損。
      // 計算結果表給的是絕對的「前收盤價／參考價」配對，不依賴相鄰列，所以不需要相鄰性檢查。
      const resultRatio = corporateActionResultRatio(entry.code, expected);
      const quantification = resultRatio !== null
        ? { quantified: true, ratio: Math.abs(resultRatio - 1) > CORPORATE_ACTION_RATIO_TOLERANCE ? resultRatio : null }
        : swingVerificationActionRatio(row, previousRow, { adjacent });
      // 同一個事件日只能調整一次。推進失敗（當天無成交、高低價缺值）會停在同一個 expected，
      // 下一輪重跑時若不擋，計畫價會被同一筆事件乘第二次——停等機制會讓重跑變常態，必須先擋。
      const alreadyApplied = (entry.corporateActions || []).some((item) => item?.date === expected);
      if (quantification.ratio !== null && !alreadyApplied) {
        applySwingCorporateAction(entry, quantification.ratio, expected);
      }
      // 量不出比率時再問「到底有沒有事件」。有事件卻量不出來 → 停等，不可拿事件前的計畫價
      // 去比事件後的價格。這是自癒狀態不是錯誤：TWT49U 約 T+1 發布、官方逐檔歷史收盤後補齊，
      // 通常隔天就解開，而 daysHeld 不會遞增，所以 15 個交易日的觀察窗不會被停等吃掉。
      const holdReason = quantification.quantified
        ? ""
        : swingVerificationActionDetected(entry.code, expected, row);
      if (holdReason) {
        const hold = { from: expected, reason: holdReason, detectedAt: new Date().toISOString() };
        const previous = entry.corporateActionPending;
        if (!previous || previous.from !== hold.from || previous.reason !== hold.reason) {
          entry.corporateActionPending = hold;
          changed = true;
        }
        // 刻意不寫 dataGap：那個欄位的語意是「官方日 K 缺漏」，兩者的處理方式與揭露文字都不同。
        return { changed, missingDate: "" };
      }
      if (entry.corporateActionPending) {
        delete entry.corporateActionPending;
        changed = true;
      }
    }
    if (!row || !advanceSwingVerificationEntry(entry, row)) {
      const nextGap = { from: expected, through: latest, detectedAt: new Date().toISOString() };
      const previous = entry.dataGap;
      if (!previous || previous.from !== nextGap.from || previous.through !== nextGap.through) {
        entry.dataGap = nextGap;
        changed = true;
      }
      return { changed, missingDate: expected };
    }
    changed = true;
  }
  return { changed, missingDate: "" };
}

// 批次推進：相鄰交易日直接用整批收盤；若漏開 App，則讀官方月 K 快取逐日補判。
// 每個完整收盤日只跑一次；缺中間日 K 會留 dataGap，下一次重試而不是跳日。
let lastSwingAdvanceKey = "";
let swingVerifySummaryCache = { expiresAt: 0, value: null };
// 摘要有 10 分鐘快取，任何改動驗證單的路徑都必須讓它失效。抽成具名函式的理由：
// 原本兩處各自寫字面值，測試又沒有正當的把手，於是「只有第一個呼叫者拿到新鮮結果」
// 這種順序耦合會靜靜潛伏在測試裡（實測：加新案例時才發現舊案例其實靠排在第一個才過）。
function invalidateSwingVerifySummaryCache() {
  swingVerifySummaryCache = { expiresAt: 0, value: null };
}
async function advanceSwingVerification(reference, latestDate) {
  // 單一市場／last-good／日期未對齊時不可推進，否則同日另一市場稍後補齊也會被節流漏掉。
  if (!latestDate || reference?.coverageComplete === false) return;
  const twseDate = reference?.markets?.twse?.asOf || "";
  const tpexDate = reference?.markets?.tpex?.asOf || "";
  const advanceKey = twseDate && tpexDate ? `${twseDate}|${tpexDate}` : latestDate;
  if (lastSwingAdvanceKey === advanceKey) return;
  try {
    const db = await loadDb();
    if (!db.swingVerification) {
      lastSwingAdvanceKey = advanceKey;
      return;
    }
    // replay 可能要 await 多檔歷史；先在 draft 上計算，不能提前修改共享 dbCache。
    const originalStore = cloneJson(db.swingVerification);
    const store = cloneJson(originalStore);
    // replaySwingVerificationHistory 是同步的，官方除權除息計算結果表要先補齊才查得到。
    // 驗證單最長留 90 天，抓 4 個月綽綽有餘；一次請求涵蓋全市場，所有 pending 共用。
    const calendar = await getTradingCalendarEvidence();
    await Promise.all([
      loadFundamentalsHistory(),
      ensureCorporateActionResults(compactMonthsBefore(latestDate, 4), latestDate),
    ]);
    const pendingByCode = new Map();
    for (const entries of Object.values(store)) {
      for (const entry of entries) {
        if (entry.status !== "pending") continue;
        if (!pendingByCode.has(entry.code)) pendingByCode.set(entry.code, []);
        pendingByCode.get(entry.code).push(entry);
      }
    }
    let changed = false;
    await mapLimit([...pendingByCode.entries()], 4, async ([code, entries]) => {
      const quote = reference.byCode.get(code);
      const quoteDay = toCompactDate(quote?.rawDate || quote?.asOf);
      const directRows = quote && quoteDay ? [quote] : [];
      const needsHistory = entries.some((entry) => {
        const expected = resolveNextTradingDate(entry.lastChecked, {
          tradingDays: calendar.tradingDays || [],
          holidayRows: calendar.holidayRows || [],
          candidateDays: quoteDay ? [quoteDay] : [],
        }).date;
        return !expected || expected < latestDate || quoteDay !== latestDate;
      });
      let rows = directRows;
      if (needsHistory && quote?.exchange) {
        const history = await getStockHistory(quote, latestDate, 4);
        rows = [...history, ...directRows];
      }
      for (const entry of entries) {
        const result = replaySwingVerificationHistory(entry, rows, latestDate, calendar);
        if (result.changed) changed = true;
      }
    });
    if (changed) {
      const committed = await commitDbMutation((currentDb) => {
        // 等歷史資料期間若另一輪已更新驗證資料，不用舊 draft 覆蓋；保持未節流讓下次重算。
        if (stableJson(currentDb.swingVerification || {}) !== stableJson(originalStore)) {
          return skipDbMutation(false);
        }
        currentDb.swingVerification = store;
        return true;
      });
      if (!committed) return;
      invalidateSwingVerifySummaryCache();
    }
    // 只有完整流程成功後才節流；讀檔或寫檔失敗要讓下一次有機會恢復。
    lastSwingAdvanceKey = advanceKey;
  } catch (error) {
    console.warn("[Stock1] 波段驗證推進失敗（下次看板重算時再試）：", error.message);
  }
}

// 各場景統計＋最近結案明細（10 分鐘快取；獨立於 /api/swing——那份 body 會被凍結存快照，不能內嵌會過期的數字）。
// D-26：驗證單若因官方日 K 缺漏而停在缺口前，會**永遠**留在 pending——`daysHeld` 只在成功推進時
// 才 +1，所以 15 個交易日超時結案也永遠碰不到；90 天後被 pruneSwingVerification 無差別刪掉，
// 從頭到尾都沒進過 resolved 分母。健康的 pending 最多 15 個交易日（約 3 週）就會結案，
// 所以缺口超過 30 個日曆日的視為「卡住」，單獨計數並揭露，讓分母損耗看得見。
// **刻意不做**「缺 K 就跳到下一個交易日」：stock1-domain 明訂「中間日期缺 K 就停在缺口前，不可跳日」，
// 那是為了避免「D1 先停損、D2 才達標」被錯記成勝利，屬刻意設計，不能為了衝分母而破壞。
const SWING_VERIFY_STALLED_DAYS = 30;
// 兩種停等都會讓 entry 留在原地：缺官方日 K（dataGap）與偵測到公司行動卻量不出比率
// （corporateActionPending）。前者等資料補齊、後者等官方比率發布，兩者都應該在幾天內自癒；
// 久到不可能再自行結案時，不論哪一種都是分母損耗，必須一起算進「卡住」。
function verificationStallFrom(entry) {
  return entry?.dataGap?.from || entry?.corporateActionPending?.from || "";
}
function isStalledVerificationEntry(entry, todayCompact) {
  if (!entry || entry.status !== "pending") return false;
  const from = verificationStallFrom(entry);
  if (!from) return false;
  const gap = compactDaysDiff(toCompactDate(from), todayCompact);
  return Number.isFinite(gap) && gap > SWING_VERIFY_STALLED_DAYS;
}

async function buildSwingVerificationSummary() {
  if (swingVerifySummaryCache.value && swingVerifySummaryCache.expiresAt > Date.now()) {
    return swingVerifySummaryCache.value;
  }
  const db = await loadDb();
  const store = db.swingVerification || {};
  const summaryToday = toTaipeiCompactDate();
  const byScenario = new Map();
  const all = [];
    const versionCounts = new Map();
  for (const [day, entries] of Object.entries(store)) {
    for (const entry of entries) {
      const formulaVersion = entry.formulaVersion || "legacy";
      const version = versionCounts.get(formulaVersion) || { formulaVersion, samples: 0, resolved: 0, pending: 0, dataGaps: 0 };
      version.samples += 1;
      if (entry.status === "pending") {
        version.pending += 1;
        if (entry.dataGap) version.dataGaps += 1;
      }
      else version.resolved += 1;
      versionCounts.set(formulaVersion, version);
      if (formulaVersion !== SWING_FORMULA_VERSION) continue;
      const s = byScenario.get(entry.scenario) || {
        scenario: entry.scenario,
        samples: 0, wins: 0, losses: 0, expired: 0, pending: 0, stalled: 0,
        resolved: 0, sumResultPct: 0, sumDaysHeld: 0,
        periodicCallSamples: 0, periodicCallResolved: 0,
      };
      s.samples += 1;
      // D-30：分盤撮合的樣本照舊計入勝率（改口徑要另外決策），但必須數得出來。
      // 舊紀錄沒有 fillModel 欄位 → 當成 continuous，不追溯改寫歷史樣本。
      if (entry.fillModel && entry.fillModel !== "continuous") {
        s.periodicCallSamples += 1;
        if (entry.status !== "pending") s.periodicCallResolved += 1;
      }
      if (entry.status === "pending") {
        s.pending += 1;
        if (isStalledVerificationEntry(entry, summaryToday)) s.stalled += 1;
      } else {
        s.resolved += 1;
        s.sumResultPct += entry.resultPct || 0;
        s.sumDaysHeld += entry.daysHeld || 0;
        if (entry.status === "win") s.wins += 1;
        else if (entry.status === "loss") s.losses += 1;
        else s.expired += 1;
      }
      byScenario.set(entry.scenario, s);
      all.push({ day, ...entry });
    }
  }
  const scenarios = [...byScenario.values()].map((s) => ({
    scenario: s.scenario,
    samples: s.samples,
    wins: s.wins,
    losses: s.losses,
    expired: s.expired,
    pending: s.pending,
    stalled: s.stalled,
    resolved: s.resolved,
    // 低於最小樣本時回 null——不是「沒有資料」，而是「還不足以當成結論」。
    winRate: s.resolved >= WIN_RATE_MIN_SAMPLES ? Math.round((s.wins / s.resolved) * 1000) / 10 : null,
    winRateMinSamples: WIN_RATE_MIN_SAMPLES,
    avgResultPct: s.resolved ? Math.round((s.sumResultPct / s.resolved) * 100) / 100 : null,
    avgResultPctNet: s.resolved ? netReturnPct(s.sumResultPct / s.resolved) : null,
    avgDaysHeld: s.resolved ? Math.round((s.sumDaysHeld / s.resolved) * 10) / 10 : null,
    // 分盤撮合（處置期間）的樣本數：仍計入上面的勝率，但要能單獨看見。
    periodicCallSamples: s.periodicCallSamples,
    periodicCallResolved: s.periodicCallResolved,
  }));
  all.sort((a, b) => String(b.resolvedAt || b.day).localeCompare(String(a.resolvedAt || a.day)));
  const body = {
    ok: true,
    generatedAt: new Date().toISOString(),
    currentFormulaVersion: SWING_FORMULA_VERSION,
    formulaVersions: [...versionCounts.values()].sort((a, b) => b.formulaVersion.localeCompare(a.formulaVersion)),
    scenarios,
    recent: all.filter((entry) => entry.status !== "pending").slice(0, 20),
    pendingCount: all.filter((entry) => entry.status === "pending").length,
    dataGapCount: all.filter((entry) => entry.status === "pending" && entry.dataGap).length,
    // 偵測到公司行動卻還算不出官方比率而停等的張數。它是自癒的暫時狀態（通常隔天解開），
    // 但必須數得出來——否則「今天沒有推進」看起來會和「今天沒有變化」一模一樣。
    corporateActionPendingCount: all.filter((entry) => entry.status === "pending" && entry.corporateActionPending).length,
    // 卡住＝資料缺口久到不可能再自行結案；它們永遠不會進 resolved 分母，必須讓使用者看得到。
    stalledCount: all.filter((entry) => isStalledVerificationEntry(entry, summaryToday)).length,
    // D-30：處置期間是分盤集合競價，觸價判定的前提（連續競價）在這些樣本上並不成立。
    periodicCallCount: all.filter((entry) => entry.fillModel && entry.fillModel !== "continuous").length,
    notes: [
      "驗證規則：進場＝訊號日收盤，之後每個交易日用官方日K高低價判定「先碰目標＝達標、先碰停損（結構停損）＝停損」；同一天兩邊都碰到，保守記停損。",
      `${SWING_VERIFY_MAX_DAYS} 個實際交易日內都沒碰到 → 以第 ${SWING_VERIFY_MAX_DAYS} 日收盤結案（超時）。漏開 App 會用官方日K依日期補判；若中間日K缺漏就停在缺口前並排除結案統計。`,
      `勝率需累積 ${WIN_RATE_MIN_SAMPLES} 筆結案才顯示：分母只含已結案，而達標／停損常 1~3 天就結案、超時要等第 ${SWING_VERIFY_MAX_DAYS} 個交易日，初期分母偏向快速觸價的極端樣本。同一天選出的標的也高度共享大盤走勢，有效樣本數遠小於檔數。`,
      `因官方日 K 缺漏而停在缺口前超過 ${SWING_VERIFY_STALLED_DAYS} 天的驗證單會標為「卡住」：它們不會自行結案，也永遠不會進入勝率分母，因此分母會比實際發出的訊號數少。`,
      "除權息／減資當天，若交易所公告說有事件但官方比率還沒發布（計算結果表約次一營業日才有），該張驗證單會暫停推進而不是拿事件前的進場／停損／目標去比事件後的價格——否則除息當天必然被記成假停損。等比率到齊後會自動接著判，觀察天數不會被停等吃掉。",
      "處置期間的標的是分盤集合競價（每 5 或 20 分鐘撮合一次），日 K 的最高／最低價只是幾十次撮合的極值，掛在停損／目標的單未必真的撮得到。這些樣本仍計入上面的勝率，但會單獨標示筆數；2026-07-27 之前建立的驗證單沒有記錄撮合方式，一律當成連續競價。",
      `所有百分比預設為未扣費稅的毛報酬；${VERIFY_COST_NOTE}`,
    ],
  };
  swingVerifySummaryCache = { expiresAt: Date.now() + 10 * 60 * 1000, value: body };
  return body;
}

// 實際掃描全市場（重）：抓歷史、算特徵、分類、產生交易計畫與評分。
async function scanSwingBoard(reference, latestDate, scenarioKey, maxCandidates) {
  // 權息預告一旦過日就離開上游滾動窗；掃描前先刷新並落盤，讓同一輪 K 線可用官方參考價還原。
  // 官方除權除息計算結果表則是逐月、一次涵蓋全市場，所以在這裡補一次就夠整輪 240 檔共用。
  // 補齊範圍看的是「歷史最遠可能退到哪」而不是「正常抓幾個月」：下面 getStockHistory 開了
  // fallbackRange "1y"，被限流時整包會變成 Yahoo 的一年序列（見 CORPORATE_ACTION_RESULT_FALLBACK_MONTHS）。
  const scanFromDate = compactMonthsBefore(latestDate, CORPORATE_ACTION_RESULT_FALLBACK_MONTHS);
  const [riskSets, , corporateActionCoverage] = await Promise.all([
    getRiskSets(latestDate),
    getDividendSchedule(),
    loadFundamentalsHistory().then(() => ensureCorporateActionResults(scanFromDate, latestDate)),
  ]);
  const candidates = preselectSwingQuotes(reference, riskSets, latestDate, maxCandidates);
  // 同時抓取數再調低（5→3）：當月逐檔 K 在高並發下最容易被證交所限流而退回前一交易日，
  // 降併發讓更多檔能抓到「當日」官方收盤（配合上面的嚴格新鮮度過濾，過期的會被剔除而非用錯價）。
  const enriched = await mapLimit(candidates, 3, async (quote) => {
    try {
      // 6 個月歷史：MACD(8,17,9)約 3~4 個月就收斂，6 個月足夠且與技術分析頁一致；
      // 比 9 個月少抓 1/3 的月份端點，明顯降低被證交所限流而漏抓 → 命中更完整、掃描間更穩定。
      let history = await getStockHistory(quote, latestDate, 6, {
        allowExternalFallback: true,  // 當月被限流/漏抓時改用 Yahoo 補齊，避免拿到過期歷史
        fallbackMinRows: 60,
        fallbackRange: "1y",
      });
      history = appendTodayCloseBar(history, quote, latestDate);
      if (!history.length) return { hits: [], pick: null, outcome: "history-empty", historySuccess: false, freshHistory: false, featureReady: false };
      const rows = addPreviousClose(history)
        .filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
      const officialActions = corporateActionHistoryForCode(quote.code, rows[0]?.date, rows.at(-1)?.date);
      // 本機歸檔從部署後才開始累積、也不含減資；已知事件用官方公式，其餘大缺口仍保留「疑似」降級，
      // 不可把 archive 空白誤解成整段歷史都經官方確認沒有公司行為。
      const features = computeSwingFeatures(rows, officialActions, { allowHeuristicFallback: true });
      if (!features) return { hits: [], pick: null, outcome: "feature-insufficient", historySuccess: true, freshHistory: false, featureReady: false };
      if (features.corporateActionUnresolved) {
        return { hits: [], pick: null, outcome: "corporate-action-unresolved", historySuccess: true, freshHistory: false, featureReady: false };
      }
      // 嚴格新鮮度：只收「資料有到當日（latestDate）」的標的。大量並發抓官方逐檔歷史時，當日 K 常被
      // 證交所限流漏抓→退回前一交易日，而那種「拉回、看似貼中軌」的過期價會選出根本已噴出的假標的
      // （例：玉晶光 6/12 收 662 看似貼中軌，6/15 其實已 728、距中軌 +18%）。寧可少幾檔，也不要用過期價算。
      // （append 已盡量用整批收盤把當日那根補上；補不到、Yahoo 也沒有的就在這裡剔除。）
      if (toCompactDate(features.last.date) < latestDate) {
        return { hits: [], pick: null, outcome: "history-stale", historySuccess: true, freshHistory: false, featureReady: true };
      }
      const plan = buildSwingPlan(features);
      // 盈虧比下限：風險>報酬的設定不值得做，直接剔除（也自然淘汰離中軌過遠→停損遠→RR 爛的股）。
      // 用**淨** RR 把關：門檻宣稱「風險大於報酬的設定不值得做」，那就得算進來回成本，
      // 否則毛 RR 1.0~1.2 這一段全部是「看起來剛好過關、實際上賠錢」（見 buildSwingPlan 的說明）。
      if (!Number.isFinite(plan.rrNet) || plan.rrNet < SWING_MIN_RR) {
        return { hits: [], pick: null, outcome: "rr-filtered", historySuccess: true, freshHistory: true, featureReady: true };
      }
      // 對「所有場景」分類做命中計數：讓分頁能同時顯示兩個場景今天各有幾檔（兩場景互斥、理論上不重疊）。
      // 場景判定不影響 plan，RR 過濾對所有場景一致，所以計數與選股套用的是完全相同的門檻。
      const hits = SWING_SCENARIOS.filter((detector) => detector.detect(features)).map((d) => d.key);
      if (!hits.length) return { hits: [], pick: null, outcome: "no-match", historySuccess: true, freshHistory: true, featureReady: true };
      // 只為「要求的場景」建完整 pick（沒指定就取第一個命中的）；其餘命中只計數、不進榜單。
      const scenario = scenarioKey
        ? (hits.includes(scenarioKey) ? classifySwingScenario(features, scenarioKey) : null)
        : classifySwingScenario(features);
      let pick = null;
      if (scenario) {
        const score = scoreSwing(features, plan, scenario.key);
        pick = buildSwingPick(quote, features, scenario, plan, score);
      }
      return { hits, pick, outcome: "matched", historySuccess: true, freshHistory: true, featureReady: true };
    } catch {
      return { hits: [], pick: null, outcome: "source-error", historySuccess: false, freshHistory: false, featureReady: false };
    }
  });

  const enrichedResults = enriched.filter(Boolean);
  const matched = enrichedResults.map((result) => result.pick).filter(Boolean);
  // 一次掃描涵蓋所有場景：把命中依場景分組、各自依分數排名（每個場景都有自己的 RANK 1），
  // 整份存進同一個快照，回傳時再依「要求的場景＋limit」切片。這樣兩個分頁共用同一次掃描，
  // 命中數與計算時間天生一致，不會因為各自掃描而對不上（場景互斥，每檔只屬於一個場景）。
  const byScenario = new Map();
  for (const pick of matched) {
    const key = pick.scenario.key;
    if (!byScenario.has(key)) byScenario.set(key, []);
    byScenario.get(key).push(pick);
  }
  const picks = [];
  for (const list of byScenario.values()) {
    list
      .sort((a, b) => b.score - a.score || (b.plan.rr || 0) - (a.plan.rr || 0))
      .slice(0, 80)
      .forEach((pick, index) => picks.push({ ...pick, rank: index + 1 }));
  }
  // 注意/處置/變更交易股保留並標示（前端可切換隱藏）。
  // 另外把處置看板知道的分盤間隔補進來（riskSets 只有 kind/label）——驗證單要靠它記錄
  // 當時的撮合方式（D-30）。看板沒熱時拿不到間隔，那就只知道「處置中」而不知道是幾分盤。
  for (const pick of picks) {
    const info = riskSets.surveillance.get(pick.code) || null;
    if (!info) { pick.surveillance = null; continue; }
    const interval = lookupStockSurveillance(pick.code, surveillanceBoardCache.value)?.interval ?? null;
    pick.surveillance = interval ? { ...info, interval } : info;
  }

  // 各場景命中數：同一次掃描已對每檔跑過所有場景偵測，兩個分頁的數字都來自這一份、保證一致。
  const scenarioCounts = {};
  for (const result of enrichedResults) {
    for (const key of result.hits) scenarioCounts[key] = (scenarioCounts[key] || 0) + 1;
  }
  const failureOutcomes = new Set([
    "source-error",
    "history-empty",
    "history-stale",
    "feature-insufficient",
    "corporate-action-unresolved",
  ]);
  const failureReasons = {};
  for (const result of enrichedResults) {
    if (failureOutcomes.has(result.outcome)) failureReasons[result.outcome] = (failureReasons[result.outcome] || 0) + 1;
  }
  const historySuccessCount = enrichedResults.filter((result) => result.historySuccess).length;
  const freshHistoryCount = enrichedResults.filter((result) => result.freshHistory).length;
  const featureReadyCount = enrichedResults.filter((result) => result.featureReady).length;
  const failedCount = Object.values(failureReasons).reduce((sum, count) => sum + count, 0);
  const coverageRate = candidates.length ? freshHistoryCount / candidates.length : 1;
  const scanReliable = coverageRate >= SWING_MIN_SCAN_COVERAGE;
  const scanQuality = {
    candidateCount: candidates.length,
    historySuccessCount,
    freshHistoryCount,
    featureReadyCount,
    failedCount,
    failureReasons,
    coverageRate: roundTo(coverageRate * 100),
    reliable: scanReliable,
    // 官方除權除息計算結果表這一輪有沒有抓齊。抓不到不會讓掃描失敗（會退回歸檔公告與跳空估算），
    // 但那代表這批均線／布林／MACD 可能建立在沒還原的價格上——這件事必須看得見。
    // 這個失敗模式在開發期間三天內出現三次（證交所限流），而且畫面上完全沒有跡象。
    corporateActionResultsComplete: !corporateActionCoverage?.degraded,
  };
  const provisional = !reference.coverageComplete || !scanReliable;
  const scanWarnings = scanReliable
    ? []
    : [`本次只有 ${freshHistoryCount}/${candidates.length} 檔候選取得 ${compactToSlashDate(latestDate)} 的新鮮歷史，結果暫時顯示但不會寫入正式快照。`];
  // 還原權息的第一順位來源沒抓齊時一定要說。這一輪的均線／布林／MACD 可能建立在
  // 沒還原的價格上，而畫面上不會有任何其他跡象——刻意不擋掉結果（歸檔公告與跳空估算仍在），
  // 但使用者要知道這批數字的基礎比平常弱。已抓到的月份會落盤，下一輪通常就補齊了。
  if (corporateActionCoverage?.degraded) {
    scanWarnings.push("官方除權除息計算結果表這一輪有部分月份沒抓到，這批標的的還原權息改用公告公式或跳空估算，均線與布林可能不夠精確；資料會在下一輪補齊。");
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    asOf: compactToIsoDate(latestDate),
    source: "TWSE/TPEx official close + official history",
    universe: "上市櫃普通股",
    riskPolicy: "注意股、處置股、變更交易改為標示、不再排除（前端可切換隱藏）；低流動性已先濾掉",
    surveillanceCount: picks.filter((p) => p.surveillance).length,
    formulaVersion: SWING_FORMULA_VERSION,
    scenarios: SWING_SCENARIOS.map((detector) => ({
      key: detector.key,
      name: detector.name,
      count: scenarioCounts[detector.key] || 0,
    })),
    candidateCount: candidates.length,
    matchedCount: matched.length,
    provisional,
    coverage: {
      complete: Boolean(reference.coverageComplete && scanReliable),
      referenceComplete: Boolean(reference.coverageComplete),
      markets: reference.markets,
    },
    scanQuality,
    warnings: unique([...(reference.warnings || []), ...(riskSets.warnings || []), ...scanWarnings]),
    picks,
    disclaimer: "本功能只做技術分析與型態統計，提供進出參考價位，不是買賣建議，也不保證獲利。",
  };
}

function scanSwingBoardSingleFlight(reference, latestDate, maxCandidates) {
  const key = `${latestDate}:${maxCandidates}:${SWING_FORMULA_VERSION}`;
  if (swingScanInFlight.has(key)) return swingScanInFlight.get(key);
  const task = scanSwingBoard(reference, latestDate, "", maxCandidates)
    .finally(() => swingScanInFlight.delete(key));
  swingScanInFlight.set(key, task);
  return task;
}

// 對外入口：同一交易日只算一次，算完存進資料庫快照、整天回同一份（收盤後就不再變動）。
// forceRefresh（按「重新整理」）才重算，且只有在新結果「更完整」時才覆蓋，避免退回殘缺版。
async function buildSwingBoard({ scenarioKey = "", limit = 40, maxCandidates = 240, forceRefresh = false } = {}) {
  const reference = await getReferenceData();
  const latestDate = resolveMarketCloseDate(reference);
  // 波段驗證單逐日推進：不論後面走哪條快取路徑都要跑（每收盤日一次，內部有節流）。
  await advanceSwingVerification(reference, latestDate);
  // 整個板子共用一份快照（含所有場景），不再分場景各存一份 → 兩分頁的命中數與計算時間一定一致，
  // 而且一天只掃一次（切換分頁不重掃，只是把同一份快照換場景切片）。
  const snapshotKey = `${latestDate}:all`;

  // 1) 記憶體快取（最快路徑）
  const cached = swingCache.get(snapshotKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return sliceSwingBody(cached.value, limit, scenarioKey);
  }

  // 2) 當日資料庫快照（穩定）：同一交易日、同一選股邏輯版本算過就回同一份，不重掃。
  //    版本不符（改過公式）視同沒有快照，會重算。
  if (!forceRefresh) {
    const db = await loadDb();
    const stored = db.swingSnapshots?.[snapshotKey];
    if (stored?.body && stored.body.formulaVersion === SWING_FORMULA_VERSION) {
      swingCache.set(snapshotKey, { expiresAt: Date.now() + 30 * 60 * 1000, value: stored.body });
      return sliceSwingBody(stored.body, limit, scenarioKey);
    }
  }

  // 3) 重新掃描（當日第一次，或手動重新整理）：一次掃出所有場景（scenarioKey 傳空），整份存進同一快照。
  const body = await scanSwingBoardSingleFlight(reference, latestDate, maxCandidates);

  // 半市場或歷史覆蓋不足：可以讓使用者看 provisional 結果，但絕不寫 DB／建立不可回溯的驗證單。
  if (body.provisional || body.coverage?.complete === false) {
    try {
      const db = await loadDb();
      const existing = db.swingSnapshots?.[snapshotKey];
      if (existing?.body && existing.body.formulaVersion === SWING_FORMULA_VERSION && !existing.body.provisional) {
        const fallbackBody = {
          ...existing.body,
          warnings: unique([
            ...(existing.body.warnings || []),
            ...(body.warnings || []),
            "本次更新資料覆蓋不足，已保留同日最近一次完整波段快照。",
          ]),
        };
        swingCache.set(snapshotKey, { expiresAt: Date.now() + REFERENCE_RETRY_MS, value: fallbackBody });
        return sliceSwingBody(fallbackBody, limit, scenarioKey);
      }
    } catch {
      // DB 暫時讀不到時仍可回 provisional 記憶體結果，不做持久化。
    }
    swingCache.set(snapshotKey, { expiresAt: Date.now() + REFERENCE_RETRY_MS, value: body });
    return sliceSwingBody(body, limit, scenarioKey);
  }

  // 4) 寫入快照：先比較掃描覆蓋率，再比較命中數，不能再把 picks 多寡當成資料完整度。
  try {
    const persistedBody = await commitDbMutation((db) => {
      db.swingSnapshots ||= {};
      const existing = db.swingSnapshots[snapshotKey];
      const sameVersion = existing?.body?.formulaVersion === SWING_FORMULA_VERSION;
      const incomingCoverage = body.scanQuality?.coverageRate ?? 0;
      const existingCoverage = existing?.body?.scanQuality?.coverageRate ?? 100;
      const shouldReplace = !existing || !sameVersion || incomingCoverage > existingCoverage ||
        (incomingCoverage === existingCoverage && body.matchedCount >= (existing.matchedCount || 0));
      if (!shouldReplace) return skipDbMutation(existing.body);
      db.swingSnapshots[snapshotKey] = {
        asOf: body.asOf,
        generatedAt: body.generatedAt,
        matchedCount: body.matchedCount,
        body,
      };
      pruneSwingSnapshots(db.swingSnapshots, 7);
      recordSwingVerification(db, body); // 同一次 transaction 落盤，不多一次 IO
      return body;
    });
    swingCache.set(snapshotKey, { expiresAt: Date.now() + 30 * 60 * 1000, value: persistedBody });
    return sliceSwingBody(persistedBody, limit, scenarioKey);
  } catch (error) {
    // 寫入失敗仍回本次分析，但只短暫快取並明確提示；下次會重試正式快照。
    const retryBody = {
      ...body,
      warnings: unique([...(body.warnings || []), "正式波段快照暫時無法儲存，將在下次更新重試。"]),
    };
    swingCache.set(snapshotKey, { expiresAt: Date.now() + REFERENCE_RETRY_MS, value: retryBody });
    return sliceSwingBody(retryBody, limit, scenarioKey);
  }
}

// 型態健檢：對「使用者指定的任意股票」跑同一套波段判定，回傳逐條檢核(✓/✗)、判定(符合/接近/不符合)、
// 以及交易計畫與型態分。單檔抓歷史（不走全市場並發、不會被限流），像技術分析頁一樣穩。
async function inspectSwingStock(rawCode) {
  const query = String(rawCode || "").trim();
  const reference = await getReferenceData();
  // 先用代碼，再退而用股名（完全相同優先，其次包含）。支援「2330」或「台積電」。
  let quote = reference.byCode.get(query) || reference.byCode.get(query.toUpperCase());
  if (!quote && query) {
    const all = [...reference.byCode.values()];
    quote = all.find((x) => x.name === query) || all.find((x) => x.name && x.name.includes(query));
  }
  if (!quote) {
    if (reference.degraded) {
      return {
        ok: false,
        retryable: true,
        error: `目前官方股票清單只取得部分市場，暫時無法確認「${query}」是否存在，請稍後重試。`,
        warnings: reference.warnings || [],
      };
    }
    return { ok: false, error: `找不到「${query}」（請輸入上市櫃普通股的代碼或股名，例：2330 或 台積電）` };
  }

  // 波段引擎的 10.5% 跳空 heuristic 前提是「台股有 ±10% 漲跌幅限制」，只對普通股成立。
  // 國外成分／槓桿反向 ETF 無漲跌幅限制，任何一天的真實大漲都會被追認成公司行動，
  // 該日以前的歷史全被乘上假比率，MA／布林／MACD 一起錯，前端還會顯示不存在的權息事件。
  // 掃描端本來就有 isOrdinaryStock 過濾，健檢是使用者手打代碼的入口，補上同一道門檻。
  if (!isOrdinaryStock(quote)) {
    return {
      ok: false,
      error: `波段型態健檢只支援上市櫃普通股；「${quote.name || quote.code}」是 ETF／權證等商品，`
        + "其漲跌幅限制與還原權息規則不同，套用同一套型態判讀會失真。",
    };
  }

  // latestDate：與 buildSwingBoard 一致，取「最多個股共有的官方收盤日」眾數。
  const latestDate = resolveMarketCloseDate(reference);

  await Promise.all([getDividendSchedule(), loadFundamentalsHistory()]);

  let history = await getStockHistory(quote, latestDate, 6, {
    allowExternalFallback: true,
    fallbackMinRows: 60,
    fallbackRange: "1y",
  });
  history = appendTodayCloseBar(history, quote, latestDate);
  const rows = addPreviousClose(history)
    .filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
  // 同步的 resolveCorporateActionAdjustments 要查交易所計算結果表，得先把月份補齊。
  const resultCoverage = await ensureCorporateActionResults(rows[0]?.date, rows.at(-1)?.date);
  const officialActions = corporateActionHistoryForCode(quote.code, rows[0]?.date, rows.at(-1)?.date);
  const features = computeSwingFeatures(rows, officialActions, { allowHeuristicFallback: true });
  if (!features) {
    return {
      ok: false,
      error: `${quote.name} ${quote.code} 的歷史資料不足（波段判定需 ≥60 個交易日）`,
      code: quote.code,
      name: quote.name,
      warnings: reference.warnings || [],
    };
  }
  if (features.corporateActionUnresolved) {
    return {
      ok: false,
      retryable: true,
      error: `${quote.name} ${quote.code} 的公司行為公告欄位尚未完整，為避免錯算均線，暫不提供型態判定。`,
      code: quote.code,
      name: quote.name,
      warnings: unique([
        ...(reference.warnings || []),
        `待補日期：${features.corporateActionUnresolvedDates.map(compactToSlashDate).join("、")}`,
      ]),
    };
  }

  const plan = buildSwingPlan(features);
  const scenarios = SWING_SCENARIOS.map((detector) => {
    const result = detector.evaluate(features);
    const failCount = result.checks.filter((c) => !c.pass).length;
    return { key: detector.key, name: detector.name, passed: result.passed, failCount, checks: result.checks, warns: result.warns, desc: result.desc };
  });

  // 判定：有命中就「符合」；否則取「差最少項」的場景，差 ≤2 項算「接近」，更多算「不符合」。
  const matched = scenarios.find((s) => s.passed);
  const closest = scenarios.slice().sort((a, b) => a.failCount - b.failCount)[0];
  let verdict;
  if (matched) verdict = { status: "match", key: matched.key, name: matched.name, failCount: 0 };
  else if (closest && closest.failCount <= 2) verdict = { status: "near", key: closest.key, name: closest.name, failCount: closest.failCount };
  else verdict = { status: "none", key: closest?.key || "", name: closest?.name || "", failCount: closest?.failCount ?? null };

  const asOf = features.last.date;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    asOf,
    boardAsOf: compactToIsoDate(latestDate),
    stale: toCompactDate(asOf) < latestDate,
    code: quote.code,
    name: quote.name,
    exchange: quote.exchange,
    market: quote.exchange === "TPEx" ? "上櫃" : "上市",
    price: roundTo(features.last.close),
    changePct: roundTo(features.changePct),
    avgVolLots: Math.round(features.avgVol20 || 0),
    volumeRatio5: roundTo(features.volumeRatio5),
    indicators: {
      bollMid: roundTo(features.boll?.mid),
      bollUpper: roundTo(features.boll?.upper),
      bollLower: roundTo(features.boll?.lower),
      bandSigma: roundTo(features.bandSigma),
      distToMidPct: roundTo(features.distToMidPct),
      ma5: roundTo(features.ma5),
      ma20: roundTo(features.ma20),
      ma60: roundTo(features.ma60),
      goldenCrossDays: features.goldenCrossDays,
      daysAboveMid: features.daysAboveMid,
    },
    plan,
    rr: roundTo(plan.rr),
    score: roundTo(scoreSwing(features, plan, verdict.key || "midBandDefense")),
    verdict,
    scenarios,
    // 掃描（scanQuality）、隔日沖（warnings）、技術頁（corporateActions.notes）都會揭露還原
    // 來源的降級，健檢原本是唯一漏掉的入口——而且 corporateActionResultMonthCovered 刻意讓
    // 「上游抓不到」不算未定案（否則會誤剔一批大型股），所以降級時上面那道
    // corporateActionUnresolved 擋門不會觸發，結果會以完全正常的樣子端出去。
    warnings: unique([
      ...(reference.warnings || []),
      ...(resultCoverage.degraded
        ? ["官方除權除息計算結果表這一輪沒抓齊，這檔的還原改用公告公式或跳空估算，均線與布林可能不夠精確。"]
        : []),
    ]),
    dataQuality: {
      degraded: Boolean(reference.degraded),
      referenceComplete: Boolean(reference.coverageComplete),
      corporateActionResultsComplete: !resultCoverage.degraded,
      markets: reference.markets,
    },
    disclaimer: "本功能只做技術型態檢測，提供進出參考價位，不是買賣建議，也不保證獲利。",
  };
}

const getOnlyApiPaths = new Set([
  "/api/health",
  "/api/auth/me",
  "/api/personal-data/export",
  "/api/symbols",
  "/api/sources",
  "/api/markets",
  "/api/overnight/verify",
  "/api/overnight/verify/history",
  "/api/notes/recent",
  "/api/fundamentals",
  "/api/overnight",
  "/api/backtest/overnight",
  "/api/swing/inspect",
  "/api/swing/verify",
  "/api/technical-analysis",
]);

async function handleApi(request, requestUrl, response) {
  if (getOnlyApiPaths.has(requestUrl.pathname) && request.method !== "GET") {
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }
  if (requestUrl.pathname === "/api/health") {
    const ready = lifecycleStatus === "ready";
    const now = Date.now();
    const startedAtMs = Date.parse(serverStartedAt);
    jsonResponse(response, ready ? 200 : 503, {
      ok: ready,
      status: lifecycleStatus,
      version: appVersion,
      startedAt: serverStartedAt || null,
      uptimeSeconds: Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((now - startedAtMs) / 1000)) : 0,
      generatedAt: new Date(now).toISOString(),
      persistence: { pendingWrites: pendingPersistenceCount() },
    });
    return true;
  }
  if (requestUrl.pathname === "/api/auth/login") {
    if (request.method !== "POST") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      const input = await readJsonBody(request);
      const username = String(input.username || "").trim();
      const password = String(input.password || "");
      if (!isValidUsername(username)) {
        jsonResponse(response, 401, { ok: false, error: "帳號或密碼錯誤" });
        return true;
      }
      const usernameLower = username.toLowerCase();
      if (isLoginBlocked(usernameLower)) {
        jsonResponse(response, 429, { ok: false, error: "嘗試次數過多，這個帳號已暫時鎖定，請 15 分鐘後再試。" });
        return true;
      }
      const db = await loadDb();
      const user = db.users.find((item) => item.username.toLowerCase() === usernameLower);
      const passwordMatches = verifyPassword(password, user?.passwordHash || LOGIN_DUMMY_PASSWORD_HASH);
      if (!user || !passwordMatches) {
        recordLoginFailure(usernameLower);
        jsonResponse(response, 401, { ok: false, error: "帳號或密碼錯誤" });
        return true;
      }
      const verifiedPasswordHash = user.passwordHash;
      loginFailures.delete(usernameLower);
      const committed = await commitDbMutation((currentDb) => {
        const currentUser = currentDb.users.find((item) => item.id === user.id);
        if (!currentUser || currentUser.passwordHash !== verifiedPasswordHash) {
          throw Object.assign(new Error("帳號或密碼錯誤"), { status: 401 });
        }
        const { token } = createSession(currentDb, currentUser.id);
        return { token, user: currentUser };
      });
      const { token } = committed;
      setSessionCookie(response, request, token);
      jsonResponse(response, 200, {
        ok: true,
        user: sanitizeUser(committed.user),
        warnings: {
          defaultAdminPassword: usingDefaultAdminPassword && user.username === (process.env.ADMIN_USERNAME || "admin"),
          defaultAppSecret: usingDefaultAppSecret,
        },
      });
    } catch (error) {
      mutationErrorResponse(response, error, 400);
    }
    return true;
  }

  if (requestUrl.pathname === "/api/auth/logout") {
    if (request.method !== "POST") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    const auth = await getAuthContext(request);
    if (auth.session) {
      await commitDbMutation((db) => {
        const sessions = db.sessions.filter((session) => session.id !== auth.session.id);
        if (sessions.length === db.sessions.length) return skipDbMutation();
        db.sessions = sessions;
        return undefined;
      });
    }
    clearSessionCookie(response, request);
    jsonResponse(response, 200, { ok: true });
    return true;
  }

  if (requestUrl.pathname === "/api/auth/me") {
    const auth = await requireAuth(request, response);
    if (!auth) return true;
    jsonResponse(response, 200, {
      ok: true,
      user: sanitizeUser(auth.user),
      warnings: {
        defaultAdminPassword: usingDefaultAdminPassword && auth.user.username === (process.env.ADMIN_USERNAME || "admin"),
        defaultAppSecret: usingDefaultAppSecret,
      },
    });
    return true;
  }

  if (requestUrl.pathname === "/api/auth/password") {
    if (request.method !== "POST") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    const authed = await requireAuth(request, response);
    if (!authed) return true;
    try {
      const input = await readJsonBody(request);
      const currentPassword = String(input.currentPassword || "");
      const newPassword = String(input.newPassword || "");
      if (!verifyPassword(currentPassword, authed.user.passwordHash)) {
        jsonResponse(response, 400, { ok: false, error: "目前密碼不正確" });
        return true;
      }
      if (newPassword.length < 8) {
        jsonResponse(response, 400, { ok: false, error: "新密碼至少需要 8 個字。" });
        return true;
      }
      await commitDbMutation((db) => {
        const { user, session } = requireCurrentMutationAuth(db, authed);
        if (!verifyPassword(currentPassword, user.passwordHash)) {
          throw new Error("目前密碼不正確");
        }
        user.passwordHash = hashPassword(newPassword);
        user.updatedAt = new Date().toISOString();
        // 換密碼後把這個人其他裝置的 session 全登出，只留目前操作中的這個。
        db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.id === session.id);
      });
      jsonResponse(response, 200, { ok: true });
    } catch (error) {
      mutationErrorResponse(response, error, 400);
    }
    return true;
  }

  const auth = await getAuthContext(request);

  // 行情、訊號等唯讀 API 目前開放未登入使用（本機看盤）；
  // 自選股、券商設定、帳號管理等個人資料端點在各自的 handler 內檢查登入。

  if (requestUrl.pathname === "/api/personal-data/export") {
    if (!ensureAuthed(auth, response)) return true;
    const db = await loadDb();
    jsonResponse(response, 200, { ok: true, bundle: buildPersonalBackup(db, auth.user) });
    return true;
  }

  if (requestUrl.pathname === "/api/personal-data/restore/preview") {
    if (request.method !== "POST") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    if (!ensureAuthed(auth, response)) return true;
    if (rejectPersonalRestoreBusy(response)) return true;
    try {
      const input = await readJsonBody(request, PERSONAL_BACKUP_REQUEST_MAX_BYTES);
      const db = await loadDb();
      jsonResponse(response, 200, await buildPersonalRestorePreview(
        db,
        auth.user,
        auth.session,
        input?.bundle,
        input?.options,
      ));
    } catch (error) {
      if (error?.message === "Request body too large") {
        portableErrorResponse(response, portableError("BACKUP_TOO_LARGE", "備份檔超過 16 MB 上限", 413));
      } else if (error instanceof SyntaxError) {
        portableErrorResponse(response, portableError("BACKUP_FORMAT_INVALID", "備份內容不是有效的 JSON"));
      } else if (error?.code) {
        portableErrorResponse(response, error);
      } else {
        apiFailure(response, 500, error);
      }
    }
    return true;
  }

  if (requestUrl.pathname === "/api/personal-data/restore") {
    if (request.method !== "POST") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    if (!ensureAuthed(auth, response)) return true;
    if (rejectPersonalRestoreBusy(response)) return true;
    try {
      const input = await readJsonBody(request);
      const db = await loadDb();
      jsonResponse(response, 200, await commitPersonalRestore(db, auth, input));
    } catch (error) {
      if (error instanceof SyntaxError) {
        portableErrorResponse(response, portableError("BACKUP_FORMAT_INVALID", "請求內容不是有效的 JSON", 400));
      } else if (error?.code) {
        // stale 回應把 currentRevisions 提升到頂層，方便前端直接更新本機 rev。
        if (error.code === "RESTORE_PREVIEW_STALE") {
          jsonResponse(response, error.status, {
            ok: false,
            code: error.code,
            error: error.message,
            currentRevisions: error.details?.currentRevisions || currentPersonalRevisions(await loadDb(), auth.user.id),
          });
        } else {
          portableErrorResponse(response, error);
        }
      } else {
        apiFailure(response, 500, error);
      }
    }
    return true;
  }

  if (requestUrl.pathname === "/api/admin/users") {
    if (!ensureAuthed(auth, response)) return true;
    if (auth.user.role !== "admin") {
      jsonResponse(response, 403, { ok: false, error: "需要管理者權限" });
      return true;
    }
    const db = await loadDb();
    if (request.method === "GET") {
      jsonResponse(response, 200, {
        ok: true,
        users: db.users.map(sanitizeUser),
      });
      return true;
    }
    if (request.method === "POST") {
      try {
        const input = await readJsonBody(request);
        const username = String(input.username || "").trim();
        const password = String(input.password || "");
        const displayName = String(input.displayName || username).trim();
        const role = input.role === "admin" ? "admin" : "user";
        if (!isValidUsername(username)) {
          throw new Error("帳號需為 3-32 個英數字、底線、句點或連字號。");
        }
        if (password.length < 8) {
          throw new Error("密碼至少需要 8 個字。");
        }
        const user = await commitDbMutation((currentDb) => {
          requireCurrentMutationAuth(currentDb, auth, { admin: true });
          if (currentDb.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
            throw new Error("帳號已存在。");
          }
          const now = new Date().toISOString();
          const created = {
            id: `u_${randomBytes(8).toString("hex")}`,
            username,
            displayName,
            role,
            passwordHash: hashPassword(password),
            createdAt: now,
            updatedAt: now,
          };
          currentDb.users.push(created);
          currentDb.watchLists ||= {};
          currentDb.watchLists[created.id] = defaultWatchListPayload();
          return created;
        });
        jsonResponse(response, 201, { ok: true, user: sanitizeUser(user) });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    if (request.method === "PATCH") {
      // 管理者重設任一帳號密碼（朋友忘記密碼時用，免手改資料庫檔）。
      try {
        const input = await readJsonBody(request);
        const targetId = String(input.id || "");
        const password = String(input.password || "");
        if (password.length < 8) {
          throw new Error("密碼至少需要 8 個字。");
        }
        const target = await commitDbMutation((currentDb) => {
          requireCurrentMutationAuth(currentDb, auth, { admin: true });
          const currentTarget = currentDb.users.find((item) => item.id === targetId);
          if (!currentTarget) {
            throw Object.assign(new Error("找不到這個帳號"), { status: 404 });
          }
          currentTarget.passwordHash = hashPassword(password);
          currentTarget.updatedAt = new Date().toISOString();
          // 重設後強制該帳號所有裝置重新登入。
          currentDb.sessions = currentDb.sessions.filter((s) => s.userId !== currentTarget.id);
          return currentTarget;
        });
        loginFailures.delete(target.username.toLowerCase());
        jsonResponse(response, 200, { ok: true, user: sanitizeUser(target) });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    if (request.method === "DELETE") {
      try {
        const id = String(requestUrl.searchParams.get("id") || "");
        // 連同個人資料一起清：session、自選股、到價提醒、交易紀錄、券商設定、備註、資料版本號。
        if (rejectPersonalRestoreBusy(response)) return true;
        const result = await commitDbMutation((currentDb) => {
          const { user: currentAdmin } = requireCurrentMutationAuth(currentDb, auth, { admin: true });
          const target = currentDb.users.find((item) => item.id === id);
          if (!target) throw Object.assign(new Error("找不到這個帳號"), { status: 404 });
          if (target.id === currentAdmin.id) throw new Error("不能刪除自己正在使用的帳號。");
          if (target.role === "admin" && currentDb.users.filter((u) => u.role === "admin").length <= 1) {
            throw new Error("至少要保留一個管理者帳號。");
          }
          currentDb.users = currentDb.users.filter((u) => u.id !== id);
          currentDb.sessions = currentDb.sessions.filter((s) => s.userId !== id);
          if (currentDb.watchLists) delete currentDb.watchLists[id];
          if (currentDb.priceAlerts) delete currentDb.priceAlerts[id];
          if (currentDb.trades) delete currentDb.trades[id];
          if (currentDb.brokerCredentials) delete currentDb.brokerCredentials[id];
          if (currentDb.dataRevs) delete currentDb.dataRevs[id];
          let removedStockNotes = false;
          if (currentDb.stockNotes) {
            for (const code of Object.keys(currentDb.stockNotes)) {
              const beforeCount = (currentDb.stockNotes[code] || []).length;
              currentDb.stockNotes[code] = (currentDb.stockNotes[code] || []).filter((note) => note.userId !== id);
              if (currentDb.stockNotes[code].length !== beforeCount) removedStockNotes = true;
              if (!currentDb.stockNotes[code].length) delete currentDb.stockNotes[code];
            }
          }
          if (removedStockNotes) bumpSharedRev(currentDb, "stockNotes");
          return { username: target.username, users: currentDb.users.map(sanitizeUser) };
        });
        loginFailures.delete(result.username.toLowerCase());
        await closeFubonClient(id);
        jsonResponse(response, 200, { ok: true, users: result.users });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  if (requestUrl.pathname === "/api/watchlists") {
    if (!ensureAuthed(auth, response)) return true;
    const db = await loadDb();
    if (!db.watchLists[auth.user.id]) {
      await commitDbMutation((currentDb) => {
        const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
        currentDb.watchLists ||= {};
        if (currentDb.watchLists[currentUser.id]) return skipDbMutation();
        currentDb.watchLists[currentUser.id] = defaultWatchListPayload();
        return undefined;
      });
    }
    if (request.method === "GET") {
      jsonResponse(response, 200, {
        ok: true,
        rev: getDataRev(db, auth.user.id, "watchLists"),
        lists: normalizeWatchListsPayload(db.watchLists[auth.user.id]),
      });
      return true;
    }
    if (request.method === "PUT") {
      try {
        const input = await readJsonBody(request);
        if (rejectPersonalRestoreBusy(response)) return true;
        if (!input?.lists || typeof input.lists !== "object" || Array.isArray(input.lists)) {
          jsonResponse(response, 422, capacityValidationError("lists 必須是包含三組自選股的物件", [
            { field: "lists", message: "lists 必須是物件" },
          ]));
          return true;
        }
        const lists = normalizeWatchListsPayload(input.lists);
        const overLimit = Object.entries(lists).find(([, codes]) => codes.length > MAX_WATCHLIST_CODES_PER_LIST);
        if (overLimit) {
          const [key, codes] = overLimit;
          jsonResponse(response, 422, capacityValidationError(
            `自選股清單 ${key} 最多 ${MAX_WATCHLIST_CODES_PER_LIST} 檔，目前有 ${codes.length} 檔`,
            [{ field: `lists.${key}`, message: `清洗去重後不可超過 ${MAX_WATCHLIST_CODES_PER_LIST} 檔`, count: codes.length }],
          ));
          return true;
        }
        const committed = await commitDbMutation((currentDb) => {
          const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
          if (rejectStaleRev(currentDb, currentUser.id, "watchLists", input?.rev, response)) {
            return skipDbMutation(null);
          }
          currentDb.watchLists ||= {};
          currentDb.watchLists[currentUser.id] = lists;
          const rev = bumpDataRev(currentDb, currentUser.id, "watchLists");
          return { rev, lists: normalizeWatchListsPayload(currentDb.watchLists[currentUser.id]) };
        });
        if (!committed) return true;
        jsonResponse(response, 200, {
          ok: true,
          rev: committed.rev,
          lists: committed.lists,
        });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  if (requestUrl.pathname === "/api/alerts") {
    if (!ensureAuthed(auth, response)) return true;
    const db = await loadDb();
    db.priceAlerts ||= {};
    if (request.method === "GET") {
      jsonResponse(response, 200, {
        ok: true,
        rev: getDataRev(db, auth.user.id, "alerts"),
        alerts: normalizeAlertsPayload(db.priceAlerts[auth.user.id]),
      });
      return true;
    }
    if (request.method === "PUT") {
      try {
        const input = await readJsonBody(request);
        if (rejectPersonalRestoreBusy(response)) return true;
        if (!Array.isArray(input?.alerts)) {
          jsonResponse(response, 422, capacityValidationError("alerts 必須是陣列", [
            { field: "alerts", message: "alerts 必須是陣列" },
          ]));
          return true;
        }
        const alerts = normalizeAlertsPayload(input.alerts);
        if (alerts.length > MAX_PRICE_ALERTS) {
          jsonResponse(response, 422, capacityValidationError(
            `到價提醒最多 ${MAX_PRICE_ALERTS} 筆，目前有 ${alerts.length} 筆`,
            [{ field: "alerts", message: `清洗去重後不可超過 ${MAX_PRICE_ALERTS} 筆`, count: alerts.length }],
          ));
          return true;
        }
        const committed = await commitDbMutation((currentDb) => {
          const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
          if (rejectStaleRev(currentDb, currentUser.id, "alerts", input?.rev, response)) {
            return skipDbMutation(null);
          }
          currentDb.priceAlerts ||= {};
          currentDb.priceAlerts[currentUser.id] = alerts;
          const rev = bumpDataRev(currentDb, currentUser.id, "alerts");
          return { rev, alerts: cloneJson(currentDb.priceAlerts[currentUser.id]) };
        });
        if (!committed) return true;
        jsonResponse(response, 200, {
          ok: true,
          rev: committed.rev,
          alerts: committed.alerts,
        });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  if (requestUrl.pathname === "/api/instrument-profile") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    const rawCode = String(requestUrl.searchParams.get("code") || "").trim().toUpperCase();
    if (!SECURITY_CODE_PATTERN.test(rawCode)) {
      jsonResponse(response, 400, { ok: false, error: "證券代號必須是 4～6 碼英數字" });
      return true;
    }
    try {
      const resolved = await resolveOfficialInstruments([rawCode]);
      const profile = resolved.profiles.get(rawCode) || null;
      jsonResponse(response, 200, {
        ok: true,
        code: rawCode,
        status: profile ? "official" : "unresolved",
        profile,
        warnings: resolved.warnings,
        dataQuality: resolved.dataQuality,
      });
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }

  if (requestUrl.pathname === "/api/trades") {
    if (!ensureAuthed(auth, response)) return true;
    const db = await loadDb();
    db.trades ||= {};
    if (request.method === "GET") {
      const payload = normalizeTradesPayload(db.trades[auth.user.id]);
      jsonResponse(response, 200, {
        ok: true,
        rev: getDataRev(db, auth.user.id, "trades"),
        ...payload,
        portfolio: buildPortfolio(payload),
        // 官方歸檔裡有、但帳本沒登錄的除權／現增；前端據此提供事後補登。
        missingCorporateActions: await findMissingCorporateActions(payload),
      });
      return true;
    }
    if (request.method === "PUT") {
      try {
        const input = await readJsonBody(request);
        if (rejectPersonalRestoreBusy(response)) return true;
        if (rejectStaleRev(db, auth.user.id, "trades", input?.rev, response)) return true;
        // official/rule/as-of 是伺服器管理欄位。先以「不信任 client provenance」的
        // 版本做結構驗證，避免壞資料觸發上游查詢；正式 stamp 後再驗一次完整契約。
        const untrustedInput = {
          ...input,
          records: Array.isArray(input?.records) ? input.records.map((record) => {
            if (!record || typeof record !== "object" || Array.isArray(record)) return record;
            const copy = { ...record };
            copy.instrumentSource = copy.instrumentType == null || copy.instrumentType === "" ? "legacy" : "user";
            delete copy.instrumentRuleId;
            delete copy.instrumentAsOf;
            return copy;
          }) : input?.records,
        };
        const preliminaryValidation = validateTradesMutationInput(untrustedInput);
        if (!preliminaryValidation.ok) {
          jsonResponse(response, 422, {
            ok: false,
            code: "VALIDATION_ERROR",
            error: preliminaryValidation.errors[0]?.message || "交易帳本內容不正確",
            details: preliminaryValidation.errors,
          });
          return true;
        }
        const existingPayload = normalizeTradesPayload(db.trades[auth.user.id]);
        const canonical = await canonicalizeTradeInstrumentProvenance(input, existingPayload);
        const moneyCanonicalPayload = canonicalizeTradeMoneyProvenance(canonical.payload, existingPayload);
        const validation = validateTradesMutationInput(moneyCanonicalPayload);
        if (!validation.ok) {
          jsonResponse(response, 422, {
            ok: false,
            code: "VALIDATION_ERROR",
            error: validation.errors[0]?.message || "交易帳本內容不正確",
            details: validation.errors,
          });
          return true;
        }
        const payload = normalizeTradesPayload({
          ...moneyCanonicalPayload,
          quarantinedRecords: existingPayload.quarantinedRecords,
        });
        const portfolio = buildPortfolio(payload);
        if (!portfolio.ok) {
          jsonResponse(response, 400, { ok: false, error: portfolio.error });
          return true;
        }
        // 官方主檔查詢可能 await 很久；提交前必須再驗一次 rev，避免兩個同 rev PUT
        // 都通過入口檢查後相互覆蓋。重驗、bump 與 save 同在 transaction queue。
        const committed = await commitDbMutation((currentDb) => {
          const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
          if (rejectPersonalRestoreBusy(response)) return skipDbMutation(null);
          if (rejectStaleRev(currentDb, currentUser.id, "trades", input?.rev, response)) {
            return skipDbMutation(null);
          }
          currentDb.trades ||= {};
          currentDb.trades[currentUser.id] = payload;
          return { rev: bumpDataRev(currentDb, currentUser.id, "trades") };
        });
        if (!committed) return true;
        jsonResponse(response, 200, {
          ok: true,
          rev: committed.rev,
          ...payload,
          portfolio,
          instrumentWarnings: canonical.warnings,
          instrumentDataQuality: canonical.dataQuality,
        });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  if (requestUrl.pathname === "/api/broker/settings") {
    if (!ensureAuthed(auth, response)) return true;
    if (request.method === "GET") {
      jsonResponse(response, 200, await getBrokerSettingsStatus(auth.user.id));
      return true;
    }
    if (request.method === "POST") {
      try {
        const input = await readJsonBody(request);
        jsonResponse(response, 200, await saveBrokerSettings(auth, input));
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    if (request.method === "DELETE") {
      try {
        jsonResponse(response, 200, await deleteBrokerSettings(auth));
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  if (requestUrl.pathname === "/api/broker/test") {
    if (!ensureAuthed(auth, response)) return true;
    if (request.method !== "POST") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    const input = await readJsonBody(request).catch(() => ({}));
    const code = cleanCode(input.code || "2330") || "2330";
    const body = await getBrokerTestQuote(auth, code);
    jsonResponse(response, body.ok ? 200 : 503, body);
    return true;
  }

  if (requestUrl.pathname === "/api/symbols") {
    const query = String(requestUrl.searchParams.get("q") || "").trim();
    if (!query) {
      jsonResponse(response, 400, { ok: false, error: "缺少搜尋關鍵字" });
      return true;
    }
    try {
      const reference = await getReferenceData();
      const codeQuery = cleanCode(query);
      const upperQuery = query.toUpperCase();
      const matches = [];
      for (const quote of reference.byCode.values()) {
        const name = String(quote.name || "");
        const upperName = name.toUpperCase();
        const exactCode = codeQuery && quote.code === codeQuery;
        const codePrefix = codeQuery && quote.code.startsWith(codeQuery);
        const nameStarts = upperName.startsWith(upperQuery);
        const nameIncludes = upperName.includes(upperQuery);
        if (!exactCode && !codePrefix && !nameIncludes) continue;
        matches.push({
          weight: exactCode ? 0 : nameStarts ? 1 : codePrefix ? 2 : 3,
          code: quote.code,
          name,
          exchange: quote.exchange,
          price: quote.price,
          changePct: quote.changePct,
        });
      }
      matches.sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code));
      jsonResponse(response, 200, {
        ok: true,
        query,
        generatedAt: new Date().toISOString(),
        results: matches.slice(0, 20).map(({ weight, ...rest }) => rest),
        warnings: reference.warnings || [],
        dataQuality: {
          degraded: Boolean(reference.degraded),
          referenceComplete: Boolean(reference.coverageComplete),
          markets: reference.markets,
        },
      });
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/sources") {
    jsonResponse(response, 200, await buildSourceStatus(auth));
    return true;
  }
  if (requestUrl.pathname === "/api/market-session") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      jsonResponse(response, 200, await getMarketSessionStatus());
    } catch (error) {
      // 開休市狀態不可拖垮行情：即使兩個日曆來源同時失敗也回 unknown，由前端短暫重試。
      jsonResponse(response, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        timezone: "Asia/Taipei",
        stock: { date: compactToIsoDate(toTaipeiCompactDate()), tradingDay: null, holidayName: "", confidence: "unknown", degraded: true },
        warnings: [`開休市狀態暫時無法確認：${error.message}`],
      });
    }
    return true;
  }
  if (requestUrl.pathname === "/api/markets") {
    try {
      const provider = getDataProvider(requestUrl.searchParams.get("source"));
      const body = await provider.getMarkets(auth);
      jsonResponse(response, body.ok ? 200 : 503, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/quotes") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      const codes = parseRequestedCodes(requestUrl.searchParams.get("codes"));
      const provider = getDataProvider(requestUrl.searchParams.get("source"));
      const body = await provider.getQuotes(codes, auth);
      jsonResponse(response, body.ok ? 200 : 503, body);
    } catch (error) {
      const validationError = /股票代號|至少需要/.test(error.message || "");
      if (validationError) jsonResponse(response, 400, { ok: false, error: error.message });
      else apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/institutional") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      const codes = parseRequestedCodes(requestUrl.searchParams.get("codes"), defaultCodes, 300);
      const dateCompact = parseHistoricalQueryDate(requestUrl.searchParams.get("date"));
      const body = await getInstitutionalData({ codes, dateCompact });
      jsonResponse(response, body.ok ? 200 : 503, body);
    } catch (error) {
      if (/日期|股票代號|至少需要/.test(error.message || "")) jsonResponse(response, 400, { ok: false, error: error.message });
      else apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/overnight/verify") {
    try {
      jsonResponse(response, 200, await buildSignalVerification());
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/overnight/verify/history") {
    try {
      jsonResponse(response, 200, await buildVerificationHistory());
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/margin") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      const codes = parseRequestedCodes(requestUrl.searchParams.get("codes"), defaultCodes, 300);
      const dateCompact = parseHistoricalQueryDate(requestUrl.searchParams.get("date"));
      const body = await getMarginData({ codes, dateCompact });
      jsonResponse(response, body.ok ? 200 : 503, body);
    } catch (error) {
      if (/日期|股票代號|至少需要/.test(error.message || "")) jsonResponse(response, 400, { ok: false, error: error.message });
      else apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/notes/recent") {
    const db = await loadDb();
    db.stockNotes ||= {};
    const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get("limit") || 20)));
    let reference = null;
    try {
      reference = await getReferenceData();
    } catch {
      // 名稱補不到就只顯示代號。
    }
    const notes = Object.values(db.stockNotes)
      .flat()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map((note) => ({ ...note, name: reference?.byCode.get(note.code)?.name || "" }));
    jsonResponse(response, 200, { ok: true, notes });
    return true;
  }
  if (requestUrl.pathname === "/api/notes") {
    const db = await loadDb();
    db.stockNotes ||= {};
    // 讀取開放未登入（本機看盤模式）；新增與刪除仍需要登入。
    if (request.method === "GET") {
      const code = cleanCode(requestUrl.searchParams.get("code"));
      if (!code) {
        jsonResponse(response, 400, { ok: false, error: "缺少股票代號" });
        return true;
      }
      jsonResponse(response, 200, { ok: true, code, notes: db.stockNotes[code] || [] });
      return true;
    }
    if (!ensureAuthed(auth, response)) return true;
    if (request.method === "POST") {
      try {
        const input = await readJsonBody(request);
        if (rejectPersonalRestoreBusy(response)) return true;
        const code = cleanCode(input.code);
        const text = String(input.text || "").trim().slice(0, 500);
        if (!code || !text) throw new Error("需要股票代號與備註內容");
        const committed = await commitDbMutation((currentDb) => {
          const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
          if (rejectPersonalRestoreBusy(response)) return skipDbMutation(null);
          currentDb.stockNotes ||= {};
          currentDb.stockNotes[code] ||= [];
          if (currentDb.stockNotes[code].length >= 50) {
            jsonResponse(response, 409, {
              ok: false,
              code: "NOTE_CAPACITY_REACHED",
              error: "這檔股票的共享備註已達 50 則上限；請先整理既有內容。",
            });
            return skipDbMutation(null);
          }
          const note = {
            id: `n_${randomBytes(6).toString("hex")}`,
            code,
            userId: currentUser.id,
            userName: currentUser.displayName || currentUser.username,
            text,
            createdAt: new Date().toISOString(),
          };
          currentDb.stockNotes[code].push(note);
          bumpSharedRev(currentDb, "stockNotes");
          return cloneJson(currentDb.stockNotes[code]);
        });
        if (!committed) return true;
        jsonResponse(response, 201, { ok: true, code, notes: committed });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    if (request.method === "DELETE") {
      try {
        if (rejectPersonalRestoreBusy(response)) return true;
        const code = cleanCode(requestUrl.searchParams.get("code"));
        const id = String(requestUrl.searchParams.get("id") || "");
        const notes = await commitDbMutation((currentDb) => {
          const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
          if (rejectPersonalRestoreBusy(response)) return skipDbMutation(null);
          const currentNotes = currentDb.stockNotes?.[code] || [];
          const target = currentNotes.find((note) => note.id === id);
          if (!target) throw Object.assign(new Error("找不到這則備註"), { status: 404 });
          if (target.userId !== currentUser.id && currentUser.role !== "admin") {
            throw Object.assign(new Error("只能刪除自己的備註"), { status: 403 });
          }
          currentDb.stockNotes[code] = currentNotes.filter((note) => note.id !== id);
          bumpSharedRev(currentDb, "stockNotes");
          return cloneJson(currentDb.stockNotes[code]);
        });
        if (!notes) return true;
        jsonResponse(response, 200, { ok: true, code, notes });
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }
  if (requestUrl.pathname === "/api/company") {
    const db = await loadDb();
    db.companyProfiles ||= {};
    const buildBody = async (code) => {
      let meta = {};
      let directory = null;
      try {
        directory = await getCompanyDirectory();
        meta = directory.companyMeta.get(code) || {};
      } catch {
        // 官方基本資料端點失敗時，至少回手動簡介，不讓整頁壞掉。
      }
      const profile = db.companyProfiles[code] || null;
      return {
        ok: true,
        code,
        industry: meta.industry || "",
        shortName: meta.shortName || "",
        summary: profile?.summary || "",
        updatedAt: profile?.updatedAt || "",
        updatedByName: profile?.updatedByName || "",
        warnings: directory?.warnings || [],
        dataQuality: directory ? { degraded: directory.degraded, markets: directory.markets } : { degraded: true },
      };
    };
    // 讀取開放未登入（本機看盤模式）；編輯簡介仍需要登入。
    if (request.method === "GET") {
      const code = cleanCode(requestUrl.searchParams.get("code"));
      if (!code) {
        jsonResponse(response, 400, { ok: false, error: "缺少股票代號" });
        return true;
      }
      jsonResponse(response, 200, await buildBody(code));
      return true;
    }
    if (!ensureAuthed(auth, response)) return true;
    if (request.method === "PUT" || request.method === "POST") {
      try {
        const input = await readJsonBody(request);
        const code = cleanCode(input.code);
        if (!code) throw new Error("需要股票代號");
        const summary = String(input.summary || "").trim().slice(0, 800);
        await commitDbMutation((currentDb) => {
          const { user: currentUser } = requireCurrentMutationAuth(currentDb, auth);
          currentDb.companyProfiles ||= {};
          if (summary) {
            currentDb.companyProfiles[code] = {
              code,
              summary,
              updatedAt: new Date().toISOString(),
              updatedBy: currentUser.id,
              updatedByName: currentUser.displayName || currentUser.username,
            };
          } else {
            // 清空視為刪除簡介。
            delete currentDb.companyProfiles[code];
          }
        });
        jsonResponse(response, 200, await buildBody(code));
      } catch (error) {
        mutationErrorResponse(response, error, 400);
      }
      return true;
    }
    jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }
  if (requestUrl.pathname === "/api/fundamentals") {
    // 讀取開放未登入（本機看盤模式），比照 /api/company。
    const code = cleanCode(requestUrl.searchParams.get("code"));
    if (!code) {
      jsonResponse(response, 400, { ok: false, error: "缺少股票代號" });
      return true;
    }
    try {
      jsonResponse(response, 200, await buildFundamentals(code));
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/overnight") {
    try {
      const dateCompact = toCompactDate(requestUrl.searchParams.get("date"));
      const maxPerGroup = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get("limit") || 20)));
      const body = await buildOvernightSignals({ dateCompact, maxPerGroup });
      jsonResponse(response, 200, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/backtest/overnight") {
    try {
      const days = Math.min(90, Math.max(10, Number(requestUrl.searchParams.get("days") || 30)));
      const body = await buildBacktest({ days });
      jsonResponse(response, 200, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/swing/inspect") {
    try {
      const code = requestUrl.searchParams.get("code") || "";
      if (!code.trim()) {
        jsonResponse(response, 400, { ok: false, error: "請提供股票代碼或股名" });
        return true;
      }
      const body = await inspectSwingStock(code);
      jsonResponse(response, body.ok ? 200 : body.retryable ? 503 : 404, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/swing") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      const scenarioKey = requestUrl.searchParams.get("scenario") || "";
      const limit = Math.min(80, Math.max(5, Number(requestUrl.searchParams.get("limit") || 40)));
      const forceRefresh = requestUrl.searchParams.get("refresh") === "1";
      if (forceRefresh && !ensureAuthed(auth, response)) return true;
      if (forceRefresh) {
        const elapsed = Date.now() - lastSwingForceRefreshAt;
        if (elapsed < SWING_FORCE_REFRESH_COOLDOWN_MS) {
          jsonResponse(response, 429, {
            ok: false,
            code: "SWING_REFRESH_COOLDOWN",
            error: "波段全市場掃描剛執行過，請稍後再重新整理。",
            retryAfterSeconds: Math.ceil((SWING_FORCE_REFRESH_COOLDOWN_MS - elapsed) / 1000),
          });
          return true;
        }
        lastSwingForceRefreshAt = Date.now();
      }
      const body = await buildSwingBoard({ scenarioKey, limit, forceRefresh });
      jsonResponse(response, 200, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/swing/verify") {
    try {
      jsonResponse(response, 200, await buildSwingVerificationSummary());
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/surveillance-board") {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "Method not allowed" });
      return true;
    }
    try {
      const rawDate = requestUrl.searchParams.get("date");
      const today = toTaipeiCompactDate();
      if (rawDate !== null) {
        const requestedDate = toCompactDate(rawDate);
        if (!/^\d{8}$/.test(requestedDate) || requestedDate !== today) {
          jsonResponse(response, 400, {
            ok: false,
            error: "處置看板只提供伺服器今日資料；不可用 date 參數建立過去或未來快照。",
          });
          return true;
        }
      }
      const body = await getSurveillanceBoardSingleFlight(today);
      jsonResponse(response, 200, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  if (requestUrl.pathname === "/api/technical-analysis") {
    try {
      const body = await buildTechnicalAnalysis({
        code: requestUrl.searchParams.get("code"),
        period: requestUrl.searchParams.get("period"),
      });
      jsonResponse(response, body.ok ? 200 : body.retryable ? 503 : 400, body);
    } catch (error) {
      apiFailure(response, 502, error);
    }
    return true;
  }
  return false;
}

async function serveStatic(request, requestUrl, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    textResponse(response, 405, "Method not allowed");
    return;
  }
  const fileName = publicStaticFiles.get(requestUrl.pathname);
  if (!fileName) {
    textResponse(response, 404, "Not found");
    return;
  }
  const candidate = join(root, fileName);
  const file = await readFile(candidate);
  const type = mimeTypes[extname(candidate).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, {
    ...securityHeaders,
    "content-type": type,
    "cache-control": "no-cache",
  });
  response.end(request.method === "HEAD" ? undefined : file);
}

function buildWriterLeaseEndpoint(canonicalPath) {
  const identity = process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\stock1-data-${digest}`;
  // Linux abstract socket 與 Windows named pipe 都由 OS 持有，程序 crash 後不會留下 stale lock。
  if (process.platform === "linux") return `\0stock1-data-${digest}`;
  // 其他平台退到 deterministic loopback lease；碰撞時寧可拒絕啟動，不冒雙 writer 風險。
  return { host: "127.0.0.1", port: 30000 + (Number.parseInt(digest.slice(0, 8), 16) % 20000) };
}

function isPathInside(parentPath, candidatePath) {
  const rel = relative(parentPath, candidatePath);
  return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function writerPathIdentity(value) {
  return process.platform === "win32" ? String(value).toLowerCase() : String(value);
}

async function validateDbPathWithinDataDir(canonicalDataDir, canonicalBackupDir = "") {
  const absoluteDbPath = resolve(dbPath);
  const absoluteDbParent = dirname(absoluteDbPath);
  let canonicalDbParent;
  try {
    canonicalDbParent = await realpath(absoluteDbParent);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    // saveDb 本來只建立 DATA_DIR；自訂 DB_PATH 的父目錄必須事先存在，避免驗證階段
    // 沿著 symlink 在 DATA_DIR 外意外建立目錄。
    throw Object.assign(
      new Error("[Stock1] DB_PATH_PARENT_MISSING：自訂 DB_PATH 的父目錄不存在。"),
      { code: "DB_PATH_PARENT_MISSING" },
    );
  }
  // 原子 rename 寫入的是「父目錄 canonical 化後的這個 directory entry」，不是既有 symlink
  // 所指向的 inode；resource lease 也必須鎖同一個實際寫入目標。
  const canonicalDbPath = resolve(canonicalDbParent, basename(absoluteDbPath));
  const canonicalDataKey = writerPathIdentity(canonicalDataDir);
  const canonicalDbKey = writerPathIdentity(canonicalDbPath);
  if (!isPathInside(canonicalDataKey, canonicalDbKey)) {
    throw Object.assign(
      new Error("[Stock1] DB_PATH_OUTSIDE_DATA_DIR：DB_PATH 必須位於目前 DATA_DIR 內，避免繞過單一 writer lease。"),
      { code: "DB_PATH_OUTSIDE_DATA_DIR" },
    );
  }

  const relativeDbSegments = relative(canonicalDataKey, canonicalDbKey).split(sep).filter(Boolean);
  const canonicalBackupKey = canonicalBackupDir ? writerPathIdentity(canonicalBackupDir) : "";
  const reservedBasenames = new Set([
    "fundamentals-cache.json",
    "fundamentals-cache.json.tmp",
    "risk-cache.json",
    "risk-cache.json.tmp",
    "surveillance-history.json",
    "surveillance-history.json.tmp",
  ]);
  if (
    (canonicalBackupKey && (canonicalDbKey === canonicalBackupKey || isPathInside(canonicalBackupKey, canonicalDbKey)))
    || relativeDbSegments.includes("backups")
    || relativeDbSegments.some((segment) => reservedBasenames.has(segment))
  ) {
    throw Object.assign(
      new Error("[Stock1] DB_PATH_RESERVED：DB_PATH 任一層級都不可與 backups 或持久化 sidecar／暫存檔共用名稱。"),
      { code: "DB_PATH_RESERVED" },
    );
  }

  try {
    const info = await lstat(absoluteDbPath);
    if (info.isSymbolicLink()) {
      throw Object.assign(
        new Error("[Stock1] DB_PATH_SYMLINK_UNSAFE：主資料庫檔不可使用 symbolic link。"),
        { code: "DB_PATH_SYMLINK_UNSAFE" },
      );
    }
    if (!info.isFile()) {
      throw Object.assign(
        new Error("[Stock1] DB_PATH_NOT_FILE：既有 DB_PATH 必須是一般檔案。"),
        { code: "DB_PATH_NOT_FILE" },
      );
    }
    if (Number(info.nlink) > 1) {
      throw Object.assign(
        new Error("[Stock1] DB_PATH_HARDLINK_UNSAFE：主資料庫檔不可有多個 hard link。"),
        { code: "DB_PATH_HARDLINK_UNSAFE" },
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return canonicalDbPath;
}

function listenWriterLease(lease, endpoint) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      lease.off("error", onError);
      lease.off("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    lease.once("error", onError);
    lease.once("listening", onListening);
    try {
      if (typeof endpoint === "string") lease.listen(endpoint);
      else lease.listen({ ...endpoint, exclusive: true });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function closeWriterLeaseServer(lease) {
  if (!lease?.listening) return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    lease.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") rejectClose(error);
      else resolveClose();
    });
  });
}

async function acquireDataDirParentGuard(parentPath) {
  const endpoint = buildWriterLeaseEndpoint(parentPath);
  for (let attempt = 0; ; attempt += 1) {
    const lease = createNetServer((socket) => {
      socket.end(`${JSON.stringify({ app: "Stock1", pid: process.pid, version: appVersion, resource: "DATA_DIR parent guard" })}\n`);
    });
    try {
      await listenWriterLease(lease, endpoint);
      return lease;
    } catch (error) {
      if (error?.code !== "EADDRINUSE" || attempt >= 5) {
        if (error?.code === "EADDRINUSE") {
          throw Object.assign(
            new Error(`[Stock1] DATA_DIR_IN_USE：DATA_DIR 的父路徑目前由另一個 Stock1 writer 使用：${parentPath}`),
            { code: "DATA_DIR_IN_USE", cause: error },
          );
        }
        throw error;
      }
      // Sibling DATA_DIR startups may briefly share a parent guard. Retry the
      // short transient case; a real owner remains bound and fails closed.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10 * (2 ** attempt)));
    }
  }
}

async function validateBackupWriterEntries(canonicalBackupDir) {
  if (!existsSync(canonicalBackupDir)) return;
  const writerName = /^stock1-(?:db-\d{8}|pre-restore-.+)\.json(?:\.tmp)?$/i;
  for (const name of await readdir(canonicalBackupDir)) {
    if (!writerName.test(name)) continue;
    const info = await lstat(join(canonicalBackupDir, name));
    if (info.isSymbolicLink() || !info.isFile() || Number(info.nlink) > 1) {
      throw Object.assign(
        new Error(`[Stock1] BACKUP_ENTRY_UNSAFE：備份 writer 路徑必須是單一名稱的一般檔案：${name}`),
        { code: "BACKUP_ENTRY_UNSAFE" },
      );
    }
  }
}

async function validateFixedWriterEntries(paths) {
  for (const path of paths) {
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile() || Number(info.nlink) > 1) {
      throw Object.assign(
        new Error(`[Stock1] WRITER_ENTRY_UNSAFE：固定 writer 路徑若已存在，必須是單一名稱的一般檔案：${path}`),
        { code: "WRITER_ENTRY_UNSAFE" },
      );
    }
  }
}

function attachWriterLeaseFailStop(lease, resourceLabel, isCurrentLease) {
  const failStop = (error) => {
    if (!isCurrentLease() || !dataDirLeaseHealthy) return;
    dataDirLeaseHealthy = false;
    lifecycleStatus = "failed";
    console.error(`[Stock1] ${resourceLabel} writer lease 意外失效，服務立即 fail-stop：`, error?.message || error);
    if (!process.env.STOCK1_SKIP_LISTEN) {
      // 任一 writer lease 遺失時，只有立刻終止才能保證不會與接手程序重疊寫入。
      process.exit(1);
    }
    void closeHttpServer().catch((closeError) => {
      console.error("[Stock1] lease 失效後停止 HTTP 失敗：", closeError?.message || closeError);
    });
  };
  lease.on("error", failStop);
  lease.once("close", () => failStop(new Error(`${resourceLabel} lease endpoint closed unexpectedly`)));
}

async function canonicalizeProspectivePath(value) {
  const absolutePath = resolve(value);
  try {
    await lstat(absolutePath);
    return realpath(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // Only the DATA_DIR leaf may be created. Requiring its immediate parent to
  // exist prevents `writer-file.tmp/child` from turning another instance's
  // not-yet-created writer resource into a directory before exact-path leases
  // can collide.
  const parentPath = dirname(absolutePath);
  let canonicalParent;
  try {
    canonicalParent = await realpath(parentPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw Object.assign(
      new Error("[Stock1] DATA_DIR_PARENT_MISSING：DATA_DIR 的上一層目錄必須先建立。"),
      { code: "DATA_DIR_PARENT_MISSING" },
    );
  }
  const parentInfo = await lstat(canonicalParent);
  if (!parentInfo.isDirectory()) {
    throw Object.assign(
      new Error("[Stock1] DATA_DIR_PARENT_NOT_DIRECTORY：DATA_DIR 的上一層必須是目錄。"),
      { code: "DATA_DIR_PARENT_NOT_DIRECTORY" },
    );
  }
  return resolve(canonicalParent, basename(absolutePath));
}

function acquireDataDirLease() {
  if (
    dataDirLeaseServer?.listening
    && backupDirLeaseServer?.listening
    && sidecarLeaseServers.length === 6
    && sidecarLeaseServers.every((lease) => lease.listening)
  ) return Promise.resolve({
    canonicalDataDir: leasedCanonicalDataDir,
    canonicalBackupDir: leasedCanonicalBackupDir,
  });
  if (dataDirLeasePromise) return dataDirLeasePromise;
  const operation = (async () => {
    dataDirLeaseRequired = true;
    dataDirLeaseHealthy = true;
    let parentGuardLease = null;
    const acquireResource = async (resource) => {
      const endpoint = buildWriterLeaseEndpoint(resource.path);
      const lease = createNetServer((socket) => {
        socket.end(`${JSON.stringify({ app: "Stock1", pid: process.pid, version: appVersion, resource: resource.label })}\n`);
      });
      try {
        await listenWriterLease(lease, endpoint);
      } catch (error) {
        if (error?.code === "EADDRINUSE") {
          throw Object.assign(
            new Error(`[Stock1] DATA_DIR_IN_USE：已有另一個 Stock1 程序正在使用資料資源 ${resource.path}。請先關閉舊程序再重試。`),
            { code: "DATA_DIR_IN_USE", cause: error },
          );
        }
        throw error;
      }
      resource.assign(lease);
      attachWriterLeaseFailStop(lease, resource.label, () => (
        dataDirLeaseServer === lease
        || backupDirLeaseServer === lease
        || sidecarLeaseServers.includes(lease)
      ));
    };
    try {
      // 先由最近既存父目錄推導 identity 並取得 lease，之後才 mkdir；被拒絕的 contender
      // 因此不能先把 owner 的 DB .tmp／sidecar file path 毒化成目錄。
      const prospectiveDataDir = await canonicalizeProspectivePath(dataDir);
      const prospectiveParent = dirname(prospectiveDataDir);
      if (writerPathIdentity(prospectiveParent) !== writerPathIdentity(prospectiveDataDir)) {
        parentGuardLease = await acquireDataDirParentGuard(prospectiveParent);
      }
      await acquireResource({
        path: prospectiveDataDir,
        label: "DATA_DIR",
        assign: (lease) => { dataDirLeaseServer = lease; },
      });
      await mkdir(dataDir, { recursive: true });
      const canonicalDataDir = await realpath(dataDir);
      if (writerPathIdentity(canonicalDataDir) !== writerPathIdentity(prospectiveDataDir)) {
        throw Object.assign(new Error("DATA_DIR 在 writer lease 建立期間改變 canonical identity"), {
          code: "DATA_DIR_IDENTITY_CHANGED",
        });
      }
      leasedCanonicalDataDir = canonicalDataDir;
      await closeWriterLeaseServer(parentGuardLease);
      parentGuardLease = null;

      const absoluteBackupDir = resolve(dbBackupDir);
      const expectedCanonicalBackupDir = resolve(canonicalDataDir, "backups");
      let backupEntry = null;
      try {
        backupEntry = await lstat(absoluteBackupDir);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      let canonicalBackupDir = expectedCanonicalBackupDir;
      if (backupEntry) {
        try {
          canonicalBackupDir = await realpath(absoluteBackupDir);
        } catch (error) {
          if (error?.code !== "ENOENT" || !backupEntry.isSymbolicLink()) throw error;
          throw Object.assign(
            new Error("[Stock1] BACKUP_DIR_ALIAS_UNSAFE：backups 不可使用懸空的 symbolic link 或 junction alias。"),
            { code: "BACKUP_DIR_ALIAS_UNSAFE" },
          );
        }
      }
      if (!isPathInside(writerPathIdentity(canonicalDataDir), writerPathIdentity(canonicalBackupDir))) {
        throw Object.assign(
          new Error("[Stock1] BACKUP_DIR_OUTSIDE_DATA_DIR：backups 必須位於目前 DATA_DIR 內。"),
          { code: "BACKUP_DIR_OUTSIDE_DATA_DIR" },
        );
      }
      if (writerPathIdentity(canonicalBackupDir) !== writerPathIdentity(expectedCanonicalBackupDir)) {
        throw Object.assign(
          new Error("[Stock1] BACKUP_DIR_ALIAS_UNSAFE：backups 不可使用 symbolic link 或 junction alias。"),
          { code: "BACKUP_DIR_ALIAS_UNSAFE" },
        );
      }
      if (backupEntry && !(await lstat(canonicalBackupDir)).isDirectory()) {
        throw Object.assign(
          new Error("[Stock1] BACKUP_DIR_NOT_DIRECTORY：backups 路徑必須是目錄。"),
          { code: "BACKUP_DIR_NOT_DIRECTORY" },
        );
      }
      leasedCanonicalBackupDir = canonicalBackupDir;

      const canonicalSidecarResources = [
        "fundamentals-cache.json",
        "risk-cache.json",
        "surveillance-history.json",
      ].flatMap((name) => {
        const target = resolve(canonicalDataDir, name);
        return [target, `${target}.tmp`];
      });
      const remainingResources = [
        { path: canonicalBackupDir, label: "DATA_DIR backups", assign: (lease) => { backupDirLeaseServer = lease; } },
        ...canonicalSidecarResources.map((path) => ({
          path,
          label: "sidecar",
          assign: (lease) => { sidecarLeaseServers.push(lease); },
        })),
      ];
      for (const resource of remainingResources) await acquireResource(resource);
      await validateFixedWriterEntries(canonicalSidecarResources);
      await validateBackupWriterEntries(canonicalBackupDir);

      if (
        !dataDirLeaseServer?.listening
        || !backupDirLeaseServer?.listening
        || sidecarLeaseServers.length !== 6
        || sidecarLeaseServers.some((lease) => !lease.listening)
        || !dataDirLeaseHealthy
      ) {
        throw Object.assign(new Error("DATA_DIR resource leases 未完整建立"), { code: "DATA_DIR_LEASE_LOST" });
      }
      return { canonicalDataDir, canonicalBackupDir };
    } catch (error) {
      await closeWriterLeaseServer(parentGuardLease).catch((guardError) => {
        console.error("[Stock1] 啟動失敗後釋放 DATA_DIR parent guard 失敗：", guardError);
      });
      parentGuardLease = null;
      await releaseDataDirLease().catch((releaseError) => {
        console.error("[Stock1] 啟動失敗後釋放部分 DATA_DIR leases 失敗：", releaseError);
      });
      throw error;
    }
  })();
  const tracked = operation.finally(() => {
    if (dataDirLeasePromise === tracked) dataDirLeasePromise = null;
  });
  dataDirLeasePromise = tracked;
  return tracked;
}

async function acquireDbPathLeases(canonicalDbPath) {
  if (dbPathLeaseServers.length && dbPathLeaseServers.every((lease) => lease.listening)) return;
  // 主檔與原子寫入 temp 都是實際資源；固定順序取得，避免 A 的 temp 成為 B 主檔。
  const resources = [canonicalDbPath, `${canonicalDbPath}.tmp`]
    .sort((left, right) => writerPathIdentity(left).localeCompare(writerPathIdentity(right)));
  for (const resourcePath of resources) {
    // 所有 filesystem writer 共用 data namespace，讓「A 的 file/tmp = B 的 DATA_DIR」也會碰撞。
    const endpoint = buildWriterLeaseEndpoint(resourcePath);
    const lease = createNetServer((socket) => {
      socket.end(`${JSON.stringify({ app: "Stock1", pid: process.pid, version: appVersion, resource: "DB_PATH" })}\n`);
    });
    try {
      await listenWriterLease(lease, endpoint);
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        throw Object.assign(
          new Error(`[Stock1] DB_PATH_IN_USE：已有另一個 Stock1 程序正在使用主資料庫資源 ${resourcePath}。請先關閉舊程序再重試。`),
          { code: "DB_PATH_IN_USE", cause: error },
        );
      }
      throw error;
    }
    dbPathLeaseServers.push(lease);
    attachWriterLeaseFailStop(lease, "DB_PATH", () => dbPathLeaseServers.includes(lease));
  }
  await validateFixedWriterEntries(resources);
  if (
    !dataDirLeaseServer?.listening
    || !backupDirLeaseServer?.listening
    || sidecarLeaseServers.length !== 6
    || sidecarLeaseServers.some((lease) => !lease.listening)
    || !dataDirLeaseHealthy
  ) {
    throw Object.assign(new Error("DATA_DIR writer lease 在 DB_PATH resource leases 建立期間失效"), {
      code: "DATA_DIR_LEASE_LOST",
    });
  }
}

async function releaseDataDirLease() {
  const leases = [...dbPathLeaseServers].reverse();
  leases.push(...[...sidecarLeaseServers].reverse());
  if (backupDirLeaseServer) leases.push(backupDirLeaseServer);
  if (dataDirLeaseServer) leases.push(dataDirLeaseServer);
  dbPathLeaseServers = [];
  sidecarLeaseServers = [];
  leasedCanonicalDataDir = "";
  leasedCanonicalBackupDir = "";
  backupDirLeaseServer = null;
  dataDirLeaseServer = null;
  dataDirLeaseRequired = false;
  dataDirLeaseHealthy = false;
  const results = await Promise.allSettled(leases.map((lease) => {
    if (!lease?.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      lease.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
    });
  }));
  const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, "writer leases 釋放失敗");
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, jsonHeaders);
      response.end();
      return;
    }
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      if (rejectUnsafeMutation(request, response)) return;
      const handled = await handleApi(request, requestUrl, response);
      if (!handled) jsonResponse(response, 404, { ok: false, error: "API not found" });
      return;
    }
    await serveStatic(request, requestUrl, response);
  } catch (error) {
    if (error?.code === "PERSISTENCE_FAILED" || Number(error?.status) >= 400) {
      mutationErrorResponse(response, error, 500);
    }
    else {
      jsonResponse(response, 500, {
        ok: false,
        error: error.message,
      });
    }
  }
});
function ensureBrokerCleanup() {
  if (!serverCloseCleanupPromise) {
    serverCloseCleanupPromise = trackBackgroundTask(closeAllFubonClients(), "券商連線清理");
  }
  return serverCloseCleanupPromise;
}

server.on("close", () => {
  resolveActiveServerClose?.();
  resolveActiveServerClose = null;
  activeServerClosePromise = null;
  void ensureBrokerCleanup();
  if (lifecycleStatus !== "stopping") lifecycleStatus = "stopped";
});
server.on("listening", () => {
  activeServerClosePromise = new Promise((resolve) => {
    resolveActiveServerClose = resolve;
  });
});

function closeHttpServer() {
  if (!server.listening) return activeServerClosePromise || Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
  });
}

async function performShutdown() {
  lifecycleStatus = "stopping";
  const failures = [];
  const starting = startPromise;
  if (starting) {
    const [result] = await Promise.allSettled([starting]);
    if (result.status === "rejected" && result.reason?.code !== "START_ABORTED") failures.push(result.reason);
  }
  // 先停止接受新請求；既有請求結束後，再把它們排入的寫入與券商 session 一併排空。
  const [closeResult] = await Promise.allSettled([closeHttpServer()]);
  if (closeResult.status === "rejected") failures.push(closeResult.reason);
  const cleanupResults = await Promise.allSettled([flushPersistence(), ensureBrokerCleanup()]);
  for (const result of cleanupResults) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  await Promise.resolve();
  // 只有 HTTP 已確認停止且所有可能寫檔的工作歸零，才能把 lease 交給下一程序。
  // 若仍可能有活 writer，寧可保留 lease 並讓 shutdown fail-closed，也不能造成雙 writer。
  const safeToReleaseLease = closeResult.status === "fulfilled"
    && !server.listening
    && pendingPersistenceCount() === 0;
  if (safeToReleaseLease) {
    const [leaseResult] = await Promise.allSettled([releaseDataDirLease()]);
    if (leaseResult.status === "rejected") failures.push(leaseResult.reason);
  } else if (dataDirLeaseRequired) {
    failures.push(Object.assign(
      new Error("HTTP 或持久化工作尚未安全停止；DATA_DIR lease 已保留，請勿啟動接手程序。"),
      { code: "DATA_DIR_LEASE_RETAINED" },
    ));
  }
  if (failures.length) {
    lifecycleStatus = "failed";
    throw new AggregateError(failures, "Stock1 安全關機未完整完成");
  }
  lifecycleStatus = "stopped";
}

// 刻意不是 async：同一輪多次呼叫必須拿到完全相同的 Promise，讓 signal／測試安全共用。
function shutdownServer(_options = {}) {
  shutdownRequested = true;
  if (!shutdownPromise) shutdownPromise = performShutdown();
  return shutdownPromise;
}

function startAbortedError() {
  return Object.assign(new Error("伺服器啟動已由安全關機取消"), { code: "START_ABORTED" });
}

function listenOnce(listenPort, listenHost) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      if (!shutdownRequested) {
        resolve();
        return;
      }
      void closeHttpServer().then(
        () => reject(startAbortedError()),
        reject,
      );
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(listenPort, listenHost);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function performStart(listenPort, listenHost) {
  // lease 必須早於任何 DB I/O；HTTP port 衝突不能當成資料庫單 writer 保證。
  const leasePaths = await acquireDataDirLease();
  try {
    const canonicalDbPath = await validateDbPathWithinDataDir(
      leasePaths.canonicalDataDir,
      leasePaths.canonicalBackupDir,
    );
    // DATA_DIR 可互為父子；因此還要對實際 canonical DB 檔案再持有一把資源鎖。
    await acquireDbPathLeases(canonicalDbPath);
    // DB（含壞檔恢復）完成後才對外 ready，避免 listener 已開但第一個請求仍在初始化。
    await loadDb();
    if (shutdownRequested) throw startAbortedError();
    await listenOnce(listenPort, listenHost);
    if (shutdownRequested) {
      await closeHttpServer();
      throw startAbortedError();
    }
    serverStartedAt = new Date().toISOString();
    lifecycleStatus = "ready";
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : listenPort;
    console.log(`Stock1 server: http://${listenHost}:${actualPort}/`);
    if (usingDefaultAdminPassword) {
      console.warn("[Stock1] ADMIN_PASSWORD is not set. Do not deploy with the default admin password.");
    }
    if (usingDefaultAppSecret) {
      console.warn("[Stock1] APP_SECRET is not set. Broker credentials use a development encryption key.");
    }
    return server;
  } catch (error) {
    await releaseDataDirLease().catch((releaseError) => {
      console.error("[Stock1] 啟動失敗後釋放 DATA_DIR lease 失敗：", releaseError);
    });
    throw error;
  }
}

// 可由測試呼叫：綁任意埠（測試用 0＝臨時埠，絕不佔用預設 5174）。預設路徑行為與原本完全相同。
function startServer(listenPort = port, listenHost = host) {
  try {
    validateStartupSecurity(listenHost);
  } catch (error) {
    return Promise.reject(error);
  }
  if (server.listening) return Promise.resolve(server);
  if (startPromise) return startPromise;
  if (lifecycleStatus === "stopping") return Promise.reject(startAbortedError());
  lifecycleStatus = "starting";
  serverStartedAt = "";
  shutdownRequested = false;
  shutdownPromise = null;
  serverCloseCleanupPromise = null;
  const operation = performStart(listenPort, listenHost)
    .catch((error) => {
      if (error?.code !== "START_ABORTED" && lifecycleStatus !== "stopping") lifecycleStatus = "failed";
      throw error;
    })
    .finally(() => {
      if (startPromise === operation) startPromise = null;
    });
  startPromise = operation;
  return operation;
}

// 測試（node --test）import 本檔時設 STOCK1_SKIP_LISTEN=1，改用 startServer(0) 綁臨時埠。
if (!process.env.STOCK1_SKIP_LISTEN) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      process.exitCode = 0;
      void shutdownServer({ reason: signal }).catch((error) => {
        console.error(`[Stock1] ${signal} 安全關機失敗：`, error);
        process.exitCode = 1;
      });
    });
  }
  void startServer().catch((error) => {
    console.error("[Stock1] 伺服器啟動失敗：", error);
    process.exitCode = 1;
  });
}

// 給單元測試用的匯出：純函式＋資料層＋伺服器控制。不影響 `node server.mjs` 的執行行為。
export {
  // 日期
  toTaipeiCompactDate, toCompactDate, compactToIsoDate, compactToSlashDate,
  compactToRocSlashDate, addMonthsCompact, addDaysCompact, compactDaysDiff, formatDate,
  // 解析／工具
  cleanCode, parseNumber, parsePercentNumber, unique, average, pct,
  // 行情正規化（quote-normalizers.test）
  normalizeDailyTwse, normalizeDailyTpex, normalizeMisQuote, normalizeFubonQuote,
  normalizeTaiexIndex, normalizeTxFuture, applyCorporateActionQuoteBaseline, normalizeTaifexMisTx, taifexContractMonthLabel,
  computeTurnoverPct, isOrdinaryStock, resolveIndustryName, normalizeWatchListsPayload,
  getReferenceData, getQuotes, fetchMisQuotes,
  // 市場摘要（market-summary.test）
  getMarketSummary, fetchTxQuote, buildStockMarketCalendarStatus, getMarketSessionStatus,
  // 隔日沖訊號引擎（overnight-engine.test）
  computeMetrics, evaluateGroups, scoreStrong, scoreDanger, scoreReversal, nextDayPerformance,
  buildOvernightSignals, buildBacktest, OVERNIGHT_CACHE_MAX_ENTRIES, BACKTEST_CACHE_MAX_ENTRIES,
  // 前向驗證（signal-verify.test）
  OVERNIGHT_FORMULA_VERSION, OVERNIGHT_SNAPSHOT_LIMIT, overnightSnapshotFormulaVersion,
  saveSignalSnapshot, nextScheduledTradingDate, previousScheduledTradingDate, isScheduledTradingDate, resolveNextTradingDate,
  getTradingCalendarEvidence, getOfficialObservationEvidence, observeSignalSnapshot,
  buildSignalVerification, buildVerificationHistory,
  // 週/月K 聚合與波段日期 helper（history-aggregate.test）
  aggregateHistoryByPeriod, getWeekKey, addPreviousClose, resolveMarketCloseDate, appendTodayCloseBar, fetchStockHistoryMonth, getStockHistory,
  // 法人／融資券（institutional-margin.test）
  normalizeTwseInstitutionalRow, normalizeTpexInstitutionalRow,
  normalizeTwseMarginRow, normalizeTpexMarginRow, getInstitutionalData, getMarginData,
  // 認證／加解密
  parseCookies, hashPassword, verifyPassword, hashToken, encryptJson, decryptJson,
  isValidUsername, LOGIN_FAIL_WINDOW_MS, LOGIN_FAILURE_MAX_ENTRIES, MAX_SESSIONS_PER_USER,
  pruneLoginFailures, isLoginBlocked, recordLoginFailure,
  resetLoginFailuresForTest, getLoginFailureSnapshotForTest,
  normalizeAlertsPayload, fetchJson,
  // 資料庫（測試掛鉤）
  loadDb, saveDb, writeFileAtomic, flushPersistence, commitDbMutation, skipDbMutation, getDbMutationEpochForTest,
  // 持股損益
  TRADE_SCHEMA_VERSION, MAX_TRADE_RECORDS, isValidCompactCalendarDate, validateTradesMutationInput,
  computeTradeFee, computeTradeTax, computeTradeTaxRule,
  normalizeTradesPayload, migrateTradesPayloadToV2, buildPortfolio, sharesHeldBeforeExDate,
  // 官方商品主檔／交易商品 provenance
  PRODUCT_DIRECTORY_RULE_VERSION, classifyOfficialEtf,
  parseTwseEtfDirectorySnapshot, parseTpexEtfCategory, parseTpexEtfDirectorySnapshot,
  getProductDirectory, resolveOfficialInstruments, canonicalizeTradeInstrumentProvenance,
  tradeMoneyEstimateFingerprint, canonicalizeTradeMoneyProvenance,
  // 處置／監視
  SURVEILLANCE_RANK, classifySurveillance, parseDispositionPeriod, parseDispositionInterval, latestUpstreamDate,
  VERIFY_ROUND_TRIP_COST_PCT, VERIFY_COST_NOTE, netReturnPct,
  findMissingCorporateActions, corporateActionErrors, TRADE_CORPORATE_ACTION_SIDE,
  WIN_RATE_MIN_SAMPLES,
  lookupStockSurveillance, survFetchRecords, getSurveillanceBoard, getRiskSets, twseNoticeRowsOrNull,
  // 技術分析數學
  emaSeries, movingAverageSeries, computeMacd, findSwingPoints, buildTrendLine,
  buildFibonacci, buildTechnicalSignals, averageTrueRange, buildTechnicalAnalysis,
  buildAdjustedPeriodRows, resolveCorporateActionAdjustments,
  parseYahooSplitFactors, normalizeYahooHistoryRows,
  // 隔日沖／波段評分
  buildPick, buildRiskTags, buildReasons, corporateActionGapRatio, officialCorporateActionRatio, plausibleShareFactor,
  backAdjustForCorporateActions, computeSwingFeatures, classifySwingScenario,
  SWING_FORMULA_VERSION, stockTickSize, roundToStockTick,
  buildSwingPlan, scoreSwing, buildSwingPick, preselectQuotes, preselectSwingQuotes,
  stockLimitUpPrice, isLimitUpLockedBar,
  scanSwingBoard, inspectSwingStock,
  // 波段前向驗證
  recordSwingVerification, swingVerificationFillModel, advanceSwingVerificationEntry, replaySwingVerificationHistory, advanceSwingVerification,
  buildSwingVerificationSummary, invalidateSwingVerifySummaryCache, pruneSwingVerification,
  // 基本面
  rocYearMonthToIso, getMonthlyRevenue, getQuarterlyEps, getValuations, getDividendSchedule,
  normalizeDividendMarketRows, DIVIDEND_RATIO_MAX_PLAUSIBLE, appendDividendHistory,
  DIVIDEND_HISTORY_MAX_EVENTS_PER_CODE,
  // replaySwingVerificationHistory 是同步的，公司行動偵測要讀已載入的歸檔；
  // 生產路徑由 advanceSwingVerification 先 await，測試也必須照同一個順序來，
  // 否則偵測器會安靜地讀到空歸檔、把「沒載入」當成「沒有事件」。
  loadFundamentalsHistory, corporateActionHistoryForCode,
  normalizeCorporateActionResultRows, loadCorporateActionResultMonth, ensureCorporateActionResults,
  corporateActionResultMonthUsable, corporateActionResultPayloadRows, corporateActionResultMonthCovered, CORPORATE_ACTION_RESULT_MAX_MONTHS,
  corporateActionResultFor, corporateActionResultRatio, CORPORATE_ACTION_RESULT_URL,
  peekDividendSchedule, getCompanyDirectory, getIssuedShares, getCompanyMeta, buildFundamentals,
  // 伺服器
  server, startServer, shutdownServer,
};
