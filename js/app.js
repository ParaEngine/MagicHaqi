// 主程序：SDK 启动 + 路由 + 全局事件
import { $, showToast, confirm, clamp, prompt, escapeHtml, isImageIconValue, acquireActiveModal, releaseActiveModal } from './utils.js';
import { canPlaceItemInArea, CONFIG, getItemZOrder, getShopItemById, findLargestHouseAcrossLayouts, getStageName, getForcedView, getAgentParams, zoomLevelIdToIndex, DEFAULT_PLANET_ID, getPlanetOnboardingConfig } from './config.js';
import { state, notify, subscribe, setView, setCurrentPet, getCurrentPet, addBiofuel, addCoins, getMineralExplorationBridge, setMineralExplorationBridge, isPetDispatching } from './state.js';
import {
    loadUserProfile, saveUserProfile, saveUserProfileDebounced,
    loadAllPets, loadPet, loadPets, deletePet, setCurrentPetPersisted,
    saveLayout, addToInventory, removeFromInventory, savePetDebounced,
    getLayout, ensurePetData, savePet, clearStoredData, saveDecorDataNow, saveInventoryDebounced, loadStoryProgress, saveStoryProgress,
    isOnboardingCompleted, saveOnboardingProgress, markOnboardingCompleted,
    loadWorkBuddyGameDraft, savePetGame,
} from './storage.js';
import { applyDecay, applyStage, clampEnergyToMax, defaultPermanentTrauma, defaultStats, eggStats, getActiveSickness, getEffectiveSicknessSeverity, getSicknessDef, markPetCared, maybeRollDailySickness, sicknessName, tickOffline, startTickLoop, stopTickLoop, treatPetSicknessOneLevel } from './petTick.js';
import { renderLogin } from './view_login.js';
// view_petList.js (~53KB) is lazy-loaded; see loadPetListView() below.
import { renderHatch } from './view_hatch.js';
// view_home.js (+ the 4 level modules ~600KB) is lazy-loaded so it stays out of
// the startup module graph; see loadHomeView()/renderHomeRoute below.
import { renderShop } from './view_shop.js';
import { renderInventory } from './view_inventory.js';
import { renderProfile } from './view_profile.js';
import { renderHaqiExplorationArchive } from './view_haqi_exploration_archive.js';
import { getPendingExpeditionPetIds, recordMissingExpeditionPetIds } from './expedition_route_core.js';
import { showRewardOutcomeModal } from './view_reward_outcome.js';
import { showRewardShareCard } from './view_reward_share_card.js';
import { createRewardOutcomeReturnTracker, REWARD_OUTCOME_TARGET_VIEWS } from './reward_outcome_core.js';
import { renderHelp } from './view_help.js';
import { normalizeTerrainFieldSlotId, renderTerrainFields, resolveTerrainFieldTypeId } from './view_terrain_fields.js';
import { applySettledOfficialPlanetFromProfile, applyTemporaryHomePlanetFromUrl, renderStarSettlements } from './view_star_settlements.js';
import { hasPostcardParams } from './view_postcard.js';
import { randomDna, decodeDna, dnaRarity, dnaToName, biasDnaForFieldId } from './dna.js';
import { hasGuestSession, setGuestSessionActive } from './guest_session.js';
import './petQuality.js';
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
    canVipRecallPet,
    markPetRecalled,
    localPlanetPets,
    markPetReleased,
    markPetRemoteExiled,
    selectablePets,
} from './petLifecycle.js';
import SoundManager from './soundManager.js';
import { isMiniProgramWebView } from './wxShare.js';
import { initAgentBridge } from './agentBridge.js';
import { getDailyExpeditionRoster, markDailyExpeditionExplored, sanitizeExpeditionPet } from './expedition.js';
import { calculateDerivedStats, upgradePetData } from './pet_stats_core.js';
import { canBreed, generateChildEmbryo, IV_KEYS, previewChildPotential } from './pet_breeding_core.js';
import { calculateResearchReleaseRewards, getResearchReleaseCandidates } from './pet_research_core.js';
import { calculateExpeditionReadiness } from './expedition_buff.js';
import { getSpeciesExpeditionSpecialty } from './pet_species_growth_core.js';
import { processExpeditionResult } from './expedition_settlement.js';
import { createSupportRoutePlan } from './expedition_tactical_core.js';
import {
    FRIENDLY_GUARD_DOJO,
    getFriendlyGuardDojoFloorRoster,
    getFriendlyGuardDojoStatus,
    recordSuccessfulExpeditionForDojo,
    resolveFriendlyGuardDojoFloor,
} from './dojo_core.js';
import { calculateAdaptiveThreat, calculateExpeditionCombatPower } from './expedition_difficulty_core.js';
import { chooseExpeditionInvestigationBranch, createExpeditionConfrontationMission, createExpeditionInvestigationMission, getExpeditionInvestigationProgress, recordExpeditionConfrontationOutcome, recordExpeditionInvestigationOutcome } from './expedition_investigation_core.js';
import { chooseSectorSideCase, createSectorEventFinaleMission, discoverSectorSideCase, getSectorEventAvailability, getSectorEventProgress, prepareSectorEventFinale, resolveSectorEvent, startSectorEvent, synchronizeSectorEvent } from './expedition_sector_event_core.js';
import { hasMineralBridgeSyncChanges, mergeMineralBridgeSync, settleMineralRoutePreparation } from './mineral_host_core.js';
import { calculateMineralPetSupport } from './mineral_pet_support_core.js';
import { mergeCapturedPets, recordExpeditionHistory } from './expedition_history.js';
import { claimDailyHomeTreasureEffect, formatHomeTreasureReward, getHomeTreasureDailyReward, getHomeTreasureFacility, getHomeTreasureGrowth, getHomeTreasureInventoryId, getHomeTreasures, HOME_TREASURE_META, isHomeTreasureId, isHomeTreasurePlaced } from './home_treasures.js';
import { getHaqiExpeditionSettlement, HAQI_EXPEDITION_PLUGIN, isHaqiExpeditionEnabled } from './haqi_expedition_plugin.js';
import { getHaqiWeeklyProgress } from './haqi_weekly_progress.js';
import { createRetryableModuleLoader } from './retryable_module_loader.js';
import { getMineralExplorationConfig, isMineralExplorationEnabled, loadPlanetFeatures } from './planet_features.js';
import { checkOnboardingTask as advanceOnboardingTask, claimOnboardingReward, completeOnboardingGuideStep, dismissOnboardingHint, ensureOnboardingState, getActiveOnboardingGuideStep, getActiveOnboardingTask, getOnboardingProgress, getOnboardingTasks, markOnboardingIntroSeen, restoreOnboardingHint, shouldShowOnboardingPanel } from './onboarding.js';
import { configureFirstDayFunnelReporter, configureFirstDayFunnelScope, createAnalyticsSessionId, FIRST_DAY_EVENTS, exportFirstDayFunnel, getAnalyticsVisitorId, getFirstDayEvents, recordFirstDayEvent, summarizeFirstDayFunnel } from './first_day_funnel.js';
import { configureCoinLedgerScope, exportCoinLedger, getCoinLedger, summarizeCoinLedger } from './coin_ledger.js';
import { completeReturnRouteStep, getReturnRouteProgress, RETURN_ROUTE_REWARD_COINS, RETURN_ROUTE_STEPS, scheduleReturnRoute } from './return_route.js';
import { completeNpcCommission } from './minigame_daily.js';
import { findHelloLearnerSessionCompletion, settleHelloLearnerReward } from './hello_learner_rewards.js';
import { getNpcRelationshipBonuses, registerCollectibleAcquisition, rollCollectibleDrop } from './npc_gifts.js';
import { getCollectibleSeriesOutcomes, getCollectibleSeriesProgress } from './reward_outcome_core.js';
import { resetHomeWelcomeForLogin } from './home_welcome.js';
// Side-effect import: 订阅 state 并接管所有 [data-mh-pet] 占位符的渲染 + 动画
import { canWakePet, daySleepRejectText, eatFood, hatchPetFromBoarding, isPetInteractionBlocked, isPetSleeping, petArtHtml, preloadPetAssets, say, scanAndMount, setAnim, shouldRejectDaySleep, sleepingInteractionText, startPetSleep, wakePet, wakePetForPlay } from './pet.js';

const sdkCdnUrl = 'https://cdn.keepwork.com/sdk/keepworkSDK.iife.js?v=c1ff58c09d76';
const LOCAL_EXPEDITION_RESET_INTENT_KEY = 'mh_reset_today_expeditions';
let firstDaySessionRecorded = false;
const analyticsSessionId = createAnalyticsSessionId();
const analyticsVisitorId = getAnalyticsVisitorId();
let pendingInventoryTreasureFocus = '';
let pendingHelloLearnerSession = null;
let helloLearnerFocusTimer = null;
const rewardOutcomeReturnTracker = createRewardOutcomeReturnTracker();

const localDataScope = () => (
    state.user?.id ? `account_${state.user.id}` : (state.offlineMode ? 'guest' : 'anonymous')
);
configureFirstDayFunnelScope(localDataScope);
configureCoinLedgerScope(localDataScope);

window.MagicHaqiFunnel = Object.freeze({
    getEvents: () => getFirstDayEvents(),
    getSummary: () => summarizeFirstDayFunnel(),
    exportJson: () => exportFirstDayFunnel(),
});

window.MagicHaqiEconomy = Object.freeze({
    getTransactions: () => getCoinLedger(),
    getSummary: () => summarizeCoinLedger(),
    exportJson: () => exportCoinLedger(),
});

function firstDayContext(extra = {}) {
    const viewportWidth = window.innerWidth;
    return {
        sessionId: analyticsSessionId,
        visitorId: analyticsVisitorId,
        planetId: getActivePlanetId(),
        accessMode: state.user ? 'account' : (state.offlineMode ? 'guest' : 'anonymous'),
        viewport: viewportWidth <= 767 ? 'mobile' : (viewportWidth <= 1180 ? 'pad' : 'desktop'),
        ...extra,
    };
}

function recordProductEvent(name, properties = {}, options = {}) {
    return recordFirstDayEvent(name, firstDayContext(properties), options);
}

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

function importRuntimeModuleWithTimeout(src, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error(`Module import timed out after ${timeoutMs}ms: ${src}`)), timeoutMs);
        importRuntimeModule(src).then(resolve, reject).finally(() => clearTimeout(timeoutId));
    });
}

async function ensureKeepworkSDK() {
    if (window.KeepworkSDK) return;
    // 在 SDK 入口执行前预设默认实例参数：index.ts 会用它构造 window.keepwork，
    // 使「自动创建的默认实例」使用微信静默授权，并带 autoReloadAfterRedirectLogin:false，
    // 避免微信回跳后被迫整页刷新（登录页闪现 → 刷新 → 登录后页面的双跳）。
    window.KEEPWORK_DEFAULT_OPTIONS = {
        timeout: 30000,
        autoReloadAfterRedirectLogin: false,
        wxAuth: { scope: 'snsapi_base' },
    };
    const host = window.location.hostname;
    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const localSdkRequested = window.__useLocalKeepworkSDK === true
        || new URL(window.location.href).searchParams.get('local_sdk') === '1';
    const useLocalIndex = isLocalHost && localSdkRequested && !window.location.pathname.includes('/dist/');
    try {
        if (useLocalIndex) {
            await importRuntimeModuleWithTimeout('http://127.0.0.1:5001/index.ts', 2000);
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
const HAQI_MINERAL_CHANNEL = 'magichaqi-haqi-mineral';
const HAQI_MINERAL_VERSION = 1;
let haqiMineralFrame = null;
const HAQI_MINERAL_PREPARATION_COST = Object.freeze({ manaDust: 2, attackCore: 1 });
const HAQI_MINERAL_HOST_REWARDS = Object.freeze({
    emergencyBeacon: { group: 'tacticalItems', limit: 3 },
    deflectionShield: { group: 'tacticalItems', limit: 3 },
    ssrMutation: { group: 'breedingCatalysts', limit: 9 },
    urAttributeLock: { group: 'breedingCatalysts', limit: 9 },
});
const HAQI_MINERAL_WORKSHOP_LIMITS = Object.freeze({ refine: 6, sell: 30 });
const RESEARCH_RELEASE_MATERIAL_NAMES = Object.freeze({
    manaDust: '魔力尘',
    attackCore: '攻击晶核',
});

function mineralWorkshopDay(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

function getActiveMineralBridge() {
    return getMineralExplorationBridge(getActivePlanetId());
}

function setActiveMineralBridge(nextBridge) {
    return setMineralExplorationBridge(getActivePlanetId(), nextBridge);
}

// 主面板
const app = document.getElementById('app');
let onboardingNavigationInFlight = false;
let onboardingRewardCelebrationTimer = null;
let returnRouteFeedbackTimer = null;
let recentReturnRouteStepId = '';
let onboardingDragState = null;
let onboardingExpeditionExitTarget = null;
let onboardingStepClickObserverBound = false;

function bindOnboardingStepClickObserver() {
    if (onboardingStepClickObserverBound) return;
    onboardingStepClickObserverBound = true;
    document.addEventListener('click', (event) => {
        const planetId = getActivePlanetId();
        const task = getActiveOnboardingTask(state.settings, planetId);
        const step = getActiveOnboardingGuideStep(state.settings, planetId);
        if (!task || !step?.selector || !event.target.closest?.(step.selector)) return;
        const result = completeOnboardingGuideStep(state.settings, task.id, step.id, planetId);
        if (!result.changed) return;
        void saveUserProfile();
        setTimeout(() => renderOnboardingPanel(), 0);
    }, true);
}

function fitOnboardingPanelToField(panel, fieldStage) {
    if (panel.hidden || !fieldStage?.isConnected) return;
    const card = panel.querySelector('.mh-onboarding-card');
    if (!card) return;
    const margin = 8;
    const stageWidth = fieldStage.clientWidth;
    const stageHeight = fieldStage.clientHeight;
    const isPortraitCompact = card.classList.contains('mh-onboarding-intro')
        && window.matchMedia('(max-width: 1024px) and (orientation: portrait)').matches;
    const stageRect = fieldStage.getBoundingClientRect();
    const shortcutsRect = isPortraitCompact
        ? fieldStage.querySelector('.home-adventure-shortcuts')?.getBoundingClientRect()
        : null;
    const availableTop = shortcutsRect
        ? Math.min(stageHeight - margin, Math.max(margin, shortcutsRect.bottom - stageRect.top + margin))
        : margin;
    panel.style.transform = 'none';
    panel.style.transformOrigin = 'top left';
    panel.style.maxHeight = 'none';
    panel.style.left = `${margin}px`;
    panel.style.top = `${availableTop}px`;
    panel.style.right = 'auto';
    const naturalWidth = panel.offsetWidth;
    const naturalHeight = Math.max(panel.offsetHeight, card.scrollHeight);
    const maxScale = card.classList.contains('mh-onboarding-intro') ? 0.84 : 1;
    const scale = Math.min(
        maxScale,
        Math.max(0, stageWidth - margin * 2) / naturalWidth,
        Math.max(0, stageHeight - availableTop - margin) / naturalHeight,
    );
    panel.style.left = isPortraitCompact
        ? `${Math.max(margin, (stageWidth - naturalWidth * scale) / 2)}px`
        : `${stageWidth - margin - naturalWidth * scale}px`;
    panel.style.transform = `scale(${scale})`;
    panel.dataset.fieldFitScale = scale.toFixed(4);
}

function ensureOnboardingPanelRoot() {
    let panel = document.getElementById('mhOnboardingPanel');
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'mhOnboardingPanel';
    panel.className = 'mh-onboarding-panel';
    panel.setAttribute('aria-live', 'polite');
    panel.addEventListener('pointerdown', (event) => {
        const dragHandle = event.target.closest('.mh-onboarding-head, .mh-onboarding-drawer');
        if (!dragHandle || (event.target.closest('button') && !event.target.closest('.mh-onboarding-drawer'))) return;
        const rect = panel.getBoundingClientRect();
        onboardingDragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false, drawer: dragHandle.classList.contains('mh-onboarding-drawer') };
        panel.setPointerCapture(event.pointerId);
    });
    panel.addEventListener('pointermove', (event) => {
        if (!onboardingDragState || event.pointerId !== onboardingDragState.pointerId) return;
        const deltaX = event.clientX - onboardingDragState.startX;
        const deltaY = event.clientY - onboardingDragState.startY;
        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) onboardingDragState.moved = true;
        if (!onboardingDragState.moved) return;
        const rect = panel.getBoundingClientRect();
        const fieldStage = panel.closest('#mhStage.zoom-field');
        const stageRect = fieldStage?.getBoundingClientRect();
        const clientLeft = Math.min(Math.max((stageRect?.left || 0) + 8, onboardingDragState.left + deltaX), (stageRect?.right || window.innerWidth) - rect.width - 8);
        const clientTop = Math.min(Math.max((stageRect?.top || 0) + 8, onboardingDragState.top + deltaY), (stageRect?.bottom || window.innerHeight) - rect.height - 8);
        panel.style.left = `${clientLeft - (stageRect?.left || 0)}px`;
        panel.style.top = `${clientTop - (stageRect?.top || 0)}px`;
        panel.style.right = 'auto';
    });
    panel.addEventListener('pointerup', (event) => {
        if (!onboardingDragState || event.pointerId !== onboardingDragState.pointerId) return;
        const moved = onboardingDragState.moved;
        const drawer = onboardingDragState.drawer;
        onboardingDragState = null;
        if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);
        if (moved) {
            panel.dataset.dragged = 'true';
            setTimeout(() => delete panel.dataset.dragged, 0);
        } else if (drawer) {
            panel.querySelector('.mh-onboarding-drawer')?.click();
        }
    });
    panel.addEventListener('pointercancel', () => { onboardingDragState = null; });
    window.addEventListener('resize', () => {
        const fieldStage = app.querySelector('#mhStage.zoom-field');
        if (fieldStage) requestAnimationFrame(() => fitOnboardingPanelToField(panel, fieldStage));
    });
    document.body.appendChild(panel);
    bindOnboardingStepClickObserver();
    return panel;
}

function clearOnboardingHighlight() {
    document.querySelectorAll('.guide-pulse-highlight').forEach((node) => node.classList.remove('guide-pulse-highlight'));
}

function applyOnboardingHighlight(task, step = null) {
    clearOnboardingHighlight();
    const selector = step?.selector || task?.highlightSelector;
    if (!selector) return;
    app.querySelector(selector)?.classList.add('guide-pulse-highlight');
}

function collapseOnboardingForAction(taskId, planetId) {
    dismissOnboardingHint(state.settings, taskId, planetId);
    renderOnboardingPanel();
}

function closeOnboardingConflictingPetModals() {
    document.querySelectorAll('.mh-pet-stats-mask, .mh-album-mask, .mh-rare-modal-mask')
        .forEach((modal) => modal.remove());
}

async function activateOnboardingStep(task, step, planetId) {
    closeOnboardingConflictingPetModals();
    const targetView = step?.targetView || task.targetView;
    if (targetView && state.currentView !== targetView) await navigateToView(targetView);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (step?.triggerSelector) {
        let target = app.querySelector(step.triggerSelector);
        if (!target && targetView === 'home' && step.triggerSelector.includes('#mhFieldDecorBtn')) {
            state.zoomLevel = zoomLevelIdToIndex('field');
            state.lastHomeZoomLevel = state.zoomLevel;
            setView('home');
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            target = app.querySelector(step.triggerSelector);
        }
        if (!target) return false;
        target.click();
        return true;
    }
    if (step?.completeOnNavigate) completeOnboardingGuideStep(state.settings, task.id, step.id, planetId);
    return true;
}

function celebrateOnboardingReward(task) {
    const coins = Number(task?.reward?.coins) || 0;
    if (!coins) return;
    document.querySelector('.mh-reward-celebration')?.remove();
    if (onboardingRewardCelebrationTimer) clearTimeout(onboardingRewardCelebrationTimer);
    const celebration = document.createElement('div');
    celebration.className = 'mh-reward-celebration';
    celebration.setAttribute('role', 'status');
    celebration.setAttribute('aria-live', 'assertive');
    celebration.innerHTML = '<div class="mh-reward-celebration-card"><i class="mh-reward-spark"></i><i class="mh-reward-spark"></i><i class="mh-reward-spark"></i><i class="mh-reward-spark"></i><strong>任务完成！</strong><span></span></div>';
    celebration.querySelector('span').textContent = `+${coins} 金币`;
    document.body.appendChild(celebration);
    soundManager.playPointReward();
    onboardingRewardCelebrationTimer = setTimeout(() => celebration.remove(), 1800);
}

function showReturnRouteStepFeedback(step, completed, total) {
    document.querySelector('.mh-return-route-feedback')?.remove();
    if (returnRouteFeedbackTimer) clearTimeout(returnRouteFeedbackTimer);
    const feedback = document.createElement('div');
    feedback.className = 'mh-return-route-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.innerHTML = '<span aria-hidden="true">✓</span><div><strong></strong><small></small></div>';
    feedback.querySelector('strong').textContent = step?.title || '今日目标完成';
    feedback.querySelector('small').textContent = `今日航线 ${completed} / ${total}`;
    document.body.appendChild(feedback);
    soundManager.playPointReward();
    returnRouteFeedbackTimer = setTimeout(() => feedback.remove(), 1600);
}

function renderHaqiOnboardingIntro(panel, onboarding, task, planetId) {
    panel.classList.remove('is-drawer');
    panel.innerHTML = `<section class="mh-onboarding-card mh-onboarding-intro" aria-label="哈奇星球新手旅程">
        <div class="mh-onboarding-intro-copy">
            <span class="mh-onboarding-kicker">哈奇星球 · 新手航线</span>
            <h2>和伙伴完成第一次星际远征</h2>
            <p>从相遇、安家到启航，5 个目标约 15 分钟。每一步都有明确奖励，进度会自动保存。</p>
            <div class="mh-onboarding-intro-summary"><span>5 个目标</span><span>约 15 分钟</span><span>共 720 金币</span></div>
            <div class="mh-onboarding-intro-actions"><button class="mh-onboarding-later" type="button">稍后</button><button class="mh-onboarding-start" type="button">开始旅程</button></div>
        </div>
    </section>`;
    const finishIntro = (dismiss = false) => {
        markOnboardingIntroSeen(state.settings, planetId);
        if (dismiss) dismissOnboardingHint(state.settings, task.id, planetId);
        recordFirstDayEvent(
            dismiss ? FIRST_DAY_EVENTS.ONBOARDING_DEFERRED : FIRST_DAY_EVENTS.ONBOARDING_STARTED,
            firstDayContext({ taskId: task.id }),
            { dedupeKey: `${planetId}:onboarding:${dismiss ? 'deferred' : 'started'}` },
        );
        void saveUserProfile();
        renderOnboardingPanel();
    };
    panel.querySelector('.mh-onboarding-start').onclick = () => finishIntro(false);
    panel.querySelector('.mh-onboarding-later').onclick = () => finishIntro(true);
}

function renderHaqiOnboardingComplete(panel, onboarding, progress, planetId) {
    const returnProgress = getReturnRouteProgress(state.settings, planetId);
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const latestExpedition = (settlement.history || []).find(entry => entry?.completed === true) || null;
    const weeklyProgress = getHaqiWeeklyProgress({ history: settlement.history, bridge: getActiveMineralBridge() });
    const nextWeeklyGoal = weeklyProgress.goals.find(goal => !goal.complete) || null;
    const weeklySummary = `<div class="mh-return-route-weekly"><span>本周收集 ${weeklyProgress.completed}/${weeklyProgress.total}</span><small>${escapeHtml(nextWeeklyGoal ? `${nextWeeklyGoal.label} · ${nextWeeklyGoal.current}/${nextWeeklyGoal.target}` : '本周收藏目标已全部完成')}</small></div>`;
    const completionHintId = returnProgress.available ? `haqi-return-route:${returnProgress.dayKey}` : 'haqi-onboarding-complete';
    const compactOutsideHome = state.currentView !== 'home';
    if (onboarding.dismissedHints?.[completionHintId] || compactOutsideHome) {
        panel.classList.add('is-drawer');
        panel.innerHTML = `<button class="mh-onboarding-drawer" type="button" aria-label="打开每日航线" title="打开每日航线"><span class="mh-onboarding-drawer-mark">${returnProgress.available ? '今日' : '明日'}</span><span class="mh-onboarding-drawer-progress">${returnProgress.available ? `${returnProgress.completed}/${returnProgress.total}` : `${progress.completed}/${progress.total}`}</span></button>`;
        panel.querySelector('.mh-onboarding-drawer').onclick = () => {
            if (compactOutsideHome) {
                navigateToView('home');
                return;
            }
            restoreOnboardingHint(state.settings, completionHintId, planetId);
            void saveUserProfile();
            renderOnboardingPanel();
        };
        return;
    }
    panel.classList.remove('is-drawer');
    const routeSteps = getOnboardingTasks(planetId)
        .map(item => `<span class="is-done" title="${escapeHtml(item.title)}"><i>${escapeHtml(item.icon || '•')}</i></span>`)
        .join('');
    const dailySteps = RETURN_ROUTE_STEPS.map(step => {
        const done = returnProgress.completedStepIds.includes(step.id);
        const justCompleted = done && recentReturnRouteStepId === step.id;
        return `<button type="button" data-return-step="${step.id}" data-complete-view="${step.targetView}"${done ? ` class="is-done${justCompleted ? ' is-just-completed' : ''}" disabled` : ''}><span>${done ? '✓' : '○'}</span>${escapeHtml(step.title)}</button>`;
    }).join('');
    const dailyBody = returnProgress.available
        ? `<div class="mh-onboarding-time">今日航线 · 约 5 至 8 分钟</div><h2>${returnProgress.finished ? '今日航线已完成' : '和伙伴完成三个日常目标'}</h2><p>${returnProgress.finished ? `明天会刷新新的航线，今日已获得 ${RETURN_ROUTE_REWARD_COINS} 金币。` : '三个目标可按任意顺序完成，进度会自动保存。'}</p><div class="mh-return-route-steps">${dailySteps}</div>${weeklySummary}<div class="mh-onboarding-actions"><span class="mh-onboarding-reward">${returnProgress.finished ? `已领取 +${RETURN_ROUTE_REWARD_COINS} 金币` : `完成奖励 +${RETURN_ROUTE_REWARD_COINS} 金币`}</span><span class="mh-onboarding-waiting">${returnProgress.completed} / ${returnProgress.total}</span></div>`
        : `<div class="mh-onboarding-time">第一次旅程完成</div><h2>你和伙伴已经在哈奇小镇安家</h2><div class="mh-first-day-summary" aria-label="第一次旅程成果"><span>🐾 认识伙伴</span><span>🏠 建立据点</span><span>🚀 完成远征</span><span>🏆 带回成果</span></div><p>${latestExpedition ? `${escapeHtml(latestExpedition.petName || '伙伴')} 已从 ${escapeHtml(latestExpedition.expeditionName || latestExpedition.expeditionBiome || '星际远征')} 归航，战利品已存入营地。` : '你们的第一次远征成果已经归档，战利品已存入营地。'}</p><div class="mh-onboarding-complete-links"><button type="button" data-complete-action="history">查看远征记录</button><button type="button" data-complete-action="rewards">查看材料与珍宝</button></div><div class="mh-next-day-callout"><strong>明日航线将在次日解锁</strong><span>回来照顾伙伴、打理家园，再从每日星图启航 · 约 5 至 8 分钟</span></div>`;
    panel.innerHTML = `<section class="mh-onboarding-card mh-onboarding-complete" aria-label="新手航线完成后的目标">
        <header class="mh-onboarding-head"><span class="mh-onboarding-mark" aria-hidden="true">${returnProgress.finished ? '✓' : '☀'}</span><strong class="mh-onboarding-title">${returnProgress.available ? '每日回访航线' : '新手航线完成'}</strong><span class="mh-onboarding-progress">${returnProgress.available ? `${returnProgress.completed} / ${returnProgress.total}` : `${progress.completed} / ${progress.total}`}</span><button class="mh-onboarding-dismiss" type="button" aria-label="暂时收起">×</button></header>
        <div class="mh-onboarding-route" aria-label="新手航线已全部完成">${routeSteps}</div>
        <div class="mh-onboarding-body">${dailyBody}</div>
    </section>`;
    if (returnProgress.available) {
        recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_VIEWED, firstDayContext({ dayKey: returnProgress.dayKey }), { dedupeKey: `${planetId}:return-route-viewed:${returnProgress.dayKey}` });
    }
    panel.querySelector('.mh-onboarding-dismiss').onclick = () => {
        dismissOnboardingHint(state.settings, completionHintId, planetId);
        void saveUserProfile();
        renderOnboardingPanel();
    };
    panel.querySelectorAll('[data-complete-view]').forEach((button) => {
        button.onclick = () => {
            closeOnboardingConflictingPetModals();
            navigateToView(button.dataset.completeView);
        };
    });
    panel.querySelector('[data-complete-action="history"]')?.addEventListener('click', () => {
        navigateToView('expeditionMap');
    });
    panel.querySelector('[data-complete-action="rewards"]')?.addEventListener('click', () => {
        pendingInventoryTreasureFocus = latestExpedition?.homeTreasureId || '';
        navigateToView('inventory');
    });
}

