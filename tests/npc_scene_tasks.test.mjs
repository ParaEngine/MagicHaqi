import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeFieldNpc } from '../js/config.js';
import { isSceneTaskCompleted, isSceneTaskStepAvailable, npcProgressId, reconcileSceneTaskCompletion, sceneTaskProgressFeedback, shouldShowSceneTaskSteps, withPrimarySceneInteraction } from '../js/npc_scene_tasks.js';

const indexUrl = new URL('../famous-planets/_planet_index.json', import.meta.url);
const planetIndex = JSON.parse(await readFile(indexUrl, 'utf8'));
const levelFieldSource = await readFile(new URL('../js/level_field.js', import.meta.url), 'utf8');
const npcDialogSource = await readFile(new URL('../js/npc_dialog.js', import.meta.url), 'utf8');
const configuredNpcs = planetIndex.planets.flatMap(planet => (planet.fields || []).flatMap((field, fieldIndex) =>
    (field.npcs || []).map((npc, npcIndex) => ({ planet, field, fieldIndex, npc, npcIndex }))));

test('全部正式 NPC 都有可直接进入场景的主互动', () => {
    assert.equal(configuredNpcs.length, 23);

    configuredNpcs.forEach(({ planet, fieldIndex, npc, npcIndex }) => {
        const enhancedNpc = withPrimarySceneInteraction(npc, {
            npcIndex,
            planetId: planet.id,
            fieldId: String(fieldIndex + 1),
        });
        const primaryTask = enhancedNpc.interactions.find(interaction => interaction.play?.type === 'sceneCollect');

        assert.ok(primaryTask, `${planet.id}/${fieldIndex + 1}/${npc.name} 缺少场景主互动`);
        assert.ok(primaryTask.play.steps.length >= 3, `${npc.name} 的场景目标不足 3 个`);
        primaryTask.play.steps.forEach(step => {
            assert.ok(step.x >= 5 && step.x <= 95);
            assert.ok(step.y >= 12 && step.y <= 88);
            assert.ok(step.label && step.feedback);
        });
    });
});

test('重复 NPC id 在不同星球和场景使用独立进度键', () => {
    assert.notEqual(npcProgressId('haqi', '2', 'npc_1'), npcProgressId('haqi', '3', 'npc_1'));
    assert.notEqual(npcProgressId('haqi', '2', 'npc_1'), npcProgressId('chongqing_zoo', '2', 'npc_1'));
});

test('普通场景任务按实际点击数提示且不依赖步骤顺序', () => {
    const interaction = { play: { steps: [{}, {}, {}] } };
    const thirdStep = { label: '检查长椅', feedback: '最后一处也已处理' };

    assert.equal(sceneTaskProgressFeedback(interaction, thirdStep, 1), '已处理检查长椅，还剩 2 处');
    assert.equal(sceneTaskProgressFeedback(interaction, thirdStep, 3), '已处理检查长椅，所有目标均已完成');
});

test('携物任务保留拿取和交付的步骤提示', () => {
    const interaction = { play: { interactionMode: 'carry', steps: [{}, {}, {}] } };
    const step = { label: '交付果篮', feedback: '果篮已经送到仓库门口。' };

    assert.equal(sceneTaskProgressFeedback(interaction, step, 2), step.feedback);
});

test('宠物协作任务按顺序开放宠物和场景目标', () => {
    const interaction = { play: { interactionMode: 'petAssist', steps: [{ id: 'pet' }, { id: 'scent' }, { id: 'confirm' }] } };

    assert.equal(isSceneTaskStepAvailable(interaction, [], 'pet'), true);
    assert.equal(isSceneTaskStepAvailable(interaction, [], 'scent'), false);
    assert.equal(isSceneTaskStepAvailable(interaction, ['pet'], 'scent'), true);
    assert.equal(isSceneTaskStepAvailable(interaction, ['pet', 'scent'], 'confirm'), true);
    assert.equal(sceneTaskProgressFeedback(interaction, { label: '请宠物闻样本', feedback: '宠物记住了气味。' }, 1), '宠物记住了气味。');
});

test('场景步骤只在任务进行中显示', () => {
    const interaction = {
        id: 'mayor_square_safety_patrol',
        play: { steps: [{ id: 'sign' }, { id: 'light' }, { id: 'bench' }] },
    };

    assert.equal(shouldShowSceneTaskSteps({}, interaction), false);
    assert.equal(shouldShowSceneTaskSteps({ activeSceneInteractionId: interaction.id }, interaction), true);
    assert.equal(shouldShowSceneTaskSteps({
        activeSceneInteractionId: interaction.id,
        completedInteractionIds: [interaction.id],
    }, interaction), false);
});

