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

// `compactToday(n)` 是**純日曆位移**，但這支檔案的多數測試需要「那一天是交易日」
// ——getSurveillanceBoard 只在交易日落盤，落到週末就沒有快照可比對。
// 寫死位移的結果是「測試在某些星期幾才會執行到真正的路徑」：2026-07-27 用模擬時鐘實測，
// 週五 2 條、週六 5 條、週日 3 條轉紅，而週一到週四全綠——所以平日開發永遠看不到。
// 這是同一個問題在這支檔案裡的第二次，所以抽成共用而不是再寫一次 inline 判斷。
// （只處理週末；國定假日仍由各測試自行 mock holidaySchedule 決定，與 fixtures 的分工一致。）
const weekdayOf = (compact) => new Date(Date.UTC(
  Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8)),
)).getUTCDay();
const isWeekday = (compact) => weekdayOf(compact) % 6 !== 0;
// 從 preferred 往前找第一個落在平日的位移。
function weekdayOffset(preferred) {
  for (let offset = preferred, guard = 0; guard < 10; offset -= 1, guard += 1) {
    if (isWeekday(compactToday(offset))) return offset;
  }
  return preferred;
}
// 從 preferred 往前找一組「連續兩個平日」，回傳 [前, 後]。
function adjacentWeekdayOffsets(preferred) {
  for (let offset = preferred, guard = 0; guard < 10; offset -= 1, guard += 1) {
    if (isWeekday(compactToday(offset)) && isWeekday(compactToday(offset - 1))) return [offset - 1, offset];
  }
  return [preferred - 1, preferred];
}

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

// 抓取失敗改成**分類別**判斷（2026-07-26）。舊政策是一刀切：任何來源失敗就整份歷史停更、
// 所有類別都不比對。在「TWSE 注意股端點長期只回空白哨兵列」被揭露之後，那等於把
// 新進／出關／連 N 天永久關掉——而處置、全額交割、鉅額的資料其實是完整的，沒有理由陪葬。
//
// 新政策的三個判準：
//   1. 不完整的類別**照樣落盤**，但在 `partial` 記下它那一輪不完整。省略欄位會讓隔天完全
//      比不了，長期缺一個市場時等於功能停擺；寫進去反而能讓有資料的那半持續算連續天數。
//   2. 「出關」比「新進」嚴：代號從名單消失可能只是這一輪抓不到，所以來源失敗時出關一律歸零。
//   3. 組成不一致的風險是**單向**的——對照不完整＋今天完整才會爆出假新進（必須擋）；
//      對照完整＋今天不完整可以比（今天的代號是子集）。
test("單源失敗：只有失敗的那一類停止比對，其他類別照常落盤", async () => {
  const K = weekdayOffset(-5); // 落到週末就沒有快照可比對
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
    assert.ok(
      board.warnings.some((w) => w.includes("處置") && w.includes("不更新每日歷史") && w.includes("其餘類別照常")),
      `警告要點名是哪一類、並說明其他類別不受影響：${JSON.stringify(board.warnings)}`,
    );
    assert.ok(board.staleHistoryFields.includes("disposition"), "要回報 disposition 這一輪沒比對");
    assert.equal(board.attention.length, 1, "其他來源不受影響");
    // 失敗的那一類不得拿舊快照算新進／出關
    assert.equal(board.enteredSinceComparison, 0, "處置抓不到就不能算新增");
    assert.equal(board.releasedSinceComparison, 0, "處置抓不到就不能算移除");
    assert.ok(board.inDisposition.every((it) => !it.isNew), "處置卡片不可掛「今日新進」");

    const history = await pollUntil(async () => {
      try { return JSON.parse(await readFile(join(dataDir, "surveillance-history.json"), "utf8")); }
      catch { return null; }
    });
    const snap = history[base];
    assert.ok(snap, "成功的類別要照常落盤，不該因為一個來源失敗就整天丟掉");
    assert.ok("attention" in snap, "成功的類別要寫進去");
    assert.ok(
      (snap.partial || []).includes("disposition"),
      `不完整的類別要被標記，否則明天無法分辨組成（實際 partial=${JSON.stringify(snap.partial)}）`,
    );
    assert.equal(
      (snap.partial || []).includes("attention"), false,
      "完整的類別不可被誤標成不完整",
    );
  } finally {
    undo();
  }
});

