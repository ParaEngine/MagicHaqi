// 由设置页在本机开发环境中按需加载。
import { SHOP_ITEMS, CONFIG, getStageName } from './config.js';
import { state, notify, getCurrentPet, subscribe } from './state.js';
import { addToInventory, savePet, savePetDebounced, saveUserProfileDebounced } from './storage.js';
import { resetPetSheetImage, setAnim } from './pet.js';
import { applyStage, defaultStats, defaultTraits, getPermanentTraumaCount, normalizePermanentTrauma } from './petTick.js';
import { clamp, escapeHtml, showToast } from './utils.js';

const DEV_CONSOLE_ID = 'mhDevConsole';
const HOST_ALLOWLIST = new Set(['127.0.0.1', 'localhost']);
const PET_SCALAR_EXCLUDE = new Set(['stats', 'traits', 'poops', 'parents']);
const HOUR_MS = 60 * 60 * 1000;
const STAT_LABELS = {
    hunger: '体力',
    mood: '心情',
    clean: '清洁',
    bond: '亲密',
};

export function openDevConsole({ expanded = true } = {}) {
    if (!isDevConsoleAllowed()) return false;
    const root = mountDevConsole();
    refreshConsole(root);
    return true;
}

export function isDevConsoleAllowed() {
    return typeof window !== 'undefined' && HOST_ALLOWLIST.has(window.location.hostname);
}

function mountDevConsole() {
    const existing = document.getElementById(DEV_CONSOLE_ID);
    if (existing) return existing;
    injectStyles();

    const root = document.createElement('div');
    root.id = DEV_CONSOLE_ID;
    root.className = 'mh-dev-console';
    root.innerHTML = renderConsoleHtml();
    document.body.appendChild(root);

    bindConsole(root);
    bindConsoleStateRefresh(root);
    refreshConsole(root);

    window.MagicHaqiDevConsole = {
        addCoins,
        addBiofuel,
        resetPlanetMining,
        addPoopsToCurrentField,
        setVip,
        fillCurrentPetStats,
        setAllOtherPetsStage: (stageId = 'adult') => setAllExiledPetsStage(null, stageId),
        setAllReleasedPetsStage: (stageId = 'adult') => setAllExiledPetsStage(null, stageId),
        setAllExiledPetsStage: (stageId = 'adult') => setAllExiledPetsStage(null, stageId),
        resetCurrentPetToEgg,
        forceCurrentPetSleep,
        saveCurrentPetAttributes: () => saveCurrentPetAttributes(root),
        addItem,
        refresh: () => refreshConsole(root),
    };
    return root;
}

