// 官方 ETF 商品主檔 parser：分類優先序、雙市場去重與上游欄位契約防護。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, rocCompact, rocSlash } from "../helpers/fixtures.mjs";

const { mod, mock, dataDir } = await importServer();
const {
  PRODUCT_DIRECTORY_RULE_VERSION,
  classifyOfficialEtf,
  parseTwseEtfDirectorySnapshot,
  parseTpexEtfCategory,
  parseTpexEtfDirectorySnapshot,
} = mod;

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const asOf = compactToday();
const priorDate = compactToday(-1);
const twseReportDate = rocCompact(asOf);
const twseListingDate = rocCompact(compactToday(-30));
const tpexListingDate = rocSlash(compactToday(-30));
const tpexFields = ["證券代號", "ETF簡稱", "上櫃日期"];

function twseEtfRow({ code, fundType, name = `測試${code}`, reportDate = twseReportDate }) {
  return {
    出表日期: reportDate,
    基金代號: code,
    基金簡稱: name,
    基金中文名稱: `${name}證券投資信託基金`,
    基金類型: fundType,
    成立日期: twseListingDate,
    上市日期: twseListingDate,
  };
}

function tpexEtfRow(code, name = `測試${code}`) {
  return [code, name, tpexListingDate];
}

function tpexPayload({
  date = asOf,
  rows = [],
  fields = tpexFields,
  totalCount = rows.length,
  stat = rows.length ? "ok" : "暫無相關商品",
} = {}) {
  return {
    date,
    stat,
    tables: [{ fields, totalCount, data: rows }],
  };
}

function tpexDirectoryPayloads() {
  return {
    domestic: tpexPayload({ rows: [tpexEtfRow("006201", "元大富櫃50")] }),
    foreign: tpexPayload({ rows: [tpexEtfRow("00998A", "主動外國股票")] }),
    bond: tpexPayload({ rows: [
      tpexEtfRow("00725B", "國泰投資級公司債"),
      tpexEtfRow("00980D", "主動債券"),
    ] }),
    futures: tpexPayload(),
    leveraged: tpexPayload({ rows: [tpexEtfRow("00631L", "台灣50正2")] }),
    active: tpexPayload({ rows: [
      tpexEtfRow("00998A", "主動外國股票"),
      tpexEtfRow("00980D", "主動債券"),
    ] }),
    multi: tpexPayload({ rows: [tpexEtfRow("00981T", "多資產ETF")] }),
  };
}

test("classifyOfficialEtf：active 優先 bond，槓反優先期貨，B/C 與 T/U 依規格分類", () => {
  assert.equal(
    classifyOfficialEtf("00980D", { memberships: ["bond", "active"] }),
    "activeEtf",
  );
  assert.equal(
    classifyOfficialEtf("00999B", { fundType: "國外成分證券主動式交易所交易基金(債券)" }),
    "activeEtf",
  );
  assert.equal(
    classifyOfficialEtf("00716R", { fundType: "指數股票型期貨信託基金" }),
    "leveragedInverseEtf",
  );
  assert.equal(classifyOfficialEtf("00725B"), "bondIndexEtf");
  assert.equal(classifyOfficialEtf("00687C"), "bondIndexEtf");
  assert.equal(classifyOfficialEtf("00981T"), "otherEtf");
  assert.equal(classifyOfficialEtf("00635U"), "otherEtf");
});

