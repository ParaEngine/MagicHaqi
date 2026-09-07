const GUEST_SESSION_KEY = 'magichaqi.guestSessionActive';

function resolveSessionStorage(storage) {
    if (storage) return storage;
    try { return globalThis.sessionStorage || null; } catch (_) { return null; }
}

export function hasGuestSession(storage) {
    try { return resolveSessionStorage(storage)?.getItem(GUEST_SESSION_KEY) === '1'; } catch (_) { return false; }
}

export function setGuestSessionActive(active, storage) {
    try {
        const target = resolveSessionStorage(storage);
        if (!target) return false;
        if (active) target.setItem(GUEST_SESSION_KEY, '1');
        else target.removeItem(GUEST_SESSION_KEY);
        return true;
    } catch (_) {
        return false;
    }
}
