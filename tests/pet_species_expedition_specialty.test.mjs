import assert from 'node:assert/strict';
import test from 'node:test';
import { getSpeciesExpeditionSpecialty, getSpeciesGrowthProfile } from '../js/pet_species_growth_core.js';

test('物种远征专精稳定映射到对应的单一温和效果', () => {
    const expectedEffects = {
        maxHp: 'shieldPercentage',
        maxMp: 'initialMpBonus',
        attack: 'attackBonus',
        defense: 'armorBonus',
        magic: 'healingMultiplier',
        luck: 'captureBonus',
    };

    for (let index = 0; index < 5000; index += 1) {
        const pet = { id: `specialty-fixture-${index}` };
        const profile = getSpeciesGrowthProfile(pet);
        const specialty = getSpeciesExpeditionSpecialty(pet);
        assert.equal(specialty.specialty, profile.specialty);
        assert.equal(typeof specialty.name, 'string');
        assert.equal(typeof specialty.description, 'string');
        assert.ok(specialty[expectedEffects[profile.specialty]] > 0);
    }
});