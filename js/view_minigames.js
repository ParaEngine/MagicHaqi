// 玩耍视图：小游戏列表 + iframe 容器
import { $, clamp, coinIconSvg, confirm, escapeHtml, showToast } from './utils.js';
import { getLang, t } from './i18n.js';
import { CONFIG } from './config.js';
import { state, setPlanetName } from './state.js';
import { displayPetName } from './dna.js';
import { getPet, getPetAsync, getPetImagePayload } from './pet.js';
import { isPetOnCurrentPlanet } from './petLifecycle.js';
import { addLikedGame, deletePetGame, loadLikedGames, loadPetGameHtml, loadPetGameList, loadRecentGames, loadRemotePetGameHtml, loadRemotePetGameList, recordRecentGame, removeLikedGame, saveUserProfileDebounced } from './storage.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();
const STAT_REWARD_ANIMATION_MS = 1600;
const DEFAULT_MINIGAME_STAT_BONUS = { bond: 12, mood: 6 };
const MINIGAME_REST_PROMPT_MS = 5 * 60 * 1000;
const MINIGAME_ENTRY_CLICK_GUARD_MS = 520;
const MINIGAME_COMPLETION_PROMPT_MIN_SECONDS = 60;
const MINIGAME_LOADING_MAX_MS = 5000;
// 至少游玩 15 秒才记入"最近玩过"历史（避免误点 / 秒退污染推荐列表）。
const MINIGAME_RECENT_MIN_PLAY_MS = 15000;
const MINIGAME_PET_IMAGE_REQUESTS = new Set([
    'haqi_get_pet_image',
    'haqiGetPetImage',
]);
const MINIGAME_ALL_PET_IMAGE_REQUESTS = new Set([
    'haqi_get_pet_images',
    'haqi_get_all_pet_images',
    'haqiGetPetImages',
]);
// 小游戏（如新手领养仪式 haqi_planet_boarding）请求用户档案：星球名、昵称、性别等。
const MINIGAME_USER_PROFILE_REQUESTS = new Set([
    'haqi_get_user_profile',
    'haqiGetUserProfile',
]);
// 小游戏回写用户档案（重命名星球 / 修改昵称）。
const MINIGAME_USER_PROFILE_UPDATES = new Set([
    'haqi_set_user_profile',
    'haqiSetUserProfile',
]);

// 小游戏清单从 side-by-side 的 minigames/_minigame_index.json 按需加载一次并缓存。
// `import.meta.url + ''` 阻止 Vite 静态分析把整个父目录树打包进 assets/（见 config.js 同款写法 / magichaqi-vite-build 记录）。
const MINIGAME_INDEX_PATH = 'minigames/_minigame_index.json';
const MINIGAME_INDEX_URL = new URL(MINIGAME_INDEX_PATH, new URL('..', import.meta.url + '')).href;
let MINIGAMES = [];
let minigameIndexPromise = null;

// 导出供其它视图（如 view_story_maker）按需复用，保证 _minigame_index.json 是唯一数据源。
export function loadMinigameIndex() {
    if (minigameIndexPromise) return minigameIndexPromise;
    minigameIndexPromise = fetch(MINIGAME_INDEX_URL, { cache: 'no-store' })
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then((list) => {
            MINIGAMES = Array.isArray(list) ? list : [];
            return MINIGAMES;
        })
        .catch((e) => {
            console.error('加载小游戏清单失败', e);
            minigameIndexPromise = null; // 允许下次重试
            MINIGAMES = [];
            return MINIGAMES;
        });
    return minigameIndexPromise;
}

const PLAY_ACTIVITIES = [
    /*
    {
        id: 'mindeye',
        title: '精神之海',
        icon: '💬',
        desc: '进入 AI 伙伴的对话空间。',
        src: 'https://keepwork.com/maisi/maisi/webgames/mindeye',
        allow: 'microphone; camera; autoplay; fullscreen',
        manualComplete: true,
    },
    {
        id: 'wiki_dashboard',
        title: '抱抱龙成长百科',
        icon: '📚',
        desc: '和数字伙伴一起查知识。',
        src: 'https://keepwork.com/maisi/maisi/webgames/wiki_dashboard',
        allow: 'microphone; camera; autoplay; fullscreen',
        manualComplete: true,
    },
    {
        id: 'characterAI',
        title: '数字人对话',
        icon: '🎙️',
        desc: '打开数字人语音互动。',
        src: 'https://keepwork.com/maisi/maisi/webgames/characterAI',
        allow: 'microphone; camera; autoplay; fullscreen',
        manualComplete: true,
    },
    */
];

function getPlayItems() {
    return [...MINIGAMES, ...PLAY_ACTIVITIES];
}

function getVisiblePlayItems() {
    return getPlayItems().filter(item => !item?.hidden);
}

// ---------- 收藏（list_liked_games.json） ----------
// 收藏列表只加载一次并缓存到内存；切换标签 / 切换收藏状态时复用 / 更新这份缓存。
let likedGamesCache = null;
let likedGamesPromise = null;

function ensureLikedGames() {
    if (likedGamesCache) return Promise.resolve(likedGamesCache);
    if (!likedGamesPromise) {
        likedGamesPromise = loadLikedGames()
            .then((list) => { likedGamesCache = Array.isArray(list) ? list : []; return likedGamesCache; })
            .catch(() => { likedGamesPromise = null; likedGamesCache = []; return likedGamesCache; });
    }
    return likedGamesPromise;
}

// 收藏的唯一键：owner + id（id 统一为不含目录、不含扩展名的基础名）。
// 与 storage.likedGameKey 保持一致，保证内存 / 磁盘 / 卡片三处判断同一把键。
function likedBaseId(meta) {
    const raw = String(meta?.id || meta?.path || meta?.src || '').trim().replace(/^\/+/, '');
    return raw.split('/').pop().replace(/\.html?$/i, '');
}
function likeKeyFor(meta) {
    if (!meta) return '';
    const owner = String(meta.owner || '').trim();
    return `${owner}::${likedBaseId(meta)}`;
}

function isGameLikedSync(meta) {
    const key = likeKeyFor(meta);
    if (!key || !likedGamesCache) return false;
    return likedGamesCache.some(item => likeKeyFor(item) === key);
}

// ---------- 最近玩过（本地 IndexedDB） ----------
// recentGamesCache: { recencyKey -> playedAt }，"推荐"据此排序并显示"N 天前"。
let recentGamesCache = null;
let recentGamesPromise = null;

function ensureRecentGames() {
    if (recentGamesCache) return Promise.resolve(recentGamesCache);
    if (!recentGamesPromise) {
        recentGamesPromise = loadRecentGames()
            .then((list) => { recentGamesCache = Array.isArray(list) ? list : []; return recentGamesCache; })
            .catch(() => { recentGamesPromise = null; recentGamesCache = []; return recentGamesCache; });
    }
    return recentGamesPromise;
}

// 由最近游玩记录数组构建 { key -> playedAt } 映射，用于排序与"N 天前"显示。
function recentPlayedMap() {
    const map = {};
    (recentGamesCache || []).forEach(r => { if (r?.key) map[r.key] = Number(r.playedAt) || 0; });
    return map;
}

// 游戏的"最近游玩"唯一键：与收藏一致（owner::基础名），保证官方 / 作品都稳定可识别。
function recencyKeyForGame(game) {
    if (!game) return '';
    if (game.__likeMeta) return likeKeyFor(game.__likeMeta);
    // 官方内置游戏：owner 为空，id 即官方游戏 id。
    if (game.src && !game.path && !game.__owner) return `::${likedBaseId({ id: game.id })}`;
    const owner = String(game.__owner || '').trim();
    return `${owner}::${likedBaseId(game)}`;
}

function recordRecentPlay(game, meta = null) {
    const m = meta || game?.__likeMeta || null;
    const key = recencyKeyForGame(m ? { __likeMeta: m } : game);
    if (!key) return;
    const now = Date.now();
    const record = {
        key,
        playedAt: now,
        id: String(m?.id || game?.id || '').split('/').pop().replace(/\.html?$/i, ''),
        owner: String(m?.owner || game?.__owner || '').trim(),
        title: m?.title || getMinigameTitle(game),
        icon: m?.icon || game?.icon || '🎮',
    };
    // 更新内存缓存（移到最前），并持久化到 IndexedDB。
    if (!Array.isArray(recentGamesCache)) recentGamesCache = [];
    recentGamesCache = [record, ...recentGamesCache.filter(r => r.key !== key)];
    recordRecentGame(key, record);
}

// 取消尚未触发的"记入最近玩过"延时（中途退出 / 切换游戏 / 视图销毁时调用）。
function clearRecentPlayTimer() {
    if (recentRecordTimer) { clearTimeout(recentRecordTimer); recentRecordTimer = null; }
}

// 满 15 秒仍在玩同一个游戏，才真正记入最近游玩历史。
function scheduleRecentPlay(game, meta) {
    clearRecentPlayTimer();
    if (!game) return;
    const sessionGame = game;
    recentRecordTimer = setTimeout(() => {
        recentRecordTimer = null;
        // 仍在玩同一个游戏才记录（避免中途已退出 / 已换别的游戏）。
        if (currentGame !== sessionGame) return;
        recordRecentPlay(game, meta);
    }, MINIGAME_RECENT_MIN_PLAY_MS);
}

// 历史游玩记录转"待玩条目"：owner 为空 → 官方游戏（按 id 匹配内置）；否则 → 用户作品。
function recentRecordToPlayItem(record) {
    if (!record) return null;
    const owner = String(record.owner || '').trim();
    if (!owner) {
        const builtin = getPlayItems().find(item => item.src && item.id === record.id);
        if (builtin?.hidden) return null;
        if (builtin) return { ...builtin, __likeMeta: likeMetaForGame(builtin, { official: true }) };
        // 官方游戏已下架且无快照 src，无法重玩，跳过。
        if (!record.id) return null;
        return null;
    }
    const path = `pet-games/${record.id}.html`;
    return {
        id: record.id,
        title: record.title,
        icon: record.icon,
        __likedGame: { owner, path },
        __owner: owner,
        __likeMeta: { id: record.id, owner, title: record.title, icon: record.icon, path },
    };
}

// 把"待玩条目"（官方游戏 / 我的作品 / 别人的作品）规范化为收藏记录。
function likeMetaForGame(game, { owner = '', official = false } = {}) {
    if (!game) return null;
    const isOfficial = official || (!!game.src && !game.path && !owner);
    return {
        id: game.id || game.path || game.src || '',
        path: isOfficial ? '' : (game.path || ''),
        src: isOfficial ? (game.src || '') : '',
        owner: isOfficial ? '' : String(owner || ''),
        title: getMinigameTitle(game),
        icon: game.icon || '🎮',
        desc: game.desc || '',
        official: isOfficial,
    };
}

// 把收藏记录（只含 id/owner/title/icon）转回"待玩条目"，使"推荐"里能直接渲染并打开。
// 其余信息由 id + owner 推导：owner 为空 → 官方游戏（按 id 匹配内置）；否则 → 用户作品（path = pet-games/<id>.html）。
function likedRecordToPlayItem(record) {
    if (!record) return null;
    const owner = String(record.owner || '').trim();
    if (!owner) {
        // 官方游戏：优先用内置定义（保留 allow / manualComplete / 自定义图标 SVG），否则用收藏快照。
        const builtin = getPlayItems().find(item => item.src && item.id === record.id);
        if (builtin?.hidden) return null;
        if (builtin) return { ...builtin, __liked: true, __likeMeta: likeMetaForGame(builtin, { official: true }) };
        return {
            id: record.id,
            title: record.title,
            icon: record.icon,
            src: '',
            __liked: true,
            __likeMeta: { id: record.id, owner: '', title: record.title, icon: record.icon, official: true },
        };
    }
    // 用户作品（自己或别人）：path 由 id 推导，在打开时拉取 HTML。
    const path = `pet-games/${record.id}.html`;
    return {
        id: record.id,
        title: record.title,
        icon: record.icon,
        __likedGame: { owner, path },
        __owner: owner,
        __liked: true,
        __likeMeta: { id: record.id, owner, title: record.title, icon: record.icon, path },
    };
}

// 当前登录用户名（用于"是否是自己的游戏"判断与 [我] 标签）。
function currentUsername() {
    return String(state.user?.username || state.sdk?.user?.username || '').trim();
}

// 作者标签文案：自己的游戏显示 [我]/[me]，否则取用户名前几位字母。
function ownerTagLabel(owner) {
    const name = String(owner || '').trim();
    if (!name) return '';
    if (name === currentUsername()) return t('mgOwnerMe');
    return name.length > 4 ? name.slice(0, 4) : name;
}

