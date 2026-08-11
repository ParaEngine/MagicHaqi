import { applySpeciesGrowthProfile, getSpeciesGrowthProfile } from './pet_species_growth_core.js';
import { calculateEquipmentBonus, normalizeEquipment } from './pet_equipment_core.js';

const QUALITY_BASE_STATS = Object.freeze({
    N: { maxHp: 120, maxMp: 45, attack: 36, defense: 12, magic: 18, luck: 5 },
    R: { maxHp: 145, maxMp: 58, attack: 48, defense: 16, magic: 25, luck: 9 },
    SR: { maxHp: 172, maxMp: 72, attack: 63, defense: 21, magic: 34, luck: 14 },
    SSR: { maxHp: 205, maxMp: 90, attack: 81, defense: 27, magic: 45, luck: 20 },
    UR: { maxHp: 245, maxMp: 112, attack: 105, defense: 35, magic: 59, luck: 28 },
});

const STAT_KEYS = Object.freeze(['maxHp', 'maxMp', 'attack', 'defense', 'magic', 'luck']);
export const MAX_BATTLE_LEVEL = 40;
const GROWTH_CAP_RATIOS = Object.freeze({
    maxHp: 1,
    maxMp: 0.8,
    attack: 0.75,
    defense: 0.75,
    magic: 0.6,
    luck: 0.6,
});

const GROWTH_MATERIALS = Object.freeze({
    maxHp: 'hpShard',
    maxMp: 'manaDust',
    attack: 'attackCore',
    defense: 'guardPlate',
    magic: 'stellarEssence',
    luck: 'stellarEssence',
});

const LEVEL_GROWTH_MULTIPLIERS = Object.freeze({
    N: 1,
    R: 1.2,
    SR: 1.45,
    SSR: 1.75,
    UR: 2.1,
});
const LEVEL_GROWTH_BASE = Object.freeze({ maxHp: 6, maxMp: 2, attack: 2, defense: 1, magic: 1, luck: 0 });

function positiveNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveMultiplier(value) {
    const multiplier = Number(value);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function battleMultipliersFor(pet) {
    const mutation = pet?.mutation && typeof pet.mutation === 'object' ? pet.mutation : {};
    return {
        base: positiveMultiplier(pet?.baseBattleMultiplier ?? mutation.baseBattleMultiplier),
        growth: positiveMultiplier(pet?.growthMultiplier ?? mutation.growthMultiplier),
    };
}

function qualityIdFor(pet) {
    const qualityId = String(pet?.quality?.id || pet?.qualityId || 'N').toUpperCase();
    return QUALITY_BASE_STATS[qualityId] ? qualityId : 'N';
}

function legacyValue(stats, key) {
    if (!stats || typeof stats !== 'object') return undefined;
    const aliases = {
        maxHp: ['maxHp', 'hp', 'health'],
        maxMp: ['maxMp', 'mp', 'mana'],
        attack: ['attack', 'power'],
        defense: ['defense', 'armor'],
        magic: ['magic'],
        luck: ['luck'],
    };
    for (const alias of aliases[key]) {
        if (Number.isFinite(Number(stats[alias]))) return Number(stats[alias]);
    }
    return undefined;
}

function statMap(source, fallback) {
    return Object.fromEntries(STAT_KEYS.map(key => [
        key,
        Math.max(0, positiveNumber(legacyValue(source, key), fallback[key])),
    ]));
}

function statsMatch(left, right) {
    return STAT_KEYS.every(key => Number(left?.[key]) === Number(right?.[key]));
}

function baseStatsForPet(pet, oldBattle, fallback) {
    const stored = oldBattle?.baseStats || pet?.battleStats;
    if (!stored || statsMatch(stored, fallback)) return applySpeciesGrowthProfile(pet, fallback);
    return statMap(stored, fallback);
}

export function calculateDerivedStats(pet, { includeEquipment = false, equipmentEnhancements = {} } = {}) {
    const qualityId = qualityIdFor(pet);
    const fallback = QUALITY_BASE_STATS[qualityId];
    const battle = pet?.battle || {};
    const baseStats = baseStatsForPet(pet, battle, fallback);
    const growthStats = statMap(battle.growthStats, Object.fromEntries(STAT_KEYS.map(key => [key, 0])));
    const trainingStats = statMap(battle.trainingStats, Object.fromEntries(STAT_KEYS.map(key => [key, 0])));
    const multipliers = battleMultipliersFor(pet);
    const equipment = includeEquipment ? calculateEquipmentBonus(battle.equipment, equipmentEnhancements) : null;
    const derived = Object.fromEntries(STAT_KEYS.map(key => [
        key,
        Math.max(0, Math.round((baseStats[key] * multipliers.base + growthStats[key] * multipliers.growth + trainingStats[key] + (equipment?.flat[key] || 0)) * (equipment?.multiplier[key] || 1))),
    ]));
    return {
        ...derived,
        hp: derived.maxHp,
        mp: derived.maxMp,
        power: derived.attack,
    };
}

export function upgradePetData(pet) {
    if (!pet || typeof pet !== 'object') return pet;
    const qualityId = qualityIdFor(pet);
    const fallback = QUALITY_BASE_STATS[qualityId];
    const oldBattle = pet.battle && typeof pet.battle === 'object' ? pet.battle : {};
    const level = Math.max(1, Math.floor(positiveNumber(oldBattle.level ?? pet.battleLevel, 1)));
    const experience = Math.max(0, Math.floor(positiveNumber(oldBattle.experience ?? pet.battleExperience, 0)));

    pet.battle = {
        version: 1,
        level,
        experience,
        baseStats: baseStatsForPet(pet, oldBattle, fallback),
        growthStats: statMap(oldBattle.growthStats, Object.fromEntries(STAT_KEYS.map(key => [key, 0]))),
        trainingStats: statMap(oldBattle.trainingStats, Object.fromEntries(STAT_KEYS.map(key => [key, 0]))),
        equipment: normalizeEquipment(oldBattle.equipment),
    };
    pet.lifeStats = {
        energy: positiveNumber(pet.lifeStats?.energy ?? pet.stats?.hunger, 80),
        mood: positiveNumber(pet.lifeStats?.mood ?? pet.stats?.mood, 80),
        clean: positiveNumber(pet.lifeStats?.clean ?? pet.stats?.clean, 80),
        bond: positiveNumber(pet.lifeStats?.bond ?? pet.stats?.bond, 30),
    };
    pet.battleStats = calculateDerivedStats(pet);
    return pet;
}

export function getGrowthMaterialId(statName) {
    return GROWTH_MATERIALS[statName] || '';
}

export function getLevelGrowth(pet) {
    const multiplier = LEVEL_GROWTH_MULTIPLIERS[qualityIdFor(pet)] || LEVEL_GROWTH_MULTIPLIERS.N;
    return Object.fromEntries(STAT_KEYS.map(key => [key, Math.max(0, Math.round(LEVEL_GROWTH_BASE[key] * multiplier))]));
}

export function getPetGrowthProfile(pet) {
    return getSpeciesGrowthProfile(pet);
}

export function getGrowthCap(pet, statName) {
    upgradePetData(pet);
    if (!STAT_KEYS.includes(statName)) return 0;
    const ratio = GROWTH_CAP_RATIOS[statName] || 0;
    return Math.max(0, Math.floor(pet.battle.baseStats[statName] * ratio * battleMultipliersFor(pet).growth));
}

export function canApplyGrowthMaterial(pet, statName, amount = 1) {
    upgradePetData(pet);
    if (!STAT_KEYS.includes(statName)) return false;
    const increment = Math.max(0, Math.floor(Number(amount) || 0));
    return increment > 0 && pet.battle.growthStats[statName] + increment <= getGrowthCap(pet, statName);
}

export function applyGrowthMaterial(pet, statName, amount = 1) {
    upgradePetData(pet);
    if (!STAT_KEYS.includes(statName)) return false;
    const increment = Math.max(0, Math.floor(Number(amount) || 0));
    if (!canApplyGrowthMaterial(pet, statName, increment)) return false;
    pet.battle.growthStats[statName] += increment;
    pet.battleStats = calculateDerivedStats(pet);
    return true;
}

export { GROWTH_CAP_RATIOS, QUALITY_BASE_STATS, LEVEL_GROWTH_MULTIPLIERS };