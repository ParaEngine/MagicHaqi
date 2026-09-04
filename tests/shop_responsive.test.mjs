import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../MagicHaqi.html', import.meta.url), 'utf8');

test('mobile shop header can shrink without widening the product grid', () => {
    assert.match(source, /@media \(max-width: 520px\) \{/);
    assert.match(source, /\.mh-shop-header \{ min-width: 0; min-height: 0; \}/);
    assert.match(source, /\.mh-shop-title \{ width: min\(156px, calc\(100% - 104px\)\); min-width: 0; flex-shrink: 1; \}/);
    assert.match(source, /\.mh-shop-wallet \{ width: 104px;/);
    assert.match(source, /\.mh-shop-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});