function renderConsoleHtml() {
    const itemOptions = SHOP_ITEMS.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.emoji)} ${escapeHtml(item.name)}</option>`).join('');
    const stageOptions = CONFIG.stages.map(stage => `<option value="${escapeHtml(stage.id)}" ${stage.id === 'adult' ? 'selected' : ''}>${escapeHtml(stage.emoji)} ${escapeHtml(stage.name)}</option>`).join('');
    return `
        <div class="mh-dev-window">
            <div class="mh-dev-titlebar">
                <div class="mh-dev-title">
                    <strong>开发者面板</strong>
                    <span>仅本机生效</span>
                </div>
                <button class="mh-dev-close" type="button" data-dev-action="close" aria-label="关闭开发者面板">×</button>
            </div>
            <div class="mh-dev-vip-row">
                <div class="mh-dev-vip-copy">
                    <strong>👑 VIP 模式</strong>
                    <span>用于体验付费语音</span>
                </div>
                <button class="mh-dev-vip" type="button" data-dev-action="vip"></button>
            </div>
            <div class="mh-dev-row mh-dev-meters">
                <span>金币 <b data-dev-coins>0</b></span>
                <span>燃料 <b data-dev-biofuel>0</b></span>
            </div>
            <div class="mh-dev-grid">
                <button type="button" data-dev-action="coins" data-amount="100">+100 金币</button>
                <button type="button" data-dev-action="coins" data-amount="1000">+1000 金币</button>
                <button type="button" data-dev-action="biofuel" data-amount="10">+10 燃料</button>
                <button type="button" data-dev-action="stats">状态拉满</button>
                <button type="button" data-dev-action="poops" data-amount="5">+5 便便</button>
            </div>
            <div class="mh-dev-row mh-dev-mining-row">
                <label class="mh-dev-mining-field">
                    <span>挖矿小时</span>
                    <input type="number" min="0" max="24" step="1" value="24" data-dev-mining-hours>
                </label>
                <button type="button" data-dev-action="mining-reset">设置领取时间</button>
            </div>
            <div class="mh-dev-row">
                <select data-dev-item>${itemOptions}</select>
                <button type="button" data-dev-action="item">+1 物品</button>
            </div>
            <div class="mh-dev-row mh-dev-exiled-stage-row">
                <label class="mh-dev-bulk-stage-field">
                    <span>其他宠物</span>
                    <select data-dev-exiled-stage>${stageOptions}</select>
                </label>
                <button type="button" data-dev-action="exiled-stage">改阶段</button>
            </div>
            <div class="mh-dev-subtle" data-dev-exiled-count>其他宠物 0 只</div>
            <div class="mh-dev-section">
                <div class="mh-dev-section-head">
                    <strong>当前宠物属性</strong>
                    <span data-dev-pet-title>未选择</span>
                </div>
                <div class="mh-dev-row">
                    <button type="button" class="mh-dev-sleep-toggle" data-dev-action="pet-sleep-toggle" data-dev-pet-sleep-toggle>睡眠：未选择宠物</button>
                </div>
                <div class="mh-dev-row">
                    <button type="button" class="mh-dev-egg-reset" data-dev-action="pet-reset-egg">重置为蛋 · 饥饿 0</button>
                </div>
                <div class="mh-dev-pet-editor" data-dev-pet-editor></div>
                <div class="mh-dev-row">
                    <button type="button" data-dev-action="pet-save">保存属性</button>
                    <button type="button" data-dev-action="pet-refresh">刷新</button>
                </div>
            </div>
        </div>
    `;
}

function bindConsole(root) {
    root.addEventListener('click', async (event) => {
        const actionEl = event.target.closest('[data-dev-action]');
        if (!actionEl) return;
        event.preventDefault();
        event.stopPropagation();

        const action = actionEl.dataset.devAction;
        if (action === 'close') {
            closeDevConsole(root);
            return;
        }
        if (action === 'vip') setVip(!state.isPaid);
        if (action === 'coins') addCoins(Number(actionEl.dataset.amount) || 0);
        if (action === 'biofuel') addBiofuel(Number(actionEl.dataset.amount) || 0);
        if (action === 'poops') addPoopsToCurrentField(Number(actionEl.dataset.amount) || 0);
        if (action === 'mining-reset') resetPlanetMining(root.querySelector('[data-dev-mining-hours]')?.value);
        if (action === 'stats') fillCurrentPetStats();
        if (action === 'item') await addSelectedItem(root);
        if (action === 'exiled-stage') await setAllExiledPetsStage(root);
        if (action === 'pet-sleep-toggle') forceCurrentPetSleep(!isPetSleeping(getCurrentPet()));
        if (action === 'pet-reset-egg') await resetCurrentPetToEgg();
        if (action === 'pet-save') saveCurrentPetAttributes(root);
        refreshConsole(root);
    });
}

function bindConsoleStateRefresh(root) {
    if (root.__mhDevStateBound) return;
    root.__mhDevStateBound = true;
    root.__mhDevUnsubscribe = subscribe(() => refreshConsole(root, { preserveEditorFocus: true }));
    root.__mhDevAnimHandler = () => refreshConsole(root, { preserveEditorFocus: true });
    window.addEventListener('magichaqi:pet-anim-change', root.__mhDevAnimHandler);
}

function closeDevConsole(root) {
    if (!root) return;
    if (root.__mhDevUnsubscribe) {
        root.__mhDevUnsubscribe();
        root.__mhDevUnsubscribe = null;
    }
    if (root.__mhDevAnimHandler) {
        window.removeEventListener('magichaqi:pet-anim-change', root.__mhDevAnimHandler);
        root.__mhDevAnimHandler = null;
    }
    root.remove();
}

function getExiledPets() {
    const currentId = state.currentPetId;
    return (state.petOrder || [])
        .filter(id => id && id !== currentId)
        .map(id => state.pets?.[id])
        .filter(Boolean);
}

function getStageById(stageId) {
    return CONFIG.stages.find(stage => stage.id === stageId) || CONFIG.stages.find(stage => stage.id === 'adult') || CONFIG.stages[0];
}

function setPetStageForDev(pet, stage) {
    if (!pet || !stage) return;
    const now = Date.now();
    const stageIndex = CONFIG.stages.findIndex(item => item.id === stage.id);
    const nextStage = CONFIG.stages[stageIndex + 1];
    const minHours = Math.max(0, Number(stage.minHours) || 0);
    const nextHours = nextStage ? Math.max(minHours, Number(nextStage.minHours) || minHours) : minHours + 24;
    const ageHours = stage.id === 'egg'
        ? 0
        : minHours + Math.max(0.01, (nextHours - minHours) / 2);

    pet.stage = stage.id;
    pet.bornAt = now - Math.round(ageHours * HOUR_MS);
    pet.lastTickAt = now;
    pet.lastCareAt = now;
    pet.stats = pet.stats && typeof pet.stats === 'object' ? pet.stats : defaultStats();
    if (stage.id === 'egg') {
        pet.stats.hunger = 0;
    } else if ((Number(pet.stats.hunger) || 0) <= 0) {
        pet.stats.hunger = defaultStats().hunger;
    }
    if (CONFIG.breedableStages.includes(stage.id)) pet.everAdult = true;
    delete pet.eggHatchPending;
    delete pet.eggHatchRequestedAt;
}

async function setAllExiledPetsStage(root, stageId = null) {
    const selectedStageId = stageId || root?.querySelector('[data-dev-exiled-stage]')?.value || 'adult';
    const stage = getStageById(selectedStageId);
    if (!stage) return 0;
    const pets = getExiledPets();
    if (!pets.length) {
        showToast('开发者：没有其他宠物', 'info', 1400);
        return 0;
    }
    pets.forEach(pet => setPetStageForDev(pet, stage));
    await Promise.all(pets.map(pet => savePet(pet)));
    notify();
    showToast(`开发者：其他宠物 ${pets.length} 只已改为${stage.name}`, 'success', 1600);
    return pets.length;
}

function addCoins(amount) {
    const delta = normalizePositiveInt(amount);
    if (!delta) return;
    state.coins = Math.max(0, (Number(state.coins) || 0) + delta);
    saveUserProfileDebounced();
    notify();
    showToast(`开发者：金币 +${delta}`, 'success', 1200);
}

function addBiofuel(amount) {
    const delta = normalizePositiveInt(amount);
    if (!delta) return;
    state.biofuel = Math.max(0, (Number(state.biofuel) || 0) + delta);
    saveUserProfileDebounced();
    notify();
    showToast(`开发者：燃料 +${delta}`, 'success', 1200);
}

function addPoopsToCurrentField(amount = 5) {
    const pet = getCurrentPet();
    if (!pet) {
        showToast('请先选择宠物', 'error', 1400);
        return 0;
    }
    const count = normalizePositiveInt(amount) || 5;
    const field = state.currentField || 'land';
    const maxPerField = Math.max(0, Number(CONFIG.maxPoopsPerField) || 0);
    pet.poops = Array.isArray(pet.poops) ? pet.poops : [];
    const currentCount = pet.poops.filter(poop => (poop?.field || 'land') === field).length;
    const canAdd = maxPerField > 0 ? Math.max(0, maxPerField - currentCount) : 0;
    const addCount = Math.min(count, canAdd);
    if (!addCount) {
        showToast('开发者：当前场景便便已满', 'info', 1400);
        return 0;
    }
    const now = Date.now();
    for (let i = 0; i < addCount; i++) {
        pet.poops.push({
            id: `devp${now.toString(36)}${i.toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
            field,
            x: Math.random() * 0.8 + 0.1,
            y: Math.random() * 0.55 + 0.35,
            at: now + i,
        });
    }
    pet.lastPoopAt = now;
    savePetDebounced(pet);
    notify();
    showToast(`开发者：${field} 场景便便 +${addCount}`, 'success', 1200);
    return addCount;
}

