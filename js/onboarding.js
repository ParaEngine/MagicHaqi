const COMMON_ONBOARDING_TASKS = Object.freeze([
    {
        id: 'inspect-starter-pet',
        title: '认识你的伙伴',
        description: '打开伙伴属性，看看它的战斗能力。',
        reward: { coins: 80 },
        targetView: 'petList',
        highlightSelector: '[data-pet-stats]',
    },
    {
        id: 'rename-first-pet',
        title: '给伙伴取个名字',
        description: '第一次改名免费，让伙伴拥有自己的名字。',
        reward: { coins: 120 },
        targetView: 'petList',
        highlightSelector: '[data-pet-rename]',
    },
]);

const DEFAULT_ONBOARDING_TASKS = Object.freeze([
    ...COMMON_ONBOARDING_TASKS,
    {
        id: 'feed-first-pet',
        title: '喂食你的伙伴',
        description: '给伙伴喂一次喜欢的食物，让它补充活力。',
        reward: { coins: 160 },
        targetView: 'home',
        highlightSelector: '',
    },
    {
        id: 'complete-first-minigame',
        title: '完成一次小游戏',
        description: '和伙伴一起完成一个小游戏，收获快乐与奖励。',
        reward: { coins: 240 },
        targetView: 'minigames',
        highlightSelector: '',
    },
    {
        id: 'place-first-facility',
        title: '布置你的家园',
        description: '把一件家园物品摆放到合适的位置。',
        reward: { coins: 120 },
        targetView: 'home',
        highlightSelector: '',
    },
]);

const HAQI_ONBOARDING_TASKS = Object.freeze([
    ...COMMON_ONBOARDING_TASKS,
    {
        id: 'place-first-facility',
        title: '建设第一处设施',
        description: '把一件家园物品摆放到合适的位置。',
        reward: { coins: 160 },
        targetView: 'home',
        highlightSelector: '',
    },
    {
        id: 'complete-first-expedition',
        title: '完成首次远征',
        description: '带伙伴完成一次星图远征，结果会写入远征记录。',
        reward: { coins: 240 },
        targetView: 'expeditionMap',
        highlightSelector: '#mhExpeditionStart',
    },
    {
        id: 'review-expedition-settlement',
        title: '查看远征记录',
        description: '打开一条最近远征记录，确认本次旅程的结果。',
        reward: { coins: 120 },
        targetView: 'expeditionMap',
        highlightSelector: '[data-expedition-history]',
    },
]);

export const ONBOARDING_TASKS = DEFAULT_ONBOARDING_TASKS;

const ONBOARDING_VERSION = 2;

export function getOnboardingTasks(planetId = 'default') {
    return String(planetId || '').trim() === 'haqi'
        ? HAQI_ONBOARDING_TASKS
        : DEFAULT_ONBOARDING_TASKS;
}

function uniqueIds(value) {
    return Array.isArray(value) ? [...new Set(value.map(String))] : [];
}

export function ensureOnboardingState(settings = {}, planetId = 'default') {
    const safeSettings = settings && typeof settings === 'object' ? settings : {};
    const safePlanetId = String(planetId || 'default').trim() || 'default';
    const legacyOnboarding = safeSettings.onboarding && typeof safeSettings.onboarding === 'object'
        ? safeSettings.onboarding
        : {};
    const allOnboarding = safeSettings.onboardingByPlanet && typeof safeSettings.onboardingByPlanet === 'object'
        ? safeSettings.onboardingByPlanet
        : {};
    const source = allOnboarding[safePlanetId] && typeof allOnboarding[safePlanetId] === 'object'
        ? allOnboarding[safePlanetId]
        : (safePlanetId === 'default' ? legacyOnboarding : {});
    const tasks = getOnboardingTasks(safePlanetId);
    const completedTaskIds = uniqueIds(source.completedTaskIds);
    const claimedRewardTaskIds = uniqueIds(source.claimedRewardTaskIds);
    const nextTask = tasks.find(task => !completedTaskIds.includes(task.id));
    allOnboarding[safePlanetId] = {
        version: ONBOARDING_VERSION,
        activeTaskId: nextTask?.id || '',
        completedTaskIds,
        claimedRewardTaskIds,
        dismissedHints: source.dismissedHints && typeof source.dismissedHints === 'object'
            ? { ...source.dismissedHints }
            : {},
    };
    safeSettings.onboardingByPlanet = allOnboarding;
    if (safePlanetId === 'default') safeSettings.onboarding = allOnboarding.default;
    return allOnboarding[safePlanetId];
}

export function getOnboardingTask(taskId, planetId = 'default') {
    return getOnboardingTasks(planetId).find(task => task.id === taskId) || null;
}

export function getActiveOnboardingTask(settings, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    return getOnboardingTask(onboarding.activeTaskId, planetId);
}

export function checkOnboardingTask(settings, taskId, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    const tasks = getOnboardingTasks(planetId);
    const task = getOnboardingTask(taskId, planetId);
    if (!task || onboarding.completedTaskIds.includes(task.id)) {
        return { changed: false, task, onboarding };
    }
    onboarding.completedTaskIds.push(task.id);
    onboarding.activeTaskId = tasks.find(item => !onboarding.completedTaskIds.includes(item.id))?.id || '';
    return { changed: true, task, onboarding };
}

export function claimOnboardingReward(settings, taskId, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    const task = getOnboardingTask(taskId, planetId);
    if (!task || !onboarding.completedTaskIds.includes(task.id) || onboarding.claimedRewardTaskIds.includes(task.id)) {
        return { claimed: false, task, onboarding };
    }
    onboarding.claimedRewardTaskIds.push(task.id);
    return { claimed: true, task, onboarding };
}

export function dismissOnboardingHint(settings, taskId, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    onboarding.dismissedHints[taskId] = Date.now();
    return onboarding;
}

export function restoreOnboardingHint(settings, taskId, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    delete onboarding.dismissedHints[taskId];
    return onboarding;
}

export function getOnboardingProgress(settings, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    return { completed: onboarding.completedTaskIds.length, total: getOnboardingTasks(planetId).length };
}