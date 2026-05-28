// 星球地貌管理视图
import { escapeHtml, showToast } from './utils.js';
import { CONFIG } from './config.js';
import { notify, state, setCurrentField } from './state.js';
import { saveUserProfileDebounced } from './storage.js';
import { DEFAULT_TERRAIN_FIELD_SLOT_ID, normalizeTerrainFieldSlotId, normalizeTerrainSlotIndex, terrainFieldSlotKey, TERRAIN_FIELD_SLOT_COUNT, TERRAIN_FIELD_SLOT_DEFS } from './terrain_field_slots.js';

export { DEFAULT_TERRAIN_FIELD_SLOT_ID, normalizeTerrainFieldSlotId, TERRAIN_FIELD_SLOT_COUNT, TERRAIN_FIELD_SLOT_DEFS };

const REMOTE_TERRAIN_TYPES = [
    { id: 'fire', name: '火山', emoji: '', iconClass: 'field-tab-icon-fire', discoveryId: 'firebird', favoriteTrait: 'dragonLike' },
    { id: 'ice', name: '冰湖', emoji: '', iconClass: 'field-tab-icon-ice', discoveryId: 'ice', favoriteTrait: 'fishLike' },
    { id: 'life', name: '神树', emoji: '', iconClass: 'field-tab-icon-life', discoveryId: 'desert', favoriteTrait: 'fruitLike' },
    { id: 'dark', name: '洞穴', emoji: '', iconClass: 'field-tab-icon-dark', discoveryId: 'shadow', favoriteTrait: 'catLike' },
    { id: 'thunder', name: '雷云', emoji: '', iconClass: 'field-tab-icon-thunder', discoveryId: 'thunder', favoriteTrait: 'birdLike' },
];

const TERRAIN_DELETE_SAFE_DISTANCE = 56;
const TERRAIN_DRAG_START_DISTANCE = 8;
const DEFAULT_TERRAIN_RESET_ORDER = ['land', 'water', 'sky', 'fire', 'ice', 'life', 'dark'];

function terrainSettings() {
    const settings = state.settings || (state.settings = {});
    return settings.terrainFields || (settings.terrainFields = {});
}

function isReadonlyPlanet() {
    return state.settings?.starSettlement?.source === 'official' && state.settings.starSettlement.readonlyPlanet !== false;
}

function showReadonlyPlanetToast() {
    showToast('官方星球的地貌不能修改。', 'info', 1600);
}

function baseTerrainTypes() {
    return (CONFIG.fields || []).map(field => ({ ...field, base: true }));
}

export function allTerrainFieldTypes() {
    return [...baseTerrainTypes(), ...REMOTE_TERRAIN_TYPES];
}

export function getTerrainFieldType(typeId) {
    return allTerrainFieldTypes().find(type => type.id === typeId) || null;
}

export function isTerrainFieldTypeCollected(type) {
    if (!type) return false;
    if (state.settings?.starSettlement?.source === 'official') return true;
    if (!type.discoveryId) return true;
    return !!(state.remotePlanetDiscoveries || {})[type.discoveryId];
}

export function collectedTerrainFieldTypes() {
    return allTerrainFieldTypes().filter(isTerrainFieldTypeCollected);
}

function slotKey(index) {
    return terrainFieldSlotKey(index);
}

function slotIndexFromRawSlot(slot) {
    if (!slot || typeof slot !== 'object') return null;
    return normalizeTerrainSlotIndex(slot.index ?? slot.slotIndex ?? slot.slotId ?? slot.id);
}

function legacySlotId(slot) {
    return String(slot?.slotId || slot?.id || '').trim();
}

function defaultSlotTypeId(index) {
    return index === 0 ? (CONFIG.fields[0]?.id || 'land') : '';
}

function rawSlotForIndex(rawSlots, index) {
    if (!Array.isArray(rawSlots)) return null;
    const slotIndex = index + 1;
    const matches = rawSlots.filter(slot => slotIndexFromRawSlot(slot) === slotIndex);
    if (matches.length) {
        const legacyBaseMatch = matches.find(slot => ['land', 'water', 'sky'].includes(legacySlotId(slot)));
        return legacyBaseMatch || matches[0];
    }
    const positional = rawSlots[index];
    return slotIndexFromRawSlot(positional) == null ? positional || null : null;
}

