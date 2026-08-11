// 营地繁育的纯规则层：不访问 DOM、state、storage 或 window。

import { MAX_BATTLE_LEVEL } from './pet_stats_core.js';

export { MAX_BATTLE_LEVEL };
export const BREEDABLE_STAGES = Object.freeze(['adult', 'elder']);
export const IV_KEYS = Object.freeze(['life', 'attack', 'defense', 'speed', 'magic']);
export const UR_MUTATION_CHANCE = 0.01;
export const SSR_CATALYST_MUTATION_CHANCE = 0.25;
export const UR_CATALYST_ATTRIBUTE_FLOOR = 80;
export const UR_GROWTH_MULTIPLIER = 1.6;
export const UR_BASE_BATTLE_MULTIPLIER = 1.75;

export const MUTATION_SPECIES_POOL = Object.freeze([
    Object.freeze({
        id: 'golden_bounce_bun',
        names: Object.freeze(['金团墩墩', '啵啵圆墩', '跳跳金团']),
    }),
    Object.freeze({
        id: 'golden_spud_squeak',
        names: Object.freeze(['薯啵啵', '金绒小团', '圆滚薯薯']),
    }),
]);

const QUALITY_RANKS = Object.freeze({ N: 0, R: 1, SR: 2, SSR: 3, UR: 4 });
const DNA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DNA_LENGTH = 18;
const DNA_SEGMENT_LENGTH = 3;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function randomUnit(random) {
    const value = Number(random());
    return Number.isFinite(value) ? clamp(value, 0, 0.999999999999) : Math.random();
}

function randomIndex(length, random) {
    return Math.floor(randomUnit(random) * Math.max(1, length));
}

function randomInteger(minimum, maximum, random) {
    return minimum + randomIndex(maximum - minimum + 1, random);
}

function qualityIdFor(pet) {
    const qualityId = String(pet?.quality?.id || pet?.qualityId || 'N').toUpperCase();
    return Object.hasOwn(QUALITY_RANKS, qualityId) ? qualityId : 'N';
}

function battleLevelFor(pet) {
    const level = Number(pet?.battle?.level ?? pet?.battleLevel ?? pet?.level ?? 0);
    return Number.isFinite(level) ? Math.floor(level) : 0;
}

function isLocked(pet) {
    return pet?.locked === true || pet?.isLocked === true || pet?.lock === true || pet?.status?.locked === true;
}

function ivFor(pet, key) {
    const value = Number(pet?.ivs?.[key] ?? pet?.iv?.[key] ?? pet?.breeding?.ivs?.[key] ?? 50);
    return Number.isFinite(value) ? clamp(value, 0, 100) : 50;
}

function normalizedDna(value) {
    const clean = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let dna = '';
    for (let index = 0; index < DNA_LENGTH; index += 1) {
        const candidate = clean[index];
        dna += DNA_ALPHABET.includes(candidate) ? candidate : DNA_ALPHABET[index % DNA_ALPHABET.length];
    }
    return dna;
}

/** 两只不同、未锁定、成年或老年且均满 40 级的宠物才能繁育。 */
export function canBreed(parentA, parentB) {
    if (!parentA || !parentB || parentA === parentB || isLocked(parentA) || isLocked(parentB)) return false;
    if (parentA.id && parentB.id && parentA.id === parentB.id) return false;
    return BREEDABLE_STAGES.includes(parentA.stage)
        && BREEDABLE_STAGES.includes(parentB.stage)
        && battleLevelFor(parentA) >= MAX_BATTLE_LEVEL
        && battleLevelFor(parentB) >= MAX_BATTLE_LEVEL;
}

/**
 * 每项 IV：随机主亲本 65% + 双亲平均值 35% + [-5, +5] 的点数波动。
 * random 可注入，方便以固定序列进行单元测试。
 */
export function calculateChildIVs(parentA, parentB, { random = Math.random, attributeFloor = null } = {}) {
    return Object.freeze(Object.fromEntries(IV_KEYS.map((key) => {
        const a = ivFor(parentA, key);
        const b = ivFor(parentB, key);
        const mainParent = randomUnit(random) < 0.5 ? a : b;
        const average = (a + b) / 2;
        const variation = randomInteger(-5, 5, random);
        const value = Math.round(clamp(mainParent * 0.65 + average * 0.35 + variation, 0, 100));
        return [key, key === attributeFloor ? Math.max(UR_CATALYST_ATTRIBUTE_FLOOR, value) : value];
    })));
}

/** 正常子代仅继承到双亲中的最高品质，且上限固定为 SSR。 */
export function inheritedQualityId(parentA, parentB) {
    const rank = Math.min(QUALITY_RANKS.SSR, Math.max(QUALITY_RANKS[qualityIdFor(parentA)], QUALITY_RANKS[qualityIdFor(parentB)]));
    return Object.keys(QUALITY_RANKS).find((id) => QUALITY_RANKS[id] === rank) || 'N';
}

/**
 * 仅 SSR x SSR 有严格的 1% 几率产生 UR 突变。
 * 成功时记录金色二维光环、随机的可爱名称与专属高倍率。
 */
