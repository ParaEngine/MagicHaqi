// PersonalPageStore 适配层（仅使用 readFile / createFile）
// 所有数据都以文件形式存储；JSON 数据存为 .json 文件，文本/日志保持 .md/.log。
import { CONFIG } from './config.js';
import { debounce } from './utils.js';
import { state } from './state.js';
import { normalizeTerrainFieldSlotId, normalizeTerrainSlotIndex, TERRAIN_FIELD_SLOT_DEFS } from './terrain_field_slots.js';

let store = null;

function ensureStore() {
    if (store) return store;
    if (!state.sdk?.personalPageStore) throw new Error('PersonalPageStore 不可用');
    const base = state.sdk.personalPageStore;
    store = (typeof base.withWorkspace === 'function')
        ? base.withWorkspace(CONFIG.workspace)
        : base;
    return store;
}

// ---------- 基础文件 IO ----------
async function readFileSafe(path) {
    try {
        const s = ensureStore();
        if (typeof s.readFile !== 'function') return '';
        try {
            return (await s.readFile(path, 1, 99999)) || '';
        } catch (_) {
            try { return (await s.readFile(path)) || ''; } catch (__) { return ''; }
        }
    } catch (_) {
        return '';
    }
}

async function writeFileSafe(path, content) {
    try {
        const s = ensureStore();
        if (typeof s.createFile !== 'function') return false;
        await s.createFile(path, content == null ? '' : String(content));
        return true;
    } catch (e) {
        console.warn('writeFile 失败', path, e);
        return false;
    }
}

async function clearLocalDiskSafe(path) {
    try {
        const s = ensureStore();
        if (typeof s.clearLocalDisk !== 'function') return false;
        await s.clearLocalDisk(path);
        return true;
    } catch (e) {
        console.warn('clearLocalDisk 失败', path, e);
        return false;
    }
}

async function deleteFileSafe(path) {
    try {
        const s = ensureStore();
        if (typeof s.deleteFile === 'function') {
            await s.deleteFile(path);
            return true;
        }
    } catch (e) {
        console.warn('deleteFile 失败', path, e);
    }
    return await writeFileSafe(path, '');
}

async function listDirSafe(path) {
    try {
        const s = ensureStore();
        if (typeof s.listDir !== 'function') return [];
        const list = await s.listDir(path);
        return Array.isArray(list) ? list : [];
    } catch (_) {
        return [];
    }
}

async function readJSON(path, def = null) {
    const text = await readFileSafe(path);
    if (!text) return def;
    try { return JSON.parse(text); } catch (e) {
        console.warn('readJSON 解析失败', path, e);
        return def;
    }
}

async function writeJSON(path, value) {
    const text = value == null ? '' : JSON.stringify(value, null, 2);
    return await writeFileSafe(path, text);
}

// ---------- 防抖批量写 ----------
const _pendingSaves = new Map(); // path -> value
const _flushSaves = debounce(() => {
    const entries = [...(_pendingSaves.entries())];
    _pendingSaves.clear();
    for (const [path, value] of entries) writeJSON(path, value);
}, 800);
function saveJSONDebounced(path, value) {
    _pendingSaves.set(path, value);
    _flushSaves();
}

async function saveJSONNow(path, value) {
    _pendingSaves.delete(path);
    return await writeJSON(path, value);
}

// ---------- 文件路径约定 ----------
const PATHS = {
    userProfile: 'user/profile.json',
    storyProgress: 'user/story_progress.json',
    layouts:     'user/layouts.json',
    planetLayouts: (planetId) => `user/${planetId}.layouts.json`,
    planetEncyclopedia: (planetId) => `user/${planetId}.encyclopedia.json`,
    inventory:   'user/inventory.json',
    planetVisitors: 'user/planet_visitors.json',
    recentFriendPlanets: 'user/recent_friend_planets.json',
    postcardList: 'user/postcard_list.json',
    likedGames:  'user/list_liked_games.json',
    storyList:   'stories/index.json',
    story:      (name) => `stories/${name}.json`,
    pet:        (id) => `pets/${id}.json`,
    memory:     (id) => `pets/${id}.memory.md`,
    chatLog:    (id) => `pets/${id}.chat.log`,
};

function safeStoryName(name) {
    const text = String(name || '').trim().replace(/\.json$/i, '');
    return (text || 'story_' + Date.now())
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
        .slice(0, 64) || ('story_' + Date.now());
}

function normalizeStoryListRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const path = String(record.path || '').trim().replace(/^\/+/, '');
    if (!path) return null;
    return {
        path,
        id: String(record.id || path).slice(0, 120),
        title: String(record.title || record.id || '我的宠物故事').slice(0, 80),
        sceneCount: Math.max(0, Number(record.sceneCount) || 0),
        actorCount: Math.max(0, Number(record.actorCount) || 0),
        lineCount: Math.max(0, Number(record.lineCount) || 0),
        activityCount: Math.max(0, Number(record.activityCount) || 0),
        minigameCount: Math.max(0, Number(record.minigameCount) || 0),
        updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
        coverActor: record.coverActor && typeof record.coverActor === 'object' ? record.coverActor : null,
    };
}

function createStoryListRecord(story, path) {
    const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
    let lineCount = 0;
    let activityCount = 0;
    let minigameCount = 0;
    scenes.forEach(scene => {
        const timeline = Array.isArray(scene?.timeline) && scene.timeline.length
            ? scene.timeline
            : [
                ...(Array.isArray(scene?.lines) ? scene.lines.map(line => ({ kind: 'line', ...line })) : []),
                ...(Array.isArray(scene?.activities) ? scene.activities.map(activity => ({ kind: 'activity', ...activity })) : []),
            ];
        timeline.forEach(item => {
            if (item?.kind === 'activity' || item?.type) {
                activityCount += 1;
                if (item.type === 'minigame') minigameCount += 1;
            } else if (String(item?.text || item?.say || '').trim()) {
                lineCount += 1;
            }
        });
    });
    const actors = Array.isArray(story?.actors) ? story.actors : [];
    const coverActor = actors.find(actor => actor.isMainActor) || actors[0] || null;
    return normalizeStoryListRecord({
        path,
        id: story?.id || path,
        title: story?.title || '我的宠物故事',
        sceneCount: scenes.length,
        actorCount: actors.length,
        lineCount,
        activityCount,
        minigameCount,
        updatedAt: Number.isFinite(story?.savedAt) ? story.savedAt : Date.now(),
        coverActor,
    });
}

function storyPathFromDirEntry(entry) {
    if (typeof entry === 'string') {
        const clean = entry.replace(/^\/+/, '');
        if (!clean || clean.endsWith('/')) return '';
        return clean.startsWith('stories/') ? clean : `stories/${clean}`;
    }
    if (!entry || typeof entry !== 'object') return '';
    const raw = String(entry.path || entry.fullPath || entry.name || '').trim().replace(/^\/+/, '');
    if (!raw || raw.endsWith('/')) return '';
    return raw.startsWith('stories/') ? raw : `stories/${raw}`;
}

function createStoryPathRecord(path) {
    const cleanPath = String(path || '').trim().replace(/^\/+/, '');
    if (!cleanPath) return null;
    const filename = cleanPath.split('/').pop() || cleanPath;
    const title = filename.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim() || '我的宠物故事';
    return normalizeStoryListRecord({
        path: cleanPath,
        id: cleanPath,
        title,
    });
}

async function discoverWorkspaceStoryRecords() {
    const entries = await listDirSafe('stories');
    const paths = [...new Set(entries
        .map(storyPathFromDirEntry)
        .filter(path => /\.json$/i.test(path) && path !== PATHS.storyList))];
    const records = await Promise.all(paths.map(async (path) => {
        const text = await readFileSafe(path);
        return text.trim() ? createStoryPathRecord(path) : null;
    }));
    return records.filter(Boolean);
}

function normalizePostcardRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const fromUsername = String(record.fromUsername || record.from || '').trim();
    const petId = String(record.petId || '').trim();
    if (!fromUsername || !petId) return null;
    return {
        fromUsername,
        petId,
        text: String(record.text || '').slice(0, 500),
        layout: String(record.layout || 'idle').slice(0, 120),
        dateReceived: Number.isFinite(record.dateReceived) ? record.dateReceived : Date.now(),
    };
}

function postcardRecordKey(record) {
    return `${record.fromUsername}\n${record.petId}\n${record.text}\n${record.layout}`;
}

const NON_PERSISTENT_PLANET_VISITOR_TYPES = new Set(['achievement', 'mining']);

function getPersistentPlanetVisitors(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter(entry => entry && typeof entry === 'object' && !NON_PERSISTENT_PLANET_VISITOR_TYPES.has(entry.type))
        .slice(0, 12);
}

function normalizePlanetVisitorRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const text = typeof record.text === 'string' ? record.text.trim().slice(0, 160) : '';
    if (!text) return null;
    return {
        type: typeof record.type === 'string' ? record.type.trim().slice(0, 40) : '',
        text,
        emoji: typeof record.emoji === 'string' ? record.emoji.trim().slice(0, 8) : '',
        at: Number.isFinite(record.at) ? record.at : Date.now(),
    };
}

function normalizePlanetVisitors(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(normalizePlanetVisitorRecord)
        .filter(Boolean)
        .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
        .slice(0, 12);
}

function planetVisitorKey(record) {
    return `${record.type || ''}\n${record.text || ''}\n${record.emoji || ''}\n${Number(record.at) || 0}`;
}

function mergePlanetVisitors(...lists) {
    const seen = new Set();
    const merged = [];
    lists.flat().forEach(record => {
        const normalized = normalizePlanetVisitorRecord(record);
        if (!normalized) return;
        const key = planetVisitorKey(normalized);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(normalized);
    });
    return normalizePlanetVisitors(merged);
}

function normalizeRecentFriendPlanets(value) {
    return (Array.isArray(value) ? value : [])
        .map(createRecentFriendPlanetPayload)
        .filter(Boolean)
        .sort((a, b) => (Number(b.visitedAt) || 0) - (Number(a.visitedAt) || 0))
        .slice(0, 3);
}

function farewellPetId(record) {
    if (typeof record === 'string') return record.trim();
    if (!record || typeof record !== 'object') return '';
    return typeof record.petId === 'string' ? record.petId.trim() : '';
}

function normalizeFarewellPetIds(value) {
    if (!Array.isArray(value)) return [];
    const ids = [];
    value.forEach(record => {
        const id = farewellPetId(record);
        if (id && !ids.includes(id)) ids.push(id);
    });
    return ids.slice(0, 200);
}

function normalizeInventoryData(data) {
    const inventory = {};
    const order = [];
    const addEntry = (id, count) => {
        if (typeof id !== 'string' || !id) return;
        const qty = Math.max(0, Number(count) || 0);
        if (qty <= 0) return;
        inventory[id] = (inventory[id] || 0) + qty;
        if (!order.includes(id)) order.push(id);
    };

    if (Array.isArray(data)) {
        data.forEach(entry => {
            if (typeof entry === 'string') addEntry(entry, 1);
            else if (Array.isArray(entry)) addEntry(entry[0], entry[1]);
            else if (entry && typeof entry === 'object') addEntry(entry.id || entry.itemId, entry.count ?? entry.qty ?? entry.quantity);
        });
    } else if (data && typeof data === 'object') {
        Object.entries(data).forEach(([id, count]) => addEntry(id, count));
    }

    return { inventory, order };
}

