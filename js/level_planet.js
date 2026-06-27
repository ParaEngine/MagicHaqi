// Level 0 — Space / Planet 视图
// 从太空俯视宠物所在的星球。
// 相机距离范围：minCamera 时已经"贴到星球表面" → 触发 zoomIn 进入 field；
//               maxCamera 时已经"飞得很远" → 此处是最外层，无更外层可去。

import { $, clamp, coinIconSvg, escapeHtml, prompt, randId, showToast } from './utils.js';
import { getActivePlanetBuff, getActivePlanetWeather, isVisitingMode, notify, setCurrentPet, state } from './state.js';
import { addToInventory, getLayout, loadPet, loadPlanetVisitors, recordPlanetVisitor, saveLayout, savePet, savePetDebounced, saveUserProfileDebounced, setCurrentPetPersisted } from './storage.js';
import { clampEnergyToMax, defaultPermanentTrauma, defaultStats, dominantTraits } from './petTick.js';
import { computePlanetProgress, getPlanetDayNumber } from './planetProgress.js';
import { t } from './i18n.js';
import { decodeDna, displayPetName, dnaRarity, dnaToName, isAdultStage, randomDna } from './dna.js';
import { getRuntimePetStats, isPetOnCurrentPlanet, isPetSelectable, markPetHaqiIsland, selectablePets } from './petLifecycle.js';
import { buildEggSvg, getPetSpriteCell, petArtHtml, scanAndMount, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { CONFIG, currentPlanetMiningHourStart, getPlanetMiningCoins, getPlanetMiningState, getPlanetMiningVisualCoinCount, getStageName } from './config.js';
import { createSpaceTravel, spaceTravelHtml } from './spacetravel.js';
import { configureSpaceTravelView, getRemoteElementStock, getSocialVisitTip, handleVisitDestinationSelection, launchSocialVisit, loadOfficialVisitDestinations, remoteTravelPlanets, resetSpaceTravelViewState, showRemotePlanetPanel, showVisitReturnPrompt, SMALL_REMOTE_PLANETS, smallRemotePlanetsHtml, SOCIAL_FUEL_COST, socialVisitDestinationPickerHtml } from './view_spacetravel.js';
import { defaultPostcardText, drawPetPostcardImage, getPostcardTexts, hydratePetPostcardImages, normalizePostcardLayout, randomPostcardPhotoTheme, renderPetPostcardHtml, serializePostcardLayout } from './view_postcard.js';
import SoundManager from './soundManager.js';
import { getTerrainFieldSlots, getTerrainFieldType, TERRAIN_FIELD_SLOT_DEFS } from './view_terrain_fields.js';

const soundManager = SoundManager.getInstance();

const HAQI_DOWNLOAD_URL = 'https://keepwork.com/api/raw/maisi/maisi/webgames/data/magic_haqi_download';
const WEATHER_DURATION_MS = 30 * 60 * 1000;
const WEATHER_COOLDOWN_MS = 8 * 60 * 1000;
const PLANET_INFRA_MAX_LEVEL = 3;
const PLANET_SPACECRAFT_ENABLED = true;
const PLANET_DECOR_CANVAS_DPR = 2;
const PLANET_DECOR_CANVAS_PADDING = 0.2;
const PLANET_EXPRESSIONS = ['normal', 'happy', 'sad', 'dirty', 'hungry', 'sleeping', 'tired'];
const PLANET_EXPRESSION_ALIASES = {
    idle: 'normal',
    sleep: 'sleeping',
    asleep: 'sleeping',
};
const SHARE_POSTCARD_MAX_TEXT = 64;

function getSharedAudioEngine() {
    return window.keepwork?.audioEngine
        || window.KeepworkSDK?.getSharedAudioEngine?.()
        || window.AudioEngine?.getShared?.()
        || null;
}

function getSharedAudioContext() {
    const engine = getSharedAudioEngine();
    if (!engine?.isSupported?.()) return null;
    try { return engine.getContext(); } catch (_) { return null; }
}

function getSharedAudioDestination(ctx) {
    const engine = getSharedAudioEngine();
    try { return engine?.getDestination?.() || engine?.getOutputNode?.() || ctx.destination; } catch (_) { return ctx.destination; }
}
let __spaceTravel = null;
let __planetStarfield = null;

const WEATHER_OPTIONS = [
    { id: 'rain', emoji: '🌧️', nameKey: 'lpWeatherRainName', labelKey: 'lpWeatherRainLabel', unlock: 1, mood: -2, hunger: 4, messageKey: 'lpWeatherRainMsg' },
    { id: 'sunny', emoji: '☀️', nameKey: 'lpWeatherSunName', labelKey: 'lpWeatherSunLabel', unlock: 2, mood: 7, messageKey: 'lpWeatherSunMsg' },
    { id: 'breeze', emoji: '🍃', nameKey: 'lpWeatherBreezeName', labelKey: 'lpWeatherBreezeLabel', unlock: 4, clean: 5, mood: 3, messageKey: 'lpWeatherBreezeMsg' },
];

const ASTRO_BUFFS = [
    { id: 'gluttony', emoji: '🌕', nameKey: 'lpBuffGluttonyName', textKey: 'lpBuffGluttonyText', hunger: -8, mood: 4 },
    { id: 'garden', emoji: '🌿', nameKey: 'lpBuffGardenName', textKey: 'lpBuffGardenText', mood: 12 },
    { id: 'clarity', emoji: '🔭', nameKey: 'lpBuffClarityName', textKey: 'lpBuffClarityText', bond: 4 },
    { id: 'tidal', emoji: '🌊', nameKey: 'lpBuffTidalName', textKey: 'lpBuffTidalText', clean: 10, mood: 4 },
];

const PLANET_ACTION_DETAILS = {
    info: {
        icon: '🛰️',
        titleKey: 'lpActInfoTitle', textKey: 'lpActInfoText', effectKey: 'lpActInfoEffect', okTextKey: 'lpActInfoOk',
    },
    weather: {
        icon: '🌧️',
        titleKey: 'lpActWeatherTitle', textKey: 'lpActWeatherText', effectKey: 'lpActWeatherEffect', okTextKey: 'lpActWeatherOk',
        building: 'weatherTower',
    },
    visit: {
        icon: '🚀',
        titleKey: 'lpActVisitTitle', textKey: 'lpActVisitText', effectKey: 'lpActVisitEffect', okTextKey: 'lpActVisitOk',
        unlock: 2,
        building: 'spaceport',
    },
    ufo: {
        icon: '🛸',
        titleKey: 'lpActUfoTitle', textKey: 'lpActUfoText', effectKey: 'lpActUfoEffect', okTextKey: 'lpActUfoOk',
        unlock: 3,
        building: 'ufoPad',
    },
    astro: {
        icon: '🔭',
        titleKey: 'lpActAstroTitle', textKey: 'lpActAstroText', effectKey: 'lpActAstroEffect', okTextKey: 'lpActAstroOk',
        unlock: 1,
        building: 'observatory',
    },
    milestones: {
        icon: '🏆',
        titleKey: 'lpActMilestonesTitle', textKey: 'lpActMilestonesText', effectKey: 'lpActMilestonesEffect', okTextKey: 'lpActMilestonesOk',
    },
};

const PLANET_INFRASTRUCTURE = {
    weatherTower: {
        nameKey: 'lpInfraWeatherName',
        action: 'weather',
        x: 24,
        y: 23,
        scale: 1,
        buildCost: { coins: 60 },
        upgradeCosts: [{ coins: 90 }, { coins: 140 }],
        guideKey: 'lpInfraWeatherGuide',
    },
    spaceport: {
        nameKey: 'lpInfraSpaceportName',
        action: 'visit',
        x: 68,
        y: 30,
        scale: 1,
        buildCost: { coins: 120 },
        upgradeCosts: [{ coins: 180 }, { coins: 260 }],
        guideKey: 'lpInfraSpaceportGuide',
    },
    ufoPad: {
        nameKey: 'lpInfraUfoName',
        action: 'ufo',
        x: 41,
        y: 18,
        scale: 1,
        buildCost: { coins: 150 },
        upgradeCosts: [{ coins: 220 }, { coins: 320 }],
        guideKey: 'lpInfraUfoGuide',
    },
    observatory: {
        nameKey: 'lpInfraObservatoryName',
        action: 'astro',
        x: 65,
        y: -3,
        scale: 1,
        buildCost: { coins: 90 },
        upgradeCosts: [{ coins: 140 }, { coins: 210 }],
        guideKey: 'lpInfraObservatoryGuide',
    },
};

// Helpers to resolve localized fields from the constant objects above.
const infraName = (def) => def ? (def.nameKey ? t(def.nameKey) : def.name || '') : '';
const actionTitle = (d) => d ? (d.titleKey ? t(d.titleKey) : d.title || '') : '';
const buffName = (b) => b ? (b.nameKey ? t(b.nameKey) : b.name || '') : '';
const buffText = (b) => b ? (b.textKey ? t(b.textKey) : b.text || '') : '';
const weatherLabel = (w) => w ? (w.labelKey ? t(w.labelKey) : w.label || '') : '';
const weatherMessage = (w) => w ? (w.messageKey ? t(w.messageKey) : w.message || '') : '';
// 当前生效天气/星象的本地化名称（按 id 反查，避免依赖持久化的中文 name）。
function activeWeatherLabel(active) {
    if (!active) return '';
    const opt = WEATHER_OPTIONS.find(w => w.id === active.id);
    return opt ? weatherLabel(opt) : (active.name || '');
}

const PLANET_RESEARCH_ACTIONS = [
    { action: 'weather', nameKey: 'lpResWeatherName', descKey: 'lpResWeatherDesc' },
    { action: 'ufo', nameKey: 'lpResUfoName', descKey: 'lpResUfoDesc' },
    { action: 'astro', nameKey: 'lpResAstroName', descKey: 'lpResAstroDesc' },
    { action: 'visit', nameKey: 'lpResVisitName', descKey: 'lpResVisitDesc' },
];

configureSpaceTravelView({
    getSpaceTravel: () => __spaceTravel,
    getActionInfrastructureLevel,
    openPlanetModal,
    addPlanetLog,
    refreshTopbarResources,
});

function todayKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function untilTomorrow(now = Date.now()) {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

function clampStat(pet, key, delta) {
    if (!pet?.stats || typeof delta !== 'number') return;
    if (key === 'hunger' && delta > 0 && (pet.stage === 'egg' || pet.stage === 'baby')) return;
    pet.stats[key] = clamp((Number(pet.stats[key]) || 0) + delta, 0, 100);
    if (key === 'hunger') clampEnergyToMax(pet);
}

function addPlanetLog(type, text, emoji) {
    const entry = { type, text, emoji, at: Date.now() };
    recordPlanetVisitor(entry);
}

function getInfrastructure(buildingId) {
    const item = state.planetInfrastructure?.[buildingId];
    if (!item || typeof item !== 'object') return null;
    const level = Math.max(0, Math.min(PLANET_INFRA_MAX_LEVEL, Number(item.level) || 0));
    return level > 0 ? { ...item, level } : null;
}

function getInfrastructureLevel(buildingId) {
    return getInfrastructure(buildingId)?.level || 0;
}

function getActionInfrastructureLevel(action) {
    const buildingId = PLANET_ACTION_DETAILS[action]?.building;
    return buildingId ? getInfrastructureLevel(buildingId) : 0;
}

function infrastructureCost(buildingId, currentLevel = 0) {
    const def = PLANET_INFRASTRUCTURE[buildingId];
    if (!def) return null;
    if (currentLevel <= 0) return def.buildCost;
    if (currentLevel >= PLANET_INFRA_MAX_LEVEL) return null;
    return def.upgradeCosts[currentLevel - 1] || null;
}

function formatCost(cost) {
    if (!cost) return '';
    const parts = [];
    if (cost.coins) parts.push(t('lpCostCoins', { n: cost.coins }));
    if (cost.biofuel) parts.push(t('lpCostBiofuel', { n: cost.biofuel }));
    return parts.join(' + ') || t('lpCostFree');
}

function canAfford(cost) {
    return (state.coins | 0) >= (cost?.coins || 0) && (state.biofuel | 0) >= (cost?.biofuel || 0);
}

function spendCost(cost) {
    state.coins = Math.max(0, (state.coins | 0) - (cost?.coins || 0));
    state.biofuel = Math.max(0, (state.biofuel | 0) - (cost?.biofuel || 0));
    refreshTopbarResources();
}

function planetMiningCoins(now = Date.now()) {
    return getPlanetMiningCoins(state, now, CONFIG);
}

function planetMiningPileHtml(coins) {
    const amount = Math.max(0, Number(coins) || 0);
    if (amount <= 0) return '';
    const coinCount = getPlanetMiningVisualCoinCount(amount, CONFIG);
    const placements = [
        [-18, 4, -21, 1.02], [-6, -1, 9, 0.96], [8, 3, -9, 1.05], [20, 0, 18, 0.92],
        [-25, 13, 16, 0.88], [-10, 10, -6, 1.08], [5, 12, 24, 0.9], [18, 11, -15, 1],
        [-2, 20, 6, 0.94], [12, 20, -24, 0.86],
    ];
    return `<div class="planet-coin-pile" data-planet-mining-pile title="${escapeHtml(t('lpMiningTitle', { amount }))}" aria-label="${escapeHtml(t('lpMiningAria', { amount }))}">
        ${Array.from({ length: coinCount }).map((_, index) => {
            const [x, y, rot, scale] = placements[index] || [0, 0, 0, 1];
            return `<span class="planet-coin-piece" style="--coin-x:${x}px;--coin-y:${y}px;--coin-rot:${rot}deg;--coin-scale:${scale}"></span>`;
        }).join('')}
    </div>`;
}

function animatePlanetMiningCoinsToHud(amount, onArrive) {
    const target = $('mhCoins');
    const targetRect = target?.getBoundingClientRect?.();
    const source = document.querySelector('[data-planet-mining-pile]') || $('mhPlanet')?.querySelector?.('.planet-body');
    const sourceRect = source?.getBoundingClientRect?.();
    if (!targetRect || !sourceRect) {
        onArrive?.();
        return;
    }
    const startX = sourceRect.left + sourceRect.width * 0.5;
    const startY = sourceRect.top + sourceRect.height * 0.25;
    const endX = targetRect.left + targetRect.width * 0.5;
    const endY = targetRect.top + targetRect.height * 0.5;
    const fly = document.createElement('div');
    fly.className = 'planet-mining-fly-number';
    fly.textContent = `+${Math.max(0, amount | 0)}`;
    fly.style.left = startX + 'px';
    fly.style.top = startY + 'px';
    const dx = endX - startX;
    const dy = endY - startY;
    fly.style.setProperty('--planet-mining-fly-dx', dx.toFixed(1) + 'px');
    fly.style.setProperty('--planet-mining-fly-dy', dy.toFixed(1) + 'px');
    fly.style.setProperty('--planet-mining-fly-mid-x', (dx * 0.44).toFixed(1) + 'px');
    fly.style.setProperty('--planet-mining-fly-mid-y', (dy * 0.24 - 28).toFixed(1) + 'px');
    document.body.appendChild(fly);

    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        fly.remove();
        onArrive?.();
        target.classList.add('planet-mining-hud-pop');
        setTimeout(() => target.classList.remove('planet-mining-hud-pop'), 520);
    };
    fly.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 1500);
}

