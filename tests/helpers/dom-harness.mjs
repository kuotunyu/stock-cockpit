// 前端測試 harness：jsdom 載入 index.html，把 app.js 以「真正的 <script> 元素」注入執行
// （classic script 的頂層 const/let 會進 global lexical scope，之後 win.eval 才碰得到 state 等變數；
//  若改用 win.eval 執行整份 app.js，const 會被關在該次 eval 的作用域裡、後續存取會 ReferenceError）。
// 注意：app.js 會在載入尾端 setInterval(10s) 自動刷新 → 測試檔務必在 after() 呼叫 cleanup()
// （內部 window.close() 會清掉計時器，否則 node --test 行程會掛住）。
import { JSDOM, VirtualConsole } from "jsdom";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// 預設 API 罐頭：讓 initializeApp() 安靜落地（看起來已登入、其他資料源離線）。
const DEFAULT_ROUTES = {
  "/api/auth/me": { ok: true, user: { id: "u1", username: "admin", displayName: "管理者", role: "admin" }, warnings: {} },
  "/api/market-session": { ok: true, stock: { date: "", tradingDay: null, holidayName: "", confidence: "unknown", degraded: true }, warnings: [] },
  // watchlists 預設離線失敗 → 保留 localStorage 種進去的本機清單（測試可覆寫）
  "/api/watchlists": { ok: false, error: "dom-harness offline", __status: 200 },
};

function makeCtxFactory(opsCounter) {
  return function makeCtx() {
    const base = {
      measureText: (text) => {
        opsCounter.count += 1;
        return { width: String(text ?? "").length * 7 };
      },
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: [] }),
      canvas: null,
    };
    // 任何未知方法 → no-op（並計數）；任何屬性寫入 → 接受。
    return new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop];
        const fn = (..._args) => { opsCounter.count += 1; };
        target[prop] = fn;
        return fn;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
  };
}

export async function createAppWindow({ fetchRoutes = {}, beforeApp } = {}) {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => jsdomErrors.push(err));
  // 不掛 resources loader → index.html 的本機 lucide/app 外部 script 不會自動抓取；下方只注入 app.js 供單元測試。
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const win = dom.window;
  const routes = { ...DEFAULT_ROUTES, ...fetchRoutes };
  const fetchLog = [];
  const opsCounter = { count: 0 };

  // stubs：一定要在 app.js 之前裝好
  win.fetch = async (input, init) => {
    const raw = String(typeof input === "string" ? input : input?.url || "");
    fetchLog.push({ path: raw, method: init?.method || "GET" });
    const path = raw.split("?")[0];
    let body = routes[path];
    if (body === undefined) {
      const key = Object.keys(routes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
      body = key ? routes[key] : { ok: false, error: `dom-harness: unrouted ${path}` };
    }
    if (typeof body === "function") body = body(raw, init);
    const status = body.__status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: { get: () => "application/json" },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  win.HTMLCanvasElement.prototype.getContext = makeCtxFactory(opsCounter);
  win.alert = () => {};
  win.confirm = () => true;
  win.scrollTo = () => {};
  win.__mockCtx = makeCtxFactory(opsCounter); // 給測試造「假 canvas 物件」用
  win.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

  beforeApp?.(win); // 例如先種 localStorage（app.js 頂層就會讀）

  // 以真正的 <script> 元素執行 app.js（classic script 語意）
  const appSrc = await readFile(resolve(root, "app.js"), "utf8");
  const scriptEl = win.document.createElement("script");
  scriptEl.textContent = appSrc;
  win.document.body.appendChild(scriptEl);

  // 沖掉 initializeApp 的初始化 fetch 鏈（幾輪 macrotask）
  const settle = async (rounds = 4) => {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  await settle();

  return {
    win,
    doc: win.document,
    fetchLog,
    jsdomErrors,
    canvasOps: opsCounter,
    evalIn: (code) => win.eval(code),
    settle,
    cleanup: () => win.close(), // 清 setInterval（app.js 有 10 秒自動刷新）
  };
}
