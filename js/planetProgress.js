import { state } from './state.js';
import { isAdultStage } from './dna.js';
import { isPetOnCurrentPlanet } from './petLifecycle.js';

export const PLANET_MAX_LEVEL = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const LEVEL_THRESHOLDS = [0, 8, 18, 34, 54, 78, 108, 142, 180, 224, 274];
const STAGE_SCORE = { egg: 0, baby: 1, teen: 2, adult: 4, elder: 5 };

function localDateOrdinal(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return null;
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export function ensurePlanetProgressStarted(now = Date.now()) {
    if (!Number.isFinite(state.planetCreatedAt) || state.planetCreatedAt <= 0) state.planetCreatedAt = now;
    if (!Number.isFinite(state.totalPlayMs) || state.totalPlayMs < 0) state.totalPlayMs = 0;
    state.playSessionStartedAt = now;
}

export function getTrackedPlayMs(now = Date.now()) {
    const stored = Number.isFinite(state.totalPlayMs) ? state.totalPlayMs : 0;
    const sessionStart = Number.isFinite(state.playSessionStartedAt) ? state.playSessionStartedAt : now;
    return stored + Math.max(0, now - sessionStart);
}

export function flushPlanetPlaytime(now = Date.now()) {
    const sessionStart = Number.isFinite(state.playSessionStartedAt) ? state.playSessionStartedAt : now;
    const elapsed = Math.max(0, now - sessionStart);
    state.totalPlayMs = Math.max(0, (Number.isFinite(state.totalPlayMs) ? state.totalPlayMs : 0) + elapsed);
    state.playSessionStartedAt = now;
    return state.totalPlayMs;
}

export function getPlanetDayNumber(now = Date.now()) {
    const createdAt = Number.isFinite(state.planetCreatedAt) && state.planetCreatedAt > 0 ? state.planetCreatedAt : now;
    const birthdayOrdinal = localDateOrdinal(createdAt);
    const todayOrdinal = localDateOrdinal(now);
    if (birthdayOrdinal == null || todayOrdinal == null) return 1;
    return Math.max(1, todayOrdinal - birthdayOrdinal + 1);
}

export function getHatchedPetCount() {
    return Object.values(state.pets || {}).filter(pet => pet && isPetOnCurrentPlanet(pet) && pet.stage !== 'egg').length;
}

export function getGrownUpPetCount() {
    return Object.values(state.pets || {}).filter(pet => pet && isPetOnCurrentPlanet(pet) && isAdultStage(pet.stage)).length;
}

export function computePlanetProgress(now = Date.now()) {
    const pets = Object.values(state.pets || {}).filter(pet => pet && isPetOnCurrentPlanet(pet));
    const petCount = pets.length;
    const hatchedPetCount = getHatchedPetCount();
    const grownUpPetCount = getGrownUpPetCount();
    const stageScore = pets.reduce((sum, pet) => sum + (STAGE_SCORE[pet.stage] ?? 0), 0);
    const statScore = pets.reduce((sum, pet) => {
        const stats = pet.stats || {};
        return sum + ['hunger', 'mood', 'clean', 'bond']
            .reduce((inner, key) => inner + Math.max(0, Math.min(100, Number(stats[key]) || 0)), 0) / 400;
    }, 0);
    const inventoryEntries = Object.entries(state.inventory || {}).filter(([, count]) => Number(count) > 0);
    const itemCount = inventoryEntries.reduce((sum, [, count]) => sum + Math.max(0, Number(count) || 0), 0);
    const uniqueItemCount = inventoryEntries.length;
    const placedItemCount = Object.values(state.layouts || {}).reduce((sum, roomItems) => {
        return sum + (Array.isArray(roomItems) ? roomItems.length : 0);
    }, 0);
    const planetDays = getPlanetDayNumber(now);
    const playHours = getTrackedPlayMs(now) / HOUR_MS;
    const coinScore = Math.min(12, Math.max(0, Number(state.coins) || 0) / 20);

    const score =
        petCount * 8 +
        hatchedPetCount * 10 +
        stageScore * 4 +
        statScore * 5 +
        uniqueItemCount * 1.5 +
        itemCount * 0.8 +
        placedItemCount * 1.2 +
        Math.min(36, planetDays * 3) +
        Math.min(36, playHours * 2) +
        coinScore;

    let level = 0;
    for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
        if (score >= LEVEL_THRESHOLDS[i]) level = i;
    }
    level = Math.max(0, Math.min(PLANET_MAX_LEVEL, level));
    const currentThreshold = LEVEL_THRESHOLDS[level] ?? 0;
    const nextThreshold = LEVEL_THRESHOLDS[level + 1] ?? currentThreshold;
    const progressToNext = level >= PLANET_MAX_LEVEL
        ? 1
        : Math.max(0, Math.min(1, (score - currentThreshold) / Math.max(1, nextThreshold - currentThreshold)));

    return {
        level,
        score,
        progressToNext,
        planetDays,
        petCount,
        hatchedPetCount,
        grownUpPetCount,
        moonCount: grownUpPetCount,
        canVisitHaqiIsland: hatchedPetCount >= 1 && level > 2,
    };
}
