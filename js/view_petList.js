// 宠物列表视图（用于浏览所有宠物）
import { $, $$, coinIconSvg, confirm, escapeHtml, prompt, randId, showToast } from './utils.js';
import { t, getAlbumCaptions } from './i18n.js';
import { formatDna, displayPetName, dnaDietPreference, dietPreferenceLabel, decodeDna, ELEMENTAL_ATTRIBUTES } from './dna.js';
import { buildEggSvg, getPetSpriteCell, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { defaultPermanentTrauma, defaultStats, eggStats, applyStage } from './petTick.js';
import { markPetReleased, getCompanionDays, getPetBirthday, getPetFindTarget, getPetLocationInfo, getRuntimePetStats, isPetOnCurrentPlanet, isPetSelectable } from './petLifecycle.js';
import { savePet, setCurrentPetPersisted, saveUserProfileDebounced, ensurePetData, saveInventoryDebounced } from './storage.js';
import { addCoins, isPetDispatching, notify, setView, state } from './state.js';
import { getStageName } from './config.js';
import { showVipGateDialog } from './vipGate.js';
import { applyGrowthMaterial, calculateDerivedStats, canApplyGrowthMaterial, getGrowthCap, getGrowthMaterialId, getPetGrowthProfile, upgradePetData } from './pet_stats_core.js';
import { EQUIPMENT_SLOTS, MAX_EQUIPMENT_LEVEL, STARTER_EQUIPMENT_IDS, equipItem, getEquipmentDefinition, getEquipmentLevel, getEquipmentUpgradeCost, normalizeEquipment, unequipSlot } from './pet_equipment_core.js';
import { calculateExpeditionReadiness } from './expedition_buff.js';
import { getExperienceToNextLevel } from './expedition_settlement.js';
import { getHaqiExpeditionSettlement, isHaqiExpeditionEnabled } from './haqi_expedition_plugin.js';
import { calculateMineralPetSupport } from './mineral_pet_support_core.js';
import { EXPEDITION_MATERIAL_ART, rewardArtHtml } from './reward_art.js';

// 阶段顺序（与 4×4 精灵图行对齐）：baby=0, teen=1, adult=2, elder=3
const ALBUM_STAGES = [
    { id: 'baby',  nameKey: 'stageBaby', emoji: '🐣' },
    { id: 'teen',  nameKey: 'stageTeen', emoji: '🐥' },
    { id: 'adult', nameKey: 'stageAdult', emoji: '🐉' },
    { id: 'elder', nameKey: 'stageElder', emoji: '🦄' },
];
const ALBUM_ANIMS = ['idle', 'happy', 'sad', 'sleep'];
const PET_LIST_TABS = [
    { id: 'mine', labelKey: 'tabMyPets' },
    { id: 'rare', labelKey: 'tabRarePets' },
];

function equipmentIconHtml(definition, fallbackIcon = '◇') {
    const fallback = escapeHtml(definition?.icon || fallbackIcon);
    const image = String(definition?.image || '').trim();
    return image
        ? `<span class="mh-equipment-image"><img src="${escapeHtml(image)}" alt="" onerror="this.remove();this.parentElement.textContent='${fallback}'"></span>`
        : fallback;
}

function equipmentUpgradeFrameHtml(level) {
    const frameLevel = Math.max(0, Math.min(MAX_EQUIPMENT_LEVEL, Math.floor(Number(level) || 0)));
    return `<img class="mh-equipment-upgrade-frame" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/equipment/equipment_upgrade_${frameLevel}.webp" alt="" aria-hidden="true">`;
}

function getPetSupport(pet, equipmentEnhancements = {}) {
    return calculateMineralPetSupport(calculateDerivedStats(pet, {
        includeEquipment: isHaqiEquipmentEnabled(),
        equipmentEnhancements,
    }));
}

function petPowerChangeMessage(before, after) {
    const powerChange = after.combatPower - before.combatPower;
    const unlockedIds = new Set(before.assistIds);
    const newAssists = after.assists.filter(item => !unlockedIds.has(item.id));
    if (newAssists.length) return `战力 ${before.combatPower} → ${after.combatPower}，解锁${newAssists.map(item => item.name).join('、')}`;
    if (powerChange) return `战力 ${before.combatPower} → ${after.combatPower}`;
    if (after.nextUnlock) return `当前战力 ${after.combatPower}，距${after.nextUnlock.name}还差 ${after.nextUnlock.remainingPower}`;
    return `当前战力 ${after.combatPower}，矿区支援已全部解锁`;
}

let activePetListTab = 'mine';
let activeFamousPetFilter = 'all';
let famousPetsIndex = null;
let famousPetsIndexPromise = null;
let famousPetsFilterMetadataPromise = null;
let famousPetFilterTabsScrollLeft = 0;
const FAMOUS_PET_FILTERS = [
    { id: 'all', labelKey: 'albumAll', type: 'all' },
    { id: 'element:天空', labelKey: 'albumSky', type: 'element', value: '天空' },
    { id: 'element:陆地', labelKey: 'albumLand', type: 'element', value: '陆地' },
    { id: 'element:水系', labelKey: 'albumSea', type: 'element', value: '水系' },
    ...ELEMENTAL_ATTRIBUTES.map(value => ({ id: `attribute:${value}`, label: value, type: 'attribute', value })),
];
// 16 个 (stage, anim) 格子，每格多条候选小标题，按 seed 选其一。
const ALBUM_BG_PALETTE = [
    '#fff7ed', '#fef3c7', '#ecfccb', '#d1fae5', '#cffafe',
    '#dbeafe', '#ede9fe', '#fce7f3', '#fee2e2', '#fef9c3',
    '#e0f2fe', '#f0fdf4', '#fdf2f8', '#f5f3ff', '#ffe4e6', '#f0fdfa',
];
const ELEMENTAL_ATTRIBUTE_BACKGROUNDS = {
    '自然': '#d9f99d',
    '火': '#fed7aa',
    '冰': '#bae6fd',
    '生命': '#bbf7d0',
    '暗': '#ddd6fe',
    '雷': '#fef08a',
};
const DEFAULT_PET_ART_BACKGROUND = '#dff7ff';
const PET_RENAME_COST = 200;
const PET_NAME_SENSITIVE_TERMS = ['傻逼', 'shabi', '妈的', '操你', '草你', 'caoni', '垃圾', 'laji', '废物', '色情', '裸体', '性交', '强奸', '卖淫', '赌博', '毒品', '炸弹', '恐怖分子', '习近平', '共产党'];

function normalizePetNameForModeration(value) {
    return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function getPetNameSensitiveTerms() {
    const configuredTerms = window.MagicHaqiPetNamingPolicy?.sensitiveTerms;
    return Array.isArray(configuredTerms)
        ? [...PET_NAME_SENSITIVE_TERMS, ...configuredTerms]
        : PET_NAME_SENSITIVE_TERMS;
}

function validatePetName(value) {
    const name = String(value || '').trim();
    const normalized = normalizePetNameForModeration(name);
    if (!name) return '请输入名字';
    if ([...name].length > 6) return '名字最多 6 个字';
    if (!/^[\u4e00-\u9fffA-Za-z0-9]+$/.test(name)) return '名字仅支持中文、字母或数字';
    if (getPetNameSensitiveTerms().some(term => normalized.includes(normalizePetNameForModeration(term)))) return '名字含有不适宜的内容，请换一个';
    return '';
}

async function renamePet(pet, onRenamed, onFirstRenamed) {
    const renameCount = Math.max(0, Number(pet?.renameCount) || 0);
    const cost = renameCount > 0 ? PET_RENAME_COST : 0;
    if (cost && (Number(state.coins) || 0) < cost) {
        showToast(`金币不足，改名需要 ${cost} 金币`, 'error', 1800);
        return;
    }
    const name = await prompt('给伙伴改名', {
        hint: cost ? `本次改名将消耗 ${cost} 金币，最多 6 个字。` : '首次改名免费，之后每次消耗 200 金币；最多 6 个字。',
        defaultValue: String(pet?.name || ''),
        maxLength: 6,
        validate: validatePetName,
    });
    if (name == null || name === pet.name) return;
    const previousName = pet.name;
    const previousCount = pet.renameCount;
    const previousCoins = state.coins;
    try {
        pet.name = name;
        pet.renameCount = renameCount + 1;
        if (cost) addCoins(-cost);
        const saved = await savePet(pet);
        if (!saved) throw new Error('Pet rename was not persisted');
        if (cost) saveUserProfileDebounced();
        notify();
        showToast(cost ? `已改名为 ${name}，消耗 ${cost} 金币` : `已免费改名为 ${name}`, 'success', 1800);
        onFirstRenamed?.(pet);
        onRenamed?.();
    } catch (error) {
        pet.name = previousName;
        pet.renameCount = previousCount;
        if (cost) addCoins(previousCoins - state.coins);
        console.error('Failed to rename pet:', error);
        showToast('改名保存失败，请稍后重试', 'error', 1800);
    }
}

function petQualityData(pet) {
    const fallback = window.MHPetQuality?.getTier?.(pet?.rarity);
    const quality = pet?.quality || (fallback ? window.MHPetQuality.snapshot(fallback.id) : null);
    return {
        quality,
        stats: { ...(quality?.stats || {}), ...(pet?.battleStats || {}) },
    };
}

function petQualityClass(pet) {
    const qualityId = String(petQualityData(pet).quality?.id || 'N').toLowerCase();
    return `mh-quality-${/^(n|r|sr|ssr|ur)$/.test(qualityId) ? qualityId : 'n'}`;
}

function petQualityBadgeHtml(pet) {
    const { quality } = petQualityData(pet);
    if (!quality) return '';
    return `<span class="stage-badge mh-pet-quality-badge ${petQualityClass(pet)}">${escapeHtml(quality.id)} · ${escapeHtml(quality.name)}</span>`;
}

const GROWTH_STAT_LABELS = Object.freeze({
    maxHp: '生命上限',
    maxMp: '魔力上限',
    attack: '攻击',
    defense: '防御',
    magic: '魔法',
    luck: '幸运',
});

const GROWTH_MATERIAL_LABELS = Object.freeze({
    hpShard: '生命碎块',
    manaDust: '魔力尘',
    attackCore: '攻击晶核',
    guardPlate: '守护甲片',
    stellarEssence: '星核精粹',
});

const EQUIPMENT_SLOT_LABELS = Object.freeze({ charm: '徽记', core: '晶核', guard: '护甲' });

function isHaqiEquipmentEnabled() {
    const settlement = state.settings?.starSettlement;
    const planetId = settlement?.source === 'official' ? settlement.planetId : 'default';
    return isHaqiExpeditionEnabled(planetId);
}

function getOwnedEquipment() {
    const progress = getHaqiExpeditionSettlement(state.settings);
    const owned = Array.isArray(progress.equipment) ? progress.equipment : [];
    return [...new Set(owned.filter(id => !!getEquipmentDefinition(id)))];
}

function ensureStarterEquipment() {
    if (!isHaqiEquipmentEnabled()) return [];
    const progress = getHaqiExpeditionSettlement(state.settings);
    if (!Array.isArray(progress.equipment)) progress.equipment = [...STARTER_EQUIPMENT_IDS];
    return getOwnedEquipment();
}

function statPercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function petLineageSectionHtml(pet) {
    const lineage = Array.isArray(pet?.breeding?.lineage) ? pet.breeding.lineage.filter(Boolean) : [];
    const hasParentIds = Array.isArray(pet?.parents) && pet.parents.length > 0;
    if (!lineage.length && !hasParentIds) return '';
    const isMutation = pet?.mutation?.triggered === true;
    const parentRoles = ['父代', '母代'];
    const parentCards = lineage.slice(0, 2).map((parent, index) => {
        const qualityId = String(parent.qualityId || 'N').toUpperCase();
        const qualityClass = `mh-quality-${/^(N|R|SR|SSR|UR)$/.test(qualityId) ? qualityId.toLowerCase() : 'n'}`;
        const specialtyValue = Math.max(0, Math.min(100, Number(parent.specialtyValue) || 0));
        return `<article class="mh-lineage-parent-card ${qualityClass}">
            <span class="mh-lineage-parent-role">${parentRoles[index]}</span>
            <div class="mh-lineage-parent-main">
                <span class="mh-lineage-quality-badge">${escapeHtml(qualityId)}</span>
                <strong title="${escapeHtml(parent.name || '哈奇伙伴')}">${escapeHtml(parent.name || '哈奇伙伴')}</strong>
            </div>
            <span class="mh-lineage-parent-meta">${escapeHtml(getStageName(parent.stage, parent.stage || '成年'))} · ${escapeHtml(parent.bloodline || '血统未显现')}</span>
            <span class="mh-lineage-parent-trait">擅长 ${escapeHtml(parent.specialty || '未记录')} ${specialtyValue}</span>
        </article>`;
    }).join('');
    const archiveNote = lineage.length < 2
        ? '亲代档案残缺，暂未保存完整双亲资质快照。'
        : '已保存双亲资质快照。';
    const statusTitle = isMutation ? 'UR 基因突变已记录' : '正常遗传';
    const statusDetail = isMutation ? '该宠物继承了可追溯的突变增幅。' : '基因稳定传承，适合继续观察资质走向。';
    return `<section class="mh-pet-stats-section mh-lineage-section">
        <div class="mh-pet-stats-section-head"><span>血统档案</span><b>${lineage.length >= 2 ? '双亲已归档' : '档案残缺'}</b></div>
        <div class="mh-lineage-card ${isMutation ? 'is-mutation' : ''}">
            <div class="mh-lineage-status">
                <span class="mh-lineage-status-icon">${isMutation ? '✦' : '◎'}</span>
                <div><strong>${statusTitle}</strong><small>${statusDetail}</small></div>
            </div>
            ${parentCards ? `<div class="mh-lineage-parent-grid">${parentCards}</div>` : ''}
            <p class="mh-lineage-archive-note">${archiveNote}</p>
        </div>
    </section>`;
}

function openPetStatsModal(pet) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-pet-stats-mask';
    let upgrading = false;

    const render = () => {
        upgradePetData(pet);
        const { quality } = petQualityData(pet);
        const life = pet.lifeStats;
        const readiness = calculateExpeditionReadiness(life);
        const battle = pet.battle;
        const equipmentEnhancements = getHaqiExpeditionSettlement(state.settings).equipmentEnhancements || {};
        const derived = calculateDerivedStats(pet, { includeEquipment: isHaqiEquipmentEnabled(), equipmentEnhancements });
        const support = calculateMineralPetSupport(derived);
        const supportNames = support.assists.map(item => item.name).join('、') || '暂未解锁';
        const supportProgress = support.nextUnlock
            ? `距${support.nextUnlock.name}还差 ${support.nextUnlock.remainingPower} 战力`
            : '矿区战力支援已全部解锁';
        const baseBattleMultiplier = Number(pet?.baseBattleMultiplier ?? pet?.mutation?.baseBattleMultiplier) || 1;
        const growthMultiplier = Number(pet?.growthMultiplier ?? pet?.mutation?.growthMultiplier) || 1;
        const mutationBonus = baseBattleMultiplier > 1 || growthMultiplier > 1
            ? `<div class="mh-pet-mutation-bonus">变异增幅：基础战力 ×${baseBattleMultiplier} · 成长上限 ×${growthMultiplier}</div>`
            : '';
        const growthProfile = getPetGrowthProfile(pet);
        const growthSpecialty = GROWTH_STAT_LABELS[growthProfile.specialty] || '均衡';
        const experienceNeeded = getExperienceToNextLevel(battle.level);
        const experiencePercent = Math.min(100, Math.round(battle.experience / experienceNeeded * 100));
        const lifeRows = [
            ['精力', life.energy], ['心情', life.mood], ['清洁', life.clean], ['羁绊', life.bond],
        ].map(([label, value]) => `<div class="mh-pet-life-row"><span>${label}</span><div class="mh-pet-life-meter"><i style="width:${statPercent(value)}%"></i></div><b>${statPercent(value)}</b></div>`).join('');
        const battleRows = Object.entries(GROWTH_STAT_LABELS).map(([statName, label]) => {
            const materialId = getGrowthMaterialId(statName);
            const materialKey = `expedition_material_${materialId}`;
            const available = Math.max(0, Number(state.inventory?.[materialKey]) || 0);
            const growth = battle.growthStats[statName];
            const cap = getGrowthCap(pet, statName);
            const capped = !canApplyGrowthMaterial(pet, statName);
            const materialLabel = GROWTH_MATERIAL_LABELS[materialId] || materialId;
            const materialArt = rewardArtHtml(EXPEDITION_MATERIAL_ART[materialId], '');
            return `<div class="mh-pet-battle-row">
                <div><span>${label}</span><b>${derived[statName]}</b></div>
                <div class="mh-pet-growth-controls"><small>成长 ${growth}/${cap}</small><button type="button" data-growth-stat="${statName}" ${capped ? 'disabled' : ''} title="消耗 1 个${escapeHtml(materialLabel)}">+</button><span class="mh-pet-growth-material" title="${escapeHtml(materialLabel)}">${materialArt}</span><em>${available}</em></div>
            </div>`;
        }).join('');
        const ownedEquipment = ensureStarterEquipment();
        const equipped = normalizeEquipment(battle.equipment);
        const equipmentSlots = isHaqiEquipmentEnabled() ? EQUIPMENT_SLOTS.map(slot => {
            const definition = getEquipmentDefinition(equipped[slot]);
            const candidates = ownedEquipment
                .map(getEquipmentDefinition)
                .filter(item => item?.slot === slot && item.id !== definition?.id);
            const slotLabel = EQUIPMENT_SLOT_LABELS[slot];
            const slotIcon = ({ charm: '✦', core: '◆', guard: '◈' })[slot] || '◇';
            if (!definition) {
                return `<div class="mh-equipment-slot mh-equipment-slot-empty">
                    <div class="mh-equipment-slot-visual"><div class="mh-equipment-slot-icon" aria-hidden="true">${slotIcon}</div><b class="mh-equipment-slot-name">未装备</b></div>
                    <div class="mh-equipment-slot-copy"><span>${escapeHtml(slotLabel)}</span><small>等待一件远征装备</small></div>
                    <div class="mh-equipment-slot-actions">${candidates.length ? candidates.map(item => `<button type="button" class="mh-equipment-action" data-equip-item="${item.id}" title="装备 ${escapeHtml(item.name)}">装配 ${equipmentIconHtml(item)}</button>`).join('') : '<em>暂无可用装备</em>'}</div>
                </div>`;
            }
            const level = getEquipmentLevel(equipmentEnhancements, definition.id);
            const upgradeCost = getEquipmentUpgradeCost(equipmentEnhancements, definition.id);
            const [mainStatKey, mainStatValue] = Object.entries(definition.stats || {})[0] || [];
            const mainStatLabel = mainStatKey ? `${GROWTH_STAT_LABELS[mainStatKey] || mainStatKey} +${mainStatValue}` : '无固定属性';
            return `<div class="mh-equipment-slot mh-equipment-slot-equipped mh-equipment-quality-${escapeHtml(String(definition.quality || 'N').toLowerCase())}">
                <div class="mh-equipment-slot-visual"><div class="mh-equipment-slot-icon mh-equipment-slot-icon-upgraded" aria-hidden="true">${equipmentIconHtml(definition)}${equipmentUpgradeFrameHtml(level)}</div><b class="mh-equipment-slot-name" title="${escapeHtml(definition.name)}">${escapeHtml(definition.name)}</b></div>
                <div class="mh-equipment-slot-copy"><span>${escapeHtml(slotLabel)}</span><small>${escapeHtml(definition.quality)} · ${escapeHtml(mainStatLabel)}</small></div>
                <div class="mh-equipment-slot-level"><strong>+${level}</strong><small>强化</small></div>
                <div class="mh-equipment-slot-actions"><button type="button" class="mh-equipment-action" data-upgrade-equipment="${definition.id}" ${upgradeCost ? `title="消耗 ${upgradeCost} 星核精粹强化"` : 'disabled title="已达到强化上限"'}>${upgradeCost ? '强化' : '满级'}</button><button type="button" class="mh-equipment-action mh-equipment-action-remove" data-unequip-slot="${slot}" title="卸下 ${escapeHtml(definition.name)}">卸下</button>${candidates.map(item => `<button type="button" class="mh-equipment-action mh-equipment-action-swap" data-equip-item="${item.id}" title="替换为 ${escapeHtml(item.name)}">换 ${equipmentIconHtml(item)}</button>`).join('')}</div>
            </div>`;
        }).join('') : '';
        const equipmentSection = isHaqiEquipmentEnabled() ? `<section class="mh-pet-stats-section"><div class="mh-pet-stats-section-head"><span>远征装备</span><b>${ownedEquipment.length} 件</b></div><div class="mh-pet-readiness">装备固定值先计入属性，百分比效果最后结算。</div><div class="mh-equipment-slots">${equipmentSlots}</div></section>` : '';
        const lineageSection = petLineageSectionHtml(pet);
        mask.innerHTML = `<div class="modal-card mh-pet-stats-card">
            <button class="mh-rare-modal-close" data-pet-stats-close type="button" aria-label="关闭">×</button>
            <div class="mh-pet-stats-title">${escapeHtml(displayPetName(pet))}</div>
            ${quality ? `<div class="mh-pet-quality-pill ${petQualityClass(pet)}">${escapeHtml(quality.id)} · ${escapeHtml(quality.name)}品质</div>` : ''}
            <div class="mh-pet-stats-scroll">
                <section class="mh-pet-stats-section">
                    <div class="mh-pet-stats-section-head"><span>家园生活</span><b>${escapeHtml(readiness.tier)}</b></div>
                    <div class="mh-pet-life-grid">${lifeRows}</div>
                    <div class="mh-pet-readiness">远征状态：<b>${escapeHtml(readiness.tier)}</b><span>${readiness.score} / 100</span></div>
                </section>
                <section class="mh-pet-stats-section">
                    <div class="mh-pet-stats-section-head"><span>永久战斗</span><b>LV.${battle.level}</b></div>
                    <div class="mh-pet-readiness">综合战力：<b>${support.combatPower}</b><span>矿区支援：${escapeHtml(supportNames)}</span></div>
                    <div class="mh-pet-growth-profile">${escapeHtml(supportProgress)}</div>
                    <div class="mh-pet-growth-profile">物种倾向：<b>${escapeHtml(growthSpecialty)}</b><span>品质决定主强度</span></div>
                    ${mutationBonus}
                    <div class="mh-pet-exp-head"><span>经验 ${battle.experience} / ${experienceNeeded}</span><span>${experiencePercent}%</span></div>
                    <div class="mh-pet-exp-bar"><i style="width:${experiencePercent}%"></i></div>
                    <div class="mh-pet-battle-grid">${battleRows}</div>
                </section>
                ${lineageSection}
                ${equipmentSection}
            </div>
        </div>`;
    };

    render();
    mask.addEventListener('click', event => {
        if (event.target === mask || event.target.closest?.('[data-pet-stats-close]')) mask.remove();
    });
    mask.addEventListener('click', async event => {
        const button = event.target.closest?.('[data-growth-stat], [data-equip-item], [data-unequip-slot], [data-upgrade-equipment]');
        if (!button || upgrading) return;
        const equipmentId = button.dataset.equipItem;
        const equipmentSlot = button.dataset.unequipSlot;
        const upgradeEquipmentId = button.dataset.upgradeEquipment;
        if (upgradeEquipmentId) {
            const progress = getHaqiExpeditionSettlement(state.settings);
            const cost = getEquipmentUpgradeCost(progress.equipmentEnhancements, upgradeEquipmentId);
            const materialKey = 'expedition_material_stellarEssence';
            const available = Math.max(0, Number(state.inventory?.[materialKey]) || 0);
            if (!cost) { showToast('该装备已达到强化上限', 'info', 1600); return; }
            if (available < cost) { showToast(`强化需要 ${cost} 个星核精粹`, 'info', 1600); return; }
            upgrading = true;
            const previousLevels = { ...(progress.equipmentEnhancements || {}) };
            const previousSupport = getPetSupport(pet, previousLevels);
            const previousInventoryValue = state.inventory[materialKey];
            try {
                progress.equipmentEnhancements = { ...previousLevels, [upgradeEquipmentId]: getEquipmentLevel(previousLevels, upgradeEquipmentId) + 1 };
                state.inventory[materialKey] = available - cost;
                if (state.inventory[materialKey] <= 0) delete state.inventory[materialKey];
                pet.battleStats = calculateDerivedStats(pet, { includeEquipment: true, equipmentEnhancements: progress.equipmentEnhancements });
                await savePet(pet);
                saveInventoryDebounced();
                saveUserProfileDebounced();
                notify();
                const currentSupport = getPetSupport(pet, progress.equipmentEnhancements);
                showToast(`${getEquipmentDefinition(upgradeEquipmentId).name}强化成功 · ${petPowerChangeMessage(previousSupport, currentSupport)}`, 'success', 2200);
                render();
            } catch (error) {
                progress.equipmentEnhancements = previousLevels;
                if (previousInventoryValue === undefined) delete state.inventory[materialKey];
                else state.inventory[materialKey] = previousInventoryValue;
                console.error('Failed to upgrade pet equipment:', error);
                showToast('装备强化保存失败，请稍后重试', 'error', 1800);
            } finally {
                upgrading = false;
            }
            return;
        }
        if (equipmentId || equipmentSlot) {
            upgrading = true;
            const equipmentEnhancements = getHaqiExpeditionSettlement(state.settings).equipmentEnhancements || {};
            const previousSupport = getPetSupport(pet, equipmentEnhancements);
            try {
                const changed = equipmentId ? equipItem(pet, equipmentId, getOwnedEquipment()) : unequipSlot(pet, equipmentSlot);
                if (!changed) return;
                pet.battleStats = calculateDerivedStats(pet, { includeEquipment: isHaqiEquipmentEnabled(), equipmentEnhancements });
                await savePet(pet);
                saveUserProfileDebounced();
                notify();
                const currentSupport = getPetSupport(pet, equipmentEnhancements);
                showToast(`${equipmentId ? '装备已装配' : '装备已卸下'} · ${petPowerChangeMessage(previousSupport, currentSupport)}`, 'success', 2200);
                render();
            } catch (error) {
                console.error('Failed to update pet equipment:', error);
                showToast('装备保存失败，请稍后重试', 'error', 1800);
            } finally {
                upgrading = false;
            }
            return;
        }
        const statName = button.dataset.growthStat;
        const materialId = getGrowthMaterialId(statName);
        const materialKey = `expedition_material_${materialId}`;
        const available = Math.max(0, Number(state.inventory?.[materialKey]) || 0);
        if (available < 1) {
            showToast(`缺少${GROWTH_MATERIAL_LABELS[materialId] || '强化材料'}`, 'info', 1600);
            return;
        }
        if (!canApplyGrowthMaterial(pet, statName)) {
            showToast(`${GROWTH_STAT_LABELS[statName]}已达到成长上限`, 'info', 1600);
            return;
        }
        upgrading = true;
        button.disabled = true;
        const equipmentEnhancements = getHaqiExpeditionSettlement(state.settings).equipmentEnhancements || {};
        const previousSupport = getPetSupport(pet, equipmentEnhancements);
        const previousGrowth = pet.battle.growthStats[statName];
        const previousInventoryValue = state.inventory[materialKey];
        try {
            if (!applyGrowthMaterial(pet, statName, 1)) {
                showToast('强化未生效，请稍后重试', 'error', 1800);
                return;
            }
            state.inventory[materialKey] = available - 1;
            if (state.inventory[materialKey] <= 0) delete state.inventory[materialKey];
            await savePet(pet);
            saveInventoryDebounced();
            notify();
            const currentSupport = getPetSupport(pet, equipmentEnhancements);
            showToast(`${GROWTH_STAT_LABELS[statName]} +1 · ${petPowerChangeMessage(previousSupport, currentSupport)}`, 'success', 2200);
            render();
        } catch (error) {
            pet.battle.growthStats[statName] = previousGrowth;
            pet.battleStats = calculateDerivedStats(pet);
            if (previousInventoryValue === undefined) delete state.inventory[materialKey];
            else state.inventory[materialKey] = previousInventoryValue;
            console.error('Failed to apply pet growth material:', error);
            showToast('强化保存失败，请稍后重试', 'error', 1800);
        } finally {
            upgrading = false;
        }
    });
    document.body.appendChild(mask);
}

function _stageReachedIndex(stage) {
    const idx = ALBUM_STAGES.findIndex(s => s.id === stage);
    return idx; // egg/unknown → -1
}

function _hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
}

