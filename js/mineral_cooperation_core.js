export const COOPERATION_REWARD_CAPS = Object.freeze({
    bonusStones: 3,
    research: 3,
});

export const ELITE_CORE_HITS_REQUIRED = 5;

export const COOPERATION_STAGES = Object.freeze([
    Object.freeze({ id: 'survey', name: '勘测阶段', durationSeconds: 28, hitsRequired:2, hint: '先锁定两处有效矿层，再决定下一段的采法。' }),
    Object.freeze({ id: 'excavation', name: '采掘阶段', durationSeconds: 28, hitsRequired:3, hint: '完成三次精准回收，换取最后一段的策略窗口。' }),
    Object.freeze({ id: 'overload', name: '过载回收', durationSeconds: 28, hitsRequired:3, hint: '矿层正在坍缩：达成最后三次回收后撤离或挑战矿核。' }),
]);

export const COOPERATION_SIGNAL_EVENTS = Object.freeze([
    Object.freeze({ id: 'stabilize', name: '锚定力场', description: '固定矿层边界，本局稳定度储备 +12。', stabilityReserve: 12, comboBonus: 0, missGuard: 0 }),
    Object.freeze({ id: 'resonance', name: '共鸣校准', description: '校准采样频率，本阶段连击不会因时间流逝中断。', stabilityReserve: 0, comboBonus: 0, missGuard: 0, preserveCombo: true }),
    Object.freeze({ id: 'deflection', name: '偏导护盾', description: '吸收下一次失误，不中断连击也不损失稳定度。', stabilityReserve: 0, comboBonus: 0, missGuard: 1 }),
]);

export const COOPERATION_DAILY_DRILLS = Object.freeze([
    Object.freeze({ id: 'steady-hands', name: '稳手回收', description: '本局命中至少 5 次，且失稳不超过 2 次。' }),
    Object.freeze({ id: 'combo-survey', name: '连击勘测', description: '本局最高连击达到 x3。' }),
    Object.freeze({ id: 'elite-observation', name: '精英观测', description: '完成一次精英矿核冲刺。' }),
]);

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

export function cooperationStage(index) {
    return COOPERATION_STAGES[Math.max(0, Math.min(COOPERATION_STAGES.length - 1, nonNegativeInteger(index)))];
}

export function cooperationStability({ elapsedSeconds, misses, stageIndex, stabilityReserve = 0 }) {
    const stage = cooperationStage(stageIndex);
    const timeDrain = Math.min(1, Math.max(0, Number(elapsedSeconds) || 0) / stage.durationSeconds) * 16;
    const missDrain = nonNegativeInteger(misses) * 8;
    return Math.max(0, Math.min(100, 100 + Math.min(24, nonNegativeInteger(stabilityReserve)) - stageIndex * 16 - timeDrain - missDrain));
}

export function cooperationReward({ hits, bestCombo }) {
    return {
        bonusStones: Math.min(COOPERATION_REWARD_CAPS.bonusStones, nonNegativeInteger(hits) > 0 ? 1 + Math.floor((nonNegativeInteger(hits) - 1) / 3) : 0),
        research: Math.min(COOPERATION_REWARD_CAPS.research, Math.floor(nonNegativeInteger(bestCombo) / 3)),
    };
}

export function canContinueCooperation({ stageIndex, stability }) {
    return nonNegativeInteger(stageIndex) < COOPERATION_STAGES.length - 1 && Number(stability) > 0;
}

export function cooperationSignalEvent(id) {
    return COOPERATION_SIGNAL_EVENTS.find(event => event.id === id) || null;
}

export function applyCooperationSignalEvent(state = {}, id) {
    const event = cooperationSignalEvent(id);
    if (!event) return { ...state, applied: false };
    return {
        ...state,
        stabilityReserve: Math.min(24, nonNegativeInteger(state.stabilityReserve) + event.stabilityReserve),
        combo: nonNegativeInteger(state.combo) + event.comboBonus,
        bestCombo: Math.max(nonNegativeInteger(state.bestCombo), nonNegativeInteger(state.combo) + event.comboBonus),
        missGuard: nonNegativeInteger(state.missGuard) + event.missGuard,
        preserveCombo: Boolean(state.preserveCombo || event.preserveCombo),
        applied: true,
    };
}

