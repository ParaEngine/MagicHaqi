import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG } from '../js/config.js';
import { state } from '../js/state.js';
import { loadUserProfile } from '../js/storage.js';

const PROFILE_KEY = 'magichaqi.offline.file.user/profile.json';

test('游客档案在再次进入游客模式时恢复核心进度', async (context) => {
    const originalLocalStorage = globalThis.localStorage;
    const profile = {
        coins: 1417,
        biofuel: 36,
        isPaid: true,
        planetName: 'Offline的星球',
        settings: {
            dailyReturn: { day: '2026-09-01', completed: ['care', 'expedition'] },
        },
        petOrder: ['pet_starwish'],
        currentPetId: 'pet_starwish',
        invitedPets: [{ id: 'invite_friend_pet', petId: 'friend_pet' }],
    };
    const values = new Map([[PROFILE_KEY, JSON.stringify(profile)]]);
    globalThis.localStorage = {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); },
    };
    context.after(() => {
        state.offlineMode = false;
        if (originalLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = originalLocalStorage;
    });

    state.offlineMode = true;
    await loadUserProfile();
    assert.deepEqual({
        coins: state.coins,
        biofuel: state.biofuel,
        isPaid: state.isPaid,
        planetName: state.planetName,
        currentPetId: state.currentPetId,
        petOrder: state.petOrder,
        dailyReturn: state.settings.dailyReturn,
        activeInvitedPetId: state.activeInvitedPet?.id,
    }, {
        coins: 1417,
        biofuel: 36,
        isPaid: true,
        planetName: 'Offline的星球',
        currentPetId: 'pet_starwish',
        petOrder: ['pet_starwish'],
        dailyReturn: { day: '2026-09-01', completed: ['care', 'expedition'] },
        activeInvitedPetId: 'invite_friend_pet',
    });

    state.coins = 0;
    state.biofuel = 0;
    state.planetName = '';
    state.currentPetId = null;
    state.settings = {};
    state.activeInvitedPet = null;

    await loadUserProfile();
    assert.equal(state.coins, 1417);
    assert.equal(state.biofuel, 36);
    assert.equal(state.planetName, 'Offline的星球');
    assert.equal(state.currentPetId, 'pet_starwish');
    assert.deepEqual(state.settings.dailyReturn.completed, ['care', 'expedition']);
    assert.equal(state.activeInvitedPet?.id, 'invite_friend_pet');
});

test('损坏的游客档案回落默认值且不沿用旧会话状态', async (context) => {
    const originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
        getItem(key) { return key === PROFILE_KEY ? '{invalid json' : null; },
        setItem() {},
    };
    context.after(() => {
        state.offlineMode = false;
        if (originalLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = originalLocalStorage;
    });

    state.offlineMode = true;
    state.coins = 9999;
    state.biofuel = 88;
    state.isPaid = true;
    state.planetName = '旧星球';
    state.settings = { stale: true };
    state.petOrder = ['stale_pet'];
    state.currentPetId = 'stale_pet';
    state.activeInvitedPet = { id: 'stale_invite' };

    await loadUserProfile();

    assert.equal(state.coins, CONFIG.initialCoins);
    assert.equal(state.biofuel, 0);
    assert.equal(state.isPaid, false);
    assert.equal(state.planetName, '');
    assert.deepEqual(state.settings, {});
    assert.deepEqual(state.petOrder, []);
    assert.equal(state.currentPetId, null);
    assert.equal(state.activeInvitedPet, null);
});