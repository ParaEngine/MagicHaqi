// 全局常量配置
import { t } from './i18n.js';
export const CDN_ROOT = 'https://cdn.keepwork.com/maisi/magichaqi/';

export const ZOOM_LEVEL_IDS = ['planet', 'field', 'pet', 'cell'];
const ZOOM_LEVEL_ALIASES = { space: 'planet', planet: 'planet', field: 'field', pet: 'pet', cell: 'cell' };

function boolOption(value) {
    if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value.trim());
    return !!value;
}

export function normalizeZoomLevelId(value, fallback = 'planet') {
    const key = String(value || '').trim().toLowerCase();
    return ZOOM_LEVEL_ALIASES[key] || ZOOM_LEVEL_ALIASES[fallback] || 'planet';
}

export function zoomLevelIdToIndex(value, fallback = 'planet') {
    const id = normalizeZoomLevelId(value, fallback);
    return Math.max(0, ZOOM_LEVEL_IDS.indexOf(id));
}

// Forced-entry view support. Like `home_planet`, the boot view can be forced via
// the `view` URL query parameter (e.g. `?view=field`) or a global JS variable
// `window.__view` set before the app boots. Supported values:
//   field | planet | pet | cell -> force the home view at that zoom level
//   game                        -> force the minigames (mini-game) view
export const FORCE_VIEW_IDS = ['planet', 'field', 'pet', 'cell', 'game', 'ops'];
const FORCE_VIEW_ALIASES = {
    space: 'planet', planet: 'planet', field: 'field', pet: 'pet', cell: 'cell',
    game: 'game', games: 'game', minigame: 'game', minigames: 'game',
    // 运营控制台（开发者 / 一人公司兜底面板），仅 ?view=ops 进入
    ops: 'ops', console: 'ops', operator: 'ops',
};

export function normalizeForceViewId(value) {
    const key = String(value || '').trim().toLowerCase();
    return FORCE_VIEW_ALIASES[key] || '';
}

export function getForcedView() {
    let raw = '';
    try {
        raw = String(new URL(window.location.href).searchParams.get('view') || '').trim();
    } catch (_) {}
    if (!raw) {
        try { raw = String(window.__view || '').trim(); } catch (_) {}
    }
    return normalizeForceViewId(raw);
}

// ---------------------------------------------------------------------------
// Agent 深链解析：?agent=<id> / ?adopt=1 / ?cmd=<urlencoded command>
// 供 app.js 在启动时读取，驱动「页面即 API」的一步到位入口。
// ---------------------------------------------------------------------------
export function getAgentParams() {
    const out = { agent: '', adopt: false, cmd: '' };
    try {
        const sp = new URL(window.location.href).searchParams;
        out.agent = String(sp.get('agent') || '').trim();
        const adoptRaw = String(sp.get('adopt') || '').trim().toLowerCase();
        out.adopt = adoptRaw === '1' || adoptRaw === 'true' || adoptRaw === 'yes';
        out.cmd = String(sp.get('cmd') || '').trim();
    } catch (_) {}
    return out;
}

export function normalizePlanetZoomOptions(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const hidePlanet = boolOption(source.hide_planet ?? source.hidePlanet);
    const hideCell = boolOption(source.hide_cell ?? source.hideCell);
    let defaultZoomLevel = normalizeZoomLevelId(source.default_zoom_level ?? source.defaultZoomLevel, 'planet');
    if (hidePlanet && defaultZoomLevel === 'planet') defaultZoomLevel = 'field';
    if (hideCell && defaultZoomLevel === 'cell') defaultZoomLevel = 'pet';
    return {
        default_zoom_level: defaultZoomLevel,
        hide_planet: hidePlanet,
        hide_cell: hideCell,
    };
}

export function getVisibleZoomLevelIndices(raw = {}) {
    const options = normalizePlanetZoomOptions(raw);
    return ZOOM_LEVEL_IDS
        .map((id, index) => ({ id, index }))
        .filter(item => !(item.id === 'planet' && options.hide_planet) && !(item.id === 'cell' && options.hide_cell))
        .map(item => item.index);
}

export function getDefaultZoomLevelIndex(raw = {}) {
    const options = normalizePlanetZoomOptions(raw);
    return resolveZoomLevelIndex(zoomLevelIdToIndex(options.default_zoom_level), options);
}

export function resolveZoomLevelIndex(target, raw = {}, from = null) {
    const visible = getVisibleZoomLevelIndices(raw);
    if (!visible.length) return 0;
    const clamped = Math.max(0, Math.min(ZOOM_LEVEL_IDS.length - 1, Number(target) | 0));
    if (visible.includes(clamped)) return clamped;
    const current = Number.isFinite(from) ? Math.max(0, Math.min(ZOOM_LEVEL_IDS.length - 1, Number(from) | 0)) : null;
    if (current != null && clamped > current) return visible.find(index => index > current) ?? visible[visible.length - 1];
    if (current != null && clamped < current) return [...visible].reverse().find(index => index < current) ?? visible[0];
    return visible.reduce((best, index) => Math.abs(index - clamped) < Math.abs(best - clamped) ? index : best, visible[0]);
}