function rawSlotHasCollectedType(rawSlot) {
    const rawTypeId = String(rawSlot?.typeId || rawSlot?.fieldId || '').trim();
    const type = getTerrainFieldType(rawTypeId);
    return !!(type && isTerrainFieldTypeCollected(type));
}

function normalizedSlot(rawSlot, index, useDefaultLand) {
    const def = TERRAIN_FIELD_SLOT_DEFS[index];
    const rawTypeId = String(rawSlot?.typeId || rawSlot?.fieldId || '').trim();
    const type = getTerrainFieldType(rawTypeId);
    const typeId = type && isTerrainFieldTypeCollected(type) ? type.id : (useDefaultLand ? defaultSlotTypeId(index) : '');
    const fallbackType = getTerrainFieldType(typeId);
    const name = String(rawSlot?.name || '').trim().slice(0, 12) || fallbackType?.name || def.label;
    return {
        id: slotKey(index),
        index: def.index,
        positionLabel: def.label,
        x: def.x,
        y: def.y,
        typeId,
        fieldId: typeId,
        name,
    };
}

export function getTerrainFieldSlots({ includeEmpty = false } = {}) {
    const settings = terrainSettings();
    const rawSlots = Array.isArray(settings.slots) ? settings.slots : [];
    const hasSavedCollectedSlot = rawSlots.some(rawSlotHasCollectedType);
    const slots = TERRAIN_FIELD_SLOT_DEFS.map((def, index) => normalizedSlot(rawSlotForIndex(rawSlots, index), index, !hasSavedCollectedSlot && index === 0));
    return includeEmpty ? slots : slots.filter(slot => slot.typeId);
}

export function getTerrainFieldSlot(slotId) {
    const index = normalizeTerrainSlotIndex(slotId);
    return getTerrainFieldSlots({ includeEmpty: true }).find(slot => slot.index === index) || null;
}

export function resolveTerrainFieldTypeId(slotIdOrTypeId) {
    const slot = getTerrainFieldSlot(slotIdOrTypeId);
    if (slot?.typeId) return slot.typeId;
    return getTerrainFieldType(slotIdOrTypeId)?.id || slotIdOrTypeId || 'land';
}

export function terrainFieldIconHtml(typeId, className = '') {
    const type = getTerrainFieldType(typeId);
    const cls = className ? ` ${escapeHtml(className)}` : '';
    if (!type) return `<span class="terrain-field-icon${cls} terrain-field-icon-empty">+</span>`;
    if (type.iconClass) return `<span class="terrain-field-icon${cls} field-tab-svg-icon ${escapeHtml(type.iconClass)}" aria-hidden="true"></span>`;
    return `<span class="terrain-field-icon${cls}" aria-hidden="true">${escapeHtml(type.emoji || '🪐')}</span>`;
}

export function terrainFieldTabIconHtml(slot) {
    return terrainFieldIconHtml(slot?.typeId || slot?.id || '', 'terrain-field-tab-icon');
}

function serializeSlots(slots) {
    const serialized = TERRAIN_FIELD_SLOT_DEFS.map((def, index) => {
        const slot = slots[index] || {};
        const typeId = getTerrainFieldType(slot.typeId) && isTerrainFieldTypeCollected(getTerrainFieldType(slot.typeId)) ? slot.typeId : '';
        const type = getTerrainFieldType(typeId);
        return {
            index: def.index,
            typeId,
            name: String(slot.name || '').trim().slice(0, 12) || type?.name || def.label,
        };
    });
    if (!serialized.some(slot => slot.typeId)) {
        const typeId = defaultSlotTypeId(0);
        const type = getTerrainFieldType(typeId);
        serialized[0] = { ...serialized[0], typeId, name: type?.name || TERRAIN_FIELD_SLOT_DEFS[0].label };
    }
    return serialized;
}

