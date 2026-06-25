// 主程序：SDK 启动 + 路由 + 全局事件
import { $, showToast, confirm, clamp, prompt, escapeHtml } from './utils.js';
import { canPlaceItemInArea, CONFIG, getItemZOrder, getShopItemById, findLargestHouseAcrossLayouts, getStageName, getForcedView, getAgentParams, zoomLevelIdToIndex, DEFAULT_PLANET_ID, getPlanetOnboardingConfig } from './config.js';
import { state, notify, subscribe, setView, setCurrentPet, getCurrentPet } from './state.js';
import {
    loadUserProfile, saveUserProfile, saveUserProfileDebounced,
    loadAllPets, loadPet, deletePet, setCurrentPetPersisted,
    saveLayout, addToInventory, removeFromInventory, savePetDebounced,
    getLayout, ensurePetData, savePet, clearStoredData, saveDecorDataNow, saveInventoryDebounced, loadStoryProgress, saveStoryProgress,
    isOnboardingCompleted, saveOnboardingProgress, markOnboardingCompleted,
} from './storage.js';
import { applyDecay, applyStage, clampEnergyToMax, defaultPermanentTrauma, defaultStats, eggStats, getActiveSickness, getEffectiveSicknessSeverity, getSicknessDef, markPetCared, maybeRollDailySickness, tickOffline, startTickLoop, stopTickLoop, treatPetSicknessOneLevel } from './petTick.js';
import { renderLogin } from './view_login.js';
// view_petList.js (~53KB) is lazy-loaded; see loadPetListView() below.
import { renderHatch } from './view_hatch.js';
// view_home.js (+ the 4 level modules ~600KB) is lazy-loaded so it stays out of
// the startup module graph; see loadHomeView()/renderHomeRoute below.
import { renderShop } from './view_shop.js';
import { renderInventory } from './view_inventory.js';
import { renderProfile } from './view_profile.js';
import { renderHelp } from './view_help.js';
import { normalizeTerrainFieldSlotId, renderTerrainFields, resolveTerrainFieldTypeId } from './view_terrain_fields.js';
import { applySettledOfficialPlanetFromProfile, applyTemporaryHomePlanetFromUrl, renderStarSettlements } from './view_star_settlements.js';
import { hasPostcardParams } from './view_postcard.js';
import { randomDna, decodeDna, dnaRarity, dnaToName, biasDnaForFieldId, crossover } from './dna.js';
import { randId } from './utils.js';
import { itemName, t } from './i18n.js';
import { ensurePlanetProgressStarted, flushPlanetPlaytime } from './planetProgress.js';
import {
    getPetLocationInfo,
    getNannyCareCost,
    getNannyCareEligibility,
    getHomePetRoomPose,
    getPlanetPetLimit,
    getPetFindTarget,
    getGeneratedPetLocation,
    getPetLocationType,
    getReleasedPetHome,
    hasNannyCare,
    hireNannyForPet,
    isPetOnCurrentPlanet,
    isPetSelectable,
    localPlanetPets,
    markPetReleased,
    markPetRemoteExiled,
    selectablePets,
} from './petLifecycle.js';
import SoundManager from './soundManager.js';
import { initAgentBridge } from './agentBridge.js';
// Side-effect import: 订阅 state 并接管所有 [data-mh-pet] 占位符的渲染 + 动画
import { canWakePet, daySleepRejectText, eatFood, hatchPetFromBoarding, isPetInteractionBlocked, isPetSleeping, petArtHtml, preloadPetAssets, say, scanAndMount, setAnim, shouldRejectDaySleep, sleepingInteractionText, startPetSleep, wakePet, wakePetForPlay } from './pet.js';

const sdkCdnUrl = 'https://cdn.keepwork.com/sdk/keepworkSDK.iife.js?v=20260612a';

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = [...document.scripts].find(script => script.src === src);
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function importRuntimeModule(src) {
    return new Function('src', 'return import(src)')(src);
}

async function ensureKeepworkSDK() {
    if (window.KeepworkSDK) return;
    const host = window.location.hostname;
    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const useLocalIndex = isLocalHost && !window.location.pathname.includes('/dist/');
    try {
        if (useLocalIndex) {
            await importRuntimeModule('http://127.0.0.1:5001/index.ts');
        } else {
            await loadScript(sdkCdnUrl);
        }
    } catch (err) {
        if (useLocalIndex) {
            console.warn('Local KeepworkSDK import failed, fallback to CDN:', err);
            await loadScript(sdkCdnUrl);
            return;
        }
        throw err;
    }
}

const soundManager = SoundManager.getInstance();
const APP_AUDIO_VOLUME = 2.5;
const SLEEP_BLOCKED_ROUTES = new Set(['chat', 'minigames', 'hatching', 'hatch']);

// 主面板
const app = document.getElementById('app');

// 立即绘制启动闪屏：首屏渲染不再等待 SDK（CDN 往返 + ~600KB 解析）或网络数据，
// 给用户一个即时可见的内容画面（FCP），SDK 在后台并行加载。
function renderSplash() {
    app.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#0f2747">'
        + '<div style="font-size:30px;font-weight:800;letter-spacing:1px">蛋蛋星球</div>'
        + '<div style="width:34px;height:34px;border:4px solid rgba(14,116,144,.25);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite"></div>'
        + '</div>';
}
renderSplash();

// ==== SDK 延迟初始化 ====
// sdk 在 initSdk() 完成后才可用；所有使用方（路由 / bootstrap）都在其后执行。
let sdk = null;
let sdkReadyPromise = null;
function initSdk() {
    if (sdkReadyPromise) return sdkReadyPromise;
    sdkReadyPromise = (async () => {
        await ensureKeepworkSDK();
        if (!window.KeepworkSDK) throw new Error('KeepworkSDK 未定义');
        sdk = window.keepwork || new window.KeepworkSDK({ timeout: 30000 });
        // 设置 maisi 项目 API Key
        if (sdk.setUserApiKey && window.KeepworkSDK?.API_KEYS?.maisi) {
            sdk.setUserApiKey(window.KeepworkSDK.API_KEYS.maisi);
        }
        sdk.localAPIKeySettings?.load?.().catch(err => console.warn('Local API Key settings load failed:', err));
        sdk.audioEngine?.setVolume?.(APP_AUDIO_VOLUME);
        state.sdk = sdk;
        window.MH_state = state; // 给 view_petList 顶部金币使用
        window.sdk = sdk;
        return sdk;
    })();
    return sdkReadyPromise;
}
// 后台并行预热 SDK（不阻塞首屏）。
initSdk().catch(() => {});

const ITEM_BY_ID = new Proxy({}, { get: (_, id) => getShopItemById(id) });
let planetPlaytimeTimer = null;
let chatViewPromise = null;
let chatViewModule = null;
let minigamesViewPromise = null;
let minigamesViewModule = null;
let pendingMinigameLaunch = null;
let pendingMinigameTab = null;
// 分享链接进入的小游戏（?gameFrom=&game=），引导进入 minigames 视图并自动试玩。
let pendingSharedGame = null;
let hatchingViewPromise = null;
let hatchingViewModule = null;
let settingsViewPromise = null;
let settingsViewModule = null;
let postcardViewPromise = null;
let postcardViewModule = null;
let mailboxViewPromise = null;
let mailboxViewModule = null;
let emailViewPromise = null;
let emailViewModule = null;
let storyPlayerViewPromise = null;
let storyPlayerViewModule = null;
let storyListViewPromise = null;
let storyListViewModule = null;
let storyMakerViewPromise = null;
let storyMakerViewModule = null;
let gameMakerViewPromise = null;
let gameMakerViewModule = null;
let pendingGameMakerEdit = null;
let pendingPostcard = null;
let pendingStoryPath = null;
let pendingStoryData = null;
let pendingStoryReturnToMaker = null;
let pendingStoryReturnToList = false;
let storyMakerOrigin = null;
let shopReturnPreserveRoomMode = false;
let pendingOnboardingProgress = null;
let lastRenderedView = null;
let isBootstrapping = true;

const NEW_USER_STORY_PARAM = 'new_user_story';

// 分享小游戏链接：?gameFrom=<username>&game=<filename>
function parseSharedGameParams() {
    try {
        const url = new URL(window.location.href);
        const fromUsername = (url.searchParams.get('gameFrom') || '').trim();
        const game = (url.searchParams.get('game') || '').trim();
        return { fromUsername, game };
    } catch (_) {
        return { fromUsername: '', game: '' };
    }
}

function hasSharedGameParams() {
    const { fromUsername, game } = parseSharedGameParams();
    return !!(fromUsername && game);
}

// 启动落地视图：分享小游戏 > 明信片 > home。分享小游戏会记下待试玩参数。
function resolveLandingView() {
    if (hasSharedGameParams()) {
        pendingSharedGame = parseSharedGameParams();
        return 'minigames';
    }
    return hasPostcardParams() ? 'postcard' : 'home';
}