function completeDailyReturnRouteStep(stepId) {
    if (getActivePlanetId() !== 'haqi') return false;
    const result = completeReturnRouteStep(state.settings, stepId, 'haqi');
    if (!result.changed) return false;
    if (result.progress.completed === 1) {
        recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_STARTED, firstDayContext({
            dayKey: result.progress.dayKey,
            firstStepId: stepId,
        }), { dedupeKey: `haqi:return-route-started:${result.progress.dayKey}` });
    }
    recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_STEP_COMPLETED, firstDayContext({
        dayKey: result.progress.dayKey,
        stepId,
        completedCount: result.progress.completed,
    }), { dedupeKey: `haqi:return-route:${result.progress.dayKey}:${stepId}` });
    recentReturnRouteStepId = stepId;
    if (result.rewardClaimed) {
        addCoins(RETURN_ROUTE_REWARD_COINS, { source: 'daily-return-route', category: 'retention', planetId: 'haqi' });
        recordFirstDayEvent(FIRST_DAY_EVENTS.RETURN_ROUTE_COMPLETED, firstDayContext({
            dayKey: result.progress.dayKey,
            rewardCoins: RETURN_ROUTE_REWARD_COINS,
        }), { dedupeKey: `haqi:return-route-completed:${result.progress.dayKey}` });
        showToast(`今日航线完成：获得 ${RETURN_ROUTE_REWARD_COINS} 金币`, 'success', 2600);
        celebrateOnboardingReward({ reward: { coins: RETURN_ROUTE_REWARD_COINS } });
    } else {
        showReturnRouteStepFeedback(result.step, result.progress.completed, result.progress.total);
    }
    void saveUserProfile();
    notify();
    renderOnboardingPanel();
    setTimeout(() => {
        if (recentReturnRouteStepId !== stepId) return;
        recentReturnRouteStepId = '';
        document.querySelector(`[data-return-step="${stepId}"]`)?.classList.remove('is-just-completed');
    }, 1200);
    return true;
}

function renderOnboardingPanel() {
    const panel = ensureOnboardingPanelRoot();
    const fieldStage = app.querySelector('#mhStage.zoom-field');
    if (!shouldShowOnboardingPanel(state.currentView) || !fieldStage) {
        panel.hidden = true;
        panel.classList.remove('is-drawer');
        clearOnboardingHighlight();
        return;
    }
    if (panel.parentElement !== fieldStage) fieldStage.appendChild(panel);
    const planetId = getActivePlanetId();
    const onboarding = ensureOnboardingState(state.settings, planetId);
    const task = getActiveOnboardingTask(state.settings, planetId);
    const progress = getOnboardingProgress(state.settings, planetId);
    if (!task) {
        clearOnboardingHighlight();
        if (planetId === 'haqi' && progress.total > 0 && progress.completed >= progress.total) {
            panel.hidden = false;
            renderHaqiOnboardingComplete(panel, onboarding, progress, planetId);
            return;
        }
        panel.hidden = true;
        panel.classList.remove('is-drawer');
        return;
    }
    panel.hidden = false;
    requestAnimationFrame(() => fitOnboardingPanelToField(panel, fieldStage));
    if (planetId === 'haqi' && !onboarding.introSeenAt && progress.completed === 0) {
        clearOnboardingHighlight();
        renderHaqiOnboardingIntro(panel, onboarding, task, planetId);
        return;
    }
    if (onboarding.dismissedHints?.[task.id]) {
        panel.classList.add('is-drawer');
        clearOnboardingHighlight();
        panel.innerHTML = `<button class="mh-onboarding-drawer" type="button" aria-label="打开新手任务抽屉" title="打开新手任务抽屉"><span class="mh-onboarding-drawer-mark">任务</span><span class="mh-onboarding-drawer-progress">${progress.completed}/${progress.total}</span><span class="mh-onboarding-drawer-reward">+${task.reward?.coins || 0}</span></button>`;
        panel.querySelector('.mh-onboarding-drawer').onclick = () => {
            restoreOnboardingHint(state.settings, task.id, planetId);
            void saveUserProfile();
            renderOnboardingPanel();
        };
        return;
    }
    panel.classList.remove('is-drawer');
    const tasks = getOnboardingTasks(planetId);
    const activeIndex = Math.max(0, tasks.findIndex(item => item.id === task.id));
    const guideStep = getActiveOnboardingGuideStep(state.settings, planetId);
    const guideSteps = task.guideSteps || [];
    const guideStepIndex = Math.max(0, guideSteps.findIndex(item => item.id === guideStep?.id));
    const remainingMinutes = tasks.slice(activeIndex).reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
    const routeSteps = tasks.map((item, index) => `<span class="${index < progress.completed ? 'is-done' : index === activeIndex ? 'is-active' : ''}" title="${escapeHtml(item.title)}"><i>${escapeHtml(item.icon || '•')}</i></span>`).join('');
    panel.innerHTML = `<section class="mh-onboarding-card" aria-label="新手目标">
        <header class="mh-onboarding-head"><span class="mh-onboarding-mark" aria-hidden="true">${escapeHtml(task.icon || '★')}</span><strong class="mh-onboarding-title">${escapeHtml(task.chapter || '新手目标')}</strong><span class="mh-onboarding-progress">${progress.completed + 1} / ${progress.total}</span><button class="mh-onboarding-dismiss" type="button" aria-label="暂时收起">×</button></header>
        <div class="mh-onboarding-route" aria-label="新手航线进度">${routeSteps}</div>
        <div class="mh-onboarding-body"><div class="mh-onboarding-time">本步约 ${Number(task.minutes) || 1} 分钟 · 剩余约 ${remainingMinutes} 分钟</div><h2>${escapeHtml(task.title)}</h2>${guideStep ? `<div class="mh-onboarding-instruction"><span>${guideStepIndex + 1}</span><div><small>当前操作 · ${guideStepIndex + 1}/${guideSteps.length}</small><strong>${escapeHtml(guideStep.text)}</strong></div></div>` : `<p>${escapeHtml(task.description)}</p>`}<div class="mh-onboarding-actions"><span class="mh-onboarding-reward">+${task.reward?.coins || 0} 金币</span>${guideStep?.targetView ? `<button class="mh-onboarding-go" type="button">${escapeHtml(guideStep.actionLabel || task.actionLabel || '带我去')} <span aria-hidden="true">›</span></button>` : '<span class="mh-onboarding-waiting">完成上方操作后继续</span>'}</div></div>
    </section>`;
    panel.querySelector('.mh-onboarding-dismiss').onclick = () => {
        dismissOnboardingHint(state.settings, task.id, planetId);
        void saveUserProfile();
        renderOnboardingPanel();
    };
    const guideButton = panel.querySelector('.mh-onboarding-go');
    if (guideButton) guideButton.onclick = async (event) => {
        if (onboardingNavigationInFlight) return;
        if (state.currentView === 'minigames' && pendingMinigameLaunch?.mode === 'expedition') {
            const leaveExpedition = await confirm('正在进行星图远征。现在离开会丢失本局全部进度，确定要离开并前往新手任务吗？', {
                okText: '放弃并前往',
                cancelText: '继续当前远征',
            });
            if (!leaveExpedition) return;
            const frame = document.getElementById('mhMinigameFrame');
            if (!frame?.contentWindow) return;
            onboardingNavigationInFlight = true;
            event.currentTarget.disabled = true;
            onboardingExpeditionExitTarget = task.targetView || null;
            frame.contentWindow.postMessage({ type: 'requestExpeditionAbandon' }, '*');
            return;
        }
        onboardingNavigationInFlight = true;
        event.currentTarget.disabled = true;
        collapseOnboardingForAction(task.id, planetId);
        try {
            const activated = await activateOnboardingStep(task, guideStep, planetId);
            if (!activated) {
                restoreOnboardingHint(state.settings, task.id, planetId);
                renderOnboardingPanel();
            }
            void saveUserProfile();
        } finally {
            onboardingNavigationInFlight = false;
        }
    };
    requestAnimationFrame(() => applyOnboardingHighlight(task, guideStep));
}

function checkOnboardingTask(taskId) {
    const planetId = getActivePlanetId();
    const result = advanceOnboardingTask(state.settings, taskId, planetId);
    if (!result.changed) return false;
    const reward = claimOnboardingReward(state.settings, taskId, planetId);
    if (reward.claimed && result.task?.reward?.coins) addCoins(result.task.reward.coins, { source: `onboarding-${taskId}`, category: 'onboarding', planetId });
    if (planetId === 'haqi' && !result.onboarding.activeTaskId) scheduleReturnRoute(state.settings, planetId);
    recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_TASK_COMPLETED, firstDayContext({
        taskId,
        rewardCoins: reward.claimed ? Number(result.task?.reward?.coins) || 0 : 0,
        completedCount: result.onboarding.completedTaskIds.length,
    }), { dedupeKey: `${planetId}:onboarding-task:${taskId}` });
    if (planetId === 'haqi' && !result.onboarding.activeTaskId) {
        recordFirstDayEvent(FIRST_DAY_EVENTS.ONBOARDING_COMPLETED, firstDayContext({
            taskCount: result.onboarding.completedTaskIds.length,
            finalTaskId: taskId,
        }), { dedupeKey: `${planetId}:onboarding-completed` });
    }
    void saveUserProfile();
    notify();
    renderOnboardingPanel();
    if (reward.claimed) {
        celebrateOnboardingReward(result.task);
        showToast(`完成「${result.task.title}」：获得 ${result.task.reward.coins} 金币`, 'success', 2600);
    }
    return true;
}
ensureOnboardingPanelRoot();

// 立即绘制启动闪屏：首屏渲染不再等待 SDK（CDN 往返 + ~600KB 解析）或网络数据，
// 给用户一个即时可见的内容画面（FCP），SDK 在后台并行加载。
function renderSplash() {
    app.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#0f2747">'
        + '<div style="font-size:30px;font-weight:800;letter-spacing:1px">Loading...</div>'
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
        // autoReloadAfterRedirectLogin:false —— 微信整页授权回跳后不让 SDK 自动整页刷新，
        // 改由 bootstrap() await whenRedirectLoginSettled() 协调登录态并就地路由，避免双跳。
        sdk = window.keepwork || new window.KeepworkSDK({
            timeout: 30000,
            autoReloadAfterRedirectLogin: false,
            wxAuth: { scope: 'snsapi_base' },
        });
        // 兜底：若 window.keepwork 由旧版 SDK（不认 KEEPWORK_DEFAULT_OPTIONS，如过期 CDN 包）
        // 用默认参数预创建，其 autoReloadAfterRedirectLogin 仍为 true。这里强制关掉——
        // codeToProbe 是网络请求，本行同步代码必在其 resolve 前执行，能赶在 reload 判断前生效。
        if (sdk) sdk._autoReloadAfterRedirectLogin = false;
        // MagicHaqi 微信登录固定使用 snsapi_base 静默授权。这里再次设置是为了兼容
        // 页面中已经存在 window.keepwork，或不识别 KEEPWORK_DEFAULT_OPTIONS 的旧版 SDK。
        sdk?.wxAuth?.setScope?.('snsapi_base');
        // 设置 maisi 项目 API Key
        if (sdk.setUserApiKey && window.KeepworkSDK?.API_KEYS?.maisi) {
            sdk.setUserApiKey(window.KeepworkSDK.API_KEYS.maisi);
        }
        sdk.localAPIKeySettings?.load?.().catch(err => console.warn('Local API Key settings load failed:', err));
        sdk.audioEngine?.setVolume?.(APP_AUDIO_VOLUME);
        state.sdk = sdk;
        configureFirstDayFunnelReporter((event) => {
            const logProductEvent = sdk?.remoteLog?.logAnonymousProductEvent;
            if (typeof logProductEvent !== 'function') return null;
            return logProductEvent.call(sdk.remoteLog, 'haqiGame', event.name, {
                eventId: event.id,
                timestamp: event.timestamp,
                visitorId: event.visitorId,
                ...event.properties,
            });
        });
        window.MH_state = state; // 给 view_petList 顶部金币使用
        window.sdk = sdk;
        return sdk;
    })();
    return sdkReadyPromise;
}
// 后台并行预热 SDK（不阻塞首屏）。
initSdk().catch(() => {});

const ITEM_BY_ID = new Proxy({}, { get: (_, id) => getShopItemById(id) || getHomeTreasureFacility(id) });
let planetPlaytimeTimer = null;
let chatViewPromise = null;
let chatViewModule = null;
let minigamesViewPromise = null;
let minigamesViewModule = null;
const expeditionMapViewLoader = createRetryableModuleLoader(attempt => (
    attempt === 1
        ? import('./view_expedition_map.js')
        : import(/* @vite-ignore */ `./view_expedition_map.js?retry=${attempt}`)
));
let expeditionPetHydrationPromise = null;
const expeditionMissingPetIds = new Set();
let pendingMinigameLaunch = null;
let pendingMinigameTab = null;
// 分享链接进入的小游戏（?gameFrom=&game=），引导进入 minigames 视图并自动试玩。
let pendingSharedGame = null;
// 外部小游戏深链进入（?remoteGame=<url>），引导进入 minigames 视图并直接打开该远程 URL。
let pendingRemoteGame = null;
// 新用户通过分享小游戏链接进入：先直接试玩，退出（点返回）后才走命名 / 新手领养流程。
let deferredNewUserSharedGame = false;
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
// 当前星球的新手指引是否为"领养仪式"型（boarding 小游戏）。登录时预计算，供 home 视图在
// 「星球→星球表面」缩放过渡前同步查询（onPlanetToFieldOnboarding），决定是否先弹领养小游戏。
let boardingOnboardingPlanet = false;
let lastRenderedView = null;
let isBootstrapping = true;

const NEW_USER_STORY_PARAM = 'new_user_story';