function saveTerrainFieldSlots(slots) {
    if (isReadonlyPlanet()) {
        showReadonlyPlanetToast();
        return;
    }
    terrainSettings().slots = serializeSlots(slots);
    const active = getTerrainFieldSlot(state.currentField);
    const nextActive = getTerrainFieldSlots()[0];
    if ((!active || !active.typeId) && nextActive) setCurrentField(nextActive.id);
    saveUserProfileDebounced();
    notify();
}

function defaultFieldSceneConfig(typeId) {
    const preset = CONFIG.fieldDefaultScenes?.[typeId];
    if (!preset) return null;
    return {
        background: {
            type: preset.imageUrl ? 'image' : 'color',
            color: preset.color || '#bae6fd',
            imageUrl: preset.imageUrl || '',
            presetId: preset.id || '',
            title: preset.title || '',
        },
        particles: Array.isArray(preset.particles) ? [...preset.particles] : [],
        bgMusic: preset.bgMusic || '',
    };
}

function resetFieldScenesForSlots(slots) {
    if (isReadonlyPlanet()) return;
    const settings = state.settings || (state.settings = {});
    const scenes = {};
    slots.forEach((slot, index) => {
        if (!slot?.typeId) return;
        const scene = defaultFieldSceneConfig(slot.typeId);
        if (scene) scenes[slotKey(index)] = scene;
    });
    settings.fieldScenes = scenes;
}

function canAutoResetTerrainType(type) {
    if (!type) return false;
    if (!type.discoveryId) return true;
    return !!(state.remotePlanetDiscoveries || {})[type.discoveryId];
}

function resetTerrainFieldSlots() {
    if (isReadonlyPlanet()) {
        showReadonlyPlanetToast();
        return;
    }
    const slots = TERRAIN_FIELD_SLOT_DEFS.map((def, index) => {
        const orderedTypeId = DEFAULT_TERRAIN_RESET_ORDER[index] || defaultSlotTypeId(index);
        const orderedType = getTerrainFieldType(orderedTypeId);
        const baseTypeId = defaultSlotTypeId(index);
        const typeId = orderedType && canAutoResetTerrainType(orderedType) ? orderedType.id : baseTypeId;
        const type = getTerrainFieldType(typeId);
        return { id: slotKey(index), index: def.index, typeId, name: type?.name || def.label };
    });
    resetFieldScenesForSlots(slots);
    saveTerrainFieldSlots(slots);
}

function clearTerrainFieldSlot(slotIndex) {
    if (isReadonlyPlanet()) {
        showReadonlyPlanetToast();
        return;
    }
    const slots = getTerrainFieldSlots({ includeEmpty: true });
    const def = TERRAIN_FIELD_SLOT_DEFS[slotIndex];
    if (!def) return;
    slots[slotIndex] = { ...slots[slotIndex], typeId: '', name: def.label };
    saveTerrainFieldSlots(slots);
}

function moveTerrainFieldSlot(sourceIndex, targetIndex) {
    if (isReadonlyPlanet()) {
        showReadonlyPlanetToast();
        return false;
    }
    if (sourceIndex === targetIndex) return false;
    const slots = getTerrainFieldSlots({ includeEmpty: true });
    const source = slots[sourceIndex];
    const target = slots[targetIndex];
    const sourceDef = TERRAIN_FIELD_SLOT_DEFS[sourceIndex];
    if (!source?.typeId || !target || !sourceDef) return false;
    slots[targetIndex] = { ...target, typeId: source.typeId, name: source.name };
    slots[sourceIndex] = { ...source, typeId: '', name: sourceDef.label };
    saveTerrainFieldSlots(slots);
    return true;
}

function assignTerrainFieldSlot(slotIndex, typeId, keepName = false) {
    if (isReadonlyPlanet()) {
        showReadonlyPlanetToast();
        return false;
    }
    const type = getTerrainFieldType(typeId);
    if (!type || !isTerrainFieldTypeCollected(type)) return false;
    const slots = getTerrainFieldSlots({ includeEmpty: true });
    const current = slots[slotIndex];
    if (!current) return false;
    slots[slotIndex] = {
        ...current,
        typeId: type.id,
        name: keepName && current.name ? current.name : type.name,
    };
    saveTerrainFieldSlots(slots);
    return true;
}

