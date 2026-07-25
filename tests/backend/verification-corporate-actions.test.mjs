// 前向驗證的除權息處理：兩套驗證引擎都不能把「除權息造成的機械性跳空」當成真實漲跌。
// 2026-07-25 實測：波段驗證單在持有期間遇到配息 5 元（參考價 95）、當天相對參考價其實小漲 0.5%，
// 仍會被 low(95) <= stop(95) 記成 loss −5%；隔日沖驗證同理會直接觸發 brokeMinus2。
// 台股殖利率偏高且除權息旺季集中在 7~9 月，這個偏誤是單向的（只會多記 loss、少記 win）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay } from "../helpers/fixtures.mjs";

const D0 = compactTradingDay(-1); // 訊號日／上一個檢查日
const D1 = compactTradingDay(0);  // 要推進的觀察日

const dataDir = await mkdtemp(join(tmpdir(), "stock1-verify-actions-"));
// 官方歸檔：2412 在 D1 除息 5 元。隔日沖側必須先由歸檔確認事件，才允許換基準價。
await writeFile(join(dataDir, "fundamentals-cache.json"), JSON.stringify({
  revenue: {}, eps: {}, valuation: {},
  dividends: {
    2412: {
      [D1]: {
        kind: "除息", cashDividend: 5, stockRatio: 0, subscriptionRatio: 0, subscriptionPrice: 0,
        observedAt: "2026-01-01T00:00:00.000Z", revision: 1,
      },
    },
  },
}), "utf8");

const { mod, mock } = await importServer({ dataDir, routes: [] });
const { replaySwingVerificationHistory } = mod;

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const calendar = { tradingDays: [D0, D1], holidayRows: [] };
const pendingEntry = () => ({
  code: "2412", status: "pending", entry: 100, stop: 95, target: 108,
  lastChecked: D0, daysHeld: 3,
});
// 前一根收 100；除息日交易所昨收（＝官方參考價）95。
const priorDay = { rawDate: D0, open: 99, high: 101, low: 98, close: 100, previousClose: 99.5 };

test("波段驗證：除息當天相對參考價其實小漲，不得記成停損", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    priorDay,
    { rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, previousClose: 95 },
  ], D1, calendar);
  assert.equal(entry.status, "pending", "除息跳空不是真實跌幅，不可結案為停損");
  assert.equal(entry.entry, 95, "計畫價要一起搬到除息後的尺度");
  assert.equal(entry.stop, 90.25);
  assert.equal(entry.target, 102.6);
  assert.deepEqual(entry.corporateActions, [{ date: D1, ratio: 0.95 }], "要留下可稽核的調整紀錄");
});

test("波段驗證：沒有公司行動時真的跌破停損，仍必須記 loss（防線不可過度收緊）", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    priorDay,
    { rawDate: D1, open: 99, high: 99.5, low: 94, close: 94.2, previousClose: 100 },
  ], D1, calendar);
  assert.equal(entry.status, "loss");
  assert.equal(entry.resultPct, -5);
  assert.equal(entry.entry, 100, "沒有事件就不能動計畫價");
  assert.equal(entry.corporateActions, undefined);
});

test("波段驗證：除息後真的續跌，以調整後的停損價結案", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    priorDay,
    { rawDate: D1, open: 95, high: 95.2, low: 89, close: 89.5, previousClose: 95 },
  ], D1, calendar);
  assert.equal(entry.status, "loss");
  assert.equal(entry.entry, 95);
  assert.equal(entry.stop, 90.25);
  assert.equal(entry.resultPct, -5, "含息總報酬：相對調整後 entry 仍是 −5%");
});

test("波段驗證：交易所昨收缺值時偵測不到事件，維持既有行為（已知限制）", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    { ...priorDay, previousClose: null },
    { rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, previousClose: null },
  ], D1, calendar);
  assert.equal(entry.status, "loss", "官方昨收缺值時無法判定，特徵化現行行為");
  assert.equal(entry.corporateActions, undefined);
});

test("隔日沖驗證：只有官方歸檔確認當日有除權息，才可以換掉基準價", async () => {
  // 訊號日收 100；觀察日除息 5 元（官方參考價 95），當天開 95 高 96 低 94.5 收 95.5。
  // 未修正前 lowReturn = (94.5−100)/100 = −5.5% → brokeMinus2；正確應以 95 為基準。
  const withEvent = await mod.observeSignalSnapshot({
    asOf: `${D0.slice(0, 4)}-${D0.slice(4, 6)}-${D0.slice(6, 8)}`,
    picks: [{ code: "2412", name: "中華電", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
  }, {
    reference: {
      byCode: new Map([["2412", {
        code: "2412", name: "中華電", exchange: "TWSE", rawDate: D1,
        open: 95, high: 96, low: 94.5, price: 95.5, previousClose: 95,
      }]]),
      warnings: [],
    },
    calendar: { tradingDays: [D0, D1], holidayRows: [], warnings: [] },
  });
  const row = withEvent.rows?.[0];
  assert.ok(row, JSON.stringify(withEvent).slice(0, 300));
  assert.equal(row.verified, true);
  assert.equal(row.corporateActionAdjusted, true, "歸檔有事件 → 換基準");
  assert.equal(row.adjustedBase, 95);
  assert.equal(row.brokeMinus2, false, "以參考價為基準只跌 0.53%，不該記破線");
  assert.ok(Math.abs(row.currentReturn - 0.53) < 0.02, `currentReturn=${row.currentReturn}`);
});

test("隔日沖驗證：歸檔沒有事件時，價差再大也不可自作主張換基準價", async () => {
  // 這是實作過程中差點放行的回歸：bar.previousClose 與快照 price 來自不同來源／時點，
  // 單純比大小就換基準會靜靜改掉所有報酬數字。9999 在歸檔裡沒有任何事件。
  const noEvent = await mod.observeSignalSnapshot({
    asOf: `${D0.slice(0, 4)}-${D0.slice(4, 6)}-${D0.slice(6, 8)}`,
    picks: [{ code: "9999", name: "測試股", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
  }, {
    reference: {
      byCode: new Map([["9999", {
        code: "9999", name: "測試股", exchange: "TWSE", rawDate: D1,
        open: 103, high: 104, low: 97, price: 102, previousClose: 101,
      }]]),
      warnings: [],
    },
    calendar: { tradingDays: [D0, D1], holidayRows: [], warnings: [] },
  });
  const row = noEvent.rows?.[0];
  assert.ok(row, JSON.stringify(noEvent).slice(0, 300));
  assert.equal(row.verified, true);
  assert.equal(row.corporateActionAdjusted, undefined, "沒有官方事件就不得調整");
  assert.equal(row.openReturn, 3, "基準必須維持訊號日收盤 100");
  assert.equal(row.lowReturn, -3);
});
