import assert from 'node:assert/strict';
import test from 'node:test';

import { SICKNESS_DEFS, sicknessLabel, sicknessName } from '../js/petTick.js';

test('every sickness definition resolves to a visible localized name', () => {
    for (const definition of SICKNESS_DEFS) {
        const name = sicknessName(definition);
        assert.equal(typeof name, 'string', definition.id);
        assert.ok(name.trim(), definition.id);
        assert.notEqual(name, 'undefined', definition.id);

        const label = sicknessLabel(definition);
        assert.equal(typeof label, 'string', definition.id);
        assert.ok(label.trim(), definition.id);
        assert.notEqual(label, 'undefined', definition.id);
    }
});