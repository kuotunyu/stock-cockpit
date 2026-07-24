import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const TPEX_CATEGORIES = ["domestic", "foreign", "bond", "futures", "leveraged", "active", "multi"];
const TPEX_FIELDS = ["證券代號", "ETF簡稱", "上櫃日期"];
const TWSE_CODES = Array.from({ length: 12 }, (_, index) => String(50 + index).padStart(4, "0"));
const TPEX_CODES = Array.from({ length: 12 }, (_, index) => String(6200 + index).padStart(6, "0"));

function twseRows(namePrefix) {
  return TWSE_CODES.map((code, index) => ({
    出表日期: "20260713",
    基金代號: code,
    基金簡稱: `${namePrefix}${index + 1}`,
    基金類型: "國內成分證券指數股票型基金",
    基金中文名稱: `${namePrefix}${index + 1}基金`,
    成立日期: "20191201",
    上市日期: "20200101",
  }));
}

function tpexPayload(category, size = TPEX_CODES.length) {
  const data = category === "domestic"
    ? TPEX_CODES.slice(0, size).map((code, index) => [code, `上櫃基金${index + 1}`, "2020/01/01"])
    : [];
  return {
    stat: "ok",
    date: "20260713",
    tables: [{
      title: category,
      totalCount: data.length,
      fields: TPEX_FIELDS,
      data,
    }],
  };
}

const realNow = Date.now;
let clock = Date.parse("2026-07-13T00:00:00Z");
Date.now = () => clock;

let phase = "initial";
let releaseInitialTwse;
const initialTwseGate = new Promise((resolve) => { releaseInitialTwse = resolve; });

const { mod, mock, dataDir } = await importServer({
  routes: [
    {
      match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap47_L/,
      reply: async () => {
        if (phase === "initial") await initialTwseGate;
        return twseRows(phase === "initial" ? "上市基金" : "更新基金");
      },
    },
    {
      match: /tpex\.org\.tw\/www\/zh-tw\/ETF\/list/,
      reply: (_url, init) => {
        const body = new URLSearchParams(String(init?.body || ""));
        const category = body.get("type");
        if (!TPEX_CATEGORIES.includes(category)) return { __error: `unexpected TPEx category: ${category}` };
        if (phase === "tpex-down" && category === "active") return { __error: "tpex maintenance" };
        return tpexPayload(category, phase === "tpex-shrunk" ? 6 : TPEX_CODES.length);
      },
    },
  ],
});

after(async () => {
  releaseInitialTwse();
  Date.now = realNow;
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

function tpexCalls() {
  return mock.callsFor(/tpex\.org\.tw\/www\/zh-tw\/ETF\/list/);
}

function callsForTpexCategory(category) {
  return tpexCalls().filter((call) => new URLSearchParams(String(call.body || "")).get("type") === category);
}

test("商品主檔 cold single-flight、24h cache、last-good 與縮水防護", async () => {
  const pending = Array.from({ length: 20 }, () => mod.getProductDirectory());
  await new Promise((resolve) => setImmediate(resolve));

  try {
    assert.equal(mock.callsFor(/t187ap47_L/).length, 1, "並發冷啟動只抓一次 TWSE");
    assert.equal(tpexCalls().length, TPEX_CATEGORIES.length, "並發冷啟動只抓一次 TPEx 各分類");
    for (const category of TPEX_CATEGORIES) {
      assert.equal(callsForTpexCategory(category).length, 1, `TPEx ${category} 只送出一次`);
    }
    assert.ok(tpexCalls().every((call) => call.method === "POST"), "TPEx 商品清單必須使用 POST");
    const bondBody = new URLSearchParams(String(callsForTpexCategory("bond")[0].body));
    assert.equal(bondBody.get("bondType"), "0", "債券 ETF 必須請求完整 bondType=0 清單");
    const multiBody = new URLSearchParams(String(callsForTpexCategory("multi")[0].body));
    assert.equal(multiBody.get("type"), "multi");
  } finally {
    releaseInitialTwse();
  }

  const results = await Promise.all(pending);
  assert.ok(results.every((result) => result === results[0]), "並發呼叫共用同一個 aggregate 結果");
  const first = results[0];
  assert.equal(first.coverageComplete, true, JSON.stringify({ markets: first.markets, warnings: first.warnings }));
  assert.deepEqual(first.counts, { twse: 12, tpex: 12 });
  assert.equal(first.markets.twse.status, "fresh");
  assert.equal(first.markets.tpex.status, "fresh");

  phase = "tpex-down";
  clock += DAY_MS - 1;
  const cached = await mod.getProductDirectory();
  assert.equal(cached, first, "24 小時 TTL 內應直接回傳同一份快取");
  assert.equal(mock.callsFor(/t187ap47_L/).length, 1);
  assert.equal(tpexCalls().length, 7);

  clock += 2;
  const degraded = await mod.getProductDirectory();
  assert.equal(degraded.coverageComplete, false);
  assert.equal(degraded.markets.twse.status, "fresh");
  assert.equal(degraded.markets.tpex.status, "stale");
  assert.deepEqual(degraded.counts, { twse: 12, tpex: 12 });
  assert.equal(degraded.byCode.get(TWSE_CODES[0]).name, "更新基金1", "健康市場仍應正常更新");
  assert.equal(degraded.byCode.has(TPEX_CODES.at(-1)), true, "失敗市場必須沿用 last-good");
  assert.equal(mock.callsFor(/t187ap47_L/).length, 2);
  assert.equal(tpexCalls().length, 14);

  clock += RETRY_MS - 1;
  const retryCached = await mod.getProductDirectory();
  assert.equal(retryCached, degraded, "短 retry TTL 內不可反覆重打失敗來源");
  assert.equal(mock.callsFor(/t187ap47_L/).length, 2);
  assert.equal(tpexCalls().length, 14);

  phase = "tpex-shrunk";
  clock += 2;
  const shrunk = await mod.getProductDirectory();
  assert.equal(shrunk.markets.twse.status, "fresh");
  assert.equal(shrunk.markets.tpex.status, "stale", "低於 last-good 60% 的半包資料必須拒絕");
  assert.deepEqual(shrunk.counts, { twse: 12, tpex: 12 });
  assert.equal(shrunk.byCode.has(TPEX_CODES.at(-1)), true, "縮水回應不可覆蓋完整 last-good");
  assert.ok(shrunk.warnings.some((warning) => warning.includes("60%")));
  assert.equal(mock.callsFor(/t187ap47_L/).length, 2, "仍新鮮的 TWSE 不需陪同重抓");
  assert.equal(tpexCalls().length, 21, "retry 到期後 TPEx 各分類只重抓一次");

  const shrinkRetryCached = await mod.getProductDirectory();
  assert.equal(shrinkRetryCached, shrunk);
  assert.equal(tpexCalls().length, 21, "縮水失敗後也必須套用短 retry TTL");
});
