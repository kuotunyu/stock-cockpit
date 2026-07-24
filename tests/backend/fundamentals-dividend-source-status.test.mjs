// 基本面除權息來源狀態：逐市場失敗時，不能把 last-good 冒充即時資料，
// 也不能在來源完全不可用時，用空陣列讓使用者誤以為已確認「沒有股利」。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installFetchMock } from "../helpers/fetch-mock.mjs";
import { SERVER_PATH } from "../helpers/test-server.mjs";
import {
  compactToday,
  exrightPrepostRow,
  fundamentalsRoutes,
  tpexCompanyProfileRow,
  twseCompanyProfileRow,
  twt48uRow,
} from "../helpers/fixtures.mjs";

let importSequence = 0;

async function withFreshServer(overrides, run) {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-fund-dividend-status-"));
  const previousDataDir = process.env.DATA_DIR;
  const previousSkipListen = process.env.STOCK1_SKIP_LISTEN;
  process.env.DATA_DIR = dataDir;
  process.env.STOCK1_SKIP_LISTEN = "1";
  const mock = installFetchMock(fundamentalsRoutes(overrides));
  try {
    const serverUrl = pathToFileURL(SERVER_PATH).href;
    const mod = await import(`${serverUrl}?fund-dividend-status=${++importSequence}`);
    await run({ mod, mock });
  } finally {
    mock.restore();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousSkipListen === undefined) delete process.env.STOCK1_SKIP_LISTEN;
    else process.env.STOCK1_SKIP_LISTEN = previousSkipListen;
    await rm(dataDir, { recursive: true, force: true });
  }
}

function healthyBase(overrides = {}) {
  return {
    twseRevenue: [],
    tpexRevenue: [],
    twseEps: [],
    tpexEps: [],
    bwibbu: [],
    tpexPeratio: [],
    twt48u: [twt48uRow({ code: "2330", exOff: 10, cash: 4.5 })],
    tpexExright: [exrightPrepostRow({ code: "5347", exOff: 12, cash: 3.2 })],
    twseCompanyMeta: [twseCompanyProfileRow({ code: "2330", name: "台積電" })],
    tpexCompanyMeta: [tpexCompanyProfileRow({ code: "5347", name: "世界" })],
    ...overrides,
  };
}

test("上市除權息更新失敗但有 last-good：保留公告、標 stale 並明示沿用", async () => {
  const upstream = healthyBase();

  await withFreshServer(upstream, async ({ mod }) => {
    const seeded = await mod.getDividendSchedule();
    assert.equal(seeded.sourceStatus.TWSE, "fresh", "前置條件：上市來源先成功建立 last-good");
    assert.equal(seeded.get("2330")?.[0]?.exDate, compactToday(10));

    upstream.twt48u = { __error: "TWSE dividend source offline" };
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6 * 3600e3 + 1;
    let result;
    try {
      result = await mod.buildFundamentals("2330");
    } finally {
      Date.now = realDateNow;
    }

    assert.equal(result.dividends.length, 1, "來源暫時失敗仍應保留該市場最後成功公告");
    assert.equal(result.dividends[0].exDate, compactToday(10));
    assert.equal(result.dividends[0].cashDividend, 4.5);
    assert.equal(result.dividends[0].source, "TWSE");
    assert.equal(
      result.freshness.dividends.status,
      "stale",
      "來自 stale 市場快取的公告不可因資料仍存在就標成 fresh",
    );
    assert.ok(
      result.warnings.some((warning) => /上市|TWSE/.test(warning) && /沿用/.test(warning)),
      "warning 應指出受影響市場，並明說目前沿用最後成功資料",
    );
  });
});

test("上市除權息來源 unavailable 且無資料：必須明示無法確認，不得宣稱沒有股利", async () => {
  const upstream = healthyBase({
    twt48u: { __error: "TWSE dividend source offline" },
  });

  await withFreshServer(upstream, async ({ mod }) => {
    const result = await mod.buildFundamentals("2330");

    assert.deepEqual(result.dividends, [], "沒有可沿用資料時維持既有 response shape");
    assert.equal(result.freshness.dividends.status, "unavailable");
    assert.ok(
      result.warnings.some((warning) => (
        /上市|TWSE/.test(warning)
        && /除權息|股利/.test(warning)
        && /無法確認|無法判定|不可確認|來源.*不可用|抓取失敗/.test(warning)
      )),
      "warning 應清楚說明上市除權息來源不可用，因此目前無法確認是否有公告",
    );
    assert.equal(
      result.warnings.some((warning) => /沒有股利|無股利|無除權息|查無.*(?:股利|除權息)/.test(warning)),
      false,
      "來源不可用不等於已確認沒有股利",
    );
  });
});
