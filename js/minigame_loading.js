export function resolveMinigameLoadingState(event) {
    const type = String(event || '').trim().toLowerCase();
    if (type === 'loaded') return 'ready';
    if (type === 'timeout' || type === 'empty' || type === 'error') return 'failed';
    return 'loading';
}

export function resolveMinigameResourceEvent({ responseOk = true, html = null, error = null } = {}) {
    if (error || !responseOk) return 'error';
    if (html != null && !String(html).trim()) return 'empty';
    return 'loaded';
}

export function shouldReleaseExploreFlow(event) {
    return resolveMinigameLoadingState(event) !== 'loading';
}