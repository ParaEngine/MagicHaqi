import { CONFIG, getShopItemsByType } from './config.js';
import { dnaDietPreference } from './dna.js';
import { t } from './i18n.js';
import { escapeHtml, randInt, showToast } from './utils.js';
import { eatFood, playPetClickFeedback, playPetHappy, sayOnPet, scanAndMount } from './pet.js';
import SoundManager from './soundManager.js';

export const BATH_SEQUENCE_MS = 10000;
export const BATH_COMPLETE_FEEDBACK_MS = 3000;
export const BATH_COMPLETE_LINES = [
    'petBathDone1',
    'petBathDone2',
    'petBathDone3',
];

export function randomBathCompleteLine() {
    return t(BATH_COMPLETE_LINES[randInt(0, BATH_COMPLETE_LINES.length - 1)]);
}

const soundManager = SoundManager.getInstance();
const FOOD_EAT_MIN_MS = 3000;
const FOOD_EAT_MAX_MS = 5000;
const FOOD_EAT_MIN_ENERGY = 12;
const FOOD_EAT_MAX_ENERGY = 30;
const STORY_FEED_VISIBLE_MS = 3200;

function foodItems() {
    return getShopItemsByType('food');
}

function foodEnergyValue(item) {
    const stats = item?.stat || {};
    const energy = Object.values(stats).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    return energy || FOOD_EAT_MIN_ENERGY;
}

export function foodEatDurationMs(item) {
    const energy = foodEnergyValue(item);
    const ratio = Math.max(0, Math.min(1, (energy - FOOD_EAT_MIN_ENERGY) / (FOOD_EAT_MAX_ENERGY - FOOD_EAT_MIN_ENERGY)));
    return Math.round(FOOD_EAT_MIN_MS + (FOOD_EAT_MAX_MS - FOOD_EAT_MIN_MS) * ratio);
}

function preferredFoodCandidates(pet) {
    const preference = dnaDietPreference(pet?.dna || '');
    const usable = foodItems().filter(item => !item.hiddenFromShop && !item.unlimited && item.id !== 'food_large_feed' && !item.specialStageEffect);
    if (preference === 'meat') return usable.filter(item => item.foodKind === 'meat');
    if (preference === 'vegetables') return usable.filter(item => item.foodKind === 'vegetables');
    return usable.filter(item => item.foodKind === 'meat' || item.foodKind === 'vegetables' || item.foodKind === 'both');
}

export function pickRandomPreferredFood(pet) {
    const candidates = preferredFoodCandidates(pet);
    const fallback = foodItems().filter(item => item.foodKind === 'both' && !item.hiddenFromShop && !item.unlimited);
    const list = candidates.length ? candidates : fallback.length ? fallback : foodItems();
    return list[randInt(0, list.length - 1)] || null;
}

function ensurePetFx(petEl) {
    if (!petEl) return null;
    let fx = petEl.querySelector(':scope > .mh-pet-fx');
    if (!fx) {
        fx = document.createElement('div');
        fx.className = 'mh-pet-fx';
        petEl.appendChild(fx);
    }
    return fx;
}

function spawnFoodPieces(petEl, foodItem, count = 10) {
    const fx = ensurePetFx(petEl);
    if (!fx) return;
    for (let index = 0; index < count; index += 1) {
        const piece = document.createElement('span');
        piece.className = 'mh-food-shard';
        piece.textContent = foodItem?.emoji || '🍽️';
        piece.style.setProperty('--mh-food-start-x', `${Math.round(Math.random() * 36 - 18)}px`);
        piece.style.setProperty('--mh-food-burst-x', `${Math.round(Math.random() * 92 - 46)}px`);
        piece.style.setProperty('--mh-food-burst-y', `${Math.round(-26 - Math.random() * 34)}px`);
        piece.style.setProperty('--mh-food-fall-y', `${Math.round(42 + Math.random() * 72)}px`);
        piece.style.setProperty('--mh-food-size', `${Math.round(13 + Math.random() * 13)}px`);
        piece.style.setProperty('--mh-food-rot', `${Math.round(Math.random() * 420 - 210)}deg`);
        piece.style.setProperty('--mh-food-delay', `${(Math.random() * 0.18).toFixed(2)}s`);
        fx.appendChild(piece);
        piece.addEventListener('animationend', () => piece.remove(), { once: true });
    }
}

