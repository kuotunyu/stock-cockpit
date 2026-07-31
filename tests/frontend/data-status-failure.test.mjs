// 行情更新失敗時，狀態列必須說出「畫面停住了」——而不是繼續顯示一個看起來很正常的時間戳。
//
// 現場：`renderDataStatus()` 的分支順序是
//   if (official && mode === "official") { …從不提失敗… }
//   else if (broker) …
//   else if (dataState.error) { "官方行情更新失敗 …" }   ← 永遠輪不到
//   else { "官方行情 ・ 等待更新" }                        ← 永遠輪不到
// 而 `dataState.mode` 就是跟著選定來源走的（loadMarketData 成功與失敗都會設成 source），
// 所以第一個分支必定命中。失敗時 lastUpdated 不更新、realtimeCount 歸零，於是畫面變成
// 「官方行情 ・ 即時 0 檔 ・ 10:12:33 更新」——時間戳停在最後一次成功，
// 「即時 0 檔」讀起來像今天比較冷清，tooltip 還寫著「盤中每 10 秒自動更新」。
// 同一段期間到價提醒也整個停擺（catch 路徑不呼叫 checkPriceAlerts），畫面同樣不說。
//
// 觸發率是這批稽核裡最高的一條：筆電睡一下醒來、不小心關掉跑 npm start 的視窗都會踩到，
// 而且每 10 秒重算一次同一句謊。這個函式在此之前**完全沒有測試覆蓋**。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

// 直接設定 dataState 再重繪，不經過網路。
function setState(patch) {
  app.evalIn(`
    Object.assign(dataState, {
      mode: "official", source: "TWSE + TPEx", lastUpdated: "10:12:33",
      quoteCount: 120, realtimeCount: 118, fallbackCount: 2,
      warnings: [], degraded: false, error: "", failedSince: "", loadedOnce: true,
    }, ${JSON.stringify(patch)});
    marketSessionState.stock = { date: "1970-01-01", tradingDay: true };
    renderDataStatus();
  `);
}
const statusText = () => app.evalIn(`document.getElementById("refreshStatus").textContent`);
const statusTitle = () => app.evalIn(`document.getElementById("refreshStatus").title`);

test("正常更新：維持原本的文案", () => {
  setState({});
  const text = statusText();
  assert.match(text, /官方行情/);
  assert.match(text, /即時 118 檔/);
  assert.match(text, /10:12:33 更新/);
  assert.doesNotMatch(text, /失敗/);
});

test("整輪更新失敗 → 必須說「畫面停在 X 的價格」，不可再顯示成正常更新", () => {
  setState({ failedSince: "10:13:05", error: "fetch failed", realtimeCount: 0, quoteCount: 0 });
  const text = statusText();
  assert.match(text, /更新失敗/, "失敗必須寫在臉上");
  assert.match(text, /畫面停在 10:12:33 的價格/, "要指出畫面上的價格是哪個時間點的");
  // 這兩條是核心：舊行為會印出這種讀起來很正常的句子。
  assert.doesNotMatch(text, /即時 0 檔/, "「即時 0 檔」讀起來像今天比較冷清，不是失敗");
  assert.doesNotMatch(text, /10:12:33 更新/, "不可再宣稱那個時間有「更新」過");
});

test("失敗的 tooltip 要講出到價提醒停擺，以及下一步做什麼", () => {
  setState({ failedSince: "10:13:05", error: "fetch failed", realtimeCount: 0 });
  const title = statusTitle();
  assert.match(title, /10:13:05/, "要說從什麼時候開始失敗");
  assert.match(title, /fetch failed/, "要帶原始原因");
  assert.match(title, /到價提醒/, "這段期間提醒不會觸發，使用者必須知道");
  assert.match(title, /重新整理/, "要給下一步");
  assert.doesNotMatch(title, /每 10 秒自動更新/, "失敗時不可再宣稱正在自動更新");
});

test("從未成功過（開著就斷線）→ 說「尚未取得任何行情」而不是停在空時間", () => {
  setState({ failedSince: "09:00:02", error: "fetch failed", lastUpdated: "", realtimeCount: 0 });
  const text = statusText();
  assert.match(text, /更新失敗/);
  assert.match(text, /尚未取得任何行情/);
  assert.doesNotMatch(text, /畫面停在/, "沒有價格可停，不能說停在某個時間");
  // tooltip 也要一致——不可照樣說「都停在上面那個時間」，那句話在這個情境是空話。
  const title = statusTitle();
  assert.doesNotMatch(title, /都停在/, "沒有時間戳時 tooltip 不可沿用同一句");
  assert.match(title, /沒有可用的價格/);
  assert.match(title, /到價提醒/);
});

test("tooltip 是純文字屬性，不可留下 markdown 星號", () => {
  // title 不吃 markdown，寫 ** 只會變成字面上的星號給使用者看。
  setState({ failedSince: "10:13:05", error: "fetch failed", realtimeCount: 0 });
  assert.doesNotMatch(statusTitle(), /\*\*/);
});

