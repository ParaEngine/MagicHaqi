// 合影：在好友星球与对方宠物拍一张真实 canvas 照片。
// 参考 view_postcard.js，但区别在于：
//   - 生成一张真正的 canvas 照片（两只宠物的合影）；
//   - 只允许分享或保存到本地磁盘，不能像明信片那样"寄给别人"；
//   - 允许用户手动编辑照片文字，默认文字为"谁和谁的合影"。
import { escapeHtml, prompt, showToast } from './utils.js';
import { displayPetName, dnaToName } from './dna.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { buildEggSvg, getPetSpriteCell, getProcessedSheet, SHEET_COLS, SHEET_ROWS } from './pet.js';

const TAKEPHOTO_MAX_TEXT = 40;
const PHOTO_ANIM = 'happy';
// 点击宠物可循环切换的姿态。
const PHOTO_PET_ANIMS = ['happy', 'sad', 'sleep', 'idle'];
function nextPhotoPetAnim(anim) {
    const idx = PHOTO_PET_ANIMS.indexOf(anim);
    return PHOTO_PET_ANIMS[(idx + 1) % PHOTO_PET_ANIMS.length];
}

const PHOTO_THEMES = [
    { id: 'candy', sky: ['#ffe4f1', '#dff7ff'], ground: '#d9f99d', accent: '#f472b6' },
    { id: 'aurora', sky: ['#ccfbf1', '#dbeafe'], ground: '#bae6fd', accent: '#22d3ee' },
    { id: 'sunny', sky: ['#fef3c7', '#fed7aa'], ground: '#bbf7d0', accent: '#f59e0b' },
    { id: 'dream', sky: ['#e0e7ff', '#fbcfe8'], ground: '#ddd6fe', accent: '#a78bfa' },
];

// 取宠物实际名字（即使是幼崽阶段也显示其真实名字，而不是 "幼崽 #XXXX" 占位符）。
function petPhotoName(pet, fallback = '宠物') {
    const name = (pet?.name || '').trim();
    if (name) return name;
    const fromDna = (dnaToName(pet?.dna || '') || '').trim();
    if (fromDna) return fromDna;
    const shown = (displayPetName(pet) || '').trim();
    return shown || fallback;
}

export function defaultTakePhotoText(currentPet, friendPet) {
    const me = petPhotoName(currentPet, t('tpMyPet'));
    const friend = petPhotoName(friendPet, t('tpFriendPet'));
    return t('tpPhotoOf', { me, friend });
}

function randomPhotoTheme() {
    return PHOTO_THEMES[Math.floor(Math.random() * PHOTO_THEMES.length)] || PHOTO_THEMES[0];
}

function getPhotoTheme(id) {
    return PHOTO_THEMES.find(item => item.id === id) || PHOTO_THEMES[0];
}

async function loadPetSheetImage(pet) {
    const processed = pet?.imageSheetUrl ? getProcessedSheet(pet.imageSheetUrl) : null;
    if (processed?.promise) await processed.promise.catch(() => null);
    const sheetUrl = processed?.status === 'loaded' && processed.dataUrl ? processed.dataUrl : '';
    if (!sheetUrl) return null;
    return await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = sheetUrl;
    });
}

function loadImageUrl(url) {
    if (!url) return Promise.resolve(null);
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// 解析简单的 CSS linear-gradient(...) 字符串为 canvas 渐变；解析失败时返回纯色。
function applyCssBackgroundToCanvas(ctx, cssBackground, x, y, w, h) {
    const value = String(cssBackground || '').trim();
    const linear = value.match(/linear-gradient\(([^]*)\)/i);
    if (linear) {
        const inner = linear[1];
        // 拆分顶层逗号（颜色里没有逗号的 hex/named，rgb()/rgba() 用括号匹配处理）
        const parts = [];
        let depth = 0, cur = '';
        for (const ch of inner) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
            else cur += ch;
        }
        if (cur.trim()) parts.push(cur.trim());
        let stops = parts;
        // 第一段若是角度/方向（含 deg 或 to ...），跳过——画布按竖直渐变绘制即可。
        if (stops.length && (/deg|to\s/i.test(stops[0]) && !/#|rgb|hsl/i.test(stops[0].split(/\s+/)[0]))) {
            stops = stops.slice(1);
        }
        const colorStops = stops.map((seg, i) => {
            const m = seg.match(/(.*?)(?:\s+([\d.]+)%)?$/);
            const color = (m?.[1] || seg).trim();
            const pos = m?.[2] != null ? Math.max(0, Math.min(1, parseFloat(m[2]) / 100))
                : (stops.length > 1 ? i / (stops.length - 1) : 0);
            return { color, pos };
        }).filter(s => s.color);
        if (colorStops.length >= 2) {
            const grad = ctx.createLinearGradient(x, y, x, y + h);
            colorStops.forEach(s => { try { grad.addColorStop(s.pos, s.color); } catch (_) {} });
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, w, h);
            return true;
        }
        if (colorStops.length === 1) {
            ctx.fillStyle = colorStops[0].color;
            ctx.fillRect(x, y, w, h);
            return true;
        }
    }
    if (value) {
        try { ctx.fillStyle = value; ctx.fillRect(x, y, w, h); return true; } catch (_) {}
    }
    return false;
}

