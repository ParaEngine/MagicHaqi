// Level 2 — 宠物 + 房间（经典电子宠物日常）

import { $, $$, dockDisabledAttrs, escapeHtml, isDockButtonDisabled, randInt, renderVisualAsset, showDockDisabledToast, showToast } from './utils.js';
import { t } from './i18n.js';
import { canPlaceItemInArea, CONFIG, DECO_VISUALS, getActiveHouseRoomIds, getPlacedItemZOrder, getShopItemById, SHOP_ITEMS } from './config.js';
import { isVisitingMode, notify, state } from './state.js';
import { getLayout } from './storage.js';
import { displayPetName } from './dna.js';
import { getPet, getPetSleepActionState, isPetInteractionBlocked, petArtHtml, playPetClickFeedback, playPetHappy, say, scanAndMount, sleepingInteractionText } from './pet.js';
import { getGeneratedPetLocation, hasRenderablePetTexture } from './petLifecycle.js';
import SoundManager from './soundManager.js';
import { BATH_COMPLETE_FEEDBACK_MS, BATH_COMPLETE_LINES, BATH_SEQUENCE_MS, createBathSequenceOverlay, isPetVisibleInStage } from './petInteractions.js';
import { setShopFilter, suppressShopInitialClick } from './view_shop.js';

const ITEM_BY_ID = new Proxy({}, { get: (_, id) => getShopItemById(id) });
const BASIC_FEED_ID = 'food_basic_feed';
const soundManager = SoundManager.getInstance();
const ITEM_Z_INDEX_BASE = 5;
const FOOD_Z_INDEX_BASE = 24;
const ROOM_Z_ORDER_STRIDE = 10000;
const ROOM_DEPTH_Z_STEP = 100;
const ROOM_ITEM_SELECTOR = '#mhFurnitureLayer .mh-room-furniture, #mhFoodLayer .mh-room-furniture';
const ROOM_AGENT_WALK_DURATION_MS = 4100;
const ROOM_AGENT_IDLE_MIN_MS = 9000;
const ROOM_AGENT_IDLE_MAX_MS = 14000;
const ROOM_AGENT_INITIAL_IDLE_MS = 3500;
const FOOD_EAT_MIN_MS = 3000;
const FOOD_EAT_MAX_MS = 5000;
const FOOD_EAT_MIN_ENERGY = 12;
const FOOD_EAT_MAX_ENERGY = 30;
const FEED_SAY_MIN_VISIBLE_MS = 3000;
const ROOM_WIDTH_METERS = 10;
const ROOM_SIDE_OVERDRAW_METERS = 1;
const ROOM_SCENE_WIDTH_METERS = ROOM_WIDTH_METERS + ROOM_SIDE_OVERDRAW_METERS * 2;
const ROOM_HEIGHT_METERS = 3;
const PET_HEIGHT_METERS = 0.75;
const PET_WIDTH_METERS = 0.75;
const ROOM_PET_REPEL_MIN_X_METERS = PET_WIDTH_METERS * 0.95;
const ROOM_PET_REPEL_MIN_Y_METERS = PET_HEIGHT_METERS * 0.72;
const PET_START_X_METERS = ROOM_WIDTH_METERS - PET_WIDTH_METERS - 1.25;
const PET_START_Y_METERS = 1.68;
const PET_FOLLOW_SCREEN_X = 0.72;
const DRAG_PLACE_THRESHOLD = 8;
const ROOM_DRAG_TO_SCENE_HINT = '拖动到房间中';
const ROOM_DRAG_EXISTING_HINT = '拖动物品可移动，拖到底部可收回';
const ROOM_FEED_DRAG_HINT = '拖动食物到宠物身上喂食';
const ROOM_ITEM_MIN_SCALE = 0.65;
const ROOM_ITEM_MAX_SCALE = 2.4;
const ROOM_ITEM_SCALE_STEP = 1.15;
const FINGER_HIT_RADIUS_PX = 18;
const FINGER_HIT_SAMPLE_POINTS = [
    [0, 0], [0, -1], [1, 0], [0, 1], [-1, 0],
    [0.72, -0.72], [0.72, 0.72], [-0.72, 0.72], [-0.72, -0.72],
];
const IMAGE_ALPHA_HIT_THRESHOLD = 24;
const IMAGE_ALPHA_AABB_CACHE = new Map();

let roomPan = 0;
let pxPerMeter = 1;
let roomAgentTimer = null;
let roomPetMode = 'follow';
let decorPetPose = null;
let bathAnimationRunning = false;
let selectedRoomItem = null;

function isRoomPlacementMode() {
    return state.isDecorMode || state.isFeedMode;
}

function showRoomDragHint(itemType = 'furniture', source = 'tray') {
    if (state.isFeedMode) {
        showToast(ROOM_FEED_DRAG_HINT, 'info', 1400);
        return;
    }
    showToast(source === 'layout' ? ROOM_DRAG_EXISTING_HINT : ROOM_DRAG_TO_SCENE_HINT, 'info', 1400);
}

function showSleepingBlocked(pet) {
    showToast(sleepingInteractionText(pet), 'info', 1800);
}

function canDragRoomItem(el) {
    const itemType = el?.dataset?.itemType || 'furniture';
    return (state.isDecorMode && (itemType === 'furniture' || itemType === 'food')) || (state.isFeedMode && itemType === 'food');
}

function setPetRoomMotion(mode, duration = 0) {
    const el = $('mhPet');
    const inner = el?.querySelector('[data-mh-pet]');
    if (!inner) return;
    clearTimeout(inner.__mhWalkRevert);
    inner.dataset.mhPetMotion = mode;
    const sprite = inner.querySelector('.mh-pet-art-sprite');
    if (sprite) {
        sprite.classList.toggle('mh-pet-walk', mode === 'walk');
        sprite.classList.toggle('mh-pet-idle', mode !== 'walk');
    } else {
        inner.classList.toggle('mh-pet-walk', mode === 'walk');
    }
    if (mode === 'walk' && duration > 0) {
        inner.__mhWalkRevert = setTimeout(() => setPetRoomMotion('idle'), duration);
    }
}

function movePetToRoomPoint(xMeters, yMeters, options = {}) {
    const el = $('mhPet');
    if (!el) return false;
    if (options.mode) roomPetMode = options.mode;
    const currentX = Number(el.dataset.xMeters) || PET_START_X_METERS;
    const nextPose = repelRoomPetPose({ x: xMeters, y: yMeters }, releasedRoomPetOccupiedPos(), `active-room-pet::${roomPetMode}`);
    const nextX = nextPose.x;
    const nextY = nextPose.y;
    el.dataset.xMeters = String(nextX);
    el.dataset.yMeters = String(nextY);
    decorPetPose = { x: nextX, y: nextY };
    applyMeterElementStyle(el);
    el.dataset.roomPetMode = roomPetMode;
    const face = options.face || (nextX < currentX ? 'left' : 'right');
    el.style.transform = face === 'left' ? 'scaleX(-1)' : 'scaleX(1)';
    setPetRoomMotion(options.motion || 'walk', options.duration || ROOM_AGENT_WALK_DURATION_MS);
    return true;
}

function setPetFollowUser() {
    roomPetMode = 'follow';
    clearRoomAgentTimer();
    updateFollowPetPosition();
    setPetRoomMotion('idle');
}

function updateFollowPetPosition() {
    if (roomPetMode !== 'follow') return;
    const stage = $('mhStage');
    const el = $('mhPet');
    if (!stage || !el) return;
    const targetScreenX = stage.clientWidth * PET_FOLLOW_SCREEN_X;
    const xMeters = ((targetScreenX - roomPan) / pxPerMeter) - ROOM_SIDE_OVERDRAW_METERS - PET_WIDTH_METERS / 2;
    const nextPose = repelRoomPetPose({ x: xMeters, y: PET_START_Y_METERS }, releasedRoomPetOccupiedPos(), 'active-room-pet::follow');
    const nextX = nextPose.x;
    el.dataset.xMeters = String(nextX);
    el.dataset.yMeters = String(nextPose.y);
    decorPetPose = { x: nextX, y: nextPose.y };
    el.dataset.roomPetMode = roomPetMode;
    applyMeterElementStyle(el);
    el.style.transform = 'scaleX(1)';
}

function engagePetWithFurniture(el) {
    if (!el || isRoomPlacementMode()) return;
    roomPetMode = 'engaged';
    clearRoomAgentTimer();
    const x = Number(el.dataset.xMeters) || 0;
    const y = Number(el.dataset.yMeters) || 0;
    const w = Number(el.dataset.wMeters) || PET_WIDTH_METERS;
    const h = Number(el.dataset.hMeters) || PET_HEIGHT_METERS;
    const targetX = x + w / 2 - PET_WIDTH_METERS / 2;
    const targetY = y + Math.max(0, h - PET_HEIGHT_METERS);
    const petEl = $('mhPet');
    if (petEl) {
        petEl.dataset.roomPetMode = roomPetMode;
        petEl.dataset.engagedItem = el.dataset.fidx || '';
    }
    movePetToRoomPoint(targetX, targetY, { mode: 'engaged', motion: 'walk', duration: ROOM_AGENT_WALK_DURATION_MS });
}

function scheduleRoomAgentMove(delay) {
    clearRoomAgentTimer();
    roomAgentTimer = setTimeout(movePetOnce, delay);
}

function clearRoomAgentTimer() {
    if (roomAgentTimer) {
        clearTimeout(roomAgentTimer);
        roomAgentTimer = null;
    }
}

function movePetOnce() {
    const scene = $('mhPetRoomScene');
    if (!scene?.clientWidth || !scene?.clientHeight || isRoomPlacementMode()) {
        scheduleRoomAgentMove(ROOM_AGENT_IDLE_MIN_MS);
        return;
    }
    const xMeters = randInt(8, Math.max(8, Math.round((ROOM_WIDTH_METERS - PET_WIDTH_METERS) * 10))) / 10;
    const yMeters = randInt(12, 21) / 10;
    movePetToRoomPoint(xMeters, yMeters, { mode: 'autonomous' });
    scheduleRoomAgentMove(ROOM_AGENT_WALK_DURATION_MS + randInt(ROOM_AGENT_IDLE_MIN_MS, ROOM_AGENT_IDLE_MAX_MS));
}

function startPetWalk() {
    roomPetMode = 'autonomous';
    scheduleRoomAgentMove(ROOM_AGENT_INITIAL_IDLE_MS);
}

function stopPetWalk() {
    clearRoomAgentTimer();
    setPetRoomMotion('idle');
}

function pinPetInRoom() {
    setPetFollowUser();
}

function getFurnitureVisual(item) {
    const custom = DECO_VISUALS[item?.id] || {};
    const visual = {
        ...custom,
        svg: item?.svg || custom.svg,
        imageUrl: item?.imageUrl || custom.imageUrl,
    };
    if (item?.type === 'food') {
        return { ...visual, svg: visual.svg || fallbackFoodSvg(item) };
    }
    return { ...visual, svg: visual.svg || fallbackFurnitureSvg(item) };
}

