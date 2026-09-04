import assert from 'node:assert/strict';
import test from 'node:test';
import {
    chooseExpeditionInvestigationBranch,
    createExpeditionConfrontationMission,
    createExpeditionInvestigationMission,
    getExpeditionInvestigationProgress,
    recordExpeditionConfrontationOutcome,
    recordExpeditionInvestigationOutcome,
} from '../js/expedition_investigation_core.js';

function launch(runId = 'run-1', biome = '荧光沼泽') {
    return { params: { runId, expedition: { id: 'expedition-1', biome } } };
}

function investigationLaunch(settlement, runId) {
    const base = launch(runId);
    base.params.investigationMission = createExpeditionInvestigationMission(settlement, base.params.expedition, runId);
    return base;
}

function investigationOutcome(branchId) {
    return {
        investigationId: 'glowshroom-spore-anomaly',
        branchId,
        resolved: true,
        discovery: '发现新的异变线索。',
        routeHint: '下一次沿孢子逆流前进。',
        advantage: branchId === 'missing-companion' ? 'companion-support' : 'spore-weakness',
    };
}

test('只有荧光沼泽的有效远征会发现孢子调查', () => {
    const settlement = {};
    const unrelated = recordExpeditionInvestigationOutcome(settlement, launch('other', '糖晶沙漠'), {
        completed: true,
        passed: true,
        completedNodes: 30,
    });
    assert.equal(unrelated.applied, false);
    assert.equal(getExpeditionInvestigationProgress(settlement).stage, 'undiscovered');

    const discovered = recordExpeditionInvestigationOutcome(settlement, launch(), {
        completed: true,
        passed: true,
        completedNodes: 30,
    }, 1000);
    assert.equal(discovered.applied, true);
    assert.equal(discovered.progress.evidence, 1);
    assert.equal(discovered.progress.stage, 'choose-branch');
});

test('失败或撤离至少推进八个节点才会留下调查情报', () => {
    const shallowSettlement = {};
    const shallow = recordExpeditionInvestigationOutcome(shallowSettlement, launch('shallow'), {
        completed: false,
        passed: false,
        completedNodes: 7,
    });
    assert.equal(shallow.applied, false);
    assert.equal(shallow.reason, 'insufficient-progress');

    const deepSettlement = {};
    const deep = recordExpeditionInvestigationOutcome(deepSettlement, launch('deep'), {
        completed: false,
        passed: false,
        completedNodes: 8,
    });
    assert.equal(deep.applied, true);
    assert.equal(deep.progress.evidence, 1);
});

test('前线撤离协议允许推进五个节点后保留调查情报', () => {
    const shallowLaunch = launch('survival-shallow');
    shallowLaunch.params.supportRoutePlan = { id: 'survival-extraction' };
    const shallow = recordExpeditionInvestigationOutcome({}, shallowLaunch, {
        completed: false,
        passed: false,
        completedNodes: 4,
    });
    assert.equal(shallow.reason, 'insufficient-progress');

    const deepLaunch = launch('survival-deep');
    deepLaunch.params.supportRoutePlan = { id: 'survival-extraction' };
    const deep = recordExpeditionInvestigationOutcome({}, deepLaunch, {
        completed: false,
        passed: false,
        completedNodes: 5,
    });
    assert.equal(deep.applied, true);
    assert.equal(deep.progress.evidence, 1);
});

test('调查要求选择分支且同一远征不能重复推进', () => {
    const settlement = {};
    const first = recordExpeditionInvestigationOutcome(settlement, launch('run-a'), {
        completed: true,
        passed: true,
        completedNodes: 30,
    });
    assert.equal(first.applied, true);
    const duplicate = recordExpeditionInvestigationOutcome(settlement, launch('run-a'), {
        completed: true,
        passed: true,
        completedNodes: 30,
    });
    assert.equal(duplicate.reason, 'already-recorded');
    const blocked = recordExpeditionInvestigationOutcome(settlement, launch('run-b'), {
        completed: true,
        passed: true,
        completedNodes: 30,
    });
    assert.equal(blocked.reason, 'branch-required');

    const chosen = chooseExpeditionInvestigationBranch(settlement, 'missing-companion');
    assert.equal(chosen.applied, true);
    assert.equal(chosen.progress.branch.label, '追踪失踪伙伴');
    assert.equal(chooseExpeditionInvestigationBranch(settlement, 'sunken-ruins').reason, 'branch-unavailable');
});

test('每次有效远征最多增加一条证据并在四条时解锁终局', () => {
    const settlement = {};
    recordExpeditionInvestigationOutcome(settlement, launch('run-1'), { completed: true, passed: true, completedNodes: 30 });
    chooseExpeditionInvestigationBranch(settlement, 'sunken-ruins');
    for (let index = 2; index <= 4; index += 1) {
        recordExpeditionInvestigationOutcome(settlement, investigationLaunch(settlement, `run-${index}`), {
            completed: false,
            passed: false,
            completedNodes: 12,
            investigationOutcome: investigationOutcome('sunken-ruins'),
        });
    }
    const progress = getExpeditionInvestigationProgress(settlement);
    assert.equal(progress.evidence, 4);
    assert.equal(progress.stage, 'confrontation-ready');
    const capped = recordExpeditionInvestigationOutcome(settlement, launch('run-5'), { completed: true, passed: true, completedNodes: 30 });
    assert.equal(capped.applied, false);
    assert.equal(capped.reason, 'confrontation-ready');
});

