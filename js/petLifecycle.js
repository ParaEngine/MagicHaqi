// 宠物生命周期与位置记录：当前星球、放养、哈奇岛、其它星球。
import { CONFIG } from './config.js';
import { decodeDna } from './dna.js';
import { localizeFieldName, localizeRoomName, t } from './i18n.js';
import { state } from './state.js';

export const MAX_PLANET_PETS = 10;
export const RELEASED_PET_FIELD_CHANCE = 0.9;
export const RELEASED_AUTO_CARE_STATS = { hunger: 85, mood: 85, clean: 90, bond: 85 };

// ===== 星球「自我照料能力」selfCare（取值区间 [0,1]）=====
// selfCare 描述这颗星球的宠物有多能照顾自己，决定养成数值衰减得有多慢：
//   0    —— 常规养成，几乎每天都要照料（当前默认行为）。
//   0.7  —— 大约一周照料一次即可。
//   1    —— 完全自给自足：永不衰减，数值锁定在 ~80%，永不生病、不形成创伤
//           （给大人玩的零压力星球）。
// 衰减倍率采用 decayMultiplier = (1 - selfCare) ** SELF_CARE_DECAY_EXP 曲线，
// 使「照料间隔 ≈ 1 / decayMultiplier 天」：
//   selfCare 0   → 倍率 1.000 → ~1 天
//   selfCare 0.3 → 倍率 0.573 → ~1.7 天
//   selfCare 0.5 → 倍率 0.330 → ~3 天
//   selfCare 0.7 → 倍率 0.143 → ~7 天
//   selfCare 0.9 → 倍率 0.025 → ~40 天
//   selfCare 1   → 倍率 0     → 永不衰减
export const PLANET_SELF_CARE_STATS = { hunger: 80, mood: 80, clean: 80, bond: 80 };
const SELF_CARE_DECAY_EXP = 1.6;

/** 读取当前所在星球的 selfCare 值，规范化到 [0,1]，缺省为 0。 */
export function getCurrentPlanetSelfCare() {
    const raw = Number(state?.settings?.starSettlement?.selfCare);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(1, raw));
}

/** selfCare === 1 时为完全自给自足（零压力）：永不衰减、锁定数值、不生病不创伤。 */
export function isCurrentPlanetSelfCare() {
    return getCurrentPlanetSelfCare() >= 1;
}

/**
 * 当前星球的衰减倍率（0~1）：1 表示常规速度，0 表示完全不衰减。
 * 同时用作生病 / 创伤等负面效果的概率缩放系数。
 */
export function currentPlanetDecayMultiplier() {
    const selfCare = getCurrentPlanetSelfCare();
    if (selfCare <= 0) return 1;
    if (selfCare >= 1) return 0;
    return Math.pow(1 - selfCare, SELF_CARE_DECAY_EXP);
}

/** 把宠物所有养成数值锁定在自我照料星球的目标值（~80%）。返回是否有变化。 */
export function applyPlanetSelfCareStats(pet) {
    const stats = pet?.stats && typeof pet.stats === 'object' ? pet.stats : (pet ? (pet.stats = {}) : null);
    if (!stats) return false;
    let changed = false;
    for (const [key, targetValue] of Object.entries(PLANET_SELF_CARE_STATS)) {
        const target = clampStatValue(targetValue);
        if (stats[key] !== target) {
            stats[key] = target;
            changed = true;
        }
    }
    return changed;
}
const RELEASED_PET_RELOCATE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_PLACEMENT_SEED = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
const GENERATED_LOCATION_CACHE = new Map();
let GENERATED_NEAR_ACTIVE_KEY = '';
let GENERATED_NEAR_ACTIVE_IDS = [];
let GENERATED_NEAR_ACTIVE_FIELD = '';
let GENERATED_NEAR_ACTIVE_READY = false;

