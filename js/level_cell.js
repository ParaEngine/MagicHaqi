// Level 3 — Cell：体内观察与蛋阶段许愿

import { $, escapeHtml, showToast } from './utils.js';
import { CONFIG } from './config.js';
import { state } from './state.js';
import { savePetDebounced } from './storage.js';
import { getPermanentTraumaCount } from './petTick.js';
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

const CELL_FACE_PALETTES = {
    '雪白色': ['#fff7ed', '#f4f8ff', '#bed6ff', '#7aa7f7'],
    '奶白色': ['#fff7d6', '#ffeec2', '#f7c873', '#d79531'],
    '金黄色': ['#fff176', '#ffd447', '#f59e0b', '#b45309'],
    '焦糖色': ['#ffd7a3', '#f6ad55', '#d97706', '#92400e'],
    '巧克力色': ['#d9a066', '#9a5b33', '#6b341f', '#3f1f14'],
    '粉色': ['#ffc2df', '#fb8fc7', '#ec4899', '#be185d'],
    '薄荷绿': ['#b8ffe1', '#6ee7b7', '#22c55e', '#15803d'],
    '天蓝色': ['#b9efff', '#67d9ff', '#0ea5e9', '#0369a1'],
    '薰衣草紫': ['#d8c7ff', '#a78bfa', '#7c3aed', '#4c1d95'],
    '玫瑰红': ['#ffc0ca', '#fb7185', '#e11d48', '#9f1239'],
    '彩虹色': ['#fff176', '#fb8fc7', '#60a5fa', '#7c3aed'],
    '渐变色': ['#b8ffe1', '#93c5fd', '#a78bfa', '#ec4899'],
    '银灰色': ['#f8fafc', '#cbd5e1', '#64748b', '#334155'],
    '黑色': ['#a3a3a3', '#52525b', '#27272a', '#09090b'],
    '橘色': ['#ffd0a1', '#fb923c', '#f97316', '#c2410c'],
    '杏色': ['#ffe4c7', '#fdba74', '#f59e0b', '#b45309'],
};

function dietKindLabel(kind) {
    return kind === 'meat' ? '肉类' : '蔬菜';
}

function cellFaceStyle(pet) {
    const traits = decodeDna(pet?.dna || '');
    const palette = CELL_FACE_PALETTES[traits.color] || CELL_FACE_PALETTES['薰衣草紫'];
    return `--cell-face-hi:${palette[0]};--cell-face-mid:${palette[1]};--cell-face-low:${palette[2]};--cell-face-deep:${palette[3]}`;
}

function shouldShowCellHungerCue(pet) {
    if (pet?.stage === 'egg') return false;
    const stats = pet?.stats || {};
    return (stats.hunger ?? 100) < 50;
}

function cellFaceExpression(pet) {
    if (pet?.stage === 'egg') return 'happy';
    const stats = pet?.stats || {};
    const mood = stats.mood ?? 100;
    if (mood < 25) return 'sad';
    if (mood < 50) return 'worried';
    return 'happy';
}

function cellFaceStateClass(pet) {
    return `is-expression-${cellFaceExpression(pet)}`;
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
    if (preference === 'both') return `DNA 提示：这只宠物是杂食，${dietKindLabel(kind)}也喜欢。`;
    return `DNA 提示：这只宠物偏爱${dietPreferenceLabel(preference)}食物。`;
}

function dietFloatHtml(pet) {
    const preference = dnaDietPreference(pet?.dna || '');
    const label = dietPreferenceLabel(preference);
    return dietPreferenceIcons(preference).map((kind, index) => `
        <span class="cell-float cell-float-diet diet-${kind} diet-${index + 1}" role="button" tabindex="0"
            aria-label="${escapeHtml(label)} DNA 食物提示" title="${escapeHtml(label)} DNA"
            data-diet-kind="${escapeHtml(kind)}" data-diet-preference="${escapeHtml(preference)}">
            ${DIET_FLOAT_EMOJIS[kind] || ''}
        </span>
    `).join('');
}

