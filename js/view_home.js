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
import { CONFIG, getDefaultZoomLevelIndex, getStageName, getVisibleZoomLevelIndices, resolveZoomLevelIndex } from './config.js';
import { isVisitingMode, state, setZoomLevel as _setZoomLevelRaw } from './state.js';
import { savePetDebounced } from './storage.js';
import { displayPetName } from './dna.js';

import { planetLevel, showPlanetResearchPanel } from './level_planet.js';
import { showVisitReturnPrompt } from './view_spacetravel.js';
import { fieldLevel }  from './level_field.js';
import { petLevel, stopPetWalk } from './level_pet.js';
import { cellLevel, stopCellGame } from './level_cell.js';
import { playPetHappy } from './pet.js';
import { getRuntimePetStats } from './petLifecycle.js';
import { getActiveSickness, getEffectiveSicknessSeverity } from './petTick.js';
import { computePlanetProgress } from './planetProgress.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();

const LEVELS = [planetLevel, fieldLevel, petLevel, cellLevel];
// Only the field level carries scene background music. Whenever we bind a
// different zoom level (planet / pet / cell), stop the field music so it does
// not bleed into a silent scene. The field level manages its own music in
// fieldLevel.bindStage (playing it, or stopping it for music-less scenes).
function syncBgMusicForLevel(level) {
    if (level !== fieldLevel) soundManager.stopBgMusic?.({ fadeMs: 360 });
}
const DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MH_DOCK_HEIGHT = 128;
const CAMERA_SETTLE_EPSILON = 0.0004;
const CAMERA_SMOOTHING = 12;
const CAMERA_MAX_DT = 0.05;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const WHEEL_DELTA_LIMIT = 300;
const WHEEL_CONSUME_RATE = 0.38;
const PRE_RENDER_FALLBACK_DELAY = 900;
const ZOOM_BAR_STAGES = [
    { id: 'planet', labelKey: 'zoomPlanet', color: '#172554', hintKey: 'hintToPlanet' },
    { id: 'field', labelKey: 'zoomField', color: '#65a30d', hintKey: 'hintToField' },
    { id: 'pet', labelKey: 'zoomPet', color: '#facc15', hintKey: 'hintToPet' },
    { id: 'cell', labelKey: 'zoomCell', color: '#f9a8d4', hintKey: 'hintToCell' },
];

const CARE_STAT_KEYS = ['hunger', 'mood', 'clean', 'bond'];
const PET_STAT_ITEMS = [
    { k: 'hunger', labelKey: 'statEnergy', icon: '⚡', color: '#84cc16', lowTextKey: 'needRestFood' },
    { k: 'mood',   labelKey: 'statMood',   icon: '😊', color: '#ec4899', lowTextKey: 'wantPlayCompany' },
    { k: 'clean',  labelKey: 'statClean',  icon: '🛁', color: '#06b6d4', lowTextKey: 'needClean' },
    { k: 'bond',   labelKey: 'statBond',   icon: '💛', color: '#a855f7', lowTextKey: 'wantCloser' },
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

// 归属标签：有昵称直接显示昵称，否则回退到用户名。优先使用拜访好友信息。
function currentOwnerLabel() {
    if (isVisitingMode()) {
        const visit = state.visitingMode || {};
        const username = String(visit.friendUsername || '').trim();
        const nickname = String(visit.friendName || '').trim();
        return nickname || username || String(visit.planetName || '好友').trim() || '好友';
    }
    const user = state.user || {};
    const username = String(user.username || '').trim();
    const nickname = String(user.nickname || user.displayName || user.name || '').trim();
    return nickname || username || '我';
}

// 取当前层正在展示的宠物（拜访时为好友宠物）。
function currentDisplayPet(pet = __lastPet) {
    if (isVisitingMode()) return state.visitingMode?.friendPet || pet;
    return pet;
}

// 根据当前缩放层生成顶栏标题。
//  · planet(0)：星球名 / appTitle
//  · field(1) ：username(nickname)的星球
//  · pet(2)   ：username(nickname)的家
//  · cell(3)  ：当前宠物的细胞
function currentAppTitle(lvl = state.zoomLevel, pet = __lastPet) {
    if (lvl === 1) return t('ownerPlanet', { owner: currentOwnerLabel() });
    if (lvl === 2) return t('ownerHome', { owner: currentOwnerLabel() });
    if (lvl === 3) {
        const name = displayPetName(currentDisplayPet(pet)) || t('petFallback');
        return t('petCell', { name });
    }
    // planet 层（最外层 / 太空）
    if (isVisitingMode()) {
        const visitName = String(state.visitingMode?.planetName || '').trim();
        if (visitName) return visitName;
    }
    const title = String(state.settings?.starSettlement?.appTitle || '').trim();
    return title || t('appName');
}

// 仅更新顶栏标题文本（层切换时调用，topbar 节点不会被替换）。
function refreshAppTitle(lvl = state.zoomLevel, pet = __lastPet) {
    const title = currentAppTitle(lvl, pet);
    const titleEl = document.querySelector('.mh-brand-title');
    if (titleEl) titleEl.textContent = title;
    const logoEl = document.querySelector('.mh-brand-logo');
    if (logoEl) logoEl.setAttribute('aria-label', title);
}

function currentZoomOptions() {
    return state.settings?.starSettlement?.source === 'official'
        ? state.settings.starSettlement.zoomOptions || {}
        : {};
}

function defaultHomeZoomLevel() {
    return getDefaultZoomLevelIndex(currentZoomOptions());
}

// 拜访的是官方 / 名人星球（而非真实好友用户）时为 true。
// 这类星球没有真实用户账号，因此只暴露到「星球」层（不进入宠物房间 / 细胞）。
function isNonUserPlanetVisit() {
    if (!isVisitingMode()) return false;
    const visit = state.visitingMode;
    if (visit?.officialPlanetId) return true;
    return !visit?.friendUserId && !visit?.friendUsername;
}

// 拜访时可进入的最高缩放层：好友（真实用户）到「家」(2)，官方/名人星球只到「星球」(1)。
function maxVisitingZoomLevel() {
    return isNonUserPlanetVisit() ? 1 : 2;
}

function visibleZoomLevels() {
    let indices = getVisibleZoomLevelIndices(currentZoomOptions());
    if (isVisitingMode()) {
        const maxLevel = maxVisitingZoomLevel();
        indices = indices.filter(index => index <= maxLevel);
    }
    return indices.length ? indices : getVisibleZoomLevelIndices({});
}

function resolveHomeZoomLevel(target, from = state.zoomLevel) {
    let resolved = resolveZoomLevelIndex(target, currentZoomOptions(), from);
    if (isVisitingMode()) {
        const maxLevel = maxVisitingZoomLevel();
        if (resolved > maxLevel) resolved = resolveZoomLevelIndex(maxLevel, currentZoomOptions(), from);
    }
    return resolved;
}

function nextVisibleZoomLevel(direction, from = state.zoomLevel) {
    const current = clampLvl(from ?? 0);
    const visible = visibleZoomLevels();
    return direction > 0
        ? (visible.find(index => index > current) ?? current)
        : ([...visible].reverse().find(index => index < current) ?? current);
}
let __levelJumpCompleted = false;
const __dockScrollPositions = new Map();
let __stageZoomWindowCleanup = null;
let __sceneWipeCanvas = null;
let __sceneWipeFrame = 0;

// ========== DocumentFragment 预缓存系统 ==========
// 在空闲时预渲染相邻层的 stageHtml + dockHtml，切换时直接移植节点而非解析 HTML
const __levelCache = new Map(); // key: levelIndex → { stageEl, dockEl, petId, ts }
let __preRenderIdleHandle = null;
let __preRenderQueue = [];

function invalidateLevelCache(levelIndex) {
    if (levelIndex === undefined) {
        __levelCache.clear();
        __preRenderQueue = [];
        return;
    }
    __levelCache.delete(levelIndex);
    __preRenderQueue = __preRenderQueue.filter(queuedLevel => queuedLevel !== levelIndex);
}

function preRenderLevel(levelIndex, pet) {
    if (!pet || levelIndex < 0 || levelIndex >= LEVELS.length) return;
    const level = LEVELS[levelIndex];
    const stageEl = document.createElement('div');
    stageEl.innerHTML = level.stageHtml(pet);
    const dockEl = document.createElement('div');
    dockEl.innerHTML = level.dockHtml(pet);
    __levelCache.set(levelIndex, { stageEl, dockEl, petId: pet.id, ts: Date.now() });
}

function schedulePreRenderAdjacent() {
    if (__preRenderIdleHandle) {
        (typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout)(__preRenderIdleHandle);
        __preRenderIdleHandle = null;
    }
    __preRenderQueue = [];
}

function flushDeferredPreRenderQueue() {
    if (__mhZoomAnimating || __cameraGestureActive || __pendingZoomTransitionTimer || !__lastPet) {
        schedulePreRenderAdjacent();
        return;
    }
    const nextLevel = __preRenderQueue.shift();
    if (nextLevel === undefined) return;
    if (!isLevelCacheValid(nextLevel, __lastPet)) preRenderLevel(nextLevel, __lastPet);
    if (!__preRenderQueue.length) return;
    const schedule = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (fn) => setTimeout(fn, PRE_RENDER_FALLBACK_DELAY);
    __preRenderIdleHandle = schedule(() => {
        __preRenderIdleHandle = null;
        flushDeferredPreRenderQueue();
    }, { timeout: 2000 });
}

function isLevelCacheValid(levelIndex, pet) {
    const cached = __levelCache.get(levelIndex);
    if (!cached) return false;
    if (cached.petId !== pet?.id) return false;
    // 缓存 10s 内有效
    if (Date.now() - cached.ts > 10000) return false;
    return true;
}

function useCachedLevel(levelIndex, pet, inner, dock) {
    const cached = __levelCache.get(levelIndex);
    if (!cached || cached.petId !== pet?.id) return false;
    // 使用预渲染的 DOM 节点（直接移植，跳过 HTML 解析）
    inner.textContent = '';
    while (cached.stageEl.firstChild) inner.appendChild(cached.stageEl.firstChild);
    dock.textContent = '';
    while (cached.dockEl.firstChild) dock.appendChild(cached.dockEl.firstChild);
    __levelCache.delete(levelIndex);
    return true;
}

function scheduleTransitionFollowup(task) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            task?.();
        });
    });
}

