import assert from 'node:assert/strict';
import test from 'node:test';
import {
    chooseSectorSideCase,
    createSectorEventFinaleMission,
    discoverSectorSideCase,
    getSectorEventAvailability,
    getSectorEventProgress,
    prepareSectorEventFinale,
    recordSectorEventMilestone,
    resolveSectorEvent,
    startSectorEvent,
    synchronizeSectorEvent,
} from '../js/expedition_sector_event_core.js';

const calendar = {
    startsAt: 1000,
    chapterOpensAt: [1000, 2000, 3000, 4000],
    makeUpEndsAt: 5000,
    archivesAt: 6000,
};

test('活动日历按配置开放章节并保留第四周后的补做期', () => {
    assert.deepEqual(getSectorEventAvailability(500, calendar), {
        availableChapter: 0,
        started: false,
        makeUpActive: false,
        progressionClosed: false,
        archived: false,
        startsAt: 1000,
        nextChapterOpensAt: 1000,
        makeUpEndsAt: 5000,
        archivesAt: 6000,
    });
    assert.equal(getSectorEventAvailability(2500, calendar).availableChapter, 2);
    assert.equal(getSectorEventAvailability(4500, calendar).makeUpActive, true);
    assert.equal(getSectorEventAvailability(5500, calendar).progressionClosed, true);
    assert.equal(getSectorEventAvailability(6500, calendar).archived, true);
});

test('星域事件从旧存档安全初始化并只能启动一次', () => {
    const settlement = {};
    assert.equal(getSectorEventProgress(settlement).stage, 'dormant');
    assert.equal(startSectorEvent(settlement, 1000).progress.stage, 'week1-discovery');
    assert.equal(startSectorEvent(settlement, 2000).reason, 'already-started');
});

test('不完整的旧终局准备存档会被安全规范化', () => {
    const settlement = {
        sectorEvents: {
            'stardust-tide-01': {
                stage: 'week3-convergence',
                finalePreparation: { primaryBranchId: 'missing-companion', mutationInsights: -3 },
            },
        },
    };
    const progress = getSectorEventProgress(settlement);
    assert.deepEqual(progress.finalePreparation.supportSpecialtyIds, []);
    assert.equal(progress.finalePreparation.mutationInsights, 0);
});

test('时间只开放章节，调查结果控制实际推进', () => {
    const settlement = {};
    startSectorEvent(settlement, 1000);
    const blocked = synchronizeSectorEvent(settlement, { stage: 'undiscovered' }, { availableChapter: 4 });
    assert.equal(blocked.progress.stage, 'week1-discovery');

    const unavailable = synchronizeSectorEvent(settlement, { stage: 'resolved', branchId: 'missing-companion' }, { availableChapter: 0 });
    assert.equal(unavailable.reason, 'chapter-unavailable');
    assert.equal(unavailable.progress.stage, 'week1-discovery');

    const branch = synchronizeSectorEvent(settlement, {
        stage: 'investigating',
        branchId: 'missing-companion',
    }, { availableChapter: 2 });
    assert.equal(branch.progress.stage, 'week2-divergence');

    const convergence = synchronizeSectorEvent(settlement, {
        stage: 'confrontation-ready',
        branchId: 'missing-companion',
    }, { availableChapter: 3 });
    assert.equal(convergence.progress.stage, 'week3-convergence');
});

test('同一远征只能记录一个星域里程碑', () => {
    const settlement = {};
    startSectorEvent(settlement);
    const first = recordSectorEventMilestone(settlement, 'branch-node-1', 'run-a', 1000);
    const duplicate = recordSectorEventMilestone(settlement, 'branch-node-2', 'run-a', 2000);
    assert.equal(first.applied, true);
    assert.equal(duplicate.reason, 'already-recorded');
    assert.deepEqual(duplicate.progress.completedMilestones, { 'branch-node-1': 1000 });
});

