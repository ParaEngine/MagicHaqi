import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createRewardOutcomeReturnTracker,
    getCollectibleSeriesOutcomes,
    getCollectibleSeriesProgress,
    REWARD_OUTCOME_TARGET_VIEWS,
} from '../js/reward_outcome_core.js';

test('routes each important expedition outcome to its matching review view', () => {
    assert.deepEqual(REWARD_OUTCOME_TARGET_VIEWS, {
        treasure: 'inventory',
        pets: 'petList',
        collection: 'haqiExplorationArchive',
    });
});

test('returns from one expedition outcome review to the map exactly once', () => {
    const tracker = createRewardOutcomeReturnTracker();
    tracker.begin(REWARD_OUTCOME_TARGET_VIEWS.treasure);

    assert.equal(tracker.consume('inventory', 'home'), 'expeditionMap');
    assert.equal(tracker.consume('inventory', 'home'), 'home');
});

test('does not alter normal navigation for unrelated or invalid review views', () => {
    const tracker = createRewardOutcomeReturnTracker();
    tracker.begin('shop');
    assert.equal(tracker.consume('inventory', 'home'), 'home');

    tracker.begin(REWARD_OUTCOME_TARGET_VIEWS.collection);
    assert.equal(tracker.consume('petList', 'home'), 'home');
    assert.equal(tracker.consume('haqiExplorationArchive', 'home'), 'home');
});

test('summarizes every collectible series from inventory', () => {
    const progress = getCollectibleSeriesProgress({ gift_cloud_tea: 1, gift_ember_tea: 2 });
    assert.equal(progress.length, 5);
    assert.deepEqual(progress.find(item => item.id === 'tea'), {
        id: 'tea', name: '茶饮', icon: '🍵', currentCount: 2, totalCount: 4, completed: false,
    });
});

test('reports new collectible progress for the affected series', () => {
    const outcomes = getCollectibleSeriesOutcomes({}, { gift_cloud_tea: 1 }, [{ id: 'gift_cloud_tea' }]);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].id, 'tea');
    assert.equal(outcomes[0].currentCount, 1);
    assert.equal(outcomes[0].totalCount, 4);
    assert.deepEqual(outcomes[0].newItems.map(item => item.id), ['gift_cloud_tea']);
    assert.equal(outcomes[0].newlyCompleted, false);
});

test('does not treat a duplicate collectible as a new discovery', () => {
    const before = { gift_cloud_tea: 1 };
    const after = { gift_cloud_tea: 2 };
    const [outcome] = getCollectibleSeriesOutcomes(before, after, [{ id: 'gift_cloud_tea' }]);
    assert.equal(outcome.currentCount, 1);
    assert.deepEqual(outcome.newItems, []);
    assert.equal(outcome.newlyCompleted, false);
});

test('reports a series completed only when the final missing item is acquired', () => {
    const before = { gift_cloud_tea: 1, gift_ember_tea: 1, gift_mint_tea: 1 };
    const after = { ...before, gift_moon_tea: 1 };
    const [outcome] = getCollectibleSeriesOutcomes(before, after, [{ id: 'gift_moon_tea' }]);
    assert.equal(outcome.currentCount, 4);
    assert.equal(outcome.completed, true);
    assert.equal(outcome.newlyCompleted, true);
});