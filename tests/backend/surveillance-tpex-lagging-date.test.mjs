// D-07：上櫃的鉅額與變更交易端點回的是「最近一個公布日」的整批資料，不是可指定日期的查詢。
// 以前硬比對日曆今天，於是週末、國定假日與盤中尚未公布的時段，這兩類就只剩上市股票、
// 上櫃整批消失，counts 跟著少算，畫面卻仍標著今天的日期——看起來像「上櫃今天真的沒有」。
// 改成取 payload 內「不晚於查詢日的最新日期」，並在日期落後查詢日時明講。
import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday, surveillanceRoutes,
  bfiauuRow, tpexBlockRow, twt85uRow, tpexCmodeRow,
} from "../helpers/fixtures.mjs";

// 情境：查詢日是今天，但上櫃兩個端點只有「昨天」的公布資料（非交易日的實際樣態）。
const o = {
  bfiauu: [bfiauuRow({ code: "7101", name: "上市鉅額", value: 500_000_000 })],
  tpexBlock: [tpexBlockRow({ code: "7201", name: "上櫃鉅額", value: 300_000_000, dateOff: -1 })],
  twt85u: [twt85uRow({ code: "7102", name: "上市全額" })],
  tpexCmode: [tpexCmodeRow({ code: "7202", name: "上櫃全額", altered: "Ｙ", dateOff: -1 })],
};

const { mod, mock, dataDir } = await importServer({ routes: surveillanceRoutes(o) });
test.after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("上櫃資料日落後查詢日時，仍要顯示且明講實際資料日", async () => {
  const board = await mod.getSurveillanceBoard(compactToday(0));
  assert.equal(board.ok, true);

  const blockCodes = board.blockTrades.map((item) => item.code);
  assert.ok(blockCodes.includes("7101"), "上市鉅額本來就在");
  assert.ok(blockCodes.includes("7201"), "上櫃鉅額不得因為資料日是昨天就整批消失");

  const changedCodes = board.changedTrading.map((item) => item.code);
  assert.ok(changedCodes.includes("7102"), "上市全額交割本來就在");
  assert.ok(changedCodes.includes("7202"), "上櫃全額交割同樣不得消失");

  assert.equal(board.counts.blockTrades, 2, "counts 要含兩個市場");
  assert.equal(board.counts.changedTrading, 2);

  const warningText = (board.warnings || []).join(" ");
  assert.match(warningText, /上櫃鉅額交易目前是/, `要揭露實際資料日，實際 warnings：${warningText}`);
  assert.match(warningText, /上櫃全額交割目前是/, warningText);
});

test("latestUpstreamDate：取不晚於查詢日的最新日期，未來日期不得被選中", () => {
  const rows = [
    { Date: compactToday(-3) },
    { Date: compactToday(-1) },
    { Date: compactToday(2) }, // 未來日期（上游偶爾會夾帶預告）不可選
    { Date: "壞資料" },
  ];
  assert.equal(mod.latestUpstreamDate(rows, (r) => r.Date, compactToday(0)), compactToday(-1));
  assert.equal(mod.latestUpstreamDate([], (r) => r.Date, compactToday(0)), "", "沒有可用列 → 空字串");
  assert.equal(
    mod.latestUpstreamDate([{ Date: compactToday(5) }], (r) => r.Date, compactToday(0)),
    "",
    "只有未來日期時視為無可用資料，不可拿未來資料充當今日",
  );
});