function renameTerrainFieldSlot(slotIndex, name) {
    if (isReadonlyPlanet()) {
        showReadonlyPlanetToast();
        return;
    }
    const slots = getTerrainFieldSlots({ includeEmpty: true });
    const current = slots[slotIndex];
    if (!current) return;
    const type = getTerrainFieldType(current.typeId);
    slots[slotIndex] = {
        ...current,
        name: String(name || '').trim().slice(0, 12) || type?.name || current.positionLabel,
    };
    saveTerrainFieldSlots(slots);
}

function terrainViewStyles() {
    return `
        <style id="mhTerrainFieldsStyles">
        .terrain-fields-view { top:52px; left:0; right:0; bottom:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
        .terrain-fields-board { display:grid; grid-template-columns: repeat(7, minmax(86px, 1fr)); gap:10px; min-width:720px; }
        .terrain-field-slot { min-height:98px; padding:9px; border-radius:14px; border:1px solid rgba(56,189,248,.28); background:linear-gradient(180deg, rgba(255,255,255,.86), rgba(224,250,255,.68)); box-shadow:0 8px 18px rgba(14,116,144,.12); display:flex; flex-direction:column; gap:7px; align-items:stretch; }
        .terrain-field-slot.is-empty { border-style:dashed; background:rgba(255,255,255,.6); }
        .terrain-field-slot.is-drop-target { outline:3px solid rgba(34,197,94,.42); transform:translateY(-1px); }
        .terrain-slot-label { font-size:11px; color:var(--text-muted); font-weight:800; text-align:center; }
        .terrain-slot-drop { height:58px; border-radius:12px; display:grid; place-items:center; background:rgba(255,255,255,.72); border:1px solid rgba(125,211,252,.34); font-size:30px; touch-action:none; user-select:none; }
        .terrain-slot-drop:not(:disabled) { cursor:grab; }
        .terrain-slot-drop:not(:disabled):active { cursor:grabbing; }
        .terrain-field-icon { display:inline-grid; place-items:center; width:1.15em; height:1.15em; line-height:1; font-size:1em; }
        .terrain-field-icon-empty { color:#94a3b8; font-weight:900; }
        .terrain-field-tab-icon { font-size:15px; width:18px; height:18px; flex:0 0 auto; }
        .terrain-palette { display:flex; gap:9px; overflow-x:auto; padding:10px; border-radius:14px; background:rgba(15,23,42,.06); border:1px solid rgba(148,163,184,.18); touch-action:none; }
        .terrain-palette-item { flex:0 0 86px; min-height:76px; border-radius:13px; border:1px solid rgba(14,116,144,.2); background:rgba(255,255,255,.84); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; cursor:grab; color:var(--text-primary); font-weight:900; touch-action:none; user-select:none; }
        .terrain-palette-item.is-selected { outline:3px solid rgba(14,165,233,.35); background:#ecfeff; }
        .terrain-palette-item:active { cursor:grabbing; }
        .terrain-palette-icon { font-size:28px; }
        .terrain-palette-name { font-size:12px; }
        .terrain-fields-actions { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
        .terrain-fields-hint { color:var(--text-muted); font-size:12px; line-height:1.45; }
        .terrain-drag-ghost { position:fixed; z-index:9999; left:0; top:0; width:64px; height:64px; border-radius:18px; display:grid; place-items:center; background:rgba(255,255,255,.92); border:1px solid rgba(14,165,233,.34); box-shadow:0 14px 30px rgba(15,23,42,.2); font-size:34px; pointer-events:none; transform:translate(-50%, -50%); }
        .terrain-drag-ghost.is-delete-ready::after { content:'×'; position:absolute; right:-7px; top:-7px; width:22px; height:22px; border-radius:999px; display:grid; place-items:center; background:#ef4444; color:white; border:2px solid white; box-shadow:0 5px 12px rgba(127,29,29,.28); font-size:17px; font-weight:900; line-height:1; }
        @media (max-width: 760px) {
            .terrain-fields-board { grid-template-columns: repeat(4, minmax(78px, 1fr)); min-width:0; }
            .terrain-field-slot { min-height:94px; }
        }
        </style>`;
}

