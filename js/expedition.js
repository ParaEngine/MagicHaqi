const PLANETS = [
    { biome: '泡泡草地', icon: '🫧', color: '#38bdf8', rareTrace: '泡泡系伙伴踪迹', mineralSignal: '魔力尘云活跃', eventFeature: '漂流补给事件增多', strategyHint: '适合依靠事件补充魔力与星币，稳定推进构筑。', ecologyTags: ['生命', '自然', '天空'], routeNode: { type: 'event', label: '漂流补给信号', reward: { id: 'event-supply', label: '20 MP + 20 星币' } } },
    { biome: '迷雾森林', icon: '🌲', color: '#22c55e', rareTrace: '幻狐系伙伴踪迹', mineralSignal: '生命碎块富集', eventFeature: '隐匿营地事件增多', strategyHint: '适合状态不满的伙伴，通过营地恢复后挑战后半程。', ecologyTags: ['自然', '暗', '陆地'], routeNode: { type: 'camp', label: '隐匿树冠营地', reward: { id: 'camp-recovery', label: '恢复 15% HP + 20 护盾' } } },
    { biome: '月湾海滩', icon: '🌙', color: '#f59e0b', rareTrace: '潮汐系伙伴踪迹', mineralSignal: '捕捉透镜反光', eventFeature: '商站补给更常出现', strategyHint: '适合优先补充捕捉胶囊，追踪潮汐系伙伴。', ecologyTags: ['冰', '生命', '水系'], routeNode: { type: 'merchant', label: '月潮捕捉商站', reward: { id: 'merchant-capsule', label: '1 枚捕捉胶囊' } } },
    { biome: '糖晶沙漠', icon: '🏜️', color: '#fb7185', rareTrace: '晶甲系伙伴踪迹', mineralSignal: '攻击晶核脉冲', eventFeature: '精英巡逻信号增强', strategyHint: '适合战力充足时挑战精英，争取晶核与额外捕捉机会。', ecologyTags: ['火', '雷', '陆地'], routeNode: { type: 'elite', label: '晶甲巡逻先锋', reward: { id: 'elite-cache', label: '1 枚捕捉胶囊 + 18 星币' } } },
    { biome: '荧光沼泽', icon: '🍄', color: '#a78bfa', rareTrace: '荧光系伙伴踪迹', mineralSignal: '相位晶体波动', eventFeature: '奇遇节点更易出现', strategyHint: '适合利用事件补给调整局内构筑，再决定是否深入。', ecologyTags: ['暗', '生命', '水系'], routeNode: { type: 'event', label: '荧光孢子奇遇', reward: { id: 'event-supply', label: '20 MP + 20 星币' } } },
    { biome: '碎岩遗迹', icon: '🗿', color: '#94a3b8', rareTrace: '遗迹系伙伴踪迹', mineralSignal: '守护甲片回响', eventFeature: '首领线索更加清晰', strategyHint: '适合为首领战保留恢复与护盾，稳住终局结算。', ecologyTags: ['暗', '雷', '陆地'], routeNode: { type: 'camp', label: '首领线索观测点', reward: { id: 'camp-recovery', label: '恢复 15% HP + 20 护盾' } } },
];

const PLANET_NAMES = ['云糖', '余晖', '星芽', '琥珀', '萤火', '潮汐', '银铃', '晨雾', '琉光', '回声'];
const ENEMIES = [
    { id: 'sugar_patrol', name: '碎糖巡逻队', icon: '👾', rarity: '普通' },
    { id: 'bubble_spitter', name: '泡泡喷吐兽', icon: '🫧', rarity: '普通' },
    { id: 'frost_beetle', name: '糖霜甲虫', icon: '🪲', rarity: '普通' },
    { id: 'magnetic_guard', name: '磁暴守卫', icon: '⚡', rarity: '稀有' },
    { id: 'crystal_hunter', name: '晶簇猎手', icon: '💠', rarity: '稀有' },
    { id: 'rift_walker', name: '裂隙行者', icon: '👻', rarity: '稀有' },
    { id: 'core_guard', name: '核心巡卫', icon: '🤖', rarity: '精英' },
    { id: 'cloud_fox', name: '云尾幻狐', icon: '🦊', rarity: '史诗' },
    { id: 'stellar_tiger', name: '星纹虎机', icon: '🐯', rarity: '传说' },
];

const NODE_TYPES = ['combat', 'combat', 'event', 'merchant', 'combat', 'elite', 'camp'];
const REWARDS = [
    { id: 'star-coins', name: '星币', icon: '🪙', amount: 18 },
    { id: 'capture-capsule', name: '捕捉胶囊', icon: '🟠', amount: 1 },
    { id: 'repair-kit', name: '修复组件', icon: '🩹', amount: 1 },
    { id: 'mana-spark', name: '魔力火花', icon: '🔷', amount: 2 },
];

function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
        result ^= char.charCodeAt(0);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

function createRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6D2B79F5;
        let next = value;
        next = Math.imul(next ^ (next >>> 15), next | 1);
        next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
}

