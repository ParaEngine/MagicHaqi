// 状态衰减 + 阶段升级
import { CONFIG } from './config.js';
import { notify, state } from './state.js';
import { savePetDebounced } from './storage.js';
import { clamp } from './utils.js';
import { isAdultStage } from './dna.js';
import { applyReleasedPetAutoCareStats, getPetLocationType, hasNannyCare, nannyGrowthRate, softenStatsToAverage } from './petLifecycle.js';
import { isNightSleepTime, nextMorningWakeAt, normalizePetSleepState } from './pet.js';

export { canRecoverEnergyFromSleep, recoverEnergyAfterSleep } from './pet.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const sicknessTreatmentReductions = new Map();

export const SICKNESS_DEFS = [
    { id: 'flu', name: '流感', label: '发热乏力', stats: ['hunger', 'mood'], baseWeight: 1.1, lowBias: 2.1, color: '#ef4444' },
    { id: 'diarrhea', name: '拉肚子', label: '肠胃不适', stats: ['hunger', 'clean'], baseWeight: 1, lowBias: 2.4, color: '#f97316' },
    { id: 'bacterial', name: '细菌感染', label: '环境感染', stats: ['clean'], baseWeight: 0.9, lowBias: 3.1, color: '#16a34a' },
    { id: 'depression', name: '抑郁', label: '情绪低落', stats: ['mood', 'bond'], baseWeight: 0.9, lowBias: 2.9, color: '#6366f1' },
    { id: 'fatigue', name: '过劳虚弱', label: '体力透支', stats: ['hunger', 'bond'], baseWeight: 0.75, lowBias: 2.2, color: '#0ea5e9' },
    { id: 'allergy', name: '过敏', label: '免疫反应', stats: ['clean', 'mood'], baseWeight: 0.7, lowBias: 1.8, color: '#ec4899' },
];

export function defaultStats() {
    return { hunger: 80, mood: 80, clean: 80, bond: 30 };
}

// 蛋的初始属性：除 hunger=0 之外，其余统一为 60。
// 蛋阶段不衰减；只有当玩家喂食一次后，DNA 才会最终确定并孵化为 baby。
export function eggStats() {
    return { hunger: 0, mood: 60, clean: 60, bond: 60 };
}

export function isActivePet(pet) {
    return !!pet?.id && pet.id === state.currentPetId;
}

export function normalizeReleasedPetAutoCare(pet, now = Date.now()) {
    if (!isActivePet(pet)) return false;
    if (!pet || getPetLocationType(pet) !== 'released') return false;
    normalizePetStats(pet);
    const changedStats = applyReleasedPetAutoCareStats(pet);
    let changed = changedStats;

    if (isNightSleepTime(now)) {
        const wakeAt = nextMorningWakeAt(now);
        if (pet.anim !== 'sleep') {
            pet.anim = 'sleep';
            pet.sleepStartedAt = now;
            changed = true;
        }
        if (Number(pet.sleepLockedUntil) !== wakeAt) {
            pet.sleepLockedUntil = wakeAt;
            changed = true;
        }
    } else if (pet.anim === 'sleep' || pet.sleepLockedUntil || pet.sleepStartedAt) {
        pet.anim = 'idle';
        delete pet.sleepStartedAt;
        delete pet.sleepLockedUntil;
        changed = true;
    }
    return changed;
}

export function normalizePetStats(pet) {
    if (pet?.id && !isActivePet(pet)) return pet.stats || defaultStats();
    if (!pet) return defaultStats();
    const base = pet.stage === 'egg' ? eggStats() : defaultStats();
    const stats = pet.stats && typeof pet.stats === 'object' ? pet.stats : {};
    const hunger = Number(stats.hunger);
    const legacyEnergy = Number(stats.energy);
    const hasHunger = Number.isFinite(hunger);
    const hasLegacyEnergy = Number.isFinite(legacyEnergy);
    const isRestingEgg = pet.stage === 'egg' && (!hasHunger || hunger <= 0);

    pet.stats = { ...base, ...stats };
    if (!isRestingEgg && hasLegacyEnergy) {
        pet.stats.hunger = hasHunger
            ? Math.round((hunger + legacyEnergy) / 2)
            : legacyEnergy;
    }
    pet.stats.hunger = clamp(Number(pet.stats.hunger ?? base.hunger), CONFIG.statMin, CONFIG.statMax);
    delete pet.stats.energy;
    delete pet.stats.health;
    delete pet.stats.intel;
    return pet.stats;
}

function localDayKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function sicknessReductionKey(pet) {
    const sickness = pet?.sickness;
    if (!pet?.id || !sickness?.type || !sickness?.startedAt) return '';
    return `${pet.id}:${sickness.type}:${Number(sickness.startedAt) || 0}`;
}

export function getSicknessDef(type) {
    return SICKNESS_DEFS.find(def => def.id === type) || null;
}

export function normalizeSickness(pet, now = Date.now()) {
    if (!pet) return null;
    if (pet.stage === 'egg') {
        if (pet.sickness) delete pet.sickness;
        return null;
    }
    const sickness = pet.sickness;
    if (!sickness || typeof sickness !== 'object') return null;
    const def = getSicknessDef(sickness.type);
    const startedAt = Number(sickness.startedAt);
    if (!def || !Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now + DAY_MS) {
        delete pet.sickness;
        return null;
    }
    pet.sickness = {
        type: def.id,
        startedAt,
    };
    return pet.sickness;
}

export function getActiveSickness(pet, now = Date.now()) {
    const sickness = normalizeSickness(pet, now);
    if (!sickness) return null;
    const def = getSicknessDef(sickness.type);
    return def ? { ...sickness, def } : null;
}

export function hasActiveSickness(pet, now = Date.now()) {
    return !!getActiveSickness(pet, now);
}

export function getBaseSicknessSeverity(pet, now = Date.now()) {
    const sickness = getActiveSickness(pet, now);
    if (!sickness) return 0;
    const elapsed = Math.max(0, now - Number(sickness.startedAt));
    return Math.max(1, Math.min(10, 1 + Math.floor(elapsed / DAY_MS)));
}

export function getEffectiveSicknessSeverity(pet, now = Date.now()) {
    const base = getBaseSicknessSeverity(pet, now);
    if (!base) return 0;
    const key = sicknessReductionKey(pet);
    const reduction = Math.max(0, Number(sicknessTreatmentReductions.get(key)) || 0);
    return Math.max(0, base - reduction);
}

function stageSicknessMultiplier(stage) {
    if (stage === 'baby') return 1.35;
    if (stage === 'teen') return 1.12;
    if (stage === 'adult') return 0.86;
    if (stage === 'elder') return 0.74;
    return 1;
}

function statLowPressure(pet, key) {
    const value = clamp(Number(pet?.stats?.[key] ?? CONFIG.statMax), CONFIG.statMin, CONFIG.statMax);
    return Math.max(0, Math.min(1, (70 - value) / 70));
}

export function calculateSicknessProbability(pet) {
    if (!pet || pet.stage === 'egg') return 0;
    normalizePetStats(pet);
    const keys = ['hunger', 'mood', 'clean', 'bond'];
    const pressure = keys.reduce((sum, key) => sum + statLowPressure(pet, key), 0) / keys.length;
    const scaled = Math.pow(pressure, 1.15);
    const raw = (0.05 + scaled * 0.75) * stageSicknessMultiplier(pet.stage);
    return Math.max(0.05, Math.min(0.8, raw));
}

function chooseSicknessType(pet) {
    const weighted = SICKNESS_DEFS.map(def => {
        const pressure = def.stats.reduce((sum, key) => sum + statLowPressure(pet, key), 0) / Math.max(1, def.stats.length);
        return { def, weight: Math.max(0.01, def.baseWeight + pressure * def.lowBias) };
    });
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of weighted) {
        roll -= item.weight;
        if (roll <= 0) return item.def.id;
    }
    return weighted[0]?.def.id || 'flu';
}

