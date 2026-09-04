import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/level_pet.js', import.meta.url), 'utf8');

test('the rendered feed scene synchronously makes the pet a reachable drop target after sizing', () => {
    const start = source.indexOf('bindStage(pet, ctx)');
    const end = source.indexOf("window.addEventListener('resize', applyRoomPan", start);
    const handler = source.slice(start, end);

    const layoutIndex = handler.indexOf('applyRoomMeterLayout();');
    const feedIndex = handler.indexOf('if (state.isFeedMode) {');
    const panIndex = handler.indexOf('applyRoomPan();', feedIndex);
    const followIndex = handler.indexOf('setPetFollowUser();', feedIndex);
    const frameIndex = handler.indexOf('requestAnimationFrame(() => {');
    assert.ok(layoutIndex >= 0, 'the room should calculate its current scale');
    assert.ok(feedIndex > layoutIndex, 'feed positioning should start after current sizing');
    assert.ok(panIndex > feedIndex, 'the room pan should be clamped before positioning the pet');
    assert.ok(followIndex > panIndex, 'the feed target should use the current pan');
    assert.ok(frameIndex > followIndex, 'feed target positioning must not depend on requestAnimationFrame');
});

test('tapping food in feed mode uses the normal serving sequence', () => {
    const start = source.indexOf('if (!current.active) {');
    const end = source.indexOf('\n        const stage = ctx.stage;', start);
    const handler = source.slice(start, end);

    assert.match(handler, /state\.isFeedMode && ITEM_BY_ID\[current\.itemId\]\?\.type === 'food'/);
    assert.match(handler, /runFeedServingSequence\(current\.itemId, \{ source: 'dock', targetPetEl: \$\('mhPet'\) \}, ctx\);/);
});