function currentHourStart(now = Date.now()) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

function resetPlanetMining(hours = 24) {
    const raw = Number(hours);
    const hourCount = clamp(Number.isFinite(raw) ? Math.floor(raw) : 24, 0, 24);
    const now = Date.now();
    state.planetMining = state.planetMining && typeof state.planetMining === 'object' ? state.planetMining : {};
    state.planetMining.lastCollectedHourAt = currentHourStart(now) - hourCount * HOUR_MS;
    state.planetMining.lastCollectedAt = now;
    saveUserProfileDebounced();
    notify();
    showToast(`开发者：挖矿领取时间已重置为 ${hourCount} 小时前`, 'success', 1600);
}

function setVip(enabled) {
    state.isPaid = !!enabled;
    saveUserProfileDebounced();
    notify();
    showToast(state.isPaid ? '开发者：VIP 已开启' : '开发者：VIP 已关闭', 'success', 1200);
}

function fillCurrentPetStats() {
    const pet = getCurrentPet();
    if (!pet) {
        showToast('请先选择宠物', 'error', 1400);
        return;
    }
    const baseStats = defaultStats();
    pet.stats = pet.stats || baseStats;
    Object.keys(baseStats).forEach(key => {
        pet.stats[key] = clamp(CONFIG.statMax, CONFIG.statMin, CONFIG.statMax);
    });
    pet.lastTickAt = Date.now();
    applyStage(pet);
    savePetDebounced(pet);
    notify();
    showToast('开发者：宠物状态已拉满', 'success', 1200);
}

