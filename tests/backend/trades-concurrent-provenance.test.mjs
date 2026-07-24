// 交易寫入在官方商品主檔等待期間仍必須維持 rev 原子性，不能讓同 rev 併發 PUT 都成功。
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { bootServer, pollUntil } from "../helpers/test-server.mjs";
import { compactToday, stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

const AS_OF = compactToday();
let srv;
let releaseTwseEtf;
const twseEtfGate = new Promise((resolve) => { releaseTwseEtf = resolve; });

function tpexEtfPayload(category) {
  const rows = category === "domestic" ? [["006201", "元大富櫃50", "103/03/10"]] : [];
  return {
    date: AS_OF,
    stat: "OK",
    tables: [{
      fields: ["證券代號", "ETF簡稱", "上櫃日期"],
      data: rows,
      totalCount: rows.length,
    }],
  };
}

function record(id) {
  return {
    id,
    code: "00999Z",
    market: "unknown",
    instrumentType: "other",
    instrumentSource: "user",
    side: "buy",
    date: AS_OF,
    tradeDate: AS_OF,
    executedAt: "",
    session: "regular",
    brokerAccountId: "default",
    currency: "TWD",
    price: 100,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
  };
}

before(async () => {
  srv = await bootServer({
    routes: [
      {
        match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap47_L/,
        reply: async () => {
          await twseEtfGate;
          return [{
            "出表日期": AS_OF,
            "基金代號": "0050",
            "基金簡稱": "元大台灣50",
            "基金類型": "國內成分證券指數股票型基金",
            "基金中文名稱": "元大台灣卓越50證券投資信託基金",
            "成立日期": "20030625",
            "上市日期": "20030630",
          }];
        },
      },
      {
        match: /tpex\.org\.tw\/www\/zh-tw\/ETF\/list/,
        reply: (_url, init) => tpexEtfPayload(new URLSearchParams(String(init?.body || "")).get("type") || ""),
      },
      { match: /t187ap03_L/, reply: [] },
      { match: /mopsfin_t187ap03_O/, reply: [] },
      { match: /STOCK_DAY_ALL/, reply: [stockDayAllRow({ code: "2330", name: "台積電", close: 100 })] },
      { match: /tpex_mainboard_daily_close_quotes/, reply: [tpexDailyCloseRow({ code: "5347", name: "世界", close: 100 })] },
    ],
  });
});

after(async () => {
  releaseTwseEtf?.();
  if (srv) {
    srv.mock.restore();
    await srv.close();
  }
});

test("同 rev 的兩個 PUT 即使同時等待官方來源，也只能提交一個", async () => {
  const current = await (await srv.api("/api/trades")).json();
  const body = (id) => JSON.stringify({
    schemaVersion: 2,
    rev: current.rev,
    settings: current.settings,
    records: [record(id)],
  });
  const first = srv.api("/api/trades", { method: "PUT", body: body("writer-a") });
  const second = srv.api("/api/trades", { method: "PUT", body: body("writer-b") });
  await pollUntil(() => srv.mock.callsFor(/t187ap47_L/).length === 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  releaseTwseEtf();

  const responses = await Promise.all([first, second]);
  const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
  await Promise.all(responses.map((response) => response.text()));
  assert.deepEqual(statuses, [200, 409]);

  const saved = await (await srv.api("/api/trades")).json();
  assert.equal(saved.records.length, 1);
  assert.ok(["writer-a", "writer-b"].includes(saved.records[0].id));
});
