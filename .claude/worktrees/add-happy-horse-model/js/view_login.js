// 登录视图
import { $, escapeHtml, showToast } from './utils.js';
import { getLang, setLang, t } from './i18n.js';
import { state } from './state.js';

// 装饰用的小星球（复用 planet.css 中的 .space-planet / .planet-body / .planet-ring 等样式）
// 通过 --planet-hue 调色，通过 left/top + transform scale 控制位置与大小，避免重复 CSS。
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

// 渲染中央动作区域：登录按钮 或 "登录中..." 提示
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

// 一次性注入 spinner 样式
function ensureLoginSpinnerStyle() {
    if (document.getElementById('mhLoginSpinnerStyle')) return;
    const style = document.createElement('style');
    style.id = 'mhLoginSpinnerStyle';
    style.textContent = `
        .mh-login-spinner{
            width:42px;height:42px;border-radius:50%;
            border:3px solid rgba(152,239,255,0.25);
            border-top-color:#7de1ff;
            box-shadow:0 0 18px rgba(125,225,255,0.45);
            animation:mhLoginSpin 0.9s linear infinite;
        }
        @keyframes mhLoginSpin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
}

export function renderLogin(panel, _data, { onLogin, onOffline, mode = 'login' } = {}) {
    ensureLoginSpinnerStyle();
    const appTitle = String(state.settings?.starSettlement?.appTitle || '').trim() || t('appName');
    // 复用 level_planet 的太空背景：.mh-stage.zoom-space + .space-bg + 闪烁星点
    const stars = Array.from({ length: 82 }).map((_, i) => {
        const x = (Math.random() * 100).toFixed(2);
        const y = (Math.random() * 100).toFixed(2);
        const s = (Math.random() * 2.1 + 0.8).toFixed(2);
        const d = (Math.random() * 4 + 2).toFixed(2);
        const delay = (-(Math.random() * 4)).toFixed(2);
        const glow = i % 5 === 0
            ? 'rgba(255, 231, 161, 0.95)'
            : i % 3 === 0 ? 'rgba(152, 239, 255, 0.95)' : '#fff';
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
                <div class="text-7xl floaty mb-4" style="filter:drop-shadow(0 0 18px rgba(125,225,255,0.55))">🐾</div>
                <h1 class="text-3xl font-extrabold mb-2" style="color:#e8f7ff;text-shadow:0 0 18px rgba(84,226,255,0.55),0 2px 8px rgba(6,18,44,0.6)">${escapeHtml(appTitle)}</h1>
                <p class="text-sm mb-8" style="color:#bde6ff;text-shadow:0 0 10px rgba(84,226,255,0.35)">${escapeHtml(t('tagline'))}</p>
                <p class="text-xs mb-6" style="color:#9fd0eb;text-shadow:0 1px 4px rgba(6,18,44,0.6)">${escapeHtml(t('pleaseLogin'))}</p>
                <div id="mhLoginAction" class="flex items-center justify-center" style="min-height:64px">
                    ${actionAreaHtml(mode)}
                </div>
                ${mode === 'loggingIn' ? '' : offlineOptionHtml()}
                ${languageSelectorHtml()}
            </div>
        </div>`;
    const btn = $('mhLoginBtn');
    if (btn) {
        btn.onclick = () => {
            // 立即切换到 "登录中..." 模式，避免短暂闪烁登录按钮
            const action = $('mhLoginAction');
            if (action) action.innerHTML = actionAreaHtml('loggingIn');
            onLogin?.();
        };
    }
    const switchLanguage = (lang) => {
        if (setLang(lang)) renderLogin(panel, _data, { onLogin, onOffline, mode });
    };
    const langZh = $('mhLoginLangZh');
    const langEn = $('mhLoginLangEn');
    if (langZh) langZh.onclick = () => switchLanguage('zh');
    if (langEn) langEn.onclick = () => switchLanguage('en');
    const offlineBtn = $('mhOfflineBtn');
    if (offlineBtn) offlineBtn.onclick = () => {
        showToast(t('offlineHint'), 'info', 2800);
        onOffline?.();
    };
}