function _photoFrameHtml(pet, stageIdx, animIdx, captionText) {
    const sheetUrl = pet.imageSheetUrl;
    const seed = _hashStr(`${pet.id || pet.dna || ''}|${stageIdx}|${animIdx}`);
    const bg = ALBUM_BG_PALETTE[seed % ALBUM_BG_PALETTE.length];
    const rotate = (((seed >> 4) % 1200) / 100 - 6).toFixed(2); // -6 ~ +6 度
    const offsetX = (((seed >> 8) % 80) / 10 - 4).toFixed(2);
    const offsetY = (((seed >> 12) % 60) / 10 - 3).toFixed(2);
    const bgPosX = (animIdx * 100 / 3).toFixed(4);
    const bgPosY = (stageIdx * 100 / 3).toFixed(4);
    const imageStyle = sheetUrl
        ? `background-image:url('${sheetUrl}');background-size:400% 400%;background-position:${bgPosX}% ${bgPosY}%;background-repeat:no-repeat;background-color:${bg}`
        : `background:${bg};display:flex;align-items:center;justify-content:center;font-size:32px;color:#9ca3af`;
    const placeholder = sheetUrl ? '' : '🥚';
    return `
        <div class="mh-album-photo" style="transform:translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)">
            <div class="mh-album-photo-image" style="${imageStyle}">${placeholder}</div>
            <div class="mh-album-photo-caption">${escapeHtml(captionText)}</div>
        </div>`;
}

