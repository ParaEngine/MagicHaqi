// 孵化仓：离线照看与领养新蛋。
import { $, escapeHtml } from './utils.js';
import { displayPetName } from './dna.js';
import { CONFIG, getStageName } from './config.js';
import { computePlanetProgress } from './planetProgress.js';
import { state } from './state.js';
import {
    formatNannyCareRemaining,
    getCompanionDays,
    getNannyCareCost,
    getNannyCareEligibility,
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
                        <span class="stage-badge">${escapeHtml(getStageName(pet?.stage, '蛋'))}</span>
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
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:900;color:var(--text-primary);margin-bottom:4px">保姆照看</div>
                        <div style="font-size:12px;color:var(--text-muted);line-height:1.45">
                            ${nannyActive ? `剩余 ${escapeHtml(formatNannyCareRemaining(pet))}` : '离线时维持基础心情和体力'}
                        </div>
                    </div>
                    <span style="font-size:24px">🧸</span>
                </div>
                <button class="btn-primary w-full" id="mhHireNanny" ${!pet || nannyActive ? 'disabled' : ''}>${nannyActive ? '保姆正在照看' : '雇佣保姆'}</button>
            </section>

            <section class="card-flat" style="background:#fffbeb;border-color:rgba(245,158,11,.24)">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:900;color:var(--text-primary);margin-bottom:4px">领养新蛋</div>
                        <div style="font-size:12px;color:var(--text-muted);line-height:1.45">迎接新的伙伴</div>
                    </div>
                    <span style="font-size:24px">🥚</span>
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
    if ($('mhHireNanny')) $('mhHireNanny').onclick = () => showNannyCareModal(pet, onHireNanny);
    if ($('mhAdoptEgg')) $('mhAdoptEgg').onclick = () => showAdoptEggModal(pet, onAdoptEgg);
    if ($('mhBreedBaby')) $('mhBreedBaby').onclick = () => onBreed?.();
}

function showAdoptEggModal(pet, onAdoptEgg) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card" style="width:min(420px, calc(100vw - 32px))">
            <div style="font-size:18px;font-weight:900;color:var(--text-primary);margin-bottom:6px">领养新蛋</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:14px">
                可以领养一个新的蛋。当前正在照看的宠物会被放养到星球中，放养后无法找回，但会继续在星球上长大，成年后可送往哈奇岛。
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
                <button class="btn-secondary" data-adopt-cancel>取消</button>
                <button class="btn-primary" data-adopt-ok>继续领养</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest('[data-adopt-cancel]')) { close(); return; }
        if (!e.target.closest('[data-adopt-ok]')) return;
        close();
        onAdoptEgg?.(pet);
    });
    document.body.appendChild(mask);
}

function showNannyCareModal(pet, onHireNanny) {
    const maxDays = Math.max(1, Number(CONFIG.hatchingCare?.maxDays) || 2);
    const costPerDay = Math.max(0, Number(CONFIG.hatchingCare?.costPerDay) || 100);
    const options = Array.from({ length: maxDays }, (_, index) => index + 1);
    const eligibility = getNannyCareEligibility(pet);
    const active = hasNannyCare(pet);
    const statusText = !pet
        ? '暂无可照看的宠物。'
        : active
            ? `保姆正在照看，剩余 ${formatNannyCareRemaining(pet)}。`
            : eligibility.ok
                ? '当前状态满足托管条件。'
                : eligibility.reasons.join('；');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card" style="width:min(420px, calc(100vw - 32px))">
            <div style="font-size:18px;font-weight:900;color:var(--text-primary);margin-bottom:6px">雇佣保姆</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:12px">
                每天 ${costPerDay} 金币，最多 ${maxDays} 天。保姆只维持平均心情和体力。
            </div>
            <div style="font-size:12px;color:${eligibility.ok && !active ? 'var(--accent-dark)' : '#b45309'};line-height:1.45;margin-bottom:12px">
                ${escapeHtml(statusText)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(${Math.min(2, options.length)}, minmax(0,1fr));gap:8px;margin-bottom:12px">
                ${options.map(days => {
                    const cost = getNannyCareCost(days);
                    const canAfford = (state.coins | 0) >= cost;
                    const disabled = !pet || active || !eligibility.ok || !canAfford;
                    const title = !canAfford ? `金币不足，需要 ${cost} 金币` : `支付 ${cost} 金币`;
                    return `<button class="btn-primary" data-hire-nanny-days="${days}" ${disabled ? 'disabled' : ''} title="${escapeHtml(title)}">
                        ${days}天 · ${cost}金币
                    </button>`;
                }).join('')}
            </div>
            <div style="display:flex;justify-content:flex-end">
                <button class="btn-secondary" data-nanny-cancel>取消</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest('[data-nanny-cancel]')) { close(); return; }
        const btn = e.target.closest('[data-hire-nanny-days]');
        if (!btn || btn.disabled) return;
        const days = Number(btn.dataset.hireNannyDays) || 1;
        close();
        onHireNanny?.(pet, days);
    });
    document.body.appendChild(mask);
}
