const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export function calculateExpeditionReadiness(lifeStats = {}) {
    const energy = clamp(lifeStats.energy ?? lifeStats.hunger, 0, 100);
    const mood = clamp(lifeStats.mood, 0, 100);
    const clean = clamp(lifeStats.clean, 0, 100);
    const bond = clamp(lifeStats.bond, 0, 100);
    const score = Math.round(energy * 0.35 + mood * 0.30 + clean * 0.20 + bond * 0.15);

    if (score >= 90) return {
        score, tier: '元气满满', maxHpMultiplier: 1.10, initialHpRatio: 1,
        initialMpBonus: 0.25, shieldPercentage: 0.10, healingMultiplier: 1.10,
        movementCostMultiplier: 0.90,
    };
    if (score >= 75) return {
        score, tier: '状态良好', maxHpMultiplier: 1.05, initialHpRatio: 1,
        initialMpBonus: 0.15, shieldPercentage: 0.05, healingMultiplier: 1.05,
        movementCostMultiplier: 0.95,
    };
    if (score >= 50) return {
        score, tier: '正常出发', maxHpMultiplier: 1, initialHpRatio: 1,
        initialMpBonus: 0.05, shieldPercentage: 0, healingMultiplier: 1,
        movementCostMultiplier: 1,
    };
    if (score >= 30) return {
        score, tier: '需要照料', maxHpMultiplier: 0.95, initialHpRatio: 0.90,
        initialMpBonus: 0, shieldPercentage: 0, healingMultiplier: 0.95,
        movementCostMultiplier: 1.05,
    };
    return {
        score, tier: '虚弱出发', maxHpMultiplier: 0.88, initialHpRatio: 0.75,
        initialMpBonus: 0, shieldPercentage: 0, healingMultiplier: 0.88,
        movementCostMultiplier: 1.10,
    };
}