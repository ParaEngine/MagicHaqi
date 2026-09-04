const DAY_MS = 24 * 60 * 60 * 1000;
export const GIFT_FRESHNESS_MS = 7 * DAY_MS;
const FRESH_CATEGORIES = new Set(['tea', 'flower', 'food']);

export const COLLECTIBLE_CATEGORIES = Object.freeze({
    tea: Object.freeze({ name: '茶饮', icon: '🍵' }),
    flower: Object.freeze({ name: '花草', icon: '🌸' }),
    food: Object.freeze({ name: '食品', icon: '🍪' }),
    decor: Object.freeze({ name: '装饰', icon: '🎀' }),
    mineral: Object.freeze({ name: '矿物', icon: '💎' }),
});

export const COLLECTIBLE_ITEMS = Object.freeze([
    { id: 'gift_cloud_tea', name: '云芽清茶', icon: '🍵', category: 'tea', rarity: 'common', source: '草地与日常探索' },
    { id: 'gift_ember_tea', name: '暖焰红茶', icon: '🫖', category: 'tea', rarity: 'common', source: '火山与矿区探索' },
    { id: 'gift_mint_tea', name: '薄荷星露', icon: '🌿', category: 'tea', rarity: 'uncommon', source: '森林意外掉落' },
    { id: 'gift_moon_tea', name: '月桂夜茶', icon: '🌙', category: 'tea', rarity: 'rare', source: 'NPC 稀有回礼' },
    { id: 'gift_sunflower', name: '向阳小花', icon: '🌻', category: 'flower', rarity: 'common', source: '草地与农场探索' },
    { id: 'gift_snow_blossom', name: '雪绒花', icon: '❄️', category: 'flower', rarity: 'uncommon', source: '雪山探索' },
    { id: 'gift_starlight_orchid', name: '星光兰', icon: '🪻', category: 'flower', rarity: 'rare', source: 'NPC 稀有回礼' },
    { id: 'gift_bamboo_leaf', name: '青竹叶', icon: '🍃', category: 'flower', rarity: 'common', source: '动物园探索' },
    { id: 'gift_honey_cookie', name: '蜂蜜曲奇', icon: '🍪', category: 'food', rarity: 'common', source: '农场与补给事件' },
    { id: 'gift_berry_candy', name: '浆果软糖', icon: '🍬', category: 'food', rarity: 'common', source: '森林与游乐场探索' },
    { id: 'gift_bamboo_cake', name: '竹香米糕', icon: '🍙', category: 'food', rarity: 'uncommon', source: '动物园探索' },
    { id: 'gift_comet_chocolate', name: '彗星巧克力', icon: '🍫', category: 'food', rarity: 'rare', source: 'NPC 稀有回礼' },
    { id: 'gift_shell_chime', name: '贝壳风铃', icon: '🐚', category: 'decor', rarity: 'common', source: '水域探索' },
    { id: 'gift_ribbon_badge', name: '彩带徽章', icon: '🎗️', category: 'decor', rarity: 'common', source: '庆典与游乐场探索' },
    { id: 'gift_wooden_figure', name: '木雕伙伴', icon: '🪵', category: 'decor', rarity: 'uncommon', source: '森林与营地探索' },
    { id: 'gift_prism_music_box', name: '棱镜音乐盒', icon: '🎶', category: 'decor', rarity: 'rare', source: 'NPC 稀有回礼' },
    { id: 'gift_stardust_crystal', name: '星尘晶簇', icon: '💠', category: 'mineral', rarity: 'common', source: '挖矿与远征' },
    { id: 'gift_amber_fragment', name: '琥珀碎片', icon: '🟠', category: 'mineral', rarity: 'common', source: '挖矿与森林探索' },
    { id: 'gift_aurora_ore', name: '极光矿石', icon: '🔷', category: 'mineral', rarity: 'uncommon', source: '深层矿区探索' },
    { id: 'gift_orbit_core', name: '星轨矿阵核心', icon: '🪐', category: 'mineral', rarity: 'rare', source: 'NPC 稀有回礼' },
].map(item => Object.freeze(item)));

const ITEM_BY_ID = new Map(COLLECTIBLE_ITEMS.map(item => [item.id, item]));
const CATEGORY_IDS = Object.keys(COLLECTIBLE_CATEGORIES);
const BONUS_TYPES = Object.freeze([
    { id: 'expeditionLootPercent', name: '探险寻宝', unit: '%', description: '提高远征材料与收藏发现' },
    { id: 'miningDiscoveryPercent', name: '矿野感知', unit: '%', description: '提高随处采集时的意外掉落概率' },
    { id: 'returnGiftPercent', name: '礼尚往来', unit: '%', description: '提高这位 NPC 的回礼概率' },
    { id: 'dailyRewardPercent', name: '日常鼓舞', unit: '%', description: '提高每日精选的首次奖励' },
]);

function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || 'npc')) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function collectibleItem(itemId) {
    return ITEM_BY_ID.get(String(itemId || '')) || null;
}

export function collectibleNeedsFreshness(itemId) {
    const item = collectibleItem(itemId);
    return !!item && item.rarity !== 'rare' && FRESH_CATEGORIES.has(item.category);
}