function createInventoryPayload(inventory, order) {
    const inv = inventory && typeof inventory === 'object' ? inventory : {};
    const ownedIds = Object.keys(inv).filter(id => Number(inv[id]) > 0);
    const savedOrder = Array.isArray(order) ? order.filter(id => typeof id === 'string' && id) : [];
    const orderedIds = [
        ...savedOrder.filter(id => ownedIds.includes(id)),
        ...ownedIds.filter(id => !savedOrder.includes(id)),
    ];
    return orderedIds.map(id => ({ id, count: Math.max(0, Number(inv[id]) || 0) }));
}

function getInventoryPayload() {
    return createInventoryPayload(state.inventory, state.inventoryOrder);
}

function saveInventoryDebouncedInternal() {
    saveJSONDebounced(PATHS.inventory, getInventoryPayload());
}

async function saveInventoryNowInternal() {
    return await saveJSONNow(PATHS.inventory, getInventoryPayload());
}

function cloneJSON(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePoopFieldId(fieldId) {
    const raw = String(fieldId ?? '').trim();
    if (raw === 'land') return '1';
    if (raw === 'water') return '2';
    if (raw === 'sky') return '3';
    const match = raw.match(/^(?:field_|terrain_slot_)?([1-7])$/);
    return match ? match[1] : (raw || '1');
}

function normalizePoopCountValue(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function createPoopCountsPayload(pet) {
    const savedCounts = pet?.poopCounts && typeof pet.poopCounts === 'object' && !Array.isArray(pet.poopCounts)
        ? pet.poopCounts
        : {};
    const hasSavedCounts = Object.values(savedCounts).some(value => normalizePoopCountValue(value) > 0);
    const counts = {};
    if (!hasSavedCounts && Array.isArray(pet?.poops)) {
        pet.poops.forEach((poop) => {
            const field = normalizePoopFieldId(poop?.field || '1');
            counts[field] = normalizePoopCountValue(counts[field]) + 1;
        });
    }
    Object.entries(savedCounts).forEach(([fieldId, value]) => {
        const field = normalizePoopFieldId(fieldId);
        counts[field] = normalizePoopCountValue(counts[field]) + normalizePoopCountValue(value);
    });
    const payload = {};
    Object.entries(counts).forEach(([field, value]) => {
        const count = Math.min(Math.max(0, Number(CONFIG.maxPoopsPerField) || 0), normalizePoopCountValue(value));
        if (count > 0) payload[field] = count;
    });
    return payload;
}

function profileSlotKey(def, index) {
    return String(def?.index || index + 1);
}

function rawProfileSlotIndex(slot) {
    if (!slot || typeof slot !== 'object') return null;
    return normalizeTerrainSlotIndex(slot.index ?? slot.slotIndex ?? slot.slotId ?? slot.id);
}

function profileSlotForDef(rawSlots, def, index) {
    if (!Array.isArray(rawSlots)) return null;
    const targetIndex = def.index;
    const matches = rawSlots.filter(slot => rawProfileSlotIndex(slot) === targetIndex);
    if (matches.length) return matches[0];
    const positional = rawSlots[index];
    return rawProfileSlotIndex(positional) == null ? positional || null : null;
}

function normalizeTerrainFieldsSettings(settings) {
    const terrainFields = settings.terrainFields;
    if (!terrainFields || typeof terrainFields !== 'object' || !Array.isArray(terrainFields.slots)) return;
    settings.terrainFields = {
        ...terrainFields,
        slots: TERRAIN_FIELD_SLOT_DEFS.map((def, index) => {
            const slot = profileSlotForDef(terrainFields.slots, def, index) || {};
            return {
                index: def.index,
                typeId: String(slot.typeId || slot.fieldId || '').trim(),
                name: String(slot.name || def.label).trim().slice(0, 12) || def.label,
            };
        }),
    };
}

function normalizeTerrainFieldsData(data) {
    const payload = { terrainFields: data };
    normalizeTerrainFieldsSettings(payload);
    return payload.terrainFields && typeof payload.terrainFields === 'object' && Array.isArray(payload.terrainFields.slots)
        ? payload.terrainFields
        : {};
}

function extractLayoutsTerrainFields(layouts) {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
    return normalizeTerrainFieldsData(layouts.terrainFields);
}

function applyLayoutsTerrainFields(layouts, terrainFields) {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return layouts;
    const normalized = normalizeTerrainFieldsData(terrainFields);
    if (Array.isArray(normalized.slots) && normalized.slots.length) layouts.terrainFields = normalized;
    else delete layouts.terrainFields;
    return layouts;
}

function setActiveSettingsTerrainFields(terrainFields) {
    const settings = state.settings || (state.settings = {});
    const normalized = normalizeTerrainFieldsData(terrainFields);
    if (Array.isArray(normalized.slots) && normalized.slots.length) settings.terrainFields = normalized;
    else delete settings.terrainFields;
}

function normalizeFieldScenesSettings(settings) {
    const fieldScenes = settings.fieldScenes;
    if (!fieldScenes || typeof fieldScenes !== 'object' || Array.isArray(fieldScenes)) return;
    const validKeys = new Set(TERRAIN_FIELD_SLOT_DEFS.map(profileSlotKey));
    const normalized = {};
    Object.entries(fieldScenes).forEach(([rawKey, config]) => {
        const key = normalizeTerrainFieldSlotId(String(rawKey || '').replace(/^field_/, ''));
        if (!validKeys.has(key) || !config || typeof config !== 'object' || Array.isArray(config)) return;
        normalized[key] = { ...(normalized[key] || {}), ...cloneJSON(config) };
    });
    settings.fieldScenes = normalized;
}

function normalizeFieldScenesData(data) {
    const payload = { fieldScenes: data };
    normalizeFieldScenesSettings(payload);
    return payload.fieldScenes && typeof payload.fieldScenes === 'object' && !Array.isArray(payload.fieldScenes)
        ? payload.fieldScenes
        : {};
}

function extractLayoutsFieldScenes(layouts) {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
    return normalizeFieldScenesData(layouts.fieldScenes);
}

function applyLayoutsFieldScenes(layouts, fieldScenes) {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return layouts;
    const normalized = normalizeFieldScenesData(fieldScenes);
    if (Object.keys(normalized).length) layouts.fieldScenes = normalized;
    else delete layouts.fieldScenes;
    return layouts;
}

function setActiveSettingsFieldScenes(fieldScenes) {
    const settings = state.settings || (state.settings = {});
    const normalized = normalizeFieldScenesData(fieldScenes);
    if (Object.keys(normalized).length) settings.fieldScenes = normalized;
    else delete settings.fieldScenes;
}

function normalizeProfileFieldSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    delete settings.terrainFields;
    delete settings.fieldScenes;
    return settings;
}

function normalizeLayoutRoomKey(roomId) {
    const key = String(roomId || '').trim();
    if (!key.startsWith('field_')) return key;
    return `field_${normalizeTerrainFieldSlotId(key.slice('field_'.length))}`;
}

function safeLayoutPlanetId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function currentLayoutsPath() {
    const settlement = state.settings?.starSettlement;
    if (settlement?.source === 'official') {
        const planetId = safeLayoutPlanetId(settlement.planetId);
        if (planetId) return PATHS.planetLayouts(planetId);
    }
    return PATHS.layouts;
}

function hasStoredLayouts(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function resetLayoutsLoadState() {
    _layoutsLoaded = false;
    _layoutsLoading = null;
    state.layouts = {};
}

export function setActiveLayoutsPlanet(planetId = '') {
    const nextPlanetId = safeLayoutPlanetId(planetId);
    const nextPath = nextPlanetId ? PATHS.planetLayouts(nextPlanetId) : PATHS.layouts;
    if (currentLayoutsPath() === nextPath) return;
    const settings = state.settings || (state.settings = {});
    // 原地变更 starSettlement 字段，避免替换对象引用——外部调用方可能已经持有旧引用。
    const settlement = settings.starSettlement && typeof settings.starSettlement === 'object'
        ? settings.starSettlement
        : (settings.starSettlement = {});
    if (nextPlanetId) {
        settlement.source = 'official';
        settlement.planetId = nextPlanetId;
    } else if (settlement.source === 'official') {
        settlement.source = 'custom';
        settlement.planetId = '';
    }
    resetLayoutsLoadState();
}

// 新手指引完成进度：每个星球的 layouts 文件里保留一个 `onboarding` 对象，
// 用来判断该星球是否已经走过新手故事 / 新手小游戏。结构：
//   { completed: boolean, mode: 'pet-story'|'minigames'|..., completedAt: number, version: number }
function normalizeOnboardingProgress(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const progress = {};
    progress.completed = !!value.completed;
    if (typeof value.mode === 'string' && value.mode) progress.mode = value.mode.slice(0, 32);
    if (Number.isFinite(value.completedAt)) progress.completedAt = Number(value.completedAt);
    if (Number.isFinite(value.startedAt)) progress.startedAt = Number(value.startedAt);
    if (Number.isFinite(value.version)) progress.version = Number(value.version);
    // 只有有意义的进度才保留，避免写入空对象。
    return (progress.completed || progress.mode || progress.startedAt || progress.completedAt) ? progress : null;
}

function extractLayoutsOnboarding(layouts) {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return null;
    return normalizeOnboardingProgress(layouts.onboarding);
}

function applyLayoutsOnboarding(layouts, onboarding) {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return layouts;
    const normalized = normalizeOnboardingProgress(onboarding);
    if (normalized) layouts.onboarding = normalized;
    else delete layouts.onboarding;
    return layouts;
}

function normalizeLayoutsData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const layouts = {};
    Object.entries(data).forEach(([rawKey, items]) => {
        if (rawKey === 'fieldScenes' || rawKey === 'terrainFields' || rawKey === 'onboarding') return;
        const key = normalizeLayoutRoomKey(rawKey);
        if (!key || !Array.isArray(items)) return;
        if (!layouts[key]) layouts[key] = items;
        else if (!layouts[key].length) layouts[key] = items;
    });
    applyLayoutsTerrainFields(layouts, data.terrainFields);
    applyLayoutsFieldScenes(layouts, data.fieldScenes);
    applyLayoutsOnboarding(layouts, data.onboarding);
    return layouts;
}

function applyHomeFieldSettingsForOfficialSettlement(settings) {
    const settlement = settings.starSettlement;
    if (settlement?.source !== 'official' || !settlement.homeSnapshot) return;
    const snapshot = settlement.homeSnapshot;
    if (Array.isArray(snapshot.terrainSlots)) {
        settings.terrainFields = {
            ...(settings.terrainFields && typeof settings.terrainFields === 'object' ? settings.terrainFields : {}),
            slots: cloneJSON(snapshot.terrainSlots),
        };
    } else {
        delete settings.terrainFields;
    }
    if (snapshot.fieldScenes && typeof snapshot.fieldScenes === 'object') {
        settings.fieldScenes = cloneJSON(snapshot.fieldScenes) || {};
    } else {
        delete settings.fieldScenes;
    }
}

function getPersistentSettingsPayload() {
    const settings = cloneJSON(state.settings && typeof state.settings === 'object' ? state.settings : {}) || {};
    normalizeProfileFieldSettings(settings);
    const override = state.temporaryHomePlanetOverride;
    if (!override) {
        applyHomeFieldSettingsForOfficialSettlement(settings);
        return normalizeProfileFieldSettings(settings);
    }
    if (override.hasTerrainFields) settings.terrainFields = cloneJSON(override.terrainFields) || {};
    else delete settings.terrainFields;
    if (override.hasFieldScenes) settings.fieldScenes = cloneJSON(override.fieldScenes) || {};
    else delete settings.fieldScenes;
    if (override.hasStarSettlement) settings.starSettlement = cloneJSON(override.starSettlement) || {};
    else delete settings.starSettlement;
    return normalizeProfileFieldSettings(settings);
}

function getUserProfilePayload() {
    const temporaryHome = state.temporaryHomePlanetOverride;
    return {
        coins: state.coins,
        biofuel: Number.isFinite(state.biofuel) ? state.biofuel : 0,
        isPaid: state.isPaid,
        settings: getPersistentSettingsPayload(),
        planetName: temporaryHome ? temporaryHome.planetName : (state.planetName || ''),
        planetCreatedAt: Number.isFinite(state.planetCreatedAt) ? state.planetCreatedAt : 0,
        totalPlayMs: Number.isFinite(state.totalPlayMs) ? state.totalPlayMs : 0,
        planetWeather: state.planetWeather || null,
        planetBuff: state.planetBuff || null,
        planetActions: state.planetActions && typeof state.planetActions === 'object' ? state.planetActions : {},
        planetInfrastructure: state.planetInfrastructure && typeof state.planetInfrastructure === 'object' ? state.planetInfrastructure : {},
        planetMining: state.planetMining && typeof state.planetMining === 'object' ? state.planetMining : {},
        haqiIslandFarewells: normalizeFarewellPetIds(state.haqiIslandFarewells),
        invitedPets: Array.isArray(state.invitedPets) ? state.invitedPets.slice(0, 10).map(createInvitedPetPayload) : [],
        remotePlanetDiscoveries: state.remotePlanetDiscoveries && typeof state.remotePlanetDiscoveries === 'object' ? state.remotePlanetDiscoveries : {},
        remoteElementStocks: state.remoteElementStocks && typeof state.remoteElementStocks === 'object' ? state.remoteElementStocks : {},
        lifetimeStats: state.lifetimeStats && typeof state.lifetimeStats === 'object' ? state.lifetimeStats : {},
        achievements: state.achievements && typeof state.achievements === 'object' ? state.achievements : { claimed: {} },
        petOrder: state.petOrder || [],
        currentPetId: state.currentPetId || null,
    };
}

function normalizeStoryProgressPayload(value) {
    const progress = value && typeof value === 'object' ? value : {};
    const completed = progress.completed && typeof progress.completed === 'object' ? progress.completed : {};
    return { completed };
}

function createInvitedPetPayload(record) {
    if (!record || typeof record !== 'object') return record;
    const pet = record.pet && typeof record.pet === 'object' ? createPetPayload(record.pet) : null;
    return {
        id: typeof record.id === 'string' ? record.id : '',
        from: typeof record.from === 'string' ? record.from : '',
        petId: typeof record.petId === 'string' ? record.petId : '',
        text: typeof record.text === 'string' ? record.text : '',
        layout: typeof record.layout === 'string' ? record.layout : Math.max(1, Math.min(4, Number(record.layout) || 1)),
        acceptedAt: Number.isFinite(record.acceptedAt) ? record.acceptedAt : Date.now(),
        friendStatus: typeof record.friendStatus === 'string' ? record.friendStatus : '',
        pet,
    };
}

function createRecentFriendPlanetPayload(record) {
    if (!record || typeof record !== 'object') return null;
    const username = typeof record.username === 'string' ? record.username.trim().slice(0, 64) : '';
    const userId = typeof record.userId === 'string' || typeof record.userId === 'number' ? String(record.userId).trim().slice(0, 64) : '';
    if (!username && !userId) return null;
    return {
        username,
        userId,
        name: typeof record.name === 'string' ? record.name.trim().slice(0, 80) : '',
        planetName: typeof record.planetName === 'string' ? record.planetName.trim().slice(0, 80) : '',
        visitedAt: Number.isFinite(record.visitedAt) ? record.visitedAt : Date.now(),
    };
}

function normalizePetRuntimeData(pet) {
    if (!pet || typeof pet !== 'object') return pet;
    delete pet.stageName;
    delete pet.stageEmoji;
    const counts = createPoopCountsPayload(pet);
    pet.poopCounts = counts;
    delete pet.poops;
    return pet;
}

function createPetPayload(pet) {
    if (!pet || typeof pet !== 'object') return pet;
    const { stageName, stageEmoji, ...payload } = pet;
    payload.poopCounts = createPoopCountsPayload(pet);
    delete payload.poops;
    const locationType = payload.location?.type || payload.status || 'home';
    if (locationType !== 'home') {
        delete payload.poopCounts;
        delete payload.poops;
    }
    if (locationType === 'released') {
        delete payload.stats;
        delete payload.anim;
        delete payload.sleepStartedAt;
        delete payload.sleepLockedUntil;
    }
    return payload;
}

// ========== 用户 ==========
export async function loadUserProfile() {
    const p = (await readJSON(PATHS.userProfile, {})) || {};
    state.coins = typeof p.coins === 'number' ? p.coins : CONFIG.initialCoins;
    state.biofuel = typeof p.biofuel === 'number' ? Math.max(0, p.biofuel) : 0;
    state.isPaid = !!p.isPaid;
    state.settings = p.settings || {};
    state.planetName = typeof p.planetName === 'string' ? p.planetName : '';
    state.planetCreatedAt = Number.isFinite(p.planetCreatedAt) ? p.planetCreatedAt : 0;
    state.totalPlayMs = Number.isFinite(p.totalPlayMs) ? Math.max(0, p.totalPlayMs) : 0;
    state.planetWeather = p.planetWeather && typeof p.planetWeather === 'object' ? p.planetWeather : null;
    state.planetBuff = p.planetBuff && typeof p.planetBuff === 'object' ? p.planetBuff : null;
    resetLazyUserFileState();
    state.planetActions = p.planetActions && typeof p.planetActions === 'object' ? p.planetActions : {};
    state.planetInfrastructure = p.planetInfrastructure && typeof p.planetInfrastructure === 'object' ? p.planetInfrastructure : {};
    state.planetMining = p.planetMining && typeof p.planetMining === 'object' ? p.planetMining : {};
    state.haqiIslandFarewells = normalizeFarewellPetIds(p.haqiIslandFarewells);
    state.invitedPets = Array.isArray(p.invitedPets) ? p.invitedPets.slice(0, 10).filter(item => item && typeof item === 'object') : [];
    state.activeInvitedPet = state.invitedPets[0] || null;
    state.remotePlanetDiscoveries = p.remotePlanetDiscoveries && typeof p.remotePlanetDiscoveries === 'object' ? p.remotePlanetDiscoveries : {};
    state.remoteElementStocks = p.remoteElementStocks && typeof p.remoteElementStocks === 'object' ? p.remoteElementStocks : {};
    const ls = p.lifetimeStats && typeof p.lifetimeStats === 'object' ? p.lifetimeStats : {};
    state.lifetimeStats = {
        feeds: Math.max(0, Number(ls.feeds) || 0),
        poopsCleaned: Math.max(0, Number(ls.poopsCleaned) || 0),
        adultsRaised: Math.max(0, Number(ls.adultsRaised) || 0),
    };
    const ach = p.achievements && typeof p.achievements === 'object' ? p.achievements : {};
    state.achievements = { claimed: (ach.claimed && typeof ach.claimed === 'object') ? ach.claimed : {} };
    _legacyStoryProgress = p.storyProgress && typeof p.storyProgress === 'object' ? p.storyProgress : null;
    state.storyProgress = normalizeStoryProgressPayload(_legacyStoryProgress);
    state.playSessionStartedAt = 0;
    state.petOrder = Array.isArray(p.petOrder) ? p.petOrder.filter(id => typeof id === 'string' && id) : [];
    state.currentPetId = typeof p.currentPetId === 'string' && p.currentPetId ? p.currentPetId : null;
    state.inventoryOrder = [];
    return p;
}

export async function saveUserProfile() {
    await writeJSON(PATHS.userProfile, getUserProfilePayload());
}

export function saveUserProfileDebounced() {
    saveJSONDebounced(PATHS.userProfile, getUserProfilePayload());
}

let _planetVisitorsLoaded = false;
let _planetVisitorsLoading = null;
let _recentFriendPlanetsLoaded = false;
let _recentFriendPlanetsLoading = null;
let _storyProgressLoaded = false;
let _storyProgressLoading = null;
let _legacyStoryProgress = null;

function resetLazyUserFileState() {
    state.planetVisitors = [];
    state.recentFriendPlanets = [];
    state.storyProgress = normalizeStoryProgressPayload(null);
    _planetVisitorsLoaded = false;
    _planetVisitorsLoading = null;
    _recentFriendPlanetsLoaded = false;
    _recentFriendPlanetsLoading = null;
    _storyProgressLoaded = false;
    _storyProgressLoading = null;
    _legacyStoryProgress = null;
}

export async function loadPlanetVisitors() {
    if (_planetVisitorsLoaded) return state.planetVisitors || [];
    if (_planetVisitorsLoading) return _planetVisitorsLoading;
    _planetVisitorsLoading = (async () => {
        let stored = normalizePlanetVisitors(await readJSON(PATHS.planetVisitors, []));
        if (!stored.length) {
            stored = getPersistentPlanetVisitors(normalizePlanetVisitors((await readJSON(PATHS.userProfile, {}))?.planetVisitors));
            if (stored.length) saveJSONDebounced(PATHS.planetVisitors, stored);
        }
        state.planetVisitors = mergePlanetVisitors(state.planetVisitors || [], stored);
        _planetVisitorsLoaded = true;
        return state.planetVisitors;
    })().finally(() => { _planetVisitorsLoading = null; });
    return _planetVisitorsLoading;
}

export function savePlanetVisitorsDebounced() {
    saveJSONDebounced(PATHS.planetVisitors, getPersistentPlanetVisitors(state.planetVisitors));
}

export function recordPlanetVisitor(entry) {
    const normalized = normalizePlanetVisitorRecord(entry);
    if (!normalized) return;
    state.planetVisitors = mergePlanetVisitors([normalized], state.planetVisitors || []);
    if (NON_PERSISTENT_PLANET_VISITOR_TYPES.has(normalized.type)) return;
    (async () => {
        if (!_planetVisitorsLoaded) await loadPlanetVisitors();
        state.planetVisitors = mergePlanetVisitors([normalized], state.planetVisitors || []);
        savePlanetVisitorsDebounced();
    })();
}

export async function loadRecentFriendPlanets() {
    if (_recentFriendPlanetsLoaded) return state.recentFriendPlanets || [];
    if (_recentFriendPlanetsLoading) return _recentFriendPlanetsLoading;
    _recentFriendPlanetsLoading = (async () => {
        let stored = normalizeRecentFriendPlanets(await readJSON(PATHS.recentFriendPlanets, []));
        if (!stored.length) {
            stored = normalizeRecentFriendPlanets((await readJSON(PATHS.userProfile, {}))?.recentFriendPlanets);
            if (stored.length) saveJSONDebounced(PATHS.recentFriendPlanets, stored);
        }
        state.recentFriendPlanets = stored;
        _recentFriendPlanetsLoaded = true;
        return state.recentFriendPlanets;
    })().finally(() => { _recentFriendPlanetsLoading = null; });
    return _recentFriendPlanetsLoading;
}

export function saveRecentFriendPlanetsDebounced() {
    saveJSONDebounced(PATHS.recentFriendPlanets, normalizeRecentFriendPlanets(state.recentFriendPlanets));
}

export async function loadStoryProgress(legacyProfileProgress = null) {
    if (_storyProgressLoaded) return state.storyProgress || normalizeStoryProgressPayload(null);
    if (_storyProgressLoading) return _storyProgressLoading;
    const fallback = legacyProfileProgress && typeof legacyProfileProgress === 'object' ? legacyProfileProgress : _legacyStoryProgress;
    _storyProgressLoading = (async () => {
        const saved = await readJSON(PATHS.storyProgress, null);
        state.storyProgress = saved && typeof saved === 'object'
            ? normalizeStoryProgressPayload(saved)
            : normalizeStoryProgressPayload(fallback);
        _storyProgressLoaded = true;
        return state.storyProgress;
    })().finally(() => { _storyProgressLoading = null; });
    return _storyProgressLoading;
}

export async function saveStoryProgress() {
    if (!_storyProgressLoaded) {
        const pending = normalizeStoryProgressPayload(state.storyProgress);
        const loaded = await loadStoryProgress();
        state.storyProgress = {
            ...loaded,
            completed: {
                ...(loaded?.completed || {}),
                ...(pending.completed || {}),
            },
        };
    }
    await saveJSONNow(PATHS.storyProgress, normalizeStoryProgressPayload(state.storyProgress));
}

export function saveStoryProgressDebounced() {
    saveJSONDebounced(PATHS.storyProgress, normalizeStoryProgressPayload(state.storyProgress));
}

export async function loadPostcardList() {
    const list = await readJSON(PATHS.postcardList, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizePostcardRecord).filter(Boolean).slice(0, 500);
}

export async function savePostcardList(list) {
    const normalized = Array.isArray(list) ? list.map(normalizePostcardRecord).filter(Boolean).slice(0, 500) : [];
    await writeJSON(PATHS.postcardList, normalized);
    return normalized;
}

export async function addPostcardRecord(record) {
    const normalized = normalizePostcardRecord(record);
    if (!normalized) return [];
    const existing = await loadPostcardList();
    const key = postcardRecordKey(normalized);
    const next = [normalized, ...existing.filter(item => postcardRecordKey(item) !== key)].slice(0, 500);
    await savePostcardList(next);
    return next;
}

export async function loadWorkspaceStory(pathOrName) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return null;
    const path = raw.includes('/') ? raw : PATHS.story(raw);
    return await readJSON(path.replace(/^\/+/, ''), null);
}

