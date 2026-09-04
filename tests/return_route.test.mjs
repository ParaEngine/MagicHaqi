import assert from 'node:assert/strict';
import test from 'node:test';

import {
    completeReturnRouteStep,
    ensureReturnRoute,
    getReturnRouteProgress,
    RETURN_ROUTE_REWARD_COINS,
    RETURN_ROUTE_STEPS,
    scheduleReturnRoute,
} from '../js/return_route.js';

const DAY_ONE = new Date(2026, 7, 19, 10).getTime();
const DAY_TWO = new Date(2026, 7, 20, 10).getTime();
const DAY_THREE = new Date(2026, 7, 21, 10).getTime();

test('新手完成后到次日才解锁回访航线', () => {
    const settings = {};
    scheduleReturnRoute(settings, 'haqi', DAY_ONE);

    assert.equal(getReturnRouteProgress(settings, 'haqi', DAY_ONE).available, false);
    assert.equal(getReturnRouteProgress(settings, 'haqi', DAY_TWO).available, true);
});

test('旧存档首次加载时可以直接开始今日航线', () => {
    const settings = {};
    const route = ensureReturnRoute(settings, 'haqi', DAY_TWO);

    assert.equal(route.dayKey, '2026-08-20');
    assert.equal(getReturnRouteProgress(settings, 'haqi', DAY_TWO).available, true);
});

test('三步可以任意顺序完成且同一步不能重复', () => {
    const settings = {};
    ensureReturnRoute(settings, 'haqi', DAY_TWO);

    assert.equal(completeReturnRouteStep(settings, 'start-expedition', 'haqi', DAY_TWO).changed, true);
    assert.equal(completeReturnRouteStep(settings, 'start-expedition', 'haqi', DAY_TWO).changed, false);
    assert.equal(completeReturnRouteStep(settings, 'care-pet', 'haqi', DAY_TWO).changed, true);
    const final = completeReturnRouteStep(settings, 'tend-home', 'haqi', DAY_TWO);
    assert.equal(final.progress.finished, true);
    assert.equal(final.rewardClaimed, true);
    assert.equal(RETURN_ROUTE_REWARD_COINS, 60);
});

test('每日刷新步骤且奖励每天只能领取一次', () => {
    const settings = {};
    ensureReturnRoute(settings, 'haqi', DAY_TWO);
    for (const step of RETURN_ROUTE_STEPS) completeReturnRouteStep(settings, step.id, 'haqi', DAY_TWO);

    const duplicate = completeReturnRouteStep(settings, 'care-pet', 'haqi', DAY_TWO);
    assert.equal(duplicate.changed, false);
    assert.equal(getReturnRouteProgress(settings, 'haqi', DAY_TWO).rewardClaimed, true);

    const nextDay = getReturnRouteProgress(settings, 'haqi', DAY_THREE);
    assert.equal(nextDay.completed, 0);
    assert.equal(nextDay.rewardClaimed, false);
});