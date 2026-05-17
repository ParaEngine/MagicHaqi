// 主家视图 —— 编排器
// 职责：
//   1) 渲染 topbar / stage / 持久 dock 三段式骨架
//   2) 在 4 个 level（planet / field / pet / cell）之间用"虫洞动画"切换
//   3) 处理 滚轮 / 双指捏合 / 鼠标拖动 → 调整"相机距离" cameraZoom
//      · 在 minCamera ~ maxCamera 范围内只是缩放当前层，不切换
//      · 越过边界才触发 setLevel(±1) + 虫洞过渡
//   4) 切换过程中 dock 节点不卸载，只替换内部 HTML，给玩家一致的"控制面板"
//   5) 首次进入从最外层开始；从其它视图返回时恢复上次 home level

import { $, coinIconSvg, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { CONFIG, getStageName } from './config.js';
import { state, setZoomLevel as _setZoomLevelRaw } from './state.js';
import { savePetDebounced } from './storage.js';
import { displayPetName } from './dna.js';

import { planetLevel } from './level_planet.js';
import { fieldLevel }  from './level_field.js';
import { petLevel, stopPetWalk } from './level_pet.js';
import { cellLevel, stopCellGame } from './level_cell.js';
import { playPetHappy } from './pet.js';
import { getRuntimePetStats } from './petLifecycle.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();

const LEVELS = [planetLevel, fieldLevel, petLevel, cellLevel];
const DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MH_DOCK_HEIGHT = 128;
const CAMERA_SETTLE_EPSILON = 0.0025;
const CAMERA_SMOOTHING = 17;
const CAMERA_MAX_DT = 0.05;
const WHEEL_ZOOM_SENSITIVITY = 0.0032;
const WHEEL_DELTA_LIMIT = 420;
const DEFAULT_ZOOM_TRANSITION = Object.freeze({
    oldSceneMs: 500,
    oldCameraMs: 300,
    flashMs: 300,
    newSceneMs: 600,
    newCameraMs: 600,
    dockFadeMs: 420,
    rayColor: '#174a8b',
});
const ZOOM_TRANSITION_NUMERIC_KEYS = ['oldSceneMs', 'oldCameraMs', 'flashMs', 'newSceneMs', 'newCameraMs', 'dockFadeMs'];
const ZOOM_BAR_STAGES = [
    { id: 'planet', label: '星球', color: '#172554', hint: '上下滑动 / 双指放大 → 登陆星球' },
    { id: 'field', label: '表面', color: '#65a30d', hint: '上下滑动 / 双指缩放 → 太空 / 宠物房间' },
    { id: 'pet', label: '日常', color: '#facc15', hint: '上下滑动 / 双指缩放 → 星球表面 / 细胞' },
    { id: 'cell', label: '体内', color: '#f9a8d4', hint: '上下滑动 / 双指缩小 → 返回宠物房间' },
];

const CARE_STAT_KEYS = ['hunger', 'mood', 'clean', 'bond'];
const PET_STAT_ITEMS = [
    { k: 'hunger', labelKey: 'statEnergy', icon: '⚡', color: '#84cc16', lowText: '需要休息或进食' },
    { k: 'mood',   labelKey: 'statMood',   icon: '😊', color: '#ec4899', lowText: '想要玩耍和陪伴' },
    { k: 'clean',  labelKey: 'statClean',  icon: '🛁', color: '#06b6d4', lowText: '需要清洁' },
    { k: 'bond',   labelKey: 'statBond',   icon: '💛', color: '#a855f7', lowText: '想更亲近' },
];
const TOPBAR_ITEMS_BY_LEVEL = Object.freeze({
    planet: [{ type: 'resource', key: 'biofuel' }, { type: 'resource', key: 'coins' }],
    field: [{ type: 'stat', key: 'mood' }, { type: 'resource', key: 'biofuel' }, { type: 'resource', key: 'coins' }],
    pet: [{ type: 'stat', key: 'hunger' }, { type: 'resource', key: 'coins' }],
    cell: [{ type: 'stat', key: 'hunger' }, { type: 'stat', key: 'mood' }, { type: 'stat', key: 'bond' }],
});

// 模块状态
let cameraZoom = 1.0;
let visualCameraZoom = 1.0;
let __cameraAnimFrame = 0;
let __cameraLastFrameTime = 0;
let __cameraRenderQueued = false;
let __mhZoomAnimating = false;
let __pendingZoomTransitionTimer = null;
let __cameraIdleReturnTimer = null;
let __cameraGestureActive = false;
let __wheelZoomFrame = 0;
let __wheelZoomDelta = 0;
let __wheelGestureEndTimer = null;
let __lastPet = null;
let __lastCallbacks = {};
let __tickBound = false;
let __companionMoodTimer = null;
let __companionMoodLastAt = 0;
const __companionMoodPendingTimers = new Map();
let __zoomBarHideTimer = null;
let __levelJumpCompleted = false;
const __dockScrollPositions = new Map();

function getDockScrollKey(el) {
    return el?.id || el?.dataset?.dockScrollKey || '';
}

function rememberDockScrollPosition(el) {
    const key = getDockScrollKey(el);
    if (key) __dockScrollPositions.set(key, el.scrollLeft || 0);
}

function rememberDockScrollPositions(root = document) {
    root.querySelectorAll?.('#mhDock .mh-scroll-x').forEach(rememberDockScrollPosition);
}

function restoreDockScrollPositions(root = document) {
    root.querySelectorAll?.('#mhDock .mh-scroll-x').forEach((el) => {
        const key = getDockScrollKey(el);
        if (!key || !__dockScrollPositions.has(key)) return;
        el.scrollLeft = __dockScrollPositions.get(key) || 0;
    });
}

// =============================================================================
// 入口（被 app.js 路由调用）
// =============================================================================
export function renderHome(panel, { pet }, callbacks = {}) {
    if (!pet) {
        panel.innerHTML = `<div class="absolute inset-0 flex items-center justify-center" style="color:var(--text-muted)">没有选中的宠物</div>`;
        return;
    }
    rememberDockScrollPositions(panel);
    stopPetWalk();
    stopCellGame();

    __lastPet = pet;
    __lastCallbacks = callbacks;

    const lvl = clampLvl(state.zoomLevel ?? 0);
    state.zoomLevel = lvl;
    state.lastHomeZoomLevel = lvl;

    const zoomDef = CONFIG.zoomLevels[lvl];
    const level = LEVELS[lvl];
    clearCameraIdleReturn();
    // 起点相机：使用该层最佳视角
    cameraZoom = getLevelBestCamera(level);
    visualCameraZoom = cameraZoom;

    panel.innerHTML = `
        <div class="topbar">
            <div class="mh-brand-logo" aria-label="蛋蛋星球">
                <span class="mh-brand-title">蛋蛋星球</span>
            </div>
            <div class="home-hud">
                <span class="home-hud-stats" id="mhTopbarStats">${renderTopbarHudItems(pet, lvl)}</span>
                <button class="btn-icon" id="mhMenuBtn" title="菜单" style="width:36px;height:36px;font-size:18px">☰</button>
            </div>
        </div>

        <div id="mhStage" class="mh-stage zoom-${zoomDef.id} ${state.isDecorMode && (lvl === 1 || lvl === 2) ? 'decor-mode' : ''} ${state.isFeedMode && lvl === 2 ? 'feed-mode' : ''}"
             style="position:absolute;top:52px;left:0;right:0;bottom:${MH_DOCK_HEIGHT}px;overflow:hidden;touch-action:none">
            <div id="mhStageInner" style="position:absolute;inset:0;transform-origin:50% 50%;transform:translate3d(0,0,0) scale(1);will-change:transform;backface-visibility:hidden">
                ${level.stageHtml(pet)}
            </div>
            ${renderZoomLevelBar()}
        </div>

        <div id="mhDock" class="mh-dock" style="height:${MH_DOCK_HEIGHT}px">
            ${level.dockHtml(pet)}
        </div>`;

    if ($('mhMenuBtn')) {
        const menuButton = $('mhMenuBtn');
        menuButton.onclick = () => {
            soundManager.playButtonClick();
            showMenuModal(callbacks);
        };
        menuButton.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openDevConsoleFromHome();
        };
    }
    bindHudTips(panel);
    bindTopbarStatDetails(panel, pet);
    bindTopbarResourceShop(panel, callbacks);
    bindZoomLevelBar(panel);
    bindTopbarStateTick();
    bindCompanionMoodTimer();
    refreshPetStateUi(pet);

    const ctx = makeCtx(pet, callbacks);
    level.bindStage(pet, ctx);
    level.bindDock(pet, ctx);
    bindDockHorizontalScroll();
    restoreDockScrollPositions(panel);
    level.onEnter?.(pet, ctx);

    bindStageZoomGestures();
    applyCameraZoom();
    showZoomLevelBar();
}

