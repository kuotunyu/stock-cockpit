// 日期掃描分片：整套 16 個日期序列跑貼著 CI 的 30 分鐘上限（2026-09-09／09-11 兩晚被逾時砍掉），
// 改成 4 片矩陣各跑 4 個日期。輪流分配讓每片都混到月初／月底／假日／深夜，不會把慢的一類堆在同一片。
import test from "node:test";
import assert from "node:assert/strict";
import { shardTargets } from "../../scripts/date-sweep.mjs";

const targets = Array.from({ length: 16 }, (_, i) => ({ at: `d${i}`, label: `l${i}` }));

test("shardTargets：i/n 輪流分配、涵蓋全部且不重疊；沒給 spec 回原列表", () => {
  const shards = [1, 2, 3, 4].map((i) => shardTargets(targets, `${i}/4`));
  assert.deepEqual(shards.map((s) => s.length), [4, 4, 4, 4]);
  assert.deepEqual(shards[0].map((t) => t.at), ["d0", "d4", "d8", "d12"]);
  assert.deepEqual(shards[1].map((t) => t.at), ["d1", "d5", "d9", "d13"]);
  const union = shards.flat().map((t) => t.at).sort();
  assert.deepEqual(union, targets.map((t) => t.at).sort(), "四片合起來剛好是全部、無重疊");
  assert.equal(shardTargets(targets, ""), targets);
  assert.deepEqual(shardTargets(targets, "1/1"), targets);
  assert.deepEqual(shardTargets(targets.slice(0, 3), "4/4"), [], "日期比片數少時可能分到空片（主控會以 exit 1 擋下）");
});

test("shardTargets：格式錯誤或超出範圍要 throw，不可靜默跑全部", () => {
  for (const bad of ["4", "0/4", "5/4", "a/b", "2/0"]) assert.throws(() => shardTargets(targets, bad), new RegExp("--shard"), bad);
});
