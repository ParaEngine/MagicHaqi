// 小游戏创造视图（全屏）：AI vibe-coding 工坊。
// 玩家用自然语言描述想要的游戏，AI 基于 minigames/AGENTS.md 生成完整 HTML5 单页游戏，
// 支持实时预览与多轮迭代，保存到 PersonalPageStore 的 pet-games/ 目录。
import { $, escapeHtml, showToast, prompt as promptDialog } from './utils.js';
import { t, getLang } from './i18n.js';
import { state } from './state.js';
import { savePetGame } from './storage.js';

// 游戏创作工坊的 AI 会话共用同一个 modId，chatId 区分不同会话，便于列出历史。
const GAME_MAKER_MOD_ID = 'magichaqi-game-maker';
const GAME_MAKER_MODEL_KEY = 'mh_game_maker_model';

function loadPreferredModel() {
    try { return localStorage.getItem(GAME_MAKER_MODEL_KEY) || ''; } catch (_) { return ''; }
}
function savePreferredModel(model) {
    try {
        if (model) localStorage.setItem(GAME_MAKER_MODEL_KEY, model);
        else localStorage.removeItem(GAME_MAKER_MODEL_KEY);
    } catch (_) {}
}

// 从 SDK 读取本地配置的可用 Chat 模型（已启用的）。
function listChatModels() {
    const sdk = state.sdk || window.keepwork;
    try {
        const models = sdk?.localAPIKeySettings?.listModels?.('Chat') || [];
        return models.filter((m) => m && m.enabled !== false);
    } catch (_) { return []; }
}
function modelValue(model) { return model?.name || model?.modelId || ''; }
function modelLabel(model) {
    const value = modelValue(model);
    return model?.modelId && model.modelId !== value ? `${value} (${model.modelId})` : value;
}

// minigames/AGENTS.md 与小游戏清单一样是 side-by-side 资源，用 slurp-safe 模式解析 URL。
// `import.meta.url + ''` 阻止 Vite 静态分析把父目录树打包进 assets/（见 view_minigames.js / config.js）。
const AGENTS_MD_URL = new URL('minigames/AGENTS.md', new URL('..', import.meta.url + '')).href;
let agentsMdPromise = null;
let agentsMdCache = '';

function loadAgentsMd() {
    if (agentsMdCache) return Promise.resolve(agentsMdCache);
    if (agentsMdPromise) return agentsMdPromise;
    agentsMdPromise = fetch(AGENTS_MD_URL, { cache: 'no-store' })
        .then((res) => (res.ok ? res.text() : ''))
        .then((text) => { agentsMdCache = text || ''; return agentsMdCache; })
        .catch(() => { agentsMdPromise = null; return ''; });
    return agentsMdPromise;
}

