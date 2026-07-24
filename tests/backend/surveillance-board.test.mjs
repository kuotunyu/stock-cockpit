// getSurveillanceBoard 離線端對端：mock 全部 10 個上游、直接呼叫資料層（不經 HTTP）。
// 日期策略：每個測試用「遞減」的基準日（realToday、-1、-2…），因此
// (a) 快取（以日期為 key）不會撞、(b) 先前測試寫入的歷史快照日期較大、不會被當成「過去」。
// fixtures 的位移一律以「該測試的基準日」為準（offset + K）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { importServer, pollUntil } from "../helpers/test-server.mjs";
import {
  compactToday, surveillanceRoutes,
  twsePunishRow, tpexDisposalRow, twseNoticeRow, tpexWarningRow,
  bfiauuRow, tpexBlockRow, twt85uRow, tpexCmodeRow,
  stockDayAllRow, tpexDailyCloseRow,
} from "../helpers/fixtures.mjs";

const o = {}; // 可變 overrides：每個測試改欄位再呼叫
const { mod, mock, dataDir } = await importServer({ routes: surveillanceRoutes(o) });
const { getSurveillanceBoard, survFetchRecords } = mod;

// 整檔共用 reference（referenceCache 5 分鐘 TTL，一次載入）
o.reference = [
  stockDayAllRow({ code: "1101", name: "台泥", close: 40 }),
  stockDayAllRow({ code: "2330", name: "台積電", close: 1085 }),
];
o.tpexReference = [
  tpexDailyCloseRow({ code: "6127", name: "九豪", close: 93.6 }),
  tpexDailyCloseRow({ code: "5425", name: "台半", close: 127 }),
];

function resetSources() {
  for (const key of ["twsePunish", "tpexDisposal", "twseNotice", "tpexWarning", "bfiauu", "tpexBlock", "twt85u", "tpexCmode"]) {
    o[key] = [];
  }
}

test("分類邊界：即將處置／處置中／即將結束（今日或下一交易日為迄日）", async () => {
  const K = 0;
  const base = compactToday(K);
  // 「下一交易日」的日曆位移依基準日星期而異（週五→+3、週六→+2、其餘→+1）。
  // fixture 迄日必須跟著算，否則本測試只在平日成立（週五實跑時 K+3 正好是下週一＝下一交易日，會被正確歸入即將出關）。
  const baseDate = new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(4, 6)) - 1, Number(base.slice(6, 8))));
  const nto = baseDate.getUTCDay() === 5 ? 3 : baseDate.getUTCDay() === 6 ? 2 : 1;
  resetSources();
  o.twsePunish = [
    twsePunishRow({ code: "1101", startOff: K + 2, endOff: K + 12 }),        // 未來開始 → 即將處置
    twsePunishRow({ code: "2330", startOff: K - 3, endOff: K + nto + 2 }),   // 期間內、迄日晚於下一交易日 → 處置中但非即將出關
  ];
  o.tpexDisposal = [
    tpexDisposalRow({ code: "6127", startOff: K - 10, endOff: K }),          // 今天結束 → 即將出關
    tpexDisposalRow({ code: "5425", startOff: K - 10, endOff: K + nto }),    // 下一交易日結束 → 即將出關
  ];
  const board = await getSurveillanceBoard(base);
  assert.equal(board.ok, true);
  assert.deepEqual(board.aboutToDispose.map((i) => i.code), ["1101"]);
  assert.equal(board.aboutToDispose[0].daysToStart, 2);
  const inCodes = board.inDisposition.map((i) => i.code);
  assert.ok(inCodes.includes("2330") && inCodes.includes("6127") && inCodes.includes("5425"));
  assert.ok(!inCodes.includes("1101"), "未來開始的不該在處置中");
  const releaseCodes = board.aboutToRelease.map((i) => i.code).sort();
  assert.deepEqual(releaseCodes, ["5425", "6127"]); // 迄日＝今日／下一交易日 in、更晚 out
  assert.equal(board.counts.aboutToDispose, 1);
  assert.equal(board.counts.inDisposition, 3);
  assert.equal(board.counts.aboutToRelease, 2);
  // enrich：reference 有 → 帶名稱與價格
  const t2330 = board.inDisposition.find((i) => i.code === "2330");
  assert.equal(t2330.name, "台積電");
  assert.equal(t2330.price, 1085);
  // 分盤間隔解析（TWSE 五分鐘→5、TPEx 二十分鐘→20）
  assert.equal(t2330.interval, 5);
  assert.equal(board.inDisposition.find((i) => i.code === "6127").interval, 20);
  // 首跑（本行程無歷史）→ hasHistory false、全部 isNew false
  assert.equal(board.hasHistory, false);
  assert.ok(board.inDisposition.every((i) => i.isNew === false));
});

