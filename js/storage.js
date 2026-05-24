// PersonalPageStore 适配层（仅使用 readFile / createFile）
// 所有数据都以文件形式存储；JSON 数据存为 .json 文件，文本/日志保持 .md/.log。
import { CONFIG } from './config.js';
import { debounce } from './utils.js';
import { state } from './state.js';

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
    layouts:     'user/layouts.json',
    inventory:   'user/inventory.json',
    postcardList: 'user/postcard_list.json',
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

function getUserProfilePayload() {
    return {
        coins: state.coins,
        biofuel: Number.isFinite(state.biofuel) ? state.biofuel : 0,
        isPaid: state.isPaid,
        settings: state.settings,
        planetName: state.planetName || '',
        planetCreatedAt: Number.isFinite(state.planetCreatedAt) ? state.planetCreatedAt : 0,
        totalPlayMs: Number.isFinite(state.totalPlayMs) ? state.totalPlayMs : 0,
        planetWeather: state.planetWeather || null,
        planetBuff: state.planetBuff || null,
        planetVisitors: getPersistentPlanetVisitors(state.planetVisitors),
        planetActions: state.planetActions && typeof state.planetActions === 'object' ? state.planetActions : {},
        planetInfrastructure: state.planetInfrastructure && typeof state.planetInfrastructure === 'object' ? state.planetInfrastructure : {},
        planetMining: state.planetMining && typeof state.planetMining === 'object' ? state.planetMining : {},
        haqiIslandFarewells: Array.isArray(state.haqiIslandFarewells) ? state.haqiIslandFarewells.slice(0, 200).map(createFarewellPayload) : [],
        invitedPets: Array.isArray(state.invitedPets) ? state.invitedPets.slice(0, 10).map(createInvitedPetPayload) : [],
        recentFriendPlanets: Array.isArray(state.recentFriendPlanets) ? state.recentFriendPlanets.slice(0, 3).map(createRecentFriendPlanetPayload).filter(Boolean) : [],
        remotePlanetDiscoveries: state.remotePlanetDiscoveries && typeof state.remotePlanetDiscoveries === 'object' ? state.remotePlanetDiscoveries : {},
        remoteElementStocks: state.remoteElementStocks && typeof state.remoteElementStocks === 'object' ? state.remoteElementStocks : {},
        lifetimeStats: state.lifetimeStats && typeof state.lifetimeStats === 'object' ? state.lifetimeStats : {},
        achievements: state.achievements && typeof state.achievements === 'object' ? state.achievements : { claimed: {} },
        storyProgress: state.storyProgress && typeof state.storyProgress === 'object' ? state.storyProgress : { completed: {} },
        petOrder: state.petOrder || [],
        currentPetId: state.currentPetId || null,
    };
}

function createFarewellPayload(record) {
    if (!record || typeof record !== 'object') return record;
    const { stageName, stageEmoji, ...payload } = record;
    return payload;
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
    return pet;
}

function createPetPayload(pet) {
    if (!pet || typeof pet !== 'object') return pet;
    const { stageName, stageEmoji, ...payload } = pet;
    const locationType = payload.location?.type || payload.status || 'home';
    if (locationType !== 'home') {
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
    state.planetVisitors = getPersistentPlanetVisitors(p.planetVisitors);
    state.planetActions = p.planetActions && typeof p.planetActions === 'object' ? p.planetActions : {};
    state.planetInfrastructure = p.planetInfrastructure && typeof p.planetInfrastructure === 'object' ? p.planetInfrastructure : {};
    state.planetMining = p.planetMining && typeof p.planetMining === 'object' ? p.planetMining : {};
    state.haqiIslandFarewells = Array.isArray(p.haqiIslandFarewells) ? p.haqiIslandFarewells.slice(0, 200) : [];
    state.invitedPets = Array.isArray(p.invitedPets) ? p.invitedPets.slice(0, 10).filter(item => item && typeof item === 'object') : [];
    state.activeInvitedPet = state.invitedPets[0] || null;
    state.recentFriendPlanets = Array.isArray(p.recentFriendPlanets) ? p.recentFriendPlanets.map(createRecentFriendPlanetPayload).filter(Boolean).slice(0, 3) : [];
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
    const storyProgress = p.storyProgress && typeof p.storyProgress === 'object' ? p.storyProgress : {};
    state.storyProgress = { completed: (storyProgress.completed && typeof storyProgress.completed === 'object') ? storyProgress.completed : {} };
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
    state.layouts = {};
    state.inventory = {};
    _layoutsLoaded = false;
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
        const data = await readJSON(PATHS.layouts, {});
        state.layouts = data && typeof data === 'object' ? data : {};
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
    state.layouts[roomId] = items;
    if (options.persist !== false) saveJSONDebounced(PATHS.layouts, state.layouts);
}

export function getLayout(_petId, roomId) {
    return state.layouts?.[roomId] || [];
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
    await Promise.all([
        saveJSONNow(PATHS.layouts, state.layouts || {}),
        saveInventoryNowInternal(),
    ]);
}

export async function clearStoredData() {
    const ids = [...(state.petOrder || [])];
    await Promise.all([
        writeFileSafe(PATHS.userProfile, ''),
        writeFileSafe(PATHS.layouts, ''),
        writeFileSafe(PATHS.inventory, ''),
        writeFileSafe(PATHS.postcardList, ''),
        writeFileSafe(PATHS.storyList, ''),
        ...ids.map(id => writeFileSafe(PATHS.pet(id), '')),
    ]);
    state.layouts = {};
    state.inventory = {};
    state.inventoryOrder = [];
    _layoutsLoaded = true;
    _inventoryLoaded = true;
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
