import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../js/expedition_capture_core.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const { calculateExpeditionCaptureChance } = context.MHExpeditionCapture;

const rules = {
    baseChance: 0.015,
    lowHpBonus: 0.38,
    curveExponent: 1.8,
    minChance: 0.01,
    maxChance: 0.45,
    absoluteMaxChance: 0.95,
    chanceMultiplierByRarity: { 普通: 1, 稀有: 0.78, 精英: 0.58, 史诗: 0.4, 传说: 0.28 },
};

test('稀有度降低基础捕捉率，但不吞掉伙伴和技能加成', () => {
    const enemy = { hp: 10, maxHp: 100, rarity: '传说', captureModifier: 0.4 };
    const base = calculateExpeditionCaptureChance(enemy, {}, rules);
    const specialty = calculateExpeditionCaptureChance(enemy, { captureBonus: 0.03 }, rules);
    const specialtyAndRelic = calculateExpeditionCaptureChance(enemy, { captureBonus: 0.11 }, rules);
    const allBonuses = calculateExpeditionCaptureChance(enemy, {
        captureBonus: 0.11,
        lowHpCaptureBonus: 0.12,
    }, rules);

    assert.ok(base > 0.03 && base < 0.04);
    assert.ok(Math.abs(specialty - base - 0.03) < 1e-12);
    assert.ok(Math.abs(specialtyAndRelic - base - 0.11) < 1e-12);
    assert.ok(Math.abs(allBonuses - base - 0.23) < 1e-12);
});

test('持续压低生命值会提高所有稀有度的基础捕捉率', () => {
    for (const rarity of ['普通', '稀有', '精英', '史诗', '传说']) {
        const healthy = calculateExpeditionCaptureChance({ hp: 75, maxHp: 100, rarity }, {}, rules);
        const wounded = calculateExpeditionCaptureChance({ hp: 35, maxHp: 100, rarity }, {}, rules);
        const critical = calculateExpeditionCaptureChance({ hp: 10, maxHp: 100, rarity }, {}, rules);

        assert.ok(wounded > healthy, `${rarity}目标从 75% 降到 35% HP 时捕捉率应提高`);
        assert.ok(critical > wounded, `${rarity}目标从 35% 降到 10% HP 时捕捉率应继续提高`);
    }
});

test('控血分析仪只在敌方生命低于或等于 35% 时生效', () => {
    const healthyEnemy = { hp: 36, maxHp: 100, rarity: '普通', captureModifier: 1 };
    const lowHpEnemy = { hp: 35, maxHp: 100, rarity: '普通', captureModifier: 1 };
    const player = { lowHpCaptureBonus: 0.12 };

    const healthyWithoutBonus = calculateExpeditionCaptureChance(healthyEnemy, {}, rules);
    const healthyWithBonus = calculateExpeditionCaptureChance(healthyEnemy, player, rules);
    const lowHpWithoutBonus = calculateExpeditionCaptureChance(lowHpEnemy, {}, rules);
    const lowHpWithBonus = calculateExpeditionCaptureChance(lowHpEnemy, player, rules);

    assert.equal(healthyWithBonus, healthyWithoutBonus);
    assert.ok(Math.abs(lowHpWithBonus - lowHpWithoutBonus - 0.12) < 1e-12);
});

test('所有叠加仍受全局安全上限约束', () => {
    const enemy = { hp: 0, maxHp: 100, rarity: '普通', captureModifier: 1.12 };
    const chance = calculateExpeditionCaptureChance(enemy, {
        captureBonus: 2,
        lowHpCaptureBonus: 1,
    }, rules);

    assert.equal(chance, 0.95);
});

test('整体倍率只提高基础捕捉率，额外加成保持标注百分点，且不突破安全上限', () => {
    const enemy = { hp: 35, maxHp: 100, rarity: '稀有', captureModifier: 0.91 };
    const player = { captureBonus: 0.08, lowHpCaptureBonus: 0.12 };
    const base = calculateExpeditionCaptureChance(enemy, {}, rules);
    const baseline = calculateExpeditionCaptureChance(enemy, player, rules);
    const boosted = calculateExpeditionCaptureChance(enemy, player, { ...rules, overallMultiplier: 1.1 });
    const capped = calculateExpeditionCaptureChance(enemy, { captureBonus: 2 }, {
        ...rules,
        overallMultiplier: 1.1,
    });

    assert.ok(Math.abs(boosted - (base * 1.1 + 0.2)) < 1e-12);
    assert.ok(Math.abs(boosted - baseline - base * 0.1) < 1e-12);
    assert.equal(capped, 0.95);
});