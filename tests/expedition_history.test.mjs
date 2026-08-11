import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpeditionHistoryEntry, recordExpeditionHistory } from '../js/expedition_history.mjs';

const launch = {
    params: {
        runId: 'run-a',
        expedition: { id: 'nebula-1', name: '云海星图' },
        selectedPet: { id: 'pet-1', name: '小哈奇' },
    },
};

test('远征历史记录保留结算摘要且未完成远征不携带奖励状态', () => {
    const entry = buildExpeditionHistoryEntry(launch, {
        completed: false,
        passed: false,
        completedNodes: 9,
        loot: [{ id: 'manaDust', amount: 3 }],
        captures: [{ id: 'captured-1' }],
    }, 1000);

    assert.equal(entry.completed, false);
    assert.equal(entry.petName, '小哈奇');
    assert.equal(entry.lootCount, 3);
    assert.equal(entry.captureCount, 1);
    assert.equal(entry.finishedAt, 1000);
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