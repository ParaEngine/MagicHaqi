const DOJO_ID = 'friendly_guard';
const TOKEN_SUCCESS_INTERVAL = 2;
const TOKEN_LIMIT = 2;
const REPLAY_REWARD_MULTIPLIER = 0.5;

export const FRIENDLY_GUARD_DOJO = Object.freeze({
    id: DOJO_ID,
    name: '守护大师友好道馆',
    theme: '护盾反击',
    floorCount: 5,
    teamSize: 3,
    floorMultipliers: Object.freeze([1, 1.12, 1.28, 1.46, 1.68]),
    firstClearRewards: Object.freeze([
        Object.freeze({ coins: 30, stellarEssence: 1 }),
        Object.freeze({ coins: 42, guardPlate: 1 }),
        Object.freeze({ coins: 56, stellarEssence: 2 }),
        Object.freeze({ coins: 72, guardPlate: 2 }),
        Object.freeze({ coins: 96, stellarEssence: 3 }),
    ]),
});

export const FRIENDLY_GUARDIAN_ROSTERS = Object.freeze([
    Object.freeze([
        Object.freeze({ id: 'rock-guard', name: '岩甲小卫', artKey: 'basilisk_emerald_noodle', maxHp: 142, attack: 38, defense: 18, magic: 20 }),
        Object.freeze({ id: 'moon-rider', name: '月湾巡游者', artKey: 'coral_leopard_frog', maxHp: 154, attack: 42, defense: 16, magic: 25 }),
        Object.freeze({ id: 'core-guard', name: '星核护卫', artKey: 'xingliu_linli', maxHp: 166, attack: 46, defense: 21, magic: 24 }),
    ]),
    Object.freeze([
        Object.freeze({ id: 'forest-watch', name: '密林守望', artKey: 'nine_tail_cloud_fox', maxHp: 176, attack: 50, defense: 22, magic: 28 }),
        Object.freeze({ id: 'tide-rider', name: '潮汐骑手', artKey: 'coral_leopard_frog', maxHp: 188, attack: 54, defense: 20, magic: 32 }),
        Object.freeze({ id: 'lava-vanguard', name: '熔岩前锋', artKey: 'flame_puppy_doudou', maxHp: 202, attack: 58, defense: 25, magic: 30 }),
    ]),
    Object.freeze([
        Object.freeze({ id: 'snow-sentry', name: '雪原哨兵', artKey: 'fenrir_snow_bite', maxHp: 216, attack: 63, defense: 27, magic: 34 }),
        Object.freeze({ id: 'ruin-reader', name: '遗迹解读者', artKey: 'kraken_gummy_tako', maxHp: 228, attack: 67, defense: 24, magic: 40 }),
        Object.freeze({ id: 'sky-fighter', name: '苍穹斗士', artKey: 'phoenix_spark_peep', maxHp: 240, attack: 72, defense: 29, magic: 38 }),
    ]),
    Object.freeze([
        Object.freeze({ id: 'amber-guard', name: '琥珀守卫', artKey: 'zodiac_tiger_tangtang', maxHp: 258, attack: 78, defense: 32, magic: 42 }),
        Object.freeze({ id: 'abyss-walker', name: '深渊行者', artKey: 'kraken_gummy_tako', maxHp: 274, attack: 83, defense: 30, magic: 47 }),
        Object.freeze({ id: 'thunder-lord', name: '雷鸣领主', artKey: 'ningguang_baoyuan', maxHp: 290, attack: 88, defense: 35, magic: 45 }),
    ]),
    Object.freeze([
        Object.freeze({ id: 'master-shield', name: '馆主之盾', artKey: 'basilisk_emerald_noodle', maxHp: 314, attack: 95, defense: 40, magic: 50 }),
        Object.freeze({ id: 'master-spear', name: '馆主之矛', artKey: 'zodiac_tiger_tangtang', maxHp: 332, attack: 101, defense: 36, magic: 56 }),
        Object.freeze({ id: 'friendly-master', name: '守护大师', artKey: 'phoenix_spark_peep', maxHp: 352, attack: 108, defense: 43, magic: 60 }),
    ]),
]);

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function dojoProgress(settlement) {
    const safeSettlement = settlement && typeof settlement === 'object' ? settlement : {};
    const current = safeSettlement.dojoProgress && typeof safeSettlement.dojoProgress === 'object'
        ? safeSettlement.dojoProgress
        : (safeSettlement.dojoProgress = {});
    current.successfulExpeditions = nonNegativeInteger(current.successfulExpeditions);
    current.issuedChallengeTokens = nonNegativeInteger(current.issuedChallengeTokens);
    current.challengeTokens = Math.min(TOKEN_LIMIT, nonNegativeInteger(current.challengeTokens));
    current.rewardedExpeditionRunIds = current.rewardedExpeditionRunIds && typeof current.rewardedExpeditionRunIds === 'object'
        ? current.rewardedExpeditionRunIds
        : {};
    current.towers = current.towers && typeof current.towers === 'object' ? current.towers : {};
    const tower = current.towers[DOJO_ID] && typeof current.towers[DOJO_ID] === 'object'
        ? current.towers[DOJO_ID]
        : (current.towers[DOJO_ID] = {});
    tower.highestClearedFloor = Math.min(FRIENDLY_GUARD_DOJO.floorCount, nonNegativeInteger(tower.highestClearedFloor));
    tower.clearedFloors = tower.clearedFloors && typeof tower.clearedFloors === 'object' ? tower.clearedFloors : {};
    tower.completedChallengeRunIds = tower.completedChallengeRunIds && typeof tower.completedChallengeRunIds === 'object'
        ? tower.completedChallengeRunIds
        : {};
    return { progress: current, tower };
}

