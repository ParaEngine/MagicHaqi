export function syncVerifiedVipState(target, isVip) {
    if (!target || typeof target !== 'object' || typeof isVip !== 'boolean') return false;
    if (!!target.isPaid === isVip) return false;
    target.isPaid = isVip;
    return true;
}

export function isRealPaymentEnabled(releaseConfig = globalThis.MagicHaqiReleaseConfig) {
    return releaseConfig?.realPaymentEnabled === true;
}

function safeIdentifier(value, fallback = '') {
    const normalized = String(value || '').trim();
    return /^[a-zA-Z0-9_-]{1,64}$/.test(normalized) ? normalized : fallback;
}

export function normalizeVipPurchaseRequest(value = {}) {
    return {
        scene: safeIdentifier(value?.scene, 'minigame'),
        tierId: safeIdentifier(value?.tierId),
        planId: safeIdentifier(value?.planId),
        packageId: safeIdentifier(value?.packageId),
    };
}

export function buildVipMembershipOptions(value = {}) {
    const request = normalizeVipPurchaseRequest(value);
    return { from: 'magichaqi', ...request };
}