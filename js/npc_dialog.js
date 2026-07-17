// 轻量 NPC 对话气泡：按顺序播放 npc.dialog 台词，明确确认最后一句（或没有台词）时调用 onConfirmed。
// 不依赖 view_story_player.js，只做最简单的顺序播放 + 点击下一步。
import { escapeHtml, isImageIconValue, parseIconSource, loadNaturalImageSize } from './utils.js';

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

export function openNpcDialog(npc, { onConfirmed } = {}) {
    const lines = Array.isArray(npc?.dialog) ? npc.dialog : [];
    if (!lines.length) {
        onConfirmed?.();
        return;
    }

    let index = 0;
    const icon = npc?.icon || '';
    const portraitHtml = isImageIconValue(icon)
        ? `<div class="npc-dialog-portrait-img"></div>`
        : `<div class="npc-dialog-portrait-img npc-dialog-portrait-emoji">${escapeHtml(icon || '🐾')}</div>`;

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
                <div class="npc-dialog-text"></div>
                <button type="button" class="npc-dialog-next"></button>
            </div>
        </div>`;
    const nameplateEl = overlay.querySelector('.npc-dialog-nameplate');
    const textEl = overlay.querySelector('.npc-dialog-text');
    const nextBtn = overlay.querySelector('.npc-dialog-next');
    const closeBtn = overlay.querySelector('.npc-dialog-close');
    const portraitImgEl = overlay.querySelector('.npc-dialog-portrait-img');

    const closeDialog = () => {
        overlay.remove();
    };
    closeBtn.onclick = closeDialog;
    const renderLine = () => {
        const line = lines[index] || {};
        nameplateEl.textContent = line.speaker || npc.name || '';
        textEl.textContent = line.text || '';
        if (line.buttonText) {
            nextBtn.textContent = line.buttonText;
        } else {
            nextBtn.innerHTML = index >= lines.length - 1 ? '好的' : '❯&nbsp;下一步';
        }
    };
    nextBtn.onclick = () => {
        index += 1;
        if (index >= lines.length) {
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
    if (isImageIconValue(icon)) applyPortraitCrop(portraitImgEl, icon);
}