async function resetCurrentPetToEgg() {
    const pet = getCurrentPet();
    if (!pet) {
        showToast('请先选择宠物', 'error', 1400);
        return false;
    }
    const now = Date.now();
    pet.stage = 'egg';
    resetPetSheetImage(pet);
    pet.anim = 'idle';
    pet.stats = pet.stats && typeof pet.stats === 'object' ? pet.stats : {};
    pet.stats.hunger = 0;
    pet.lastTickAt = now;
    pet.lastCareAt = now;
    delete pet.eggHatchedAt;
    delete pet.eggHatchPending;
    delete pet.eggHatchRequestedAt;
    delete pet.sleepStartedAt;
    delete pet.sleepLockedUntil;
    await savePet(pet);
    notify();
    showToast('开发者：当前宠物已重置为蛋，喂食后会重新孵化', 'success', 1800);
    return true;
}

function forceCurrentPetSleep(sleeping = true) {
    const pet = getCurrentPet();
    if (!pet) {
        showToast('请先选择宠物', 'error', 1400);
        return false;
    }
    setAnim(sleeping ? 'sleep' : 'idle', 0);
    notify();
    showToast(sleeping ? '开发者：宠物已强制睡觉' : '开发者：宠物已强制唤醒', 'success', 1200);
    return true;
}

async function addSelectedItem(root) {
    const pet = getCurrentPet();
    if (!pet) {
        showToast('请先选择宠物', 'error', 1400);
        return;
    }
    const itemId = root.querySelector('[data-dev-item]')?.value;
    const item = SHOP_ITEMS.find(candidate => candidate.id === itemId);
    if (!item) return;
    await addItem(item.id, 1);
    showToast(`开发者：${item.name} +1`, 'success', 1200);
}

async function addItem(itemId, qty = 1) {
    const pet = getCurrentPet();
    if (!pet) return false;
    const delta = normalizePositiveInt(qty) || 1;
    await addToInventory(pet.id, itemId, delta);
    notify();
    return true;
}

function saveCurrentPetAttributes(root, { toast = true } = {}) {
    const pet = getCurrentPet();
    if (!pet) {
        showToast('请先选择宠物', 'error', 1400);
        return false;
    }
    const oldId = pet.id;
    const rawEditor = root.querySelector('[data-dev-pet-json]');
    let edited = pet;
    if (rawEditor) {
        try {
            edited = JSON.parse(rawEditor.value || '{}');
        } catch (e) {
            showToast('宠物 JSON 格式不正确', 'error', 1800);
            return false;
        }
    }
    if (!edited || typeof edited !== 'object' || Array.isArray(edited)) {
        showToast('宠物属性必须是对象', 'error', 1800);
        return false;
    }

    Object.keys(pet).forEach(key => {
        if (!(key in edited)) delete pet[key];
    });
    Object.assign(pet, edited);
    pet.id = oldId;
    applyPetFormValues(root, pet);
    pet.lastTickAt = Date.now();
    applyStage(pet);
    savePetDebounced(pet);
    notify();
    if (toast) showToast('开发者：宠物属性已保存', 'success', 1200);
    return true;
}

