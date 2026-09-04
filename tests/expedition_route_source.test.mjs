import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getPendingExpeditionPetIds, recordMissingExpeditionPetIds } from '../js/expedition_route_core.js';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('星图不会反复加载已经确认缺失的伙伴档案', () => {
    const pets = { available: { id: 'available' } };
    const attemptedMissingIds = new Set();
    const firstRequest = getPendingExpeditionPetIds(['available', 'stale'], pets, attemptedMissingIds);

    assert.deepEqual(firstRequest, ['stale']);
    recordMissingExpeditionPetIds(firstRequest, pets, attemptedMissingIds);
    assert.deepEqual(getPendingExpeditionPetIds(['available', 'stale'], pets, attemptedMissingIds), []);
});

test('星图补载成功的伙伴不会被误记为缺失', () => {
    const pets = {};
    const attemptedMissingIds = new Set();
    const requestedIds = getPendingExpeditionPetIds(['loaded-later'], pets, attemptedMissingIds);

    pets['loaded-later'] = { id: 'loaded-later' };
    recordMissingExpeditionPetIds(requestedIds, pets, attemptedMissingIds);
    assert.equal(attemptedMissingIds.has('loaded-later'), false);
});

test('伙伴档案请求失败保留重试能力且不会自动循环补载', () => {
    const hydrationBranch = appSource.match(/expeditionPetHydrationPromise = loadPets\(unloadedPetIds\)([\s\S]*?)\.finally\(\(\) => \{ expeditionPetHydrationPromise = null; \}\);/)?.[1] || '';

    assert.match(hydrationBranch, /\.then\(\(\) => \{[\s\S]*recordMissingExpeditionPetIds[\s\S]*return true/);
    assert.doesNotMatch(hydrationBranch.match(/\.catch\(error => \{([\s\S]*)/)?.[1] || '', /recordMissingExpeditionPetIds/);
    assert.match(hydrationBranch, /return false/);
    assert.match(appSource, /if \(loaded && state\.currentView === 'expeditionMap'\) renderExpeditionMapRoute\(\)/);
    assert.match(appSource, /if \(!loaded && state\.currentView === 'expeditionMap'\)[\s\S]*id="mhRetryExpeditionPets"[^>]*>重新加载<\/button>/);
});