function collectPlanetMiningCoins() {
    const now = Date.now();
    const reward = planetMiningCoins(now);
    if (reward <= 0) return false;
    const mining = getPlanetMiningState(state, now);
    mining.lastCollectedHourAt = currentPlanetMiningHourStart(now);
    mining.lastCollectedAt = now;
    mining.fieldCollectedCoins = 0;
    state.coins = Math.max(0, (Number(state.coins) || 0) + reward);
    addPlanetLog('mining', t('lpMiningLog', { reward }), '🪙');
    saveUserProfileDebounced();
    soundManager.playPointReward();
    animatePlanetMiningCoinsToHud(reward, refreshTopbarResources);
    showToast(t('lpMiningToast', { reward }), 'success', 2600);
    notify();
    return true;
}

function buildOrUpgradeInfrastructure(buildingId) {
    const def = PLANET_INFRASTRUCTURE[buildingId];
    if (!def) return false;
    const current = getInfrastructure(buildingId);
    const currentLevel = current?.level || 0;
    if (currentLevel >= PLANET_INFRA_MAX_LEVEL) {
        showToast(t('lpInfraMaxed', { name: infraName(def) }), 'info');
        return false;
    }
    const cost = infrastructureCost(buildingId, currentLevel);
    if (!canAfford(cost)) {
        showToast(t('lpInfraNotEnough', { cost: formatCost(cost) }), 'error', 2600);
        return false;
    }
    spendCost(cost);
    const nextLevel = currentLevel + 1;
    state.planetInfrastructure = state.planetInfrastructure || {};
    state.planetInfrastructure[buildingId] = {
        level: nextLevel,
        builtAt: current?.builtAt || Date.now(),
        upgradedAt: Date.now(),
    };
    addPlanetLog(currentLevel ? 'upgrade' : 'build', t('lpInfraUpLog', { name: infraName(def), level: nextLevel }), '🏗️');
    saveUserProfileDebounced();
    notify();
    if (currentLevel) soundManager.playBuildLevelUp();
    else soundManager.playBuildCreated();
    showToast(currentLevel ? t('lpInfraUpToast', { name: infraName(def), level: nextLevel }) : t('lpInfraBuiltToast', { name: infraName(def) }), 'success', 2200);
    return true;
}

function isLocked(progress, unlockLevel) {
    return progress.level < unlockLevel;
}

function lockedTitle(unlockLevel) {
    return t('lpLockedTitle', { level: unlockLevel });
}

function weatherById(id) {
    return WEATHER_OPTIONS.find(w => w.id === id) || WEATHER_OPTIONS[0];
}

function dailyBuffForToday(now = Date.now()) {
    const progress = computePlanetProgress(now);
    return ASTRO_BUFFS[(progress.planetDays - 1) % ASTRO_BUFFS.length];
}

function weatherDurationMs() {
    const level = getActionInfrastructureLevel('weather') || 1;
    return WEATHER_DURATION_MS + (level - 1) * 10 * 60 * 1000;
}

function weatherCooldownMs() {
    const level = getActionInfrastructureLevel('weather') || 1;
    return Math.max(4 * 60 * 1000, WEATHER_COOLDOWN_MS - (level - 1) * 2 * 60 * 1000);
}

function astroMultiplier() {
    const level = getActionInfrastructureLevel('astro') || 1;
    return 1 + (level - 1) * 0.25;
}

function actionEffect(detail) {
    if (!detail) return '';
    return detail.effectKey ? t(detail.effectKey, { fuel: SOCIAL_FUEL_COST }) : (detail.effect || '');
}

function actionEffectText(action, detail, buildingId, infraLevel) {
    const effect = actionEffect(detail);
    if (buildingId === 'weatherTower') {
        return `${effect} ${t('lpWeatherDurInfo', { dur: Math.round(weatherDurationMs() / 60000), cd: Math.round(weatherCooldownMs() / 60000) })}`;
    }
    if (buildingId === 'spaceport') {
        return getSocialVisitTip('haqi');
    }
    if (buildingId === 'ufoPad') {
        return `${effect} ${t('lpUfoGiftInfo', { level: infraLevel || 1, gifts: Math.max(1, infraLevel || 1) })}`;
    }
    if (buildingId === 'observatory') {
        return `${effect} ${t('lpAstroMultInfo', { mult: astroMultiplier().toFixed(2) })}`;
    }
    return effect;
}

function planetInfrastructureEntries() {
    const entries = Object.entries(PLANET_INFRASTRUCTURE)
        .map(([id, def]) => ({ id, def, infra: getInfrastructure(id) }))
        .filter(item => item.infra);
    return entries.map(({ id, def, infra }) => {
        const angle = Math.atan2(def.y - 50, def.x - 50);
        const rimRadius = 53;
        return {
            id,
            level: infra.level,
            x: 50 + Math.cos(angle) * rimRadius,
            y: 50 + Math.sin(angle) * rimRadius,
            rotation: angle * 180 / Math.PI + 90,
            scale: Number(def.scale) || 1,
        };
    });
}

function planetTerrainFieldEntries() {
    const slots = getTerrainFieldSlots({ includeEmpty: true });
    const radiusScale = 1.13;
    return slots.map((slot, index) => {
        const pos = TERRAIN_FIELD_SLOT_DEFS[index] || slot;
        const isBrow = pos.index === 2 || pos.index === 3;
        const isLowerSlot = pos.index >= 5;
        const slotRadiusScale = isLowerSlot ? 1.22 : radiusScale;
        const angle = Math.atan2(pos.y - 50, pos.x - 50);
        return {
            typeId: slot.typeId,
            x: 50 + (pos.x - 50) * slotRadiusScale,
            y: 50 + (pos.y - 50) * slotRadiusScale,
            rotation: isBrow ? 0 : (angle * 180 / Math.PI + 90),
            isBrow,
        };
    }).filter(entry => entry.typeId);
}

const planetDecorImageCache = new Map();
let planetDecorBitmapCache = { signature: '', canvas: null };
let planetDecorRenderId = 0;

function loadPlanetDecorImage(key, src) {
    if (!src) return Promise.resolve(null);
    if (planetDecorImageCache.has(key)) return planetDecorImageCache.get(key);
    const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
    planetDecorImageCache.set(key, promise);
    return promise;
}

