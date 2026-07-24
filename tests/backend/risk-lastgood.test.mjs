// 停牌來源的 last-good 行為：官方端點掛掉時沿用 risk-cache.json 的舊名單；
// 一天內靜默沿用、超過一天（26h）才對使用者出警告。
// 做法：importServer 後、第一次 getRiskSets 前，預先種入磁碟快取（loadRiskSourceMemory 是惰性載入）。
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, surveillanceRoutes } from "../helpers/fixtures.mjs";

// 兩個停牌端點都掛掉；其餘來源照常（空名單）。
const routes = [
  { match: /exchangeReport\/TWTAWU/, reply: () => ({ __error: "simulated 403" }) },
  { match: /tpex_spendi_history/, reply: () => ({ __error: "simulated 403" }) },
  ...surveillanceRoutes({}),
];

const { mod, dataDir } = await importServer({ routes });

// 種入快取：TWSE 2 小時前成功過（一天內 → 靜默沿用）；TPEx 30 小時前（→ 沿用但出警告）。
await mkdir(dataDir, { recursive: true });
await writeFile(join(dataDir, "risk-cache.json"), JSON.stringify({
  "TWSE 暫停交易": {
    codes: [`9901|${compactToday(-5)}`],
    fetchedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
  },
  "TPEx 暫停交易": {
    codes: ["9902"],
    fetchedAt: new Date(Date.now() - 30 * 3600e3).toISOString(),
  },
}), "utf8");

test("端點失敗：一天內的快取靜默沿用（含夾帶的停牌起日）", async () => {
  const risk = await mod.getRiskSets(compactToday(0));
  assert.ok(risk.halted.has("9901"));
  assert.equal(risk.halted.get("9901"), compactToday(-5));
  assert.ok(!risk.warnings.some((w) => w.includes("TWSE 暫停交易")), "一天內沿用不該出警告");
});

test("端點失敗：超過一天的快取仍沿用、但要警告使用者名單可能略舊", async () => {
  const risk = await mod.getRiskSets(compactToday(0));
  assert.ok(risk.halted.has("9902"), "超過一天仍沿用（總比漏掉好）");
  assert.ok(
    risk.warnings.some((w) => w.includes("TPEx 暫停交易") && w.includes("超過一天")),
    `該有陳舊警告，實際 warnings：${JSON.stringify(risk.warnings)}`
  );
});
