// 轻量 NPC 对话气泡：按顺序播放 npc.dialog 台词，明确确认最后一句（或没有台词）时调用 onConfirmed。
// 不依赖 view_story_player.js，只做最简单的顺序播放 + 点击下一步。
import { escapeHtml, isImageIconValue, parseIconSource, loadNaturalImageSize } from './utils.js';
import { ensureDailyMinigameProgress } from './minigame_daily.js';
import { COLLECTIBLE_CATEGORIES, COLLECTIBLE_ITEMS, GIFT_FRESHNESS_MS, getCollectibleFreshness, getNpcGiftProfile, giftDayKey, npcRelationshipBonus } from './npc_gifts.js';
import { isSceneTaskCompleted } from './npc_scene_tasks.js';

// 头像只想展示角色裁剪区域的上 3/4（半身特写），且必须保持原图宽高比、不能被拉伸变形。
// 不能直接用 iconBackgroundStyleAttr()：它按裁剪矩形的宽高百分比分别拉伸铺满展示盒，
// 若盒子（正方形头像框）宽高比和裁剪区域真实像素宽高比不同就会挤压变形。
// 这里改成拿到原图真实像素尺寸后，用同一个缩放比例（保宽高比）铺满头像框，只取裁剪区域顶部部分，多余部分交给外层 overflow:hidden 裁掉。
const PORTRAIT_TOP_FRACTION = 0.75;