// 兼容旧 API
export function stopHomeWalk() {
    stopPetWalk();
    stopCellGame();
}

// =============================================================================
// 工具
// =============================================================================
function clampLvl(n) { return Math.max(0, Math.min(LEVELS.length - 1, n | 0)); }

function isDevHost() {
    return typeof window !== 'undefined' && DEV_HOSTS.has(window.location.hostname);
}

async function openDevConsoleFromHome() {
    if (!isDevHost()) return;
    soundManager.playButtonClick();
    try {
        const { openDevConsole } = await import('./view_dev_console.js');
        openDevConsole?.({ expanded: true });
    } catch (e) {
        console.warn('开发者面板加载失败', e);
    }
}

function renderZoomLevelBar(pet = __lastPet) {
    if (isZoomLevelBarSuppressed()) return '';
    const lvl = clampLvl(state.zoomLevel ?? 0);
    const hint = getZoomLevelHint(lvl, pet);
    const progress = getZoomBarProgress(visualCameraZoom || cameraZoom);
    const pointerConflictsWithEmergency = !!getZoomStageEmergency(ZOOM_BAR_STAGES[lvl]?.id, pet);
    return `
        <button class="mh-zoom-bar ${pointerConflictsWithEmergency ? 'has-pointer-emergency-icon' : ''}" id="mhZoomLevelBar" type="button"
            style="--zoom-pos:${progress.toFixed(4)}"
            title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}" aria-hidden="true" tabindex="-1" disabled data-tip="${escapeHtml(hint)}">
            <span class="mh-zoom-bar-track" aria-hidden="true">
                ${ZOOM_BAR_STAGES.map((stage, index) => {
                    const emergency = getZoomStageEmergency(stage.id, pet);
                    return `
                    <span class="mh-zoom-bar-stage ${index === lvl ? 'active' : ''}" style="--stage-color:${stage.color}" title="${escapeHtml(emergency?.tip || stage.label)}">
                        <i>${escapeHtml(stage.label)}</i>
                    </span>`;
                }).join('')}
            </span>
            ${ZOOM_BAR_STAGES.map((stage, index) => {
                const emergency = getZoomStageEmergency(stage.id, pet);
                return emergency ? `<span class="mh-zoom-bar-emergency" data-zoom-emergency="${escapeHtml(stage.id)}" style="--stage-index:${index}" title="${escapeHtml(emergency.tip)}">${emergency.iconHtml}</span>` : '';
            }).join('')}
            <span class="mh-zoom-bar-pointer" aria-hidden="true"></span>
        </button>
    `;
}

function getZoomStageEmergency(stageId, pet = __lastPet) {
    if (!pet) return null;
    const mood = Number(pet.stats?.mood);
    const hunger = Number(pet.stats?.hunger);
    if (stageId === 'field' && Number.isFinite(mood) && mood <= 0) {
        return { iconHtml: '<span class="mh-zoom-bar-emergency-emoji">💔</span>', tip: '紧急：心情为 0，需要玩耍和陪伴。' };
    }
    if (stageId === 'pet' && Number.isFinite(hunger) && hunger <= 0) {
        return {
            iconHtml: '<svg class="mh-zoom-bar-emergency-svg" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="#7dd3fc" stroke="#fff" stroke-width="3"/><circle cx="11" cy="13" r="2.2" fill="#0f172a"/><circle cx="21" cy="13" r="2.2" fill="#0f172a"/><path d="M10 23c2.8-3.2 9.2-3.2 12 0" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/><path d="M24 9c3 3.7 3.3 7.4.7 10.6" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" opacity="0.85"/></svg>',
            tip: '紧急：体力为 0，需要休息或喂食。',
        };
    }
    return null;
}

function getZoomLevelHint(lvl = state.zoomLevel, pet = __lastPet) {
    const stage = ZOOM_BAR_STAGES[clampLvl(lvl)];
    const emergency = getZoomStageEmergency(stage?.id, pet);
    if (emergency) return `${emergency.tip} ${stage?.hint || '滚动 / 双指缩放视角'}`;
    return stage?.hint || '滚动 / 双指缩放视角';
}

function getZoomBarProgress(zoom = visualCameraZoom) {
    const lvl = clampLvl(state.zoomLevel ?? 0);
    const level = LEVELS[lvl] || {};
    const minCamera = level.minCamera ?? 0.5;
    const maxCamera = level.maxCamera ?? 1.5;
    const bestCamera = getLevelBestCamera(level);
    const current = Math.max(minCamera, Math.min(maxCamera, Number(zoom) || bestCamera));
    let local = 0.5;
    if (current < bestCamera && bestCamera > minCamera) {
        local = 0.5 * ((current - minCamera) / (bestCamera - minCamera));
    } else if (current > bestCamera && maxCamera > bestCamera) {
        local = 0.5 + 0.5 * ((current - bestCamera) / (maxCamera - bestCamera));
    }
    local = Math.max(0, Math.min(1, local));
    return (lvl + local) / LEVELS.length;
}

function updateZoomLevelBarPointer() {
    const bar = document.getElementById('mhZoomLevelBar');
    if (!bar) return;
    bar.style.setProperty('--zoom-pos', getZoomBarProgress(visualCameraZoom).toFixed(4));
}

function setZoomLevelBarInteractive(bar, interactive) {
    if (!bar) return;
    bar.disabled = !interactive;
    bar.setAttribute('aria-hidden', interactive ? 'false' : 'true');
    bar.tabIndex = interactive ? 0 : -1;
}

function clearZoomLevelBarHideTimer() {
    if (!__zoomBarHideTimer) return;
    clearTimeout(__zoomBarHideTimer);
    __zoomBarHideTimer = null;
}

function showZoomLevelBar({ autoHide = false, delay = 1600, requireLevelJumpCompleted = false } = {}) {
    if (isZoomLevelBarSuppressed()) {
        hideZoomLevelBar({ force: true });
        return;
    }
    const bar = document.getElementById('mhZoomLevelBar');
    if (!bar) return;
    clearZoomLevelBarHideTimer();
    updateZoomLevelBarPointer();
    bar.classList.add('is-visible');
    setZoomLevelBarInteractive(bar, true);
    if (autoHide && isAutoShowLevelBarEnabled()) {
        __zoomBarHideTimer = setTimeout(() => {
            __zoomBarHideTimer = null;
            if (__pendingZoomTransitionTimer || __mhZoomAnimating) return;
            hideZoomLevelBar({ requireLevelJumpCompleted });
        }, delay);
    }
}

function hideZoomLevelBar({ requireLevelJumpCompleted = false, force = false } = {}) {
    if (!force && !isAutoShowLevelBarEnabled() && !isZoomLevelBarSuppressed()) {
        showZoomLevelBar();
        return;
    }
    if (requireLevelJumpCompleted && !__levelJumpCompleted) return;
    clearZoomLevelBarHideTimer();
    closeZoomLevelBarTips();
    document.querySelectorAll('.mh-zoom-bar').forEach(el => {
        el.classList.remove('is-visible');
        setZoomLevelBarInteractive(el, false);
    });
    if (requireLevelJumpCompleted) __levelJumpCompleted = false;
}

function bindZoomLevelBar(root = document) {
    const bar = root.querySelector?.('#mhZoomLevelBar') || document.getElementById('mhZoomLevelBar');
    if (!bar || bar.__mhZoomBarBound) return;
    bar.__mhZoomBarBound = true;
    bar.addEventListener('click', (e) => {
        if (!bar.classList.contains('is-visible')) return;
        e.preventDefault();
        e.stopPropagation();
        const wasOpen = bar.classList.contains('tip-open');
        closeZoomLevelBarTips();
        if (!wasOpen) {
            bar.classList.add('tip-open');
            document.addEventListener('click', closeZoomLevelBarTips, { once: true });
        }
    });
    bar.addEventListener('keydown', (e) => {
        if (!bar.classList.contains('is-visible')) return;
        if (e.key === 'Escape') closeZoomLevelBarTips();
    });
}

function closeZoomLevelBarTips() {
    document.querySelectorAll('.mh-zoom-bar.tip-open').forEach(el => el.classList.remove('tip-open'));
}