export function maybeRollDailySickness(pet, now = Date.now()) {
    if (!pet) return false;
    if (!isActivePet(pet)) return false;
    normalizePetStats(pet);
    if (pet.stage === 'egg') {
        const hadSickness = !!pet.sickness;
        if (hadSickness) delete pet.sickness;
        return hadSickness;
    }
    if (getActiveSickness(pet, now)) return false;
    const cooldownUntil = Number(pet.sicknessCooldownUntil) || Number(pet.lastSicknessCuredAt) + DAY_MS || 0;
    if (cooldownUntil > now) return false;
    const day = localDayKey(now);
    if (pet.lastSicknessCheckDay === day) return false;
    pet.lastSicknessCheckDay = day;
    const probability = calculateSicknessProbability(pet);
    if (Math.random() >= probability) return true;
    pet.sickness = {
        type: chooseSicknessType(pet),
        startedAt: now,
    };
    sicknessTreatmentReductions.delete(sicknessReductionKey(pet));
    return true;
}

export function treatPetSicknessOneLevel(pet, now = Date.now()) {
    const sickness = getActiveSickness(pet, now);
    if (!sickness) return { ok: false, cured: false, severity: 0, remaining: 0 };
    const before = getEffectiveSicknessSeverity(pet, now);
    if (before <= 1) {
        curePetSickness(pet, now);
        return { ok: true, cured: true, severity: before, remaining: 0, sickness };
    }
    const key = sicknessReductionKey(pet);
    sicknessTreatmentReductions.set(key, (Number(sicknessTreatmentReductions.get(key)) || 0) + 1);
    return { ok: true, cured: false, severity: before, remaining: getEffectiveSicknessSeverity(pet, now), sickness };
}

export function curePetSickness(pet, now = Date.now()) {
    if (!pet) return false;
    const key = sicknessReductionKey(pet);
    const hadSickness = !!pet.sickness;
    if (key) sicknessTreatmentReductions.delete(key);
    delete pet.sickness;
    pet.lastSicknessCuredAt = now;
    pet.sicknessCooldownUntil = now + DAY_MS;
    pet.lastSicknessCheckDay = localDayKey(now);
    return hadSickness;
}

export function defaultPermanentTrauma() {
    return [];
}

export function normalizePermanentTrauma(pet) {
    if (!pet) return [];
    const max = Math.max(0, Number(CONFIG.trauma?.max) || 6);
    if (Array.isArray(pet.permanentTrauma)) {
        pet.permanentTrauma = pet.permanentTrauma
            .filter(Boolean)
            .slice(0, max)
            .map((entry, index) => ({
                id: entry.id || `trauma_${index + 1}`,
                type: entry.type || 'neglect',
                at: Number(entry.at) || pet.bornAt || Date.now(),
                reasons: Array.isArray(entry.reasons) ? entry.reasons.slice(0, 4) : [],
            }));
        return pet.permanentTrauma;
    }
    const count = Math.max(0, Math.min(max, Number(pet.permanentTrauma) || Number(pet.trauma) || 0));
    pet.permanentTrauma = Array.from({ length: count }, (_, index) => ({
        id: `legacy_trauma_${index + 1}`,
        type: 'neglect',
        at: pet.bornAt || Date.now(),
        reasons: ['旧存档导入'],
    }));
    return pet.permanentTrauma;
}

export function getPermanentTraumaCount(pet) {
    return normalizePermanentTrauma(pet).length;
}

export function markPetCared(pet, now = Date.now()) {
    if (!pet) return;
    pet.lastCareAt = now;
}

/** 默认 trait map（每个种族 0~100 累积值，最高的几项决定外观偏向）。 */
export function defaultTraits() {
    const t = {};
    for (const td of CONFIG.traitDefs) t[td.id] = 0;
    return t;
}

/** 返回 traits 中 top-N 的种族，作为外观/Field 归属判定。 */
export function dominantTraits(pet, n = 2) {
    const ts = pet?.traits || {};
    return Object.entries(ts)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => ({ id: k, value: v, def: CONFIG.traitDefs.find(d => d.id === k) }));
}

