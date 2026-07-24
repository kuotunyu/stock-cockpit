// HTTP 整合：資料端點 wiring（watchlists／notes／symbols／看板端點／技術分析／靜態檔防護）。
// 全離線：TWSE/TPEx/Yahoo 上游全 mock。臨時埠。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bootServer } from "../helpers/test-server.mjs";
import {
  compactToday, surveillanceRoutes, fundamentalsRoutes, stockDayAllRow, tpexDailyCloseRow,
  twseNoticeRow, twt48uRow, twseCompanyProfileRow, tpexCompanyProfileRow,
} from "../helpers/fixtures.mjs";

const o = {};
const fo = {}; // 基本面路由 overrides（closure 讀取，可在測試前塞資料）
const realToday = compactToday(0);

// TWSE STOCK_DAY 逐月歷史：只有 2330 有資料，其他代號回空（測資料不足→Yahoo fallback）。
function stockDayMonthRoute() {
  return {
    match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
    reply: (url) => {
      const stockNo = url.searchParams.get("stockNo");
      const monthCompact = String(url.searchParams.get("date") || "");
      if (stockNo !== "2330") return { stat: "OK", data: [] };
      const year = Number(monthCompact.slice(0, 4));
      const month = Number(monthCompact.slice(4, 6));
      const rows = [];
      for (let day = 1; day <= 28; day += 1) {
        const compact = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
        if (compact >= realToday) break; // 不產生今天以後的 K 棒
        const close = 100 + month * 2 + day * 0.3;
        rows.push([
          `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`, // ROC 日期
          "2,500,000",                       // 成交股數
          String(Math.round(close * 2.5e6)), // 成交金額
          (close - 1).toFixed(2),            // 開
          (close + 1.5).toFixed(2),          // 高
          (close - 1.5).toFixed(2),          // 低
          close.toFixed(2),                  // 收
          "0.30",                            // 漲跌
          "1,800",                           // 筆數
        ]);
      }
      return { stat: "OK", data: rows };
    },
  };
}

let srv;
before(async () => {
  o.reference = [
    stockDayAllRow({ code: "2330", name: "台積電", close: 1085 }),
    stockDayAllRow({ code: "1101", name: "台泥", close: 40 }),
  ];
  o.tpexReference = [tpexDailyCloseRow({ code: "5347", name: "世界", close: 120 })];
  o.twseNotice = [twseNoticeRow({ code: "2330", count: 1 })];
  // 除權息預告：2330 今日除息、1101 三天後（quotes 除息旗標測試用；其餘基本面來源留空）
  fo.twt48u = [
    twt48uRow({ code: "2330", exOff: 0, kind: "息", cash: 3 }),
    twt48uRow({ code: "1101", exOff: 3, kind: "息", cash: 1.5 }),
  ];
  fo.twseCompanyMeta = [twseCompanyProfileRow({ code: "2330", name: "台積電" })];
  fo.tpexCompanyMeta = [tpexCompanyProfileRow({ code: "5347", name: "世界" })];
  srv = await bootServer({
    routes: [
      ...surveillanceRoutes(o),
      ...fundamentalsRoutes(fo),
      stockDayMonthRoute(),
      // TPEx 歷史（本檔用不到，回空避免 unmatched throw）
      { match: /www\.tpex\.org\.tw\/www\/zh-tw\/afterTrading\/tradingStock/, reply: { tables: [{ data: [] }] } },
      // Yahoo fallback：回空 → 觸發「資料不足」錯誤路徑
      { match: /query1\.finance\.yahoo\.com/, reply: { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } } },
    ],
  });
});
after(async () => {
  await srv.close();
});

