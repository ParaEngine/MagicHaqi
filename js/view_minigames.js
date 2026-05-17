// 玩耍视图：小游戏列表 + iframe 容器
import { $, coinIconSvg, escapeHtml, showToast } from './utils.js';
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
        id: 'schulte_grid',
        title: '舒尔特方格',
        icon: '📊',
        src: './minigames/haqi_schulte_grid.html',
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
    },
    {
        id: 'match_three_pets',
        title: '宠物三消',
        icon: '🐾',
        src: './minigames/haqi_match_three_pets.html',
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
let rewardedRound = '';
let currentPet = null;
let currentGameStartedAt = 0;
let defaultEggBlobPromise = null;

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
                ${PLAY_ITEMS.map(game => `
                    <button type="button" class="card-flat" data-game-id="${escapeHtml(game.id)}" style="text-align:center;min-height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border-radius:12px;cursor:pointer">
                        <span style="font-size:48px;line-height:1">${game.icon}</span>
                        <span style="font-weight:800;color:var(--text-primary);font-size:17px;line-height:1.2">${escapeHtml(game.title)}</span>
                        ${game.desc ? `<span style="color:var(--text-muted);font-size:12px;line-height:1.35;max-width:12em">${escapeHtml(game.desc)}</span>` : ''}
                    </button>
                `).join('')}
            </div>
            <div id="mhMinigameFrameWrap" style="display:none;position:absolute;inset:0;background:#0f2747">
                <iframe id="mhMinigameFrame" title="玩耍内容" style="width:100%;height:100%;border:0;background:#fff" allow="autoplay; fullscreen"></iframe>
                <button type="button" class="btn-primary" id="mhMinigameDone" style="display:none;position:absolute;right:12px;bottom:12px;z-index:3;padding:8px 14px;font-size:13px">完成玩耍</button>
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
        if (msg.type === 'gameLoaded') return;
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
        rewardedRound = '';
        currentPet = null;
        currentGameStartedAt = 0;
        cleanupMessageListener = null;
    };
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
    return {};
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

function openGame(gameId) {
    const game = PLAY_ITEMS.find(item => item.id === gameId);
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
    const done = $('mhMinigameDone');
    if (!list || !wrap || !frame) return;
    list.style.display = 'none';
    wrap.style.display = 'block';
    if (done) done.style.display = game.manualComplete ? 'block' : 'none';
    frame.setAttribute('allow', game.allow || 'autoplay; fullscreen');
    frame.src = `${game.src}${game.src.includes('?') ? '&' : '?'}t=${Date.now()}`;
    showToast(`开始 ${game.title}`, 'info', 1000);
}

function finishCurrentGame(onGameFinished, data = {}) {
    if (!currentGame) return;
    if (rewardedRound) return;
    const finishedAt = data?.finishedAt || Date.now();
    const roundKey = `${currentGame.id || 'game'}:${finishedAt}`;
    rewardedRound = roundKey;
    const beforeStats = capturePetStatValues(currentPet);
    const beforeCoins = coinValue();
    onGameFinished?.(currentGame, {
        ...data,
        completed: true,
        startedAt: currentGameStartedAt || undefined,
        finishedAt,
        durationSeconds: activityDurationSeconds(data, currentGameStartedAt, finishedAt),
        statBonus: miniGameStatBonus(currentGame),
    });
    if (Number(data?.earnedPoints) > 0) soundManager.playPointReward();
    refreshCoins({ previous: beforeCoins, animate: true });
    refreshPetStats({ previous: beforeStats, animate: true });
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
    const done = $('mhMinigameDone');
    resetMinigameIframe();
    if (done) done.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
    if (list) list.style.display = 'grid';
    currentGame = null;
    rewardedRound = '';
    currentGameStartedAt = 0;
}
