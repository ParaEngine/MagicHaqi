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
