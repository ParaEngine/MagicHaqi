import assert from 'node:assert/strict';
import test from 'node:test';

import { hasCapturedFamousPet } from '../js/pet_capture_unlock_core.js';

const famousPet = {
    id: 'flame_puppy_doudou',
    imageSheetUrl: 'https://cdn.example.com/pets/flame-puppy.webp',
};

test('an uncaptured famous pet cannot be hatched again', () => {
    assert.equal(hasCapturedFamousPet(famousPet, [], []), false);
});

test('a matching expedition pet or permanent capture history unlocks rehatching', () => {
    const expeditionPet = {
        source: 'expedition',
        expeditionSpeciesId: 'sugar_patrol',
        imageSheetUrl: 'https://cdn.example.com/pets/flame-puppy.webp?version=2',
    };
    assert.equal(hasCapturedFamousPet(famousPet, [expeditionPet], []), true);
    assert.equal(hasCapturedFamousPet(famousPet, [], [expeditionPet]), true);
    assert.equal(hasCapturedFamousPet(famousPet, [], [{ capturedPets: [expeditionPet] }]), true);
});

test('a different captured species does not unlock the famous pet', () => {
    const expeditionPet = {
        source: 'expedition',
        expeditionSpeciesId: 'frost_beetle',
        imageSheetUrl: 'https://cdn.example.com/pets/frost-beetle.webp',
    };
    assert.equal(hasCapturedFamousPet(famousPet, [expeditionPet], []), false);
});