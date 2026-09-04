const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_WINDOW_MS = 15 * 60 * 1000;

export const FUNNEL_STEPS = Object.freeze([
    { event: 'session_started', label: '进入产品' },
    { event: 'home_mission_viewed', label: '看到今日目标' },
    { event: 'care_action_started', label: '开始照料伙伴' },
    { event: 'minigame_finished', label: '完成小镇互动' },
    { event: 'expedition_started', label: '开始首次远征' },
    { event: 'expedition_finished', label: '完成首次远征' },
]);

function validEvents(events) {
    return (Array.isArray(events) ? events : [])
        .filter(event => event && typeof event.name === 'string' && Number.isFinite(Number(event.timestamp)))
        .map(event => ({
            ...event,
            timestamp: Number(event.timestamp),
            visitorId: String(event.visitorId || event.properties?.visitorId || 'unknown'),
            sessionId: String(event.sessionId || event.properties?.sessionId || event.id || 'unknown'),
            properties: event.properties && typeof event.properties === 'object' ? event.properties : {},
        }))
        .sort((left, right) => left.timestamp - right.timestamp);
}

function rate(numerator, denominator) {
    return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function utcDay(timestamp) {
    return Math.floor(timestamp / DAY_MS);
}

function uniqueVisitors(events, eventName, predicate = () => true) {
    return new Set(events.filter(event => event.name === eventName && predicate(event)).map(event => event.visitorId)).size;
}

export function buildOperationsMetrics(inputEvents) {
    const events = validEvents(inputEvents);
    const visitors = new Set(events.map(event => event.visitorId));
    const sessions = new Set(events.filter(event => event.name === 'session_started').map(event => event.sessionId));
    const firstTimestampByVisitor = new Map();
    const daysByVisitor = new Map();
    for (const event of events) {
        if (!firstTimestampByVisitor.has(event.visitorId)) firstTimestampByVisitor.set(event.visitorId, event.timestamp);
        if (!daysByVisitor.has(event.visitorId)) daysByVisitor.set(event.visitorId, new Set());
        daysByVisitor.get(event.visitorId).add(utcDay(event.timestamp));
    }

    let eligibleD1Visitors = 0;
    let retainedD1Visitors = 0;
    const latestDay = events.length ? utcDay(events.at(-1).timestamp) : 0;
    for (const [visitorId, firstTimestamp] of firstTimestampByVisitor) {
        const firstDay = utcDay(firstTimestamp);
        if (firstDay >= latestDay) continue;
        eligibleD1Visitors += 1;
        if (daysByVisitor.get(visitorId)?.has(firstDay + 1)) retainedD1Visitors += 1;
    }

    const firstWindowEvents = events.filter(event => {
        const firstTimestamp = firstTimestampByVisitor.get(event.visitorId);
        return event.timestamp - firstTimestamp <= FIRST_WINDOW_MS;
    });
    const funnel = FUNNEL_STEPS.map(step => ({
        ...step,
        visitors: uniqueVisitors(firstWindowEvents, step.event, event => event.properties.completed !== false),
    }));
    const firstStepVisitors = funnel[0]?.visitors || 0;
    funnel.forEach((step, index) => {
        step.conversionRate = rate(step.visitors, firstStepVisitors);
        step.stepRate = index === 0 ? 100 : rate(step.visitors, funnel[index - 1].visitors);
        step.dropoffVisitors = index === 0 ? 0 : Math.max(0, funnel[index - 1].visitors - step.visitors);
    });

    const missionViews = uniqueVisitors(events, 'home_mission_viewed');
    const missionClicks = uniqueVisitors(events, 'home_mission_clicked');
    const missionCompleted = uniqueVisitors(events, 'home_mission_completed');
    const expeditionStarted = uniqueVisitors(events, 'expedition_started');
    const expeditionFinished = uniqueVisitors(events, 'expedition_finished', event => event.properties.passed !== false);
    const deviceCounts = {};
    for (const event of events.filter(event => event.name === 'session_started')) {
        const viewport = String(event.properties.viewport || 'unknown');
        if (!deviceCounts[viewport]) deviceCounts[viewport] = new Set();
        deviceCounts[viewport].add(event.visitorId);
    }

    return {
        generatedAt: Date.now(),
        eventCount: events.length,
        visitorCount: visitors.size,
        sessionCount: sessions.size,
        d1: { eligibleVisitors: eligibleD1Visitors, retainedVisitors: retainedD1Visitors, rate: rate(retainedD1Visitors, eligibleD1Visitors) },
        funnel,
        mission: { viewedVisitors: missionViews, clickedVisitors: missionClicks, completedVisitors: missionCompleted, clickRate: rate(missionClicks, missionViews), completionRate: rate(missionCompleted, missionViews) },
        expedition: { startedVisitors: expeditionStarted, finishedVisitors: expeditionFinished, completionRate: rate(expeditionFinished, expeditionStarted) },
        devices: Object.fromEntries(Object.entries(deviceCounts).map(([name, ids]) => [name, ids.size])),
    };
}

export function normalizeDashboardPayload(payload) {
    if (Array.isArray(payload)) return buildOperationsMetrics(payload);
    if (Array.isArray(payload?.events)) return buildOperationsMetrics(payload.events);
    if (payload?.metrics && typeof payload.metrics === 'object') return payload.metrics;
    if (payload && typeof payload === 'object' && Number.isFinite(Number(payload.visitorCount))) return payload;
    throw new Error('数据必须是事件数组、{ events } 或 { metrics }');
}