export async function loadWorkspaceStoryRecord(pathOrName) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return null;
    const path = raw.includes('/') ? raw : PATHS.story(raw);
    const cleanPath = path.replace(/^\/+/, '');
    const story = await loadWorkspaceStory(cleanPath);
    return story ? createStoryListRecord(story, cleanPath) : null;
}

export async function loadWorkspaceStoryList() {
    const list = await readJSON(PATHS.storyList, []);
    const indexed = (Array.isArray(list) ? list : [])
        .map(normalizeStoryListRecord)
        .filter(Boolean);
    const discovered = await discoverWorkspaceStoryRecords();
    const byPath = new Map();
    [...indexed, ...discovered].forEach(record => {
        if (!record?.path) return;
        const prev = byPath.get(record.path);
        byPath.set(record.path, !prev || (record.updatedAt || 0) >= (prev.updatedAt || 0) ? record : prev);
    });
    return [...byPath.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveWorkspaceStoryList(list) {
    const normalized = (Array.isArray(list) ? list : [])
        .map(normalizeStoryListRecord)
        .filter(Boolean)
        .slice(0, 300);
    await writeJSON(PATHS.storyList, normalized);
    return normalized;
}

export async function saveWorkspaceStory(story, name = '') {
    const baseName = safeStoryName(name || story?.id || story?.title || 'story');
    const path = PATHS.story(baseName);
    const payload = {
        ...story,
        id: story?.id || baseName,
        savedAt: Date.now(),
    };
    await writeJSON(path, payload);
    const record = createStoryListRecord(payload, path);
    const existing = await loadWorkspaceStoryList();
    const nextIndex = [record, ...existing.filter(item => item.path !== path)];
    await saveWorkspaceStoryList(nextIndex);
    return { path, story: payload, record, index: nextIndex };
}

export async function deleteWorkspaceStory(pathOrName) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return false;
    const path = (raw.includes('/') ? raw : PATHS.story(raw)).replace(/^\/+/, '');
    const existing = await loadWorkspaceStoryList();
    await saveWorkspaceStoryList(existing.filter(item => item.path !== path));
    await deleteFileSafe(path);
    return true;
}

// ========== 我创造的小游戏（pet-games/ 下以 HTML 文件存储） ==========
// 游戏正文存为 pet-games/<系统生成文件名>.html，索引摘要存为 pet-games/index.json。
const PET_GAME_DIR = 'pet-games';
const PET_GAME_INDEX = `${PET_GAME_DIR}/index.json`;

function safePetGameBaseName(name) {
    const text = String(name || '').trim().replace(/\.html?$/i, '');
    return (text || 'game_' + Date.now())
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
        .slice(0, 64) || ('game_' + Date.now());
}

function petGamePath(name) {
    return `${PET_GAME_DIR}/${safePetGameBaseName(name)}.html`;
}

function petGamePathFromMetaPath(path) {
    const clean = String(path || '').trim().replace(/^\/+/, '');
    return clean && /^pet-games\/[^/]+\.html?$/i.test(clean) ? clean : '';
}

function randomPetGameLetters(length = 6) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let text = '';
    for (let i = 0; i < length; i++) text += alphabet[Math.floor(Math.random() * alphabet.length)];
    return text;
}

