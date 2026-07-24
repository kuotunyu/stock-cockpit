// 測試用 fetch mock：以 URL 路由表攔截 globalThis.fetch。
// - 127.0.0.1 / localhost 直通真 fetch（測試打自己的臨時埠伺服器）。
// - 未匹配的「外部」URL 直接 throw → 保證 npm test 完全離線，漏接路由會大聲失敗。
// - reply 支援：物件（JSON 200）、函式 (url)=>物件、{__error:"msg"}（模擬網路失敗）、
//   {__http:true, status, body}（自訂 HTTP 狀態）。
const realFetch = globalThis.fetch;

export function installFetchMock(routes = []) {
  const calls = [];
  const table = [...routes]; // [{ match: RegExp | (url:URL, init?:RequestInit)=>bool, reply }]
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return realFetch(input, init);
    }
    calls.push({
      url: raw,
      at: Date.now(),
      method: String(init?.method || "GET").toUpperCase(),
      body: init?.body ?? null,
      headers: init?.headers ?? null,
    });
    for (const route of table) {
      const hit = route.match instanceof RegExp ? route.match.test(raw) : route.match(url, init);
      if (!hit) continue;
      const out = typeof route.reply === "function" ? await route.reply(url, init) : route.reply;
      if (out && out.__error) throw new Error(out.__error);
      const { status = 200, body = out } = out && out.__http ? out : { body: out };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`fetch-mock: unmatched external URL ${raw}`);
  };
  return {
    realFetch,
    calls,
    callsFor: (re) => calls.filter((c) => re.test(c.url)),
    // per-test 覆寫：插到最前（LIFO 優先），回傳移除函式。
    override(route) {
      table.unshift(route);
      return () => {
        const i = table.indexOf(route);
        if (i !== -1) table.splice(i, 1);
      };
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

// 純函式測試用的「絆線」：任何外部網路呼叫都直接失敗（不該發生）。
export function installTripwire() {
  return installFetchMock([]);
}