function dayKey(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function pick(items, random) {
    return items[Math.floor(random() * items.length)];
}

function buildNodes(seed) {
    const random = createRandom(seed);
    return Array.from({ length: 30 }, (_, index) => {
        const level = index + 1;
        const isBoss = level === 30;
        const type = isBoss ? 'boss' : NODE_TYPES[(index + Math.floor(random() * NODE_TYPES.length)) % NODE_TYPES.length];
        const enemyIndex = Math.min(ENEMIES.length - 1, Math.floor(index / 4) + Math.floor(random() * 2));
        const enemy = ENEMIES[enemyIndex];
        const reward = pick(REWARDS, random);
        return {
            id: `level-${level}`,
            level,
            type,
            label: isBoss ? '星核终局' : `${level} 号航段`,
            icon: isBoss ? '💎' : (type === 'merchant' ? '🧳' : type === 'event' ? '✨' : type === 'camp' ? '🔥' : enemy.icon),
            enemy: type === 'combat' || type === 'elite' || isBoss ? enemy : null,
            reward: { ...reward, amount: reward.amount + (type === 'elite' ? 1 : 0) + (isBoss ? 3 : 0) },
        };
    });
}

export function generateDailyExpeditions({ planetName = '哈奇星球', now = new Date() } = {}) {
    const date = dayKey(now);
    const random = createRandom(hash(`${planetName}:${date}:daily-expedition`));
    const count = 3;
    const unused = [...PLANETS];
    return Array.from({ length: count }, (_, index) => {
        const planet = unused.splice(Math.floor(random() * unused.length), 1)[0];
        const name = `${pick(PLANET_NAMES, random)}${planet.biome.replace(/[泡泡迷雾月湾糖晶荧光碎岩]/g, '').slice(0, 2) || '星'}`;
        const seed = hash(`${planetName}:${date}:${index}:${planet.biome}:${name}`);
        return {
            id: `${date}-${index}-${seed.toString(36)}`,
            dayKey: date,
            seed,
            name: `${name}星`,
            biome: planet.biome,
            icon: planet.icon,
            color: planet.color,
            difficulty: index === 0 ? '普通' : index === 1 ? '挑战' : '危险',
            ecologyPreview: {
                rareTrace: planet.rareTrace,
                mineralSignal: planet.mineralSignal,
                eventFeature: planet.eventFeature,
                strategyHint: planet.strategyHint,
                ecologyTags: planet.ecologyTags,
                routeNode: planet.routeNode,
            },
            nodes: buildNodes(seed),
        };
    });
}

export function getDailyExpeditionRoster(settlement, { planetName = '哈奇星球', now = new Date() } = {}) {
    const safeSettlement = settlement && typeof settlement === 'object' ? settlement : {};
    const date = dayKey(now);
    if (safeSettlement.dailyExpeditionExitFixVersion !== 1) {
        delete safeSettlement.dailyExpeditionRoster;
        safeSettlement.dailyExpeditionExitFixVersion = 1;
    }
    const previous = safeSettlement.dailyExpeditionRoster;
    const isCurrent = previous
        && previous.dayKey === date
        && previous.planetName === planetName;
    const exploredIds = isCurrent && Array.isArray(previous.exploredIds)
        ? [...new Set(previous.exploredIds.map(String))]
        : [];
    safeSettlement.dailyExpeditionRoster = { dayKey: date, planetName, exploredIds };
    return generateDailyExpeditions({ planetName, now }).map(expedition => ({
        ...expedition,
        explored: exploredIds.includes(expedition.id),
    }));
}

export function markDailyExpeditionExplored(settlement, expedition, { planetName = '哈奇星球', now = new Date() } = {}) {
    if (!expedition?.id) return false;
    const roster = getDailyExpeditionRoster(settlement, { planetName, now });
    if (!roster.some(item => item.id === expedition.id)) return false;
    const state = settlement.dailyExpeditionRoster;
    if (state.exploredIds.includes(expedition.id)) return false;
    state.exploredIds.push(expedition.id);
    return true;
}

export function sanitizeExpeditionPet(pet) {
    if (!pet?.id) return null;
    const battleStats = pet.battleStats && typeof pet.battleStats === 'object'
        ? {
            ...pet.battleStats,
            hp: Number(pet.battleStats.hp ?? pet.stats?.health ?? pet.stats?.hp ?? 0),
            mp: Number(pet.battleStats.mp ?? pet.stats?.mp ?? pet.stats?.mana ?? 0),
            attack: Number(pet.battleStats.attack ?? pet.battleStats.power ?? pet.stats?.attack ?? 0),
            defense: Number(pet.battleStats.defense ?? pet.stats?.defense ?? 0),
        }
        : null;
    return {
        id: pet.id,
        name: pet.name || '出战伙伴',
        imageUrl: pet.imageUrl || '',
        imageSheetUrl: pet.imageSheetUrl || '',
        rarity: pet.rarity ?? 0,
        stage: pet.stage || 'adult',
        quality: pet.quality || null,
        battleStats,
        stats: pet.stats ? {
            health: Number(pet.stats.health ?? pet.stats.hp ?? 0),
            mp: Number(pet.stats.mp ?? pet.stats.mana ?? 0),
            attack: Number(pet.stats.attack ?? 0),
            defense: Number(pet.stats.defense ?? 0),
        } : null,
    };
}