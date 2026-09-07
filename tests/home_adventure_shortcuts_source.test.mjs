import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const fieldSource = await readFile(new URL('../js/level_field.js', import.meta.url), 'utf8');
const fieldStyles = await readFile(new URL('../css/field.css', import.meta.url), 'utf8');

test('新手任务不会隐藏哈奇星球的长期探索入口', () => {
    const shortcutsTemplate = fieldSource.match(/\$\{([^\n]+) \? `<nav class="home-adventure-shortcuts"/)?.[1] || '';

    assert.match(shortcutsTemplate, /showExpedition \|\| showMineral/);
    assert.doesNotMatch(shortcutsTemplate, /onboardingHasPriority/);
    assert.match(fieldSource, /data-field-scene-nav="helloLearner" title="学英语"/);
    assert.match(fieldSource, /data-field-scene-nav="expeditionMap" title="星球探险"/);
    assert.match(fieldSource, /data-field-scene-nav="haqiMineralExploration" title="星际矿区"/);
    assert.match(fieldSource, /home-english-shortcut-v3\.webp/);
    assert.match(fieldSource, /home-expedition-shortcut-v3\.webp/);
    assert.match(fieldSource, /home-mineral-shortcut-v3\.webp/);
    assert.match(fieldSource, /cdn\.keepwork\.com\/keepwork\/cdn\/magichaqi\/assets\/qq\.png/);
    assert.doesNotMatch(fieldSource, /new URL\('\.\.\/assets\/qq\.png'/);

    const expeditionIndex = fieldSource.indexOf('data-field-scene-nav="expeditionMap"');
    const mineralIndex = fieldSource.indexOf('data-field-scene-nav="haqiMineralExploration"');
    const englishIndex = fieldSource.indexOf('data-field-scene-nav="helloLearner"');
    assert.ok(expeditionIndex < mineralIndex && mineralIndex < englishIndex);
});

test('主页欢迎横幅保留适中尺寸和文案安全区', () => {
    assert.match(fieldStyles, /\.home-haqi-identity \{[\s\S]*?width: min\(460px, calc\(100% - 28px\)\)/);
    assert.match(fieldStyles, /\.home-haqi-identity__copy \{[\s\S]*?top: 35%; left: 17%[\s\S]*?width: 66%; height: 45%/);
    assert.match(fieldSource, /Math\.min\(760, Math\.max\(alignedWidth, preferredWidth\)\)/);
});