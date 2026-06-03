// 小游戏创造视图（全屏）：AI vibe-coding 工坊。
// 玩家用自然语言描述想要的游戏，AI 基于 minigames/AGENTS.md 生成完整 HTML5 单页游戏，
// 支持实时预览与多轮迭代，保存到 PersonalPageStore 的 pet-games/ 目录。
import { $, escapeHtml, showToast, confirm as gameConfirm } from './utils.js';
import { t, getLang } from './i18n.js';
import { state } from './state.js';
import { savePetGame } from './storage.js';
import { handleMinigamePetMessage, pushActivePetConfigToFrame } from './view_minigames.js';
import { openGameMakerSettings, closeGameMakerSettings } from './view_game_maker_settings.js';

// 游戏创作工坊的 AI 会话共用同一个 modId，chatId 区分不同会话，便于列出历史。
const GAME_MAKER_MOD_ID = 'magichaqi-game-maker';
const GAME_MAKER_MODEL_KEY = 'mh_game_maker_model';
const GAME_MAKER_WORKSPACE_PREFIX = 'magichaqi-game-maker';
const GAME_MAKER_FILE_PATH = 'game.html';

// ---------- 本地 IndexedDB 会话历史 ----------
// 设计：每条记录是一次完整的「对话会话」，含全部对话气泡 + 会话结束时的完整游戏代码。
// 历史永久保存在用户本机（IndexedDB），不上传服务器；按 gameKey 把同一个游戏的多次会话归组。
const LOCAL_HISTORY_DB_NAME = 'magichaqi-game-maker-sessions';
const LOCAL_HISTORY_DB_VERSION = 2; // v2: 新增 gameKey 索引，移除 7 天过期
const LOCAL_HISTORY_STORE = 'sessions';

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
                let store;
                if (!db.objectStoreNames.contains(LOCAL_HISTORY_STORE)) {
                    store = db.createObjectStore(LOCAL_HISTORY_STORE, { keyPath: 'chatId' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                } else {
                    store = req.transaction.objectStore(LOCAL_HISTORY_STORE);
                }
                if (!store.indexNames.contains('gameKey')) {
                    store.createIndex('gameKey', 'gameKey', { unique: false });
                }
            };
            req.onsuccess = () => { _localHistoryDB = req.result; resolve(_localHistoryDB); };
            req.onerror = () => { _localHistoryDBPromise = null; reject(req.error); };
        } catch (e) { _localHistoryDBPromise = null; reject(e); }
    });
    return _localHistoryDBPromise;
}

