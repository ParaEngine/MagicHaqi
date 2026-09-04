import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTIBLE_ITEMS, GIFT_FRESHNESS_MS, applyNpcGiftSettlement, applyNpcInteractionReward, getCollectibleFreshness, getNpcGiftProfile, registerCollectibleAcquisition, relationshipStage, settleNpcGift } from '../js/npc_gifts.js';

test('收藏系统提供 20 个分属五类的可送礼道具', () => {
    assert.equal(COLLECTIBLE_ITEMS.length, 20);
    assert.deepEqual(new Set(COLLECTIBLE_ITEMS.map(item => item.category)), new Set(['tea', 'flower', 'food', 'decor', 'mineral']));
    assert.equal(new Set(COLLECTIBLE_ITEMS.map(item => item.id)).size, 20);
});

test('NPC 偏好稳定且不同角色拥有不同组合', () => {
    const mayor = getNpcGiftProfile({ id: 'mayor_rhodes' });
    assert.deepEqual(mayor, getNpcGiftProfile({ id: 'mayor_rhodes' }));
    assert.notDeepEqual(mayor, getNpcGiftProfile({ id: 'doctor_dokter' }));
    assert.notEqual(mayor.likedCategory, mayor.dislikedCategory);
});

test('喜爱、普通和讨厌礼物产生不同心意变化', () => {
    const npc = { id: 'mayor_rhodes' };
    const profile = getNpcGiftProfile(npc);
    const favorite = COLLECTIBLE_ITEMS.find(item => item.id === profile.favoriteItemId);
    const disliked = COLLECTIBLE_ITEMS.find(item => item.category === profile.dislikedCategory);
    const neutral = COLLECTIBLE_ITEMS.find(item => ![profile.likedCategory, profile.dislikedCategory].includes(item.category));
    const relationship = { affection: 10 };
    const resultFor = item => settleNpcGift({ npc, relationship, inventory: { [item.id]: 1 }, itemId: item.id, random: () => 0.9 });

    assert.equal(resultFor(favorite).affectionDelta, 12);
    assert.equal(resultFor(neutral).affectionDelta, 3);
    assert.equal(resultFor(disliked).affectionDelta, -2);
});

test('送礼每天最多三次，基础回礼概率为 5%', () => {
    const npc = { id: 'npc_1' };
    const item = COLLECTIBLE_ITEMS[0];
    const limited = settleNpcGift({ npc, relationship: { giftsToday: { day: '2026-08-20', count: 3 } }, inventory: { [item.id]: 1 }, itemId: item.id, now: new Date(2026, 7, 20).getTime() });
    assert.equal(limited.reason, 'daily-limit');

    const returned = settleNpcGift({ npc, relationship: {}, inventory: { [item.id]: 1 }, itemId: item.id, random: () => 0.01 });
    assert.equal(returned.returnGiftChance, 0.05);
    assert.equal(returned.returnItem.rarity, 'rare');
});

test('结算消耗礼物、写入心意并支持阶段提升', () => {
    const npc = { id: 'doctor_dokter' };
    const profile = getNpcGiftProfile(npc);
    const inventory = { [profile.favoriteItemId]: 1 };
    const relationship = { affection: 15 };
    const result = settleNpcGift({ npc, relationship, inventory, itemId: profile.favoriteItemId, random: () => 0.9 });

    assert.equal(applyNpcGiftSettlement(result, relationship, inventory), true);
    assert.equal(inventory[profile.favoriteItemId], undefined);
    assert.equal(relationship.affection, 27);
    assert.equal(relationshipStage(relationship.affection).name, '熟悉');
});

