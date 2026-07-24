// 隔日沖前向驗證引擎：快照存檔規則（更完整才覆蓋、保留 15 份）、隔日驗證數學、長期成績單。
// 快照直接操作 loadDb() 的 dbCache（每測開頭重設，彼此獨立）；行情走 fetch-mock 離線。
// 注意：buildVerificationHistory 有 10 分鐘模組級快取 → 只能呼叫一次（放最後一個測試）。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, compactToday, rocCompact } from "../helpers/fixtures.mjs";

const iso = (compact) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
const TODAY = compactToday(0);
const YESTERDAY = compactToday(-1);

// 觀察日行情（今天）：開 103 高 104 低 97 收 102 → 對 100 的訊號價：
// open +3%、high +4%（達標）、low −3%（破線）、現價 +2%。
const referenceRows = [{
  ...stockDayAllRow({ code: "2330", name: "台積電", close: 102, open: 103, high: 104, low: 97 }),
  Date: rocCompact(TODAY),
}, {
  ...stockDayAllRow({ code: "1101", name: "台泥", close: 100, open: 100, high: 100, low: 100 }),
  Date: rocCompact(YESTERDAY),
}];

let mod;
before(async () => {
  ({ mod } = await importServer({
    routes: [
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: () => referenceRows },
      { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: () => [] },
      { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({ msgArray: [] }) },
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: () => [{ Date: rocCompact(TODAY) }] },
      { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: () => [{
        Name: "中華民國開國紀念日", Date: `${TODAY.slice(0, 4) - 1911}0101`, Weekday: "四", Description: "依規定放假1日。",
      }] },
      // 逐檔月歷史：只有「本月」有今天這一根，其他月份回空。
      { match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: (url) => {
        if (url.searchParams.get("stockNo") !== "2330") return { stat: "OK", data: [] };
        const month = String(url.searchParams.get("date") || "").slice(0, 6);
        if (month !== TODAY.slice(0, 6)) return { stat: "OK", data: [] };
        return { stat: "OK", data: [[
          `${Number(TODAY.slice(0, 4)) - 1911}/${TODAY.slice(4, 6)}/${TODAY.slice(6, 8)}`,
          "5,000,000", "510,000,000", "103", "104", "97", "102", "2", "3,000",
        ]] };
      } },
      // 週轉率/公司資料/除息預告：一律空（getQuotes 的旁路，缺了也不能擋驗證）
      { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: () => [] },
      { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: () => [] },
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/TWT48U_ALL/, reply: () => [] },
      { match: /tpex\.org\.tw\/openapi\/v1\/tpex_exright_prepost/, reply: () => [] },
    ],
  }));
});

const pickOf = (price = 100) => ({
  code: "2330", name: "台積電", group: "strongContinuation", groupName: "強勢續攻",
  score: 80, price, changePct: 5, reasons: [], riskTags: [],
});

async function resetSnapshots(list = []) {
  const db = await mod.loadDb();
  db.signalSnapshots = list;
  await mod.saveDb(db);
  return db;
}

test("saveSignalSnapshot：首次存檔＋空清單不存", async () => {
  const db = await resetSnapshots();
  await mod.saveSignalSnapshot({ asOf: iso(YESTERDAY), groups: { strongContinuation: [pickOf()] } });
  assert.equal(db.signalSnapshots.length, 1);
  assert.equal(db.signalSnapshots[0].asOf, iso(YESTERDAY));
  assert.equal(db.signalSnapshots[0].formulaVersion, mod.OVERNIGHT_FORMULA_VERSION);
  assert.equal(db.signalSnapshots[0].picks[0].code, "2330");
  await mod.saveSignalSnapshot({ asOf: iso(TODAY), groups: { strongContinuation: [] } });
  assert.equal(db.signalSnapshots.length, 1, "沒有 picks 的快照不該存");
});

test("saveSignalSnapshot：市場覆蓋不完整不可落正式快照", async () => {
  const db = await resetSnapshots();
  await mod.saveSignalSnapshot({
    asOf: iso(YESTERDAY),
    provisional: true,
    coverage: { complete: false },
    groups: { strongContinuation: [pickOf()] },
  });
  assert.equal(db.signalSnapshots.length, 0, "半市場結果只能顯示，不能成為前向驗證樣本");
});

test("saveSignalSnapshot：同日快照——較短不覆蓋（半個市場）、較長才覆蓋（補齊後）", async () => {
  const db = await resetSnapshots();
  await mod.saveSignalSnapshot({ asOf: iso(YESTERDAY), groups: { a: [pickOf(), { ...pickOf(), code: "1101" }] } });
  await mod.saveSignalSnapshot({ asOf: iso(YESTERDAY), groups: { a: [pickOf(999)] } });
  assert.equal(db.signalSnapshots[0].picks.length, 2, "較短的新清單不可蓋掉完整版");
  assert.equal(db.signalSnapshots[0].picks[0].price, 100);
  await mod.saveSignalSnapshot({ asOf: iso(YESTERDAY), groups: { a: [pickOf(101), { ...pickOf(), code: "1101" }, { ...pickOf(), code: "2454" }] } });
  assert.equal(db.signalSnapshots[0].picks.length, 3, "較完整的清單要覆蓋");
  assert.equal(db.signalSnapshots[0].picks[0].price, 101);
});

test("saveSignalSnapshot：只保留最近 15 份（依訊號日排序砍最舊）", async () => {
  const seed = Array.from({ length: 15 }, (_, i) => ({
    asOf: iso(compactToday(-(20 - i))), savedAt: "", picks: [pickOf()],
  }));
  const db = await resetSnapshots(seed);
  await mod.saveSignalSnapshot({ asOf: iso(YESTERDAY), groups: { a: [pickOf()] } });
  assert.equal(db.signalSnapshots.length, 15);
  assert.ok(db.signalSnapshots.some((s) => s.asOf === iso(YESTERDAY)), "新的一份要在");
  assert.ok(!db.signalSnapshots.some((s) => s.asOf === iso(compactToday(-20))), "最舊的要被砍");
});

