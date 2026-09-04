// 家园珍宝的库存适配与每日效果记账。
// 本模块不保存状态：调用方在成功领取后负责持久化 state.planetActions。

import { HOME_TREASURE_ART } from './reward_art.js';

export const TREASURE_IDS = Object.freeze({
    MINING_ARRAY: 'mining_array',
    CLEAN_BREEZE_FILTER: 'clean_breeze_filter',
    STARLIGHT_GREENHOUSE: 'starlight_greenhouse',
    EMBER_REACTOR: 'ember_reactor',
});

const KNOWN_TREASURE_IDS = Object.freeze(Object.values(TREASURE_IDS));
const DAILY_ACTION_PREFIX = 'home-treasure';
export const HOME_TREASURE_META = Object.freeze({
    [TREASURE_IDS.MINING_ARRAY]: Object.freeze({ icon: '⛏', image: HOME_TREASURE_ART.mining_array, name: '星轨矿阵', dailyReward: Object.freeze({ coins: 60 }), rewardText: '+60 星币', facility: Object.freeze({ fields: ['land', 'outdoor'], growth: '矿阵共鸣' }) }),
    [TREASURE_IDS.CLEAN_BREEZE_FILTER]: Object.freeze({ icon: '🍃', image: HOME_TREASURE_ART.clean_breeze_filter, name: '清风滤芯', dailyReward: Object.freeze({ biofuel: 4 }), rewardText: '+4 生物燃料', facility: Object.freeze({ fields: ['land', 'outdoor'], growth: '生态净化' }) }),
    [TREASURE_IDS.STARLIGHT_GREENHOUSE]: Object.freeze({ icon: '🌱', image: HOME_TREASURE_ART.starlight_greenhouse, name: '星光温室', dailyReward: Object.freeze({ coins: 35, biofuel: 2 }), rewardText: '+35 星币 · +2 生物燃料', facility: Object.freeze({ fields: ['land', 'outdoor'], growth: '培育繁盛' }) }),
    [TREASURE_IDS.EMBER_REACTOR]: Object.freeze({ icon: '🔥', image: HOME_TREASURE_ART.ember_reactor, name: '余烬反应炉', dailyReward: Object.freeze({ coins: 100 }), rewardText: '+100 星币', facility: Object.freeze({ fields: ['fire', 'land', 'outdoor'], growth: '反应炉热度' }) }),
});

function positiveCount(value) {
    const count = Math.floor(Number(value) || 0);
    return Math.max(0, count);
}

