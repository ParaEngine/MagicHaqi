// 登录视图
import { $, escapeHtml, showToast } from './utils.js';
import { getLang, setLang, t } from './i18n.js';
import { state } from './state.js';

const DECOR_PLANETS = [
    { left: '14%', top: '22%', scale: 0.42, hue: 200, ring: true },
    { left: '82%', top: '30%', scale: 0.30, hue: 28,  ring: false },
    { left: '76%', top: '78%', scale: 0.36, hue: 286, ring: true  },
    { left: '20%', top: '74%', scale: 0.24, hue: 140, ring: false },
];

function decorPlanetHtml(p) {
    const transform = `translate(-50%, -50%) scale(${p.scale})`;
    return `
        <div class="space-planet" style="left:${p.left};top:${p.top};--planet-hue:${p.hue};transform:${transform};pointer-events:none">
            ${p.ring ? '<div class="planet-ring"></div>' : ''}
            <div class="planet-body">
                <div class="planet-surface">
                    <div class="planet-glow"></div>
                    <div class="planet-cont planet-cont-1"></div>
                    <div class="planet-cont planet-cont-2"></div>
                    <div class="planet-cont planet-cont-3"></div>
                </div>
            </div>
        </div>`;
}

function actionAreaHtml(mode) {
    if (mode === 'loggingIn') {
        return `
            <div id="mhLoginPending" class="flex flex-col items-center" style="padding:8px 0">
                <div class="mh-login-spinner" aria-hidden="true"></div>
                <div class="text-base mt-3" style="color:#e8f7ff;text-shadow:0 0 12px rgba(84,226,255,0.55)">
                    ${escapeHtml(t('loggingIn'))}
                </div>
            </div>`;
    }
    return `
        <button id="mhLoginBtn" class="btn-primary text-base" style="padding:12px 36px">
            🔑 ${escapeHtml(t('login'))}
        </button>`;
}

// 登录前的隐私政策 / 用户协议同意行（合规：登录会收集账号信息，需先主动勾选；
// 游客体验不收集个人信息，无需勾选）。
function privacyRowHtml() {
    return `
        <div id="mhLoginPrivacy" class="mh-login-privacy" style="margin-top:14px;margin-bottom:0">
            <div id="mhLoginPrivacyCheck" class="mh-login-checkbox"></div>
            <span style="color:#8ca0c4;font-size:13px">${escapeHtml(t('loginPrivacyPrefix'))}</span>
            <span id="mhLoginPrivacyLink1" class="mh-login-privacy-link">${escapeHtml(t('loginPrivacyLink1'))}</span>
            <span style="color:#8ca0c4;font-size:13px">${escapeHtml(t('loginPrivacyAnd'))}</span>
            <span id="mhLoginPrivacyLink2" class="mh-login-privacy-link">${escapeHtml(t('loginPrivacyLink2'))}</span>
        </div>`;
}

function languageSelectorHtml() {
    const lang = getLang();
    const btnStyle = (active) => [
        'min-width:72px',
        'padding:7px 12px',
        'border-radius:999px',
        'font-size:12px',
        'font-weight:800',
        'letter-spacing:.01em',
        'border:1px solid ' + (active ? 'rgba(152,239,255,0.88)' : 'rgba(157,208,235,0.38)'),
        'color:' + (active ? '#e8f7ff' : '#9fd0eb'),
        'background:' + (active ? 'linear-gradient(135deg,rgba(42,207,255,0.34),rgba(31,96,255,0.28))' : 'rgba(8,24,62,0.28)'),
        'box-shadow:' + (active ? '0 0 16px rgba(84,226,255,0.26), inset 0 1px 0 rgba(255,255,255,0.28)' : 'inset 0 1px 0 rgba(255,255,255,0.10)'),
        'text-shadow:0 1px 3px rgba(6,18,44,0.72)',
        'cursor:pointer',
        'touch-action:manipulation',
    ].join(';');
    return `
        <div class="mt-6 flex flex-col items-center gap-2" aria-label="${escapeHtml(t('language'))}">
            <div class="text-[11px] font-bold uppercase tracking-[0.16em]" style="color:#7fc8ee;text-shadow:0 1px 4px rgba(6,18,44,0.7)">${escapeHtml(t('language'))}</div>
            <div class="flex items-center justify-center gap-2">
                <button id="mhLoginLangZh" type="button" aria-pressed="${lang === 'zh' ? 'true' : 'false'}" style="${btnStyle(lang === 'zh')}">${escapeHtml(t('languageZh'))}</button>
                <button id="mhLoginLangEn" type="button" aria-pressed="${lang === 'en' ? 'true' : 'false'}" style="${btnStyle(lang === 'en')}">${escapeHtml(t('languageEn'))}</button>
            </div>
        </div>`;
}

