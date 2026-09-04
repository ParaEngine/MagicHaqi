import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveHomeDailyMission } from '../js/level_field.js';

const TODAY = '2026-08-28';

function pet(stats = {}) {
    return {
        id: 'pet-1',
        name: '豆豆',
        renameCount: 1,
        stats: { hunger: 80, clean: 80, mood: 80, bond: 80, ...stats },
    };
}

test('首次进入以星球探险作为当前行动', () => {
    const mission = resolveHomeDailyMission(pet(), {}, TODAY);

    assert.equal(mission.dailyComplete, false);
    assert.equal(mission.urgentCare, null);
    assert.equal(mission.frameKey, 'expedition');
    assert.equal(mission.action, '看星图');
    assert.equal(mission.title, '带豆豆去星球探险');
    assert.equal(mission.detail, '选定航线和伙伴，带回材料与新的远征记录');
});

test('伙伴需要照料时只选择数值最低的一项', () => {
    const mission = resolveHomeDailyMission(pet({ hunger: 28, clean: 12 }), {}, TODAY);

    assert.equal(mission.dailyComplete, false);
    assert.equal(mission.urgentCare?.key, 'clean');
    assert.equal(mission.frameKey, 'clean');
    assert.equal(mission.title, '先帮豆豆洗个澡');
    assert.equal(mission.action, '去洗澡');
    assert.equal(mission.urgentCare?.action, '去洗澡');
});

test('今日照料完成后承接新的星图', () => {
    const mission = resolveHomeDailyMission(pet(), {
        haqiHomeDailyCare: { dayKey: TODAY, petId: 'pet-1', stat: 'mood' },
    }, TODAY);

    assert.equal(mission.dailyComplete, true);
    assert.equal(mission.completedCare, true);
    assert.equal(mission.frameKey, 'complete');
    assert.equal(mission.action, '看星图');
    assert.equal(mission.title, '豆豆已经恢复精神');
    assert.equal(mission.detail, '今日照料目标已完成，可以一起查看新的星图');
});

test('当日远征完成后展示真实星球数和材料数', () => {
    const mission = resolveHomeDailyMission(pet(), {
        haqiExpeditionSettlement: {
            dailyExpeditionRoster: { dayKey: TODAY, exploredIds: ['forest', 'tundra'] },
            history: [{ expeditionId: `${TODAY}-forest`, completed: true, lootCount: 11 }],
        },
    }, TODAY);

    assert.equal(mission.dailyComplete, true);
    assert.equal(mission.completedExpeditionCount, 2);
    assert.equal(mission.expeditionLootCount, 11);
    assert.equal(mission.action, '看记录');
    assert.equal(mission.title, '今天已和豆豆完成探险');
    assert.equal(mission.detail, '已探索 2 颗星球，带回 11 份材料');
});

test('照料需求优先于当日远征完成状态', () => {
    const mission = resolveHomeDailyMission(pet({ hunger: 20 }), {
        haqiExpeditionSettlement: {
            dailyExpeditionRoster: { dayKey: TODAY, exploredIds: ['forest'] },
        },
    }, TODAY);

    assert.equal(mission.dailyComplete, false);
    assert.equal(mission.urgentCare?.key, 'hunger');
    assert.equal(mission.action, '去进食');
    assert.equal(mission.title, '先帮豆豆补充体力');
});

test('今日任务横幅的全部按钮文案固定为三个汉字', () => {
    const actions = [
        resolveHomeDailyMission(pet({ hunger: 10 }), {}, TODAY).action,
        resolveHomeDailyMission(pet({ clean: 10 }), {}, TODAY).action,
        resolveHomeDailyMission(pet({ mood: 10 }), {}, TODAY).action,
        resolveHomeDailyMission(pet({ bond: 10 }), {}, TODAY).action,
        resolveHomeDailyMission(pet(), {}, TODAY).action,
        resolveHomeDailyMission(pet(), {
            haqiExpeditionSettlement: {
                dailyExpeditionRoster: { dayKey: TODAY, exploredIds: ['forest'] },
            },
        }, TODAY).action,
    ];

    assert.deepEqual(actions, ['去进食', '去洗澡', '去玩耍', '去陪伴', '看星图', '看记录']);
    actions.forEach(action => assert.equal([...action].length, 3));
});

test('六张横幅分别按美术按钮区域定位文字', () => {
    const css = fs.readFileSync(new URL('../css/field.css', import.meta.url), 'utf8');

    ['hunger', 'clean', 'mood', 'bond', 'expedition', 'complete'].forEach(frameKey => {
        const rule = css.match(new RegExp(`\\.home-daily-mission\\.is-frame-${frameKey}\\s*\\{([^}]+)\\}`))?.[1] || '';
        assert.match(rule, /--home-daily-action-top:/);
        assert.match(rule, /--home-daily-action-left:/);
        assert.match(rule, /--home-daily-action-width:/);
        assert.match(rule, /--home-daily-action-height:/);
    });

    const actionRule = css.match(/\.home-daily-mission__action\s*\{([^}]+)\}/)?.[1] || '';
    assert.match(actionRule, /left:\s*var\(--home-daily-action-left\)/);
    assert.doesNotMatch(actionRule, /right:\s*9\.2%/);

    const hungerRule = css.match(/\.home-daily-mission\.is-frame-hunger\s*\{([^}]+)\}/)?.[1] || '';
    assert.match(hungerRule, /--home-daily-action-text-x:\s*11%/);
    assert.match(css, /\.home-daily-mission__action\s*>\s*span\s*\{[^}]*left:\s*var\(--home-daily-action-text-x,\s*0\)/);
});