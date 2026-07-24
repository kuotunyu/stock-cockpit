// 除權息時程來源韌性：雙市場不能共用「看似完整」的半包快取，撤回／改期也要讓舊公告失效。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installFetchMock } from "../helpers/fetch-mock.mjs";
import { SERVER_PATH } from "../helpers/test-server.mjs";
import {
  compactToday,
  exrightPrepostRow,
  twt48uRow,
} from "../helpers/fixtures.mjs";

let importSequence = 0;

async function withFreshServer(routes, run) {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-dividend-resilience-"));
  const previousDataDir = process.env.DATA_DIR;
  const previousSkipListen = process.env.STOCK1_SKIP_LISTEN;
  process.env.DATA_DIR = dataDir;
  process.env.STOCK1_SKIP_LISTEN = "1";
  const mock = installFetchMock(routes);
  try {
    const serverUrl = pathToFileURL(SERVER_PATH).href;
    const mod = await import(`${serverUrl}?dividend-resilience=${++importSequence}`);
    await run({ mod, mock, dataDir });
  } finally {
    mock.restore();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousSkipListen === undefined) delete process.env.STOCK1_SKIP_LISTEN;
    else process.env.STOCK1_SKIP_LISTEN = previousSkipListen;
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("TPEx 暫時失敗時，TWSE 成功資料不得讓整體半包進入六小時快取", async () => {
  let tpexHealthy = false;
  const twseEvent = twt48uRow({ code: "2330", exOff: 10, cash: 4.5 });
  const tpexEvent = exrightPrepostRow({ code: "5347", exOff: 12, cash: 3.2 });

  await withFreshServer([
    { match: /TWT48U_ALL/, reply: () => [twseEvent] },
    {
      match: /tpex_exright_prepost/,
      reply: () => (tpexHealthy ? [tpexEvent] : { __error: "TPEx dividend source offline" }),
    },
  ], async ({ mod, mock }) => {
    const partial = await mod.getDividendSchedule();
    assert.equal(partial.get("2330")?.[0]?.exDate, compactToday(10));
    assert.equal(partial.has("5347"), false);
    const failedAttemptCalls = mock.callsFor(/tpex_exright_prepost/).length;
    assert.ok(failedAttemptCalls >= 1, "第一次必須真的嘗試 TPEx 來源");

    tpexHealthy = true;
    const recovered = await mod.getDividendSchedule();

    assert.ok(
      mock.callsFor(/tpex_exright_prepost/).length > failedAttemptCalls,
      "另一市場已有成功資料時，失敗的 TPEx 仍必須立刻可重試，不能被整體 TTL 遮蔽",
    );
    assert.equal(recovered.get("2330")?.[0]?.exDate, compactToday(10));
    assert.equal(recovered.get("5347")?.[0]?.exDate, compactToday(12));
  });
});

test("TWSE 暫時失敗時，TPEx 成功資料不得讓整體半包進入六小時快取", async () => {
  let twseHealthy = false;
  const twseEvent = twt48uRow({ code: "2330", exOff: 8, cash: 4.5 });
  const tpexEvent = exrightPrepostRow({ code: "5347", exOff: 9, cash: 3.2 });

  await withFreshServer([
    {
      match: /TWT48U_ALL/,
      reply: () => (twseHealthy ? [twseEvent] : { __error: "TWSE dividend source offline" }),
    },
    { match: /tpex_exright_prepost/, reply: () => [tpexEvent] },
  ], async ({ mod, mock }) => {
    const partial = await mod.getDividendSchedule();
    assert.equal(partial.has("2330"), false);
    assert.equal(partial.get("5347")?.[0]?.exDate, compactToday(9));
    const failedAttemptCalls = mock.callsFor(/TWT48U_ALL/).length;
    assert.ok(failedAttemptCalls >= 1, "第一次必須真的嘗試 TWSE 來源");

    twseHealthy = true;
    const recovered = await mod.getDividendSchedule();

    assert.ok(
      mock.callsFor(/TWT48U_ALL/).length > failedAttemptCalls,
      "另一市場已有成功資料時，失敗的 TWSE 仍必須立刻可重試，不能被整體 TTL 遮蔽",
    );
    assert.equal(recovered.get("2330")?.[0]?.exDate, compactToday(8));
    assert.equal(recovered.get("5347")?.[0]?.exDate, compactToday(9));
  });
});

test("TWSE 有效筆數驟降到 last-good 六成以下時，半包不得覆蓋日程或誤標公告撤回", async () => {
  const originalRows = Array.from({ length: 10 }, (_, index) => twt48uRow({
    code: String(1101 + index),
    exOff: 10 + index,
    cash: 1 + index / 10,
  }));
  const partialRows = originalRows.slice(0, 5);
  let phase = "initial";

  await withFreshServer([
    {
      match: /TWT48U_ALL/,
      reply: () => phase === "initial" ? originalRows : partialRows,
    },
    {
      match: /tpex_exright_prepost/,
      reply: () => [exrightPrepostRow({ code: "5347", exOff: 30, cash: 3.2 })],
    },
  ], async ({ mod, dataDir }) => {
    const seeded = await mod.getDividendSchedule();
    assert.equal(seeded.sourceStatus.TWSE, "fresh");
    assert.equal(
      originalRows.filter((row) => seeded.has(row.Code)).length,
      10,
      "前置條件：同一市場須先建立至少十筆可信的未來公告",
    );

    phase = "partial";
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6 * 3600e3 + 1;
    let guarded;
    try {
      guarded = await mod.getDividendSchedule();
    } finally {
      Date.now = realDateNow;
    }

    assert.equal(
      guarded.sourceStatus.TWSE,
      "stale",
      "HTTP 200 但有效未來筆數只剩 50% 時，來源必須標 stale 而不是 fresh",
    );
    assert.deepEqual(
      originalRows.map((row) => row.Code).filter((code) => guarded.has(code)),
      originalRows.map((row) => row.Code),
      "疑似半包不得覆蓋 TWSE last-good，十筆原公告都要繼續供應",
    );

    const disk = JSON.parse(await readFile(join(dataDir, "fundamentals-cache.json"), "utf8"));
    for (const [index, row] of originalRows.slice(5).entries()) {
      const exDate = compactToday(15 + index);
      assert.equal(
        disk.dividends[row.Code]?.[exDate]?.status,
        "active",
        `半包缺漏的 ${row.Code} 只是不可信，不能被誤判成 withdrawn`,
      );
    }
  });
});

test("已過期公告不計入半包分母，合法只保留未來公告時仍要接受為 fresh", async () => {
  const expiredRows = Array.from({ length: 10 }, (_, index) => twt48uRow({
    code: String(1201 + index),
    exOff: -20 + index,
    cash: 0.5 + index / 10,
  }));
  const futureRows = Array.from({ length: 5 }, (_, index) => twt48uRow({
    code: String(1301 + index),
    exOff: 10 + index,
    cash: 2 + index / 10,
  }));
  const refreshedFutureRows = futureRows.map((row, index) => (
    index === 0 ? { ...row, CashDividend: "9.9" } : row
  ));
  let phase = "initial";

  await withFreshServer([
    {
      match: /TWT48U_ALL/,
      reply: () => phase === "initial"
        ? [...expiredRows, ...futureRows]
        : refreshedFutureRows,
    },
    {
      match: /tpex_exright_prepost/,
      reply: () => [exrightPrepostRow({ code: "5347", exOff: 30, cash: 3.2 })],
    },
  ], async ({ mod }) => {
    const seeded = await mod.getDividendSchedule();
    assert.equal(seeded.sourceStatus.TWSE, "fresh");
    assert.equal(
      expiredRows.some((row) => seeded.has(row.Code)),
      false,
      "前置條件：已過期公告不得進入未來日程 last-good",
    );
    assert.equal(futureRows.filter((row) => seeded.has(row.Code)).length, 5);

    phase = "future-only";
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6 * 3600e3 + 1;
    let refreshed;
    try {
      refreshed = await mod.getDividendSchedule();
    } finally {
      Date.now = realDateNow;
    }

    assert.equal(
      refreshed.sourceStatus.TWSE,
      "fresh",
      "十筆舊公告已過期時，不得拿十五筆歷史總量當分母誤擋合法快照",
    );
    assert.equal(
      refreshed.get(futureRows[0].Code)?.[0]?.cashDividend,
      9.9,
      "更新後的未來公告內容要生效，證明新快照確實獲接受而非沿用 last-good",
    );
  });
});

test("後續完整公告撤回或改期時，舊未來事件保留稽核紀錄但不得再被當成有效公司行為", async () => {
  const withdrawnDate = compactToday(10);
  const originalRescheduledDate = compactToday(12);
  const revisedDate = compactToday(16);
  let phase = "initial";

  await withFreshServer([
    {
      match: /TWT48U_ALL/,
      reply: () => phase === "initial"
        ? [
            twt48uRow({ code: "2330", exOff: 10, cash: 4.5 }),
            twt48uRow({ code: "2317", exOff: 12, cash: 2.1 }),
          ]
        : [
            // 2330 已從完整公告撤回；2317 則由原日期改到新日期。
            twt48uRow({ code: "2317", exOff: 16, cash: 2.1 }),
            twt48uRow({ code: "1101", exOff: 20, cash: 1.4 }),
          ],
    },
    {
      match: /tpex_exright_prepost/,
      reply: () => [exrightPrepostRow({ code: "5347", exOff: 18, cash: 3.2 })],
    },
  ], async ({ mod, dataDir }) => {
    const initial = await mod.getDividendSchedule();
    assert.equal(initial.get("2330")?.[0]?.exDate, withdrawnDate);
    assert.equal(initial.get("2317")?.[0]?.exDate, originalRescheduledDate);
    assert.deepEqual(
      mod.corporateActionHistoryForCode("2330", compactToday(), compactToday(30)).map((item) => item.exDate),
      [withdrawnDate],
    );

    phase = "revised";
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 6 * 3600e3 + 1;
    try {
      const revised = await mod.getDividendSchedule();
      assert.equal(revised.has("2330"), false, "完整新公告已撤回 2330，日程不可沿用舊值");
      assert.deepEqual(revised.get("2317")?.map((item) => item.exDate), [revisedDate]);
    } finally {
      Date.now = realDateNow;
    }

    assert.deepEqual(
      mod.corporateActionHistoryForCode("2330", compactToday(), compactToday(30)),
      [],
      "已撤回的未來公告不得再參與官方還原權息",
    );
    assert.deepEqual(
      mod.corporateActionHistoryForCode("2317", compactToday(), compactToday(30)).map((item) => item.exDate),
      [revisedDate],
      "改期後只允許新日期參與官方還原權息",
    );

    const disk = JSON.parse(await readFile(join(dataDir, "fundamentals-cache.json"), "utf8"));
    assert.equal(
      disk.dividends["2330"]?.[withdrawnDate]?.status,
      "withdrawn",
      "撤回事件要留在歸檔供稽核，但必須明確標成 withdrawn",
    );
    assert.equal(
      disk.dividends["2317"]?.[originalRescheduledDate]?.status,
      "withdrawn",
      "改期前的舊日期要留在歸檔，但必須明確標成 withdrawn",
    );
    assert.equal(disk.dividends["2317"]?.[revisedDate]?.status, "active", "改期後的新公告才是 active");
  });
});