function generatedPetGameBaseName(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    return `game-${stamp}-${randomPetGameLetters()}`;
}

function normalizePetGameRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const path = String(record.path || '').trim().replace(/^\/+/, '');
    if (!path || !/\.html?$/i.test(path)) return null;
    const id = String(record.id || path).slice(0, 120);
    return {
        path,
        id,
        title: String(record.title || record.id || '我的小游戏').slice(0, 80),
        icon: String(record.icon || '🎮').slice(0, 8),
        desc: String(record.desc || '').slice(0, 200),
        updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
        // 是否已发布到 Keepwork 作品广场（userWorks）。发布成功后置 true 并持久化。
        isPublished: !!record.isPublished,
    };
}

function petGameTitleFromPath(path) {
    const filename = String(path || '').split('/').pop() || '';
    return filename.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ').trim() || '我的小游戏';
}

function normalizePetGameHtml(content) {
    const raw = String(content == null ? '' : content).trim();
    if (!raw) return '';
    // 围栏边界要求 ``` 独占一行（真正的 Markdown 代码块写法），避免游戏自身源码里
    // 内联出现的字面 ```（例如某些小游戏的 stripFence 正则里紧挨着的两个 ```）被
    // 误判成围栏起止，导致保存/读取时把整份代码从中间截断成一小段乱码。
    const fence = raw.match(/^[ \t]*```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/m);
    const candidate = (fence ? fence[1] : raw).trim();
    const docMatch = candidate.match(/<!DOCTYPE[\s\S]*<\/html>/i) || candidate.match(/<html[\s\S]*<\/html>/i);
    if (docMatch) return docMatch[0].trim();
    if (/<(canvas|div|script|style|svg|body)/i.test(candidate)) {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${candidate}</body></html>`;
    }
    return candidate;
}

// 仅依据 pet-games/index.json 列出我创造的小游戏（不再 listDir 扫描目录）。
export async function loadPetGameList() {
    const list = await readJSON(PET_GAME_INDEX, []);
    const byPath = new Map();
    (Array.isArray(list) ? list : [])
        .map(normalizePetGameRecord)
        .filter(Boolean)
        .forEach(record => {
            if (!record?.path) return;
            const prev = byPath.get(record.path);
            byPath.set(record.path, !prev || (record.updatedAt || 0) >= (prev.updatedAt || 0) ? record : prev);
        });
    return [...byPath.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function savePetGameList(list) {
    const normalized = (Array.isArray(list) ? list : [])
        .map(normalizePetGameRecord)
        .filter(Boolean)
        .slice(0, 300);
    await writeJSON(PET_GAME_INDEX, normalized);
    return normalized;
}

export async function loadPetGameHtml(pathOrName) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return '';
    const path = (raw.includes('/') ? raw : petGamePath(raw)).replace(/^\/+/, '');
    return normalizePetGameHtml(await readFileSafe(path));
}

// 保存游戏：html 必填，meta 可包含 { title, icon, desc, path }。首次保存使用系统生成文件名；再次保存沿用 path。
export async function savePetGame(html, meta = {}) {
    const existing = await loadPetGameList();
    const existingPath = petGamePathFromMetaPath(meta.path);
    const usedPaths = new Set(existing.map(item => item.path));
    let path = existingPath;
    while (!path) {
        const candidate = petGamePath(generatedPetGameBaseName());
        if (!usedPaths.has(candidate)) path = candidate;
    }
    const baseName = path.split('/').pop().replace(/\.html?$/i, '');
    await writeFileSafe(path, normalizePetGameHtml(html));
    const prev = existing.find(item => item.path === path);
    const record = normalizePetGameRecord({
        path,
        id: meta.id || baseName,
        title: meta.title || petGameTitleFromPath(path),
        icon: meta.icon || '🎮',
        desc: meta.desc || '',
        updatedAt: Date.now(),
        // 重新保存 / 编辑同一个游戏时保留已发布标记（meta 不携带该字段）。
        isPublished: meta.isPublished != null ? meta.isPublished : prev?.isPublished,
    });
    const nextIndex = [record, ...existing.filter(item => item.path !== path)];
    await savePetGameList(nextIndex);
    return { path, record, index: nextIndex };
}

function workBuddyDraftPath(pathOrId) {
    const raw = String(pathOrId || '').trim().replace(/^\/+/, '');
    if (!raw) return '';
    if (/^workbuddy-drafts\/[^/]+\.json$/i.test(raw)) return raw;
    const id = raw.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 96);
    return id ? `workbuddy-drafts/${id}.json` : '';
}

