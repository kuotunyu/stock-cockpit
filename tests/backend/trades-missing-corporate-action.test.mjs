// D-22 補登入口：比對官方公司行動歸檔與帳本已登錄的 corporateAction，找出漏記的事件。
// 為什麼需要：報價層的 quote.dividend 只帶最近一筆「未來」事件，除權日一過就滾出視窗，
// 除權當天的快速鈕因此只有一天的視窗期。漏記的後果不只是顯示假虧損——之後想賣掉含配股的
// 股數會被賣超檢查擋下，而且使用者完全不知道原因。所以改由伺服器用本機歸檔回溯比對。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const seedDir = await mkdtemp(join(tmpdir(), "stock1-missing-ca-"));
await writeFile(join(seedDir, "fundamentals-cache.json"), JSON.stringify({
  revenue: {}, eps: {}, valuation: {},
  dividends: {
    2330: {
      20260701: { kind: "除權", cashDividend: 0, stockRatio: 0.1, subscriptionRatio: 0, subscriptionPrice: 0, observedAt: "2026-01-01T00:00:00.000Z", revision: 1 },
      // 純現金股利不影響股數，走既有的股利流程，不該混進補登清單。
      20260201: { kind: "除息", cashDividend: 5, stockRatio: 0, subscriptionRatio: 0, subscriptionPrice: 0, observedAt: "2026-01-01T00:00:00.000Z", revision: 1 },
    },
    2412: {
      20260610: { kind: "現增", cashDividend: 0, stockRatio: 0, subscriptionRatio: 0.05, subscriptionPrice: 50, observedAt: "2026-01-01T00:00:00.000Z", revision: 1 },
    },
  },
}), "utf8");

const { mod, mock, dataDir } = await importServer({ dataDir: seedDir, routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const SETTINGS = { feeDiscount: 0.6, minFee: 20 };
const norm = (records) => mod.normalizeTradesPayload({ schemaVersion: 2, settings: SETTINGS, records });
const buy = (over = {}) => ({
  id: "b1", code: "2330", side: "buy", instrumentType: "stock",
  tradeDate: "20260601", price: 100, shares: 1000, dayTrade: { status: "none" }, ...over,
});

test("持股跨越除權基準日且未登錄 → 回報漏記，並附官方比率與可得股數", async () => {
  const missing = await mod.findMissingCorporateActions(norm([buy()]));
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.deepEqual(
    { code: missing[0].code, exDate: missing[0].exDate, stockRatio: missing[0].stockRatio, bonusShares: missing[0].bonusShares },
    { code: "2330", exDate: "20260701", stockRatio: 0.1, bonusShares: 100 },
  );
});

test("已登錄過就不再回報（補登後提示要消失）", async () => {
  const missing = await mod.findMissingCorporateActions(norm([
    buy(),
    { id: "c1", code: "2330", side: "corporateAction", tradeDate: "20260701", stockRatio: 0.1 },
  ]));
  assert.deepEqual(missing, []);
});

test("除權基準日之前已賣光 → 沒有配股可言，不得回報", async () => {
  const missing = await mod.findMissingCorporateActions(norm([
    buy(),
    buy({ id: "s1", side: "sell", tradeDate: "20260620", price: 110, shares: 1000 }),
  ]));
  assert.deepEqual(missing, []);
});

test("基準日當天才買進不享有權利（沿用除息的 date < exDate 規則）", async () => {
  const missing = await mod.findMissingCorporateActions(norm([buy({ tradeDate: "20260701" })]));
  assert.deepEqual(missing, [], "當天買進不算");
});

test("純現金股利事件不混進補登清單", async () => {
  const missing = await mod.findMissingCorporateActions(norm([buy({ tradeDate: "20260101" })]));
  assert.equal(missing.every((item) => item.exDate !== "20260201"), true, "除息不影響股數");
});

test("現增事件要帶認購價與認購股數", async () => {
  const missing = await mod.findMissingCorporateActions(norm([
    buy({ id: "b2", code: "2412", tradeDate: "20260501", price: 100, shares: 1000 }),
  ]));
  const rights = missing.find((item) => item.code === "2412");
  assert.ok(rights, JSON.stringify(missing));
  assert.equal(rights.subscriptionRatio, 0.05);
  assert.equal(rights.subscriptionPrice, 50);
  assert.equal(rights.subscribedShares, 50);
});

test("沒有任何交易紀錄時不查歸檔，直接回空", async () => {
  assert.deepEqual(await mod.findMissingCorporateActions(norm([])), []);
});
