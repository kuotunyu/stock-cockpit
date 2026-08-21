// npm run start:lan：綁到區域網路，讓同一個 Wi-Fi 底下的手機／平板連得進來看盤。
//
// 為什麼需要一支 script 而不是直接寫 `HOST=0.0.0.0 node server.mjs`：
// 那個「環境變數前綴」寫法是 POSIX shell 的語法，在 PowerShell 與 cmd 都不成立，
// 而這個專案的使用者是在 Windows 上手動操作的。
//
// 綁到非 loopback 位址時，server.mjs 的 validateStartupSecurity 會強制要求
// ADMIN_PASSWORD ≥ 12 字元、APP_SECRET ≥ 32 字元（沒設就拒絕啟動）。那是對的：
// 對外開放的看盤 App 不該還留著預設密碼。這裡在啟動前先把話講清楚，
// 免得只看到一行「安全設定不足」不知道要幹嘛。
import { networkInterfaces } from "node:os";

process.env.HOST ||= "0.0.0.0";

const problems = [];
if (String(process.env.ADMIN_PASSWORD || "").length < 12) problems.push("ADMIN_PASSWORD（至少 12 字元）");
if (String(process.env.APP_SECRET || process.env.ENCRYPTION_KEY || "").length < 32) problems.push("APP_SECRET（至少 32 字元）");

if (problems.length) {
  console.error("");
  console.error("[Stock1] 對外開放前必須先設定：" + problems.join("、"));
  console.error("");
  console.error("  1. 產生一組隨機字串：npm run secret");
  console.error("  2. 把它寫進專案根目錄的 .env（可從 .env.example 複製一份）");
  console.error("  3. 再跑一次 npm run start:lan");
  console.error("");
  console.error("（只在自己這台電腦上看，不需要這些設定——直接 npm start 就好。）");
  console.error("");
  process.exitCode = 1;
} else {
  const port = Number(process.env.PORT || 5174);
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  console.log("");
  console.log("[Stock1] 手機／平板請在同一個 Wi-Fi 下開啟：");
  for (const address of addresses) console.log(`         http://${address}:${port}`);
  if (!addresses.length) console.log("         （找不到區域網路位址，請確認這台電腦已連上網路）");
  console.log("");
  console.log("         連不上多半是 Windows 防火牆擋掉了——第一次啟動時跳出的提示要選「允許存取」。");
  console.log("         PWA「加到主畫面」需要 HTTPS，純 http 的區域網路位址只能用瀏覽器開。");
  console.log("");
  await import("../server.mjs");
}
