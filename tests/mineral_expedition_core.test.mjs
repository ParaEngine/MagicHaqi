import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtocolRegistry, advanceToNode, chooseMineralExpeditionAssist, chooseMineralExpeditionDirective, collapse, createMineralExpedition, evacuate, expeditionBuilds, expeditionRoutes, generateMineRoute, generateProtocolChoices, mineRiskAt, mineralAssistChoicePreview, nextContinuousMineNode, nodeRiskPreview, normalizeMineralExpedition, resolveMineralExpeditionEvent, resolveMineralExpeditionNode, secureMineLoot, selectProtocol, withdrawMineralExpedition } from '../js/mineral_expedition_core.js';

test('矿区远征前四层为必经互动，第五层起开放双路线', () => {
    for (let depth = 0; depth < 4; depth += 1) {
        assert.deepEqual(expeditionRoutes(depth).map(node => node.id), ['mine']);
    }
    assert.equal(expeditionRoutes(4).length, 2);
    assert.deepEqual(expeditionRoutes(11).map(node => node.id), ['boss']);
});

test('第 4 层使用独立撤离按钮，第 8、12 层同时提供路线升降梯', () => {
    const route = generateMineRoute({ seed:130813 });
    assert.equal(route[3].some(node => node.type === 'evacuate'), false);
    for (const floor of [8, 12]) assert.ok(route[floor - 1].some(node => node.type === 'evacuate'));
    for (const floor of [4, 8, 12]) {
        assert.equal(withdrawMineralExpedition({ ...createMineralExpedition(), depth:floor, currentFloor:floor }).changed, true);
    }
});

test('路线风险预演覆盖成功失败区间和协议压力倍率', () => {
    const state = { ...createMineralExpedition(), instability:50, pressure:50 };
    assert.deepEqual(nodeRiskPreview(state, { type:'drill' }), {
        minDelta:9,
        maxDelta:15,
        minInstability:59,
        maxInstability:65,
        minCollapseChance:.096,
        maxCollapseChance:.12,
    });
    assert.equal(nodeRiskPreview(state, { type:'shop' }).minDelta, -7);

    const amplified = { ...state, activeProtocols:['highPressureDrill'] };
    assert.equal(nodeRiskPreview(amplified, { type:'drill' }).maxDelta, 23);
});

test('强化探矿爪与矿工特性会改变同一局的采矿货舱收益', () => {
    const state = createMineralExpedition({ petTrait:'miner', moduleIds:['reinforcedClaw'] });
    const result = resolveMineralExpeditionNode(state, 'mine', { success:true });

    assert.equal(result.changed, true);
    assert.equal(result.expedition.cargo.rawStone, 5);
    assert.equal(result.expedition.depth, 1);
});

test('主动撤离仅在关键层保留全部货舱，而坍塌只保留封装货舱', () => {
    const started = createMineralExpedition();
    const mined = resolveMineralExpeditionNode(started, 'mine', { success:true }).expedition;
    assert.equal(withdrawMineralExpedition(mined).changed, false);
    const withdrew = withdrawMineralExpedition({ ...mined, depth:4, currentFloor:4 });
    assert.equal(withdrew.expedition.status, 'withdrawn');
    assert.equal(withdrew.expedition.cargo.rawStone, 3);

    const unstable = { ...started, depth:4, pressure:92 };
    const collapsed = resolveMineralExpeditionNode(unstable, 'hazard', { success:false }).expedition;
    assert.equal(collapsed.status, 'collapsed');
    assert.equal(collapsed.cargo.rawStone, 0);
});

test('补给站可安装新模块，安全锚会降低裂隙压力', () => {
    const atShop = { ...createMineralExpedition(), depth:5 };
    const equipped = resolveMineralExpeditionNode(atShop, 'shop', { shopChoice:'safetyAnchor' }).expedition;
    assert.ok(equipped.moduleIds.includes('safetyAnchor'));

    const hazardState = { ...equipped, depth:4, status:'routing' };
    const crossed = resolveMineralExpeditionNode(hazardState, 'hazard', { success:true }).expedition;
    assert.equal(crossed.pressure, 0);
});

