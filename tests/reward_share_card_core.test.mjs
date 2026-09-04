import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRewardShareCardSummary } from '../js/reward_share_card_core.js';

test('builds a share summary around the current companion and first meaningful reward', () => {
    const summary = buildRewardShareCardSummary({
        companion: { name: '米米' },
        planetName: '荧光沼泽',
        treasure: { name: '星光温室', icon: '🌿', firstOwned: true },
        rarePets: [{ name: '月影龙', qualityId: 'SSR' }],
        series: [{ name: '矿物', icon: '💎', currentCount: 5, totalCount: 5, newlyCompleted: true, newItems: [] }],
    });

    assert.equal(summary.title, '米米的远征成果');
    assert.equal(summary.experience, '我和米米从荧光沼泽带回了星光温室');
    assert.equal(summary.primaryKind, 'home_treasure');
    assert.deepEqual(summary.highlights.map(item => item.kind), ['home_treasure', 'rare_pet', 'collectible_series']);
    assert.match(summary.shareText, /哈奇星球/);
});

test('provides a useful fallback when an expedition has no featured reward', () => {
    const summary = buildRewardShareCardSummary();
    assert.equal(summary.companionName, '我的抱抱龙');
    assert.equal(summary.destination, '未知星域');
    assert.equal(summary.primaryKind, 'expedition');
    assert.deepEqual(summary.highlights, []);
});