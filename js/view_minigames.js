// 玩耍视图：小游戏列表 + iframe 容器
import { $, clamp, coinIconSvg, confirm, escapeHtml, showToast } from './utils.js';
import { getLang, t } from './i18n.js';
import { CONFIG } from './config.js';
import { state } from './state.js';
import { displayPetName } from './dna.js';
import { getPet, getPetAsync, getPetImagePayload } from './pet.js';
import { isPetOnCurrentPlanet } from './petLifecycle.js';
import { deletePetGame, loadPetGameHtml, loadPetGameList } from './storage.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();
const STAT_REWARD_ANIMATION_MS = 1600;
const DEFAULT_MINIGAME_STAT_BONUS = { bond: 12, mood: 6 };
const MINIGAME_REST_PROMPT_MS = 5 * 60 * 1000;
const MINIGAME_ENTRY_CLICK_GUARD_MS = 520;
const MINIGAME_COMPLETION_PROMPT_MIN_SECONDS = 60;
const MINIGAME_PET_IMAGE_REQUESTS = new Set([
    'haqi_get_pet_image',
    'haqiGetPetImage',
]);
const MINIGAME_ALL_PET_IMAGE_REQUESTS = new Set([
    'haqi_get_pet_images',
    'haqi_get_all_pet_images',
    'haqiGetPetImages',
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
// 底部标签：'recommend' 官方推荐 | 'create' 创造 | 'mine' 我的
let activeMinigameTab = 'recommend';

export function renderMinigames(panel, { pet }, { onBack, onGameFinished, initialGameId = null, initialGameParams = null, allowPlayWhenLowEnergy = false, suppressRewards = false, exitGameToBack = false, completionPrompt = null, deferGameFinishedUntilCompletionExit = false, initialTab = null, onCreateGame = null, onEditGame = null } = {}) {
    cleanupMessageListener?.();
    currentGame = null;
    rewardedRounds = new Set();
    currentPet = pet || null;
    suppressCurrentRewards = !!suppressRewards;
    activeMinigameTab = (initialTab && MINIGAME_TABS.some(tab => tab.id === initialTab)) ? initialTab : 'recommend';
    const ignoreListClicksUntil = initialGameId ? 0 : Date.now() + MINIGAME_ENTRY_CLICK_GUARD_MS;
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
                border: 1.5px solid rgba(125,211,252,.78);
                border-radius: 14px;
                background: rgba(255,255,255,.92);
                padding: 12px 10px 10px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                min-height: 150px;
            }
            .mh-minigame-mine-card .mh-minigame-mine-del {
                position: absolute;
                top: 6px;
                right: 6px;
                width: 24px;
                height: 24px;
                border-radius: 999px;
                border: 1.5px solid rgba(148,163,184,.45);
                background: rgba(255,255,255,.78);
                color: rgba(100,116,139,.78);
                font-size: 16px;
                font-weight: 900;
                line-height: 1;
                display: grid;
                place-items: center;
                padding: 0;
                box-shadow: none;
            }
            .mh-minigame-mine-ico { font-size: 40px; line-height: 1; }
            .mh-minigame-mine-title { font-weight: 800; color: var(--text-primary); font-size: 16px; line-height: 1.2; text-align: center; }
            .mh-minigame-mine-desc { color: var(--text-muted); font-size: 12px; line-height: 1.35; text-align: center; max-width: 14em; }
            .mh-minigame-mine-actions { margin-top: auto; display: flex; gap: 6px; width: 100%; }
            .mh-minigame-mine-actions button { flex: 1; min-width: 0; padding: 7px 6px; font-size: 12px; }
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
            <span class="font-bold" style="color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t('mgPlay'))}</span>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:5px;max-width:min(64vw,440px);overflow:visible">
                ${renderCoinPill('mhMinigameCoins', 'mh-minigame-coin-pill')}
                <div id="mhMinigamePetStats" aria-label="${escapeHtml(t('mgPetStatsAria'))}" style="display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0;overflow:visible">
                    ${renderPetStatPills(pet)}
                </div>
            </div>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow:hidden;background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 46%,#d9f99d 100%)">
            <div id="mhMinigameTabContent" style="position:absolute;inset:0 0 ${initialGameId ? '0' : '58px'} 0;overflow:hidden;display:${initialGameId ? 'none' : 'block'}">
                <div id="mhMinigameList" class="mh-minigame-tab-pane" data-mh-tab-pane="recommend" style="height:100%;overflow:auto;padding:14px;display:${activeMinigameTab === 'recommend' ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;align-content:start">
                    ${renderGameCards(getPlayItems())}
                </div>
                <div id="mhMinigameMine" class="mh-minigame-tab-pane" data-mh-tab-pane="mine" style="position:absolute;inset:0;overflow:auto;display:${activeMinigameTab === 'mine' ? 'block' : 'none'}"></div>
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
                        <div class="mh-minigame-loading-subtitle">${escapeHtml(t('mgOpening'))}</div>
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
                <button type="button" class="btn-primary" id="mhMinigameDone" style="display:none;position:absolute;right:12px;bottom:12px;z-index:3;padding:8px 14px;font-size:13px">完成玩耍</button>
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

    function renderGameList() {
        const list = $('mhMinigameList');
        if (!list) return;
        list.innerHTML = renderGameCards(getPlayItems());
        list.querySelectorAll('[data-game-id]').forEach(btn => {
            btn.onclick = (e) => {
                if (e?.isTrusted && Date.now() < ignoreListClicksUntil) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                openGame(btn.dataset.gameId);
            };
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
        if (mine) mine.style.display = tabId === 'mine' ? 'block' : 'none';
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
        mine.innerHTML = `<div class="mh-minigame-mine-grid"><div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineLoading'))}</div></div>`;
        let records = [];
        try {
            records = await loadPetGameList();
        } catch (e) {
            if (cleanupMessageListener !== token || !$('mhMinigameMine')) return;
            mine.innerHTML = `<div class="mh-minigame-mine-grid"><div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineLoadFailed'))}</div></div>`;
            return;
        }
        if (cleanupMessageListener !== token || !$('mhMinigameMine') || activeMinigameTab !== 'mine') return;
        mine.innerHTML = `<div class="mh-minigame-mine-grid">${renderMineCards(records)}</div>`;
        bindMineCards(records);
    }

    function renderMineCards(records) {
        if (!records.length) {
            return `<div class="mh-minigame-mine-empty">${escapeHtml(t('mgMineEmpty'))}</div>`;
        }
        return records.map(record => `
            <article class="mh-minigame-mine-card" data-mh-mine-path="${escapeHtml(record.path)}">
                <button type="button" class="mh-minigame-mine-del" data-mh-mine-delete="${escapeHtml(record.path)}" aria-label="${escapeHtml(t('mgMineDelete'))}" title="${escapeHtml(t('mgMineDelete'))}">×</button>
                <span class="mh-minigame-mine-ico" aria-hidden="true">${escapeHtml(record.icon || '🎮')}</span>
                <span class="mh-minigame-mine-title">${escapeHtml(record.title || t('mgDefaultName'))}</span>
                ${record.desc ? `<span class="mh-minigame-mine-desc">${escapeHtml(record.desc)}</span>` : ''}
                <div class="mh-minigame-mine-actions">
                    <button type="button" class="btn-secondary" data-mh-mine-edit="${escapeHtml(record.path)}">${escapeHtml(t('slEdit'))}</button>
                    <button type="button" class="btn-primary" data-mh-mine-play="${escapeHtml(record.path)}">${escapeHtml(t('slPlay'))}</button>
                </div>
            </article>
        `).join('');
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
            const playBtn = e.target.closest?.('[data-mh-mine-play]');
            if (playBtn) {
                openMineGame(playBtn.dataset.mhMinePlay, records);
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
        openGame(record.id || record.path, null, { html, game: { id: record.id || record.path, title: record.title, icon: record.icon } });
    }

    const onMessage = (event) => {
        const frame = $('mhMinigameFrame');
        if (!frame || event.source !== frame.contentWindow) return;
        const msg = event.data || {};
        if (isPetImageRequest(msg)) {
            handlePetImageRequest(frame, msg);
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
        rewardedRounds = new Set();
        currentPet = null;
        currentGameStartedAt = 0;
        suppressCurrentRewards = false;
        clearMinigameRestPrompt();
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
        return items.map(game => `
            <button type="button" class="card-flat" data-game-id="${escapeHtml(game.id)}" style="text-align:center;min-height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-radius:12px;cursor:pointer">
                ${renderMinigameIcon(game)}
                <span style="font-weight:800;color:var(--text-primary);font-size:17px;line-height:1.2">${escapeHtml(getMinigameTitle(game))}</span>
                ${game.desc ? `<span style="color:var(--text-muted);font-size:12px;line-height:1.35;max-width:12em">${escapeHtml(game.desc)}</span>` : ''}
            </button>
        `).join('');
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
        <span class="${className} mh-coin-amount" id="${id}" title="金币：玩耍可获得，用来购买食物、家具和道具。" aria-label="金币 ${coinValue()}"
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
    const effect = delta > 0 ? `完成玩耍后 +${delta}` : `完成玩耍后 ${delta}`;
    return `${label} ${value}，${effect}`;
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
function openGame(gameId, params = null, { allowLowEnergy = false, html = null, game: providedGame = null } = {}) {
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
    setMinigameLoading(true);
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
    showToast(t('mgStartGame', { title: getMinigameTitle(game) }), 'info', 1000);
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
    if (done) done.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
    if (tabContent) tabContent.style.display = 'block';
    if (tabs) tabs.style.display = 'flex';
    currentGame = null;
    rewardedRounds = new Set();
    currentGameStartedAt = 0;
}

function setMinigameLoading(isLoading) {
    const loading = $('mhMinigameLoading');
    const wrap = $('mhMinigameFrameWrap');
    const active = !!isLoading;
    if (wrap) wrap.classList.toggle('mh-minigame-is-loading', active);
    if (!loading) return;
    loading.classList.toggle('show', active);
    loading.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
}
