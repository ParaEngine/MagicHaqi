// 宠物档案视图
import { $, escapeHtml, formatTime } from './utils.js';
import { t } from './i18n.js';
import { formatDna, displayPetName, isAdultStage } from './dna.js';
import { petArtHtml } from './pet.js';
import { loadPetMemory } from './storage.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { dominantTraits } from './petTick.js';

export function renderProfile(panel, { pet }, { onBack } = {}) {
    if (!pet) return;
    const evolvedTraits = dominantTraits(pet, 3);
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">📋 ${escapeHtml(t('profile'))}</span>
            <span style="width:36px"></span>
        </div>
        <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:14px">
            <div class="card-flat fade-in" style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
                <div style="width:96px;height:96px;border-radius:18px;overflow:hidden;background:var(--bg-pill);flex-shrink:0">
                    ${petArtHtml(pet, { alt: displayPetName(pet) })}
                </div>
                <div style="flex:1;min-width:0">
                    <div class="text-lg font-extrabold" style="color:var(--text-primary)">${escapeHtml(displayPetName(pet))}${isAdultStage(pet.stage) ? '' : ' <span style=\'font-size:11px;color:var(--text-muted);font-weight:600\'>（未成年，名字未知）</span>'}</div>
                    <div class="text-xs mt-1" style="color:var(--text-muted)">${escapeHtml(t('stage'))}：<b style="color:var(--accent-dark)">${pet.stageEmoji || ''} ${escapeHtml(pet.stageName || pet.stage || '')}</b></div>
                    <div class="text-xs mt-1" style="color:var(--text-muted)">${escapeHtml(t('bornAt'))}：${formatTime(pet.bornAt)}</div>
                    <div class="text-xs mt-1" style="color:var(--text-muted)">稀有度：<b style="color:var(--accent-dark)">${pet.rarity ?? '?'}</b></div>
                </div>
            </div>

            <div class="card-flat mb-3">
                <div class="text-xs font-bold mb-1" style="color:var(--text-secondary)">${escapeHtml(t('dnaCode'))}</div>
                <div class="font-mono font-bold text-base" style="color:var(--accent-dark);letter-spacing:2px">${escapeHtml(formatDna(pet.dna || ''))}</div>
                ${pet.traits ? (isAdultStage(pet.stage) ? `
                    <div class="grid grid-cols-2 gap-1 mt-3 text-xs" style="color:var(--text-secondary)">
                        <div>血统：<b>${escapeHtml(pet.traits.element || '?')}族</b></div>
                        <div>元素：<b>${escapeHtml(pet.traits.elementalAttribute || '自然')}</b></div>
                        <div>种类：<b>${escapeHtml(pet.traits.species || '?')}</b></div>
                        <div>毛色：<b>${escapeHtml(pet.traits.color || '?')}</b></div>
                        <div>眼睛：<b>${escapeHtml(pet.traits.eyes || '?')}</b></div>
                        <div>装扮：<b>${escapeHtml(pet.traits.accessory || '?')}</b></div>
                    </div>
                ` : `
                    <div class="grid grid-cols-2 gap-1 mt-3 text-xs" style="color:var(--text-muted)">
                        <div>血统：<b>${escapeHtml(pet.traits.element || '?')}族</b></div>
                        <div>元素：<b>${escapeHtml(pet.traits.elementalAttribute || '自然')}</b></div>
                        <div>种类：<b>？？？</b></div>
                        <div>毛色：<b>？？？</b></div>
                        <div>眼睛：<b>？？？</b></div>
                        <div>装扮：<b>？？？</b></div>
                    </div>
                    <div class="text-xs mt-2" style="color:var(--text-muted);font-style:italic">🔒 成年后才会显露真实特征～（血统已知）</div>
                `) : ''}
                ${pet.parents ? `<div class="text-xs mt-2" style="color:var(--text-muted)">父母：${pet.parents.map(pid => { const pp = state.pets[pid]; return pp ? displayPetName(pp) : pid.slice(-4); }).join(' × ')}</div>` : ''}
                <div class="text-xs font-bold mt-3 mb-1" style="color:var(--text-secondary)">成长特征</div>
                ${evolvedTraits.length ? `
                    <div style="display:flex;flex-wrap:wrap;gap:6px">
                        ${evolvedTraits.map(tr => tr.def ? `
                            <span class="trait-badge" title="${escapeHtml(tr.def.name)} ${tr.value | 0}/${CONFIG.traitMax}">
                                ${tr.def.emoji}<span>${escapeHtml(tr.def.name)}</span><i>${tr.value | 0}</i>
                            </span>` : '').join('')}
                    </div>
                ` : `<div class="text-xs" style="color:var(--text-muted)">暂无成长特征</div>`}
            </div>

            <div class="card-flat">
                <div class="text-xs font-bold mb-2" style="color:var(--text-secondary)">📝 ${escapeHtml(t('memory'))}</div>
                <pre id="mhMemoryBox" style="font-size:12px;color:var(--text-secondary);white-space:pre-wrap;word-wrap:break-word;max-height:240px;overflow-y:auto;font-family:inherit">${escapeHtml(t('loading'))}</pre>
            </div>
        </div>`;
    if ($('mhBack')) $('mhBack').onclick = () => onBack?.();
    loadPetMemory(pet.id).then(text => {
        const box = $('mhMemoryBox');
        if (box) box.textContent = (text && text.trim()) ? text : t('noMemory');
    }).catch(() => {
        const box = $('mhMemoryBox');
        if (box) box.textContent = t('noMemory');
    });
}