function cleanupSharedGameUrl() {
    try {
        const url = new URL(window.location.href);
        ['gameFrom', 'game'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

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

function loadPostcardView() {
    if (postcardViewModule) return Promise.resolve(postcardViewModule);
    if (!postcardViewPromise) {
        postcardViewPromise = import('./view_postcard.js').then((mod) => {
            postcardViewModule = mod;
            return mod;
        });
    }
    return postcardViewPromise;
}

function loadMailboxView() {
    if (mailboxViewModule) return Promise.resolve(mailboxViewModule);
    if (!mailboxViewPromise) {
        mailboxViewPromise = import('./view_mailbox.js').then((mod) => {
            mailboxViewModule = mod;
            return mod;
        });
    }
    return mailboxViewPromise;
}

function loadEmailView() {
    if (emailViewModule) return Promise.resolve(emailViewModule);
    if (!emailViewPromise) {
        emailViewPromise = import('./view_email.js').then((mod) => {
            emailViewModule = mod;
            return mod;
        });
    }
    return emailViewPromise;
}

function loadStoryPlayerView() {
    if (storyPlayerViewModule) return Promise.resolve(storyPlayerViewModule);
    if (!storyPlayerViewPromise) {
        storyPlayerViewPromise = import('./view_story_player.js').then((mod) => {
            storyPlayerViewModule = mod;
            return mod;
        });
    }
    return storyPlayerViewPromise;
}

function loadStoryListView() {
    if (storyListViewModule) return Promise.resolve(storyListViewModule);
    if (!storyListViewPromise) {
        storyListViewPromise = import('./view_story_list.js').then((mod) => {
            storyListViewModule = mod;
            return mod;
        });
    }
    return storyListViewPromise;
}

function loadStoryMakerView() {
    if (storyMakerViewModule) return Promise.resolve(storyMakerViewModule);
    if (!storyMakerViewPromise) {
        storyMakerViewPromise = import('./view_story_maker.js').then((mod) => {
            storyMakerViewModule = mod;
            return mod;
        });
    }
    return storyMakerViewPromise;
}

function loadGameMakerView() {
    if (gameMakerViewModule) return Promise.resolve(gameMakerViewModule);
    if (!gameMakerViewPromise) {
        gameMakerViewPromise = import('./view_game_maker.js').then((mod) => {
            gameMakerViewModule = mod;
            return mod;
        });
    }
    return gameMakerViewPromise;
}

function storyRouteOptions() {
    return {
        onBack: () => {
            if (pendingStoryReturnToMaker) {
                const story = pendingStoryReturnToMaker;
                pendingStoryReturnToMaker = null;
                pendingStoryReturnToList = false;
                pendingStoryPath = null;
                pendingStoryData = null;
                setView('storyMaker');
                openStoryMakerEditor(story);
                return;
            }
            if (pendingStoryReturnToList) {
                pendingStoryReturnToList = false;
                pendingStoryPath = null;
                pendingStoryData = null;
                setView('storyMaker');
                return;
            }
            navigateToView(state.currentPetId ? 'home' : 'petList');
        },
        onPetAction: (action) => handleAction(action, { skipNotify: true, ignoreCooldown: true }),
        onFeedItem: handleFeedItem,
        onLaunchMinigame: handleStoryMinigameLaunch,
        onRaisePet: handleStoryRaisePet,
        onStoryFinished: markStoryCompleted,
    };
}

function renderStoryPlayerRoute() {
    const options = storyRouteOptions();
    const showLoading = () => {
        app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">故事</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开故事...</div>';
        const back = $('mhBack');
        if (back) back.onclick = options.onBack;
    };
    const renderLoaded = async (mod, story) => {
        if (state.currentView !== 'storyPlayer') return;
        try { await loadStoryProgress(); }
        catch (e) { console.warn('加载故事进度失败', e); }
        if (state.currentView !== 'storyPlayer') return;
        const completedPlayback = getCompletedStoryPlayback(story, pendingStoryPath);
        mod.renderStoryPlayer(app, { story }, {
            ...options,
            initialFinished: !!completedPlayback,
            allowUnlockedReplay: !!completedPlayback,
            initialActorId: completedPlayback?.actorId || '',
            sessionKey: `${story?.id || 'story'}:${pendingStoryPath || story?.sourcePath || ''}:${completedPlayback ? 'completed' : 'active'}`,
        });
    };
    if (storyPlayerViewModule && pendingStoryData) {
        renderLoaded(storyPlayerViewModule, pendingStoryData);
        return;
    }
    showLoading();
    loadStoryPlayerView()
        .then(async (mod) => {
            if (!pendingStoryData) pendingStoryData = await mod.loadStoryFile(pendingStoryPath || undefined);
            await renderLoaded(mod, pendingStoryData);
        })
        .catch((e) => {
            console.error('加载故事失败', e);
            showToast('加载故事失败：' + (e?.message || e), 'error');
            if (state.currentView === 'storyPlayer') navigateToView(state.currentPetId ? 'home' : 'petList');
        });
}

function renderStoryMakerRoute() {
    const listOptions = {
        onBack: () => {
            const target = storyMakerOrigin || (state.currentPetId ? 'settings' : 'petList');
            storyMakerOrigin = null;
            navigateToView(target);
        },
        onNewStory: () => openStoryMakerEditor(null),
        onEditStory: (story) => openStoryMakerEditor(story),
        onPlayStory: (story) => {
            pendingStoryData = story;
            pendingStoryPath = null;
            pendingStoryReturnToMaker = null;
            pendingStoryReturnToList = true;
            setView('storyPlayer');
        },
    };
    if (storyListViewModule) {
        storyListViewModule.renderStoryList(app, null, listOptions);
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">故事创作</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开故事列表...</div>';
    const back = $('mhBack');
    if (back) back.onclick = listOptions.onBack;
    loadStoryListView()
        .then(({ renderStoryList }) => {
            if (state.currentView !== 'storyMaker') return;
            renderStoryList(app, null, listOptions);
        })
        .catch((e) => {
            console.error('加载故事列表失败', e);
            showToast('加载故事列表失败：' + (e?.message || e), 'error');
            if (state.currentView === 'storyMaker') {
                const target = storyMakerOrigin || (state.currentPetId ? 'settings' : 'petList');
                storyMakerOrigin = null;
                navigateToView(target);
            }
        });
}

function openStoryMakerEditor(story = null) {
    const options = {
        onBack: () => renderStoryMakerRoute(),
        onPlayStory: (story) => {
            pendingStoryData = story;
            pendingStoryPath = null;
            pendingStoryReturnToMaker = story;
            pendingStoryReturnToList = false;
            setView('storyPlayer');
        },
    };
    if (storyMakerViewModule) {
        storyMakerViewModule.renderStoryMaker(app, { story }, options);
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">故事创作</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开故事创作...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadStoryMakerView()
        .then(({ renderStoryMaker }) => {
            if (state.currentView !== 'storyMaker') return;
            renderStoryMaker(app, { story }, options);
        })
        .catch((e) => {
            console.error('加载故事创作失败', e);
            showToast('加载故事创作失败：' + (e?.message || e), 'error');
            if (state.currentView === 'storyMaker') renderStoryMakerRoute();
        });
}

function renderGameMakerRoute() {
    const editTarget = pendingGameMakerEdit;
    const options = {
        onBack: () => {
            pendingGameMakerEdit = null;
            pendingMinigameTab = 'mine';
            navigateToView('minigames');
        },
        // 保存后停留在创作页（可继续编辑/迭代）。
        onSaved: () => {},
        onPlaySaved: () => {
            pendingGameMakerEdit = null;
            pendingMinigameTab = 'mine';
            navigateToView('minigames');
        },
    };
    if (gameMakerViewModule) {
        gameMakerViewModule.renderGameMaker(app, { game: editTarget }, options);
        return;
    }
    app.innerHTML = `<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('mgGameMakerTitle'))}</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">${escapeHtml(t('mgGameMakerOpening'))}</div>`;
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadGameMakerView()
        .then(({ renderGameMaker }) => {
            if (state.currentView !== 'gameMaker') return;
            renderGameMaker(app, { game: editTarget }, options);
        })
        .catch((e) => {
            console.error('加载创作工坊失败', e);
            showToast(t('mgGameMakerLoadFailed', { error: (e?.message || e) }), 'error');
            if (state.currentView === 'gameMaker') navigateToView('minigames');
        });
}

function renderPostcardRoute() {
    const options = { onBack: () => navigateToView('mailbox'), onPlay: () => navigateToView('home') };
    const data = pendingPostcard ? { postcard: pendingPostcard } : null;
    if (postcardViewModule) {
        postcardViewModule.renderPostcard(app, data, options);
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">明信片</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开明信片...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadPostcardView()
        .then(({ renderPostcard }) => {
            if (state.currentView !== 'postcard') return;
            renderPostcard(app, data, options);
        })
        .catch((e) => {
            console.error('加载明信片失败', e);
            showToast('加载明信片失败：' + (e?.message || e), 'error');
            if (state.currentView === 'postcard') navigateToView('home');
        });
}

function renderMailboxRoute() {
    const options = {
        onBack: () => navigateToView('home'),
        onOpenPostcard: (postcard) => { pendingPostcard = postcard; navigateToView('postcard'); },
        onEmail: () => navigateToView('email'),
    };
    if (mailboxViewModule) { mailboxViewModule.renderMailbox(app, null, options); return; }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">邮箱</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开邮箱...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadMailboxView().then(({ renderMailbox }) => {
        if (state.currentView !== 'mailbox') return;
        renderMailbox(app, null, options);
    }).catch((e) => {
        console.error('加载邮箱失败', e);
        showToast('加载邮箱失败：' + (e?.message || e), 'error');
        if (state.currentView === 'mailbox') navigateToView('home');
    });
}

function renderEmailRoute() {
    const options = { onBack: () => navigateToView('mailbox') };
    if (emailViewModule) { emailViewModule.renderEmail(app, null, options); return; }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">发邮件</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在打开邮件...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadEmailView().then(({ renderEmail }) => {
        if (state.currentView !== 'email') return;
        renderEmail(app, null, options);
    }).catch((e) => {
        console.error('加载邮件失败', e);
        showToast('加载邮件失败：' + (e?.message || e), 'error');
        if (state.currentView === 'email') navigateToView('mailbox');
    });
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
    const launch = pendingMinigameLaunch;
    const returnToCellLevel = () => {
        state.lastHomeZoomLevel = 3;
        navigateToView('home');
    };
    const renderOptions = {
        onBack: () => {
            pendingMinigameLaunch = null;
            if (launch?.mode === 'story') {
                handleStoryMinigameExit();
                return;
            }
            if (launch?.mode === 'sickness') {
                returnToCellLevel();
                return;
            }
            if (launch?.mode === 'adopt') {
                // 玩家中途退出领养仪式：不替换 / 放养当前宠物。
                // 只有小游戏真正发出 gameFinished 后，才会创建新蛋并处理当前宠物。
                navigateToView('home');
                return;
            }
            navigateToView('home');
        },
        onGameFinished: (game, data) => {
            if (launch?.mode === 'story') {
                handleStoryMinigameResult(game, data);
                return;
            }
            if (launch?.mode === 'sickness') {
                handleSicknessTreatmentResult(game, data);
                return;
            }
            if (launch?.mode === 'adopt') {
                handleAdoptMinigameResult(game, data);
                return;
            }
            if (launch?.mode === 'onboarding' && isBoardingGame(game, launch)) {
                handleBoardingOnboardingResult(game, data);
                return;
            }
            rewardPetAction('play', `${game?.title || '玩耍'}完成啦，亲密度提升！`, data);
        },
        initialGameId: launch?.gameId || null,
        initialGameParams: launch?.params || null,
        allowPlayWhenLowEnergy: !!launch?.allowLowEnergy,
        suppressRewards: !!launch?.suppressRewards,
        hideTopbarActions: launch?.mode === 'adopt' || launch?.mode === 'onboarding',
        exitGameToBack: launch?.mode === 'sickness' || launch?.mode === 'story' || launch?.mode === 'adopt',
        deferGameFinishedUntilCompletionExit: launch?.mode === 'story',
        completionPrompt: launch?.mode === 'story' ? {
            title: '小游戏完成啦',
            text: '要继续玩一会儿，还是回到故事？',
            continueText: '继续玩',
            backText: '回到故事',
        } : null,
        // "创造"标签跳转到全屏 AI 创作工坊；"我的"里的编辑同样进入全屏工坊。
        initialTab: (() => { const t = pendingMinigameTab; pendingMinigameTab = null; return t; })(),
        onCreateGame: () => {
            pendingGameMakerEdit = null;
            navigateToView('gameMaker');
        },
        onEditGame: (record, html) => {
            pendingGameMakerEdit = (record || html) ? { record: record || null, html: html || '' } : null;
            navigateToView('gameMaker');
        },
        // 分享链接进入：自动试玩别人 workspace 里的小游戏；消费后清掉 URL 参数与待办。
        sharedGame: (() => {
            const shared = pendingSharedGame;
            pendingSharedGame = null;
            if (shared) cleanupSharedGameUrl();
            return shared;
        })(),
    };
    if (minigamesViewModule) {
        minigamesViewModule.renderMinigames(app, { pet }, renderOptions);
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">玩耍</span><span style="width:36px;height:36px"></span></div>';
    const back = $('mhBack');
    if (back) back.onclick = () => navigateToView('home');
    loadMinigamesView()
        .then(({ renderMinigames }) => {
            if (state.currentView !== 'minigames') return;
            renderMinigames(app, { pet: getCurrentPet() }, renderOptions);
        })
        .catch((e) => {
            console.error('加载小游戏视图失败', e);
            showToast('加载小游戏失败：' + (e?.message || e), 'error');
            if (state.currentView === 'minigames') navigateToView('home');
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
            showToast(t('loadSettingsFailed', { error: (e?.message || e) }), 'error');
            if (state.currentView === 'settings') navigateToView(state.currentPetId ? 'home' : 'petList');
        });
}

// view_petList.js（图鉴 / 宠物列表，~53KB）—— 懒加载，移出启动模块图。
let petListViewModule = null;
let petListViewPromise = null;
function loadPetListView() {
    if (!petListViewPromise) {
        petListViewPromise = import('./view_petList.js').then((mod) => { petListViewModule = mod; return mod; });
    }
    return petListViewPromise;
}
async function loadFamousPetsIndex(...args) {
    const mod = petListViewModule || await loadPetListView();
    return mod.loadFamousPetsIndex(...args);
}

async function renderPetListRoute() {
    app.innerHTML = `<div class="topbar"><button class="btn-icon" id="mhPetListBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('petList'))}</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">${escapeHtml(t('petListLoading'))}</div>`;
    const back = $('mhPetListBack');
    if (back) back.onclick = () => setView(state.currentPetId ? 'home' : 'petList');
    if (state.currentView !== 'petList') return;
    const mod = petListViewModule || await loadPetListView();
    if (state.currentView !== 'petList') return;
    mod.renderPetList(app, { pets: (state.petOrder || []).map(id => state.pets[id] || { id, lazyPetRecord: true }) }, {
        onSelect: handleSelectPet,
        onFind:   handleFindPet,
        onDelete: handleDeletePet,
        onBack:   () => setView(state.currentPetId ? 'home' : 'petList'),
        onLoadPet: async (id) => {
            if (!id || state.pets[id] || state.currentView !== 'petList') return;
            try { await loadPet(id); }
            catch (e) { console.warn('加载宠物卡片失败', id, e); }
            return state.pets[id] || null;
        },
    });
}

// ==== 路由 ====
// 家园主舞台（含 4 个 level 模块，约 600KB）—— 懒加载，移出启动模块图。
let homeViewModule = null;
let homeViewPromise = null;
function loadHomeView() {
    if (!homeViewPromise) {
        homeViewPromise = import('./view_home.js').then((mod) => { homeViewModule = mod; return mod; });
    }
    return homeViewPromise;
}
function homeCallbacks() {
    return {
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
        onTreatSickness: handleTreatSickness,
    };
}
function renderHomeRoute() {
    if (homeViewModule) {
        homeViewModule.renderHome(app, { pet: getCurrentPet() }, homeCallbacks());
        return;
    }
    app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">' + escapeHtml(t('loading')) + '</div>';
    loadHomeView()
        .then((mod) => {
            if (state.currentView !== 'home') return;
            mod.renderHome(app, { pet: getCurrentPet() }, homeCallbacks());
        })
        .catch((e) => {
            console.error('加载家园失败', e);
            app.innerHTML = '<div style="padding:24px;color:#b91c1c">' + escapeHtml(t('renderError', { error: (e?.message || e) })) + '</div>';
        });
}

const routes = {
    login:     () => renderLogin(app, null, { onLogin: handleLogin, onOffline: handleOfflineMode }),
    petList:   renderPetListRoute,
    hatch:     () => {
        const pet = getCurrentPet();
        if (pet && guardSleepingRoute(pet)) return;
        renderHatch(app, hatchCtx, {
            onCreated: () => { hatchCtx = {}; setView('home'); },
            onCancel:  () => { hatchCtx = {}; setView('hatching'); },
        });
    },
    home:      renderHomeRoute,
    shop:      () => renderShop(app, null, {
        onBack: () => {
            const preserveRoomMode = shopReturnPreserveRoomMode;
            shopReturnPreserveRoomMode = false;
            navigateToView('home', { preserveRoomMode });
        },
        onBuy: handleBuy,
    }),
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
            showToast(t('enterDecorPlace', { name: itemName(item.name) }), 'info');
        },
    }),
    chat:      renderChatRoute,
    minigames: renderMinigamesRoute,
    hatching:  renderHatchingRoute,
    profile:   () => renderProfile(app, { pet: getCurrentPet() }, { onBack: () => navigateToView('home') }),
    help:      () => renderHelp(app, null, { onBack: () => navigateToView('home') }),
    terrainFields: () => renderTerrainFields(app, null, { onBack: () => navigateToView('home') }),
    starSettlements: () => renderStarSettlements(app, null, { onBack: () => navigateToView('home') }),
    postcard:  renderPostcardRoute,
    mailbox:   renderMailboxRoute,
    email:     renderEmailRoute,
    storyPlayer: renderStoryPlayerRoute,
    storyMaker:  renderStoryMakerRoute,
    gameMaker:   renderGameMakerRoute,
    settings:  renderSettingsRoute,
    ops:       renderOpsConsoleRoute,
    encyclopedia: renderEncyclopediaRoute,
};