function getItemFieldSize(item, placedItem = null) {
    const rawSize = placedItem?.fieldSize ?? item?.fieldSize;
    const size = Number(rawSize);
    return clampRange(Number.isFinite(size) ? size : 1, 0.2, 5);
}

function fallbackFurnitureSvg(item) {
    const icon = escapeHtml(item?.emoji || '◆');
    return `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="18" width="124" height="124" rx="24" fill="#e0f7ff" stroke="#38bdf8" stroke-width="8"/><text x="80" y="100" text-anchor="middle" font-size="72">${icon}</text></svg>`;
}

function fallbackFoodSvg(item) {
    const icon = escapeHtml(item?.emoji || '');
    return `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><text x="80" y="105" text-anchor="middle" font-size="82">${icon}</text></svg>`;
}

function furnitureHtml(def) {
    const visual = getFurnitureVisual(def);
    const visualClass = def?.type === 'food' ? ' mh-food-svg' : '';
    const visualHtml = renderVisualAsset(visual, { className: 'mh-furniture-img', alt: def?.name || '' });
    return `<span class="mh-furniture-svg${visualClass}" aria-hidden="true">${visualHtml}</span>`;
}

function servingFoodCutHtml(item) {
    const cutBands = [
        [10, 10, 34, 18, -7, -8, -20],
        [34, 18, 34, 50, 7, -7, 20],
        [34, 50, 66, 50, -7, -5, -20],
        [66, 50, 66, 82, 7, -6, 20],
        [66, 82, 90, 90, -4, 8, 0],
    ];
    const slices = cutBands.map(([leftTop, rightTop, leftBottom, rightBottom, exitX, exitY, rot], index) => `
        <span class="mh-serving-food-slice" style="--mh-slice-index:${index};--mh-slice-clip:polygon(0 ${leftTop}%, 100% ${rightTop}%, 100% ${rightBottom}%, 0 ${leftBottom}%);--mh-slice-x:${exitX}px;--mh-slice-y:${exitY}px;--mh-slice-rot:${rot}deg;--mh-slice-mid-x:${(exitX * 0.34).toFixed(1)}px;--mh-slice-mid-y:${(exitY * 0.34).toFixed(1)}px;--mh-slice-mid-rot:${(rot * 0.34).toFixed(1)}deg">
            <span class="mh-serving-food-slice-art">${furnitureHtml(item)}</span>
        </span>
    `).join('');
    return `<span class="mh-serving-food-cut-stack" aria-hidden="true">${slices}</span>`;
}

function normalizeRoomItem(item, def) {
    const base = getFurnitureMeters(def, item);
    return {
        x: clampRange(Number(item.x), 0, ROOM_WIDTH_METERS),
        y: clampRange(Number(item.y), 0, ROOM_HEIGHT_METERS),
        w: clampRange(Number(item.wMeters) || base.w, 0.2, 5),
        h: clampRange(Number(item.hMeters) || base.h, 0.2, 2.4),
    };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function clampRange(value, min, max) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

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
    return (value * 100).toFixed(3) + '%';
}

function recomputeRoomMetrics() {
    const stage = $('mhStage');
    const scene = $('mhPetRoomScene');
    const floor = $('mhPetRoomFloor');
    const stageHeight = stage?.clientHeight || window.innerHeight || 540;
    pxPerMeter = Math.max(1, stageHeight / ROOM_HEIGHT_METERS);
    const gridStep = pxPerMeter.toFixed(2) + 'px';
    const stageWidth = stage?.clientWidth || window.innerWidth || 0;
    const stageHeightForBleed = stage?.clientHeight || window.innerHeight || 0;
    const floorBleedPx = stageWidth * 5;
    const floorBleed = floorBleedPx.toFixed(1) + 'px';
    const floorContainerBleedPx = stageWidth * 1.6;
    const floorContainerBleed = floorContainerBleedPx.toFixed(1) + 'px';
    const floorContainerBleedY = (stageHeightForBleed * 1.2).toFixed(1) + 'px';
    const floorOrigin = (floorBleedPx + floorContainerBleedPx).toFixed(1) + 'px';
    if (scene) {
        scene.style.width = Math.round(ROOM_SCENE_WIDTH_METERS * pxPerMeter) + 'px';
        scene.style.setProperty('--room-grid-step', gridStep);
    }
    if (floor) {
        floor.style.setProperty('--room-grid-step', gridStep);
        floor.style.setProperty('--floor-container-bleed', floorContainerBleed);
        floor.style.setProperty('--floor-container-bleed-y', floorContainerBleedY);
        floor.style.setProperty('--floor-bleed', floorBleed);
        floor.style.setProperty('--floor-origin', floorOrigin);
    }
}

function applyMeterElementStyle(el) {
    if (!el) return;
    const pos = {
        x: Number(el.dataset.xMeters) || 0,
        y: Number(el.dataset.yMeters) || 0,
        w: Number(el.dataset.wMeters) || PET_WIDTH_METERS,
        h: Number(el.dataset.hMeters) || PET_HEIGHT_METERS,
    };
    el.style.left = roomXToScenePx(pos.x) + 'px';
    el.style.top = metersToPx(pos.y) + 'px';
    el.style.width = metersToPx(pos.w) + 'px';
    el.style.height = metersToPx(pos.h) + 'px';
    if (el.classList?.contains('mh-room-furniture') && !el.classList.contains('mh-serving-food')) {
        applyRoomItemZIndex(el, pos);
    }
}

function getRoomItemZIndex(pos, zorder = 0, itemType = 'furniture') {
    const zIndexBase = itemType === 'food' ? FOOD_Z_INDEX_BASE : ITEM_Z_INDEX_BASE;
    const itemZOrder = Number.isFinite(Number(zorder)) ? Number(zorder) : 0;
    const bottomCenterY = (Number(pos?.y) || 0) + (Number(pos?.h) || 0) / 2;
    return zIndexBase + itemZOrder * ROOM_Z_ORDER_STRIDE + Math.round(bottomCenterY * ROOM_DEPTH_Z_STEP);
}

function applyRoomItemZIndex(el, pos = null) {
    if (!el) return;
    const itemPos = pos || {
        y: Number(el.dataset.yMeters) || 0,
        h: Number(el.dataset.hMeters) || 0,
    };
    el.style.zIndex = String(getRoomItemZIndex(itemPos, Number(el.dataset.zorder), el.dataset.itemType));
}

function setRoomItemDragElevation(el, active) {
    if (!el) return;
    if (active) {
        if (!el.__mhRoomDragHome) {
            el.__mhRoomDragHome = {
                parent: el.parentElement,
                nextSibling: el.nextSibling,
                zIndex: el.style.zIndex,
            };
        }
        const scene = $('mhPetRoomScene');
        if (scene && el.parentElement !== scene) scene.appendChild(el);
        el.style.zIndex = '900020';
        return;
    }
    const home = el.__mhRoomDragHome;
    if (home?.parent && el.parentElement !== home.parent) {
        if (home.nextSibling?.parentElement === home.parent) home.parent.insertBefore(el, home.nextSibling);
        else home.parent.appendChild(el);
    }
    if (home) {
        if (home.zIndex) el.style.zIndex = home.zIndex;
        else applyRoomItemZIndex(el);
    }
    el.__mhRoomDragHome = null;
}

function applyRoomMeterLayout() {
    recomputeRoomMetrics();
    $$(ROOM_ITEM_SELECTOR).forEach(applyMeterElementStyle);
    applyMeterElementStyle($('mhPet'));
    $$('.mh-released-room-pet').forEach(applyMeterElementStyle);
}

function roomItemHtml(it, index) {
    const def = ITEM_BY_ID[it.itemId];
    if (!def) return '';
    const pos = normalizeRoomItem(it, def);
    const zorder = getPlacedItemZOrder(it, def);
    const zIndex = getRoomItemZIndex(pos, zorder, def.type);
    const fieldSize = getItemFieldSize(def, it);
    return `<div class="furniture mh-room-furniture" data-fidx="${index}" data-item-id="${escapeHtml(def.id)}" data-item-type="${escapeHtml(def.type || 'furniture')}" data-zorder="${zorder}" data-field-size="${fieldSize}" data-x-meters="${pos.x}" data-y-meters="${pos.y}" data-w-meters="${pos.w}" data-h-meters="${pos.h}" style="${meterStyle(pos)};z-index:${zIndex}" title="${escapeHtml(def.name || '')}">${furnitureHtml(def)}</div>`;
}

function metersToPx(value) {
    return Math.max(1, Math.round((Number(value) || 0) * pxPerMeter));
}

function meterStyle(pos) {
    return `left:${roomXToScenePx(pos.x)}px;top:${metersToPx(pos.y)}px;width:${metersToPx(pos.w)}px;height:${metersToPx(pos.h)}px`;
}

function roomXToScenePx(xMeters) {
    return metersToPx((Number(xMeters) || 0) + ROOM_SIDE_OVERDRAW_METERS);
}

function getFurnitureMeters(item, placedItem = null) {
    const size = getItemFieldSize(item, placedItem);
    return {
        w: clampRange(size, 0.2, 5),
        h: clampRange(size, 0.2, 2.4),
    };
}

function applyRoomPan() {
    const scene = $('mhPetRoomScene');
    const stage = $('mhStage');
    const floor = $('mhPetRoomFloor');
    if (!scene || !stage) return;
    applyRoomMeterLayout();
    const maxPan = Math.max(0, scene.offsetWidth - stage.clientWidth);
    roomPan = Math.max(-maxPan, Math.min(0, roomPan));
    scene.style.transform = `translate3d(${roomPan.toFixed(1)}px,0,0)`;
    if (floor) floor.style.setProperty('--floor-ox', roomPan.toFixed(1) + 'px');
    if (!isRoomPlacementMode()) updateFollowPetPosition();
}

function getCurrentPetPose() {
    if (state.activePetRoomPose?.roomId === (state.currentRoom || 'living')) {
        const pose = state.activePetRoomPose;
        decorPetPose = repelRoomPetPose({ x: pose.xMeters, y: pose.yMeters }, releasedRoomPetOccupiedPos(), 'active-room-pet::find');
        state.activePetRoomPose = null;
        roomPetMode = 'engaged';
        return decorPetPose;
    }
    const petElement = $('mhPet');
    if (petElement) {
        decorPetPose = {
            x: clampRange(Number(petElement.dataset.xMeters), 0, ROOM_WIDTH_METERS - PET_WIDTH_METERS),
            y: clampRange(Number(petElement.dataset.yMeters), 0, ROOM_HEIGHT_METERS - PET_HEIGHT_METERS),
        };
    }
    return decorPetPose || { x: PET_START_X_METERS, y: PET_START_Y_METERS };
}