function applyPetFormValues(root, pet) {
    const baseStats = defaultStats();
    pet.stats = pet.stats && typeof pet.stats === 'object' ? pet.stats : {};
    Object.keys(baseStats).forEach(key => {
        const input = root.querySelector(`[data-dev-pet-stat="${key}"]`);
        if (!input) return;
        pet.stats[key] = clampNumber(input.value, CONFIG.statMin, CONFIG.statMax, baseStats[key]);
    });

    pet.traits = pet.traits && typeof pet.traits === 'object' ? pet.traits : {};
    root.querySelectorAll('[data-dev-pet-trait]').forEach(input => {
        const key = input.dataset.devPetTrait;
        if (!key) return;
        if (input.type === 'number') {
            pet.traits[key] = clampNumber(input.value, 0, CONFIG.traitMax, 0);
        } else {
            pet.traits[key] = input.value;
        }
    });

    root.querySelectorAll('[data-dev-pet-scalar]').forEach(input => {
        const key = input.dataset.devPetScalar;
        if (!key || key === 'id') return;
        pet[key] = parseScalarInput(input);
    });

    const traumaInput = root.querySelector('[data-dev-pet-trauma-count]');
    if (traumaInput) setPermanentTraumaCount(pet, traumaInput.value);
}

function setPermanentTraumaCount(pet, value) {
    const max = Math.max(0, Number(CONFIG.trauma?.max) || 6);
    const count = clampNumber(value, 0, max, 0) | 0;
    const traumas = normalizePermanentTrauma(pet).slice(0, count);
    const now = Date.now();
    while (traumas.length < count) {
        traumas.push({
            id: `dev_trauma_${now.toString(36)}_${traumas.length + 1}`,
            type: 'dev',
            at: now,
            reasons: ['开发者面板设置'],
        });
    }
    pet.permanentTrauma = traumas;
    pet.lastPermanentTraumaAt = now;
}

function renderPetEditorHtml(pet) {
    if (!pet) return '<div class="mh-dev-empty">请先选择宠物</div>';
    const stats = { ...defaultStats(), ...(pet.stats || {}) };
    const statRows = Object.keys(stats).map(key => renderNumberField({
        label: STAT_LABELS[key] || key,
        value: stats[key],
        min: CONFIG.statMin,
        max: CONFIG.statMax,
        step: 1,
        dataAttr: `data-dev-pet-stat="${escapeHtml(key)}"`,
    })).join('');

    const traitKeys = getEditableTraitKeys(pet);
    const traitRows = traitKeys.map(key => renderTraitField(key, pet.traits?.[key])).join('');
    const traumaRow = renderNumberField({
        label: '永久精神伤害',
        value: getPermanentTraumaCount(pet),
        min: 0,
        max: CONFIG.trauma?.max || 6,
        step: 1,
        dataAttr: 'data-dev-pet-trauma-count',
    });
    const scalarRows = getEditableScalarKeys(pet).map(key => renderScalarField(key, pet[key])).join('');
    const rawJson = escapeHtml(JSON.stringify(pet, null, 2));
    return `
        <div class="mh-dev-editor-group">
            <div class="mh-dev-editor-caption-row">
                <div class="mh-dev-editor-caption">基础属性</div>
            </div>
            <div class="mh-dev-field-grid">${statRows}</div>
        </div>
        <div class="mh-dev-editor-group">
            <div class="mh-dev-editor-caption">外观 / 血统</div>
            <div class="mh-dev-field-grid">${traitRows || '<div class="mh-dev-empty">暂无 trait</div>'}</div>
        </div>
        <div class="mh-dev-editor-group">
            <div class="mh-dev-editor-caption">常用字段</div>
            <div class="mh-dev-field-grid">${traumaRow}${scalarRows || ''}</div>
        </div>
        <details class="mh-dev-json-wrap">
            <summary>完整 JSON</summary>
            <textarea data-dev-pet-json spellcheck="false">${rawJson}</textarea>
        </details>
    `;
}

