export const DAILY_MINIGAME_COUNT = 4;
export const DAILY_MINIGAME_TARGET_MINUTES = 10;

export const MINIGAME_DAILY_CATEGORIES = Object.freeze({
    action: Object.freeze({ name: '动作挑战', icon: '⚡', growthFocus: '反应与心情' }),
    puzzle: Object.freeze({ name: '益智解谜', icon: '🧩', growthFocus: '观察与专注' }),
    strategy: Object.freeze({ name: '策略思考', icon: '♟️', growthFocus: '规划与亲密' }),
    care: Object.freeze({ name: '生活照护', icon: '🌱', growthFocus: '照护与陪伴' }),
});

const MINIGAME_DAILY_PROFILES = Object.freeze({
    adventure: Object.freeze({ category: 'action', estimatedMinutes: 3 }),
    thunder: Object.freeze({ category: 'action', estimatedMinutes: 2 }),
    pet_snake: Object.freeze({ category: 'action', estimatedMinutes: 2 }),
    zuma: Object.freeze({ category: 'puzzle', estimatedMinutes: 2 }),
    match_three_pets: Object.freeze({ category: 'puzzle', estimatedMinutes: 2 }),
    sokoban: Object.freeze({ category: 'puzzle', estimatedMinutes: 3 }),
    laser_maze: Object.freeze({ category: 'puzzle', estimatedMinutes: 3 }),
    pet_tower_defense: Object.freeze({ category: 'strategy', estimatedMinutes: 3 }),
    billiards: Object.freeze({ category: 'strategy', estimatedMinutes: 3 }),
    lightbot: Object.freeze({ category: 'strategy', estimatedMinutes: 3 }),
    gomoku: Object.freeze({ category: 'strategy', estimatedMinutes: 4 }),
    pet_bath: Object.freeze({ category: 'care', estimatedMinutes: 2 }),
    food_hexcells: Object.freeze({ category: 'care', estimatedMinutes: 2 }),
    bakery_shop: Object.freeze({ category: 'care', estimatedMinutes: 3 }),
});

const MINIGAME_DURATION_SAMPLE_LIMIT = 12;
const MINIGAME_DURATION_MIN_SAMPLES = 3;
const MINIGAME_DURATION_MIN_SECONDS = 15;
const MINIGAME_DURATION_MAX_SECONDS = 30 * 60;

export function getMinigameDailyProfile(gameOrId) {
    const id = String(typeof gameOrId === 'object' ? gameOrId?.id : gameOrId || '').trim();
    const profile = MINIGAME_DAILY_PROFILES[id];
    if (!profile) return null;
    const category = MINIGAME_DAILY_CATEGORIES[profile.category];
    return category ? { ...profile, ...category } : null;
}

export function recordMinigameDuration(settings, gameId, durationSeconds, { completed = true } = {}) {
    const target = settings && typeof settings === 'object' ? settings : {};
    const id = String(gameId || '').trim();
    const seconds = Number(durationSeconds);
    if (!completed || !id || !getMinigameDailyProfile(id) || !Number.isFinite(seconds)
        || seconds < MINIGAME_DURATION_MIN_SECONDS || seconds > MINIGAME_DURATION_MAX_SECONDS) return null;
    const stats = target.minigameDurationStats && typeof target.minigameDurationStats === 'object'
        ? target.minigameDurationStats
        : (target.minigameDurationStats = {});
    const samples = (Array.isArray(stats[id]?.samples) ? stats[id].samples : [])
        .map(Number).filter(Number.isFinite)
        .concat(Math.round(seconds * 10) / 10)
        .slice(-MINIGAME_DURATION_SAMPLE_LIMIT);
    stats[id] = { samples, updatedAt: Date.now() };
    return stats[id];
}

export function getCalibratedMinigameMinutes(gameOrId, durationStats = {}) {
    const profile = getMinigameDailyProfile(gameOrId);
    if (!profile) return 0;
    const id = String(typeof gameOrId === 'object' ? gameOrId?.id : gameOrId || '').trim();
    const samples = (Array.isArray(durationStats?.[id]?.samples) ? durationStats[id].samples : [])
        .map(Number)
        .filter(seconds => Number.isFinite(seconds) && seconds >= MINIGAME_DURATION_MIN_SECONDS && seconds <= MINIGAME_DURATION_MAX_SECONDS)
        .sort((left, right) => left - right);
    if (samples.length < MINIGAME_DURATION_MIN_SAMPLES) return profile.estimatedMinutes;
    const middle = Math.floor(samples.length / 2);
    const medianSeconds = samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
    return Math.max(1, Math.round(medianSeconds / 30) / 2);
}