function repelRoomPetPose(pose, occupied, seedText = 'room-pet') {
    const next = {
        x: clampRange(Number(pose?.x), 0, ROOM_WIDTH_METERS - PET_WIDTH_METERS),
        y: clampRange(Number(pose?.y), 0, ROOM_HEIGHT_METERS - PET_HEIGHT_METERS),
    };
    const rng = makeRng(seedText);
    for (let step = 0; step < 10; step++) {
        let moved = false;
        for (const other of occupied) {
            const dx = next.x - other.x;
            const dy = next.y - other.y;
            const nx = dx / ROOM_PET_REPEL_MIN_X_METERS;
            const ny = dy / ROOM_PET_REPEL_MIN_Y_METERS;
            const distSq = nx * nx + ny * ny;
            if (distSq >= 1) continue;
            const dist = Math.sqrt(distSq) || 0.001;
            const angle = Math.atan2(dy || (rng() - 0.5), dx || (rng() - 0.5));
            const strength = (1 - dist) * 0.55 + 0.06;
            next.x = clampRange(next.x + Math.cos(angle) * ROOM_PET_REPEL_MIN_X_METERS * strength, 0, ROOM_WIDTH_METERS - PET_WIDTH_METERS);
            next.y = clampRange(next.y + Math.sin(angle) * ROOM_PET_REPEL_MIN_Y_METERS * strength, 1.08, ROOM_HEIGHT_METERS - PET_HEIGHT_METERS);
            moved = true;
        }
        if (!moved) break;
    }
    return next;
}

function releasedRoomPetOccupiedPos() {
    return $$('.mh-released-room-pet').map(el => ({
        x: clampRange(Number(el.dataset.xMeters), 0, ROOM_WIDTH_METERS - PET_WIDTH_METERS),
        y: clampRange(Number(el.dataset.yMeters), 0, ROOM_HEIGHT_METERS - PET_HEIGHT_METERS),
    }));
}

function focusPetInRoom(pose = getCurrentPetPose()) {
    const stage = $('mhStage');
    if (!stage) return;
    const petCenterMeters = ROOM_SIDE_OVERDRAW_METERS + pose.x + PET_WIDTH_METERS / 2;
    roomPan = stage.clientWidth * 0.72 - metersToPx(petCenterMeters);
    applyRoomPan();
}

function clientScaleForElement(el) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 1, y: 1 };
    return {
        x: (el.offsetWidth || el.clientWidth || rect.width) / rect.width,
        y: (el.offsetHeight || el.clientHeight || rect.height) / rect.height,
    };
}

function clientDeltaToRoomMeters(deltaX, deltaY) {
    const scene = $('mhPetRoomScene');
    const scale = clientScaleForElement(scene);
    return {
        x: (Number(deltaX) || 0) * scale.x / pxPerMeter,
        y: (Number(deltaY) || 0) * scale.y / pxPerMeter,
    };
}

function roomMetersToClientPx(widthMeters, heightMeters) {
    const scene = $('mhPetRoomScene');
    const scale = clientScaleForElement(scene);
    return {
        width: metersToPx(widthMeters) / scale.x,
        height: metersToPx(heightMeters) / scale.y,
    };
}

function pointToRoomCoords(clientX, clientY) {
    const scene = $('mhPetRoomScene');
    if (!scene) return null;
    const rect = scene.getBoundingClientRect();
    const scale = clientScaleForElement(scene);
    return {
        x: clampRange((((clientX - rect.left) * scale.x) / pxPerMeter) - ROOM_SIDE_OVERDRAW_METERS, 0, ROOM_WIDTH_METERS),
        y: clampRange(((clientY - rect.top) * scale.y) / pxPerMeter, 0, ROOM_HEIGHT_METERS),
    };
}

function pointOverPet(clientX, clientY) {
    const petEl = $('mhPet');
    if (!petEl) return false;
    const rect = petEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function getRoomItemImageRect(el) {
    const image = el?.querySelector?.('.mh-furniture-svg');
    const rect = image?.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ? rect : el?.getBoundingClientRect?.();
}

function pointInRect(clientX, clientY, rect) {
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function rectIntersectsFinger(clientX, clientY, rect, radius = FINGER_HIT_RADIUS_PX) {
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
    if (IMAGE_ALPHA_AABB_CACHE.has(key)) return IMAGE_ALPHA_AABB_CACHE.get(key);
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
                if (data[row + x * 4 + 3] <= IMAGE_ALPHA_HIT_THRESHOLD) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        const aabb = maxX >= minX && maxY >= minY
            ? { minX, minY, maxX: maxX + 1, maxY: maxY + 1, width: canvas.width, height: canvas.height }
            : { empty: true, width: canvas.width, height: canvas.height };
        IMAGE_ALPHA_AABB_CACHE.set(key, aabb);
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

function pointOverImageOpaqueAabb(img, clientX, clientY) {
    if (!img) return null;
    const rect = imageContentRect(img);
    if (!pointInRect(clientX, clientY, rect)) return false;
    const aabbRect = imageOpaqueAabbClientRect(img);
    if (!aabbRect) return true;
    if (aabbRect.empty) return false;
    return clientX >= aabbRect.left && clientX <= aabbRect.right && clientY >= aabbRect.top && clientY <= aabbRect.bottom;
}

function roomItemScaleControlsAnchor(el) {
    const itemRect = el?.getBoundingClientRect?.();
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) return { leftPercent: 50, topPercent: 100 };
    const img = el.querySelector?.('.mh-furniture-img');
    const aabbRect = imageOpaqueAabbClientRect(img);
    if (!aabbRect || aabbRect.empty) return { leftPercent: 50, topPercent: 100 };
    const leftPercent = (((aabbRect.left + aabbRect.right) / 2 - itemRect.left) / itemRect.width) * 100;
    const topPercent = ((aabbRect.bottom - itemRect.top) / itemRect.height) * 100;
    return {
        leftPercent: clampRange(leftPercent, 0, 100),
        topPercent: clampRange(topPercent, 0, 100),
    };
}

function updateRoomItemScaleControlsAnchor(el, controls, ctx) {
    const anchor = roomItemScaleControlsAnchor(el);
    controls.style.setProperty('--mh-scale-controls-left', `${anchor.leftPercent.toFixed(2)}%`);
    controls.style.setProperty('--mh-scale-controls-top', `${anchor.topPercent.toFixed(2)}%`);
    const img = el?.querySelector?.('.mh-furniture-img');
    if (img && !img.complete && !img.__mhScaleControlsLoadBound) {
        img.__mhScaleControlsLoadBound = true;
        img.addEventListener('load', () => {
            img.__mhScaleControlsLoadBound = false;
            updateRoomItemScaleControls(ctx);
        }, { once: true });
        img.addEventListener('error', () => { img.__mhScaleControlsLoadBound = false; }, { once: true });
    }
}

function pointOverRoomScaleControls(clientX, clientY) {
    const controls = document.getElementById('mhRoomItemScaleControls');
    if (!controls?.classList?.contains('is-visible')) return false;
    return Array.from(controls.querySelectorAll('.mh-room-scale-btn')).some(btn => {
        return pointInRect(clientX, clientY, btn.getBoundingClientRect?.());
    });
}

function pointOverRoomItemPaint(el, clientX, clientY) {
    const imageRect = getRoomItemImageRect(el);
    if (!pointInRect(clientX, clientY, imageRect)) return false;
    const svg = el?.querySelector?.('.mh-furniture-svg svg');
    const painted = pointOverSvgPaint(svg, clientX, clientY);
    if (painted != null) return painted;
    const img = el?.querySelector?.('.mh-furniture-img');
    const imageAabbHit = pointOverImageOpaqueAabb(img, clientX, clientY);
    if (imageAabbHit != null) return imageAabbHit;
    return painted ?? true;
}

function fingerOverRoomItemPaint(el, clientX, clientY) {
    const imageRect = getRoomItemImageRect(el);
    if (!rectIntersectsFinger(clientX, clientY, imageRect)) return false;
    return FINGER_HIT_SAMPLE_POINTS.some(([x, y]) => {
        const sampleX = clientX + x * FINGER_HIT_RADIUS_PX;
        const sampleY = clientY + y * FINGER_HIT_RADIUS_PX;
        return pointOverRoomItemPaint(el, sampleX, sampleY);
    });
}

function getClosestDraggableRoomItem(clientX, clientY) {
    if (pointOverRoomScaleControls(clientX, clientY)) return null;
    let best = null;
    $$(ROOM_ITEM_SELECTOR).forEach(item => {
        if (!canDragRoomItem(item)) return;
        if (!fingerOverRoomItemPaint(item, clientX, clientY)) return;
        const imageRect = getRoomItemImageRect(item);
        const centerX = imageRect.left + imageRect.width / 2;
        const centerY = imageRect.top + imageRect.height / 2;
        const distance = Math.hypot(clientX - centerX, clientY - centerY);
        const zIndex = Number.parseInt(getComputedStyle(item).zIndex, 10) || 0;
        if (!best || distance < best.distance || (distance === best.distance && zIndex > best.zIndex)) {
            best = { item, distance, zIndex };
        }
    });
    return best?.item || null;
}

function makeDragGhost(itemId) {
    const def = ITEM_BY_ID[itemId];
    const size = getFurnitureMeters(def);
    const visualSize = roomMetersToClientPx(size.w, size.h);
    const ghost = document.createElement('div');
    ghost.className = 'mh-furniture-drag-ghost';
    ghost.dataset.itemType = def?.type || 'furniture';
    ghost.style.width = visualSize.width + 'px';
    ghost.style.height = visualSize.height + 'px';
    ghost.innerHTML = furnitureHtml(def);
    document.body.appendChild(ghost);
    return ghost;
}

function foodEnergyValue(item) {
    const stats = item?.stat || {};
    const energy = Object.values(stats).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    return energy || FOOD_EAT_MIN_ENERGY;
}

function foodEatDurationMs(item) {
    const energy = foodEnergyValue(item);
    const ratio = clampRange((energy - FOOD_EAT_MIN_ENERGY) / (FOOD_EAT_MAX_ENERGY - FOOD_EAT_MIN_ENERGY), 0, 1);
    return Math.round(FOOD_EAT_MIN_MS + (FOOD_EAT_MAX_MS - FOOD_EAT_MIN_MS) * ratio);
}

function getFoodServePose(itemId) {
    const petPose = getCurrentPetPose();
    const item = ITEM_BY_ID[itemId];
    const size = getFurnitureMeters(item);
    return {
        x: clampRange(petPose.x + PET_WIDTH_METERS / 2, size.w / 2, ROOM_WIDTH_METERS - size.w / 2),
        y: clampRange(petPose.y + PET_HEIGHT_METERS * 0.42, size.h / 2, ROOM_HEIGHT_METERS - size.h / 2),
        w: size.w,
        h: size.h,
    };
}

function setPetEating(isEating) {
    const petElement = $('mhPet');
    petElement?.classList.toggle('mh-pet-eating', !!isEating);
}

function prepareFoodServingElement(itemId, sourceEl = null) {
    const item = ITEM_BY_ID[itemId];
    if (!item) return null;
    const pose = getFoodServePose(itemId);
    const foodLayer = $('mhFoodLayer');
    const el = sourceEl || document.createElement('div');
    if (!sourceEl) {
        el.className = 'furniture mh-room-furniture mh-serving-food';
        el.dataset.itemId = itemId;
        el.dataset.itemType = 'food';
        foodLayer?.appendChild(el);
    }
    el.innerHTML = servingFoodCutHtml(item);
    el.classList.add('mh-serving-food');
    el.classList.remove('is-dragging', 'selected', 'mh-serving-food-consuming', 'mh-serving-food-dissolve');
    el.dataset.xMeters = String(pose.x);
    el.dataset.yMeters = String(pose.y);
    el.dataset.wMeters = String(pose.w);
    el.dataset.hMeters = String(pose.h);
    el.style.left = roomXToScenePx(pose.x) + 'px';
    el.style.top = metersToPx(pose.y) + 'px';
    el.style.width = metersToPx(pose.w) + 'px';
    el.style.height = metersToPx(pose.h) + 'px';
    el.style.zIndex = String(FOOD_Z_INDEX_BASE + 80);
    el.style.removeProperty('--mh-eat-duration');
    return el;
}

function restoreFoodServingElement(el, item) {
    if (!el) return;
    el.classList.remove('mh-serving-food', 'mh-serving-food-consuming', 'mh-serving-food-dissolve');
    el.innerHTML = furnitureHtml(item);
    el.style.removeProperty('--mh-eat-duration');
}

function setServedFoodCutTiming(el, durationMs) {
    const slices = Array.from(el?.querySelectorAll?.('.mh-serving-food-slice') || []);
    if (!slices.length) return;
    const stepMs = Math.max(180, durationMs / slices.length);
    const sliceMs = Math.min(520, Math.max(260, stepMs * 0.62));
    slices.forEach((slice, index) => {
        slice.style.setProperty('--mh-slice-delay', `${Math.max(0, stepMs * index - 40).toFixed(0)}ms`);
        slice.style.setProperty('--mh-slice-dur', `${sliceMs.toFixed(0)}ms`);
    });
}

function spawnServedFoodPieces(el, item, count = 16) {
    const scene = $('mhPetRoomScene');
    if (!scene || !el) return;
    const sceneRect = scene.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const scale = clientScaleForElement(scene);
    const centerX = (rect.left - sceneRect.left + rect.width / 2) * scale.x;
    const centerY = (rect.top - sceneRect.top + rect.height / 2) * scale.y;
    for (let i = 0; i < count; i++) {
        const piece = document.createElement('span');
        piece.className = 'mh-served-food-piece';
        piece.textContent = item?.emoji || '🍽️';
        piece.style.left = centerX.toFixed(1) + 'px';
        piece.style.top = centerY.toFixed(1) + 'px';
        const pieceX = Math.random() * 150 - 75;
        piece.style.setProperty('--mh-piece-x', pieceX.toFixed(1) + 'px');
        piece.style.setProperty('--mh-piece-hop-x', (pieceX * 0.42).toFixed(1) + 'px');
        piece.style.setProperty('--mh-piece-hop', (24 + Math.random() * 64).toFixed(1) + 'px');
        piece.style.setProperty('--mh-piece-fall', (92 + Math.random() * 132).toFixed(1) + 'px');
        piece.style.setProperty('--mh-piece-size', (10 + Math.random() * 12).toFixed(1) + 'px');
        piece.style.setProperty('--mh-piece-rot', (Math.random() * 420 - 210).toFixed(1) + 'deg');
        piece.style.setProperty('--mh-piece-dur', (0.9 + Math.random() * 0.45).toFixed(2) + 's');
        scene.appendChild(piece);
        piece.addEventListener('animationend', () => piece.remove(), { once: true });
    }
}

function startServedFoodCrumble(el, item, durationMs) {
    if (!el) return null;
    el.style.setProperty('--mh-eat-duration', Math.max(0.5, durationMs / 1000).toFixed(2) + 's');
    setServedFoodCutTiming(el, durationMs);
    el.classList.add('mh-serving-food-consuming');
    spawnServedFoodPieces(el, item, 5);
    const interval = setInterval(() => {
        if (!el.isConnected) {
            clearInterval(interval);
            return;
        }
        spawnServedFoodPieces(el, item, 2 + randInt(0, 2));
    }, 430);
    return interval;
}

function cssTimeToMs(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount)) return 0;
    return raw.endsWith('ms') ? amount : amount * 1000;
}

