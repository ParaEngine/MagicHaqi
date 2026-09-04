import assert from 'node:assert/strict';
import test from 'node:test';
import {
    acceptMutationPressure,
    advancePlayerDebuffs,
    applyDeflectionShield,
    applyOnboardingVictoryRecovery,
    applySupportRouteCheckpointBonus,
    applySupportRouteEntryCost,
    createTacticalState,
    createSupportRoutePlan,
    assessExpeditionBalanceCoverage,
    getSupportRouteBalanceBaseline,
    getSupportRoutePartialNodeRequirement,
    getOnboardingEnemyDamage,
    getPlayerDebuffAttackMultiplier,
    rescueOnboardingFirstRun,
    rescueWithEmergencyBeacon,
} from '../js/expedition_tactical_core.js';

test('四类构筑基线明确标记为规则模拟而非真实试玩', () => {
    assert.deepEqual(getSupportRouteBalanceBaseline(), {
        source: 'simulated-rules',
        tracking: { costHpPercent: 10, captureCapsules: 1 },
        restoration: { costMp: 12, healPercent: 10, shieldPercent: 10 },
        survival: { intelligenceNodesRequired: 5, defaultNodesRequired: 8 },
        mutation: { attackPenaltyPercent: 10, penaltyTurns: 3, mutationCapsules: 1, investigationInsights: 1 },
    });
});

test('平衡校准必须覆盖十局、两条分支和三类支援', () => {
    const entry = (branchId, specialtyId) => ({ playtest: { investigation: { branchId }, supports: [{ specialtyId }] } });
    const insufficient = Array.from({ length: 9 }, () => entry('missing-companion', 'scout'));
    assert.equal(assessExpeditionBalanceCoverage(insufficient).readyToCalibrate, false);
    const covered = [
        ...Array.from({ length: 4 }, () => entry('missing-companion', 'scout')),
        ...Array.from({ length: 3 }, () => entry('sunken-ruins', 'restore')),
        ...Array.from({ length: 3 }, () => entry('sunken-ruins', 'channel')),
    ];
    assert.equal(assessExpeditionBalanceCoverage(covered).readyToCalibrate, true);
});

test('支援阵容生成一个有明确收益和代价的航段方案', () => {
    const restore = { speciesSpecialty: { id: 'restore' } };
    const scout = { speciesSpecialty: { id: 'scout' } };

    assert.equal(createSupportRoutePlan([restore]).id, 'restore-bypass');
    assert.equal(createSupportRoutePlan([restore, scout]).id, 'scout-shortcut');
    assert.equal(createSupportRoutePlan([{ speciesSpecialty: { id: 'bulwark' } }]).id, 'survival-extraction');
    assert.equal(createSupportRoutePlan([{ speciesSpecialty: { id: 'vanguard' } }]).id, 'survival-extraction');
    assert.equal(createSupportRoutePlan([{ speciesSpecialty: { id: 'channel' } }]).id, 'mutation-pressure');
    assert.equal(createSupportRoutePlan([{ speciesSpecialty: { id: 'strike' } }]), null);
});

test('异变承压必须主动接受并在三回合后恢复攻击', () => {
    const player = { items: {} };
    const runState = { playerDebuffs: [] };

    assert.equal(acceptMutationPressure(player, runState), null);
    assert.equal(player.items.mutationCapsule, undefined);
    assert.deepEqual(acceptMutationPressure(player, runState, { accepted: true }), {
        mutationCapsules: 1,
        investigationInsights: 1,
        remainingTurns: 3,
    });
    assert.equal(player.items.mutationCapsule, 1);
    assert.equal(runState.mutationInsights, 1);
    assert.equal(getPlayerDebuffAttackMultiplier(runState), 0.9);

    advancePlayerDebuffs(runState);
    advancePlayerDebuffs(runState);
    assert.equal(getPlayerDebuffAttackMultiplier(runState), 0.9);
    advancePlayerDebuffs(runState);
    assert.equal(getPlayerDebuffAttackMultiplier(runState), 1);
    assert.deepEqual(runState.playerDebuffs, []);
});

test('前线撤离协议降低调查情报保留门槛并放弃生态基础补给', () => {
    const plan = createSupportRoutePlan([{ speciesSpecialty: { id: 'bulwark' } }]);

    assert.equal(getSupportRoutePartialNodeRequirement(plan), 5);
    assert.equal(getSupportRoutePartialNodeRequirement(null), 8);
    assert.equal(plan.cost, '放弃生态航段的基础补给');
});