function _albumStageBlock(pet, stage, stageIdx) {
    const photos = ALBUM_ANIMS.map((anim, animIdx) => {
        const options = getAlbumCaptions()[stage.id]?.[animIdx] || [''];
        const seed = _hashStr(`${pet.id || pet.dna || ''}|cap|${stageIdx}|${animIdx}`);
        const caption = options[seed % options.length] || '';
        return _photoFrameHtml(pet, stageIdx, animIdx, caption);
    }).join('');
    return `
        <div class="mh-album-stage">
            <div class="mh-album-stage-title">
                <span style="font-size:18px">${stage.emoji}</span>
                <span class="font-bold">${escapeHtml(t(stage.nameKey))}</span>
                <span class="text-xs" style="color:var(--text-muted)">${escapeHtml(t('stageMemories'))}</span>
            </div>
            <div class="mh-album-grid">${photos}</div>
        </div>`;
}

function _ensureAlbumStyles() {
    if (document.getElementById('mh-album-styles')) return;
    const style = document.createElement('style');
    style.id = 'mh-album-styles';
    style.textContent = `
        .mh-album-mask { zoom:1 !important; align-items:flex-start; padding:12px 16px; overflow:hidden; }
        .mh-album-mask .modal-card { width:min(460px, calc(100vw - 32px)); max-width:460px; max-height:calc(100dvh - 24px); padding:18px; overflow:hidden; display:flex; flex-direction:column; }
        .mh-album-header { flex:0 0 auto; display:flex; flex-direction:column; gap:4px; padding-bottom:10px; margin-bottom:10px; border-bottom:1px dashed #d4d4d8; }
        .mh-album-meta { display:flex; flex-wrap:wrap; gap:6px 12px; font-size:12px; color:var(--text-secondary); }
        .mh-album-meta b { color:var(--text-primary); font-weight:600; }
        .mh-album-wish { font-size:12px; color:#a16207; background:#fef9c3; border-radius:8px; padding:6px 8px; margin-top:6px; }
        .mh-album-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 4px 2px; margin:0 -4px; overscroll-behavior:contain; }
        .mh-album-empty { text-align:center; color:var(--text-muted); padding:30px 14px; font-size:13px; }
        .mh-album-stage { margin-top:14px; }
        .mh-album-stage:first-child { margin-top:4px; }
        .mh-album-stage-title { display:flex; align-items:center; gap:6px; margin-bottom:8px; color:var(--text-primary); font-size:13px; }
        .mh-album-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:14px 10px; padding:6px 4px 10px; }
        .mh-album-photo { background:#ffffff; border:1px solid #e5e7eb; border-radius:6px; padding:6px 6px 8px; box-shadow:0 3px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08); transition: transform .2s ease; }
        .mh-album-photo:hover { transform: translate(0,0) rotate(0deg) scale(1.04) !important; z-index:2; position:relative; }
        .mh-album-photo-image { width:100%; aspect-ratio:1/1; border-radius:3px; image-rendering: pixelated; }
        .mh-album-photo-caption { margin-top:6px; font-size:11px; line-height:1.3; text-align:center; color:#4b5563; font-family: 'Kalam', 'Caveat', cursive, system-ui; min-height:1.3em; }
        .mh-album-close-row { flex:0 0 auto; display:flex; justify-content:flex-end; margin-top:12px; padding-top:10px; border-top:1px dashed #d4d4d8; }
    `;
    document.head.appendChild(style);
}

