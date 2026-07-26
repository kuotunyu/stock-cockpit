// 整批收盤檔在除權息日把「漲跌」欄設成 "0.0000"——一個**可以正常解析的零**，不是遮罩。
// 於是 previousClose 被算成「今天的收盤」、漲跌變成 0.00%，看起來就像正常的平盤日。
//
// 2026-07-24 實機：13 檔被這樣呈現，實際相對官方參考價是 -9.21%（松川精密）到 +8.80%（永道-KY）。
// 接近跌停／漲停的日子被畫成平盤中性灰。台股慣例是除權息日的漲跌以除權息參考價為基準
// （交易所與券商都這樣報），所以 0.00% 不是不精確，是錯的。
//
// 關鍵風險：**真正的平盤日同樣回 "0.0000"**，所以一定要靠官方事件表判斷，
// 不能看到 0 就當成除權息。這幾條把兩邊都釘住。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const resultRow = (date, code, preClose, ref, kind) =>
  [date, code, "測試", String(preClose), String(ref), "0", kind, "0", "0", String(ref), String(ref), "", "", "", ""];

const { mod, mock, dataDir } = await importServer({
  routes: [{
    match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/,
    reply: (url) => (String(url.searchParams.get("startDate") || "").startsWith("202607")
      ? { stat: "OK", data: [resultRow("115年07月24日", "2002", 19.1, 18.95, "息")] }
      : { stat: "OK", data: [] }),
  }],
});
await mod.loadCorporateActionResultMonth("202607");
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

// normalizeDailyTwse 的輸出形狀
const quote = (over = {}) => ({
  code: "2002", name: "中鋼", exchange: "TWSE", source: "TWSE OpenAPI", sourceKind: "daily-close",
  asOf: "2026/07/24", rawDate: "1150724",
  price: 19.15, previousClose: 19.15, change: 0, changePct: 0,
  open: 19, high: 19.2, low: 18.9, volumeLots: 50000, ...over,
});

test("除權息日的可解析零 → 改用官方參考價當基準", () => {
  const out = mod.applyCorporateActionQuoteBaseline(quote());
  assert.equal(out.previousClose, 18.95, "昨收要換成官方除權息參考價");
  assert.ok(Math.abs(out.change - 0.2) < 1e-9, `漲跌＝19.15 − 18.95（實際 ${out.change}）`);
  assert.ok(Math.abs(out.changePct - 1.0554) < 0.001, `漲跌幅約 +1.06%（實際 ${out.changePct}）`);
  assert.equal(out.corporateActionBaseline, true, "要標明這個漲跌是相對參考價算的");
});

test("真正的平盤日同樣回 0.0000，不得被當成除權息", () => {
  // 同一檔、同樣 change:0，但日期不是除權息日 → 官方事件表查無 → 一律不動。
  const out = mod.applyCorporateActionQuoteBaseline(quote({ asOf: "2026/07/23", rawDate: "1150723" }));
  assert.equal(out.previousClose, 19.15, "沒有官方事件就不能自作主張改基準");
  assert.equal(out.change, 0);
  assert.ok(!out.corporateActionBaseline);

  // 代號不同也一樣（結果表裡只有 2002）
  const other = mod.applyCorporateActionQuoteBaseline(quote({ code: "2330", name: "台積電" }));
  assert.equal(other.previousClose, 19.15);
  assert.ok(!other.corporateActionBaseline);
});

test("漲跌欄不是零時完全不介入（絕大多數的日子）", () => {
  const out = mod.applyCorporateActionQuoteBaseline(quote({ change: -0.5, previousClose: 19.65, changePct: -2.54 }));
  assert.equal(out.previousClose, 19.65, "有正常漲跌值的日子不該被碰");
  assert.equal(out.change, -0.5);
  assert.ok(!out.corporateActionBaseline);
});

test("價格缺值或非正數時不得算出假的漲跌幅", () => {
  for (const bad of [null, 0, -1, undefined]) {
    const out = mod.applyCorporateActionQuoteBaseline(quote({ price: bad }));
    assert.equal(out.previousClose, 19.15, `price=${bad} 時不得改動`);
    assert.ok(!out.corporateActionBaseline);
  }
  assert.equal(mod.applyCorporateActionQuoteBaseline(null), null, "null 進 null 出，不得炸掉");
});

test("官方結果表沒抓到時維持原值（降級由掃描端揭露）", () => {
  // 2026-06 那個月在路由裡回空 → 查無事件 → 不動。
  const out = mod.applyCorporateActionQuoteBaseline(quote({ asOf: "2026/06/24", rawDate: "1150624" }));
  assert.equal(out.previousClose, 19.15);
  assert.ok(!out.corporateActionBaseline);
});