function svgToDataUrl(svgMarkup) {
    let markup = String(svgMarkup || '').trim();
    if (markup && !markup.includes('xmlns=')) markup = markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

const cssBackgroundImageUrlCache = new Map();
function cssBackgroundImageUrl(className) {
    if (!className || typeof document === 'undefined') return '';
    if (cssBackgroundImageUrlCache.has(className)) return cssBackgroundImageUrlCache.get(className);
    const el = document.createElement('span');
    el.className = `field-tab-svg-icon ${className}`;
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:28px;height:28px;pointer-events:none';
    document.body.appendChild(el);
    const bg = getComputedStyle(el).backgroundImage || '';
    el.remove();
    const match = bg.match(/^url\(["']?(.*?)["']?\)$/);
    const result = match ? match[1] : '';
    cssBackgroundImageUrlCache.set(className, result);
    return result;
}

function drawRotatedImage(ctx, image, x, y, width, height, rotationDeg = 0) {
    if (!image) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotationDeg * Math.PI / 180);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
}

function drawTerrainEmoji(ctx, emoji, x, y, size, rotationDeg = 0) {
    if (!emoji) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotationDeg * Math.PI / 180);
    ctx.font = `900 ${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Draw outline for depth (cheaper than shadowBlur)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.lineJoin = 'round';
    ctx.strokeText(emoji, 0, 1);
    ctx.fillText(emoji, 0, 1);
    ctx.restore();
}

const PLANET_TREE_SPROUTS = [
    { left: 30, bottom: 86, rotation: -13, scale: 0.66, opacity: 0.82, flower: 0 },
    { left: 55, bottom: 87, rotation: 6, scale: 0.7, opacity: 0.82, flower: 0 },
    { left: 66, bottom: 86, rotation: 17, scale: 0.62, opacity: 0.78, flower: 0 },
    { left: 25, bottom: 82, rotation: -20, scale: 0.84, opacity: 1, flower: 1 },
    { left: 36, bottom: 82, rotation: -8, scale: 1.02, opacity: 1, flower: 2 },
    { left: 48, bottom: 84, rotation: 2, scale: 1.12, opacity: 1, flower: 1 },
    { left: 60, bottom: 82, rotation: 11, scale: 0.98, opacity: 1, flower: 2 },
    { left: 71, bottom: 82, rotation: 22, scale: 0.82, opacity: 1, flower: 1 },
];

function drawLeaf(ctx, x, y, width, height, rotation, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.scale(scale, scale);
    const w = width;
    const h = height;
    const gradient = ctx.createLinearGradient(0, -h, 0, 0);
    gradient.addColorStop(0, '#c9ff9a');
    gradient.addColorStop(0.72, '#37bf72');
    gradient.addColorStop(1, '#178d61');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(-w / 2, 0);
    ctx.quadraticCurveTo(0, -h * 0.12, w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawFlower(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ff86c5';
    [[-4, 0], [4, 0], [0, -4], [0, 4]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(dx, dy, 3.4, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = '#ffe36e';
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawTreeSprout(ctx, sprout, size) {
    const baseX = size * sprout.left / 100;
    const baseY = size * (1 - sprout.bottom / 100);
    const width = size * 0.11;
    const height = size * 0.2;
    ctx.save();
    ctx.globalAlpha = sprout.opacity;
    ctx.translate(baseX, baseY);
    ctx.rotate(sprout.rotation * Math.PI / 180);
    ctx.scale(sprout.scale, sprout.scale);

    const stemGradient = ctx.createLinearGradient(0, -height * 0.52, 0, 0);
    stemGradient.addColorStop(0, '#8b5a2b');
    stemGradient.addColorStop(1, '#5b351c');
    ctx.strokeStyle = stemGradient;
    ctx.lineWidth = Math.max(2, width * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -height * 0.52);
    ctx.stroke();

    const leafY = -height * 0.42;
    drawLeaf(ctx, -width * 0.22, leafY, width * 0.82, height * 0.42, -28, 0.76);
    drawLeaf(ctx, 0, leafY - height * 0.06, width * 0.82, height * 0.42, 0, 1);
    drawLeaf(ctx, width * 0.22, leafY, width * 0.82, height * 0.42, 28, 0.74);
    if (sprout.flower) {
        const flowerX = sprout.flower === 2 ? -width * 0.16 : width * 0.16;
        const flowerY = -height * (sprout.flower === 2 ? 0.56 : 0.62);
        drawFlower(ctx, flowerX, flowerY, sprout.flower === 2 ? 0.82 : 1);
    }
    ctx.restore();
}

function drawPlanetTreeHair(ctx, size) {
    ctx.save();
    ctx.fillStyle = 'rgba(19, 96, 83, 0.18)';
    ctx.translate(size * 0.515, size * 0.145);
    ctx.rotate(-3 * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.235, size * 0.065, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    PLANET_TREE_SPROUTS.forEach(sprout => drawTreeSprout(ctx, sprout, size));
}

function planetDecorSignature(pixelSize, infrastructure, terrain) {
    return JSON.stringify({
        pixelSize,
        infrastructure: infrastructure.map(entry => [entry.id, entry.level, entry.x.toFixed(2), entry.y.toFixed(2), entry.rotation.toFixed(1), entry.scale]),
        terrain: terrain.map(entry => [entry.typeId, entry.x.toFixed(2), entry.y.toFixed(2), entry.rotation.toFixed(1), entry.isBrow ? 1 : 0]),
    });
}

function setupPlanetDecorDisplayCanvas(canvas, pixelSize) {
    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
        canvas.width = pixelSize;
        canvas.height = pixelSize;
    }
}

function blitPlanetDecorBitmap(canvas) {
    const cached = planetDecorBitmapCache.canvas;
    if (!cached) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cached, 0, 0);
    return true;
}

async function drawPlanetDecorCanvas() {
    const canvas = $('mhPlanetDecorCanvas');
    const body = canvas?.closest?.('.planet-body');
    if (!canvas || !body || !canvas.isConnected) return;
    const rect = body.getBoundingClientRect();
    const size = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
    const padding = size * PLANET_DECOR_CANVAS_PADDING;
    const canvasSize = size + padding * 2;
    const dpr = Math.max(1, Math.min(PLANET_DECOR_CANVAS_DPR, window.devicePixelRatio || 1));
    const pixelSize = Math.round(canvasSize * dpr);
    const infrastructure = planetInfrastructureEntries();
    const terrain = planetTerrainFieldEntries();
    const signature = planetDecorSignature(pixelSize, infrastructure, terrain);
    setupPlanetDecorDisplayCanvas(canvas, pixelSize);
    if (planetDecorBitmapCache.signature === signature && blitPlanetDecorBitmap(canvas)) return;

    const renderId = ++planetDecorRenderId;
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = pixelSize;
    renderCanvas.height = pixelSize;
    const ctx = renderCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    for (const entry of infrastructure) {
        const img = await loadPlanetDecorImage(`infra:${entry.id}:${entry.level}`, svgToDataUrl(planetInfrastructureSvg(entry.id, entry.level)));
        if (!canvas.isConnected || renderId !== planetDecorRenderId) return;
        const baseSize = entry.id === 'weatherTower' || entry.id === 'observatory' ? 32 : 34;
        const drawSize = baseSize * entry.scale * (size / 180);
        drawRotatedImage(ctx, img, padding + size * entry.x / 100, padding + size * entry.y / 100, drawSize, drawSize, entry.rotation);
    }

    for (const entry of terrain) {
        const type = getTerrainFieldType(entry.typeId);
        if (!type) continue;
        const x = padding + size * entry.x / 100;
        const y = padding + size * entry.y / 100;
        const rotation = entry.isBrow ? 0 : entry.rotation;
        const drawSize = 28 * (size / 180);
        if (type.iconClass) {
            const img = await loadPlanetDecorImage(`terrain:${type.iconClass}`, cssBackgroundImageUrl(type.iconClass));
            if (!canvas.isConnected || renderId !== planetDecorRenderId) return;
            drawRotatedImage(ctx, img, x, y, drawSize, drawSize, rotation);
        } else {
            drawTerrainEmoji(ctx, type.emoji || '🪐', x, y, 25 * (size / 180), rotation);
        }
    }
    ctx.save();
    ctx.translate(padding, padding);
    drawPlanetTreeHair(ctx, size);
    ctx.restore();
    if (!canvas.isConnected || renderId !== planetDecorRenderId) return;
    planetDecorBitmapCache = { signature, canvas: renderCanvas };
    blitPlanetDecorBitmap(canvas);
}

function planetActionIconHtml(action) {
    if (action === 'terrainFields') return '🗺️';
    if (action === 'starSettlements') return '🚀';
    if (action === 'milestones') return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <path d="M21 56h22" stroke="#7c2d12" stroke-width="5" stroke-linecap="round"/>
            <path d="M27 47h10v9H27z" fill="#f59e0b" stroke="#7c2d12" stroke-width="3" stroke-linejoin="round"/>
            <path d="M18 15h28v12c0 11-6 19-14 19s-14-8-14-19z" fill="#facc15" stroke="#7c2d12" stroke-width="3" stroke-linejoin="round"/>
            <path d="M18 20H8c0 10 5 17 13 18" fill="none" stroke="#7c2d12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M46 20h10c0 10-5 17-13 18" fill="none" stroke="#7c2d12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M32 19l2.5 5.2 5.8.8-4.2 4.1 1 5.8-5.1-2.7-5.1 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff7ad" stroke="#a16207" stroke-width="2" stroke-linejoin="round"/>
        </svg>`;
    const buildingId = PLANET_ACTION_DETAILS[action]?.building;
    if (!buildingId) return PLANET_ACTION_DETAILS[action]?.icon || '';
    return planetInfrastructureSvg(buildingId, Math.max(1, getActionInfrastructureLevel(action) || 1));
}

function isReadonlyPlanet() {
    return state.settings?.starSettlement?.source === 'official' && state.settings.starSettlement.readonlyPlanet !== false;
}

function planetInfrastructureSvg(id, level) {
    const levelDots = Array.from({ length: level }).map((_, i) => `<circle cx="${16 + i * 8}" cy="54" r="2.2"/>`).join('');
    if (id === 'weatherTower') return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <path d="M20 55h24L38 20H26z" fill="#dbeafe" stroke="#1d4ed8" stroke-width="3" stroke-linejoin="round"/>
            <path d="M25 20h14l-7-10z" fill="#60a5fa" stroke="#1d4ed8" stroke-width="3" stroke-linejoin="round"/>
            <path d="M18 31h28M21 43h22" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
            <path d="M48 17c5 0 9 4 9 8s-4 8-9 8H36c-4 0-7-3-7-7s3-7 7-7c2-4 6-6 12-2z" fill="#f8fafc" stroke="#38bdf8" stroke-width="3"/>
            <path d="M31 33l-5 10h7l-4 11 12-16h-7l5-5z" fill="#facc15" stroke="#a16207" stroke-width="2" stroke-linejoin="round"/>
            <g fill="#2563eb">${levelDots}</g>
        </svg>`;
    if (id === 'spaceport') return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <path d="M10 54h44l-6-13H16z" fill="#d1d5db" stroke="#374151" stroke-width="3" stroke-linejoin="round"/>
            <path d="M32 8c9 8 12 21 7 34H25C20 29 23 16 32 8z" fill="#f97316" stroke="#7c2d12" stroke-width="3" stroke-linejoin="round"/>
            <path d="M27 35l-9 11h11zM37 35l9 11H35z" fill="#fb923c" stroke="#7c2d12" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="32" cy="23" r="6" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="3"/>
            <path d="M29 43l3 13 3-13z" fill="#facc15" stroke="#a16207" stroke-width="2"/>
            <g fill="#7c2d12">${levelDots}</g>
        </svg>`;
    if (id === 'ufoPad') return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <ellipse cx="32" cy="45" rx="22" ry="8" fill="#94a3b8" stroke="#334155" stroke-width="3"/>
            <ellipse cx="32" cy="35" rx="26" ry="11" fill="#67e8f9" stroke="#0e7490" stroke-width="3"/>
            <path d="M19 34c2-10 8-15 13-15s11 5 13 15" fill="#e0f2fe" stroke="#0e7490" stroke-width="3"/>
            <circle cx="22" cy="36" r="2.5" fill="#facc15"/><circle cx="32" cy="38" r="2.5" fill="#facc15"/><circle cx="42" cy="36" r="2.5" fill="#facc15"/>
            <path d="M18 52h28" stroke="#facc15" stroke-width="4" stroke-linecap="round"/>
            <g fill="#0e7490">${levelDots}</g>
        </svg>`;
    return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <path d="M16 54h32l-5-14H21z" fill="#c4b5fd" stroke="#5b21b6" stroke-width="3" stroke-linejoin="round"/>
            <path d="M24 40l8-28 8 28z" fill="#ddd6fe" stroke="#5b21b6" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="32" cy="25" r="8" fill="#111827" stroke="#facc15" stroke-width="3"/>
            <path d="M32 15v-7M22 19l-5-5M42 19l5-5" stroke="#facc15" stroke-width="3" stroke-linecap="round"/>
            <g fill="#5b21b6">${levelDots}</g>
        </svg>`;
}

async function growRainPlants(pet) {
    const key = 'field_1';
    const existing = [...(getLayout(pet.id, key) || [])];
    const choices = ['field_flower', 'furn_plant', 'land_mushroom'];
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
        existing.push({
            itemId: choices[(Date.now() + i) % choices.length],
            x: 0.18 + Math.random() * 0.64,
            y: 0.38 + Math.random() * 0.42,
            zorder: 0,
            grownByWeather: true,
        });
    }
    await saveLayout(pet.id, key, existing);
    return count;
}

function refreshTopbarResources() {
    const fuel = $('mhBiofuel');
    const fuelValue = fuel?.querySelector?.('[data-hud-value="biofuel"]');
    if (fuelValue) fuelValue.textContent = String(state.biofuel | 0);
    else if (fuel) fuel.textContent = `⛽ ${state.biofuel | 0}`;
    const coins = $('mhCoins');
    const coinValue = coins?.querySelector?.('[data-hud-value="coins"]');
    if (coinValue) coinValue.textContent = String(state.coins);
    else if (coins) coins.innerHTML = `${coins.querySelector('svg')?.outerHTML || ''} ${state.coins}`;
}

function currentPlanetFocusPoint() {
    const planetElement = $('mhPlanet');
    const stageElement = $('mhStageInner');
    if (!planetElement || !stageElement || !stageElement.clientWidth || !stageElement.clientHeight) {
        return { x: 70, y: 65 };
    }
    const planetBody = planetElement.querySelector('.planet-body');
    const bodyCenterX = planetBody
        ? planetElement.offsetLeft - planetElement.offsetWidth / 2 + planetBody.offsetLeft + planetBody.offsetWidth / 2
        : planetElement.offsetLeft;
    const bodyCenterY = planetBody
        ? planetElement.offsetTop - planetElement.offsetHeight / 2 + planetBody.offsetTop + planetBody.offsetHeight / 2
        : planetElement.offsetTop;
    const centerX = (bodyCenterX / stageElement.clientWidth) * 100;
    const centerY = (bodyCenterY / stageElement.clientHeight) * 100;
    return { x: centerX, y: centerY };
}

function createPlanetStarfield(canvas) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;
    const stars = Array.from({ length: 72 }).map((_, index) => ({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 1.35 + 0.45,
        alpha: Math.random() * 0.58 + 0.3,
        hue: index % 5 === 0 ? 44 : index % 3 === 0 ? 190 : 0,
    }));
    let raf = 0;
    let resizeObserver = null;
    let width = 0;
    let height = 0;

    // Pre-render glow sprites for each unique star color to avoid per-star shadowBlur
    const glowSprites = new Map();
    const getGlowSprite = (color, dpr) => {
        const key = `${color}_${dpr}`;
        if (glowSprites.has(key)) return glowSprites.get(key);
        const spriteSize = Math.ceil(24 * dpr);
        const spriteCanvas = document.createElement('canvas');
        spriteCanvas.width = spriteSize;
        spriteCanvas.height = spriteSize;
        const spriteCtx = spriteCanvas.getContext('2d');
        const center = spriteSize / 2;
        const radius = 1.8 * dpr;
        spriteCtx.fillStyle = color;
        spriteCtx.shadowColor = color;
        spriteCtx.shadowBlur = 8 * dpr;
        spriteCtx.beginPath();
        spriteCtx.arc(center, center, radius, 0, Math.PI * 2);
        spriteCtx.fill();
        glowSprites.set(key, spriteCanvas);
        return spriteCanvas;
    };

    const draw = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        width = Math.max(1, Math.round(rect.width * dpr));
        height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const star of stars) {
            const x = star.x * width;
            const y = star.y * height;
            const color = star.hue ? `hsl(${star.hue} 100% 82%)` : '#fff';
            const sprite = getGlowSprite(color, dpr);
            const spriteSize = sprite.width;
            ctx.globalAlpha = star.alpha;
            ctx.drawImage(sprite, x - spriteSize / 2, y - spriteSize / 2);
        }
        ctx.restore();
    };

    const scheduleDraw = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            raf = 0;
            draw();
        });
    };

    if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(scheduleDraw);
        resizeObserver.observe(canvas);
    } else {
        window.addEventListener('resize', scheduleDraw);
    }
    scheduleDraw();

    return {
        destroy() {
            if (raf) cancelAnimationFrame(raf);
            resizeObserver?.disconnect();
            if (!resizeObserver) window.removeEventListener('resize', scheduleDraw);
        },
    };
}

function mountPlanetStarfield(root = document) {
    __planetStarfield?.destroy();
    __planetStarfield = createPlanetStarfield(root.querySelector?.('#mhPlanetStarCanvas') || document.getElementById('mhPlanetStarCanvas'));
}

function hueForTrait(traitId) {
    const map = { catLike: 18, rabbitLike: 320, fishLike: 200, birdLike: 160, dragonLike: 0, sweetLike: 340, fruitLike: 30 };
    return map[traitId] ?? 36;
}

function normalizePlanetExpression(expression) {
    const key = String(expression || 'normal').trim().toLowerCase();
    const normalized = PLANET_EXPRESSION_ALIASES[key] || key;
    return PLANET_EXPRESSIONS.includes(normalized) ? normalized : 'normal';
}

function inferPlanetExpression(pet) {
    const stats = getRuntimePetStats(pet);
    if (pet?.anim === 'sleep') return 'sleeping';
    if ((stats.hunger ?? 100) < 22) return 'hungry';
    if ((stats.clean ?? 100) < 22) return 'dirty';
    if ((stats.mood ?? 100) < 28) return 'sad';
    if ((stats.mood ?? 0) >= 76) return 'happy';
    return 'normal';
}

function resolvePlanetExpression(expression, pet) {
    return !expression || expression === 'auto'
        ? inferPlanetExpression(pet)
        : normalizePlanetExpression(expression);
}

function applyPlanetExpression(planetElement, expression) {
    if (!planetElement) return 'normal';
    const normalized = normalizePlanetExpression(expression);
    PLANET_EXPRESSIONS.forEach(item => planetElement.classList.remove(`planet-expression-${item}`));
    planetElement.classList.add(`planet-expression-${normalized}`);
    planetElement.dataset.planetExpression = normalized;
    return normalized;
}

