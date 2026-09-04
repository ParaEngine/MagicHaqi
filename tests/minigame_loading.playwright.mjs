import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let retryRequests = 0;

const fixtureHtml = `<!doctype html>
<html lang="zh-CN">
<body>
  <section id="mainFlow">
    <div id="mhMinigameLoading" class="mh-minigame-loading" aria-hidden="true">
      <h1 id="mhMinigameLoadingTitle">正在加载</h1>
      <button id="mhMinigameLoadingRetry" hidden>重试</button>
    </div>
  </section>
  <section class="mh-explore-slide loading" data-navigation-locked="true"></section>
  <script type="module">
    import { resolveMinigameLoadingState, resolveMinigameResourceEvent, shouldReleaseExploreFlow } from '/js/minigame_loading.js';

    const loading = document.querySelector('#mhMinigameLoading');
    const title = document.querySelector('#mhMinigameLoadingTitle');
    const retry = document.querySelector('#mhMinigameLoadingRetry');
    const explore = document.querySelector('.mh-explore-slide');
    let retryUrl = '';

    function showMainState(event) {
      const state = resolveMinigameLoadingState(event);
      loading.className = 'mh-minigame-loading show' + (state === 'failed' ? ' failed' : '');
      loading.setAttribute('aria-hidden', 'false');
      title.textContent = state === 'failed' ? '加载失败' : '正在加载';
      retry.hidden = state !== 'failed';
      if (state === 'ready') {
        loading.className = 'mh-minigame-loading';
        loading.setAttribute('aria-hidden', 'true');
      }
    }

    async function requestResource(url, timeoutMs = 500) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        const html = response.ok ? await response.text() : null;
        return resolveMinigameResourceEvent({ responseOk: response.ok, html });
      } catch (error) {
        return error?.name === 'AbortError' ? 'timeout' : resolveMinigameResourceEvent({ error });
      } finally {
        clearTimeout(timer);
      }
    }

    window.runMainLoad = async (url, timeoutMs) => {
      retryUrl = url;
      showMainState('start');
      const event = await requestResource(url, timeoutMs);
      showMainState(event);
      return event;
    };

    window.runExploreLoad = async (url, timeoutMs) => {
      explore.className = 'mh-explore-slide loading';
      explore.dataset.navigationLocked = 'true';
      const event = await requestResource(url, timeoutMs);
      if (resolveMinigameLoadingState(event) === 'failed') explore.classList.add('load-failed');
      if (shouldReleaseExploreFlow(event)) {
        explore.classList.remove('loading');
        explore.dataset.navigationLocked = 'false';
      }
      return event;
    };

    retry.addEventListener('click', () => window.runMainLoad(retryUrl));
  </script>
</body>
</html>`;

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(fixtureHtml);
        return;
    }
    if (url.pathname === '/js/minigame_loading.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(await readFile(path.join(rootDir, 'js', 'minigame_loading.js'), 'utf8'));
        return;
    }
    if (url.pathname === '/slow') {
        setTimeout(() => {
            if (!response.destroyed) {
                response.writeHead(200, { 'content-type': 'text/html' });
                response.end('<main>late</main>');
            }
        }, 500);
        return;
    }
    if (url.pathname === '/empty') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('   ');
        return;
    }
    if (url.pathname === '/error') {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('unavailable');
        return;
    }
    if (url.pathname === '/retry') {
        retryRequests += 1;
        response.writeHead(retryRequests === 1 ? 503 : 200, { 'content-type': 'text/html' });
        response.end(retryRequests === 1 ? 'unavailable' : '<main>ready</main>');
        return;
    }
    response.writeHead(404);
    response.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
    const page = await browser.newPage();
    await page.goto(baseUrl);

    for (const [name, pathName, timeoutMs, expected] of [
        ['timeout', '/slow', 30, 'timeout'],
        ['empty HTML', '/empty', 500, 'empty'],
        ['request failure', '/error', 500, 'error'],
    ]) {
        const event = await page.evaluate(({ url, timeout }) => window.runMainLoad(url, timeout), {
            url: `${baseUrl}${pathName}`,
            timeout: timeoutMs,
        });
        assert.equal(event, expected, `${name} should produce ${expected}`);
        assert.equal(await page.locator('#mhMinigameLoading').getAttribute('class'), 'mh-minigame-loading show failed');
        assert.equal(await page.locator('#mhMinigameLoadingTitle').textContent(), '加载失败');
        assert.equal(await page.locator('#mhMinigameLoadingRetry').isVisible(), true);
    }

    assert.equal(await page.evaluate((url) => window.runMainLoad(url), `${baseUrl}/retry`), 'error');
    await page.locator('#mhMinigameLoadingRetry').click();
    await page.locator('#mhMinigameLoading').waitFor({ state: 'hidden' });
    assert.equal(retryRequests, 2, 'retry should request the resource again');

    assert.equal(await page.evaluate((url) => window.runExploreLoad(url), `${baseUrl}/error`), 'error');
    const exploreState = await page.locator('.mh-explore-slide').evaluate((element) => ({
        loading: element.classList.contains('loading'),
        failed: element.classList.contains('load-failed'),
        navigationLocked: element.dataset.navigationLocked,
    }));
    assert.deepEqual(exploreState, { loading: false, failed: true, navigationLocked: 'false' });

    console.log('Playwright resource-failure regression passed: timeout, empty, error, retry, explore fallback.');
} finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}