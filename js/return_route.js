export const RETURN_ROUTE_REWARD_COINS = 60;

export const RETURN_ROUTE_STEPS = Object.freeze([
    Object.freeze({ id: 'care-pet', title: '照顾一次伙伴', targetView: 'home' }),
    Object.freeze({ id: 'tend-home', title: '打理一次家园', targetView: 'home' }),
    Object.freeze({ id: 'start-expedition', title: '从每日星图启航', targetView: 'expeditionMap' }),
]);

function dayKey(now = Date.now()) {
    const date = new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function nextDayKey(now = Date.now()) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    return dayKey(date);
}

function uniqueStepIds(value) {
    const allowed = new Set(RETURN_ROUTE_STEPS.map(step => step.id));
    return Array.isArray(value) ? [...new Set(value.map(String).filter(id => allowed.has(id)))] : [];
}

function routeStore(settings) {
    const safeSettings = settings && typeof settings === 'object' ? settings : {};
    if (!safeSettings.returnRouteByPlanet || typeof safeSettings.returnRouteByPlanet !== 'object') {
        safeSettings.returnRouteByPlanet = {};
    }
    return { safeSettings, routes: safeSettings.returnRouteByPlanet };
}

export function scheduleReturnRoute(settings, planetId = 'haqi', now = Date.now()) {
    const { routes } = routeStore(settings);
    const id = String(planetId || 'haqi');
    if (!routes[id]) routes[id] = { unlockDayKey: nextDayKey(now), dayKey: '', completedStepIds: [], rewardClaimed: false };
    return routes[id];
}

export function ensureReturnRoute(settings, planetId = 'haqi', now = Date.now()) {
    const { routes } = routeStore(settings);
    const id = String(planetId || 'haqi');
    const today = dayKey(now);
    const source = routes[id] && typeof routes[id] === 'object'
        ? routes[id]
        : { unlockDayKey: today };
    const unlocked = today >= String(source.unlockDayKey || today);
    const sameDay = source.dayKey === today;
    source.unlockDayKey = String(source.unlockDayKey || today);
    source.dayKey = unlocked ? today : '';
    source.completedStepIds = unlocked && sameDay ? uniqueStepIds(source.completedStepIds) : [];
    source.rewardClaimed = unlocked && sameDay && source.rewardClaimed === true;
    routes[id] = source;
    return source;
}

export function getReturnRouteProgress(settings, planetId = 'haqi', now = Date.now()) {
    const route = ensureReturnRoute(settings, planetId, now);
    const available = route.dayKey === dayKey(now);
    return {
        available,
        unlockDayKey: route.unlockDayKey,
        dayKey: route.dayKey,
        completedStepIds: [...route.completedStepIds],
        completed: route.completedStepIds.length,
        total: RETURN_ROUTE_STEPS.length,
        finished: available && route.completedStepIds.length === RETURN_ROUTE_STEPS.length,
        rewardClaimed: route.rewardClaimed,
    };
}

export function completeReturnRouteStep(settings, stepId, planetId = 'haqi', now = Date.now()) {
    const route = ensureReturnRoute(settings, planetId, now);
    const progress = getReturnRouteProgress(settings, planetId, now);
    const step = RETURN_ROUTE_STEPS.find(item => item.id === stepId) || null;
    if (!progress.available || !step || route.completedStepIds.includes(step.id)) {
        return { changed: false, step, progress };
    }
    route.completedStepIds.push(step.id);
    const finished = route.completedStepIds.length === RETURN_ROUTE_STEPS.length;
    const rewardClaimed = finished && route.rewardClaimed !== true;
    if (rewardClaimed) route.rewardClaimed = true;
    return {
        changed: true,
        step,
        rewardClaimed,
        progress: getReturnRouteProgress(settings, planetId, now),
    };
}