// Level 3 — Cell：体内观察与蛋阶段许愿

import { $, dockDisabledAttrs, escapeHtml, isDockButtonDisabled, showDockDisabledToast, showToast } from './utils.js';
import { t } from './i18n.js';
import { CONFIG } from './config.js';
import { state } from './state.js';
import { savePetDebounced } from './storage.js';
import { getActiveSickness, getEffectiveSicknessSeverity, getPermanentTraumaCount, sicknessName } from './petTick.js';
import { decodeDna, dietPreferenceIcons, dietPreferenceLabel, dnaDietPreference } from './dna.js';
import { isPetInteractionBlocked, isPetSleeping, sleepingInteractionText } from './pet.js';

// 许愿文字上限（按字符数计；中文每字算 1，符合"最多 200 字"的需求）
const WISH_MAX_LEN = 200;
const WISH_REF_IMAGE_MAX_BYTES = 1024 * 1024;
const WISH_REF_IMAGE_QUALITY_STEPS = [0.86, 0.72, 0.58, 0.44, 0.32];
const WISH_REF_IMAGE_MAX_SCALE_ITERATIONS = 6;

let cellTimer = null;
let cellHits = 0;
let cellFaceTickCleanup = null;
const CELL_FACE_EXPRESSION_CLASSES = ['is-expression-happy', 'is-expression-worried', 'is-expression-sad', 'is-expression-sick', 'is-expression-critical'];
const CELL_TARGETS = [
    { left: 16, top: 24 },
    { left: 78, top: 22 },
    { left: 23, top: 68 },
    { left: 72, top: 70 },
    { left: 42, top: 18 },
    { left: 58, top: 82 },
    { left: 10, top: 48 },
    { left: 88, top: 50 },
];

const DIET_FLOAT_EMOJIS = {
    meat: '🍖',
    vegetables: '🥦',
};

const DIET_TAP_MOVE_THRESHOLD = 8;

// 真实大脑般的粉白基底（中心主色，几乎不被元素影响）
const CELL_BRAIN_BASE = {
    hi: '#fff1f4',   // 高光：近白带粉
    mid: '#ffd9e4',  // 中段：粉白
    low: '#ffb3c9',  // 偏外：暖粉
    deep: '#f48aa6',  // 边缘基础：玫粉
};

// 元素属性 → 代表色（用于给"外缘/深处"上色，营造元素光晕）
const CELL_ELEMENT_COLORS = {
    '自然': '#34c759', // 自然 · 绿
    '火': '#ff5a3c',   // 火 · 橙红
    '冰': '#36c5ff',   // 冰 · 冰蓝
    '生命': '#5be38b', // 生命 · 嫩绿
    '暗': '#7c5cff',   // 暗 · 紫
    '雷': '#ffd23b',   // 雷 · 雷黄
};
const CELL_ELEMENT_DEFAULT = '#f48aa6';

// 元素属性 → 角标 emoji + 文案键（贴在脸右上角的小装饰）
const CELL_ELEMENT_DECO = {
    '自然': { emoji: '🌿', labelKey: 'elemNature' },
    '火': { emoji: '🔥', labelKey: 'elemFire' },
    '冰': { emoji: '❄️', labelKey: 'elemIce' },
    '生命': { emoji: '🌱', labelKey: 'elemLife' },
    '暗': { emoji: '🌙', labelKey: 'elemDark' },
    '雷': { emoji: '⚡', labelKey: 'elemThunder' },
};

function dietKindLabel(kind) {
    return kind === 'meat' ? t('dietMeat') : t('dietVeggie');
}

function cellElementDecoHtml(pet) {
    const traits = decodeDna(pet?.dna || '');
    const deco = CELL_ELEMENT_DECO[traits.elementalAttribute];
    if (!deco) return '';
    const color = CELL_ELEMENT_COLORS[traits.elementalAttribute] || CELL_ELEMENT_DEFAULT;
    return `
        <span class="cell-element-deco element-${escapeHtml(traits.elementalAttribute)}" role="button" tabindex="0"
            style="--cell-element-color:${color}" aria-label="${escapeHtml(t('elementAttrLabel', { element: t(deco.labelKey) }))}" title="${escapeHtml(t('elementAttrLabel', { element: t(deco.labelKey) }))}">
            <span class="cell-element-deco-glow" aria-hidden="true"></span>
            <span class="cell-element-deco-emoji" aria-hidden="true">${deco.emoji}</span>
        </span>
    `;
}

