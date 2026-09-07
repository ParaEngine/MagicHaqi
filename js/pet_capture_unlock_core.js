function text(value) {
    return String(value || '').trim().toLowerCase();
}

function assetKey(value) {
    return text(value).split(/[?#]/, 1)[0];
}

export function captureKeys(value) {
    const source = value && typeof value === 'object' ? value : {};
    return [
        source.expeditionSpeciesId || source.speciesId,
        source.imageSheetUrl,
        source.imageUrl,
    ].map((value, index) => index ? assetKey(value) : text(value)).filter(Boolean);
}

export function hasCapturedFamousPet(entry, pets = [], captureRecords = []) {
    const targetAssets = new Set([assetKey(entry?.imageSheetUrl), assetKey(entry?.imageUrl)].filter(Boolean));
    if (!targetAssets.size) return false;
    const records = [
        ...(Array.isArray(pets) ? pets.filter(pet => pet?.source === 'expedition') : []),
        ...(Array.isArray(captureRecords) ? captureRecords.flatMap(item => item?.capturedPets || item) : []),
    ];
    return records.some(record => captureKeys(record).some(key => targetAssets.has(key)));
}