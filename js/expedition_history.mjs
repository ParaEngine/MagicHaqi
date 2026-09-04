const MAX_HISTORY_ENTRIES = 10;

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function text(value) {
    return String(value || '').trim();
}

export function buildExpeditionHistoryEntry(launch, data = {}, now = Date.now()) {
    const runId = text(data.runId || launch?.params?.runId || now);
    const captures = Array.isArray(data.captures) ? data.captures : [];
    const loot = Array.isArray(data.loot) ? data.loot : [];
    const mineralBonuses = data.mineralBonuses || launch?.params?.mineralBonuses || {};
    const baseLootCount = loot.reduce((total, entry) => total + nonNegativeInteger(entry?.baseAmount ?? entry?.amount), 0);
    const bonusLootCount = loot.reduce((total, entry) => total + nonNegativeInteger(entry?.bonusAmount), 0);
    return {
        runId,
        expeditionId: text(data.expeditionId || launch?.params?.expedition?.id),
        expeditionName: text(launch?.params?.expedition?.name),
        expeditionBiome: text(launch?.params?.expedition?.biome),
        petId: text(data.petId || launch?.params?.selectedPet?.id),
        petName: text(launch?.params?.selectedPet?.name),
        completed: data.completed === true && data.passed === true,
        reason: text(data.reason),
        normalBattles: nonNegativeInteger(data.normalBattles),
        eliteBattles: nonNegativeInteger(data.eliteBattles),
        completedNodes: nonNegativeInteger(data.completedNodes),
        captureCount: captures.length,
        lootCount: loot.reduce((total, entry) => total + nonNegativeInteger(entry?.amount), 0),
        mineralContribution: {
            attackPercent: Math.max(0, Number(mineralBonuses.attackPercent) || 0),
            lootPercent: Math.max(0, Number(data.lootBonusPercent ?? mineralBonuses.expeditionLootPercent) || 0),
            baseLootCount,
            bonusLootCount,
        },
        equipmentCount: Array.isArray(data.equipmentDrops) ? data.equipmentDrops.length : 0,
        homeTreasureId: data.bossDefeated ? text(data.homeTreasureId) : '',
        finishedAt: Number(data.finishedAt) || now,
    };
}

export function recordExpeditionHistory(history, launch, data = {}, options = {}) {
    const entry = buildExpeditionHistoryEntry(launch, data, options.now || Date.now());
    const previous = Array.isArray(history) ? history : [];
    return [entry, ...previous.filter(item => text(item?.runId) !== entry.runId)].slice(0, MAX_HISTORY_ENTRIES);
}

export { MAX_HISTORY_ENTRIES };