const STAT_KEYS = Object.freeze(['maxHp', 'maxMp', 'attack', 'defense', 'magic', 'luck']);
const MIN_MULTIPLIER = 0.915;
const MAX_MULTIPLIER = 1.085;

function hash(value) {
    let valueHash = 2166136261;
    for (const character of String(value || 'unknown')) {
        valueHash = Math.imul(valueHash ^ character.charCodeAt(0), 16777619) >>> 0;
    }
    return valueHash >>> 0;
}

function speciesKeyFor(pet) {
    return String(
        pet?.expeditionSpeciesId
        || pet?.famousPetId
        || pet?.speciesId
        || pet?.sourcePetId
        || pet?.traits?.species
        || pet?.dna
        || pet?.id
        || 'unknown',
    ).trim().toLowerCase();
}

function nextRandom(seed) {
    let value = seed >>> 0;
    value = Math.imul(value ^ (value >>> 16), 2246822507) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 3266489909) >>> 0;
    return [value >>> 0, ((value ^ (value >>> 16)) >>> 0) / 4294967296];
}

export function getSpeciesGrowthProfile(pet) {
    const speciesKey = speciesKeyFor(pet);
    let seed = hash(speciesKey);
    const multipliers = Object.fromEntries(STAT_KEYS.map((statName, index) => [
        statName,
        (() => {
            [seed] = nextRandom(seed + index + 1);
            const [, random] = nextRandom(seed);
            return Number((MIN_MULTIPLIER + (MAX_MULTIPLIER - MIN_MULTIPLIER) * random).toFixed(4));
        })(),
    ]));
    let fingerprint = hash(`${speciesKey}:fingerprint`);
    const adjustments = Object.fromEntries(STAT_KEYS.map(statName => {
        const adjustment = fingerprint % 11 - 5;
        fingerprint = Math.floor(fingerprint / 11);
        return [statName, adjustment];
    }));
    const specialty = STAT_KEYS.reduce((best, statName) => (
        multipliers[statName] > multipliers[best] ? statName : best
    ), STAT_KEYS[0]);
    return Object.freeze({
        speciesKey,
        multipliers: Object.freeze(multipliers),
        adjustments: Object.freeze(adjustments),
        specialty,
    });
}

const EXPEDITION_SPECIALTIES = Object.freeze({
    maxHp: { id: 'vanguard', icon: '🛡', name: '先锋体魄', description: '开局获得 8% 最大生命护盾', shieldPercentage: 0.08 },
    maxMp: { id: 'channel', icon: '✦', name: '能量通道', description: '开局魔力额外 +12%', initialMpBonus: 0.12 },
    attack: { id: 'strike', icon: '⚔', name: '锋芒直觉', description: '开局攻击额外 +4', attackBonus: 4 },
    defense: { id: 'bulwark', icon: '◈', name: '守御本能', description: '开局护甲额外 +3', armorBonus: 3 },
    magic: { id: 'restore', icon: '✚', name: '星辉修复', description: '治疗效果提升 10%', healingMultiplier: 1.10 },
    luck: { id: 'scout', icon: '⌁', name: '寻迹感知', description: '捕捉率额外 +3%', captureBonus: 0.03 },
});

export function getSpeciesExpeditionSpecialty(pet) {
    const profile = getSpeciesGrowthProfile(pet);
    return Object.freeze({
        specialty: profile.specialty,
        ...(EXPEDITION_SPECIALTIES[profile.specialty] || EXPEDITION_SPECIALTIES.maxHp),
    });
}

export function applySpeciesGrowthProfile(pet, qualityStats) {
    const profile = getSpeciesGrowthProfile(pet);
    return Object.fromEntries(STAT_KEYS.map(statName => [
        statName,
        Math.max(0, Math.round(Number(qualityStats?.[statName] || 0) * profile.multipliers[statName]) + profile.adjustments[statName]),
    ]));
}

export { MAX_MULTIPLIER, MIN_MULTIPLIER, STAT_KEYS };