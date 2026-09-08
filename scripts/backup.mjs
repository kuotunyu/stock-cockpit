// 整機異地備份：停止服務後取得同一組 writer leases，驗證完整暫存包才發布。
import { mkdir, mkdtemp, readFile, readdir, rm, lstat, realpath, open, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = 30;
const SOURCES = ["stock1-db.json", "fundamentals-cache.json", "surveillance-history.json"];
const FORMAT = "stock1-machine-backup";
const PACKAGE_NAME = /^stock1-backup-\d{8}T\d{9}Z-[a-f0-9-]{36}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (path) => process.platform === "win32" ? path.toLowerCase() : path;
function within(parent, child) {
  const rel = relative(identity(parent), identity(child));
  return !rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// npm run backup 載入完整 .env；直接 node 執行維持既有 APP_SECRET 備援。
function readAppSecret() {
  if (process.env.APP_SECRET !== undefined) return String(process.env.APP_SECRET);
  const envFile = process.env.STOCK1_ENV_FILE || join(root, ".env");
  if (!existsSync(envFile)) return "";
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*APP_SECRET\s*=\s*(.*?)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

// 先解析最近存在的祖先，拒絕 junction／symlink 指進來源，再建立目的地。
async function prospectiveCanonical(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      await lstat(path);
      throw Object.assign(new Error("目的地含懸空連結"), { code: "BACKUP_TARGET_UNSAFE" });
    } catch (entryError) { if (entryError.code !== "ENOENT") throw entryError; }
    return join(await prospectiveCanonical(dirname(path)), relative(dirname(path), path));
  }
}
async function destinationRoot(target, sourceDir) {
  const project = await realpath(root);
  const check = (path) => {
    if (within(sourceDir, path) || within(project, path)) {
      throw Object.assign(new Error("備份目的地不可位於 DATA_DIR 或專案資料夾內"), { code: "BACKUP_TARGET_UNSAFE" });
    }
  };
  check(await prospectiveCanonical(resolve(target)));
  await mkdir(resolve(target), { recursive: true });
  const canonical = await realpath(resolve(target));
  check(canonical);
  return canonical;
}
async function writeDurable(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}
function parseObject(bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("備份來源必須是 JSON 物件");
  return value;
}

// 僅完整、可辨識的新包可輪替；舊分鐘包與不完整／損壞包留給使用者核對。
export async function verifyMachineBackup(directory) {
  const manifestInfo = await lstat(join(directory, "manifest.json"));
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.nlink !== 1) throw new Error("不安全的 manifest");
  const manifest = parseObject(await readFile(join(directory, "manifest.json")));
  if (manifest.format !== FORMAT || manifest.version !== 1 || manifest.consistency !== "stopped-writer"
      || !Number.isFinite(Date.parse(manifest.createdAt)) || typeof manifest.brokerCredentialsStripped !== "boolean"
      || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > SOURCES.length
      || manifest.files[0].file !== SOURCES[0]) throw new Error("無法辨識完整整機備份包");
  const seen = new Set();
  for (const item of manifest.files) {
    if (!SOURCES.includes(item.file) || seen.has(item.file) || item.format !== "json"
        || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("備份 manifest 檔案清單無效");
    seen.add(item.file);
    const info = await lstat(join(directory, item.file));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("備份檔案不是獨立一般檔案");
    const bytes = await readFile(join(directory, item.file));
    parseObject(bytes);
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error("備份雜湊或長度不符");
  }
  const names = await readdir(directory);
  if (names.length !== seen.size + 1 || names.some(name => name !== "manifest.json" && !seen.has(name))) throw new Error("備份包有未登錄檔案");
  return manifest;
}

async function rotate(destRoot, canonicalSourceDir) {
  const overlapsSource = async (directory) => {
    const canonical = await realpath(directory);
    return within(canonical, canonicalSourceDir) || within(canonicalSourceDir, canonical);
  };
  const complete = [];
  for (const entry of await readdir(destRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !PACKAGE_NAME.test(entry.name)) continue;
    try {
      const directory = join(destRoot, entry.name);
      // 使用者可能直接從已還原的成功包啟動；來源即使仍通過 manifest 驗證也不是輪替候選。
      if (await overlapsSource(directory)) continue;
      const manifest = await verifyMachineBackup(directory);
      complete.push({ name: entry.name, createdAt: manifest.createdAt });
    } catch { /* 不自動刪除不可驗證或舊格式的包。 */ }
  }
  complete.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  for (const item of complete.slice(0, Math.max(0, complete.length - KEEP))) {
    const directory = join(destRoot, item.name);
    // 刪除前再以 canonical identity 確認，不只依掃描時的名稱或路徑前綴。
    if (await overlapsSource(directory)) continue;
    await rm(directory, { recursive: true });
  }
}

async function backup(target) {
  const secret = readAppSecret().trim();
  const weakSecret = secret.length < 32 || secret === "replace-with-a-long-random-secret";
  // server 的 import 不得啟動 HTTP、排程或 loadDb；僅呼叫有界 lease-only 出口。
  process.env.STOCK1_SKIP_LISTEN = "1";
  const { acquireBackupSourceLease } = await import("../server.mjs");
  const lease = await acquireBackupSourceLease();
  let staging;
  let published;
  let manifest;
  let destRoot;
  try {
    destRoot = await destinationRoot(target, lease.canonicalDataDir);
    staging = await mkdtemp(join(destRoot, ".stock1-backup-incomplete-"));
    manifest = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), consistency: "stopped-writer",
      brokerCredentialsStripped: false, files: [] };
    for (const [index, file] of SOURCES.entries()) {
      lease.assertHealthy();
      const source = index === 0 ? lease.canonicalDbPath : join(lease.canonicalDataDir, file);
      let bytes;
      try { bytes = await readFile(source); }
      catch (error) { if (index !== 0 && error.code === "ENOENT") continue; throw error; }
      const parsed = parseObject(bytes);
      if (index === 0 && weakSecret && Object.hasOwn(parsed, "brokerCredentials")) {
        delete parsed.brokerCredentials;
        manifest.brokerCredentialsStripped = true;
        bytes = Buffer.from(JSON.stringify(parsed));
      }
      await writeDurable(join(staging, file), bytes);
      manifest.files.push({ file, format: "json", bytes: bytes.length, sha256: hash(bytes) });
    }
    await writeDurable(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await verifyMachineBackup(staging);
    lease.assertHealthy();
    const stamp = manifest.createdAt.replace(/[-:.]/g, "");
    published = join(destRoot, `stock1-backup-${stamp}-${randomUUID()}`);
    await rename(staging, published);
    staging = undefined;
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await lease.release(); }
  }
  // 發布失敗絕不走到輪替；輪替自身失敗不把已成功發布的包誤報成失敗。
  try { await rotate(destRoot, lease.canonicalDataDir); }
  catch { console.warn("[Stock1] 備份已發布，但舊包輪替失敗；請保留並人工檢查。"); }
  console.log(`[Stock1] 備份完成 → ${published}`);
  console.log(`  僅輪替已驗證的新格式成功包，保留最新 ${KEEP} 份；舊格式包不自動刪除。`);
  console.log("  還原前先停止原服務並等程序完整結束。先還原至全新隔離目錄、核對 manifest 雜湊，再啟動驗證。");
  console.log(`  本次解析 DATA_DIR=${lease.canonicalDataDir}`);
  console.log(`  本次解析 DB_PATH=${lease.canonicalDbPath}；包內 stock1-db.json 是這個現役主檔。`);
  console.log("  還原時以新 DATA_DIR／DB_PATH 對應主檔及 sidecar；驗證完成後先停驗證服務，再切換設定啟動。");
  if (weakSecret) console.log(`  APP_SECRET 未達安全強度：${manifest.brokerCredentialsStripped ? "已略過 brokerCredentials 券商憑證" : "沒有券商憑證可略過"}；還原後重新設定。`);
  else console.log("  券商憑證保留加密內容；APP_SECRET 與券商憑證檔須獨立安全保管，不在備份包內。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] || process.env.STOCK1_BACKUP_DIR;
  try {
    if (!target) throw new Error('沒有指定備份目標；用法：npm run backup "異地資料夾"');
    if (target === "--verify") {
      const directory = resolve(process.argv[3] || "");
      if (!process.argv[3]) throw new Error("缺少備份包路徑");
      if (!existsSync(join(directory, "manifest.json")) && /^stock1-backup-\d{8}-\d{4}$/.test(directory.split(sep).pop())) {
        // 舊格式沒有 checksum，不可假裝已證明跨檔一致，也不可納入自動輪替。
        for (const [index, file] of SOURCES.entries()) {
          try { parseObject(await readFile(join(directory, file))); }
          catch (error) { if (index !== 0 && error.code === "ENOENT") continue; throw error; }
        }
        console.log("[Stock1] 可辨識舊格式備份，JSON 可解析；沒有 manifest／雜湊，無法證明跨檔一致。還原前須人工確認來源，再於隔離目錄驗證。");
      } else {
        const manifest = await verifyMachineBackup(directory);
        console.log(`[Stock1] 整機備份驗證通過：${manifest.files.length} 個 JSON 與 SHA-256 一致。`);
      }
    } else await backup(target);
  } catch (error) {
    // 不把來源 JSON 片段、密鑰或私密絕對路徑輸出到錯誤紀錄。
    console.error(`[Stock1] 備份中止（${error.code || "BACKUP_INVALID"}）。請停止原服務，檢查 DATA_DIR／DB_PATH、來源 JSON 與目的地存取權限。`);
    if (!target) console.error('  用法：npm run backup "異地資料夾"（或 STOCK1_BACKUP_DIR）');
    process.exitCode = 1;
  }
}