const REMOTE_DESTINATIONS = {
    firebird: { id: 'firebird', name: '火鸟岛', emoji: '🔥', field: 'fire' },
    ice: { id: 'ice', name: '寒冰岛', emoji: '🧊', field: 'ice' },
    desert: { id: 'desert', name: '沙漠岛', emoji: '🏝️', field: 'life' },
    shadow: { id: 'shadow', name: '幽暗岛', emoji: '🌙', field: 'dark' },
    thunder: { id: 'thunder', name: '雷云岛', emoji: '⚡', field: 'thunder' },
    friend: { id: 'friend', name: '远方星球', emoji: '🪐', field: 'land' },
};

const ATTRIBUTE_DESTINATION = {
    火: REMOTE_DESTINATIONS.firebird,
    冰: REMOTE_DESTINATIONS.ice,
    生命: REMOTE_DESTINATIONS.desert,
    暗: REMOTE_DESTINATIONS.shadow,
    雷: REMOTE_DESTINATIONS.thunder,
};

const TRAIT_DESTINATION = {
    dragonLike: REMOTE_DESTINATIONS.firebird,
    fishLike: REMOTE_DESTINATIONS.ice,
    fruitLike: REMOTE_DESTINATIONS.desert,
    rabbitLike: REMOTE_DESTINATIONS.desert,
    catLike: REMOTE_DESTINATIONS.shadow,
    birdLike: REMOTE_DESTINATIONS.firebird,
    sweetLike: REMOTE_DESTINATIONS.friend,
};

const TRAIT_FIELD_PREFS = {
    catLike: ['land', 'dark', 'life'],
    rabbitLike: ['land', 'life'],
    fishLike: ['water', 'ice'],
    birdLike: ['sky', 'fire'],
    dragonLike: ['fire', 'sky', 'land'],
    sweetLike: ['life', 'land', 'sky'],
    fruitLike: ['life', 'land'],
};

const ATTRIBUTE_FIELD_PREFS = {
    火: ['fire', 'land', 'sky'],
    冰: ['ice', 'water'],
    生命: ['life', 'land'],
    暗: ['dark', 'land'],
    雷: ['thunder', 'sky'],
};

const TRAIT_ROOM_PREFS = {
    catLike: ['living', 'bedroom', 'garden'],
    rabbitLike: ['garden', 'living'],
    fishLike: ['bath', 'garden'],
    birdLike: ['garden', 'living'],
    dragonLike: ['kitchen', 'living'],
    sweetLike: ['living', 'bedroom', 'kitchen'],
    fruitLike: ['garden', 'kitchen'],
};

const ATTRIBUTE_ROOM_PREFS = {
    火: ['kitchen', 'living'],
    冰: ['bath', 'bedroom'],
    生命: ['garden', 'living'],
    暗: ['bedroom', 'living'],
    雷: ['living', 'garden'],
};

export function getPlanetPetLimit() {
    return MAX_PLANET_PETS;
}

export function getPetLocationType(pet) {
    const type = pet?.location?.type || pet?.status || 'home';
    if (type === 'released' || type === 'haqiIsland' || type === 'remotePlanet') return type;
    return 'home';
}

function petRefId(petOrId) {
    return typeof petOrId === 'string' ? petOrId : petOrId?.id;
}

function useGeneratedLocation(petOrId) {
    const id = petRefId(petOrId);
    return !!id && id !== state.currentPetId;
}

