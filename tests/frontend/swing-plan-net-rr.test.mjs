// v21：選股門檻改套在「淨」盈虧比上（已扣一買一賣的手續費與證交稅約 0.471%）。
// 卡片必須把毛值與淨值都顯示出來——毛值是「圖上的結構」，淨值是「值不值得做」，
// 只給毛值會讓「1.0 剛好過關」看起來安全，實際上淨值只有 0.6。
//
// 另外顯示「被 2% 過濾跳過的最近壓力」。那道過濾刻意保留（上軌續攻選的就是貼近期高點的股票，
// 最近擺動高點必然貼著收盤價，拿它當目標 RR 幾乎歸零），但被跳過的價位是真實關卡，
// 路上會先遇到它，不能只在後端知道。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const PICK = {
  code: "3685", name: "元創精密", exchange: "TPEx", market: "上櫃",
  scenario: { key: "strongContinuation", name: "上軌續攻", desc: "沿上軌強勢" },
  score: 84, price: 41, changePct: 9.77, avgVolLots: 1423, volumeRatio5: 1.98,
  plan: { entry: 41, initialStop: 38.95, structuralStop: 33.59, trailingTrigger: 43.05, target: 55, rr: 2, rrNet: 1.87, nearestResistance: null },
  indicators: { ma5: 38.07, ma20: 33.59, ma60: 30, bollMid: 33.59, bollUpper: 40, bollLower: 27, goldenCrossDays: 13, pullbackDepthPct: 0 },
  asOf: "2026/07/24", reasons: [],
};
const render = (over = {}) => app.evalIn(
  `renderSwingCard(${JSON.stringify({ ...PICK, ...over })}, 1)`,
);

test("盈虧比要同時顯示毛值與淨值", () => {
  const html = render();
  assert.match(html, /2\.0/, "毛值照舊顯示");
  assert.match(html, /淨 1\.9/, "淨值要一起顯示，否則「剛好過關」看不出風險");
  assert.match(html, /title="[^"]*淨值[^"]*"/, "tooltip 要說明門檻用的是淨值");
});

test("邊緣設定：毛 1.0 但淨 0.6 必須看得出來", () => {
  const html = render({
    code: "5871", name: "中租-KY",
    plan: { entry: 120, initialStop: 114, structuralStop: 117.5, trailingTrigger: 126, target: 122.5, rr: 1, rrNet: 0.63, nearestResistance: 120.5 },
  });
  assert.match(html, /1\.0/);
  assert.match(html, /淨 0\.6/, "這正是實機量到的中租-KY：毛 1.00 → 淨 0.63");
});

test("被 2% 過濾跳過的壓力要標示，沒有時不得亮", () => {
  const withLevel = render({
    plan: { ...PICK.plan, nearestResistance: 41.5 },
  });
  assert.match(withLevel, /前有壓力/, "有被跳過的關卡要標示");
  assert.match(withLevel, /title="[^"]*還有一個更近的擺動高點[^"]*"/, "tooltip 要講清楚為什麼沒當目標");
  assert.match(withLevel, /41\.5/, "要給出那個價位");

  const without = render();
  assert.doesNotMatch(without, /前有壓力/, "沒有被跳過的關卡就不該亮——天天亮的提示等於沒有提示");
});

test("rrNet 缺值時不得印出 NaN／undefined", () => {
  const html = render({ plan: { ...PICK.plan, rrNet: null } });
  assert.doesNotMatch(html, /淨 NaN|淨 undefined|淨 null/);
  assert.doesNotMatch(html, /NaN/);
});

// jsdom harness 不載入 styles.css，getComputedStyle 解不出 CSS 變數，
// 所以照專案慣例改讀 CSS 原文比對（真實瀏覽器已驗過算出 rgb(255,217,77)）。
test("「前有壓力」用黃色 hint，不是紅色警示（它是資訊不是錯誤）", () => {
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const rule = styles.match(/\.swing-stat-hint\.is-warn\s*\{([^}]*)\}/);
  assert.ok(rule, "缺少 .swing-stat-hint.is-warn 規則");
  assert.match(rule[1], /color\s*:\s*var\(--yellow\)/, "用黃色：它是資訊不是錯誤");
  assert.doesNotMatch(rule[1], /var\(--red\)/, "不該升級成紅色警示");
});

// 「划不划算」的判斷要跟門檻同一個口徑（淨值）。用毛值講「相當划算」會在停損很近的設定上失準。
test("上榜亮點的「相當划算」用淨值判斷，兩個數字都顯示", () => {
  // 毛 2.0 但淨 1.3（停損很近、成本佔比高）→ 不該說「相當划算」
  const marginal = render({
    plan: { entry: 100, initialStop: 95, structuralStop: 98, trailingTrigger: 105, target: 104, rr: 2, rrNet: 1.3, nearestResistance: null },
  });
  assert.match(marginal, /盈虧比 2\.0（淨 1\.3）/, "兩個數字都要出現");
  assert.doesNotMatch(marginal, /相當划算/, "淨值只有 1.3，不該說相當划算");

  // 毛 4.0、淨 3.6 → 說得上划算
  const good = render({
    plan: { entry: 100, initialStop: 95, structuralStop: 96, trailingTrigger: 105, target: 120, rr: 5, rrNet: 4.37, nearestResistance: null },
  });
  assert.match(good, /盈虧比 5\.0（淨 4\.4）、相當划算/);
});

test("評分徽章的 tooltip 要說明門檻是淨值", () => {
  const html = render();
  const badge = html.match(/class="swing-rank-badge[^"]*"[^>]*title="([^"]*)"/);
  assert.ok(badge, "找不到評分徽章的 tooltip");
  assert.match(badge[1], /淨盈虧比/, "要講清楚是淨值，否則使用者看到毛 1.5 被剔除會困惑");
  assert.doesNotMatch(badge[1], /\*\*/, "HTML 屬性不會渲染 markdown，不可留星號");
});
