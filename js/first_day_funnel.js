const STORAGE_KEY = 'mh_first_day_funnel_v1';
const VISITOR_KEY = 'mh_analytics_visitor_v1';
const MAX_EVENTS = 300;
let scopeResolver = null;
let eventReporter = null;

export const FIRST_DAY_EVENTS = Object.freeze({
    SESSION_STARTED: 'session_started',
    HOME_MISSION_VIEWED: 'home_mission_viewed',
    HOME_MISSION_CLICKED: 'home_mission_clicked',
    HOME_MISSION_COMPLETED: 'home_mission_completed',
    CARE_ACTION_STARTED: 'care_action_started',
    TOWN_INTERACTION_COMPLETED: 'town_interaction_completed',
    MINIGAME_STARTED: 'minigame_started',
    MINIGAME_FINISHED: 'minigame_finished',
    REWARD_ACQUIRED: 'reward_acquired',
    REWARD_VIEWED: 'reward_viewed',
    REWARD_PLACED: 'reward_placed',
    REWARD_SHARE_CARD_GENERATED: 'reward_share_card_generated',
    ONBOARDING_STARTED: 'onboarding_started',
    ONBOARDING_DEFERRED: 'onboarding_deferred',
    ONBOARDING_TASK_COMPLETED: 'onboarding_task_completed',
    ONBOARDING_COMPLETED: 'onboarding_completed',
    EXPEDITION_STARTED: 'expedition_started',
    EXPEDITION_FINISHED: 'expedition_finished',
    EXPEDITION_HISTORY_REVIEWED: 'expedition_history_reviewed',
    RETURN_ROUTE_VIEWED: 'return_route_viewed',
    RETURN_ROUTE_STARTED: 'return_route_started',
    RETURN_ROUTE_STEP_COMPLETED: 'return_route_step_completed',
    RETURN_ROUTE_COMPLETED: 'return_route_completed',
    UNLOCK_REQUESTED: 'unlock_requested',
    UNLOCK_FINISHED: 'unlock_finished',
    VIP_PAYMENT_OPENED: 'vip_payment_opened',
    VIP_STATUS_VERIFIED: 'vip_status_verified',
});

const ALLOWED_EVENTS = new Set(Object.values(FIRST_DAY_EVENTS));

function safeStorage(storage) {
    if (storage) return storage;
    try { return globalThis.localStorage || null; } catch (_) { return null; }
}

function resolveScope(scope) {
    const value = scope ?? scopeResolver?.();
    return cleanText(value || 'anonymous', 80).replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous';
}

function getStorageKey(scope) {
    return `${STORAGE_KEY}:${resolveScope(scope)}`;
}

function readQueue(storage, scope) {
    const target = safeStorage(storage);
    if (!target) return [];
    try {
        const value = JSON.parse(target.getItem(getStorageKey(scope)) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (_) {
        return [];
    }
}

function cleanText(value, maxLength = 80) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function cleanProperties(properties = {}) {
    const source = properties && typeof properties === 'object' ? properties : {};
    const result = {};
    for (const [key, value] of Object.entries(source).slice(0, 16)) {
        const safeKey = cleanText(key, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!safeKey) continue;
        if (typeof value === 'boolean') result[safeKey] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) result[safeKey] = value;
        else if (typeof value === 'string') result[safeKey] = cleanText(value);
    }
    return result;
}

export function configureFirstDayFunnelScope(resolver) {
    scopeResolver = typeof resolver === 'function' ? resolver : null;
}

export function configureFirstDayFunnelReporter(reporter) {
    eventReporter = typeof reporter === 'function' ? reporter : null;
}

export function getAnalyticsVisitorId(options = {}) {
    const storage = safeStorage(options.storage);
    if (!storage) return 'unavailable';
    try {
        const existing = cleanText(storage.getItem(VISITOR_KEY), 64).replace(/[^a-zA-Z0-9_-]/g, '');
        if (existing) return existing;
        const now = Math.max(0, Number(options.now) || Date.now());
        const visitorId = `v_${now.toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        storage.setItem(VISITOR_KEY, visitorId);
        return visitorId;
    } catch (_) {
        return 'unavailable';
    }
}

export function createAnalyticsSessionId(now = Date.now()) {
    return `s_${Math.max(0, Number(now) || Date.now()).toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function recordFirstDayEvent(name, properties = {}, options = {}) {
    if (!ALLOWED_EVENTS.has(name)) return null;
    const storage = safeStorage(options.storage);
    if (!storage) return null;
    const now = Math.max(0, Number(options.now) || Date.now());
    const dedupeKey = cleanText(options.dedupeKey, 120);
    const queue = readQueue(storage, options.scope);
    if (dedupeKey && queue.some(event => event.dedupeKey === dedupeKey)) return null;
    const event = {
        id: `${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        timestamp: now,
        properties: cleanProperties(properties),
        ...(dedupeKey ? { dedupeKey } : {}),
    };
    try {
        storage.setItem(getStorageKey(options.scope), JSON.stringify([...queue, event].slice(-MAX_EVENTS)));
        if (eventReporter) {
            try {
                Promise.resolve(eventReporter({
                    ...event,
                    visitorId: getAnalyticsVisitorId({ storage, now }),
                    scope: resolveScope(options.scope),
                })).catch(() => {});
            } catch (_) {}
        }
        return event;
    } catch (_) {
        return null;
    }
}

export function getFirstDayEvents(options = {}) {
    return readQueue(options.storage, options.scope).map(event => ({ ...event, properties: { ...(event.properties || {}) } }));
}

export function summarizeFirstDayFunnel(options = {}) {
    const events = getFirstDayEvents(options);
    const counts = {};
    for (const event of events) counts[event.name] = (counts[event.name] || 0) + 1;
    return {
        eventCount: events.length,
        firstAt: events[0]?.timestamp || 0,
        lastAt: events.at(-1)?.timestamp || 0,
        counts,
    };
}

export function exportFirstDayFunnel(options = {}) {
    return JSON.stringify({
        version: 1,
        exportedAt: Math.max(0, Number(options.now) || Date.now()),
        summary: summarizeFirstDayFunnel(options),
        events: getFirstDayEvents(options),
    }, null, 2);
}

export function clearFirstDayFunnel(options = {}) {
    try { safeStorage(options.storage)?.removeItem(getStorageKey(options.scope)); } catch (_) {}
}