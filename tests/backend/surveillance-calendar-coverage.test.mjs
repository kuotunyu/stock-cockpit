// 開休市表沒涵蓋查詢年份時，處置看板**不可**替那一天寫入每日快照。
//
// 判錯的方向是「把休市日當成交易日」：那會讓下一個真實交易日的「連續 N 天」多算一天，
// 45 天的保留額度也少掉一格。寧可那天不落盤（少一天比較基準），也不要塞一天假的。
//
// 表只涵蓋民國 109（2020），對 2026 的查詢就是「沒涵蓋」；對 2020 的查詢則是正常路徑。
// 一份路由驗兩個方向，不必開兩個行程（tradingCalendarCache 是模組級的）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { surveillanceRoutes } from "../helpers/fixtures.mjs";

const o = {};
const { mod, dataDir } = await importServer({
  routes: [
    ...surveillanceRoutes(o),
    // 官方形狀：民國年 + 5 碼。只給 109 年（＝2020）。
    { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: [
      { Date: "1090101", Name: "中華民國開國紀念日", Description: "" },
      { Date: "1090123", Name: "農曆除夕", Description: "" },
      { Date: "1091225", Name: "行憲紀念日", Description: "" },
    ] },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: [] },
  ],
});

const COVERED = "20200701";    // 2020-07-01，週三，不在上面那三個假日裡
const UNCOVERED = "20260701";  // 2026-07-01，週三，但表根本沒講到 2026

const historyFor = async (day) => {
  try {
    const raw = JSON.parse(await readFile(join(dataDir, "surveillance-history.json"), "utf8"));
    return raw[day];
  } catch {
    return undefined;
  }
};

test("表沒涵蓋查詢年份 → 不落盤，並明講「無法確認」", async () => {
  const board = await mod.getSurveillanceBoard(UNCOVERED);
  assert.equal(board.ok, true);

  const warningText = (board.warnings || []).join("\n");
  assert.match(warningText, /尚未涵蓋 2026 年/, "要說清楚是表沒涵蓋，不是今天休市");
  assert.match(warningText, /1091225|2020-12-25|20201225/, "要帶出表目前到哪一天，使用者才知道差多遠");
  // 這一條是關鍵：不可再補一句斷言。「今天不是排定交易日」是我們現在**不知道**的事。
  assert.doesNotMatch(warningText, /今天不是排定交易日/, "沒有依據就不能斷言今天休市");

  assert.equal(await historyFor(UNCOVERED), undefined, "不得替一個無法確認的日子寫入每日快照");
});

test("表涵蓋查詢年份 → 照常落盤（既有行為不可被新檢查破壞）", async () => {
  o.twsePunish = [];
  o.twseNotice = [{ Code: "1101", Name: "台泥", Date: "1090701" }];
  const board = await mod.getSurveillanceBoard(COVERED);
  assert.equal(board.ok, true);

  const warningText = (board.warnings || []).join("\n");
  assert.doesNotMatch(warningText, /尚未涵蓋/, "表講到 2020，不該說沒涵蓋");

  const snapshot = await historyFor(COVERED);
  assert.ok(snapshot, "涵蓋範圍內的交易日要照常落盤");
  assert.ok(Array.isArray(snapshot.disposition), "快照結構要完整");
});

test("表涵蓋、且那天真的是官方休市日 → 不落盤且說得出理由", async () => {
  // 2020-12-25 行憲紀念日（週五），在表裡。這條與「沒涵蓋」是不同的狀態，文案也不同。
  const board = await mod.getSurveillanceBoard("20201225");
  const warningText = (board.warnings || []).join("\n");
  assert.match(warningText, /今天不是排定交易日/, "表裡明列的休市日就是可以斷言的");
  assert.doesNotMatch(warningText, /尚未涵蓋/);
  assert.equal(await historyFor("20201225"), undefined);
});