function getOrCreateSceneWipeCanvas() {
    if (!__sceneWipeCanvas || !__sceneWipeCanvas.isConnected) {
        __sceneWipeCanvas = document.createElement('canvas');
        __sceneWipeCanvas.className = 'scene-wipe-canvas';
        __sceneWipeCanvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(__sceneWipeCanvas);
    }
    return __sceneWipeCanvas;
}

function resetSceneWipeCanvas() {
    if (__sceneWipeFrame) cancelAnimationFrame(__sceneWipeFrame);
    __sceneWipeFrame = 0;
    const canvas = __sceneWipeCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
    canvas.style.display = 'none';
}

function playSceneWipe({ phase, cx = 50, cy = 50, color = '#0c1025', duration = 600 }) {
    resetSceneWipeCanvas();
    const canvas = getOrCreateSceneWipeCanvas();
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return Promise.resolve();

    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.ceil(viewportWidth * dpr);
    canvas.height = Math.ceil(viewportHeight * dpr);
    canvas.style.display = 'block';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const centerX = viewportWidth * (Math.max(0, Math.min(100, Number(cx) || 50)) / 100);
    const centerY = viewportHeight * (Math.max(0, Math.min(100, Number(cy) || 50)) / 100);
    const farX = Math.max(centerX, viewportWidth - centerX);
    const farY = Math.max(centerY, viewportHeight - centerY);
    const maxRadius = Math.hypot(farX, farY) * 1.08;
    const ease = phase === 'closing'
        ? (t) => t * t * (3 - 2 * t)
        : (t) => 1 - Math.pow(1 - t, 3);
    const startedAt = performance.now();
    drawSceneWipeFrame(ctx, viewportWidth, viewportHeight, centerX, centerY, phase === 'closing' ? 0 : maxRadius, 0, phase, color);

    return new Promise((resolve) => {
        const draw = (now) => {
            const raw = Math.max(0, Math.min(1, (now - startedAt) / duration));
            const eased = ease(raw);
            const radius = phase === 'closing'
                ? maxRadius * eased
                : maxRadius * (1 - eased);
            drawSceneWipeFrame(ctx, viewportWidth, viewportHeight, centerX, centerY, radius, raw, phase, color);
            if (raw < 1) {
                __sceneWipeFrame = requestAnimationFrame(draw);
                return;
            }
            __sceneWipeFrame = 0;
            if (phase === 'opening') resetSceneWipeCanvas();
            resolve();
        };
        __sceneWipeFrame = requestAnimationFrame(draw);
    });
}

function drawSceneWipeFrame(ctx, width, height, cx, cy, radius, progress, phase, color) {
    ctx.clearRect(0, 0, width, height);
    if (radius <= 0.5) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = createSceneWipeFill(ctx, width, height, color);
    ctx.fillRect(0, 0, width, height);
    drawSceneWipeLines(ctx, width, height, progress, phase);
    drawSceneWipeGlow(ctx, cx, cy, radius, progress, phase);
    ctx.restore();
}

function createSceneWipeFill(ctx, width, height, color) {
    const css = String(color || '').trim();
    if (css.startsWith('linear-gradient(')) return createSceneLinearGradient(ctx, width, height, css);
    if (css.startsWith('radial-gradient(')) return createSceneRadialGradient(ctx, width, height, css);
    return css || '#0c1025';
}

function createSceneLinearGradient(ctx, width, height, css) {
    const stops = parseGradientStops(css);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    addCanvasGradientStops(gradient, stops);
    return gradient;
}

function createSceneRadialGradient(ctx, width, height, css) {
    const firstArg = getGradientArgs(css)[0] || '';
    const atMatch = firstArg.match(/at\s+([\d.]+)%\s+([\d.]+)%/i);
    const cx = width * ((Number(atMatch?.[1]) || 50) / 100);
    const cy = height * ((Number(atMatch?.[2]) || 50) / 100);
    const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    addCanvasGradientStops(gradient, parseGradientStops(css));
    return gradient;
}

function parseGradientStops(css) {
    const args = getGradientArgs(css);
    const colorStops = args.filter(arg => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(arg));
    return colorStops.map((arg, index) => {
        const colorMatch = arg.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i);
        const percentMatches = [...arg.matchAll(/(-?[\d.]+)%/g)].map(match => Number(match[1]));
        const offset = percentMatches.length ? percentMatches[percentMatches.length - 1] / 100 : (colorStops.length <= 1 ? 0 : index / (colorStops.length - 1));
        return { color: colorMatch?.[0] || '#0c1025', offset: Math.max(0, Math.min(1, offset)) };
    });
}

function getGradientArgs(css) {
    const body = css.slice(css.indexOf('(') + 1, css.lastIndexOf(')'));
    const args = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
            args.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }
    args.push(body.slice(start).trim());
    return args;
}

