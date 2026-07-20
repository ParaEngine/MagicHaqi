// Level 1 — Field：星球表面（陆 / 水 / 空 三大生态）

import { $, $$, coinIconSvg, dockDisabledAttrs, escapeHtml, fitIconCropAspectRatio, iconBackgroundStyleAttr, isDockButtonDisabled, isImageIconValue, parseIconSource, renderVisualAsset, setDockButtonDisabled, showDockDisabledToast, showToast } from './utils.js';
import { itemName, t, localizeFieldName } from './i18n.js';
import { canPlaceItemInArea, CONFIG, DECO_VISUALS, findLargestHouseInLayout, getPlacedItemZOrder, getPlanetMiningCoins, getPlanetMiningConfig, getPlanetMiningVisualCoinCount, getShopItemById, isHouseItem, recordPlanetMiningFieldCollected, SHOP_ITEMS } from './config.js';
import { getActivePlanetWeather, isVisitingMode, notify, state, setCurrentField } from './state.js';
import { getLayout, saveFieldScenesDebounced, savePetDebounced, saveUserProfileDebounced } from './storage.js';
import { displayPetName } from './dna.js';
import { buildEggSvg, getPet, getPetSpriteCell, getPetSleepActionState, isPetInteractionBlocked, petArtHtml, playEggWelcomeOnce, playPetClickFeedback, playPetHappy, randomPetTalk, SHEET_COLS, SHEET_ROWS, sleepingInteractionText } from './pet.js';
import { getPetPoopCount, markPetCared, normalizePetPoops, setPetPoopCount } from './petTick.js';
import { canPetAppearInField, getGeneratedPetLocation, getNannyCareRemainingMs, getPetLocationType, getReleasedPetHome, hasNannyCare, isNearActiveGeneratedPet } from './petLifecycle.js';
import SoundManager from './soundManager.js';
import ParticleEffects, { renderParticleCanvasHtml } from './particleEffects.js';
import { PARTICLE_EFFECTS, bgMusicLabel, bgMusicOptions, lazySceneBackgroundAttrs, loadScenePresets, rankScenePresets, renderSceneParticles, sceneBackgroundStyle, setupLazySceneBackgrounds } from './view_story_scene_maker.js';
import { setShopFilter, suppressShopInitialClick } from './view_shop.js';
import { getTerrainFieldSlots, normalizeTerrainFieldSlotId, resolveTerrainFieldTypeId, terrainFieldTabIconHtml } from './view_terrain_fields.js';
import { playFieldGreeting, playPhotoShutter } from './visit_animations.js';
import { showTakePhotoWindow } from './view_takephoto.js';
import { openNpcDialog } from './npc_dialog.js';

const soundManager = SoundManager.getInstance();

const BLIND_BOX_EGG_STORAGE_KEY = 'haqi_blind_box_egg_state_v1';
const ITEM_BY_ID = new Proxy({}, { get: (_, id) => getShopItemById(id) });
const ITEM_Z_INDEX_BASE = 5;
const DRAG_PLACE_THRESHOLD = 8;
const FUEL_MACHINE_WORK_DELAY_MS = 3000;
const FUEL_MACHINE_ANIMATION_MS = 4600;
const POOP_WIND_ANIMATION_MS = 980;
const POOP_SUCK_ANIMATION_MS = 1850;
const POOP_SUCK_STAGGER_MS = 150;
const POOP_MACHINE_SWEEP_MIN_MS = 10000;
const POOP_MACHINE_SWEEP_MAX_MS = 15000;
const POOP_MACHINE_SWEEP_SCREEN_MS = 2500;
const POOP_MACHINE_SWEEP_RETURN_MS = 520;
const POOP_LOCATION_SESSION_SEED = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
const POOP_LOWER_HALF_CHANCE = 0.82;
const POOP_PET_AVOID_X = 0.075;
const POOP_PET_AVOID_Y = 0.14;
const FUEL_MACHINE_VIEWBOX_TARGET_X = 0.5;
const FUEL_MACHINE_VIEWBOX_TARGET_Y = 0.68;
const FIELD_EFFECT_MIN_SCALE = 0.88;
const FIELD_EFFECT_MAX_SCALE = 1.7;
const FIELD_WIDTH_METERS = 10;
const FIELD_HEIGHT_METERS = 3;
const FIELD_PET_BASE_SIZE_PX = 96;
const FIELD_PET_DRAG_EDGE_ZONE_PX = 64;
const FIELD_PET_DRAG_SCROLL_MIN_SPEED = 2;
const FIELD_PET_DRAG_SCROLL_MAX_SPEED = 16;
const FIELD_PET_DRAG_SCROLL_RAMP_MS = 900;
const FIELD_PET_REPEL_MIN_X = 0.058;
const FIELD_PET_REPEL_MIN_Y = 0.155;
const FIELD_PET_REPEL_MIN_GAP = 0.018;
// 有对话/小游戏的 NPC 是场景里固定不动的"静态物体"：宠物走位和便便掉落点都要绕开它，
// 半径只需盖住 NPC 自身可点击的图标范围（避免挡住点击），不做大范围"个人空间"排斥；
// 按 NPC 缩放比例开根号微调，避免大缩放 NPC 把宠物推得太远。
const FIELD_NPC_AVOID_X = 0.02;
const FIELD_NPC_AVOID_Y = 0.035;
const FIELD_NPC_PLACEMENT_AVOID_X = 0.052;
const FIELD_NPC_PLACEMENT_AVOID_Y = 0.12;
const FIELD_NPC_NEAR_PET_MIN_RADIUS = 0.085;
const FIELD_NPC_NEAR_PET_RANDOM_RADIUS = 0.075;
const FIELD_NPC_NEAR_PET_Y_SCALE = 0.82;
// 宠物在地表层的纵向落点上限（归一化 0=顶 1=底）。
// 底部预留空间，避免与底部的等级条 UI（level bar）重叠。
const FIELD_PET_MAX_Y = 0.82;
// 层级优先级：主宠物 > NPC（.field-npcs 固定 z-index 29，见 field.css） > 其它宠物。
// .field-pets 容器本身不再建立独立层叠上下文（field.css 已去掉其 z-index），
// 这样每只宠物的行内 z-index 才能直接和 .field-npcs 比较，而不是整层被 NPC 一并盖住或盖住 NPC。
const FIELD_OTHER_PET_Z_BASE = 10;
const FIELD_OTHER_PET_Z_RANGE = 10;
const FIELD_CURRENT_PET_Z_BASE = 32;
const FIELD_CURRENT_PET_Z_RANGE = 10;

function fieldPetZIndex(y, isCurrent) {
    const base = isCurrent ? FIELD_CURRENT_PET_Z_BASE : FIELD_OTHER_PET_Z_BASE;
    const range = isCurrent ? FIELD_CURRENT_PET_Z_RANGE : FIELD_OTHER_PET_Z_RANGE;
    return base + Math.round(clamp01(y) * range);
}
const VISIT_FIELD_MAX_PLANET_GUEST_PETS = 3;
const NEAR_ACTIVE_PET_MIN_RADIUS = 0.055;
const NEAR_ACTIVE_PET_RANDOM_RADIUS = 0.065;
const NEAR_ACTIVE_PET_Y_SCALE = 0.82;
const FIELD_ITEM_DEFAULT_SCALE = 1.15;
const FIELD_ITEM_MIN_SCALE = 0.8;
const FIELD_ITEM_MAX_SCALE = 3;
const FIELD_ITEM_SCALE_STEP = 1.15;
const FIELD_FINGER_HIT_RADIUS_PX = 18;
const FIELD_FINGER_HIT_SAMPLE_POINTS = [
    [0, 0], [0, -1], [1, 0], [0, 1], [-1, 0],
    [0.72, -0.72], [0.72, 0.72], [-0.72, 0.72], [-0.72, -0.72],
];
const FIELD_IMAGE_ALPHA_HIT_THRESHOLD = 24;
const FIELD_IMAGE_ALPHA_AABB_CACHE = new Map();
const DRAG_TO_SCENE_HINT = () => t('dragToScene');
const FIELD_DRAG_EXISTING_HINT = () => t('dragMoveHint');
const FIELD_BUILD_CATEGORIES = [
    { id: 'houses', nameKey: 'buildHouse' },
    { id: 'backgrounds', nameKey: 'buildBackground' },
    { id: 'effects', nameKey: 'buildEffect' },
    { id: 'music', nameKey: 'buildMusic' },
];
const FIELD_EFFECT_EMOJIS = {
    sparkle: '✨',
    snow: '❄️',
    rain: '🌧️',
    mist: '🌫️',
    bubbles: '🫧',
    petals: '🌸',
    embers: '🔥',
};
const FIELD_MUSIC_EMOJIS = {
    selector: '🎵',
    square: '🏛️',
    forest: '🌲',
    farm: '🌾',
    mountain: '⛰️',
    park: '🌳',
    playground: '🎠',
    ship: '🚀',
    haqiLoop: '🎶',
};
let suppressFieldDockActivationUntil = 0;
let fieldPan = 0;
let fieldPxPerMeter = 1;
const fieldPanById = {};
let lastBoundFieldPanKey = '';
let selectedFieldItem = null;
let activePoopSweepId = 0;
let activePoopSuckFinishAt = 0;
let activeFieldBuildCategory = 'houses';
let fieldScenePresets = [];
let fieldScenePresetsLoading = null;
const fieldPoopLocationCache = new Map();
const fieldMiningCoinLocationCache = new Map();

// 场景背景已全面改用静态场景图（CONFIG.fieldDefaultScenes / 用户自定义背景）。
// FIELD_THEMES 仅保留主题 class（天气等 CSS 选择器依赖）与天空渐变（图片加载前的底色 / 拍照回退）。
const FIELD_THEMES = {
    land: { className: 'field-map-land', sky: 'linear-gradient(180deg,#b7f2ff 0%,#e2ffe2 42%,#8bd05d 100%)' },
    water: { className: 'field-map-water', sky: 'linear-gradient(180deg,#baf0ff 0%,#6ed2f7 44%,#1789ce 100%)' },
    sky: { className: 'field-map-sky', sky: 'linear-gradient(180deg,#dbeafe 0%,#93c5fd 50%,#60a5fa 100%)' },
    fire: { className: 'field-map-fire', sky: 'linear-gradient(180deg,#2b163d 0%,#7f1d1d 48%,#1f0f13 100%)' },
    ice: { className: 'field-map-ice', sky: 'linear-gradient(180deg,#e0f7ff 0%,#93c5fd 48%,#155e75 100%)' },
    life: { className: 'field-map-life', sky: 'linear-gradient(180deg,#fde68a 0%,#d9f99d 42%,#84cc16 100%)' },
    dark: { className: 'field-map-dark', sky: 'linear-gradient(180deg,#111827 0%,#374151 48%,#030712 100%)' },
    thunder: { className: 'field-map-thunder', sky: 'linear-gradient(180deg,#312e81 0%,#4f46e5 44%,#111827 100%)' },
};

function availableFields() {
    if (isVisitingMode()) {
        const remoteFields = state.visitingMode?.remoteFields;
        if (Array.isArray(remoteFields) && remoteFields.length) {
            return remoteFields.map((field, index) => {
                const type = SHOP_FIELD_TYPES[field.typeId] || CONFIG.fields.find(item => item.id === field.typeId) || SHOP_FIELD_TYPES.land || {};
                const id = String(field.id || field.slotId || index + 1);
                return { ...type, id, typeId: field.typeId || type.id || 'land', name: field.name || type.name || '陆地', positionLabel: field.positionLabel || '' };
            });
        }
        return CONFIG.fields;
    }
    const slots = getTerrainFieldSlots();
    return slots.length ? slots.map(slot => {
        const type = SHOP_FIELD_TYPES[slot.typeId] || CONFIG.fields.find(field => field.id === slot.typeId) || {};
        return { ...type, id: slot.id, typeId: slot.typeId, name: slot.name, positionLabel: slot.positionLabel };
    }) : CONFIG.fields;
}

const SHOP_FIELD_TYPES = Object.fromEntries([
    ...CONFIG.fields,
    { id: 'fire', name: '火山', favoriteTrait: 'dragonLike' },
    { id: 'ice', name: '冰湖', favoriteTrait: 'fishLike' },
    { id: 'life', name: '神树', favoriteTrait: 'fruitLike' },
    { id: 'dark', name: '洞穴', favoriteTrait: 'catLike' },
    { id: 'thunder', name: '雷云', favoriteTrait: 'birdLike' },
].map(field => [field.id, field]));

function hashString(value) {
    const str = String(value || 'MagicHaqi');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function makeRng(seedText) {
    let seed = hashString(seedText) || 1;
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function pct(value) {
    return (value * 100).toFixed(2) + '%';
}

function clamp01(value) {
    const n = Number(value);
    return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function clampRange(value, min, max) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function setFieldEffectScale(zoom = 1) {
    const stage = $('mhStage');
    if (!stage) return;
    stage.style.setProperty('--field-effect-scale', clampRange(zoom, FIELD_EFFECT_MIN_SCALE, FIELD_EFFECT_MAX_SCALE).toFixed(3));
}

function getFieldEffectScale() {
    const stage = $('mhStage');
    return clampRange(stage ? getComputedStyle(stage).getPropertyValue('--field-effect-scale') : 1, FIELD_EFFECT_MIN_SCALE, FIELD_EFFECT_MAX_SCALE);
}

function currentFieldKey() {
    if (isVisitingMode()) return 'visit_field_' + state.currentField;
    return 'field_' + normalizeTerrainFieldSlotId(state.currentField);
}

function activeLayouts() {
    return isVisitingMode() ? (state.visitingMode?.remoteLayouts || {}) : (state.layouts || {});
}

function activeLayout(roomId) {
    return activeLayouts()[roomId] || [];
}

function activeFieldLayout(fieldId) {
    const key = 'field_' + normalizeTerrainFieldSlotId(fieldId);
    const layout = activeLayout(key);
    if (layout.length || !isVisitingMode()) return layout;
    return activeLayout('field_' + fieldId);
}

function isFieldDecorMode() {
    return state.isDecorMode && state.zoomLevel === 1;
}

function isReadonlyPlanet() {
    return state.settings?.starSettlement?.source === 'official' && state.settings.starSettlement.readonlyPlanet !== false;
}

function clientScaleForElement(el) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 1, y: 1 };
    return {
        x: (el.offsetWidth || el.clientWidth || rect.width) / rect.width,
        y: (el.offsetHeight || el.clientHeight || rect.height) / rect.height,
    };
}

function fieldLayoutPxToClientPx(value) {
    const scene = $('mhFieldScene');
    const scale = clientScaleForElement(scene);
    const safeScale = Math.max(0.001, (scale.x + scale.y) / 2);
    return (Number(value) || 0) / safeScale;
}

function pointToFieldCoords(clientX, clientY, requireInside = false) {
    const scene = $('mhFieldScene');
    const rect = scene?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    if (requireInside && (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)) return null;
    return {
        x: clamp01((clientX - rect.left) / rect.width),
        y: clamp01((clientY - rect.top) / rect.height),
    };
}

function isPointOverDock(clientX, clientY) {
    if (!isFieldDecorMode()) return false;
    const dock = $('mhDock');
    const rect = dock?.getBoundingClientRect?.();
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function setFieldDockDeleteTargetVisible(visible) {
    const dock = $('mhDock');
    const target = $('mhFieldDockDeleteTarget');
    dock?.classList.toggle('mh-room-dock-delete-visible', !!visible);
    dock?.classList.toggle('mh-room-dock-delete-active', !!visible);
    if (target) target.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function makeFieldDragGhost(itemId) {
    const item = ITEM_BY_ID[itemId];
    const ghost = document.createElement('div');
    ghost.className = 'mh-field-drag-ghost';
    const fontSize = fieldLayoutPxToClientPx(getFieldItemFontSize(item));
    const visualHtml = fieldItemVisualHtml(item, fontSize, { displayInline: true });
    if (visualHtml) {
        ghost.classList.add('mh-field-drag-ghost-svg');
        ghost.innerHTML = visualHtml;
    } else {
        ghost.textContent = item?.emoji || '';
        ghost.style.fontSize = fontSize.toFixed(1) + 'px';
    }
    document.body.appendChild(ghost);
    return ghost;
}

function getItemVisual(item) {
    const visual = DECO_VISUALS[item?.id] || {};
    return {
        ...visual,
        svg: item?.svg || visual.svg,
        imageUrl: item?.imageUrl || visual.imageUrl,
    };
}

function fieldItemVisualHtml(item, fontSize, { extraHtml = '', displayInline = false } = {}) {
    const visualHtml = renderVisualAsset(getItemVisual(item), { className: 'field-house-img', alt: item?.name || '' });
    if (!visualHtml) return '';
    const width = (fontSize * 2.2).toFixed(0);
    const display = displayInline ? ';display:inline-block' : '';
    return `<span class="field-item-visual field-house-svg" style="width:${width}px${display}">${visualHtml}</span>${extraHtml}`;
}

function moveFieldDragGhost(ghost, clientX, clientY) {
    if (!ghost) return;
    ghost.style.left = clientX + 'px';
    ghost.style.top = clientY + 'px';
}

function pointInRect(clientX, clientY, rect) {
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function rectIntersectsFinger(clientX, clientY, rect, radius = FIELD_FINGER_HIT_RADIUS_PX) {
    if (!rect) return false;
    const nearestX = clampRange(clientX, rect.left, rect.right);
    const nearestY = clampRange(clientY, rect.top, rect.bottom);
    return Math.hypot(clientX - nearestX, clientY - nearestY) <= radius;
}

function svgPointFromClient(svg, clientX, clientY) {
    const ctm = svg?.getScreenCTM?.();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    try {
        return point.matrixTransform(ctm.inverse());
    } catch {
        return null;
    }
}

function localPointInBBox(point, node) {
    if (!point || !node?.getBBox) return false;
    try {
        const box = node.getBBox();
        return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
    } catch {
        return false;
    }
}

function pointOverSvgPaint(svg, clientX, clientY) {
    const point = svgPointFromClient(svg, clientX, clientY);
    if (!point) return null;
    const geometryType = window.SVGGeometryElement;
    const textType = window.SVGTextContentElement;
    const imageType = window.SVGImageElement;
    for (const node of svg.querySelectorAll('*')) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        if (geometryType && node instanceof geometryType) {
            try {
                if (style.fill !== 'none' && node.isPointInFill(point)) return true;
                if (style.stroke !== 'none' && node.isPointInStroke(point)) return true;
            } catch {
                if (localPointInBBox(point, node)) return true;
            }
            continue;
        }
        if ((textType && node instanceof textType) || (imageType && node instanceof imageType)) {
            if (localPointInBBox(point, node)) return true;
        }
    }
    return false;
}

function imageAlphaCacheKey(img) {
    const src = img?.currentSrc || img?.src || '';
    const width = img?.naturalWidth || 0;
    const height = img?.naturalHeight || 0;
    return src && width > 0 && height > 0 ? `${src}::${width}x${height}` : '';
}

function getImageOpaqueAabb(img) {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;
    const key = imageAlphaCacheKey(img);
    if (!key) return null;
    if (FIELD_IMAGE_ALPHA_AABB_CACHE.has(key)) return FIELD_IMAGE_ALPHA_AABB_CACHE.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < canvas.height; y += 1) {
            const row = y * canvas.width * 4;
            for (let x = 0; x < canvas.width; x += 1) {
                if (data[row + x * 4 + 3] <= FIELD_IMAGE_ALPHA_HIT_THRESHOLD) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        const aabb = maxX >= minX && maxY >= minY
            ? { minX, minY, maxX: maxX + 1, maxY: maxY + 1, width: canvas.width, height: canvas.height }
            : { empty: true, width: canvas.width, height: canvas.height };
        FIELD_IMAGE_ALPHA_AABB_CACHE.set(key, aabb);
        return aabb;
    } catch {
        return null;
    }
}

function imageContentRect(img) {
    const rect = img?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0 || !img.naturalWidth || !img.naturalHeight) return rect;
    const boxRatio = rect.width / rect.height;
    const imageRatio = img.naturalWidth / img.naturalHeight;
    if (!Number.isFinite(boxRatio) || !Number.isFinite(imageRatio) || boxRatio <= 0 || imageRatio <= 0) return rect;
    if (imageRatio > boxRatio) {
        const height = rect.width / imageRatio;
        const top = rect.top + (rect.height - height) / 2;
        return { left: rect.left, right: rect.right, top, bottom: top + height, width: rect.width, height };
    }
    const width = rect.height * imageRatio;
    const left = rect.left + (rect.width - width) / 2;
    return { left, right: left + width, top: rect.top, bottom: rect.bottom, width, height: rect.height };
}

function imageOpaqueAabbClientRect(img) {
    if (!img) return null;
    const rect = imageContentRect(img);
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const aabb = getImageOpaqueAabb(img);
    if (!aabb) return null;
    if (aabb.empty) return { empty: true };
    return {
        left: rect.left + (aabb.minX / aabb.width) * rect.width,
        right: rect.left + (aabb.maxX / aabb.width) * rect.width,
        top: rect.top + (aabb.minY / aabb.height) * rect.height,
        bottom: rect.top + (aabb.maxY / aabb.height) * rect.height,
    };
}

function svgPaintAabbClientRect(svg) {
    if (!svg?.getBBox || !svg.getScreenCTM) return null;
    try {
        const box = svg.getBBox();
        const ctm = svg.getScreenCTM();
        if (!ctm || box.width <= 0 || box.height <= 0) return null;
        const point = svg.createSVGPoint();
        const corners = [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x + box.width, box.y + box.height],
            [box.x, box.y + box.height],
        ].map(([x, y]) => {
            point.x = x;
            point.y = y;
            return point.matrixTransform(ctm);
        });
        const xs = corners.map(corner => corner.x);
        const ys = corners.map(corner => corner.y);
        return {
            left: Math.min(...xs),
            right: Math.max(...xs),
            top: Math.min(...ys),
            bottom: Math.max(...ys),
        };
    } catch {
        return null;
    }
}

function fieldItemVisibleAabbClientRect(el) {
    const img = el?.querySelector?.('.field-house-img');
    const imageAabb = imageOpaqueAabbClientRect(img);
    if (imageAabb && !imageAabb.empty) return imageAabb;
    const svgAabb = svgPaintAabbClientRect(el?.querySelector?.('.field-item-visual svg'));
    if (svgAabb) return svgAabb;
    return getFieldItemImageRect(el);
}

function pointOverImageOpaqueAabb(img, clientX, clientY) {
    if (!img) return null;
    const rect = imageContentRect(img);
    if (!pointInRect(clientX, clientY, rect)) return false;
    const aabbRect = imageOpaqueAabbClientRect(img);
    if (!aabbRect) return true;
    if (aabbRect.empty) return false;
    return clientX >= aabbRect.left && clientX <= aabbRect.right && clientY >= aabbRect.top && clientY <= aabbRect.bottom;
}

function getFieldItemImageRect(el) {
    const image = el?.querySelector?.('.field-item-visual');
    const rect = image?.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ? rect : el?.getBoundingClientRect?.();
}

function pointOverFieldScaleControls(clientX, clientY) {
    const controls = document.getElementById('mhFieldItemScaleControls');
    if (!controls?.classList?.contains('is-visible')) return false;
    return Array.from(controls.querySelectorAll('.mh-field-scale-btn')).some(btn => {
        return pointInRect(clientX, clientY, btn.getBoundingClientRect?.());
    });
}

// 按物品 id 缓存 SVG 画面的外接框（SVG 用户坐标系，含 stroke 外扩余量）。
// 命中测试先用它做廉价的负向预筛，避免每个采样点都遍历全部 SVG 节点
//（getComputedStyle + isPointInFill 很贵）。
const FIELD_SVG_PAINT_BBOX_CACHE = new Map();

function fieldSvgPaintUserBBox(svg, cacheKey) {
    if (cacheKey && FIELD_SVG_PAINT_BBOX_CACHE.has(cacheKey)) return FIELD_SVG_PAINT_BBOX_CACHE.get(cacheKey);
    let box = null;
    try {
        const bbox = svg.getBBox();
        if (bbox && bbox.width > 0 && bbox.height > 0) {
            const pad = Math.max(bbox.width, bbox.height) * 0.06 + 6;
            box = { x0: bbox.x - pad, y0: bbox.y - pad, x1: bbox.x + bbox.width + pad, y1: bbox.y + bbox.height + pad };
        }
    } catch {
        box = null;
    }
    if (cacheKey && box) FIELD_SVG_PAINT_BBOX_CACHE.set(cacheKey, box);
    return box;
}

function fieldItemCacheKey(el) {
    const layout = activeFieldLayout(state.currentField);
    const idx = Number.parseInt(el?.dataset?.fidx, 10);
    return layout[idx]?.itemId || '';
}

function pointOverFieldItemPaint(el, clientX, clientY, imageRect = getFieldItemImageRect(el)) {
    if (!pointInRect(clientX, clientY, imageRect)) return false;
    const svg = el?.querySelector?.('.field-item-visual svg');
    if (svg) {
        const box = fieldSvgPaintUserBBox(svg, fieldItemCacheKey(el));
        if (box) {
            const point = svgPointFromClient(svg, clientX, clientY);
            if (point && (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1)) return false;
        }
    }
    const painted = pointOverSvgPaint(svg, clientX, clientY);
    if (painted != null) return painted;
    const img = el?.querySelector?.('.field-house-img');
    const imageAabbHit = pointOverImageOpaqueAabb(img, clientX, clientY);
    if (imageAabbHit != null) return imageAabbHit;
    return painted ?? true;
}

function fingerOverFieldItemPaint(el, clientX, clientY) {
    const imageRect = getFieldItemImageRect(el);
    if (!rectIntersectsFinger(clientX, clientY, imageRect)) return false;
    return FIELD_FINGER_HIT_SAMPLE_POINTS.some(([x, y]) => {
        const sampleX = clientX + x * FIELD_FINGER_HIT_RADIUS_PX;
        const sampleY = clientY + y * FIELD_FINGER_HIT_RADIUS_PX;
        return pointOverFieldItemPaint(el, sampleX, sampleY, imageRect);
    });
}

function getClosestDraggableFieldItem(clientX, clientY) {
    if (!isFieldDecorMode() || pointOverFieldScaleControls(clientX, clientY)) return null;
    let best = null;
    $$('.field-item').forEach(item => {
        if (!fingerOverFieldItemPaint(item, clientX, clientY)) return;
        const imageRect = getFieldItemImageRect(item);
        const centerX = imageRect.left + imageRect.width / 2;
        const centerY = imageRect.top + imageRect.height / 2;
        const distance = Math.hypot(clientX - centerX, clientY - centerY);
        // z-index 总以内联样式写入（stageHtml），直接读内联值避免 getComputedStyle
        const zIndex = Number.parseInt(item.style.zIndex, 10) || 0;
        if (!best || distance < best.distance || (distance === best.distance && zIndex > best.zIndex)) {
            best = { item, distance, zIndex };
        }
    });
    return best?.item || null;
}

function fieldItemScaleControlsAnchor(el) {
    const itemRect = el?.getBoundingClientRect?.();
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) return { leftPercent: 50, topPercent: 100 };
    const aabbRect = fieldItemVisibleAabbClientRect(el);
    if (!aabbRect || aabbRect.empty) return { leftPercent: 50, topPercent: 100 };
    const leftPercent = (((aabbRect.left + aabbRect.right) / 2 - itemRect.left) / itemRect.width) * 100;
    const topPercent = ((aabbRect.bottom - itemRect.top) / itemRect.height) * 100;
    return {
        leftPercent: clampRange(leftPercent, 0, 100),
        topPercent: clampRange(topPercent, 0, 100),
    };
}

