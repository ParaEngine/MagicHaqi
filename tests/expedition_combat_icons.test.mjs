import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../minigames/haqi_planet_expedition.html', import.meta.url), 'utf8');

test('远征战斗的八个行动与意图图标使用稳定 CDN 图片', () => {
    assert.match(html, /const COMBAT_ICON_BASE="https:\/\/cdn\.keepwork\.com\/keepwork\/cdn\/magichaqi\/assets\/expedition-combat-icons"/);
    for (const name of [
        'normal-attack',
        'ultimate',
        'capture',
        'item',
        'intent-attack',
        'intent-guard',
        'intent-charge',
        'intent-debuff',
    ]) {
        assert.match(html, new RegExp(`"${name}"`));
    }
});

test('四个玩家行动按钮和四类敌方意图使用图片渲染', () => {
    for (const selector of ['#normalAttack', '#ultimate', '#itemSkill', '#captureSkill']) {
        assert.match(html, new RegExp(`\\["${selector}",`));
    }
    assert.match(html, /const icon=document\.createElement\("img"\)/);
    assert.match(html, /icon\.src=intent\.iconUrl/);
    assert.match(html, /class="combat-icon-image"/);
});