// 动物园动物图鉴（仅当前星球配置了 encyclopediaUrl 时可进入）—— 懒加载
let encyclopediaViewModule = null;
function renderEncyclopediaRoute() {
    const callbacks = {
        onBack: () => navigateToView('home'),
        onAdoptAnimal: handleAdoptZooAnimal,
    };
    if (encyclopediaViewModule) {
        encyclopediaViewModule.renderEncyclopedia(app, null, callbacks);
        return;
    }
    app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">' + escapeHtml(t('loading')) + '</div>';
    import('./view_encyclopedia.js')
        .then((mod) => {
            encyclopediaViewModule = mod;
            if (state.currentView !== 'encyclopedia') return;
            mod.renderEncyclopedia(app, null, callbacks);
        })
        .catch((e) => {
            console.error('加载动物图鉴失败', e);
            app.innerHTML = '<div style="padding:24px;color:#b91c1c">' + escapeHtml(t('encLoadFailed')) + '</div>';
        });
}

// 图鉴领养：按 famousPetId 把对应官方宠物直接带回星球（不替换当前宠物，仿故事领养逻辑）。
async function handleAdoptZooAnimal(animal = {}) {
    const famousPetId = String(animal.famousPetId || '').trim();
    if (!famousPetId) {
        showToast(t('encNoPetConfigured'), 'error', 2200);
        throw new Error('no famousPetId');
    }
    // 已拥有同款官方宠物：切换过去即可，不重复领养。
    const owned = getOwnedSystemPetKeySet();
    if (owned.has(`id:${famousPetId}`)) {
        const existing = (state.petOrder || []).map(id => state.pets[id])
            .find(p => p && systemPetOwnedKeys(p).includes(`id:${famousPetId}`));
        if (existing && isPetSelectable(existing)) {
            await setCurrentPetPersisted(existing.id);
            setCurrentPet(existing.id);
        }
        showToast(t('encAlreadyOwned', { name: existing?.name || '' }), 'info', 3000);
        setView('home');
        return;
    }
    let list = [];
    try { list = await loadFamousPetsIndex(); } catch (_) {}
    const entry = (Array.isArray(list) ? list : []).find(item => String(item?.id || '').trim() === famousPetId);
    const target = entry ? normalizeSystemHatchTarget(entry) : null;
    if (!target) {
        showToast(t('encNoPetConfigured'), 'error', 2200);
        throw new Error(`famous pet not found: ${famousPetId}`);
    }
    const now = Date.now();
    const pet = {
        id: 'pet_' + randId(8),
        name: target.name,
        dna: target.dna,
        imageUrl: target.imageUrl || null,
        imageSheetUrl: target.imageSheetUrl,
        traits: target.traits,
        rarity: target.rarity,
        stats: { ...defaultStats(), hunger: 100, mood: 100, clean: 100, bond: 60 },
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now,
        lastTickAt: now,
        lastCareAt: now,
        parents: null,
        stage: 'baby',
        anim: 'happy',
        activeRoom: 'living',
        source: 'famous-pets',
        sourcePetId: `famous-pets/${target.id}`,
        adoptedFromZoo: String(state.settings?.starSettlement?.planetId || ''),
        adoptedFromAnimal: String(animal.id || ''),
    };
    applyStage(pet);
    await savePet(pet);
    await setCurrentPetPersisted(pet.id);
    setCurrentPet(pet.id);
    try { await ensurePetData(pet.id); } catch (_) {}
    const exiled = await enforcePlanetPetLimit(pet.id);
    preloadLoadedPetAssets();
    const exileText = exiled.length
        ? ` ${exiled.map(item => `${item.pet.name || '一只宠物'}去了${item.location.name}`).join('，')}。`
        : '';
    showToast(t('encAdoptSuccess', { name: pet.name }) + exileText, exiled.length ? 'info' : 'success', exiled.length ? 4200 : 2600);
    setView('home');
}

// 运营控制台（?view=ops，开发者 / 一人公司兜底面板）—— 懒加载
let opsConsoleModule = null;
function renderOpsConsoleRoute() {
    if (opsConsoleModule) {
        opsConsoleModule.renderOpsConsole(app, null, { onBack: () => navigateToView('home') });
        return;
    }
    app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">Loading ops console…</div>';
    import('./view_ops_console.js')
        .then((mod) => {
            opsConsoleModule = mod;
            if (state.currentView !== 'ops') return;
            mod.renderOpsConsole(app, null, { onBack: () => navigateToView('home') });
        })
        .catch((e) => {
            console.error('加载运营控制台失败', e);
            app.innerHTML = '<div style="padding:24px;color:#b91c1c">Ops console load failed: ' + escapeHtml(String(e?.message || e)) + '</div>';
        });
}

let hatchCtx = {};

function preloadLoadedPetAssets() {
    try {
        const pet = getCurrentPet();
        if (pet) preloadPetAssets(pet, { includeAll: false });
    } catch (e) {
        console.warn('预加载宠物资源失败', e);
    }
}

function cleanupLeavingView(nextView) {
    if (lastRenderedView === nextView) return;
    if (lastRenderedView === 'storyPlayer') storyPlayerViewModule?.disposeStoryPlayer?.();
    if (lastRenderedView === 'storyMaker') storyMakerViewModule?.disposeStoryMaker?.();
    if (lastRenderedView === 'gameMaker') gameMakerViewModule?.disposeGameMaker?.();
    if (lastRenderedView === 'encyclopedia') encyclopediaViewModule?.disposeEncyclopedia?.();
    // Field scene background music only belongs to the home view. When we leave
    // home for any other view (minigames, chat, shop, hatching, settings, ...),
    // stop the music so it does not keep playing over a silent screen.
    if (lastRenderedView === 'home' && nextView !== 'home') {
        soundManager.stopBgMusic?.({ fadeMs: 360 });
    }
    lastRenderedView = nextView;
}

function render() {
    if (isBootstrapping) return;
    const currentView = (sdk.token || state.offlineMode) ? state.currentView : 'login';
    if (state.currentView !== currentView) state.currentView = currentView;
    cleanupLeavingView(currentView);
    homeViewModule?.stopHomeWalk?.();
    const fn = routes[currentView] || routes.login;
    try { fn(); } catch (e) { console.error('render 失败', e); app.innerHTML = '<div style="padding:30px;color:#b91c1c">' + escapeHtml(t('renderError', { error: (e?.message || e) })) + '</div>'; }
}
subscribe(render);

function finishBootstrap() {
    isBootstrapping = false;
}

async function loadCurrentUser() {
    if (!sdk.token) return null;
    if (typeof sdk.getUserProfile === 'function') return await sdk.getUserProfile();
    if (typeof sdk.getCurrentUser === 'function') return await sdk.getCurrentUser();
    return sdk.user || null;
}

function clearUnauthenticatedSession() {
    try { sdk.logout?.(); } catch (_) {}
    sdk.token = null;
    state.user = null;
    state.offlineMode = false;
}

function currentAppTitle() {
    return String(state.settings?.starSettlement?.appTitle || '').trim() || t('appName');
}

// Resolve the boot landing view, honoring a forced `view` URL param / `window.__view`
// global (see config.getForcedView). For the zoom-level views (planet/field/pet/cell)
// we land on `home` and pin the zoom dial; `game` lands on the minigames view.
// Returns the natural fallback view when nothing is forced.
function resolveForcedBootView(fallbackView) {
    const forced = getForcedView();
    if (!forced) return fallbackView;
    if (forced === 'game') return 'minigames';
    if (forced === 'ops') return 'ops';
    if (forced === 'encyclopedia') return 'encyclopedia';
    const lv = zoomLevelIdToIndex(forced);
    state.zoomLevel = lv;
    state.lastHomeZoomLevel = lv;
    return 'home';
}

// If a view is forced via `?view=` / `window.__view`, ensure a usable pet context
// exists and navigate straight to the requested view. Returns true when it took
// over the boot flow so callers can early-return. Shared by bootstrap / login /
// offline entry paths.
async function enterForcedViewIfAny() {
    if (!getForcedView()) return false;
    if (!hasSelectablePets()) {
        await prepareDefaultEggHome();
    } else {
        if (state.currentPetId && !isPetSelectable(state.pets[state.currentPetId])) {
            await selectFirstAvailablePet();
        }
        await enforcePlanetPetLimit(state.currentPetId);
        if (state.currentPetId) {
            try { await ensurePetData(state.currentPetId); } catch (_) {}
        }
        preloadLoadedPetAssets();
    }
    finishBootstrap();
    setView(resolveForcedBootView('home'));
    return true;
}

