// 真 CLI 的窄 filesystem 故障／同步注入；只由 --import 測試載入，正式程式沒有環境後門。
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
const [config] = await once(process, "message");
const fail = () => { throw Object.assign(new Error("synthetic filesystem failure"), { code: "EIO" }); };
const originalRead = fs.readFile;
fs.readFile = async function(path, ...args) {
  if (String(path) === config.source) {
    if (config.mode === "read-fail") fail();
    if (config.mode === "pause-read") {
      process.send({ paused: true });
      await once(process, "message");
    }
  }
  return originalRead.call(this, path, ...args);
};
const originalOpen = fs.open;
fs.open = async function(path, ...args) {
  const file = await originalOpen.call(this, path, ...args);
  if (String(path).includes(".stock1-backup-incomplete-")) {
    if (config.mode === "write-fail") file.writeFile = async () => fail();
    if (config.mode === "sync-fail") file.sync = async () => fail();
  }
  return file;
};
const originalRename = fs.rename;
fs.rename = async function(from, ...args) {
  if (config.mode === "rename-fail" && String(from).includes(".stock1-backup-incomplete-")) fail();
  return originalRename.call(this, from, ...args);
};
syncBuiltinESMExports();
process.channel.unref();
