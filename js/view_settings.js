// 设置视图
import { $, escapeHtml, showToast, confirm as confirmDialog } from './utils.js';
import { t, getLang, setLang } from './i18n.js';
import { state, notify } from './state.js';
import { saveUserProfile } from './storage.js';
import { CONFIG } from './config.js';

let workspaceViewerInstance = null;
let logoTapCount = 0;
let logoTapResetTimer = null;

const LOGO_DEV_MODE_TAP_COUNT = 5;
const LOGO_DEV_MODE_TAP_RESET_MS = 1600;

function getKeepworkUsername(user) {
    return user?.username || '';
}

function getDisplayUsername() {
    const sdk = state.sdk || window.keepwork;
    return getKeepworkUsername(state.user) || getKeepworkUsername(sdk?.user) || (sdk?.token ? t('fetchingUsername') : t('notLoggedIn'));
}

async function refreshSettingsUsername(panel) {
    const sdk = state.sdk || window.keepwork;
    if (!sdk?.token) return;
    if (getKeepworkUsername(state.user) || getKeepworkUsername(sdk.user)) return;
    try {
        state.user = typeof sdk.getUserProfile === 'function'
            ? await sdk.getUserProfile()
            : (typeof sdk.getCurrentUser === 'function' ? await sdk.getCurrentUser() : sdk.user);
        const name = getKeepworkUsername(state.user) || getKeepworkUsername(sdk.user);
        const box = panel.querySelector?.('#mhUsernameText');
        if (box && name) box.textContent = `👤 ${name}`;
    } catch (_) {}
}

function isDeveloperMode() {
    return state.settings?.developerMode === true;
}

function getDevToolUrl(fileName) {
    if (typeof window === 'undefined') return '';
    // Dev tools live under the game's Keepwork page directory. Build an
    // absolute Keepwork raw-API URL so the tools open from the canonical
    // source regardless of how the game itself was loaded (CDN base, iframe,
    // local server, etc.), e.g.
    //   https://keepwork.com/api/raw/maisi/maisi/webgames/MagicHaqi/dev_tools/FamousPetGenerator.html
    const origin = 'https://keepwork.com'; 
    const pagePath = 'maisi/maisi/webgames/MagicHaqi';
    return `${origin}/api/raw/${pagePath}/dev_tools/${fileName}`;
}

function openDevTool(fileName, title) {
    const url = getDevToolUrl(fileName);
    if (!url) return false;
    const opened = window.open(url, '_blank');
    if (opened) {
        try { opened.opener = null; } catch (_) {}
        showToast(t('toolOpened', { title }), 'success', 1200);
        return true;
    }
    showToast(t('popupBlocked'), 'error', 2200);
    return false;
}

async function handleLogoTap(panel, data, options) {
    if (isDeveloperMode()) return;
    logoTapCount += 1;
    if (logoTapResetTimer) clearTimeout(logoTapResetTimer);
    logoTapResetTimer = setTimeout(() => { logoTapCount = 0; }, LOGO_DEV_MODE_TAP_RESET_MS);
    if (logoTapCount < LOGO_DEV_MODE_TAP_COUNT) return;

    logoTapCount = 0;
    clearTimeout(logoTapResetTimer);
    logoTapResetTimer = null;
    state.settings = state.settings || {};
    state.settings.developerMode = true;
    await saveUserProfile();
    notify();
    showToast(t('devModeEnabled'), 'success', 1400);
    renderSettings(panel, data, options);
}

