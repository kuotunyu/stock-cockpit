// 2026-09-17：常駐後視窗一關（含當機）主控台訊息就沒了。console 同步寫到 DATA_DIR/logs/server-YYYYMMDD.log、
// 舊檔只留 14 天；沒接住的例外先寫原因、盡量正常關機、最多等 graceMs 就退出交給守門腳本。
// 這裡只測純函式與可注入的致命錯誤流程；真的包 console 只在 entry 區塊發生，測試 import 不裝。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const { mod, dataDir } = await importServer({ routes: [] });

test("formatServerLogLine：台北時間戳、等寬 level、util.format 語意（%s 與物件）", () => {
  const line = mod.formatServerLogLine("warn", ["[Stock1] %s 失敗：", "risk-cache.json", { code: "ENOSPC" }], new Date("2026-09-16T12:36:06Z"));
  assert.equal(line, "2026-09-16 20:36:06 WARN  [Stock1] risk-cache.json 失敗： { code: 'ENOSPC' }\n");
  assert.match(mod.formatServerLogLine("error", [new Error("boom")], new Date("2026-09-17T01:00:00Z")), /^2026-09-17 09:00:00 ERROR Error: boom\n/);
});

test("staleServerLogFiles：只認 server-YYYYMMDD.log、超過保留天數才刪、別的檔不碰", () => {
  const names = ["server-20260901.log", "server-20260902.log", "server-20260903.log", "server-20260917.log", "server-2026090.log", "notes.txt", "server-20260901.log.bak"];
  assert.equal(mod.SERVER_LOG_KEEP_DAYS, 14);
  assert.deepEqual(mod.staleServerLogFiles(names, "20260917"), ["server-20260901.log", "server-20260902.log"], "cutoff 09-03：09-03 本身保留");
  assert.deepEqual(mod.staleServerLogFiles(names, "20260917", 30), []);
  assert.deepEqual(mod.staleServerLogFiles([], "20260917"), []);
});

test("handleFatalError：先關機再退出；關機卡住 graceMs 後仍退出；第二次進來直接退出", async () => {
  mod.resetFatalErrorStateForTest();
  const exits = [];
  let shutdowns = 0;
  await new Promise(resolve => {
    mod.handleFatalError("unhandledRejection", new Error("boom"), {
      shutdown: async () => { shutdowns += 1; },
      exit: code => { exits.push(code); resolve(); },
      graceMs: 1000,
    });
  });
  assert.equal(shutdowns, 1, "先嘗試正常關機（釋放 lease、排空寫入）");
  assert.deepEqual(exits, [1]);

  // 關機途中又炸：不再等，直接退出
  mod.handleFatalError("uncaughtException", new Error("again"), { shutdown: async () => { shutdowns += 1; }, exit: code => exits.push(code) });
  assert.equal(shutdowns, 1, "第二次不再嘗試關機");
  assert.deepEqual(exits, [1, 1]);

  // 關機卡住：graceMs 到了照樣退出，而且只退一次。這段同時釘住「寬限計時器不能 unref」——unref 的話這裡的事件迴圈
  // 沒別的東西，程序會在沒呼叫 exit 前自然結束（Node 22 CI 實際發生：Promise resolution is still pending）。
  mod.resetFatalErrorStateForTest();
  const stuckExits = [];
  await new Promise(resolve => {
    mod.handleFatalError("uncaughtException", "not-an-error", {
      shutdown: () => new Promise(() => {}),
      exit: code => { stuckExits.push(code); resolve(); },
      graceMs: 20,
    });
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(stuckExits, [1]);
});

test("拿到 writer lease 之前不碰 DATA_DIR：先暫存，armServerLogFile 後才一起落地（保留原時間戳）", () => {
  const logDir = join(dataDir, "logs");
  mod.appendServerLog("log", ["第一行 %s", "buffered"]);
  mod.appendServerLog("warn", ["第二行"]);
  assert.equal(existsSync(logDir), false, "lease 之前連 logs/ 目錄都不能建（DATA_DIR 可能是別人的 DB 暫存路徑）");
  mod.armServerLogFile();
  const files = readdirSync(logDir).filter(name => /^server-\d{8}\.log$/.test(name));
  assert.equal(files.length, 1);
  const text = readFileSync(join(logDir, files[0]), "utf8");
  assert.match(text, /LOG   第一行 buffered\n.*WARN  第二行\n$/s);
  mod.appendServerLog("error", ["第三行直接落地"]);
  assert.match(readFileSync(join(logDir, files[0]), "utf8"), /ERROR 第三行直接落地\n$/);
});
