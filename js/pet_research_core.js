// 重复宠物研究放归的纯规则层：不会复用行星放养（可召回）语义。

const RESEARCH_REWARDS = Object.freeze({
    N: Object.freeze({ coins: 20, materials: Object.freeze({ manaDust: 1 }) }),
    R: Object.freeze({ coins: 45, materials: Object.freeze({ attackCore: 1 }) }),
});

function qualityIdFor(pet) {
    const qualityId = String(pet?.quality?.id || pet?.qualityId || 'N').toUpperCase();
    return Object.hasOwn(RESEARCH_REWARDS, qualityId) ? qualityId : '';
}

function isLocked(pet) {
    return pet?.locked === true || pet?.isLocked === true || pet?.lock === true || pet?.status?.locked === true;
}

export function researchSpeciesKey(pet) {
    const source = pet?.expeditionSpeciesId || pet?.famousPetId || pet?.speciesId || pet?.traits?.species || '';
    return String(source || '').trim().toLowerCase();
}

export function getResearchReleaseCandidates(pets, { currentPetId = '', dispatchedPetIds = [] } = {}) {
    const dispatched = new Set((dispatchedPetIds || []).map(id => String(id || '').trim()));
    const list = (pets || []).filter(pet => pet && researchSpeciesKey(pet));
    const speciesCounts = new Map();
    for (const pet of list) {
        const key = researchSpeciesKey(pet);
        speciesCounts.set(key, (speciesCounts.get(key) || 0) + 1);
    }
    return list.filter(pet => {
        const key = researchSpeciesKey(pet);
        return speciesCounts.get(key) > 1
            && !!qualityIdFor(pet)
            && pet.id !== currentPetId
            && !isLocked(pet)
            && !dispatched.has(String(pet.id || '').trim());
    });
}

export function calculateResearchReleaseRewards(pets) {
    const total = { coins: 0, materials: {} };
    for (const pet of pets || []) {
        const reward = RESEARCH_REWARDS[qualityIdFor(pet)];
        if (!reward) continue;
        total.coins += reward.coins;
        for (const [materialId, amount] of Object.entries(reward.materials)) {
            total.materials[materialId] = (total.materials[materialId] || 0) + amount;
        }
    }
    return total;
}

export { RESEARCH_REWARDS };
