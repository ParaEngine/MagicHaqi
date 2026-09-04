import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../css/planet.css', import.meta.url), 'utf8');

test('mobile mailbox actions share the available row width', () => {
    assert.match(source, /@media \(max-width: 420px\) \{/);
    assert.match(source, /\.mailbox-actions \.btn-primary,\s*\.mailbox-actions \.btn-secondary \{\s*flex: 1 1 0;\s*min-width: 0;/);
});