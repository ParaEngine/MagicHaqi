import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../minigames/haqi_planet_expedition.html', import.meta.url), 'utf8');

test('首章五套敌方角色表使用稳定 CDN WebP', () => {
    for (const id of ['spore_hunter', 'frosting_beetle', 'rift_walker', 'crystal_sentinel', 'rift_gate_core']) {
        assert.match(html, new RegExp(`https://cdn\\.keepwork\\.com/keepwork/cdn/magichaqi/assets/expedition-enemies/chapter-one/${id}_\\d+\\.webp`));
    }
});

test('战斗敌方使用独立美术，捕捉伙伴仍使用伙伴美术', () => {
    assert.match(html, /const artForEnemy=\(enemy,boss\)=>/);
    assert.match(html, /const art=artForEnemy\(enemy,boss\)/);
    assert.doesNotMatch(html, /UIManager\.prototype\.setEnemy=function\(enemy,boss\).*artForPet\(enemy\.artKey\)/);
    assert.match(html, /spriteArt\(artForPet\(species\.artKey\),species\.name/);
});

test('每个敌人只使用明确物种或自身角色表，不使用类别兜底', () => {
    assert.match(html, /const ENEMY_ART_KEY_BY_SPECIES=\{spore_hunter:"spore_hunter",frost_beetle:"frosting_beetle",rift_walker:"rift_walker",crystal_sentinel:"crystal_sentinel",rift_gate_core:"rift_gate_core"\}/);
    assert.match(html, /const speciesKey=boss\|\|enemy\.kind==="boss"\?"rift_gate_core":ENEMY_ART_KEY_BY_SPECIES\[enemy\.speciesId\]/);
    assert.match(html, /key=speciesKey\|\|enemy\.artKey\|\|enemy\.speciesId/);
    assert.match(html, /return ENEMY_ART\[key\]\|\|artForPet\(key\)/);
    assert.doesNotMatch(html, /CHAPTER_ONE_NORMAL_ENEMY_ART_KEYS/);
    assert.doesNotMatch(html, /enemy\.rarity==="精英"\)\{key="crystal_sentinel"/);
    assert.doesNotMatch(html, /character-art-missing/);
    assert.match(html, /innerHTML=spriteArt\(art,enemy\.name,0,0\)/);
});