test("恢復成功 → failedSince 清空，文案回到正常（不可黏住）", () => {
  setState({ failedSince: "10:13:05", error: "fetch failed", realtimeCount: 0 });
  assert.match(statusText(), /更新失敗/, "前提：先進入失敗狀態");
  setState({});
  const text = statusText();
  assert.doesNotMatch(text, /更新失敗/, "恢復之後不可還掛著失敗");
  assert.match(text, /即時 118 檔/);
});

test("資料到了、只是部分即時源失敗 → 不可當成整輪失敗，但也不可完全不提", () => {
  // 這是 loadMarketData 成功路徑上的 realtimeError：資料有拿到，只是部分即時源缺。
  // 舊行為兩件事共用 dataState.error，而狀態列的第一個分支從不讀它 → 完全沒有出口。
  setState({ error: "即時源部分失敗：MIS 逾時", realtimeCount: 60 });
  const text = statusText();
  assert.doesNotMatch(text, /更新失敗 ・ 畫面停在/, "資料有拿到，不是畫面停住");
  assert.match(text, /10:12:33 更新/, "時間戳仍然有效");
  assert.match(text, /部分即時源失敗/, "但要看得出這一輪不完整");
  assert.match(statusTitle(), /MIS 逾時/, "詳細原因放 tooltip");
});

test("休市日不受影響（既有行為不可被新分支破壞）", () => {
  app.evalIn(`
    Object.assign(dataState, { mode: "official", lastUpdated: "13:30:00", realtimeCount: 0,
      error: "", failedSince: "", loadedOnce: true, fallbackCount: 0 });
    const today = getTaiwanClockParts().isoDate;
    marketSessionState.stock = { date: today, tradingDay: false, holidayName: "端午節" };
    renderDataStatus();
  `);
  const text = statusText();
  assert.match(text, /今日休市/);
  assert.match(text, /端午節/);
  assert.doesNotMatch(text, /更新失敗/);
});

// 上面幾條驗的是「畫」的那一半（設好 dataState 再 renderDataStatus）。
// 底下這條驗「記」的那一半——實際跑 loadMarketData 的成功／失敗路徑。
// 兩半都要有：突變抽查實測，只驗渲染時「catch 不設 failedSince」「成功不清 failedSince」
// 「每輪覆寫 failedSince」三個突變全部存活。
test("loadMarketData：失敗記下 failedSince、連續失敗不覆寫、成功一次就清空", async () => {
  app.evalIn(`
    window.__origFetchApi = fetchApi;
    window.__origTracked = getTrackedQuoteCodes;
    // 沒有追蹤代號時 batches 為空、fetchApi 根本不會被呼叫，失敗路徑跑不到。
    getTrackedQuoteCodes = () => ["2330"];
    dataState.failedSince = ""; dataState.error = ""; dataState.lastUpdated = "10:12:33";
  `);

  // ① 第一次整輪失敗 → 記下時刻與原因
  app.evalIn(`
    fetchApi = async () => { throw new Error("boom-1"); };
    window.__p = loadMarketData({ renderNow: false });
  `);
  await app.settle();
  assert.ok(app.evalIn(`dataState.failedSince`), "整輪失敗必須留下 failedSince");
  assert.equal(app.evalIn(`dataState.error`), "boom-1");
  assert.equal(app.evalIn(`dataState.lastUpdated`), "10:12:33", "刻意保留上次成功的時間戳給使用者對照");

  // ② 連續失敗不可覆寫成「現在」——否則永遠看起來像剛剛才失敗，看不出已經斷多久。
  //    用哨兵值而不是比對時間字串：同一秒內產生的字串會相同，分辨不出 `||=` 與 `=`。
  app.evalIn(`
    dataState.failedSince = "SENTINEL-09:00:00";
    fetchApi = async () => { throw new Error("boom-2"); };
    window.__p = loadMarketData({ renderNow: false });
  `);
  await app.settle();
  assert.equal(app.evalIn(`dataState.failedSince`), "SENTINEL-09:00:00", "要保留第一次失敗的時刻");
  assert.equal(app.evalIn(`dataState.error`), "boom-2", "但原因要更新成最新那一次");

  // ③ 恢復成功 → 立刻清空，否則畫面會一直掛著失敗
  app.evalIn(`
    fetchApi = async () => ({ ok: true, quotes: [], source: "TWSE", generatedAt: new Date().toISOString(),
      realtimeCount: 1, fallbackCount: 0, warnings: [], sourceKey: "official" });
    window.__p = loadMarketData({ renderNow: false });
  `);
  await app.settle();
  assert.equal(app.evalIn(`dataState.failedSince`), "", "成功一次就要清空");

  app.evalIn(`fetchApi = window.__origFetchApi; getTrackedQuoteCodes = window.__origTracked;`);
});

test("休市日又遇到更新失敗 → 失敗優先（價格確實停住了）", () => {
  app.evalIn(`
    Object.assign(dataState, { mode: "official", lastUpdated: "13:30:00", realtimeCount: 0,
      error: "fetch failed", failedSince: "14:02:11", loadedOnce: true });
    const today = getTaiwanClockParts().isoDate;
    marketSessionState.stock = { date: today, tradingDay: false, holidayName: "端午節" };
    renderDataStatus();
  `);
  assert.match(statusText(), /更新失敗/, "休市不代表可以把失敗藏起來");
});
