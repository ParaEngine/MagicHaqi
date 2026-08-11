import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ONBOARDING_TASKS,
    getOnboardingTasks,
    checkOnboardingTask,
    claimOnboardingReward,
    dismissOnboardingHint,
    ensureOnboardingState,
    getActiveOnboardingTask,
    restoreOnboardingHint,
} from '../js/onboarding.js';

test('新手任务按五步顺序推进', () => {
    const settings = {};
    assert.equal(getActiveOnboardingTask(settings)?.id, 'inspect-starter-pet');

    for (const task of ONBOARDING_TASKS) {
        assert.equal(checkOnboardingTask(settings, task.id).changed, true);
    }

    assert.equal(getActiveOnboardingTask(settings), null);
    assert.deepEqual(settings.onboarding.completedTaskIds, ONBOARDING_TASKS.map(task => task.id));
});

test('奖励只能在任务完成后领取一次', () => {
    const settings = {};
    ensureOnboardingState(settings);
    assert.equal(claimOnboardingReward(settings, 'inspect-starter-pet').claimed, false);

    checkOnboardingTask(settings, 'inspect-starter-pet');
    assert.equal(claimOnboardingReward(settings, 'inspect-starter-pet').claimed, true);
    assert.equal(claimOnboardingReward(settings, 'inspect-starter-pet').claimed, false);
});

test('重复完成事件不重复推进任务', () => {
    const settings = {};
    checkOnboardingTask(settings, 'complete-first-expedition', 'haqi');
    assert.equal(checkOnboardingTask(settings, 'complete-first-expedition', 'haqi').changed, false);
    assert.equal(settings.onboardingByPlanet.haqi.completedTaskIds.filter(id => id === 'complete-first-expedition').length, 1);
});

test('收起的任务抽屉可以恢复当前目标', () => {
    const settings = {};
    dismissOnboardingHint(settings, 'inspect-starter-pet');
    assert.ok(settings.onboarding.dismissedHints['inspect-starter-pet']);

    restoreOnboardingHint(settings, 'inspect-starter-pet');
    assert.equal(settings.onboarding.dismissedHints['inspect-starter-pet'], undefined);
});

test('完成第三个任务后会显示首次远征任务', () => {
    const settings = {};
    for (const task of getOnboardingTasks('haqi').slice(0, 3)) {
        checkOnboardingTask(settings, task.id, 'haqi');
    }

    assert.equal(getActiveOnboardingTask(settings, 'haqi')?.id, 'complete-first-expedition');
});

test('完成第四个任务后会显示查看远征记录任务', () => {
    const settings = {};
    for (const task of getOnboardingTasks('haqi').slice(0, 4)) {
        checkOnboardingTask(settings, task.id, 'haqi');
    }

    assert.equal(getActiveOnboardingTask(settings, 'haqi')?.id, 'review-expedition-settlement');
});

test('蛋蛋星球使用养成任务而非远征任务', () => {
    const tasks = getOnboardingTasks('default');
    assert.deepEqual(tasks.slice(2).map(task => task.id), [
        'feed-first-pet',
        'complete-first-minigame',
        'place-first-facility',
    ]);
});

test('两颗星球的新手任务进度彼此独立', () => {
    const settings = {};
    checkOnboardingTask(settings, 'inspect-starter-pet', 'default');

    assert.equal(getActiveOnboardingTask(settings, 'default')?.id, 'rename-first-pet');
    assert.equal(getActiveOnboardingTask(settings, 'haqi')?.id, 'inspect-starter-pet');
});