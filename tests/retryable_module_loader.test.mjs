import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRetryableModuleLoader } from '../js/retryable_module_loader.js';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('模块加载失败后允许下一次调用重新加载', async () => {
    let attempts = 0;
    const receivedAttempts = [];
    const expectedModule = { renderExpeditionMap() {} };
    const loader = createRetryableModuleLoader(async attempt => {
        attempts += 1;
        receivedAttempts.push(attempt);
        if (attempts === 1) throw new Error('temporary failure');
        return expectedModule;
    });

    await assert.rejects(loader.load(), /temporary failure/);
    assert.equal(loader.loadedModule, null);
    assert.equal(await loader.load(), expectedModule);
    assert.equal(loader.loadedModule, expectedModule);
    assert.equal(attempts, 2);
    assert.deepEqual(receivedAttempts, [1, 2]);
});

test('并发加载共享同一个进行中的请求', async () => {
    let attempts = 0;
    let resolveImport;
    const loader = createRetryableModuleLoader(() => {
        attempts += 1;
        return new Promise(resolve => { resolveImport = resolve; });
    });

    const first = loader.load();
    const second = loader.load();
    await Promise.resolve();
    resolveImport({ renderExpeditionMap() {} });
    assert.equal(await first, await second);
    assert.equal(attempts, 1);
});

test('星图加载失败留在当前路由并提供重新加载和返回首页', () => {
    assert.match(appSource, /view_expedition_map\.js\?retry=\$\{attempt\}/);
    assert.match(appSource, /id="mhRetryExpeditionMap"[^>]*>重新加载<\/button>/);
    assert.match(appSource, /id="mhReturnFromExpeditionMap"[^>]*>返回首页<\/button>/);
    assert.match(appSource, /if \(retry\) retry\.onclick = \(\) => renderExpeditionMapRoute\(\)/);
    assert.doesNotMatch(appSource, /加载星图失败[\s\S]{0,400}navigateToView\('home'\)/);
});