// "推荐"标签内容分两组：
//  组1 = 官方内置游戏 + 已收藏游戏，按最近游玩时间倒序（没玩过的排在本组末尾，保持原顺序）。
//  组2 = 历史玩过但不在组1里的游戏（最多 200，本地 IndexedDB），按最近游玩时间倒序，整体接在组1之后。
function getRecommendItems() {
    const playedMap = recentPlayedMap();
    const official = getVisiblePlayItems().map(game => ({
        ...game,
        __likeMeta: likeMetaForGame(game, { official: true }),
        __liked: isGameLikedSync(likeMetaForGame(game, { official: true })),
    }));
    const officialKeys = new Set(official.map(item => likeKeyFor(item.__likeMeta)));
    const liked = (likedGamesCache || [])
        .filter(record => !officialKeys.has(likeKeyFor(record)))
        .map(likedRecordToPlayItem)
        .filter(Boolean);

    // 组1：官方 + 收藏，附最近游玩时间后稳定排序（玩过的在前、按时间倒序；其余保持插入顺序）。
    const group1 = [...official, ...liked];
    group1.forEach((item) => { item.__playedAt = playedMap[recencyKeyForGame(item)] || 0; });
    const group1Sorted = group1
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const pa = a.item.__playedAt || 0;
            const pb = b.item.__playedAt || 0;
            if (pa !== pb) return pb - pa;
            return a.index - b.index;
        })
        .map(entry => entry.item);

    // 组2：历史游玩里不在组1的游戏（recentGamesCache 已按时间倒序），重建为可玩条目。
    const group1Keys = new Set(group1Sorted.map(item => recencyKeyForGame(item)));
    const group2 = (recentGamesCache || [])
        .filter(record => record?.key && !group1Keys.has(record.key))
        .map((record) => {
            const item = recentRecordToPlayItem(record);
            if (item) item.__playedAt = record.playedAt || 0;
            return item;
        })
        .filter(Boolean);

    return [...group1Sorted, ...group2];
}

// ---------- 分享 / 收藏 图标 SVG ----------
const MINIGAME_SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:16px;height:16px;display:block"><circle cx="18" cy="5" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="6" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="18" cy="19" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8.6 10.6l6.8-3.9M8.6 13.4l6.8 3.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
// 收藏图标改用 emoji 爱心：已收藏红色 ❤️；未收藏灰色（用 grayscale 滤镜把红心变灰）。
function minigameHeartIcon(filled) {
    return filled
        ? '<span class="mh-minigame-heart-emoji liked" role="img" aria-hidden="true">❤️</span>'
        : '<span class="mh-minigame-heart-emoji" role="img" aria-hidden="true">❤️</span>';
}

// ---------- 分享链接 ----------
function getMinigameShareUsername() {
    const direct = state.user?.username || state.sdk?.user?.username;
    if (direct) return Promise.resolve(direct);
    return state.sdk?.getUsername?.().catch?.(() => '') || Promise.resolve('');
}

function buildMinigameShareUrl(record, username) {
    const url = new URL('MagicHaqi.html', window.location.href);
    url.searchParams.set('gameFrom', username || '');
    const filename = String(record?.path || '').trim().replace(/^\/+/, '').split('/').pop() || '';
    url.searchParams.set('game', filename);
    return url.href;
}

async function copyMinigameText(text, okMessage) {
    try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
            const input = document.createElement('textarea');
            input.value = text;
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }
        showToast(okMessage, 'success', 1600);
        return true;
    } catch (_) {
        showToast(t('mgShareFailed'), 'error', 2200);
        return false;
    }
}