export const planetLevel = {
    id: 'planet',
    index: 0,
    expression: 'auto',
    wipeColor: 'radial-gradient(ellipse at 50% 40%, #1a1e63 0%, #0a1137 48%, #020617 100%)',
    // 相机窗口
    minCamera: 0.38,    // 飞远（往外）→ 已经是最外层，不再切换；宇宙层允许看得更远
    maxCamera: 1.85,    // 贴近（往内）→ 触发进入 field
    bestCamera: 1.0,
    minVisualScale: 0.72,
    cameraTargetSelector: '.space-camera-layer',
    enterFromAbove: 1.0, // 不会从更外层进来
    enterFromInner: 1.0, // 从 field 退出时落到此相机位

    cameraFocus(zoom) {
        const bestCamera = this.bestCamera ?? ((this.minCamera + this.maxCamera) / 2);
        const focusStart = bestCamera + 0.16;
        if (zoom <= focusStart) return { ...currentPlanetFocusPoint(), weight: 0 };
        const rawWeight = Math.max(0, Math.min(1, (zoom - focusStart) / (this.maxCamera - focusStart)));
        const weight = Math.min(1, rawWeight * 4);
        return { ...currentPlanetFocusPoint(), weight };
    },

    setPlanetExpression(expression = 'auto', pet = this._planetPet) {
        const nextExpression = resolvePlanetExpression(expression, pet);
        this.expression = expression === 'auto' ? 'auto' : nextExpression;
        return applyPlanetExpression($('mhPlanet'), nextExpression);
    },

    stageHtml(pet) {
        const visiting = isVisitingMode();
        const visit = state.visitingMode || {};
        const top = dominantTraits(pet, 1)[0];
        const settlementStyle = !visiting && state.settings?.starSettlement?.source === 'official' ? state.settings.starSettlement.planetStyle || {} : null;
        const planetHue = settlementStyle?.hue || (top ? hueForTrait(top.id) : 36);
        const settlementStyleText = settlementStyle ? [
            `--planet-hue:${planetHue}`,
            settlementStyle.bodyBackground ? `--settlement-planet-bg:${settlementStyle.bodyBackground}` : '',
            settlementStyle.glowColor ? `--settlement-planet-glow:${settlementStyle.glowColor}` : '',
        ].filter(Boolean).join(';') : `--planet-hue:${visiting ? 205 : planetHue}`;
        const planetExpression = resolvePlanetExpression(this.expression, pet);
        const progress = computePlanetProgress();
        const activeWeather = visiting ? null : getActivePlanetWeather();
        const activeBuff = visiting ? null : getActivePlanetBuff();
        const planetName = visiting ? (visit.planetName || '好友星球') : ((state.planetName && state.planetName.trim()) || '宠物星');
        const miningCoins = visiting ? 0 : planetMiningCoins();
        const moons = '';
        const remoteLocked = progress.canVisitHaqiIsland ? '' : ' locked';
        const remoteTitle = progress.canVisitHaqiIsland
            ? t('lpHaqiUnlocked')
            : t('lpHaqiLocked');
        return `
            <div class="space-camera-layer">
                <div class="space-bg"><canvas class="space-star-canvas" id="mhPlanetStarCanvas" aria-hidden="true"></canvas></div>
                ${PLANET_SPACECRAFT_ENABLED ? spaceTravelHtml() : ''}
                ${activeWeather ? planetWeatherSpaceHtml(activeWeather) : ''}
                ${visiting ? '' : smallRemotePlanetsHtml()}
                <div class="space-planet user-planet ${visiting ? 'visiting-friend-planet' : ''} ${settlementStyle ? 'has-settlement-style' : ''} planet-expression-${planetExpression} ${miningCoins > 0 ? 'has-mining-coins' : ''}" id="mhPlanet" data-planet-expression="${planetExpression}" style="${escapeHtml(settlementStyleText)}" title="${visiting ? escapeHtml(t('lpVisitReturnTip')) : miningCoins > 0 ? escapeHtml(t('lpMiningTitle', { amount: miningCoins })) : escapeHtml(t('lpPlanetTip'))}">
                    ${planetMiningPileHtml(miningCoins)}
                    <div class="planet-moons">${moons}</div>
                    <div class="planet-ring"></div>
                    <div class="planet-body">
                        <div class="planet-surface">
                            <div class="planet-glow"></div>
                            <div class="planet-cont planet-cont-1"></div>
                            <div class="planet-cont planet-cont-2"></div>
                            <div class="planet-cont planet-cont-3"></div>
                        </div>
                        <div class="planet-cute-face" aria-hidden="true">
                            <span class="planet-cute-eye planet-cute-eye-left"></span>
                            <span class="planet-cute-eye planet-cute-eye-right"></span>
                            <span class="planet-cute-cheek planet-cute-cheek-left"></span>
                            <span class="planet-cute-cheek planet-cute-cheek-right"></span>
                            <span class="planet-cute-mouth"></span>
                            <span class="planet-cute-mark planet-cute-mark-left"></span>
                            <span class="planet-cute-mark planet-cute-mark-right"></span>
                            <span class="planet-cute-sleep-z">Z</span>
                        </div>
                        ${visiting ? '' : '<canvas class="planet-decoration-canvas" id="mhPlanetDecorCanvas" aria-hidden="true"></canvas>'}
                    </div>
                </div>
            <div class="planet-status-panel">
                <div class="planet-status-date">${escapeHtml(formatChineseDate(new Date()))}</div>
                <div class="planet-status-main">${escapeHtml(planetName)}${visiting ? '' : escapeHtml(t('lpPlanetSuffix'))} · ${visiting ? escapeHtml(t('lpVisiting')) : escapeHtml(t('lpDayNumber', { n: progress.planetDays }))}</div>
                <div class="planet-status-level">${visiting ? escapeHtml(t('lpVisitSpaceOnly')) : escapeHtml(t('lpLevelStable', { level: progress.level }))}</div>
                ${activeWeather ? `<div class="planet-status-chip">${activeWeather.emoji} ${escapeHtml(activeWeatherLabel(activeWeather))} · ${formatTimeLeft(activeWeather.until)}</div>` : ''}
                ${activeBuff ? `<div class="planet-status-chip">${activeBuff.emoji} ${escapeHtml(buffName(activeBuff))}</div>` : ''}
            </div>
            ${visiting ? '' : `<button class="remote-planet${remoteLocked}" id="mhHaqiIsland" type="button" title="${escapeHtml(remoteTitle)}" aria-label="${escapeHtml(t('lpHaqiIsland'))}">
                <span class="remote-magic-hat" aria-hidden="true">
                    <svg viewBox="0 0 96 84" role="img" focusable="false">
                        <defs>
                            <radialGradient id="hatCrownGlow" cx="42%" cy="22%" r="72%">
                                <stop offset="0" stop-color="#f6c5ff"/>
                                <stop offset="0.34" stop-color="#9f45ff"/>
                                <stop offset="0.72" stop-color="#2228b7"/>
                                <stop offset="1" stop-color="#071071"/>
                            </radialGradient>
                            <linearGradient id="hatBrimGlow" x1="5" y1="58" x2="91" y2="46" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stop-color="#0611a8"/>
                                <stop offset="0.45" stop-color="#2545ff"/>
                                <stop offset="0.76" stop-color="#9b40ff"/>
                                <stop offset="1" stop-color="#e476ff"/>
                            </linearGradient>
                            <linearGradient id="hatBandGlow" x1="40" y1="31" x2="72" y2="36" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stop-color="#ff80d7"/>
                                <stop offset="1" stop-color="#ffa3e9"/>
                            </linearGradient>
                            <filter id="hatSoftGlow" x="-35%" y="-35%" width="170%" height="170%">
                                <feGaussianBlur stdDeviation="2.4" result="blur"/>
                                <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.23 0 0 0 0 0.56 0 0 0 0 1 0 0 0 0.68 0"/>
                                <feMerge>
                                    <feMergeNode/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                        </defs>
                        <path class="magic-hat-shadow" d="M8 62c13 14 56 17 80 1 4-3 1-8-5-10-25-7-64-4-75 9z"/>
                        <path class="magic-hat-tail" d="M27 33C38 14 59 17 83 47c-19-8-42-9-63 1 2-6 4-11 7-15z"/>
                        <path class="magic-hat-tail-light" d="M40 22c12-2 26 6 36 20"/>
                        <circle class="magic-hat-pom" cx="19" cy="31" r="6.4"/>
                        <path class="magic-hat-crown" d="M22 45c20-9 43-8 61 2l2 8c-15 10-51 12-68 3z"/>
                        <path class="magic-hat-band" d="M31 43c15-5 34-4 49 4l2 8c-17-7-37-7-57 0z"/>
                        <path class="magic-hat-brim" d="M6 61c9-12 63-18 84-9 10 5 1 16-27 20-29 4-54 1-57-11z"/>
                        <path class="magic-hat-brim-light" d="M17 58c19-5 49-8 66-3"/>
                        <path class="magic-hat-star" d="M22 38l6 9 11 1-7 8 2 11-10-5-10 5 2-11-7-8 11-1z"/>
                        <path class="magic-hat-spark s1" d="M69 24l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                        <path class="magic-hat-spark s2" d="M84 36l1.4 3.6L89 41l-3.6 1.4L84 46l-1.4-3.6L79 41l3.6-1.4z"/>
                    </svg>
                </span>
                <span class="remote-planet-body" aria-hidden="true">
                    <svg class="remote-planet-svg" viewBox="0 0 128 128" role="img" focusable="false">
                        <defs>
                            <radialGradient id="haqiCore" cx="42%" cy="32%" r="68%">
                                <stop offset="0" stop-color="#f8fbff"/>
                                <stop offset="0.25" stop-color="#9de8ff"/>
                                <stop offset="0.58" stop-color="#5755ff"/>
                                <stop offset="1" stop-color="#15113e"/>
                            </radialGradient>
                            <linearGradient id="haqiRing" x1="9" y1="74" x2="119" y2="54" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stop-color="#34f5ff" stop-opacity="0.1"/>
                                <stop offset="0.22" stop-color="#76f4ff"/>
                                <stop offset="0.52" stop-color="#ffe28a"/>
                                <stop offset="0.78" stop-color="#b78cff"/>
                                <stop offset="1" stop-color="#34f5ff" stop-opacity="0.14"/>
                            </linearGradient>
                            <linearGradient id="haqiLand" x1="34" y1="40" x2="91" y2="88" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stop-color="#d8ff93"/>
                                <stop offset="0.45" stop-color="#42d692"/>
                                <stop offset="1" stop-color="#047e9c"/>
                            </linearGradient>
                            <linearGradient id="haqiCity" x1="42" y1="39" x2="86" y2="83" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stop-color="#fff6a8"/>
                                <stop offset="0.5" stop-color="#70f7ff"/>
                                <stop offset="1" stop-color="#b693ff"/>
                            </linearGradient>
                            <filter id="haqiGlow" x="-40%" y="-40%" width="180%" height="180%">
                                <feGaussianBlur stdDeviation="4" result="blur"/>
                                <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.2 0 0 0 0 0.95 0 0 0 0 1 0 0 0 0.82 0"/>
                                <feMerge>
                                    <feMergeNode/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                        </defs>
                        <ellipse class="remote-orbit remote-orbit-back" cx="64" cy="70" rx="55" ry="17"/>
                        <circle class="remote-core" cx="64" cy="62" r="39"/>
                        <g class="remote-globe-spin">
                            <path class="remote-land l1" d="M35 56c7-17 26-25 45-18 10 4 14 11 12 18-8-2-15 1-20 8-9 12-24 11-37-8z"/>
                            <path class="remote-land l2" d="M70 76c8-10 22-9 28 2-6 12-19 20-34 21-1-8 1-16 6-23z"/>
                            <path class="remote-city-line" d="M43 57l8-6 8 7 9-10 11 10 8-5"/>
                            <path class="remote-city-line l2" d="M58 76l7-6 7 5 8-7 8 9"/>
                            <g class="remote-city-lights">
                                <circle cx="45" cy="56" r="1.7"/><circle cx="52" cy="51" r="1.4"/><circle cx="61" cy="58" r="1.8"/>
                                <circle cx="70" cy="48" r="1.5"/><circle cx="80" cy="58" r="1.6"/><circle cx="88" cy="54" r="1.3"/>
                                <circle cx="60" cy="76" r="1.4"/><circle cx="72" cy="75" r="1.7"/><circle cx="84" cy="77" r="1.5"/>
                            </g>
                        </g>
                        <g class="remote-tech-spires">
                            <path d="M50 43l3-12 3 12z"/><path d="M79 47l4-15 4 15z"/><path d="M70 82l3-11 3 11z"/>
                            <circle cx="53" cy="31" r="2.1"/><circle cx="83" cy="32" r="2.1"/><circle cx="73" cy="71" r="1.8"/>
                        </g>
                        <g class="remote-rotating-grid">
                            <ellipse cx="64" cy="62" rx="33" ry="12"/>
                            <ellipse cx="64" cy="62" rx="20" ry="38"/>
                            <path d="M31 63h66M39 43c15 16 34 32 50 48M88 38c-12 18-28 38-45 56"/>
                        </g>
                        <g class="remote-cloud-bands">
                            <path d="M30 51c16-8 34-10 56-3 7 2 13 2 19-1"/>
                            <path d="M27 70c17 8 36 10 58 4 8-2 15-2 22 2"/>
                        </g>
                        <path class="remote-glint" d="M41 42c7-9 19-13 31-11"/>
                        <ellipse class="remote-orbit remote-orbit-front" cx="64" cy="70" rx="55" ry="17"/>
                        <g class="remote-orbit-traffic">
                            <circle class="traffic-dot d1" cx="18" cy="70" r="2.2"/>
                            <circle class="traffic-dot d2" cx="110" cy="68" r="1.8"/>
                        </g>
                        <circle class="remote-satellite s1" cx="27" cy="37" r="3"/>
                        <circle class="remote-satellite s2" cx="104" cy="27" r="2.5"/>
                        <path class="remote-beacon" d="M64 12l4 11 11 4-11 4-4 11-4-11-11-4 11-4z"/>
                    </svg>
                </span>
            </button>`}
            </div>
        `;
    },

    bindStage(pet, ctx) {
        this._planetPet = pet;
        mountPlanetStarfield(ctx?.stage || document);
        __spaceTravel?.destroy();
        __spaceTravel = PLANET_SPACECRAFT_ENABLED
            ? createSpaceTravel({
                userPlanet: { id: 'user', name: '宠物星', x: 70, y: 65, radius: 15, depth: 1, selector: '#mhPlanet .planet-body' },
                remotePlanets: remoteTravelPlanets(),
            }).mount(document)
            : null;

        const planet = $('mhPlanet');
        if (!isVisitingMode()) requestAnimationFrame(() => drawPlanetDecorCanvas());
        if (planet) planet.setPlanetExpression = (expression = 'auto') => this.setPlanetExpression(expression, pet);
        if (planet) planet.onclick = () => {
            if (isVisitingMode()) {
                showVisitReturnPrompt(pet, ctx);
                return;
            }
            const collected = collectPlanetMiningCoins();
            if (collected) {
                setTimeout(() => ctx.zoomIn?.(), 2000);
            } else {
                ctx.zoomIn?.();
            }
        };
        if (isVisitingMode()) {
            setTimeout(() => { if (state.zoomLevel === 0) showVisitReturnPrompt(pet, ctx); }, 260);
            return;
        }
        const haqiIsland = $('mhHaqiIsland');
        if (haqiIsland) haqiIsland.onclick = (e) => {
            e.stopPropagation();
            const progress = computePlanetProgress();
            if (!progress.canVisitHaqiIsland) {
                showToast(t('lpHaqiLockedHint'), 'info', 3200);
                return;
            }
            showHaqiIslandPanel(0);
        };
        document.querySelectorAll('[data-remote-planet]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const remote = SMALL_REMOTE_PLANETS.find(item => item.id === el.dataset.remotePlanet);
                if (!remote) return;
                showRemotePlanetPanel(remote);
            };
        });
    },

    dockHtml(pet) {
        if (isVisitingMode()) {
            return `
                <div class="mh-dock-row planet-dock-actions planet-visit-dock">
                    <button class="btn-secondary dock-icon-btn" data-act="visit-field" title="${escapeHtml(t('lpDockContinueVisitTip'))}">
                        <span class="dock-icon planet-dock-svg-icon planet-dock-emoji-icon">🪐</span><span class="dock-label">${escapeHtml(t('lpDockContinueVisit'))}</span>
                    </button>
                    <button class="btn-primary dock-icon-btn" data-act="visit-return" title="${escapeHtml(t('lpDockReturnTip'))}">
                        <span class="dock-icon planet-dock-svg-icon planet-dock-emoji-icon">🎁</span><span class="dock-label">${escapeHtml(t('lpDockReturn'))}</span>
                    </button>
                </div>
            `;
        }
        const progress = computePlanetProgress();
        const socialLocked = isLocked(progress, 2);
        const visitInfraMissing = !getInfrastructure('spaceport');
        return `
            <div class="mh-dock-row planet-dock-actions">
                <button class="btn-secondary dock-icon-btn ${socialLocked || visitInfraMissing ? 'planet-action-locked' : ''}" data-act="visit" title="${socialLocked ? escapeHtml(lockedTitle(2)) : escapeHtml(t('lpDockVisitTip', { fuel: SOCIAL_FUEL_COST }))}">
                    <span class="dock-icon planet-dock-svg-icon">${planetActionIconHtml('visit')}</span><span class="dock-label">${escapeHtml(t('lpDockVisit'))}</span>
                </button>
                ${pet?.stage !== 'egg' ? `<button class="btn-secondary dock-icon-btn" data-act="mailbox" title="${escapeHtml(t('lpDockMailboxTip'))}">
                    <span class="dock-icon planet-dock-svg-icon planet-dock-emoji-icon">💌</span><span class="dock-label">${escapeHtml(t('lpDockMailbox'))}</span>
                </button>` : ''}
                <button class="btn-secondary dock-icon-btn" data-act="milestones" title="${escapeHtml(t('lpDockMilestonesTip'))}">
                    <span class="dock-icon planet-dock-svg-icon">${planetActionIconHtml('milestones')}</span><span class="dock-label">${escapeHtml(t('lpDockMilestones'))}</span>
                </button>
            </div>
        `;
    },

    bindDock(pet, ctx) {
        const dock = ctx.dock;
        if (!dock) return;
        dock.querySelectorAll('[data-act]').forEach(el => {
            el.onclick = () => {
                const action = el.dataset.act;
                // Defer so this tap's trailing native click is swallowed by the
                // still-mounted dock before any new window mounts.
                setTimeout(() => {
                    if (action === 'visit-field') { ctx.zoomIn?.(); return; }
                    if (action === 'visit-return') { showVisitReturnPrompt(pet, ctx); return; }
                    if (action === 'milestones') showMilestonesPanel();
                    else if (action === 'mailbox') ctx.callbacks?.onNav?.('mailbox');
                    else showPlanetActionDialog(action, pet, ctx);
                }, 0);
            };
        });
    },

    onLeave() {
        __planetStarfield?.destroy();
        __planetStarfield = null;
        __spaceTravel?.destroy();
        __spaceTravel = null;
        resetSpaceTravelViewState();
    },

    // 太空层做相机缩放时的视觉调整：星球随相机缩放轻微缩放（已由 stageInner 的 transform 完成）
    onCameraChange(_zoom) { /* nothing extra */ },
};

