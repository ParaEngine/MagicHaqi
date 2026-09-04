import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/level_field.js', import.meta.url), 'utf8');

test('field pan animation has a timeout fallback when animation frames pause', () => {
    const start = source.indexOf('function animateFieldPanTo(');
    const end = source.indexOf('\nfunction centerFieldPet(', start);
    const implementation = source.slice(start, end);

    assert.match(implementation, /let finished = false;/);
    assert.match(implementation, /setTimeout\(finish, Math\.max\(1, duration\) \+ 250\)/);
    assert.match(implementation, /if \(finished\) return;/);
    assert.match(implementation, /clearTimeout\(fallbackTimer\);/);
});

test('poop machine sweep has a timeout fallback for its main scan', () => {
    const start = source.indexOf('function playPoopMachineSweep(');
    const end = source.indexOf('\nfunction collectPoopsInCurrentField(', start);
    const implementation = source.slice(start, end);

    assert.match(implementation, /fallbackTimer = setTimeout\(finish, duration \+ 250\);/);
    assert.match(implementation, /clearTimeout\(fallbackTimer\);/);
    assert.match(implementation, /if \(finished \|\| sweepId !== activePoopSweepId\) return;/);
});