// ---------- 中止 / 流式工具（与 view_story_maker 同款约定） ----------
function createAbortError() {
    const error = new Error('AI_GENERATION_ABORTED');
    error.name = 'AbortError';
    return error;
}
function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError();
}
function isAbortError(error) {
    return error?.name === 'AbortError' || error?.message === 'AI_GENERATION_ABORTED';
}
function waitWithAbort(promise, signal) {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(createAbortError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}
function textFromStreamPayload(value, payload) {
    if (typeof value === 'string' && value) return value;
    if (typeof payload === 'string' && payload) return payload;
    if (payload && typeof payload === 'object') {
        if (typeof payload.result === 'string') return payload.result;
        if (typeof payload.text === 'string') return payload.text;
        if (typeof payload.content === 'string') return payload.content;
        if (typeof payload.choices?.[0]?.message?.content === 'string') return payload.choices[0].message.content;
        if (typeof payload.choices?.[0]?.delta?.content === 'string') return payload.choices[0].delta.content;
    }
    return '';
}

// 从 AI 回复里提取完整 HTML 文档。优先 ```html 代码块，其次裸 <!DOCTYPE/<html>。
function extractHtml(text) {
    const raw = String(text || '');
    if (!raw.trim()) return '';
    const fence = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1] : raw;
    const docMatch = candidate.match(/<!DOCTYPE[\s\S]*<\/html>/i) || candidate.match(/<html[\s\S]*<\/html>/i);
    if (docMatch) return docMatch[0].trim();
    // 没有完整文档但包含 body 级内容时，包一层最小 HTML 骨架。
    if (/<(canvas|div|script|style|svg|body)/i.test(candidate)) {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${candidate.trim()}</body></html>`;
    }
    return '';
}

let activeGameMakerCleanup = null;
export function disposeGameMaker() {
    if (activeGameMakerCleanup) activeGameMakerCleanup();
    activeGameMakerCleanup = null;
}

// 快捷创意（点击即填入输入框）。
const QUICK_PROMPTS = [
    { icon: '🐍', key: 'mgGameQuickSnake' },
    { icon: '🧱', key: 'mgGameQuickBreakout' },
    { icon: '🏃', key: 'mgGameQuickRunner' },
    { icon: '🚀', key: 'mgGameQuickShooter' },
    { icon: '🧩', key: 'mgGameQuickPuzzle' },
    { icon: '🃏', key: 'mgGameQuickMemory' },
];

// game: 编辑已有游戏时传入 { record, html }；新建时为 null。
export function renderGameMaker(panel, { game = null } = {}, { onBack, onSaved } = {}) {
    disposeGameMaker();

    const record = game?.record || null;
    const editing = !!record;
    let currentHtml = (game?.html != null && String(game.html).trim()) ? String(game.html) : '';
    let gameName = record?.title || '';
    let gameIcon = record?.icon || '🎮';
    const gameDesc = record?.desc || '';
    let savedPath = record?.path || '';
    let activePane = 'chat'; // 'chat' | 'preview'
    let generating = false;
    let abortController = null;
    const messages = []; // { role: 'user'|'ai', text, pending }

    // 模型与会话状态。
    let selectedModel = loadPreferredModel();
    let chatId = `game-maker-${Date.now()}`; // 当前 AI 会话标识
    let historyRows = [];                    // 远程历史会话列表
    let historyOpen = false;

    panel.innerHTML = `
        <style>
            .mh-gm-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#0a1830 0%,#0f2747 100%); color:#e2e8f0; }
            .mh-gm-topbar { display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(8,16,34,.72); border-bottom:1px solid rgba(148,163,184,.16); backdrop-filter:blur(8px); flex-shrink:0; }
            .mh-gm-topbar .mh-gm-name { flex:1; min-width:0; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.24); border-radius:10px; color:#e2e8f0; font-size:15px; font-weight:800; padding:8px 10px; }
            .mh-gm-topbar .mh-gm-name::placeholder { color:#64748b; }
            .mh-gm-iconbtn { width:38px; height:38px; flex:0 0 38px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#cbd5e1; border-radius:10px; font-size:18px; display:grid; place-items:center; cursor:pointer; padding:0; }
            .mh-gm-save { flex:0 0 auto; border:0; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border-radius:10px; padding:9px 16px; font-size:14px; font-weight:800; cursor:pointer; }
            .mh-gm-save:disabled { opacity:.5; cursor:not-allowed; }

            /* 会话工具栏：模型选择 + 历史 + 新建 + 设置 */
            .mh-gm-toolbar { display:flex; align-items:center; gap:8px; padding:7px 12px; background:rgba(8,16,34,.5); border-bottom:1px solid rgba(148,163,184,.12); flex-shrink:0; flex-wrap:wrap; }
            .mh-gm-modelwrap { position:relative; flex:0 1 auto; min-width:0; }
            .mh-gm-model { appearance:none; -webkit-appearance:none; max-width:200px; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.24); border-radius:9px; color:#cbd5e1; font-size:13px; font-weight:700; padding:7px 28px 7px 12px; cursor:pointer; outline:none; }
            .mh-gm-model:disabled { opacity:.5; cursor:not-allowed; }
            .mh-gm-modelwrap::after { content:'⌄'; position:absolute; right:9px; top:50%; transform:translateY(-60%); color:#94a3b8; font-size:13px; pointer-events:none; }
            .mh-gm-toolbar-spacer { flex:1 1 auto; }
            .mh-gm-toolbtn { width:36px; height:36px; flex:0 0 36px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#cbd5e1; border-radius:9px; font-size:16px; display:grid; place-items:center; cursor:pointer; padding:0; }
            .mh-gm-toolbtn:hover { border-color:#6366f1; color:#a5b4fc; }
            .mh-gm-toolbtn svg { width:18px; height:18px; }
            .mh-gm-history-pop { position:absolute; right:12px; top:100%; margin-top:4px; z-index:30; width:min(320px,calc(100vw - 24px)); max-height:60vh; overflow:auto; background:#0f2747; border:1px solid rgba(148,163,184,.28); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.45); padding:6px; display:none; }
            .mh-gm-history-pop.open { display:block; }
            .mh-gm-history-item { display:block; width:100%; text-align:left; background:none; border:0; color:#e2e8f0; font-size:13px; padding:10px 12px; border-radius:8px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gm-history-item:hover { background:rgba(99,102,241,.16); }
            .mh-gm-history-item.active { background:rgba(99,102,241,.24); color:#a5b4fc; font-weight:700; }
            .mh-gm-history-empty { padding:14px 12px; color:#64748b; font-size:13px; text-align:center; }

            .mh-gm-tabbar { display:flex; background:rgba(8,16,34,.6); border-bottom:1px solid rgba(148,163,184,.16); flex-shrink:0; }
            .mh-gm-tabbar button { flex:1; min-height:44px; padding:8px 6px; background:none; border:0; border-bottom:2px solid transparent; color:#64748b; font-size:14px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:5px; }
            .mh-gm-tabbar button.active { color:#a5b4fc; border-bottom-color:#6366f1; }

            .mh-gm-stage { flex:1; min-height:0; position:relative; }
            .mh-gm-pane { position:absolute; inset:0; display:none; flex-direction:column; min-height:0; }
            .mh-gm-pane.active { display:flex; }

            .mh-gm-chat-msgs { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
            .mh-gm-welcome { padding:14px 4px; text-align:center; }
            .mh-gm-welcome-star { font-size:40px; line-height:1; }
            .mh-gm-welcome-title { margin-top:10px; font-size:19px; font-weight:900; color:#f1f5f9; }
            .mh-gm-welcome-sub { margin-top:5px; font-size:13px; color:#94a3b8; line-height:1.5; }
            .mh-gm-quickgrid { margin-top:16px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
            .mh-gm-quick { display:flex; align-items:center; gap:9px; padding:12px; border:1px solid rgba(148,163,184,.22); background:rgba(255,255,255,.04); border-radius:12px; color:#cbd5e1; font-size:14px; font-weight:700; cursor:pointer; text-align:left; }
            .mh-gm-quick:hover { border-color:#6366f1; background:rgba(99,102,241,.12); }
            .mh-gm-quick .mh-gm-quick-ico { font-size:20px; flex:0 0 auto; }

            .mh-gm-msg { display:flex; }
            .mh-gm-msg.user { justify-content:flex-end; }
            .mh-gm-msg.ai { justify-content:flex-start; }
            .mh-gm-bubble { max-width:86%; padding:10px 14px; border-radius:14px; font-size:14px; line-height:1.5; word-break:break-word; white-space:pre-wrap; }
            .mh-gm-bubble.user { background:#6366f1; color:#fff; border-bottom-right-radius:4px; }
            .mh-gm-bubble.ai { background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.2); color:#e2e8f0; border-bottom-left-radius:4px; }
            .mh-gm-dots span { display:inline-block; width:6px; height:6px; margin:0 1px; border-radius:50%; background:#a5b4fc; animation:mhGmDot 1s ease-in-out infinite; }
            .mh-gm-dots span:nth-child(2){animation-delay:.15s} .mh-gm-dots span:nth-child(3){animation-delay:.3s}
            @keyframes mhGmDot { 0%,80%,100%{opacity:.3;transform:translateY(0)} 40%{opacity:1;transform:translateY(-3px)} }

            .mh-gm-input-area { padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px)); border-top:1px solid rgba(148,163,184,.16); flex-shrink:0; }
            .mh-gm-input-box { display:flex; align-items:flex-end; gap:8px; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.24); border-radius:14px; padding:8px 10px 8px 14px; }
            .mh-gm-textarea { flex:1; background:none; border:0; color:#e2e8f0; font-size:16px; resize:none; outline:none; line-height:1.5; min-height:48px; max-height:200px; font-family:inherit; }
            .mh-gm-textarea::placeholder { color:#64748b; }
            .mh-gm-send { flex:0 0 auto; width:40px; height:40px; border:0; border-radius:10px; background:#6366f1; color:#fff; display:grid; place-items:center; cursor:pointer; }
            .mh-gm-send:disabled { opacity:.4; cursor:not-allowed; }
            .mh-gm-send svg { width:20px; height:20px; }

            .mh-gm-preview-body { flex:1; min-height:0; position:relative; background:#000; }
            .mh-gm-preview-frame { width:100%; height:100%; border:0; background:#fff; }
            .mh-gm-preview-empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:#475569; padding:24px; text-align:center; font-size:13px; }
            .mh-gm-preview-empty .mh-gm-preview-empty-ico { font-size:40px; }

            @media (min-width: 860px) {
                .mh-gm-tabbar { display:none; }
                .mh-gm-stage { display:flex; flex-direction:row; }
                .mh-gm-pane { position:relative; inset:auto; display:flex !important; }
                .mh-gm-pane.chat { width:420px; min-width:340px; flex:0 0 auto; border-right:1px solid rgba(148,163,184,.16); }
                .mh-gm-pane.preview { flex:1; }
            }
        </style>
        <div class="mh-gm-root">
            <div class="mh-gm-topbar">
                <button type="button" class="mh-gm-iconbtn" id="mhGmBack" title="${escapeHtml(t('back'))}" aria-label="${escapeHtml(t('back'))}">‹</button>
                <input class="mh-gm-name" id="mhGmName" type="text" maxlength="64" placeholder="${escapeHtml(t('mgGameNamePlaceholder'))}" value="${escapeHtml(gameName)}">
                <button type="button" class="mh-gm-iconbtn" id="mhGmIcon" title="${escapeHtml(t('mgGameIconLabel'))}" aria-label="${escapeHtml(t('mgGameIconLabel'))}">${escapeHtml(gameIcon)}</button>
                <button type="button" class="mh-gm-save" id="mhGmSave">${escapeHtml(t('mgGameSave'))}</button>
            </div>
            <div class="mh-gm-toolbar">
                <div class="mh-gm-modelwrap">
                    <select class="mh-gm-model" id="mhGmModel" title="${escapeHtml(t('mgGameModelLabel'))}" aria-label="${escapeHtml(t('mgGameModelLabel'))}"></select>
                </div>
                <div class="mh-gm-toolbar-spacer"></div>
                <button type="button" class="mh-gm-toolbtn" id="mhGmConfig" title="${escapeHtml(t('mgGameConfigLabel'))}" aria-label="${escapeHtml(t('mgGameConfigLabel'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
                </button>
                <button type="button" class="mh-gm-toolbtn" id="mhGmHistory" title="${escapeHtml(t('mgGameHistoryLabel'))}" aria-label="${escapeHtml(t('mgGameHistoryLabel'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
                </button>
                <button type="button" class="mh-gm-toolbtn" id="mhGmNew" title="${escapeHtml(t('mgGameNewSession'))}" aria-label="${escapeHtml(t('mgGameNewSession'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>
                <div class="mh-gm-history-pop" id="mhGmHistoryPop"></div>
            </div>
            <div class="mh-gm-tabbar">
                <button type="button" class="active" data-mh-gm-pane="chat">💬 ${escapeHtml(t('mgGameTabChat'))}</button>
                <button type="button" data-mh-gm-pane="preview">▶ ${escapeHtml(t('mgGamePreview'))}</button>
            </div>
            <div class="mh-gm-stage">
                <div class="mh-gm-pane chat active" data-mh-gm-pane-body="chat">
                    <div class="mh-gm-chat-msgs" id="mhGmMsgs"></div>
                    <div class="mh-gm-input-area">
                        <div class="mh-gm-input-box">
                            <textarea class="mh-gm-textarea" id="mhGmInput" rows="2" placeholder="${escapeHtml(t('mgGameChatPlaceholder'))}"></textarea>
                            <button type="button" class="mh-gm-send" id="mhGmSend" aria-label="${escapeHtml(t('mgGameSend'))}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="mh-gm-pane preview" data-mh-gm-pane-body="preview">
                    <div class="mh-gm-preview-body">
                        <iframe class="mh-gm-preview-frame" id="mhGmPreviewFrame" title="${escapeHtml(t('mgGamePreview'))}" allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock"></iframe>
                        <div class="mh-gm-preview-empty" id="mhGmPreviewEmpty">
                            <span class="mh-gm-preview-empty-ico" aria-hidden="true">🎮</span>
                            <span>${escapeHtml(t('mgGamePreviewEmpty'))}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

    const msgsEl = $('mhGmMsgs');
    const inputEl = $('mhGmInput');
    const sendBtn = $('mhGmSend');
    const previewFrame = $('mhGmPreviewFrame');
    const previewEmpty = $('mhGmPreviewEmpty');
    const nameEl = $('mhGmName');
    const iconBtn = $('mhGmIcon');
    const modelSelect = $('mhGmModel');
    const historyBtn = $('mhGmHistory');
    const historyPop = $('mhGmHistoryPop');
    const newBtn = $('mhGmNew');
    const configBtn = $('mhGmConfig');

    // ---------- 模型选择 ----------
    function populateModelSelect() {
        if (!modelSelect) return;
        const models = listChatModels();
        const defaultOpt = `<option value="">${escapeHtml(t('mgGameModelDefault'))}</option>`;
        modelSelect.innerHTML = defaultOpt + models.map((m) => {
            const value = modelValue(m);
            return `<option value="${escapeHtml(value)}">${escapeHtml(modelLabel(m))}</option>`;
        }).join('');
        // 若记忆的模型仍可用则选中，否则回落默认。
        if (selectedModel && models.some((m) => modelValue(m) === selectedModel)) {
            modelSelect.value = selectedModel;
        } else {
            selectedModel = '';
            modelSelect.value = '';
        }
    }

    // ---------- 历史会话 ----------
    async function refreshHistoryRows() {
        const sdk = state.sdk || window.keepwork;
        if (!sdk?.token || !sdk?.aiChat?.getChatHistory) { historyRows = []; return; }
        try {
            const res = await sdk.aiChat.getChatHistory(GAME_MAKER_MOD_ID);
            historyRows = Array.isArray(res?.rows) ? res.rows.slice() : [];
            // 最新在前。
            historyRows.sort((a, b) => new Date(b?.updatedAt || b?.createdAt || 0) - new Date(a?.updatedAt || a?.createdAt || 0));
        } catch (_) { historyRows = []; }
    }

    function renderHistoryPop() {
        if (!historyPop) return;
        const sdk = state.sdk || window.keepwork;
        if (!sdk?.token) {
            historyPop.innerHTML = `<div class="mh-gm-history-empty">${escapeHtml(t('mgGameHistoryLoginNeeded'))}</div>`;
            return;
        }
        if (!historyRows.length) {
            historyPop.innerHTML = `<div class="mh-gm-history-empty">${escapeHtml(t('mgGameHistoryEmpty'))}</div>`;
            return;
        }
        historyPop.innerHTML = historyRows.map((row) => {
            const title = (row?.title || '').trim() || t('mgGameHistoryUntitled');
            const active = row?.chatId === chatId ? ' active' : '';
            return `<button type="button" class="mh-gm-history-item${active}" data-mh-gm-chatid="${escapeHtml(String(row?.chatId || ''))}" title="${escapeHtml(title)}">${escapeHtml(title)}</button>`;
        }).join('');
    }

    function closeHistoryPop() {
        historyOpen = false;
        if (historyPop) historyPop.classList.remove('open');
    }

    async function toggleHistoryPop() {
        historyOpen = !historyOpen;
        if (!historyOpen) { closeHistoryPop(); return; }
        if (historyPop) historyPop.classList.add('open');
        await refreshHistoryRows();
        renderHistoryPop();
    }

    // 载入一条历史会话：还原对话气泡与最近一次生成的 HTML。
    function loadHistoryRow(row) {
        if (!row) return;
        abortController?.abort();
        chatId = row.chatId || `game-maker-${Date.now()}`;
        messages.length = 0;
        currentHtml = '';
        const rowMessages = Array.isArray(row.messages) ? row.messages : [];
        for (const m of rowMessages) {
            if (!m || m.role === 'system') continue;
            const content = typeof m.content === 'string' ? m.content : '';
            if (m.role === 'user') {
                messages.push({ role: 'user', text: content });
            } else if (m.role === 'assistant') {
                const html = extractHtml(content);
                if (html) {
                    currentHtml = html;
                    messages.push({ role: 'ai', text: t('mgGameAiDone') });
                } else if (content.trim()) {
                    messages.push({ role: 'ai', text: content.trim().slice(0, 600) });
                }
            }
        }
        if (row.title && !gameName.trim()) {
            gameName = String(row.title).slice(0, 24);
            if (nameEl) nameEl.value = gameName;
        }
        renderMessages();
        setPreview(currentHtml);
        closeHistoryPop();
        switchPane('chat');
    }

    function startNewSession() {
        abortController?.abort();
        chatId = `game-maker-${Date.now()}`;
        messages.length = 0;
        currentHtml = '';
        renderMessages();
        setPreview(currentHtml);
        closeHistoryPop();
        switchPane('chat');
        showToast(t('mgGameNewSessionDone'), 'info', 1200);
    }

    function scrollMsgsToEnd() {
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function renderMessages() {
        if (!msgsEl) return;
        if (!messages.length) {
            msgsEl.innerHTML = `
                <div class="mh-gm-welcome">
                    <div class="mh-gm-welcome-star" aria-hidden="true">✨</div>
                    <div class="mh-gm-welcome-title">${escapeHtml(t('mgGameWelcomeTitle'))}</div>
                    <div class="mh-gm-welcome-sub">${escapeHtml(t('mgGameWelcomeSub'))}</div>
                    <div class="mh-gm-quickgrid">
                        ${QUICK_PROMPTS.map(q => `
                            <button type="button" class="mh-gm-quick" data-mh-gm-quick="${escapeHtml(t(q.key))}">
                                <span class="mh-gm-quick-ico" aria-hidden="true">${q.icon}</span>
                                <span>${escapeHtml(t(q.key))}</span>
                            </button>`).join('')}
                    </div>
                </div>`;
            return;
        }
        msgsEl.innerHTML = messages.map((m) => {
            const cls = m.role === 'user' ? 'user' : 'ai';
            const body = m.pending
                ? '<span class="mh-gm-dots" aria-label="…"><span></span><span></span><span></span></span>'
                : escapeHtml(m.text || '');
            return `<div class="mh-gm-msg ${cls}"><div class="mh-gm-bubble ${cls}">${body}</div></div>`;
        }).join('');
        scrollMsgsToEnd();
    }

    function setPreview(html) {
        if (!previewFrame) return;
        if (html && html.trim()) {
            previewFrame.srcdoc = html;
            if (previewEmpty) previewEmpty.style.display = 'none';
        } else {
            previewFrame.removeAttribute('srcdoc');
            if (previewEmpty) previewEmpty.style.display = 'flex';
        }
    }

    function switchPane(pane) {
        activePane = pane === 'preview' ? 'preview' : 'chat';
        panel.querySelectorAll('[data-mh-gm-pane]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mhGmPane === activePane);
        });
        panel.querySelectorAll('[data-mh-gm-pane-body]').forEach(body => {
            body.classList.toggle('active', body.dataset.mhGmPaneBody === activePane);
        });
    }

    function autoResize() {
        if (!inputEl) return;
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(200, Math.max(48, inputEl.scrollHeight)) + 'px';
    }

    // ---------- AI 生成 ----------
    async function generateGame(promptText) {
        const sdk = state.sdk || window.keepwork;
        const agentsMd = await loadAgentsMd();
        const lang = getLang();
        const langLine = lang === 'en'
            ? 'The game UI text should match the user request language.'
            : '游戏界面文字默认使用简体中文。';
        const baseRules = [
            'You are an expert HTML5 game developer for the MagicHaqi pet platform.',
            'Generate a COMPLETE, self-contained, single-file HTML5 game that runs standalone inside an iframe.',
            'Output ONLY one fenced ```html code block containing the full document from <!DOCTYPE html> to </html>. No prose before or after the code block.',
            'Inline all CSS and JavaScript. Use only CDN resources (e.g. Tailwind / Three.js) as described in the guide; no local files.',
            'Mobile-first and touch friendly, no scrollbars; the game must fit the iframe viewport.',
            'When the game ends you may call parent.postMessage({ type: "gameFinished", data: { score } }, "*").',
            langLine,
        ].join('\n');
        const systemPrompt = agentsMd
            ? `${baseRules}\n\n--- Platform game development guide (follow it) ---\n${agentsMd}`
            : baseRules;

        // 迭代上下文：附带当前 HTML（截断防过长），让 AI 在现有基础上修改。
        const historyNote = currentHtml
            ? `\n\nThe current game HTML is below. Modify it according to the new request and return the full updated document.\n\n\`\`\`html\n${currentHtml.slice(0, 12000)}\n\`\`\``
            : '';
        const userPrompt = `${promptText}${historyNote}`;

        abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const signal = abortController?.signal;
        let text = '';
        const onChunk = (delta) => {
            throwIfAborted(signal);
            if (typeof delta === 'string' && delta) text += delta;
        };
        const onMessage = (value, payload) => {
            throwIfAborted(signal);
            const next = textFromStreamPayload(value, payload);
            if (!next) return;
            text = next.startsWith(text) ? next : (text + next);
        };

        // 仅在已登录时持久化历史（getChatHistory/upsert 需要 token）。
        const persistHistory = !!sdk?.token;
        const model = selectedModel || undefined;

        if (sdk?.aiChat?.createSession) {
            const session = sdk.aiChat.createSession({
                modId: GAME_MAKER_MOD_ID,
                chatId,
                skipHistory: !persistHistory,
                systemPrompt,
                model,
            });
            try {
                const p = session.send(userPrompt, { stream: true, abortController, onMessage, onChunk, systemPrompt, model });
                p.catch(() => {});
                const result = await waitWithAbort(p, signal);
                if (!text) text = (result?.text || result?.result || result || '').toString();
            } finally {
                try { session.destroy?.(); } catch (_) {}
            }
        } else if (sdk?.aiChat?.chat) {
            const p = sdk.aiChat.chat({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], modId: GAME_MAKER_MOD_ID, model, stream: true, abortController, onMessage, onChunk });
            p.catch(() => {});
            const result = await waitWithAbort(p, signal);
            if (!text) text = (result?.text || result?.result || result || '').toString();
        } else if (sdk?.aiGenerators?.chat) {
            const p = sdk.aiGenerators.chat({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], model, stream: true, abortController, onMessage, onChunk });
            p.catch(() => {});
            const result = await waitWithAbort(p, signal);
            if (!text) text = (result?.text || result?.choices?.[0]?.message?.content || '').toString();
        } else {
            throw new Error(t('mgGameAiUnavailable'));
        }
        throwIfAborted(signal);
        return text;
    }

    async function handleSend(promptText) {
        const text = String(promptText != null ? promptText : (inputEl?.value || '')).trim();
        if (!text || generating) return;
        if (inputEl) { inputEl.value = ''; autoResize(); }
        generating = true;
        if (sendBtn) sendBtn.disabled = true;
        messages.push({ role: 'user', text });
        const aiMsg = { role: 'ai', text: '', pending: true };
        messages.push(aiMsg);
        renderMessages();

        try {
            const reply = await generateGame(text);
            const html = extractHtml(reply);
            aiMsg.pending = false;
            if (html) {
                currentHtml = html;
                aiMsg.text = t('mgGameAiDone');
                setPreview(currentHtml);
                if (!gameName.trim()) {
                    gameName = text.slice(0, 24);
                    if (nameEl) nameEl.value = gameName;
                }
                // 桌面端预览常驻；移动端自动切到预览看效果。
                if (window.matchMedia?.('(max-width: 859px)')?.matches) switchPane('preview');
            } else {
                aiMsg.text = reply?.trim() ? reply.trim().slice(0, 600) : t('mgGameAiNoHtml');
            }
        } catch (e) {
            aiMsg.pending = false;
            if (isAbortError(e)) {
                aiMsg.text = t('mgGameAiStopped');
            } else {
                aiMsg.text = t('mgGameAiError', { error: (e?.message || e) });
                showToast(t('mgGameAiError', { error: (e?.message || e) }), 'error', 2600);
            }
        } finally {
            generating = false;
            abortController = null;
            if (sendBtn) sendBtn.disabled = false;
            renderMessages();
        }
    }

    async function handleSave() {
        const name = (nameEl?.value || '').trim();
        if (!name) { showToast(t('mgGameNeedName'), 'info', 1600); nameEl?.focus(); return; }
        if (!currentHtml.trim()) { showToast(t('mgGameNeedHtml'), 'info', 1800); return; }
        gameName = name;
        const saveBtn = $('mhGmSave');
        if (saveBtn) saveBtn.disabled = true;
        try {
            // 编辑时沿用原文件名（基于 record.path），避免改名产生孤儿文件。
            const existingBaseName = savedPath
                ? (String(savedPath).split('/').pop() || '').replace(/\.html?$/i, '')
                : '';
            const result = await savePetGame(currentHtml, {
                name: existingBaseName || name,
                id: record?.id || undefined,
                title: name,
                icon: gameIcon || '🎮',
                desc: gameDesc || '',
            });
            savedPath = result?.path || savedPath;
            showToast(t('mgGameSaved'), 'success', 1400);
            onSaved?.(result);
        } catch (e) {
            showToast(t('mgGameSaveFailed', { error: (e?.message || e) }), 'error', 2600);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    // ---------- 事件绑定 ----------
    $('mhGmBack').onclick = () => { abortController?.abort(); onBack?.(); };
    $('mhGmSave').onclick = handleSave;
    iconBtn.onclick = async () => {
        const next = await promptDialog(t('mgGameIconLabel'), { defaultValue: gameIcon || '🎮', maxLength: 4, placeholder: '🎮' });
        if (next != null) { gameIcon = (next || '').trim() || '🎮'; iconBtn.textContent = gameIcon; }
    };
    nameEl?.addEventListener('input', () => { gameName = nameEl.value; });
    sendBtn.onclick = () => handleSend();
    inputEl?.addEventListener('input', autoResize);
    inputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    panel.querySelectorAll('[data-mh-gm-pane]').forEach(btn => {
        btn.onclick = () => switchPane(btn.dataset.mhGmPane);
    });
    msgsEl?.addEventListener('click', (e) => {
        const quick = e.target.closest?.('[data-mh-gm-quick]');
        if (quick && inputEl) { inputEl.value = quick.dataset.mhGmQuick; autoResize(); inputEl.focus(); }
    });

    // 模型选择：记住选择，供后续生成使用。
    modelSelect?.addEventListener('change', () => {
        selectedModel = modelSelect.value || '';
        savePreferredModel(selectedModel);
    });

    // 历史会话：切换弹层 + 选择某条历史。
    historyBtn.onclick = (e) => { e.stopPropagation(); toggleHistoryPop(); };
    historyPop?.addEventListener('click', (e) => {
        const item = e.target.closest?.('[data-mh-gm-chatid]');
        if (!item) return;
        const row = historyRows.find((r) => String(r?.chatId || '') === item.dataset.mhGmChatid);
        if (row) loadHistoryRow(row);
    });

    // 新建会话。
    newBtn.onclick = startNewSession;

    // 本地 API 设置弹窗。
    configBtn.onclick = async () => {
        const sdk = state.sdk || window.keepwork;
        if (sdk?.localAPIKeySettings?.show) {
            await sdk.localAPIKeySettings.show({
                title: t('mgGameConfigTitle'),
                fullscreen: true,
                onSave: () => populateModelSelect(),
            });
        } else {
            showToast(t('mgGameAiUnavailable'), 'info', 1600);
        }
        populateModelSelect();
    };

    // 点击别处关闭历史弹层。
    const onDocPointerDown = (e) => {
        if (!historyOpen) return;
        if (historyPop?.contains(e.target) || historyBtn?.contains(e.target)) return;
        closeHistoryPop();
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    // ---------- 初始化 ----------
    renderMessages();
    setPreview(currentHtml);
    if (editing) {
        messages.push({ role: 'ai', text: t('mgGameEditWelcome', { title: gameName || t('mgDefaultName') }) });
        renderMessages();
    }
    // 预热 AGENTS.md（不阻塞）。
    loadAgentsMd();
    // 加载本地模型列表后填充下拉。
    (async () => {
        const sdk = state.sdk || window.keepwork;
        try { await sdk?.localAPIKeySettings?.load?.(); } catch (_) {}
        populateModelSelect();
    })();

    activeGameMakerCleanup = () => {
        try { abortController?.abort(); } catch (_) {}
        try { document.removeEventListener('pointerdown', onDocPointerDown, true); } catch (_) {}
        abortController = null;
        activeGameMakerCleanup = null;
    };
}
