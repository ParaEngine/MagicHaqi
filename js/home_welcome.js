const STORAGE_PREFIX = 'mh_home_welcome_closed_v1';

function localDayKey(now = Date.now()) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function accountKey(user, offlineMode = false) {
    return String(user?.id || user?.username || user?.name || (offlineMode ? 'guest' : 'anonymous'));
}

function storageKey(user, offlineMode = false) {
    return `${STORAGE_PREFIX}:${accountKey(user, offlineMode)}:${localDayKey()}`;
}

export function shouldShowHomeWelcome(user, offlineMode = false) {
    try {
        return localStorage.getItem(storageKey(user, offlineMode)) !== '1';
    } catch (_) {
        return true;
    }
}

export function dismissHomeWelcome(user, offlineMode = false) {
    try {
        localStorage.setItem(storageKey(user, offlineMode), '1');
    } catch (_) {}
}

export function resetHomeWelcomeForLogin(user, offlineMode = false) {
    try {
        localStorage.removeItem(storageKey(user, offlineMode));
    } catch (_) {}
}