// 必須排第一：後面的 /api/fundamentals 測試會把除息快取暖起來，冷快取契約只能在這裡驗。
test("quotes 除息旗標：冷快取回 null 不擋路；暖了之後 isToday/daysUntil 正確", async () => {
  const cold = await srv.raw("/api/quotes?codes=2330");
  assert.equal(cold.status, 200);
  const coldBody = await cold.json();
  assert.equal(coldBody.quotes[0].dividend, null, "冷快取不得阻塞、旗標先給 null");
  // 直接暖快取（getDividendSchedule 走 mock 路由）
  await srv.mod.getDividendSchedule();
  const warm = await srv.raw("/api/quotes?codes=2330,1101"); // codes 不同 → 不吃 10 秒 quoteCache
  const warmBody = await warm.json();
  const q2330 = warmBody.quotes.find((q) => q.code === "2330");
  const q1101 = warmBody.quotes.find((q) => q.code === "1101");
  assert.equal(q2330.dividend.isToday, true, "今日除息");
  assert.equal(q2330.dividend.cash, 3);
  assert.equal(q2330.dividend.kind, "除息", "TWSE「息」要正規化成「除息」");
  assert.equal(q1101.dividend.isToday, false);
  assert.equal(q1101.dividend.daysUntil, 3);
});

test("quotes：最多 100 個合法代號，非法／超量不准放大成上游請求", async () => {
  const before = srv.mock.calls.length;
  const invalid = await srv.raw(`/api/quotes?codes=${encodeURIComponent("2330<script>")}`);
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /格式不正確/);

  const tooManyCodes = Array.from({ length: 101 }, (_, index) => String(1000 + index)).join(",");
  const tooMany = await srv.raw(`/api/quotes?codes=${tooManyCodes}`);
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /最多 100/);

  const wrongMethod = await srv.raw("/api/quotes?codes=2330", { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(srv.mock.calls.length, before, "驗證失敗與錯誤 method 都不得碰任何外部上游");
});