function openMemoryAlbum(pet) {
    if (!pet) return;
    _ensureAlbumStyles();
    const reachedIdx = _stageReachedIndex(pet.stage);
    const dietLabel = dietPreferenceLabel(dnaDietPreference(pet.dna || ''));
    const days = getCompanionDays(pet);
    const wish = (typeof pet.wishPrompt === 'string') ? pet.wishPrompt.trim() : '';

    let bodyHtml;
    if (reachedIdx < 0) {
        bodyHtml = `<div class="mh-album-empty">${escapeHtml(t('albumEmpty')).replace(/\n/g, '<br/>')}</div>`;
    } else {
        const blocks = ALBUM_STAGES
            .slice(0, reachedIdx + 1)
            .map((stage, idx) => _albumStageBlock(pet, stage, idx))
            .join('');
        bodyHtml = blocks;
    }

    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-album-mask';
    mask.innerHTML = `
        <div class="modal-card">
            <div class="mh-album-header">
                <div class="flex items-center gap-2">
                    <span class="font-extrabold" style="color:var(--text-primary)">${escapeHtml(t('albumTitle', { name: displayPetName(pet) }))}</span>
                </div>
                <div class="mh-album-meta">
                    <span>${escapeHtml(t('albumBirthday', { date: getPetBirthday(pet) }))}</span>
                    <span>${escapeHtml(t('albumDays', { days }))}</span>
                    <span>${escapeHtml(t('albumStage', { stage: getStageName(pet.stage, pet.stage || '') }))}</span>
                    <span>${escapeHtml(t('albumDiet', { diet: dietLabel }))}</span>
                </div>
                ${wish ? `<div class="mh-album-wish">${escapeHtml(t('albumWish', { wish }))}</div>` : ''}
            </div>
            <div class="mh-album-scroll">
                ${bodyHtml}
            </div>
            <div class="mh-album-close-row">
                <button class="btn-primary" data-album-close>${escapeHtml(t('albumClose'))}</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask) { close(); return; }
        if (e.target.closest?.('[data-album-close]')) close();
    });
    document.body.appendChild(mask);
}

function sortPetsByRecentBirthday(pets) {
    return [...(pets || [])].sort((a, b) => {
        const aBornAt = Number(a?.bornAt) || 0;
        const bBornAt = Number(b?.bornAt) || 0;
        if (aBornAt !== bBornAt) return bBornAt - aBornAt;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

export async function loadFamousPetsIndex() {
    if (Array.isArray(famousPetsIndex)) return famousPetsIndex;
    if (!famousPetsIndexPromise) {
        // `import.meta.url + ''` keeps Vite from statically analyzing this URL
        // and emitting a hashed copy of the verbatim-shipped famous-pets file.
        const indexUrl = new URL('../famous-pets/_pet_index.json', import.meta.url + '');
        famousPetsIndexPromise = fetch(indexUrl.href, { cache: 'no-cache' })
            .then(response => response.ok ? response.json() : [])
            .then(data => {
                const list = Array.isArray(data) ? data : (Array.isArray(data?.pets) ? data.pets : []);
                famousPetsIndex = list
                    .map(item => normalizeFamousPetIndexEntry(item, indexUrl.href))
                    .filter(item => item.id)
                    .sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || a.id.localeCompare(b.id));
                return famousPetsIndex;
            })
            .catch((e) => {
                console.warn('加载稀有宠物索引失败', e);
                famousPetsIndex = [];
                return famousPetsIndex;
            })
            .finally(() => { famousPetsIndexPromise = null; });
    }
    return famousPetsIndexPromise;
}

function normalizeFamousPetIndexEntry(item, baseUrl) {
    const entry = item && typeof item === 'object' ? { ...item } : {};
    const decodedTraits = entry.dna ? decodeDna(entry.dna) : null;
    entry.id = String(entry.id || '').trim();
    entry.name = String(entry.name || '').trim();
    entry.imageSheetUrl = resolveFamousPetIndexAssetUrl(entry.imageSheetUrl, baseUrl);
    entry.imageUrl = resolveFamousPetIndexAssetUrl(entry.imageUrl, baseUrl);
    entry.traits = normalizeFamousPetTraits(entry.traits || decodedTraits || entry);
    entry.rarity = Number(entry.rarity) || 0;
    entry.price = Math.max(0, Math.round(Number(entry.price ?? 100) || 100));
    entry.filterMetadataLoaded = true;
    return entry;
}

function resolveFamousPetIndexAssetUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:https?:|data:|blob:|\/)/i.test(raw)) return raw;
    try { return new URL(raw, baseUrl).href; }
    catch (_) { return raw; }
}

function normalizeFamousPetElement(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'sky' || raw.includes('天空')) return '天空';
    if (raw === 'land' || raw.includes('陆地')) return '陆地';
    if (raw === 'water' || raw === 'ocean' || raw.includes('水') || raw.includes('海')) return '水系';
    return String(value || '').trim();
}

function normalizeFamousPetTraits(source) {
    const traits = source?.traits && typeof source.traits === 'object' ? source.traits : source;
    if (!traits || typeof traits !== 'object') return {};
    const element = normalizeFamousPetElement(traits.element || traits.habitat || traits.category || traits.field);
    const elementalAttribute = String(traits.elementalAttribute || traits.attribute || '').trim();
    return {
        ...traits,
        ...(element ? { element } : {}),
        ...(elementalAttribute ? { elementalAttribute } : {}),
    };
}

function petElementalAttribute(petOrEntry) {
    const traits = normalizeFamousPetTraits(petOrEntry?.traits || petOrEntry || {});
    if (traits.elementalAttribute) return traits.elementalAttribute;
    if (petOrEntry?.dna) {
        try { return decodeDna(petOrEntry.dna)?.elementalAttribute || ''; }
        catch (_) { return ''; }
    }
    return '';
}

function petArtBackground(petOrEntry) {
    return ELEMENTAL_ATTRIBUTE_BACKGROUNDS[petElementalAttribute(petOrEntry)] || DEFAULT_PET_ART_BACKGROUND;
}

function applyFamousPetConfigMetadata(entry, config) {
    if (!entry) return entry;
    if (!config) {
        entry.filterMetadataLoaded = true;
        return entry;
    }
    const decodedTraits = config.dna ? decodeDna(config.dna) : null;
    entry.traits = normalizeFamousPetTraits(config.traits || decodedTraits || entry.traits || {});
    entry.dna = config.dna || entry.dna || '';
    entry.filterMetadataLoaded = true;
    return entry;
}

function needsFamousPetFilterMetadata(list) {
    return Array.isArray(list) && list.some(entry => !(entry?.filterMetadataLoaded || entry?.traits?.element || entry?.traits?.elementalAttribute));
}

async function loadFamousPetFilterMetadata() {
    const list = await loadFamousPetsIndex();
    if (!needsFamousPetFilterMetadata(list)) return list;
    if (!famousPetsFilterMetadataPromise) {
        famousPetsFilterMetadataPromise = Promise.all(list.map(async (entry) => {
            if (entry.filterMetadataLoaded || entry.traits?.element || entry.traits?.elementalAttribute) return entry;
            const config = await loadFamousPetConfig(entry);
            return applyFamousPetConfigMetadata(entry, config);
        })).then(() => list).finally(() => { famousPetsFilterMetadataPromise = null; });
    }
    return famousPetsFilterMetadataPromise;
}

function hasHatchedFamousPet(entry, pets) {
    const id = String(entry?.id || '').trim();
    const name = String(entry?.name || '').trim();
    if (!id && !name) return false;
    return (pets || []).some(pet => {
        if (!pet) return false;
        const petId = String(pet.id || '').trim();
        if (pet.lazyPetRecord) return !!id && petId === id;
        const petName = String(pet.name || '').trim();
        return (!!id && petId === id) || (!!name && petName === name);
    });
}

function rarePetArtHtml(entry, unlocked) {
    const canShowBaby = !!(entry?.imageSheetUrl || entry?.imageUrl);
    if (!unlocked && !canShowBaby) {
        return `<div class="mh-rare-pet-unknown" aria-label="${escapeHtml(t('undiscovered'))}">?</div>`;
    }
    const pet = {
        id: entry.id,
        stage: unlocked ? 'adult' : 'baby',
        anim: 'happy',
        imageUrl: entry.imageUrl || null,
        imageSheetUrl: entry.imageSheetUrl || null,
        dna: entry.dna || '',
        traits: entry.traits || null,
    };
    return rawPetArtHtml(pet, entry.name || entry.id);
}

function rarePetCardHtml(entry, pets) {
    const unlocked = hasHatchedFamousPet(entry, pets);
    const name = unlocked ? (entry.name || entry.id) : '???';
    const rarity = Math.max(0, Math.round(Number(entry.rarity) || 0));
    return `
        <button class="card-flat fade-in mh-rare-pet-card ${unlocked ? 'is-unlocked' : 'is-locked'}" data-rare-pet-id="${escapeHtml(entry.id)}" type="button">
            <div class="mh-rare-pet-portrait">
                ${rarePetArtHtml(entry, unlocked)}
            </div>
            <div class="mh-rare-pet-info">
                <div class="mh-rare-pet-name">${escapeHtml(name)}</div>
                <div class="mh-rare-pet-meta">
                    <span class="stage-badge" style="background:${unlocked ? '#ecfeff' : '#f3f4f6'};color:${unlocked ? 'var(--accent-dark)' : '#6b7280'}">${escapeHtml(t('rarityLabel', { rarity }))}</span>
                    <span>${unlocked ? escapeHtml(t('discovered')) : escapeHtml(t('undiscovered'))}</span>
                </div>
            </div>
        </button>`;
}

function famousPetFilterMatches(entry, filterId = activeFamousPetFilter) {
    if (!filterId || filterId === 'all') return true;
    const filter = FAMOUS_PET_FILTERS.find(item => item.id === filterId);
    if (!filter) return true;
    const traits = normalizeFamousPetTraits(entry?.traits || {});
    if (filter.type === 'element') return traits.element === filter.value;
    if (filter.type === 'attribute') return traits.elementalAttribute === filter.value;
    return true;
}

function filteredFamousPets(list) {
    return (list || []).filter(entry => famousPetFilterMatches(entry));
}

function famousPetFilterTabsHtml(list) {
    const safeList = Array.isArray(list) ? list : [];
    const countFor = (filter) => filter.id === 'all'
        ? safeList.length
        : safeList.filter(entry => famousPetFilterMatches(entry, filter.id)).length;
    return `
        <div class="mh-famous-filter-tabs" role="tablist" aria-label="${escapeHtml(t('rareCategoryAria'))}">
            ${FAMOUS_PET_FILTERS.map(filter => {
                const active = activeFamousPetFilter === filter.id;
                const count = countFor(filter);
                return `
                    <button class="mh-famous-filter-tab ${active ? 'active' : ''}" data-famous-pet-filter="${escapeHtml(filter.id)}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}">
                        ${escapeHtml(filter.labelKey ? t(filter.labelKey) : filter.label)}<span>${count}</span>
                    </button>`;
            }).join('')}
        </div>`;
}


function rememberFamousPetFilterScroll(panel) {
    const tabs = panel?.querySelector?.('.mh-famous-filter-tabs');
    if (tabs) famousPetFilterTabsScrollLeft = tabs.scrollLeft || 0;
}

function restoreFamousPetFilterScroll(panel) {
    const tabs = panel?.querySelector?.('.mh-famous-filter-tabs');
    if (!tabs) return;
    const restore = () => { tabs.scrollLeft = famousPetFilterTabsScrollLeft; };
    restore();
    requestAnimationFrame(restore);
    tabs.addEventListener('scroll', () => {
        famousPetFilterTabsScrollLeft = tabs.scrollLeft || 0;
    }, { passive: true });
}

function rarePetPrice(entry) {
    return Math.max(0, Math.round(Number(entry?.price ?? 100) || 100));
}

function rarePetPhotoCellHtml(entry, stageIdx, animIdx, unlocked) {
    const canReveal = unlocked || stageIdx === 0;
    const seed = _hashStr(`${entry?.id || ''}|rare|${stageIdx}|${animIdx}`);
    const rotate = (((seed >> 4) % 1000) / 100 - 5).toFixed(2);
    const offsetX = (((seed >> 8) % 60) / 10 - 3).toFixed(2);
    const offsetY = (((seed >> 12) % 50) / 10 - 2.5).toFixed(2);
    if (!canReveal || !entry?.imageSheetUrl) {
        return `
            <div class="mh-rare-album-photo" style="transform:translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)">
                <div class="mh-rare-album-image mh-rare-photo-unknown">?</div>
            </div>`;
    }
    const bx = (animIdx * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (stageIdx * 100 / (SHEET_ROWS - 1)).toFixed(3);
    const bg = petArtBackground(entry);
    return `
        <div class="mh-rare-album-photo" style="transform:translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)">
            <div class="mh-rare-album-image mh-rare-photo-image mh-pet-list-raw" data-mh-raw-url="${escapeHtml(entry.imageSheetUrl)}" style="background-color:${bg};background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></div>
        </div>`;
}

function rarePetPhotoGridHtml(entry, unlocked) {
    // 始终展示全部 4 个阶段：未解锁阶段也会显示阶段名字 + ？ 占位，
    // 让玩家提前看到这只稀有宠物有哪些形态。
    const stages = ALBUM_STAGES;
    const blocks = stages.map((stage, stageIdx) => {
        const cells = [];
        for (let animIdx = 0; animIdx < SHEET_COLS; animIdx++) {
            cells.push(rarePetPhotoCellHtml(entry, stageIdx, animIdx, unlocked));
        }
        return `
            <div class="mh-rare-album-stage">
                <div class="mh-rare-album-stage-title">
                    <span style="font-size:18px">${stage.emoji}</span>
                    <span class="font-bold">${escapeHtml(t(stage.nameKey))}</span>
                </div>
                <div class="mh-rare-album-grid">${cells.join('')}</div>
            </div>`;
    }).join('');
    return `<div class="mh-rare-album-scroll">${blocks}</div>`;
}

async function loadFamousPetConfig(entry) {
    const id = String(entry?.id || '').trim();
    if (!id) return null;
    return {
        ...entry,
        id,
        name: entry.name || id,
        imageUrl: entry.imageUrl || null,
        imageSheetUrl: entry.imageSheetUrl || null,
        traits: normalizeFamousPetTraits(entry.traits || entry),
    };
}

function openRarePetModal(entry, pets, refreshPetList) {
    const unlocked = hasHatchedFamousPet(entry, pets);
    const price = rarePetPrice(entry);
    const canAfford = (Number(state.coins) || 0) >= price;
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-rare-modal-mask';
    mask.innerHTML = `
        <div class="modal-card mh-rare-modal-card">
            <div class="mh-rare-modal-head">
                <div>
                    <div class="mh-rare-modal-title">${escapeHtml(unlocked ? (entry.name || entry.id) : '???')}</div>
                    <div class="mh-rare-modal-subtitle">${escapeHtml(t('rarityLabel', { rarity: Math.round(Number(entry.rarity) || 0) }))}</div>
                </div>
                <button class="mh-rare-modal-close" data-rare-close type="button" aria-label="关闭">×</button>
            </div>
            ${rarePetPhotoGridHtml(entry, unlocked)}
            <div class="mh-rare-modal-actions">
                ${unlocked
                    ? '<button class="btn-secondary" data-rare-close type="button">已拥有</button>'
                    : `<button class="btn-primary" data-rare-hatch type="button" ${canAfford ? '' : 'disabled'}>${escapeHtml(t('hatchRareBtn'))} ${coinIconSvg()} ${price}</button>`}
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-rare-close]')) { close(); return; }
        if (e.target.closest?.('[data-rare-hatch]')) hatchRarePet(entry, mask, refreshPetList);
    });
    document.body.appendChild(mask);
    setupLazyRawPetImages(mask);
    if (!unlocked && !canAfford) showToast(`金币不足，需要 ${price} 金币`, 'error', 1800);
}

async function hatchRarePet(entry, mask, refreshPetList) {
    const price = rarePetPrice(entry);
    if ((Number(state.coins) || 0) < price) {
        showToast(`金币不足，需要 ${price} 金币`, 'error', 1800);
        return;
    }
    const button = mask.querySelector('[data-rare-hatch]');
    if (button?.disabled) return;
    if (button) button.disabled = true;

    const current = state.currentPetId ? state.pets[state.currentPetId] : null;
    if (current && isPetOnCurrentPlanet(current)) {
        const targetName = entry?.name || entry?.id || t('rarePetFallback');
        const ok = await confirm(t('hatchRareConfirm', { target: targetName, current: current.name || t('currentPetFallback'), price }), {
            okText: t('releaseAndHatch'),
            cancelText: '再想想',
        });
        if (!ok) {
            if (button) button.disabled = false;
            return;
        }
    }

    const config = await loadFamousPetConfig(entry);
    if (!config?.id) {
        showToast(t('rareConfigMissing'), 'error', 2200);
        if (button) button.disabled = false;
        return;
    }

    if (current && isPetOnCurrentPlanet(current)) {
        markPetReleased(current, state.planetName || '宠物星');
        await savePet(current);
    }

    const now = Date.now();
    const pet = {
        ...JSON.parse(JSON.stringify(config)),
        id: config.id || entry.id || `rare_${randId(8)}`,
        name: config.name || entry.name || config.id || entry.id || t('rarePetFallback'),
        imageUrl: config.imageUrl || null,
        imageSheetUrl: config.imageSheetUrl || entry.imageSheetUrl || null,
        source: 'famous-pets',
        sourcePetId: `famous-pets/${entry.id}`,
        stats: eggStats(),
        permanentTrauma: defaultPermanentTrauma(),
        bornAt: now,
        lastTickAt: now,
        lastCareAt: now,
        parents: null,
        stage: 'egg',
        anim: 'idle',
        activeRoom: 'living',
        eggHatchPending: true,
        eggHatchQueuedAt: now,
    };

    addCoins(-price, { source: `rare-pet-${entry.id}`, category: 'pet' });
    await savePet(pet);
    await setCurrentPetPersisted(pet.id);
    saveUserProfileDebounced();
    try { await ensurePetData(pet.id); } catch (_) {}
    mask.remove();
    showToast(t('eggArrived', { name: pet.name }), 'success', 1800);
    notify();
    setView('home');

    setTimeout(async () => {
        const currentPet = state.pets[pet.id];
        if (!currentPet || currentPet.stage !== 'egg') return;
        currentPet.stage = 'baby';
        currentPet.anim = 'happy';
        currentPet.stats = defaultStats();
        currentPet.bornAt = Date.now();
        currentPet.lastTickAt = currentPet.bornAt;
        currentPet.lastCareAt = currentPet.bornAt;
        delete currentPet.eggHatchPending;
        delete currentPet.eggHatchQueuedAt;
        delete currentPet.eggHatchRequestedAt;
        try { applyStage(currentPet); } catch (_) {}
        await savePet(currentPet);
        notify();
        showToast(t('rareHatched', { name: currentPet.name || t('rarePetFallback') }), 'success', 2000);
        refreshPetList?.();
    }, 2000);
}

