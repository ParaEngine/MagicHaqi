// 宠物生命周期与位置记录：当前星球、放养、哈奇岛、其它星球。
import { CONFIG } from './config.js';
import { decodeDna } from './dna.js';

export const MAX_PLANET_PETS = 10;
export const RELEASED_PET_FIELD_CHANCE = 0.9;
const RELEASED_PET_RELOCATE_MS = 10 * 60 * 1000;
const SESSION_PLACEMENT_SEED = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

const REMOTE_DESTINATIONS = {
    firebird: { id: 'firebird', name: '火鸟岛', emoji: '🔥', field: 'fire' },
    ice: { id: 'ice', name: '寒冰岛', emoji: '🧊', field: 'ice' },
    desert: { id: 'desert', name: '沙漠岛', emoji: '🏝️', field: 'life' },
    shadow: { id: 'shadow', name: '幽暗岛', emoji: '🌙', field: 'dark' },
    friend: { id: 'friend', name: '远方星球', emoji: '🪐', field: 'land' },
};

const ATTRIBUTE_DESTINATION = {
    火: REMOTE_DESTINATIONS.firebird,
    冰: REMOTE_DESTINATIONS.ice,
    生命: REMOTE_DESTINATIONS.desert,
    暗: REMOTE_DESTINATIONS.shadow,
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
};

export function getPlanetPetLimit() {
    return MAX_PLANET_PETS;
}

export function getPetLocationType(pet) {
    const type = pet?.location?.type || pet?.status || 'home';
    if (type === 'released' || type === 'haqiIsland' || type === 'remotePlanet') return type;
    return 'home';
}

export function isPetOnCurrentPlanet(pet) {
    const type = getPetLocationType(pet);
    return type === 'home' || type === 'released';
}

export function isPetSelectable(pet) {
    return getPetLocationType(pet) === 'home';
}

export function getPetFindTarget(pet) {
    if (!isPetOnCurrentPlanet(pet)) return null;
    if (getPetLocationType(pet) === 'released') {
        const home = getReleasedPetHome(pet);
        return home.kind === 'field'
            ? { kind: 'field', id: home.id }
            : { kind: 'room', id: home.id };
    }
    return { kind: 'room', id: pet?.activeRoom || 'living' };
}

export function hasRenderablePetTexture(pet) {
    return !!(pet?.imageSheetUrl || pet?.imageUrl);
}

export function canPetAppearInField(pet, fieldId = null) {
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
    const type = getPetLocationType(pet);
    const location = pet?.location || {};
    if (type === 'released') {
        return {
            type,
            label: location.name || `${planetName} · 放养区`,
            detail: '放养后不可召回，会继续在星球中成长',
            tone: '#0f766e',
        };
    }
    if (type === 'haqiIsland') {
        return {
            type,
            label: '哈奇岛',
            detail: '已完成成人礼，可在哈奇岛手帐中回看',
            tone: '#7c3aed',
        };
    }
    if (type === 'remotePlanet') {
        return {
            type,
            label: location.name || '其它星球',
            detail: location.reason === 'capacity' ? '星球容量已满，系统自动流放' : '正在其它星球生活',
            tone: '#2563eb',
        };
    }
    return {
        type: 'home',
        label: planetName || '宠物星',
        detail: '可照看与切换',
        tone: '#d97706',
    };
}

export function markPetReleased(pet, planetName = '宠物星') {
    if (!pet) return null;
    const now = Date.now();
    pet.status = 'released';
    pet.location = {
        type: 'released',
        planetId: 'user',
        name: `${planetName || '宠物星'} · 放养区`,
        releasedAt: now,
        canRecall: false,
    };
    pet.releasedAt = now;
    return pet.location;
}

export function markPetHaqiIsland(pet) {
    if (!pet) return null;
    const now = Date.now();
    pet.status = 'haqiIsland';
    pet.location = {
        type: 'haqiIsland',
        planetId: 'haqi',
        name: '哈奇岛',
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

export function hireNannyForPet(pet) {
    if (!pet) return null;
    const now = Date.now();
    pet.hatchingCare = {
        ...(pet.hatchingCare || {}),
        mode: 'nanny',
        hiredAt: pet.hatchingCare?.hiredAt || now,
        updatedAt: now,
        growthRate: 0.45,
        statProfile: 'average',
    };
    softenStatsToAverage(pet);
    return pet.hatchingCare;
}

export function hasNannyCare(pet) {
    return pet?.hatchingCare?.mode === 'nanny';
}

export function nannyGrowthRate(pet) {
    return hasNannyCare(pet) ? Math.max(0.1, Number(pet.hatchingCare?.growthRate) || 0.45) : 1;
}

export function softenStatsToAverage(pet) {
    if (!pet) return;
    if (!pet.stats) pet.stats = {};
    const target = { hunger: 66, mood: 62, clean: 66, energy: 64, health: 72, intel: 18, bond: 32 };
    for (const key of Object.keys(target)) {
        const current = Number(pet.stats[key]);
        pet.stats[key] = Number.isFinite(current)
            ? Math.round(current * 0.45 + target[key] * 0.55)
            : target[key];
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