function updateFieldItemScaleControlsAnchor(el, controls, ctx) {
    const anchor = fieldItemScaleControlsAnchor(el);
    controls.style.setProperty('--mh-field-scale-controls-left', `${anchor.leftPercent.toFixed(2)}%`);
    controls.style.setProperty('--mh-field-scale-controls-top', `${anchor.topPercent.toFixed(2)}%`);
    const img = el?.querySelector?.('.field-house-img');
    if (img && !img.complete && !img.__mhFieldScaleControlsLoadBound) {
        img.__mhFieldScaleControlsLoadBound = true;
        img.addEventListener('load', () => {
            img.__mhFieldScaleControlsLoadBound = false;
            updateFieldItemScaleControls(ctx);
        }, { once: true });
        img.addEventListener('error', () => { img.__mhFieldScaleControlsLoadBound = false; }, { once: true });
    }
}

function fieldHouseFlagAnchor(el) {
    const itemRect = el?.getBoundingClientRect?.();
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) return { rightPercent: 100, bottomPercent: 100 };
    const aabbRect = fieldItemVisibleAabbClientRect(el);
    if (!aabbRect || aabbRect.empty) return { rightPercent: 100, bottomPercent: 100 };
    return {
        rightPercent: clampRange(((aabbRect.right - itemRect.left) / itemRect.width) * 100, 0, 100),
        bottomPercent: clampRange(((aabbRect.bottom - itemRect.top) / itemRect.height) * 100, 0, 100),
    };
}

function updateFieldHouseFlagAnchor(el) {
    const flag = el?.querySelector?.(':scope > .field-house-flag');
    if (!flag) return;
    const anchor = fieldHouseFlagAnchor(el);
    flag.style.setProperty('--field-house-flag-right', `${anchor.rightPercent.toFixed(2)}%`);
    flag.style.setProperty('--field-house-flag-bottom', `${anchor.bottomPercent.toFixed(2)}%`);
    const img = el?.querySelector?.('.field-house-img');
    if (img && !img.complete && !img.__mhFieldHouseFlagLoadBound) {
        img.__mhFieldHouseFlagLoadBound = true;
        img.addEventListener('load', () => {
            img.__mhFieldHouseFlagLoadBound = false;
            updateFieldHouseFlagAnchor(el);
        }, { once: true });
        img.addEventListener('error', () => { img.__mhFieldHouseFlagLoadBound = false; }, { once: true });
    }
}

function updateFieldHouseFlagAnchors() {
    $$('.field-item .field-house-flag').forEach(flag => updateFieldHouseFlagAnchor(flag.closest('.field-item')));
}

function getFieldItemScale(item, placedItem = null) {
    const scale = Number(placedItem?.fieldSize ?? item?.fieldSize);
    const safeScale = Number.isFinite(scale) ? scale : FIELD_ITEM_DEFAULT_SCALE;
    return clampRange(safeScale, FIELD_ITEM_MIN_SCALE, FIELD_ITEM_MAX_SCALE);
}

function getFieldItemFontSize(item, placedItem = null) {
    return Math.round(FIELD_PET_BASE_SIZE_PX * getFieldItemScale(item, placedItem));
}

function currentFieldPanKey() {
    return normalizeTerrainFieldSlotId(state.currentField);
}

function metersToFieldPx(value) {
    return Math.max(1, Math.round((Number(value) || 0) * fieldPxPerMeter));
}

// 背景图支持 `src#x_y_w_h` 局部区域裁剪（与 NPC 图标同一约定，见 utils.js parseIconSource）。
// 裁剪时仍使用原图 <img>（保留 naturalWidth/complete/load 事件供平移与找宠逻辑复用），
// 只是用 transform 把裁剪区域缩放平移到刚好铺满容器，容器宽度也按裁剪区域的真实像素宽高比计算，避免拉伸变形。
function fieldImageCropRect(img) {
    const x = Number(img.dataset.cropX);
    const y = Number(img.dataset.cropY);
    const w = Number(img.dataset.cropW);
    const h = Number(img.dataset.cropH);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

function applyFieldCropImageLayout(img, rect, naturalWidth, naturalHeight, stageHeight) {
    if (!rect || !(naturalWidth > 0) || !(naturalHeight > 0) || !(stageHeight > 0)) {
        if (img.__mhFieldCropApplied) {
            img.style.position = '';
            img.style.top = '';
            img.style.left = '';
            img.style.width = '';
            img.style.height = '';
            img.style.transform = '';
            img.__mhFieldCropApplied = false;
        }
        return;
    }
    const displayHeight = stageHeight * 100 / rect.h;
    const displayWidth = displayHeight * naturalWidth / naturalHeight;
    img.style.position = 'absolute';
    img.style.top = '0';
    img.style.left = '0';
    img.style.height = `${displayHeight.toFixed(1)}px`;
    img.style.width = `${displayWidth.toFixed(1)}px`;
    img.style.transform = `translate(${(-(rect.x / 100) * displayWidth).toFixed(1)}px, ${(-(rect.y / 100) * displayHeight).toFixed(1)}px)`;
    img.__mhFieldCropApplied = true;
}

function fieldImageBackgroundWidthPx(scene, stageWidth, stageHeight) {
    const img = scene?.querySelector?.('.field-custom-background-image');
    if (!img) return null;
    if (!img.__mhFieldImageSizingBound) {
        img.__mhFieldImageSizingBound = true;
        img.addEventListener('load', applyFieldPan, { once: true });
        img.addEventListener('error', applyFieldPan, { once: true });
    }
    const width = img.naturalWidth || 0;
    const height = img.naturalHeight || 0;
    if (width <= 0 || height <= 0 || stageHeight <= 0) return Math.max(1, stageWidth || 1);
    const rect = fieldImageCropRect(img);
    applyFieldCropImageLayout(img, rect, width, height, stageHeight);
    const effWidth = rect ? width * rect.w / 100 : width;
    const effHeight = rect ? height * rect.h / 100 : height;
    return Math.max(1, stageWidth || 1, Math.round(stageHeight * effWidth / effHeight));
}

function recomputeFieldMetrics() {
    const stage = $('mhStage');
    const scene = $('mhFieldScene');
    const stageHeight = stage?.clientHeight || window.innerHeight || 540;
    const stageWidth = stage?.clientWidth || window.innerWidth || 1;
    fieldPxPerMeter = Math.max(1, stageHeight / FIELD_HEIGHT_METERS);
    if (scene) {
        const imageWidth = fieldImageBackgroundWidthPx(scene, stageWidth, stageHeight);
        const sceneWidth = imageWidth || metersToFieldPx(FIELD_WIDTH_METERS);
        scene.style.width = sceneWidth + 'px';
        scene.style.setProperty('--field-viewport-height', `${stageHeight}px`);
        scene.dataset.fieldWidthMeters = imageWidth ? (sceneWidth / fieldPxPerMeter).toFixed(3) : String(FIELD_WIDTH_METERS);
        scene.dataset.fieldHeightMeters = String(FIELD_HEIGHT_METERS);
    }
}

function updateFieldViewportParticleFrame(stage, scene) {
    if (!stage || !scene) return;
    const centerX = -fieldPan + (stage.clientWidth || window.innerWidth || 0) / 2;
    scene.style.setProperty('--field-viewport-center-x', `${centerX.toFixed(1)}px`);
    scene.style.setProperty('--field-viewport-height', `${stage.clientHeight || window.innerHeight || 540}px`);
}

function applyFieldPan() {
    const stage = $('mhStage');
    const scene = $('mhFieldScene');
    if (!stage || !scene) return;
    recomputeFieldMetrics();
    const key = currentFieldPanKey();
    const maxPan = Math.max(0, scene.offsetWidth - stage.clientWidth);
    if (!Number.isFinite(fieldPanById[key])) {
        fieldPanById[key] = -maxPan / 2;
    }
    fieldPan = clampRange(fieldPanById[key], -maxPan, 0);
    fieldPanById[key] = fieldPan;
    updateFieldViewportParticleFrame(stage, scene);
    scene.style.transform = `translate3d(${fieldPan.toFixed(1)}px,0,0)`;
}

function getFieldPanBounds() {
    const stage = $('mhStage');
    const scene = $('mhFieldScene');
    if (!stage || !scene) return null;
    recomputeFieldMetrics();
    const stageWidth = stage.clientWidth || window.innerWidth || 1;
    const sceneWidth = scene.offsetWidth || stageWidth;
    return {
        stage,
        scene,
        stageWidth,
        sceneWidth,
        maxPan: Math.max(0, sceneWidth - stageWidth),
    };
}

function setFieldPanValue(value) {
    const bounds = getFieldPanBounds();
    if (!bounds) return;
    fieldPan = clampRange(value, -bounds.maxPan, 0);
    fieldPanById[currentFieldPanKey()] = fieldPan;
    updateFieldViewportParticleFrame(bounds.stage, bounds.scene);
    bounds.scene.style.transform = `translate3d(${fieldPan.toFixed(1)}px,0,0)`;
}

// 平移拖拽的快速路径：拖拽期间场景尺寸不变，跳过 recomputeFieldMetrics 的
// 布局读写，只写 transform 与粒子视口中心。完整重排由拖拽结束时的 applyFieldPan 补足。
function applyFieldPanFast(bounds, value) {
    fieldPan = clampRange(value, -bounds.maxPan, 0);
    fieldPanById[bounds.panKey] = fieldPan;
    const centerX = -fieldPan + bounds.stageWidth / 2;
    bounds.scene.style.setProperty('--field-viewport-center-x', `${centerX.toFixed(1)}px`);
    bounds.scene.style.transform = `translate3d(${fieldPan.toFixed(1)}px,0,0)`;
}

function animateFieldPanTo(targetPan, duration, onComplete) {
    const bounds = getFieldPanBounds();
    if (!bounds) {
        onComplete?.();
        return;
    }
    const panKey = currentFieldPanKey();
    const startPan = fieldPan;
    const endPan = clampRange(targetPan, -bounds.maxPan, 0);
    const start = performance.now();
    const step = (now) => {
        const progress = clamp01((now - start) / Math.max(1, duration));
        const eased = 1 - Math.pow(1 - progress, 3);
        fieldPan = startPan + (endPan - startPan) * eased;
        fieldPanById[panKey] = fieldPan;
        updateFieldViewportParticleFrame(bounds.stage, bounds.scene);
        bounds.scene.style.transform = `translate3d(${fieldPan.toFixed(1)}px,0,0)`;
        if (progress < 1) requestAnimationFrame(step);
        else onComplete?.();
    };
    requestAnimationFrame(step);
}

function centerFieldPet(pet, { animate = false, duration = 520, onComplete = null } = {}) {
    const petId = pet?.id;
    if (!petId) return false;
    const petEl = Array.from(document.querySelectorAll('.field-pet')).find(el => el.dataset.fieldPet === petId);
    const bounds = getFieldPanBounds?.();
    if (!petEl || !bounds) return false;
    const leftPct = parseFloat(petEl.style.left);
    if (!Number.isFinite(leftPct)) return false;
    const petSceneX = bounds.sceneWidth * (leftPct / 100);
    const targetPan = clampRange(bounds.stageWidth / 2 - petSceneX, -bounds.maxPan, 0);
    if (animate && Math.abs(targetPan - fieldPan) > 0.5) animateFieldPanTo(targetPan, duration, onComplete);
    else {
        setFieldPanValue(targetPan);
        onComplete?.();
    }
    return true;
}

// Center the camera on the pet and resolve once the pan animation has settled.
// Used by the visit "合影" flow so the photo is only taken after the viewport
// has finished centering (otherwise the shutter/preview is framed mid-pan).
function centerFieldPetAndWait(pet, { duration = 420, maxWait = 900 } = {}) {
    return new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        // Safety timeout in case centering is skipped (e.g. element not yet mounted).
        const timer = setTimeout(finish, maxWait);
        // Wait a frame so the re-rendered pet element is in the DOM at its new spot.
        requestAnimationFrame(() => {
            const centered = centerFieldPet(pet, {
                animate: true,
                duration,
                onComplete: () => { clearTimeout(timer); finish(); },
            });
            if (!centered) { clearTimeout(timer); finish(); }
        });
    });
}

function scheduleCenterFieldPet(pet, options = {}) {
    const panKey = currentFieldPanKey();
    const petId = pet?.id;
    if (!petId) return;
    const run = (nextOptions = {}) => {
        if (currentFieldPanKey() !== panKey) return false;
        try { return centerFieldPet(pet, { ...options, ...nextOptions }); }
        catch (_) { return false; }
    };
    const recenterAfterImageSizing = () => {
        const img = document.querySelector('#mhFieldScene .field-custom-background-image');
        if (!img || img.complete) return;
        const onReady = () => requestAnimationFrame(() => run({ animate: false, onComplete: null }));
        img.addEventListener('load', onReady, { once: true });
        img.addEventListener('error', onReady, { once: true });
    };
    requestAnimationFrame(() => {
        run();
        recenterAfterImageSizing();
        requestAnimationFrame(() => run({ animate: false, onComplete: null }));
    });
}

function getPoopsInField(pet, fieldId = state.currentField) {
    const targetFieldId = normalizeTerrainFieldSlotId(fieldId);
    const count = getPetPoopCount(pet, targetFieldId);
    return ensureRuntimePoopLocations(pet, targetFieldId, count);
}

function fieldPoopLocationKey(pet, fieldId = state.currentField) {
    return `${pet?.id || 'pet'}::${normalizeTerrainFieldSlotId(fieldId)}`;
}

function getPoopPetAvoidanceZones(pet, fieldId) {
    if (!pet || isVisitingMode()) return [];
    const ids = getFieldPetIds(pet, fieldId).filter(id => state.pets[id]);
    const activeFieldPosition = pet?.id ? petFieldPosition(pet, fieldId, 0) : null;
    const petZones = ids.map((id, index) => {
        const pos = id === pet?.id
            ? activeFieldPosition
            : petFieldPosition(state.pets[id], fieldId, index, activeFieldPosition);
        return pos ? { x: clamp01(pos.x), y: clamp01(pos.y) } : null;
    }).filter(Boolean);
    // 便便也不能掉在有对话/小游戏的静态 NPC 身上。
    return [...petZones, ...fieldNpcAvoidancePoints(fieldId)];
}

function isPoopOnPet(pos, zones) {
    return zones.some(zone => {
        const dx = (pos.x - zone.x) / (zone.radiusX || POOP_PET_AVOID_X);
        const dy = (pos.y - zone.y) / (zone.radiusY || POOP_PET_AVOID_Y);
        return dx * dx + dy * dy < 1;
    });
}