test("swing：公開讀取不接受錯誤 method，重型 refresh 必須登入", async () => {
  const before = srv.mock.calls.length;
  const wrongMethod = await srv.raw("/api/swing", { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  const anonymousRefresh = await srv.raw("/api/swing?refresh=1");
  assert.equal(anonymousRefresh.status, 401);
  assert.equal((await anonymousRefresh.json()).code, "AUTH_REQUIRED");
  assert.equal(srv.mock.calls.length, before, "被拒絕的重型掃描不得碰上游");
});

test("法人／融資券：日期與代號先驗證，未來日期及錯誤 method 不碰上游", async () => {
  const before = srv.mock.calls.length;
  for (const path of [
    "/api/institutional?date=2099-01-01",
    "/api/margin?date=2026-02-30",
    `/api/institutional?codes=${encodeURIComponent("2330<script>")}`,
  ]) {
    const response = await srv.raw(path);
    assert.equal(response.status, 400, path);
    await response.json();
  }
  const wrongMethod = await srv.raw("/api/margin", { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  await wrongMethod.json();
  assert.equal(srv.mock.calls.length, before, "輸入驗證失敗不得碰官方來源");
});

test("fundamentals：未登入可讀、缺 code → 400、來源全空 → null＋warnings", async () => {
  const missing = await srv.raw("/api/fundamentals");
  assert.equal(missing.status, 400);
  await missing.json();
  const open = await srv.raw("/api/fundamentals?code=2330");
  assert.equal(open.status, 200, "讀取開放未登入（比照 /api/company）");
  const body = await open.json();
  assert.equal(body.ok, true);
  assert.equal(body.code, "2330");
  assert.equal(body.revenue, null);
  assert.equal(body.eps, null);
  assert.equal(body.valuation, null);
  assert.ok(body.warnings.length >= 3, `warnings 應提示來源暫缺：${JSON.stringify(body.warnings)}`);
  assert.ok(body.warnings.some((w) => w.includes("月營收")));
});

test("market-session：免登入、日曆來源失敗仍固定 200；錯誤 method 405", async () => {
  const response = await srv.api("/api/market-session");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.timezone, "Asia/Taipei");
  assert.ok(body.stock && "tradingDay" in body.stock);
  const wrongMethod = await srv.api("/api/market-session", { method: "POST", body: JSON.stringify({}) });
  assert.equal(wrongMethod.status, 405);
});

test("純讀 API：非 GET 必須在任何上游或重型計算前回 405", async () => {
  const paths = [
    "/api/markets",
    "/api/auth/me",
    "/api/sources",
    "/api/overnight",
    "/api/backtest/overnight",
  ];
  const before = srv.mock.calls.length;
  for (const path of paths) {
    const response = await srv.raw(path, { method: "POST", headers: { cookie: srv.cookie } });
    assert.equal(response.status, 405, path);
    await response.json();
  }
  assert.equal(srv.mock.calls.length, before, "錯誤 method 不可啟動任何 fetch");
});

test("alerts：GET 預設空 → PUT（含髒資料清洗）→ GET 往返", async () => {
  const first = await srv.api("/api/alerts");
  assert.equal(first.status, 200);
  assert.deepEqual((await first.json()).alerts, [], "預設應為空清單");

  const put = await srv.api("/api/alerts", {
    method: "PUT",
    body: JSON.stringify({
      alerts: [
        { id: "a1", code: "2330", op: ">=", price: 1080.456, note: "站上前高" },
        { id: "a2", code: "1101", op: "<=", price: 38, active: false, triggeredAt: "2026-07-01T01:00:00.000Z" },
        { id: "a3", code: "00725b", op: ">=", price: 40, note: "英數 ETF 提醒" },
        { id: "bad1", code: "abc", op: ">=", price: 100 },      // 代號不合法 → 清掉
        { id: "bad2", code: "2330", op: ">=", price: -5 },       // 價格不合法 → 清掉
        { id: "a1", code: "2330", op: ">=", price: 999 },        // id 重複 → 清掉
      ],
    }),
  });
  assert.equal(put.status, 200);
  const saved = (await put.json()).alerts;
  assert.equal(saved.length, 3, "髒資料要被清洗掉，合法英數 ETF 必須保留");
  const a1 = saved.find((a) => a.id === "a1");
  assert.equal(a1.price, 1080.46, "價格四捨五入到兩位");
  assert.equal(a1.active, true);
  const a2 = saved.find((a) => a.id === "a2");
  assert.equal(a2.op, "<=");
  assert.equal(a2.active, false);
  assert.ok(a2.triggeredAt.includes("2026-07-01"));
  assert.equal(saved.find((a) => a.id === "a3")?.code, "00725B", "合法英數 ETF 代號要正規化後保存");

  const again = await srv.api("/api/alerts");
  assert.equal((await again.json()).alerts.length, 3, "重新 GET 應拿到持久化後的清單");
});

test("alerts 容量契約：清洗去重後 50 筆可存，51 筆整包 422 且 rev／資料不變", async () => {
  const makeAlert = (index) => ({
    id: `limit-alert-${index}`,
    code: String(4000 + (index % 100)),
    op: index % 2 ? "<=" : ">=",
    price: 50 + index,
    note: `提醒 ${index}`,
  });
  const current = await (await srv.api("/api/alerts")).json();

  const exactResponse = await srv.api("/api/alerts", {
    method: "PUT",
    body: JSON.stringify({
      rev: current.rev,
      alerts: Array.from({ length: 50 }, (_, index) => makeAlert(index)),
    }),
  });
  assert.equal(exactResponse.status, 200, "恰好 50 筆有效提醒應可儲存");
  const exact = await exactResponse.json();
  assert.equal(exact.alerts.length, 50);

  const dirtyResponse = await srv.api("/api/alerts", {
    method: "PUT",
    body: JSON.stringify({
      rev: exact.rev,
      alerts: [
        { id: "invalid-code", code: "---", op: ">=", price: 100 },
        ...Array.from({ length: 50 }, (_, index) => makeAlert(index)),
        makeAlert(0), // 重複 id：清洗去重後仍只有 50 筆
        { id: "invalid-price", code: "4999", op: ">=", price: 0 },
      ],
    }),
  });
  assert.equal(dirtyResponse.status, 200, "raw 超過 50 筆但清洗去重後恰好 50 筆仍應成功");
  const dirty = await dirtyResponse.json();
  assert.equal(dirty.alerts.length, 50);

  const overResponse = await srv.api("/api/alerts", {
    method: "PUT",
    body: JSON.stringify({
      rev: dirty.rev,
      alerts: Array.from({ length: 51 }, (_, index) => makeAlert(index)),
    }),
  });
  assert.equal(overResponse.status, 422, "51 筆 unique 有效提醒不得靜默截成 50 筆");
  const over = await overResponse.json();
  assert.equal(over.code, "VALIDATION_ERROR");

  const after = await (await srv.api("/api/alerts")).json();
  assert.equal(after.rev, dirty.rev, "被拒絕的整包 PUT 不得遞增 rev");
  assert.deepEqual(after.alerts, dirty.alerts, "被拒絕的整包 PUT 不得覆蓋既有提醒");
});

test("trades：GET 預設空 → PUT 往返（回 portfolio）→ 賣超 PUT 被 400 擋下", async () => {
  const first = await srv.api("/api/trades");
  assert.equal(first.status, 200);
  const empty = await first.json();
  assert.deepEqual(empty.records, []);
  assert.equal(empty.settings.feeDiscount, 0.6, "預設 6 折");

  const put = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      settings: { feeDiscount: 0.6, minFee: 20 },
      records: [
        { id: "t1", code: "2330", side: "buy", date: "2026-06-10", price: 100, shares: 1000 },
        { id: "t2", code: "2330", side: "sell", date: "2026-06-20", price: 110, shares: 500 },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.equal(saved.records.length, 2);
  assert.equal(saved.rev, 1, "成功 PUT 後 rev 遞增");
  assert.equal(saved.portfolio.ok, true);
  assert.equal(saved.portfolio.holdings[0].shares, 500);
  assert.equal(saved.portfolio.totals.realizedPnl, 4745, "已實現損益（手算例）");

  // 賣超（把賣單加大）→ 400，且不能蓋掉原本存的資料（帶最新 rev 才會走到驗證）
  const bad = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      rev: saved.rev,
      settings: { feeDiscount: 0.6, minFee: 20 },
      records: [{ id: "t2", code: "2330", side: "sell", date: "2026-06-20", price: 110, shares: 500 }],
    }),
  });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error.includes("賣超"));
  const again = await srv.api("/api/trades");
  const againBody = await again.json();
  assert.equal(againBody.records.length, 2, "被擋下的 PUT 不得覆蓋既有紀錄");

  // 蓋寫防護：帶舊 rev 的 PUT → 409＋目前 rev，資料不動（模擬另一個分頁的過期狀態）
  const stale = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({ rev: 0, settings: { feeDiscount: 0.6, minFee: 20 }, records: [] }),
  });
  assert.equal(stale.status, 409, "舊 rev 要被擋下");
  const staleBody = await stale.json();
  assert.equal(staleBody.code, "REV_CONFLICT");
  assert.equal(staleBody.rev, saved.rev, "409 要帶目前 rev 讓客戶端同步");
  assert.equal((await (await srv.api("/api/trades")).json()).records.length, 2, "409 不得動到資料");
});

