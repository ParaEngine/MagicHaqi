import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getPlanetPetLimit,
    MAX_PLANET_PETS,
    VIP_MAX_PLANET_PETS,
} from '../js/petLifecycle.js';

test('普通用户的星球宠物容量为 30 只', () => {
    assert.equal(MAX_PLANET_PETS, 30);
    assert.equal(getPlanetPetLimit(false), 30);
});

test('VIP 用户的星球宠物容量为 50 只', () => {
    assert.equal(VIP_MAX_PLANET_PETS, 50);
    assert.equal(getPlanetPetLimit(true), 50);
});