export const CONFIG = {
    workspace: 'MagicHaqi',
    assets: {
        cdnRoot: CDN_ROOT,
        bgSounds: {},
    },
    initialCoins: 100,
    statMax: 100,
    statMin: 0,

    // tick 间隔（毫秒）
    tickInterval: 30 * 1000,
    // 每 tick 各属性衰减量
    statDecayPerTick: {
        hunger: -1, mood: -0.6, clean: -0.4,
        bond: -0.2,
    },
    // 离线最大补算（小时）；成长阶段仍按真实出生时间推进，不受此衰减上限影响。
    maxOfflineHours: 72,
    // 离线衰减按日常照料节奏计算，不复用在线 30s tick，避免每日登录时直接归零。
    offlineDecayPerHour: {
        hunger: -1.5, mood: -1, clean: -1.25,
        bond: -0.2,
    },
    offlineDecayDailyCap: {
        hunger: -36, mood: -24, clean: -30,
        bond: -5,
    },
    companionMood: {
        dailyMax: 50,
        eligibleZoomLevels: [1, 2, 3],
        rewards: [
            { id: '10s', seconds: 10, mood: 20 },
            { id: '60s', seconds: 60, mood: 10 },
            { id: '3m', seconds: 180, mood: 10 },
            { id: '5m', seconds: 300, mood: 10 },
        ],
    },
    hatchingCare: {
        costPerDay: 100,
        maxDays: 2,
        minStatAverage: 50,
        minMood: 50,
        minHunger: 50,
        targetMood: 62,
        targetHunger: 66,
        growthRate: 0.45,
    },

    // 互动效果
    actions: {
        feed:  { hunger: +28, mood: +5,  bond: +2,  costCoins: 2,  cooldownSec: 30 },
        bath:  { clean: +20, cooldownSec: 60 },
        play:  { mood: +5, bond: +20,  hunger: 0, costCoins: 0,  cooldownSec: 30, rewardCoins: 0 },
        sleep: { mood: +5, costCoins: 0,  cooldownSec: 120 },
    },

    // 成长阶段（按总时长 / 成长积分）
    stages: [
        { id: 'egg',    name: '蛋',   minHours: 0,   emoji: '🥚' },
        { id: 'baby',   name: '幼年', minHours: 0.05, emoji: '🐣' },
        { id: 'teen',   name: '青年', minHours: 4,   emoji: '🐥' },
        { id: 'adult',  name: '成年', minHours: 24,  emoji: '🐉' },
        { id: 'elder',  name: '隐藏形态', minHours: 168, emoji: '🦄' },
    ],
    breedableStages: ['adult', 'elder'],
    breedCost: 30,

    // 房间
    rooms: [
        { id: 'bedroom',  name: '卧室', emoji: '🛏️', bg: 'linear-gradient(180deg,#fde68a 0%,#fbbf24 60%,#92400e 100%)' },
        { id: 'kitchen',  name: '厨房', emoji: '🍳', bg: 'linear-gradient(180deg,#fef3c7 0%,#fcd34d 60%,#b45309 100%)' },
        { id: 'bath',     name: '浴室', emoji: '🛁', bg: 'linear-gradient(180deg,#bae6fd 0%,#7dd3fc 60%,#0369a1 100%)' },
        { id: 'living',   name: '客厅', emoji: '🛋️', bg: 'linear-gradient(180deg,#fde68a 0%,#fbbf24 60%,#78350f 100%)' },
        { id: 'garden',   name: '花园', emoji: '🌳', bg: 'linear-gradient(180deg,#bbf7d0 0%,#86efac 60%,#166534 100%)' },
    ],

    // 户外房屋（field 视图可购买并放置；rooms 中包含哪些房间决定 pet 视图可访问的房间）
    // 默认 house_1 永远在背包中（unlimited、hiddenFromShop），其余 4 间需购买
    houses: [
        { id: 'house_1', name: '小屋',    roomCount: 1, rooms: ['bedroom'] },
        { id: 'house_2', name: '双间小屋', roomCount: 2, rooms: ['bedroom', 'kitchen'] },
        { id: 'house_3', name: '三间居所', roomCount: 3, rooms: ['bedroom', 'kitchen', 'bath'] },
        { id: 'house_4', name: '四间宅院', roomCount: 4, rooms: ['bedroom', 'kitchen', 'bath', 'living'] },
        { id: 'house_5', name: '五间豪宅', roomCount: 5, rooms: ['bedroom', 'kitchen', 'bath', 'living', 'garden'] },
    ],
    defaultHouseId: 'house_1',

    // ====  4-level Zoom  ====
    // 0 = Space, 1 = Field, 2 = pet, 3 = Cell
    zoomLevels: [
        { id: 'space', name: '宇宙',  emoji: '🌌', subtitle: '星球俯视' },
        { id: 'field', name: '星球',  emoji: '🪐', subtitle: '陆 / 水 / 空' },
        { id: 'pet',   name: '宠物',  emoji: '🐾', subtitle: '日常陪伴' },
        { id: 'cell',  name: '细胞',  emoji: '🧬', subtitle: '体内冒险' },
    ],

    // 三大生态环境（Field 视图）
    fields: [
        { id: 'land',  name: '陆地', emoji: '🌳', iconClass: 'field-tab-icon-land', bg: 'linear-gradient(180deg,#bef264 0%,#84cc16 60%,#365314 100%)', favoriteTrait: 'catLike' },
        { id: 'water', name: '水域', emoji: '🌊', iconClass: 'field-tab-icon-water', bg: 'linear-gradient(180deg,#7dd3fc 0%,#0ea5e9 55%,#0c4a6e 100%)', favoriteTrait: 'fishLike' },
        { id: 'sky',   name: '天空', emoji: '☁️', iconClass: 'field-tab-icon-sky', bg: 'linear-gradient(180deg,#dbeafe 0%,#93c5fd 55%,#3b82f6 100%)', favoriteTrait: 'birdLike' },
    ],

    fieldDefaultScenes: {
        land: { id: 'blue_planet_grassland', title: '蓝星云草地', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/blue_planet_grassland-1779950916879.webp', color: '#bae6fd', tags: ['outdoor', 'land', 'sky'], particles: ['sparkle'] },
        water: { id: 'coral_rock_undersea_garden', title: '珊瑚岩石海底园', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/coral_rock_undersea_garden-1779951499103.webp', color: '#67e8f9', tags: ['ocean', 'underwater'], particles: ['bubbles'] },
        sky: { id: 'blue_sky_rainbow_planet_clouds', title: '蓝天彩虹云境', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/blue_sky_rainbow_planet_clouds-1779952934020.webp', color: '#bae6fd', tags: ['sky', 'outdoor'], particles: ['sparkle'] },
        fire: { id: 'blazing_fire_island', title: '烈火岛', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/blazing_fire_island-1779952121124.webp', color: '#fb923c', tags: ['outdoor', 'land', 'ocean', 'mountain'], particles: ['embers'], bgMusic: 'mountain' },
        ice: { id: 'crystal_ice_island', title: '寒冰岛', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/crystal_ice_island-1779952240591.webp', color: '#bae6fd', tags: ['outdoor', 'land', 'ocean', 'winter'], particles: ['snow'], bgMusic: 'mountain' },
        life: { id: 'golden_desert_island', title: '沙漠岛', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/golden_desert_island-1779952223136.webp', color: '#fde68a', tags: ['outdoor', 'land', 'ocean', 'sand'], particles: [], bgMusic: 'ship' },
        dark: { id: 'gentle_shadow_dead_island', title: '死亡岛', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/gentle_shadow_dead_island-1779952262043.webp', color: '#c4b5fd', tags: ['outdoor', 'land', 'ocean', 'night'], particles: ['mist'] },
        thunder: { id: 'blue_sky_rainbow_planet_clouds', title: '雷云岛', imageUrl: 'https://cdn.keepwork.com/maisi/magichaqi/scenes/blue_sky_rainbow_planet_clouds-1779952934020.webp', color: '#bae6fd', tags: ['outdoor', 'land', 'sky'], particles: ['sparkle', 'mist'], bgMusic: 'mountain' },
    },

    // 12 个基础种族（用于 trait→外观 提示）
    traitDefs: [
        { id: 'catLike',    name: '猫科', emoji: '🐱', food: 'food_meat'   },
        { id: 'rabbitLike', name: '兔形', emoji: '🐰', food: 'food_carrot' },
        { id: 'fishLike',   name: '鱼形', emoji: '🐟', food: 'food_fish'   },
        { id: 'birdLike',   name: '鸟形', emoji: '🐦', food: 'food_seed'   },
        { id: 'dragonLike', name: '龙形', emoji: '🐲', food: 'food_chili'  },
        { id: 'sweetLike',  name: '萌系', emoji: '🍰', food: 'food_cake'   },
        { id: 'fruitLike',  name: '果灵', emoji: '🍎', food: 'food_apple'  },
    ],

    // 一次喂食增加多少 trait 点（达到 100 时该特征会显著影响外观）
    traitGainPerFeed: 8,
    traitMax: 100,

    // 永久精神创伤：多日无人照料、饥饿、脏乱等会累积，无法治疗移除。
    trauma: {
        max: 6,
        neglectHours: 72,
        hungerThreshold: 25,
        cleanThreshold: 35,
        moodThreshold: 25,
    },

    // Field 视图 —— 收集 poop 转 biofuel
    poopIntervalSec: 90,               // 每 90 秒可能产出一坨
    poopChance: 0.55,                  // 概率
    maxPoopsPerField: 12,              // 每个生态最多保留的 poop 数量
    poopWarningThreshold: 4,            // 超过该数量时提示玩家清理
    poopMachineCostCoins: 5,            // 启动清理机器消耗金币
    biofuelPerPoop: 1,

    // 星球挖矿金币：planet 和 field 只是同一来源的两种领取入口。
    planetMining: {
        coinPerHour: 5,
        maxCoins: 120,
        hourMs: 60 * 60 * 1000,
        maxScatteredCoins: 10,
    },

    // 房间网格规格（与 CSS 对应）
    gridCols: 8,
    gridRows: 6,

    // memory.md 上限
    memoryMaxBytes: 8 * 1024,
    chatHistoryMaxBytes: 16 * 1024,

    // AI
    defaultSceneImageSize: '1024x1024',
    sceneImageSizes: [
        { value: '1024x1024', label: '1024x1024 默认', width: 1024, height: 1024 },
        { value: '2048x2048', label: '2048x2048 高清', width: 2048, height: 2048 },
        { value: '1792x1008', label: '1792x1008 横屏 16:9', width: 1792, height: 1008 },
        { value: '1536x864', label: '1536x864 横屏 16:9', width: 1536, height: 864 },
        { value: '1344x756', label: '1344x756 横屏 16:9', width: 1344, height: 756 },
        { value: '1280x720', label: '1280x720 横屏 16:9', width: 1280, height: 720 },
        { value: '1344x576', label: '1344x576 超宽 21:9', width: 1344, height: 576 },
        { value: '1792x768', label: '1792x768 超宽 21:9', width: 1792, height: 768 },
        { value: '1080x1920', label: '1080x1920 story maker', width: 1080, height: 1920 },
        { value: '1024x1792', label: '1024x1792', width: 1024, height: 1792 },
        { value: '768x1344', label: '768x1344', width: 768, height: 1344 },
        { value: '720x1280', label: '720x1280', width: 720, height: 1280 },
    ],
    imageWidth: 1024,
    imageHeight: 1024,

    // 付费默认（开发态可在设置中切换）
    defaultIsPaid: false,
};

export function getPlanetMiningConfig(config = CONFIG) {
    const source = config?.planetMining || {};
    return {
        coinPerHour: Math.max(0, Number(source.coinPerHour) || 0),
        maxCoins: Math.max(0, Number(source.maxCoins) || 0),
        hourMs: Math.max(1, Number(source.hourMs) || 60 * 60 * 1000),
        maxScatteredCoins: Math.max(1, Number(source.maxScatteredCoins) || 10),
    };
}

export function currentPlanetMiningHourStart(now = Date.now()) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

export function planetMiningStartHour(gameState, now = Date.now()) {
    const createdAt = Number.isFinite(gameState?.planetCreatedAt) && gameState.planetCreatedAt > 0 ? gameState.planetCreatedAt : now;
    return currentPlanetMiningHourStart(createdAt);
}

export function getPlanetMiningState(gameState, now = Date.now()) {
    const mining = gameState.planetMining && typeof gameState.planetMining === 'object' ? gameState.planetMining : (gameState.planetMining = {});
    if (!Number.isFinite(mining.lastCollectedHourAt) || mining.lastCollectedHourAt <= 0) {
        mining.lastCollectedHourAt = planetMiningStartHour(gameState, now);
    }
    return mining;
}

export function getPlanetMiningGrossCoins(gameState, now = Date.now(), config = CONFIG) {
    const miningConfig = getPlanetMiningConfig(config);
    const mining = getPlanetMiningState(gameState, now);
    const lastHour = currentPlanetMiningHourStart(Number(mining.lastCollectedHourAt) || planetMiningStartHour(gameState, now));
    const currentHour = currentPlanetMiningHourStart(now);
    const elapsedHours = Math.max(0, Math.floor((currentHour - lastHour) / miningConfig.hourMs));
    return Math.min(miningConfig.maxCoins, elapsedHours * miningConfig.coinPerHour);
}

export function getPlanetMiningCoins(gameState, now = Date.now(), config = CONFIG) {
    const mining = getPlanetMiningState(gameState, now);
    const grossCoins = getPlanetMiningGrossCoins(gameState, now, config);
    const fieldCollectedCoins = Math.max(0, Math.min(grossCoins, Math.floor(Number(mining.fieldCollectedCoins) || 0)));
    return Math.max(0, grossCoins - fieldCollectedCoins);
}

export function recordPlanetMiningFieldCollected(gameState, amount, now = Date.now(), config = CONFIG) {
    const reward = Math.max(0, Math.floor(Number(amount) || 0));
    if (reward <= 0) return 0;
    const mining = getPlanetMiningState(gameState, now);
    const grossCoins = getPlanetMiningGrossCoins(gameState, now, config);
    if (grossCoins <= 0) return 0;
    const previous = Math.max(0, Math.min(grossCoins, Math.floor(Number(mining.fieldCollectedCoins) || 0)));
    const collected = Math.min(grossCoins, previous + reward);
    const actual = Math.max(0, collected - previous);
    if (actual <= 0) return 0;
    if (collected >= grossCoins) {
        mining.lastCollectedHourAt = currentPlanetMiningHourStart(now);
        mining.fieldCollectedCoins = 0;
    } else {
        mining.fieldCollectedCoins = collected;
    }
    mining.lastCollectedAt = now;
    return actual;
}

export function getPlanetMiningVisualCoinCount(amount, config = CONFIG) {
    const miningConfig = getPlanetMiningConfig(config);
    const safeAmount = Math.max(0, Number(amount) || 0);
    if (safeAmount <= 0) return 0;
    return Math.max(1, Math.min(miningConfig.maxScatteredCoins, Math.ceil(safeAmount / (Math.max(1, miningConfig.maxCoins) / miningConfig.maxScatteredCoins))));
}

export function normalizeSceneImageSizeOption(option = {}) {
    const value = String(option.value || `${option.width || ''}x${option.height || ''}` || '').trim();
    const [parsedWidth, parsedHeight] = value.split('x').map(Number);
    const width = Number(option.width) || parsedWidth || 1024;
    const height = Number(option.height) || parsedHeight || 1024;
    return {
        value: `${width}x${height}`,
        label: String(option.label || `${width}x${height}`),
        width,
        height,
    };
}

export function getSceneImageSizes(config = CONFIG) {
    const sizes = Array.isArray(config.sceneImageSizes) && config.sceneImageSizes.length
        ? config.sceneImageSizes
        : [{ value: config.defaultSceneImageSize || `${config.imageWidth || 1024}x${config.imageHeight || 1024}`, width: config.imageWidth || 1024, height: config.imageHeight || 1024 }];
    return sizes.map(normalizeSceneImageSizeOption);
}

export function getDefaultSceneImageSize(config = CONFIG, selectedValue = '') {
    const sizes = getSceneImageSizes(config);
    const defaultValue = selectedValue || config.defaultSceneImageSize || `${config.imageWidth || 1024}x${config.imageHeight || 1024}`;
    const configured = sizes.find(item => item.value === defaultValue);
    if (configured) return configured;
    return normalizeSceneImageSizeOption({ value: defaultValue });
}

export function getStageDef(stageId) {
    return CONFIG.stages.find(stage => stage.id === stageId) || null;
}

export function getStageName(stageId, fallback = '') {
    const def = getStageDef(stageId);
    const keyMap = { egg: 'eggBadge', baby: 'stageBaby', teen: 'stageTeen', adult: 'stageAdult', elder: 'stageElder' };
    return keyMap[stageId] ? t(keyMap[stageId]) : (def?.name || fallback || stageId || '');
}

const DEFAULT_SHOP_ITEMS_PATH = 'famous-planets/_default_shopitems.json';

// 商店物品 fallback（主数据在 famous-planets/_default_shopitems.json；保留内置值方便 file:// 或加载失败时启动）
const FALLBACK_SHOP_ITEMS = [
    { id: 'food_basic_feed', name: '原始饲料', emoji: '🌿', price: 0, type: 'food', foodKind: 'both', stat: { hunger: +22 }, unlimited: true, hiddenFromShop: true, moodPenaltyStages: ['teen', 'adult', 'elder'], moodPenalty: -8 },
    { id: 'food_growth_pill', name: '快速长大药丸', emoji: '💊', price: 1000, type: 'food', foodKind: 'both', stat: { hunger: +6, mood: +4 }, specialStageEffect: 'grow' },
    { id: 'food_youth_pill', name: '返老还童药丸', emoji: '🧪', price: 1000, type: 'food', foodKind: 'both', stat: { hunger: +6, mood: +4 }, specialStageEffect: 'rejuvenate' },
];
const FALLBACK_DECO_VISUALS = {
    house_1: { svg: `<svg viewBox="0 0 240 280" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="262" rx="92" ry="12" fill="#3f2415" opacity=".26"/><path d="M30 138 120 56l90 82z" fill="#b45309"/><path d="M120 56 210 138H170L120 86z" fill="#7c2d12" opacity=".55"/><rect x="50" y="138" width="140" height="108" rx="8" fill="#fde68a"/><rect x="50" y="138" width="140" height="108" rx="8" fill="none" stroke="#92400e" stroke-width="6"/><rect x="100" y="170" width="40" height="76" rx="6" fill="#7c2d12"/><circle cx="132" cy="210" r="3" fill="#fde68a"/><rect x="64" y="160" width="28" height="28" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/><rect x="150" y="160" width="28" height="28" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/></svg>` },
};

export const SHOP_ITEMS = [];
export const DECO_VISUALS = {};

let baseShopItems = FALLBACK_SHOP_ITEMS;
let baseDecoVisuals = FALLBACK_DECO_VISUALS;
let SHOP_BY_ID = new Map();
let activeShopItemsPath = DEFAULT_SHOP_ITEMS_PATH;

function cloneJsonValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeShopItemsPayload(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return {
        shopItems: Array.isArray(source.SHOP_ITEMS) ? source.SHOP_ITEMS
            : Array.isArray(source.shopItems) ? source.shopItems
            : Array.isArray(source.items) ? source.items
            : [],
        decoVisuals: source.DECO_VISUALS && typeof source.DECO_VISUALS === 'object' ? source.DECO_VISUALS
            : source.decoVisuals && typeof source.decoVisuals === 'object' ? source.decoVisuals
            : {},
    };
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeJsonObject(base = {}, override = {}) {
    const merged = cloneJsonValue(base || {});
    Object.entries(override || {}).forEach(([key, value]) => {
        if (value === null) {
            delete merged[key];
            return;
        }
        if (isPlainObject(value) && isPlainObject(merged[key])) merged[key] = mergeJsonObject(merged[key], value);
        else merged[key] = cloneJsonValue(value);
    });
    return merged;
}

function mergeShopItems(defaultItems, overrideItems) {
    const order = [];
    const byId = new Map();
    [...(defaultItems || []), ...(overrideItems || [])].forEach(item => {
        const id = String(item?.id || '').trim();
        if (!id) return;
        if (!byId.has(id)) order.push(id);
        const existing = byId.get(id);
        byId.set(id, existing ? mergeJsonObject(existing, { ...item, id }) : cloneJsonValue({ ...item, id }));
    });
    return order.map(id => byId.get(id));
}

function mergeDecoVisuals(defaultVisuals, overrideVisuals) {
    const merged = cloneJsonValue(defaultVisuals || {});
    Object.entries(overrideVisuals || {}).forEach(([id, visual]) => {
        merged[id] = isPlainObject(merged[id]) ? mergeJsonObject(merged[id], visual) : cloneJsonValue(visual);
        if (!merged[id] || !Object.keys(merged[id]).length) delete merged[id];
    });
    return merged;
}

function applyShopData({ shopItems = baseShopItems, decoVisuals = baseDecoVisuals } = {}) {
    SHOP_ITEMS.splice(0, SHOP_ITEMS.length, ...cloneJsonValue(shopItems));
    for (const key of Object.keys(DECO_VISUALS)) delete DECO_VISUALS[key];
    Object.assign(DECO_VISUALS, cloneJsonValue(decoVisuals));
    SHOP_BY_ID = new Map(SHOP_ITEMS.map(item => [item.id, item]));
}

// Base URL of the bundled chunk's parent directory (e.g. .../MagicHaqi/ at dev,
// .../dist/ in the build). Resolved at runtime from a non-static base so Vite
// does NOT statically analyze `new URL('../<path>', import.meta.url)` and slurp
// the whole side-by-side tree into assets/ with content hashes. The referenced
// JSON files are shipped verbatim next to the page, not as hashed assets.
const moduleParentUrl = new URL('..', import.meta.url + '');
function resolveSideBySideUrl(relativePath) {
    return new URL(relativePath, moduleParentUrl).href;
}

export const PLANET_INDEX_PATH = 'famous-planets/_planet_index.json';
export const PLANET_INDEX_URL = resolveSideBySideUrl(PLANET_INDEX_PATH);

let planetIndexCache = null;
let planetIndexLoadPromise = null;

export async function loadPlanetIndex() {
    if (planetIndexCache) return planetIndexCache;
    if (planetIndexLoadPromise) return planetIndexLoadPromise;
    planetIndexLoadPromise = fetch(PLANET_INDEX_URL, { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error(`load ${PLANET_INDEX_PATH} failed: ${res.status}`);
            return res.json();
        })
        .then(data => {
            planetIndexCache = data && typeof data === 'object' ? data : { planets: [] };
            return planetIndexCache;
        })
        .catch(e => {
            console.warn('加载星球索引失败', e);
            planetIndexCache = { planets: [] };
            return planetIndexCache;
        })
        .finally(() => { planetIndexLoadPromise = null; });
    return planetIndexLoadPromise;
}

// 默认主星球（蛋蛋星球）的 id。其完整配置（标题 / 外观 / fields / 新手指引）现在统一
// 由 famous-planets/_planet_index.json 中 id 为 'default' 的条目管理；下面的内置常量仅作
// 为 file:// 或索引加载失败时的兜底。
export const DEFAULT_PLANET_ID = 'default';

// 内置兜底外观（与 _planet_index.json 中 default 条目保持一致）。
export const FALLBACK_DEFAULT_PLANET_STYLE = {
    hue: 188,
    bodyBackground: 'radial-gradient(circle at 32% 22%, rgba(255,255,255,.82) 0%, rgba(255,255,255,.22) 18%, transparent 33%), radial-gradient(circle at 66% 72%, rgba(52,211,153,.36), transparent 34%), radial-gradient(circle at 50% 43%, #a7f3d0 0%, #38bdf8 48%, #2563eb 100%)',
    glowColor: 'rgba(56, 189, 248, 0.58)',
    accentColor: '#38bdf8',
};

function findPlanetEntry(index, id) {
    const entries = Array.isArray(index?.planets) ? index.planets : [];
    const target = String(id || '').trim();
    return entries.find(entry => String(entry?.id || '').trim() === target) || null;
}

/** 取得默认主星球（蛋蛋星球）的索引条目，加载失败时返回 null。 */
export async function getDefaultPlanetEntry() {
    try {
        const index = await loadPlanetIndex();
        return findPlanetEntry(index, DEFAULT_PLANET_ID);
    } catch (_) {
        return null;
    }
}

/** 默认主星球外观；索引中没有 default 条目时回退到内置兜底值。 */
export async function getDefaultPlanetStyle() {
    const entry = await getDefaultPlanetEntry();
    const planet = entry?.planet && typeof entry.planet === 'object' ? entry.planet : {};
    return {
        hue: Number(planet.hue) || FALLBACK_DEFAULT_PLANET_STYLE.hue,
        bodyBackground: String(planet.bodyBackground || '').trim() || FALLBACK_DEFAULT_PLANET_STYLE.bodyBackground,
        glowColor: String(planet.glowColor || '').trim() || FALLBACK_DEFAULT_PLANET_STYLE.glowColor,
        accentColor: String(planet.accentColor || '').trim() || FALLBACK_DEFAULT_PLANET_STYLE.accentColor,
    };
}

// ===== 新手指引（onboarding）配置 =====
// 每个星球索引条目可带一个 onboarding 对象，决定首次进入该星球时的引导方式：
//   { mode: 'pet-story' | 'minigames' | 'none', storyPath?, minigame?, progressKey? }
export const ONBOARDING_MODES = ['pet-story', 'minigames', 'none'];

export function normalizeOnboardingConfig(raw = {}, planetId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    let mode = String(source.mode || '').trim().toLowerCase();
    if (mode === 'story' || mode === 'petstory') mode = 'pet-story';
    if (mode === 'minigame' || mode === 'game' || mode === 'games') mode = 'minigames';
    if (!ONBOARDING_MODES.includes(mode)) mode = 'none';
    const storyPath = String(source.storyPath || source.story || '').trim().replace(/^\/+/, '');
    const minigame = String(source.minigame || source.game || '').trim();
    const progressKey = String(source.progressKey || planetId || '').trim() || String(planetId || '').trim();
    return { mode, storyPath, minigame, progressKey };
}

/** 取得某个星球的新手指引配置；planetIdOrEntry 可传 id 或已解析的条目对象。 */
export async function getPlanetOnboardingConfig(planetIdOrEntry = DEFAULT_PLANET_ID) {
    let entry = planetIdOrEntry && typeof planetIdOrEntry === 'object' ? planetIdOrEntry : null;
    const planetId = entry ? String(entry.id || '').trim() : String(planetIdOrEntry || '').trim();
    if (!entry) {
        try {
            const index = await loadPlanetIndex();
            entry = findPlanetEntry(index, planetId || DEFAULT_PLANET_ID);
        } catch (_) { entry = null; }
    }
    return normalizeOnboardingConfig(entry?.onboarding, planetId || DEFAULT_PLANET_ID);
}

async function fetchShopItemsJson(path, required = false) {
    const url = path.startsWith('famous-planets/') ? resolveSideBySideUrl(path) : path;
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`load ${path} failed: ${res.status}`);
        return await res.json();
    } catch (e) {
        if (required) console.warn('加载商店配置失败', path, e);
        return null;
    }
}

async function initializeDefaultShopItems() {
    const payload = await fetchShopItemsJson(DEFAULT_SHOP_ITEMS_PATH);
    const normalized = normalizeShopItemsPayload(payload || {});
    if (normalized.shopItems.length) baseShopItems = normalized.shopItems;
    if (Object.keys(normalized.decoVisuals).length) baseDecoVisuals = normalized.decoVisuals;
    applyShopData();
}

function normalizeShopItemsPath(path) {
    const text = String(path || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!text) return '';
    if (/^(https?:)?\/\//i.test(text) || text.startsWith('/') || text.startsWith('../')) return text;
    return text.startsWith('famous-planets/') ? text : `famous-planets/${text}`;
}

function planetShopItemsPathCandidates(planetOrId) {
    const planet = planetOrId && typeof planetOrId === 'object' ? planetOrId : null;
    return [planet?.shopItemUrl, planet?.shopItemsFile, planet?.shopitemsFile, planet?.shopFile, planet?.shop_items_file]
        .map(normalizeShopItemsPath)
        .filter(Boolean);
}

export async function loadPlanetShopItems(planetOrId = null) {
    const candidates = planetShopItemsPathCandidates(planetOrId);
    for (const path of candidates) {
        const payload = await fetchShopItemsJson(path);
        if (!payload) continue;
        const normalized = normalizeShopItemsPayload(payload);
        const mergedShopItems = mergeShopItems(baseShopItems, normalized.shopItems);
        const mergedDecoVisuals = mergeDecoVisuals(baseDecoVisuals, normalized.decoVisuals);
        applyShopData({ shopItems: mergedShopItems, decoVisuals: mergedDecoVisuals });
        activeShopItemsPath = path;
        return true;
    }
    applyShopData();
    activeShopItemsPath = DEFAULT_SHOP_ITEMS_PATH;
    return false;
}

export function getShopItemById(id) {
    return SHOP_BY_ID.get(id) || null;
}

export function getShopItemsByType(type) {
    return SHOP_ITEMS.filter(item => item?.type === type);
}

export function getActiveShopItemsPath() {
    return activeShopItemsPath;
}

await initializeDefaultShopItems();

export const OUTDOOR_FIELD_IDS = ['land', 'water', 'sky', 'fire', 'ice', 'life', 'dark', 'thunder'];
const ROOM_AREA_IDS = CONFIG.rooms.map(room => room.id);

export function canPlaceItemInArea(item, area) {
    const fields = Array.isArray(item?.fields) ? item.fields : null;
    if (!fields || fields.length === 0) return true;
    if (fields.includes(area)) return true;
    if (OUTDOOR_FIELD_IDS.includes(area) && (fields.includes('outdoor') || fields.includes('land'))) return true;
    if (ROOM_AREA_IDS.includes(area) && fields.includes('indoor')) return true;
    return OUTDOOR_FIELD_IDS.includes(area) && fields.includes('outdoor');
}

export function getItemZOrder(item) {
    const zorder = Number(item?.zorder);
    return Number.isFinite(zorder) ? zorder : 0;
}

export function getPlacedItemZOrder(placedItem, itemDef) {
    const zorder = Number(placedItem?.zorder);
    return Number.isFinite(zorder) ? zorder : getItemZOrder(itemDef);
}

export function isHouseItem(itemOrId) {
    const def = typeof itemOrId === 'string' ? getShopItemById(itemOrId) : itemOrId;
    return !!(def && def.type === 'house');
}

export function getHouseRoomCount(def) {
    return Array.isArray(def?.rooms) ? def.rooms.length : 0;
}

// 在单个 field layout 中找到房间数最多的房屋。返回 { placed, idx, def, count } 或 null。
export function findLargestHouseInLayout(layout) {
    if (!Array.isArray(layout) || layout.length === 0) return null;
    let best = null;
    layout.forEach((placed, idx) => {
        const def = getShopItemById(placed?.itemId);
        if (!isHouseItem(def)) return;
        const count = getHouseRoomCount(def);
        if (!best || count > best.count || (count === best.count && idx < best.idx)) {
            best = { placed, idx, def, count };
        }
    });
    return best;
}

// 在所有 field_* layouts 中找到房间数最多的房屋（决定 pet 视图解锁哪些房间）
export function findLargestHouseAcrossLayouts(layouts) {
    if (!layouts || typeof layouts !== 'object') return null;
    let best = null;
    for (const [key, items] of Object.entries(layouts)) {
        if (!key.startsWith('field_')) continue;
        const found = findLargestHouseInLayout(items);
        if (!found) continue;
        if (!best || found.count > best.count) {
            best = { ...found, fieldId: key.slice('field_'.length) };
        }
    }
    return best;
}

// 当前激活的房屋所包含的房间 id 列表（pet 视图 dock 用）。无任何房屋时回退到默认 1 间。
export function getActiveHouseRoomIds(layouts) {
    const best = findLargestHouseAcrossLayouts(layouts);
    if (best?.def?.rooms?.length) return [...best.def.rooms];
    const defHouse = getShopItemById(CONFIG.defaultHouseId);
    return defHouse?.rooms ? [...defHouse.rooms] : ['bedroom'];
}

function cdnAsset(relativePath) {
    return `${CDN_ROOT}${relativePath}`;
}

CONFIG.assets.bgSounds = {
    selector: cdnAsset('audio/bgm_selector.mp3'),
    square: cdnAsset('audio/bgm_square.mp3'),
    forest: cdnAsset('audio/bgm_forest.mp3'),
    farm: cdnAsset('audio/bgm_farm.mp3'),
    mountain: cdnAsset('audio/bgm_mountain.mp3'),
    park: cdnAsset('audio/bgm_park.mp3'),
    playground: cdnAsset('audio/bgm_playground.mp3'),
    ship: cdnAsset('audio/bgm_ship.mp3'),
    haqiLoop: cdnAsset('audio/haqi_bgm_loop.mp3'),
};
