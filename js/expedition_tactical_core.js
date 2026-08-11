export const DEFLECTION_SHIELD_RATIO = 0.45;
export const EMERGENCY_BEACON_HEAL_RATIO = 0.25;
export const EMERGENCY_BEACON_SHIELD_RATIO = 0.2;

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function positiveInteger(value) {
    return Math.max(1, Math.round(Number(value) || 0));
}

export function createTacticalState(items = {}) {
    return {
        emergencyBeacon: nonNegativeInteger(items.emergencyBeacon),
        deflectionShield: nonNegativeInteger(items.deflectionShield),
        beaconUsed: false,
    };
}

export function applyDeflectionShield(player, tacticalState) {
    if (!player || !tacticalState?.deflectionShield) return 0;
    const shield = positiveInteger(positiveInteger(player.maxHp) * DEFLECTION_SHIELD_RATIO);
    player.shield = nonNegativeInteger(player.shield) + shield;
    return shield;
}

export function rescueWithEmergencyBeacon(player, tacticalState, { finished = false } = {}) {
    if (!player || !tacticalState?.emergencyBeacon || tacticalState.beaconUsed || finished) return null;
    tacticalState.beaconUsed = true;
    player.hp = positiveInteger(positiveInteger(player.maxHp) * EMERGENCY_BEACON_HEAL_RATIO);
    const shield = positiveInteger(positiveInteger(player.maxHp) * EMERGENCY_BEACON_SHIELD_RATIO);
    player.shield = nonNegativeInteger(player.shield) + shield;
    return { hp: player.hp, shield };
}