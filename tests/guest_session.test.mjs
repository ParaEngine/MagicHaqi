import assert from 'node:assert/strict';
import test from 'node:test';
import { hasGuestSession, setGuestSessionActive } from '../js/guest_session.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
    };
}

test('游客会话标记可在同标签页刷新后恢复并主动清除', () => {
    const storage = createStorage();

    assert.equal(hasGuestSession(storage), false);
    assert.equal(setGuestSessionActive(true, storage), true);
    assert.equal(hasGuestSession(storage), true);
    assert.equal(setGuestSessionActive(false, storage), true);
    assert.equal(hasGuestSession(storage), false);
});

test('游客会话存储不可用时安全回落', () => {
    const storage = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); },
    };

    assert.equal(hasGuestSession(storage), false);
    assert.equal(setGuestSessionActive(true, storage), false);
});