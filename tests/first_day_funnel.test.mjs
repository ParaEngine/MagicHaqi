import assert from 'node:assert/strict';
import test from 'node:test';

import {
    FIRST_DAY_EVENTS,
    clearFirstDayFunnel,
    configureFirstDayFunnelReporter,
    createAnalyticsSessionId,
    exportFirstDayFunnel,
    getAnalyticsVisitorId,
    getFirstDayEvents,
    recordFirstDayEvent,
    summarizeFirstDayFunnel,
} from '../js/first_day_funnel.js';

function createStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
}

test('records only allowed events and sanitizes properties', () => {
    const storage = createStorage();
    assert.equal(recordFirstDayEvent('unknown', {}, { storage }), null);
    recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_STARTED, {
        planetId: 'haqi',
        nested: { secret: true },
        long: 'x'.repeat(120),
    }, { storage, now: 100 });
    const [event] = getFirstDayEvents({ storage });
    assert.equal(event.name, 'onboarding_started');
    assert.deepEqual(event.properties, { planetId: 'haqi', long: 'x'.repeat(80) });
});

test('accepts reward follow-up events without changing reward acquisition', () => {
    const storage = createStorage();
    recordFirstDayEvent(FIRST_DAY_EVENTS.REWARD_ACQUIRED, { rewardType: 'home_treasure' }, { storage, now: 100 });
    recordFirstDayEvent(FIRST_DAY_EVENTS.REWARD_VIEWED, { rewardType: 'home_treasure' }, { storage, now: 200 });
    recordFirstDayEvent(FIRST_DAY_EVENTS.REWARD_PLACED, { rewardType: 'home_treasure', firstPlacement: true }, { storage, now: 300 });
    recordFirstDayEvent(FIRST_DAY_EVENTS.REWARD_SHARE_CARD_GENERATED, { rewardType: 'home_treasure', highlightCount: 2 }, { storage, now: 400 });
    assert.deepEqual(getFirstDayEvents({ storage }).map(event => event.name), [
        'reward_acquired',
        'reward_viewed',
        'reward_placed',
        'reward_share_card_generated',
    ]);
});

test('deduplicates stable milestones', () => {
    const storage = createStorage();
    const options = { storage, now: 100, dedupeKey: 'haqi:task:inspect' };
    assert.ok(recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_TASK_COMPLETED, { taskId: 'inspect' }, options));
    assert.equal(recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_TASK_COMPLETED, { taskId: 'inspect' }, options), null);
    assert.equal(getFirstDayEvents({ storage }).length, 1);
});

test('records the final onboarding completion milestone once', () => {
    const storage = createStorage();
    const options = { storage, now: 100, dedupeKey: 'haqi:onboarding-completed' };
    assert.ok(recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_COMPLETED, { taskCount: 5 }, options));
    assert.equal(recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_COMPLETED, { taskCount: 5 }, options), null);
    assert.deepEqual(getFirstDayEvents({ storage }).map(event => event.name), ['onboarding_completed']);
});

test('isolates queues and deduplication between user scopes', () => {
    const storage = createStorage();
    const shared = { storage, now: 100, dedupeKey: 'haqi:task:inspect' };
    assert.ok(recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_TASK_COMPLETED, {}, { ...shared, scope: 'account_1' }));
    assert.ok(recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_TASK_COMPLETED, {}, { ...shared, scope: 'account_2' }));
    assert.equal(getFirstDayEvents({ storage, scope: 'account_1' }).length, 1);
    assert.equal(getFirstDayEvents({ storage, scope: 'account_2' }).length, 1);
    clearFirstDayFunnel({ storage, scope: 'account_1' });
    assert.equal(getFirstDayEvents({ storage, scope: 'account_1' }).length, 0);
    assert.equal(getFirstDayEvents({ storage, scope: 'account_2' }).length, 1);
});

test('keeps a stable anonymous visitor id without exposing account data', () => {
    const storage = createStorage();
    const first = getAnalyticsVisitorId({ storage, now: 100 });
    const second = getAnalyticsVisitorId({ storage, now: 200 });
    assert.match(first, /^v_[a-z0-9]+_[a-z0-9]+$/);
    assert.equal(second, first);
    assert.match(createAnalyticsSessionId(100), /^s_[a-z0-9]+_[a-z0-9]+$/);
});