/** 喂食时增加对应种族的 trait 点数。 */
export function gainTrait(pet, traitId, amount = CONFIG.traitGainPerFeed) {
    if (!traitId) return;
    if (!pet.traits) pet.traits = defaultTraits();
    pet.traits[traitId] = clamp((pet.traits[traitId] || 0) + amount, 0, CONFIG.traitMax);
}

export function getEnergyMax(pet) {
    normalizePetStats(pet);
    return CONFIG.statMax;
}

export function clampEnergyToMax(pet) {
    if (!pet?.stats) return CONFIG.statMax;
    normalizePetStats(pet);
    pet.stats.hunger = clamp(Number(pet.stats.hunger ?? CONFIG.statMax), CONFIG.statMin, CONFIG.statMax);
    return CONFIG.statMax;
}

function traumaReasons(pet) {
    const stats = pet?.stats || {};
    const cfg = CONFIG.trauma || {};
    const reasons = [];
    if ((stats.hunger ?? 100) < (cfg.hungerThreshold ?? 25)) reasons.push('体力低');
    if ((stats.clean ?? 100) < (cfg.cleanThreshold ?? 35)) reasons.push('肮脏环境');
    if ((stats.mood ?? 100) < (cfg.moodThreshold ?? 25)) reasons.push('低落');
    if ((pet?.poops || []).length > CONFIG.poopWarningThreshold) reasons.push('便便堆积');
    return reasons;
}

export function maybeApplyPermanentTrauma(pet, now = Date.now()) {
    if (!pet) return 0;
    const traumas = normalizePermanentTrauma(pet);
    const max = Math.max(0, Number(CONFIG.trauma?.max) || 6);
    if (traumas.length >= max) return 0;

    const neglectMs = Math.max(1, Number(CONFIG.trauma?.neglectHours) || 24) * 3600 * 1000;
    const lastCareAt = Number(pet.lastCareAt) || Number(pet.bornAt) || Number(pet.lastTickAt) || now;
    if (now - lastCareAt < neglectMs) return 0;

    const reasons = traumaReasons(pet);
    if (!reasons.length) return 0;

    const lastTraumaAt = Number(pet.lastPermanentTraumaAt) || lastCareAt;
    const anchorAt = Math.max(lastCareAt, lastTraumaAt);
    const elapsed = Math.max(0, now - anchorAt);
    if (elapsed < neglectMs) return 0;
    const count = Math.floor(elapsed / neglectMs);
    const addCount = Math.min(count, max - traumas.length);
    for (let i = 0; i < addCount; i++) {
        const at = Math.min(now, anchorAt + neglectMs * (i + 1));
        traumas.push({
            id: `trauma_${at.toString(36)}_${Math.floor(Math.random() * 1000).toString(36)}`,
            type: 'neglect',
            at,
            reasons,
        });
    }
    pet.lastPermanentTraumaAt = now;
    return addCount;
}

export function applyDecay(pet, ticks = 1) {
    if (!isActivePet(pet)) return;
    normalizePetStats(pet);
    if (getPetLocationType(pet) === 'released') {
        normalizeReleasedPetAutoCare(pet);
        return;
    }
    // 蛋阶段（hunger=0 休眠）不衰减，也不会形成创伤。
    if (pet.stage === 'egg' && (pet.stats?.hunger ?? 0) <= 0) return;
    const decay = CONFIG.statDecayPerTick;
    const buff = state.planetBuff && state.planetBuff.until > Date.now() ? state.planetBuff : null;
    for (const k of Object.keys(decay)) {
        let delta = decay[k] * ticks;
        if (buff?.id === 'gluttony' && k === 'hunger') delta *= 1.5;
        if (buff?.id === 'garden' && k === 'mood') delta *= 0.65;
        if (buff?.id === 'tidal' && k === 'clean') delta += 0.25 * ticks;
        pet.stats[k] = clamp((pet.stats[k] || 0) + delta, CONFIG.statMin, CONFIG.statMax);
    }
    clampEnergyToMax(pet);
    if (hasNannyCare(pet)) softenStatsToAverage(pet);
    clampEnergyToMax(pet);
    maybeApplyPermanentTrauma(pet);
}

