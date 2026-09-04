function cleanText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

export function buildRewardShareCardSummary({ companion = null, planetName = '', treasure = null, rarePets = [], series = [] } = {}) {
    const companionName = cleanText(companion?.name, '我的抱抱龙');
    const destination = cleanText(planetName, '未知星域');
    const visibleSeries = series.filter(item => item?.newlyCompleted || item?.newItems?.length);
    const highlights = [];

    if (treasure) highlights.push({ kind: 'home_treasure', icon: treasure.icon || '🏡', title: cleanText(treasure.name, '家园珍宝'), detail: treasure.firstOwned ? '首件家园珍宝' : '家园设施获得提升' });
    for (const pet of rarePets.slice(0, 2)) highlights.push({ kind: 'rare_pet', icon: '⭐', title: cleanText(pet.name, '稀有伙伴'), detail: `${cleanText(pet.qualityId, '稀有')}伙伴已加入队伍` });
    for (const item of visibleSeries.slice(0, 2)) highlights.push({ kind: 'collectible_series', icon: item.icon || '🏛️', title: `${cleanText(item.name, '收藏')}系列`, detail: item.newlyCompleted ? '系列首次集齐' : `收藏进度 ${Number(item.currentCount) || 0} / ${Number(item.totalCount) || 0}` });

    const primary = highlights[0] || { kind: 'expedition', icon: '🧭', title: '远征记录', detail: '平安完成本次探索' };
    const title = `${companionName}的远征成果`;
    const experience = `我和${companionName}从${destination}带回了${primary.title}`;
    return {
        companionName,
        destination,
        title,
        experience,
        highlights: highlights.slice(0, 3),
        shareText: `${experience}。这是我们在哈奇星球共同留下的新记忆。`,
        primaryKind: primary.kind,
    };
}