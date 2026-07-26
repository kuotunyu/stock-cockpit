// 明細面板欄位的顏色必須是「值的語意」，不是「調色盤第幾格」。
//
// 舊寫法的 tone 在四個分頁固定輪轉 neutral→high→low→volume→total，而 .is-high 是紅、
// .is-low 是綠。於是畫面上真的會出現：
//   法人分頁：投信 -800（賣超）是紅色、自營 +500（買超）是綠色 —— 兩格都讀成相反的意思
//   基本面：營收 YoY 的「▼15.30%」是紅色的 —— 箭頭說衰退、顏色說成長，兩個編碼互相打臉
//   無資料時：N/A 分別是紅／綠／黃／紫，反而比有資料時更花，真正的錯誤最不顯眼
//   單量／總量：佔用 --yellow（注意股）與 --violet（處置股）的風險標示專用色
//
// 這支測試釘住修好後的規則：有正負的量走紅漲綠跌、水準值不上色、無值走灰、失敗走橘。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const BASE_STOCK = {
  code: "2330", name: "台積電", exchange: "TWSE", official: true,
  sourceKind: "close", source: "TWSE", asOf: "2026/07/24 13:30:00",
  priceStale: false, price: 100, change: 1, priceChange: 1, unit: 10, total: 1000,
  open: 99, high: 101, low: 98, previousClose: 99, spark: [99, 100],
  groups: [], strategies: [], avgVol: 2, turnover: 1.5, institutional: null,
};