function petListTabsHtml({ petCount = 0, rareUnlockedCount = 0, rareTotalCount = 0 } = {}) {
    return `
        <div class="mh-pet-list-tabs" role="tablist" aria-label="宠物列表分类">
            ${PET_LIST_TABS.map(tab => `
                <button class="mh-pet-list-tab is-${escapeHtml(tab.id)} ${activePetListTab === tab.id ? 'active' : ''}" data-pet-list-tab="${escapeHtml(tab.id)}" type="button" role="tab" aria-label="${escapeHtml(tab.id === 'mine' ? t('tabCount', { label: t(tab.labelKey), count: petCount }) : t('tabCountRatio', { label: t(tab.labelKey), count: rareUnlockedCount, total: rareTotalCount }))}" aria-selected="${activePetListTab === tab.id ? 'true' : 'false'}">
                    <span class="mh-pet-list-tab-count">${escapeHtml(tab.id === 'mine' ? `(${petCount})` : `(${rareUnlockedCount}/${rareTotalCount})`)}</span>
                </button>`).join('')}
        </div>`;
}

function ensurePetListTabStyles() {
    if (document.getElementById('mh-pet-list-tab-styles')) return;
    const style = document.createElement('style');
    style.id = 'mh-pet-list-tab-styles';
    style.textContent = `
        .mh-pet-list-view { --mh-pet-catalog-page-art:url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/expedition-backgrounds/star-map-background.webp'); --mh-pet-catalog-tab-art:url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-tab-idle.webp'); --mh-pet-catalog-card-art:none; position:absolute; inset:0; overflow:hidden; background:#8ed5e4 var(--mh-pet-catalog-page-art) center / cover no-repeat; }
        .mh-pet-list-topbar { position:relative; z-index:4; min-width:0; height:72px; padding:5px 14px; border-bottom:0; background:rgba(236,249,255,.86); box-shadow:0 4px 14px rgba(32,105,139,.14); backdrop-filter:blur(8px); }
        .mh-pet-list-title { position:absolute; left:50%; top:50%; display:flex; align-items:center; justify-content:center; width:min(48vw, 330px); aspect-ratio:842 / 166; min-width:0; background:url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-title.webp') center / contain no-repeat; transform:translate(-50%, -50%); }
        .mh-pet-list-title > * { opacity:0; }
        .mh-pet-list-wallet { box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:min(24vw, 144px); aspect-ratio:288 / 128; padding:0 8px 0 42px; background:url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-wallet.webp') center / contain no-repeat; color:#8a5b25!important; white-space:nowrap; }
        .mh-pet-list-scroll { position:absolute; top:72px; left:0; right:0; bottom:0; overflow-y:auto; overflow-x:hidden; padding:14px; overscroll-behavior:contain; scrollbar-gutter:stable; }
        .mh-pet-list-content { position:relative; z-index:1; width:min(100%, 1120px); margin:0 auto; }
        .mh-pet-list-view.is-picker .mh-pet-list-scroll { bottom:var(--mh-pet-picker-footer-height, 0px); }
        .mh-pet-list-nav { position:sticky; z-index:3; top:-14px; padding:14px 0 9px; background:transparent; }
        .mh-pet-list-empty { color:var(--text-muted); padding:30px 14px; }
        .mh-pet-card { position:relative; display:grid; grid-template-columns:188px minmax(220px, 360px) minmax(132px, 1fr); gap:22px; align-items:center; min-height:142px; padding:16px 20px; overflow:hidden; border:0; border-radius:16px; background:#fff; box-shadow:0 4px 20px rgba(0,0,0,.06); }
        .mh-pet-card::before { content:''; position:absolute; inset:0; z-index:0; background-image:var(--mh-pet-catalog-card-art); background-position:center; background-size:100% 100%; pointer-events:none; }
        .mh-pet-card > * { position:relative; z-index:1; }
        .mh-pet-card:hover { transform:translateY(-2px); box-shadow:0 10px 28px rgba(15,23,42,.1); }
        .mh-pet-card.mh-pet-card-current, .mh-pet-card.mh-pet-card-picked { box-shadow:0 0 0 2px var(--accent), 0 8px 24px rgba(14,165,233,.16); }
        .mh-pet-card-identity { display:grid; grid-template-columns:88px minmax(0, 1fr); align-items:center; gap:12px; min-width:0; }
        .mh-pet-card-avatar { position:relative; width:88px; height:88px; aspect-ratio:1 / 1; flex:0 0 88px; padding:9px; border-radius:20px; background:transparent url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-avatar-frame.webp') center / contain no-repeat; box-shadow:none; }
        .mh-pet-card-avatar .mh-pet-avatar-frame { width:100%; height:100%; border:0; border-radius:16px; background:rgba(255,255,255,.54); box-shadow:inset 0 1px rgba(255,255,255,.8); }
        .mh-pet-card-identity-copy { display:flex; flex-direction:column; align-items:flex-start; gap:7px; min-width:0; line-height:1.35; }
        .mh-pet-card-info { width:100%; max-width:360px; min-width:0; }
        .mh-pet-card-title-row { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
        .mh-pet-card-name { color:#1e293b; min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:18px; font-weight:900; }
        .mh-pet-card-location-row { display:flex; align-items:center; gap:6px; margin-bottom:7px; }
        .mh-pet-card .stage-badge { border:0; border-radius:999px; padding:4px 8px; font-size:10px; font-weight:900; }
        .mh-pet-card .mh-pet-quality-badge { background:var(--mh-quality-color); color:#fff; box-shadow:0 3px 7px var(--mh-quality-glow); }
        .mh-pet-card-meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px; color:#718096; font-size:11px; line-height:1.5; }
        .mh-pet-card-dna { overflow:hidden; margin-bottom:10px; color:#999; font-family:ui-monospace, Menlo, monospace; font-size:10px; letter-spacing:.2px; line-height:1.4; text-overflow:ellipsis; white-space:nowrap; }
        .mh-pet-vitals { display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%; max-width:400px; }
        .mh-pet-vital { display:grid; grid-template-columns:auto minmax(0, 1fr); align-items:center; gap:5px; color:#64748b; font-size:12px; }
        .mh-pet-vital-bar { height:9px; overflow:hidden; border-radius:999px; background:#e8eef2; box-shadow:inset 0 1px 2px rgba(15,23,42,.08); }
        .mh-pet-vital-bar i { display:block; height:100%; border-radius:inherit; }
        .mh-pet-vital-energy i { background:linear-gradient(90deg,#8de34f,#2dbf71); }
        .mh-pet-vital-mood i { background:linear-gradient(90deg,#ffc24d,#ff8b48); }
        .mh-pet-card-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; align-content:center; justify-self:end; gap:7px; max-width:156px; min-width:132px; }
        .mh-pet-icon-action { display:grid; place-items:center; width:36px; height:36px; padding:0; border:0; border-radius:12px; background:#f1f7fb; color:#4d7188; font-size:17px; line-height:1; cursor:pointer; box-shadow:0 2px 5px rgba(15,23,42,.06); }
        .mh-pet-icon-action:hover { background:#dff5ff; color:#087da9; transform:translateY(-1px); }
        .mh-pet-primary-action { display:inline-flex; align-items:center; justify-content:center; min-width:88px; height:38px; padding:0 13px; border:0; border-radius:999px; background:linear-gradient(135deg,#22b8e6,#2587dd); color:#fff; font-size:12px; font-weight:900; cursor:pointer; box-shadow:0 5px 12px rgba(37,135,221,.25); }
        .mh-pet-primary-action:hover { transform:translateY(-1px); box-shadow:0 8px 16px rgba(37,135,221,.32); }
        .mh-pet-card-delete { position:absolute; top:9px; right:10px; width:25px; height:25px; border-radius:50%; font-size:16px; }
        .mh-pet-card-dispatching .mh-pet-card-avatar, .mh-pet-card-dispatching .mh-pet-card-actions { filter:grayscale(.82); opacity:.52; }
        .mh-pet-card-dispatching .mh-pet-card-actions { pointer-events:none; }
        .mh-pet-dispatch-stamp { position:absolute; z-index:3; top:-8px; left:-10px; padding:5px 8px; border:2px solid #475569; border-radius:7px; background:rgba(255,255,255,.94); color:#334155; font-size:10px; font-weight:900; letter-spacing:.5px; box-shadow:0 3px 8px rgba(15,23,42,.12); transform:rotate(-8deg); white-space:nowrap; }
        @media (min-width:768px) { .mh-pet-card { grid-template-columns:280px minmax(0,1fr) 200px; gap:24px; min-height:136px; } .mh-pet-card-identity { grid-template-columns:88px minmax(0,1fr); justify-self:start; width:100%; } .mh-pet-card-identity-copy { justify-content:center; } .mh-pet-card-title-row { align-items:center; gap:8px; } .mh-pet-card-info { justify-self:start; max-width:none; } .mh-pet-vitals { grid-template-columns:1fr; width:100%; max-width:400px; } .mh-pet-card-actions { justify-self:end; align-self:center; justify-content:flex-end; width:200px; max-width:200px; } }
        @media (max-width:700px) { .mh-pet-card { grid-template-columns:minmax(0,1fr) auto; gap:14px; } .mh-pet-card-identity { grid-column:1; } .mh-pet-card-info { grid-column:1; grid-row:2; } .mh-pet-card-actions { grid-column:2; grid-row:1 / span 2; } }
        @media (max-width:460px) { .mh-pet-card { grid-template-columns:minmax(0,1fr); padding:14px; } .mh-pet-card-avatar { width:76px; height:76px; border-radius:16px; } .mh-pet-card-avatar .mh-pet-avatar-frame { border-radius:12px; } .mh-pet-card-name { font-size:16px; } .mh-pet-card-actions { grid-column:1; grid-row:auto; justify-self:stretch; max-width:none; justify-content:flex-end; } .mh-pet-vitals { grid-template-columns:1fr; gap:5px; } .mh-pet-dispatch-stamp { left:42px; } }
        .mh-pet-list-tabs { display:grid; grid-template-columns:minmax(0, 423px) minmax(0, 406px); justify-content:center; align-items:center; gap:8px; margin-bottom:0; }
        .mh-pet-list-tab { position:relative; width:100%; padding:0; border:0; background-color:transparent; background-position:center; background-size:contain; background-repeat:no-repeat; color:#46728b; cursor:pointer; filter:drop-shadow(0 3px 4px rgba(53,121,154,.12)); }
        .mh-pet-list-tab.is-mine { aspect-ratio:846 / 142; background-image:url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-tab-active.webp'); }
        .mh-pet-list-tab.is-rare { aspect-ratio:812 / 142; background-image:url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-tab-idle.webp'); }
        .mh-pet-list-tab.is-mine.active { filter:brightness(1.08) saturate(1.12) drop-shadow(0 0 7px rgba(90,218,255,.95)) drop-shadow(0 3px 5px rgba(28,112,172,.32)); }
        .mh-pet-list-tab.is-rare.active { filter:brightness(1.08) saturate(1.12) drop-shadow(0 0 5px rgba(255,214,72,.8)) drop-shadow(0 3px 4px rgba(53,121,154,.18)); }
        .mh-pet-list-tab-count { position:absolute; left:59%; top:50%; max-width:36%; overflow:hidden; color:#315d7c; font-size:clamp(10px, 1.6vw, 16px); font-weight:900; line-height:1; text-overflow:ellipsis; text-shadow:0 1px rgba(255,255,255,.78); white-space:nowrap; transform:translateY(-50%); }
        .mh-pet-list-tab.is-mine .mh-pet-list-tab-count { color:#fff; text-shadow:0 1px 1px rgba(31,88,120,.55); }
        .mh-pet-list-tab.active .mh-pet-list-tab-count { color:#fff; text-shadow:0 1px 1px rgba(31,88,120,.55); }
        .mh-pet-list-tab.is-rare.active .mh-pet-list-tab-count { color:#24577d; text-shadow:0 1px rgba(255,255,255,.85); }
        .mh-pet-research-release { display:flex; align-items:center; justify-content:center; width:min(100%, 720px); aspect-ratio:1716 / 158; margin:8px auto 14px; padding:0 13% 0 10%; border:0; background:transparent url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/pet-catalog/pet-catalog-research-release-v5.webp') center / contain no-repeat; color:#fff; font-size:clamp(12px, 2vw, 20px); font-weight:900; line-height:1.2; text-align:center; text-shadow:0 2px 2px rgba(29,91,48,.45); cursor:pointer; filter:drop-shadow(0 3px 4px rgba(53,121,154,.16)); }
        .mh-famous-filter-tabs { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:clamp(2px, 1vw, 6px); width:100%; overflow:visible; padding:0 0 10px; margin:-2px 0 10px; }
        .mh-famous-filter-tabs::-webkit-scrollbar { display:none; }
        .mh-famous-filter-tab { display:inline-flex; align-items:center; justify-content:center; gap:clamp(2px, .7vw, 5px); width:100%; min-width:0; height:30px; padding:0 clamp(3px, 1vw, 10px); overflow:hidden; border:1.5px solid var(--border-card); border-radius:999px; background:#fff; color:var(--text-secondary); font-size:clamp(10px, 1.5vw, 12px); font-weight:900; white-space:nowrap; cursor:pointer; }
        .mh-famous-filter-tab span { flex:0 1 auto; min-width:14px; height:16px; padding:0 2px; overflow:hidden; border-radius:999px; background:#f1f5f9; color:#64748b; font-size:clamp(8px, 1.25vw, 10px); line-height:16px; text-align:center; text-overflow:clip; }
        .mh-famous-filter-tab.active { background:linear-gradient(135deg, #e0f7ff, #8edfff); border-color:#38bdf8; color:var(--text-primary); box-shadow:inset 0 1px 0 rgba(255,255,255,.82), 0 2px 5px rgba(14,116,144,.16); }
        .mh-famous-filter-tab.active span { background:rgba(255,255,255,.72); color:var(--accent-dark); }
        .mh-rare-pet-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(138px, 1fr)); gap:10px; }
        .mh-rare-pet-card { appearance:none; font:inherit; cursor:pointer; min-height:184px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; }
        .mh-rare-pet-card:hover { transform:translateY(-2px); border-color:var(--accent); }
        .mh-rare-pet-card.is-locked { filter:saturate(.75); }
        .mh-rare-pet-card.is-locked .mh-rare-pet-portrait { position:relative; background:linear-gradient(145deg, #e5f2f7, #c5dce8); }
        .mh-rare-pet-card.is-locked .mh-rare-pet-portrait .mh-pet-art { background-color:transparent !important; filter:brightness(0) contrast(1.2) drop-shadow(0 4px 4px rgba(15,23,42,.2)); opacity:.86; transform:scale(.9); }
        .mh-rare-pet-card.is-locked .mh-rare-pet-portrait::after { content:'?'; position:absolute; right:7px; bottom:5px; width:22px; height:22px; display:grid; place-items:center; border:2px solid #f8fdff; border-radius:50%; background:#3d6377; color:#fff; font-size:15px; font-weight:900; line-height:1; box-shadow:0 2px 5px rgba(15,23,42,.22); }
        .mh-rare-pet-portrait { width:96px; height:96px; border-radius:16px; background:var(--bg-pill); overflow:hidden; flex:0 0 auto; box-shadow:inset 0 2px 8px rgba(14,116,144,0.16); }
        .mh-rare-pet-unknown { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:48px; font-weight:900; background:linear-gradient(135deg, #f8fafc, #dbeafe); }
        .mh-rare-pet-info { width:100%; min-width:0; display:flex; flex-direction:column; gap:6px; }
        .mh-rare-pet-name { color:var(--text-primary); font-size:15px; font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .mh-rare-pet-meta { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:6px; font-size:11px; color:var(--text-muted); }
        .mh-rare-modal-mask { zoom:1 !important; align-items:flex-start; padding:12px 16px; overflow:hidden; }
        .mh-rare-modal-card { width:min(460px, calc(100vw - 32px)); max-width:460px; max-height:calc(100dvh - 24px); overflow:hidden; display:flex; flex-direction:column; gap:12px; }
        .mh-rare-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .mh-rare-modal-title { color:var(--text-primary); font-size:18px; font-weight:900; }
        .mh-rare-modal-subtitle { color:var(--text-muted); font-size:12px; font-weight:800; margin-top:2px; }
        .mh-rare-modal-close { width:36px; height:36px; border-radius:50%; border:1.5px solid var(--border-card); background:#fff; color:var(--text-primary); font-size:24px; line-height:1; cursor:pointer; }
        .mh-rare-album-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 4px 2px; margin:0 -4px; overscroll-behavior:contain; }
        .mh-rare-album-stage { margin-top:14px; }
        .mh-rare-album-stage:first-child { margin-top:2px; }
        .mh-rare-album-stage-title { display:flex; align-items:center; gap:6px; margin-bottom:8px; color:var(--text-primary); font-size:13px; }
        .mh-rare-album-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px 10px; padding:6px 4px 10px; }
        .mh-rare-album-photo { background:#ffffff; border:1px solid #e5e7eb; border-radius:6px; padding:6px; box-shadow:0 3px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08); transition:transform .2s ease; }
        .mh-rare-album-photo:hover { transform:translate(0,0) rotate(0deg) scale(1.04) !important; z-index:2; position:relative; }
        .mh-rare-album-image { width:100%; aspect-ratio:1/1; border-radius:3px; overflow:hidden; }
        .mh-rare-photo-image { display:block; background-color:#effaff; }
        .mh-rare-photo-unknown { display:flex; align-items:center; justify-content:center; color:#64748b; font-size:28px; font-weight:900; background:linear-gradient(135deg, #f8fafc, #dbeafe); }
        .mh-rare-modal-actions { flex:0 0 auto; display:flex; justify-content:flex-end; gap:8px; padding-top:10px; border-top:1px dashed #d4d4d8; }
        .mh-rare-modal-actions .btn-primary { min-width:128px; }
        .mh-rare-modal-actions .hud-coin-icon { width:15px; height:15px; }
        .mh-pet-stats-mask { zoom:1 !important; align-items:center; height:100dvh; padding:16px; overflow:hidden; }
        .mh-pet-stats-card { position:relative; box-sizing:border-box; width:min(360px, calc(100vw - 32px)); max-height:calc(100dvh - 32px); padding:22px; overflow:hidden; display:flex; flex-direction:column; }
        .mh-pet-stats-card .mh-rare-modal-close { position:absolute; top:10px; right:10px; }
        .mh-pet-stats-title { color:var(--text-primary); font-size:18px; font-weight:900; padding-right:34px; }
        .mh-pet-quality-pill, .mh-pet-quality-badge { --mh-quality-color:#94a3b8; --mh-quality-tint:#f1f5f9; --mh-quality-glow:transparent; }
        .mh-pet-quality-pill { display:inline-flex; align-self:flex-start; margin:10px 0 14px; padding:5px 9px; border:1px solid var(--mh-quality-color); border-radius:999px; background:var(--mh-quality-tint); color:var(--mh-quality-color); font-size:12px; font-weight:900; box-shadow:0 0 0 1px rgba(255,255,255,.72) inset; }
        .mh-pet-quality-badge { background:var(--mh-quality-tint); color:var(--mh-quality-color); border:1px solid var(--mh-quality-color); font-weight:900; }
        .mh-quality-n { --mh-quality-color:#64748b; --mh-quality-tint:#f1f5f9; --mh-quality-glow:rgba(100,116,139,.12); --mh-avatar-gradient:linear-gradient(135deg,#e2e8f0,#cbd5e1); }
        .mh-quality-r { --mh-quality-color:#16a34a; --mh-quality-tint:#ecfdf3; --mh-quality-glow:rgba(22,163,74,.16); --mh-avatar-gradient:linear-gradient(135deg,#bbf7d0,#4ade80); }
        .mh-quality-sr { --mh-quality-color:#0891b2; --mh-quality-tint:#ecfeff; --mh-quality-glow:rgba(8,145,178,.18); --mh-avatar-gradient:linear-gradient(135deg,#a5f3fc,#60a5fa); }
        .mh-quality-ssr { --mh-quality-color:#9333ea; --mh-quality-tint:#faf5ff; --mh-quality-glow:rgba(147,51,234,.22); --mh-avatar-gradient:linear-gradient(135deg,#e9d5ff,#a855f7); }
        .mh-quality-ur { --mh-quality-color:#d97706; --mh-quality-tint:#fffbeb; --mh-quality-glow:rgba(217,119,6,.32); --mh-avatar-gradient:linear-gradient(135deg,#fef08a,#f59e0b 48%,#fb7185 75%,#a78bfa); }
        .mh-pet-avatar-frame { border:2px solid var(--mh-quality-color); box-shadow:0 0 0 2px rgba(255,255,255,.78) inset, 0 3px 10px var(--mh-quality-glow); }
        .mh-pet-card-quality { border-color:color-mix(in srgb, var(--mh-quality-color) 38%, var(--border-card)); }
        .mh-pet-card.mh-pet-card-quality.mh-quality-ur { box-shadow:0 0 0 1px rgba(255,255,255,.86) inset, 0 4px 20px var(--mh-quality-glow), 0 8px 24px rgba(15,23,42,.08); }
        .mh-pet-stats-scroll { min-height:0; max-height:min(520px, calc(100dvh - 118px)); overflow-y:auto; padding-right:2px; }
        .mh-pet-stats-section { padding:12px 0; border-top:1px solid var(--border-card); }
        .mh-pet-stats-section:first-child { border-top:0; padding-top:0; }
        .mh-pet-stats-section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; color:var(--text-primary); font-size:14px; font-weight:900; }
        .mh-pet-stats-section-head b { color:var(--accent-dark); font-size:12px; }
        .mh-pet-life-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
        .mh-pet-life-row { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:6px; padding:8px; border:1px solid var(--border-card); border-radius:8px; background:#effaff; color:var(--text-secondary); font-size:11px; }
        .mh-pet-life-row b { color:var(--text-primary); font-size:12px; }
        .mh-pet-life-meter { height:5px; overflow:hidden; border-radius:999px; background:#dbeafe; }
        .mh-pet-life-meter i, .mh-pet-exp-bar i { display:block; height:100%; border-radius:inherit; background:#38bdf8; }
        .mh-pet-readiness { display:flex; gap:6px; margin-top:9px; color:var(--text-muted); font-size:12px; }
        .mh-pet-readiness b { color:var(--accent-dark); }
        .mh-pet-readiness span { margin-left:auto; }
        .mh-pet-exp-head { display:flex; justify-content:space-between; margin-bottom:5px; color:var(--text-muted); font-size:11px; }
        .mh-pet-growth-profile { display:flex; align-items:center; gap:5px; margin:-2px 0 9px; color:var(--text-muted); font-size:11px; }
        .mh-pet-growth-profile b { color:var(--accent-dark); }
        .mh-pet-growth-profile span { margin-left:auto; white-space:nowrap; font-size:10px; }
        .mh-pet-exp-bar { height:7px; overflow:hidden; border-radius:999px; background:#e0f2fe; }
        .mh-pet-battle-grid { display:grid; gap:7px; margin-top:10px; }
        .mh-pet-battle-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 9px; border:1px solid var(--border-card); border-radius:8px; background:#f8fafc; }
        .mh-pet-battle-row > div:first-child { display:flex; align-items:baseline; gap:8px; color:var(--text-secondary); font-size:12px; }
        .mh-pet-battle-row > div:first-child b { color:var(--text-primary); font-size:16px; }
        .mh-lineage-card { display:grid; gap:9px; padding:10px; border:1px solid #bae6fd; border-radius:8px; background:#f0f9ff; }
        .mh-lineage-card.is-mutation { border-color:#fcd34d; background:#fffbeb; box-shadow:0 2px 8px rgba(217,119,6,.12); }
        .mh-lineage-status { display:flex; align-items:center; gap:8px; min-width:0; }
        .mh-lineage-status-icon { width:30px; height:30px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background:#e0f2fe; color:#0e7490; font-size:17px; font-weight:900; }
        .mh-lineage-card.is-mutation .mh-lineage-status-icon { background:#fef3c7; color:#b45309; }
        .mh-lineage-status div { min-width:0; display:grid; gap:2px; }
        .mh-lineage-status strong { color:var(--text-primary); font-size:12px; }
        .mh-lineage-status small { color:var(--text-muted); font-size:10px; line-height:1.35; }
        .mh-lineage-parent-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:7px; }
        .mh-lineage-parent-card { min-width:0; display:grid; gap:3px; padding:8px; border:1px solid var(--mh-quality-color); border-radius:8px; background:var(--mh-quality-tint); }
        .mh-lineage-parent-role { color:var(--text-muted); font-size:10px; font-weight:900; }
        .mh-lineage-parent-main { min-width:0; display:flex; align-items:center; gap:5px; }
        .mh-lineage-quality-badge { flex:0 0 auto; padding:2px 4px; border:1px solid var(--mh-quality-color); border-radius:4px; color:var(--mh-quality-color); font-size:9px; font-weight:900; }
        .mh-lineage-parent-main strong { overflow:hidden; color:var(--text-primary); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
        .mh-lineage-parent-meta, .mh-lineage-parent-trait { overflow:hidden; color:var(--text-muted); font-size:10px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
        .mh-lineage-parent-trait { color:var(--mh-quality-color); font-weight:800; }
        .mh-lineage-archive-note { margin:0; color:var(--text-muted); font-size:10px; line-height:1.4; }
        .mh-pet-growth-controls { display:flex; align-items:center; gap:6px; color:var(--text-muted); }
        .mh-pet-growth-controls small { font-size:10px; }
        .mh-pet-growth-controls button { width:25px; height:25px; padding:0; border:1px solid #38bdf8; border-radius:50%; background:#ecfeff; color:#0e7490; font-size:18px; line-height:1; cursor:pointer; }
        .mh-pet-growth-controls button:disabled { border-color:#cbd5e1; background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .mh-pet-growth-material { width:24px; height:24px; flex:0 0 24px; }
        .mh-pet-growth-material img { display:block; width:100%; height:100%; object-fit:contain; }
        .mh-pet-growth-controls em { min-width:14px; color:var(--text-primary); font-size:11px; font-style:normal; font-weight:900; text-align:right; }
        .mh-equipment-slots { display:grid; gap:8px; margin-top:10px; }
        .mh-equipment-slot { --mh-equipment-color:#64748b; --mh-equipment-tint:#f8fafc; --mh-equipment-icon-size:clamp(52px, 5vw, 60px); --mh-equipment-visual-width:clamp(72px, 7vw, 84px); display:grid; grid-template-columns:var(--mh-equipment-visual-width) minmax(0, 1fr) auto auto; align-items:center; gap:10px; min-height:108px; padding:10px; border:1px solid var(--mh-equipment-color); border-radius:8px; background:var(--mh-equipment-tint); }
        .mh-equipment-slot-visual { align-self:start; display:grid; justify-items:center; gap:5px; width:var(--mh-equipment-visual-width); min-width:0; }
        .mh-equipment-slot-icon { width:var(--mh-equipment-icon-size); height:var(--mh-equipment-icon-size); display:grid; place-items:center; border:1px solid color-mix(in srgb, var(--mh-equipment-color) 45%, #fff); border-radius:10px; background:rgba(255,255,255,.78); color:var(--mh-equipment-color); font-size:clamp(28px, 2.5vw, 34px); font-weight:900; box-shadow:0 1px 3px rgba(15,23,42,.08); }
        .mh-equipment-slot-name { display:-webkit-box; overflow:hidden; width:100%; color:var(--text-primary); font-size:12px; font-weight:900; line-height:1.25; text-align:center; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
        .mh-equipment-slot-icon-upgraded { position:relative; isolation:isolate; overflow:hidden; }
        .mh-equipment-image { display:grid; place-items:center; width:1.5em; height:1.5em; vertical-align:middle; }
        .mh-equipment-image img { display:block; width:100%; height:100%; object-fit:contain; }
        .mh-equipment-slot-icon .mh-equipment-image { position:relative; z-index:1; width:100%; height:100%; }
        .mh-equipment-upgrade-frame { position:absolute; z-index:2; inset:0; width:100%; height:100%; object-fit:contain; pointer-events:none; }
        .mh-equipment-slot-copy { min-width:0; display:grid; gap:2px; }
        .mh-equipment-slot-copy span { color:var(--text-muted); font-size:10px; font-weight:900; }
        .mh-equipment-slot-copy small { overflow:hidden; color:var(--mh-equipment-color); font-size:10px; font-weight:800; text-overflow:ellipsis; white-space:nowrap; }
        .mh-equipment-slot-level { display:grid; justify-items:center; min-width:28px; color:var(--mh-equipment-color); }
        .mh-equipment-slot-level strong { font-size:15px; line-height:1; }
        .mh-equipment-slot-level small { margin-top:3px; color:var(--text-muted); font-size:9px; font-weight:800; }
        .mh-equipment-slot-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px; max-width:136px; }
        .mh-equipment-action { min-width:40px; min-height:30px; padding:2px 7px; border:1px solid color-mix(in srgb, var(--mh-equipment-color) 48%, #fff); border-radius:7px; background:rgba(255,255,255,.78); color:var(--mh-equipment-color); font-size:11px; font-weight:900; line-height:1.15; cursor:pointer; }
        .mh-equipment-action .mh-equipment-image { display:inline-grid; width:clamp(24px, 2.4vw, 30px); height:clamp(24px, 2.4vw, 30px); margin-left:2px; vertical-align:middle; }
        .mh-equipment-action:disabled { border-color:#cbd5e1; background:#f1f5f9; color:#94a3b8; cursor:default; }
        .mh-equipment-action-remove { color:#be123c; border-color:#fecdd3; }
        .mh-equipment-action-swap { color:#0e7490; border-color:#a5f3fc; }
        .mh-equipment-slot-empty { grid-template-columns:var(--mh-equipment-visual-width) minmax(0, 1fr) auto; border-style:dashed; border-color:#cbd5e1; background:#f8fafc; }
        .mh-equipment-slot-empty .mh-equipment-slot-icon { border-style:dashed; color:#94a3b8; }
        .mh-equipment-slot-empty .mh-equipment-slot-name, .mh-equipment-slot-empty .mh-equipment-slot-copy small { color:#94a3b8; }
        .mh-equipment-slot-empty .mh-equipment-slot-actions em { color:#94a3b8; font-size:10px; font-style:normal; font-weight:800; }
        .mh-equipment-quality-r { --mh-equipment-color:#16a34a; --mh-equipment-tint:#f0fdf4; }
        .mh-equipment-quality-sr { --mh-equipment-color:#0891b2; --mh-equipment-tint:#ecfeff; }
        .mh-equipment-quality-ssr { --mh-equipment-color:#9333ea; --mh-equipment-tint:#faf5ff; }
        .mh-equipment-quality-ur { --mh-equipment-color:#d97706; --mh-equipment-tint:#fffbeb; box-shadow:0 2px 8px rgba(217,119,6,.16); }
        @media (max-width:420px) { .mh-equipment-slot { --mh-equipment-icon-size:48px; --mh-equipment-visual-width:72px; grid-template-columns:var(--mh-equipment-visual-width) minmax(0, 1fr) auto; gap:8px; min-height:104px; padding:8px; } .mh-equipment-slot-icon { font-size:27px; } .mh-equipment-slot-name { font-size:11px; } .mh-equipment-slot-level { grid-column:2; grid-row:2; justify-items:start; display:flex; gap:4px; align-items:baseline; } .mh-equipment-slot-level small { margin:0; } .mh-equipment-slot-actions { grid-column:3; grid-row:1 / span 2; max-width:94px; gap:4px; } .mh-equipment-action { min-width:40px; min-height:29px; padding:2px 5px; font-size:10px; } .mh-equipment-action .mh-equipment-image { width:24px; height:24px; } .mh-equipment-slot-empty .mh-equipment-slot-actions { grid-column:3; grid-row:auto; } .mh-lineage-parent-grid { grid-template-columns:1fr; } .mh-lineage-parent-card { grid-template-columns:auto minmax(0, 1fr); column-gap:7px; } .mh-lineage-parent-role { grid-column:1; grid-row:1 / span 3; writing-mode:vertical-rl; text-orientation:mixed; } .mh-lineage-parent-main, .mh-lineage-parent-meta, .mh-lineage-parent-trait { grid-column:2; } }
        @media (min-width:900px) { .mh-pet-list-view { background-size:100% auto; background-repeat:repeat-y; } }
        @media (max-width:540px) { .mh-pet-list-topbar { height:60px; padding:4px 8px; } .mh-pet-list-title { width:min(56vw, 270px); } .mh-pet-list-wallet { width:min(25vw, 112px); padding-left:34px; font-size:12px; } .mh-pet-list-scroll { top:60px; } }
        @media (max-width:420px) { .mh-pet-list-scroll { padding:10px; } .mh-pet-list-nav { top:-10px; padding:10px 0 8px; } .mh-pet-list-tabs { gap:4px; } .mh-pet-list-tab-count { left:60%; max-width:34%; font-size:10px; } .mh-pet-research-release { margin-top:6px; padding:0 13% 0 10%; font-size:12px; } .mh-rare-album-grid { gap:12px 8px; } .mh-rare-album-photo { padding:5px; } }
    `;
    document.head.appendChild(style);
}

