import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HOME_TREASURE_META } from '../js/home_treasures.js';
import { EXPEDITION_MATERIAL_ART, HOME_TREASURE_ART, rewardArtHtml } from '../js/reward_art.js';

const MATERIAL_IDS = [
    'hpShard', 'manaDust', 'attackCore', 'guardPlate', 'stellarEssence', 'captureLens',
    'cometAlloy', 'relicCircuit', 'phaseCrystal', 'starMoss', 'lunarFiber', 'nebulaPearl',
];
const TREASURE_IDS = [
    'mining_array', 'clean_breeze_filter', 'starlight_greenhouse', 'ember_reactor',
];

test('return reward art maps every material and treasure to its own WebP', () => {
    assert.deepEqual(Object.keys(EXPEDITION_MATERIAL_ART), MATERIAL_IDS);
    assert.deepEqual(Object.keys(HOME_TREASURE_ART), TREASURE_IDS);

    const urls = [...Object.values(EXPEDITION_MATERIAL_ART), ...Object.values(HOME_TREASURE_ART)];
    assert.equal(new Set(urls).size, 16);
    urls.forEach(url => assert.match(url, /^https:\/\/cdn\.keepwork\.com\/.+\.webp$/));
});

test('home treasure metadata uses the shared art for the matching treasure', () => {
    TREASURE_IDS.forEach(id => assert.equal(HOME_TREASURE_META[id].image, HOME_TREASURE_ART[id]));
});

test('reward art keeps an emoji fallback for image load failures', () => {
    const html = rewardArtHtml('https://cdn.keepwork.com/reward.webp', '✦', 'reward-image');
    assert.match(html, /<span hidden>✦<\/span>/);
    assert.match(html, /class="reward-image"/);
    assert.match(html, /onerror="this\.hidden=true;this\.previousElementSibling\.hidden=false"/);
    assert.equal(rewardArtHtml('', '✦'), '✦');
});

test('expedition settlement maps every known item to the shared reward art root', async () => {
    const html = await readFile(new URL('../minigames/haqi_planet_expedition.html', import.meta.url), 'utf8');
    const allIds = [...MATERIAL_IDS, ...TREASURE_IDS];
    assert.match(html, /const REWARD_ART_ROOT="https:\/\/cdn\.keepwork\.com\/keepwork\/cdn\/magichaqi\/assets\/day-three-p0\/split-icons"/);
    allIds.forEach(id => assert.match(html, new RegExp(`rewardIcon\\("${id}"`)));
});

test('inventory and pet growth views consume the shared material art map', async () => {
    const [inventorySource, petListSource] = await Promise.all([
        readFile(new URL('../js/view_inventory.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/view_petList.js', import.meta.url), 'utf8'),
    ]);
    assert.match(inventorySource, /EXPEDITION_MATERIAL_ART\[it\.id\.slice\(EXPEDITION_MATERIAL_PREFIX\.length\)\]/);
    assert.match(inventorySource, /ITEM_BY_ID\[id\] \|\| \(EXPEDITION_MATERIAL_ART\[materialId\]/);
    MATERIAL_IDS.forEach(id => assert.match(inventorySource, new RegExp(`\\b${id}: \\{ name:`)));
    assert.match(petListSource, /EXPEDITION_MATERIAL_ART\[materialId\]/);
});