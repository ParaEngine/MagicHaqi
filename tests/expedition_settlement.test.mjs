import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { processExpeditionResult } from '../js/expedition_settlement.js';
import { calculateDerivedStats, getLevelGrowth, upgradePetData } from '../js/pet_stats_core.js';

function createPet() {
    return {
        id: 'pet-test',
        quality: { id: 'N' },
        lifeStats: {},
        battle: {
            level: 1,
            experience: 0,
            baseStats: { maxHp: 120, maxMp: 45, attack: 36, defense: 12, magic: 18, luck: 5 },
            growthStats: {},
            trainingStats: {},
            equipment: {},
        },
    };
}

test('失败远征不会写入经验、库存或领取标记', () => {
    const pet = createPet();
    const inventory = {};
    const settlement = {};

    const result = processExpeditionResult(pet, inventory, {
        runId: 'failed-run', completed: false, passed: false,
        loot: [{ id: 'manaDust', amount: 2 }], bossDefeated: true,
        homeTreasureId: 'mining_array',
    }, settlement);

    assert.deepEqual(result, { applied: false, reason: 'incomplete-run', experience: 0, loot: [] });
    assert.equal(pet.battle.experience, 0);
    assert.deepEqual(inventory, {});
    assert.equal(settlement.claimedRunIds, undefined);
});

test('Boss 通关写入材料、装备、家园宝物并标记 runId', () => {
    const pet = createPet();
    const inventory = {};
    const settlement = {};
    const runResult = {
        runId: 'boss-run', completed: true, passed: true, bossDefeated: true,
        normalBattles: 2, eliteBattles: 1, completedNodes: 30,
        loot: [{ id: 'manaDust', amount: 2 }],
        equipmentDrops: ['expedition_core'], homeTreasureId: 'mining_array',
    };

    const result = processExpeditionResult(pet, inventory, runResult, settlement);

    assert.equal(result.applied, true);
    assert.equal(inventory.expedition_material_manaDust, 2);
    assert.equal(inventory.mining_array, 1);
    assert.deepEqual(settlement.equipment, ['expedition_core']);
    assert.ok(settlement.claimedRunIds['boss-run']);
    assert.ok(pet.battle.experience > 0);
});

test('主题装备会进入远征库存，重复装备转为星核精粹', () => {
    const pet = createPet();
    const inventory = {};
    const settlement = { equipment: ['molten_heart_core'] };

    const result = processExpeditionResult(pet, inventory, {
        runId: 'theme-equipment-run', completed: true, passed: true,
        equipmentDrops: ['abyssal_reef_guard', 'molten_heart_core'],
    }, settlement);

    assert.deepEqual(result.equipment.received, ['abyssal_reef_guard']);
    assert.deepEqual(settlement.equipment, ['molten_heart_core', 'abyssal_reef_guard']);
    assert.equal(inventory.expedition_material_stellarEssence, 2);
});

test('同一 runId 不会重复结算奖励', () => {
    const pet = createPet();
    const inventory = {};
    const settlement = {};
    const runResult = {
        runId: 'dedupe-run', completed: true, passed: true,
        loot: [{ id: 'attackCore', amount: 1 }],
    };

    assert.equal(processExpeditionResult(pet, inventory, runResult, settlement).applied, true);
    const retry = processExpeditionResult(pet, inventory, runResult, settlement);

    assert.equal(retry.applied, false);
    assert.equal(retry.reason, 'already-settled');
    assert.equal(inventory.expedition_material_attackCore, 1);
});

test('星际博物馆掉落 Buff 会增加材料并返回基础与额外数量', () => {
    const pet = createPet();
    const inventory = {};
    const settlement = {};

    const result = processExpeditionResult(pet, inventory, {
        runId: 'mineral-loot-buff', completed: true, passed: true,
        loot: [{ id: 'manaDust', amount: 2 }],
    }, settlement, { lootBonusPercent: 12, random: () => 0.1 });

    assert.equal(inventory.expedition_material_manaDust, 3);
    assert.deepEqual(result.loot, [{ id: 'manaDust', amount: 3, baseAmount: 2, bonusAmount: 1 }]);
    assert.equal(result.lootBonusPercent, 12);
});

test('UR 每级获得的永久成长高于 N 品质', () => {
    const normal = createPet();
    const ur = createPet();
    ur.quality = { id: 'UR' };

    assert.ok(getLevelGrowth(ur).maxHp > getLevelGrowth(normal).maxHp);
    assert.ok(getLevelGrowth(ur).attack > getLevelGrowth(normal).attack);
    assert.ok(getLevelGrowth(ur).magic > getLevelGrowth(normal).magic);
});

test('全图鉴物种在五档品质中都有独立且受控的成长数值', async () => {
    const catalog = JSON.parse(await readFile(new URL('../famous-pets/_pet_index.json', import.meta.url), 'utf8'));
    const qualities = ['N', 'R', 'SR', 'SSR', 'UR'];
    const signatures = new Set();

    for (const entry of catalog) {
        for (const qualityId of qualities) {
            const pet = { famousPetId: entry.id, quality: { id: qualityId }, lifeStats: {} };
            upgradePetData(pet);
            const stats = calculateDerivedStats(pet);
            signatures.add(`${qualityId}:${stats.maxHp}:${stats.maxMp}:${stats.attack}:${stats.defense}:${stats.magic}:${stats.luck}`);
        }
    }

    assert.ok(catalog.length >= 300);
    assert.equal(signatures.size, catalog.length * qualities.length);
});

test('全图鉴在 1 级和 40 级都保持相邻品质每项属性领先', async () => {
    const catalog = JSON.parse(await readFile(new URL('../famous-pets/_pet_index.json', import.meta.url), 'utf8'));
    const qualities = ['N', 'R', 'SR', 'SSR', 'UR'];
    for (const entry of catalog) {
        const levelOne = [];
        const levelForty = [];
        for (const qualityId of qualities) {
            const pet = { famousPetId: entry.id, quality: { id: qualityId }, lifeStats: {} };
            upgradePetData(pet);
            levelOne.push(calculateDerivedStats(pet));
            const growth = getLevelGrowth(pet);
            pet.battle.level = 40;
            for (const [statName, amount] of Object.entries(growth)) pet.battle.growthStats[statName] = amount * 39;
            levelForty.push(calculateDerivedStats(pet));
        }
        for (const stats of [levelOne, levelForty]) {
            for (let index = 1; index < stats.length; index += 1) {
                for (const statName of ['maxHp', 'maxMp', 'attack', 'defense', 'magic', 'luck']) {
                    assert.ok(stats[index][statName] > stats[index - 1][statName], `${entry.id} ${statName} ${qualities[index - 1]} -> ${qualities[index]}`);
                }
            }
        }
    }
});

test('物种原型会持续影响可训练成长上限', () => {
    const profiles = new Set();
    for (const speciesId of ['dragon1', 'sandalwood_bee_mole', 'pixel_orange_cat_pudding']) {
        const pet = { famousPetId: speciesId, quality: { id: 'SR' }, lifeStats: {} };
        upgradePetData(pet);
        profiles.add(`${pet.battle.baseStats.maxHp}:${pet.battle.baseStats.maxMp}:${pet.battle.baseStats.attack}:${pet.battle.baseStats.defense}:${pet.battle.baseStats.magic}`);
    }
    assert.equal(profiles.size, 3);
});