function addCanvasGradientStops(gradient, stops) {
    const normalized = stops.length ? stops : [{ color: '#0c1025', offset: 0 }, { color: '#0c1025', offset: 1 }];
    normalized.forEach(stop => gradient.addColorStop(stop.offset, stop.color));
    if (normalized[0].offset > 0) gradient.addColorStop(0, normalized[0].color);
    const last = normalized[normalized.length - 1];
    if (last.offset < 1) gradient.addColorStop(1, last.color);
}

function drawSceneWipeLines(ctx, width, height, progress, phase) {
    const opacity = phase === 'closing'
        ? (progress < 0.3 ? progress / 0.3 * 0.6 : 0.6 + (progress - 0.3) / 0.7 * (0.35 - 0.6))
        : (progress < 0.7 ? 0.35 + progress / 0.7 * (0.6 - 0.35) : 0.6 * (1 - (progress - 0.7) / 0.3));
    if (opacity <= 0.01) return;
    const offset = phase === 'closing' ? -24 * progress : -24 - 24 * progress;
    const lineStops = [
        { y: 0, alpha: 0.22 },
        { y: 12, alpha: 0.18 },
        { y: 24, alpha: 0.14 },
        { y: 36, alpha: 0.10 },
    ];
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    for (let tileY = -48 + (offset % 48); tileY < height + 48; tileY += 48) {
        for (const stop of lineStops) {
            ctx.globalAlpha = opacity * stop.alpha;
            const y = Math.round(tileY + stop.y) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
}

function drawSceneWipeGlow(ctx, cx, cy, radius, progress, phase) {
    const opacity = phase === 'closing'
        ? (progress < 0.35 ? progress / 0.35 * 0.75 : 0.75 + (progress - 0.35) / 0.65 * (0.45 - 0.75))
        : (progress < 0.65 ? 0.45 + progress / 0.65 * (0.75 - 0.45) : 0.75 * (1 - (progress - 0.65) / 0.35));
    if (opacity <= 0.01) return;
    const glowRadius = Math.max(radius * 0.74, 16);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, `rgba(255,255,255,${0.4 * opacity})`);
    gradient.addColorStop(0.28, `rgba(255,255,255,${0.08 * opacity})`);
    gradient.addColorStop(0.52, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2);
}

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
        panel.innerHTML = `<div class="absolute inset-0 flex items-center justify-center" style="color:var(--text-muted)">${escapeHtml(t('noSelectedPet'))}</div>`;
        return;
    }
    rememberDockScrollPositions(panel);
    stopPetWalk();
    stopCellGame();

    __lastPet = pet;
    __lastCallbacks = callbacks;

    const rawLevel = Number.isFinite(state.zoomLevel) || state.zoomLevel != null ? state.zoomLevel : defaultHomeZoomLevel();
    const lvl = resolveHomeZoomLevel(rawLevel, state.lastHomeZoomLevel);
    state.zoomLevel = lvl;
    state.lastHomeZoomLevel = lvl;

    const zoomDef = CONFIG.zoomLevels[lvl];
    const level = LEVELS[lvl];
    const appTitle = currentAppTitle(lvl, pet);
    clearCameraIdleReturn();
    // 起点相机：使用该层最佳视角
    cameraZoom = getLevelBestCamera(level);
    visualCameraZoom = cameraZoom;

    panel.innerHTML = `
        <div class="topbar">
            <div class="mh-brand-logo" aria-label="${escapeHtml(appTitle)}">
                <span class="mh-brand-title">${escapeHtml(appTitle)}</span>
            </div>
            <div class="home-hud">
                <span class="home-hud-stats" id="mhTopbarStats">${renderTopbarHudItems(pet, lvl)}</span>
                <button class="btn-icon" id="mhMenuBtn" title="${escapeHtml(t('menu'))}" style="width:36px;height:36px;font-size:18px">☰</button>
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
        </div>
        ${String(state.settings?.starSettlement?.planetId || '').trim() === 'shenzhen_zoo' ? `
        <button class="mh-zoo-encyclopedia-float" id="mhZooEncFloat" title="${escapeHtml(t('encTitle'))}">
            <span class="mh-zoo-enc-icon">📖</span>
            <span class="mh-zoo-enc-label">${escapeHtml(t('encTitle'))}</span>
        </button>` : ''}
        ${String(state.settings?.starSettlement?.planetId || '').trim() === 'shenzhen_zoo' ? `
        <button class="mh-guide-avatar" id="mhGuideAvatar" title="${escapeHtml(t('guideChat'))}">
            <span class="mh-guide-face">🐯</span>
        </button>
        <div class="mh-guide-bubble" id="mhGuideBubble"></div>
        <div class="mh-guide-chat-overlay" id="mhGuideChatOverlay" style="display:none">
            <div class="mh-guide-chat-header">
                <span>🐯 ${escapeHtml(t('guideChat'))}</span>
                <button class="mh-guide-chat-close" id="mhGuideChatClose">✕</button>
            </div>
            <div class="mh-guide-chat-body" id="mhGuideChatBody">
                <div class="chat-bubble guide">${escapeHtml(t('guideWelcome'))}</div>
            </div>
            <div class="mh-guide-chat-input-row">
                <input type="text" class="mh-guide-chat-input" id="mhGuideChatInput" placeholder="${escapeHtml(t('guidePlaceholder'))}">
                <button class="mh-guide-chat-send" id="mhGuideChatSend">${escapeHtml(t('send'))}</button>
            </div>
        </div>` : ''}
        ${(String(state.settings?.starSettlement?.planetId || '').trim() === 'default' || !state.settings?.starSettlement?.planetId) ? `
        <button class="mh-zoo-enter-planet" id="mhZooEnterPlanet" title="${escapeHtml(t('zooEnterPlanet'))}">
            <span class="mh-zoo-enter-icon">🐾</span>
            <span class="mh-zoo-enter-label">${escapeHtml(t('zooEnterPlanet'))}</span>
        </button>` : ''}
        ${String(state.settings?.starSettlement?.planetId || '').trim() === 'shenzhen_zoo' ? `
        <button class="mh-zoo-enter-planet" id="mhZooBackHome" title="${escapeHtml(t('zooBackHome'))}">
            <span class="mh-zoo-enter-icon">🏠</span>
            <span class="mh-zoo-enter-label">${escapeHtml(t('zooBackHome'))}</span>
        </button>` : ''}
        <style>
        .mh-zoo-encyclopedia-float {
            position:fixed; top:60px; left:10px; z-index:100;
            display:flex; flex-direction:column; align-items:center; gap:2px;
            background:rgba(255,255,255,.92); backdrop-filter:blur(8px);
            border:2px solid #22c55e; border-radius:16px;
            padding:8px 10px 6px; cursor:pointer;
            box-shadow:0 2px 12px rgba(34,197,94,.25);
            transition:transform .15s, box-shadow .15s;
        }
        .mh-zoo-encyclopedia-float:active { transform:scale(.92); }
        .mh-zoo-enc-icon { font-size:26px; line-height:1; }
        .mh-zoo-enc-label { font-size:10px; font-weight:800; color:#166534; }
        .mh-guide-avatar {
            position:fixed; bottom:140px; right:16px; z-index:100;
            width:56px; height:56px; border-radius:50%;
            background:linear-gradient(135deg,#fbbf24,#f59e0b);
            border:3px solid #fff; box-shadow:0 4px 16px rgba(245,158,11,.4);
            font-size:30px; cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            animation:mh-guide-bounce 2s ease-in-out infinite;
            transition:transform .15s;
        }
        .mh-guide-avatar:active { transform:scale(.85); }
        @keyframes mh-guide-bounce {
            0%,100% { transform:translateY(0); }
            50% { transform:translateY(-6px); }
        }
        .mh-guide-bubble {
            position:fixed; bottom:202px; right:12px; z-index:101;
            max-width:200px; background:#fff; border-radius:14px;
            padding:8px 12px; font-size:12px; color:#78350f;
            box-shadow:0 2px 12px rgba(0,0,0,.12);
            opacity:0; transform:translateY(8px);
            transition:opacity .3s, transform .3s;
            pointer-events:none;
            white-space:pre-wrap; word-break:break-word;
        }
        .mh-guide-bubble::after {
            content:''; position:absolute; bottom:-8px; right:20px;
            width:0; height:0;
            border-left:8px solid transparent;
            border-right:8px solid transparent;
            border-top:8px solid #fff;
        }
        .mh-guide-bubble.show { opacity:1; transform:translateY(0); }
        .mh-guide-chat-overlay {
            position:fixed; bottom:0; right:0; z-index:200;
            width:320px; max-width:100vw; height:400px; max-height:60vh;
            background:#fff; border-radius:16px 16px 0 0;
            box-shadow:0 -4px 24px rgba(0,0,0,.15);
            display:flex; flex-direction:column;
            animation:mh-guide-slideup .25s ease-out;
        }
        @keyframes mh-guide-slideup {
            from { transform:translateY(100%); }
            to { transform:translateY(0); }
        }
        .mh-guide-chat-header {
            display:flex; align-items:center; justify-content:space-between;
            padding:12px 16px; background:linear-gradient(135deg,#fbbf24,#f59e0b);
            border-radius:16px 16px 0 0; color:#78350f; font-weight:800; font-size:15px;
        }
        .mh-guide-chat-close {
            background:none; border:none; font-size:20px; color:#78350f; cursor:pointer; line-height:1;
        }
        .mh-guide-chat-body {
            flex:1; overflow-y:auto; padding:12px;
            display:flex; flex-direction:column; gap:8px;
        }
        .mh-guide-chat-body .chat-bubble {
            max-width:85%; padding:8px 12px; border-radius:12px; font-size:13px; line-height:1.5;
        }
        .mh-guide-chat-body .chat-bubble.user {
            align-self:flex-end; background:#dcfce7; color:#166534;
        }
        .mh-guide-chat-body .chat-bubble.guide {
            align-self:flex-start; background:#fef3c7; color:#78350f;
        }
        .mh-guide-chat-input-row {
            display:flex; gap:6px; padding:8px 12px 12px; border-top:1px solid #fde68a;
        }
        .mh-guide-chat-input {
            flex:1; border:1.5px solid #fde68a; border-radius:12px; padding:8px 12px;
            font-size:13px; outline:none;
        }
        .mh-guide-chat-send {
            background:#f59e0b; color:#fff; border:none; border-radius:12px;
            padding:8px 16px; font-weight:700; cursor:pointer; font-size:13px;
        }
        .mh-zoo-enter-planet {
            position:fixed; bottom:24px; right:16px; z-index:100;
            display:flex; flex-direction:column; align-items:center; gap:2px;
            background:rgba(255,255,255,.92); backdrop-filter:blur(8px);
            border:2px solid #22c55e; border-radius:16px;
            padding:10px 12px 8px; cursor:pointer;
            box-shadow:0 2px 12px rgba(34,197,94,.25);
            animation:mh-enter-pulse 2s ease-in-out infinite;
            transition:transform .15s;
        }
        .mh-zoo-enter-planet:active { transform:scale(.92); }
        @keyframes mh-enter-pulse {
            0%,100% { box-shadow:0 2px 12px rgba(34,197,94,.25); }
            50% { box-shadow:0 4px 20px rgba(34,197,94,.5); }
        }
        .mh-zoo-enter-icon { font-size:28px; line-height:1; }
        .mh-zoo-enter-label { font-size:10px; font-weight:800; color:#166534; }
        </style>`;

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
    // 胖虎导游悬浮头像 + 气泡 + AI 对话
    const guideAvatar = $('mhGuideAvatar');
    if (guideAvatar) {
        const guideBubble = $('mhGuideBubble');
        const guideOverlay = $('mhGuideChatOverlay');
        const guideClose = $('mhGuideChatClose');
        const guideBody = $('mhGuideChatBody');
        const guideInput = $('mhGuideChatInput');
        const guideSend = $('mhGuideChatSend');

        // 定时气泡消息
        const guideMessages = [
            t('guideBubble1'), t('guideBubble2'), t('guideBubble3'),
            t('guideBubble4'), t('guideBubble5'),
        ];
        let guideBubbleTimer = null;
        const showGuideBubble = () => {
            if (!guideBubble) return;
            const msg = guideMessages[Math.floor(Math.random() * guideMessages.length)];
            guideBubble.textContent = msg;
            guideBubble.classList.add('show');
            clearTimeout(guideBubbleTimer);
            guideBubbleTimer = setTimeout(() => guideBubble.classList.remove('show'), 5000);
        };
        showGuideBubble();
        const bubbleInterval = setInterval(showGuideBubble, 20000);

        // 点击头像打开对话
        guideAvatar.onclick = () => {
            if (guideOverlay) {
                guideOverlay.style.display = 'flex';
                clearTimeout(guideBubbleTimer);
                if (guideBubble) guideBubble.classList.remove('show');
            }
        };

        // 关闭对话
        if (guideClose) guideClose.onclick = () => {
            guideOverlay.style.display = 'none';
            showGuideBubble();
        };

        // 发送消息
        const sendGuideMessage = async () => {
            if (!guideInput || !guideBody) return;
            const text = guideInput.value.trim();
            if (!text) return;
            guideInput.value = '';
            guideBody.innerHTML += `<div class="chat-bubble user">${text.replace(/</g,'&lt;')}</div>`;
            guideBody.scrollTop = guideBody.scrollHeight;

            // 加载提示
            const loadingEl = document.createElement('div');
            loadingEl.className = 'chat-bubble guide';
            loadingEl.textContent = '...';
            guideBody.appendChild(loadingEl);
            guideBody.scrollTop = guideBody.scrollHeight;

            try {
                const { state } = await import('./state.js');
                let reply = '';
                if (state.sdk?.aiChat?.chat) {
                    const r = await state.sdk.aiChat.chat({
                        messages: [
                            { role: 'system', content: t('guideSystemPrompt') },
                            { role: 'user', content: text },
                        ],
                    });
                    reply = (r?.text || r || '').toString().trim();
                } else if (state.sdk?.aiGenerators?.chat) {
                    const r = await state.sdk.aiGenerators.chat({
                        messages: [
                            { role: 'system', content: t('guideSystemPrompt') },
                            { role: 'user', content: text },
                        ],
                    });
                    reply = (r?.text || r?.choices?.[0]?.message?.content || '').toString().trim();
                }
                loadingEl.textContent = reply || t('guideNoReply');
            } catch (e) {
                loadingEl.textContent = t('guideError', { error: e?.message || '' });
            }
            guideBody.scrollTop = guideBody.scrollHeight;
        };

        if (guideSend) guideSend.onclick = sendGuideMessage;
        if (guideInput) guideInput.onkeydown = (e) => {
            if (e.key === 'Enter') sendGuideMessage();
        };

        // 清理定时器
        const cleanupGuide = () => {
            clearInterval(bubbleInterval);
            clearTimeout(guideBubbleTimer);
        };
        // 在 dispose 时清理
        panel.__mhGuideCleanup = cleanupGuide;
    }
    // 深圳动物园：左上角📖图鉴按钮
    const zooEncFloat = $('mhZooEncFloat');
    if (zooEncFloat) {
        zooEncFloat.onclick = () => {
            soundManager.playButtonClick();
            callbacks.onNav?.('encyclopedia');
        };
    }
    // 默认星球：左下角"进入深圳动物园"快捷按钮
    const enterPlanetBtn = $('mhZooEnterPlanet');
    if (enterPlanetBtn) {
        enterPlanetBtn.onclick = async () => {
            soundManager.playButtonClick();
            const { state, notify, setView } = await import('./state.js');
            const { loadPlanetIndex } = await import('./config.js');
            const { saveUserProfileDebounced } = await import('./storage.js');
            
            state.settings = state.settings || {};
            state.settings.starSettlement = {
                source: 'official', planetId: 'shenzhen_zoo',
                encyclopediaUrl: 'famous-planets/shenzhen_zoo_encyclopedia.json',
            };
            
            try {
                const index = await loadPlanetIndex();
                const sz = (index?.planets || []).find(p => p.id === 'shenzhen_zoo');
                if (sz) {
                    const { applySettledOfficialPlanetFromProfile } = await import('./view_star_settlements.js');
                    await applySettledOfficialPlanetFromProfile();
                }
            } catch (e) {
                console.warn('切换深圳动物园失败', e);
            }
            await saveUserProfileDebounced();
            setView('home');
        };
    }
    // 深圳动物园：左下角"返回主星球"按钮
    const backHomeBtn = $('mhZooBackHome');
    if (backHomeBtn) {
        backHomeBtn.onclick = async () => {
            soundManager.playButtonClick();
            const { state, setView } = await import('./state.js');
            const { saveUserProfileDebounced } = await import('./storage.js');
            // 清除动物园的地形场景，恢复默认
            const { getTerrainFieldSlots } = await import('./view_terrain_fields.js');
            state.settings = state.settings || {};
            state.settings.starSettlement = { source: 'official', planetId: 'default' };
            state.settings.terrainFields = { slots: [
                { index: 1, typeId: 'sky', name: '天空' },
                { index: 2, typeId: 'land', name: '陆地' },
                { index: 3, typeId: 'water', name: '海洋' },
            ] };
            const { applySettledOfficialPlanetFromProfile } = await import('./view_star_settlements.js');
            await applySettledOfficialPlanetFromProfile();
            await saveUserProfileDebounced();
            setView('home');
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
    syncBgMusicForLevel(level);
    level.bindStage(pet, ctx);
    level.bindDock(pet, ctx);
    bindDockHorizontalScroll();
    restoreDockScrollPositions(panel);
    level.onEnter?.(pet, ctx);

    bindStageZoomGestures();
    applyCameraZoom();
    showZoomLevelBar();

    // 首次进入后预渲染相邻层
    invalidateLevelCache();
    schedulePreRenderAdjacent();
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
    const visibleList = visibleZoomLevels();
    const visible = new Set(visibleList);
    const hint = getZoomLevelHint(lvl, pet);
    const progress = getZoomBarProgress(visualCameraZoom || cameraZoom);
    const pointerConflictsWithEmergency = visible.has(lvl) && !!getZoomStageEmergency(ZOOM_BAR_STAGES[lvl]?.id, pet);
    const visibleCount = Math.max(1, visibleList.length);
    const totalCount = Math.max(visibleCount, ZOOM_BAR_STAGES.length);
    return `
        <button class="mh-zoom-bar ${pointerConflictsWithEmergency ? 'has-pointer-emergency-icon' : ''}" id="mhZoomLevelBar" type="button"
            style="--zoom-pos:${progress.toFixed(4)};--zoom-visible-count:${visibleCount};--zoom-total-count:${totalCount}"
            title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}" aria-hidden="true" tabindex="-1" disabled data-tip="${escapeHtml(hint)}">
            ${renderZoomLevelBarInner(pet, lvl)}
            <span class="mh-zoom-bar-pointer" aria-hidden="true"></span>
        </button>
    `;
}

function renderZoomLevelBarInner(pet = __lastPet, lvl = clampLvl(state.zoomLevel ?? 0)) {
    const visibleList = visibleZoomLevels();
    return `
        <span class="mh-zoom-bar-track" aria-hidden="true">
            ${visibleList.map((index) => {
                const stage = ZOOM_BAR_STAGES[index];
                if (!stage) return '';
                const emergency = getZoomStageEmergency(stage.id, pet);
                return `
                <span class="mh-zoom-bar-stage ${index === lvl ? 'active' : ''}" data-zoom-stage="${escapeHtml(stage.id)}" data-zoom-index="${index}" style="--stage-color:${stage.color}" title="${escapeHtml(emergency?.tip || t(stage.labelKey))}">
                    <i>${escapeHtml(t(stage.labelKey))}</i>
                </span>`;
            }).join('')}
        </span>
        ${ZOOM_BAR_STAGES.map((stage, index) => {
            if (!visibleList.includes(index)) return '';
            const emergency = getZoomStageEmergency(stage.id, pet);
            return emergency ? `<span class="mh-zoom-bar-emergency" data-zoom-emergency="${escapeHtml(stage.id)}" style="--stage-index:${visibleList.indexOf(index)};--stage-count:${visibleList.length}" title="${escapeHtml(emergency.tip)}">${emergency.iconHtml}</span>` : '';
        }).join('')}
    `;
}

function ensureZoomLevelBarStructure(bar, pet = __lastPet) {
    if (!bar) return;
    const stages = bar.querySelectorAll('.mh-zoom-bar-stage');
    const pointer = bar.querySelector('.mh-zoom-bar-pointer');
    const track = bar.querySelector('.mh-zoom-bar-track');
    const visible = visibleZoomLevels();
    const signature = visible.join(',');
    if (!track || !pointer || bar.dataset.visibleZoomLevels !== signature || stages.length !== visible.length) {
        bar.innerHTML = `${renderZoomLevelBarInner(pet)}<span class="mh-zoom-bar-pointer" aria-hidden="true"></span>`;
        bar.dataset.visibleZoomLevels = signature;
    }
}

function syncZoomLevelBar(bar, pet = __lastPet) {
    if (!bar) return null;
    ensureZoomLevelBarStructure(bar, pet);
    const lvl = clampLvl(state.zoomLevel ?? 0);
    const hint = getZoomLevelHint(lvl, pet);
    const visibleCount = Math.max(1, visibleZoomLevels().length);
    const totalCount = Math.max(visibleCount, ZOOM_BAR_STAGES.length);
    bar.style.setProperty('--zoom-visible-count', visibleCount);
    bar.style.setProperty('--zoom-total-count', totalCount);
    bar.style.setProperty('--zoom-pos', getZoomBarProgress(visualCameraZoom || cameraZoom).toFixed(4));
    bar.title = hint;
    bar.setAttribute('aria-label', hint);
    bar.dataset.tip = hint;
    bar.querySelectorAll('.mh-zoom-bar-stage').forEach((stageEl, index) => {
        const stageIndex = Number(stageEl.dataset.zoomIndex ?? index);
        const stage = ZOOM_BAR_STAGES[stageIndex];
        if (!stage) return;
        const emergency = getZoomStageEmergency(stage.id, pet);
        stageEl.classList.toggle('active', stageIndex === lvl);
        stageEl.style.setProperty('--stage-color', stage.color);
        stageEl.title = emergency?.tip || t(stage.labelKey);
    });
    refreshZoomLevelBarEmergency(pet, bar);
    updateZoomLevelBarPointer();
    return bar;
}

function ensureZoomLevelBar(root = document, pet = __lastPet) {
    const host = root.querySelector?.('#mhStage') || root;
    let bar = host?.querySelector?.('#mhZoomLevelBar') || document.getElementById('mhZoomLevelBar');
    if (isZoomLevelBarSuppressed()) {
        bar?.remove();
        return null;
    }
    if (!bar && host?.insertAdjacentHTML) {
        host.insertAdjacentHTML('beforeend', renderZoomLevelBar(pet));
        bar = host.querySelector?.('#mhZoomLevelBar') || document.getElementById('mhZoomLevelBar');
    }
    if (!bar) return null;
    syncZoomLevelBar(bar, pet);
    bindZoomLevelBar(host);
    return bar;
}

function getZoomStageEmergency(stageId, pet = __lastPet) {
    if (!pet) return null;
    const sickness = getActiveSickness(pet);
    if (stageId === 'cell' && sickness) {
        const severity = getEffectiveSicknessSeverity(pet);
        return {
            iconHtml: '<svg class="mh-zoom-bar-emergency-svg" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="#fee2e2" stroke="#fff" stroke-width="3"/><path d="M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7Z" fill="#dc2626" stroke="#991b1b" stroke-width="1" stroke-linejoin="round"/></svg>',
            tip: `生病：${sickness.def.name}，当前病情 ${severity}/10，进入细胞层治疗。`,
        };
    }
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
    const visible = new Set(visibleZoomLevels());
    if (!visible.has(clampLvl(lvl))) return '这个缩放层在当前星球配置中已隐藏。';
    if (isVisitingMode()) {
        if (lvl <= 0) return t('visitSpaceHint');
        if (lvl >= 3) return t('visitLimitHint');
    }
    const stage = ZOOM_BAR_STAGES[clampLvl(lvl)];
    const emergency = getZoomStageEmergency(stage?.id, pet);
    const stageHint = stage?.hintKey ? t(stage.hintKey) : t('zoomDefaultHint');
    if (emergency) return `${emergency.tip} ${stageHint}`;
    return stageHint;
}

function getZoomBarProgress(zoom = visualCameraZoom) {
    const lvl = clampLvl(state.zoomLevel ?? 0);
    const visible = visibleZoomLevels();
    const visibleIndex = Math.max(0, visible.indexOf(lvl));
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
    return (visibleIndex + local) / Math.max(1, visible.length);
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
    const bar = ensureZoomLevelBar(root, __lastPet);
    if (!bar) return;
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
        zoomIn:  () => { if (!isDecorZoomLocked()) requestZoomLevel(nextVisibleZoomLevel(1)); },
        zoomOut: () => { if (!isDecorZoomLocked()) requestZoomLevel(nextVisibleZoomLevel(-1)); },
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
            label: t('biofuel'),
            icon: '⛽',
            description: t('biofuelDesc'),
        };
    }
    return {
        label: t('coins'),
        icon: coinIconSvg(),
        description: t('coinsDesc'),
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
    const tip = `${label}：${value} · ${t(item.lowTextKey)}`;
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
            <span class="hud-pill hud-pill-stacked topbar-resource-pill" id="mhBiofuel" tabindex="0" title="${escapeHtml(tip)}" data-topbar-resource="biofuel" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(t('openShop'))}">
                <span class="hud-pill-icon">⛽</span>
                <span class="hud-pill-value" data-hud-value="biofuel">${state.biofuel | 0}</span>
            </span>`;
    }
    if (key === 'coins') {
        const tip = '金币：照顾和玩耍可获得，用来购买食物、家具和道具。';
        return `
            <span class="hud-pill hud-pill-stacked hud-pill-coin topbar-resource-pill" id="mhCoins" tabindex="0" title="${escapeHtml(tip)}" data-topbar-resource="coins" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(t('openShop'))}">
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

