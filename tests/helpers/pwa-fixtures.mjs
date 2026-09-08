// 真 PWA 專用來源：實際 HTTP 合成 API／版本資產、故障注入與 worker 也必經的外網攔截。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { apiResponse } from './browser-fixtures.mjs';

const root = new URL('../../', import.meta.url);
const artifacts = resolve('test-results/browser');
const files = ['index.html', 'app.js', 'sw.js', 'portfolio-risk.js', 'styles.css', 'lucide.min.js',
  'manifest.json', 'icon.svg', 'fonts/IBMPlexMono-Medium-Latin1.woff2',
  'fonts/IBMPlexMono-SemiBold-Latin1.woff2', 'fonts/IBMPlexMono-Bold-Latin1.woff2'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export async function createPwaFixture({ setupFailure } = {}) {
  const assets = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(file, root))])));
  let version = 'stock1-shell-test-a';
  let failure = null;
  let baseUrl;
  let browser;
  let context;
  let traceActive = false;
  let closed = false;
  const requests = [];
  const externalRequests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, baseUrl);
    // Chromium 的 proxy 也指向本 server；非本次 origin 絕不轉送。
    if (url.origin !== baseUrl || request.headers.host !== new URL(baseUrl).host) {
      externalRequests.push(request.url);
      response.writeHead(403).end('PWA fixture blocked external network');
      return;
    }
    requests.push({ method: request.method, path: url.pathname, search: url.search, version });
    response.setHeader('Cache-Control', 'no-store');
    if (failure?.path === url.pathname) {
      if (failure.mode === 'disconnect') request.socket.destroy();
      else response.writeHead(failure.status || 503).end('Synthetic asset unavailable');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      let result = apiResponse(url, request.method, 'populated');
      if (url.pathname === '/api/app-version') result = { body: { ok: true, build: {},
        identity: { runtime: { commit: 'fixture', fingerprint: 'a'.repeat(64), dirty: false },
          disk: { commit: 'fixture', fingerprint: 'a'.repeat(64), dirty: false }, shellVersion: version, restartRequired: false },
        update: { state: 'current' } } };
      if (url.pathname === '/api/trade-plans') result = { body: { ok: true, schemaVersion: 1, rev: 0, plans: [], linkEvidence: {} } };
      response.writeHead(result.status || 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body));
      return;
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    let body = assets.get(file);
    if (!body) { response.writeHead(404).end('Missing fixture asset'); return; }
    if (file === 'app.js') body = body.toString().replace(/const APP_SHELL_VERSION = "[^"]+";/, `const APP_SHELL_VERSION = "${version}";`);
    if (file === 'sw.js') body = body.toString().replace(/const CACHE_NAME = "[^"]+";/, `const CACHE_NAME = "${version}";`);
    response.writeHead(200, { 'Content-Type': types[extname(file)] }).end(body);
  });
  server.on('connect', (request, socket) => {
    externalRequests.push(`CONNECT ${request.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  async function capture(name) {
    await mkdir(artifacts, { recursive: true });
    for (const [index, page] of (context?.pages() || []).entries()) {
      await page.screenshot({ path: resolve(artifacts, `${name}-${index}.png`), fullPage: true }).catch(() => {});
    }
    await writeFile(resolve(artifacts, `${name}-requests.json`), JSON.stringify({ requests, externalRequests }, null, 2));
    if (traceActive) {
      await context.tracing.stop({ path: resolve(artifacts, `${name}.zip`) });
      traceActive = false;
    }
  }
  async function close() {
    if (closed) return;
    closed = true;
    const errors = [];
    for (const cleanup of [() => context?.close(), () => browser?.close(), () => new Promise((res, rej) => {
      server.close(error => error ? rej(error) : res());
      server.closeAllConnections();
    })]) { try { await cleanup(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'PWA fixture cleanup failed');
  }
  try {
    await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    assert.notEqual(new URL(baseUrl).port, '5174');
    // 移除 Chromium 預設 loopback bypass，其他本機埠也不能繞過 tripwire。
    browser = await chromium.launch({ headless: true, proxy: { server: baseUrl, bypass: '<-loopback>' } });
    context = await browser.newContext({ serviceWorkers: 'allow', locale: 'zh-TW', timezoneId: 'Asia/Taipei',
      viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'dark' });
    context.setDefaultTimeout(15000);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceActive = true;
    await setupFailure?.({ browser, context, server, baseUrl });
  } catch (error) {
    await capture('pwa-setup-failure').catch(() => {});
    await close().catch(() => {});
    throw error;
  }
  return { browser, context, server, baseUrl, requests, externalRequests, capture, close,
    setVersion(next) { version = next; },
    setFailure(next) { failure = next; },
    async newPage(path = '/?screen=overnight') {
      const page = await context.newPage();
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'load' });
      await page.locator('.topbar').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      return page;
    },
  };
}

export async function waitForController(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
}

export async function updateWorker(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return new Promise((resolveUpdate, rejectUpdate) => {
      let worker;
      const done = (error, state) => {
        clearTimeout(timer);
        registration.removeEventListener('updatefound', found);
        worker?.removeEventListener('statechange', changed);
        if (error) rejectUpdate(error); else resolveUpdate(state);
      };
      const changed = () => {
        if (['activated', 'redundant'].includes(worker.state)) done(null, worker.state);
      };
      const found = () => { worker = registration.installing; worker.addEventListener('statechange', changed); changed(); };
      const timer = setTimeout(() => done(new Error('PWA update terminal state timeout')), 15000);
      registration.addEventListener('updatefound', found);
      // 新分頁的 load 可能已觸發 register/update；連同正在安裝的那一代一起等候。
      if (registration.installing) found();
      else registration.update().catch(error => done(error));
    });
  });
}
