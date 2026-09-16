// 從 server.mjs 的 apiRoutes（路由表）產 README「端點清單」：
//   node scripts/api-routes.mjs          印到 stdout
//   node scripts/api-routes.mjs --write  直接改 README.md 的 <!-- api-routes:start --> … <!-- api-routes:end --> 區塊
// tests/backend/api-routes.test.mjs 用同一個 renderApiRoutesMarkdown 比對 README，路由表改了沒重產就紅。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const API_ROUTES_START = "<!-- api-routes:start -->";
export const API_ROUTES_END = "<!-- api-routes:end -->";
export const AUTH_LABELS = {
  open: "免登入（`REQUIRE_LOGIN=on` 也開放）",
  none: "免登入",
  optional: "免登入；登入後帶個人狀態",
  user: "需登入",
  admin: "需管理者",
};

export function renderApiRoutesMarkdown(routes) {
  const rows = [...routes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((route) => `| \`${route.methods.join("`、`")}\` | \`${route.path}\` | ${AUTH_LABELS[route.auth]} |`);
  return ["| 方法 | 路徑 | 登入 |", "|---|---|---|", ...rows].join("\n");
}

export function replaceApiRoutesBlock(readme, table) {
  const start = readme.indexOf(API_ROUTES_START);
  const end = readme.indexOf(API_ROUTES_END);
  if (start < 0 || end < 0 || end < start) throw new Error("README.md 缺少 api-routes 標記");
  return `${readme.slice(0, start + API_ROUTES_START.length)}\n${table}\n${readme.slice(end)}`;
}

async function main() {
  // 只是要讀路由表：不開埠、不排程、不查更新。
  process.env.STOCK1_SKIP_LISTEN = "1";
  process.env.SCHEDULER = "off";
  process.env.UPDATE_CHECK = "off";
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const mod = await import(pathToFileURL(resolve(root, "server.mjs")).href);
  const table = renderApiRoutesMarkdown(mod.apiRoutes);
  if (process.argv.includes("--write")) {
    const readmePath = resolve(root, "README.md");
    writeFileSync(readmePath, replaceApiRoutesBlock(readFileSync(readmePath, "utf8"), table));
    console.log(`README.md 端點清單已更新（${mod.apiRoutes.length} 條路由）`);
  } else {
    console.log(table);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