function normalizeWorkBuddyGameDraft(data, source = '') {
    if (!data || typeof data !== 'object') return null;
    const html = String(data?.html || data?.code || data?.content || '').trim();
    if (!html) return null;
    return {
        path: source,
        title: String(data?.title || data?.name || 'WorkBuddy 小游戏').slice(0, 80),
        icon: String(data?.icon || '🎮').slice(0, 8),
        desc: String(data?.desc || data?.description || '').slice(0, 200),
        html,
    };
}

function decodeLooseJsonString(text) {
    return String(text || '')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

function extractLooseJsonField(raw, key) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const match = String(raw || '').match(pattern);
    return match ? decodeLooseJsonString(match[1]) : '';
}

function parseLooseWorkBuddyGameDraft(raw, source = '') {
    const marker = String(raw || '').match(/"html"\s*:\s*"/);
    if (!marker) return null;
    const start = marker.index + marker[0].length;
    const end = String(raw || '').lastIndexOf('"');
    if (end <= start) return null;
    const html = decodeLooseJsonString(String(raw || '').slice(start, end)).trim();
    if (!html) return null;
    return normalizeWorkBuddyGameDraft({
        title: extractLooseJsonField(raw, 'title'),
        icon: extractLooseJsonField(raw, 'icon'),
        desc: extractLooseJsonField(raw, 'desc'),
        html,
    }, source);
}

function parseWorkBuddyGameDraftText(text, source = '') {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        return normalizeWorkBuddyGameDraft(JSON.parse(raw), source);
    } catch (_) {
        return parseLooseWorkBuddyGameDraft(raw, source);
    }
}

function isRemoteWorkBuddyDraft(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (_) {
        return false;
    }
}

async function loadRemoteWorkBuddyGameDraft(urlText) {
    const url = String(urlText || '').trim();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`草稿读取失败 HTTP ${res.status}`);
    return parseWorkBuddyGameDraftText(await res.text(), url);
}

// WorkBuddy 可以传 CloudStudio 草稿 URL，也可以把草稿 JSON 写到 workbuddy-drafts/<draftId>.json。
// 蛋蛋星球读取后仍走 savePetGame()，由本应用维护 pet-games/index.json。
export async function loadWorkBuddyGameDraft(pathOrId) {
    if (isRemoteWorkBuddyDraft(pathOrId)) return await loadRemoteWorkBuddyGameDraft(pathOrId);
    const path = workBuddyDraftPath(pathOrId);
    if (!path) return null;
    const text = await readFileSafe(path);
    if (!text.trim()) return null;
    return parseWorkBuddyGameDraftText(text, path);
}

// 更新单个游戏的发布状态（发布到 Keepwork 作品广场成功后调用），并持久化到索引。
export async function setPetGamePublished(pathOrName, isPublished = true) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return null;
    const path = (raw.includes('/') ? raw : petGamePath(raw)).replace(/^\/+/, '');
    const existing = await loadPetGameList();
    let updatedRecord = null;
    const nextIndex = existing.map(item => {
        if (item.path !== path) return item;
        updatedRecord = { ...item, isPublished: !!isPublished };
        return updatedRecord;
    });
    if (!updatedRecord) return null;
    await savePetGameList(nextIndex);
    return updatedRecord;
}

// 删除我的小游戏。默认连同 HTML 文件一并删除；keepFile=true 时只从索引（pet-games/index.json）
// 移除，保留 HTML 文件——用于已发布到作品广场的游戏，删除「我的」列表条目但不破坏线上作品链接。
export async function deletePetGame(pathOrName, { keepFile = false } = {}) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return false;
    const path = (raw.includes('/') ? raw : petGamePath(raw)).replace(/^\/+/, '');
    const existing = await loadPetGameList();
    await savePetGameList(existing.filter(item => item.path !== path));
    if (!keepFile) await deleteFileSafe(path);
    return true;
}

// ========== 探索「已看过」记录（7 天内不再重复推送同一个作品） ==========
// 双层存储：完整历史放本地 IndexedDB（容量大、不限条数）；个人主页存储只同步最近
// EXPLORE_SEEN_STORE_MAX 条（体积可控、可跨设备）。读取时合并两者，写入时两边都更新。
const EXPLORE_SEEN_FILE = 'user/explore_seen.json';
const EXPLORE_SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXPLORE_SEEN_STORE_MAX = 300;     // 同步到个人主页存储的上限
const EXPLORE_SEEN_DB_MAX = 2000;       // 本地 IndexedDB 完整历史的上限（超出按最旧裁剪）

const EXPLORE_SEEN_DB = 'MagicHaqiExploreSeen';
const EXPLORE_SEEN_STORE = 'seen';
let _exploreSeenDbPromise = null;

function openExploreSeenDb() {
    if (_exploreSeenDbPromise) return _exploreSeenDbPromise;
    _exploreSeenDbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return; }
        const req = indexedDB.open(EXPLORE_SEEN_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(EXPLORE_SEEN_STORE)) {
                db.createObjectStore(EXPLORE_SEEN_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    }).catch((e) => { _exploreSeenDbPromise = null; throw e; });
    return _exploreSeenDbPromise;
}

// 只保留 7 天内的记录，返回 { key: seenAt } 映射。
function pruneExploreSeen(raw) {
    const now = Date.now();
    const out = {};
    if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(key => {
            const ts = Number(raw[key]) || 0;
            if (ts && now - ts < EXPLORE_SEEN_TTL_MS) out[String(key).slice(0, 200)] = ts;
        });
    }
    return out;
}

// 读取 IndexedDB 里的完整已看过历史（剔除 7 天前的，并异步清理过期行）。
async function loadExploreSeenFromDb() {
    try {
        const db = await openExploreSeenDb();
        const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction(EXPLORE_SEEN_STORE, 'readonly');
            const req = tx.objectStore(EXPLORE_SEEN_STORE).getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error);
        });
        const now = Date.now();
        const map = {};
        const expired = [];
        const valid = [];
        rows.forEach(r => {
            const key = r?.key;
            const ts = Number(r?.seenAt) || 0;
            if (!key || !ts) return;
            if (now - ts < EXPLORE_SEEN_TTL_MS) { map[key] = ts; valid.push({ key, seenAt: ts }); }
            else expired.push(key);
        });
        // 超出条数上限时，连同过期行一起把最旧的裁掉（map 也同步去掉，避免返回被删的 key）。
        let toDelete = expired;
        if (valid.length > EXPLORE_SEEN_DB_MAX) {
            valid.sort((a, b) => a.seenAt - b.seenAt);
            const overflow = valid.slice(0, valid.length - EXPLORE_SEEN_DB_MAX);
            overflow.forEach(({ key }) => { delete map[key]; });
            toDelete = expired.concat(overflow.map(({ key }) => key));
        }
        if (toDelete.length) pruneExploreSeenDb(db, toDelete).catch(() => {});
        return map;
    } catch (_) { return {}; }
}

async function pruneExploreSeenDb(db, keys) {
    await new Promise((resolve) => {
        const tx = db.transaction(EXPLORE_SEEN_STORE, 'readwrite');
        const store = tx.objectStore(EXPLORE_SEEN_STORE);
        keys.forEach(k => { if (k) store.delete(k); });
        tx.oncomplete = resolve;
        tx.onerror = resolve;
    });
}

