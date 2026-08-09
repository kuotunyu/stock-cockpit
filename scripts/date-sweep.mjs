// 日期相依測試的體檢工具：把系統時鐘平移到一組「結構上有風險的日子」，每個日子跑一次完整測試。
//
// 為什麼需要：這個專案的 fixture 幾乎都以「相對今天位移」產生，於是有一整類 bug 只在特定日子
// 現形，平常怎麼跑都是綠的，時間一到才自己轉紅——沒有任何 commit 碰過它。已經踩過兩次：
//   - 007e164：fixture 只餵「本月」的歷史，今天落在 1~20 號時 MA20 資料不足 → 整檔悄悄消失。
//   - efc12de：測試寫死 asOf "2026-07-24"，而 recordSwingVerification 收尾會 prune 掉 90 天前的
//     資料，2026-10-23 起那筆會被同一次呼叫當場刪掉 → 3 個測試永久紅。
// 兩次都是事後才發現。這支腳本讓它可以事前抓出來。
//
// 用法：
//   npm run test:dates                              掃預設的風險日（依「今天」動態產生）
//   node scripts/date-sweep.mjs 2027-01-01          只掃指定日期（可多個，用來重現回報的災情）
//   node scripts/date-sweep.mjs 2027-01-01T09:30    指定到時分（不給時間預設台北 10:00 盤中）
//
// 這支腳本刻意**不進 CI**：跑完一輪要好幾分鐘，掛在每次 push 上不划算。改完日期相關的測試、
// 或懷疑「這個結果是不是跟今天幾號有關」時手動跑。
//
// 它證明的是「這些日子當下是綠的」，不是「永遠不會紅」——掃的是結構上有風險的日子，不是全部。

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SWEEP_AT = process.env.STOCK1_DATE_SWEEP_AT;

// ===== 角色一：假時鐘（被子行程以 --import 載入時）=====
// 這個檔同時是主控與 preload，靠 STOCK1_DATE_SWEEP_AT 區分：主控行程沒有這個變數。
// 用環境變數而不是 argv 偵測，是因為 node --test 的子行程 argv 已被測試執行器改寫。

// 平移而非凍結：Date.now() 回「真實 now + offset」，時間仍會自然前進。
// 凍結會讓「應在逾時上限附近放棄」這類量測經過時間的斷言全部失去意義。
function shiftedDateClass(Base, offset) {
  return class ShiftedDate extends Base {
    constructor(...args) {
      if (args.length === 0) super(Base.now() + offset);
      else super(...args);
    }
    static now() {
      return Base.now() + offset;
    }
  };
}

async function installShiftedClock(target) {
  const RealDate = Date;
  const offset = new RealDate(target).getTime() - RealDate.now();
  if (!Number.isFinite(offset)) {
    console.error(`[date-sweep] STOCK1_DATE_SWEEP_AT 不是合法日期：${target}`);
    process.exit(1);
  }
  globalThis.Date = shiftedDateClass(RealDate, offset);

  // jsdom 是**獨立 realm**，有自己的 Date，patch globalThis.Date 到不了那裡。少了這段，
  // 前端測試會出現「測試檔用平移後的今天、app.js 用真實今天」的假失敗（實測一次掃描
  // 憑空多出 4 個假陽性）。dom-harness 用 runScripts:"dangerously" 且在注入 app.js 之前
  // 先把 stub 掛到 win 上，所以攔截 window getter、在那一刻換掉 win.Date 就會被 app.js 看到。
  //
  // 只在前端測試行程載 jsdom：node --test 是每個測試檔一個行程，若一百多個後端行程都被迫
  // 載入 jsdom，每個日期要多花約 50 秒（實測單次 import 約 470ms）。
  if (!(process.argv[1] || "").includes(`${sep}frontend${sep}`)) return;
  const { JSDOM } = await import("jsdom");
  const windowDescriptor = Object.getOwnPropertyDescriptor(JSDOM.prototype, "window");
  Object.defineProperty(JSDOM.prototype, "window", {
    ...windowDescriptor,
    get() {
      const win = windowDescriptor.get.call(this);
      // 用 window 自己的 Date 當基底，jsdom 內的 instanceof Date 才不會壞。
      if (win && !win.__dateSweepPatched) {
        win.__dateSweepPatched = true;
        win.Date = shiftedDateClass(win.Date, offset);
      }
      return win;
    },
  });
}

// ===== 角色二：掃描主控 =====

