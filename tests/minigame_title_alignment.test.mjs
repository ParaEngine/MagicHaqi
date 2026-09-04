import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/view_minigames.js', import.meta.url), 'utf8');

test('minigame title plaque stays centered over the game frame', () => {
    const titlePlaqueRule = source.match(/\.mh-minigame-title-plaque\s*\{([^}]+)\}/)?.[1] || '';

    assert.match(titlePlaqueRule, /position:\s*absolute/);
    assert.match(titlePlaqueRule, /left:\s*50%/);
    assert.match(titlePlaqueRule, /transform:\s*translateX\(-50%\)/);
});