// npm run backup [目標資料夾]：把「不可重建」的資料複製到這顆硬碟以外的地方。
//
// 為什麼需要：`.data/backups/` 的 14 份日備份**跟主檔在同一個資料夾、同一顆硬碟**。
// 它防的是「檔案寫壞」，完全不防「硬碟掛掉／資料夾被誤刪／同步衝突」。
// 而這個 App 裡最不能重來的東西恰好不是交易帳本（那還有券商對帳單可以對），是：
//   • swingVerification：前向驗證紀錄。它記的是「當時看得到什麼」，**本質上不能重算**。
//   • fundamentals-cache：月營收／EPS 的歷史累積——官方 API 只回最新一期，
//     過去的期數是這個 App 一天一天存下來的，刪掉就真的沒有了。
//   • surveillance-history：處置看板的每日快照，「新進／連 N 天」都靠它。
// 所以這支的目標是異地，不是又一份同地備份。
//
// 用法：
//   npm run backup "D:\\OneDrive\\stock1-backup"     指定目標（第一次用這個）
//   npm run backup                                    之後可改設環境變數 STOCK1_BACKUP_DIR
//
// 要自動化就交給 Windows 工作排程器：程式填 npm、引數填 run backup、起始位置填專案資料夾。
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || join(root, ".data");
const KEEP = 30;

// 只帶不可重建的。risk-cache.json 是純 last-good 快取（重抓就有），backups/ 是同地備援
// （異地備份的情境是「本機整個沒了」，那時一份完整主檔就夠），兩者都刻意不帶。
const SOURCES = [
  { file: "stock1-db.json", label: "主資料庫（交易帳本、前向驗證、自選股、備註、帳號）", required: true },
  { file: "fundamentals-cache.json", label: "月營收／EPS 歷史累積（官方只回最新一期）", required: false },
  { file: "surveillance-history.json", label: "處置看板每日快照（新進／連 N 天靠它）", required: false },
];

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function usage(message) {
  console.error("");
  console.error(`[Stock1] ${message}`);
  console.error("");
  console.error("  用法：npm run backup \"D:\\\\OneDrive\\\\stock1-backup\"");
  console.error("        （或設環境變數 STOCK1_BACKUP_DIR 之後直接 npm run backup）");
  console.error("");
  console.error("  請選一個**不在這顆硬碟上**的位置：雲端同步資料夾、外接硬碟、NAS。");
  console.error("  放在專案裡或同一顆硬碟等於沒有備份——那正是 .data/backups/ 已經在做的事。");
  console.error("");
  process.exitCode = 1;
}

const target = process.argv[2] || process.env.STOCK1_BACKUP_DIR || "";
if (!target) {
  usage("沒有指定備份目標資料夾。");
} else if (resolve(target).toLowerCase().startsWith(resolve(root).toLowerCase())) {
  // 備份到專案自己裡面是最常見的誤用，而且完全達不到目的——直接擋下來。
  usage(`目標 ${resolve(target)} 在專案資料夾內，這樣沒有異地效果。`);
} else if (!existsSync(dataDir)) {
  usage(`找不到資料目錄 ${dataDir}——這台機器還沒跑過這個 App 嗎？`);
} else {
  const destRoot = resolve(target);
  const destination = join(destRoot, `stock1-backup-${stamp()}`);
  // 時間戳只到分鐘，所以同一分鐘內重跑會落在同一個資料夾。這本身沒問題（等同覆蓋），
  // 但**失敗時的清理不可以把別人的成果刪掉**：若這個資料夾在本次執行前就存在，
  // 裡面可能是一分鐘前那次成功的備份，中止時只能原封不動退出。
  const destinationPreexisted = existsSync(destination);
  await mkdir(destination, { recursive: true });

  const copied = [];
  let failed = false;
  for (const source of SOURCES) {
    const from = join(dataDir, source.file);
    if (!existsSync(from)) {
      if (source.required) {
        console.error(`[Stock1] 找不到 ${source.file}，備份中止（這是主資料庫）。`);
        failed = true;
        break;
      }
      console.log(`  略過 ${source.file}（這台還沒產生這個檔，正常）`);
      continue;
    }
    const to = join(destination, source.file);
    await copyFile(from, to);
    // 複製完一定要重讀＋解析一次：**parse 不了的備份不是備份**。
    // 這也順便擋住「主檔已經壞掉了，卻把壞檔複製過去蓋掉好備份」這個更糟的情況。
    try {
      JSON.parse(await readFile(to, "utf8"));
    } catch (error) {
      console.error(`[Stock1] ${source.file} 複製後無法解析（${error.message}）——來源可能已損壞，備份中止。`);
      failed = true;
      break;
    }
    const { size } = await stat(to);
    copied.push({ file: source.file, label: source.label, size });
  }

  if (failed) {
    if (destinationPreexisted) {
      console.error(`[Stock1] ${destination} 在這次執行前就存在，保留不動（裡面可能是先前成功的備份）。`);
    } else {
      await rm(destination, { recursive: true, force: true });
    }
    process.exitCode = 1;
  } else {
    // 輪替：只留最新的 KEEP 份，免得雲端資料夾無限長大。
    const entries = (await readdir(destRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^stock1-backup-\d{8}-\d{4}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    while (entries.length > KEEP) {
      await rm(join(destRoot, entries.shift()), { recursive: true, force: true }).catch(() => {});
    }

    console.log("");
    console.log(`[Stock1] 備份完成 → ${destination}`);
    for (const item of copied) {
      console.log(`  ${item.file.padEnd(28)} ${String(Math.round(item.size / 1024)).padStart(6)} KB  ${item.label}`);
    }
    console.log("");
    console.log(`  保留最新 ${KEEP} 份，目前 ${Math.min(entries.length, KEEP)} 份。`);
    console.log("  要還原：把這些檔案複製回 .data/ 蓋掉原檔，然後重啟伺服器。");
    console.log("");
    console.log("  ⚠ 主資料庫裡有密碼 hash 與加密後的券商憑證（解密金鑰 APP_SECRET 不在備份裡）。");
    console.log("    放到雲端同步資料夾前請自行斟酌。");
    console.log("");
  }
}
