import test from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveMinigameLoadingState,
    resolveMinigameResourceEvent,
    shouldReleaseExploreFlow,
} from '../js/minigame_loading.js';

test('timeout, empty HTML and request errors enter the failed state', () => {
    assert.equal(resolveMinigameLoadingState('timeout'), 'failed');
    assert.equal(resolveMinigameLoadingState(resolveMinigameResourceEvent({ html: '   ' })), 'failed');
    assert.equal(resolveMinigameLoadingState(resolveMinigameResourceEvent({ responseOk: false })), 'failed');
    assert.equal(resolveMinigameLoadingState(resolveMinigameResourceEvent({ error: new Error('offline') })), 'failed');
});

test('non-empty resources become ready and exploration releases after every terminal result', () => {
    assert.equal(resolveMinigameResourceEvent({ html: '<main>ready</main>' }), 'loaded');
    assert.equal(resolveMinigameLoadingState('loaded'), 'ready');
    assert.equal(shouldReleaseExploreFlow('loaded'), true);
    assert.equal(shouldReleaseExploreFlow('timeout'), true);
    assert.equal(shouldReleaseExploreFlow('empty'), true);
    assert.equal(shouldReleaseExploreFlow('error'), true);
    assert.equal(shouldReleaseExploreFlow('start'), false);
});