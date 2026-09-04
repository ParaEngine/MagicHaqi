import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const games = JSON.parse(await readFile(path.join(rootDir, 'minigames', '_minigame_index.json'), 'utf8'));
const baseUrl = process.env.MAGICHAQI_BASE_URL || 'http://127.0.0.1:5173';
const selectedGames = process.env.MINIGAME_IDS
    ? games.filter(game => process.env.MINIGAME_IDS.split(',').includes(game.id))
    : games;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];

try {
    for (const game of selectedGames) {
        const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
        const pageErrors = [];
        const localRequestFailures = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('requestfailed', request => {
            const url = request.url();
            if (url.startsWith(baseUrl)) localRequestFailures.push(`${url}: ${request.failure()?.errorText || 'failed'}`);
        });
        await page.goto(`${baseUrl}/minigames/_minigame_index.json`, {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
        });
        await page.evaluate(() => {
            document.body.replaceChildren();
            window.__catalogGameLoaded = false;
            window.addEventListener('message', event => {
                if (event.data?.type === 'gameLoaded') window.__catalogGameLoaded = true;
            });
        });

        try {
            const source = String(game.src).replace(/^\.\//, '');
            const gameUrl = `${baseUrl}/${source}?lang=zhCN`;
            await page.evaluate(url => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('iframe load timeout')), 15_000);
                const frame = document.createElement('iframe');
                frame.id = 'game';
                frame.style.cssText = 'width:960px;height:640px;border:0';
                frame.addEventListener('load', () => {
                    clearTimeout(timeout);
                    resolve();
                }, { once: true });
                frame.addEventListener('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('iframe load failed'));
                }, { once: true });
                document.body.appendChild(frame);
                frame.src = url;
            }), gameUrl);
            await page.waitForFunction(() => window.__catalogGameLoaded === true, null, { timeout: 12_000 });
            await page.waitForTimeout(250);

            const gameFrame = page.frames().find(frame => frame.url() === gameUrl);
            assert.ok(gameFrame, 'game iframe not found');
            const surface = await gameFrame.evaluate(() => {
                const visible = element => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
                };
                const interactive = [...document.querySelectorAll('button, [role="button"], input, select, canvas')]
                    .filter(visible).length;
                const text = (document.body?.innerText || '').trim();
                return {
                    interactive,
                    textLength: text.length,
                    visibleElements: [...document.body.querySelectorAll('*')].filter(visible).length,
                };
            });
            assert.ok(surface.visibleElements > 0, 'empty document surface');
            assert.ok(surface.interactive > 0 || surface.textLength > 20, 'no visible game content');
            assert.deepEqual(localRequestFailures, [], `local request failures: ${localRequestFailures.join('; ')}`);
            assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
            console.log(`PASS ${game.id}`);
        } catch (error) {
            failures.push({
                id: game.id,
                title: game.title,
                error: error.message,
                pageErrors,
                localRequestFailures,
            });
            console.log(`FAIL ${game.id}: ${error.message}`);
        } finally {
            await page.close();
        }
    }
} finally {
    await browser.close();
}

assert.deepEqual(failures, [], `Minigame catalog failures:\n${JSON.stringify(failures, null, 2)}`);
console.log(`Minigame catalog smoke passed: ${selectedGames.length}/${selectedGames.length}.`);