const REWARD_ART_ROOT = 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/day-three-p0/split-icons';

export const EXPEDITION_MATERIAL_ART = Object.freeze({
    hpShard: `${REWARD_ART_ROOT}/hpShard.webp`,
    manaDust: `${REWARD_ART_ROOT}/manaDust.webp`,
    attackCore: `${REWARD_ART_ROOT}/attackCore.webp`,
    guardPlate: `${REWARD_ART_ROOT}/guardPlate.webp`,
    stellarEssence: `${REWARD_ART_ROOT}/stellarEssence.webp`,
    captureLens: `${REWARD_ART_ROOT}/captureLens.webp`,
    cometAlloy: `${REWARD_ART_ROOT}/cometAlloy.webp`,
    relicCircuit: `${REWARD_ART_ROOT}/relicCircuit.webp`,
    phaseCrystal: `${REWARD_ART_ROOT}/phaseCrystal.webp`,
    starMoss: `${REWARD_ART_ROOT}/starMoss.webp`,
    lunarFiber: `${REWARD_ART_ROOT}/lunarFiber.webp`,
    nebulaPearl: `${REWARD_ART_ROOT}/nebulaPearl.webp`,
});

export const HOME_TREASURE_ART = Object.freeze({
    mining_array: `${REWARD_ART_ROOT}/mining_array.webp`,
    clean_breeze_filter: `${REWARD_ART_ROOT}/clean_breeze_filter.webp`,
    starlight_greenhouse: `${REWARD_ART_ROOT}/starlight_greenhouse.webp`,
    ember_reactor: `${REWARD_ART_ROOT}/ember_reactor.webp`,
});

export function rewardArtHtml(image, fallback, className = '') {
    const source = String(image || '').trim();
    if (!source) return fallback;
    return `<span hidden>${fallback}</span><img${className ? ` class="${className}"` : ''} src="${source}" alt="" draggable="false" onerror="this.hidden=true;this.previousElementSibling.hidden=false">`;
}