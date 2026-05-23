// 宠物渲染与动画统一入口。
//
// 设计参考：HelloWorld 的 genGeoCultureGridImage / _generateGridImage 模式，
// 用一次 LLM 调用生成 4×4 拼图，然后在浏览器端去除背景色，得到带透明通道的精灵图，
// 用作站立 / 待机动画（cycling 同一行的 4 列变体）。
//
// 职责：
//   1. 形象 HTML：petArtHtml() 输出占位 div（含 data-mh-pet），蛋阶段直接 inline SVG
//   2. 生成 + 缓存：按 DNA 复用 sprite sheet URL（localStorage 持久化 + 内存 in-flight 去重）
//   3. 透明化：把背景按格子去除，输出可渲染 URL，避免每次重新处理
//   4. 渲染 + 动画：扫描所有 [data-mh-pet="<petId>"] 元素，挂载精灵图并按帧循环列
//
// 使用：视图层调用 petArtHtml(pet) 输出占位 HTML；本模块订阅 state，每次 notify
// 之后扫描并接管渲染。已经处于目标状态的元素不会被重建，避免动画重置。

import { state, subscribe } from './state.js';
import { savePetDebounced } from './storage.js';
import { biasDnaForFieldId, biasDnaForTrait, decodeDna, dietPreferenceLabel, dnaDietPreference, dnaRarity, dnaToName } from './dna.js';
import { CONFIG, findLargestHouseAcrossLayouts } from './config.js';
import { applyStage, defaultTraits, gainTrait, markPetCared } from './petTick.js';
import { getRuntimePetStats } from './petLifecycle.js';
import { clamp, escapeHtml } from './utils.js';

// 4 行 × 4 列：行=阶段（baby/teen/adult/elder），列=情绪（idle/happy/sad/sleep）
export const SHEET_COLS = 4;
export const SHEET_ROWS = 4;

const STAGE_ROW = { baby: 0, teen: 1, adult: 2, elder: 3 };
// 列 = 情绪动作（与 api.js 里的 sprite sheet prompt 严格对齐）
export const ANIM_COL = { idle: 0, happy: 1, sad: 2, sleep: 3 };
export const DEFAULT_ANIM = 'idle';

const NIGHT_SLEEP_START_HOUR = 22;
const MORNING_WAKE_HOUR = 6;
const DAY_SLEEP_ENERGY_INTERVAL_MS = 10 * 1000;
const DAY_SLEEP_ENERGY_PER_INTERVAL = 10;
const DAY_SLEEP_ENERGY_CAP_RATIO = 0.5;
const DAY_SLEEP_REJECT_TEXT = '我睡不着了';

const _animResetTimers = new Map(); // petId -> timeoutId
const EGG_HATCH_VISIBLE_DELAY_MS = 2000;
const _readyEggHatchTimers = new Map(); // petId -> timeoutId
const EGG_HATCH_PENDING_EMOJIS = ['✨', '💫', '🌟', '🎇', '🎆', '🧬', '🌈', '💖', '🔮', '⚡'];
const _pendingEggEffectTimers = new Map(); // petId -> intervalId
const LOW_MOOD_FOOD_BONUS_THRESHOLD = 30;
const LOW_MOOD_FOOD_BONUS = 10;

function getSharedAudioEngine() {
    return window.keepwork?.audioEngine
        || window.KeepworkSDK?.getSharedAudioEngine?.()
        || window.AudioEngine?.getShared?.()
        || null;
}

function getSharedAudioContext() {
    const engine = getSharedAudioEngine();
    if (!engine?.isSupported?.()) return null;
    try { return engine.getContext(); } catch (_) { return null; }
}

function getSharedAudioDestination(ctx) {
    const engine = getSharedAudioEngine();
    try { return engine?.getDestination?.() || engine?.getOutputNode?.() || ctx.destination; } catch (_) { return ctx.destination; }
}

function _animCol(name) {
    const c = ANIM_COL[name];
    return (c == null) ? ANIM_COL[DEFAULT_ANIM] : c;
}

function localHour(now = Date.now()) {
    return new Date(now).getHours();
}

export function isNightSleepTime(now = Date.now()) {
    const hour = localHour(now);
    return hour >= NIGHT_SLEEP_START_HOUR || hour < MORNING_WAKE_HOUR;
}

function localDateKey(now = Date.now()) {
    const date = new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function nextMorningWakeAt(now = Date.now()) {
    const date = new Date(now);
    if (date.getHours() >= NIGHT_SLEEP_START_HOUR) date.setDate(date.getDate() + 1);
    date.setHours(MORNING_WAKE_HOUR, 0, 0, 0);
    return date.getTime();
}

export function isPetSleeping(pet) {
    return pet?.anim === 'sleep';
}

export function startPetSleep(pet, now = Date.now()) {
    if (!pet) return { sleeping: false, reason: 'missingPet' };
    const cap = sleepEnergyCap(pet);
    const isNight = isNightSleepTime(now);
    const currentEnergy = Number(pet.stats?.hunger) || 0;
    if (!isNight && currentEnergy > cap) {
        pet.anim = DEFAULT_ANIM;
        delete pet.sleepStartedAt;
        delete pet.sleepLockedUntil;
        delete pet.sleepEnergyRecoveredAt;
        delete pet.sleepSessionEnergyCap;
        return { sleeping: false, wokeImmediately: true, reason: 'tooMuchEnergy', message: DAY_SLEEP_REJECT_TEXT };
    }
    pet.anim = 'sleep';
    pet.sleepStartedAt = now;
    pet.sleepEnergyRecoveredAt = now;
    delete pet.sleepSessionEnergyCap;
    if (isNight) {
        pet.sleepLockedUntil = nextMorningWakeAt(now);
    } else {
        delete pet.sleepLockedUntil;
        if (canRecoverEnergyFromSleep(pet)) {
            const dateKey = localDateKey(now);
            if (pet.daySleepRecoveryDate !== dateKey) {
                if (pet.stats) pet.stats.hunger = clamp(Math.max(currentEnergy, cap), CONFIG.statMin, CONFIG.statMax);
                pet.daySleepRecoveryDate = dateKey;
            } else {
                pet.sleepSessionEnergyCap = Math.min(cap, currentEnergy + DAY_SLEEP_ENERGY_PER_INTERVAL);
            }
        }
    }
    return { sleeping: true, lockedUntil: pet.sleepLockedUntil || null };
}

export function canRecoverEnergyFromSleep(pet) {
    return ['teen', 'adult', 'elder'].includes(pet?.stage);
}

export function sleepEnergyCap() {
    return CONFIG.statMax * DAY_SLEEP_ENERGY_CAP_RATIO;
}

export function recoverEnergyDuringSleep(pet, now = Date.now()) {
    if (!pet?.stats || !isPetSleeping(pet) || !canRecoverEnergyFromSleep(pet)) return false;
    if (!isNightSleepTime(now) && (Number(pet.stats.hunger) || 0) > sleepEnergyCap(pet)) {
        wakePet(pet, now, { skipRecover: true });
        return true;
    }
    const lastRecoveredAt = Number(pet.sleepEnergyRecoveredAt || pet.sleepStartedAt || now) || now;
    const intervals = Math.floor(Math.max(0, now - lastRecoveredAt) / DAY_SLEEP_ENERGY_INTERVAL_MS);
    if (intervals <= 0) return false;
    pet.sleepEnergyRecoveredAt = lastRecoveredAt + intervals * DAY_SLEEP_ENERGY_INTERVAL_MS;
    const before = Number(pet.stats.hunger) || 0;
    const cap = Math.min(sleepEnergyCap(pet), Number(pet.sleepSessionEnergyCap) || sleepEnergyCap(pet));
    if (before >= cap) return false;
    pet.stats.hunger = clamp(Math.min(cap, before + intervals * DAY_SLEEP_ENERGY_PER_INTERVAL), CONFIG.statMin, CONFIG.statMax);
    return pet.stats.hunger !== before;
}

export function recoverEnergyAfterSleep(pet, now = Date.now()) {
    return recoverEnergyDuringSleep(pet, now);
}

export function shouldRejectDaySleep(pet, now = Date.now()) {
    return !!pet && !isNightSleepTime(now) && (Number(pet.stats?.hunger) || 0) > sleepEnergyCap(pet);
}

export function daySleepRejectText() {
    return DAY_SLEEP_REJECT_TEXT;
}

export function wakePet(pet, now = Date.now(), options = {}) {
    if (!pet) return false;
    if (!options.skipRecover) recoverEnergyAfterSleep(pet, now);
    pet.anim = DEFAULT_ANIM;
    delete pet.sleepStartedAt;
    delete pet.sleepLockedUntil;
    delete pet.sleepEnergyRecoveredAt;
    delete pet.sleepSessionEnergyCap;
    return true;
}

export function wakePetForPlay(pet, now = Date.now()) {
    return wakePet(pet, now);
}

export function normalizePetSleepState(pet, now = Date.now()) {
    if (pet?.id && pet.id !== state.currentPetId) return false;
    if (!isPetSleeping(pet)) return false;
    if (!isNightSleepTime(now) && (Number(pet.stats?.hunger) || 0) > sleepEnergyCap(pet)) {
        return wakePet(pet, now, { skipRecover: true });
    }
    const recovered = recoverEnergyDuringSleep(pet, now);
    const lockedUntil = Number(pet.sleepLockedUntil) || 0;
    if (lockedUntil && now >= lockedUntil) return wakePet(pet, now) || recovered;
    return recovered;
}

export function isPetSleepLocked(pet, now = Date.now()) {
    if (!isPetSleeping(pet)) return false;
    const lockedUntil = Number(pet.sleepLockedUntil) || 0;
    return lockedUntil > now;
}

export function canWakePet(pet, now = Date.now()) {
    return isPetSleeping(pet) && !isPetSleepLocked(pet, now);
}

export function sleepLockText(pet, now = Date.now()) {
    if (!isPetSleepLocked(pet, now)) return '';
    return '宠物已经进入夜间睡眠，明早 6 点才能醒来。';
}

export function sleepingInteractionText(pet, now = Date.now()) {
    return sleepLockText(pet, now) || '宠物正在睡觉，醒来后再互动吧。';
}

export function getPetSleepActionState(pet, now = Date.now()) {
    const sleeping = isPetInteractionBlocked(pet, now);
    const sleepLocked = isPetSleepLocked(pet, now);
    return {
        sleeping,
        sleepLocked,
        icon: sleeping ? '☀️' : '😴',
        label: sleeping ? '唤醒' : '睡觉',
        disabled: sleepLocked,
        title: sleepLocked ? sleepingInteractionText(pet, now) : '',
        hint: sleeping ? (canWakePet(pet, now) ? '宠物正在睡觉，可轻轻唤醒。' : sleepingInteractionText(pet, now)) : '',
    };
}

export function isPetInteractionBlocked(pet, now = Date.now()) {
    normalizePetSleepState(pet, now);
    return isPetSleeping(pet);
}

/**
 * 设置宠物的当前动画（列）。名称：'idle' | 'happy' | 'sad' | 'sleep'。
 * 仅修改 pet.anim 并触发重扫描，不会重新生成 sheet。
 */
export function setPetAnim(pet, anim) {
    if (!pet) return;
    const next = ANIM_COL[anim] != null ? anim : DEFAULT_ANIM;
    if (pet.anim === next) return;
    pet.anim = next;
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('magichaqi:pet-anim-change', {
            detail: { petId: pet.id || state.currentPetId, anim: next },
        }));
    }
    _scheduleScan();
}

function _currentPet() {
    return state.currentPetId ? state.pets[state.currentPetId] : null;
}

function _cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
}

function _findPetHosts(petId) {
    const id = petId || state.currentPetId;
    if (!id) return [];
    const root = document.getElementById('app') || document.body;
    return root ? Array.from(root.querySelectorAll(`[data-mh-pet="${_cssEscape(id)}"]`)) : [];
}