export function minigameDayKey(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function stableDailyScore(day, id) {
    let hash = 2166136261;
    const value = `${day}:${id}`;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function getDailyMinigameIds(games, { now = new Date(), count = DAILY_MINIGAME_COUNT, durationStats = {} } = {}) {
    const day = minigameDayKey(now);
    const visibleGames = (Array.isArray(games) ? games : [])
        .filter(game => game?.id && !game.hidden)
        .map((game, index) => ({ game, id: String(game.id), index, profile: getMinigameDailyProfile(game) }));
    const requestedCount = Math.max(0, Math.floor(Number(count) || 0));
    const categories = Object.keys(MINIGAME_DAILY_CATEGORIES);
    const plannedCount = Math.min(requestedCount, categories.length);
    const pools = categories.slice(0, plannedCount)
        .map(category => visibleGames.filter(entry => entry.profile?.category === category));
    if (plannedCount > 0 && pools.every(pool => pool.length)) {
        let combinations = [[]];
        pools.forEach(pool => {
            combinations = combinations.flatMap(combination => pool.map(entry => [...combination, entry]));
        });
        return combinations
            .map(entries => ({
                entries,
                durationDifference: Math.abs(entries.reduce((sum, entry) => sum + getCalibratedMinigameMinutes(entry.id, durationStats), 0) - DAILY_MINIGAME_TARGET_MINUTES),
                score: entries.reduce((sum, entry) => sum + stableDailyScore(day, entry.id), 0),
            }))
            .sort((left, right) => left.durationDifference - right.durationDifference || left.score - right.score)
            [0].entries.map(entry => entry.id);
    }
    return visibleGames
        .map(entry => ({ ...entry, score: stableDailyScore(day, entry.id) }))
        .sort((left, right) => left.score - right.score || left.index - right.index)
        .slice(0, requestedCount)
        .map(entry => entry.id);
}

export function normalizeMinigameCompletion(data = {}) {
    const source = data && typeof data === 'object' ? data : {};
    const status = String(source.status ?? source.result ?? source.outcome ?? '').trim().toLowerCase();
    const failedStatuses = new Set(['failed', 'failure', 'lost', 'lose', 'defeat', 'quit', 'cancelled', 'canceled', 'aborted', 'exit']);
    const completedStatuses = new Set(['completed', 'complete', 'passed', 'pass', 'success', 'succeeded', 'won', 'win', 'victory']);
    if (source.completed === false || source.passed === false || source.success === false || failedStatuses.has(status)) {
        return { completed: false, completionReason: failedStatuses.has(status) ? status : 'explicit-failure' };
    }
    if (source.completed === true || source.passed === true || source.success === true || completedStatuses.has(status)) {
        return { completed: true, completionReason: completedStatuses.has(status) ? status : 'explicit-success' };
    }
    return { completed: true, completionReason: 'legacy-finished' };
}

export function ensureDailyMinigameProgress(settings, { now = new Date() } = {}) {
    const target = settings && typeof settings === 'object' ? settings : {};
    const day = minigameDayKey(now);
    const current = target.minigameDaily;
    if (!current || current.day !== day) {
        target.minigameDaily = { day, rewardedGameIds: [], npcCommissions: {} };
    }
    const progress = target.minigameDaily;
    progress.rewardedGameIds = [...new Set((Array.isArray(progress.rewardedGameIds) ? progress.rewardedGameIds : [])
        .map(id => String(id || '').trim()).filter(Boolean))].slice(0, DAILY_MINIGAME_COUNT);
    progress.npcCommissions = progress.npcCommissions && typeof progress.npcCommissions === 'object'
        ? progress.npcCommissions
        : {};
    return progress;
}

export function settleDailyMinigame(settings, gameId, featuredIds, { now = new Date() } = {}) {
    const progress = ensureDailyMinigameProgress(settings, { now });
    const id = String(gameId || '').trim();
    const featured = new Set((Array.isArray(featuredIds) ? featuredIds : []).map(value => String(value || '').trim()));
    if (!id || !featured.has(id)) return { rewarded: false, reason: 'not-featured', progress };
    if (progress.rewardedGameIds.includes(id)) return { rewarded: false, reason: 'already-rewarded', progress };
    progress.rewardedGameIds.push(id);
    return { rewarded: true, reason: 'first-featured-completion', progress };
}

export function completeNpcCommission(settings, npc, { now = new Date(), relationshipId = '' } = {}) {
    const target = settings && typeof settings === 'object' ? settings : {};
    const progress = ensureDailyMinigameProgress(target, { now });
    const commission = npc?.dailyCommission;
    const npcId = String(npc?.id || '').trim();
    const progressId = String(relationshipId || npcId).trim();
    if (!npcId || !commission?.title) return { completed: false, reason: 'no-commission', progress };
    if (progress.npcCommissions[progressId]?.completedAt) return { completed: false, reason: 'already-completed', progress };
    progress.npcCommissions[progressId] = {
        title: String(commission.title).trim().slice(0, 48),
        completedAt: Date.now(),
    };
    const relationships = target.npcRelationships && typeof target.npcRelationships === 'object'
        ? target.npcRelationships
        : (target.npcRelationships = {});
    const previous = relationships[progressId] && typeof relationships[progressId] === 'object' ? relationships[progressId] : {};
    relationships[progressId] = {
        ...previous,
        completedCount: Math.max(0, Math.floor(Number(previous.completedCount) || 0)) + 1,
        lastCompletedDay: progress.day,
    };
    return {
        completed: true,
        reason: 'completed',
        progress,
        commission: progress.npcCommissions[progressId],
        relationship: relationships[progressId],
    };
}