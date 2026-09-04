import assert from 'node:assert/strict';
import test from 'node:test';

import { getNannyCareEligibility } from '../js/petLifecycle.js';

test('保姆资格在临界值时给出可操作的属性缺口', () => {
    const result = getNannyCareEligibility({
        stats: { hunger: 50, mood: 50, clean: 50, bond: 50 },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.needs, { average: true, mood: true, hunger: true });
    assert.equal(result.reasons.length, 3);
});

test('所有属性高于门槛时允许雇佣保姆', () => {
    const result = getNannyCareEligibility({
        stats: { hunger: 51, mood: 51, clean: 51, bond: 51 },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.needs, { average: false, mood: false, hunger: false });
    assert.deepEqual(result.reasons, []);
});