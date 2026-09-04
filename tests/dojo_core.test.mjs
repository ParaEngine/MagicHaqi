import assert from 'node:assert/strict';
import test from 'node:test';
import { getFriendlyGuardDojoFloorRoster, getFriendlyGuardDojoStatus, recordSuccessfulExpeditionForDojo, resolveFriendlyGuardDojoFloor } from '../js/dojo_core.js';

test('每两次成功远征发放一张道馆挑战函，且同一 runId 不可重复累计', () => {
    const settlement = {};
    assert.equal(recordSuccessfulExpeditionForDojo(settlement, 'run-1').earnedTokens, 0);
    assert.equal(recordSuccessfulExpeditionForDojo(settlement, 'run-2').earnedTokens, 1);
    assert.equal(recordSuccessfulExpeditionForDojo(settlement, 'run-2').applied, false);
    assert.equal(getFriendlyGuardDojoStatus(settlement).challengeTokens, 1);
});

test('挑战函已满时不会将错过的发放次数延后补发', () => {
    const settlement = {};
    for (let index = 1; index <= 4; index += 1) recordSuccessfulExpeditionForDojo(settlement, `run-${index}`);
    assert.equal(getFriendlyGuardDojoStatus(settlement).challengeTokens, 2);
    resolveFriendlyGuardDojoFloor(settlement, { floor: 1, won: true, runId: 'dojo-first' });
    recordSuccessfulExpeditionForDojo(settlement, 'run-5');
    assert.equal(recordSuccessfulExpeditionForDojo(settlement, 'run-6').earnedTokens, 1);
    assert.equal(getFriendlyGuardDojoStatus(settlement).challengeTokens, 2);
});

test('守护道馆按层解锁，首通消耗挑战函，重打奖励减半且不再消耗挑战函', () => {
    const settlement = {};
    recordSuccessfulExpeditionForDojo(settlement, 'run-1');
    recordSuccessfulExpeditionForDojo(settlement, 'run-2');

    assert.equal(resolveFriendlyGuardDojoFloor(settlement, { floor: 2, won: true, runId: 'dojo-locked' }).reason, 'floor-locked');
    const firstClear = resolveFriendlyGuardDojoFloor(settlement, { floor: 1, won: true, runId: 'dojo-first' });
    assert.equal(firstClear.won, true);
    assert.equal(firstClear.consumedToken, true);
    assert.equal(firstClear.reward.coins, 30);
    assert.equal(resolveFriendlyGuardDojoFloor(settlement, { floor: 1, won: true, runId: 'dojo-first' }).reason, 'already-resolved');
    const replay = resolveFriendlyGuardDojoFloor(settlement, { floor: 1, won: true, runId: 'dojo-replay' });
    assert.equal(replay.replay, true);
    assert.equal(replay.consumedToken, false);
    assert.equal(replay.reward.coins, 15);
    assert.equal(getFriendlyGuardDojoStatus(settlement).nextFloor, 2);
});

test('每层馆主阵容固定为三只宠物，且随层数递进', () => {
    const floorOne = getFriendlyGuardDojoFloorRoster(1);
    const floorFive = getFriendlyGuardDojoFloorRoster(5);
    assert.equal(floorOne.length, 3);
    assert.equal(floorFive.length, 3);
    assert.ok(floorFive[2].battleStats.maxHp > floorOne[2].battleStats.maxHp);
    assert.deepEqual(getFriendlyGuardDojoFloorRoster(0), []);
});