function rewardForFloor(floor, multiplier) {
    const baseReward = FRIENDLY_GUARD_DOJO.firstClearRewards[floor - 1];
    if (!baseReward) return { coins: 0, materials: [] };
    return {
        coins: Math.floor(baseReward.coins * multiplier),
        materials: Object.entries(baseReward)
            .filter(([id]) => id !== 'coins')
            .map(([id, amount]) => ({ id, amount: Math.max(1, Math.floor(amount * multiplier)) })),
    };
}

export function recordSuccessfulExpeditionForDojo(settlement, runId) {
    const normalizedRunId = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const { progress } = dojoProgress(settlement);
    if (!normalizedRunId || progress.rewardedExpeditionRunIds[normalizedRunId]) {
        return { applied: false, challengeTokens: progress.challengeTokens, earnedTokens: 0 };
    }
    progress.rewardedExpeditionRunIds[normalizedRunId] = true;
    progress.successfulExpeditions += 1;
    const tokenDue = progress.successfulExpeditions % TOKEN_SUCCESS_INTERVAL === 0;
    const earnedTokens = tokenDue && progress.challengeTokens < TOKEN_LIMIT ? 1 : 0;
    progress.challengeTokens += earnedTokens;
    progress.issuedChallengeTokens += earnedTokens;
    return { applied: true, challengeTokens: progress.challengeTokens, earnedTokens };
}

export function getFriendlyGuardDojoStatus(settlement) {
    const { progress, tower } = dojoProgress(settlement);
    const nextFloor = tower.highestClearedFloor + 1;
    return {
        dojo: FRIENDLY_GUARD_DOJO,
        challengeTokens: progress.challengeTokens,
        highestClearedFloor: tower.highestClearedFloor,
        nextFloor: nextFloor <= FRIENDLY_GUARD_DOJO.floorCount ? nextFloor : null,
        clearedFloors: Object.keys(tower.clearedFloors).map(Number).filter(Number.isFinite).sort((left, right) => left - right),
    };
}

export function resolveFriendlyGuardDojoFloor(settlement, { floor, won, runId } = {}) {
    const normalizedFloor = Math.floor(Number(floor) || 0);
    const normalizedRunId = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const { progress, tower } = dojoProgress(settlement);
    const status = getFriendlyGuardDojoStatus(settlement);
    if (!normalizedRunId || !Number.isInteger(normalizedFloor) || normalizedFloor < 1 || normalizedFloor > FRIENDLY_GUARD_DOJO.floorCount) {
        return { applied: false, reason: 'invalid-challenge' };
    }
    if (tower.completedChallengeRunIds[normalizedRunId]) return { applied: false, reason: 'already-resolved' };
    const previouslyCleared = Boolean(tower.clearedFloors[normalizedFloor]);
    if (!previouslyCleared && normalizedFloor !== status.nextFloor) return { applied: false, reason: 'floor-locked' };
    if (!previouslyCleared && progress.challengeTokens < 1) return { applied: false, reason: 'no-challenge-token' };
    if (!previouslyCleared) progress.challengeTokens -= 1;
    if (!won) {
        tower.completedChallengeRunIds[normalizedRunId] = true;
        return { applied: true, won: false, consumedToken: !previouslyCleared, reward: { coins: 0, materials: [] } };
    }
    const replay = previouslyCleared;
    if (!replay) {
        tower.clearedFloors[normalizedFloor] = normalizedRunId;
        tower.highestClearedFloor = Math.max(tower.highestClearedFloor, normalizedFloor);
    }
    tower.completedChallengeRunIds[normalizedRunId] = true;
    return {
        applied: true,
        won: true,
        replay,
        consumedToken: !previouslyCleared,
        reward: rewardForFloor(normalizedFloor, replay ? REPLAY_REWARD_MULTIPLIER : 1),
    };
}

export function getFriendlyGuardDojoFloorRoster(floor) {
    const normalizedFloor = Math.floor(Number(floor) || 0);
    const multiplier = FRIENDLY_GUARD_DOJO.floorMultipliers[normalizedFloor - 1];
    const roster = FRIENDLY_GUARDIAN_ROSTERS[normalizedFloor - 1];
    if (!multiplier || !roster) return [];
    return roster.map((guardian, index) => ({
        ...guardian,
        id: `friendly-guard-${normalizedFloor}-${index + 1}`,
        battleStats: {
            maxHp: Math.round(guardian.maxHp * multiplier),
            attack: Math.round(guardian.attack * multiplier),
            defense: Math.round(guardian.defense * multiplier),
            magic: Math.round(guardian.magic * multiplier),
            luck: 5 + normalizedFloor + index,
        },
    }));
}