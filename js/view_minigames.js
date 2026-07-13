// 玩耍视图：小游戏列表 + iframe 容器
import { $, clamp, coinIconSvg, confirm, escapeHtml, showToast } from './utils.js';
import { getLang, t } from './i18n.js';
import { CONFIG } from './config.js';
import { state, setPlanetName } from './state.js';
import { displayPetName } from './dna.js';
import { getPet, getPetAsync, getPetImagePayload } from './pet.js';
import { isPetOnCurrentPlanet } from './petLifecycle.js';
import { addLikedGame, deletePetGame, loadExploreSeen, loadLikedGames, loadPetGameHtml, loadPetGameList, loadRecentGames, loadRemotePetGameHtml, loadRemotePetGameList, recordExploreSeen, recordRecentGame, removeLikedGame, saveExploreSeen, saveUserProfileDebounced, setPetGamePublished } from './storage.js';
import SoundManager from './soundManager.js';
import { isMiniProgramWebView, isWechatBrowser, navigateToSharePage, postShareToMiniProgram, setWxShareData } from './wxShare.js';
import { handleGameHostMessage, loadGameHtmlIntoFrame } from './gameHostFrame.js';

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

// 解析分享小游戏的真实名称：优先取作者小游戏清单（index.json）里的标题，
// 其次解析 HTML <title>，最后回退到文件名美化，避免显示通用的"分享的小游戏"。
async function resolveSharedGameTitle(username, sharedPath, baseName, html) {
    try {
        const isMe = username === currentUsername();
        const list = isMe ? await loadPetGameList() : await loadRemotePetGameList(username);
        const match = (Array.isArray(list) ? list : []).find(item => {
            const itemBase = String(item.path || '').split('/').pop().replace(/\.html?$/i, '');
            return item.path === sharedPath || itemBase === baseName;
        });
        const fromIndex = String(match?.title || '').trim();
        if (fromIndex) return fromIndex;
    } catch (_) { /* 清单不可用时走下面的回退 */ }
    const titleTag = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const fromHtml = titleTag ? titleTag[1].replace(/\s+/g, ' ').trim() : '';
    if (fromHtml) return fromHtml;
    const pretty = String(baseName || '').replace(/[_-]+/g, ' ').trim();
    return pretty || t('mgSharedGameTitle');
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

function buildMinigameShareUrl(record, username, message = '') {
    // 基于当前页面实际地址生成分享链接（文件名可能是 MagicHaqi_v1.html 等版本化名称，
    // 不能写死成 MagicHaqi.html），仅重置查询参数 / 锚点后再附加分享参数。
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const path = String(record?.path || '').trim();
    if (path) {
        // 用户作品：?gameFrom=<作者用户名>&game=<文件名>
        url.searchParams.set('gameFrom', username || '');
        const filename = path.replace(/^\/+/, '').split('/').pop() || '';
        url.searchParams.set('game', filename);
    } else {
        // 官方内置游戏：无 path，按官方游戏 id 分享（?game=<officialId>，无 gameFrom）。
        url.searchParams.set('game', String(record?.id || '').trim());
    }
    // 可选自定义留言（分享落地登录页单独一行展示）。
    const msg = String(message || '').trim().slice(0, 200);
    if (msg) url.searchParams.set('msg', msg);
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

// 微信内置浏览器分享引导：JS-SDK 无法主动弹出分享面板，只能引导用户点右上角「···」。
function showWxShareGuide() {
    document.querySelector('.mh-wx-share-guide')?.remove();
    const mask = document.createElement('div');
    mask.className = 'mh-wx-share-guide';
    mask.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:99999',
        'background:rgba(0,0,0,0.78)', 'backdrop-filter:blur(2px)',
        'display:flex', 'flex-direction:column', 'align-items:flex-end',
        'padding:18px 22px', 'box-sizing:border-box', 'color:#fff',
    ].join(';'));
    mask.innerHTML = `
        <svg width="72" height="86" viewBox="0 0 72 86" fill="none" style="margin-right:10px" aria-hidden="true">
            <path d="M18 80 C 22 52, 28 28, 52 16" stroke="#FFD54A" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="0.5 9"/>
            <path d="M40 12 L 56 14 L 49 29" stroke="#FFD54A" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div style="max-width:280px;text-align:right;margin-right:6px">
            <div style="font-size:18px;font-weight:700;line-height:1.4">${escapeHtml(t('mgShareWxGuideTitle'))}</div>
            <div style="font-size:14px;opacity:0.85;margin-top:6px;line-height:1.5">${escapeHtml(t('mgShareWxGuideDesc'))}</div>
        </div>
        <button type="button" style="margin:28px auto 0;padding:10px 28px;border:1px solid rgba(255,255,255,0.5);border-radius:22px;background:transparent;color:#fff;font-size:15px">${escapeHtml(t('mgShareWxGuideDismiss'))}</button>`;
    mask.addEventListener('click', () => mask.remove());
    document.body.appendChild(mask);
}