function refreshZoomLevelBar(root = document) {
    const bar = root.querySelector?.('#mhZoomLevelBar') || document.getElementById('mhZoomLevelBar');
    if (!bar) return;
    bar.outerHTML = renderZoomLevelBar();
    bindZoomLevelBar(root);
    updateZoomLevelBarPointer();
    if (!isAutoShowLevelBarEnabled()) showZoomLevelBar();
}

function getLevelBestCamera(level = LEVELS[state.zoomLevel]) {
    const minCamera = level?.minCamera ?? 0.5;
    const maxCamera = level?.maxCamera ?? 1.5;
    const bestCamera = level?.bestCamera ?? ((minCamera + maxCamera) / 2);
    return Math.max(minCamera, Math.min(maxCamera, bestCamera));
}

function applyCameraZoom() {
    const level = LEVELS[state.zoomLevel];
    if (level?.instantCamera) {
        stopCameraAnimation();
        visualCameraZoom = cameraZoom;
        scheduleCameraRender();
        return;
    }
    startCameraAnimation();
}

function renderCameraTransform() {
    __cameraRenderQueued = false;
    updateZoomLevelBarPointer();
    const inner = document.getElementById('mhStageInner');
    const target = getCameraTargetElement(inner);
    if (!target) return;
    const scale = getVisualCameraScale();
    const focus = getCameraFocus();
    const originX = 50 + ((focus.x ?? 50) - 50) * (focus.weight ?? 0);
    const originY = 50 + ((focus.y ?? 50) - 50) * (focus.weight ?? 0);
    const translateX = (50 - (focus.x ?? 50)) * (focus.weight ?? 0);
    const translateY = (50 - (focus.y ?? 50)) * (focus.weight ?? 0);
    target.style.transformOrigin = `${originX.toFixed(2)}% ${originY.toFixed(2)}%`;
    target.style.transform = `translate3d(${translateX.toFixed(3)}%, ${translateY.toFixed(3)}%, 0) scale(${scale.toFixed(3)})`;
    if (target !== inner) {
        inner.style.transformOrigin = '50% 50%';
        inner.style.transform = 'translate3d(0%, 0%, 0) scale(1)';
    }
    LEVELS[state.zoomLevel]?.onCameraChange?.(visualCameraZoom);
}

function scheduleCameraRender() {
    if (__cameraRenderQueued) return;
    __cameraRenderQueued = true;
    requestAnimationFrame(renderCameraTransform);
}

function getCameraTargetElement(inner) {
    if (!inner) return null;
    const level = LEVELS[state.zoomLevel];
    if (!level?.cameraTargetSelector) return inner;
    return inner.querySelector(level.cameraTargetSelector) || inner;
}

function getVisualCameraScale() {
    const level = LEVELS[state.zoomLevel];
    const minVisualScale = level?.minVisualScale ?? 0;
    return Math.max(minVisualScale, visualCameraZoom);
}

function getCameraFocus() {
    const level = LEVELS[state.zoomLevel];
    const focus = level?.cameraFocus?.(visualCameraZoom, __lastPet) || null;
    if (!focus) return { x: 50, y: 50, weight: 0 };
    return {
        x: clampPercent(focus.x ?? 50),
        y: clampPercent(focus.y ?? 50),
        weight: Math.max(0, Math.min(1, focus.weight ?? 1)),
    };
}

function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
}

function startCameraAnimation() {
    if (__cameraAnimFrame) return;
    __cameraLastFrameTime = 0;
    __cameraAnimFrame = requestAnimationFrame(animateCameraZoom);
}

function stopCameraAnimation() {
    if (__cameraAnimFrame) cancelAnimationFrame(__cameraAnimFrame);
    __cameraAnimFrame = 0;
    __cameraLastFrameTime = 0;
}

function animateCameraZoom(timestamp = 0) {
    const diff = cameraZoom - visualCameraZoom;
    if (Math.abs(diff) < CAMERA_SETTLE_EPSILON) {
        visualCameraZoom = cameraZoom;
        renderCameraTransform();
        stopCameraAnimation();
        return;
    }
    const dt = __cameraLastFrameTime ? Math.min(CAMERA_MAX_DT, (timestamp - __cameraLastFrameTime) / 1000) : (1 / 60);
    __cameraLastFrameTime = timestamp;
    const blend = 1 - Math.exp(-CAMERA_SMOOTHING * dt);
    visualCameraZoom += diff * blend;
    renderCameraTransform();
    __cameraAnimFrame = requestAnimationFrame(animateCameraZoom);
}

function clearCameraIdleReturn() {
    if (!__cameraIdleReturnTimer) return;
    clearTimeout(__cameraIdleReturnTimer);
    __cameraIdleReturnTimer = null;
}

function clearWheelGestureEndTimer() {
    if (!__wheelGestureEndTimer) return;
    clearTimeout(__wheelGestureEndTimer);
    __wheelGestureEndTimer = null;
}

function scheduleWheelGestureEnd() {
    clearWheelGestureEndTimer();
    __wheelGestureEndTimer = setTimeout(() => {
        __wheelGestureEndTimer = null;
        markCameraGestureEnd();
    }, 150);
}

function markCameraGestureStart() {
    __cameraGestureActive = true;
    clearCameraIdleReturn();
    showZoomLevelBar();
}

function markCameraGestureEnd() {
    __cameraGestureActive = false;
    scheduleCameraIdleReturn();
    showZoomLevelBar();
}

function scheduleCameraIdleReturn() {
    clearCameraIdleReturn();
    __cameraIdleReturnTimer = setTimeout(() => {
        __cameraIdleReturnTimer = null;
        if (__cameraGestureActive || __mhZoomAnimating || __pendingZoomTransitionTimer) {
            scheduleCameraIdleReturn();
            return;
        }
        const bestCamera = getLevelBestCamera();
        if (Math.abs(cameraZoom - bestCamera) < 0.004) return;
        cameraZoom = bestCamera;
        applyCameraZoom();
    }, 2000);
}

function forceBestCameraDistance() {
    clearPendingZoomTransition();
    clearCameraIdleReturn();
    cameraZoom = getLevelBestCamera();
    applyCameraZoom();
}

function isDecorZoomLocked() {
    return (state.zoomLevel === 1 && state.isDecorMode) || (state.zoomLevel === 2 && (state.isDecorMode || state.isFeedMode));
}

function isAutoShowLevelBarEnabled() {
    return state.settings?.autoShowLevelBar === true;
}

function isZoomLevelBarSuppressed() {
    if (isAutoShowLevelBarEnabled()) return isDecorZoomLocked();
    return !!(state.isDecorMode || state.isFeedMode);
}

function makeCtx(pet, callbacks) {
    const ctx = {
        pet,
        callbacks,
        get dock() { return document.getElementById('mhDock'); },
        get stage() { return document.getElementById('mhStage'); },
        get stageInner() { return document.getElementById('mhStageInner'); },
        selectedTrayItem: null,
        zoomIn:  () => { if (!isDecorZoomLocked()) requestZoomLevel(state.zoomLevel + 1); },
        zoomOut: () => { if (!isDecorZoomLocked()) requestZoomLevel(state.zoomLevel - 1); },
        openPetDetails: () => showPetDetailsModal(pet),
        onPetTouch: (petEl, touchedPet = pet) => handleCompanionPetTouch(petEl, touchedPet),
    };
    return ctx;
}

function bindHudTips(root) {
    root.querySelectorAll('.hud-pill[data-tip]').forEach(el => {
        if (el.classList.contains('topbar-stat-pill')) return;
        if (el.classList.contains('topbar-resource-pill')) return;
        if (el.__mhHudTipBound) return;
        el.__mhHudTipBound = true;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = el.classList.contains('tip-open');
            closeHudTips(root);
            if (!wasOpen) {
                el.classList.add('tip-open');
                document.addEventListener('click', () => closeHudTips(root), { once: true });
            }
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeHudTips(root);
        });
    });
}

function bindTopbarResourceShop(root, callbacks = __lastCallbacks) {
    root.querySelectorAll('.topbar-resource-pill').forEach(el => {
        if (el.__mhTopbarResourceShopBound) return;
        el.__mhTopbarResourceShopBound = true;
        const showResourceConfirm = (e) => {
            e.preventDefault();
            e.stopPropagation();
            soundManager.playButtonClick();
            showTopbarResourceConfirm(el.dataset.topbarResource, callbacks);
        };
        el.addEventListener('click', showResourceConfirm);
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            showResourceConfirm(e);
        });
    });
}

