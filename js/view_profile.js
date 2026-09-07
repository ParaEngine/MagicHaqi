// 宠物档案视图
import { $, escapeHtml, formatTime } from './utils.js';
import { t } from './i18n.js';
import { formatDna, displayPetName, isAdultStage } from './dna.js';
import { petArtHtml } from './pet.js';
import { loadPetMemory } from './storage.js';
import { state } from './state.js';
import { CONFIG, getStageName } from './config.js';
import { dominantTraits, getActiveSickness, getEffectiveSicknessSeverity, sicknessLabel, sicknessName } from './petTick.js';

export function renderProfile(panel, { pet }, { onBack } = {}) {
    if (!pet) return;
    const evolvedTraits = dominantTraits(pet, 3);
    const sickness = getActiveSickness(pet);
    const sicknessSeverity = getEffectiveSicknessSeverity(pet);
    const lifeStats = pet.lifeStats || {
        energy: pet.stats?.hunger,
        mood: pet.stats?.mood,
        clean: pet.stats?.clean,
        bond: pet.stats?.bond,
    };
    const careStats = [
        ['精力', lifeStats.energy, '#75c85a'],
        ['心情', lifeStats.mood, '#f19a54'],
        ['清洁', lifeStats.clean, '#55a9dc'],
        ['羁绊', lifeStats.bond, '#e8799f'],
    ].map(([label, rawValue, color]) => {
        const value = Math.max(0, Math.min(100, Math.round(Number(rawValue) || 0)));
        return `<div class="mh-profile-care-stat"><span>${label}</span><i><b style="width:${value}%;background:${color}"></b></i><strong>${value}</strong></div>`;
    }).join('');
    panel.innerHTML = `
        <style>
            .mh-profile-view { position:absolute;inset:0;overflow:hidden;background:#8ed5e4 url('https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/expedition-backgrounds/star-map-background.webp') center / cover no-repeat }
            .mh-profile-back { width:64px;height:64px;padding:0;border:0;background:transparent;box-shadow:none;overflow:visible }
            .mh-profile-back img { display:block;width:100%;height:100%;object-fit:contain;pointer-events:none }
            .mh-profile-content { --profile-stack-gap:8px;--profile-align-nudge:.52px;container-type:size;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);height:100%;min-height:0;gap:12px;align-items:center }
            .mh-profile-left-column { display:flex;flex-direction:column;justify-content:center;align-items:center;gap:var(--profile-stack-gap);height:100%;min-height:0 }
            .mh-profile-left { position:relative;width:min(100%, calc((100cqh - var(--profile-stack-gap)) * 1.0588235294));max-width:720px;aspect-ratio:720/445;flex:none }
            .mh-profile-frame { position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none }
            .mh-profile-pet-art { position:absolute;left:6.5%;top:19%;width:40%;height:64%;overflow:hidden }
            .mh-profile-pet-art > * { width:100%;height:100%;object-fit:contain }
            .mh-profile-name { position:absolute;left:59%;right:7%;top:8%;height:17%;display:flex;align-items:flex-start;justify-content:center;flex-direction:column;min-width:0;overflow:hidden }
            .mh-profile-name > div { overflow:hidden;text-overflow:ellipsis }
            .mh-profile-name .text-lg { width:100%;font-size:20px;line-height:1.05;white-space:nowrap }
            .mh-profile-name-subtitle { display:block;font-size:11px;color:var(--text-muted);font-weight:600;line-height:1.1;white-space:nowrap }
            .mh-profile-basic { position:absolute;left:48%;right:7%;top:30%;bottom:19%;display:grid;grid-template-rows:repeat(3,1fr);align-items:center;min-width:0 }
            .mh-profile-basic .text-xs { font-size:15px;line-height:1.25 }
            .mh-profile-care { position:relative;width:min(100%, calc((100cqh - var(--profile-stack-gap)) * 1.0588235294));max-width:720px;aspect-ratio:720/235;flex:none }
            .mh-profile-care-title { position:absolute;left:13%;top:8%;width:18%;height:28%;display:flex;align-items:center;justify-content:center;color:#385f9d;font-size:18px;font-weight:800;text-align:center;white-space:nowrap }
            .mh-profile-care-body { position:absolute;left:34%;right:7%;top:30%;bottom:20%;display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;align-content:center }
            .mh-profile-care-stat { display:grid;grid-template-columns:42px minmax(0,1fr) 31px;gap:8px;align-items:center;color:#466a9b;font-size:16px;line-height:1.1;font-weight:700 }
            .mh-profile-care-stat i { height:11px;border-radius:6px;background:#dce9f2;overflow:hidden;box-shadow:inset 0 1px 2px #9fb7ca }
            .mh-profile-care-stat b { display:block;height:100%;border-radius:inherit }
            .mh-profile-care-stat strong { font-size:15px;line-height:1.1;text-align:right;color:#557394 }
            .mh-profile-right { display:flex;flex-direction:column;justify-content:center;gap:var(--profile-stack-gap);width:min(calc(69.7127329193% - var(--profile-stack-gap) * .7639751553), calc(100cqh * .7381348191 - var(--profile-stack-gap) * 1.5021099744));margin:auto;min-height:0;transform:translateY(calc(min(calc(.3813533835% - var(--profile-stack-gap) * .0073401535), calc(100cqh * .0054767994 - var(--profile-stack-gap) * .0073401535)) + var(--profile-align-nudge))) }
            .mh-profile-info { position:relative;width:100%;aspect-ratio:615/267;flex:none }
            [data-profile-panel="dna"] { aspect-ratio:615/277 }
            [data-profile-panel="memory"] { aspect-ratio:615/274 }
            .mh-profile-info-frame { position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none }
            .mh-profile-info-title { position:absolute;left:6%;top:6%;width:28%;height:23%;display:flex;align-items:center;justify-content:center;color:#385f9d;font-size:16px;line-height:1.1;font-weight:800;text-align:center }
            [data-profile-panel="body"] .mh-profile-info-title, [data-profile-panel="dna"] .mh-profile-info-title { left:13%;width:21%;white-space:nowrap }
            .mh-profile-info-body { position:absolute;left:8%;right:8%;top:37%;bottom:11%;overflow:hidden;padding:0 4px }
            .mh-profile-info-text { font-size:15px;line-height:1.25;color:var(--text-secondary) }
            .mh-profile-dna-code { position:absolute;left:37%;right:7%;top:10%;height:23%;display:flex;align-items:center;color:var(--accent-dark);font-size:15px;line-height:1.1;font-weight:800;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
            [data-profile-panel="dna"] .mh-profile-info-body { font-size:13px;line-height:1.12 }
            [data-profile-panel="dna"] .mh-profile-info-body .text-xs { font-size:11px;line-height:1.05 }
            [data-profile-panel="dna"] .mh-profile-info-body .mt-3 { margin-top:4px }
            [data-profile-panel="dna"] .mh-profile-info-body .mt-2, [data-profile-panel="dna"] .mh-profile-info-body .mt-1 { margin-top:2px }
            [data-profile-panel="dna"] .mh-profile-info-body .mb-1 { margin-bottom:2px }
            [data-profile-panel="dna"] .mh-profile-info-body { top:36%;bottom:0 }
            .mh-profile-dna-secondary { white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
            .mh-profile-traits-grid { grid-template-columns:repeat(3,minmax(0,1fr)) }
            @media (max-width:700px) {
                .mh-profile-content { --profile-stack-gap:4px;--profile-align-nudge:.235px;gap:4px }
                .mh-profile-left-column { gap:var(--profile-stack-gap) }
                .mh-profile-name { left:59%;right:5%;top:7%;height:19% }
                .mh-profile-name .text-lg { font-size:13px }
                .mh-profile-name-subtitle { font-size:8px }
                .mh-profile-basic { left:47%;right:6%;top:29%;bottom:18% }
                .mh-profile-care-title { left:13%;top:7%;width:19%;height:29%;font-size:11px }
                .mh-profile-care-body { left:33%;right:6%;top:27%;bottom:17%;gap:3px 7px }
                .mh-profile-care-stat { grid-template-columns:22px minmax(0,1fr) 16px;gap:2px;font-size:11px }
                .mh-profile-care-stat i { height:7px }
                .mh-profile-care-stat strong { font-size:9px }
                .mh-profile-basic .text-xs, .mh-profile-info-text, .mh-profile-info-body .text-xs { font-size:11px;line-height:1.15 }
                .mh-profile-right { gap:var(--profile-stack-gap) }
                .mh-profile-info-body { left:7%;right:6%;top:28%;bottom:0;padding:0 2px }
                .mh-profile-info-body .text-sm { font-size:11px;line-height:1.05 }
                .mh-profile-info-title { left:4%;top:5%;width:32%;height:24%;font-size:11px;line-height:1 }
                [data-profile-panel="body"] .mh-profile-info-title, [data-profile-panel="dna"] .mh-profile-info-title { left:13%;width:23% }
                .mh-profile-dna-code { left:37%;right:5%;top:6%;height:29%;align-content:center;font-size:8px;line-height:1;white-space:normal;overflow-wrap:anywhere;letter-spacing:0 }
                [data-profile-panel="dna"] .mh-profile-info-body, [data-profile-panel="dna"] .mh-profile-info-body .text-xs { font-size:9px;line-height:1.02 }
                [data-profile-panel="dna"] .mh-profile-info-body { top:32%;bottom:-4% }
                [data-profile-panel="dna"] .mh-profile-traits-grid { grid-template-columns:repeat(3,minmax(0,1fr));margin-top:0 }
                .mh-profile-dna-secondary { display:none }
                [data-profile-panel="dna"] .mh-profile-info-body .mt-3, [data-profile-panel="dna"] .mh-profile-info-body .mt-2, [data-profile-panel="dna"] .mh-profile-info-body .mt-1 { margin-top:1px }
                [data-profile-panel="dna"] .mh-profile-info-body .mb-1 { margin-bottom:1px }
                .mh-profile-info-body .mt-3 { margin-top:4px }
                .mh-profile-info-body .mt-2, .mh-profile-info-body .mt-1 { margin-top:2px }
                .mh-profile-info-body .mb-1, .mh-profile-info-body .mb-2 { margin-bottom:2px }
                .mh-profile-info-body .gap-1 { gap:1px }
                .mh-profile-info-body .trait-badge { transform:scale(.78);transform-origin:left center;margin-right:-12px }
            }
            @media (orientation:portrait) and (max-width:480px) {
                .mh-profile-name .text-lg { font-size:12px }
                .mh-profile-basic .text-xs, .mh-profile-info-text, .mh-profile-info-body .text-xs { font-size:9px;line-height:1.08 }
                .mh-profile-care-stat { grid-template-columns:20px minmax(0,1fr) 14px;font-size:9px }
                .mh-profile-care-stat strong { font-size:8px }
                .mh-profile-info-title { font-size:9px }
                .mh-profile-dna-code { font-size:7px }
                [data-profile-panel="dna"] .mh-profile-info-body, [data-profile-panel="dna"] .mh-profile-info-body .text-xs { font-size:7px;line-height:1 }
            }
            @media (max-width:900px), (hover:none) and (pointer:coarse) {
                .mh-profile-topbar { height:112px !important }
                .mh-profile-title-art { max-height:104px !important }
                .mh-profile-stage { top:112px !important;padding:6px 10px 10px !important }
                .mh-profile-content {
                    --profile-device-gap:4px;
                    --profile-device-width:min(100%, calc((100cqh - var(--profile-device-gap) * 4) / 2.2748));
                    display:flex;
                    flex-direction:column;
                    justify-content:center;
                    align-items:center;
                    gap:var(--profile-device-gap);
                }
                .mh-profile-left-column, .mh-profile-right { display:contents }
                .mh-profile-left, .mh-profile-care, .mh-profile-info { width:var(--profile-device-width);max-width:none }
                .mh-profile-right { transform:none }
                .mh-profile-name .text-lg { font-size:15px }
                .mh-profile-name-subtitle { font-size:9px }
                .mh-profile-basic .text-xs, .mh-profile-info-text, .mh-profile-info-body .text-xs { font-size:12px;line-height:1.12 }
                .mh-profile-care-title, .mh-profile-info-title { font-size:13px }
                .mh-profile-care-title { left:10%;width:21% }
                .mh-profile-care-body { left:28%;right:5%;top:18%;bottom:8%;grid-template-rows:repeat(2,minmax(0,1fr));gap:3px 8px }
                .mh-profile-care-stat { min-height:0;grid-template-columns:24% minmax(0,1fr) 18%;gap:3px;font-size:12px;line-height:1 }
                .mh-profile-care-stat i { height:7px }
                .mh-profile-care-stat strong { font-size:11px;line-height:1 }
                .mh-profile-info-body { top:36% }
                .mh-profile-dna-code { font-size:10px }
                [data-profile-panel="dna"] .mh-profile-info-body { top:42%;bottom:-4% }
                [data-profile-panel="dna"] .mh-profile-info-body, [data-profile-panel="dna"] .mh-profile-info-body .text-xs { font-size:10px;line-height:1.08 }
                .mh-profile-info-body .text-sm { font-size:13px;line-height:1.1 }
                .mh-profile-dna-secondary { display:none }
            }
            @media (orientation:landscape) and (min-height:521px) and (max-width:900px) {
                .mh-profile-name .text-lg { font-size:12px }
                .mh-profile-name-subtitle { font-size:7px }
                .mh-profile-basic .text-xs, .mh-profile-info-text, .mh-profile-info-body .text-xs { font-size:9px;line-height:1.05 }
                .mh-profile-care-title, .mh-profile-info-title { font-size:10px }
                .mh-profile-care-stat { font-size:9px }
                .mh-profile-care-stat strong { font-size:8px }
                .mh-profile-dna-code, [data-profile-panel="dna"] .mh-profile-info-body, [data-profile-panel="dna"] .mh-profile-info-body .text-xs { font-size:8px;line-height:1 }
                .mh-profile-info-body .text-sm { font-size:10px;line-height:1.05 }
            }
            @media (orientation:landscape) and (max-height:520px) {
                .mh-profile-topbar { height:76px !important }
                .mh-profile-title-art { max-height:70px !important }
                .mh-profile-stage { top:76px !important }
                .mh-profile-name .text-lg { font-size:6px }
                .mh-profile-name-subtitle { font-size:4px }
                .mh-profile-basic .text-xs, .mh-profile-info-text, .mh-profile-info-body .text-xs { font-size:5px;line-height:1 }
                .mh-profile-care-title, .mh-profile-info-title { font-size:5px }
                .mh-profile-care-body { grid-template-rows:repeat(2,minmax(0,1fr));gap:1px }
                .mh-profile-care-stat { min-height:0;grid-template-columns:22% minmax(0,1fr) 22%;gap:1px;font-size:5px;line-height:1 }
                .mh-profile-care-stat i { height:3px }
                .mh-profile-care-stat strong { font-size:5px;line-height:1 }
                .mh-profile-dna-code, [data-profile-panel="dna"] .mh-profile-info-body, [data-profile-panel="dna"] .mh-profile-info-body .text-xs { font-size:4px;line-height:1 }
                .mh-profile-info-body .text-sm { font-size:5px;line-height:1 }
            }
        </style>
        <div class="mh-profile-view">
            <div class="topbar mh-profile-topbar" style="height:140px">
                <button class="btn-icon mh-profile-back" id="mhBack" type="button" aria-label="返回">
                    <img src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/cc3-back.webp" width="158" height="155" alt="">
                </button>
                <img class="mh-profile-title-art" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/cc1-520.webp" width="520" height="151" alt="档案" style="display:block;width:auto;max-width:calc(100% - 96px);height:auto;max-height:132px;margin:0 auto;object-fit:contain">
                <span style="width:64px"></span>
            </div>
            <div class="absolute mh-profile-stage" style="top:140px;left:0;right:0;bottom:0;overflow:hidden;padding:10px 14px 14px">
                <div class="mh-profile-content fade-in">
                <div class="mh-profile-left-column" data-profile-side="left">
                    <section class="mh-profile-left">
                        <img class="mh-profile-frame" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/profile-pet-frame.webp" width="720" height="445" alt="">
                        <div class="mh-profile-pet-art">
                            ${petArtHtml(pet, { alt: displayPetName(pet) })}
                        </div>
                        <div class="mh-profile-name">
                            <div class="text-lg font-extrabold" style="color:var(--text-primary)">${escapeHtml(displayPetName(pet))}${isAdultStage(pet.stage) ? '' : `<span class="mh-profile-name-subtitle">${escapeHtml(t('nameUnknownSub'))}</span>`}</div>
                        </div>
                        <div class="mh-profile-basic">
                            <div class="text-xs" style="color:var(--text-muted)">${escapeHtml(t('stage'))}：<b style="color:var(--accent-dark)">${escapeHtml(getStageName(pet.stage, pet.stage || ''))}</b></div>
                            <div class="text-xs" style="color:var(--text-muted)">${escapeHtml(t('bornAt'))}：${formatTime(pet.bornAt)}</div>
                            <div class="text-xs" style="color:var(--text-muted)">${escapeHtml(t('rarity'))}：<b style="color:var(--accent-dark)">${pet.rarity ?? '?'}</b></div>
                        </div>
                    </section>

                    <section class="mh-profile-care" data-profile-panel="care">
                        <img class="mh-profile-frame" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/profile-companion-status-frame.webp" width="720" height="235" alt="饲养状态">
                        <div class="mh-profile-care-title">饲养状态</div>
                        <div class="mh-profile-care-body">
                            ${careStats}
                        </div>
                    </section>
                </div>

                <div class="mh-profile-right" data-profile-side="right">
                    <section class="mh-profile-info" data-profile-panel="body">
                        <img class="mh-profile-info-frame" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/profile-info-frame-1.webp" width="615" height="267" alt="">
                        <div class="mh-profile-info-title">${escapeHtml(t('bodyState'))}</div>
                        <div class="mh-profile-info-body mh-profile-info-text">
                            ${sickness ? `
                                <div class="text-sm font-bold" style="color:#b91c1c">✚ ${escapeHtml(sicknessName(sickness.def))} · ${escapeHtml(sicknessLabel(sickness.def))}</div>
                                <div class="text-xs mt-1" style="color:var(--text-muted)">${escapeHtml(t('sickDate', { date: formatTime(sickness.startedAt) }))}</div>
                                <div class="text-xs mt-1" style="color:var(--text-muted)">${escapeHtml(t('sickSeverity', { severity: sicknessSeverity }))}</div>
                            ` : `
                                <div class="text-sm font-bold" style="color:#166534">${escapeHtml(t('healthy'))}</div>
                                <div class="text-xs mt-1" style="color:var(--text-muted)">${escapeHtml(t('noSickness'))}</div>
                            `}
                        </div>
                    </section>

                    <section class="mh-profile-info" data-profile-panel="dna">
                        <img class="mh-profile-info-frame" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/profile-info-frame-2.webp" width="615" height="277" alt="">
                        <div class="mh-profile-info-title">${escapeHtml(t('dnaCode'))}</div>
                        <div class="mh-profile-dna-code font-mono">${escapeHtml(formatDna(pet.dna || ''))}</div>
                        <div class="mh-profile-info-body mh-profile-info-text">
                            ${pet.traits ? (isAdultStage(pet.stage) ? `
                                <div class="grid gap-1 mt-3 text-xs mh-profile-traits-grid" style="color:var(--text-secondary)">
                                    <div>${escapeHtml(t('traitBloodline'))}：<b>${escapeHtml(pet.traits.element || '?')}${escapeHtml(t('clanSuffix'))}</b></div>
                                    <div>${escapeHtml(t('traitElement'))}：<b>${escapeHtml(pet.traits.elementalAttribute || t('natureElement'))}</b></div>
                                    <div>${escapeHtml(t('traitSpecies'))}：<b>${escapeHtml(pet.traits.species || '?')}</b></div>
                                    <div>${escapeHtml(t('traitColor'))}：<b>${escapeHtml(pet.traits.color || '?')}</b></div>
                                    <div>${escapeHtml(t('traitEyes'))}：<b>${escapeHtml(pet.traits.eyes || '?')}</b></div>
                                    <div>${escapeHtml(t('traitAccessory'))}：<b>${escapeHtml(pet.traits.accessory || '?')}</b></div>
                                </div>
                            ` : `
                                <div class="grid gap-1 mt-3 text-xs mh-profile-traits-grid" style="color:var(--text-muted)">
                                    <div>${escapeHtml(t('traitBloodline'))}：<b>${escapeHtml(pet.traits.element || '?')}${escapeHtml(t('clanSuffix'))}</b></div>
                                    <div>${escapeHtml(t('traitElement'))}：<b>${escapeHtml(pet.traits.elementalAttribute || t('natureElement'))}</b></div>
                                    <div>${escapeHtml(t('traitSpecies'))}：<b>${escapeHtml(t('hiddenTrait'))}</b></div>
                                    <div>${escapeHtml(t('traitColor'))}：<b>${escapeHtml(t('hiddenTrait'))}</b></div>
                                    <div>${escapeHtml(t('traitEyes'))}：<b>${escapeHtml(t('hiddenTrait'))}</b></div>
                                    <div>${escapeHtml(t('traitAccessory'))}：<b>${escapeHtml(t('hiddenTrait'))}</b></div>
                                </div>
                                <div class="text-xs mt-2 mh-profile-dna-secondary" style="color:var(--text-muted);font-style:italic">${escapeHtml(t('traitsHiddenHint'))}</div>
                            `) : ''}
                            ${pet.parents ? `<div class="text-xs mt-2" style="color:var(--text-muted)">${escapeHtml(t('parentsLabel', { parents: pet.parents.map(pid => { const pp = state.pets[pid]; return pp ? displayPetName(pp) : pid.slice(-4); }).join(' × ') }))}</div>` : ''}
                            <div class="text-xs font-bold mt-3 mb-1 mh-profile-dna-secondary" style="color:var(--text-secondary)">${escapeHtml(t('growthTraits'))}</div>
                            ${evolvedTraits.length ? `
                                <div style="display:flex;flex-wrap:wrap;gap:6px">
                                    ${evolvedTraits.map(tr => tr.def ? `
                                        <span class="trait-badge" title="${escapeHtml(tr.def.name)} ${tr.value | 0}/${CONFIG.traitMax}">
                                            ${tr.def.emoji}<span>${escapeHtml(tr.def.name)}</span><i>${tr.value | 0}</i>
                                        </span>` : '').join('')}
                                </div>
                            ` : `<div class="text-xs mh-profile-dna-secondary" style="color:var(--text-muted)">${escapeHtml(t('noGrowthTraits'))}</div>`}
                        </div>
                    </section>

                    <section class="mh-profile-info" data-profile-panel="memory">
                        <img class="mh-profile-info-frame" src="https://cdn.keepwork.com/keepwork/cdn/magichaqi/assets/ui/profile/profile-info-frame-3.webp" width="615" height="274" alt="">
                        <div class="mh-profile-info-title">📝 ${escapeHtml(t('memory'))}</div>
                        <div class="mh-profile-info-body mh-profile-info-text">
                            <pre id="mhMemoryBox" style="font-size:inherit;color:var(--text-secondary);white-space:pre-wrap;word-wrap:break-word;max-height:100%;overflow:hidden;font-family:inherit">${escapeHtml(t('loading'))}</pre>
                        </div>
                    </section>
                </div>
            </div>
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
