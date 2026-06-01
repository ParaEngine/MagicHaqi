// 星际拜访与偏远星球航线逻辑

import { $, clamp, dockDisabledAttrs, escapeHtml, formatTime, isDockButtonDisabled, prompt, randId, showDockDisabledToast, showToast } from './utils.js';
import { t } from './i18n.js';
import { endVisitingMode, isVisitingMode, notify, startVisitingMode, state } from './state.js';
import { addToInventory, loadRecentFriendPlanets, saveRecentFriendPlanetsDebounced, saveUserProfileDebounced, savePetDebounced } from './storage.js';
import { defaultStats, clampEnergyToMax } from './petTick.js';
import { computePlanetProgress } from './planetProgress.js';
import { decodeDna, displayPetName, dnaRarity, randomDna, randomDnaForElementalAttribute } from './dna.js';
import { isPetOnCurrentPlanet } from './petLifecycle.js';
import { scanAndMount } from './pet.js';
import { friendDropdownLabel, friendId, friendName, friendUsername, loadFriends } from './view_email.js';
import { playVisitArrival, playVisitDeparture, playVisitReturn } from './visit_animations.js';
import SoundManager from './soundManager.js';
import { CONFIG, loadPlanetIndex } from './config.js';

const soundManager = SoundManager.getInstance();

export const SOCIAL_FUEL_COST = 30;
export const REMOTE_ELEMENT_HAUL_TONS = 10;
export const REMOTE_ELEMENT_MAX_TONS = 100;
export const HAQI_VISIT_COIN_REWARD = 30;
export const SMALL_REMOTE_PLANET_NAME_RADIUS = 8;
export const SMALL_REMOTE_PLANET_SIZE_PER_RADIUS = 7;

const UFO_REWARDS = ['food_apple', 'food_carrot', 'field_flower', 'land_mushroom', 'water_shell'];

export const SMALL_REMOTE_PLANETS = [
    { id: 'firebird', nameKey: 'stFirebirdName', x: 22, y: 34, radius: 4.1, depth: 11, hue: 18, accent: '#ffd166', rotation: -18, spinDuration: 14, elementalAttribute: '火', fieldId: 'fire', equipmentId: 'fire_volcano', equipmentNameKey: 'stEquipVolcano', equipmentEmoji: '🌋', surfaceX: 36, surfaceY: 30, tipKey: 'stFirebirdTip' },
    { id: 'ice', nameKey: 'stIceName', x: 11, y: 76, radius: 3.5, depth: 10, hue: 196, accent: '#b8f7ff', rotation: 31, spinDuration: 18, elementalAttribute: '冰', fieldId: 'ice', equipmentId: 'ice_lake', equipmentNameKey: 'stEquipIce', equipmentEmoji: '🧊', surfaceX: 62, surfaceY: 30, tipKey: 'stIceTip' },
    { id: 'desert', nameKey: 'stDesertName', x: 88, y: 29, radius: 3.8, depth: 9, hue: 42, accent: '#ffe08a', rotation: 57, spinDuration: 16, elementalAttribute: '生命', fieldId: 'life', equipmentId: 'life_sand_tree', equipmentNameKey: 'stEquipLifeTree', equipmentEmoji: '🏝️', surfaceX: 69, surfaceY: -3, surfaceRot: 14, surfaceScale: 2, tipKey: 'stDesertTip' },
    { id: 'shadow', nameKey: 'stShadowName', x: 8, y: 52, radius: 3.1, depth: 12, hue: 218, accent: '#9ca3af', rotation: -42, spinDuration: 22, elementalAttribute: '暗', fieldId: 'dark', equipmentId: 'dark_underground_caves', equipmentNameKey: 'stEquipCave', equipmentEmoji: '🕳️', surfaceX: 67, surfaceY: 67, tipKey: 'stShadowTip' },
    { id: 'thunder', nameKey: 'stThunderName', x: 73, y: 76, radius: 3.4, depth: 11, hue: 266, accent: '#facc15', rotation: 19, spinDuration: 13, elementalAttribute: '雷', fieldId: 'thunder', equipmentId: 'thunder_cloud_tower', equipmentNameKey: 'stEquipThunderTower', equipmentEmoji: '⚡', surfaceX: 31, surfaceY: 18, tipKey: 'stThunderTip' },
];
// 远程星球本地化字段解析
export const remotePlanetName = (p) => p ? (p.nameKey ? t(p.nameKey) : p.name || '') : '';
export const remotePlanetTip = (p) => p ? (p.tipKey ? t(p.tipKey) : p.tip || '') : '';
export const remoteEquipmentName = (p) => p ? (p.equipmentNameKey ? t(p.equipmentNameKey) : p.equipmentName || '') : '';

let __remoteCargoActive = false;
let __visitReturnPromptOpen = false;
let __friendVisitDestinations = [];
let __friendVisitDestinationsLoaded = false;
let __friendVisitDestinationsLoading = null;
let __officialVisitDestinations = [];
let __officialVisitDestinationsLoaded = false;
let __officialVisitDestinationsLoading = null;
let __famousPetsIndex = null;
let __famousPetsIndexLoading = null;
let __spaceTravelProvider = () => null;
let __actionInfrastructureLevelProvider = () => 1;
let __planetModalOpener = null;
let __planetLogAdder = null;
let __topbarRefresher = null;

export function configureSpaceTravelView(options = {}) {
    if (typeof options.getSpaceTravel === 'function') __spaceTravelProvider = options.getSpaceTravel;
    if (typeof options.getActionInfrastructureLevel === 'function') __actionInfrastructureLevelProvider = options.getActionInfrastructureLevel;
    if (typeof options.openPlanetModal === 'function') __planetModalOpener = options.openPlanetModal;
    if (typeof options.addPlanetLog === 'function') __planetLogAdder = options.addPlanetLog;
    if (typeof options.refreshTopbarResources === 'function') __topbarRefresher = options.refreshTopbarResources;
}

export function resetSpaceTravelViewState() {
    __remoteCargoActive = false;
}

function getSpaceTravel() {
    try { return __spaceTravelProvider?.() || null; } catch (_) { return null; }
}

function getActionInfrastructureLevel(action) {
    try { return __actionInfrastructureLevelProvider?.(action) || 1; } catch (_) { return 1; }
}

function openPlanetModal(innerHtml, onClick, cardClass = '') {
    if (__planetModalOpener) return __planetModalOpener(innerHtml, onClick, cardClass);
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal-card planet-modal-card ${escapeHtml(cardClass)}">${innerHtml}</div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-act="close"]')) { close(); return; }
        onClick?.(e, close);
    });
    document.body.appendChild(mask);
    scanAndMount(mask);
    return { mask, close };
}

function addPlanetLog(type, text, emoji) {
    __planetLogAdder?.(type, text, emoji);
}

function refreshTopbarResources() {
    if (__topbarRefresher) { __topbarRefresher(); return; }
    const fuel = $('mhBiofuel');
    const fuelValue = fuel?.querySelector?.('[data-hud-value="biofuel"]');
    if (fuelValue) fuelValue.textContent = String(state.biofuel | 0);
    else if (fuel) fuel.textContent = `⛽ ${state.biofuel | 0}`;
    const coins = $('mhCoins');
    const coinValue = coins?.querySelector?.('[data-hud-value="coins"]');
    if (coinValue) coinValue.textContent = String(state.coins);
    else if (coins) coins.innerHTML = `${coins.querySelector('svg')?.outerHTML || ''} ${state.coins}`;
}

function socialFuelCost() {
    const level = getActionInfrastructureLevel('visit') || 1;
    return Math.max(24, SOCIAL_FUEL_COST - (level - 1) * 3);
}

function socialCoinReward() {
    return HAQI_VISIT_COIN_REWARD;
}

