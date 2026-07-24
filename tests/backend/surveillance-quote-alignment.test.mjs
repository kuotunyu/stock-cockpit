// 處置看板行情對齊：個股整批收盤列落後時，以同檔 MIS 覆蓋，且保留逐檔日期語意。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday,
  surveillanceRoutes,
  twsePunishRow,
  stockDayAllRow,
  misQuoteRow,
} from "../helpers/fixtures.mjs";

const o = {
  reference: [
    stockDayAllRow({ code: "8033", name: "雷虎", close: 227, volume: 6_201_224, dateOff: -4 }),
    stockDayAllRow({ code: "3189", name: "景碩", close: 795, volume: 2_570_000, dateOff: -1 }),
  ],
  tpexReference: [],
  twsePunish: [
    twsePunishRow({ code: "8033", startOff: -5, endOff: 3 }),
    twsePunishRow({ code: "3189", startOff: -5, endOff: 3 }),
  ],
  misQuotes: [
    misQuoteRow({ code: "8033", name: "雷虎", z: 249.5, y: 227, o: 235, h: 249.5, l: 235, s: 185, v: 6207, dateOff: -1 }),
    misQuoteRow({ code: "3189", name: "景碩", z: 819, y: 795, o: 838, h: 838, l: 815, s: 352, v: 3275, dateOff: -1 }),
  ],
};

const { mod } = await importServer({ routes: surveillanceRoutes(o) });

test("STOCK_DAY_ALL 個股舊列不得讓左卡停在舊價，應與右側 MIS 對齊", async () => {
  const board = await mod.getSurveillanceBoard(compactToday());
  const tiger = board.inDisposition.find((item) => item.code === "8033");
  const kinik = board.inDisposition.find((item) => item.code === "3189");

  assert.ok(tiger);
  assert.equal(tiger.price, 249.5);
  assert.equal(tiger.changePct, 9.91);
  assert.equal(tiger.volumeLots, 6207);
  assert.equal(tiger.quoteSourceKind, "realtime");
  assert.equal(tiger.quoteAsOf, compactToday(-1).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"));
  assert.equal(tiger.quoteDateMismatch, false);
  assert.equal(tiger.quoteLagging, false);

  assert.equal(kinik.price, 819);
  assert.equal(kinik.changePct, 3.02);
  assert.equal(board.quoteAsOf, tiger.quoteAsOf);
});
