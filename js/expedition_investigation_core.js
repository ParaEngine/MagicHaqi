const INVESTIGATION_ID = 'glowshroom-spore-anomaly';
const TARGET_BIOME = '荧光沼泽';
const MIN_PARTIAL_NODES = 8;
const SURVIVAL_PARTIAL_NODES = 5;
const EVIDENCE_TO_REVEAL = 1;
const EVIDENCE_TO_CONFRONT = 4;
const INVESTIGATION_NODE_MIN_TIER = 6;
const INVESTIGATION_NODE_MAX_TIER = 10;

export const EXPEDITION_INVESTIGATION = Object.freeze({
    id: INVESTIGATION_ID,
    title: '荧光沼泽 · 孢子异变',
    biome: TARGET_BIOME,
    branches: Object.freeze([
        Object.freeze({ id: 'missing-companion', label: '追踪失踪伙伴', hint: '沿发光羽毛寻找被孢子群困住的伙伴。' }),
        Object.freeze({ id: 'sunken-ruins', label: '解读地下遗迹', hint: '调查沉没观测站与孢子异变的关联。' }),
    ]),
    evidenceToConfront: EVIDENCE_TO_CONFRONT,
});

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizedRunId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function stableHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function investigationStore(settlement) {
    const safeSettlement = settlement && typeof settlement === 'object' ? settlement : {};
    const investigations = safeSettlement.investigations && typeof safeSettlement.investigations === 'object'
        ? safeSettlement.investigations
        : (safeSettlement.investigations = {});
    const source = investigations[INVESTIGATION_ID] && typeof investigations[INVESTIGATION_ID] === 'object'
        ? investigations[INVESTIGATION_ID]
        : (investigations[INVESTIGATION_ID] = {});
    source.evidence = Math.min(EVIDENCE_TO_CONFRONT, nonNegativeInteger(source.evidence));
    source.branchId = EXPEDITION_INVESTIGATION.branches.some(branch => branch.id === source.branchId) ? source.branchId : '';
    source.recordedRunIds = source.recordedRunIds && typeof source.recordedRunIds === 'object' ? source.recordedRunIds : {};
    source.lastOutcome = source.lastOutcome && typeof source.lastOutcome === 'object' ? source.lastOutcome : null;
    source.resolution = source.resolution && typeof source.resolution === 'object' ? source.resolution : null;
    return source;
}

function stageFor(source) {
    if (source.resolution) return 'resolved';
    if (source.evidence < EVIDENCE_TO_REVEAL) return 'undiscovered';
    if (!source.branchId) return 'choose-branch';
    if (source.evidence < EVIDENCE_TO_CONFRONT) return 'investigating';
    return 'confrontation-ready';
}

export function getExpeditionInvestigationProgress(settlement) {
    const source = investigationStore(settlement);
    const branch = EXPEDITION_INVESTIGATION.branches.find(item => item.id === source.branchId) || null;
    return {
        ...EXPEDITION_INVESTIGATION,
        evidence: source.evidence,
        branchId: source.branchId,
        branch,
        stage: stageFor(source),
        lastOutcome: source.lastOutcome ? { ...source.lastOutcome } : null,
        resolution: source.resolution ? { ...source.resolution } : null,
    };
}

export function chooseExpeditionInvestigationBranch(settlement, branchId) {
    const source = investigationStore(settlement);
    if (stageFor(source) !== 'choose-branch') return { applied: false, reason: 'branch-unavailable', progress: getExpeditionInvestigationProgress(settlement) };
    const branch = EXPEDITION_INVESTIGATION.branches.find(item => item.id === String(branchId || ''));
    if (!branch) return { applied: false, reason: 'invalid-branch', progress: getExpeditionInvestigationProgress(settlement) };
    source.branchId = branch.id;
    return { applied: true, reason: 'branch-chosen', progress: getExpeditionInvestigationProgress(settlement) };
}

export function createExpeditionInvestigationMission(settlement, expedition, runId, supportSpecialties = []) {
    const progress = getExpeditionInvestigationProgress(settlement);
    const normalizedId = normalizedRunId(runId);
    if (progress.stage !== 'investigating') return null;
    if (String(expedition?.biome || '') !== TARGET_BIOME || !normalizedId || !progress.branch) return null;
    const tierRange = INVESTIGATION_NODE_MAX_TIER - INVESTIGATION_NODE_MIN_TIER + 1;
    const tier = INVESTIGATION_NODE_MIN_TIER + stableHash(`${normalizedId}:${progress.branchId}`) % tierRange;
    const specialties = Array.isArray(supportSpecialties) ? supportSpecialties.slice(0, 2) : [];
    const matchingSpecialtyId = progress.branchId === 'missing-companion' ? 'scout' : 'restore';
    const supportAdvantage = specialties.find(specialty => specialty?.id === matchingSpecialtyId) || null;
    return {
        investigationId: INVESTIGATION_ID,
        branchId: progress.branchId,
        branchLabel: progress.branch.label,
        tier,
        evidenceBefore: progress.evidence,
        kind: progress.branchId === 'missing-companion' ? 'rescue-trace' : 'sunken-terminal',
        supportAdvantage: supportAdvantage ? {
            id: String(supportAdvantage.id || ''),
            name: String(supportAdvantage.name || ''),
            role: String(supportAdvantage.investigationRole || ''),
            benefit: String(supportAdvantage.investigationBenefit || ''),
        } : null,
    };
}