function _showPetBubble(petId, text, duration = 4500) {
    const message = String(text == null ? '' : text).trim();
    if (!message) return;
    _findPetHosts(petId).forEach((host) => {
        _showPetBubbleAtHost(host, message, duration);
    });
}

function _showPetBubbleAtHost(host, text, duration = 4500) {
    const message = String(text == null ? '' : text).trim();
    if (!message) return;
    const anchor = _petEffectAnchor(host);
    if (!anchor) return;
    let bubble = anchor.querySelector(':scope > .mh-pet-talk-bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'mh-pet-talk-bubble';
        anchor.appendChild(bubble);
    }
    const isFlipped = String(anchor.style.transform || '').includes('scaleX(-1)');
    bubble.style.setProperty('--mh-talk-flip', isFlipped ? '-1' : '1');
    bubble.textContent = message;
    bubble.classList.remove('mh-pet-talk-bubble-hide');
    bubble.classList.remove('mh-pet-talk-bubble-pop');
    void bubble.offsetWidth;
    bubble.classList.add('mh-pet-talk-bubble-pop');
    clearTimeout(bubble.__mhPetSayTimer);
    const ms = Math.max(900, Number(duration) || 4500);
    bubble.__mhPetSayTimer = setTimeout(() => {
        bubble.classList.add('mh-pet-talk-bubble-hide');
        bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
    }, ms);
}

function _randomPendingEggEmoji() {
    return EGG_HATCH_PENDING_EMOJIS[Math.floor(Math.random() * EGG_HATCH_PENDING_EMOJIS.length)] || '✨';
}

function _isEggAwaitingSheet(pet) {
    return !!pet && !!pet.eggHatchPending && !(_isEggSheetReadyToReveal(pet));
}

function _stopPendingEggEffect(petId) {
    const id = petId || state.currentPetId;
    if (!id) return;
    const timer = _pendingEggEffectTimers.get(id);
    if (timer) clearInterval(timer);
    _pendingEggEffectTimers.delete(id);
    _findPetHosts(id).forEach(el => el.classList.remove('mh-egg-hatch-pending'));
}

function _syncPendingEggEffect(pet) {
    const id = pet?.id || state.currentPetId;
    if (!id) return;
    const active = _isEggAwaitingSheet(pet);
    _findPetHosts(id).forEach(el => el.classList.toggle('mh-egg-hatch-pending', active));
    if (!active) {
        _stopPendingEggEffect(id);
        return;
    }
    if (_pendingEggEffectTimers.has(id)) return;
    _showPetBubble(id, _randomPendingEggEmoji(), 1700);
    const timer = setInterval(() => {
        const latest = state.pets?.[id] || pet;
        if (!_isEggAwaitingSheet(latest)) {
            _stopPendingEggEffect(id);
            return;
        }
        _findPetHosts(id).forEach(el => el.classList.add('mh-egg-hatch-pending'));
        _showPetBubble(id, _randomPendingEggEmoji(), 1700);
    }, 2200);
    _pendingEggEffectTimers.set(id, timer);
}

function _isElementVisibleInViewport(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 4 || rect.height <= 4) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
    return rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh;
}

function _isWatchingPetForHatch(pet) {
    if (!pet?.id || typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return false;
    if (state.currentView !== 'home') return false;
    if (state.currentPetId !== pet.id) return false;
    return _findPetHosts(pet.id).some(_isElementVisibleInViewport);
}

function _isEggReadyToHatch(pet) {
    if (!pet || (pet.stage !== 'egg' && !pet.eggHatchPending)) return false;
    if (!pet.imageSheetUrl) return false;
    return !!pet.eggHatchPending || !!pet.eggHatchRequestedAt || (pet.stats?.hunger ?? 0) > 0;
}

function _isEggHatchQueued(pet) {
    return !!pet && pet.stage === 'egg' && !!pet.eggHatchQueuedAt;
}

function _isEggHatchStarted(pet) {
    return !!pet && pet.stage === 'egg' && (!!pet.eggHatchPending || !!pet.eggHatchRequestedAt);
}

function _continueStartedEggHatch(pet) {
    if (!_isEggHatchStarted(pet)) return false;
    pet.eggHatchPending = true;
    _syncPendingEggEffect(pet);
    if (pet.imageSheetUrl) _requestReadyEggHatch(pet);
    return true;
}

function _isEggSheetReadyToReveal(pet) {
    if (!pet?.imageSheetUrl) return false;
    const processed = getProcessedSheet(pet.imageSheetUrl);
    return processed?.status === 'loaded' && !!processed.dataUrl;
}

function _finishReadyEggHatch(pet) {
    if (!_isEggReadyToHatch(pet)) return false;
    if (!_isWatchingPetForHatch(pet)) return false;
    if (!_isEggSheetReadyToReveal(pet)) {
        pet.eggHatchPending = true;
        _syncPendingEggEffect(pet);
        return false;
    }

    const now = Date.now();
    pet.eggHatchedAt = now;
    pet.bornAt = now;
    pet.lastTickAt = now;
    pet.lastCareAt = now;
    pet.stage = 'baby';
    pet.eggHatchPending = false;
    delete pet.eggHatchPending;
    delete pet.eggHatchQueuedAt;
    delete pet.eggHatchRequestedAt;
    _stopPendingEggEffect(pet.id || state.currentPetId);

    try { applyStage(pet); } catch (_) {}
    savePetDebounced(pet);

    const playFeedback = () => {
        try { scanAndMount(); } catch (_) {}
        _playHatchAnimation(pet.id || state.currentPetId);
        _playHatchSound();
        setAnim('happy', 1800);
        setTimeout(() => say('我长大啦！谢谢你的食物 ✨', 4200), 200);
    };
    const afterPaint = () => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(playFeedback);
        else setTimeout(playFeedback, 0);
    };
    try { import('./state.js').then(({ notify }) => { notify(); afterPaint(); }).catch(afterPaint); }
    catch (_) { afterPaint(); }
    return true;
}

function _requestReadyEggHatch(pet) {
    if (!_isEggReadyToHatch(pet)) return false;
    const id = pet.id || state.currentPetId || '__egg__';
    pet.eggHatchPending = true;
    _syncPendingEggEffect(pet);
    if (pet.imageSheetUrl) getProcessedSheet(pet.imageSheetUrl);

    if (_readyEggHatchTimers.has(id)) return true;
    if (!_isWatchingPetForHatch(pet)) return true;

    const timer = setTimeout(() => {
        _readyEggHatchTimers.delete(id);
        if (!_finishReadyEggHatch(pet)) _requestReadyEggHatch(pet);
    }, EGG_HATCH_VISIBLE_DELAY_MS);
    _readyEggHatchTimers.set(id, timer);
    return true;
}

function _tryReadyEggHatches() {
    Object.values(state.pets || {}).forEach((pet) => {
        try { _requestReadyEggHatch(pet); } catch (_) {}
    });
}

function _petEffectAnchor(el) {
    if (!el) return null;
    const fieldWander = el.closest?.('.field-pet-wander')
        || el.querySelector?.(':scope > .field-pet-wander')
        || el.querySelector?.('.field-pet-wander');
    if (fieldWander) return fieldWander;
    return el.closest?.('.pet-sprite') || el;
}

function _isPetFilthy(pet) {
    if (pet?.id && pet.id !== state.currentPetId) return false;
    const stats = getRuntimePetStats(pet);
    return Number(stats.clean ?? 100) <= 0;
}

const DIRTY_SMOKE_PATHS = [
    'M18 70 C7 55 26 45 16 30 C9 19 20 12 17 2',
    'M18 74 C8 58 28 49 17 33 C7 17 29 14 24 1',
    'M18 72 C30 56 8 47 20 31 C30 18 15 12 18 2',
    'M18 70 C9 56 28 43 18 29 C9 16 22 11 20 2',
];