// ==== 启动流程 ====
async function bootstrap() {
    // 等待 SDK 就绪（已在模块加载时并行预热；首屏闪屏此刻已绘制）。
    try {
        await initSdk();
    } catch (err) {
        console.error('SDK 加载失败', err);
        app.innerHTML = '<div style="padding:40px;text-align:center;color:#b91c1c">SDK 加载失败，请检查网络后刷新。</div>';
        throw err;
    }

    // URL token
    try {
        const url = new URL(window.location.href);
        const tok = url.searchParams.get('token');
        if (tok) sdk.token = tok;
    } catch (_) {}

    // 已有 token 则尝试拉取用户。若 token 失效或取不到用户，仍视为未登录。
    if (sdk.token) {
        try {
            state.user = await loadCurrentUser();
        } catch (_) { state.user = null; }
    }

    if (!sdk.token || !state.user) {
        if (sdk.token && !state.user) clearUnauthenticatedSession();
        await applyTemporaryHomePlanetFromUrl();
        finishBootstrap();
        setView('login');
        return;
    }

    // 已登录：提前并行预载家园视图（与网络请求并发），落地 home 时即可直接渲染，避免闪屏。
    loadHomeView();

    // 已登录：加载数据
    try {
        await loadUserProfile();
        await applySettledOfficialPlanetFromProfile();
        await applyTemporaryHomePlanetFromUrl();
        await loadAllPets();
        ensurePlanetProgressStarted();
        startPlanetPlaytimePersistence();
    } catch (e) {
        console.warn('加载数据失败', e);
    }

    // 离线追溯所有宠物，并在每次登录时进行一次每日疾病判定。
    for (const id of Object.keys(state.pets)) {
        const pet = state.pets[id];
        tickOffline(pet);
        if (maybeRollDailySickness(pet)) savePetDebounced(pet);
    }
    startTickLoop();

    // 进入游戏前必须先给"星球"命名（每位用户只有一个星球）
    await ensurePlanetNamed();

    // 强制进入指定视图（?view= 参数 / window.__view 全局变量）。优先级高于
    // 新手故事、URL story 路径与默认蛋流程，但仍保证存在可用宠物作为上下文。
    if (await enterForcedViewIfAny()) return;

    if (!hasSelectablePets()) {
        finishBootstrap();
        // URL 指定的新手故事优先级最高。
        if (await maybeStartNewUserStory()) return;
        // 没有宠物时，pet-story 模式的新手指引本身就是“领养仪式”，应优先于默认蛋流程；
        // minigames 模式因为需要可用宠物，会在 maybeStartOnboarding 内返回 false 而落到默认蛋。
        if (await maybeStartOnboarding()) return;
        await enterDefaultEggHome();
        return;
    } else if (state.currentPetId && !isPetSelectable(state.pets[state.currentPetId])) {
        await selectFirstAvailablePet();
    }

    const urlStoryPath = await getInitialStoryPath();
    if (urlStoryPath) {
        pendingStoryPath = urlStoryPath;
        pendingStoryData = null;
        pendingStoryReturnToMaker = null;
        pendingStoryReturnToList = false;
        finishBootstrap();
        setView('storyPlayer');
        return;
    }
    await enforcePlanetPetLimit(state.currentPetId);
    if (state.currentPetId) {
        try { await ensurePetData(state.currentPetId); } catch (_) {}
    }
    preloadLoadedPetAssets();
    // 已有宠物：进入家园前，按当前星球的 onboarding 配置触发一次新手指引。
    if (await maybeStartOnboarding()) {
        finishBootstrap();
        return;
    }
    // 进入 home；首次启动为星球外层，视图间返回时由 state 恢复上次 home level。
    finishBootstrap();
    setView(resolveLandingView());
}

async function getInitialStoryPath() {
    try {
        const { storyPathFromUrl, normalizeStoryPath } = await loadStoryPlayerView();
        const urlStory = storyPathFromUrl();
        return urlStory ? normalizeStoryPath(urlStory) : '';
    } catch (_) {
        try {
            const url = new URL(window.location.href);
            const story = url.searchParams.get('story') || '';
            return story ? story.replace(/^\/+/, '') : '';
        } catch (__) { return ''; }
    }
}

function hasSelectablePets() {
    return selectablePets(state.petOrder.map(id => state.pets[id]).filter(Boolean)).length > 0;
}

async function getNewUserStoryPath() {
    try {
        const url = new URL(window.location.href);
        const requestedStory = url.searchParams.get(NEW_USER_STORY_PARAM) || '';
        if (!requestedStory) return '';
        const { normalizeStoryPath } = await loadStoryPlayerView();
        return normalizeStoryPath(requestedStory);
    } catch (_) { return ''; }
}

async function maybeStartNewUserStory() {
    const newUserStoryPath = await getNewUserStoryPath();
    if (!newUserStoryPath) return false;
    pendingStoryPath = newUserStoryPath;
    pendingStoryData = null;
    pendingStoryReturnToMaker = null;
    pendingStoryReturnToList = false;
    setView('storyPlayer');
    return true;
}

// ===== 新手指引（onboarding） =====
// 当前激活星球的 id：official 星球用其 planetId，否则视为默认主星球（蛋蛋星球）。
function getActivePlanetId() {
    const settlement = state.settings?.starSettlement;
    if (settlement?.source === 'official' && settlement.planetId) return String(settlement.planetId);
    return DEFAULT_PLANET_ID;
}

// 是否禁用新手指引：URL 带 ?skip_onboarding=1 时跳过（便于调试/分享场景）。
function onboardingDisabledByUrl() {
    try {
        const url = new URL(window.location.href);
        const raw = String(url.searchParams.get('skip_onboarding') || '').trim().toLowerCase();
        return /^(1|true|yes|on)$/.test(raw);
    } catch (_) { return false; }
}

// 解析 onboarding.minigame（可填 gameId 或 html 文件名）为 minigames 视图的 gameId。
function resolveOnboardingMinigameId(minigame) {
    const raw = String(minigame || '').trim();
    if (!raw) return '';
    // 形如 haqi_adventure.html -> adventure；haqi_pet_snake.html -> pet_snake。
    const file = raw.replace(/^\.?\/?(minigames\/)?/i, '').replace(/\.html?$/i, '');
    return file.replace(/^haqi_/i, '') || raw;
}

// 进入星球时按其 onboarding 配置触发新手指引；已完成则跳过。
// 返回 true 表示已接管视图（调用方应直接 return）。
// 注意：URL 参数 new_user_story 优先级更高，由 maybeStartNewUserStory 单独处理。
async function maybeStartOnboarding() {
    if (onboardingDisabledByUrl()) return false;
    const planetId = getActivePlanetId();
    let config;
    try {
        config = await getPlanetOnboardingConfig(planetId);
    } catch (_) { return false; }
    if (!config || config.mode === 'none') return false;
    const progressKey = config.progressKey || planetId;
    let completed = false;
    try { completed = await isOnboardingCompleted(progressKey); } catch (_) { completed = false; }
    if (completed) return false;

    if (config.mode === 'pet-story') {
        if (!config.storyPath) return false;
        let storyPath = config.storyPath;
        try {
            const { normalizeStoryPath } = await loadStoryPlayerView();
            storyPath = normalizeStoryPath(config.storyPath) || config.storyPath;
        } catch (_) {}
        pendingStoryPath = storyPath;
        pendingStoryData = null;
        pendingStoryReturnToMaker = null;
        pendingStoryReturnToList = false;
        // 标记为已完成，避免下次进入重复触发（“走过一次即视为完成新手指引”）。
        try { await markOnboardingCompleted(progressKey, 'pet-story'); } catch (_) {}
        setView('storyPlayer');
        return true;
    }

    if (config.mode === 'minigames') {
        const gameId = resolveOnboardingMinigameId(config.minigame);
        if (!gameId) return false;
        if (!getCurrentPet()) {
            // boarding 类小游戏本身会完成领养/孵化；没有当前宠物时先创建一颗默认蛋作为 iframe 上下文。
            if (isBoardingGame({ id: gameId })) {
                await prepareDefaultEggHome();
            } else {
                // 其它 minigame 需要已有宠物才能玩，交回默认流程。
                return false;
            }
        }
        pendingMinigameLaunch = {
            mode: 'onboarding',
            gameId,
            allowLowEnergy: true,
        };
        pendingOnboardingProgress = { progressKey, mode: 'minigames' };
        finishBootstrap();
        setView('minigames');
        return true;
    }

    return false;
}

// Prepare a default-egg home context (create the egg, load assets) WITHOUT
// committing the final view. Returns nothing; callers decide which view to show.
async function prepareDefaultEggHome() {
    const newPet = await ensureDefaultEgg();
    try { await ensurePetData(state.currentPetId); } catch (_) {}
    state.currentRoom = newPet?.activeRoom || 'living';
    state.isDecorMode = false;
    state.isFeedMode = false;
    await enforcePlanetPetLimit(newPet?.id || state.currentPetId);
    preloadLoadedPetAssets();
}

async function enterDefaultEggHome() {
    await prepareDefaultEggHome();
    setView(resolveLandingView());
}

/** 系统默认蛋：当玩家没有任何宠物时（首次进入 / 删光宠物后）静默创建。 */
async function ensureDefaultEgg() {
    const existing = selectablePets(state.petOrder.map(id => state.pets[id]).filter(Boolean))[0];
    if (existing) return existing;
    return await createNewEgg();
}

async function createNewEgg(options = {}) {
    const now = Date.now();
    let dna = options.dna || randomDna();
    const systemHatchTarget = await resolveSystemHatchTarget(options);
    if (systemHatchTarget?.dna) dna = systemHatchTarget.dna;
    // 若用户已有"主屋"，新蛋更倾向于继承主屋所在领地的 DNA 特征
    const territory = findLargestHouseAcrossLayouts(state.layouts);
    if (!systemHatchTarget && territory?.fieldId) dna = biasDnaForFieldId(dna, resolveTerrainFieldTypeId(territory.fieldId));
    const traits = systemHatchTarget?.traits || decodeDna(dna);
    const trueName = systemHatchTarget?.name || dnaToName(dna);
    const pet = {
        id: 'pet_' + randId(8),
        name: trueName,
        dna,
        imageUrl: null,           // 兼容旧字段，蛋阶段不用
        imageSheetUrl: systemHatchTarget?.imageSheetUrl || null,      // 4x4 精灵图；免费用户蛋会在创建时预定系统宠物
        traits,
        rarity: Number.isFinite(systemHatchTarget?.rarity) ? systemHatchTarget.rarity : dnaRarity(dna),
        stats: eggStats(),
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now,
        lastTickAt: now,
        lastCareAt: now,
        parents: Array.isArray(options.parents) ? options.parents : null,
        stage: 'egg',
        activeRoom: 'living',
        // 蛋阶段累计的 DNA 偏置 —— 喂食 / 许愿都会落在这里，孵化时统一应用
        eggBias: { feedTraits: {}, feedCount: 0, initialFieldId: territory?.fieldId || null },
        wishPrompt: null,
    };
    if (systemHatchTarget) {
        pet.hatchMode = 'system-pet';
        pet.eggDecidedAt = now;
        pet.eggHatchTarget = systemHatchTarget;
        pet.source = 'famous-pets';
        pet.sourcePetId = `famous-pets/${systemHatchTarget.id}`;
    }
    await savePet(pet);
    await setCurrentPetPersisted(pet.id);
    setCurrentPet(pet.id);
    return pet;
}

function shouldUseSystemHatchTarget(options = {}) {
    if (options.hatchMode === 'llm' || options.generationMode === 'llm' || options.useSystemPet === false) return false;
    if (options.hatchTarget) return true;
    return true;
}

function normalizeSystemHatchTarget(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || '').trim();
    const dna = String(entry.dna || '').trim();
    const imageSheetUrl = String(entry.imageSheetUrl || '').trim();
    if (!id || !dna || !imageSheetUrl) return null;
    return {
        source: 'famous-pets',
        id,
        name: String(entry.name || id).trim(),
        dna,
        imageUrl: entry.imageUrl || null,
        imageSheetUrl,
        traits: entry.traits && typeof entry.traits === 'object' ? JSON.parse(JSON.stringify(entry.traits)) : decodeDna(dna),
        rarity: Number.isFinite(Number(entry.rarity)) ? Number(entry.rarity) : dnaRarity(dna),
        decidedAt: Date.now(),
    };
}

