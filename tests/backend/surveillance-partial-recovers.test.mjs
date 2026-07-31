// 同一個交易日內「早盤抓不到、盤後抓到了」時，partial 旗標必須撕得掉。
//
// 現場：TWSE 注意股端點在名單還沒公布時只回哨兵列（D-44），早盤那一輪 attention 被標 partial。
// 下午同一天抓成功後，snapshot.attention 已經是完整的整份取代，但旗標還在。後果落在**隔天**：
// canCompare 對「昨天 partial、今天完整」刻意回 false（那道保護是對的，防的是「對照缺一半 →
// 今天全部看起來像新進」），於是隔天整個類別的新進與連續天數靜默消失，
// 而畫面圖例還印著「新＝今日新進」。名單暴增時早盤沒公布、盤後才有正是最常見的樣態。
//
// 旗標有兩道各自獨立的破口，缺一不可修：
//   ① 判定用 `failedFields.has(field) || previousTodayPartial.has(field)` → 這一輪成功也照樣標
//   ② 落盤用 `...(partial.length ? { partial } : {})` → 空陣列時什麼都不寫，
//      舊旗標從 `...previousToday` 原封不動被帶回來
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });
const { mergeSurveillanceDaySnapshot } = mod;

// 一輪掃描的產出（四個類別都給值，與 getSurveillanceBoard 內部的 snapshot 同形狀）。
const round = ({ attention = {}, disposition = [], changed = [], block = [] } = {}) =>
  ({ disposition, attention, changed, block });

test("這一輪某類別抓不到 → 標 partial", () => {
  const record = mergeSurveillanceDaySnapshot(
    undefined,
    round({ attention: {}, disposition: ["1101"] }),
    new Set(["attention"]),
  );
  assert.deepEqual(record.partial, ["attention"]);
  assert.deepEqual(record.disposition, ["1101"], "沒失敗的類別照常落盤");
});

test("同一天稍後抓成功 → partial 必須撕掉（不是黏著）", () => {
  const morning = mergeSurveillanceDaySnapshot(
    undefined,
    round({ attention: {} }),
    new Set(["attention"]),
  );
  assert.deepEqual(morning.partial, ["attention"], "前提：早盤要是 partial");

  const afternoon = mergeSurveillanceDaySnapshot(
    morning,
    round({ attention: { 1101: 1, 6510: 2 } }),
    new Set(), // 這一輪全部成功
  );
  assert.deepEqual(afternoon.attention, { 1101: 1, 6510: 2 }, "完整名單要整份取代");
  // 這一條同時擋住兩個破口：判定沒改（會留 ["attention"]）、落盤用加法展開（舊旗標被帶回來）。
  assert.equal(
    afternoon.partial, undefined,
    `這一輪成功了就不是 partial（實際 ${JSON.stringify(afternoon.partial)}）`,
  );
});

test("先完整、同一天稍後失敗 → 保留完整那一份，且不得標成 partial", () => {
  // 這是原本就正確的行為（同一交易日先抓到的真實資料不因後來失敗而丟掉），修 partial 時不可破壞。
  const morning = mergeSurveillanceDaySnapshot(undefined, round({ attention: { 1101: 1 } }), new Set());
  assert.equal(morning.partial, undefined);

  const afternoon = mergeSurveillanceDaySnapshot(morning, round({ attention: {} }), new Set(["attention"]));
  assert.deepEqual(afternoon.attention, { 1101: 1 }, "殘缺名單不可蓋掉先前完整的那一份");
  assert.equal(afternoon.partial, undefined, "留下來的是完整資料，標 partial 會讓隔天白白比不了");
});

test("先 partial、稍後又失敗 → 仍是 partial（不可因為改判定而漏標）", () => {
  const morning = mergeSurveillanceDaySnapshot(undefined, round({ attention: {} }), new Set(["attention"]));
  const afternoon = mergeSurveillanceDaySnapshot(morning, round({ attention: {} }), new Set(["attention"]));
  assert.deepEqual(afternoon.partial, ["attention"]);
});

test("多個類別各自獨立：一類失敗不會拖累其他類", () => {
  const record = mergeSurveillanceDaySnapshot(
    undefined,
    round({ attention: {}, disposition: ["1101"], changed: ["2603"], block: ["2330"] }),
    new Set(["attention", "block"]),
  );
  assert.deepEqual(record.partial.slice().sort(), ["attention", "block"]);
  assert.deepEqual(record.disposition, ["1101"]);
  assert.deepEqual(record.changed, ["2603"]);
});

test("四個歷史類別的鍵不可悄悄改名（前端分頁對照表相依）", () => {
  assert.deepEqual(
    mod.SURVEILLANCE_HISTORY_FIELDS.map((f) => f.field).sort(),
    ["attention", "block", "changed", "disposition"],
  );
});
