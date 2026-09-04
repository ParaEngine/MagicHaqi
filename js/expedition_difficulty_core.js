const BASELINE_COMBAT_POWER = 160;
const MAX_ADAPTIVE_THREAT = 1.8;
const OVERFLOW_ABSORPTION = 0.42;

function stat(value) {
    return Math.max(0, Number(value) || 0);
}

export function calculateExpeditionCombatPower(battleStats = {}) {
    return Math.round(
        stat(battleStats.attack)
        + stat(battleStats.magic) * 0.6
        + stat(battleStats.maxHp) * 0.08
        + stat(battleStats.defense) * 0.35,
    );
}

export function calculateAdaptiveThreat(battleStats = {}) {
    const combatPower = calculateExpeditionCombatPower(battleStats);
    const overflowRatio = Math.max(0, combatPower - BASELINE_COMBAT_POWER) / BASELINE_COMBAT_POWER;
    const multiplier = Math.min(MAX_ADAPTIVE_THREAT, 1 + overflowRatio * OVERFLOW_ABSORPTION);
    return {
        combatPower,
        multiplier: Math.round(multiplier * 100) / 100,
        percent: Math.round((multiplier - 1) * 100),
    };
}