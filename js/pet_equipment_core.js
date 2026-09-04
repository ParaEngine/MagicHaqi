// 宠物装备纯规则层：装备固定值在训练后加入，百分比加成最后结算。
export const EQUIPMENT_SLOTS = Object.freeze(['charm', 'core', 'guard']);

export const EQUIPMENT_DEFS = Object.freeze({
    expedition_charm: Object.freeze({ id: 'expedition_charm', theme: 'starcore', slot: 'charm', name: '远征星徽', icon: '✦', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_starcore_expedition_charm.png', quality: 'R', stats: Object.freeze({ attack: 8, luck: 4 }) }),
    abyssal_tide_charm: Object.freeze({ id: 'abyssal_tide_charm', theme: 'abyssal', slot: 'charm', name: '潮汐捕捉徽记', icon: '◒', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_abyssal_tide_charm.png', quality: 'SR', stats: Object.freeze({ maxMp: 12, luck: 8 }) }),
    molten_surge_charm: Object.freeze({ id: 'molten_surge_charm', theme: 'molten', slot: 'charm', name: '熔涌突击徽记', icon: '✹', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_molten_surge_charm.png', quality: 'SR', stats: Object.freeze({ attack: 13, maxMp: 6 }) }),
    wasteland_signal_charm: Object.freeze({ id: 'wasteland_signal_charm', theme: 'wasteland', slot: 'charm', name: '荒原信号徽记', icon: '⌁', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_wasteland_signal_charm.png', quality: 'SR', stats: Object.freeze({ luck: 11, defense: 4 }) }),
    expedition_core: Object.freeze({ id: 'expedition_core', theme: 'starcore', slot: 'core', name: '脉冲晶核', icon: '◆', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_starcore_expedition_core.png', quality: 'SR', stats: Object.freeze({ maxHp: 24, magic: 6 }) }),
    abyssal_echo_core: Object.freeze({ id: 'abyssal_echo_core', theme: 'abyssal', slot: 'core', name: '深海回响晶核', icon: '◈', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_abyssal_echo_core.png', quality: 'SR', stats: Object.freeze({ maxHp: 20, maxMp: 14 }) }),
    molten_heart_core: Object.freeze({ id: 'molten_heart_core', theme: 'molten', slot: 'core', name: '熔核脉冲晶核', icon: '◆', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_molten_heart_core.png', quality: 'SSR', stats: Object.freeze({ attack: 17, magic: 9 }) }),
    wasteland_relay_core: Object.freeze({ id: 'wasteland_relay_core', theme: 'wasteland', slot: 'core', name: '废土中继晶核', icon: '◇', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_wasteland_relay_core.png', quality: 'SR', stats: Object.freeze({ defense: 8, magic: 10 }) }),
    expedition_guard: Object.freeze({ id: 'expedition_guard', theme: 'starcore', slot: 'guard', name: '守望护甲', icon: '◈', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_starcore_expedition_guard.png', quality: 'SR', stats: Object.freeze({ defense: 7, maxHp: 12 }), multiplier: Object.freeze({ defense: 1.05 }) }),
    abyssal_reef_guard: Object.freeze({ id: 'abyssal_reef_guard', theme: 'abyssal', slot: 'guard', name: '珊瑚潮壁护甲', icon: '▣', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_abyssal_reef_guard.png', quality: 'SR', stats: Object.freeze({ defense: 10, maxHp: 18 }) }),
    molten_bastion_guard: Object.freeze({ id: 'molten_bastion_guard', theme: 'molten', slot: 'guard', name: '熔岩壁垒护甲', icon: '▰', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_molten_bastion_guard.png', quality: 'SSR', stats: Object.freeze({ defense: 14, maxHp: 16 }), multiplier: Object.freeze({ defense: 1.06 }) }),
    wasteland_aegis_guard: Object.freeze({ id: 'wasteland_aegis_guard', theme: 'wasteland', slot: 'guard', name: '废土偏导护甲', icon: '⬡', image: 'https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_wasteland_aegis_guard.png', quality: 'SR', stats: Object.freeze({ maxHp: 27, luck: 5 }) }),
});

export const STARTER_EQUIPMENT_IDS = Object.freeze(['expedition_charm']);
export const MAX_EQUIPMENT_LEVEL = 5;

const STAT_KEYS = Object.freeze(['maxHp', 'maxMp', 'attack', 'defense', 'magic', 'luck']);

function positiveNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function getEquipmentDefinition(equipmentId) {
    return EQUIPMENT_DEFS[String(equipmentId || '').trim()] || null;
}

export function normalizeEquipment(equipment) {
    const source = equipment && typeof equipment === 'object' ? equipment : {};
    const normalized = {};
    for (const slot of EQUIPMENT_SLOTS) {
        const definition = getEquipmentDefinition(source[slot]);
        if (definition?.slot === slot) normalized[slot] = definition.id;
    }
    return normalized;
}

export function getEquipmentLevel(enhancements, equipmentId) {
    const level = Math.floor(Number(enhancements?.[equipmentId]) || 1);
    return Math.max(1, Math.min(MAX_EQUIPMENT_LEVEL, level));
}

export function getEquipmentUpgradeCost(enhancements, equipmentId) {
    const definition = getEquipmentDefinition(equipmentId);
    const level = getEquipmentLevel(enhancements, equipmentId);
    return definition && level < MAX_EQUIPMENT_LEVEL ? level * 2 : 0;
}

export function calculateEquipmentBonus(equipment, enhancements = {}) {
    const normalized = normalizeEquipment(equipment);
    const flat = Object.fromEntries(STAT_KEYS.map(key => [key, 0]));
    const multiplier = Object.fromEntries(STAT_KEYS.map(key => [key, 1]));
    for (const equipmentId of Object.values(normalized)) {
        const definition = getEquipmentDefinition(equipmentId);
        const upgradeMultiplier = 1 + (getEquipmentLevel(enhancements, equipmentId) - 1) * 0.1;
        for (const key of STAT_KEYS) {
            flat[key] += Math.round(positiveNumber(definition?.stats?.[key]) * upgradeMultiplier);
            const baseMultiplier = Math.max(1, positiveNumber(definition?.multiplier?.[key], 1));
            multiplier[key] *= 1 + (baseMultiplier - 1) * upgradeMultiplier;
        }
    }
    return Object.freeze({ flat: Object.freeze(flat), multiplier: Object.freeze(multiplier), equipment: Object.freeze(normalized) });
}

export function equipItem(pet, equipmentId, ownedEquipment = []) {
    const definition = getEquipmentDefinition(equipmentId);
    if (!pet || !definition || !Array.isArray(ownedEquipment) || !ownedEquipment.includes(definition.id)) return false;
    const equipment = normalizeEquipment(pet.battle?.equipment);
    pet.battle = pet.battle && typeof pet.battle === 'object' ? pet.battle : {};
    pet.battle.equipment = { ...equipment, [definition.slot]: definition.id };
    return true;
}

export function unequipSlot(pet, slot) {
    if (!pet || !EQUIPMENT_SLOTS.includes(slot)) return false;
    const equipment = normalizeEquipment(pet.battle?.equipment);
    if (!equipment[slot]) return false;
    delete equipment[slot];
    pet.battle = pet.battle && typeof pet.battle === 'object' ? pet.battle : {};
    pet.battle.equipment = equipment;
    return true;
}