test("對照名單不完整、今天完整 → 不得把整批標成「今日新進」", async () => {
  // 這是組成不一致裡**唯一危險的方向**：對照那份缺了一半（例如上市端點掛掉，只有上櫃），
  // 今天恢復完整 → 對照缺的那些代號今天全部看起來像新進。必須靠 partial 標記擋掉。
  //
  // ⚠ 位移刻意選前面測試沒用過的（其他測試佔了 0、-1~-6）：同一個日期若早先已寫過完整快照，
  //   落盤時的 merge 會保留那一份（那是對的——同一交易日先抓到的真實資料不該因後來失敗而丟掉），
  //   會讓本測試的前提不成立，所以下面明確斷言前提。
  // 見檔案上方 weekdayOffset／adjacentWeekdayOffset 的說明。
  const [PREV_OFF, CURR_OFF] = adjacentWeekdayOffsets(-9);
  const prevDay = compactToday(PREV_OFF);
  const currDay = compactToday(CURR_OFF);
  assert.ok(isWeekday(prevDay) && isWeekday(currDay), `前提：${prevDay}／${currDay} 必須都是平日`);

  resetSources();
  o.twsePunish = [twsePunishRow({ code: "2603", startOff: CURR_OFF - 1, endOff: CURR_OFF + 8 })];
  const undo = mock.override({
    match: /openapi\.twse\.com\.tw\/v1\/announcement\/punish/,
    reply: { __error: "simulated 403" },
  });
  try {
    await getSurveillanceBoard(prevDay);   // 前一個交易日：處置來源失敗 → 標 partial
  } finally {
    undo();
  }
  const history = await pollUntil(async () => {
    try { return JSON.parse(await readFile(join(dataDir, "surveillance-history.json"), "utf8")); }
    catch { return null; }
  });
  assert.ok(history[prevDay], `前提：${prevDay} 要有快照`);
  assert.ok(
    (history[prevDay].partial || []).includes("disposition"),
    `前提：${prevDay} 的 disposition 必須被標成不完整（實際 partial=${JSON.stringify(history[prevDay].partial)}）`,
  );

  const board = await getSurveillanceBoard(currDay); // 這一天：全部正常
  assert.ok(board.staleHistoryFields.includes("disposition"),
    `對照不完整＋今天完整 → 不可比對（實際 ${JSON.stringify(board.staleHistoryFields)}）`);
  const disp = [...board.aboutToDispose, ...board.inDisposition];
  assert.ok(disp.length, "前提：要有處置股才驗得出來");
  assert.ok(disp.every((it) => !it.isNew), `不可把整批處置股標成今日新進：${JSON.stringify(disp.map((i) => [i.code, i.isNew]))}`);
  assert.equal(board.enteredSinceComparison, 0);
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

// 「新進／連 N 天」與「出關」的可信度不同，不可一起關掉。
// TWSE 注意股端點長期只回哨兵列 → 歷史快照裡本來就只有上櫃代號。對今天出現在名單上的
// 上櫃股來說，「它前一份快照在不在」是查得到的事實，連續天數是真的；
// 但「代號從名單消失」可能只是這一輪抓不到，所以出關不可信。
test("來源抓不到時：新進與連 N 天仍計算，只有「出關」歸零", async () => {
  const PREV_OFF = -6;
  const CURR_OFF = -5;
  resetSources();
  // 前一個交易日：兩檔處置股都抓得到，正常落盤
  o.twsePunish = [
    twsePunishRow({ code: "1101", startOff: PREV_OFF - 1, endOff: CURR_OFF + 8 }),
    twsePunishRow({ code: "2603", startOff: PREV_OFF - 1, endOff: CURR_OFF + 8 }),
  ];
  await getSurveillanceBoard(compactToday(PREV_OFF));
  const history = await pollUntil(async () => {
    try { return JSON.parse(await readFile(join(dataDir, "surveillance-history.json"), "utf8")); }
    catch { return null; }
  });
  const prevSnap = history[compactToday(PREV_OFF)];
  assert.ok(prevSnap?.disposition?.length >= 2, `前提：前一份快照要有兩檔處置（實際 ${JSON.stringify(prevSnap?.disposition)}）`);

  // 這一天：處置來源掛掉 → 名單整批缺席
  const undo = mock.override({
    match: /openapi\.twse\.com\.tw\/v1\/announcement\/punish/,
    reply: { __error: "simulated 403" },
  });
  try {
    const board = await getSurveillanceBoard(compactToday(CURR_OFF));
    assert.equal(
      board.releasedSinceComparison, 0,
      "代號消失可能只是抓不到，不可報成出關",
    );
    assert.ok(
      board.unreliableRemovalFields.includes("disposition"),
      `要回報 disposition 的出關不可信（實際 ${JSON.stringify(board.unreliableRemovalFields)}）`,
    );
    // 但比對本身沒有被關掉——上櫃注意股照樣算得出連續天數
    assert.equal(
      board.staleHistoryFields.includes("attention"), false,
      "注意股的對照欄位還在，不該被列為完全無法比對",
    );
    assert.ok(
      board.attention.every((it) => Number.isFinite(it.daysOnList)),
      `注意股的連續天數要照算（實際 ${JSON.stringify(board.attention.map((i) => [i.code, i.daysOnList]))}）`,
    );
  } finally {
    undo();
  }
});
