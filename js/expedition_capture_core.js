(function exposeExpeditionCaptureCore(root) {
    function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function calculateExpeditionCaptureChance(enemy, player, rules) {
        const maxHp = Math.max(1, finiteNumber(enemy?.maxHp, 1));
        const currentHp = clamp(finiteNumber(enemy?.hp, maxHp), 0, maxHp);
        const missingHp = 1 - currentHp / maxHp;
        const rarityMultiplier = Math.max(0, finiteNumber(
            rules?.chanceMultiplierByRarity?.[enemy?.rarity],
            1,
        ));
        const rarityLimit = finiteNumber(
            rules?.maxChanceByRarity?.[enemy?.rarity],
            finiteNumber(rules?.maxChance, 1),
        );
        const baseChance = (
            finiteNumber(rules?.baseChance)
            + finiteNumber(rules?.lowHpBonus) * Math.pow(missingHp, finiteNumber(rules?.curveExponent, 1))
        ) * Math.max(0, finiteNumber(enemy?.captureModifier, 1)) * rarityMultiplier;
        const cappedBaseChance = clamp(baseChance, finiteNumber(rules?.minChance), rarityLimit);
        const lowHpBonus = missingHp >= 0.65 ? Math.max(0, finiteNumber(player?.lowHpCaptureBonus)) : 0;
        const playerBonus = Math.max(0, finiteNumber(player?.captureBonus));
        const overallMultiplier = Math.max(0, finiteNumber(rules?.overallMultiplier, 1));

        return clamp(
            (cappedBaseChance + playerBonus + lowHpBonus) * overallMultiplier,
            finiteNumber(rules?.minChance),
            finiteNumber(rules?.absoluteMaxChance, 0.95),
        );
    }

    root.MHExpeditionCapture = Object.freeze({ calculateExpeditionCaptureChance });
})(typeof window === 'undefined' ? globalThis : window);