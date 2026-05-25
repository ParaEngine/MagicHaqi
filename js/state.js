// 全局状态
import { CONFIG } from './config.js';

export const state = {
    sdk: null,
    user: null,                 // { id, username, ... }
    isPaid: CONFIG.defaultIsPaid,
    coins: CONFIG.initialCoins,
    pets: {},                   // id -> pet 对象
    petOrder: [],               // [petId]
    currentPetId: null,
    currentView: 'login',
    currentRoom: 'living',
    // 4-level zoom dial
    // 0 = Space (cosmic) | 1 = Field (planet surface) | 2 = pet | 3 = Cell
    // Game boots into the cosmic / space view, then remembers the last home level in memory.
    zoomLevel: 0,
    lastHomeZoomLevel: 0,
    currentField: '1',          // terrain slot index as string: '1'..'7'
    isDecorMode: false,
    isFeedMode: false,
    activePetFieldPose: null,
    activePetRoomPose: null,
    activePetRoomFocusPose: null,
    biofuel: 0,                 // recycled from pet poop, used for "space travel"
    inventory: {},              // runtime map { itemId: count }; storage uses ordered arrays
    inventoryOrder: [],         // user-defined display order, persisted in user/inventory.json
    layouts: {},                // user shared { roomId: [{ itemId, x, y, zorder }] }
    actionCooldown: {},         // petId -> { actionKey: timestamp }
    settings: {},
    temporaryHomePlanetOverride: null,
    // 玩家"星球"名字。每位用户只有一个星球；首次进入游戏时必须命名。
    planetName: '',
    planetCreatedAt: 0,
    totalPlayMs: 0,
    playSessionStartedAt: 0,
    planetWeather: null,        // { id, name, emoji, until, startedAt }
    planetBuff: null,           // daily astrology buff { id, name, emoji, day, until }
    planetVisitors: [],         // recent planet log entries; storage skips transient mining / achievement entries
    planetActions: {},          // action cooldowns and once-per-day stamps
    planetInfrastructure: {},   // buildingId -> { level, builtAt, upgradedAt }
    planetMining: {},           // offline coin mining { lastCollectedHourAt, lastCollectedAt }
    haqiIslandFarewells: [],     // [petId] pets that completed the adult farewell ceremony
    invitedPets: [],             // recent pets accepted from share links (latest 10)
    activeInvitedPet: null,       // transient invited pet currently visiting the field scene
    visitingMode: null,           // transient friend-planet visit { active, friendName, planetName, friendPet, ... }
    recentFriendPlanets: [],       // recently visited friend planets, newest first
    remotePlanetDiscoveries: {}, // remoteId -> { visitedAt, equipmentId, elementalAttribute, dna }
    remoteElementStocks: {},     // remoteId -> stored element tons on the user planet
    lifetimeStats: {             // cumulative lifetime counters for achievements
        feeds: 0,
        poopsCleaned: 0,
        adultsRaised: 0,
    },
    achievements: {              // achievement state: { claimed: { id: timestamp } }
        claimed: {},
    },
    storyProgress: {             // story completion state: { completed: { storyKey: { completedAt, actorId } } }
        completed: {},
    },
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() { subs.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

export function setView(name) {
    if (state.currentView === 'home') {
        state.lastHomeZoomLevel = Math.max(0, Math.min(3, state.zoomLevel | 0));
    }
    if (name === 'home') {
        state.zoomLevel = Math.max(0, Math.min(3, state.lastHomeZoomLevel | 0));
    }
    state.currentView = name;
    notify();
}

export function setCurrentPet(id) {
    state.currentPetId = id;
    notify();
}

export function getCurrentPet() {
    return state.currentPetId ? state.pets[state.currentPetId] : null;
}

export function mutatePet(id, fn) {
    const p = state.pets[id];
    if (!p) return null;
    fn(p);
    notify();
    return p;
}

export function addCoins(n) { state.coins = Math.max(0, state.coins + n); notify(); }

export function setZoomLevel(level) {
    const lv = Math.max(0, Math.min(3, level | 0));
    if (state.zoomLevel === lv) return;
    state.zoomLevel = lv;
    state.lastHomeZoomLevel = lv;
    notify();
}

export function setCurrentField(id) {
    if (state.currentField === id) return;
    state.currentField = id;
    notify();
}

export function setPlanetName(name) {
    const v = (name == null ? '' : String(name)).trim();
    if (state.planetName === v) return;
    state.planetName = v;
    notify();
}

export function getActivePlanetWeather(now = Date.now()) {
    const weather = state.planetWeather;
    if (!weather || !Number.isFinite(weather.until) || weather.until <= now) return null;
    return weather;
}

export function getActivePlanetBuff(now = Date.now()) {
    const buff = state.planetBuff;
    if (!buff || !Number.isFinite(buff.until) || buff.until <= now) return null;
    return buff;
}

export function isVisitingMode() {
    return !!state.visitingMode?.active;
}

export function startVisitingMode(visit) {
    state.visitingMode = {
        ...(visit || {}),
        active: true,
        startedAt: Number(visit?.startedAt) || Date.now(),
        previousField: visit?.previousField || state.currentField || '1',
    };
    notify();
}

export function endVisitingMode() {
    const previousField = state.visitingMode?.previousField || 'land';
    state.visitingMode = null;
    state.currentField = previousField;
    notify();
}