export function rollMutation(parentA, parentB, { random = Math.random, mutationChance = UR_MUTATION_CHANCE } = {}) {
    if (qualityIdFor(parentA) !== 'SSR' || qualityIdFor(parentB) !== 'SSR' || randomUnit(random) >= mutationChance) {
        return Object.freeze({ triggered: false, qualityId: null, species: null, aura: null });
    }

    const species = MUTATION_SPECIES_POOL[randomIndex(MUTATION_SPECIES_POOL.length, random)];
    const name = species.names[randomIndex(species.names.length, random)];
    return Object.freeze({
        triggered: true,
        kind: 'ur_gene_mutation',
        qualityId: 'UR',
        species: Object.freeze({ id: species.id, name }),
        aura: 'golden_aura',
        growthMultiplier: UR_GROWTH_MULTIPLIER,
        baseBattleMultiplier: UR_BASE_BATTLE_MULTIPLIER,
    });
}

/** 以分段 50/50 遗传、每字符 8% 变异产生 18 位子代 DNA。 */
export function crossoverDna(parentADna, parentBDna, { random = Math.random } = {}) {
    const a = normalizedDna(parentADna);
    const b = normalizedDna(parentBDna);
    let child = '';
    for (let offset = 0; offset < DNA_LENGTH; offset += DNA_SEGMENT_LENGTH) {
        const source = randomUnit(random) < 0.5 ? a : b;
        for (let index = 0; index < DNA_SEGMENT_LENGTH; index += 1) {
            child += randomUnit(random) < 0.08
                ? DNA_ALPHABET[randomIndex(DNA_ALPHABET.length, random)]
                : source[offset + index];
        }
    }
    return child;
}

export function growthMultiplierFor(ivs) {
    const total = IV_KEYS.reduce((sum, key) => sum + Number(ivs?.[key] || 0), 0);
    const average = clamp(total / IV_KEYS.length, 0, 100);
    return Number((1 + average * 0.0025).toFixed(3));
}

/** 不掷骰的繁育潜力预览，用于 UI 展示，不能替代实际子代生成。 */
export function previewChildPotential(parentA, parentB, { catalyst = null } = {}) {
    const eligible = canBreed(parentA, parentB);
    const attributeFloor = catalyst?.type === 'urAttributeLock' && IV_KEYS.includes(catalyst.attribute)
        ? catalyst.attribute
        : null;
    const ivRanges = Object.freeze(Object.fromEntries(IV_KEYS.map((key) => {
        const a = ivFor(parentA, key);
        const b = ivFor(parentB, key);
        const average = (a + b) / 2;
        const values = [a, b].map(main => clamp(Math.round(main * 0.65 + average * 0.35), 0, 100));
        const min = Math.max(0, Math.min(...values) - 5);
        return [key, Object.freeze({ min: key === attributeFloor ? Math.max(UR_CATALYST_ATTRIBUTE_FLOOR, min) : min, max: Math.min(100, Math.max(...values) + 5) })];
    })));
    const minIvs = Object.fromEntries(IV_KEYS.map(key => [key, ivRanges[key].min]));
    const maxIvs = Object.fromEntries(IV_KEYS.map(key => [key, ivRanges[key].max]));
    const ssrPair = qualityIdFor(parentA) === 'SSR' && qualityIdFor(parentB) === 'SSR';
    const mutationChance = ssrPair ? (catalyst?.type === 'ssrMutation' ? SSR_CATALYST_MUTATION_CHANCE : UR_MUTATION_CHANCE) : 0;
    return Object.freeze({
        eligible,
        ivRanges,
        growthMultiplier: Object.freeze({ min: growthMultiplierFor(minIvs), max: growthMultiplierFor(maxIvs) }),
        qualityId: inheritedQualityId(parentA, parentB),
        urMutationChance: mutationChance,
        hint: attributeFloor
            ? `${IV_KEYS.includes(attributeFloor) ? attributeFloor : '目标'}资质将不低于 ${UR_CATALYST_ATTRIBUTE_FLOOR}`
            : ssrPair ? `SSR × SSR：有 ${Math.round(mutationChance * 100)}% 概率发生 UR 基因突变` : '子代正常品质继承双亲最高品质，最高为 SSR',
    });
}

/**
 * 生成可直接存入蛋对象的繁育胚胎数据。
 * 无效双亲会抛错，避免 UI 或调用方绕过繁育门槛。
 */
export function generateChildEmbryo(parentA, parentB, { random = Math.random, catalyst = null } = {}) {
    if (!canBreed(parentA, parentB)) {
        throw new Error('Both parents must be distinct, unlocked, adult or elder pets at battle level 40.');
    }

    const attributeFloor = catalyst?.type === 'urAttributeLock' && IV_KEYS.includes(catalyst.attribute)
        ? catalyst.attribute
        : null;
    const mutationChance = catalyst?.type === 'ssrMutation' ? SSR_CATALYST_MUTATION_CHANCE : UR_MUTATION_CHANCE;
    const ivs = calculateChildIVs(parentA, parentB, { random, attributeFloor });
    const mutation = rollMutation(parentA, parentB, { random, mutationChance });
    const qualityId = mutation.triggered ? 'UR' : inheritedQualityId(parentA, parentB);
    const growthMultiplier = mutation.triggered ? mutation.growthMultiplier : growthMultiplierFor(ivs);
    return Object.freeze({
        dna: crossoverDna(parentA.dna, parentB.dna, { random }),
        qualityId,
        ivs,
        growthMultiplier,
        baseBattleMultiplier: mutation.triggered ? mutation.baseBattleMultiplier : 1,
        mutation,
        catalyst: catalyst?.type ? Object.freeze({ type: catalyst.type, ...(attributeFloor ? { attribute: attributeFloor } : {}) }) : null,
        parents: Object.freeze([parentA.id || null, parentB.id || null]),
    });
}