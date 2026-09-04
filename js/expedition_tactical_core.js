export const DEFLECTION_SHIELD_RATIO = 0.45;
export const EMERGENCY_BEACON_HEAL_RATIO = 0.25;
export const EMERGENCY_BEACON_SHIELD_RATIO = 0.2;
export const ONBOARDING_VICTORY_HEAL_RATIO = 0.18;
export const ONBOARDING_RESCUE_HEAL_RATIO = 1;
export const ONBOARDING_RESCUE_SHIELD_RATIO = 0.45;
export const ONBOARDING_ENEMY_DAMAGE_RATIO = 0.45;
export const SCOUT_ROUTE_HP_COST_RATIO = 0.1;
export const RESTORE_ROUTE_MP_COST = 12;
export const RESTORE_ROUTE_HEAL_RATIO = 0.1;
export const RESTORE_ROUTE_SHIELD_RATIO = 0.1;
export const SURVIVAL_ROUTE_PARTIAL_NODES = 5;
export const MUTATION_PRESSURE_TURNS = 3;
export const MUTATION_PRESSURE_ATTACK_MULTIPLIER = 0.9;

export function getSupportRouteBalanceBaseline() {
    return {
        source: 'simulated-rules',
        tracking: { costHpPercent: SCOUT_ROUTE_HP_COST_RATIO * 100, captureCapsules: 1 },
        restoration: { costMp: RESTORE_ROUTE_MP_COST, healPercent: RESTORE_ROUTE_HEAL_RATIO * 100, shieldPercent: RESTORE_ROUTE_SHIELD_RATIO * 100 },
        survival: { intelligenceNodesRequired: SURVIVAL_ROUTE_PARTIAL_NODES, defaultNodesRequired: 8 },
        mutation: {
            attackPenaltyPercent: Math.round((1 - MUTATION_PRESSURE_ATTACK_MULTIPLIER) * 100),
            penaltyTurns: MUTATION_PRESSURE_TURNS,
            mutationCapsules: 1,
            investigationInsights: 1,
        },
    };
}

export function assessExpeditionBalanceCoverage(history) {
    const entries = (Array.isArray(history) ? history : []).filter(item => item?.playtest);
    const branches = new Set(entries.map(item => String(item.playtest.investigation?.branchId || '')).filter(Boolean));
    const specialties = new Set(entries.flatMap(item => (Array.isArray(item.playtest.supports) ? item.playtest.supports : []))
        .map(item => String(item?.specialtyId || '')).filter(Boolean));
    return {
        sampleSize: entries.length,
        branchCount: branches.size,
        supportSpecialtyCount: specialties.size,
        readyToCalibrate: entries.length >= 10 && branches.size >= 2 && specialties.size >= 3,
    };
}

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function positiveInteger(value) {
    return Math.max(1, Math.round(Number(value) || 0));
}

export function createTacticalState(items = {}) {
    return {
        emergencyBeacon: nonNegativeInteger(items.emergencyBeacon),
        deflectionShield: nonNegativeInteger(items.deflectionShield),
        beaconUsed: false,
    };
}

export function createSupportRoutePlan(supportPets = []) {
    const specialties = (Array.isArray(supportPets) ? supportPets : [])
        .map(pet => pet?.speciesSpecialty || pet)
        .filter(specialty => specialty?.id);
    const scout = specialties.find(specialty => specialty.id === 'scout');
    if (scout) {
        return {
            id: 'scout-shortcut',
            specialtyId: 'scout',
            label: '追踪捷径',
            benefit: '生态航段额外获得 1 枚捕捉胶囊',
            cost: '领队开局损失 10% 最大生命',
        };
    }
    const restore = specialties.find(specialty => specialty.id === 'restore');
    if (restore) {
        return {
            id: 'restore-bypass',
            specialtyId: 'restore',
            label: '修复旁路',
            benefit: '生态航段额外恢复 10% 生命并获得 10% 最大生命护盾',
            cost: '领队开局消耗 12 点魔力',
        };
    }
    const survival = specialties.find(specialty => specialty.id === 'bulwark' || specialty.id === 'vanguard');
    if (survival) {
        return {
            id: 'survival-extraction',
            specialtyId: survival.id,
            label: '前线撤离协议',
            benefit: '推进 5 个节点后撤离仍可保留调查情报',
            cost: '放弃生态航段的基础补给',
        };
    }
    const mutation = specialties.find(specialty => specialty.id === 'channel');
    if (mutation) {
        return {
            id: 'mutation-pressure',
            specialtyId: 'channel',
            label: '异变承压',
            benefit: '生态航段可主动换取 1 枚异变胶囊和 1 条调查标记',
            cost: '接受后续 3 回合攻击降低 10% 的星尘侵蚀',
        };
    }
    return null;
}

export function acceptMutationPressure(player, runState, { accepted = false } = {}) {
    if (!accepted || !player || !runState) return null;
    runState.playerDebuffs ??= [];
    player.items ??= {};
    runState.playerDebuffs.push({
        id: 'mutation-pressure',
        remainingTurns: MUTATION_PRESSURE_TURNS,
        attackMultiplier: MUTATION_PRESSURE_ATTACK_MULTIPLIER,
    });
    player.items.mutationCapsule = nonNegativeInteger(player.items.mutationCapsule) + 1;
    runState.mutationInsights = nonNegativeInteger(runState.mutationInsights) + 1;
    return { mutationCapsules: 1, investigationInsights: 1, remainingTurns: MUTATION_PRESSURE_TURNS };
}