function formatChineseDate(date) {
    return t('lpDate', { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
}

function formatLogDate(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
}

function formatFarewellDate(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatPetAge(petOrRecord, now = Date.now()) {
    const bornAt = Number(petOrRecord?.bornAt) || now;
    const hours = Math.max(0, Math.floor((now - bornAt) / 3600000));
    if (hours < 1) return t('lpJustBorn');
    if (hours < 24) return t('lpAgeHours', { h: hours });
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? t('lpAgeDaysHours', { d: days, h: restHours }) : t('lpAgeDays', { d: days });
}

function formatTimeLeft(until, now = Date.now()) {
    const ms = Math.max(0, (Number(until) || 0) - now);
    const minutes = Math.ceil(ms / 60000);
    if (minutes <= 0) return t('lpEndingSoon');
    if (minutes < 60) return t('lpMinutes', { n: minutes });
    return t('lpHours', { n: Math.ceil(minutes / 60) });
}

function planetWeatherSpaceHtml(weather) {
    if (weather.id === 'rain') {
        return `<div class="planet-orbit-weather planet-orbit-rain" aria-hidden="true">${Array.from({ length: 12 }).map((_, i) => `<i style="left:${(i * 37) % 100}%;animation-delay:${-(i % 6) * 0.18}s"></i>`).join('')}</div>`;
    }
    if (weather.id === 'sunny') return '<div class="planet-orbit-weather planet-orbit-sun" aria-hidden="true"></div>';
    if (weather.id === 'breeze') return '<div class="planet-orbit-weather planet-orbit-breeze" aria-hidden="true"><i></i><i></i><i></i></div>';
    return '';
}

function openPlanetModal(innerHtml, onClick, cardClass = '') {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal-card planet-modal-card ${escapeHtml(cardClass)}">${innerHtml}</div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-act="close"]')) { close(); return; }
        onClick?.(e, close);
    });
    document.body.appendChild(mask);
    scanAndMount(mask);
    return { mask, close };
}

function getShareUsername() {
    const direct = state.user?.username || state.sdk?.user?.username;
    if (direct) return Promise.resolve(direct);
    return state.sdk?.getUsername?.().catch?.(() => '') || Promise.resolve('');
}

function buildPetShareUrl(pet, username, layout, text, photoTheme) {
    const url = new URL('MagicHaqi.html', window.location.href);
    url.searchParams.set('postcardFrom', username || state.user?.username || 'friend');
    url.searchParams.set('petId', pet?.id || '');
    url.searchParams.set('layout', serializePostcardLayout(layout, pet));
    url.searchParams.set('text', text || defaultPostcardText(pet));
    url.searchParams.set('photoTheme', photoTheme || 'candy');
    return url.href;
}

function updatePetSharePostcard(root, pet, shareState) {
    const previewHost = root.querySelector('[data-share-preview-host]');
    if (!previewHost) return;
    previewHost.innerHTML = renderPetPostcardHtml(pet, {
        layout: shareState.layout,
        text: shareState.text,
        photoTheme: shareState.photoTheme,
        interactive: true,
    });
    hydratePetPostcardImages(previewHost, pet, { onUpdate: () => fitPetSharePostcard(root) });
    fitPetSharePostcard(root);
}

function fitPetSharePostcard(root) {
    const card = root.querySelector('.pet-share-modal-card');
    const previewHost = root.querySelector('[data-share-preview-host]');
    const postcard = previewHost?.querySelector('.pet-postcard');
    if (!card || !previewHost || !postcard) return;

    postcard.style.setProperty('--pet-share-scale', '1');

    const availableHeight = Math.max(120, previewHost.clientHeight);
    const availableWidth = Math.max(160, previewHost.clientWidth);
    const postcardHeight = postcard.scrollHeight || postcard.getBoundingClientRect().height;
    const postcardWidth = postcard.scrollWidth || postcard.getBoundingClientRect().width;
    const scale = Math.min(1, availableHeight / postcardHeight, availableWidth / postcardWidth);
    const fittedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

    postcard.style.setProperty('--pet-share-scale', String(fittedScale));
}

function shareTextOptions(pet) {
    const name = displayPetName(pet) || t('pcMyPet');
    return [
        defaultPostcardText(pet),
        t('pcShareWant', { name }),
        t('pcShareWaiting', { name }),
        ...getPostcardTexts(),
    ].filter((text, index, arr) => text && arr.indexOf(text) === index);
}

function nextShareLayout(layout, pet) {
    const count = normalizePostcardLayout(layout, pet).length;
    return normalizePostcardLayout(count >= 4 ? 1 : count + 1, pet);
}

async function copyText(text, okMessage = '已复制') {
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
        showToast(t('lpShareCopyFailed'), 'error', 2200);
        return false;
    }
}

