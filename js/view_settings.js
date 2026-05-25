// 设置视图
import { $, escapeHtml, showToast, confirm as confirmDialog } from './utils.js';
import { t } from './i18n.js';
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
    return getKeepworkUsername(state.user) || getKeepworkUsername(sdk?.user) || (sdk?.token ? '正在获取用户名...' : '未登录');
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
    return new URL(`./dev_tools/${fileName}`, window.location.href).href;
}

function openDevTool(fileName, title) {
    const url = getDevToolUrl(fileName);
    if (!url) return false;
    const opened = window.open(url, '_blank');
    if (opened) {
        try { opened.opener = null; } catch (_) {}
        showToast(`${title}已打开`, 'success', 1200);
        return true;
    }
    showToast('新窗口被浏览器拦截，请允许弹出窗口', 'error', 2200);
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
    showToast('开发者模式已开启', 'success', 1400);
    renderSettings(panel, data, options);
}

export function renderSettings(panel, _data, { onBack, onLogout, onClearData } = {}) {
    const canOpenDevPanel = (typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) || isDeveloperMode();
    const developerMode = canOpenDevPanel;
    const username = getDisplayUsername();
    const autoShowLevelBar = state.settings?.autoShowLevelBar === true;
    const hasLocalAPIKeySettings = !!(state.sdk || window.keepwork)?.localAPIKeySettings;
    const openDevPanel = async (button = null) => {
        if (!canOpenDevPanel) return;
        if (button) button.disabled = true;
        try {
            const { openDevConsole } = await import('./view_dev_console.js');
            const opened = openDevConsole?.({ expanded: true });
            showToast(opened ? '开发者面板已打开' : '开发者面板不可用', opened ? 'success' : 'error', 1200);
        } catch (e) {
            showToast('开发者面板加载失败：' + (e?.message || e), 'error', 2200);
        } finally {
            if (button) button.disabled = false;
        }
    };
    const openLocalAPIKeySettings = async (button = null) => {
        const localSettings = (state.sdk || window.keepwork)?.localAPIKeySettings;
        if (!localSettings?.show) {
            showToast('当前 SDK 不支持本地 API Key 设置', 'error', 1800);
            return;
        }
        if (button) button.disabled = true;
        try {
            await localSettings.load?.();
            localSettings.show({
                title: '本地 API Key 设置',
                fullscreen: true,
                onSave: () => showToast('API Key 设置已保存', 'success', 1200),
            });
        } catch (e) {
            showToast('API Key 设置打开失败：' + (e?.message || e), 'error', 2200);
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
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-size:14px;font-weight:700">👑 ${escapeHtml(t('devVip'))}</div>
                    <div style="font-size:11px;color:var(--text-muted)">仅本机生效，用于体验付费语音</div>
                </div>
                <button id="mhVip" class="btn-secondary" style="${state.isPaid ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">
                    ${state.isPaid ? '已开启' : '开启'}
                </button>
            </div>
            ${canOpenDevPanel ? `
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-size:14px;font-weight:700">🛠 开发者面板</div>
                    <div style="font-size:11px;color:var(--text-muted)">按需打开调试工具，不在游戏界面常驻</div>
                </div>
                <button id="mhOpenDevPanel" class="btn-secondary">打开</button>
            </div>` : ''}
            ${canOpenDevPanel ? `
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-size:14px;font-weight:700">📁 工作区文件</div>
                    <div style="font-size:11px;color:var(--text-muted)">查看 ${escapeHtml(CONFIG.workspace)} workspace 的存储文件</div>
                </div>
                <button id="mhOpenWorkspaceViewer" class="btn-secondary">查看</button>
            </div>` : ''}
            ${developerMode ? `
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🧬 AI宠物编辑器</div>
                    <div style="font-size:11px;color:var(--text-muted)">打开 Pet Generator</div>
                </div>
                <button id="mhOpenPetGenerator" class="btn-secondary">打开</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🪐 AI星球编辑器</div>
                    <div style="font-size:11px;color:var(--text-muted)">打开 Planet Generator</div>
                </div>
                <button id="mhOpenPlanetGenerator" class="btn-secondary">打开</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🗺 AI场景编辑器</div>
                    <div style="font-size:11px;color:var(--text-muted)">打开 Scene Generator</div>
                </div>
                <button id="mhOpenSceneGenerator" class="btn-secondary">打开</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🛒 AI商店编辑器</div>
                    <div style="font-size:11px;color:var(--text-muted)">打开 Shop Item Generator</div>
                </div>
                <button id="mhOpenShopItemGenerator" class="btn-secondary">打开</button>
            </div>` : ''}
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">🔑 本地 API Key</div>
                    <div style="font-size:11px;color:var(--text-muted)">配置聊天、图片、视频模型的本地密钥</div>
                </div>
                <button id="mhOpenLocalAPIKeySettings" class="btn-secondary" ${hasLocalAPIKeySettings ? '' : 'disabled'}>${hasLocalAPIKeySettings ? '配置' : '不可用'}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                    <div style="font-size:14px;font-weight:700">📏 自动显示层级条</div>
                    <div style="font-size:11px;color:var(--text-muted)">关闭时层级条常驻；装饰或喂食时隐藏</div>
                </div>
                <button id="mhAutoShowLevelBar" class="btn-secondary" style="${autoShowLevelBar ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">
                    ${autoShowLevelBar ? '已开启' : '关闭'}
                </button>
            </div>
            <div class="card-flat" style="display:flex;flex-direction:column;gap:8px">
                <div>
                    <div style="font-size:14px;font-weight:700">🗺 星球地图种子</div>
                    <div style="font-size:11px;color:var(--text-muted)">默认使用用户名；改动后陆地、水域、天空会生成新的固定地图</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                    <input id="mhMapSeed" class="modal-input" maxlength="32" placeholder="默认：用户名" value="${escapeHtml(state.settings?.fieldMapSeed || '')}" style="flex:1;min-width:0">
                    <button id="mhSaveMapSeed" class="btn-secondary" style="flex:0 0 auto">保存</button>
                    <button id="mhResetMapSeed" class="btn-secondary" style="flex:0 0 auto">默认</button>
                </div>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div style="min-width:0">
                    <div id="mhUsernameText" style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ${escapeHtml(username)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">已登录账号</div>
                </div>
                <button id="mhLogout" class="btn-secondary">${escapeHtml(t('logout'))}</button>
            </div>
            <div class="card-flat" style="display:flex;justify-content:space-between;align-items:center;border-color:#fca5a5">
                <span style="font-size:14px;color:#b91c1c">🗑 ${escapeHtml(t('clearData'))}</span>
                <button id="mhClear" class="btn-danger">${escapeHtml(t('clearData'))}</button>
            </div>
            <div id="mhSettingsLogo" class="text-center text-xs mt-4" role="button" tabindex="0" style="color:rgba(255,255,255,0.78);text-shadow:0 1px 2px rgba(15,23,42,0.28);cursor:pointer;touch-action:manipulation">${escapeHtml(t('appName'))} · v0.1</div>
        </div>`;
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
        showToast(state.isPaid ? '已切换为 VIP' : '已关闭 VIP', 'success');
        renderSettings(panel, _data, { onBack, onLogout, onClearData });
    };
    if ($('mhOpenDevPanel')) $('mhOpenDevPanel').onclick = () => openDevPanel($('mhOpenDevPanel'));
    if ($('mhOpenPetGenerator')) $('mhOpenPetGenerator').onclick = () => openDevTool('FamousPetGenerator.html', 'AI宠物编辑器');
    if ($('mhOpenPlanetGenerator')) $('mhOpenPlanetGenerator').onclick = () => openDevTool('FamousPlanetGenertor.html', 'AI星球编辑器');
    if ($('mhOpenSceneGenerator')) $('mhOpenSceneGenerator').onclick = () => openDevTool('ScenePresetsGenerator.html', 'AI场景编辑器');
    if ($('mhOpenShopItemGenerator')) $('mhOpenShopItemGenerator').onclick = () => openDevTool('ShopItemGenerator.html', 'AI商店编辑器');
    if ($('mhOpenLocalAPIKeySettings')) $('mhOpenLocalAPIKeySettings').onclick = () => openLocalAPIKeySettings($('mhOpenLocalAPIKeySettings'));
    if ($('mhOpenWorkspaceViewer')) $('mhOpenWorkspaceViewer').onclick = () => {
        try {
            const opened = openWorkspaceViewer();
            showToast(opened ? '工作区文件已打开' : 'WorkspaceViewer 不可用', opened ? 'success' : 'error', 1400);
        } catch (e) {
            closeWorkspaceViewer();
            showToast('WorkspaceViewer 打开失败：' + (e?.message || e), 'error', 2200);
        }
    };
    if ($('mhAutoShowLevelBar')) $('mhAutoShowLevelBar').onclick = async () => {
        state.settings = state.settings || {};
        state.settings.autoShowLevelBar = state.settings.autoShowLevelBar !== true;
        await saveUserProfile();
        notify();
        showToast(state.settings.autoShowLevelBar ? '层级条已改为自动显示' : '层级条已改为常驻显示', 'success');
        renderSettings(panel, _data, { onBack, onLogout, onClearData });
    };
    if ($('mhSaveMapSeed')) $('mhSaveMapSeed').onclick = async () => {
        const input = $('mhMapSeed');
        state.settings = state.settings || {};
        const seed = (input?.value || '').trim();
        if (seed) state.settings.fieldMapSeed = seed;
        else delete state.settings.fieldMapSeed;
        await saveUserProfile();
        notify();
        showToast(state.settings.fieldMapSeed ? '地图种子已保存' : '已恢复用户名地图', 'success');
        renderSettings(panel, _data, { onBack, onLogout, onClearData });
    };
    if ($('mhResetMapSeed')) $('mhResetMapSeed').onclick = async () => {
        state.settings = state.settings || {};
        delete state.settings.fieldMapSeed;
        await saveUserProfile();
        notify();
        showToast('已恢复用户名地图', 'success');
        renderSettings(panel, _data, { onBack, onLogout, onClearData });
    };
    if ($('mhLogout')) $('mhLogout').onclick = () => onLogout?.();
    if ($('mhClear')) $('mhClear').onclick = async () => {
        const ok = await confirmDialog(t('clearConfirm'));
        if (ok) onClearData?.();
    };
    if ($('mhSettingsLogo')) {
        $('mhSettingsLogo').onclick = () => handleLogoTap(panel, _data, { onBack, onLogout, onClearData });
        $('mhSettingsLogo').onkeydown = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handleLogoTap(panel, _data, { onBack, onLogout, onClearData });
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
        <div class="mh-workspace-viewer-window" role="dialog" aria-modal="true" aria-label="工作区文件">
            <div class="mh-workspace-viewer-titlebar">
                <div>
                    <strong>工作区文件</strong>
                    <span>${escapeHtml(CONFIG.workspace)}</span>
                </div>
                <button type="button" class="mh-workspace-viewer-close" aria-label="关闭工作区文件">×</button>
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