function getEditableTraitKeys(pet) {
    const keys = new Set(Object.keys(defaultTraits()));
    CONFIG.traitDefs.forEach(def => keys.add(def.id));
    Object.keys(pet.traits || {}).forEach(key => keys.add(key));
    return [...keys].sort((a, b) => getTraitLabel(a).localeCompare(getTraitLabel(b), 'zh-Hans-CN'));
}

function getEditableScalarKeys(pet) {
    return Object.keys(pet)
        .filter(key => !PET_SCALAR_EXCLUDE.has(key))
        .filter(key => isEditableScalar(pet[key]));
}

function renderTraitField(key, value) {
    const isNumber = typeof value === 'number' || Object.prototype.hasOwnProperty.call(defaultTraits(), key) || CONFIG.traitDefs.some(def => def.id === key);
    if (isNumber) {
        return renderNumberField({
            label: getTraitLabel(key),
            value: Number(value) || 0,
            min: 0,
            max: CONFIG.traitMax,
            step: 1,
            dataAttr: `data-dev-pet-trait="${escapeHtml(key)}"`,
        });
    }
    return renderTextField({
        label: getTraitLabel(key),
        value,
        dataAttr: `data-dev-pet-trait="${escapeHtml(key)}"`,
    });
}

function renderScalarField(key, value) {
    if (typeof value === 'number') {
        return renderNumberField({
            label: key,
            value,
            step: Number.isInteger(value) ? 1 : 0.1,
            dataAttr: `data-dev-pet-scalar="${escapeHtml(key)}" data-dev-value-type="number"`,
            readonly: key === 'id',
        });
    }
    if (typeof value === 'boolean') {
        return `
            <label class="mh-dev-field">
                <span title="${escapeHtml(key)}">${escapeHtml(key)}</span>
                <select data-dev-pet-scalar="${escapeHtml(key)}" data-dev-value-type="boolean">
                    <option value="true" ${value ? 'selected' : ''}>true</option>
                    <option value="false" ${value ? '' : 'selected'}>false</option>
                </select>
            </label>
        `;
    }
    return renderTextField({
        label: key,
        value,
        dataAttr: `data-dev-pet-scalar="${escapeHtml(key)}" data-dev-value-type="string"${key === 'id' ? ' readonly' : ''}`,
    });
}

function renderNumberField({ label, value, min = '', max = '', step = 1, dataAttr = '', readonly = false }) {
    return `
        <label class="mh-dev-field">
            <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <input type="number" value="${escapeHtml(normalizeNumberForInput(value))}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" ${dataAttr} ${readonly ? 'readonly' : ''}>
        </label>
    `;
}

function renderTextField({ label, value, dataAttr = '' }) {
    return `
        <label class="mh-dev-field">
            <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <input type="text" value="${escapeHtml(value == null ? '' : value)}" ${dataAttr}>
        </label>
    `;
}

function getTraitLabel(key) {
    const def = CONFIG.traitDefs.find(item => item.id === key);
    return def ? `${def.emoji} ${def.name}` : key;
}

