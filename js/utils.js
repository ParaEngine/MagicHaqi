// 通用工具
export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function coinIconSvg(className = 'hud-coin-icon') {
    return `
        <svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" fill="#fbbf24" stroke="#d97706" stroke-width="2"></circle>
            <circle cx="12" cy="12" r="5.5" fill="#fde68a" stroke="#f59e0b" stroke-width="1.5"></circle>
            <path d="M12 7.8v8.4M9.7 9.4h3.2a2 2 0 0 1 0 4H11" fill="none" stroke="#92400e" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>`;
}

// NPC 等图标支持用 URL 片段裁剪图片局部区域：`src#x_y_w_h`，四个值均为原图宽高的百分比 (0-100)。
// 用百分比而非像素，是为了让裁剪结果与容器尺寸无关，天然适配任意展示盒子（沿用 background-size:cover 的自适应习惯）。
export function parseIconSource(icon) {
    const raw = String(icon || '').trim();
    const hashIdx = raw.lastIndexOf('#');
    if (hashIdx === -1) return { src: raw, rect: null };
    const src = raw.slice(0, hashIdx);
    const nums = raw.slice(hashIdx + 1).split('_').map(Number);
    if (nums.length !== 4 || nums.some(n => !Number.isFinite(n))) return { src, rect: null };
    const [x, y, w, h] = nums;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 100.001 || y + h > 100.001) return { src, rect: null };
    return { src, rect: { x, y, w, h } };
}

export function isImageIconValue(icon) {
    return /^(https?:|data:)/i.test(parseIconSource(icon).src);
}

// 返回可直接拼进 style 属性的 background-* 声明；无裁剪区域时退化为整图 contain 展示（保持原始宽高比）。
export function iconBackgroundStyleAttr(icon) {
    const { src, rect } = parseIconSource(icon);
    if (!src) return '';
    const safeSrc = src.replace(/["\\]/g, '');
    if (!rect) return `background-image:url("${safeSrc}");background-size:contain;background-position:center;background-repeat:no-repeat;`;
    const { x, y, w, h } = rect;
    const sizeX = 10000 / w;
    const sizeY = 10000 / h;
    const posX = (100 - w) > 0.001 ? (100 * x / (100 - w)) : 0;
    const posY = (100 - h) > 0.001 ? (100 * y / (100 - h)) : 0;
    return `background-image:url("${safeSrc}");background-size:${sizeX.toFixed(3)}% ${sizeY.toFixed(3)}%;background-position:${posX.toFixed(3)}% ${posY.toFixed(3)}%;background-repeat:no-repeat;`;
}

const NATURAL_IMAGE_SIZE_CACHE = new Map();

// 加载并缓存图片的原始像素宽高（用于按裁剪区域的真实宽高比重新设定展示盒子，避免拉伸变形）。
export function loadNaturalImageSize(src) {
    if (!src) return Promise.resolve(null);
    const cached = NATURAL_IMAGE_SIZE_CACHE.get(src);
    if (cached) return cached;
    const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        img.onerror = () => resolve(null);
        img.src = src;
    });
    NATURAL_IMAGE_SIZE_CACHE.set(src, promise);
    return promise;
}

// 整图（无裁剪）时 background-size:contain 已能在任意展示盒子内保持宽高比，无需调用本函数。
// 裁剪局部区域时，percentage 拉伸铺满展示盒子，若盒子宽高比与裁剪区域真实像素宽高比不同就会变形；
// 本函数异步读取原图真实尺寸，把元素的宽高改成裁剪区域的真实宽高比（在给定的最大边长内），铺满后即不再变形。
export async function fitIconCropAspectRatio(el, icon, boxSize) {
    if (!el) return;
    const { src, rect } = parseIconSource(icon);
    if (!src || !rect) return;
    const size = await loadNaturalImageSize(src);
    if (!size || !size.width || !size.height) return;
    const cropWidth = size.width * rect.w / 100;
    const cropHeight = size.height * rect.h / 100;
    if (cropWidth <= 0 || cropHeight <= 0) return;
    const ratio = cropWidth / cropHeight;
    const width = ratio >= 1 ? boxSize : Math.max(1, Math.round(boxSize * ratio));
    const height = ratio >= 1 ? Math.max(1, Math.round(boxSize / ratio)) : boxSize;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
}

export function renderVisualAsset(visual, { className = '', alt = '', draggable = false } = {}) {
    if (!visual || typeof visual !== 'object') return '';
    const imageUrl = String(visual.imageUrl || '').trim();
    if (imageUrl) {
        const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
        return `<img${classAttr} crossorigin="anonymous" referrerpolicy="no-referrer" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" draggable="${draggable ? 'true' : 'false'}">`;
    }
    return String(visual.svg || '').trim();
}

let toastTimer = null;
export function showToast(msg, type = 'info', duration = 3600) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    const ms = Math.max(2800, Number(duration) || 3600);
    toastTimer = setTimeout(() => el.remove(), ms);
}

export function dockDisabledAttrs(disabled, reason) {
    if (!disabled) return '';
    const text = String(reason || '暂时不能点击。');
    return ` aria-disabled="true" data-disabled="true" data-disabled-reason="${escapeHtml(text)}"`;
}

