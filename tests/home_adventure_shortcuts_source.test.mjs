import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const fieldSource = await readFile(new URL('../js/level_field.js', import.meta.url), 'utf8');

test('新手任务不会隐藏哈奇星球的长期探索入口', () => {
    const shortcutsTemplate = fieldSource.match(/\$\{([^\n]+) \? `<nav class="home-adventure-shortcuts"/)?.[1] || '';

    assert.match(shortcutsTemplate, /showExpedition \|\| showMineral/);
    assert.doesNotMatch(shortcutsTemplate, /onboardingHasPriority/);
    assert.match(fieldSource, /data-field-scene-nav="expeditionMap" title="星球探险"/);
    assert.match(fieldSource, /data-field-scene-nav="haqiMineralExploration" title="星际矿区"/);
});