function rawPetArtHtml(pet, alt = '') {
    const url = pet?.imageSheetUrl || pet?.imageUrl || '';
    const cell = pet?.imageSheetUrl ? getPetSpriteCell(pet) : null;
    const safeAlt = escapeHtml(alt);
    const bg = petArtBackground(pet);

    if (pet?.imageUrl && !pet?.imageSheetUrl) {
        return `<div class="mh-pet-art mh-pet-list-raw" data-mh-raw-url="${escapeHtml(url)}" aria-label="${safeAlt}"
            style="width:100%;height:100%;display:block;background:${bg};background-size:contain;background-position:center;background-repeat:no-repeat;image-rendering:auto"></div>`;
    }

    if (!url || !cell) {
        return `<div class="mh-pet-art mh-pet-art-egg" aria-label="${safeAlt}"
            style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
            ${buildEggSvg(pet)}
        </div>`;
    }

    const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    return `<div class="mh-pet-art mh-pet-art-sprite mh-pet-list-raw" data-mh-raw-url="${escapeHtml(url)}" aria-label="${safeAlt}"
        style="width:100%;height:100%;display:block;background:${bg};background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:auto"></div>`;
}

function setupLazyRawPetImages(root) {
    const targets = $$('.mh-pet-list-raw[data-mh-raw-url]', root).filter(el => el.dataset.mhRawLoaded !== '1');
    if (!targets.length) return;

    const load = (el) => {
        if (!el || el.dataset.mhRawLoaded === '1') return;
        const url = el.dataset.mhRawUrl || '';
        if (!url) return;
        el.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
        el.dataset.mhRawLoaded = '1';
    };

    if (typeof IntersectionObserver === 'undefined') {
        targets.forEach(load);
        return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
            load(entry.target);
            obs.unobserve(entry.target);
        });
    }, { root: null, rootMargin: '120px 0px', threshold: 0.01 });

    targets.forEach(el => observer.observe(el));
}