function _dirtySmokeSvg(path) {
    return `<svg viewBox="0 0 36 78" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}

function _randomizeDirtySmokeLine(line, index) {
    const colors = ['#4d7c0f', '#65a30d', '#3f6212', '#15803d'];
    const left = 34 + Math.random() * 32;
    const width = 15 + Math.random() * 10;
    const height = 45 + Math.random() * 22;
    const drift = -14 + Math.random() * 28;
    const rise = 44 + Math.random() * 30;
    const duration = 2.2 + Math.random() * 0.8;
    const delay = index * 0.42 + Math.random() * 0.25;
    line.style.cssText = [
        `--mh-smoke-left:${left.toFixed(1)}%`,
        `--mh-smoke-w:${width.toFixed(1)}%`,
        `--mh-smoke-h:${height.toFixed(1)}%`,
        `--mh-smoke-drift:${drift.toFixed(1)}px`,
        `--mh-smoke-rise:${rise.toFixed(1)}px`,
        `--mh-smoke-dur:${duration.toFixed(2)}s`,
        `--mh-smoke-delay:${delay.toFixed(2)}s`,
        `--mh-smoke-color:${colors[index % colors.length]}`,
    ].join(';');
}

function _syncDirtySmokeEmitter(el, active) {
    if (!el) return;
    let emitter = el.querySelector(':scope > .mh-pet-smoke-emitter');
    if (!active) {
        emitter?.remove();
        return;
    }
    if (emitter) return;
    emitter = document.createElement('div');
    emitter.className = 'mh-pet-smoke-emitter';
    const count = 4;
    for (let index = 0; index < count; index++) {
        const line = document.createElement('span');
        line.className = 'mh-pet-smoke-line';
        const path = DIRTY_SMOKE_PATHS[index % DIRTY_SMOKE_PATHS.length];
        _randomizeDirtySmokeLine(line, index);
        line.innerHTML = _dirtySmokeSvg(path);
        emitter.appendChild(line);
    }
    el.appendChild(emitter);
}

function _isSceneCompanionHost(el, pet) {
    if (!el || !pet?.id) return false;
    if (pet.id === state.currentPetId) return false;
    return !!el.closest?.('.field-pet-friend, .mh-released-room-pet');
}

function _syncAnimClass(el, anim, pet = null) {
    if (!el) return;
    const sleeping = anim === 'sleep';
    const filthy = _isSceneCompanionHost(el, pet) ? false : _isPetFilthy(pet);
    el.classList.toggle('mh-egg-hatch-pending', _isEggAwaitingSheet(pet));
    _syncPendingEggEffect(pet);
    el.classList.toggle('mh-pet-sleeping', sleeping);
    el.classList.toggle('mh-pet-dirty', filthy);
    _syncDirtySmokeEmitter(el, filthy);
    const fieldWander = el.closest?.('.field-pet-wander');
    if (fieldWander) {
        fieldWander.classList.toggle('mh-pet-dirty', filthy);
        if (!filthy) _syncDirtySmokeEmitter(fieldWander, false);
    }
    const spriteHost = el.closest('.pet-sprite');
    if (spriteHost) {
        spriteHost.classList.toggle('mh-pet-sleeping', sleeping);
        spriteHost.classList.toggle('mh-pet-dirty', filthy);
        if (!filthy) _syncDirtySmokeEmitter(spriteHost, false);
    }
}

/**
 * 设置当前宠物动画。名称：'idle' | 'happy' | 'sad' | 'sleep'。
 * duration > 0 时会在指定毫秒后恢复先前动画（或 idle）。
 */
export function setAnim(anim = DEFAULT_ANIM, duration = 0) {
    const pet = _currentPet();
    if (!pet) return;
    const next = ANIM_COL[anim] != null ? anim : DEFAULT_ANIM;
    const previous = pet.anim || DEFAULT_ANIM;
    const petId = pet.id || state.currentPetId;
    if (petId && _animResetTimers.has(petId)) {
        clearTimeout(_animResetTimers.get(petId));
        _animResetTimers.delete(petId);
    }
    setPetAnim(pet, next);
    _findPetHosts(petId).forEach((el) => _syncAnimClass(el, next, pet));

    const ms = Number(duration) || 0;
    if (ms > 0 && petId) {
        const timer = setTimeout(() => {
            _animResetTimers.delete(petId);
            if (state.pets[petId] === pet) {
                setPetAnim(pet, previous === next ? DEFAULT_ANIM : previous);
                _findPetHosts(petId).forEach((el) => _syncAnimClass(el, pet.anim || DEFAULT_ANIM, pet));
            }
        }, ms);
        _animResetTimers.set(petId, timer);
    }
}

/**
 * 在当前宠物头顶显示说话气泡。duration 单位为毫秒。
 */
export function say(text, duration = 4500) {
    _showPetBubble(state.currentPetId, text, Math.max(2400, Number(duration) || 4500));
}

export function sayOnPet(petEl, text, duration = 4500) {
    if (petEl) {
        _showPetBubbleAtHost(petEl, text, Math.max(900, Number(duration) || 4500));
        return;
    }
    say(text, duration);
}

const PET_TALK_LINES = {
    egg: [
        '好饿呀，给我吃点东西，我就长大了 🥚',
        '嗒嗒嗒…蛋里有点闷，主人来喂我嘛 🍼',
        '我能感觉到你在看我，快喂喂我吧 ✨',
        '主人，去 🧬 细胞里许个愿吧，决定我长什么样～',
    ],
    sleeping: [
        '嘘...我正在做糖果云的梦 😴',
        'Zzz...再陪我睡一小会儿 💤',
        '梦里有好多星星饼干 ✨',
        '轻轻摸摸就好，我快醒啦 🌙',
    ],
    hungry: [
        '肚子咕噜咕噜叫啦 🍎',
        '可以给我一点好吃的吗？🍰',
        '我闻到食物的味道了！🥕',
        '补充能量时间到～🍖',
    ],
    dirty: [
        '身上灰扑扑的，想洗澡 🛁',
        '泡泡在哪里？我想变香香 🫧',
        '洗完澡我会闪闪发光 ✨',
        '毛毛有点乱，需要整理一下啦 🧼',
    ],
    tired: [
        '眼皮越来越重了...🥱',
        '今天玩累啦，想躺一躺 🛏️',
        '充电中，请轻拍我一下 ⚡',
        '我需要一点休息时间 🌙',
    ],
    sad: [
        '陪我玩一会儿嘛 🥺',
        '今天想要更多关注 💛',
        '摸摸我，心情会变好一点 ✨',
        '我有点小失落，但见到你就好多啦 🌈',
    ],
    happy: [
        '嘿嘿，我现在超开心！😄',
        '你来啦！一起冒险吧 ✨',
        '被点到会冒爱心哦 💖',
        '今天也是闪亮亮的一天 ⭐',
        '我喜欢和你待在一起 🎵',
    ],
    normal: [
        '哈奇哈奇，收到你的摸摸啦 🐾',
        '要不要一起去看看星球？🪐',
        '我正在观察这个世界 👀',
        '今天会发生什么好玩的事呢？✨',
        '叮！宠物回应了你 💬',
    ],
};

function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function _petTalkState(pet) {
    const stats = getRuntimePetStats(pet);
    if (pet?.stage === 'egg') return 'egg';
    if (pet?.anim === 'sleep') return 'sleeping';
    if ((stats.hunger ?? 100) < 22) return 'hungry';
    if ((stats.clean ?? 100) < 22) return 'dirty';
    if ((stats.mood ?? 100) < 28) return 'sad';
    if ((stats.mood ?? 0) >= 76) return 'happy';
    return 'normal';
}

export function randomPetTalk(pet) {
    const talkState = _petTalkState(pet);
    if (talkState === 'egg') return { state: 'egg', text: eggHungryHint(pet) };
    return { state: talkState, text: _pick(PET_TALK_LINES[talkState] || PET_TALK_LINES.normal) };
}

export function playPetClickFeedback(petEl, pet) {
    const talk = randomPetTalk(pet);
    playPetHappy(petEl, pet);
    requestAnimationFrame(() => sayOnPet(petEl, talk.text, talk.state === 'sleeping' ? 2600 : 2400));
}

function playFoodTrill(wasHungry = false) {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    try {
        if (ctx.state === 'suspended') ctx.resume?.();
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(wasHungry ? 0.075 : 0.052, now + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        gain.connect(getSharedAudioDestination(ctx));
        const notes = wasHungry ? [660, 880, 1175, 1480] : [620, 830, 1040];
        notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            osc.type = index % 2 ? 'triangle' : 'sine';
            const start = now + index * 0.055;
            osc.frequency.setValueAtTime(freq, start);
            osc.frequency.exponentialRampToValueAtTime(freq * 1.18, start + 0.05);
            osc.connect(gain);
            osc.start(start);
            osc.stop(start + 0.11);
        });
    } catch (_) {}
}

function primeFoodAudio() {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    try {
        if (ctx.state === 'suspended') ctx.resume?.();
    } catch (_) {}
}

function spawnEatFoodEffects(pet, foodItem, wasHungry = false) {
    const icon = foodItem?.emoji || '🍽️';
    _findPetHosts(pet?.id).forEach((host) => {
        const anchor = _petEffectAnchor(host);
        if (!anchor) return;
        let fx = anchor.querySelector(':scope > .mh-pet-fx');
        if (!fx) {
            fx = document.createElement('div');
            fx.className = 'mh-pet-fx';
            anchor.appendChild(fx);
        }
        const burst = document.createElement('span');
        burst.className = 'mh-food-love-burst';
        burst.textContent = wasHungry ? '😍' : '😋';
        fx.appendChild(burst);
        burst.addEventListener('animationend', () => burst.remove(), { once: true });

        const shardCount = wasHungry ? 14 : 10;
        for (let i = 0; i < shardCount; i++) {
            const shard = document.createElement('span');
            shard.className = 'mh-food-shard';
            shard.textContent = icon;
            const startX = Math.random() * 24 - 12;
            const startY = Math.random() * 18 - 16;
            const burstX = Math.random() * 120 - 60;
            const burstY = -(16 + Math.random() * 44);
            const fallY = 42 + Math.random() * 62;
            const size = 10 + Math.random() * 12;
            const rotate = Math.random() * 220 - 110;
            const delay = Math.random() * 0.08;
            shard.style.setProperty('--mh-food-start-x', startX.toFixed(1) + 'px');
            shard.style.setProperty('--mh-food-start-y', startY.toFixed(1) + 'px');
            shard.style.setProperty('--mh-food-burst-x', burstX.toFixed(1) + 'px');
            shard.style.setProperty('--mh-food-burst-y', burstY.toFixed(1) + 'px');
            shard.style.setProperty('--mh-food-fall-y', fallY.toFixed(1) + 'px');
            shard.style.setProperty('--mh-food-size', size.toFixed(1) + 'px');
            shard.style.setProperty('--mh-food-rot', rotate.toFixed(1) + 'deg');
            shard.style.setProperty('--mh-food-delay', delay.toFixed(2) + 's');
            fx.appendChild(shard);
            shard.addEventListener('animationend', () => shard.remove(), { once: true });
        }
        _spawnHappyParticles(anchor, wasHungry ? 10 : 7);
    });
}

// ============================================================
// 蛋孵化流程
// ============================================================
//
// 蛋阶段的 DNA 可以被这些因素影响（在 createNewEgg 时初始化，孵化时统一应用）：
//   1) 主屋所在领地（land/water/sky/fire/ice/life/dark）
//   2) 玩家在蛋阶段喂的食物（item.trait → catLike / fishLike ...）
//   3) 玩家在 cell 视图中"许愿"输入的提示词（pet.wishPrompt，会替换 genImage 提示）
//
// 第一次喂食触发孵化：DNA 最终化 → 生成精灵图 → 进入 baby 阶段，播放孵化动画与音效。

function _eggBias(pet) {
    if (!pet.eggBias) pet.eggBias = { feedTraits: {}, feedCount: 0 };
    if (!pet.eggBias.feedTraits) pet.eggBias.feedTraits = {};
    return pet.eggBias;
}

function _dominantFeedTrait(pet) {
    const traits = pet.eggBias?.feedTraits || {};
    let best = null;
    let bestCount = 0;
    for (const [trait, count] of Object.entries(traits)) {
        if (count > bestCount) { best = trait; bestCount = count; }
    }
    return best;
}

function _playHatchSound() {
    try {
        // 复用 SoundManager 的"升级"动机作为孵化提示音（>=2 秒 MIDI 序列）。
        import('./soundManager.js').then(mod => {
            const sm = mod.default?.getInstance?.();
            sm?.playBuildLevelUp?.();
        }).catch(() => {});
    } catch (_) {}
}

function _playHatchAnimation(petId) {
    _findPetHosts(petId).forEach((host) => {
        const anchor = _petEffectAnchor(host);
        if (!anchor) return;
        anchor.classList.remove('mh-pet-hatch-burst');
        // 强制 reflow 让动画可重复触发
        void anchor.offsetWidth;
        anchor.classList.add('mh-pet-hatch-burst');
        let fx = anchor.querySelector(':scope > .mh-pet-fx');
        if (!fx) {
            fx = document.createElement('div');
            fx.className = 'mh-pet-fx';
            anchor.appendChild(fx);
        }
        for (let i = 0; i < 12; i++) {
            const star = document.createElement('span');
            star.className = 'mh-pet-particle';
            star.textContent = ['✨', '⭐', '💫', '🌟'][i % 4];
            const startX = (Math.random() * 60 - 30) | 0;
            const drift = (Math.random() * 80 - 40) | 0;
            star.style.setProperty('--mh-x', startX + 'px');
            star.style.setProperty('--mh-drift', drift + 'px');
            star.style.setProperty('--mh-delay', (i * 0.04).toFixed(2) + 's');
            star.style.setProperty('--mh-dur', '1.4s');
            fx.appendChild(star);
            star.addEventListener('animationend', () => star.remove(), { once: true });
        }
        setTimeout(() => anchor.classList.remove('mh-pet-hatch-burst'), 1400);
    });
}

/**
 * 对蛋应用 DNA 偏置（领地 + 主导喂食 trait），然后等待精灵图生成完成。
 * 真正破壳会在 imageSheetUrl 就绪且玩家正在看着宠物时触发。
 */
export function hatchPetFromEgg(pet) {
    if (!pet) return false;
    if (pet.stage !== 'egg') return false;
    if (_continueStartedEggHatch(pet)) {
        return true;
    }
    let dna = pet.dna || '';
    // 1) 领地偏置：以孵化时玩家当前最大屋所在的 field 为准
    try {
        const territory = findLargestHouseAcrossLayouts(state.layouts);
        if (territory?.fieldId) dna = biasDnaForFieldId(dna, territory.fieldId);
    } catch (_) {}
    // 2) 喂食 trait 偏置
    const dominant = _dominantFeedTrait(pet);
    if (dominant) dna = biasDnaForTrait(dna, dominant);
    pet.dna = dna;
    pet.traits = decodeDna(dna);
    pet.rarity = dnaRarity(dna);
    pet.name = dnaToName(dna);

    const now = Date.now();
    pet.eggHatchRequestedAt = pet.eggHatchRequestedAt || now;
    pet.lastCareAt = now;
    pet.lastTickAt = now;
    pet.eggHatchPending = true;
    delete pet.eggHatchQueuedAt;
    _syncPendingEggEffect(pet);

    generatePetSheet(pet).then((url) => {
        try {
            if (url || pet.imageSheetUrl) _requestReadyEggHatch(pet);
            savePetDebounced(pet);
            import('./state.js').then(({ notify }) => notify()).catch(() => {});
        } catch (_) {}
    }).catch(() => {});

    savePetDebounced(pet);
    try { import('./state.js').then(({ notify }) => notify()); } catch (_) {}
    return true;
}

/**
 * 蛋阶段提示：按顺序循环播报，确保最重要的一句"喂我"最先出现，
 * 然后再轮播其他风味提示。每只蛋单独计数，刷新会从第一句重新开始。
 */
const _eggTalkCursor = new Map(); // petId -> next index
export function eggHungryHint(pet) {
    const lines = PET_TALK_LINES.egg;
    if (!lines.length) return '';
    const key = pet?.id || '__anon__';
    const idx = _eggTalkCursor.get(key) || 0;
    _eggTalkCursor.set(key, (idx + 1) % lines.length);
    return lines[idx];
}

// 每只蛋的"首次进入 field"欢迎是否已经播放过（in-memory，刷新即重置）
const _eggWelcomeShown = new Set();

/**
 * 在场景中已存在的实际蛋宠物上播放一次烟花粒子特效，并让宠物 say() 一次"好饿…"。
 * 与旧的居中遮罩不同，本函数不会创建独立的弹窗，特效完全围绕场景里的蛋发生。
 * 仅在 pet.stage === 'egg' 时触发。每只蛋每个 scope 在一次页面会话里只会播一次。
 * @returns {boolean} 是否实际触发了一次特效
 */
export function playEggWelcomeOnce(pet, scope = 'field') {
    if (!pet) return false;
    if (pet.stage !== 'egg') return false;
    const key = `${pet.id}|${scope}`;
    if (_eggWelcomeShown.has(key)) return false;

    // 必须在场景里找到该蛋的实际占位元素才算"已展示"，否则下一次进入再试
    const hosts = _findPetHosts(pet.id);
    if (!hosts.length) return false;
    _eggWelcomeShown.add(key);

    const line = eggHungryHint(pet);
    hosts.forEach((host) => _spawnEggFireworks(host));
    // 头顶气泡，持续时间更长（约 8.5 秒）
    setTimeout(() => say(line, 8500), 120);
    return true;
}

/** 在指定宿主上喷射 ~3 次错位烟花粒子。 */
function _spawnEggFireworks(host) {
    const anchor = _petEffectAnchor(host);
    if (!anchor) return;
    let fx = anchor.querySelector(':scope > .mh-pet-fx');
    if (!fx) {
        fx = document.createElement('div');
        fx.className = 'mh-pet-fx';
        anchor.appendChild(fx);
    }
    const burstTimes = [0, 320, 680]; // 三轮烟花
    burstTimes.forEach((delay) => setTimeout(() => _spawnFireworkBurst(fx), delay));
    // 主表情爆发 emoji（一次性）
    const burst = document.createElement('span');
    burst.className = 'mh-happy-burst';
    burst.textContent = '🎆';
    fx.appendChild(burst);
    burst.addEventListener('animationend', () => burst.remove(), { once: true });
}

const _FIREWORK_EMOJIS = ['✨', '⭐', '💫', '🌟', '🎇', '🎆', '🩷', '💖'];

function _spawnFireworkBurst(fx) {
    const count = 14;
    const baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'mh-pet-particle mh-firework-shard';
        p.textContent = _FIREWORK_EMOJIS[Math.floor(Math.random() * _FIREWORK_EMOJIS.length)];
        const angle = baseAngle + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const dist = 40 + Math.random() * 60;
        const x = Math.cos(angle) * dist;
        const drift = Math.sin(angle) * dist;
        // 借用 happy 粒子动画的 CSS 变量做径向飞溅
        p.style.setProperty('--mh-x', x.toFixed(0) + 'px');
        p.style.setProperty('--mh-drift', drift.toFixed(0) + 'px');
        p.style.setProperty('--mh-rise', (60 + Math.random() * 40 | 0) + 'px');
        p.style.setProperty('--mh-size', (12 + (Math.random() * 12 | 0)) + 'px');
        p.style.setProperty('--mh-dur', (0.9 + Math.random() * 0.5).toFixed(2) + 's');
        p.style.setProperty('--mh-delay', (Math.random() * 0.08).toFixed(2) + 's');
        p.style.setProperty('--mh-r', ((Math.random() * 360) | 0) + 'deg');
        p.style.setProperty('--mh-end-scale', (1.1 + Math.random() * 0.5).toFixed(2));
        fx.appendChild(p);
        p.addEventListener('animationend', () => p.remove(), { once: true });
    }
}

// 蛋阶段定时碎碎念：每 ~12 秒在 field / pet 视图下随机说一句"好饿…"
let _eggChatterTimer = null;
function _startEggChatter() {
    if (_eggChatterTimer) return;
    _eggChatterTimer = setInterval(() => {
        try {
            const pet = _currentPet();
            if (!pet || pet.stage !== 'egg') return;
            if (state.currentView !== 'home') return;
            const lvl = state.zoomLevel;
            // 仅在 field (1) / pet (2) / cell (3) 视图唠叨；space (0) 不打扰
            if (lvl !== 1 && lvl !== 2 && lvl !== 3) return;
            // 随机跳过 ~40% 次数，避免连续刷屏
            if (Math.random() < 0.4) return;
            say(eggHungryHint(pet), 6500);
        } catch (_) {}
    }, 12000);
}
if (typeof window !== 'undefined') _startEggChatter();

function _feedEggAndHatch(pet, foodItem, options = {}) {
    if (_isEggHatchQueued(pet) || _isEggHatchStarted(pet)) {
        _continueStartedEggHatch(pet);
        say('正在孵化中，马上就破壳啦 ✨', 2400);
        return false;
    }

    const bias = _eggBias(pet);
    bias.feedCount = (bias.feedCount || 0) + 1;
    if (foodItem.trait) {
        bias.feedTraits[foodItem.trait] = (bias.feedTraits[foodItem.trait] || 0) + 1;
    } else if (foodItem.foodKind === 'meat') {
        bias.feedTraits.catLike = (bias.feedTraits.catLike || 0) + 1;
    } else if (foodItem.foodKind === 'vegetables') {
        bias.feedTraits.rabbitLike = (bias.feedTraits.rabbitLike || 0) + 1;
    }

    // 只要喂任何东西让 hunger 从 0 跳成正值，蛋就退出休眠 / 孵化。
    if (!pet.stats) pet.stats = {};
    const hungerGain = Math.max(1, Number(foodItem?.stat?.hunger) || 0);
    pet.stats.hunger = clamp((pet.stats.hunger || 0) + hungerGain, CONFIG.statMin, CONFIG.statMax);
    applyLowMoodFoodBonus(pet);
    pet.eggHatchQueuedAt = Date.now();
    savePetDebounced(pet);

    const delayMs = Math.max(0, Number(options.delayEffectsMs) || 0);
    const sayDelayMs = Math.max(0, Number(options.sayDelayMs) || 0);
    const runHatch = () => { hatchPetFromEgg(pet); };
    if (delayMs > 0) setTimeout(runHatch, delayMs);
    else if (sayDelayMs > 0) setTimeout(runHatch, sayDelayMs);
    else runHatch();
    return true;
}

function applyLowMoodFoodBonus(pet, statDeltas = null) {
    if (!pet) return 0;
    if (!pet.stats) pet.stats = {};
    const before = pet.stats.mood ?? 100;
    if (before >= LOW_MOOD_FOOD_BONUS_THRESHOLD) return 0;
    const after = clamp(before + LOW_MOOD_FOOD_BONUS, CONFIG.statMin, CONFIG.statMax);
    pet.stats.mood = after;
    const delta = after - before;
    if (delta && Array.isArray(statDeltas)) statDeltas.push({ key: 'mood', delta });
    return delta;
}

export function eatFood(pet, foodItem, options = {}) {
    if (!pet || !foodItem || foodItem.type !== 'food') return false;
    if (pet.stage === 'egg') {
        // 蛋阶段：hunger=0 是休眠状态，一旦喂食让 hunger > 0 就立即孵化。
        return _feedEggAndHatch(pet, foodItem, options);
    }
    if (pet.anim === 'sleep') {
        say('Zzz...醒来以后再吃吧', 2200);
        return false;
    }
    const ignoresFoodNegatives = pet.stage === 'baby';
    const isBasicFeed = foodItem.id === 'food_basic_feed' || foodItem.unlimited;
    const foodKind = foodItem.foodKind || 'vegetables';
    const preference = dnaDietPreference(pet.dna || '');
    const matched = ignoresFoodNegatives || isBasicFeed || preference === 'both' || foodKind === 'both' || preference === foodKind;
    if (!matched) {
        say(`我更喜欢${dietPreferenceLabel(preference)}食物`, 2400);
        setAnim('sad', 900);
        return false;
    }
    const wasHungry = (pet.stats?.hunger ?? 100) < 35;
    if (!pet.stats) pet.stats = {};
    const statDeltas = [];
    for (const key of Object.keys(foodItem.stat || {})) {
        const before = pet.stats[key] || 0;
        const after = clamp(before + foodItem.stat[key], CONFIG.statMin, CONFIG.statMax);
        pet.stats[key] = after;
        const delta = after - before;
        if (delta) statDeltas.push({ key, delta });
    }
    const penaltyStages = Array.isArray(foodItem.moodPenaltyStages) ? foodItem.moodPenaltyStages : [];
    const moodPenalty = Number(foodItem.moodPenalty) || 0;
    const appliesMoodPenalty = !ignoresFoodNegatives && penaltyStages.includes(pet.stage) && moodPenalty < 0;
    if (appliesMoodPenalty) {
        const before = pet.stats.mood || 0;
        const after = clamp(before + moodPenalty, CONFIG.statMin, CONFIG.statMax);
        pet.stats.mood = after;
        const delta = after - before;
        if (delta) statDeltas.push({ key: 'mood', delta });
    }
    const isGoodFood = !isBasicFeed && !foodItem.moodPenalty;
    if (isGoodFood || ignoresFoodNegatives) {
        applyLowMoodFoodBonus(pet, statDeltas);
    }
    const hasBadStatDelta = statDeltas.some(item => item.delta < 0);
    const hasFoodDislike = !ignoresFoodNegatives && !isGoodFood;
    const hasNegativeEffect = appliesMoodPenalty || hasBadStatDelta || hasFoodDislike;
    const hasPositiveEffect = statDeltas.some(item => item.delta > 0);
    if (foodItem.trait) {
        if (!pet.traits) pet.traits = defaultTraits();
        gainTrait(pet, foodItem.trait);
    }
    pet.lastTickAt = Date.now();
    markPetCared(pet, pet.lastTickAt);
    applyStage(pet);
    savePetDebounced(pet);
    const delayMs = Math.max(0, Number(options.delayEffectsMs) || 0);
    const sayDelayMs = Math.max(0, Number(options.sayDelayMs) || 0);
    const speakAfterAnimation = (text, duration) => {
        const waitMs = Math.max(0, sayDelayMs - delayMs);
        if (waitMs > 0) setTimeout(() => say(text, duration), waitMs);
        else say(text, duration);
    };
    const playHappyWithSpeech = (duration) => {
        const waitMs = Math.max(0, sayDelayMs - delayMs);
        if (waitMs > 0) setTimeout(() => setAnim('happy', duration), waitMs);
        else setAnim('happy', duration);
    };
    const playEatFeedback = () => {
        _spawnFoodStatFloaters(pet, statDeltas);
        if (hasNegativeEffect) {
            setAnim('sad', 1500);
            speakAfterAnimation(
                hasFoodDislike && !appliesMoodPenalty && !hasBadStatDelta
                    ? `${foodItem.emoji || ''} 能吃饱，但不是很喜欢...`
                    : `${foodItem.emoji || ''} 能吃饱，但心情有点下降...`,
                hasFoodDislike && !appliesMoodPenalty && !hasBadStatDelta ? 4200 : 4800
            );
            return;
        }
        playFoodTrill(wasHungry);
        spawnEatFoodEffects(pet, foodItem, wasHungry);
        const speechDuration = wasHungry ? 4800 : 4200;
        if (hasPositiveEffect) playHappyWithSpeech(speechDuration);
        else setAnim('happy', 1500);
        speakAfterAnimation(hasPositiveEffect
            ? (wasHungry ? `${foodItem.emoji || ''} 太好吃啦！最爱你了 💖` : `${foodItem.emoji || ''} 好吃！😋`)
            : `${foodItem.emoji || ''} 谢谢你的投喂～`,
            speechDuration);
    };
    if (delayMs > 0) {
        primeFoodAudio();
        setTimeout(playEatFeedback, delayMs);
    }
    else playEatFeedback();
    return true;
}

// === 点击宠物：开心动画 + 粒子（爱心 / 气泡 / 星星 / 音符） ===
// 与 css/pet.css 中的 .mh-happy / .mh-pet-particle / .mh-happy-burst 协作。
// 任意 level 视图（pet 房间、field 星球表面）点击 #mhPet 都可调用。
const HAPPY_BURST_EMOJIS    = ['💖', '✨', '😊', '🎵', '⭐', '💫'];
const HAPPY_PARTICLE_EMOJIS = ['💖', '💕', '❤️', '✨', '⭐', '🫧', '💫', '🎵', '🌸'];
const FOOD_STAT_ICONS = {
    hunger: '🍎',
    mood: '😊',
    clean: '🛁',
    bond: '💛',
};

function _spawnFoodStatFloaters(pet, deltas = []) {
    const visibleDeltas = deltas.filter(item => item && item.delta);
    if (!visibleDeltas.length) return;
    _findPetHosts(pet?.id).forEach((host) => {
        const anchor = _petEffectAnchor(host);
        if (!anchor) return;
        let fx = anchor.querySelector(':scope > .mh-pet-fx');
        if (!fx) {
            fx = document.createElement('div');
            fx.className = 'mh-pet-fx';
            anchor.appendChild(fx);
        }
        visibleDeltas.slice(0, 4).forEach((item, index) => {
            const floater = document.createElement('span');
            floater.className = `mh-food-stat-floater ${item.delta > 0 ? 'is-positive' : 'is-negative'}`;
            const sign = item.delta > 0 ? '+' : '';
            const icon = FOOD_STAT_ICONS[item.key] || '✨';
            floater.textContent = `${sign}${Math.round(item.delta)} ${icon}`;
            const x = (index - (visibleDeltas.length - 1) / 2) * 34;
            floater.style.setProperty('--mh-stat-x', x.toFixed(1) + 'px');
            floater.style.setProperty('--mh-stat-delay', (index * 0.22).toFixed(2) + 's');
            fx.appendChild(floater);
            floater.addEventListener('animationend', () => floater.remove(), { once: true });
        });
    });
}

function _spawnHappyParticles(petEl, count) {
    let fx = petEl.querySelector(':scope > .mh-pet-fx');
    if (!fx) {
        fx = document.createElement('div');
        fx.className = 'mh-pet-fx';
        petEl.appendChild(fx);
    }
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'mh-pet-particle';
        p.textContent = HAPPY_PARTICLE_EMOJIS[Math.floor(Math.random() * HAPPY_PARTICLE_EMOJIS.length)];
        const startX = (Math.random() * 50 - 25) | 0;          // -25 ~ 25 px
        const drift  = (Math.random() * 50 - 25) | 0;
        const rise   = 70 + (Math.random() * 60 | 0);          // 70 ~ 130 px
        const size   = 14 + (Math.random() * 14 | 0);          // 14 ~ 28 px
        const dur    = 0.9 + Math.random() * 0.6;              // 0.9 ~ 1.5 s
        const delay  = Math.random() * 0.25;
        const rot    = (Math.random() * 30 - 15) | 0;          // -15 ~ 15 deg
        const endScl = (1.0 + Math.random() * 0.6).toFixed(2); // 1.0 ~ 1.6
        p.style.setProperty('--mh-x',         startX + 'px');
        p.style.setProperty('--mh-drift',     drift + 'px');
        p.style.setProperty('--mh-rise',      rise + 'px');
        p.style.setProperty('--mh-size',      size + 'px');
        p.style.setProperty('--mh-dur',       dur + 's');
        p.style.setProperty('--mh-delay',     delay + 's');
        p.style.setProperty('--mh-r',         rot + 'deg');
        p.style.setProperty('--mh-end-scale', endScl);
        fx.appendChild(p);
        p.addEventListener('animationend', () => p.remove(), { once: true });
    }
}

/**
 * 触发宠物"开心"反馈：sprite 切到 happy 列 + 史莱姆弹跳 + 粒子爆发，
 * 约 1 秒后自动恢复为 idle。可用于任意点击宠物的场景。
 *
 * @param {HTMLElement} petEl  宠物 DOM 容器（通常是 #mhPet 或 .pet-sprite 节点）
 * @param {object}      [pet]  对应 pet 数据；提供则同时切换 sprite cell 到 happy 列
 */
export function playPetHappy(petEl, pet, options = {}) {
    if (!petEl) return;
    const holdAnimMs = Math.max(0, Number(options.holdAnimMs) || 0);
    const effectAnchor = _petEffectAnchor(petEl) || petEl;
    // 暂停漫步 transition，避免与 CSS 动画打架
    const prevTransition = petEl.style.transition;
    petEl.style.transition = 'none';
    petEl.classList.remove('mh-happy');
    void petEl.offsetWidth; // 强制 reflow 以重新触发动画
    petEl.classList.add('mh-happy');

    // 切换 sprite 到 happy 列（若可用）
    const prevAnim = pet?.anim;
    const petId = pet?.id || state.currentPetId;
    if (pet) {
        if (holdAnimMs > 0 && petId) {
            if (_animResetTimers.has(petId)) clearTimeout(_animResetTimers.get(petId));
            setPetAnim(pet, 'happy');
            const timer = setTimeout(() => {
                _animResetTimers.delete(petId);
                if (state.pets[petId] === pet) setPetAnim(pet, prevAnim || DEFAULT_ANIM);
            }, holdAnimMs);
            _animResetTimers.set(petId, timer);
        } else {
            setPetAnim(pet, 'happy');
        }
    }

    // 顶部主表情爆发
    const burst = document.createElement('div');
    burst.className = 'mh-happy-burst';
    burst.textContent = HAPPY_BURST_EMOJIS[Math.floor(Math.random() * HAPPY_BURST_EMOJIS.length)];
    effectAnchor.appendChild(burst);
    burst.addEventListener('animationend', () => burst.remove(), { once: true });

    // 周围粒子（爱心 / 气泡 / 星星 / 音符）
    _spawnHappyParticles(effectAnchor, 6 + (Math.random() * 4 | 0));

    const cleanup = () => {
        petEl.classList.remove('mh-happy');
        petEl.style.transition = prevTransition || '';
        if (pet && holdAnimMs <= 0) setPetAnim(pet, prevAnim || DEFAULT_ANIM);
    };
    // 兜底：弹跳约 0.9s，1.1s 后强制恢复
    const fallback = setTimeout(cleanup, 1100);
    const sprite = petEl.querySelector('.mh-pet-art-sprite');
    if (sprite) {
        sprite.addEventListener('animationend', () => {
            clearTimeout(fallback);
            cleanup();
        }, { once: true });
    }
}

// === 蛋蛋形象（"蛋阶段"宠物：圆滚滚的小动物，颜色 / 眼睛 / 纹身由 DNA 决定） ===
// 16 种 DNA 颜色 → 蛋身配色（light / mid / dark / 描边）
const EGG_BODY_PALETTE = {
    '雪白色':   { light: '#ffffff', mid: '#f1f5f9', dark: '#cbd5e1', stroke: '#64748b' },
    '奶白色':   { light: '#fffaf0', mid: '#fde9c8', dark: '#f4d3a0', stroke: '#a87246' },
    '金黄色':   { light: '#fff8e1', mid: '#fde68a', dark: '#f59e0b', stroke: '#b45309' },
    '焦糖色':   { light: '#fef3c7', mid: '#fbbf24', dark: '#d97706', stroke: '#92400e' },
    '巧克力色': { light: '#f5deb3', mid: '#c89060', dark: '#7c4a1e', stroke: '#4b2410' },
    '粉色':     { light: '#ffe4ec', mid: '#fbcfe8', dark: '#f472b6', stroke: '#be185d' },
    '薄荷绿':   { light: '#ecfdf5', mid: '#a7f3d0', dark: '#34d399', stroke: '#047857' },
    '天蓝色':   { light: '#e0f2fe', mid: '#bae6fd', dark: '#38bdf8', stroke: '#0369a1' },
    '薰衣草紫': { light: '#ede9fe', mid: '#c4b5fd', dark: '#a78bfa', stroke: '#5b21b6' },
    '玫瑰红':   { light: '#ffe4e6', mid: '#fda4af', dark: '#f43f5e', stroke: '#9f1239' },
    '彩虹色':   { light: '#ffe4ec', mid: '#bae6fd', dark: '#a7f3d0', stroke: '#7c3aed', rainbow: true },
    '渐变色':   { light: '#fff7ed', mid: '#fbcfe8', dark: '#a7f3d0', stroke: '#7c3aed', rainbow: true },
    '银灰色':   { light: '#f8fafc', mid: '#d1d5db', dark: '#9ca3af', stroke: '#374151' },
    '黑色':     { light: '#9ca3af', mid: '#4b5563', dark: '#1f2937', stroke: '#0f172a' },
    '橘色':     { light: '#ffedd5', mid: '#fdba74', dark: '#f97316', stroke: '#9a3412' },
    '杏色':     { light: '#fff7ed', mid: '#fed7aa', dark: '#fb923c', stroke: '#9a3412' },
};
const DEFAULT_EGG_PALETTE = EGG_BODY_PALETTE['金黄色'];

// 16 种 DNA 眼睛 → 眼睛样式 + 虹膜颜色
const EGG_EYE_STYLE = {
    '圆圆的大眼睛':   { style: 'round',   iris: '#1f2937' },
    '星星眼':         { style: 'star',    iris: '#facc15' },
    '月牙眼':         { style: 'crescent',iris: '#1f2937' },
    '蓝宝石眼睛':     { style: 'round',   iris: '#1d4ed8' },
    '翡翠绿眼睛':     { style: 'round',   iris: '#059669' },
    '紫水晶眼睛':     { style: 'round',   iris: '#7c3aed' },
    '金色眼睛':       { style: 'round',   iris: '#d97706' },
    '异色瞳':         { style: 'hetero',  iris: '#1d4ed8', iris2: '#d97706' },
    '小眯眯眼':       { style: 'squint',  iris: '#1f2937' },
    '亮晶晶的眼睛':   { style: 'sparkle', iris: '#0ea5e9' },
    '琥珀色眼睛':     { style: 'round',   iris: '#b45309' },
    '彩虹色眼睛':     { style: 'rainbow', iris: '#7c3aed' },
    '小桃心眼':       { style: 'heart',   iris: '#ef4444' },
    '黑曜石眼睛':     { style: 'round',   iris: '#111827' },
    '蜂蜜色眼睛':     { style: 'round',   iris: '#ca8a04' },
    '冰蓝眼睛':       { style: 'round',   iris: '#0ea5e9' },
};

function _eggHashFromDna(dna) {
    const s = String(dna || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return h;
}

// 一对眼睛（左右镜像位置）。color 是虹膜色。
function _renderEyes(traits, stroke) {
    const eye = EGG_EYE_STYLE[traits.eyes] || EGG_EYE_STYLE['圆圆的大眼睛'];
    const lx = 46, rx = 74, ey = 78;
    const renderOne = (cx, iris) => {
        if (eye.style === 'crescent') {
            return `<path d="M${cx - 8} ${ey + 2} Q${cx} ${ey - 8} ${cx + 8} ${ey + 2}" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/>`;
        }
        if (eye.style === 'squint') {
            return `<path d="M${cx - 7} ${ey} Q${cx} ${ey + 2} ${cx + 7} ${ey}" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/>`;
        }
        if (eye.style === 'star') {
            const pts = [];
            for (let i = 0; i < 10; i++) {
                const r = i % 2 === 0 ? 7 : 3;
                const a = -Math.PI / 2 + (i * Math.PI) / 5;
                pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(ey + Math.sin(a) * r).toFixed(1)}`);
            }
            return `<polygon points="${pts.join(' ')}" fill="${iris}" stroke="${stroke}" stroke-width="1.2"/>`;
        }
        if (eye.style === 'heart') {
            return `<path d="M${cx} ${ey + 6} C${cx - 9} ${ey - 2} ${cx - 8} ${ey - 8} ${cx - 3} ${ey - 6} Q${cx} ${ey - 4} ${cx + 3} ${ey - 6} C${cx + 8} ${ey - 8} ${cx + 9} ${ey - 2} ${cx} ${ey + 6} Z" fill="${iris}" stroke="${stroke}" stroke-width="1.2"/>`;
        }
        // round / sparkle / rainbow / hetero 都基于圆形眼白 + 虹膜
        const irisFill = eye.style === 'rainbow' ? 'url(#mhEggIrisRainbow)' : iris;
        const sparkles = eye.style === 'sparkle'
            ? `<circle cx="${cx + 5}" cy="${ey - 4}" r="1.2" fill="#ffffff" opacity="0.9"/>
               <circle cx="${cx - 6}" cy="${ey + 3}" r="0.9" fill="#ffffff" opacity="0.7"/>`
            : '';
        return `
            <ellipse cx="${cx}" cy="${ey}" rx="7" ry="8" fill="#ffffff" stroke="${stroke}" stroke-width="1.6"/>
            <circle cx="${cx + 0.5}" cy="${ey + 1}" r="3.6" fill="${irisFill}"/>
            <circle cx="${cx - 1.2}" cy="${ey - 1.2}" r="1.4" fill="#ffffff"/>
            ${sparkles}`;
    };
    if (eye.style === 'hetero') {
        return renderOne(lx, eye.iris) + renderOne(rx, eye.iris2 || eye.iris);
    }
    return renderOne(lx, eye.iris) + renderOne(rx, eye.iris);
}

