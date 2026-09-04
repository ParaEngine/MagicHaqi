import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(testDir, '..', 'js', 'view_home.js'), 'utf8');

test('scene wipe resolves when animation frames are suspended', () => {
    const start = source.indexOf('function playSceneWipe');
    const end = source.indexOf('\nfunction drawSceneWipeFrame', start);
    const implementation = source.slice(start, end);

    assert.match(implementation, /const fallbackTimer = setTimeout\(finish, duration \+ 240\);/);
    assert.match(implementation, /if \(__sceneWipeFrame\) cancelAnimationFrame\(__sceneWipeFrame\);/);
});

test('zoom transition does not wait forever for the post-render double frame', () => {
    const start = source.indexOf('// 5) 打开阶段');
    const end = source.indexOf('await playSceneWipe', start);
    const implementation = source.slice(start, end);

    assert.match(implementation, /const fallbackTimer = setTimeout\(finish, 120\);/);
    assert.match(implementation, /requestAnimationFrame\(\(\) => requestAnimationFrame\(finish\)\);/);
});