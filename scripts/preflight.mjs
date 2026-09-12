// npm run preflight：對外部署（Zeabur／Docker／反向代理）前的環境檢查。
//
// server.mjs 的 validateStartupSecurity 只擋「會直接出事」的組合（弱密碼、無效 PUBLIC_ORIGIN）；
// 這裡把整份對外部署的期望列成清單：哪些是「不改就別上線」（✖，exit 1）、哪些是「上線也行但要知道」（⚠）。
// 純函式 preflightChecks(env) 給測試用，不讀檔、不打網路；CLI 只負責印出來。
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const EXAMPLE_SECRETS = new Set(["replace-with-a-strong-password", "replace-with-a-long-random-secret"]);
const ON = /^(1|on|true|yes)$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.origin === "null") return null;
    return url;
  } catch {
    return null;
  }
}

export function preflightChecks(env = process.env, { probeDataDir = true } = {}) {
  const problems = [];
  const warnings = [];
  const notes = [];
  const get = (key) => String(env[key] ?? "").trim();

  if (get("NODE_ENV") !== "production") problems.push("NODE_ENV 必須是 production（對外部署才會套用 production 的安全檢查與預設）");

  const origin = parseOrigin(get("PUBLIC_ORIGIN"));
  if (!origin) problems.push("PUBLIC_ORIGIN 必須是完整網址（例如 https://stock1.zeabur.app）；伺服器靠它認 Host 與 cookie 範圍");
  else if (origin.protocol !== "https:") problems.push("PUBLIC_ORIGIN 必須是 https：對外走純 http 等於把密碼與 cookie 攤在路上");

  if (origin?.protocol === "https:" && !ON.test(get("COOKIE_SECURE"))) problems.push("COOKIE_SECURE 必須是 true：HTTPS 站台的登入 cookie 不可少 Secure 旗標");

  if (!ON.test(get("REQUIRE_LOGIN"))) problems.push("REQUIRE_LOGIN 必須是 on：公網上免登入的唯讀端點會把訊號攤給所有人、讓任何人替你打上游");

  const adminPassword = get("ADMIN_PASSWORD");
  if (adminPassword.length < 12 || EXAMPLE_SECRETS.has(adminPassword)) problems.push("ADMIN_PASSWORD 至少 12 字元且不可沿用範例值（首次登入後請在 App 內再改一次）");
  const appSecret = get("APP_SECRET") || get("ENCRYPTION_KEY");
  if (appSecret.length < 32 || EXAMPLE_SECRETS.has(appSecret)) problems.push("APP_SECRET 至少 32 字元且不可沿用範例值（npm run secret 產生；換掉會讓已加密的券商憑證讀不回來）");

  const trustProxy = get("TRUST_PROXY").toLowerCase();
  if (!["on", "cloudflare"].includes(trustProxy)) {
    warnings.push("TRUST_PROXY 是 off：放在平台或 Cloudflare 的反向代理後面時，登入限流會把所有人算成同一個來源（代理 IP），建議 on（Cloudflare 前置時用 cloudflare）");
  } else if (trustProxy === "on" && !/^[1-9]\d*$/.test(get("TRUST_PROXY_HOPS") || "1")) {
    problems.push("TRUST_PROXY_HOPS 必須是正整數（只有一層代理就是 1）");
  }

  const dataDir = get("DATA_DIR");
  if (!dataDir) problems.push("DATA_DIR 必須明確指定到掛載的持久磁碟（例如 /data）；沒設會寫進映像裡的 .data，重新部署就消失");
  else if (!isAbsolute(dataDir)) warnings.push(`DATA_DIR=${dataDir} 是相對路徑：容器裡請用掛載 volume 的絕對路徑（例如 /data），否則重新部署會遺失資料`);
  else if (probeDataDir) {
    if (!existsSync(dataDir)) problems.push(`DATA_DIR=${dataDir} 不存在：請先在平台掛載 volume 到這個路徑`);
    else if (!statSync(dataDir).isDirectory()) problems.push(`DATA_DIR=${dataDir} 不是目錄`);
    else {
      try { accessSync(dataDir, constants.W_OK); } catch { problems.push(`DATA_DIR=${dataDir} 不可寫：容器以 node 使用者執行，volume 要能讓它寫入`); }
    }
  }

  const host = get("HOST");
  if (host && host !== "0.0.0.0" && host !== "::") warnings.push(`HOST=${host}：容器裡要綁 0.0.0.0（或不設）平台才連得進來`);

  const sessionMaxAge = Number(get("SESSION_MAX_AGE_MS") || 14 * DAY_MS);
  if (!Number.isFinite(sessionMaxAge) || sessionMaxAge <= 0) problems.push("SESSION_MAX_AGE_MS 必須是正整數毫秒");
  else if (sessionMaxAge > 14 * DAY_MS) warnings.push("SESSION_MAX_AGE_MS 超過 14 天：對外站台的登入有效期建議不要比預設更長");

  if (!ON.test(get("SCHEDULER") || "on")) warnings.push("SCHEDULER 是 off：伺服器一直開著卻不排程，等於每天要有人開 App 才會有快照與驗證");
  if (ON.test(get("UPDATE_CHECK") || "on")) notes.push("UPDATE_CHECK 是 on：映像裡沒有 .git，版本比對只會顯示 unavailable；可設 off 省一次對 GitHub 的查詢");
  notes.push("只能跑單一副本：資料是單一 JSON 檔＋程序內排程，兩個副本同時寫會互相覆蓋（同機第二個程序會被 writer lease 擋下，跨機器不會）");
  notes.push("資料備援：定期用「更多 → 個人資料備份」把資料抓回本機；平台 volume 不是異地備份");

  return { ok: problems.length === 0, problems, warnings, notes, summary: { origin: origin?.origin || "", requireLogin: ON.test(get("REQUIRE_LOGIN")), dataDir } };
}

function isMainModule() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
}

if (isMainModule()) {
  const result = preflightChecks(process.env);
  console.log("[Stock1] 對外部署前檢查");
  for (const line of result.problems) console.log(`  ✖ ${line}`);
  for (const line of result.warnings) console.log(`  ⚠ ${line}`);
  for (const line of result.notes) console.log(`  ・ ${line}`);
  console.log(result.ok
    ? `  ✔ 必要設定齊全：${result.summary.origin}（REQUIRE_LOGIN=on，DATA_DIR=${result.summary.dataDir}）`
    : `  共 ${result.problems.length} 項必須修正後再上線。`);
  process.exitCode = result.ok ? 0 : 1;
}
