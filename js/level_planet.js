// Level 0 — Space / Planet 视图
// 从太空俯视宠物所在的星球。
// 相机距离范围：minCamera 时已经"贴到星球表面" → 触发 zoomIn 进入 field；
//               maxCamera 时已经"飞得很远" → 此处是最外层，无更外层可去。

import { $, clamp, escapeHtml, randId, showToast } from './utils.js';
import { getActivePlanetBuff, getActivePlanetWeather, notify, setCurrentPet, state } from './state.js';
import { addToInventory, getLayout, saveLayout, savePet, savePetDebounced, saveUserProfileDebounced, setCurrentPetPersisted } from './storage.js';
import { clampEnergyToMax, defaultPermanentTrauma, defaultStats, dominantTraits } from './petTick.js';
import { computePlanetProgress, getPlanetDayNumber } from './planetProgress.js';
import { decodeDna, displayPetName, dnaRarity, dnaToName, isAdultStage, randomDna, randomDnaForElementalAttribute } from './dna.js';
import { getRuntimePetStats, isPetOnCurrentPlanet, isPetSelectable, markPetHaqiIsland, selectablePets } from './petLifecycle.js';
import { buildEggSvg, getPetSpriteCell, petArtHtml, scanAndMount, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { getStageName } from './config.js';
import { createSpaceTravel, spaceTravelHtml } from './spacetravel.js';
import SoundManager from './soundManager.js';

const soundManager = SoundManager.getInstance();

const HAQI_DOWNLOAD_URL = 'https://keepwork.com/api/raw/maisi/maisi/webgames/data/magic_haqi_download';
const WEATHER_DURATION_MS = 30 * 60 * 1000;
const WEATHER_COOLDOWN_MS = 8 * 60 * 1000;
const SOCIAL_FUEL_COST = 30;
const PLANET_INFRA_MAX_LEVEL = 3;
const SMALL_REMOTE_PLANET_NAME_RADIUS = 8;
const SMALL_REMOTE_PLANET_SIZE_PER_RADIUS = 7;
const REMOTE_ELEMENT_HAUL_TONS = 10;
const REMOTE_ELEMENT_MAX_TONS = 100;
const HAQI_VISIT_COIN_REWARD = 30;
const PLANET_MINING_COIN_PER_HOUR = 5;
const PLANET_MINING_MAX_COINS = 120;
const PLANET_MINING_HOUR_MS = 60 * 60 * 1000;
const PLANET_EXPRESSIONS = ['normal', 'happy', 'sad', 'dirty', 'hungry', 'sleeping', 'tired'];
const PLANET_EXPRESSION_ALIASES = {
    idle: 'normal',
    sleep: 'sleeping',
    asleep: 'sleeping',
};

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
let __remoteCargoActive = false;

const WEATHER_OPTIONS = [
    { id: 'rain', emoji: '🌧️', name: '召雨', label: '雨云', unlock: 1, mood: -2, hunger: 4, message: '雨云覆盖星球，陆地会长出新植物，宠物更想回屋里。' },
    { id: 'sunny', emoji: '☀️', name: '晴光', label: '晴光', unlock: 2, mood: 7, message: '晴光照亮星球，宠物心情变好了。' },
    { id: 'breeze', emoji: '🍃', name: '季风', label: '季风', unlock: 4, clean: 5, mood: 3, message: '轻风穿过星球，大气变得清爽。' },
];

const ASTRO_BUFFS = [
    { id: 'gluttony', emoji: '🌕', name: '贪食之月', text: '体力下降更快，但今天喂食与照顾更有仪式感。', hunger: -8, mood: 4 },
    { id: 'garden', emoji: '🌿', name: '花园星座', text: '心情衰减减慢，更适合散步。', mood: 12 },
    { id: 'clarity', emoji: '🔭', name: '明晰星轨', text: '玩耍与探索更有收获，亲密小幅提升。', bond: 4 },
    { id: 'tidal', emoji: '🌊', name: '潮汐双月', text: '清洁缓慢恢复，心情小幅提升。', clean: 10, mood: 4 },
];

const UFO_REWARDS = ['food_apple', 'food_carrot', 'field_flower', 'land_mushroom', 'water_shell'];

const SMALL_REMOTE_PLANETS = [
    { id: 'firebird', name: '火鸟岛', x: 22, y: 34, radius: 4.1, depth: 11, hue: 18, accent: '#ffd166', rotation: -18, spinDuration: 14, elementalAttribute: '火', fieldId: 'fire', equipmentId: 'fire_volcano', equipmentName: '火山', equipmentEmoji: '🌋', surfaceX: 36, surfaceY: 30, tip: '派飞船可带回火元素与火山资源，解锁火山地貌。' },
    { id: 'ice', name: '寒冰岛', x: 11, y: 76, radius: 3.5, depth: 10, hue: 196, accent: '#b8f7ff', rotation: 31, spinDuration: 18, elementalAttribute: '冰', fieldId: 'ice', equipmentId: 'ice_lake', equipmentName: '冰湖', equipmentEmoji: '🧊', surfaceX: 62, surfaceY: 30, tip: '派飞船可带回冰元素与冰湖资源，解锁冰湖地貌。' },
    { id: 'desert', name: '沙漠岛', x: 88, y: 29, radius: 3.8, depth: 9, hue: 42, accent: '#ffe08a', rotation: 57, spinDuration: 16, elementalAttribute: '生命', fieldId: 'life', equipmentId: 'life_sand_tree', equipmentName: '沙池生命树', equipmentEmoji: '🏝️', surfaceX: 69, surfaceY: -3, surfaceRot: 14, surfaceScale: 2, tip: '派飞船可带回生命元素与沙池生命树，解锁生命地貌。' },
    { id: 'shadow', name: '幽暗岛', x: 8, y: 52, radius: 3.1, depth: 12, hue: 218, accent: '#9ca3af', rotation: -42, spinDuration: 22, elementalAttribute: '暗', fieldId: 'dark', equipmentId: 'dark_underground_caves', equipmentName: '地下洞穴', equipmentEmoji: '🕳️', surfaceX: 67, surfaceY: 67, tip: '派飞船可带回暗元素与地下洞穴资源，解锁幽暗地貌。' },
];

const PLANET_ACTION_DETAILS = {
    info: {
        icon: '🛰️',
        title: '星球档案',
        text: '查看当前宠物与星球的详细状态。',
        effect: '会打开详情面板，不会消耗任何资源。',
        okText: '查看详情',
    },
    weather: {
        icon: '🌧️',
        title: '气候稳定',
        text: '打开天气控制面板，选择雨云、晴光或季风等气候效果。',
        effect: '天气会影响星球上的植物和宠物状态，使用后会进入冷却。',
        okText: '打开天气塔',
        building: 'weatherTower',
    },
    visit: {
        icon: '🚀',
        title: '星际拜访',
        text: `让宠物乘飞船拜访好友星球。`,
        effect: `会消耗 ${SOCIAL_FUEL_COST} 生物燃料，宠物会获得心情与羁绊，并带回金币。`,
        okText: '开始拜访',
        unlock: 2,
        building: 'spaceport',
    },
    ufo: {
        icon: '🛸',
        title: '接待 UFO',
        text: '接待今天路过的星际旅行商人。',
        effect: '每天只能接待一次，成功后会获得一份星际礼物。',
        okText: '接待访客',
        unlock: 3,
        building: 'ufoPad',
    },
    astro: {
        icon: '🔭',
        title: '星象校准',
        text: '校准今日星象，为宠物和星球启用当天的星轨加成。',
        effect: '每天只能校准一次，可能改善心情、清洁、亲密等状态。',
        okText: '校准星象',
        unlock: 1,
        building: 'observatory',
    },
    milestones: {
        icon: '🏆',
        title: '里程碑',
        text: '查看星球等级、成长进度、解锁目标和最近事件。',
        effect: '只是查看记录，不会消耗资源或改变状态。',
        okText: '查看里程碑',
    },
};

const PLANET_INFRASTRUCTURE = {
    weatherTower: {
        name: '天气塔',
        action: 'weather',
        x: 32,
        y: 23,
        scale: 1,
        buildCost: { coins: 60 },
        upgradeCosts: [{ coins: 90 }, { coins: 140, biofuel: 1 }],
        guide: '先在星球表面建造天气塔，才能调度雨云、晴光和季风。升级后天气持续更久，冷却更短。',
    },
    spaceport: {
        name: '航天站',
        action: 'visit',
        x: 72,
        y: 30,
        scale: 1,
        buildCost: { coins: 120 },
        upgradeCosts: [{ coins: 180, biofuel: 1 }, { coins: 260, biofuel: 2 }],
        guide: '星际拜访需要航天站发射飞船。升级后航线更稳定，出访燃料更省、带回金币更多。',
    },
    ufoPad: {
        name: 'UFO停机坪',
        action: 'ufo',
        x: 45,
        y: 18,
        scale: 1,
        buildCost: { coins: 150, biofuel: 1 },
        upgradeCosts: [{ coins: 220, biofuel: 2 }, { coins: 320, biofuel: 3 }],
        guide: '接待 UFO 需要安全停机坪。升级后旅行商人更愿意留下额外礼物。',
    },
    observatory: {
        name: '观星台',
        action: 'astro',
        x: 28,
        y: 70,
        scale: 1,
        buildCost: { coins: 90 },
        upgradeCosts: [{ coins: 140 }, { coins: 210, biofuel: 1 }],
        guide: '星象校准需要观星台锁定星轨。升级后每日星象加成更强。',
    },
};

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
    state.planetVisitors = [entry, ...(state.planetVisitors || [])].slice(0, 12);
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
    if (cost.coins) parts.push(`${cost.coins} 金币`);
    if (cost.biofuel) parts.push(`${cost.biofuel} 生物燃料`);
    return parts.join(' + ') || '免费';
}

