export const TERRAIN_FIELD_SLOT_COUNT = 7;

export const TERRAIN_FIELD_SLOT_DEFS = [
    { index: 1, label: '左耳', x: 7, y: 48 },
    { index: 2, label: '左眉', x: 34, y: 28 },
    { index: 3, label: '右眉', x: 66, y: 28 },
    { index: 4, label: '右耳', x: 93, y: 48 },
    { index: 5, label: '左胡子', x: 34, y: 84 },
    { index: 6, label: '中胡子', x: 50, y: 86 },
    { index: 7, label: '右胡子', x: 66, y: 84 },
];

const DEFAULT_TERRAIN_SLOT_INDEX = 1;
export const DEFAULT_TERRAIN_FIELD_SLOT_ID = String(DEFAULT_TERRAIN_SLOT_INDEX);

const LEGACY_SLOT_ID_TO_INDEX = {
    land: 1,
    water: 2,
    sky: 3,
    terrain_slot_4: 1,
    terrain_slot_5: 4,
    terrain_slot_6: 5,
    terrain_slot_7: 7,
};

export function terrainFieldSlotKey(index) {
    return String(index + 1);
}

export function normalizeTerrainSlotIndex(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (LEGACY_SLOT_ID_TO_INDEX[raw]) return LEGACY_SLOT_ID_TO_INDEX[raw];
    const index = Number(raw);
    return Number.isInteger(index) && index >= 1 && index <= TERRAIN_FIELD_SLOT_COUNT ? index : null;
}

export function normalizeTerrainFieldSlotId(slotId) {
    const index = normalizeTerrainSlotIndex(slotId);
    return index ? String(index) : String(slotId || DEFAULT_TERRAIN_FIELD_SLOT_ID);
}