function offlineOptionHtml() {
    return `
        <div class="mt-3 flex flex-col items-center gap-1" style="max-width:260px">
            <button id="mhOfflineBtn" type="button" style="padding:7px 14px;border-radius:999px;border:1px solid rgba(157,208,235,0.28);background:rgba(8,24,62,0.18);color:#9fd0eb;font-size:12px;font-weight:700;text-shadow:0 1px 3px rgba(6,18,44,0.72);cursor:pointer;touch-action:manipulation">
                ${escapeHtml(t('offlineMode'))}
            </button>
        </div>`;
}

function ensureLoginStyle() {
    if (document.getElementById('mhLoginStyle')) return;
    const style = document.createElement('style');
    style.id = 'mhLoginStyle';
    style.textContent = `
        .mh-login-spinner{width:42px;height:42px;border-radius:50%;border:3px solid rgba(152,239,255,0.25);border-top-color:#7de1ff;box-shadow:0 0 18px rgba(125,225,255,0.45);animation:mhLoginSpin 0.9s linear infinite}
        @keyframes mhLoginSpin{to{transform:rotate(360deg)}}
        .mh-login-privacy{display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:3px;margin-bottom:20px;cursor:pointer}
        .mh-login-checkbox{width:20px;height:20px;border:2px solid rgba(152,239,255,0.45);border-radius:5px;margin-right:6px;flex-shrink:0;transition:all .2s;display:flex;align-items:center;justify-content:center}
        .mh-login-checkbox.checked{background:linear-gradient(135deg,#2acfff,#1f60ff);border-color:transparent}
        .mh-login-checkbox.checked::after{content:'\\2713';font-size:14px;color:#fff;font-weight:700;line-height:1}
        .mh-login-privacy-link{color:#5ecfff;font-size:13px;text-decoration:underline;cursor:pointer}
        .mh-login-privacy-link:hover{color:#7de1ff}
        .mh-modal-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);padding:24px}
        .mh-modal-card{width:100%;max-width:480px;max-height:70vh;background:linear-gradient(160deg,#0f1a3a,#16213e,#1a2468);border:1px solid rgba(152,239,255,0.2);border-radius:20px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
        .mh-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(152,239,255,0.12);flex-shrink:0}
        .mh-modal-title{font-size:16px;font-weight:700;color:#e8f7ff}
        .mh-modal-close{background:none;border:none;color:#8ca0c4;font-size:28px;cursor:pointer;padding:0 4px;line-height:1}
        .mh-modal-body{flex:1;overflow-y:auto;padding:16px 20px 20px;line-height:1.7}
        .mh-modal-scroll{color:#9fd0eb;font-size:13px}
        .mh-modal-scroll a{color:#5ecfff}
        .mh-modal-scroll b{color:#e8f7ff}
    `;
    document.head.appendChild(style);
}

// ─── 从 docs/ 目录加载 Markdown 文档（带缓存） ───
const _mdCache = {};
async function loadMarkdown(filename) {
    if (_mdCache[filename]) return _mdCache[filename];
    const base = (() => {
        try { return new URL('.', import.meta.url).href; }
        catch (_) { return './'; }
    })();
    const url = base + '../../docs/' + filename;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`加载文档失败: ${filename}`);
    const text = await res.text();
    _mdCache[filename] = text;
    return text;
}

