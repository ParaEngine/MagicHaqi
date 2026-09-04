const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function normalizeRequestId(value) {
    return String(value || '').trim().slice(0, 80);
}

function count(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

export function mergeMineralBridgeSync({ current = {}, payload = {}, knownPetIds = new Set() }) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const dispatchedPetIds = Array.isArray(source.dispatchedPetIds)
        ? [...new Set(source.dispatchedPetIds.map(String).filter(id => knownPetIds.has(id)))]
        : current.dispatchedPetIds;
    const activeSeriesIds = Array.isArray(source.activeSeriesIds)
        ? [...new Set(source.activeSeriesIds.map(id => String(id || '').trim()).filter(Boolean))]
        : current.activeSeriesIds;
    const toPercent = (value, fallback) => Number.isFinite(Number(value))
        ? Math.max(0, Math.min(100, Number(value)))
        : fallback;
    return {
        ...current,
        dispatchedPetIds,
        activeSeriesIds,
        bonuses: {
            attackPercent: toPercent(source.bonuses?.attackPercent, current.bonuses?.attackPercent || 0),
            expeditionLootPercent: toPercent(source.bonuses?.expeditionLootPercent, current.bonuses?.expeditionLootPercent || 0),
        },
    };
}

export function hasMineralBridgeSyncChanges(current = {}, next = {}) {
    const sameList = (left, right) => JSON.stringify(left || []) === JSON.stringify(right || []);
    return !sameList(current.dispatchedPetIds, next.dispatchedPetIds)
        || !sameList(current.activeSeriesIds, next.activeSeriesIds)
        || Number(current.bonuses?.attackPercent || 0) !== Number(next.bonuses?.attackPercent || 0)
        || Number(current.bonuses?.expeditionLootPercent || 0) !== Number(next.bonuses?.expeditionLootPercent || 0);
}

export function settleMineralRoutePreparation({ requestId, bridge = {}, inventory = {}, cost = {}, chargeLimit = 3 }) {
    const safeRequestId = normalizeRequestId(requestId);
    const preparationCharges = count(bridge.preparationCharges);
    const consumedRequestIds = Array.isArray(bridge.consumedRequestIds) ? bridge.consumedRequestIds : [];
    if (!safeRequestId || !REQUEST_ID_PATTERN.test(safeRequestId)) {
        return { ok: false, error: '请求无效', bridge, inventory, changed: false };
    }
    if (consumedRequestIds.includes(safeRequestId)) {
        return { ok: true, bridge, inventory, changed: false, duplicate: true };
    }
    if (preparationCharges >= chargeLimit) {
        return { ok: false, error: '路线侦测芯片已达到携带上限', bridge, inventory, changed: false };
    }
    const hasMaterials = Object.entries(cost).every(([id, amount]) => count(inventory[`expedition_material_${id}`]) >= count(amount));
    if (!hasMaterials) {
        return { ok: false, error: '远征材料不足，需要星尘粉尘 x2、攻击晶核 x1', bridge, inventory, changed: false };
    }
    const nextInventory = { ...inventory };
    for (const [id, amount] of Object.entries(cost)) {
        const inventoryId = `expedition_material_${id}`;
        nextInventory[inventoryId] = count(nextInventory[inventoryId]) - count(amount);
    }
    return {
        ok: true,
        changed: true,
        inventory: nextInventory,
        bridge: {
            ...bridge,
            preparationCharges: preparationCharges + 1,
            consumedRequestIds: [...consumedRequestIds, safeRequestId],
        },
    };
}