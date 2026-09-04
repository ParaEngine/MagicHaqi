export function getPendingExpeditionPetIds(petOrder, pets, attemptedMissingIds) {
    const knownPets = pets && typeof pets === 'object' ? pets : {};
    const attempted = attemptedMissingIds instanceof Set ? attemptedMissingIds : new Set();
    return (Array.isArray(petOrder) ? petOrder : [])
        .filter(id => id && !knownPets[id] && !attempted.has(id));
}

export function recordMissingExpeditionPetIds(requestedIds, pets, attemptedMissingIds) {
    const knownPets = pets && typeof pets === 'object' ? pets : {};
    const attempted = attemptedMissingIds instanceof Set ? attemptedMissingIds : new Set();
    (Array.isArray(requestedIds) ? requestedIds : []).forEach(id => {
        if (id && !knownPets[id]) attempted.add(id);
    });
    return attempted;
}