// 嘴巴：根据眼睛风格挑一个匹配表情；月牙眼/桃心眼用大笑，其他用呆萌小嘴。
function _renderMouth(traits, stroke) {
    const eye = EGG_EYE_STYLE[traits.eyes] || EGG_EYE_STYLE['圆圆的大眼睛'];
    if (eye.style === 'crescent' || eye.style === 'heart') {
        // 张嘴大笑
        return `<path d="M54 94 Q60 102 66 94 Z" fill="#f43f5e" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/>
                <path d="M54 94 Q60 98 66 94" fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>`;
    }
    // 默认: w 形小嘴
    return `<path d="M55 94 Q57.5 97 60 94 Q62.5 97 65 94" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// 元素属性 → 蛋身上的小纹身（左右各一个）
function _renderTattoos(traits, stroke) {
    const attr = traits.elementalAttribute;
    const color = stroke;
    const opacity = 0.7;
    // 左右两侧纹身锚点
    const L = { x: 30, y: 110 };
    const R = { x: 90, y: 110 };
    const glyph = (cx, cy) => {
        if (attr === '火') {
            return `<path d="M${cx} ${cy - 6} q4 4 2 8 q-2 -1 -3 -3 q-1 3 -3 3 q-3 -3 0 -8 q1 2 2 3 q1 -1 2 -3 Z" fill="${color}" opacity="${opacity}"/>`;
        }
        if (attr === '冰') {
            return `<g stroke="${color}" stroke-width="1.4" stroke-linecap="round" opacity="${opacity}">
                <line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}"/>
                <line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}"/>
                <line x1="${cx - 4}" y1="${cy - 4}" x2="${cx + 4}" y2="${cy + 4}"/>
                <line x1="${cx - 4}" y1="${cy + 4}" x2="${cx + 4}" y2="${cy - 4}"/>
            </g>`;
        }
        if (attr === '生命') {
            return `<path d="M${cx} ${cy + 4} C${cx - 6} ${cy - 2} ${cx - 5} ${cy - 7} ${cx - 1.5} ${cy - 5} Q${cx} ${cy - 3} ${cx + 1.5} ${cy - 5} C${cx + 5} ${cy - 7} ${cx + 6} ${cy - 2} ${cx} ${cy + 4} Z" fill="${color}" opacity="${opacity}"/>`;
        }
        if (attr === '暗') {
            return `<path d="M${cx + 4} ${cy - 4} a6 6 0 1 1 -6 -2 a4 4 0 1 0 6 2 Z" fill="${color}" opacity="${opacity}"/>`;
        }
        // 自然（默认）：小叶子
        return `<path d="M${cx - 5} ${cy + 4} Q${cx - 2} ${cy - 6} ${cx + 5} ${cy - 4} Q${cx + 2} ${cy + 6} ${cx - 5} ${cy + 4} Z" fill="${color}" opacity="${opacity}"/>
                <line x1="${cx - 5}" y1="${cy + 4}" x2="${cx + 2}" y2="${cy - 2}" stroke="${color}" stroke-width="1" opacity="${opacity}"/>`;
    };
    return glyph(L.x, L.y) + glyph(R.x, R.y);
}

/**
 * 生成"蛋蛋"宠物 SVG。
 * pet 可以省略 → 返回金黄色默认蛋（用于占位 / 预加载）。
 */
export function buildEggSvg(pet) {
    let traits = null;
    try { if (pet?.dna) traits = decodeDna(pet.dna); } catch { traits = null; }
    const palette = (traits && EGG_BODY_PALETTE[traits.color]) || DEFAULT_EGG_PALETTE;
    const safeTraits = traits || { color: '金黄色', eyes: '圆圆的大眼睛', elementalAttribute: '自然' };
    const stroke = palette.stroke;
    // 用 dna hash 给纹身/腮红做一点随机偏移，让不同蛋有差异
    const h = _eggHashFromDna(pet?.dna || '');
    const cheekDx = (h % 3) - 1; // -1..1
    const rainbowDefs = palette.rainbow
        ? `<linearGradient id="mhEggBodyRainbow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fff1f2"/>
              <stop offset="35%" stop-color="#fde68a"/>
              <stop offset="65%" stop-color="#bae6fd"/>
              <stop offset="100%" stop-color="#c4b5fd"/>
           </linearGradient>` : '';
    const irisRainbowDefs = `<linearGradient id="mhEggIrisRainbow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ef4444"/>
        <stop offset="50%" stop-color="#22c55e"/>
        <stop offset="100%" stop-color="#3b82f6"/>
      </linearGradient>`;
    const bodyFill = palette.rainbow ? 'url(#mhEggBodyRainbow)' : 'url(#mhEggBody)';
    return `