test("trades：嚴格 PUT 驗證失敗一律 422，且整包資料與 rev 保持不變", async () => {
  const current = await (await srv.api("/api/trades")).json();
  const validDate = compactToday(-30);
  const baselineResponse = await srv.api("/api/trades", {
    method: "PUT",
    body: JSON.stringify({
      rev: current.rev,
      settings: { feeDiscount: 0.6, minFee: 20 },
      records: [
        { id: "strict-baseline", code: "2330", side: "buy", kind: "stock", date: validDate, price: 100, shares: 1000 },
      ],
    }),
  });
  assert.equal(baselineResponse.status, 200, "測試基準資料應先成功寫入");
  const baseline = await baselineResponse.json();

  const validRecord = (id) => ({
    id,
    code: "1101",
    side: "buy",
    kind: "stock",
    date: validDate,
    price: 40,
    shares: 1,
  });
  const cases = [
    {
      name: "合法與無效紀錄混在同一包",
      records: [validRecord("mixed-valid"), { ...validRecord("mixed-invalid"), shares: 1.5 }],
    },
    {
      name: "records 不是陣列",
      records: { 0: validRecord("not-an-array") },
    },
    {
      name: "超過 500 筆上限",
      records: Array.from({ length: 501 }, (_, index) => validRecord(`bulk-${index}`)),
    },
    {
      name: "未知 side",
      records: [{ ...validRecord("unknown-side"), side: "hold" }],
    },
    {
      name: "未知 kind",
      records: [{ ...validRecord("unknown-kind"), kind: "warrant" }],
    },
    {
      name: "不存在的曆日",
      records: [{ ...validRecord("invalid-calendar-date"), date: "20260230" }],
    },
    {
      name: "台北日期的明日交易",
      records: [{ ...validRecord("future-date"), date: compactToday(1) }],
    },
  ];

  for (const scenario of cases) {
    const rejected = await srv.api("/api/trades", {
      method: "PUT",
      body: JSON.stringify({
        rev: baseline.rev,
        settings: { feeDiscount: 0.6, minFee: 20 },
        records: scenario.records,
      }),
    });
    assert.equal(rejected.status, 422, `${scenario.name} 應被嚴格驗證拒絕`);
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.code, "VALIDATION_ERROR", `${scenario.name} 應回穩定錯誤代碼`);

    const after = await (await srv.api("/api/trades")).json();
    assert.equal(after.rev, baseline.rev, `${scenario.name} 不得遞增 rev`);
    assert.deepEqual(after.records, baseline.records, `${scenario.name} 不得局部覆蓋既有交易紀錄`);
  }
});

