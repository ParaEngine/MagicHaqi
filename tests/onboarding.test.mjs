import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ONBOARDING_TASKS,
    completeOnboardingGuideStep,
    getActiveOnboardingGuideStep,
    getOnboardingTasks,
    markOnboardingIntroSeen,
    checkOnboardingTask,
    claimOnboardingReward,
    dismissOnboardingHint,
    ensureOnboardingState,
    getActiveOnboardingTask,
    restoreOnboardingHint,
    shouldShowOnboardingPanel,
    shouldPrioritizeOnboarding,
} from '../js/onboarding.js';

test('新手面板不覆盖登录页、小游戏和宠物图鉴视图', () => {
    assert.equal(shouldShowOnboardingPanel('login'), false);
    assert.equal(shouldShowOnboardingPanel('minigames'), false);
    assert.equal(shouldShowOnboardingPanel('petList'), false);
    assert.equal(shouldShowOnboardingPanel('home'), true);
    assert.equal(shouldShowOnboardingPanel('expeditionMap'), true);
});

test('完成态航线在业务页由应用层收成抽屉', async () => {
    const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../js/app.js', import.meta.url), 'utf8'));

    assert.match(source, /const compactOutsideHome = state\.currentView !== 'home'/);
    assert.match(source, /if \(compactOutsideHome\) \{\s*navigateToView\('home'\)/);
    assert.match(source, /function renderHaqiExplorationArchiveRoute\(\)[\s\S]*?renderHaqiExplorationArchive\([\s\S]*?renderOnboardingPanel\(\);\s*\n}/);
});

test('新手任务按五步顺序推进', () => {
    const settings = {};
    assert.equal(getActiveOnboardingTask(settings)?.id, 'inspect-starter-pet');

    for (const task of ONBOARDING_TASKS) {
        assert.equal(checkOnboardingTask(settings, task.id).changed, true);
    }

    assert.equal(getActiveOnboardingTask(settings), null);
    assert.deepEqual(settings.onboarding.completedTaskIds, ONBOARDING_TASKS.map(task => task.id));
});

test('哈奇首页只在五步航线完成后恢复日常目标', () => {
    const settings = {};
    assert.equal(shouldPrioritizeOnboarding(settings, 'haqi'), true);

    for (const task of getOnboardingTasks('haqi')) {
        checkOnboardingTask(settings, task.id, 'haqi');
    }

    assert.equal(shouldPrioritizeOnboarding(settings, 'haqi'), false);
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
    for (const task of getOnboardingTasks('haqi').slice(0, 3)) {
        checkOnboardingTask(settings, task.id, 'haqi');
    }
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

test('旧版全局进度首次进入哈奇星球时只迁移兼容任务', () => {
    const settings = {
        onboarding: {
            completedTaskIds: ['inspect-starter-pet', 'rename-first-pet', 'feed-first-pet'],
            claimedRewardTaskIds: ['inspect-starter-pet', 'feed-first-pet'],
            introSeenAt: 123,
        },
    };

    const onboarding = ensureOnboardingState(settings, 'haqi');
    assert.deepEqual(onboarding.completedTaskIds, ['inspect-starter-pet', 'rename-first-pet']);
    assert.deepEqual(onboarding.claimedRewardTaskIds, ['inspect-starter-pet']);
    assert.equal(onboarding.introSeenAt, 123);
    assert.equal(onboarding.activeTaskId, 'place-first-facility');
});

test('哈奇星球新手航线总时长为十五分钟', () => {
    const tasks = getOnboardingTasks('haqi');
    assert.equal(tasks.length, 5);
    assert.equal(tasks.reduce((total, task) => total + task.minutes, 0), 15);
    assert.ok(tasks.every(task => task.chapter && task.icon && task.actionLabel));
});

test('序章观看状态按星球隔离且不推进任务', () => {
    const settings = {};
    markOnboardingIntroSeen(settings, 'haqi', 123456);

    assert.equal(settings.onboardingByPlanet.haqi.introSeenAt, 123456);
    assert.equal(ensureOnboardingState(settings, 'default').introSeenAt, 0);
    assert.equal(getActiveOnboardingTask(settings, 'haqi')?.id, 'inspect-starter-pet');
});

test('教学子步骤只能按顺序推进且不会代替任务完成', () => {
    const settings = {};
    assert.equal(getActiveOnboardingGuideStep(settings, 'haqi')?.id, 'open-pet-list');
    assert.equal(completeOnboardingGuideStep(settings, 'inspect-starter-pet', 'inspect-stats', 'haqi').changed, false);

    assert.equal(completeOnboardingGuideStep(settings, 'inspect-starter-pet', 'open-pet-list', 'haqi').changed, true);
    assert.equal(getActiveOnboardingGuideStep(settings, 'haqi')?.id, 'inspect-stats');
    assert.equal(getActiveOnboardingTask(settings, 'haqi')?.id, 'inspect-starter-pet');
});

test('非当前任务的点击不能推进教学步骤', () => {
    const settings = {};
    assert.equal(completeOnboardingGuideStep(settings, 'rename-first-pet', 'open-rename', 'haqi').changed, false);
    assert.equal(getActiveOnboardingGuideStep(settings, 'haqi')?.id, 'open-pet-list');
});

test('非当前任务的业务事件不能越级完成后续任务', () => {
    const settings = {};
    for (const task of getOnboardingTasks('haqi').slice(0, 3)) {
        checkOnboardingTask(settings, task.id, 'haqi');
    }

    assert.equal(checkOnboardingTask(settings, 'review-expedition-settlement', 'haqi').changed, false);
    assert.equal(getActiveOnboardingTask(settings, 'haqi')?.id, 'complete-first-expedition');
    assert.deepEqual(settings.onboardingByPlanet.haqi.completedTaskIds, [
        'inspect-starter-pet',
        'rename-first-pet',
        'place-first-facility',
    ]);
});

test('远征恢复入口不会把真实操作标记为导航完成', () => {
    const expeditionTask = getOnboardingTasks('haqi').find(task => task.id === 'complete-first-expedition');
    const [openMapStep, ...interactionSteps] = expeditionTask.guideSteps;

    assert.equal(openMapStep.completeOnNavigate, true);
    for (const step of interactionSteps.slice(0, 3)) {
        assert.equal(step.targetView, 'expeditionMap');
        assert.equal(step.actionLabel, '返回今日星图');
        assert.ok(step.selector);
        assert.notEqual(step.completeOnNavigate, true);
    }
});