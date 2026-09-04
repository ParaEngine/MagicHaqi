import { loadPlanetIndex } from './config.js';

export const PLANET_FEATURES = Object.freeze({
    MINERAL_EXPLORATION: 'mineralExploration',
});

const FALLBACK_FEATURES = Object.freeze({
    haqi: [PLANET_FEATURES.MINERAL_EXPLORATION],
});

let featureMap = new Map();
let featureConfigMap = new Map();

function normalizeFeatures(value) {
    return new Set((Array.isArray(value) ? value : [])
        .map(feature => String(feature || '').trim())
        .filter(Boolean));
}

export async function loadPlanetFeatures() {
    const index = await loadPlanetIndex();
    const entries = Array.isArray(index?.planets) ? index.planets : [];
    featureMap = new Map(entries
        .map(entry => [String(entry?.id || '').trim(), normalizeFeatures(entry?.features)])
        .filter(([planetId]) => planetId));
    featureConfigMap = new Map(entries
        .map(entry => [String(entry?.id || '').trim(), entry?.mineralExploration])
        .filter(([planetId, config]) => planetId && config && typeof config === 'object'));
    return featureMap;
}

export function isPlanetFeatureEnabled(planetId, feature) {
    const safePlanetId = String(planetId || '').trim();
    const safeFeature = String(feature || '').trim();
    if (!safePlanetId || !safeFeature) return false;
    const configured = featureMap.get(safePlanetId);
    if (configured) return configured.has(safeFeature);
    return (FALLBACK_FEATURES[safePlanetId] || []).includes(safeFeature);
}

export function isMineralExplorationEnabled(planetId) {
    return isPlanetFeatureEnabled(planetId, PLANET_FEATURES.MINERAL_EXPLORATION);
}

export function getMineralExplorationConfig(planetId) {
    const config = featureConfigMap.get(String(planetId || '').trim());
    return config && typeof config === 'object' ? config : {};
}