function foodSvgHtml(item) {
    const icon = escapeHtml(item?.emoji || '');
    return `<span class="mh-furniture-svg mh-food-svg" aria-hidden="true"><svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><text x="80" y="105" text-anchor="middle" font-size="82">${icon}</text></svg></span>`;
}

function servingFoodCutHtml(item) {
    const cutBands = [
        [10, 10, 34, 18, -7, -8, -20],
        [34, 18, 34, 50, 7, -7, 20],
        [34, 50, 66, 50, -7, -5, -20],
        [66, 50, 66, 82, 7, -6, 20],
        [66, 82, 90, 90, -4, 8, 0],
    ];
    const slices = cutBands.map(([leftTop, rightTop, leftBottom, rightBottom, exitX, exitY, rot], index) => `
        <span class="mh-serving-food-slice" style="--mh-slice-index:${index};--mh-slice-clip:polygon(0 ${leftTop}%, 100% ${rightTop}%, 100% ${rightBottom}%, 0 ${leftBottom}%);--mh-slice-x:${exitX}px;--mh-slice-y:${exitY}px;--mh-slice-rot:${rot}deg;--mh-slice-mid-x:${(exitX * 0.34).toFixed(1)}px;--mh-slice-mid-y:${(exitY * 0.34).toFixed(1)}px;--mh-slice-mid-rot:${(rot * 0.34).toFixed(1)}deg">
            <span class="mh-serving-food-slice-art">${foodSvgHtml(item)}</span>
        </span>
    `).join('');
    return `<span class="mh-serving-food-cut-stack" aria-hidden="true">${slices}</span>`;
}

function setServedFoodCutTiming(el, durationMs) {
    const slices = Array.from(el?.querySelectorAll?.('.mh-serving-food-slice') || []);
    if (!slices.length) return;
    const stepMs = Math.max(180, durationMs / slices.length);
    const sliceMs = Math.min(520, Math.max(260, stepMs * 0.62));
    slices.forEach((slice, index) => {
        slice.style.setProperty('--mh-slice-delay', `${Math.max(0, stepMs * index - 40).toFixed(0)}ms`);
        slice.style.setProperty('--mh-slice-dur', `${sliceMs.toFixed(0)}ms`);
    });
}

function showServingFoodCut(petEl, foodItem, durationMs) {
    const fx = ensurePetFx(petEl);
    if (!fx) return null;
    const food = document.createElement('span');
    food.className = 'mh-story-serving-food mh-room-furniture mh-serving-food';
    food.dataset.itemType = 'food';
    food.innerHTML = servingFoodCutHtml(foodItem);
    food.style.setProperty('--mh-eat-duration', `${Math.max(0.6, durationMs / 1000).toFixed(2)}s`);
    setServedFoodCutTiming(food, durationMs);
    fx.appendChild(food);
    requestAnimationFrame(() => food.classList.add('mh-serving-food-consuming'));
    setTimeout(() => {
        food.classList.add('mh-serving-food-dissolve');
        setTimeout(() => food.remove(), 220);
    }, Math.max(600, durationMs));
    return food;
}

export async function runFeedInteraction({ pet, petEl, foodItem = null, onFeedItem = null, source = 'story' } = {}) {
    const item = foodItem || pickRandomPreferredFood(pet);
    if (!pet || !item) return false;
    const eatingMs = foodEatDurationMs(item);
    const eaten = onFeedItem
        ? await onFeedItem(item.id, { source, delayEffectsMs: 0, sayDelayMs: eatingMs, skipNotify: true })
        : eatFood(pet, item, { delayEffectsMs: 0, sayDelayMs: eatingMs });
    if (!eaten) return false;
    petEl?.classList.add('mh-pet-eating');
    soundManager.playFoodEat();
    showServingFoodCut(petEl, item, eatingMs);
    spawnFoodPieces(petEl, item, 5);
    const crumbleTimer = setInterval(() => spawnFoodPieces(petEl, item, 2 + randInt(0, 2)), 430);
    setTimeout(() => {
        clearInterval(crumbleTimer);
        petEl?.classList.remove('mh-pet-eating');
        setTimeout(() => playPetHappy(petEl, pet, { holdAnimMs: 900 }), STORY_FEED_VISIBLE_MS);
    }, eatingMs);
    return true;
}