function bindTopbarStatDetails(root, pet = __lastPet) {
    root.querySelectorAll('.topbar-stat-pill').forEach(el => {
        if (el.__mhTopbarStatDetailsBound) return;
        el.__mhTopbarStatDetailsBound = true;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            soundManager.playButtonClick();
            showTopbarStatConfirm(el.dataset.topbarStat, pet || __lastPet);
        });
    });
}

function closeHudTips(root) {
    root.querySelectorAll('.hud-pill.tip-open').forEach(el => el.classList.remove('tip-open'));
}

function statValue(pet, key) {
    const stats = getRuntimePetStats(pet);
    return Math.max(0, Math.min(100, Math.round(stats[key] ?? 0)));
}

function resourceValue(key) {
    if (key === 'biofuel') return state.biofuel | 0;
    if (key === 'coins') return state.coins | 0;
    return 0;
}

function resourceInfo(key) {
    if (key === 'biofuel') {
        return {
            label: '生物燃料',
            icon: '⛽',
            description: '收集宠物便便可获得，用于星球旅行。也可以打开商店准备更多照顾宠物的物品。',
        };
    }
    return {
        label: '金币',
        icon: coinIconSvg(),
        description: '照顾和玩耍可获得，用来购买食物、家具和道具。',
    };
}

function displayPetNameWithoutTag(pet) {
    return displayPetName(pet).replace(/\s+#\S+$/, '');
}

function getTopbarItems(lvl = state.zoomLevel) {
    const level = LEVELS[clampLvl(lvl)] || LEVELS[0];
    return TOPBAR_ITEMS_BY_LEVEL[level.id] || [];
}

function getTopbarStatKeys(lvl = state.zoomLevel) {
    const keys = getTopbarItems(lvl)
        .filter(item => item.type === 'stat')
        .map(item => item.key);
    const known = new Set(PET_STAT_ITEMS.map(it => it.k));
    return keys.filter(key => known.has(key));
}

function renderTopbarStatPill(pet, key) {
    const item = PET_STAT_ITEMS.find(it => it.k === key);
    if (!item) return '';
    const value = statValue(pet, key);
    const level = stateLevel(value);
    const label = t(item.labelKey);
    const tip = `${label}：${value} · ${item.lowText}`;
    return `
        <button type="button" class="hud-pill hud-pill-stacked topbar-stat-pill state-${level.key}" data-topbar-stat="${escapeHtml(key)}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">
            <span class="hud-pill-icon">${item.icon}</span>
            <span class="hud-pill-value" data-mh-topbar-stat-value="${escapeHtml(key)}" data-stat-value="${value}">${value}</span>
        </button>`;
}

function renderTopbarResourcePill(key) {
    if (key === 'biofuel') {
        const tip = '生物燃料：收集宠物便便可获得，用于星球旅行。';
        return `
            <span class="hud-pill hud-pill-stacked topbar-resource-pill" id="mhBiofuel" tabindex="0" title="${escapeHtml(tip)}" data-topbar-resource="biofuel" data-tip="${escapeHtml(tip)}" aria-label="打开商店">
                <span class="hud-pill-icon">⛽</span>
                <span class="hud-pill-value" data-hud-value="biofuel">${state.biofuel | 0}</span>
            </span>`;
    }
    if (key === 'coins') {
        const tip = '金币：照顾和玩耍可获得，用来购买食物、家具和道具。';
        return `
            <span class="hud-pill hud-pill-stacked hud-pill-coin topbar-resource-pill" id="mhCoins" tabindex="0" title="${escapeHtml(tip)}" data-topbar-resource="coins" data-tip="${escapeHtml(tip)}" aria-label="打开商店">
                <span class="hud-pill-icon">${coinIconSvg()}</span>
                <span class="hud-pill-value" data-hud-value="coins">${state.coins}</span>
            </span>`;
    }
    return '';
}

function renderTopbarHudItems(pet, lvl = state.zoomLevel) {
    const knownStats = new Set(getTopbarStatKeys(lvl));
    return getTopbarItems(lvl).map(item => {
        if (item.type === 'stat' && knownStats.has(item.key)) return renderTopbarStatPill(pet, item.key);
        if (item.type === 'resource') return renderTopbarResourcePill(item.key);
        return '';
    }).join('');
}

function refreshTopbarStatPills(pet = __lastPet) {
    const root = document.getElementById('mhTopbarStats');
    if (!root || !pet) return;
    root.innerHTML = renderTopbarHudItems(pet);
    bindHudTips(document);
    bindTopbarStatDetails(document, pet);
    bindTopbarResourceShop(document, __lastCallbacks);
}

function getLowestCareStat(pet) {
    const careItems = PET_STAT_ITEMS.filter(it => CARE_STAT_KEYS.includes(it.k));
    return careItems.reduce((lowest, it) => {
        const v = statValue(pet, it.k);
        if (!lowest || v < lowest.value) return { ...it, value: v };
        return lowest;
    }, null);
}

function stateLevel(value) {
    if (value < 25) return { key: 'danger', label: '紧急' };
    if (value < 50) return { key: 'warn', label: '注意' };
    return { key: 'good', label: '良好' };
}

function refreshPetStateUi(pet) {
    const current = pet || __lastPet;
    if (!current) return;

    PET_STAT_ITEMS.forEach((it) => {
        const v = statValue(current, it.k);
        document.querySelectorAll(`[data-mh-stat-fill="${it.k}"]`).forEach(el => { el.style.width = v + '%'; });
        document.querySelectorAll(`[data-mh-stat-value="${it.k}"]`).forEach(el => { el.textContent = String(v); });
        document.querySelectorAll(`[data-mh-topbar-stat-value="${it.k}"]`).forEach(el => {
            const oldValue = Number(el.dataset.statValue);
            if (oldValue === v) return;
            el.dataset.statValue = String(v);
            el.textContent = String(v);
            const pill = el.closest('.topbar-stat-pill');
            if (!pill) return;
            const level = stateLevel(v);
            pill.classList.remove('state-good', 'state-warn', 'state-danger', 'topbar-stat-pop');
            pill.classList.add(`state-${level.key}`);
            pill.title = `${t(it.labelKey)}：${v} · ${it.lowText}`;
            pill.setAttribute('aria-label', pill.title);
            pill.dataset.tip = pill.title;
            void pill.offsetWidth;
            pill.classList.add('topbar-stat-pop');
            setTimeout(() => pill.classList.remove('topbar-stat-pop'), 520);
        });
    });
    refreshZoomLevelBarEmergency(current);
}

function refreshZoomLevelBarEmergency(pet = __lastPet) {
    const bar = document.getElementById('mhZoomLevelBar');
    if (!bar) return;
    const hint = getZoomLevelHint(state.zoomLevel, pet);
    bar.title = hint;
    bar.setAttribute('aria-label', hint);
    bar.dataset.tip = hint;
    let pointerConflictsWithEmergency = false;
    ZOOM_BAR_STAGES.forEach((stage, index) => {
        const stageEl = bar.querySelector(`.mh-zoom-bar-stage:nth-child(${index + 1})`);
        const emergency = getZoomStageEmergency(stage.id, pet);
        if (emergency && index === clampLvl(state.zoomLevel)) pointerConflictsWithEmergency = true;
        if (stageEl) stageEl.title = emergency?.tip || stage.label;
        let marker = bar.querySelector(`.mh-zoom-bar-emergency[data-zoom-emergency="${stage.id}"]`);
        if (emergency && !marker) {
            marker = document.createElement('span');
            marker.className = 'mh-zoom-bar-emergency';
            marker.dataset.zoomEmergency = stage.id;
            marker.style.setProperty('--stage-index', index);
            bar.appendChild(marker);
        }
        if (marker) {
            if (emergency) {
                marker.innerHTML = emergency.iconHtml;
                marker.title = emergency.tip;
            }
            else marker.remove();
        }
    });
    bar.classList.toggle('has-pointer-emergency-icon', pointerConflictsWithEmergency);
}

function bindTopbarStateTick() {
    if (__tickBound) return;
    __tickBound = true;
    window.addEventListener('mh:tick', () => refreshPetStateUi(__lastPet));
}

function bindCompanionMoodTimer() {
    if (__companionMoodTimer) return;
    __companionMoodLastAt = Date.now();
    __companionMoodTimer = setInterval(updateCompanionMoodProgress, 1000);
}

function todayKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function normalizeCompanionMoodProgress(pet, now = Date.now()) {
    const day = todayKey(now);
    const current = pet.companionMoodProgress;
    if (!current || current.day !== day || typeof current !== 'object') {
        pet.companionMoodProgress = { day, elapsedMs: 0, claimed: {}, totalMood: 0 };
    } else {
        current.elapsedMs = Math.max(0, Number(current.elapsedMs) || 0);
        current.claimed = current.claimed && typeof current.claimed === 'object' ? current.claimed : {};
        current.totalMood = Math.max(0, Number(current.totalMood) || 0);
    }
    return pet.companionMoodProgress;
}

function companionRewardId(reward) {
    return reward?.id || `${Number(reward?.seconds) || 0}s`;
}

function companionPendingKey(pet, progress, rewardId) {
    return `${pet?.id || 'pet'}:${progress?.day || ''}:${rewardId}`;
}

function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/(["'\\\]\[])/g, '\\$1');
}

function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 4 || rect.height <= 4) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
}