async function sharePetImage(pet, layout, text, url, photoTheme) {
    const blob = await drawPetPostcardImage(pet, layout, text, photoTheme);
    if (!blob) {
        await copyText(url, t('lpImageFailedCopied'));
        return;
    }
    const file = new File([blob], `${pet?.id || 'pet'}-invite.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        try { await navigator.share({ title: t('lpShareInvite'), text, url, files: [file] }); return; } catch (_) {}
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    showToast(t('lpShareImageDone'), 'success', 1600);
}

export function showPetSharePanel(pet) {
    if (!pet) return;
    if (pet.stage === 'egg') {
        showToast(t('lpShareEggFirst'), 'info', 1800);
        return;
    }
    const textOptions = shareTextOptions(pet);
    const shareState = {
        layout: normalizePostcardLayout(1, pet),
        text: textOptions[0] || defaultPostcardText(pet),
        textIndex: 0,
        photoTheme: 'candy',
        showEdit: false,
    };
    openPlanetModal(`
        <div class="pet-share-head">
            <div class="planet-modal-title">${escapeHtml(t('lpShareTitle', { name: displayPetName(pet) }))}</div>
            <div class="planet-modal-subtitle">${escapeHtml(t('lpShareSub'))}</div>
        </div>
        <div data-share-preview-host>${renderPetPostcardHtml(pet, { layout: shareState.layout, text: shareState.text, photoTheme: shareState.photoTheme, interactive: true })}</div>
        <div class="planet-modal-actions pet-share-actions">
            <button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button>
            <button class="btn-secondary" data-share-method="url">${escapeHtml(t('lpShareCopyLink'))}</button>
            <button class="btn-secondary" data-share-method="wechat">${escapeHtml(t('lpShareWechat'))}</button>
            <button class="btn-primary" data-share-method="image">${escapeHtml(t('lpShareImage'))}</button>
        </div>
    `, async (e) => {
        const root = e.currentTarget;
        const imageToggle = e.target.closest?.('[data-postcard-image-toggle]');
        if (imageToggle) {
            shareState.layout = nextShareLayout(shareState.layout, pet);
            shareState.photoTheme = randomPostcardPhotoTheme(shareState.photoTheme);
            updatePetSharePostcard(root, pet, shareState);
            return;
        }
        if (e.target.closest?.('[data-share-edit-text]')) {
            const customText = await prompt(t('lpShareEditTitle'), {
                defaultValue: shareState.text,
                placeholder: t('lpShareEditPlaceholder'),
                okText: t('save'),
                maxLength: SHARE_POSTCARD_MAX_TEXT,
                validate: (value) => value ? '' : t('lpShareEditRequired'),
            });
            if (customText) {
                shareState.text = customText;
                shareState.showEdit = true;
                updatePetSharePostcard(root, pet, shareState);
            }
            return;
        }
        const textToggle = e.target.closest?.('[data-postcard-text-toggle]');
        if (textToggle) {
            shareState.textIndex = (shareState.textIndex + 1) % textOptions.length;
            shareState.text = textOptions[shareState.textIndex];
            shareState.showEdit = true;
            updatePetSharePostcard(root, pet, shareState);
            return;
        }
        const methodBtn = e.target.closest?.('[data-share-method]');
        if (!methodBtn) return;
        const username = await getShareUsername();
        const url = buildPetShareUrl(pet, username, shareState.layout, shareState.text, shareState.photoTheme);
        if (methodBtn.dataset.shareMethod === 'url') {
            if (navigator.share) {
                try { await navigator.share({ title: t('lpShareInvite'), text: shareState.text, url }); return; } catch (_) {}
            }
            await copyText(url, t('lpShareLinkCopied'));
        } else if (methodBtn.dataset.shareMethod === 'wechat') {
            await copyText(`${shareState.text}\n${url}`, t('lpShareWechatCopied'));
        } else if (methodBtn.dataset.shareMethod === 'image') {
            methodBtn.disabled = true;
            try { await sharePetImage(pet, shareState.layout, shareState.text, url, shareState.photoTheme); }
            finally { methodBtn.disabled = false; }
        }
    }, 'pet-share-modal-card');
    const fitSharePreview = () => fitPetSharePostcard(modal.mask);
    const previewHost = modal.mask.querySelector('[data-share-preview-host]');
    hydratePetPostcardImages(previewHost, pet, { onUpdate: fitSharePreview });
    requestAnimationFrame(fitSharePreview);
    window.addEventListener('resize', fitSharePreview);
    const shareObserver = new MutationObserver(() => {
        if (!document.body.contains(modal.mask)) {
            window.removeEventListener('resize', fitSharePreview);
            shareObserver.disconnect();
        }
    });
    shareObserver.observe(document.body, { childList: true });
}

function showPlanetActionDialog(action, pet, ctx) {
    const detail = PLANET_ACTION_DETAILS[action];
    if (!detail) return;
    const progress = computePlanetProgress();
    const locked = detail.unlock && isLocked(progress, detail.unlock);
    const buildingId = detail.building;
    const buildingDef = buildingId ? PLANET_INFRASTRUCTURE[buildingId] : null;
    const infrastructure = buildingId ? getInfrastructure(buildingId) : null;
    const infrastructureLevel = infrastructure?.level || 0;
    const needsBuilding = buildingDef && !infrastructure;
    const canUpgrade = buildingDef && infrastructureLevel > 0 && infrastructureLevel < PLANET_INFRA_MAX_LEVEL;
    const cost = buildingDef ? infrastructureCost(buildingId, infrastructureLevel) : null;
    const bodyText = needsBuilding
            ? (buildingDef.guideKey ? t(buildingDef.guideKey) : buildingDef.guide)
        : locked
            ? lockedTitle(detail.unlock)
            : actionEffectText(action, detail, buildingId, infrastructureLevel);
    const visitDestinationsHtml = action === 'visit' && !locked && !needsBuilding ? socialVisitDestinationPickerHtml() : '';
    const modal = openPlanetModal(`
        <div class="planet-action-dialog-head">
            <span class="planet-action-dialog-icon">${detail.icon}</span>
            <div>
                <div class="planet-modal-title">${escapeHtml(actionTitle(detail))}</div>
                <div class="planet-modal-subtitle">${escapeHtml(detail.textKey ? t(detail.textKey) : detail.text || '')}</div>
            </div>
            <button class="menu-close-btn haqi-download-close planet-action-close" data-act="close" type="button" aria-label="${escapeHtml(t('close'))}">×</button>
        </div>
        ${action === 'visit' && !locked && !needsBuilding ? '' : `<div class="planet-action-dialog-body">
            ${escapeHtml(bodyText)}
        </div>`}
        ${buildingDef ? `
            <div class="planet-infra-card">
                <span class="planet-infra-card-icon">${planetInfrastructureSvg(buildingId, Math.max(1, infrastructureLevel || 1))}</span>
                <span><b>${escapeHtml(infraName(buildingDef))} ${infrastructureLevel ? `Lv.${infrastructureLevel}` : escapeHtml(t('lpNotBuilt'))}</b><i>${escapeHtml(infrastructureLevel ? (canUpgrade ? t('lpUpgradeCost', { cost: formatCost(cost) }) : t('lpMaxed')) : t('lpBuildCost', { cost: formatCost(cost) }))}</i></span>
                ${needsBuilding || canUpgrade ? `<button class="btn-secondary planet-infra-card-action" data-infra-build="${escapeHtml(buildingId)}" type="button">${needsBuilding ? escapeHtml(t('lpBuild')) : escapeHtml(t('lpUpgrade'))}</button>` : ''}
            </div>` : ''}
        ${visitDestinationsHtml}
        ${action === 'visit' && !locked && !needsBuilding ? '' : `<div class="planet-modal-actions">
            ${locked && !needsBuilding ? `<button class="btn-secondary" data-act="close">${escapeHtml(t('lpGotIt'))}</button>` : ''}
            ${locked || needsBuilding ? '' : `<button class="btn-primary" data-action-confirm="${escapeHtml(action)}">${escapeHtml(detail.okTextKey ? t(detail.okTextKey) : detail.okText || '')}</button>`}
        </div>`}
    `, (e, close) => {
        const buildBtn = e.target.closest?.('[data-infra-build]');
        if (buildBtn) {
            if (buildOrUpgradeInfrastructure(buildBtn.dataset.infraBuild)) close();
            return;
        }
        if (handleVisitDestinationSelection(e, pet, close)) return;
        const btn = e.target.closest?.('[data-action-confirm]');
        if (!btn) return;
        if (action === 'visit') {
            return;
        }
        close();
        runPlanetAction(action, pet, ctx);
    }, action === 'visit' && !locked && !needsBuilding ? 'planet-action-visit-modal' : '');
    if (action === 'visit' && !locked && !needsBuilding) {
        const refreshOfficialDestinations = () => {
            if (!document.body.contains(modal.mask)) {
                window.removeEventListener('mh:officialVisitDestinationsLoaded', refreshOfficialDestinations);
                return;
            }
            const destinations = modal.mask.querySelector('.planet-visit-destinations');
            if (!destinations) return;
            destinations.innerHTML = socialVisitDestinationPickerHtml().match(/<div[^>]*class="planet-visit-destinations"[^>]*>([\s\S]*)<\/div>\s*$/)?.[1] || destinations.innerHTML;
            scanAndMount(destinations);
        };
        window.addEventListener('mh:officialVisitDestinationsLoaded', refreshOfficialDestinations);
        loadOfficialVisitDestinations().then(refreshOfficialDestinations);
    }
}

function runPlanetAction(action, pet, ctx) {
    const detail = PLANET_ACTION_DETAILS[action];
    if (detail?.unlock && isLocked(computePlanetProgress(), detail.unlock)) {
        showToast(lockedTitle(detail.unlock), 'info');
        return;
    }
    if (detail?.building && !getInfrastructure(detail.building)) {
        showPlanetActionDialog(action, pet, ctx);
        return;
    }
    if (action === 'info') ctx.openPetDetails();
    else if (action === 'weather') showWeatherPanel(pet);
    else if (action === 'visit') launchSocialVisit(pet);
    else if (action === 'ufo') acceptUfoVisitor(pet);
    else if (action === 'astro') alignConstellations(pet);
    else if (action === 'milestones') showMilestonesPanel();
}

export function showPlanetResearchPanel(pet, ctx) {
    const progress = computePlanetProgress();
    const readonlyPlanet = isReadonlyPlanet();
    if (isLocked(progress, 3)) {
        showToast(lockedTitle(3), 'info');
        return;
    }
    openPlanetModal(`
        <div class="planet-modal-title">${escapeHtml(t('lpResearchTitle'))}</div>
        <div class="planet-modal-subtitle">${escapeHtml(t('lpResearchSub'))}</div>
        ${readonlyPlanet ? '' : `
            <button class="planet-terrain-editor-entry" data-research-terrain="1" type="button">
                <span class="planet-terrain-editor-icon">🗺️</span>
                <span class="planet-terrain-editor-body">
                    <b>${escapeHtml(t('lpTerrainEditorName'))}</b>
                    <i>${escapeHtml(t('lpTerrainEditorDesc'))}</i>
                </span>
                <span class="planet-terrain-editor-go">${escapeHtml(t('lpEnter'))}</span>
            </button>`}
        <button class="planet-terrain-editor-entry" data-research-settlements="1" type="button">
            <span class="planet-terrain-editor-icon">🚀</span>
            <span class="planet-terrain-editor-body">
                <b>${escapeHtml(t('lpMigrationName'))}</b>
                <i>${escapeHtml(t('lpMigrationDesc'))}</i>
            </span>
            <span class="planet-terrain-editor-go">${escapeHtml(t('lpEnter'))}</span>
        </button>
        <div class="planet-option-list planet-research-list">
            ${PLANET_RESEARCH_ACTIONS.map(item => {
                const action = item.action;
                const detail = PLANET_ACTION_DETAILS[action];
                const buildingId = detail?.building;
                const buildingDef = buildingId ? PLANET_INFRASTRUCTURE[buildingId] : null;
                const infraLevel = buildingId ? getInfrastructureLevel(buildingId) : 0;
                const locked = detail?.unlock && isLocked(progress, detail.unlock);
                const cost = buildingId ? infrastructureCost(buildingId, infraLevel) : null;
                const canBuildOrUpgrade = !locked && cost && infraLevel < PLANET_INFRA_MAX_LEVEL;
                const levelText = !buildingId ? t('lpManage') : (locked ? lockedTitle(detail.unlock) : infraLevel ? `Lv.${infraLevel}` : t('lpNotBuilt'));
                const actionText = infraLevel <= 0 ? t('lpBuild') : t('lpUpgrade');
                return `
                    <div class="planet-option planet-research-card ${locked ? 'locked' : ''}" data-research-action="${escapeHtml(action)}" role="button" tabindex="0">
                        <span class="planet-option-icon planet-research-icon">${planetActionIconHtml(action)}</span>
                        <span class="planet-research-body">
                            <b>${escapeHtml(item.nameKey ? t(item.nameKey) : item.name)} <em>${escapeHtml(levelText)}</em></b>
                            <i>${escapeHtml(item.descKey ? t(item.descKey) : item.desc)}</i>
                        </span>
                        <span class="planet-research-cost">${buildingId ? (cost ? `<span class="planet-research-coin-icon">${coinIconSvg()}</span>${cost.coins}` : t('lpMaxed')) : t('lpEnter')}</span>
                        ${canBuildOrUpgrade ? `<button class="btn-secondary planet-research-build" data-research-build="${escapeHtml(buildingId)}" type="button">${actionText}</button>` : ''}
                    </div>`;
            }).join('')}
        </div>
        <div class="planet-modal-actions"><button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button></div>
    `, (e, close) => {
        if (e.target.closest?.('[data-research-terrain]')) {
            close();
            ctx.callbacks?.onNav?.('terrainFields');
            return;
        }
        if (e.target.closest?.('[data-research-settlements]')) {
            close();
            ctx.callbacks?.onNav?.('starSettlements');
            return;
        }
        const buildBtn = e.target.closest?.('[data-research-build]');
        if (buildBtn) {
            e.stopPropagation();
            if (buildOrUpgradeInfrastructure(buildBtn.dataset.researchBuild)) {
                close();
                showPlanetResearchPanel(pet, ctx);
            }
            return;
        }
        const btn = e.target.closest?.('[data-research-action]');
        if (!btn) return;
        const action = btn.dataset.researchAction;
        const detail = PLANET_ACTION_DETAILS[action];
        if (detail?.unlock && isLocked(progress, detail.unlock)) {
            showToast(lockedTitle(detail.unlock), 'info');
            return;
        }
        close();
        showPlanetActionDialog(action, pet, ctx);
    }, 'planet-research-modal');
}

function showWeatherPanel(pet) {
    const progress = computePlanetProgress();
    const now = Date.now();
    const activeWeather = getActivePlanetWeather(now);
    openPlanetModal(`
        <div class="planet-modal-title">${escapeHtml(t('lpWeatherPanelTitle'))}</div>
        <div class="planet-modal-subtitle">${escapeHtml(t('lpWeatherPanelSub'))}</div>
        ${activeWeather ? `<div class="planet-current-card">${escapeHtml(t('lpWeatherActive', { emoji: activeWeather.emoji, name: activeWeatherLabel(activeWeather), time: formatTimeLeft(activeWeather.until, now) }))}</div>` : ''}
        <div class="planet-option-list">
            ${WEATHER_OPTIONS.map(w => {
                const locked = isLocked(progress, w.unlock);
                return `
                    <button class="planet-option ${locked ? 'locked' : ''}" data-weather-choice="${w.id}" type="button">
                        <span class="planet-option-icon">${w.emoji}</span>
                        <span><b>${escapeHtml(weatherLabel(w))}</b><i>${locked ? lockedTitle(w.unlock) : escapeHtml(weatherMessage(w))}</i></span>
                    </button>`;
            }).join('')}
        </div>
        <div class="planet-modal-actions"><button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button></div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-weather-choice]');
        if (!btn) return;
        const option = weatherById(btn.dataset.weatherChoice);
        if (isLocked(progress, option.unlock)) {
            showToast(lockedTitle(option.unlock), 'info');
            return;
        }
        await summonWeather(option, pet);
        close();
    });
}

async function summonWeather(option, pet) {
    const now = Date.now();
    const actions = state.planetActions || (state.planetActions = {});
    const cooldownMs = weatherCooldownMs();
    if (actions.weatherAt && now - actions.weatherAt < cooldownMs) {
        showToast(t('lpWeatherCooldown', { time: formatTimeLeft(actions.weatherAt + cooldownMs, now) }), 'info');
        return;
    }
    state.planetWeather = {
        id: option.id,
        emoji: option.emoji,
        name: weatherLabel(option),
        startedAt: now,
        until: now + weatherDurationMs(),
    };
    actions.weatherAt = now;
    ['mood', 'hunger', 'clean', 'bond'].forEach(key => clampStat(pet, key, option[key] || 0));
    if (option.id === 'rain') {
        const grown = await growRainPlants(pet);
        state.currentRoom = pet.activeRoom = 'living';
        addPlanetLog('weather', t('lpRainGrew', { n: grown }), option.emoji);
    } else {
        addPlanetLog('weather', t('lpWeatherAdjusted', { label: weatherLabel(option) }), option.emoji);
    }
    savePetDebounced(pet);
    saveUserProfileDebounced();
    showToast(weatherMessage(option), 'success', 2800);
    notify();
}

async function acceptUfoVisitor(pet) {
    const progress = computePlanetProgress();
    if (isLocked(progress, 3)) { showToast(lockedTitle(3), 'info'); return; }
    const actions = state.planetActions || (state.planetActions = {});
    const key = todayKey();
    if (actions.ufoDay === key) {
        showToast(t('lpUfoDone'), 'info', 2600);
        return;
    }
    actions.ufoDay = key;
    const reward = UFO_REWARDS[(progress.planetDays + (state.petOrder || []).length) % UFO_REWARDS.length];
    const count = Math.max(1, getActionInfrastructureLevel('ufo') || 1);
    await addToInventory(pet.id, reward, count);
    clampStat(pet, 'mood', 6);
    addPlanetLog('ufo', '接待旅行商人，获得一份星际礼物', '🛸');
    savePetDebounced(pet);
    saveUserProfileDebounced();
    soundManager.playSpacecraftArrive();
    showToast(t('lpUfoGift', { count }), 'success', 2600);
    notify();
}

