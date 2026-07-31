// 官方逐檔月歷史抓取失敗時，**不得**偽裝成「官方缺這一天的 K」。
//
// 現場：getStockHistory 的 `.catch(() => [])` 把逐月失敗吞成空陣列，於是 rows 只剩整批收盤那一根，
// 中間每個交易日都變成「查無 K」→ 寫進 dataGap。而 replay 依設計不跳日（D-26／stock1-domain：
// 「中間日期缺 K 就停在缺口前，不可跳日」），於是那張單**永久停在原地**——daysHeld 不遞增，
// 15 個交易日超時結案永遠碰不到，90 天後被 prune 無差別刪掉，變成看不見的分母損耗。
//
// 停等本身是對的，錯的是把我方的抓取失敗當成官方缺漏餵給它。這裡釘住三件事：
//   ① 抓取失敗 → 整檔跳過，不寫 dataGap、不動任何欄位
//   ② 抓取失敗那一輪不節流 → 同一個資料日在上游恢復後仍能推進
//   ③ 抓取成功但官方真的缺中間那天 → 照舊寫 dataGap 並停等（原有保護不可被放寬掉）
//
// 每個測試用不同代號：historyCache 的鍵是 `${exchange}:${code}:${month}`，當月 TTL 5 分鐘，
// 共用代號會讓後面的測試吃到前面的快取，結果與執行順序耦合。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const D0 = "20260706";
const D1 = "20260707";
const D2 = "20260708";
const roc = (day) => `${Number(day.slice(0, 4)) - 1911}/${day.slice(4, 6)}/${day.slice(6, 8)}`;

const FULL = [
  [roc(D1), "1,000,000", "96,000,000", "100", "103", "94", "96", "-4", "1,000"],
  [roc(D2), "1,000,000", "111,000,000", "100", "112", "100", "111", "15", "1,000"],
];
// D1 缺、D2 有 → 官方真的缺中間那天，這是 dataGap 存在的正當理由。
const MISSING_MIDDLE = [FULL[1]];

// 代號 → 當月要怎麼回。"fail" 代表上游限流／逾時（丟例外，與 fetchJson 失敗同形狀）。
const MONTH_BEHAVIOUR = new Map([
  ["2330", "fail"],
  ["2317", "fail-then-ok"],
  ["2454", "missing-middle"],
]);
let recoveredCodes = new Set();

const { mod } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: [D0, D1, D2].map((day) => ({ Date: roc(day) })) },
    { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: [] },
    { match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: (url) => {
      const code = String(url.searchParams.get("stockNo"));
      const month = String(url.searchParams.get("date"));
      const behaviour = MONTH_BEHAVIOUR.get(code);
      if (!behaviour || !month.startsWith("202607")) return { stat: "OK", data: [] };
      if (behaviour === "fail") throw new Error("HTTP 429 Too Many Requests");
      if (behaviour === "missing-middle") return { stat: "OK", data: MISSING_MIDDLE };
      if (behaviour === "fail-then-ok" && !recoveredCodes.has(code)) throw new Error("HTTP 429 Too Many Requests");
      return { stat: "OK", data: FULL };
    } },
  ],
});

const pendingEntry = (code) => ({
  code, name: `測試${code}`, scenario: "midBandDefense",
  entry: 100, stop: 95, target: 110, rr: 2, score: 80,
  formulaVersion: mod.SWING_FORMULA_VERSION,
  status: "pending", resolvedAt: null, resultPct: null, daysHeld: 0, lastChecked: D0,
});

// 節流鍵是 `${twseAsOf}|${tpexAsOf}`，同一個行程內同一組日期只會嘗試一次。
// 每個測試給不同的上櫃資料日：既避開節流，也順便讓後兩個測試走「上櫃跑在前面」那條新路徑
// （coverageComplete=false、兩市場都 fresh → 推進到較早的上市資料日 D2）。
const reference = (code, tpexAsOf = D2) => ({
  coverageComplete: tpexAsOf === D2,
  markets: { twse: { asOf: D2, status: "fresh" }, tpex: { asOf: tpexAsOf, status: "fresh" } },
  byCode: new Map([[code, {
    code, name: `測試${code}`, exchange: "TWSE", rawDate: D2,
    open: 100, high: 112, low: 100, price: 111,
  }]]),
});

async function runAdvance(code, tpexAsOf) {
  const db = await mod.loadDb();
  db.swingVerification = { [D0]: [pendingEntry(code)] };
  mod.invalidateSwingVerifySummaryCache();
  await mod.advanceSwingVerification(reference(code, tpexAsOf), D2);
  return db.swingVerification[D0][0];
}

test("逐月歷史抓取失敗 → 整檔跳過，絕不寫 dataGap", async () => {
  const entry = await runAdvance("2330", D2);
  assert.equal(entry.status, "pending", "抓不到資料時不可擅自結案");
  assert.equal(entry.lastChecked, D0, "不可前進");
  assert.equal(entry.daysHeld, 0);
  // 這條是關鍵：舊行為會寫下 {from: D1, through: D2}，那是把我方的失敗記成官方的缺漏。
  assert.equal(entry.dataGap, undefined, "抓取失敗不是官方缺 K，不得寫進 dataGap");
});

test("抓取失敗那一輪不節流：上游恢復後同一個資料日仍能推進", async () => {
  // 舊行為：不論結果如何都設 lastSwingAdvanceKey，於是同一個 (twse|tpex) 日期組合
  // 在這個行程內**只會嘗試一次**。上游一次打嗝就要等到隔天或重啟才有第二次機會。
  const first = await runAdvance("2317", "20260709");
  assert.equal(first.status, "pending", "第一次上游還在噴 429");
  assert.equal(first.dataGap, undefined);

  recoveredCodes.add("2317"); // 上游恢復
  // 刻意用**同一組**市場資料日重跑：舊行為會被節流擋在門外，什麼都不做。
  const second = await runAdvance("2317", "20260709");
  assert.equal(second.status, "loss", "同一個資料日必須能再試一次");
  assert.equal(second.resolvedAt, D1, "D1 先破停損 → 結案在 D1");
  assert.equal(second.daysHeld, 1);
  assert.equal(second.dataGap, undefined);
});

test("抓取成功但官方真的缺中間那天 → 照舊停等並記 dataGap（不可被放寬掉）", async () => {
  const entry = await runAdvance("2454", "20260710");
  assert.equal(entry.status, "pending", "官方缺 K 時停在缺口前是刻意設計");
  assert.equal(entry.lastChecked, D0, "不可跳過 D1 直接用 D2 判定");
  assert.deepEqual(
    { from: entry.dataGap?.from, through: entry.dataGap?.through },
    { from: D1, through: D2 },
    "真正的官方缺漏仍要記錄，讓 D-26 的停等揭露看得見",
  );
});
