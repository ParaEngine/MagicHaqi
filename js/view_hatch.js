// 孵化视图：当前仅在"繁殖"流程中使用（通过 view_petList 的繁殖按钮进入）。
// 系统不再允许玩家手动孵化新蛋——首次进入游戏时由 app.js 自动赠送一颗蛋。
import { $, escapeHtml, showToast, randId } from './utils.js';
import { t } from './i18n.js';
import { randomDna, normalizeDna, formatDna, decodeDna, crossover, dnaRarity, dnaToName, biasDnaForFieldId } from './dna.js';
import { generatePetSheet, getCachedSheetUrl, petArtHtml, preloadPetAssets } from './pet.js';
import { defaultPermanentTrauma, defaultStats, applyStage } from './petTick.js';
import { savePet, setCurrentPetPersisted } from './storage.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { findLargestHouseAcrossLayouts } from './config.js';

export function renderHatch(panel, { parents } = {}, { onCreated, onCancel } = {}) {
    const isBreed = !!(parents && parents.length === 2);
    let dna = isBreed ? crossover(parents[0].dna, parents[1].dna) : randomDna();
    // 主屋所在领地为新蛋 DNA 提供领地特征加成
    const territory = findLargestHouseAcrossLayouts(state.layouts);
    if (territory?.fieldId) dna = biasDnaForFieldId(dna, territory.fieldId);
    let imageSheetUrl = null;
    let busy = false;

    const draw = () => {
        const traits = decodeDna(dna);
        const rarity = dnaRarity(dna);
        const rarityLabel = rarity > 90 ? '🌟 传说' : rarity > 70 ? '✨ 稀有' : rarity > 40 ? '⭐ 普通' : '· 平凡';
        // 用一个临时 pet 对象给 petArtHtml 预览
        const previewPet = { dna, imageSheetUrl, stage: imageSheetUrl ? 'baby' : 'egg' };
        panel.innerHTML = `
            <div class="topbar">
                <button class="btn-icon" id="mhBackBtn" style="width:36px;height:36px;font-size:18px">‹</button>
                <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(isBreed ? t('breed') : t('hatchTitle'))}</span>
                <span style="width:36px"></span>
            </div>
            <div class="absolute" style="top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:16px">
                <div class="card-flat text-center mb-3 fade-in">
                    <div style="width:160px;height:160px;border-radius:20px;margin:0 auto 10px;background:var(--bg-pill);overflow:hidden">
                        ${busy
                            ? `<div style="height:100%;display:flex;align-items:center;justify-content:center"><div class="spinner"></div></div>`
                            : petArtHtml(previewPet, { alt: '宝宝', extraClass: 'pop-in' })}
                    </div>
                    <div class="font-mono text-xs mb-1" style="color:var(--text-muted)">DNA</div>
                    <div class="font-mono font-bold text-base mb-2" style="color:var(--accent-dark);letter-spacing:2px">${escapeHtml(formatDna(dna))}</div>
                    <div class="text-xs mb-3" style="color:var(--accent-dark);font-weight:700">${escapeHtml(rarityLabel)} · 稀有度 ${rarity}</div>
                    <div class="text-sm" style="color:var(--text-secondary)"><b>${escapeHtml(traits.element)}族</b> · ${escapeHtml(traits.elementalAttribute || '自然')}元素 · ${escapeHtml(traits.color)} · ${escapeHtml(traits.species)}<br>${escapeHtml(traits.eyes)}<br>${escapeHtml(traits.accessory)}</div>
                </div>
                ${isBreed ? `
                    <div class="card-flat mb-3 text-xs" style="color:var(--text-secondary)">
                        ${escapeHtml(t('parents'))}：<b>${escapeHtml(parents[0].name)}</b> × <b>${escapeHtml(parents[1].name)}</b>
                    </div>
                ` : ''}
                <div class="card-flat mb-3 text-xs" style="color:var(--text-secondary);background:#fffbeb">
                    🔒 名字由 DNA 决定，<b>等它长大成年才会显露真名</b>～
                </div>
                <button id="mhGenBtn" class="btn-primary w-full mb-2" ${busy ? 'disabled' : ''}>
                    ${busy ? escapeHtml(t('generating')) : (imageSheetUrl ? '🔄 重新生成 4×4 形象' : '✨ 生成 4×4 成长形象')}
                </button>
                ${imageSheetUrl ? `<button id="mhConfirmBtn" class="btn-primary w-full" style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 4px 12px rgba(16,185,129,0.35)">✓ ${escapeHtml(t('confirm'))}</button>` : ''}
            </div>`;

        if ($('mhBackBtn')) $('mhBackBtn').onclick = () => onCancel?.();
        if ($('mhGenBtn')) $('mhGenBtn').onclick = async () => {
            if (busy) return;
            // 命中 DNA 缓存就直接复用，不再调用 LLM
            const cached = getCachedSheetUrl(dna);
            if (cached) {
                imageSheetUrl = cached;
                showToast('已复用同 DNA 缓存形象', 'info');
                draw();
                return;
            }
            busy = true; draw();
            try {
                const url = await generatePetSheet({ dna });
                if (!url) throw new Error('未获取到图片');
                imageSheetUrl = url;
                showToast('4×4 成长形象生成成功！', 'success');
            } catch (e) {
                showToast('生成失败：' + (e?.message || e), 'error');
            } finally {
                busy = false; draw();
            }
        };
        if ($('mhConfirmBtn')) $('mhConfirmBtn').onclick = async () => {
            const now = Date.now();
            const trueName = dnaToName(dna);
            const pet = {
                id: 'pet_' + randId(8),
                name: trueName,
                dna,
                imageUrl: null,
                imageSheetUrl,
                traits: decodeDna(dna),
                rarity: dnaRarity(dna),
                stats: defaultStats(),
                permanentTrauma: defaultPermanentTrauma(),
                bornAt: now,
                lastTickAt: now,
                lastCareAt: now,
                parents: isBreed ? [parents[0].id, parents[1].id] : null,
                stage: 'baby',
                activeRoom: 'living',
            };
            applyStage(pet);
            await savePet(pet);
            preloadPetAssets(pet, { includeAll: false });
            await setCurrentPetPersisted(pet.id);
            if (isBreed) {
                state.coins = Math.max(0, state.coins - CONFIG.breedCost);
                const { saveUserProfileDebounced } = await import('./storage.js');
                saveUserProfileDebounced();
            }
            showToast('一只新宠物诞生了！等它长大就能知道名字啦～', 'success', 2500);
            onCreated?.(pet);
        };
    };
    draw();
}
