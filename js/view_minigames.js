// 玩耍视图：小游戏列表 + iframe 容器
import { $, coinIconSvg, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { CONFIG } from './config.js';
import { state } from './state.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();
const STAT_REWARD_ANIMATION_MS = 1600;

const MINIGAMES = [
    {
        id: 'schulte_grid',
        title: '舒尔特方格',
        icon: '📊',
        src: './minigames/haqi_schulte_grid.html',
        intelReward: 4,
    },
    {
        id: 'attention_focus',
        title: '一一对应',
        icon: '🎯',
        src: './minigames/haqi_attention_focus.html',
    },
    {
        id: 'find_numbers',
        title: '数字复读机',
        icon: '🔢',
        src: './minigames/haqi_find_numbers.html',
        intelReward: 3,
    },
];

const PET_STAT_ITEMS = [
    { k: 'mood', labelKey: 'statMood', icon: '😊' },
    { k: 'intel', labelKey: 'statIntel', icon: '📚' },
    { k: 'bond', labelKey: 'statBond', icon: '💛' },
    { k: 'energy', labelKey: 'statEnergy', icon: '⚡' },
    { k: 'hunger', labelKey: 'statHunger', icon: '🍎' },
].filter(it => isPlayAffectedStat(it.k));

let cleanupMessageListener = null;
let currentGame = null;
let rewardedRound = '';
let currentPet = null;
let currentGameStartedAt = 0;

export function renderMinigames(panel, { pet }, { onBack, onGameFinished } = {}) {
    cleanupMessageListener?.();
    currentGame = null;
    rewardedRound = '';
    currentPet = pet || null;
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
            .mh-minigame-coin-pill.coin-up {
                animation: mhMinigameStatPop 1.12s ease-out;
                background: #fef3c7 !important;
                border-color: rgba(217,119,6,.48) !important;
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
                .mh-minigame-stat-delta { animation: none; }
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
            <div id="mhMinigameList" style="height:100%;overflow:auto;padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;align-content:start">
                ${MINIGAMES.map(game => `
                    <button type="button" class="card-flat" data-game-id="${escapeHtml(game.id)}" style="text-align:center;min-height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-radius:12px;cursor:pointer">
                        <span style="font-size:48px;line-height:1">${game.icon}</span>
                        <span style="font-weight:800;color:var(--text-primary);font-size:17px;line-height:1.2">${escapeHtml(game.title)}</span>
                    </button>
                `).join('')}
            </div>
            <div id="mhMinigameFrameWrap" style="display:none;position:absolute;inset:0;background:#0f2747">
                <iframe id="mhMinigameFrame" title="小游戏" style="width:100%;height:100%;border:0;background:#fff" allow="autoplay; fullscreen"></iframe>
            </div>
        </div>`;

    $('mhBack').onclick = () => {
        if (currentGame) {
            showList();
            return;
        }
        cleanupMessageListener?.();
        onBack?.();
    };

    panel.querySelectorAll('[data-game-id]').forEach(btn => {
        btn.onclick = () => openGame(btn.dataset.gameId);
    });
    bindStatTips(panel);

    const onMessage = (event) => {
        const frame = $('mhMinigameFrame');
        if (!frame || event.source !== frame.contentWindow) return;
        const msg = event.data || {};
        if (msg.type === 'gameLoaded') return;
        if (msg.type === 'gameFinished') {
            const roundKey = `${currentGame?.id || 'game'}:${msg.data?.finishedAt || Date.now()}`;
            if (rewardedRound === roundKey) return;
            rewardedRound = roundKey;
            const beforeStats = capturePetStatValues(currentPet);
            const beforeCoins = coinValue();
            const finishedAt = msg.data?.finishedAt || Date.now();
            onGameFinished?.(currentGame, {
                ...(msg.data || {}),
                completed: true,
                startedAt: currentGameStartedAt || undefined,
                finishedAt,
                durationSeconds: activityDurationSeconds(msg.data || {}, currentGameStartedAt, finishedAt),
                statBonus: miniGameStatBonus(currentGame),
            });
            if (Number(msg.data?.earnedPoints) > 0) soundManager.playPointReward();
            refreshCoins({ previous: beforeCoins, animate: true });
            refreshPetStats({ previous: beforeStats, animate: true });
        }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('mh:tick', refreshPetStats);
    cleanupMessageListener = () => {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('mh:tick', refreshPetStats);
        destroyMinigameIframe();
        currentGame = null;
        rewardedRound = '';
        currentPet = null;
        currentGameStartedAt = 0;
        cleanupMessageListener = null;
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
        <span class="${className} mh-coin-amount" id="${id}" title="金币：玩耍和学习可获得，用来购买食物、家具和道具。" aria-label="金币 ${coinValue()}"
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
            pill.title = '金币：玩耍和学习可获得，用来购买食物、家具和道具。';
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
    if (key === 'intel') return currentGame ? miniGameIntelReward(currentGame) : maxMiniGameIntelReward();
    return Number(CONFIG.actions.play?.[key]) || 0;
}

function isPlayAffectedStat(key) {
    if (typeof CONFIG.actions.play?.[key] === 'number') return true;
    return key === 'intel' && maxMiniGameIntelReward() > 0;
}

function miniGameIntelReward(game) {
    return Math.max(0, Math.round(Number(game?.intelReward) || 0));
}

function maxMiniGameIntelReward() {
    return MINIGAMES.reduce((max, game) => Math.max(max, miniGameIntelReward(game)), 0);
}

function miniGameStatBonus(game) {
    const intel = miniGameIntelReward(game);
    return intel > 0 ? { intel } : {};
}

function canPlayGame(pet) {
    return statValue(pet, 'energy') >= Math.abs(Number(CONFIG.actions.play?.energy) || 0);
}

function petStatTip(key, label, value, delta) {
    if (key === 'intel' && !currentGame) {
        return `${label} ${value}，部分游戏通关后最多 +${delta}`;
    }
    const effect = delta > 0 ? `完成游戏后 +${delta}` : `完成游戏后 ${delta}`;
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

function openGame(gameId) {
    const game = MINIGAMES.find(item => item.id === gameId);
    if (!game) return;
    if (!canPlayGame(currentPet)) {
        refreshPetStats();
        showToast('体力不足，先休息一下吧', 'info', 1400);
        return;
    }
    currentGame = game;
    rewardedRound = '';
    currentGameStartedAt = Date.now();
    const list = $('mhMinigameList');
    const wrap = $('mhMinigameFrameWrap');
    const frame = $('mhMinigameFrame');
    if (!list || !wrap || !frame) return;
    list.style.display = 'none';
    wrap.style.display = 'block';
    frame.src = `${game.src}?t=${Date.now()}`;
    showToast(`开始 ${game.title}`, 'info', 1000);
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
    resetMinigameIframe();
    if (wrap) wrap.style.display = 'none';
    if (list) list.style.display = 'grid';
    currentGame = null;
    rewardedRound = '';
    currentGameStartedAt = 0;
}