function servedFoodConsumedDelayMs(el, fallbackMs) {
    const slices = Array.from(el?.querySelectorAll?.('.mh-serving-food-slice') || []);
    const longest = slices.reduce((max, slice) => {
        const style = getComputedStyle(slice);
        const delay = cssTimeToMs(style.getPropertyValue('--mh-slice-delay'));
        const duration = cssTimeToMs(style.getPropertyValue('--mh-slice-dur'));
        return Math.max(max, delay + duration);
    }, 0);
    return Math.max(180, longest || Number(fallbackMs) || 0) + 80;
}

function waitForServedFoodConsumed(el, fallbackMs) {
    const slices = Array.from(el?.querySelectorAll?.('.mh-serving-food-slice') || []);
    const fallbackDelay = servedFoodConsumedDelayMs(el, fallbackMs);
    if (!el || !slices.length) {
        return new Promise(resolve => setTimeout(resolve, fallbackDelay));
    }
    return new Promise((resolve) => {
        let done = false;
        let remaining = slices.length;
        let fallback = null;
        const cleanup = () => {
            slices.forEach(slice => slice.removeEventListener('animationend', onSliceEnd));
            if (fallback) clearTimeout(fallback);
        };
        const finish = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
        };
        const onSliceEnd = (event) => {
            if (event.target !== event.currentTarget) return;
            remaining -= 1;
            if (remaining <= 0) finish();
        };
        slices.forEach(slice => slice.addEventListener('animationend', onSliceEnd));
        fallback = setTimeout(finish, fallbackDelay);
    });
}

function dissolveServedFood(el, item) {
    if (!el) return;
    spawnServedFoodPieces(el, item, 8);
    el.classList.add('mh-serving-food-dissolve');
    setTimeout(() => el.remove(), 180);
}

async function runFeedServingSequence(itemId, source, ctx) {
    const item = ITEM_BY_ID[itemId];
    if (!item) return false;
    const eatingMs = foodEatDurationMs(item);
    const sequenceStartedAt = Date.now();
    const servingEl = prepareFoodServingElement(itemId, source.el);
    const eaten = await ctx.callbacks.onFeedItem?.(itemId, {
        ...source,
        delayEffectsMs: 0,
        sayDelayMs: eatingMs,
        skipNotify: true,
    });
    if (!eaten) {
        if (source.el) restoreFoodServingElement(servingEl, item);
        else servingEl?.remove();
        return false;
    }
    setPetEating(true);
    soundManager.playFoodEat();
    const crumbleInterval = startServedFoodCrumble(servingEl, item, eatingMs);
    waitForServedFoodConsumed(servingEl, eatingMs).then(() => {
        if (crumbleInterval) clearInterval(crumbleInterval);
        setPetEating(false);
        dissolveServedFood(servingEl, item);
        const sayVisibleAt = sequenceStartedAt + eatingMs;
        const completeDelayMs = Math.max(950, sayVisibleAt + FEED_SAY_MIN_VISIBLE_MS - Date.now());
        setTimeout(() => ctx.callbacks.onFeedComplete?.(), completeDelayMs);
    });
    return true;
}

function isPetVisibleForBath(petEl = $('mhPet')) {
    const stage = $('mhStage');
    return isPetVisibleInStage(petEl, stage);
}

async function runBathSequence(ctx) {
    if (bathAnimationRunning) return false;
    if (!isPetVisibleForBath()) {
        showToast('宠物在画面里才可以洗澡哦', 'info', 1400);
        return false;
    }
    const applied = await ctx.callbacks.onAction?.('bath', { skipNotify: true });
    if (!applied) return false;
    scanAndMount();
    const bathedPet = state.pets[state.currentPetId];
    const petEl = $('mhPet');
    if (!isPetVisibleForBath(petEl)) return true;
    bathAnimationRunning = true;
    roomPetMode = 'engaged';
    clearRoomAgentTimer();
    setPetRoomMotion('idle');
    petEl.classList.add('mh-pet-bathing');
    createBathSequenceOverlay({ stage: $('mhStage'), petEl });
    soundManager.playBathCue('start');
    const cueTimers = [1800, 3400, 5100].map(delay => setTimeout(() => soundManager.playBathCue('wash'), delay));
    cueTimers.push(setTimeout(() => soundManager.playBathCue('sparkle'), 7700));
    setTimeout(() => {
        cueTimers.forEach(timer => clearTimeout(timer));
        $('mhPet')?.classList.remove('mh-pet-bathing');
        bathAnimationRunning = false;
        setPetRoomMotion('idle');
        const currentPetEl = $('mhPet');
        if (currentPetEl && isPetVisibleForBath(currentPetEl)) {
            playPetHappy(currentPetEl, bathedPet, { holdAnimMs: BATH_COMPLETE_FEEDBACK_MS });
            say(BATH_COMPLETE_LINES[randInt(0, BATH_COMPLETE_LINES.length - 1)], BATH_COMPLETE_FEEDBACK_MS);
        }
    }, BATH_SEQUENCE_MS);
    return true;
}

function moveDragGhost(ghost, clientX, clientY) {
    if (!ghost) return;
    ghost.style.left = clientX + 'px';
    ghost.style.top = clientY + 'px';
}

function playRoomItemDropSoundAsync() {
    setTimeout(() => soundManager.playItemPlace(), 0);
}

function currentRoomKey(ctx = null) {
    return state.currentRoom || ctx?.pet?.activeRoom || 'living';
}

function ensureRoomItemScaleControls(ctx) {
    const stage = ctx.stage;
    if (!stage) return null;
    let controls = document.getElementById('mhRoomItemScaleControls');
    if (controls) return controls;
    controls = document.createElement('div');
    controls.id = 'mhRoomItemScaleControls';
    controls.className = 'mh-room-scale-controls';
    controls.innerHTML = `
        <button type="button" class="mh-room-scale-btn" data-room-scale="down" aria-label="缩小物品" title="缩小">−</button>
        <button type="button" class="mh-room-scale-btn" data-room-scale="up" aria-label="放大物品" title="放大">+</button>
    `;
    controls.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    controls.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-room-scale]');
        if (!btn || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        scaleSelectedRoomItem(ctx, btn.dataset.roomScale === 'up' ? 1 : -1);
    });
    stage.appendChild(controls);
    return controls;
}