export function isDockButtonDisabled(btn) {
    return btn?.dataset?.disabled === 'true' || btn?.getAttribute?.('aria-disabled') === 'true';
}

export function setDockButtonDisabled(btn, disabled, reason) {
    if (!btn) return;
    btn.classList.toggle('is-sleep-disabled', !!disabled);
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (disabled) {
        btn.dataset.disabled = 'true';
        btn.dataset.disabledReason = reason || '暂时不能点击。';
    } else {
        delete btn.dataset.disabled;
        delete btn.dataset.disabledReason;
    }
}

export function showDockDisabledToast(btn) {
    const reason = btn?.dataset?.disabledReason || btn?.title || '暂时不能点击。';
    showToast(reason, 'info', 2200);
}

export function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randId(len = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[randInt(0, chars.length - 1)];
    return s;
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function debounce(fn, wait = 500) {
    let t = null;
    return function (...args) {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

export function showModal(html) {
    return new Promise((resolve) => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `<div class="modal-card">${html}</div>`;
        const close = (val) => {
            mask.remove();
            resolve(val);
        };
        mask.addEventListener('click', (e) => { if (e.target === mask) close(null); });
        document.body.appendChild(mask);
        // expose close to caller via dataset
        mask._close = close;
    });
}

export function closeModal(maskEl, val) {
    if (maskEl && typeof maskEl._close === 'function') maskEl._close(val);
}

export async function confirm(message, { okText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal-card text-center">
                <div class="text-base font-bold mb-3" style="color:var(--text-primary)">${escapeHtml(message)}</div>
                <div class="flex gap-2 justify-center mt-4">
                    <button class="btn-secondary" data-act="cancel">${escapeHtml(cancelText)}</button>
                    <button class="btn-primary" data-act="ok">${escapeHtml(okText)}</button>
                </div>
            </div>`;
        const done = (v) => { mask.remove(); resolve(v); };
        mask.addEventListener('click', (e) => {
            if (e.target === mask) done(false);
            const act = e.target.closest?.('[data-act]')?.dataset.act;
            if (act === 'ok') done(true);
            if (act === 'cancel') done(false);
        });
        document.body.appendChild(mask);
    });
}

/**
 * 模态输入框。返回 trim 后的字符串；用户取消（点遮罩 / 取消按钮）→ 返回 null。
 * 选项：{ title, hint, placeholder, defaultValue, okText, cancelText, maxLength, dismissable, validate }
 *  - dismissable=false 时禁用遮罩点击和取消按钮，强制必须输入。
 *  - validate(v) → 返回错误字符串则阻止确认；返回 '' / falsy 视为通过。
 */
export async function prompt(title, opts = {}) {
    const {
        hint = '',
        placeholder = '',
        defaultValue = '',
        okText = '确定',
        cancelText = '取消',
        randomText = '🎲 随机',
        maxLength = 16,
        dismissable = true,
        validate = null,
        onRandom = null,
        randomValues = null,
    } = opts;
    const hasRandom = typeof onRandom === 'function' || (Array.isArray(randomValues) && randomValues.length > 0);
    return new Promise((resolve) => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal-card">
                <div class="text-base font-bold mb-2" style="color:var(--text-primary)">${escapeHtml(title)}</div>
                ${hint ? `<div class="text-xs mb-3" style="color:var(--text-muted)">${escapeHtml(hint)}</div>` : ''}
                <input class="modal-input" data-input maxlength="${maxLength}"
                    placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
                <div class="text-xs mt-1" data-err style="color:#b91c1c;min-height:16px"></div>
                <div class="flex gap-2 justify-end mt-3">
                    ${hasRandom ? `<button class="btn-secondary" data-act="random">${escapeHtml(randomText)}</button>` : ''}
                    ${dismissable ? `<button class="btn-secondary" data-act="cancel">${escapeHtml(cancelText)}</button>` : ''}
                    <button class="btn-primary" data-act="ok">${escapeHtml(okText)}</button>
                </div>
            </div>`;
        const input = mask.querySelector('[data-input]');
        const errBox = mask.querySelector('[data-err]');
        const done = (v) => { mask.remove(); resolve(v); };
        const tryOk = () => {
            const v = (input.value || '').trim();
            if (validate) {
                const err = validate(v);
                if (err) { errBox.textContent = err; return; }
            }
            done(v);
        };
        const pickRandom = async () => {
            try {
                let v = '';
                if (typeof onRandom === 'function') {
                    v = await onRandom(input.value || '');
                } else if (Array.isArray(randomValues) && randomValues.length) {
                    v = randomValues[Math.floor(Math.random() * randomValues.length)];
                }
                if (typeof v === 'string' && v) {
                    input.value = maxLength ? v.slice(0, maxLength) : v;
                    errBox.textContent = '';
                    input.focus();
                }
            } catch (_) {}
        };
        mask.addEventListener('click', (e) => {
            if (e.target === mask) { if (dismissable) done(null); return; }
            const act = e.target.closest?.('[data-act]')?.dataset.act;
            if (act === 'ok') tryOk();
            else if (act === 'cancel' && dismissable) done(null);
            else if (act === 'random') pickRandom();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); tryOk(); }
            else if (e.key === 'Escape' && dismissable) { e.preventDefault(); done(null); }
        });
        document.body.appendChild(mask);
        setTimeout(() => input.focus(), 30);
    });
}