function getTopbarHudSignature(lvl = state.zoomLevel) {
    return getTopbarItems(lvl).map(item => `${item.type}:${item.key}`).join('|');
}

function refreshTopbarStatPills(pet = __lastPet) {
    const root = document.getElementById('mhTopbarStats');
    if (!root || !pet) return;
    const signature = getTopbarHudSignature();
    if (root.dataset.topbarSignature !== signature) {
        root.innerHTML = renderTopbarHudItems(pet);
        root.dataset.topbarSignature = signature;
        bindHudTips(document);
        bindTopbarStatDetails(document, pet);
        bindTopbarResourceShop(document, __lastCallbacks);
        return;
    }
    root.querySelectorAll('[data-hud-value]').forEach((el) => {
        const key = el.dataset.hudValue;
        if (!key) return;
        el.textContent = String(resourceValue(key));
    });
    getTopbarStatKeys().forEach((key) => {
        const valueEl = root.querySelector(`[data-mh-topbar-stat-value="${key}"]`);
        if (!valueEl) return;
        const item = PET_STAT_ITEMS.find(it => it.k === key);
        const value = statValue(pet, key);
        const pill = valueEl.closest('.topbar-stat-pill');
        valueEl.dataset.statValue = String(value);
        valueEl.textContent = String(value);
        if (!pill || !item) return;
        const level = stateLevel(value);
        const tip = `${t(item.labelKey)}：${value} · ${t(item.lowTextKey)}`;
        pill.classList.remove('state-good', 'state-warn', 'state-danger');
        pill.classList.add(`state-${level.key}`);
        pill.title = tip;
        pill.setAttribute('aria-label', tip);
        pill.dataset.tip = tip;
    });
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
    if (value < 25) return { key: 'danger', label: t('stateDanger') };
    if (value < 50) return { key: 'warn', label: t('stateWarn') };
    return { key: 'good', label: t('stateGood') };
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
            pill.title = `${t(it.labelKey)}：${v} · ${t(it.lowTextKey)}`;
            pill.setAttribute('aria-label', pill.title);
            pill.dataset.tip = pill.title;
            void pill.offsetWidth;
            pill.classList.add('topbar-stat-pop');
            setTimeout(() => pill.classList.remove('topbar-stat-pop'), 520);
        });
    });
    refreshZoomLevelBarEmergency(current);
}

