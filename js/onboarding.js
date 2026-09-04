const COMMON_ONBOARDING_TASKS = Object.freeze([
    {
        id: 'inspect-starter-pet',
        title: '认识你的伙伴',
        description: '打开伙伴属性，看看它的战斗能力。',
        chapter: '相遇',
        icon: '🐾',
        minutes: 2,
        actionLabel: '查看伙伴',
        reward: { coins: 80 },
        targetView: 'petList',
        highlightSelector: '[data-pet-stats]',
        guideSteps: [
            { id: 'open-pet-list', text: '先打开伙伴图鉴', actionLabel: '打开伙伴图鉴', targetView: 'petList', completeOnNavigate: true },
            { id: 'inspect-stats', text: '点击伙伴卡片上的“详情”', selector: '[data-pet-stats]' },
        ],
    },
    {
        id: 'rename-first-pet',
        title: '给伙伴取个名字',
        description: '第一次改名免费，让伙伴拥有自己的名字。',
        chapter: '约定',
        icon: '✦',
        minutes: 2,
        actionLabel: '去取名字',
        reward: { coins: 120 },
        targetView: 'petList',
        highlightSelector: '[data-pet-rename]',
        guideSteps: [
            { id: 'open-rename', text: '打开伙伴的改名窗口', actionLabel: '去取名字', targetView: 'petList', selector: '[data-pet-rename]', triggerSelector: '[data-pet-rename]' },
            { id: 'confirm-rename', text: '输入名字并确认，完成你们的约定', actionLabel: '重新打开改名', targetView: 'petList', triggerSelector: '[data-pet-rename]' },
        ],
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
        description: '把一件家园物品摆到星球上，建立你们的第一处据点。',
        chapter: '安家',
        icon: '🏠',
        minutes: 3,
        actionLabel: '建设据点',
        reward: { coins: 160 },
        targetView: 'home',
        highlightSelector: '',
        guideSteps: [
            { id: 'open-build', text: '打开建造栏，进入布置模式', actionLabel: '开始建设', selector: '#mhFieldDecorBtn, #mhDecorBtn', targetView: 'home', triggerSelector: '#mhFieldDecorBtn, #mhDecorBtn' },
            { id: 'choose-facility', text: '从建造栏选择一件设施', selector: '[data-tray-item]' },
            { id: 'place-facility', text: '点击或拖动到场景中完成摆放' },
        ],
    },
    {
        id: 'complete-first-expedition',
        title: '完成首次远征',
        description: '从今日星图选择目的地，带伙伴完成第一次真正的冒险。',
        chapter: '启航',
        icon: '🚀',
        minutes: 6,
        actionLabel: '打开今日星图',
        reward: { coins: 240 },
        targetView: 'expeditionMap',
        highlightSelector: '#mhExpeditionStart',
        guideSteps: [
            { id: 'open-star-map', text: '打开今日星图', actionLabel: '进入今日星图', targetView: 'expeditionMap', completeOnNavigate: true },
            { id: 'choose-expedition', text: '选择一颗尚未探索的星球', actionLabel: '返回今日星图', targetView: 'expeditionMap', selector: '[data-expedition-id]:not(:disabled)' },
            { id: 'choose-expedition-pet', text: '选择一位出战伙伴', actionLabel: '返回今日星图', targetView: 'expeditionMap', selector: '[data-pet-id]:not(:disabled)' },
            { id: 'start-expedition', text: '确认准备后点击“开始探险”', actionLabel: '返回今日星图', targetView: 'expeditionMap', selector: '#mhExpeditionStart:not(:disabled)' },
            { id: 'finish-expedition', text: '完成远征并带回结算结果' },
        ],
    },
    {
        id: 'review-expedition-settlement',
        title: '查看远征记录',
        description: '打开刚刚的远征记录，清点战利品并完成新手旅程。',
        chapter: '归航',
        icon: '🏆',
        minutes: 2,
        actionLabel: '清点战利品',
        reward: { coins: 120 },
        targetView: 'expeditionMap',
        highlightSelector: '[data-expedition-history]',
        guideSteps: [
            { id: 'open-history', text: '打开最近一条远征记录并清点战利品', actionLabel: '查看记录', targetView: 'expeditionMap', selector: '[data-expedition-history]', triggerSelector: '[data-expedition-history]' },
        ],
    },
]);