function systemPetOwnedKeys(pet = {}) {
    const keys = [];
    const sourcePetId = String(pet.sourcePetId || '').trim();
    const targetId = String(pet.eggHatchTarget?.id || '').trim();
    const targetName = String(pet.eggHatchTarget?.name || '').trim();
    const sourceId = sourcePetId.replace(/^famous-pets\//, '');
    if (sourceId) keys.push(`id:${sourceId}`);
    if (targetId) keys.push(`id:${targetId}`);
    if (targetName) keys.push(`name:${targetName}`);
    if (pet.source === 'famous-pets') {
        const petId = String(pet.id || '').trim();
        const petName = String(pet.name || '').trim();
        if (petId) keys.push(`id:${petId}`);
        if (petName) keys.push(`name:${petName}`);
    }
    return keys;
}

function getOwnedSystemPetKeySet() {
    const owned = new Set();
    (state.petOrder || []).forEach(id => {
        const pet = state.pets[id];
        if (!pet) return;
        systemPetOwnedKeys(pet).forEach(key => owned.add(key));
    });
    return owned;
}

async function resolveSystemHatchTarget(options = {}) {
    if (!shouldUseSystemHatchTarget(options)) return null;
    if (options.hatchTarget) return normalizeSystemHatchTarget(options.hatchTarget);
    let list = [];
    try { list = await loadFamousPetsIndex(); }
    catch (e) { console.warn('加载系统宠物列表失败', e); }
    const candidates = (Array.isArray(list) ? list : []).map(normalizeSystemHatchTarget).filter(Boolean);
    if (!candidates.length) return null;
    const owned = getOwnedSystemPetKeySet();
    const unowned = candidates.filter(entry => !owned.has(`id:${entry.id}`) && !owned.has(`name:${entry.name}`));
    const pool = unowned.length ? unowned : candidates;
    return pool[Math.floor(Math.random() * pool.length)] || null;
}

async function firstSelectablePetId(excludeId = null) {
    for (const id of state.petOrder || []) {
        if (!id || id === excludeId) continue;
        const pet = state.pets[id] || await loadPet(id);
        if (pet && isPetSelectable(pet)) return pet.id;
    }
    return null;
}

async function loadOrderedPets() {
    const pets = [];
    for (const id of state.petOrder || []) {
        if (!id) continue;
        const pet = state.pets[id] || await loadPet(id);
        if (pet) pets.push(pet);
    }
    return pets;
}

async function selectFirstAvailablePet(preferredId = null) {
    const preferred = preferredId ? (state.pets[preferredId] || await loadPet(preferredId)) : null;
    const nextId = preferred && isPetSelectable(preferred) ? preferredId : await firstSelectablePetId();
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
    // 总宠物数未超过上限时，星球绝不可能超载——直接跳过，避免为了计数而加载全部 pet.json。
    if ((state.petOrder?.length || 0) <= limit) return [];
    const orderedPets = await loadOrderedPets();
    const orderIndex = new Map((state.petOrder || []).map((id, index) => [id, index]));
    let localPets = localPlanetPets(orderedPets);
    if (localPets.length <= limit) return [];
    const candidates = localPets
        .filter(pet => pet.id !== preferredKeepId)
        .sort((a, b) => {
            const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
            const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
            return (ai - bi) || ((Number(a.bornAt) || 0) - (Number(b.bornAt) || 0));
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

function normalizeStoryPetName(value) {
    return String(value || '').trim().toLowerCase();
}

function storyPetImageKeys(pet = {}) {
    return [pet.imageUrl, pet.imageSheetUrl]
        .map(value => String(value || '').trim())
        .filter(Boolean);
}

async function findDuplicateStoryPet(template = {}, actor = {}) {
    const rewardName = normalizeStoryPetName(template.name || actor?.name || '');
    const rewardImageKeys = new Set(storyPetImageKeys(template));
    const pets = await loadOrderedPets();
    return pets.find(pet => {
        if (rewardName && normalizeStoryPetName(pet.name) === rewardName) return true;
        if (!rewardImageKeys.size) return false;
        return storyPetImageKeys(pet).some(url => rewardImageKeys.has(url));
    }) || null;
}

function storyProgressKeys(story, path = '') {
    return [...new Set([
        story?.id,
        story?.sourcePath,
        path,
    ].map(value => String(value || '').trim()).filter(Boolean))];
}

function getCompletedStoryPlayback(story, path = '') {
    const completed = state.storyProgress?.completed || {};
    const key = storyProgressKeys(story, path).find(item => completed[item]);
    if (key) return completed[key];
    const duplicate = Object.values(state.pets || {}).find(pet => pet?.sourceStoryId && storyProgressKeys(story, path).includes(pet.sourceStoryId));
    return duplicate ? { completedAt: duplicate.bornAt || Date.now(), actorId: duplicate.sourceActorId || '' } : null;
}

async function markStoryCompleted(story, actor) {
    try { await loadStoryProgress(); }
    catch (e) { console.warn('加载故事进度失败', e); }
    const keys = storyProgressKeys(story, pendingStoryPath);
    if (!keys.length) return;
    const completed = { ...(state.storyProgress?.completed || {}) };
    const completedAt = Date.now();
    keys.forEach(key => {
        completed[key] = {
            ...(completed[key] || {}),
            completedAt: completed[key]?.completedAt || completedAt,
            actorId: actor?.id || completed[key]?.actorId || '',
        };
    });
    state.storyProgress = { ...(state.storyProgress || {}), completed };
    saveStoryProgress().catch(e => console.warn('保存故事进度失败', e));
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
    state.offlineMode = false;
    if (!sdk.showLoginWindow) {
        showToast('未找到登录入口', 'error');
        setView('login');
        return;
    }
    try {
        await sdk.showLoginWindow({ title: `${currentAppTitle()} 登录` });
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
        if (!state.user) {
            clearUnauthenticatedSession();
            setView('login');
            return;
        }
        try { await loadUserProfile(); await applySettledOfficialPlanetFromProfile(); await applyTemporaryHomePlanetFromUrl(); await loadAllPets(); } catch (e) { console.warn(e); }
        ensurePlanetProgressStarted();
        startPlanetPlaytimePersistence();
        for (const id of Object.keys(state.pets)) {
            const pet = state.pets[id];
            tickOffline(pet);
            if (maybeRollDailySickness(pet)) savePetDebounced(pet);
        }
        startTickLoop();
        await ensurePlanetNamed();
        if (await enterForcedViewIfAny()) return;
        if (!hasSelectablePets()) {
            if (await maybeStartNewUserStory()) return;
            await enterDefaultEggHome();
            return;
        } else if (state.currentPetId && !isPetSelectable(state.pets[state.currentPetId])) {
            await selectFirstAvailablePet();
        }
        const urlStoryPath = await getInitialStoryPath();
        if (urlStoryPath) {
            pendingStoryPath = urlStoryPath;
            pendingStoryData = null;
            pendingStoryReturnToMaker = null;
            pendingStoryReturnToList = false;
            setView('storyPlayer');
            return;
        }
        await enforcePlanetPetLimit(state.currentPetId);
        if (state.currentPetId) {
            try { await ensurePetData(state.currentPetId); } catch (_) {}
        }
        preloadLoadedPetAssets();
        setView(resolveLandingView());
    }
}

async function handleOfflineMode() {
    try {
        state.offlineMode = true;
        state.user = { id: 'offline', username: 'offline', name: 'Offline', offline: true };
        await loadUserProfile();
        await applyTemporaryHomePlanetFromUrl();
        await loadAllPets();
        for (const id of Object.keys(state.pets)) {
            const pet = state.pets[id];
            tickOffline(pet);
            if (maybeRollDailySickness(pet)) savePetDebounced(pet);
        }
        startTickLoop();
        await ensurePlanetNamed();
        if (await enterForcedViewIfAny()) return;
        if (!hasSelectablePets()) {
            await enterDefaultEggHome();
            return;
        } else if (state.currentPetId && !isPetSelectable(state.pets[state.currentPetId])) {
            await selectFirstAvailablePet();
        }
        await enforcePlanetPetLimit(state.currentPetId);
        if (state.currentPetId) {
            try { await ensurePetData(state.currentPetId); } catch (_) {}
        }
        preloadLoadedPetAssets();
        setView(resolveLandingView());
    } catch (e) {
        console.warn('离线模式启动失败', e);
        state.offlineMode = false;
        state.user = null;
        showToast('离线模式启动失败：' + (e?.message || e), 'error');
        setView('login');
    }
}

function handleLogout() {
    try { sdk.logout?.(); } catch (_) {}
    sdk.token = null;
    state.user = null;
    state.offlineMode = false;
    persistPlanetPlaytimeNow();
    stopTickLoop();
    stopPlanetPlaytimePersistence();
    setView('login');
}

async function handleClearData() {
    try {
        await clearStoredData();
        await loadUserProfile();
        await applySettledOfficialPlanetFromProfile();
        await applyTemporaryHomePlanetFromUrl();
        await loadAllPets();
        state.layouts = {};
        state.inventory = {};
        state.inventoryOrder = [];
        state.isDecorMode = false;
        state.isFeedMode = false;
        showToast('已清除', 'success');
        await ensurePlanetNamed();
        if (await maybeStartNewUserStory()) return;
        await enterDefaultEggHome();
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
    state.activePetFieldPose = null;
    state.activePetRoomPose = null;
    state.activePetRoomFocusPose = null;
    state.isDecorMode = false;
    state.isFeedMode = false;
    try { await ensurePetData(id); } catch (_) {}
    try { preloadPetAssets(state.pets[id], { includeAll: false }); } catch (_) {}
    setView('home');
}

async function handleFindPet(id) {
    const pet = state.pets[id] || (id ? { id } : null);
    if (!pet) return;
    const target = getPetFindTarget(pet);
    if (!target) {
        const info = getPetLocationInfo(pet, state.planetName || '宠物星');
        showToast(`${pet.name || '这只宠物'} 现在在 ${info.label}，不能在当前星球寻找。`, 'info', 2200);
        return;
    }
    const current = getCurrentPet();
    if (!current) return;
    state.isDecorMode = false;
    state.isFeedMode = false;
    if (target.kind === 'field') {
        const home = pet?.id !== state.currentPetId ? getGeneratedPetLocation(pet)
            : getPetLocationType(pet) === 'released' ? getReleasedPetHome(pet) : null;
        state.currentField = normalizeTerrainFieldSlotId(target.id);
        const side = Math.random() < 0.5 ? -1 : 1;
        const activeX = home?.kind === 'field' ? clamp(home.x + side * 0.085, 0.08, 0.92) : 0;
        const activeY = home?.kind === 'field' ? clamp(home.y + 0.025 + Math.random() * 0.035, 0.36, 0.90) : 0;
        state.activePetFieldPose = home?.kind === 'field'
            ? { fieldId: state.currentField, targetPetId: pet.id, targetX: home.x, targetY: home.y, x: activeX, y: activeY, delay: 0, dur: 9, dx: 0, dy: 0 }
            : null;
        state.activePetRoomPose = null;
        state.activePetRoomFocusPose = null;
        state.zoomLevel = 1;
        state.lastHomeZoomLevel = 1;
        setView('home');
        showToast(`已带 ${current?.name || '当前宠物'} 前往 ${pet.name || '宠物'} 所在的场景`, 'info', 1400);
        return;
    }
    state.currentRoom = target.id || pet.activeRoom || 'living';
    const home = pet?.id !== state.currentPetId
        ? getGeneratedPetLocation(pet)
        : getPetLocationType(pet) === 'released'
            ? getReleasedPetHome(pet)
            : getHomePetRoomPose(pet, state.currentRoom);
    const roomSide = Math.random() < 0.5 ? -1 : 1;
    const activeRoomX = home?.kind === 'room' ? clamp(home.xMeters + roomSide * 0.85, 0, 9.25) : 0;
    const activeRoomY = home?.kind === 'room' ? clamp(home.yMeters + 0.03, 0, 2.25) : 0;
    state.activePetRoomPose = home?.kind === 'room'
        ? { roomId: state.currentRoom, targetPetId: pet.id, targetXMeters: home.xMeters, targetYMeters: home.yMeters, xMeters: activeRoomX, yMeters: activeRoomY, face: roomSide < 0 ? 'right' : 'left' }
        : null;
    state.activePetRoomFocusPose = home?.kind === 'room'
        ? { roomId: state.currentRoom, targetPetId: pet.id, x: (activeRoomX + home.xMeters) / 2, y: (activeRoomY + home.yMeters) / 2 }
        : null;
    state.activePetFieldPose = null;
    if (current && isPetSelectable(current)) {
        current.activeRoom = state.currentRoom;
        savePetDebounced(current);
    }
    state.zoomLevel = 2;
    state.lastHomeZoomLevel = 2;
    setView('home');
    showToast(`已带 ${current?.name || '当前宠物'} 前往 ${pet.name || '宠物'} 所在的房间`, 'info', 1400);
}

async function handleHireNanny(pet, days = 1) {
    if (!pet) return;
    if (!isPetOnCurrentPlanet(pet)) {
        showToast('这只宠物已经不在当前星球，无法雇佣保姆。', 'info');
        return;
    }
    if (hasNannyCare(pet)) {
        showToast('保姆已经在照看中。', 'info', 1600);
        return;
    }
    const eligibility = getNannyCareEligibility(pet);
    if (!eligibility.ok) {
        showToast(eligibility.reasons.join('；'), 'error', 2600);
        return;
    }
    const cost = getNannyCareCost(days);
    if ((state.coins | 0) < cost) {
        showToast(`金币不足，需要 ${cost} 金币。`, 'error', 1800);
        return;
    }
    state.coins = Math.max(0, (state.coins | 0) - cost);
    pet.lastTickAt = Date.now();
    hireNannyForPet(pet, days, pet.lastTickAt);
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    await savePet(pet);
    await saveUserProfile();
    showToast(`已支付 ${cost} 金币，保姆会照看 ${Math.max(1, Math.round(Number(days) || 1))} 天。`, 'success', 2400);
    notify();
}

async function handleAdoptEgg(pet) {
    // 领养确认（含放养警告）已由 showAdoptEggModal 弹出，这里不再重复弹窗，
    // 但此时只启动仪式；放逐旧宠物 / 替换当前蛋 / 生成新宠物必须等 gameFinished 后，
    // 再统一交给 pet.js 的 hatchPetFromBoarding()。
    // 领养仪式：先进入"星球诞生"小游戏（haqi_planet_boarding），
    // 在仪式里命名星球 / 选性格 / 喂第一口 / 许愿，游戏结束后回传 DNA 相关信息，
    // 据此创建新蛋（系别 / 食性 / 元素属性）。游戏需要一只"当前宠物"才能进入。
    if (getCurrentPet()) {
        pendingMinigameLaunch = {
            mode: 'adopt',
            gameId: 'planet_boarding',
            allowLowEnergy: true,
            suppressRewards: true,
        };
        navigateToView('minigames', { preserveMinigameLaunch: true });
        return;
    }
    // 兜底：没有可用宠物（理论上不会发生）时直接创建新蛋。
    await finalizeAdoptedEgg(null);
}

function isBoardingGame(game, launch = {}) {
    const id = String(game?.id || launch?.gameId || '').trim().toLowerCase();
    const src = String(game?.src || launch?.src || '').trim().toLowerCase();
    return id.includes('boarding') || src.includes('boarding');
}

async function finishBoardingHatch(data = {}, { stage = 'baby' } = {}) {
    const pet = await hatchPetFromBoarding(data || {}, { stage, planetName: state.planetName || '宠物星' });
    try { await ensurePetData(pet.id); } catch (_) {}
    state.currentRoom = pet.activeRoom || 'living';
    state.isDecorMode = false;
    state.isFeedMode = false;
    const exiled = await enforcePlanetPetLimit(pet.id);
    const exileText = exiled.length ? ` ${exiled.map(item => `${item.pet.name || '一只宠物'}去了${item.location.name}`).join('，')}。` : '';
    showToast(stage === 'egg' ? `已领养新的蛋。${exileText}` : `${pet.name || '新宠物'} 已在星球上孵化。${exileText}`, exiled.length ? 'info' : 'success', exiled.length ? 3600 : 2200);
    setView('home');
}

// 完成领养：走统一 boarding 孵化逻辑；领养入口保留为蛋阶段。
async function finalizeAdoptedEgg(data) {
    await finishBoardingHatch(data || {}, { stage: 'egg' });
}

// 领养仪式（planet_boarding）结束：用回传数据创建新蛋。
async function handleAdoptMinigameResult(_game, data = {}) {
    pendingMinigameLaunch = null;
    await finalizeAdoptedEgg(data || {});
}

async function handleBoardingOnboardingResult(_game, data = {}) {
    pendingMinigameLaunch = null;
    await finishBoardingHatch(data || {}, { stage: 'baby' });
    if (pendingOnboardingProgress) {
        try { await markOnboardingCompleted(pendingOnboardingProgress.progressKey, pendingOnboardingProgress.mode || 'minigames'); } catch (_) {}
        pendingOnboardingProgress = null;
    }
}

async function handleDeletePet(id) {
    const p = state.pets[id];
    if (!p) return;
    const wasCurrent = state.currentPetId === id;
    const petName = p.name || '这只宠物';
    const ok = await confirm(`是否要将 ${petName} 流放到随机星球？此操作会彻底删除，无法恢复。`, {
        okText: '是，流放',
        cancelText: '取消',
    });
    if (!ok) return;
    await deletePet(id);
    showToast(`${petName} 已流放到随机星球`, 'success', 1800);
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
    const adults = state.petOrder.map(id => state.pets[id]).filter(p => p && isPetOnCurrentPlanet(p) && CONFIG.breedableStages.includes(p.stage));
    if (adults.length < 2) {
        showToast('需要至少两只当前星球的成年宠物才能繁殖', 'info', 2200);
        return;
    }
    showBreedParentPicker(adults);
}

function ensureBreedPickerStyles() {
    if (document.getElementById('mh-breed-picker-styles')) return;
    const style = document.createElement('style');
    style.id = 'mh-breed-picker-styles';
    style.textContent = `
        .mh-breed-modal { width:min(560px, calc(100vw - 32px)); max-height:calc(100vh - 32px); overflow:hidden; display:flex; flex-direction:column; gap:14px; }
        .mh-breed-title { color:var(--text-primary); font-size:20px; font-weight:900; }
        .mh-breed-pet-scroll { display:flex; gap:8px; overflow-x:auto; padding:2px 2px 8px; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; cursor:grab; }
        .mh-breed-pet-scroll.is-dragging-scroll { cursor:grabbing; }
        .mh-breed-pet-card { flex:0 0 96px; min-height:124px; border:1.5px solid var(--border-card); background:var(--bg-card); border-radius:14px; padding:7px; display:flex; flex-direction:column; align-items:center; gap:4px; color:var(--text-primary); box-shadow:0 3px 0 rgba(14,116,144,.15); scroll-snap-align:start; touch-action:none; }
        .mh-breed-pet-card.is-used { opacity:.45; }
        .mh-breed-pet-card:active { transform:translateY(2px); }
        .mh-breed-pet-icon { width:68px; height:68px; border-radius:13px; background:var(--bg-pill); overflow:hidden; flex:0 0 auto; }
        .mh-breed-slot-icon { width:76px; height:76px; border-radius:14px; background:var(--bg-pill); overflow:hidden; flex:0 0 auto; }
        .mh-breed-pet-icon .mh-pet-art, .mh-breed-slot-icon .mh-pet-art { width:100%; height:100%; }
        .mh-breed-pet-name { max-width:100%; color:var(--text-primary); font-size:13px; line-height:1.15; font-weight:900; overflow:hidden; text-align:center; white-space:normal; word-break:break-word; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .mh-breed-pet-stage { color:var(--text-muted); font-size:11px; font-weight:800; flex:0 0 auto; }
        .mh-breed-drag-ghost { position:fixed; left:0; top:0; z-index:100000; pointer-events:none; opacity:.94; transform:translate(-50%, -50%) scale(1.02); box-shadow:0 12px 28px rgba(14,116,144,.28); }
        .mh-breed-notice { border:1px solid rgba(14,165,233,.24); background:#ecfeff; color:var(--accent-dark); border-radius:14px; padding:9px 11px; font-size:12px; font-weight:800; line-height:1.45; }
        .mh-breed-notice.is-error { border-color:rgba(239,68,68,.28); background:#fff1f2; color:#b91c1c; }
        .mh-breed-slots { display:flex; align-items:center; justify-content:center; gap:12px; padding:2px 0; }
        .mh-breed-slot { width:96px; height:96px; border:2px dashed rgba(14,165,233,.55); border-radius:18px; background:rgba(239,246,255,.72); color:var(--text-muted); display:flex; align-items:center; justify-content:center; text-align:center; padding:8px; }
        .mh-breed-slot.is-over { border-color:var(--accent); background:#ecfeff; }
        .mh-breed-slot.is-filled { background:var(--bg-card); color:var(--text-primary); }
        .mh-breed-slot-placeholder { width:36px; height:36px; border-radius:999px; border:2px dotted rgba(14,165,233,.34); }
        .mh-breed-slot-plus { color:var(--accent-dark); font-size:28px; line-height:1; font-weight:900; }
        .mh-breed-actions { display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap; }
        .mh-breed-countdown { width:min(360px, calc(100vw - 40px)); text-align:center; }
        .mh-breed-count-number { margin:12px auto 6px; width:92px; height:92px; border-radius:999px; display:flex; align-items:center; justify-content:center; background:var(--bg-pill); color:var(--accent-dark); font-size:42px; font-weight:900; border:2px solid var(--accent); box-shadow:0 5px 0 rgba(37,99,235,.45); }
        @media (max-width:520px) { .mh-breed-pet-card { flex-basis:96px; } .mh-breed-slots { gap:10px; } .mh-breed-slot { width:88px; height:88px; } .mh-breed-slot-icon { width:70px; height:70px; } }
    `;
    document.head.appendChild(style);
}

function breedPetIconHtml(pet) {
    return `<span class="mh-breed-pet-icon">${petArtHtml(pet, { alt: pet.name || '' })}</span>`;
}

function showBreedParentPicker(adults) {
    ensureBreedPickerStyles();
    const selected = [null, null];
    const noticeMessages = [];
    const hasEnoughAdults = adults.length >= 2;
    const canAffordBreed = state.coins >= CONFIG.breedCost;
    if (!hasEnoughAdults) noticeMessages.push('需要至少两只成年宠物');
    if (!canAffordBreed) noticeMessages.push(`繁殖需要 ${CONFIG.breedCost} 金币，当前 ${state.coins | 0} 金币`);
    let draggedPetId = null;
    let pointerDragPet = null;
    let suppressNextClick = false;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card mh-breed-modal">
            <div>
                <div class="mh-breed-title">选择宝宝父母</div>
            </div>
            <div class="mh-breed-notice ${noticeMessages.length ? 'is-error' : ''}">${escapeHtml(noticeMessages.join('；') || `繁殖需要 ${CONFIG.breedCost} 金币，确认后扣除。`)}</div>
            <div class="mh-breed-pet-scroll" data-breed-scroll>
                ${adults.map(pet => `
                    <button class="mh-breed-pet-card" type="button" draggable="true" data-breed-pet="${escapeHtml(pet.id)}">
                        ${breedPetIconHtml(pet)}
                        <span class="mh-breed-pet-name">${escapeHtml(pet.name || dnaToName(pet.dna || '') || '哈奇伙伴')}</span>
                        <span class="mh-breed-pet-stage">${escapeHtml(getStageName(pet.stage, '成年'))}</span>
                    </button>`).join('')}
            </div>
            <div class="mh-breed-slots">
                <div class="mh-breed-slot" data-breed-slot="0" title="拖入第一只宠物"></div>
                <div class="mh-breed-slot-plus">+</div>
                <div class="mh-breed-slot" data-breed-slot="1" title="拖入第二只宠物"></div>
            </div>
            <div class="mh-breed-actions">
                <button class="btn-secondary" data-breed-cancel>取消</button>
                <button class="btn-primary" data-breed-ok disabled>确定</button>
            </div>
        </div>`;

    const close = () => { pointerDragPet?.ghost?.remove(); mask.remove(); };
    const petById = new Map(adults.map(pet => [pet.id, pet]));
    const firstEmptySlot = () => selected.findIndex(item => !item);
    const clearSlotOvers = () => mask.querySelectorAll('[data-breed-slot]').forEach(slot => slot.classList.remove('is-over'));
    const movePointerGhost = (drag, clientX, clientY) => {
        if (!drag.ghost) return;
        drag.ghost.style.left = clientX + 'px';
        drag.ghost.style.top = clientY + 'px';
        clearSlotOvers();
        const dropTarget = document.elementFromPoint(clientX, clientY)?.closest?.('[data-breed-slot]');
        if (dropTarget && mask.contains(dropTarget)) dropTarget.classList.add('is-over');
    };
    const startPointerGhost = (drag, clientX, clientY) => {
        if (drag.ghost) return;
        drag.ghost = drag.source.cloneNode(true);
        drag.ghost.classList.add('mh-breed-drag-ghost');
        drag.ghost.style.width = drag.source.getBoundingClientRect().width + 'px';
        document.body.appendChild(drag.ghost);
        movePointerGhost(drag, clientX, clientY);
    };
    const stopPointerDrag = () => {
        pointerDragPet?.ghost?.remove();
        pointerDragPet = null;
        clearSlotOvers();
    };
    const renderSlots = () => {
        mask.querySelectorAll('[data-breed-slot]').forEach(slot => {
            const idx = Number(slot.dataset.breedSlot) || 0;
            const pet = selected[idx];
            slot.classList.toggle('is-filled', !!pet);
            slot.innerHTML = pet ? `<span class="mh-breed-slot-icon">${petArtHtml(pet, { alt: pet.name || '' })}</span>` : '<span class="mh-breed-slot-placeholder" aria-hidden="true"></span>';
        });
        mask.querySelectorAll('[data-breed-pet]').forEach(btn => {
            const used = selected.some(pet => pet?.id === btn.dataset.breedPet);
            btn.classList.toggle('is-used', used);
        });
        const okBtn = mask.querySelector('[data-breed-ok]');
        if (okBtn) okBtn.disabled = !(hasEnoughAdults && canAffordBreed && selected[0] && selected[1] && selected[0].id !== selected[1].id);
        scanAndMount(mask);
    };
    const assignPet = (petId, slotIndex = firstEmptySlot()) => {
        const pet = petById.get(petId);
        if (!pet) return;
        const existingIndex = selected.findIndex(item => item?.id === pet.id);
        if (existingIndex >= 0) {
            selected[existingIndex] = null;
        } else {
            selected[slotIndex < 0 ? 0 : slotIndex] = pet;
        }
        renderSlots();
    };

    mask.addEventListener('click', async (e) => {
        if (suppressNextClick) { suppressNextClick = false; return; }
        if (e.target === mask || e.target.closest('[data-breed-cancel]')) { close(); return; }
        const petBtn = e.target.closest('[data-breed-pet]');
        if (petBtn) { assignPet(petBtn.dataset.breedPet); return; }
        const slot = e.target.closest('[data-breed-slot]');
        if (slot && selected[Number(slot.dataset.breedSlot) || 0]) { selected[Number(slot.dataset.breedSlot) || 0] = null; renderSlots(); return; }
        if (e.target.closest('[data-breed-ok]')) {
            if (!selected[0] || !selected[1]) return;
            await completeBreedWithParents(selected[0], selected[1], close);
        }
    });
    mask.addEventListener('dragstart', (e) => {
        const btn = e.target.closest?.('[data-breed-pet]');
        if (!btn) return;
        draggedPetId = btn.dataset.breedPet;
        e.dataTransfer?.setData('text/plain', draggedPetId);
    });
    mask.addEventListener('dragover', (e) => {
        const slot = e.target.closest?.('[data-breed-slot]');
        if (!slot) return;
        e.preventDefault();
        slot.classList.add('is-over');
    });
    mask.addEventListener('dragleave', (e) => {
        e.target.closest?.('[data-breed-slot]')?.classList.remove('is-over');
    });
    mask.addEventListener('drop', (e) => {
        const slot = e.target.closest?.('[data-breed-slot]');
        if (!slot) return;
        e.preventDefault();
        slot.classList.remove('is-over');
        assignPet(e.dataTransfer?.getData('text/plain') || draggedPetId, Number(slot.dataset.breedSlot) || 0);
    });
    mask.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest?.('[data-breed-pet]');
        if (!btn) return;
        const scroller = mask.querySelector('[data-breed-scroll]');
        pointerDragPet = { id: btn.dataset.breedPet, x: e.clientX, y: e.clientY, scroller, left: scroller?.scrollLeft || 0, source: btn, ghost: null };
        btn.setPointerCapture?.(e.pointerId);
    });
    mask.addEventListener('pointermove', (e) => {
        if (!pointerDragPet?.scroller) return;
        const dx = e.clientX - pointerDragPet.x;
        const dy = e.clientY - pointerDragPet.y;
        const moved = Math.hypot(dx, dy);
        if (moved < 8) return;
        if (!pointerDragPet.ghost && Math.abs(dx) > Math.abs(dy)) {
            pointerDragPet.scroller.scrollLeft = pointerDragPet.left - dx;
            return;
        }
        e.preventDefault();
        startPointerGhost(pointerDragPet, e.clientX, e.clientY);
        movePointerGhost(pointerDragPet, e.clientX, e.clientY);
    });
    mask.addEventListener('pointerup', (e) => {
        if (!pointerDragPet) return;
        const drag = pointerDragPet;
        const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
        if (moved < 8) { stopPointerDrag(); return; }
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-breed-slot]');
        if (dropTarget && mask.contains(dropTarget)) assignPet(drag.id, Number(dropTarget.dataset.breedSlot) || 0);
        stopPointerDrag();
        suppressNextClick = true;
    });
    mask.addEventListener('pointercancel', stopPointerDrag);
    const scroller = mask.querySelector('[data-breed-scroll]');
    let scrollDrag = null;
    scroller?.addEventListener('pointerdown', (e) => {
        if (e.target.closest('[data-breed-pet]')) return;
        scrollDrag = { x: e.clientX, left: scroller.scrollLeft };
        scroller.classList.add('is-dragging-scroll');
        scroller.setPointerCapture?.(e.pointerId);
    });
    scroller?.addEventListener('pointermove', (e) => {
        if (!scrollDrag) return;
        scroller.scrollLeft = scrollDrag.left - (e.clientX - scrollDrag.x);
    });
    const stopScrollDrag = () => { scrollDrag = null; scroller?.classList.remove('is-dragging-scroll'); };
    scroller?.addEventListener('pointerup', stopScrollDrag);
    scroller?.addEventListener('pointercancel', stopScrollDrag);

    document.body.appendChild(mask);
    renderSlots();
}

async function showBreedCountdown() {
    return new Promise((resolve) => {
        let left = 3;
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal-card mh-breed-countdown">
                <div class="mh-breed-title">宝宝蛋正在抵达</div>
                <div class="mh-breed-subtitle">倒计时结束后，新的蛋会出现在场景中。</div>
                <div class="mh-breed-count-number" data-breed-count>${left}</div>
            </div>`;
        document.body.appendChild(mask);
        const number = mask.querySelector('[data-breed-count]');
        const timer = setInterval(() => {
            left -= 1;
            if (number) number.textContent = String(Math.max(0, left));
            if (left > 0) return;
            clearInterval(timer);
            mask.remove();
            resolve();
        }, 1000);
    });
}

async function completeBreedWithParents(parentA, parentB, closePicker) {
    if (!parentA || !parentB || parentA.id === parentB.id) return;
    if (state.coins < CONFIG.breedCost) return;
    const current = getCurrentPet();
    if (current && isPetOnCurrentPlanet(current)) {
        const ok = await confirm(t('breedReleaseConfirm', { current: current.name || t('currentPetFallback') }), {
            okText: t('releaseAndBreed'),
            cancelText: t('rethink'),
        });
        if (!ok) return;
        markPetReleased(current, state.planetName || '宠物星');
        await savePet(current);
    }
    closePicker?.();
    await showBreedCountdown();
    const dna = crossover(parentA.dna, parentB.dna);
    const newPet = await createNewEgg({ dna, parents: [parentA.id, parentB.id] });
    state.coins = Math.max(0, state.coins - CONFIG.breedCost);
    saveUserProfileDebounced();
    try { await ensurePetData(newPet.id); } catch (_) {}
    state.currentRoom = newPet.activeRoom || 'living';
    state.isDecorMode = false;
    state.isFeedMode = false;
    const exiled = await enforcePlanetPetLimit(newPet.id);
    const exileText = exiled.length ? ` ${exiled.map(item => `${item.pet.name || '一只宠物'}去了${item.location.name}`).join('，')}。` : '';
    showToast(`宝宝蛋已经来到星球。${exileText}`, exiled.length ? 'info' : 'success', exiled.length ? 3600 : 2200);
    setView('home');
}

// 互动操作
function lowEnergyText(pet) {
    if (pet?.stage === 'egg' || pet?.stage === 'baby') return '体力不足，吃点东西才能恢复';
    return '体力不足，睡醒后最多恢复到一半';
}

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
    if (key === 'sleep' && shouldRejectDaySleep(pet, now)) {
        wakePet(pet, now, { skipRecover: true });
        setAnim('idle', 0);
        savePetDebounced(pet);
        if (!skipNotify) notify();
        requestAnimationFrame(() => say(daySleepRejectText(), 2400));
        return true;
    }
    if (!options.ignoreCooldown && cd[key] && now - cd[key] < cfg.cooldownSec * 1000) {
        const left = Math.ceil((cfg.cooldownSec * 1000 - (now - cd[key])) / 1000);
        showToast(`再等 ${left} 秒～`, 'info');
        return false;
    }
    if (cfg.costCoins && state.coins < cfg.costCoins) {
        showToast('金币不足', 'error');
        return false;
    }
    const staminaCost = Math.abs(Math.min(0, Number(cfg.hunger) || 0));
    if (staminaCost > 0 && (Number(pet.stats?.hunger) || 0) < staminaCost) {
        showToast(lowEnergyText(pet), 'info', 1800);
        return false;
    }
    // 应用属性变化
    for (const k of Object.keys(cfg)) {
        if (['costCoins', 'cooldownSec', 'rewardCoins'].includes(k)) continue;
        if (key === 'sleep' && k === 'hunger') continue;
        if (typeof cfg[k] === 'number') {
            pet.stats[k] = clamp((pet.stats[k] || 0) + cfg[k], CONFIG.statMin, CONFIG.statMax);
        }
    }
    clampEnergyToMax(pet);
    if (cfg.costCoins) { state.coins -= cfg.costCoins; saveUserProfileDebounced(); }
    if (cfg.rewardCoins) { state.coins += cfg.rewardCoins; saveUserProfileDebounced(); showToast(`+${cfg.rewardCoins} 🪙`, 'success', 1200); }
    if (!options.ignoreCooldown) cd[key] = now;
    pet.lastTickAt = now;
    markPetCared(pet, now);
    applyStage(pet);
    savePetDebounced(pet);
    if (key === 'sleep') {
        const sleepResult = startPetSleep(pet, now);
        setAnim(pet.anim || 'idle', 0);
        savePetDebounced(pet);
        if (sleepResult?.wokeImmediately) {
            if (!skipNotify) notify();
            requestAnimationFrame(() => say(sleepResult.message || '我睡不着了', 2400));
            return true;
        }
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
    const staminaCost = Math.abs(Math.min(0, Number(cfg.hunger) || 0));
    if (staminaCost > 0 && (Number(pet.stats.hunger) || 0) < staminaCost) {
        showToast(lowEnergyText(pet), 'info', 1800);
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
    if (key !== 'play') return cfg.rewardCoins || 0;
    const completed = sourceData.completed !== false && sourceData.passed !== false;
    const durationSeconds = activityDurationSeconds(sourceData);
    if (!completed) return Math.min(15, Math.max(0, Math.round(durationSeconds / 20)));
    const explicitRewardCoins = Number(sourceData.rewardCoins ?? sourceData.levelReward?.rewardCoins);
    if (Number.isFinite(explicitRewardCoins)) return Math.max(0, Math.round(explicitRewardCoins));
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
    const rawArea = roomKey.startsWith('field_') ? roomKey.slice('field_'.length) : roomKey;
    const area = roomKey.startsWith('field_') ? resolveTerrainFieldTypeId(rawArea) : rawArea;
    if (!canPlaceItemInArea(item, area)) {
        showToast('这个物品不能放在这里', 'error');
        return;
    }
    const { skipSound = false, ...layoutExtra } = extra && typeof extra === 'object' ? extra : {};
    if (layoutExtra.fieldSize != null) {
        delete layoutExtra.wMeters;
        delete layoutExtra.hMeters;
    }
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
    if (layoutExtra.fieldSize != null) {
        delete layout[idx].wMeters;
        delete layout[idx].hMeters;
        delete layoutExtra.wMeters;
        delete layoutExtra.hMeters;
    }
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

async function navigateToView(target, options = {}) {
    if (!target) return;
    if (!options.preserveRoomMode) await finishRoomModeIfNeeded();
    if (target === 'minigames' && !options.preserveMinigameLaunch) {
        pendingMinigameLaunch = null;
    }
    if (target === 'shop') shopReturnPreserveRoomMode = !!options.preserveRoomMode;
    const pet = getCurrentPet();
    if (pet && target === 'minigames' && isPetSleeping(pet)) {
        wakePetForPlay(pet);
        setAnim('idle', 0);
        markPetCared(pet);
        savePetDebounced(pet);
        notify();
        showToast('宠物被玩耍唤醒啦', 'success', 1200);
    }
    if (pet && SLEEP_BLOCKED_ROUTES.has(target) && isPetInteractionBlocked(pet)) {
        showToast(sleepingInteractionText(pet), 'info', 1800);
        setView('home');
        return;
    }
    if (target === 'home') { setView('home'); return; }
    if (target === 'petList') { setView('petList'); return; }
    if (target !== 'postcard') pendingPostcard = null;
    if (target === 'storyMaker') {
        storyMakerOrigin = options.origin || null;
    }
    if (routes[target]) { setView(target); return; }
    showToast('未知导航：' + target, 'info');
}

function handleStoryMinigameLaunch(activity = {}) {
    const gameId = activity.gameId || activity.id || 'pet_tower_defense';
    if (!getCurrentPet()) {
        storyPlayerViewModule?.completeStoryMinigameActivity?.({ completed: true, storyOnly: true });
        showToast('守护训练完成，抱抱龙更信任你了', 'success', 1600);
        return;
    }
    pendingMinigameLaunch = {
        mode: 'story',
        gameId,
        params: activity.params || null,
        allowLowEnergy: true,
        suppressRewards: true,
    };
    navigateToView('minigames', { preserveMinigameLaunch: true });
}

async function handleStoryMinigameResult(_game, data = {}) {
    const mod = await loadStoryPlayerView();
    mod.completeStoryMinigameActivity?.(data);
}

function handleStoryMinigameExit() {
    pendingMinigameLaunch = null;
    setView('storyPlayer');
}

async function handleStoryRaisePet(story, actor) {
    const template = actor?.petTemplate || actor?.pet || story?.ending?.petTemplate || null;
    if (!template) {
        showToast('故事没有配置可领取的宠物', 'error');
        return;
    }
    const duplicate = await findDuplicateStoryPet(template, actor);
    if (duplicate) {
        markStoryCompleted(story, actor);
        pendingStoryPath = null;
        pendingStoryData = null;
        pendingStoryReturnToMaker = null;
        pendingStoryReturnToList = false;
        if (isPetSelectable(duplicate)) {
            await setCurrentPetPersisted(duplicate.id);
            setCurrentPet(duplicate.id);
        }
        showToast(`你已经拥有 ${duplicate.name || template.name || actor?.name || '这只宠物'} 啦，不需要重复带回星球。`, 'info', 3600);
        setView(state.currentPetId ? 'home' : 'petList');
        return;
    }
    const now = Date.now();
    const pet = {
        id: 'pet_' + randId(8),
        name: template.name || actor?.name || '抱抱龙',
        dna: template.dna || randomDna(),
        imageUrl: template.imageUrl || null,
        imageSheetUrl: template.imageSheetUrl || '',
        traits: template.traits || decodeDna(template.dna || randomDna()),
        rarity: Number.isFinite(template.rarity) ? template.rarity : dnaRarity(template.dna || ''),
        stats: { ...defaultStats(), ...(template.stats || {}), hunger: 100, mood: 100, clean: 100, bond: 80 },
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now - 24 * 60 * 60 * 1000,
        lastTickAt: now,
        lastCareAt: now,
        parents: null,
        stage: template.stage || 'adult',
        wishPrompt: template.wishPrompt || actor?.description || story?.title || '',
        anim: 'happy',
        everAdult: true,
        activeRoom: 'living',
        sourceStoryId: story?.id || '',
        sourceActorId: actor?.id || '',
    };
    applyStage(pet);
    await savePet(pet);
    markStoryCompleted(story, actor);
    await setCurrentPetPersisted(pet.id);
    setCurrentPet(pet.id);
    try { await ensurePetData(pet.id); } catch (_) {}
    const exiled = await enforcePlanetPetLimit(pet.id);
    pendingStoryPath = null;
    pendingStoryData = null;
    pendingStoryReturnToMaker = null;
    pendingStoryReturnToList = false;
    preloadLoadedPetAssets();
    const exileText = exiled.length
        ? ` 星球满了，${exiled.map(item => `${item.pet.name || '一只宠物'}去了${item.location.name}`).join('，')}。`
        : '';
    showToast(`${pet.name} 已来到你的星球！${exileText}`, exiled.length ? 'info' : 'success', exiled.length ? 4600 : 2600);
    setView('home');
}

// 底部导航统一入口
function handleTreatSickness() {
    const pet = getCurrentPet();
    const sickness = getActiveSickness(pet);
    if (!pet || !sickness) {
        showToast('当前没有需要治疗的疾病。', 'info', 1400);
        return;
    }
    if (isPetInteractionBlocked(pet)) {
        showToast(sleepingInteractionText(pet), 'info', 1800);
        return;
    }
    const severity = getEffectiveSicknessSeverity(pet);
    const treatmentHelp = `${sickness.def.name}：当前病情 ${severity}/10。治疗方案：抵御至少 ${severity} 波攻击才能康复。`;
    pendingMinigameLaunch = {
        mode: 'sickness',
        gameId: 'pet_tower_defense',
        params: { additionalHelp: treatmentHelp, sicknessType: sickness.type, sicknessName: sickness.def.name },
        allowLowEnergy: true,
        suppressRewards: true,
    };
    navigateToView('minigames', { preserveMinigameLaunch: true });
}

async function handleSicknessTreatmentResult(game, data = {}) {
    const pet = getCurrentPet();
    const sickness = getActiveSickness(pet);
    if (!pet || !sickness) return;
    if (game?.id !== 'pet_tower_defense') {
        showToast('治疗还没有成功通关，病情不会记录改善。', 'info', 2200);
        return;
    }
    const treatmentLevels = sicknessTreatmentLevelsFromMinigame(data);
    if (treatmentLevels <= 0) {
        pendingMinigameLaunch = null;
        showToast('还没有守住任何波次，病情不会记录改善。', 'info', 2200);
        state.lastHomeZoomLevel = 3;
        navigateToView('home');
        return;
    }
    let result = null;
    for (let i = 0; i < treatmentLevels; i++) {
        result = treatPetSicknessOneLevel(pet);
        if (result.cured) break;
    }
    const def = result.sickness?.def || getSicknessDef(sickness.type) || sickness.def;
    if (result.cured) {
        pendingMinigameLaunch = null;
        await savePet(pet);
        postTowerDefenseTreatmentControl('treatmentCuredPrompt');
        const keepPlaying = await confirm(`${def?.name || '疾病'}已经治好，24小时内不会再生病。要继续守护训练吗？`, {
            okText: '继续守护',
            cancelText: '退出',
        });
        if (keepPlaying) {
            postTowerDefenseTreatmentControl('treatmentContinue');
            showToast('治疗已完成，守护训练继续。', 'success', 1800);
            return;
        }
        state.lastHomeZoomLevel = 3;
        navigateToView('home');
        return;
    }
    showToast(`${def?.name || '疾病'}病情减轻 ${treatmentLevels} 级，本次登录剩余 ${getEffectiveSicknessSeverity(pet)} 级。`, 'success', 1800);
    if (data.treatmentCheckpoint) return;
    notify();
    pendingMinigameLaunch = null;
    state.lastHomeZoomLevel = 3;
    navigateToView('home');
}

function sicknessTreatmentLevelsFromMinigame(data = {}) {
    const explicit = Number(data.treatmentLevels);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.round(explicit));
    const won = data.completed !== false && data.passed !== false;
    const maxWave = Math.max(1, Number(data.maxWave) || 1);
    const wave = Math.max(0, Number(data.waves ?? data.level ?? data.wave) || 0);
    if (won) return Math.max(1, Math.min(maxWave, wave || maxWave));
    return Math.max(0, Math.min(maxWave, wave - 1));
}

function postTowerDefenseTreatmentControl(type) {
    const frame = document.getElementById('mhMinigameFrame');
    try {
        frame?.contentWindow?.postMessage({ type }, '*');
    } catch (_) {}
}

function handleNav(target, options = {}) {
    navigateToView(target, options);
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
    showToast(t('itemUsedToast', { emoji: item.emoji, name: itemName(item.name) }), 'success', 1000);
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
    showToast(t('itemAddedToast', { emoji: item.emoji, name: itemName(item.name), qty }), 'success');
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
    showToast(t('itemSoldToast', { emoji: item.emoji, name: itemName(item.name), qty, coins: totalGain }), 'success');
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

// ============================================================================
// Agent 命令接口接线（见 js/agentBridge.js / docs/agent plan）
// 把 agent 命令映射到现有应用动作；不暴露 REST 后端，纯前端「页面即 API」。
// ============================================================================
const agentHandlers = {
    // 照顾类：复用中央动作分发器
    handleAction: (actionKey, args) => handleAction(actionKey, args || {}),

    // 对宠物说话：复用 api.js 的 chatWithPet + 记忆摘要
    say: async (args) => {
        const pet = getCurrentPet();
        if (!pet) throw new Error('no current pet');
        const text = String(args?.text || args?.message || '').trim();
        if (!text) throw new Error('say requires args.text');
        const api = await import('./api.js');
        const reply = await api.chatWithPet(pet, text);
        try { say(reply, 4500); } catch (_) {}
        try { api.summarizeAndAppendMemory(pet, text, reply); } catch (_) {}
        return { said: text, reply };
    },

    // 领养 / 孵化：导航到孵化流（由现有 UI 完成余下步骤）
    adopt: async (args) => {
        if (args?.agent) await bindAgentOwnerToCurrentPet(String(args.agent));
        hatchCtx = {};
        setView('hatch');
        return { navigatedTo: 'hatch', agentOwner: args?.agent || null };
    },
    hatch: async () => { hatchCtx = {}; setView('hatch'); return { navigatedTo: 'hatch' }; },

    // 导航
    switchView: async (args) => {
        const target = String(args?.view || args?.target || '').trim();
        if (!target) throw new Error('switchView requires args.view');
        navigateToView(target);
        return { view: target };
    },
    switchRoom: async (args) => {
        const id = String(args?.room || args?.id || '').trim();
        if (!id) throw new Error('switchRoom requires args.room');
        state.currentRoom = id;
        const p = getCurrentPet(); if (p) { p.activeRoom = id; savePetDebounced(p); }
        render();
        return { room: id };
    },

    // 商店
    openShop: async () => { navigateToView('shop'); return { view: 'shop' }; },
    buy: async (args) => {
        const itemId = String(args?.itemId || args?.id || '').trim();
        if (!itemId) throw new Error('buy requires args.itemId');
        const item = getShopItemById(itemId);
        if (!item) throw new Error('unknown shop item: ' + itemId);
        await handleBuy(item);
        return { bought: itemId };
    },

    // 分享 / 物料：跳到明信片视图（可截图 / 复制链接）
    share: async () => { navigateToView('postcard'); return { view: 'postcard' }; },
};

// 把 agentOwner（双主人）写到当前宠物。
async function bindAgentOwnerToCurrentPet(agentId, platform = 'openclaw') {
    const pet = getCurrentPet();
    if (!pet) return null;
    pet.agentOwner = { agentId: String(agentId), platform, boundAt: Date.now() };
    savePetDebounced(pet);
    notify();
    return pet.agentOwner;
}

// 处理 agent 深链：?agent= / ?adopt=1 / ?cmd=<urlencoded>
async function applyAgentDeepLinks() {
    let params;
    try { params = getAgentParams(); } catch (_) { return; }
    if (!params) return;
    if (params.agent && window.MagicHaqiAgent?.setActor) {
        window.MagicHaqiAgent.setActor(params.agent);
        await bindAgentOwnerToCurrentPet(params.agent);
    }
    if (params.adopt) {
        try { await agentHandlers.adopt({ agent: params.agent }); } catch (e) { console.warn('agent adopt 深链失败', e); }
    }
    if (params.cmd && window.MagicHaqiAgent?.exec) {
        try { await window.MagicHaqiAgent.exec(decodeURIComponent(params.cmd)); }
        catch (e) { console.warn('agent cmd 深链失败', e); }
    }
}

// 初始化 agent 桥（注入隐藏节点 + window.MagicHaqiAgent + 状态镜像订阅）
try {
    const agentInit = getAgentParams();
    initAgentBridge({ handlers: agentHandlers, actor: agentInit?.agent || '', subscribe });
} catch (e) {
    console.warn('agentBridge 初始化失败', e);
}

bootstrap().then(() => {
    // 启动完成后处理 agent 深链（此时已登录 / 已有宠物上下文）
    applyAgentDeepLinks().catch(e => console.warn('agent 深链处理失败', e));
}).catch(err => {
    console.error(err);
    showToast('启动失败：' + (err?.message || err), 'error', 5000);
    finishBootstrap();
    setView('login');
});