function getVisibleCompanionPetElement(pet = __lastPet) {
    if (!pet?.id || state.currentView !== 'home') return null;
    const level = clampLvl(state.zoomLevel ?? 0);
    const selector = level === 1
        ? `.field-pet[data-field-pet="${cssEscape(pet.id)}"]`
        : level === 2
            ? '#mhPet'
            : '';
    if (!selector) return null;
    const el = document.querySelector(selector);
    return isElementVisible(el) ? el : null;
}

function isCompanionMoodEligible() {
    const cfg = CONFIG.companionMood || {};
    const levels = Array.isArray(cfg.eligibleZoomLevels) ? cfg.eligibleZoomLevels : [1, 2, 3];
    return state.currentView === 'home'
        && levels.includes(clampLvl(state.zoomLevel ?? 0))
        && !(typeof document !== 'undefined' && document.hidden);
}

function updateCompanionMoodProgress() {
    const now = Date.now();
    if (!isCompanionMoodEligible() || !__lastPet?.stats) {
        __companionMoodLastAt = now;
        return;
    }
    if (!__companionMoodLastAt) {
        __companionMoodLastAt = now;
        return;
    }

    const cfg = CONFIG.companionMood || {};
    const rewards = Array.isArray(cfg.rewards) ? cfg.rewards : [];
    const dailyMax = Math.max(0, Number(cfg.dailyMax) || 50);
    const progress = normalizeCompanionMoodProgress(__lastPet, now);
    const delta = Math.max(0, Math.min(now - __companionMoodLastAt, 5000));
    __companionMoodLastAt = now;
    if (delta <= 0) return;
    progress.elapsedMs += delta;

    let gained = 0;
    for (const reward of rewards) {
        const id = companionRewardId(reward);
        const thresholdMs = Math.max(0, Number(reward?.seconds) || 0) * 1000;
        if (!id || thresholdMs <= 0 || progress.claimed[id] || progress.elapsedMs < thresholdMs) continue;
        if (__companionMoodPendingTimers.has(companionPendingKey(__lastPet, progress, id))) continue;
        const petEl = getVisibleCompanionPetElement(__lastPet);
        if (petEl) {
            scheduleCompanionMoodReward(__lastPet, reward, petEl, now);
        } else {
            gained += claimCompanionMoodReward(__lastPet, reward, { now });
        }
    }

    if (gained > 0) {
        showCompanionMoodReward(gained, now);
    }
}

function claimCompanionMoodReward(pet, reward, { now = Date.now(), petEl = null, playAnimation = false } = {}) {
    if (!pet?.stats) return 0;
    const progress = normalizeCompanionMoodProgress(pet, now);
    const id = companionRewardId(reward);
    if (!id || progress.claimed[id]) return 0;
    const dailyMax = Math.max(0, Number(CONFIG.companionMood?.dailyMax) || 50);
    const remaining = Math.max(0, dailyMax - progress.totalMood);
    const amount = Math.min(remaining, Math.max(0, Number(reward?.mood) || 0));
    progress.claimed[id] = now;
    if (amount <= 0) return 0;
    progress.totalMood += amount;
    pet.stats.mood = Math.max(CONFIG.statMin, Math.min(CONFIG.statMax, (Number(pet.stats.mood) || 0) + amount));
    savePetDebounced(pet);
    refreshPetStateUi(pet);
    if (playAnimation && petEl) playPetHappy(petEl, pet);
    return amount;
}

function scheduleCompanionMoodReward(pet, reward, petEl, now = Date.now()) {
    const progress = normalizeCompanionMoodProgress(pet, now);
    const id = companionRewardId(reward);
    const key = companionPendingKey(pet, progress, id);
    if (!id || __companionMoodPendingTimers.has(key)) return;
    const day = progress.day;
    const timer = setTimeout(() => {
        __companionMoodPendingTimers.delete(key);
        if (todayKey() !== day || state.currentView !== 'home' || pet !== __lastPet) return;
        const currentEl = getVisibleCompanionPetElement(pet);
        if (!currentEl) return;
        const gained = claimCompanionMoodReward(pet, reward, { now: Date.now(), petEl: currentEl, playAnimation: true });
        if (gained > 0) showCompanionMoodReward(gained, Date.now());
    }, 2000);
    __companionMoodPendingTimers.set(key, timer);
}

function showCompanionMoodReward(gained, now = Date.now()) {
    if (gained <= 0) return;
    showToast(`陪伴让心情 +${gained}`, 'success', 1400);
    try { window.dispatchEvent(new CustomEvent('mh:tick', { detail: { at: now, companionMood: gained } })); } catch (_) {}
}

function handleCompanionPetTouch(petEl, pet = __lastPet) {
    if (!pet || pet !== __lastPet || state.currentView !== 'home') return;
    const reward = (CONFIG.companionMood?.rewards || []).find(item => companionRewardId(item) === '60s')
        || (CONFIG.companionMood?.rewards || []).find(item => Number(item?.seconds) === 60);
    if (!reward) return;
    const gained = claimCompanionMoodReward(pet, reward, { now: Date.now(), petEl, playAnimation: false });
    if (gained > 0) showCompanionMoodReward(gained, Date.now());
}

// =============================================================================
// Level 切换：虫洞过渡 + 原地替换 stage 与 dock
// =============================================================================
function requestZoomLevel(target) {
    if (isDecorZoomLocked()) return;
    const to = clampLvl(target);
    if (to === state.zoomLevel) return;
    if (__mhZoomAnimating) return;
    clearPendingZoomTransition();
    clearCameraIdleReturn();
    runZoomTransition(state.zoomLevel, to);
}

function clearPendingZoomTransition() {
    if (!__pendingZoomTransitionTimer) return;
    clearTimeout(__pendingZoomTransitionTimer);
    __pendingZoomTransitionTimer = null;
}

function requestZoomLevelAfterFocus(target, boundaryCamera) {
    if (isDecorZoomLocked()) return;
    if (__mhZoomAnimating || __pendingZoomTransitionTimer) return;
    clearCameraIdleReturn();
    const level = LEVELS[state.zoomLevel];
    cameraZoom = boundaryCamera;
    applyCameraZoom();
    showZoomLevelBar();
    const delay = level?.cameraFocus ? 240 : 0;
    if (!delay) {
        requestZoomLevel(target);
        return;
    }
    const fromLevel = state.zoomLevel;
    __pendingZoomTransitionTimer = setTimeout(() => {
        __pendingZoomTransitionTimer = null;
        if (state.zoomLevel !== fromLevel) return;
        requestZoomLevel(target);
    }, delay);
}

function setCameraZoomFromGesture(next, direction) {
    const lvl = LEVELS[state.zoomLevel];
    const clamped = Math.max(lvl.minCamera, Math.min(lvl.maxCamera, next));
    if (Math.abs(clamped - cameraZoom) > 0.0015) {
        cameraZoom = clamped;
        soundManager.playZoomScrollBeep(direction);
        applyCameraZoom();
    }
}

function getZoomTransitionConfig() {
    const userConfig = window.__magicHaqiZoomTransition || window.MagicHaqiZoomTransition || {};
    const config = { ...DEFAULT_ZOOM_TRANSITION, ...userConfig };
    for (const key of ZOOM_TRANSITION_NUMERIC_KEYS) {
        const value = Number(config[key]);
        config[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_ZOOM_TRANSITION[key];
    }
    config.rayColor = normalizeRayColor(config.rayColor, DEFAULT_ZOOM_TRANSITION.rayColor);
    config.oldCameraMs = Math.min(config.oldCameraMs, config.oldSceneMs);
    config.newCameraMs = Math.min(config.newCameraMs, config.newSceneMs);
    return config;
}

function normalizeRayColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const color = value.trim();
    return color || fallback;
}

