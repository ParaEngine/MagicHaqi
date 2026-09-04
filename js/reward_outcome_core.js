import { COLLECTIBLE_CATEGORIES, COLLECTIBLE_ITEMS } from './npc_gifts.js';

export const REWARD_OUTCOME_TARGET_VIEWS = Object.freeze({
    treasure: 'inventory',
    pets: 'petList',
    collection: 'haqiExplorationArchive',
});

export function createRewardOutcomeReturnTracker(returnView = 'expeditionMap') {
    const reviewViews = new Set(Object.values(REWARD_OUTCOME_TARGET_VIEWS));
    let pendingView = '';
    return {
        begin(view) {
            pendingView = reviewViews.has(view) ? view : '';
        },
        consume(view, fallbackView) {
            const destination = view === pendingView ? returnView : fallbackView;
            pendingView = '';
            return destination;
        },
    };
}

function owned(inventory, itemId) {
    return Math.max(0, Math.floor(Number(inventory?.[itemId]) || 0));
}

export function getCollectibleSeriesProgress(inventory = {}) {
    return Object.entries(COLLECTIBLE_CATEGORIES).map(([categoryId, category]) => {
        const items = COLLECTIBLE_ITEMS.filter(item => item.category === categoryId);
        const currentCount = items.filter(item => owned(inventory, item.id) > 0).length;
        return Object.freeze({
            id: categoryId,
            name: category.name,
            icon: category.icon,
            currentCount,
            totalCount: items.length,
            completed: currentCount === items.length,
        });
    });
}

export function getCollectibleSeriesOutcomes(beforeInventory = {}, afterInventory = {}, acquiredItems = []) {
    const acquiredIds = new Set((Array.isArray(acquiredItems) ? acquiredItems : [])
        .map(item => String(item?.id || item || '').trim())
        .filter(Boolean));
    const affectedCategories = new Set(COLLECTIBLE_ITEMS
        .filter(item => acquiredIds.has(item.id))
        .map(item => item.category));

    return Object.entries(COLLECTIBLE_CATEGORIES)
        .filter(([categoryId]) => affectedCategories.has(categoryId))
        .map(([categoryId, category]) => {
            const items = COLLECTIBLE_ITEMS.filter(item => item.category === categoryId);
            const beforeCount = items.filter(item => owned(beforeInventory, item.id) > 0).length;
            const currentCount = items.filter(item => owned(afterInventory, item.id) > 0).length;
            const newItems = items.filter(item => acquiredIds.has(item.id)
                && owned(beforeInventory, item.id) === 0
                && owned(afterInventory, item.id) > 0);
            return Object.freeze({
                id: categoryId,
                name: category.name,
                icon: category.icon,
                currentCount,
                totalCount: items.length,
                newItems: Object.freeze(newItems),
                completed: currentCount === items.length,
                newlyCompleted: beforeCount < items.length && currentCount === items.length,
            });
        });
}