test('选定分支后必须完成对应局内节点才会增加证据', () => {
    const settlement = {};
    recordExpeditionInvestigationOutcome(settlement, launch('discover'), { completed: true, passed: true, completedNodes: 30 });
    chooseExpeditionInvestigationBranch(settlement, 'missing-companion');
    const missionLaunch = investigationLaunch(settlement, 'mission');

    const skipped = recordExpeditionInvestigationOutcome(settlement, missionLaunch, { completed: true, passed: true, completedNodes: 30 });
    assert.equal(skipped.reason, 'investigation-node-incomplete');
    const resolved = recordExpeditionInvestigationOutcome(settlement, missionLaunch, {
        completed: true,
        passed: true,
        completedNodes: 30,
        investigationOutcome: investigationOutcome('missing-companion'),
    });
    assert.equal(resolved.applied, true);
    assert.equal(resolved.progress.lastOutcome.advantage, 'companion-support');
});

test('已选分支只为荧光沼泽生成一个稳定的第六至十层调查任务', () => {
    const settlement = {};
    recordExpeditionInvestigationOutcome(settlement, launch('discover'), { completed: true, passed: true, completedNodes: 30 });
    assert.equal(createExpeditionInvestigationMission(settlement, { biome: '荧光沼泽' }, 'before-branch'), null);
    chooseExpeditionInvestigationBranch(settlement, 'missing-companion');

    const mission = createExpeditionInvestigationMission(settlement, { biome: '荧光沼泽' }, 'mission-run');
    assert.equal(mission.branchId, 'missing-companion');
    assert.equal(mission.kind, 'rescue-trace');
    assert.ok(mission.tier >= 6 && mission.tier <= 10);
    assert.deepEqual(createExpeditionInvestigationMission(settlement, { biome: '荧光沼泽' }, 'mission-run'), mission);
    assert.equal(createExpeditionInvestigationMission(settlement, { biome: '糖晶沙漠' }, 'mission-run'), null);
});

test('支援伙伴专精只为匹配的调查分支提供路线优势', () => {
    const scout = { id: 'scout', name: '寻迹感知', investigationRole: '线索识别', investigationBenefit: '标出安全路线' };
    const restore = { id: 'restore', name: '星辉修复', investigationRole: '遗迹修复', investigationBenefit: '稳定观测终端' };
    const rescueSettlement = {};
    recordExpeditionInvestigationOutcome(rescueSettlement, launch('rescue-discover'), { completed: true, passed: true, completedNodes: 30 });
    chooseExpeditionInvestigationBranch(rescueSettlement, 'missing-companion');
    const rescueMission = createExpeditionInvestigationMission(rescueSettlement, { biome: '荧光沼泽' }, 'rescue-support', [restore, scout]);
    assert.deepEqual(rescueMission.supportAdvantage, {
        id: 'scout',
        name: '寻迹感知',
        role: '线索识别',
        benefit: '标出安全路线',
    });

    const ruinsSettlement = {};
    recordExpeditionInvestigationOutcome(ruinsSettlement, launch('ruins-discover'), { completed: true, passed: true, completedNodes: 30 });
    chooseExpeditionInvestigationBranch(ruinsSettlement, 'sunken-ruins');
    const ruinsMission = createExpeditionInvestigationMission(ruinsSettlement, { biome: '荧光沼泽' }, 'ruins-support', [scout]);
    assert.equal(ruinsMission.supportAdvantage, null);
    assert.equal(createExpeditionInvestigationMission(ruinsSettlement, { biome: '荧光沼泽' }, 'restore-support', [restore]).supportAdvantage.id, 'restore');
});

test('四条证据解锁一次性异变源头并在结算后封存调查', () => {
    const settlement = {};
    recordExpeditionInvestigationOutcome(settlement, launch('run-1'), { completed: true, passed: true, completedNodes: 30 });
    chooseExpeditionInvestigationBranch(settlement, 'sunken-ruins');
    for (let index = 2; index <= 4; index += 1) {
        recordExpeditionInvestigationOutcome(settlement, investigationLaunch(settlement, `run-${index}`), {
            completed: true,
            passed: true,
            completedNodes: 30,
            investigationOutcome: investigationOutcome('sunken-ruins'),
        });
    }
    const mission = createExpeditionConfrontationMission(settlement, 'source-run', { id: 'scout', name: '寻迹感知', investigationRole: '线索识别' });
    assert.equal(mission.kind, 'spore-source');
    assert.equal(mission.tier, 3);
    const confrontationLaunch = { params: { runId: 'source-run', confrontationMission: mission } };
    const resolved = recordExpeditionConfrontationOutcome(settlement, confrontationLaunch, {
        runId: 'source-run',
        confrontationOutcome: {
            investigationId: 'glowshroom-spore-anomaly',
            branchId: 'sunken-ruins',
            resolved: true,
            ending: '切断孢子增殖回路',
            ecologyChange: '荧光沼泽恢复稳定潮汐。',
            keepsake: '沉没观测站核心片',
        },
    });
    assert.equal(resolved.applied, true);
    assert.equal(resolved.progress.stage, 'resolved');
    assert.equal(resolved.progress.resolution.ecologyChange, '荧光沼泽恢复稳定潮汐。');
    assert.equal(resolved.progress.resolution.keepsake, '沉没观测站核心片');
    assert.equal(createExpeditionConfrontationMission(settlement, 'again'), null);
    assert.equal(recordExpeditionConfrontationOutcome(settlement, confrontationLaunch, {}).reason, 'already-resolved');
});