export function renderSettings(panel, _data, { onBack, onLogout, onLogin, onClearData } = {}) {
    const canOpenDevPanel = (typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) || isDeveloperMode();
    const developerMode = canOpenDevPanel;
    const username = getDisplayUsername();
    const isGuest = !!state.offlineMode;
    const autoShowLevelBar = state.settings?.autoShowLevelBar === true;
    const hasLocalAPIKeySettings = !!(state.sdk || window.keepwork)?.localAPIKeySettings;
    const openDevPanel = async (button = null) => {
        if (!canOpenDevPanel) return;
        if (button) button.disabled = true;
        try {
            const { openDevConsole } = await import('./view_dev_console.js');
            const opened = openDevConsole?.({ expanded: true });
            showToast(opened ? t('devPanelOpened') : t('devPanelUnavailable'), opened ? 'success' : 'error', 1200);
        } catch (e) {
            showToast(t('devPanelLoadFailed', { error: (e?.message || e) }), 'error', 2200);
        } finally {
            if (button) button.disabled = false;
        }
    };
    const openLocalAPIKeySettings = async (button = null) => {
        const localSettings = (state.sdk || window.keepwork)?.localAPIKeySettings;
        if (!localSettings?.show) {
            showToast(t('apiKeyUnsupported'), 'error', 1800);
            return;
        }
        if (button) button.disabled = true;
        try {
            await localSettings.load?.();
            localSettings.show({
                title: t('localApiKeyTitle'),
                fullscreen: true,
                onSave: () => showToast(t('apiKeySaved'), 'success', 1200),
            });
        } catch (e) {
            showToast(t('apiKeyOpenFailed', { error: (e?.message || e) }), 'error', 2200);
        } finally {
            if (button) button.disabled = false;
        }
    };
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">⚙️ ${escapeHtml(t('settings'))}</span>
            <span style="width:36px"></span>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px">
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🌐 ${escapeHtml(t('language'))}</div>
                </div>
                <div style="display:flex;gap:6px;flex:0 0 auto">
                    <button id="mhLangZh" class="btn-secondary" style="${getLang() === 'zh' ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">${escapeHtml(t('languageZh'))}</button>
                    <button id="mhLangEn" class="btn-secondary" style="${getLang() === 'en' ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">${escapeHtml(t('languageEn'))}</button>
                </div>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-size:14px;font-weight:700">👑 ${escapeHtml(t('devVip'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('vipHint'))}</div>
                </div>
                <button id="mhVip" class="btn-secondary" style="${state.isPaid ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">
                    ${state.isPaid ? escapeHtml(t('enabled')) : escapeHtml(t('enable'))}
                </button>
            </div>
            ${canOpenDevPanel ? `
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-size:14px;font-weight:700">🛠 ${escapeHtml(t('settings'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('devPanelHint'))}</div>
                </div>
                <button id="mhOpenDevPanel" class="btn-secondary">${escapeHtml(t('open'))}</button>
            </div>` : ''}
            ${canOpenDevPanel ? `
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-size:14px;font-weight:700">📁 ${escapeHtml(t('workspaceFiles'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('viewWorkspaceFiles', { workspace: CONFIG.workspace }))}</div>
                </div>
                <button id="mhOpenWorkspaceViewer" class="btn-secondary">${escapeHtml(t('view'))}</button>
            </div>` : ''}
            ${developerMode ? `
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🧬 Pet Generator</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('openPetGenerator'))}</div>
                </div>
                <button id="mhOpenPetGenerator" class="btn-secondary">${escapeHtml(t('open'))}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🪐 Planet Generator</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('openPlanetGenerator'))}</div>
                </div>
                <button id="mhOpenPlanetGenerator" class="btn-secondary">${escapeHtml(t('open'))}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🗺 Scene Generator</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('openSceneGenerator'))}</div>
                </div>
                <button id="mhOpenSceneGenerator" class="btn-secondary">${escapeHtml(t('open'))}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">📖 Pet Story Generator</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('openPetStoryGenerator'))}</div>
                </div>
                <button id="mhOpenStoryGenerator" class="btn-secondary">${escapeHtml(t('open'))}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🛒 Shop Item Generator</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('openShopItemGenerator'))}</div>
                </div>
                <button id="mhOpenShopItemGenerator" class="btn-secondary">${escapeHtml(t('open'))}</button>
            </div>` : ''}
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🔑 ${escapeHtml(t('localApiKeyTitle'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('localApiKeyHint'))}</div>
                </div>
                <button id="mhOpenLocalAPIKeySettings" class="btn-secondary" ${hasLocalAPIKeySettings ? '' : 'disabled'}>${hasLocalAPIKeySettings ? escapeHtml(t('configure')) : escapeHtml(t('notAvailable'))}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">📏 ${escapeHtml(t('levelBarTitle'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('levelBarHint'))}</div>
                </div>
                <button id="mhAutoShowLevelBar" class="btn-secondary" style="${autoShowLevelBar ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">
                    ${autoShowLevelBar ? escapeHtml(t('enabled')) : escapeHtml(t('disable'))}
                </button>
            </div>
            <div class="card-flat" style="display:flex;flex-direction:column;gap:8px">
                <div>
                    <div style="font-size:14px;font-weight:700">🗺 ${escapeHtml(t('mapSeedTitle'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(t('mapSeedHint'))}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                    <input id="mhMapSeed" class="modal-input" maxlength="32" placeholder="${escapeHtml(t('defaultUsername'))}" value="${escapeHtml(state.settings?.fieldMapSeed || '')}" style="flex:1;min-width:0">
                    <button id="mhSaveMapSeed" class="btn-secondary" style="flex:0 0 auto">${escapeHtml(t('save'))}</button>
                    <button id="mhResetMapSeed" class="btn-secondary" style="flex:0 0 auto">${escapeHtml(t('default'))}</button>
                </div>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div style="min-width:0">
                    <div id="mhUsernameText" style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ${escapeHtml(isGuest ? t('guestAccountTitle') : username)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(isGuest ? t('guestAccountHint') : t('loggedInAccount'))}</div>
                </div>
                ${isGuest
                    ? `<button id="mhGuestLogin" class="btn-primary">${escapeHtml(t('login'))}</button>`
                    : `<button id="mhLogout" class="btn-secondary">${escapeHtml(t('logout'))}</button>`}
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;border-color:#fca5a5">
                <span style="font-size:14px;color:#b91c1c">🗑 ${escapeHtml(t('clearData'))}</span>
                <button id="mhClear" class="btn-danger">${escapeHtml(t('clearData'))}</button>
            </div>
            <div id="mhSettingsLogo" class="text-center text-xs mt-4" role="button" tabindex="0" style="color:rgba(255,255,255,0.78);text-shadow:0 1px 2px rgba(15,23,42,0.28);cursor:pointer;touch-action:manipulation">${escapeHtml(t('appName'))} · v0.1</div>
        </div>`;
    const switchLang = async (lang) => {
        if (!setLang(lang)) return;
        try { state.settings = state.settings || {}; state.settings.lang = lang; await saveUserProfile(); } catch (_) {}
        showToast(t('languageSwitched'), 'success', 1000);
        notify();
    };
    if ($('mhLangZh')) $('mhLangZh').onclick = () => switchLang('zh');
    if ($('mhLangEn')) $('mhLangEn').onclick = () => switchLang('en');
    if (canOpenDevPanel) {
        panel.oncontextmenu = (e) => {
            e.preventDefault();
            openDevPanel();
        };
    } else {
        panel.oncontextmenu = null;
    }
    if ($('mhBack')) $('mhBack').onclick = () => onBack?.();
    if ($('mhVip')) $('mhVip').onclick = async () => {
        state.isPaid = !state.isPaid;
        await saveUserProfile();
        showToast(state.isPaid ? t('switchedToVip') : t('vipClosed'), 'success');
        renderSettings(panel, _data, { onBack, onLogout, onLogin, onClearData });
    };
    if ($('mhOpenDevPanel')) $('mhOpenDevPanel').onclick = () => openDevPanel($('mhOpenDevPanel'));
    if ($('mhOpenPetGenerator')) $('mhOpenPetGenerator').onclick = () => openDevTool('FamousPetGenerator.html', 'Pet Generator');
    if ($('mhOpenPlanetGenerator')) $('mhOpenPlanetGenerator').onclick = () => openDevTool('FamousPlanetGenerator.html', 'Planet Generator');
    if ($('mhOpenSceneGenerator')) $('mhOpenSceneGenerator').onclick = () => openDevTool('ScenePresetsGenerator.html', 'Scene Generator');
    if ($('mhOpenStoryGenerator')) $('mhOpenStoryGenerator').onclick = () => openDevTool('PetStoryGenerator.html', 'Pet Story Generator');
    if ($('mhOpenShopItemGenerator')) $('mhOpenShopItemGenerator').onclick = () => openDevTool('ShopItemGenerator.html', 'Shop Item Generator');
    if ($('mhOpenLocalAPIKeySettings')) $('mhOpenLocalAPIKeySettings').onclick = () => openLocalAPIKeySettings($('mhOpenLocalAPIKeySettings'));
    if ($('mhOpenWorkspaceViewer')) $('mhOpenWorkspaceViewer').onclick = () => {
        try {
            const opened = openWorkspaceViewer();
            showToast(opened ? t('workspaceOpened') : t('workspaceViewerUnavailable'), opened ? 'success' : 'error', 1400);
        } catch (e) {
            closeWorkspaceViewer();
            showToast(t('workspaceOpenFailed', { error: (e?.message || e) }), 'error', 2200);
        }
    };
    if ($('mhAutoShowLevelBar')) $('mhAutoShowLevelBar').onclick = async () => {
        state.settings = state.settings || {};
        state.settings.autoShowLevelBar = state.settings.autoShowLevelBar !== true;
        await saveUserProfile();
        notify();
        showToast(state.settings.autoShowLevelBar ? t('levelBarAuto') : t('levelBarPinned'), 'success');
        renderSettings(panel, _data, { onBack, onLogout, onLogin, onClearData });
    };
    if ($('mhSaveMapSeed')) $('mhSaveMapSeed').onclick = async () => {
        const input = $('mhMapSeed');
        state.settings = state.settings || {};
        const seed = (input?.value || '').trim();
        if (seed) state.settings.fieldMapSeed = seed;
        else delete state.settings.fieldMapSeed;
        await saveUserProfile();
        notify();
        showToast(state.settings.fieldMapSeed ? t('mapSeedSaved') : t('mapRestoredUsername'), 'success');
        renderSettings(panel, _data, { onBack, onLogout, onLogin, onClearData });
    };
    if ($('mhResetMapSeed')) $('mhResetMapSeed').onclick = async () => {
        state.settings = state.settings || {};
        delete state.settings.fieldMapSeed;
        await saveUserProfile();
        notify();
        showToast(t('mapRestoredUsername'), 'success');
        renderSettings(panel, _data, { onBack, onLogout, onLogin, onClearData });
    };
    if ($('mhLogout')) $('mhLogout').onclick = () => onLogout?.();
    if ($('mhGuestLogin')) $('mhGuestLogin').onclick = () => onLogin?.();
    if ($('mhClear')) $('mhClear').onclick = async () => {
        const ok = await confirmDialog(t('clearConfirm'));
        if (ok) onClearData?.();
    };
    if ($('mhSettingsLogo')) {
        $('mhSettingsLogo').onclick = () => handleLogoTap(panel, _data, { onBack, onLogout, onLogin, onClearData });
        $('mhSettingsLogo').onkeydown = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handleLogoTap(panel, _data, { onBack, onLogout, onLogin, onClearData });
        };
    }
    refreshSettingsUsername(panel);
}

function openWorkspaceViewer() {
    if (typeof window === 'undefined' || typeof window.createWorkspaceViewer !== 'function') return false;
    closeWorkspaceViewer();
    injectWorkspaceViewerStyles();

    const overlay = document.createElement('div');
    overlay.id = 'mhWorkspaceViewerOverlay';
    overlay.className = 'mh-workspace-viewer-overlay';
    overlay.innerHTML = `
        <div class="mh-workspace-viewer-window" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('workspaceFiles'))}">
            <div class="mh-workspace-viewer-titlebar">
                <div>
                    <strong>${escapeHtml(t('workspaceFiles'))}</strong>
                    <span>${escapeHtml(CONFIG.workspace)}</span>
                </div>
                <button type="button" class="mh-workspace-viewer-close" aria-label="${escapeHtml(t('close'))}">×</button>
            </div>
            <div class="mh-workspace-viewer-host"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeButton = overlay.querySelector('.mh-workspace-viewer-close');
    closeButton?.addEventListener('click', closeWorkspaceViewer);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeWorkspaceViewer();
    });

    const host = overlay.querySelector('.mh-workspace-viewer-host');
    workspaceViewerInstance = window.createWorkspaceViewer({
        container: host,
        sdk: state.sdk || window.keepwork,
        workspace: CONFIG.workspace,
        compact: true,
        hideUserInfo: true,
    });
    return true;
}