export function getSocialVisitTip(destinationId = 'haqi') {
    const fuelCost = socialFuelCost();
    if (String(destinationId).startsWith('friend:')) {
        const friend = friendVisitDestinationById(destinationId);
        return t('stTipFriend', { fuel: fuelCost, pet: displayPetName(friend?.pet) || t('stFriendPetFallback'), planet: friend?.planetName || t('stFriendPlanetFallback') });
    }
    if (String(destinationId).startsWith('official:')) {
        const planet = officialVisitDestinations().find(item => item.id === destinationId);
        return t('stTipOfficial', { fuel: fuelCost, planet: planet?.title || t('stOfficialPlanetFallback') });
    }
    if (destinationId === 'haqi') {
        return t('stTipHaqi', { fuel: fuelCost, coins: socialCoinReward() });
    }
    const remote = SMALL_REMOTE_PLANETS.find(item => item.id === destinationId);
    if (!remote) return t('stTipFallback', { fuel: fuelCost });
    const stock = getRemoteElementStock(remote);
    const added = Math.min(REMOTE_ELEMENT_HAUL_TONS, Math.max(0, REMOTE_ELEMENT_MAX_TONS - stock));
    return t('stTipRemote', { fuel: fuelCost, name: remotePlanetName(remote), tons: added, attr: remote.elementalAttribute });
}

function clampStat(pet, key, delta) {
    if (!pet?.stats || typeof delta !== 'number') return;
    if (key === 'hunger' && delta > 0 && (pet.stage === 'egg' || pet.stage === 'baby')) return;
    pet.stats[key] = clamp((Number(pet.stats[key]) || 0) + delta, 0, 100);
    if (key === 'hunger') clampEnergyToMax(pet);
}

function isLocked(progress, unlockLevel) {
    return progress.level < unlockLevel;
}

function lockedTitle(unlockLevel) {
    return t('lpLockedTitle', { level: unlockLevel });
}

function safeFriendId(value, fallback = '') {
    return String(value || fallback || 'friend')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
        .slice(0, 48) || 'friend';
}