<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
  <defs>
    <radialGradient id="mhEggBody" cx="40%" cy="35%" r="75%">
      <stop offset="0%" stop-color="${palette.light}"/>
      <stop offset="55%" stop-color="${palette.mid}"/>
      <stop offset="100%" stop-color="${palette.dark}"/>
    </radialGradient>
    <radialGradient id="mhEggShine" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    ${rainbowDefs}
    ${irisRainbowDefs}
  </defs>
  <ellipse cx="60" cy="125" rx="36" ry="6" fill="#000" opacity="0.12"/>
  <path d="M60 12 C90 12 104 56 104 86 C104 114 84 132 60 132 C36 132 16 114 16 86 C16 56 30 12 60 12 Z"
        fill="${bodyFill}" stroke="${stroke}" stroke-width="2"/>
  <!-- 蛋身波纹（保留原有"蛋"的视觉） -->
  <path d="M28 60 q8 -5 16 0 t16 0 t16 0 t12 0" fill="none" stroke="${stroke}" stroke-width="2"
        stroke-linecap="round" opacity="0.45"/>
  <path d="M26 116 q9 -5 18 0 t18 0 t18 0 t8 0" fill="none" stroke="${stroke}" stroke-width="2"
        stroke-linecap="round" opacity="0.35"/>
  <!-- 纹身（元素属性图案） -->
  ${_renderTattoos(safeTraits, stroke)}
  <!-- 腮红 -->
  <ellipse cx="${40 + cheekDx}" cy="90" rx="5" ry="3" fill="#fb7185" opacity="0.55"/>
  <ellipse cx="${80 + cheekDx}" cy="90" rx="5" ry="3" fill="#fb7185" opacity="0.55"/>
  <!-- 眼睛 -->
  ${_renderEyes(safeTraits, stroke)}
  <!-- 嘴巴 -->
  ${_renderMouth(safeTraits, stroke)}
  <!-- 高光 -->
  <ellipse cx="44" cy="44" rx="13" ry="18" fill="url(#mhEggShine)"/>