function alignConstellations(pet) {
    const progress = computePlanetProgress();
    if (isLocked(progress, 1)) { showToast(lockedTitle(1), 'info'); return; }
    const actions = state.planetActions || (state.planetActions = {});
    const key = todayKey();
    if (actions.astroDay === key && getActivePlanetBuff()) {
        showToast(t('lpAstroDone'), 'info');
        return;
    }
    const buff = dailyBuffForToday();
    actions.astroDay = key;
    state.planetBuff = { ...buff, day: key, until: untilTomorrow() };
    const multiplier = astroMultiplier();
    ['hunger', 'mood', 'clean', 'bond'].forEach(stat => clampStat(pet, stat, (buff[stat] || 0) * multiplier));
    addPlanetLog('astro', t('lpAstroLog', { name: buffName(buff) }), buff.emoji);
    savePetDebounced(pet);
    saveUserProfileDebounced();
    showToast(t('lpAstroRisen', { name: buffName(buff), text: buffText(buff) }), 'success', 3200);
    notify();
}

// ============================================================
// 成就系统 —— 完成后可一次性领取金币奖励，与里程碑合并显示。
// ============================================================
const ACHIEVEMENT_REWARD_COINS = 1000;

const ACHIEVEMENTS = [
    {
        id: 'raise_3_adults',
        emoji: '🏆',
        nameKey: 'lpAch1Name',
        descKey: 'lpAch1Desc',
        goal: 3,
        progress: () => {
            const lifetime = Number(state.lifetimeStats?.adultsRaised) || 0;
            const current = Object.values(state.pets || {}).filter(p => p && isAdultStage(p.stage)).length;
            const farewells = Array.isArray(state.haqiIslandFarewells) ? state.haqiIslandFarewells.length : 0;
            return Math.max(lifetime, current + farewells);
        },
    },
    {
        id: 'clean_500_poops',
        emoji: '🧹',
        nameKey: 'lpAch2Name',
        descKey: 'lpAch2Desc',
        goal: 500,
        progress: () => Number(state.lifetimeStats?.poopsCleaned) || 0,
    },
    {
        id: 'feed_500_times',
        emoji: '🍖',
        nameKey: 'lpAch3Name',
        descKey: 'lpAch3Desc',
        goal: 500,
        progress: () => Number(state.lifetimeStats?.feeds) || 0,
    },
    {
        id: 'build_all_infrastructure',
        emoji: '🏗️',
        nameKey: 'lpAch4Name',
        descKey: 'lpAch4Desc',
        goal: 4,
        progress: () => Object.values(state.planetInfrastructure || {}).filter(b => b && (Number(b.level) || 0) > 0).length,
    },
    {
        id: 'explore_all_remote',
        emoji: '🪐',
        nameKey: 'lpAch5Name',
        descKey: 'lpAch5Desc',
        goal: 4,
        progress: () => Object.keys(state.remotePlanetDiscoveries || {}).length,
    },
    {
        id: 'planet_30_days',
        emoji: '📅',
        nameKey: 'lpAch6Name',
        descKey: 'lpAch6Desc',
        goal: 30,
        progress: () => getPlanetDayNumber(),
    },
    {
        id: 'planet_level_6',
        emoji: '🌌',
        nameKey: 'lpAch7Name',
        descKey: 'lpAch7Desc',
        goal: 6,
        progress: () => computePlanetProgress().level,
    },
    {
        id: 'collect_5_satellites',
        emoji: '🌕',
        nameKey: 'lpAch8Name',
        descKey: 'lpAch8Desc',
        goal: 5,
        progress: () => computePlanetProgress().grownUpPetCount,
    },
    {
        id: 'hatch_10_pets',
        emoji: '🥚',
        nameKey: 'lpAch9Name',
        descKey: 'lpAch9Desc',
        goal: 10,
        progress: () => {
            const hatched = Object.values(state.pets || {}).filter(p => p && p.stage !== 'egg').length;
            const farewells = Array.isArray(state.haqiIslandFarewells) ? state.haqiIslandFarewells.length : 0;
            return hatched + farewells;
        },
    },
];

function ensureAchievementsState() {
    if (!state.achievements || typeof state.achievements !== 'object') state.achievements = { claimed: {} };
    if (!state.achievements.claimed || typeof state.achievements.claimed !== 'object') state.achievements.claimed = {};
    return state.achievements;
}

function getAchievementsView() {
    const ach = ensureAchievementsState();
    return ACHIEVEMENTS.map(def => {
        let current = 0;
        try { current = Number(def.progress()) || 0; } catch (_) { current = 0; }
        const goal = def.goal;
        const claimed = !!ach.claimed[def.id];
        const completed = current >= goal;
        return {
            id: def.id,
            emoji: def.emoji,
            name: def.nameKey ? t(def.nameKey) : def.name,
            desc: def.descKey ? t(def.descKey) : def.desc,
            current: Math.min(current, goal),
            goal,
            percent: Math.max(0, Math.min(100, Math.round((current / goal) * 100))),
            completed,
            claimed,
            canClaim: completed && !claimed,
        };
    });
}

function renderAchievementRow(a) {
    const stateClass = a.claimed ? 'claimed' : a.canClaim ? 'claimable' : a.completed ? 'done' : '';
    const btnHtml = a.claimed
        ? `<span class="planet-achievement-claimed">${escapeHtml(t('lpClaimed'))}</span>`
        : a.canClaim
            ? `<button class="btn-primary planet-achievement-claim" data-claim-achievement="${escapeHtml(a.id)}" title="${escapeHtml(t('lpClaimTitle', { coins: ACHIEVEMENT_REWARD_COINS }))}">${escapeHtml(t('lpClaim', { coins: ACHIEVEMENT_REWARD_COINS }))}</button>`
            : `<span class="planet-achievement-progress-label">${a.current}/${a.goal}</span>`;
    return `
        <div class="planet-achievement ${stateClass}">
            <span class="planet-achievement-icon">${a.emoji}</span>
            <span class="planet-achievement-body">
                <b>${escapeHtml(a.name)}</b>
                <i>${escapeHtml(a.desc)}</i>
                <span class="planet-achievement-bar"><span style="width:${a.percent}%"></span></span>
            </span>
            <span class="planet-achievement-action">${btnHtml}</span>
        </div>
    `;
}

function claimAchievement(id) {
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def) return false;
    const ach = ensureAchievementsState();
    if (ach.claimed[id]) {
        showToast(t('lpAchAlreadyClaimed'), 'info', 1500);
        return false;
    }
    let current = 0;
    try { current = Number(def.progress()) || 0; } catch (_) { current = 0; }
    if (current < def.goal) {
        showToast(t('lpAchNotDone'), 'info', 1500);
        return false;
    }
    ach.claimed[id] = Date.now();
    state.coins = Math.max(0, (Number(state.coins) || 0) + ACHIEVEMENT_REWARD_COINS);
    addPlanetLog('achievement', t('lpAchClaimLog', { name: def.nameKey ? t(def.nameKey) : def.name, coins: ACHIEVEMENT_REWARD_COINS }), def.emoji);
    saveUserProfileDebounced();
    refreshTopbarResources();
    soundManager.playPointReward?.();
    showToast(t('lpAchClaimToast', { emoji: def.emoji, name: def.nameKey ? t(def.nameKey) : def.name, coins: ACHIEVEMENT_REWARD_COINS }), 'success', 2400);
    notify();
    return true;
}

function claimAllAchievements() {
    const ach = ensureAchievementsState();
    const ready = ACHIEVEMENTS.filter(def => {
        if (ach.claimed[def.id]) return false;
        let current = 0;
        try { current = Number(def.progress()) || 0; } catch (_) { current = 0; }
        return current >= def.goal;
    });
    if (!ready.length) return 0;
    const now = Date.now();
    ready.forEach(def => { ach.claimed[def.id] = now; });
    const totalCoins = ready.length * ACHIEVEMENT_REWARD_COINS;
    state.coins = Math.max(0, (Number(state.coins) || 0) + totalCoins);
    addPlanetLog('achievement', t('lpClaimAllToast', { count: ready.length, coins: totalCoins }), '🏆');
    saveUserProfileDebounced();
    refreshTopbarResources();
    soundManager.playPointReward?.();
    showToast(t('lpClaimAllToast', { count: ready.length, coins: totalCoins }), 'success', 2600);
    notify();
    return ready.length;
}

async function showMilestonesPanel() {
    await loadPlanetVisitors();
    const progress = computePlanetProgress();
    const logs = (state.planetVisitors || [])
        .slice()
        .sort((a, b) => (Number(b?.at) || 0) - (Number(a?.at) || 0))
        .slice(0, 5);
    const rows = [
        { level: 1, icon: '🌦️', text: t('lpMile1') },
        { level: 2, icon: '🚀', text: t('lpMile2') },
        { level: 3, icon: '🛸', text: t('lpMile3') },
        { level: 4, icon: '🍃', text: t('lpMile4') },
        { level: 6, icon: '💫', text: t('lpMile6') },
    ].reverse();
    const achievements = getAchievementsView(progress);
    const claimableCount = achievements.filter(a => a.canClaim).length;
    const claimAllBtn = claimableCount > 1
        ? `<button class="btn-primary" data-act="claim-all-achievements" title="${escapeHtml(t('lpClaimAllTitle'))}">${escapeHtml(t('lpClaimAll', { count: claimableCount }))}</button>`
        : '';
    openPlanetModal(`
        <div class="planet-modal-title">${escapeHtml(t('lpMilestoneTitle'))}</div>
        <div class="planet-milestone-scroll">
            <div class="planet-progress-card">
                <div><b>Lv.${progress.level}</b><span>${escapeHtml(t('lpNextLevel', { percent: Math.round(progress.progressToNext * 100) }))}</span></div>
                <div class="planet-dock-meter"><span style="width:${Math.round(progress.progressToNext * 100)}%"></span></div>
                <p>${escapeHtml(t('lpProgressSummary', { days: progress.planetDays, pets: progress.petCount, moons: progress.grownUpPetCount }))}</p>
            </div>
            <div class="planet-achievements-head">
                <b>${escapeHtml(t('lpAchSection'))}</b>
                <span>${escapeHtml(t('lpAchClaimedRatio', { claimed: achievements.filter(a => a.claimed).length, total: achievements.length }))}</span>
            </div>
            <div class="planet-achievement-list">
                ${achievements.map(a => renderAchievementRow(a)).join('')}
            </div>
            <div class="planet-achievements-head"><b>${escapeHtml(t('lpLevelUnlockSection'))}</b></div>
            <div class="planet-milestone-list">
                ${rows.map(row => `<div class="planet-milestone ${progress.level >= row.level ? 'done' : ''}"><span>${row.icon}</span><span class="planet-milestone-body"><b>Lv.${row.level}</b><i>${escapeHtml(row.text)}</i></span></div>`).join('')}
            </div>
            <div class="planet-log-list">
                ${logs.length ? logs.map(log => `<div><span>${log.emoji || '•'}</span><b>${escapeHtml(formatLogDate(log.at))}</b><i>${escapeHtml(log.text || '')}</i></div>`).join('') : `<div><span>✨</span><i>${escapeHtml(t('lpNoLogs'))}</i></div>`}
            </div>
        </div>
        <div class="planet-modal-actions">
            ${claimAllBtn}
            <button class="btn-primary" data-act="close">${escapeHtml(t('lpDone'))}</button>
        </div>
    `, (e, close) => {
        const claimBtn = e.target.closest?.('[data-claim-achievement]');
        if (claimBtn) {
            const id = claimBtn.dataset.claimAchievement;
            if (claimAchievement(id)) {
                close();
                showMilestonesPanel();
            }
            return;
        }
        if (e.target.closest?.('[data-act="claim-all-achievements"]')) {
            const claimed = claimAllAchievements();
            if (claimed > 0) {
                close();
                showMilestonesPanel();
            }
        }
    }, 'planet-milestone-card');
}

function getFarewellRecords() {
    return (Array.isArray(state.haqiIslandFarewells) ? state.haqiIslandFarewells : [])
        .map(createDisplayFarewellRecord)
        .filter(Boolean)
        .sort((a, b) => (Number(b?.farewellAt) || 0) - (Number(a?.farewellAt) || 0));
}

function farewellPetId(record) {
    if (typeof record === 'string') return record.trim();
    if (!record || typeof record !== 'object') return '';
    return typeof record.petId === 'string' ? record.petId.trim() : '';
}

function farewellPetIds(records = state.haqiIslandFarewells) {
    if (!Array.isArray(records)) return [];
    const ids = [];
    records.forEach(record => {
        const id = farewellPetId(record);
        if (id && !ids.includes(id)) ids.push(id);
    });
    return ids.slice(0, 200);
}

function createDisplayFarewellRecord(record) {
    const petId = farewellPetId(record);
    if (!petId) return null;
    if (record && typeof record === 'object') return { ...record, petId };
    const pet = state.pets?.[petId];
    const farewellAt = Number(pet?.haqiIslandAt) || Number(pet?.location?.movedAt) || Number(pet?.releasedAt) || 0;
    return {
        id: `farewell_${petId}`,
        petId,
        name: displayPetName(pet) || pet?.name || t('lpHaqiPartner'),
        trueName: pet?.name || '',
        dna: pet?.dna || '',
        stage: pet?.stage || '',
        rarity: Number(pet?.rarity) || 0,
        bornAt: Number(pet?.bornAt) || 0,
        farewellAt,
        imageSheetUrl: pet?.imageSheetUrl || '',
        imageUrl: pet?.imageUrl || '',
    };
}

async function ensureFarewellPetsLoaded() {
    const ids = farewellPetIds();
    await Promise.all(ids.map(id => state.pets?.[id] ? null : loadPet(id).catch(() => null)));
}

