import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyDeflectionShield,
    createTacticalState,
    rescueWithEmergencyBeacon,
} from '../js/expedition_tactical_core.js';

test('偏导护盾在远征开始时提供最大生命 45% 的护盾', () => {
    const player = { maxHp: 220, hp: 220, shield: 12 };
    const tactical = createTacticalState({ deflectionShield: 1 });

    assert.equal(applyDeflectionShield(player, tactical), 99);
    assert.equal(player.shield, 111);
});

test('紧急救援信标首次致命伤回血并加盾，且只能触发一次', () => {
    const player = { maxHp: 220, hp: 0, shield: 0 };
    const tactical = createTacticalState({ emergencyBeacon: 1 });

    assert.deepEqual(rescueWithEmergencyBeacon(player, tactical), { hp: 55, shield: 44 });
    assert.equal(player.hp, 55);
    assert.equal(player.shield, 44);
    assert.equal(rescueWithEmergencyBeacon(player, tactical), null);
});

test('已完成远征不会被救援信标拦截失败结算', () => {
    const player = { maxHp: 100, hp: 0, shield: 0 };
    const tactical = createTacticalState({ emergencyBeacon: 1 });

    assert.equal(rescueWithEmergencyBeacon(player, tactical, { finished: true }), null);
    assert.equal(tactical.beaconUsed, false);
});