(function attachPetQuality(root) {
    'use strict';

    const TIERS = Object.freeze([
        { id: 'N', name: '初芽', color: '#94a3b8', stats: { hp: 120, mp: 45, defense: 12, power: 36, magic: 18, luck: 5 } },
        { id: 'R', name: '碧潮', color: '#22c55e', stats: { hp: 145, mp: 58, defense: 16, power: 48, magic: 25, luck: 9 } },
        { id: 'SR', name: '幻晶', color: '#38bdf8', stats: { hp: 172, mp: 72, defense: 21, power: 63, magic: 34, luck: 14 } },
        { id: 'SSR', name: '耀阳', color: '#a855f7', stats: { hp: 205, mp: 90, defense: 27, power: 81, magic: 45, luck: 20 } },
        { id: 'UR', name: '星辉', color: '#f59e0b', stats: { hp: 245, mp: 112, defense: 35, power: 105, magic: 59, luck: 28 } },
    ]);

    const byId = Object.freeze(Object.fromEntries(TIERS.map(tier => [tier.id, tier])));
    const sourceRarity = Object.freeze({ '普通': 'N', '稀有': 'R', '精英': 'SR', '史诗': 'SSR', '传说': 'UR' });

    function clampTier(value) {
        return TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.round(Number(value) || 0)))];
    }

    function getTier(value) {
        if (typeof value === 'string' && byId[value]) return byId[value];
        return clampTier(value);
    }

    function tierForSourceRarity(value, upgraded) {
        const base = TIERS.findIndex(tier => tier.id === (sourceRarity[value] || 'N'));
        return TIERS[Math.min(TIERS.length - 1, Math.max(0, base) + (upgraded ? 1 : 0))];
    }

    function snapshot(value) {
        const tier = getTier(value);
        return { id: tier.id, name: tier.name, color: tier.color, stats: { ...tier.stats } };
    }

    function normalizePet(pet) {
        const fallbackTier = clampTier(pet?.rarity);
        const quality = snapshot(pet?.quality?.id || pet?.qualityId || fallbackTier.id);
        const battleStats = pet?.battleStats && typeof pet.battleStats === 'object'
            ? { ...quality.stats, ...pet.battleStats }
            : { ...quality.stats };
        return { quality, battleStats };
    }

    root.MHPetQuality = Object.freeze({ TIERS, getTier, tierForSourceRarity, snapshot, normalizePet });
})(window);
