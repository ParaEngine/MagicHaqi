// 孵化仓：离线照看与领养新蛋。
import { $, dockDisabledAttrs, escapeHtml, isDockButtonDisabled, showDockDisabledToast } from './utils.js';
import { t } from './i18n.js';
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
    const breedReadyCount = localPets.filter(p => p && CONFIG.breedableStages.includes(p.stage)).length;
    const breedReady = breedReadyCount >= 2;
    const limit = getPlanetPetLimit();
    const location = getPetLocationInfo(pet, planetName || t('planetFallback'));
    const nannyActive = hasNannyCare(pet);
    const hireNannyDisabled = !pet || nannyActive;
    const hireNannyDisabledReason = !pet ? t('nannyNoPet') : t('nannyBusy');
    const breedDisabledReason = t('breedDisabledReason', { stages: CONFIG.breedableStages.map(stage => getStageName(stage)).join(t('stageSeparator')), count: breedReadyCount });
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhHatchingBack" title="${escapeHtml(t('back'))}" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t('hatchPod'))}</span>
            <button class="btn-secondary" id="mhHatchingAlbum" style="height:32px;padding:0 10px;font-size:12px">${escapeHtml(t('album'))}</button>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px;background:linear-gradient(180deg,#fff7ed 0%,#ecfeff 54%,#f0fdf4 100%)">
            <section class="card-flat" style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
                <div style="width:86px;height:86px;border-radius:16px;background:var(--bg-pill);overflow:hidden;flex-shrink:0">
                    ${pet ? petArtHtml(pet, { alt: displayPetName(pet) }) : '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:38px">🥚</div>'}
                </div>
                <div style="min-width:0;flex:1">
                    <div style="font-size:18px;font-weight:900;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(pet ? displayPetName(pet) : t('waitNewFriend'))}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">
                        <span class="stage-badge">${escapeHtml(getStageName(pet?.stage, t('eggBadge')))}</span>
                        <span class="stage-badge" style="background:#ecfeff;color:${escapeHtml(location.tone)}">${escapeHtml(location.label)}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
                        ${pet ? escapeHtml(t('birthdayDays', { date: getPetBirthday(pet), days: getCompanionDays(pet) })) : escapeHtml(t('adoptHereHint'))}
                    </div>
                </div>
            </section>

            <section class="card-flat" style="margin-bottom:12px;background:#fff">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px">
                    <div>
                        <div style="font-weight:900;color:var(--text-primary)">${escapeHtml(t('planetCapacity'))}</div>
                        <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(t('planetCapacityInfo', { level: progress.level || 1, count: localPets.length, limit }))}</div>
                    </div>
                    <span style="font-size:24px">🪐</span>
                </div>
                <div class="stat-bar" style="height:10px"><div style="width:${Math.min(100, Math.round(localPets.length / limit * 100))}%;background:#22c55e"></div></div>
            </section>

            <section class="card-flat" style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:900;color:var(--text-primary);margin-bottom:4px">${escapeHtml(t('nannyCare'))}</div>
                        <div style="font-size:12px;color:var(--text-muted);line-height:1.45">
                            ${nannyActive ? escapeHtml(t('nannyRemaining', { remaining: formatNannyCareRemaining(pet) })) : escapeHtml(t('nannyCareDesc'))}
                        </div>
                    </div>
                    <span style="font-size:24px">🧸</span>
                </div>
                <button class="btn-primary w-full" id="mhHireNanny"${dockDisabledAttrs(hireNannyDisabled, hireNannyDisabledReason)}>${nannyActive ? escapeHtml(t('nannyWorking')) : escapeHtml(t('hireNanny'))}</button>
            </section>

            <section class="card-flat" style="background:#fffbeb;border-color:rgba(245,158,11,.24)">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:900;color:var(--text-primary);margin-bottom:4px">${escapeHtml(t('adoptNewEgg'))}</div>
                        <div style="font-size:12px;color:var(--text-muted);line-height:1.45">${escapeHtml(t('welcomeNewFriend'))}</div>
                    </div>
                    <span style="font-size:24px">🥚</span>
                </div>
                <button class="btn-primary w-full" id="mhAdoptEgg">${escapeHtml(t('adoptOneEgg'))}</button>
            </section>

            <section class="card-flat" style="margin-top:12px;background:#fff;border-color:rgba(236,72,153,.24)">
                <div style="font-weight:900;color:var(--text-primary);margin-bottom:6px">${escapeHtml(t('breedBaby'))}</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:10px">
                    ${escapeHtml(t('breedBabyDesc'))}
                </div>
                <button class="btn-secondary w-full" id="mhBreedBaby"${dockDisabledAttrs(!breedReady, breedDisabledReason)}>${escapeHtml(t('breedBabyBtn'))}</button>
            </section>
        </div>`;

    if ($('mhHatchingBack')) $('mhHatchingBack').onclick = () => onBack?.();
    if ($('mhHatchingAlbum')) $('mhHatchingAlbum').onclick = () => onOpenAlbum?.();
    if ($('mhHireNanny')) $('mhHireNanny').onclick = () => isDockButtonDisabled($('mhHireNanny')) ? showDockDisabledToast($('mhHireNanny')) : showNannyCareModal(pet, onHireNanny);
    if ($('mhAdoptEgg')) $('mhAdoptEgg').onclick = () => showAdoptEggModal(pet, onAdoptEgg);
    if ($('mhBreedBaby')) $('mhBreedBaby').onclick = () => isDockButtonDisabled($('mhBreedBaby')) ? showDockDisabledToast($('mhBreedBaby')) : onBreed?.();
}

function showAdoptEggModal(pet, onAdoptEgg) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card" style="width:min(420px, calc(100vw - 32px))">
            <div style="font-size:18px;font-weight:900;color:var(--text-primary);margin-bottom:6px">${escapeHtml(t('adoptNewEgg'))}</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:14px">
                ${escapeHtml(t('adoptConfirm'))}
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
                <button class="btn-secondary" data-adopt-cancel>${escapeHtml(t('cancel'))}</button>
                <button class="btn-primary" data-adopt-ok>${escapeHtml(t('continueAdopt'))}</button>
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
        ? t('nannyNoPetShort')
        : active
            ? t('nannyActiveRemaining', { remaining: formatNannyCareRemaining(pet) })
            : eligibility.ok
                ? t('nannyEligible')
                : eligibility.reasons.join(t('reasonSeparator'));
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card" style="width:min(420px, calc(100vw - 32px))">
            <div style="font-size:18px;font-weight:900;color:var(--text-primary);margin-bottom:6px">${escapeHtml(t('hireNanny'))}</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;margin-bottom:12px">
                ${escapeHtml(t('nannyCostInfo', { cost: costPerDay, maxDays }))}
            </div>
            <div style="font-size:12px;color:${eligibility.ok && !active ? 'var(--accent-dark)' : '#b45309'};line-height:1.45;margin-bottom:12px">
                ${escapeHtml(statusText)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(${Math.min(2, options.length)}, minmax(0,1fr));gap:8px;margin-bottom:12px">
                ${options.map(days => {
                    const cost = getNannyCareCost(days);
                    const canAfford = (state.coins | 0) >= cost;
                    const disabled = !pet || active || !eligibility.ok || !canAfford;
                    const title = !pet ? t('nannyNoPet') : active ? t('nannyWorking') : !eligibility.ok ? eligibility.reasons.join(t('reasonSeparator')) : !canAfford ? t('nannyNotEnough', { cost }) : t('nannyPay', { cost });
                    return `<button class="btn-primary" data-hire-nanny-days="${days}"${dockDisabledAttrs(disabled, title)} title="${escapeHtml(title)}">
                        ${escapeHtml(t('nannyDaysCost', { days, cost }))}
                    </button>`;
                }).join('')}
            </div>
            <div style="display:flex;justify-content:flex-end">
                <button class="btn-secondary" data-nanny-cancel>${escapeHtml(t('cancel'))}</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest('[data-nanny-cancel]')) { close(); return; }
        const btn = e.target.closest('[data-hire-nanny-days]');
        if (!btn) return;
        if (isDockButtonDisabled(btn)) { showDockDisabledToast(btn); return; }
        const days = Number(btn.dataset.hireNannyDays) || 1;
        close();
        onHireNanny?.(pet, days);
    });
    document.body.appendChild(mask);
}