function makeRuntimePoopLocation(rng, zones) {
    let fallback = null;
    for (let attempt = 0; attempt < 40; attempt++) {
        const lowerHalf = rng() < POOP_LOWER_HALF_CHANCE;
        const x = 0.08 + rng() * 0.84;
        const y = lowerHalf
            ? 0.56 + Math.pow(rng(), 0.72) * 0.36
            : 0.40 + rng() * 0.20;
        const pos = { x: clampRange(x, 0.06, 0.94), y: clampRange(y, 0.38, 0.92) };
        if (!fallback) fallback = pos;
        if (!isPoopOnPet(pos, zones)) return pos;
    }
    if (!fallback) fallback = { x: 0.5, y: 0.78 };
    for (const zone of zones) {
        const dx = fallback.x - zone.x;
        const dy = fallback.y - zone.y;
        const angle = Math.atan2(dy || 0.01, dx || 0.01);
        const rx = (zone.radiusX || POOP_PET_AVOID_X) * 1.18;
        const ry = (zone.radiusY || POOP_PET_AVOID_Y) * 1.18;
        fallback.x = clampRange(zone.x + Math.cos(angle) * rx, 0.06, 0.94);
        fallback.y = clampRange(zone.y + Math.sin(angle) * ry, 0.56, 0.92);
    }
    return fallback;
}

function ensureRuntimePoopLocations(pet, fieldId, count) {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const key = fieldPoopLocationKey(pet, fieldId);
    if (safeCount <= 0) {
        fieldPoopLocationCache.delete(key);
        return [];
    }
    let record = fieldPoopLocationCache.get(key);
    if (!record) {
        record = { nextId: 1, locations: [] };
        fieldPoopLocationCache.set(key, record);
    }
    if (record.locations.length > safeCount) record.locations.length = safeCount;
    const zones = getPoopPetAvoidanceZones(pet, fieldId);
    while (record.locations.length < safeCount) {
        const index = record.nextId++;
        const rng = makeRng(`${POOP_LOCATION_SESSION_SEED}::${key}::${index}`);
        record.locations.push({
            id: `poop_${normalizeTerrainFieldSlotId(fieldId)}_${index}`,
            field: normalizeTerrainFieldSlotId(fieldId),
            ...makeRuntimePoopLocation(rng, zones),
        });
    }
    return record.locations.map(location => ({ ...location }));
}

function clearRuntimePoopLocations(pet, fieldId = state.currentField) {
    fieldPoopLocationCache.delete(fieldPoopLocationKey(pet, fieldId));
}

function removeRuntimePoopLocation(pet, fieldId, poopId) {
    const key = fieldPoopLocationKey(pet, fieldId);
    const record = fieldPoopLocationCache.get(key);
    if (!record) return;
    record.locations = record.locations.filter(location => location.id !== poopId);
    if (!record.locations.length) fieldPoopLocationCache.delete(key);
    else fieldPoopLocationCache.set(key, record);
}

function fieldMiningCoins(now = Date.now()) {
    return getPlanetMiningCoins(state, now, CONFIG);
}

function splitFieldMiningCoinValues(total, count) {
    const maxScatteredCoins = getPlanetMiningConfig(CONFIG).maxScatteredCoins;
    const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
    const safeCount = Math.max(0, Math.min(maxScatteredCoins, Math.floor(Number(count) || 0)));
    if (safeTotal <= 0 || safeCount <= 0) return [];
    const base = Math.floor(safeTotal / safeCount);
    let remainder = safeTotal - base * safeCount;
    return Array.from({ length: safeCount }, () => base + (remainder-- > 0 ? 1 : 0)).filter(value => value > 0);
}

function fieldMiningCoinLocationKey(fieldId = state.currentField) {
    return `mining::${normalizeTerrainFieldSlotId(fieldId)}`;
}

function makeRuntimeFieldMiningCoin(rng, zones, fieldId, index, value) {
    return {
        id: `coin_${normalizeTerrainFieldSlotId(fieldId)}_${index}`,
        field: normalizeTerrainFieldSlotId(fieldId),
        value: Math.max(1, Math.floor(Number(value) || 1)),
        ...makeRuntimePoopLocation(rng, zones),
    };
}

function fieldMiningCoinHtml(coin) {
    const value = Math.max(0, Math.floor(Number(coin?.value) || 0));
    return `<button class="poop-btn field-coin-btn" data-poop="${escapeHtml(coin?.id || '')}" data-field-coin="${escapeHtml(coin?.id || '')}" style="left:${(clamp01(coin?.x) * 100).toFixed(2)}%;top:${(clamp01(coin?.y) * 100).toFixed(2)}%" title="收集 ${value} 金币">${coinIconSvg('field-coin-svg')}</button>`;
}

function ensureRuntimeFieldMiningCoins(fieldId, totalCoins, pet = state.pets?.[state.currentPetId]) {
    const maxScatteredCoins = getPlanetMiningConfig(CONFIG).maxScatteredCoins;
    const total = Math.max(0, Math.floor(Number(totalCoins) || 0));
    const key = fieldMiningCoinLocationKey(fieldId);
    if (total <= 0) {
        fieldMiningCoinLocationCache.delete(key);
        return [];
    }
    let record = fieldMiningCoinLocationCache.get(key);
    if (!record) {
        record = { nextId: 1, locations: [] };
        const count = getPlanetMiningVisualCoinCount(total, CONFIG);
        const zones = getPoopPetAvoidanceZones(pet, fieldId);
        splitFieldMiningCoinValues(total, count).forEach((value) => {
            const index = record.nextId++;
            const rng = makeRng(`${POOP_LOCATION_SESSION_SEED}::${key}::${index}`);
            record.locations.push(makeRuntimeFieldMiningCoin(rng, zones, fieldId, index, value));
        });
        fieldMiningCoinLocationCache.set(key, record);
    }
    let currentTotal = record.locations.reduce((sum, coin) => sum + (Number(coin.value) || 0), 0);
    while (currentTotal > total && record.locations.length) {
        const last = record.locations[record.locations.length - 1];
        const reduce = Math.min(currentTotal - total, Math.max(0, Number(last.value) || 0));
        last.value -= reduce;
        currentTotal -= reduce;
        if (last.value <= 0) record.locations.pop();
    }
    if (currentTotal < total) {
        const diff = total - currentTotal;
        if (record.locations.length < maxScatteredCoins) {
            const index = record.nextId++;
            const rng = makeRng(`${POOP_LOCATION_SESSION_SEED}::${key}::${index}`);
            const zones = getPoopPetAvoidanceZones(pet, fieldId);
            record.locations.push(makeRuntimeFieldMiningCoin(rng, zones, fieldId, index, diff));
        } else if (record.locations.length) {
            record.locations[record.locations.length - 1].value += diff;
        }
    }
    if (!record.locations.length) {
        fieldMiningCoinLocationCache.delete(key);
        return [];
    }
    return record.locations.map(location => ({ ...location, kind: 'coin' }));
}

function getFieldMiningCoinsInField(fieldId = state.currentField, pet = state.pets?.[state.currentPetId]) {
    if (isVisitingMode()) return [];
    return ensureRuntimeFieldMiningCoins(fieldId, fieldMiningCoins(), pet);
}

function clearRuntimeFieldMiningCoins(fieldId = state.currentField) {
    fieldMiningCoinLocationCache.delete(fieldMiningCoinLocationKey(fieldId));
}

function removeRuntimeFieldMiningCoin(fieldId, coinId) {
    const key = fieldMiningCoinLocationKey(fieldId);
    const record = fieldMiningCoinLocationCache.get(key);
    if (!record) return;
    record.locations = record.locations.filter(location => location.id !== coinId);
    if (!record.locations.length) fieldMiningCoinLocationCache.delete(key);
    else fieldMiningCoinLocationCache.set(key, record);
}

function hasTooManyPoops(pet, fieldId = state.currentField) {
    return getPoopsInField(pet, fieldId).length > CONFIG.poopWarningThreshold;
}

function updateCleanPoopsButton(pet) {
    const cleanBtn = $('mhFieldCleanPoopsBtn');
    if (!cleanBtn) return;
    const poopCount = getPoopsInField(pet).length;
    const coinCount = getFieldMiningCoinsInField(state.currentField, pet).length;
    const totalCount = poopCount + coinCount;
    const isUrgent = poopCount > CONFIG.poopWarningThreshold;
    setDockButtonDisabled(cleanBtn, totalCount === 0, t('cleanDisabledReason'));
    cleanBtn.classList.toggle('is-urgent', isUrgent && totalCount > 0);
    cleanBtn.title = isUrgent
        ? t('cleanUrgentTitle', { count: poopCount, cost: CONFIG.poopMachineCostCoins })
        : (poopCount > 0
            ? t('cleanPoopTitle', { cost: CONFIG.poopMachineCostCoins })
            : t('cleanCoinsTitle'));
}

function updateBiofuelHud() {
    const fuel = $('mhBiofuel');
    const fuelValue = fuel?.querySelector?.('[data-hud-value="biofuel"]');
    if (fuelValue) fuelValue.textContent = String(state.biofuel | 0);
    else if (fuel) fuel.textContent = `⛽ ${state.biofuel | 0}`;
}

function updateCoinsHud() {
    const coins = $('mhCoins');
    const coinsValue = coins?.querySelector?.('[data-hud-value="coins"]');
    if (coinsValue) coinsValue.textContent = String(state.coins | 0);
}

// 把当前宠物瞬移到对方（好友）宠物身边，并重渲染场景。返回是否成功。
function teleportCurrentPetNextToHost() {
    const visit = state.visitingMode;
    if (!visit?.active) return false;
    const friendPet = visit.friendPet;
    if (!friendPet) return false;
    const fieldId = state.currentField;
    const existing = state.activePetFieldPose?.fieldId === fieldId ? state.activePetFieldPose : null;
    const targetX = clamp01(existing?.targetX ?? 0.52);
    const targetY = clamp01(existing?.targetY ?? 0.62);
    const side = (existing?.x ?? targetX) <= targetX ? -1 : 1;
    state.activePetFieldPose = {
        fieldId,
        targetPetId: friendPet.id || 'friend',
        targetX,
        targetY,
        x: clamp01(targetX + side * 0.11),
        y: clamp01(targetY + 0.035),
        delay: 0,
        dur: 9,
        dx: 0,
        dy: 0,
    };
    notify();
    return true;
}

function renderFieldActionTray(pet) {
    if (isVisitingMode()) {
        return `
            <div class="mh-dock-row mh-scroll-x dock-action-row visit-field-actions">
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-field-action="visit-wave">
                    <span class="dock-icon">👋</span>
                    <span class="dock-label">${escapeHtml(t('dockVisitWave'))}</span>
                </button>
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-field-action="visit-photo">
                    <span class="dock-icon">📷</span>
                    <span class="dock-label">${escapeHtml(t('dockVisitPhoto'))}</span>
                </button>
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-field-action="visit-return">
                    <span class="dock-icon">🚀</span>
                    <span class="dock-label">${escapeHtml(t('dockVisitReturn'))}</span>
                </button>
            </div>
        `;
    }
    const sleeping = isPetInteractionBlocked(pet);
    const sleepAction = getPetSleepActionState(pet);
    const isEgg = pet?.stage === 'egg';
    const playDisabled = isEgg;
    const playTitle = isEgg ? t('eggHatchBeforePlay') : (sleeping ? t('playWillWake') : '');
    const hatchingDisabled = sleeping || isEgg;
    const hatchingTitle = isEgg ? t('eggHatchBeforePod') : (sleeping ? sleepingInteractionText(pet) : '');
    const sleepDisabled = isEgg || sleepAction.disabled;
    const sleepTitle = isEgg ? t('eggHatchBeforeSleep') : sleepAction.title;
    const poopCount = getPoopsInField(pet).length;
    const coinCount = getFieldMiningCoinsInField(state.currentField, pet).length;
    const cleanCount = poopCount + coinCount;
    const urgentClass = hasTooManyPoops(pet) ? ' is-urgent' : '';
    const cleanTitle = hasTooManyPoops(pet)
        ? t('cleanUrgentTitle', { count: poopCount, cost: CONFIG.poopMachineCostCoins })
        : (poopCount > 0
            ? t('cleanPoopTitle', { cost: CONFIG.poopMachineCostCoins })
            : t('cleanCoinsTitle'));
    const cleanDisabledReason = t('cleanDisabledReason');
    return `
        <div class="mh-dock-row mh-scroll-x dock-action-row">
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-decor-action mh-field-mode-toggle" id="mhFieldDecorBtn">
                <span class="dock-icon">🛠</span>
                <span class="dock-label">${escapeHtml(t('dockBuild'))}</span>
            </button>
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-field-clean-action${urgentClass}${cleanCount ? '' : ' is-sleep-disabled'}" id="mhFieldCleanPoopsBtn"${dockDisabledAttrs(!cleanCount, cleanDisabledReason)} title="${escapeHtml(cleanTitle)}">
                <span class="dock-icon">♻️</span>
                <span class="dock-label">${escapeHtml(t('dockClean'))}</span>
            </button>
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-field-nav-action${playDisabled ? ' is-sleep-disabled' : ''}" data-field-nav="minigames"${dockDisabledAttrs(playDisabled, playTitle)} title="${escapeHtml(playTitle)}">
                <span class="dock-icon">🎾</span>
                <span class="dock-label">${escapeHtml(t('dockPlay'))}</span>
            </button>
            ${String(state.settings?.starSettlement?.encyclopediaUrl || '').trim() ? `
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-field-nav-action" data-field-nav="encyclopedia" title="${escapeHtml(t('encTitle'))}">
                <span class="dock-icon">📖</span>
                <span class="dock-label">${escapeHtml(t('dockEncyclopedia'))}</span>
            </button>` : ''}
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-field-action${sleepDisabled ? ' is-sleep-disabled' : ''}" data-field-action="sleep"${dockDisabledAttrs(sleepDisabled, sleepTitle)} title="${escapeHtml(sleepTitle)}">
                <span class="dock-icon">${sleepAction.icon}</span>
                <span class="dock-label">${escapeHtml(sleepAction.label)}</span>
            </button>
            <button type="button" class="btn-secondary action-btn dock-icon-btn mh-field-nav-action${hatchingDisabled ? ' is-sleep-disabled' : ''}" data-field-nav="hatching"${dockDisabledAttrs(hatchingDisabled, hatchingTitle)} title="${escapeHtml(hatchingTitle)}">
                <span class="dock-icon">🥚</span>
                <span class="dock-label">${escapeHtml(t('dockHatchPod'))}</span>
            </button>
        </div>
    `;
}

function renderFieldDecorTray(inv, currentField) {
    const areaId = currentField.typeId || resolveTerrainFieldTypeId(currentField.id);
    const ownedItems = Object.entries(inv || {})
        .map(([id, qty]) => ({ ...ITEM_BY_ID[id], qty }))
        .filter(it => it && it.id && (it.type === 'furniture' || it.type === 'house') && canPlaceItemInArea(it, areaId));
    const ownedIds = new Set(ownedItems.map(item => item.id));
    const unlimitedItems = SHOP_ITEMS
        .filter(it => it.unlimited && !ownedIds.has(it.id) && (it.type === 'furniture' || it.type === 'house') && canPlaceItemInArea(it, areaId))
        .map(it => ({ ...it, qty: Infinity }));
    const items = [...ownedItems, ...unlimitedItems];
    const shopButton = `
        <button type="button" class="shop-item mh-field-shop-button" data-field-shop="outdoor" style="min-width:62px;padding:6px;flex-shrink:0">
            <div class="emoji shop-item-visual shop-item-emoji">🛒</div>
            <div class="name" style="font-size:10px">${escapeHtml(t('shop'))}</div>
        </button>`;
    return `
        <div class="mh-dock-tray mh-scroll-x">
            ${items.length === 0
                ? `<div class="mh-dock-hint">${escapeHtml(t('trayEmpty'))}</div>`
                : items.map(it => {
                    const showCount = !it.uniqueItem && (it.unlimited || it.qty > 1);
                    const countHtml = showCount ? `<span class="shop-item-count-badge">${it.unlimited ? '∞' : escapeHtml(it.qty)}</span>` : '';
                    return `
                    <div data-tray-item="${escapeHtml(it.id)}" class="shop-item" style="min-width:62px;padding:6px;flex-shrink:0">
                        ${renderFieldTrayIcon(it)}
                        <div class="name" style="font-size:10px">${escapeHtml(itemName(it.name))}</div>
                        ${countHtml}
                    </div>`;
                }).join('')}
            ${shopButton}
        </div>
    `;
}

function renderFieldTrayIcon(item) {
    const visualHtml = renderVisualAsset(getItemVisual(item), { className: 'shop-item-img', alt: item?.name || '' });
    return visualHtml
        ? `<div class="emoji shop-item-visual">${visualHtml}</div>`
        : `<div class="emoji shop-item-visual shop-item-emoji">${escapeHtml(item?.emoji || '')}</div>`;
}

function ensureFieldScenePresetsLoaded() {
    if (fieldScenePresets.length || fieldScenePresetsLoading) return;
    fieldScenePresetsLoading = loadScenePresets()
        .then((presets) => {
            fieldScenePresets = Array.isArray(presets) ? presets : [];
            notify();
        })
        .catch((e) => console.warn('加载建造背景预设失败', e))
        .finally(() => { fieldScenePresetsLoading = null; });
}

function fieldSceneSettings() {
    const settings = state.settings || (state.settings = {});
    const rawScenes = settings.fieldScenes && typeof settings.fieldScenes === 'object' && !Array.isArray(settings.fieldScenes)
        ? settings.fieldScenes
        : {};
    const normalized = {};
    let changed = rawScenes !== settings.fieldScenes;
    Object.entries(rawScenes).forEach(([rawKey, config]) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return;
        const key = normalizeTerrainFieldSlotId(String(rawKey || '').replace(/^field_/, ''));
        if (!/^[1-7]$/.test(key)) return;
        normalized[key] = { ...(normalized[key] || {}), ...config };
        if (key !== rawKey) changed = true;
    });
    if (changed) settings.fieldScenes = normalized;
    else if (!settings.fieldScenes) settings.fieldScenes = normalized;
    return settings.fieldScenes;
}

function resolveFieldSceneConfigFromSaved(fieldId, saved = {}) {
    if (saved.background?.presetId || saved.background?.imageUrl || saved.background?.color) return saved;
    const typeId = resolveTerrainFieldTypeId(fieldId);
    const preset = CONFIG.fieldDefaultScenes?.[typeId];
    if (!preset) return saved;
    return {
        ...saved,
        background: {
            type: preset.imageUrl ? 'image' : 'color',
            color: preset.color || '#bae6fd',
            imageUrl: preset.imageUrl || '',
            presetId: preset.id || '',
            title: preset.title || '',
        },
        particles: Array.isArray(saved.particles) ? saved.particles : (Array.isArray(preset.particles) ? [...preset.particles] : []),
        bgMusic: saved.bgMusic || preset.bgMusic || '',
    };
}

function currentFieldSceneConfig(fieldId = state.currentField) {
    const saved = fieldSceneSettings()[normalizeTerrainFieldSlotId(fieldId)] || {};
    return resolveFieldSceneConfigFromSaved(fieldId, saved);
}

// 拜访好友星球时，优先使用对方保存的场景背景；若对方未自定义，则回退到默认的现代场景预设
// （而不是旧的 SVG 程序化地图）。
function visitingFieldSceneConfig(fieldId = state.currentField) {
    const remoteScenes = state.visitingMode?.remoteProfile?.settings?.fieldScenes;
    const saved = (remoteScenes && typeof remoteScenes === 'object' && !Array.isArray(remoteScenes))
        ? (remoteScenes[normalizeTerrainFieldSlotId(fieldId)] || {})
        : {};
    return resolveFieldSceneConfigFromSaved(fieldId, saved);
}

function saveCurrentFieldSceneConfig(fieldId, patch) {
    if (isReadonlyPlanet()) {
        showToast('官方星球的场景不能修改。', 'info', 1400);
        return;
    }
    const scenes = fieldSceneSettings();
    const slotId = normalizeTerrainFieldSlotId(fieldId);
    const next = { ...(scenes[slotId] || {}), ...(patch || {}) };
    if (next.background && Object.prototype.hasOwnProperty.call(next.background, 'tags')) {
        const { tags, ...background } = next.background;
        next.background = background;
    }
    scenes[slotId] = next;
    saveFieldScenesDebounced(scenes);
    notify();
}

function fieldSceneTag(fieldId) {
    const typeId = resolveTerrainFieldTypeId(fieldId);
    if (typeId === 'water') return 'ocean';
    return typeId || 'land';
}

function fieldBackgroundPresets(currentField) {
    const tag = fieldSceneTag(currentField.id);
    const tagged = fieldScenePresets.filter(scene => {
        const tags = new Set((scene.tags || []).map(item => String(item || '').toLowerCase()));
        return tags.has('outdoor') && tags.has(tag);
    });
    return rankScenePresets(['outdoor', tag], tagged.length ? tagged : fieldScenePresets).map(item => item.scene);
}

function selectedFieldPresetId(fieldId = state.currentField) {
    return currentFieldSceneConfig(fieldId).background?.presetId || '';
}

