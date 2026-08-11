import assert from 'node:assert/strict';
import test from 'node:test';
import { settleMineralRoutePreparation } from '../js/mineral_host_core.js';
import { COOPERATION_REWARD_CAPS, COOPERATION_STAGES, applyCooperationSignalEvent, canContinueCooperation, cooperationDailyDrill, cooperationDailyDrillArchive, cooperationDailyDrillArchiveOverview, cooperationDailyDrillArchiveSummary, cooperationDailyDrillGuidance, cooperationDailyDrillNextFocus, cooperationDailyDrillPreparation, cooperationDailyDrillResult, cooperationDailyDrillSignalRecommendation, cooperationDailyDrillSignalReview, cooperationDailyDrillSignalStrategyReview, cooperationReward, cooperationStability, cooperationTacticalAssessment, eliteCoreResult } from '../js/mineral_cooperation_core.js';

const cost = { manaDust: 2, attackCore: 1 };

function createState() {
    return {
        bridge: { preparationCharges: 0, consumedRequestIds: [] },
        inventory: { expedition_material_manaDust: 2, expedition_material_attackCore: 1 },
    };
}

test('路线芯片扣除宿主材料并只增加一次携带次数', () => {
    const { bridge, inventory } = createState();
    const result = settleMineralRoutePreparation({ requestId: 'route-1', bridge, inventory, cost });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.inventory.expedition_material_manaDust, 0);
    assert.equal(result.inventory.expedition_material_attackCore, 0);
    assert.equal(result.bridge.preparationCharges, 1);
    assert.deepEqual(result.bridge.consumedRequestIds, ['route-1']);
});

test('重复路线芯片请求不会再次扣除材料', () => {
    const first = settleMineralRoutePreparation({ requestId: 'route-1', ...createState(), cost });
    const retry = settleMineralRoutePreparation({ requestId: 'route-1', bridge: first.bridge, inventory: first.inventory, cost });

    assert.equal(retry.ok, true);
    assert.equal(retry.changed, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.inventory.expedition_material_manaDust, 0);
    assert.equal(retry.bridge.preparationCharges, 1);
});

test('材料不足、请求无效与携带上限均不改变宿主资产', () => {
    const insufficient = settleMineralRoutePreparation({ requestId: 'route-1', bridge: { preparationCharges: 0, consumedRequestIds: [] }, inventory: { expedition_material_manaDust: 1, expedition_material_attackCore: 1 }, cost });
    const invalid = settleMineralRoutePreparation({ requestId: 'bad request', ...createState(), cost });
    const capped = settleMineralRoutePreparation({ requestId: 'route-2', bridge: { preparationCharges: 3, consumedRequestIds: [] }, inventory: createState().inventory, cost });

    assert.equal(insufficient.ok, false);
    assert.equal(insufficient.changed, false);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.changed, false);
    assert.equal(capped.ok, false);
    assert.equal(capped.changed, false);
});

test('协同探矿分为三个阶段，并在失稳或末阶段停止继续下潜', () => {
    assert.equal(COOPERATION_STAGES.length, 3);
    assert.equal(canContinueCooperation({ stageIndex: 0, stability: 1 }), true);
    assert.equal(canContinueCooperation({ stageIndex: 1, stability: 0 }), false);
    assert.equal(canContinueCooperation({ stageIndex: 2, stability: 100 }), false);
    assert.equal(cooperationStability({ stageIndex: 0, elapsedSeconds: 0, misses: 0 }), 100);
    assert.equal(cooperationStability({ stageIndex: 2, elapsedSeconds: 45, misses: 8 }), 0);
    assert.equal(cooperationStability({ stageIndex: 1, elapsedSeconds: 0, misses: 11 }), 0);
});

test('延长协同探矿时长不会突破既有原石与线索上限', () => {
    const reward = cooperationReward({ hits: 999, bestCombo: 999 });

    assert.deepEqual(reward, COOPERATION_REWARD_CAPS);
});

