// 小游戏创造视图（全屏）：AI vibe-coding 工坊。
// 玩家用自然语言描述想要的游戏，AI 基于 minigames/AGENTS.md 生成完整 HTML5 单页游戏，
// 支持实时预览与多轮迭代，保存到 PersonalPageStore 的 pet-games/ 目录。
import { $, escapeHtml, showToast } from './utils.js';
import { t, getLang } from './i18n.js';
import { state } from './state.js';
import { savePetGame } from './storage.js';

// 游戏创作工坊的 AI 会话共用同一个 modId，chatId 区分不同会话，便于列出历史。
const GAME_MAKER_MOD_ID = 'magichaqi-game-maker';
const GAME_MAKER_MODEL_KEY = 'mh_game_maker_model';
const GAME_MAKER_WORKSPACE_PREFIX = 'magichaqi-game-maker';
const GAME_MAKER_FILE_PATH = 'game.html';

// ---------- 本地 IndexedDB 会话历史（7 天过期） ----------
const LOCAL_HISTORY_DB_NAME = 'magichaqi-game-maker-sessions';
const LOCAL_HISTORY_DB_VERSION = 1;
const LOCAL_HISTORY_STORE = 'sessions';
const LOCAL_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _localHistoryDB = null;
let _localHistoryDBPromise = null;

function openLocalHistoryDB() {
    if (_localHistoryDB) return Promise.resolve(_localHistoryDB);
    if (_localHistoryDBPromise) return _localHistoryDBPromise;
    _localHistoryDBPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(LOCAL_HISTORY_DB_NAME, LOCAL_HISTORY_DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(LOCAL_HISTORY_STORE)) {
                    const store = db.createObjectStore(LOCAL_HISTORY_STORE, { keyPath: 'chatId' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };
            req.onsuccess = () => { _localHistoryDB = req.result; resolve(_localHistoryDB); };
            req.onerror = () => { _localHistoryDBPromise = null; reject(req.error); };
        } catch (e) { _localHistoryDBPromise = null; reject(e); }
    });
    return _localHistoryDBPromise;
}

async function saveLocalSession(chatId, title, messages, html, gamePath) {
    try {
        const db = await openLocalHistoryDB();
        const tx = db.transaction(LOCAL_HISTORY_STORE, 'readwrite');
        const store = tx.objectStore(LOCAL_HISTORY_STORE);
        store.put({
            chatId,
            title: title || '',
            messages: Array.isArray(messages) ? messages.map(m => ({
                role: m.role,
                text: m.text || '',
                reasoning: m.reasoning || '',
                toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls.map(normalizeToolEventForStore) : [],
            })) : [],
            html: html || '',
            gamePath: gamePath || '',
            updatedAt: Date.now(),
        });
    } catch (_) { /* IndexedDB 不可用时静默失败 */ }
}

async function listLocalSessions(gamePath) {
    try {
        const db = await openLocalHistoryDB();
        const now = Date.now();
        const cutoff = now - LOCAL_HISTORY_TTL_MS;
        // 先清理过期条目。
        const txClean = db.transaction(LOCAL_HISTORY_STORE, 'readwrite');
        const storeClean = txClean.objectStore(LOCAL_HISTORY_STORE);
        const idxClean = storeClean.index('updatedAt');
        const rangeClean = IDBKeyRange.upperBound(cutoff, true);
        idxClean.openCursor(rangeClean).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
        };
        // 再读取有效条目。
        return await new Promise((resolve) => {
            const tx = db.transaction(LOCAL_HISTORY_STORE, 'readonly');
            const store = tx.objectStore(LOCAL_HISTORY_STORE);
            const idx = store.index('updatedAt');
            const range = IDBKeyRange.lowerBound(cutoff);
            const req = idx.getAll(range);
            req.onsuccess = () => {
                let rows = Array.isArray(req.result) ? req.result : [];
                // 按 gamePath 过滤（如果指定）。
                if (gamePath) {
                    rows = rows.filter(r => r.gamePath === gamePath);
                }
                rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                resolve(rows);
            };
            req.onerror = () => resolve([]);
        });
    } catch (_) { return []; }
}

async function getLocalSession(chatId) {
    try {
        const db = await openLocalHistoryDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(LOCAL_HISTORY_STORE, 'readonly');
            const store = tx.objectStore(LOCAL_HISTORY_STORE);
            const req = store.get(chatId);
            req.onsuccess = () => {
                const row = req.result;
                if (row && row.updatedAt && (Date.now() - row.updatedAt > LOCAL_HISTORY_TTL_MS)) {
                    resolve(null); // 已过期
                } else {
                    resolve(row || null);
                }
            };
            req.onerror = () => resolve(null);
        });
    } catch (_) { return null; }
}

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

function extractHtmlTitle(html) {
    const raw = String(html || '');
    if (!raw.trim()) return '';
    try {
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        const title = doc.querySelector('title')?.textContent?.trim();
        if (title) return title.slice(0, 64);
    } catch (_) {}
    const match = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].replace(/<[^>]*>/g, '').trim().slice(0, 64) : '';
}

function firstEmoji(text) {
    const match = String(text || '').match(/\p{Extended_Pictographic}(?:\uFE0F|\uFE0E|\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)*)?/u);
    return match ? match[0] : '';
}

function normalizeToolEventForStore(tool) {
    return {
        id: tool?.id || '',
        name: tool?.name || '',
        status: tool?.status || '',
        args: tool?.args || '',
        result: tool?.result || '',
        detailResult: tool?.detailResult || tool?.result || '',
        error: tool?.error || '',
        ts: tool?.ts || Date.now(),
    };
}

function safeJsonParse(text, fallback = {}) {
    try { return JSON.parse(text || '{}'); } catch (_) { return fallback; }
}

