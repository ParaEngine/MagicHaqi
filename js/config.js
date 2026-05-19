// 全局常量配置
export const CONFIG = {
    workspace: 'MagicHaqi',
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
        { id: 'elder',  name: '长老', minHours: 168, emoji: '🦄' },
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
        { id: 'land',  name: '陆地', emoji: '🌳', bg: 'linear-gradient(180deg,#bef264 0%,#84cc16 60%,#365314 100%)', favoriteTrait: 'catLike' },
        { id: 'water', name: '水域', emoji: '🌊', bg: 'linear-gradient(180deg,#7dd3fc 0%,#0ea5e9 55%,#0c4a6e 100%)', favoriteTrait: 'fishLike' },
        { id: 'sky',   name: '天空', emoji: '☁️', bg: 'linear-gradient(180deg,#dbeafe 0%,#93c5fd 55%,#3b82f6 100%)', favoriteTrait: 'birdLike' },
    ],

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

    // 房间网格规格（与 CSS 对应）
    gridCols: 8,
    gridRows: 6,

    // memory.md 上限
    memoryMaxBytes: 8 * 1024,
    chatHistoryMaxBytes: 16 * 1024,

    // AI
    // 注意：Seedream 要求 width*height >= 3686400 像素，所以这里至少 2048x2048。
    imageWidth: 2048,
    imageHeight: 2048,

    // 付费默认（开发态可在设置中切换）
    defaultIsPaid: false,
};

export function getStageDef(stageId) {
    return CONFIG.stages.find(stage => stage.id === stageId) || null;
}

export function getStageName(stageId, fallback = '') {
    const def = getStageDef(stageId);
    return def?.name || fallback || stageId || '';
}