function safeFamousPetLocalId(value) {
    const text = String(value || '').trim().replace(/^famous-pets\//, '').replace(/\\/g, '/');
    if (!text || text.includes('..') || text.startsWith('/') || text.endsWith('/')) return '';
    return /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(text) ? text : '';
}

function stringHash(value) {
    const text = String(value || 'friend');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function friendPlanetIconData(destination) {
    const seedText = destination?.planetName || destination?.name || destination?.label || destination?.username || destination?.userId || t('stFriendPlanetFallback');
    const hash = stringHash(seedText);
    const hue = hash % 360;
    return {
        id: `friend-${safeFriendId(destination?.username || destination?.userId || destination?.name || hash)}`,
        hue,
        accent: `hsl(${(hue + 58) % 360} 86% 64%)`,
        rotation: (hash % 70) - 35,
        spinDuration: 26 + (hash % 24),
    };
}

function createFallbackFriendPet(friendName = t('stFriendDefault')) {
    const id = `visit_friend_${safeFriendId(friendName)}_${randId(4)}`;
    return {
        id,
        name: t('stFriendPetOf', { name: friendName }),
        stage: 'baby',
        dna: randomDna(),
        stats: defaultStats(),
        traits: {},
        bornAt: Date.now() - 86400000,
    };
}

function friendVisitDestinationFromFriend(record, index) {
    const username = safeRemoteUsername(friendUsername(record));
    const userId = friendId(record);
    if (!username && !userId) return null;
    const name = friendName(record) || username || t('stFriendNumbered', { n: index + 1 });
    return {
        id: `friend:${safeFriendId(username || userId || index)}`,
        kind: 'friend',
        name,
        username,
        userId,
        planetName: t('stFriendPlanetOf', { name }),
        pet: null,
        icon: '👤',
        meta: t('stReadFriendPlanet', { fuel: socialFuelCost() }),
        label: friendDropdownLabel(record),
        rawFriend: record,
    };
}

function recentFriendVisitDestinationFromRecord(record, index) {
    if (!record || typeof record !== 'object') return null;
    const username = safeRemoteUsername(record.username);
    const userId = String(record.userId || '').trim();
    if (!username && !userId) return null;
    const name = String(record.name || username || t('stFriendNumbered', { n: index + 1 })).trim();
    const visitedAt = Number(record.visitedAt) || 0;
    return {
        id: `friend:${safeFriendId(username || userId || index)}`,
        kind: 'friend',
        name,
        username,
        userId,
        planetName: String(record.planetName || t('stFriendPlanetOf', { name })).trim(),
        pet: null,
        icon: '👤',
        meta: visitedAt ? t('stLastVisit', { time: formatTime(visitedAt) }) : t('stVisitedRecently'),
        label: name,
        recent: true,
        visitedAt,
    };
}

function recentFriendVisitDestinations() {
    return (Array.isArray(state.recentFriendPlanets) ? state.recentFriendPlanets : [])
        .map(recentFriendVisitDestinationFromRecord)
        .filter(Boolean)
        .slice(0, 3);
}

async function rememberFriendPlanetVisit(friend, remotePlanet) {
    const username = safeRemoteUsername(remotePlanet?.username || friend?.username || friend?.name);
    const userId = String(friend?.userId || '').trim();
    if (!username && !userId) return;
    await loadRecentFriendPlanets();
    const record = {
        username,
        userId,
        name: String(friend?.name || username || t('stFriendShort')).trim().slice(0, 80),
        planetName: String(remotePlanet?.planetName || friend?.planetName || '').trim().slice(0, 80),
        visitedAt: Date.now(),
    };
    const sameFriend = item => {
        const itemUsername = safeRemoteUsername(item?.username);
        const itemUserId = String(item?.userId || '').trim();
        return (username && itemUsername === username) || (userId && itemUserId === userId);
    };
    state.recentFriendPlanets = [record, ...(Array.isArray(state.recentFriendPlanets) ? state.recentFriendPlanets : []).filter(item => !sameFriend(item))].slice(0, 3);
    saveRecentFriendPlanetsDebounced();
}

function friendVisitDestinations() {
    return __friendVisitDestinations;
}

function normalizeOfficialVisitField(field, index) {
    const slotId = String(field?.slotId || field?.slotIndex || field?.index || index + 1).trim();
    const typeId = String(field?.typeId || 'land').trim() || 'land';
    return {
        id: slotId || String(index + 1),
        slotId: slotId || String(index + 1),
        typeId,
        name: String(field?.name || field?.title || t('stLandFallback')).trim() || t('stLandFallback'),
        background: field?.background && typeof field.background === 'object' ? { ...field.background } : null,
        particles: Array.isArray(field?.particles) ? field.particles.slice(0, 6) : [],
        bgMusic: typeof field?.bgMusic === 'string' ? field.bgMusic : '',
    };
}

function normalizeOfficialVisitDestination(entry, index) {
    if (!entry || typeof entry !== 'object') return null;
    const planetId = String(entry.id || '').trim();
    if (!planetId) return null;
    const title = String(entry.title || entry.name || planetId).trim();
    const planet = entry.planet && typeof entry.planet === 'object' ? entry.planet : {};
    const fields = (Array.isArray(entry.fields) ? entry.fields : [])
        .map(normalizeOfficialVisitField)
        .filter(field => field.id);
    const hue = Number(planet.hue) || (stringHash(planetId) % 360);
    const accent = String(planet.accentColor || planet.accent || '').trim() || `hsl(${(hue + 54) % 360} 86% 64%)`;
    return {
        id: `official:${planetId}`,
        kind: 'official',
        officialId: planetId,
        name: title,
        title,
        icon: '🪐',
        meta: `${socialFuelCost()}燃料 · 官方星球`,
        label: title,
        planet,
        fields,
        planetPets: normalizePlanetPetIds(entry.planet_pets || entry.planetPets || entry.famousPets || entry.famous_pet_ids),
        appTitle: String(entry.appTitle || '').trim(),
        summary: String(entry.summary || '').trim(),
        hue,
        accent,
        rotation: Number(planet.rotation) || ((stringHash(planetId) % 70) - 35),
        spinDuration: Number(planet.spinDuration) || 26 + (stringHash(`${planetId}:spin`) % 24),
    };
}

export async function loadOfficialVisitDestinations() {
    if (__officialVisitDestinationsLoaded) return __officialVisitDestinations;
    if (__officialVisitDestinationsLoading) return __officialVisitDestinationsLoading;
    __officialVisitDestinationsLoading = loadPlanetIndex()
        .then(data => {
            const entries = Array.isArray(data?.planets) ? data.planets : (Array.isArray(data) ? data : []);
            __officialVisitDestinations = entries
                .map(normalizeOfficialVisitDestination)
                .filter(Boolean);
            __officialVisitDestinationsLoaded = true;
            window.dispatchEvent(new CustomEvent('mh:officialVisitDestinationsLoaded'));
            return __officialVisitDestinations;
        })
        .catch(e => {
            console.warn('读取官方星球索引失败', e);
            __officialVisitDestinations = [];
            __officialVisitDestinationsLoaded = true;
            return [];
        })
        .finally(() => {
            __officialVisitDestinationsLoading = null;
        });
    return __officialVisitDestinationsLoading;
}

function officialVisitDestinations() {
    if (!__officialVisitDestinationsLoaded) loadOfficialVisitDestinations();
    return __officialVisitDestinations;
}

async function loadFriendVisitDestinations() {
    if (__friendVisitDestinationsLoaded) return __friendVisitDestinations;
    if (__friendVisitDestinationsLoading) return __friendVisitDestinationsLoading;
    __friendVisitDestinationsLoading = loadFriends()
        .then(list => {
            __friendVisitDestinations = list
                .map(friendVisitDestinationFromFriend)
                .filter(Boolean)
                .slice(0, 12);
            __friendVisitDestinationsLoaded = true;
            return __friendVisitDestinations;
        })
        .catch(e => {
            console.warn('读取星际拜访好友列表失败', e);
            __friendVisitDestinations = [];
            __friendVisitDestinationsLoaded = true;
            return [];
        })
        .finally(() => {
            __friendVisitDestinationsLoading = null;
        });
    return __friendVisitDestinationsLoading;
}

function friendVisitDestinationById(destinationId) {
    const destinations = [...recentFriendVisitDestinations(), ...friendVisitDestinations()];
    return destinations.find(item => item.id === destinationId) || destinations[0];
}

function friendVisitDestinationIconHtml(destination) {
    const planet = friendPlanetIconData(destination);
    return `<span class="remote-mini-body planet-visit-friend-planet-icon" aria-hidden="true" style="--remote-mini-size:38px;--remote-mini-hue:${planet.hue};--remote-mini-accent:${planet.accent};--remote-mini-rotation:${planet.rotation}deg;--remote-mini-spin-duration:${planet.spinDuration}s">${smallRemotePlanetSvg(planet)}</span>`;
}

function officialVisitDestinationIconHtml(destination) {
    const planet = {
        id: `official-${safeFriendId(destination?.officialId || destination?.id || 'planet')}`,
        hue: Number(destination?.hue) || 188,
        accent: destination?.accent || '#38bdf8',
        rotation: Number(destination?.rotation) || 0,
        spinDuration: Number(destination?.spinDuration) || 30,
    };
    return `<span class="remote-mini-body planet-visit-friend-planet-icon" aria-hidden="true" style="--remote-mini-size:38px;--remote-mini-hue:${planet.hue};--remote-mini-accent:${planet.accent};--remote-mini-rotation:${planet.rotation}deg;--remote-mini-spin-duration:${planet.spinDuration}s">${smallRemotePlanetSvg(planet)}</span>`;
}

function officialVisitPlanetPreviewStyle(planet) {
    const bg = planet?.planet?.bodyBackground || `radial-gradient(circle at 34% 24%, rgba(255,255,255,.74) 0%, rgba(255,255,255,.18) 19%, transparent 34%), radial-gradient(circle at 50% 42%, hsl(${Number(planet?.hue) || 188} 86% 70%) 0%, hsl(${Number(planet?.hue) || 188} 72% 48%) 44%, #1488a9 100%)`;
    const glow = planet?.planet?.glowColor || `hsla(${Number(planet?.hue) || 188}, 86%, 62%, .5)`;
    return `background:${bg};box-shadow:inset -10px -16px 32px rgba(10,70,108,.32),0 0 22px ${glow}`;
}

function officialVisitFieldChipsHtml(planet) {
    const fields = Array.isArray(planet?.fields) ? planet.fields : [];
    if (!fields.length) return `<span class="planet-official-field-chip">${escapeHtml(t('stFieldChipLand'))}</span>`;
    return fields.map(field => `<span class="planet-official-field-chip">${escapeHtml(field.name || field.typeId || t('stLandFallback'))}</span>`).join('');
}

function showOfficialVisitConfirmModal(planet, pet, parentClose) {
    if (!planet || !pet) return false;
    const fuelCost = socialFuelCost();
    const modal = openPlanetModal(`
        <div class="planet-action-dialog-head">
            <span class="planet-action-dialog-icon">🪐</span>
            <div>
                <div class="planet-modal-title">${escapeHtml(planet.title || planet.name || t('stOfficialPlanetFallback'))}</div>
                <div class="planet-modal-subtitle">${escapeHtml(planet.summary || t('stOfficialDefaultSummary'))}</div>
            </div>
            <button class="menu-close-btn haqi-download-close planet-action-close" data-act="close" type="button" aria-label="${escapeHtml(t('close'))}">×</button>
        </div>
        <div class="planet-official-visit-card">
            <div class="planet-official-preview" style="${escapeHtml(officialVisitPlanetPreviewStyle(planet))}"><span>${escapeHtml((planet.title || '?').slice(0, 1))}</span></div>
            <div class="planet-official-info">
                <div class="planet-official-title"><b>${escapeHtml(planet.title || planet.name || t('stOfficialPlanetFallback'))}</b><em>${escapeHtml(planet.appTitle || t('stOfficialPlanetFallback'))}</em></div>
                <p>${escapeHtml(planet.summary || t('stOfficialVisitSummary'))}</p>
                <div class="planet-official-fields">${officialVisitFieldChipsHtml(planet)}</div>
            </div>
        </div>
        <div class="planet-action-dialog-body">${escapeHtml(t('stOfficialVisitBody', { fuel: fuelCost, name: planet.title || t('stOfficialPlanetFallback') }))}</div>
        <div class="planet-modal-actions">
            <button class="btn-secondary" data-act="close" type="button">${escapeHtml(t('cancel'))}</button>
            <button class="btn-primary" data-official-visit-confirm type="button">${escapeHtml(t('stTeleportVisit'))}</button>
        </div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-official-visit-confirm]');
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        const closeAll = () => { close(); parentClose?.(); };
        const sent = await launchOfficialPlanetVisit(planet, pet, closeAll);
        if (!sent && document.body.contains(btn)) btn.disabled = false;
    }, 'planet-official-visit-modal');
    return !!modal;
}

function safeRemoteUsername(value) {
    return String(value || '').trim().replace(/^@+/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '').slice(0, 64);
}

async function readRemoteFriendProfile(username) {
    const safeName = safeRemoteUsername(username);
    if (!safeName || !state.sdk?.personalPageStore?.readFile) return null;
    const path = `//${safeName}/edunotes/store/${CONFIG.workspace}/user/profile.json`;
    try {
        let text = '';
        try { text = await state.sdk.personalPageStore.readFile(path, 1, 99999); }
        catch (_) { text = await state.sdk.personalPageStore.readFile(path); }
        if (!text) return null;
        return JSON.parse(text);
    } catch (e) {
        console.warn('读取好友星球资料失败', e);
        return null;
    }
}

async function readRemoteFriendPet(username, profile) {
    const safeName = safeRemoteUsername(username);
    const petId = String(profile?.currentPetId || '').trim();
    if (!safeName || !petId || !state.sdk?.personalPageStore?.readFile) return null;
    const path = `//${safeName}/edunotes/store/${CONFIG.workspace}/pets/${petId}.json`;
    try {
        let text = '';
        try { text = await state.sdk.personalPageStore.readFile(path, 1, 99999); }
        catch (_) { text = await state.sdk.personalPageStore.readFile(path); }
        if (!text) return null;
        return JSON.parse(text);
    } catch (e) {
        console.warn('读取好友当前宠物失败', e);
        return null;
    }
}

async function readRemoteFriendLayouts(username, profile = null) {
    const safeName = safeRemoteUsername(username);
    if (!safeName || !state.sdk?.personalPageStore?.readFile) return {};
    const planetId = String(profile?.settings?.starSettlement?.source === 'official' ? profile.settings.starSettlement.planetId || '' : '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const path = `//${safeName}/edunotes/store/${CONFIG.workspace}/user/${planetId ? `${planetId}.layouts` : 'layouts'}.json`;
    try {
        let text = '';
        try { text = await state.sdk.personalPageStore.readFile(path, 1, 99999); }
        catch (_) { text = await state.sdk.personalPageStore.readFile(path); }
        if (!text) return {};
        const layouts = JSON.parse(text);
        return layouts && typeof layouts === 'object' ? layouts : {};
    } catch (e) {
        console.warn('读取好友星球布局失败', e);
        return {};
    }
}

function hasRemoteSpaceport(profile) {
    const spaceport = profile?.planetInfrastructure?.spaceport;
    return !!spaceport && (Number(spaceport.level) || 0) > 0;
}

async function resolveFriendPlanetForVisit(friend) {
    const username = safeRemoteUsername(friend?.username || friend?.name);
    if (!username || friend?.fallback) {
        showToast(t('stNeedRealFriend'), 'info', 2600);
        return null;
    }
    const profile = await readRemoteFriendProfile(username);
    if (!profile || !profile.planetName || !hasRemoteSpaceport(profile)) {
        showToast(t('stNoSpaceport'), 'error', 3200);
        return null;
    }
    const [pet, layouts] = await Promise.all([
        readRemoteFriendPet(username, profile),
        readRemoteFriendLayouts(username, profile),
    ]);
    if (layouts?.fieldScenes && typeof layouts.fieldScenes === 'object') {
        profile.settings = profile.settings && typeof profile.settings === 'object' ? profile.settings : {};
        profile.settings.fieldScenes = layouts.fieldScenes;
    }
    const terrainSlots = layouts?.terrainFields?.slots;
    const remoteFields = Array.isArray(terrainSlots) && terrainSlots.length
        ? terrainSlots
        : (profile?.settings?.terrainFields?.slots || []);
    return {
        username,
        profile,
        pet,
        layouts,
        fields: remoteFields,
        planetName: profile.planetName || t('stFriendPlanetOf', { name: friend.name || username }),
    };
}

export function getRemoteElementStock(remote) {
    const stocks = state.remoteElementStocks || {};
    return Math.max(0, Math.min(REMOTE_ELEMENT_MAX_TONS, Number(stocks[remote.id]) || 0));
}

export function smallRemotePlanetsHtml() {
    return SMALL_REMOTE_PLANETS.map(planet => {
        const showName = planet.radius >= SMALL_REMOTE_PLANET_NAME_RADIUS;
        return `
            <button class="remote-mini-planet remote-mini-${planet.id}" id="mhRemotePlanet-${planet.id}" type="button"
                style="left:${planet.x}%;top:${planet.y}%;--remote-mini-size:${(planet.radius * SMALL_REMOTE_PLANET_SIZE_PER_RADIUS).toFixed(1)}px;--remote-mini-hue:${planet.hue};--remote-mini-accent:${planet.accent};--remote-mini-rotation:${planet.rotation || 0}deg;--remote-mini-spin-duration:${planet.spinDuration || 120}s"
                title="${escapeHtml(remotePlanetName(planet))}" aria-label="${escapeHtml(remotePlanetName(planet))}" data-remote-planet="${escapeHtml(planet.id)}">
                <span class="remote-mini-body" aria-hidden="true">${smallRemotePlanetSvg(planet)}</span>
                ${showName ? `<span class="remote-mini-name">${escapeHtml(remotePlanetName(planet))}</span>` : ''}
            </button>`;
    }).join('');
}

export function smallRemotePlanetSvg(planet) {
    return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <defs>
                <radialGradient id="remoteMiniCore-${planet.id}" cx="34%" cy="26%" r="72%">
                    <stop offset="0" stop-color="#ffffff"/>
                    <stop offset="0.26" stop-color="${planet.accent}"/>
                    <stop offset="0.68" stop-color="hsl(${planet.hue} 78% 44%)"/>
                    <stop offset="1" stop-color="#080b28"/>
                </radialGradient>
            </defs>
            <circle class="remote-mini-core" cx="32" cy="32" r="21" fill="url(#remoteMiniCore-${planet.id})"/>
            <path class="remote-mini-land l1" d="M16 30c7-11 19-15 32-8 2 8-5 13-13 11-8-2-12 4-19-3z"/>
            <path class="remote-mini-land l2" d="M31 44c7-8 16-7 19 1-5 6-12 9-20 8-1-3-1-6 1-9z"/>
            <path class="remote-mini-shine" d="M20 22c5-6 13-9 22-7"/>
        </svg>`;
}

export function remoteTravelPlanets() {
    return [
        { id: 'haqi', name: '哈奇岛', x: 12, y: 16, radius: 9, depth: 10, selector: '#mhHaqiIsland .remote-planet-body' },
        ...SMALL_REMOTE_PLANETS.map(planet => ({
            id: planet.id,
            name: planet.name,
            x: planet.x,
            y: planet.y,
            radius: planet.radius,
            depth: planet.depth,
            selector: `#mhRemotePlanet-${planet.id} .remote-mini-body`,
        })),
    ];
}