test('失稳裂隙可保守稳定或强行穿越，风险与货舱不同', () => {
    const state = { ...createMineralExpedition(), depth:4 };
    const stabilized = resolveMineralExpeditionNode(state, 'hazard', { hazardChoice:'stabilize' }).expedition;
    const forced = resolveMineralExpeditionNode(state, 'hazard', { success:true, hazardChoice:'force' }).expedition;

    assert.equal(stabilized.pressure, 4);
    assert.equal(stabilized.cargo.rawStone, 0);
    assert.equal(forced.pressure, 8);
    assert.equal(forced.cargo.rawStone, 2);
});

test('每层可选择临时协助协议，并改变同一局后续采矿', () => {
    const resolved = resolveMineralExpeditionNode(createMineralExpedition(), 'mine', { success:true }).expedition;
    assert.equal(resolved.pendingAssistChoices.length, 3);

    const chosen = chooseMineralExpeditionAssist({ ...resolved, pendingAssistChoices:['cargoSense'] }, 'cargoSense').expedition;
    const nextMine = resolveMineralExpeditionNode({ ...chosen, depth:0, routes:expeditionRoutes(0) }, 'mine', { success:true }).expedition;
    assert.ok(chosen.assistIds.includes('cargoSense'));
    assert.equal(nextMine.cargo.rawStone, 7);
});

test('伙伴协助选择会按当前矿层局势提供即时预览和单一推荐', () => {
    const calm = { ...createMineralExpedition(), currentFloor:3, depth:3, pendingAssistChoices:['cargoSense', 'sureGrip', 'fieldRepair'] };
    assert.deepEqual(mineralAssistChoicePreview(calm, 'cargoSense'), {
        summary:'采矿原石 +1 · 货舱 0',
        recommended:true,
    });
    assert.equal(mineralAssistChoicePreview(calm, 'sureGrip').recommended, false);

    const pressured = { ...calm, instability:68, pressure:68 };
    assert.deepEqual(mineralAssistChoicePreview(pressured, 'fieldRepair'), {
        summary:'压力 68% → 58%',
        recommended:true,
    });
    assert.equal(mineralAssistChoicePreview(pressured, 'cargoSense').recommended, false);
});

test('深潜指令会在本层改变收益或压力，并在节点后回到勘测状态', () => {
    const extraction = chooseMineralExpeditionDirective(createMineralExpedition(), 'extraction').expedition;
    const mined = resolveMineralExpeditionNode(extraction, 'mine', { success:true }).expedition;
    assert.equal(mined.cargo.rawStone, 5);
    assert.equal(mined.pressure, 5);
    assert.equal(mined.directiveId, 'survey');

    const shielded = chooseMineralExpeditionDirective({ ...createMineralExpedition(), depth:4, pressure:20 }, 'stabilization').expedition;
    const crossed = resolveMineralExpeditionNode(shielded, 'hazard', { success:true, hazardChoice:'stabilize' }).expedition;
    assert.equal(crossed.pressure, 16);
});

test('每三层矿层异常强制结算真实的货舱与压力取舍', () => {
    let expedition = createMineralExpedition();
    expedition = resolveMineralExpeditionNode(expedition, 'mine', { success:true }).expedition;
    expedition = chooseMineralExpeditionAssist(expedition, expedition.pendingAssistChoices[0]).expedition;
    expedition = resolveMineralExpeditionNode(expedition, 'mine', { success:true }).expedition;
    expedition = chooseMineralExpeditionAssist(expedition, expedition.pendingAssistChoices[0]).expedition;
    expedition = resolveMineralExpeditionNode(expedition, 'mine', { success:true }).expedition;
    assert.equal(expedition.pendingEventId, 'lostDrill');
    assert.equal(resolveMineralExpeditionNode(expedition, 'mine').changed, false);
    const resolved = resolveMineralExpeditionEvent(expedition, 'salvage').expedition;
    assert.equal(resolved.cargo.rawStone, 13);
    assert.equal(resolved.pressure, 12);
    assert.ok(resolved.pendingAssistChoices.length > 0);
});