export function applyOfflineDecay(pet, elapsedMs, now = Date.now()) {
    if (!isActivePet(pet)) return;
    normalizePetStats(pet);
    if (getPetLocationType(pet) === 'released') {
        normalizeReleasedPetAutoCare(pet, now);
        return;
    }
    if (pet.stage === 'egg' && (pet.stats?.hunger ?? 0) <= 0) return;
    const maxHours = Math.max(0, Number(CONFIG.maxOfflineHours) || 0);
    const elapsedHours = Math.max(0, Number(elapsedMs) || 0) / 3600 / 1000;
    const hours = maxHours > 0 ? Math.min(elapsedHours, maxHours) : elapsedHours;
    if (hours <= 0) return;

    const decay = CONFIG.offlineDecayPerHour || CONFIG.statDecayPerTick || {};
    const caps = CONFIG.offlineDecayDailyCap || {};
    const dayFactor = Math.max(1, hours / 24);
    for (const k of Object.keys(decay)) {
        let delta = Number(decay[k]) * hours;
        const dailyCap = Number(caps[k]);
        if (Number.isFinite(dailyCap)) {
            const cap = dailyCap * dayFactor;
            if (delta < 0) delta = Math.max(delta, cap);
            else if (delta > 0) delta = Math.min(delta, cap);
        }
        pet.stats[k] = clamp((pet.stats[k] || 0) + delta, CONFIG.statMin, CONFIG.statMax);
    }

    if (hadNannyCareDuringOffline(pet, elapsedMs, now)) softenStatsToAverage(pet);
    clampEnergyToMax(pet);
    maybeApplyPermanentTrauma(pet, now);
}

function hadNannyCareDuringOffline(pet, elapsedMs, now) {
    const care = pet?.hatchingCare;
    if (care?.mode !== 'nanny') return false;
    const last = now - Math.max(0, Number(elapsedMs) || 0);
    const hiredAt = Number(care.hiredAt) || last;
    const until = Number(care.until);
    if (!Number.isFinite(until)) return hasNannyCare(pet, now);
    return Math.max(last, hiredAt) < Math.min(now, until);
}

export function computeStage(pet) {
    // 蛋阶段为休眠状态：只要 hunger 仍为 0，就永远停在 egg。
    // 一旦被喂了任何东西（hunger > 0）就会由 hatchPetFromEgg 把阶段推进到 baby。
    if (pet?.stage === 'egg' && (pet?.stats?.hunger ?? 0) <= 0) {
        return CONFIG.stages[0];
    }
    const now = Date.now();
    let ageMs = now - (pet.bornAt || now);
    const care = pet?.hatchingCare;
    if (care?.mode === 'nanny') {
        const bornAt = pet.bornAt || now;
        const hiredAt = Math.max(Number(care.hiredAt) || bornAt, bornAt);
        const until = Number.isFinite(Number(care.until)) ? Number(care.until) : now;
        const careEnd = Math.max(hiredAt, Math.min(now, until));
        const beforeNannyMs = Math.max(0, hiredAt - bornAt);
        const nannyMs = Math.max(0, careEnd - hiredAt) * Math.max(0.1, Number(care.growthRate) || nannyGrowthRate(pet, now));
        const afterNannyMs = Math.max(0, now - Math.max(careEnd, hiredAt));
        ageMs = beforeNannyMs + nannyMs + afterNannyMs;
    }
    const ageHours = ageMs / 3600 / 1000;
    const babyStage = CONFIG.stages.find(st => st.id === 'baby') || CONFIG.stages[1] || CONFIG.stages[0];
    let chosen = babyStage;
    for (const st of CONFIG.stages) {
        if (st.id !== 'egg' && ageHours >= st.minHours) chosen = st;
    }
    return chosen;
}

