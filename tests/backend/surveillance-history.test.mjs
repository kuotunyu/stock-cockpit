// 歷史快照 diff：今日新進／出關、注意升溫、連續天數、快照持久化。
// 獨立行程（node --test 每檔一行程）：先預埋兩天份快照檔，再 import server.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday, surveillanceRoutes,
  twsePunishRow, twseNoticeRow, stockDayAllRow, twt85uRow,
} from "../helpers/fixtures.mjs";

const shiftDay = (compact, offset) => {
  const date = new Date(Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))));
  date.setUTCDate(date.getUTCDate() + offset);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
};
const scheduledWeekday = (compact, direction, include = false) => {
  let day = compact;
  for (let step = include ? 0 : 1; step < 10; step += 1) {
    if (step) day = shiftDay(day, direction);
    const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) return day;
  }
  return day;
};
const REAL_TODAY = compactToday(0);
const BASE = scheduledWeekday(REAL_TODAY, 1, true);
const PREV1 = scheduledWeekday(BASE, -1);
const PREV2 = scheduledWeekday(PREV1, -1);
const NEXT = scheduledWeekday(BASE, 1);
const dayDiff = (from, to) => Math.round((Date.UTC(Number(to.slice(0, 4)), Number(to.slice(4, 6)) - 1, Number(to.slice(6, 8))) - Date.UTC(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)))) / 86400000);
const BASE_OFFSET = dayDiff(REAL_TODAY, BASE);
const NEXT_OFFSET = dayDiff(REAL_TODAY, NEXT);

// 先準備 DATA_DIR 與相鄰交易日快照檔，再 import（dataDir 於 import 時定案）
const dataDir = await mkdtemp(join(tmpdir(), "stock1-hist-"));
const historyPath = join(dataDir, "surveillance-history.json");
await writeFile(historyPath, JSON.stringify({
  [PREV2]: { disposition: ["9999"], attention: { 8888: 1 }, changed: ["7777"], block: [] },
  [PREV1]: { disposition: ["9999", "5555"], attention: { 8888: 2, 2233: 1 }, changed: ["7777"], block: [] },
}), "utf8");

const o = {};
const { mod } = await importServer({ routes: surveillanceRoutes(o), dataDir });
const { getSurveillanceBoard } = mod;

o.reference = [stockDayAllRow({ code: "5555", name: "五五", close: 55 })];

test("歷史 diff：isNew／enteredToday／releasedToday／daysOnList／nearDisposition", async () => {
  const base = BASE;
  o.twsePunish = [
    twsePunishRow({ code: "5555", startOff: BASE_OFFSET - 3, endOff: BASE_OFFSET + 5 }),
    twsePunishRow({ code: "4444", startOff: BASE_OFFSET - 1, endOff: BASE_OFFSET + 6 }),
  ];
  o.twseNotice = [
    twseNoticeRow({ code: "8888", count: 3 }), // 連 3 天、次數 3（count≥3 → 升溫）
    twseNoticeRow({ code: "2233", count: 2 }), // 連 2 天且次數上升（rising 路徑 → 升溫）
    twseNoticeRow({ code: "3333", count: 1 }), // 今天才出現 → 新、不升溫
  ];
  o.twt85u = [
    twt85uRow({ code: "7777" }),               // 昨天就在全額 → 不是新
    twt85uRow({ code: "6666" }),               // 今天新進全額
  ];
  const board = await getSurveillanceBoard(base);

  assert.equal(board.hasHistory, true);
  assert.equal(board.comparisonAsOf.replaceAll("-", ""), PREV1);
  assert.equal(board.comparisonIsPreviousTradingDay, true);
  // 處置 diff：prev={9999,5555}、今={5555,4444}
  assert.equal(board.enteredToday, 1, "只有 4444 新進");
  assert.equal(board.releasedToday, 1, "9999 出關");
  const disp = new Map(board.inDisposition.map((i) => [i.code, i]));
  assert.equal(disp.get("4444").isNew, true);
  assert.equal(disp.get("5555").isNew, false);

  // 注意股 trend
  const attn = new Map(board.attention.map((i) => [i.code, i]));
  assert.equal(attn.get("8888").isNew, false);
  assert.equal(attn.get("8888").daysOnList, 3, "前天+昨天+今天連續 3 天");
  assert.equal(attn.get("8888").nearDisposition, true, "count≥3");
  assert.equal(attn.get("2233").daysOnList, 2);
  assert.equal(attn.get("2233").nearDisposition, true, "次數上升且連 2 天");
  assert.equal(attn.get("3333").isNew, true);
  assert.equal(attn.get("3333").daysOnList, 1);
  assert.equal(attn.get("3333").nearDisposition, false);

  // 全額交割 isNew
  const chg = new Map(board.changedTrading.map((i) => [i.code, i]));
  assert.equal(chg.get("6666").isNew, true);
  assert.equal(chg.get("7777").isNew, false);

  const snapshot = JSON.parse(await readFile(historyPath, "utf8"));
  assert.deepEqual([...snapshot[base].disposition].sort(), ["4444", "5555"]);
  assert.deepEqual(snapshot[base].attention, { 8888: 3, 2233: 2, 3333: 1 });
  assert.deepEqual([...snapshot[base].changed].sort(), ["6666", "7777"]);
});

test("次日演進：以今日快照為 prev（4444 退出 → releasedToday）", async () => {
  const base = NEXT;
  o.twsePunish = [
    twsePunishRow({ code: "5555", startOff: NEXT_OFFSET - 3, endOff: NEXT_OFFSET + 5 }),
  ];
  // 注意股維持相同，避免額外 churn
  const board = await getSurveillanceBoard(base);
  assert.equal(board.hasHistory, true);
  assert.equal(board.enteredToday, 0);
  assert.equal(board.releasedToday, 1, "4444 不在了 → 出關 1 檔");
  assert.equal(board.inDisposition.find((i) => i.code === "5555").isNew, false);
});