test('路线图每四层仅保留关键决策，中间层连续采矿', () => {
    const routeMap = generateMineRoute({ seed:20260813 });
    const allowedTypes = new Set(['explore', 'drill', 'combat', 'event', 'shop', 'protocol_cache', 'boss', 'evacuate']);

    assert.equal(routeMap.length, 12);
    for (let floor = 1; floor <= 4; floor += 1) {
        assert.deepEqual(routeMap[floor - 1].map(node => node.type), ['drill']);
    }
    for (const floor of [6, 7, 10, 11]) assert.deepEqual(routeMap[floor - 1].map(node => node.type), ['drill']);
    for (const floor of [5, 8, 9]) assert.ok(routeMap[floor - 1].length >= 2);
    assert.ok(routeMap[7].some(node => node.type === 'evacuate'));
    assert.ok(routeMap[11].some(node => node.type === 'boss'));
    assert.ok(routeMap[11].some(node => node.type === 'evacuate'));
    assert.ok(routeMap.flat().every(node => allowedTypes.has(node.type)));
    assert.deepEqual(generateMineRoute({ seed:20260813 }), routeMap);
});

test('协议缓存从未持有协议中随机抽取三个互不重复的选项', () => {
    assert.deepEqual(new Set(Object.values(ProtocolRegistry).map(protocol => protocol.type)), new Set(['demolition', 'scout', 'resonance', 'extraction']));
    assert.ok(Object.values(ProtocolRegistry).every(protocol => protocol.id && protocol.name && protocol.description && protocol.effect));
    const choices = generateProtocolChoices({ activeProtocols:['highPressureDrill'] }, { random:() => .25 });

    assert.equal(choices.length, 3);
    assert.equal(new Set(choices).size, 3);
    assert.ok(choices.every(id => ProtocolRegistry[id]));
    assert.ok(!choices.includes('highPressureDrill'));
});

test('只能选择当前三选一协议并加入本局构筑', () => {
    const state = { ...createMineralExpedition({ seed:17 }), pendingProtocolChoices:['prismVision', 'safetyAirbag', 'isotopeCopy'] };
    const rejected = selectProtocol(state, 'thermalChain');
    const selected = selectProtocol(state, 'prismVision');

    assert.equal(rejected.changed, false);
    assert.equal(selected.changed, true);
    assert.ok(selected.expedition.activeProtocols.includes('prismVision'));
    assert.equal(selected.expedition.pendingProtocolChoices.length, 0);
    assert.equal(selected.expedition.revealedNodeTypes.length, 2);
});

test('协议钩子会改变推进不稳定度与高稀有货舱结算', () => {
    const base = createMineralExpedition({ seed:23 });
    const firstNode = base.routeMap[0][0];
    const normal = advanceToNode(base, firstNode, { success:true, random:() => .99 });
    const demolition = advanceToNode({ ...base, activeProtocols:['highPressureDrill'] }, firstNode, { success:true, random:() => .99 });
    const resonance = advanceToNode({ ...base, activeProtocols:['isotopeCopy'] }, firstNode, { success:true, random:() => 0 });

    assert.equal(normal.expedition.instability, 9);
    assert.equal(demolition.expedition.instability, 14);
    assert.equal(resonance.expedition.cargo.rareStone, 2);
    assert.equal(resonance.expedition.securedLoot.rareStone, 1);
});

test('规避直觉只在一次坍塌结算中保护未封装货物', () => {
    const cargo = { rawStone:12, research:3, rareStone:1 };
    const guarded = collapse({ ...createMineralExpedition(), cargo, activeProtocols:['collapseGuard'] });

    assert.deepEqual(guarded.expedition.cargo, cargo);
    assert.deepEqual(guarded.expedition.securedLoot, cargo);
    assert.ok(!guarded.expedition.activeProtocols.includes('collapseGuard'));
    assert.equal(guarded.lostBeacon, null);
    assert.match(guarded.report, /保护了全部货物/);
    assert.doesNotMatch(guarded.report, /仅已封装货物/);
});

