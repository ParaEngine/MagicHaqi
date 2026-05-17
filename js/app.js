// 主程序：SDK 启动 + 路由 + 全局事件
import { $, showToast, confirm, clamp, prompt } from './utils.js';
import { canPlaceItemInArea, CONFIG, getItemZOrder, SHOP_ITEMS, findLargestHouseAcrossLayouts } from './config.js';
import { state, notify, subscribe, setView, setCurrentPet, getCurrentPet } from './state.js';
import {
    loadUserProfile, saveUserProfile, saveUserProfileDebounced,
    loadAllPets, deletePet, setCurrentPetPersisted,
    saveLayout, addToInventory, removeFromInventory, savePetDebounced,
    getLayout, ensurePetData, savePet, clearStoredData, saveDecorDataNow, saveInventoryDebounced,
} from './storage.js';
import { applyDecay, applyStage, clampEnergyToMax, defaultPermanentTrauma, defaultStats, eggStats, markPetCared, restoreEnergyToMax, tickOffline, startTickLoop, stopTickLoop } from './petTick.js';
import { renderLogin } from './view_login.js';
import { renderPetList } from './view_petList.js';
import { renderHatch } from './view_hatch.js';
import { renderHome, stopHomeWalk } from './view_home.js';
import { renderShop } from './view_shop.js';
import { renderInventory } from './view_inventory.js';
import { renderProfile } from './view_profile.js';
import { renderHelp } from './view_help.js';
import { randomDna, decodeDna, dnaRarity, dnaToName, biasDnaForFieldId } from './dna.js';
import { randId } from './utils.js';
import { t } from './i18n.js';
import { ensurePlanetProgressStarted, flushPlanetPlaytime } from './planetProgress.js';
import {
    getPetLocationInfo,
    getPlanetPetLimit,
    getPetFindTarget,
    hireNannyForPet,
    isPetOnCurrentPlanet,
    isPetSelectable,
    localPlanetPets,
    markPetReleased,
    markPetRemoteExiled,
    selectablePets,
} from './petLifecycle.js';
import SoundManager from './soundManager.js';
// Side-effect import: 订阅 state 并接管所有 [data-mh-pet] 占位符的渲染 + 动画
import { canWakePet, eatFood, isPetInteractionBlocked, isPetSleeping, preloadPetAssets, say, setAnim, sleepingInteractionText, startPetSleep, wakePet } from './pet.js';

const soundManager = SoundManager.getInstance();
const APP_AUDIO_VOLUME = 2.5;
const SLEEP_BLOCKED_ROUTES = new Set(['chat', 'minigames', 'learning', 'hatching', 'hatch']);

// ==== SDK 初始化 ====
if (!window.KeepworkSDK) {
    showToast('SDK 加载失败', 'error', 5000);
    throw new Error('KeepworkSDK 未定义');
}
const sdk = window.keepwork || new window.KeepworkSDK({ timeout: 30000 });
// 设置 maisi 项目 API Key
if (sdk.setUserApiKey && window.KeepworkSDK?.API_KEYS?.maisi) {
    sdk.setUserApiKey(window.KeepworkSDK.API_KEYS.maisi);
}
sdk.audioEngine?.setVolume?.(APP_AUDIO_VOLUME);
state.sdk = sdk;
window.MH_state = state; // 给 view_petList 顶部金币使用
window.sdk = sdk;

// 主面板
const app = document.getElementById('app');

const ITEM_BY_ID = Object.fromEntries(SHOP_ITEMS.map(it => [it.id, it]));
let planetPlaytimeTimer = null;
let chatViewPromise = null;
let chatViewModule = null;
let minigamesViewPromise = null;
let minigamesViewModule = null;
let learningViewPromise = null;
let learningViewModule = null;
let hatchingViewPromise = null;
let hatchingViewModule = null;
let settingsViewPromise = null;
let settingsViewModule = null;

function loadChatView() {
    if (chatViewModule) return Promise.resolve(chatViewModule);
    if (!chatViewPromise) {
        chatViewPromise = import('./view_chat.js').then((mod) => {
            chatViewModule = mod;
            return mod;
        });
    }
    return chatViewPromise;
}

function loadMinigamesView() {
    if (minigamesViewModule) return Promise.resolve(minigamesViewModule);
    if (!minigamesViewPromise) {
        minigamesViewPromise = import('./view_minigames.js').then((mod) => {
            minigamesViewModule = mod;
            return mod;
        });
    }
    return minigamesViewPromise;
}

function loadLearningView() {
    if (learningViewModule) return Promise.resolve(learningViewModule);
    if (!learningViewPromise) {
        learningViewPromise = import('./view_learning.js').then((mod) => {
            learningViewModule = mod;
            return mod;
        });
    }
    return learningViewPromise;
}

function loadHatchingView() {
    if (hatchingViewModule) return Promise.resolve(hatchingViewModule);
    if (!hatchingViewPromise) {
        hatchingViewPromise = import('./view_hatching.js').then((mod) => {
            hatchingViewModule = mod;
            return mod;
        });
    }
    return hatchingViewPromise;
}

function loadSettingsView() {
    if (settingsViewModule) return Promise.resolve(settingsViewModule);
    if (!settingsViewPromise) {
        settingsViewPromise = import('./view_settings.js').then((mod) => {
            settingsViewModule = mod;
            return mod;
        });
    }
    return settingsViewPromise;
}

