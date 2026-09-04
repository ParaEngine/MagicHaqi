// 全局状态
import { CONFIG } from './config.js';
import { recordCoinTransaction } from './coin_ledger.js';

export const state = {
    sdk: null,
    user: null,                 // { id, username, ... }
    offlineMode: false,
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

export function normalizeMineralExplorationBridge(value) {
    const source = value && typeof value === 'object' ? value : {};
    const toPercent = (raw) => Math.max(0, Math.min(100, Number(raw) || 0));
    return {
        revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
        dispatchedPetIds: [...new Set((Array.isArray(source.dispatchedPetIds) ? source.dispatchedPetIds : [])
            .map(id => String(id || '').trim()).filter(Boolean))],
        bonuses: {
            attackPercent: toPercent(source.bonuses?.attackPercent),
            expeditionLootPercent: toPercent(source.bonuses?.expeditionLootPercent),
        },
        activeSeriesIds: [...new Set((Array.isArray(source.activeSeriesIds) ? source.activeSeriesIds : [])
            .map(id => String(id || '').trim()).filter(Boolean))],
        research: Math.max(0, Math.min(999, Math.floor(Number(source.research) || 0))),
        preparationCharges: Math.max(0, Math.min(3, Math.floor(Number(source.preparationCharges) || 0))),
        tacticalItems: {
            emergencyBeacon: Math.max(0, Math.min(3, Math.floor(Number(source.tacticalItems?.emergencyBeacon) || 0))),
            deflectionShield: Math.max(0, Math.min(3, Math.floor(Number(source.tacticalItems?.deflectionShield) || 0))),
        },
        breedingCatalysts: {
            ssrMutation: Math.max(0, Math.min(9, Math.floor(Number(source.breedingCatalysts?.ssrMutation) || 0))),
            urAttributeLock: Math.max(0, Math.min(9, Math.floor(Number(source.breedingCatalysts?.urAttributeLock) || 0))),
        },
        workshop: {
            day: /^\d{4}-\d{2}-\d{2}$/.test(String(source.workshop?.day || '')) ? String(source.workshop.day) : '',
            refined: Math.max(0, Math.min(6, Math.floor(Number(source.workshop?.refined) || 0))),
            soldCoins: Math.max(0, Math.min(30, Math.floor(Number(source.workshop?.soldCoins) || 0))),
        },
        consumedRequestIds: [...new Set((Array.isArray(source.consumedRequestIds) ? source.consumedRequestIds : [])
            .map(id => String(id || '').trim().slice(0, 80)).filter(Boolean))].slice(-40),
        syncedAt: Math.max(0, Number(source.syncedAt) || 0),
    };
}

function normalizeMineralPlanetId(planetId = 'haqi') {
    return String(planetId || 'haqi').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'haqi';
}

function mineralExplorationBridges() {
    state.settings = state.settings || {};
    const bridges = state.settings.mineralExplorationBridges;
    state.settings.mineralExplorationBridges = bridges && typeof bridges === 'object' ? bridges : {};
    if (!state.settings.mineralExplorationBridges.haqi && state.settings.haqiMineralBridge) {
        state.settings.mineralExplorationBridges.haqi = normalizeMineralExplorationBridge(state.settings.haqiMineralBridge);
    }
    return state.settings.mineralExplorationBridges;
}

export function getMineralExplorationBridge(planetId = 'haqi') {
    const safePlanetId = normalizeMineralPlanetId(planetId);
    const bridges = mineralExplorationBridges();
    const bridge = normalizeMineralExplorationBridge(bridges[safePlanetId]);
    bridges[safePlanetId] = bridge;
    return bridge;
}

export function setMineralExplorationBridge(planetId, nextBridge) {
    const safePlanetId = normalizeMineralPlanetId(planetId);
    const bridges = mineralExplorationBridges();
    bridges[safePlanetId] = normalizeMineralExplorationBridge(nextBridge);
    notify();
    return bridges[safePlanetId];
}

export function getHaqiMineralBridge() {
    return getMineralExplorationBridge('haqi');
}

export function setHaqiMineralBridge(nextBridge) {
    return setMineralExplorationBridge('haqi', nextBridge);
}

export function isPetDispatching(petId, activePlanetId = '') {
    let planetId = String(activePlanetId || '').trim();
    if (!planetId) {
        const settlement = state.settings?.starSettlement;
        planetId = settlement?.source === 'official' ? String(settlement.planetId || '').trim() : '';
    }
    if (!planetId && typeof window !== 'undefined') {
        try { planetId = String(new URL(window.location.href).searchParams.get('home_planet') || window.__homePlanet || '').trim(); } catch (_) {}
    }
    const id = String(petId || '').trim();
    return !!id && getMineralExplorationBridge(planetId).dispatchedPetIds.includes(id);
}

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

export function addCoins(n, metadata = {}) {
    const balanceBefore = Math.max(0, Number(state.coins) || 0);
    state.coins = Math.max(0, balanceBefore + (Number(n) || 0));
    const amount = state.coins - balanceBefore;
    if (amount) recordCoinTransaction({ ...metadata, amount, balanceAfter: state.coins });
    notify();
    return amount;
}

// 生物燃料（poop 回收，用于星际旅行）唯一的增减入口，统一钳制到 >= 0。
// 与 addCoins 对称；level_*.js / view_*.js 不应再直接写 state.biofuel。
export function addBiofuel(n) { state.biofuel = Math.max(0, (state.biofuel | 0) + n); notify(); }

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
