import assert from 'node:assert/strict';
import test from 'node:test';
import {
    IV_KEYS,
    SSR_CATALYST_MUTATION_CHANCE,
    UR_CATALYST_ATTRIBUTE_FLOOR,
    generateChildEmbryo,
    previewChildPotential,
} from '../js/pet_breeding_core.js';

function ssrParent(id, iv = 0) {
    return {
        id,
        stage: 'adult',
        battle: { level: 40 },
        quality: { id: 'SSR' },
        dna: 'ABCDEFGHJKLMNPQRST',
        ivs: Object.fromEntries(IV_KEYS.map(key => [key, iv])),
    };
}

test('SSR 突变催化剂将 SSR x SSR 的 UR 概率提高至 25%', () => {
    const first = ssrParent('first', 60);
    const second = ssrParent('second', 60);
    const preview = previewChildPotential(first, second, { catalyst: { type: 'ssrMutation' } });

    assert.equal(preview.urMutationChance, SSR_CATALYST_MUTATION_CHANCE);
    const embryo = generateChildEmbryo(first, second, {
        catalyst: { type: 'ssrMutation' },
        random: () => 0.24,
    });
    assert.equal(embryo.mutation.triggered, true);
    assert.equal(embryo.qualityId, 'UR');
});

test('UR 属性锁定剂将指定 IV 保底至 80 且不影响其他 IV', () => {
    const first = ssrParent('first', 0);
    const second = ssrParent('second', 0);
    const embryo = generateChildEmbryo(first, second, {
        catalyst: { type: 'urAttributeLock', attribute: 'attack' },
        random: () => 0.5,
    });

    assert.equal(embryo.ivs.attack, UR_CATALYST_ATTRIBUTE_FLOOR);
    assert.equal(embryo.ivs.life, 0);
    assert.equal(embryo.catalyst.attribute, 'attack');
});