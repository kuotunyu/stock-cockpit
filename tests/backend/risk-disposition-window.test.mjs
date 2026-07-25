// D-08：選股用的處置名單要有日期窗。
// 官方 punish／disposal 清單同時含「已結束」與「尚未開始」的列——處置看板自己就把它切成
// 即將處置／處置中／即將出關三桶，代表程式早就預期清單裡有非當期的列。loadRiskSets 以前
// 卻無條件全收，已出關的股票今天仍被標「處置」，開了隱藏開關還會誤刪正常交易的標的。
// TPEx 變更交易那條本來就有做日期比對，屬內部標準不一致。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, surveillanceRoutes, twsePunishRow, tpexDisposalRow } from "../helpers/fixtures.mjs";

const o = {
  twsePunish: [
    twsePunishRow({ code: "8101", startOff: -3, endOff: 2 }),    // 處置中（涵蓋今天）
    twsePunishRow({ code: "8102", startOff: -20, endOff: -5 }),  // 早就出關
    twsePunishRow({ code: "8103", startOff: 3, endOff: 10 }),    // 尚未開始
    twsePunishRow({ code: "8104", startOff: 0, endOff: 0 }),     // 只處置今天一天（邊界）
  ],
  tpexDisposal: [
    tpexDisposalRow({ code: "8201", startOff: -1, endOff: 1 }),  // 處置中
    tpexDisposalRow({ code: "8202", startOff: -30, endOff: -2 }), // 已出關
  ],
};

let mod;
before(async () => {
  ({ mod } = await importServer({ routes: surveillanceRoutes(o) }));
});

test("處置期間涵蓋基準日 → 標處置；已出關與尚未開始 → 不標", async () => {
  const sets = await mod.getRiskSets(compactToday(0));
  const kindOf = (code) => sets.surveillance.get(code)?.kind ?? null;

  assert.equal(kindOf("8101"), "disposition", "期間涵蓋今天，必須標處置");
  assert.equal(kindOf("8104"), "disposition", "只處置今天一天也算處置中（首尾日皆含）");
  assert.equal(kindOf("8201"), "disposition", "上櫃處置中同樣要標");

  assert.equal(kindOf("8102"), null, "已出關的股票不得再掛處置標籤");
  assert.equal(kindOf("8103"), null, "尚未開始處置的不得提前掛標籤");
  assert.equal(kindOf("8202"), null, "上櫃已出關同樣不得掛");
});

test("期間解析不出來時保守保留（風險標籤寧可多標不要漏標）", async () => {
  const sets = await mod.getRiskSets(compactToday(-1));
  // 8101 的期間是 -3 ~ +2，涵蓋昨天 → 仍在處置中
  assert.equal(sets.surveillance.get("8101")?.kind, "disposition");
  // 8103 起日在 +3，昨天當然也還沒開始
  assert.equal(sets.surveillance.get("8103") ?? null, null);
});

test("parseDispositionPeriod 對垃圾輸入回空字串（保留機制的前提）", () => {
  const bad = mod.parseDispositionPeriod("這不是日期");
  assert.equal(bad.start, "");
  assert.equal(bad.end, "");
  // 空字串代表「無法判斷」，loadRiskSets 的日期窗會因此略過過濾、保留該檔。
});