export function socialVisitDestinationItems() {
    const officialItems = officialVisitDestinations().map(planet => ({
        id: planet.id,
        kind: 'official',
        name: planet.title || planet.name,
        planet,
        icon: '🪐',
        meta: `${socialFuelCost()}燃料 · 官方星球`,
        locked: false,
    }));
    const planetItems = officialItems.length ? officialItems : [
        {
            id: 'haqi',
            name: t('lpHaqiIsland'),
            icon: '🏝️',
            meta: t('stHaqiMeta', { fuel: socialFuelCost(), coins: socialCoinReward() }),
            locked: false,
        },
        ...SMALL_REMOTE_PLANETS.map(remote => {
            const stock = getRemoteElementStock(remote);
            const full = stock >= REMOTE_ELEMENT_MAX_TONS;
            return {
                id: remote.id,
                name: remotePlanetName(remote),
                remote,
                icon: remote.equipmentEmoji,
                meta: full ? t('stStockFull') : t('stStockMeta', { fuel: socialFuelCost(), attr: remote.elementalAttribute, stock, max: REMOTE_ELEMENT_MAX_TONS }),
                locked: full,
                disabledReason: full ? t('stStockFullReason', { name: remotePlanetName(remote), attr: remote.elementalAttribute }) : '',
            };
        }),
    ];
    return [
        {
            id: 'friends',
            kind: 'friendPicker',
            name: t('stFriendPlanetTitle'),
            icon: '👥',
            meta: t('stFriendPlanetMeta'),
            locked: false,
        },
        ...planetItems,
    ];
}