function bindDietFloatIcons() {
    document.querySelectorAll('.cell-float-diet[data-diet-kind]').forEach(el => {
        let start = null;
        el.addEventListener('pointerdown', (e) => {
            start = { id: e.pointerId, x: e.clientX, y: e.clientY };
        });
        el.addEventListener('pointerup', (e) => {
            if (!start || start.id !== e.pointerId) return;
            const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
            start = null;
            if (moved > DIET_TAP_MOVE_THRESHOLD) return;
            showToast(dietToastText(el.dataset.dietKind, el.dataset.dietPreference), 'info', 1800);
        });
        el.addEventListener('pointercancel', () => { start = null; });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            showToast(dietToastText(el.dataset.dietKind, el.dataset.dietPreference), 'info', 1800);
        });
    });
}

function traumaLayerHtml(pet) {
    const count = getPermanentTraumaCount(pet);
    if (!count) return '';
    return `
        <div class="cell-trauma-layer" aria-label="永久精神伤害 ${count} / ${CONFIG.trauma.max}">
            ${Array.from({ length: count }, (_, index) => `<span class="cell-trauma-mark t${index + 1}" title="永久精神伤害 ${index + 1}/${CONFIG.trauma.max}"><span></span></span>`).join('')}
        </div>
    `;
}

function stopCellGame() {
    if (cellTimer) { clearInterval(cellTimer); cellTimer = null; }
    cellHits = 0;
}

function wishReferencePreviewHtml(src) {
    if (!src) {
        return `<div class="wish-ref-empty">可选：添加一张参考图片，让孵化外观更接近你的想法。</div>`;
    }
    return `<img class="wish-ref-img" src="${escapeHtml(src)}" alt="参考图片预览">`;
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
    if (!ctx) throw new Error('无法压缩图片');
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
        img.onerror = () => reject(new Error('图片格式无法预览'));
        img.src = dataUrl;
    });
}

function readWishReferenceImage(file) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\//i.test(file.type || '')) {
            reject(new Error('请选择图片文件'));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            if (!dataUrl) { reject(new Error('读取图片失败')); return; }
            compressWishReferenceDataUrl(dataUrl).then(resolve).catch(reject);
        };
        reader.readAsDataURL(file);
    });
}