test('接取场景任务后先刷新字段再查询新生成的目标节点', () => {
    const activationStart = levelFieldSource.indexOf('relationship.activeSceneInteractionId = interactionId;');
    const refreshIndex = levelFieldSource.indexOf('notify();', activationStart);
    const targetQueryIndex = levelFieldSource.indexOf('$$(`.field-scene-target[data-scene-npc=', activationStart);

    assert.ok(activationStart >= 0);
    assert.ok(refreshIndex > activationStart);
    assert.ok(targetQueryIndex > refreshIndex);
});

test('宠物协作步骤由当前宠物点击推进并结算日常委托', () => {
    assert.match(levelFieldSource, /step\.role === 'pet'/);
    assert.match(levelFieldSource, /activePetAssistTask\(fld\.id\)/);
    assert.match(levelFieldSource, /completeSceneStep\(assistTarget\)/);
    assert.match(levelFieldSource, /completeNpcCommission\(state\.settings, task\.npc, \{ relationshipId: npcProgressId\(task\.npc\.id, fld\.id\) \}\)/);
});

test('字段建造托盘使用物品名称翻译时已导入 itemName', () => {
    assert.match(levelFieldSource, /import \{[^}]*\bitemName\b[^}]*\} from '\.\/i18n\.js';/);
    assert.match(levelFieldSource, /itemName\(it\.name\)/);
});

test('步骤已全部收集的半完成存档不可重新接取任务', () => {
    const interaction = {
        id: 'mayor_square_safety_patrol',
        play: { steps: [{ id: 'sign' }, { id: 'light' }, { id: 'bench' }] },
    };
    const relationship = {
        activeSceneInteractionId: interaction.id,
        sceneCollected: { [interaction.id]: ['bench', 'sign', 'light'] },
    };

    assert.equal(isSceneTaskCompleted(relationship, interaction), true);
    assert.equal(shouldShowSceneTaskSteps(relationship, interaction), false);
});

test('半完成存档会补齐正式完成状态和剧情解锁标记', () => {
    const interaction = {
        id: 'mayor_square_safety_patrol',
        play: { steps: [{ id: 'sign' }, { id: 'light' }, { id: 'bench' }] },
    };
    const relationship = {
        activeSceneInteractionId: interaction.id,
        sceneCollected: { [interaction.id]: ['sign', 'light', 'bench'] },
    };
    const storyFlags = {};

    assert.equal(reconcileSceneTaskCompletion(relationship, interaction, storyFlags, 1234), true);
    assert.deepEqual(relationship.completedInteractionIds, [interaction.id]);
    assert.equal(relationship.activeSceneInteractionId, '');
    assert.equal(storyFlags[interaction.id], 1234);
    assert.equal(reconcileSceneTaskCompletion(relationship, interaction, storyFlags, 5678), false);
    assert.equal(storyFlags[interaction.id], 1234);
});

test('已有专属场景任务保持为主互动且不重复生成', () => {
    const doctor = configuredNpcs.find(({ npc }) => npc.id === 'doctor_dokter')?.npc;
    const enhancedDoctor = withPrimarySceneInteraction(doctor, { planetId: 'haqi', fieldId: '3', npcIndex: 1 });
    const sceneTasks = enhancedDoctor.interactions.filter(interaction => interaction.play?.type === 'sceneCollect');

    assert.equal(sceneTasks.length, 1);
    assert.equal(sceneTasks[0].id, 'forest_ecology_investigation');
    assert.equal(sceneTasks[0].play.interactionMode, 'petAssist');
    assert.deepEqual(sceneTasks[0].play.steps.map(step => step.role), ['pet', 'target', 'confirm']);
    assert.equal(sceneTasks[0].play.collaboration.moveNpc, true);
    assert.deepEqual(sceneTasks[0].relationshipReward, { affection: 8, stageItemId: 'gift_bamboo_leaf', stageItemCount: 1 });
});

