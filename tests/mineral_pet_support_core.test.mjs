import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMineralPetSupport } from '../js/mineral_pet_support_core.js';

test('普通伙伴不会获得免费矿区支援', () => {
    const support = calculateMineralPetSupport({ attack: 60, magic: 20, maxHp: 120, defense: 10 });
    assert.equal(support.combatPower, 85);
    assert.deepEqual(support.assistIds, []);
    assert.deepEqual(support.assists, []);
    assert.deepEqual(support.nextUnlock, {
        combatPower: 160,
        remainingPower: 75,
        assistId: 'pressureVeil',
        name: '护压场',
    });
});

test('成熟与高战力伙伴分档获得现有矿区支援', () => {
    const mature = calculateMineralPetSupport({ attack: 120, magic: 50, maxHp: 160, defense: 10 });
    const strong = calculateMineralPetSupport({ attack: 200, magic: 70, maxHp: 220, defense: 20 });
    assert.deepEqual(mature.assistIds, ['pressureVeil']);
    assert.equal(mature.assists[0].name, '护压场');
    assert.equal(mature.nextUnlock.name, '矿脉共感');
    assert.deepEqual(strong.assistIds, ['pressureVeil', 'cargoSense']);
    assert.deepEqual(strong.assists.map(item => item.name), ['护压场', '矿脉共感']);
    assert.equal(strong.nextUnlock, null);
});