// 将 #rrggbb 解析为 [r,g,b]
function hexToRgb(hex) {
    const m = String(hex).replace('#', '');
    const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const n = parseInt(v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
    const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}
// 按 t∈[0,1] 把 a 向 b 混合：t=0 全 a，t=1 全 b
function mixHex(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

function cellFaceStyle(pet) {
    const traits = decodeDna(pet?.dna || '');
    const elementColor = CELL_ELEMENT_COLORS[traits.elementalAttribute] || CELL_ELEMENT_DEFAULT;

    // 中心保持粉白（大脑感）：高光/中段几乎不染色；
    // 越往外越染上元素色，深处 50% 由元素决定。
    const hi = CELL_BRAIN_BASE.hi;                            // 0% 元素
    const mid = mixHex(CELL_BRAIN_BASE.mid, elementColor, 0.10); // 一丝元素
    const low = mixHex(CELL_BRAIN_BASE.low, elementColor, 0.35); // 渐染
    const deep = mixHex(CELL_BRAIN_BASE.deep, elementColor, 0.50); // 边缘 50% 元素
    return `--cell-face-hi:${hi};--cell-face-mid:${mid};--cell-face-low:${low};--cell-face-deep:${deep}`;
}

function shouldShowCellHungerCue(pet) {
    if (pet?.stage === 'egg') return false;
    const stats = pet?.stats || {};
    return (stats.hunger ?? 100) < 50;
}

function cellFaceExpression(pet) {
    if (pet?.stage === 'egg') return 'happy';
    const sicknessSeverity = getEffectiveSicknessSeverity(pet);
    if (sicknessSeverity >= 7) return 'critical';
    if (sicknessSeverity > 0) return 'sick';
    const stats = pet?.stats || {};
    const mood = stats.mood ?? 100;
    if (mood < 25) return 'sad';
    if (mood < 50) return 'worried';
    return 'happy';
}

function cellFaceStateClass(pet) {
    return `is-expression-${cellFaceExpression(pet)}`;
}

// 当前心情文案（点击脸时弹 toast），文案走 i18n
const CELL_MOOD_TEXT = {
    sleep: { emoji: '😴', textKey: 'cellSleeping' },
    critical: { emoji: '🤢', textKey: 'cellVerySick' },
    sick: { emoji: '🤒', textKey: 'cellSick' },
    sad: { emoji: '😢', textKey: 'cellSad' },
    worried: { emoji: '😟', textKey: 'cellGloomy' },
    happy: { emoji: '😊', textKey: 'cellHappy' },
    egg: { emoji: '🥚', textKey: 'cellEgg' },
};

function cellMoodToastText(pet) {
    if (pet?.stage === 'egg') {
        const m = CELL_MOOD_TEXT.egg;
        return `${m.emoji} ${t(m.textKey)}`;
    }
    const key = isPetSleeping(pet) ? 'sleep' : cellFaceExpression(pet);
    const m = CELL_MOOD_TEXT[key] || CELL_MOOD_TEXT.happy;
    const mood = Math.round(pet?.stats?.mood ?? 100);
    return `${m.emoji} ${t(m.textKey)}${t('cellMoodSuffix', { mood })}`;
}

function cellHungerCueHtml() {
    return `
        <span class="cell-face-hunger-lines" aria-hidden="true">
            <i></i><i></i><i></i>
        </span>
    `;
}

function updateCellFaceHealthCue(pet) {
    const wrap = document.querySelector('.cell-face-wrap');
    if (!wrap) return;
    const sleeping = isPetSleeping(pet);
    wrap.classList.toggle('is-sleeping', sleeping);
    wrap.classList.toggle('is-awake', !sleeping);
    wrap.classList.toggle('is-hungry', !sleeping && shouldShowCellHungerCue(pet));
    wrap.classList.remove(...CELL_FACE_EXPRESSION_CLASSES);
    if (!sleeping) wrap.classList.add(cellFaceStateClass(pet));
}

function bindCellFaceTick(pet) {
    cellFaceTickCleanup?.();
    const update = () => updateCellFaceHealthCue(pet);
    window.addEventListener('mh:tick', update);
    cellFaceTickCleanup = () => {
        window.removeEventListener('mh:tick', update);
        cellFaceTickCleanup = null;
    };
}

function dietToastText(kind, preference) {
    if (preference === 'both') return t('cellDietHintBoth', { kind: dietKindLabel(kind) });
    return t('cellDietHintPref', { preference: dietPreferenceLabel(preference) });
}

function dietFloatHtml(pet) {
    const preference = dnaDietPreference(pet?.dna || '');
    const label = dietPreferenceLabel(preference);
    return dietPreferenceIcons(preference).map((kind, index) => `
        <span class="cell-float cell-float-diet diet-${kind} diet-${index + 1}" role="button" tabindex="0"
            aria-label="${escapeHtml(t('cellDietFloatAria', { label }))}" title="${escapeHtml(label)} DNA"
            data-diet-kind="${escapeHtml(kind)}" data-diet-preference="${escapeHtml(preference)}">
            ${DIET_FLOAT_EMOJIS[kind] || ''}
        </span>
    `).join('');
}

// 通用：为元素绑定"轻点不影响拖拽"的点击（移动超过阈值视为拖拽，不触发）
function bindTapToast(el, getText) {
    if (!el) return;
    let start = null;
    el.addEventListener('pointerdown', (e) => {
        start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
        if (!start || start.id !== e.pointerId) return;
        const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        start = null;
        if (moved > DIET_TAP_MOVE_THRESHOLD) return;
        const text = getText();
        if (text) showToast(text, 'info', 1800);
    });
    el.addEventListener('pointercancel', () => { start = null; });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const text = getText();
        if (text) showToast(text, 'info', 1800);
    });
}