export function eliteCoreResult({ hits, hitsRequired = ELITE_CORE_HITS_REQUIRED }) {
    const required = Math.max(1, nonNegativeInteger(hitsRequired));
    return {
        completed: nonNegativeInteger(hits) >= required,
        hitsRequired: required,
        unlocksInsight: nonNegativeInteger(hits) >= required,
        bonusStones: 0,
        research: 0,
    };
}

export function cooperationTacticalAssessment({ hits, misses, eliteCompleted = false }) {
    const confirmedElite = Boolean(eliteCompleted);
    const score = nonNegativeInteger(hits) * 2 - nonNegativeInteger(misses) * 3 + (confirmedElite ? 8 : 0);
    if (confirmedElite && nonNegativeInteger(misses) <= 2) return { id:'apex', name:'深层尖兵', score, bonusStones:0, research:0 };
    if (score >= 14) return { id:'steady', name:'稳定回收', score, bonusStones:0, research:0 };
    if (score >= 5) return { id:'field', name:'矿层观察', score, bonusStones:0, research:0 };
    return { id:'withdrawal', name:'谨慎撤离', score, bonusStones:0, research:0 };
}

export function cooperationDailyDrill(day) {
    const normalizedDay = String(day || '').slice(0, 32);
    const index = [...normalizedDay].reduce((total, character) => total + character.charCodeAt(0), 0) % COOPERATION_DAILY_DRILLS.length;
    return COOPERATION_DAILY_DRILLS[index];
}

export function cooperationDailyDrillResult({ day, hits, bestCombo, misses, eliteCompleted = false }) {
    const drill = cooperationDailyDrill(day);
    const completed = drill.id === 'steady-hands'
        ? nonNegativeInteger(hits) >= 5 && nonNegativeInteger(misses) <= 2
        : drill.id === 'combo-survey'
            ? nonNegativeInteger(bestCombo) >= 3
            : Boolean(eliteCompleted);
    return { ...drill, completed, bonusStones:0, research:0 };
}

export function cooperationDailyDrillGuidance({ day, hits, bestCombo, misses, eliteCompleted = false }) {
    const result = cooperationDailyDrillResult({ day, hits, bestCombo, misses, eliteCompleted });
    if (result.completed) return { ...result, progress:'演练目标已完成，保持当前节奏即可。', bonusStones:0, research:0 };
    if (result.id === 'steady-hands') {
        const hitGap = Math.max(0, 5 - nonNegativeInteger(hits));
        const missGap = Math.max(0, nonNegativeInteger(misses) - 2);
        const progress = missGap ? `先控制失稳：还需将失稳压低 ${missGap} 次，再完成 ${hitGap} 次命中。` : `稳住节奏：再完成 ${hitGap} 次命中，且失稳保持在 2 次以内。`;
        return { ...result, progress, bonusStones:0, research:0 };
    }
    if (result.id === 'combo-survey') return { ...result, progress:`维持连续操作：最高连击还差 x${Math.max(0, 3 - nonNegativeInteger(bestCombo))}。`, bonusStones:0, research:0 };
    return { ...result, progress:'完成第三段后选择精英矿核冲刺，并在限时内命中 5 次。', bonusStones:0, research:0 };
}

export function cooperationDailyDrillPreparation(day) {
    const drill = cooperationDailyDrill(day);
    const preparation = drill.id === 'steady-hands'
        ? '操作倾向：先守住稳定度，避免连续失误。'
        : drill.id === 'combo-survey'
            ? '操作倾向：优先维持连击窗口，再考虑下潜。'
            : '操作倾向：先完成三段回收，再进入精英矿核冲刺。';
    return { ...drill, preparation, bonusStones:0, research:0 };
}