// 经过中转（如微信小程序原生分享页）的链接，msg 常被二次 encodeURIComponent：
// searchParams.get 只解一层，残留形如 "%E7%82%B9…" 的百分号编码。这里把残留层补解掉，
// 直到不再像百分号编码为止（最多 3 层，且解码须真的产生变化，避免误伤含「%」的正常留言）。
function decodeSharedParam(value) {
    let out = String(value || '');
    for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(out); i++) {
        let next;
        try { next = decodeURIComponent(out); } catch (_) { break; }
        if (next === out) break;
        out = next;
    }
    return out;
}

// 分享小游戏链接：?gameFrom=<username>&game=<filename>[&msg=<自定义留言>]
// msg 是分享者（或程序）附加的一句留言，会显示在分享落地登录页的单独一行。
// 分享小游戏意图持久化：登录 / 注册可能触发整页跳转（KeepWork OAuth 回跳），URL 上的
// ?game= / ?gameFrom= / ?msg= 会在回跳后丢失，导致"新用户经分享链接登录后"误走新手领养
// 仪式而非分享的小游戏。故在检测到分享参数时存入 sessionStorage（同标签页跨跳转保留），
// URL 不再携带参数时回退读取；真正消费小游戏（cleanupSharedGameUrl）时一并清除。
const SHARED_GAME_STORAGE_KEY = 'mh_pending_shared_game';
const WORKBUDDY_IMPORT_STORAGE_KEY = 'mh_pending_workbuddy_game_draft';
const WORKBUDDY_IMPORTED_PREFIX = 'mh_imported_workbuddy_game_draft:';

function persistSharedGameParams(params) {
    try {
        if (params && params.game) {
            sessionStorage.setItem(SHARED_GAME_STORAGE_KEY, JSON.stringify(params));
        }
    } catch (_) {}
}

function loadPersistedSharedGameParams() {
    try {
        const data = JSON.parse(sessionStorage.getItem(SHARED_GAME_STORAGE_KEY) || 'null');
        const game = String(data?.game || '').trim();
        if (!game) return null;
        return {
            fromUsername: String(data?.fromUsername || '').trim(),
            game,
            message: String(data?.message || '').trim().slice(0, 200),
        };
    } catch (_) { return null; }
}

function clearPersistedSharedGameParams() {
    try { sessionStorage.removeItem(SHARED_GAME_STORAGE_KEY); } catch (_) {}
}

// 仅从当前 URL 解析分享参数（不含 sessionStorage 回退）。
function parseSharedGameParamsFromUrl() {
    try {
        const url = new URL(window.location.href);
        const fromUsername = decodeSharedParam(url.searchParams.get('gameFrom') || '').trim();
        const game = decodeSharedParam(url.searchParams.get('game') || '').trim();
        const message = decodeSharedParam(url.searchParams.get('msg') || '').trim().slice(0, 200);
        return { fromUsername, game, message };
    } catch (_) {
        return { fromUsername: '', game: '', message: '' };
    }
}

function parseSharedGameParams() {
    const fromUrl = parseSharedGameParamsFromUrl();
    // URL 仍带分享参数：以 URL 为准，并刷新持久化的意图（防登录跳转丢失）。
    if (fromUrl.game) { persistSharedGameParams(fromUrl); return fromUrl; }
    // URL 不含分享参数（登录回跳后常见）：回退到跳转前持久化的意图。
    return loadPersistedSharedGameParams() || fromUrl;
}

function hasSharedGameParams() {
    // 用户作品分享带 gameFrom + game；官方游戏分享只带 game（按 id 打开），故只需 game 即视为分享进入。
    const { game } = parseSharedGameParams();
    return !!game;
}

// 分享小游戏进入登录页时，展示专属分享登录页：
// 用户作品分享（带 gameFrom）→「XXX 分享了小游戏」；官方游戏分享（仅 game）→「有人给你分享了一个小游戏」。
function sharedGameLoginContext() {
    const params = parseSharedGameParams();
    return params.game ? params : null;
}

// 启动落地视图：分享小游戏 > 明信片 > home。分享小游戏会记下待试玩参数。
function resolveLandingView() {
    if (hasSharedGameParams()) {
        pendingSharedGame = parseSharedGameParams();
        return 'minigames';
    }
    if (hasRemoteGameParams()) {
        pendingRemoteGame = parseRemoteGameParamsFromUrl();
        return 'minigames';
    }
    return hasPostcardParams() ? 'postcard' : 'home';
}

// 外部小游戏深链：?remoteGame=<完整 url>[&remoteGameTitle=&remoteGameIcon=&remoteGameLandscape=0]
// 用于直接把任意远程 H5 小游戏地址嵌入玩耍视图试玩，不需要出现在 _minigame_index.json 清单里。
// remoteGameLandscape 默认开启强制横屏（传 0 关闭）。
function parseRemoteGameParamsFromUrl() {
    try {
        const url = new URL(window.location.href);
        const remoteUrl = decodeSharedParam(url.searchParams.get('remoteGame') || '').trim();
        if (!remoteUrl) return null;
        return {
            url: remoteUrl,
            title: decodeSharedParam(url.searchParams.get('remoteGameTitle') || '').trim(),
            icon: decodeSharedParam(url.searchParams.get('remoteGameIcon') || '').trim(),
            landscape: url.searchParams.get('remoteGameLandscape') !== '0',
        };
    } catch (_) {
        return null;
    }
}

function hasRemoteGameParams() {
    return !!parseRemoteGameParamsFromUrl();
}