// 往 IndexedDB 写若干条已看过记录（完整历史，无 300 上限）。
async function putExploreSeenToDb(entries) {
    if (!entries.length) return;
    try {
        const db = await openExploreSeenDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(EXPLORE_SEEN_STORE, 'readwrite');
            const store = tx.objectStore(EXPLORE_SEEN_STORE);
            entries.forEach(({ key, seenAt }) => { if (key) store.put({ key, seenAt: Number(seenAt) || Date.now() }); });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (_) { /* IndexedDB 不可用时仅靠个人主页存储 */ }
}

// 读取探索已看过记录：合并 IndexedDB 完整历史 + 个人主页存储（最近 300，可跨设备），均剔除 7 天前的。
// 同时把「文件里有、但本地 IndexedDB 没有」的记录回填到 IndexedDB（吸收其它设备同步过来的记录）。
export async function loadExploreSeen() {
    const fromFile = pruneExploreSeen(await readJSON(EXPLORE_SEEN_FILE, {}));
    const fromDb = await loadExploreSeenFromDb();
    const merged = { ...fromDb };
    const backfill = [];
    Object.keys(fromFile).forEach(key => {
        const ts = fromFile[key];
        if (!merged[key] || ts > merged[key]) merged[key] = ts;
        if (!fromDb[key]) backfill.push({ key, seenAt: ts });
    });
    if (backfill.length) putExploreSeenToDb(backfill);
    return merged;
}

// 记录单个作品为已看过：写入 IndexedDB 完整历史（不限条数）。
export function recordExploreSeen(key, seenAt = Date.now()) {
    const k = String(key || '').trim();
    if (!k) return;
    putExploreSeenToDb([{ key: k.slice(0, 200), seenAt }]);
}

// 同步「已看过」到个人主页存储：剔除过期 + 只保留最近 EXPLORE_SEEN_STORE_MAX 条（防抖写盘）。
export function saveExploreSeen(map) {
    const pruned = pruneExploreSeen(map);
    const capped = Object.keys(pruned)
        .sort((a, b) => pruned[b] - pruned[a])
        .slice(0, EXPLORE_SEEN_STORE_MAX)
        .reduce((acc, key) => { acc[key] = pruned[key]; return acc; }, {});
    saveJSONDebounced(EXPLORE_SEEN_FILE, capped);
    return capped;
}

// ========== 伴学游戏（study-games/ 下以 HTML 文件存储） ==========
// 与 pet-games 同构，但独立命名空间，供 dev_tools/AITestGenerator.html 使用，
// 与「我创造的小游戏」列表互不混淆。复用上方的纯函数 helper（normalize / 文件名生成等）。
const STUDY_GAME_DIR = 'study-games';
const STUDY_GAME_INDEX = `${STUDY_GAME_DIR}/index.json`;
const STUDENT_MEMORY_DIR = `${STUDY_GAME_DIR}/memory`;

function studyGamePath(name) {
    return `${STUDY_GAME_DIR}/${safePetGameBaseName(name)}.html`;
}
function studyGamePathFromMetaPath(path) {
    const clean = String(path || '').trim().replace(/^\/+/, '');
    return clean && /^study-games\/[^/]+\.html?$/i.test(clean) ? clean : '';
}

export async function loadStudyGameList() {
    const list = await readJSON(STUDY_GAME_INDEX, []);
    const byPath = new Map();
    (Array.isArray(list) ? list : [])
        .map(normalizePetGameRecord)
        .filter(Boolean)
        .forEach(record => {
            if (!record?.path) return;
            const prev = byPath.get(record.path);
            byPath.set(record.path, !prev || (record.updatedAt || 0) >= (prev.updatedAt || 0) ? record : prev);
        });
    return [...byPath.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function saveStudyGameList(list) {
    const normalized = (Array.isArray(list) ? list : [])
        .map(normalizePetGameRecord)
        .filter(Boolean)
        .slice(0, 300);
    await writeJSON(STUDY_GAME_INDEX, normalized);
    return normalized;
}

export async function loadStudyGameHtml(pathOrName) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return '';
    const path = (raw.includes('/') ? raw : studyGamePath(raw)).replace(/^\/+/, '');
    return normalizePetGameHtml(await readFileSafe(path));
}

// 保存伴学游戏：html 必填，meta 可包含 { title, icon, desc, path }。首次保存使用系统生成文件名；再次保存沿用 path。
export async function saveStudyGame(html, meta = {}) {
    const existing = await loadStudyGameList();
    const existingPath = studyGamePathFromMetaPath(meta.path);
    const usedPaths = new Set(existing.map(item => item.path));
    let path = existingPath;
    while (!path) {
        const candidate = studyGamePath(generatedPetGameBaseName());
        if (!usedPaths.has(candidate)) path = candidate;
    }
    const baseName = path.split('/').pop().replace(/\.html?$/i, '');
    await writeFileSafe(path, normalizePetGameHtml(html));
    const record = normalizePetGameRecord({
        path,
        id: meta.id || baseName,
        title: meta.title || petGameTitleFromPath(path),
        icon: meta.icon || '📚',
        desc: meta.desc || '',
        updatedAt: Date.now(),
    });
    const nextIndex = [record, ...existing.filter(item => item.path !== path)];
    await saveStudyGameList(nextIndex);
    return { path, record, index: nextIndex };
}

export async function deleteStudyGame(pathOrName) {
    const raw = String(pathOrName || '').trim();
    if (!raw) return false;
    const path = (raw.includes('/') ? raw : studyGamePath(raw)).replace(/^\/+/, '');
    const existing = await loadStudyGameList();
    await saveStudyGameList(existing.filter(item => item.path !== path));
    await deleteFileSafe(path);
    return true;
}

// ---------- 学生长期记忆（study-games/memory/<studentId>.md） ----------
// 供数字人「记得」学生：掌握项、反复错点、偏好题型、历史会话摘要。
// 沿用 pets/<id>.memory.md 的 8KB 头摘要轮转约定。
function safeStudentId(id) {
    return String(id || '').trim().replace(/[^a-zA-Z0-9_\-一-龥]/g, '_').slice(0, 64) || 'default';
}
function studentMemoryPath(studentId) {
    return `${STUDENT_MEMORY_DIR}/${safeStudentId(studentId)}.md`;
}

export async function loadStudentMemory(studentId) {
    return await readFileSafe(studentMemoryPath(studentId));
}

export async function appendStudentMemory(studentId, line) {
    if (!line) return;
    const id = safeStudentId(studentId);
    const cur = await loadStudentMemory(id);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const newLine = `- [${stamp}] ${String(line).trim()}\n`;
    let next = (cur || `# ${id} 的伴学记忆\n\n`) + newLine;
    if (next.length > CONFIG.memoryMaxBytes) {
        const head = next.slice(0, 200);
        const tail = next.slice(-CONFIG.memoryMaxBytes + 300);
        next = head + '\n\n... (旧记忆已归档) ...\n\n' + tail;
    }
    await writeFileSafe(studentMemoryPath(id), next);
}

// 读取别人 workspace 下分享的小游戏 HTML（用于分享链接 / 收藏的他人作品试玩）。
function safeShareUsername(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export async function loadRemotePetGameHtml(fromUsername, pathOrName) {
    const username = safeShareUsername(fromUsername);
    const raw = String(pathOrName || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
    if (!username || !raw || raw.includes('..')) return '';
    const relPath = raw.includes('/') ? raw : petGamePath(raw);
    if (!/^pet-games\/[^/]+\.html?$/i.test(relPath)) return '';
    if (!state.sdk?.personalPageStore?.readFile) return '';
    const absolutePath = `//${username}/edunotes/store/${CONFIG.workspace}/${relPath}`;
    try {
        const text = await state.sdk.personalPageStore.readFile(absolutePath, 1, 99999);
        return normalizePetGameHtml(text || '');
    } catch (e) {
        console.warn('读取分享小游戏失败', e);
        return '';
    }
}

// 读取别人 workspace 下的小游戏清单（pet-games/index.json），用于"某用户的全部小游戏"列表。
export async function loadRemotePetGameList(fromUsername) {
    const username = safeShareUsername(fromUsername);
    if (!username || !state.sdk?.personalPageStore?.readFile) return [];
    const absolutePath = `//${username}/edunotes/store/${CONFIG.workspace}/${PET_GAME_INDEX}`;
    try {
        const text = await state.sdk.personalPageStore.readFile(absolutePath, 1, 99999);
        if (!text) return [];
        const list = JSON.parse(text);
        const byPath = new Map();
        (Array.isArray(list) ? list : [])
            .map(normalizePetGameRecord)
            .filter(Boolean)
            .forEach(record => {
                if (!record?.path) return;
                const prev = byPath.get(record.path);
                byPath.set(record.path, !prev || (record.updatedAt || 0) >= (prev.updatedAt || 0) ? record : prev);
            });
        return [...byPath.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (e) {
        console.warn('读取用户小游戏清单失败', e);
        return [];
    }
}

// ========== 收藏的小游戏（list_liked_games.json，与明信片同在 user/ 目录） ==========
// 既可收藏官方小游戏（owner 为空），也可收藏自己/别人创造的小游戏（owner 为作者 username）。
// 文件里只保存 id / owner / title / icon 四个字段；其余信息（path/src/official）由 id+owner 在内存推导。
function likedGameKey(record) {
    const owner = safeShareUsername(record?.owner || '');
    const id = String(record?.id || '').trim().replace(/^\/+/, '');
    return `${owner}::${id}`;
}

// 仅保留 id / owner / title / icon 四个字段写入磁盘。
function normalizeLikedGameRecord(record) {
    if (!record || typeof record !== 'object') return null;
    // id 统一为不含目录、不含扩展名的基础名（与 pet-games 文件基础名一致）。
    let id = String(record.id || record.path || record.src || '').trim().replace(/^\/+/, '');
    id = id.split('/').pop().replace(/\.html?$/i, '');
    if (!id) return null;
    return {
        id: id.slice(0, 200),
        owner: safeShareUsername(record.owner || ''),
        title: String(record.title || id).slice(0, 80),
        icon: String(record.icon || '🎮').slice(0, 8),
    };
}

export async function loadLikedGames() {
    const list = await readJSON(PATHS.likedGames, []);
    // 文件顺序即收藏顺序（新收藏在前），不再依赖 likedAt 排序。
    return (Array.isArray(list) ? list : [])
        .map(normalizeLikedGameRecord)
        .filter(Boolean)
        .slice(0, 300);
}

// 紧凑写入：整体为 JSON 数组，但每条记录单独占一行。
function writeLikedGamesCompact(records) {
    const body = records.map(r => JSON.stringify(r)).join(',\n  ');
    const text = records.length ? `[\n  ${body}\n]` : '[]';
    return writeFileSafe(PATHS.likedGames, text);
}

export async function saveLikedGames(list) {
    const normalized = (Array.isArray(list) ? list : [])
        .map(normalizeLikedGameRecord)
        .filter(Boolean)
        .slice(0, 300);
    await writeLikedGamesCompact(normalized);
    return normalized;
}

export async function addLikedGame(record) {
    const normalized = normalizeLikedGameRecord(record);
    if (!normalized) return null;
    const existing = await loadLikedGames();
    const key = likedGameKey(normalized);
    const next = [normalized, ...existing.filter(item => likedGameKey(item) !== key)].slice(0, 300);
    await saveLikedGames(next);
    return normalized;
}

export async function removeLikedGame(record) {
    const key = likedGameKey(normalizeLikedGameRecord(record) || record);
    const existing = await loadLikedGames();
    const next = existing.filter(item => likedGameKey(item) !== key);
    await saveLikedGames(next);
    return next;
}

// ========== 最近玩过的小游戏（本地 IndexedDB，仅当前设备，不同步） ==========
// 用于"推荐"标签按最近游玩时间排序，并在卡片上显示"N 天前"。
const RECENT_GAMES_DB = 'MagicHaqiRecentGames';
const RECENT_GAMES_STORE = 'recent';
const RECENT_GAMES_MAX = 200;
let _recentGamesDbPromise = null;

function openRecentGamesDb() {
    if (_recentGamesDbPromise) return _recentGamesDbPromise;
    _recentGamesDbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return; }
        const req = indexedDB.open(RECENT_GAMES_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(RECENT_GAMES_STORE)) {
                db.createObjectStore(RECENT_GAMES_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    }).catch((e) => { _recentGamesDbPromise = null; throw e; });
    return _recentGamesDbPromise;
}

// 记录某个游戏的最近游玩时间。key 由调用方按 owner::id 等规则生成。
// meta（可选 { id, owner, title, icon }）用于历史游戏在"推荐"里重建可渲染 / 可重玩的条目。
export async function recordRecentGame(key, meta = {}) {
    const k = String(key || '').trim();
    if (!k) return false;
    try {
        const db = await openRecentGamesDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(RECENT_GAMES_STORE, 'readwrite');
            tx.objectStore(RECENT_GAMES_STORE).put({
                key: k,
                playedAt: Date.now(),
                id: String(meta.id || '').slice(0, 200),
                owner: String(meta.owner || '').slice(0, 64),
                title: String(meta.title || '').slice(0, 80),
                icon: String(meta.icon || '🎮').slice(0, 8),
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return true;
    } catch (e) {
        console.warn('记录最近游玩失败', e);
        return false;
    }
}

// 返回最近游玩记录数组 [{ key, playedAt, id, owner, title, icon }]，按最近游玩时间倒序。
// 供"推荐"排序、历史游戏重建与"N 天前"显示。
export async function loadRecentGames() {
    try {
        const db = await openRecentGamesDb();
        const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction(RECENT_GAMES_STORE, 'readonly');
            const req = tx.objectStore(RECENT_GAMES_STORE).getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error);
        });
        // 超出上限时裁剪最旧的（异步清理，不阻塞返回）。
        if (rows.length > RECENT_GAMES_MAX) pruneRecentGames(db, rows).catch(() => {});
        return rows
            .filter(r => r?.key)
            .map(r => ({
                key: r.key,
                playedAt: Number(r.playedAt) || 0,
                id: r.id || '',
                owner: r.owner || '',
                title: r.title || '',
                icon: r.icon || '🎮',
            }))
            .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
    } catch (e) {
        console.warn('读取最近游玩失败', e);
        return [];
    }
}

async function pruneRecentGames(db, rows) {
    const sorted = [...rows].sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
    const toDelete = sorted.slice(RECENT_GAMES_MAX);
    if (!toDelete.length) return;
    await new Promise((resolve) => {
        const tx = db.transaction(RECENT_GAMES_STORE, 'readwrite');
        const store = tx.objectStore(RECENT_GAMES_STORE);
        toDelete.forEach(r => { if (r?.key) store.delete(r.key); });
        tx.oncomplete = resolve;
        tx.onerror = resolve;
    });
}

// ========== 宠物 ==========
export async function loadPet(petId) {
    if (!petId) return null;
    if (state.pets[petId]) return state.pets[petId];
    const pet = await readJSON(PATHS.pet(petId), null);
    if (!pet || !pet.id) return null;
    normalizePetRuntimeData(pet);
    state.pets[pet.id] = pet;
    if (!state.petOrder.includes(pet.id)) state.petOrder.push(pet.id);
    return pet;
}

export async function loadPets(petIds = []) {
    const loaded = [];
    for (const id of petIds) {
        const pet = await loadPet(id);
        if (pet) loaded.push(pet);
    }
    return loaded;
}

export async function loadAllPets() {
    state.pets = {};
    const profile = await readJSON(PATHS.userProfile, {});
    const ids = Array.isArray(profile?.petOrder)
        ? profile.petOrder.filter(id => typeof id === 'string' && id)
        : (state.petOrder || []);
    const profileCurrentPetId = typeof profile?.currentPetId === 'string' && profile.currentPetId ? profile.currentPetId : null;
    state.petOrder = ids.slice();
    state.currentPetId = profileCurrentPetId || state.currentPetId || ids[0] || null;

    if (state.currentPetId) {
        const current = await loadPet(state.currentPetId);
        if (!current) state.currentPetId = null;
    }

    if (!state.currentPetId && ids.length > 0) {
        for (const id of ids) {
            const pet = await loadPet(id);
            if (pet) {
                state.currentPetId = pet.id;
                break;
            }
        }
    }

    if (profileCurrentPetId !== state.currentPetId) {
        await saveUserProfile();
    }

    // layouts / inventory 属于用户共享数据，按需加载一次
    resetLayoutsLoadState();
    state.inventory = {};
    _inventoryLoaded = false;
}

// ---------- 按需加载用户共享 layouts / inventory ----------
let _layoutsLoaded = false;
let _inventoryLoaded = false;
let _layoutsLoading = null;
let _inventoryLoading = null;

export function ensurePetLayouts(_petId) {
    if (_layoutsLoaded) return Promise.resolve(state.layouts || {});
    if (_layoutsLoading) return _layoutsLoading;
    _layoutsLoading = (async () => {
        const path = currentLayoutsPath();
        const data = await readJSON(path, {});
        state.layouts = normalizeLayoutsData(data);
        const loadedTerrainFields = extractLayoutsTerrainFields(state.layouts);
        const loadedFieldScenes = extractLayoutsFieldScenes(state.layouts);
        const officialPlanet = state.settings?.starSettlement?.source === 'official';
        const fallbackTerrainFields = officialPlanet ? state.settings?.terrainFields : null;
        const fallbackFieldScenes = officialPlanet ? state.settings?.fieldScenes : null;
        setActiveSettingsTerrainFields(officialPlanet && Array.isArray(fallbackTerrainFields?.slots) && fallbackTerrainFields.slots.length
            ? fallbackTerrainFields
            : loadedTerrainFields);
        setActiveSettingsFieldScenes(officialPlanet && fallbackFieldScenes && typeof fallbackFieldScenes === 'object' && Object.keys(fallbackFieldScenes).length
            ? fallbackFieldScenes
            : loadedFieldScenes);
        const hasLegacyKeys = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).some(key => key !== 'fieldScenes' && key !== 'terrainFields' && key !== normalizeLayoutRoomKey(key));
        const hasNormalizedFields = JSON.stringify(extractLayoutsTerrainFields(data)) !== JSON.stringify(extractLayoutsTerrainFields(state.layouts));
        const hasNormalizedScenes = JSON.stringify(extractLayoutsFieldScenes(data)) !== JSON.stringify(extractLayoutsFieldScenes(state.layouts));
        if (hasLegacyKeys || hasNormalizedFields || hasNormalizedScenes) {
            saveJSONDebounced(path, state.layouts);
        }
        _layoutsLoaded = true;
        return state.layouts;
    })().finally(() => { _layoutsLoading = null; });
    return _layoutsLoading;
}

export function ensurePetInventory(_petId) {
    if (_inventoryLoaded) return Promise.resolve(state.inventory || {});
    if (_inventoryLoading) return _inventoryLoading;
    _inventoryLoading = (async () => {
        const data = await readJSON(PATHS.inventory, []);
        const normalized = normalizeInventoryData(data);
        state.inventory = normalized.inventory;
        state.inventoryOrder = normalized.order;
        // 默认 1 间小屋 (house_1) 永远在背包中，玩家不可消耗
        const defId = CONFIG.defaultHouseId || 'house_1';
        if (!(Number(state.inventory[defId]) > 0)) state.inventory[defId] = 1;
        if (!state.inventoryOrder.includes(defId)) state.inventoryOrder.push(defId);
        _inventoryLoaded = true;
        return state.inventory;
    })().finally(() => { _inventoryLoading = null; });
    return _inventoryLoading;
}

export async function ensurePetData(petId) {
    if (!petId) return;
    await Promise.all([ensurePetLayouts(petId), ensurePetInventory(petId)]);
}

export async function savePet(pet) {
    if (!pet?.id) return;
    const existing = _petSaveTimers.get(pet.id);
    if (existing) clearTimeout(existing);
    _petSaveTimers.delete(pet.id);
    _petSavePending.delete(pet.id);
    normalizePetRuntimeData(pet);
    state.pets[pet.id] = pet;
    if (!state.petOrder.includes(pet.id)) {
        state.petOrder.push(pet.id);
        await saveUserProfile();
    }
    await writeJSON(PATHS.pet(pet.id), createPetPayload(pet));
}

// 宠物配置使用独立的 20 秒防抖（每只宠物一个 timer），避免频繁写远端
const PET_SAVE_DEBOUNCE_MS = 20000;
const _petSaveTimers = new Map(); // petId -> timeoutId
const _petSavePending = new Map(); // petId -> latest pet object
function _flushPetSave(petId) {
    const pet = _petSavePending.get(petId);
    _petSavePending.delete(petId);
    _petSaveTimers.delete(petId);
    if (petId !== state.currentPetId) return;
    if (pet) writeJSON(PATHS.pet(petId), createPetPayload(pet));
}
export function savePetDebounced(pet) {
    if (!pet?.id) return;
    if (pet.id !== state.currentPetId) {
        _petSavePending.delete(pet.id);
        const existing = _petSaveTimers.get(pet.id);
        if (existing) clearTimeout(existing);
        _petSaveTimers.delete(pet.id);
        return;
    }
    normalizePetRuntimeData(pet);
    state.pets[pet.id] = pet;
    _petSavePending.set(pet.id, pet);
    const existing = _petSaveTimers.get(pet.id);
    if (existing) clearTimeout(existing);
    _petSaveTimers.set(pet.id, setTimeout(() => _flushPetSave(pet.id), PET_SAVE_DEBOUNCE_MS));
}

// 立即把所有挂起的宠物配置写出（供页面卸载等场景使用）
export function flushPetSaves() {
    const ids = [..._petSaveTimers.keys()];
    for (const id of ids) {
        const t = _petSaveTimers.get(id);
        if (t) clearTimeout(t);
        _flushPetSave(id);
    }
}
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { try { flushPetSaves(); } catch (_) {} });
    window.addEventListener('pagehide', () => { try { flushPetSaves(); } catch (_) {} });
}

export async function deletePet(id) {
    delete state.pets[id];
    state.petOrder = state.petOrder.filter(x => x !== id);
    if (state.currentPetId === id) {
        state.currentPetId = state.petOrder[0] || null;
    }
    await saveUserProfile();
    // 用空内容覆盖以软删除（仅使用 createFile）
    await writeFileSafe(PATHS.pet(id), '');
}

export async function setCurrentPetPersisted(id) {
    state.currentPetId = id;
    await saveUserProfile();
}

// ========== 布局 ==========
export async function saveLayout(petId, roomId, items, options = {}) {
    if (!_layoutsLoaded) await ensurePetLayouts(petId);
    if (!state.layouts) state.layouts = {};
    const key = normalizeLayoutRoomKey(roomId);
    state.layouts[key] = items;
    if (key !== roomId) delete state.layouts[roomId];
    if (options.persist !== false) saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts));
}