function createFarewellRecord(pet) {
    const now = Date.now();
    const stats = getRuntimePetStats(pet);
    const topTraits = dominantTraits(pet, 3).map(item => ({
        id: item.id,
        name: item.def?.name || item.id,
        emoji: item.def?.emoji || '✦',
        value: item.value,
    }));
    const bestStat = ['bond', 'mood', 'clean', 'hunger']
        .map(key => ({ key, value: Math.round(Number(stats[key]) || 0) }))
        .sort((a, b) => b.value - a.value)[0];
    const statNames = { bond: t('statBond'), mood: t('statMood'), clean: t('statClean'), hunger: t('statEnergy') };
    const name = displayPetName(pet) || pet?.name || t('lpHaqiPartner');
    return {
        id: 'farewell_' + randId(10),
        petId: pet.id,
        name,
        trueName: pet.name || name,
        dna: pet.dna || '',
        stage: pet.stage || '',
        rarity: Number(pet.rarity) || 0,
        bornAt: Number(pet.bornAt) || now,
        farewellAt: now,
        imageSheetUrl: pet.imageSheetUrl || '',
        imageUrl: pet.imageUrl || '',
        topTraits,
        stats: {
            hunger: Math.round(Number(stats.hunger) || 0),
            mood: Math.round(Number(stats.mood) || 0),
            clean: Math.round(Number(stats.clean) || 0),
            bond: Math.round(Number(stats.bond) || 0),
        },
        handbook: [
            t('lpHandbookLived', { planet: (state.planetName && state.planetName.trim()) || t('planetFallback'), age: formatPetAge(pet, now) }),
            topTraits.length ? t('lpHandbookTraits', { traits: topTraits.map(item => item.emoji + item.name).join(t('stageSeparator')) }) : t('lpHandbookTraitsNone'),
            bestStat ? t('lpHandbookBest', { stat: statNames[bestStat.key] || bestStat.key, value: bestStat.value }) : t('lpHandbookBestNone'),
        ],
    };
}

function farewellPortraitHtml(record) {
    if (record.imageUrl) {
        return `<span class="haqi-farewell-portrait-img" style="background-image:url('${escapeHtml(record.imageUrl)}')"></span>`;
    }
    if (record.imageSheetUrl) {
        const row = record.stage === 'elder' ? 3 : record.stage === 'adult' ? 2 : record.stage === 'teen' ? 1 : 0;
        return `<span class="haqi-farewell-portrait-img haqi-farewell-sheet" style="background-image:url('${escapeHtml(record.imageSheetUrl)}');--farewell-y:${(row * 33.333).toFixed(3)}%"></span>`;
    }
    return `<span class="haqi-farewell-portrait-emoji">?</span>`;
}

function staticFarewellPetIconHtml(pet, record) {
    const source = pet || record || {};
    const alt = escapeHtml(displayPetName(source) || record?.name || t('lpHaqiPartner'));
    const url = source.imageSheetUrl || source.imageUrl || record?.imageSheetUrl || record?.imageUrl || '';
    const cell = source.imageSheetUrl ? getPetSpriteCell(source) : null;

    if (source.imageUrl && !source.imageSheetUrl) {
        return `<span class="mh-pet-art mh-pet-list-raw" aria-label="${alt}"
            style="width:100%;height:100%;display:block;background-image:url('${escapeHtml(url)}');background-size:contain;background-position:center;background-repeat:no-repeat;image-rendering:auto"></span>`;
    }
    if (!url || !cell) {
        return `<span class="mh-pet-art mh-pet-art-egg" aria-label="${alt}"
            style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
            ${buildEggSvg(source)}
        </span>`;
    }

    const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    return `<span class="mh-pet-art mh-pet-art-sprite mh-pet-list-raw" aria-label="${alt}"
        style="width:100%;height:100%;display:block;background:#000;background-image:url('${escapeHtml(url)}');background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></span>`;
}

function farewellRecordHtml(record) {
    const pet = state.pets?.[record.petId];
    const portrait = pet ? staticFarewellPetIconHtml(pet, record) : farewellPortraitHtml(record);
    return `
        <article class="haqi-farewell-card" draggable="false">
            <div class="haqi-farewell-portrait">${portrait}</div>
            <div class="haqi-farewell-body">
                <div class="haqi-farewell-name">${escapeHtml(record.name || t('lpHaqiPartner'))}</div>
                <div class="haqi-farewell-meta">${escapeHtml(formatFarewellDate(record.farewellAt))}</div>
            </div>
        </article>`;
}

function enableHaqiIslandMemoryDrag(mask) {
    const scroller = mask?.querySelector?.('.haqi-island-memory');
    if (!scroller) return;
    let drag = null;
    const stopDrag = () => {
        if (!drag) return;
        try { scroller.releasePointerCapture?.(drag.pointerId); } catch (_) { }
        scroller.classList.remove('is-dragging');
        drag = null;
    };
    scroller.addEventListener('dragstart', e => e.preventDefault());
    scroller.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
        drag = {
            pointerId: e.pointerId,
            startX: e.clientX,
            scrollLeft: scroller.scrollLeft,
        };
        scroller.classList.add('is-dragging');
        scroller.setPointerCapture?.(e.pointerId);
    });
    scroller.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const deltaX = e.clientX - drag.startX;
        if (Math.abs(deltaX) > 2) e.preventDefault();
        scroller.scrollLeft = drag.scrollLeft - deltaX;
    });
    scroller.addEventListener('pointerup', stopDrag);
    scroller.addEventListener('pointercancel', stopDrag);
    scroller.addEventListener('lostpointercapture', stopDrag);
}

async function showHaqiIslandPanel() {
    await ensureFarewellPetsLoaded();
    const records = getFarewellRecords();
    const modal = openPlanetModal(`
        <div class="haqi-island-head">
            <div>
                <div class="planet-modal-title">${escapeHtml(t('lpHaqiIsland'))}</div>
                <div class="planet-modal-subtitle">${escapeHtml(t('lpHaqiPanelSub'))}</div>
            </div>
            <button class="menu-close-btn haqi-download-close" data-act="close" type="button" aria-label="${escapeHtml(t('close'))}">×</button>
        </div>
        <div class="haqi-island-memory">
            ${records.length ? records.map(farewellRecordHtml).join('') : `
                <div class="haqi-empty-memory">
                    <b>${escapeHtml(t('lpHaqiNoRecords'))}</b>
                    <span>${escapeHtml(t('lpHaqiNoRecordsSub'))}</span>
                </div>`}
        </div>
        <div class="planet-modal-actions haqi-island-actions">
            <button class="btn-secondary" data-haqi-farewell="1">${escapeHtml(t('lpHaqiFarewellBtn'))}</button>
            <button class="btn-primary" data-haqi-download="1">${escapeHtml(t('lpHaqiDownloadBtn'))}</button>
        </div>
    `, (e, close) => {
        if (e.target.closest?.('[data-haqi-download]')) {
            close();
            showHaqiDownloadPopup();
            return;
        }
        if (e.target.closest?.('[data-haqi-farewell]')) {
            close();
            showFarewellPetIntro();
        }
    }, 'haqi-island-card');
    enableHaqiIslandMemoryDrag(modal.mask);
}

function getFarewellCandidates() {
    return (state.petOrder || [])
        .map(id => state.pets[id])
    .filter(pet => pet && isPetOnCurrentPlanet(pet) && isAdultStage(pet.stage));
}

function showFarewellPetIntro() {
    const candidates = getFarewellCandidates();
    if (!candidates.length) {
        openPlanetModal(`
            <div class="planet-modal-title">${escapeHtml(t('lpFarewellPetTitle'))}</div>
            <div class="planet-action-dialog-body">${escapeHtml(t('lpFarewellNoneBody'))}</div>
            <div class="planet-modal-actions"><button class="btn-primary" data-act="close">${escapeHtml(t('lpGotIt'))}</button></div>
        `);
        return;
    }
    openPlanetModal(`
        <div class="planet-modal-title">${escapeHtml(t('lpFarewellTitle'))}</div>
        <div class="planet-modal-subtitle">${escapeHtml(t('lpFarewellSub'))}</div>
        <div class="haqi-candidate-list">
            ${candidates.map(pet => `
                <button class="planet-option" data-farewell-pet="${escapeHtml(pet.id)}" type="button">
                    <span class="planet-option-icon planet-option-pet-icon">${petArtHtml(pet, { alt: displayPetName(pet) })}</span>
                    <span><b>${escapeHtml(displayPetName(pet))}</b><i>${escapeHtml(t('lpFarewellCompanion', { stage: getStageName(pet.stage, t('lpStageAdultFallback')), age: formatPetAge(pet) }))}</i></span>
                </button>`).join('')}
        </div>
        <div class="planet-modal-actions"><button class="btn-secondary" data-act="close">${escapeHtml(t('cancel'))}</button></div>
    `, (e, close) => {
        const btn = e.target.closest?.('[data-farewell-pet]');
        if (!btn) return;
        const pet = state.pets[btn.dataset.farewellPet];
        if (!pet) return;
        close();
        showFarewellCeremony(pet);
    });
}

function showFarewellCeremony(pet) {
    const record = createFarewellRecord(pet);
    openPlanetModal(`
        <div class="haqi-ceremony-card">
            <div class="haqi-ceremony-sky" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="haqi-ceremony-hero">
                <div class="haqi-ceremony-pet-icon">${petArtHtml(pet, { alt: displayPetName(pet) })}</div>
                <div>
                    <div class="planet-modal-title">${escapeHtml(t('lpCeremonyTitle', { name: record.name }))}</div>
                    <div class="planet-modal-subtitle">${escapeHtml(t('lpCeremonySub'))}</div>
                </div>
            </div>
            <div class="haqi-handbook-preview">
                ${record.handbook.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
            <div class="haqi-ceremony-warning">${escapeHtml(t('lpCeremonyWarning', { name: record.name }))}</div>
        </div>
        <div class="planet-modal-actions">
            <button class="btn-secondary" data-act="close">${escapeHtml(t('lpStayLonger'))}</button>
            <button class="btn-primary" data-farewell-confirm="${escapeHtml(pet.id)}">${escapeHtml(t('lpReleaseToHaqi'))}</button>
        </div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-farewell-confirm]');
        if (!btn) return;
        btn.disabled = true;
        await completeFarewellPet(btn.dataset.farewellConfirm, close);
    }, 'haqi-ceremony-modal');
}

async function completeFarewellPet(petId, close) {
    const pet = state.pets[petId];
    if (!pet) { showToast(t('lpPetNotOnPlanet'), 'info'); return; }
    if (!isAdultStage(pet.stage)) { showToast(t('lpOnlyAdultCeremony'), 'info'); return; }
    const record = createFarewellRecord(pet);
    playFarewellChime();
    state.haqiIslandFarewells = [pet.id, ...farewellPetIds()].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 200);
    addPlanetLog('farewell', t('lpFarewellLog', { name: record.name }), '🪄');
    markPetHaqiIsland(pet);
    await savePet(pet);
    const activePets = selectablePets((state.petOrder || []).map(id => state.pets[id]).filter(Boolean));
    if (activePets.length === 0) {
        await ensureReplacementEgg();
    } else {
        const nextId = isPetSelectable(state.pets[state.currentPetId]) ? state.currentPetId : activePets[0].id;
        setCurrentPet(nextId);
        await setCurrentPetPersisted(nextId);
    }
    notify();
    close?.();
    showToast(t('lpFarewellDone', { name: record.name }), 'success', 2600);
    setTimeout(() => showHaqiIslandPanel(0), 260);
}

async function ensureReplacementEgg() {
    const existing = selectablePets((state.petOrder || []).map(id => state.pets[id]).filter(Boolean))[0];
    if (existing) return existing;
    const now = Date.now();
    const dna = randomDna();
    const pet = {
        id: 'pet_' + randId(8),
        name: dnaToName(dna),
        dna,
        imageUrl: null,
        imageSheetUrl: null,
        traits: decodeDna(dna),
        rarity: dnaRarity(dna),
        stats: defaultStats(),
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now,
        lastTickAt: now,
        lastCareAt: now,
        parents: null,
        stage: 'egg',
        activeRoom: 'living',
    };
    await savePet(pet);
    await setCurrentPetPersisted(pet.id);
    setCurrentPet(pet.id);
    return pet;
}

function playFarewellChime() {
    try {
        const ctx = getSharedAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume?.();
        const start = ctx.currentTime + 0.02;
        const destination = getSharedAudioDestination(ctx);
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = i % 2 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, start + i * 0.13);
            gain.gain.setValueAtTime(0.0001, start + i * 0.13);
            gain.gain.exponentialRampToValueAtTime(0.12, start + i * 0.13 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.13 + 0.55);
            osc.connect(gain);
            gain.connect(destination);
            osc.start(start + i * 0.13);
            osc.stop(start + i * 0.13 + 0.6);
        });
    } catch (_) {}
}

function showHaqiDownloadPopup() {
    const old = document.querySelector('.haqi-download-mask');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.className = 'modal-mask haqi-download-mask';
    mask.innerHTML = `
        <div class="modal-card haqi-download-card">
            <div class="haqi-download-head">
                <div>
                    <div class="haqi-download-title">${escapeHtml(t('lpDownloadTitle'))}</div>
                    <div class="haqi-download-subtitle">${escapeHtml(t('lpDownloadSub'))}</div>
                </div>
                <button class="menu-close-btn haqi-download-close" data-act="close" type="button" aria-label="${escapeHtml(t('close'))}">×</button>
            </div>
            <div class="haqi-download-actions">
                <a class="btn-primary" href="${HAQI_DOWNLOAD_URL}" target="_blank" rel="noopener">${escapeHtml(t('lpDownloadPC'))}</a>
                <a class="btn-secondary" href="${HAQI_DOWNLOAD_URL}" target="_blank" rel="noopener">${escapeHtml(t('lpDownloadAndroid'))}</a>
            </div>
            <div class="haqi-download-note">${escapeHtml(t('lpDownloadNote'))}</div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-act="close"]')) close();
    });
    document.body.appendChild(mask);
}