test('reports sanitized events without making remote failures block local storage', async () => {
    const storage = createStorage();
    const reported = [];
    configureFirstDayFunnelReporter(event => reported.push(event));
    const event = recordFirstDayEvent(FIRST_DAY_EVENTS.HOME_MISSION_CLICKED, {
        missionType: 'care',
        nested: { token: 'secret' },
    }, { storage, scope: 'account_42', now: 300 });
    await Promise.resolve();
    assert.equal(getFirstDayEvents({ storage, scope: 'account_42' }).length, 1);
    assert.equal(reported[0].id, event.id);
    assert.equal(reported[0].scope, 'account_42');
    assert.deepEqual(reported[0].properties, { missionType: 'care' });

    configureFirstDayFunnelReporter(() => Promise.reject(new Error('offline')));
    assert.ok(recordFirstDayEvent(FIRST_DAY_EVENTS.HOME_MISSION_VIEWED, {}, { storage, scope: 'account_42', now: 400 }));
    await Promise.resolve();
    assert.equal(getFirstDayEvents({ storage, scope: 'account_42' }).length, 2);
    configureFirstDayFunnelReporter(null);
});

test('records commercial unlock and payment milestones', () => {
    const storage = createStorage();
    recordFirstDayEvent(FIRST_DAY_EVENTS.UNLOCK_REQUESTED, {
        gameId: 'haqi_xiangqi3',
        scene: 'undo',
        requestId: { secret: true },
    }, { storage, now: 200 });
    recordFirstDayEvent(FIRST_DAY_EVENTS.UNLOCK_FINISHED, {
        gameId: 'haqi_xiangqi3',
        via: 'ad',
        unlocked: true,
    }, { storage, now: 300 });
    recordFirstDayEvent(FIRST_DAY_EVENTS.VIP_PAYMENT_OPENED, { source: 'minigame' }, { storage, now: 400 });
    recordFirstDayEvent(FIRST_DAY_EVENTS.VIP_STATUS_VERIFIED, { isVip: true }, { storage, now: 500 });
    const events = getFirstDayEvents({ storage });
    assert.deepEqual(events.map(event => event.name), [
        'unlock_requested',
        'unlock_finished',
        'vip_payment_opened',
        'vip_status_verified',
    ]);
    assert.deepEqual(events[0].properties, { gameId: 'haqi_xiangqi3', scene: 'undo' });
});

test('records daily return route milestones once per day', () => {
    const storage = createStorage();
    const shared = { storage, now: 600 };
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_VIEWED, { dayKey: '2026-08-20' }, { ...shared, dedupeKey: 'haqi:return:viewed:2026-08-20' });
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_STARTED, { dayKey: '2026-08-20', firstStepId: 'care-pet' }, { ...shared, dedupeKey: 'haqi:return:started:2026-08-20' });
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_STARTED, { dayKey: '2026-08-20', firstStepId: 'care-pet' }, { ...shared, dedupeKey: 'haqi:return:started:2026-08-20' });
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_STEP_COMPLETED, { dayKey: '2026-08-20', stepId: 'care-pet' }, { ...shared, dedupeKey: 'haqi:return:care-pet:2026-08-20' });
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_COMPLETED, { dayKey: '2026-08-20', rewardCoins: 60 }, { ...shared, dedupeKey: 'haqi:return:completed:2026-08-20' });
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_COMPLETED, { dayKey: '2026-08-20', rewardCoins: 60 }, { ...shared, dedupeKey: 'haqi:return:completed:2026-08-20' });

    assert.deepEqual(getFirstDayEvents({ storage }).map(event => event.name), [
        'return_route_viewed',
        'return_route_started',
        'return_route_step_completed',
        'return_route_completed',
    ]);
});

test('caps queue and exports an aggregate summary', () => {
    const storage = createStorage();
    for (let index = 0; index < 305; index += 1) {
        recordFirstDayEvent(FIRST_DAY_EVENTS.EXPEDITION_FINISHED, { passed: index % 2 === 0 }, { storage, now: index + 1 });
    }
    const summary = summarizeFirstDayFunnel({ storage });
    assert.equal(summary.eventCount, 300);
    assert.equal(summary.firstAt, 6);
    assert.equal(summary.counts.expedition_finished, 300);
    const exported = JSON.parse(exportFirstDayFunnel({ storage, now: 999 }));
    assert.equal(exported.exportedAt, 999);
    assert.equal(exported.events.length, 300);
    clearFirstDayFunnel({ storage });
    assert.equal(getFirstDayEvents({ storage }).length, 0);
});