function isEditableScalar(value) {
    return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function parseScalarInput(input) {
    const type = input.dataset.devValueType;
    if (type === 'number') return Number(input.value) || 0;
    if (type === 'boolean') return input.value === 'true';
    return input.value;
}

function clampNumber(value, min, max, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return clamp(number, min, max);
}

function normalizeNumberForInput(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : '0';
}

function refreshConsole(root, { preserveEditorFocus = false } = {}) {
    root.querySelector('[data-dev-coins]').textContent = String(Number(state.coins) || 0);
    root.querySelector('[data-dev-biofuel]').textContent = String(Number(state.biofuel) || 0);
    const vipButton = root.querySelector('[data-dev-action="vip"]');
    if (vipButton) {
        vipButton.textContent = state.isPaid ? '已开启' : '开启';
        vipButton.classList.toggle('enabled', !!state.isPaid);
    }
    const exiledCount = getExiledPets().length;
    const exiledCountEl = root.querySelector('[data-dev-exiled-count]');
    if (exiledCountEl) exiledCountEl.textContent = `其他宠物 ${exiledCount} 只`;
    const exiledStageButton = root.querySelector('[data-dev-action="exiled-stage"]');
    if (exiledStageButton) exiledStageButton.disabled = exiledCount === 0;
    const pet = getCurrentPet();
    const petTitle = root.querySelector('[data-dev-pet-title]');
    if (petTitle) {
        const titleText = pet ? `${pet.name || pet.id || '未命名'} · ${getStageName(pet.stage, pet.stage || '')}` : '未选择';
        petTitle.textContent = titleText;
        petTitle.title = titleText;
    }
    const sleepToggle = root.querySelector('[data-dev-pet-sleep-toggle]');
    const sleeping = isPetSleeping(pet);
    if (sleepToggle) {
        sleepToggle.textContent = pet
            ? `睡眠：${sleeping ? '开' : '关'} · ${sleeping ? '点击唤醒' : '点击睡觉'}`
            : '睡眠：未选择宠物';
        sleepToggle.disabled = !pet;
        sleepToggle.classList.toggle('enabled', sleeping);
    }
    const petEditor = root.querySelector('[data-dev-pet-editor]');
    const editorFocused = petEditor && petEditor.contains(document.activeElement);
    if (petEditor && !(preserveEditorFocus && editorFocused)) petEditor.innerHTML = renderPetEditorHtml(pet);
}

function isPetSleeping(pet) {
    return pet?.anim === 'sleep';
}

function normalizePositiveInt(value) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function injectStyles() {
    if (document.getElementById('mhDevConsoleStyle')) return;
    const style = document.createElement('style');
    style.id = 'mhDevConsoleStyle';
    style.textContent = `
        .mh-dev-console {
            position: fixed;
            left: max(16px, env(safe-area-inset-left));
            top: max(16px, env(safe-area-inset-top));
            bottom: max(16px, env(safe-area-inset-bottom));
            z-index: 19000;
            width: min(350px, calc(100vw - 32px));
            color: #422006;
            font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
            display: flex;
            flex-direction: column;
            user-select: none;
            -webkit-user-select: none;
        }
        .mh-dev-window {
            box-sizing: border-box;
            border: 1.5px solid #fbbf24;
            border-radius: 16px;
            background: rgba(255, 251, 235, 0.96);
            box-shadow: 0 8px 22px rgba(146, 64, 14, 0.16);
            backdrop-filter: blur(8px);
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-height: 0;
            max-height: 100%;
            padding: 10px;
            overflow: hidden;
        }
        .mh-dev-titlebar,
        .mh-dev-vip-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        .mh-dev-titlebar {
            min-height: 34px;
            padding: 0 2px 8px;
            border-bottom: 1px solid rgba(251, 191, 36, 0.55);
        }
        .mh-dev-title {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .mh-dev-title strong,
        .mh-dev-vip-copy strong {
            font-size: 13px;
            line-height: 1.2;
            font-weight: 900;
        }
        .mh-dev-title span,
        .mh-dev-vip-copy span {
            color: #78350f;
            font-size: 11px;
            line-height: 1.25;
            font-weight: 700;
            overflow-wrap: anywhere;
        }
        .mh-dev-vip-copy {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .mh-dev-close {
            flex: 0 0 auto;
            width: 30px;
            height: 30px;
            border: 1.5px solid #fcd34d;
            border-radius: 50%;
            background: #fff7d6;
            color: #78350f;
            font-size: 22px;
            font-weight: 900;
            line-height: 1;
            cursor: pointer;
        }
        .mh-dev-close:hover {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #b91c1c;
        }
        .mh-dev-vip,
        .mh-dev-window button:not(.mh-dev-close),
        .mh-dev-window select,
        .mh-dev-window input,
        .mh-dev-window textarea {
            border: 1.5px solid #fcd34d;
            background: #fffbeb;
            color: #78350f;
            font: inherit;
            font-size: 12px;
            font-weight: 800;
        }
        .mh-dev-vip,
        .mh-dev-window button:not(.mh-dev-close),
        .mh-dev-window select {
            border-radius: 999px;
            background: #fde68a;
            cursor: pointer;
        }
        .mh-dev-vip {
            flex: 0 0 auto;
            min-width: 72px;
            height: 36px;
            padding: 0 14px;
        }
        .mh-dev-vip.enabled {
            background: #f59e0b;
            border-color: #f59e0b;
            color: #fff;
        }
        .mh-dev-window button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }
        .mh-dev-sleep-toggle {
            width: 100%;
        }
        .mh-dev-egg-reset {
            width: 100%;
            background: #fed7aa !important;
            border-color: #fb923c !important;
            color: #7c2d12 !important;
        }
        [data-dev-pet-sleep-toggle].enabled {
            background: #bfdbfe !important;
            border-color: #93c5fd !important;
            color: #1e3a8a !important;
        }
        .mh-dev-row {
            display: flex;
            gap: 7px;
            align-items: center;
        }
        .mh-dev-meters {
            justify-content: space-between;
            color: #78350f;
            font-size: 12px;
            font-weight: 800;
        }
        .mh-dev-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 7px;
        }
        .mh-dev-mining-row {
            align-items: stretch;
        }
        .mh-dev-mining-field,
        .mh-dev-bulk-stage-field {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 7px;
            color: #78350f;
            font-size: 11px;
            font-weight: 900;
        }
        .mh-dev-mining-field span,
        .mh-dev-bulk-stage-field span {
            flex: 0 0 auto;
            white-space: nowrap;
        }
        .mh-dev-mining-field input {
            flex: 1 1 auto;
            min-width: 54px;
            height: 32px;
            box-sizing: border-box;
            border-radius: 10px;
            padding: 0 8px;
            background: #fffdf4;
        }
        .mh-dev-bulk-stage-field select {
            flex: 1 1 auto;
            min-width: 74px;
        }
        .mh-dev-subtle {
            margin-top: -5px;
            color: #92400e;
            font-size: 11px;
            font-weight: 800;
        }
        .mh-dev-window button:not(.mh-dev-close) {
            min-height: 32px;
            padding: 0 10px;
        }
        .mh-dev-window select {
            flex: 1 1 auto;
            min-width: 0;
            height: 32px;
            padding: 0 10px;
            border-radius: 10px;
            background: #fffbeb;
        }
        .mh-dev-section {
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            gap: 8px;
            min-height: 0;
            padding-top: 8px;
            border-top: 1px solid rgba(251, 191, 36, 0.55);
        }
        .mh-dev-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            color: #78350f;
            font-size: 12px;
            font-weight: 900;
        }
        .mh-dev-section-head span {
            min-width: 0;
            color: #92400e;
            font-size: 11px;
            text-align: right;
            overflow-wrap: anywhere;
        }
        .mh-dev-pet-editor {
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            gap: 8px;
            min-height: 0;
            overflow: auto;
            overscroll-behavior: contain;
            padding-right: 2px;
            user-select: text;
            -webkit-user-select: text;
        }
        .mh-dev-editor-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .mh-dev-editor-caption,
        .mh-dev-empty,
        .mh-dev-json-wrap summary {
            color: #92400e;
            font-size: 11px;
            font-weight: 900;
        }
        .mh-dev-editor-caption-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .mh-dev-mini-btn {
            flex: 0 0 auto;
            min-height: 26px !important;
            padding: 0 9px !important;
            font-size: 11px !important;
        }
        .mh-dev-field-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
        }
        .mh-dev-field {
            display: flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
            color: #78350f;
            font-size: 11px;
            font-weight: 900;
        }
        .mh-dev-field span {
            flex: 0 0 48px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .mh-dev-field input,
        .mh-dev-field select {
            flex: 1 1 auto;
            min-width: 0;
            height: 28px;
            border-radius: 8px;
            padding: 0 7px;
            background: #fffdf4;
            cursor: text;
        }
        .mh-dev-field select {
            cursor: pointer;
        }
        .mh-dev-json-wrap {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .mh-dev-json-wrap textarea {
            width: 100%;
            min-height: 130px;
            box-sizing: border-box;
            border-radius: 10px;
            padding: 8px;
            resize: vertical;
            font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
            font-size: 11px;
            line-height: 1.35;
            font-weight: 700;
            background: #fffdf4;
            user-select: text;
            -webkit-user-select: text;
        }
    `;
    document.head.appendChild(style);
}