function renderSlotCard(slot, index) {
    const empty = !slot.typeId;
    const readonly = isReadonlyPlanet();
    return `
        <div class="terrain-field-slot ${empty ? 'is-empty' : ''}" data-terrain-slot="${index}">
            <div class="terrain-slot-label">${escapeHtml(slot.positionLabel)}</div>
            <button type="button" class="terrain-slot-drop" data-terrain-drop="${index}" title="${readonly ? '官方星球不可修改地貌' : '拖入地貌类型'}" ${readonly ? 'disabled' : ''}>
                ${terrainFieldIconHtml(slot.typeId)}
            </button>
        </div>`;
}

function renderPaletteItem(type) {
    const readonly = isReadonlyPlanet();
    return `
        <button type="button" class="terrain-palette-item" draggable="${readonly ? 'false' : 'true'}" data-terrain-type="${escapeHtml(type.id)}" title="${readonly ? '官方星球不可修改地貌' : '拖到上方格子'}" ${readonly ? 'disabled' : ''}>
            <span class="terrain-palette-icon">${terrainFieldIconHtml(type.id)}</span>
            <span class="terrain-palette-name">${escapeHtml(type.name)}</span>
        </button>`;
}

function terrainDragPayloadFromEvent(e) {
    const sourceSlotIndex = e.dataTransfer?.getData?.('application/x-mh-terrain-source-slot');
    const typeId = e.dataTransfer?.getData?.('application/x-mh-terrain-type') || e.dataTransfer?.getData?.('text/plain') || '';
    return {
        sourceSlotIndex: sourceSlotIndex === '' ? null : Number(sourceSlotIndex),
        typeId,
    };
}

function applyTerrainDragToSlot(drag, targetIndex) {
    if (!drag) return false;
    if (Number.isInteger(drag.sourceSlotIndex)) return moveTerrainFieldSlot(drag.sourceSlotIndex, targetIndex);
    return assignTerrainFieldSlot(targetIndex, drag.typeId);
}

