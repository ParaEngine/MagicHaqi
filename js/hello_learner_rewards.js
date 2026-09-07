export const HELLO_LEARNER_REWARD_COINS = 20;
export const HELLO_LEARNER_DAILY_REWARD_LIMIT = 1;

function dayKey(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function completionEntries(progress = {}) {
    const records = [];
    Object.entries(progress.completedLessons || {}).forEach(([id, value]) => {
        records.push({ type: 'lesson', id, completedAt: value?.completedAt });
    });
    Object.entries(progress.roleplayOutcomes || {}).forEach(([id, value]) => {
        records.push({ type: 'roleplay', id, completedAt: value?.completedAt });
    });
    return records
        .map(record => ({ ...record, completedAtMs: Date.parse(record.completedAt || '') }))
        .filter(record => record.id && Number.isFinite(record.completedAtMs));
}

export function findHelloLearnerSessionCompletion(progress, startedAt) {
    const threshold = Number(startedAt);
    if (!Number.isFinite(threshold)) return null;
    return completionEntries(progress)
        .filter(record => record.completedAtMs >= threshold)
        .sort((left, right) => right.completedAtMs - left.completedAtMs)[0] || null;
}

export function settleHelloLearnerReward(settings, completion, { now = new Date() } = {}) {
    const target = settings && typeof settings === 'object' ? settings : {};
    const currentDay = dayKey(now);
    const progress = target.helloLearnerRewards && typeof target.helloLearnerRewards === 'object'
        ? target.helloLearnerRewards
        : (target.helloLearnerRewards = {});
    if (progress.day !== currentDay) {
        progress.day = currentDay;
        progress.rewardedCompletionIds = [];
    }
    progress.rewardedCompletionIds = [...new Set((Array.isArray(progress.rewardedCompletionIds)
        ? progress.rewardedCompletionIds
        : []).map(String).filter(Boolean))].slice(0, HELLO_LEARNER_DAILY_REWARD_LIMIT);
    if (!completion?.id || !['lesson', 'roleplay'].includes(completion.type) || !Number.isFinite(completion.completedAtMs)) {
        return { rewarded: false, reason: 'invalid-completion', progress };
    }
    const completionId = `${completion.type}:${completion.id}:${completion.completedAtMs}`;
    if (progress.rewardedCompletionIds.includes(completionId)) {
        return { rewarded: false, reason: 'already-rewarded', progress, completionId };
    }
    if (progress.rewardedCompletionIds.length >= HELLO_LEARNER_DAILY_REWARD_LIMIT) {
        return { rewarded: false, reason: 'daily-limit', progress, completionId };
    }
    progress.rewardedCompletionIds.push(completionId);
    return { rewarded: true, reason: 'new-completion', coins: HELLO_LEARNER_REWARD_COINS, progress, completionId };
}