function socialVisitDestinationButtonsHtml() {
    const items = socialVisitDestinationItems();
    return items.map(destination => {
        if (destination.kind === 'friendPicker') {
            return `
                <button class="planet-visit-destination planet-visit-friend-picker"
                    data-visit-friend-picker type="button" aria-haspopup="dialog">
                    <span class="planet-visit-destination-icon">${destination.icon}</span>
                    <span class="planet-visit-destination-text">
                        <b>${escapeHtml(destination.name)}</b>
                        <i>${escapeHtml(destination.meta)}</i>
                    </span>
                </button>
            `;
        }
        return `
                <button class="planet-visit-destination ${destination.locked ? 'is-disabled' : ''}"
                    data-visit-destination="${escapeHtml(destination.id)}" type="button" role="option"${dockDisabledAttrs(destination.locked, destination.disabledReason || destination.meta)}>
                    <span class="planet-visit-destination-icon">${destination.kind === 'friend' ? friendVisitDestinationIconHtml(destination) : destination.kind === 'official' ? officialVisitDestinationIconHtml(destination.planet || destination) : destination.remote ? smallRemotePlanetSvg(destination.remote) : destination.icon}</span>
                    <span class="planet-visit-destination-text">
                        <b>${escapeHtml(destination.name)}</b>
                        <i>${escapeHtml(destination.meta)}</i>
                    </span>
                </button>
            `;
    }).join('');
}

export function socialVisitDestinationPickerHtml() {
    return `
        <div class="planet-visit-destinations" role="listbox" aria-label="${escapeHtml(t('stPickPlanetAria'))}">
            ${socialVisitDestinationButtonsHtml()}
        </div>
    `;
}

function friendVisitDestinationRowHtml(destination, extraClass = '') {
    const metaHtml = destination.recent && destination.meta
        ? `<i>${escapeHtml(destination.meta)}</i>`
        : '';
    return `
        <button class="planet-option planet-friend-visit-row ${extraClass}" data-friend-visit-destination="${escapeHtml(destination.id)}" type="button">
            <span class="planet-option-icon planet-friend-visit-icon">${friendVisitDestinationIconHtml(destination)}</span>
            <span>
                <b>${escapeHtml(destination.planetName || t('stFriendPlanetOf', { name: destination.name }))}</b>
                ${metaHtml}
            </span>
        </button>
    `;
}

function friendVisitPickerContentHtml(isLoading = false) {
    const recent = recentFriendVisitDestinations();
    const friends = friendVisitDestinations();
    const recentHtml = recent.length
        ? recent.map(destination => friendVisitDestinationRowHtml(destination, 'is-recent')).join('')
        : `<div class="planet-friend-picker-empty">${escapeHtml(t('stRecentEmpty'))}</div>`;
    const friendsHtml = isLoading || !__friendVisitDestinationsLoaded
        ? `<div class="planet-friend-picker-empty">${escapeHtml(t('stLoadingFriends'))}</div>`
        : (friends.length
            ? friends.map(destination => friendVisitDestinationRowHtml(destination)).join('')
            : `<div class="planet-friend-picker-empty">${escapeHtml(t('stNoFriends'))}</div>`);
    return `
        <div class="planet-friend-picker-section">
            <div class="planet-friend-picker-heading">${escapeHtml(t('stRecentVisit'))}</div>
            <div class="planet-option-list planet-friend-picker-list">${recentHtml}</div>
        </div>
        <div class="planet-friend-picker-section">
            <div class="planet-friend-picker-heading">${escapeHtml(t('stFriendList'))}</div>
            <div class="planet-option-list planet-friend-picker-list" data-friend-picker-list>${friendsHtml}</div>
        </div>
    `;
}