function showWishModal(pet, ctx) {
    if (!pet) return;
    if (pet.stage !== 'egg') {
        showToast('许愿只在蛋阶段可用', 'info', 1800);
        return;
    }
    const current = String(pet.wishPrompt || '').slice(0, WISH_MAX_LEN);
    let referenceImage = typeof pet.wishReferenceImage === 'string' ? pet.wishReferenceImage : '';
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card wish-modal-card">
            <div class="text-base font-bold mb-3" style="color:var(--text-primary)">🌠 为这颗蛋许愿</div>
            <textarea data-wish-input maxlength="${WISH_MAX_LEN}" rows="5"
                placeholder="例如：龙宝宝,眼睛是星星眼…（最多 ${WISH_MAX_LEN} 字)"
                style="width:100%;padding:10px;border-radius:12px;border:1.5px solid var(--border-card);background:var(--input-bg);color:var(--text-primary);font-size:14px;line-height:1.5;resize:vertical">${escapeHtml(current)}</textarea>
            <div class="text-xs mt-1" style="color:var(--text-muted);text-align:right">
                <span data-wish-count>${current.length}</span> / ${WISH_MAX_LEN}
            </div>
            <div class="wish-ref-block">
                <div class="wish-ref-preview ${referenceImage ? 'has-image' : ''}" data-wish-ref-preview>${wishReferencePreviewHtml(referenceImage)}</div>
                <input data-wish-ref-input type="file" accept="image/*" hidden>
                <div class="wish-ref-actions">
                    <button class="btn-secondary" data-wish-act="pick-image">参考图片</button>
                    <button class="btn-secondary" data-wish-act="remove-image" ${referenceImage ? '' : 'disabled'}>移除图片</button>
                </div>
            </div>
            <div class="flex gap-2 justify-end mt-3">
                <button class="btn-secondary" data-wish-act="clear">清除</button>
                <button class="btn-secondary" data-wish-act="cancel">取消</button>
                <button class="btn-primary" data-wish-act="ok">保存许愿</button>
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
            showToast('已添加参考图片', 'success', 1400);
        } catch (e) {
            showToast(e?.message || '添加参考图片失败', 'error', 1800);
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
            showToast(txt || referenceImage ? '已记录你的许愿 ✨' : '已清除许愿', 'success', 1600);
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

            <div class="cell-face-wrap ${isPetSleeping(pet) ? 'is-sleeping' : `is-awake ${cellFaceStateClass(pet)}`} ${!isPetSleeping(pet) && shouldShowCellHungerCue(pet) ? 'is-hungry' : ''}" style="${cellFaceStyle(pet)}" aria-hidden="true">
                <svg class="cell-face-svg" viewBox="0 0 180 180" role="img" aria-label="细胞精灵">
                    <defs>
                        <radialGradient id="cellFaceBody" cx="35%" cy="28%" r="74%">
                            <stop offset="0" stop-color="var(--cell-face-hi)"/>
                            <stop offset="0.55" stop-color="var(--cell-face-low)"/>
                            <stop offset="1" stop-color="var(--cell-face-deep)"/>
                        </radialGradient>
                        <linearGradient id="cellWing" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stop-color="#77e7a8"/>
                            <stop offset="1" stop-color="#2fb976"/>
                        </linearGradient>
                    </defs>
                    <path class="cell-face-feeler" d="M73 54 C55 38 38 34 26 43"/>
                    <circle class="cell-face-tip" cx="26" cy="43" r="8"/>
                    <path class="cell-face-feeler" d="M106 55 C126 34 145 31 158 43"/>
                    <circle class="cell-face-tip" cx="158" cy="43" r="8"/>
                    <ellipse class="cell-face-wing left" cx="54" cy="112" rx="15" ry="25"/>
                    <ellipse class="cell-face-wing right" cx="126" cy="112" rx="15" ry="25"/>
                    <circle class="cell-face-body" cx="90" cy="92" r="58"/>
                    <circle class="cell-face-blush left" cx="54" cy="93" r="7"/>
                    <circle class="cell-face-blush right" cx="126" cy="93" r="7"/>
                    <g class="cell-face-expression cell-face-expression-happy">
                        <path class="cell-face-eye left" d="M68 83 Q74 76 81 83"/>
                        <path class="cell-face-eye right" d="M99 83 Q106 76 113 83"/>
                        <path class="cell-face-mouth" d="M73 101 Q90 124 110 101"/>
                    </g>
                    <g class="cell-face-expression cell-face-expression-worried">
                        <path class="cell-face-brow left" d="M65 76 Q74 72 82 78"/>
                        <path class="cell-face-brow right" d="M98 78 Q106 72 116 76"/>
                        <ellipse class="cell-face-open-eye left" cx="74" cy="86" rx="7.2" ry="8"/>
                        <ellipse class="cell-face-open-eye right" cx="106" cy="86" rx="7.2" ry="8"/>
                        <circle class="cell-face-iris left" cx="74" cy="87" r="4.2"/>
                        <circle class="cell-face-iris right" cx="106" cy="87" r="4.2"/>
                        <circle class="cell-face-pupil left" cx="74" cy="87" r="2"/>
                        <circle class="cell-face-pupil right" cx="106" cy="87" r="2"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M78 105 Q90 101 102 105"/>
                    </g>
                    <g class="cell-face-expression cell-face-expression-sad">
                        <path class="cell-face-brow left" d="M63 77 Q73 73 82 79"/>
                        <path class="cell-face-brow right" d="M98 79 Q107 73 117 77"/>
                        <ellipse class="cell-face-open-eye left" cx="74" cy="88" rx="7" ry="6.4"/>
                        <ellipse class="cell-face-open-eye right" cx="106" cy="88" rx="7" ry="6.4"/>
                        <circle class="cell-face-iris left" cx="74" cy="90" r="3.7"/>
                        <circle class="cell-face-iris right" cx="106" cy="90" r="3.7"/>
                        <circle class="cell-face-pupil left" cx="74" cy="90" r="1.8"/>
                        <circle class="cell-face-pupil right" cx="106" cy="90" r="1.8"/>
                        <circle class="cell-face-eye-glint left" cx="72" cy="87" r="1.4"/>
                        <circle class="cell-face-eye-glint right" cx="104" cy="87" r="1.4"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M78 113 Q90 104 102 113"/>
                        <path class="cell-face-tear left" d="M57 94 C52 101 53 108 59 111 C65 108 65 101 57 94Z"/>
                    </g>
                    <g class="cell-face-expression cell-face-expression-sick">
                        <path class="cell-face-brow left" d="M63 78 Q73 75 83 81"/>
                        <path class="cell-face-brow right" d="M97 81 Q107 75 117 78"/>
                        <path class="cell-face-weary-eye left" d="M67 88 Q74 84 82 88"/>
                        <path class="cell-face-weary-eye right" d="M98 88 Q106 84 114 88"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M78 108 C84 104 88 113 94 109 C99 105 103 107 106 111"/>
                        <path class="cell-face-sweat" d="M124 75 C118 84 118 92 124 96 C132 92 131 84 124 75Z"/>
                    </g>
                    <g class="cell-face-expression cell-face-expression-critical">
                        <path class="cell-face-x-eye left" d="M67 79 L81 91 M81 79 L67 91"/>
                        <path class="cell-face-x-eye right" d="M99 79 L113 91 M113 79 L99 91"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M78 112 Q90 101 102 112"/>
                        <path class="cell-face-sweat" d="M122 76 C117 84 116 91 122 94 C129 91 128 84 122 76Z"/>
                    </g>
                    <g class="cell-face-expression cell-face-expression-sleep">
                        <path class="cell-face-eye left" d="M66 84 Q74 89 82 84"/>
                        <path class="cell-face-eye right" d="M98 84 Q106 89 114 84"/>
                        <path class="cell-face-mouth cell-face-mouth-small" d="M82 106 Q90 112 98 106"/>
                        <text class="cell-face-sleep-z z1" x="119" y="72">Z</text>
                        <text class="cell-face-sleep-z z2" x="130" y="58">Z</text>
                    </g>
                    <circle class="cell-face-spark s1" cx="72" cy="112" r="4"/>
                    <circle class="cell-face-spark s2" cx="108" cy="112" r="3"/>
                </svg>
                ${cellHungerCueHtml()}
            </div>

            <div id="mhCellArena" class="cell-arena"></div>
        `;
    },

    bindStage(pet, _ctx) {
        bindDietFloatIcons();
        bindCellFaceTick(pet);
        updateCellFaceHealthCue(pet);
    },

    dockHtml(pet) {
        const traumaCount = getPermanentTraumaCount(pet);
        const sleeping = isPetInteractionBlocked(pet);
        const isEgg = pet?.stage === 'egg';
        if (isEgg) {
            const hasWish = !!(pet?.wishPrompt && String(pet.wishPrompt).trim());
            return `
                <div class="mh-dock-row mh-scroll-x dock-action-row">
                    <button type="button" class="btn-secondary action-btn dock-icon-btn" data-act="wish"><span class="dock-icon">🌠</span><span class="dock-label">${hasWish ? '修改许愿' : '许愿'}</span></button>
                </div>
                <div class="mh-dock-hint">${hasWish ? '已记录你的许愿，孵化时会按这段描述生成宠物外观。' : '蛋阶段：可以为蛋的最终外观许愿，描述任何你想要的样子。'}</div>
            `;
        }
        return `
            <div class="mh-dock-row mh-scroll-x dock-action-row">
                <button type="button" class="btn-secondary action-btn dock-icon-btn ${sleeping ? 'is-sleep-disabled' : ''}" data-act="chat" ${sleeping ? 'disabled' : ''} title="${sleeping ? escapeHtml(sleepingInteractionText(pet)) : ''}"><span class="dock-icon">💬</span><span class="dock-label">对话</span></button>
            </div>
            <div class="mh-dock-hint">${traumaCount ? `黑色旋风是永久精神伤害：${traumaCount}/${CONFIG.trauma.max}，无法治疗移除。` : '体内一切正常 ✨'}</div>
        `;
    },

    bindDock(pet, ctx) {
        const dock = ctx.dock;
        if (!dock) return;
        dock.querySelectorAll('[data-act]').forEach(el => {
            el.onclick = () => {
                const k = el.dataset.act;
                if (k === 'chat') { ctx.callbacks.onNav?.('chat'); return; }
                if (k === 'wish') showWishModal(pet, ctx);
            };
        });
    },

    onLeave() { stopCellGame(); stopCellFaceTick(); },
};

export { stopCellGame };