function getSelectedRoomItemEl(ctx = null) {
    const selected = selectedRoomItem;
    if (!selected || selected.roomKey !== currentRoomKey(ctx)) return null;
    return $$(ROOM_ITEM_SELECTOR).find(item => item.dataset.fidx === String(selected.idx)) || null;
}

function getRoomItemScale(def, itemOrEl) {
    const base = getFurnitureMeters(def);
    const fieldSize = Number(itemOrEl?.fieldSize ?? itemOrEl?.dataset?.fieldSize);
    if (Number.isFinite(fieldSize) && fieldSize > 0) return clampRange(fieldSize / getItemFieldSize(def), ROOM_ITEM_MIN_SCALE, ROOM_ITEM_MAX_SCALE);
    const w = Number(itemOrEl?.wMeters ?? itemOrEl?.dataset?.wMeters) || base.w;
    const h = Number(itemOrEl?.hMeters ?? itemOrEl?.dataset?.hMeters) || base.h;
    const scaleW = base.w > 0 ? w / base.w : 1;
    const scaleH = base.h > 0 ? h / base.h : 1;
    return clampRange((scaleW + scaleH) / 2, ROOM_ITEM_MIN_SCALE, ROOM_ITEM_MAX_SCALE);
}

function updateRoomItemScaleControls(ctx) {
    const controls = ensureRoomItemScaleControls(ctx);
    if (!controls) return;
    const el = getSelectedRoomItemEl(ctx);
    if (!el || !state.isDecorMode) {
        controls.classList.remove('is-visible');
        ctx.stage?.appendChild(controls);
        return;
    }
    const def = ITEM_BY_ID[el.dataset.itemId];
    if (!def) {
        controls.classList.remove('is-visible');
        ctx.stage?.appendChild(controls);
        return;
    }
    const scale = getRoomItemScale(def, el);
    if (controls.parentElement !== el) el.appendChild(controls);
    updateRoomItemScaleControlsAnchor(el, controls, ctx);
    controls.classList.add('is-visible');
    controls.querySelector('[data-room-scale="down"]')?.toggleAttribute('disabled', scale <= ROOM_ITEM_MIN_SCALE + 0.001);
    controls.querySelector('[data-room-scale="up"]')?.toggleAttribute('disabled', scale >= ROOM_ITEM_MAX_SCALE - 0.001);
}

function clearRoomItemSelection(ctx = null) {
    selectedRoomItem = null;
    $$(ROOM_ITEM_SELECTOR).forEach(item => item.classList.remove('selected'));
    if (ctx) updateRoomItemScaleControls(ctx);
}

function selectRoomItem(el, ctx) {
    if (!el || !state.isDecorMode) return;
    const idx = parseInt(el.dataset.fidx, 10);
    if (!Number.isInteger(idx)) return;
    ctx.selectedTrayItem = null;
    ctx.dock?.querySelectorAll('[data-tray-item]').forEach(item => item.style.outline = '');
    $$(ROOM_ITEM_SELECTOR).forEach(item => item.classList.remove('selected'));
    el.classList.add('selected');
    selectedRoomItem = { roomKey: currentRoomKey(ctx), idx };
    updateRoomItemScaleControls(ctx);
}

function restoreRoomItemSelection(ctx) {
    const el = getSelectedRoomItemEl(ctx);
    if (el && state.isDecorMode) el.classList.add('selected');
    else selectedRoomItem = null;
    updateRoomItemScaleControls(ctx);
}

function scaleSelectedRoomItem(ctx, direction) {
    const el = getSelectedRoomItemEl(ctx);
    if (!el || !state.isDecorMode) return;
    const idx = parseInt(el.dataset.fidx, 10);
    const roomKey = currentRoomKey(ctx);
    const layout = getLayout(ctx.pet.id, roomKey) || [];
    const placed = layout[idx];
    const def = ITEM_BY_ID[placed?.itemId || el.dataset.itemId];
    if (!placed || !def) return;
    const base = getFurnitureMeters(def);
    const currentScale = getRoomItemScale(def, placed);
    const factor = direction > 0 ? ROOM_ITEM_SCALE_STEP : 1 / ROOM_ITEM_SCALE_STEP;
    const nextScale = clampRange(currentScale * factor, ROOM_ITEM_MIN_SCALE, ROOM_ITEM_MAX_SCALE);
    if (Math.abs(nextScale - currentScale) < 0.001) return;
    const nextW = clampRange(base.w * nextScale, 0.2, 5);
    const nextH = clampRange(base.h * nextScale, 0.2, 2.4);
    const nextFieldSize = clampRange(getItemFieldSize(def) * nextScale, 0.2, 5);
    el.dataset.fieldSize = String(nextFieldSize);
    el.dataset.wMeters = String(nextW);
    el.dataset.hMeters = String(nextH);
    applyMeterElementStyle(el);
    updateRoomItemScaleControls(ctx);
    playRoomItemDropSoundAsync();
    const movePromise = ctx.callbacks.onMoveItem?.(
        idx,
        clampRange(Number(el.dataset.xMeters) || placed.x, 0, ROOM_WIDTH_METERS),
        clampRange(Number(el.dataset.yMeters) || placed.y, 0, ROOM_HEIGHT_METERS),
        roomKey,
        { coord: 'roomMeters', fieldSize: nextFieldSize, skipSound: true }
    );
    if (movePromise && typeof movePromise.catch === 'function') movePromise.catch(() => {});
}

function isPointOverDock(clientX, clientY) {
    if (!isRoomPlacementMode()) return false;
    const dock = $('mhDock');
    const rect = dock?.getBoundingClientRect?.();
    return pointInRect(clientX, clientY, rect);
}

