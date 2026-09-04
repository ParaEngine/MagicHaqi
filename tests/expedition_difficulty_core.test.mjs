import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAdaptiveThreat, calculateExpeditionCombatPower } from '../js/expedition_difficulty_core.js';

test('远征战力将攻击、魔法、生存属性共同纳入计算', () => {
    assert.equal(calculateExpeditionCombatPower({ attack: 80, magic: 60, maxHp: 220, defense: 20 }), 141);
});

test('基准战力不会受到额外星图压力', () => {
    assert.deepEqual(calculateAdaptiveThreat({ attack: 80, magic: 60, maxHp: 220, defense: 20 }), {
        combatPower: 141,
        multiplier: 1,
        percent: 0,
    });
});

test('超额战力会部分抬升敌方压力且增长封顶', () => {
    const strong = calculateAdaptiveThreat({ attack: 260, magic: 160, maxHp: 560, defense: 90 });
    const extreme = calculateAdaptiveThreat({ attack: 2000, magic: 1200, maxHp: 5000, defense: 700 });

    assert.ok(strong.multiplier > 1);
    assert.ok(strong.multiplier < extreme.multiplier);
    assert.equal(extreme.multiplier, 1.8);
    assert.equal(extreme.percent, 80);
});