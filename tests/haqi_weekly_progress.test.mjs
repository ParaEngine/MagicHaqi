import assert from 'node:assert/strict';
import test from 'node:test';
import { getHaqiWeeklyProgress } from '../js/haqi_weekly_progress.js';

const NOW = new Date(2026, 7, 5, 12).getTime();
const THIS_WEEK = new Date(2026, 7, 3, 9).getTime();
const LAST_WEEK = new Date(2026, 6, 31, 9).getTime();

test('本周航线只统计本周成功远征和既有矿区摘要', () => {
    const progress = getHaqiWeeklyProgress({
        now: NOW,
        history: [
            { completed: true, expeditionBiome: '荧光沼泽', finishedAt: THIS_WEEK },
            { completed: false, finishedAt: THIS_WEEK },
            { completed: true, finishedAt: LAST_WEEK },
        ],
        bridge: { research: 4, activeSeriesIds: ['series_core_test'] },
    });

    assert.equal(progress.completed, 2);
    assert.deepEqual(progress.goals.map(goal => [goal.current, goal.target, goal.complete]), [
        [1, 2, false],
        [1, 2, false],
        [3, 3, true],
        [1, 1, true],
    ]);
});

test('本周主题研究只统计轮换主题对应生态的成功远征', () => {
    const progress = getHaqiWeeklyProgress({
        now: NOW,
        history: [
            { completed: true, expeditionBiome: '荧光沼泽', finishedAt: THIS_WEEK },
            { completed: true, expeditionBiome: '月湾海滩', finishedAt: THIS_WEEK },
            { completed: true, expeditionBiome: '糖晶沙漠', finishedAt: THIS_WEEK },
        ],
    });

    const themeGoal = progress.goals[1];
    assert.deepEqual(progress.theme, {
        id: 'abyssal',
        label: '深海回音',
        biomes: ['月湾海滩', '荧光沼泽'],
    });
    assert.equal(themeGoal.themeId, 'abyssal');
    assert.equal(themeGoal.current, 2);
    assert.equal(themeGoal.complete, true);
    assert.match(themeGoal.label, /完整通关 2 次/);
    assert.match(themeGoal.hint, /需击败第二章首领/);
});

test('本周航线不会把未来记录计入进度', () => {
    const progress = getHaqiWeeklyProgress({
        now: NOW,
        history: [{ completed: true, finishedAt: NOW + 1 }],
        bridge: { research: 0, activeSeriesIds: [] },
    });

    assert.equal(progress.completed, 0);
    assert.equal(progress.goals[0].current, 0);
});

test('全部周目标完成后仅在当前周开放一次领取', () => {
    const history = [
        { completed: true, expeditionBiome: '荧光沼泽', finishedAt: THIS_WEEK },
        { completed: true, expeditionBiome: '月湾海滩', finishedAt: THIS_WEEK + 1 },
    ];
    const ready = getHaqiWeeklyProgress({
        now: NOW,
        history,
        bridge: { research: 3, activeSeriesIds: ['series_core_test'] },
    });
    const claimed = getHaqiWeeklyProgress({
        now: NOW,
        history,
        bridge: { research: 3, activeSeriesIds: ['series_core_test'] },
        claimedWeekStarts: [ready.weekStart],
    });

    assert.equal(ready.rewardCoins, 120);
    assert.equal(ready.claimable, true);
    assert.equal(ready.claimed, false);
    assert.equal(claimed.claimable, false);
    assert.equal(claimed.claimed, true);
});