function renderFieldBackgroundTray(currentField) {
    ensureFieldScenePresetsLoaded();
    const presets = fieldBackgroundPresets(currentField);
    const selectedId = selectedFieldPresetId(currentField.id);
    if (!presets.length) {
        return `<div class="mh-dock-tray mh-scroll-x"><div class="mh-dock-hint">${escapeHtml(t('fieldLoadingBg', { name: localizeFieldName(currentField) }))}</div></div>`;
    }
    return `
        <div class="mh-dock-tray mh-scroll-x mh-field-build-tray mh-field-background-tray">
            ${presets.map(scene => `
                <button type="button" class="mh-field-build-card ${scene.id === selectedId ? 'is-active' : ''}" data-field-background="${escapeHtml(scene.id)}">
                    <span class="mh-field-build-card-art" ${lazySceneBackgroundAttrs(scene, scene.color)}>${renderSceneParticles(scene, { density: 'thumbnail' })}</span>
                    <span class="mh-field-build-card-title">${escapeHtml(scene.title)}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function selectedFieldParticles(fieldId = state.currentField) {
    const effects = currentFieldSceneConfig(fieldId).particles;
    return Array.isArray(effects) ? effects : [];
}

function renderFieldEffectsTray(currentField) {
    const active = new Set(selectedFieldParticles(currentField.id));
    return `
        <div class="mh-dock-tray mh-scroll-x mh-field-build-tray mh-field-card-tray">
            <button type="button" class="mh-field-build-card mh-field-icon-card ${active.size ? '' : 'is-active'}" data-field-effect="">
                <span class="mh-field-build-card-art mh-field-build-card-icon">Ø</span>
                <span class="mh-field-build-card-title">${escapeHtml(t('fieldNoEffect'))}</span>
            </button>
            ${PARTICLE_EFFECTS.map(effect => `
                <button type="button" class="mh-field-build-card mh-field-icon-card ${active.has(effect.id) ? 'is-active' : ''}" data-field-effect="${escapeHtml(effect.id)}">
                    <span class="mh-field-build-card-art mh-field-build-card-icon">${escapeHtml(FIELD_EFFECT_EMOJIS[effect.id] || '✨')}</span>
                    <span class="mh-field-build-card-title">${escapeHtml(effect.label)}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function selectedFieldMusic(fieldId = state.currentField) {
    return String(currentFieldSceneConfig(fieldId).bgMusic || '');
}

function renderFieldMusicTray(currentField) {
    const active = selectedFieldMusic(currentField.id);
    const options = bgMusicOptions();
    return `
        <div class="mh-dock-tray mh-scroll-x mh-field-build-tray mh-field-card-tray">
            <button type="button" class="mh-field-build-card mh-field-icon-card ${active ? '' : 'is-active'}" data-field-music="">
                <span class="mh-field-build-card-art mh-field-build-card-icon">🔇</span>
                <span class="mh-field-build-card-title">${escapeHtml(t('fieldNoMusic'))}</span>
            </button>
            ${options.map(option => `
                <button type="button" class="mh-field-build-card mh-field-icon-card ${active === option.id ? 'is-active' : ''}" data-field-music="${escapeHtml(option.id)}">
                    <span class="mh-field-build-card-art mh-field-build-card-icon">${escapeHtml(FIELD_MUSIC_EMOJIS[option.id] || '🎵')}</span>
                    <span class="mh-field-build-card-title">${escapeHtml(bgMusicLabel(option.id))}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function fieldMusicToggleHtml(fieldId) {
    const music = selectedFieldMusic(fieldId);
    if (!music || isVisitingMode()) return '';
    const muted = soundManager.isBgMusicMuted?.();
    return `<button type="button" class="field-music-toggle ${muted ? 'is-muted' : ''}" data-field-music-toggle aria-label="${muted ? escapeHtml(t('fieldMusicOn')) : escapeHtml(t('fieldMute'))}" title="${muted ? escapeHtml(t('fieldMusicOn')) : escapeHtml(t('fieldMute'))}">${muted ? '♪' : '♫'}</button>`;
}

function renderActiveFieldBuildTray(inv, currentField) {
    if (isReadonlyPlanet() && ['backgrounds', 'effects', 'music'].includes(activeFieldBuildCategory)) activeFieldBuildCategory = 'houses';
    if (activeFieldBuildCategory === 'backgrounds') return renderFieldBackgroundTray(currentField);
    if (activeFieldBuildCategory === 'effects') return renderFieldEffectsTray(currentField);
    if (activeFieldBuildCategory === 'music') return renderFieldMusicTray(currentField);
    return renderFieldDecorTray(inv, currentField);
}

function getUserSeedBase() {
    const configured = String(state.settings?.fieldMapSeed || '').trim();
    if (configured) return configured;
    return state.user?.username || state.user?.name || state.user?.id || 'guest';
}

// 返回当前 field 真实使用的背景，用于合影拍照时还原真实场景。
// { imageUrl, gradient } —— imageUrl 优先；否则使用 gradient（CSS 渐变或纯色字符串）。
function getCurrentFieldBackground(fieldId = state.currentField) {
    const custom = isVisitingMode() ? visitingFieldSceneConfig(fieldId) : currentFieldSceneConfig(fieldId);
    const customBg = custom.background;
    if (customBg?.imageUrl) return { imageUrl: customBg.imageUrl, gradient: '' };
    const typeId = resolveTerrainFieldTypeId(fieldId);
    const theme = FIELD_THEMES[typeId] || FIELD_THEMES.land;
    return { imageUrl: '', gradient: customBg?.color || theme.sky };
}

// 星球编辑器摆放的 NPC 不参与玩家的家具布局存档；部分 NPC 可在运行时自动站到主宠物身边。
function currentFieldNpcs(fieldId = state.currentField) {
    const custom = isVisitingMode() ? visitingFieldSceneConfig(fieldId) : currentFieldSceneConfig(fieldId);
    return Array.isArray(custom.npcs) ? custom.npcs : [];
}

function currentFieldAreaLinks(fieldId = state.currentField) {
    const custom = isVisitingMode() ? visitingFieldSceneConfig(fieldId) : currentFieldSceneConfig(fieldId);
    return Array.isArray(custom.areaLinks) ? custom.areaLinks : [];
}

function fieldAreaLinkHtml(link) {
    return `<button type="button" class="field-area-link" data-area-target-field="${escapeHtml(link.targetFieldId)}" style="left:${Number(link.x) || 0}%;top:${Number(link.y) || 0}%">${escapeHtml(link.label)}</button>`;
}

// NPC 奖励和盲盒小游戏使用同源 localStorage。领取键包含蛋的 startedAt/code，兑换新蛋后可重新领取。
function applyNpcHatchBoost(npc, fieldId) {
    const boostSeconds = Math.max(0, Math.min(86400, Math.round(Number(npc?.hatchBoostSeconds) || 0)));
    if (!boostSeconds) return;
    try {
        const eggState = JSON.parse(localStorage.getItem(BLIND_BOX_EGG_STORAGE_KEY) || 'null');
        if (!eggState || !Number.isFinite(Number(eggState.startedAt))) {
            // 带小游戏的 NPC 应直接进入互动，不要先用“没有宠物蛋”的奖励提示干扰或遮挡启动流程。
            // 纯孵化加速 NPC 仍保留引导，提醒玩家先兑换宠物蛋。
            if (!npc?.minigame) showToast('先去兑换一颗盲盒宠物蛋，再来领取孵化加速吧', 'info', 2400);
            return;
        }
        const planetId = String(state.settings?.starSettlement?.planetId || 'default');
        const cycleId = `${eggState.startedAt}:${eggState.code || ''}`;
        const rewardKey = `${cycleId}:${planetId}:${fieldId}:${npc.id || npc.name || 'npc'}`;
        const claimed = eggState.claimedNpcRewards && typeof eggState.claimedNpcRewards === 'object'
            ? eggState.claimedNpcRewards
            : (eggState.claimedNpcRewards = {});
        if (claimed[rewardKey]) {
            showToast(`${npc.name || '这位朋友'}已经为这颗蛋加速过啦`, 'info', 2000);
            return;
        }
        eggState.acceleratedMs = Math.max(0, Number(eggState.acceleratedMs) || 0) + boostSeconds * 1000;
        claimed[rewardKey] = Date.now();
        eggState.version = Math.max(3, Number(eggState.version) || 0);
        localStorage.setItem(BLIND_BOX_EGG_STORAGE_KEY, JSON.stringify(eggState));
        const minutes = Math.round(boostSeconds / 60);
        showToast(`✨ ${npc.name || 'NPC'}送来祝福，孵化加速 ${minutes} 分钟！`, 'success', 2800);
    } catch (_) {
        showToast('孵化加速暂时无法保存，请稍后再试', 'error', 2200);
    }
}

function positionedFieldNpcs(fieldId = state.currentField, mainPet = getPet(state.currentPetId)) {
    const npcs = currentFieldNpcs(fieldId);
    const mainPosition = mainPet?.id ? petFieldPosition(mainPet, fieldId, 0) : null;
    const placed = npcs
        .filter(npc => !npc?.randomNearMainPet)
        .map(npc => fieldNpcPlacementPoint(npc));
    if (mainPosition) placed.push({ x: mainPosition.x, y: mainPosition.y });
    return npcs.map((npc, index) => {
        if (!npc?.randomNearMainPet || !mainPosition) return npc;
        const rng = makeRng(`${getUserSeedBase()}::${fieldId}::npc-near-main::${npc.id || index}`);
        const angle = rng() * Math.PI * 2;
        const radius = FIELD_NPC_NEAR_PET_MIN_RADIUS + rng() * FIELD_NPC_NEAR_PET_RANDOM_RADIUS;
        const pos = repelFieldPetPosition({
            id: `npc-${npc.id || index}`,
            fieldId,
            pos: {
                x: clampRange(mainPosition.x + Math.cos(angle) * radius, 0.08, 0.92),
                y: clampRange(mainPosition.y + Math.sin(angle) * radius * FIELD_NPC_NEAR_PET_Y_SCALE, 0.36, FIELD_PET_MAX_Y),
            },
        }, placed, index);
        const positioned = { ...npc, x: pos.x * 100, y: pos.y * 100 };
        placed[placed.length - 1] = fieldNpcPlacementPoint(positioned);
        return positioned;
    });
}

function fieldNpcPlacementPoint(npc) {
    const point = fieldNpcAvoidancePoint(npc);
    const scaleFactor = Math.sqrt(Number(npc?.scale) > 0 ? Number(npc.scale) : 1);
    return {
        ...point,
        radiusX: FIELD_NPC_PLACEMENT_AVOID_X * scaleFactor,
        radiusY: FIELD_NPC_PLACEMENT_AVOID_Y * scaleFactor,
    };
}

function fieldNpcAvoidancePoint(npc) {
    const scale = Number(npc?.scale) > 0 ? Number(npc.scale) : 1;
    const scaleFactor = Math.sqrt(scale);
    return {
        x: clamp01((Number(npc?.x) || 0) / 100),
        y: clamp01((Number(npc?.y) || 0) / 100),
        radiusX: FIELD_NPC_AVOID_X * scaleFactor,
        radiusY: FIELD_NPC_AVOID_Y * scaleFactor,
    };
}

// 有对话/小游戏的 NPC 视为障碍点，供宠物走位 / 便便掉落点绕开（哑巴 NPC 已在存档时被过滤掉，见 config.js normalizeFieldNpcs）。
function fieldNpcAvoidancePoints(fieldId = state.currentField) {
    return positionedFieldNpcs(fieldId)
        .filter(npc => (npc?.dialog?.length > 0) || npc?.minigame)
        .map(fieldNpcAvoidancePoint);
}

// 裁剪局部区域的 NPC 图标：把 .field-npc-img 的宽高改成裁剪区域的真实宽高比，避免拉伸变形。
function fixFieldNpcIconAspects(scene) {
    scene?.querySelectorAll?.('.field-npc-img[data-npc-icon]').forEach(el => {
        fitIconCropAspectRatio(el, el.dataset.npcIcon, el.parentElement?.clientWidth || 36);
    });
}

function fieldNpcHtml(npc) {
    const isImg = isImageIconValue(npc?.icon);
    const inner = isImg
        ? `<span class="field-npc-img" data-npc-icon="${escapeHtml(npc.icon)}" style="${escapeHtml(iconBackgroundStyleAttr(npc.icon))}"></span>`
        : escapeHtml(npc?.icon || '🧑');
    const scale = Number(npc?.scale) > 0 ? Number(npc.scale) : 1;
    const flipX = npc?.flip ? -1 : 1;
    // 图标用 transform:scale 放大不影响布局尺寸，放大倍数越大越容易和上方名字重叠；
    // 按放大出的半高补一段 gap，让名字始终留在图标视觉边界之外。
    const gapPx = Math.round(2 + Math.max(0, scale - 1) * 18);
    // 静态阴影：纯 CSS 径向渐变，随图标一起被 .field-npc-icon 的 transform:scale 缩放，不逐帧重绘，开销可忽略。
    const shadowHtml = npc?.dropShadow ? '<span class="field-npc-shadow"></span>' : '';
    return `<button type="button" class="field-npc" data-npc-id="${escapeHtml(npc?.id || '')}" style="left:${Number(npc?.x) || 0}%;top:${Number(npc?.y) || 0}%;gap:${gapPx}px" aria-label="${escapeHtml(npc?.name || '')}"><span class="field-npc-icon" style="transform:scale(${(scale * flipX).toFixed(3)}, ${scale.toFixed(3)})">${shadowHtml}${inner}</span><span class="field-npc-name">${escapeHtml(npc?.name || '')}</span></button>`;
}

function fieldMapHtml(fieldId) {
    const typeId = resolveTerrainFieldTypeId(fieldId);
    const theme = FIELD_THEMES[typeId] || FIELD_THEMES.land;
    const custom = isVisitingMode() ? visitingFieldSceneConfig(fieldId) : currentFieldSceneConfig(fieldId);
    const customBg = custom.background || {};
    const weather = getActivePlanetWeather();
    const weatherClass = weather ? ` weather-${weather.id}` : '';
    const weatherOverlay = weather ? planetWeatherOverlayHtml(weather) : '';
    // 背景统一为静态场景图 / 纯色；无配置时回退主题天空渐变 + 默认粒子。
    const scene = {
        id: customBg.presetId || `field-${fieldId}-custom`,
        title: customBg.title || '',
        background: customBg,
        particles: Array.isArray(custom.particles) && custom.particles.length
            ? custom.particles
            : (customBg.imageUrl || customBg.color ? [] : fieldParticleEffects(typeId)),
    };
    const bgIcon = customBg.imageUrl ? parseIconSource(customBg.imageUrl) : null;
    const cropAttrs = bgIcon?.rect
        ? ` data-crop-x="${bgIcon.rect.x}" data-crop-y="${bgIcon.rect.y}" data-crop-w="${bgIcon.rect.w}" data-crop-h="${bgIcon.rect.h}"`
        : '';
    const imageHtml = bgIcon?.src
        ? `<img class="field-custom-background-image" src="${escapeHtml(bgIcon.src)}" alt="" draggable="false"${cropAttrs}>`
        : '';
    return `
        <div class="field-bg ${theme.className} field-bg-custom${weatherClass}" style="background:${escapeHtml(customBg.color || theme.sky)}">
            ${imageHtml}
            <div class="field-custom-background-particles field-viewport-particles">${renderSceneParticles(scene, { density: 'field' })}</div>
            ${weatherOverlay}
        </div>
    `;
}

function fieldParticleEffects(fieldId) {
    if (fieldId === 'water') return ['bubbles', 'sparkle'];
    if (fieldId === 'sky') return ['mist', 'sparkle'];
    if (fieldId === 'fire') return ['embers', 'sparkle'];
    if (fieldId === 'ice') return ['snow', 'sparkle'];
    if (fieldId === 'life') return ['petals', 'sparkle'];
    if (fieldId === 'dark') return ['sparkle', 'embers'];
    if (fieldId === 'thunder') return ['sparkle', 'mist'];
    return ['petals', 'sparkle'];
}

function planetWeatherOverlayHtml(weather) {
    if (weather.id === 'rain') {
        return `<div class="field-weather-layer field-weather-rain" aria-hidden="true">${renderParticleCanvasHtml(['rain'], { className: 'field-weather-particles', density: 'weather', seed: 'weather-rain' })}</div>`;
    }
    if (weather.id === 'sunny') {
        return '<div class="field-weather-layer field-weather-sun" aria-hidden="true"></div>';
    }
    if (weather.id === 'breeze') {
        return '<div class="field-weather-layer field-weather-breeze" aria-hidden="true"><i></i><i></i><i></i></div>';
    }
    return '';
}

// 检查候选位置是否与其它房屋重叠（足够近时视为不可用）
function isFieldPositionFree(x, y, fieldLayout, excludeIdx = -1) {
    if (!Array.isArray(fieldLayout)) return true;
    for (let i = 0; i < fieldLayout.length; i++) {
        if (i === excludeIdx) continue;
        const other = fieldLayout[i];
        const otherDef = ITEM_BY_ID[other?.itemId];
        if (!isHouseItem(otherDef)) continue;
        const dx = x - clamp01(other.x);
        const dy = y - clamp01(other.y);
        if (dx * dx + dy * dy < 0.012) return false; // ~0.11 单位半径
    }
    return true;
}

function petFieldPosition(pet, fieldId, index, activeFieldPosition = null) {
    const petId = typeof pet === 'string' ? pet : pet?.id;
    if (pet?.id && pet.id === state.currentPetId && state.activePetFieldPose?.fieldId === fieldId) {
        const pose = state.activePetFieldPose;
        return {
            x: pose.x,
            y: pose.y,
            delay: pose.delay ?? -1,
            dur: pose.dur ?? 10,
            dx: pose.dx ?? 0,
            dy: pose.dy ?? 0,
        };
    }
    if (petId && petId !== state.currentPetId) {
        const home = getGeneratedPetLocation(pet);
        if (home.kind === 'field' && home.id === fieldId) {
            if (home.nearActive && activeFieldPosition) {
                anchorNearActiveGeneratedPet(home, petId, fieldId, activeFieldPosition);
            }
            return {
                x: home.x,
                y: home.y,
                delay: home.delay,
                dur: home.dur,
                dx: home.dx,
                dy: home.dy,
            };
        }
    }
    // 默认：聚集在该场景"主屋"前；若位置被占，依次尝试右侧、左侧。
    const fieldLayout = activeFieldLayout(fieldId);
    const rallyHouse = findLargestHouseInLayout(fieldLayout);
    if (rallyHouse && getPetLocationType(pet) !== 'released') {
        const rng = makeRng(`${getUserSeedBase()}::${fieldId}::pet-rally::${pet?.id || index}`);
        const hx = clamp01(rallyHouse.placed.x);
        const hy = clamp01(rallyHouse.placed.y);
        // 房屋大致占地半径（按 fieldSize 估算，单位：归一化场景坐标）
        const hScale = Number(rallyHouse.placed?.fieldSize) || rallyHouse.def?.fieldSize || 1;
        const houseHalfH = 0.08 * hScale; // 纵向半高
        const houseHalfW = 0.08 * hScale; // 横向半宽
        // 候选顺序：前（下方）→ 右 → 左；前方加入随机偏移，且偏出房屋投影外
        const frontGap   = houseHalfH + 0.10 + rng() * 0.06;  // 0.10~0.16 + 半高
        const frontJitterX = (rng() - 0.5) * 0.10;            // ±0.05 横向抖动
        const sideGap    = houseHalfW + 0.08 + rng() * 0.04;
        const sideY      = hy + houseHalfH * 0.4 + (rng() - 0.5) * 0.04;
        const candidates = [
            { x: clamp01(hx + frontJitterX),   y: Math.min(FIELD_PET_MAX_Y, hy + frontGap) },     // 门前下方
            { x: Math.min(0.94, hx + sideGap), y: Math.min(FIELD_PET_MAX_Y, sideY) },             // 右侧
            { x: Math.max(0.06, hx - sideGap), y: Math.min(FIELD_PET_MAX_Y, sideY) },             // 左侧
        ];
        const chosen = candidates.find(c => isFieldPositionFree(c.x, c.y, fieldLayout, rallyHouse.idx)) || candidates[0];
        return {
            x: chosen.x,
            y: chosen.y,
            delay: -(rng() * 6).toFixed(2),
            dur: (10 + rng() * 6).toFixed(2),
            dx: (-14 + rng() * 28).toFixed(1),
            dy: (-8 + rng() * 16).toFixed(1),
        };
    }
    const rng = makeRng(`${getUserSeedBase()}::${fieldId}::pet::${pet?.id || index}`);
    return {
        x: 0.18 + rng() * 0.64,
        y: Math.min(FIELD_PET_MAX_Y, 0.38 + rng() * 0.38),
        delay: -(rng() * 8).toFixed(2),
        dur: (9 + rng() * 7).toFixed(2),
        dx: (-26 + rng() * 52).toFixed(1),
        dy: (-16 + rng() * 32).toFixed(1),
    };
}

function anchorNearActiveGeneratedPet(home, petId, fieldId, activeFieldPosition) {
    if (!home || home.nearActiveAnchored) return;
    const rng = makeRng(`${getUserSeedBase()}::${fieldId}::near-active-pet::${petId}`);
    const slot = Math.max(0, (state.petOrder || []).filter(id => id && id !== state.currentPetId).indexOf(petId));
    const baseAngle = rng() * Math.PI * 2;
    const angle = slot === 0 ? baseAngle : baseAngle + Math.PI * (0.65 + rng() * 0.7);
    const radius = NEAR_ACTIVE_PET_MIN_RADIUS + rng() * NEAR_ACTIVE_PET_RANDOM_RADIUS;
    const xOffset = Math.cos(angle) * radius;
    const yOffset = Math.sin(angle) * radius * NEAR_ACTIVE_PET_Y_SCALE;
    home.x = clampRange(activeFieldPosition.x + xOffset, 0.08, 0.92);
    home.y = clampRange(activeFieldPosition.y + yOffset, 0.36, FIELD_PET_MAX_Y);
    home.nearActiveAnchored = true;
}

function fieldPetsRepelledPositions(entries) {
    const fieldId = entries[0]?.fieldId;
    // NPC 是固定障碍点：预先放进 placed，宠物会被推开，但 NPC 自己永远不会被推动。
    const placed = fieldId ? fieldNpcAvoidancePoints(fieldId) : [];
    return entries.map((entry, index) => repelFieldPetPosition(entry, placed, index));
}

function repelFieldPetPosition(entry, placed, index = 0) {
    const pos = { ...entry.pos };
    const rng = makeRng(`${getUserSeedBase()}::${entry.fieldId}::pet-repel::${entry.id || index}`);
    for (let step = 0; step < 10; step++) {
        let moved = false;
        for (const other of placed) {
            const minX = other.radiusX || FIELD_PET_REPEL_MIN_X;
            const minY = other.radiusY || FIELD_PET_REPEL_MIN_Y;
            const dx = pos.x - other.x;
            const dy = pos.y - other.y;
            const nx = dx / minX;
            const ny = dy / minY;
            const distSq = nx * nx + ny * ny;
            if (distSq >= 1) continue;
            const dist = Math.sqrt(distSq) || 0.001;
            const angle = Math.atan2(dy || (rng() - 0.5), dx || (rng() - 0.5));
            const strength = (1 - dist) * 0.55 + FIELD_PET_REPEL_MIN_GAP;
            pos.x = clampRange(pos.x + Math.cos(angle) * minX * strength, 0.08, 0.92);
            pos.y = clampRange(pos.y + Math.sin(angle) * minY * strength, 0.36, FIELD_PET_MAX_Y);
            moved = true;
        }
        if (!moved) break;
    }
    placed.push(pos);
    return pos;
}

function fieldPetsFindRepelledPositions(entries, currentPetId) {
    const fieldId = entries[0]?.fieldId;
    const fixedEntries = entries.filter(entry => entry.id !== currentPetId);
    const fixedPositions = fieldPetsRepelledPositions(fixedEntries);
    const fixedById = new Map(fixedEntries.map((entry, index) => [entry.id, fixedPositions[index]]));
    const occupied = [...(fieldId ? fieldNpcAvoidancePoints(fieldId) : []), ...fixedPositions.map(pos => ({ x: pos.x, y: pos.y }))];
    const activeIndex = entries.findIndex(entry => entry.id === currentPetId);
    const activePos = activeIndex >= 0
        ? repelFieldPetPosition(entries[activeIndex], occupied, activeIndex)
        : null;
    return entries.map(entry => entry.id === currentPetId ? activePos : fixedById.get(entry.id));
}

function selectVisitFieldPlanetGuestPets(planetPets, visit, fieldId) {
    if (!Array.isArray(planetPets) || planetPets.length <= VISIT_FIELD_MAX_PLANET_GUEST_PETS) return planetPets || [];
    const seedBase = `${visit?.officialPlanetId || visit?.planetName || 'visit'}::${visit?.startedAt || Date.now()}::${fieldId}::planet-field-guests`;
    return planetPets
        .map((pet, index) => ({ pet, index, rank: hashString(`${seedBase}::${pet?.id || pet?.famousPetId || index}`) }))
        .sort((a, b) => a.rank - b.rank)
        .slice(0, VISIT_FIELD_MAX_PLANET_GUEST_PETS)
        .sort((a, b) => a.index - b.index)
        .map(item => item.pet);
}

function gaussianRandom(rng) {
    const u1 = Math.max(0.000001, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function visitPlanetGuestFieldPosition(entry, fieldId, visit, index) {
    const seed = `${visit?.officialPlanetId || visit?.planetName || 'visit'}::${visit?.startedAt || Date.now()}::${fieldId}::planet-guest-pos::${entry?.id || index}`;
    const rng = makeRng(seed);
    const x = clampRange(0.5 + gaussianRandom(rng) * 0.22, 0.08, 0.92);
    const y = clampRange(0.75 + gaussianRandom(rng) * 0.105, 0.50, 0.90);
    return {
        x,
        y,
        delay: -(rng() * 5).toFixed(2),
        dur: (9 + rng() * 5).toFixed(2),
        dx: (-18 + rng() * 36).toFixed(1),
        dy: (-10 + rng() * 20).toFixed(1),
    };
}

function fieldPetsHtml(currentPet, fieldId) {
    if (isVisitingMode()) return visitingFieldPetsHtml(currentPet, fieldId);
    const petIds = getFieldPetIds(currentPet, fieldId);
    const orderedIds = petIds.includes(currentPet?.id)
        ? [currentPet.id, ...petIds.filter(id => id !== currentPet.id)]
        : petIds;
    const visibleIds = state.isDecorMode && currentPet?.id
        ? orderedIds.filter(id => id === currentPet.id)
        : orderedIds;
    // 按需获取每只伴随宠物：未加载时 getPet 会在后台读取 pet.json 并在就绪后触发重渲染。
    const renderIds = visibleIds;
    const activeFieldPosition = currentPet?.id ? petFieldPosition(currentPet, fieldId, 0) : null;
    const entries = renderIds.map((id, index) => ({
        id,
        fieldId,
        pos: id === currentPet?.id ? activeFieldPosition : petFieldPosition(id, fieldId, index, activeFieldPosition),
    }));
    const isFindingInField = !!currentPet?.id
        && state.activePetFieldPose?.fieldId === fieldId
        && state.activePetFieldPose?.targetPetId;
    const repelledPositions = isFindingInField
        ? fieldPetsFindRepelledPositions(entries, currentPet.id)
        : fieldPetsRepelledPositions(entries);
    const localHtml = renderIds.map((id, index) => {
        // pet.json 是唯一来源：未加载时返回 null，petArtHtml 先渲染蛋占位，加载完成后自动替换。
        const p = id === currentPet?.id ? currentPet : getPet(id);
        const pos = { ...entries[index].pos, ...repelledPositions[index] };
        const isCurrent = id === currentPet?.id;
        const size = isCurrent ? 96 : 78;
        const zIndex = fieldPetZIndex(pos.y, isCurrent);
        return `
            <div class="pet-sprite field-pet ${isCurrent ? 'field-pet-current' : 'field-pet-friend'}" data-field-pet="${escapeHtml(id)}"
                style="left:${pct(pos.x)};top:${pct(pos.y)};z-index:${zIndex};--field-wander-delay:${pos.delay}s;--field-wander-dur:${pos.dur}s;--field-wander-x:${pos.dx}px;--field-wander-y:${pos.dy}px">
                <div class="field-pet-wander" style="width:${size}px;height:${size}px">${petArtHtml(p, { alt: displayPetName(p), motion: 'walk' })}</div>
            </div>
        `;
    }).join('');
    return localHtml + invitedFieldPetHtml(fieldId, renderIds.length);
}

function visitingFieldPetsHtml(currentPet, fieldId) {
    const visit = state.visitingMode || {};
    const friendPet = visit.friendPet;
    const seen = new Set();
    const addEntry = (entries, pet, options = {}) => {
        const id = options.id || pet?.id;
        if (!pet || !id || seen.has(id)) return;
        seen.add(id);
        entries.push({ pet, id, ...options });
    };
    const entries = [];
    addEntry(entries, currentPet, { id: currentPet?.id || 'current', current: true, index: 0 });
    (visit.crewPets || [])
        .map(pet => typeof pet === 'string' ? state.pets?.[pet] : pet)
        .forEach((pet, index) => addEntry(entries, pet, { current: false, index: index + 2 }));
    (visit.crewIds || [])
        .map(id => state.pets?.[id])
        .forEach((pet, index) => addEntry(entries, pet, { current: false, index: index + 4 }));
    addEntry(entries, friendPet, { id: friendPet?.id || 'friend', host: true, current: false, index: 7 });
    const planetGuestPets = selectVisitFieldPlanetGuestPets(
        (visit.planetPets || []).filter(pet => pet?.id && !seen.has(pet.id)),
        visit,
        fieldId
    );
    planetGuestPets
        .forEach((pet, index) => addEntry(entries, pet, { current: false, index: index + 9, planetGuest: true }));
    const activePose = state.activePetFieldPose?.fieldId === fieldId ? state.activePetFieldPose : null;
    const hostBase = activePose && friendPet
        ? { x: activePose.targetX ?? 0.52, y: activePose.targetY ?? 0.62, delay: -0.4, dur: 10, dx: 8, dy: 4 }
        : (friendPet ? petFieldPosition({ ...friendPet, id: friendPet.id || 'friend' }, fieldId, 7) : null);
    const clusterOffsets = [
        { x: 0, y: 0 },
        { x: 0.105, y: 0.035 },
        { x: -0.095, y: 0.045 },
        { x: 0.025, y: 0.13 },
        { x: -0.145, y: 0.12 },
    ];
    const positions = entries.map((entry, index) => {
        if (entry.host && hostBase) return hostBase;
        if (entry.current) return petFieldPosition({ ...entry.pet, id: entry.id }, fieldId, entry.index);
        if (entry.planetGuest) return visitPlanetGuestFieldPosition(entry, fieldId, visit, index);
        if (hostBase) {
            const offset = clusterOffsets[index % clusterOffsets.length];
            return {
                x: Math.max(0.08, Math.min(0.92, hostBase.x + offset.x)),
                y: Math.max(0.36, Math.min(0.90, hostBase.y + offset.y)),
                delay: -0.35 * index,
                dur: 9 + index,
                dx: index % 2 ? -10 : 10,
                dy: index % 2 ? 5 : -5,
            };
        }
        return petFieldPosition({ ...entry.pet, id: entry.id }, fieldId, entry.index);
    });
    const repelledPositions = fieldPetsRepelledPositions(entries.map((entry, index) => ({ id: entry.id, fieldId, pos: positions[index] })));
    return entries.map((entry, index) => {
        const pos = { ...positions[index], ...repelledPositions[index] };
        const size = entry.current ? 96 : 82;
        const zIndex = fieldPetZIndex(pos.y, entry.current);
        return `
            <div class="pet-sprite field-pet ${entry.current ? 'field-pet-current' : `field-pet-friend ${entry.host ? 'field-pet-visit-host' : entry.planetGuest ? 'field-pet-visit-planet' : 'field-pet-visit-crew'}`}" data-field-pet="${escapeHtml(entry.id)}" ${entry.host ? 'data-visit-host-pet="1"' : ''}
                style="left:${pct(pos.x)};top:${pct(pos.y)};z-index:${zIndex};--field-wander-delay:${pos.delay}s;--field-wander-dur:${pos.dur}s;--field-wander-x:${pos.dx}px;--field-wander-y:${pos.dy}px">
                <div class="field-pet-wander" style="width:${size}px;height:${size}px">${petArtHtml(entry.pet, { alt: displayPetName(entry.pet), motion: 'walk' })}</div>
            </div>
        `;
    }).join('');
}

function getFieldPetIds(currentPet, fieldId) {
    return (state.petOrder || []).filter((id) => {
        if (!id) return false;
        if (id === currentPet?.id) return canPetAppearInField(currentPet, fieldId);
        if (isNearActiveGeneratedPet(id)) {
            const home = getGeneratedPetLocation(state.pets[id] || id);
            return home.kind === 'field' && home.id === fieldId;
        }
        return canPetAppearInField(state.pets[id] || id, fieldId);
    });
}

function invitedFieldPetHtml(fieldId, index = 0) {
    const record = state.activeInvitedPet;
    const pet = record?.pet;
    if (!pet || state.isDecorMode) return '';
    const pos = petFieldPosition({ ...pet, id: record.id || pet.id }, fieldId, index + 7);
    const size = 78;
    const zIndex = fieldPetZIndex(pos.y, false);
    return `
        <div class="pet-sprite field-pet field-pet-friend field-pet-invite" data-field-pet="${escapeHtml(pet.id || '')}" data-invited-field-pet="1"
            style="left:${pct(pos.x)};top:${pct(pos.y)};z-index:${zIndex};--field-wander-delay:${pos.delay}s;--field-wander-dur:${pos.dur}s;--field-wander-x:${pos.dx}px;--field-wander-y:${pos.dy}px">
            <div class="field-pet-wander" style="width:${size}px;height:${size}px">${invitedPetArtHtml(pet)}</div>
        </div>
    `;
}

function invitedPetArtHtml(pet) {
    const cell = getPetSpriteCell({ ...pet, anim: pet?.anim || 'idle' });
    if (!pet?.imageSheetUrl || !cell) {
        return `<div class="mh-pet-art mh-pet-art-egg" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${buildEggSvg(pet)}</div>`;
    }
    const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    return `<div class="mh-pet-art mh-pet-art-sprite mh-pet-walk" style="width:100%;height:100%;display:block;background-image:url('${escapeHtml(pet.imageSheetUrl)}');background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;background-color:transparent;image-rendering:pixelated"></div>`;
}

function fieldFuelPoopContentsHtml(poopCount) {
    const count = Math.max(1, Math.min(10, Number(poopCount) || 1));
    const positions = [
        [48, 84], [72, 90], [58, 108], [84, 116], [42, 128],
        [68, 138], [92, 146], [54, 154], [80, 160], [34, 104],
    ];
    return positions.slice(0, count).map((position, index) => {
        const [x, y] = position;
        const delay = (index * 0.13).toFixed(2);
        const rotation = index % 2 ? 8 : -8;
        return `<text class="field-fuel-poop-piece" x="${x}" y="${y}" text-anchor="middle" style="--field-fuel-poop-delay:${delay}s;--field-fuel-poop-rotate:${rotation}deg">💩</text>`;
    }).join('');
}

function fieldFuelRoomAnimationHtml(fuelGain, { poopCount = fuelGain } = {}) {
    return `
        <div class="field-fuel-room-animation" aria-hidden="true">
            <svg viewBox="0 0 128 200" focusable="false">
                <defs>
                    <linearGradient id="mhFuelGlass" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0" stop-color="#ecfeff" stop-opacity="0.88"></stop>
                        <stop offset="0.5" stop-color="#7dd3fc" stop-opacity="0.28"></stop>
                        <stop offset="1" stop-color="#0e7490" stop-opacity="0.34"></stop>
                    </linearGradient>
                    <linearGradient id="mhFuelLiquid" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0" stop-color="#fef08a"></stop>
                        <stop offset="0.48" stop-color="#22c55e"></stop>
                        <stop offset="1" stop-color="#06b6d4"></stop>
                    </linearGradient>
                    <filter id="mhFuelSoftGlow" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="2.2" result="blur"></feGaussianBlur>
                        <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
                    </filter>
                    <clipPath id="mhFuelCylinderClip">
                        <path d="M22 56 C22 36 106 36 106 56 L106 154 C106 176 22 176 22 154Z"></path>
                    </clipPath>
                </defs>
                <ellipse cx="64" cy="180" rx="46" ry="10" fill="rgba(6,18,44,0.18)"></ellipse>
                <g class="field-fuel-fan" aria-hidden="true">
                    <path class="field-fuel-fan-blade" d="M64 36 C51 32 40 23 43 15 C52 13 60 23 64 36Z" fill="#67e8f9"></path>
                    <path class="field-fuel-fan-blade" d="M64 36 C75 29 89 27 94 35 C89 43 75 41 64 36Z" fill="#bae6fd"></path>
                    <path class="field-fuel-fan-blade" d="M64 36 C66 50 62 62 53 63 C48 55 55 43 64 36Z" fill="#86efac"></path>
                    <circle cx="64" cy="36" r="7" fill="#0f2747" stroke="#ecfeff" stroke-width="2.4"></circle>
                    <circle cx="64" cy="36" r="2.7" fill="#fef08a"></circle>
                </g>
                <path d="M22 56 C22 36 106 36 106 56 L106 154 C106 176 22 176 22 154Z" fill="url(#mhFuelGlass)" stroke="#0e7490" stroke-width="4"></path>
                <ellipse cx="64" cy="56" rx="42" ry="15" fill="hsla(186, 100%, 96%, 0.78)" stroke="#67e8f9" stroke-width="3"></ellipse>
                <path d="M24 58 C32 70 96 70 104 58" fill="none" stroke="rgba(255,255,255,0.58)" stroke-width="3" stroke-linecap="round"></path>
                <g clip-path="url(#mhFuelCylinderClip)">
                    <rect class="field-fuel-tank-fill" x="28" y="118" width="72" height="45" rx="18" fill="url(#mhFuelLiquid)"></rect>
                    <g class="field-fuel-poop-stack">
                        ${fieldFuelPoopContentsHtml(poopCount)}
                    </g>
                    <ellipse cx="64" cy="118" rx="36" ry="11" fill="#bbf7d0" opacity="0.78"></ellipse>
                    <path d="M34 62 C44 148 44 148 34 166" fill="none" stroke="rgba(255,255,255,0.54)" stroke-width="6" stroke-linecap="round"></path>
                </g>
                <path class="field-fuel-energy" d="M67 74 L48 116 H65 L55 154 L86 102 H68 L78 74Z" fill="#fde047" stroke="#facc15" stroke-width="2" filter="url(#mhFuelSoftGlow)"></path>
                <text class="field-fuel-gain" x="64" y="17" text-anchor="middle">+${Math.max(0, fuelGain | 0)} ⛽</text>
                <circle class="field-fuel-spark field-fuel-spark-a" cx="33" cy="88" r="3" fill="#fef08a"></circle>
                <circle class="field-fuel-spark field-fuel-spark-b" cx="102" cy="108" r="2.4" fill="#67e8f9"></circle>
                <circle class="field-fuel-spark field-fuel-spark-c" cx="82" cy="166" r="2.8" fill="#86efac"></circle>
            </svg>
        </div>
    `;
}

function flyFuelNumberToHud(fuelGain, onArrive) {
    const fuel = $('mhBiofuel');
    const fuelRect = fuel?.getBoundingClientRect?.();
    const machinePoint = getFieldFuelMachinePoint();
    if (!fuelRect || !machinePoint) {
        onArrive?.();
        return;
    }

    const startX = machinePoint.x;
    const startY = machinePoint.y - 24;
    const endX = fuelRect.left + fuelRect.width * 0.5;
    const endY = fuelRect.top + fuelRect.height * 0.5;
    const fly = document.createElement('div');
    fly.className = 'field-fuel-fly-number';
    fly.textContent = `+${Math.max(0, fuelGain | 0)}`;
    fly.style.left = startX + 'px';
    fly.style.top = startY + 'px';
    const effectScale = getFieldEffectScale();
    fly.style.setProperty('--field-fly-font-size', (18 * effectScale).toFixed(1) + 'px');
    const dx = endX - startX;
    const dy = endY - startY;
    fly.style.setProperty('--fuel-fly-dx', dx.toFixed(1) + 'px');
    fly.style.setProperty('--fuel-fly-dy', dy.toFixed(1) + 'px');
    fly.style.setProperty('--fuel-fly-mid-x', (dx * 0.46).toFixed(1) + 'px');
    fly.style.setProperty('--fuel-fly-mid-y', (dy * 0.24).toFixed(1) + 'px');
    document.body.appendChild(fly);

    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        fly.remove();
        onArrive?.();
        fuel.classList.add('field-fuel-hud-pop');
        setTimeout(() => fuel.classList.remove('field-fuel-hud-pop'), 520);
    };
    fly.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 1500);
}

function flyFieldCoinNumberToHud(amount, onArrive, sourceEl = null) {
    const target = $('mhCoins');
    const targetRect = target?.getBoundingClientRect?.();
    const machinePoint = getFieldFuelMachinePoint();
    const sourceRect = sourceEl?.getBoundingClientRect?.();
    if (!targetRect) {
        onArrive?.();
        return;
    }
    const startX = machinePoint?.x ?? (sourceRect ? sourceRect.left + sourceRect.width * 0.5 : targetRect.left + targetRect.width * 0.5);
    const startY = machinePoint?.y ? machinePoint.y - 24 : (sourceRect ? sourceRect.top + sourceRect.height * 0.5 : targetRect.top + targetRect.height * 0.5);
    const endX = targetRect.left + targetRect.width * 0.5;
    const endY = targetRect.top + targetRect.height * 0.5;
    const fly = document.createElement('div');
    fly.className = 'field-coin-fly-number';
    fly.innerHTML = `${coinIconSvg('field-coin-fly-icon')}<span>+${Math.max(0, amount | 0)}</span>`;
    fly.style.left = startX + 'px';
    fly.style.top = startY + 'px';
    const dx = endX - startX;
    const dy = endY - startY;
    fly.style.setProperty('--field-coin-fly-dx', dx.toFixed(1) + 'px');
    fly.style.setProperty('--field-coin-fly-dy', dy.toFixed(1) + 'px');
    fly.style.setProperty('--field-coin-fly-mid-x', (dx * 0.44).toFixed(1) + 'px');
    fly.style.setProperty('--field-coin-fly-mid-y', (dy * 0.24 - 24).toFixed(1) + 'px');
    document.body.appendChild(fly);

    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        fly.remove();
        onArrive?.();
        target.classList.add('field-coin-hud-pop');
        setTimeout(() => target.classList.remove('field-coin-hud-pop'), 520);
    };
    fly.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 1500);
}

function playPoopGlitchWind({ hold = false } = {}) {
    const stage = $('mhStage');
    if (!stage) return () => {};
    stage.querySelectorAll('.field-poop-glitch-wind').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = `field-poop-glitch-wind${hold ? ' is-holding' : ''}`;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg" focusable="false">
            <g class="field-poop-wind-shadow" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 28 C18 58 46 82 79 83 C104 84 109 70 89 62 C73 56 66 43 76 34 C85 26 99 34 103 48" />
                <path d="M4 72 C28 100 65 116 106 114" />
                <path d="M12 118 C47 136 87 138 126 128" />
            </g>
            <g class="field-poop-wind-main" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 28 C18 58 46 82 79 83 C104 84 109 70 89 62 C73 56 66 43 76 34 C85 26 99 34 103 48" />
                <path d="M4 72 C28 100 65 116 106 114" />
                <path d="M12 118 C47 136 87 138 126 128" />
            </g>
            <g class="field-poop-wind-glitch" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 31 C20 58 48 80 78 81 C102 82 107 70 89 63 C73 57 67 44 77 35 C86 27 99 35 102 48" />
                <path d="M6 75 C29 101 66 114 105 112" />
                <path d="M14 120 C49 134 87 136 125 126" />
            </g>
        </svg>
    `;
    stage.appendChild(overlay);
    let done = false;
    const finish = () => {
        if (done || !overlay.isConnected) return;
        done = true;
        overlay.classList.remove('is-holding');
        overlay.classList.add('is-ending');
        setTimeout(() => overlay.remove(), 360);
    };
    if (!hold) setTimeout(finish, POOP_WIND_ANIMATION_MS + 160);
    return finish;
}

function playFieldFuelRoomAnimation(fuelGain, onFuelArrive, { deferProcessing = false, poopCount = fuelGain } = {}) {
    const stage = $('mhStage');
    if (!stage) {
        if (deferProcessing) return () => onFuelArrive?.();
        onFuelArrive?.();
        return () => {};
    }
    const old = stage.querySelector('.field-fuel-room-animation');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = fieldFuelRoomAnimationHtml(fuelGain, { poopCount });
    const overlay = wrap.firstElementChild;
    if (deferProcessing) overlay.classList.add('is-waiting');
    stage.appendChild(overlay);
    let started = false;
    const startProcessing = () => {
        if (started || !overlay.isConnected) return;
        started = true;
        overlay.classList.remove('is-waiting');
        soundManager.playPoopCollectorSuck(fuelGain);
        setTimeout(() => flyFuelNumberToHud(fuelGain, onFuelArrive), FUEL_MACHINE_WORK_DELAY_MS);
        setTimeout(() => overlay?.remove(), FUEL_MACHINE_ANIMATION_MS);
    };
    if (!deferProcessing) startProcessing();
    return startProcessing;
}

function getFieldFuelMachinePoint() {
    const stage = $('mhStage');
    const machine = stage?.querySelector?.('.field-fuel-room-animation svg');
    const rect = machine?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
        return {
            x: rect.left + rect.width * FUEL_MACHINE_VIEWBOX_TARGET_X,
            y: rect.top + rect.height * FUEL_MACHINE_VIEWBOX_TARGET_Y,
        };
    }
    const stageRect = stage?.getBoundingClientRect?.();
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) return null;
    const scale = getFieldEffectScale();
    const machineWidth = Math.min(Math.max(window.innerWidth * 0.24, 92), 128) * scale;
    const machineHeight = machineWidth * (200 / 128);
    const right = stageRect.right - 10;
    const bottom = stageRect.bottom - 12;
    return {
        x: right - machineWidth + machineWidth * FUEL_MACHINE_VIEWBOX_TARGET_X,
        y: bottom - machineHeight + machineHeight * FUEL_MACHINE_VIEWBOX_TARGET_Y,
    };
}

function getPoopFlyFontSize(source, rect) {
    const computedSize = Number.parseFloat(getComputedStyle(source).fontSize) || 26;
    const layoutHeight = source.offsetHeight || computedSize;
    const visualScale = layoutHeight > 0 ? rect.height / layoutHeight : getFieldEffectScale();
    return Math.max(computedSize, computedSize * visualScale);
}

function startFieldPetMachinePull() {
    const target = getFieldFuelMachinePoint();
    const petEls = Array.from(document.querySelectorAll('.field-pet'));
    if (!target || petEls.length === 0) return () => {};
    petEls.forEach(el => {
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        const dx = target.x - centerX;
        const dy = target.y - centerY;
        const pullX = clampRange(dx * 0.1, -24, 24);
        const pullY = clampRange(dy * 0.08, -16, 16);
        const rotate = clampRange(dx * 0.045, -9, 9);
        const skew = clampRange(rotate * 0.5, -4.5, 4.5);
        el.style.setProperty('--field-pet-pull-x', pullX.toFixed(1) + 'px');
        el.style.setProperty('--field-pet-pull-y', pullY.toFixed(1) + 'px');
        el.style.setProperty('--field-pet-pull-rotate', rotate.toFixed(1) + 'deg');
        el.style.setProperty('--field-pet-pull-skew', skew.toFixed(1) + 'deg');
        el.classList.add('is-machine-pulled');
    });
    return () => {
        petEls.forEach(el => {
            el.classList.remove('is-machine-pulled');
            el.style.removeProperty('--field-pet-pull-x');
            el.style.removeProperty('--field-pet-pull-y');
            el.style.removeProperty('--field-pet-pull-rotate');
            el.style.removeProperty('--field-pet-pull-skew');
        });
    };
}

function playPoopSuckToMachine(poops, onComplete) {
    const sourceEls = Array.from(document.querySelectorAll('.field-poops .poop-btn'));
    const target = getFieldFuelMachinePoint();
    const animated = [];
    if (target) {
        (poops || []).forEach((poop, index) => {
            const source = sourceEls.find(el => el.dataset.poop === poop?.id);
            const rect = source?.getBoundingClientRect?.();
            if (!source || !rect || rect.width <= 0 || rect.height <= 0) return;
            const fly = source.cloneNode(true);
            const startX = rect.left + rect.width * 0.5;
            const startY = rect.top + rect.height * 0.5;
            const dx = target.x - startX;
            const dy = target.y - startY;
            const delay = Math.min(index * POOP_SUCK_STAGGER_MS, 1200);
            fly.className = 'field-poop-suck-fly';
            fly.disabled = true;
            fly.style.left = startX + 'px';
            fly.style.top = startY + 'px';
            fly.style.fontSize = getPoopFlyFontSize(source, rect).toFixed(1) + 'px';
            fly.style.setProperty('--poop-suck-dx', dx.toFixed(1) + 'px');
            fly.style.setProperty('--poop-suck-dy', dy.toFixed(1) + 'px');
            fly.style.setProperty('--poop-suck-arc-x', (dx * 0.28).toFixed(1) + 'px');
            fly.style.setProperty('--poop-suck-arc-y', (dy * 0.2 - 18).toFixed(1) + 'px');
            fly.style.setProperty('--poop-suck-near-x', (dx * 0.82).toFixed(1) + 'px');
            fly.style.setProperty('--poop-suck-near-y', (dy * 0.78 - 6).toFixed(1) + 'px');
            fly.style.animationDelay = delay + 'ms';
            document.body.appendChild(fly);
            source.classList.add('field-poop-suck-source');
            setTimeout(() => source.remove(), Math.max(90, delay + 80));
            setTimeout(() => fly.remove(), delay + POOP_SUCK_ANIMATION_MS + 120);
            animated.push(delay);
        });
    }

    const animatedIds = new Set((poops || []).map(p => p?.id));
    sourceEls.forEach(el => {
        if (animatedIds.has(el.dataset.poop) && !el.classList.contains('field-poop-suck-source')) el.remove();
    });
    const finishDelay = animated.length ? Math.max(...animated) + POOP_SUCK_ANIMATION_MS : 0;
    if (finishDelay > 0) activePoopSuckFinishAt = Math.max(activePoopSuckFinishAt, performance.now() + finishDelay);
    setTimeout(() => onComplete?.(), finishDelay);
}

function playPoopMachineSweep(poops, onComplete) {
    const bounds = getFieldPanBounds();
    const remaining = new Map((poops || []).filter(p => p?.id).map(p => [p.id, p]));
    if (!bounds || bounds.maxPan <= 1 || remaining.size === 0) {
        playPoopSuckToMachine(poops, onComplete);
        return;
    }

    const sweepId = ++activePoopSweepId;
    activePoopSuckFinishAt = 0;
    const { stage, scene, stageWidth, sceneWidth, maxPan } = bounds;
    const panKey = currentFieldPanKey();
    const returnPan = clampRange(fieldPanById[panKey] ?? fieldPan, -maxPan, 0);
    const duration = clampRange(
        POOP_MACHINE_SWEEP_MIN_MS + (maxPan / Math.max(1, stageWidth)) * POOP_MACHINE_SWEEP_SCREEN_MS,
        POOP_MACHINE_SWEEP_MIN_MS,
        POOP_MACHINE_SWEEP_MAX_MS
    );
    const triggerVisiblePoops = () => {
        const left = Math.max(0, -fieldPan / sceneWidth - 0.03);
        const right = Math.min(1, (-fieldPan + stageWidth) / sceneWidth + 0.03);
        const visible = [];
        remaining.forEach((poop, id) => {
            const x = clamp01(poop.x);
            if (x >= left && x <= right) {
                remaining.delete(id);
                visible.push(poop);
            }
        });
        if (visible.length) playPoopSuckToMachine(visible);
    };
    const finish = () => {
        if (sweepId !== activePoopSweepId) return;
        if (remaining.size) playPoopSuckToMachine(Array.from(remaining.values()));
        animateFieldPanTo(returnPan, POOP_MACHINE_SWEEP_RETURN_MS, () => {
            if (sweepId !== activePoopSweepId) return;
            scene.classList.remove('is-machine-sweeping');
            stage.__mhFieldPannedAt = Date.now();
            const waitForLastPoop = Math.max(0, activePoopSuckFinishAt - performance.now());
            setTimeout(() => onComplete?.(), waitForLastPoop + 180);
        });
    };

    scene.classList.add('is-machine-sweeping');
    setFieldPanValue(0);
    triggerVisiblePoops();
    const start = performance.now();
    const step = (now) => {
        if (sweepId !== activePoopSweepId) return;
        const progress = clamp01((now - start) / duration);
        fieldPan = -maxPan * progress;
        fieldPanById[panKey] = fieldPan;
        updateFieldViewportParticleFrame(stage, scene);
        scene.style.transform = `translate3d(${fieldPan.toFixed(1)}px,0,0)`;
        triggerVisiblePoops();
        if (progress < 1) requestAnimationFrame(step);
        else finish();
    };
    requestAnimationFrame(step);
}

function collectPoopsInCurrentField(pet) {
    const fieldId = state.currentField;
    const poops = getPoopsInField(pet, fieldId);
    const fieldCoins = getFieldMiningCoinsInField(fieldId, pet);
    const coinGain = fieldCoins.reduce((sum, coin) => sum + (Number(coin.value) || 0), 0);
    const collectables = [...poops, ...fieldCoins];
    if (!collectables.length) return 0;
    const machineCost = CONFIG.poopMachineCostCoins | 0;
    if (poops.length > 0 && machineCost > 0 && (state.coins | 0) < machineCost) {
        showToast(t('cleanNotEnough', { cost: machineCost }), 'error', 1200);
        return 0;
    }
    if (poops.length > 0 && machineCost > 0) {
        state.coins = Math.max(0, (state.coins | 0) - machineCost);
        updateCoinsHud();
        showToast(t('cleanMachineStart', { cost: machineCost }), 'info', 1200);
    }
    if (poops.length > 0) {
        setPetPoopCount(pet, fieldId, 0);
        clearRuntimePoopLocations(pet, fieldId);
        markPetCared(pet);
        try {
            const ls = state.lifetimeStats || (state.lifetimeStats = { feeds: 0, poopsCleaned: 0, adultsRaised: 0 });
            ls.poopsCleaned = (Number(ls.poopsCleaned) || 0) + poops.length;
        } catch (_) {}
    }
    const collectedCoins = recordPlanetMiningFieldCollected(state, coinGain, Date.now(), CONFIG);
    if (collectedCoins > 0) {
        clearRuntimeFieldMiningCoins(fieldId);
        state.coins = Math.max(0, (Number(state.coins) || 0) + collectedCoins);
    }
    const fuelGain = poops.length * (CONFIG.biofuelPerPoop || 1);
    if (fuelGain > 0) state.biofuel = (state.biofuel | 0) + fuelGain;
    if (poops.length > 0) savePetDebounced(pet);
    saveUserProfileDebounced();
    if (poops.length > 0) soundManager.playPoopClean(poops.length);
    if (collectedCoins > 0) soundManager.playPointReward?.();
    const stopWind = playPoopGlitchWind({ hold: true });
    const finishSettlement = () => {
        if (fuelGain > 0) updateBiofuelHud();
        if (collectedCoins > 0) flyFieldCoinNumberToHud(collectedCoins, updateCoinsHud);
        const parts = [];
        if (poops.length > 0) parts.push(t('cleanResultPoop', { count: poops.length, fuel: fuelGain }));
        if (collectedCoins > 0) parts.push(t('cleanResultCoins', { coins: collectedCoins }));
        showToast(parts.join(t('cleanResultJoin')), 'success', 1400);
    };
    const startFuelProcessing = fuelGain > 0
        ? playFieldFuelRoomAnimation(fuelGain, finishSettlement, { deferProcessing: true, poopCount: poops.length })
        : finishSettlement;
    const stopPetPull = startFieldPetMachinePull();
    playPoopMachineSweep(collectables, () => {
        stopWind();
        stopPetPull();
        startFuelProcessing();
    });
    updateCleanPoopsButton(pet);
    return collectables.length;
}

function collectFieldMiningCoin(pet, fieldId, coinId, sourceEl) {
    const coin = getFieldMiningCoinsInField(fieldId, pet).find(item => item.id === coinId);
    if (!coin) return false;
    const collectedCoins = recordPlanetMiningFieldCollected(state, coin.value, Date.now(), CONFIG);
    if (collectedCoins <= 0) return false;
    removeRuntimeFieldMiningCoin(fieldId, coinId);
    state.coins = Math.max(0, (Number(state.coins) || 0) + collectedCoins);
    saveUserProfileDebounced();
    soundManager.playPointReward?.();
    playPoopGlitchWind();
    const stopPetPull = startFieldPetMachinePull();
    playPoopSuckToMachine([coin], () => {
        stopPetPull();
        flyFieldCoinNumberToHud(collectedCoins, () => {
            updateCoinsHud();
            showToast(`+${collectedCoins} 金币`, 'success', 900);
        }, sourceEl);
    });
    updateCleanPoopsButton(pet);
    return true;
}

function showFieldPetTalk(petEl, pet) {
    const talk = randomPetTalk(pet);
    playPetHappy(petEl, pet);
    const anchor = petEl.querySelector?.(':scope > .field-pet-wander') || petEl;
    let bubble = anchor.querySelector(':scope > .mh-pet-talk-bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'mh-pet-talk-bubble';
        anchor.appendChild(bubble);
    }
    bubble.style.setProperty('--mh-talk-flip', '1');
    bubble.textContent = talk.text;
    bubble.classList.remove('mh-pet-talk-bubble-hide', 'mh-pet-talk-bubble-pop');
    void bubble.offsetWidth;
    bubble.classList.add('mh-pet-talk-bubble-pop');
    clearTimeout(bubble.__mhFieldPetTalkTimer);
    bubble.__mhFieldPetTalkTimer = setTimeout(() => {
        bubble.classList.add('mh-pet-talk-bubble-hide');
        bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
    }, talk.state === 'sleeping' ? 2600 : 2400);
}

function showFieldPetText(petEl, text, duration = 3000) {
    if (!petEl || !text) return;
    const anchor = petEl.querySelector?.(':scope > .field-pet-wander') || petEl;
    let bubble = anchor.querySelector(':scope > .mh-pet-talk-bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'mh-pet-talk-bubble';
        anchor.appendChild(bubble);
    }
    bubble.style.setProperty('--mh-talk-flip', '1');
    bubble.textContent = text;
    bubble.classList.remove('mh-pet-talk-bubble-hide', 'mh-pet-talk-bubble-pop');
    void bubble.offsetWidth;
    bubble.classList.add('mh-pet-talk-bubble-pop');
    clearTimeout(bubble.__mhFieldPetTalkTimer);
    bubble.__mhFieldPetTalkTimer = setTimeout(() => {
        bubble.classList.add('mh-pet-talk-bubble-hide');
        bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
    }, Math.max(1000, Number(duration) || 3000));
}

function showCaretakerFieldNotice(pet) {
    if (!hasNannyCare(pet)) return;
    const now = Date.now();
    if (now - (Number(pet.hatchingCare?.lastFieldNoticeAt) || 0) < 8000) return;
    const petEl = Array.from(document.querySelectorAll('.field-pet-current')).find(el => el.dataset.fieldPet === pet.id);
    if (!petEl) return;
    const remainingHours = Math.max(1, Math.ceil(getNannyCareRemainingMs(pet, now) / 3600000));
    pet.hatchingCare.lastFieldNoticeAt = now;
    showFieldPetText(petEl, `托管中...(剩余${remainingHours}小时)`, 3000);
}

export const fieldLevel = {
    id: 'field',
    index: 1,
    wipeColor: 'linear-gradient(180deg, #b7f2ff 0%, #e2ffe2 42%, #8bd05d 100%)',
    minCamera: 0.6,    // 飞远 → 触发 zoomOut 回到 planet 视图
    maxCamera: 1.7,    // 贴近 → 触发 zoomIn 进入 pet 视图
    bestCamera: 1.0,
    minVisualScale: 0.88,
    enterFromAbove: 0.85,
    enterFromInner: 1.65,

    stageHtml(pet) {
        const fields = availableFields();
        const fld = fields.find(f => f.id === state.currentField) || fields[0] || CONFIG.fields[0];
        const visiting = isVisitingMode();
        const layout = visiting ? activeFieldLayout(fld.id) : (getLayout(pet.id, 'field_' + fld.id) || []);
        const removedPoops = visiting ? 0 : normalizePetPoops(pet);
        if (removedPoops > 0) savePetDebounced(pet);
        const poops = visiting ? [] : getPoopsInField(pet, fld.id);
        const fieldCoins = visiting ? [] : getFieldMiningCoinsInField(fld.id, pet);

        return `
            <div id="mhFieldScene" class="mh-field-scene" style="width:${metersToFieldPx(FIELD_WIDTH_METERS)}px" data-field-width-meters="${FIELD_WIDTH_METERS}" data-field-height-meters="${FIELD_HEIGHT_METERS}">
            ${fieldMapHtml(fld.id)}

            <div class="field-build-overlay" aria-hidden="true"></div>

            <div class="field-items">
                ${(() => {
                    const activeHouse = findLargestHouseInLayout(layout);
                    const activeIdx = activeHouse?.idx ?? -1;
                    return layout.map((it, idx) => {
                        const def = ITEM_BY_ID[it.itemId];
                        if (!def) return '';
                        const zIndex = ITEM_Z_INDEX_BASE + getPlacedItemZOrder(it, def);
                        const x = clamp01(it.x);
                        const y = clamp01(it.y);
                        const scale = getFieldItemScale(def, it);
                        const fontSize = getFieldItemFontSize(def, it);
                        const selectedClass = selectedFieldItem?.fieldKey === currentFieldKey() && selectedFieldItem.idx === idx ? ' selected' : '';
                        const isHouse = isHouseItem(def);
                        const isActive = isHouse && idx === activeIdx;
                        const flagHtml = isActive
                            ? `<span class="field-house-flag" aria-hidden="true" title="主屋（${activeHouse.count} 间）"><span class="field-house-flag-pole"></span><span class="field-house-flag-banner">🚩</span></span>`
                            : '';
                        const visualHtml = fieldItemVisualHtml(def, fontSize, { extraHtml: flagHtml });
                        const houseClass = isHouse ? ' is-house' : '';
                        const visualClass = visualHtml ? ' has-visual' : '';
                        const inner = visualHtml || escapeHtml(def.emoji || '');
                        return `<div class="field-item${selectedClass}${houseClass}${visualClass}" data-fidx="${idx}" data-x="${x}" data-y="${y}" data-field-size="${scale.toFixed(3)}" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%;z-index:${zIndex};font-size:${fontSize}px">${inner}</div>`;
                    }).join('');
                })()}
            </div>


            <div class="field-npcs">
                ${positionedFieldNpcs(fld.id, pet).map(fieldNpcHtml).join('')}
            </div>

            <nav class="field-area-links" aria-label="园区导航">
                ${currentFieldAreaLinks(fld.id).map(fieldAreaLinkHtml).join('')}
            </nav>

            <div class="field-poops">
                ${poops.map(p => `<button class="poop-btn" data-poop="${escapeHtml(p.id)}" style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%" title="收集 → ⛽">💩</button>`).join('')}
                ${fieldCoins.map(fieldMiningCoinHtml).join('')}
            </div>

            <div class="field-pets">
                ${fieldPetsHtml(pet, fld.id)}
            </div>
            </div>
            ${fieldMusicToggleHtml(fld.id)}
        `;
    },

    bindStage(pet, ctx) {
        const fields = availableFields();
        const fld = fields.find(f => f.id === state.currentField) || fields[0] || CONFIG.fields[0];
        const panKey = currentFieldPanKey();
        const hadRememberedFieldPan = Number.isFinite(fieldPanById[panKey]);
        const switchedField = lastBoundFieldPanKey !== panKey;
        lastBoundFieldPanKey = panKey;
        setFieldEffectScale();
        applyFieldPan();
        fixFieldNpcIconAspects($('mhFieldScene'));
        ParticleEffects.getInstance().mountAll($('mhFieldScene'));
        const fieldMusic = selectedFieldMusic(fld.id);
        if (isVisitingMode() || !fieldMusic) {
            // Scene has no background music (or we're visiting): stop any music
            // carried over from the previous scene so we don't play silence's leftover.
            soundManager.stopBgMusic?.({ fadeMs: 420 });
        } else {
            soundManager.playBgMusic(fieldMusic, { fadeMs: 420, volume: 0.3 });
        }
        const musicToggle = document.querySelector('[data-field-music-toggle]');
        if (musicToggle) {
            musicToggle.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const muted = soundManager.toggleBgMusicMuted?.({ fadeMs: 220 });
                if (!muted && fieldMusic) soundManager.playBgMusic(fieldMusic, { fadeMs: 260, volume: 0.3 });
                notify();
            };
        }
        window.addEventListener('resize', applyFieldPan, { passive: true });
        bindFieldPan(ctx);
        $$('.poop-btn').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const id = el.dataset.poop;
                if (el.dataset.fieldCoin) {
                    collectFieldMiningCoin(pet, fld.id, id, el);
                    return;
                }
                const poops = getPoopsInField(pet, fld.id);
                const poop = poops.find(p => p.id === id);
                if (poop) {
                    const fuelGain = CONFIG.biofuelPerPoop || 1;
                    removeRuntimePoopLocation(pet, fld.id, id);
                    setPetPoopCount(pet, fld.id, Math.max(0, getPetPoopCount(pet, fld.id) - 1));
                    markPetCared(pet);
                    try {
                        const ls = state.lifetimeStats || (state.lifetimeStats = { feeds: 0, poopsCleaned: 0, adultsRaised: 0 });
                        ls.poopsCleaned = (Number(ls.poopsCleaned) || 0) + 1;
                    } catch (_) {}
                    state.biofuel = (state.biofuel | 0) + fuelGain;
                    savePetDebounced(pet);
                    saveUserProfileDebounced();
                    soundManager.playPoopClean(1);
                    playPoopGlitchWind();
                    playFieldFuelRoomAnimation(fuelGain, () => {
                        updateBiofuelHud();
                        showToast(`+${fuelGain} ⛽ 生物燃料`, 'success', 900);
                    });
                    const stopPetPull = startFieldPetMachinePull();
                    playPoopSuckToMachine([poop], stopPetPull);
                    updateCleanPoopsButton(pet);
                }
            };
        });

        $$('.field-npc').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const npc = currentFieldNpcs(fld.id).find(item => item.id === el.dataset.npcId);
                if (!npc) return;
                openNpcDialog(npc, {
                    onConfirmed: () => {
                        applyNpcHatchBoost(npc, fld.id);
                        if (npc.minigame) ctx.callbacks.onLaunchNpcMinigame?.(npc);
                    },
                });
            };
        });

        $$('.field-area-link').forEach(el => {
            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetFieldId = el.dataset.areaTargetField;
                if (fields.some(field => field.id === targetFieldId)) setCurrentField(targetFieldId);
            };
        });

        // 点击空地放置已选中的家具
        const stage = $('mhStage');
        if (stage) {
            stage.addEventListener('click', (e) => {
                if (Date.now() - (stage.__mhFieldPannedAt || 0) < 260) return;
                if (e.target.closest('.poop-btn, .pet-sprite, .field-npc, .field-area-link, [data-tray-item], .mh-field-scale-controls, [data-field-music-toggle]')) return;
                if (e.target.closest('.field-item') && getClosestDraggableFieldItem(e.clientX, e.clientY)) return;
                clearFieldItemSelection(ctx);
                if (!isFieldDecorMode() || !ctx.selectedTrayItem) return;
                const pos = pointToFieldCoords(e.clientX, e.clientY, true);
                if (!pos) return;
                ctx.callbacks.onPlaceItem?.(ctx.selectedTrayItem, pos.x, pos.y, currentFieldKey());
            });
        }
        $$('.field-item').forEach(el => {
            bindFieldItemDrag(el, ctx);
        });
        updateFieldHouseFlagAnchors();
        ensureFieldItemScaleControls(ctx);
        restoreFieldItemSelection(ctx);

        // 点击宠物 → 播放开心动画（粒子 + 弹跳）；装扮模式下当前宠物可拖动
        $$('.field-pet').forEach(petEl => {
            bindFieldPetDrag(petEl, pet, ctx);
            petEl.onclick = (e) => {
                e.stopPropagation();
                // 刚刚发生过拖动时，吞掉随之而来的 click，避免误触发互动。
                if (Date.now() - (petEl.__mhFieldPetDraggedAt || 0) < 260) return;
                if (petEl.dataset.visitHostPet === '1') {
                    const hostPet = state.visitingMode?.friendPet;
                    showToast(`${displayPetName(hostPet)} 欢迎你来到好友星球。`, 'info', 2200);
                    showFieldPetTalk(petEl, hostPet || pet);
                    return;
                }
                if (petEl.dataset.invitedFieldPet === '1') {
                    const record = state.activeInvitedPet;
                    const guestPet = record?.pet;
                    showToast(record?.text || `${displayPetName(guestPet)} 来做客啦`, 'info', 2200);
                    showFieldPetTalk(petEl, guestPet || pet);
                    return;
                }
                const clickedPet = state.pets[petEl.dataset.fieldPet] || pet;
                if (isPetInteractionBlocked(clickedPet)) { showToast(sleepingInteractionText(clickedPet), 'info', 1800); return; }
                if (clickedPet.id === pet.id) {
                    ctx.onPetTouch?.(petEl, clickedPet);
                    playPetClickFeedback(petEl, clickedPet);
                }
                else showFieldPetTalk(petEl, clickedPet);
            };
        });

        if (state.activePetFieldPose?.fieldId === state.currentField && state.activePetFieldPose?.targetPetId) {
            scheduleCenterFieldPet(pet, { animate: true, duration: 420 });
        }
        // 蛋阶段：首次进入 field 时把镜头平移到蛋的位置，然后在蛋上播放烟花特效
        else if (pet?.stage === 'egg') {
            scheduleCenterFieldPet(pet, { animate: true, duration: 520, onComplete: () => {
                try { playEggWelcomeOnce(pet, 'field'); } catch (_) {}
            } });
        }
        else if (switchedField || !hadRememberedFieldPan) {
            scheduleCenterFieldPet(pet);
        }
        requestAnimationFrame(() => showCaretakerFieldNotice(pet));
    },

    dockHtml(pet) {
        const fields = availableFields();
        const currentField = fields.find(f => f.id === state.currentField) || fields[0] || CONFIG.fields[0];
        const inv = state.inventory || {};
        const categories = isReadonlyPlanet()
            ? FIELD_BUILD_CATEGORIES.filter(category => !['backgrounds', 'effects', 'music'].includes(category.id))
            : FIELD_BUILD_CATEGORIES;
        if (!FIELD_BUILD_CATEGORIES.some(category => category.id === activeFieldBuildCategory)) activeFieldBuildCategory = 'houses';
        if (!categories.some(category => category.id === activeFieldBuildCategory)) activeFieldBuildCategory = 'houses';

        return `
            <div class="mh-dock-row mh-scroll-x dock-tab-row ${isFieldDecorMode() ? 'has-decor-done' : ''}" id="mhFieldTabs">
                ${isFieldDecorMode() ? categories.map(category => `
                    <button type="button" class="btn-secondary dock-tab ${category.id === activeFieldBuildCategory ? 'active' : ''}" data-field-build-category="${escapeHtml(category.id)}">
                        ${escapeHtml(t(category.nameKey))}
                    </button>
                `).join('') : fields.map(f => `
                    <button class="btn-secondary dock-tab ${f.id === state.currentField ? 'active' : ''}" data-field="${f.id}">
                        ${terrainFieldTabIconHtml(f)} ${escapeHtml(localizeFieldName(f))}
                    </button>
                `).join('')}
            </div>
            ${isFieldDecorMode() ? `<button type="button" class="mh-decor-done-btn mh-field-mode-toggle" id="mhFieldDecorDoneBtn">${escapeHtml(t('exitDecor'))}</button>` : ''}
            ${isFieldDecorMode() ? `<button type="button" class="mh-room-dock-delete-target" id="mhFieldDockDeleteTarget" aria-hidden="true" tabindex="-1">🗑️ ${escapeHtml(t('putAwayBag'))}</button>` : ''}
            ${isFieldDecorMode() ? renderActiveFieldBuildTray(inv, currentField) : renderFieldActionTray(pet)}
        `;
    },

    bindDock(pet, ctx) {
        const dock = ctx.dock;
        if (!dock) return;
        updateCleanPoopsButton(pet);
        const fields = availableFields();
        const currentField = fields.find(f => f.id === state.currentField) || fields[0] || CONFIG.fields[0];
        setupLazySceneBackgrounds(dock);

        const activateFieldTab = (target, event) => {
            const fieldBtn = target.closest?.('[data-field]');
            if (!fieldBtn || !dock.contains(fieldBtn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            dock.__mhFieldDockTabHandledAt = Date.now();
            setCurrentField(fieldBtn.dataset.field);
            return true;
        };

        const activateModeToggle = (target, event) => {
            if (isVisitingMode() && target.closest?.('#mhFieldDecorBtn, #mhFieldDecorDoneBtn')) return false;
            if (!target.closest?.('#mhFieldDecorBtn, #mhFieldDecorDoneBtn')) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            dock.__mhFieldDockTabHandledAt = Date.now();
            suppressFieldDockActivationUntil = Date.now() + 350;
            if (!state.isDecorMode) activeFieldBuildCategory = 'houses';
            ctx.selectedTrayItem = null;
            clearFieldItemSelection(ctx);
            ctx.callbacks.onToggleDecor?.(!state.isDecorMode);
            return true;
        };

        const activateBuildCategory = (target, event) => {
            const btn = target.closest?.('[data-field-build-category]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const nextCategory = btn.dataset.fieldBuildCategory || 'houses';
            if (!FIELD_BUILD_CATEGORIES.some(category => category.id === nextCategory)) return false;
            if (isReadonlyPlanet() && ['backgrounds', 'effects', 'music'].includes(nextCategory)) {
                showToast('官方星球的场景不能修改。', 'info', 1400);
                return true;
            }
            dock.__mhFieldDockTabHandledAt = Date.now();
            activeFieldBuildCategory = nextCategory;
            ctx.selectedTrayItem = null;
            clearFieldItemSelection(ctx);
            notify();
            return true;
        };

        const activateFieldBackground = (target, event) => {
            const btn = target.closest?.('[data-field-background]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (isReadonlyPlanet()) {
                showToast('官方星球的场景不能修改。', 'info', 1400);
                return true;
            }
            const preset = fieldScenePresets.find(scene => scene.id === btn.dataset.fieldBackground);
            if (!preset) return false;
            dock.__mhFieldDockTabHandledAt = Date.now();
            saveCurrentFieldSceneConfig(currentField.id, {
                background: {
                    type: preset.imageUrl ? 'image' : 'color',
                    color: preset.color || '#bae6fd',
                    imageUrl: preset.imageUrl || '',
                    presetId: preset.id,
                    title: preset.title || '',
                },
            });
            showToast(t('fieldBgSwitched', { name: preset.title || localizeFieldName(currentField) }), 'success', 1200);
            return true;
        };

        const activateFieldEffect = (target, event) => {
            const btn = target.closest?.('[data-field-effect]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (isReadonlyPlanet()) {
                showToast('官方星球的场景不能修改。', 'info', 1400);
                return true;
            }
            const id = btn.dataset.fieldEffect || '';
            dock.__mhFieldDockTabHandledAt = Date.now();
            if (!id) {
                saveCurrentFieldSceneConfig(currentField.id, { particles: [] });
                showToast(t('fieldEffectOff'), 'success', 1000);
                return true;
            }
            const current = selectedFieldParticles(currentField.id);
            const particles = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
            saveCurrentFieldSceneConfig(currentField.id, { particles });
            const label = PARTICLE_EFFECTS.find(effect => effect.id === id)?.label || id;
            showToast(current.includes(id) ? t('fieldEffectRemoved', { label }) : t('fieldEffectAdded', { label }), 'success', 1000);
            return true;
        };

        const activateFieldMusic = (target, event) => {
            const btn = target.closest?.('[data-field-music]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (isReadonlyPlanet()) {
                showToast('官方星球的场景不能修改。', 'info', 1400);
                return true;
            }
            const music = btn.dataset.fieldMusic || '';
            dock.__mhFieldDockTabHandledAt = Date.now();
            saveCurrentFieldSceneConfig(currentField.id, { bgMusic: music });
            if (music) {
                soundManager.setBgMusicMuted?.(false, { fadeMs: 120 });
                soundManager.playBgMusic(music, { fadeMs: 320, volume: 0.3, restart: true });
                showToast(t('fieldMusicPlayed', { label: bgMusicLabel(music) }), 'success', 1000);
            } else {
                soundManager.stopBgMusic({ fadeMs: 320 });
                showToast(t('fieldMusicOff'), 'success', 1000);
            }
            return true;
        };

        const activateFieldShop = (target, event) => {
            const btn = target.closest?.('[data-field-shop]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            dock.__mhFieldDockTabHandledAt = Date.now();
            setShopFilter(btn.dataset.fieldShop || 'outdoor');
            suppressShopInitialClick();
            ctx.callbacks.onNav?.('shop', { preserveRoomMode: true });
            return true;
        };

        const activateCleanPoops = (target, event) => {
            const btn = target.closest?.('#mhFieldCleanPoopsBtn');
            if (isVisitingMode()) return false;
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            dock.__mhFieldDockTabHandledAt = Date.now();
            if (isDockButtonDisabled(btn)) {
                showDockDisabledToast(btn);
                return true;
            }
            collectPoopsInCurrentField(pet);
            return true;
        };

        const activateFieldAction = (target, event) => {
            const btn = target.closest?.('[data-field-action]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            dock.__mhFieldDockTabHandledAt = Date.now();
            if (isDockButtonDisabled(btn)) {
                showDockDisabledToast(btn);
                return true;
            }
            if (isVisitingMode()) {
                const friendPet = state.visitingMode?.friendPet || null;
                if (btn.dataset.fieldAction === 'visit-wave') {
                    teleportCurrentPetNextToHost();
                    requestAnimationFrame(() => {
                        playFieldGreeting({ currentPet: pet, friendPet }).catch(() => {});
                    });
                } else if (btn.dataset.fieldAction === 'visit-photo') {
                    teleportCurrentPetNextToHost();
                    (async () => {
                        // Wait until the camera/viewport has finished centering on the
                        // pets before framing and taking the photo.
                        await centerFieldPetAndWait(pet);
                        await playPhotoShutter();
                        showTakePhotoWindow({
                            currentPet: pet,
                            friendPet,
                            planetName: state.visitingMode?.planetName || '',
                            background: getCurrentFieldBackground(),
                        });
                    })().catch(() => {});
                } else if (btn.dataset.fieldAction === 'visit-return') ctx.zoomOut?.();
                return true;
            }
            ctx.callbacks.onAction?.(btn.dataset.fieldAction);
            return true;
        };

        const activateFieldNav = (target, event) => {
            const btn = target.closest?.('[data-field-nav]');
            if (!btn || !dock.contains(btn)) return false;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            dock.__mhFieldDockTabHandledAt = Date.now();
            if (isDockButtonDisabled(btn)) {
                showDockDisabledToast(btn);
                return true;
            }
            ctx.callbacks.onNav?.(btn.dataset.fieldNav);
            return true;
        };

        if (dock.__mhFieldDockTabPointerDown) {
            dock.removeEventListener('pointerdown', dock.__mhFieldDockTabPointerDown, true);
        }
        if (dock.__mhFieldDockTabPointerUp) {
            dock.removeEventListener('pointerup', dock.__mhFieldDockTabPointerUp, true);
            dock.removeEventListener('pointercancel', dock.__mhFieldDockTabPointerUp, true);
        }
        dock.__mhFieldDockTabPointer = null;
        dock.__mhFieldDockTabPointerDown = (e) => {
            const tab = e.target.closest?.('.dock-tab, .mh-field-mode-toggle, #mhFieldCleanPoopsBtn, [data-field-action], [data-field-nav], [data-field-shop]');
            if (!tab || !dock.contains(tab)) return;
            if (tab.classList.contains('mh-field-mode-toggle')) e.preventDefault();
            dock.__mhFieldDockTabPointer = {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                target: tab,
            };
        };
        dock.__mhFieldDockTabPointerUp = (e) => {
            if (Date.now() < suppressFieldDockActivationUntil) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const start = dock.__mhFieldDockTabPointer;
            dock.__mhFieldDockTabPointer = null;
            if (!start || start.id !== e.pointerId) return;
            const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8;
            if (!moved && Date.now() - (dock.__mhFieldDockTabHandledAt || 0) >= 250) {
                // Defer activation so this tap's trailing native click lands on the
                // still-present dock (swallowed) before any new window mounts.
                const t = start.target;
                dock.__mhFieldDockTabHandledAt = Date.now();
                suppressFieldDockActivationUntil = Date.now() + 350;
                setTimeout(() => {
                    activateFieldAction(t, e) || activateFieldNav(t, e) || activateFieldShop(t, e) || activateFieldBackground(t, e) || activateFieldEffect(t, e) || activateFieldMusic(t, e) || activateCleanPoops(t, e) || activateModeToggle(t, e) || activateBuildCategory(t, e) || activateFieldTab(t, e);
                }, 0);
            }
        };
        dock.addEventListener('pointerdown', dock.__mhFieldDockTabPointerDown, true);
        dock.addEventListener('pointerup', dock.__mhFieldDockTabPointerUp, true);
        dock.addEventListener('pointercancel', dock.__mhFieldDockTabPointerUp, true);

        if (dock.__mhFieldDockTabClick) {
            dock.removeEventListener('click', dock.__mhFieldDockTabClick, true);
        }
        dock.__mhFieldDockTabClick = (e) => {
            if (Date.now() < suppressFieldDockActivationUntil) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const scroller = e.target.closest?.('.mh-scroll-x');
            if (Date.now() - (scroller?.__mhDragScrolledAt || 0) < 250) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (Date.now() - (dock.__mhFieldDockTabHandledAt || 0) < 250) {
                e.stopPropagation();
                return;
            }
            activateFieldAction(e.target, e) || activateFieldNav(e.target, e) || activateFieldShop(e.target, e) || activateFieldBackground(e.target, e) || activateFieldEffect(e.target, e) || activateFieldMusic(e.target, e) || activateCleanPoops(e.target, e) || activateModeToggle(e.target, e) || activateBuildCategory(e.target, e) || activateFieldTab(e.target, e);
        };
        dock.addEventListener('click', dock.__mhFieldDockTabClick, true);

        dock.querySelectorAll('[data-tray-item]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                clearFieldItemSelection(ctx);
                dock.querySelectorAll('[data-tray-item]').forEach(x => x.style.outline = '');
                ctx.selectedTrayItem = el.dataset.trayItem;
                el.style.outline = '2px solid var(--accent)';
                if (isFieldDecorMode()) showToast(DRAG_TO_SCENE_HINT(), 'info', 1400);
            };
            bindFieldTrayDrag(el, ctx);
        });
    },

    onCameraChange(zoom) {
        setFieldEffectScale(zoom);
    },

    centerPet(pet, options) {
        return centerFieldPet(pet, options);
    },

    onLeave() {
        window.removeEventListener('resize', applyFieldPan);
    },
};

function bindFieldPan(ctx) {
    const stage = ctx.stage;
    const scene = $('mhFieldScene');
    if (!stage || !scene || stage.__mhFieldPanBound) return;
    stage.__mhFieldPanBound = true;
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
        if (scene.classList.contains('is-machine-sweeping')) return;
        if (e.button != null && e.button !== 0) return;
        const startsOnPoop = !!e.target.closest?.('.poop-btn');
        const startsOnFieldPet = !!e.target.closest?.('.field-pet');
        const startsOnFieldNpc = !!e.target.closest?.('.field-npc');
        if (!startsOnPoop && !startsOnFieldPet && !startsOnFieldNpc && e.target.closest?.('button, a, input, textarea, select, [contenteditable="true"], [data-tray-item], .pet-sprite')) return;
        if (isFieldDecorMode() && e.target.closest?.('.field-item') && getClosestDraggableFieldItem(e.clientX, e.clientY)) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: fieldPan, active: false };
    });
    stage.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.active) {
            if (Math.abs(dx) < DRAG_PLACE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
            drag.active = true;
            clearFieldItemSelection(ctx);
            try { stage.setPointerCapture?.(e.pointerId); } catch {}
            // 拖拽开始时一次性缓存边界，pointermove 不再做布局读取
            const bounds = getFieldPanBounds();
            drag.bounds = bounds ? { ...bounds, panKey: currentFieldPanKey() } : null;
        }
        e.preventDefault();
        drag.pendingPan = drag.pan + dx;
        if (drag.raf || !drag.bounds) return;
        const current = drag;
        current.raf = requestAnimationFrame(() => {
            current.raf = 0;
            if (!current.active) return;
            applyFieldPanFast(current.bounds, current.pendingPan);
        });
    });
    const end = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (drag.active) {
            if (drag.raf) cancelAnimationFrame(drag.raf);
            if (Number.isFinite(drag.pendingPan)) {
                fieldPan = drag.pendingPan;
                fieldPanById[currentFieldPanKey()] = fieldPan;
            }
            drag.active = false;
            try { stage.releasePointerCapture?.(e.pointerId); } catch {}
            stage.__mhFieldPannedAt = Date.now();
            // 结束时做一次完整重排（含 clamp / 粒子视口高度）
            applyFieldPan();
        }
        drag = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', (e) => {
        if (Date.now() - (stage.__mhFieldPannedAt || 0) > 260) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
}

function ensureFieldItemScaleControls(ctx) {
    const stage = ctx.stage;
    if (!stage) return null;
    let controls = document.getElementById('mhFieldItemScaleControls');
    if (controls) return controls;
    controls = document.createElement('div');
    controls.id = 'mhFieldItemScaleControls';
    controls.className = 'mh-field-scale-controls';
    controls.innerHTML = `
        <button type="button" class="mh-field-scale-btn" data-field-scale="down" aria-label="缩小物品" title="缩小">−</button>
        <button type="button" class="mh-field-scale-btn" data-field-scale="up" aria-label="放大物品" title="放大">+</button>
    `;
    controls.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    controls.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-field-scale]');
        if (!btn || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        scaleSelectedFieldItem(ctx, btn.dataset.fieldScale === 'up' ? 1 : -1);
    });
    stage.appendChild(controls);
    return controls;
}

function getSelectedFieldItemEl() {
    const selected = selectedFieldItem;
    if (!selected || selected.fieldKey !== currentFieldKey()) return null;
    return document.querySelector(`.field-item[data-fidx="${selected.idx}"]`);
}

function updateFieldItemScaleControls(ctx) {
    const controls = ensureFieldItemScaleControls(ctx);
    if (!controls) return;
    const el = getSelectedFieldItemEl();
    if (!el || !isFieldDecorMode()) {
        controls.classList.remove('is-visible');
        ctx.stage?.appendChild(controls);
        return;
    }
    const scale = clampRange(Number(el.dataset.fieldSize), FIELD_ITEM_MIN_SCALE, FIELD_ITEM_MAX_SCALE);
    if (controls.parentElement !== el) el.appendChild(controls);
    updateFieldItemScaleControlsAnchor(el, controls, ctx);
    controls.classList.add('is-visible');
    controls.querySelector('[data-field-scale="down"]')?.toggleAttribute('disabled', scale <= FIELD_ITEM_MIN_SCALE + 0.001);
    controls.querySelector('[data-field-scale="up"]')?.toggleAttribute('disabled', scale >= FIELD_ITEM_MAX_SCALE - 0.001);
}

function clearFieldItemSelection(ctx = null) {
    selectedFieldItem = null;
    $$('.field-item.selected').forEach(item => item.classList.remove('selected'));
    if (ctx) updateFieldItemScaleControls(ctx);
}

function selectFieldItem(el, ctx) {
    if (!el || !isFieldDecorMode()) return;
    const idx = parseInt(el.dataset.fidx, 10);
    if (!Number.isInteger(idx)) return;
    ctx.selectedTrayItem = null;
    ctx.dock?.querySelectorAll('[data-tray-item]').forEach(item => item.style.outline = '');
    $$('.field-item.selected').forEach(item => item.classList.remove('selected'));
    el.classList.add('selected');
    selectedFieldItem = { fieldKey: currentFieldKey(), idx };
    updateFieldItemScaleControls(ctx);
}

function restoreFieldItemSelection(ctx) {
    const el = getSelectedFieldItemEl();
    if (el && isFieldDecorMode()) el.classList.add('selected');
    else selectedFieldItem = null;
    updateFieldItemScaleControls(ctx);
}

function selectPendingFieldItem(idx) {
    if (!Number.isInteger(idx) || idx < 0) return;
    selectedFieldItem = { fieldKey: currentFieldKey(), idx };
}

function scaleSelectedFieldItem(ctx, direction) {
    const el = getSelectedFieldItemEl();
    if (!el || !isFieldDecorMode()) return;
    const idx = parseInt(el.dataset.fidx, 10);
    const layout = getLayout(ctx.pet.id, currentFieldKey()) || [];
    const placed = layout[idx];
    const def = ITEM_BY_ID[placed?.itemId];
    if (!placed || !def) return;
    const currentScale = getFieldItemScale(def, placed);
    const factor = direction > 0 ? FIELD_ITEM_SCALE_STEP : 1 / FIELD_ITEM_SCALE_STEP;
    const nextScale = clampRange(currentScale * factor, FIELD_ITEM_MIN_SCALE, FIELD_ITEM_MAX_SCALE);
    if (Math.abs(nextScale - currentScale) < 0.001) return;
    el.dataset.fieldSize = nextScale.toFixed(3);
    el.style.fontSize = getFieldItemFontSize(def, { ...placed, fieldSize: nextScale }).toFixed(1) + 'px';
    updateFieldHouseFlagAnchor(el);
    updateFieldItemScaleControls(ctx);
    playFieldItemDropSoundAsync();
    const movePromise = ctx.callbacks.onMoveItem?.(
        idx,
        clamp01(el.dataset.x ?? placed.x),
        clamp01(el.dataset.y ?? placed.y),
        currentFieldKey(),
        { fieldSize: nextScale, skipSound: true }
    );
    if (movePromise && typeof movePromise.catch === 'function') movePromise.catch(() => {});
}

function playFieldItemDropSoundAsync() {
    soundManager.playItemPlace();
}

function bindFieldItemDrag(el, ctx) {
    if (!el || el.__mhFieldItemDragBound) return;
    el.__mhFieldItemDragBound = true;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        if (!isFieldDecorMode()) return;
        if (e.target.closest?.('.mh-field-scale-controls')) return;
        const targetEl = getClosestDraggableFieldItem(e.clientX, e.clientY);
        if (!targetEl) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        clearFieldItemSelection(ctx);
        drag = {
            el: targetEl,
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            startX: Number(targetEl.dataset.x) || 0,
            startY: Number(targetEl.dataset.y) || 0,
            moved: false,
            idx: parseInt(targetEl.dataset.fidx, 10),
        };
        targetEl.classList.add('is-dragging');
        try { el.setPointerCapture?.(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const targetEl = drag.el;
        const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
        if (dist < DRAG_PLACE_THRESHOLD && !drag.moved) return;
        e.preventDefault();
        e.stopPropagation();
        drag.moved = true;
        const pos = fieldDragDeltaToCoords(drag, e.clientX, e.clientY);
        if (!pos) return;
        const overDock = isPointOverDock(e.clientX, e.clientY);
        setFieldDockDeleteTargetVisible(overDock);
        targetEl.classList.toggle('will-discard', overDock);
        targetEl.dataset.x = String(pos.x);
        targetEl.dataset.y = String(pos.y);
        targetEl.style.left = pct(pos.x);
        targetEl.style.top = pct(pos.y);
        // 拖拽开始时选中态已清除（pointerdown 里 clearFieldItemSelection），
        // 缩放控件必然隐藏，无需每帧重新定位。
    });
    const end = async (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const targetEl = drag.el;
        e.preventDefault();
        e.stopPropagation();
        try { el.releasePointerCapture?.(e.pointerId); } catch {}
        targetEl.classList.remove('is-dragging', 'will-discard');
        setFieldDockDeleteTargetVisible(false);
        if (drag.moved) {
            targetEl.__mhFieldDraggedAt = Date.now();
            if (isPointOverDock(e.clientX, e.clientY)) {
                targetEl.remove();
                clearFieldItemSelection(ctx);
                playFieldItemDropSoundAsync();
                await ctx.callbacks.onRemoveItem?.(drag.idx, currentFieldKey());
                drag = null;
                return;
            }
            const pos = fieldDragDeltaToCoords(drag, e.clientX, e.clientY);
            if (pos) {
                playFieldItemDropSoundAsync();
                await ctx.callbacks.onMoveItem?.(drag.idx, pos.x, pos.y, currentFieldKey(), { skipSound: true });
                clearFieldItemSelection(ctx);
            }
        } else if (e.type === 'pointerup') {
            selectFieldItem(targetEl, ctx);
            showToast(FIELD_DRAG_EXISTING_HINT(), 'info', 1400);
        }
        drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}

function fieldDragDeltaToCoords(drag, clientX, clientY) {
    // 拖拽期间场景尺寸不变：首次调用时缓存 rect，后续 pointermove 免去 forced reflow。
    let rect = drag.sceneRect;
    if (!rect) {
        rect = $('mhFieldScene')?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        drag.sceneRect = rect;
    }
    // 拖拽过程中若触发了边缘自动滚动，场景会发生位移；用累计的 pan 偏移量
    // 修正像素差值，使宠物贴着指针位置，而不是随场景滚动"打滑"。
    const panDelta = drag.panDelta || 0;
    return {
        x: clamp01(drag.startX + (clientX - drag.x - panDelta) / rect.width),
        y: clamp01(drag.startY + (clientY - drag.y) / rect.height),
    };
}

// 拖拽宠物时若指针靠近场景左右边缘，自动带动背景滚动：
// 停留时间越久速度越快，直到达到最大速度；离开边缘区域立即停止。
function stopFieldPetDragEdgeScroll(drag) {
    if (drag?.edgeScrollRaf) {
        cancelAnimationFrame(drag.edgeScrollRaf);
        drag.edgeScrollRaf = 0;
    }
    if (drag) {
        drag.edgeDir = 0;
        drag.edgeSince = 0;
    }
}

function updateFieldPetDragEdgeScroll(el, drag, clientX) {
    if (!drag.bounds) return;
    const stageRect = drag.stageRect || (drag.stageRect = drag.bounds.stage.getBoundingClientRect());
    let dir = 0;
    let depth = 0;
    if (clientX <= stageRect.left + FIELD_PET_DRAG_EDGE_ZONE_PX) {
        dir = -1;
        depth = clamp01((stageRect.left + FIELD_PET_DRAG_EDGE_ZONE_PX - clientX) / FIELD_PET_DRAG_EDGE_ZONE_PX);
    } else if (clientX >= stageRect.right - FIELD_PET_DRAG_EDGE_ZONE_PX) {
        dir = 1;
        depth = clamp01((clientX - (stageRect.right - FIELD_PET_DRAG_EDGE_ZONE_PX)) / FIELD_PET_DRAG_EDGE_ZONE_PX);
    }
    drag.edgeDepth = depth;
    if (dir === 0) {
        stopFieldPetDragEdgeScroll(drag);
        return;
    }
    if (drag.edgeDir !== dir) {
        drag.edgeDir = dir;
        drag.edgeSince = performance.now();
    }
    if (drag.edgeScrollRaf) return;
    const step = () => {
        drag.edgeScrollRaf = 0;
        if (!drag.edgeDir) return;
        const elapsed = performance.now() - drag.edgeSince;
        const ramp = clamp01(elapsed / FIELD_PET_DRAG_SCROLL_RAMP_MS);
        const speed = FIELD_PET_DRAG_SCROLL_MIN_SPEED + (FIELD_PET_DRAG_SCROLL_MAX_SPEED - FIELD_PET_DRAG_SCROLL_MIN_SPEED) * ramp * Math.max(0.35, drag.edgeDepth);
        // edgeDir === -1（贴左边缘）：向右平移场景内容，即增大 fieldPan（趋向 0）。
        // edgeDir === 1（贴右边缘）：向左平移场景内容，即减小 fieldPan（趋向 -maxPan）。
        const nextPan = fieldPan + (drag.edgeDir === -1 ? speed : -speed);
        const before = fieldPan;
        applyFieldPanFast(drag.bounds, nextPan);
        drag.panDelta = (drag.panDelta || 0) + (fieldPan - before);
        const pos = fieldDragDeltaToCoords(drag, drag.lastClientX, drag.lastClientY);
        if (pos) {
            el.style.left = pct(pos.x);
            el.style.top = pct(pos.y);
        }
        if (drag.edgeDir) drag.edgeScrollRaf = requestAnimationFrame(step);
    };
    drag.edgeScrollRaf = requestAnimationFrame(step);
}

// 装扮模式下让当前宠物可以像房间内家具一样被拖动到任意位置（仅本地姿态，不持久化）。
// 使用 window 级别的 move/up 监听，避免拖到模型上方时指针事件落到其它元素而中断拖动。
function bindFieldPetDrag(el, pet, ctx) {
    if (!el || el.__mhFieldPetDragBound) return;
    el.__mhFieldPetDragBound = true;
    // 仅当前宠物可拖动；好友/受邀/拜访宠物不可拖动。
    if (!el.classList.contains('field-pet-current')) return;
    if (el.dataset.invitedFieldPet === '1' || el.dataset.visitHostPet === '1') return;
    const wanderEl = el.querySelector(':scope > .field-pet-wander');
    // 拖动期间暂停（而不是取消）晃动动画：pause/play 会保留动画当前的 transform 取值，
    // 不会像 animation:none 那样瞬间把 transform 重置为 0，从而消除按下/松开时的左右跳动。
    const pauseWander = () => { try { wanderEl?.getAnimations?.().forEach(a => a.pause()); } catch (_) { } };
    const resumeWander = () => { try { wanderEl?.getAnimations?.().forEach(a => a.play()); } catch (_) { } };
    let drag = null;
    const cleanup = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
    };
    const onMove = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (!drag.moved) {
            const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
            if (dist < DRAG_PLACE_THRESHOLD) return;
            // 越过阈值才算拖动：把拖动原点重置到当前指针，避免宠物一开始瞬跳阈值距离。
            drag.x = e.clientX;
            drag.y = e.clientY;
        }
        e.preventDefault();
        e.stopPropagation();
        drag.moved = true;
        drag.lastClientX = e.clientX;
        drag.lastClientY = e.clientY;
        const pos = fieldDragDeltaToCoords(drag, e.clientX, e.clientY);
        if (pos) {
            el.style.left = pct(pos.x);
            el.style.top = pct(pos.y);
        }
        updateFieldPetDragEdgeScroll(el, drag, e.clientX);
    };
    const onEnd = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        stopFieldPetDragEdgeScroll(drag);
        cleanup();
        try { el.releasePointerCapture?.(e.pointerId); } catch {}
        el.classList.remove('is-dragging');
        resumeWander();
        if (drag.panDelta) applyFieldPan();
        if (drag.moved) {
            el.__mhFieldPetDraggedAt = Date.now();
            const pos = fieldDragDeltaToCoords(drag, e.clientX, e.clientY);
            if (pos) {
                // 记录当前宠物在该场景的本地姿态，使重渲染后位置保持不变。
                state.activePetFieldPose = {
                    fieldId: state.currentField,
                    x: clamp01(pos.x),
                    y: clamp01(pos.y),
                    delay: -1,
                    dur: 10,
                    dx: 0,
                    dy: 0,
                };
            }
        }
        drag = null;
    };
    el.addEventListener('pointerdown', (e) => {
        if (isVisitingMode()) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startPos = pointToFieldCoords(e.clientX, e.clientY) || { x: 0.5, y: 0.6 };
        const rawBounds = getFieldPanBounds();
        const bounds = rawBounds ? { ...rawBounds, panKey: currentFieldPanKey() } : null;
        drag = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            lastClientX: e.clientX,
            lastClientY: e.clientY,
            // 保留最初抓取点与宠物锚点之间的相对偏差（自然拖拽手感），
            // 而不是让宠物瞬间贴合到指针下方——那样在指针未落在宠物中心时会产生跳动。
            startX: Number.isFinite(parseFloat(el.style.left)) ? parseFloat(el.style.left) / 100 : startPos.x,
            startY: Number.isFinite(parseFloat(el.style.top)) ? parseFloat(el.style.top) / 100 : startPos.y,
            moved: false,
            bounds,
            panDelta: 0,
            edgeDir: 0,
        };
        el.classList.add('is-dragging');
        pauseWander();
        try { el.setPointerCapture?.(e.pointerId); } catch {}
        cleanup();
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onEnd, true);
        window.addEventListener('pointercancel', onEnd, true);
    });
}

function bindFieldTrayDrag(el, ctx) {
    let drag = null;
    const cleanupWindowDrag = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
    };
    const clearDrag = (pointerId = null) => {
        const current = drag;
        drag = null;
        cleanupWindowDrag();
        current?.ghost?.remove();
        if (pointerId != null && current?.sourceEl?.releasePointerCapture) {
            try { current.sourceEl.releasePointerCapture(pointerId); } catch {}
        }
        return current;
    };
    const lockDragAsScroll = (e) => {
        if (!drag) return;
        e.preventDefault?.();
        drag.scrollLocked = true;
        const scroller = drag.scroller;
        if (scroller) {
            scroller.scrollLeft -= e.clientX - drag.lastScrollX;
            drag.lastScrollX = e.clientX;
            scroller.__mhTouchScrollMoved = true;
        }
    };
    const pointInsideDock = (clientX, clientY) => {
        const rect = drag?.scroller?.getBoundingClientRect?.();
        return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };
    const startTrayItemDrag = (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        drag.active = true;
        drag.scrollLocked = false;
        ctx.selectedTrayItem = drag.itemId;
        drag.ghost = makeFieldDragGhost(drag.itemId);
        drag.sourceEl.__mhTrayDragActive = true;
        drag.sourceEl?.setPointerCapture?.(e.pointerId);
        moveFieldDragGhost(drag.ghost, e.clientX, e.clientY);
    };
    const onMove = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const insideDock = pointInsideDock(e.clientX, e.clientY);
        if (drag.scrollLocked) {
            if (!insideDock) startTrayItemDrag(e);
            else lockDragAsScroll(e);
            return;
        }
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.active) {
            if (Math.hypot(dx, dy) < DRAG_PLACE_THRESHOLD) return;
            if (insideDock && Math.abs(dx) >= Math.abs(dy)) {
                lockDragAsScroll(e);
                return;
            }
            startTrayItemDrag(e);
            return;
        }
        e.preventDefault?.();
        moveFieldDragGhost(drag.ghost, e.clientX, e.clientY);
    };
    const onEnd = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const current = clearDrag(e.pointerId);
        if (current?.sourceEl) current.sourceEl.__mhTrayDragActive = false;
        if (!current.active) return;
        const pos = pointToFieldCoords(e.clientX, e.clientY, true);
        if (!pos) return;
        const nextIdx = (getLayout(ctx.pet.id, currentFieldKey()) || []).length;
        clearFieldItemSelection(ctx);
        playFieldItemDropSoundAsync();
        const placePromise = ctx.callbacks.onPlaceItem?.(current.itemId, pos.x, pos.y, currentFieldKey(), { skipSound: true });
        if (placePromise && typeof placePromise.catch === 'function') {
            placePromise.catch(() => {
                if (selectedFieldItem?.fieldKey === currentFieldKey() && selectedFieldItem.idx === nextIdx) selectedFieldItem = null;
            });
        }
    };
    el.addEventListener('pointerdown', (e) => {
        if (!isFieldDecorMode()) return;
        if (e.button != null && e.button !== 0) return;
        e.stopPropagation();
        clearDrag();
        const scroller = el.closest?.('.mh-scroll-x');
        drag = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            itemId: el.dataset.trayItem,
            ghost: null,
            active: false,
            scrollLocked: false,
            scroller,
            lastScrollX: e.clientX,
            sourceEl: el,
        };
        el.__mhTrayDragActive = false;
        try { el.setPointerCapture?.(e.pointerId); } catch {}
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    });
}
