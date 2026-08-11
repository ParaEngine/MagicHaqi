import { calculateDerivedStats, getLevelGrowth, MAX_BATTLE_LEVEL, upgradePetData } from './pet_stats_core.js';
import { getHomeTreasureInventoryId, isHomeTreasureId } from './home_treasures.js';
import { getEquipmentDefinition } from './pet_equipment_core.js';

const MATERIAL_IDS = new Set([
    'hpShard', 'manaDust', 'attackCore', 'guardPlate', 'stellarEssence',
    'relicCircuit', 'phaseCrystal', 'starMoss', 'captureLens',
    'lunarFiber', 'cometAlloy', 'nebulaPearl',
]);
const ITEM_PREFIX = 'expedition_material_';

const clampCount = value => Math.max(0, Math.floor(Number(value) || 0));
const clampPercent = value => Math.max(0, Math.min(100, Number(value) || 0));

export function getExperienceToNextLevel(level) {
    return 80 + Math.max(1, Math.floor(Number(level) || 1) - 1) * 35;
}

export function calculateExpeditionExperience(runResult = {}) {
    const normalBattles = clampCount(runResult.normalBattles);
    const eliteBattles = clampCount(runResult.eliteBattles);
    const completedNodes = clampCount(runResult.completedNodes);
    const bossBonus = runResult.bossDefeated ? 100 : 0;
    return Math.max(0, 12 + normalBattles * 10 + eliteBattles * 28 + completedNodes * 2 + bossBonus);
}

function addLootToInventory(inventory, loot, lootBonusPercent = 0, random = Math.random) {
    const added = [];
    const bonusPercent = clampPercent(lootBonusPercent);
    for (const entry of Array.isArray(loot) ? loot : []) {
        const id = String(entry?.id || '').trim();
        const baseAmount = Math.min(99, clampCount(entry?.amount));
        if (!MATERIAL_IDS.has(id) || !baseAmount) continue;
        const exactBonus = baseAmount * bonusPercent / 100;
        const bonusAmount = Math.floor(exactBonus) + (random() < exactBonus % 1 ? 1 : 0);
        const amount = baseAmount + bonusAmount;
        const inventoryId = ITEM_PREFIX + id;
        inventory[inventoryId] = clampCount(inventory[inventoryId]) + amount;
        added.push({ id, amount, baseAmount, bonusAmount });
    }
    return added;
}

function addHomeTreasureToInventory(inventory, treasureId) {
    if (!isHomeTreasureId(treasureId)) return null;
    const inventoryId = getHomeTreasureInventoryId(treasureId);
    inventory[inventoryId] = clampCount(inventory[inventoryId]) + 1;
    return treasureId;
}

function addEquipmentToSettlement(inventory, settlement, equipmentDrops) {
    const owned = Array.isArray(settlement.equipment) ? settlement.equipment : (settlement.equipment = []);
    const received = [];
    const materials = [];
    for (const equipmentId of Array.isArray(equipmentDrops) ? equipmentDrops : []) {
        const definition = getEquipmentDefinition(equipmentId);
        if (!definition) continue;
        if (owned.includes(definition.id)) {
            inventory[ITEM_PREFIX + 'stellarEssence'] = clampCount(inventory[ITEM_PREFIX + 'stellarEssence']) + 2;
            materials.push({ id: 'stellarEssence', amount: 2 });
            continue;
        }
        owned.push(definition.id);
        received.push(definition.id);
    }
    return { received, materials };
}

export function processExpeditionResult(pet, inventory, runResult = {}, settlement = {}, options = {}) {
    const runId = String(runResult.runId || '').trim();
    if (!pet?.id || !runId || !inventory || typeof inventory !== 'object') {
        return { applied: false, reason: 'invalid-result', experience: 0, loot: [] };
    }
    if (runResult.completed !== true || runResult.passed !== true) {
        return { applied: false, reason: 'incomplete-run', experience: 0, loot: [] };
    }
    const claimedRunIds = settlement.claimedRunIds && typeof settlement.claimedRunIds === 'object'
        ? settlement.claimedRunIds
        : (settlement.claimedRunIds = {});
    const claimKey = runId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    if (!claimKey || claimedRunIds[claimKey]) {
        return { applied: false, reason: 'already-settled', experience: 0, loot: [] };
    }

    upgradePetData(pet);
    const experience = calculateExpeditionExperience(runResult);
    pet.battle.experience += experience;
    let levelsGained = 0;
    while (pet.battle.level < MAX_BATTLE_LEVEL && pet.battle.experience >= getExperienceToNextLevel(pet.battle.level)) {
        pet.battle.experience -= getExperienceToNextLevel(pet.battle.level);
        pet.battle.level += 1;
        levelsGained += 1;
        const levelGrowth = getLevelGrowth(pet);
        for (const [statName, amount] of Object.entries(levelGrowth)) {
            pet.battle.growthStats[statName] += amount;
        }
    }
    pet.battleStats = calculateDerivedStats(pet);
    const lootBonusPercent = clampPercent(options.lootBonusPercent);
    const loot = addLootToInventory(inventory, runResult.loot, lootBonusPercent, options.random);
    const equipment = addEquipmentToSettlement(inventory, settlement, runResult.equipmentDrops);
    loot.push(...equipment.materials);
    const homeTreasure = runResult.bossDefeated ? addHomeTreasureToInventory(inventory, runResult.homeTreasureId) : null;
    claimedRunIds[claimKey] = Date.now();
    return { applied: true, experience, levelsGained, loot, lootBonusPercent, equipment, homeTreasure, pet };
}