export function createExpeditionConfrontationMission(settlement, runId, specialty = null) {
    const progress = getExpeditionInvestigationProgress(settlement);
    const normalizedId = normalizedRunId(runId);
    if (progress.stage !== 'confrontation-ready' || !normalizedId || !progress.branch) return null;
    return {
        investigationId: INVESTIGATION_ID,
        branchId: progress.branchId,
        branchLabel: progress.branch.label,
        kind: 'spore-source',
        tier: 3,
        evidence: progress.evidence,
        investigationAdvantage: String(progress.lastOutcome?.advantage || ''),
        specialtyId: String(specialty?.id || ''),
        specialtyName: String(specialty?.name || ''),
        specialtyRole: String(specialty?.investigationRole || ''),
    };
}

export function recordExpeditionConfrontationOutcome(settlement, launch, data = {}, now = Date.now()) {
    const source = investigationStore(settlement);
    if (source.resolution) return { applied: false, reason: 'already-resolved', progress: getExpeditionInvestigationProgress(settlement) };
    if (stageFor(source) !== 'confrontation-ready') return { applied: false, reason: 'confrontation-unavailable', progress: getExpeditionInvestigationProgress(settlement) };
    const mission = launch?.params?.confrontationMission;
    const outcome = data?.confrontationOutcome;
    const matches = mission?.investigationId === INVESTIGATION_ID
        && mission?.branchId === source.branchId
        && outcome?.investigationId === INVESTIGATION_ID
        && outcome?.branchId === source.branchId
        && outcome?.resolved === true;
    if (!matches) return { applied: false, reason: 'invalid-confrontation', progress: getExpeditionInvestigationProgress(settlement) };
    source.resolution = {
        runId: normalizedRunId(data?.runId || launch?.params?.runId),
        branchId: source.branchId,
        ending: String(outcome.ending || '').slice(0, 80),
        ecologyChange: String(outcome.ecologyChange || '').slice(0, 120),
        keepsake: String(outcome.keepsake || '').slice(0, 80),
        resolvedAt: Number(now) || Date.now(),
    };
    return { applied: true, reason: 'investigation-resolved', progress: getExpeditionInvestigationProgress(settlement) };
}

export function recordExpeditionInvestigationOutcome(settlement, launch, data = {}, now = Date.now()) {
    const expedition = launch?.params?.expedition || {};
    const runId = normalizedRunId(data.runId || launch?.params?.runId);
    const source = investigationStore(settlement);
    if (String(expedition.biome || '') !== TARGET_BIOME) {
        return { applied: false, reason: 'unrelated-biome', progress: getExpeditionInvestigationProgress(settlement) };
    }
    if (!runId) return { applied: false, reason: 'invalid-run', progress: getExpeditionInvestigationProgress(settlement) };
    if (source.recordedRunIds[runId]) return { applied: false, reason: 'already-recorded', progress: getExpeditionInvestigationProgress(settlement) };
    const completed = data.completed === true && data.passed === true;
    const completedNodes = nonNegativeInteger(data.completedNodes);
    const partialNodeRequirement = launch?.params?.supportRoutePlan?.id === 'survival-extraction'
        ? SURVIVAL_PARTIAL_NODES
        : MIN_PARTIAL_NODES;
    if (!completed && completedNodes < partialNodeRequirement) {
        return { applied: false, reason: 'insufficient-progress', progress: getExpeditionInvestigationProgress(settlement) };
    }
    if (stageFor(source) === 'choose-branch') {
        return { applied: false, reason: 'branch-required', progress: getExpeditionInvestigationProgress(settlement) };
    }
    if (source.evidence >= EVIDENCE_TO_CONFRONT) {
        return { applied: false, reason: 'confrontation-ready', progress: getExpeditionInvestigationProgress(settlement) };
    }
    if (source.branchId) {
        const mission = launch?.params?.investigationMission;
        const outcome = data?.investigationOutcome;
        const missionMatches = mission?.investigationId === INVESTIGATION_ID && mission?.branchId === source.branchId;
        const outcomeMatches = outcome?.investigationId === INVESTIGATION_ID && outcome?.branchId === source.branchId && outcome?.resolved === true;
        if (!missionMatches || !outcomeMatches) {
            return { applied: false, reason: 'investigation-node-incomplete', progress: getExpeditionInvestigationProgress(settlement) };
        }
    }
    source.recordedRunIds[runId] = true;
    source.evidence += 1;
    source.lastOutcome = {
        runId,
        completed,
        completedNodes,
        discovery: String(data?.investigationOutcome?.discovery || '').slice(0, 120),
        routeHint: String(data?.investigationOutcome?.routeHint || '').slice(0, 120),
        advantage: String(data?.investigationOutcome?.advantage || '').slice(0, 60),
        mutationInsights: nonNegativeInteger(data?.mutationInsights),
        recordedAt: Number(now) || Date.now(),
    };
    return { applied: true, reason: source.evidence === 1 ? 'investigation-discovered' : 'evidence-recorded', progress: getExpeditionInvestigationProgress(settlement) };
}