function bindDietFloatIcons() {
    document.querySelectorAll('.cell-float-diet[data-diet-kind]').forEach(el => {
        bindTapToast(el, () => dietToastText(el.dataset.dietKind, el.dataset.dietPreference));
    });
}

function elementDecoToastText(pet) {
    const traits = decodeDna(pet?.dna || '');
    const deco = CELL_ELEMENT_DECO[traits.elementalAttribute];
    if (!deco) return '';
    return t('elementAttrLine', { emoji: deco.emoji, element: t(deco.labelKey) });
}

function bindElementDeco(pet) {
    bindTapToast(document.querySelector('.cell-element-deco'), () => elementDecoToastText(pet));
}

function bindCellFaceTap(pet) {
    // 绑定到身体形状本体（云朵脑），点击命中区贴合脸形，不影响周围拖拽
    bindTapToast(document.querySelector('.cell-face-body'), () => cellMoodToastText(pet));
}

function traumaLayerHtml(pet) {
    const count = getPermanentTraumaCount(pet);
    if (!count) return '';
    return `
        <div class="cell-trauma-layer" aria-label="${escapeHtml(t('cellTraumaAria', { count, max: CONFIG.trauma.max }))}">
            ${Array.from({ length: count }, (_, index) => `<span class="cell-trauma-mark t${index + 1}" title="${escapeHtml(t('cellTraumaTitle', { index: index + 1, max: CONFIG.trauma.max }))}"><span></span></span>`).join('')}
        </div>
    `;
}