export async function openFriendVisitPickerModal(pet, parentClose) {
    await loadRecentFriendPlanets();
    const modal = openPlanetModal(`
        <div class="planet-action-dialog-head">
            <span class="planet-action-dialog-icon">👥</span>
            <div>
                <div class="planet-modal-title">${escapeHtml(t('stFriendPlanetTitle'))}</div>
                <div class="planet-modal-subtitle">${escapeHtml(t('stFriendPickerSub'))}</div>
            </div>
        </div>
        <div class="planet-friend-picker-body" data-friend-picker-body>
            ${friendVisitPickerContentHtml(!__friendVisitDestinationsLoaded)}
        </div>
        <div class="planet-modal-actions"><button class="btn-secondary" data-act="close">${escapeHtml(t('cancel'))}</button></div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-friend-visit-destination]');
        if (!btn || btn.disabled) return;
        const destination = friendVisitDestinationById(btn.dataset.friendVisitDestination);
        if (!destination) return;
        btn.disabled = true;
        const closeAll = () => { close(); parentClose?.(); };
        const sent = await launchFriendPlanetVisit(destination, pet, closeAll);
        if (!sent && document.body.contains(btn)) btn.disabled = false;
    }, 'planet-friend-picker-modal');
    if (!__friendVisitDestinationsLoaded) {
        loadFriendVisitDestinations().then(() => {
            if (!document.body.contains(modal.mask)) return;
            const body = modal.mask.querySelector('[data-friend-picker-body]');
            if (!body) return;
            body.innerHTML = friendVisitPickerContentHtml(false);
            scanAndMount(body);
        });
    }
}

export function handleVisitDestinationSelection(e, pet, close) {
    const friendPickerBtn = e.target.closest?.('[data-visit-friend-picker]');
    if (friendPickerBtn) {
        openFriendVisitPickerModal(pet, close);
        return true;
    }
    const destinationBtn = e.target.closest?.('[data-visit-destination]');
    if (destinationBtn) {
        if (isDockButtonDisabled(destinationBtn)) { showDockDisabledToast(destinationBtn); return true; }
        const destinationId = destinationBtn.dataset.visitDestination || 'haqi';
        if (String(destinationId).startsWith('official:')) {
            const planet = officialVisitDestinations().find(item => item.id === destinationId);
            if (planet) showOfficialVisitConfirmModal(planet, pet, close);
            return true;
        }
        destinationBtn.disabled = true;
        runSocialVisitDestination(destinationId, pet, close).then(sent => {
            if (!sent && document.body.contains(destinationBtn)) destinationBtn.disabled = false;
        });
        return true;
    }
    return false;
}

export function refreshVisitTip(modalRoot) {
    const tip = modalRoot?.querySelector?.('[data-visit-tip]');
    if (tip) tip.textContent = '';
}

export async function runSocialVisitDestination(destinationId, pet, close) {
    if (String(destinationId).startsWith('friend:')) return launchFriendPlanetVisit(friendVisitDestinationById(destinationId), pet, close);
    if (String(destinationId).startsWith('official:')) return launchOfficialPlanetVisit(officialVisitDestinations().find(item => item.id === destinationId), pet, close);
    if (destinationId === 'haqi') return launchHaqiSocialVisit(pet, close);
    const remote = SMALL_REMOTE_PLANETS.find(item => item.id === destinationId);
    if (!remote) return false;
    return visitRemotePlanet(remote, close);
}

export function launchSocialVisit(pet) {
    const progress = computePlanetProgress();
    if (isLocked(progress, 2)) { showToast(lockedTitle(2), 'info'); return; }
    runSocialVisitDestination('haqi', pet);
}

function getVisitCrewPets(activePet) {
    const seen = new Set();
    const crew = [];
    const add = (pet) => {
        if (!pet?.id || seen.has(pet.id) || pet.stage === 'egg') return;
        if (!isPetOnCurrentPlanet(pet)) return;
        seen.add(pet.id);
        crew.push(pet);
    };
    add(activePet);
    (state.petOrder || [])
        .map(id => state.pets[id])
        .filter(Boolean)
        .filter(p => p?.id !== activePet?.id)
        .filter(p => p.stage !== 'egg' && isPetOnCurrentPlanet(p))
        .sort((a, b) => (Number(b.bornAt) || 0) - (Number(a.bornAt) || 0))
        .forEach(add);
    return crew.slice(0, 3);
}

function visitLandingPose(friendPet) {
    const hash = stringHash(friendPet?.id || friendPet?.name || 'visit-host');
    const hostX = 0.52 + ((hash % 17) - 8) / 1000;
    const hostY = 0.62 + (((hash >> 4) % 19) - 9) / 1000;
    const side = hash % 2 ? -1 : 1;
    return {
        fieldId: 'land',
        targetPetId: friendPet?.id || 'friend',
        targetX: clamp(hostX, 0.34, 0.72),
        targetY: clamp(hostY, 0.48, 0.78),
        x: clamp(hostX + side * 0.105, 0.08, 0.92),
        y: clamp(hostY + 0.035, 0.36, 0.90),
        delay: 0,
        dur: 9,
        dx: 0,
        dy: 0,
    };
}

async function launchFriendPlanetVisit(friend, pet, close) {
    const fuelCost = socialFuelCost();
    if (!friend || !pet) return false;
    if (__remoteCargoActive || isVisitingMode()) {
        showToast('当前已有一段星际航程正在进行。', 'info', 2200);
        return false;
    }
    showToast('正在读取好友星球资料...', 'info', 1800);
    const remotePlanet = await resolveFriendPlanetForVisit(friend);
    if (!remotePlanet) return false;
    if ((state.biofuel | 0) < fuelCost) {
        showToast(t('stNeedFuelFriend', { fuel: fuelCost }), 'error', 2600);
        return false;
    }
    state.biofuel = Math.max(0, (state.biofuel | 0) - fuelCost);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    close?.();
    __remoteCargoActive = true;
    const crew = getVisitCrewPets(pet);
    const friendPet = remotePlanet.pet || friend.pet || createFallbackFriendPet(friend.name);
    const previousField = state.currentField || 'land';
    try {
        soundManager.playSpacecraftTakeoff();
        await playVisitDeparture({ crew, destinationName: remotePlanet.planetName });
        soundManager.playSpacecraftArrive();
        await playVisitArrival({ crew, destinationName: remotePlanet.planetName, welcomePet: friendPet });
        state.currentField = 'land';
        state.zoomLevel = 1;
        state.lastHomeZoomLevel = 1;
        state.isDecorMode = false;
        state.isFeedMode = false;
        state.activePetFieldPose = visitLandingPose(friendPet);
        state.activePetRoomPose = null;
        state.activePetRoomFocusPose = null;
        startVisitingMode({
            friendId: friend.id,
            friendName: friend.name || '好友',
            friendUsername: remotePlanet.username,
            friendUserId: friend.userId || '',
            planetName: remotePlanet.planetName,
            remoteProfile: remotePlanet.profile,
            remoteLayouts: remotePlanet.layouts || {},
            remoteFields: remotePlanet.fields || [],
            friendPet,
            crewPets: crew,
            crewIds: crew.map(item => item.id),
            previousField,
        });
        rememberFriendPlanetVisit(friend, remotePlanet);
        addPlanetLog('friendVisit', `${displayPetName(pet)}抵达${remotePlanet.planetName}`, '🚀');
        showToast(t('stArrivedFriend', { planet: remotePlanet.planetName }), 'success', 3200);
        notify();
    } finally {
        __remoteCargoActive = false;
    }
    return true;
}

async function completeFriendVisitReturn(pet) {
    const visit = state.visitingMode;
    if (!visit?.active || visit.returning) return;
    visit.returning = true;
    const friendPet = visit.friendPet || createFallbackFriendPet(visit.friendName || '好友');
    const gift = UFO_REWARDS[(Date.now() + String(visit.friendId || '').length) % UFO_REWARDS.length];
    const seenCrew = new Set();
    const crew = [pet, ...(visit.crewPets || []), friendPet].filter((item) => {
        const id = item?.id || displayPetName(item);
        if (!item || seenCrew.has(id)) return false;
        seenCrew.add(id);
        return true;
    });
    soundManager.playSpacecraftTakeoff();
    await playVisitReturn({ crew, destinationName: state.planetName || '自己的星球', giftIcon: '🎁' });
    await addToInventory(pet.id, gift, 1);
    clampStat(pet, 'mood', 10);
    clampStat(pet, 'bond', 5);
    addPlanetLog('friendReturn', `${visit.friendName || '好友'}的宠物送给${displayPetName(pet)}一个随机礼盒`, '🎁');
    state.zoomLevel = 0;
    state.lastHomeZoomLevel = 0;
    state.activePetFieldPose = null;
    state.activePetRoomPose = null;
    state.activePetRoomFocusPose = null;
    endVisitingMode();
    refreshTopbarResources();
    savePetDebounced(pet);
    saveUserProfileDebounced();
    soundManager.playSpacecraftArrive();
    showToast(t('stReturnDone'), 'success', 3200);
    notify();
}

export function showVisitReturnPrompt(pet, ctx) {
    if (!isVisitingMode() || __visitReturnPromptOpen) return;
    __visitReturnPromptOpen = true;
    const visit = state.visitingMode;
    openPlanetModal(`
        <div class="planet-action-dialog-head">
            <span class="planet-action-dialog-icon">🚀</span>
            <div>
                <div class="planet-modal-title">准备返航吗？</div>
                <div class="planet-modal-subtitle">你正在拜访 ${escapeHtml(visit?.planetName || '好友星球')}。</div>
            </div>
        </div>
        <div class="planet-action-dialog-body">还想再逛一会儿吗？点“继续拜访”可以回到好友星球；点“登船返航”会带上好友送你的礼盒回到自己的星球。</div>
        <div class="planet-modal-actions">
            <button class="btn-secondary" data-visit-return="no">${escapeHtml(t('stContinueVisit'))}</button>
            <button class="btn-primary" data-visit-return="yes">${escapeHtml(t('stBoardReturn'))}</button>
        </div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-visit-return]');
        if (!btn) return;
        const answer = btn.dataset.visitReturn;
        close();
        __visitReturnPromptOpen = false;
        if (answer === 'yes') {
            await completeFriendVisitReturn(pet);
            return;
        }
        state.zoomLevel = 1;
        state.lastHomeZoomLevel = 1;
        notify();
    }, 'planet-visit-return-modal');
}

async function launchHaqiSocialVisit(pet, close) {
    const fuelCost = socialFuelCost();
    const coinReward = socialCoinReward();
    if (__remoteCargoActive) {
        showToast('还有一批星际资源正在自动返航，请稍等片刻。', 'info', 2600);
        return false;
    }
    if ((state.biofuel | 0) < fuelCost) {
        showToast(`需要 ${fuelCost} ⛽ 生物燃料，去星球收集便便吧。`, 'error', 2600);
        return false;
    }
    state.biofuel = Math.max(0, (state.biofuel | 0) - fuelCost);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    close?.();
    __remoteCargoActive = true;
    showToast(t('stShipDepartHaqi'), 'info', 2600);
    try {
        soundManager.playSpacecraftTakeoff();
        const spaceTravel = getSpaceTravel();
        if (spaceTravel?.playMission) {
            await spaceTravel.playMission('haqi', { direction: 'outbound', duration: 8500, type: 'shuttle' });
            soundManager.playSpacecraftArrive();
            showToast(t('stHaqiVisitDone'), 'info', 2200);
            soundManager.playSpacecraftTakeoff();
            await spaceTravel.playMission('haqi', { direction: 'return', duration: 7500, type: 'shuttle' });
        }
    } finally {
        __remoteCargoActive = false;
    }
    state.coins += coinReward;
    const gift = UFO_REWARDS[(Date.now() + (state.petOrder || []).length) % UFO_REWARDS.length];
    await addToInventory(pet.id, gift, 1);
    clampStat(pet, 'mood', 12);
    clampStat(pet, 'bond', 6);
    addPlanetLog('visit', `${pet.name || '宠物'}拜访了哈奇岛，带回 ${coinReward} 金币和随机礼物`, '🚀');
    refreshTopbarResources();
    savePetDebounced(pet);
    saveUserProfileDebounced();
    soundManager.playSpacecraftArrive();
    showToast(t('stHaqiVoyageDone', { coins: coinReward }), 'success', 3000);
    notify();
    return true;
}