// 分享弹窗（参照 view_story_list 的故事分享样式）。
async function openMinigameSharePanel(record) {
    if (!record) return;
    // 官方内置游戏无 path（按 id 分享，无需登录）；用户作品有 path（需要作者用户名）。
    const isOfficial = !String(record.path || '').trim();
    let username = '';
    if (!isOfficial) {
        // 别人的作品用其 owner，自己的作品用当前登录名。
        username = String(record.owner || '').trim() || await getMinigameShareUsername();
        if (!username) { showToast(t('mgShareLoginFirst'), 'error', 2200); return; }
    }
    document.querySelector('.mh-minigame-share-mask')?.remove();
    const safeTitle = record.title || t('mgDefaultName');
    // 自定义留言（可由分享者输入），写进链接的 msg 参数，并在分享落地登录页单独一行展示。
    let shareMessage = '';
    let url = buildMinigameShareUrl(record, username, shareMessage);
    const gameFilename = isOfficial
        ? String(record.id || '').trim()
        : (String(record.path || '').trim().replace(/^\/+/, '').split('/').pop() || '');
    const text = t('mgShareText', { title: safeTitle });
    const isWxBrowser = isWechatBrowser();
    const isMP = isMiniProgramWebView();
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
            <textarea class="modal-input mh-minigame-share-msg" data-mg-share-msg rows="2" maxlength="200" placeholder="${escapeHtml(t('mgShareMsgPlaceholder'))}" aria-label="${escapeHtml(t('mgShareMsgLabel'))}" style="resize:none;line-height:1.4"></textarea>
            <input class="modal-input mh-story-share-link" readonly value="${escapeHtml(url)}" aria-label="${escapeHtml(t('mgShareLink'))}">
            <div class="mh-story-share-actions">
                <button type="button" class="btn-secondary" data-mg-share-method="copy">${escapeHtml(t('mgShareCopyLink'))}</button>
                <button type="button" class="btn-secondary" data-mg-share-method="wechat">${escapeHtml(t('mgShareWechat'))}</button>
                <button type="button" class="btn-primary" data-mg-share-method="system">${escapeHtml(t('mgShareSystem'))}</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    // 自定义留言输入：实时重算分享链接（msg 参数）并刷新只读链接框。
    mask.addEventListener('input', (e) => {
        const ta = e.target.closest?.('[data-mg-share-msg]');
        if (!ta) return;
        shareMessage = String(ta.value || '').trim().slice(0, 200);
        url = buildMinigameShareUrl(record, username, shareMessage);
        const linkInput = mask.querySelector('.mh-story-share-link');
        if (linkInput) linkInput.value = url;
    });
    mask.addEventListener('click', async (e) => {
        if (e.target === mask || e.target.closest?.('[data-mg-share-close]')) { close(); return; }
        const methodBtn = e.target.closest?.('[data-mg-share-method]');
        if (!methodBtn) return;
        const method = methodBtn.dataset.mgShareMethod;
        if (method === 'copy') {
            await copyMinigameText(url, t('mgShareLinkCopied'));
        } else if (method === 'wechat') {
            if (isMP) {
                // 小程序 web-view：navigateTo 实时跳转到宿主原生分享页，由用户点原生按钮拉起转发
                const ok = await navigateToSharePage({ title: safeTitle, desc: text, gameFrom: username, game: gameFilename, icon: record.icon, msg: shareMessage });
                if (ok) { showToast(t('mgShareNavOpening'), 'info', 1200); close(); } else {
                    await copyMinigameText(`${text}\n${url}`, t('mgShareWechatCopied'));
                }
            } else if (isWxBrowser) {
                // 微信内置浏览器：JS-SDK 预设分享数据（best-effort），再引导用户点右上角「···」分享
                await setWxShareData({ title: safeTitle, desc: text, url });
                close();
                showWxShareGuide();
            } else {
                await copyMinigameText(`${text}\n${url}`, t('mgShareWechatCopied'));
            }
        } else if (method === 'system') {
            if (isMP) {
                // 小程序里没有系统分享，同样跳转到宿主原生分享页
                const ok = await navigateToSharePage({ title: safeTitle, desc: text, gameFrom: username, game: gameFilename, icon: record.icon, msg: shareMessage });
                if (ok) { showToast(t('mgShareNavOpening'), 'info', 1200); close(); return; }
            }
            if (isWxBrowser) {
                // 微信内置浏览器没有系统分享：预设 JS-SDK 数据并引导点右上角「···」
                await setWxShareData({ title: safeTitle, desc: text, url });
                close();
                showWxShareGuide();
                return;
            }
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
    // 首页：房子轮廓
    recommend: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 11.5 12 5l8 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.5V19h12v-8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19v-4.5h4V19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    // 探索：指南针
    explore: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.4 8.6 13 13l-4.4 2.4L11 11z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    // 创造：加号
    create: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    // 我的：方框（盒子轮廓）
    mine: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.5" y="6.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 10h15" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

const MINIGAME_TABS = [
    { id: 'recommend', labelKey: 'mgTabRecommend' },
    { id: 'explore', labelKey: 'mgTabExplore' },
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

export function renderMinigames(panel, { pet }, { onBack, onGameFinished, initialGameId = null, initialGameParams = null, initialGameLandscape = null, allowPlayWhenLowEnergy = false, suppressRewards = false, hideTopbarActions = false, exitGameToBack = false, completionPrompt = null, deferGameFinishedUntilCompletionExit = false, initialTab = null, onCreateGame = null, onEditGame = null, sharedGame = null, remoteGame = null } = {}) {
    // 守护：玩耍视图订阅了全局 state（subscribe(render)），任何 notify() 都会重跑本路由。
    // 若此时已有一局游戏正在进行（iframe 已挂载），重建整个面板会销毁运行中的 iframe，
    // 表现为"首次点开游戏秒退、第二次正常"——典型触发是小游戏加载即请求宠物图（如台球
    // haqi_billiards 的 requestPets），首次宠物未缓存 → 后台 loadPet 完成后 notify() → 本路由
    // 重渲染 → iframe 被销毁；二次宠物已缓存、不再 notify，故正常。
    // 这里在"当前正在游玩同一局（iframe 已挂载）且本次不是切换到另一个游戏"时跳过破坏性重建，
    // 只刷新动态数据（宠物状态 / 金币），保住运行中的游戏。
    // 仅当 initialGameId 指向另一个游戏（真正的切换）或带 sharedGame 时才放行重建。
    const reentrantSameGame = currentGame
        && !sharedGame
        && (!initialGameId || initialGameId === currentGame.id);
    if (reentrantSameGame) {
        const liveFrame = $('mhMinigameFrame');
        if (liveFrame?.isConnected && panel?.contains?.(liveFrame)) {
            if (pet) currentPet = pet;
            try { refreshPetStats(); } catch (_) {}
            try { refreshCoins(); } catch (_) {}
            return;
        }
    }
    // 同理保护"探索"标签：抖音式信息流里有正在试玩的 iframe，全量重建会销毁它
    // （触发同上：游戏请求宠物图 → 后台加载完成 notify() → 本路由重渲染）。
    // 探索流仅由用户点标签进入（无路由参数），重入时只刷新动态数据、保住信息流。
    if (!sharedGame && !initialGameId && activeMinigameTab === 'explore') {
        const explorePane = $('mhMinigameExplore');
        if (explorePane?.isConnected && panel?.contains?.(explorePane)) {
            if (pet) currentPet = pet;
            try { refreshPetStats(); } catch (_) {}
            try { refreshCoins(); } catch (_) {}
            return;
        }
    }
    cleanupMessageListener?.();
    exitForcedLandscape();
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
            /* 探索：抖音式上下滑动逐个试玩 */
            .mh-explore-pager {
                overflow-y: auto;
                scroll-snap-type: y mandatory;
                -webkit-overflow-scrolling: touch;
                background: #06172d;
                padding: 0 !important;
                /* 禁用原生触摸滚动：翻页一律走限速后的 exploreGo（程序化 scrollIntoView 不受 touch-action 影响），
                   避免在加载封面上直接滑动绕过"最快 3 秒一个 / 未加载完不许翻页"的限制。 */
                touch-action: none;
            }
            .mh-explore-pager::-webkit-scrollbar { display: none; }
            .mh-explore-slide {
                position: relative;
                width: 100%;
                height: 100%;
                scroll-snap-align: start;
                scroll-snap-stop: always;
                overflow: hidden;
                background: #06172d;
            }
            .mh-explore-frame-host { position: absolute; inset: 0; }
            .mh-explore-frame-host iframe { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
            .mh-explore-poster {
                position: absolute;
                inset: 0;
                z-index: 2;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 14px;
                padding: 24px;
                text-align: center;
                color: #fff;
                background: radial-gradient(circle at 50% 38%, rgba(56,189,248,.34), rgba(6,23,45,.92) 72%);
                transition: opacity .3s ease;
            }
            .mh-explore-slide.playing .mh-explore-poster { opacity: 0; pointer-events: none; }
            .mh-explore-poster .mh-minigame-icon { width: 92px; height: 92px; font-size: 76px; }
            .mh-explore-poster .mh-minigame-icon svg { width: 92px; height: 92px; }
            .mh-explore-poster-title { font-size: 22px; font-weight: 1000; line-height: 1.2; text-shadow: 0 2px 8px rgba(0,0,0,.4); }
            .mh-explore-poster-desc { font-size: 14px; font-weight: 700; line-height: 1.4; max-width: 16em; opacity: .9; }
            .mh-explore-poster-spinner {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: conic-gradient(from 0deg, #67e8f9, #0ea5e9, #8b5cf6, #67e8f9);
                animation: mhMinigameLoadingSpin 1.05s linear infinite;
                opacity: 0;
            }
            .mh-explore-slide.loading .mh-explore-poster-spinner { opacity: 1; }
            .mh-explore-empty {
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                color: rgba(255,255,255,.82);
                font-size: 14px;
                font-weight: 800;
                text-align: center;
            }
            /* 探索底部栏翻页按钮（像顶栏一样的底栏，左右两侧各一个） */
            .mh-explore-nav-btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                height: 40px;
                padding: 0 18px;
                border: 0;
                border-radius: 999px;
                background: rgba(14,165,233,.12);
                color: #0369a1;
                font-size: 14px;
                font-weight: 900;
                line-height: 1;
                cursor: pointer;
            }
            .mh-explore-nav-btn svg { width: 20px; height: 20px; display: block; }
            .mh-explore-nav-btn:disabled { opacity: .38; cursor: default; }
            /* 探索底栏中间提示：上滑翻页，交互后淡出 */
            .mh-explore-bar-hint {
                flex: 1;
                min-width: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                color: #64748b;
                font-size: 13px;
                font-weight: 900;
                white-space: nowrap;
                transition: opacity .3s ease;
            }
            .mh-explore-bar-hint .mh-explore-hint-arrow {
                font-size: 17px;
                line-height: 1;
                color: #0ea5e9;
                animation: mhMinigameLoadingFloat 1.4s ease-in-out infinite;
            }
            .mh-explore-bar-hint.dismissed { opacity: 0; }
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
            .mh-minigame-mine-stats { position: absolute; top: 6px; left: 8px; z-index: 1; display: flex; gap: 8px; align-items: center; color: #0369a1; font-size: 11px; font-weight: 900; line-height: 1; }
            .mh-minigame-mine-stats span { display: inline-flex; align-items: center; gap: 3px; }
            /* 已发布作品：用青绿色描边 + 浅色底，与未发布卡片区分。 */
            .mh-minigame-mine-card.is-published {
                border: 1.5px solid rgba(16,185,129,.55);
                background: linear-gradient(180deg, rgba(236,253,245,.96), rgba(209,250,229,.78));
                box-shadow: 0 2px 10px rgba(16,185,129,.16);
            }
            .mh-minigame-mine-actions { display: flex; gap: 6px; align-items: center; width: 100%; margin-top: auto; flex: 0 0 auto; }
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
            /* 强制横屏游戏（game.landscape===true）：移动端竖屏时把整个游戏容器旋转 90 度铺满视口。
               screen.orientation.lock() 多数浏览器需先进入全屏才生效，这里是必然生效的 CSS 兜底方案。 */
            .mh-minigame-force-landscape {
                position: fixed !important;
                inset: auto !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vh !important;
                height: 100vw !important;
                transform: rotate(90deg) translateY(-100%) !important;
                transform-origin: top left !important;
                z-index: 9999 !important;
            }
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
                .mh-minigame-loading-dots span,
                .mh-explore-poster-spinner,
                .mh-explore-hint-arrow { animation: none; }
            }
        </style>
        <div class="topbar" id="mhMinigameTopbar" style="touch-action:none">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span id="mhMinigameTitle" class="font-bold" style="color:var(--text-primary);flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t('mgPlay'))}</span>
            <div id="mhMinigameTopActions" style="display:${hideInitialTopbarActions ? 'none' : 'flex'};align-items:center;justify-content:flex-end;gap:5px;max-width:min(64vw,440px);overflow:visible">
                <button type="button" id="mhMinigameLikeBtn" class="mh-minigame-topbar-like" style="display:none" aria-pressed="false">
                    <span class="mh-minigame-topbar-like-ico" aria-hidden="true">${minigameHeartIcon(false)}</span>
                    <span class="mh-minigame-topbar-like-txt">${escapeHtml(t('mgLike'))}</span>
                </button>
                <button type="button" id="mhMinigameShareBtn" class="mh-minigame-topbar-like" style="display:none" aria-label="${escapeHtml(t('mgShare'))}" title="${escapeHtml(t('mgShare'))}">
                    <span class="mh-minigame-topbar-like-ico" aria-hidden="true">${MINIGAME_SHARE_ICON}</span>
                    <span class="mh-minigame-topbar-like-txt">${escapeHtml(t('mgShare'))}</span>
                </button>
            </div>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow:hidden;background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 46%,#d9f99d 100%)">
            <div id="mhMinigameTabContent" style="position:absolute;inset:0 0 ${initialGameId ? '0' : '58px'} 0;overflow:hidden;display:${initialGameId ? 'none' : 'block'}">
                <div id="mhMinigameList" class="mh-minigame-tab-pane" data-mh-tab-pane="recommend" style="height:100%;overflow:auto;padding:14px;display:${activeMinigameTab === 'recommend' ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;align-content:start">
                    ${renderGameCards(getRecommendItems())}
                </div>
                <div id="mhMinigameMine" class="mh-minigame-tab-pane" data-mh-tab-pane="mine" style="height:100%;overflow:auto;padding:14px;display:${activeMinigameTab === 'mine' ? 'grid' : 'none'};grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;align-content:start"></div>
                <div id="mhMinigameExplore" class="mh-minigame-tab-pane mh-explore-pager" data-mh-tab-pane="explore" style="height:100%;display:${activeMinigameTab === 'explore' ? 'block' : 'none'}"></div>
            </div>
            <div id="mhMinigameTabs" style="position:absolute;left:0;right:0;bottom:0;height:58px;display:${initialGameId ? 'none' : 'flex'};align-items:stretch;background:rgba(255,255,255,.92);border-top:1px solid rgba(14,116,144,.18);box-shadow:0 -2px 10px rgba(15,39,71,.08);z-index:5">
                ${renderMinigameTabButtons()}
            </div>
            <div id="mhExploreBottomBar" style="display:none;position:absolute;left:0;right:0;bottom:0;height:58px;align-items:center;justify-content:space-between;gap:8px;padding:0 12px;background:rgba(255,255,255,.92);border-top:1px solid rgba(14,116,144,.18);box-shadow:0 -2px 10px rgba(15,39,71,.08);z-index:5;touch-action:none">
                <button type="button" id="mhExplorePrev" class="mh-explore-nav-btn prev" aria-label="${escapeHtml(t('mgExplorePrev'))}" title="${escapeHtml(t('mgExplorePrev'))}">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span>${escapeHtml(t('mgExplorePrev'))}</span>
                </button>
                <div id="mhExploreHint" class="mh-explore-bar-hint" aria-hidden="true">
                    <span class="mh-explore-hint-arrow">↑</span>
                    <span>${escapeHtml(t('mgExploreHint'))}</span>
                </div>
                <button type="button" id="mhExploreNext" class="mh-explore-nav-btn next" aria-label="${escapeHtml(t('mgExploreNext'))}" title="${escapeHtml(t('mgExploreNext'))}">
                    <span>${escapeHtml(t('mgExploreNext'))}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
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
        // 探索全屏模式：返回回到小游戏首页（推荐标签），而非退出小游戏视图。
        if (activeMinigameTab === 'explore') {
            switchTab('recommend');
            return;
        }
        if (currentGame) {
            if (exitGameToBack) {
                exitForcedLandscape();
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
    const shareBtnEl = $('mhMinigameShareBtn');
    if (shareBtnEl) shareBtnEl.onclick = () => { if (currentGameLikeMeta) openMinigameSharePanel(currentGameLikeMeta); };

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
        // 离开"探索"：卸载正在试玩的信息流 iframe，退出全屏模式（恢复 tabs 栏 / 顶栏标题）。
        if (activeMinigameTab === 'explore' && tabId !== 'explore') {
            unmountExploreFrame();
            setExploreMode(false);
        }
        activeMinigameTab = tabId;
        setTabButtonsActive();
        const list = $('mhMinigameList');
        const mine = $('mhMinigameMine');
        const explore = $('mhMinigameExplore');
        if (list) list.style.display = tabId === 'recommend' ? 'grid' : 'none';
        if (mine) mine.style.display = tabId === 'mine' ? 'grid' : 'none';
        if (explore) explore.style.display = tabId === 'explore' ? 'block' : 'none';
        if (tabId === 'mine') renderMineList();
        if (tabId === 'explore') renderExplorePane();
    }

    function bindTabButtons() {
        document.querySelectorAll('[data-mh-minigame-tab]').forEach(btn => {
            btn.onclick = () => switchTab(btn.dataset.mhMinigameTab);
        });
    }
    bindTabButtons();
    bindExploreBarGestures();

    // 已发布作品的访问/点赞数据缓存（按游戏 path），切回「我的」标签时先用缓存即时渲染，再后台刷新。
    let mineWorkStatsCache = {};
    // userWorks.my 的原始作品列表缓存：整个会话只请求一次，发布新作品后置空以触发下次重新拉取。
    let mineWorksRaw = null;
    let mineWorksPromise = null;

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
        mine.innerHTML = renderMineCards(records, mineWorkStatsCache);
        bindMineCards(records);
        // 至少有一个已发布作品时，拉取 MagicHaqi 名下的作品访问/点赞数据并回填到卡片。
        if (records.some(r => r.isPublished)) {
            const statsByPath = await loadMineWorkStats(records);
            if (statsByPath && cleanupMessageListener === token && $('mhMinigameMine') && activeMinigameTab === 'mine') {
                mineWorkStatsCache = statsByPath;
                mine.innerHTML = renderMineCards(records, statsByPath);
                bindMineCards(records);
            }
        }
    }

    // 从作品 url 中解析对应的本地游戏文件名（?game=<文件名>），用于把作品的访问/点赞数据对回「我的」列表。
    function gameFilenameFromWorkUrl(url) {
        try {
            return (new URL(String(url || ''), window.location.href).searchParams.get('game') || '').trim();
        } catch (_) { return ''; }
    }

    // 拉取当前用户在 MagicHaqi 名下的全部作品，整个会话只真正请求一次（结果缓存到 mineWorksRaw）。
    // 并发调用复用同一个 in-flight promise；发布新作品后由 publishMineGame 置空缓存触发重拉。
    function fetchMineWorks() {
        const userWorks = state.sdk?.userWorks;
        if (!userWorks?.my) return Promise.resolve(null);
        if (mineWorksRaw) return Promise.resolve(mineWorksRaw);
        if (mineWorksPromise) return mineWorksPromise;
        mineWorksPromise = userWorks.my({ app: CONFIG.userWorksApp, page: 1, pageSize: 100 })
            .then(result => {
                const list = Array.isArray(result?.list) ? result.list : (Array.isArray(result) ? result : []);
                mineWorksRaw = list;
                return list;
            })
            .catch(() => null)
            .finally(() => { mineWorksPromise = null; });
        return mineWorksPromise;
    }

    // 把缓存的作品列表按 path 归并成 { visit, star } 映射（失败返回 null）。
    async function loadMineWorkStats(records) {
        const list = await fetchMineWorks();
        if (!list) return null;
        const byFilename = new Map();
        list.forEach(work => {
            const filename = gameFilenameFromWorkUrl(work?.url);
            if (filename && !byFilename.has(filename)) byFilename.set(filename, work);
        });
        const statsByPath = {};
        records.forEach(record => {
            const filename = String(record.path || '').split('/').pop();
            const work = byFilename.get(filename);
            if (work) statsByPath[record.path] = { visit: Number(work.visit) || 0, star: Number(work.star) || 0 };
        });
        return statsByPath;
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

    function renderMineCards(records, statsByPath = {}) {
        if (!records.length) {
            return `<div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineEmpty'))}</div>`;
        }
        return records.map(record => {
            const updatedLabel = formatRelativeTime(record.updatedAt);
            const stats = record.isPublished ? statsByPath[record.path] : null;
            // 访问量 / 获赞数：作为左上角小角标显示（不占卡片正文高度）。
            const statsBadge = stats
                ? `<span class="mh-minigame-mine-stats">
                        <span title="${escapeHtml(t('mgMineVisits'))}">👁 ${stats.visit}</span>
                        <span title="${escapeHtml(t('mgMineStars'))}">⭐ ${stats.star}</span>
                   </span>`
                : '';
            return `
            <div class="card-flat mh-minigame-mine-card${record.isPublished ? ' is-published' : ''}" data-mh-mine-path="${escapeHtml(record.path)}">
                <button type="button" class="mh-minigame-mine-del" data-mh-mine-delete="${escapeHtml(record.path)}" aria-label="${escapeHtml(t('mgMineDelete'))}" title="${escapeHtml(t('mgMineDelete'))}">×</button>
                ${statsBadge}
                <span class="mh-minigame-mine-ico" aria-hidden="true">${escapeHtml(record.icon || '🎮')}</span>
                <span class="mh-minigame-mine-title">${escapeHtml(record.title || t('mgDefaultName'))}</span>
                ${record.desc ? `<span class="mh-minigame-mine-desc">${escapeHtml(record.desc)}</span>` : ''}
                ${updatedLabel ? `<span class="mh-minigame-mine-time">${escapeHtml(updatedLabel)}</span>` : ''}
                <div class="mh-minigame-mine-actions">
                    <button type="button" class="btn-primary" data-mh-mine-edit="${escapeHtml(record.path)}">${escapeHtml(t('slEdit'))}</button>
                    ${record.isPublished
                        ? ''
                        : `<button type="button" class="btn-secondary" data-mh-mine-publish="${escapeHtml(record.path)}">${escapeHtml(t('mgMinePublish'))}</button>`}
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
                const published = !!record?.isPublished;
                // 已发布的作品：删除只从「我的」列表移除，保留 HTML 文件，作品广场上的链接仍可访问。
                const confirmKey = published ? 'mgMineDeletePublishedConfirm' : 'mgMineDeleteConfirm';
                const ok = await confirm(t(confirmKey, { title }), { okText: t('delete'), cancelText: t('cancel') });
                if (!ok) return;
                delBtn.disabled = true;
                try {
                    await deletePetGame(path, { keepFile: published });
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
            const publishBtn = e.target.closest?.('[data-mh-mine-publish]');
            if (publishBtn) {
                publishMineGame(publishBtn.dataset.mhMinePublish, records, publishBtn);
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

    // 发布到 Keepwork 作品广场（userWorks）：app 固定为 MagicHaqi，url 为该游戏的分享链接，
    // 发布成功后在 pet-games/index.json 该记录上标记 isPublished，并刷新「我的」列表。
    async function publishMineGame(path, records, btn) {
        const record = records.find(r => r.path === path);
        if (!record) { showToast(t('mgMineMissing'), 'error'); return; }
        const userWorks = state.sdk?.userWorks;
        if (!userWorks?.upload) { showToast(t('mgMinePublishUnavailable'), 'error', 2400); return; }
        const username = await getMinigameShareUsername();
        if (!username) { showToast(t('mgMinePublishLoginFirst'), 'error', 2200); return; }
        const title = record.title || t('mgDefaultName');
        const ok = await confirm(t('mgMinePublishConfirm', { title }), { okText: t('mgMinePublish'), cancelText: t('cancel') });
        if (!ok) return;
        // 分享链接与「分享」用的完全一致（gameFrom=作者&game=文件名）。
        const url = buildMinigameShareUrl(record, username);
        const original = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = t('mgMinePublishing'); }
        try {
            await userWorks.upload({
                app: CONFIG.userWorksApp,
                title,
                url,
                category: 'minigame',
                grade: 'all',
                description: record.desc || title,
            });
            await setPetGamePublished(record.path, true);
            // 新发布了作品，作废作品列表缓存，让接下来的 renderMineList 重新拉取一次 userWorks.my。
            mineWorksRaw = null;
            showToast(t('mgMinePublishSuccess'), 'success', 1800);
            renderMineList();
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = original; }
            showToast(t('mgMinePublishFailed', { error: (err?.message || err) }), 'error', 2800);
        }
    }

    // ---------- 探索：抖音式上下滑动逐个试玩 ----------
    // 候选池 = userWorks.listAll（app=MagicHaqi 的全部公开作品）；分页拉取、优先未看过、7 天去重。
    // 数据源与补充逻辑见下方「探索数据源」一节（refillExploreItems / growExploreBuffer）。
    let exploreItems = [];
    let exploreActiveIndex = -1;
    let exploreActiveGame = null;
    let exploreGameStartedAt = 0;
    let exploreRewardedRounds = new Set();
    let exploreObserver = null;
    let exploreLoadingTimer = null;
    let exploreHintDismissed = false;
    let exploreWheelCooldown = 0;
    // 翻页闸门："没加载完不许翻到下一个"。游戏加载完成（gameLoaded）即可立即翻页（哪怕只用了 1 秒）；
    // 3 秒是加载超时上限——超过 3 秒仍未加载完也放行，避免卡死。过早翻页给一次 toast 提示（节流）。
    const EXPLORE_LOAD_TIMEOUT_MS = 3000;
    let exploreSlideActivatedAt = 0;
    let exploreActiveLoaded = false;
    let exploreFlipCooldownTimer = null;
    let exploreTooFastToastAt = 0;

    // ---------- 探索数据源：纯 userWorks.listAll（不混入本地官方 / 我的作品）----------
    // 客户端版的极简「抖音」：分页拉取 app=MagicHaqi 的作品，优先推送 7 天内没看过的；
    // 单次补充最多翻 EXPLORE_MAX_PAGES_PER_REFILL 页（控制请求次数），实在没有新的就回退已看过的。
    const EXPLORE_PAGE_SIZE = 20;
    const EXPLORE_MAX_PAGES_PER_REFILL = 3;   // 一次补充最多翻几页（避免请求过多）
    const EXPLORE_REFILL_TARGET = 6;          // 每次补充期望取到多少个
    const EXPLORE_PREFETCH_AHEAD = 2;         // 距离信息流末尾还剩几个就提前补充
    let exploreSeenMap = null;                // { key: seenAt } 7 天内已看过（内存缓存）
    let explorePage = 0;                      // listAll 已翻到的页码
    let exploreNoMore = false;                // listAll 已翻到底
    let exploreFetchedItems = [];             // 本会话拉取到的全部候选（去重）
    let exploreFetchedKeys = new Set();
    let exploreShownKeys = new Set();          // 已放进信息流的 key（防止本会话重复）
    let exploreRefillPromise = null;
    let exploreAppending = false;

    async function ensureExploreSeen() {
        if (exploreSeenMap) return exploreSeenMap;
        try { exploreSeenMap = await loadExploreSeen(); }
        catch (_) { exploreSeenMap = {}; }
        return exploreSeenMap;
    }

    // 标记某个探索作品为「已看过」（用户滑到并开始试玩时调用），7 天内不再重复推送。
    function markExploreSeen(game) {
        const key = game?.id;
        if (!key) return;
        if (!exploreSeenMap) exploreSeenMap = {};
        const now = Date.now();
        exploreSeenMap[key] = now;
        recordExploreSeen(key, now);      // IndexedDB 完整历史（不限条数）
        saveExploreSeen(exploreSeenMap);  // 个人主页存储（最近 300，防抖）
    }

    // 把一条 userWorks 作品转成探索条目：从其分享链接解析作者(gameFrom)与文件名(game)，
    // 挂载时按 owner + path 远程取 HTML（见 mountExploreGame 的 'remote' 分支）。
    function exploreItemFromWork(work) {
        let owner = '', filename = '';
        try {
            const u = new URL(String(work?.url || ''), window.location.href);
            owner = (u.searchParams.get('gameFrom') || '').trim();
            filename = (u.searchParams.get('game') || '').trim();
        } catch (_) { /* 非本游戏的作品链接，跳过 */ }
        if (!owner || !filename) return null;
        const baseName = filename.replace(/\.html?$/i, '').split('/').pop();
        const path = filename.includes('/') ? filename : `pet-games/${filename}`;
        const title = work.title || t('mgDefaultName');
        return {
            id: `remote:${owner}:${baseName}`,
            title,
            icon: '🎮',
            desc: work.description || '',
            allow: 'autoplay; fullscreen',
            __exploreKind: 'remote',
            __remoteOwner: owner,
            __remotePath: path,
            __likeMeta: { id: baseName, path, owner, title, icon: '🎮' },
        };
    }

    // 翻页拉取更多候选到 exploreFetchedItems（去重）。单次最多翻 EXPLORE_MAX_PAGES_PER_REFILL 页，
    // 本页已带来足够「未看过」时提前停（节省请求）。返回本次新增的候选数。
    async function growExploreBuffer() {
        const userWorks = state.sdk?.userWorks;
        if (!userWorks?.listAll || exploreNoMore) return 0;
        let added = 0;
        for (let pages = 0; pages < EXPLORE_MAX_PAGES_PER_REFILL && !exploreNoMore; pages++) {
            const page = explorePage + 1;
            let works = [];
            try {
                const result = await userWorks.listAll({ app: CONFIG.userWorksApp, page, pageSize: EXPLORE_PAGE_SIZE, sortBy: 'hot' });
                works = Array.isArray(result?.list) ? result.list : (Array.isArray(result) ? result : []);
            } catch (_) { works = []; }
            explorePage = page;
            if (!works.length) { exploreNoMore = true; break; }
            let newUnseen = 0;
            works.forEach(work => {
                const item = exploreItemFromWork(work);
                if (!item || exploreFetchedKeys.has(item.id)) return;
                exploreFetchedKeys.add(item.id);
                exploreFetchedItems.push(item);
                added++;
                if (!exploreSeenMap?.[item.id]) newUnseen++;
            });
            if (newUnseen >= EXPLORE_REFILL_TARGET) break;
        }
        return added;
    }

    // 从已拉取的候选里取最多 n 个还没放进信息流的条目：优先「未看过」，不够再用「已看过」兜底。
    function takeExploreItems(n) {
        const unseen = [];
        const seen = [];
        exploreFetchedItems.forEach(item => {
            if (exploreShownKeys.has(item.id)) return;
            if (exploreSeenMap?.[item.id]) seen.push(item); else unseen.push(item);
        });
        const picked = [];
        for (const item of [...unseen, ...seen]) {
            if (picked.length >= n) break;
            exploreShownKeys.add(item.id);
            picked.push(item);
        }
        return picked;
    }

    // 补充一批探索条目：先用缓冲里现成的，不够且还没翻到底就翻页再取。多处并发调用复用同一个 promise。
    function refillExploreItems(want = EXPLORE_REFILL_TARGET) {
        if (exploreRefillPromise) return exploreRefillPromise;
        exploreRefillPromise = (async () => {
            await ensureExploreSeen();
            let picked = takeExploreItems(want);
            if (picked.length < want && !exploreNoMore) {
                await growExploreBuffer();
                picked = picked.concat(takeExploreItems(want - picked.length));
            }
            return picked;
        })().finally(() => { exploreRefillPromise = null; });
        return exploreRefillPromise;
    }

    function exploreSlideHtml(game, index) {
        const title = escapeHtml(getMinigameTitle(game));
        const desc = game.desc ? escapeHtml(game.desc) : '';
        return `
            <section class="mh-explore-slide" data-explore-index="${index}" data-game-id="${escapeHtml(game.id)}">
                <div class="mh-explore-frame-host"></div>
                <div class="mh-explore-poster">
                    ${renderMinigameIcon(game)}
                    <div class="mh-explore-poster-title">${title}</div>
                    ${desc ? `<div class="mh-explore-poster-desc">${desc}</div>` : ''}
                    <div class="mh-explore-poster-spinner" aria-hidden="true"></div>
                </div>
            </section>`;
    }

    async function renderExplorePane() {
        const pane = $('mhMinigameExplore');
        if (!pane) return;
        setExploreMode(true);
        // 已构建过则保留滚动位置（含上次的随机顺序）；观察器会在面板重新可见时挂载居中的那一个游戏。
        if (pane.dataset.built === '1') { setupExploreObserver(); return; }
        const token = cleanupMessageListener;
        const items = await refillExploreItems(EXPLORE_REFILL_TARGET);
        // 异步取作品清单期间视图可能已切换 / 销毁，丢弃过期结果。
        if (cleanupMessageListener !== token || !$('mhMinigameExplore') || activeMinigameTab !== 'explore') return;
        exploreItems = items;
        if (!items.length) {
            pane.innerHTML = `<div class="mh-explore-empty">${escapeHtml(t('mgExploreEmpty'))}</div>`;
            return;
        }
        pane.innerHTML = items.map((game, i) => exploreSlideHtml(game, i)).join('');
        pane.dataset.built = '1';
        // 首次滑动（scroll）即视为交互，淡出"上滑翻页"提示。
        pane.addEventListener('scroll', dismissExploreHint, { once: true, passive: true });
        bindExploreControls();
        setupExploreObserver();
    }

    // 快滑到信息流末尾前提前补充新作品并追加 slide（抖音式无限流，但仍受「不重复 / 控制请求数」约束）。
    function maybePrefetchExplore() {
        if (exploreActiveIndex >= exploreItems.length - EXPLORE_PREFETCH_AHEAD) appendMoreExploreSlides();
    }

    async function appendMoreExploreSlides() {
        if (exploreAppending) return;
        exploreAppending = true;
        const token = cleanupMessageListener;
        try {
            const more = await refillExploreItems(EXPLORE_REFILL_TARGET);
            if (cleanupMessageListener !== token || activeMinigameTab !== 'explore') return;
            const pane = $('mhMinigameExplore');
            if (!pane || !more.length) return;
            const startIndex = exploreItems.length;
            exploreItems = exploreItems.concat(more);
            pane.insertAdjacentHTML('beforeend', more.map((game, i) => exploreSlideHtml(game, startIndex + i)).join(''));
            pane.querySelectorAll('.mh-explore-slide').forEach(slide => {
                if (Number(slide.dataset.exploreIndex) >= startIndex) exploreObserver?.observe(slide);
            });
            updateExploreNavState();
        } finally {
            exploreAppending = false;
        }
    }

    // 进入 / 退出探索模式：底部把 tabs 栏换成"上一个 / 下一个"底栏（不遮挡游戏区），并切换顶栏收藏/分享。
    function setExploreMode(on) {
        const tabs = $('mhMinigameTabs');
        const bottomBar = $('mhExploreBottomBar');
        const hint = $('mhExploreHint');
        if (tabs) tabs.style.display = on ? 'none' : 'flex';
        if (bottomBar) bottomBar.style.display = on ? 'flex' : 'none';
        if (hint) hint.classList.toggle('dismissed', exploreHintDismissed);
        if (!on) {
            // 退出探索：还原顶栏标题、隐藏收藏/分享（信息流 iframe 由调用方卸载）。
            const titleEl = $('mhMinigameTitle');
            if (titleEl) { titleEl.textContent = t('mgPlay'); titleEl.removeAttribute('title'); }
            hidePlayLikeButton();
        }
    }

    function bindExploreControls() {
        const prev = $('mhExplorePrev');
        const next = $('mhExploreNext');
        if (prev) prev.onclick = () => exploreGo(-1);
        if (next) next.onclick = () => exploreGo(1);
        updateExploreNavState();
    }

    // 是否允许翻页：游戏已加载完成即可翻；否则等到 3 秒加载超时再放行。
    function canExploreFlip() {
        if (exploreActiveIndex < 0) return true;
        if (exploreActiveLoaded) return true;
        return (Date.now() - exploreSlideActivatedAt) >= EXPLORE_LOAD_TIMEOUT_MS;
    }

    // 距离"超时放行"还差多少毫秒（仅用于到点自动恢复按钮可点）。
    function exploreFlipTimeoutRemainingMs() {
        if (!exploreSlideActivatedAt) return 0;
        return Math.max(0, EXPLORE_LOAD_TIMEOUT_MS - (Date.now() - exploreSlideActivatedAt));
    }

    // 过早翻页提示（节流，避免连续快滑刷屏）。
    function showExploreTooFastToast() {
        const now = Date.now();
        if (now - exploreTooFastToastAt < 1500) return;
        exploreTooFastToastAt = now;
        showToast(t('mgExploreTooFast'), 'info', 1400);
    }

    // 翻页：delta=+1 下一个，-1 上一个。
    // 没加载完就翻页 → 忽略并提示"滑太快啦"（除非已超过 3 秒加载超时）。
    function exploreGo(delta) {
        if (!canExploreFlip()) { showExploreTooFastToast(); scheduleExploreNavRefresh(); return; }
        dismissExploreHint();
        scrollExploreToIndex(exploreActiveIndex + delta);
    }

    // 加载超时到点后自动恢复"上一个/下一个"按钮可点（加载完成时则由 markExploreLoaded 立即恢复）。
    function scheduleExploreNavRefresh() {
        if (exploreFlipCooldownTimer) { clearTimeout(exploreFlipCooldownTimer); exploreFlipCooldownTimer = null; }
        const remain = exploreFlipTimeoutRemainingMs();
        if (remain <= 0 || exploreActiveLoaded) { updateExploreNavState(); return; }
        exploreFlipCooldownTimer = setTimeout(() => {
            exploreFlipCooldownTimer = null;
            updateExploreNavState();
        }, remain + 20);
    }

    // 当前格加载完成：立即放行翻页并恢复按钮可点。
    function markExploreLoaded() {
        exploreActiveLoaded = true;
        if (exploreFlipCooldownTimer) { clearTimeout(exploreFlipCooldownTimer); exploreFlipCooldownTimer = null; }
        updateExploreNavState();
    }

    // 在顶栏 / 底栏 / 信息流上识别滑动手势翻页（PC 鼠标拖拽 + 移动端触摸 + 滚轮），
    // 但保留点击：只有移动超过阈值才翻页并吞掉随后的 click。运行中的游戏 iframe 会吞掉触摸事件，
    // 故信息流上的手势只在加载封面阶段触发，且统一经限速后的 exploreGo，不影响游戏内交互。
    // swipeDir: 'up' 上滑→下一个（底栏）；'down' 下滑→上一个（顶栏）；'both' 双向（信息流）。
    function attachBarGestures(el, swipeDir) {
        if (!el) return;
        let suppressNextClick = false;
        el.addEventListener('wheel', (e) => {
            if (activeMinigameTab !== 'explore') return;
            if (Math.abs(e.deltaY) < 4) return;
            e.preventDefault();
            const now = Date.now();
            if (now < exploreWheelCooldown) return;
            exploreWheelCooldown = now + 380;
            exploreGo(e.deltaY > 0 ? 1 : -1);
        }, { passive: false });
        el.addEventListener('pointerdown', (e) => {
            if (activeMinigameTab !== 'explore') return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            suppressNextClick = false;
            const startY = e.clientY;
            let moved = false;
            const move = (ev) => { if (Math.abs(ev.clientY - startY) > 8) moved = true; };
            const up = (ev) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                const dy = ev.clientY - startY;
                if (Math.abs(dy) < 28) return;
                if ((swipeDir === 'up' || swipeDir === 'both') && dy < 0) { exploreGo(1); suppressNextClick = moved; }
                else if ((swipeDir === 'down' || swipeDir === 'both') && dy > 0) { exploreGo(-1); suppressNextClick = moved; }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
        // 捕获阶段吞掉滑动后误触发的 click（点击操作不受影响：未滑动时 suppressNextClick 为 false）。
        el.addEventListener('click', (e) => {
            if (suppressNextClick) { e.preventDefault(); e.stopPropagation(); suppressNextClick = false; }
        }, true);
    }

    function bindExploreBarGestures() {
        attachBarGestures($('mhExploreBottomBar'), 'up');   // 底栏：上滑 → 下一个
        attachBarGestures($('mhMinigameTopbar'), 'down');   // 顶栏：下滑 → 上一个
        attachBarGestures($('mhMinigameExplore'), 'both');  // 信息流：上滑下一个 / 下滑上一个（原生滚动已禁用，统一走限速翻页）
    }

    function scrollExploreToIndex(index) {
        const pane = $('mhMinigameExplore');
        if (!pane) return;
        const target = clamp(index, 0, exploreItems.length - 1);
        const slide = pane.querySelector(`[data-explore-index="${target}"]`);
        slide?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function updateExploreNavState() {
        const prev = $('mhExplorePrev');
        const next = $('mhExploreNext');
        // 当前游戏未加载完（且未到 3 秒超时）时翻页按钮置灰，给出"还不能翻页"的可视反馈。
        const blocked = !canExploreFlip();
        if (prev) prev.disabled = blocked || exploreActiveIndex <= 0;
        if (next) next.disabled = blocked || exploreActiveIndex < 0 || exploreActiveIndex >= exploreItems.length - 1;
    }

    function dismissExploreHint() {
        if (exploreHintDismissed) return;
        exploreHintDismissed = true;
        $('mhExploreHint')?.classList.add('dismissed');
    }

    function setupExploreObserver() {
        const pane = $('mhMinigameExplore');
        if (!pane || !exploreItems.length) return;
        exploreObserver?.disconnect();
        exploreObserver = new IntersectionObserver((entries) => {
            let best = null;
            entries.forEach((entry) => {
                if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
                    if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
                }
            });
            if (!best) return;
            const index = Number(best.target.dataset.exploreIndex);
            setExploreActive(index);
        }, { root: pane, threshold: [0.6] });
        pane.querySelectorAll('.mh-explore-slide').forEach(slide => exploreObserver.observe(slide));
    }

    function setExploreActive(index) {
        if (index === exploreActiveIndex) return;
        // 切换到另一格视为交互，淡出提示。
        if (exploreActiveIndex >= 0) dismissExploreHint();
        unmountExploreFrame();
        exploreActiveIndex = index;
        // 记录本格激活时刻 + 复位"已加载"标记：翻页闸门（未加载完不许翻、3 秒超时放行）都以此为基准。
        exploreSlideActivatedAt = Date.now();
        exploreActiveLoaded = false;
        updateExploreNavState();
        scheduleExploreNavRefresh();
        const pane = $('mhMinigameExplore');
        const slide = pane?.querySelector(`[data-explore-index="${index}"]`);
        const game = exploreItems[index];
        if (!slide || !game) return;
        // 顶栏：展示当前游戏名 + 收藏 / 分享（与正常游戏 UI 一致）。
        const titleEl = $('mhMinigameTitle');
        const gameTitle = getMinigameTitle(game);
        if (titleEl) { titleEl.textContent = gameTitle; titleEl.title = gameTitle; }
        setTopbarActionsVisible(true);
        const likeMeta = game.__likeMeta || likeMetaForGame(game, { official: true });
        showPlayLikeButton(likeMeta);
        // 滑到并开始试玩即记为「已看过」（7 天内不再重复推送）。
        markExploreSeen(game);
        // 临近末尾就提前补充更多作品。
        maybePrefetchExplore();
        // 滑到哪一格就立即加载试玩（海报仅作加载封面，加载完成淡出）。
        mountExploreGame(slide, game);
    }

    function mountExploreGame(slide, game) {
        const host = slide.querySelector('.mh-explore-frame-host');
        if (!host) return;
        exploreActiveGame = game;
        exploreGameStartedAt = Date.now();
        exploreRewardedRounds = new Set();
        slide.classList.add('loading');
        slide.classList.remove('playing');
        const frame = document.createElement('iframe');
        frame.id = 'mhExploreFrame';
        frame.title = t('mgFrameTitle');
        frame.setAttribute('allow', game.allow || 'autoplay; fullscreen');
        frame.style.cssText = 'width:100%;height:100%;border:0;background:#fff;display:block';
        frame.onload = () => postGameConfig(frame);
        host.appendChild(frame);
        if (game.__exploreKind === 'mine' && game.__minePath) {
            // 我的作品：按 path 异步取 HTML 注入通用宿主页（与 openMineGame 同路径）。
            const token = cleanupMessageListener;
            loadPetGameHtml(game.__minePath).then((html) => {
                if (cleanupMessageListener !== token || !frame.isConnected) return;
                if (!html || !html.trim()) { hideExplorePoster(frame); return; }
                loadGameHtmlIntoFrame(frame, html, { onRendered: () => postGameConfig(frame) });
            }).catch(() => { /* 加载失败：交给下方兜底超时淡出海报 */ });
        } else if (game.__exploreKind === 'remote' && game.__remotePath) {
            // 公开作品：按作者 + path 远程取 HTML 注入通用宿主页。
            const token = cleanupMessageListener;
            loadRemotePetGameHtml(game.__remoteOwner, game.__remotePath).then((html) => {
                if (cleanupMessageListener !== token || !frame.isConnected) return;
                if (!html || !html.trim()) { hideExplorePoster(frame); return; }
                loadGameHtmlIntoFrame(frame, html, { onRendered: () => postGameConfig(frame) });
            }).catch(() => { /* 加载失败：交给下方兜底超时淡出海报 */ });
        } else {
            frame.src = minigameUrl(game.src);
        }
        // 兜底：部分小游戏不发送 gameLoaded，到点后也淡出加载海报。
        if (exploreLoadingTimer) clearTimeout(exploreLoadingTimer);
        exploreLoadingTimer = setTimeout(() => {
            exploreLoadingTimer = null;
            slide.classList.remove('loading');
            slide.classList.add('playing');
        }, MINIGAME_LOADING_MAX_MS);
    }

    function hideExplorePoster(frame) {
        if (exploreLoadingTimer) { clearTimeout(exploreLoadingTimer); exploreLoadingTimer = null; }
        // 加载完成（gameLoaded / 兜底超时 / HTML 注入失败）即放行翻页。
        markExploreLoaded();
        const slide = frame?.closest?.('.mh-explore-slide');
        if (!slide) return;
        slide.classList.remove('loading');
        slide.classList.add('playing');
    }

    function unmountExploreFrame() {
        if (exploreLoadingTimer) { clearTimeout(exploreLoadingTimer); exploreLoadingTimer = null; }
        const frame = $('mhExploreFrame');
        if (frame) {
            try { frame.removeAttribute('srcdoc'); frame.src = 'about:blank'; frame.removeAttribute('src'); } catch (_) {}
            const host = frame.parentElement;
            frame.remove();
            const slide = host?.closest?.('.mh-explore-slide');
            slide?.classList.remove('loading', 'playing');
        }
        exploreActiveGame = null;
        exploreActiveIndex = -1;
        exploreSlideActivatedAt = 0;
        exploreActiveLoaded = false;
        if (exploreFlipCooldownTimer) { clearTimeout(exploreFlipCooldownTimer); exploreFlipCooldownTimer = null; }
    }

    // 探索流里的小游戏完成：发奖励（金币/属性走 onGameFinished 回调）并提示，逻辑与 finishCurrentGame 对齐。
    function finishExploreGame(frame, data = {}) {
        const game = exploreActiveGame;
        if (!game) return;
        const finishedAt = data?.finishedAt || Date.now();
        const roundKey = minigameRoundKey(game, data, finishedAt);
        if (exploreRewardedRounds.has(roundKey)) return;
        exploreRewardedRounds.add(roundKey);
        const beforeStats = capturePetStatValues(currentPet);
        const beforeCoins = coinValue();
        const durationSeconds = activityDurationSeconds(data, exploreGameStartedAt, finishedAt);
        const rewardData = suppressCurrentRewards ? { levelReward: null, rewardCoins: null } : miniGameLevelReward(game, data, durationSeconds);
        const result = {
            ...data,
            completed: data?.completed ?? data?.passed ?? true,
            startedAt: exploreGameStartedAt || undefined,
            finishedAt,
            durationSeconds,
            statBonus: suppressCurrentRewards ? {} : miniGameStatBonus(game),
            ...(rewardData.levelReward ? rewardData : {}),
        };
        recordRecentPlay(game, game.__likeMeta || likeMetaForGame(game, { official: true }));
        onGameFinished?.(game, result);
        if (!suppressCurrentRewards && Number(data?.earnedPoints) > 0) soundManager.playPointReward();
        if (rewardData.rewardCoins) {
            const label = getMinigameRewardLabel(game, rewardData.levelReward);
            showToast(`${label} ${t('mgRewardCoins', { coins: rewardData.rewardCoins })}`, 'success', 1800);
        }
        refreshCoins({ previous: beforeCoins });
        refreshPetStats({ previous: beforeStats });
    }

    const onMessage = (event) => {
        const mainFrame = $('mhMinigameFrame');
        const exploreFrame = $('mhExploreFrame');
        let frame = null;
        if (mainFrame && event.source === mainFrame.contentWindow) frame = mainFrame;
        else if (exploreFrame && event.source === exploreFrame.contentWindow) frame = exploreFrame;
        if (!frame) return;
        const isExplore = frame === exploreFrame;
        const msg = event.data || {};
        // 通用宿主页握手：宿主就绪 → 下发游戏 HTML；宿主渲染完成 → 推送宠物配置（onRendered）。
        if (handleGameHostMessage(frame, msg)) return;
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
        if (isUnlockRequest(msg)) {
            handleUnlockRequest(frame, msg);
            return;
        }
        if (msg.type === 'haqi_open_vip') {
            handleOpenVipRequest(frame);
            return;
        }
        if (msg.type === 'haqi_get_vip_status') {
            postVipStatus(frame);
            return;
        }
        if (msg.type === 'gameLoaded') {
            if (isExplore) hideExplorePoster(frame);
            else setMinigameLoading(false);
            return;
        }
        if (msg.type === 'gameFinished' || msg.type === 'learningFinished') {
            if (isExplore) {
                finishExploreGame(frame, msg.data || {});
                return;
            }
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
        exploreObserver?.disconnect();
        exploreObserver = null;
        unmountExploreFrame();
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
    // 初始即落在"探索"标签时构建抖音式信息流。
    if (activeMinigameTab === 'explore') renderExplorePane();
    // 按需加载小游戏清单（只 fetch 一次并缓存），加载完成后渲染列表 / 启动初始游戏。
    const renderToken = cleanupMessageListener;
    if (MINIGAMES.length) {
        renderGameList();
        if (initialGameId && !currentGame) openGame(initialGameId, initialGameParams, { allowLowEnergy: allowPlayWhenLowEnergy, forceLandscape: initialGameLandscape });
    } else {
        loadMinigameIndex().then(() => {
            // 视图在加载期间被销毁/重渲染时丢弃过期回调。
            if (cleanupMessageListener !== renderToken || !$('mhMinigameList')) return;
            renderGameList();
            // 清单异步加载完成后，若当前停留在"探索"标签则构建信息流。
            if (activeMinigameTab === 'explore') renderExplorePane();
            if (initialGameId && !currentGame) openGame(initialGameId, initialGameParams, { allowLowEnergy: allowPlayWhenLowEnergy, forceLandscape: initialGameLandscape });
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
    // 外部小游戏深链进入：?remoteGame=<url>，不依赖清单，直接把远程 URL 当作 iframe src 打开。
    if (remoteGame?.url && !initialGameId && !sharedGame && !currentGame) {
        openRemoteGame(remoteGame);
    }

    async function openSharedGame({ fromUsername, game } = {}) {
        const username = String(fromUsername || '').trim();
        const filename = String(game || '').trim();
        if (!filename) return;
        // 无 gameFrom → 官方内置游戏分享链接（?game=<officialId>），按 id 打开内置游戏。
        if (!username) {
            await loadMinigameIndex();
            if (cleanupMessageListener !== renderToken || !$('mhMinigameFrameWrap')) return;
            const builtin = getPlayItems().find(item => item.src && item.id === filename && !item.hidden);
            if (builtin) openGame(filename, null, { allowLowEnergy: true });
            else showToast(t('mgSharedGameMissing'), 'error', 2400);
            return;
        }
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
        // 真实游戏名：取作者小游戏清单里的标题，避免显示通用的"分享的小游戏"（尤其加入收藏后）。
        const title = await resolveSharedGameTitle(username, sharedPath, baseName, html);
        openGame(sharedId, null, {
            allowLowEnergy: true,
            html,
            game: { id: sharedId, title, icon: '🎮' },
            // 收藏键以 owner + 基础名（baseName）为准。
            likeMeta: {
                id: baseName,
                path: sharedPath,
                owner: username,
                title,
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

function isUnlockRequest(msg) {
    return String(msg?.type || '') === 'haqi_request_unlock';
}

// 处理小游戏的「解锁付费点」请求：转调 sdk.ads.requestUnlock（看广告解锁 / 会员免广告），
// 把结果回执给 iframe（haqi_unlock_result）。老版 SDK 还没有 ads 模块时本地占位兜底，
// 保证「看广告→解锁」整条流程在 SDK 上线前也能跑通。
async function handleUnlockRequest(frame, msg) {
    const sourceWindow = frame?.contentWindow;
    if (!sourceWindow) return;
    const requestId = msg.requestId || msg.id || null;
    const scene = (msg.scene || msg.data?.scene || 'minigame').toString();
    const title = (msg.title || msg.data?.title || '').toString();
    // 立即 ack：告诉小游戏「宿主已接手」，让它取消独立兜底、安心等待最终结果
    // （解锁可能涉及看广告/会员窗口，耗时较长）。
    try { sourceWindow.postMessage({ type: 'haqi_unlock_ack', requestId }, '*'); } catch (_) {}
    let res = { unlocked: false, via: 'cancel' };
    try {
        const ads = state.sdk?.ads;
        if (ads && typeof ads.requestUnlock === 'function') {
            res = await ads.requestUnlock({ scene, title });
        } else {
            res = await localUnlockFallback(title);
        }
    } catch (_) {
        res = { unlocked: false, via: 'error' };
    }
    try {
        sourceWindow.postMessage({ type: 'haqi_unlock_result', requestId, ok: true, ...res }, '*');
    } catch (_) {}
    // 若本次因会员而解锁，主动回传会员状态，使后续付费点直接跳过广告。
    if (res && res.via === 'vip') { postVipStatus(frame, true); }
}

// 查询真实会员状态：优先 keepworkSDK 真实会员（含付费会员），无 SDK 时回退到应用内会员开关。
async function isUserVipNow(forceRefresh = false) {
    try {
        if (state.sdk && typeof state.sdk.isUserVip === 'function') {
            return !!(await state.sdk.isUserVip(forceRefresh ? { useCache: false } : {}));
        }
    } catch (_) {}
    return !!state.isPaid;
}

// 把当前会员状态回传给小游戏 iframe（小游戏据此跳过广告）。
async function postVipStatus(frame, isVipOverride) {
    const sourceWindow = frame?.contentWindow;
    if (!sourceWindow) return;
    const isVip = typeof isVipOverride === 'boolean' ? isVipOverride : await isUserVipNow();
    try { sourceWindow.postMessage({ type: 'haqi_vip_status', isVip }, '*'); } catch (_) {}
}

// 小游戏内点击「开通会员·永久免广告」：打开 keepwork 个人中心（含会员开通/激活与真实支付），
// 关闭后重新核对真实会员状态，同步应用内会员开关并回传给小游戏。
async function handleOpenVipRequest(frame) {
    const sdk = state.sdk;
    try {
        if (sdk && typeof sdk.showProfileWindow === 'function') {
            await sdk.showProfileWindow();
        } else {
            // 无 SDK（如本地预览）兜底：沿用应用内会员模拟开关。
            state.isPaid = true;
            try { saveUserProfileDebounced(); } catch (_) {}
        }
    } catch (_) {}
    // 强制刷新核对真实会员状态（用户可能刚完成支付/激活）。
    const isVip = await isUserVipNow(true);
    if (isVip && !state.isPaid) { state.isPaid = true; try { saveUserProfileDebounced(); } catch (_) {} }
    await postVipStatus(frame, isVip);
    if (isVip) { try { showToast('会员已生效，免广告', 'success', 1600); } catch (_) {} }
}

// 解锁付费点的三选一弹层：看广告 / 开通会员（永久免广告）/ 取消。返回 'ad' | 'vip' | 'cancel'。
function chooseUnlockAction(title) {
    return new Promise((resolve) => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal-card text-center">
                <div class="text-base font-bold mb-1" style="color:var(--text-primary)">${escapeHtml(title || '解锁此功能')}</div>
                <div class="text-xs mb-3" style="color:var(--text-muted)">看一段广告即可解锁，或开通会员永久免广告</div>
                <div class="flex flex-col gap-2 mt-3">
                    <button class="btn-primary" data-act="ad">📺 看广告解锁</button>
                    <button class="btn-secondary" data-act="vip" style="border-color:var(--accent);color:var(--accent)">👑 开通会员 · 永久免广告</button>
                    <button class="btn-secondary" data-act="cancel">取消</button>
                </div>
            </div>`;
        const done = (v) => { mask.remove(); resolve(v); };
        mask.addEventListener('click', (e) => {
            if (e.target === mask) return done('cancel');
            const act = e.target.closest?.('[data-act]')?.dataset.act;
            if (act) done(act);
        });
        document.body.appendChild(mask);
    });
}

// 降级兜底：当前加载的 SDK 还没有 ads 模块时，用弹层提供「看广告解锁 / 开通会员 / 会员免广告」。
async function localUnlockFallback(title) {
    if (await isUserVipNow()) return { unlocked: true, via: 'vip' };
    const choice = await chooseUnlockAction(title);
    if (choice === 'ad') return { unlocked: true, via: 'ad' };
    if (choice === 'vip') {
        // 打开 keepwork 真实开通会员/支付流程，完成后核对会员状态。
        const sdk = state.sdk;
        try {
            if (sdk && typeof sdk.showProfileWindow === 'function') await sdk.showProfileWindow();
            else { state.isPaid = true; try { saveUserProfileDebounced(); } catch (_) {} }
        } catch (_) {}
        const isVip = await isUserVipNow(true);
        if (isVip && !state.isPaid) { state.isPaid = true; try { saveUserProfileDebounced(); } catch (_) {} }
        return isVip ? { unlocked: true, via: 'vip' } : { unlocked: false, via: 'cancel' };
    }
    return { unlocked: false, via: 'cancel' };
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

// ---------- 强制横屏（game.landscape === true） ----------
// 只对手机 / 触屏设备生效；桌面浏览器窗口宽高比不受设备物理方向约束，不需要旋转。
function isTouchLikeDevice() {
    try {
        return window.matchMedia?.('(pointer: coarse)').matches
            || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    } catch (_) {
        return false;
    }
}

let forcedLandscapeGame = null;
let forcedLandscapeMediaQuery = null;

function updateForcedLandscapeLayout() {
    const wrap = $('mhMinigameFrameWrap');
    if (!wrap) return;
    let portrait = false;
    try { portrait = window.matchMedia('(orientation: portrait)').matches; } catch (_) {}
    const active = !!forcedLandscapeGame && isTouchLikeDevice() && portrait;
    wrap.classList.toggle('mh-minigame-force-landscape', active);
}

// 进入游戏时若标记了 landscape：优先尝试原生 screen.orientation.lock()（多数浏览器需先全屏才生效，
// best-effort，静默失败），并挂 CSS 兜底——竖屏时把容器旋转 90 度铺满视口，跟随 orientation 变化实时开关。
function enterForcedLandscape(game) {
    if (!game?.landscape) return;
    forcedLandscapeGame = game;
    try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch (_) {}
    if (!forcedLandscapeMediaQuery) {
        try {
            forcedLandscapeMediaQuery = window.matchMedia('(orientation: portrait)');
            forcedLandscapeMediaQuery.addEventListener?.('change', updateForcedLandscapeLayout);
        } catch (_) {}
    }
    updateForcedLandscapeLayout();
}

function exitForcedLandscape() {
    if (!forcedLandscapeGame) return;
    forcedLandscapeGame = null;
    $('mhMinigameFrameWrap')?.classList.remove('mh-minigame-force-landscape');
    try { screen.orientation?.unlock?.(); } catch (_) {}
}

// 通过 ?remoteGame=<url> 深链启动的外部小游戏：合成一个 game 对象直接走 openGame，
// 不依赖 _minigame_index.json 清单（不在"推荐/探索"列表中出现，仅用于本次深链打开）。
function openRemoteGame({ url, title, icon, landscape, allow } = {}) {
    const trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) return;
    const game = {
        id: `remote:${trimmedUrl}`,
        title: title || t('mgDefaultName'),
        icon: icon || '🎮',
        src: trimmedUrl,
        allow: allow || 'autoplay; fullscreen',
        landscape: !!landscape,
        hidden: true,
    };
    openGame(game.id, null, { allowLowEnergy: true, game });
}

// html / game：玩家自创小游戏会直接传入 HTML 正文 + 合成 game 对象，通过 srcdoc 加载；
// 官方游戏走 game.src + minigameUrl。
function openGame(gameId, params = null, { allowLowEnergy = false, html = null, game: providedGame = null, likeMeta = null, forceLandscape = null } = {}) {
    const baseGame = providedGame || getPlayItems().find(item => item.id === gameId);
    if (!baseGame) return;
    // forceLandscape 非空时覆盖该游戏自身清单里的 landscape 配置（如 NPC 显式指定强制/取消横屏）。
    const game = forceLandscape != null ? { ...baseGame, landscape: forceLandscape } : baseGame;
    if (!allowLowEnergy && !canPlayGame(currentPet)) {
        refreshPetStats();
        showToast(t('mgLowEnergy'), 'info', 1400);
        return;
    }
    currentGame = game;
    rewardedRounds = new Set();
    currentGameStartedAt = Date.now();
    enterForcedLandscape(game);
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
    // srcdoc 路径：load 事件推送配置；宿主页兜底路径：mhGameRendered 握手推送配置（见 gameHostFrame.js）。
    frame.onload = () => postGameConfig();
    if (html != null) {
        loadGameHtmlIntoFrame(frame, html, { onRendered: () => postGameConfig() });
    } else {
        frame.removeAttribute('srcdoc');
        frame.src = minigameUrl(game.src, params);
    }
}

async function postGameConfig(frame = $('mhMinigameFrame')) {
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
    exitForcedLandscape();
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

// 顶栏收藏 / 分享按钮：仅游玩中显示，已收藏时收藏按钮高亮并显示"已收藏"。
function hidePlayLikeButton() {
    const btn = $('mhMinigameLikeBtn');
    if (btn) btn.style.display = 'none';
    const shareBtn = $('mhMinigameShareBtn');
    if (shareBtn) shareBtn.style.display = 'none';
}

function renderPlayLikeButton() {
    const shareBtn = $('mhMinigameShareBtn');
    if (shareBtn) shareBtn.style.display = currentGameLikeMeta ? 'inline-flex' : 'none';
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