function sicknessIconSvg(type) {
    const spots = {
        diarrhea: '<circle cx="25" cy="30" r="4"/><circle cx="39" cy="38" r="3"/>',
        bacterial: '<circle cx="23" cy="32" r="4"/><circle cx="36" cy="27" r="3"/><circle cx="41" cy="40" r="3"/>',
        depression: '<path d="M23 41c6-5 14-5 20 0" fill="none" stroke-width="5" stroke-linecap="round"/>',
        fatigue: '<path d="M35 17 24 34h10l-4 15 14-23h-9Z" stroke-width="3" stroke-linejoin="round"/>',
        allergy: '<path d="M21 27c8 5 15-5 23 0M23 40c7-4 12 4 19 0" fill="none" stroke-width="5" stroke-linecap="round"/>',
        flu: '<path d="M29 18h6v11h11v6H35v11h-6V35H18v-6h11Z" stroke-width="2" stroke-linejoin="round"/>',
    };
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="34" rx="22" ry="15" fill="#18181b" stroke="#7f1d1d" stroke-width="5" transform="rotate(-20 32 34)"/><path d="M12 19l10 8M52 43l8 7M48 15l-9 9M17 50l9-8" stroke="#27272a" stroke-width="5" stroke-linecap="round"/><g fill="#ef4444" stroke="#fecaca" stroke-opacity=".82">${spots[type] || spots.flu}</g><circle cx="24" cy="29" r="3" fill="#fecaca"/><circle cx="39" cy="35" r="2.5" fill="#fecaca"/></svg>`;
}

function sicknessLayerHtml(pet) {
    const sickness = getActiveSickness(pet);
    if (!sickness) return '';
    const count = getEffectiveSicknessSeverity(pet);
    if (!count) return '';
    const name = sicknessName(sickness.def);
    const label = t('cellSicknessLabel', { name, level: count });
    return `
        <div class="cell-sickness-layer" aria-label="${escapeHtml(label)}">
            ${Array.from({ length: count }, (_, index) => `<span class="cell-sickness-icon s${index + 1}" role="button" tabindex="0" title="${escapeHtml(label)}" data-sickness-name="${escapeHtml(name)}" data-sickness-level="${count}">${sicknessIconSvg(sickness.type)}</span>`).join('')}
            ${Array.from({ length: Math.min(6, Math.max(3, count)) }, (_, index) => `<span class="cell-white-cell w${index + 1}" title="${escapeHtml(t('cellWhiteCell'))}"></span>`).join('')}
        </div>
    `;
}

function bindSicknessIcons() {
    document.querySelectorAll('.cell-sickness-icon[data-sickness-name]').forEach(el => {
        let start = null;
        const showName = (event) => {
            event?.stopPropagation?.();
            showToast(t('cellSicknessToast', { name: el.dataset.sicknessName, level: el.dataset.sicknessLevel }), 'info', 1600);
        };
        el.addEventListener('pointerdown', (e) => {
            start = { id: e.pointerId, x: e.clientX, y: e.clientY };
        });
        el.addEventListener('pointerup', (e) => {
            if (!start || start.id !== e.pointerId) return;
            const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
            start = null;
            if (moved > DIET_TAP_MOVE_THRESHOLD) return;
            showName(e);
        });
        el.addEventListener('pointercancel', () => { start = null; });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            showName(e);
        });
    });
}

function treatmentIconSvg() {
    return '<svg class="dock-icon-svg dock-icon-treatment" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="#fee2e2" stroke="#fff" stroke-width="3"/><path d="M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7Z" fill="#dc2626" stroke="#991b1b" stroke-width="1" stroke-linejoin="round"/></svg>';
}

function cellStatusText(pet) {
    const sickness = getActiveSickness(pet);
    if (sickness) return t('cellStatusSick', { sickness: sicknessName(sickness.def), level: getEffectiveSicknessSeverity(pet) });
    const traumaCount = getPermanentTraumaCount(pet);
    if (traumaCount) return t('cellStatusTrauma', { count: traumaCount, max: CONFIG.trauma.max });
    return t('cellStatusNormal');
}

function stopCellGame() {
    if (cellTimer) { clearInterval(cellTimer); cellTimer = null; }
    cellHits = 0;
}

function wishReferencePreviewHtml(src) {
    if (!src) {
        return `<div class="wish-ref-empty">${escapeHtml(t('cellWishRefEmpty'))}</div>`;
    }
    return `<img class="wish-ref-img" src="${escapeHtml(src)}" alt="${escapeHtml(t('cellWishRefAlt'))}">`;
}

function setWishReferencePreview(box, src) {
    if (!box) return;
    box.innerHTML = wishReferencePreviewHtml(src);
    box.classList.toggle('has-image', !!src);
}

function splitImageDataUri(dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/);
    return match ? { mimeType: match[1], base64: match[2] } : { mimeType: 'image/png', base64: String(dataUrl || '') };
}

function base64ByteSize(base64) {
    const text = String(base64 || '');
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

function dataUriByteSize(dataUrl) {
    return base64ByteSize(splitImageDataUri(dataUrl).base64);
}

function canvasToReferenceDataUrl(img, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('cellWishCompressFailed'));
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
}

function compressWishReferenceDataUrl(dataUrl, maxBytes = WISH_REF_IMAGE_MAX_BYTES) {
    return new Promise((resolve, reject) => {
        if (!dataUrl || dataUriByteSize(dataUrl) <= maxBytes) {
            resolve(dataUrl);
            return;
        }
        const img = new Image();
        img.onload = () => {
            try {
                let width = img.naturalWidth || img.width || 1;
                let height = img.naturalHeight || img.height || 1;
                let smallest = '';
                let smallestSize = Infinity;

                for (let scaleIter = 0; scaleIter < WISH_REF_IMAGE_MAX_SCALE_ITERATIONS; scaleIter++) {
                    for (const quality of WISH_REF_IMAGE_QUALITY_STEPS) {
                        const next = canvasToReferenceDataUrl(img, width, height, quality);
                        const nextSize = dataUriByteSize(next);
                        if (nextSize < smallestSize) {
                            smallest = next;
                            smallestSize = nextSize;
                        }
                        if (nextSize <= maxBytes) {
                            resolve(next);
                            return;
                        }
                    }
                    width = Math.max(1, Math.floor(width / 2));
                    height = Math.max(1, Math.floor(height / 2));
                }

                resolve(smallest || dataUrl);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error(t('cellWishPreviewFailed')));
        img.src = dataUrl;
    });
}

function readWishReferenceImage(file) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\//i.test(file.type || '')) {
            reject(new Error(t('cellWishSelectImage')));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(t('cellWishReadFailed')));
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            if (!dataUrl) { reject(new Error(t('cellWishReadFailed'))); return; }
            compressWishReferenceDataUrl(dataUrl).then(resolve).catch(reject);
        };
        reader.readAsDataURL(file);
    });
}

function showWishModal(pet, ctx) {
    if (!pet) return;
    if (pet.stage !== 'egg') {
        showToast(t('cellWishOnlyEgg'), 'info', 1800);
        return;
    }
    const current = String(pet.wishPrompt || '').slice(0, WISH_MAX_LEN);
    let referenceImage = typeof pet.wishReferenceImage === 'string' ? pet.wishReferenceImage : '';
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card wish-modal-card">
            <div class="text-base font-bold mb-3" style="color:var(--text-primary)">${escapeHtml(t('cellWishTitle'))}</div>
            <textarea data-wish-input maxlength="${WISH_MAX_LEN}" rows="5"
                placeholder="${escapeHtml(t('cellWishPlaceholder', { max: WISH_MAX_LEN }))}"
                style="width:100%;padding:10px;border-radius:12px;border:1.5px solid var(--border-card);background:var(--input-bg);color:var(--text-primary);font-size:14px;line-height:1.5;resize:vertical">${escapeHtml(current)}</textarea>
            <div class="text-xs mt-1" style="color:var(--text-muted);text-align:right">
                <span data-wish-count>${current.length}</span> / ${WISH_MAX_LEN}
            </div>
            <div class="wish-ref-block">
                <div class="wish-ref-preview ${referenceImage ? 'has-image' : ''}" data-wish-ref-preview>${wishReferencePreviewHtml(referenceImage)}</div>
                <input data-wish-ref-input type="file" accept="image/*" hidden>
                <div class="wish-ref-actions">
                    <button class="btn-secondary" data-wish-act="pick-image">${escapeHtml(t('cellWishPickImage'))}</button>
                    <button class="btn-secondary" data-wish-act="remove-image" ${referenceImage ? '' : 'disabled'}>${escapeHtml(t('cellWishRemoveImage'))}</button>
                </div>
            </div>
            <div class="flex gap-2 justify-end mt-3">
                <button class="btn-secondary" data-wish-act="clear">${escapeHtml(t('cellWishClear'))}</button>
                <button class="btn-secondary" data-wish-act="cancel">${escapeHtml(t('cancel'))}</button>
                <button class="btn-primary" data-wish-act="ok">${escapeHtml(t('cellWishSave'))}</button>
            </div>
        </div>`;
    const input = mask.querySelector('[data-wish-input]');
    const counter = mask.querySelector('[data-wish-count]');
    const refInput = mask.querySelector('[data-wish-ref-input]');
    const refPreview = mask.querySelector('[data-wish-ref-preview]');
    const removeImageBtn = mask.querySelector('[data-wish-act="remove-image"]');
    const updateCount = () => {
        if (counter) counter.textContent = String((input.value || '').length);
    };
    const updateReferenceImage = (src) => {
        referenceImage = src || '';
        setWishReferencePreview(refPreview, referenceImage);
        if (removeImageBtn) removeImageBtn.disabled = !referenceImage;
    };
    input.addEventListener('input', updateCount);
    refInput?.addEventListener('change', async () => {
        const file = refInput.files?.[0];
        if (!file) return;
        try {
            updateReferenceImage(await readWishReferenceImage(file));
            showToast(t('cellWishRefAdded'), 'success', 1400);
        } catch (e) {
            showToast(e?.message || t('cellWishRefFailed'), 'error', 1800);
        } finally {
            refInput.value = '';
        }
    });
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask) { close(); return; }
        const act = e.target.closest?.('[data-wish-act]')?.dataset.wishAct;
        if (act === 'cancel') { close(); return; }
        if (act === 'pick-image') { refInput?.click(); return; }
        if (act === 'remove-image') { updateReferenceImage(''); return; }
        if (act === 'clear') { input.value = ''; updateCount(); updateReferenceImage(''); return; }
        if (act === 'ok') {
            const txt = (input.value || '').trim().slice(0, WISH_MAX_LEN);
            pet.wishPrompt = txt || null;
            pet.wishReferenceImage = referenceImage || null;
            savePetDebounced(pet);
            showToast(txt || referenceImage ? t('cellWishSaved') : t('cellWishCleared'), 'success', 1600);
            close();
            // 刷新 dock 文本
            try { refreshCellDock(pet, ctx); } catch (_) {}
        }
    });
    document.body.appendChild(mask);
    setTimeout(() => input.focus(), 30);
}