// ─── 轻量 Markdown → HTML 渲染器 ───
function markdownToHtml(md) {
    // Escape HTML first
    let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Inline: **bold**
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

    // Inline: [text](url)
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Split into lines
    const lines = html.split('\n');
    const result = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();

        // Empty line: close list if open, push paragraph break
        if (!line) {
            if (inList) { result.push('</ul>'); inList = false; }
            result.push('');
            continue;
        }

        // H2: ## heading
        if (line.startsWith('## ')) {
            if (inList) { result.push('</ul>'); inList = false; }
            result.push(`<p style="color:#fff;font-weight:600;margin-bottom:4px">${line.slice(3)}</p>`);
            continue;
        }

        // H1: # heading
        if (line.startsWith('# ')) {
            if (inList) { result.push('</ul>'); inList = false; }
            result.push(`<p style="color:#e8f7ff;font-weight:700;margin-bottom:12px;font-size:15px">${line.slice(2)}</p>`);
            continue;
        }

        // List item: - text or * text
        if (/^[\-\*] /.test(line)) {
            const item = line.replace(/^[\-\*]\s+/, '');
            if (!inList) { result.push('<ul style="color:#9fd0eb;font-size:12px;line-height:1.8;margin-bottom:12px;padding-left:16px;list-style:disc">'); inList = true; }
            result.push(`<li>${item}</li>`);
            continue;
        }

        // Close list if we were in one and hit a normal line
        if (inList) { result.push('</ul>'); inList = false; }

        // Regular paragraph
        result.push(`<p style="color:#9fd0eb;font-size:12px;line-height:1.7;margin-bottom:12px">${line}</p>`);
    }

    if (inList) result.push('</ul>');

    return '<div class="mh-modal-scroll">' + result.join('\n') + '</div>';
}

// ===== 弹窗（从 docs/ 目录实时加载 Markdown） =====
async function showLoginPrivacyModal() {
    try {
        const md = await loadMarkdown('privacy.md');
        showModal('隐私政策', markdownToHtml(md));
    } catch (e) {
        console.warn('加载隐私政策失败', e);
        showModal('隐私政策', '<div class="mh-modal-scroll"><p style="color:#9fd0eb">文档加载失败，请稍后重试</p></div>');
    }
}

async function showLoginLicenseModal() {
    try {
        const md = await loadMarkdown('license.md');
        showModal('用户协议', markdownToHtml(md));
    } catch (e) {
        console.warn('加载用户协议失败', e);
        showModal('用户协议', '<div class="mh-modal-scroll"><p style="color:#9fd0eb">文档加载失败，请稍后重试</p></div>');
    }
}