test('跨场景锁定入口直接展示地点、NPC 和任务类型', () => {
    const academyMentor = normalizeFieldNpc(configuredNpcs.find(({ field, npc }) => field.name === '魔法学院' && npc.name === '青龙导师')?.npc);
    const lanternTask = academyMentor.interactions.find(interaction => interaction.id === 'weave_forest_lantern');

    assert.equal(lanternTask.unlockHint, '魔法密林 → 多克特博士 → 宠物生态调查');
    assert.match(lanternTask.lockedText, /今日小游戏.*不会解锁森林星灯/);
    assert.match(npcDialogSource, /interaction\.unlockHint \|\| '点击查看解锁条件'/);
    assert.match(npcDialogSource, /npc-dialog-locked-interaction/);
});

test('广场巡查和庆典排练使用带角色走位与物体状态的专属协作任务', () => {
    const mayor = normalizeFieldNpc(configuredNpcs.find(({ npc }) => npc.id === 'mayor_rhodes')?.npc);
    const dancer = normalizeFieldNpc(configuredNpcs.find(({ npc }) => npc.name === '丹瑟')?.npc);
    const mayorTask = mayor.interactions.find(interaction => interaction.id === 'mayor_square_safety_patrol');
    const rehearsalTask = dancer.interactions.find(interaction => interaction.id === 'stage_rehearsal_collaboration');
    const performanceTask = dancer.interactions.find(interaction => interaction.id === 'festival_stage_performance');

    [mayorTask, rehearsalTask, performanceTask].forEach(task => {
        assert.equal(task.play.type, 'sceneCollect');
        assert.equal(task.play.collaboration.moveNpc, true);
        assert.ok(task.play.steps.every(step => step.resolvedIcon && step.resolvedLabel));
    });
    assert.deepEqual(performanceTask.requires, ['weave_forest_lantern', 'learn_rhythm']);
});

test('跳跳农场使用拿取、携带和交付组成的专属携物任务', () => {
    const farmer = normalizeFieldNpc(configuredNpcs.find(({ field, npc }) => field.name === '跳跳农场' && npc.name === '咕噜大叔')?.npc);
    const recorder = normalizeFieldNpc(configuredNpcs.find(({ field, npc }) => field.name === '跳跳农场' && npc.name === '莫卡')?.npc);
    const carryTask = farmer.interactions.find(interaction => interaction.id === 'irrigate_field');
    const followUpTask = recorder.interactions.find(interaction => interaction.id === 'record_growth');
    const transportTask = recorder.interactions.find(interaction => interaction.id === 'load_cart');
    const petPatrolTask = recorder.interactions.find(interaction => interaction.id === 'pet_scent_patrol');

    assert.equal(carryTask.play.type, 'sceneCollect');
    assert.equal(carryTask.play.interactionMode, 'carry');
    assert.deepEqual(carryTask.play.steps.map(step => step.role), ['pickup', 'destination', 'confirm']);
    assert.equal(carryTask.play.collaboration.moveNpc, true);
    assert.ok(carryTask.play.steps.every(step => step.resolvedIcon && step.resolvedLabel));
    assert.equal(followUpTask.play.type, 'sceneCollect');
    assert.deepEqual(followUpTask.requires, ['irrigate_field']);
    assert.equal(followUpTask.play.collaboration.moveNpc, true);
    assert.deepEqual(followUpTask.relationshipReward, { affection: 6, stageItemId: 'gift_sunflower', stageItemCount: 1 });
    assert.ok(followUpTask.play.steps.every(step => step.resolvedIcon && step.resolvedLabel));
    assert.deepEqual(transportTask.requires, ['record_growth']);
    assert.equal(transportTask.play.interactionMode, 'carry');
    assert.deepEqual(transportTask.play.steps.map(step => step.role), ['pickup', 'destination', 'confirm']);
    assert.equal(transportTask.play.collaboration.companionNpcId, 'npc_1');
    assert.equal(transportTask.play.collaboration.companionOffsetX, -7);
    assert.deepEqual(transportTask.relationshipReward, { affection: 8, stageItemId: '', stageItemCount: 0 });
    assert.ok(transportTask.play.steps.every(step => step.resolvedIcon && step.resolvedLabel));
    assert.equal(recorder.dailyCommission.title, '和宠物完成农场巡田');
    assert.deepEqual(petPatrolTask.requires, ['load_cart']);
    assert.equal(petPatrolTask.play.interactionMode, 'petAssist');
    assert.deepEqual(petPatrolTask.play.steps.map(step => step.role), ['pet', 'target', 'confirm']);
    assert.equal(petPatrolTask.play.collaboration.companionNpcId, 'npc_1');
    assert.deepEqual(petPatrolTask.relationshipReward, { affection: 10, stageItemId: 'gift_fruit_basket', stageItemCount: 1 });
});