test('矿层信号只改变本局操作条件，不直接增加矿区资源', () => {
    const stabilized = applyCooperationSignalEvent({ combo: 1, bestCombo: 1, stabilityReserve: 18, missGuard: 0 }, 'stabilize');
    const resonant = applyCooperationSignalEvent({ combo: 1, bestCombo: 1, stabilityReserve: 0, missGuard: 0 }, 'resonance');
    const guarded = applyCooperationSignalEvent({ combo: 1, bestCombo: 1, stabilityReserve: 0, missGuard: 0 }, 'deflection');

    assert.equal(stabilized.stabilityReserve, 24);
    assert.equal(cooperationStability({ stageIndex: 1, elapsedSeconds: 0, misses: 0, stabilityReserve: stabilized.stabilityReserve }), 100);
    assert.equal(resonant.combo, 1);
    assert.equal(resonant.preserveCombo, true);
    assert.equal(guarded.missGuard, 1);
    assert.deepEqual(cooperationReward({ hits: 999, bestCombo: 999 }), COOPERATION_REWARD_CAPS);
});

test('精英矿核冲刺只解锁情报，不提供可刷取的资源', () => {
    assert.deepEqual(eliteCoreResult({ hits: 4 }), { completed:false, hitsRequired:5, unlocksInsight:false, bonusStones:0, research:0 });
    assert.deepEqual(eliteCoreResult({ hits: 5 }), { completed:true, hitsRequired:5, unlocksInsight:true, bonusStones:0, research:0 });
});

test('协同探矿行动评级只记录表现，不追加任何资源', () => {
    assert.deepEqual(cooperationTacticalAssessment({ hits: 12, misses:1, eliteCompleted:true }), { id:'apex', name:'深层尖兵', score:29, bonusStones:0, research:0 });
    assert.deepEqual(cooperationTacticalAssessment({ hits: 4, misses:1 }), { id:'field', name:'矿层观察', score:5, bonusStones:0, research:0 });
    assert.equal(cooperationTacticalAssessment({ hits:999, misses:0, eliteCompleted:true }).bonusStones, 0);
    assert.equal(cooperationTacticalAssessment({ hits:999, misses:0, eliteCompleted:true }).research, 0);
});