function applyZoomTransitionVars(el, config) {
    if (!el) return;
    el.style.setProperty('--mh-zoom-old-ms', `${config.oldSceneMs}ms`);
    el.style.setProperty('--mh-zoom-old-camera-ms', `${config.oldCameraMs}ms`);
    el.style.setProperty('--mh-zoom-flash-ms', `${config.flashMs}ms`);
    el.style.setProperty('--mh-zoom-new-ms', `${config.newSceneMs}ms`);
    el.style.setProperty('--mh-zoom-new-camera-ms', `${config.newCameraMs}ms`);
    el.style.setProperty('--mh-zoom-ray-color', config.rayColor);
}

function clearZoomTransitionVars(el) {
    if (!el) return;
    el.style.removeProperty('--mh-zoom-old-ms');
    el.style.removeProperty('--mh-zoom-old-camera-ms');
    el.style.removeProperty('--mh-zoom-flash-ms');
    el.style.removeProperty('--mh-zoom-new-ms');
    el.style.removeProperty('--mh-zoom-new-camera-ms');
    el.style.removeProperty('--mh-zoom-ray-color');
}

function runZoomTransition(from, to) {
    const direction = to > from ? 'in' : 'out';
    const stage = document.getElementById('mhStage');
    const dock  = document.getElementById('mhDock');
    if (!stage || !dock || !__lastPet) {
        state.zoomLevel = to;
        state.lastHomeZoomLevel = to;
        return;
    }

    __mhZoomAnimating = true;
    __levelJumpCompleted = false;
    stopCameraAnimation();
    clearWheelGestureEndTimer();
    LEVELS[from].onLeave?.();
    const transitionConfig = getZoomTransitionConfig();

    // 1) 虫洞 overlay
    const overlay = document.createElement('div');
    overlay.className = 'wormhole-overlay ' + (direction === 'in' ? 'wh-in' : 'wh-out');
    applyZoomTransitionVars(overlay, transitionConfig);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('wh-visible'));

    // 2) 音效
    soundManager.playZoomLevelSound(direction);

    // 3) 旧 stage 离场；dock 内容淡出
    applyZoomTransitionVars(stage, transitionConfig);
    stage.classList.add(direction === 'in' ? 'zoom-anim-out-in' : 'zoom-anim-out-out');
    dock.classList.add('mh-dock-fading');

    setTimeout(() => {
        overlay.classList.add('wh-flash');
        const pet = __lastPet;
        state.zoomLevel = to;
        state.lastHomeZoomLevel = to;
        const newLevel = LEVELS[to];

        // 进入新层时设定相机起点：使用该层最佳视角
        const bestCamera = getLevelBestCamera(newLevel);
        cameraZoom = bestCamera;
        visualCameraZoom = bestCamera;

        // 替换 stage 内容
        const inner = document.getElementById('mhStageInner');
        if (inner) inner.innerHTML = newLevel.stageHtml(pet);

        // 替换 dock 内容（dock 节点本身不动）
        rememberDockScrollPositions(dock);
        dock.innerHTML = newLevel.dockHtml(pet);

        // 同步 topbar zoom 标签 & stage class
        const zd = CONFIG.zoomLevels[to];
        const lab = document.getElementById('mhZoomLabel');
        if (lab) lab.innerHTML = `${zd.emoji} ${escapeHtml(zd.name)} · <i>${escapeHtml(zd.subtitle)}</i>`;
        refreshTopbarStatPills(pet);
        stage.className = `mh-stage zoom-${zd.id} ${state.isDecorMode && (to === 1 || to === 2) ? 'decor-mode' : ''} ${state.isFeedMode && to === 2 ? 'feed-mode' : ''}`;
        stage.style.touchAction = 'none';
        refreshZoomLevelBar(stage);

        const ctx = makeCtx(pet, __lastCallbacks);
        newLevel.bindStage(pet, ctx);
        newLevel.bindDock(pet, ctx);
        bindDockHorizontalScroll();
        restoreDockScrollPositions(dock);
        newLevel.onEnter?.(pet, ctx);
        if (to === 1) requestAnimationFrame(() => newLevel.centerPet?.(pet, { animate: true, duration: 460 }));
        applyCameraZoom();

        setTimeout(() => {
            // 4) 新 stage 进场动画 + 从全白遮罩逐渐揭示新场景
            stage.classList.remove('zoom-anim-out-in', 'zoom-anim-out-out');
            applyZoomTransitionVars(stage, transitionConfig);
            stage.classList.add(direction === 'in' ? 'zoom-anim-in-in' : 'zoom-anim-in-out');
            overlay.classList.remove('wh-flash');
            overlay.classList.add('wh-reveal');
            requestAnimationFrame(() => overlay.classList.remove('wh-visible'));

            dock.classList.remove('mh-dock-fading');
            dock.classList.add('mh-dock-fade-in');
            setTimeout(() => dock.classList.remove('mh-dock-fade-in'), transitionConfig.dockFadeMs);

            setTimeout(() => {
                stage.classList.remove('zoom-anim-in-in', 'zoom-anim-in-out');
                clearZoomTransitionVars(stage);
                overlay.remove();
                __mhZoomAnimating = false;
                __levelJumpCompleted = true;
                showZoomLevelBar({ autoHide: true, delay: 2000, requireLevelJumpCompleted: true });
                scheduleCameraIdleReturn();
            }, transitionConfig.newSceneMs);
        }, transitionConfig.flashMs);
    }, transitionConfig.oldSceneMs);
}