function refreshZoomLevelBarEmergency(pet = __lastPet, bar = document.getElementById('mhZoomLevelBar')) {
    if (!bar) return;
    const visible = new Set(visibleZoomLevels());
    const visibleList = Array.from(visible);
    const hint = getZoomLevelHint(state.zoomLevel, pet);
    bar.title = hint;
    bar.setAttribute('aria-label', hint);
    bar.dataset.tip = hint;
    let pointerConflictsWithEmergency = false;
    ZOOM_BAR_STAGES.forEach((stage, index) => {
        const stageEl = bar.querySelector(`.mh-zoom-bar-stage[data-zoom-stage="${stage.id}"]`);
        const isVisible = visible.has(index);
        const emergency = isVisible ? getZoomStageEmergency(stage.id, pet) : null;
        if (emergency && index === clampLvl(state.zoomLevel)) pointerConflictsWithEmergency = true;
        if (stageEl) stageEl.title = emergency?.tip || stage.label;
        let marker = bar.querySelector(`.mh-zoom-bar-emergency[data-zoom-emergency="${stage.id}"]`);
        if (emergency && !marker) {
            marker = document.createElement('span');
            marker.className = 'mh-zoom-bar-emergency';
            marker.dataset.zoomEmergency = stage.id;
            bar.appendChild(marker);
        }
        if (marker) {
            if (emergency) {
                marker.innerHTML = emergency.iconHtml;
                marker.title = emergency.tip;
                marker.style.setProperty('--stage-index', visibleList.indexOf(index));
                marker.style.setProperty('--stage-count', visibleList.length);
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
    showToast(t('companyMoodGain', { gained }), 'success', 1400);
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
    const requested = resolveZoomLevelIndex(target, currentZoomOptions(), state.zoomLevel);
    const to = resolveHomeZoomLevel(target, state.zoomLevel);
    if (isVisitingMode()) {
        const maxLevel = maxVisitingZoomLevel();
        if (requested > maxLevel) {
            showToast(isNonUserPlanetVisit()
                ? '参观官方星球时只能在星球表面活动。'
                : '拜访好友时只能在星球表面和宠物房间活动。', 'info', 1800);
            forceBestCameraDistance();
            return;
        }
    }
    if (to === state.zoomLevel) {
        forceBestCameraDistance();
        return;
    }
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
    if (Math.abs(clamped - cameraZoom) < 0.0001) return;
    cameraZoom = clamped;
    // 连续手势（触摸/鼠标拖动）直接同步 visualCameraZoom，消除追逐延迟
    visualCameraZoom = clamped;
    stopCameraAnimation();
    scheduleCameraRender();
    soundManager.playZoomScrollBeep(direction);
}

const WIPE_FOCUS_SELECTORS = [
    '#mhPlanet .planet-body, #mhPlanet',  // planet
    '.field-pet-current',                   // field
    '#mhPet',                               // pet
    null,                                   // cell (default center)
];

function getWipeFocusCenter(levelIndex) {
    const selector = WIPE_FOCUS_SELECTORS[levelIndex];
    if (!selector) return { cx: 50, cy: 50, focusEl: null };
    const parts = selector.split(',').map(s => s.trim());
    let el = null;
    for (const sel of parts) {
        el = document.querySelector(sel);
        if (el) break;
    }
    if (!el) return { cx: 50, cy: 50, focusEl: null };
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const cx = Math.max(5, Math.min(95, ((rect.left + rect.width / 2) / vw) * 100));
    const cy = Math.max(5, Math.min(95, ((rect.top + rect.height / 2) / vh) * 100));
    return { cx, cy, focusEl: el };
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

    // 0) 聚焦关键元素（仅向内切换时）：摄像头平移至焦点中心，然后整体放大+淡出
    const { cx, cy, focusEl } = getWipeFocusCenter(from);
    const useFocus = focusEl && direction === 'in';
    if (useFocus) {
        // 将整个 stage 的 transform-origin 设为焦点元素中心，然后整体放大
        stage.style.transformOrigin = `${cx}% ${cy}%`;
        stage.classList.add('mh-stage-focus-zoom');
    }

    // 1) 音效
    soundManager.playZoomLevelSound(direction);

    // 延迟启动 wipe，让聚焦放大展开一段后 wipe 从焦点膨胀覆盖
    const wipeDelay = useFocus ? 260 : 0;
    if (useFocus) dock.classList.add('mh-dock-fading');
    setTimeout(async () => {
        // 2) 旧 stage 微缩放 + dock 滑出（聚焦模式下跳过额外缩放，由 focus-zoom 一并完成）
        if (!useFocus) stage.classList.add(direction === 'in' ? 'zoom-anim-out-in' : 'zoom-anim-out-out');
        if (!useFocus) dock.classList.add('mh-dock-fading');

        // 3) Canvas circle-wipe 关闭（遮罩从焦点元素中心膨胀覆盖旧场景）
        const fromWipeColor = LEVELS[from]?.wipeColor;
        await playSceneWipe({ phase: 'closing', cx, cy, color: fromWipeColor || '#0c1025', duration: 580 });

        // 4) 关闭动画结束 → 旧场景完全被遮盖 → DOM 替换 → 打开动画
        if (useFocus) {
            stage.classList.remove('mh-stage-focus-zoom');
            stage.style.transformOrigin = '';
        }

        const pet = __lastPet;
        state.zoomLevel = to;
        state.lastHomeZoomLevel = to;
        const newLevel = LEVELS[to];

        const bestCamera = getLevelBestCamera(newLevel);
        cameraZoom = bestCamera;
        visualCameraZoom = bestCamera;

        // DOM 替换（完全被 wipe 遮盖，用户不可见）
        const inner = document.getElementById('mhStageInner');
        rememberDockScrollPositions(dock);
        if (!inner || !useCachedLevel(to, pet, inner, dock)) {
            if (inner) inner.innerHTML = newLevel.stageHtml(pet);
            dock.innerHTML = newLevel.dockHtml(pet);
        }

        const zd = CONFIG.zoomLevels[to];
        const lab = document.getElementById('mhZoomLabel');
        if (lab) lab.innerHTML = `${zd.emoji} ${escapeHtml(zd.name)} · <i>${escapeHtml(zd.subtitle)}</i>`;
        refreshAppTitle(to, pet);
        stage.className = `mh-stage zoom-${zd.id} ${state.isDecorMode && (to === 1 || to === 2) ? 'decor-mode' : ''} ${state.isFeedMode && to === 2 ? 'feed-mode' : ''}`;
        stage.style.touchAction = 'none';
        refreshZoomLevelBar(stage);

        const ctx = makeCtx(pet, __lastCallbacks);
        syncBgMusicForLevel(newLevel);
        newLevel.bindStage(pet, ctx);
        if (to === 1) newLevel.centerPet?.(pet, { animate: false });
        stopCameraAnimation();
        scheduleCameraRender();

        // 新 stage 进场缩放 + dock 滑入
        stage.classList.add(direction === 'in' ? 'zoom-anim-in-in' : 'zoom-anim-in-out');
        dock.classList.remove('mh-dock-fading');
        dock.classList.add('mh-dock-fade-in');

        // 5) 打开阶段：回收至屏幕中央
        const toWipeColor = LEVELS[to]?.wipeColor;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await playSceneWipe({ phase: 'opening', cx: 50, cy: 50, color: toWipeColor || '#0c1025', duration: 660 });

        stage.classList.remove('zoom-anim-in-in', 'zoom-anim-in-out');
        dock.classList.remove('mh-dock-fade-in');
        __mhZoomAnimating = false;
        __levelJumpCompleted = true;
        scheduleTransitionFollowup(() => {
            refreshTopbarStatPills(pet);
            newLevel.bindDock(pet, ctx);
            bindDockHorizontalScroll();
            restoreDockScrollPositions(dock);
            newLevel.onEnter?.(pet, ctx);
            if (isVisitingMode() && to === 0) showVisitReturnPrompt(pet, ctx);
            schedulePreRenderAdjacent();
        });
        showZoomLevelBar({ autoHide: true, delay: 2000, requireLevelJumpCompleted: true });
        scheduleCameraIdleReturn();
    }, wipeDelay);
}

// =============================================================================
// 手势：滚轮 / 触摸 / 鼠标
// =============================================================================
function bindStageZoomGestures() {
    const stage = $('mhStage');
    if (!stage) return;
    __stageZoomWindowCleanup?.();
    __stageZoomWindowCleanup = null;

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
                requestZoomLevelAfterFocus(nextVisibleZoomLevel(1), lvl.maxCamera);
                return;
            }
            if (target < lvl.minCamera * 0.95 && state.zoomLevel > 0) {
                pinchTriggered = true;
                requestZoomLevel(nextVisibleZoomLevel(-1));
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
                requestZoomLevelAfterFocus(nextVisibleZoomLevel(1), lvl.maxCamera);
                return;
            }
            if (target < lvl.minCamera * 0.95 && state.zoomLevel > 0) {
                touchTriggered = true;
                touchDragging = false;
                requestZoomLevel(nextVisibleZoomLevel(-1));
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
    const onMouseMove = (e) => {
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
            requestZoomLevelAfterFocus(nextVisibleZoomLevel(1), lvl.maxCamera);
            return;
        }
        if (target < lvl.minCamera * 0.95 && state.zoomLevel > 0) {
            requestZoomLevel(nextVisibleZoomLevel(-1));
            return;
        }
        setCameraZoomFromGesture(target, target >= cameraZoom ? 'in' : 'out');
        scheduleCameraIdleReturn();
    };
    const onMouseUp = () => {
        if (!mouseDragging) return;
        mouseDragging = false;
        if (mouseMoved) {
            suppressNextStageClick = true;
            setTimeout(() => { suppressNextStageClick = false; }, 350);
        }
        mouseMoved = false;
        if (mouseGestureStarted) markCameraGestureEnd();
        mouseGestureStarted = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    __stageZoomWindowCleanup = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
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
    // 每帧只消费一部分 delta，将缩放变化分摊到多帧，使滚轮缩放更丝滑
    const consumed = __wheelZoomDelta * WHEEL_CONSUME_RATE;
    __wheelZoomDelta -= consumed;
    const factor = Math.exp(-consumed * WHEEL_ZOOM_SENSITIVITY);
    applyWheelDelta(factor);
    showZoomLevelBar();
    scheduleCameraIdleReturn();
    if (Math.abs(__wheelZoomDelta) > 0.3) __wheelZoomFrame = requestAnimationFrame(flushWheelZoom);
    else { __wheelZoomDelta = 0; }
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
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"], [data-tray-item], .field-tab, .bad-cell')) return true;
    if (state.zoomLevel === 1 && state.isDecorMode && target.closest('.field-item')) return true;
    if (state.zoomLevel === 2 && (state.isDecorMode || state.isFeedMode) && target.closest('.room-cell, .furniture')) return true;
    return false;
}

function applyDelta(factor) {
    if (isDecorZoomLocked()) return;
    const lvl = LEVELS[state.zoomLevel];
    const next = cameraZoom * factor;
    if (next > lvl.maxCamera) {
        const nextLevel = nextVisibleZoomLevel(1);
        if (nextLevel !== state.zoomLevel) requestZoomLevelAfterFocus(nextLevel, lvl.maxCamera);
        else { cameraZoom = lvl.maxCamera; applyCameraZoom(); }
    } else if (next < lvl.minCamera) {
        const nextLevel = nextVisibleZoomLevel(-1);
        if (nextLevel !== state.zoomLevel) requestZoomLevel(nextLevel);
        else { cameraZoom = lvl.minCamera; applyCameraZoom(); }
    } else {
        setCameraZoomFromGesture(next, factor >= 1 ? 'in' : 'out');
    }
}

// 滚轮缩放专用：仍使用平滑插值（因为滚轮是离散脉冲输入，需要平滑化）
function applyWheelDelta(factor) {
    if (isDecorZoomLocked()) return;
    const lvl = LEVELS[state.zoomLevel];
    const next = cameraZoom * factor;
    if (next > lvl.maxCamera) {
        const nextLevel = nextVisibleZoomLevel(1);
        if (nextLevel !== state.zoomLevel) requestZoomLevelAfterFocus(nextLevel, lvl.maxCamera);
        else { cameraZoom = lvl.maxCamera; applyCameraZoom(); }
    } else if (next < lvl.minCamera) {
        const nextLevel = nextVisibleZoomLevel(-1);
        if (nextLevel !== state.zoomLevel) requestZoomLevel(nextLevel);
        else { cameraZoom = lvl.minCamera; applyCameraZoom(); }
    } else {
        const clamped = Math.max(lvl.minCamera, Math.min(lvl.maxCamera, next));
        cameraZoom = clamped;
        soundManager.playZoomScrollBeep(factor >= 1 ? 'in' : 'out');
        applyCameraZoom();
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
            <button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button>
            <button class="btn-primary" data-act="open-shop">${escapeHtml(t('openShop'))}</button>
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
    const message = t('statMessage', { label, value, low: t(item.lowTextKey), state: level.label });
    openModal(`
        <div style="text-align:left">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;color:var(--text-primary);font-size:18px;font-weight:900">
                <span style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;font-size:22px">${item.icon}</span>
                <span>${escapeHtml(displayPetNameWithoutTag(current))}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:14px;font-weight:700;line-height:1.55">${escapeHtml(message)}</div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
            <button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button>
            <button class="btn-primary" data-act="open-stats">${escapeHtml(t('viewMoreStats'))}</button>
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
    const summary = lowest ? `${lowest.icon} ${t(lowest.labelKey)} ${lowest.value} · ${t(lowest.lowTextKey)}` : t('petStatusFallback');
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
            <button class="btn-primary" data-act="close">${escapeHtml(t('close'))}</button>
        </div>
    `, (e, close) => {
        if (e.target.closest?.('[data-act="close"]')) close();
    });
    refreshPetStateUi(pet);
}

function showMenuModal(callbacks) {
    const progress = computePlanetProgress();
    const hasEncyclopedia = !!String(state.settings?.starSettlement?.encyclopediaUrl || '').trim();
    const items = [
        { k: 'petList',   icon: '🐾', label: t('petList') },
        ...(hasEncyclopedia ? [{ k: 'encyclopedia', icon: '📖', label: t('encTitle') }] : []),
        { k: 'shop',      icon: '🛒', label: t('shop') },
        { k: 'inventory', icon: '🎒', label: t('inventory') },
        ...(progress.level >= 3 ? [{ k: 'research', icon: '🔬', label: t('research') }] : []),
        { k: 'mailbox',   icon: '💌', label: t('mailbox') },
        { k: 'storyMaker', icon: '📖', label: t('storyMaker') },
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
                <button class="menu-close-btn" data-act="close" type="button" aria-label="${escapeHtml(t('closeMenu'))}">×</button>
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
        if (navBtn) {
            close();
            if (navBtn.dataset.nav === 'research') openResearchFromMenu(callbacks);
            else callbacks.onNav?.(navBtn.dataset.nav);
            return;
        }
        if (e.target.closest?.('[data-act="close"]')) close();
    }, () => {
        if (timeTimer) clearInterval(timeTimer);
    });
    timeTimer = setInterval(() => updateTime(modal.mask), 1000);
}

function openResearchFromMenu(callbacks = __lastCallbacks) {
    if (!__lastPet) return;
    if (!visibleZoomLevels().includes(0)) {
        showToast(t('researchPlanetHidden'), 'info', 2200);
        return;
    }
    const openResearch = () => showPlanetResearchPanel(__lastPet, makeCtx(__lastPet, callbacks));
    if (state.zoomLevel === 0) {
        openResearch();
        return;
    }
    if (isDecorZoomLocked()) {
        showToast(t('researchExitMode'), 'info', 2200);
        return;
    }
    requestZoomLevel(0);
    waitForPlanetLevel(openResearch);
}

function waitForPlanetLevel(callback, startedAt = Date.now()) {
    const ready = state.zoomLevel === 0 && !__mhZoomAnimating && !__pendingZoomTransitionTimer;
    if (ready) {
        requestAnimationFrame(() => callback?.());
        return;
    }
    if (Date.now() - startedAt > 2800) {
        if (state.zoomLevel === 0) callback?.();
        return;
    }
    setTimeout(() => waitForPlanetLevel(callback, startedAt), 80);
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
