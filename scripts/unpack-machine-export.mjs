// node scripts/unpack-machine-export.mjs <匯出檔.json> <目的資料夾>
//
// 把「更多 → 帳號管理 → 下載整機匯出」拿到的 JSON 拆回三個資料檔（stock1-db.json、fundamentals-cache.json、
// surveillance-history.json）＋ manifest.json，逐檔核對長度與 sha256。拆完之後照 README 第 4 節的還原流程：
// 停止服務 → 建全新 DATA_DIR → 複製檔案 → 用測試埠驗證 → 再切正式。這裡不會碰任何正在運作的 DATA_DIR。
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORMAT = "stock1-machine-export";
const ALLOWED_FILES = ["stock1-db.json", "fundamentals-cache.json", "surveillance-history.json"];

export function verifyMachineExportBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) throw new Error("匯出內容不是 JSON 物件");
  if (bundle.format !== FORMAT || bundle.version !== 1) throw new Error("無法辨識的整機匯出格式");
  if (!Number.isFinite(Date.parse(bundle.createdAt))) throw new Error("匯出時間無效");
  if (!Array.isArray(bundle.files) || !bundle.files.length || bundle.files[0]?.file !== ALLOWED_FILES[0]) throw new Error("匯出缺少 stock1-db.json");
  const seen = new Set();
  const files = bundle.files.map((item) => {
    if (!ALLOWED_FILES.includes(item?.file) || seen.has(item.file) || item.format !== "json") throw new Error(`匯出檔案清單無效：${item?.file}`);
    seen.add(item.file);
    if (!item.content || typeof item.content !== "object" || Array.isArray(item.content)) throw new Error(`${item.file} 不是 JSON 物件`);
    // 伺服器是對「磁碟上的原始 bytes」算 hash；這裡重新序列化（compact）後再算，只在伺服器也是 compact 或
    // 沒有被改動時才會相等——所以先比 compact，再比 pretty（saveDb 寫的是兩空白縮排＋換行）。
    const candidates = [JSON.stringify(item.content), `${JSON.stringify(item.content, null, 2)}\n`];
    const bytes = candidates.map((text) => Buffer.from(text, "utf8")).find((buffer) => buffer.length === item.bytes && createHash("sha256").update(buffer).digest("hex") === item.sha256);
    if (!bytes) throw new Error(`${item.file} 的長度或 sha256 與內容不符（檔案可能被改過或截斷）`);
    return { file: item.file, bytes, sha256: item.sha256 };
  });
  return files;
}

export async function unpackMachineExport(bundle, targetDir) {
  const files = verifyMachineExportBundle(bundle);
  const dir = resolve(targetDir);
  await mkdir(dir, { recursive: true });
  const existing = await readdir(dir);
  if (existing.length) throw new Error(`目的資料夾必須是空的：${dir}`);
  for (const item of files) await writeFile(join(dir, item.file), item.bytes, { flag: "wx" });
  const manifest = {
    format: FORMAT, version: 1, createdAt: bundle.createdAt, consistency: bundle.consistency || "live-committed",
    pendingWrites: bundle.pendingWrites ?? null, brokerCredentialsStripped: Boolean(bundle.brokerCredentialsStripped),
    files: files.map((item) => ({ file: item.file, format: "json", bytes: item.bytes.length, sha256: item.sha256 })),
  };
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

function isMainModule() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
}

if (isMainModule()) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    console.error("用法：node scripts/unpack-machine-export.mjs <匯出檔.json> <目的資料夾>");
    process.exitCode = 2;
  } else {
    try {
      const raw = JSON.parse(await readFile(resolve(source), "utf8"));
      const bundle = raw?.bundle && raw?.ok !== undefined ? raw.bundle : raw;
      const manifest = await unpackMachineExport(bundle, target);
      console.log(`[Stock1] 已拆出 ${manifest.files.length} 個檔到 ${resolve(target)}（匯出時間 ${manifest.createdAt}，未落盤寫入 ${manifest.pendingWrites ?? "未知"} 筆${manifest.brokerCredentialsStripped ? "，券商憑證已剝除" : ""}）`);
      console.log("       接著照 README 第 4 節：停止服務 → 建全新 DATA_DIR → 複製檔案 → 測試埠驗證 → 再切正式。");
    } catch (error) {
      console.error(`[Stock1] 拆檔失敗：${error.message}`);
      process.exitCode = 1;
    }
  }
}
