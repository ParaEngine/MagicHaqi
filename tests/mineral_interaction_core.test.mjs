import assert from 'node:assert/strict';
import test from 'node:test';
import { mineralInteractionForDepth, remainingHammerHits } from '../js/mineral_interaction_core.js';

test('矿区每几层轮换不同互动玩法', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(depth => mineralInteractionForDepth(depth).id), [
        'claw', 'resonance', 'trace', 'hammer', 'resonance', 'trace',
    ]);
});

test('深层挑战目标更多、时间更短且判定窗口更小', () => {
    const shallow = mineralInteractionForDepth(1);
    const deep = mineralInteractionForDepth(10);
    assert.ok(deep.requiredHits > shallow.requiredHits);
    assert.ok(deep.durationSeconds < shallow.durationSeconds);
    assert.ok(deep.targetSpeed > shallow.targetSpeed);
    assert.ok(deep.targetRadius < shallow.targetRadius);
    assert.ok(deep.weakPointMs < shallow.weakPointMs);
    assert.ok(deep.resonanceWindow < shallow.resonanceWindow);
    assert.ok(deep.decoyCount > shallow.decoyCount);
    assert.ok(deep.tracePathWidth < shallow.tracePathWidth);
});

test('每深入一层都会提高可感知的矿层强度', () => {
    const levels = Array.from({ length:12 }, (_, index) => mineralInteractionForDepth(index + 1));
    levels.slice(1).forEach((level, index) => {
        const previous = levels[index];
        assert.ok(level.durationSeconds < previous.durationSeconds);
        assert.ok(level.targetSpeed > previous.targetSpeed);
        assert.ok(level.targetRadius < previous.targetRadius);
        assert.ok(level.driftAmplitude > previous.driftAmplitude || level.driftAmplitude === 42);
    });
});

test('精英与首领沿用弱点破岩并具有独立目标', () => {
    assert.equal(mineralInteractionForDepth(8, 'elite').id, 'hammer');
    assert.equal(mineralInteractionForDepth(12, 'boss').requiredHits, 7);
});

test('弱点矿脉提前耗尽时按本段剩余进度继续生成目标', () => {
    assert.equal(remainingHammerHits(3, 2), 1);
    assert.equal(remainingHammerHits(3, 3), 0);
    assert.equal(remainingHammerHits(3, 5), 0);
});