export function isPetVisibleInStage(petEl, stage) {
    if (!petEl || !stage || !petEl.isConnected || !stage.isConnected) return false;
    const petRect = petEl.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (petRect.width <= 4 || petRect.height <= 4 || stageRect.width <= 4 || stageRect.height <= 4) return false;
    const style = getComputedStyle(petEl);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    return petRect.right > stageRect.left + 8
        && petRect.left < stageRect.right - 8
        && petRect.bottom > stageRect.top + 8
        && petRect.top < stageRect.bottom - 8;
}

function bathBubbleSvg(count = 30) {
    return Array.from({ length: count }, (_, index) => {
        const x = 20 + Math.random() * 280;
        const y = 178 + Math.random() * 96;
        const r = 5 + Math.random() * 13;
        const drift = Math.random() * 58 - 29;
        const rise = 78 + Math.random() * 132;
        const delay = 0.55 + Math.random() * 5.8 + index * 0.035;
        const dur = 2.4 + Math.random() * 2.2;
        return `<circle class="mh-bath-bubble" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" style="--mh-bath-drift:${drift.toFixed(1)}px;--mh-bath-rise:${rise.toFixed(1)}px;--mh-bath-delay:${delay.toFixed(2)}s;--mh-bath-dur:${dur.toFixed(2)}s"></circle>`;
    }).join('');
}

function bathSparkleSvg(count = 14) {
    return Array.from({ length: count }, (_, index) => {
        const x = 54 + Math.random() * 212;
        const y = 44 + Math.random() * 180;
        const size = 0.7 + Math.random() * 0.65;
        const r = 10 * size;
        const n = 2.7 * size;
        const delay = 7.1 + Math.random() * 1.6 + index * 0.045;
        return `<path class="mh-bath-sparkle" d="M${x.toFixed(1)} ${(y - r).toFixed(1)} L${(x + n).toFixed(1)} ${(y - n).toFixed(1)} L${(x + r).toFixed(1)} ${y.toFixed(1)} L${(x + n).toFixed(1)} ${(y + n).toFixed(1)} L${x.toFixed(1)} ${(y + r).toFixed(1)} L${(x - n).toFixed(1)} ${(y + n).toFixed(1)} L${(x - r).toFixed(1)} ${y.toFixed(1)} L${(x - n).toFixed(1)} ${(y - n).toFixed(1)}Z" style="--mh-bath-sparkle-delay:${delay.toFixed(2)}s"></path>`;
    }).join('');
}