export async function saveFieldScenes(fieldScenes, options = {}) {
    const currentPetId = state.currentPetId || state.petOrder?.[0] || '';
    if (!_layoutsLoaded) await ensurePetLayouts(currentPetId);
    if (!state.layouts) state.layouts = {};
    setActiveSettingsFieldScenes(fieldScenes);
    applyLayoutsFieldScenes(state.layouts, state.settings?.fieldScenes || {});
    if (options.persist !== false) saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts));
}

export async function saveTerrainFields(terrainFields, options = {}) {
    const currentPetId = state.currentPetId || state.petOrder?.[0] || '';
    if (!_layoutsLoaded) await ensurePetLayouts(currentPetId);
    if (!state.layouts) state.layouts = {};
    setActiveSettingsTerrainFields(terrainFields);
    applyLayoutsTerrainFields(state.layouts, state.settings?.terrainFields || {});
    if (options.persist !== false) saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts));
}

export function saveTerrainFieldsDebounced(terrainFields) {
    if (!state.layouts) state.layouts = {};
    setActiveSettingsTerrainFields(terrainFields);
    applyLayoutsTerrainFields(state.layouts, state.settings?.terrainFields || {});
    if (!_layoutsLoaded) {
        const currentPetId = state.currentPetId || state.petOrder?.[0] || '';
        ensurePetLayouts(currentPetId).then(() => {
            applyLayoutsTerrainFields(state.layouts || {}, state.settings?.terrainFields || {});
            saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts || {}));
        });
        return;
    }
    saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts));
}

export function saveFieldScenesDebounced(fieldScenes) {
    if (!state.layouts) state.layouts = {};
    setActiveSettingsFieldScenes(fieldScenes);
    applyLayoutsFieldScenes(state.layouts, state.settings?.fieldScenes || {});
    if (!_layoutsLoaded) {
        const currentPetId = state.currentPetId || state.petOrder?.[0] || '';
        ensurePetLayouts(currentPetId).then(() => {
            applyLayoutsFieldScenes(state.layouts || {}, state.settings?.fieldScenes || {});
            saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts || {}));
        });
        return;
    }
    saveJSONDebounced(currentLayoutsPath(), normalizeLayoutsData(state.layouts));
}

export function getLayout(_petId, roomId) {
    return state.layouts?.[normalizeLayoutRoomKey(roomId)] || [];
}

// ========== 新手指引完成进度 ==========
// 进度写在“当前星球”的 layouts 文件里（official -> user/<planetId>.layouts.json，
// 否则 user/layouts.json）。通过 progressKey 显式指定星球，避免在启动早期受
// state.layouts 是否已加载影响；progressKey 为空时回退到当前激活的 layouts 文件。
function onboardingLayoutsPath(progressKey = '') {
    const planetId = safeLayoutPlanetId(progressKey);
    if (planetId && planetId !== 'default') return PATHS.planetLayouts(planetId);
    // default / custom 主星球使用通用 layouts 文件。
    if (planetId === 'default') return PATHS.layouts;
    return currentLayoutsPath();
}