// ---- 精灵图懒生成（仅在第一次需要离开 egg 阶段时触发） ----
const _sheetInflight = new Set(); // pet.id

function _kickSheetGen(pet) {
    if (!pet || !pet.id) return;
    if (!isActivePet(pet)) return;
    if (pet.imageSheetUrl) return;
    if (_sheetInflight.has(pet.id)) return;
    _sheetInflight.add(pet.id);
    (async () => {
        try {
            // 走 pet.js 的统一入口：DNA 级缓存 + in-flight 去重 + 持久化
            const { generatePetSheet } = await import('./pet.js');
            const url = await generatePetSheet(pet);
            if (url) {
                pet.imageSheetUrl = url;
                applyStage(pet);
                savePetDebounced(pet);
                try {
                    const { notify } = await import('./state.js');
                    notify();
                } catch (_) {}
            }
        } catch (e) {
            console.warn('精灵图生成失败，将在下一次 tick 时重试', e);
        } finally {
            _sheetInflight.delete(pet.id);
        }
    })();
}

export function applyStage(pet) {
    if (!isActivePet(pet)) return false;
    const st = computeStage(pet);
    const eggIsWaitingForVisibleHatch = pet?.stage === 'egg'
        && (pet.eggHatchPending || (pet.imageSheetUrl && (pet.eggHatchRequestedAt || (pet.stats?.hunger ?? 0) > 0)));
    if (eggIsWaitingForVisibleHatch) {
        pet.eggHatchPending = true;
        if (!pet.imageSheetUrl) _kickSheetGen(pet);
        return false;
    }
    // 规则：除 egg 外的任何阶段，必须先有 imageSheetUrl 才能"破壳"。
    // 否则保持 egg 形态，并在后台触发一次精灵图生成。
    if (st.id !== 'egg' && !pet.imageSheetUrl) {
        const eggDef = CONFIG.stages[0];
        const changed = pet.stage !== eggDef.id;
        pet.stage = eggDef.id;
        _kickSheetGen(pet);
        return changed;
    }
    const changed = pet.stage !== st.id;
    pet.stage = st.id;
    // Lifetime achievement: count first-time adult promotions per pet.
    if (isAdultStage(st.id) && !pet.everAdult) {
        pet.everAdult = true;
        try {
            const stats = state.lifetimeStats || (state.lifetimeStats = { feeds: 0, poopsCleaned: 0, adultsRaised: 0 });
            stats.adultsRaised = (Number(stats.adultsRaised) || 0) + 1;
        } catch (_) {}
    }
    return changed;
}

/** 离线追溯：根据 lastTickAt 一次性补算。 */
export function tickOffline(pet) {
    if (!pet) return;
    if (!isActivePet(pet)) return;
    const now = Date.now();
    normalizeReleasedPetAutoCare(pet, now) || normalizePetSleepState(pet, now);
    const last = pet.lastTickAt || pet.bornAt || now;
    const elapsed = Math.max(0, now - last);
    if (elapsed > 0) applyOfflineDecay(pet, elapsed, now);
    if (getPetLocationType(pet) !== 'released') maybeApplyPermanentTrauma(pet, now);
    pet.lastTickAt = now;
    applyStage(pet);
    if (getPetLocationType(pet) !== 'released') savePetDebounced(pet);
}

/** 周期 tick：仅当前激活宠物衰减 1 单位。
 *  注意：
 *    - 不再调用 notify()，避免每个 tick 触发整页 re-render 导致界面闪烁。
 *      关心实时数值的视图可监听 window 'mh:tick' 事件做局部更新。
 *    - 自动持久化最多每 AUTO_SAVE_MIN_INTERVAL_MS (默认 60s) 一次，
 *      避免频繁写入 PersonalPageStore。用户主动操作仍走 savePetDebounced 立即保存。
 */