function localDayStamp(now = Date.now()) {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) return localDayStamp(Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function inventoryFor(source) {
    if (!source || typeof source !== 'object') return {};
    return source.inventory && typeof source.inventory === 'object'
        ? source.inventory
        : source;
}

function legacyTreasuresFor(source, inventory) {
    if (source?.homeTreasures && typeof source.homeTreasures === 'object') return source.homeTreasures;
    if (inventory?.homeTreasures && typeof inventory.homeTreasures === 'object') return inventory.homeTreasures;
    return {};
}

/**
 * 从 state、inventory 或旧版 homeTreasures 容器读取珍宝数量。
 * 返回的是冻结的新对象，调用方不能借此修改实际库存。
 */
export function getHomeTreasures(source = {}) {
    const inventory = inventoryFor(source);
    const legacyTreasures = legacyTreasuresFor(source, inventory);
    const treasures = Object.fromEntries(KNOWN_TREASURE_IDS.map((id) => [
        id,
        positiveCount(inventory[id] ?? legacyTreasures[id]),
    ]));
    return Object.freeze(treasures);
}

export function hasHomeTreasure(source, treasureId) {
    return positiveCount(getHomeTreasures(source)[treasureId]) > 0;
}

export function isHomeTreasureId(treasureId) {
    return KNOWN_TREASURE_IDS.includes(String(treasureId || '').trim());
}

export function getHomeTreasureInventoryId(treasureId) {
    return isHomeTreasureId(treasureId) ? String(treasureId).trim() : '';
}

export function getHomeTreasureDuplicateBonus(ownedCount = 1) {
    const extraCopies = Math.max(0, positiveCount(ownedCount) - 1);
    return Math.min(0.5, extraCopies * 0.1);
}

export function getHomeTreasureFusion(ownedCount = 1) {
    const count = Math.max(1, positiveCount(ownedCount));
    const fusionLevel = count;
    const bonus = getHomeTreasureDuplicateBonus(count);
    return Object.freeze({
        level: fusionLevel,
        extraCopies: fusionLevel - 1,
        bonus,
        bonusPercent: Math.round(bonus * 100),
        maxed: bonus >= 0.5,
    });
}

export function getHomeTreasureDailyReward(treasureId, planetActions = {}, ownedCount = 1) {
    const reward = HOME_TREASURE_META[treasureId]?.dailyReward;
    if (!reward) return Object.freeze({});
    const growth = getHomeTreasureGrowth(planetActions, treasureId);
    const runningBonus = Math.min(0.5, Math.max(0, growth.level - 1) * 0.1);
    const multiplier = 1 + runningBonus + getHomeTreasureDuplicateBonus(ownedCount);
    return Object.freeze(Object.fromEntries(Object.entries(reward).map(([key, value]) => [
        key,
        Math.max(1, Math.ceil(Number(value) * multiplier)),
    ])));
}

export function formatHomeTreasureReward(reward = {}) {
    const parts = [];
    if (Number(reward.coins)) parts.push(`+${reward.coins} 星币`);
    if (Number(reward.biofuel)) parts.push(`+${reward.biofuel} 生物燃料`);
    return parts.join(' · ');
}

export function getHomeTreasureFacility(treasureId) {
    const treasure = HOME_TREASURE_META[treasureId];
    if (!treasure) return null;
    return Object.freeze({
        id: treasureId,
        type: 'furniture',
        uniqueItem: true,
        unlimited: true,
        icon: treasure.icon,
        emoji: treasure.icon,
        image: treasure.image,
        name: treasure.name,
        fields: treasure.facility?.fields || ['outdoor'],
        facility: true,
    });
}

export function isHomeTreasurePlaced(layouts, treasureId) {
    return Object.values(layouts && typeof layouts === 'object' ? layouts : {})
        .some(items => Array.isArray(items) && items.some(item => item?.itemId === treasureId));
}

export function getHomeTreasureGrowth(planetActions, treasureId) {
    const value = Math.max(0, Math.floor(Number(planetActions?.[`${DAILY_ACTION_PREFIX}:${treasureId}:growth`]) || 0));
    const remainder = value % 7;
    return Object.freeze({ days: value, level: 1 + Math.floor(value / 7), nextLevelDays: remainder === 0 ? 7 : 7 - remainder });
}

export function homeTreasureDailyActionKey(treasureId, effectId = 'daily') {
    const treasure = String(treasureId || '').trim();
    const effect = String(effectId || 'daily').trim() || 'daily';
    return `${DAILY_ACTION_PREFIX}:${treasure}:${effect}`;
}

/**
 * 领取某个珍宝的每日效果，并将领取日写入调用方提供的 planetActions。
 *
 * @returns {{ claimed: boolean, actionKey: string, day: string }}
 * `claimed` 为 false 表示这项效果已经在同一个本地自然日领取过。
 */
export function claimDailyHomeTreasureEffect(planetActions, treasureId, effectId = 'daily', now = Date.now()) {
    if (!planetActions || typeof planetActions !== 'object') {
        throw new TypeError('claimDailyHomeTreasureEffect requires a mutable planetActions object');
    }
    if (!KNOWN_TREASURE_IDS.includes(treasureId)) {
        throw new RangeError(`Unknown home treasure: ${String(treasureId)}`);
    }

    const actionKey = homeTreasureDailyActionKey(treasureId, effectId);
    const day = localDayStamp(now);
    if (planetActions[actionKey] === day) {
        return Object.freeze({ claimed: false, actionKey, day });
    }

    planetActions[actionKey] = day;
    const growthKey = `${DAILY_ACTION_PREFIX}:${treasureId}:growth`;
    planetActions[growthKey] = Math.max(0, Math.floor(Number(planetActions[growthKey]) || 0)) + 1;
    return Object.freeze({ claimed: true, actionKey, day });
}