export function cooperationDailyDrillNextFocus({ day, hits, bestCombo, misses, eliteCompleted = false }) {
    const guidance = cooperationDailyDrillGuidance({ day, hits, bestCombo, misses, eliteCompleted });
    const focus = guidance.completed
        ? '下次重点：演练已完成，保持当前节奏并按局势选择信号。'
        : guidance.id === 'steady-hands'
            ? nonNegativeInteger(misses) > 2
                ? '下次重点：先减少失误，再补足命中次数。'
                : '下次重点：保持失稳不超过 2 次，优先完成稳定命中。'
            : guidance.id === 'combo-survey'
                ? '下次重点：连续操作时优先保护连击窗口。'
                : '下次重点：先完成第三段，再预留精英矿核冲刺时间。';
    return { ...guidance, focus, bonusStones:0, research:0 };
}

export function cooperationDailyDrillSignalStrategyReview({
    day, hits, bestCombo, misses, eliteCompleted = false, selections = []
}) {
    const guidance = cooperationDailyDrillGuidance({ day, hits, bestCombo, misses, eliteCompleted });
    const selectedIds = new Set(
        (Array.isArray(selections) ? selections : [])
            .map(selection => String(selection?.selectedSignalId || ''))
            .filter(id => cooperationSignalEvent(id))
    );
    if (!selectedIds.size) {
        return {
            ...guidance,
            aligned:false,
            summary:'信号方向：本局未经过矿层岔口，无需复盘信号选择。',
            bonusStones:0,
            research:0
        };
    }
    if (guidance.completed) {
        return {
            ...guidance,
            aligned:true,
            summary:'信号方向：演练目标已完成，本局选择仅作操作复盘。',
            bonusStones:0,
            research:0
        };
    }
    const preferredIds = guidance.id === 'combo-survey'
        ? ['resonance']
        : ['stabilize', 'deflection'];
    const aligned = preferredIds.some(id => selectedIds.has(id));
    const summary = guidance.id === 'combo-survey'
        ? aligned
            ? '信号方向：已使用共鸣校准，和连击目标方向一致。'
            : '信号方向：后续可尝试共鸣校准，保护连击窗口。'
        : guidance.id === 'elite-observation'
            ? aligned
                ? '信号方向：已优先保护稳定度，为精英冲刺保留路径。'
                : '信号方向：后续可优先保护稳定度，再进入精英冲刺。'
            : aligned
                ? '信号方向：已优先保护稳定度，符合稳手回收的操作方向。'
                : '信号方向：后续可优先保护稳定度，控制失稳次数。';
    return { ...guidance, aligned, summary, bonusStones:0, research:0 };
}

export function cooperationDailyDrillSignalRecommendation({ day, hits, bestCombo, misses, eliteCompleted = false, signalIds = [] }) {
    const guidance = cooperationDailyDrillGuidance({ day, hits, bestCombo, misses, eliteCompleted });
    const availableIds = new Set(Array.isArray(signalIds) ? signalIds.map(id => String(id || '')) : []);
    if (guidance.completed) return { ...guidance, signalId:'', recommendation:'演练已完成，按当前局势自由选择信号。', bonusStones:0, research:0 };
    const preferredIds = guidance.id === 'combo-survey'
        ? ['resonance', 'deflection', 'stabilize']
        : guidance.id === 'elite-observation'
            ? ['deflection', 'stabilize', 'resonance']
            : ['deflection', 'stabilize', 'resonance'];
    const signalId = preferredIds.find(id => availableIds.has(id)) || '';
    const recommendation = guidance.id === 'combo-survey'
        ? '推荐共鸣校准，保护本阶段连击窗口。'
        : guidance.id === 'elite-observation'
            ? '推荐优先保全稳定度，为精英矿核冲刺保留路径。'
            : '推荐优先防失稳，保住稳手回收的失稳条件。';
    return { ...guidance, signalId, recommendation, bonusStones:0, research:0 };
}