test("watchlists：GET 預設 → PUT → GET 往返", async () => {
  const first = await srv.api("/api/watchlists");
  assert.equal(first.status, 200);
  assert.ok((await first.json()).lists, "應回預設清單結構");

  const put = await srv.api("/api/watchlists", {
    method: "PUT",
    body: JSON.stringify({ lists: { 1: ["2330", "0050"], 2: ["00725b"], 3: [] } }),
  });
  assert.equal(put.status, 200);

  const again = await srv.api("/api/watchlists");
  const body = await again.json();
  assert.ok(JSON.stringify(body.lists).includes("2330"), "PUT 後 GET 應包含 2330");
  assert.ok(body.lists[2].includes("00725B"), "合法英數 ETF 應正規化後完整往返");
});

test("watchlists 容量契約：每組清洗去重後 100 檔可存，101 檔整包 422 且 rev／資料不變", async () => {
  const makeCodes = (start, count) => Array.from({ length: count }, (_, index) => String(start + index));
  const exactLists = {
    1: makeCodes(1000, 100),
    2: makeCodes(2000, 100),
    3: makeCodes(3000, 100),
  };
  const current = await (await srv.api("/api/watchlists")).json();

  const exactResponse = await srv.api("/api/watchlists", {
    method: "PUT",
    body: JSON.stringify({ rev: current.rev, lists: exactLists }),
  });
  assert.equal(exactResponse.status, 200, "三組各恰好 100 檔應可儲存");
  const exact = await exactResponse.json();
  assert.deepEqual(Object.values(exact.lists).map((list) => list.length), [100, 100, 100]);

  const dirtyLists = {
    1: ["---", ...exactLists[1], exactLists[1][0], ""],
    2: [...exactLists[2], exactLists[2][1], null],
    3: [undefined, exactLists[3][2], ...exactLists[3]],
  };
  const dirtyResponse = await srv.api("/api/watchlists", {
    method: "PUT",
    body: JSON.stringify({ rev: exact.rev, lists: dirtyLists }),
  });
  assert.equal(dirtyResponse.status, 200, "raw 超過 100 檔但每組清洗去重後恰好 100 檔仍應成功");
  const dirty = await dirtyResponse.json();
  assert.deepEqual(Object.values(dirty.lists).map((list) => list.length), [100, 100, 100]);

  const overResponse = await srv.api("/api/watchlists", {
    method: "PUT",
    body: JSON.stringify({
      rev: dirty.rev,
      lists: { ...dirty.lists, 2: makeCodes(5000, 101) },
    }),
  });
  assert.equal(overResponse.status, 422, "單一分組 101 檔 unique 有效代號不得靜默截成 100 檔");
  const over = await overResponse.json();
  assert.equal(over.code, "VALIDATION_ERROR");

  const after = await (await srv.api("/api/watchlists")).json();
  assert.equal(after.rev, dirty.rev, "被拒絕的整包 PUT 不得遞增 rev");
  assert.deepEqual(after.lists, dirty.lists, "被拒絕的整包 PUT 不得覆蓋任何分組");
});