function cleanupRemoteGameUrl() {
    try {
        const url = new URL(window.location.href);
        ['remoteGame', 'remoteGameTitle', 'remoteGameIcon', 'remoteGameLandscape'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

function cleanupSharedGameUrl() {
    // 小游戏已被消费：清掉 URL 参数与登录跳转前持久化的意图，避免下次启动重复进入。
    clearPersistedSharedGameParams();
    try {
        const url = new URL(window.location.href);
        ['gameFrom', 'game', 'msg'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

function parseWorkBuddyImportParamsFromUrl() {
    try {
        const url = new URL(window.location.href);
        const draft = decodeSharedParam(
            url.searchParams.get('importGameDraft')
            || url.searchParams.get('workBuddyDraft')
            || url.searchParams.get('wbDraft')
            || url.searchParams.get('draftId')
            || ''
        ).trim();
        return { draft };
    } catch (_) {
        return { draft: '' };
    }
}

function persistWorkBuddyImportParams(params) {
    try {
        if (params?.draft) sessionStorage.setItem(WORKBUDDY_IMPORT_STORAGE_KEY, JSON.stringify(params));
    } catch (_) {}
}

function loadPersistedWorkBuddyImportParams() {
    try {
        const data = JSON.parse(sessionStorage.getItem(WORKBUDDY_IMPORT_STORAGE_KEY) || 'null');
        const draft = String(data?.draft || '').trim();
        return draft ? { draft } : null;
    } catch (_) { return null; }
}

function clearWorkBuddyImportParams() {
    try { sessionStorage.removeItem(WORKBUDDY_IMPORT_STORAGE_KEY); } catch (_) {}
    try {
        const url = new URL(window.location.href);
        ['importGameDraft', 'workBuddyDraft', 'wbDraft', 'draftId'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

function parseWorkBuddyImportParams() {
    const fromUrl = parseWorkBuddyImportParamsFromUrl();
    if (fromUrl.draft) { persistWorkBuddyImportParams(fromUrl); return fromUrl; }
    return loadPersistedWorkBuddyImportParams() || fromUrl;
}

function workBuddyImportKey(draft) {
    return String(draft || '').trim().slice(0, 512);
}

function wasWorkBuddyDraftImported(draft) {
    const key = workBuddyImportKey(draft);
    if (!key) return false;
    try { return sessionStorage.getItem(WORKBUDDY_IMPORTED_PREFIX + key) === '1'; } catch (_) { return false; }
}

function markWorkBuddyDraftImported(draft) {
    const key = workBuddyImportKey(draft);
    if (!key) return;
    try { sessionStorage.setItem(WORKBUDDY_IMPORTED_PREFIX + key, '1'); } catch (_) {}
}

async function maybeImportWorkBuddyGameDraft() {
    const { draft } = parseWorkBuddyImportParams();
    if (!draft) return false;
    if (wasWorkBuddyDraftImported(draft)) {
        clearWorkBuddyImportParams();
        return false;
    }
    try {
        const gameDraft = await loadWorkBuddyGameDraft(draft);
        if (!gameDraft?.html) throw new Error('没有找到 WorkBuddy 游戏草稿');
        const result = await savePetGame(gameDraft.html, {
            title: gameDraft.title,
            icon: gameDraft.icon,
            desc: gameDraft.desc,
        });
        markWorkBuddyDraftImported(draft);
        clearWorkBuddyImportParams();
        showToast(`已导入 ${result?.record?.title || gameDraft.title}`, 'success', 2200);
        if (!hasSelectablePets()) return false;
        pendingMinigameTab = 'mine';
        finishBootstrap();
        setView('minigames');
        return true;
    } catch (e) {
        console.warn('导入 WorkBuddy 小游戏失败', e);
        clearWorkBuddyImportParams();
        showToast('导入 WorkBuddy 小游戏失败：' + (e?.message || e), 'error', 3600);
        return false;
    }
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

function loadExpeditionMapView() {
    return expeditionMapViewLoader.load();
}

const EXPEDITION_PET_INDEX_URL = new URL('../famous-pets/_pet_index.json', import.meta.url).href;
const expeditionCatalogHash = value => String(value || '').split('').reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
const expeditionCatalogRarity = rarity => {
    const score = Math.max(0, Math.min(100, Number(rarity) || 0));
    return score >= 96 ? '传说' : score >= 92 ? '史诗' : score >= 88 ? '精英' : score >= 80 ? '稀有' : '普通';
};
const expeditionMatchesEcology = (pet, tags) => {
    const traits = pet?.traits || {};
    const values = [traits.elementalAttribute, traits.element, traits.species].map(value => String(value || ''));
    return Array.isArray(tags) && tags.some(tag => values.some(value => value.includes(tag)));
};

async function populateExpeditionWildlife(expedition) {
    try {
        const response = await fetch(EXPEDITION_PET_INDEX_URL, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const catalog = (await response.json())
            .filter(pet => pet?.id && (pet.imageSheetUrl || pet.imageUrl));
        if (!catalog.length || !Array.isArray(expedition?.nodes)) return expedition;
        const seed = expeditionCatalogHash(expedition.id);
        const ecologyTags = expedition.ecologyPreview?.ecologyTags || [];
        const preferred = catalog.filter(pet => expeditionMatchesEcology(pet, ecologyTags));
        const fallback = catalog.filter(pet => !expeditionMatchesEcology(pet, ecologyTags));
        const wildlife = [
            ...preferred.sort((left, right) => expeditionCatalogHash(`${seed}:preferred:${left.id}`) - expeditionCatalogHash(`${seed}:preferred:${right.id}`)).slice(0, 24),
            ...fallback.sort((left, right) => expeditionCatalogHash(`${seed}:fallback:${left.id}`) - expeditionCatalogHash(`${seed}:fallback:${right.id}`)).slice(0, 16),
        ];
        let cursor = 0;
        return {
            ...expedition,
            nodes: expedition.nodes.map(node => {
                if (!node?.enemy) return node;
                const pet = wildlife[cursor++ % wildlife.length];
                return {
                    ...node,
                    enemy: {
                        id: String(pet.id),
                        name: String(pet.name || '星际宠物'),
                        icon: '🐾',
                        rarity: expeditionCatalogRarity(pet.rarity),
                        imageSheetUrl: String(pet.imageSheetUrl || pet.imageUrl),
                    },
                };
            }),
        };
    } catch (error) {
        console.warn('[Haqi Expedition] daily wildlife catalog unavailable; using fallback nodes.', error);
        return expedition;
    }
}

async function launchExpedition(expedition, pet, supportPets = [], { confrontation = false, sectorFinale = false } = {}) {
	if (!isHaqiExpeditionEnabled(getActivePlanetId())) return;
    if (!pet?.id || !expedition?.id) return;
    if (isPetDispatching(pet.id, getActivePlanetId())) {
        showToast('这位伙伴正在星际矿区勘探，暂时无法出战。', 'info');
        return;
    }
    if (expedition.explored && !confrontation && !sectorFinale) {
        showToast('这颗星球今天已经探索过了，明天会生成新的星图。', 'info');
        return;
    }
    expedition = await populateExpeditionWildlife(expedition);
    await ensurePetData(pet.id);
    upgradePetData(pet);
    const equipmentEnhancements = getHaqiExpeditionSettlement(state.settings).equipmentEnhancements || {};
    const derivedStats = calculateDerivedStats(pet, { includeEquipment: true, equipmentEnhancements });
    const mineralBridge = getActiveMineralBridge();
    const mineralBonuses = mineralBridge.bonuses;
    const attackPercent = Math.max(0, Number(mineralBonuses.attackPercent) || 0);
    const baseAttack = Math.max(0, Number(derivedStats.attack) || 0);
    const mineralAttackBonus = Math.round(baseAttack * attackPercent / 100);
    const speciesSpecialty = getSpeciesExpeditionSpecialty(pet);
    const readiness = { ...calculateExpeditionReadiness(pet.lifeStats) };
    readiness.initialMpBonus += Number(speciesSpecialty.initialMpBonus) || 0;
    readiness.shieldPercentage += Number(speciesSpecialty.shieldPercentage) || 0;
    readiness.healingMultiplier *= Number(speciesSpecialty.healingMultiplier) || 1;
    readiness.speciesSpecialty = speciesSpecialty;
    const runId = `exp_${pet.id}_${Date.now()}_${randId(6)}`;
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const confrontationMission = confrontation ? createExpeditionConfrontationMission(settlement, runId, speciesSpecialty) : null;
    if (confrontation && !confrontationMission) {
        showToast('异变源头尚未开放或已经解决。', 'info');
        return;
    }
    const sectorFinaleMission = sectorFinale ? createSectorEventFinaleMission(settlement, runId) : null;
    if (sectorFinale && !sectorFinaleMission) {
        showToast('星尘潮汐共同终局尚未开放或已经归档。', 'info');
        return;
    }
    const routePreparation = mineralBridge.preparationCharges > 0;
    const tacticalItems = {
        emergencyBeacon: mineralBridge.tacticalItems.emergencyBeacon > 0 ? 1 : 0,
        deflectionShield: mineralBridge.tacticalItems.deflectionShield > 0 ? 1 : 0,
    };
    if (routePreparation) {
        setActiveMineralBridge({
            ...mineralBridge,
            preparationCharges: mineralBridge.preparationCharges - 1,
            tacticalItems: {
                emergencyBeacon: mineralBridge.tacticalItems.emergencyBeacon - tacticalItems.emergencyBeacon,
                deflectionShield: mineralBridge.tacticalItems.deflectionShield - tacticalItems.deflectionShield,
            },
            syncedAt: Date.now(),
        });
        saveUserProfileDebounced();
    } else if (tacticalItems.emergencyBeacon || tacticalItems.deflectionShield) {
        setActiveMineralBridge({
            ...mineralBridge,
            tacticalItems: {
                emergencyBeacon: mineralBridge.tacticalItems.emergencyBeacon - tacticalItems.emergencyBeacon,
                deflectionShield: mineralBridge.tacticalItems.deflectionShield - tacticalItems.deflectionShield,
            },
            syncedAt: Date.now(),
        });
        saveUserProfileDebounced();
    }
    const selectedPet = {
        ...sanitizeExpeditionPet(pet),
        battleStats: {
            ...derivedStats,
            attack: baseAttack + mineralAttackBonus + (Number(speciesSpecialty.attackBonus) || 0),
            defense: Math.max(0, Number(derivedStats.defense) || 0) + (Number(speciesSpecialty.armorBonus) || 0),
        },
        lifeStats: { ...pet.lifeStats },
        expeditionReadiness: readiness,
        mineralBonuses: { attackPercent, expeditionLootPercent: Math.max(0, Number(mineralBonuses.expeditionLootPercent) || 0) },
    };
    const selectedSupportPets = (Array.isArray(supportPets) ? supportPets : [])
        .filter(item => item?.id && item.id !== pet.id && !isPetDispatching(item.id, getActivePlanetId()))
        .slice(0, 2)
        .map(item => ({
            id: String(item.id),
            name: String(item.name || '支援伙伴'),
            speciesSpecialty: getSpeciesExpeditionSpecialty(item),
        }));
    const supportRoutePlan = createSupportRoutePlan(selectedSupportPets);
    if (!selectedPet || !expedition?.id) return;
    const adaptiveThreat = calculateAdaptiveThreat(selectedPet.battleStats);
    const investigationMission = createExpeditionInvestigationMission(
        settlement,
        expedition,
        runId,
        selectedSupportPets.map(item => item.speciesSpecialty),
    );
    const onboardingFirstRun = getActivePlanetId() === 'haqi'
        && getActiveOnboardingTask(state.settings, 'haqi')?.id === 'complete-first-expedition';
    pendingMinigameLaunch = {
        mode: 'expedition',
        pluginId: HAQI_EXPEDITION_PLUGIN.id,
        gameId: HAQI_EXPEDITION_PLUGIN.gameId,
        params: {
            selectedPet,
            selectedSupportPets,
            supportRoutePlan,
            mineralBonuses: selectedPet.mineralBonuses,
            expedition,
            adaptiveThreat,
            runId,
            mapSeed: runId,
            investigationMission,
            confrontationMission,
            sectorFinaleMission,
            routePreparation,
            tacticalItems,
            onboardingFirstRun: confrontation || sectorFinale ? false : onboardingFirstRun,
        },
        allowLowEnergy: true,
        suppressRewards: true,
    };
    completeDailyReturnRouteStep('start-expedition');
    recordFirstDayEvent(FIRST_DAY_EVENTS.EXPEDITION_STARTED, firstDayContext({
        runId,
        expeditionId: expedition.id,
        onboardingFirstRun,
    }), { dedupeKey: `expedition-started:${runId}` });
    navigateToView('minigames', { preserveMinigameLaunch: true });
}

function launchExpeditionConfrontation(pet) {
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const expedition = getDailyExpeditionRoster(settlement, { planetName: state.planetName || '哈奇星球' })
        .find(item => item?.biome === '荧光沼泽' && Array.isArray(item.nodes));
    if (!expedition) {
        showToast('今日星图没有稳定的荧光沼泽航线，异变源头暂时无法定位。', 'info', 3000);
        return;
    }
    return launchExpedition(expedition, pet, [], { confrontation: true });
}

function launchSectorEventFinale(pet) {
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const expedition = getDailyExpeditionRoster(settlement, { planetName: state.planetName || '哈奇星球' })
        .find(item => Array.isArray(item?.nodes));
    if (!expedition) return showToast('今日星图没有可用航线。', 'info');
    return launchExpedition(expedition, pet, [], { sectorFinale: true });
}

async function launchFriendlyGuardDojo(selectedPets, requestedFloor = null) {
    if (!isHaqiExpeditionEnabled(getActivePlanetId())) return;
    const petIds = Array.isArray(selectedPets) ? selectedPets.map(pet => String(pet?.id || '')) : [];
    if (petIds.length !== FRIENDLY_GUARD_DOJO.teamSize || new Set(petIds).size !== FRIENDLY_GUARD_DOJO.teamSize) {
        showToast('请选择 3 只不同的伙伴组成道馆阵容。', 'info');
        return;
    }
    const playerPets = await Promise.all(petIds.map(async id => state.pets[id] || loadPet(id)));
    if (playerPets.some(pet => !pet || isPetDispatching(pet.id, getActivePlanetId()))) {
        showToast('勘探中的伙伴暂时无法参加道馆挑战。', 'info');
        return;
    }
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const status = getFriendlyGuardDojoStatus(settlement);
    const requested = Math.floor(Number(requestedFloor) || 0);
    const floor = requested || status.nextFloor || status.highestClearedFloor;
    const isReplay = status.clearedFloors.includes(floor);
    if (!floor || floor < 1 || floor > FRIENDLY_GUARD_DOJO.floorCount || (!isReplay && floor !== status.nextFloor)) {
        showToast('该道馆楼层尚未解锁。', 'info');
        return;
    }
    if (!isReplay && status.challengeTokens < 1) {
        showToast('首通需要 1 张挑战函；每成功完成 2 次远征可获得 1 张。', 'info', 3000);
        return;
    }
    const equipmentEnhancements = settlement.equipmentEnhancements || {};
    const playerTeam = [];
    for (const pet of playerPets) {
        await ensurePetData(pet.id);
        upgradePetData(pet);
        playerTeam.push({
            ...sanitizeExpeditionPet(pet),
            battleStats: calculateDerivedStats(pet, { includeEquipment: true, equipmentEnhancements }),
            lifeStats: { ...pet.lifeStats },
        });
    }
    const guardianTeam = getFriendlyGuardDojoFloorRoster(floor);
    if (guardianTeam.length !== FRIENDLY_GUARD_DOJO.teamSize) {
        showToast('道馆阵容配置异常，请稍后重试。', 'error');
        return;
    }
    const dojoRunId = `dojo_${floor}_${Date.now()}_${randId(6)}`;
    pendingMinigameLaunch = {
        mode: 'dojo',
        pluginId: HAQI_EXPEDITION_PLUGIN.id,
        gameId: HAQI_EXPEDITION_PLUGIN.gameId,
        params: {
            mode: 'dojo',
            dojoRunId,
            floor,
            playerTeam,
            guardianTeam,
            selectedPet: playerTeam[0],
        },
        allowLowEnergy: true,
        suppressRewards: true,
    };
    navigateToView('minigames', { preserveMinigameLaunch: true });
}

const EXPEDITION_PET_ART = {
    sugar_patrol: 'https://cdn.keepwork.com/maisi/magichaqi/pet/flame_puppy_doudou_20260524132225.webp',
    bubble_spitter: 'https://cdn.keepwork.com/maisi/magichaqi/pet/coral_leopard_frog_20260527013859.webp',
    frost_beetle: 'https://cdn.keepwork.com/maisi/magichaqi/pet/star_salt_crab_cat_20260527023615.webp',
    magnetic_guard: 'https://cdn.keepwork.com/maisi/magichaqi/pet/zodiac_tiger_tangtang_20260524161411.webp',
    crystal_hunter: 'https://cdn.keepwork.com/maisi/magichaqi/pet/nine_tail_cloud_fox_20260525030546.webp',
    rift_walker: 'https://cdn.keepwork.com/maisi/magichaqi/pet/kraken_gummy_tako_20260525030549.webp',
    ruin_watcher: 'https://cdn.keepwork.com/maisi/magichaqi/pet/basilisk_emerald_noodle_20260525030549.webp',
    core_guard: 'https://cdn.keepwork.com/maisi/magichaqi/pet/xingliu_linli_20260527011956.webp',
    ember_phoenix: 'https://cdn.keepwork.com/maisi/magichaqi/pet/phoenix_spark_peep_20260528043651.webp',
    snow_fenrir: 'https://cdn.keepwork.com/maisi/magichaqi/pet/fenrir_snow_bite_20260525030549.webp',
    nebula_leopard: 'https://cdn.keepwork.com/maisi/magichaqi/pet/ningguang_baoyuan_20260527021659.webp',
    coral_hopper: 'https://cdn.keepwork.com/maisi/magichaqi/pet/coral_leopard_frog_20260527013859.webp',
    tako_void: 'https://cdn.keepwork.com/maisi/magichaqi/pet/kraken_gummy_tako_20260525030549.webp',
    cloud_fox: 'https://cdn.keepwork.com/maisi/magichaqi/pet/nine_tail_cloud_fox_20260525030546.webp',
    emerald_basilisk: 'https://cdn.keepwork.com/maisi/magichaqi/pet/basilisk_emerald_noodle_20260525030549.webp',
    stellar_tiger: 'https://cdn.keepwork.com/maisi/magichaqi/pet/zodiac_tiger_tangtang_20260524161411.webp',
};

async function restoreExpeditionPetArtwork() {
    for (const id of state.petOrder || []) {
        const pet = state.pets[id] || await loadPet(id);
        if (!pet || pet.source !== 'expedition' || pet.imageSheetUrl || pet.imageUrl) continue;
        const imageSheetUrl = EXPEDITION_PET_ART[pet.expeditionSpeciesId];
        if (!imageSheetUrl) continue;
        pet.imageSheetUrl = imageSheetUrl;
        state.pets[pet.id] = pet;
        await savePet(pet);
    }
}

async function settleExpeditionCaptures(expedition, captures) {
	if (!isHaqiExpeditionEnabled(getActivePlanetId())) return { saved: 0, pets: [] };
    const safeCaptures = Array.isArray(captures) ? captures.slice(0, 3) : [];
    const safeExpeditionId = String(expedition?.id || '').trim();
    if (!safeExpeditionId) return { saved: 0, pets: [] };
    let saved = 0;
    const savedPets = [];
    const ownedSpecies = new Set((state.petOrder || [])
        .map(id => state.pets[id]?.expeditionSpeciesId)
        .filter(Boolean));
    for (const capture of safeCaptures) {
        const speciesId = String(capture?.speciesId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
        if (!speciesId) continue;
        const now = Date.now();
        const dna = randomDna();
        const qualityId = capture?.quality?.id || capture?.qualityId;
        const quality = qualityId ? window.MHPetQuality?.snapshot(qualityId) || null : null;
        const battleStats = quality ? { ...quality.stats, ...(capture?.battleStats || {}) } : null;
        const imageSheetUrl = String(capture?.imageSheetUrl || EXPEDITION_PET_ART[speciesId] || '').trim();
        const pet = {
            id: 'pet_' + randId(8),
            name: String(capture?.name || '探险伙伴').trim().slice(0, 24) || '探险伙伴',
            dna,
            imageUrl: null,
            imageSheetUrl,
            traits: decodeDna(dna),
            rarity: Number.isFinite(capture?.rarity) ? Math.max(0, Math.min(5, capture.rarity)) : dnaRarity(dna),
            stats: { ...defaultStats(), hunger: 100, mood: 100, clean: 100, bond: 55 },
            ...(quality ? { quality, battleStats } : {}),
            permanentTrauma: defaultPermanentTrauma(),
            bornAt: now,
            lastTickAt: now,
            lastCareAt: now,
            parents: null,
            stage: 'baby',
            anim: 'happy',
            activeRoom: 'living',
            source: 'expedition',
            expeditionId: safeExpeditionId,
            expeditionSpeciesId: speciesId,
            expeditionSourceRarity: String(capture?.rarity || '').slice(0, 12),
            expeditionTrait: String(capture?.trait || '').slice(0, 32),
        };
        applyStage(pet);
        await savePet(pet);
        saved += 1;
        const savedQualityId = String(pet.quality?.id || qualityId || '').toUpperCase();
        savedPets.push(Object.freeze({
            id: pet.id,
            name: pet.name,
            qualityId: savedQualityId,
            imageSheetUrl: pet.imageSheetUrl || '',
            imageUrl: pet.imageUrl || '',
            speciesId,
            isNewSpecies: !ownedSpecies.has(speciesId),
        }));
        ownedSpecies.add(speciesId);
    }
    if (saved) {
        preloadLoadedPetAssets();
        showToast(`探险队带回了 ${saved} 位新伙伴！`, 'success', 3000);
        recordProductEvent('reward_acquired', {
            source: 'expedition',
            rewardType: 'pet',
            quantity: saved,
            rareQuantity: savedPets.filter(pet => pet.qualityId === 'SSR' || pet.qualityId === 'UR').length,
            newSpeciesQuantity: savedPets.filter(pet => pet.isNewSpecies).length,
        });
    }
    return { saved, pets: savedPets };
}

async function settleExpeditionProgress(launch, data) {
    if (launch?.pluginId !== HAQI_EXPEDITION_PLUGIN.id || !isHaqiExpeditionEnabled(getActivePlanetId())) {
        return { applied: false, reason: 'plugin-disabled', experience: 0, loot: [] };
    }
    const petId = String(launch?.params?.selectedPet?.id || '').trim();
    const pet = petId ? state.pets[petId] || await loadPet(petId) : null;
    if (!pet) throw new Error('找不到本次出战宠物');
    await ensurePetData(pet.id);
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const mineralBridge = getActiveMineralBridge();
    const mineralBonuses = mineralBridge.bonuses;
    const inventoryBefore = { ...state.inventory };
    const result = processExpeditionResult(pet, state.inventory, {
        ...data,
        runId: data?.runId || launch.params?.runId,
        petId,
    }, settlement, { lootBonusPercent: mineralBonuses.expeditionLootPercent });
    if (!result.applied) return result;
    const relationships = state.settings.npcRelationships || {};
    const relationshipNpcs = Object.keys(relationships).map(progressId => ({ id: progressId, progressId }));
    const relationshipBonuses = getNpcRelationshipBonuses(relationshipNpcs, relationships);
    const collectibles = [rollCollectibleDrop({ source: 'expedition', chance: 1 })];
    collectibles.push(rollCollectibleDrop({ source: 'expedition', chance: relationshipBonuses.expeditionLootPercent / 100 }));
    result.collectibles = collectibles.filter(Boolean);
    result.collectibles.forEach(item => {
        state.inventory[item.id] = Math.max(0, Number(state.inventory[item.id]) || 0) + 1;
        const freshness = state.settings.npcGiftFreshness && typeof state.settings.npcGiftFreshness === 'object'
            ? state.settings.npcGiftFreshness
            : (state.settings.npcGiftFreshness = {});
        registerCollectibleAcquisition(freshness, item.id);
        if (!state.inventoryOrder.includes(item.id)) state.inventoryOrder.push(item.id);
    });
    result.collectibleSeries = getCollectibleSeriesOutcomes(inventoryBefore, state.inventory, result.collectibles);
    if (result.homeTreasure) {
        result.homeTreasureFirstOwned = Math.max(0, Number(inventoryBefore[result.homeTreasure]) || 0) === 0;
    }
    const dojoProgress = recordSuccessfulExpeditionForDojo(settlement, data?.runId || launch.params?.runId);
    for (const entry of result.loot) {
        const itemId = `expedition_material_${entry.id}`;
        if (!state.inventoryOrder.includes(itemId)) state.inventoryOrder.push(itemId);
    }
    if (result.homeTreasure) {
        const itemId = getHomeTreasureInventoryId(result.homeTreasure);
        if (itemId && !state.inventoryOrder.includes(itemId)) state.inventoryOrder.push(itemId);
    }
    await savePet(pet);
    saveInventoryDebounced();
    saveUserProfileDebounced();
    notify();
    if (result.equipment?.received?.length) {
        showToast(`远征获得装备：${result.equipment.received.length} 件，可在宠物战斗面板装配`, 'success', 2800);
    } else if (result.equipment?.materials?.length) {
        showToast('重复远征装备已转化为星核精粹', 'info', 2400);
    }
    if (result.collectibles.length) {
        showToast(`远征发现：${result.collectibles.map(item => `${item.icon} ${item.name}`).join('、')}`, 'success', 3000);
    }
    if (dojoProgress.earnedTokens) showToast('获得守护大师友好道馆挑战函，可在今日星图查看', 'success', 3000);
    if (result.collectibles.length) recordProductEvent('reward_acquired', { source: 'expedition', rewardType: 'collectible', quantity: result.collectibles.length });
    if (result.homeTreasure) recordProductEvent('reward_acquired', { source: 'expedition', rewardType: 'home_treasure', quantity: 1 });
    if (result.equipment?.received?.length) recordProductEvent('reward_acquired', { source: 'expedition', rewardType: 'equipment', quantity: result.equipment.received.length });
    return result;
}

function recordExpeditionOutcome(launch, data = {}, progress = null) {
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const outcome = progress?.applied ? {
        ...data,
        loot: progress.loot,
        lootBonusPercent: progress.lootBonusPercent,
        mineralBonuses: launch?.params?.mineralBonuses,
    } : data;
    settlement.history = recordExpeditionHistory(settlement.history, launch, outcome);
    settlement.capturedPets = mergeCapturedPets(settlement.capturedPets, outcome.captures);
    const investigation = recordExpeditionInvestigationOutcome(settlement, launch, outcome);
    if (investigation.applied) synchronizeExpeditionSectorEvent(settlement, investigation.progress);
    saveUserProfileDebounced();
    if (investigation.applied) {
        const message = investigation.reason === 'investigation-discovered'
            ? '调查发现：荧光沼泽的孢子正在异常扩散，返回星图选择追踪方向。'
            : `调查推进：已记录第 ${investigation.progress.evidence} 条孢子异变证据。`;
        showToast(message, 'success', 3600);
    }
    return investigation;
}

function synchronizeExpeditionSectorEvent(settlement, investigationProgress, finalePreparation = null) {
    if (!investigationProgress || investigationProgress.stage === 'undiscovered') return getSectorEventProgress(settlement);
    const availability = getSectorEventAvailability();
    if (!availability.started || availability.progressionClosed) return getSectorEventProgress(settlement);
    if (getSectorEventProgress(settlement).stage === 'dormant') startSectorEvent(settlement);
    synchronizeSectorEvent(settlement, investigationProgress, availability);
    if (finalePreparation && investigationProgress.stage === 'resolved') {
        prepareSectorEventFinale(settlement, investigationProgress, finalePreparation);
        synchronizeSectorEvent(settlement, investigationProgress, availability);
    }
    return getSectorEventProgress(settlement);
}

function claimHomeTreasureDailyReward(treasureId) {
    if (!isHaqiExpeditionEnabled(getActivePlanetId())) {
        showToast('家园珍宝设施仅在哈奇星球运行', 'info');
        return;
    }
    if (!isHomeTreasureId(treasureId) || Number(state.inventory?.[treasureId]) < 1) {
        showToast('尚未拥有这件家园珍宝', 'error');
        return;
    }
    if (!isHomeTreasurePlaced(state.layouts, treasureId)) {
        showToast('请先将家园珍宝摆放在星球地块上，再启动设施效果', 'info');
        return;
    }
    const claim = claimDailyHomeTreasureEffect(state.planetActions, treasureId);
    if (!claim.claimed) {
        showToast('这件珍宝今日已经领取过了', 'info');
        return;
    }
    const reward = getHomeTreasureDailyReward(treasureId, state.planetActions, state.inventory?.[treasureId]);
    if (reward.coins) addCoins(reward.coins, { source: `home-treasure-${treasureId}`, category: 'facility', planetId: 'haqi' });
    if (reward.biofuel) addBiofuel(reward.biofuel);
    completeDailyReturnRouteStep('tend-home');
    saveUserProfileDebounced();
    notify();
    const growth = getHomeTreasureGrowth(state.planetActions, treasureId);
    showToast(`${HOME_TREASURE_META[treasureId].name}：${formatHomeTreasureReward(reward)} · 设施 Lv.${growth.level}`, 'success', 2600);
}

function renderExpeditionMapRoute() {
    if (!isHaqiExpeditionEnabled(getActivePlanetId())) {
        navigateToView('home');
        return;
    }
    const unloadedPetIds = getPendingExpeditionPetIds(state.petOrder, state.pets, expeditionMissingPetIds);
    if (unloadedPetIds.length) {
        app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">今日星图</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在召集出战伙伴...</div>';
        const back = $('mhBack');
        if (back) back.onclick = () => navigateToView('home');
        if (!expeditionPetHydrationPromise) {
            expeditionPetHydrationPromise = loadPets(unloadedPetIds)
                .then(() => {
                    recordMissingExpeditionPetIds(unloadedPetIds, state.pets, expeditionMissingPetIds);
                    return true;
                })
                .catch(error => {
                    console.warn('加载远征伙伴失败', error);
                    showToast('伙伴档案加载失败，请重试', 'error');
                    return false;
                })
                .finally(() => { expeditionPetHydrationPromise = null; });
        }
        expeditionPetHydrationPromise.then(loaded => {
            if (loaded && state.currentView === 'expeditionMap') renderExpeditionMapRoute();
            if (!loaded && state.currentView === 'expeditionMap') {
                app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">今日星图</span><span style="width:36px;height:36px"></span></div><div class="empty-state" style="padding:32px 18px"><div class="empty-state__title">伙伴档案暂时无法载入</div><div class="empty-state__desc">网络可能有波动，已保留出战伙伴，可以重新加载。</div><div class="empty-state__actions"><button class="btn-primary" id="mhRetryExpeditionPets" type="button">重新加载</button><button class="btn-secondary" id="mhReturnFromExpeditionPets" type="button">返回首页</button></div></div>';
                const retry = $('mhRetryExpeditionPets');
                const returnHome = $('mhReturnFromExpeditionPets');
                const failedBack = $('mhBack');
                if (retry) retry.onclick = () => renderExpeditionMapRoute();
                if (returnHome) returnHome.onclick = () => navigateToView('home');
                if (failedBack) failedBack.onclick = () => navigateToView('home');
            }
        });
        return;
    }
    const equipmentEnhancements = getHaqiExpeditionSettlement(state.settings).equipmentEnhancements || {};
    const mineralBridge = getActiveMineralBridge();
    const mineralBonuses = mineralBridge.bonuses;
    const pets = state.petOrder
        .map(id => state.pets[id])
        .filter(pet => pet?.id)
        .map(pet => {
            const derivedStats = calculateDerivedStats(pet, { includeEquipment: true, equipmentEnhancements });
            const baseAttack = Math.max(0, Number(derivedStats.attack) || 0);
            const attackPercent = Math.max(0, Number(mineralBonuses.attackPercent) || 0);
            const speciesSpecialty = getSpeciesExpeditionSpecialty(pet);
            const attack = baseAttack
                + Math.round(baseAttack * attackPercent / 100)
                + (Number(speciesSpecialty.attackBonus) || 0);
            const defense = Math.max(0, Number(derivedStats.defense) || 0)
                + (Number(speciesSpecialty.armorBonus) || 0);
            const battleStats = {
                ...derivedStats,
                attack,
                defense,
            };
            const adaptiveThreat = calculateAdaptiveThreat(battleStats);
            return {
                ...pet,
                isDispatching: isPetDispatching(pet.id, getActivePlanetId()),
                expeditionPreview: {
                    baseAttack,
                    attackPercent,
                    attack,
                    maxHp: Math.max(0, Number(derivedStats.maxHp) || 0),
                    defense,
                    magic: Math.max(0, Number(derivedStats.magic) || 0),
                    luck: Math.max(0, Number(derivedStats.luck) || 0),
                    captureBonusPercent: Math.min(8, Math.max(0, Number(derivedStats.luck) || 0) * 0.05),
                    combatPower: calculateExpeditionCombatPower(battleStats),
                    adaptiveThreat,
                    lootPercent: Math.max(0, Number(mineralBonuses.expeditionLootPercent) || 0),
                    preparationCharges: mineralBridge.preparationCharges,
                    speciesSpecialty,
                },
            };
        });
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const exitFixVersion = settlement.dailyExpeditionExitFixVersion;
    const expeditions = getDailyExpeditionRoster(settlement, { planetName: state.planetName || '哈奇星球' })
        .filter(expedition => expedition?.id && Array.isArray(expedition.nodes));
    if (settlement.dailyExpeditionExitFixVersion !== exitFixVersion) saveUserProfileDebounced();
    const weeklyProgress = getHaqiWeeklyProgress({
        history: settlement.history,
        bridge: mineralBridge,
        claimedWeekStarts: settlement.weeklyRewardClaims,
    });
    const investigationProgress = getExpeditionInvestigationProgress(settlement);
    const previousSectorStage = getSectorEventProgress(settlement).stage;
    const sectorEventProgress = synchronizeExpeditionSectorEvent(settlement, investigationProgress);
    if (sectorEventProgress.stage !== previousSectorStage) saveUserProfileDebounced();
    const data = {
        pets,
        expeditions,
        history: settlement.history || [],
        weeklyProgress,
        dojoStatus: getFriendlyGuardDojoStatus(settlement),
        investigationProgress,
        sectorEventProgress,
    };
    const options = {
        onBack: () => navigateToView('home'),
        onLaunch: launchExpedition,
        onLaunchConfrontation: launchExpeditionConfrontation,
        onLaunchSectorFinale: launchSectorEventFinale,
        onLaunchDojo: launchFriendlyGuardDojo,
        onChooseInvestigationBranch: branchId => {
            const result = chooseExpeditionInvestigationBranch(settlement, branchId);
            if (result.applied) {
                synchronizeExpeditionSectorEvent(settlement, result.progress);
                saveUserProfileDebounced();
                showToast(`调查方向已确定：${result.progress.branch.label}`, 'success', 2800);
            }
            return result;
        },
        onDiscoverSectorSideCase: () => {
            const result = discoverSectorSideCase(settlement);
            if (result.applied) saveUserProfileDebounced();
            return result;
        },
        onChooseSectorSideCase: choiceId => {
            const result = chooseSectorSideCase(settlement, choiceId);
            if (result.applied) saveUserProfileDebounced();
            return result;
        },
        onReviewHistory: runId => {
            const planetId = getActivePlanetId();
            const historyRunId = String(runId || 'history').slice(0, 80);
            recordFirstDayEvent(
                FIRST_DAY_EVENTS.EXPEDITION_HISTORY_REVIEWED,
                firstDayContext({ runId: historyRunId }),
                { dedupeKey: `${planetId}:expedition-history-reviewed:${historyRunId}` },
            );
            checkOnboardingTask('review-expedition-settlement');
        },
    };
    if (expeditionMapViewLoader.loadedModule) {
        expeditionMapViewLoader.loadedModule.renderExpeditionMap(app, data, options);
        renderOnboardingPanel();
        return;
    }
    app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">今日星图</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">正在展开星图...</div>';
    const back = $('mhBack');
    if (back) back.onclick = options.onBack;
    loadExpeditionMapView()
        .then(({ renderExpeditionMap }) => {
            if (state.currentView === 'expeditionMap') {
                renderExpeditionMap(app, data, options);
                renderOnboardingPanel();
            }
        })
        .catch((error) => {
            console.error('加载星图失败', error);
            showToast('加载星图失败：' + (error?.message || error), 'error');
            if (state.currentView !== 'expeditionMap') return;
            app.innerHTML = '<div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">今日星图</span><span style="width:36px;height:36px"></span></div><div class="empty-state" style="padding:32px 18px"><div class="empty-state__title">星图暂时无法展开</div><div class="empty-state__desc">网络可能有波动，可以重新加载或稍后再试。</div><div class="empty-state__actions"><button class="btn-primary" id="mhRetryExpeditionMap" type="button">重新加载</button><button class="btn-secondary" id="mhReturnFromExpeditionMap" type="button">返回首页</button></div></div>';
            const retry = $('mhRetryExpeditionMap');
            const returnHome = $('mhReturnFromExpeditionMap');
            const failedBack = $('mhBack');
            if (retry) retry.onclick = () => renderExpeditionMapRoute();
            if (returnHome) returnHome.onclick = options.onBack;
            if (failedBack) failedBack.onclick = options.onBack;
        });
}

function renderHaqiExplorationArchiveRoute() {
    if (!isHaqiExpeditionEnabled(getActivePlanetId())) {
        navigateToView('home');
        return;
    }
    const settlement = getHaqiExpeditionSettlement(state.settings);
    const previousSectorStage = getSectorEventProgress(settlement).stage;
    const sectorEventProgress = synchronizeExpeditionSectorEvent(settlement, getExpeditionInvestigationProgress(settlement));
    if (sectorEventProgress.stage !== previousSectorStage) saveUserProfileDebounced();
    const bridge = getActiveMineralBridge();
    const weeklyProgress = getHaqiWeeklyProgress({ history: settlement.history, bridge, claimedWeekStarts: settlement.weeklyRewardClaims });
    const equipmentCount = Object.values(settlement.equipmentEnhancements || {})
        .filter(value => Number(value) > 0).length;
    const treasures = Object.entries(getHomeTreasures(state.inventory)).map(([id, count]) => ({
        count,
        name: HOME_TREASURE_META[id]?.name || '家园珍宝',
        rewardText: HOME_TREASURE_META[id]?.rewardText || '',
    }));
    renderHaqiExplorationArchive(app, {
        bridge,
        history: settlement.history || [],
        equipmentCount,
        activeSeriesCount: bridge.activeSeriesIds.length,
        collectibleSeries: getCollectibleSeriesProgress(state.inventory),
        treasures,
        weeklyProgress,
        sectorEventProgress,
    }, {
        onBack: () => navigateToView(rewardOutcomeReturnTracker.consume('haqiExplorationArchive', 'home')),
        onOpenExpedition: () => navigateToView('expeditionMap'),
        onOpenMineral: () => navigateToView('haqiMineralExploration'),
        onClaimWeeklyReward: async () => {
            const latestSettlement = getHaqiExpeditionSettlement(state.settings);
            const latestProgress = getHaqiWeeklyProgress({ history: latestSettlement.history, bridge: getActiveMineralBridge(), claimedWeekStarts: latestSettlement.weeklyRewardClaims });
            if (!latestProgress.claimable) {
                showToast(latestProgress.claimed ? '本周航线奖励已经领取。' : '完成全部本周航线后即可领取。', 'info');
                return;
            }
            latestSettlement.weeklyRewardClaims = [...new Set([...(latestSettlement.weeklyRewardClaims || []), latestProgress.weekStart])].slice(-12);
            addCoins(latestProgress.rewardCoins, { source: 'haqi-weekly-route', category: 'retention', planetId: 'haqi' });
            await saveUserProfile();
            showToast(`本周航线完成，获得 ${latestProgress.rewardCoins} 金币。`, 'success');
            renderHaqiExplorationArchiveRoute();
        },
    });
    renderOnboardingPanel();
}

function mineralBridgePetSummaries() {
    const equipmentEnhancements = getHaqiExpeditionSettlement(state.settings).equipmentEnhancements || {};
    return state.petOrder.map(id => state.pets[id]).filter(pet => pet?.id).map(pet => {
        const support = calculateMineralPetSupport(calculateDerivedStats(pet, { includeEquipment: true, equipmentEnhancements }));
        return {
            id: pet.id,
            name: pet.name || dnaToName(pet.dna || '') || '哈奇伙伴',
            stage: pet.stage || '',
            imageSheetUrl: pet.imageSheetUrl || '',
            imageUrl: pet.imageUrl || '',
            mineralCombatPower: support.combatPower,
            mineralAssistIds: support.assistIds,
            mineralAssists: support.assists,
            mineralNextUnlock: support.nextUnlock,
        };
    });
}

function sendHaqiMineralHostReady(planetId) {
    if (state.currentView !== 'haqiMineralExploration' || !haqiMineralFrame?.contentWindow) return;
    haqiMineralFrame.contentWindow.postMessage({
        channel: HAQI_MINERAL_CHANNEL,
        version: HAQI_MINERAL_VERSION,
        planetId,
        type: 'HOST_READY',
        payload: {
            userId: state.user?.id || '',
            pets: mineralBridgePetSummaries(),
            existingBridge: getMineralExplorationBridge(planetId),
            contentPacks: getMineralExplorationConfig(planetId).contentPacks,
        },
    }, '*');
}

function renderHaqiMineralExplorationRoute() {
    const planetId = getActivePlanetId();
    if (!isMineralExplorationEnabled(planetId)) {
        navigateToView('home');
        return;
    }
    if (haqiMineralFrame?.isConnected && app.contains(haqiMineralFrame)) return;
    app.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhHaqiMineralBack" title="返回" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">星际矿区</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow:hidden;background:#dff7ff">
            <iframe id="mhHaqiMineralFrame" title="星际矿区" src="minigames/haqi_mineral_exploration.html?planetId=${encodeURIComponent(planetId)}" style="width:100%;height:100%;border:0;background:#dff7ff"></iframe>
        </div>`;
    const back = $('mhHaqiMineralBack');
    if (back) back.onclick = () => navigateToView('home');
    haqiMineralFrame = $('mhHaqiMineralFrame');
    haqiMineralFrame?.addEventListener('load', () => {
        sendHaqiMineralHostReady(planetId);
    });
}

window.addEventListener('message', (event) => {
    const message = event.data || {};
    const planetId = getActivePlanetId();
    if (state.currentView !== 'haqiMineralExploration' || !isMineralExplorationEnabled(planetId) || !haqiMineralFrame?.contentWindow || event.source !== haqiMineralFrame.contentWindow) return;
    if (message.channel !== HAQI_MINERAL_CHANNEL || message.version !== HAQI_MINERAL_VERSION || message.planetId !== planetId) return;
    if (message.type === 'MINERAL_FRAME_READY') {
        sendHaqiMineralHostReady(planetId);
        return;
    }
    if (message.type === 'REQUEST_ROUTE_PREPARATION') {
        const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
        const requestId = String(payload.requestId || '').trim().slice(0, 80);
        const reply = (ok, error = '') => haqiMineralFrame.contentWindow.postMessage({
            channel: HAQI_MINERAL_CHANNEL, version: HAQI_MINERAL_VERSION, planetId,
            type: 'ROUTE_PREPARATION_RESULT', payload: { requestId, ok, error, preparationCharges: getMineralExplorationBridge(planetId).preparationCharges },
        }, '*');
        const current = getMineralExplorationBridge(planetId);
        const outcome = settleMineralRoutePreparation({
            requestId,
            bridge: current,
            inventory: state.inventory,
            cost: HAQI_MINERAL_PREPARATION_COST,
        });
        if (!outcome.ok) { reply(false, outcome.error); return; }
        if (!outcome.changed) { reply(true); return; }
        Object.assign(state.inventory, outcome.inventory);
        setMineralExplorationBridge(planetId, { ...outcome.bridge, syncedAt: Date.now() });
        saveInventoryDebounced();
        saveUserProfileDebounced();
        reply(true);
        return;
    }
    if (message.type === 'REQUEST_MINERAL_HOST_REWARD') {
        const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
        const requestId = String(payload.requestId || '').trim().slice(0, 80);
        const rewardId = String(payload.rewardId || '').trim();
        const definition = HAQI_MINERAL_HOST_REWARDS[rewardId];
        const reply = (ok, error = '') => haqiMineralFrame.contentWindow.postMessage({
            channel: HAQI_MINERAL_CHANNEL, version: HAQI_MINERAL_VERSION, planetId,
            type: 'MINERAL_HOST_REWARD_RESULT',
            payload: { requestId, rewardId, ok, error, bridge: getMineralExplorationBridge(planetId) },
        }, '*');
        if (!requestId || !/^[a-zA-Z0-9_-]+$/.test(requestId) || !definition) { reply(false, '兑换请求无效'); return; }
        const current = getMineralExplorationBridge(planetId);
        if (current.consumedRequestIds.includes(requestId)) { reply(true); return; }
        const balance = current[definition.group]?.[rewardId] || 0;
        if (balance >= definition.limit) { reply(false, '该物品已达到携带上限'); return; }
        setMineralExplorationBridge(planetId, {
            ...current,
            [definition.group]: { ...current[definition.group], [rewardId]: balance + 1 },
            consumedRequestIds: [...current.consumedRequestIds, requestId],
            syncedAt: Date.now(),
        });
        saveUserProfileDebounced();
        reply(true);
        return;
    }
    if (message.type === 'REQUEST_MINERAL_WORKSHOP_REWARD') {
        const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
        const requestId = String(payload.requestId || '').trim().slice(0, 80);
        const kind = String(payload.kind || '').trim();
        const amount = Math.max(0, Math.floor(Number(payload.amount) || 0));
        const reply = (ok, error = '') => haqiMineralFrame.contentWindow.postMessage({
            channel: HAQI_MINERAL_CHANNEL, version: HAQI_MINERAL_VERSION, planetId,
            type: 'MINERAL_WORKSHOP_REWARD_RESULT', payload: { requestId, ok, error },
        }, '*');
        if (!requestId || !/^[a-zA-Z0-9_-]+$/.test(requestId) || !['refine', 'sell'].includes(kind) || !amount) { reply(false, '工坊请求无效'); return; }
        const current = getMineralExplorationBridge(planetId);
        if (current.consumedRequestIds.includes(requestId)) { reply(true); return; }
        const today = mineralWorkshopDay();
        const workshop = current.workshop?.day === today ? current.workshop : { day:today, refined:0, soldCoins:0 };
        const used = kind === 'refine' ? workshop.refined : workshop.soldCoins;
        if (amount > HAQI_MINERAL_WORKSHOP_LIMITS[kind] - used) { reply(false, '今日工坊额度不足，请明天再来。'); return; }
        if (kind === 'refine') state.inventory.expedition_material_stellarEssence = Math.max(0, Number(state.inventory.expedition_material_stellarEssence) || 0) + amount;
        else addCoins(amount, { source: 'mineral-workshop-sale', category: 'mineral', planetId });
        setMineralExplorationBridge(planetId, {
            ...current,
            workshop: { ...workshop, [kind === 'refine' ? 'refined' : 'soldCoins']: used + amount },
            consumedRequestIds: [...current.consumedRequestIds, requestId], syncedAt: Date.now(),
        });
        saveInventoryDebounced();
        saveUserProfileDebounced();
        reply(true);
        return;
    }
    if (!['BRIDGE_SNAPSHOT', 'DISPATCH_STATUS_SYNC', 'GLOBAL_BONUS_SYNC'].includes(message.type)) return;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    const knownPetIds = new Set(state.petOrder.map(String));
    const current = getMineralExplorationBridge(planetId);
    const merged = mergeMineralBridgeSync({ current, payload, knownPetIds });
    if (!hasMineralBridgeSyncChanges(current, merged)) return;
    const next = { ...merged, syncedAt: Date.now() };
    setMineralExplorationBridge(planetId, next);
    saveUserProfileDebounced();
    if (message.type === 'BRIDGE_SNAPSHOT') showToast('星际矿区状态已同步', 'success', 1600);
});

function renderMinigamesRoute() {
    const pet = getCurrentPet();
    if (!pet) return;
    if (guardSleepingRoute(pet)) return;
    const sharedGame = pendingSharedGame;
    pendingSharedGame = null;
    if (sharedGame) cleanupSharedGameUrl();
    if (sharedGame && !sharedGame.fromUsername) {
        pendingMinigameLaunch = {
            mode: 'shared-official',
            gameId: sharedGame.game,
            allowLowEnergy: true,
        };
    }
    const launch = pendingMinigameLaunch;
    // 新用户分享小游戏落地：点"返回"退出小游戏时才补跑被推迟的命名 / 新手领养流程。
    const deferredNewUser = deferredNewUserSharedGame;
    const returnToCellLevel = () => {
        state.lastHomeZoomLevel = 3;
        navigateToView('home');
    };
    // 领养新手指引退出后落到「星球表面(field)」，让玩家停在自己的星球上（而非宇宙总览）。
    const returnToFieldLevel = () => {
        state.lastHomeZoomLevel = zoomLevelIdToIndex('field');
        navigateToView('home');
    };
    // 退出到「星球」(space) 宇宙总览。
    const returnToPlanetLevel = () => {
        state.lastHomeZoomLevel = zoomLevelIdToIndex('space');
        navigateToView('home');
    };
    const renderOptions = {
        onBeforeExit: () => {
            if (launch?.mode === 'expedition') return window.confirm('离开远征会结束本局，当前星图进度不会保存。确定返回吗？');
            if (launch?.mode === 'dojo') {
                if (!window.confirm('离开道馆会判定本次挑战失败。确定返回吗？')) return false;
                const frame = document.getElementById('mhMinigameFrame');
                frame?.contentWindow?.postMessage({ type: 'requestExpeditionAbandon' }, '*');
                return false;
            }
            return true;
        },
        onBack: () => {
            pendingMinigameLaunch = null;
            if (deferredNewUser) {
                runDeferredNewUserFlow();
                return;
            }
            if (launch?.mode === 'story') {
                handleStoryMinigameExit();
                return;
            }
            if (launch?.mode === 'sickness') {
                returnToCellLevel();
                return;
            }
            if (launch?.mode === 'onboarding') {
                // 从领养新手指引点返回：永远回到「星球」总览（而非 field / 小游戏列表 / 我的）；
                // 仅当玩家已拥有真实(非蛋)宠物时才落到星球表面 field。
                if (hasAdoptedRealPet()) returnToFieldLevel();
                else returnToPlanetLevel();
                return;
            }
            if (launch?.mode === 'adopt') {
                // 玩家中途退出领养仪式：不替换 / 放养当前宠物。
                // 只有小游戏真正发出 gameFinished 后，才会创建新蛋并处理当前宠物。
                navigateToView('home');
                return;
            }
            if (launch?.mode === 'npc') {
                returnToFieldLevel();
                return;
            }
            if (launch?.mode === 'expedition') {
                pendingMinigameLaunch = null;
                showToast('已离开本次远征，当前进度不会保存。', 'info', 2600);
                navigateToView('expeditionMap');
                return;
            }
            if (launch?.mode === 'dojo') {
                pendingMinigameLaunch = null;
                showToast('已离开本次道馆挑战。', 'info', 2200);
                navigateToView('expeditionMap');
                return;
            }
            navigateToView('home');
        },
        onGameFinished: async (game, data) => {
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
            if (launch?.mode === 'expedition') {
                pendingMinigameLaunch = null;
                const onboardingTarget = onboardingExpeditionExitTarget;
                onboardingExpeditionExitTarget = null;
                const runId = String(data?.runId || launch.params?.runId || '');
                const recordFinishedExpedition = (passed, extra = {}) => recordFirstDayEvent(
                    FIRST_DAY_EVENTS.EXPEDITION_FINISHED,
                    firstDayContext({
                        runId,
                        expeditionId: String(launch.params?.expedition?.id || ''),
                        passed,
                        onboardingFirstRun: launch.params?.onboardingFirstRun === true,
                        ...extra,
                    }),
                    { dedupeKey: `expedition-finished:${runId}` },
                );
                if (launch.pluginId !== HAQI_EXPEDITION_PLUGIN.id || !isHaqiExpeditionEnabled(getActivePlanetId())) {
                    navigateToView(onboardingTarget || 'home');
                    return;
                }
                if (launch.params?.confrontationMission) {
                    if (data?.completed !== true || data?.passed !== true || data?.confrontationOutcome?.resolved !== true) {
                        showToast('异变源头探索中断，调查证据仍保留，可再次进入。', 'info', 4200);
                        navigateToView('expeditionMap');
                        return;
                    }
                    const settlement = getHaqiExpeditionSettlement(state.settings);
                    const result = recordExpeditionConfrontationOutcome(settlement, launch, data);
                    if (result.applied) {
                        synchronizeExpeditionSectorEvent(settlement, result.progress, {
                            investigationAdvantage: launch.params.confrontationMission.investigationAdvantage,
                            supportSpecialtyIds: (launch.params.selectedSupportPets || []).map(item => item?.speciesSpecialty?.id),
                            mutationInsights: result.progress.lastOutcome?.mutationInsights,
                        });
                    }
                    saveUserProfileDebounced();
                    showToast(result.applied ? `调查完成：${result.progress.resolution.ecologyChange}` : '异变源头结果未能写入调查档案。', result.applied ? 'success' : 'error', 4200);
                    navigateToView('expeditionMap');
                    return;
                }
                if (launch.params?.sectorFinaleMission) {
                    const settlement = getHaqiExpeditionSettlement(state.settings);
                    const result = resolveSectorEvent(settlement, data?.sectorFinaleOutcome || {});
                    if (result.applied) saveUserProfileDebounced();
                    showToast(result.applied ? `星域归档：${result.progress.resolution.ecologyChange}` : '共同终局尚未完成。', result.applied ? 'success' : 'info', 4200);
                    navigateToView('expeditionMap');
                    return;
                }
                if (data?.completed !== true || data?.passed !== true) {
					recordFinishedExpedition(false, {
                        completed: data?.completed === true,
                        chapter: Number(data?.chapter) || 0,
                        node: Number(data?.node || data?.nodeIndex) || 0,
                        reason: String(data?.reason || data?.status || 'failed'),
                    });
					recordExpeditionOutcome(launch, data);
                    navigateToView(onboardingTarget || 'expeditionMap');
                    return;
                }
                Promise.all([
                    settleExpeditionProgress(launch, data),
                    settleExpeditionCaptures(launch.params?.expedition, data?.captures),
                ]).then(([progress, captures]) => {
                    const settlement = getHaqiExpeditionSettlement(state.settings);
                    if (markDailyExpeditionExplored(settlement, launch.params?.expedition, { planetName: state.planetName || '哈奇星球' })) {
                        saveUserProfileDebounced();
                    }
                    recordExpeditionOutcome(launch, {
                        ...data,
                        captures: captures?.pets?.length ? captures.pets : data?.captures,
                    }, progress);
                    if (progress.applied) {
                        recordFinishedExpedition(true, { completed: true });
						checkOnboardingTask('complete-first-expedition');
                        const materialCount = progress.loot.reduce((sum, entry) => sum + entry.amount, 0);
                        const baseMaterialCount = progress.loot.reduce((sum, entry) => sum + (entry.baseAmount || entry.amount), 0);
                        const bonusMaterialCount = progress.loot.reduce((sum, entry) => sum + (entry.bonusAmount || 0), 0);
                        const treasureName = progress.homeTreasure ? HOME_TREASURE_META[progress.homeTreasure]?.name || '家园宝物' : '';
                        const materialLabel = materialCount ? `，${materialCount} 份材料${bonusMaterialCount ? `（基础 ${baseMaterialCount} + 博物馆 ${bonusMaterialCount}，+${progress.lootBonusPercent}%）` : ''}` : '';
                        showToast(`远征结算：获得 ${progress.experience} 战斗经验${materialLabel}${treasureName ? `，${treasureName}` : ''}`, 'success', 4200);
                    }
                    navigateToView('expeditionMap');
                    if (progress.applied) {
                        const rarePets = (captures?.pets || []).filter(pet => pet.isNewSpecies || pet.qualityId === 'SSR' || pet.qualityId === 'UR');
                        const treasure = progress.homeTreasure ? {
                            id: progress.homeTreasure,
                            ...HOME_TREASURE_META[progress.homeTreasure],
                            firstOwned: progress.homeTreasureFirstOwned,
                        } : null;
                        showRewardOutcomeModal({ treasure, rarePets, series: progress.collectibleSeries || [] }, {
                            treasure: () => {
                                pendingInventoryTreasureFocus = progress.homeTreasure;
                                recordProductEvent('reward_viewed', { source: 'expedition_outcome', rewardType: 'home_treasure', rewardId: progress.homeTreasure });
                                rewardOutcomeReturnTracker.begin(REWARD_OUTCOME_TARGET_VIEWS.treasure);
                                navigateToView(REWARD_OUTCOME_TARGET_VIEWS.treasure);
                            },
                            pets: () => {
                                recordProductEvent('reward_viewed', { source: 'expedition_outcome', rewardType: 'rare_pet', quantity: rarePets.length });
                                rewardOutcomeReturnTracker.begin(REWARD_OUTCOME_TARGET_VIEWS.pets);
                                navigateToView(REWARD_OUTCOME_TARGET_VIEWS.pets);
                            },
                            collection: () => {
                                recordProductEvent('reward_viewed', { source: 'expedition_outcome', rewardType: 'collectible_series', quantity: progress.collectibleSeries.length });
                                rewardOutcomeReturnTracker.begin(REWARD_OUTCOME_TARGET_VIEWS.collection);
                                navigateToView(REWARD_OUTCOME_TARGET_VIEWS.collection);
                                requestAnimationFrame(() => document.getElementById('mhCollectibleSeries')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
                            },
                            share: () => showRewardShareCard({
                                companion: getCurrentPet(),
                                planetName: launch.params?.expedition?.name || launch.params?.expedition?.biome || '未知星域',
                                treasure,
                                rarePets,
                                series: progress.collectibleSeries || [],
                            }, {
                                shared: summary => recordProductEvent(FIRST_DAY_EVENTS.REWARD_SHARE_CARD_GENERATED, {
                                    source: 'expedition_outcome',
                                    rewardType: summary.primaryKind,
                                    highlightCount: summary.highlights.length,
                                }),
                            }),
                        });
                    }
                }).catch(error => {
                    console.error('探险结算失败', error);
                    showToast('探险结算失败，请稍后重试', 'error');
                    navigateToView('expeditionMap');
                });
                return;
            }
            if (launch?.mode === 'dojo') {
                pendingMinigameLaunch = null;
                const settlement = getHaqiExpeditionSettlement(state.settings);
                const result = resolveFriendlyGuardDojoFloor(settlement, {
                    floor: launch.params?.floor,
                    won: data?.completed === true && data?.passed === true,
                    runId: data?.dojoRunId || launch.params?.dojoRunId,
                });
                if (!result.applied) {
                    showToast(result.reason === 'already-resolved' ? '本次道馆结果已经结算。' : '道馆结算未生效，请从星图重新发起。', 'info', 2600);
                    navigateToView('expeditionMap');
                    return;
                }
                if (result.won) {
                    if (result.reward.coins) addCoins(result.reward.coins, { source: 'friendly-guard-dojo', category: 'minigame', planetId: getActivePlanetId() });
                    for (const material of result.reward.materials) {
                        await addToInventory(state.currentPetId, material.id, material.amount, { persist: false });
                    }
                    saveInventoryDebounced();
                    const replayText = result.replay ? '重打奖励减半：' : '首通奖励：';
                    const materialText = result.reward.materials.map(material => `${itemName(material.id) || material.id} ×${material.amount}`).join('、');
                    showToast(`${replayText}${result.reward.coins} 金币${materialText ? `、${materialText}` : ''}`, 'success', 3600);
                } else {
                    showToast(result.consumedToken ? '挑战失败，已消耗 1 张挑战函。' : '道馆挑战失败。', 'info', 3000);
                }
                saveUserProfileDebounced();
                notify();
                navigateToView('expeditionMap');
                return;
            }
            // 领养仪式：onboarding 启动，或小游戏主动回传 autoHatch / setHomePlanet
            // （如 haqi_planet_boarding_haqi 从列表试玩）时，都走孵化并回到 field。
            if (isBoardingGame(game, launch) && (
                launch?.mode === 'onboarding'
                || data?.autoHatch
                || data?.setHomePlanet
            )) {
                handleBoardingOnboardingResult(game, data);
                return;
            }
            if (launch?.mode === 'npc' && data?.completed !== false && data?.passed !== false) {
                const commission = completeNpcCommission(state.settings, launch.npc);
                if (commission.completed) {
                    saveUserProfileDebounced();
                    const completionText = launch.npc?.dailyCommission?.completionText || `${launch.npc?.name || 'NPC'}记住了这次帮助。`;
                    showToast(`${completionText} 关系进度 ${commission.relationship.completedCount}`, 'success', 3200);
                } else if (commission.reason === 'already-completed') {
                    showToast(`今天的「${launch.npc?.dailyCommission?.title || '委托'}」已经完成，可以继续自由游玩。`, 'info', 2600);
                }
            }
            checkOnboardingTask('complete-first-minigame');
            rewardPetAction('play', `${game?.title || '玩耍'}完成啦，亲密度提升！`, data);
        },
        initialGameId: launch?.gameId || null,
        initialGameParams: launch?.params || null,
        // NPC 小游戏可显式覆盖强制横屏（true/false）；未设置时 null，沿用该游戏自身清单配置。
        initialGameLandscape: launch?.mode === 'npc' ? (launch.landscapeOverride ?? null) : null,
        allowPlayWhenLowEnergy: !!launch?.allowLowEnergy || deferredNewUser,
        suppressRewards: !!launch?.suppressRewards,
        showHaqiTownBenefits: getActivePlanetId() === 'haqi' && !launch,
        hideTopbarActions: launch?.mode === 'adopt' || launch?.mode === 'onboarding',
        // 分享小游戏(deferredNewUser)退出时返回小游戏列表(view_minigames)，再从列表返回才回到星球总览；
        // 故这里不让分享小游戏直接 exit-to-back。其余仪式型(onboarding/adopt/...)仍直接退出。
        exitGameToBack: launch?.mode === 'sickness' || launch?.mode === 'story' || launch?.mode === 'adopt' || launch?.mode === 'onboarding' || launch?.mode === 'npc' || launch?.mode === 'expedition',
        deferGameFinishedUntilCompletionExit: launch?.mode === 'story',
        completionPrompt: launch?.mode === 'story' ? {
            title: '小游戏完成啦',
            text: '要继续玩一会儿，还是回到故事？',
            continueText: '继续玩',
            backText: '回到故事',
        } : null,
        onProductEvent: recordProductEvent,
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
        // 用户作品分享仍从作者 workspace 拉取；官方游戏分享通过 initialGameId 直接首屏打开。
        sharedGame: sharedGame?.fromUsername ? sharedGame : null,
        // 外部小游戏深链：?remoteGame=<url> 进入，自动打开该远程地址；
        // NPC 的 minigame 字段若填的是完整 http(s) 地址，同样走这条路径打开。
        remoteGame: (() => {
            if (launch?.mode === 'npc' && launch.remoteUrl) {
                return { url: launch.remoteUrl, title: launch.remoteTitle, icon: launch.remoteIcon, landscape: launch.landscape };
            }
            const remote = pendingRemoteGame;
            pendingRemoteGame = null;
            if (remote) cleanupRemoteGameUrl();
            return remote;
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
        onImproveNannyStat: handleImproveNannyStat,
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
        onLogin:     handleGuestLogin,
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
    const fallbackView = state.currentPetId ? 'home' : 'petList';
    app.innerHTML = `<div class="topbar"><button class="btn-icon" id="mhPetListBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('petList'))}</span><span style="width:36px;height:36px"></span></div><div style="padding:18px;color:var(--text-muted)">${escapeHtml(t('petListLoading'))}</div>`;
    const back = $('mhPetListBack');
    if (back) back.onclick = () => navigateToView(rewardOutcomeReturnTracker.consume('petList', fallbackView));
    if (state.currentView !== 'petList') return;
    const mod = petListViewModule || await loadPetListView();
    if (state.currentView !== 'petList') return;
    mod.renderPetList(app, { pets: (state.petOrder || []).map(id => state.pets[id] || { id, lazyPetRecord: true }) }, {
        onSelect: handleSelectPet,
        onFind:   handleFindPet,
        onDelete: handleDeletePet,
        onResearchRelease: handleResearchRelease,
        onInspectPetStats: () => checkOnboardingTask('inspect-starter-pet'),
        onFirstPetRenamed: () => checkOnboardingTask('rename-first-pet'),
        onBecomeMember: launchKeepworkVipMinigame,
        onBack:   () => navigateToView(rewardOutcomeReturnTracker.consume('petList', fallbackView)),
        onLoadPet: async (id) => {
            if (!id || state.currentView !== 'petList') return null;
            if (state.pets[id]) return state.pets[id];
            try { await loadPet(id); }
            catch (e) { console.warn('加载宠物卡片失败', id, e); }
            return state.pets[id] || null;
        },
    });
    renderOnboardingPanel();
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
        onSelectPet:  handleSelectScenePet,
        onBecomeMember: launchKeepworkVipMinigame,
        onZoomLevelChange: renderOnboardingPanel,
        onSwitchRoom: (id) => { state.currentRoom = id; const p = getCurrentPet(); if (p) p.activeRoom = id; savePetDebounced(p); render(); },
        onToggleDecor: handleToggleDecor,
        onToggleFeed:  handleToggleFeed,
        onPlaceItem:  handlePlaceItem,
        onMoveItem:   handleMoveItem,
        onRemoveItem: handleRemoveItem,
        onFeedItem:   handleFeedItem,
        onFeedComplete: render,
        onNav:        handleNav,
        onCareStat:   handleCareStatShortcut,
        onTendHome:  () => {
            if (isHaqiExpeditionEnabled(getActivePlanetId())) completeDailyReturnRouteStep('tend-home');
        },
		onProductEvent: recordProductEvent,
		canUseHaqiExpedition: () => isHaqiExpeditionEnabled(getActivePlanetId()),
        canUseMineralExploration: () => isMineralExplorationEnabled(getActivePlanetId()),
        onTreatSickness: handleTreatSickness,
        onLaunchNpcMinigame: handleNpcMinigameLaunch,
        onLaunchHelloLearner: handleHelloLearnerLaunch,
        // 「星球→星球表面(field)」缩放过渡前的同步拦截：领养仪式型星球且玩家尚无真实宠物时，
        // 直接弹出领养小游戏并返回 true，view_home 据此取消本次缩放（不进入 field）。
        onPlanetToFieldOnboarding: () => {
            if (!boardingOnboardingPlanet) return false;
            if (boardingOnboardingDisabled()) return false;
            if (hasAdoptedRealPet()) return false;
            maybeStartOnboarding();
            return true;
        },
    };
}

function handleCareStatShortcut(stat, pet) {
    if (!pet || pet.id !== state.currentPetId) return;
    state.zoomLevel = zoomLevelIdToIndex('pet');
    state.lastHomeZoomLevel = state.zoomLevel;
    state.isDecorMode = false;
    if (stat === 'hunger') {
        state.isFeedMode = true;
        setView('home');
        showToast('已打开食物栏，选择食物补充体力。', 'info', 2400);
        return;
    }
    state.isFeedMode = false;
    if (stat === 'clean') {
        setView('home');
        showToast('点击下方“洗澡”提升清洁状态。', 'info', 2400);
        return;
    }
    navigateToView('minigames');
    showToast(stat === 'bond' ? '完成玩耍可提升亲密度。' : '完成玩耍可提升心情。', 'info', 2400);
}
function renderHomeRoute() {
    if (homeViewModule) {
        homeViewModule.renderHome(app, { pet: getCurrentPet() }, homeCallbacks());
        renderOnboardingPanel();
        return;
    }
    app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">' + escapeHtml(t('loading')) + '</div>';
    loadHomeView()
        .then((mod) => {
            if (state.currentView !== 'home') return;
            mod.renderHome(app, { pet: getCurrentPet() }, homeCallbacks());
            renderOnboardingPanel();
        })
        .catch((e) => {
            console.error('加载家园失败', e);
            app.innerHTML = '<div style="padding:24px;color:#b91c1c">' + escapeHtml(t('renderError', { error: (e?.message || e) })) + '</div>';
        });
}

const routes = {
    login:     () => renderLogin(app, null, { onLogin: handleLogin, onOffline: handleOfflineMode, sharedGame: sharedGameLoginContext() }),
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
    inventory: () => {
        const focusTreasureId = pendingInventoryTreasureFocus;
        pendingInventoryTreasureFocus = '';
        renderInventory(app, null, {
        focusTreasureId,
        onBack:  () => navigateToView(rewardOutcomeReturnTracker.consume('inventory', 'home')),
        onUse:   handleUseItem,
        onSell:  handleSell,
        onClaimTreasure: claimHomeTreasureDailyReward,
        onPlaceTreasure: (treasureId) => {
            if (!isHaqiExpeditionEnabled(getActivePlanetId())) {
                showToast('家园珍宝设施仅可在哈奇星球摆放', 'info');
                return;
            }
            recordProductEvent('reward_viewed', {
                source: 'inventory',
                rewardType: 'home_treasure',
                rewardId: treasureId,
                action: 'place',
            });
            state.isDecorMode = true;
            state.isFeedMode = false;
            state.currentRoom = 'field_land';
            setView('home');
            showToast('在下方设施栏选择珍宝后，点击地块即可摆放', 'info', 2200);
        },
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
        });
    },
    chat:      renderChatRoute,
    expeditionMap: renderExpeditionMapRoute,
    haqiMineralExploration: renderHaqiMineralExplorationRoute,
    haqiExplorationArchive: renderHaqiExplorationArchiveRoute,
    minigames: renderMinigamesRoute,
    hatching:  renderHatchingRoute,
    profile:   () => renderProfile(app, { pet: getCurrentPet() }, { onBack: () => navigateToView('home') }),
    help:      () => renderHelp(app, { planetId: getActivePlanetId() }, { onBack: () => navigateToView('home') }),
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
    if (!await requirePlanetPetSpace()) return;
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
    document.title = currentAppTitle();
    const currentView = (sdk.token || state.offlineMode) ? state.currentView : 'login';
    if (state.currentView !== currentView) state.currentView = currentView;
    cleanupLeavingView(currentView);
    homeViewModule?.stopHomeWalk?.();
    const fn = routes[currentView] || routes.login;
    try {
        fn();
        requestAnimationFrame(renderOnboardingPanel);
    } catch (e) { console.error('render 失败', e); app.innerHTML = '<div style="padding:30px;color:#b91c1c">' + escapeHtml(t('renderError', { error: (e?.message || e) })) + '</div>'; }
}
subscribe(render);

function finishBootstrap() {
    isBootstrapping = false;
    if (!firstDaySessionRecorded) {
        firstDaySessionRecorded = true;
        recordFirstDayEvent(FIRST_DAY_EVENTS.SESSION_STARTED, firstDayContext({ landingView: state.currentView }));
    }
    render();
}

async function loadCurrentUser() {
    if (!sdk.token) return null;
    if (typeof sdk.getUserProfile === 'function') return await sdk.getUserProfile();
    if (typeof sdk.getCurrentUser === 'function') return await sdk.getCurrentUser();
    return sdk.user || null;
}

function clearUnauthenticatedSession() {
    resetHomeWelcomeForLogin(state.user, state.offlineMode);
    try {
        if (typeof sdk.setToken === 'function') sdk.setToken(null);
        else sdk.token = null;
    } catch (_) {
        sdk.token = null;
    }
    state.user = null;
    state.offlineMode = false;
}

function currentAppTitle() {
    const settlementTitle = String(state.settings?.starSettlement?.appTitle || '').trim();
    if (settlementTitle) return settlementTitle;
    try {
        const requestedPlanet = String(new URL(window.location.href).searchParams.get('home_planet') || window.__homePlanet || '').trim();
        if (requestedPlanet === HAQI_EXPEDITION_PLUGIN.planetId) return '哈奇星球';
    } catch (_) {}
    return t('appName');
}

// Resolve the boot landing view, honoring a forced `view` URL param / `window.__view`
// global (see config.getForcedView). For the zoom-level views (planet/field/pet/cell)
// we land on `home` and pin the zoom dial; `game` lands on the minigames view.
// Returns the natural fallback view when nothing is forced.
function resolveForcedBootView(fallbackView) {
    const forced = getForcedView();
    if (!forced) return fallbackView;
    if (forced === 'game') return 'minigames';
    if (forced === 'mineral') return 'haqiMineralExploration';
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

// ==== 微信小程序静默登录 ====
// 是否运行在微信小程序 web-view 中（UA 含 miniProgram，或微信注入的环境变量）。
function isWechatMiniProgram() {
    try {
        if (window.__wxjs_environment === 'miniprogram') return true;
        return /miniprogram/i.test(navigator.userAgent || '');
    } catch (_) { return false; }
}

const MP_SILENT_LOGIN_FAILED_KEY = 'mhMpSilentLoginFailed';

// 小程序 web-view 中不展示登录页：直接整页跳转 snsapi_base 静默授权（用户无感，
// 只取 openid，不索取头像昵称），回跳（?code=...&wxauth=1）后由 SDK 的
// whenRedirectLoginSettled 兜底用 code 换 token 完成登录；未绑定账号时 SDK 在小程序内
// 静默注册（自动生成用户名 + 密码，见 SDK 的 silentWechatBind），不弹「设置账号」表单，
// 登录后直接进入主页——小程序内首次进入即索取账号 / 头像昵称属于非必要场景收集用户
// 信息，微信审核不通过。账号可在应用内的设置里再修改。
// 每次全新进入（含手动刷新）都会尝试；仅当「刚从授权回跳回来但仍未登录」
// （探测失败 / 用户放弃绑定）时记录失败并停止自动尝试，本会话内落回登录页，
// 避免「授权 → 回跳失败 → 再授权」的跳转循环（sessionStorage 在同一 web-view
// 会话内跨整页跳转保留；重新进入小程序即重置）。
// 返回 true 表示已发起整页跳转，调用方应维持 Loading 闪屏并中止启动流程。
function maybeStartMiniProgramSilentLogin({ wxRedirectHandled = false } = {}) {
    const log = (msg) => console.info('[MP静默登录] ' + msg);
    if (!isWechatMiniProgram()) return false;
    if (!sdk?.wxAuth?.authorize) { log('跳过：SDK 无 wxAuth.authorize（SDK 版本过旧？）'); return false; }
    // 开发环境：微信授权无法回跳本地地址，跳过
    const host = window.location.hostname;
    if (host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.')) {
        log('跳过：本地开发地址 ' + host + '，微信授权无法回跳');
        return false;
    }
    try {
        if (wxRedirectHandled) {
            // 刚处理完一次授权回跳但仍未登录：本会话不再自动尝试
            sessionStorage.setItem(MP_SILENT_LOGIN_FAILED_KEY, '1');
            log('跳过：授权回跳后仍未登录（探测失败或放弃绑定），本会话停止自动尝试');
            return false;
        }
        if (sessionStorage.getItem(MP_SILENT_LOGIN_FAILED_KEY)) {
            log('跳过：本会话此前静默登录已失败');
            return false;
        }
    } catch (_) { return false; } // sessionStorage 不可用时无法防循环，放弃静默登录
    log('发起 snsapi_base 静默授权跳转');
    sdk.wxAuth.authorize({ scope: 'snsapi_base' });
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

    // 尽早持久化分享小游戏意图：登录 / 注册可能整页跳转（KeepWork OAuth 回跳）并丢失 URL 参数，
    // 先存入 sessionStorage，回跳后即便 URL 已无参数也能恢复并优先进入分享的小游戏。
    persistSharedGameParams(parseSharedGameParamsFromUrl());
    persistWorkBuddyImportParams(parseWorkBuddyImportParamsFromUrl());
    persistLocalExpeditionResetIntent();

    // URL token
    try {
        const url = new URL(window.location.href);
        const tok = url.searchParams.get('token');
        if (tok) sdk.token = tok;
    } catch (_) {}

    // 微信内置浏览器整页授权回跳（?code=...&wxauth=1）：先等 SDK 兜底登录结算，
    // 再决定首屏视图。期间维持 Loading 闪屏，避免「登录页闪现 → 整页刷新 → 登录后页面」
    // 的双跳。无回跳时立即 resolve(false)，正常启动无额外开销。
    // 返回 true 表示识别并处理了一次授权回跳（结合登录态可判断静默登录是否失败）。
    let wxRedirectHandled = false;
    try { wxRedirectHandled = (await sdk.whenRedirectLoginSettled?.()) === true; } catch (_) {}

    // 已有 token 则尝试拉取用户。若 token 失效或取不到用户，仍视为未登录。
    if (sdk.token) {
        try {
            state.user = await loadCurrentUser();
        } catch (_) { state.user = null; }
    }

    if (!sdk.token || !state.user) {
        if (sdk.token && !state.user) clearUnauthenticatedSession();
        // 微信小程序 web-view：跳过登录页，直接静默授权登录（整页跳转，维持闪屏）。
        if (maybeStartMiniProgramSilentLogin({ wxRedirectHandled })) return;
        if (hasGuestSession()) {
            await handleOfflineMode();
            return;
        }
        await applyTemporaryHomePlanetFromUrl();
        finishBootstrap();
        setView('login');
        return;
    }

    // 已登录：提前并行预载家园视图（与网络请求并发），落地 home 时即可直接渲染，避免闪屏。
    const sharedGameAtBoot = parseSharedGameParams();
    if (!sharedGameAtBoot.game) loadHomeView();

    // 已登录：加载数据
    try {
        await loadUserProfile();
        await applySettledOfficialPlanetFromProfile();
        await applyTemporaryHomePlanetFromUrl();
        await resetTodayExpeditionsIfRequested();
        if (sharedGameAtBoot.game) {
            if (state.currentPetId) await loadPet(state.currentPetId);
            pendingSharedGame = sharedGameAtBoot;
            deferredNewUserSharedGame = !state.currentPetId;
            finishBootstrap();
            setView('minigames');
            return;
        }
        await loadAllPets();
        await restoreExpeditionPetArtwork();
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

    // 新用户经别人分享的小游戏链接进入：先直接试玩，命名 / 领养推迟到退出小游戏时。
    // 以"尚无真实(非蛋)宠物"为准：即便存在历史残留的默认蛋，也应优先展示分享的小游戏，而非领养新手指引。
    if (!hasAdoptedRealPet() && await maybeEnterSharedGameForNewUser()) return;

    // 进入游戏前必须先给"星球"命名（每位用户只有一个星球）
    await ensurePlanetNamed();

    if (await maybeImportWorkBuddyGameDraft()) return;

    // 预计算本星球新手指引是否为领养仪式型（供 planet→field 缩放过渡同步拦截）。
    boardingOnboardingPlanet = await isBoardingOnboardingPlanet();

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

function persistLocalExpeditionResetIntent() {
    const url = new URL(window.location.href);
    if (!isLocalDevelopmentHost() || url.searchParams.get('reset_today_expeditions') !== '1') return;
    try { sessionStorage.setItem(LOCAL_EXPEDITION_RESET_INTENT_KEY, '1'); } catch (_) {}
}

function hasLocalExpeditionResetIntent() {
    const url = new URL(window.location.href);
    if (!isLocalDevelopmentHost()) return false;
    if (url.searchParams.get('reset_today_expeditions') === '1') return true;
    try { return sessionStorage.getItem(LOCAL_EXPEDITION_RESET_INTENT_KEY) === '1'; } catch (_) { return false; }
}

async function resetTodayExpeditionsIfRequested() {
    if (!hasLocalExpeditionResetIntent()) return;

    const settlement = getHaqiExpeditionSettlement(state.settings);
    getDailyExpeditionRoster(settlement, { planetName: state.planetName || '哈奇星球' });
    settlement.dailyExpeditionRoster.exploredIds = [];
    await saveUserProfile();

    try { sessionStorage.removeItem(LOCAL_EXPEDITION_RESET_INTENT_KEY); } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_today_expeditions');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    showToast('今日星图探索记录已重置', 'success', 2200);
}

function isLocalDevelopmentHost() {
    return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
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
    try {
        const requestedPlanet = String(new URL(window.location.href).searchParams.get('home_planet') || window.__homePlanet || '').trim();
        if (requestedPlanet) return requestedPlanet;
    } catch (_) {}
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

// 是否跳过"星球诞生"领养引导页：URL 开关之外，微信小程序 web-view 按平台要求
// 也跳过整个引导页（直接走默认蛋流程），其他环境不变。
function boardingOnboardingDisabled() {
    return onboardingDisabledByUrl() || isMiniProgramWebView();
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
// 是否已拥有"真实宠物"（孵化过、非蛋阶段）。领养仪式（boarding 新手指引）以此为准，
// 而不是 onboarding "completed" 标记 —— 保证新用户（只有系统默认蛋 / 无宠物）总能看到领养小游戏，
// 不会因历史残留的 completed 标记而被跳过。
function hasAdoptedRealPet() {
    return Object.values(state.pets || {}).some(p => p && p.stage && p.stage !== 'egg');
}

// 当前星球的新手指引是否为"领养仪式"型（minigames 模式且为 boarding 小游戏）。
async function isBoardingOnboardingPlanet() {
    try {
        if (boardingOnboardingDisabled()) return false;
        const config = await getPlanetOnboardingConfig(getActivePlanetId());
        if (!config || config.mode !== 'minigames') return false;
        const gameId = resolveOnboardingMinigameId(config.minigame);
        return !!gameId && isBoardingGame({ id: gameId });
    } catch (_) { return false; }
}

async function maybeStartOnboarding() {
    if (onboardingDisabledByUrl()) return false;
    const planetId = getActivePlanetId();
    let config;
    try {
        config = await getPlanetOnboardingConfig(planetId);
    } catch (_) { return false; }
    if (!config || config.mode === 'none') return false;
    const progressKey = config.progressKey || planetId;

    if (config.mode === 'pet-story') {
        let completed = false;
        try { completed = await isOnboardingCompleted(progressKey); } catch (_) { completed = false; }
        if (completed) return false;
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
        const boarding = isBoardingGame({ id: gameId });
        if (boarding) {
            // 微信小程序环境跳过整个领养引导页，落到默认蛋流程。
            if (boardingOnboardingDisabled()) return false;
            // 领养仪式：只要还没有真实宠物就触发（不看 completed 标记）。
            if (hasAdoptedRealPet()) return false;
            // 没有当前宠物时先创建一颗默认蛋作为 iframe 上下文。
            if (!getCurrentPet()) await prepareDefaultEggHome();
        } else {
            // 其它 minigame 型新手指引：仍以 completed 标记为准，且需要已有宠物。
            let completed = false;
            try { completed = await isOnboardingCompleted(progressKey); } catch (_) { completed = false; }
            if (completed) return false;
            if (!getCurrentPet()) return false;
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

// 新用户通过别人分享的小游戏链接（?gameFrom=&game=）登录后：直接进入分享的小游戏试玩，
// 暂不触发星球命名 / 新手领养仪式。静默创建一颗默认蛋仅作为小游戏 iframe 的上下文，
// 真正的命名 / 领养在玩家点"返回"退出小游戏时（runDeferredNewUserFlow）才发生。
async function maybeEnterSharedGameForNewUser() {
    const shared = parseSharedGameParams();
    // 用户作品分享带 gameFrom+game；官方游戏分享只带 game（按 id 打开）。两者都视为分享进入，
    // 都应优先于领养新手指引展示分享的小游戏，故这里只需 game 即可。
    if (!shared.game) return false;
    await prepareDefaultEggHome();
    pendingSharedGame = shared;
    deferredNewUserSharedGame = true;
    finishBootstrap();
    setView('minigames');
    return true;
}

// 退出分享小游戏后，补跑被推迟的新用户流程（星球命名 → 新手故事 / 领养仪式 → 默认蛋家园）。
async function runDeferredNewUserFlow() {
    deferredNewUserSharedGame = false;
    await ensurePlanetNamed();
    boardingOnboardingPlanet = await isBoardingOnboardingPlanet();
    if (await maybeStartNewUserStory()) return;
    // 分享小游戏退出后：领养仪式型星球先回到「星球」(space) 总览，等玩家进入星球表面(field)时再弹
    // 领养小游戏（见 onPlanetToFieldOnboarding）；非领养型保持原有"立即新手指引 / 默认蛋"流程。
    if (boardingOnboardingPlanet && !hasAdoptedRealPet()) {
        await prepareDefaultEggHome();
        state.lastHomeZoomLevel = zoomLevelIdToIndex('space');
        finishBootstrap();
        setView('home');
        return;
    }
    if (await maybeStartOnboarding()) return;
    await enterDefaultEggHome();
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
    if (!systemHatchTarget && !options.breeding && territory?.fieldId) dna = biasDnaForFieldId(dna, resolveTerrainFieldTypeId(territory.fieldId));
    const traits = systemHatchTarget?.traits || decodeDna(dna);
    const trueName = systemHatchTarget?.name || dnaToName(dna);
    const embryo = options.embryo && typeof options.embryo === 'object' ? options.embryo : null;
    const qualityId = String(embryo?.qualityId || '').toUpperCase();
    const quality = qualityId ? window.MHPetQuality?.snapshot(qualityId) || null : null;
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
        ...(embryo ? {
            qualityId: qualityId || 'N',
            quality,
            ivs: embryo.ivs,
            growthMultiplier: embryo.growthMultiplier,
            baseBattleMultiplier: embryo.baseBattleMultiplier,
            mutation: embryo.mutation,
            breeding: {
                geneticDna: embryo.dna,
                createdAt: now,
                lineage: Array.isArray(options.lineage) ? options.lineage : null,
            },
        } : {}),
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

async function requirePlanetPetSpace() {
    const limit = getPlanetPetLimit();
    const pets = await loadOrderedPets();
    const count = localPlanetPets(pets).length;
    if (count < limit) return true;
    showToast(`星球容量已满（${count}/${limit}）。请先到伙伴图鉴放养宠物，或一键研究放归重复 N / R 伙伴。`, 'error', 4200);
    return false;
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

const RANDOM_PLANET_NAMES = [
    '奇奇星', '蛋蛋星', '梦幻星', '彩虹星', '糖糖星', '棉花星', '泡泡星',
    '星语星', '月光星', '云朵星', '布丁星', '柠檬星', '草莓星', '蘑菇星',
    '萌萌星', '哈奇星', '果冻星', '雪花星', '繁星岛', '银河小镇',
];

// 强制弹出命名框，直到玩家给出非空名称（不可关闭）。
// 微信小程序 web-view 中不弹框，直接随机生成一个名字。
async function ensurePlanetNamed() {
    if (!state.planetCreatedAt) state.planetCreatedAt = Date.now();
    if (state.planetName && state.planetName.trim()) return;
    let name = '';

    if (isWechatMiniProgram()) {
        name = RANDOM_PLANET_NAMES[Math.floor(Math.random() * RANDOM_PLANET_NAMES.length)];
    }
    while (!name) {
        name = await prompt('为你的宠物星球起名', {
            hint: '每位玩家只有一个星球，名字会一直伴随你的游戏旅程～',
            placeholder: '例如：奇奇星',
            okText: '建立星球',
            randomText: '🎲 随机',
            maxLength: 12,
            dismissable: false,
            randomValues: RANDOM_PLANET_NAMES,
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
        await sdk.showLoginWindow({
            title: `${currentAppTitle()} 登录`,
            wechatScope: 'snsapi_base',
        });
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
        try { await loadUserProfile(); await applySettledOfficialPlanetFromProfile(); await applyTemporaryHomePlanetFromUrl(); await resetTodayExpeditionsIfRequested(); await loadAllPets(); } catch (e) { console.warn(e); }
        ensurePlanetProgressStarted();
        startPlanetPlaytimePersistence();
        for (const id of Object.keys(state.pets)) {
            const pet = state.pets[id];
            tickOffline(pet);
            if (maybeRollDailySickness(pet)) savePetDebounced(pet);
        }
        startTickLoop();
        // 新用户经别人分享的小游戏链接登录：先直接试玩，命名 / 领养推迟到退出小游戏时。
        // 以"尚无真实(非蛋)宠物"为准，避免历史残留默认蛋导致优先弹领养新手指引而非分享小游戏。
        if (!hasAdoptedRealPet() && await maybeEnterSharedGameForNewUser()) return;
        await ensurePlanetNamed();
        // 预计算本星球新手指引是否为领养仪式型（供 planet→field 缩放过渡同步拦截）。
        boardingOnboardingPlanet = await isBoardingOnboardingPlanet();
        if (await enterForcedViewIfAny()) return;
        if (!hasSelectablePets()) {
            if (await maybeStartNewUserStory()) return;
            // 新登录无宠物：与刷新(bootstrap)路径一致，触发领养新手指引。
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
            setView('storyPlayer');
            return;
        }
        await enforcePlanetPetLimit(state.currentPetId);
        if (state.currentPetId) {
            try { await ensurePetData(state.currentPetId); } catch (_) {}
        }
        preloadLoadedPetAssets();
        // 已有宠物（含仅默认蛋）：与刷新路径一致，按需触发领养新手指引（无真实宠物时）。
        if (await maybeStartOnboarding()) return;
        setView(resolveLandingView());
    }
}

// 游客模式下从设置页发起登录：跳到登录页（含隐私协议勾选行），由用户主动勾选并
// 登录，保证登录前完成协议同意；游客也可在登录页再次选择游客体验返回。
function handleGuestLogin() {
    setGuestSessionActive(false);
    setView('login');
}

async function handleOfflineMode() {
    try {
        state.offlineMode = true;
        state.user = { id: 'offline', username: 'offline', name: 'Offline', offline: true };
        setGuestSessionActive(true);
        await loadUserProfile();
        await applyTemporaryHomePlanetFromUrl();
        await resetTodayExpeditionsIfRequested();
        await loadAllPets();
        for (const id of Object.keys(state.pets)) {
            const pet = state.pets[id];
            tickOffline(pet);
            if (maybeRollDailySickness(pet)) savePetDebounced(pet);
        }
        startTickLoop();
        // 游客经分享链接进入：与登录路径一致，先直接试玩分享的小游戏（合规：分享
        // 落地不强制登录），命名 / 领养推迟到退出小游戏时。
        if (!hasAdoptedRealPet() && await maybeEnterSharedGameForNewUser()) return;
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
        setGuestSessionActive(false);
        state.offlineMode = false;
        state.user = null;
        showToast('离线模式启动失败：' + (e?.message || e), 'error');
        setView('login');
    }
}

function handleLogout() {
    resetHomeWelcomeForLogin(state.user, state.offlineMode);
    try { sdk.logout?.(); } catch (_) {}
    setGuestSessionActive(false);
    sdk.token = null;
    state.user = null;
    state.offlineMode = false;
    // 清掉地址栏可能残留的第三方登录回跳参数（微信 / Google 的一次性 code 等）。
    // 否则重新登录时，SDK 会把这个已失效的 code 再次拿去探测，被后端拒绝后
    // 误报「微信未绑定账号，请先完成注册」。退出不刷新页面，故只需就地清掉 URL。
    try {
        const url = new URL(window.location.href);
        let changed = false;
        ['code', 'state', 'wxauth', 'googleauth', 'scope', 'authuser', 'prompt', 'error'].forEach((k) => {
            if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
        });
        if (changed && window.history?.replaceState) {
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
    } catch (_) {}
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
        boardingOnboardingPlanet = await isBoardingOnboardingPlanet();
        if (await maybeStartNewUserStory()) return;
        if (await maybeStartOnboarding()) return;
        await enterDefaultEggHome();
    } catch (e) {
        showToast('清除失败：' + (e?.message || e), 'error');
    }
}

async function handleSelectPet(id) {
    const target = state.pets[id];
    if (!target) return;
    if (!isPetSelectable(target)) {
        // 会员可召回放养在当前星球表面的宠物；非会员 / 哈奇岛 / 其它星球仍不可召回。
        if (state.isPaid && canVipRecallPet(target)) {
            markPetRecalled(target);
            try { await savePet(target); } catch (_) { savePetDebounced(target); }
            showToast(t('vipRecallPet', { name: target.name || '宠物' }), 'success', 1600);
        } else {
            const info = getPetLocationInfo(target, state.planetName || '宠物星');
            if (!state.isPaid && canVipRecallPet(target)) {
                showToast(t('vipRecallLocked', { name: target.name || '宠物', place: info.label }), 'info', 2400);
            } else {
                showToast(`${target.name || '这只宠物'} 现在在 ${info.label}，不能召回。`, 'info', 2200);
            }
            return;
        }
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

/** 在家园场景切换当前伙伴；放养伙伴仍仅限会员召回。 */
async function handleSelectScenePet(id, options = {}) {
    const target = state.pets[id];
    if (!target) return false;
    if (!isPetSelectable(target)) {
        if (state.isPaid && canVipRecallPet(target)) {
            markPetRecalled(target);
            try { await savePet(target); } catch (_) { savePetDebounced(target); }
        } else {
            const info = getPetLocationInfo(target, state.planetName || '宠物星');
            showToast(`${target.name || '这只宠物'} 现在在 ${info.label}，不能召回。`, 'info', 2200);
            return false;
        }
    }
    if (id === state.currentPetId) return true;
    const zoomLevel = options.zoomLevel === 2 ? 2 : 1;
    state.zoomLevel = zoomLevel;
    state.lastHomeZoomLevel = zoomLevel;
    if (zoomLevel === 2) target.activeRoom = state.currentRoom || target.activeRoom || 'living';
    state.activePetFieldPose = null;
    state.activePetRoomPose = null;
    state.activePetRoomFocusPose = null;
    state.isDecorMode = false;
    state.isFeedMode = false;
    setCurrentPet(id);
    setCurrentPetPersisted(id).catch(()=>{});
    try { await ensurePetData(id); } catch (_) {}
    try { preloadPetAssets(state.pets[id], { includeAll: false }); } catch (_) {}
    notify();
    showToast(`现在照料 ${target.name || '这只伙伴'}`, 'success', 1200);
    return true;
}

/** 打开 KeepWork 会员介绍小游戏（haqi_keepwork_vip）。 */
function launchKeepworkVipMinigame() {
    pendingMinigameLaunch = {
        mode: 'npc',
        gameId: 'keepwork_vip',
        allowLowEnergy: true,
        suppressRewards: true,
    };
    navigateToView('minigames', { preserveMinigameLaunch: true });
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
    addCoins(-cost, { source: 'nanny-care', category: 'care', planetId: getActivePlanetId() });
    pet.lastTickAt = Date.now();
    hireNannyForPet(pet, days, pet.lastTickAt);
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    await savePet(pet);
    await saveUserProfile();
    showToast(`已支付 ${cost} 金币，保姆会照看 ${Math.max(1, Math.round(Number(days) || 1))} 天。`, 'success', 2400);
    notify();
}

function handleImproveNannyStat(type, pet) {
    if (!pet || pet.id !== state.currentPetId) return;
    let target = type;
    if (type === 'average') {
        const stats = pet.stats || {};
        target = ['hunger', 'mood', 'clean', 'bond']
            .reduce((lowest, key) => (Number(stats[key]) || 0) < (Number(stats[lowest]) || 0) ? key : lowest, 'hunger');
    }
    state.zoomLevel = zoomLevelIdToIndex('pet');
    state.lastHomeZoomLevel = state.zoomLevel;
    state.isDecorMode = false;
    if (target === 'hunger') {
        state.isFeedMode = true;
        setView('home');
        showToast('已打开食物栏，选择食物补充体力。', 'info', 2600);
        return;
    }
    state.isFeedMode = false;
    if (target === 'mood' || target === 'bond') {
        navigateToView('minigames');
        showToast('完成一次玩耍即可提升心情和亲密度。', 'info', 2800);
        return;
    }
    setView('home');
    showToast('已回到宠物照料页，点击“洗澡”提升清洁状态。', 'info', 2800);
}

async function handleAdoptEgg(pet) {
    if (!await requirePlanetPetSpace()) return;
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
    if (!await requirePlanetPetSpace()) {
        setView('hatching');
        return;
    }
    // 孵化后 setCurrentPet / setView 会重渲 field：请求对准主宠，避免沿用旧场景平移。
    const requestCenter = async () => {
        try {
            const { requestCenterFieldPetOnEnter } = await import('./level_field.js');
            requestCenterFieldPetOnEnter();
        } catch (_) {}
    };
    await requestCenter();
    const pet = await hatchPetFromBoarding(data || {}, { stage, planetName: state.planetName || '宠物星' });
    try { await ensurePetData(pet.id); } catch (_) {}
    state.currentRoom = pet.activeRoom || 'living';
    state.isDecorMode = false;
    state.isFeedMode = false;
    state.activePetFieldPose = null;
    state.activePetRoomPose = null;
    state.activePetRoomFocusPose = null;
    const exiled = await enforcePlanetPetLimit(pet.id);
    const exileText = exiled.length ? ` ${exiled.map(item => `${item.pet.name || '一只宠物'}去了${item.location.name}`).join('，')}。` : '';
    showToast(stage === 'egg' ? `已领养新的蛋。${exileText}` : `${pet.name || '新宠物'} 已在星球上孵化。${exileText}`, exiled.length ? 'info' : 'success', exiled.length ? 3600 : 2200);
    // hatch 过程中的 notify 可能已消费过一次对准请求，最终回 field 前再请求一次。
    await requestCenter();
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
    // 领养仪式完成：立刻回到 field，避免等孵化/定居时 iframe 一直停在终局画面。
    state.lastHomeZoomLevel = zoomLevelIdToIndex('field');
    state.activePetFieldPose = null;
    state.activePetRoomPose = null;
    state.activePetRoomFocusPose = null;
    setView('home');
    const selectedPetId = String(data?.petId || '').replace(/^famous-pets\//, '').trim();
    const alreadyOwned = selectedPetId && Object.values(state.pets || {}).some(pet => {
        const sourcePetId = String(pet?.sourcePetId || '').replace(/^famous-pets\//, '').trim();
        return sourcePetId === selectedPetId;
    });
    if (data?.autoHatch && alreadyOwned) {
        showToast('这只抱抱龙已经在哈奇星球了。', 'info');
        try {
            const { requestCenterFieldPetOnEnter } = await import('./level_field.js');
            requestCenterFieldPetOnEnter();
            notify();
        } catch (_) {}
        return;
    }
    try {
        await finishBoardingHatch(data || {}, { stage: 'baby' });
    } catch (e) {
        console.error('领养仪式孵化失败', e);
        showToast('孵化失败：' + (e?.message || e), 'error');
    }
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

async function handleResearchRelease() {
    const pets = state.petOrder.map(id => state.pets[id]).filter(Boolean);
    const candidates = getResearchReleaseCandidates(pets, {
        currentPetId: state.currentPetId,
        dispatchedPetIds: getActiveMineralBridge().dispatchedPetIds,
    });
    if (!candidates.length) {
        showToast('没有可研究放归的重复 N / R 宠物。', 'info', 1800);
        return;
    }
    const rewards = calculateResearchReleaseRewards(candidates);
    const materialText = Object.entries(rewards.materials)
        .map(([id, amount]) => `${RESEARCH_RELEASE_MATERIAL_NAMES[id] || id} ×${amount}`)
        .join('、');
    const ok = await confirm(`将永久研究放归 ${candidates.length} 只重复伙伴，获得 ${rewards.coins} 金币${materialText ? `、${materialText}` : ''}。当前伙伴、锁定伙伴和勘探中的伙伴不会被处理。`, {
        okText: '确认研究放归',
        cancelText: '取消',
    });
    if (!ok) return;

    for (const pet of candidates) await deletePet(pet.id);
    addCoins(rewards.coins, { source: 'research-release', category: 'pet', planetId: getActivePlanetId() });
    for (const [materialId, amount] of Object.entries(rewards.materials)) {
        const inventoryId = `expedition_material_${materialId}`;
        state.inventory[inventoryId] = Math.max(0, Number(state.inventory[inventoryId]) || 0) + amount;
        if (!state.inventoryOrder.includes(inventoryId)) state.inventoryOrder.push(inventoryId);
    }
    saveInventoryDebounced();
    saveUserProfileDebounced();
    notify();
    showToast(`已研究放归 ${candidates.length} 只重复伙伴，获得 ${rewards.coins} 金币${materialText ? `和${materialText}` : ''}`, 'success', 2600);
}

async function handleStartBreed() {
    const currentPet = getCurrentPet();
    if (currentPet && isPetInteractionBlocked(currentPet)) { showToast(sleepingInteractionText(currentPet), 'info', 1800); return; }
    if (!await requirePlanetPetSpace()) return;
    const adults = state.petOrder.map(id => state.pets[id]).filter(p => p && isPetOnCurrentPlanet(p) && CONFIG.breedableStages.includes(p.stage) && !isPetDispatching(p.id, getActivePlanetId()));
    const eligibleParents = adults.filter(parent => adults.some(other => other !== parent && canBreed(parent, other)));
    if (eligibleParents.length < 2) {
        showToast('需要两只未锁定、当前星球的成年宠物且永久战斗达到 LV.40', 'info', 2600);
        return;
    }
    showBreedParentPicker(eligibleParents);
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
        .mh-breed-preview { display:grid; gap:9px; padding:10px; border:1px solid #bae6fd; border-radius:12px; background:#f0f9ff; color:var(--text-secondary); }
        .mh-breed-preview-empty { color:var(--text-muted); font-size:12px; font-weight:800; line-height:1.45; }
        .mh-breed-preview-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .mh-breed-preview-head strong { color:var(--text-primary); font-size:13px; }
        .mh-breed-preview-grade { flex:0 0 auto; padding:3px 6px; border-radius:999px; background:#e0f2fe; color:#0e7490; font-size:10px; font-weight:900; }
        .mh-breed-preview-grade.is-stable { background:#dcfce7; color:#15803d; }
        .mh-breed-preview-grade.is-complementary { background:#f3e8ff; color:#7e22ce; }
        .mh-breed-preview-module { display:grid; gap:6px; padding-top:9px; border-top:1px solid rgba(14,165,233,.18); }
        .mh-breed-preview-module-title { color:var(--text-muted); font-size:10px; font-weight:900; }
        .mh-breed-iv-grid { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:5px; }
        .mh-breed-iv-item { min-width:0; display:grid; gap:2px; padding:6px 3px; border:1px solid #bae6fd; border-radius:7px; background:#fff; text-align:center; }
        .mh-breed-iv-item span { overflow:hidden; color:var(--text-muted); font-size:9px; font-weight:800; text-overflow:ellipsis; white-space:nowrap; }
        .mh-breed-iv-item b { color:var(--text-primary); font-size:10px; font-variant-numeric:tabular-nums; }
        .mh-breed-mutation-alert { display:flex; align-items:center; gap:7px; padding:8px; border:1px solid #f59e0b; border-radius:8px; background:#fffbeb; color:#92400e; font-size:11px; font-weight:900; line-height:1.35; }
        .mh-breed-mutation-alert span { width:22px; height:22px; flex:0 0 auto; display:grid; place-items:center; border-radius:6px; background:#fef3c7; color:#b45309; font-size:14px; }
        .mh-breed-advice { margin:0; color:var(--text-secondary); font-size:11px; font-weight:800; line-height:1.45; }
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
        @media (max-width:420px) { .mh-breed-modal { gap:12px; } .mh-breed-preview { padding:9px; } .mh-breed-iv-grid { grid-template-columns:repeat(3, minmax(0, 1fr)); } .mh-breed-iv-item { padding:6px 4px; } }
    `;
    document.head.appendChild(style);
}

function breedPetIconHtml(pet) {
    return `<span class="mh-breed-pet-icon">${petArtHtml(pet, { alt: pet.name || '' })}</span>`;
}

const BREED_IV_LABELS = Object.freeze({ life: '生命', attack: '攻击', defense: '防御', speed: '速度', magic: '魔法' });

function breedBloodlineLabel(pet) {
    const dna = decodeDna(pet?.dna || '');
    return dna?.element || dna?.attribute || '未显现';
}

function breedSpecialty(pet) {
    const values = Object.entries(BREED_IV_LABELS).map(([key, label]) => [
        label,
        Math.max(0, Math.min(100, Number(pet?.ivs?.[key] ?? pet?.iv?.[key] ?? pet?.breeding?.ivs?.[key] ?? 50) || 0)),
    ]);
    values.sort((left, right) => right[1] - left[1]);
    return values[0];
}

function breedParentSnapshot(pet) {
    const [specialty, specialtyValue] = breedSpecialty(pet);
    return {
        id: pet.id || null,
        name: pet.name || dnaToName(pet.dna || '') || '哈奇伙伴',
        qualityId: pet?.quality?.id || pet?.qualityId || 'N',
        stage: pet.stage || 'adult',
        bloodline: breedBloodlineLabel(pet),
        specialty,
        specialtyValue,
    };
}

function breedPairSuggestion(parentA, parentB, preview) {
    const [firstLabel, firstValue] = breedSpecialty(parentA);
    const [secondLabel, secondValue] = breedSpecialty(parentB);
    const direction = firstLabel === secondLabel
        ? `双亲都偏向${firstLabel}，适合稳定培养该属性。`
        : `双亲分别偏向${firstLabel}与${secondLabel}，属于互补组合。`;
    const quality = preview.urMutationChance
        ? 'SSR × SSR 组合可尝试冲击 UR 突变。'
        : '优先保留高品质亲代，提高正常品质上限。';
    return `亲代侧重：${firstLabel} ${firstValue} / ${secondLabel} ${secondValue}。${direction}${quality}`;
}

function breedPreviewHtml(parentA, parentB, preview) {
    const [firstLabel, firstValue] = breedSpecialty(parentA);
    const [secondLabel, secondValue] = breedSpecialty(parentB);
    const isStable = firstLabel === secondLabel;
    const grade = isStable ? '同向稳定' : '属性互补';
    const gradeClass = isStable ? 'is-stable' : 'is-complementary';
    const ivItems = IV_KEYS.map(key => {
        const range = preview.ivRanges[key];
        return `<div class="mh-breed-iv-item"><span>${escapeHtml(BREED_IV_LABELS[key])}</span><b>${range.min}-${range.max}</b></div>`;
    }).join('');
    const mutationModule = preview.urMutationChance
        ? `<div class="mh-breed-preview-module"><span class="mh-breed-preview-module-title">突变监测</span><div class="mh-breed-mutation-alert"><span>✦</span>监测到 ${Math.round(preview.urMutationChance * 100)}% UR 基因突变概率！</div></div>`
        : '';
    return `<div class="mh-breed-preview-head"><strong>繁育预估</strong><span class="mh-breed-preview-grade ${gradeClass}">${grade}</span></div>
        <div class="mh-breed-preview-module"><span class="mh-breed-preview-module-title">资质区间预测 · 品质上限 ${escapeHtml(preview.qualityId)} · 成长 ×${preview.growthMultiplier.min}-${preview.growthMultiplier.max}</span><div class="mh-breed-iv-grid">${ivItems}</div></div>
        ${mutationModule}
        <div class="mh-breed-preview-module"><span class="mh-breed-preview-module-title">繁育评级 / 建议</span><p class="mh-breed-advice">双亲最高资质为 ${escapeHtml(firstLabel)} ${firstValue} 与 ${escapeHtml(secondLabel)} ${secondValue}。${escapeHtml(breedPairSuggestion(parentA, parentB, preview))}</p></div>`;
}

function showBreedParentPicker(adults) {
    const modalName = 'breed-parent-picker';
    if (!acquireActiveModal(modalName)) {
        showToast('请先完成当前操作。', 'info', 1600);
        return;
    }
    ensureBreedPickerStyles();
    const selected = [null, null];
    const noticeMessages = [];
    const hasEnoughAdults = adults.length >= 2;
    const canAffordBreed = state.coins >= CONFIG.breedCost;
    const catalystBalance = getActiveMineralBridge().breedingCatalysts;
    let selectedCatalystType = 'none';
    let selectedCatalystAttribute = IV_KEYS[0];
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
                        <span class="mh-breed-pet-stage">${escapeHtml(getStageName(pet.stage, '成年'))} · ${escapeHtml(pet?.quality?.id || pet?.qualityId || 'N')}</span>
                        <span class="mh-breed-pet-stage">血统：${escapeHtml(breedBloodlineLabel(pet))}</span>
                    </button>`).join('')}
            </div>
            <div class="mh-breed-slots">
                <div class="mh-breed-slot" data-breed-slot="0" title="拖入第一只宠物"></div>
                <div class="mh-breed-slot-plus">+</div>
                <div class="mh-breed-slot" data-breed-slot="1" title="拖入第二只宠物"></div>
            </div>
            <div class="mh-breed-preview-module" data-breed-catalyst>
                <span class="mh-breed-preview-module-title">矿区催化剂（确认繁育时消耗）</span>
                <select data-breed-catalyst-type>
                    <option value="none">不使用催化剂</option>
                    ${catalystBalance.ssrMutation ? `<option value="ssrMutation">SSR 突变催化剂 ×${catalystBalance.ssrMutation}</option>` : ''}
                    ${catalystBalance.urAttributeLock ? `<option value="urAttributeLock">UR 属性锁定剂 ×${catalystBalance.urAttributeLock}</option>` : ''}
                </select>
                <select data-breed-catalyst-attribute hidden>${IV_KEYS.map(key => `<option value="${key}">${escapeHtml(BREED_IV_LABELS[key])}</option>`).join('')}</select>
            </div>
            <div class="mh-breed-preview" data-breed-preview><div class="mh-breed-preview-empty">选择两位亲代后，可查看子代资质范围。</div></div>
            <div class="mh-breed-actions">
                <button class="btn-secondary" data-breed-cancel>取消</button>
                <button class="btn-primary" data-breed-ok disabled>确定</button>
            </div>
        </div>`;

    const close = () => { pointerDragPet?.ghost?.remove(); mask.remove(); releaseActiveModal(modalName); };
    const selectedCatalyst = () => selectedCatalystType === 'urAttributeLock'
        ? { type: selectedCatalystType, attribute: selectedCatalystAttribute }
        : selectedCatalystType === 'ssrMutation' ? { type: selectedCatalystType } : null;
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
        const attributeSelect = mask.querySelector('[data-breed-catalyst-attribute]');
        if (attributeSelect) attributeSelect.hidden = selectedCatalystType !== 'urAttributeLock';
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
        const previewNode = mask.querySelector('[data-breed-preview]');
        if (previewNode) {
            if (!selected[0] || !selected[1]) {
                previewNode.innerHTML = '<div class="mh-breed-preview-empty">选择两位亲代后，可查看子代资质范围。</div>';
            } else {
                const preview = previewChildPotential(selected[0], selected[1], { catalyst: selectedCatalyst() });
                previewNode.innerHTML = `${breedPreviewHtml(selected[0], selected[1], preview)}${preview.hint ? `<p class="mh-breed-advice">${escapeHtml(preview.hint)}</p>` : ''}`;
                previewNode.classList.toggle('is-error', !preview.eligible);
            }
        }
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
        const catalystType = e.target.closest('[data-breed-catalyst-type]');
        if (catalystType) { selectedCatalystType = catalystType.value; renderSlots(); return; }
        const catalystAttribute = e.target.closest('[data-breed-catalyst-attribute]');
        if (catalystAttribute) { selectedCatalystAttribute = catalystAttribute.value; renderSlots(); return; }
        const petBtn = e.target.closest('[data-breed-pet]');
        if (petBtn) { assignPet(petBtn.dataset.breedPet); return; }
        const slot = e.target.closest('[data-breed-slot]');
        if (slot && selected[Number(slot.dataset.breedSlot) || 0]) { selected[Number(slot.dataset.breedSlot) || 0] = null; renderSlots(); return; }
        if (e.target.closest('[data-breed-ok]')) {
            if (!selected[0] || !selected[1]) return;
            await completeBreedWithParents(selected[0], selected[1], close, selectedCatalyst());
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

async function completeBreedWithParents(parentA, parentB, closePicker, catalyst = null) {
    if (!parentA || !parentB || parentA.id === parentB.id) return;
    if (state.coins < CONFIG.breedCost) return;
    if (isPetDispatching(parentA.id, getActivePlanetId()) || isPetDispatching(parentB.id, getActivePlanetId())) {
        showToast('勘探中的伙伴暂时无法参与繁育。', 'info', 2200);
        return;
    }
    if (!canBreed(parentA, parentB)) {
        showToast('父母需为未锁定的成年宠物，且永久战斗均达到 LV.40', 'info', 2400);
        return;
    }
    if (!await requirePlanetPetSpace()) return;
    const catalystKey = catalyst?.type === 'ssrMutation' ? 'ssrMutation'
        : catalyst?.type === 'urAttributeLock' && IV_KEYS.includes(catalyst.attribute) ? 'urAttributeLock' : null;
    const bridge = getActiveMineralBridge();
    if (catalystKey && bridge.breedingCatalysts[catalystKey] <= 0) {
        showToast('该催化剂已被其他操作消耗，请重新选择。', 'info', 2200);
        return;
    }
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
    const embryo = generateChildEmbryo(parentA, parentB, { catalyst: catalystKey ? catalyst : null });
    if (catalystKey) {
        setActiveMineralBridge({
            ...bridge,
            breedingCatalysts: { ...bridge.breedingCatalysts, [catalystKey]: bridge.breedingCatalysts[catalystKey] - 1 },
            syncedAt: Date.now(),
        });
        saveUserProfileDebounced();
    }
    closePicker?.();
    await showBreedCountdown();
    const newPet = await createNewEgg({
        dna: embryo.dna,
        parents: [parentA.id, parentB.id],
        embryo,
        lineage: [breedParentSnapshot(parentA), breedParentSnapshot(parentB)],
        breeding: true,
        useSystemPet: false,
    });
    addCoins(-CONFIG.breedCost, { source: 'pet-breeding', category: 'pet', planetId: getActivePlanetId() });
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
    if (cfg.costCoins) { addCoins(-cfg.costCoins, { source: `pet-action-${key}`, category: 'care', planetId: getActivePlanetId() }); saveUserProfileDebounced(); }
    if (cfg.rewardCoins) { addCoins(cfg.rewardCoins, { source: `pet-action-${key}`, category: 'care', planetId: getActivePlanetId() }); saveUserProfileDebounced(); showToast(`+${cfg.rewardCoins} 🪙`, 'success', 1200); }
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
    completeDailyReturnRouteStep('care-pet');
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
    if (!sourceData?.suppressBaseStats) {
        for (const k of Object.keys(cfg)) {
            if (['costCoins', 'cooldownSec', 'rewardCoins'].includes(k)) continue;
            applyPetStatDelta(pet, k, cfg[k]);
        }
    }
    const statBonus = sourceData?.statBonus || {};
    for (const k of Object.keys(statBonus)) {
        applyPetStatDelta(pet, k, statBonus[k]);
    }
    clampEnergyToMax(pet);
    const rewardCoins = activityRewardCoins(key, sourceData, cfg);
    if (rewardCoins) {
        addCoins(rewardCoins, { source: `pet-activity-${key}`, category: 'activity', planetId: getActivePlanetId() });
        saveUserProfileDebounced();
    }
    pet.lastTickAt = Date.now();
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    savePetDebounced(pet);
    showToast(rewardCoins ? `${message} +${rewardCoins} 🪙` : message, 'success', 1600);
    completeDailyReturnRouteStep('care-pet');
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
    const wasHomeTreasurePlaced = isHomeTreasureId(itemId) && isHomeTreasurePlaced(state.layouts, itemId);
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
    if (isHomeTreasureId(itemId)) {
        recordProductEvent('reward_placed', {
            source: 'home',
            rewardType: 'home_treasure',
            rewardId: itemId,
            firstPlacement: !wasHomeTreasurePlaced,
        });
        showToast(`${HOME_TREASURE_META[itemId]?.name || '家园珍宝'}已启动，每天可回来领取产出`, 'success', 3000);
    }
    if (!skipSound) soundManager.playItemPlace();
    notify();
    if (item.type !== 'food') {
        checkOnboardingTask('place-first-facility');
        completeDailyReturnRouteStep('tend-home');
    }
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
    if (ITEM_BY_ID[layout[idx].itemId]?.type !== 'food') completeDailyReturnRouteStep('tend-home');
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
    checkOnboardingTask('feed-first-pet');
    completeDailyReturnRouteStep('care-pet');
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

// 星球编辑器摆放的 NPC 对话结束后打开小游戏；minigame 字段可填 gameId / html 文件名（本地清单）
// 或完整 http(s) 远程地址（不需要出现在 _minigame_index.json 里）。minigameLandscape 显式覆盖
// 是否强制横屏（未设置时：远程地址默认强制横屏，本地 gameId 沿用其自身清单配置）。
function handleNpcMinigameLaunch(npc) {
    const raw = String(npc?.minigame || '').trim();
    if (!raw || !getCurrentPet()) return;
    const landscapeOverride = (npc?.minigameLandscape === true || npc?.minigameLandscape === false)
        ? npc.minigameLandscape
        : null;
    if (/^https?:\/\//i.test(raw)) {
        pendingMinigameLaunch = {
            mode: 'npc',
            npc,
            remoteUrl: raw,
            remoteTitle: String(npc?.name || '').trim(),
            remoteIcon: isImageIconValue(npc?.icon) ? '' : String(npc?.icon || '').trim(),
            // 与本地 gameId NPC 小游戏一致：默认不强制横屏，仅当 minigameLandscape 显式勾选时才开启。
            landscape: !!landscapeOverride,
            allowLowEnergy: true,
            suppressRewards: true,
        };
        navigateToView('minigames', { preserveMinigameLaunch: true });
        return;
    }
    const gameId = resolveOnboardingMinigameId(raw);
    if (!gameId) return;
    pendingMinigameLaunch = {
        mode: 'npc',
        npc,
        gameId,
        landscapeOverride,
        allowLowEnergy: true,
        suppressRewards: true,
    };
    navigateToView('minigames', { preserveMinigameLaunch: true });
}

function helloLearnerUrl() {
    const url = new URL('../tools/HelloLearner/HelloLearner.html', window.location.href);
    if (sdk?.token) url.searchParams.set('token', sdk.token);
    url.searchParams.set('workspace', 'HelloLearner');
    return url.toString();
}

async function readHelloLearnerProgress() {
    if (!state.user || !sdk?.personalPageStore?.withWorkspace) return null;
    const store = sdk.personalPageStore.withWorkspace('HelloLearner');
    const content = await store.readFile('.hellolearner/progress.json');
    return content ? JSON.parse(String(content)) : null;
}

async function settlePendingHelloLearnerSession() {
    const session = pendingHelloLearnerSession;
    if (!session || session.settling) return;
    session.settling = true;
    try {
        const completion = findHelloLearnerSessionCompletion(await readHelloLearnerProgress(), session.startedAt);
        if (!completion) {
            if (session.popup?.closed) pendingHelloLearnerSession = null;
            return;
        }
        const reward = settleHelloLearnerReward(state.settings, completion);
        pendingHelloLearnerSession = null;
        if (!reward.rewarded) {
            showToast(reward.reason === 'daily-limit'
                ? '今天的英语学习奖励已经领取，明天再来继续学习。'
                : '这次学习记录已经结算过了。', 'info', 2800);
            return;
        }
        addCoins(reward.coins, { source: 'hello-learner-completion', category: 'learning', planetId: getActivePlanetId() });
        let commissionText = '';
        if (session.npc?.dailyCommission) {
            const commission = completeNpcCommission(state.settings, session.npc);
            if (commission.completed) commissionText = `，${session.npc.name}记录了今日修习`;
        }
        saveUserProfileDebounced();
        notify();
        recordProductEvent('hello_learner_rewarded', { source: session.npc ? 'mentor' : 'home', npcId: session.npc?.id || '', completionType: completion.type });
        showToast(`英语学习完成，获得 ${reward.coins} 金币${commissionText}！`, 'success', 3600);
    } catch (error) {
        console.warn('读取 HelloLearner 学习进度失败', error);
        if (session.popup?.closed) pendingHelloLearnerSession = null;
        showToast('学习体验已结束，暂时无法核验云端进度，未发放奖励。', 'info', 3200);
    } finally {
        session.settling = false;
    }
}

function handleHelloLearnerLaunch(npc = null) {
    const popup = window.open(helloLearnerUrl(), '_blank');
    if (!popup) {
        showToast('浏览器阻止了学习窗口，请允许弹出窗口后重试。', 'info', 3000);
        return;
    }
    try { popup.opener = null; } catch (_) {}
    pendingHelloLearnerSession = { startedAt: Date.now(), npc, popup, settling: false };
    recordProductEvent('hello_learner_opened', { source: npc ? 'mentor' : 'home', npcId: npc?.id || '' });
    showToast(state.user ? '完成一节英语学习后返回哈奇星球领取奖励。' : '游客可体验英语学习，登录后完成课程可领取奖励。', 'info', 3200);
}

window.addEventListener('focus', () => {
    if (!pendingHelloLearnerSession) return;
    clearTimeout(helloLearnerFocusTimer);
    helloLearnerFocusTimer = setTimeout(() => void settlePendingHelloLearnerSession(), 700);
});

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
    if (!await requirePlanetPetSpace()) return;
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
    const activeSicknessName = sicknessName(sickness.def);
    const treatmentHelp = `${activeSicknessName}：当前病情 ${severity}/10。治疗方案：抵御至少 ${severity} 波攻击才能康复。`;
    pendingMinigameLaunch = {
        mode: 'sickness',
        gameId: 'pet_tower_defense',
        params: { additionalHelp: treatmentHelp, sicknessType: sickness.type, sicknessName: activeSicknessName },
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
    const resolvedSicknessName = sicknessName(def) || '疾病';
    if (result.cured) {
        pendingMinigameLaunch = null;
        await savePet(pet);
        postTowerDefenseTreatmentControl('treatmentCuredPrompt');
        const keepPlaying = await confirm(`${resolvedSicknessName}已经治好，24小时内不会再生病。要继续守护训练吗？`, {
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
    showToast(`${resolvedSicknessName}病情减轻 ${treatmentLevels} 级，本次登录剩余 ${getEffectiveSicknessSeverity(pet)} 级。`, 'success', 1800);
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
    if (target === 'helloLearner') {
        handleHelloLearnerLaunch();
        return;
    }
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
    addCoins(-totalPrice, { source: `shop-buy-${item.id}`, category: 'shop', planetId: getActivePlanetId() });
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
    addCoins(totalGain, { source: `shop-sell-${item.id}`, category: 'shop', planetId: getActivePlanetId() });
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
    loadPlanetFeatures().then(() => {
        // 分享的用户小游戏需要先异步拉取 HTML；登录启动后的配置刷新若重建 minigames，
        // 会销毁刚打开的 iframe 并退回列表。配置保留在内存中，下次正常渲染即可使用。
        if (state.currentView !== 'minigames') render();
    }).catch(error => console.warn('加载星球玩法配置失败', error));
    // 启动完成后处理 agent 深链（此时已登录 / 已有宠物上下文）
    applyAgentDeepLinks().catch(e => console.warn('agent 深链处理失败', e));
}).catch(err => {
    console.error(err);
    showToast('启动失败：' + (err?.message || err), 'error', 5000);
    finishBootstrap();
    setView('login');
});
