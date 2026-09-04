import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceFriendlyGuardBattle, createFriendlyGuardBattle } from '../js/dojo_battle_core.js';

function team(attack = 220) {
    return [1, 2, 3].map(index => ({ id: `pet-${index}`, name: `伙伴 ${index}`, stats: { maxHp: 300, attack, defense: 30, magic: 40 } }));
}

test('道馆战必须由三只玩家伙伴组成，并生成对应层数的三只馆主伙伴', () => {
    assert.equal(createFriendlyGuardBattle(team().slice(0, 2), 1), null);
    const battle = createFriendlyGuardBattle(team(), 3);
    assert.equal(battle.playerTeam.length, 3);
    assert.equal(battle.guardianTeam.length, 3);
    assert.equal(battle.floor, 3);
});

test('每回合由玩家先攻击，击败守护伙伴会自动换人直到获胜', () => {
    let battle = createFriendlyGuardBattle(team(900), 1);
    while (battle.state === 'active') battle = advanceFriendlyGuardBattle(battle);
    assert.equal(battle.state, 'won');
    assert.equal(battle.guardianActiveIndex, 3);
    assert.ok(battle.log.some(entry => entry.includes('接替守护位置')));
});

test('玩家伙伴倒下后自动换人，三只均倒下时挑战失败', () => {
    let battle = createFriendlyGuardBattle(team(8), 5);
    while (battle.state === 'active') battle = advanceFriendlyGuardBattle(battle);
    assert.equal(battle.state, 'lost');
    assert.equal(battle.playerActiveIndex, 3);
    assert.ok(battle.log.at(-1).includes('全部倒下'));
});