function stopCellFaceTick() {
    cellFaceTickCleanup?.();
}

function refreshCellDock(pet, ctx) {
    const dock = ctx.dock;
    if (!dock) return;
    dock.innerHTML = cellLevel.dockHtml(pet);
    cellLevel.bindDock(pet, ctx);
    window.dispatchEvent(new Event('mh:tick'));
}

export const cellLevel = {
    id: 'cell',
    index: 3,
    wipeColor: 'linear-gradient(180deg, #1584e7 0%, #1d9ee8 44%, #34b9dc 100%)',
    minCamera: 0.6,    // 拉远 → zoomOut 回 pet
    maxCamera: 1.7,    // 推近 → 已经是最深层，不再切换
    bestCamera: 1.0,
    minVisualScale: 0.9,
    enterFromAbove: 0.85,
    enterFromInner: 1.0,

    stageHtml(pet) {
        return `
            <div class="cell-bg"></div>
            <div class="cell-drift-layer" aria-hidden="true">
                <span class="cell-float cell-float-cell c1"></span>
                <span class="cell-float cell-float-cell c2"></span>
                <span class="cell-float cell-float-cell c3"></span>
                <span class="cell-float cell-float-drop d1"></span>
                <span class="cell-float cell-float-drop d2"></span>
                <span class="cell-float cell-float-leaf l1"></span>
                <span class="cell-float cell-float-leaf l2"></span>
                <span class="cell-float cell-float-dna n1"></span>
                <span class="cell-float cell-float-dna n2"></span>
                ${dietFloatHtml(pet)}
            </div>

            ${traumaLayerHtml(pet)}
            ${sicknessLayerHtml(pet)}

            <div class="cell-face-wrap ${isPetSleeping(pet) ? 'is-sleeping' : `is-awake ${cellFaceStateClass(pet)}`} ${!isPetSleeping(pet) && shouldShowCellHungerCue(pet) ? 'is-hungry' : ''}" style="${cellFaceStyle(pet)}" aria-hidden="true">
                <svg class="cell-face-svg" viewBox="0 0 200 190" role="img" aria-label="细胞精灵">
                    <defs>
                        <radialGradient id="cellFaceBody" cx="46%" cy="40%" r="72%">
                            <stop offset="0" stop-color="var(--cell-face-hi)"/>
                            <stop offset="0.45" stop-color="var(--cell-face-hi)"/>
                            <stop offset="0.66" stop-color="var(--cell-face-mid)"/>
                            <stop offset="0.86" stop-color="var(--cell-face-low)"/>
                            <stop offset="1" stop-color="var(--cell-face-deep)"/>
                        </radialGradient>
                        <radialGradient id="cellFaceSheen" cx="32%" cy="20%" r="55%">
                            <stop offset="0" stop-color="rgba(255,255,255,0.92)"/>
                            <stop offset="0.6" stop-color="rgba(255,255,255,0.18)"/>
                            <stop offset="1" stop-color="rgba(255,255,255,0)"/>
                        </radialGradient>
                        <filter id="cellFaceSoft" x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation="1.1"/>
                        </filter>
                    </defs>

                    <!-- cloud / brain shaped body: rounded bumpy outline -->
                    <path class="cell-face-body" d="M100 28
                        C120 18 150 24 158 46
                        C176 48 186 66 178 84
                        C188 100 180 124 160 128
                        C156 150 130 158 112 148
                        C104 156 90 156 84 148
                        C64 158 40 148 38 126
                        C18 122 12 98 24 82
                        C16 64 28 46 46 46
                        C54 24 82 18 100 28 Z"/>

                    <!-- brain-like wrinkle lines (subtle, cute) -->
                    <g class="cell-face-folds" filter="url(#cellFaceSoft)">
                        <path d="M100 40 C92 52 108 60 100 74"/>
                        <path d="M64 60 C76 66 70 80 80 86"/>
                        <path d="M136 60 C124 66 130 80 120 86"/>
                        <path d="M58 104 C70 102 74 114 64 122"/>
                        <path d="M142 104 C130 102 126 114 136 122"/>
                    </g>

                    <!-- glossy highlight -->
                    <ellipse class="cell-face-sheen" cx="74" cy="58" rx="40" ry="30"/>

                    <circle class="cell-face-blush left" cx="58" cy="106" r="11"/>
                    <circle class="cell-face-blush right" cx="142" cy="106" r="11"/>

                    <!-- HAPPY: big sparkly round eyes ^o^ -->
                    <g class="cell-face-expression cell-face-expression-happy">
                        <ellipse class="cell-face-shine-eye left" cx="74" cy="94" rx="14" ry="17"/>
                        <ellipse class="cell-face-shine-eye right" cx="126" cy="94" rx="14" ry="17"/>
                        <ellipse class="cell-face-eye-glint left" cx="69" cy="87" rx="5" ry="6"/>
                        <ellipse class="cell-face-eye-glint right" cx="121" cy="87" rx="5" ry="6"/>
                        <circle class="cell-face-eye-glint-small left" cx="79" cy="99" r="2.6"/>
                        <circle class="cell-face-eye-glint-small right" cx="131" cy="99" r="2.6"/>
                        <path class="cell-face-mouth" d="M84 124 Q100 142 116 124"/>
                        <path class="cell-face-tongue" d="M93 131 Q100 139 107 131 Q100 137 93 131 Z"/>
                    </g>

                    <!-- WORRIED: big eyes with raised brows -->
                    <g class="cell-face-expression cell-face-expression-worried">
                        <path class="cell-face-brow left" d="M60 74 Q74 67 89 75"/>
                        <path class="cell-face-brow right" d="M111 75 Q126 67 140 74"/>
                        <ellipse class="cell-face-open-eye left" cx="74" cy="96" rx="13" ry="15"/>
                        <ellipse class="cell-face-open-eye right" cx="126" cy="96" rx="13" ry="15"/>
                        <circle class="cell-face-iris left" cx="74" cy="99" r="8"/>
                        <circle class="cell-face-iris right" cx="126" cy="99" r="8"/>
                        <circle class="cell-face-pupil left" cx="74" cy="99" r="4"/>
                        <circle class="cell-face-pupil right" cx="126" cy="99" r="4"/>
                        <circle class="cell-face-eye-glint left" cx="70" cy="93" r="3"/>
                        <circle class="cell-face-eye-glint right" cx="122" cy="93" r="3"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M88 128 Q100 122 112 128"/>
                    </g>

                    <!-- SAD: big teary puppy eyes -->
                    <g class="cell-face-expression cell-face-expression-sad">
                        <path class="cell-face-brow left" d="M58 80 Q74 73 90 82"/>
                        <path class="cell-face-brow right" d="M110 82 Q126 73 142 80"/>
                        <ellipse class="cell-face-open-eye left" cx="74" cy="100" rx="14" ry="15"/>
                        <ellipse class="cell-face-open-eye right" cx="126" cy="100" rx="14" ry="15"/>
                        <circle class="cell-face-iris left" cx="74" cy="104" r="9"/>
                        <circle class="cell-face-iris right" cx="126" cy="104" r="9"/>
                        <circle class="cell-face-pupil left" cx="74" cy="104" r="4.4"/>
                        <circle class="cell-face-pupil right" cx="126" cy="104" r="4.4"/>
                        <circle class="cell-face-eye-glint left" cx="69" cy="99" r="3.6"/>
                        <circle class="cell-face-eye-glint right" cx="121" cy="99" r="3.6"/>
                        <circle class="cell-face-eye-glint-small left" cx="79" cy="107" r="2"/>
                        <circle class="cell-face-eye-glint-small right" cx="131" cy="107" r="2"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M88 134 Q100 125 112 134"/>
                        <path class="cell-face-tear left" d="M60 110 C53 119 54 128 62 131 C70 128 69 119 60 110 Z"/>
                        <path class="cell-face-tear right" d="M140 112 C133 121 134 130 142 133 C150 130 149 121 140 112 Z"/>
                    </g>

                    <!-- SICK: cozy closed ^_^ smiley arcs (still cute) -->
                    <g class="cell-face-expression cell-face-expression-sick">
                        <path class="cell-face-arc-eye left" d="M60 100 Q74 88 88 100"/>
                        <path class="cell-face-arc-eye right" d="M112 100 Q126 88 140 100"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M86 124 C92 120 96 129 102 125 C108 121 112 123 116 128"/>
                        <ellipse class="cell-face-sick-cheek left" cx="58" cy="112" rx="9" ry="6"/>
                        <ellipse class="cell-face-sick-cheek right" cx="142" cy="112" rx="9" ry="6"/>
                        <path class="cell-face-sweat" d="M142 86 C136 94 136 102 142 106 C150 102 149 94 142 86 Z"/>
                    </g>

                    <!-- CRITICAL: simple dizzy X eyes; avoid crescent blobs on small screens -->
                    <g class="cell-face-expression cell-face-expression-critical">
                        <path class="cell-face-squint-eye left" d="M62 91 L86 113 M86 91 L62 113"/>
                        <path class="cell-face-squint-eye right" d="M114 91 L138 113 M138 91 L114 113"/>
                        <ellipse class="cell-face-mouth-o" cx="100" cy="131" rx="9" ry="8"/>
                        <path class="cell-face-sweat" d="M140 88 C134 96 134 104 140 108 C148 104 147 96 140 88 Z"/>
                    </g>

                    <!-- SLEEP: closed u_u arcs + Zzz -->
                    <g class="cell-face-expression cell-face-expression-sleep">
                        <path class="cell-face-arc-eye left" d="M60 102 Q74 112 88 102"/>
                        <path class="cell-face-arc-eye right" d="M112 102 Q126 112 140 102"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M90 126 Q100 132 110 126"/>
                        <text class="cell-face-sleep-z z1" x="142" y="80">Z</text>
                        <text class="cell-face-sleep-z z2" x="158" y="62">z</text>
                    </g>

                    <circle class="cell-face-spark s1" cx="44" cy="38" r="3.4"/>
                    <circle class="cell-face-spark s2" cx="160" cy="44" r="2.8"/>
                    <circle class="cell-face-spark s3" cx="100" cy="22" r="2.4"/>
                </svg>
                ${cellElementDecoHtml(pet)}
                ${cellHungerCueHtml()}
            </div>

            <div id="mhCellArena" class="cell-arena"></div>
        `;
    },

    bindStage(pet, _ctx) {
        bindDietFloatIcons();
        bindSicknessIcons();
        bindElementDeco(pet);
        bindCellFaceTap(pet);
        bindCellFaceTick(pet);
        updateCellFaceHealthCue(pet);
    },

    dockHtml(pet) {
        const sickness = getActiveSickness(pet);
        const sleeping = isPetInteractionBlocked(pet);
        const isEgg = pet?.stage === 'egg';
        if (isEgg) {
            const hasWish = !!(pet?.wishPrompt && String(pet.wishPrompt).trim());
            return `
                <div class="mh-dock-row mh-scroll-x dock-action-row">
                    <button type="button" class="btn-secondary action-btn dock-icon-btn" data-act="wish"><span class="dock-icon">🌠</span><span class="dock-label">${hasWish ? escapeHtml(t('cellDockWishEdit')) : escapeHtml(t('cellDockWish'))}</span></button>
                    <button type="button" class="btn-secondary action-btn dock-icon-btn" data-act="storyMaker" title="${escapeHtml(t('cellDockStoryTitle'))}"><span class="dock-icon">📝</span><span class="dock-label">${escapeHtml(t('storyMaker'))}</span></button>
                </div>
                <div class="mh-dock-hint">${hasWish ? escapeHtml(t('cellDockWishHintYes')) : escapeHtml(t('cellDockWishHintNo'))}</div>
            `;
        }
        const sleepingText = sleeping ? sleepingInteractionText(pet) : '';
        return `
            <div class="mh-dock-row mh-scroll-x dock-action-row">
                <button type="button" class="btn-secondary action-btn dock-icon-btn ${sleeping ? 'is-sleep-disabled' : ''}" data-act="chat"${dockDisabledAttrs(sleeping, sleepingText)} title="${escapeHtml(sleepingText)}"><span class="dock-icon">💬</span><span class="dock-label">${escapeHtml(t('cellDockChat'))}</span></button>
                ${sickness ? `<button type="button" class="btn-secondary action-btn dock-icon-btn cell-treat-btn ${sleeping ? 'is-sleep-disabled' : ''}" data-act="treatSickness"${dockDisabledAttrs(sleeping, sleepingText)} title="${sleeping ? escapeHtml(sleepingText) : escapeHtml(t('cellDockTreatTitle'))}"><span class="dock-icon">${treatmentIconSvg()}</span><span class="dock-label">${escapeHtml(t('cellDockTreat'))}</span></button>` : ''}
                <button type="button" class="btn-secondary action-btn dock-icon-btn" data-act="storyMaker" title="${escapeHtml(t('cellDockStoryTitle'))}"><span class="dock-icon">📝</span><span class="dock-label">${escapeHtml(t('storyMaker'))}</span></button>
            </div>
            <div class="mh-dock-hint">${escapeHtml(cellStatusText(pet))}</div>
        `;
    },

    bindDock(pet, ctx) {
        const dock = ctx.dock;
        if (!dock) return;
        dock.querySelectorAll('[data-act]').forEach(el => {
            el.onclick = () => {
                if (isDockButtonDisabled(el)) { showDockDisabledToast(el); return; }
                const k = el.dataset.act;
                console.log('[Cell Dock] Button clicked:', k);
                // Defer so this tap's trailing native click is swallowed by the
                // still-mounted dock before any new window mounts.
                setTimeout(() => {
                    try {
                        console.log('[Cell Dock] Executing action:', k, 'callbacks:', !!ctx.callbacks, 'onNav:', !!ctx.callbacks?.onNav);
                        if (k === 'chat') { 
                            if (ctx.callbacks?.onNav) {
                                ctx.callbacks.onNav('chat');
                            } else {
                                console.warn('[Cell Dock] onNav callback not available for chat');
                                showToast(t('cellNavUnavailable'), 'error', 1800);
                            }
                            return; 
                        }
                        if (k === 'storyMaker') { 
                            if (ctx.callbacks?.onNav) {
                                console.log('[Cell Dock] Calling onNav for storyMaker');
                                ctx.callbacks.onNav('storyMaker', { origin: 'home' });
                            } else {
                                console.warn('[Cell Dock] onNav callback not available for storyMaker');
                                showToast(t('cellNavUnavailable'), 'error', 1800);
                            }
                            return; 
                        }
                        if (k === 'wish') showWishModal(pet, ctx);
                        if (k === 'treatSickness') {
                            if (ctx.callbacks?.onTreatSickness) {
                                ctx.callbacks.onTreatSickness();
                            } else {
                                console.warn('[Cell Dock] onTreatSickness callback not available');
                                showToast(t('cellTreatUnavailable'), 'error', 1800);
                            }
                        }
                    } catch (e) {
                        console.error('[Cell Dock] Action failed:', k, e);
                        showToast(t('cellActionFailed', { error: (e?.message || e) }), 'error', 2000);
                    }
                }, 0);
            };
        });
    },

    onLeave() { stopCellGame(); stopCellFaceTick(); },
};

export { stopCellGame };
