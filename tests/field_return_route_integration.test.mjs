import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fieldSource = await readFile(new URL('../js/level_field.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('successful field cleaning reports a home-tending action after the sweep', () => {
    const start = fieldSource.indexOf('function collectPoopsInCurrentField(');
    const end = fieldSource.indexOf('\nfunction collectFieldMiningCoin(', start);
    const implementation = fieldSource.slice(start, end);

    assert.match(implementation, /playPoopMachineSweep\(collectables, \(\) => \{[\s\S]*ctx\?\.callbacks\?\.onTendHome\?\.\(\);/);
});

test('home-tending callback advances the route only on the Haqi planet', () => {
    const start = appSource.indexOf('function homeCallbacks()');
    const end = appSource.indexOf('\n}', start) + 2;
    const implementation = appSource.slice(start, end);

    assert.match(implementation, /onTendHome:\s*\(\) => \{/);
    assert.match(implementation, /isHaqiExpeditionEnabled\(getActivePlanetId\(\)\).*completeDailyReturnRouteStep\('tend-home'\)/s);
});