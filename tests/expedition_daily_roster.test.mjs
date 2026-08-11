import assert from 'node:assert/strict';
import test from 'node:test';
import { getDailyExpeditionRoster, markDailyExpeditionExplored } from '../js/expedition.js';

test('每天固定提供三颗星球并保留已探索状态', () => {
    const settlement = {};
    const now = new Date(2026, 6, 31, 10, 0, 0);
    const first = getDailyExpeditionRoster(settlement, { now });

    assert.equal(first.length, 3);
    assert.equal(markDailyExpeditionExplored(settlement, first[0], { now }), true);
    const afterExploring = getDailyExpeditionRoster(settlement, { now });

    assert.equal(afterExploring.length, 3);
    assert.equal(afterExploring[0].explored, true);
    assert.deepEqual(afterExploring.map(item => item.id), first.map(item => item.id));
});

test('次日重置已探索星球并生成新的每日名册', () => {
    const settlement = {};
    const today = new Date(2026, 6, 31, 10, 0, 0);
    const todayRoster = getDailyExpeditionRoster(settlement, { now: today });
    markDailyExpeditionExplored(settlement, todayRoster[0], { now: today });

    const tomorrowRoster = getDailyExpeditionRoster(settlement, { now: new Date(2026, 7, 1, 10, 0, 0) });

    assert.equal(tomorrowRoster.length, 3);
    assert.equal(tomorrowRoster.some(item => item.explored), false);
    assert.notDeepEqual(tomorrowRoster.map(item => item.id), todayRoster.map(item => item.id));
});

test('每日星球生态预告包含遭遇池筛选标签', () => {
    const roster = getDailyExpeditionRoster({}, { now: new Date(2026, 7, 6, 10, 0, 0) });

    for (const expedition of roster) {
        assert.equal(typeof expedition.ecologyPreview?.rareTrace, 'string');
        assert.equal(typeof expedition.ecologyPreview?.mineralSignal, 'string');
        assert.equal(typeof expedition.ecologyPreview?.eventFeature, 'string');
        assert.equal(typeof expedition.ecologyPreview?.strategyHint, 'string');
        assert.ok(expedition.ecologyPreview?.ecologyTags?.length > 0);
        assert.ok(['event', 'merchant', 'camp', 'elite'].includes(expedition.ecologyPreview?.routeNode?.type));
        assert.equal(typeof expedition.ecologyPreview?.routeNode?.label, 'string');
        assert.ok(['event-supply', 'camp-recovery', 'merchant-capsule', 'elite-cache'].includes(expedition.ecologyPreview?.routeNode?.reward?.id));
        assert.equal(typeof expedition.ecologyPreview?.routeNode?.reward?.label, 'string');
    }
});