import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlSource = await readFile(new URL('../MagicHaqi.html', import.meta.url), 'utf8');
const inventorySource = await readFile(new URL('../js/view_inventory.js', import.meta.url), 'utf8');

test('inventory cards use a compact two-row layout independent from shop cards', () => {
    assert.match(htmlSource, /\.mh-inv-item \{[^}]*min-height: 112px;[^}]*aspect-ratio: auto;[^}]*grid-template-rows: minmax\(0, 1fr\) auto;/s);
    assert.match(htmlSource, /\.mh-inv-item \.name \{ transform: none; \}/);
    assert.match(htmlSource, /\.mh-shop-grid \.shop-item \{ aspect-ratio: 286 \/ 202; \}/);
    assert.doesNotMatch(htmlSource, /\n\s*\.shop-item \{ aspect-ratio: 286 \/ 202; \}/);
});

test('narrow home treasure actions span the full row as one control group', () => {
    assert.match(inventorySource, /\.mh-home-treasure-actions \{ grid-column: 1 \/ -1; width: 100%; \}/);
    assert.match(inventorySource, /class="mh-home-treasure-actions"/);
    assert.doesNotMatch(inventorySource, /\[data-claim-treasure\] \{ grid-column:/);
});