const AUTO_SAVE_MIN_INTERVAL_MS = 60 * 1000;
let _timer = null;
let _lastAutoSaveAt = 0;
export function startTickLoop() {
    if (_timer) return;
    _timer = setInterval(() => {
        const now = Date.now();
        const shouldAutoSave = (now - _lastAutoSaveAt) >= AUTO_SAVE_MIN_INTERVAL_MS;
        let sleepStateChanged = false;
        const p = state.currentPetId ? state.pets[state.currentPetId] : null;
        if (p) {
            const isReleased = getPetLocationType(p) === 'released';
            const autoCareChanged = normalizeReleasedPetAutoCare(p, now);
            const sleepChanged = autoCareChanged || normalizePetSleepState(p, now);
            sleepStateChanged = sleepStateChanged || sleepChanged;
            applyDecay(p, 1);
            applyStage(p);
            if (!isReleased) {
                maybeProducePoop(p);
                maybeApplyPermanentTrauma(p, now);
            }
            p.lastTickAt = now;
            if (!isReleased && (shouldAutoSave || sleepChanged)) savePetDebounced(p);
        }
        if (shouldAutoSave) _lastAutoSaveAt = now;
        if (sleepStateChanged) notify();
        // 轻量事件：不触发整页重渲染，仅供有需要的视图做局部刷新
        try { window.dispatchEvent(new CustomEvent('mh:tick', { detail: { at: now } })); } catch (_) {}
    }, CONFIG.tickInterval);
}
export function stopTickLoop() { if (_timer) { clearInterval(_timer); _timer = null; } }

/** 保留每个 field 最新的 poop，避免长期离线或多次 tick 后堆满画面。 */
export function normalizePetPoops(pet) {
    if (!pet) return 0;
    if (!Array.isArray(pet.poops)) {
        pet.poops = [];
        return 0;
    }
    const maxPerField = Math.max(0, Number(CONFIG.maxPoopsPerField) || 0);
    if (maxPerField <= 0) {
        const removed = pet.poops.length;
        pet.poops = [];
        return removed;
    }

    const entries = pet.poops.map((poop, index) => ({ poop, index }));
    const groups = new Map();
    for (const entry of entries) {
        const field = entry.poop?.field || 'land';
        if (!groups.has(field)) groups.set(field, []);
        groups.get(field).push(entry);
    }

    const keepIndexes = new Set();
    for (const group of groups.values()) {
        group
            .sort((a, b) => ((Number(a.poop?.at) || 0) - (Number(b.poop?.at) || 0)) || (a.index - b.index))
            .slice(-maxPerField)
            .forEach(entry => keepIndexes.add(entry.index));
    }

    const before = pet.poops.length;
    pet.poops = entries.filter(entry => keepIndexes.has(entry.index)).map(entry => entry.poop);
    return before - pet.poops.length;
}

/** 概率性产出一坨 poop，用于 Field 视图收集 → 兑换 biofuel。 */
function maybeProducePoop(pet) {
    if (!pet) return;
    normalizePetPoops(pet);
    const now = Date.now();
    const last = pet.lastPoopAt || 0;
    if (now - last < CONFIG.poopIntervalSec * 1000) return;
    if (Math.random() > CONFIG.poopChance) return;
    // 在当前所属 field 区域内随机一个落点
    const field = state.currentField || 'land';
    const currentFieldPoops = pet.poops.filter(p => (p?.field || 'land') === field).length;
    if (currentFieldPoops >= CONFIG.maxPoopsPerField) return;
    pet.poops.push({
        id: 'p' + now.toString(36) + Math.floor(Math.random() * 1000).toString(36),
        field,
        x: Math.random() * 0.8 + 0.1,
        y: Math.random() * 0.55 + 0.35,
        at: now,
    });
    normalizePetPoops(pet);
    pet.lastPoopAt = now;
    // poop 多了会变脏
    if (pet.poops.length > CONFIG.poopWarningThreshold) {
        pet.stats.clean = clamp((pet.stats.clean || 0) - 4, CONFIG.statMin, CONFIG.statMax);
    }
}