</svg>`;
}

// 旧 API 兼容：导出"默认金黄色蛋" SVG / data URL，供预加载和静态占位使用。
export const EGG_SVG = buildEggSvg(null);
const EGG_DATA_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(EGG_SVG.trim());

/** 简化获取 egg 的 data URL（用于 <img src=...>） */
export function getEggDataUrl() { return EGG_DATA_URL; }

/** 当前 pet 应显示精灵图中的哪一格；若返回 null 表示应该显示蛋。 */
export function getPetSpriteCell(pet) {
    if (!pet) return null;
    if (_isEggAwaitingSheet(pet)) return null;
    if (!pet.imageSheetUrl) return null;
    const row = STAGE_ROW[pet.stage];
    if (row == null) return null; // egg 或未知阶段 → 显示蛋
    return { row, col: _animCol(pet.anim) };
}

/**
 * 返回 pet 形象的 HTML（始终铺满父容器）。视图层使用这个函数。
 * pet.id 用作 data-mh-pet → 本模块在每次 notify 后扫描并接管渲染（含动画 + 透明化）。
 * 没有 id 的临时预览 pet（如孵化预览）会回退到下面的静态 inline 渲染。
 * @param {object} pet
 * @param {object} [opts]
 * @param {string} [opts.alt] 图片 alt
 * @param {string} [opts.extraClass] 附加 class（例如 'floaty'）
 * @param {'idle'|'walk'} [opts.motion] 动作模式：'idle'=轻微呼吸（默认）, 'walk'=史莱姆 squash/stretch
 * @param {boolean} [opts.requireProcessedTexture] false 时允许透明化完成前显示原始图
 */
export function petArtHtml(pet, opts = {}) {
    const alt = escapeHtml(opts.alt || '');
    const extraClass = opts.extraClass ? ` ${opts.extraClass}` : '';
    const motion = opts.motion === 'walk' ? 'walk' : 'idle';
    const requireProcessedTexture = opts.requireProcessedTexture !== false;
    const cell = getPetSpriteCell(pet);
    const petId = escapeHtml(pet?.id || '');
    const requireAttr = requireProcessedTexture ? ' data-mh-pet-require-processed="1"' : '';
    const hostAttrs = `data-mh-pet="${petId}" data-mh-pet-motion="${motion}"${requireAttr} aria-label="${alt}"`;
    const hostStyle = 'width:100%;height:100%;display:block';
    const row = _stageRow(pet);

    if (requireProcessedTexture && row != null && !isPetProcessedTextureReady(pet)) {
        return `<div class="mh-pet-art mh-pet-art-pending${extraClass}" ${hostAttrs} aria-hidden="true"
            style="${hostStyle};visibility:hidden;pointer-events:none"></div>`;
    }

    const eggSvg = buildEggSvg(pet);
    if (!cell) {
        // 蛋阶段 / 孵化待揭晓 / 还没有 sheet：先 inline 渲染蛋形，pet.js 就绪后会接管
        return `<div class="mh-pet-art mh-pet-art-egg${extraClass}" ${hostAttrs}
            style="${hostStyle};display:flex;align-items:center;justify-content:center">
            ${eggSvg}
        </div>`;
    }
    // 已有 sheet：先保持不可见，mountPetArt 会在透明化处理完成后接管
    return `<div class="mh-pet-art mh-pet-art-egg${extraClass}" ${hostAttrs}
        style="${hostStyle};display:flex;align-items:center;justify-content:center">
        ${eggSvg}
    </div>`;
}

/**
 * 切换已挂载占位符的动作模式（'idle' | 'walk'）。
 * 视图层在宠物开始 / 停止移动时调用即可，不需要重建 DOM。
 */
export function setPetMotion(elOrId, motion) {
    const m = motion === 'walk' ? 'walk' : 'idle';
    let els = [];
    if (typeof elOrId === 'string') {
        const root = document.getElementById('app') || document.body;
        els = root ? Array.from(root.querySelectorAll(`[data-mh-pet="${elOrId}"]`)) : [];
    } else if (elOrId instanceof Element) {
        els = [elOrId];
    }
    els.forEach((el) => {
        if (el.dataset.mhPetMotion === m) return;
        el.dataset.mhPetMotion = m;
        const inner = el.querySelector('.mh-pet-art-sprite');
        if (inner) {
            inner.classList.toggle('mh-pet-walk', m === 'walk');
            inner.classList.toggle('mh-pet-idle', m !== 'walk');
        }
    });
}

// === Sheet URL 缓存（DNA → URL）：localStorage 持久化 ===
// v6: 许愿缓存键包含参考图片，避免换图后复用旧生成结果。
const SHEET_CACHE_KEY = 'magichaqi.petSheetCache.v6';
let _sheetUrlCache = null;
function _loadSheetCache() {
    if (_sheetUrlCache) return _sheetUrlCache;
    try { _sheetUrlCache = JSON.parse(localStorage.getItem(SHEET_CACHE_KEY) || '{}') || {}; }
    catch (_) { _sheetUrlCache = {}; }
    return _sheetUrlCache;
}
function _persistSheetCache() {
    try { localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(_loadSheetCache())); } catch (_) {}
}
export function getCachedSheetUrl(dna) {
    if (!dna) return null;
    return _loadSheetCache()[dna] || null;
}
function setCachedSheetUrl(dna, url) {
    if (!dna || !url) return;
    _loadSheetCache()[dna] = url;
    _persistSheetCache();
}

function _resolvePetWish(pet, dna) {
    const direct = typeof pet?.wishPrompt === 'string' ? pet.wishPrompt.trim() : '';
    if (direct) return direct;
    const byId = pet?.id ? state.pets?.[pet.id] : null;
    const fromId = typeof byId?.wishPrompt === 'string' ? byId.wishPrompt.trim() : '';
    if (fromId) return fromId;
    const current = state.currentPetId ? state.pets?.[state.currentPetId] : null;
    const currentWish = current?.dna === dna && typeof current.wishPrompt === 'string'
        ? current.wishPrompt.trim()
        : '';
    if (currentWish) return currentWish;
    const match = Object.values(state.pets || {}).find(item => (
        item?.dna === dna
        && typeof item.wishPrompt === 'string'
        && item.wishPrompt.trim()
        && !item.imageSheetUrl
    ));
    return match ? match.wishPrompt.trim() : '';
}

function _sheetCacheKeyForPet(pet, dna = pet?.dna || '') {
    const wish = _resolvePetWish(pet, dna);
    const referenceImage = _resolvePetWishReferenceImage(pet, dna);
    const parts = [dna];
    if (wish) parts.push(`w:${_hashWish(wish)}`);
    if (referenceImage) parts.push(`r:${_hashWish(referenceImage)}`);
    return parts.join('|');
}

function _getCachedSheetUrlForPet(pet) {
    const dna = pet?.dna || '';
    if (!dna) return null;
    return getCachedSheetUrl(_sheetCacheKeyForPet(pet, dna));
}

// === 同 DNA 并发去重 ===
const _inflight = new Map(); // cacheKey -> Promise<url|null>
const _sheetRequestVersionByPetId = new Map(); // petId -> version

function _hashWish(text) {
    const s = String(text || '');
    if (!s) return '';
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return h.toString(36);
}

function _resolvePetWishReferenceImage(pet, dna) {
    const direct = typeof pet?.wishReferenceImage === 'string' ? pet.wishReferenceImage.trim() : '';
    if (direct) return direct;
    const byId = pet?.id ? state.pets?.[pet.id] : null;
    const fromId = typeof byId?.wishReferenceImage === 'string' ? byId.wishReferenceImage.trim() : '';
    if (fromId) return fromId;
    const current = state.currentPetId ? state.pets?.[state.currentPetId] : null;
    const currentImage = current?.dna === dna && typeof current.wishReferenceImage === 'string'
        ? current.wishReferenceImage.trim()
        : '';
    if (currentImage) return currentImage;
    const match = Object.values(state.pets || {}).find(item => (
        item?.dna === dna
        && typeof item.wishReferenceImage === 'string'
        && item.wishReferenceImage.trim()
        && !item.imageSheetUrl
    ));
    return match ? match.wishReferenceImage.trim() : '';
}

/**
 * 生成 / 复用 4×4 sprite sheet。
 * 命中 localStorage 缓存或 in-flight 请求时直接返回，不会再次调用 LLM。
 * 若 pet.wishPrompt / pet.wishReferenceImage 存在，则改为以玩家许愿驱动 LLM，并纳入缓存键。
 * @param {object} pet
 * @param {object} [options]
 * @param {boolean} [options.assignToPet=true]
 * @returns {Promise<string|null>}
 */
export async function generatePetSheet(pet, { assignToPet = true } = {}) {
    if (!pet) return null;
    const dna = pet.dna || '';
    if (!dna) return null;

    const requestVersion = _getPetSheetRequestVersion(pet);

    const wish = _resolvePetWish(pet, dna);
    const referenceImage = _resolvePetWishReferenceImage(pet, dna);
    const cacheKey = _sheetCacheKeyForPet(pet, dna);

    const cached = getCachedSheetUrl(cacheKey);
    if (cached) {
        if (assignToPet && !pet.imageSheetUrl) pet.imageSheetUrl = cached;
        return cached;
    }
    if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);

    const promise = (async () => {
        try {
            const { genPetSheet } = await import('./api.js');
            const url = await genPetSheet(dna, dnaToName(dna), (wish || referenceImage) ? { customPrompt: wish, referenceImage } : undefined);
            const staleRequest = _isPetSheetRequestStale(pet, requestVersion);
            if (url && !staleRequest) {
                setCachedSheetUrl(cacheKey, url);
                if (assignToPet && pet) {
                    pet.imageSheetUrl = url;
                    _requestReadyEggHatch(pet);
                    try { savePetDebounced(pet); } catch (_) {}
                }
            }
            return staleRequest ? null : (url || null);
        } catch (e) {
            console.warn('[pet] generatePetSheet 失败', e);
            return null;
        } finally {
            if (_inflight.get(cacheKey) === promise) _inflight.delete(cacheKey);
        }
    })();
    _inflight.set(cacheKey, promise);
    return promise;
}

function _getPetSheetRequestVersion(pet) {
    return pet?.id ? (_sheetRequestVersionByPetId.get(pet.id) || 0) : 0;
}

function _bumpPetSheetRequestVersion(pet) {
    if (!pet?.id) return 0;
    const version = _getPetSheetRequestVersion(pet) + 1;
    _sheetRequestVersionByPetId.set(pet.id, version);
    return version;
}

function _isPetSheetRequestStale(pet, requestVersion) {
    return pet?.id ? _getPetSheetRequestVersion(pet) !== requestVersion : false;
}

function _invalidatePetSheet(pet, { clearCurrent = false } = {}) {
    if (!pet) return 0;
    const requestVersion = _bumpPetSheetRequestVersion(pet);

    const currentUrl = pet.imageSheetUrl || '';
    const dna = pet.dna || '';
    const cacheKeys = new Set();
    if (dna) {
        cacheKeys.add(dna);
        cacheKeys.add(_sheetCacheKeyForPet(pet, dna));
    }

    const cache = _loadSheetCache();
    let changed = false;
    cacheKeys.forEach(key => {
        if (!key) return;
        if (Object.prototype.hasOwnProperty.call(cache, key)) changed = true;
        delete cache[key];
        _inflight.delete(key);
    });
    if (currentUrl) {
        Object.keys(cache).forEach(key => {
            if (cache[key] === currentUrl) {
                delete cache[key];
                _inflight.delete(key);
                changed = true;
            }
        });
    }
    if (changed) _persistSheetCache();

    if (clearCurrent && currentUrl) {
        _processed.delete(currentUrl);
        _memoryImages.delete(currentUrl);
    }
    if (clearCurrent) {
        pet.imageUrl = null;
        pet.imageSheetUrl = null;
    }
    return requestVersion;
}

export function resetPetSheetImage(pet) {
    _invalidatePetSheet(pet, { clearCurrent: true });
}

/**
 * Force a fresh sprite sheet for the pet's current DNA / wish.
 * By default the existing art stays visible until the new sheet has been processed, so this is safe for any stage.
 */
export async function regeneratePetSheet(pet, { clearCurrent = false, notify: shouldNotify = true } = {}) {
    if (!pet) return null;
    const requestVersion = _invalidatePetSheet(pet, { clearCurrent });
    const url = await generatePetSheet(pet, { assignToPet: false });
    if (!url) return null;

    const processed = getProcessedSheet(url);
    await processed?.promise;
    if (_isPetSheetRequestStale(pet, requestVersion)) return null;

    pet.imageUrl = null;
    pet.imageSheetUrl = url;
    try { savePetDebounced(pet); } catch (_) {}
    if (shouldNotify) {
        try { const { notify } = await import('./state.js'); notify(); } catch (_) {}
    }
    return url;
}

// Sprite sheet background removal runs in petSheetWorker.js. Keep the main thread free for rendering.

let _sheetWorker = null;
let _sheetWorkerFailed = false;
let _sheetWorkerSeq = 0;
const _sheetWorkerJobs = new Map();

function _getSheetWorker() {
    if (_sheetWorkerFailed) return null;
    if (_sheetWorker) return _sheetWorker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
    try {
        _sheetWorker = new Worker(new URL('./petSheetWorker.js', import.meta.url));
        _sheetWorker.onmessage = (event) => {
            const { id, ok, blob, direct, width, height, error } = event.data || {};
            const job = _sheetWorkerJobs.get(id);
            if (!job) return;
            _sheetWorkerJobs.delete(id);
            if (ok && direct) job.resolve({ direct: true, blob: null, width, height, dataUrl: job.url });
            else if (ok && blob) job.resolve({ direct: false, blob, width, height, dataUrl: URL.createObjectURL(blob) });
            else job.reject(new Error(error || 'pet sheet worker failed'));
        };
        _sheetWorker.onerror = (event) => {
            _sheetWorkerFailed = true;
            console.warn('[pet] sheet worker 出错，将保留原始 sheet：', event?.message || event);
            for (const [, job] of _sheetWorkerJobs) job.reject(new Error('pet sheet worker crashed'));
            _sheetWorkerJobs.clear();
            try { _sheetWorker.terminate(); } catch (_) {}
            _sheetWorker = null;
        };
        return _sheetWorker;
    } catch (e) {
        _sheetWorkerFailed = true;
        console.warn('[pet] sheet worker 初始化失败，将保留原始 sheet：', e);
        return null;
    }
}

async function _processSheetInWorker(url) {
    const worker = _getSheetWorker();
    if (!worker) return null;
    const id = ++_sheetWorkerSeq;
    return await new Promise((resolve, reject) => {
        _sheetWorkerJobs.set(id, { resolve, reject, url });
        try {
            worker.postMessage({ id, url });
        } catch (e) {
            _sheetWorkerJobs.delete(id);
            reject(e);
        }
    });
}

/**
 * 加载并处理 sheet。返回 { status, dataUrl, dataBlob, width, height } —— dataUrl 是可渲染 URL，处理完成后才有值。
 */
export function getProcessedSheet(url) {
    if (!url) return null;
    const existing = _processed.get(url);
    if (existing) return existing;

    const entry = { status: 'loading', rawUrl: url, dataUrl: null, dataBlob: null, width: 0, height: 0, promise: null };
    _processed.set(url, entry);

    entry.promise = (async () => {
        const worker = _getSheetWorker();
        if (!worker) {
            entry.status = 'raw';
            _scheduleScan();
            return entry;
        }
        entry.status = 'processing';
        _scheduleScan();
        try {
            const processed = await _processSheetInWorker(url);
            entry.dataBlob = processed?.blob || null;
            entry.dataUrl = processed?.dataUrl || null;
            entry.width = Number(processed?.width) || 0;
            entry.height = Number(processed?.height) || 0;
            entry.status = entry.dataUrl ? 'loaded' : 'raw';
        } catch (e) {
            console.warn('[pet] sheet worker 处理失败，将保留原始 sheet：', e);
            entry.status = 'raw';
        }
        _scheduleScan();
        return entry;
    })();
    return entry;
}

export function isPetProcessedTextureReady(pet) {
    const row = _stageRow(pet);
    if (row == null || _isEggAwaitingSheet(pet)) return true;
    const url = pet?.imageSheetUrl || _getCachedSheetUrlForPet(pet);
    if (!url) return false;
    const processed = getProcessedSheet(url);
    return !!(processed?.status === 'loaded' && processed.dataUrl);
}

const _processed = new Map(); // url -> { status, rawUrl, dataUrl, dataBlob, width, height, promise }
const _memoryImages = new Map(); // url -> { status, img, promise }

function _preloadImageToMemory(url, { crossOrigin = null } = {}) {
    if (!url || typeof Image === 'undefined') return Promise.resolve(null);
    const existing = _memoryImages.get(url);
    if (existing) return existing.promise || Promise.resolve(existing);

    const entry = { status: 'loading', img: null, promise: null };
    _memoryImages.set(url, entry);
    entry.promise = new Promise((resolve) => {
        const img = new Image();
        if (crossOrigin && !String(url).startsWith('data:')) img.crossOrigin = crossOrigin;
        const finish = (status) => {
            entry.status = status;
            entry.img = status === 'loaded' ? img : null;
            resolve(entry);
        };
        img.onload = async () => {
            try { if (typeof img.decode === 'function') await img.decode(); } catch (_) {}
            finish('loaded');
        };
        img.onerror = () => finish('error');
        img.src = url;
    });
    return entry.promise;
}

/**
 * Warm pet art into memory for instant level switches.
 * This starts the same image load + transparent-sheet processing used by mountPetArt,
 * then decodes the final renderable data URL and keeps the Image objects alive.
 */
export function preloadPetAssets(pets, { includeAll = true } = {}) {
    const list = Array.isArray(pets) ? pets : (pets ? [pets] : []);
    const targets = includeAll ? list : list.slice(0, 1);
    if (!targets.length) return Promise.resolve([]);

    return Promise.allSettled(targets.map(async (pet) => {
        if (!pet) return null;
        const row = _stageRow(pet);
        const url = pet.imageSheetUrl || _getCachedSheetUrlForPet(pet);
        if (!url || row == null) {
            await _preloadImageToMemory(EGG_DATA_URL);
            return { petId: pet.id, status: 'egg' };
        }

        if (!pet.imageSheetUrl) pet.imageSheetUrl = url;
        const processed = getProcessedSheet(url);
        await processed?.promise;
        if (processed?.status === 'loaded' && processed.dataUrl) {
            await _preloadImageToMemory(processed.dataUrl);
            return { petId: pet.id, status: 'loaded' };
        }
        await _preloadImageToMemory(url, { crossOrigin: 'anonymous' });
        return { petId: pet.id, status: processed?.status || 'raw' };
    }));
}

// === 渲染 + 动画 ===
// element -> { state, intervalId, inner }
const _mounted = new WeakMap();

function _stageRow(pet) {
    const r = STAGE_ROW[pet?.stage];
    return r == null ? null : r;
}

/**
 * 把宠物画面挂载到指定容器（替换其内容），固定显示 idle 列。
 * 如果该容器已经处在期望状态，本函数是无操作。
 */
export function mountPetArt(el, pet) {
    if (!el || !pet) return;
    const url = pet.imageSheetUrl || _getCachedSheetUrlForPet(pet);
    const row = _stageRow(pet);
    const requireProcessedTexture = el.dataset.mhPetRequireProcessed === '1';

    if (requireProcessedTexture && row != null && !url) {
        const mountKey = `sprite-pending|no-url|${pet.dna || ''}`;
        if (el.dataset.mhPetMounted !== mountKey) {
            el.dataset.mhPetMounted = mountKey;
            el.innerHTML = '';
        }
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
        _mounted.set(el, { state: mountKey, inner: null });
        return;
    }

    // 蛋阶段 / 孵化待揭晓 / 还没有 sheet → 蛋形 SVG（按 DNA 渲染颜色 / 眼睛 / 纹身）
    if (_isEggAwaitingSheet(pet) || !url || row == null) {
        const mountKey = `egg|${pet.dna || ''}`;
        if (el.dataset.mhPetMounted !== mountKey) {
            el.dataset.mhPetMounted = mountKey;
            el.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${buildEggSvg(pet)}</div>`;
        }
        el.style.visibility = '';
        el.style.pointerEvents = '';
        el.removeAttribute('aria-hidden');
        _syncAnimClass(el, pet.anim, pet);
        _mounted.set(el, { state: 'egg', inner: null });
        return;
    }

    const col = _animCol(pet.anim);

    // 透明化处理未完成时，先显示原图对应格子，避免首屏被同步像素处理卡住。
    const proc = getProcessedSheet(url);
    if (!(proc?.status === 'loaded' && proc.dataUrl)) {
        if (requireProcessedTexture) {
            const waitKey = `sprite-pending|${proc?.rawUrl || url}|${row}|${col}`;
            if (el.dataset.mhPetMounted !== waitKey) {
                el.dataset.mhPetMounted = waitKey;
                el.innerHTML = '';
            }
            el.style.visibility = 'hidden';
            el.style.pointerEvents = 'none';
            el.setAttribute('aria-hidden', 'true');
            _mounted.set(el, { state: waitKey, inner: null });
            return;
        }
        const rawUrl = proc?.rawUrl || url;
        const wantRaw = `sprite-raw|${rawUrl}|${row}|${col}`;
        if (el.dataset.mhPetMounted !== wantRaw) {
            const bx = (col * 100 / (SHEET_COLS - 1)).toFixed(3);
            const by = (row * 100 / (SHEET_ROWS - 1)).toFixed(3);
            el.dataset.mhPetMounted = wantRaw;
            el.innerHTML = `<div class="mh-pet-flip"><div class="mh-pet-art mh-pet-art-sprite mh-pet-idle" style="width:100%;height:100%;background-image:url(&quot;${escapeHtml(rawUrl)}&quot;);background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></div></div>`;
        }
        _syncAnimClass(el, pet.anim, pet);
        _mounted.set(el, { state: wantRaw, inner: el.querySelector('.mh-pet-art') });
        return; // 处理完成会通过 _scheduleScan 再次进入 mountPetArt
    }
    const renderUrl = proc.dataUrl;
    el.style.visibility = '';
    el.style.pointerEvents = '';
    el.removeAttribute('aria-hidden');

    const want = `sprite|${url}|${row}|${col}`;
    const prev = _mounted.get(el);
    const motion = el.dataset.mhPetMotion === 'walk' ? 'walk' : 'idle';
    if (prev?.state === want && prev.inner) {
        if (prev.inner.dataset.bgUrl !== renderUrl) {
            prev.inner.dataset.bgUrl = renderUrl;
            prev.inner.style.backgroundImage = `url("${renderUrl}")`;
        }
        // 同步 motion class（占位符可能在外部被改过 data-mh-pet-motion）
        const wantWalk = motion === 'walk';
        if (prev.inner.classList.contains('mh-pet-walk') !== wantWalk) {
            prev.inner.classList.toggle('mh-pet-walk', wantWalk);
            prev.inner.classList.toggle('mh-pet-idle', !wantWalk);
        }
        _syncAnimClass(el, pet.anim, pet);
        return;
    }

    // 外层：周期性水平翻转（让站立形象偶尔朝向另一边）
    const flipWrap = document.createElement('div');
    flipWrap.className = 'mh-pet-flip';
    // 用 pet.id 派生稳定的随机相位，避免画面里多只宠物同步翻转
    const flipDelay = -((_hashToUnit(pet.id || url) * 22).toFixed(2)) + 's';
    flipWrap.style.animationDelay = flipDelay;

    // 内层：背景精灵图 + 动作动画（idle = 呼吸 / walk = 史莱姆 squash/stretch）
    const inner = document.createElement('div');
    inner.className = `mh-pet-art mh-pet-art-sprite ${motion === 'walk' ? 'mh-pet-walk' : 'mh-pet-idle'}`;
    inner.dataset.bgUrl = renderUrl;
    const bx = (col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    inner.style.cssText =
        `width:100%;height:100%;` +
        `background-image:url("${renderUrl}");` +
        `background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;` +
        `background-position:${bx}% ${by}%;` +
        `background-repeat:no-repeat;image-rendering:auto`;
    // motion 动画的相位偏移按周期长度独立散开
    const motionPeriod = motion === 'walk' ? 1.3 : 12;
    const motionDelay = -((_hashToUnit((pet.id || url) + '#m') * motionPeriod).toFixed(2)) + 's';
    inner.style.animationDelay = motionDelay;

    flipWrap.appendChild(inner);
    el.dataset.mhPetMounted = want;
    el.innerHTML = '';
    el.appendChild(flipWrap);

    _syncAnimClass(el, pet.anim, pet);

    _mounted.set(el, { state: want, inner });
}