function petCardHtml(pet, isCurrent, allowSelect = false, picker = null, canDelete = false) {
    const lazy = !!pet.lazyPetRecord;
    const isPicker = !!picker;
    const stats = lazy ? { hunger: 100, mood: 100 } : getRuntimePetStats(pet);
    const staminaBar = Math.round(stats.hunger || 0);
    const moodBar = Math.round(stats.mood || 0);
    const sheetReady = !!pet.imageSheetUrl;
    const planetName = window.MH_state?.planetName || '宠物星';
    const location = getPetLocationInfo(pet, planetName);
    const dispatching = !lazy && isPetDispatching(pet.id);
    const selectable = !lazy && !dispatching && (isPicker || isPetSelectable(pet));
    const canSelect = (allowSelect || isPicker) && selectable;
    const picked = isPicker && picker.selectedIds?.has?.(pet.id);
    const findTarget = getPetFindTarget(pet);
    const name = lazy ? t('petLazyName', { id: String(pet.id || '').slice(0, 6) }) : displayPetName(pet);
    const qualityClass = lazy ? '' : petQualityClass(pet);
    const hint = pet.stage === 'egg'
        ? (sheetReady ? t('eggAlmostHatched') : t('eggGrowing'))
        : '';
        return `
                <div class="card-flat fade-in mh-pet-card mh-pet-card-quality ${qualityClass} ${canSelect ? 'cursor-pointer' : ''} ${isCurrent ? 'mh-pet-card-current' : ''} ${picked ? 'mh-pet-card-picked' : ''} ${dispatching ? 'mh-pet-card-dispatching' : ''}"
                         data-pet-id="${escapeHtml(pet.id)}"
                         ${lazy ? 'data-pet-lazy="1"' : ''}
                         data-selectable="${canSelect ? '1' : '0'}">
            ${canDelete && !lazy ? `<button class="mh-pet-icon-action mh-pet-card-delete" data-delete-pet="${escapeHtml(pet.id)}" title="${escapeHtml(t('exilePetTitle', { name }))}" aria-label="${escapeHtml(t('exilePetTitle', { name }))}">×</button>` : ''}
            <div class="mh-pet-card-identity">
            <div class="mh-pet-card-avatar ${qualityClass}"><div class="mh-pet-avatar-frame ${qualityClass}">
                ${lazy ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:12px">${escapeHtml(t('petLazyLoading'))}</div>` : rawPetArtHtml(pet, displayPetName(pet))}
            </div>${dispatching ? '<span class="mh-pet-dispatch-stamp">🔒 勘探中</span>' : ''}</div>
            <div class="mh-pet-card-identity-copy">
                <div class="mh-pet-card-title-row">
                    <span class="text-base font-bold mh-pet-card-name">${escapeHtml(name)}</span>
                    ${lazy ? '' : petQualityBadgeHtml(pet)}
                    ${lazy ? `<span class="stage-badge">${escapeHtml(t('petLazyBadge'))}</span>` : `<span class="stage-badge">${escapeHtml(getStageName(pet.stage, pet.stage || ''))}</span>`}
                    ${isCurrent ? `<span class="stage-badge" style="background:var(--accent);color:#fff">${escapeHtml(t('currentBadge'))}</span>` : ''}
                </div>
                <div class="mh-pet-card-location-row">
                    <span class="stage-badge" style="background:#ecfeff;color:${escapeHtml(location.tone)}">${escapeHtml(location.label)}</span>
                </div>
            </div></div>
            <div class="mh-pet-card-info">
                <div class="mh-pet-card-meta">
                    ${lazy ? `<span>${escapeHtml(t('petLazyHint'))}</span>` : `${escapeHtml(t('birthdayDays', { date: getPetBirthday(pet), days: getCompanionDays(pet) }))}`.split(' · ').map(text => `<span>${escapeHtml(text)}</span>`).join('')}
                </div>
                ${lazy || isPicker ? '' : `<div class="mh-pet-card-dna">
                    DNA: ${escapeHtml(formatDna(pet.dna || ''))}
                </div>`}
                ${hint ? `<div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">${escapeHtml(hint)}</div>` : ''}
                ${isPicker ? '' : `<div class="mh-pet-vitals">
                    <div class="mh-pet-vital"><span>⚡</span><div class="mh-pet-vital-bar mh-pet-vital-energy"><i style="width:${staminaBar}%"></i></div></div>
                    <div class="mh-pet-vital"><span>😊</span><div class="mh-pet-vital-bar mh-pet-vital-mood"><i style="width:${moodBar}%"></i></div></div>
                </div>`}
            </div>
            <div class="mh-pet-card-actions">
                ${isPicker && !lazy ? `<span class="stage-badge" data-picker-state style="align-self:flex-end;background:${dispatching ? '#334155' : picked ? 'var(--accent)' : '#effaff'};color:${dispatching || picked ? '#fff' : 'var(--text-secondary)'}">${escapeHtml(dispatching ? '勘探中' : picked ? t('pickerSelected') : t('pickerSelect'))}</span>` : ''}
                ${!isPicker && findTarget ? `<button class="mh-pet-icon-action" data-find="${escapeHtml(pet.id)}" title="${escapeHtml(t('findPetTitle', { name }))}" aria-label="${escapeHtml(t('findPetTitle', { name }))}">⌖</button>` : ''}
                ${!isPicker && !lazy ? `<button class="mh-pet-primary-action" data-pet-stats="${escapeHtml(pet.id)}" title="查看战斗属性" aria-label="查看战斗属性">详情</button><button class="mh-pet-icon-action" data-pet-rename="${escapeHtml(pet.id)}" title="${Math.max(0, Number(pet.renameCount) || 0) ? '改名需要 200 金币' : '首次改名免费'}" aria-label="${Math.max(0, Number(pet.renameCount) || 0) ? '改名需要 200 金币' : '首次改名免费'}">✎</button>` : ''}
                ${!isPicker && !lazy ? `<button class="mh-pet-icon-action" data-album="${escapeHtml(pet.id)}" title="${escapeHtml(t('albumBtnTitle', { name }))}" aria-label="${escapeHtml(t('albumBtnTitle', { name }))}">▣</button>` : ''}
            </div>
        </div>`;
}

function setupLazyPetCards(panel, onLoadPet, { renderLoadedCard, onCardReady } = {}) {
    if (typeof onLoadPet !== 'function') return;
    const targets = $$('[data-pet-lazy="1"]', panel);
    if (!targets.length) return;
    const load = async (el) => {
        const id = el?.dataset?.petId;
        if (!id || el.dataset.petLazyLoading === '1') return;
        el.dataset.petLazyLoading = '1';
        const loadedPet = await onLoadPet(id, el);
        if (!loadedPet || !el.isConnected || typeof renderLoadedCard !== 'function') return;
        const holder = document.createElement('div');
        holder.innerHTML = renderLoadedCard(loadedPet);
        const next = holder.firstElementChild;
        if (!next) return;
        el.replaceWith(next);
        setupLazyRawPetImages(next);
        onCardReady?.(next, loadedPet);
    };
    if (typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
                load(entry.target);
                obs.unobserve(entry.target);
            });
        }, { root: null, rootMargin: '140px 0px', threshold: 0.01 });
        targets.forEach(el => observer.observe(el));
        return;
    }
    const scroller = panel.querySelector('[style*="overflow-y:auto"]') || panel;
    const check = () => {
        const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
        targets.forEach((el) => {
            const rect = el.getBoundingClientRect?.();
            if (rect && rect.bottom > -140 && rect.top < vh + 140) load(el);
        });
    };
    scroller.addEventListener?.('scroll', check, { passive: true });
    requestAnimationFrame(check);
}

export function renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect = false, pickerMode = false, multiple = false, selectedIds = [], onConfirm, title, confirmText } = {}) {
    ensurePetListTabStyles();
    rememberFamousPetFilterScroll(panel);
    const list = sortPetsByRecentBirthday(pets || []);
    const rareList = Array.isArray(famousPetsIndex) ? famousPetsIndex : [];
    const rareFilteredList = filteredFamousPets(rareList);
    const rareUnlockedCount = rareList.filter(item => hasHatchedFamousPet(item, pets || [])).length;
    const isPicker = !!pickerMode;
    if (isPicker) activePetListTab = 'mine';
    const isRareTab = !isPicker && activePetListTab === 'rare';
    const pickedIds = new Set((Array.isArray(selectedIds) ? selectedIds : []).filter(Boolean));
    const picker = isPicker ? { selectedIds: pickedIds } : null;
    const currentId = (typeof window !== 'undefined' && window.MH_state) ? window.MH_state.currentPetId : null;
    const currentPets = currentId ? list.filter(p => p.id === currentId) : [];
    const otherPets = currentId ? list.filter(p => p.id !== currentId) : list;
    const tipsHtml = `
            <div class="card-flat mt-3 text-xs" style="color:var(--text-muted);background:#fffbeb">
                ${escapeHtml(t('petListTip'))}
            </div>`;
    panel.innerHTML = `
        <section class="mh-pet-list-view ${isPicker ? 'is-picker' : ''}" style="--mh-pet-picker-footer-height:${isPicker && multiple ? '62px' : '0px'}">
        <div class="topbar mh-pet-list-topbar">
            <button class="btn-icon" id="mhPetListBack" title="${escapeHtml(t('back'))}" style="width:36px;height:36px;font-size:18px">‹</button>
            <div class="mh-pet-list-title" aria-label="${escapeHtml(title || t('myPets'))}">
                <span style="font-size:22px">🐾</span>
                <span class="font-extrabold" style="color:var(--text-primary)">${escapeHtml(title || t('myPets'))}</span>
            </div>
            ${isPicker ? '<span style="width:36px;height:36px"></span>' : `<span class="font-bold mh-pet-list-wallet">${window.MH_state?.coins || 0}</span>`}
        </div>
        <div class="mh-pet-list-scroll">
          <div class="mh-pet-list-content">
            ${isPicker ? '' : `<div class="mh-pet-list-nav">${petListTabsHtml({ petCount: list.length, rareUnlockedCount, rareTotalCount: rareList.length })}</div>`}
            ${!isPicker && !isRareTab && typeof onResearchRelease === 'function' ? '<button class="mh-pet-research-release" data-research-release type="button" aria-label="一键研究放归重复 N / R 伙伴"></button>' : ''}
            ${isRareTab
                ? (Array.isArray(famousPetsIndex)
                    ? (rareList.length === 0
                        ? `<div class="card-flat text-center mh-pet-list-empty">${escapeHtml(t('rareEmpty'))}</div>`
                        : `${famousPetFilterTabsHtml(rareList)}${rareFilteredList.length === 0
                            ? `<div class="card-flat text-center mh-pet-list-empty">${escapeHtml(t('rareCategoryEmpty'))}</div>`
                            : `<div class="mh-rare-pet-list" id="mhRarePetList">${rareFilteredList.map(item => rarePetCardHtml(item, pets || [])).join('')}</div>`}`)
                    : `<div class="card-flat text-center mh-pet-list-empty">${escapeHtml(t('rareLoading'))}</div>`)
                : (list.length === 0
                ? `<div class="card-flat text-center mh-pet-list-empty">${escapeHtml(t('noPets'))}</div>`
                : `<div style="display:flex;flex-direction:column;gap:10px" id="mhPetList">
                    ${currentPets.map(p => petCardHtml(p, true, allowSelect, picker, false)).join('')}
                    ${isPicker ? '' : tipsHtml}
                    ${otherPets.map(p => petCardHtml(p, false, allowSelect, picker, typeof onDelete === 'function' && !isPicker)).join('')}
                </div>`)}
            ${!isPicker && !isRareTab && list.length === 0 ? tipsHtml : ''}
                    </div>
        </div>
        ${isPicker && multiple ? `<div class="absolute" style="left:0;right:0;bottom:0;padding:10px 14px max(12px,env(safe-area-inset-bottom));background:rgba(239,250,255,.95);border-top:1px solid rgba(125,211,252,.58);display:flex;gap:8px;align-items:center">
            <div data-picker-count style="flex:1;color:var(--text-muted);font-size:12px;font-weight:800">${escapeHtml(t('pickerSelectedCount', { count: pickedIds.size }))}</div>
            <button class="btn-primary" id="mhPetPickerConfirm" type="button">${escapeHtml(confirmText || '确定')}</button>
        </div>` : ''}
        </section>`;

    if (isRareTab) restoreFamousPetFilterScroll(panel);

    if ($('mhPetListBack')) $('mhPetListBack').onclick = () => onBack?.();
    const researchReleaseButton = panel.querySelector('[data-research-release]');
    if (researchReleaseButton) researchReleaseButton.onclick = () => onResearchRelease?.();
    $$('[data-pet-list-tab]', panel).forEach(el => {
        el.onclick = () => {
            const next = el.dataset.petListTab || 'mine';
            if (activePetListTab === next) return;
            activePetListTab = next;
            renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        };
    });

    if (!isPicker && !Array.isArray(famousPetsIndex)) {
        loadFamousPetsIndex().then(() => {
            if (panel?.isConnected) renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        });
    }

    if (isRareTab && needsFamousPetFilterMetadata(famousPetsIndex) && !famousPetsFilterMetadataPromise) {
        loadFamousPetFilterMetadata().then(() => {
            if (panel?.isConnected) renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        });
    }

    $$('[data-famous-pet-filter]', panel).forEach(el => {
        el.onclick = () => {
            const next = el.dataset.famousPetFilter || 'all';
            if (activeFamousPetFilter === next) return;
            activeFamousPetFilter = FAMOUS_PET_FILTERS.some(filter => filter.id === next) ? next : 'all';
            renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText });
        };
    });

    $$('#mhRarePetList [data-rare-pet-id]', panel).forEach(el => {
        el.onclick = () => {
            const entry = rareList.find(item => item.id === el.dataset.rarePetId);
            if (entry) openRarePetModal(entry, pets || [], () => renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText }));
        };
    });

    const petById = new Map((pets || []).map(p => [p?.id, p]));
    const updatePickerCardState = (el, picked) => {
        el.classList.toggle('mh-pet-card-picked', picked);
        el.style.boxShadow = picked ? '0 0 0 2px var(--accent) inset' : '';
        const badge = el.querySelector('[data-picker-state]');
        if (badge) {
            badge.textContent = picked ? t('pickerSelected') : t('pickerSelect');
            badge.style.background = picked ? 'var(--accent)' : '#effaff';
            badge.style.color = picked ? '#fff' : 'var(--text-secondary)';
        }
        const count = panel.querySelector('[data-picker-count]');
        if (count) count.textContent = t('pickerSelectedCount', { count: pickedIds.size });
    };
    const bindPetCardEvents = (el) => {
        el.onclick = (e) => {
            if (e.target.closest('[data-find]')) return;
            if (e.target.closest('[data-album]')) return;
            if (e.target.closest('[data-pet-rename]')) return;
            if (e.target.closest('[data-delete-pet]')) return;
            if (el.dataset.selectable !== '1') return;
            const id = el.dataset.petId;
            if (isPicker) {
                if (multiple) {
                    const picked = !pickedIds.has(id);
                    if (picked) pickedIds.add(id);
                    else pickedIds.delete(id);
                    updatePickerCardState(el, picked);
                } else {
                    onSelect?.(id);
                    onConfirm?.([id]);
                }
                return;
            }
            onSelect?.(id);
        };
        const findButton = el.querySelector('[data-find]');
        if (findButton) findButton.onclick = async (e) => {
            e.stopPropagation();
            const petId = findButton.dataset.find;
            // VIP：按钮文案为「切换」，直接切换当前宠物。
            if (state.isPaid) {
                if (petId === state.currentPetId) {
                    showToast(t('vipSwitchAlreadyCurrent'), 'info', 1200);
                    return;
                }
                onSelect?.(petId);
                return;
            }
            // 非 VIP：弹窗说明不能切换，可寻找，或去开通会员。
            const choice = await showVipGateDialog({
                title: t('vipGateTitle'),
                message: t('vipGateMessage'),
                primaryText: t('vipGateBecomeMember'),
                secondaryText: t('vipGateFindInstead'),
            });
            if (choice === 'secondary') onFind?.(petId);
            else if (choice === 'vip') onBecomeMember?.();
        };
        const albumButton = el.querySelector('[data-album]');
        if (albumButton) albumButton.onclick = (e) => {
            e.stopPropagation();
            const pet = petById.get(albumButton.dataset.album);
            if (pet) openMemoryAlbum(pet);
        };
        const statsButton = el.querySelector('[data-pet-stats]');
        if (statsButton) statsButton.onclick = (e) => {
            e.stopPropagation();
            const pet = petById.get(statsButton.dataset.petStats);
            if (pet) {
                openPetStatsModal(pet);
                onInspectPetStats?.(pet);
            }
        };
        const renameButton = el.querySelector('[data-pet-rename]');
        if (renameButton) renameButton.onclick = async (e) => {
            e.stopPropagation();
            const pet = petById.get(renameButton.dataset.petRename);
            if (pet) await renamePet(pet, () => renderPetList(panel, { pets }, { onSelect, onBack, onFind, onDelete, onResearchRelease, onLoadPet, onBecomeMember, onInspectPetStats, onFirstPetRenamed, allowSelect, pickerMode, multiple, selectedIds: [...pickedIds], onConfirm, title, confirmText }), onFirstPetRenamed);
        };
        const deleteButton = el.querySelector('[data-delete-pet]');
        if (deleteButton) deleteButton.onclick = (e) => {
            e.stopPropagation();
            onDelete?.(deleteButton.dataset.deletePet);
        };
    };
    $$('#mhPetList [data-pet-id]').forEach(bindPetCardEvents);
    if ($('mhPetPickerConfirm')) $('mhPetPickerConfirm').onclick = () => onConfirm?.([...pickedIds]);
    setupLazyRawPetImages(panel);
    setupLazyPetCards(panel, onLoadPet, {
        renderLoadedCard: (loadedPet) => petCardHtml(
            loadedPet,
            loadedPet?.id === currentId,
            allowSelect,
            picker,
            typeof onDelete === 'function' && !isPicker && loadedPet?.id !== currentId,
        ),
        onCardReady: (el, loadedPet) => {
            if (loadedPet?.id) petById.set(loadedPet.id, loadedPet);
            bindPetCardEvents(el);
        },
    });
}