async function applyPortraitCrop(el, icon) {
    if (!el) return;
    const { src, rect } = parseIconSource(icon);
    if (!src) return;
    const safeSrc = src.replace(/["\\]/g, '');
    el.style.backgroundImage = `url("${safeSrc}")`;
    el.style.backgroundRepeat = 'no-repeat';
    if (!rect) {
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = '50% 8%';
        return;
    }
    const size = await loadNaturalImageSize(safeSrc);
    if (!size?.width || !size?.height) {
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = '50% 8%';
        return;
    }
    // 用 clientWidth（不含 border）而非 offsetWidth：背景图是相对 padding-box 定位/绘制的，
    // 之前用 offsetWidth（含 6px 边框）算缩放和偏移，会和实际背景绘制区域对不上，导致画面整体偏移。
    const boxSize = el.clientWidth || (el.getBoundingClientRect().width - 12) || 148;
    const cropWidthPx = size.width * rect.w / 100;
    const cropHeightPx = size.height * rect.h / 100 * PORTRAIT_TOP_FRACTION;
    if (cropWidthPx <= 0 || cropHeightPx <= 0) return;
    // 与 CSS cover 同一原理：等比缩放到刚好铺满方框（取较大的那个缩放比），多余部分被裁掉，因此不会变形。
    const scale = Math.max(boxSize / cropWidthPx, boxSize / cropHeightPx);
    el.style.backgroundSize = `${(size.width * scale).toFixed(2)}px ${(size.height * scale).toFixed(2)}px`;
    const cropOriginXPx = size.width * rect.x / 100 * scale;
    const cropOriginYPx = size.height * rect.y / 100 * scale;
    const posX = cropOriginXPx - (boxSize - cropWidthPx * scale) / 2;
    const posY = cropOriginYPx; // 顶部对齐：裁剪区域的顶边紧贴头像框顶边，露出上 3/4，下 1/4 被裁掉
    el.style.backgroundPosition = `${(-posX).toFixed(2)}px ${(-posY).toFixed(2)}px`;
}

export function openNpcDialog(npc, { onConfirmed, onInteraction, onGift, progress = null, inventory = {}, freshness = {} } = {}) {
    const lines = Array.isArray(npc?.dialog) ? npc.dialog : [];
    if (!lines.length) {
        onConfirmed?.();
        return;
    }

    let index = 0;
    let smallTalkIndex = 0;
    const smallTalkTopics = (Array.isArray(npc?.smallTalk) ? npc.smallTalk : [npc?.smallTalk])
        .map(text => String(text || '').trim())
        .filter(Boolean);
    const interactions = Array.isArray(npc?.interactions) ? npc.interactions : [];
    const primarySceneInteraction = interactions.find(interaction => interaction.play?.type === 'sceneCollect');
    const icon = npc?.icon || '';
    const portraitHtml = isImageIconValue(icon)
        ? `<div class="npc-dialog-portrait-img"></div>`
        : `<div class="npc-dialog-portrait-img npc-dialog-portrait-emoji">${escapeHtml(icon || '🐾')}</div>`;
    const dailyProgress = ensureDailyMinigameProgress(progress);
    const relationship = progress?.npcRelationships?.[npc?.progressId || npc?.id] || progress?.npcRelationships?.[npc?.id] || {};
    const completedInteractionIds = Array.isArray(relationship.completedInteractionIds) ? relationship.completedInteractionIds : [];
    const commission = npc?.dailyCommission;
    const commissionDone = !!dailyProgress.npcCommissions?.[npc?.id]?.completedAt;
    const relationshipCount = Math.max(0, Math.floor(Number(relationship.interactionCount ?? relationship.completedCount) || 0));
    const giftProfile = getNpcGiftProfile(npc);
    const relationshipBonus = npcRelationshipBonus(npc, relationship);
    const relationshipStage = relationshipBonus.stage;
    const affection = Math.max(0, Math.floor(Number(relationship.affection) || 0));
    const nextAffection = relationshipStage.next;
    const affectionProgress = nextAffection ? Math.min(100, Math.round(affection / nextAffection * 100)) : 100;
    const giftsToday = relationship.giftsToday?.day === giftDayKey() ? Math.max(0, Number(relationship.giftsToday.count) || 0) : 0;
    const ownedGifts = COLLECTIBLE_ITEMS.filter(item => Math.max(0, Number(inventory?.[item.id]) || 0) > 0);
    const giftFreshnessText = item => {
        const status = getCollectibleFreshness(item.id, inventory, freshness);
        if (!status.perishable || !status.nextExpiryAt) return '永久保存';
        if (status.staleCount > 0) return `${status.staleCount} 件已陈旧`;
        return `保鲜 ${Math.max(1, Math.ceil((status.nextExpiryAt - Date.now()) / GIFT_FRESHNESS_MS * 7))} 天`;
    };
    const storyFlags = progress?.npcStoryFlags && typeof progress.npcStoryFlags === 'object' ? progress.npcStoryFlags : {};
    const statusHtml = npc?.role || commission ? `
        <div class="npc-dialog-status">
            ${npc?.role ? `<div class="npc-dialog-role">${escapeHtml(npc.role)}</div>` : ''}
            ${commission ? `<div class="npc-dialog-commission"><span>今日委托</span><strong>${escapeHtml(commission.title)}</strong><em class="${commissionDone ? 'is-complete' : ''}">${commissionDone ? '已完成' : '待完成'}</em></div>` : ''}
            <div class="npc-dialog-relationship"><span>心意：<strong>${escapeHtml(relationshipStage.name)}</strong> · ${affection}${nextAffection ? ` / ${nextAffection}` : ' · 已满'}</span><span class="npc-dialog-affection-track"><i style="width:${affectionProgress}%"></i></span></div>
            <div class="npc-dialog-gift-hint">喜欢 ${COLLECTIBLE_CATEGORIES[giftProfile.likedCategory].icon} ${escapeHtml(COLLECTIBLE_CATEGORIES[giftProfile.likedCategory].name)} · 不喜欢 ${COLLECTIBLE_CATEGORIES[giftProfile.dislikedCategory].icon} ${escapeHtml(COLLECTIBLE_CATEGORIES[giftProfile.dislikedCategory].name)}</div>
            <div class="npc-dialog-bonus">关系加成：${escapeHtml(relationshipBonus.bonusName)} +${relationshipBonus.value}${relationshipBonus.bonusUnit} · ${escapeHtml(relationshipBonus.bonusDescription)}</div>
        </div>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'npc-dialog-overlay';
    overlay.innerHTML = `
        <div class="npc-dialog-box" role="dialog" aria-modal="true">
            <div class="npc-dialog-portrait">
                ${portraitHtml}
                <div class="npc-dialog-nameplate"></div>
            </div>
            <div class="npc-dialog-bubble">
                <svg class="npc-dialog-sprout" viewBox="0 0 40 30" aria-hidden="true">
                    <path d="M20 30 C20 20 20 14 20 8" fill="none" stroke="#3f7d20" stroke-width="2.4" stroke-linecap="round"/>
                    <path d="M20 12 C10 12 4 5 3 0 C13 0 19 6 20 12 Z" fill="#5fbf3a" stroke="#2f6e17" stroke-width="1.4" stroke-linejoin="round"/>
                    <path d="M20 12 C10 9 8 5 8 4" fill="none" stroke="#2f6e17" stroke-width="1" stroke-linecap="round"/>
                    <path d="M20 13 C30 13 36 6 37 1 C27 1 21 7 20 13 Z" fill="#79db4d" stroke="#2f6e17" stroke-width="1.4" stroke-linejoin="round"/>
                    <path d="M20 18 C29 15 32 11.5 32 10.5" fill="none" stroke="#2f6e17" stroke-width="1" stroke-linecap="round"/>
                </svg>
                <button type="button" class="npc-dialog-close" aria-label="关闭">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18"/>
                        <line x1="18" y1="6" x2="6" y2="18"/>
                    </svg>
                </button>
                ${statusHtml}
                <div class="npc-dialog-text"></div>
                <div class="npc-dialog-interactions"></div>
                <div class="npc-dialog-choices"></div>
                <div class="npc-dialog-actions">
                    ${smallTalkTopics.length ? '<button type="button" class="npc-dialog-small-talk">聊聊近况</button>' : (commission ? '<button type="button" class="npc-dialog-later">稍后再说</button>' : '')}
                    <button type="button" class="npc-dialog-next"></button>
                </div>
            </div>
        </div>`;
    const nameplateEl = overlay.querySelector('.npc-dialog-nameplate');
    const textEl = overlay.querySelector('.npc-dialog-text');
    const interactionsEl = overlay.querySelector('.npc-dialog-interactions');
    const choicesEl = overlay.querySelector('.npc-dialog-choices');
    const nextBtn = overlay.querySelector('.npc-dialog-next');
    const closeBtn = overlay.querySelector('.npc-dialog-close');
    const laterBtn = overlay.querySelector('.npc-dialog-later');
    const smallTalkBtn = overlay.querySelector('.npc-dialog-small-talk');
    const portraitImgEl = overlay.querySelector('.npc-dialog-portrait-img');

    const closeDialog = () => {
        overlay.remove();
    };
    closeBtn.onclick = closeDialog;
    if (laterBtn) laterBtn.onclick = closeDialog;
    if (smallTalkBtn) smallTalkBtn.onclick = () => {
        textEl.textContent = smallTalkTopics[smallTalkIndex];
        smallTalkIndex = (smallTalkIndex + 1) % smallTalkTopics.length;
        smallTalkBtn.textContent = smallTalkTopics.length > 1 ? '换个话题' : '聊聊近况';
        choicesEl.replaceChildren();
    };
    const renderInteractions = () => {
        const interactionButtons = interactions.map(interaction => {
            const button = document.createElement('button');
            button.type = 'button';
            const interactionCompleted = interaction.play?.type === 'sceneCollect'
                ? isSceneTaskCompleted(relationship, interaction)
                : completedInteractionIds.includes(interaction.id);
            const missingRequirements = (interaction.requires || []).filter(id => !storyFlags[id]);
            if (missingRequirements.length) {
                button.className = 'npc-dialog-locked-interaction';
                const label = document.createElement('strong');
                label.textContent = `🔒 ${interaction.label}`;
                const hint = document.createElement('small');
                hint.textContent = interaction.unlockHint || '点击查看解锁条件';
                button.replaceChildren(label, hint);
                button.setAttribute('aria-label', `${interaction.label}，${hint.textContent}`);
            } else {
                button.textContent = interaction.play?.type === 'sceneCollect' && interactionCompleted ? '查看调查结论' : interaction.label;
            }
            button.onclick = () => {
                if (missingRequirements.length) {
                    textEl.textContent = interaction.lockedText || '先完成前面的委托，再回来看看。';
                    choicesEl.replaceChildren();
                    return;
                }
                textEl.textContent = interaction.prompt || interaction.response;
                if (interaction.play?.type === 'sceneCollect') {
                    if (interactionCompleted) {
                        textEl.textContent = interaction.play.revisit || interaction.play.success || interaction.response || '谢谢你完成这次调查。';
                        choicesEl.replaceChildren();
                        return;
                    }
                    onInteraction?.(interaction.id, { started: true, type: 'sceneCollect' });
                    closeDialog();
                    return;
                }
                if (interaction.play?.type === 'sequence') {
                    let nextStep = 0;
                    textEl.textContent = interaction.play.instruction || '按正确顺序完成操作。';
                    const stepButtons = interaction.play.steps.map((step, stepIndex) => {
                        const stepButton = document.createElement('button');
                        stepButton.type = 'button';
                        stepButton.textContent = step.label;
                        stepButton.onclick = () => {
                            if (stepIndex !== nextStep) {
                                textEl.textContent = `顺序不对，再观察一下。下一步要从第 ${nextStep + 1} 项开始。`;
                                nextStep = 0;
                                stepButtons.forEach(item => {
                                    item.classList.remove('is-complete');
                                    item.disabled = false;
                                });
                                return;
                            }
                            stepButton.classList.add('is-complete');
                            stepButton.disabled = true;
                            nextStep += 1;
                            textEl.textContent = step.feedback || `完成第 ${nextStep} 步。`;
                            if (nextStep >= interaction.play.steps.length) {
                                textEl.textContent = interaction.play.success || interaction.response || '操作完成！';
                                choicesEl.classList.add('is-play-complete');
                                onInteraction?.(interaction.id, { completed: true, type: 'sequence' });
                            }
                        };
                        return stepButton;
                    });
                    choicesEl.classList.remove('is-play-complete');
                    choicesEl.replaceChildren(...stepButtons);
                    return;
                }
                if (interaction.play?.type === 'collect') {
                    const targetCount = interaction.play.steps.filter(step => step.target).length;
                    let collectedCount = 0;
                    textEl.textContent = interaction.play.instruction || '找出所有需要的物品。';
                    const itemButtons = interaction.play.steps.map(step => {
                        const itemButton = document.createElement('button');
                        itemButton.type = 'button';
                        itemButton.textContent = step.label;
                        itemButton.onclick = () => {
                            if (!step.target) {
                                itemButton.classList.add('is-mistake');
                                textEl.textContent = step.feedback || '这件物品不适合当前任务，再想一想。';
                                return;
                            }
                            itemButton.classList.remove('is-mistake');
                            itemButton.classList.add('is-complete');
                            itemButton.disabled = true;
                            collectedCount += 1;
                            textEl.textContent = step.feedback || `已找到 ${collectedCount}/${targetCount} 件必要物品。`;
                            if (collectedCount >= targetCount) {
                                textEl.textContent = interaction.play.success || interaction.response || '物品已经找齐！';
                                choicesEl.classList.add('is-play-complete');
                                itemButtons.forEach(item => { item.disabled = true; });
                                onInteraction?.(interaction.id, { completed: true, type: 'collect' });
                            }
                        };
                        return itemButton;
                    });
                    choicesEl.classList.remove('is-play-complete');
                    choicesEl.replaceChildren(...itemButtons);
                    return;
                }
                if (interaction.play?.type === 'rhythm') {
                    let inputIndex = 0;
                    let acceptingInput = false;
                    textEl.textContent = interaction.play.instruction || '先观察节奏，再按同样顺序复现。';
                    const rhythmButtons = interaction.play.steps.map((step, stepIndex) => {
                        const rhythmButton = document.createElement('button');
                        rhythmButton.type = 'button';
                        rhythmButton.textContent = step.label;
                        rhythmButton.disabled = true;
                        rhythmButton.onclick = () => {
                            if (!acceptingInput) return;
                            if (stepIndex !== inputIndex) {
                                inputIndex = 0;
                                textEl.textContent = '节奏断开了。重新从第一拍开始。';
                                rhythmButtons.forEach(item => item.classList.remove('is-complete'));
                                return;
                            }
                            rhythmButton.classList.add('is-complete');
                            window.setTimeout(() => rhythmButton.classList.remove('is-complete'), 180);
                            inputIndex += 1;
                            if (inputIndex >= interaction.play.steps.length) {
                                acceptingInput = false;
                                rhythmButtons.forEach(item => { item.disabled = true; });
                                choicesEl.classList.add('is-play-complete');
                                textEl.textContent = interaction.play.success || '节奏复现成功！';
                                onInteraction?.(interaction.id, { completed: true, type: 'rhythm' });
                            }
                        };
                        return rhythmButton;
                    });
                    choicesEl.classList.remove('is-play-complete');
                    choicesEl.replaceChildren(...rhythmButtons);
                    interaction.play.steps.forEach((_, stepIndex) => {
                        window.setTimeout(() => {
                            rhythmButtons[stepIndex].classList.add('is-demo');
                            window.setTimeout(() => rhythmButtons[stepIndex].classList.remove('is-demo'), 360);
                        }, 650 + stepIndex * 620);
                    });
                    window.setTimeout(() => {
                        acceptingInput = true;
                        rhythmButtons.forEach(item => { item.disabled = false; });
                        textEl.textContent = '轮到你了，复现刚才的节奏。';
                    }, 850 + interaction.play.steps.length * 620);
                    return;
                }
                if (interaction.play?.type === 'observe') {
                    let revealed = 0;
                    textEl.textContent = interaction.play.instruction || '安静观察即将出现的行为。';
                    choicesEl.replaceChildren();
                    const observedSteps = interaction.play.steps.filter(step => step.target);
                    observedSteps.forEach((step, stepIndex) => {
                        window.setTimeout(() => { textEl.textContent = `${step.icon} ${step.label}`; }, 600 + stepIndex * 850);
                    });
                    window.setTimeout(() => {
                        textEl.textContent = '哪些行为刚才真实出现过？';
                        const observeButtons = interaction.play.steps.map(step => {
                            const observeButton = document.createElement('button');
                            observeButton.type = 'button';
                            observeButton.textContent = step.label;
                            observeButton.onclick = () => {
                                if (!step.target) {
                                    observeButton.classList.add('is-mistake');
                                    textEl.textContent = step.feedback || '这个行为刚才没有出现。';
                                    return;
                                }
                                observeButton.classList.add('is-complete');
                                observeButton.disabled = true;
                                revealed += 1;
                                const targetCount = interaction.play.steps.filter(item => item.target).length;
                                textEl.textContent = step.feedback || `记录正确（${revealed}/${targetCount}）`;
                                if (revealed >= targetCount) {
                                    observeButtons.forEach(item => { item.disabled = true; });
                                    choicesEl.classList.add('is-play-complete');
                                    textEl.textContent = interaction.play.success || '观察记录完成！';
                                    onInteraction?.(interaction.id, { completed: true, type: 'observe' });
                                }
                            };
                            return observeButton;
                        });
                        choicesEl.classList.remove('is-play-complete');
                        choicesEl.replaceChildren(...observeButtons);
                    }, 900 + observedSteps.length * 850);
                    return;
                }
                if (interaction.play?.type === 'dragMatch') {
                    let selectedItem = null;
                    let placedCount = 0;
                    textEl.textContent = interaction.play.instruction || '把每件物品放进正确区域。';
                    const board = document.createElement('div');
                    board.className = 'npc-dialog-drag-board';
                    const items = document.createElement('div');
                    items.className = 'npc-dialog-drag-items';
                    const zones = document.createElement('div');
                    zones.className = 'npc-dialog-drop-zones';
                    const placeItem = (itemButton, zoneId) => {
                        const step = interaction.play.steps.find(item => item.id === itemButton.dataset.dragItem);
                        if (!step || step.zone !== zoneId) {
                            itemButton.classList.add('is-mistake');
                            textEl.textContent = step?.feedback || '这个位置不合适，再试一次。';
                            return;
                        }
                        itemButton.classList.remove('is-mistake', 'is-selected');
                        itemButton.classList.add('is-complete');
                        itemButton.disabled = true;
                        selectedItem = null;
                        placedCount += 1;
                        textEl.textContent = `已归位 ${placedCount}/${interaction.play.steps.length} 件装备。`;
                        if (placedCount >= interaction.play.steps.length) {
                            choicesEl.classList.add('is-play-complete');
                            textEl.textContent = interaction.play.success || '所有物品都归位了！';
                            onInteraction?.(interaction.id, { completed: true, type: 'dragMatch' });
                        }
                    };
                    interaction.play.steps.forEach(step => {
                        const itemButton = document.createElement('button');
                        itemButton.type = 'button';
                        itemButton.draggable = true;
                        itemButton.dataset.dragItem = step.id;
                        itemButton.textContent = `${step.icon} ${step.label}`;
                        itemButton.onclick = () => {
                            items.querySelectorAll('.is-selected').forEach(item => item.classList.remove('is-selected'));
                            selectedItem = itemButton;
                            itemButton.classList.add('is-selected');
                            textEl.textContent = '再点击它应该放入的区域。';
                        };
                        itemButton.ondragstart = event => event.dataTransfer.setData('text/plain', step.id);
                        items.appendChild(itemButton);
                    });
                    interaction.play.zones.forEach(zone => {
                        const zoneButton = document.createElement('button');
                        zoneButton.type = 'button';
                        zoneButton.className = 'npc-dialog-drop-zone';
                        zoneButton.textContent = zone.label;
                        zoneButton.ondragover = event => event.preventDefault();
                        zoneButton.ondrop = event => {
                            event.preventDefault();
                            const itemButton = items.querySelector(`[data-drag-item="${CSS.escape(event.dataTransfer.getData('text/plain'))}"]`);
                            if (itemButton) placeItem(itemButton, zone.id);
                        };
                        zoneButton.onclick = () => { if (selectedItem) placeItem(selectedItem, zone.id); };
                        zones.appendChild(zoneButton);
                    });
                    board.append(items, zones);
                    choicesEl.classList.remove('is-play-complete');
                    choicesEl.replaceChildren(board);
                    return;
                }
                onInteraction?.(interaction.id, { completed: true, type: interaction.choices?.length ? 'choice' : 'response' });
                if (!interaction.choices?.length) {
                    choicesEl.replaceChildren();
                    if (interaction.prompt && interaction.response) textEl.textContent = interaction.response;
                    return;
                }
                choicesEl.replaceChildren(...interaction.choices.map(choice => {
                    const choiceButton = document.createElement('button');
                    choiceButton.type = 'button';
                    choiceButton.textContent = choice.label;
                    choiceButton.onclick = () => {
                        textEl.textContent = choice.response;
                        choicesEl.replaceChildren();
                    };
                    return choiceButton;
                }));
            };
            return button;
        });
        if (npc?.minigame || npc?.hatchBoostSeconds) {
            const leisureButton = document.createElement('button');
            leisureButton.type = 'button';
            leisureButton.textContent = npc?.minigame ? '休闲挑战' : '领取照护协助';
            leisureButton.onclick = () => {
                closeDialog();
                onConfirmed?.();
            };
            interactionButtons.push(leisureButton);
        }
        const giftButton = document.createElement('button');
        giftButton.type = 'button';
        giftButton.className = 'npc-dialog-gift-button';
        giftButton.textContent = `🎁 赠送礼物 ${giftsToday}/3`;
        giftButton.disabled = giftsToday >= 3;
        giftButton.onclick = () => {
            if (!ownedGifts.length) {
                textEl.textContent = '背包里还没有可赠送的收藏品。挖矿、远征或在场景中探索时可能遇到意外掉落。';
                choicesEl.replaceChildren();
                return;
            }
            textEl.textContent = `选一件礼物送给${npc.name || '这位伙伴'}。偏好会影响心意，今天还可赠送 ${Math.max(0, 3 - giftsToday)} 次。`;
            choicesEl.replaceChildren(...ownedGifts.map(item => {
                const itemButton = document.createElement('button');
                itemButton.type = 'button';
                itemButton.className = 'npc-dialog-gift-item';
                itemButton.innerHTML = `<span>${escapeHtml(item.icon)}</span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(COLLECTIBLE_CATEGORIES[item.category].name)} ×${Math.max(0, Number(inventory[item.id]) || 0)} · ${escapeHtml(giftFreshnessText(item))}</small>`;
                itemButton.onclick = () => {
                    const result = onGift?.(item.id);
                    if (!result?.applied) {
                        textEl.textContent = result?.reason === 'daily-limit' ? '今天已经送过三件礼物了，明天再来吧。' : '这件礼物已经不在背包里了。';
                        return;
                    }
                    const reactionText = {
                        favorite: `这正是我一直想找的！心意 +${result.affectionDelta}`,
                        liked: `很合我的心意，谢谢你。心意 +${result.affectionDelta}`,
                        neutral: `谢谢你还想着我。心意 +${result.affectionDelta}`,
                        stale: `虽然不再新鲜，但我收到了你的心意。心意 +${result.affectionDelta}`,
                        disliked: `我不太习惯这个，不过还是谢谢你。心意 ${result.affectionDelta}`,
                    }[result.reaction];
                    const returnText = result.returnItem ? ` 我也送你一件 ${result.returnItem.icon} ${result.returnItem.name}，额外心意 +3。` : '';
                    const stageText = result.stageAfter.level > result.stageBefore.level ? ` 关系提升为「${result.stageAfter.name}」！` : '';
                    textEl.textContent = reactionText + returnText + stageText;
                    choicesEl.replaceChildren();
                    giftButton.textContent = `🎁 已赠送 ${result.daily.count}/3`;
                    giftButton.disabled = result.daily.count >= 3;
                };
                return itemButton;
            }));
        };
        interactionButtons.push(giftButton);
        interactionsEl.replaceChildren(...interactionButtons);
    };
    const renderLine = () => {
        const line = lines[index] || {};
        nameplateEl.textContent = line.speaker || npc.name || '';
        textEl.textContent = line.text || '';
        if (line.buttonText) {
            nextBtn.textContent = commissionDone ? '再次练习（无奖励）' : line.buttonText;
        } else {
            nextBtn.innerHTML = index >= lines.length - 1 ? '好的' : '❯&nbsp;下一步';
        }
    };
    nextBtn.onclick = () => {
        index += 1;
        if (index >= lines.length) {
            if (primarySceneInteraction && !isSceneTaskCompleted(relationship, primarySceneInteraction)) {
                onInteraction?.(primarySceneInteraction.id, { started: true, type: 'sceneCollect' });
                closeDialog();
                return;
            }
            closeDialog();
            onConfirmed?.();
            return;
        }
        renderLine();
    };
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDialog();
    });

    document.body.appendChild(overlay);
    renderLine();
    renderInteractions();
    if (isImageIconValue(icon)) applyPortraitCrop(portraitImgEl, icon);
}
