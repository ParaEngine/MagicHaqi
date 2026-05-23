// 玩耍视图：小游戏列表 + iframe 容器
import { $, clamp, coinIconSvg, confirm, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { CONFIG } from './config.js';
import { state } from './state.js';
import { displayPetName } from './dna.js';
import { generatePetSheet, getEggDataUrl, getPetSpriteCell, getProcessedSheet, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { isPetOnCurrentPlanet } from './petLifecycle.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();
const STAT_REWARD_ANIMATION_MS = 1600;
const EGG_IMAGE_SIZE = 256;
const DEFAULT_MINIGAME_STAT_BONUS = { bond: 12, mood: 6 };
const MINIGAME_REST_PROMPT_MS = 5 * 60 * 1000;
const MINIGAME_ENTRY_CLICK_GUARD_MS = 520;
const MINIGAME_PET_IMAGE_REQUESTS = new Set([
    'haqi_get_pet_image',
    'haqiGetPetImage',
]);
const MINIGAME_ALL_PET_IMAGE_REQUESTS = new Set([
    'haqi_get_pet_images',
    'haqi_get_all_pet_images',
    'haqiGetPetImages',
]);

const MINIGAMES = [
    {
        id: 'pet_snake',
        title: '宠物贪吃蛇大乱斗',
        icon: '🐍',
        src: './minigames/haqi_pet_snake.html',
        statBonus: { bond: 26, mood: 12 },
        levelReward: { coins: { min: 14, max: 78 }, label: '大乱斗奖励', scoreDivisor: 14, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'zuma',
        title: '宠物祖玛',
        icon: '🟠',
        src: './minigames/haqi_zuma.html',
        statBonus: { bond: 24, mood: 10 },
        levelReward: { coins: { min: 12, max: 70 }, label: '祖玛奖励', scoreDivisor: 15, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'bubble_pets',
        title: '宠物泡泡龙',
        icon: '💦',
        src: './minigames/haqi_bubble_pets.html',
        statBonus: { bond: 22, mood: 10 },
        levelReward: { coins: { min: 12, max: 64 }, label: '泡泡奖励', scoreDivisor: 16, levelBonus: 4, passBonus: 10 },
    },
    {
        id: 'pet_tower_defense',
        title: '细胞免疫塔防',
        icon: '🏰',
        src: './minigames/haqi_pet_tower_defense.html',
        statBonus: { bond: 26, mood: 10 },
        levelReward: { coins: { min: 14, max: 74 }, label: '守护奖励', scoreDivisor: 18, levelBonus: 4, passBonus: 14 },
    },
    {
        id: 'pet_bath',
        title: '萌宠爱洗澡',
        icon: '🛁',
        src: './minigames/haqi_pet_bath.html',
        statBonus: { bond: 24, mood: 12 },
        levelReward: { coins: { min: 12, max: 68 }, label: '洗澡奖励', scoreDivisor: 14, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'match_three_pets',
        title: '宠物三消',
        icon: '🐾',
        src: './minigames/haqi_match_three_pets.html',
        levelReward: { coins: { min: 10, max: 50 }, label: '通关奖励', scoreDivisor: 18, passBonus: 12 },
    },
    {
        id: 'food_hexcells',
        title: '宠物寻食蜂巢',
        icon: '🍯',
        src: './minigames/haqi_food_hexcells.html',
        statBonus: { bond: 20, mood: 9 },
        levelReward: { coins: { min: 10, max: 55 }, label: '寻食奖励', scoreDivisor: 14, levelBonus: 3, passBonus: 10 },
    },
    {
        id: 'food_stack_match',
        title: '宠物食物叠叠消',
        icon: '🍱',
        src: './minigames/haqi_food_stack_match.html',
        statBonus: { bond: 22, mood: 10 },
        levelReward: { coins: { min: 12, max: 66 }, label: '叠叠消奖励', scoreDivisor: 16, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'canal_escape',
        title: '宠物运河营救',
        icon: '🚤',
        src: './minigames/haqi_canal_escape.html',
        statBonus: { bond: 18, mood: 10 },
        levelReward: { coins: { min: 10, max: 50 }, label: '通关奖励', scoreDivisor: 14, levelBonus: 3, passBonus: 10 },
    },
    {
        id: 'billiards',
        title: '宠物台球对战',
        icon: '🎱',
        src: './minigames/haqi_billiards.html',
        statBonus: { bond: 30, mood: 9 },
        levelReward: { coins: { min: 18, max: 88 }, label: '对战奖励', scoreDivisor: 12, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'sokoban',
        title: '宠物推箱子',
        icon: '📦',
        src: './minigames/haqi_sokoban.html',
        statBonus: { bond: 24, mood: 8 },
        levelReward: { coins: { min: 10, max: 50 }, label: '通关奖励', scoreDivisor: 12, levelBonus: 3, passBonus: 10 },
    },
    {
        id: 'laser_maze',
        title: '宠物激光迷宫',
        icon: '⚡',
        src: './minigames/haqi_laser_maze.html',
        statBonus: { bond: 26, mood: 10 },
        levelReward: { coins: { min: 14, max: 72 }, label: '解谜奖励', scoreDivisor: 12, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'lightbot',
        title: '宠物猎人编程',
        icon: '💡',
        src: './minigames/haqi_lightbot.html',
        statBonus: { bond: 28, mood: 8 },
        levelReward: { coins: { min: 12, max: 60 }, label: '编程奖励', scoreDivisor: 12, levelBonus: 4, passBonus: 12 },
    },
    {
        id: 'flappy_pet',
        title: '飞翔宠物',
        icon: '🐦',
        src: './minigames/haqi_flappy_pet.html',
        statBonus: { bond: 18, mood: 10 },
        levelReward: { coins: { min: 10, max: 55 }, label: '飞行奖励', scoreDivisor: 15, levelBonus: 3, passBonus: 10 },
    },
    {
        id: 'xiangqi',
        title: '宠物象棋',
        icon: '♟️',
        src: './minigames/haqi_xiangqi.html',
        statBonus: { bond: 32, mood: 8 },
        levelReward: { coins: { min: 20, max: 80 }, label: '对局奖励', scoreDivisor: 10, levelBonus: 4, passBonus: 8 },
    },
    {
        id: 'gomoku',
        title: '宠物五子棋',
        icon: '⚫⚪',
        src: './minigames/haqi_gomoku.html',
        statBonus: { bond: 32, mood: 8 },
        levelReward: { coins: { min: 20, max: 80 }, label: '对局奖励', scoreDivisor: 10, levelBonus: 4, passBonus: 8 },
    },
    {
        id: 'matrix_hack',
        title: '宠物矩阵破解',
        icon: '⌘',
        src: './minigames/haqi_matrix_hack.html',
        statBonus: { bond: 26, mood: 9 },
        levelReward: { coins: { min: 12, max: 72 }, label: '破解奖励', scoreDivisor: 12, levelBonus: 4, passBonus: 12 },
    },
];

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

const PLAY_ITEMS = [...MINIGAMES, ...PLAY_ACTIVITIES];

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
let defaultEggBlobPromise = null;
let restPromptTimer = null;
let restPromptOpen = false;
let suppressCurrentRewards = false;

export function renderMinigames(panel, { pet }, { onBack, onGameFinished, initialGameId = null, initialGameParams = null, allowPlayWhenLowEnergy = false, suppressRewards = false, exitGameToBack = false } = {}) {
    cleanupMessageListener?.();
    currentGame = null;
    rewardedRounds = new Set();
    currentPet = pet || null;
    suppressCurrentRewards = !!suppressRewards;
    const ignoreListClicksUntil = initialGameId ? 0 : Date.now() + MINIGAME_ENTRY_CLICK_GUARD_MS;
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
                .mh-minigame-loading-card,
                .mh-minigame-loading-spinner,
                .mh-minigame-loading-dots span { animation: none; }
            }
        </style>
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">玩耍</span>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:5px;max-width:min(64vw,440px);overflow:visible">
                ${renderCoinPill('mhMinigameCoins', 'mh-minigame-coin-pill')}
                <div id="mhMinigamePetStats" aria-label="宠物状态" style="display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0;overflow:visible">
                    ${renderPetStatPills(pet)}
                </div>
            </div>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow:hidden;background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 46%,#d9f99d 100%)">
            <div id="mhMinigameList" style="height:100%;overflow:auto;padding:14px;display:${initialGameId ? 'none' : 'grid'};grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;align-content:start">
                ${PLAY_ITEMS.map(game => `
                    <button type="button" class="card-flat" data-game-id="${escapeHtml(game.id)}" style="text-align:center;min-height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-radius:12px;cursor:pointer">
                        ${renderMinigameIcon(game)}
                        <span style="font-weight:800;color:var(--text-primary);font-size:17px;line-height:1.2">${escapeHtml(game.title)}</span>
                        ${game.desc ? `<span style="color:var(--text-muted);font-size:12px;line-height:1.35;max-width:12em">${escapeHtml(game.desc)}</span>` : ''}
                    </button>
                `).join('')}
            </div>
            <div id="mhMinigameFrameWrap" class="${initialGameId ? 'mh-minigame-is-loading' : ''}" style="display:${initialGameId ? 'block' : 'none'};position:absolute;inset:0;background:#0f2747">
                <iframe id="mhMinigameFrame" title="玩耍内容" style="width:100%;height:100%;border:0;background:#fff" allow="autoplay; fullscreen"></iframe>
                <div id="mhMinigameLoading" class="mh-minigame-loading${initialGameId ? ' show' : ''}" role="status" aria-live="polite" aria-label="小游戏加载中" aria-hidden="${initialGameId ? 'false' : 'true'}">
                    <div class="mh-minigame-loading-card">
                        <div class="mh-minigame-loading-spinner" aria-hidden="true"></div>
                        <div class="mh-minigame-loading-title">
                            加载中<span class="mh-minigame-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                        </div>
                        <div class="mh-minigame-loading-subtitle">正在打开小游戏</div>
                    </div>
                </div>
                <div id="mhMinigameRewardFx" class="mh-minigame-reward-fx" aria-live="polite"></div>
                <button type="button" class="btn-primary" id="mhMinigameDone" style="display:none;position:absolute;right:12px;bottom:12px;z-index:3;padding:8px 14px;font-size:13px">完成玩耍</button>
            </div>
        </div>`;

    $('mhBack').onclick = () => {
        if (currentGame) {
            if (exitGameToBack) {
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

    panel.querySelectorAll('[data-game-id]').forEach(btn => {
        btn.onclick = (e) => {
            if (e?.isTrusted && Date.now() < ignoreListClicksUntil) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            openGame(btn.dataset.gameId);
        };
    });
    $('mhMinigameDone').onclick = () => finishCurrentGame(onGameFinished);
    bindStatTips(panel);

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
            finishCurrentGame(onGameFinished, msg.data || {});
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
    if (initialGameId && !currentGame) openGame(initialGameId, initialGameParams, { allowLowEnergy: allowPlayWhenLowEnergy });

    function renderMinigameIcon(game) {
        const label = escapeHtml(game.title || '小游戏');
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
            const pets = currentPlanetPetsForMinigame();
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

        const pet = requestedPetForMinigame(msg);
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

function requestedPetForMinigame(msg) {
    const petId = msg?.petId || msg?.data?.petId;
    if (petId && state.pets?.[petId]) return state.pets[petId];
    if (currentPet?.id && state.pets?.[currentPet.id]) return state.pets[currentPet.id];
    if (currentPet) return currentPet;
    return state.currentPetId ? state.pets?.[state.currentPetId] : null;
}

function currentPlanetPetsForMinigame() {
    const ids = state.petOrder || [];
    const ordered = ids.map(id => state.pets?.[id]).filter(pet => pet && isPetOnCurrentPlanet(pet));
    if (currentPet?.id) {
        const current = state.pets?.[currentPet.id] || currentPet;
        return [current, ...ordered.filter(pet => pet.id !== currentPet.id)].slice(0, 10);
    }
    return ordered.slice(0, 10);
}

async function buildPetImagePayload(pet, msg = {}) {
    if (!pet) throw new Error('pet not found');
    if (pet.stage === 'egg') return await buildEggImagePayload(pet);

    let sheetUrl = pet.imageSheetUrl || '';
    if (!sheetUrl) sheetUrl = await generatePetSheet(pet) || '';
    if (!sheetUrl) throw new Error(`pet image is not available: ${pet.id || 'unknown'}`);

    const anim = msg?.anim || msg?.data?.anim;
    const originalAnim = pet.anim;
    if (anim) pet.anim = anim;
    const cell = getPetSpriteCell(pet);
    if (anim) pet.anim = originalAnim;
    if (!cell) return await buildEggImagePayload(pet);

    const processed = getProcessedSheet(sheetUrl);
    await processed?.promise;
    if (!(processed?.status === 'loaded' && processed.dataBlob && processed.width && processed.height)) {
        throw new Error(`pet image is still unavailable after processing: ${pet.id || 'unknown'}`);
    }

    const uv = petSpriteUv(cell, processed.width, processed.height);
    return {
        petId: pet.id || '',
        name: displayPetName(pet),
        stage: pet.stage || '',
        anim: anim || pet.anim || 'idle',
        imageBlob: processed.dataBlob,
        imageType: processed.dataBlob.type || 'image/png',
        imageWidth: processed.width,
        imageHeight: processed.height,
        uv,
    };
}

async function buildEggImagePayload(pet) {
    const imageBlob = await getDefaultEggBlob();
    return {
        petId: pet.id || '',
        name: displayPetName(pet),
        stage: pet.stage || 'egg',
        anim: 'egg',
        imageBlob,
        imageType: imageBlob.type || 'image/png',
        imageWidth: EGG_IMAGE_SIZE,
        imageHeight: EGG_IMAGE_SIZE,
        uv: {
            x: 0,
            y: 0,
            width: EGG_IMAGE_SIZE,
            height: EGG_IMAGE_SIZE,
            row: 0,
            col: 0,
            cols: 1,
            rows: 1,
            u0: 0,
            v0: 0,
            u1: 1,
            v1: 1,
        },
    };
}

function getDefaultEggBlob() {
    if (defaultEggBlobPromise) return defaultEggBlobPromise;
    defaultEggBlobPromise = new Promise((resolve, reject) => {
        try {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = EGG_IMAGE_SIZE;
                    canvas.height = EGG_IMAGE_SIZE;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) throw new Error('canvas context is not available');
                    ctx.clearRect(0, 0, EGG_IMAGE_SIZE, EGG_IMAGE_SIZE);
                    ctx.drawImage(img, 0, 0, EGG_IMAGE_SIZE, EGG_IMAGE_SIZE);
                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('failed to create egg image blob'));
                    }, 'image/png');
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = () => reject(new Error('failed to load egg image'));
            img.src = getEggDataUrl();
        } catch (e) {
            reject(e);
        }
    });
    return defaultEggBlobPromise;
}

function petSpriteUv(cell, imageWidth, imageHeight) {
    const x = Math.floor(cell.col * imageWidth / SHEET_COLS);
    const y = Math.floor(cell.row * imageHeight / SHEET_ROWS);
    const nextX = Math.floor((cell.col + 1) * imageWidth / SHEET_COLS);
    const nextY = Math.floor((cell.row + 1) * imageHeight / SHEET_ROWS);
    const width = Math.max(1, nextX - x);
    const height = Math.max(1, nextY - y);
    return {
        x,
        y,
        width,
        height,
        row: cell.row,
        col: cell.col,
        cols: SHEET_COLS,
        rows: SHEET_ROWS,
        u0: x / imageWidth,
        v0: y / imageHeight,
        u1: (x + width) / imageWidth,
        v1: (y + height) / imageHeight,
    };
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
            pill.title = '金币：玩耍可获得，用来购买食物、家具和道具。';
            pill.setAttribute('aria-label', `金币 ${value}`);
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

function openGame(gameId, params = null, { allowLowEnergy = false } = {}) {
    const game = PLAY_ITEMS.find(item => item.id === gameId);
    if (!game) return;
    if (!allowLowEnergy && !canPlayGame(currentPet)) {
        refreshPetStats();
        showToast('体力不足，先休息一下吧', 'info', 1400);
        return;
    }
    currentGame = game;
    rewardedRounds = new Set();
    currentGameStartedAt = Date.now();
    scheduleMinigameRestPrompt();
    const list = $('mhMinigameList');
    const wrap = $('mhMinigameFrameWrap');
    const frame = $('mhMinigameFrame');
    const done = $('mhMinigameDone');
    if (!list || !wrap || !frame) return;
    list.style.display = 'none';
    wrap.style.display = 'block';
    setMinigameLoading(true);
    if (done) done.style.display = game.manualComplete ? 'block' : 'none';
    frame.setAttribute('allow', game.allow || 'autoplay; fullscreen');
    frame.src = minigameUrl(game.src, params);
    showToast(`开始 ${game.title}`, 'info', 1000);
}

function minigameUrl(src, params = null) {
    const query = new URLSearchParams({ t: String(Date.now()) });
    if (params && typeof params === 'object') {
        Object.entries(params).forEach(([key, value]) => {
            if (value == null || value === '') return;
            query.set(key, String(value));
        });
    }
    return `${src}${src.includes('?') ? '&' : '?'}${query.toString()}`;
}

function finishCurrentGame(onGameFinished, data = {}) {
    if (!currentGame) return;
    const finishedAt = data?.finishedAt || Date.now();
    const roundKey = minigameRoundKey(currentGame, data, finishedAt);
    if (rewardedRounds.has(roundKey)) return;
    rewardedRounds.add(roundKey);
    const beforeStats = capturePetStatValues(currentPet);
    const beforeCoins = coinValue();
    const durationSeconds = activityDurationSeconds(data, currentGameStartedAt, finishedAt);
    const rewardData = suppressCurrentRewards ? { levelReward: null, rewardCoins: null } : miniGameLevelReward(currentGame, data, durationSeconds);
    onGameFinished?.(currentGame, {
        ...data,
        completed: data?.completed ?? data?.passed ?? true,
        startedAt: currentGameStartedAt || undefined,
        finishedAt,
        durationSeconds,
        statBonus: suppressCurrentRewards ? {} : miniGameStatBonus(currentGame),
        ...(rewardData.levelReward ? rewardData : {}),
    });
    if (!suppressCurrentRewards && Number(data?.earnedPoints) > 0) soundManager.playPointReward();
    if (rewardData.rewardCoins) playLevelRewardAnimation(currentGame, rewardData.rewardCoins, rewardData.levelReward);
    refreshCoins({ previous: beforeCoins, animate: true });
    refreshPetStats({ previous: beforeStats, animate: true });
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

function clearMinigameRestPrompt() {
    if (restPromptTimer) clearTimeout(restPromptTimer);
    restPromptTimer = null;
    restPromptOpen = false;
}

async function showMinigameRestPrompt() {
    restPromptTimer = null;
    if (!currentGame || restPromptOpen) return;
    restPromptOpen = true;
    const keepPlaying = await confirm('已经玩了5分钟，休息一下吧。要继续玩吗？', {
        okText: '继续玩',
        cancelText: '退出',
    });
    restPromptOpen = false;
    if (!currentGame) return;
    if (keepPlaying) {
        scheduleMinigameRestPrompt();
    } else {
        showList();
    }
}

function playLevelRewardAnimation(game, rewardCoins, levelReward) {
    const el = $('mhMinigameRewardFx');
    if (!el || !rewardCoins) return;
    const label = levelReward?.label || '通关奖励';
    const note = levelReward?.note || game?.title || '';
    el.classList.remove('show');
    el.innerHTML = `
        <span class="mh-minigame-reward-spark">🪙</span>
        <span class="mh-minigame-reward-spark">🪙</span>
        <span class="mh-minigame-reward-spark">✨</span>
        <div class="mh-minigame-reward-title">${escapeHtml(label)}</div>
        <div class="mh-minigame-reward-coins">${coinIconSvg('hud-coin-icon')}<span>+${escapeHtml(rewardCoins)} 金币</span></div>
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
        frame.src = 'about:blank';
    } catch (_) {}
}

function destroyMinigameIframe() {
    const frame = $('mhMinigameFrame');
    if (!frame) return;
    try {
        frame.src = 'about:blank';
        frame.removeAttribute('src');
    } catch (_) {}
    frame.remove();
}

function showList() {
    const list = $('mhMinigameList');
    const wrap = $('mhMinigameFrameWrap');
    const done = $('mhMinigameDone');
    resetMinigameIframe();
    clearMinigameRestPrompt();
    if (done) done.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
    if (list) list.style.display = 'grid';
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