// =============================================================================
// 手势：滚轮 / 触摸 / 鼠标
// =============================================================================
function bindStageZoomGestures() {
    const stage = $('mhStage');
    if (!stage) return;

    // 滚轮
    const onWheelZoom = (e) => {
        if (shouldLetScrollableHandleWheel(e)) return;
        e.preventDefault();
        if (isDecorZoomLocked()) return;
        if (__mhZoomAnimating || __pendingZoomTransitionTimer) return;
        markCameraGestureStart();
        __wheelZoomDelta += normalizeWheelDelta(e);
        if (!__wheelZoomFrame) __wheelZoomFrame = requestAnimationFrame(flushWheelZoom);
        scheduleWheelGestureEnd();
    };
    stage.addEventListener('wheel', onWheelZoom, { passive: false });
    const dock = $('mhDock');
    if (dock && !dock.__mhWheelZoomBound) {
        dock.__mhWheelZoomBound = true;
        dock.addEventListener('wheel', onWheelZoom, { passive: false });
    }

    // 双指捏合 / 单指竖向滑动
    let pinchStartDist = null;
    let pinchStartZoom = 1.0;
    let pinchTriggered = false;
    let touchDragging = false;
    let touchGestureStarted = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartZoom = 1.0;
    let touchTriggered = false;
    let touchMoved = false;
    let suppressNextStageClick = false;
    const SWIPE_THRESHOLD = 6;       // px：小于此位移视为点击
    const dist = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    stage.addEventListener('click', (e) => {
        if (!suppressNextStageClick) return;
        suppressNextStageClick = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    stage.addEventListener('touchstart', (e) => {
        if (isDecorZoomLocked()) return;
        if (e.touches.length === 2) {
            markCameraGestureStart();
            pinchStartDist = dist(e.touches[0], e.touches[1]);
            pinchStartZoom = cameraZoom;
            pinchTriggered = false;
            touchDragging = false;
            touchGestureStarted = true;
            touchMoved = false;
        } else if (e.touches.length === 1) {
            // 触碰按钮等明确可交互元素时不进入拖动模式；星球、宠物和普通房间格子仍允许滑动缩放。
            if (isStageZoomGestureBlocked(e.target)) {
                touchDragging = false;
                touchGestureStarted = false;
                touchMoved = false;
                return;
            }
            touchDragging = true;
            touchGestureStarted = false;
            touchTriggered = false;
            touchMoved = false;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartZoom = cameraZoom;
        }
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
        if (isDecorZoomLocked()) return;
        if (__mhZoomAnimating || __pendingZoomTransitionTimer) return;
        // 双指捏合
        if (e.touches.length === 2 && pinchStartDist != null && !pinchTriggered) {
            const d = dist(e.touches[0], e.touches[1]);
            const target = pinchStartZoom * (d / pinchStartDist);
            const lvl = LEVELS[state.zoomLevel];
            if (target > lvl.maxCamera * 1.05 && state.zoomLevel < LEVELS.length - 1) {
                pinchTriggered = true;
                requestZoomLevelAfterFocus(state.zoomLevel + 1, lvl.maxCamera);
                return;
            }
            if (target < lvl.minCamera * 0.95 && state.zoomLevel > 0) {
                pinchTriggered = true;
                requestZoomLevel(state.zoomLevel - 1);
                return;
            }
            setCameraZoomFromGesture(target, target >= cameraZoom ? 'in' : 'out');
            scheduleCameraIdleReturn();
            return;
        }
        // 单指竖向拖动 → 模拟"滚动"缩放
        if (e.touches.length === 1 && touchDragging && !touchTriggered) {
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;
            if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
                touchDragging = false;
                touchGestureStarted = false;
                touchMoved = true;
                forceBestCameraDistance();
                return;
            }
            if (Math.abs(dy) < SWIPE_THRESHOLD) return;
            touchMoved = true;
            if (!touchGestureStarted) {
                markCameraGestureStart();
                touchGestureStarted = true;
            }
            // 向上滑（dy<0）→ 推近放大；向下滑 → 拉远缩小
            const target = touchStartZoom * Math.exp(-dy / 220);
            const lvl = LEVELS[state.zoomLevel];
            if (target > lvl.maxCamera * 1.05 && state.zoomLevel < LEVELS.length - 1) {
                touchTriggered = true;
                touchDragging = false;
                requestZoomLevelAfterFocus(state.zoomLevel + 1, lvl.maxCamera);
                return;
            }
            if (target < lvl.minCamera * 0.95 && state.zoomLevel > 0) {
                touchTriggered = true;
                touchDragging = false;
                requestZoomLevel(state.zoomLevel - 1);
                return;
            }
            setCameraZoomFromGesture(target, target >= cameraZoom ? 'in' : 'out');
            scheduleCameraIdleReturn();
        }
    }, { passive: true });

    stage.addEventListener('touchend', () => {
        pinchStartDist = null; pinchTriggered = false;
        if (touchMoved) {
            suppressNextStageClick = true;
            setTimeout(() => { suppressNextStageClick = false; }, 350);
        }
        touchDragging = false; touchTriggered = false; touchMoved = false;
        if (touchGestureStarted) markCameraGestureEnd();
        touchGestureStarted = false;
    }, { passive: true });
    stage.addEventListener('touchcancel', () => {
        pinchStartDist = null; pinchTriggered = false;
        touchDragging = false; touchTriggered = false; touchMoved = false;
        if (touchGestureStarted) markCameraGestureEnd();
        touchGestureStarted = false;
    }, { passive: true });

    // 鼠标拖动
    let mouseDragging = false;
    let mouseMoved = false;
    let mouseGestureStarted = false;
    let mouseStartX = 0;
    let mouseStartY = 0;
    let mouseStartZoom = 1.0;
    stage.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (isDecorZoomLocked()) return;
        if (isStageZoomGestureBlocked(e.target)) return;
        mouseDragging = true;
        mouseMoved = false;
        mouseGestureStarted = false;
        mouseStartX = e.clientX;
        mouseStartY = e.clientY;
        mouseStartZoom = cameraZoom;
    });
    window.addEventListener('mousemove', (e) => {
        if (!mouseDragging || __mhZoomAnimating || __pendingZoomTransitionTimer) return;
        const dx = e.clientX - mouseStartX;
        const dy = e.clientY - mouseStartY;
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            mouseDragging = false;
            mouseMoved = true;
            forceBestCameraDistance();
            if (mouseGestureStarted) markCameraGestureEnd();
            mouseGestureStarted = false;
            return;
        }
        if (Math.abs(dy) < SWIPE_THRESHOLD) return;
        mouseMoved = true;
        if (!mouseGestureStarted) {
            markCameraGestureStart();
            mouseGestureStarted = true;
        }
        // 向上拖（dy<0）→ 推近，放大；向下拖 → 拉远
        const target = mouseStartZoom * Math.exp(-dy / 220);
        const lvl = LEVELS[state.zoomLevel];
        if (target > lvl.maxCamera * 1.05 && state.zoomLevel < LEVELS.length - 1) {
            requestZoomLevelAfterFocus(state.zoomLevel + 1, lvl.maxCamera);
            return;
        }
        if (target < lvl.minCamera * 0.95 && state.zoomLevel > 0) {
            requestZoomLevel(state.zoomLevel - 1);
            return;
        }
        setCameraZoomFromGesture(target, target >= cameraZoom ? 'in' : 'out');
        scheduleCameraIdleReturn();
    });
    window.addEventListener('mouseup', () => {
        if (!mouseDragging) return;
        mouseDragging = false;
        if (mouseMoved) {
            suppressNextStageClick = true;
            setTimeout(() => { suppressNextStageClick = false; }, 350);
        }
        mouseMoved = false;
        if (mouseGestureStarted) markCameraGestureEnd();
        mouseGestureStarted = false;
    });
}

function normalizeWheelDelta(e) {
    const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    return Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, e.deltaY * modeScale));
}

function flushWheelZoom() {
    __wheelZoomFrame = 0;
    if (!__wheelZoomDelta || __mhZoomAnimating || __pendingZoomTransitionTimer) {
        __wheelZoomDelta = 0;
        return;
    }
    const delta = Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, __wheelZoomDelta));
    __wheelZoomDelta -= delta;
    const factor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
    applyDelta(factor);
    showZoomLevelBar();
    scheduleCameraIdleReturn();
    if (Math.abs(__wheelZoomDelta) > 0.5) __wheelZoomFrame = requestAnimationFrame(flushWheelZoom);
    else __wheelZoomDelta = 0;
}

function shouldLetScrollableHandleWheel(e) {
    if (e.target.closest?.('.modal-mask, input, textarea, select, [contenteditable="true"]')) return true;
    const scroller = e.target.closest?.('.mh-scroll-x');
    return !!(scroller && Math.abs(e.deltaX) > Math.abs(e.deltaY));
}

function isStageZoomGestureBlocked(target) {
    if (!target?.closest) return false;
    if (target.closest('.remote-planet, .remote-mini-planet, .space-planet')) return false;
    if (target.closest('.poop-btn')) return false;
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"], .field-item, [data-tray-item], .field-tab, .bad-cell')) return true;
    if (state.zoomLevel === 1 && state.isDecorMode && target.closest('.field-item')) return true;
    if (state.zoomLevel === 2 && (state.isDecorMode || state.isFeedMode) && target.closest('.room-cell, .furniture')) return true;
    return false;
}

function applyDelta(factor) {
    if (isDecorZoomLocked()) return;
    const lvl = LEVELS[state.zoomLevel];
    const next = cameraZoom * factor;
    if (next > lvl.maxCamera) {
        if (state.zoomLevel < LEVELS.length - 1) requestZoomLevelAfterFocus(state.zoomLevel + 1, lvl.maxCamera);
        else { cameraZoom = lvl.maxCamera; applyCameraZoom(); }
    } else if (next < lvl.minCamera) {
        if (state.zoomLevel > 0) requestZoomLevel(state.zoomLevel - 1);
        else { cameraZoom = lvl.minCamera; applyCameraZoom(); }
    } else {
        setCameraZoomFromGesture(next, factor >= 1 ? 'in' : 'out');
    }
}