function officialVisitLayouts(planet) {
    const layouts = {};
    (planet?.fields || []).forEach(field => {
        layouts[`field_${field.id}`] = [];
        layouts[`field_${field.typeId}`] = [];
    });
    return layouts;
}

function officialVisitProfile(planet) {
    const fieldScenes = {};
    (planet?.fields || []).forEach(field => {
        const key = String(field.id || field.slotId || '').trim();
        if (!key) return;
        const scene = {};
        if (field.background && typeof field.background === 'object') scene.background = { ...field.background };
        if (Array.isArray(field.particles)) scene.particles = [...field.particles];
        if (field.bgMusic) scene.bgMusic = field.bgMusic;
        fieldScenes[key] = scene;
        if (field.typeId) fieldScenes[field.typeId] = { ...scene, background: scene.background ? { ...scene.background } : scene.background };
    });
    return {
        planetName: planet?.title || planet?.name || '官方星球',
        currentPetId: '',
        settings: { fieldScenes },
    };
}

function resolveFamousPetAssetUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:https?:|data:|blob:|\/)/i.test(raw)) return raw;
    try { return new URL(raw, baseUrl).href; }
    catch (_) { return raw; }
}

function normalizeFamousPetEntry(entry, baseUrl) {
    if (!entry || typeof entry !== 'object') return null;
    const localId = safeFamousPetLocalId(entry.id);
    if (!localId) return null;
    const dna = String(entry.dna || '').trim() || randomDna();
    return {
        id: `visit_famous_${safeFriendId(localId)}`,
        famousPetId: localId,
        source: 'famous-pets',
        sourcePetId: `famous-pets/${localId}`,
        name: String(entry.name || localId).trim() || localId,
        stage: entry.stage === 'adult' || entry.stage === 'elder' || entry.stage === 'teen' ? entry.stage : 'baby',
        anim: entry.anim === 'sleep' || entry.anim === 'sad' || entry.anim === 'happy' ? entry.anim : 'idle',
        dna,
        stats: defaultStats(),
        traits: entry.traits && typeof entry.traits === 'object' ? { ...entry.traits } : decodeDna(dna),
        rarity: Number.isFinite(Number(entry.rarity)) ? Number(entry.rarity) : dnaRarity(dna),
        imageUrl: resolveFamousPetAssetUrl(entry.imageUrl, baseUrl) || null,
        imageSheetUrl: resolveFamousPetAssetUrl(entry.imageSheetUrl, baseUrl) || null,
        bornAt: Date.now() - 86400000,
    };
}

async function loadFamousPetsForOfficialVisit() {
    if (Array.isArray(__famousPetsIndex)) return __famousPetsIndex;
    if (!__famousPetsIndexLoading) {
        const indexUrl = new URL('../famous-pets/_pet_index.json', import.meta.url + '');
        __famousPetsIndexLoading = fetch(indexUrl.href, { cache: 'no-cache' })
            .then(response => response.ok ? response.json() : [])
            .then(data => {
                const list = Array.isArray(data) ? data : (Array.isArray(data?.pets) ? data.pets : []);
                __famousPetsIndex = list.map(item => normalizeFamousPetEntry(item, indexUrl.href)).filter(Boolean);
                return __famousPetsIndex;
            })
            .catch(e => {
                console.warn('读取明星宠物索引失败', e);
                __famousPetsIndex = [];
                return __famousPetsIndex;
            })
            .finally(() => { __famousPetsIndexLoading = null; });
    }
    return __famousPetsIndexLoading;
}

function normalizePlanetPetIds(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[，,、\s]+/);
    const ids = [];
    raw.forEach(item => {
        const id = safeFamousPetLocalId(item);
        if (id && !ids.includes(id)) ids.push(id);
    });
    return ids.slice(0, 10);
}

