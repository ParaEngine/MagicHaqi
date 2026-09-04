export const SECTOR_EVENT_ID = 'stardust-tide-01';
export const SECTOR_EVENT_VERSION = 1;
export const SECTOR_SIDE_CASE_ID = 'crystal-drift';
const DAY_MS = 24 * 60 * 60 * 1000;

export const SECTOR_EVENT_CALENDAR = Object.freeze({
    startsAt: Date.parse('2026-08-25T00:00:00+08:00'),
    chapterOpensAt: Object.freeze([
        Date.parse('2026-08-25T00:00:00+08:00'),
        Date.parse('2026-09-01T00:00:00+08:00'),
        Date.parse('2026-09-08T00:00:00+08:00'),
        Date.parse('2026-09-15T00:00:00+08:00'),
    ]),
    makeUpEndsAt: Date.parse('2026-09-29T00:00:00+08:00'),
    archivesAt: Date.parse('2026-10-06T00:00:00+08:00'),
});

const STAGES = Object.freeze([
    'dormant',
    'week1-discovery',
    'week2-divergence',
    'week3-convergence',
    'week4-finale',
    'archived',
]);

function text(value) {
    return String(value || '').trim();
}

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizedRunId(value) {
    return text(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function timestamp(value, fallback = 0) {
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : fallback;
}

export function getSectorEventAvailability(now = Date.now(), calendar = SECTOR_EVENT_CALENDAR) {
    const currentTime = timestamp(now, Date.now());
    const startsAt = timestamp(calendar?.startsAt);
    const chapterOpensAt = Array.isArray(calendar?.chapterOpensAt)
        ? calendar.chapterOpensAt.slice(0, 4).map(value => timestamp(value))
        : [];
    const makeUpEndsAt = timestamp(calendar?.makeUpEndsAt, chapterOpensAt[3] + 14 * DAY_MS);
    const archivesAt = timestamp(calendar?.archivesAt, makeUpEndsAt + 7 * DAY_MS);
    const availableChapter = currentTime < startsAt
        ? 0
        : chapterOpensAt.reduce((chapter, opensAt, index) => currentTime >= opensAt ? index + 1 : chapter, 1);
    return {
        availableChapter: Math.min(4, availableChapter),
        started: currentTime >= startsAt,
        makeUpActive: currentTime >= chapterOpensAt[3] && currentTime < makeUpEndsAt,
        progressionClosed: currentTime >= makeUpEndsAt,
        archived: currentTime >= archivesAt,
        startsAt,
        nextChapterOpensAt: chapterOpensAt.find(opensAt => currentTime < opensAt) || 0,
        makeUpEndsAt,
        archivesAt,
    };
}

function eventStore(settlement) {
    const safeSettlement = settlement && typeof settlement === 'object' ? settlement : {};
    const sectorEvents = safeSettlement.sectorEvents && typeof safeSettlement.sectorEvents === 'object'
        ? safeSettlement.sectorEvents
        : (safeSettlement.sectorEvents = {});
    const source = sectorEvents[SECTOR_EVENT_ID] && typeof sectorEvents[SECTOR_EVENT_ID] === 'object'
        ? sectorEvents[SECTOR_EVENT_ID]
        : (sectorEvents[SECTOR_EVENT_ID] = {});
    source.version = nonNegativeInteger(source.version) || SECTOR_EVENT_VERSION;
    source.stage = STAGES.includes(source.stage) ? source.stage : 'dormant';
    source.startedAt = nonNegativeInteger(source.startedAt);
    source.primaryInvestigationId = text(source.primaryInvestigationId) || 'glowshroom-spore-anomaly';
    source.primaryBranchId = text(source.primaryBranchId);
    source.sideCase = source.sideCase && typeof source.sideCase === 'object' ? source.sideCase : {};
    source.sideCase.id = SECTOR_SIDE_CASE_ID;
    source.sideCase.discovered = source.sideCase.discovered === true;
    source.sideCase.discoveredAt = nonNegativeInteger(source.sideCase.discoveredAt);
    source.sideCase.choiceId = ['stabilize-current', 'follow-fragments'].includes(source.sideCase.choiceId)
        ? source.sideCase.choiceId
        : '';
    source.sideCase.chosenAt = nonNegativeInteger(source.sideCase.chosenAt);
    source.completedMilestones = source.completedMilestones && typeof source.completedMilestones === 'object'
        ? source.completedMilestones
        : {};
    source.recordedRunIds = source.recordedRunIds && typeof source.recordedRunIds === 'object'
        ? source.recordedRunIds
        : {};
    source.finalePreparation = source.finalePreparation && typeof source.finalePreparation === 'object'
        ? source.finalePreparation
        : null;
    if (source.finalePreparation) {
        source.finalePreparation.supportSpecialtyIds = Array.isArray(source.finalePreparation.supportSpecialtyIds)
            ? source.finalePreparation.supportSpecialtyIds.map(text).filter(Boolean).slice(0, 2)
            : [];
        source.finalePreparation.mutationInsights = nonNegativeInteger(source.finalePreparation.mutationInsights);
    }
    source.resolution = source.resolution && typeof source.resolution === 'object' ? source.resolution : null;
    if (source.resolution) source.stage = 'archived';
    return source;
}

function snapshot(source) {
    return {
        id: SECTOR_EVENT_ID,
        version: source.version,
        stage: source.stage,
        startedAt: source.startedAt,
        primaryInvestigationId: source.primaryInvestigationId,
        primaryBranchId: source.primaryBranchId,
        sideCase: { ...source.sideCase },
        completedMilestones: { ...source.completedMilestones },
        finalePreparation: source.finalePreparation ? { ...source.finalePreparation, supportSpecialtyIds: [...source.finalePreparation.supportSpecialtyIds] } : null,
        resolution: source.resolution ? { ...source.resolution } : null,
    };
}

export function getSectorEventProgress(settlement) {
    return snapshot(eventStore(settlement));
}

export function startSectorEvent(settlement, now = Date.now()) {
    const source = eventStore(settlement);
    if (source.stage !== 'dormant') return { applied: false, reason: 'already-started', progress: snapshot(source) };
    source.stage = 'week1-discovery';
    source.startedAt = Number(now) || Date.now();
    return { applied: true, reason: 'event-started', progress: snapshot(source) };
}

export function synchronizeSectorEvent(settlement, investigationProgress, { availableChapter = 1 } = {}) {
    const source = eventStore(settlement);
    if (source.stage === 'dormant') return { applied: false, reason: 'event-not-started', progress: snapshot(source) };
    if (source.stage === 'archived') return { applied: false, reason: 'event-archived', progress: snapshot(source) };
    const chapter = Math.min(4, nonNegativeInteger(availableChapter));
    if (chapter < 1) return { applied: false, reason: 'chapter-unavailable', progress: snapshot(source) };
    const investigationStage = text(investigationProgress?.stage);
    const branchId = text(investigationProgress?.branchId);
    if (branchId && !source.primaryBranchId) source.primaryBranchId = branchId;
    let nextStage = source.stage;
    if (chapter >= 2 && source.primaryBranchId) nextStage = 'week2-divergence';
    if (chapter >= 3 && (investigationStage === 'confrontation-ready' || investigationStage === 'resolved')) nextStage = 'week3-convergence';
    if (chapter >= 4 && source.finalePreparation) nextStage = 'week4-finale';
    const currentIndex = STAGES.indexOf(source.stage);
    const nextIndex = STAGES.indexOf(nextStage);
    if (nextIndex <= currentIndex) return { applied: false, reason: 'no-stage-change', progress: snapshot(source) };
    source.stage = nextStage;
    return { applied: true, reason: 'stage-advanced', progress: snapshot(source) };
}

export function recordSectorEventMilestone(settlement, milestoneId, runId, now = Date.now()) {
    const source = eventStore(settlement);
    const id = text(milestoneId).slice(0, 80);
    const normalizedId = normalizedRunId(runId);
    if (!id || !normalizedId) return { applied: false, reason: 'invalid-milestone', progress: snapshot(source) };
    if (source.recordedRunIds[normalizedId]) return { applied: false, reason: 'already-recorded', progress: snapshot(source) };
    source.recordedRunIds[normalizedId] = true;
    source.completedMilestones[id] = Number(now) || Date.now();
    return { applied: true, reason: 'milestone-recorded', progress: snapshot(source) };
}

export function prepareSectorEventFinale(settlement, investigationProgress, data = {}, now = Date.now()) {
    const source = eventStore(settlement);
    if (source.finalePreparation) return { applied: false, reason: 'already-prepared', progress: snapshot(source) };
    if (text(investigationProgress?.stage) !== 'resolved') return { applied: false, reason: 'investigation-unresolved', progress: snapshot(source) };
    const supportSpecialtyIds = [...new Set((Array.isArray(data.supportSpecialtyIds) ? data.supportSpecialtyIds : [])
        .map(text)
        .filter(Boolean))].slice(0, 2);
    source.primaryBranchId = source.primaryBranchId || text(investigationProgress?.branchId);
    source.finalePreparation = {
        primaryBranchId: source.primaryBranchId,
        investigationAdvantage: text(data.investigationAdvantage || investigationProgress?.lastOutcome?.advantage).slice(0, 60),
        supportSpecialtyIds,
        mutationInsights: nonNegativeInteger(data.mutationInsights ?? investigationProgress?.lastOutcome?.mutationInsights),
        preparedAt: Number(now) || Date.now(),
    };
    return { applied: true, reason: 'finale-prepared', progress: snapshot(source) };
}

export function resolveSectorEvent(settlement, outcome = {}, now = Date.now()) {
    const source = eventStore(settlement);
    if (source.resolution) return { applied: false, reason: 'already-resolved', progress: snapshot(source) };
    if (source.stage !== 'week4-finale' || outcome.resolved !== true) {
        return { applied: false, reason: 'invalid-finale', progress: snapshot(source) };
    }
    source.resolution = {
        ending: text(outcome.ending).slice(0, 80),
        ecologyChange: text(outcome.ecologyChange).slice(0, 120),
        rescuedCompanionId: text(outcome.rescuedCompanionId).slice(0, 80),
        keepsake: text(outcome.keepsake).slice(0, 80),
        resolvedAt: Number(now) || Date.now(),
    };
    source.stage = 'archived';
    return { applied: true, reason: 'event-resolved', progress: snapshot(source) };
}

export function discoverSectorSideCase(settlement, now = Date.now()) {
    const source = eventStore(settlement);
    if (STAGES.indexOf(source.stage) < STAGES.indexOf('week2-divergence')) {
        return { applied: false, reason: 'side-case-locked', progress: snapshot(source) };
    }
    if (source.sideCase.discovered) return { applied: false, reason: 'already-discovered', progress: snapshot(source) };
    source.sideCase.discovered = true;
    source.sideCase.discoveredAt = Number(now) || Date.now();
    return { applied: true, reason: 'side-case-discovered', progress: snapshot(source) };
}

export function chooseSectorSideCase(settlement, choiceId, now = Date.now()) {
    const source = eventStore(settlement);
    const id = text(choiceId);
    if (!source.sideCase.discovered) return { applied: false, reason: 'side-case-undiscovered', progress: snapshot(source) };
    if (source.sideCase.choiceId) return { applied: false, reason: 'choice-frozen', progress: snapshot(source) };
    if (!['stabilize-current', 'follow-fragments'].includes(id)) {
        return { applied: false, reason: 'invalid-choice', progress: snapshot(source) };
    }
    source.sideCase.choiceId = id;
    source.sideCase.chosenAt = Number(now) || Date.now();
    return { applied: true, reason: 'side-case-chosen', progress: snapshot(source) };
}

export function createSectorEventFinaleMission(settlement, runId) {
    const source = eventStore(settlement);
    if (source.stage !== 'week4-finale' || !source.finalePreparation || source.resolution) return null;
    const preparation = source.finalePreparation;
    const branchId = text(preparation.primaryBranchId || source.primaryBranchId);
    const specialties = [...preparation.supportSpecialtyIds];
    const specialtyId = ['scout', 'restore', 'vanguard', 'channel'].find(id => specialties.includes(id)) || specialties[0] || '';
    const branchTarget = branchId === 'missing-companion'
        ? { id: 'rescue-beacon', label: '救援失踪伙伴', operation: '沿三短一长的闪光护送伙伴脱离晶流' }
        : { id: 'close-relay', label: '关闭遗迹中继器', operation: '按月环记录逆转三组潮汐机关' };
    const supportRule = {
        scout: { id: 'scout', label: '寻迹预警', effect: '提前标记伏击节点，可安全绕过一次晶尘脉冲' },
        restore: { id: 'restore', label: '修复容错', effect: '机关首次误触不会烧毁终局记录' },
        vanguard: { id: 'vanguard', label: '守御撤离', effect: '救援目标受击时保留一次撤离保护' },
        channel: { id: 'channel', label: '异变捷径', effect: '允许消耗一条异变洞察穿过不稳定晶流' },
    }[specialtyId] || { id: 'evidence', label: '证据校准', effect: '依靠封存证据识别一条稳定路线' };
    const mutationInsights = nonNegativeInteger(preparation.mutationInsights);
    const bossVariant = mutationInsights >= 2 ? 'resonant-core' : 'fractured-core';
    const hiddenEndingEligible = mutationInsights >= 2 && source.sideCase.choiceId === 'follow-fragments';
    return {
        id: 'stardust-tide-finale',
        runId: normalizedRunId(runId),
        eventId: SECTOR_EVENT_ID,
        branchId,
        sideCaseChoiceId: source.sideCase.choiceId,
        mutationInsights,
        layers: [
            { tier: 1, kind: 'branch-objective', ...branchTarget },
            { tier: 2, kind: 'support-operation', ...supportRule },
            { tier: 3, kind: 'mutation-boss', id: bossVariant, label: mutationInsights >= 2 ? '共鸣星尘核心' : '裂变星尘核心', effect: mutationInsights >= 2 ? '可读取核心节律并选择共生结局' : '必须在晶流坍缩前封存核心' },
        ],
        hiddenEndingEligible,
    };
}