function setDockDeleteTargetVisible(visible) {
    const dock = $('mhDock');
    const target = $('mhRoomDockDeleteTarget');
    dock?.classList.toggle('mh-room-dock-delete-visible', !!visible);
    dock?.classList.toggle('mh-room-dock-delete-active', !!visible);
    if (target) target.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function currentPetFocusPoint() {
    const petElement = $('mhPet');
    const stageElement = $('mhStage');
    const stageInner = $('mhStageInner');
    const sceneElement = $('mhPetRoomScene');
    if (!petElement || !stageElement || !stageInner || !sceneElement
        || !stageElement.clientWidth || !stageElement.clientHeight
        || !stageInner.clientWidth || !stageInner.clientHeight) {
        return { x: 50, y: 55 };
    }
    const petLeft = sceneElement.offsetLeft + roomPan + petElement.offsetLeft;
    const petTop = sceneElement.offsetTop + petElement.offsetTop;
    const petRight = petLeft + petElement.offsetWidth;
    const petBottom = petTop + petElement.offsetHeight;
    const isVisible = petRight > 0
        && petLeft < stageElement.clientWidth
        && petBottom > 0
        && petTop < stageElement.clientHeight;
    if (!isVisible) return { x: 50, y: 55 };
    const centerX = ((petLeft + petElement.offsetWidth / 2) / stageInner.clientWidth) * 100;
    const centerY = ((petTop + petElement.offsetHeight / 2) / stageInner.clientHeight) * 100;
    return { x: centerX, y: centerY };
}

function activeLayouts() {
    return isVisitingMode() ? (state.visitingMode?.remoteLayouts || {}) : (state.layouts || {});
}

function activeLayout(roomId) {
    return activeLayouts()[roomId] || [];
}

function visitingRoomOwnerPet(fallbackPet) {
    return isVisitingMode() ? (state.visitingMode?.friendPet || fallbackPet) : fallbackPet;
}

function visitingRoomCompanionPetsHtml(currentPet, roomId, currentPose = null) {
    const hostPet = visitingRoomOwnerPet(currentPet);
    if (!currentPet || currentPet.id === hostPet?.id) return '';
    const occupied = currentPose ? [{ x: currentPose.x, y: currentPose.y }] : [];
    const pose = repelRoomPetPose({ x: 1.15, y: PET_START_Y_METERS }, occupied, `${roomId}::visit-player-pet::${currentPet.id || 'current'}`);
    const face = 'scaleX(1)';
    const zIndex = getRoomItemZIndex({ x: pose.x, y: pose.y, w: PET_WIDTH_METERS, h: PET_HEIGHT_METERS }, 3, 'pet');
    return `
        <div class="pet-sprite mh-released-room-pet mh-visit-room-guest-pet" data-released-room-pet="${escapeHtml(currentPet.id || 'current')}" data-x-meters="${pose.x}" data-y-meters="${pose.y}" data-w-meters="${PET_WIDTH_METERS}" data-h-meters="${PET_HEIGHT_METERS}" style="${meterStyle({ x: pose.x, y: pose.y, w: PET_WIDTH_METERS, h: PET_HEIGHT_METERS })};z-index:${zIndex};transform:${face}">
            <div style="width:100%;height:100%">${petArtHtml(currentPet, { alt: displayPetName(currentPet), requireProcessedTexture: true })}</div>
        </div>
    `;
}

function roomCompanionPetsHtml(currentPet, roomId, currentPose = null) {
    if (state.isDecorMode) return '';
    if (isVisitingMode()) return visitingRoomCompanionPetsHtml(currentPet, roomId, currentPose);
    const isFindingInRoom = state.activePetRoomFocusPose?.roomId === roomId
        && state.activePetRoomFocusPose?.targetPetId;
    const petPose = currentPose || getCurrentPetPose();
    const occupied = isFindingInRoom ? [] : [{ x: petPose.x, y: petPose.y }];
    return roomCompanionPetIds(currentPet, roomId)
        // 按需获取 pet.json（唯一来源）：未加载时 getPet 后台读取并在就绪后触发重渲染。
        .map(id => getPet(id))
        .filter((pet) => {
            if (!pet || pet.id === currentPet?.id || !hasRenderablePetTexture(pet)) return false;
            return getGeneratedPetLocation(pet).kind === 'room';
        })
        .map((pet) => {
            const home = getGeneratedPetLocation(pet);
            const pose = repelRoomPetPose({ x: home.xMeters, y: home.yMeters }, occupied, `${roomId}::room-companion-pet::${pet.id}`);
            occupied.push(pose);
            const { x, y } = pose;
            const face = home.face === 'left' ? 'scaleX(-1)' : 'scaleX(1)';
            const zIndex = getRoomItemZIndex({ x, y, w: PET_WIDTH_METERS, h: PET_HEIGHT_METERS }, 3, 'pet');
            return `
                <div class="pet-sprite mh-released-room-pet" data-released-room-pet="${escapeHtml(pet.id)}" data-x-meters="${x}" data-y-meters="${y}" data-w-meters="${PET_WIDTH_METERS}" data-h-meters="${PET_HEIGHT_METERS}" style="${meterStyle({ x, y, w: PET_WIDTH_METERS, h: PET_HEIGHT_METERS })};z-index:${zIndex};transform:${face}">
                    <div style="width:100%;height:100%">${petArtHtml(pet, { alt: displayPetName(pet), requireProcessedTexture: true })}</div>
                </div>
            `;
        }).join('');
}

function roomCompanionPetIds(currentPet, roomId) {
    return (state.petOrder || []).filter((id) => {
        if (!id || id === currentPet?.id) return false;
        const home = getGeneratedPetLocation(state.pets[id] || id);
        return home.kind === 'room' && home.id === roomId;
    });
}

// 根据当前激活房屋（field 中房间数最多的房屋）解析合法房间。无激活房屋时回退到默认 1 间。
function getUnlockedRooms() {
    const ids = getActiveHouseRoomIds(activeLayouts());
    const idSet = new Set(ids);
    // 保持 CONFIG.rooms 中的原顺序
    return CONFIG.rooms.filter(r => idSet.has(r.id));
}

function resolveActiveRoom(pet) {
    const unlocked = getUnlockedRooms();
    if (unlocked.length === 0) return CONFIG.rooms[0];
    const wanted = state.currentRoom || pet?.activeRoom;
    const found = unlocked.find(r => r.id === wanted);
    if (found) return found;
    // currentRoom 不在解锁列表 → 自动切换到第一间可用房间
    state.currentRoom = unlocked[0].id;
    if (pet) pet.activeRoom = unlocked[0].id;
    return unlocked[0];
}

export const petLevel = {
    id: 'pet',
    index: 2,
    wipeColor: 'linear-gradient(180deg, #fde68a 0%, #d4a44a 36%, #c4baa8 40%, #c8c0b5 100%)',
    minCamera: 0.65,    // 拉远 → zoomOut 回 field
    maxCamera: 1.55,    // 推近 → zoomIn 进 cell
    bestCamera: 1.0,
    minVisualScale: 0.9,
    enterFromAbove: 0.85,
    enterFromInner: 1.5,

    cameraFocus(zoom) {
        const focusStart = this.bestCamera ?? ((this.minCamera + this.maxCamera) / 2);
        const weight = Math.max(0, Math.min(1, (zoom - focusStart) / (this.maxCamera - focusStart)));
        return { ...currentPetFocusPoint(), weight };
    },

    stageHtml(pet) {
        const roomPet = visitingRoomOwnerPet(pet);
        const room = resolveActiveRoom(roomPet);
        const petPose = getCurrentPetPose();
        const layout = (isVisitingMode() ? activeLayout(room.id) : (getLayout(pet.id, room.id) || []))
            .map((item, index) => ({ item, index }))
            .filter(entry => entry.item?.coord === 'roomMeters');
        const furnitureLayout = layout.filter(({ item }) => ITEM_BY_ID[item.itemId]?.type !== 'food');
        const foodLayout = layout.filter(({ item }) => ITEM_BY_ID[item.itemId]?.type === 'food');
        return `
            <div id="mhPetRoomFloor" class="mh-pet-room-floor" aria-hidden="true"></div>
            <div id="mhPetRoomScene" class="mh-pet-room-scene" style="width:${metersToPx(ROOM_SCENE_WIDTH_METERS)}px" data-room-width-meters="${ROOM_WIDTH_METERS}" data-room-height-meters="${ROOM_HEIGHT_METERS}" data-room-overdraw-meters="${ROOM_SIDE_OVERDRAW_METERS}">
                <div class="mh-pet-room-bg" style="background:${room.bg}"></div>
                <div class="mh-pet-room-wall" aria-hidden="true"></div>

                <div id="mhFurnitureLayer" class="mh-furniture-layer">
                    ${furnitureLayout.map(({ item: it, index }) => roomItemHtml(it, index)).join('')}
                </div>

                <div class="pet-sprite" id="mhPet" data-x-meters="${petPose.x}" data-y-meters="${petPose.y}" data-w-meters="${PET_WIDTH_METERS}" data-h-meters="${PET_HEIGHT_METERS}" style="${meterStyle({ x: petPose.x, y: petPose.y, w: PET_WIDTH_METERS, h: PET_HEIGHT_METERS })}">
                    <div style="width:100%;height:100%">${petArtHtml(roomPet, { alt: displayPetName(roomPet), requireProcessedTexture: true })}</div>
                </div>

                ${roomCompanionPetsHtml(pet, room.id, petPose)}

                <div id="mhFoodLayer" class="mh-food-layer">
                    ${foodLayout.map(({ item: it, index }) => roomItemHtml(it, index)).join('')}
                </div>
            </div>

        `;
    },

    bindStage(pet, ctx) {
        const roomPet = visitingRoomOwnerPet(pet);
        const room = resolveActiveRoom(roomPet);
        const petEl = $('mhPet');
        petEl?.classList.add('mh-pet-room-instant');
        applyRoomMeterLayout();
        requestAnimationFrame(() => {
            if (isRoomPlacementMode()) {
                applyRoomPan();
            } else {
                roomPetMode = 'follow';
                clearRoomAgentTimer();
                const focusPose = state.activePetRoomFocusPose?.roomId === room.id ? state.activePetRoomFocusPose : null;
                focusPetInRoom(focusPose || undefined);
                if (!focusPose || !focusPose.targetPetId || state.pets[focusPose.targetPetId]) state.activePetRoomFocusPose = null;
                setPetRoomMotion('idle');
            }
            requestAnimationFrame(() => {
                petEl?.classList.remove('mh-pet-room-instant');
            });
        });
        window.addEventListener('resize', applyRoomPan, { passive: true });
        bindRoomPan(ctx);
        $$(ROOM_ITEM_SELECTOR).forEach(el => {
            bindFurnitureDrag(el, ctx);
        });
        ensureRoomItemScaleControls(ctx);
        restoreRoomItemSelection(ctx);
        bindPetDrag(petEl);
        if (petEl) petEl.onclick = () => {
            if (isRoomPlacementMode()) return;
            if (isVisitingMode()) {
                playPetClickFeedback(petEl, roomPet);
                return;
            }
            if (isPetInteractionBlocked(pet)) { showSleepingBlocked(pet); return; }
            ctx.onPetTouch?.(petEl, pet);
            playPetClickFeedback(petEl, pet);
        };
        $$('.mh-released-room-pet').forEach(el => {
            el.onclick = (e) => {
                if (isRoomPlacementMode()) return;
                e.stopPropagation();
                const releasedPet = state.pets[el.dataset.releasedRoomPet];
                if (isPetInteractionBlocked(releasedPet)) { showSleepingBlocked(releasedPet); return; }
                if (releasedPet) playPetClickFeedback(el, releasedPet);
            };
        });
    },

    dockHtml(pet) {
        const room = resolveActiveRoom(visitingRoomOwnerPet(pet));
        const unlockedRooms = getUnlockedRooms();
        const visibleRooms = unlockedRooms.length ? unlockedRooms : [CONFIG.rooms[0]];
        const inv = state.inventory || {};
        return `
            <div class="mh-dock-row mh-scroll-x dock-tab-row ${isRoomPlacementMode() ? 'has-decor-done' : ''}" id="mhRoomTabs">
                ${visibleRooms.map(r => `
                    <button type="button" class="btn-secondary dock-tab ${r.id === room.id ? 'active' : ''}" data-room="${r.id}">
                        ${r.emoji} ${escapeHtml(r.name)}
                    </button>
                `).join('')}
            </div>
            ${isRoomPlacementMode() ? `<button type="button" class="mh-decor-done-btn mh-room-mode-toggle" id="${state.isFeedMode ? 'mhFeedDoneBtn' : 'mhDecorDoneBtn'}">${escapeHtml(t('exitDecor'))}</button>` : ''}
            ${isRoomPlacementMode() ? `<button type="button" class="mh-room-dock-delete-target" id="mhRoomDockDeleteTarget" aria-hidden="true" tabindex="-1">🗑️ 收回背包</button>` : ''}
            ${state.isDecorMode ? renderDecorTray(inv) : state.isFeedMode ? renderFeedTray(inv) : renderActionTray(pet)}
        `;
    },

    bindDock(pet, ctx) {
        const dock = ctx.dock;
        if (!dock) return;

        const activateDockTab = (target, event) => {
            const roomBtn = target.closest?.('[data-room]');
            if (roomBtn && dock.contains(roomBtn)) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                dock.__mhPetDockTabHandledAt = Date.now();
                ctx.callbacks.onSwitchRoom?.(roomBtn.dataset.room);
                return true;
            }

            if (target.closest?.('#mhDecorBtn, #mhDecorDoneBtn')) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                const btn = target.closest?.('#mhDecorBtn, #mhDecorDoneBtn');
                if (isDockButtonDisabled(btn)) { showDockDisabledToast(btn); return true; }
                if (isPetInteractionBlocked(pet)) { showSleepingBlocked(pet); return true; }
                dock.__mhPetDockTabHandledAt = Date.now();
                ctx.callbacks.onToggleDecor?.(!state.isDecorMode);
                return true;
            }
            if (target.closest?.('#mhFeedBtn, #mhFeedDoneBtn')) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                const btn = target.closest?.('#mhFeedBtn, #mhFeedDoneBtn');
                if (isDockButtonDisabled(btn)) { showDockDisabledToast(btn); return true; }
                if (isPetInteractionBlocked(pet)) { showSleepingBlocked(pet); return true; }
                dock.__mhPetDockTabHandledAt = Date.now();
                ctx.callbacks.onToggleFeed?.(!state.isFeedMode);
                return true;
            }
            return false;
        };

        if (dock.__mhPetDockTabPointerDown) {
            dock.removeEventListener('pointerdown', dock.__mhPetDockTabPointerDown, true);
        }
        if (dock.__mhPetDockTabPointerUp) {
            dock.removeEventListener('pointerup', dock.__mhPetDockTabPointerUp, true);
            dock.removeEventListener('pointercancel', dock.__mhPetDockTabPointerUp, true);
        }
        if (dock.__mhPetDockTabTouchStart) {
            dock.removeEventListener('touchstart', dock.__mhPetDockTabTouchStart, true);
        }
        if (dock.__mhPetDockTabTouchEnd) {
            dock.removeEventListener('touchend', dock.__mhPetDockTabTouchEnd, true);
            dock.removeEventListener('touchcancel', dock.__mhPetDockTabTouchCancel, true);
        }
        dock.__mhPetDockTabPointer = null;
        dock.__mhPetDockTabPointerDown = (e) => {
            const tab = e.target.closest?.('.dock-tab, .mh-room-mode-toggle');
            if (!tab || !dock.contains(tab)) return;
            if (tab.classList.contains('mh-room-mode-toggle')) e.preventDefault();
            dock.__mhPetDockTabPointer = {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                target: tab,
            };
        };
        dock.__mhPetDockTabPointerUp = (e) => {
            const start = dock.__mhPetDockTabPointer;
            dock.__mhPetDockTabPointer = null;
            if (!start || start.id !== e.pointerId) return;
            const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8;
            if (!moved && Date.now() - (dock.__mhPetDockTabHandledAt || 0) >= 250) activateDockTab(start.target, e);
        };
        dock.addEventListener('pointerdown', dock.__mhPetDockTabPointerDown, true);
        dock.addEventListener('pointerup', dock.__mhPetDockTabPointerUp, true);
        dock.addEventListener('pointercancel', dock.__mhPetDockTabPointerUp, true);

        dock.__mhPetDockTabTouch = null;
        dock.__mhPetDockTabTouchStart = (e) => {
            const tab = e.target.closest?.('.dock-tab, .mh-room-mode-toggle');
            const touch = e.changedTouches?.[0] || e.touches?.[0];
            if (!tab || !dock.contains(tab) || !touch) return;
            if (tab.classList.contains('mh-room-mode-toggle')) e.preventDefault();
            const scroller = tab.closest?.('.mh-scroll-x');
            dock.__mhPetDockTabTouch = {
                id: touch.identifier,
                x: touch.clientX,
                y: touch.clientY,
                target: tab,
                scroller,
                scrollLeft: scroller?.scrollLeft || 0,
            };
        };
        dock.__mhPetDockTabTouchEnd = (e) => {
            const start = dock.__mhPetDockTabTouch;
            if (!start) return;
            const touch = Array.from(e.changedTouches || []).find(touchPoint => touchPoint.identifier === start.id);
            dock.__mhPetDockTabTouch = null;
            if (!touch || Date.now() - (dock.__mhPetDockTabHandledAt || 0) < 250) return;
            const scrolled = !!start.scroller && (
                Math.abs((start.scroller.scrollLeft || 0) - start.scrollLeft) > 1 ||
                start.scroller.__mhTouchScrollMoved
            );
            const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8;
            if (!moved && !scrolled) activateDockTab(start.target, e);
        };
        dock.__mhPetDockTabTouchCancel = () => {
            dock.__mhPetDockTabTouch = null;
        };
        dock.addEventListener('touchstart', dock.__mhPetDockTabTouchStart, true);
        dock.addEventListener('touchend', dock.__mhPetDockTabTouchEnd, true);
        dock.addEventListener('touchcancel', dock.__mhPetDockTabTouchCancel, true);

        if (dock.__mhPetDockTabClick) {
            dock.removeEventListener('click', dock.__mhPetDockTabClick, true);
        }
        dock.__mhPetDockTabClick = (e) => {
            const scroller = e.target.closest?.('.mh-scroll-x');
            if (Date.now() - (scroller?.__mhDragScrolledAt || 0) < 250) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (Date.now() - (dock.__mhPetDockTabHandledAt || 0) < 250) {
                e.stopPropagation();
                return;
            }
            activateDockTab(e.target, e);
        };
        dock.addEventListener('click', dock.__mhPetDockTabClick, true);

        dock.querySelectorAll('[data-action]').forEach(el => {
            el.onclick = async () => {
                if (isDockButtonDisabled(el)) { showDockDisabledToast(el); return; }
                const k = el.dataset.action;
                if (isVisitingMode()) {
                    if (k === 'visit-pet-wave') showToast('宠物和好友伙伴开心互动了一会儿。', 'success', 1600);
                    else if (k === 'visit-pet-snack') showToast('大家分享了星球点心。', 'success', 1600);
                    else if (k === 'visit-pet-field') ctx.zoomOut?.();
                    return;
                }
                if (isPetInteractionBlocked(pet) && k !== 'sleep') { showSleepingBlocked(pet); return; }
                if (k === 'play') { ctx.callbacks.onNav?.('minigames'); return; }
                if (k === 'help') { ctx.callbacks.onNav?.('help'); return; }
                if (k === 'hatching') { ctx.callbacks.onNav?.('hatching'); return; }
                if (k === 'bath') { await runBathSequence(ctx); return; }
                ctx.callbacks.onAction?.(k);
            };
        });

        dock.querySelectorAll('[data-room-shop]').forEach(el => {
            el.onclick = (e) => {
                e.preventDefault?.();
                e.stopPropagation?.();
                setShopFilter(el.dataset.roomShop || (state.isFeedMode ? 'food' : 'indoor'));
                suppressShopInitialClick();
                ctx.callbacks.onNav?.('shop', { preserveRoomMode: true });
            };
        });

        dock.querySelectorAll('[data-tray-item]').forEach(el => {
            el.onclick = () => {
                if (Date.now() - (el.__mhTrayTapHandledAt || 0) < 250) return;
                clearRoomItemSelection(ctx);
                dock.querySelectorAll('[data-tray-item]').forEach(x => x.style.outline = '');
                ctx.selectedTrayItem = el.dataset.trayItem;
                if (!state.isFeedMode) el.style.outline = '2px solid var(--accent)';
                showRoomDragHint(ITEM_BY_ID[el.dataset.trayItem]?.type, 'tray');
            };
            bindTrayDrag(el, ctx);
        });
    },

    onEnter() {
        // stage class for decor mode is set by orchestrator based on state.isDecorMode
    },

    onLeave() {
        getCurrentPetPose();
        stopPetWalk();
        window.removeEventListener('resize', applyRoomPan);
    },
};