test("parseTwseEtfDirectorySnapshot：套用官方類型與 suffix 優先序並保留 provenance", () => {
  const snapshot = parseTwseEtfDirectorySnapshot([
    twseEtfRow({ code: "00400A", fundType: "國內成分證券主動式交易所交易基金(股票)" }),
    twseEtfRow({ code: "00716R", fundType: "指數股票型期貨信託基金" }),
    twseEtfRow({ code: "00710B", fundType: "國外成分證券指數股票型基金" }),
    twseEtfRow({ code: "00687C", fundType: "國外成份/加掛外幣證券指數股票型基金" }),
    twseEtfRow({ code: "00981T", fundType: "國外成分證券平衡型指數股票型基金" }),
    twseEtfRow({ code: "00635U", fundType: "指數股票型期貨信託基金" }),
    twseEtfRow({ code: "0050", fundType: "國內成分證券指數股票型基金", name: "元大台灣50" }),
  ]);

  assert.equal(snapshot.asOf, asOf);
  assert.equal(snapshot.count, 7);
  assert.equal(snapshot.validCount, 7);
  assert.equal(snapshot.byCode.get("00400A").instrumentType, "activeEtf");
  assert.equal(snapshot.byCode.get("00716R").instrumentType, "leveragedInverseEtf");
  assert.equal(snapshot.byCode.get("00710B").instrumentType, "bondIndexEtf");
  assert.equal(snapshot.byCode.get("00687C").instrumentType, "bondIndexEtf");
  assert.equal(snapshot.byCode.get("00981T").instrumentType, "otherEtf");
  assert.equal(snapshot.byCode.get("00635U").instrumentType, "otherEtf");
  assert.equal(snapshot.byCode.get("0050").instrumentType, "equityEtf");
  assert.deepEqual(snapshot.byCode.get("0050").memberships, []);
  assert.equal(snapshot.byCode.get("0050").instrumentSource, "official");
  assert.equal(
    snapshot.byCode.get("0050").instrumentRuleId,
    `${PRODUCT_DIRECTORY_RULE_VERSION}:twse-t187ap47`,
  );
  assert.equal(snapshot.byCode.get("0050").instrumentAsOf, asOf);
});

test("parseTwseEtfDirectorySnapshot：拒絕同一快照混用不同資料日", () => {
  assert.throws(
    () => parseTwseEtfDirectorySnapshot([
      twseEtfRow({ code: "0050", fundType: "國內成分證券指數股票型基金" }),
      twseEtfRow({
        code: "0051",
        fundType: "國內成分證券指數股票型基金",
        reportDate: rocCompact(priorDate),
      }),
    ]),
    /資料日不一致/,
  );
});

test("parseTpexEtfCategory：空 futures 合法，欄位與 totalCount 漂移會拒絕", () => {
  assert.deepEqual(parseTpexEtfCategory("futures", tpexPayload()), {
    category: "futures",
    asOf,
    totalCount: 0,
    rows: [],
  });

  assert.throws(
    () => parseTpexEtfCategory("domestic", tpexPayload({
      rows: [tpexEtfRow("006201")],
      fields: ["代號", "ETF簡稱", "上櫃日期"],
    })),
    /欄位契約已變更/,
  );
  assert.throws(
    () => parseTpexEtfCategory("domestic", tpexPayload({
      rows: [tpexEtfRow("006201")],
      totalCount: 2,
    })),
    /筆數與 totalCount 不一致/,
  );
});

test("parseTpexEtfDirectorySnapshot：七分類去重，bond+active 以 active 為準", () => {
  const snapshot = parseTpexEtfDirectorySnapshot(tpexDirectoryPayloads());

  assert.equal(snapshot.asOf, asOf);
  assert.equal(snapshot.count, 8);
  assert.equal(snapshot.validCount, 6);
  assert.deepEqual(snapshot.byCode.get("00980D").memberships, ["bond", "active"]);
  assert.equal(snapshot.byCode.get("00980D").officialCategory, "bond+active");
  assert.equal(snapshot.byCode.get("00980D").instrumentType, "activeEtf");
  assert.deepEqual(snapshot.byCode.get("00998A").memberships, ["foreign", "active"]);
  assert.equal(snapshot.byCode.get("00998A").instrumentType, "activeEtf");
  assert.equal(snapshot.byCode.get("00725B").instrumentType, "bondIndexEtf");
  assert.equal(snapshot.byCode.get("00631L").instrumentType, "leveragedInverseEtf");
  assert.equal(snapshot.byCode.get("00981T").instrumentType, "otherEtf");
  assert.equal(
    snapshot.byCode.get("00725B").instrumentRuleId,
    `${PRODUCT_DIRECTORY_RULE_VERSION}:tpex-etf-list`,
  );
});

test("parseTpexEtfDirectorySnapshot：拒絕七分類資料日不一致", () => {
  const payloads = tpexDirectoryPayloads();
  payloads.multi = tpexPayload({
    date: priorDate,
    rows: [tpexEtfRow("00981T", "多資產ETF")],
  });

  assert.throws(
    () => parseTpexEtfDirectorySnapshot(payloads),
    /各分類資料日不一致/,
  );
});