function freshnessBatches(freshness, itemId) {
    const batches = freshness?.[itemId];
    return Array.isArray(batches)
        ? batches.map(value => Math.max(0, Math.floor(Number(value) || 0))).filter(Boolean).sort((left, right) => left - right)
        : [];
}

export function registerCollectibleAcquisition(freshness, itemId, count = 1, now = Date.now()) {
    if (!freshness || typeof freshness !== 'object' || !collectibleNeedsFreshness(itemId)) return false;
    const quantity = Math.max(0, Math.floor(Number(count) || 0));
    if (!quantity) return false;
    const batches = freshnessBatches(freshness, itemId);
    const acquiredAt = Math.max(0, Math.floor(Number(now) || Date.now()));
    freshness[itemId] = [...batches, ...Array(quantity).fill(acquiredAt)].slice(-200);
    return true;
}

export function getCollectibleFreshness(itemId, inventory = {}, freshness = {}, now = Date.now()) {
    const total = Math.max(0, Math.floor(Number(inventory[itemId]) || 0));
    if (!collectibleNeedsFreshness(itemId)) return { perishable: false, total, freshCount: total, staleCount: 0, nextExpiryAt: 0 };
    const batches = freshnessBatches(freshness, itemId).slice(-total);
    const staleCount = batches.filter(acquiredAt => acquiredAt + GIFT_FRESHNESS_MS <= now).length;
    const freshBatches = batches.filter(acquiredAt => acquiredAt + GIFT_FRESHNESS_MS > now);
    return {
        perishable: true,
        total,
        freshCount: total - staleCount,
        staleCount,
        nextExpiryAt: freshBatches.length ? freshBatches[0] + GIFT_FRESHNESS_MS : 0,
    };
}

function consumeCollectibleFreshness(freshness, itemId) {
    if (!freshness || typeof freshness !== 'object' || !collectibleNeedsFreshness(itemId)) return;
    const batches = freshnessBatches(freshness, itemId);
    if (batches.length) batches.shift();
    if (batches.length) freshness[itemId] = batches;
    else delete freshness[itemId];
}

export function giftDayKey(now = Date.now()) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getNpcGiftProfile(npc = {}) {
    const seed = hashText(npc.progressId || npc.id || npc.name);
    const likedCategory = CATEGORY_IDS[seed % CATEGORY_IDS.length];
    let dislikedCategory = CATEGORY_IDS[(seed >>> 5) % CATEGORY_IDS.length];
    if (dislikedCategory === likedCategory) dislikedCategory = CATEGORY_IDS[(CATEGORY_IDS.indexOf(likedCategory) + 2) % CATEGORY_IDS.length];
    const favorites = COLLECTIBLE_ITEMS.filter(item => item.category === likedCategory && item.rarity !== 'rare');
    const favorite = favorites[(seed >>> 9) % favorites.length];
    const bonus = BONUS_TYPES[(seed >>> 13) % BONUS_TYPES.length];
    return Object.freeze({
        likedCategory,
        dislikedCategory,
        favoriteItemId: favorite.id,
        bonusType: bonus.id,
        bonusName: bonus.name,
        bonusUnit: bonus.unit,
        bonusDescription: bonus.description,
    });
}

export function relationshipStage(affection = 0) {
    const value = Math.max(0, Math.floor(Number(affection) || 0));
    if (value >= 180) return { id: 'bestFriend', name: '挚友', level: 4, next: 0 };
    if (value >= 100) return { id: 'confidant', name: '知己', level: 3, next: 180 };
    if (value >= 50) return { id: 'friend', name: '朋友', level: 2, next: 100 };
    if (value >= 20) return { id: 'familiar', name: '熟悉', level: 1, next: 50 };
    return { id: 'acquaintance', name: '初识', level: 0, next: 20 };
}

export function npcRelationshipBonus(npc, relationship = {}) {
    const profile = getNpcGiftProfile(npc);
    const stage = relationshipStage(relationship.affection);
    return { ...profile, stage, value: stage.level * 2 };
}

