import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findHelloLearnerSessionCompletion,
    HELLO_LEARNER_REWARD_COINS,
    settleHelloLearnerReward,
} from '../js/hello_learner_rewards.js';

test('只识别本次学习会话开始后的课程或情景完成记录', () => {
    const startedAt = Date.parse('2026-09-05T08:00:00.000Z');
    const progress = {
        completedLessons: {
            oldLesson: { completedAt: '2026-09-05T07:59:59.000Z' },
            newLesson: { completedAt: '2026-09-05T08:02:00.000Z' },
        },
        roleplayOutcomes: {
            newRoleplay: { completedAt: '2026-09-05T08:03:00.000Z' },
        },
    };

    assert.deepEqual(findHelloLearnerSessionCompletion(progress, startedAt), {
        type: 'roleplay',
        id: 'newRoleplay',
        completedAt: '2026-09-05T08:03:00.000Z',
        completedAtMs: Date.parse('2026-09-05T08:03:00.000Z'),
    });
    assert.equal(findHelloLearnerSessionCompletion(progress, Date.parse('2026-09-05T09:00:00.000Z')), null);
});

test('同一完成记录只奖励一次且每天最多奖励一次', () => {
    const settings = {};
    const now = new Date('2026-09-05T09:00:00.000Z');
    const first = { type: 'lesson', id: 'introductions', completedAtMs: now.getTime() };
    const second = { type: 'roleplay', id: 'coffee-shop', completedAtMs: now.getTime() + 1000 };

    assert.deepEqual(settleHelloLearnerReward(settings, first, { now }), {
        rewarded: true,
        reason: 'new-completion',
        coins: HELLO_LEARNER_REWARD_COINS,
        progress: settings.helloLearnerRewards,
        completionId: `lesson:introductions:${now.getTime()}`,
    });
    assert.equal(settleHelloLearnerReward(settings, first, { now }).reason, 'already-rewarded');
    assert.equal(settleHelloLearnerReward(settings, second, { now }).reason, 'daily-limit');
});

test('跨日后允许新的学习完成记录再次领奖', () => {
    const settings = {};
    const firstDay = new Date('2026-09-05T09:00:00');
    const secondDay = new Date('2026-09-06T09:00:00');
    settleHelloLearnerReward(settings, { type: 'lesson', id: 'one', completedAtMs: firstDay.getTime() }, { now: firstDay });

    const result = settleHelloLearnerReward(settings, { type: 'lesson', id: 'two', completedAtMs: secondDay.getTime() }, { now: secondDay });
    assert.equal(result.rewarded, true);
    assert.equal(result.coins, HELLO_LEARNER_REWARD_COINS);
});