function canAfford(cost) {
    return (state.coins | 0) >= (cost?.coins || 0) && (state.biofuel | 0) >= (cost?.biofuel || 0);
}

function spendCost(cost) {
    state.coins = Math.max(0, (state.coins | 0) - (cost?.coins || 0));
    state.biofuel = Math.max(0, (state.biofuel | 0) - (cost?.biofuel || 0));
    refreshTopbarResources();
}

function currentHourStart(now = Date.now()) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

function miningStartHour(now = Date.now()) {
    const createdAt = Number.isFinite(state.planetCreatedAt) && state.planetCreatedAt > 0 ? state.planetCreatedAt : now;
    return currentHourStart(createdAt);
}

function getPlanetMiningState(now = Date.now()) {
    const mining = state.planetMining && typeof state.planetMining === 'object' ? state.planetMining : (state.planetMining = {});
    if (!Number.isFinite(mining.lastCollectedHourAt) || mining.lastCollectedHourAt <= 0) {
        mining.lastCollectedHourAt = miningStartHour(now);
    }
    return mining;
}

function planetMiningCoins(now = Date.now()) {
    const mining = getPlanetMiningState(now);
    const lastHour = currentHourStart(Number(mining.lastCollectedHourAt) || miningStartHour(now));
    const currentHour = currentHourStart(now);
    const elapsedHours = Math.max(0, Math.floor((currentHour - lastHour) / PLANET_MINING_HOUR_MS));
    return Math.min(PLANET_MINING_MAX_COINS, elapsedHours * PLANET_MINING_COIN_PER_HOUR);
}