export function cooperationDailyDrillSignalReview(selections = []) {
    const records = (Array.isArray(selections) ? selections : []).filter(selection =>
        typeof selection?.recommendedSignalId === 'string'
        && typeof selection?.selectedSignalId === 'string'
        && cooperationSignalEvent(selection.selectedSignalId)
    );
    const recommended = records.filter(selection => selection.recommendedSignalId).length;
    const followed = records.filter(selection =>
        selection.recommendedSignalId
        && selection.recommendedSignalId === selection.selectedSignalId
    ).length;
    const summary = !recommended
        ? '本局没有可用的演练信号建议。'
        : followed === recommended
            ? `采纳了 ${followed}/${recommended} 次演练建议，仅作操作复盘。`
            : `采纳了 ${followed}/${recommended} 次演练建议，未采纳时也不会影响结算。`;
    const trace = records.map(selection => {
        const stage = cooperationStage(selection.stageIndex);
        const signal = cooperationSignalEvent(selection.selectedSignalId);
        const followedRecommendation = selection.recommendedSignalId
            && selection.recommendedSignalId === selection.selectedSignalId;
        return `${stage.name}：${signal.name}${followedRecommendation ? '（采纳建议）' : '（自主调整）'}`;
    });
    return { recommended, followed, summary, trace, bonusStones:0, research:0 };
}

export function cooperationDailyDrillArchiveSummary(record = {}) {
    const day = String(record?.day || '');
    const drill = cooperationDailyDrill(day);
    const isValidRecord = /^\d{4}-\d{2}-\d{2}$/.test(day)
        && record?.drillId === drill.id
        && Number(record?.completedAt) > 0;
    return {
        day,
        drillId:isValidRecord ? drill.id : '',
        name:isValidRecord ? drill.name : '',
        description:isValidRecord ? drill.description : '',
        completedAt:isValidRecord ? Math.max(0, Number(record.completedAt) || 0) : 0,
        archived:isValidRecord,
        bonusStones:0,
        research:0
    };
}

export function cooperationDailyDrillArchiveOverview(history = [], limit = 3) {
    const maxRecords = Math.max(1, Math.floor(Number(limit) || 0));
    const records = (Array.isArray(history) ? history : [])
        .map(cooperationDailyDrillArchiveSummary)
        .filter(record => record.archived)
        .sort((left, right) => right.day.localeCompare(left.day))
        .slice(0, maxRecords);
    const names = [...new Set(records.map(record => record.name))];
    return {
        records,
        count:records.length,
        coveredNames:names,
        summary:records.length
            ? `最近练习 ${records.length} 次：覆盖${names.join('、')}。`
            : '最近练习：尚未完成演练记录。',
        bonusStones:0,
        research:0
    };
}

export function cooperationDailyDrillArchive(history = [], record = {}) {
    const validHistory = (Array.isArray(history) ? history : []).filter(entry => {
        const day = String(entry?.day || '');
        return /^\d{4}-\d{2}-\d{2}$/.test(day) && entry?.drillId === cooperationDailyDrill(day).id && Number(entry?.completedAt) > 0;
    }).map(entry => ({ day:String(entry.day), drillId:String(entry.drillId), completedAt:Math.max(0, Number(entry.completedAt) || 0) }));
    const day = String(record?.day || '');
    const isValidRecord = Boolean(record?.completed) && /^\d{4}-\d{2}-\d{2}$/.test(day) && record?.drillId === cooperationDailyDrill(day).id && Number(record?.completedAt) > 0;
    const records = isValidRecord ? [...validHistory.filter(entry => entry.day !== day), { day, drillId:String(record.drillId), completedAt:Math.max(0, Number(record.completedAt) || 0) }] : validHistory;
    return records.sort((left, right) => right.day.localeCompare(left.day)).slice(0, 7);
}