export function getPlayerDebuffAttackMultiplier(runState) {
    return (Array.isArray(runState?.playerDebuffs) ? runState.playerDebuffs : [])
        .filter(debuff => nonNegativeInteger(debuff?.remainingTurns) > 0)
        .reduce((multiplier, debuff) => multiplier * Math.max(0, Number(debuff.attackMultiplier) || 1), 1);
}

export function advancePlayerDebuffs(runState) {
    if (!Array.isArray(runState?.playerDebuffs)) return [];
    runState.playerDebuffs = runState.playerDebuffs
        .map(debuff => ({ ...debuff, remainingTurns: nonNegativeInteger(debuff?.remainingTurns) - 1 }))
        .filter(debuff => debuff.remainingTurns > 0);
    return runState.playerDebuffs;
}

export function getSupportRoutePartialNodeRequirement(plan, fallback = 8) {
    return plan?.id === 'survival-extraction'
        ? SURVIVAL_ROUTE_PARTIAL_NODES
        : nonNegativeInteger(fallback);
}

export function applySupportRouteEntryCost(player, plan) {
    if (!player || !plan?.id) return null;
    if (plan.id === 'scout-shortcut') {
        const hpCost = positiveInteger(positiveInteger(player.maxHp) * SCOUT_ROUTE_HP_COST_RATIO);
        const previousHp = positiveInteger(player.hp);
        player.hp = Math.max(1, previousHp - hpCost);
        return { hpCost: previousHp - player.hp, mpCost: 0 };
    }
    if (plan.id === 'restore-bypass') {
        const previousMp = nonNegativeInteger(player.mp);
        player.mp = Math.max(0, previousMp - RESTORE_ROUTE_MP_COST);
        return { hpCost: 0, mpCost: previousMp - player.mp };
    }
    return null;
}

export function applySupportRouteCheckpointBonus(player, plan) {
    if (!player || !plan?.id) return null;
    if (plan.id === 'scout-shortcut') {
        player.items ??= {};
        player.items.captureCapsule = nonNegativeInteger(player.items.captureCapsule) + 1;
        return { captureCapsules: 1, hpRecovered: 0, shield: 0 };
    }
    if (plan.id === 'restore-bypass') {
        const maxHp = positiveInteger(player.maxHp);
        const previousHp = Math.min(maxHp, nonNegativeInteger(player.hp));
        player.hp = Math.min(maxHp, previousHp + positiveInteger(maxHp * RESTORE_ROUTE_HEAL_RATIO));
        const shield = positiveInteger(maxHp * RESTORE_ROUTE_SHIELD_RATIO);
        player.shield = nonNegativeInteger(player.shield) + shield;
        return { captureCapsules: 0, hpRecovered: player.hp - previousHp, shield };
    }
    return null;
}

export function applyDeflectionShield(player, tacticalState) {
    if (!player || !tacticalState?.deflectionShield) return 0;
    const shield = positiveInteger(positiveInteger(player.maxHp) * DEFLECTION_SHIELD_RATIO);
    player.shield = nonNegativeInteger(player.shield) + shield;
    return shield;
}

export function rescueWithEmergencyBeacon(player, tacticalState, { finished = false } = {}) {
    if (!player || !tacticalState?.emergencyBeacon || tacticalState.beaconUsed || finished) return null;
    tacticalState.beaconUsed = true;
    player.hp = positiveInteger(positiveInteger(player.maxHp) * EMERGENCY_BEACON_HEAL_RATIO);
    const shield = positiveInteger(positiveInteger(player.maxHp) * EMERGENCY_BEACON_SHIELD_RATIO);
    player.shield = nonNegativeInteger(player.shield) + shield;
    return { hp: player.hp, shield };
}

export function applyOnboardingVictoryRecovery(player, { enabled = false, isBoss = false } = {}) {
    if (!enabled || isBoss || !player || nonNegativeInteger(player.hp) <= 0) return 0;
    const maxHp = positiveInteger(player.maxHp);
    const previousHp = Math.min(maxHp, nonNegativeInteger(player.hp));
    player.hp = Math.min(maxHp, previousHp + positiveInteger(maxHp * ONBOARDING_VICTORY_HEAL_RATIO));
    return player.hp - previousHp;
}

export function getOnboardingEnemyDamage(damage, { enabled = false } = {}) {
    const normalizedDamage = positiveInteger(damage);
    return enabled ? positiveInteger(normalizedDamage * ONBOARDING_ENEMY_DAMAGE_RATIO) : normalizedDamage;
}

export function rescueOnboardingFirstRun(player, tacticalState, { enabled = false, finished = false } = {}) {
    if (!enabled || finished || !player || !tacticalState || tacticalState.onboardingRescueUsed) return null;
    tacticalState.onboardingRescueUsed = true;
    player.hp = positiveInteger(positiveInteger(player.maxHp) * ONBOARDING_RESCUE_HEAL_RATIO);
    const shield = positiveInteger(positiveInteger(player.maxHp) * ONBOARDING_RESCUE_SHIELD_RATIO);
    player.shield = nonNegativeInteger(player.shield) + shield;
    return { hp: player.hp, shield };
}