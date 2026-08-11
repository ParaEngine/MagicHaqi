// 哈奇星球远征插件边界：只有官方哈奇星球可以注册入口、启动远征和结算奖励。
export const HAQI_EXPEDITION_PLUGIN = Object.freeze({
    id: 'haqi-expedition',
    planetId: 'haqi',
    gameId: 'haqi_planet_expedition',
    settlementKey: 'haqiExpeditionSettlement',
});

export function isHaqiExpeditionEnabled(activePlanetId) {
    return String(activePlanetId || '').trim() === HAQI_EXPEDITION_PLUGIN.planetId;
}

export function getHaqiExpeditionSettlement(settings) {
    const safeSettings = settings && typeof settings === 'object' ? settings : {};
    const current = safeSettings[HAQI_EXPEDITION_PLUGIN.settlementKey];
    return current && typeof current === 'object'
        ? current
        : (safeSettings[HAQI_EXPEDITION_PLUGIN.settlementKey] = {});
}