function closeWorkspaceViewer() {
    try { workspaceViewerInstance?.destroy?.(); } catch (_) {}
    workspaceViewerInstance = null;
    document.getElementById('mhWorkspaceViewerOverlay')?.remove();
}

function injectWorkspaceViewerStyles() {
    if (document.getElementById('mhWorkspaceViewerStyle')) return;
    const style = document.createElement('style');
    style.id = 'mhWorkspaceViewerStyle';
    style.textContent = `
        .mh-workspace-viewer-overlay {
            position: fixed;
            inset: 0;
            z-index: 21000;
            background: rgba(6, 18, 44, 0.58);
            backdrop-filter: blur(5px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
        }
        .mh-workspace-viewer-window {
            width: min(1180px, 100%);
            height: min(760px, 100%);
            min-height: 420px;
            border-radius: 16px;
            overflow: hidden;
            border: 2px solid #d7f4ff;
            background: #effaff;
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.72);
            display: flex;
            flex-direction: column;
        }
        .mh-workspace-viewer-titlebar {
            height: 50px;
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 12px 8px 16px;
            background: linear-gradient(180deg, #ffffff, #dff7ff);
            border-bottom: 1.5px solid #7dd3fc;
            color: var(--text-primary);
        }
        .mh-workspace-viewer-titlebar div {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .mh-workspace-viewer-titlebar strong {
            font-size: 14px;
            line-height: 1.2;
        }
        .mh-workspace-viewer-titlebar span {
            font-size: 11px;
            color: var(--text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .mh-workspace-viewer-close {
            width: 34px;
            height: 34px;
            flex: 0 0 auto;
            border-radius: 999px;
            border: 1.5px solid var(--border-card);
            background: #ffffff;
            color: var(--text-primary);
            font-size: 24px;
            line-height: 1;
            cursor: pointer;
            box-shadow: 0 3px 0 rgba(14, 116, 144, 0.22);
        }
        .mh-workspace-viewer-close:active {
            transform: translateY(2px);
            box-shadow: 0 1px 0 rgba(14, 116, 144, 0.22);
        }
        .mh-workspace-viewer-host {
            flex: 1 1 auto;
            min-height: 0;
        }
        @media (max-width: 680px) {
            .mh-workspace-viewer-overlay { padding: 0; }
            .mh-workspace-viewer-window {
                width: 100%;
                height: 100%;
                min-height: 0;
                border-radius: 0;
                border: 0;
            }
        }
    `;
    document.head.appendChild(style);
}