function stringifyToolDetail(value, limit = 8000) {
    let text = '';
    try {
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch (_) {
        text = String(value || '');
    }
    return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

function summarizeToolResult(result) {
    const text = stringifyToolDetail(result, 500);
    if (!text) return '';
    const firstLine = text.split('\n').find(line => line.trim()) || text;
    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
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

// 游戏图标的可选 Emoji 列表。
const EMOJI_OPTIONS = [
    '🎮', '🕹️', '👾', '🏆', '🎯', '🎲',
    '🧩', '🃏', '🐍', '🧱', '🚀', '🏃',
    '🐉', '🐾', '🌟', '💎', '🔥', '⚡',
    '🎵', '🌈', '🤖', '🦁', '🦊', '🐱',
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

    const getSessionWorkspace = () => `${GAME_MAKER_WORKSPACE_PREFIX}-${chatId}`;

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
            .mh-gm-toolbar { display:flex; align-items:center; gap:8px; padding:7px 12px; background:rgba(8,16,34,.5); border-bottom:1px solid rgba(148,163,184,.12); flex-shrink:0; overflow:visible; }
            .mh-gm-modelwrap { position:relative; flex:1 1 0; min-width:0; overflow:visible; }
            .mh-gm-model-btn { width:100%; appearance:none; background:#0f2747; border:1px solid rgba(148,163,184,.24); border-radius:9px; color:#e2e8f0; font-size:13px; font-weight:700; padding:7px 28px 7px 12px; cursor:pointer; outline:none; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gm-model-btn:disabled { opacity:.5; cursor:not-allowed; }
            .mh-gm-modelwrap::after { content:'⌄'; position:absolute; right:9px; top:50%; transform:translateY(-60%); color:#94a3b8; font-size:13px; pointer-events:none; }
            .mh-gm-model-list { position:absolute; bottom:calc(100% + 4px); left:0; right:0; z-index:40; max-height:260px; overflow:auto; background:#0f2747; border:1px solid rgba(148,163,184,.28); border-radius:10px; box-shadow:0 -8px 24px rgba(0,0,0,.4); padding:4px; display:none; }
            .mh-gm-model-list.open { display:block; }
            .mh-gm-model-item { display:block; width:100%; text-align:left; background:none; border:0; color:#e2e8f0; font-size:13px; padding:9px 12px; border-radius:7px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gm-model-item:hover { background:rgba(99,102,241,.16); }
            .mh-gm-model-item.active { background:rgba(99,102,241,.24); color:#a5b4fc; font-weight:700; }
            .mh-gm-toolbtn { width:36px; height:36px; flex:0 0 36px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#cbd5e1; border-radius:9px; font-size:16px; display:grid; place-items:center; cursor:pointer; padding:0; }
            .mh-gm-toolbtn:hover { border-color:#6366f1; color:#a5b4fc; }
            .mh-gm-toolbtn svg { width:18px; height:18px; }
            .mh-gm-history-pop { position:absolute; right:12px; top:100%; margin-top:4px; z-index:30; width:min(320px,calc(100vw - 24px)); max-height:60vh; overflow:auto; background:#0f2747; border:1px solid rgba(148,163,184,.28); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.45); padding:6px; display:none; }
            .mh-gm-history-pop.open { display:block; }
            .mh-gm-history-item { display:block; width:100%; text-align:left; background:none; border:0; color:#e2e8f0; font-size:13px; padding:10px 12px; border-radius:8px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gm-history-item:hover { background:rgba(99,102,241,.16); }
            .mh-gm-history-item.active { background:rgba(99,102,241,.24); color:#a5b4fc; font-weight:700; }
            .mh-gm-history-empty { padding:14px 12px; color:#64748b; font-size:13px; text-align:center; }
            .mh-gm-emoji-dialog-overlay { position:absolute; inset:0; z-index:70; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(6,18,44,.58); backdrop-filter:blur(5px); }
            .mh-gm-emoji-dialog { width:min(320px,calc(100vw - 36px)); border-radius:16px; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.36); box-shadow:0 18px 48px rgba(0,0,0,.48); padding:14px; display:flex; flex-direction:column; gap:12px; }
            .mh-gm-emoji-dialog-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#e2e8f0; font-size:15px; font-weight:900; }
            .mh-gm-emoji-dialog-close { width:30px; height:30px; border:0; border-radius:8px; background:rgba(255,255,255,.08); color:#94a3b8; display:grid; place-items:center; cursor:pointer; font-size:16px; }
            .mh-gm-emoji-dialog-close:hover { background:rgba(255,255,255,.14); color:#e2e8f0; }
            .mh-gm-emoji-input-row { display:flex; gap:8px; align-items:center; }
            .mh-gm-emoji-input { flex:1; min-width:0; height:44px; border-radius:11px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#e2e8f0; font-size:24px; text-align:center; outline:none; }
            .mh-gm-emoji-auto { flex:0 0 auto; min-width:86px; height:44px; border:0; border-radius:11px; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; font-size:13px; font-weight:900; cursor:pointer; padding:0 12px; }
            .mh-gm-emoji-auto:disabled { opacity:.55; cursor:not-allowed; }
            .mh-gm-emoji-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:4px; }
            .mh-gm-emoji-btn { width:40px; height:40px; border:1px solid rgba(148,163,184,.12); background:rgba(255,255,255,.04); border-radius:8px; font-size:22px; display:grid; place-items:center; cursor:pointer; padding:0; }
            .mh-gm-emoji-btn:hover { background:rgba(99,102,241,.2); border-color:#6366f1; }
            .mh-gm-emoji-btn.active { background:rgba(99,102,241,.3); border-color:#818cf8; }
            .mh-gm-emoji-actions { display:flex; gap:8px; }
            .mh-gm-emoji-actions button { flex:1; border:0; border-radius:10px; padding:10px 12px; font-size:14px; font-weight:900; cursor:pointer; }
            .mh-gm-emoji-cancel { background:rgba(255,255,255,.08); color:#cbd5e1; }
            .mh-gm-emoji-ok { background:#6366f1; color:#fff; }

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

            /* Streaming cursor at the end of live AI text. */
            .mh-gm-stream-cursor { display:inline-block; width:2px; height:1em; margin-left:2px; background:#a5b4fc; vertical-align:text-bottom; animation:mhGmCursorBlink .7s step-end infinite; }
            @keyframes mhGmCursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }

            /* Streaming text popup (hover/tap AI bubble while it is generating). */
            .mh-gm-bubble.ai.is-live { cursor:pointer; }
            .mh-gm-stream-popup { position:absolute; left:8px; right:8px; bottom:calc(82px + env(safe-area-inset-bottom,0px)); z-index:55; max-height:68vh; border-radius:16px; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.35); box-shadow:0 16px 40px rgba(0,0,0,.45); padding:12px; display:flex; flex-direction:column; gap:8px; }
            .mh-gm-stream-popup-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#e2e8f0; font-size:14px; font-weight:800; }
            .mh-gm-stream-popup-close { border:0; background:rgba(255,255,255,.08); color:#94a3b8; border-radius:8px; width:28px; height:28px; display:grid; place-items:center; cursor:pointer; font-size:16px; }
            .mh-gm-stream-popup-close:hover { background:rgba(255,255,255,.14); color:#e2e8f0; }
            .mh-gm-stream-popup-body { min-height:96px; max-height:58vh; overflow:auto; border:1px solid rgba(99,102,241,.2); border-radius:12px; background:rgba(0,0,0,.2); color:#cbd5e1; padding:11px; font-size:13px; line-height:1.55; white-space:pre-wrap; word-break:break-word; -webkit-overflow-scrolling:touch; }
            .mh-gm-stream-popup-body.is-empty { color:#94a3b8; font-weight:700; display:flex; align-items:center; justify-content:center; text-align:center; }

            /* Thinking indicator badge [...] */
            .mh-gm-thinking-badge { display:inline-flex; align-items:center; gap:4px; margin-top:6px; padding:3px 10px; border-radius:8px; background:rgba(99,102,241,.14); border:1px solid rgba(99,102,241,.28); color:#a5b4fc; font-size:12px; font-weight:700; cursor:pointer; user-select:none; transition:background .15s; }
            .mh-gm-thinking-badge:hover { background:rgba(99,102,241,.24); }
            .mh-gm-thinking-badge .mh-gm-thinking-icon { font-size:14px; animation:mhGmThinkPulse 1.6s ease-in-out infinite; }
            @keyframes mhGmThinkPulse { 0%,100%{opacity:.5} 50%{opacity:1} }
            .mh-gm-thinking-badge.is-done { animation:none; opacity:.7; cursor:pointer; }
            .mh-gm-thinking-badge.is-done .mh-gm-thinking-icon { animation:none; }

            /* Thinking popup overlay */
            .mh-gm-thinking-popup-overlay { position:absolute; inset:0; z-index:50; background:rgba(10,24,48,.45); display:flex; align-items:flex-end; justify-content:center; padding:14px 12px max(14px,env(safe-area-inset-bottom,0px)); }
            .mh-gm-thinking-popup { width:100%; max-height:80%; border-radius:18px 18px 14px 14px; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.35); box-shadow:0 16px 40px rgba(0,0,0,.45); padding:14px; display:flex; flex-direction:column; gap:10px; }
            .mh-gm-thinking-popup-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
            .mh-gm-thinking-popup-head strong { color:#e2e8f0; font-size:15px; display:flex; align-items:center; gap:6px; }
            .mh-gm-thinking-popup-close { border:0; background:rgba(255,255,255,.08); color:#94a3b8; border-radius:8px; width:30px; height:30px; display:grid; place-items:center; cursor:pointer; font-size:16px; }
            .mh-gm-thinking-popup-close:hover { background:rgba(255,255,255,.14); color:#e2e8f0; }
            .mh-gm-thinking-popup-body { min-height:120px; max-height:55vh; overflow:auto; border:1px solid rgba(99,102,241,.2); border-radius:12px; background:rgba(0,0,0,.2); color:#cbd5e1; padding:12px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; word-break:break-word; -webkit-overflow-scrolling:touch; }
            .mh-gm-thinking-popup-body.is-empty { color:#64748b; font-family:inherit; font-weight:700; }
            .mh-gm-thinking-popup-hint { color:#64748b; font-size:11px; text-align:center; }

            /* Tool-call chips shown inside AI chat history. */
            .mh-gm-toolcalls { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
            .mh-gm-toolchip { display:flex; align-items:center; gap:6px; max-width:100%; border:1px solid rgba(148,163,184,.22); background:rgba(15,39,71,.72); color:#cbd5e1; border-radius:9px; padding:5px 9px; font-size:12px; font-weight:800; cursor:pointer; text-align:left; }
            .mh-gm-toolchip:hover { border-color:#6366f1; color:#a5b4fc; background:rgba(99,102,241,.13); }
            .mh-gm-toolchip-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .mh-gm-toolchip-status { margin-left:auto; flex:0 0 auto; color:#94a3b8; font-size:11px; }
            .mh-gm-toolchip.status-done .mh-gm-toolchip-status { color:#86efac; }
            .mh-gm-toolchip.status-error .mh-gm-toolchip-status { color:#fca5a5; }
            .mh-gm-tool-popup-overlay { position:absolute; inset:0; z-index:58; background:rgba(10,24,48,.45); display:flex; align-items:flex-end; justify-content:center; padding:14px 12px max(14px,env(safe-area-inset-bottom,0px)); }
            .mh-gm-tool-popup { width:100%; max-height:82%; border-radius:18px 18px 14px 14px; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.35); box-shadow:0 16px 40px rgba(0,0,0,.45); padding:14px; display:flex; flex-direction:column; gap:10px; }
            .mh-gm-tool-popup-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#e2e8f0; font-size:15px; font-weight:900; }
            .mh-gm-tool-popup-close { border:0; background:rgba(255,255,255,.08); color:#94a3b8; border-radius:8px; width:30px; height:30px; display:grid; place-items:center; cursor:pointer; font-size:16px; }
            .mh-gm-tool-popup-body { overflow:auto; display:flex; flex-direction:column; gap:10px; -webkit-overflow-scrolling:touch; }
            .mh-gm-tool-popup-section { border:1px solid rgba(99,102,241,.2); border-radius:12px; background:rgba(0,0,0,.2); overflow:hidden; }
            .mh-gm-tool-popup-section strong { display:block; padding:8px 10px; color:#a5b4fc; font-size:12px; border-bottom:1px solid rgba(99,102,241,.16); }
            .mh-gm-tool-popup-section pre { margin:0; padding:10px; color:#cbd5e1; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-word; }

            .mh-gm-input-area { padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px)); border-top:1px solid rgba(148,163,184,.16); flex-shrink:0; }
            .mh-gm-input-box { display:flex; align-items:flex-end; gap:8px; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.24); border-radius:14px; padding:8px 10px 8px 14px; }
            .mh-gm-textarea { flex:1; background:none; border:0; color:#e2e8f0; font-size:16px; resize:none; outline:none; line-height:1.5; min-height:48px; max-height:200px; font-family:inherit; }
            .mh-gm-textarea::placeholder { color:#64748b; }
            .mh-gm-attach-btn { flex:0 0 auto; width:40px; height:40px; border:0; border-radius:10px; background:rgba(255,255,255,.08); color:#94a3b8; display:grid; place-items:center; cursor:pointer; transition:background .15s, color .15s; }
            .mh-gm-attach-btn:hover { background:rgba(99,102,241,.16); color:#a5b4fc; }
            .mh-gm-attach-btn svg { width:20px; height:20px; }
            .mh-gm-send { flex:0 0 auto; width:40px; height:40px; border:0; border-radius:10px; background:#6366f1; color:#fff; display:grid; place-items:center; cursor:pointer; }
            .mh-gm-send:disabled { opacity:.4; cursor:not-allowed; }
            .mh-gm-send svg { width:20px; height:20px; }
            .mh-gm-stop { flex:0 0 auto; width:40px; height:40px; border:0; border-radius:10px; background:#ef4444; color:#fff; display:none; place-items:center; cursor:pointer; }
            .mh-gm-stop.show { display:grid; }
            .mh-gm-stop svg { width:18px; height:18px; }
            
            /* Image attachment preview area */
            .mh-gm-attach-preview { display:flex; flex-wrap:wrap; gap:8px; padding:8px 14px 0; }
            .mh-gm-attach-preview:empty { display:none; padding:0; }
            .mh-gm-attach-thumb { position:relative; width:64px; height:64px; border-radius:8px; overflow:hidden; border:1px solid rgba(148,163,184,.24); background:rgba(0,0,0,.2); }
            .mh-gm-attach-thumb img { width:100%; height:100%; object-fit:cover; }
            .mh-gm-attach-thumb-del { position:absolute; top:2px; right:2px; width:20px; height:20px; border-radius:50%; background:rgba(0,0,0,.7); color:#fff; border:0; display:grid; place-items:center; cursor:pointer; font-size:14px; line-height:1; padding:0; }
            .mh-gm-attach-thumb-del:hover { background:rgba(239,68,68,.9); }
            
            /* Images in chat bubbles */
            .mh-gm-msg-images { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
            .mh-gm-msg-images img { max-width:120px; max-height:120px; border-radius:8px; cursor:pointer; transition:transform .15s; }
            .mh-gm-msg-images img:hover { transform:scale(1.05); }

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
                <button type="button" class="mh-gm-iconbtn" id="mhGmIcon" title="${escapeHtml(t('mgGameIconLabel'))}" aria-label="${escapeHtml(t('mgGameIconLabel'))}">${escapeHtml(gameIcon)}</button>
                <input class="mh-gm-name" id="mhGmName" type="text" maxlength="64" placeholder="${escapeHtml(t('mgGameNamePlaceholder'))}" value="${escapeHtml(gameName)}">
                <button type="button" class="mh-gm-save" id="mhGmSave">${escapeHtml(t('mgGameSave'))}</button>
            </div>
            <div class="mh-gm-tabbar">
                <button type="button" class="active" data-mh-gm-pane="chat">💬 ${escapeHtml(t('mgGameTabChat'))}</button>
                <button type="button" data-mh-gm-pane="preview">▶ ${escapeHtml(t('mgGamePreview'))}</button>
            </div>
            <div class="mh-gm-stage">
                <div class="mh-gm-pane chat active" data-mh-gm-pane-body="chat">
                    <div class="mh-gm-chat-msgs" id="mhGmMsgs"></div>
                    <div class="mh-gm-toolbar">
                        <div class="mh-gm-modelwrap">
                            <button type="button" class="mh-gm-model-btn" id="mhGmModelBtn" title="${escapeHtml(t('mgGameModelLabel'))}" aria-label="${escapeHtml(t('mgGameModelLabel'))}"></button>
                            <div class="mh-gm-model-list" id="mhGmModelList"></div>
                        </div>
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
                    <div class="mh-gm-input-area">
                        <div class="mh-gm-attach-preview" id="mhGmAttachPreview"></div>
                        <div class="mh-gm-input-box">
                            <textarea class="mh-gm-textarea" id="mhGmInput" rows="2" placeholder="${escapeHtml(t('mgGameChatPlaceholder'))}"></textarea>
                            <button type="button" class="mh-gm-attach-btn" id="mhGmAttach" title="添加图片" aria-label="添加图片">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            </button>
                            <button type="button" class="mh-gm-send" id="mhGmSend" aria-label="${escapeHtml(t('mgGameSend'))}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                            </button>
                            <button type="button" class="mh-gm-stop" id="mhGmStop" title="停止生成" aria-label="停止生成">
                                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
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
    const stopBtn = $('mhGmStop');
    const attachBtn = $('mhGmAttach');
    const attachPreview = $('mhGmAttachPreview');
    const previewFrame = $('mhGmPreviewFrame');
    const previewEmpty = $('mhGmPreviewEmpty');
    const nameEl = $('mhGmName');
    const iconBtn = $('mhGmIcon');
    const historyBtn = $('mhGmHistory');
    const historyPop = $('mhGmHistoryPop');
    const newBtn = $('mhGmNew');
    const configBtn = $('mhGmConfig');
    const modelBtn = $('mhGmModelBtn');
    const modelList = $('mhGmModelList');
    let modelOpen = false;
    
    // Image attachment state
    const attachedImages = []; // Array of { id, dataUrl, file }
    let imageIdCounter = 0;
    let streamPopupState = null; // { msgIdx, pinned }
    let lastPointerClientX = 0;
    let lastPointerClientY = 0;
    
    // Hidden file input for image selection
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    panel.appendChild(fileInput);
    
    // ---------- Image attachment helpers ----------
    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }
    
    async function addImageFromFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            showToast('请选择图片文件', 'error', 1600);
            return;
        }
        // Limit file size to 5MB
        if (file.size > 5 * 1024 * 1024) {
            showToast('图片大小不能超过 5MB', 'error', 1600);
            return;
        }
        try {
            const dataUrl = await fileToDataUrl(file);
            const id = `img-${++imageIdCounter}`;
            attachedImages.push({ id, dataUrl, file });
            renderAttachPreview();
        } catch (e) {
            showToast('图片加载失败', 'error', 1600);
        }
    }
    
    function removeImage(id) {
        const idx = attachedImages.findIndex(img => img.id === id);
        if (idx !== -1) {
            attachedImages.splice(idx, 1);
            renderAttachPreview();
        }
    }
    
    function clearAttachedImages() {
        attachedImages.length = 0;
        renderAttachPreview();
    }
    
    function renderAttachPreview() {
        if (!attachPreview) return;
        if (!attachedImages.length) {
            attachPreview.innerHTML = '';
            return;
        }
        attachPreview.innerHTML = attachedImages.map(img => `
            <div class="mh-gm-attach-thumb" data-img-id="${escapeHtml(img.id)}">
                <img src="${escapeHtml(img.dataUrl)}" alt="附件">
                <button type="button" class="mh-gm-attach-thumb-del" data-del-img-id="${escapeHtml(img.id)}" aria-label="删除">×</button>
            </div>
        `).join('');
    }

    // ---------- 模型选择 ----------
    function updateModelBtnLabel() {
        if (!modelBtn) return;
        const models = listChatModels();
        const match = models.find((m) => modelValue(m) === selectedModel);
        modelBtn.textContent = match ? modelLabel(match) : t('mgGameModelDefault');
    }
    function populateModelSelect() {
        if (!modelList) return;
        const models = listChatModels();
        const items = [`<button type="button" class="mh-gm-model-item${!selectedModel ? ' active' : ''}" data-mh-gm-model-val="">${escapeHtml(t('mgGameModelDefault'))}</button>`];
        for (const m of models) {
            const value = modelValue(m);
            const active = value === selectedModel ? ' active' : '';
            items.push(`<button type="button" class="mh-gm-model-item${active}" data-mh-gm-model-val="${escapeHtml(value)}">${escapeHtml(modelLabel(m))}</button>`);
        }
        modelList.innerHTML = items.join('');
        updateModelBtnLabel();
    }
    function closeModelList() { modelOpen = false; if (modelList) modelList.classList.remove('open'); }
    function toggleModelList() {
        modelOpen = !modelOpen;
        if (modelList) modelList.classList.toggle('open', modelOpen);
    }

    // ---------- 历史会话（仅本地 IndexedDB） ----------
    async function refreshHistoryRows() {
        historyRows = await listLocalSessions(savedPath);
    }

    function renderHistoryPop() {
        if (!historyPop) return;
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
    async function loadHistoryRow(row) {
        if (!row) return;
        abortController?.abort();
        chatId = row.chatId || `game-maker-${Date.now()}`;
        messages.length = 0;
        currentHtml = '';
        // 从本地 IndexedDB 读取。
        const localData = await getLocalSession(chatId);
        if (localData && Array.isArray(localData.messages)) {
            for (const m of localData.messages) {
                if (!m || m.role === 'system') continue;
                if (m.role === 'user') {
                    messages.push({ role: 'user', text: m.text || '' });
                } else if (m.role === 'ai' || m.role === 'assistant') {
                    messages.push({ role: 'ai', text: m.text || '', reasoning: m.reasoning || '', toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls : [] });
                }
            }
            currentHtml = localData.html || '';
        }
        const title = localData?.title || row.title;
        if (title && !gameName.trim()) {
            gameName = String(title).slice(0, 24);
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
        // Keep the current preview HTML as the starting file for iterative edits,
        // but start a fresh agent/tool history like modern vibe-coding sessions.
        renderMessages();
        setPreview(currentHtml);
        closeHistoryPop();
        switchPane('chat');
        showToast(t('mgGameNewSessionDone'), 'info', 1200);
    }

    function scrollMsgsToEnd() {
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function getLiveBubbleUnderPointer() {
        if (!msgsEl || !lastPointerClientX || !lastPointerClientY) return null;
        const el = document.elementFromPoint(lastPointerClientX, lastPointerClientY);
        const bubble = el?.closest?.('[data-mh-gm-stream-msg]');
        return bubble && msgsEl.contains(bubble) ? bubble : null;
    }

    function refreshHoverStreamPopup() {
        if (streamPopupState?.pinned) return;
        const bubble = getLiveBubbleUnderPointer();
        if (!bubble) return;
        const msgIdx = parseInt(bubble.dataset.mhGmStreamMsg, 10);
        showStreamPopup(msgIdx, false);
    }

    function updateGenerationControls() {
        if (sendBtn) sendBtn.style.display = generating ? 'none' : 'grid';
        if (stopBtn) {
            stopBtn.classList.toggle('show', generating);
            if (generating) stopBtn.disabled = false;
        }
        if (inputEl) inputEl.disabled = generating;
        if (attachBtn) attachBtn.disabled = generating;
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
        msgsEl.innerHTML = messages.map((m, idx) => {
            const cls = m.role === 'user' ? 'user' : 'ai';
            let body = '';
            
            // Display attached images for user messages
            if (m.role === 'user' && m.images && m.images.length > 0) {
                body += '<div class="mh-gm-msg-images">';
                body += m.images.map(img => `<img src="${escapeHtml(img.dataUrl)}" alt="附件图片">`).join('');
                body += '</div>';
            }
            
            if (m.pending) {
                // Initial loading state with dots
                body += '<span class="mh-gm-dots" aria-label="…"><span></span><span></span><span></span></span>';
            } else if (m.streaming) {
                // Streaming text with cursor
                body += escapeHtml(m.text || '');
                body += '<span class="mh-gm-stream-cursor"></span>';
                // Add thinking badge if reasoning is available
                if (m.thinking && m.reasoning) {
                    body += `<div class="mh-gm-thinking-badge" data-msg-idx="${idx}" title="点击查看思考过程">
                        <span class="mh-gm-thinking-icon">💭</span>
                        <span>思考中...</span>
                    </div>`;
                }
            } else {
                // Completed message
                body += escapeHtml(m.text || '');
                // Add thinking badge if reasoning was captured (even after completion)
                if (m.reasoning) {
                    const badgeClass = m.thinking ? 'mh-gm-thinking-badge' : 'mh-gm-thinking-badge is-done';
                    const badgeText = m.thinking ? '思考中...' : '查看思考过程';
                    body += `<div class="${badgeClass}" data-msg-idx="${idx}" title="点击查看思考过程">
                        <span class="mh-gm-thinking-icon">💭</span>
                        <span>${badgeText}</span>
                    </div>`;
                }
            }

            if (m.role === 'ai' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
                body += '<div class="mh-gm-toolcalls">';
                body += m.toolCalls.map((tool, toolIdx) => {
                    const name = tool?.name || 'tool';
                    const status = tool?.status || 'running';
                    const icon = status === 'error' ? '⚠️' : (status === 'done' ? '✅' : '🔧');
                    const label = status === 'error' ? 'failed' : (status === 'done' ? 'done' : 'running');
                    return `<button type="button" class="mh-gm-toolchip status-${escapeHtml(status)}" data-mh-gm-tool-msg="${idx}" data-mh-gm-tool-idx="${toolIdx}" title="${escapeHtml(name)}">
                        <span>${icon}</span><span class="mh-gm-toolchip-name">${escapeHtml(name)}</span><span class="mh-gm-toolchip-status">${escapeHtml(label)}</span>
                    </button>`;
                }).join('');
                body += '</div>';
            }

            const liveClass = m.role === 'ai' && (m.pending || m.streaming) ? ' is-live' : '';
            const liveAttr = m.role === 'ai' && (m.pending || m.streaming) ? ` data-mh-gm-stream-msg="${idx}"` : '';
            return `<div class="mh-gm-msg ${cls}"><div class="mh-gm-bubble ${cls}${liveClass}"${liveAttr}>${body}</div></div>`;
        }).join('');
        refreshHoverStreamPopup();
        updateStreamPopup();
        scrollMsgsToEnd();
    }

    function streamPopupTextForMessage(msg) {
        if (!msg) return '';
        const text = String(msg.text || '').trim();
        if (text) return text;
        if (msg.reasoning) return String(msg.reasoning || '').trim();
        return msg.pending || msg.streaming ? 'AI 正在生成回复，请稍候…' : '';
    }

    function ensureStreamPopup() {
        let pop = $('mhGmStreamPopup');
        if (pop) return pop;
        pop = document.createElement('div');
        pop.id = 'mhGmStreamPopup';
        pop.className = 'mh-gm-stream-popup';
        pop.innerHTML = `
            <div class="mh-gm-stream-popup-head">
                <span>正在生成的内容</span>
                <button type="button" class="mh-gm-stream-popup-close" aria-label="关闭">×</button>
            </div>
            <div class="mh-gm-stream-popup-body"></div>`;
        panel.appendChild(pop);
        pop.querySelector('.mh-gm-stream-popup-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            hideStreamPopup(true);
        });
        pop.querySelector('.mh-gm-stream-popup-body')?.addEventListener('scroll', (e) => {
            const body = e.currentTarget;
            const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
            if (nearBottom) delete body.dataset.userScrolled;
            else body.dataset.userScrolled = '1';
        });
        return pop;
    }

    function updateStreamPopup() {
        if (!streamPopupState) return;
        const msg = messages[streamPopupState.msgIdx];
        if (!msg || msg.role !== 'ai' || (!msg.pending && !msg.streaming)) {
            hideStreamPopup(true);
            return;
        }
        const pop = ensureStreamPopup();
        const body = pop.querySelector('.mh-gm-stream-popup-body');
        const text = streamPopupTextForMessage(msg);
        if (body) {
            const wasNearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
            body.classList.toggle('is-empty', !String(msg.text || '').trim());
            body.textContent = text;
            // While streaming, keep following the tail only if the user has not scrolled up
            // to inspect earlier generated code.
            if (wasNearBottom || !body.dataset.userScrolled) body.scrollTop = body.scrollHeight;
        }
    }

    function showStreamPopup(msgIdx, pinned = false) {
        const msg = messages[msgIdx];
        if (!msg || msg.role !== 'ai' || (!msg.pending && !msg.streaming)) return;
        streamPopupState = { msgIdx, pinned: !!pinned };
        updateStreamPopup();
    }

    function hideStreamPopup(force = false) {
        if (!force && streamPopupState?.pinned) return;
        streamPopupState = null;
        $('mhGmStreamPopup')?.remove();
    }

    function showToolPopup(tool) {
        if (!tool) return;
        document.getElementById('mhGmToolPopup')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'mhGmToolPopup';
        overlay.className = 'mh-gm-tool-popup-overlay';
        const statusText = tool.status === 'error' ? 'failed' : (tool.status === 'done' ? 'done' : 'running');
        overlay.innerHTML = `
            <div class="mh-gm-tool-popup" role="dialog" aria-modal="true">
                <div class="mh-gm-tool-popup-head">
                    <span>🔧 ${escapeHtml(tool.name || 'tool')} · ${escapeHtml(statusText)}</span>
                    <button type="button" class="mh-gm-tool-popup-close" aria-label="关闭">×</button>
                </div>
                <div class="mh-gm-tool-popup-body">
                    <div class="mh-gm-tool-popup-section"><strong>Arguments</strong><pre>${escapeHtml(stringifyToolDetail(tool.args || ''))}</pre></div>
                    <div class="mh-gm-tool-popup-section"><strong>Result</strong><pre>${escapeHtml(stringifyToolDetail(tool.error || tool.detailResult || tool.result || ''))}</pre></div>
                </div>
            </div>`;
        panel.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.mh-gm-tool-popup-close')) overlay.remove();
        });
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
    async function generateGame(promptText, aiMsg, images = []) {
        const sdk = state.sdk || window.keepwork;
        const agentsMd = await loadAgentsMd();
        const lang = getLang();
        const langLine = lang === 'en'
            ? 'The game UI text should match the user request language.'
            : '游戏界面文字默认使用简体中文。';
        const baseRules = [
            'You are an expert HTML5 game developer for the MagicHaqi pet platform.',
            `You are editing a single workspace file named ${GAME_MAKER_FILE_PATH}.`,
            'Use file tools for code changes: read_file to inspect the current file, then replace_string_in_file or multi_replace_string_in_file to apply small chunk edits. Use create_file only when the file is missing or when creating the first full version.',
            'Prefer incremental chunk edits over returning a full rewritten document when existing code is present.',
            'After editing, read_file the changed area or full file when needed to verify the result.',
            'At the end, briefly summarize what changed. Do not output a full HTML code block unless tools are unavailable.',
            'Inline all CSS and JavaScript. Use only CDN resources (e.g. Tailwind / Three.js) as described in the guide; no local files.',
            'Mobile-first and touch friendly, no scrollbars; the game must fit the iframe viewport.',
            'When the game ends you may call parent.postMessage({ type: "gameFinished", data: { score } }, "*").',
            langLine,
        ].join('\n');
        const systemPrompt = agentsMd
            ? `${baseRules}\n\n--- Platform game development guide (follow it) ---\n${agentsMd}`
            : baseRules;

        const hasExistingHtml = !!currentHtml.trim();
        const userPrompt = hasExistingHtml
            ? `We are beginning a new vibe-coding edit round with existing code. The full current HTML has been written to ${GAME_MAKER_FILE_PATH}. First read it with read_file, then use tool calls to edit it in chunks according to this request:\n\n${promptText}`
            : `Create a complete self-contained HTML5 mini game in ${GAME_MAKER_FILE_PATH}. Use create_file with the full HTML document, then summarize. User request:\n\n${promptText}`;

        abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const signal = abortController?.signal;
        let text = '';
        let reasoningText = '';
        
        const onChunk = (delta) => {
            throwIfAborted(signal);
            if (typeof delta === 'string' && delta) {
                text += delta;
                // Update streaming text in real-time
                if (aiMsg) {
                    aiMsg.text = text;
                    aiMsg.streaming = true;
                    renderMessages();
                }
            }
        };
        const onMessage = (value, payload) => {
            throwIfAborted(signal);
            const next = textFromStreamPayload(value, payload);
            if (!next) return;
            text = next.startsWith(text) ? next : (text + next);
            // Update streaming text in real-time
            if (aiMsg) {
                aiMsg.text = text;
                aiMsg.streaming = true;
                renderMessages();
            }
        };
        const onReasoning = (fullReasoning, delta, rawChunk) => {
            throwIfAborted(signal);
            if (typeof fullReasoning === 'string' && fullReasoning) {
                reasoningText = fullReasoning;
                // Update thinking indicator
                if (aiMsg) {
                    aiMsg.reasoning = reasoningText;
                    aiMsg.thinking = true;
                    renderMessages();
                }
            }
        };

        // 始终跳过远程历史持久化（仅使用本地 IndexedDB）。
        const model = selectedModel || undefined;

        // Build message content with images if present
        let userContent;
        if (images && images.length > 0) {
            userContent = [
                { type: 'text', text: userPrompt },
                ...images.map(img => ({ type: 'image_url', image_url: { url: img.dataUrl } }))
            ];
        } else {
            userContent = userPrompt;
        }

        const workspace = getSessionWorkspace();
        const seedFile = async () => {
            if (!sdk?.copilotTools?.execute) return;
            const initialHtml = currentHtml && currentHtml.trim()
                ? currentHtml
                : '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MagicHaqi Game</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0f172a;color:#fff;font-family:sans-serif}</style></head><body><main id="app"></main><script>document.getElementById("app").textContent="MagicHaqi Game";<\/script></body></html>';
            await sdk.copilotTools.execute('create_file', { filePath: GAME_MAKER_FILE_PATH, content: initialHtml }, { workspace });
        };
        const readWorkspaceHtml = async () => {
            if (!sdk?.copilotTools?.execute) return '';
            const content = await sdk.copilotTools.execute('read_file', { filePath: GAME_MAKER_FILE_PATH, startLine: 1, endLine: 20000 }, { workspace });
            return typeof content === 'string' && !content.startsWith('Failed:') ? content : '';
        };
        const recordToolCall = (toolCall) => {
            const args = toolCall?.function?.arguments || '';
            const event = {
                id: toolCall?.id || `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: toolCall?.function?.name || 'tool',
                status: 'running',
                args: stringifyToolDetail(safeJsonParse(args, args)),
                result: '',
                ts: Date.now(),
            };
            if (aiMsg) {
                if (!Array.isArray(aiMsg.toolCalls)) aiMsg.toolCalls = [];
                aiMsg.toolCalls.push(event);
                renderMessages();
            }
        };
        const recordToolResult = ({ name, toolCallId, result }) => {
            if (!aiMsg) return;
            const calls = Array.isArray(aiMsg.toolCalls) ? aiMsg.toolCalls : (aiMsg.toolCalls = []);
            const event = calls.find(c => c.id === toolCallId) || [...calls].reverse().find(c => c.name === name && c.status === 'running') || null;
            const target = event || { id: toolCallId || `tool-${Date.now()}`, name: name || 'tool', args: '', ts: Date.now() };
            target.status = stringifyToolDetail(result).startsWith('Failed:') ? 'error' : 'done';
            target.result = summarizeToolResult(result);
            target.detailResult = stringifyToolDetail(result);
            if (!event) calls.push(target);
            renderMessages();
        };

        await seedFile();

        if (sdk?.aiChat?.createSession) {
            const session = sdk.aiChat.createSession({
                modId: GAME_MAKER_MOD_ID,
                chatId,
                skipHistory: true,
                systemPrompt,
                model,
                workspace,
                enabledCategories: ['read', 'edit'],
            });
            try {
                const p = session.send(userContent, { stream: true, abortController, onMessage, onChunk, onReasoning, onToolCall: recordToolCall, onToolResult: recordToolResult, systemPrompt, model, enableTools: ['read', 'edit'], enabledCategories: ['read', 'edit'], maxIterations: 8 });
                p.catch(() => {});
                const result = await waitWithAbort(p, signal);
                if (!text) text = (result?.text || result?.result || result || '').toString();
            } finally {
                try { session.destroy?.(); } catch (_) {}
            }
        } else if (sdk?.aiChat?.chat) {
            const p = sdk.aiChat.chat({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], modId: GAME_MAKER_MOD_ID, model, stream: true, abortController, onMessage, onChunk, onReasoning, onToolCall: recordToolCall, onToolResult: recordToolResult, enableTools: ['read', 'edit'], enabledCategories: ['read', 'edit'], workspace, maxIterations: 8 });
            p.catch(() => {});
            const result = await waitWithAbort(p, signal);
            if (!text) text = (result?.text || result?.result || result || '').toString();
        } else if (sdk?.aiGenerators?.chat) {
            const p = sdk.aiGenerators.chat({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], model, stream: true, abortController, onMessage, onChunk, onReasoning });
            p.catch(() => {});
            const result = await waitWithAbort(p, signal);
            if (!text) text = (result?.text || result?.choices?.[0]?.message?.content || '').toString();
        } else {
            throw new Error(t('mgGameAiUnavailable'));
        }
        throwIfAborted(signal);
        const toolHtml = await readWorkspaceHtml();
        return { text, reasoning: reasoningText, html: extractHtml(toolHtml) || toolHtml };
    }

    async function handleSend(promptText) {
        const text = String(promptText != null ? promptText : (inputEl?.value || '')).trim();
        if (!text && !attachedImages.length) return;
        if (generating) return;
        
        // Capture attached images before clearing
        const imagesToSend = attachedImages.map(img => ({ id: img.id, dataUrl: img.dataUrl }));
        
        if (inputEl) { inputEl.value = ''; autoResize(); }
        clearAttachedImages();
        
        generating = true;
        updateGenerationControls();
        
        // Add user message with images
        messages.push({ role: 'user', text, images: imagesToSend });
        const aiMsg = { role: 'ai', text: '', pending: true, streaming: false, thinking: false, reasoning: '' };
        messages.push(aiMsg);
        renderMessages();

        try {
            const result = await generateGame(text, aiMsg, imagesToSend);
            const reply = result.text;
            const html = result.html || extractHtml(reply);
            aiMsg.pending = false;
            aiMsg.streaming = false;
            aiMsg.thinking = false;
            if (html) {
                currentHtml = html;
                aiMsg.text = reply?.trim() ? reply.trim().slice(0, 600) : t('mgGameAiDone');
                setPreview(currentHtml);
                if (!gameName.trim()) {
                    gameName = extractHtmlTitle(currentHtml);
                    if (nameEl && gameName) nameEl.value = gameName;
                }
                // 桌面端预览常驻；移动端自动切到预览看效果。
                if (window.matchMedia?.('(max-width: 859px)')?.matches) switchPane('preview');
            } else {
                aiMsg.text = reply?.trim() ? reply.trim().slice(0, 600) : t('mgGameAiNoHtml');
            }
            // 保存到本地 IndexedDB（每次交互后持久化，关联当前游戏路径）。
            saveLocalSession(chatId, gameName || text.slice(0, 24), messages, currentHtml, savedPath);
        } catch (e) {
            aiMsg.pending = false;
            aiMsg.streaming = false;
            aiMsg.thinking = false;
            if (isAbortError(e)) {
                aiMsg.text = t('mgGameAiStopped');
            } else {
                aiMsg.text = t('mgGameAiError', { error: (e?.message || e) });
                showToast(t('mgGameAiError', { error: (e?.message || e) }), 'error', 2600);
            }
        } finally {
            generating = false;
            abortController = null;
            hideStreamPopup(true);
            updateGenerationControls();
            renderMessages();
        }
    }

    function handleStopGeneration() {
        if (!generating) return;
        try { abortController?.abort(); } catch (_) {}
        if (stopBtn) stopBtn.disabled = true;
    }

    async function generateEmojiSuggestion() {
        const sdk = state.sdk || window.keepwork;
        const title = (nameEl?.value || gameName || extractHtmlTitle(currentHtml) || '').trim();
        const prompt = `Return exactly one emoji, no words, for this HTML5 mini game: ${title || 'a fun game'}\nUser request/context: ${messages.filter(m => m.role === 'user').slice(-2).map(m => m.text || '').join(' / ')}`;
        try {
            let result = '';
            if (sdk?.aiChat?.chat) {
                const r = await sdk.aiChat.chat({ messages: [{ role: 'user', content: prompt }], modId: GAME_MAKER_MOD_ID, model: selectedModel || undefined });
                result = (r?.text || r?.result || r || '').toString();
            } else if (sdk?.aiGenerators?.chat) {
                const r = await sdk.aiGenerators.chat({ messages: [{ role: 'user', content: prompt }], model: selectedModel || undefined });
                result = (r?.text || r?.choices?.[0]?.message?.content || r || '').toString();
            }
            return firstEmoji(result) || '';
        } catch (_) {
            return '';
        }
    }

    function showEmojiDialog() {
        $('mhGmEmojiDialog')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'mhGmEmojiDialog';
        overlay.className = 'mh-gm-emoji-dialog-overlay';
        overlay.innerHTML = `
            <div class="mh-gm-emoji-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('mgGameIconLabel'))}">
                <div class="mh-gm-emoji-dialog-head">
                    <span>${escapeHtml(t('mgGameIconLabel'))}</span>
                    <button type="button" class="mh-gm-emoji-dialog-close" aria-label="关闭">×</button>
                </div>
                <div class="mh-gm-emoji-input-row">
                    <input class="mh-gm-emoji-input" id="mhGmEmojiInput" value="${escapeHtml(gameIcon || '')}" maxlength="8" inputmode="text" autocomplete="off">
                    <button type="button" class="mh-gm-emoji-auto" id="mhGmEmojiAuto">Auto</button>
                </div>
                <div class="mh-gm-emoji-grid">${EMOJI_OPTIONS.map(e => `<button type="button" class="mh-gm-emoji-btn${e === gameIcon ? ' active' : ''}" data-mh-gm-emoji="${e}" title="${e}">${e}</button>`).join('')}</div>
                <div class="mh-gm-emoji-actions">
                    <button type="button" class="mh-gm-emoji-cancel">取消</button>
                    <button type="button" class="mh-gm-emoji-ok">确定</button>
                </div>
            </div>`;
        panel.appendChild(overlay);
        const input = $('mhGmEmojiInput');
        const close = () => overlay.remove();
        const apply = () => {
            const next = firstEmoji(input?.value) || (input?.value || '').trim().slice(0, 4) || '🎮';
            gameIcon = next;
            iconBtn.textContent = gameIcon;
            close();
        };
        input?.focus();
        input?.select?.();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.mh-gm-emoji-dialog-close')?.addEventListener('click', close);
        overlay.querySelector('.mh-gm-emoji-cancel')?.addEventListener('click', close);
        overlay.querySelector('.mh-gm-emoji-ok')?.addEventListener('click', apply);
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        overlay.querySelector('.mh-gm-emoji-grid')?.addEventListener('click', (e) => {
            const btn = e.target.closest?.('[data-mh-gm-emoji]');
            if (!btn) return;
            input.value = btn.dataset.mhGmEmoji || '🎮';
            overlay.querySelectorAll('.mh-gm-emoji-btn').forEach(el => el.classList.toggle('active', el === btn));
        });
        overlay.querySelector('#mhGmEmojiAuto')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            const oldText = btn.textContent;
            btn.textContent = '...';
            const emoji = await generateEmojiSuggestion();
            if (emoji && input) input.value = emoji;
            else showToast(t('mgGameAiUnavailable'), 'info', 1400);
            btn.textContent = oldText;
            btn.disabled = false;
        });
    }

    async function handleSave() {
        if (!currentHtml.trim()) { showToast(t('mgGameNeedHtml'), 'info', 1800); return; }
        const name = (nameEl?.value || '').trim() || extractHtmlTitle(currentHtml);
        if (!name) { showToast(t('mgGameNeedName'), 'info', 1600); nameEl?.focus(); return; }
        gameName = name;
        if (nameEl && !nameEl.value.trim()) nameEl.value = name;
        const saveBtn = $('mhGmSave');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const result = await savePetGame(currentHtml, {
                path: savedPath,
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
    
    // Image attachment: button click
    attachBtn.onclick = () => fileInput.click();
    
    // Image attachment: file selection
    fileInput.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            await addImageFromFile(file);
        }
        fileInput.value = ''; // Reset for re-selection
    };
    
    // Image attachment: paste from clipboard
    inputEl?.addEventListener('paste', async (e) => {
        const items = Array.from(e.clipboardData?.items || []);
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) await addImageFromFile(file);
            }
        }
    });
    
    // Image attachment: delete button click
    attachPreview?.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-del-img-id]');
        if (delBtn) {
            removeImage(delBtn.dataset.delImgId);
        }
    });
    iconBtn.onclick = (e) => {
        e.stopPropagation();
        showEmojiDialog();
    };
    nameEl?.addEventListener('input', () => { gameName = nameEl.value; });
    sendBtn.onclick = () => handleSend();
    stopBtn.onclick = handleStopGeneration;
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

        // Tap/click a live AI bubble to pin the streaming text popup.
        const liveBubble = e.target.closest?.('[data-mh-gm-stream-msg]');
        if (liveBubble) {
            const msgIdx = parseInt(liveBubble.dataset.mhGmStreamMsg, 10);
            showStreamPopup(msgIdx, true);
        }

        const toolChip = e.target.closest?.('[data-mh-gm-tool-msg]');
        if (toolChip) {
            const msgIdx = parseInt(toolChip.dataset.mhGmToolMsg, 10);
            const toolIdx = parseInt(toolChip.dataset.mhGmToolIdx, 10);
            showToolPopup(messages[msgIdx]?.toolCalls?.[toolIdx]);
        }
        
        // Handle thinking badge click
        const thinkingBadge = e.target.closest?.('.mh-gm-thinking-badge');
        if (thinkingBadge) {
            const msgIdx = parseInt(thinkingBadge.dataset.msgIdx, 10);
            const msg = messages[msgIdx];
            if (msg && msg.reasoning) {
                showThinkingPopup(msg.reasoning);
            }
        }
    });
    msgsEl?.addEventListener('pointerover', (e) => {
        lastPointerClientX = e.clientX || 0;
        lastPointerClientY = e.clientY || 0;
        const toolChip = e.target.closest?.('[data-mh-gm-tool-msg]');
        if (toolChip && msgsEl.contains(toolChip)) {
            const msgIdx = parseInt(toolChip.dataset.mhGmToolMsg, 10);
            const toolIdx = parseInt(toolChip.dataset.mhGmToolIdx, 10);
            showToolPopup(messages[msgIdx]?.toolCalls?.[toolIdx]);
            return;
        }
        const liveBubble = e.target.closest?.('[data-mh-gm-stream-msg]');
        if (!liveBubble || !msgsEl.contains(liveBubble)) return;
        const msgIdx = parseInt(liveBubble.dataset.mhGmStreamMsg, 10);
        showStreamPopup(msgIdx, false);
    });
    msgsEl?.addEventListener('pointermove', (e) => {
        lastPointerClientX = e.clientX || 0;
        lastPointerClientY = e.clientY || 0;
        refreshHoverStreamPopup();
    });
    msgsEl?.addEventListener('pointerout', (e) => {
        const liveBubble = e.target.closest?.('[data-mh-gm-stream-msg]');
        if (!liveBubble || !msgsEl.contains(liveBubble)) return;
        if (liveBubble.contains(e.relatedTarget)) return;
        hideStreamPopup(false);
    });
    
    function showThinkingPopup(reasoningText) {
        // Remove any existing popup
        document.getElementById('mhGmThinkingPopup')?.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'mhGmThinkingPopup';
        overlay.className = 'mh-gm-thinking-popup-overlay';
        overlay.innerHTML = `
            <div class="mh-gm-thinking-popup">
                <div class="mh-gm-thinking-popup-head">
                    <strong>💭 AI 思考过程</strong>
                    <button type="button" class="mh-gm-thinking-popup-close" aria-label="关闭">×</button>
                </div>
                <div class="mh-gm-thinking-popup-body${!reasoningText ? ' is-empty' : ''}">${reasoningText ? escapeHtml(reasoningText) : '暂无思考内容'}</div>
                <div class="mh-gm-thinking-popup-hint">AI 在生成代码前的推理和分析过程</div>
            </div>`;
        
        panel.appendChild(overlay);
        
        // Close popup on overlay click or close button
        const closePopup = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.mh-gm-thinking-popup-close')) {
                closePopup();
            }
        });
        
        // Auto-scroll to bottom of reasoning text
        const body = overlay.querySelector('.mh-gm-thinking-popup-body');
        if (body) body.scrollTop = body.scrollHeight;
    }

    // 模型选择：记住选择，供后续生成使用。
    modelBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleModelList(); });
    modelList?.addEventListener('click', (e) => {
        const item = e.target.closest?.('[data-mh-gm-model-val]');
        if (!item) return;
        selectedModel = item.dataset.mhGmModelVal || '';
        savePreferredModel(selectedModel);
        updateModelBtnLabel();
        // 更新 active 样式
        modelList.querySelectorAll('.mh-gm-model-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mhGmModelVal === selectedModel);
        });
        closeModelList();
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

    // 点击别处关闭历史弹层、emoji 选择器和模型列表。
    const onDocPointerDown = (e) => {
        if (historyOpen && !historyPop?.contains(e.target) && !historyBtn?.contains(e.target)) closeHistoryPop();
        if (modelOpen && !modelList?.contains(e.target) && !modelBtn?.contains(e.target)) closeModelList();
        const streamPopup = $('mhGmStreamPopup');
        if (streamPopupState?.pinned && streamPopup && !streamPopup.contains(e.target) && !e.target.closest?.('[data-mh-gm-stream-msg]')) hideStreamPopup(true);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    // ---------- 初始化 ----------
    renderMessages();
    updateGenerationControls();
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
        try { hideStreamPopup(true); } catch (_) {}
        abortController = null;
        activeGameMakerCleanup = null;
    };
}
