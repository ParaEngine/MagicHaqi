import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const minigameSource = await readFile(new URL('../js/view_minigames.js', import.meta.url), 'utf8');

test('哈奇星球普通小游戏列表启用金币收益但不渲染活动提示栏', () => {
    assert.match(appSource, /showHaqiTownBenefits: getActivePlanetId\(\) === 'haqi' && !launch/);
    assert.match(minigameSource, /showHaqiTownBenefits = false/);
    assert.doesNotMatch(minigameSource, /mh-haqi-town-benefit|哈奇小镇活动/);
    assert.doesNotMatch(minigameSource, /mh-minigame-recommend-intro|mh-minigame-featured-ribbon|今日精选 4 款/);
    assert.match(minigameSource, /list\.innerHTML = renderGameCards\(items\)/);
});

test('小镇活动卡片复用真实金币配置且不改变奖励计算', () => {
    assert.match(minigameSource, /levelRewardCoinRange\(levelRewardConfig\(game\)\)/);
    assert.match(minigameSource, /\$\{coinRange\.min\}-\$\{coinRange\.max\} 金币/);
});