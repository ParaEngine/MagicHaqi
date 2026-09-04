import { calculateExpeditionCombatPower } from './expedition_difficulty_core.js';

const MINERAL_SUPPORT_TIERS = Object.freeze([
    Object.freeze({ combatPower: 160, assistId: 'pressureVeil', name: '护压场', description: '每层首次增加的压力减少 4%。' }),
    Object.freeze({ combatPower: 260, assistId: 'cargoSense', name: '矿脉共感', description: '每次成功采矿额外回收 1 枚原石。' }),
]);

export function calculateMineralPetSupport(battleStats = {}) {
    const combatPower = calculateExpeditionCombatPower(battleStats);
    const unlocked = MINERAL_SUPPORT_TIERS.filter(tier => combatPower >= tier.combatPower);
    const next = MINERAL_SUPPORT_TIERS.find(tier => combatPower < tier.combatPower) || null;
    return {
        combatPower,
        assistIds: unlocked.map(tier => tier.assistId),
        assists: unlocked.map(({ assistId, name, description }) => ({ id: assistId, name, description })),
        nextUnlock: next ? {
            combatPower: next.combatPower,
            remainingPower: next.combatPower - combatPower,
            assistId: next.assistId,
            name: next.name,
        } : null,
    };
}