// 把字符串映射到 [0,1) 的稳定哈希，用作动画相位偏移
function _hashToUnit(s) {
    const str = String(s || '');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0) / 4294967296;
}

/**
 * 扫描根元素下所有 [data-mh-pet] 占位符并挂载。
 */
export function scanAndMount(root) {
    const r = root || document.getElementById('app') || document.body;
    if (!r) return;
    const els = r.querySelectorAll('[data-mh-pet]');
    els.forEach((el) => {
        const id = el.getAttribute('data-mh-pet');
        if (!id) return;
        const visitPet = state.visitingMode?.friendPet;
        const pet = state.pets[id] || (visitPet?.id === id ? visitPet : null);
        if (pet) mountPetArt(el, pet);
    });
}

let _scanScheduled = false;
function _scheduleScan() {
    if (_scanScheduled) return;
    _scanScheduled = true;
    requestAnimationFrame(() => {
        _scanScheduled = false;
        try {
            scanAndMount();
            _tryReadyEggHatches();
        } catch (e) { console.warn('[pet] scanAndMount 失败', e); }
    });
}

// 视图每次 render 之后会触发 notify → 我们在下一帧重新扫描并接管所有占位符
subscribe(_scheduleScan);

// 兜底：有些代码路径（如 view_home.js 的 runZoomTransition）会直接修改 DOM
// 而不调用 notify()，导致新插入的 [data-mh-pet] 占位符不会被扫描。
// 用 MutationObserver 监听 #app 子树变化，自动补一次扫描。
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const startObserver = () => {
        const root = document.getElementById('app') || document.body;
        if (!root) return;
        const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.('[data-mh-pet]') || node.querySelector?.('[data-mh-pet]')) {
                        _scheduleScan();
                        return;
                    }
                }
            }
        });
        mo.observe(root, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
        startObserver();
    }
}