export const ONBOARDING_TASKS = DEFAULT_ONBOARDING_TASKS;

const ONBOARDING_VERSION = 2;

export function shouldShowOnboardingPanel(currentView = '') {
    return currentView !== 'login' && currentView !== 'minigames' && currentView !== 'petList';
}

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
    const tasks = getOnboardingTasks(safePlanetId);
    const taskIds = new Set(tasks.map(task => task.id));
    const migratedLegacyOnboarding = safePlanetId !== 'default'
        && !allOnboarding[safePlanetId]
        && Number(legacyOnboarding.version || 0) < ONBOARDING_VERSION
        ? {
            ...legacyOnboarding,
            completedTaskIds: uniqueIds(legacyOnboarding.completedTaskIds).filter(id => taskIds.has(id)),
            claimedRewardTaskIds: uniqueIds(legacyOnboarding.claimedRewardTaskIds).filter(id => taskIds.has(id)),
            completedGuideStepIds: uniqueIds(legacyOnboarding.completedGuideStepIds).filter(id => (
                tasks.some(task => task.guideSteps?.some(step => step.id === id))
            )),
        }
        : {};
    const source = allOnboarding[safePlanetId] && typeof allOnboarding[safePlanetId] === 'object'
        ? allOnboarding[safePlanetId]
        : (safePlanetId === 'default' ? legacyOnboarding : migratedLegacyOnboarding);
    const completedTaskIds = uniqueIds(source.completedTaskIds);
    const claimedRewardTaskIds = uniqueIds(source.claimedRewardTaskIds);
    const nextTask = tasks.find(task => !completedTaskIds.includes(task.id));
    allOnboarding[safePlanetId] = {
        version: ONBOARDING_VERSION,
        activeTaskId: nextTask?.id || '',
        completedTaskIds,
        claimedRewardTaskIds,
        introSeenAt: Number(source.introSeenAt) || 0,
        completedGuideStepIds: uniqueIds(source.completedGuideStepIds),
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

export function shouldPrioritizeOnboarding(settings, planetId = 'default') {
    return getActiveOnboardingTask(settings, planetId) !== null;
}

export function checkOnboardingTask(settings, taskId, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    const tasks = getOnboardingTasks(planetId);
    const task = getOnboardingTask(taskId, planetId);
    if (!task || onboarding.activeTaskId !== task.id || onboarding.completedTaskIds.includes(task.id)) {
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

export function markOnboardingIntroSeen(settings, planetId = 'default', seenAt = Date.now()) {
    const onboarding = ensureOnboardingState(settings, planetId);
    onboarding.introSeenAt = Number(seenAt) || Date.now();
    return onboarding;
}

export function getActiveOnboardingGuideStep(settings, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    const task = getOnboardingTask(onboarding.activeTaskId, planetId);
    return task?.guideSteps?.find(step => !onboarding.completedGuideStepIds.includes(`${task.id}:${step.id}`)) || null;
}

export function completeOnboardingGuideStep(settings, taskId, stepId, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    const task = getOnboardingTask(onboarding.activeTaskId, planetId);
    const activeStep = task?.guideSteps?.find(step => !onboarding.completedGuideStepIds.includes(`${task.id}:${step.id}`)) || null;
    if (task?.id !== taskId || activeStep?.id !== stepId) return { changed: false, onboarding, task, step: activeStep };
    onboarding.completedGuideStepIds.push(`${task.id}:${activeStep.id}`);
    return { changed: true, onboarding, task, step: activeStep };
}

export function getOnboardingProgress(settings, planetId = 'default') {
    const onboarding = ensureOnboardingState(settings, planetId);
    return { completed: onboarding.completedTaskIds.length, total: getOnboardingTasks(planetId).length };
}