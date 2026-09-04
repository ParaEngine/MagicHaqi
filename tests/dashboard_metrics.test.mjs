import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsApiRequest } from '../analytics/dashboard_api.js';
import { buildOperationsMetrics, normalizeDashboardPayload } from '../analytics/dashboard_metrics.js';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 7, 24);

function event(name, visitorId, offset, properties = {}, sessionId = `${visitorId}-session`) {
    return { id: `${visitorId}-${name}-${offset}`, name, visitorId, sessionId, timestamp: BASE + offset, properties };
}

test('builds unique visitor, session, D1 and first-15-minute funnel metrics', () => {
    const events = [
        event('session_started', 'v1', 0, { viewport: 'mobile' }, 's1'),
        event('home_mission_viewed', 'v1', 1000),
        event('care_action_started', 'v1', 2000),
        event('minigame_finished', 'v1', 3000, { completed: true }),
        event('expedition_started', 'v1', 4000),
        event('expedition_finished', 'v1', 5000, { passed: true }),
        event('session_started', 'v1', DAY, { viewport: 'mobile' }, 's2'),
        event('session_started', 'v2', 6000, { viewport: 'desktop' }, 's3'),
        event('home_mission_viewed', 'v2', 7000),
        event('home_mission_clicked', 'v2', 8000),
        event('expedition_started', 'v2', 20 * 60 * 1000),
        event('session_started', 'v3', DAY, { viewport: 'pad' }, 's4'),
    ];
    const metrics = buildOperationsMetrics(events);
    assert.equal(metrics.visitorCount, 3);
    assert.equal(metrics.sessionCount, 4);
    assert.deepEqual(metrics.d1, { eligibleVisitors: 2, retainedVisitors: 1, rate: 50 });
    assert.deepEqual(metrics.funnel.map(step => step.visitors), [3, 2, 1, 1, 1, 1]);
    assert.equal(metrics.mission.clickRate, 50);
    assert.equal(metrics.expedition.completionRate, 50);
    assert.deepEqual(metrics.devices, { mobile: 1, desktop: 1, pad: 1 });
});

test('normalizes raw event and backend aggregate payloads', () => {
    assert.equal(normalizeDashboardPayload({ events: [event('session_started', 'v1', 0)] }).visitorCount, 1);
    assert.equal(normalizeDashboardPayload({ metrics: { visitorCount: 9 } }).visitorCount, 9);
    assert.throws(() => normalizeDashboardPayload({ unexpected: true }), /数据必须/);
});

test('builds authenticated API requests and rejects invalid endpoints', () => {
    const request = createOperationsApiRequest('https://data.example.com/api/haqi/analytics/operations', {
        startDate: '2026-08-01',
        endDate: '2026-08-27',
        apiKey: 'read-only-key',
    });
    assert.equal(request.url.searchParams.get('startDate'), '2026-08-01');
    assert.equal(request.url.searchParams.get('endDate'), '2026-08-27');
    assert.equal(request.headers['X-API-Key'], 'read-only-key');
    assert.throws(() => createOperationsApiRequest('oyx319'), /完整的 HTTP\(S\) 地址/);
    assert.throws(() => createOperationsApiRequest('file:///tmp/events.json'), /完整的 HTTP\(S\) 地址/);
});