/** 读取某个星球的新手指引完成进度（不修改 state.layouts，直接读文件）。 */
export async function loadOnboardingProgress(progressKey = '') {
    const path = onboardingLayoutsPath(progressKey);
    try {
        const data = await readJSON(path, {});
        return extractLayoutsOnboarding(normalizeLayoutsData(data));
    } catch (_) {
        return null;
    }
}

/** 判断某个星球的新手指引是否已完成。 */
export async function isOnboardingCompleted(progressKey = '') {
    const progress = await loadOnboardingProgress(progressKey);
    return !!progress?.completed;
}

/** 写入/合并某个星球的新手指引进度（completed / startedAt / mode 等）。 */
export async function saveOnboardingProgress(progressKey = '', patch = {}) {
    const path = onboardingLayoutsPath(progressKey);
    let data;
    try { data = await readJSON(path, {}); } catch (_) { data = {}; }
    const layouts = normalizeLayoutsData(data);
    const prev = extractLayoutsOnboarding(layouts) || {};
    const next = normalizeOnboardingProgress({ version: 1, ...prev, ...patch }) || { version: 1, ...patch };
    applyLayoutsOnboarding(layouts, next);
    // 若该文件正是当前激活的 layouts，则同步内存 state，避免后续覆盖。
    if (_layoutsLoaded && path === currentLayoutsPath() && state.layouts && typeof state.layouts === 'object') {
        applyLayoutsOnboarding(state.layouts, next);
    }
    await saveJSONNow(path, layouts);
    return next;
}

/** 标记某个星球的新手指引为已完成。 */
export async function markOnboardingCompleted(progressKey = '', mode = '') {
    return saveOnboardingProgress(progressKey, { completed: true, mode, completedAt: Date.now() });
}

// ========== 动物园图鉴学习/领养进度 ==========
// 每颗带图鉴的星球一个独立文件：user/<planetId>.encyclopedia.json
// 结构：{ version: 1, animals: { <animalId>: { learned, learnedAt, adopted, adoptedAt } } }
function encyclopediaProgressPath(planetId = '') {
    const safeId = safeLayoutPlanetId(planetId);
    return PATHS.planetEncyclopedia(safeId || 'default');
}

function normalizeEncyclopediaProgress(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const animals = data.animals && typeof data.animals === 'object' ? data.animals : {};
    const normalized = {};
    Object.entries(animals).forEach(([id, entry]) => {
        if (!id || !entry || typeof entry !== 'object') return;
        normalized[id] = {
            learned: !!entry.learned,
            learnedAt: Number(entry.learnedAt) || 0,
            adopted: !!entry.adopted,
            adoptedAt: Number(entry.adoptedAt) || 0,
        };
    });
    return { version: 1, animals: normalized };
}

/** 读取某颗星球的图鉴进度（learned / adopted 标记）。 */
export async function loadEncyclopediaProgress(planetId = '') {
    try {
        const data = await readJSON(encyclopediaProgressPath(planetId), {});
        return normalizeEncyclopediaProgress(data);
    } catch (_) {
        return normalizeEncyclopediaProgress(null);
    }
}

/** 合并写入某颗星球某只动物的图鉴进度（patch: { learned?, adopted? }）。 */
export async function saveEncyclopediaProgress(planetId = '', animalId = '', patch = {}) {
    const id = String(animalId || '').trim();
    if (!id) return null;
    const path = encyclopediaProgressPath(planetId);
    let data;
    try { data = await readJSON(path, {}); } catch (_) { data = {}; }
    const progress = normalizeEncyclopediaProgress(data);
    const prev = progress.animals[id] || { learned: false, learnedAt: 0, adopted: false, adoptedAt: 0 };
    const next = { ...prev };
    if (patch.learned && !prev.learned) { next.learned = true; next.learnedAt = Date.now(); }
    if (patch.adopted && !prev.adopted) { next.adopted = true; next.adoptedAt = Date.now(); }
    progress.animals[id] = next;
    await saveJSONNow(path, progress);
    return progress;
}

/** 清除某个星球的新手指引完成进度，供开发调试时重新触发 onboarding。 */
export async function clearOnboardingProgress(progressKey = '') {
    const path = onboardingLayoutsPath(progressKey);
    let data;
    try { data = await readJSON(path, {}); } catch (_) { data = {}; }
    const layouts = normalizeLayoutsData(data);
    applyLayoutsOnboarding(layouts, null);
    if (_layoutsLoaded && path === currentLayoutsPath() && state.layouts && typeof state.layouts === 'object') {
        applyLayoutsOnboarding(state.layouts, null);
    }
    await saveJSONNow(path, layouts);
    return true;
}

/** 清除当前激活 layouts 文件里的新手指引进度。 */
export async function clearCurrentOnboardingProgress() {
    const path = currentLayoutsPath();
    let data;
    try { data = await readJSON(path, {}); } catch (_) { data = {}; }
    const layouts = normalizeLayoutsData(data);
    applyLayoutsOnboarding(layouts, null);
    if (_layoutsLoaded && state.layouts && typeof state.layouts === 'object') {
        applyLayoutsOnboarding(state.layouts, null);
    }
    await saveJSONNow(path, layouts);
    return true;
}

// ========== 背包 ==========
export async function addToInventory(petId, itemId, qty = 1, options = {}) {
    if (!_inventoryLoaded) await ensurePetInventory(petId);
    if (!state.inventory) state.inventory = {};
    state.inventory[itemId] = (state.inventory[itemId] || 0) + qty;
    if (!state.inventoryOrder.includes(itemId)) state.inventoryOrder.push(itemId);
    if (options.persist !== false) saveInventoryDebouncedInternal();
}

export async function removeFromInventory(petId, itemId, qty = 1, options = {}) {
    if (!_inventoryLoaded) await ensurePetInventory(petId);
    const inv = state.inventory;
    if (!inv || !inv[itemId]) return false;
    inv[itemId] -= qty;
    if (inv[itemId] <= 0) {
        delete inv[itemId];
        state.inventoryOrder = (state.inventoryOrder || []).filter(id => id !== itemId);
    }
    if (options.persist !== false) saveInventoryDebouncedInternal();
    return true;
}

export function saveInventoryDebounced() {
    saveInventoryDebouncedInternal();
}

export async function saveDecorDataNow(petId) {
    await Promise.all([ensurePetLayouts(petId), ensurePetInventory(petId)]);
    applyLayoutsTerrainFields(state.layouts || {}, state.settings?.terrainFields || {});
    applyLayoutsFieldScenes(state.layouts || {}, state.settings?.fieldScenes || {});
    await Promise.all([
        saveJSONNow(currentLayoutsPath(), normalizeLayoutsData(state.layouts || {})),
        saveInventoryNowInternal(),
    ]);
}

export async function clearStoredData() {
    const ids = [...(state.petOrder || [])];
    await Promise.all([
        clearLocalDiskSafe(PATHS.userProfile),
        clearLocalDiskSafe(PATHS.layouts),
        clearLocalDiskSafe(PATHS.inventory),
        clearLocalDiskSafe(PATHS.planetVisitors),
        clearLocalDiskSafe(PATHS.recentFriendPlanets),
        clearLocalDiskSafe(PATHS.postcardList),
        clearLocalDiskSafe(PATHS.storyProgress),
        clearLocalDiskSafe(PATHS.storyList),
        ...ids.map(id => clearLocalDiskSafe(PATHS.pet(id))),
    ]);
    state.layouts = {};
    state.inventory = {};
    state.inventoryOrder = [];
    state.planetVisitors = [];
    state.recentFriendPlanets = [];
    _layoutsLoaded = true;
    _inventoryLoaded = true;
    _planetVisitorsLoaded = true;
    _recentFriendPlanetsLoaded = true;
    _storyProgressLoaded = true;
    _storyProgressLoading = null;
    _legacyStoryProgress = null;
    state.storyProgress = normalizeStoryProgressPayload(null);
}

// ========== memory.md / chat.log（文本文件） ==========
export async function loadPetMemory(petId) {
    return await readFileSafe(PATHS.memory(petId));
}

export async function appendPetMemory(petId, line) {
    if (!line) return;
    const cur = await loadPetMemory(petId);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const newLine = `- [${stamp}] ${line}\n`;
    let next = (cur || `# ${petId} 的记忆\n\n`) + newLine;
    if (next.length > CONFIG.memoryMaxBytes) {
        const head = next.slice(0, 200);
        const tail = next.slice(-CONFIG.memoryMaxBytes + 300);
        next = head + '\n\n... (旧记忆已归档) ...\n\n' + tail;
    }
    await writeFileSafe(PATHS.memory(petId), next);
}

export async function appendChatLog(petId, role, text) {
    let cur = await readFileSafe(PATHS.chatLog(petId));
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let next = (cur || '') + `[${stamp}] ${role}: ${text}\n`;
    if (next.length > CONFIG.chatHistoryMaxBytes) {
        next = next.slice(-CONFIG.chatHistoryMaxBytes);
    }
    await writeFileSafe(PATHS.chatLog(petId), next);
}

// ---------- Agent 运营层文件 IO ----------
// 通用、带前缀白名单的文件读写，供 agentBridge / agentAudit / haqi-operator 复用。
// 仅允许写 `agent/` 与 `pets/` 前缀，避免 agent 越权写其它工作区文件。
const AGENT_WRITE_PREFIXES = ['agent/', 'pets/'];

function isAgentWritablePath(path) {
    const p = String(path || '');
    return AGENT_WRITE_PREFIXES.some(prefix => p.startsWith(prefix));
}

// 读取工作区任意文件（缺失返回 ''）。读不设前缀限制（只读安全）。
export async function agentReadFile(path) {
    return await readFileSafe(String(path || ''));
}

// 覆盖写文件。仅允许 agent/ 与 pets/ 前缀，否则抛错（越权保护）。
export async function agentWriteFile(path, content) {
    if (!isAgentWritablePath(path)) {
        throw new Error(`agentWriteFile: path "${path}" not allowed (only agent/ and pets/)`);
    }
    return await writeFileSafe(String(path), content);
}

// 追加一行到文件，超过 maxBytes 时从头部轮转（保留头 200 字节 + 尾部）。
export async function agentAppendFile(path, line, maxBytes = 64 * 1024) {
    if (!isAgentWritablePath(path)) {
        throw new Error(`agentAppendFile: path "${path}" not allowed (only agent/ and pets/)`);
    }
    const cur = await readFileSafe(String(path));
    let next = (cur || '') + String(line == null ? '' : line);
    if (next.length > maxBytes) {
        const head = next.slice(0, 200);
        const tail = next.slice(-(maxBytes - 300));
        next = head + '\n... (旧记录已归档) ...\n' + tail;
    }
    return await writeFileSafe(String(path), next);
}