test('坍塌会把未封装损失打包为下一局失落信标', () => {
    const collapsed = collapse({
        ...createMineralExpedition(),
        depth:7,
        currentFloor:7,
        cargo:{ rawStone:14, research:5, rareStone:2 },
        securedLoot:{ rawStone:6, research:2, rareStone:1 },
    });

    assert.deepEqual(collapsed.lostBeacon, { cargo:{ rawStone:8, research:3, rareStone:1 }, sourceDepth:7 });
    assert.deepEqual(collapsed.expedition.cargo, { rawStone:6, research:2, rareStone:1 });
    assert.match(collapsed.report, /失落信标/);
});

test('下一局第 2 层可进入失落信标并夺回货物后清空信标', () => {
    const lostBeacon = { cargo:{ rawStone:8, research:3, rareStone:1 }, sourceDepth:7 };
    const started = createMineralExpedition({ seed:29, lostBeacon });
    const first = advanceToNode(started, started.routeMap[0][0], { success:true, random:() => .99 }).expedition;
    const beaconNode = first.routeMap[1].find(node => node.type === 'beacon');
    const recovered = advanceToNode(first, beaconNode, { success:true, random:() => .99 });

    assert.ok(beaconNode);
    assert.equal(recovered.event, 'beacon');
    assert.equal(recovered.lostBeacon, null);
    assert.equal(recovered.expedition.lostBeacon, null);
    assert.deepEqual(recovered.expedition.cargo, { rawStone:11, research:3, rareStone:1 });
});

test('信标挑战失败仍回收部分货物，并将剩余货物保留到下一局', () => {
    const lostBeacon = { cargo:{ rawStone:9, research:3, rareStone:2 }, sourceDepth:7 };
    const started = createMineralExpedition({ seed:29, lostBeacon });
    const first = advanceToNode(started, started.routeMap[0][0], { success:true, random:() => .99 }).expedition;
    const beaconNode = first.routeMap[1].find(node => node.type === 'beacon');
    const partial = advanceToNode(first, beaconNode, { success:false });

    assert.equal(partial.beaconOutcome, 'partial');
    assert.deepEqual(partial.recoveredCargo, { rawStone:4, research:2, rareStone:1 });
    assert.deepEqual(partial.lostBeacon, { cargo:{ rawStone:5, research:1, rareStone:1 }, sourceDepth:7, recoveryProgress:1 });
    assert.deepEqual(partial.expedition.securedLoot, partial.recoveredCargo);
    assert.equal(partial.expedition.highlights.at(-1).type, 'beacon_partial');
});

test('信标中继提高失败回收比例，完整协议组合会激活流派', () => {
    const lostBeacon = { cargo:{ rawStone:9, research:3, rareStone:2 }, sourceDepth:7 };
    const started = createMineralExpedition({ seed:29, lostBeacon });
    const first = advanceToNode({ ...started, activeProtocols:['prismVision', 'beaconRelay'] }, started.routeMap[0][0], { success:true, random:() => .99 }).expedition;
    const beaconNode = first.routeMap[1].find(node => node.type === 'beacon');
    const partial = advanceToNode(first, beaconNode, { success:false });
    const builds = expeditionBuilds(first);

    assert.deepEqual(partial.recoveredCargo, { rawStone:7, research:3, rareStone:2 });
    assert.equal(builds[0].id, 'beacon_hunter');
    assert.equal(builds[0].active, true);
    assert.equal(expeditionBuilds({ activeProtocols:['highPressureDrill'] }, 'thermalChain')[0].active, true);
    assert.equal(expeditionBuilds({ activeProtocols:['collapseGuard'] })[0].active, false);
});

test('RunState v2 保持旧字段别名与局内协议', () => {
    const state = createMineralExpedition({ seed:7, assistIds:['cargoSense'] });
    assert.equal(state.version, 2);
    assert.equal(state.currentFloor, 0);
    assert.equal(state.instability, 0);
    assert.deepEqual(state.securedLoot, { rawStone:0, research:0, rareStone:0 });
    assert.deepEqual(state.activeProtocols, ['cargoSense']);

    const migrated = normalizeMineralExpedition({ depth:4, pressure:35, assistIds:['pressureVeil'], cargo:{ rawStone:6, research:2 } });
    assert.equal(migrated.currentFloor, 4);
    assert.equal(migrated.instability, 35);
    assert.deepEqual(migrated.activeProtocols, ['pressureVeil']);
});