test("週五看下週一迄日：日曆差 3 天仍屬下一交易日即將結束", async () => {
  const today = compactToday(0);
  const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 1, Number(today.slice(6, 8))));
  const fridayOffset = (5 - date.getUTCDay() + 7) % 7 || 7;
  const base = compactToday(fridayOffset);
  resetSources();
  o.twsePunish = [twsePunishRow({ code: "2330", startOff: fridayOffset - 2, endOff: fridayOffset + 3 })];
  const board = await getSurveillanceBoard(base);
  const item = board.aboutToRelease.find((row) => row.code === "2330");
  assert.ok(item, "下週一是下一交易日，不能因日曆差 3 天漏掉");
  assert.equal(item.daysToRelease, 3);
  assert.equal(item.releaseOnNextTradingDay, true);
});

test("同代號雙市場：取迄日較晚者；不在 reference → name=code fallback", async () => {
  const K = -1;
  const base = compactToday(K);
  resetSources();
  o.twsePunish = [twsePunishRow({ code: "7777", startOff: K - 5, endOff: K + 2 })];
  o.tpexDisposal = [tpexDisposalRow({ code: "7777", startOff: K - 5, endOff: K + 6 })]; // 較晚 → 勝
  const board = await getSurveillanceBoard(base);
  const item = board.inDisposition.find((i) => i.code === "7777");
  assert.ok(item, "7777 應在處置中");
  assert.equal(item.daysToRelease, 6, "應取迄日較晚的那筆");
  assert.equal(item.name, "7777", "不在 reference → 名稱退回代號");
  assert.ok(item.price == null, "不在 reference → 無價格（undefined/null 皆可）");
});

test("注意股：同代號 TWSE 優先（含累計次數）、依 count 排序", async () => {
  const K = -2;
  const base = compactToday(K);
  resetSources();
  o.twseNotice = [
    twseNoticeRow({ code: "2330", count: 4 }),
    twseNoticeRow({ code: "1101", count: 1 }),
  ];
  o.tpexWarning = [
    tpexWarningRow({ code: "2330" }), // 同代號 → TWSE 的 count 4 優先
    tpexWarningRow({ code: "6127" }),
  ];
  const board = await getSurveillanceBoard(base);
  assert.equal(board.attention.length, 3);
  assert.equal(board.attention[0].code, "2330"); // count 4 排最前
  assert.equal(board.attention[0].count, 4);
  const t6127 = board.attention.find((i) => i.code === "6127");
  assert.equal(t6127.count, 1);
  assert.equal(t6127.name, "九豪"); // TPEx reference enrich
});

test("鉅額交易：同代號跨來源聚合、TPEx 只收當日、valueYi 兩位小數", async () => {
  const K = -3;
  const base = compactToday(K);
  resetSources();
  o.bfiauu = [
    bfiauuRow({ code: "2330", value: 1_000_000_000 }),
    bfiauuRow({ code: "2330", value: 500_000_000 }),
  ];
  o.tpexBlock = [
    tpexBlockRow({ code: "2330", value: 230_000_000, dateOff: K }),     // 當日 → 收
    tpexBlockRow({ code: "6127", value: 80_000_000, dateOff: K - 1 }),  // 昨日 → 排除
  ];
  const board = await getSurveillanceBoard(base);
  assert.equal(board.blockTrades.length, 1, "昨日的 TPEx 筆應被排除");
  const item = board.blockTrades[0];
  assert.equal(item.code, "2330");
  assert.equal(item.count, 3);
  assert.equal(item.value, 1_730_000_000);
  assert.equal(item.valueYi, 17.3);
});

