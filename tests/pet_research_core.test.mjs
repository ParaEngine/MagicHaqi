import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateResearchReleaseRewards, getResearchReleaseCandidates } from '../js/pet_research_core.js';

function pet(id, species, qualityId = 'N', extras = {}) {
    return { id, expeditionSpeciesId: species, quality: { id: qualityId }, ...extras };
}

test('研究放归仅选择非当前、未锁定、未派遣的重复 N/R 宠物', () => {
    const pets = [
        pet('current', 'bubble_spitter'),
        pet('duplicate-r', 'bubble_spitter', 'R'),
        pet('locked', 'bubble_spitter', 'N', { locked: true }),
        pet('dispatched', 'bubble_spitter', 'N'),
        pet('single', 'frost_beetle', 'N'),
        pet('sr', 'bubble_spitter', 'SR'),
    ];
    const candidates = getResearchReleaseCandidates(pets, {
        currentPetId: 'current', dispatchedPetIds: ['dispatched'],
    });

    assert.deepEqual(candidates.map(item => item.id), ['duplicate-r']);
});

test('研究放归只产出金币和远征培养材料', () => {
    const rewards = calculateResearchReleaseRewards([
        pet('normal', 'a', 'N'),
        pet('rare', 'b', 'R'),
    ]);

    assert.deepEqual(rewards, { coins: 65, materials: { manaDust: 1, attackCore: 1 } });
});