test('追踪捷径以开局生命换取生态航段捕捉胶囊', () => {
    const plan = createSupportRoutePlan([{ speciesSpecialty: { id: 'scout' } }]);
    const player = { maxHp: 220, hp: 220, mp: 30, items: { captureCapsule: 1 } };

    assert.deepEqual(applySupportRouteEntryCost(player, plan), { hpCost: 22, mpCost: 0 });
    assert.equal(player.hp, 198);
    assert.deepEqual(applySupportRouteCheckpointBonus(player, plan), { captureCapsules: 1, hpRecovered: 0, shield: 0 });
    assert.equal(player.items.captureCapsule, 2);
});

test('追踪捷径的生命代价不会让领队在开局倒下', () => {
    const player = { maxHp: 220, hp: 8 };
    const cost = applySupportRouteEntryCost(player, { id: 'scout-shortcut' });

    assert.deepEqual(cost, { hpCost: 7, mpCost: 0 });
    assert.equal(player.hp, 1);
});

test('修复旁路消耗魔力并在生态航段强化恢复和护盾', () => {
    const plan = createSupportRoutePlan([{ speciesSpecialty: { id: 'restore' } }]);
    const player = { maxHp: 220, hp: 150, mp: 8, shield: 5 };

    assert.deepEqual(applySupportRouteEntryCost(player, plan), { hpCost: 0, mpCost: 8 });
    assert.equal(player.mp, 0);
    assert.deepEqual(applySupportRouteCheckpointBonus(player, plan), { captureCapsules: 0, hpRecovered: 22, shield: 22 });
    assert.equal(player.hp, 172);
    assert.equal(player.shield, 27);
});

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

test('首次远征仅在非首领胜利后恢复生命', () => {
    const onboardingPlayer = { maxHp: 220, hp: 80 };
    const regularPlayer = { maxHp: 220, hp: 80 };

    assert.equal(applyOnboardingVictoryRecovery(onboardingPlayer, { enabled: true }), 40);
    assert.equal(onboardingPlayer.hp, 120);
    assert.equal(applyOnboardingVictoryRecovery(regularPlayer), 0);
    assert.equal(regularPlayer.hp, 80);
    assert.equal(applyOnboardingVictoryRecovery(onboardingPlayer, { enabled: true, isBoss: true }), 0);
});

test('首次远征降低敌方伤害且不影响普通远征', () => {
    assert.equal(getOnboardingEnemyDamage(103, { enabled: true }), 46);
    assert.equal(getOnboardingEnemyDamage(103), 103);
});

test('首次远征战后恢复不会复活失败伙伴或超过最大生命', () => {
    const defeatedPlayer = { maxHp: 220, hp: 0 };
    const healthyPlayer = { maxHp: 220, hp: 210 };

    assert.equal(applyOnboardingVictoryRecovery(defeatedPlayer, { enabled: true }), 0);
    assert.equal(defeatedPlayer.hp, 0);
    assert.equal(applyOnboardingVictoryRecovery(healthyPlayer, { enabled: true }), 10);
    assert.equal(healthyPlayer.hp, 220);
});

test('首次远征首次致命伤触发一次新手救援', () => {
    const player = { maxHp: 220, hp: 0, shield: 5 };
    const tactical = createTacticalState();

    assert.deepEqual(rescueOnboardingFirstRun(player, tactical, { enabled: true }), { hp: 220, shield: 99 });
    assert.equal(player.hp, 220);
    assert.equal(player.shield, 104);
    assert.equal(rescueOnboardingFirstRun(player, tactical, { enabled: true }), null);
});

test('首次远征进入下一场战斗前可重置并再次触发新手救援', () => {
    const player = { maxHp: 220, hp: 0, shield: 0 };
    const tactical = createTacticalState();

    assert.ok(rescueOnboardingFirstRun(player, tactical, { enabled: true }));
    tactical.onboardingRescueUsed = false;
    player.hp = 0;
    player.shield = 0;
    assert.deepEqual(rescueOnboardingFirstRun(player, tactical, { enabled: true }), { hp: 220, shield: 99 });
});

test('普通远征和已完成远征不会触发新手救援', () => {
    const player = { maxHp: 100, hp: 0, shield: 0 };
    const tactical = createTacticalState();

    assert.equal(rescueOnboardingFirstRun(player, tactical), null);
    assert.equal(rescueOnboardingFirstRun(player, tactical, { enabled: true, finished: true }), null);
    assert.equal(tactical.onboardingRescueUsed, undefined);
});