test("saveSignalSnapshot：同日不同公式版本互不覆蓋，舊缺欄位明確視為 v1", async () => {
  const db = await resetSnapshots();
  await mod.saveSignalSnapshot({
    asOf: iso(YESTERDAY), formulaVersion: "overnight-v0-test", groups: { a: [pickOf(90)] },
  });
  await mod.saveSignalSnapshot({
    asOf: iso(YESTERDAY), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, groups: { a: [pickOf(100)] },
  });
  assert.equal(db.signalSnapshots.length, 2);
  assert.deepEqual(new Set(db.signalSnapshots.map((s) => s.formulaVersion)), new Set(["overnight-v0-test", mod.OVERNIGHT_FORMULA_VERSION]));
  assert.equal(mod.overnightSnapshotFormulaVersion({}), "overnight-v1-aggressive-controlled");
});

test("buildSignalVerification：完全沒有快照 → 開始記錄的說明", async () => {
  await resetSnapshots();
  const body = await mod.buildSignalVerification();
  assert.equal(body.available, false);
  assert.ok(body.message.includes("今天開始記錄"), body.message);
});

test("buildSignalVerification：只有今天的快照 → 等下一個交易日", async () => {
  await resetSnapshots([{ asOf: iso(TODAY), savedAt: "", picks: [pickOf()] }]);
  const body = await mod.buildSignalVerification();
  assert.equal(body.available, false);
  assert.ok(body.message.includes("下一個交易日"), body.message);
});

test("buildSignalVerification：昨日訊號＋今日行情 → 開高低收報酬與達標/破線手算", async () => {
  await resetSnapshots([{ asOf: iso(YESTERDAY), savedAt: "", picks: [pickOf(100)] }]);
  const body = await mod.buildSignalVerification();
  assert.equal(body.available, true);
  assert.equal(body.signalDate, iso(YESTERDAY));
  assert.equal(body.observationDate, iso(TODAY));
  const row = body.rows[0];
  assert.equal(row.openReturn, 3);
  assert.equal(row.highReturn, 4);
  assert.equal(row.lowReturn, -3);
  assert.equal(row.currentReturn, 2);
  assert.equal(row.hitPlus2, true);
  assert.equal(row.brokeMinus2, true);
  assert.equal(body.summary.total, 1);
  assert.equal(body.summary.hitPlus2, 1);
  assert.equal(body.summary.brokeMinus2, 1);
  assert.equal(body.summary.avgCurrentReturn, 2);
  assert.equal(body.summaryByGroup.strongContinuation.total, 1);
});

test("buildSignalVerification：個別股票行情未前進時不可混入驗證統計", async () => {
  await resetSnapshots([{
    asOf: iso(YESTERDAY), savedAt: "",
    picks: [pickOf(100), { ...pickOf(100), code: "1101", name: "台泥" }],
  }]);
  const body = await mod.buildSignalVerification();
  assert.equal(body.available, true, "至少一檔已有新行情時仍可顯示部分結果");
  assert.equal(body.rows.find((row) => row.code === "2330").verified, true);
  assert.equal(body.rows.some((row) => row.code === "1101"), false, "訊號日原行情不可假裝成隔日結果");
  assert.equal(body.summary.total, 1, "統計分母只計行情日期真的前進的股票");
});

// 放最後：buildVerificationHistory 有 10 分鐘模組級快取，本行程只能算一次。
test("buildVerificationHistory：已驗證日＋今日 pending、totals 用驗證檔數加權", async () => {
  const currentSnapshots = Array.from({ length: 15 }, (_, index) => {
    const day = compactToday(index - 14);
    return {
      asOf: iso(day), savedAt: "", formulaVersion: mod.OVERNIGHT_FORMULA_VERSION,
      picks: [pickOf(day === TODAY ? 102 : 100)],
    };
  });
  await resetSnapshots([
    { asOf: iso(compactToday(-15)), savedAt: "", formulaVersion: "overnight-v0-test", picks: [pickOf(50)] },
    ...currentSnapshots,
  ]);
  const body = await mod.buildVerificationHistory();
  assert.equal(body.records.length, 15, "保留的 15 份現版快照都要進成績單，不可只讀 12 份");
  assert.equal(body.formulaVersion, mod.OVERNIGHT_FORMULA_VERSION);
  assert.equal(body.formulaVersions[mod.OVERNIGHT_FORMULA_VERSION], 15);
  assert.equal(body.formulaVersions["overnight-v0-test"], 1);
  const latest = body.records[0];
  const older = body.records.find((record) => record.asOf === iso(YESTERDAY));
  assert.equal(latest.asOf, iso(TODAY));
  assert.equal(latest.pending, true, "今天的訊號還沒有更新的行情可對 → pending");
  assert.ok(older, "要保留昨日訊號");
  assert.equal(older.asOf, iso(YESTERDAY));
  assert.equal(older.verified, 1);
  assert.equal(older.hitPlus2, 1, "隔日最高 104 對 100 → +4% 達標");
  assert.equal(older.brokeMinus2, 1, "隔日最低 97 → −3% 破線");
  assert.equal(older.avgCloseReturn, 2);
  const completed = body.records.filter((record) => record.complete);
  assert.equal(body.totals.days, completed.length, "pending 的不進 totals");
  assert.equal(body.totals.signals, completed.reduce((sum, record) => sum + record.verified, 0));
  assert.equal(body.totals.avgCloseReturn, 2);
});
