import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMineralExpeditionAssist, chooseMineralExpeditionDirective, createMineralExpedition, expeditionRoutes, resolveMineralExpeditionEvent, resolveMineralExpeditionNode, withdrawMineralExpedition } from '../js/mineral_expedition_core.js';

test('矿区远征从双路线开始，并在第十二层提供首领矿核', () => {
    assert.deepEqual(expeditionRoutes(0).map(node => node.id), ['mine', 'hazard']);
    assert.deepEqual(expeditionRoutes(11).map(node => node.id), ['boss']);
});

test('强化探矿爪与矿工特性会改变同一局的采矿货舱收益', () => {
    const state = createMineralExpedition({ petTrait:'miner', moduleIds:['reinforcedClaw'] });
    const result = resolveMineralExpeditionNode(state, 'mine', { success:true });

    assert.equal(result.changed, true);
    assert.equal(result.expedition.cargo.rawStone, 5);
    assert.equal(result.expedition.depth, 1);
});

test('主动撤离保留货舱，而矿层坍塌会折损货舱', () => {
    const started = createMineralExpedition();
    const mined = resolveMineralExpeditionNode(started, 'mine', { success:true }).expedition;
    const withdrew = withdrawMineralExpedition(mined);
    assert.equal(withdrew.expedition.status, 'withdrawn');
    assert.equal(withdrew.expedition.cargo.rawStone, 3);

    const unstable = { ...started, pressure:92 };
    const collapsed = resolveMineralExpeditionNode(unstable, 'hazard', { success:false }).expedition;
    assert.equal(collapsed.status, 'collapsed');
    assert.equal(collapsed.cargo.rawStone, 0);
});

test('补给站可安装新模块，安全锚会降低裂隙压力', () => {
    const atShop = { ...createMineralExpedition(), depth:2 };
    const equipped = resolveMineralExpeditionNode(atShop, 'shop', { shopChoice:'safetyAnchor' }).expedition;
    assert.ok(equipped.moduleIds.includes('safetyAnchor'));

    const hazardState = { ...equipped, depth:0, status:'routing' };
    const crossed = resolveMineralExpeditionNode(hazardState, 'hazard', { success:true }).expedition;
    assert.equal(crossed.pressure, 0);
});

test('失稳裂隙可保守稳定或强行穿越，风险与货舱不同', () => {
    const state = createMineralExpedition();
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

test('深潜指令会在本层改变收益或压力，并在节点后回到勘测状态', () => {
    const extraction = chooseMineralExpeditionDirective(createMineralExpedition(), 'extraction').expedition;
    const mined = resolveMineralExpeditionNode(extraction, 'mine', { success:true }).expedition;
    assert.equal(mined.cargo.rawStone, 5);
    assert.equal(mined.pressure, 5);
    assert.equal(mined.directiveId, 'survey');

    const shielded = chooseMineralExpeditionDirective({ ...createMineralExpedition(), pressure:20 }, 'stabilization').expedition;
    const crossed = resolveMineralExpeditionNode(shielded, 'hazard', { success:true, hazardChoice:'stabilize' }).expedition;
    assert.equal(crossed.pressure, 16);
});

test('每三层矿层异常强制结算真实的货舱与压力取舍', () => {
    let expedition = createMineralExpedition();
    expedition = resolveMineralExpeditionNode(expedition, 'mine', { success:true }).expedition;
    expedition = chooseMineralExpeditionAssist(expedition, expedition.pendingAssistChoices[0]).expedition;
    expedition = resolveMineralExpeditionNode(expedition, 'rest').expedition;
    expedition = chooseMineralExpeditionAssist(expedition, expedition.pendingAssistChoices[0]).expedition;
    expedition = resolveMineralExpeditionNode(expedition, 'shop').expedition;
    assert.equal(expedition.pendingEventId, 'lostDrill');
    assert.equal(resolveMineralExpeditionNode(expedition, 'mine').changed, false);
    const resolved = resolveMineralExpeditionEvent(expedition, 'salvage').expedition;
    assert.equal(resolved.cargo.rawStone, 7);
    assert.equal(resolved.pressure, 12);
    assert.ok(resolved.pendingAssistChoices.length > 0);
});