// 商店物品（同 assets/data/shop_items.json，但内置一份默认值方便启动）
export const SHOP_ITEMS = [
    { id: 'food_basic_feed', name: '原始饲料', emoji: '🌿', price: 0, type: 'food', foodKind: 'both', stat: { hunger: +22 }, unlimited: true, hiddenFromShop: true, moodPenaltyStages: ['teen', 'adult', 'elder'], moodPenalty: -8 },
    { id: 'food_large_feed', name: '大型饲料', emoji: '🍱', price: 16, type: 'food', foodKind: 'both', stat: { hunger: +45 }, moodPenaltyStages: ['teen', 'adult', 'elder'], moodPenalty: -12 },
    { id: 'food_apple',    name: '红苹果',  emoji: '🍎', price: 5,   type: 'food', foodKind: 'vegetables', stat: { hunger: +15 },           trait: 'fruitLike' },
    { id: 'food_meat',     name: '烤肉',    emoji: '🥩', price: 12,  type: 'food', foodKind: 'meat',       stat: { hunger: +30 },           trait: 'catLike' },
    { id: 'food_cake',     name: '蛋糕',    emoji: '🍰', price: 18,  type: 'food', foodKind: 'vegetables', stat: { hunger: +20, mood: +10 }, trait: 'sweetLike' },
    { id: 'food_cookie',   name: '开心饼干', emoji: '🍪', price: 10,  type: 'food', foodKind: 'both',       stat: { hunger: +8,  mood: +8 } },
    { id: 'food_pudding',  name: '蜂蜜布丁', emoji: '🍮', price: 16,  type: 'food', foodKind: 'both',       stat: { hunger: +12, mood: +14 } },
    { id: 'food_milk',     name: '温牛奶',  emoji: '🥛', price: 14,  type: 'food', foodKind: 'both',       stat: { hunger: +14, mood: +10 } },
    { id: 'food_party',    name: '欢乐套餐', emoji: '🥞', price: 28,  type: 'food', foodKind: 'both',       stat: { hunger: +18, mood: +22, bond: +2 } },
    { id: 'food_carrot',   name: '胡萝卜',  emoji: '🥕', price: 8,   type: 'food', foodKind: 'vegetables', stat: { hunger: +18 }, trait: 'rabbitLike' },
    { id: 'food_fish',     name: '小鱼干',  emoji: '🐟', price: 14,  type: 'food', foodKind: 'meat',       stat: { hunger: +28 }, trait: 'fishLike' },
    { id: 'food_seed',     name: '麦穗',    emoji: '🌾', price: 6,   type: 'food', foodKind: 'vegetables', stat: { hunger: +12, mood: +4 },  trait: 'birdLike' },
    { id: 'food_chili',    name: '火焰椒',  emoji: '🌶️', price: 20,  type: 'food', foodKind: 'vegetables', stat: { hunger: +28 }, trait: 'dragonLike' },
    { id: 'toy_ball',      name: '皮球',    emoji: '⚽', price: 35,  type: 'toy',      stat: { mood: +12 } },
    { id: 'toy_drum',      name: '小鼓',    emoji: '🥁', price: 50,  type: 'toy',      stat: { mood: +14 } },
    { id: 'furn_bed',      name: '小床',    emoji: '🛏️', price: 54,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_sofa',     name: '沙发',    emoji: '🛋️', price: 64,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_lamp',     name: '台灯',    emoji: '💡', price: 24,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_plant',    name: '盆栽',    emoji: '🪴', price: 30,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_tv',       name: '电视',    emoji: '📺', price: 98,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_table',    name: '小桌',    emoji: '🪑', price: 36,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_picture',  name: '装饰画',  emoji: '🖼️', price: 30,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_clock',    name: '挂钟',    emoji: '🕰️', price: 36,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_bath',     name: '浴缸',    emoji: '🛁', price: 76,  type: 'furniture', fields: ['indoor'] },
    { id: 'furn_fridge',   name: '冰箱',    emoji: '🧊', price: 88,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_wardrobe', name: '衣柜',    emoji: '🚪', price: 64,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_bookshelf', name: '书架',   emoji: '📚', price: 64,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_desk',     name: '书桌',    emoji: '🪑', price: 54,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_chair',    name: '椅子',    emoji: '🪑', price: 30,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_rug',      name: '地毯',    emoji: '🟦', price: 36,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_mirror',   name: '镜子',    emoji: '🪞', price: 44,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_window',   name: '窗户',    emoji: '🪟', price: 44,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_door',     name: '小门',    emoji: '🚪', price: 54,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_cabinet',  name: '橱柜',    emoji: '🗄️', price: 54,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_sink',     name: '水槽',    emoji: '🚰', price: 44,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_toilet',   name: '马桶',    emoji: '🚽', price: 64,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_stove',    name: '炉灶',    emoji: '🔥', price: 76,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_microwave', name: '微波炉', emoji: '📦', price: 44,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_curtains', name: '窗帘',    emoji: '🎀', price: 30,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_computer', name: '电脑',    emoji: '💻', price: 98,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_piano',    name: '钢琴',    emoji: '🎹', price: 108, type: 'furniture', fields: ['indoor'] },
    { id: 'deco_vase',     name: '花瓶',    emoji: '🏺', price: 30,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_candle',   name: '蜡烛',    emoji: '🕯️', price: 24,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_nightstand', name: '床头柜', emoji: '🗄️', price: 36, type: 'furniture', fields: ['indoor'] },
    { id: 'deco_dresser',  name: '斗柜',    emoji: '🗄️', price: 54,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_aquarium', name: '鱼缸',    emoji: '🐠', price: 88,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_fireplace', name: '壁炉',   emoji: '🔥', price: 98,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_fan',      name: '风扇',    emoji: '🌀', price: 36,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_aircon',   name: '空调',    emoji: '❄️', price: 76,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_trash_bin', name: '垃圾桶', emoji: '🗑️', price: 18,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_toy_box',  name: '玩具箱',  emoji: '🧸', price: 44,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_beanbag',  name: '懒人沙发', emoji: '🛋️', price: 54, type: 'furniture', fields: ['indoor'] },
    { id: 'deco_floor_mat', name: '脚垫',   emoji: '🟨', price: 24,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_shelf',    name: '置物架',  emoji: '🧺', price: 36,  type: 'furniture', fields: ['indoor'] },
    { id: 'deco_coat_rack', name: '衣帽架', emoji: '🧥', price: 36,  type: 'furniture', fields: ['indoor'] },
    { id: 'bed_pillow',    name: '枕头',    emoji: '🛏️', price: 18,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_blanket',   name: '毛毯',    emoji: '🛌', price: 24,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_alarm_clock', name: '闹钟',  emoji: '⏰', price: 24,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_slippers',  name: '拖鞋',    emoji: '🥿', price: 18,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_laundry_basket', name: '脏衣篮', emoji: '🧺', price: 30, type: 'furniture', fields: ['bedroom', 'bath'] },
    { id: 'kit_counter',   name: '料理台',  emoji: '🥣', price: 64,  type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_cupboard',  name: '碗柜',    emoji: '🍽️', price: 54,  type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_teapot',    name: '茶壶',    emoji: '🫖', price: 24,  type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_cutting_board', name: '砧板', emoji: '🔪', price: 24, type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_dining_set', name: '餐具组', emoji: '🍽️', price: 36,  type: 'furniture', fields: ['kitchen', 'living'] },
    { id: 'bath_towel_rack', name: '毛巾架', emoji: '🧻', price: 30, type: 'furniture', fields: ['bath'] },
    { id: 'bath_shower',   name: '花洒',    emoji: '🚿', price: 54,  type: 'furniture', fields: ['bath'] },
    { id: 'bath_basin',    name: '洗脸盆',  emoji: '🧼', price: 44,  type: 'furniture', fields: ['bath'] },
    { id: 'bath_soap_dish', name: '香皂盒', emoji: '🧼', price: 18,  type: 'furniture', fields: ['bath'] },
    { id: 'bath_scale',    name: '体重秤',  emoji: '⚖️', price: 30,  type: 'furniture', fields: ['bath'] },
    { id: 'living_coffee_table', name: '茶几', emoji: '☕', price: 44, type: 'furniture', fields: ['living'] },
    { id: 'living_books',  name: '书堆',    emoji: '📚', price: 24,  type: 'furniture', fields: ['living', 'bedroom'] },
    { id: 'living_speaker', name: '音箱',   emoji: '🔊', price: 54,  type: 'furniture', fields: ['living'] },
    { id: 'living_floor_lamp', name: '落地灯', emoji: '💡', price: 44, type: 'furniture', fields: ['living', 'bedroom'] },
    { id: 'living_game_console', name: '游戏机', emoji: '🎮', price: 76, type: 'furniture', fields: ['living'] },
    { id: 'garden_bench',  name: '长椅',    emoji: '🪑', price: 54,  type: 'furniture', fields: ['garden'] },
    { id: 'garden_swing',  name: '秋千',    emoji: '🛝', price: 76,  type: 'furniture', fields: ['garden'] },
    { id: 'garden_birdhouse', name: '鸟屋', emoji: '🐦', price: 36,  type: 'furniture', fields: ['garden'] },
    { id: 'garden_watering_can', name: '水壶', emoji: '🚿', price: 24, type: 'furniture', fields: ['garden'] },
    { id: 'garden_path_tiles', name: '小路砖', emoji: '🧱', price: 30, type: 'furniture', fields: ['garden'] },
    { id: 'bed_vanity',    name: '梳妆台',  emoji: '🪞', price: 64,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_canopy',    name: '床幔',    emoji: '🎀', price: 54,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_plush_bear', name: '玩偶熊', emoji: '🧸', price: 30,  type: 'furniture', fields: ['bedroom', 'living'] },
    { id: 'bed_wall_shelf', name: '床边架', emoji: '📚', price: 36,  type: 'furniture', fields: ['bedroom'] },
    { id: 'bed_dream_lamp', name: '梦境灯', emoji: '🌙', price: 36,  type: 'furniture', fields: ['bedroom'] },
    { id: 'kit_pot_rack',  name: '锅具架',  emoji: '🍳', price: 44,  type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_spice_shelf', name: '调料架', emoji: '🧂', price: 30, type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_oven',      name: '烤箱',    emoji: '🔥', price: 76,  type: 'furniture', fields: ['kitchen', 'fire'] },
    { id: 'kit_bar_stool', name: '吧台椅',  emoji: '🪑', price: 36,  type: 'furniture', fields: ['kitchen'] },
    { id: 'kit_fruit_bowl', name: '果盘',   emoji: '🍎', price: 24,  type: 'furniture', fields: ['kitchen', 'living'] },
    { id: 'bath_bath_mat', name: '浴室垫',  emoji: '🟦', price: 24,  type: 'furniture', fields: ['bath'] },
    { id: 'bath_toothbrush_cup', name: '牙刷杯', emoji: '🪥', price: 18, type: 'furniture', fields: ['bath'] },
    { id: 'bath_medicine_cabinet', name: '药柜', emoji: '💊', price: 54, type: 'furniture', fields: ['bath'] },
    { id: 'bath_bubble_tub', name: '泡泡桶', emoji: '🫧', price: 36, type: 'furniture', fields: ['bath'] },
    { id: 'bath_hamper',   name: '浴衣篮',  emoji: '🧺', price: 30,  type: 'furniture', fields: ['bath', 'bedroom'] },
    { id: 'living_plant_stand', name: '花架', emoji: '🪴', price: 44, type: 'furniture', fields: ['living', 'garden'] },
    { id: 'living_wall_art', name: '客厅画', emoji: '🖼️', price: 36, type: 'furniture', fields: ['living'] },
    { id: 'living_pet_cushion', name: '宠物垫', emoji: '🐾', price: 30, type: 'furniture', fields: ['living', 'bedroom'] },
    { id: 'living_magazine_rack', name: '杂志架', emoji: '📰', price: 30, type: 'furniture', fields: ['living'] },
    { id: 'living_projector', name: '投影仪', emoji: '🎬', price: 88, type: 'furniture', fields: ['living'] },
    { id: 'garden_flower_bed', name: '花坛', emoji: '🌷', price: 44, type: 'furniture', fields: ['garden'] },
    { id: 'garden_picnic_table', name: '野餐桌', emoji: '🧺', price: 64, type: 'furniture', fields: ['garden'] },
    { id: 'garden_lantern', name: '庭院灯', emoji: '🏮', price: 36, type: 'furniture', fields: ['garden'] },
    { id: 'garden_fence',  name: '小围栏',  emoji: '🪵', price: 30,  type: 'furniture', fields: ['garden'] },
    { id: 'garden_hammock', name: '吊床',   emoji: '🏕️', price: 64,  type: 'furniture', fields: ['garden'] },
    { id: 'field_flower',  name: '服务站',  emoji: '🏪', price: 44,  type: 'furniture', fields: ['outdoor'], fieldSize: 1.2 },
    { id: 'land_tent',     name: '帐篷',    emoji: '⛺', price: 96,  type: 'house', uniqueItem: true, rooms: ['bedroom'], fields: ['land'], fieldSize: 1.25 },
    { id: 'land_mushroom', name: '医护站',  emoji: '🏥', price: 88,  type: 'furniture', fields: ['land'], fieldSize: 1.45 },
    { id: 'land_stone',    name: '路标站',  emoji: '🪧', price: 36,  type: 'furniture', fields: ['land'], fieldSize: 1.0 },
    { id: 'land_school',   name: '小学校',  emoji: '🏫', price: 88,  type: 'furniture', fields: ['land'], fieldSize: 1.55 },
    { id: 'land_market',   name: '小商店',  emoji: '🏪', price: 64,  type: 'furniture', fields: ['land'], fieldSize: 1.25 },
    { id: 'water_coral',   name: '水上医院', emoji: '🏥', price: 76,  type: 'furniture', fields: ['water'], fieldSize: 1.45 },
    { id: 'water_shell',   name: '小码头',  emoji: '⚓', price: 54,  type: 'furniture', fields: ['water'], fieldSize: 1.0 },
    { id: 'water_fountain', name: '净水站', emoji: '⛲', price: 76,  type: 'furniture', fields: ['water', 'land'], fieldSize: 1.35 },
    { id: 'water_boat',    name: '渡船站',  emoji: '⛴️', price: 64,  type: 'furniture', fields: ['water'], fieldSize: 1.2 },
    { id: 'water_bridge',  name: '小桥',    emoji: '🌉', price: 76,  type: 'furniture', fields: ['water', 'land'], fieldSize: 1.4 },
    { id: 'sky_cloud',     name: '云中小屋', emoji: '🏠', price: 96,  type: 'house', uniqueItem: true, rooms: ['bedroom'], fields: ['sky'], fieldSize: 1.2 },
    { id: 'sky_kite',      name: '信号塔',  emoji: '🗼', price: 54,  type: 'furniture', fields: ['sky'], fieldSize: 1.25 },
    { id: 'sky_balloon',   name: '飞艇港',  emoji: '🚡', price: 64,  type: 'furniture', fields: ['sky'], fieldSize: 1.35 },
    { id: 'sky_windmill',  name: '风车站',  emoji: '🌬️', price: 54,  type: 'furniture', fields: ['sky', 'land'], fieldSize: 1.3 },
    { id: 'fire_volcano',  name: '火山',    emoji: '🌋', price: 0,   type: 'furniture', fields: ['fire'], zorder: -1, remoteOnly: true, fieldSize: 2.4 },
    { id: 'ice_lake',      name: '冰湖',    emoji: '🧊', price: 0,   type: 'furniture', fields: ['ice'], zorder: -1, remoteOnly: true, fieldSize: 2.0 },
    { id: 'life_sand_tree', name: '沙池生命树', emoji: '🏝️', price: 0, type: 'furniture', fields: ['life'], zorder: -1, remoteOnly: true, fieldSize: 2.2 },
    { id: 'dark_underground_caves', name: '地下洞穴', emoji: '🕳️', price: 0, type: 'furniture', fields: ['dark'], zorder: -1, remoteOnly: true, fieldSize: 2.0 },
    // —— 户外房屋（type: 'house'）：uniqueItem 表示放入场景后不消耗背包，重复放置自动移除上一处。 ——
    { id: 'house_1', name: '一间小屋',    emoji: '🏠', price: 0,   type: 'house', fields: ['outdoor'], rooms: ['bedroom'],                                       uniqueItem: true, hiddenFromShop: true, fieldSize: 0.8 },
    { id: 'house_2', name: '双间小屋', emoji: '🏠', price: 140, type: 'house', fields: ['outdoor'], rooms: ['bedroom', 'kitchen'],                            uniqueItem: true, fieldSize: 0.9 },
    { id: 'house_3', name: '三间居所', emoji: '🏡', price: 280, type: 'house', fields: ['outdoor'], rooms: ['bedroom', 'kitchen', 'bath'],                    uniqueItem: true, fieldSize: 1.0 },
    { id: 'house_4', name: '四间宅院', emoji: '🏡', price: 480, type: 'house', fields: ['outdoor'], rooms: ['bedroom', 'kitchen', 'bath', 'living'],          uniqueItem: true, fieldSize: 1.1 },
    { id: 'house_5', name: '五间豪宅', emoji: '🏛️', price: 720, type: 'house', fields: ['outdoor'], rooms: ['bedroom', 'kitchen', 'bath', 'living', 'garden'], uniqueItem: true, fieldSize: 1.2 },
];

export const DECO_VISUALS = {
    furn_bed: { w: 0.16, h: 0.22, svg: `<svg viewBox="0 0 320 210" xmlns="http://www.w3.org/2000/svg"><ellipse cx="166" cy="190" rx="128" ry="14" fill="#164e63" opacity=".24"/><rect x="38" y="82" width="238" height="86" rx="18" fill="#f8fafc"/><rect x="46" y="72" width="74" height="50" rx="12" fill="#bae6fd"/><rect x="126" y="72" width="74" height="50" rx="12" fill="#bfdbfe"/><path d="M28 116h266v70H28z" fill="#38bdf8"/><path d="M28 116c56 28 134 31 266 0v70H28z" fill="#2563eb" opacity=".72"/><rect x="20" y="62" width="32" height="124" rx="10" fill="#7c3f12"/><rect x="276" y="102" width="22" height="84" rx="8" fill="#7c3f12"/></svg>` },
    furn_sofa: { w: 0.18, h: 0.18, svg: `<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="180" cy="195" rx="145" ry="16" fill="#312e81" opacity=".22"/><rect x="38" y="74" width="284" height="98" rx="28" fill="#8b5cf6"/><rect x="22" y="102" width="58" height="78" rx="22" fill="#7c3aed"/><rect x="280" y="102" width="58" height="78" rx="22" fill="#7c3aed"/><rect x="72" y="42" width="216" height="72" rx="18" fill="#a78bfa"/><rect x="86" y="114" width="84" height="48" rx="12" fill="#c4b5fd"/><rect x="190" y="114" width="84" height="48" rx="12" fill="#c4b5fd"/><rect x="92" y="138" width="48" height="34" rx="8" fill="#fde68a"/><rect x="222" y="136" width="42" height="36" rx="8" fill="#fb7185"/></svg>` },
    furn_lamp: { w: 0.08, h: 0.34, svg: `<svg viewBox="0 0 120 360" xmlns="http://www.w3.org/2000/svg"><ellipse cx="60" cy="342" rx="44" ry="10" fill="#0f172a" opacity=".22"/><path d="M28 48h64l-12 82H40z" fill="#facc15"/><ellipse cx="60" cy="48" rx="36" ry="14" fill="#fef3c7"/><ellipse cx="60" cy="98" rx="48" ry="24" fill="#fde68a" opacity=".32"/><rect x="56" y="130" width="8" height="188" rx="4" fill="#4b5563"/><path d="M32 334h56l-10-20H42z" fill="#374151"/></svg>` },
    furn_plant: { w: 0.09, h: 0.28, svg: `<svg viewBox="0 0 150 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="238" rx="50" ry="10" fill="#064e3b" opacity=".2"/><path d="M40 164h72l-12 82H52z" fill="#b45309"/><ellipse cx="76" cy="164" rx="44" ry="14" fill="#92400e"/><path d="M76 168C40 122 31 78 30 44c33 22 50 58 51 112z" fill="#16a34a"/><path d="M76 168c34-50 42-88 39-128-31 20-48 58-45 118z" fill="#22c55e"/><path d="M75 168C62 110 68 62 82 20c22 38 23 88-7 148z" fill="#4ade80"/><path d="M76 168C50 140 42 108 48 82c22 18 34 45 34 78z" fill="#15803d"/></svg>` },
    furn_tv: { w: 0.16, h: 0.2, svg: `<svg viewBox="0 0 340 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="170" cy="224" rx="110" ry="10" fill="#0f172a" opacity=".22"/><rect x="30" y="28" width="280" height="158" rx="18" fill="#111827"/><rect x="46" y="44" width="248" height="126" rx="8" fill="#0ea5e9"/><circle cx="116" cy="98" r="30" fill="#fde68a"/><path d="M46 148c68-54 116-30 154-2 26-34 58-40 94-12v36H46z" fill="#0369a1"/><rect x="154" y="186" width="32" height="28" fill="#1f2937"/><rect x="122" y="212" width="96" height="8" rx="4" fill="#1f2937"/></svg>` },
    furn_table: { w: 0.13, h: 0.18, svg: `<svg viewBox="0 0 260 210" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="190" rx="96" ry="12" fill="#78350f" opacity=".22"/><ellipse cx="130" cy="74" rx="104" ry="42" fill="#d97706"/><ellipse cx="130" cy="62" rx="104" ry="36" fill="#f59e0b"/><rect x="72" y="90" width="14" height="88" rx="6" fill="#92400e"/><rect x="174" y="90" width="14" height="88" rx="6" fill="#92400e"/><circle cx="96" cy="50" r="12" fill="#ef4444"/><path d="M126 54h54v20h-54z" fill="#e0f2fe"/></svg>` },
    furn_picture: { w: 0.1, h: 0.18, svg: `<svg viewBox="0 0 180 220" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="24" width="140" height="170" rx="8" fill="#92400e"/><rect x="32" y="36" width="116" height="146" rx="4" fill="#bae6fd"/><circle cx="112" cy="76" r="18" fill="#fde68a"/><path d="M32 150 74 96l34 42 18-24 22 36v32H32z" fill="#22c55e"/><rect x="46" y="162" width="88" height="8" fill="#166534" opacity=".44"/></svg>` },
    furn_clock: { w: 0.09, h: 0.2, svg: `<svg viewBox="0 0 180 230" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="210" rx="42" ry="9" fill="#451a03" opacity=".2"/><circle cx="90" cy="84" r="62" fill="#f8fafc" stroke="#b45309" stroke-width="14"/><circle cx="90" cy="84" r="5" fill="#1f2937"/><path d="M90 84V46M90 84l32 18" stroke="#1f2937" stroke-width="8" stroke-linecap="round"/><path d="M68 142h44l16 58H52z" fill="#92400e"/><circle cx="90" cy="170" r="12" fill="#facc15"/></svg>` },
    furn_bath: { w: 0.16, h: 0.2, svg: `<svg viewBox="0 0 330 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="168" cy="196" rx="128" ry="13" fill="#075985" opacity=".18"/><path d="M38 90h252v44c0 38-30 68-68 68H106c-38 0-68-30-68-68z" fill="#e0f2fe"/><path d="M54 98h220v28c0 25-20 45-45 45H99c-25 0-45-20-45-45z" fill="#7dd3fc" opacity=".74"/><circle cx="82" cy="70" r="10" fill="#bae6fd"/><circle cx="110" cy="48" r="14" fill="#dff7ff"/><path d="M246 88V56c0-14 11-24 25-24h10" fill="none" stroke="#64748b" stroke-width="10" stroke-linecap="round"/><rect x="70" y="194" width="28" height="10" rx="4" fill="#64748b"/><rect x="232" y="194" width="28" height="10" rx="4" fill="#64748b"/></svg>` },
    furn_fridge: { w: 0.1, h: 0.32, svg: `<svg viewBox="0 0 170 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="84" cy="304" rx="48" ry="9" fill="#0f172a" opacity=".18"/><rect x="38" y="20" width="96" height="276" rx="16" fill="#e0f7ff" stroke="#38bdf8" stroke-width="6"/><path d="M38 122h96" stroke="#38bdf8" stroke-width="6"/><rect x="112" y="62" width="8" height="36" rx="4" fill="#0ea5e9"/><rect x="112" y="154" width="8" height="58" rx="4" fill="#0ea5e9"/><circle cx="68" cy="70" r="13" fill="#fde68a"/><path d="M58 226h52" stroke="#bae6fd" stroke-width="10" stroke-linecap="round"/></svg>` },
    deco_wardrobe: { w: 0.12, h: 0.34, svg: `<svg viewBox="0 0 190 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="96" cy="302" rx="62" ry="9" fill="#451a03" opacity=".18"/><rect x="36" y="24" width="118" height="268" rx="14" fill="#b45309"/><path d="M95 30v254" stroke="#7c2d12" stroke-width="7"/><rect x="50" y="48" width="32" height="76" rx="6" fill="#d97706"/><rect x="108" y="48" width="32" height="76" rx="6" fill="#d97706"/><circle cx="82" cy="162" r="6" fill="#fde68a"/><circle cx="108" cy="162" r="6" fill="#fde68a"/></svg>` },
    deco_bookshelf: { w: 0.13, h: 0.32, svg: `<svg viewBox="0 0 210 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="106" cy="302" rx="72" ry="9" fill="#451a03" opacity=".18"/><rect x="32" y="28" width="148" height="264" rx="12" fill="#92400e"/><path d="M46 96h120M46 166h120M46 236h120" stroke="#451a03" stroke-width="8"/><g><rect x="52" y="52" width="18" height="42" fill="#38bdf8"/><rect x="76" y="44" width="16" height="50" fill="#f97316"/><rect x="104" y="54" width="22" height="40" fill="#22c55e"/><rect x="132" y="46" width="18" height="48" fill="#a78bfa"/><rect x="58" y="118" width="24" height="46" fill="#fde047"/><rect x="94" y="112" width="18" height="52" fill="#fb7185"/><rect x="124" y="124" width="28" height="40" fill="#60a5fa"/></g></svg>` },
    deco_desk: { w: 0.16, h: 0.18, svg: `<svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="182" rx="104" ry="12" fill="#78350f" opacity=".2"/><rect x="36" y="68" width="208" height="42" rx="12" fill="#d97706"/><rect x="54" y="108" width="22" height="66" rx="7" fill="#92400e"/><rect x="204" y="108" width="22" height="66" rx="7" fill="#92400e"/><rect x="108" y="24" width="72" height="44" rx="8" fill="#dbeafe"/><path d="M92 70h96" stroke="#78350f" stroke-width="8" stroke-linecap="round"/></svg>` },
    deco_chair: { w: 0.09, h: 0.22, svg: `<svg viewBox="0 0 160 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="82" cy="204" rx="54" ry="8" fill="#78350f" opacity=".18"/><rect x="50" y="42" width="62" height="76" rx="12" fill="#f59e0b"/><rect x="42" y="116" width="78" height="28" rx="10" fill="#d97706"/><path d="M54 144v48M108 144v48" stroke="#92400e" stroke-width="12" stroke-linecap="round"/></svg>` },
    deco_rug: { w: 0.2, h: 0.08, svg: `<svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg"><ellipse cx="160" cy="64" rx="136" ry="44" fill="#2563eb"/><ellipse cx="160" cy="64" rx="96" ry="28" fill="#38bdf8"/><path d="M56 32h208M56 96h208" stroke="#dbeafe" stroke-width="8" stroke-linecap="round" opacity=".7"/><path d="M32 44h-18M32 64h-18M32 84h-18M288 44h18M288 64h18M288 84h18" stroke="#1d4ed8" stroke-width="6" stroke-linecap="round"/></svg>` },
    deco_mirror: { w: 0.09, h: 0.24, svg: `<svg viewBox="0 0 160 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="80" cy="238" rx="42" ry="8" fill="#0f172a" opacity=".16"/><ellipse cx="80" cy="98" rx="48" ry="72" fill="#e0f2fe" stroke="#f59e0b" stroke-width="12"/><path d="M58 66c16-18 38-24 58-18" stroke="#bae6fd" stroke-width="10" stroke-linecap="round"/><rect x="74" y="170" width="12" height="52" rx="6" fill="#92400e"/><path d="M48 232h64" stroke="#92400e" stroke-width="12" stroke-linecap="round"/></svg>` },
    deco_window: { w: 0.12, h: 0.22, svg: `<svg viewBox="0 0 210 240" xmlns="http://www.w3.org/2000/svg"><rect x="36" y="34" width="138" height="150" rx="12" fill="#bae6fd" stroke="#92400e" stroke-width="12"/><path d="M105 40v138M42 110h126" stroke="#92400e" stroke-width="9"/><circle cx="78" cy="78" r="18" fill="#fde68a"/><path d="M44 162c38-34 74-28 116 0" fill="#38bdf8" opacity=".7"/><path d="M28 198h154" stroke="#7c2d12" stroke-width="14" stroke-linecap="round"/></svg>` },
    deco_door: { w: 0.1, h: 0.32, svg: `<svg viewBox="0 0 170 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="86" cy="304" rx="56" ry="8" fill="#451a03" opacity=".18"/><rect x="40" y="30" width="94" height="260" rx="18" fill="#92400e"/><rect x="54" y="48" width="66" height="224" rx="10" fill="#b45309"/><circle cx="106" cy="164" r="7" fill="#fde68a"/><path d="M40 290h100" stroke="#451a03" stroke-width="10" stroke-linecap="round"/></svg>` },
    deco_cabinet: { w: 0.14, h: 0.22, svg: `<svg viewBox="0 0 240 230" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="212" rx="82" ry="9" fill="#451a03" opacity=".18"/><rect x="34" y="48" width="172" height="146" rx="14" fill="#d97706"/><path d="M120 54v132M42 112h156" stroke="#92400e" stroke-width="8"/><circle cx="98" cy="88" r="6" fill="#fde68a"/><circle cx="142" cy="88" r="6" fill="#fde68a"/><circle cx="98" cy="148" r="6" fill="#fde68a"/><circle cx="142" cy="148" r="6" fill="#fde68a"/></svg>` },
    deco_sink: { w: 0.14, h: 0.18, svg: `<svg viewBox="0 0 240 190" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="174" rx="82" ry="8" fill="#075985" opacity=".16"/><rect x="42" y="82" width="156" height="58" rx="20" fill="#e0f2fe"/><ellipse cx="120" cy="90" rx="58" ry="20" fill="#7dd3fc" opacity=".75"/><path d="M120 78V44c0-16 14-26 30-20" fill="none" stroke="#64748b" stroke-width="10" stroke-linecap="round"/><circle cx="154" cy="62" r="7" fill="#38bdf8"/><path d="M68 140v26M172 140v26" stroke="#64748b" stroke-width="10" stroke-linecap="round"/></svg>` },
    deco_toilet: { w: 0.12, h: 0.2, svg: `<svg viewBox="0 0 210 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="202" rx="66" ry="9" fill="#075985" opacity=".16"/><rect x="54" y="38" width="96" height="56" rx="14" fill="#e0f2fe"/><path d="M70 90h84v48c0 28-22 50-50 50S54 166 54 138V90z" fill="#f8fafc"/><ellipse cx="104" cy="96" rx="48" ry="18" fill="#7dd3fc" opacity=".55"/><path d="M78 186h64" stroke="#94a3b8" stroke-width="12" stroke-linecap="round"/></svg>` },
    deco_stove: { w: 0.14, h: 0.22, svg: `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="222" rx="82" ry="9" fill="#111827" opacity=".18"/><rect x="42" y="50" width="156" height="152" rx="14" fill="#374151"/><rect x="56" y="112" width="128" height="74" rx="10" fill="#111827"/><circle cx="82" cy="82" r="14" fill="#0f172a"/><circle cx="124" cy="82" r="14" fill="#0f172a"/><circle cx="164" cy="82" r="14" fill="#0f172a"/><path d="M120 158c-8-20 16-28 8-50 28 24 28 44 8 66z" fill="#f97316"/><path d="M132 158c-4-12 8-18 6-34 14 14 16 24 6 38z" fill="#fde047"/></svg>` },
    deco_microwave: { w: 0.13, h: 0.12, svg: `<svg viewBox="0 0 230 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="116" cy="134" rx="78" ry="8" fill="#0f172a" opacity=".16"/><rect x="26" y="32" width="178" height="88" rx="14" fill="#64748b"/><rect x="44" y="48" width="104" height="54" rx="8" fill="#dbeafe"/><rect x="162" y="50" width="24" height="10" rx="5" fill="#22c55e"/><circle cx="174" cy="82" r="13" fill="#94a3b8"/><path d="M70 76h48" stroke="#93c5fd" stroke-width="8" stroke-linecap="round"/></svg>` },
    deco_curtains: { w: 0.14, h: 0.24, svg: `<svg viewBox="0 0 240 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="238" rx="76" ry="8" fill="#7f1d1d" opacity=".16"/><path d="M32 40h176" stroke="#7c2d12" stroke-width="12" stroke-linecap="round"/><path d="M42 50c24 36 28 96 10 166h62c-22-62-18-124 6-166z" fill="#fb7185"/><path d="M120 50c24 42 24 100 4 166h62c-18-64-14-126 12-166z" fill="#f43f5e"/><path d="M62 84c18 22 30 22 48 0M136 92c18 18 30 18 48 0" stroke="#fecdd3" stroke-width="7" stroke-linecap="round" opacity=".8"/></svg>` },
    deco_computer: { w: 0.14, h: 0.18, svg: `<svg viewBox="0 0 240 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="184" rx="82" ry="8" fill="#0f172a" opacity=".16"/><rect x="42" y="24" width="156" height="100" rx="12" fill="#111827"/><rect x="56" y="38" width="128" height="72" rx="6" fill="#38bdf8"/><path d="M110 124h20v30h-20z" fill="#374151"/><rect x="76" y="154" width="88" height="10" rx="5" fill="#374151"/><rect x="70" y="170" width="100" height="12" rx="6" fill="#64748b"/></svg>` },
    deco_piano: { w: 0.18, h: 0.22, svg: `<svg viewBox="0 0 300 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="220" rx="104" ry="10" fill="#111827" opacity=".2"/><path d="M52 76c24-42 122-56 190 2v82H52z" fill="#111827"/><rect x="70" y="136" width="156" height="34" rx="6" fill="#f8fafc"/><path d="M92 136v34M116 136v34M140 136v34M164 136v34M188 136v34" stroke="#111827" stroke-width="4"/><path d="M104 136v20M152 136v20M200 136v20" stroke="#111827" stroke-width="9"/><path d="M76 170v38M218 164v44" stroke="#111827" stroke-width="12" stroke-linecap="round"/></svg>` },
    deco_vase: { w: 0.08, h: 0.2, svg: `<svg viewBox="0 0 150 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="202" rx="44" ry="8" fill="#7c2d12" opacity=".16"/><path d="M76 92v-50" stroke="#16a34a" stroke-width="7" stroke-linecap="round"/><circle cx="54" cy="42" r="16" fill="#fb7185"/><circle cx="78" cy="28" r="16" fill="#f472b6"/><circle cx="100" cy="46" r="16" fill="#fda4af"/><path d="M50 98h52l16 92H34z" fill="#38bdf8"/><ellipse cx="76" cy="98" rx="34" ry="12" fill="#7dd3fc"/></svg>` },
    deco_candle: { w: 0.06, h: 0.18, svg: `<svg viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="60" cy="184" rx="38" ry="8" fill="#7c2d12" opacity=".16"/><path d="M60 62c-20-20 8-30 2-58 26 24 32 42 10 62z" fill="#f97316"/><path d="M66 62c-8-10 4-18 2-32 12 12 14 22 6 34z" fill="#fde047"/><rect x="42" y="70" width="36" height="100" rx="10" fill="#fef3c7"/><path d="M42 102h36" stroke="#fde68a" stroke-width="7"/></svg>` },
    deco_nightstand: { w: 0.09, h: 0.16, svg: `<svg viewBox="0 0 160 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="80" cy="164" rx="54" ry="8" fill="#451a03" opacity=".18"/><rect x="40" y="48" width="80" height="96" rx="12" fill="#d97706"/><path d="M48 92h64" stroke="#92400e" stroke-width="7"/><circle cx="80" cy="72" r="6" fill="#fde68a"/><circle cx="80" cy="116" r="6" fill="#fde68a"/><path d="M54 144v14M106 144v14" stroke="#92400e" stroke-width="8" stroke-linecap="round"/></svg>` },
    deco_dresser: { w: 0.14, h: 0.2, svg: `<svg viewBox="0 0 240 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="204" rx="82" ry="8" fill="#451a03" opacity=".18"/><rect x="42" y="42" width="156" height="144" rx="14" fill="#b45309"/><path d="M52 84h136M52 126h136" stroke="#7c2d12" stroke-width="8"/><circle cx="96" cy="64" r="6" fill="#fde68a"/><circle cx="144" cy="64" r="6" fill="#fde68a"/><circle cx="96" cy="106" r="6" fill="#fde68a"/><circle cx="144" cy="106" r="6" fill="#fde68a"/><circle cx="96" cy="148" r="6" fill="#fde68a"/><circle cx="144" cy="148" r="6" fill="#fde68a"/></svg>` },
    deco_aquarium: { w: 0.16, h: 0.16, svg: `<svg viewBox="0 0 280 190" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="174" rx="98" ry="8" fill="#075985" opacity=".16"/><rect x="34" y="32" width="212" height="118" rx="16" fill="#bae6fd" stroke="#0ea5e9" stroke-width="8"/><path d="M42 116c52-30 96-14 146-30 20-6 36-4 52 6v50H42z" fill="#38bdf8" opacity=".68"/><path d="M90 90c22-18 42-18 64 0-22 18-42 18-64 0z" fill="#f97316"/><circle cx="142" cy="88" r="4" fill="#111827"/><path d="M70 130c10-18 12-30 4-44" stroke="#22c55e" stroke-width="7" stroke-linecap="round"/></svg>` },
    deco_fireplace: { w: 0.16, h: 0.22, svg: `<svg viewBox="0 0 280 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="220" rx="98" ry="10" fill="#451a03" opacity=".22"/><rect x="42" y="42" width="196" height="162" rx="14" fill="#92400e"/><rect x="72" y="82" width="136" height="106" rx="48" fill="#111827"/><path d="M128 176c-22-34 24-46 10-92 46 38 54 70 18 98z" fill="#f97316"/><path d="M152 174c-10-20 14-28 8-54 24 22 28 40 10 58z" fill="#fde047"/><path d="M78 198h124" stroke="#7c2d12" stroke-width="12" stroke-linecap="round"/></svg>` },
    deco_fan: { w: 0.11, h: 0.26, svg: `<svg viewBox="0 0 200 270" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="252" rx="58" ry="8" fill="#0f172a" opacity=".16"/><circle cx="100" cy="84" r="58" fill="#e0f2fe" stroke="#64748b" stroke-width="8"/><path d="M100 84c-8-38 30-52 48-28-20 6-26 18-48 28zM100 84c36 12 36 52 6 62 6-20-2-32-6-62zM100 84c-28 26-62 8-58-24 14 16 28 16 58 24z" fill="#93c5fd"/><circle cx="100" cy="84" r="10" fill="#64748b"/><rect x="94" y="144" width="12" height="84" rx="6" fill="#64748b"/><path d="M62 244h76" stroke="#64748b" stroke-width="12" stroke-linecap="round"/></svg>` },
    deco_aircon: { w: 0.16, h: 0.1, svg: `<svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="124" rx="96" ry="7" fill="#0f172a" opacity=".12"/><rect x="34" y="28" width="212" height="68" rx="18" fill="#f8fafc" stroke="#93c5fd" stroke-width="6"/><path d="M62 76h154" stroke="#bfdbfe" stroke-width="8" stroke-linecap="round"/><path d="M86 98c-10 10-10 20 0 30M132 98c-10 10-10 20 0 30M178 98c-10 10-10 20 0 30" stroke="#38bdf8" stroke-width="6" stroke-linecap="round"/><circle cx="220" cy="50" r="7" fill="#22c55e"/></svg>` },
    deco_trash_bin: { w: 0.08, h: 0.18, svg: `<svg viewBox="0 0 150 190" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="174" rx="44" ry="8" fill="#0f172a" opacity=".16"/><path d="M42 56h68l-10 106H52z" fill="#94a3b8"/><path d="M36 54h80" stroke="#64748b" stroke-width="10" stroke-linecap="round"/><path d="M58 36h36" stroke="#64748b" stroke-width="9" stroke-linecap="round"/><path d="M64 78v58M86 78v58" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/></svg>` },
    deco_toy_box: { w: 0.14, h: 0.15, svg: `<svg viewBox="0 0 240 170" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="154" rx="82" ry="8" fill="#78350f" opacity=".16"/><rect x="42" y="64" width="156" height="70" rx="12" fill="#f97316"/><path d="M54 56h132l14 30H40z" fill="#fb923c"/><circle cx="84" cy="42" r="16" fill="#38bdf8"/><path d="M128 52l18-26 18 26z" fill="#22c55e"/><rect x="92" y="88" width="56" height="20" rx="6" fill="#fde68a"/></svg>` },
    deco_beanbag: { w: 0.14, h: 0.14, svg: `<svg viewBox="0 0 240 170" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="150" rx="88" ry="10" fill="#7f1d1d" opacity=".16"/><path d="M56 132c-8-54 24-98 68-104 48-7 84 34 66 104-20 20-106 20-134 0z" fill="#fb7185"/><path d="M92 52c30-18 66-10 84 18" stroke="#fecdd3" stroke-width="9" stroke-linecap="round" opacity=".7"/><path d="M64 130c38 18 88 18 126 0" stroke="#be123c" stroke-width="8" stroke-linecap="round" opacity=".35"/></svg>` },
    deco_floor_mat: { w: 0.16, h: 0.06, svg: `<svg viewBox="0 0 260 90" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="52" rx="108" ry="28" fill="#facc15"/><path d="M54 52h152" stroke="#fef3c7" stroke-width="12" stroke-linecap="round"/><path d="M42 30h176M42 72h176" stroke="#d97706" stroke-width="6" stroke-linecap="round" opacity=".45"/></svg>` },
    deco_shelf: { w: 0.13, h: 0.22, svg: `<svg viewBox="0 0 220 230" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="212" rx="74" ry="8" fill="#451a03" opacity=".16"/><path d="M44 58h132M44 120h132M44 182h132" stroke="#92400e" stroke-width="14" stroke-linecap="round"/><path d="M56 58v124M164 58v124" stroke="#7c2d12" stroke-width="9" stroke-linecap="round"/><rect x="70" y="84" width="34" height="28" rx="6" fill="#38bdf8"/><circle cx="136" cy="96" r="16" fill="#fde047"/><rect x="88" y="144" width="62" height="30" rx="8" fill="#22c55e"/></svg>` },
    deco_coat_rack: { w: 0.08, h: 0.28, svg: `<svg viewBox="0 0 150 280" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="262" rx="48" ry="8" fill="#451a03" opacity=".16"/><path d="M76 48v190" stroke="#92400e" stroke-width="12" stroke-linecap="round"/><path d="M76 78 42 112M76 92l34 34M76 126 42 152M76 140l36 28" stroke="#92400e" stroke-width="9" stroke-linecap="round"/><path d="M50 120c24 2 36 18 36 44H44c0-18 2-32 6-44z" fill="#38bdf8"/><path d="M100 142c20 8 28 24 22 48H84c0-18 4-34 16-48z" fill="#fb7185"/><path d="M42 250h68" stroke="#92400e" stroke-width="12" stroke-linecap="round"/></svg>` },
    bed_pillow: { w: 0.1, h: 0.08, svg: `<svg viewBox="0 0 180 110" xmlns="http://www.w3.org/2000/svg"><ellipse cx="90" cy="94" rx="58" ry="7" fill="#0f172a" opacity=".12"/><rect x="30" y="28" width="120" height="52" rx="22" fill="#dbeafe"/><path d="M48 44c28-14 58-14 84 0" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/></svg>` },
    bed_blanket: { w: 0.16, h: 0.1, svg: `<svg viewBox="0 0 260 130" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="112" rx="86" ry="8" fill="#312e81" opacity=".16"/><path d="M42 42h176c18 0 28 14 22 30l-14 40H34l-12-40c-5-16 4-30 20-30z" fill="#8b5cf6"/><path d="M52 70h166M68 96h128" stroke="#c4b5fd" stroke-width="8" stroke-linecap="round"/></svg>` },
    bed_alarm_clock: { w: 0.08, h: 0.14, svg: `<svg viewBox="0 0 140 160" xmlns="http://www.w3.org/2000/svg"><ellipse cx="70" cy="146" rx="42" ry="6" fill="#0f172a" opacity=".14"/><circle cx="70" cy="82" r="42" fill="#f8fafc" stroke="#ef4444" stroke-width="10"/><path d="M70 82V56M70 82l20 12" stroke="#1f2937" stroke-width="7" stroke-linecap="round"/><circle cx="42" cy="32" r="16" fill="#fca5a5"/><circle cx="98" cy="32" r="16" fill="#fca5a5"/><path d="M48 124l-12 18M92 124l12 18" stroke="#374151" stroke-width="7" stroke-linecap="round"/></svg>` },
    bed_slippers: { w: 0.12, h: 0.08, svg: `<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="94" rx="64" ry="7" fill="#7f1d1d" opacity=".14"/><path d="M42 82c0-34 18-56 42-56 12 22 8 46-2 64H50c-5 0-8-3-8-8z" fill="#fb7185"/><path d="M108 82c0-34 18-56 42-56 12 22 8 46-2 64h-32c-5 0-8-3-8-8z" fill="#f43f5e"/><path d="M56 54h28M122 54h28" stroke="#fecdd3" stroke-width="7" stroke-linecap="round"/></svg>` },
    bed_laundry_basket: { w: 0.11, h: 0.16, svg: `<svg viewBox="0 0 190 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="96" cy="164" rx="58" ry="7" fill="#78350f" opacity=".14"/><path d="M46 66h98l-16 84H62z" fill="#d97706"/><ellipse cx="96" cy="66" rx="54" ry="18" fill="#f59e0b"/><path d="M66 48c8-28 52-28 60 0" fill="none" stroke="#92400e" stroke-width="8" stroke-linecap="round"/><path d="M70 92h52M64 120h64" stroke="#fde68a" stroke-width="7" stroke-linecap="round"/></svg>` },
    kit_counter: { w: 0.18, h: 0.18, svg: `<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="184" rx="104" ry="8" fill="#451a03" opacity=".16"/><rect x="36" y="76" width="228" height="86" rx="12" fill="#d97706"/><rect x="50" y="96" width="58" height="54" rx="8" fill="#f59e0b"/><rect x="122" y="96" width="58" height="54" rx="8" fill="#f59e0b"/><rect x="194" y="96" width="58" height="54" rx="8" fill="#f59e0b"/><path d="M24 76h252" stroke="#e5e7eb" stroke-width="16" stroke-linecap="round"/><ellipse cx="88" cy="58" rx="26" ry="10" fill="#7dd3fc"/></svg>` },
    kit_cupboard: { w: 0.13, h: 0.28, svg: `<svg viewBox="0 0 220 280" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="262" rx="70" ry="8" fill="#451a03" opacity=".16"/><rect x="38" y="34" width="144" height="210" rx="14" fill="#b45309"/><path d="M110 42v194M48 116h124" stroke="#7c2d12" stroke-width="8"/><circle cx="88" cy="82" r="6" fill="#fde68a"/><circle cx="132" cy="82" r="6" fill="#fde68a"/><path d="M70 158h80M78 188h64" stroke="#fef3c7" stroke-width="9" stroke-linecap="round"/></svg>` },
    kit_teapot: { w: 0.1, h: 0.12, svg: `<svg viewBox="0 0 180 140" xmlns="http://www.w3.org/2000/svg"><ellipse cx="92" cy="124" rx="52" ry="7" fill="#7c2d12" opacity=".14"/><path d="M50 62c0-24 20-42 46-42s46 18 46 42c0 30-22 48-46 48S50 92 50 62z" fill="#f97316"/><path d="M136 62c28-8 38 22 8 28" fill="none" stroke="#f97316" stroke-width="12" stroke-linecap="round"/><path d="M48 64 18 50c8 32 22 44 38 42" fill="#fb923c"/><path d="M78 20c4-18 34-18 38 0" fill="none" stroke="#7c2d12" stroke-width="7" stroke-linecap="round"/></svg>` },
    kit_cutting_board: { w: 0.12, h: 0.08, svg: `<svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="94" rx="66" ry="7" fill="#78350f" opacity=".14"/><rect x="36" y="28" width="106" height="56" rx="14" fill="#d97706"/><circle cx="56" cy="56" r="7" fill="#92400e"/><path d="M126 26l42 42" stroke="#64748b" stroke-width="8" stroke-linecap="round"/><path d="M150 48l18-18" stroke="#cbd5e1" stroke-width="10" stroke-linecap="round"/></svg>` },
    kit_dining_set: { w: 0.13, h: 0.09, svg: `<svg viewBox="0 0 220 120" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="104" rx="72" ry="7" fill="#0f172a" opacity=".12"/><circle cx="90" cy="58" r="34" fill="#f8fafc" stroke="#94a3b8" stroke-width="7"/><circle cx="90" cy="58" r="16" fill="#e0f2fe"/><path d="M144 26v62M160 26v62M144 54h16" stroke="#64748b" stroke-width="7" stroke-linecap="round"/><path d="M178 30c16 18 16 38 0 56" fill="none" stroke="#64748b" stroke-width="7" stroke-linecap="round"/></svg>` },
    bath_towel_rack: { w: 0.13, h: 0.16, svg: `<svg viewBox="0 0 220 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="164" rx="70" ry="7" fill="#075985" opacity=".12"/><path d="M36 42h148" stroke="#64748b" stroke-width="10" stroke-linecap="round"/><path d="M62 50h96v90c-28 18-68 18-96 0z" fill="#38bdf8"/><path d="M80 74h60M80 102h60" stroke="#bae6fd" stroke-width="7" stroke-linecap="round"/></svg>` },
    bath_shower: { w: 0.12, h: 0.24, svg: `<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="242" rx="58" ry="7" fill="#075985" opacity=".12"/><path d="M64 66V42c0-20 16-32 36-32h28" fill="none" stroke="#64748b" stroke-width="10" stroke-linecap="round"/><path d="M118 48c30 4 46 20 50 48H90c2-28 12-44 28-48z" fill="#94a3b8"/><path d="M92 118v26M120 118v32M148 118v26M76 156v24M164 156v24" stroke="#38bdf8" stroke-width="7" stroke-linecap="round"/></svg>` },
    bath_basin: { w: 0.13, h: 0.14, svg: `<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="144" rx="70" ry="7" fill="#075985" opacity=".12"/><path d="M44 62h132v24c0 32-26 58-58 58H102c-32 0-58-26-58-58z" fill="#e0f2fe"/><ellipse cx="110" cy="64" rx="60" ry="20" fill="#7dd3fc" opacity=".72"/><path d="M110 56V28c0-14 12-22 26-18" fill="none" stroke="#64748b" stroke-width="9" stroke-linecap="round"/></svg>` },
    bath_soap_dish: { w: 0.08, h: 0.08, svg: `<svg viewBox="0 0 150 100" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="84" rx="46" ry="7" fill="#075985" opacity=".12"/><ellipse cx="76" cy="58" rx="52" ry="20" fill="#bae6fd"/><rect x="44" y="36" width="64" height="28" rx="14" fill="#fef3c7"/><path d="M54 50h44" stroke="#fde68a" stroke-width="6" stroke-linecap="round"/></svg>` },
    bath_scale: { w: 0.1, h: 0.08, svg: `<svg viewBox="0 0 170 110" xmlns="http://www.w3.org/2000/svg"><ellipse cx="86" cy="94" rx="52" ry="7" fill="#0f172a" opacity=".12"/><rect x="38" y="28" width="96" height="58" rx="18" fill="#e0f2fe" stroke="#94a3b8" stroke-width="7"/><path d="M68 52c10-12 26-12 36 0" fill="none" stroke="#38bdf8" stroke-width="7" stroke-linecap="round"/><circle cx="86" cy="52" r="5" fill="#64748b"/></svg>` },
    living_coffee_table: { w: 0.15, h: 0.12, svg: `<svg viewBox="0 0 250 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="125" cy="134" rx="86" ry="8" fill="#78350f" opacity=".16"/><ellipse cx="125" cy="58" rx="92" ry="30" fill="#f59e0b"/><ellipse cx="125" cy="50" rx="92" ry="24" fill="#fbbf24"/><path d="M76 76v48M174 76v48" stroke="#92400e" stroke-width="11" stroke-linecap="round"/><circle cx="118" cy="46" r="10" fill="#f8fafc"/><path d="M136 46h24" stroke="#f8fafc" stroke-width="9" stroke-linecap="round"/></svg>` },
    living_books: { w: 0.1, h: 0.1, svg: `<svg viewBox="0 0 170 130" xmlns="http://www.w3.org/2000/svg"><ellipse cx="86" cy="114" rx="54" ry="7" fill="#0f172a" opacity=".12"/><rect x="38" y="70" width="96" height="20" rx="5" fill="#38bdf8"/><rect x="48" y="50" width="90" height="20" rx="5" fill="#f97316"/><rect x="32" y="30" width="98" height="20" rx="5" fill="#22c55e"/><path d="M54 40h54M66 60h54M52 80h64" stroke="#f8fafc" stroke-width="4" opacity=".7"/></svg>` },
    living_speaker: { w: 0.08, h: 0.22, svg: `<svg viewBox="0 0 150 230" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="212" rx="44" ry="7" fill="#0f172a" opacity=".16"/><rect x="42" y="30" width="68" height="166" rx="14" fill="#1f2937"/><circle cx="76" cy="78" r="20" fill="#64748b"/><circle cx="76" cy="142" r="28" fill="#64748b"/><circle cx="76" cy="142" r="12" fill="#111827"/><path d="M112 76c18 18 18 48 0 66" stroke="#38bdf8" stroke-width="6" stroke-linecap="round" fill="none"/></svg>` },
    living_floor_lamp: { w: 0.09, h: 0.32, svg: `<svg viewBox="0 0 160 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="80" cy="302" rx="50" ry="8" fill="#0f172a" opacity=".14"/><path d="M42 54h76l-14 80H56z" fill="#fde047"/><ellipse cx="80" cy="54" rx="44" ry="14" fill="#fef3c7"/><rect x="74" y="134" width="12" height="138" rx="6" fill="#64748b"/><path d="M44 292h72" stroke="#64748b" stroke-width="14" stroke-linecap="round"/><ellipse cx="80" cy="98" rx="54" ry="22" fill="#fde68a" opacity=".3"/></svg>` },
    living_game_console: { w: 0.12, h: 0.09, svg: `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="104" rx="66" ry="7" fill="#0f172a" opacity=".14"/><path d="M48 46c18-18 86-18 104 0l20 36c5 10-3 22-14 18l-34-14H76l-34 14c-11 4-19-8-14-18z" fill="#374151"/><path d="M66 68h28M80 54v28" stroke="#f8fafc" stroke-width="6" stroke-linecap="round"/><circle cx="132" cy="66" r="7" fill="#38bdf8"/><circle cx="154" cy="66" r="7" fill="#fb7185"/></svg>` },
    garden_bench: { w: 0.16, h: 0.16, svg: `<svg viewBox="0 0 260 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="164" rx="88" ry="8" fill="#14532d" opacity=".16"/><path d="M44 70h172M54 104h152" stroke="#92400e" stroke-width="16" stroke-linecap="round"/><path d="M66 48v90M194 48v90" stroke="#7c2d12" stroke-width="9" stroke-linecap="round"/><path d="M74 122v34M186 122v34" stroke="#451a03" stroke-width="10" stroke-linecap="round"/></svg>` },
    garden_swing: { w: 0.16, h: 0.24, svg: `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="242" rx="88" ry="8" fill="#14532d" opacity=".16"/><path d="M42 232 130 28l88 204" fill="none" stroke="#92400e" stroke-width="12" stroke-linecap="round"/><path d="M78 72h104" stroke="#92400e" stroke-width="10" stroke-linecap="round"/><path d="M100 78v92M160 78v92" stroke="#64748b" stroke-width="6" stroke-linecap="round"/><rect x="82" y="166" width="96" height="24" rx="8" fill="#f59e0b"/></svg>` },
    garden_birdhouse: { w: 0.09, h: 0.24, svg: `<svg viewBox="0 0 160 250" xmlns="http://www.w3.org/2000/svg"><ellipse cx="80" cy="232" rx="44" ry="7" fill="#14532d" opacity=".16"/><path d="M34 86 80 42l46 44z" fill="#ef4444"/><rect x="44" y="84" width="72" height="70" rx="8" fill="#f59e0b"/><circle cx="80" cy="114" r="14" fill="#451a03"/><path d="M80 154v62" stroke="#92400e" stroke-width="9" stroke-linecap="round"/><path d="M48 216h64" stroke="#92400e" stroke-width="10" stroke-linecap="round"/></svg>` },
    garden_watering_can: { w: 0.12, h: 0.12, svg: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg"><ellipse cx="98" cy="124" rx="60" ry="7" fill="#075985" opacity=".14"/><path d="M44 58h86c16 0 28 12 28 28v20H44z" fill="#38bdf8"/><path d="M130 64c20-34 54-22 44 20" fill="none" stroke="#0ea5e9" stroke-width="10" stroke-linecap="round"/><path d="M44 64 12 48c10 28 22 40 40 42" fill="#7dd3fc"/><path d="M34 48c10-22 54-22 64 0" fill="none" stroke="#0ea5e9" stroke-width="8" stroke-linecap="round"/></svg>` },
    garden_path_tiles: { w: 0.18, h: 0.08, svg: `<svg viewBox="0 0 280 110" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="94" rx="98" ry="7" fill="#14532d" opacity=".14"/><rect x="38" y="38" width="46" height="30" rx="8" fill="#cbd5e1"/><rect x="96" y="28" width="52" height="34" rx="8" fill="#94a3b8"/><rect x="160" y="42" width="48" height="30" rx="8" fill="#cbd5e1"/><rect x="218" y="30" width="36" height="28" rx="8" fill="#94a3b8"/><path d="M52 78h178" stroke="#64748b" stroke-width="6" stroke-linecap="round" opacity=".25"/></svg>` },
    bed_vanity: { w: 0.14, h: 0.24, svg: `<svg viewBox="0 0 230 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="116" cy="242" rx="76" ry="8" fill="#451a03" opacity=".16"/><ellipse cx="116" cy="70" rx="42" ry="44" fill="#e0f2fe" stroke="#d97706" stroke-width="10"/><rect x="50" y="114" width="132" height="74" rx="12" fill="#f59e0b"/><path d="M64 142h104" stroke="#92400e" stroke-width="7"/><circle cx="116" cy="164" r="6" fill="#fde68a"/><path d="M72 188v38M160 188v38" stroke="#92400e" stroke-width="10" stroke-linecap="round"/></svg>` },
    bed_canopy: { w: 0.18, h: 0.28, svg: `<svg viewBox="0 0 290 300" xmlns="http://www.w3.org/2000/svg"><ellipse cx="145" cy="282" rx="96" ry="8" fill="#7f1d1d" opacity=".14"/><path d="M54 50h182" stroke="#be123c" stroke-width="12" stroke-linecap="round"/><path d="M70 56c34 56 28 134 0 204h58c-16-70-12-148 17-204z" fill="#fb7185" opacity=".9"/><path d="M145 56c30 58 34 134 17 204h58c-28-70-34-148 0-204z" fill="#f472b6" opacity=".88"/><path d="M94 86c28 20 74 20 102 0" stroke="#fecdd3" stroke-width="8" stroke-linecap="round"/></svg>` },
    bed_plush_bear: { w: 0.1, h: 0.16, svg: `<svg viewBox="0 0 170 190" xmlns="http://www.w3.org/2000/svg"><ellipse cx="86" cy="174" rx="52" ry="7" fill="#78350f" opacity=".14"/><circle cx="58" cy="54" r="20" fill="#b45309"/><circle cx="114" cy="54" r="20" fill="#b45309"/><circle cx="86" cy="82" r="42" fill="#d97706"/><ellipse cx="86" cy="132" rx="48" ry="42" fill="#f59e0b"/><circle cx="72" cy="76" r="5" fill="#111827"/><circle cx="100" cy="76" r="5" fill="#111827"/><ellipse cx="86" cy="92" rx="12" ry="8" fill="#78350f"/></svg>` },
    bed_wall_shelf: { w: 0.14, h: 0.16, svg: `<svg viewBox="0 0 230 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="116" cy="164" rx="72" ry="7" fill="#451a03" opacity=".12"/><path d="M42 70h146M54 122h122" stroke="#92400e" stroke-width="13" stroke-linecap="round"/><path d="M58 70v52M172 70v52" stroke="#7c2d12" stroke-width="8"/><rect x="72" y="38" width="18" height="30" fill="#38bdf8"/><rect x="98" y="32" width="16" height="36" fill="#fb7185"/><circle cx="142" cy="52" r="15" fill="#fde047"/><rect x="86" y="94" width="56" height="22" rx="6" fill="#22c55e"/></svg>` },
    bed_dream_lamp: { w: 0.08, h: 0.2, svg: `<svg viewBox="0 0 140 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="70" cy="204" rx="42" ry="7" fill="#312e81" opacity=".14"/><path d="M70 40c-22 24-20 62 8 78-36 0-58-24-58-54 0-28 20-50 50-54z" fill="#fde047"/><circle cx="100" cy="50" r="5" fill="#dbeafe"/><circle cx="112" cy="80" r="4" fill="#dbeafe"/><rect x="64" y="118" width="12" height="58" rx="6" fill="#64748b"/><path d="M42 194h56" stroke="#64748b" stroke-width="12" stroke-linecap="round"/></svg>` },
    kit_pot_rack: { w: 0.15, h: 0.18, svg: `<svg viewBox="0 0 250 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="126" cy="184" rx="80" ry="7" fill="#451a03" opacity=".12"/><path d="M42 42h166" stroke="#64748b" stroke-width="10" stroke-linecap="round"/><path d="M78 48v38M126 48v38M174 48v38" stroke="#64748b" stroke-width="6"/><ellipse cx="78" cy="108" rx="28" ry="18" fill="#94a3b8"/><path d="M98 108h20" stroke="#94a3b8" stroke-width="10" stroke-linecap="round"/><path d="M116 92h54v44h-54z" fill="#f97316"/><circle cx="126" cy="74" r="12" fill="#f59e0b"/></svg>` },
    kit_spice_shelf: { w: 0.13, h: 0.14, svg: `<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="144" rx="70" ry="7" fill="#451a03" opacity=".12"/><path d="M42 110h136" stroke="#92400e" stroke-width="13" stroke-linecap="round"/><rect x="58" y="52" width="28" height="54" rx="7" fill="#fde68a"/><rect x="96" y="42" width="28" height="64" rx="7" fill="#fb7185"/><rect x="134" y="58" width="28" height="48" rx="7" fill="#22c55e"/><path d="M62 66h20M100 58h20M138 72h20" stroke="#f8fafc" stroke-width="5" stroke-linecap="round"/></svg>` },
    kit_oven: { w: 0.14, h: 0.2, svg: `<svg viewBox="0 0 240 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="204" rx="78" ry="7" fill="#111827" opacity=".14"/><rect x="48" y="42" width="144" height="146" rx="14" fill="#4b5563"/><rect x="64" y="86" width="112" height="76" rx="10" fill="#111827"/><path d="M82 124h76" stroke="#f97316" stroke-width="9" stroke-linecap="round"/><circle cx="78" cy="64" r="7" fill="#cbd5e1"/><circle cx="110" cy="64" r="7" fill="#cbd5e1"/><circle cx="142" cy="64" r="7" fill="#cbd5e1"/></svg>` },
    kit_bar_stool: { w: 0.08, h: 0.2, svg: `<svg viewBox="0 0 140 210" xmlns="http://www.w3.org/2000/svg"><ellipse cx="70" cy="194" rx="42" ry="7" fill="#78350f" opacity=".14"/><ellipse cx="70" cy="50" rx="42" ry="18" fill="#f59e0b"/><path d="M54 66v96M86 66v96M46 118h48" stroke="#92400e" stroke-width="9" stroke-linecap="round"/><path d="M40 180h60" stroke="#92400e" stroke-width="10" stroke-linecap="round"/></svg>` },
    kit_fruit_bowl: { w: 0.11, h: 0.1, svg: `<svg viewBox="0 0 190 120" xmlns="http://www.w3.org/2000/svg"><ellipse cx="96" cy="104" rx="58" ry="7" fill="#78350f" opacity=".14"/><circle cx="70" cy="48" r="18" fill="#ef4444"/><circle cx="98" cy="38" r="18" fill="#facc15"/><circle cx="122" cy="50" r="18" fill="#22c55e"/><path d="M42 58h108c-4 34-26 48-54 48S48 92 42 58z" fill="#f59e0b"/><path d="M58 78h76" stroke="#fde68a" stroke-width="7" stroke-linecap="round"/></svg>` },
    bath_bath_mat: { w: 0.14, h: 0.06, svg: `<svg viewBox="0 0 230 90" xmlns="http://www.w3.org/2000/svg"><ellipse cx="116" cy="52" rx="86" ry="26" fill="#38bdf8"/><path d="M54 52h124" stroke="#bae6fd" stroke-width="10" stroke-linecap="round"/><path d="M44 32h146M44 72h146" stroke="#0ea5e9" stroke-width="5" stroke-linecap="round" opacity=".45"/></svg>` },
    bath_toothbrush_cup: { w: 0.07, h: 0.14, svg: `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="60" cy="134" rx="34" ry="6" fill="#075985" opacity=".12"/><path d="M42 62h36l-6 60H48z" fill="#7dd3fc"/><ellipse cx="60" cy="62" rx="22" ry="8" fill="#bae6fd"/><path d="M48 58 40 18M60 58 60 12M72 58 84 20" stroke="#f8fafc" stroke-width="7" stroke-linecap="round"/><path d="M36 18h16M52 12h16M80 20h16" stroke="#fb7185" stroke-width="6" stroke-linecap="round"/></svg>` },
    bath_medicine_cabinet: { w: 0.12, h: 0.2, svg: `<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="204" rx="60" ry="7" fill="#0f172a" opacity=".12"/><rect x="44" y="34" width="112" height="146" rx="12" fill="#e0f2fe" stroke="#94a3b8" stroke-width="8"/><path d="M100 50v112M64 106h72" stroke="#cbd5e1" stroke-width="7"/><path d="M88 78h24v16h16v24h-16v16H88v-16H72V94h16z" fill="#ef4444"/></svg>` },
    bath_bubble_tub: { w: 0.12, h: 0.13, svg: `<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="134" rx="66" ry="7" fill="#075985" opacity=".12"/><path d="M36 72h128v24c0 26-22 46-48 46H84c-26 0-48-20-48-46z" fill="#e0f2fe"/><path d="M54 82h92" stroke="#7dd3fc" stroke-width="14" stroke-linecap="round" opacity=".8"/><circle cx="66" cy="48" r="10" fill="#f8fafc"/><circle cx="94" cy="36" r="13" fill="#dff7ff"/><circle cx="122" cy="50" r="9" fill="#f8fafc"/></svg>` },
    bath_hamper: { w: 0.1, h: 0.16, svg: `<svg viewBox="0 0 170 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="86" cy="164" rx="52" ry="7" fill="#78350f" opacity=".14"/><path d="M44 62h84l-12 88H56z" fill="#c4b5fd"/><ellipse cx="86" cy="62" rx="46" ry="16" fill="#a78bfa"/><path d="M62 44c8-26 40-26 48 0" fill="none" stroke="#7c3aed" stroke-width="7" stroke-linecap="round"/><path d="M62 92h48M58 120h56" stroke="#ede9fe" stroke-width="7" stroke-linecap="round"/></svg>` },
    living_plant_stand: { w: 0.09, h: 0.26, svg: `<svg viewBox="0 0 150 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="242" rx="44" ry="7" fill="#14532d" opacity=".14"/><path d="M76 118c-36-32-34-64-14-88 22 20 28 50 14 88z" fill="#22c55e"/><path d="M76 118c34-36 54-52 46-86-30 12-48 38-46 86z" fill="#16a34a"/><path d="M46 118h60l-10 44H56z" fill="#f59e0b"/><path d="M58 162v58M94 162v58M48 210h58" stroke="#92400e" stroke-width="8" stroke-linecap="round"/></svg>` },
    living_wall_art: { w: 0.12, h: 0.18, svg: `<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="204" rx="58" ry="7" fill="#451a03" opacity=".12"/><rect x="32" y="32" width="136" height="146" rx="8" fill="#92400e"/><rect x="44" y="44" width="112" height="122" rx="5" fill="#dbeafe"/><circle cx="120" cy="76" r="16" fill="#fde047"/><path d="M44 146 78 102l30 34 18-22 30 40v12H44z" fill="#22c55e"/><path d="M62 158h76" stroke="#166534" stroke-width="6" opacity=".45"/></svg>` },
    living_pet_cushion: { w: 0.13, h: 0.08, svg: `<svg viewBox="0 0 220 110" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="94" rx="72" ry="7" fill="#7f1d1d" opacity=".14"/><path d="M42 72c0-30 28-48 68-48s68 18 68 48c0 18-136 18-136 0z" fill="#fb7185"/><circle cx="86" cy="56" r="8" fill="#fecdd3"/><circle cx="110" cy="48" r="8" fill="#fecdd3"/><circle cx="134" cy="56" r="8" fill="#fecdd3"/><ellipse cx="110" cy="70" rx="18" ry="10" fill="#fecdd3"/></svg>` },
    living_magazine_rack: { w: 0.1, h: 0.16, svg: `<svg viewBox="0 0 170 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="86" cy="164" rx="52" ry="7" fill="#451a03" opacity=".14"/><path d="M44 62h84l-12 88H56z" fill="#92400e"/><path d="M58 46l26 72M92 42l26 76" stroke="#f8fafc" stroke-width="18" stroke-linecap="round"/><path d="M58 70h24M96 68h22" stroke="#38bdf8" stroke-width="5" stroke-linecap="round"/><path d="M56 132h60" stroke="#d97706" stroke-width="8" stroke-linecap="round"/></svg>` },
    living_projector: { w: 0.12, h: 0.1, svg: `<svg viewBox="0 0 200 130" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="114" rx="62" ry="7" fill="#0f172a" opacity=".14"/><rect x="42" y="42" width="92" height="44" rx="10" fill="#374151"/><circle cx="134" cy="64" r="24" fill="#111827"/><circle cx="134" cy="64" r="12" fill="#38bdf8"/><path d="M42 88h118" stroke="#64748b" stroke-width="8" stroke-linecap="round"/><path d="M72 34h34" stroke="#cbd5e1" stroke-width="7" stroke-linecap="round"/></svg>` },
    garden_flower_bed: { w: 0.16, h: 0.1, svg: `<svg viewBox="0 0 260 130" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="112" rx="88" ry="8" fill="#14532d" opacity=".14"/><path d="M44 80c42-26 128-26 172 0v32H44z" fill="#92400e"/><g fill="#fb7185"><circle cx="74" cy="54" r="12"/><circle cx="116" cy="42" r="12"/><circle cx="158" cy="54" r="12"/><circle cx="198" cy="46" r="12"/></g><path d="M74 66v28M116 54v40M158 66v28M198 58v36" stroke="#22c55e" stroke-width="6" stroke-linecap="round"/></svg>` },
    garden_picnic_table: { w: 0.17, h: 0.14, svg: `<svg viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="144" rx="94" ry="7" fill="#14532d" opacity=".14"/><path d="M70 62h140" stroke="#d97706" stroke-width="16" stroke-linecap="round"/><path d="M52 96h176" stroke="#92400e" stroke-width="12" stroke-linecap="round"/><path d="M94 70 64 132M186 70l30 62M112 70 88 132M168 70l24 62" stroke="#7c2d12" stroke-width="8" stroke-linecap="round"/></svg>` },
    garden_lantern: { w: 0.08, h: 0.22, svg: `<svg viewBox="0 0 140 230" xmlns="http://www.w3.org/2000/svg"><ellipse cx="70" cy="214" rx="42" ry="7" fill="#451a03" opacity=".14"/><path d="M70 38v144" stroke="#92400e" stroke-width="9" stroke-linecap="round"/><path d="M46 74h48l10 56H36z" fill="#f97316"/><ellipse cx="70" cy="74" rx="30" ry="10" fill="#fde68a"/><path d="M54 92h32M52 116h36" stroke="#fed7aa" stroke-width="6" stroke-linecap="round"/><path d="M42 198h56" stroke="#92400e" stroke-width="11" stroke-linecap="round"/></svg>` },
    garden_fence: { w: 0.18, h: 0.12, svg: `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="134" rx="96" ry="7" fill="#14532d" opacity=".14"/><path d="M36 78h208M36 116h208" stroke="#92400e" stroke-width="10" stroke-linecap="round"/><path d="M58 42v86M106 36v92M154 42v86M202 36v92" stroke="#b45309" stroke-width="16" stroke-linecap="round"/><path d="M58 42l-10 18h20zM106 36 96 56h20zM154 42l-10 18h20zM202 36l-10 20h20z" fill="#d97706"/></svg>` },
    garden_hammock: { w: 0.18, h: 0.18, svg: `<svg viewBox="0 0 290 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="145" cy="184" rx="98" ry="7" fill="#14532d" opacity=".14"/><path d="M44 166 72 36M246 166 218 36" stroke="#92400e" stroke-width="12" stroke-linecap="round"/><path d="M72 70c44 64 102 64 146 0" fill="none" stroke="#38bdf8" stroke-width="18" stroke-linecap="round"/><path d="M90 86c34 28 76 28 110 0" stroke="#bae6fd" stroke-width="7" stroke-linecap="round"/><path d="M36 176h54M200 176h54" stroke="#92400e" stroke-width="10" stroke-linecap="round"/></svg>` },
    field_flower: { w: 0.08, h: 0.18, svg: `<svg viewBox="0 0 150 190" xmlns="http://www.w3.org/2000/svg"><ellipse cx="76" cy="174" rx="42" ry="8" fill="#166534" opacity=".18"/><path d="M76 88v72" stroke="#16a34a" stroke-width="8" stroke-linecap="round"/><path d="M76 132c-28-28-42-16-50 4 20 6 36 3 50-4zM76 126c30-24 44-10 48 12-21 4-35 0-48-12z" fill="#22c55e"/><g fill="#fb7185"><circle cx="76" cy="62" r="18"/><circle cx="54" cy="74" r="18"/><circle cx="98" cy="74" r="18"/><circle cx="62" cy="46" r="18"/><circle cx="90" cy="46" r="18"/></g><circle cx="76" cy="62" r="14" fill="#fde047"/></svg>` },
    land_tent: { w: 0.16, h: 0.22, svg: `<svg viewBox="0 0 300 230" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="206" rx="112" ry="13" fill="#78350f" opacity=".2"/><path d="M32 196 150 34l118 162z" fill="#f97316"/><path d="M150 34v162H32z" fill="#fb923c"/><path d="M150 84 96 196h108z" fill="#7c2d12"/><path d="M150 84v112h54z" fill="#431407" opacity=".55"/><path d="M22 196h256" stroke="#451a03" stroke-width="8" stroke-linecap="round"/></svg>` },
    land_mushroom: { w: 0.11, h: 0.22, svg: `<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="220" rx="58" ry="10" fill="#7f1d1d" opacity=".18"/><path d="M75 104h50l18 106H57z" fill="#fef3c7"/><path d="M24 112C40 42 78 20 102 20c44 0 76 38 86 92z" fill="#ef4444"/><circle cx="78" cy="62" r="15" fill="#fee2e2"/><circle cx="124" cy="72" r="18" fill="#fee2e2"/><circle cx="54" cy="100" r="12" fill="#fee2e2"/><circle cx="154" cy="104" r="13" fill="#fee2e2"/></svg>` },
    land_stone: { w: 0.11, h: 0.12, svg: `<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="126" rx="82" ry="12" fill="#334155" opacity=".2"/><path d="M32 116c2-42 32-74 74-82 46-9 78 18 88 58 7 29-18 44-68 44H68c-20 0-37-7-36-20z" fill="#94a3b8"/><path d="M70 52c28-13 67-8 88 22" stroke="#cbd5e1" stroke-width="8" stroke-linecap="round" opacity=".56"/></svg>` },
    water_coral: { w: 0.12, h: 0.22, svg: `<svg viewBox="0 0 220 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="220" rx="74" ry="10" fill="#075985" opacity=".2"/><path d="M110 206V80M110 126C76 96 56 74 56 44M110 150c42-20 60-48 60-88M90 176c-34-6-56-22-66-48M130 188c34-4 56-20 68-48" stroke="#fb7185" stroke-width="18" stroke-linecap="round"/><path d="M110 206V112M110 142c25-18 36-38 36-60" stroke="#f43f5e" stroke-width="10" stroke-linecap="round"/></svg>` },
    water_shell: { w: 0.11, h: 0.12, svg: `<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="128" rx="80" ry="10" fill="#075985" opacity=".18"/><path d="M36 116C44 54 78 24 112 24c42 0 70 34 74 92z" fill="#fde68a"/><path d="M112 28v88M78 42l34 74M146 42l-34 74M54 82l58 34M170 82l-58 34" stroke="#f59e0b" stroke-width="7" stroke-linecap="round" opacity=".72"/><path d="M34 116h154" stroke="#92400e" stroke-width="8" stroke-linecap="round"/></svg>` },
    water_fountain: { w: 0.15, h: 0.24, svg: `<svg viewBox="0 0 280 260" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="232" rx="104" ry="14" fill="#075985" opacity=".18"/><path d="M78 188h124l-18 48H96z" fill="#94a3b8"/><ellipse cx="140" cy="184" rx="78" ry="28" fill="#cbd5e1"/><ellipse cx="140" cy="176" rx="62" ry="18" fill="#7dd3fc"/><path d="M140 170V86" stroke="#38bdf8" stroke-width="12" stroke-linecap="round"/><path d="M140 92c-42 18-58 42-58 70M140 92c42 18 58 42 58 70M140 78c-20 12-30 30-30 52M140 78c20 12 30 30 30 52" fill="none" stroke="#bae6fd" stroke-width="8" stroke-linecap="round"/><circle cx="140" cy="78" r="18" fill="#e0f2fe"/></svg>` },
    water_boat: { w: 0.16, h: 0.16, svg: `<svg viewBox="0 0 300 190" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="168" rx="112" ry="10" fill="#075985" opacity=".2"/><path d="M42 116h216c-16 42-50 58-108 58S58 158 42 116z" fill="#92400e"/><path d="M150 26v92" stroke="#7c2d12" stroke-width="8" stroke-linecap="round"/><path d="M156 36c54 20 80 48 92 80h-92z" fill="#fde68a"/><path d="M144 46c-38 18-58 42-72 70h72z" fill="#fef3c7"/></svg>` },
    sky_cloud: { w: 0.14, h: 0.12, svg: `<svg viewBox="0 0 260 150" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="126" rx="86" ry="10" fill="#1d4ed8" opacity=".12"/><path d="M56 112c-26 0-38-16-38-34s16-34 38-34c11-24 36-36 62-28 17-17 48-10 58 16 28-4 52 16 52 42 0 23-18 38-44 38z" fill="#f8fafc"/><path d="M60 108h128" stroke="#dbeafe" stroke-width="10" stroke-linecap="round" opacity=".72"/></svg>` },
    sky_kite: { w: 0.12, h: 0.22, svg: `<svg viewBox="0 0 220 240" xmlns="http://www.w3.org/2000/svg"><path d="M110 20 176 90 110 160 44 90z" fill="#38bdf8"/><path d="M110 20v140L44 90z" fill="#facc15" opacity=".84"/><path d="M110 20v140M44 90h132" stroke="#0f172a" stroke-width="4" opacity=".36"/><path d="M110 160c-4 26 28 28 12 56-8 14-30 10-24-8" fill="none" stroke="#64748b" stroke-width="5" stroke-linecap="round"/><path d="M94 190l-18 14M124 198l18 14" stroke="#fb7185" stroke-width="5" stroke-linecap="round"/></svg>` },
    sky_balloon: { w: 0.12, h: 0.28, svg: `<svg viewBox="0 0 220 300" xmlns="http://www.w3.org/2000/svg"><ellipse cx="110" cy="282" rx="48" ry="8" fill="#7c2d12" opacity=".18"/><path d="M110 24c48 0 78 36 78 84 0 54-42 96-78 116-36-20-78-62-78-116 0-48 30-84 78-84z" fill="#ef4444"/><path d="M110 24v196" stroke="#fef2f2" stroke-width="12" opacity=".35"/><path d="M78 224l-16 42M142 224l16 42" stroke="#78350f" stroke-width="5"/><rect x="78" y="254" width="64" height="30" rx="8" fill="#b45309"/></svg>` },
    sky_windmill: { w: 0.12, h: 0.3, svg: `<svg viewBox="0 0 230 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="116" cy="300" rx="62" ry="10" fill="#78350f" opacity=".18"/><path d="M78 150h76l18 140H60z" fill="#fef3c7"/><path d="M70 150h92l-18-38H88z" fill="#b45309"/><circle cx="116" cy="104" r="12" fill="#92400e"/><path d="M116 104 116 28M116 104 190 104M116 104 116 180M116 104 42 104" stroke="#38bdf8" stroke-width="14" stroke-linecap="round"/><circle cx="116" cy="104" r="8" fill="#facc15"/></svg>` },
    fire_volcano: { w: 0.18, h: 0.28, svg: `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="278" rx="112" ry="12" fill="#431407" opacity=".28"/><path d="M34 274 118 76c10-24 54-24 64 0l84 198z" fill="#7f1d1d"/><path d="M96 274 134 108c4-17 28-17 32 0l38 166z" fill="#b45309"/><path d="M130 86h40l-12 30h-16z" fill="#f97316"/><path d="M134 76c-10-22 20-34 12-62 28 24 38 46 20 72z" fill="#f97316"/><path d="M152 74c-4-12 12-18 10-34 15 16 19 28 8 44z" fill="#fde047"/></svg>` },
    ice_lake: { w: 0.18, h: 0.14, svg: `<svg viewBox="0 0 300 180" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="116" rx="116" ry="48" fill="#7dd3fc"/><ellipse cx="150" cy="106" rx="88" ry="30" fill="#e0f7ff"/><path d="M78 108h52M144 92h66M116 126h98" stroke="#38bdf8" stroke-width="6" stroke-linecap="round" opacity=".7"/><path d="M58 130c42 28 142 28 184 0" stroke="#0ea5e9" stroke-width="10" opacity=".25"/></svg>` },
    life_sand_tree: { w: 0.18, h: 0.3, svg: `<svg viewBox="0 0 300 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="298" rx="116" ry="13" fill="#a16207" opacity=".2"/><path d="M48 292c32-54 158-62 210-4-52 18-144 20-210 4z" fill="#fde68a"/><path d="M150 268c-8-74 6-138 22-210" stroke="#92400e" stroke-width="18" stroke-linecap="round"/><path d="M162 116c-44-52-90-44-118-6 42 30 88 34 118 6z" fill="#65a30d"/><path d="M160 150c56-56 104-40 128 6-46 28-98 26-128-6z" fill="#84cc16"/><path d="M156 88c38-44 88-36 112 2-34 30-84 34-112-2z" fill="#bef264"/><circle cx="154" cy="130" r="16" fill="#facc15" opacity=".86"/></svg>` },
    dark_underground_caves: { w: 0.18, h: 0.22, svg: `<svg viewBox="0 0 300 240" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="216" rx="116" ry="14" fill="#030712" opacity=".4"/><path d="M34 214c18-104 214-104 232 0z" fill="#374151"/><path d="M92 212c12-52 104-54 118 0z" fill="#030712"/><path d="M72 140 102 58l24 76 34-102 32 104 32-70" fill="none" stroke="#9ca3af" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/><circle cx="230" cy="74" r="10" fill="#d1d5db"/><circle cx="238" cy="70" r="10" fill="#374151"/></svg>` },
    // —— Houses (outdoor) ——
    house_1: { w: 0.16, h: 0.22, svg: `<svg viewBox="0 0 240 280" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="262" rx="92" ry="12" fill="#3f2415" opacity=".26"/><path d="M30 138 120 56l90 82z" fill="#b45309"/><path d="M120 56 210 138H170L120 86z" fill="#7c2d12" opacity=".55"/><rect x="50" y="138" width="140" height="108" rx="8" fill="#fde68a"/><rect x="50" y="138" width="140" height="108" rx="8" fill="none" stroke="#92400e" stroke-width="6"/><rect x="100" y="170" width="40" height="76" rx="6" fill="#7c2d12"/><circle cx="132" cy="210" r="3" fill="#fde68a"/><rect x="64" y="160" width="28" height="28" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/><rect x="150" y="160" width="28" height="28" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/></svg>` },
    house_2: { w: 0.2, h: 0.24, svg: `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><ellipse cx="150" cy="282" rx="120" ry="13" fill="#3f2415" opacity=".26"/><rect x="200" y="80" width="22" height="60" fill="#7c2d12"/><path d="M196 60h30l-6 22h-18z" fill="#9ca3af"/><path d="M30 156 150 60l120 96z" fill="#be123c"/><path d="M150 60 270 156H226L150 96z" fill="#7f1d1d" opacity=".5"/><rect x="40" y="156" width="220" height="106" rx="8" fill="#fef3c7"/><rect x="40" y="156" width="220" height="106" rx="8" fill="none" stroke="#92400e" stroke-width="6"/><path d="M150 156v106" stroke="#92400e" stroke-width="4" opacity=".5"/><rect x="64" y="178" width="56" height="36" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/><rect x="180" y="178" width="56" height="36" rx="4" fill="#fde047" stroke="#b45309" stroke-width="3"/><path d="M180 196h56M208 178v36" stroke="#b45309" stroke-width="2"/><rect x="124" y="220" width="52" height="42" rx="4" fill="#7c2d12"/><circle cx="166" cy="244" r="3" fill="#fde68a"/></svg>` },
    house_3: { w: 0.22, h: 0.26, svg: `<svg viewBox="0 0 340 320" xmlns="http://www.w3.org/2000/svg"><ellipse cx="170" cy="300" rx="138" ry="14" fill="#3f2415" opacity=".26"/><rect x="230" y="62" width="22" height="58" fill="#7c2d12"/><path d="M226 44h30l-4 20h-22z" fill="#94a3b8"/><path d="M30 172 170 62l140 110z" fill="#0369a1"/><path d="M170 62 310 172H260L170 98z" fill="#0c4a6e" opacity=".5"/><rect x="40" y="172" width="260" height="118" rx="8" fill="#fef3c7"/><rect x="40" y="172" width="260" height="118" rx="8" fill="none" stroke="#92400e" stroke-width="6"/><path d="M126 172v118M214 172v118" stroke="#92400e" stroke-width="3" opacity=".55"/><rect x="60" y="200" width="50" height="38" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/><path d="M60 219h50M85 200v38" stroke="#0369a1" stroke-width="2"/><rect x="138" y="208" width="64" height="78" rx="4" fill="#7c2d12"/><circle cx="190" cy="248" r="3" fill="#fde68a"/><rect x="222" y="200" width="58" height="38" rx="20" fill="#7dd3fc" stroke="#0369a1" stroke-width="3"/><path d="M222 219h58" stroke="#0369a1" stroke-width="2"/></svg>` },
    house_4: { w: 0.24, h: 0.28, svg: `<svg viewBox="0 0 380 340" xmlns="http://www.w3.org/2000/svg"><ellipse cx="190" cy="320" rx="160" ry="14" fill="#3f2415" opacity=".28"/><rect x="80" y="40" width="22" height="60" fill="#7c2d12"/><path d="M76 22h30l-4 20H80z" fill="#94a3b8"/><rect x="280" y="50" width="22" height="60" fill="#7c2d12"/><path d="M276 32h30l-4 20h-22z" fill="#94a3b8"/><path d="M20 182 190 64l170 118z" fill="#15803d"/><path d="M190 64 360 182H300L190 100z" fill="#14532d" opacity=".5"/><rect x="36" y="182" width="308" height="126" rx="8" fill="#fef3c7"/><rect x="36" y="182" width="308" height="126" rx="8" fill="none" stroke="#92400e" stroke-width="6"/><path d="M114 182v126M190 182v126M266 182v126" stroke="#92400e" stroke-width="3" opacity=".5"/><rect x="56" y="210" width="48" height="38" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/><path d="M56 229h48M80 210v38" stroke="#0369a1" stroke-width="2"/><rect x="128" y="210" width="50" height="38" rx="4" fill="#fde047" stroke="#b45309" stroke-width="3"/><path d="M128 229h50M153 210v38" stroke="#b45309" stroke-width="2"/><rect x="206" y="220" width="48" height="38" rx="20" fill="#7dd3fc" stroke="#0369a1" stroke-width="3"/><path d="M206 239h48" stroke="#0369a1" stroke-width="2"/><rect x="284" y="218" width="46" height="42" rx="4" fill="#fb7185" stroke="#831843" stroke-width="3"/><path d="M284 239h46M307 218v42" stroke="#831843" stroke-width="2"/><rect x="160" y="266" width="60" height="42" rx="4" fill="#7c2d12"/><circle cx="208" cy="290" r="3" fill="#fde68a"/></svg>` },
    house_5: { w: 0.28, h: 0.32, svg: `<svg viewBox="0 0 440 380" xmlns="http://www.w3.org/2000/svg"><ellipse cx="220" cy="360" rx="186" ry="14" fill="#3f2415" opacity=".28"/><rect x="80" y="36" width="24" height="68" fill="#92400e"/><path d="M76 14h32l-6 24H80z" fill="#facc15"/><circle cx="92" cy="22" r="6" fill="#fde047"/><rect x="336" y="36" width="24" height="68" fill="#92400e"/><path d="M332 14h32l-6 24h-22z" fill="#facc15"/><circle cx="348" cy="22" r="6" fill="#fde047"/><path d="M16 200 220 56l200 144z" fill="#7c3aed"/><path d="M220 56 420 200H340L220 96z" fill="#5b21b6" opacity=".55"/><rect x="34" y="200" width="372" height="148" rx="10" fill="#fef3c7"/><rect x="34" y="200" width="372" height="148" rx="10" fill="none" stroke="#92400e" stroke-width="7"/><path d="M108 200v148M180 200v148M260 200v148M332 200v148" stroke="#92400e" stroke-width="3" opacity=".45"/><rect x="50" y="232" width="50" height="42" rx="4" fill="#bae6fd" stroke="#0369a1" stroke-width="3"/><path d="M50 253h50M75 232v42" stroke="#0369a1" stroke-width="2"/><rect x="122" y="232" width="48" height="42" rx="4" fill="#fde047" stroke="#b45309" stroke-width="3"/><path d="M122 253h48M146 232v42" stroke="#b45309" stroke-width="2"/><rect x="194" y="244" width="52" height="42" rx="22" fill="#7dd3fc" stroke="#0369a1" stroke-width="3"/><path d="M194 265h52" stroke="#0369a1" stroke-width="2"/><rect x="270" y="232" width="50" height="42" rx="4" fill="#fb7185" stroke="#831843" stroke-width="3"/><path d="M270 253h50M295 232v42" stroke="#831843" stroke-width="2"/><rect x="342" y="232" width="50" height="42" rx="4" fill="#bbf7d0" stroke="#166534" stroke-width="3"/><path d="M342 253h50M367 232v42" stroke="#166534" stroke-width="2"/><rect x="186" y="290" width="68" height="58" rx="4" fill="#7c2d12"/><circle cx="240" cy="320" r="4" fill="#fde047"/><path d="M186 290h68" stroke="#facc15" stroke-width="3"/></svg>` },
};

const OUTDOOR_FIELD_IDS = ['land', 'water', 'sky'];
const ROOM_AREA_IDS = CONFIG.rooms.map(room => room.id);

export function canPlaceItemInArea(item, area) {
    const fields = Array.isArray(item?.fields) ? item.fields : null;
    if (!fields || fields.length === 0) return true;
    if (fields.includes(area)) return true;
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

// —— House helpers ——
// item def for a placed entry
const SHOP_BY_ID = Object.fromEntries(SHOP_ITEMS.map(it => [it.id, it]));

export function isHouseItem(itemOrId) {
    const def = typeof itemOrId === 'string' ? SHOP_BY_ID[itemOrId] : itemOrId;
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
        const def = SHOP_BY_ID[placed?.itemId];
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
    const defHouse = SHOP_BY_ID[CONFIG.defaultHouseId];
    return defHouse?.rooms ? [...defHouse.rooms] : ['bedroom'];
}