test('新鲜礼物七天后降为普通心意但不会从背包消失', () => {
    const npc = { id: 'freshness_npc' };
    const profile = getNpcGiftProfile(npc);
    const item = COLLECTIBLE_ITEMS.find(candidate => candidate.id === profile.favoriteItemId && ['tea', 'flower', 'food'].includes(candidate.category))
        || COLLECTIBLE_ITEMS.find(candidate => ['tea', 'flower', 'food'].includes(candidate.category));
    const acquiredAt = new Date(2026, 7, 1, 10).getTime();
    const inventory = { [item.id]: 1 };
    const freshness = {};
    registerCollectibleAcquisition(freshness, item.id, 1, acquiredAt);

    assert.equal(getCollectibleFreshness(item.id, inventory, freshness, acquiredAt + GIFT_FRESHNESS_MS - 1).staleCount, 0);
    assert.equal(getCollectibleFreshness(item.id, inventory, freshness, acquiredAt + GIFT_FRESHNESS_MS).staleCount, 1);
    const result = settleNpcGift({ npc, inventory, freshness, itemId: item.id, now: acquiredAt + GIFT_FRESHNESS_MS, random: () => 0.9 });
    assert.equal(result.reaction, 'stale');
    assert.equal(result.affectionDelta, 3);
    assert.equal(inventory[item.id], 1);
});

test('旧存档与永久收藏不因缺少批次时间而过期', () => {
    const oldTea = COLLECTIBLE_ITEMS.find(item => item.category === 'tea' && item.rarity !== 'rare');
    const mineral = COLLECTIBLE_ITEMS.find(item => item.category === 'mineral');
    const inventory = { [oldTea.id]: 2, [mineral.id]: 1 };
    assert.deepEqual(getCollectibleFreshness(oldTea.id, inventory, {}, Date.now()), {
        perishable: true,
        total: 2,
        freshCount: 2,
        staleCount: 0,
        nextExpiryAt: 0,
    });
    assert.equal(getCollectibleFreshness(mineral.id, inventory, {}, Date.now()).perishable, false);
});

test('送礼优先消费最旧批次', () => {
    const item = COLLECTIBLE_ITEMS.find(candidate => candidate.category === 'food' && candidate.rarity !== 'rare');
    const firstAt = new Date(2026, 7, 1, 10).getTime();
    const secondAt = firstAt + 2 * 24 * 60 * 60 * 1000;
    const inventory = { [item.id]: 2 };
    const freshness = {};
    registerCollectibleAcquisition(freshness, item.id, 1, firstAt);
    registerCollectibleAcquisition(freshness, item.id, 1, secondAt);
    const result = settleNpcGift({ npc: { id: 'batch_npc' }, relationship: {}, inventory, freshness, itemId: item.id, now: secondAt, random: () => 0.9 });
    applyNpcGiftSettlement(result, {}, inventory, freshness);
    assert.equal(inventory[item.id], 1);
    assert.deepEqual(freshness[item.id], [secondAt]);
});

test('连续任务首次完成增加心意并在跨阶段时发放收藏奖励', () => {
    const relationship = { affection: 16 };
    const inventory = {};
    const result = applyNpcInteractionReward({
        interactionId: 'moka_seedling_rounds',
        reward: { affection: 6, stageItemId: 'gift_sunflower', stageItemCount: 1 },
        relationship,
        inventory,
    });

    assert.equal(result.applied, true);
    assert.equal(result.affectionBefore, 16);
    assert.equal(result.affectionAfter, 22);
    assert.equal(result.stageBefore.id, 'acquaintance');
    assert.equal(result.stageAfter.id, 'familiar');
    assert.equal(result.stageReward?.item.id, 'gift_sunflower');
    assert.equal(inventory.gift_sunflower, 1);

    const duplicate = applyNpcInteractionReward({
        interactionId: 'moka_seedling_rounds',
        reward: { affection: 6, stageItemId: 'gift_sunflower', stageItemCount: 1 },
        relationship,
        inventory,
    });
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.reason, 'already-settled');
    assert.equal(relationship.affection, 22);
    assert.equal(inventory.gift_sunflower, 1);
});