test("notes：POST（>500 字截斷）→ GET → recent（帶名稱）→ DELETE", async () => {
  const created = await srv.api("/api/notes", {
    method: "POST",
    body: JSON.stringify({ code: "2330", text: "多".repeat(600) }),
  });
  assert.equal(created.status, 201);
  const note = (await created.json()).notes.at(-1);
  assert.equal(note.text.length, 500, "超過 500 字應截斷");
  assert.equal(note.userName.length > 0, true);

  const got = await srv.api("/api/notes?code=2330");
  assert.equal((await got.json()).notes.length, 1);

  const recent = await srv.api("/api/notes/recent");
  const recentNotes = (await recent.json()).notes;
  assert.equal(recentNotes[0].code, "2330");
  assert.equal(recentNotes[0].name, "台積電", "recent 應由 reference 補名稱");

  const missing = await srv.api("/api/notes?code=2330&id=nope", { method: "DELETE" });
  assert.equal(missing.status, 404);
  const del = await srv.api(`/api/notes?code=2330&id=${note.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).notes.length, 0);
});

test("notes：GET 缺 code → 400；POST 空內容 → 400", async () => {
  assert.equal((await srv.api("/api/notes")).status, 400);
  const empty = await srv.api("/api/notes", { method: "POST", body: JSON.stringify({ code: "2330", text: "   " }) });
  assert.equal(empty.status, 400);
});

test("symbols：代號前綴／名稱搜尋／缺 q → 400", async () => {
  const byCode = await srv.api("/api/symbols?q=233");
  const codeResults = (await byCode.json()).results;
  assert.ok(codeResults.some((r) => r.code === "2330"));

  const byName = await srv.api(`/api/symbols?q=${encodeURIComponent("台泥")}`);
  const nameResults = (await byName.json()).results;
  assert.ok(nameResults.some((r) => r.code === "1101"));

  assert.equal((await srv.api("/api/symbols")).status, 400);
});

test("surveillance-board：只允許今日、併發共用 single-flight，任意日期不能污染歷史", async () => {
  const beforePunish = srv.mock.callsFor(/announcement\/punish/).length;
  const [resA, resB] = await Promise.all([
    srv.api("/api/surveillance-board"),
    srv.api("/api/surveillance-board"),
  ]);
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  const body = await resA.json();
  await resB.json();
  assert.equal(body.ok, true);
  for (const key of ["aboutToDispose", "inDisposition", "aboutToRelease", "attention", "blockTrades", "changedTrading"]) {
    assert.ok(key in body.counts, `counts 缺 ${key}`);
  }
  const today = compactToday();
  assert.equal(body.asOf, `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`);
  assert.equal(srv.mock.callsFor(/announcement\/punish/).length - beforePunish, 1, "兩個冷快取請求只抓一次來源");

  for (const invalidDate of ["20990101", compactToday(-30), "not-a-date"]) {
    const invalid = await srv.raw(`/api/surveillance-board?date=${invalidDate}`);
    assert.equal(invalid.status, 400, invalidDate);
    await invalid.json();
  }
  const history = JSON.parse(await (await import("node:fs/promises")).readFile(`${srv.dataDir}/surveillance-history.json`, "utf8"));
  assert.deepEqual(Object.keys(history), [today], "惡意日期不得寫入或淘汰今日快照");
});

test("technical-analysis：官方月 K 齊全 → ok:true、≥30 根", async () => {
  const res = await srv.api("/api/technical-analysis?code=2330&period=day");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true, `error=${body.error}`);
  assert.equal(body.code, "2330");
  assert.ok(Array.isArray(body.candles) && body.candles.length >= 30, `candles=${body.candles?.length}`);
  assert.ok(srv.mock.callsFor(/exchangeReport\/STOCK_DAY\?/).length > 0, "應打過官方月 K");
});

test("technical-analysis：無效代號 → ok:false", async () => {
  const res = await srv.api("/api/technical-analysis?code=xx");
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(body.error.includes("有效的台股代號"));
});

test("technical-analysis：官方無資料＋Yahoo 也空 → ok:false 且確實嘗試過 Yahoo", async () => {
  const res = await srv.api("/api/technical-analysis?code=1101&period=day");
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(srv.mock.callsFor(/query1\.finance\.yahoo/).length > 0, "應嘗試 Yahoo fallback");
});

test("未知 API → 404；OPTIONS → 204", async () => {
  const unknown = await srv.api("/api/no-such-endpoint");
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, "API not found");
  const options = await srv.raw("/api/anything", { method: "OPTIONS" });
  assert.equal(options.status, 204);
});

test("靜態檔：app shell 有安全標頭且只公開 allowlist，後端源碼／套件／測試／資料皆不可讀", async () => {
  const home = await srv.raw("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes("app.js"));
  assert.match(html, /src="lucide\.min\.js"/);
  assert.doesNotMatch(html, /https:\/\/(?:unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "CSP 不應再依賴 inline script");
  const csp = home.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.match(csp, /style-src 'self'(?:;|$)/);
  assert.match(csp, /style-src-attr 'unsafe-inline'/);
  assert.match(csp, /font-src 'self' data:/);
  assert.doesNotMatch(csp, /unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /style-src 'self'[^;]*'unsafe-inline'/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(home.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");

  const lucide = await srv.raw("/lucide.min.js");
  assert.equal(lucide.status, 200);
  assert.equal(lucide.headers.get("content-type"), "application/javascript; charset=utf-8");
  const lucideBody = await lucide.text();
  assert.match(lucideBody, /@license lucide v1\.24\.0 - ISC/);
  const lucideIntegrity = `sha384-${createHash("sha384").update(lucideBody).digest("base64")}`;
  assert.match(html, new RegExp(`integrity=["']${lucideIntegrity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  const styles = await srv.raw("/styles.css");
  assert.doesNotMatch(await styles.text(), /@import|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  for (const weight of ["Medium", "SemiBold", "Bold"]) {
    const plexFont = await srv.raw(`/fonts/IBMPlexMono-${weight}-Latin1.woff2`);
    assert.equal(plexFont.status, 200);
    assert.equal(plexFont.headers.get("content-type"), "font/woff2");
    assert.ok((await plexFont.arrayBuffer()).byteLength > 10_000, `${weight} 自架字型不可是空殼`);
  }
  const worker = await srv.raw("/sw.js");
  const workerBody = await worker.text();
  assert.match(workerBody, /stock1-shell-v\d+/);
  assert.match(workerBody, /\.\/lucide\.min\.js/);
  assert.match(workerBody, /IBMPlexMono-Medium-Latin1\.woff2/);
  assert.match(workerBody, /ignoreSearch:\s*true/);
  assert.match(workerBody, /event\.request\.mode === "navigate"/);
  assert.doesNotMatch(workerBody, /cache\.addAll\(SHELL\)\)\.catch/);

  for (const path of ["/.data/stock1-db.json", "/server.mjs", "/package.json", "/package-lock.json", "/tests/backend/api-data.test.mjs"]) {
    const res = await srv.raw(path);
    assert.equal(res.status, 404, `${path} 不得經 HTTP 讀取`);
    await res.text();
  }
  const head = await srv.raw("/app.js", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await srv.raw("/app.js", { method: "POST" })).status, 405);
});