function planetMiningPileHtml(coins) {
    const amount = Math.max(0, Number(coins) || 0);
    if (amount <= 0) return '';
    const coinCount = Math.max(1, Math.min(10, Math.ceil(amount / (PLANET_MINING_MAX_COINS / 10))));
    const placements = [
        [-18, 4, -21, 1.02], [-6, -1, 9, 0.96], [8, 3, -9, 1.05], [20, 0, 18, 0.92],
        [-25, 13, 16, 0.88], [-10, 10, -6, 1.08], [5, 12, 24, 0.9], [18, 11, -15, 1],
        [-2, 20, 6, 0.94], [12, 20, -24, 0.86],
    ];
    return `<div class="planet-coin-pile" data-planet-mining-pile title="可领取 ${amount} 金币" aria-label="星球挖矿产出 ${amount} 金币">
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
    const mining = getPlanetMiningState(now);
    mining.lastCollectedHourAt = currentHourStart(now);
    mining.lastCollectedAt = now;
    state.coins = Math.max(0, (Number(state.coins) || 0) + reward);
    addPlanetLog('mining', `星球挖矿产出 ${reward} 金币`, '🪙');
    saveUserProfileDebounced();
    soundManager.playPointReward();
    animatePlanetMiningCoinsToHud(reward, refreshTopbarResources);
    showToast(`星球挖矿产出了 ${reward} 金币。`, 'success', 2600);
    notify();
    return true;
}

function buildOrUpgradeInfrastructure(buildingId) {
    const def = PLANET_INFRASTRUCTURE[buildingId];
    if (!def) return false;
    const current = getInfrastructure(buildingId);
    const currentLevel = current?.level || 0;
    if (currentLevel >= PLANET_INFRA_MAX_LEVEL) {
        showToast(`${def.name} 已满级。`, 'info');
        return false;
    }
    const cost = infrastructureCost(buildingId, currentLevel);
    if (!canAfford(cost)) {
        showToast(`资源不足：需要 ${formatCost(cost)}。`, 'error', 2600);
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
    addPlanetLog(currentLevel ? 'upgrade' : 'build', `${def.name} 升至 Lv.${nextLevel}`, '🏗️');
    saveUserProfileDebounced();
    notify();
    if (currentLevel) soundManager.playBuildLevelUp();
    else soundManager.playBuildCreated();
    showToast(currentLevel ? `${def.name} 已升级到 Lv.${nextLevel}。` : `${def.name} 建造完成。`, 'success', 2200);
    return true;
}

function isLocked(progress, unlockLevel) {
    return progress.level < unlockLevel;
}

function lockedTitle(unlockLevel) {
    return `星球 Lv.${unlockLevel} 解锁`;
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

function socialFuelCost() {
    const level = getActionInfrastructureLevel('visit') || 1;
    return Math.max(24, SOCIAL_FUEL_COST - (level - 1) * 3);
}

function socialCoinReward() {
    return HAQI_VISIT_COIN_REWARD;
}

function socialVisitTip(destinationId = 'haqi') {
    const fuelCost = socialFuelCost();
    if (destinationId === 'haqi') {
        return `会消耗 ${fuelCost} 生物燃料，宠物会获得心情与羁绊，带回 ${socialCoinReward()} 金币和随机礼物。`;
    }
    const remote = SMALL_REMOTE_PLANETS.find(item => item.id === destinationId);
    if (!remote) return `会消耗 ${fuelCost} 生物燃料，宠物会乘飞船拜访好友星球。`;
    const stock = getRemoteElementStock(remote);
    const added = Math.min(REMOTE_ELEMENT_HAUL_TONS, Math.max(0, REMOTE_ELEMENT_MAX_TONS - stock));
    return `会消耗 ${fuelCost} 生物燃料，飞船会前往${remote.name}，带回 ${added} 吨${remote.elementalAttribute}元素。`;
}

function astroMultiplier() {
    const level = getActionInfrastructureLevel('astro') || 1;
    return 1 + (level - 1) * 0.25;
}

function actionEffectText(action, detail, buildingId, infraLevel) {
    if (buildingId === 'weatherTower') {
        return `${detail.effect} 当前天气持续 ${Math.round(weatherDurationMs() / 60000)} 分钟，冷却约 ${Math.round(weatherCooldownMs() / 60000)} 分钟。`;
    }
    if (buildingId === 'spaceport') {
        return socialVisitTip('haqi');
    }
    if (buildingId === 'ufoPad') {
        return `${detail.effect} 当前 Lv.${infraLevel || 1} 停机坪会让访客留下 ${Math.max(1, infraLevel || 1)} 份礼物。`;
    }
    if (buildingId === 'observatory') {
        return `${detail.effect} 当前星象倍率为 ${astroMultiplier().toFixed(2)}x。`;
    }
    return detail.effect;
}

function planetInfrastructureHtml() {
    const entries = Object.entries(PLANET_INFRASTRUCTURE)
        .map(([id, def]) => ({ id, def, infra: getInfrastructure(id) }))
        .filter(item => item.infra);
    if (!entries.length) return '';
    return `<div class="planet-infra-layer" aria-hidden="true">
        ${entries.map(({ id, def, infra }) => {
            const angle = Math.atan2(def.y - 50, def.x - 50);
            const rimRadius = 53;
            const x = 50 + Math.cos(angle) * rimRadius;
            const y = 50 + Math.sin(angle) * rimRadius;
            const rotation = angle * 180 / Math.PI + 90;
            return `
            <span class="planet-infra planet-infra-${id}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--infra-rotation:${rotation.toFixed(1)}deg;--infra-scale:${Number(def.scale) || 1}" title="${escapeHtml(def.name)} Lv.${infra.level}">
                ${planetInfrastructureSvg(id, infra.level)}
            </span>
        `;
        }).join('')}
    </div>`;
}

function planetRemoteArtifactsHtml() {
    const discoveries = state.remotePlanetDiscoveries || {};
    const entries = SMALL_REMOTE_PLANETS.filter(planet => discoveries[planet.id]);
    if (!entries.length) return '';
    return `<div class="planet-remote-artifacts" aria-hidden="true">
        ${entries.map(planet => `<span class="planet-remote-artifact planet-remote-${planet.id}" style="left:${planet.surfaceX}%;top:${planet.surfaceY}%;--remote-artifact-hue:${planet.hue};--surface-rot:${Number(planet.surfaceRot) || 0}deg;--surface-scale:${Number(planet.surfaceScale) || 1}" title="${escapeHtml(planet.equipmentName)}"></span>`).join('')}
    </div>`;
}

function getRemoteElementStock(remote) {
    const stocks = state.remoteElementStocks || {};
    return Math.max(0, Math.min(REMOTE_ELEMENT_MAX_TONS, Number(stocks[remote.id]) || 0));
}

function smallRemotePlanetsHtml() {
    return SMALL_REMOTE_PLANETS.map(planet => {
        const showName = planet.radius >= SMALL_REMOTE_PLANET_NAME_RADIUS;
        return `
            <button class="remote-mini-planet remote-mini-${planet.id}" id="mhRemotePlanet-${planet.id}" type="button"
                style="left:${planet.x}%;top:${planet.y}%;--remote-mini-size:${(planet.radius * SMALL_REMOTE_PLANET_SIZE_PER_RADIUS).toFixed(1)}px;--remote-mini-hue:${planet.hue};--remote-mini-accent:${planet.accent};--remote-mini-rotation:${planet.rotation || 0}deg;--remote-mini-spin-duration:${planet.spinDuration || 120}s"
                title="${escapeHtml(planet.name)}" aria-label="${escapeHtml(planet.name)}" data-remote-planet="${escapeHtml(planet.id)}">
                <span class="remote-mini-body" aria-hidden="true">${smallRemotePlanetSvg(planet)}</span>
                ${showName ? `<span class="remote-mini-name">${escapeHtml(planet.name)}</span>` : ''}
            </button>`;
    }).join('');
}

function smallRemotePlanetSvg(planet) {
    return `
        <svg viewBox="0 0 64 64" role="img" focusable="false">
            <defs>
                <radialGradient id="remoteMiniCore-${planet.id}" cx="34%" cy="26%" r="72%">
                    <stop offset="0" stop-color="#ffffff"/>
                    <stop offset="0.26" stop-color="${planet.accent}"/>
                    <stop offset="0.68" stop-color="hsl(${planet.hue} 78% 44%)"/>
                    <stop offset="1" stop-color="#080b28"/>
                </radialGradient>
            </defs>
            <circle class="remote-mini-core" cx="32" cy="32" r="21" fill="url(#remoteMiniCore-${planet.id})"/>
            <path class="remote-mini-land l1" d="M16 30c7-11 19-15 32-8 2 8-5 13-13 11-8-2-12 4-19-3z"/>
            <path class="remote-mini-land l2" d="M31 44c7-8 16-7 19 1-5 6-12 9-20 8-1-3-1-6 1-9z"/>
            <path class="remote-mini-shine" d="M20 22c5-6 13-9 22-7"/>
        </svg>`;
}

function remoteTravelPlanets() {
    return [
        { id: 'haqi', name: '哈奇岛', x: 12, y: 16, radius: 9, depth: 10, selector: '#mhHaqiIsland .remote-planet-body' },
        ...SMALL_REMOTE_PLANETS.map(planet => ({
            id: planet.id,
            name: planet.name,
            x: planet.x,
            y: planet.y,
            radius: planet.radius,
            depth: planet.depth,
            selector: `#mhRemotePlanet-${planet.id} .remote-mini-body`,
        })),
    ];
}

