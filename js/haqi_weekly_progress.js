function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function weekStart(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    date.setHours(0, 0, 0, 0);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date.getTime();
}

const THEME_RESEARCH = Object.freeze([
    Object.freeze({ id: 'abyssal', label: '深海回音', biomes: Object.freeze(['月湾海滩', '荧光沼泽']) }),
    Object.freeze({ id: 'molten', label: '熔岩地核', biomes: Object.freeze(['糖晶沙漠']) }),
    Object.freeze({ id: 'wasteland', label: '废土朋克', biomes: Object.freeze(['迷雾森林', '碎岩遗迹']) }),
    Object.freeze({ id: 'starcore', label: '远古星核', biomes: Object.freeze(['泡泡草地']) }),
]);

export const HAQI_WEEKLY_REWARD_COINS = 120;

function themeForWeek(start) {
    const weekNumber = Math.floor(start / (7 * 24 * 60 * 60 * 1000));
    return THEME_RESEARCH[weekNumber % THEME_RESEARCH.length];
}

export function getHaqiWeeklyProgress({ history = [], bridge = {}, claimedWeekStarts = [], now = Date.now() } = {}) {
    const start = weekStart(now);
    const completedHistory = (Array.isArray(history) ? history : []).filter((entry) =>
        entry?.completed === true && Number(entry.finishedAt) >= start && Number(entry.finishedAt) <= now
    );
    const completedExpeditions = completedHistory.length;
    const theme = themeForWeek(start);
    const themeExpeditions = completedHistory.filter((entry) => theme.biomes.includes(String(entry?.expeditionBiome || ''))).length;
    const research = nonNegativeInteger(bridge.research);
    const activeSeries = Array.isArray(bridge.activeSeriesIds) ? bridge.activeSeriesIds.length : 0;
    const goals = [
        { id: 'weekly-expeditions', label: '完整通关 2 次两章远征', current: Math.min(2, completedExpeditions), target: 2 },
        { id: `weekly-theme-${theme.id}`, label: `完整通关 2 次「${theme.label}」生态远征`, hint: `目标星球：${theme.biomes.join(' / ')} · 需击败第二章首领`, current: Math.min(2, themeExpeditions), target: 2, themeId: theme.id, themeLabel: theme.label },
        { id: 'weekly-research', label: '积累 3 条矿区研究线索', current: Math.min(3, research), target: 3 },
        { id: 'weekly-museum', label: '激活 1 个博物馆系列', current: Math.min(1, activeSeries), target: 1 },
    ].map((goal) => ({ ...goal, complete: goal.current >= goal.target }));
    const completed = goals.filter((goal) => goal.complete).length;
    const claimed = (Array.isArray(claimedWeekStarts) ? claimedWeekStarts : []).some(value => Number(value) === start);
    return {
        weekStart: start,
        theme: {
            id: theme.id,
            label: theme.label,
            biomes: [...theme.biomes],
        },
        completed,
        total: goals.length,
        goals,
        rewardCoins: HAQI_WEEKLY_REWARD_COINS,
        claimed,
        claimable: completed === goals.length && !claimed,
    };
}