// 以 cover 方式把图片绘制到指定矩形区域。offset.x/y 为 -1..1 的平移比例（仅在该轴有富余裁切空间时生效）。
function drawImageCover(ctx, img, x, y, w, h, offset = null) {
    const ir = img.width / img.height;
    const dr = w / h;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (ir > dr) { sw = img.height * dr; sx = (img.width - sw) / 2; }
    else { sh = img.width / dr; sy = (img.height - sh) / 2; }
    if (offset) {
        const ox = Math.max(-1, Math.min(1, Number(offset.x) || 0));
        const oy = Math.max(-1, Math.min(1, Number(offset.y) || 0));
        // 正方向：背景向右/下移动 => 取景窗向左/上 => 减少 sx/sy。
        sx = Math.max(0, Math.min(img.width - sw, sx - ox * sx));
        sy = Math.max(0, Math.min(img.height - sh, sy - oy * sy));
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function wrapCanvasTextCentered(ctx, text, centerX, y, maxWidth, lineHeight, maxLines) {
    const chars = String(text || '').split('');
    const lines = [];
    let line = '';
    for (const char of chars) {
        const test = line + char;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = char;
            if (lines.length >= maxLines) break;
        } else line = test;
    }
    if (line && lines.length < maxLines) lines.push(line);
    lines.forEach((ln, i) => ctx.fillText(ln, centerX, y + i * lineHeight));
}

function drawPetOnCanvas(ctx, pet, image, x, y, w, h, anim = PHOTO_ANIM, flip = false) {
    if (image) {
        const cell = getPetSpriteCell({ ...pet, anim });
        if (cell) {
            ctx.save();
            if (flip) {
                // 水平镜像：以宠物中心翻转。
                ctx.translate(x + w / 2, 0);
                ctx.scale(-1, 1);
                ctx.translate(-(x + w / 2), 0);
            }
            ctx.drawImage(
                image,
                image.width * cell.col / SHEET_COLS,
                image.height * cell.row / SHEET_ROWS,
                image.width / SHEET_COLS,
                image.height / SHEET_ROWS,
                x, y, w, h,
            );
            ctx.restore();
            return;
        }
    }
    ctx.save();
    ctx.font = `${Math.round(h * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🥚', x + w / 2, y + h / 2);
    ctx.restore();
}

/**
 * 生成一张合影照片（两只宠物并排），返回 PNG Blob。
 * background: { imageUrl, gradient } —— 拍照时 level_field 的真实背景。
 * bgOffset: { x, y } 背景平移比例（仅图片背景）；petOffsets: [{x,y},{x,y}] 两只宠物的归一化位移。
 */
export async function drawTakePhotoImage(currentPet, friendPet, text, themeId = '', planetName = '', background = null, opts = {}) {
    const theme = getPhotoTheme(themeId);
    const message = text || defaultTakePhotoText(currentPet, friendPet);
    const bgOffset = opts.bgOffset || { x: 0, y: 0 };
    const petOffsets = opts.petOffsets || [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const petAnims = opts.petAnims || [PHOTO_ANIM, PHOTO_ANIM];
    const petFlips = opts.petFlips || [false, false];
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    // 照片取景区域采用 5:4 比例（与预览一致），余下空间放标题/文字。
    const photoX = 72;
    const photoY = 96;
    const photoW = canvas.width - 144;
    const photoH = Math.round(photoW * 4 / 5);
    canvas.height = photoY + photoH + 150;
    const ctx = canvas.getContext('2d');

    // 外框
    ctx.fillStyle = '#0f2d4d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 36, 36, canvas.width - 72, canvas.height - 72, 30);
    ctx.fill();

    // 照片取景区域：优先使用拍照时 level_field 的真实背景。
    const bgImageUrl = background?.imageUrl || '';
    const bgGradient = background?.gradient || '';
    const [imgA, imgB, bgImg] = await Promise.all([
        loadPetSheetImage(currentPet),
        loadPetSheetImage(friendPet),
        loadImageUrl(bgImageUrl),
    ]);
    ctx.save();
    roundRect(ctx, photoX, photoY, photoW, photoH, 22);
    ctx.clip();
    let drewRealBg = false;
    if (bgImg) {
        drawImageCover(ctx, bgImg, photoX, photoY, photoW, photoH, bgOffset);
        drewRealBg = true;
    } else if (bgGradient) {
        drewRealBg = applyCssBackgroundToCanvas(ctx, bgGradient, photoX, photoY, photoW, photoH);
    }
    if (!drewRealBg) {
        // 回退：使用主题渐变 + 远处星球 + 地面装饰。
        const sky = ctx.createLinearGradient(photoX, photoY, photoX, photoY + photoH);
        sky.addColorStop(0, theme.sky[0]);
        sky.addColorStop(1, theme.sky[1]);
        ctx.fillStyle = sky;
        ctx.fillRect(photoX, photoY, photoW, photoH);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(photoX + photoW - 110, photoY + 120, 56, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.32;
        ctx.beginPath();
        ctx.arc(photoX + photoW - 110, photoY + 120, 56, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const groundTop = photoY + photoH - 150;
        ctx.fillStyle = theme.ground;
        roundRect(ctx, photoX - 30, groundTop, photoW + 60, 300, 140);
        ctx.fill();
    }
    const gap = 40;
    // 让两只宠物完整落在取景框内：宠物底部留出 footMargin，避免被裁切。
    const footMargin = 70;
    const petBottom = photoY + photoH - footMargin;
    const maxPetW = (photoW - gap - 48) / 2;
    const petSize = Math.min(280, maxPetW, photoH - 200);
    const baselineY = petBottom - petSize;
    const totalW = petSize * 2 + gap;
    const startX = photoX + (photoW - totalW) / 2;
    // 把归一化位移转换为像素，并限制宠物不要移出取景框。
    const clampPetX = (baseX, dx) => Math.max(photoX + 6, Math.min(photoX + photoW - petSize - 6, baseX + dx * photoW));
    const clampPetY = (baseY, dy) => Math.max(photoY + 6, Math.min(photoY + photoH - petSize - 6, baseY + dy * photoH));
    const off0 = petOffsets[0] || { x: 0, y: 0 };
    const off1 = petOffsets[1] || { x: 0, y: 0 };
    const p0x = clampPetX(startX, off0.x);
    const p0y = clampPetY(baselineY, off0.y);
    const p1x = clampPetX(startX + petSize + gap, off1.x);
    const p1y = clampPetY(baselineY, off1.y);
    // 阴影（贴在每只宠物脚下）
    ctx.fillStyle = 'rgba(15,23,42,0.16)';
    ctx.beginPath();
    ctx.ellipse(p0x + petSize / 2, p0y + petSize - 10, petSize * 0.34, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p1x + petSize / 2, p1y + petSize - 10, petSize * 0.34, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPetOnCanvas(ctx, currentPet, imgA, p0x, p0y, petSize, petSize, petAnims[0] || PHOTO_ANIM, !!petFlips[0]);
    drawPetOnCanvas(ctx, friendPet, imgB, p1x, p1y, petSize, petSize, petAnims[1] || PHOTO_ANIM, !!petFlips[1]);

    // 爱心点缀（位于两只宠物之间上方）
    const heartX = (p0x + petSize / 2 + p1x + petSize / 2) / 2;
    const heartY = Math.min(p0y, p1y) + petSize * 0.4;
    ctx.font = '40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💖', heartX, heartY);
    ctx.font = '28px sans-serif';
    ctx.fillText('✨', heartX - 40, heartY + petSize * 0.2);
    ctx.fillText('💕', heartX + 40, heartY + petSize * 0.26);
    ctx.textAlign = 'left';
    ctx.restore();

    // 文字区（居中换行）
    ctx.fillStyle = '#17375e';
    ctx.font = '800 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapCanvasTextCentered(ctx, message, canvas.width / 2, photoY + photoH + 72, canvas.width - 160, 42, 2);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function buildPhotoPreviewHtml(currentPet, friendPet, text, themeId, planetName, background = null, petAnims = [PHOTO_ANIM, PHOTO_ANIM], petFlips = [false, false]) {
    const theme = getPhotoTheme(themeId);
    const me = petPhotoName(currentPet, t('tpMyPet'));
    const friend = petPhotoName(friendPet, t('tpFriendPet'));
    const petArt = (pet, anim, flip) => {
        const flipStyle = flip ? 'transform:scaleX(-1);' : '';
        const cell = getPetSpriteCell({ ...pet, anim });
        const processed = pet?.imageSheetUrl ? getProcessedSheet(pet.imageSheetUrl) : null;
        const url = processed?.status === 'loaded' && processed.dataUrl ? processed.dataUrl : '';
        if (!cell || !url) {
            return `<div class="mh-photo-pet-egg" style="${flipStyle}">${buildEggSvg(pet)}</div>`;
        }
        const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
        const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
        return `<div class="mh-photo-pet-art" style="${flipStyle}background-image:url('${escapeHtml(url)}');background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;image-rendering:pixelated"></div>`;
    };
    const bgImageUrl = background?.imageUrl || '';
    const bgGradient = background?.gradient || '';
    const hasRealBg = !!(bgImageUrl || bgGradient);
    const draggableBg = !!bgImageUrl; // 仅图片背景可拖动
    const sceneStyle = bgImageUrl
        ? `background-image:url('${escapeHtml(bgImageUrl)}');background-size:cover;background-position:50% 50%`
        : (bgGradient ? `background:${escapeHtml(bgGradient)}` : '');
    return `
        <div class="mh-photo-card${hasRealBg ? ' mh-photo-has-bg' : ''}" style="--mh-photo-sky-1:${theme.sky[0]};--mh-photo-sky-2:${theme.sky[1]};--mh-photo-ground:${theme.ground}">
            <div class="mh-photo-scene${draggableBg ? ' mh-photo-bg-draggable' : ''}" data-photo-scene${draggableBg ? ' data-photo-bg-draggable="1"' : ''}${sceneStyle ? ` style="${sceneStyle}"` : ''}>
                ${hasRealBg ? '' : '<div class="mh-photo-planet" aria-hidden="true"></div><div class="mh-photo-ground" aria-hidden="true"></div>'}
                <div class="mh-photo-pets">
                    <div class="mh-photo-pet" data-photo-pet-index="0" title="${escapeHtml(t('tpPosePlay', { name: me }))}">${petArt(currentPet, petAnims[0] || PHOTO_ANIM, !!petFlips[0])}</div>
                    <div class="mh-photo-hearts" aria-hidden="true">💖</div>
                    <div class="mh-photo-pet" data-photo-pet-index="1" title="${escapeHtml(t('tpPosePlay', { name: friend }))}">${petArt(friendPet, petAnims[1] || PHOTO_ANIM, !!petFlips[1])}</div>
                </div>
            </div>
            <div class="mh-photo-caption" data-photo-caption>${escapeHtml(text)}</div>
        </div>`;
}

let photoStylesInjected = false;
function injectTakePhotoStyles() {
    if (photoStylesInjected || document.getElementById('mhTakePhotoStyles')) return;
    photoStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'mhTakePhotoStyles';
    style.textContent = `
        .mh-photo-modal-card { max-width: 420px; width: 94vw; }
        .mh-photo-head { text-align: center; margin-bottom: 10px; }
        .mh-photo-card { background:#fff; border:4px solid #fff; border-radius:18px; box-shadow:0 12px 30px rgba(0,0,0,0.28); overflow:hidden; }
        .mh-photo-scene { position:relative; aspect-ratio: 5 / 4; background:linear-gradient(180deg, var(--mh-photo-sky-1,#ffe4f1), var(--mh-photo-sky-2,#dff7ff)); overflow:hidden; touch-action:none; }
        .mh-photo-scene.mh-photo-bg-draggable { cursor:grab; }
        .mh-photo-scene.mh-photo-bg-draggable.is-dragging-bg { cursor:grabbing; }
        .mh-photo-planet { position:absolute; right:10%; top:14%; width:64px; height:64px; border-radius:50%; background:radial-gradient(circle at 32% 28%, #fff, #93c5fd 60%, #1d4ed8 100%); box-shadow:0 0 18px rgba(147,197,253,0.6); }
        .mh-photo-ground { position:absolute; left:-8%; right:-8%; bottom:-22%; height:46%; border-radius:50% 50% 0 0; background:var(--mh-photo-ground,#d9f99d); }
        .mh-photo-badge { position:absolute; left:10px; top:10px; z-index:3; padding:3px 10px; border-radius:10px; background:rgba(15,45,77,0.78); color:#fff7cc; font-weight:700; font-size:12px; pointer-events:none; }
        .mh-photo-pets { position:absolute; left:0; right:0; bottom:8%; z-index:2; display:flex; align-items:flex-end; justify-content:center; gap:6px; pointer-events:none; }
        .mh-photo-pet { width:38%; aspect-ratio:1; position:relative; cursor:grab; pointer-events:auto; touch-action:none; will-change:transform; }
        .mh-photo-pet.is-dragging { cursor:grabbing; z-index:5; }
        .mh-photo-pet-art { width:100%; height:100%; }
        .mh-photo-pet-egg { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
        .mh-photo-pet-egg svg { width:70%; height:70%; }
        .mh-photo-hearts { align-self:center; font-size:26px; filter:drop-shadow(0 2px 5px rgba(244,114,182,0.5)); animation:mhPhotoHeartBeat 1.4s ease-in-out infinite; }
        @keyframes mhPhotoHeartBeat { 0%,100% { transform:scale(1); } 50% { transform:scale(1.18); } }
        .mh-photo-caption { padding:12px 14px; text-align:center; font-weight:800; color:#17375e; font-size:15px; line-height:1.4; cursor:text; }
        .mh-photo-caption::after { content:'  ✎'; color:#94a3b8; font-size:12px; }
        .mh-photo-actions { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:14px; }
    `;
    document.head.appendChild(style);
}

function openPhotoModal(innerHtml, onClick) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal-card mh-photo-modal-card">${innerHtml}</div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-act="close"]')) { close(); return; }
        onClick?.(e, close);
    });
    document.body.appendChild(mask);
    return { mask, close };
}

async function savePhotoToDisk(blob, fileName) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

// 把 photoState 中的拖动位移应用到预览 DOM（宠物 transform + 背景 background-position）。
function applyPhotoDragOffsets(root, photoState) {
    const scene = root.querySelector('[data-photo-scene]');
    if (!scene) return;
    const rect = scene.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    root.querySelectorAll('[data-photo-pet-index]').forEach((el) => {
        const idx = Number(el.dataset.photoPetIndex) || 0;
        const off = photoState.petOffsets[idx] || { x: 0, y: 0 };
        el.style.transform = `translate(${(off.x * w).toFixed(1)}px, ${(off.y * h).toFixed(1)}px)`;
    });
    if (scene.dataset.photoBgDraggable === '1') {
        // background-position 百分比：0%→显示左/上边缘，100%→右/下边缘，50% 居中。
        const px = (50 - (photoState.bgOffset.x || 0) * 50).toFixed(2);
        const py = (50 - (photoState.bgOffset.y || 0) * 50).toFixed(2);
        scene.style.backgroundPosition = `${px}% ${py}%`;
    }
}

// 绑定宠物 / 背景的拖动手势；
//   - 单击（未移动）宠物 -> onPetTap 切换姿势；
//   - 双击宠物 -> onPetDoubleTap 左右翻转。
function bindPhotoDrag(root, photoState, onPetTap, onPetDoubleTap) {
    const scene = root.querySelector('[data-photo-scene]');
    if (!scene) return;
    let drag = null;
    const TAP_THRESHOLD = 6; // 像素；移动小于此值视为点击。
    const DOUBLE_TAP_MS = 280; // 两次点击间隔小于此值视为双击。
    let pendingTap = null; // { idx, timer } —— 等待确认是否为双击的单击。
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const onPointerDown = (e) => {
        const petEl = e.target.closest?.('[data-photo-pet-index]');
        const rect = scene.getBoundingClientRect();
        if (petEl) {
            const idx = Number(petEl.dataset.photoPetIndex) || 0;
            drag = { type: 'pet', idx, el: petEl, startX: e.clientX, startY: e.clientY, w: rect.width || 1, h: rect.height || 1, base: { ...(photoState.petOffsets[idx] || { x: 0, y: 0 }) }, moved: false };
            petEl.classList.add('is-dragging');
        } else if (scene.dataset.photoBgDraggable === '1') {
            drag = { type: 'bg', startX: e.clientX, startY: e.clientY, w: rect.width || 1, h: rect.height || 1, base: { ...photoState.bgOffset }, moved: false };
            scene.classList.add('is-dragging-bg');
        } else {
            return;
        }
        try { (drag.el || scene).setPointerCapture?.(e.pointerId); } catch (_) {}
        e.preventDefault();
    };
    const onPointerMove = (e) => {
        if (!drag) return;
        const rawDx = e.clientX - drag.startX;
        const rawDy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(rawDx, rawDy) > TAP_THRESHOLD) drag.moved = true;
        const dx = rawDx / drag.w;
        const dy = rawDy / drag.h;
        if (drag.type === 'pet') {
            photoState.petOffsets[drag.idx] = {
                x: clamp(drag.base.x + dx, -0.45, 0.45),
                y: clamp(drag.base.y + dy, -0.6, 0.25),
            };
        } else {
            photoState.bgOffset = {
                x: clamp(drag.base.x + dx * 2, -1, 1),
                y: clamp(drag.base.y + dy * 2, -1, 1),
            };
        }
        applyPhotoDragOffsets(root, photoState);
    };
    const onPointerUp = () => {
        if (!drag) return;
        const wasTap = drag.type === 'pet' && !drag.moved;
        const tapIdx = drag.idx;
        drag.el?.classList.remove('is-dragging');
        scene.classList.remove('is-dragging-bg');
        drag = null;
        if (!wasTap) return;
        // 双击同一只宠物 -> 翻转；否则延迟确认为单击 -> 切换姿势。
        if (pendingTap && pendingTap.idx === tapIdx) {
            clearTimeout(pendingTap.timer);
            pendingTap = null;
            onPetDoubleTap?.(tapIdx);
            return;
        }
        if (pendingTap) { clearTimeout(pendingTap.timer); pendingTap = null; }
        const idx = tapIdx;
        const timer = setTimeout(() => {
            pendingTap = null;
            onPetTap?.(idx);
        }, DOUBLE_TAP_MS);
        pendingTap = { idx, timer };
    };
    scene.addEventListener('pointerdown', onPointerDown);
    scene.addEventListener('pointermove', onPointerMove);
    scene.addEventListener('pointerup', onPointerUp);
    scene.addEventListener('pointercancel', onPointerUp);
}

/**
 * 打开合影窗口：展示合影预览，允许编辑文字、拖动宠物/背景、分享或保存到本地。
 */
export function showTakePhotoWindow({ currentPet = null, friendPet = null, planetName = '', background = null } = {}) {
    if (!currentPet || !friendPet) {
        showToast(t('tpNeedTwo'), 'info', 1800);
        return;
    }
    injectTakePhotoStyles();
    const resolvedPlanet = planetName || state.visitingMode?.planetName || '';
    const photoState = {
        text: defaultTakePhotoText(currentPet, friendPet),
        themeId: randomPhotoTheme().id,
        background: background || null,
        bgOffset: { x: 0, y: 0 },
        petOffsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
        petAnims: [PHOTO_ANIM, PHOTO_ANIM],
        petFlips: [false, false],
    };
    const canDragBg = !!photoState.background?.imageUrl;
    const dragHint = canDragBg ? t('tpDragHintBg') : t('tpDragHint');
    // 单击（未拖动）宠物时循环切换姿态。
    const cyclePetAnim = (root, idx) => {
        photoState.petAnims[idx] = nextPhotoPetAnim(photoState.petAnims[idx] || PHOTO_ANIM);
        renderPreview(root);
    };
    // 双击宠物时左右翻转。
    const flipPet = (root, idx) => {
        photoState.petFlips[idx] = !photoState.petFlips[idx];
        renderPreview(root);
    };
    const renderPreview = (root) => {
        const host = root.querySelector('[data-photo-preview-host]');
        if (!host) return;
        host.innerHTML = buildPhotoPreviewHtml(currentPet, friendPet, photoState.text, photoState.themeId, resolvedPlanet, photoState.background, photoState.petAnims, photoState.petFlips);
        bindPhotoDrag(root, photoState, (idx) => cyclePetAnim(root, idx), (idx) => flipPet(root, idx));
        applyPhotoDragOffsets(root, photoState);
    };
    const { mask } = openPhotoModal(`
        <div class="mh-photo-head">
            <div class="planet-modal-title">${escapeHtml(t('tpTitle'))}</div>
            <div class="planet-modal-subtitle">${dragHint}${escapeHtml(t('tpTapTextEdit'))}</div>
        </div>
        <div data-photo-preview-host>${buildPhotoPreviewHtml(currentPet, friendPet, photoState.text, photoState.themeId, resolvedPlanet, photoState.background, photoState.petAnims, photoState.petFlips)}</div>
        <div class="mh-photo-actions">
            <button class="btn-secondary" data-act="close">${escapeHtml(t('close'))}</button>
            <button class="btn-secondary" data-photo-act="reset">↺ ${escapeHtml(t('tpReset'))}</button>
            <button class="btn-secondary" data-photo-act="share">${escapeHtml(t('tpShare'))}</button>
            <button class="btn-primary" data-photo-act="save">${escapeHtml(t('tpSaveLocal'))}</button>
        </div>
    `, async (e) => {
        const root = e.currentTarget;
        if (e.target.closest?.('[data-photo-caption]')) {
            const custom = await prompt(t('tpEditTitle'), {
                defaultValue: photoState.text,
                placeholder: t('tpEditPlaceholder'),
                okText: t('save'),
                maxLength: TAKEPHOTO_MAX_TEXT,
            });
            if (custom != null && custom !== '') {
                photoState.text = custom;
                renderPreview(root);
            }
            return;
        }
        const actBtn = e.target.closest?.('[data-photo-act]');
        if (!actBtn) return;
        const act = actBtn.dataset.photoAct;
        if (act === 'reset') {
            photoState.bgOffset = { x: 0, y: 0 };
            photoState.petOffsets = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
            photoState.petAnims = [PHOTO_ANIM, PHOTO_ANIM];
            photoState.petFlips = [false, false];
            renderPreview(root);
            return;
        }
        if (act === 'share' || act === 'save') {
            actBtn.disabled = true;
            try {
                const blob = await drawTakePhotoImage(currentPet, friendPet, photoState.text, photoState.themeId, resolvedPlanet, photoState.background, {
                    bgOffset: photoState.bgOffset,
                    petOffsets: photoState.petOffsets,
                    petAnims: photoState.petAnims,
                    petFlips: photoState.petFlips,
                });
                if (!blob) { showToast(t('tpGenFailed'), 'error', 2200); return; }
                const fileName = `${currentPet?.id || 'pet'}-${t('tpFileName')}.png`;
                if (act === 'share') {
                    const file = new File([blob], fileName, { type: 'image/png' });
                    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
                        try { await navigator.share({ title: t('tpShareTitle'), text: photoState.text, files: [file] }); return; } catch (_) {}
                    }
                    await savePhotoToDisk(blob, fileName);
                    showToast(t('tpImageDone'), 'success', 1600);
                } else {
                    await savePhotoToDisk(blob, fileName);
                    showToast(t('tpSavedLocal'), 'success', 1600);
                }
            } finally {
                actBtn.disabled = false;
            }
        }
    });
    // 初始绑定拖动手势 + 应用位移。
    bindPhotoDrag(mask, photoState, (idx) => cyclePetAnim(mask, idx), (idx) => flipPet(mask, idx));
    applyPhotoDragOffsets(mask, photoState);
    return mask;
}