test("全額交割：TWT85U 的 * → 兼分盤；tpex_cmode 全形Ｙ＋僅當日", async () => {
  const K = -4;
  const base = compactToday(K);
  resetSources();
  o.twt85u = [
    twt85uRow({ code: "1101", periodic: true }),
    twt85uRow({ code: "2330", periodic: false }),
  ];
  o.tpexCmode = [
    tpexCmodeRow({ code: "6127", altered: "Ｙ", periodic: "Ｙ", dateOff: K }), // 變更交易＋分盤
    tpexCmodeRow({ code: "5425", altered: "", dateOff: K }),                   // 非變更交易 → 排除
    tpexCmodeRow({ code: "3999", altered: "Ｙ", dateOff: K - 1 }),             // 非當日 → 排除
  ];
  const board = await getSurveillanceBoard(base);
  const codes = board.changedTrading.map((i) => i.code).sort();
  assert.deepEqual(codes, ["1101", "2330", "6127"]);
  assert.equal(board.changedTrading.find((i) => i.code === "1101").periodic, true);
  assert.equal(board.changedTrading.find((i) => i.code === "2330").periodic, false);
  assert.equal(board.changedTrading.find((i) => i.code === "6127").periodic, true);
  assert.equal(board.counts.changedTrading, 3);
});

test("單源失敗：看板仍 ok，warnings 含「抓取失敗：」，其他類別照常", async () => {
  const K = -5;
  const base = compactToday(K);
  resetSources();
  o.twseNotice = [twseNoticeRow({ code: "2330", count: 2 })];
  const undo = mock.override({
    match: /openapi\.twse\.com\.tw\/v1\/announcement\/punish/,
    reply: { __error: "simulated 403" },
  });
  try {
    const board = await getSurveillanceBoard(base);
    assert.equal(board.ok, true);
    assert.ok(board.warnings.some((w) => w.includes("TWSE 處置") && w.includes("抓取失敗：")), `warnings=${JSON.stringify(board.warnings)}`);
    assert.ok(board.warnings.some((w) => w.includes("不更新每日歷史")), `warnings=${JSON.stringify(board.warnings)}`);
    assert.equal(board.hasHistory, false, "來源硬失敗時不可拿舊快照計算新進／出關");
    assert.equal(board.attention.length, 1, "其他來源不受影響");
    const history = await pollUntil(async () => {
      try { return JSON.parse(await readFile(join(dataDir, "surveillance-history.json"), "utf8")); }
      catch { return null; }
    });
    assert.equal(history[base], undefined, "硬失敗當日不可寫入殘缺歷史快照");
  } finally {
    undo();
  }
});

test("survFetchRecords：同日 last-good 沿用；跨日失敗 → 空＋硬失敗警告", async () => {
  const day = "20990101";
  const rows = [{ code: "1234" }];
  const w1 = [];
  const got = await survFetchRecords("unitKey", day, "來源X", w1, async () => rows);
  assert.deepEqual(got, rows);
  assert.deepEqual(w1, []);
  // 同日失敗 → 沿用剛才成功的
  const w2 = [];
  const cached = await survFetchRecords("unitKey", day, "來源X", w2, async () => { throw new Error("boom"); });
  assert.deepEqual(cached, rows);
  assert.ok(w2[0].includes("暫時抓取失敗") && w2[0].includes("沿用"));
  // 跨日失敗（快取日期不符）→ 空陣列＋硬失敗
  const w3 = [];
  const empty = await survFetchRecords("unitKey", "20990102", "來源X", w3, async () => { throw new Error("boom"); });
  assert.deepEqual(empty, []);
  assert.ok(w3[0].includes("抓取失敗："));
});