const pad = (n) => String(n).padStart(2, "0");
// 以 UTC 欄位承載「台北日曆日」，純日曆運算不受本機時區影響。
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const plusDays = (date, n) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
};
const at = (date, hhmm = "10:00") =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${hhmm}:00+08:00`;
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// 嚴格未來的下一個星期 dow（0=日）。掃「未來」而不是「過去」：過去的日子驗不到還沒發生的衰變。
function nextDow(from, dow) {
  const copy = plusDays(from, 1);
  while (copy.getUTCDay() !== dow) copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
}

function taipeiToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return day(Number(parts.year), Number(parts.month), Number(parts.day));
}

// 風險日一律**相對今天**產生。寫死清單的話，這支腳本本身就會變成它要抓的那種時間炸彈：
// 幾年後跑起來掃的全是已經過去的日子，什麼也驗不到。
function riskyDates() {
  const today = taipeiToday();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;

  // 下一個 2/29：從今年往後找最近的閏年（且該日尚未過去）。
  let leapY = y;
  const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  while (!isLeap(leapY) || day(leapY, 2, 29) <= today) leapY += 1;

  const midweek = nextDow(today, 3); // 保證是平日，用來掃時段

  return [
    // 月初：007e164 那個「今天是 1~20 號才炸」的 bug 類。
    { at: at(day(nextY, nextM, 1)), label: "下個月 1 號" },
    { at: at(day(nextY, nextM, 3)), label: "下個月 3 號" },
    { at: at(day(nextY, nextM, lastDayOfMonth(nextY, nextM))), label: "下個月最後一天" },
    // 年界＋元旦：跨年運算，且 1/1 是國定假日（測試自己 mock 的假日會與「今天是交易日」打架）。
    { at: at(day(m === 12 ? y + 1 : y, 12, 31)), label: "年末 12/31" },
    { at: at(day(y + 1, 1, 1)), label: "元旦 1/1" },
    { at: at(day(leapY, 2, 29)), label: "閏日 2/29" },
    // 週末：非交易日前提（compactTradingDay 會退回星期五）。
    { at: at(nextDow(today, 6)), label: "星期六" },
    { at: at(nextDow(today, 0)), label: "星期日" },
    // 保留期炸彈：資料只留 N 天的邏輯（prune／retention）要把時鐘推得夠遠才會現形。
    // 90 天 prune 那顆就是這樣抓到的——不推到 +100 天永遠看不到。
    { at: at(plusDays(today, 100)), label: "+100 天（保留期）" },
    { at: at(plusDays(today, 200)), label: "+200 天（保留期）" },
    { at: at(plusDays(today, 400)), label: "+400 天（保留期）" },
    // 時段：盤前／盤中／盤後／深夜。同一個平日只換時間，差異才歸因得到時段。
    { at: at(midweek, "02:00"), label: "平日 02:00 盤前" },
    { at: at(midweek, "10:00"), label: "平日 10:00 盤中" },
    { at: at(midweek, "14:30"), label: "平日 14:30 盤後" },
    { at: at(midweek, "23:50"), label: "平日 23:50 深夜" },
  ];
}

// 只吃 backend/frontend，與 npm test 同一組。tests/live 會打真實網路，絕不能掃進來。
function testFiles() {
  return ["backend", "frontend"].flatMap((folder) =>
    readdirSync(join(root, "tests", folder))
      .filter((name) => name.endsWith(".test.mjs"))
      .sort()
      .map((name) => join(root, "tests", folder, name)));
}

function runOneDate(target, files, selfUrl) {
  const nodeOptions = [process.env.NODE_OPTIONS, `--import ${selfUrl}`].filter(Boolean).join(" ");
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, STOCK1_DATE_SWEEP_AT: target, NODE_OPTIONS: nodeOptions },
  });
  if (result.error) throw result.error;
  const out = `${result.stdout || ""}`;
  return {
    ok: result.status === 0,
    fail: Number(/^# fail (\d+)$/m.exec(out)?.[1] ?? NaN),
    pass: Number(/^# pass (\d+)$/m.exec(out)?.[1] ?? NaN),
    // 頂層 not ok 才是測試本身；巢狀細節在 TAP 裡是縮排的，會被 ^ 排除。
    failing: [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim()),
    stderr: `${result.stderr || ""}`,
  };
}

function normalizeTarget(input) {
  // 沒給時間就補台北 10:00（盤中），沒給時區就補 +08:00——否則會被當成本機時區。
  const withTime = /T\d{2}:\d{2}/.test(input) ? input : `${input}T10:00`;
  const withZone = /[+-]\d{2}:?\d{2}$|Z$/.test(withTime) ? withTime : `${withTime}:00+08:00`;
  if (Number.isNaN(new Date(withZone).getTime())) {
    console.error(`[date-sweep] 無法解析日期：${input}`);
    process.exit(1);
  }
  return withZone;
}

function runSweep() {
  const args = process.argv.slice(2);
  const targets = args.length
    ? args.map((arg) => ({ at: normalizeTarget(arg), label: "指定日期" }))
    : riskyDates();
  const files = testFiles();
  // 檔案數歸零就必須停：沒有檔案參數的 `node --test` 會自動探索整個專案，
  // 把 tests/live/ 的真實網路測試一起跑掉（同 scripts/test-coverage.mjs 的守衛）。
  if (files.length === 0) {
    console.error("[date-sweep] 找不到任何測試檔，中止（避免退化成全專案自動探索）。");
    process.exit(1);
  }
  const selfUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;

  console.log(`[date-sweep] ${files.length} 個測試檔 × ${targets.length} 個日期，序列執行。`);
  // 一定要序列跑：測試會搶 DATA_DIR lease，並行會互相踢掉而產生假失敗。
  const results = [];
  for (const [index, target] of targets.entries()) {
    process.stdout.write(`[${index + 1}/${targets.length}] ${target.at}  ${target.label} … `);
    const started = Date.now();
    const result = runOneDate(target.at, files, selfUrl);
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    console.log(result.ok ? `OK (${result.pass} pass, ${seconds}s)` : `FAIL (${result.fail} fail, ${seconds}s)`);
    for (const name of result.failing) console.log(`      ✖ ${name}`);
    // 測試一個都沒跑起來（例如載入就爆）時 fail 會是 NaN，光看 not ok 清單會誤以為沒事。
    if (!result.ok && !result.failing.length) {
      console.log(`      （沒有解析到失敗測試名，可能是行程本身失敗）\n${result.stderr.trim().slice(0, 2000)}`);
    }
    results.push({ ...target, ...result });
  }

  const bad = results.filter((result) => !result.ok);
  console.log("");
  if (!bad.length) {
    console.log(`[date-sweep] ${targets.length} 個日期全部通過。`);
    return;
  }
  console.log(`[date-sweep] ${bad.length}/${targets.length} 個日期失敗：`);
  for (const result of bad) console.log(`  - ${result.at}  ${result.label}`);
  process.exit(1);
}

if (SWEEP_AT) await installShiftedClock(SWEEP_AT);
else runSweep();