export function createBathSequenceOverlay({ stage = document.getElementById('mhStage'), petEl = document.getElementById('mhPet') } = {}) {
    if (!stage || !petEl) return null;
    const stageRect = stage.getBoundingClientRect();
    const petRect = petEl.getBoundingClientRect();
    const scaleX = stageRect.width > 0 ? stage.clientWidth / stageRect.width : 1;
    const scaleY = stageRect.height > 0 ? stage.clientHeight / stageRect.height : 1;
    const petWidth = petRect.width * scaleX;
    const petHeight = petRect.height * scaleY;
    const width = Math.max(164, petWidth * 2.42);
    const height = Math.max(148, petHeight * 2.18);
    const centerX = (petRect.left - stageRect.left + petRect.width / 2) * scaleX;
    const centerY = (petRect.bottom - stageRect.top) * scaleY;
    const overlay = document.createElement('div');
    overlay.className = 'mh-bath-sequence';
    overlay.style.left = centerX.toFixed(1) + 'px';
    overlay.style.top = centerY.toFixed(1) + 'px';
    overlay.style.width = width.toFixed(1) + 'px';
    overlay.style.height = height.toFixed(1) + 'px';
    overlay.innerHTML = `
        <svg class="mh-bath-svg" viewBox="0 0 320 280" aria-hidden="true" focusable="false">
            <defs>
                <radialGradient id="mhBathBubble" cx="34%" cy="28%" r="72%">
                    <stop offset="0" stop-color="#ffffff" stop-opacity="0.98"></stop>
                    <stop offset="0.38" stop-color="#cffafe" stop-opacity="0.78"></stop>
                    <stop offset="1" stop-color="#38bdf8" stop-opacity="0.18"></stop>
                </radialGradient>
                <linearGradient id="mhBathTub" x1="40" y1="146" x2="282" y2="250" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stop-color="#ecfeff"></stop>
                    <stop offset="0.52" stop-color="#7dd3fc"></stop>
                    <stop offset="1" stop-color="#0284c7"></stop>
                </linearGradient>
                <filter id="mhBathGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="5" result="blur"></feGaussianBlur>
                    <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
                </filter>
            </defs>
            <g class="mh-bath-shower-stream">
                <path d="M92 62 C126 96 156 122 204 144" fill="none" stroke="#bae6fd" stroke-width="8" stroke-linecap="round" stroke-dasharray="3 18"></path>
                <path d="M118 48 C145 92 176 112 232 126" fill="none" stroke="#67e8f9" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 15"></path>
            </g>
            <g class="mh-bath-tut-tool">
                <path d="M86 92 C88 64 112 44 142 44 H224 C248 44 266 62 266 86" fill="none" stroke="#075985" stroke-width="12" stroke-linecap="round"></path>
                <path d="M56 146 H268 C260 208 232 236 162 236 C92 236 64 208 56 146Z" fill="url(#mhBathTub)" stroke="#075985" stroke-width="8" stroke-linejoin="round"></path>
                <path d="M74 142 C92 116 122 112 144 132 C164 104 204 106 224 135 C244 114 270 122 280 146Z" fill="#ecfeff" stroke="#7dd3fc" stroke-width="4"></path>
                <circle cx="106" cy="239" r="10" fill="#075985"></circle>
                <circle cx="224" cy="239" r="10" fill="#075985"></circle>
                <path d="M92 154 C126 176 192 178 240 154" fill="none" stroke="#ecfeff" stroke-width="8" stroke-linecap="round" opacity="0.75"></path>
            </g>
            <g class="mh-bath-bubbles">${bathBubbleSvg()}</g>
            <g class="mh-bath-sparkles" filter="url(#mhBathGlow)">${bathSparkleSvg()}</g>
        </svg>`;
    stage.appendChild(overlay);
    overlay.addEventListener('animationend', (event) => {
        if (event.animationName === 'mhBathSequenceFade') overlay.remove();
    });
    setTimeout(() => overlay.remove(), BATH_SEQUENCE_MS + 650);
    return overlay;
}

export async function runBathInteraction({ pet, petEl, stage, onAction = null, requireVisible = true } = {}) {
    const root = stage || petEl?.closest?.('.mh-story-hero') || document.getElementById('mhStage');
    if (requireVisible && !isPetVisibleInStage(petEl, root)) {
        showToast('宠物在画面里才可以洗澡哦', 'info', 1400);
        return false;
    }
    const applied = onAction ? await onAction('bath', { skipNotify: true }) : true;
    if (!applied) return false;
    scanAndMount(root || document);
    petEl?.classList.add('mh-pet-bathing');
    createBathSequenceOverlay({ stage: root, petEl });
    soundManager.playBathCue('start');
    const cueTimers = [1800, 3400, 5100].map(delay => setTimeout(() => soundManager.playBathCue('wash'), delay));
    cueTimers.push(setTimeout(() => soundManager.playBathCue('sparkle'), 7700));
    setTimeout(() => {
        cueTimers.forEach(timer => clearTimeout(timer));
        petEl?.classList.remove('mh-pet-bathing');
        playPetHappy(petEl, pet, { holdAnimMs: BATH_COMPLETE_FEEDBACK_MS });
        sayOnPet(petEl, BATH_COMPLETE_LINES[randInt(0, BATH_COMPLETE_LINES.length - 1)], BATH_COMPLETE_FEEDBACK_MS);
    }, BATH_SEQUENCE_MS);
    return true;
}

export function runTouchInteraction(petEl, pet) {
    if (!petEl || !pet) return false;
    playPetClickFeedback(petEl, pet);
    return true;
}