test('每日协同演练只归档操作目标，不追加任何资源', () => {
    const daysByDrill = Object.fromEntries(['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map(day => [cooperationDailyDrill(day).id, day]));
    const steady = cooperationDailyDrillResult({ day:daysByDrill['steady-hands'], hits:5, bestCombo:1, misses:2 });
    const combo = cooperationDailyDrillResult({ day:daysByDrill['combo-survey'], hits:1, bestCombo:3, misses:9 });
    const elite = cooperationDailyDrillResult({ day:daysByDrill['elite-observation'], hits:1, bestCombo:1, misses:9, eliteCompleted:true });

    assert.equal(steady.completed, true);
    assert.equal(combo.completed, true);
    assert.equal(elite.completed, true);
    assert.equal(cooperationDailyDrillResult({ day:daysByDrill['steady-hands'], hits:4, misses:2 }).completed, false);
    assert.equal(steady.bonusStones, 0);
    assert.equal(combo.research, 0);
    assert.equal(elite.bonusStones, 0);
});

test('每日协同演练提示只解释操作缺口，不追加任何资源', () => {
    const daysByDrill = Object.fromEntries(['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map(day => [cooperationDailyDrill(day).id, day]));
    const steady = cooperationDailyDrillGuidance({ day:daysByDrill['steady-hands'], hits:3, misses:1 });
    const combo = cooperationDailyDrillGuidance({ day:daysByDrill['combo-survey'], bestCombo:1 });
    const elite = cooperationDailyDrillGuidance({ day:daysByDrill['elite-observation'], eliteCompleted:false });
    const complete = cooperationDailyDrillGuidance({ day:daysByDrill['combo-survey'], bestCombo:3 });

    assert.match(steady.progress, /2 次命中/);
    assert.match(combo.progress, /x2/);
    assert.match(elite.progress, /精英矿核冲刺/);
    assert.match(complete.progress, /已完成/);
    [steady, combo, elite, complete].forEach(guidance => {
        assert.equal(guidance.bonusStones, 0);
        assert.equal(guidance.research, 0);
    });
});

test('每日协同演练操作倾向只提供开局方向，不追加资源', () => {
    const daysByDrill = Object.fromEntries(['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map(day => [cooperationDailyDrill(day).id, day]));
    const steady = cooperationDailyDrillPreparation(daysByDrill['steady-hands']);
    const combo = cooperationDailyDrillPreparation(daysByDrill['combo-survey']);
    const elite = cooperationDailyDrillPreparation(daysByDrill['elite-observation']);

    assert.match(steady.preparation, /守住稳定度/);
    assert.match(combo.preparation, /维持连击窗口/);
    assert.match(elite.preparation, /完成三段/);
    [steady, combo, elite].forEach(preparation => {
        assert.equal(preparation.bonusStones, 0);
        assert.equal(preparation.research, 0);
    });
});

test('每日协同演练下次重点只提供操作方向，不追加资源', () => {
    const daysByDrill = Object.fromEntries(['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map(day => [cooperationDailyDrill(day).id, day]));
    const steady = cooperationDailyDrillNextFocus({ day:daysByDrill['steady-hands'], hits:2, misses:3 });
    const combo = cooperationDailyDrillNextFocus({ day:daysByDrill['combo-survey'], bestCombo:1 });
    const elite = cooperationDailyDrillNextFocus({ day:daysByDrill['elite-observation'] });
    const complete = cooperationDailyDrillNextFocus({ day:daysByDrill['combo-survey'], bestCombo:3 });

    assert.match(steady.focus, /减少失误/);
    assert.match(combo.focus, /保护连击窗口/);
    assert.match(elite.focus, /完成第三段/);
    assert.match(complete.focus, /演练已完成/);
    [steady, combo, elite, complete].forEach(focus => {
        assert.equal(focus.bonusStones, 0);
        assert.equal(focus.research, 0);
    });
});

test('每日协同演练信号策略复盘只说明方向，不追加资源', () => {
    const daysByDrill = Object.fromEntries(['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map(day => [cooperationDailyDrill(day).id, day]));
    const steady = cooperationDailyDrillSignalStrategyReview({
        day:daysByDrill['steady-hands'],
        selections:[{ selectedSignalId:'stabilize' }]
    });
    const combo = cooperationDailyDrillSignalStrategyReview({
        day:daysByDrill['combo-survey'],
        selections:[{ selectedSignalId:'deflection' }]
    });
    const noSignals = cooperationDailyDrillSignalStrategyReview({ day:daysByDrill['elite-observation'] });
    const complete = cooperationDailyDrillSignalStrategyReview({
        day:daysByDrill['combo-survey'],
        bestCombo:3,
        selections:[{ selectedSignalId:'resonance' }]
    });

    assert.equal(steady.aligned, true);
    assert.match(steady.summary, /符合稳手回收/);
    assert.equal(combo.aligned, false);
    assert.match(combo.summary, /共鸣校准/);
    assert.match(noSignals.summary, /未经过矿层岔口/);
    assert.equal(complete.aligned, true);
    assert.match(complete.summary, /目标已完成/);
    [steady, combo, noSignals, complete].forEach(review => {
        assert.equal(review.bonusStones, 0);
        assert.equal(review.research, 0);
    });
});

test('每日协同演练信号推荐只标注建议，不改变信号或资源', () => {
    const daysByDrill = Object.fromEntries(['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map(day => [cooperationDailyDrill(day).id, day]));
    const steady = cooperationDailyDrillSignalRecommendation({ day:daysByDrill['steady-hands'], signalIds:['stabilize', 'resonance'] });
    const combo = cooperationDailyDrillSignalRecommendation({ day:daysByDrill['combo-survey'], signalIds:['deflection', 'resonance'] });
    const elite = cooperationDailyDrillSignalRecommendation({ day:daysByDrill['elite-observation'], signalIds:['deflection', 'resonance'] });
    const complete = cooperationDailyDrillSignalRecommendation({ day:daysByDrill['combo-survey'], bestCombo:3, signalIds:['resonance'] });

    assert.equal(steady.signalId, 'stabilize');
    assert.equal(combo.signalId, 'resonance');
    assert.equal(elite.signalId, 'deflection');
    assert.equal(complete.signalId, '');
    [steady, combo, elite, complete].forEach(recommendation => {
        assert.equal(recommendation.bonusStones, 0);
        assert.equal(recommendation.research, 0);
    });
});

test('每日协同演练信号复盘只统计采纳次数，不追加资源', () => {
    const review = cooperationDailyDrillSignalReview([
        { stageIndex:0, recommendedSignalId:'stabilize', selectedSignalId:'stabilize' },
        { stageIndex:1, recommendedSignalId:'deflection', selectedSignalId:'resonance' },
        { stageIndex:1, recommendedSignalId:'resonance', selectedSignalId:'not-a-signal' },
    ]);
    const emptyReview = cooperationDailyDrillSignalReview();

    assert.equal(review.recommended, 2);
    assert.equal(review.followed, 1);
    assert.match(review.summary, /1\/2/);
    assert.deepEqual(review.trace, ['勘测阶段：锚定力场（采纳建议）', '采掘阶段：共鸣校准（自主调整）']);
    assert.equal(emptyReview.recommended, 0);
    assert.equal(review.bonusStones, 0);
    assert.equal(review.research, 0);
});

test('每日协同演练档案摘要只读取已归档目标，不追加资源', () => {
    const day = '2026-08-07';
    const summary = cooperationDailyDrillArchiveSummary({
        day,
        drillId:cooperationDailyDrill(day).id,
        completedAt:123
    });
    const invalid = cooperationDailyDrillArchiveSummary({
        day,
        drillId:'not-a-drill',
        completedAt:123
    });

    assert.equal(summary.archived, true);
    assert.equal(summary.name, cooperationDailyDrill(day).name);
    assert.equal(summary.description, cooperationDailyDrill(day).description);
    assert.equal(invalid.archived, false);
    assert.equal(invalid.description, '');
    [summary, invalid].forEach(record => {
        assert.equal(record.bonusStones, 0);
        assert.equal(record.research, 0);
    });
});

test('每日协同演练档案概览只统计近期有效记录，不追加资源', () => {
    const records = ['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10'].map((day, index) => ({
        day,
        drillId:cooperationDailyDrill(day).id,
        completedAt:index + 1
    }));
    const overview = cooperationDailyDrillArchiveOverview(records, 3);
    const empty = cooperationDailyDrillArchiveOverview([{ day:'2026-08-07', drillId:'not-a-drill', completedAt:1 }]);

    assert.equal(overview.count, 3);
    assert.deepEqual(overview.coveredNames, [...new Set(overview.records.map(record => record.name))]);
    assert.match(overview.summary, /最近练习 3 次/);
    assert.match(empty.summary, /尚未完成/);
    [overview, empty].forEach(summary => {
        assert.equal(summary.bonusStones, 0);
        assert.equal(summary.research, 0);
    });
});

test('每日协同演练归档只保留最近七条有效完成记录', () => {
    const records = Array.from({ length:8 }, (_, index) => {
        const day = `2026-08-${String(index + 1).padStart(2, '0')}`;
        return { day, drillId:cooperationDailyDrill(day).id, completed:true, completedAt:index + 1 };
    });
    const archived = records.reduce((history, record) => cooperationDailyDrillArchive(history, record), []);
    const invalid = cooperationDailyDrillArchive(archived, { day:'2026-08-12', drillId:'not-a-drill', completed:true, completedAt:99 });

    assert.equal(archived.length, 7);
    assert.equal(archived[0].day, '2026-08-08');
    assert.equal(archived.at(-1).day, '2026-08-02');
    assert.deepEqual(invalid, archived);
});