function bindRoomPan(ctx) {
    const stage = ctx.stage;
    const scene = $('mhPetRoomScene');
    if (!stage || !scene || stage.__mhPetRoomPanBound) return;
    stage.__mhPetRoomPanBound = true;
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
        if (bathAnimationRunning) return;
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('button, a, input, textarea, select, [contenteditable="true"], [data-tray-item]')) return;
        if (isRoomPlacementMode() && e.target.closest?.('.furniture') && getClosestDraggableRoomItem(e.clientX, e.clientY)) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: roomPan, active: false };
    });
    stage.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (bathAnimationRunning) {
            drag = null;
            try { stage.releasePointerCapture?.(e.pointerId); } catch {}
            return;
        }
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.active) {
            if (Math.abs(dx) < DRAG_PLACE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
            drag.active = true;
            clearRoomItemSelection(ctx);
            stage.setPointerCapture?.(e.pointerId);
        }
        e.preventDefault();
        const scale = clientScaleForElement(stage);
        roomPan = drag.pan + dx * scale.x;
        applyRoomPan();
    });
    const end = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (drag.active) {
            stage.releasePointerCapture?.(e.pointerId);
            stage.__mhPetRoomPannedAt = Date.now();
        }
        drag = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', (e) => {
        if (Date.now() - (stage.__mhPetRoomPannedAt || 0) > 260) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
}

function bindFurnitureDrag(el, ctx) {
    let drag = null;
    el.addEventListener('click', () => {
        if (isRoomPlacementMode()) return;
        if (Date.now() - (ctx.stage?.__mhPetRoomPannedAt || 0) < 260) return;
        engagePetWithFurniture(el);
    });
    el.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('.mh-room-scale-controls')) return;
        const targetEl = getClosestDraggableRoomItem(e.clientX, e.clientY);
        if (!targetEl || !canDragRoomItem(targetEl)) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (state.isDecorMode) clearRoomItemSelection(ctx);
        drag = {
            el: targetEl,
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            startXMeters: Number(targetEl.dataset.xMeters) || 0,
            startYMeters: Number(targetEl.dataset.yMeters) || 0,
            moved: false,
            idx: parseInt(targetEl.dataset.fidx, 10),
        };
        el.setPointerCapture?.(e.pointerId);
        targetEl.classList.add('is-dragging');
        setRoomItemDragElevation(targetEl, true);
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const targetEl = drag.el;
        const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
        if (dist < DRAG_PLACE_THRESHOLD && !drag.moved) return;
        drag.moved = true;
        const overDock = isPointOverDock(e.clientX, e.clientY);
        setDockDeleteTargetVisible(overDock);
        targetEl.classList.toggle('will-discard', overDock);
        const delta = clientDeltaToRoomMeters(e.clientX - drag.x, e.clientY - drag.y);
        const pos = {
            x: clampRange(drag.startXMeters + delta.x, 0, ROOM_WIDTH_METERS),
            y: clampRange(drag.startYMeters + delta.y, 0, ROOM_HEIGHT_METERS),
        };
        targetEl.dataset.xMeters = String(pos.x);
        targetEl.dataset.yMeters = String(pos.y);
        targetEl.style.left = roomXToScenePx(pos.x) + 'px';
        targetEl.style.top = metersToPx(pos.y) + 'px';
        applyRoomItemZIndex(targetEl, {
            ...pos,
            h: Number(targetEl.dataset.hMeters) || 0,
        });
    });
    const end = async (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const targetEl = drag.el;
        e.preventDefault();
        e.stopPropagation();
        el.releasePointerCapture?.(e.pointerId);
        targetEl.classList.remove('is-dragging');
        targetEl.classList.remove('will-discard');
        setRoomItemDragElevation(targetEl, false);
        setDockDeleteTargetVisible(false);
        if (drag.moved) {
            targetEl.__mhRoomItemDraggedAt = Date.now();
            if (isPointOverDock(e.clientX, e.clientY)) {
                targetEl.remove();
                clearRoomItemSelection(ctx);
                if (state.isDecorMode) playRoomItemDropSoundAsync();
                await ctx.callbacks.onRemoveItem?.(drag.idx);
                drag = null;
                return;
            }
            const delta = clientDeltaToRoomMeters(e.clientX - drag.x, e.clientY - drag.y);
            const pos = {
                x: clampRange(drag.startXMeters + delta.x, 0, ROOM_WIDTH_METERS),
                y: clampRange(drag.startYMeters + delta.y, 0, ROOM_HEIGHT_METERS),
            };
            const layout = getLayout(ctx.pet.id, state.currentRoom || ctx.pet.activeRoom || 'living') || [];
            const itemId = layout[drag.idx]?.itemId || targetEl.dataset.itemId;
            if (targetEl.dataset.itemType === 'food' && pointOverPet(e.clientX, e.clientY)) {
                const eaten = await runFeedServingSequence(itemId, { source: 'layout', index: drag.idx, el: targetEl }, ctx);
                if (!eaten) {
                    targetEl.dataset.xMeters = String(drag.startXMeters);
                    targetEl.dataset.yMeters = String(drag.startYMeters);
                    targetEl.style.left = roomXToScenePx(drag.startXMeters) + 'px';
                    targetEl.style.top = metersToPx(drag.startYMeters) + 'px';
                    applyRoomItemZIndex(targetEl, {
                        y: drag.startYMeters,
                        h: Number(targetEl.dataset.hMeters) || 0,
                    });
                }
                drag = null;
                return;
            }
            const def = ITEM_BY_ID[itemId];
            if (state.isDecorMode) playRoomItemDropSoundAsync();
            ctx.callbacks.onMoveItem?.(drag.idx, pos.x, pos.y, undefined, {
                coord: 'roomMeters',
                fieldSize: Number(targetEl.dataset.fieldSize) || getItemFieldSize(def),
                skipSound: state.isDecorMode,
            });
            clearRoomItemSelection(ctx);
        } else if (e.type === 'pointerup' && state.isDecorMode) {
            selectRoomItem(targetEl, ctx);
            showRoomDragHint(targetEl.dataset.itemType, 'layout');
        } else if (e.type === 'pointerup' && state.isFeedMode && targetEl.dataset.itemType === 'food') {
            showRoomDragHint(targetEl.dataset.itemType, 'layout');
        }
        drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}

