import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateExpeditionPlaytests, buildExpeditionHistoryEntry, formatExpeditionHistoryProgress, recordExpeditionHistory } from '../js/expedition_history.js';
import { getHaqiWeeklyProgress } from '../js/haqi_weekly_progress.js';

const launch = {
    params: {
        runId: 'run-a',
        expedition: { id: 'nebula-1', name: '云海星图', biome: '糖晶沙漠' },
        selectedPet: { id: 'pet-1', name: '小哈奇' },
    },
};

test('远征历史记录保留结算摘要且未完成远征不携带奖励状态', () => {
    const entry = buildExpeditionHistoryEntry(launch, {
        completed: false,
        passed: false,
        chapter: 1,
        completedNodes: 9,
        loot: [{ id: 'manaDust', amount: 3 }],
        captures: [{ id: 'captured-1' }],
    }, 1000);

    assert.equal(entry.completed, false);
    assert.equal(entry.petName, '小哈奇');
    assert.equal(entry.expeditionBiome, '糖晶沙漠');
    assert.equal(entry.chapter, 1);
    assert.equal(entry.lootCount, 3);
    assert.equal(entry.captureCount, 1);
    assert.equal(entry.finishedAt, 1000);
});

test('远征历史保存规范化的定向试玩构筑与行为快照', () => {
    const entry = buildExpeditionHistoryEntry({
        params: {
            ...launch.params,
            selectedPet: { id: 'leader-1', name: '领队', speciesSpecialty: { id: 'vanguard' } },
            selectedSupportPets: [
                { id: 'support-1', name: '追踪员', speciesSpecialty: { id: 'scout' } },
                { id: 'support-2', name: '修复员', speciesSpecialty: { id: 'restore' } },
                { id: 'support-3', name: '超额支援', speciesSpecialty: { id: 'channel' } },
            ],
            supportRoutePlan: { id: 'scout-shortcut' },
            investigationMission: { branchId: 'missing-companion', kind: 'rescue-trace' },
        },
    }, {
        completed: false,
        passed: false,
        reason: 'abandoned',
        completedNodes: 6,
        mutationChoice: 'accepted',
        mutationInsights: 1,
        investigationOutcome: {
            branchId: 'missing-companion',
            resolved: true,
            discovery: '找到孢子足迹',
            advantage: 'scout',
        },
    }, 1000);

    assert.deepEqual(entry.playtest, {
        leader: { id: 'leader-1', name: '领队', specialtyId: 'vanguard' },
        supports: [
            { id: 'support-1', name: '追踪员', specialtyId: 'scout' },
            { id: 'support-2', name: '修复员', specialtyId: 'restore' },
        ],
        routePlanId: 'scout-shortcut',
        investigation: {
            branchId: 'missing-companion',
            kind: 'rescue-trace',
            resolved: true,
            discovery: '找到孢子足迹',
            advantage: 'scout',
        },
        mutationChoice: 'accepted',
        mutationInsights: 1,
        completedNodes: 6,
        result: 'abandoned',
    });
});

test('旧结算数据生成可兼容的空试玩快照', () => {
    const entry = buildExpeditionHistoryEntry({}, {}, 1000);

    assert.deepEqual(entry.playtest.supports, []);
    assert.equal(entry.playtest.mutationChoice, 'not-encountered');
    assert.equal(entry.playtest.result, 'incomplete');
});

test('远征历史按章节显示章内进度并兼容旧记录', () => {
    assert.equal(formatExpeditionHistoryProgress({ chapter:1, completedNodes:9 }), '第一章 9/15');
    assert.equal(formatExpeditionHistoryProgress({ chapter:2, completedNodes:14 }), '第二章 14/15');
    assert.equal(formatExpeditionHistoryProgress({ completed:true, chapter:2, completedNodes:14 }), '两章完成');
    assert.equal(formatExpeditionHistoryProgress({ completedNodes:14 }), '推进 14 个节点');
});

test('糖晶沙漠成功结算会计入本周熔岩研究进度', () => {
    const now = new Date(2026, 7, 12, 12).getTime();
    const history = recordExpeditionHistory([], launch, {
        completed: true,
        passed: true,
        bossDefeated: true,
        finishedAt: now,
    }, { now });

    const progress = getHaqiWeeklyProgress({ history, now });

    assert.equal(progress.theme.id, 'molten');
    assert.equal(progress.goals[1].current, 1);
});

test('远征历史按 runId 去重并只保留最近十条', () => {
    const first = recordExpeditionHistory([], launch, { completed: false, passed: false, finishedAt: 100 }, { now: 100 });
    const replaced = recordExpeditionHistory(first, launch, { completed: true, passed: true, finishedAt: 200 }, { now: 200 });

    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].completed, true);
    const capped = Array.from({ length: 13 }, (_, index) => recordExpeditionHistory([], { params: { runId: `run-${index}` } }, {}, { now: index }))
        .reduce((history, next) => [next[0], ...history], []);
    assert.equal(recordExpeditionHistory(capped, { params: { runId: 'latest' } }, {}, { now: 99 }).length, 10);
});

test('远征历史保存宿主最终结算的博物馆材料贡献', () => {
    const entry = buildExpeditionHistoryEntry(launch, {
        completed: true,
        passed: true,
        mineralBonuses: { attackPercent: 5, expeditionLootPercent: 12 },
        lootBonusPercent: 12,
        loot: [{ id: 'manaDust', amount: 3, baseAmount: 2, bonusAmount: 1 }],
    }, 1000);

    assert.deepEqual(entry.mineralContribution, {
        attackPercent: 5,
        lootPercent: 12,
        baseLootCount: 2,
        bonusLootCount: 1,
    });
});

test('同星图同调查分支的新局会关联最近一次未完成局', () => {
    const first = recordExpeditionHistory([], {
        params: { ...launch.params, investigationMission: { branchId: 'missing-companion' } },
    }, { completed: false, reason: 'abandoned' }, { now: 100 });
    const restarted = recordExpeditionHistory(first, {
        params: { ...launch.params, runId: 'run-b', investigationMission: { branchId: 'missing-companion' } },
    }, { completed: true, passed: true }, { now: 200 });

    assert.equal(restarted[0].restartOfRunId, 'run-a');
});

test('试玩聚合只统计真实历史并区分异变遇见次数', () => {
    const history = [
        buildExpeditionHistoryEntry(launch, { completed: true, passed: true, mutationChoice: 'accepted' }, 100),
        buildExpeditionHistoryEntry({ params: { ...launch.params, runId: 'run-b', supportRoutePlan: { id: 'safe-extraction' } } }, {
            completed: false,
            completedNodes: 8,
            mutationChoice: 'declined',
            restartOfRunId: 'run-a',
        }, 200),
        buildExpeditionHistoryEntry({ params: { ...launch.params, runId: 'run-c' } }, { completed: false, completedNodes: 4 }, 300),
    ];
    const stats = aggregateExpeditionPlaytests(history);

    assert.equal(stats.sampleSize, 3);
    assert.equal(stats.completed, 1);
    assert.equal(stats.completionRate, 1 / 3);
    assert.equal(stats.mutationEncounterCount, 2);
    assert.equal(stats.mutationAcceptanceRate, 0.5);
    assert.equal(stats.extractionNodeCounts['8'], 1);
    assert.equal(stats.restartCount, 1);
});