function bindTerrainPointerDrag(panel, _data, onBack) {
    let drag = null;
    let suppressNextClick = false;

    const removeGhost = () => {
        drag?.ghost?.remove?.();
        if (drag?.sourceEl) {
            try { drag.sourceEl.releasePointerCapture?.(drag.pointerId); } catch (_) { }
        }
        panel.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
        drag = null;
    };
    const renderAgain = () => renderTerrainFields(panel, _data, { onBack });
    const ensureGhost = (x, y) => {
        if (!drag || drag.ghost) return;
        const ghost = document.createElement('div');
        ghost.className = 'terrain-drag-ghost';
        ghost.innerHTML = terrainFieldIconHtml(drag.typeId);
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        moveGhost(x, y);
    };
    const moveGhost = (x, y) => {
        if (!drag?.ghost) return;
        drag.ghost.style.left = `${x}px`;
        drag.ghost.style.top = `${y}px`;
    };
    const setDropTarget = (x, y) => {
        panel.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
        const slot = document.elementFromPoint(x, y)?.closest?.('[data-terrain-slot]');
        if (slot && panel.contains(slot)) slot.classList.add('is-drop-target');
        return slot && panel.contains(slot) ? slot : null;
    };
    const setDeleteIndicator = (moved, target) => {
        if (!drag?.ghost) return;
        const deleteReady = Number.isInteger(drag.sourceSlotIndex) && moved >= TERRAIN_DELETE_SAFE_DISTANCE && !target;
        drag.ghost.classList.toggle('is-delete-ready', deleteReady);
    };
    const lockPaletteScroll = (e) => {
        if (!drag?.scroller) return;
        e.preventDefault();
        drag.scrollLocked = true;
        drag.scroller.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    };
    const beginDrag = (e, payload, sourceEl) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (!payload.typeId) return;
        drag = {
            ...payload,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            scrollLeft: payload.scroller?.scrollLeft || 0,
            scrollLocked: false,
            sourceEl,
            ghost: null,
        };
        sourceEl.setPointerCapture?.(e.pointerId);
    };

    panel.addEventListener('click', (e) => {
        if (!suppressNextClick) return;
        e.preventDefault();
        e.stopPropagation();
        suppressNextClick = false;
    }, true);
    panel.querySelectorAll('[data-terrain-type]').forEach(item => {
        item.addEventListener('pointerdown', (e) => beginDrag(e, {
            typeId: item.dataset.terrainType || '',
            sourceSlotIndex: null,
            scroller: item.closest('.terrain-palette'),
        }, item));
    });
    panel.querySelectorAll('[data-terrain-drop]').forEach(drop => {
        const index = Number(drop.dataset.terrainDrop);
        const slot = getTerrainFieldSlots({ includeEmpty: true })[index];
        drop.draggable = !!slot?.typeId;
        drop.addEventListener('pointerdown', (e) => beginDrag(e, { typeId: slot?.typeId || '', sourceSlotIndex: index }, drop));
    });
    panel.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        const moved = Math.hypot(dx, dy);
        if (drag.scrollLocked) {
            lockPaletteScroll(e);
            return;
        }
        if (moved < TERRAIN_DRAG_START_DISTANCE && !drag.ghost) return;
        if (drag.scroller && !drag.ghost && Math.abs(dx) >= Math.abs(dy)) {
            lockPaletteScroll(e);
            return;
        }
        e.preventDefault();
        ensureGhost(e.clientX, e.clientY);
        moveGhost(e.clientX, e.clientY);
        const target = setDropTarget(e.clientX, e.clientY);
        setDeleteIndicator(moved, target);
    });
    panel.addEventListener('pointerup', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const currentDrag = drag;
        const moved = Math.hypot(e.clientX - currentDrag.startX, e.clientY - currentDrag.startY);
        if (currentDrag.scrollLocked) {
            removeGhost();
            if (moved >= TERRAIN_DRAG_START_DISTANCE) suppressNextClick = true;
            return;
        }
        const target = currentDrag.ghost ? setDropTarget(e.clientX, e.clientY) : null;
        removeGhost();
        if (moved < TERRAIN_DRAG_START_DISTANCE) return;
        suppressNextClick = true;
        if (target) {
            if (applyTerrainDragToSlot(currentDrag, Number(target.dataset.terrainSlot))) renderAgain();
            return;
        }
        if (Number.isInteger(currentDrag.sourceSlotIndex) && moved >= TERRAIN_DELETE_SAFE_DISTANCE) {
            clearTerrainFieldSlot(currentDrag.sourceSlotIndex);
            renderAgain();
        }
    });
    panel.addEventListener('pointercancel', removeGhost);
    panel.addEventListener('lostpointercapture', removeGhost);
}