function seededShuffle(list, seedText) {
    const result = [...list];
    let seed = stringHash(seedText || 'shuffle') || 1;
    for (let index = result.length - 1; index > 0; index -= 1) {
        seed = Math.imul(seed ^ 0x9e3779b9, 1664525) + 1013904223;
        const swapIndex = Math.abs(seed >>> 0) % (index + 1);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function randomVisitPetStage() {
    const stages = ['baby', 'teen', 'adult', 'elder'];
    return stages[Math.floor(Math.random() * stages.length)] || 'baby';
}

function withRandomVisitPetStage(pet) {
    return pet ? { ...pet, stage: randomVisitPetStage() } : pet;
}

async function resolveOfficialPlanetPets(planet) {
    const famousPets = await loadFamousPetsForOfficialVisit();
    const byId = new Map(famousPets.map(pet => [pet.famousPetId, pet]));
    let ids = normalizePlanetPetIds(planet?.planetPets || planet?.planet_pets);
    if (!ids.length) ids = seededShuffle(famousPets.map(pet => pet.famousPetId), `${planet?.officialId || planet?.id || 'official'}:${Date.now()}:${Math.random()}`).slice(0, 5);
    let selected = ids.map(id => byId.get(id)).filter(Boolean);
    if (!selected.length && famousPets.length) selected = seededShuffle(famousPets, `${planet?.officialId || planet?.id || 'official'}:fallback:${Date.now()}:${Math.random()}`).slice(0, 5);
    selected = seededShuffle(selected, `${planet?.officialId || planet?.id || 'official'}:display:${Date.now()}:${Math.random()}`);
    selected = selected.map(withRandomVisitPetStage);
    if (planet?.officialId === 'haqi') {
        const farewellPets = (Array.isArray(state.haqiIslandFarewells) ? state.haqiIslandFarewells : [])
            .map(id => state.pets?.[id])
            .filter(Boolean);
        return [...selected, ...farewellPets].filter((pet, index, list) => pet?.id && list.findIndex(item => item?.id === pet.id) === index).slice(0, 10);
    }
    return selected.slice(0, 10);
}

function createOfficialHostPet(planet, planetPets = []) {
    const picked = planetPets[Math.floor(Math.random() * planetPets.length)];
    if (picked) return { ...picked, id: picked.id || `visit_famous_${safeFriendId(picked.famousPetId || picked.name || randId(6))}`, anim: 'happy' };
    return {
        id: `visit_official_${safeFriendId(planet?.officialId || planet?.id || 'planet')}`,
        name: `${planet?.title || planet?.name || '官方星球'}导游`,
        stage: 'baby',
        dna: randomDna(),
        stats: defaultStats(),
        traits: {},
        bornAt: Date.now() - 86400000,
    };
}

async function launchOfficialPlanetVisit(planet, pet, close) {
    const fuelCost = socialFuelCost();
    if (!planet || !pet) return false;
    if (__remoteCargoActive || isVisitingMode()) {
        showToast(t('stVoyageBusy'), 'info', 2200);
        return false;
    }
    if ((state.biofuel | 0) < fuelCost) {
        showToast(t('stNeedFuelOfficial', { fuel: fuelCost, name: planet.title || t('stOfficialPlanetFallback') }), 'error', 2600);
        return false;
    }
    state.biofuel = Math.max(0, (state.biofuel | 0) - fuelCost);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    close?.();
    __remoteCargoActive = true;
    const crew = getVisitCrewPets(pet);
    const planetPets = await resolveOfficialPlanetPets(planet);
    const friendPet = createOfficialHostPet(planet, planetPets);
    const previousField = state.currentField || 'land';
    try {
        soundManager.playSpacecraftTakeoff();
        await playVisitDeparture({ crew, destinationName: planet.title || '官方星球' });
        soundManager.playSpacecraftArrive();
        await playVisitArrival({ crew, destinationName: planet.title || '官方星球', welcomePet: friendPet });
        const firstField = planet.fields?.[0];
        state.currentField = firstField?.id || firstField?.typeId || 'land';
        state.zoomLevel = 1;
        state.lastHomeZoomLevel = 1;
        state.isDecorMode = false;
        state.isFeedMode = false;
        state.activePetFieldPose = visitLandingPose(friendPet);
        state.activePetRoomPose = null;
        state.activePetRoomFocusPose = null;
        startVisitingMode({
            friendId: planet.id,
            friendName: planet.title || '官方星球',
            friendUsername: '',
            friendUserId: '',
            planetName: planet.title || '官方星球',
            remoteProfile: officialVisitProfile(planet),
            remoteLayouts: officialVisitLayouts(planet),
            remoteFields: planet.fields || [],
            friendPet,
            planetPets,
            crewPets: crew,
            crewIds: crew.map(item => item.id),
            previousField,
            officialPlanetId: planet.officialId,
        });
        addPlanetLog('officialVisit', `${displayPetName(pet)}抵达${planet.title || '官方星球'}`, '🚀');
        showToast(t('stArrivedOfficial', { name: planet.title || t('stOfficialPlanetFallback') }), 'success', 3200);
        notify();
    } finally {
        __remoteCargoActive = false;
    }
    return true;
}

export function showRemotePlanetPanel(remote) {
    const discoveries = state.remotePlanetDiscoveries || {};
    const discovery = discoveries[remote.id];
    const stock = getRemoteElementStock(remote);
    const full = stock >= REMOTE_ELEMENT_MAX_TONS;
    openPlanetModal(`
        <div class="haqi-island-head remote-travel-head">
            <div>
                <div class="planet-modal-title">${escapeHtml(remotePlanetName(remote))}</div>
                <div class="planet-modal-subtitle">${escapeHtml(remotePlanetTip(remote))}</div>
            </div>
            <button class="menu-close-btn haqi-download-close" data-act="close" type="button" aria-label="${escapeHtml(t('close'))}">×</button>
        </div>
        <div class="remote-travel-card">
            <div class="remote-travel-planet" style="--remote-travel-hue:${remote.hue};--remote-travel-accent:${remote.accent};--remote-mini-hue:${remote.hue};--remote-mini-accent:${remote.accent};--remote-mini-rotation:${remote.rotation || 0}deg;--remote-mini-spin-duration:${remote.spinDuration || 120}s">${smallRemotePlanetSvg(remote)}</div>
            <div class="remote-travel-info">
                <div><b>${escapeHtml(t('stRemoteResource'))}</b><span>${escapeHtml(remoteEquipmentName(remote))} ${remote.equipmentEmoji}</span></div>
                <div><b>${escapeHtml(t('stDnaSignal'))}</b><span>${escapeHtml(t('stElementUnit', { attr: remote.elementalAttribute }))}</span></div>
                <div><b>${escapeHtml(t('stRemoteStock'))}</b><span>${escapeHtml(t('stRemoteTons', { stock, max: REMOTE_ELEMENT_MAX_TONS }))}</span></div>
            </div>
        </div>
        <div class="planet-action-dialog-body">
            ${escapeHtml(t('stRemoteDispatchInfo', { name: remotePlanetName(remote), haul: REMOTE_ELEMENT_HAUL_TONS, attr: remote.elementalAttribute, max: REMOTE_ELEMENT_MAX_TONS }))}
        </div>
        <div class="planet-modal-actions remote-travel-actions">
            <button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button>
            <button class="btn-primary" data-remote-visit="${escapeHtml(remote.id)}" ${full ? 'disabled' : ''}>${full ? escapeHtml(t('stStockFull')) : (discovery ? escapeHtml(t('stDispatchAgain')) : escapeHtml(t('stDispatch')))}</button>
        </div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-remote-visit]');
        if (!btn) return;
        const target = SMALL_REMOTE_PLANETS.find(item => item.id === btn.dataset.remoteVisit);
        if (!target) return;
        btn.disabled = true;
        const sent = await visitRemotePlanet(target, close);
        if (!sent) btn.disabled = false;
    }, 'remote-travel-modal');
}

async function visitRemotePlanet(remote, close) {
    const fuelCost = socialFuelCost();
    if (__remoteCargoActive) {
        showToast(t('stResourceReturning'), 'info', 2600);
        return false;
    }
    if (getRemoteElementStock(remote) >= REMOTE_ELEMENT_MAX_TONS) {
        showToast(t('stStockMaxed', { attr: remote.elementalAttribute, max: REMOTE_ELEMENT_MAX_TONS }), 'info', 2600);
        return false;
    }
    if ((state.biofuel | 0) < fuelCost) {
        showToast(t('stNeedFuelShip', { fuel: fuelCost }), 'error', 2600);
        return false;
    }
    state.biofuel = Math.max(0, (state.biofuel | 0) - fuelCost);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    close?.();
    __remoteCargoActive = true;
    showToast(t('stVoyageStart', { name: remotePlanetName(remote), attr: remote.elementalAttribute }), 'info', 2600);
    try {
        soundManager.playSpacecraftTakeoff();
        const spaceTravel = getSpaceTravel();
        if (spaceTravel?.playMission) {
            await spaceTravel.playMission(remote.id, { direction: 'outbound', duration: 10500, type: 'shuttle' });
            soundManager.playSpacecraftArrive();
            showToast(t('stLoadedReturning', { equip: remoteEquipmentName(remote) }), 'info', 2200);
            soundManager.playSpacecraftTakeoff();
            await spaceTravel.playMission(remote.id, {
                direction: 'return',
                duration: 9500,
                type: 'shuttle',
                cargoClass: `planet-remote-artifact planet-remote-${remote.id}`,
                cargoHue: remote.hue,
            });
        }
        await completeRemoteElementReturn(remote);
        soundManager.playSpacecraftArrive();
    } finally {
        __remoteCargoActive = false;
    }
    return true;
}

async function completeRemoteElementReturn(remote) {
    state.remotePlanetDiscoveries = state.remotePlanetDiscoveries || {};
    const existing = state.remotePlanetDiscoveries[remote.id];
    const firstDiscovery = !existing;
    const dna = existing?.dna || randomDnaForElementalAttribute(remote.elementalAttribute);
    state.remotePlanetDiscoveries[remote.id] = {
        ...(existing || {}),
        visitedAt: Date.now(),
        equipmentId: remote.equipmentId,
        equipmentName: remoteEquipmentName(remote),
        elementalAttribute: remote.elementalAttribute,
        fieldId: remote.fieldId,
        dna,
    };
    state.remoteElementStocks = state.remoteElementStocks || {};
    const before = getRemoteElementStock(remote);
    const added = Math.min(REMOTE_ELEMENT_HAUL_TONS, REMOTE_ELEMENT_MAX_TONS - before);
    if (added <= 0) {
        showToast(t('stStockMaxed', { attr: remote.elementalAttribute, max: REMOTE_ELEMENT_MAX_TONS }), 'info', 2600);
        return;
    }
    state.remoteElementStocks[remote.id] = before + added;
    const itemCount = Math.max(1, Math.floor(added / REMOTE_ELEMENT_HAUL_TONS));
    await addToInventory('remote_planet', remote.equipmentId, itemCount);
    addPlanetLog('remoteVisit', t('stRemoteHaulLog', { name: remotePlanetName(remote), tons: added, attr: remote.elementalAttribute }), remote.equipmentEmoji);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    showToast(t('stRemoteVoyageDone', { attr: remote.elementalAttribute, tons: added, count: itemCount, equip: remoteEquipmentName(remote), stock: state.remoteElementStocks[remote.id], max: REMOTE_ELEMENT_MAX_TONS, unlock: firstDiscovery ? t('stUnlockedTerrain') : '' }), 'success', 3800);
}
