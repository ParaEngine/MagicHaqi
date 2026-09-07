const MAX_HISTORY_ENTRIES = 10;

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function text(value) {
    return String(value || '').trim();
}

function normalizeMutationChoice(value) {
    const choice = text(value);
    return choice === 'accepted' || choice === 'declined' ? choice : 'not-encountered';
}

export function formatExpeditionHistoryProgress(entry) {
    const nodes = nonNegativeInteger(entry?.completedNodes);
    if (entry?.completed === true) return '两章完成';
    const chapter = nonNegativeInteger(entry?.chapter);
    if (chapter === 1 || chapter === 2) return `第${chapter === 1 ? '一' : '二'}章 ${Math.min(15, nodes)}/15`;
    return `推进 ${nodes} 个节点`;
}

function buildPlaytestSnapshot(launch, data) {
    const params = launch?.params || {};
    const leader = params.selectedPet || {};
    const investigation = params.investigationMission || {};
    const outcome = data.investigationOutcome || {};
    return {
        leader: {
            id: text(data.petId || leader.id),
            name: text(leader.name),
            specialtyId: text(leader.speciesSpecialty?.id),
        },
        supports: (Array.isArray(params.selectedSupportPets) ? params.selectedSupportPets : [])
            .slice(0, 2)
            .map(pet => ({
                id: text(pet?.id),
                name: text(pet?.name),
                specialtyId: text(pet?.speciesSpecialty?.id),
            })),
        routePlanId: text(params.supportRoutePlan?.id),
        investigation: {
            branchId: text(investigation.branchId || outcome.branchId),
            kind: text(investigation.kind),
            resolved: outcome.resolved === true,
            discovery: text(outcome.discovery).slice(0, 120),
            advantage: text(outcome.advantage).slice(0, 60),
        },
        mutationChoice: normalizeMutationChoice(data.mutationChoice),
        mutationInsights: nonNegativeInteger(data.mutationInsights),
        completedNodes: nonNegativeInteger(data.completedNodes),
        result: data.completed === true && data.passed === true ? 'completed' : text(data.reason || 'incomplete'),
    };
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
        chapter: [1, 2].includes(nonNegativeInteger(data.chapter)) ? nonNegativeInteger(data.chapter) : 0,
        completedNodes: nonNegativeInteger(data.completedNodes),
        captureCount: captures.length,
        capturedPets: captures.slice(0, 3).map(capture => ({
            speciesId: text(capture?.speciesId),
            imageSheetUrl: text(capture?.imageSheetUrl),
            imageUrl: text(capture?.imageUrl),
        })).filter(capture => capture.speciesId || capture.imageSheetUrl || capture.imageUrl),
        lootCount: loot.reduce((total, entry) => total + nonNegativeInteger(entry?.amount), 0),
        mineralContribution: {
            attackPercent: Math.max(0, Number(mineralBonuses.attackPercent) || 0),
            lootPercent: Math.max(0, Number(data.lootBonusPercent ?? mineralBonuses.expeditionLootPercent) || 0),
            baseLootCount,
            bonusLootCount,
        },
        equipmentCount: Array.isArray(data.equipmentDrops) ? data.equipmentDrops.length : 0,
        homeTreasureId: data.bossDefeated ? text(data.homeTreasureId) : '',
        playtest: buildPlaytestSnapshot(launch, data),
        restartOfRunId: text(data.restartOfRunId),
        finishedAt: Number(data.finishedAt) || now,
    };
}

export function recordExpeditionHistory(history, launch, data = {}, options = {}) {
    const previous = Array.isArray(history) ? history : [];
    const draft = buildExpeditionHistoryEntry(launch, data, options.now || Date.now());
    const restartSource = !draft.restartOfRunId && previous.find(item => item?.completed !== true
        && text(item?.expeditionId) === draft.expeditionId
        && text(item?.playtest?.investigation?.branchId) === draft.playtest.investigation.branchId);
    const entry = restartSource ? { ...draft, restartOfRunId: text(restartSource.runId) } : draft;
    return [entry, ...previous.filter(item => text(item?.runId) !== entry.runId)].slice(0, MAX_HISTORY_ENTRIES);
}

export function mergeCapturedPets(previous, captures) {
    const merged = [...(Array.isArray(previous) ? previous : [])];
    for (const capture of Array.isArray(captures) ? captures : []) {
        const normalized = {
            speciesId: text(capture?.expeditionSpeciesId || capture?.speciesId),
            imageSheetUrl: text(capture?.imageSheetUrl),
            imageUrl: text(capture?.imageUrl),
        };
        const key = normalized.imageSheetUrl || normalized.imageUrl || normalized.speciesId;
        if (key && !merged.some(item => (text(item?.imageSheetUrl) || text(item?.imageUrl) || text(item?.speciesId)) === key)) {
            merged.push(normalized);
        }
    }
    return merged;
}

export function aggregateExpeditionPlaytests(history) {
    const entries = (Array.isArray(history) ? history : []).filter(item => item?.playtest);
    const countBy = values => values.reduce((result, value) => {
        const key = text(value) || 'unknown';
        result[key] = (result[key] || 0) + 1;
        return result;
    }, {});
    const mutationEncounters = entries.filter(item => ['accepted', 'declined'].includes(item.playtest.mutationChoice));
    return {
        sampleSize: entries.length,
        completed: entries.filter(item => item.completed === true).length,
        completionRate: entries.length ? entries.filter(item => item.completed === true).length / entries.length : 0,
        routePlanCounts: countBy(entries.map(item => item.playtest.routePlanId)),
        branchCounts: countBy(entries.map(item => item.playtest.investigation?.branchId)),
        extractionNodeCounts: countBy(entries.filter(item => item.completed !== true).map(item => item.playtest.completedNodes)),
        mutationEncounterCount: mutationEncounters.length,
        mutationAcceptedCount: mutationEncounters.filter(item => item.playtest.mutationChoice === 'accepted').length,
        mutationAcceptanceRate: mutationEncounters.length
            ? mutationEncounters.filter(item => item.playtest.mutationChoice === 'accepted').length / mutationEncounters.length
            : 0,
        restartCount: entries.filter(item => text(item.restartOfRunId)).length,
    };
}

export { MAX_HISTORY_ENTRIES };