export function getNearActiveGeneratedPetIds(limit = 2) {
    const currentId = state.currentPetId;
    if (!currentId) return [];
    const ids = (state.petOrder || []).filter(id => id && id !== currentId);
    const count = Math.max(0, Number(limit) || 0);
    if (GENERATED_NEAR_ACTIVE_READY) return GENERATED_NEAR_ACTIVE_IDS.slice(0, count);
    const key = `${currentId || ''}::${count}::${ids.join('|')}`;
    if (key === GENERATED_NEAR_ACTIVE_KEY) return GENERATED_NEAR_ACTIVE_IDS.slice(0, count);
    const pool = ids.slice();
    for (let index = pool.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    GENERATED_NEAR_ACTIVE_KEY = key;
    GENERATED_NEAR_ACTIVE_IDS = pool.slice(0, count);
    GENERATED_NEAR_ACTIVE_FIELD = state.currentField || GENERATED_NEAR_ACTIVE_FIELD || 'land';
    GENERATED_NEAR_ACTIVE_READY = true;
    return GENERATED_NEAR_ACTIVE_IDS.slice();
}

function getNearActiveGeneratedPetField() {
    getNearActiveGeneratedPetIds(2);
    return GENERATED_NEAR_ACTIVE_FIELD || state.currentField || '1';
}

export function isNearActiveGeneratedPet(petOrId) {
    const id = petRefId(petOrId);
    return !!id && getNearActiveGeneratedPetIds(2).includes(id);
}

function clampStatValue(value) {
    return Math.max(CONFIG.statMin, Math.min(CONFIG.statMax, Number(value) || 0));
}

function clearBodyState(pet) {
    if (!pet) return;
    delete pet.sickness;
    delete pet.lastSicknessCuredAt;
    delete pet.sicknessCooldownUntil;
    delete pet.lastSicknessCheckDay;
}

export function applyReleasedPetAutoCareStats(pet) {
    if (!pet || getPetLocationType(pet) !== 'released') return false;
    const stats = pet.stats && typeof pet.stats === 'object' ? pet.stats : (pet.stats = {});
    let changed = false;
    for (const [key, targetValue] of Object.entries(RELEASED_AUTO_CARE_STATS)) {
        const target = clampStatValue(targetValue);
        if (stats[key] !== target) {
            stats[key] = target;
            changed = true;
        }
    }
    return changed;
}

export function getRuntimePetStats(pet) {
    if (pet?.id && pet.id !== state.currentPetId) {
        return {
            ...(pet.stats && typeof pet.stats === 'object' ? pet.stats : {}),
            hunger: CONFIG.statMax,
            mood: CONFIG.statMax,
            clean: CONFIG.statMax,
            bond: CONFIG.statMax,
        };
    }
    applyReleasedPetAutoCareStats(pet);
    return pet?.stats || {};
}

export function isPetOnCurrentPlanet(pet) {
    if (useGeneratedLocation(pet)) return true;
    const type = getPetLocationType(pet);
    return type === 'home' || type === 'released';
}

export function isPetSelectable(pet) {
    return getPetLocationType(pet) === 'home';
}

export function getPetFindTarget(pet) {
    if (useGeneratedLocation(pet)) {
        const home = getGeneratedPetLocation(pet);
        return home.kind === 'field'
            ? { kind: 'field', id: home.id }
            : { kind: 'room', id: home.id };
    }
    if (!isPetOnCurrentPlanet(pet)) return null;
    if (getPetLocationType(pet) === 'released') {
        const home = getReleasedPetHome(pet);
        return home.kind === 'field'
            ? { kind: 'field', id: home.id }
            : { kind: 'room', id: home.id };
    }
    return { kind: 'room', id: pet?.activeRoom || 'living' };
}

export function getGeneratedPetLocation(petOrId, now = Date.now()) {
    const id = petRefId(petOrId) || 'pet';
    const cached = GENERATED_LOCATION_CACHE.get(id);
    if (cached) return cached;
    const bucket = Math.floor(now / RELEASED_PET_RELOCATE_MS);
    const rng = Math.random;
    if (isNearActiveGeneratedPet(id)) {
        const home = {
            kind: 'field',
            id: getNearActiveGeneratedPetField(),
            nearActive: true,
            x: round3(0.42 + rng() * 0.16),
            y: round3(0.56 + rng() * 0.12),
            delay: round2(-(rng() * 4)),
            dur: round2(8 + rng() * 4),
            dx: round1(-7 + rng() * 14),
            dy: round1(-5 + rng() * 10),
            assignedUntil: (bucket + 1) * RELEASED_PET_RELOCATE_MS,
        };
        GENERATED_LOCATION_CACHE.set(id, home);
        return home;
    }
    if (rng() < RELEASED_PET_FIELD_CHANCE) {
        const fieldId = weightedPick(rng, [], ['land', 'water', 'sky']);
        const home = {
            kind: 'field',
            id: fieldId,
            x: round3(0.14 + rng() * 0.72),
            // 底部预留空间，避免与底部等级条 UI 重叠（max y ≈ 0.68）。
            y: round3(0.40 + rng() * 0.28),
            delay: round2(-(rng() * 8)),
            dur: round2(9 + rng() * 7),
            dx: round1(-28 + rng() * 56),
            dy: round1(-18 + rng() * 34),
            assignedUntil: (bucket + 1) * RELEASED_PET_RELOCATE_MS,
        };
        GENERATED_LOCATION_CACHE.set(id, home);
        return home;
    }
    const roomId = weightedPick(rng, [], CONFIG.rooms.map(room => room.id));
    const home = {
        kind: 'room',
        id: roomId,
        xMeters: round2(0.8 + rng() * 7.2),
        yMeters: round2(1.18 + rng() * 0.95),
        face: rng() < 0.5 ? 'left' : 'right',
        assignedUntil: (bucket + 1) * RELEASED_PET_RELOCATE_MS,
    };
    GENERATED_LOCATION_CACHE.set(id, home);
    return home;
}

export function getHomePetRoomPose(pet, roomId = null) {
    const id = roomId || pet?.activeRoom || 'living';
    const rng = makeRng(`${pet?.id || 'pet'}::${id}::home-room-pose`);
    return {
        kind: 'room',
        id,
        xMeters: round2(0.8 + rng() * 7.2),
        yMeters: round2(1.18 + rng() * 0.95),
        face: rng() < 0.5 ? 'left' : 'right',
    };
}

export function hasRenderablePetTexture(pet) {
    return !!(pet?.imageSheetUrl || pet?.imageUrl);
}

// 深圳动物园：每只领养动物绑定到对应的园区场景
// animalId（图鉴中的 id）→ 场景 slot 编号
const ZOO_PET_FIELD_MAP = {
    south_china_tiger: '2',  // 猛兽谷
    giant_panda: '3',        // 熊猫竹林
    red_panda: '6',          // 雨林溪谷
    giraffe: '4',            // 长颈鹿草原
    penguin: '5',            // 企鹅冰湾
};

function getZooPetFieldId(pet) {
    if (!pet) return null;
    const zooId = String(pet.adoptedFromZoo || '').trim();
    const animalId = String(pet.adoptedFromAnimal || '').trim();
    if (zooId !== 'shenzhen_zoo' || !animalId) return null;
    return ZOO_PET_FIELD_MAP[animalId] || null;
}

export function canPetAppearInField(pet, fieldId = null) {
    // 深圳动物园宠物：只在指定园区出现
    const zooFieldId = getZooPetFieldId(pet);
    if (zooFieldId) return !fieldId || fieldId === zooFieldId;
    if (useGeneratedLocation(pet)) {
        const home = getGeneratedPetLocation(pet);
        return home.kind === 'field' && (!fieldId || home.id === fieldId);
    }
    if (!isPetOnCurrentPlanet(pet)) return false;
    if (getPetLocationType(pet) !== 'released') return true;
    if (!hasRenderablePetTexture(pet)) return false;
    const home = getReleasedPetHome(pet);
    return home.kind === 'field' && (!fieldId || home.id === fieldId);
}

export function localPlanetPets(pets) {
    return (pets || []).filter(isPetOnCurrentPlanet);
}

export function selectablePets(pets) {
    return (pets || []).filter(isPetSelectable);
}

export function getPetBirthday(pet) {
    const bornAt = Number(pet?.bornAt) || Date.now();
    const date = new Date(bornAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

export function getCompanionDays(pet, now = Date.now()) {
    const bornAt = Number(pet?.bornAt) || now;
    return Math.max(1, Math.floor((now - bornAt) / 86400000) + 1);
}

export function getPetLocationInfo(pet, planetName = '宠物星') {
    if (useGeneratedLocation(pet)) {
        const home = getGeneratedPetLocation(pet);
        if (home.kind === 'field') {
            const field = CONFIG.fields.find(item => item.id === home.id);
            return {
                type: 'generatedField',
                label: t('petLocationGeneratedField', { planet: planetName || t('planetFallback'), field: field ? localizeFieldName(field.id) : t('zoomField') }),
                detail: t('petLocationGeneratedDetail'),
                tone: '#0f766e',
            };
        }
        const room = CONFIG.rooms.find(item => item.id === home.id);
        return {
            type: 'generatedRoom',
            label: room ? localizeRoomName(room.id) : t('rooms'),
            detail: t('petLocationGeneratedDetail'),
            tone: '#d97706',
        };
    }
    const type = getPetLocationType(pet);
    const location = pet?.location || {};
    if (type === 'released') {
        return {
            type,
            label: location.name || t('petLocationReleased', { planet: planetName || t('planetFallback') }),
            detail: t('petLocationReleasedDetail'),
            tone: '#0f766e',
        };
    }
    if (type === 'haqiIsland') {
        return {
            type,
            label: t('lpHaqiIsland'),
            detail: t('petLocationHaqiDetail'),
            tone: '#7c3aed',
        };
    }
    if (type === 'remotePlanet') {
        return {
            type,
            label: location.name || t('petLocationRemote'),
            detail: location.reason === 'capacity' ? t('petLocationRemoteCapacity') : t('petLocationRemoteLiving'),
            tone: '#2563eb',
        };
    }
    return {
        type: 'home',
        label: planetName || t('planetFallback'),
        detail: t('petLocationHomeDetail'),
        tone: '#d97706',
    };
}

export function markPetReleased(pet, planetName = '宠物星') {
    if (!pet) return null;
    const now = Date.now();
    clearBodyState(pet);
    pet.status = 'released';
    pet.location = {
        type: 'released',
        planetId: 'user',
        name: t('petLocationReleased', { planet: planetName || t('planetFallback') }),
        releasedAt: now,
        canRecall: false,
    };
    pet.releasedAt = now;
    return pet.location;
}

export function markPetHaqiIsland(pet) {
    if (!pet) return null;
    const now = Date.now();
    clearBodyState(pet);
    pet.status = 'haqiIsland';
    pet.location = {
        type: 'haqiIsland',
        planetId: 'haqi',
        name: t('lpHaqiIsland'),
        movedAt: now,
        canRecall: false,
    };
    pet.haqiIslandAt = now;
    return pet.location;
}

export function markPetRemoteExiled(pet, reason = 'capacity') {
    if (!pet) return null;
    const now = Date.now();
    const destination = chooseRemoteDestination(pet);
    clearBodyState(pet);
    pet.status = 'remotePlanet';
    pet.location = {
        type: 'remotePlanet',
        planetId: destination.id,
        id: destination.id,
        name: destination.name,
        emoji: destination.emoji,
        reason,
        movedAt: now,
        canRecall: false,
    };
    pet.remotePlanetAt = now;
    return pet.location;
}

function caretakerConfig() {
    return CONFIG.hatchingCare || {};
}

export function getNannyCareCost(days = 1) {
    const cfg = caretakerConfig();
    const maxDays = Math.max(1, Number(cfg.maxDays) || 2);
    const safeDays = Math.max(1, Math.min(maxDays, Math.round(Number(days) || 1)));
    return safeDays * Math.max(0, Number(cfg.costPerDay) || 100);
}

export function getNannyCareRemainingMs(pet, now = Date.now()) {
    if (pet?.hatchingCare?.mode !== 'nanny') return 0;
    const until = Number(pet.hatchingCare.until);
    return Number.isFinite(until) ? Math.max(0, until - now) : 0;
}

export function formatNannyCareRemaining(pet, now = Date.now()) {
    const remaining = getNannyCareRemainingMs(pet, now);
    if (remaining <= 0) return '0小时';
    const hours = Math.max(1, Math.ceil(remaining / 3600000));
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const restHours = hours % 24;
        return restHours ? `${days}天${restHours}小时` : `${days}天`;
    }
    return `${hours}小时`;
}

export function getNannyCareEligibility(pet) {
    const cfg = caretakerConfig();
    const stats = pet?.stats || {};
    const keys = ['hunger', 'mood', 'clean', 'bond'];
    const average = keys.reduce((sum, key) => sum + (Number(stats[key]) || 0), 0) / keys.length;
    const minAverage = Number(cfg.minStatAverage) || 50;
    const minMood = Number(cfg.minMood) || 50;
    const minHunger = Number(cfg.minHunger) || 50;
    const mood = Number(stats.mood) || 0;
    const hunger = Number(stats.hunger) || 0;
    const reasons = [];
    if (average <= minAverage) reasons.push(`整体状态平均值需要高于 ${minAverage}`);
    if (mood <= minMood) reasons.push(`心情需要高于 ${minMood}`);
    if (hunger <= minHunger) reasons.push(`体力需要高于 ${minHunger}`);
    return { ok: reasons.length === 0, reasons, average, mood, hunger };
}

export function hireNannyForPet(pet, days = 1, now = Date.now()) {
    if (!pet) return null;
    const cfg = caretakerConfig();
    const maxDays = Math.max(1, Number(cfg.maxDays) || 2);
    const safeDays = Math.max(1, Math.min(maxDays, Math.round(Number(days) || 1)));
    pet.hatchingCare = {
        mode: 'nanny',
        hiredAt: now,
        updatedAt: now,
        until: now + safeDays * DAY_MS,
        days: safeDays,
        costCoins: getNannyCareCost(safeDays),
        growthRate: Math.max(0.1, Number(cfg.growthRate) || 0.45),
        statProfile: 'average',
    };
    softenStatsToAverage(pet);
    return pet.hatchingCare;
}

export function hasNannyCare(pet, now = Date.now()) {
    return getNannyCareRemainingMs(pet, now) > 0;
}

export function nannyGrowthRate(pet, now = Date.now()) {
    return hasNannyCare(pet, now) ? Math.max(0.1, Number(pet.hatchingCare?.growthRate) || caretakerConfig().growthRate || 0.45) : 1;
}

export function softenStatsToAverage(pet) {
    if (!pet) return;
    if (!pet.stats) pet.stats = {};
    const cfg = caretakerConfig();
    const foodOnlyEnergyStage = pet.stage === 'egg';
    const target = {
        hunger: Number(cfg.targetHunger) || 66,
        mood: Number(cfg.targetMood) || 62,
    };
    for (const key of Object.keys(target)) {
        if (key === 'hunger' && foodOnlyEnergyStage) continue;
        pet.stats[key] = target[key];
        pet.stats[key] = Math.max(CONFIG.statMin, Math.min(CONFIG.statMax, pet.stats[key]));
    }
}

export function suggestFieldForPet(pet) {
    const prefs = fieldPreferencesForPet(pet);
    if (prefs.length) return prefs[0];
    const dnaTraits = decodeDna(pet?.dna || '');
    if (dnaTraits.element === '水系') return 'water';
    if (dnaTraits.element === '天空') return 'sky';
    return 'land';
}

export function getReleasedPetHome(pet) {
    return createReleasedPetHome(pet);
}

export function isReleasedPetInField(pet, fieldId) {
    if (getPetLocationType(pet) !== 'released') return false;
    const home = getReleasedPetHome(pet);
    return home.kind === 'field' && home.id === fieldId;
}

export function isReleasedPetInRoom(pet, roomId) {
    if (getPetLocationType(pet) !== 'released') return false;
    const home = getReleasedPetHome(pet);
    return home.kind === 'room' && home.id === roomId;
}

export function createReleasedPetHome(pet, now = Date.now()) {
    const bucket = Math.floor(now / RELEASED_PET_RELOCATE_MS);
    const rng = makeRng(`${SESSION_PLACEMENT_SEED}::${bucket}::${pet?.id || 'pet'}::released-home`);
    const useField = rng() < RELEASED_PET_FIELD_CHANCE;
    if (useField) {
        const fieldId = weightedPick(rng, fieldPreferencesForPet(pet), ['land', 'water', 'sky']);
        return {
            kind: 'field',
            id: fieldId,
            x: round3(0.14 + rng() * 0.72),
            y: round3(0.42 + rng() * 0.32),
            delay: round2(-(rng() * 8)),
            dur: round2(9 + rng() * 7),
            dx: round1(-28 + rng() * 56),
            dy: round1(-18 + rng() * 34),
            assignedUntil: (bucket + 1) * RELEASED_PET_RELOCATE_MS,
        };
    }
    const roomId = weightedPick(rng, roomPreferencesForPet(pet), CONFIG.rooms.map(room => room.id));
    return {
        kind: 'room',
        id: roomId,
        xMeters: round2(0.8 + rng() * 7.2),
        yMeters: round2(1.18 + rng() * 0.95),
        face: rng() < 0.5 ? 'left' : 'right',
        assignedUntil: (bucket + 1) * RELEASED_PET_RELOCATE_MS,
    };
}

function fieldPreferencesForPet(pet) {
    const dnaTraits = decodeDna(pet?.dna || '');
    const attribute = pet?.traits?.elementalAttribute || dnaTraits.elementalAttribute;
    const topTrait = topTraitId(pet);
    const prefs = [
        ...(ATTRIBUTE_FIELD_PREFS[attribute] || []),
        ...(TRAIT_FIELD_PREFS[topTrait] || []),
    ];
    if (dnaTraits.element === '水系') prefs.push('water');
    else if (dnaTraits.element === '天空') prefs.push('sky');
    else prefs.push('land');
    return unique(prefs);
}

function roomPreferencesForPet(pet) {
    const dnaTraits = decodeDna(pet?.dna || '');
    const attribute = pet?.traits?.elementalAttribute || dnaTraits.elementalAttribute;
    const topTrait = topTraitId(pet);
    return unique([
        ...(ATTRIBUTE_ROOM_PREFS[attribute] || []),
        ...(TRAIT_ROOM_PREFS[topTrait] || []),
        'living',
        'garden',
        'bedroom',
    ]).filter(id => CONFIG.rooms.some(room => room.id === id));
}

function topTraitId(pet) {
    return Object.entries(pet?.traits || {})
        .filter(([, value]) => Number(value) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || '';
}

function weightedPick(rng, preferred, fallback) {
    const pool = preferred?.length ? preferred : fallback;
    if (!pool.length) return '';
    const preferredHit = preferred?.length && rng() < 0.72;
    const choices = preferredHit ? preferred : fallback;
    return choices[Math.floor(rng() * choices.length) % choices.length] || pool[0];
}

function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function hashString(value) {
    const str = String(value || 'MagicHaqi');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function makeRng(seedText) {
    let seed = hashString(seedText) || 1;
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function round1(value) { return Math.round(value * 10) / 10; }
function round2(value) { return Math.round(value * 100) / 100; }
function round3(value) { return Math.round(value * 1000) / 1000; }

export function chooseRemoteDestination(pet) {
    const dnaTraits = decodeDna(pet?.dna || '');
    const attribute = pet?.traits?.elementalAttribute || dnaTraits.elementalAttribute;
    if (ATTRIBUTE_DESTINATION[attribute]) return ATTRIBUTE_DESTINATION[attribute];
    const topTrait = Object.entries(pet?.traits || {})
        .filter(([, value]) => Number(value) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
    return TRAIT_DESTINATION[topTrait] || REMOTE_DESTINATIONS.friend;
}