// 分享弹窗（参照 view_story_list 的故事分享样式）。
async function openMinigameSharePanel(record) {
    if (!record?.path) return;
    const username = await getMinigameShareUsername();
    if (!username) { showToast(t('mgShareLoginFirst'), 'error', 2200); return; }
    document.querySelector('.mh-minigame-share-mask')?.remove();
    const safeTitle = record.title || t('mgDefaultName');
    const url = buildMinigameShareUrl(record, username);
    const text = t('mgShareText', { title: safeTitle });
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-story-share-mask mh-minigame-share-mask';
    mask.innerHTML = `
        <div class="modal-card mh-story-share-card">
            <div class="mh-story-share-head">
                <div>
                    <div class="mh-story-share-title">${escapeHtml(t('mgShareTitle'))}</div>
                    <div class="mh-story-share-subtitle">${escapeHtml(safeTitle)}</div>
                </div>
                <button type="button" class="mh-story-share-close" data-mg-share-close aria-label="${escapeHtml(t('mgShareClose'))}">×</button>
            </div>
            <div class="mh-story-share-preview">${escapeHtml(text)}</div>
            <input class="modal-input mh-story-share-link" readonly value="${escapeHtml(url)}" aria-label="${escapeHtml(t('mgShareLink'))}">
            <div class="mh-story-share-actions">
                <button type="button" class="btn-secondary" data-mg-share-method="copy">${escapeHtml(t('mgShareCopyLink'))}</button>
                <button type="button" class="btn-secondary" data-mg-share-method="wechat">${escapeHtml(t('mgShareWechat'))}</button>
                <button type="button" class="btn-primary" data-mg-share-method="system">${escapeHtml(t('mgShareSystem'))}</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', async (e) => {
        if (e.target === mask || e.target.closest?.('[data-mg-share-close]')) { close(); return; }
        const methodBtn = e.target.closest?.('[data-mg-share-method]');
        if (!methodBtn) return;
        const method = methodBtn.dataset.mgShareMethod;
        if (method === 'copy') {
            await copyMinigameText(url, t('mgShareLinkCopied'));
        } else if (method === 'wechat') {
            await copyMinigameText(`${text}\n${url}`, t('mgShareWechatCopied'));
        } else if (method === 'system') {
            if (navigator.share) {
                try { await navigator.share({ title: safeTitle, text, url }); return; } catch (_) {}
            }
            await copyMinigameText(`${text}\n${url}`, t('mgShareCopied'));
        }
    });
    document.body.appendChild(mask);
}

// 切换收藏：成功后更新内存缓存，调用方负责刷新对应卡片 UI。
async function toggleLikeGame(meta) {
    if (!meta) return null;
    const username = state.user?.username || state.sdk?.user?.username;
    if (!username) { showToast(t('mgLikeLoginFirst'), 'error', 2000); return null; }
    await ensureLikedGames();
    const liked = isGameLikedSync(meta);
    try {
        if (liked) {
            await removeLikedGame(meta);
            likedGamesCache = (likedGamesCache || []).filter(item => likeKeyFor(item) !== likeKeyFor(meta));
            showToast(t('mgUnliked'), 'info', 1200);
            return false;
        }
        const record = await addLikedGame({ ...meta, likedAt: Date.now() });
        if (record) likedGamesCache = [record, ...(likedGamesCache || []).filter(item => likeKeyFor(item) !== likeKeyFor(record))];
        showToast(t('mgLiked'), 'success', 1200);
        return true;
    } catch (err) {
        showToast(t('mgLikeFailed', { error: (err?.message || err) }), 'error', 2400);
        return null;
    }
}

// ---------- 分享链接进入：从 ?gameFrom=&game= 解析 ----------
export function parseSharedGameParams() {
    try {
        const url = new URL(window.location.href);
        const fromUsername = (url.searchParams.get('gameFrom') || '').trim();
        const game = (url.searchParams.get('game') || '').trim();
        return { fromUsername, game };
    } catch (_) {
        return { fromUsername: '', game: '' };
    }
}

export function hasSharedGameParams() {
    const { fromUsername, game } = parseSharedGameParams();
    return !!(fromUsername && game);
}

function cleanupSharedGameUrl() {
    try {
        const url = new URL(window.location.href);
        ['gameFrom', 'game'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

// 单色 SVG 图标（fill/stroke 用 currentColor，跟随标签文字颜色：未选灰、选中蓝）。
const MINIGAME_TAB_ICONS = {
    // 推荐：五角星轮廓
    recommend: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.9l-5.2 2.62.99-5.8-4.21-4.1 5.82-.85z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    // 创造：加号
    create: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 我的：方框（盒子轮廓）
    mine: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.5" y="6.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 10h15" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

const MINIGAME_TABS = [
    { id: 'recommend', labelKey: 'mgTabRecommend' },
    { id: 'create', labelKey: 'mgTabCreate' },
    { id: 'mine', labelKey: 'mgTabMine' },
];

function renderMinigameTabButtons() {
    return MINIGAME_TABS.map(tab => `
        <button type="button" class="mh-minigame-tab-btn${tab.id === activeMinigameTab ? ' active' : ''}" data-mh-minigame-tab="${tab.id}" aria-pressed="${tab.id === activeMinigameTab}">
            <span class="mh-minigame-tab-ico" aria-hidden="true">${MINIGAME_TAB_ICONS[tab.id] || ''}</span>
            <span>${escapeHtml(t(tab.labelKey))}</span>
        </button>
    `).join('');
}

// 本地化辅助：标题与奖励文案按 id 映射到 i18n
function getMinigameTitle(game) {
    if (!game) return t('mgDefaultName');
    const key = 'mg_' + game.id;
    const localized = t(key);
    return localized !== key ? localized : (game.title || t('mgDefaultName'));
}
function getMinigameRewardLabel(game, levelReward) {
    if (game?.id) {
        const key = 'mgr_' + game.id;
        const localized = t(key);
        if (localized !== key) return localized;
    }
    return levelReward?.label || t('mgRewardDefault');
}

// 相对时间：把时间戳格式化成“刚刚 / N 分钟前 / N 小时前 / N 天前…”。
function formatRelativeTime(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return '';
    const diff = Date.now() - value;
    if (diff < 0) return t('timeJustNow');
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const month = 30 * day;
    const year = 365 * day;
    if (diff < minute) return t('timeJustNow');
    if (diff < hour) return t('timeMinutesAgo', { n: Math.floor(diff / minute) });
    if (diff < day) return t('timeHoursAgo', { n: Math.floor(diff / hour) });
    if (diff < month) return t('timeDaysAgo', { n: Math.floor(diff / day) });
    if (diff < year) return t('timeMonthsAgo', { n: Math.floor(diff / month) });
    return t('timeYearsAgo', { n: Math.floor(diff / year) });
}

const PET_STAT_ITEMS = [
    { k: 'bond', labelKey: 'statBond', icon: '💛' },
    { k: 'mood', labelKey: 'statMood', icon: '😊' },
    { k: 'hunger', labelKey: 'statEnergy', icon: '⚡' },
].filter(it => isPlayAffectedStat(it.k));

let cleanupMessageListener = null;
let currentGame = null;
let rewardedRounds = new Set();
let currentPet = null;
let currentGameStartedAt = 0;
let restPromptTimer = null;
let restPromptOpen = false;
let suppressCurrentRewards = false;
let minigameLoadingTimer = null;
// 满 15 秒后记入"最近玩过"的延时定时器（中途退出 / 换游戏会取消）。
let recentRecordTimer = null;
// 当前游玩中游戏的收藏元数据（顶栏收藏按钮据此显示 / 切换收藏状态）。
let currentGameLikeMeta = null;
// 当前"推荐"列表的重渲染函数引用（showList 退出游戏后刷新最近游玩排序 / 时间标签）。
let currentRenderGameList = null;
// 底部标签：'recommend' 官方推荐 | 'create' 创造 | 'mine' 我的
let activeMinigameTab = 'recommend';
let hideTopbarActionsForRoute = false;

export function renderMinigames(panel, { pet }, { onBack, onGameFinished, initialGameId = null, initialGameParams = null, allowPlayWhenLowEnergy = false, suppressRewards = false, hideTopbarActions = false, exitGameToBack = false, completionPrompt = null, deferGameFinishedUntilCompletionExit = false, initialTab = null, onCreateGame = null, onEditGame = null, sharedGame = null } = {}) {
    cleanupMessageListener?.();
    currentGame = null;
    rewardedRounds = new Set();
    currentPet = pet || null;
    suppressCurrentRewards = !!suppressRewards;
    hideTopbarActionsForRoute = !!hideTopbarActions;
    activeMinigameTab = (initialTab && MINIGAME_TABS.some(tab => tab.id === initialTab)) ? initialTab : 'recommend';
    const initialGameConfig = initialGameId ? getPlayItems().find(item => item.id === initialGameId) : null;
    const hideInitialTopbarActions = hideTopbarActionsForRoute || !!initialGameConfig?.hidden;
    const ignoreListClicksUntil = (initialGameId || sharedGame) ? 0 : Date.now() + MINIGAME_ENTRY_CLICK_GUARD_MS;
    let deferredCompletion = null;
    panel.innerHTML = `
        <style>
            @keyframes mhMinigameStatPop {
                0% { transform: scale(1); }
                42% { transform: scale(1.18); }
                100% { transform: scale(1); }
            }
            @keyframes mhMinigameStatFloat {
                0% { opacity: 0; transform: translate(-50%, 5px) scale(.86); }
                18% { opacity: 1; transform: translate(-50%, -2px) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -22px) scale(.96); }
            }
            @keyframes mhMinigameRewardIn {
                0% { opacity: 0; transform: translate(-50%, -44%) scale(.82); }
                18% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
                64% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -58%) scale(.96); }
            }
            @keyframes mhMinigameCoinSpark {
                0% { opacity: 0; transform: translateY(9px) scale(.72); }
                22% { opacity: 1; transform: translateY(0) scale(1); }
                100% { opacity: 0; transform: translateY(-18px) scale(.86); }
            }
            @keyframes mhMinigameLoadingSpin {
                to { transform: rotate(360deg); }
            }
            @keyframes mhMinigameLoadingFloat {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-6px); }
            }
            @keyframes mhMinigameLoadingDot {
                0%, 80%, 100% { opacity: .35; transform: translateY(0); }
                40% { opacity: 1; transform: translateY(-4px); }
            }
            .mh-minigame-stat-pill.stat-up {
                animation: mhMinigameStatPop 1.12s ease-out;
                background: #dcfce7 !important;
                border-color: rgba(34,197,94,.58) !important;
            }
            .mh-minigame-stat-pill.stat-down {
                animation: mhMinigameStatPop 1.12s ease-out;
                background: #fee2e2 !important;
                border-color: rgba(239,68,68,.58) !important;
            }
            .mh-minigame-stat-delta {
                position: absolute;
                left: 50%;
                top: -12px;
                pointer-events: none;
                font-size: 11px;
                font-weight: 900;
                text-shadow: 0 1px 0 rgba(255,255,255,.9);
                animation: mhMinigameStatFloat 1.42s ease-out forwards;
            }
            .mh-minigame-stat-pill {
                cursor: pointer;
            }
            .mh-minigame-tab-btn {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 2px;
                border: 0;
                background: transparent;
                color: #64748b;
                font-size: 12px;
                font-weight: 900;
                cursor: pointer;
                padding: 4px 0;
                box-shadow: none;
            }
            .mh-minigame-tab-btn .mh-minigame-tab-ico { display: inline-flex; line-height: 1; }
            .mh-minigame-tab-btn .mh-minigame-tab-ico svg { width: 22px; height: 22px; display: block; }
            .mh-minigame-tab-btn.active { color: #0ea5e9; }
            .mh-minigame-tab-btn.active .mh-minigame-tab-ico { transform: translateY(-1px); }
            .mh-minigame-mine-grid {
                padding: 14px;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
                gap: 12px;
                align-content: start;
            }
            .mh-minigame-mine-empty {
                grid-column: 1 / -1;
                border: 1.5px dashed rgba(14,165,233,.4);
                border-radius: 14px;
                background: rgba(255,255,255,.6);
                color: var(--text-muted);
                padding: 14px;
                font-size: 13px;
                line-height: 1.45;
                font-weight: 800;
                text-align: center;
            }
            .mh-minigame-mine-card {
                position: relative;
                text-align: center;
                box-sizing: border-box;
                min-height: 184px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                gap: 8px;
                border-radius: 12px;
                cursor: pointer;
            }
            .mh-minigame-mine-card .mh-minigame-mine-del {
                position: absolute;
                top: 4px;
                right: 4px;
                width: 22px;
                height: 22px;
                border-radius: 999px;
                border: 0;
                background: rgba(0,0,0,.06);
                color: rgba(100,116,139,.72);
                font-size: 15px;
                font-weight: 900;
                line-height: 1;
                display: grid;
                place-items: center;
                padding: 0;
                box-shadow: none;
                opacity: 1;
            }
            .mh-minigame-mine-ico { font-size: 44px; line-height: 1; flex: 0 0 auto; }
            .mh-minigame-mine-title { font-weight: 800; color: var(--text-primary); font-size: 16px; line-height: 1.2; text-align: center; width: 100%; min-height: 2.4em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
            .mh-minigame-mine-desc { color: var(--text-muted); font-size: 12px; line-height: 1.35; text-align: center; max-width: 12em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
            .mh-minigame-mine-time { color: var(--text-muted); font-size: 11px; font-weight: 800; line-height: 1.2; opacity: .82; }
            .mh-minigame-mine-actions { display: flex; gap: 6px; width: 100%; margin-top: auto; flex: 0 0 auto; }
            .mh-minigame-mine-actions button { flex: 1; min-width: 0; padding: 7px 6px; font-size: 12px; min-height: 32px; }
            .mh-minigame-icon {
                width: 58px;
                height: 58px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 48px;
                line-height: 1;
            }
            .mh-minigame-icon svg {
                width: 58px;
                height: 58px;
                display: block;
                filter: drop-shadow(0 2px 0 rgba(15,23,42,.18));
            }
            .mh-minigame-coin-pill.coin-up {
                animation: mhMinigameStatPop 1.12s ease-out;
                background: #fef3c7 !important;
                border-color: rgba(217,119,6,.48) !important;
            }
            .mh-minigame-reward-fx {
                position: absolute;
                left: 50%;
                top: 44%;
                z-index: 6;
                pointer-events: none;
                display: none;
                min-width: min(280px, 82vw);
                padding: 16px 18px;
                border-radius: 18px;
                background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,251,235,.98));
                border: 2px solid rgba(245,158,11,.45);
                color: #92400e;
                text-align: center;
                box-shadow: 0 20px 48px rgba(15,23,42,.28), 0 0 0 6px rgba(251,191,36,.16);
            }
            .mh-minigame-reward-fx.show {
                display: block;
                animation: mhMinigameRewardIn 1.62s ease-out forwards;
            }
            .mh-minigame-reward-title {
                font-size: 13px;
                font-weight: 900;
                color: #0f766e;
                margin-bottom: 4px;
            }
            .mh-minigame-reward-coins {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                font-size: 28px;
                line-height: 1.1;
                font-weight: 1000;
            }
            .mh-minigame-reward-note {
                margin-top: 5px;
                font-size: 12px;
                font-weight: 800;
                color: #64748b;
            }
            .mh-minigame-reward-spark {
                position: absolute;
                top: -10px;
                font-size: 18px;
                animation: mhMinigameCoinSpark 1.2s ease-out forwards;
            }
            .mh-minigame-reward-spark:nth-child(1) { left: 18%; animation-delay: .02s; }
            .mh-minigame-reward-spark:nth-child(2) { right: 18%; animation-delay: .12s; }
            .mh-minigame-reward-spark:nth-child(3) { left: 48%; top: -16px; animation-delay: .2s; }
            .mh-minigame-loading {
                position: absolute;
                inset: 0;
                z-index: 4;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 24px;
                color: #0f2747;
                background:
                    radial-gradient(circle at 50% 38%, rgba(224,247,255,.98), rgba(186,230,253,.88) 34%, rgba(15,39,71,.52) 74%),
                    linear-gradient(180deg, rgba(6,18,44,.28), rgba(15,39,71,.54));
                transition: opacity .24s ease;
            }
            .mh-minigame-is-loading #mhMinigameFrame {
                opacity: 0;
                pointer-events: none;
            }
            .mh-minigame-loading.show { display: flex; }
            .mh-minigame-completion {
                position:absolute;
                inset:0;
                z-index:7;
                display:none;
                align-items:flex-end;
                justify-content:center;
                padding:18px 14px max(18px,env(safe-area-inset-bottom));
                pointer-events:none;
                background:linear-gradient(180deg,rgba(15,39,71,0),rgba(15,39,71,.46));
            }
            .mh-minigame-completion.show { display:flex; }
            .mh-minigame-completion-card {
                width:min(360px,calc(100vw - 28px));
                border-radius:18px;
                border:1.5px solid rgba(255,255,255,.78);
                background:rgba(255,255,255,.94);
                color:var(--text-primary);
                padding:14px;
                box-shadow:0 18px 42px rgba(15,39,71,.28),inset 0 1px 0 rgba(255,255,255,.86);
                pointer-events:auto;
            }
            .mh-minigame-completion-title { font-size:18px; line-height:1.2; font-weight:1000; text-align:center; }
            .mh-minigame-completion-text { margin-top:5px; color:var(--text-muted); font-size:13px; line-height:1.38; font-weight:800; text-align:center; }
            .mh-minigame-completion-actions { display:flex; gap:9px; margin-top:12px; }
            .mh-minigame-completion-actions .btn-secondary,
            .mh-minigame-completion-actions .btn-primary { flex:1; min-width:0; }
            .mh-minigame-loading-card {
                width: min(300px, 76vw);
                min-height: 172px;
                padding: 24px 22px 22px;
                border-radius: 22px;
                border: 2px solid rgba(224,247,255,.9);
                background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(219,246,255,.92));
                box-shadow: 0 22px 54px rgba(6,18,44,.34), inset 0 2px 0 rgba(255,255,255,.9), 0 0 0 7px rgba(103,232,249,.14);
                text-align: center;
                animation: mhMinigameLoadingFloat 2.2s ease-in-out infinite;
            }
            .mh-minigame-loading-spinner {
                position: relative;
                width: 64px;
                height: 64px;
                margin: 0 auto 14px;
                border-radius: 50%;
                background: conic-gradient(from 0deg, #67e8f9, #0ea5e9, #8b5cf6, #67e8f9);
                animation: mhMinigameLoadingSpin 1.05s linear infinite;
                box-shadow: 0 8px 18px rgba(14,116,144,.22);
            }
            .mh-minigame-loading-spinner::after {
                content: '';
                position: absolute;
                inset: 8px;
                border-radius: 50%;
                background: linear-gradient(180deg, #ffffff, #e0f7ff);
                box-shadow: inset 0 2px 0 rgba(255,255,255,.86);
            }
            .mh-minigame-loading-title {
                font-size: 20px;
                line-height: 1.2;
                font-weight: 1000;
                color: var(--text-primary);
                text-shadow: 0 1px 0 rgba(255,255,255,.95);
            }
            .mh-minigame-loading-dots {
                display: inline-flex;
                gap: 4px;
                margin-left: 3px;
                vertical-align: .12em;
            }
            .mh-minigame-loading-dots span {
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: #0ea5e9;
                animation: mhMinigameLoadingDot 1s ease-in-out infinite;
            }
            .mh-minigame-loading-dots span:nth-child(2) { animation-delay: .14s; }
            .mh-minigame-loading-dots span:nth-child(3) { animation-delay: .28s; }
            .mh-minigame-loading-subtitle {
                margin-top: 8px;
                font-size: 13px;
                font-weight: 800;
                color: var(--text-muted);
            }
            .mh-minigame-stat-pill.tip-open::after {
                content: attr(data-tip);
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                z-index: 80;
                width: max-content;
                max-width: min(220px, 58vw);
                padding: 8px 10px;
                border-radius: 10px;
                background: rgba(15, 39, 71, .94);
                color: #fff;
                font-size: 12px;
                font-weight: 800;
                line-height: 1.35;
                white-space: normal;
                text-align: left;
                box-shadow: 0 8px 22px rgba(15,23,42,.22);
            }
            .mh-minigame-stat-pill.tip-open::before {
                content: '';
                position: absolute;
                top: calc(100% + 3px);
                right: 13px;
                z-index: 81;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-bottom: 5px solid rgba(15, 39, 71, .94);
            }
            /* 顶栏收藏按钮：仅在游戏游玩中显示，已收藏时显示"已收藏"文案 */
            .mh-minigame-topbar-like {
                height: 30px;
                padding: 0 10px 0 7px;
                border-radius: 999px;
                border: 1px solid rgba(100,116,139,.3);
                background: rgba(255,255,255,.9);
                color: #64748b;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-weight: 900;
                font-size: 12px;
                line-height: 1;
                cursor: pointer;
                box-shadow: 0 2px 0 rgba(100,116,139,.12);
                white-space: nowrap;
            }
            .mh-minigame-topbar-like .mh-minigame-topbar-like-ico { display: inline-flex; line-height: 1; }
            .mh-minigame-topbar-like.liked { background: #fff0f0; border-color: rgba(239,68,68,.5); color: #ef4444; box-shadow: 0 2px 0 rgba(239,68,68,.12); }
            /* emoji 爱心：未收藏灰色（grayscale）；已收藏红色原色 */
            .mh-minigame-heart-emoji { font-size: 16px; line-height: 1; display: inline-block; filter: grayscale(1) opacity(.6); }
            .mh-minigame-heart-emoji.liked { filter: none; }
            /* 分享按钮（我的卡片操作区，emoji 图标） */
            .mh-minigame-mine-actions .mh-minigame-share-btn {
                flex: 0 0 38px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: var(--text-secondary);
                font-size: 16px;
                line-height: 1;
            }
            /* 分享弹窗（复用故事分享样式，本视图未注入 view_story_list 的 style，需自带） */
            .mh-minigame-share-mask { zoom:1 !important; align-items:flex-end; padding:14px 12px max(14px,env(safe-area-inset-bottom)); }
            .mh-minigame-share-mask .mh-story-share-card { width:min(420px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:12px; border-radius:20px 20px 16px 16px; }
            .mh-minigame-share-mask .mh-story-share-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
            .mh-minigame-share-mask .mh-story-share-title { color:var(--text-primary); font-size:18px; font-weight:900; }
            .mh-minigame-share-mask .mh-story-share-subtitle { color:var(--text-secondary); font-size:13px; font-weight:800; margin-top:3px; line-height:1.35; word-break:break-word; }
            .mh-minigame-share-mask .mh-story-share-close { width:34px; height:34px; border-radius:999px; border:1.5px solid var(--border-card); background:#fff; color:var(--text-primary); font-size:22px; line-height:1; display:grid; place-items:center; padding:0; }
            .mh-minigame-share-mask .mh-story-share-preview { border:1.5px solid rgba(14,165,233,.28); border-radius:14px; background:#f8fdff; color:var(--text-primary); padding:10px; font-size:13px; font-weight:900; line-height:1.45; }
            .mh-minigame-share-mask .mh-story-share-link { font-size:12px; color:var(--text-secondary); }
            .mh-minigame-share-mask .mh-story-share-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
            .mh-minigame-share-mask .mh-story-share-actions button { padding:8px 6px; font-size:12px; }
            /* 推荐卡片右上角作者标签 */
            .mh-minigame-owner-tag {
                position: absolute;
                top: 6px;
                right: 6px;
                z-index: 3;
                max-width: 60%;
                padding: 2px 8px;
                border-radius: 999px;
                background: rgba(14,165,233,.14);
                border: 1px solid rgba(14,165,233,.3);
                color: #0369a1;
                font-size: 11px;
                font-weight: 900;
                line-height: 1.5;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
            }
            .mh-minigame-owner-tag.me { background: rgba(34,197,94,.16); border-color: rgba(34,197,94,.36); color: #15803d; }
            /* 推荐卡片左上角"最近玩过"时间标签 */
            .mh-minigame-played-tag {
                position: absolute;
                top: 6px;
                left: 6px;
                z-index: 3;
                max-width: 56%;
                padding: 2px 7px;
                border-radius: 999px;
                background: rgba(100,116,139,.12);
                color: #64748b;
                font-size: 10px;
                font-weight: 900;
                line-height: 1.5;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            /* 用户小游戏弹窗 */
            .mh-minigame-user-mask { zoom:1 !important; align-items:flex-end; padding:14px 12px max(14px,env(safe-area-inset-bottom)); }
            .mh-minigame-user-card { width:min(440px, calc(100vw - 24px)); max-height:min(70vh, 560px); display:flex; flex-direction:column; gap:10px; border-radius:20px 20px 16px 16px; }
            .mh-minigame-user-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
            .mh-minigame-user-title { color:var(--text-primary); font-size:18px; font-weight:900; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .mh-minigame-user-close { width:34px; height:34px; border-radius:999px; border:1.5px solid var(--border-card); background:#fff; color:var(--text-primary); font-size:22px; line-height:1; display:grid; place-items:center; padding:0; flex:0 0 auto; }
            .mh-minigame-user-body { overflow:auto; display:flex; flex-direction:column; gap:8px; }
            .mh-minigame-user-empty { color:var(--text-muted); font-size:13px; font-weight:800; text-align:center; padding:18px 8px; }
            .mh-minigame-user-item { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:10px; border-radius:14px; border:1.5px solid rgba(14,165,233,.22); background:#f8fdff; cursor:pointer; }
            .mh-minigame-user-item-ico { font-size:28px; line-height:1; flex:0 0 auto; }
            .mh-minigame-user-item-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
            .mh-minigame-user-item-title { color:var(--text-primary); font-size:15px; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .mh-minigame-user-item-desc { color:var(--text-muted); font-size:12px; line-height:1.35; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            @media (prefers-reduced-motion: reduce) {
                .mh-minigame-stat-pill.stat-up,
                .mh-minigame-stat-pill.stat-down,
                .mh-minigame-coin-pill.coin-up,
                .mh-minigame-stat-delta,
                .mh-minigame-reward-fx.show,
                .mh-minigame-reward-spark,
                .mh-minigame-completion-card,
                .mh-minigame-loading-card,
                .mh-minigame-loading-spinner,
                .mh-minigame-loading-dots span { animation: none; }
            }
        </style>
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span id="mhMinigameTitle" class="font-bold" style="color:var(--text-primary);flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t('mgPlay'))}</span>
            <div id="mhMinigameTopActions" style="display:${hideInitialTopbarActions ? 'none' : 'flex'};align-items:center;justify-content:flex-end;gap:5px;max-width:min(64vw,440px);overflow:visible">
                ${renderCoinPill('mhMinigameCoins', 'mh-minigame-coin-pill')}
                <button type="button" id="mhMinigameLikeBtn" class="mh-minigame-topbar-like" style="display:none" aria-pressed="false">
                    <span class="mh-minigame-topbar-like-ico" aria-hidden="true">${minigameHeartIcon(false)}</span>
                    <span class="mh-minigame-topbar-like-txt">${escapeHtml(t('mgLike'))}</span>
                </button>
            </div>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow:hidden;background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 46%,#d9f99d 100%)">
            <div id="mhMinigameTabContent" style="position:absolute;inset:0 0 ${initialGameId ? '0' : '58px'} 0;overflow:hidden;display:${initialGameId ? 'none' : 'block'}">
                <div id="mhMinigameList" class="mh-minigame-tab-pane" data-mh-tab-pane="recommend" style="height:100%;overflow:auto;padding:14px;display:${activeMinigameTab === 'recommend' ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;align-content:start">
                    ${renderGameCards(getRecommendItems())}
                </div>
                <div id="mhMinigameMine" class="mh-minigame-tab-pane" data-mh-tab-pane="mine" style="height:100%;overflow:auto;padding:14px;display:${activeMinigameTab === 'mine' ? 'grid' : 'none'};grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;align-content:start"></div>
            </div>
            <div id="mhMinigameTabs" style="position:absolute;left:0;right:0;bottom:0;height:58px;display:${initialGameId ? 'none' : 'flex'};align-items:stretch;background:rgba(255,255,255,.92);border-top:1px solid rgba(14,116,144,.18);box-shadow:0 -2px 10px rgba(15,39,71,.08);z-index:5">
                ${renderMinigameTabButtons()}
            </div>
            <div id="mhMinigameFrameWrap" class="${initialGameId ? 'mh-minigame-is-loading' : ''}" style="display:${initialGameId ? 'block' : 'none'};position:absolute;inset:0;background:#0f2747;z-index:6">
                <iframe id="mhMinigameFrame" title="${escapeHtml(t('mgFrameTitle'))}" style="width:100%;height:100%;border:0;background:#fff" allow="autoplay; fullscreen"></iframe>
                <div id="mhMinigameLoading" class="mh-minigame-loading${initialGameId ? ' show' : ''}" role="status" aria-live="polite" aria-label="${escapeHtml(t('mgLoadingAria'))}" aria-hidden="${initialGameId ? 'false' : 'true'}">
                    <div class="mh-minigame-loading-card">
                        <div class="mh-minigame-loading-spinner" aria-hidden="true"></div>
                        <div class="mh-minigame-loading-title">
                            ${escapeHtml(t('mgLoading'))}<span class="mh-minigame-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                        </div>
                        <div class="mh-minigame-loading-subtitle" id="mhMinigameLoadingName">${escapeHtml(t('mgOpening'))}</div>
                    </div>
                </div>
                <div id="mhMinigameRewardFx" class="mh-minigame-reward-fx" aria-live="polite"></div>
                <div id="mhMinigameCompletion" class="mh-minigame-completion" role="dialog" aria-modal="false" aria-live="polite" aria-hidden="true">
                    <div class="mh-minigame-completion-card">
                        <div class="mh-minigame-completion-title">${escapeHtml(completionPrompt?.title || t('mgCompleteTitle'))}</div>
                        <div class="mh-minigame-completion-text">${escapeHtml(completionPrompt?.text || t('mgCompleteText'))}</div>
                        <div class="mh-minigame-completion-actions">
                            <button type="button" class="btn-secondary" id="mhMinigameContinue">${escapeHtml(completionPrompt?.continueText || t('mgContinuePlay'))}</button>
                            <button type="button" class="btn-primary" id="mhMinigameBackToStory">${escapeHtml(completionPrompt?.backText || t('back'))}</button>
                        </div>
                    </div>
                </div>
                <button type="button" class="btn-primary" id="mhMinigameDone" style="display:none;position:absolute;right:12px;bottom:12px;z-index:3;padding:8px 14px;font-size:13px">${escapeHtml(t('mgDonePlay'))}</button>
            </div>
        </div>`;

    $('mhBack').onclick = () => {
        if (currentGame) {
            if (exitGameToBack) {
                completeDeferredGame();
                cleanupMessageListener?.();
                onBack?.();
                return;
            }
            showList();
            return;
        }
        cleanupMessageListener?.();
        onBack?.();
    };

    // 顶栏收藏按钮（仅游玩中显示）：切换当前游戏收藏状态。
    const likeBtnEl = $('mhMinigameLikeBtn');
    if (likeBtnEl) likeBtnEl.onclick = () => handlePlayLikeToggle();

    // 推荐标签当前条目（官方 + 收藏）按 id 索引，供点击时取回 like-meta 与作品来源。
    let recommendItemsById = new Map();

    function renderGameList() {
        const list = $('mhMinigameList');
        if (!list) return;
        const items = getRecommendItems();
        recommendItemsById = new Map(items.map(item => [String(item.id), item]));
        list.innerHTML = renderGameCards(items);
        currentRenderGameList = renderGameList;
        list.querySelectorAll('[data-game-id]').forEach(card => {
            card.onclick = (e) => {
                // 作者标签：点击查看该用户的全部小游戏，不进入游戏。
                const ownerTag = e.target.closest?.('[data-mh-owner]');
                if (ownerTag) {
                    e.preventDefault();
                    e.stopPropagation();
                    openUserGamesPanel(ownerTag.dataset.mhOwner);
                    return;
                }
                if (e?.isTrusted && Date.now() < ignoreListClicksUntil) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                openRecommendGame(card.dataset.gameId);
            };
        });
    }

    // 打开推荐列表里的条目：官方游戏走 src；收藏的用户作品按 owner+path 拉 HTML。
    // 同时把该条目的 like-meta 传给 openGame，游玩中顶栏收藏按钮据此显示收藏状态。
    async function openRecommendGame(gameId) {
        const item = recommendItemsById.get(String(gameId));
        if (!item) { openGame(gameId); return; }
        if (item.__likedGame) {
            const { owner, path } = item.__likedGame;
            let html = '';
            try {
                const myUsername = state.user?.username || state.sdk?.user?.username;
                html = (owner && owner !== myUsername)
                    ? await loadRemotePetGameHtml(owner, path)
                    : await loadPetGameHtml(path);
            } catch (_) { html = ''; }
            if (!html || !html.trim()) { showToast(t('mgSharedGameMissing'), 'error'); return; }
            openGame(item.id, null, { html, game: { id: item.id, title: item.title, icon: item.icon }, likeMeta: item.__likeMeta });
            return;
        }
        openGame(gameId, null, { likeMeta: item.__likeMeta });
    }

    // 弹窗：展示某个用户创作的全部小游戏，标题为"XXX 的小游戏"。点击即试玩。
    async function openUserGamesPanel(owner) {
        const username = String(owner || '').trim();
        if (!username) return;
        const myUsername = currentUsername();
        const isMe = username === myUsername;
        const panelTitle = isMe ? t('mgMyGamesTitle') : t('mgOwnerGamesTitle', { name: username });
        document.querySelector('.mh-minigame-user-mask')?.remove();
        const mask = document.createElement('div');
        mask.className = 'modal-mask mh-minigame-user-mask';
        mask.innerHTML = `
            <div class="modal-card mh-minigame-user-card">
                <div class="mh-minigame-user-head">
                    <div class="mh-minigame-user-title">${escapeHtml(panelTitle)}</div>
                    <button type="button" class="mh-minigame-user-close" data-mh-user-close aria-label="${escapeHtml(t('mgShareClose'))}">×</button>
                </div>
                <div class="mh-minigame-user-body" data-mh-user-body>
                    <div class="mh-minigame-user-empty">${escapeHtml(t('mgMineLoading'))}</div>
                </div>
            </div>`;
        const close = () => mask.remove();
        mask.addEventListener('click', (e) => {
            if (e.target === mask || e.target.closest?.('[data-mh-user-close]')) { close(); return; }
            const card = e.target.closest?.('[data-mh-user-game]');
            if (card) {
                const path = card.dataset.mhUserGame;
                const title = card.dataset.mhUserTitle || '';
                const icon = card.dataset.mhUserIcon || '🎮';
                close();
                playUserGame(username, path, { title, icon });
            }
        });
        document.body.appendChild(mask);

        let records = [];
        try {
            records = isMe ? await loadPetGameList() : await loadRemotePetGameList(username);
        } catch (_) { records = []; }
        const body = mask.querySelector('[data-mh-user-body]');
        if (!body) return;
        if (!records.length) {
            body.innerHTML = `<div class="mh-minigame-user-empty">${escapeHtml(t('mgOwnerGamesEmpty'))}</div>`;
            return;
        }
        body.innerHTML = records.map(record => `
            <button type="button" class="mh-minigame-user-item" data-mh-user-game="${escapeHtml(record.path)}" data-mh-user-title="${escapeHtml(record.title || '')}" data-mh-user-icon="${escapeHtml(record.icon || '🎮')}">
                <span class="mh-minigame-user-item-ico" aria-hidden="true">${escapeHtml(record.icon || '🎮')}</span>
                <span class="mh-minigame-user-item-text">
                    <span class="mh-minigame-user-item-title">${escapeHtml(record.title || t('mgDefaultName'))}</span>
                    ${record.desc ? `<span class="mh-minigame-user-item-desc">${escapeHtml(record.desc)}</span>` : ''}
                </span>
            </button>
        `).join('');
    }

    // 试玩某用户的小游戏（自己的走本地，别人的走远程拉取 HTML）。
    async function playUserGame(owner, path, { title = '', icon = '🎮' } = {}) {
        const username = String(owner || '').trim();
        const myUsername = currentUsername();
        const isMe = username === myUsername;
        let html = '';
        try {
            html = isMe ? await loadPetGameHtml(path) : await loadRemotePetGameHtml(username, path);
        } catch (_) { html = ''; }
        if (!html || !html.trim()) { showToast(t('mgSharedGameMissing'), 'error'); return; }
        const gameTitle = title || t('mgDefaultName');
        const gameIcon = icon || '🎮';
        const baseName = String(path).replace(/\.html?$/i, '').split('/').pop();
        const gameId = `user:${username}:${baseName}`;
        openGame(gameId, null, {
            allowLowEnergy: true,
            html,
            game: { id: gameId, title: gameTitle, icon: gameIcon },
            // 收藏键以 owner + 基础名（baseName）为准，与"我的"卡片收藏保持一致。
            likeMeta: {
                id: baseName,
                path: String(path).replace(/^\/+/, ''),
                owner: username,
                title: gameTitle,
                icon: gameIcon,
            },
        });
    }
    renderGameList();
    const showCompletionAfterFinish = completionPrompt ? showGameCompletionPrompt : null;
    $('mhMinigameDone').onclick = () => finishCurrentGame(onGameFinished);
    $('mhMinigameContinue')?.addEventListener('click', () => {
        hideGameCompletionPrompt();
        postGameContinue();
    });
    $('mhMinigameBackToStory')?.addEventListener('click', () => {
        hideGameCompletionPrompt();
        completeDeferredGame();
        cleanupMessageListener?.();
        onBack?.();
    });
    bindStatTips(panel);

    // ---------- 底部标签（推荐 / 创造 / 我的） ----------
    function setTabButtonsActive() {
        document.querySelectorAll('[data-mh-minigame-tab]').forEach(btn => {
            const active = btn.dataset.mhMinigameTab === activeMinigameTab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function switchTab(tabId) {
        if (!MINIGAME_TABS.some(tab => tab.id === tabId)) return;
        // "创造"是全屏 AI 创作工坊（独立路由），不在本视图内切换，直接跳转。
        if (tabId === 'create') {
            onCreateGame?.();
            return;
        }
        activeMinigameTab = tabId;
        setTabButtonsActive();
        const list = $('mhMinigameList');
        const mine = $('mhMinigameMine');
        if (list) list.style.display = tabId === 'recommend' ? 'grid' : 'none';
        if (mine) mine.style.display = tabId === 'mine' ? 'grid' : 'none';
        if (tabId === 'mine') renderMineList();
    }

    function bindTabButtons() {
        document.querySelectorAll('[data-mh-minigame-tab]').forEach(btn => {
            btn.onclick = () => switchTab(btn.dataset.mhMinigameTab);
        });
    }
    bindTabButtons();

    async function renderMineList() {
        const mine = $('mhMinigameMine');
        if (!mine) return;
        const token = cleanupMessageListener;
        mine.innerHTML = `<div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineLoading'))}</div>`;
        let records = [];
        try {
            records = await loadPetGameList();
        } catch (e) {
            if (cleanupMessageListener !== token || !$('mhMinigameMine')) return;
            mine.innerHTML = `<div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineLoadFailed'))}</div>`;
            return;
        }
        if (cleanupMessageListener !== token || !$('mhMinigameMine') || activeMinigameTab !== 'mine') return;
        mine.innerHTML = renderMineCards(records);
        bindMineCards(records);
    }

    // 我的作品收藏记录：owner = 当前用户名，path = 文件路径。
    function mineGameLikeMeta(record, myUsername) {
        return {
            id: record.id || record.path,
            path: record.path || '',
            src: '',
            owner: String(myUsername || ''),
            title: record.title || t('mgDefaultName'),
            icon: record.icon || '🎮',
            desc: record.desc || '',
            official: false,
        };
    }

    function renderMineCards(records) {
        if (!records.length) {
            return `<div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineEmpty'))}</div>`;
        }
        return records.map(record => {
            const updatedLabel = formatRelativeTime(record.updatedAt);
            return `
            <div class="card-flat mh-minigame-mine-card" data-mh-mine-path="${escapeHtml(record.path)}">
                <button type="button" class="mh-minigame-mine-del" data-mh-mine-delete="${escapeHtml(record.path)}" aria-label="${escapeHtml(t('mgMineDelete'))}" title="${escapeHtml(t('mgMineDelete'))}">×</button>
                <span class="mh-minigame-mine-ico" aria-hidden="true">${escapeHtml(record.icon || '🎮')}</span>
                <span class="mh-minigame-mine-title">${escapeHtml(record.title || t('mgDefaultName'))}</span>
                ${record.desc ? `<span class="mh-minigame-mine-desc">${escapeHtml(record.desc)}</span>` : ''}
                ${updatedLabel ? `<span class="mh-minigame-mine-time">${escapeHtml(updatedLabel)}</span>` : ''}
                <div class="mh-minigame-mine-actions">
                    <button type="button" class="btn-secondary mh-minigame-share-btn" data-mh-mine-share="${escapeHtml(record.path)}" aria-label="${escapeHtml(t('mgShare'))}" title="${escapeHtml(t('mgShare'))}"><span aria-hidden="true">🔗</span></button>
                    <button type="button" class="btn-primary" data-mh-mine-edit="${escapeHtml(record.path)}">${escapeHtml(t('slEdit'))}</button>
                </div>
            </div>
        `;
        }).join('');
    }

    function bindMineCards(records) {
        const mine = $('mhMinigameMine');
        if (!mine) return;
        mine.onclick = async (e) => {
            const delBtn = e.target.closest?.('[data-mh-mine-delete]');
            if (delBtn) {
                const path = delBtn.dataset.mhMineDelete;
                const record = records.find(r => r.path === path);
                const title = record?.title || t('mgDefaultName');
                const ok = await confirm(t('mgMineDeleteConfirm', { title }), { okText: t('delete'), cancelText: t('cancel') });
                if (!ok) return;
                delBtn.disabled = true;
                try {
                    await deletePetGame(path);
                    showToast(t('mgMineDeleted'), 'success', 1400);
                    renderMineList();
                } catch (err) {
                    delBtn.disabled = false;
                    showToast(t('mgMineDeleteFailed', { error: (err?.message || err) }), 'error', 2400);
                }
                return;
            }
            const editBtn = e.target.closest?.('[data-mh-mine-edit]');
            if (editBtn) {
                openMineGameMaker(editBtn.dataset.mhMineEdit, records);
                return;
            }
            const shareBtn = e.target.closest?.('[data-mh-mine-share]');
            if (shareBtn) {
                const record = records.find(r => r.path === shareBtn.dataset.mhMineShare);
                if (record) openMinigameSharePanel(record);
                return;
            }
            // 点击卡片任意非按钮区域即试玩。
            const card = e.target.closest?.('[data-mh-mine-path]');
            if (card) {
                openMineGame(card.dataset.mhMinePath, records);
            }
        };
    }

    async function openMineGameMaker(path, records) {
        const record = records.find(r => r.path === path);
        if (!record) { showToast(t('mgMineMissing'), 'error'); return; }
        let html = '';
        try {
            html = await loadPetGameHtml(path);
        } catch (_) { html = ''; }
        // 进入全屏 AI 创作工坊编辑（独立路由）。
        onEditGame?.(record, html);
    }

    async function openMineGame(path, records) {
        const record = records.find(r => r.path === path);
        if (!record) { showToast(t('mgMineMissing'), 'error'); return; }
        let html = '';
        try {
            html = await loadPetGameHtml(path);
        } catch (e) {
            showToast(t('mgMineLoadFailed'), 'error');
            return;
        }
        if (!html || !html.trim()) { showToast(t('mgMineMissing'), 'error'); return; }
        const myUsername = state.user?.username || state.sdk?.user?.username || '';
        openGame(record.id || record.path, null, {
            html,
            game: { id: record.id || record.path, title: record.title, icon: record.icon },
            likeMeta: mineGameLikeMeta(record, myUsername),
        });
    }

    const onMessage = (event) => {
        const frame = $('mhMinigameFrame');
        if (!frame || event.source !== frame.contentWindow) return;
        const msg = event.data || {};
        if (isPetImageRequest(msg)) {
            handlePetImageRequest(frame, msg);
            return;
        }
        if (isUserProfileRequest(msg)) {
            handleUserProfileRequest(frame, msg);
            return;
        }
        if (isUserProfileUpdate(msg)) {
            handleUserProfileUpdate(frame, msg);
            return;
        }
        if (msg.type === 'gameLoaded') {
            setMinigameLoading(false);
            return;
        }
        if (msg.type === 'gameFinished' || msg.type === 'learningFinished') {
            if (deferGameFinishedUntilCompletionExit && completionPrompt) {
                const result = finishCurrentGame(null, msg.data || {}, showCompletionAfterFinish, { forcePrompt: true });
                if (result) deferredCompletion = { game: currentGame, data: result };
            } else {
                finishCurrentGame(onGameFinished, msg.data || {}, showCompletionAfterFinish);
            }
        }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('mh:tick', refreshPetStats);
    cleanupMessageListener = () => {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('mh:tick', refreshPetStats);
        destroyMinigameIframe();
        currentGame = null;
        currentGameLikeMeta = null;
        currentRenderGameList = null;
        rewardedRounds = new Set();
        currentPet = null;
        currentGameStartedAt = 0;
        suppressCurrentRewards = false;
        hideTopbarActionsForRoute = false;
        clearMinigameRestPrompt();
        clearRecentPlayTimer();
        cleanupMessageListener = null;
    };
    // 若初始标签为"我的"（从创作工坊返回），加载列表。
    // 必须在 cleanupMessageListener 赋值之后调用，否则 renderMineList 捕获的 token 过期会丢弃结果。
    if (activeMinigameTab === 'mine') renderMineList();
    // 按需加载小游戏清单（只 fetch 一次并缓存），加载完成后渲染列表 / 启动初始游戏。
    const renderToken = cleanupMessageListener;
    if (MINIGAMES.length) {
        renderGameList();
        if (initialGameId && !currentGame) openGame(initialGameId, initialGameParams, { allowLowEnergy: allowPlayWhenLowEnergy });
    } else {
        loadMinigameIndex().then(() => {
            // 视图在加载期间被销毁/重渲染时丢弃过期回调。
            if (cleanupMessageListener !== renderToken || !$('mhMinigameList')) return;
            renderGameList();
            if (initialGameId && !currentGame) openGame(initialGameId, initialGameParams, { allowLowEnergy: allowPlayWhenLowEnergy });
        });
    }
    // 收藏列表 + 最近游玩记录异步加载完成后刷新"推荐"，让收藏作品、爱心状态、最近游玩排序与时间标签显示出来。
    Promise.all([ensureLikedGames(), ensureRecentGames()]).then(() => {
        if (cleanupMessageListener !== renderToken) return;
        if (activeMinigameTab === 'recommend' && $('mhMinigameList')) renderGameList();
    });
    // 分享链接进入：从别人 workspace 拉取小游戏 HTML 并直接试玩。
    if (sharedGame && !initialGameId && !currentGame) {
        openSharedGame(sharedGame);
    }

    async function openSharedGame({ fromUsername, game } = {}) {
        const username = String(fromUsername || '').trim();
        const filename = String(game || '').trim();
        if (!username || !filename) return;
        let html = '';
        try {
            const myUsername = state.user?.username || state.sdk?.user?.username;
            html = (username === myUsername)
                ? await loadPetGameHtml(filename)
                : await loadRemotePetGameHtml(username, filename);
        } catch (_) { html = ''; }
        if (cleanupMessageListener !== renderToken || !$('mhMinigameFrameWrap')) return;
        if (!html || !html.trim()) { showToast(t('mgSharedGameMissing'), 'error', 2400); return; }
        const baseName = filename.replace(/\.html?$/i, '').split('/').pop();
        const sharedId = `shared:${username}:${baseName}`;
        const sharedPath = String(filename).replace(/^\/+/, '').includes('/') ? filename : `pet-games/${filename}`;
        openGame(sharedId, null, {
            allowLowEnergy: true,
            html,
            game: { id: sharedId, title: t('mgSharedGameTitle'), icon: '🎮' },
            // 收藏键以 owner + 基础名（baseName）为准。
            likeMeta: {
                id: baseName,
                path: sharedPath,
                owner: username,
                title: t('mgSharedGameTitle'),
                icon: '🎮',
            },
        });
    }

    function showGameCompletionPrompt() {
        if (!completionPrompt) return;
        const prompt = $('mhMinigameCompletion');
        if (!prompt) return;
        prompt.classList.add('show');
        prompt.setAttribute('aria-hidden', 'false');
    }

    function hideGameCompletionPrompt() {
        const prompt = $('mhMinigameCompletion');
        if (!prompt) return;
        prompt.classList.remove('show');
        prompt.setAttribute('aria-hidden', 'true');
    }

    function completeDeferredGame() {
        if (!deferredCompletion) return false;
        const { game, data } = deferredCompletion;
        deferredCompletion = null;
        onGameFinished?.(game, data);
        return true;
    }

    function postGameContinue() {
        const frame = $('mhMinigameFrame');
        try { frame?.contentWindow?.postMessage({ type: 'gameContinue' }, '*'); } catch (_) {}
    }

    function renderGameCards(items) {
        if (!items.length) return '';
        return items.map(game => {
            const owner = String(game.__owner || '').trim();
            const tag = owner ? ownerTagLabel(owner) : '';
            const isMe = owner && owner === currentUsername();
            const tagTitle = isMe ? t('mgMyGamesTitle') : t('mgOwnerGamesTitle', { name: owner });
            const ownerTag = tag
                ? `<span class="mh-minigame-owner-tag${isMe ? ' me' : ''}" data-mh-owner="${escapeHtml(owner)}" role="button" tabindex="0" title="${escapeHtml(tagTitle)}" aria-label="${escapeHtml(tagTitle)}">${escapeHtml(tag)}</span>`
                : '';
            // 最近游玩时间（左上角，如"1 天前"）。
            const playedLabel = game.__playedAt ? formatRelativeTime(game.__playedAt) : '';
            const playedTag = playedLabel
                ? `<span class="mh-minigame-played-tag" title="${escapeHtml(t('mgLastPlayed', { time: playedLabel }))}">${escapeHtml(playedLabel)}</span>`
                : '';
            return `
            <button type="button" class="card-flat" data-game-id="${escapeHtml(game.id)}" style="position:relative;text-align:center;min-height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-radius:12px;cursor:pointer">
                ${playedTag}
                ${ownerTag}
                ${renderMinigameIcon(game)}
                <span style="font-weight:800;color:var(--text-primary);font-size:17px;line-height:1.2">${escapeHtml(getMinigameTitle(game))}</span>
                ${game.desc ? `<span style="color:var(--text-muted);font-size:12px;line-height:1.35;max-width:12em">${escapeHtml(game.desc)}</span>` : ''}
            </button>`;
        }).join('');
    }

    function renderMinigameIcon(game) {
        const label = escapeHtml(getMinigameTitle(game));
        if (game.id === 'flappy_pet') {
            return `
                <span class="mh-minigame-icon" role="img" aria-label="${label}">
                    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                        <path d="M9 31c9-13 23-15 35-8 7 4 11 11 12 20-8-8-17-11-26-9-8 1-14 1-21-3Z" fill="#67e8f9" stroke="#06172d" stroke-width="4" stroke-linejoin="round"/>
                        <path d="M18 29c-3-12 3-20 14-22-1 10 3 17 10 22-10 3-17 3-24 0Z" fill="#38bdf8" stroke="#06172d" stroke-width="4" stroke-linejoin="round"/>
                        <path d="M36 25c5-5 12-5 19-1-6 3-10 7-12 13-2-5-4-9-7-12Z" fill="#fde68a" stroke="#06172d" stroke-width="4" stroke-linejoin="round"/>
                        <circle cx="42" cy="24" r="3" fill="#06172d"/>
                        <path d="M52 27l7 3-7 3Z" fill="#fb923c" stroke="#06172d" stroke-width="3" stroke-linejoin="round"/>
                        <path d="M18 42c5 1 10 0 15-3" fill="none" stroke="#06172d" stroke-width="4" stroke-linecap="round"/>
                    </svg>
                </span>
            `;
        }
        if (game.id === 'gomoku') {
            return `
                <span class="mh-minigame-icon" role="img" aria-label="${label}">
                    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                        <rect x="9" y="9" width="46" height="46" rx="8" fill="#f8c76d" stroke="#06172d" stroke-width="4"/>
                        <path d="M20 13v38M32 13v38M44 13v38M13 20h38M13 32h38M13 44h38" stroke="#a16207" stroke-width="2.5" stroke-linecap="round"/>
                        <circle cx="20" cy="20" r="7" fill="#020617"/>
                        <circle cx="32" cy="32" r="7" fill="#ffffff" stroke="#020617" stroke-width="3"/>
                        <circle cx="44" cy="44" r="7" fill="#020617"/>
                        <circle cx="44" cy="20" r="7" fill="#ffffff" stroke="#020617" stroke-width="3"/>
                        <circle cx="20" cy="44" r="7" fill="#020617"/>
                    </svg>
                </span>
            `;
        }
        return `<span class="mh-minigame-icon" role="img" aria-label="${label}">${game.icon}</span>`;
    }
}

function isPetImageRequest(msg) {
    const type = String(msg?.type || '');
    return MINIGAME_PET_IMAGE_REQUESTS.has(type) || MINIGAME_ALL_PET_IMAGE_REQUESTS.has(type);
}

function isUserProfileRequest(msg) {
    return MINIGAME_USER_PROFILE_REQUESTS.has(String(msg?.type || ''));
}

function isUserProfileUpdate(msg) {
    return MINIGAME_USER_PROFILE_UPDATES.has(String(msg?.type || ''));
}

// 收集可暴露给小游戏的用户档案：星球名、昵称、用户名、性别、头像。
// 仅暴露展示用字段，绝不包含 token / id 等敏感信息。
function buildUserProfilePayload() {
    const user = state.user && typeof state.user === 'object' ? state.user : {};
    const nickname = (user.nickname || user.name || user.displayName || user.username || '').toString().trim();
    const username = (user.username || '').toString().trim();
    // keepwork 用户性别字段历史上可能是 sex / gender，0/1/2 或字符串，统一归一化。
    let gender = '';
    const rawGender = user.gender != null ? user.gender : user.sex;
    if (rawGender === 1 || rawGender === '1' || rawGender === 'male' || rawGender === 'm') gender = 'male';
    else if (rawGender === 2 || rawGender === '2' || rawGender === 'female' || rawGender === 'f') gender = 'female';
    else if (typeof rawGender === 'string' && rawGender.trim()) gender = rawGender.trim();
    return {
        planetName: (state.planetName || '').toString(),
        nickname,
        username,
        gender,
        portrait: (user.portrait || user.avatar || '').toString(),
    };
}

// 处理小游戏的 haqi_get_user_profile 请求，回传当前用户档案。
function handleUserProfileRequest(frame, msg) {
    const sourceWindow = frame?.contentWindow;
    if (!sourceWindow) return;
    const requestId = msg.requestId || msg.id || null;
    try {
        sourceWindow.postMessage({
            type: 'haqi_user_profile',
            requestId,
            ok: true,
            data: buildUserProfilePayload(),
        }, '*');
    } catch (e) {
        try {
            sourceWindow.postMessage({
                type: 'haqi_user_profile',
                requestId,
                ok: false,
                error: e?.message || String(e),
            }, '*');
        } catch (_) {}
    }
}

// 处理小游戏的 haqi_set_user_profile 回写：目前支持重命名星球与昵称。
// 昵称变更仅写入内存中的 state.user（用于本会话称呼），不强制同步到 keepwork 账号资料；
// 星球名通过 setPlanetName + 防抖落盘持久化。
function handleUserProfileUpdate(frame, msg) {
    const data = (msg && typeof msg.data === 'object' && msg.data) || {};
    let changed = false;

    if (typeof data.planetName === 'string') {
        const next = data.planetName.trim().slice(0, 80);
        if (next && next !== state.planetName) {
            setPlanetName(next);
            changed = true;
        }
    }

    if (typeof data.nickname === 'string') {
        const nick = data.nickname.trim().slice(0, 40);
        if (nick) {
            if (!state.user || typeof state.user !== 'object') state.user = {};
            // 仅更新展示昵称，保留 username / id 等账号标识不变。
            if (state.user.nickname !== nick) {
                state.user.nickname = nick;
                changed = true;
            }
        }
    }

    if (changed) {
        try { saveUserProfileDebounced(); } catch (_) {}
    }

    // 回执最新档案，便于小游戏确认写入结果。
    const sourceWindow = frame?.contentWindow;
    if (sourceWindow) {
        try {
            sourceWindow.postMessage({
                type: 'haqi_user_profile',
                requestId: msg.requestId || msg.id || null,
                ok: true,
                data: buildUserProfilePayload(),
            }, '*');
        } catch (_) {}
    }
}

// 供其它内嵌游戏 iframe 的视图（如创作工坊预览 view_game_maker）复用宠物形象请求处理：
// 让「创作工坊里预览的小游戏」也能像正式 minigame 一样拿到宠物图像，
// 而不必各自重复实现 haqi_get_pet_image(s) 协议。
// 返回 true 表示这条消息是宠物形象请求并已处理（调用方可据此短路）。
// 宠物解析回退到 state.currentPetId，因此即便 minigame 视图未打开也能工作。
export function handleMinigamePetMessage(frame, msg) {
    if (!isPetImageRequest(msg)) return false;
    handlePetImageRequest(frame, msg);
    return true;
}

// 主动向某个内嵌游戏 iframe 推送当前宠物配置（setGameConfig + active_pet_config 形象）。
// 与 minigame 正式播放时一致：iframe 加载后立刻推送一次，无需等待游戏先发请求。
// 供 view_game_maker 预览复用，使预览里的游戏与正式 minigame 行为一致。
export async function pushActivePetConfigToFrame(frame) {
    if (!frame?.contentWindow) return;
    const pet = await requestedPetForMinigame({});
    if (!frame?.contentWindow || !pet) return;
    try {
        frame.contentWindow.postMessage({
            type: 'setGameConfig',
            data: {
                petId: pet.id || '',
                petName: displayPetName(pet),
                masterStyle: localStorage.getItem('haqiAdventureMasterV1') || undefined,
                // 一并附带用户档案，便于新手领养类小游戏预填星球名 / 称呼。
                ...buildUserProfilePayload(),
            },
        }, '*');
    } catch (_) {}
    try {
        const image = await buildPetImagePayload(pet, { anim: 'happy', petId: pet.id });
        frame.contentWindow?.postMessage({
            type: 'haqi_pet_image',
            requestId: 'active_pet_config',
            ok: true,
            data: image,
        }, '*');
    } catch (_) {}
}

async function handlePetImageRequest(frame, msg) {
    const type = String(msg?.type || '');
    const requestId = msg.requestId || msg.id || null;
    const sourceWindow = frame?.contentWindow;
    if (!sourceWindow) return;

    try {
        if (MINIGAME_ALL_PET_IMAGE_REQUESTS.has(type)) {
            const pets = await currentPlanetPetsForMinigame();
            const results = await Promise.allSettled(pets.map(pet => buildPetImagePayload(pet, msg)));
            const images = results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
            const errors = results
                .map((result, index) => result.status === 'rejected'
                    ? { petId: pets[index]?.id || '', error: result.reason?.message || String(result.reason) }
                    : null)
                .filter(Boolean);
            sourceWindow.postMessage({
                type: 'haqi_pet_images',
                requestId,
                ok: true,
                data: {
                    pets: images,
                    count: images.length,
                    max: 10,
                    errors,
                },
            }, '*');
            return;
        }

        const pet = await requestedPetForMinigame(msg);
        const image = await buildPetImagePayload(pet, msg);
        sourceWindow.postMessage({
            type: 'haqi_pet_image',
            requestId,
            ok: true,
            data: image,
        }, '*');
    } catch (e) {
        sourceWindow.postMessage({
            type: MINIGAME_ALL_PET_IMAGE_REQUESTS.has(type) ? 'haqi_pet_images' : 'haqi_pet_image',
            requestId,
            ok: false,
            error: e?.message || String(e),
        }, '*');
    }
}

async function requestedPetForMinigame(msg) {
    // 1) 显式指定的 petId（来自 setGameConfig 等）。
    const petId = msg?.petId || msg?.data?.petId;
    if (petId) {
        const pet = state.pets?.[petId] || await getPetAsync(petId);
        if (pet) return pet;
    }
    // 2) 当前激活宠物（按其当前阶段渲染形象）。视图打开时已缓存的 currentPet 优先，
    //    其次回退到全局 currentPetId —— 两者都通过按需加载器确保 pet.json 已就绪。
    const activeId = currentPet?.id || state.currentPetId || null;
    if (activeId) {
        const pet = state.pets?.[activeId] || await getPetAsync(activeId);
        if (pet) return pet;
    }
    // 3) 兜底：渲染时传入的临时 pet 对象（如孵化预览，可能没有 id / 未入 state.pets）。
    return currentPet || null;
}

async function currentPlanetPetsForMinigame() {
    const ids = state.petOrder || [];
    const ordered = ids.map(id => getPet(id)).filter(pet => pet && isPetOnCurrentPlanet(pet));
    const activeId = currentPet?.id || state.currentPetId || null;
    if (activeId) {
        const current = state.pets?.[activeId] || currentPet || await getPetAsync(activeId);
        if (current) {
            return [current, ...ordered.filter(pet => pet.id !== activeId)].slice(0, 10);
        }
    }
    return ordered.slice(0, 10);
}

// 宠物图像数据（blob + uv）由 pet.js 统一提供（单一来源），这里只做转发。
// anim 兼容 msg.anim / msg.data.anim 两种调用约定。
function buildPetImagePayload(pet, msg = {}) {
    const anim = msg?.anim || msg?.data?.anim;
    return getPetImagePayload(pet, { anim });
}

function statValue(pet, key) {
    const stats = pet?.stats || {};
    return Math.max(0, Math.min(100, Math.round(stats[key] ?? 0)));
}

function statTone(value) {
    if (value < 25) return '#dc2626';
    if (value < 50) return '#d97706';
    return '#0f766e';
}

function renderPetStatPills(pet) {
    return PET_STAT_ITEMS.map((it) => {
        const value = statValue(pet, it.k);
        const label = t(it.labelKey);
        const tip = petStatTip(it.k, label, value, playStatDelta(it.k));
        return `
            <span class="mh-minigame-stat-pill" data-mh-minigame-stat-pill="${it.k}" data-tip="${escapeHtml(tip)}" tabindex="0" title="${escapeHtml(label)} ${value}" aria-label="${escapeHtml(label)} ${value}"
                style="position:relative;height:30px;min-width:38px;padding:0 6px;border-radius:999px;background:rgba(255,255,255,.82);border:1px solid rgba(14,116,144,.22);display:inline-flex;align-items:center;justify-content:center;gap:2px;font-weight:900;font-size:12px;color:${statTone(value)};box-shadow:0 2px 0 rgba(14,116,144,.12)">
                <span aria-hidden="true" style="font-size:14px;line-height:1">${it.icon}</span>
                <span data-mh-minigame-stat="${it.k}">${value}</span>
            </span>
        `;
    }).join('');
}

function coinValue() {
    return Math.max(0, Math.round(Number(state.coins) || 0));
}

function renderCoinPill(id, className) {
    return `
        <span class="${className} mh-coin-amount" id="${id}" title="${escapeHtml(t('mgCoinTip'))}" aria-label="${escapeHtml(t('coins'))} ${coinValue()}"
            style="position:relative;height:30px;min-width:46px;padding:0 7px;border-radius:999px;background:rgba(255,255,255,.86);border:1px solid rgba(217,119,6,.24);display:inline-flex;align-items:center;justify-content:center;gap:3px;font-weight:900;font-size:12px;color:var(--accent-dark);box-shadow:0 2px 0 rgba(217,119,6,.12)">
            ${coinIconSvg()}
            <span data-mh-minigame-coins>${coinValue()}</span>
        </span>
    `;
}

function refreshCoins({ previous = null, animate = false } = {}) {
    const value = coinValue();
    document.querySelectorAll('[data-mh-minigame-coins]').forEach((el) => {
        el.textContent = String(value);
        const pill = el.closest('.mh-minigame-coin-pill');
        if (pill) {
            pill.title = t('mgCoinTip');
            pill.setAttribute('aria-label', `${t('coins')} ${value}`);
            if (animate && typeof previous === 'number' && value !== previous) {
                animateCoinPill(pill, value - previous);
            }
        }
    });
}

function animateCoinPill(pill, delta) {
    pill.classList.remove('coin-up');
    pill.querySelectorAll('.mh-minigame-stat-delta').forEach(el => el.remove());
    void pill.offsetWidth;
    pill.classList.add('coin-up');

    const badge = document.createElement('span');
    badge.className = 'mh-minigame-stat-delta';
    badge.style.color = delta > 0 ? '#d97706' : '#dc2626';
    badge.textContent = `${delta > 0 ? '+' : ''}${delta}`;
    pill.appendChild(badge);

    setTimeout(() => {
        pill.classList.remove('coin-up');
        badge.remove();
    }, STAT_REWARD_ANIMATION_MS);
}

function playStatDelta(key) {
    return Number(CONFIG.actions.play?.[key]) || 0;
}

function isPlayAffectedStat(key) {
    if (typeof CONFIG.actions.play?.[key] === 'number') return true;
    return false;
}

function miniGameStatBonus(game) {
    return game?.statBonus || DEFAULT_MINIGAME_STAT_BONUS;
}

function levelRewardConfig(game) {
    return game?.levelReward && typeof game.levelReward === 'object' ? game.levelReward : null;
}

function levelRewardCoinRange(levelReward) {
    if (!levelReward) return null;
    const coins = levelReward.coins && typeof levelReward.coins === 'object' ? levelReward.coins : levelReward;
    const min = Math.max(0, Math.round(Number(coins.min ?? coins.coinMin ?? 10) || 10));
    const max = Math.max(min, Math.round(Number(coins.max ?? coins.coinMax ?? 50) || 50));
    return { min, max };
}

function miniGameLevelReward(game, data = {}, durationSeconds = 0) {
    const levelReward = levelRewardConfig(game);
    const range = levelRewardCoinRange(levelReward);
    if (!levelReward || !range) return { levelReward: null, rewardCoins: null };
    const explicit = Number(data.rewardCoins ?? data.coins ?? data.levelReward?.rewardCoins);
    const rewardCoins = Number.isFinite(explicit)
        ? clamp(Math.round(explicit), range.min, range.max)
        : calculateLevelRewardCoins(levelReward, range, data, durationSeconds);
    return {
        levelReward: {
            ...levelReward,
            coins: range,
            rewardCoins,
        },
        rewardCoins,
    };
}

function calculateLevelRewardCoins(levelReward, range, data = {}, durationSeconds = 0) {
    const score = Math.max(0, Number(data.earnedPoints ?? data.score) || 0);
    const level = Math.max(0, Number(data.level ?? data.difficulty) || 0);
    const scoreDivisor = Math.max(1, Number(levelReward.scoreDivisor) || 16);
    const levelBonus = Math.max(0, Math.round(level * (Number(levelReward.levelBonus) || 2)));
    const scoreBonus = Math.min(22, Math.round(score / scoreDivisor));
    const timeBonus = Math.min(10, Math.round(Math.max(0, durationSeconds) / 30));
    const passBonus = Math.max(0, Math.round(Number(levelReward.passBonus) || 0));
    return clamp(range.min + passBonus + scoreBonus + levelBonus + timeBonus, range.min, range.max);
}

function canPlayGame(pet) {
    return statValue(pet, 'hunger') >= Math.abs(Number(CONFIG.actions.play?.hunger) || 0);
}

function petStatTip(key, label, value, delta) {
    const effect = delta > 0 ? t('mgStatAfterPlay', { delta }) : t('mgStatAfterPlayNeg', { delta });
    return `${label} ${value} · ${effect}`;
}

function bindStatTips(root) {
    root.querySelectorAll('[data-mh-minigame-stat-pill]').forEach((pill) => {
        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = pill.classList.contains('tip-open');
            closeStatTips(root);
            if (!wasOpen) {
                pill.classList.add('tip-open');
                document.addEventListener('click', () => closeStatTips(root), { once: true });
            }
        });
        pill.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pill.click();
            } else if (e.key === 'Escape') {
                closeStatTips(root);
            }
        });
    });
}

function closeStatTips(root = document) {
    root.querySelectorAll?.('[data-mh-minigame-stat-pill].tip-open').forEach(el => el.classList.remove('tip-open'));
}

function capturePetStatValues(pet) {
    return PET_STAT_ITEMS.reduce((values, it) => {
        values[it.k] = statValue(pet, it.k);
        return values;
    }, {});
}

function refreshPetStats({ previous = null, animate = false } = {}) {
    refreshCoins();
    if (!currentPet) return;
    PET_STAT_ITEMS.forEach((it) => {
        const value = statValue(currentPet, it.k);
        document.querySelectorAll(`[data-mh-minigame-stat="${it.k}"]`).forEach((el) => {
            el.textContent = String(value);
            const pill = el.closest('[data-mh-minigame-stat-pill]');
            if (pill) {
                const label = t(it.labelKey);
                pill.style.color = statTone(value);
                pill.title = `${label} ${value}`;
                pill.setAttribute('aria-label', `${label} ${value}`);
                pill.dataset.tip = petStatTip(it.k, label, value, playStatDelta(it.k));
                const oldValue = previous?.[it.k];
                if (animate && typeof oldValue === 'number' && oldValue !== value) {
                    animateStatPill(pill, value - oldValue);
                }
            }
        });
    });
}

function animateStatPill(pill, delta) {
    pill.classList.remove('stat-up', 'stat-down');
    pill.querySelectorAll('.mh-minigame-stat-delta').forEach(el => el.remove());
    void pill.offsetWidth;
    const className = delta > 0 ? 'stat-up' : 'stat-down';
    pill.classList.add(className);

    const badge = document.createElement('span');
    badge.className = 'mh-minigame-stat-delta';
    badge.style.color = delta > 0 ? '#16a34a' : '#dc2626';
    badge.textContent = `${delta > 0 ? '+' : ''}${delta}`;
    pill.appendChild(badge);

    setTimeout(() => {
        pill.classList.remove(className);
        badge.remove();
    }, STAT_REWARD_ANIMATION_MS);
}

// html / game：玩家自创小游戏会直接传入 HTML 正文 + 合成 game 对象，通过 srcdoc 加载；
// 官方游戏走 game.src + minigameUrl。
function openGame(gameId, params = null, { allowLowEnergy = false, html = null, game: providedGame = null, likeMeta = null } = {}) {
    const game = providedGame || getPlayItems().find(item => item.id === gameId);
    if (!game) return;
    if (!allowLowEnergy && !canPlayGame(currentPet)) {
        refreshPetStats();
        showToast(t('mgLowEnergy'), 'info', 1400);
        return;
    }
    currentGame = game;
    rewardedRounds = new Set();
    currentGameStartedAt = Date.now();
    const hideTopbarActions = shouldHideTopbarActionsForGame(game);
    setTopbarActionsVisible(!hideTopbarActions);
    // 顶栏收藏按钮：优先用调用方传入的 like-meta（作品/收藏项），否则按官方游戏推断。
    const playLikeMeta = likeMeta || likeMetaForGame(game, { official: !!game.src && !game.path });
    if (hideTopbarActions) hidePlayLikeButton();
    else showPlayLikeButton(playLikeMeta);
    // 最近游玩历史：满 15 秒才记入（官方 / 自己 / 别人的游戏都计入），中途退出或换游戏则取消。
    scheduleRecentPlay(game, playLikeMeta);
    scheduleMinigameRestPrompt();
    const tabContent = $('mhMinigameTabContent');
    const tabs = $('mhMinigameTabs');
    const wrap = $('mhMinigameFrameWrap');
    const frame = $('mhMinigameFrame');
    const done = $('mhMinigameDone');
    if (!wrap || !frame) return;
    if (tabContent) tabContent.style.display = 'none';
    if (tabs) tabs.style.display = 'none';
    wrap.style.display = 'block';
    // 加载界面与顶栏标题都展示游戏名（替代原先的"开始 xxx"toast）；标题过长自动省略。
    const gameTitle = getMinigameTitle(game);
    setMinigameLoading(true, gameTitle);
    const titleEl = $('mhMinigameTitle');
    if (titleEl) { titleEl.textContent = gameTitle; titleEl.title = gameTitle; }
    if (done) done.style.display = game.manualComplete ? 'block' : 'none';
    frame.setAttribute('allow', game.allow || 'autoplay; fullscreen');
    frame.onload = () => postGameConfig();
    if (html != null) {
        frame.removeAttribute('src');
        frame.srcdoc = String(html);
    } else {
        frame.removeAttribute('srcdoc');
        frame.src = minigameUrl(game.src, params);
    }
}

async function postGameConfig() {
    const frame = $('mhMinigameFrame');
    if (!frame?.contentWindow) return;
    const pet = await requestedPetForMinigame({});
    if (!frame?.contentWindow || !pet) return;
    try {
        frame.contentWindow.postMessage({
            type: 'setGameConfig',
            data: {
                petId: pet.id || '',
                petName: displayPetName(pet),
                masterStyle: localStorage.getItem('haqiAdventureMasterV1') || undefined,
                // 一并附带用户档案，便于新手领养类小游戏预填星球名 / 称呼。
                ...buildUserProfilePayload(),
            },
        }, '*');
    } catch (_) {}
    try {
        const image = await buildPetImagePayload(pet, { anim: 'happy', petId: pet.id });
        frame.contentWindow?.postMessage({
            type: 'haqi_pet_image',
            requestId: 'active_pet_config',
            ok: true,
            data: image,
        }, '*');
    } catch (_) {}
}

function minigameUrl(src, params = null) {
    const query = new URLSearchParams();
    const lang = getLang();
    query.set('lang', lang === 'en' ? 'enUS' : 'zhCN');
    if (params && typeof params === 'object') {
        Object.entries(params).forEach(([key, value]) => {
            if (value == null || value === '') return;
            query.set(key, String(value));
        });
    }
    const queryString = query.toString();
    if (!queryString) return src;
    return `${src}${src.includes('?') ? '&' : '?'}${queryString}`;
}

function finishCurrentGame(onGameFinished, data = {}, onFinishedPrompt = null, { forcePrompt = false } = {}) {
    if (!currentGame) return null;
    const finishedAt = data?.finishedAt || Date.now();
    const roundKey = minigameRoundKey(currentGame, data, finishedAt);
    if (rewardedRounds.has(roundKey)) return null;
    rewardedRounds.add(roundKey);
    const beforeStats = capturePetStatValues(currentPet);
    const beforeCoins = coinValue();
    const durationSeconds = activityDurationSeconds(data, currentGameStartedAt, finishedAt);
    const rewardData = suppressCurrentRewards ? { levelReward: null, rewardCoins: null } : miniGameLevelReward(currentGame, data, durationSeconds);
    const result = {
        ...data,
        completed: data?.completed ?? data?.passed ?? true,
        startedAt: currentGameStartedAt || undefined,
        finishedAt,
        durationSeconds,
        statBonus: suppressCurrentRewards ? {} : miniGameStatBonus(currentGame),
        ...(rewardData.levelReward ? rewardData : {}),
    };
    onGameFinished?.(currentGame, result);
    if (!suppressCurrentRewards && Number(data?.earnedPoints) > 0) soundManager.playPointReward();
    if (rewardData.rewardCoins) playLevelRewardAnimation(currentGame, rewardData.rewardCoins, rewardData.levelReward);
    refreshCoins({ previous: beforeCoins, animate: true });
    refreshPetStats({ previous: beforeStats, animate: true });
    if (onFinishedPrompt && (forcePrompt || durationSeconds > MINIGAME_COMPLETION_PROMPT_MIN_SECONDS)) onFinishedPrompt(result);
    return result;
}

function minigameRoundKey(game, data = {}, finishedAt = Date.now()) {
    const explicit = data.roundId ?? data.roundKey;
    if (explicit != null && explicit !== '') return `${game?.id || 'game'}:${explicit}`;
    return `${game?.id || 'game'}:${finishedAt}`;
}

function scheduleMinigameRestPrompt() {
    clearMinigameRestPrompt();
    restPromptTimer = setTimeout(showMinigameRestPrompt, MINIGAME_REST_PROMPT_MS);
}

function isMinigameSessionActive() {
    const frame = $('mhMinigameFrame');
    return state.currentView === 'minigames' && !!currentGame && !!frame?.isConnected;
}

function clearMinigameRestPrompt() {
    if (restPromptTimer) clearTimeout(restPromptTimer);
    restPromptTimer = null;
    restPromptOpen = false;
}

async function showMinigameRestPrompt() {
    restPromptTimer = null;
    if (!isMinigameSessionActive() || restPromptOpen) return;
    restPromptOpen = true;
    const keepPlaying = await confirm(t('mgRestPrompt'), {
        okText: t('mgContinuePlay'),
        cancelText: t('mgExit'),
    });
    restPromptOpen = false;
    if (!isMinigameSessionActive()) return;
    if (keepPlaying) {
        scheduleMinigameRestPrompt();
    } else {
        showList();
    }
}

function playLevelRewardAnimation(game, rewardCoins, levelReward) {
    const el = $('mhMinigameRewardFx');
    if (!el || !rewardCoins) return;
    const label = getMinigameRewardLabel(game, levelReward);
    const note = levelReward?.note || getMinigameTitle(game) || '';
    el.classList.remove('show');
    el.innerHTML = `
        <span class="mh-minigame-reward-spark">🪙</span>
        <span class="mh-minigame-reward-spark">🪙</span>
        <span class="mh-minigame-reward-spark">✨</span>
        <div class="mh-minigame-reward-title">${escapeHtml(label)}</div>
        <div class="mh-minigame-reward-coins">${coinIconSvg('hud-coin-icon')}<span>${escapeHtml(t('mgRewardCoins', { coins: rewardCoins }))}</span></div>
        ${note ? `<div class="mh-minigame-reward-note">${escapeHtml(note)}</div>` : ''}`;
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => {
        el.classList.remove('show');
        el.innerHTML = '';
    }, STAT_REWARD_ANIMATION_MS + 260);
}

function activityDurationSeconds(data = {}, startedAt = 0, finishedAt = Date.now()) {
    const direct = Number(data.durationSeconds ?? data.seconds ?? data.playSeconds);
    if (Number.isFinite(direct) && direct > 0) return direct;
    if (startedAt > 0 && finishedAt > startedAt) return Math.round((finishedAt - startedAt) / 100) / 10;
    return 0;
}

function resetMinigameIframe() {
    const frame = $('mhMinigameFrame');
    if (!frame) return;
    setMinigameLoading(false);
    try {
        frame.removeAttribute('srcdoc');
        frame.src = 'about:blank';
    } catch (_) {}
}

function destroyMinigameIframe() {
    const frame = $('mhMinigameFrame');
    if (minigameLoadingTimer) {
        clearTimeout(minigameLoadingTimer);
        minigameLoadingTimer = null;
    }
    if (!frame) return;
    try {
        frame.removeAttribute('srcdoc');
        frame.src = 'about:blank';
        frame.removeAttribute('src');
    } catch (_) {}
    frame.remove();
}

function showList() {
    const tabContent = $('mhMinigameTabContent');
    const tabs = $('mhMinigameTabs');
    const wrap = $('mhMinigameFrameWrap');
    const done = $('mhMinigameDone');
    resetMinigameIframe();
    clearMinigameRestPrompt();
    clearRecentPlayTimer();
    if (done) done.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
    if (tabContent) tabContent.style.display = 'block';
    if (tabs) tabs.style.display = 'flex';
    const titleEl = $('mhMinigameTitle');
    if (titleEl) { titleEl.textContent = t('mgPlay'); titleEl.removeAttribute('title'); }
    currentGame = null;
    currentGameLikeMeta = null;
    rewardedRounds = new Set();
    currentGameStartedAt = 0;
    setTopbarActionsVisible(!hideTopbarActionsForRoute);
    hidePlayLikeButton();
    // 退出游戏回到列表：刷新"推荐"，让刚玩过的游戏排到最前并更新"最近游玩"标签。
    if (activeMinigameTab === 'recommend') currentRenderGameList?.();
}

function shouldHideTopbarActionsForGame(game) {
    return hideTopbarActionsForRoute || !!game?.hidden;
}

function setTopbarActionsVisible(visible) {
    const actions = $('mhMinigameTopActions');
    if (actions) actions.style.display = visible ? 'flex' : 'none';
}

// 顶栏收藏按钮：仅游玩中显示，已收藏时按钮高亮并显示"已收藏"。
function hidePlayLikeButton() {
    const btn = $('mhMinigameLikeBtn');
    if (btn) btn.style.display = 'none';
}

function renderPlayLikeButton() {
    const btn = $('mhMinigameLikeBtn');
    if (!btn) return;
    if (!currentGameLikeMeta) { btn.style.display = 'none'; return; }
    const liked = isGameLikedSync(currentGameLikeMeta);
    btn.style.display = 'inline-flex';
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    const ico = btn.querySelector('.mh-minigame-topbar-like-ico');
    const txt = btn.querySelector('.mh-minigame-topbar-like-txt');
    if (ico) ico.innerHTML = minigameHeartIcon(liked);
    if (txt) txt.textContent = liked ? t('mgLiked') : t('mgLike');
}

function showPlayLikeButton(meta) {
    currentGameLikeMeta = meta || null;
    renderPlayLikeButton();
}

async function handlePlayLikeToggle() {
    if (!currentGameLikeMeta) return;
    const btn = $('mhMinigameLikeBtn');
    if (btn) btn.disabled = true;
    await ensureLikedGames();
    const result = await toggleLikeGame(currentGameLikeMeta);
    if (btn) btn.disabled = false;
    if (result === null) return;
    renderPlayLikeButton();
}

function setMinigameLoading(isLoading, gameName = '') {
    const loading = $('mhMinigameLoading');
    const wrap = $('mhMinigameFrameWrap');
    const active = !!isLoading;
    if (minigameLoadingTimer) {
        clearTimeout(minigameLoadingTimer);
        minigameLoadingTimer = null;
    }
    if (wrap) wrap.classList.toggle('mh-minigame-is-loading', active);
    if (!loading) return;
    // 加载副标题：开始加载时展示游戏名，否则回到默认"正在打开小游戏"。
    if (active) {
        const nameEl = $('mhMinigameLoadingName');
        if (nameEl) nameEl.textContent = gameName || t('mgOpening');
    }
    loading.classList.toggle('show', active);
    loading.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
    if (active) {
        minigameLoadingTimer = setTimeout(() => {
            minigameLoadingTimer = null;
            setMinigameLoading(false);
        }, MINIGAME_LOADING_MAX_MS);
    }
}
