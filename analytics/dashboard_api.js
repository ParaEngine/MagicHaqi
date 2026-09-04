export function createOperationsApiRequest(endpoint, options = {}) {
    let url;
    try {
        url = new URL(String(endpoint || '').trim());
    } catch (_) {
        throw new Error('聚合 API 必须是完整的 HTTP(S) 地址');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('聚合 API 必须是完整的 HTTP(S) 地址');
    }
    if (options.startDate) url.searchParams.set('startDate', options.startDate);
    if (options.endDate) url.searchParams.set('endDate', options.endDate);
    const headers = { Accept: 'application/json' };
    const apiKey = String(options.apiKey || '').trim();
    if (apiKey) headers['X-API-Key'] = apiKey;
    return { url, headers };
}