function bindDockHorizontalScroll() {
    const DRAG_CLICK_THRESHOLD = 8;
    document.querySelectorAll('#mhDock .mh-scroll-x').forEach((el) => {
        if (el.__mhDragScrollBound) return;
        el.__mhDragScrollBound = true;

        let dragging = false;
        let moved = false;
        let startX = 0;
        let anchorX = 0;
        let anchorScrollLeft = 0;
        let suppressClick = false;
        let touchPointer = null;

        const markScrolled = () => {
            suppressClick = true;
            el.__mhDragScrolledAt = Date.now();
            rememberDockScrollPosition(el);
            setTimeout(() => { suppressClick = false; }, 0);
        };

        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') {
                if (el.scrollWidth <= el.clientWidth + 2) return;
                touchPointer = {
                    id: e.pointerId,
                    x: e.clientX,
                    scrollLeft: el.scrollLeft,
                    anchorX: e.clientX,
                    anchorScrollLeft: el.scrollLeft,
                };
                el.setPointerCapture?.(e.pointerId);
                return;
            }
            if (e.button !== 0) return;
            if (e.target.closest?.('a, input, textarea, select, [contenteditable="true"]')) return;
            if (el.scrollWidth <= el.clientWidth + 2) return;
            dragging = true;
            moved = false;
            startX = e.clientX;
            anchorX = e.clientX;
            anchorScrollLeft = el.scrollLeft;
            el.classList.add('is-dragging');
            el.setPointerCapture?.(e.pointerId);
        });

        el.addEventListener('pointermove', (e) => {
            if (touchPointer && touchPointer.id === e.pointerId) {
                const movedByDrag = Math.abs(e.clientX - touchPointer.x) > DRAG_CLICK_THRESHOLD;
                const movedByScroll = Math.abs(el.scrollLeft - touchPointer.scrollLeft) > 1;
                if (movedByDrag) {
                    e.preventDefault();
                    const beforeScrollLeft = el.scrollLeft;
                    el.scrollLeft = touchPointer.anchorScrollLeft - (e.clientX - touchPointer.anchorX);
                    if (Math.abs(el.scrollLeft - beforeScrollLeft) > 0.5) {
                        rememberDockScrollPosition(el);
                    } else if (e.clientX !== touchPointer.anchorX) {
                        touchPointer.anchorX = e.clientX;
                        touchPointer.anchorScrollLeft = el.scrollLeft;
                    }
                }
                if (movedByDrag || movedByScroll || Math.abs(el.scrollLeft - touchPointer.scrollLeft) > 1) el.__mhTouchScrollMoved = true;
                return;
            }
            if (!dragging) return;
            if (Math.abs(e.clientX - startX) > DRAG_CLICK_THRESHOLD) moved = true;
            if (moved) e.preventDefault();
            const beforeScrollLeft = el.scrollLeft;
            el.scrollLeft = anchorScrollLeft - (e.clientX - anchorX);
            if (Math.abs(el.scrollLeft - beforeScrollLeft) > 0.5) {
                rememberDockScrollPosition(el);
                return;
            }
            if (e.clientX !== anchorX) {
                anchorX = e.clientX;
                anchorScrollLeft = el.scrollLeft;
            }
        });

        const endDrag = (e) => {
            if (touchPointer && touchPointer.id === e.pointerId) {
                const movedByDrag = Math.abs(e.clientX - touchPointer.x) > DRAG_CLICK_THRESHOLD;
                const movedByScroll = Math.abs(el.scrollLeft - touchPointer.scrollLeft) > 1;
                if (el.__mhTouchScrollMoved || movedByDrag || movedByScroll) markScrolled();
                el.releasePointerCapture?.(e.pointerId);
                touchPointer = null;
                el.__mhTouchScrollMoved = false;
                return;
            }
            if (!dragging) return;
            dragging = false;
            el.classList.remove('is-dragging');
            el.releasePointerCapture?.(e.pointerId);
            if (moved) markScrolled();
        };

        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);
    });
}

// =============================================================================
// 弹窗：宠物状态详情 / 主菜单
// =============================================================================
function openModal(innerHtml, onClick, onClose) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal-card">${innerHtml}</div>`;
    const close = () => {
        if (!mask.isConnected) return;
        onClose?.();
        mask.remove();
    };
    mask.addEventListener('click', (e) => {
        if (e.target === mask) { close(); return; }
        onClick?.(e, close);
    });
    document.body.appendChild(mask);
    return { mask, close };
}

function showTopbarResourceConfirm(key, callbacks = __lastCallbacks) {
    const info = resourceInfo(key);
    const value = resourceValue(key);
    openModal(`
        <div style="text-align:left">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;color:var(--text-primary);font-size:18px;font-weight:900">
                <span style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center">${info.icon}</span>
                <span>${escapeHtml(info.label)}：${value}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:14px;font-weight:700;line-height:1.55">${escapeHtml(info.description)}</div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
            <button class="btn-secondary" data-act="close">关闭</button>
            <button class="btn-primary" data-act="open-shop">打开商店</button>
        </div>
    `, (e, close) => {
        if (e.target.closest?.('[data-act="close"]')) { close(); return; }
        if (e.target.closest?.('[data-act="open-shop"]')) {
            soundManager.playButtonClick();
            close();
            callbacks?.onNav?.('shop');
        }
    });
}

function showTopbarStatConfirm(key, pet = __lastPet) {
    const current = pet || __lastPet;
    const item = PET_STAT_ITEMS.find(it => it.k === key);
    if (!current || !item) return;
    const value = statValue(current, key);
    const label = t(item.labelKey);
    const level = stateLevel(value);
    const message = `${label}：${value}，${item.lowText}。当前状态：${level.label}。`;
    openModal(`
        <div style="text-align:left">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;color:var(--text-primary);font-size:18px;font-weight:900">
                <span style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;font-size:22px">${item.icon}</span>
                <span>${escapeHtml(displayPetNameWithoutTag(current))}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:14px;font-weight:700;line-height:1.55">${escapeHtml(message)}</div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
            <button class="btn-secondary" data-act="close">关闭</button>
            <button class="btn-primary" data-act="open-stats">查看更多属性</button>
        </div>
    `, (e, close) => {
        if (e.target.closest?.('[data-act="close"]')) { close(); return; }
        if (e.target.closest?.('[data-act="open-stats"]')) {
            soundManager.playButtonClick();
            close();
            showPetDetailsModal(current);
        }
    });
}

function showPetDetailsModal(pet) {
    const lowest = getLowestCareStat(pet);
    const summary = lowest ? `${lowest.icon} ${t(lowest.labelKey)} ${lowest.value} · ${lowest.lowText}` : '宠物状态';
    const rows = PET_STAT_ITEMS.map(it => {
        const v = statValue(pet, it.k);
        const level = stateLevel(v);
        return `
            <div class="pet-state-row state-${level.key}">
                <span class="pet-state-icon">${it.icon}</span>
                <span class="pet-state-label">${escapeHtml(t(it.labelKey))}</span>
                <div class="stat-bar pet-state-bar"><div data-mh-stat-fill="${it.k}" style="width:${v}%;background:${it.color}"></div></div>
                <span class="pet-state-value" data-mh-stat-value="${it.k}">${v}</span>
            </div>`;
    }).join('');
    openModal(`
        <div style="text-align:center;margin-bottom:8px">
            <div style="font-size:18px;font-weight:800;color:var(--text-primary)">${escapeHtml(displayPetNameWithoutTag(pet))} ${escapeHtml(getStageName(pet.stage, pet.stage || ''))}</div>
            <div class="text-xs" style="color:var(--text-muted)">${escapeHtml(summary)}</div>
        </div>
        <div class="pet-state-list">${rows}</div>
        <div style="text-align:center;margin-top:14px">
            <button class="btn-primary" data-act="close">关闭</button>
        </div>
    `, (e, close) => {
        if (e.target.closest?.('[data-act="close"]')) close();
    });
    refreshPetStateUi(pet);
}

function showMenuModal(callbacks) {
    const items = [
        { k: 'petList',   icon: '🐾', label: t('petList') },
        { k: 'shop',      icon: '🛒', label: t('shop') },
        { k: 'inventory', icon: '🎒', label: t('inventory') },
        { k: 'help',      icon: '❔', label: t('help') },
        { k: 'profile',   icon: '📋', label: t('profile') },
        { k: 'settings',  icon: '⚙️', label: t('settings') },
    ];
    let timeTimer = null;
    const updateTime = (root) => {
        const el = root.querySelector('.menu-local-time');
        if (el) el.textContent = formatMenuTime();
    };
    const modal = openModal(`
        <div class="menu-modal">
            <div class="menu-status-bar">
                <span class="menu-local-time">${escapeHtml(formatMenuTime())}</span>
                <button class="menu-close-btn" data-act="close" type="button" aria-label="关闭菜单">×</button>
            </div>
            <div class="menu-app-grid">
                ${items.map(it => `
                    <button class="menu-app-btn" data-nav="${it.k}" aria-label="${escapeHtml(it.label)}">
                        <span class="menu-app-icon">${it.icon}</span>
                        <span class="menu-app-label">${escapeHtml(it.label)}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    `, (e, close) => {
        const navBtn = e.target.closest?.('[data-nav]');
        if (navBtn) { close(); callbacks.onNav?.(navBtn.dataset.nav); return; }
        if (e.target.closest?.('[data-act="close"]')) close();
    }, () => {
        if (timeTimer) clearInterval(timeTimer);
    });
    timeTimer = setInterval(() => updateTime(modal.mask), 1000);
}

function formatMenuTime() {
    return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

// 防止 lint 警告：保留 _setZoomLevelRaw 引用（未来若需要兼容旧路径可用）
void _setZoomLevelRaw;
