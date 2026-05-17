// 孵化仓：离线照看与领养新蛋。
import { $, escapeHtml } from './utils.js';
import { displayPetName } from './dna.js';
import { CONFIG } from './config.js';
import { computePlanetProgress } from './planetProgress.js';
import {
    getCompanionDays,
    getPetBirthday,
    getPetLocationInfo,
    getPlanetPetLimit,
    hasNannyCare,
    localPlanetPets,
} from './petLifecycle.js';
import { petArtHtml } from './pet.js';

export function renderHatching(panel, { pet, pets = [], planetName = '' } = {}, { onBack, onHireNanny, onAdoptEgg, onOpenAlbum, onBreed } = {}) {
    const progress = computePlanetProgress();
    const localPets = localPlanetPets(pets);
    const breedReadyCount = pets.filter(p => p && CONFIG.breedableStages.includes(p.stage)).length;
    const breedReady = breedReadyCount >= 2;
    const limit = getPlanetPetLimit();
    const location = getPetLocationInfo(pet, planetName || '宠物星');
    const nannyActive = hasNannyCare(pet);
    const isEgg = pet?.stage === 'egg';
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhHatchingBack" title="返回" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">孵化仓</span>
            <button class="btn-secondary" id="mhHatchingAlbum" style="height:32px;padding:0 10px;font-size:12px">画册</button>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px;background:linear-gradient(180deg,#fff7ed 0%,#ecfeff 54%,#f0fdf4 100%)">
            <section class="card-flat" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
                <div style="width:86px;height:86px;border-radius:16px;background:var(--bg-pill);overflow:hidden;flex-shrink:0">
                    ${pet ? petArtHtml(pet, { alt: displayPetName(pet) }) : '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:38px">🥚</div>'}
                </div>
                <div style="min-width:0;flex:1">
                    <div style="font-size:18px;font-weight:900;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(pet ? displayPetName(pet) : '等待新伙伴')}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">
                        <span class="stage-badge">${escapeHtml(pet?.stageEmoji || '🥚')} ${escapeHtml(pet?.stageName || '蛋')}</span>
                        <span class="stage-badge" style="background:#ecfeff;color:${escapeHtml(location.tone)}">${escapeHtml(location.label)}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
                        ${pet ? `生日 ${escapeHtml(getPetBirthday(pet))} · 陪伴第 ${getCompanionDays(pet)} 天` : '领养一颗新的蛋后会出现在这里'}
                    </div>
                </div>
            </section>

            <section class="card-flat" style="margin-bottom:12px;background:#fff">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px">
                    <div>
                        <div style="font-weight:900;color:var(--text-primary)">星球容量</div>
                        <div style="font-size:12px;color:var(--text-muted)">星球 Lv.${progress.level || 1} · 本星球 ${localPets.length}/${limit} 只</div>
                    </div>
                    <span style="font-size:24px">🪐</span>
                </div>
                <div class="stat-bar" style="height:10px"><div style="width:${Math.min(100, Math.round(localPets.length / limit * 100))}%;background:#22c55e"></div></div>
            </section>

            <section class="card-flat" style="margin-bottom:12px">
                <div style="font-weight:900;color:var(--text-primary);margin-bottom:6px">保姆照看</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:10px">
                    不常在线时可以雇佣保姆照看宠物。保姆会维持基础状态，但成长节奏更慢，成长后的属性会更平均。
                </div>
                <button class="btn-primary w-full" id="mhHireNanny" ${!pet || nannyActive ? 'disabled' : ''}>
                    ${nannyActive ? '✓ 保姆正在照看' : (isEgg ? '雇佣保姆照看这颗蛋' : '雇佣保姆照看宠物')}
                </button>
            </section>

            <section class="card-flat" style="background:#fffbeb;border-color:rgba(245,158,11,.24)">
                <div style="font-weight:900;color:var(--text-primary);margin-bottom:6px">领养新蛋</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:10px">
                    可以领养一个新的蛋。当前正在照看的宠物会被放养到 Field，放养后无法找回，但会继续在星球上长大，成年后可送往哈奇岛。
                </div>
                <button class="btn-primary w-full" id="mhAdoptEgg">领养一个新的蛋</button>
            </section>

            <section class="card-flat" style="margin-top:12px;background:#fff;border-color:rgba(236,72,153,.24)">
                <div style="font-weight:900;color:var(--text-primary);margin-bottom:6px">繁殖宝宝</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:10px">
                    选择两只成年宠物组合 DNA，生成一只新的宝宝。需要 ${CONFIG.breedCost} 金币。
                </div>
                <button class="btn-secondary w-full" id="mhBreedBaby" ${breedReady ? '' : 'disabled'}>💕 繁殖宝宝</button>
            </section>
        </div>`;

    if ($('mhHatchingBack')) $('mhHatchingBack').onclick = () => onBack?.();
    if ($('mhHatchingAlbum')) $('mhHatchingAlbum').onclick = () => onOpenAlbum?.();
    if ($('mhHireNanny')) $('mhHireNanny').onclick = () => onHireNanny?.(pet);
    if ($('mhAdoptEgg')) $('mhAdoptEgg').onclick = () => onAdoptEgg?.(pet);
    if ($('mhBreedBaby')) $('mhBreedBaby').onclick = () => onBreed?.();
}