async function saveLocalSession(chatId, title, messages, html, gamePath, gameKey, htmlBefore) {
    try {
        const db = await openLocalHistoryDB();
        // 等待事务真正提交，避免随后 getAll 读不到刚写入的记录（IndexedDB 竞态）。
        await new Promise((resolve, reject) => {
            const tx = db.transaction(LOCAL_HISTORY_STORE, 'readwrite');
            const store = tx.objectStore(LOCAL_HISTORY_STORE);
            store.put({
                chatId,
                title: title || '',
                messages: Array.isArray(messages) ? messages.map(m => ({
                    role: m.role,
                    text: m.text || '',
                    reasoning: m.reasoning || '',
                    images: Array.isArray(m.images) ? m.images.map(img => ({ id: img.id || '', dataUrl: img.dataUrl || '' })) : [],
                    editLink: !!m.editLink,
                    toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls.map(normalizeToolEventForStore) : [],
                    // 保存交错顺序：text 段与 tool 段按流式接收的真实顺序存档，便于历史完整还原。
                    segments: Array.isArray(m.segments) ? m.segments.map(seg => (
                        seg && seg.type === 'tool'
                            ? { type: 'tool', tool: normalizeToolEventForStore(seg.tool || {}) }
                            : { type: 'text', text: (seg && seg.text) || '' }
                    )) : undefined,
                })) : [],
                html: html || '',
                // 这一轮开始前（即本轮第一条用户消息发送前）的完整游戏代码，
                // 用于点击用户气泡「回退/分叉到发送这条消息之前」时精确还原代码状态。
                htmlBefore: htmlBefore || '',
                gamePath: gamePath || '',
                gameKey: gameKey || gamePath || '',
                updatedAt: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[game-maker] saveLocalSession failed', e);
    }
}

// 列出某个游戏（gameKey）的全部历史会话。永不过期。
// 宽松匹配：gameKey 相等，或（兼容旧记录）gamePath 相等，都算同一个游戏。
function sessionMatchesGame(row, gameKey, gamePath) {
    if (!gameKey && !gamePath) return true;
    const rowKey = row?.gameKey || '';
    const rowPath = row?.gamePath || '';
    if (gameKey && rowKey && rowKey === gameKey) return true;
    if (gamePath && rowPath && rowPath === gamePath) return true;
    // 兼容仅有 gamePath 的旧记录。
    if (gameKey && !rowKey && rowPath && gamePath && rowPath === gamePath) return true;
    return false;
}

async function listLocalSessions(gameKey, gamePath) {
    try {
        const db = await openLocalHistoryDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(LOCAL_HISTORY_STORE, 'readonly');
            const store = tx.objectStore(LOCAL_HISTORY_STORE);
            const req = store.getAll();
            req.onsuccess = () => {
                let rows = Array.isArray(req.result) ? req.result : [];
                rows = rows.filter(r => sessionMatchesGame(r, gameKey, gamePath));
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
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (_) { return null; }
}

// 删除单条历史会话。
async function deleteLocalSession(chatId) {
    try {
        const db = await openLocalHistoryDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(LOCAL_HISTORY_STORE, 'readwrite');
            tx.objectStore(LOCAL_HISTORY_STORE).delete(chatId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (e) { console.warn('[game-maker] deleteLocalSession failed', e); }
}

// 清空某个游戏（gameKey/gamePath）的全部历史；不传时清空全部。
async function clearLocalSessions(gameKey, gamePath) {
    try {
        const rows = await listLocalSessions(gameKey, gamePath);
        const db = await openLocalHistoryDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(LOCAL_HISTORY_STORE, 'readwrite');
            const store = tx.objectStore(LOCAL_HISTORY_STORE);
            for (const r of rows) {
                if (r && r.chatId != null) store.delete(r.chatId);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (e) { console.warn('[game-maker] clearLocalSessions failed', e); }
}

// 相对时间：把时间戳格式化成“刚刚 / N 分钟前 / N 小时前 / N 天前”，用于历史列表。
function formatHistoryTime(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return '';
    const diff = Date.now() - value;
    const minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;
    if (diff < minute) return t('timeJustNow');
    if (diff < hour) return t('timeMinutesAgo', { n: Math.floor(diff / minute) });
    if (diff < day) return t('timeHoursAgo', { n: Math.floor(diff / hour) });
    if (diff < 30 * day) return t('timeDaysAgo', { n: Math.floor(diff / day) });
    try { return new Date(value).toLocaleDateString(); } catch (_) { return ''; }
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

// 把工具事件补全为渲染所需字段（恢复历史时，存档里没有的字段用默认值补齐）。
function reviveToolEvent(tool) {
    const t0 = tool || {};
    const argsObj = (t0.argsObj && typeof t0.argsObj === 'object') ? t0.argsObj : safeJsonParse(t0.args, null);
    return {
        id: t0.id || `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: t0.name || 'tool',
        status: t0.status || 'done',
        args: t0.args || '',
        argsObj: (argsObj && typeof argsObj === 'object') ? argsObj : null,
        result: t0.result || '',
        detailResult: t0.detailResult || t0.result || '',
        error: t0.error || '',
        ts: t0.ts || Date.now(),
    };
}

// 从存档的 AI 消息恢复「交错段落」(segments)。
// 优先用存档里的 segments；旧记录没有 segments 时退回到「先全部工具调用、后正文」的旧顺序。
function reviveSegments(m) {
    const tools = (Array.isArray(m?.toolCalls) ? m.toolCalls : []).map(reviveToolEvent);
    if (Array.isArray(m?.segments) && m.segments.length) {
        // 用 id 把 segment 里的工具与 toolCalls 数组对应起来，保证两者引用同一对象。
        const byId = new Map(tools.map(tc => [tc.id, tc]));
        const segments = [];
        for (const seg of m.segments) {
            if (seg && seg.type === 'tool') {
                const revived = reviveToolEvent(seg.tool || {});
                const existing = byId.get(revived.id);
                segments.push({ type: 'tool', tool: existing || revived });
            } else {
                segments.push({ type: 'text', text: (seg && seg.text) || '' });
            }
        }
        return { segments, toolCalls: tools };
    }
    // 旧记录：工具调用在前、正文在后。
    const segments = tools.map(tool => ({ type: 'tool', tool }));
    const text = String(m?.text || '');
    if (text) segments.push({ type: 'text', text });
    return { segments, toolCalls: tools };
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

// 完整序列化工具调用内容，不做任何截断（用于工具详情弹窗，可滚动查看）。
function fullToolDetail(value) {
    try {
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch (_) {
        return String(value || '');
    }
}

function summarizeToolResult(result) {
    const text = stringifyToolDetail(result, 500);
    if (!text) return '';
    const firstLine = text.split('\n').find(line => line.trim()) || text;
    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
}

// 规整推理文本的空白：折叠 3+ 连续空行为 1 个空行、行尾去空格、整体 trim，
// 避免模型返回的多余换行在面板里撑出大片空白。
function normalizeReasoningText(text) {
    return String(text == null ? '' : text)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// 只取文件名（去掉路径），用于工具调用的人性化标签。
function toolFileName(path) {
    const s = String(path || '').trim();
    if (!s) return '';
    return s.split(/[\\/]/).pop() || s;
}

// 统计一段文本的行数（空字符串记为 0 行）。
function countLines(text) {
    const s = String(text == null ? '' : text);
    if (s === '') return 0;
    return s.split('\n').length;
}

// ---------- 轻量级 Markdown 渲染（仅用于 AI 聊天正文展示） ----------
// 支持极少量的常用语法，先整体转义 HTML 再注入安全标签，杜绝 XSS：
//   - 代码围栏 ```lang ... ```  → <pre><code>…</code></pre>
//   - 行内代码 `code`           → <code>…</code>
//   - 加粗 **text** / __text__  → <strong>…</strong>
//   - 斜体 *text* / _text_      → <em>…</em>
//   - 无序列表 -/*/+ item       → <ul><li>…</li></ul>
//   - 有序列表 1. item          → <ol><li>…</li></ol>
// 设计目标是流式安全：对未闭合的代码围栏也能优雅降级（当作普通正文继续追加）。

// 渲染行内 Markdown（输入为已转义的 HTML 安全文本）。
function renderInlineMarkdown(escaped) {
    let s = String(escaped == null ? '' : escaped);
    // 行内代码优先：用占位符保护其内容，避免其中的 * _ 被误当作强调语法。
    const codeSpans = [];
    s = s.replace(/`([^`\n]+?)`/g, (_, code) => {
        const idx = codeSpans.push(`<code class="mh-gm-md-code">${code}</code>`) - 1;
        return `\u0000CODE${idx}\u0000`;
    });
    // 加粗（先于斜体，避免 ** 被单星号规则吃掉）。
    s = s.replace(/\*\*([^\s*][\s\S]*?[^\s*]|\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^\s_][\s\S]*?[^\s_]|\S)__/g, '<strong>$1</strong>');
    // 斜体（避免匹配到加粗剩余的星号）。
    s = s.replace(/(^|[^*])\*([^\s*][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^\s_][^_\n]*?)_(?!_)/g, '$1<em>$2</em>');
    // 还原行内代码占位符。
    s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeSpans[Number(i)] || '');
    return s;
}

// 记忆化缓存：流式渲染每帧都会重复传入相同/递增的文本，缓存上一次结果可避免重复解析。
// 单条缓存即可——同一条消息在一帧内只渲染一次，跨帧时文本通常单调增长，命中率仍高。
const _mdCache = new Map();
const _MD_CACHE_LIMIT = 64;
function renderBasicMarkdownCached(text) {
    const key = String(text == null ? '' : text);
    const hit = _mdCache.get(key);
    if (hit !== undefined) return hit;
    const html = renderBasicMarkdown(key);
    // 简单 LRU：超限时删除最早插入的键。
    if (_mdCache.size >= _MD_CACHE_LIMIT) {
        const firstKey = _mdCache.keys().next().value;
        if (firstKey !== undefined) _mdCache.delete(firstKey);
    }
    _mdCache.set(key, html);
    return html;
}

// 把一段文本渲染成基础 Markdown HTML（先整体转义，再分行处理块级语法）。
function renderBasicMarkdown(text) {
    const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    const out = [];
    let i = 0;
    // 列表块累积状态。
    let listType = null; // 'ul' | 'ol' | null
    let listItems = [];
    const flushList = () => {
        if (!listType) return;
        out.push(`<${listType} class="mh-gm-md-list">${listItems.join('')}</${listType}>`);
        listType = null;
        listItems = [];
    };
    while (i < lines.length) {
        const line = lines[i];
        // 代码围栏：```lang 开始，直到下一个 ``` 结束（未闭合则吃到文末）。
        const fenceMatch = line.match(/^\s*```(\w*)\s*$/);
        if (fenceMatch) {
            flushList();
            const codeLines = [];
            i++;
            while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // 跳过收尾的 ```
            const lang = fenceMatch[1] ? ` data-lang="${escapeHtml(fenceMatch[1])}"` : '';
            out.push(`<pre class="mh-gm-md-pre"${lang}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }
        // 无序列表项：- / * / + 开头。
        const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
        // 有序列表项：1. / 1) 开头。
        const olMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ulMatch || olMatch) {
            const type = ulMatch ? 'ul' : 'ol';
            if (listType && listType !== type) flushList();
            listType = type;
            const content = renderInlineMarkdown(escapeHtml((ulMatch ? ulMatch[1] : olMatch[1]) || ''));
            listItems.push(`<li>${content}</li>`);
            i++;
            continue;
        }
        // 空行：结束当前列表，输出一个换行分隔。
        if (line.trim() === '') {
            flushList();
            out.push('');
            i++;
            continue;
        }
        // 普通文本行：行内 Markdown。
        flushList();
        out.push(`<span class="mh-gm-md-line">${renderInlineMarkdown(escapeHtml(line))}</span>`);
        i++;
    }
    flushList();
    // 用 <br> 连接相邻的普通行/块，空字符串元素表示原本的空行。
    return out
        .map((piece) => (piece === '' ? '' : piece))
        .join('\n')
        .replace(/\n/g, '<br>')
        // 块级元素（pre/ul/ol）前后多余的 <br> 去掉，避免大空隙。
        .replace(/(<br>)+(<(?:pre|ul|ol))/g, '$2')
        .replace(/(<\/(?:pre|ul|ol)>)(<br>)+/g, '$1');
}

// 把工具调用渲染成人类可读的描述，返回 { text, html }：
//   text 用于 title 提示（纯文本）
//   html 用于展示，其中行范围用灰色、+ 用绿色、- 用红色高亮
// 例如：read [game.html], lines 1 to 200 ；edited [game.html] +100 -2 ；created [game.html]
function toolChipLabel(tool) {
    const name = tool?.name || 'tool';
    const a = (tool && typeof tool.argsObj === 'object' && tool.argsObj) ? tool.argsObj : null;
    const file = toolFileName(a?.filePath || a?.path);
    const fileTag = file ? `[${file}]` : '';
    // 文件名渲染成可点击的“按钮”，点击后弹窗显示当前游戏文件完整内容。
    const fileHtml = file
        ? `<span class="mh-gm-tc-file" data-mh-gm-tc-file="${escapeHtml(file)}" role="button" tabindex="0" title="${escapeHtml(`查看 ${file} 内容`)}">[${escapeHtml(file)}]</span>`
        : '';
    const muted = (s) => `<span class="mh-gm-tc-muted">${escapeHtml(String(s))}</span>`;
    const plus = (n) => `<span class="mh-gm-tc-add">+${n}</span>`;
    const minus = (n) => `<span class="mh-gm-tc-del">-${n}</span>`;

    switch (name) {
        case 'read_file': {
            const start = a?.startLine ?? a?.start_line;
            const end = a?.endLine ?? a?.end_line;
            if (file && start != null && end != null) {
                return {
                    text: `read ${fileTag}, lines ${start} to ${end}`,
                    html: `read ${fileHtml}${muted(`, lines ${start} to ${end}`)}`,
                };
            }
            if (file) return { text: `read ${fileTag}`, html: `read ${fileHtml}` };
            return { text: 'read file', html: 'read file' };
        }
        case 'replace_string_in_file': {
            const added = countLines(a?.newString ?? a?.new_string);
            const removed = countLines(a?.oldString ?? a?.old_string);
            return {
                text: `edited ${file ? fileTag : 'file'} +${added} -${removed}`,
                html: `edited ${file ? fileHtml : 'file'} ${plus(added)} ${minus(removed)}`,
            };
        }
        case 'multi_replace_string_in_file': {
            let added = 0, removed = 0;
            const reps = Array.isArray(a?.replacements) ? a.replacements : [];
            for (const r of reps) {
                added += countLines(r?.newString ?? r?.new_string);
                removed += countLines(r?.oldString ?? r?.old_string);
            }
            return {
                text: `edited ${file ? fileTag : 'file'} +${added} -${removed}`,
                html: `edited ${file ? fileHtml : 'file'} ${plus(added)} ${minus(removed)}`,
            };
        }
        case 'create_file':
            return file ? { text: `created ${fileTag}`, html: `created ${fileHtml}` } : { text: 'created file', html: 'created file' };
        case 'grep_search': {
            const q = a?.query ? ` "${String(a.query).slice(0, 24)}"` : '';
            return {
                text: `search ${file ? fileTag : ''}${q}`.trim(),
                html: `search ${file ? fileHtml : ''}${q ? muted(q) : ''}`.trim(),
            };
        }
        default:
            return { text: name, html: escapeHtml(name) };
    }
}

let activeGameMakerCleanup = null;
export function disposeGameMaker() {
    if (activeGameMakerCleanup) activeGameMakerCleanup();
    activeGameMakerCleanup = null;
}

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
    let roundCounter = 0;                     // 当前会话已完成的对话轮数（用于历史快照 id）
    let lastSnapshotId = '';                  // 最近一条历史快照 id（用于「无代码改动时并入上一条」）
    let lastSnapshotHtmlBefore = '';          // 最近一条快照「开始前」的完整代码（无代码改动并入时沿用）
    let historyRows = [];                    // 本地历史会话列表（按当前游戏归组）
    let historyOpen = false;

    // 本次「游戏创作」打开期间稳定不变的分组 id：当游戏尚未保存（无 id / 无 path）时，
    // 用它来把这一段时间内新建的多个会话归到同一组，确保“新建会话”后旧会话仍能在历史里找到。
    const makerGroupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const getSessionWorkspace = () => `${GAME_MAKER_WORKSPACE_PREFIX}-${chatId}`;

    // 同一个游戏的多次会话用 gameKey 归组：优先用游戏记录 id（稳定），其次保存路径，
    // 都没有时退回到本次打开期间稳定的 makerGroupId（而不是按 chatId，否则新建会话会丢历史）。
    const currentGameKey = () => (record?.id ? `id:${record.id}` : (savedPath ? `path:${savedPath}` : makerGroupId));

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
            .mh-gm-toolbar { position:relative; display:flex; align-items:center; gap:8px; padding:7px 12px; background:rgba(8,16,34,.5); border-bottom:1px solid rgba(148,163,184,.12); flex-shrink:0; overflow:visible; }
            .mh-gm-modelwrap { position:relative; flex:1 1 0; min-width:0; overflow:visible; }
            .mh-gm-model-btn { width:100%; appearance:none; background:#0f2747; border:1px solid rgba(148,163,184,.24); border-radius:9px; color:#e2e8f0; font-size:13px; font-weight:700; padding:7px 28px 7px 12px; cursor:pointer; outline:none; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gm-model-btn:disabled { opacity:.5; cursor:not-allowed; }
            .mh-gm-modelwrap::after { content:'⌄'; position:absolute; right:9px; top:50%; transform:translateY(-60%); color:#94a3b8; font-size:13px; pointer-events:none; }
            .mh-gm-model-list { position:absolute; bottom:calc(100% + 4px); left:0; right:0; z-index:40; max-height:260px; overflow:auto; background:#0f2747; border:1px solid rgba(148,163,184,.28); border-radius:10px; box-shadow:0 -8px 24px rgba(0,0,0,.4); padding:4px; display:none; }
            .mh-gm-model-list.open { display:block; }
            .mh-gm-model-item { display:block; width:100%; text-align:left; background:none; border:0; color:#e2e8f0; font-size:13px; padding:9px 12px; border-radius:7px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gm-model-item:hover { background:rgba(99,102,241,.16); }
            .mh-gm-model-item.active { background:rgba(99,102,241,.24); color:#a5b4fc; font-weight:700; }
            .mh-gm-toolbtn { width:36px; height:36px; flex:0 0 36px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#cbd5e1; border-radius:9px; font-size:16px; display:grid; place-items:center; cursor:pointer; padding:0; outline:none; -webkit-tap-highlight-color:transparent; }
            .mh-gm-toolbtn:hover { border-color:#6366f1; color:#a5b4fc; }
            /* 无状态：点击/聚焦后不保留高亮边框，恢复默认外观。 */
            .mh-gm-toolbtn:focus, .mh-gm-toolbtn:focus-visible, .mh-gm-toolbtn:active { outline:none; border-color:rgba(148,163,184,.24); color:#cbd5e1; box-shadow:none; }
            .mh-gm-toolbtn:focus:hover, .mh-gm-toolbtn:active:hover { border-color:#6366f1; color:#a5b4fc; }
            .mh-gm-toolbtn svg { width:18px; height:18px; }
            .mh-gm-history-pop { position:absolute; right:12px; bottom:100%; margin-bottom:6px; z-index:60; width:min(340px,calc(100vw - 24px)); min-width:220px; max-height:60vh; overflow:auto; background:#0f2747; border:1px solid rgba(148,163,184,.28); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.45); padding:6px; display:none; }
            .mh-gm-history-pop.open { display:block; }
            .mh-gm-history-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px 6px; color:#94a3b8; font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
            .mh-gm-history-clear { border:0; background:rgba(248,113,113,.12); color:#f87171; font-size:11px; font-weight:800; letter-spacing:0; text-transform:none; padding:4px 9px; border-radius:7px; cursor:pointer; }
            .mh-gm-history-clear:hover { background:rgba(248,113,113,.22); }
            .mh-gm-history-row { display:flex; align-items:center; gap:2px; border-radius:8px; }
            .mh-gm-history-row:hover { background:rgba(99,102,241,.12); }
            .mh-gm-history-row.active { background:rgba(99,102,241,.2); }
            .mh-gm-history-item { display:flex; align-items:center; gap:10px; flex:1; min-width:0; text-align:left; background:none; border:0; color:#e2e8f0; font-size:13px; padding:9px 10px; border-radius:8px; cursor:pointer; }
            .mh-gm-history-dot { flex:0 0 6px; width:6px; height:6px; border-radius:50%; background:#64748b; }
            .mh-gm-history-row.active .mh-gm-history-dot { background:#a5b4fc; box-shadow:0 0 0 3px rgba(165,180,252,.18); }
            .mh-gm-history-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
            .mh-gm-history-title { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:700; }
            .mh-gm-history-row.active .mh-gm-history-title { color:#a5b4fc; }
            .mh-gm-history-time { color:#64748b; font-size:11px; }
            .mh-gm-history-del { flex:0 0 auto; border:0; background:none; color:#64748b; font-size:14px; line-height:1; padding:8px 9px; border-radius:7px; cursor:pointer; opacity:.6; }
            .mh-gm-history-del:hover { background:rgba(248,113,113,.18); color:#f87171; opacity:1; }
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

            .mh-gm-tabbar { display:flex; position:relative; background:rgba(8,16,34,.6); border-bottom:1px solid rgba(148,163,184,.16); flex-shrink:0; }
            .mh-gm-tabbar button[data-mh-gm-pane] { flex:1; min-height:44px; padding:8px 6px; background:none; border:0; border-bottom:2px solid transparent; color:#64748b; font-size:14px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:5px; }
            .mh-gm-tabbar button[data-mh-gm-pane].active { color:#a5b4fc; border-bottom-color:#6366f1; }

            .mh-gm-stage { flex:1; min-height:0; min-width:0; position:relative; overflow:hidden; }
            .mh-gm-pane { position:absolute; inset:0; display:none; flex-direction:column; min-height:0; min-width:0; }
            .mh-gm-pane.active { display:flex; }

            .mh-gm-chat-msgs { flex:1; min-width:0; overflow-y:auto; overflow-x:hidden; padding:16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
            .mh-gm-welcome { padding:14px 4px; text-align:center; }
            .mh-gm-welcome-star { font-size:40px; line-height:1; }
            .mh-gm-welcome-title { margin-top:10px; font-size:19px; font-weight:900; color:#f1f5f9; }
            .mh-gm-welcome-sub { margin-top:5px; font-size:13px; color:#94a3b8; line-height:1.5; }
            /* 「启发我」按钮：渐变胶囊，居中显示，引导用户让 AI 出主意。 */
            .mh-gm-inspire { margin-top:22px; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-width:160px; padding:13px 26px; border:0; border-radius:999px; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; font-size:15px; font-weight:900; cursor:pointer; box-shadow:0 8px 24px rgba(99,102,241,.4); transition:filter .15s, transform .12s; }
            .mh-gm-inspire:hover { filter:brightness(1.08); }
            .mh-gm-inspire:active { transform:scale(.97); }
            .mh-gm-inspire:disabled { opacity:.55; cursor:not-allowed; filter:none; }
            /* 「或者直接描述」分隔线 + 文案。 */
            .mh-gm-welcome-or { display:flex; align-items:center; gap:10px; margin:20px 2px 0; color:#64748b; font-size:12px; font-weight:700; }
            .mh-gm-welcome-or::before, .mh-gm-welcome-or::after { content:''; flex:1; height:1px; background:rgba(148,163,184,.18); }

            /* AI 启发返回的可点击建议气泡（位于 AI 消息内）。 */
            .mh-gm-suggest-label { margin:10px 0 6px; color:#94a3b8; font-size:12px; font-weight:700; }
            .mh-gm-suggest-list { display:flex; flex-direction:column; gap:8px; }
            .mh-gm-suggest { display:flex; align-items:center; gap:9px; width:100%; padding:11px 14px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.05); border-radius:12px; color:#e2e8f0; font-size:14px; font-weight:700; cursor:pointer; text-align:left; transition:border-color .15s, background .15s; }
            .mh-gm-suggest:hover { border-color:#6366f1; background:rgba(99,102,241,.14); }
            .mh-gm-suggest:active { background:rgba(99,102,241,.22); }
            .mh-gm-suggest-ico { font-size:18px; flex:0 0 auto; }
            .mh-gm-suggest-text { min-width:0; flex:1; }
            /* 「换一批」chip：弱化样式（虚线边框 + 居中），与普通建议气泡区分。 */
            .mh-gm-suggest-more { margin-top:2px; justify-content:center; border-style:dashed; border-color:rgba(148,163,184,.3); background:transparent; color:#94a3b8; font-weight:800; }
            .mh-gm-suggest-more .mh-gm-suggest-text { flex:0 0 auto; text-align:center; }
            .mh-gm-suggest-more:hover { border-color:#818cf8; color:#a5b4fc; background:rgba(99,102,241,.08); }

            .mh-gm-msg { display:flex; min-width:0; max-width:100%; }
            .mh-gm-msg.user { justify-content:flex-end; }
            .mh-gm-msg.ai { justify-content:flex-start; }
            .mh-gm-bubble { font-size:14px; line-height:1.5; word-break:break-word; white-space:pre-wrap; }
            /* 用户消息：彩色气泡 */
            .mh-gm-bubble.user { max-width:86%; padding:10px 14px; border-radius:14px; background:#6366f1; color:#fff; border-bottom-right-radius:4px; }
            /* 用户气泡可点击：回退/分叉到发送这条消息之前的状态。 */
            .mh-gm-bubble.user.is-forkable { cursor:pointer; transition:background .15s ease, box-shadow .15s ease; }
            .mh-gm-bubble.user.is-forkable:hover { background:#4f46e5; box-shadow:0 0 0 2px rgba(165,180,252,.45); }
            .mh-gm-bubble.user.is-forkable:active { background:#4338ca; }
            /* AI 回复：全宽、无背景、无边框，直接渲染。min-width:0 让其在 flex 行内可收缩，避免子内容撑出横向滚动。 */
            .mh-gm-bubble.ai { width:100%; max-width:100%; min-width:0; padding:2px 0; background:none; border:0; color:#e2e8f0; }
            /* 流式进行中的「…」：作为独立块显示在内容末尾，跟随上一段（含工具调用块）留出间距。 */
            .mh-gm-dots { display:block; margin-top:8px; line-height:1; }
            .mh-gm-dots:first-child { margin-top:0; }
            .mh-gm-dots span { display:inline-block; width:6px; height:6px; margin:0 1px; border-radius:50%; background:#a5b4fc; animation:mhGmDot 1s ease-in-out infinite; }
            .mh-gm-dots span:nth-child(2){animation-delay:.15s} .mh-gm-dots span:nth-child(3){animation-delay:.3s}
            @keyframes mhGmDot { 0%,80%,100%{opacity:.3;transform:translateY(0)} 40%{opacity:1;transform:translateY(-3px)} }


            /* 交错正文段：与工具调用按真实流式顺序排列；过长时限高可滚动，并提供「展开/收起」。 */
            /* 段间距用 margin-top 统一控制，避免与工具调用块的 margin 叠加产生过大空隙。 */
            /* white-space:normal 复位：气泡是 pre-wrap，会把本模板里 body 与 toggle 之间的换行/缩进
               渲染成可见空白行（撑出一大块空隙）；这里复位让元素间空白折叠，正文换行交给 body 自身 pre-wrap。 */
            /* 段间距放大到普通段落的间隔，让正文段与工具块之间有清晰的呼吸空间。 */
            .mh-gm-textseg { margin:14px 0 0; white-space:normal; }
            .mh-gm-textseg:first-child { margin-top:0; }
            /* 正文像普通段落一样阅读：放宽行高、加一点字距，避免行行紧贴显得拥挤。 */
            /* 正文已渲染为基础 Markdown（<br> 控制换行 + 块级 pre/ul/ol），故用 normal 折叠空白，避免与 <br> 叠加。 */
            /* 只允许纵向滚动；横向一律隐藏，避免长行/代码块撑出永久横向滚动条。 */
            .mh-gm-textseg-body { max-height:260px; overflow-y:auto; overflow-x:hidden; white-space:normal; word-break:break-word; overflow-wrap:anywhere; line-height:1.7; letter-spacing:.1px; -webkit-overflow-scrolling:touch; }
            .mh-gm-textseg.is-expanded .mh-gm-textseg-body { max-height:none; overflow-y:visible; }
            /* 基础 Markdown 元素样式（行内代码 / 代码围栏 / 列表 / 强调）。 */
            .mh-gm-md-code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.9em; padding:1px 5px; border-radius:5px; background:rgba(99,102,241,.16); border:1px solid rgba(99,102,241,.24); color:#c7d2fe; word-break:break-word; overflow-wrap:anywhere; }
            /* 代码围栏：聊天上下文里宁可换行也绝不出现横向滚动条（含窄屏移动端）。 */
            .mh-gm-md-pre { margin:8px 0; padding:10px 12px; border-radius:10px; background:rgba(0,0,0,.32); border:1px solid rgba(99,102,241,.22); max-width:100%; box-sizing:border-box; overflow:hidden; }
            .mh-gm-md-pre code { display:block; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px; line-height:1.5; color:#cbd5e1; white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere; }
            .mh-gm-md-list { margin:6px 0; padding-left:22px; }
            .mh-gm-md-list li { margin:2px 0; line-height:1.6; }
            .mh-gm-textseg-body strong { font-weight:800; color:#f1f5f9; }
            .mh-gm-textseg-body em { font-style:italic; }
            /* 展开/收起：小图标按钮（chevron），展开时上下翻转。 */
            .mh-gm-textseg-toggle { margin-top:2px; width:24px; height:24px; border:1px solid rgba(99,102,241,.3); background:rgba(99,102,241,.12); color:#a5b4fc; border-radius:7px; cursor:pointer; padding:0; display:grid; place-items:center; -webkit-tap-highlight-color:transparent; }
            .mh-gm-textseg-toggle:hover { background:rgba(99,102,241,.22); border-color:#818cf8; color:#c7d2fe; }
            .mh-gm-textseg-toggle svg { width:15px; height:15px; transition:transform .15s; }
            .mh-gm-textseg.is-expanded .mh-gm-textseg-toggle svg { transform:rotate(180deg); }
            .mh-gm-textseg-toggle[hidden] { display:none; }

            /* Streaming text popup (hover/tap AI bubble while it is generating). */
            .mh-gm-bubble.ai.is-live { cursor:pointer; }
            .mh-gm-stream-popup { position:absolute; left:8px; right:8px; bottom:calc(82px + env(safe-area-inset-bottom,0px)); z-index:55; max-height:68vh; border-radius:16px; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.35); box-shadow:0 16px 40px rgba(0,0,0,.45); padding:12px; display:flex; flex-direction:column; gap:8px; }
            .mh-gm-stream-popup-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#e2e8f0; font-size:14px; font-weight:800; }
            .mh-gm-stream-popup-close { border:0; background:rgba(255,255,255,.08); color:#94a3b8; border-radius:8px; width:28px; height:28px; display:grid; place-items:center; cursor:pointer; font-size:16px; }
            .mh-gm-stream-popup-close:hover { background:rgba(255,255,255,.14); color:#e2e8f0; }
            .mh-gm-stream-popup-body { min-height:96px; max-height:58vh; overflow:auto; border:1px solid rgba(99,102,241,.2); border-radius:12px; background:rgba(0,0,0,.2); color:#cbd5e1; padding:11px; font-size:13px; line-height:1.55; white-space:pre-wrap; word-break:break-word; -webkit-overflow-scrolling:touch; }
            .mh-gm-stream-popup-body.is-empty { color:#94a3b8; font-weight:700; display:flex; align-items:center; justify-content:center; text-align:center; }

            /* Inline live reasoning panel (streams the model's thinking process). */
            /* 折叠时面板收缩到标题宽度（不再是整行的大空框）；展开时占满可用宽度显示推理文本。 */
            /* white-space:normal 复位，避免气泡的 pre-wrap 把模板里的换行/缩进渲染成空白行。 */
            .mh-gm-reasoning { display:inline-block; vertical-align:top; margin:0 0 8px; border:1px solid rgba(99,102,241,.24); border-radius:10px; background:rgba(99,102,241,.08); overflow:hidden; max-width:100%; white-space:normal; }
            .mh-gm-reasoning:not(.is-collapsed) { display:block; }
            .mh-gm-reasoning-head { display:flex; align-items:center; gap:6px; padding:5px 10px; color:#a5b4fc; font-size:12px; font-weight:800; cursor:pointer; user-select:none; line-height:1.2; }
            .mh-gm-reasoning.is-collapsed .mh-gm-reasoning-head { gap:8px; }
            .mh-gm-reasoning-head:hover { background:rgba(99,102,241,.12); }
            .mh-gm-reasoning-head .mh-gm-reasoning-ico { font-size:13px; }
            .mh-gm-reasoning.is-live .mh-gm-reasoning-ico { animation:mhGmThinkPulse 1.6s ease-in-out infinite; }
            .mh-gm-reasoning-head .mh-gm-reasoning-caret { margin-left:auto; font-size:11px; opacity:.7; transition:transform .15s; }
            .mh-gm-reasoning.is-collapsed .mh-gm-reasoning-caret { transform:rotate(-90deg); }
            .mh-gm-reasoning-body { max-height:160px; overflow:auto; padding:7px 11px 8px; color:#b7c0d8; font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-word; border-top:1px solid rgba(99,102,241,.16); -webkit-overflow-scrolling:touch; }
            .mh-gm-reasoning-body:empty { display:none; }
            .mh-gm-reasoning.is-collapsed .mh-gm-reasoning-body { display:none; }

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
            .mh-gm-toolcalls { display:flex; flex-direction:column; gap:6px; margin:0 0 8px; }
            /* 交错模式下的单个工具调用块：用 margin-top 统一段间距，避免与正文段叠加产生大空隙。 */
            .mh-gm-toolcalls-seg { margin:14px 0 0; }
            .mh-gm-toolcalls-seg:first-child { margin-top:0; }
            .mh-gm-toolchip { display:flex; align-items:center; gap:6px; max-width:100%; border:1px solid rgba(148,163,184,.22); background:rgba(15,39,71,.72); color:#cbd5e1; border-radius:9px; padding:5px 9px; font-size:12px; font-weight:800; cursor:pointer; text-align:left; }
            .mh-gm-toolchip:hover { border-color:#6366f1; color:#a5b4fc; background:rgba(99,102,241,.13); }
            .mh-gm-toolchip-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .mh-gm-tc-muted { color:#94a3b8; font-weight:600; }
            .mh-gm-tc-add { color:#4ade80; font-weight:800; }
            .mh-gm-tc-del { color:#f87171; font-weight:800; }
            .mh-gm-tc-file { display:inline-flex; align-items:center; padding:1px 7px; margin:0 1px; border:1px solid rgba(99,102,241,.4); border-radius:6px; background:rgba(99,102,241,.16); color:#c7d2fe; font-weight:800; cursor:pointer; transition:background .12s, border-color .12s; }
            .mh-gm-tc-file:hover { background:rgba(99,102,241,.3); border-color:#818cf8; color:#e0e7ff; }
            .mh-gm-toolchip-status { margin-left:auto; flex:0 0 auto; color:#94a3b8; font-size:11px; }
            .mh-gm-toolchip.status-done .mh-gm-toolchip-status { color:#86efac; }
            .mh-gm-toolchip.status-error .mh-gm-toolchip-status { color:#fca5a5; }
            .mh-gm-tool-popup-overlay { position:absolute; inset:0; z-index:58; background:rgba(10,24,48,.45); display:flex; align-items:flex-end; justify-content:center; padding:14px 12px max(14px,env(safe-area-inset-bottom,0px)); }
            .mh-gm-tool-popup { width:100%; max-height:82%; border-radius:18px 18px 14px 14px; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.35); box-shadow:0 16px 40px rgba(0,0,0,.45); padding:14px; display:flex; flex-direction:column; gap:10px; }
            .mh-gm-tool-popup-head { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#e2e8f0; font-size:15px; font-weight:900; }
            .mh-gm-tool-popup-close { border:0; background:rgba(255,255,255,.08); color:#94a3b8; border-radius:8px; width:30px; height:30px; display:grid; place-items:center; cursor:pointer; font-size:16px; }
            .mh-gm-tool-popup-body { overflow:auto; display:flex; flex-direction:column; gap:10px; -webkit-overflow-scrolling:touch; }
            .mh-gm-tool-popup-section { border:1px solid rgba(99,102,241,.2); border-radius:12px; background:rgba(0,0,0,.2); overflow:hidden; display:flex; flex-direction:column; min-height:0; }
            .mh-gm-tool-popup-section strong { display:block; padding:8px 10px; color:#a5b4fc; font-size:12px; border-bottom:1px solid rgba(99,102,241,.16); flex:0 0 auto; }
            .mh-gm-tool-popup-section pre { margin:0; padding:10px; color:#cbd5e1; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-word; overflow:auto; max-height:46vh; -webkit-overflow-scrolling:touch; }
            .mh-gm-file-section { flex:1 1 auto; }
            /* 行号 + 代码：横向并排，gutter 固定宽度，代码区占满剩余空间。 */
            .mh-gm-file-section .mh-gm-code-wrap { display:flex; flex:1 1 auto; min-height:46vh; height:100%; overflow:hidden; }
            /* 读/编两种模式共用的代码区基础排版（确保行高一致、与行号对齐）。
               选择器带 .mh-gm-file-section 前缀以盖过通用 .mh-gm-tool-popup-section pre 规则。 */
            .mh-gm-file-section .mh-gm-code { margin:0; padding:10px; box-sizing:border-box; flex:1 1 auto; min-width:0; color:#cbd5e1; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; white-space:pre; word-break:normal; overflow:auto; max-height:none; -webkit-overflow-scrolling:touch; }
            /* 行号 gutter：与代码同字号行高，右对齐，禁用换行，隐藏自身滚动条（由代码区驱动同步）。 */
            .mh-gm-file-section .mh-gm-gutter { margin:0; padding:10px 8px 10px 4px; box-sizing:border-box; flex:0 0 auto; text-align:right; color:#64748b; background:rgba(0,0,0,.18); border-right:1px solid rgba(99,102,241,.16); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; white-space:pre; word-break:normal; overflow:hidden; max-height:none; user-select:none; -webkit-user-select:none; }
            /* 只读代码区背景与原 <pre> 保持一致。 */
            .mh-gm-file-section pre.mh-gm-code { color:#cbd5e1; }
            /* 可编辑文本域：与 <pre> 等宽等字体、撑满高度，去掉默认边框。 */
            .mh-gm-file-section textarea.mh-gm-code { border:0; resize:none; background:rgba(0,0,0,.25); color:#e2e8f0; outline:none; }
            /* 弹窗标题栏里的编辑/保存按钮。 */
            .mh-gm-file-edit { border:0; background:linear-gradient(180deg,#6366f1 0%,#4f46e5 100%); color:#fff; border-radius:8px; height:30px; padding:0 14px; cursor:pointer; font-size:13px; font-weight:800; }
            .mh-gm-file-edit:disabled { opacity:.6; cursor:default; }
            .mh-gm-file-edit.is-saving { background:linear-gradient(180deg,#22c55e 0%,#16a34a 100%); }
            .mh-gm-file-popup-actions { display:flex; align-items:center; gap:8px; }
            .mh-gm-file-copy { width:34px; height:34px; flex:0 0 34px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#cbd5e1; border-radius:9px; display:grid; place-items:center; cursor:pointer; padding:0; outline:none; -webkit-tap-highlight-color:transparent; }
            .mh-gm-file-copy:hover { border-color:#6366f1; color:#a5b4fc; }
            .mh-gm-file-copy:focus, .mh-gm-file-copy:active { outline:none; box-shadow:none; }
            .mh-gm-file-copy svg { width:17px; height:17px; }
            /* 编辑欢迎语里的游戏名链接（下划线、可点击）。 */
            .mh-gm-file-link { color:#a5b4fc; text-decoration:underline; text-underline-offset:2px; cursor:pointer; font-weight:700; }
            .mh-gm-file-link:hover { color:#c7d2fe; }

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
            /* 刷新按钮：移动端位于标签栏右侧，仅在“预览”标签激活且有内容时显示。 */
            .mh-gm-preview-refresh { position:absolute; top:50%; right:8px; transform:translateY(-50%); z-index:5; width:34px; height:34px; border:1px solid rgba(148,163,184,.3); border-radius:9px; background:rgba(15,23,42,.7); color:#cbd5e1; display:none; place-items:center; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.3); transition:background .15s, color .15s, border-color .15s; }
            .mh-gm-tabbar.preview-active.has-preview .mh-gm-preview-refresh { display:grid; }
            .mh-gm-preview-refresh:hover { background:rgba(99,102,241,.28); border-color:#818cf8; color:#e0e7ff; }
            .mh-gm-preview-refresh:active { transform:translateY(-50%) scale(.94); }
            .mh-gm-preview-refresh svg { width:17px; height:17px; }
            .mh-gm-preview-refresh.is-spin svg { animation:mhGmSpin .6s linear; }
            @keyframes mhGmSpin { from{transform:rotate(0)} to{transform:rotate(360deg)} }

            /* Runtime error popup (preview iframe errors). */
            .mh-gm-err-popup-overlay { position:absolute; inset:0; z-index:62; background:rgba(10,24,48,.5); display:flex; align-items:flex-end; justify-content:center; padding:14px 12px max(14px,env(safe-area-inset-bottom,0px)); animation:mhGmErrFade .15s ease; }
            @keyframes mhGmErrFade { from{opacity:0} to{opacity:1} }
            .mh-gm-err-popup { width:100%; max-width:520px; max-height:78%; border-radius:18px 18px 14px 14px; background:linear-gradient(180deg,#2a1320 0%,#1a1330 100%); border:1.5px solid rgba(248,113,113,.4); box-shadow:0 16px 40px rgba(0,0,0,.5); padding:16px; display:flex; flex-direction:column; gap:12px; }
            .mh-gm-err-popup-head { display:flex; align-items:center; gap:9px; color:#fecaca; font-size:16px; font-weight:900; }
            .mh-gm-err-popup-head .mh-gm-err-ico { font-size:20px; }
            .mh-gm-err-popup-close { margin-left:auto; border:0; background:rgba(255,255,255,.08); color:#cbd5e1; border-radius:8px; width:30px; height:30px; display:grid; place-items:center; cursor:pointer; font-size:16px; flex:0 0 auto; }
            .mh-gm-err-popup-close:hover { background:rgba(255,255,255,.16); color:#fff; }
            .mh-gm-err-popup-sub { color:#fca5a5; font-size:12.5px; line-height:1.5; }
            .mh-gm-err-list { overflow:auto; display:flex; flex-direction:column; gap:8px; -webkit-overflow-scrolling:touch; }
            .mh-gm-err-item { border:1px solid rgba(248,113,113,.28); border-radius:10px; background:rgba(0,0,0,.28); padding:9px 11px; }
            .mh-gm-err-item-msg { color:#fecaca; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
            .mh-gm-err-item-loc { margin-top:4px; color:#94a3b8; font-size:11px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; word-break:break-word; }
            .mh-gm-err-item-count { display:inline-block; margin-left:6px; padding:0 6px; border-radius:6px; background:rgba(248,113,113,.22); color:#fecaca; font-size:10px; font-weight:800; }
            .mh-gm-err-actions { display:flex; gap:8px; }
            .mh-gm-err-actions button { flex:1; border:0; border-radius:10px; padding:11px 12px; font-size:14px; font-weight:900; cursor:pointer; }
            .mh-gm-err-dismiss { background:rgba(255,255,255,.08); color:#cbd5e1; flex:0 0 auto; min-width:90px; }
            .mh-gm-err-dismiss:hover { background:rgba(255,255,255,.16); }
            .mh-gm-err-fix { background:linear-gradient(135deg,#ef4444,#f97316); color:#fff; }
            .mh-gm-err-fix:hover { filter:brightness(1.08); }

            /* Floating error badge shown over the preview when errors are cached. */
            .mh-gm-err-badge { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); z-index:6; display:none; align-items:center; gap:7px; padding:8px 14px; border-radius:999px; background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 6px 20px rgba(239,68,68,.45); border:0; animation:mhGmErrBadgeIn .2s ease; }
            .mh-gm-err-badge.show { display:inline-flex; }
            .mh-gm-err-badge:hover { filter:brightness(1.08); }
            .mh-gm-err-badge:active { transform:translateX(-50%) scale(.96); }
            @keyframes mhGmErrBadgeIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

            @media (min-width: 860px) {
                /* 桌面端隐藏标签切换，但保留刷新按钮浮在预览区右上角。 */
                .mh-gm-tabbar { display:block; position:relative; height:0; overflow:visible; border:0; background:none; }
                .mh-gm-tabbar button[data-mh-gm-pane] { display:none; }
                .mh-gm-tabbar .mh-gm-preview-refresh { display:none; top:8px; right:12px; transform:none; }
                .mh-gm-tabbar.has-preview .mh-gm-preview-refresh { display:grid; }
                .mh-gm-tabbar .mh-gm-preview-refresh:active { transform:scale(.94); }
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
                <button type="button" class="mh-gm-preview-refresh" id="mhGmPreviewRefresh" title="${escapeHtml(t('mgGamePreviewRefresh'))}" aria-label="${escapeHtml(t('mgGamePreviewRefresh'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
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
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
                        <button type="button" class="mh-gm-err-badge" id="mhGmErrBadge" aria-label="${escapeHtml(t('mgGameRuntimeErrTitle'))}">
                            <span aria-hidden="true">⚠️</span>
                            <span id="mhGmErrBadgeText"></span>
                        </button>
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
    const errBadge = $('mhGmErrBadge');
    const errBadgeText = $('mhGmErrBadgeText');
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
    // 记住被用户展开的正文段（key=`${msgIdx}-${segIdx}`），跨重渲染保持展开状态。
    const expandedTextSegs = new Set();

    // 收尾时把最终正文写回交错段落：用最终文本替换「最后一个文本段」，
    // 收尾时确保完成态有可显示的正文段。
    // 关键：流式期间各文本段已按真实顺序写入 segments（且与工具调用交错），
    // 因此【不要】用「全量拼接 reply」覆盖最后一段（那会把整段历史重复塞进末尾，造成重影）。
    // 仅当：完全没有任何文本段（例如只有工具调用、或非流式一次性返回）时，才补一个文本段兜底。
    function finalizeSegmentsText(aiMsg, finalText) {
        if (!aiMsg) return;
        if (!Array.isArray(aiMsg.segments)) aiMsg.segments = [];
        const segs = aiMsg.segments;
        const hasText = segs.some(s => s?.type === 'text' && String(s.text || '').trim());
        if (hasText) return; // 已有交错文本段，保持原样，避免重复。
        const value = String(finalText || '');
        if (value) segs.push({ type: 'text', text: value });
    }
    
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

    // ---------- 历史会话（仅本地 IndexedDB，永久保存在用户本机） ----------

    // 判断当前会话是否「值得保存」：必须至少有一条用户真实输入。
    // 用户什么都没输入时（哪怕已经载入了已有游戏的 HTML）一律不保存，避免产生空历史。
    function sessionHasContent() {
        return messages.some(m => m && m.role === 'user' && String(m.text || '').trim());
    }

    // 历史标题：取「最后一条用户输入」的文本（去首尾空白），作为这条会话的标题。
    function sessionTitleFromMessages() {
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m && m.role === 'user') {
                const text = String(m.text || '').trim();
                if (text) return text.slice(0, 60);
            }
        }
        return '';
    }

    // 把「当前这一轮结束时」的状态保存为历史快照。
    // - 本轮有代码改动（创建/替换文件等）：新建一条独立历史项。
    // - 本轮没有任何代码改动：并入「上一条」历史项（更新其对话/代码/标题/时间），不新增条目。
    // htmlBefore：本轮开始前的完整游戏代码，用于点击用户气泡分叉时精确还原。
    async function saveRoundSnapshot({ codeChanged = true, htmlBefore = '' } = {}) {
        if (!sessionHasContent()) return;
        const title = sessionTitleFromMessages()
            || extractHtmlTitle(currentHtml)
            || (gameName || '').trim()
            || t('mgGameHistoryUntitled');
        let snapshotId;
        let snapshotHtmlBefore;
        if (codeChanged || !lastSnapshotId) {
            // 有代码改动（或还没有任何快照）：新建一条独立历史项。
            snapshotId = `${chatId}-r${++roundCounter}`;
            lastSnapshotId = snapshotId;
            // 新快照：记录本轮开始前的代码作为该快照的「分叉前状态」。
            snapshotHtmlBefore = htmlBefore || '';
            lastSnapshotHtmlBefore = snapshotHtmlBefore;
        } else {
            // 无代码改动：并入上一条历史项，沿用其原有的「分叉前状态」（指向该组第一条消息之前）。
            snapshotId = lastSnapshotId;
            snapshotHtmlBefore = lastSnapshotHtmlBefore || '';
        }
        // 记录「本轮的用户消息 → 它产生的快照 id / 分叉前代码」映射，供点击用户气泡回退/分叉时复用历史恢复逻辑。
        // 取这条快照里最后一条用户消息打标。
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i] && messages[i].role === 'user') {
                messages[i]._snapshotId = snapshotId;
                messages[i]._htmlBefore = snapshotHtmlBefore;
                break;
            }
        }
        await saveLocalSession(snapshotId, title, messages, currentHtml, savedPath, currentGameKey(), snapshotHtmlBefore);
    }

    // 用户手动改了代码（文件弹窗编辑 / 设置里的游戏配置·美术资源）：
    //   - 已有「上一条」历史项：把改动并入它——只更新其 html / 时间，保留原有对话与标题，不新增条目。
    //   - 还没有任何历史项：新建一条独立的「手动编辑」历史快照，确保这次改动可被还原。
    // htmlBefore：本次编辑前的完整代码，作为新建快照的「分叉前状态」（仅在新建时使用）。
    async function mergeManualCodeIntoLastSnapshot(htmlBefore = '') {
        try {
            if (lastSnapshotId) {
                const prev = await getLocalSession(lastSnapshotId);
                if (prev) {
                    await saveLocalSession(
                        lastSnapshotId,
                        prev.title || sessionTitleFromMessages() || extractHtmlTitle(currentHtml) || t('mgGameHistoryUntitled'),
                        Array.isArray(prev.messages) ? prev.messages : messages,
                        currentHtml,
                        savedPath,
                        currentGameKey(),
                        (typeof prev.htmlBefore === 'string') ? prev.htmlBefore : (htmlBefore || '')
                    );
                    return;
                }
            }
            // 没有可并入的快照：仅当确有代码时，新建一条独立的「手动编辑」历史项。
            if (!currentHtml.trim()) return;
            const snapshotId = `${chatId}-r${++roundCounter}`;
            lastSnapshotId = snapshotId;
            lastSnapshotHtmlBefore = htmlBefore || '';
            const title = sessionTitleFromMessages()
                || extractHtmlTitle(currentHtml)
                || (gameName || '').trim()
                || t('mgGameHistoryUntitled');
            await saveLocalSession(
                snapshotId,
                title,
                messages,
                currentHtml,
                savedPath,
                currentGameKey(),
                lastSnapshotHtmlBefore
            );
        } catch (e) { console.warn('[game-maker] merge manual code failed', e); }
    }

    async function refreshHistoryRows() {
        historyRows = await listLocalSessions(currentGameKey(), savedPath);
    }

    // 头部：标题 + （有记录时）清空全部按钮。
    const historyHeader = (showClear = false) => `<div class="mh-gm-history-head">
        <span>${escapeHtml(t('mgGameHistoryLabel'))}</span>
        ${showClear ? `<button type="button" class="mh-gm-history-clear" data-mh-gm-history-clear="1" title="${escapeHtml(t('mgGameHistoryClear'))}">${escapeHtml(t('mgGameHistoryClear'))}</button>` : ''}
    </div>`;

    // 加载中占位：保证弹层一打开就立刻有内容（即使数据还没读出来）。
    function renderHistoryLoading() {
        if (!historyPop) return;
        historyPop.innerHTML = `${historyHeader(false)}<div class="mh-gm-history-empty">${escapeHtml(t('mgGameHistoryLoading'))}</div>`;
    }

    function renderHistoryPop() {
        if (!historyPop) return;
        if (!historyRows.length) {
            historyPop.innerHTML = `${historyHeader(false)}<div class="mh-gm-history-empty">${escapeHtml(t('mgGameHistoryEmpty'))}</div>`;
            return;
        }
        const items = historyRows.map((row) => {
            const title = (row?.title || '').trim() || t('mgGameHistoryUntitled');
            // 当前会话产生的快照（id 以 `${chatId}-r` 开头）标为活动态。
            const active = String(row?.chatId || '').startsWith(`${chatId}-r`) ? ' active' : '';
            const when = formatHistoryTime(row?.updatedAt);
            const cid = escapeHtml(String(row?.chatId || ''));
            return `<div class="mh-gm-history-row${active}">
                <button type="button" class="mh-gm-history-item" data-mh-gm-chatid="${cid}" title="${escapeHtml(title)}">
                    <span class="mh-gm-history-dot" aria-hidden="true"></span>
                    <span class="mh-gm-history-text">
                        <span class="mh-gm-history-title">${escapeHtml(title)}</span>
                        ${when ? `<span class="mh-gm-history-time">${escapeHtml(when)}</span>` : ''}
                    </span>
                </button>
                <button type="button" class="mh-gm-history-del" data-mh-gm-history-del="${cid}" title="${escapeHtml(t('mgGameHistoryDelete'))}" aria-label="${escapeHtml(t('mgGameHistoryDelete'))}">🗑️</button>
            </div>`;
        }).join('');
        historyPop.innerHTML = historyHeader(true) + items;
    }

    // 删除单条历史会话（保留弹层打开，刷新列表）。
    async function deleteHistoryRow(cid) {
        if (!cid) return;
        await deleteLocalSession(cid);
        await refreshHistoryRows();
        if (historyOpen) renderHistoryPop();
        showToast(t('mgGameHistoryDeleted'), 'info', 1000);
    }

    // 清空当前游戏的全部历史会话。
    async function clearHistoryAll() {
        const ok = await gameConfirm(t('mgGameHistoryClearConfirm'));
        if (!ok) return;
        await clearLocalSessions(currentGameKey(), savedPath);
        await refreshHistoryRows();
        if (historyOpen) renderHistoryPop();
        showToast(t('mgGameHistoryCleared'), 'info', 1200);
    }

    function closeHistoryPop() {
        historyOpen = false;
        if (historyPop) historyPop.classList.remove('open');
    }

    async function toggleHistoryPop() {
        historyOpen = !historyOpen;
        if (!historyOpen) { closeHistoryPop(); return; }
        // 关键：先同步把窗口显示出来并填充占位内容，确保「点了就有窗口」，
        // 不依赖后续任何异步（IndexedDB 慢/空/不可用时也至少能看到空状态）。
        if (historyPop) {
            historyPop.classList.add('open');
            renderHistoryLoading();
        }
        try {
            // 每一轮在完成时已各自存档，这里直接刷新列表即可。
            await refreshHistoryRows();
        } catch (e) {
            console.warn('[game-maker] load history failed', e);
            historyRows = [];
        }
        // 若用户在加载期间已关闭弹层，则不再覆盖内容。
        if (historyOpen) renderHistoryPop();
    }

    // 载入一条历史快照：完整还原到该轮结束时的对话气泡与游戏代码。
    // 由于每条快照都是不可变的，这里恢复后会开启一段全新的「续写」会话，
    // 之后再对话产生的新轮次会作为新的历史项保存，不会覆盖被恢复的那条快照。
    async function loadHistoryRow(row) {
        if (!row) return;
        abortController?.abort();
        // 从本地按快照 id 读取完整数据。
        const localData = await getLocalSession(row.chatId);
        messages.length = 0;
        currentHtml = '';
        if (localData && Array.isArray(localData.messages)) {
            for (const m of localData.messages) {
                if (!m || m.role === 'system') continue;
                if (m.role === 'user') {
                    messages.push({ role: 'user', text: m.text || '', images: Array.isArray(m.images) ? m.images : [] });
                } else if (m.role === 'ai' || m.role === 'assistant') {
                    const { segments, toolCalls } = reviveSegments(m);
                    messages.push({ role: 'ai', text: m.text || '', reasoning: m.reasoning || '', editLink: !!m.editLink, toolCalls, segments });
                }
            }
            currentHtml = localData.html || '';
        }
        // 重新挂载内存标记：把这条快照的 id 与「分叉前代码」记到它最后一条用户消息上，
        // 以便从被恢复的气泡再次点击分叉时也能正确还原（内存标记在存档时会被丢弃）。
        const restoredHtmlBefore = (localData && typeof localData.htmlBefore === 'string') ? localData.htmlBefore : '';
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i] && messages[i].role === 'user') {
                messages[i]._snapshotId = row.chatId;
                messages[i]._htmlBefore = restoredHtmlBefore;
                break;
            }
        }
        // 开启全新续写会话：后续新轮次作为新历史项，不覆盖该快照。
        chatId = `game-maker-${Date.now()}`;
        roundCounter = 0;
        lastSnapshotId = '';
        lastSnapshotHtmlBefore = '';
        const title = localData?.title || row.title;
        if (title && !gameName.trim()) {
            gameName = String(title).slice(0, 24);
            if (nameEl) nameEl.value = gameName;
        }
        // 还原界面：对话 + 完整游戏代码预览。
        renderMessages();
        setPreview(currentHtml);
        closeHistoryPop();
        switchPane('chat');
        showToast(t('mgGameHistoryRestored'), 'success', 1200);
    }

    // 把这条用户消息原文填回输入框（光标移到末尾），便于修改后从此处重新发送（分叉）。
    function fillInputForFork(text) {
        if (!inputEl) return;
        inputEl.value = text;
        autoResize();
        inputEl.focus();
        try { inputEl.setSelectionRange(text.length, text.length); } catch (_) {}
    }

    // 点击某条用户消息气泡：回退/分叉（fork）到「发送这条消息之前」的状态。
    // 实现上直接复用历史恢复逻辑：每条用户消息发送完成时（saveRoundSnapshot）都会被打上
    // 它所产生的历史快照 id（`_snapshotId`）。要回到「发送这条消息之前」，就等价于恢复
    // 「上一条用户消息对应的那条历史快照」——直接调用 loadHistoryRow 即可（对话+代码与历史完全一致）。
    // 若这条已是最早的一条用户消息（没有更早的快照），则回退到「游戏初始/空白」状态。
    async function forkFromUserMessage(idx) {
        if (generating) return; // 生成中不允许回退，避免状态错乱。
        const msg = messages[idx];
        if (!msg || msg.role !== 'user') return;
        const ok = await gameConfirm(t('mgGameForkConfirm'));
        if (!ok) return;
        const forkText = String(msg.text || '');

        // 找「这条消息之前」最近一条带历史快照 id 的用户消息。
        // 注意：无代码改动的轮次会并入上一条快照，导致相邻用户消息共享同一个 _snapshotId。
        // 必须跳过与「这条消息自身快照」相同的 id（那条快照里其实包含了这条消息），
        // 继续往前找到一个真正更早、不含这条消息的快照。
        const ownSnapshotId = msg._snapshotId || '';
        let prevSnapshotId = '';
        for (let i = idx - 1; i >= 0; i--) {
            const prev = messages[i];
            if (prev && prev.role === 'user' && prev._snapshotId && prev._snapshotId !== ownSnapshotId) {
                prevSnapshotId = prev._snapshotId;
                break;
            }
        }

        if (prevSnapshotId) {
            // 复用历史恢复：完整还原到上一条快照（对话气泡 + 完整游戏代码），并开启新的续写会话。
            await loadHistoryRow({ chatId: prevSnapshotId });
            fillInputForFork(forkText);
            showToast(t('mgGameForkDone'), 'success', 1400);
            return;
        }

        // 没有可复用的更早快照（最早的一条用户消息，或相邻消息共享同一快照导致找不到更早的）：
        // 回退到「发送这条消息之前」的代码状态。优先用这条消息自身记录的 htmlBefore（精确的
        // 分叉前代码）；找不到时（如旧记录/被恢复后丢失内存标记）再从本地快照里取该快照的
        // htmlBefore；仍取不到才回退到空白。这样可避免「分叉后 game.html 变空」的问题。
        abortController?.abort();
        let beforeHtml = (typeof msg._htmlBefore === 'string') ? msg._htmlBefore : undefined;
        if (beforeHtml === undefined && ownSnapshotId) {
            try {
                const snap = await getLocalSession(ownSnapshotId);
                if (snap && typeof snap.htmlBefore === 'string') beforeHtml = snap.htmlBefore;
            } catch (_) {}
        }
        // 保留这条消息之前的非用户开场内容（如编辑欢迎语），其余清空。
        messages.length = idx;
        currentHtml = beforeHtml || '';
        chatId = `game-maker-${Date.now()}`;
        roundCounter = 0;
        lastSnapshotId = '';
        lastSnapshotHtmlBefore = '';
        setPreview(currentHtml);
        renderMessages();
        switchPane('chat');
        fillInputForFork(forkText);
        showToast(t('mgGameForkDone'), 'success', 1400);
    }

    // 新建会话：恢复到“游戏刚加载”的初始状态（历史已按轮次各自保存，无需在此存档）。
    // 已有游戏文件时保留游戏与预览，并重新显示编辑欢迎语（而不是清空成全新建游戏界面）。
    async function startNewSession() {
        abortController?.abort();
        chatId = `game-maker-${Date.now()}`;
        roundCounter = 0;
        lastSnapshotId = '';
        lastSnapshotHtmlBefore = '';
        messages.length = 0;
        // 保留当前游戏文件作为后续迭代的起点，仅重置对话/工具历史。
        const hasGame = !!(currentHtml && currentHtml.trim());
        if (hasGame) {
            // 与初始加载一致：已有游戏时显示编辑欢迎语（游戏名为可点击链接）。
            messages.push({ role: 'ai', text: t('mgGameEditWelcome', { title: gameName || t('mgDefaultName') }), editLink: true });
        }
        renderMessages();
        setPreview(currentHtml);
        closeHistoryPop();
        switchPane('chat');
        showToast(t('mgGameNewSessionDone'), 'info', 1200);
    }

    function scrollMsgsToEnd() {
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
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

    // 把编辑欢迎语里的游戏名（中文《…》或英文 "…"）渲染成可点击的下划线链接。
    // 其余文本仍走 escapeHtml，避免 XSS。点击链接会触发 [data-mh-gm-file-link] 事件。
    function renderEditLinkText(text) {
        const raw = String(text || '');
        const match = raw.match(/《[^》]*》|"[^"]*"/);
        if (!match) return escapeHtml(raw);
        const start = match.index;
        const end = start + match[0].length;
        const before = escapeHtml(raw.slice(0, start));
        const title = escapeHtml(match[0]);
        const after = escapeHtml(raw.slice(end));
        const linkTitle = escapeHtml(t('mgGameFileLinkTitle'));
        return `${before}<span class="mh-gm-file-link" role="button" tabindex="0" data-mh-gm-file-link="1" title="${linkTitle}">${title}</span>${after}`;
    }

    function renderMessages() {
        if (!msgsEl) return;
        if (!messages.length) {
            msgsEl.innerHTML = `
                <div class="mh-gm-welcome">
                    <div class="mh-gm-welcome-star" aria-hidden="true">✨</div>
                    <div class="mh-gm-welcome-title">${escapeHtml(t('mgGameWelcomeTitle'))}</div>
                    <div class="mh-gm-welcome-sub">${escapeHtml(t('mgGameInspireHint'))}</div>
                    <button type="button" class="mh-gm-inspire" data-mh-gm-inspire="1">${escapeHtml(t('mgGameInspire'))}</button>
                    <div class="mh-gm-welcome-or">${escapeHtml(t('mgGameInspireOr'))}</div>
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
            
            // 推理内容内联显示：流式生成时实时展示模型的思考过程，让用户了解进展。
            // 仅当确有规整后的推理文本时才渲染面板，避免空内容撑出大块空白。
            if (m.role === 'ai' && m.reasoning) {
                const reasoningText = normalizeReasoningText(m.reasoning);
                if (reasoningText) {
                    const live = !!(m.pending || m.streaming);
                    // 思考阶段默认展开；完成后保留用户的折叠选择（默认折叠）。
                    const collapsed = live ? false : (m.reasoningCollapsed !== false);
                    const headLabel = (live && m.thinking) ? t('mgGameThinking') : t('mgGameThinkingDone');
                    // 折叠时不渲染 body 元素，确保面板只剩标题行、无任何空白区域。
                    const bodyHtml = collapsed
                        ? ''
                        : `<div class="mh-gm-reasoning-body" data-mh-gm-reasoning-body="${idx}">${escapeHtml(reasoningText)}</div>`;
                    // 标签紧凑拼接，不留换行/缩进，避免被气泡的 pre-wrap 渲染成空白行。
                    body += `<div class="mh-gm-reasoning${live ? ' is-live' : ''}${collapsed ? ' is-collapsed' : ''}" data-mh-gm-reasoning-msg="${idx}"><div class="mh-gm-reasoning-head" data-mh-gm-reasoning-toggle="${idx}"><span class="mh-gm-reasoning-ico" aria-hidden="true">💭</span><span>${escapeHtml(headLabel)}</span><span class="mh-gm-reasoning-caret" aria-hidden="true">▾</span></div>${bodyHtml}</div>`;
                }
            }

            // 交错渲染：正文段(text)与工具调用段(tool)按它们被流式接收的真实顺序排列，
            // 而不是「所有工具调用在前、正文在后」。每个文本段独立渲染为可滚动/展开的块。
            const live = !!(m.pending || m.streaming);
            const renderToolChip = (tool) => {
                const status = tool?.status || 'running';
                const icon = status === 'error' ? '⚠️' : (status === 'done' ? '✅' : '🔧');
                const label = status === 'error' ? 'failed' : (status === 'done' ? 'done' : 'running');
                const human = toolChipLabel(tool);
                // 用工具自身的 id 定位（点击详情时回到 m.toolCalls 里查找），避免下标错位。
                const toolIdx = Array.isArray(m.toolCalls) ? m.toolCalls.findIndex(c => c === tool || (tool?.id && c?.id === tool.id)) : -1;
                return `<div class="mh-gm-toolcalls mh-gm-toolcalls-seg"><button type="button" class="mh-gm-toolchip status-${escapeHtml(status)}" data-mh-gm-tool-msg="${idx}" data-mh-gm-tool-idx="${toolIdx}" title="${escapeHtml(human.text)}">
                    <span>${icon}</span><span class="mh-gm-toolchip-name">${human.html}</span><span class="mh-gm-toolchip-status">${escapeHtml(label)}</span>
                </button></div>`;
            };
            // 渲染一个正文段：可滚动（内容过长时出现滚动条），并提供「展开/收起」按钮。
            // showDots=true 时在正文下方另起一行追加三点动画（仅用于最后一个正在生成的文本段）。
            const renderTextSegment = (segText, segKey, showDots) => {
                // 规整空白，避免 pre-wrap 把模型多余的换行渲染成大片空白：
                //   1) 统一换行符；
                //   2) 行尾空格清掉；
                //   3) 把每一行 trim 后丢弃首尾的空行，并将中间「2+ 连续空行」折叠成 1 个空行。
                const rawLines = String(segText || '')
                    .replace(/\r\n?/g, '\n')
                    .replace(/[ \t]+$/gm, '')
                    .split('\n');
                // 去掉开头/结尾的空行。
                while (rawLines.length && rawLines[0].trim() === '') rawLines.shift();
                while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();
                // 折叠中间连续空行为最多 1 个。
                const lines = [];
                let prevBlank = false;
                for (const ln of rawLines) {
                    const blank = ln.trim() === '';
                    if (blank && prevBlank) continue;
                    lines.push(ln);
                    prevBlank = blank;
                }
                const value = lines.join('\n');
                if (!value && !showDots) return '';
                // 流式进行中时，在正文下方另起一行显示三点动画（替代过弱的闪烁光标）。
                const dots = showDots ? '<span class="mh-gm-dots" aria-label="…"><span></span><span></span><span></span></span>' : '';
                // 基础 Markdown 渲染（带记忆化缓存）：行内代码/加粗/斜体、代码围栏、有/无序列表。
                const inner = `${renderBasicMarkdownCached(value)}${dots}`;
                const expanded = expandedTextSegs.has(segKey);
                const toggleTitle = escapeHtml(expanded ? t('mgGameTextCollapse') : t('mgGameTextExpand'));
                return `<div class="mh-gm-textseg${expanded ? ' is-expanded' : ''}" data-mh-gm-textseg="${escapeHtml(segKey)}">
                    <div class="mh-gm-textseg-body">${inner}</div>
                    <button type="button" class="mh-gm-textseg-toggle" data-mh-gm-textseg-toggle="${escapeHtml(segKey)}" title="${toggleTitle}" aria-label="${toggleTitle}" hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                </div>`;
            };

            if (m.role === 'ai' && Array.isArray(m.segments) && m.segments.length) {
                // 末段类型：流式进行中，三点动画只在「整条消息的最末尾」出现一次。
                const lastSegIdx = m.segments.length - 1;
                const lastIsTool = m.segments[lastSegIdx]?.type === 'tool';
                m.segments.forEach((seg, segIdx) => {
                    if (seg.type === 'tool') {
                        body += renderToolChip(seg.tool);
                    } else {
                        // 仅当这是整条消息的最后一段（其后没有工具调用）时，才在该文本段下方追加三点动画。
                        const showDots = live && segIdx === lastSegIdx;
                        body += renderTextSegment(seg.text, `${idx}-${segIdx}`, showDots);
                    }
                });
                // 流式进行中且末尾不是文本段时，在整条消息末尾补一组三点动画：
                //   - 还没有任何段落，或
                //   - 末段是工具调用（其后正在等待下一步输出）。
                // 末段是文本时已由上面的 showDots 承担提示，这里不重复添加，避免出现两组。
                if (live && (!m.segments.length || lastIsTool)) {
                    body += '<span class="mh-gm-dots" aria-label="…"><span></span><span></span><span></span></span>';
                }
            } else if (m.pending) {
                // 还没有正文，但若已有推理内容则不显示加载点（推理面板已表明在思考）。
                if (!m.reasoning) {
                    body += '<span class="mh-gm-dots" aria-label="…"><span></span><span></span><span></span></span>';
                }
            } else if (m.editLink) {
                // 编辑欢迎语：把游戏名（《…》或 "…"）渲染成可点击的下划线链接，点击弹出 game.html 文件窗口。
                body += renderEditLinkText(m.text || '');
            } else {
                // 旧消息（无 segments）或纯文本完成态：直接渲染。
                body += escapeHtml(m.text || '');
            }

            // 「启发我」两步引导返回的可点击建议气泡：
            //   stage 'direction' —— 点方向 → 进入第二步（出具体游戏）；
            //   stage 'game'      —— 点游戏 → 直接开始生成；
            //   末尾「换一批」chip —— 让 AI 在同一步给出更多/不同的选项。
            if (m.role === 'ai' && Array.isArray(m.suggestions) && m.suggestions.length) {
                const isDir = m.inspireStage === 'direction';
                const label = isDir ? t('mgGameDirectionLabel') : t('mgGameSuggestionsLabel');
                const moreLabel = isDir ? t('mgGameDirectionMore') : t('mgGameSuggestMore');
                body += `<div class="mh-gm-suggest-label">${escapeHtml(label)}</div>`;
                body += '<div class="mh-gm-suggest-list">';
                body += m.suggestions.map((s, sIdx) => {
                    const ico = s?.icon ? `<span class="mh-gm-suggest-ico" aria-hidden="true">${escapeHtml(s.icon)}</span>` : '';
                    return `<button type="button" class="mh-gm-suggest" data-mh-gm-suggest="${idx}" data-mh-gm-suggest-idx="${sIdx}">${ico}<span class="mh-gm-suggest-text">${escapeHtml(s?.text || '')}</span></button>`;
                }).join('');
                // 「换一批」chip：弱化样式，区分于普通建议。
                body += `<button type="button" class="mh-gm-suggest mh-gm-suggest-more" data-mh-gm-suggest-more="${idx}"><span class="mh-gm-suggest-text">${escapeHtml(moreLabel)}</span></button>`;
                body += '</div>';
            }

            const liveClass = m.role === 'ai' && (m.pending || m.streaming) ? ' is-live' : '';
            const liveAttr = m.role === 'ai' && (m.pending || m.streaming) ? ` data-mh-gm-stream-msg="${idx}"` : '';
            // 用户气泡可点击：弹出确认框，回退/分叉到「发送这条消息之前」的状态。
            const userForkClass = m.role === 'user' ? ' is-forkable' : '';
            const userForkAttr = m.role === 'user'
                ? ` data-mh-gm-user-msg="${idx}" role="button" tabindex="0" title="${escapeHtml(t('mgGameForkHint'))}"`
                : '';
            return `<div class="mh-gm-msg ${cls}"><div class="mh-gm-bubble ${cls}${liveClass}${userForkClass}"${liveAttr}${userForkAttr}>${body}</div></div>`;
        }).join('');
        // 实时推理面板在流式阶段自动滚到底部，跟随最新思考内容。
        msgsEl.querySelectorAll('.mh-gm-reasoning.is-live .mh-gm-reasoning-body').forEach((el) => {
            el.scrollTop = el.scrollHeight;
        });
        // 正文段：内容超过收起高度时显示「展开/收起」按钮；未展开的流式段自动滚到底部跟随生成。
        msgsEl.querySelectorAll('.mh-gm-textseg').forEach((seg) => {
            const bodyEl = seg.querySelector('.mh-gm-textseg-body');
            const toggle = seg.querySelector('.mh-gm-textseg-toggle');
            if (!bodyEl || !toggle) return;
            const overflowing = bodyEl.scrollHeight - bodyEl.clientHeight > 4;
            const expanded = seg.classList.contains('is-expanded');
            // 溢出，或已展开（需要「收起」按钮）时显示按钮。
            toggle.hidden = !(overflowing || expanded);
            // 收起态且有流式三点动画时，跟随最新内容滚到底部。
            if (!expanded && bodyEl.querySelector('.mh-gm-dots')) {
                bodyEl.scrollTop = bodyEl.scrollHeight;
            }
        });
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
                    <div class="mh-gm-tool-popup-section"><strong>Arguments</strong><pre>${escapeHtml(fullToolDetail(tool.args || ''))}</pre></div>
                    <div class="mh-gm-tool-popup-section"><strong>Result</strong><pre>${escapeHtml(tool.error || tool.detailResult || tool.result || '')}</pre></div>
                </div>
            </div>`;
        panel.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.mh-gm-tool-popup-close')) overlay.remove();
        });
    }

    // 生成行号 gutter 的文本：每行一个序号，与代码行一一对应。
    function buildLineNumbers(text) {
        const n = countLines(text);
        const total = n > 0 ? n : 1;
        let out = '';
        for (let i = 1; i <= total; i++) out += (i === 1 ? '' : '\n') + i;
        return out;
    }

    // 点击工具调用里的 [game.html]（或编辑欢迎语里的游戏名链接）时，弹窗显示当前游戏文件的完整内容。
    // 支持「编辑」：点击后正文变为可编辑文本域，按钮切换为「保存」；保存后写回 currentHtml、刷新预览并持久化。
    // 读/编两种模式都显示行号（左侧 gutter，与代码同步滚动）。
    function showGameFilePopup(fileName = GAME_MAKER_FILE_PATH) {
        document.getElementById('mhGmFilePopup')?.remove();
        const content = (currentHtml && currentHtml.trim()) ? currentHtml : '';
        const lineCount = content ? content.split('\n').length : 0;
        const overlay = document.createElement('div');
        overlay.id = 'mhGmFilePopup';
        overlay.className = 'mh-gm-tool-popup-overlay';
        overlay.innerHTML = `
            <div class="mh-gm-tool-popup" role="dialog" aria-modal="true">
                <div class="mh-gm-tool-popup-head">
                    <span class="mh-gm-file-title">📄 ${escapeHtml(fileName)}${lineCount ? ` · ${lineCount} 行` : ''}</span>
                    <div class="mh-gm-file-popup-actions">
                        <button type="button" class="mh-gm-file-copy" data-mh-gm-file-copy title="${escapeHtml(t('mgGameFilePopupCopy'))}" aria-label="${escapeHtml(t('mgGameFilePopupCopy'))}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                        <button type="button" class="mh-gm-file-edit" data-mh-gm-file-edit>${escapeHtml(t('mgGameFilePopupEdit'))}</button>
                        <button type="button" class="mh-gm-tool-popup-close" aria-label="关闭">×</button>
                    </div>
                </div>
                <div class="mh-gm-tool-popup-body mh-gm-file-popup-body">
                    <div class="mh-gm-tool-popup-section mh-gm-file-section"></div>
                </div>
            </div>`;
        panel.appendChild(overlay);

        const popupEl = overlay.querySelector('.mh-gm-tool-popup');
        const titleEl = overlay.querySelector('.mh-gm-file-title');
        const editBtn = overlay.querySelector('[data-mh-gm-file-edit]');
        const copyBtn = overlay.querySelector('[data-mh-gm-file-copy]');
        const section = overlay.querySelector('.mh-gm-file-section');
        let isEditing = false;

        // 复制全部代码：编辑态优先取 textarea 的实时内容，否则取 currentHtml。
        copyBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ta = section.querySelector('textarea');
            const textToCopy = (ta ? ta.value : currentHtml) || '';
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(textToCopy);
                } else {
                    const tmp = document.createElement('textarea');
                    tmp.value = textToCopy;
                    tmp.style.position = 'fixed';
                    tmp.style.opacity = '0';
                    document.body.appendChild(tmp);
                    tmp.select();
                    document.execCommand('copy');
                    document.body.removeChild(tmp);
                }
                showToast(t('mgGameFilePopupCopied'), 'success', 1200);
            } catch (_) {
                showToast(t('mgGameFilePopupCopyFailed'), 'error', 1600);
            }
        });

        const updateTitle = (text) => {
            const n = text ? String(text).split('\n').length : 0;
            if (titleEl) titleEl.innerHTML = `📄 ${escapeHtml(fileName)}${n ? ` · ${n} 行` : ''}`;
        };

        // 切换读/编模式时锁定弹窗高度，避免 <pre>↔<textarea> 内容差异导致窗口跳动。
        const lockPopupHeight = () => {
            if (popupEl) popupEl.style.height = `${popupEl.getBoundingClientRect().height}px`;
        };

        // 渲染只读视图：左侧行号 gutter + 右侧代码 <pre>，两者随滚动同步。
        const renderReadView = (scrollTop = 0, scrollLeft = 0) => {
            const viewContent = (currentHtml && currentHtml.trim()) ? currentHtml : '';
            const display = viewContent || '(文件为空)';
            section.innerHTML = `
                <div class="mh-gm-code-wrap">
                    <pre class="mh-gm-gutter" aria-hidden="true">${escapeHtml(buildLineNumbers(viewContent))}</pre>
                    <pre class="mh-gm-code">${escapeHtml(display)}</pre>
                </div>`;
            const gutter = section.querySelector('.mh-gm-gutter');
            const code = section.querySelector('.mh-gm-code');
            // 代码区滚动时，行号 gutter 垂直同步。
            code?.addEventListener('scroll', () => { if (gutter) gutter.scrollTop = code.scrollTop; });
            if (code) { code.scrollTop = scrollTop; code.scrollLeft = scrollLeft; }
            if (gutter) gutter.scrollTop = scrollTop;
        };

        // 读视图的滚动容器是 .mh-gm-code（height:100% + overflow:auto）。
        const getReadScroller = () => section.querySelector('.mh-gm-code');

        // 初始为只读视图。
        renderReadView();

        // 进入编辑：换成「行号 gutter + textarea」，按钮变「保存」，并保持高度与滚动位置。
        const enterEdit = () => {
            isEditing = true;
            // 先锁定当前高度，再替换内容，确保窗口尺寸不变。
            lockPopupHeight();
            const reader = getReadScroller();
            const scrollTop = reader ? reader.scrollTop : 0;
            const scrollLeft = reader ? reader.scrollLeft : 0;
            const current = (currentHtml && currentHtml.trim()) ? currentHtml : '';
            section.innerHTML = `
                <div class="mh-gm-code-wrap">
                    <pre class="mh-gm-gutter" aria-hidden="true">${escapeHtml(buildLineNumbers(current))}</pre>
                    <textarea class="mh-gm-file-edit-area mh-gm-code" spellcheck="false"></textarea>
                </div>`;
            const gutter = section.querySelector('.mh-gm-gutter');
            const ta = section.querySelector('textarea');
            if (ta) {
                ta.value = current;
                // 编辑时实时更新行号；textarea 滚动时同步 gutter。
                const refreshGutter = () => { if (gutter) gutter.textContent = buildLineNumbers(ta.value); };
                ta.addEventListener('input', refreshGutter);
                ta.addEventListener('scroll', () => { if (gutter) gutter.scrollTop = ta.scrollTop; });
                // 同步只读视图的滚动位置，让用户在原处继续编辑。
                ta.scrollTop = scrollTop;
                ta.scrollLeft = scrollLeft;
                if (gutter) gutter.scrollTop = scrollTop;
                ta.focus({ preventScroll: true });
                // 光标置于开头，避免 focus 把视图拉到末尾。
                try { ta.setSelectionRange(0, 0); } catch (_) {}
                // focus 后再次校正滚动位置（部分浏览器会重置）。
                ta.scrollTop = scrollTop;
                ta.scrollLeft = scrollLeft;
                if (gutter) gutter.scrollTop = scrollTop;
            }
            if (editBtn) editBtn.textContent = t('mgGameFilePopupSave');
        };

        // 退出编辑（保存）：写回 currentHtml、刷新预览、持久化，并恢复只读视图。
        const saveEdit = async () => {
            const ta = section.querySelector('textarea');
            const next = ta ? ta.value : currentHtml;
            const prev = currentHtml || '';
            // 记录编辑视图的滚动位置，恢复只读视图后保持一致。
            const scrollTop = ta ? ta.scrollTop : 0;
            const scrollLeft = ta ? ta.scrollLeft : 0;
            currentHtml = next;
            isEditing = false;
            // 切回只读视图前同样锁定高度，避免跳动。
            lockPopupHeight();
            setPreview(currentHtml);
            updateTitle(currentHtml);
            renderReadView(scrollTop, scrollLeft);
            if (editBtn) { editBtn.textContent = t('mgGameFilePopupEdit'); editBtn.disabled = true; editBtn.classList.add('is-saving'); }
            try {
                const saved = await persistGame({ silent: true });
                if (saved) showToast(t('mgGameSaved'), 'success', 1200);
                // 用户手动改了代码：并入「上一条」历史项（只更新代码，不新增条目）；
                // 没有历史项时会新建一条独立的「手动编辑」快照，传入改动前代码作为分叉前状态。
                if ((next || '') !== prev) {
                    await mergeManualCodeIntoLastSnapshot(prev);
                }
            } finally {
                if (editBtn) { editBtn.disabled = false; editBtn.classList.remove('is-saving'); }
            }
        };

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isEditing) saveEdit();
            else enterEdit();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.mh-gm-tool-popup-close')) overlay.remove();
        });
    }

    // ---------- 预览运行时错误捕获 ----------
    // 缓存最近的运行时错误（按消息去重），最多保留 3 条用于展示与 AI 修复。
    let runtimeErrors = []; // { message, source, line, col, stack, count }
    const ERR_FRAME_TOKEN = `mhgm-${Date.now().toString(36)}`;

    // 注入到预览 HTML 中的错误捕获脚本：window.onerror / unhandledrejection /
    // console.error 都通过 postMessage 上报给父窗口。沙箱 iframe 下这是最可靠的方式。
    function buildErrorCaptureScript() {
        return `<script>(function(){
            var TOKEN='${ERR_FRAME_TOKEN}';
            function post(payload){ try{ parent.postMessage(Object.assign({__mhGmError:true,token:TOKEN},payload),'*'); }catch(e){} }
            window.addEventListener('error',function(e){
                if(e&&e.message){ post({message:String(e.message),source:String(e.filename||''),line:e.lineno||0,col:e.colno||0,stack:(e.error&&e.error.stack)?String(e.error.stack):''}); }
                else if(e&&e.target&&(e.target.src||e.target.href)){ post({message:'Failed to load resource: '+(e.target.src||e.target.href),source:String(e.target.src||e.target.href||''),line:0,col:0,stack:''}); }
            },true);
            window.addEventListener('unhandledrejection',function(e){
                var r=e&&e.reason; var msg=(r&&r.message)?r.message:String(r); post({message:'Unhandled promise rejection: '+msg,source:'',line:0,col:0,stack:(r&&r.stack)?String(r.stack):''});
            });
            var _err=console.error; console.error=function(){ try{ var parts=[].slice.call(arguments).map(function(a){ return (a&&a.stack)?a.stack:(typeof a==='object'?JSON.stringify(a):String(a)); }); post({message:parts.join(' '),source:'console.error',line:0,col:0,stack:''}); }catch(_){ } return _err.apply(console,arguments); };
        })();<\/script>`;
    }

    // 将捕获脚本注入 HTML 文档（优先放入 <head> 开头，确保早于游戏脚本执行）。
    function injectErrorCapture(html) {
        if (!html) return html;
        const script = buildErrorCaptureScript();
        if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${script}`);
        if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>${script}`);
        return script + html;
    }

    function setPreview(html) {
        if (!previewFrame) return;
        const tabbar = panel.querySelector('.mh-gm-tabbar');
        const hasContent = !!(html && html.trim());
        // 每次重新加载预览都清空旧的运行时错误。
        clearRuntimeErrors();
        if (hasContent) {
            previewFrame.srcdoc = injectErrorCapture(html);
            if (previewEmpty) previewEmpty.style.display = 'none';
        } else {
            previewFrame.removeAttribute('srcdoc');
            if (previewEmpty) previewEmpty.style.display = 'flex';
        }
        // 仅在有内容时允许显示刷新按钮（具体显隐由 CSS 结合当前激活面板决定）。
        if (tabbar) tabbar.classList.toggle('has-preview', hasContent);
    }

    // 强制重新加载预览 iframe（即使 HTML 未变化，也重置游戏状态）。
    function reloadPreview() {
        if (!previewFrame) return;
        const refreshBtn = $('mhGmPreviewRefresh');
        if (refreshBtn) {
            refreshBtn.classList.remove('is-spin');
            // 触发重排后再加动画类，确保每次点击都重新播放旋转动画。
            void refreshBtn.offsetWidth;
            refreshBtn.classList.add('is-spin');
        }
        // 重新加载时清空旧错误，重新收集。
        clearRuntimeErrors();
        if (currentHtml && currentHtml.trim()) {
            // 清空再重设 srcdoc 才能在内容相同时强制 iframe 重新渲染。
            previewFrame.removeAttribute('srcdoc');
            // 下一帧重新赋值，确保浏览器识别为变化。
            requestAnimationFrame(() => { previewFrame.srcdoc = injectErrorCapture(currentHtml); });
            if (previewEmpty) previewEmpty.style.display = 'none';
        } else {
            setPreview('');
        }
    }

    // 清空缓存的运行时错误并隐藏角标/弹窗。
    function clearRuntimeErrors() {
        runtimeErrors = [];
        _errAutoShown = false;
        updateErrBadge();
        $('mhGmErrPopup')?.remove();
    }

    // 更新预览区底部的错误角标显隐与计数文案。
    function updateErrBadge() {
        if (!errBadge) return;
        const total = runtimeErrors.reduce((n, e) => n + (e.count || 1), 0);
        if (total > 0) {
            errBadge.classList.add('show');
            if (errBadgeText) errBadgeText.textContent = t('mgGameRuntimeErrBadge', { count: total });
        } else {
            errBadge.classList.remove('show');
        }
    }

    // 记录一条运行时错误：相同 message 合并计数，最多保留前 3 条。
    function recordRuntimeError(err) {
        if (!err || !err.message) return;
        const message = String(err.message).slice(0, 800);
        const existing = runtimeErrors.find(e => e.message === message);
        if (existing) {
            existing.count = (existing.count || 1) + 1;
        } else {
            if (runtimeErrors.length >= 3) return; // 仅缓存前 3 条不同错误。
            runtimeErrors.push({
                message,
                source: String(err.source || '').slice(0, 300),
                line: err.line || 0,
                col: err.col || 0,
                stack: String(err.stack || '').slice(0, 1200),
                count: 1,
            });
        }
        updateErrBadge();
        // 自动弹出一次（首条错误出现时），之后用户可通过角标再次打开。
        if (!_errAutoShown && runtimeErrors.length) {
            _errAutoShown = true;
            showErrorPopup();
        }
    }
    let _errAutoShown = false;

    // 监听来自预览 iframe 的消息：
    //   1) 宠物形象请求（haqi_get_pet_image(s)）——复用 view_minigames 的处理逻辑，
    //      让创作工坊里预览的游戏也能像正式 minigame 一样拿到宠物图像；
    //   2) 运行时错误上报（__mhGmError）。
    const onPreviewError = (e) => {
        // 仅响应本预览 iframe 发来的消息，避免跨窗口误处理。
        if (previewFrame && e?.source === previewFrame.contentWindow) {
            // 宠物形象请求：交由共享处理器回复 haqi_pet_image(s)。
            if (handleMinigamePetMessage(previewFrame, e.data || {})) return;
        }
        const d = e?.data;
        if (!d || d.__mhGmError !== true || d.token !== ERR_FRAME_TOKEN) return;
        recordRuntimeError(d);
    };
    window.addEventListener('message', onPreviewError);

    // 预览 iframe 每次加载完成后，主动推送一次当前宠物配置（setGameConfig + active_pet_config 形象），
    // 与正式 minigame 播放一致：游戏无需先发请求即可拿到宠物形象。
    const onPreviewLoad = () => {
        if (!previewFrame || !currentHtml || !currentHtml.trim()) return;
        try { pushActivePetConfigToFrame(previewFrame); } catch (_) {}
    };
    previewFrame?.addEventListener('load', onPreviewLoad);

    // 将缓存的错误格式化为给 AI 的纯文本描述。
    function formatErrorsForPrompt() {
        return runtimeErrors.map((e, i) => {
            const loc = e.source ? `\n  at ${e.source}${e.line ? `:${e.line}${e.col ? `:${e.col}` : ''}` : ''}` : '';
            const stack = e.stack ? `\n  ${e.stack.split('\n').slice(0, 4).join('\n  ')}` : '';
            return `${i + 1}. ${e.message}${loc}${stack}`;
        }).join('\n\n');
    }

    // 错误弹窗 UI。
    function showErrorPopup() {
        $('mhGmErrPopup')?.remove();
        if (!runtimeErrors.length) return;
        const overlay = document.createElement('div');
        overlay.id = 'mhGmErrPopup';
        overlay.className = 'mh-gm-err-popup-overlay';
        const itemsHtml = runtimeErrors.map(e => {
            const loc = e.source ? `<div class="mh-gm-err-item-loc">${escapeHtml(e.source)}${e.line ? `:${e.line}${e.col ? `:${e.col}` : ''}` : ''}</div>` : '';
            const count = (e.count || 1) > 1 ? `<span class="mh-gm-err-item-count">×${e.count}</span>` : '';
            return `<div class="mh-gm-err-item"><div class="mh-gm-err-item-msg">${escapeHtml(e.message)}${count}</div>${loc}</div>`;
        }).join('');
        overlay.innerHTML = `
            <div class="mh-gm-err-popup" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('mgGameRuntimeErrTitle'))}">
                <div class="mh-gm-err-popup-head">
                    <span class="mh-gm-err-ico" aria-hidden="true">⚠️</span>
                    <span>${escapeHtml(t('mgGameRuntimeErrTitle'))}</span>
                    <button type="button" class="mh-gm-err-popup-close" aria-label="${escapeHtml(t('mgGameRuntimeErrDismiss'))}">×</button>
                </div>
                <div class="mh-gm-err-popup-sub">${escapeHtml(t('mgGameRuntimeErrSub'))}</div>
                <div class="mh-gm-err-list">${itemsHtml}</div>
                <div class="mh-gm-err-actions">
                    <button type="button" class="mh-gm-err-dismiss">${escapeHtml(t('mgGameRuntimeErrDismiss'))}</button>
                    <button type="button" class="mh-gm-err-fix">${escapeHtml(t('mgGameRuntimeErrFix'))}</button>
                </div>
            </div>`;
        panel.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
        overlay.querySelector('.mh-gm-err-popup-close')?.addEventListener('click', close);
        overlay.querySelector('.mh-gm-err-dismiss')?.addEventListener('click', close);
        overlay.querySelector('.mh-gm-err-fix')?.addEventListener('click', () => {
            const errorsText = formatErrorsForPrompt();
            close();
            // 切换到对话面板并自动发起修复请求。
            switchPane('chat');
            if (!generating) handleSend(t('mgGameRuntimeErrFixPrompt', { errors: errorsText }));
        });
    }

    function switchPane(pane) {
        activePane = pane === 'preview' ? 'preview' : 'chat';
        panel.querySelectorAll('[data-mh-gm-pane]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mhGmPane === activePane);
        });
        panel.querySelectorAll('[data-mh-gm-pane-body]').forEach(body => {
            body.classList.toggle('active', body.dataset.mhGmPaneBody === activePane);
        });
        // 移动端：预览面板激活时才在标签栏右侧显示刷新按钮。
        const tabbar = panel.querySelector('.mh-gm-tabbar');
        if (tabbar) tabbar.classList.toggle('preview-active', activePane === 'preview');
    }

    function autoResize() {
        if (!inputEl) return;
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(200, Math.max(48, inputEl.scrollHeight)) + 'px';
    }

    // 把内存里的对话气泡（messages[]）转换成模型可用的历史消息，供「续写/恢复历史后继续对话」携带上下文。
    // 关键：每次发送都新建一个临时 ChatSession（只含 system + 当前这条用户消息），
    // 模型本身并不记得之前的对话；因此这里把「本轮之前的已完成对话」整理为 user/assistant 历史一并发送，
    // 这样恢复历史会话后再提问，AI 仍然知道之前聊过什么、做过什么。
    //   excludeTrailing: 跳过末尾若干条（默认 2 = 刚 push 的「当前用户消息 + pending AI 占位」），避免重复发送本轮内容。
    function buildPriorHistoryMessages(excludeTrailing = 2) {
        const out = [];
        const end = Math.max(0, messages.length - excludeTrailing);
        for (let i = 0; i < end; i++) {
            const m = messages[i];
            if (!m) continue;
            // 跳过纯 UI 提示气泡（编辑欢迎语等没有真实对话价值的内容）。
            if (m.editLink) continue;
            if (m.role === 'user') {
                const text = String(m.text || '').trim();
                if (!text) continue;
                out.push({ role: 'user', content: text });
            } else if (m.role === 'ai' || m.role === 'assistant') {
                // AI 气泡的最终正文：优先取 text，否则从交错段落里拼接文本段。
                let text = String(m.text || '').trim();
                if (!text && Array.isArray(m.segments)) {
                    text = m.segments
                        .filter(s => s?.type === 'text')
                        .map(s => String(s.text || ''))
                        .join('\n')
                        .trim();
                }
                if (!text) continue;
                out.push({ role: 'assistant', content: text });
            }
        }
        return out;
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
            `You are editing exactly ONE workspace file named ${GAME_MAKER_FILE_PATH}. There are no other files and no directories to browse.`,
            `All file tools always operate on ${GAME_MAKER_FILE_PATH}; any filePath argument is ignored. Do not attempt to list directories (list_dir is unavailable) or read/create any other file.`,
            'Use file tools for code changes: read_file to inspect the current file, then replace_string_in_file or multi_replace_string_in_file to apply small chunk edits. Use create_file only when the file is missing or when creating the first full version.',
            `The first 200 lines of the current ${GAME_MAKER_FILE_PATH} are appended at the end of this system prompt. Use that content directly; only call read_file when you need lines beyond the first 200.`,
            'Prefer incremental chunk edits over returning a full rewritten document when existing code is present.',
            'After editing, read_file the changed area or full file when needed to verify the result.',
            'At the end, briefly summarize what changed. Do not output a full HTML code block unless tools are unavailable.',
            'Inline all CSS and JavaScript. Use only CDN resources (e.g. Tailwind / Three.js) as described in the guide; no local files.',
            'Mobile-first and touch friendly, no scrollbars; the game must fit the iframe viewport.',
            'When the game ends you may call parent.postMessage({ type: "gameFinished", data: { score } }, "*").',
            langLine,
        ].join('\n');

        const hasExistingHtml = !!currentHtml.trim();

        abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const signal = abortController?.signal;
        let text = '';
        let reasoningText = '';

        if (aiMsg && !Array.isArray(aiMsg.segments)) aiMsg.segments = [];

        // 多轮工具调用 + 流式回调（onChunk 增量 / onMessage 全量快照）容易把同一内容重复计入，
        // 出现 "TheThe edits" 这类重影。这里以「当前文本段」(curSegText) 为唯一真相：
        //   - onChunk(delta)：把增量追加到当前段；
        //   - onMessage(snapshot)：若快照是当前段的超集则整体替换当前段，否则视为增量追加；
        //   - 工具调用插入时：把当前段「定稿」（推入 segments，不再变动），随后从空白开始新的一段。
        // text 仅用于对外返回最终文本（保留拼接，向后兼容）。
        let curSeg = null;            // 当前正在写入的文本段对象 { type:'text', text }
        let curSegText = '';          // 当前文本段的权威内容

        const ensureCurSeg = () => {
            if (!aiMsg) return null;
            const segs = aiMsg.segments || (aiMsg.segments = []);
            const last = segs[segs.length - 1];
            if (last && last.type === 'text' && last === curSeg) return curSeg;
            curSeg = { type: 'text', text: curSegText };
            segs.push(curSeg);
            return curSeg;
        };

        const flushCurSeg = () => {
            if (curSeg) curSeg.text = curSegText;
        };

        // 工具调用到来：当前文本段定稿，下一段从空白重新开始。
        const commitSegBeforeTool = () => {
            flushCurSeg();
            curSeg = null;
            curSegText = '';
        };

        const applyText = (delta, isSnapshot) => {
            if (!aiMsg) return;
            if (isSnapshot) {
                // 快照：若是当前段超集则整体替换；否则当作增量。
                curSegText = delta.startsWith(curSegText) ? delta : (curSegText + delta);
            } else {
                curSegText += delta;
            }
            ensureCurSeg();
            flushCurSeg();
            // text 对外只需最终全量，这里同步成「已定稿段 + 当前段」的拼接近似即可。
            aiMsg.text = curSegText;
            aiMsg.streaming = true;
            renderMessages();
        };

        const onChunk = (delta) => {
            throwIfAborted(signal);
            if (typeof delta === 'string' && delta) {
                text += delta;
                applyText(delta, false);
            }
        };
        const onMessage = (value, payload) => {
            throwIfAborted(signal);
            const next = textFromStreamPayload(value, payload);
            if (!next) return;
            text = next.startsWith(text) ? next : (text + next);
            applyText(next, true);
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

        // 首轮创建与后续编辑使用不同的开场用户消息。
        const userPrompt = hasExistingHtml
            ? `This is an EDIT session for an existing game. The current ${GAME_MAKER_FILE_PATH} content is shown at the end of the system prompt. Make incremental chunk edits with replace_string_in_file / multi_replace_string_in_file to satisfy this request, then briefly summarize the changes:\n\n${promptText}`
            : `This is a FIRST-TIME CREATE session — ${GAME_MAKER_FILE_PATH} is essentially empty. Build a complete, self-contained HTML5 mini game in one create_file call (full HTML document), then briefly summarize. User request:\n\n${promptText}`;

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
        // 读取 game.html 的前 N 行（用于新会话开场时模拟一次 read_file）。
        const readWorkspaceHead = async (lines = 200) => {
            if (!sdk?.copilotTools?.execute) return '';
            const content = await sdk.copilotTools.execute('read_file', { filePath: GAME_MAKER_FILE_PATH, startLine: 1, endLine: lines }, { workspace });
            return typeof content === 'string' && !content.startsWith('Failed:') ? content : '';
        };
        const recordToolCall = (toolCall) => {
            const args = toolCall?.function?.arguments || '';
            const argsObj = safeJsonParse(args, null);
            const event = {
                id: toolCall?.id || `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: toolCall?.function?.name || 'tool',
                status: 'running',
                args: fullToolDetail(argsObj != null ? argsObj : args),
                argsObj: (argsObj && typeof argsObj === 'object') ? argsObj : null,
                result: '',
                ts: Date.now(),
            };
            if (aiMsg) {
                if (!Array.isArray(aiMsg.toolCalls)) aiMsg.toolCalls = [];
                aiMsg.toolCalls.push(event);
                // 当前文本段先定稿，再插入工具调用段——后续正文将作为全新的文本段从空白续写。
                commitSegBeforeTool();
                // 按真实流式顺序把工具调用插入交错段落（紧跟在此前已生成的正文之后）。
                if (!Array.isArray(aiMsg.segments)) aiMsg.segments = [];
                aiMsg.segments.push({ type: 'tool', tool: event });
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
            target.detailResult = fullToolDetail(result);
            if (!event) calls.push(target);
            renderMessages();
        };

        await seedFile();

        // 不再用伪造的 tool_call 消息模拟 read_file，而是把当前文件前 200 行作为文本
        // 直接附到系统提示词末尾，格式与 SKILL.md 模板一致。
        // 首次创建（无既有 HTML）展示空占位；编辑会话读取真实文件前 200 行。
        let headContent = '';
        if (hasExistingHtml) {
            try { headContent = await readWorkspaceHead(200); } catch (_) { headContent = ''; }
        }
        const fileBlock = `current game file content:\ncopilot.read_file("${GAME_MAKER_FILE_PATH}", 1, 200):\n\`\`\`text\n${headContent && headContent.trim() ? headContent : ''}\n\`\`\``;
        const guideBlock = agentsMd ? `\n\n--- Platform game development guide (follow it) ---\n${agentsMd}` : '';
        const systemPrompt = `${baseRules}${guideBlock}\n\n${fileBlock}`;

        // 所有文件工具只允许操作当前活动游戏文件（game.html），且不提供 list_dir。
        // 通过 session.sandbox.registerAPI 覆盖内置工具：强制 filePath，再委派给内置实现。
        const installSingleFileTools = (session) => {
            const sandbox = session?.sandbox;
            if (!sandbox?.registerAPI || !sdk?.copilotTools?.execute) return;
            const runBuiltin = (name, args) => sdk.copilotTools.execute(name, { ...args, filePath: GAME_MAKER_FILE_PATH }, { workspace });
            // 读：忽略任何传入路径，始终读取 game.html。
            sandbox.registerAPI('read_file', (a = {}) => runBuiltin('read_file', a));
            // 改：单点替换与批量替换都锁定到 game.html。
            sandbox.registerAPI('replace_string_in_file', (a = {}) => runBuiltin('replace_string_in_file', a));
            sandbox.registerAPI('multi_replace_string_in_file', (a = {}) => {
                const replacements = Array.isArray(a?.replacements)
                    ? a.replacements.map(r => ({ ...r, filePath: GAME_MAKER_FILE_PATH }))
                    : a?.replacements;
                return sdk.copilotTools.execute('multi_replace_string_in_file', { ...a, filePath: GAME_MAKER_FILE_PATH, replacements }, { workspace });
            });
            // 写：create_file 也只能创建/覆盖 game.html。
            sandbox.registerAPI('create_file', (a = {}) => runBuiltin('create_file', a));
            // grep 锁定到当前文件范围（includePattern 固定为 game.html）。
            sandbox.registerAPI('grep_search', (a = {}) => sdk.copilotTools.execute('grep_search', { ...a, includePattern: GAME_MAKER_FILE_PATH }, { workspace }));
            // list_dir 已被禁用：返回明确提示，阻止目录浏览。
            sandbox.registerAPI('list_dir', () => `Failed: list_dir is disabled. You may only edit the single active game file "${GAME_MAKER_FILE_PATH}".`);
        };

        // 移除 list_dir：read 类别只保留 read_file，编辑只允许 edit。
        const fileToolCategories = ['read', 'edit', '-read.list_dir'];

        // 本轮之前的已完成对话（不含刚 push 的「当前用户消息 + pending AI 占位」），
        // 作为历史上下文一并发送，使「恢复历史后继续提问」时 AI 记得之前聊过的内容。
        const priorHistory = buildPriorHistoryMessages(2);

        if (sdk?.aiChat?.createSession) {
            const session = sdk.aiChat.createSession({
                modId: GAME_MAKER_MOD_ID,
                chatId,
                skipHistory: true,
                systemPrompt,
                model,
                workspace,
                enabledCategories: fileToolCategories,
            });
            installSingleFileTools(session);
            // 临时会话默认只含 system 消息，模型不记得之前的对话；
            // 这里把历史对话插到 system 之后、当前用户消息之前，让 AI 拥有完整上下文。
            if (priorHistory.length && Array.isArray(session.messages)) {
                const insertAt = session.messages[0]?.role === 'system' ? 1 : 0;
                session.messages.splice(insertAt, 0, ...priorHistory);
            }
            try {
                const p = session.send(userContent, { stream: true, abortController, onMessage, onChunk, onReasoning, onToolCall: recordToolCall, onToolResult: recordToolResult, systemPrompt, model, enableTools: fileToolCategories, enabledCategories: fileToolCategories, maxIterations: 8 });
                p.catch(() => {});
                const result = await waitWithAbort(p, signal);
                if (!text) text = (result?.text || result?.result || result || '').toString();
            } finally {
                try { session.destroy?.(); } catch (_) {}
            }
        } else if (sdk?.aiChat?.chat) {
            // 文件内容已附在 systemPrompt 末尾，普通消息即可；priorHistory 携带之前的对话上下文。
            const p = sdk.aiChat.chat({ messages: [{ role: 'system', content: systemPrompt }, ...priorHistory, { role: 'user', content: userContent }], modId: GAME_MAKER_MOD_ID, model, stream: true, abortController, onMessage, onChunk, onReasoning, onToolCall: recordToolCall, onToolResult: recordToolResult, enableTools: fileToolCategories, enabledCategories: fileToolCategories, workspace, maxIterations: 8 });
            p.catch(() => {});
            const result = await waitWithAbort(p, signal);
            if (!text) text = (result?.text || result?.result || result || '').toString();
        } else if (sdk?.aiGenerators?.chat) {
            const p = sdk.aiGenerators.chat({ messages: [{ role: 'system', content: systemPrompt }, ...priorHistory, { role: 'user', content: userContent }], model, stream: true, abortController, onMessage, onChunk, onReasoning });
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

    // 统一的持久化逻辑：首次保存由系统分配 pet-games/ 路径，之后沿用同一文件。
    // 供「生成后自动保存」与（可选的）手动保存按钮共用。
    let autoSaving = false;
    async function persistGame({ silent = false } = {}) {
        if (!currentHtml.trim()) {
            if (!silent) showToast(t('mgGameNeedHtml'), 'info', 1800);
            return null;
        }
        if (autoSaving) return null;
        autoSaving = true;
        const name = (nameEl?.value || gameName || '').trim() || extractHtmlTitle(currentHtml) || t('mgDefaultName');
        gameName = name;
        if (nameEl && !nameEl.value.trim()) nameEl.value = name;
        const saveBtn = $('mhGmSave');
        if (saveBtn && !silent) saveBtn.disabled = true;
        try {
            const result = await savePetGame(currentHtml, {
                path: savedPath,
                id: record?.id || undefined,
                title: name,
                icon: gameIcon || '🎮',
                desc: gameDesc || '',
            });
            // 记住系统分配的路径，使后续生成与本地会话历史都关联到同一个游戏文件。
            savedPath = result?.path || savedPath;
            onSaved?.(result);
            return result;
        } catch (e) {
            if (!silent) showToast(t('mgGameSaveFailed', { error: (e?.message || e) }), 'error', 2600);
            return null;
        } finally {
            autoSaving = false;
            if (saveBtn && !silent) saveBtn.disabled = false;
        }
    }

    async function handleSend(promptText) {
        const text = String(promptText != null ? promptText : (inputEl?.value || '')).trim();
        if (!text && !attachedImages.length) return;
        if (generating) return;
        
        // Capture attached images before clearing
        const imagesToSend = attachedImages.map(img => ({ id: img.id, dataUrl: img.dataUrl }));
        // 记录本轮开始前的游戏代码，用于判断「本轮是否真的改了代码」。
        const htmlBefore = currentHtml || '';
        
        if (inputEl) { inputEl.value = ''; autoResize(); }
        clearAttachedImages();
        
        generating = true;
        updateGenerationControls();
        
        // Add user message with images.
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
                aiMsg.text = reply?.trim() ? reply.trim() : t('mgGameAiDone');
                finalizeSegmentsText(aiMsg, aiMsg.text);
                setPreview(currentHtml);
                if (!gameName.trim()) {
                    gameName = extractHtmlTitle(currentHtml);
                    if (nameEl && gameName) nameEl.value = gameName;
                }
                // 桌面端预览常驻；移动端自动切到预览看效果。
                if (window.matchMedia?.('(max-width: 859px)')?.matches) switchPane('preview');
                // 生成成功后自动保存到 PersonalPageStore（首次自动分配 pet-games/ 路径），无需手动点保存。
                const saved = await persistGame({ silent: true });
                if (saved) showToast(t('mgGameSaved'), 'success', 1200);
            } else {
                aiMsg.text = reply?.trim() ? reply.trim() : t('mgGameAiNoHtml');
                finalizeSegmentsText(aiMsg, aiMsg.text);
            }
        } catch (e) {
            aiMsg.pending = false;
            aiMsg.streaming = false;
            aiMsg.thinking = false;
            if (isAbortError(e)) {
                // 中止：保留已交错生成的内容，仅在末尾追加一条「已停止」提示段落。
                aiMsg.text = t('mgGameAiStopped');
                if (!Array.isArray(aiMsg.segments)) aiMsg.segments = [];
                aiMsg.segments.push({ type: 'text', text: t('mgGameAiStopped') });
            } else {
                aiMsg.text = t('mgGameAiError', { error: (e?.message || e) });
                showToast(t('mgGameAiError', { error: (e?.message || e) }), 'error', 2600);
                finalizeSegmentsText(aiMsg, aiMsg.text);
            }
        } finally {
            generating = false;
            abortController = null;
            hideStreamPopup(true);
            updateGenerationControls();
            renderMessages();
            // 本轮是否真的改了代码：与本轮开始前的 HTML 比较。
            const codeChanged = (currentHtml || '') !== htmlBefore;
            // 有代码改动 → 新增一条历史项；无代码改动 → 并入上一条历史项。
            // 同时记录本轮开始前的代码，供点击用户气泡分叉到「发送这条消息之前」时精确还原。
            await saveRoundSnapshot({ codeChanged, htmlBefore });
        }
    }

    function handleStopGeneration() {
        if (!generating) return;
        try { abortController?.abort(); } catch (_) {}
        if (stopBtn) stopBtn.disabled = true;
    }

    // ---------- 「启发我」：引导式创意（不生成游戏，只出主意 + 可点击建议气泡） ----------
    // 解析模型返回的建议气泡：优先 ```json 代码块里的数组，其次裸 JSON 数组。
    // 返回 { intro, suggestions:[{icon,text}] }，intro 为正文（去掉 JSON 部分）。
    function parseInspireReply(raw) {
        const text = String(raw || '');
        let suggestions = [];
        let intro = text;
        // 优先匹配 ```json ... ``` 围栏，其次裸 [ ... ] 数组。
        const fence = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/i);
        const bare = fence ? null : text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        const jsonStr = fence ? fence[1] : (bare ? bare[0] : '');
        if (jsonStr) {
            try {
                const arr = JSON.parse(jsonStr);
                if (Array.isArray(arr)) {
                    suggestions = arr
                        .map(it => (typeof it === 'string'
                            ? { icon: '', text: it }
                            : { icon: String(it?.icon || '').slice(0, 4), text: String(it?.text || it?.title || '').trim() }))
                        .filter(it => it.text)
                        .slice(0, 6);
                }
            } catch (_) {}
            // 从正文里移除被解析掉的 JSON 块，剩下的当作引导语。
            intro = text.replace(fence ? fence[0] : jsonStr, '').trim();
        }
        return { intro, suggestions };
    }

    // 调用 LLM 做两步引导式创意（不挂文件工具，不生成 HTML）：
    //   stage 'direction' —— 第一步：给出几个「游戏方向/题材」让用户挑。
    //   stage 'game'      —— 第二步：在已选方向下给出几个「具体游戏点子」。
    // opts: { stage, userPromptText }
    async function runInspire(opts = {}) {
        if (generating) return;
        const stage = opts.stage === 'game' ? 'game' : 'direction';
        const sdk = state.sdk || window.keepwork;
        const lang = getLang();
        const promptText = String(opts.userPromptText || t('mgGameInspirePrompt'));

        generating = true;
        updateGenerationControls();
        messages.push({ role: 'user', text: promptText, images: [] });
        const aiMsg = { role: 'ai', text: '', pending: true, streaming: false, thinking: false, reasoning: '', inspireStage: stage };
        messages.push(aiMsg);
        renderMessages();

        abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const signal = abortController?.signal;

        const langLine = lang === 'en'
            ? 'Reply in English.'
            : '用简体中文回复。';
        const commonRules = [
            'You are a friendly creative companion in a kids-friendly HTML5 mini-game maker studio.',
            'Do NOT write any game code. Do NOT use tools. Just brainstorm.',
            'Keep the intro to 1-2 short, warm, encouraging sentences.',
            'Return your options as a JSON array at the END of your reply, in a ```json fenced code block.',
            'Each array item is an object: { "icon": "<one emoji>", "text": "<short label>" }.',
        ];
        const stageRules = stage === 'direction'
            ? [
                'STEP 1 of 2: The user does not know what to build yet. Offer 3-5 broad GAME DIRECTIONS / themes to choose from (NOT specific games).',
                'A direction is a short category like "Fantasy adventure", "Cozy simulation", "Fast-paced action", "Brain puzzles", "Retro arcade".',
                'Each "text" must be a short theme phrase of 2-4 words, NOT a full game concept.',
                'Example: ```json\n[{"icon":"🐉","text":"Fantasy adventure"},{"icon":"🚀","text":"Sci-fi action"},{"icon":"🧩","text":"Brain puzzles"},{"icon":"🌿","text":"Cozy simulation"}]\n```',
              ]
            : [
                'STEP 2 of 2: The user already picked a game direction (see the conversation above). Now offer 3-5 CONCRETE, fun mini-game ideas that fit that direction.',
                'Each "text" must be a single complete game concept the user can tap to start building (a short phrase, not a question).',
                'Example: ```json\n[{"icon":"🐉","text":"A snake game where the snake is a baby dragon"},{"icon":"🏰","text":"Defend a castle from waves of slimes"}]\n```',
              ];
        const systemPrompt = [...commonRules, ...stageRules, langLine].join('\n');

        const priorHistory = buildPriorHistoryMessages(2);
        let reply = '';
        try {
            if (sdk?.aiChat?.chat) {
                const chatMessages = [
                    { role: 'system', content: systemPrompt },
                    ...priorHistory,
                    { role: 'user', content: promptText },
                ];
                const r = await waitWithAbort(
                    sdk.aiChat.chat({
                        messages: chatMessages,
                        modId: GAME_MAKER_MOD_ID,
                        model: selectedModel || undefined,
                        skipHistory: true,
                        onMessage: (value, payload) => {
                            throwIfAborted(signal);
                            const next = textFromStreamPayload(value, payload);
                            if (!next) return;
                            reply = next.startsWith(reply) ? next : (reply + next);
                            // 流式期间仅显示正文（建议气泡在收尾时一次性渲染，避免半截 JSON 闪烁）。
                            aiMsg.text = reply;
                            aiMsg.streaming = true;
                            if (!Array.isArray(aiMsg.segments)) aiMsg.segments = [];
                            const seg = aiMsg.segments.find(s => s.type === 'text') || (() => { const s = { type: 'text', text: '' }; aiMsg.segments.push(s); return s; })();
                            seg.text = parseInspireReply(reply).intro || reply;
                            renderMessages();
                        },
                    }),
                    signal,
                );
                if (!reply) reply = (r?.text || r?.result || r || '').toString();
            } else if (sdk?.aiGenerators?.chat) {
                const r = await sdk.aiGenerators.chat({
                    messages: [{ role: 'system', content: systemPrompt }, ...priorHistory, { role: 'user', content: promptText }],
                    model: selectedModel || undefined,
                });
                reply = (r?.text || r?.choices?.[0]?.message?.content || r || '').toString();
            } else {
                throw new Error(t('mgGameAiUnavailable'));
            }

            const { intro, suggestions } = parseInspireReply(reply);
            aiMsg.pending = false;
            aiMsg.streaming = false;
            const introText = (intro || reply || '').trim();
            // 仅在第二步（具体游戏）才提示「就做这个」；选方向阶段不提示。
            const tail = (stage === 'game' && suggestions.length) ? `\n\n${t('mgGameInspireBuildHint')}` : '';
            aiMsg.text = `${introText}${tail}`.trim();
            aiMsg.segments = [{ type: 'text', text: aiMsg.text }];
            aiMsg.suggestions = suggestions;
            aiMsg.inspireStage = stage;
        } catch (e) {
            aiMsg.pending = false;
            aiMsg.streaming = false;
            if (isAbortError(e)) {
                aiMsg.text = t('mgGameAiStopped');
                aiMsg.segments = [{ type: 'text', text: aiMsg.text }];
            } else {
                aiMsg.text = t('mgGameInspireError');
                aiMsg.segments = [{ type: 'text', text: aiMsg.text }];
                showToast(t('mgGameInspireError'), 'error', 2200);
            }
        } finally {
            generating = false;
            abortController = null;
            updateGenerationControls();
            renderMessages();
            // 启发轮不改代码：并入上一条历史项（codeChanged=false），保留这段引导对话。
            await saveRoundSnapshot({ codeChanged: false, htmlBefore: currentHtml || '' });
        }
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
                    <button type="button" class="mh-gm-emoji-dialog-close" aria-label="${escapeHtml(t('close'))}">×</button>
                </div>
                <div class="mh-gm-emoji-input-row">
                    <input class="mh-gm-emoji-input" id="mhGmEmojiInput" value="${escapeHtml(gameIcon || '')}" maxlength="8" inputmode="text" autocomplete="off">
                    <button type="button" class="mh-gm-emoji-auto" id="mhGmEmojiAuto">${escapeHtml(t('mgEmojiAuto'))}</button>
                </div>
                <div class="mh-gm-emoji-grid">${EMOJI_OPTIONS.map(e => `<button type="button" class="mh-gm-emoji-btn${e === gameIcon ? ' active' : ''}" data-mh-gm-emoji="${e}" title="${e}">${e}</button>`).join('')}</div>
                <div class="mh-gm-emoji-actions">
                    <button type="button" class="mh-gm-emoji-cancel">${escapeHtml(t('cancel'))}</button>
                    <button type="button" class="mh-gm-emoji-ok">${escapeHtml(t('confirm'))}</button>
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
        const result = await persistGame({ silent: false });
        if (result) showToast(t('mgGameSaved'), 'success', 1400);
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
    $('mhGmPreviewRefresh')?.addEventListener('click', () => reloadPreview());
    errBadge?.addEventListener('click', () => showErrorPopup());
    inputEl?.addEventListener('input', autoResize);
    inputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    panel.querySelectorAll('[data-mh-gm-pane]').forEach(btn => {
        btn.onclick = () => switchPane(btn.dataset.mhGmPane);
    });
    msgsEl?.addEventListener('click', (e) => {
        // 「启发我」按钮：让 AI 出主意（引导式创意），不直接生成游戏。
        const inspireBtn = e.target.closest?.('[data-mh-gm-inspire]');
        if (inspireBtn) {
            if (!generating) runInspire();
            return;
        }

        // 点击「换一批」chip：在同一步让 AI 给出更多/不同选项。
        const moreBtn = e.target.closest?.('[data-mh-gm-suggest-more]');
        if (moreBtn) {
            e.stopPropagation();
            if (generating) return;
            const msgIdx = parseInt(moreBtn.dataset.mhGmSuggestMore, 10);
            const stage = messages[msgIdx]?.inspireStage === 'game' ? 'game' : 'direction';
            const prompt = stage === 'game' ? t('mgGameSuggestMorePrompt') : t('mgGameDirectionMorePrompt');
            runInspire({ stage, userPromptText: prompt });
            return;
        }

        // 点击 AI 给出的建议气泡：
        //   方向（stage 'direction'）→ 进入第二步，让 AI 出该方向下的具体游戏；
        //   具体游戏（stage 'game'）→ 当作「就做这个」直接发起游戏生成。
        const suggestBtn = e.target.closest?.('[data-mh-gm-suggest]');
        if (suggestBtn) {
            e.stopPropagation();
            if (generating) return;
            const msgIdx = parseInt(suggestBtn.dataset.mhGmSuggest, 10);
            const sIdx = parseInt(suggestBtn.dataset.mhGmSuggestIdx, 10);
            const msg = messages[msgIdx];
            const pick = msg?.suggestions?.[sIdx]?.text;
            if (!pick) return;
            if (msg?.inspireStage === 'direction') {
                // 第一步选好方向 → 第二步出具体游戏。
                runInspire({ stage: 'game', userPromptText: t('mgGameDirectionPicked', { name: pick }) });
            } else {
                // 第二步选好游戏 → 开始生成。
                handleSend(pick);
            }
            return;
        }

        // 点击正文段的「展开/收起」按钮：切换该段落是否限高（优先处理，避免触发气泡其它逻辑）。
        const textToggle = e.target.closest?.('[data-mh-gm-textseg-toggle]');
        if (textToggle) {
            e.stopPropagation();
            const key = textToggle.dataset.mhGmTextsegToggle;
            const segEl = textToggle.closest('.mh-gm-textseg');
            const expanded = expandedTextSegs.has(key);
            if (expanded) expandedTextSegs.delete(key); else expandedTextSegs.add(key);
            if (segEl) {
                segEl.classList.toggle('is-expanded', !expanded);
                const title = !expanded ? t('mgGameTextCollapse') : t('mgGameTextExpand');
                textToggle.title = title;
                textToggle.setAttribute('aria-label', title);
            }
            return;
        }

        // 点击用户消息气泡：回退/分叉到「发送这条消息之前」的状态。
        const userBubble = e.target.closest?.('[data-mh-gm-user-msg]');
        if (userBubble) {
            const idx = parseInt(userBubble.dataset.mhGmUserMsg, 10);
            if (!Number.isNaN(idx)) forkFromUserMessage(idx);
            return;
        }

        // 点击内联推理面板标题：折叠/展开（优先处理，避免触发气泡弹窗）。
        const reasoningToggle = e.target.closest?.('[data-mh-gm-reasoning-toggle]');
        if (reasoningToggle) {
            const msgIdx = parseInt(reasoningToggle.dataset.mhGmReasoningToggle, 10);
            const msg = messages[msgIdx];
            if (msg) {
                // 当前显示为折叠（reasoningCollapsed !== false）则展开，否则折叠。
                const currentlyCollapsed = msg.reasoningCollapsed !== false;
                msg.reasoningCollapsed = !currentlyCollapsed;
                renderMessages();
            }
            return;
        }

        // 点击编辑欢迎语里的游戏名链接：弹窗显示并支持编辑 game.html。
        const fileLink = e.target.closest?.('[data-mh-gm-file-link]');
        if (fileLink) {
            e.stopPropagation();
            showGameFilePopup(GAME_MAKER_FILE_PATH);
            return;
        }

        // 点击工具调用里的 [game.html] 文件按钮：弹窗显示当前游戏文件内容（优先处理，避免触发工具详情弹窗）。
        const fileBtn = e.target.closest?.('[data-mh-gm-tc-file]');
        if (fileBtn) {
            e.stopPropagation();
            showGameFilePopup(fileBtn.dataset.mhGmTcFile || GAME_MAKER_FILE_PATH);
            return;
        }

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
    });
    // 键盘可访问性：在游戏名链接上按 Enter / 空格也能打开文件窗口。
    msgsEl?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const fileLink = e.target.closest?.('[data-mh-gm-file-link]');
        if (fileLink) {
            e.preventDefault();
            showGameFilePopup(GAME_MAKER_FILE_PATH);
            return;
        }
        // 键盘可访问性：在用户消息气泡上按 Enter / 空格也能触发回退/分叉。
        const userBubble = e.target.closest?.('[data-mh-gm-user-msg]');
        if (userBubble) {
            e.preventDefault();
            const idx = parseInt(userBubble.dataset.mhGmUserMsg, 10);
            if (!Number.isNaN(idx)) forkFromUserMessage(idx);
        }
    });
    // 仅通过点击展示工具调用详情与流式弹窗，移动端与 PC 端交互保持一致（不再使用 hover）。
    
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

    // 历史会话：切换弹层 + 选择某条历史 / 删除某条 / 清空全部。
    historyBtn.onclick = (e) => { e.stopPropagation(); toggleHistoryPop(); };
    historyPop?.addEventListener('click', (e) => {
        // 清空全部。
        if (e.target.closest?.('[data-mh-gm-history-clear]')) {
            e.stopPropagation();
            clearHistoryAll();
            return;
        }
        // 删除单条。
        const del = e.target.closest?.('[data-mh-gm-history-del]');
        if (del) {
            e.stopPropagation();
            deleteHistoryRow(del.dataset.mhGmHistoryDel);
            return;
        }
        // 选择某条历史进行恢复。
        const item = e.target.closest?.('[data-mh-gm-chatid]');
        if (!item) return;
        const row = historyRows.find((r) => String(r?.chatId || '') === item.dataset.mhGmChatid);
        if (row) loadHistoryRow(row);
    });

    // 新建会话。
    newBtn.onclick = startNewSession;

    // 设置弹窗（全局 / 游戏配置 / 美术资源三个标签页）。
    // 通过 ctx 把工坊的状态读写、模型列表、emoji 选择器、本地 API 设置、持久化逻辑桥接给设置模块。
    configBtn.onclick = () => {
        openGameMakerSettings(panel, {
            getName: () => gameName,
            setName: (v) => { gameName = String(v || ''); },
            getIcon: () => gameIcon,
            setIcon: (v) => { gameIcon = String(v || '🎮'); },
            getModel: () => selectedModel,
            setModel: (v) => { selectedModel = v || ''; savePreferredModel(selectedModel); },
            getHtml: () => currentHtml,
            setHtml: (v) => { currentHtml = String(v || ''); },
            listChatModels,
            modelValue,
            modelLabel,
            showEmojiDialog,
            // 设置里改了标题/图标/模型后，同步刷新工坊顶栏与模型下拉。
            onApplyMeta: () => {
                if (nameEl) nameEl.value = gameName;
                if (iconBtn) iconBtn.textContent = gameIcon || '🎮';
                populateModelSelect();
            },
            // 打开本地 API Key 设置（与原行为一致），关闭后刷新模型列表。
            openLocalApiSettings: async () => {
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
            },
            // 游戏配置 / 美术资源写回 game.html 后：刷新预览并静默持久化，
            // 并把这次代码改动并入「上一条」历史项（与文件弹窗手动编辑一致），便于之后回退/还原。
            persistHtml: async (nextHtml) => {
                const prev = currentHtml || '';
                const next = String(nextHtml || '');
                currentHtml = next;
                setPreview(currentHtml);
                await persistGame({ silent: true });
                // 代码确有变化时才并入历史，避免无谓写入；传入改动前代码作为新建快照的分叉前状态。
                if (next !== prev) {
                    await mergeManualCodeIntoLastSnapshot(prev);
                }
            },
        });
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
        messages.push({ role: 'ai', text: t('mgGameEditWelcome', { title: gameName || t('mgDefaultName') }), editLink: true });
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
        try { window.removeEventListener('message', onPreviewError); } catch (_) {}
        try { previewFrame?.removeEventListener('load', onPreviewLoad); } catch (_) {}
        try { hideStreamPopup(true); } catch (_) {}
        try { closeGameMakerSettings(panel); } catch (_) {}
        abortController = null;
        activeGameMakerCleanup = null;
    };
}