function renderChatRoute() {
    const pet = getCurrentPet();
    if (!pet) return;
    if (guardSleepingRoute(pet)) return;
    if (chatViewModule) {
        chatViewModule.renderChat(app, { pet }, { onBack: () => navigateToView('home') });
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">聊天</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开聊天...</div>';
    const back = $('mhBack');
    if (back) back.onclick = () => navigateToView('home');
    loadChatView()
        .then(({ renderChat }) => {
            if (state.currentView !== 'chat') return;
            renderChat(app, { pet: getCurrentPet() }, { onBack: () => navigateToView('home') });
        })
        .catch((e) => {
            console.error('加载聊天视图失败', e);
            showToast('加载聊天失败：' + (e?.message || e), 'error');
            if (state.currentView === 'chat') navigateToView('home');
        });
}

function renderMinigamesRoute() {
    const pet = getCurrentPet();
    if (!pet) return;
    if (guardSleepingRoute(pet)) return;
    if (minigamesViewModule) {
        minigamesViewModule.renderMinigames(app, { pet }, {
            onBack: () => navigateToView('home'),
            onGameFinished: (game, data) => rewardPetAction('play', `${game?.title || '小游戏'}完成啦，心情提升！`, data),
        });
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">玩耍</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开小游戏...</div>';
    const back = $('mhBack');
    if (back) back.onclick = () => navigateToView('home');
    loadMinigamesView()
        .then(({ renderMinigames }) => {
            if (state.currentView !== 'minigames') return;
            renderMinigames(app, { pet: getCurrentPet() }, {
                onBack: () => navigateToView('home'),
                onGameFinished: (game, data) => rewardPetAction('play', `${game?.title || '小游戏'}完成啦，心情提升！`, data),
            });
        })
        .catch((e) => {
            console.error('加载小游戏视图失败', e);
            showToast('加载小游戏失败：' + (e?.message || e), 'error');
            if (state.currentView === 'minigames') navigateToView('home');
        });
}

function renderLearningRoute() {
    const pet = getCurrentPet();
    if (!pet) return;
    if (guardSleepingRoute(pet)) return;
    if (learningViewModule) {
        learningViewModule.renderLearning(app, { pet }, {
            onBack: () => navigateToView('home'),
            onActivityFinished: (activity, data) => rewardPetAction('study', `${activity?.title || '学习'}完成啦，智慧提升！`, data),
        });
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">学习</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开学习伙伴...</div>';
    const back = $('mhBack');
    if (back) back.onclick = () => navigateToView('home');
    loadLearningView()
        .then(({ renderLearning }) => {
            if (state.currentView !== 'learning') return;
            renderLearning(app, { pet: getCurrentPet() }, {
                onBack: () => navigateToView('home'),
                onActivityFinished: (activity, data) => rewardPetAction('study', `${activity?.title || '学习'}完成啦，智慧提升！`, data),
            });
        })
        .catch((e) => {
            console.error('加载学习视图失败', e);
            showToast('加载学习失败：' + (e?.message || e), 'error');
            if (state.currentView === 'learning') navigateToView('home');
        });
}

function renderHatchingRoute() {
    const pet = getCurrentPet();
    if (pet && guardSleepingRoute(pet)) return;
    const pets = state.petOrder.map(id => state.pets[id]).filter(Boolean);
    const options = {
        onBack: () => navigateToView('home'),
        onHireNanny: handleHireNanny,
        onAdoptEgg: handleAdoptEgg,
        onBreed: handleStartBreed,
        onOpenAlbum: () => navigateToView('petList'),
    };
    const data = { pet, pets, planetName: state.planetName || '宠物星' };
    if (hatchingViewModule) {
        hatchingViewModule.renderHatching(app, data, options);
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">孵化仓</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开孵化仓...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadHatchingView()
        .then(({ renderHatching }) => {
            if (state.currentView !== 'hatching') return;
            renderHatching(app, { pet: getCurrentPet(), pets: state.petOrder.map(id => state.pets[id]).filter(Boolean), planetName: state.planetName || '宠物星' }, options);
        })
        .catch((e) => {
            console.error('加载孵化仓失败', e);
            showToast('加载孵化仓失败：' + (e?.message || e), 'error');
            if (state.currentView === 'hatching') navigateToView('home');
        });
}

function renderSettingsRoute() {
    const options = {
        onBack:      () => navigateToView(state.currentPetId ? 'home' : 'petList'),
        onLogout:    handleLogout,
        onClearData: handleClearData,
    };
    if (settingsViewModule) {
        settingsViewModule.renderSettings(app, null, options);
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">设置</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开设置...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadSettingsView()
        .then(({ renderSettings }) => {
            if (state.currentView !== 'settings') return;
            renderSettings(app, null, options);
        })
        .catch((e) => {
            console.error('加载设置视图失败', e);
            showToast('加载设置失败：' + (e?.message || e), 'error');
            if (state.currentView === 'settings') navigateToView(state.currentPetId ? 'home' : 'petList');
        });
}

// ==== 路由 ====
const routes = {
    login:     () => renderLogin(app, null, { onLogin: handleLogin }),
    petList:   () => renderPetList(app, { pets: state.petOrder.map(id => state.pets[id]).filter(Boolean) }, {
        onSelect: handleSelectPet,
        onFind:   handleFindPet,
        onBack:   () => setView(state.currentPetId ? 'home' : 'petList'),
    }),
    hatch:     () => {
        const pet = getCurrentPet();
        if (pet && guardSleepingRoute(pet)) return;
        renderHatch(app, hatchCtx, {
            onCreated: () => { hatchCtx = {}; setView('home'); },
            onCancel:  () => { hatchCtx = {}; setView('hatching'); },
        });
    },
    home:      () => renderHome(app, { pet: getCurrentPet() }, {
        onAction:     handleAction,
        onSwitchRoom: (id) => { state.currentRoom = id; const p = getCurrentPet(); if (p) p.activeRoom = id; savePetDebounced(p); render(); },
        onToggleDecor: handleToggleDecor,
        onToggleFeed:  handleToggleFeed,
        onPlaceItem:  handlePlaceItem,
        onMoveItem:   handleMoveItem,
        onRemoveItem: handleRemoveItem,
        onFeedItem:   handleFeedItem,
        onFeedComplete: render,
        onNav:        handleNav,
    }),
    shop:      () => renderShop(app, null, { onBack: () => navigateToView('home'), onBuy: handleBuy }),
    inventory: () => renderInventory(app, null, {
        onBack:  () => navigateToView('home'),
        onUse:   handleUseItem,
        onSell:  handleSell,
        onReorder: (order) => {
            state.inventoryOrder = Array.isArray(order) ? order.slice() : [];
            saveInventoryDebounced();
            notify();
        },
        onPlace: (item) => {
            state.isDecorMode = true;
            state.isFeedMode = false;
            setView('home');
            showToast(`已进入装饰模式，请在底部选择 ${item.name} 后点击房间格子`, 'info');
        },
    }),
    chat:      renderChatRoute,
    minigames: renderMinigamesRoute,
    learning:  renderLearningRoute,
    hatching:  renderHatchingRoute,
    profile:   () => renderProfile(app, { pet: getCurrentPet() }, { onBack: () => navigateToView('home') }),
    help:      () => renderHelp(app, null, { onBack: () => navigateToView('home') }),
    settings:  renderSettingsRoute,
};

let hatchCtx = {};

function preloadLoadedPetAssets() {
    try {
        const pets = localPlanetPets((state.petOrder || []).map(id => state.pets[id]).filter(Boolean));
        if (pets.length) preloadPetAssets(pets);
    } catch (e) {
        console.warn('预加载宠物资源失败', e);
    }
}

function render() {
    stopHomeWalk();
    const fn = routes[state.currentView] || routes.login;
    try { fn(); } catch (e) { console.error('render 失败', e); app.innerHTML = '<div style="padding:30px;color:#b91c1c">渲染错误：' + (e?.message || e) + '</div>'; }
}
subscribe(render);

async function loadCurrentUser() {
    if (!sdk.token) return null;
    if (typeof sdk.getUserProfile === 'function') return await sdk.getUserProfile();
    if (typeof sdk.getCurrentUser === 'function') return await sdk.getCurrentUser();
    return sdk.user || null;
}

// ==== 启动流程 ====
async function bootstrap() {
    // URL token
    try {
        const url = new URL(window.location.href);
        const tok = url.searchParams.get('token');
        if (tok) sdk.token = tok;
    } catch (_) {}

    // 已有 token 则尝试拉取用户
    if (sdk.token) {
        try {
            state.user = await loadCurrentUser();
        } catch (_) { state.user = null; }
    }

    if (!sdk.token) {
        setView('login');
        return;
    }

    // 已登录：加载数据
    try {
        await loadUserProfile();
        await loadAllPets();
        ensurePlanetProgressStarted();
        startPlanetPlaytimePersistence();
    } catch (e) {
        console.warn('加载数据失败', e);
    }

    // 离线追溯所有宠物
    for (const id of Object.keys(state.pets)) tickOffline(state.pets[id]);
    startTickLoop();

    // 进入游戏前必须先给"星球"命名（每位用户只有一个星球）
    await ensurePlanetNamed();

    if (state.petOrder.length === 0 || selectablePets(state.petOrder.map(id => state.pets[id]).filter(Boolean)).length === 0) {
        // 不允许玩家随意创建宠物：系统默认赠送一颗蛋。
        await ensureDefaultEgg();
    } else if (state.currentPetId && !isPetSelectable(state.pets[state.currentPetId])) {
        await selectFirstAvailablePet();
    }
    await enforcePlanetPetLimit(state.currentPetId);
    if (state.currentPetId) {
        try { await ensurePetData(state.currentPetId); } catch (_) {}
    }
    preloadLoadedPetAssets();
    // 进入 home；首次启动为星球外层，视图间返回时由 state 恢复上次 home level。
    setView('home');
}

/** 系统默认蛋：当玩家没有任何宠物时（首次进入 / 删光宠物后）静默创建。 */
async function ensureDefaultEgg() {
    const existing = selectablePets(state.petOrder.map(id => state.pets[id]).filter(Boolean))[0];
    if (existing) return existing;
    return await createNewEgg();
}

async function createNewEgg() {
    const now = Date.now();
    let dna = randomDna();
    // 若用户已有"主屋"，新蛋更倾向于继承主屋所在领地的 DNA 特征
    const territory = findLargestHouseAcrossLayouts(state.layouts);
    if (territory?.fieldId) dna = biasDnaForFieldId(dna, territory.fieldId);
    const trueName = dnaToName(dna);
    const pet = {
        id: 'pet_' + randId(8),
        name: trueName,
        dna,
        imageUrl: null,           // 兼容旧字段，蛋阶段不用
        imageSheetUrl: null,      // 4x4 精灵图，破壳前由系统懒生成
        traits: decodeDna(dna),
        rarity: dnaRarity(dna),
        stats: eggStats(),
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now,
        lastTickAt: now,
        lastCareAt: now,
        parents: null,
        stage: 'egg',
        stageName: '蛋',
        stageEmoji: '🥚',
        activeRoom: 'living',
        // 蛋阶段累计的 DNA 偏置 —— 喂食 / 许愿都会落在这里，孵化时统一应用
        eggBias: { feedTraits: {}, feedCount: 0, initialFieldId: territory?.fieldId || null },
        wishPrompt: null,
    };
    await savePet(pet);
    await setCurrentPetPersisted(pet.id);
    setCurrentPet(pet.id);
    return pet;
}

function firstSelectablePetId(excludeId = null) {
    return selectablePets(state.petOrder.map(id => state.pets[id]).filter(Boolean))
        .find(pet => pet.id !== excludeId)?.id || null;
}

async function selectFirstAvailablePet(preferredId = null) {
    const preferred = preferredId ? state.pets[preferredId] : null;
    const nextId = preferred && isPetSelectable(preferred) ? preferredId : firstSelectablePetId();
    if (!nextId) {
        state.currentPetId = null;
        await saveUserProfile();
        return null;
    }
    setCurrentPet(nextId);
    await setCurrentPetPersisted(nextId);
    state.currentRoom = state.pets[nextId]?.activeRoom || 'living';
    return state.pets[nextId] || null;
}

async function enforcePlanetPetLimit(preferredKeepId = state.currentPetId) {
    const limit = getPlanetPetLimit();
    let localPets = localPlanetPets(state.petOrder.map(id => state.pets[id]).filter(Boolean));
    if (localPets.length <= limit) return [];
    const candidates = localPets
        .filter(pet => pet.id !== preferredKeepId)
        .sort((a, b) => {
            const aReleased = a.location?.type === 'released' ? 0 : 1;
            const bReleased = b.location?.type === 'released' ? 0 : 1;
            return (aReleased - bReleased) || ((Number(a.bornAt) || 0) - (Number(b.bornAt) || 0));
        });
    const exiled = [];
    while (localPets.length > limit && candidates.length) {
        const pet = candidates.shift();
        const location = markPetRemoteExiled(pet, 'capacity');
        await savePet(pet);
        exiled.push({ pet, location });
        localPets = localPlanetPets(localPets);
    }
    if (exiled.some(item => item.pet.id === state.currentPetId)) await selectFirstAvailablePet(preferredKeepId);
    if (exiled.length) saveUserProfileDebounced();
    return exiled;
}

// 强制弹出命名框，直到玩家给出非空名称（不可关闭）。
async function ensurePlanetNamed() {
    if (!state.planetCreatedAt) state.planetCreatedAt = Date.now();
    if (state.planetName && state.planetName.trim()) return;
    let name = '';
    while (!name) {
        name = await prompt('为你的宠物星球起名', {
            hint: '每位玩家只有一个星球，名字会一直伴随你的游戏旅程～',
            placeholder: '例如：奇奇星',
            okText: '建立星球',
            randomText: '🎲 随机',
            maxLength: 12,
            dismissable: false,
            randomValues: [
                '奇奇星', '蛋蛋星', '梦幻星', '彩虹星', '糖糖星', '棉花星', '泡泡星',
                '星语星', '月光星', '云朵星', '布丁星', '柠檬星', '草莓星', '蘑菇星',
                '萌萌星', '哈奇星', '果冻星', '雪花星', '繁星岛', '银河小镇',
            ],
            validate: (v) => {
                if (!v) return '请输入星球名字';
                if (v.length > 12) return '最多 12 个字';
                return '';
            },
        });
        name = (name || '').trim();
    }
    state.planetName = name;
    try { await saveUserProfile(); } catch (_) {}
    showToast(`欢迎来到 ${name}！`, 'success');
}

// ==== handlers ====
async function handleLogin() {
    if (!sdk.showLoginWindow) {
        showToast('未找到登录入口', 'error');
        setView('login');
        return;
    }
    try {
        await sdk.showLoginWindow({ title: 'Keepwork 登录' });
    } catch (e) {
        const msg = e?.message || e;
        if (msg && !/cancel/i.test(String(msg))) {
            showToast('登录窗口出错：' + msg, 'error');
        }
        setView('login');
        return;
    }
    if (!sdk.token) {
        setView('login');
        return;
    }
    if (sdk.token) {
        try { state.user = await loadCurrentUser(); } catch (_) {}
        try { await loadUserProfile(); await loadAllPets(); } catch (e) { console.warn(e); }
        ensurePlanetProgressStarted();
        startPlanetPlaytimePersistence();
        for (const id of Object.keys(state.pets)) tickOffline(state.pets[id]);
        startTickLoop();
        await ensurePlanetNamed();
        if (state.petOrder.length === 0 || selectablePets(state.petOrder.map(id => state.pets[id]).filter(Boolean)).length === 0) {
            await ensureDefaultEgg();
        } else if (state.currentPetId && !isPetSelectable(state.pets[state.currentPetId])) {
            await selectFirstAvailablePet();
        }
        await enforcePlanetPetLimit(state.currentPetId);
        if (state.currentPetId) {
            try { await ensurePetData(state.currentPetId); } catch (_) {}
        }
        preloadLoadedPetAssets();
        setView('home');
    }
}

function handleLogout() {
    try { sdk.logout?.(); } catch (_) {}
    sdk.token = null;
    state.user = null;
    persistPlanetPlaytimeNow();
    stopTickLoop();
    stopPlanetPlaytimePersistence();
    setView('login');
}

async function handleClearData() {
    try {
        await clearStoredData();
        state.pets = {}; state.petOrder = []; state.currentPetId = null; state.layouts = {}; state.inventory = {}; state.inventoryOrder = [];
        state.isDecorMode = false;
        state.isFeedMode = false;
        state.coins = CONFIG.initialCoins; state.isPaid = false;
        state.planetName = '';
        state.planetCreatedAt = Date.now();
        state.totalPlayMs = 0;
        state.playSessionStartedAt = Date.now();
        state.planetWeather = null;
        state.planetBuff = null;
        state.planetVisitors = [];
        state.planetActions = {};
        state.planetInfrastructure = {};
        state.planetMining = {};
        state.haqiIslandFarewells = [];
        state.remotePlanetDiscoveries = {};
        state.remoteElementStocks = {};
        await saveUserProfile();
        showToast('已清除', 'success');
        await ensureDefaultEgg();
        setView('home');
    } catch (e) {
        showToast('清除失败：' + (e?.message || e), 'error');
    }
}

async function handleSelectPet(id) {
    const target = state.pets[id];
    if (!target) return;
    if (!isPetSelectable(target)) {
        const info = getPetLocationInfo(target, state.planetName || '宠物星');
        showToast(`${target.name || '这只宠物'} 现在在 ${info.label}，不能召回。`, 'info', 2200);
        return;
    }
    setCurrentPet(id);
    setCurrentPetPersisted(id).catch(()=>{});
    state.currentRoom = state.pets[id]?.activeRoom || 'living';
    state.isDecorMode = false;
    state.isFeedMode = false;
    try { await ensurePetData(id); } catch (_) {}
    try { preloadPetAssets(state.pets[id], { includeAll: false }); } catch (_) {}
    setView('home');
}

async function handleFindPet(id) {
    const pet = state.pets[id];
    if (!pet) return;
    const target = getPetFindTarget(pet);
    if (!target) {
        const info = getPetLocationInfo(pet, state.planetName || '宠物星');
        showToast(`${pet.name || '这只宠物'} 现在在 ${info.label}，不能在当前星球寻找。`, 'info', 2200);
        return;
    }
    if (isPetSelectable(pet)) {
        setCurrentPet(id);
        try { await setCurrentPetPersisted(id); } catch (_) {}
        try { await ensurePetData(id); } catch (_) {}
    }
    state.isDecorMode = false;
    state.isFeedMode = false;
    if (target.kind === 'field') {
        state.currentField = target.id || 'land';
        state.lastHomeZoomLevel = 1;
        setView('home');
        showToast(`正在前往 ${pet.name || '宠物'} 所在的场景`, 'info', 1200);
        return;
    }
    state.currentRoom = target.id || pet.activeRoom || 'living';
    if (isPetSelectable(pet)) pet.activeRoom = state.currentRoom;
    state.lastHomeZoomLevel = 2;
    setView('home');
    showToast(`正在前往 ${pet.name || '宠物'} 所在的房间`, 'info', 1200);
}

async function handleHireNanny(pet) {
    if (!pet) return;
    if (!isPetOnCurrentPlanet(pet)) {
        showToast('这只宠物已经不在当前星球，无法雇佣保姆。', 'info');
        return;
    }
    hireNannyForPet(pet);
    pet.lastTickAt = Date.now();
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    await savePet(pet);
    showToast('保姆已经开始照看，成长会更慢但状态会更稳定。', 'success', 2400);
    notify();
}

async function handleAdoptEgg(pet) {
    const current = pet || getCurrentPet();
    if (current && isPetOnCurrentPlanet(current)) {
        const ok = await confirm(`领养新蛋后，${current.name || '当前宠物'} 会被放养到星球中，无法重新召回。确定继续吗？`, {
            okText: '放养并领养',
            cancelText: '再想想',
        });
        if (!ok) return;
        markPetReleased(current, state.planetName || '宠物星');
        await savePet(current);
    }
    const newPet = await createNewEgg();
    try { await ensurePetData(newPet.id); } catch (_) {}
    state.currentRoom = newPet.activeRoom || 'living';
    state.isDecorMode = false;
    state.isFeedMode = false;
    const exiled = await enforcePlanetPetLimit(newPet.id);
    const exileText = exiled.length ? ` ${exiled.map(item => `${item.pet.name || '一只宠物'}去了${item.location.name}`).join('，')}。` : '';
    showToast(`已领养新的蛋。${exileText}`, exiled.length ? 'info' : 'success', exiled.length ? 3600 : 2200);
    setView('home');
}

async function handleDeletePet(id) {
    const p = state.pets[id];
    if (!p) return;
    const wasCurrent = state.currentPetId === id;
    const ok = await confirm(`确定送走 ${p.name} 吗？此操作不可恢复！`);
    if (!ok) return;
    await deletePet(id);
    // 没有任何宠物：触发"获得新蛋"流程，并以首次登录星球的姿态欢迎玩家
    if (state.petOrder.length === 0) {
        const planet = (state.planetName && state.planetName.trim()) || '宠物星';
        const newPet = await ensureDefaultEgg();
        try { await ensurePetData(state.currentPetId); } catch (_) {}
        state.currentRoom = newPet?.activeRoom || 'living';
        state.isDecorMode = false;
        state.isFeedMode = false;
        setView('home');
        showToast(`欢迎来到 ${planet}！系统赠送你一颗新蛋 🥚`, 'success');
        return;
    }
    // 删除的是当前宠物：自动切换到下一只并进入其家
    if (wasCurrent) {
        const nextId = state.currentPetId || state.petOrder[0];
        setCurrentPet(nextId);
        try { await setCurrentPetPersisted(nextId); } catch (_) {}
        state.currentRoom = state.pets[nextId]?.activeRoom || 'living';
        state.isDecorMode = false;
        state.isFeedMode = false;
        try { await ensurePetData(nextId); } catch (_) {}
        setView('home');
        return;
    }
    // 删除的是其它宠物：保持在列表
    notify();
    if (state.currentView !== 'petList') setView('petList');
}

function handleStartBreed() {
    const currentPet = getCurrentPet();
    if (currentPet && isPetInteractionBlocked(currentPet)) { showToast(sleepingInteractionText(currentPet), 'info', 1800); return; }
    const adults = state.petOrder.map(id => state.pets[id]).filter(p => p && CONFIG.breedableStages.includes(p.stage));
    if (adults.length < 2) { showToast('需要至少两只成年宠物', 'error'); return; }
    if (state.coins < CONFIG.breedCost) { showToast(`繁殖需要 ${CONFIG.breedCost} 金币`, 'error'); return; }
    // 简单 UI：弹两次选择
    pickPet('选择 ' + '爸爸').then(a => {
        if (!a) return;
        pickPet('选择 ' + '妈妈', a.id).then(b => {
            if (!b) return;
            hatchCtx = { parents: [a, b] };
            setView('hatch');
        });
    });
}

function pickPet(title, excludeId = null) {
    return new Promise((resolve) => {
        const adults = state.petOrder.map(id => state.pets[id])
            .filter(p => p && CONFIG.breedableStages.includes(p.stage) && p.id !== excludeId);
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal-card">
                <div class="text-base font-bold mb-3">${title}</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    ${adults.map(p => `
                        <button class="btn-secondary" data-pid="${p.id}" style="display:flex;gap:10px;align-items:center;text-align:left;padding:8px 12px">
                            <span style="font-size:24px">${p.stageEmoji || '🐾'}</span>
                            <span style="font-weight:700">${p.name}</span>
                            <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${p.stageName}</span>
                        </button>
                    `).join('') || '<div style="color:var(--text-muted);text-align:center;padding:14px">没有合适的宠物</div>'}
                </div>
                <div class="text-center mt-3">
                    <button class="btn-secondary" data-cancel>取消</button>
                </div>
            </div>`;
        mask.addEventListener('click', (e) => {
            if (e.target === mask || e.target.closest('[data-cancel]')) { mask.remove(); resolve(null); return; }
            const btn = e.target.closest('[data-pid]');
            if (btn) { mask.remove(); resolve(state.pets[btn.dataset.pid]); }
        });
        document.body.appendChild(mask);
    });
}

// 互动操作
function handleAction(key, options = {}) {
    const pet = getCurrentPet();
    if (!pet) return false;
    const cfg = CONFIG.actions[key];
    if (!cfg) return false;
    if (isPetSleeping(pet)) {
        if (key !== 'sleep') {
            showToast(sleepingInteractionText(pet), 'info', 1800);
            return false;
        }
        if (!canWakePet(pet)) {
            showToast(sleepingInteractionText(pet), 'info', 1800);
            return false;
        }
        wakePet(pet);
        setAnim('idle', 0);
        markPetCared(pet);
        savePetDebounced(pet);
        if (!options.skipNotify) notify();
        showToast('宠物醒来啦', 'success', 1200);
        return true;
    }
    const skipNotify = !!options.skipNotify;
    // 冷却
    state.actionCooldown[pet.id] = state.actionCooldown[pet.id] || {};
    const cd = state.actionCooldown[pet.id];
    const now = Date.now();
    if (cd[key] && now - cd[key] < cfg.cooldownSec * 1000) {
        const left = Math.ceil((cfg.cooldownSec * 1000 - (now - cd[key])) / 1000);
        showToast(`再等 ${left} 秒～`, 'info');
        return false;
    }
    if (cfg.costCoins && state.coins < cfg.costCoins) {
        showToast('金币不足', 'error');
        return false;
    }
    const energyCost = Math.abs(Math.min(0, Number(cfg.energy) || 0));
    if (energyCost > 0 && (Number(pet.stats?.energy) || 0) < energyCost) {
        showToast('体力不足，睡一觉就能恢复', 'info', 1800);
        return false;
    }
    // 应用属性变化
    for (const k of Object.keys(cfg)) {
        if (['costCoins', 'cooldownSec', 'rewardCoins'].includes(k)) continue;
        if (typeof cfg[k] === 'number') {
            pet.stats[k] = clamp((pet.stats[k] || 0) + cfg[k], CONFIG.statMin, CONFIG.statMax);
        }
    }
    if (key === 'sleep') restoreEnergyToMax(pet);
    else clampEnergyToMax(pet);
    if (cfg.costCoins) { state.coins -= cfg.costCoins; saveUserProfileDebounced(); }
    if (cfg.rewardCoins) { state.coins += cfg.rewardCoins; saveUserProfileDebounced(); showToast(`+${cfg.rewardCoins} 🪙`, 'success', 1200); }
    cd[key] = now;
    pet.lastTickAt = now;
    markPetCared(pet, now);
    applyStage(pet);
    savePetDebounced(pet);
    if (key === 'sleep') {
        setAnim('sleep', 0);
        startPetSleep(pet, now);
        savePetDebounced(pet);
    }
    if (!skipNotify) notify();
    if (key === 'sleep') {
        requestAnimationFrame(() => say('Zzz...', 2400));
    }
    return true;
}

function rewardPetAction(key, message, sourceData = {}) {
    const pet = getCurrentPet();
    if (!pet) return;
    if (isPetInteractionBlocked(pet)) {
        showToast(sleepingInteractionText(pet), 'info', 1800);
        return;
    }
    const cfg = CONFIG.actions[key];
    if (!cfg) return;
    if (!pet.stats) pet.stats = defaultStats();
    const energyCost = Math.abs(Math.min(0, Number(cfg.energy) || 0));
    if (energyCost > 0 && (Number(pet.stats.energy) || 0) < energyCost) {
        showToast('体力不足，睡一觉就能恢复', 'info', 1800);
        return;
    }
    for (const k of Object.keys(cfg)) {
        if (['costCoins', 'cooldownSec', 'rewardCoins'].includes(k)) continue;
        applyPetStatDelta(pet, k, cfg[k]);
    }
    const statBonus = sourceData?.statBonus || {};
    for (const k of Object.keys(statBonus)) {
        applyPetStatDelta(pet, k, statBonus[k]);
    }
    clampEnergyToMax(pet);
    const rewardCoins = activityRewardCoins(key, sourceData, cfg);
    if (rewardCoins) {
        state.coins += rewardCoins;
        saveUserProfileDebounced();
    }
    pet.lastTickAt = Date.now();
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    savePetDebounced(pet);
    showToast(rewardCoins ? `${message} +${rewardCoins} 🪙` : message, 'success', 1600);
}

function activityRewardCoins(key, sourceData = {}, cfg = {}) {
    if (key !== 'play' && key !== 'study') return cfg.rewardCoins || 0;
    const completed = sourceData.completed !== false && sourceData.passed !== false;
    const durationSeconds = activityDurationSeconds(sourceData);
    if (!completed) return Math.min(15, Math.max(0, Math.round(durationSeconds / 20)));
    const score = Math.max(0, Number(sourceData.earnedPoints) || 0);
    const durationCoins = Math.min(25, Math.round(durationSeconds / 12));
    const scoreCoins = score > 0 ? Math.min(20, Math.round(score / 6)) : 0;
    return Math.min(50, Math.max(10, 10 + durationCoins + scoreCoins));
}

function activityDurationSeconds(sourceData = {}) {
    const direct = Number(sourceData.durationSeconds ?? sourceData.seconds ?? sourceData.playSeconds);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const startedAt = Number(sourceData.startedAt || 0);
    const finishedAt = Number(sourceData.finishedAt || Date.now());
    if (startedAt > 0 && finishedAt > startedAt) return (finishedAt - startedAt) / 1000;
    return 0;
}

function applyPetStatDelta(pet, key, delta) {
    const value = Number(delta);
    if (!Number.isFinite(value)) return;
    pet.stats[key] = clamp((pet.stats[key] || 0) + value, CONFIG.statMin, CONFIG.statMax);
}

async function handleToggleDecor(next) {
    const pet = getCurrentPet();
    const leavingDecorMode = state.isDecorMode && !next;
    if (leavingDecorMode && pet?.id) {
        await saveDecorDataNow(pet.id);
    }
    state.isDecorMode = next;
    if (next) state.isFeedMode = false;
    render();
}

async function handleToggleFeed(next) {
    const pet = getCurrentPet();
    const leavingFeedMode = state.isFeedMode && !next;
    if (leavingFeedMode && pet?.id) {
        await saveDecorDataNow(pet.id);
    }
    state.isFeedMode = next;
    if (next) state.isDecorMode = false;
    render();
}

async function finishRoomModeIfNeeded() {
    if (!state.isDecorMode && !state.isFeedMode) return;
    const pet = getCurrentPet();
    if (pet?.id) await saveDecorDataNow(pet.id);
    state.isDecorMode = false;
    state.isFeedMode = false;
}

// itemId, x, y, [roomIdOverride]  —— Field 视图传 'field_<id>' 时使用百分比坐标
async function handlePlaceItem(itemId, x, y, roomOverride, extra = null) {
    const pet = getCurrentPet();
    if (!pet) return;
    const item = ITEM_BY_ID[itemId];
    if (!item) { showToast('未知物品', 'error'); return; }
    const inv = state.inventory || {};
    const isUnique = !!item.uniqueItem;
    const treatAsUnlimited = item.unlimited || isUnique;
    if (!treatAsUnlimited && !inv[itemId]) { showToast('背包里没有此物品', 'error'); return; }
    const roomKey = roomOverride || state.currentRoom || pet.activeRoom || 'living';
    const area = roomKey.startsWith('field_') ? roomKey.slice('field_'.length) : roomKey;
    if (!canPlaceItemInArea(item, area)) {
        showToast('这个物品不能放在这里', 'error');
        return;
    }
    const { skipSound = false, ...layoutExtra } = extra && typeof extra === 'object' ? extra : {};
    const persist = !state.isDecorMode && !state.isFeedMode;

    // uniqueItem：放置前先移除全部 layout 中同 itemId 的旧实例（跨场景）
    if (isUnique) {
        const layoutsMap = state.layouts || {};
        for (const [k, items] of Object.entries(layoutsMap)) {
            if (!Array.isArray(items)) continue;
            const filtered = items.filter(it => it?.itemId !== itemId);
            if (filtered.length !== items.length && k !== roomKey) {
                await saveLayout(pet.id, k, filtered, { persist });
            }
        }
    }

    let layout = [...(getLayout(pet.id, roomKey) || [])];
    if (isUnique) layout = layout.filter(it => it?.itemId !== itemId);
    layout.push({ itemId, x, y, zorder: getItemZOrder(item), ...layoutExtra });
    await saveLayout(pet.id, roomKey, layout, { persist });
    if (!treatAsUnlimited) await removeFromInventory(pet.id, itemId, 1, { persist });
    if (!skipSound) soundManager.playItemPlace();
    notify();
}

async function handleMoveItem(idx, x, y, roomOverride, extra = null) {
    const pet = getCurrentPet();
    if (!pet) return;
    const roomKey = roomOverride || state.currentRoom || pet.activeRoom || 'living';
    const layout = [...(getLayout(pet.id, roomKey) || [])];
    if (!layout[idx]) return;
    const { skipSound = false, ...layoutExtra } = extra && typeof extra === 'object' ? extra : {};
    layout[idx] = {
        ...layout[idx],
        x,
        y,
        ...layoutExtra,
    };
    await saveLayout(pet.id, roomKey, layout, { persist: !state.isDecorMode && !state.isFeedMode });
    if (!skipSound) soundManager.playItemPlace();
    notify();
}

async function handleRemoveItem(idx, roomOverride) {
    const pet = getCurrentPet();
    if (!pet) return;
    const roomKey = roomOverride || state.currentRoom || pet.activeRoom || 'living';
    const layout = [...(getLayout(pet.id, roomKey) || [])];
    const removed = layout.splice(idx, 1)[0];
    if (removed) {
        const removedItem = ITEM_BY_ID[removed.itemId];
        const persist = !state.isDecorMode && !state.isFeedMode;
        const treatAsUnlimited = removedItem?.unlimited || removedItem?.uniqueItem;
        if (!treatAsUnlimited) await addToInventory(pet.id, removed.itemId, 1, { persist });
        await saveLayout(pet.id, roomKey, layout, { persist });
    }
    notify();
}

async function handleFeedItem(itemId, source = {}) {
    const pet = getCurrentPet();
    const item = ITEM_BY_ID[itemId];
    if (!pet || !item || item.type !== 'food') return false;
    const eaten = eatFood(pet, item, { delayEffectsMs: source.delayEffectsMs, sayDelayMs: source.sayDelayMs });
    if (!eaten) return false;
    try {
        const stats = state.lifetimeStats || (state.lifetimeStats = { feeds: 0, poopsCleaned: 0, adultsRaised: 0 });
        stats.feeds = (Number(stats.feeds) || 0) + 1;
    } catch (_) {}
    const persist = !state.isDecorMode && !state.isFeedMode;
    if (source.source === 'layout') {
        const roomKey = source.roomOverride || state.currentRoom || pet.activeRoom || 'living';
        const layout = [...(getLayout(pet.id, roomKey) || [])];
        const idx = Number(source.index);
        if (Number.isInteger(idx) && layout[idx]?.itemId === itemId) {
            layout.splice(idx, 1);
            await saveLayout(pet.id, roomKey, layout, { persist });
        }
    } else if (!item.unlimited) {
        await removeFromInventory(pet.id, itemId, 1, { persist });
    }
    if (!source.skipNotify) notify();
    return true;
}

async function navigateToView(target) {
    if (!target) return;
    await finishRoomModeIfNeeded();
    const pet = getCurrentPet();
    if (pet && SLEEP_BLOCKED_ROUTES.has(target) && isPetInteractionBlocked(pet)) {
        showToast(sleepingInteractionText(pet), 'info', 1800);
        setView('home');
        return;
    }
    if (target === 'home') { setView('home'); return; }
    if (target === 'petList') { setView('petList'); return; }
    if (routes[target]) { setView(target); return; }
    showToast('未知导航：' + target, 'info');
}

// 底部导航统一入口
function handleNav(target) {
    navigateToView(target);
}

function guardSleepingRoute(pet = getCurrentPet()) {
    if (!pet || !SLEEP_BLOCKED_ROUTES.has(state.currentView) || !isPetInteractionBlocked(pet)) return false;
    showToast(sleepingInteractionText(pet), 'info', 1800);
    setView('home');
    return true;
}

// 背包→使用：食物增加属性 + trait 演化；玩具加心情；其余忽略
function handleUseItem(item) {
    const pet = getCurrentPet();
    if (!pet) { showToast('请先选择宠物', 'error'); return; }
    if (!item) return;
    const inv = state.inventory || {};
    if (!inv[item.id]) { showToast('背包里没有此物品', 'error'); return; }
    if (item.type === 'food') {
        if (!eatFood(pet, item)) return;
        if (!item.unlimited) removeFromInventory(pet.id, item.id, 1);
        notify();
        return;
    }
    if (item.stat) {
        for (const k of Object.keys(item.stat)) {
            pet.stats[k] = clamp((pet.stats[k] || 0) + item.stat[k], CONFIG.statMin, CONFIG.statMax);
        }
    }
    showToast(`${item.emoji} 使用了 ${item.name}`, 'success', 1000);
    removeFromInventory(pet.id, item.id, 1);
    pet.lastTickAt = Date.now();
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    savePetDebounced(pet);
    notify();
}

async function handleBuy(item, quantity = 1) {
    const pet = getCurrentPet();
    if (!pet) { showToast('请先选择宠物', 'error'); return; }
    const qty = Math.max(1, Number(quantity) | 0);
    const totalPrice = item.price * qty;
    if (state.coins < totalPrice) { showToast(t('notEnoughCoins'), 'error'); return; }
    state.coins -= totalPrice;
    await addToInventory(pet.id, item.id, qty);
    saveUserProfileDebounced();
    showToast(`${item.emoji} ${item.name} +${qty}`, 'success');
    notify();
}

async function handleSell(item, quantity = 1) {
    const pet = getCurrentPet();
    if (!pet) { showToast('请先选择宠物', 'error'); return; }
    if (!item) return;
    if (item.unlimited) { showToast('无限物品无法出售', 'error'); return; }
    const inv = state.inventory || {};
    const owned = inv[item.id] || 0;
    const qty = Math.min(owned, Math.max(1, Number(quantity) | 0));
    if (qty < 1) { showToast('背包里没有此物品', 'error'); return; }
    const unitPrice = Math.floor((item.price || 0) * 0.9);
    const totalGain = unitPrice * qty;
    await removeFromInventory(pet.id, item.id, qty);
    state.coins += totalGain;
    saveUserProfileDebounced();
    showToast(`卖出 ${item.emoji} ${item.name} ×${qty}，+${totalGain} 金币`, 'success');
    notify();
}

function persistPlanetPlaytimeNow() {
    if (!state.planetCreatedAt) return;
    flushPlanetPlaytime();
    saveUserProfileDebounced();
}

function startPlanetPlaytimePersistence() {
    if (planetPlaytimeTimer) return;
    planetPlaytimeTimer = setInterval(() => {
        if (!sdk.token) return;
        persistPlanetPlaytimeNow();
    }, 60 * 1000);
}

function stopPlanetPlaytimePersistence() {
    if (!planetPlaytimeTimer) return;
    clearInterval(planetPlaytimeTimer);
    planetPlaytimeTimer = null;
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { try { persistPlanetPlaytimeNow(); } catch (_) {} });
    window.addEventListener('pagehide', () => { try { persistPlanetPlaytimeNow(); } catch (_) {} });
}

bootstrap().catch(err => {
    console.error(err);
    showToast('启动失败：' + (err?.message || err), 'error', 5000);
    setView('login');
});