test('终局准备只在调查解决后生成且不会被后续换队覆盖', () => {
    const settlement = {};
    startSectorEvent(settlement);
    synchronizeSectorEvent(settlement, { stage: 'investigating', branchId: 'sunken-ruins' }, { availableChapter: 2 });
    assert.equal(prepareSectorEventFinale(settlement, { stage: 'investigating' }, {}).reason, 'investigation-unresolved');

    const prepared = prepareSectorEventFinale(settlement, {
        stage: 'resolved',
        branchId: 'sunken-ruins',
        lastOutcome: { advantage: 'spore-weakness', mutationInsights: 2 },
    }, { supportSpecialtyIds: ['restore', 'channel', 'scout'] }, 3000);
    assert.deepEqual(prepared.progress.finalePreparation, {
        primaryBranchId: 'sunken-ruins',
        investigationAdvantage: 'spore-weakness',
        supportSpecialtyIds: ['restore', 'channel'],
        mutationInsights: 2,
        preparedAt: 3000,
    });
    const repeated = prepareSectorEventFinale(settlement, { stage: 'resolved' }, {
        supportSpecialtyIds: ['scout'],
        mutationInsights: 99,
    }, 4000);
    assert.equal(repeated.reason, 'already-prepared');
    assert.deepEqual(repeated.progress.finalePreparation, prepared.progress.finalePreparation);
});

test('共同终局必须开放到第四章且归档结算幂等', () => {
    const settlement = {};
    startSectorEvent(settlement);
    synchronizeSectorEvent(settlement, { stage: 'investigating', branchId: 'missing-companion' }, { availableChapter: 2 });
    synchronizeSectorEvent(settlement, { stage: 'resolved', branchId: 'missing-companion' }, { availableChapter: 3 });
    prepareSectorEventFinale(settlement, { stage: 'resolved', branchId: 'missing-companion' }, {}, 3000);
    assert.equal(resolveSectorEvent(settlement, { resolved: true }).reason, 'invalid-finale');
    assert.equal(synchronizeSectorEvent(settlement, { stage: 'resolved' }, { availableChapter: 4 }).progress.stage, 'week4-finale');

    const resolved = resolveSectorEvent(settlement, {
        resolved: true,
        ending: '救回失踪伙伴并平息星尘潮汐',
        ecologyChange: '荧光沼泽出现稳定的月潮航线。',
        rescuedCompanionId: 'companion-1',
        keepsake: '星尘潮汐罗盘',
    }, 5000);
    assert.equal(resolved.progress.stage, 'archived');
    assert.equal(resolved.progress.resolution.keepsake, '星尘潮汐罗盘');
    assert.equal(resolveSectorEvent(settlement, { resolved: true }, 6000).reason, 'already-resolved');
});

test('伴随案件只有一次发现和一次冻结选择', () => {
    const settlement = {};
    startSectorEvent(settlement, 1000);
    assert.equal(discoverSectorSideCase(settlement, 1100).reason, 'side-case-locked');
    synchronizeSectorEvent(settlement, { stage: 'investigating', branchId: 'missing-companion' }, { availableChapter: 2 });
    assert.equal(discoverSectorSideCase(settlement, 1200).applied, true);
    assert.equal(chooseSectorSideCase(settlement, 'follow-fragments', 1300).applied, true);
    assert.equal(chooseSectorSideCase(settlement, 'stabilize-current', 1400).reason, 'choice-frozen');
    assert.equal(getSectorEventProgress(settlement).sideCase.choiceId, 'follow-fragments');
});

test('共同终局三层读取冻结的分支、支援专精和异变洞察', () => {
    const settlement = {};
    startSectorEvent(settlement);
    synchronizeSectorEvent(settlement, { stage: 'resolved', branchId: 'missing-companion' }, { availableChapter: 3 });
    discoverSectorSideCase(settlement);
    chooseSectorSideCase(settlement, 'follow-fragments');
    prepareSectorEventFinale(settlement, { stage: 'resolved', branchId: 'missing-companion' }, {
        supportSpecialtyIds: ['scout', 'channel'],
        mutationInsights: 2,
    });
    synchronizeSectorEvent(settlement, { stage: 'resolved' }, { availableChapter: 4 });
    const mission = createSectorEventFinaleMission(settlement, 'run-finale');
    assert.equal(mission.layers[0].id, 'rescue-beacon');
    assert.equal(mission.layers[1].id, 'scout');
    assert.equal(mission.layers[2].id, 'resonant-core');
    assert.equal(mission.hiddenEndingEligible, true);
});