function bindPetDrag(el) {
    if (!el || el.__mhPetDragBound) return;
    el.__mhPetDragBound = true;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        if (!isRoomPlacementMode()) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        roomPetMode = 'manual';
        clearRoomAgentTimer();
        setPetRoomMotion('idle');
        drag = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            startXMeters: Number(el.dataset.xMeters) || PET_START_X_METERS,
            startYMeters: Number(el.dataset.yMeters) || PET_START_Y_METERS,
        };
        el.classList.add('mh-pet-room-instant');
        try { el.setPointerCapture?.(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = clientDeltaToRoomMeters(e.clientX - drag.x, e.clientY - drag.y);
        const x = clampRange(drag.startXMeters + delta.x, 0, ROOM_WIDTH_METERS - PET_WIDTH_METERS);
        const y = clampRange(drag.startYMeters + delta.y, 0, ROOM_HEIGHT_METERS - PET_HEIGHT_METERS);
        el.dataset.xMeters = String(x);
        el.dataset.yMeters = String(y);
        el.dataset.roomPetMode = roomPetMode;
        decorPetPose = { x, y };
        applyMeterElementStyle(el);
        el.style.transform = x < drag.startXMeters ? 'scaleX(-1)' : 'scaleX(1)';
    });
    const end = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        try { el.releasePointerCapture?.(e.pointerId); } catch {}
        el.classList.remove('mh-pet-room-instant');
        drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}

function bindTrayDrag(el, ctx) {
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
        clearRoomItemSelection(ctx);
        drag.active = true;
        drag.scrollLocked = false;
        ctx.selectedTrayItem = drag.itemId;
        drag.ghost = makeDragGhost(drag.itemId);
        drag.sourceEl.__mhTrayDragActive = true;
        drag.sourceEl?.setPointerCapture?.(e.pointerId);
        moveDragGhost(drag.ghost, e.clientX, e.clientY);
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
        moveDragGhost(drag.ghost, e.clientX, e.clientY);
    };
    const onEnd = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const current = clearDrag(e.pointerId);
        if (current?.sourceEl) current.sourceEl.__mhTrayDragActive = false;
        if (!current.active) {
            if (current?.sourceEl) {
                current.sourceEl.__mhTrayTapHandledAt = Date.now();
                clearRoomItemSelection(ctx);
                ctx.dock?.querySelectorAll('[data-tray-item]').forEach(x => x.style.outline = '');
                ctx.selectedTrayItem = current.itemId;
                if (!state.isFeedMode) current.sourceEl.style.outline = '2px solid var(--accent)';
                if (e.type === 'pointerup') showRoomDragHint(ITEM_BY_ID[current.itemId]?.type, 'tray');
            }
            return;
        }
        const stage = ctx.stage;
        const rect = stage?.getBoundingClientRect();
        const inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (!inside) return;
        if (ITEM_BY_ID[current.itemId]?.type === 'food' && pointOverPet(e.clientX, e.clientY)) {
            runFeedServingSequence(current.itemId, { source: 'dock' }, ctx);
            return;
        }
        const pos = pointToRoomCoords(e.clientX, e.clientY);
        if (!pos) return;
        const fieldSize = getItemFieldSize(ITEM_BY_ID[current.itemId]);
        clearRoomItemSelection(ctx);
        if (state.isDecorMode) playRoomItemDropSoundAsync();
        ctx.callbacks.onPlaceItem?.(current.itemId, pos.x, pos.y, undefined, { coord: 'roomMeters', fieldSize, skipSound: state.isDecorMode });
    };
    el.addEventListener('pointerdown', (e) => {
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

function renderActionTray(pet) {
    if (isVisitingMode()) {
        return `
            <div class="mh-dock-row mh-scroll-x dock-action-row visit-pet-actions">
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-action="visit-pet-wave">
                    <span class="dock-icon">👋</span>
                    <span class="dock-label">互动</span>
                </button>
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-action="visit-pet-snack">
                    <span class="dock-icon">🍪</span>
                    <span class="dock-label">点心</span>
                </button>
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-action="visit-pet-field">
                    <span class="dock-icon">🪐</span>
                    <span class="dock-label">到表面</span>
                </button>
            </div>
        `;
    }
    const sleeping = isPetInteractionBlocked(pet);
    const sleepAction = getPetSleepActionState(pet);
    const feedUrgent = isPetVeryHungry(pet) && !sleeping;
    const isEgg = pet?.stage === 'egg';
    const eggDisabledKeys = new Set(['bath', 'sleep']);
    const actions = [
        { k: 'decor', icon: '🛠', label: stripActionIcon(t('decorate')), decor: true },
        { k: 'feed',  icon: '🍖', label: stripActionIcon(t('actionFeed')), feed: true },
        { k: 'bath',  icon: '🛁', label: stripActionIcon(t('actionBath')) },
        { k: 'sleep', icon: sleepAction.icon, label: sleepAction.label },
    ];
    return `
        <div class="mh-dock-row mh-scroll-x dock-action-row">
            ${actions.map(a => {
                const eggDisabled = isEgg && eggDisabledKeys.has(a.k);
                const sleepDisabled = sleeping && a.k !== 'sleep';
                const disabled = eggDisabled || sleepDisabled || (a.k === 'sleep' && sleepAction.disabled);
                const urgentClass = a.feed && feedUrgent ? ' is-urgent' : '';
                const title = eggDisabled
                    ? (a.k === 'bath' ? '蛋还没有孵化，先喂食让它孵化后再洗澡。' : '蛋还没有孵化，先喂食让它孵化后再睡觉。')
                    : sleepDisabled
                        ? sleepingInteractionText(pet)
                        : a.k === 'sleep'
                            ? sleepAction.title
                        : a.feed && feedUrgent
                            ? `体力值 ${Math.max(0, Math.round(Number(pet?.stats?.hunger) || 0))}，需要休息或喂食。`
                            : '';
                return `
                <button type="button" class="btn-secondary action-btn dock-icon-btn ${a.decor || a.feed ? 'mh-decor-action mh-room-mode-toggle' : ''} ${a.feed ? 'mh-feed-action' : ''}${urgentClass} ${disabled ? 'is-sleep-disabled' : ''}" ${a.decor ? 'id="mhDecorBtn"' : a.feed ? 'id="mhFeedBtn"' : `data-action="${a.k}"`}${dockDisabledAttrs(disabled, title)} title="${escapeHtml(title)}">
                    <span class="dock-icon">${a.icon}</span>
                    <span class="dock-label">${escapeHtml(a.label)}</span>
                </button>
            `; }).join('')}
        </div>
        ${sleeping ? `<div class="mh-dock-hint">${escapeHtml(sleepAction.hint)}</div>` : ''}
    `;
}

function isPetVeryHungry(pet) {
    const hunger = Number(pet?.stats?.hunger);
    if (!Number.isFinite(hunger)) return false;
    const threshold = Number(CONFIG.trauma?.hungerThreshold);
    return hunger <= (Number.isFinite(threshold) ? threshold : 25);
}

function stripActionIcon(label) {
    return String(label || '').replace(/^\S+\s*/, '') || label;
}

function renderDecorTray(inv) {
    const currentRoom = state.currentRoom || 'living';
    const items = Object.entries(inv)
        .map(([id, qty]) => ({ ...ITEM_BY_ID[id], qty }))
        .filter(it => it && it.id && it.type === 'furniture' && canPlaceItemInArea(it, currentRoom));
    const shopButton = renderRoomShopButton('indoor', { minWidth: 62, padding: '6px' });
    return `
        <div class="mh-dock-tray mh-scroll-x">
            ${items.length === 0
                ? `<div class="mh-dock-hint" style="white-space:nowrap">📦 背包里还没有可放置的家具，去商店买点吧～</div>`
                : items.map(it => `
                    <div data-tray-item="${escapeHtml(it.id)}" class="shop-item" style="min-width:62px;padding:6px;flex-shrink:0">
                        <div class="emoji mh-tray-furniture-icon">${furnitureHtml(it)}</div>
                        <div class="name" style="font-size:10px">${escapeHtml(it.name)}</div>
                        ${it.qty > 1 ? `<span class="shop-item-count-badge">${escapeHtml(it.qty)}</span>` : ''}
                    </div>
                `).join('')}
            ${shopButton}
        </div>
    `;
}

function renderFeedTray(inv) {
    const ownedItems = Object.entries(inv)
        .map(([id, qty]) => ({ ...ITEM_BY_ID[id], qty }))
        .filter(it => it && it.id && it.type === 'food');
    const basicFeed = ITEM_BY_ID[BASIC_FEED_ID] ? { ...ITEM_BY_ID[BASIC_FEED_ID], qty: Infinity } : null;
    const items = [basicFeed, ...ownedItems.filter(it => it.id !== BASIC_FEED_ID)].filter(Boolean);
    const shopButton = renderRoomShopButton('food', { minWidth: 76, padding: '10px 8px' });
    return `
        <div class="mh-dock-tray mh-scroll-x">
            ${items.length === 0
                ? `<div class="mh-dock-hint" style="white-space:nowrap">🍽️ 背包里还没有食物，去商店买点吧～</div>`
                : items.map(it => `
                    <div data-tray-item="${escapeHtml(it.id)}" data-feed-tray-item="true" class="shop-item" style="min-width:76px;padding:10px 8px;flex-shrink:0">
                        <div class="emoji mh-tray-furniture-icon">${furnitureHtml(it)}</div>
                        <div class="name" style="font-size:10px">${escapeHtml(it.name)}</div>
                        ${(it.unlimited || it.qty > 1) ? `<span class="shop-item-count-badge">${it.unlimited ? '∞' : escapeHtml(it.qty)}</span>` : ''}
                    </div>
                `).join('')}
            ${shopButton}
        </div>
    `;
}

function renderRoomShopButton(filterId, { minWidth = 62, padding = '6px' } = {}) {
    return `
        <button type="button" class="shop-item mh-room-shop-button" data-room-shop="${escapeHtml(filterId)}" style="min-width:${minWidth}px;padding:${escapeHtml(padding)};flex-shrink:0">
            <div class="emoji">🛒</div>
            <div class="name" style="font-size:10px">商店</div>
        </button>`;
}

export { movePetToRoomPoint, setPetFollowUser, startPetWalk, stopPetWalk };