function showModal(title, bodyHtml) {
    const existing = document.getElementById('mhLoginPolicyModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mhLoginPolicyModal';
    overlay.className = 'mh-modal-overlay';
    overlay.innerHTML = `
        <div class="mh-modal-card">
            <div class="mh-modal-header">
                <span class="mh-modal-title">${escapeHtml(title)}</span>
                <button id="mhModalClose" class="mh-modal-close">&times;</button>
            </div>
            <div class="mh-modal-body">${bodyHtml}</div>
        </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const closeBtn = overlay.querySelector('#mhModalClose');
    if (closeBtn) closeBtn.onclick = close;
}

// ===== 主入口 =====
export function renderLogin(panel, _data, { onLogin, onOffline, mode, sharedGame = null } = {}) {
    if (mode == null) mode = 'login';
    ensureLoginStyle();
    const appTitle = String(state.settings?.starSettlement?.appTitle || '').trim() || t('appName');
    const shareOwner = String(sharedGame?.fromUsername || '').trim();
    const isShare = !!(shareOwner || String(sharedGame?.game || '').trim());
    const shareTitle = shareOwner
        ? t('mgShareLoginTitle', { owner: shareOwner })
        : t('mgShareLoginTitleAnon');
    const shareMessage = String(sharedGame?.message || '').trim();
    const stars = Array.from({ length: 82 }).map((_, i) => {
        const x = (Math.random() * 100).toFixed(2);
        const y = (Math.random() * 100).toFixed(2);
        const s = (Math.random() * 2.1 + 0.8).toFixed(2);
        const d = (Math.random() * 4 + 2).toFixed(2);
        const delay = (-(Math.random() * 4)).toFixed(2);
        const glow = i % 5 === 0 ? 'rgba(255, 231, 161, 0.95)' : i % 3 === 0 ? 'rgba(152, 239, 255, 0.95)' : '#fff';
        return `<i class="star" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;--star-glow:${glow};animation-duration:${d}s;animation-delay:${delay}s"></i>`;
    }).join('');

    const planets = DECOR_PLANETS.map(decorPlanetHtml).join('');

    panel.innerHTML = `
        <div class="mh-stage zoom-space absolute inset-0 overflow-hidden fade-in" style="border-radius:inherit">
            <div class="space-camera-layer">
                <div class="space-bg">${stars}</div>
                ${planets}
            </div>
            <div class="absolute inset-0 flex flex-col items-center justify-center px-8 text-center" style="z-index:40">
                ${isShare ? `
                <div class="text-7xl floaty mb-4" style="filter:drop-shadow(0 0 18px rgba(125,225,255,0.55))">🎮</div>
                <h1 class="text-2xl font-extrabold mb-3" style="color:#e8f7ff;text-shadow:0 0 18px rgba(84,226,255,0.55),0 2px 8px rgba(6,18,44,0.6);max-width:300px;line-height:1.32">${escapeHtml(shareTitle)}</h1>
                ${shareMessage ? `<p class="text-sm mb-3 px-4 py-2" style="color:#fff;background:rgba(84,226,255,0.16);border:1px solid rgba(152,239,255,0.4);border-radius:14px;max-width:300px;line-height:1.4;text-shadow:0 1px 4px rgba(6,18,44,0.6);white-space:pre-wrap;word-break:break-word">${escapeHtml(shareMessage)}</p>` : ''}
                <p class="text-sm mb-8" style="color:#bde6ff;text-shadow:0 0 10px rgba(84,226,255,0.35)">${escapeHtml(t('mgShareLoginDesc'))}</p>
                ` : `
                <div class="text-7xl floaty mb-4" style="filter:drop-shadow(0 0 18px rgba(125,225,255,0.55))">🐾</div>
                <h1 class="text-3xl font-extrabold mb-2" style="color:#e8f7ff;text-shadow:0 0 18px rgba(84,226,255,0.55),0 2px 8px rgba(6,18,44,0.6)">${escapeHtml(appTitle)}</h1>
                <p class="text-sm" style="color:#bde6ff;text-shadow:0 0 10px rgba(84,226,255,0.35);margin-bottom:32px">${escapeHtml(t('tagline'))}</p>
                <p class="text-xs mb-6" style="color:#9fd0eb;text-shadow:0 1px 4px rgba(6,18,44,0.6)">${escapeHtml(t('pleaseLogin'))}</p>
                `}
                <div id="mhLoginAction" class="flex items-center justify-center" style="min-height:64px">
                    ${actionAreaHtml(mode)}
                </div>
                ${mode === 'login' ? offlineOptionHtml() : ''}
                ${mode === 'login' ? privacyRowHtml() : ''}
                ${languageSelectorHtml()}
            </div>
        </div>`;

    const switchLanguage = (lang) => {
        if (setLang(lang)) renderLogin(panel, _data, { onLogin, onOffline, mode, sharedGame });
    };
    const langZh = $('mhLoginLangZh');
    const langEn = $('mhLoginLangEn');
    if (langZh) langZh.onclick = () => switchLanguage('zh');
    if (langEn) langEn.onclick = () => switchLanguage('en');

    if (mode === 'login') {
        const offlineBtn = $('mhOfflineBtn');
        if (offlineBtn) offlineBtn.onclick = () => {
            showToast(t('offlineHint'), 'info', 2800);
            onOffline?.();
        };
    }

    if (mode === 'login') {
        let agreed = false;
        const toggleAgreed = (val) => {
            agreed = Boolean(val);
            const check = $('mhLoginPrivacyCheck');
            if (check) check.classList.toggle('checked', agreed);
        };

        const privacyRow = $('mhLoginPrivacy');
        if (privacyRow) privacyRow.onclick = (e) => {
            if (e.target.id === 'mhLoginPrivacyLink1' || e.target.id === 'mhLoginPrivacyLink2') return;
            toggleAgreed(!agreed);
        };

        const link1 = $('mhLoginPrivacyLink1');
        if (link1) link1.onclick = (e) => { e.stopPropagation(); showLoginPrivacyModal(); };
        const link2 = $('mhLoginPrivacyLink2');
        if (link2) link2.onclick = (e) => { e.stopPropagation(); showLoginLicenseModal(); };

        const btn = $('mhLoginBtn');
        if (btn) {
            btn.onclick = () => {
                // 登录会收集账号信息，须先勾选同意隐私政策；游客体验不受此限制。
                if (!agreed) {
                    showToast(t('loginAgreeNotice'), 'info', 2000);
                    return;
                }
                const action = $('mhLoginAction');
                if (action) action.innerHTML = actionAreaHtml('loggingIn');
                onLogin?.();
            };
        }
    }
}
