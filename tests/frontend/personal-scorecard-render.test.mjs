// 庫存損益頁的「我的成績單」與交割款：資料由伺服器算好，前端只呈現；CSV 匯出含 BOM、CRLF、RFC 4180 跳脫。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));
const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "").slice(0, 6);
const thisYear = thisMonth.slice(0, 4);

function seed() {
  app.evalIn(`
    tradesState.records = [
      { id: "b1", code: "2330", side: "buy", price: 100, shares: 1000, fee: 85, tax: 0, date: "20260803", session: "regular", instrumentType: "stock" },
      { id: "s1", code: "2330", side: "sell", price: 110, shares: 1000, fee: 94, tax: 330, date: "20260815", session: "regular", instrumentType: "stock" },
    ];
    tradesState.portfolio = { ok: true, holdings: [], realized: [
      { id: "s1", code: "2330", date: "20260815", shares: 1000, sellPrice: 110, avgCost: 100.09, grossProceeds: 110000, fee: 94, tax: 330, netProceeds: 109576, costOfSold: 100085, pnl: 9491, pnlPct: 9.48 },
    ], totals: { cost: 0, realizedPnl: 9491, buyFees: 85, sellFees: 94, securitiesTax: 330, dividendRecognizedGross: 0, dividendReceivableGross: 0, dividendReceivedNet: 0 } };
    tradesState.scorecard = { basis: "realized-avg-cost-net-of-fees-v1", minTrades: 20,
      overall: { trades: 3, wins: 2, losses: 1, flat: 0, winRate: 66.7, profitFactor: 4.26, expectancy: 3632, avgWin: 9491, avgLoss: 2228, maxConsecutiveLosses: 1, best: { code: "2330", date: "20260815", pnl: 9491 }, worst: { code: "2317", date: "20260905", pnl: -2228 }, realizedPnl: 7263 },
      months: [
        { key: "${thisMonth}", realizedPnl: -2228, trades: 1, wins: 0, losses: 1, fees: 84, taxes: 144, dividendsNet: 0, winRate: 0 },
        { key: "202608", realizedPnl: 9491, trades: 2, wins: 2, losses: 0, fees: 179, taxes: 330, dividendsNet: 4990, winRate: 100 },
      ],
      years: [{ key: "${thisYear}", realizedPnl: 7263, trades: 3, wins: 2, losses: 1, fees: 263, taxes: 474, dividendsNet: 4990, winRate: 66.7 }] };
    tradesState.settlement = { asOf: "20260913", calendarSource: "weekends-only", days: [
      { date: "20260914", payable: 0, receivable: 99657, net: 99657, items: [{ settleDate: "20260914", tradeDate: "20260910", code: "2317", side: "sell", shares: 2000, amount: 99657 }] },
      { date: "20260915", payable: 100085, receivable: 0, net: -100085, items: [{ settleDate: "20260915", tradeDate: "20260911", code: "2330", side: "buy", shares: 1000, amount: -100085 }] },
    ] };
    tradesState.loaded = true;
    state.watchList = "hold";
    renderHoldingsPanel();
  `);
}

test("成績單：摘要行講本月／今年／勝率，六格與逐月表，未滿 20 筆顯示累積中", () => {
  seed();
  const html = String(app.evalIn(`el.holdingsPanel.innerHTML`)).replace(/\s+/g, " ");
  const text = html.replace(/<[^>]+>/g, "");
  assert.match(text, /我的成績單.*本月 -2,228・今年 \+7,263・勝率 累積中 3\/20 筆/);
  assert.match(text, /獲利因子 ?4\.26/);
  assert.match(text, /每筆平均 ?\+3,632/);
  assert.match(text, /最長連虧 ?1 筆/);
  assert.match(text, /今年費稅 ?737/, "263 + 474");
  assert.match(text, /今年股利入帳 ?4,990/);
  assert.match(text, /2026\/08 ?\+9,491 ?2 ?100% ?509 ?4,990/, "逐月表：月份、已實現、筆數、勝率、費稅、股利");
  assert.match(text, /最佳一筆 2330 \+9,491，最差一筆 2317 -2,228/);
  assert.match(html, /data-glossary-term="我的成績單"/);
  const open = json(`document.querySelector("[data-holdings-scorecard-fold]").open`);
  assert.equal(open, false, "預設收合，摘要行已有主要數字");
  app.evalIn(`document.querySelector("[data-holdings-scorecard-fold]").open = true; renderHoldingsPanel();`);
  assert.equal(json(`document.querySelector("[data-holdings-scorecard-fold]").open`), true, "重繪保留展開狀態");
});

test("交割款：最近兩週的 T+2 應付／應收放在成績單上方、不收合，開休市表未載入要講", () => {
  seed();
  const line = String(app.evalIn(`el.holdingsPanel.querySelector(".hold-settlement")?.outerHTML || ""`)).replace(/\s+/g, " ");
  assert.match(line.replace(/<[^>]+>/g, ""), /交割款 09\/14 應收 99,657（賣 2317×2,000）・09\/15 應付 100,085（買 2330×1,000）/);
  assert.match(line, /只跳週末/);
  app.evalIn(`tradesState.settlement = { asOf: "20260913", calendarSource: "weekends-only", days: [] }; renderHoldingsPanel();`);
  assert.equal(json(`Boolean(el.holdingsPanel.querySelector(".hold-settlement"))`), false, "沒有待交割就不印");
});

test("CSV：帳本與已實現兩種，UTF-8 BOM、CRLF、標頭與數值", () => {
  seed();
  assert.equal(json(`el.holdingsPanel.querySelectorAll('[data-action="export-trades-csv"]').length`), 2);
  const ledger = String(app.evalIn(`tradesCsvText("ledger")`));
  assert.equal(ledger.charCodeAt(0), 0xfeff, "BOM 讓 Excel 直接開不亂碼");
  const ledgerLines = ledger.slice(1).split("\r\n");
  assert.equal(ledgerLines[0], "成交日,代號,買賣,價格,股數,手續費,證交稅,價金,時段,商品類型,紀錄ID");
  assert.equal(ledgerLines[1], "2026-08-03,2330,買進,100,1000,85,0,100000,regular,stock,b1");
  assert.equal(ledgerLines[2], "2026-08-15,2330,賣出,110,1000,94,330,110000,regular,stock,s1");
  assert.equal(ledgerLines.at(-1), "", "結尾 CRLF");
  const realized = String(app.evalIn(`tradesCsvText("realized")`));
  const realizedLines = realized.slice(1).split("\r\n");
  assert.equal(realizedLines[0], "賣出日,代號,股數,賣出價,均價成本,價金,手續費,證交稅,淨收,成本,損益,損益%");
  assert.equal(realizedLines[1], "2026-08-15,2330,1000,110,100.09,110000,94,330,109576,100085,9491,9.48");
  // 逗號與引號要跳脫
  app.evalIn(`tradesState.records.push({ id: 'q"1,x', code: "2330", side: "buy", price: 1, shares: 1, fee: 0, tax: 0, date: "20260901" })`);
  const escaped = String(app.evalIn(`tradesCsvText("ledger")`)).slice(1).split("\r\n").at(-2);
  assert.ok(escaped.endsWith(`,"q""1,x"`), escaped);
});