test('节点推进更新层数与不稳定度，并拒绝跳层', () => {
    const started = createMineralExpedition({ seed:11 });
    const firstNode = started.routeMap[0][0];
    const advanced = advanceToNode(started, firstNode, { success:true });
    assert.equal(advanced.changed, true);
    assert.equal(advanced.expedition.currentFloor, 1);
    assert.equal(advanced.expedition.depth, 1);
    assert.equal(advanced.expedition.instability, 9);
    assert.equal(advanced.expedition.cargo.rawStone, 3);

    const skipped = advanceToNode(started, started.routeMap[2][0]);
    assert.equal(skipped.changed, false);
    assert.equal(skipped.event, 'invalid');
});

test('普通矿层自动衔接，在路线决策和待选协议前停止', () => {
    let expedition = createMineralExpedition({ seed:13 });
    assert.equal(nextContinuousMineNode(expedition), null);
    for (let floor = 1; floor <= 4; floor += 1) {
        expedition = advanceToNode(expedition, expedition.routeMap[floor - 1][0], { success:true, random:() => .99 }).expedition;
        const nextNode = nextContinuousMineNode(expedition);
        assert.equal(nextNode?.depth || null, floor < 4 ? floor + 1 : null);
        assert.equal(nextNode?.type || null, floor < 4 ? 'drill' : null);
    }
    const afterStageChoice = { ...expedition, currentFloor:5, depth:5 };
    assert.equal(nextContinuousMineNode(afterStageChoice)?.depth, 6);
    assert.equal(nextContinuousMineNode({ ...afterStageChoice, pendingProtocolChoices:['prismVision'] }), null);
    assert.equal(nextContinuousMineNode({ ...afterStageChoice, currentFloor:7, depth:7 }), null);
    assert.equal(nextContinuousMineNode({ ...afterStageChoice, currentFloor:9, depth:9 })?.depth, 10);
    assert.equal(nextContinuousMineNode({ ...afterStageChoice, currentFloor:11, depth:11 }), null);
});

test('仅关键层可以封装和撤离，坍塌只保留已封装货舱', () => {
    const cargo = { rawStone:10, research:3, rareStone:0 };
    const tooEarly = { ...createMineralExpedition({ seed:19 }), depth:3, currentFloor:3, cargo };
    assert.equal(evacuate(tooEarly).changed, false);

    const checkpoint = { ...tooEarly, depth:4, currentFloor:4 };
    const secured = secureMineLoot(checkpoint);
    assert.equal(secured.changed, true);
    assert.deepEqual(secured.expedition.securedLoot, cargo);

    const deeper = { ...secured.expedition, depth:7, currentFloor:7, cargo:{ rawStone:18, research:5 } };
    const collapsed = collapse(deeper);
    assert.equal(collapsed.expedition.status, 'collapsed');
    assert.deepEqual(collapsed.expedition.cargo, cargo);

    const evacuated = evacuate({ ...checkpoint, cargo:{ rawStone:12, research:4 } });
    assert.equal(evacuated.expedition.status, 'withdrawn');
    assert.deepEqual(evacuated.expedition.securedLoot, { rawStone:12, research:4, rareStone:0 });
});

test('不稳定度同时提高高稀有发现率与坍塌概率', () => {
    assert.ok(mineRiskAt(80).rareDropChance > mineRiskAt(10).rareDropChance);
    assert.ok(mineRiskAt(80).collapseChance > mineRiskAt(10).collapseChance);

    const state = { ...createMineralExpedition({ seed:23 }), pressure:70, instability:70 };
    const firstNode = state.routeMap[0][0];
    const rareDrop = advanceToNode(state, firstNode, { success:true, random:() => 0 });
    assert.equal(rareDrop.expedition.status, 'collapsed');
    assert.equal(rareDrop.expedition.cargo.rareStone, 0);
    assert.match(rareDrop.report, /已封装货物/);
});