// 渲染指定分頁，回傳每一格的 label / value / class
const renderTab = (tab, over = {}) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  const stock = ${JSON.stringify({ ...BASE_STOCK, ...over })};
  stocks.length = 0;
  stocks.push(stock);
  state.selectedCode = stock.code;
  state.detailTab = ${JSON.stringify(tab)};
  renderDetail();
  return [...document.querySelectorAll("#chartMetrics .chart-metric")].map((cell) => ({
    label: cell.querySelector("em").textContent.trim(),
    value: cell.querySelector("strong").textContent.trim(),
    cls: cell.className,
  }));
})())`));

// 先比完全相同，再退回子字串比對——「外資自營」也包含「自營」，只用 includes 會抓錯格子。
const cellFor = (cells, label) => {
  const hit = cells.find((c) => c.label === label) || cells.find((c) => c.label.includes(label));
  assert.ok(hit, `找不到「${label}」格：${cells.map((c) => c.label).join("/")}`);
  return hit;
};

// ---- 法人：本輪最嚴重的缺陷 ----

test("法人買賣超的紅綠跟著符號走，不是跟著欄位位置走", () => {
  const cells = renderTab("法人", {
    institutional: {
      asOf: "2026-07-24",
      foreignNet: 1_200_000, foreignDealerNet: -50_000,
      trustNet: -800_000, dealerNet: 500_000, totalNet: 850_000,
    },
  });
  // 這兩格是舊寫法寫死紅／綠的位置，也就是會給出相反意思的兩格。
  assert.match(cellFor(cells, "投信").cls, /\bis-down\b/, "投信賣超必須是綠色（台股綠＝賣/跌）");
  assert.match(cellFor(cells, "自營").cls, /\bis-up\b/, "自營買超必須是紅色（台股紅＝買/漲）");
  assert.match(cellFor(cells, "外陸資").cls, /\bis-up\b/, "外陸資買超也要有紅綠——它以前根本沒上色");
  assert.match(cellFor(cells, "外資自營").cls, /\bis-down\b/);
  assert.match(cellFor(cells, "合計").cls, /\bis-up\b/, "最該有紅綠的一格，以前是黃色");
  // 任何一格都不該再出現舊的位置色類別。
  for (const cell of cells) {
    assert.doesNotMatch(cell.cls, /is-high|is-low|is-volume|is-total/, `${cell.label} 還帶著位置色類別`);
  }
});

test("法人買賣超為 0 時走平盤灰，不得被算成買超或賣超", () => {
  const cells = renderTab("法人", {
    institutional: {
      asOf: "2026-07-24",
      foreignNet: 0, foreignDealerNet: 0, trustNet: 0, dealerNet: 0, totalNet: 0,
    },
  });
  assert.match(cellFor(cells, "投信").cls, /\bis-flat\b/);
  assert.doesNotMatch(cellFor(cells, "投信").cls, /\bis-up\b|\bis-down\b/);
});

test("法人無資料時全部走灰，不得有任何紅綠", () => {
  const cells = renderTab("法人", { institutional: null });
  for (const cell of cells) {
    assert.doesNotMatch(cell.cls, /\bis-up\b|\bis-down\b/, `${cell.label} 在沒有資料時不該上紅綠`);
  }
  assert.match(cellFor(cells, "外資").cls, /\bis-na\b/);
});

// ---- 即時／均線：水準值不上色 ----

test("開高低與成交量是水準值，一律不上紅綠", () => {
  const cells = renderTab("即時");
  for (const label of ["開", "高", "低", "單量", "總量"]) {
    const cell = cellFor(cells, label);
    assert.doesNotMatch(cell.cls, /\bis-up\b|\bis-down\b/, `「${label}」是水準值，沒有正負可言`);
  }
  // 下跌日的「紅色最高價」會被讀成利多——這是舊寫法真的會發生的事。
  const cellsDown = renderTab("即時", { change: -3.23, priceChange: -125 });
  assert.doesNotMatch(cellFor(cellsDown, "高").cls, /\bis-up\b/, "跌 3.23% 那天的最高價不該是紅色");
});

test("均線分頁的紅綠表示「價在均上還是均下」，不是第幾格", () => {
  // price 100、spark 收在 100 → 五日均約 99.5 → 價在均上 → 紅
  const above = renderTab("均線", { price: 100, spark: [98, 99, 100, 100, 100] });
  assert.match(cellFor(above, "均").cls, /\bis-up\b/, "價站在均線上方＝紅");
  // price 96 明顯低於均線 → 綠
  const below = renderTab("均線", { price: 96, spark: [100, 100, 100, 100, 96] });
  assert.match(cellFor(below, "均").cls, /\bis-down\b/, "價跌破均線＝綠");
});

test("量比與週轉沒有既定門檻，不上色；缺值走灰", () => {
  const withValues = renderTab("均線", { avgVol: 2, turnover: 1.5 });
  assert.doesNotMatch(cellFor(withValues, "量比").cls, /\bis-up\b|\bis-down\b/);
  const without = renderTab("均線", { avgVol: 0, turnover: 0 });
  assert.match(cellFor(without, "量比").cls, /\bis-na\b/, "缺值要看得出是缺值，不是 0");
});

// ---- 基本面：直接驗函式，避免依賴 fetch ----

const chips = (entry) => JSON.parse(app.evalIn(`JSON.stringify(fundamentalsChips(${JSON.stringify(entry)}))`));
const chipFor = (list, labelFragment) => {
  const hit = list.find((c) => String(c.label).includes(labelFragment));
  assert.ok(hit, `找不到含「${labelFragment}」的 chip`);
  return hit;
};

test("營收 YoY 的箭頭與顏色必須同向", () => {
  const down = chips({ data: { revenue: { latest: { yearMonth: "2026-06", revenue: 100, yoy: -15.3 } } } });
  const yoyDown = chipFor(down, "營收YoY");
  assert.match(yoyDown.value, /▼|-/, "值本身要看得出是衰退");
  assert.equal(yoyDown.tone, "down", "▼ 必須配綠色，不能配紅色");

  const up = chips({ data: { revenue: { latest: { yearMonth: "2026-06", revenue: 100, yoy: 8.1 } } } });
  assert.equal(chipFor(up, "營收YoY").tone, "up");
});

test("EPS 是水準值不上色，但虧損要標出來", () => {
  const profit = chips({ data: { eps: { latest: { period: "2026Q1", eps: 12.5 } } } });
  assert.equal(chipFor(profit, "EPS").tone, "neutral", "賺錢是水準值，不需要染紅");
  const loss = chips({ data: { eps: { latest: { period: "2026Q1", eps: -3.2 } } } });
  assert.equal(chipFor(loss, "EPS").tone, "down", "虧損是有方向的事實，以前與獲利同色");
});

test("基本面載入失敗要比「還沒抓到」顯眼", () => {
  const failed = chips({ error: "boom" });
  assert.equal(chipFor(failed, "狀態").tone, "warn");
  const loading = chips({ loading: true });
  assert.equal(chipFor(loading, "狀態").tone, "na");
  // 無資料的四格一律灰，不得是紅／綠／黃／紫。
  for (const label of ["月營收", "EPS", "本益比", "殖利率"]) {
    assert.equal(chipFor(failed, label).tone, "na");
  }
});

test("無資料分支的第一格仍是「狀態」（既有測試靠這個位置）", () => {
  assert.equal(chips({ loading: true })[0].label, "狀態");
  assert.equal(chips({ loading: true }).length, 5);
});

// ---- 不可回頭的結構性保證 ----

test("明細面板欄位不得佔用注意股／處置股的專用色", () => {
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const squatting = [...styles.matchAll(/\.chart-metric[^{]*\{[^}]*var\(--(yellow|violet)\)[^}]*\}/g)];
  assert.deepEqual(squatting.map((m) => m[1]), [],
    "--yellow 是注意股、--violet 是處置股，明細面板不得佔用風險標示的色彩語彙");
});

// 這幾條讀原始碼比對。用 assert.ok(!re.test()) 而不是 assert.doesNotMatch，
// 否則失敗時會把整份 app.js（約 47 萬字）印進測試輸出。
// 比對前先剝掉 // 行註解——註解裡本來就會提到舊寫法長什麼樣。
const appSourceWithoutComments = () => readFileSync(new URL("../../app.js", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

test("hero 的漲跌方向不得回到 inline 寫死色碼", () => {
  const source = appSourceWithoutComments();
  assert.ok(!/#434a56/.test(source), "這個色碼已收進 --flat-surface token，程式碼裡不該再出現");
  assert.ok(!/price-hero[^\n]*\.style\.background/.test(source),
    "方向要用 class 交給 CSS——inline style 會永久遮蔽 CSS 規則，樣式再也蓋不掉");
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(styles, /--flat-surface:\s*#434a56/, "token 要存在，否則平盤會沒有底色");
});

test("「第 5 格套股價方向」的死碼不得復活", () => {
  const source = appSourceWithoutComments();
  assert.ok(!/index === 4 \? movement/.test(source),
    "那是拿股價方向去染總量／週轉／法人合計／殖利率四個不同的東西");
});