export function renderTerrainFields(panel, _data, { onBack } = {}) {
    const slots = getTerrainFieldSlots({ includeEmpty: true });
    const types = collectedTerrainFieldTypes();
    const readonly = isReadonlyPlanet();
    panel.innerHTML = `
        ${terrainViewStyles()}
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">星球地貌</span>
            <span style="width:36px"></span>
        </div>
        <div class="absolute terrain-fields-view">
            <div class="terrain-fields-actions">
                <div class="terrain-fields-hint">${readonly ? '官方星球地貌由星球配置决定，不能修改。' : '拖动已收集的地貌到 7 个位置；同一种地貌可以放进多个位置。'}</div>
                <button type="button" class="btn-secondary" id="mhTerrainReset" ${readonly ? 'disabled' : ''}>重置</button>
            </div>
            <div class="terrain-fields-board">
                ${slots.map(renderSlotCard).join('')}
            </div>
            <div class="terrain-palette" aria-label="已收集地貌">
                ${types.map(renderPaletteItem).join('')}
            </div>
        </div>
    `;
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();
    const reset = panel.querySelector('#mhTerrainReset');
    if (reset) reset.onclick = () => {
        if (readonly) {
            showReadonlyPlanetToast();
            return;
        }
        resetTerrainFieldSlots();
        showToast('地貌已重置', 'success', 1000);
        renderTerrainFields(panel, _data, { onBack });
    };

    let selectedTypeId = '';
    let nativeDrag = null;
    panel.querySelectorAll('[data-terrain-type]').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            if (readonly) {
                e.preventDefault();
                return;
            }
            const typeId = item.dataset.terrainType || '';
            nativeDrag = { typeId, sourceSlotIndex: null, didDrop: false, startX: e.clientX, startY: e.clientY };
            e.dataTransfer?.setData?.('text/plain', typeId);
            e.dataTransfer?.setData?.('application/x-mh-terrain-type', typeId);
        });
        item.addEventListener('dragend', () => {
            nativeDrag = null;
        });
        item.onclick = () => {
            if (readonly) {
                showReadonlyPlanetToast();
                return;
            }
            selectedTypeId = item.dataset.terrainType || '';
            panel.querySelectorAll('[data-terrain-type]').forEach(btn => btn.classList.toggle('is-selected', btn === item));
            showToast('点击上方格子即可放入', 'info', 900);
        };
    });

    panel.querySelectorAll('[data-terrain-slot]').forEach(slotEl => {
        slotEl.addEventListener('dragover', (e) => {
            if (readonly) return;
            e.preventDefault();
            slotEl.classList.add('is-drop-target');
        });
        slotEl.addEventListener('dragleave', () => slotEl.classList.remove('is-drop-target'));
        slotEl.addEventListener('drop', (e) => {
            e.preventDefault();
            if (readonly) {
                showReadonlyPlanetToast();
                return;
            }
            slotEl.classList.remove('is-drop-target');
            const index = Number(slotEl.dataset.terrainSlot);
            const drag = terrainDragPayloadFromEvent(e);
            if (nativeDrag) nativeDrag.didDrop = true;
            if (applyTerrainDragToSlot(drag, index)) renderTerrainFields(panel, _data, { onBack });
        });
    });

    panel.querySelectorAll('[data-terrain-drop]').forEach(drop => {
        const index = Number(drop.dataset.terrainDrop);
        const slot = slots[index];
        if (slot?.typeId) {
            drop.draggable = true;
            drop.addEventListener('dragstart', (e) => {
                if (readonly) {
                    e.preventDefault();
                    return;
                }
                nativeDrag = { typeId: slot.typeId, sourceSlotIndex: index, didDrop: false, startX: e.clientX, startY: e.clientY };
                e.dataTransfer?.setData?.('text/plain', slot.typeId);
                e.dataTransfer?.setData?.('application/x-mh-terrain-type', slot.typeId);
                e.dataTransfer?.setData?.('application/x-mh-terrain-source-slot', String(index));
            });
            drop.addEventListener('dragend', (e) => {
                const moved = nativeDrag ? Math.hypot(e.clientX - nativeDrag.startX, e.clientY - nativeDrag.startY) : 0;
                if (nativeDrag && Number.isInteger(nativeDrag.sourceSlotIndex) && !nativeDrag.didDrop && moved >= TERRAIN_DELETE_SAFE_DISTANCE) {
                    clearTerrainFieldSlot(nativeDrag.sourceSlotIndex);
                    renderTerrainFields(panel, _data, { onBack });
                }
                nativeDrag = null;
            });
        }
        drop.onclick = () => {
            if (readonly) {
                showReadonlyPlanetToast();
                return;
            }
            if (!selectedTypeId) {
                showToast('先选择或拖动一个地貌类型', 'info', 1000);
                return;
            }
            if (assignTerrainFieldSlot(index, selectedTypeId)) renderTerrainFields(panel, _data, { onBack });
        };
    });
    if (!readonly) bindTerrainPointerDrag(panel, _data, onBack);
}