export function settleNpcGift({ npc, relationship = {}, inventory = {}, freshness = {}, itemId, now = Date.now(), random = Math.random } = {}) {
    const item = collectibleItem(itemId);
    if (!item || Math.max(0, Number(inventory[itemId]) || 0) < 1) return { applied: false, reason: 'missing-item' };
    const day = giftDayKey(now);
    const daily = relationship.giftsToday?.day === day ? relationship.giftsToday : { day, count: 0 };
    if (daily.count >= 3) return { applied: false, reason: 'daily-limit', daily };

    const profile = getNpcGiftProfile(npc);
    const freshnessStatus = getCollectibleFreshness(itemId, inventory, freshness, now);
    const isFresh = freshnessStatus.staleCount === 0;
    const reaction = !isFresh ? 'stale' : item.id === profile.favoriteItemId ? 'favorite' : item.category === profile.likedCategory ? 'liked' : item.category === profile.dislikedCategory ? 'disliked' : 'neutral';
    const affectionDelta = { favorite: 12, liked: 7, neutral: 3, stale: 3, disliked: -2 }[reaction];
    const before = Math.max(0, Math.floor(Number(relationship.affection) || 0));
    const after = Math.max(0, before + affectionDelta);
    const bonus = npcRelationshipBonus(npc, { ...relationship, affection: before });
    const returnGiftChance = Math.min(0.25, 0.05 + (profile.bonusType === 'returnGiftPercent' ? bonus.value / 100 : 0));
    const returned = random() < returnGiftChance;
    const rareItems = COLLECTIBLE_ITEMS.filter(candidate => candidate.rarity === 'rare');
    const returnItem = returned ? rareItems[Math.floor(random() * rareItems.length) % rareItems.length] : null;

    return {
        applied: true,
        item,
        reaction,
        isFresh,
        affectionDelta,
        affectionBefore: before,
        affectionAfter: after + (returnItem ? 3 : 0),
        returnGiftChance,
        returnItem,
        daily: { day, count: daily.count + 1 },
        stageBefore: relationshipStage(before),
        stageAfter: relationshipStage(after + (returnItem ? 3 : 0)),
    };
}

export function applyNpcGiftSettlement(result, relationship, inventory, freshness = {}) {
    if (!result?.applied) return false;
    inventory[result.item.id] = Math.max(0, Math.floor(Number(inventory[result.item.id]) || 0) - 1);
    consumeCollectibleFreshness(freshness, result.item.id);
    if (!inventory[result.item.id]) delete inventory[result.item.id];
    if (result.returnItem) {
        inventory[result.returnItem.id] = Math.max(0, Math.floor(Number(inventory[result.returnItem.id]) || 0) + 1);
        registerCollectibleAcquisition(freshness, result.returnItem.id, 1);
    }
    relationship.affection = result.affectionAfter;
    relationship.giftsToday = result.daily;
    relationship.giftCount = Math.max(0, Math.floor(Number(relationship.giftCount) || 0)) + 1;
    relationship.lastGiftAt = Date.now();
    return true;
}

export function applyNpcInteractionReward({ interactionId, reward = {}, relationship = {}, inventory = {}, freshness = {}, now = Date.now() } = {}) {
    const settledIds = Array.isArray(relationship.rewardedInteractionIds)
        ? relationship.rewardedInteractionIds
        : (relationship.rewardedInteractionIds = []);
    const targetId = String(interactionId || '').trim();
    if (!targetId) return { applied: false, reason: 'missing-interaction' };
    if (settledIds.includes(targetId)) return { applied: false, reason: 'already-settled' };

    const affectionBefore = Math.max(0, Math.floor(Number(relationship.affection) || 0));
    const affectionDelta = Math.max(0, Math.floor(Number(reward.affection) || 0));
    const affectionAfter = affectionBefore + affectionDelta;
    const stageBefore = relationshipStage(affectionBefore);
    const stageAfter = relationshipStage(affectionAfter);
    relationship.affection = affectionAfter;
    settledIds.push(targetId);

    let stageReward = null;
    const item = collectibleItem(reward.stageItemId);
    const itemCount = Math.max(0, Math.floor(Number(reward.stageItemCount) || 0));
    const claimedStages = Array.isArray(relationship.claimedRewardStageIds)
        ? relationship.claimedRewardStageIds
        : (relationship.claimedRewardStageIds = []);
    if (stageAfter.level > stageBefore.level && item && itemCount && !claimedStages.includes(stageAfter.id)) {
        inventory[item.id] = Math.max(0, Math.floor(Number(inventory[item.id]) || 0)) + itemCount;
        registerCollectibleAcquisition(freshness, item.id, itemCount, now);
        claimedStages.push(stageAfter.id);
        stageReward = { item, count: itemCount, stage: stageAfter };
    }

    return { applied: true, affectionBefore, affectionAfter, affectionDelta, stageBefore, stageAfter, stageReward };
}

export function rollCollectibleDrop({ source = 'expedition', random = Math.random, chance = 1 } = {}) {
    if (random() >= Math.max(0, Math.min(1, Number(chance) || 0))) return null;
    const allowedRarities = source === 'npc-return' ? ['rare'] : source === 'mining' ? ['common', 'uncommon'] : ['common', 'uncommon'];
    const pool = COLLECTIBLE_ITEMS.filter(item => allowedRarities.includes(item.rarity) && (source !== 'mining' || item.category === 'mineral' || item.category === 'flower'));
    return pool[Math.floor(random() * pool.length) % pool.length] || null;
}

export function getNpcRelationshipBonuses(npcs = [], relationships = {}) {
    const totals = { expeditionLootPercent: 0, miningDiscoveryPercent: 0, returnGiftPercent: 0, dailyRewardPercent: 0 };
    npcs.forEach(npc => {
        const relationship = relationships[npc.progressId || npc.id] || {};
        const bonus = npcRelationshipBonus(npc, relationship);
        totals[bonus.bonusType] += bonus.value;
    });
    Object.keys(totals).forEach(key => { totals[key] = Math.min(20, totals[key]); });
    return totals;
}

export const NPC_GIFT_DAY_MS = DAY_MS;