function planetActionIconHtml(action) {
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
    const key = 'field_land';
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
        const top = dominantTraits(pet, 1)[0];
        const planetHue = top ? hueForTrait(top.id) : 36;
        const planetExpression = resolvePlanetExpression(this.expression, pet);
        const progress = computePlanetProgress();
        const activeWeather = getActivePlanetWeather();
        const activeBuff = getActivePlanetBuff();
        const stars = Array.from({ length: 36 }).map((_, i) => {
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const s = Math.random() * 2.1 + 0.8;
            const d = (Math.random() * 4 + 2).toFixed(2);
            const glow = i % 5 === 0 ? 'rgba(255, 231, 161, 0.95)' : i % 3 === 0 ? 'rgba(152, 239, 255, 0.95)' : '#fff';
            return `<i class="star" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;--star-glow:${glow};animation-duration:${d}s;animation-delay:${-(Math.random() * 4).toFixed(2)}s"></i>`;
        }).join('');
        const planetName = (state.planetName && state.planetName.trim()) || '宠物星';
        const miningCoins = planetMiningCoins();
        const infrastructureHtml = planetInfrastructureHtml();
        const remoteArtifactsHtml = planetRemoteArtifactsHtml();
        const moons = Array.from({ length: progress.moonCount }).map((_, i) => {
            const size = 12 + (i % 4) * 3;
            const orbit = 230 + i * 18;
            const duration = 8 + i * 1.8;
            const delay = -(i * 1.15).toFixed(2);
            return `<span class="planet-moon-orbit" style="--moon-size:${size}px;--orbit:${orbit}px;--moon-dur:${duration}s;--moon-delay:${delay}s;--moon-angle:${i * 37}deg"><i></i></span>`;
        }).join('');
        const remoteLocked = progress.canVisitHaqiIsland ? '' : ' locked';
        const remoteTitle = progress.canVisitHaqiIsland
            ? '前往哈奇岛下载蛋蛋星球客户端'
            : '孵化一只宠物且星球等级达到 Lv.3 后解锁';
        return `
            <div class="space-camera-layer">
                <div class="space-bg">${stars}</div>
                ${spaceTravelHtml()}
                ${activeWeather ? planetWeatherSpaceHtml(activeWeather) : ''}
                ${smallRemotePlanetsHtml()}
                <div class="space-planet user-planet planet-expression-${planetExpression} ${miningCoins > 0 ? 'has-mining-coins' : ''}" id="mhPlanet" data-planet-expression="${planetExpression}" style="--planet-hue:${planetHue}" title="${miningCoins > 0 ? `领取 ${miningCoins} 金币` : '星球'}">
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
                        <div class="planet-tree-hair" aria-hidden="true">
                            <span class="planet-tree-hair-sprout sprout-6"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i></span>
                            <span class="planet-tree-hair-sprout sprout-7"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i></span>
                            <span class="planet-tree-hair-sprout sprout-8"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i></span>
                            <span class="planet-tree-hair-sprout sprout-1"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i><em class="tree-flower flower-1"></em></span>
                            <span class="planet-tree-hair-sprout sprout-2"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i><em class="tree-flower flower-2"></em></span>
                            <span class="planet-tree-hair-sprout sprout-3"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i><em class="tree-flower flower-1"></em></span>
                            <span class="planet-tree-hair-sprout sprout-4"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i><em class="tree-flower flower-2"></em></span>
                            <span class="planet-tree-hair-sprout sprout-5"><i class="tree-leaf leaf-1"></i><i class="tree-leaf leaf-2"></i><i class="tree-leaf leaf-3"></i><em class="tree-flower flower-1"></em></span>
                        </div>
                        ${infrastructureHtml}
                        ${remoteArtifactsHtml}
                    </div>
                </div>
            <div class="planet-status-panel">
                <div class="planet-status-date">${escapeHtml(formatChineseDate(new Date()))}</div>
                <div class="planet-status-main">${escapeHtml(planetName)}星 · 第${progress.planetDays}天</div>
                <div class="planet-status-level">Lv.${progress.level} 星轨稳定</div>
                ${activeWeather ? `<div class="planet-status-chip">${activeWeather.emoji} ${escapeHtml(activeWeather.name)} · ${formatTimeLeft(activeWeather.until)}</div>` : ''}
                ${activeBuff ? `<div class="planet-status-chip">${activeBuff.emoji} ${escapeHtml(activeBuff.name)}</div>` : ''}
            </div>
            <button class="remote-planet${remoteLocked}" id="mhHaqiIsland" type="button" title="${escapeHtml(remoteTitle)}" aria-label="哈奇岛">
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
            </button>
            </div>
        `;
    },

    bindStage(pet, ctx) {
        this._planetPet = pet;
        __spaceTravel?.destroy();
        __spaceTravel = createSpaceTravel({
            userPlanet: { id: 'user', name: '宠物星', x: 70, y: 65, radius: 15, depth: 1, selector: '#mhPlanet .planet-body' },
            remotePlanets: remoteTravelPlanets(),
        }).mount(document);

        const planet = $('mhPlanet');
        if (planet) planet.setPlanetExpression = (expression = 'auto') => this.setPlanetExpression(expression, pet);
        if (planet) planet.onclick = () => {
            if (collectPlanetMiningCoins()) return;
            const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
            const msg = isTouch ? '上滑屏幕即可放大登陆星球 ✨' : '滚动鼠标滚轮即可放大登陆星球 ✨';
            showToast(msg, 'info');
        };
        const haqiIsland = $('mhHaqiIsland');
        if (haqiIsland) haqiIsland.onclick = (e) => {
            e.stopPropagation();
            const progress = computePlanetProgress();
            if (!progress.canVisitHaqiIsland) {
                showToast('哈奇岛需要孵化至少 1 只宠物，并让星球等级达到 Lv.3 后开启。', 'info', 3200);
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
        const progress = computePlanetProgress();
        const socialLocked = isLocked(progress, 2);
        const visitInfraMissing = !getInfrastructure('spaceport');
        return `
            <div class="mh-dock-row planet-dock-actions">
                <button class="btn-secondary dock-icon-btn ${socialLocked || visitInfraMissing ? 'planet-action-locked' : ''}" data-act="visit" title="${socialLocked ? lockedTitle(2) : `消耗 ${SOCIAL_FUEL_COST} 生物燃料拜访好友星球`}">
                    <span class="dock-icon planet-dock-svg-icon">${planetActionIconHtml('visit')}</span><span class="dock-label">星际拜访</span>
                </button>
                <button class="btn-secondary dock-icon-btn" data-act="milestones" title="查看星球里程碑">
                    <span class="dock-icon planet-dock-svg-icon">${planetActionIconHtml('milestones')}</span><span class="dock-label">里程碑</span>
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
                if (action === 'milestones') showMilestonesPanel();
                else showPlanetActionDialog(action, pet, ctx);
            };
        });
    },

    onLeave() {
        __spaceTravel?.destroy();
        __spaceTravel = null;
        __remoteCargoActive = false;
    },

    // 太空层做相机缩放时的视觉调整：星球随相机缩放轻微缩放（已由 stageInner 的 transform 完成）
    onCameraChange(_zoom) { /* nothing extra */ },
};

function formatChineseDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
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
    if (hours < 1) return '刚刚出生';
    if (hours < 24) return `${hours}小时`;
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days}天${restHours}小时` : `${days}天`;
}

function formatTimeLeft(until, now = Date.now()) {
    const ms = Math.max(0, (Number(until) || 0) - now);
    const minutes = Math.ceil(ms / 60000);
    if (minutes <= 0) return '即将结束';
    if (minutes < 60) return `${minutes}分钟`;
    return `${Math.ceil(minutes / 60)}小时`;
}

function planetWeatherSpaceHtml(weather) {
    if (weather.id === 'rain') {
        return `<div class="planet-orbit-weather planet-orbit-rain" aria-hidden="true">${Array.from({ length: 28 }).map((_, i) => `<i style="left:${(i * 23) % 100}%;animation-delay:${-(i % 10) * 0.12}s"></i>`).join('')}</div>`;
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
            ? buildingDef.guide
        : locked
            ? lockedTitle(detail.unlock)
            : actionEffectText(action, detail, buildingId, infrastructureLevel);
    const visitDestinationsHtml = action === 'visit' && !locked && !needsBuilding ? socialVisitDestinationPickerHtml() : '';
    openPlanetModal(`
        <div class="planet-action-dialog-head">
            <span class="planet-action-dialog-icon">${detail.icon}</span>
            <div>
                <div class="planet-modal-title">${escapeHtml(detail.title)}</div>
                <div class="planet-modal-subtitle">${escapeHtml(detail.text)}</div>
            </div>
        </div>
        <div class="planet-action-dialog-body" ${action === 'visit' && !locked && !needsBuilding ? 'data-visit-tip' : ''}>
            ${escapeHtml(bodyText)}
        </div>
        ${buildingDef ? `
            <div class="planet-infra-card">
                <span class="planet-infra-card-icon">${planetInfrastructureSvg(buildingId, Math.max(1, infrastructureLevel || 1))}</span>
                <span><b>${escapeHtml(buildingDef.name)} ${infrastructureLevel ? `Lv.${infrastructureLevel}` : '未建造'}</b><i>${escapeHtml(infrastructureLevel ? (canUpgrade ? `升级费用：${formatCost(cost)}` : '已满级') : `建造费用：${formatCost(cost)}`)}</i></span>
            </div>` : ''}
        ${visitDestinationsHtml}
        <div class="planet-modal-actions">
            <button class="btn-secondary" data-act="close">${locked && !needsBuilding ? '知道了' : '取消'}</button>
            ${buildingDef && (needsBuilding || canUpgrade) ? `<button class="btn-secondary" data-infra-build="${escapeHtml(buildingId)}">${needsBuilding ? `建造${escapeHtml(buildingDef.name)}` : '升级'}</button>` : ''}
            ${locked || needsBuilding ? '' : `<button class="btn-primary" data-action-confirm="${escapeHtml(action)}">${escapeHtml(detail.okText)}</button>`}
        </div>
    `, (e, close) => {
        const buildBtn = e.target.closest?.('[data-infra-build]');
        if (buildBtn) {
            if (buildOrUpgradeInfrastructure(buildBtn.dataset.infraBuild)) close();
            return;
        }
        const destinationBtn = e.target.closest?.('[data-visit-destination]');
        if (destinationBtn) {
            if (destinationBtn.disabled) return;
            const list = destinationBtn.closest('.planet-visit-destinations');
            list?.querySelectorAll('[data-visit-destination]').forEach(item => {
                const selected = item === destinationBtn;
                item.classList.toggle('is-selected', selected);
                item.setAttribute('aria-selected', selected ? 'true' : 'false');
            });
            const tip = e.currentTarget.querySelector?.('[data-visit-tip]');
            if (tip) tip.textContent = socialVisitTip(destinationBtn.dataset.visitDestination || 'haqi');
            return;
        }
        const btn = e.target.closest?.('[data-action-confirm]');
        if (!btn) return;
        if (action === 'visit') {
            const selected = e.currentTarget.querySelector?.('.planet-visit-destination.is-selected');
            btn.disabled = true;
            runSocialVisitDestination(selected?.dataset.visitDestination || 'haqi', pet, close).then(sent => {
                if (!sent) btn.disabled = false;
            });
            return;
        }
        close();
        runPlanetAction(action, pet, ctx);
    });
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

function showWeatherPanel(pet) {
    const progress = computePlanetProgress();
    const now = Date.now();
    const activeWeather = getActivePlanetWeather(now);
    openPlanetModal(`
        <div class="planet-modal-title">🌦️ 星球天气控制</div>
        <div class="planet-modal-subtitle">改变气候会传导到 星球与宠物日常状态。</div>
        ${activeWeather ? `<div class="planet-current-card">${activeWeather.emoji} ${escapeHtml(activeWeather.name)} 还会持续 ${formatTimeLeft(activeWeather.until, now)}</div>` : ''}
        <div class="planet-option-list">
            ${WEATHER_OPTIONS.map(w => {
                const locked = isLocked(progress, w.unlock);
                return `
                    <button class="planet-option ${locked ? 'locked' : ''}" data-weather-choice="${w.id}" type="button">
                        <span class="planet-option-icon">${w.emoji}</span>
                        <span><b>${escapeHtml(w.label)}</b><i>${locked ? lockedTitle(w.unlock) : escapeHtml(w.message)}</i></span>
                    </button>`;
            }).join('')}
        </div>
        <div class="planet-modal-actions"><button class="btn-secondary" data-act="close">关闭</button></div>
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
        showToast(`天气塔冷却中，还需 ${formatTimeLeft(actions.weatherAt + cooldownMs, now)}`, 'info');
        return;
    }
    state.planetWeather = {
        id: option.id,
        emoji: option.emoji,
        name: option.label,
        startedAt: now,
        until: now + weatherDurationMs(),
    };
    actions.weatherAt = now;
    ['mood', 'hunger', 'clean', 'bond'].forEach(key => clampStat(pet, key, option[key] || 0));
    if (option.id === 'rain') {
        const grown = await growRainPlants(pet);
        state.currentRoom = pet.activeRoom = 'living';
        addPlanetLog('weather', `雨云催生了 ${grown} 株 植物`, option.emoji);
    } else {
        addPlanetLog('weather', `${option.label}调整了星球气候`, option.emoji);
    }
    savePetDebounced(pet);
    saveUserProfileDebounced();
    showToast(option.message, 'success', 2800);
    notify();
}

function launchSocialVisit(pet) {
    const progress = computePlanetProgress();
    if (isLocked(progress, 2)) { showToast(lockedTitle(2), 'info'); return; }
    runSocialVisitDestination('haqi', pet);
}

function socialVisitDestinationItems() {
    return [
        {
            id: 'haqi',
            name: '哈奇岛',
            icon: '🏝️',
            meta: `${socialFuelCost()}燃料 · ${socialCoinReward()}金币`,
            locked: false,
            selected: true,
        },
        ...SMALL_REMOTE_PLANETS.map(remote => {
            const stock = getRemoteElementStock(remote);
            const full = stock >= REMOTE_ELEMENT_MAX_TONS;
            return {
                id: remote.id,
                name: remote.name,
                remote,
                icon: remote.equipmentEmoji,
                meta: full ? '储量已满' : `${socialFuelCost()}燃料 · ${remote.elementalAttribute}${stock}/${REMOTE_ELEMENT_MAX_TONS}`,
                locked: full,
                selected: false,
            };
        }),
    ];
}

function socialVisitDestinationPickerHtml() {
    return `
        <div class="planet-visit-destinations" role="listbox" aria-label="选择拜访星球">
            ${socialVisitDestinationItems().map(destination => `
                <button class="planet-visit-destination ${destination.selected ? 'is-selected' : ''} ${destination.locked ? 'is-disabled' : ''}"
                    data-visit-destination="${escapeHtml(destination.id)}" type="button" role="option"
                    aria-selected="${destination.selected ? 'true' : 'false'}" ${destination.locked ? 'disabled' : ''}>
                    <span class="planet-visit-destination-icon">${destination.remote ? smallRemotePlanetSvg(destination.remote) : destination.icon}</span>
                    <span class="planet-visit-destination-text">
                        <b>${escapeHtml(destination.name)}</b>
                        <i>${escapeHtml(destination.meta)}</i>
                    </span>
                </button>
            `).join('')}
        </div>
    `;
}

async function runSocialVisitDestination(destinationId, pet, close) {
    if (destinationId === 'haqi') return launchHaqiSocialVisit(pet, close);
    const remote = SMALL_REMOTE_PLANETS.find(item => item.id === destinationId);
    if (!remote) return false;
    return visitRemotePlanet(remote, close);
}

async function launchHaqiSocialVisit(pet, close) {
    const fuelCost = socialFuelCost();
    const coinReward = socialCoinReward();
    if (__remoteCargoActive) {
        showToast('还有一批星际资源正在自动返航，请稍等片刻。', 'info', 2600);
        return false;
    }
    if ((state.biofuel | 0) < fuelCost) {
        showToast(`需要 ${fuelCost} ⛽ 生物燃料，去星球收集便便吧。`, 'error', 2600);
        return false;
    }
    state.biofuel = Math.max(0, (state.biofuel | 0) - fuelCost);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    close?.();
    __remoteCargoActive = true;
    showToast('飞船出发！宠物正在前往哈奇岛拜访。', 'info', 2600);
    try {
        soundManager.playSpacecraftTakeoff();
        if (__spaceTravel?.playMission) {
            await __spaceTravel.playMission('haqi', { direction: 'outbound', duration: 8500, type: 'shuttle' });
            soundManager.playSpacecraftArrive();
            showToast('哈奇岛拜访完成，飞船正在返航。', 'info', 2200);
            soundManager.playSpacecraftTakeoff();
            await __spaceTravel.playMission('haqi', { direction: 'return', duration: 7500, type: 'shuttle' });
        }
    } finally {
        __remoteCargoActive = false;
    }
    state.coins += coinReward;
    const gift = UFO_REWARDS[(Date.now() + (state.petOrder || []).length) % UFO_REWARDS.length];
    await addToInventory(pet.id, gift, 1);
    clampStat(pet, 'mood', 12);
    clampStat(pet, 'bond', 6);
    addPlanetLog('visit', `${pet.name || '宠物'}拜访了哈奇岛，带回 ${coinReward} 金币和随机礼物`, '🚀');
    refreshTopbarResources();
    savePetDebounced(pet);
    saveUserProfileDebounced();
    soundManager.playSpacecraftArrive();
    showToast(`航程完成！宠物拜访哈奇岛后带回了 ${coinReward} 金币和 1 份随机礼物。`, 'success', 3000);
    notify();
    return true;
}

async function acceptUfoVisitor(pet) {
    const progress = computePlanetProgress();
    if (isLocked(progress, 3)) { showToast(lockedTitle(3), 'info'); return; }
    const actions = state.planetActions || (state.planetActions = {});
    const key = todayKey();
    if (actions.ufoDay === key) {
        showToast('今日 UFO 已经接待过了，明天再观察星轨吧。', 'info', 2600);
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
    showToast(`UFO 旅行商人留下了 ${count} 份礼物，已放入背包。`, 'success', 2600);
    notify();
}

function alignConstellations(pet) {
    const progress = computePlanetProgress();
    if (isLocked(progress, 1)) { showToast(lockedTitle(1), 'info'); return; }
    const actions = state.planetActions || (state.planetActions = {});
    const key = todayKey();
    if (actions.astroDay === key && getActivePlanetBuff()) {
        showToast('今日星象已经校准。', 'info');
        return;
    }
    const buff = dailyBuffForToday();
    actions.astroDay = key;
    state.planetBuff = { ...buff, day: key, until: untilTomorrow() };
    const multiplier = astroMultiplier();
    ['hunger', 'mood', 'clean', 'bond'].forEach(stat => clampStat(pet, stat, (buff[stat] || 0) * multiplier));
    addPlanetLog('astro', `星象校准：${buff.name}`, buff.emoji);
    savePetDebounced(pet);
    saveUserProfileDebounced();
    showToast(`${buff.name} 已升起：${buff.text}`, 'success', 3200);
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
        name: '育宠大师',
        desc: '培养 3 个宠物到成年',
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
        name: '清洁能手',
        desc: '累计清理 500 次便便',
        goal: 500,
        progress: () => Number(state.lifetimeStats?.poopsCleaned) || 0,
    },
    {
        id: 'feed_500_times',
        emoji: '🍖',
        name: '饲养专家',
        desc: '累计喂食 500 次',
        goal: 500,
        progress: () => Number(state.lifetimeStats?.feeds) || 0,
    },
    {
        id: 'build_all_infrastructure',
        emoji: '🏗️',
        name: '星球建筑师',
        desc: '建造全部 4 座星球设施',
        goal: 4,
        progress: () => Object.values(state.planetInfrastructure || {}).filter(b => b && (Number(b.level) || 0) > 0).length,
    },
    {
        id: 'explore_all_remote',
        emoji: '🪐',
        name: '星际探险家',
        desc: '拜访全部 4 个偏远岛屿',
        goal: 4,
        progress: () => Object.keys(state.remotePlanetDiscoveries || {}).length,
    },
    {
        id: 'planet_30_days',
        emoji: '📅',
        name: '资深星主',
        desc: '在星球上度过 30 天',
        goal: 30,
        progress: () => getPlanetDayNumber(),
    },
    {
        id: 'planet_level_6',
        emoji: '🌌',
        name: '星轨闪耀',
        desc: '星球等级达到 Lv.6',
        goal: 6,
        progress: () => computePlanetProgress().level,
    },
    {
        id: 'collect_5_satellites',
        emoji: '🌕',
        name: '卫星收藏家',
        desc: '同时拥有 5 颗卫星（成年宠物）',
        goal: 5,
        progress: () => computePlanetProgress().grownUpPetCount,
    },
    {
        id: 'hatch_10_pets',
        emoji: '🥚',
        name: '生命摇篮',
        desc: '累计孵化 10 只宠物',
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
            name: def.name,
            desc: def.desc,
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
        ? `<span class="planet-achievement-claimed">已领取</span>`
        : a.canClaim
            ? `<button class="btn-primary planet-achievement-claim" data-claim-achievement="${escapeHtml(a.id)}" title="领取 ${ACHIEVEMENT_REWARD_COINS} 金币">领取 +${ACHIEVEMENT_REWARD_COINS}🪙</button>`
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
        showToast('该成就已经领取过了。', 'info', 1500);
        return false;
    }
    let current = 0;
    try { current = Number(def.progress()) || 0; } catch (_) { current = 0; }
    if (current < def.goal) {
        showToast('成就尚未完成，无法领取。', 'info', 1500);
        return false;
    }
    ach.claimed[id] = Date.now();
    state.coins = Math.max(0, (Number(state.coins) || 0) + ACHIEVEMENT_REWARD_COINS);
    addPlanetLog('achievement', `领取成就：${def.name} +${ACHIEVEMENT_REWARD_COINS} 金币`, def.emoji);
    saveUserProfileDebounced();
    refreshTopbarResources();
    soundManager.playPointReward?.();
    showToast(`${def.emoji} ${def.name} 完成！+${ACHIEVEMENT_REWARD_COINS} 金币`, 'success', 2400);
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
    addPlanetLog('achievement', `一键领取 ${ready.length} 项成就 +${totalCoins} 金币`, '🏆');
    saveUserProfileDebounced();
    refreshTopbarResources();
    soundManager.playPointReward?.();
    showToast(`领取 ${ready.length} 项成就，+${totalCoins} 金币`, 'success', 2600);
    notify();
    return ready.length;
}

function showMilestonesPanel() {
    const progress = computePlanetProgress();
    const logs = (state.planetVisitors || [])
        .slice()
        .sort((a, b) => (Number(b?.at) || 0) - (Number(a?.at) || 0))
        .slice(0, 5);
    const rows = [
        { level: 1, icon: '🌦️', text: '解锁天气控制与每日星象' },
        { level: 2, icon: '🚀', text: '解锁好友星球拜访' },
        { level: 3, icon: '🛸', text: '解锁 UFO 访客与哈奇岛入口' },
        { level: 4, icon: '🍃', text: '解锁季风气候' },
        { level: 6, icon: '💫', text: '星球环带更稳定，卫星成长更明显' },
    ].reverse();
    const achievements = getAchievementsView(progress);
    const claimableCount = achievements.filter(a => a.canClaim).length;
    const claimAllBtn = claimableCount > 1
        ? `<button class="btn-primary" data-act="claim-all-achievements" title="一次性领取全部已完成成就">一键领取 (${claimableCount})</button>`
        : '';
    openPlanetModal(`
        <div class="planet-modal-title">🏆 星球里程碑</div>
        <div class="planet-milestone-scroll">
            <div class="planet-progress-card">
                <div><b>Lv.${progress.level}</b><span>下一级 ${Math.round(progress.progressToNext * 100)}%</span></div>
                <div class="planet-dock-meter"><span style="width:${Math.round(progress.progressToNext * 100)}%"></span></div>
                <p>第 ${progress.planetDays} 天 · ${progress.petCount} 只宠物 · ${progress.grownUpPetCount} 颗卫星</p>
            </div>
            <div class="planet-achievements-head">
                <b>🏅 成就</b>
                <span>${achievements.filter(a => a.claimed).length}/${achievements.length} 已领取</span>
            </div>
            <div class="planet-achievement-list">
                ${achievements.map(a => renderAchievementRow(a)).join('')}
            </div>
            <div class="planet-achievements-head"><b>🗺️ 等级解锁</b></div>
            <div class="planet-milestone-list">
                ${rows.map(row => `<div class="planet-milestone ${progress.level >= row.level ? 'done' : ''}"><span>${row.icon}</span><span class="planet-milestone-body"><b>Lv.${row.level}</b><i>${escapeHtml(row.text)}</i></span></div>`).join('')}
            </div>
            <div class="planet-log-list">
                ${logs.length ? logs.map(log => `<div><span>${log.emoji || '•'}</span><b>${escapeHtml(formatLogDate(log.at))}</b><i>${escapeHtml(log.text || '')}</i></div>`).join('') : '<div><span>✨</span><i>还没有星球事件记录</i></div>'}
            </div>
        </div>
        <div class="planet-modal-actions">
            ${claimAllBtn}
            <button class="btn-primary" data-act="close">完成</button>
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

function showRemotePlanetPanel(remote) {
    const discoveries = state.remotePlanetDiscoveries || {};
    const discovery = discoveries[remote.id];
    const stock = getRemoteElementStock(remote);
    const full = stock >= REMOTE_ELEMENT_MAX_TONS;
    openPlanetModal(`
        <div class="haqi-island-head remote-travel-head">
            <div>
                <div class="planet-modal-title">${escapeHtml(remote.name)}</div>
                <div class="planet-modal-subtitle">${escapeHtml(remote.tip)}</div>
            </div>
            <button class="menu-close-btn haqi-download-close" data-act="close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="remote-travel-card">
            <div class="remote-travel-planet" style="--remote-travel-hue:${remote.hue};--remote-travel-accent:${remote.accent};--remote-mini-hue:${remote.hue};--remote-mini-accent:${remote.accent};--remote-mini-rotation:${remote.rotation || 0}deg;--remote-mini-spin-duration:${remote.spinDuration || 120}s">${smallRemotePlanetSvg(remote)}</div>
            <div class="remote-travel-info">
                <div><b>资源</b><span>${escapeHtml(remote.equipmentName)} ${remote.equipmentEmoji}</span></div>
                <div><b>DNA 信号</b><span>${escapeHtml(remote.elementalAttribute)}元素</span></div>
                <div><b>元素储量</b><span>${stock}/${REMOTE_ELEMENT_MAX_TONS} 吨</span></div>
            </div>
        </div>
        <div class="planet-action-dialog-body">
            派出飞船会自动往返 ${escapeHtml(remote.name)}，每次补充 ${REMOTE_ELEMENT_HAUL_TONS} 吨${escapeHtml(remote.elementalAttribute)}元素。最多可储存 ${REMOTE_ELEMENT_MAX_TONS} 吨，未来在对应地貌养宠会消耗这些元素。
        </div>
        <div class="planet-modal-actions remote-travel-actions">
            <button class="btn-secondary" data-act="close">关闭</button>
            <button class="btn-primary" data-remote-visit="${escapeHtml(remote.id)}" ${full ? 'disabled' : ''}>${full ? '储量已满' : (discovery ? '再次派遣飞船' : '派遣飞船')}</button>
        </div>
    `, async (e, close) => {
        const btn = e.target.closest?.('[data-remote-visit]');
        if (!btn) return;
        const target = SMALL_REMOTE_PLANETS.find(item => item.id === btn.dataset.remoteVisit);
        if (!target) return;
        btn.disabled = true;
        const sent = await visitRemotePlanet(target, close);
        if (!sent) btn.disabled = false;
    }, 'remote-travel-modal');
}

async function visitRemotePlanet(remote, close) {
    const fuelCost = socialFuelCost();
    if (__remoteCargoActive) {
        showToast('还有一批星际资源正在自动返航，请稍等片刻。', 'info', 2600);
        return false;
    }
    if (getRemoteElementStock(remote) >= REMOTE_ELEMENT_MAX_TONS) {
        showToast(`${remote.elementalAttribute}元素已经储存到上限 ${REMOTE_ELEMENT_MAX_TONS} 吨。`, 'info', 2600);
        return false;
    }
    if ((state.biofuel | 0) < fuelCost) {
        showToast(`需要 ${fuelCost} ⛽ 生物燃料才能派出飞船。`, 'error', 2600);
        return false;
    }
    state.biofuel = Math.max(0, (state.biofuel | 0) - fuelCost);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    close?.();
    __remoteCargoActive = true;
    showToast(`航程开始：飞船正在前往${remote.name}采集${remote.elementalAttribute}元素。`, 'info', 2600);
    try {
        soundManager.playSpacecraftTakeoff();
        if (__spaceTravel?.playMission) {
            await __spaceTravel.playMission(remote.id, { direction: 'outbound', duration: 10500, type: 'shuttle' });
            soundManager.playSpacecraftArrive();
            showToast(`${remote.equipmentName}装载完成，飞船正在返航。`, 'info', 2200);
            soundManager.playSpacecraftTakeoff();
            await __spaceTravel.playMission(remote.id, {
                direction: 'return',
                duration: 9500,
                type: 'shuttle',
                cargoClass: `planet-remote-artifact planet-remote-${remote.id}`,
                cargoHue: remote.hue,
            });
        }
        await completeRemoteElementReturn(remote);
        soundManager.playSpacecraftArrive();
    } finally {
        __remoteCargoActive = false;
    }
    return true;
}

async function completeRemoteElementReturn(remote) {
    state.remotePlanetDiscoveries = state.remotePlanetDiscoveries || {};
    const existing = state.remotePlanetDiscoveries[remote.id];
    const firstDiscovery = !existing;
    const dna = existing?.dna || randomDnaForElementalAttribute(remote.elementalAttribute);
    state.remotePlanetDiscoveries[remote.id] = {
        ...(existing || {}),
        visitedAt: Date.now(),
        equipmentId: remote.equipmentId,
        equipmentName: remote.equipmentName,
        elementalAttribute: remote.elementalAttribute,
        fieldId: remote.fieldId,
        dna,
    };
    state.remoteElementStocks = state.remoteElementStocks || {};
    const before = getRemoteElementStock(remote);
    const added = Math.min(REMOTE_ELEMENT_HAUL_TONS, REMOTE_ELEMENT_MAX_TONS - before);
    if (added <= 0) {
        showToast(`${remote.elementalAttribute}元素已经储存到上限 ${REMOTE_ELEMENT_MAX_TONS} 吨。`, 'info', 2600);
        return;
    }
    state.remoteElementStocks[remote.id] = before + added;
    const itemCount = Math.max(1, Math.floor(added / REMOTE_ELEMENT_HAUL_TONS));
    await addToInventory('remote_planet', remote.equipmentId, itemCount);
    addPlanetLog('remoteVisit', `飞船从${remote.name}带回 ${added} 吨${remote.elementalAttribute}元素`, remote.equipmentEmoji);
    refreshTopbarResources();
    saveUserProfileDebounced();
    notify();
    showToast(`航程完成：${remote.elementalAttribute}元素 +${added} 吨，转化为 ${itemCount} 个${remote.equipmentName}（${state.remoteElementStocks[remote.id]}/${REMOTE_ELEMENT_MAX_TONS}）。${firstDiscovery ? ` 已解锁对应地貌。` : ''}`, 'success', 3800);
}

function getFarewellRecords() {
    return (Array.isArray(state.haqiIslandFarewells) ? state.haqiIslandFarewells : [])
        .filter(Boolean)
        .slice()
        .sort((a, b) => (Number(b?.farewellAt) || 0) - (Number(a?.farewellAt) || 0));
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
    const statNames = { bond: '羁绊', mood: '心情', clean: '清洁', hunger: '体力' };
    const name = displayPetName(pet) || pet?.name || '哈奇伙伴';
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
            `在${(state.planetName && state.planetName.trim()) || '宠物星'}生活了${formatPetAge(pet, now)}。`,
            topTraits.length ? `身上最亮的特征是${topTraits.map(item => item.emoji + item.name).join('、')}。` : '把自己的独特气息留在了星球风里。',
            bestStat ? `${statNames[bestStat.key] || bestStat.key}达到${bestStat.value}，这是你们共同照顾出的光。` : '带着被照顾过的记忆出发。',
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
    const alt = escapeHtml(displayPetName(source) || record?.name || '哈奇伙伴');
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
                <div class="haqi-farewell-name">${escapeHtml(record.name || '哈奇伙伴')}</div>
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

function showHaqiIslandPanel() {
    const records = getFarewellRecords();
    const modal = openPlanetModal(`
        <div class="haqi-island-head">
            <div>
                <div class="planet-modal-title">哈奇岛</div>
                <div class="planet-modal-subtitle">成年宠物可以被送到《哈奇小镇》和哈奇们一起生活。如果你想念他们，可以到《哈奇小镇》探望。</div>
            </div>
            <button class="menu-close-btn haqi-download-close" data-act="close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="haqi-island-memory">
            ${records.length ? records.map(farewellRecordHtml).join('') : `
                <div class="haqi-empty-memory">
                    <b>还没有告别记录</b>
                    <span>等宠物长大成年后，可以为它举行成人礼，让它居住在哈奇岛。</span>
                </div>`}
        </div>
        <div class="planet-modal-actions haqi-island-actions">
            <button class="btn-secondary" data-haqi-farewell="1">告别宠物</button>
            <button class="btn-primary" data-haqi-download="1">登录《哈奇小镇》</button>
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
            <div class="planet-modal-title">告别宠物</div>
            <div class="planet-action-dialog-body">只有成年或长老阶段的宠物才能举行成人礼。继续照顾它，等它真正长大后再来哈奇岛吧。</div>
            <div class="planet-modal-actions"><button class="btn-primary" data-act="close">知道了</button></div>
        `);
        return;
    }
    openPlanetModal(`
        <div class="planet-modal-title">告别宠物（成人礼）</div>
        <div class="planet-modal-subtitle">一旦放飞，它不可召回，只能去《哈奇小镇》探望。请选择要举行成人礼的宠物。</div>
        <div class="haqi-candidate-list">
            ${candidates.map(pet => `
                <button class="planet-option" data-farewell-pet="${escapeHtml(pet.id)}" type="button">
                    <span class="planet-option-icon planet-option-pet-icon">${petArtHtml(pet, { alt: displayPetName(pet) })}</span>
                    <span><b>${escapeHtml(displayPetName(pet))}</b><i>${escapeHtml(getStageName(pet.stage, '成年'))} · 已陪伴 ${escapeHtml(formatPetAge(pet))}</i></span>
                </button>`).join('')}
        </div>
        <div class="planet-modal-actions"><button class="btn-secondary" data-act="close">取消</button></div>
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
                    <div class="planet-modal-title">${escapeHtml(record.name)} 的成人礼</div>
                    <div class="planet-modal-subtitle">音乐响起后，它会带着手帐飞回哈奇岛。此操作不可召回。</div>
                </div>
            </div>
            <div class="haqi-handbook-preview">
                ${record.handbook.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
            <div class="haqi-ceremony-warning">确认后，${escapeHtml(record.name)} 会离开当前星球，只能去《哈奇小镇》探望。</div>
        </div>
        <div class="planet-modal-actions">
            <button class="btn-secondary" data-act="close">再陪一会儿</button>
            <button class="btn-primary" data-farewell-confirm="${escapeHtml(pet.id)}">放飞回哈奇岛</button>
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
    if (!pet) { showToast('这只宠物已经不在星球上。', 'info'); return; }
    if (!isAdultStage(pet.stage)) { showToast('只有成年宠物才能举行成人礼。', 'info'); return; }
    const record = createFarewellRecord(pet);
    playFarewellChime();
    state.haqiIslandFarewells = [record, ...getFarewellRecords()].slice(0, 200);
    addPlanetLog('farewell', `${record.name}完成成人礼，飞回哈奇岛`, '🪄');
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
    showToast(`${record.name} 已飞回哈奇岛。`, 'success', 2600);
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
                    <div class="haqi-download-title">《哈奇小镇》APP 下载</div>
                    <div class="haqi-download-subtitle">选择当前可用的 PC 或 Android 版本继续</div>
                </div>
                <button class="menu-close-btn haqi-download-close" data-act="close" type="button" aria-label="关闭">×</button>
            </div>
            <div class="haqi-download-actions">
                <a class="btn-primary" href="${HAQI_DOWNLOAD_URL}" target="_blank" rel="noopener">PC 下载</a>
                <a class="btn-secondary" href="${HAQI_DOWNLOAD_URL}" target="_blank" rel="noopener">Android 下载</a>
            </div>
            <div class="haqi-download-note">下载页将在新窗口打开，可在页面中选择对应客户端版本。</div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-act="close"]')) close();
    });
    document.body.appendChild(mask);
}
