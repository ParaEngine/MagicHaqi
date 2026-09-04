import { escapeHtml, showToast } from './utils.js';
import { getPetSpriteCell, getProcessedSheet, SHEET_COLS, SHEET_ROWS } from './pet.js';
import { buildRewardShareCardSummary } from './reward_share_card_core.js';

const STYLE_ID = 'mh-reward-share-card-style';

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .mh-reward-share-mask{z-index:10020;align-items:center;padding:14px}
        .mh-reward-share-modal{width:min(430px,calc(100vw - 24px));padding:12px;background:#eef9f5;border-color:#8dd8c3}
        .mh-reward-share-preview{position:relative;aspect-ratio:4/5;overflow:hidden;border:1px solid #82cdb9;border-radius:8px;background:linear-gradient(160deg,#d9f5ea 0%,#f7fcf6 56%,#ffe7a8 100%);color:#163c3a;padding:24px;display:flex;flex-direction:column;box-shadow:0 10px 24px rgba(15,78,74,.16)}
        .mh-reward-share-brand{font-size:12px;font-weight:900;color:#0f766e}.mh-reward-share-title{margin-top:7px;font-size:25px;line-height:1.18;font-weight:900}
        .mh-reward-share-route{margin-top:7px;font-size:13px;font-weight:800;color:#3f625f}
        .mh-reward-share-pet{height:43%;display:grid;place-items:center;margin:5px 0}.mh-reward-share-pet-art{width:min(210px,58vw);height:min(210px,58vw);background-size:400% 400%;background-position:0 0;background-repeat:no-repeat;filter:drop-shadow(0 10px 9px rgba(15,78,74,.16))}.mh-reward-share-pet img{width:100%;height:100%;object-fit:contain}
        .mh-reward-share-highlights{display:grid;gap:6px;margin-top:auto}.mh-reward-share-highlight{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;align-items:center;padding:7px 9px;border:1px solid rgba(15,118,110,.2);border-radius:7px;background:rgba(255,255,255,.72)}
        .mh-reward-share-highlight i{font-style:normal;font-size:21px}.mh-reward-share-highlight b{display:block;font-size:12px}.mh-reward-share-highlight small{display:block;color:#52716d;font-size:10px;margin-top:1px}
        .mh-reward-share-memory{margin-top:10px;font-size:11px;line-height:1.4;font-weight:800;color:#365b57}.mh-reward-share-footer{display:flex;justify-content:space-between;margin-top:10px;color:#0f766e;font-size:10px;font-weight:900}
        .mh-reward-share-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:10px}.mh-reward-share-actions button{min-height:40px;padding:7px;font-size:12px}
        @media(max-width:420px){.mh-reward-share-preview{padding:18px}.mh-reward-share-title{font-size:21px}.mh-reward-share-actions{grid-template-columns:1fr 1fr}.mh-reward-share-actions [data-share-action="close"]{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
}

function petPreviewHtml(pet) {
    if (pet?.imageSheetUrl) {
        const cell = getPetSpriteCell({ ...pet, anim: 'happy' });
        const positionX = cell ? cell.col * 100 / (SHEET_COLS - 1) : 0;
        const positionY = cell ? cell.row * 100 / (SHEET_ROWS - 1) : 0;
        return `<div class="mh-reward-share-pet-art" style="background-image:url('${escapeHtml(pet.imageSheetUrl)}');background-position:${positionX}% ${positionY}%"></div>`;
    }
    if (pet?.imageUrl) return `<img src="${escapeHtml(pet.imageUrl)}" alt="${escapeHtml(pet.name || '伙伴')}">`;
    return '<span style="font-size:96px" aria-hidden="true">🥚</span>';
}

function highlightHtml(item) {
    return `<div class="mh-reward-share-highlight"><i aria-hidden="true">${escapeHtml(item.icon)}</i><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail)}</small></span></div>`;
}

function loadImage(src) {
    if (!src) return Promise.resolve(null);
    return new Promise(resolve => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    let line = '';
    let lineIndex = 0;
    for (const char of String(text || '')) {
        if (ctx.measureText(line + char).width <= maxWidth || !line) { line += char; continue; }
        ctx.fillText(line, x, y + lineIndex * lineHeight);
        line = char;
        lineIndex += 1;
        if (lineIndex >= maxLines) return;
    }
    if (line && lineIndex < maxLines) ctx.fillText(line, x, y + lineIndex * lineHeight);
}

async function drawShareCard(summary, pet) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, '#d9f5ea');
    background.addColorStop(.58, '#f7fcf6');
    background.addColorStop(1, '#ffe7a8');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#49a995';
    ctx.lineWidth = 8;
    ctx.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);

    ctx.fillStyle = '#0f766e';
    ctx.font = '900 32px sans-serif';
    ctx.fillText('MAGIC HAQI · 哈奇星球', 84, 112);
    ctx.fillStyle = '#163c3a';
    ctx.font = '900 62px sans-serif';
    wrapText(ctx, summary.title, 84, 196, 912, 72, 2);
    ctx.fillStyle = '#3f625f';
    ctx.font = '800 30px sans-serif';
    ctx.fillText(`远征地点 · ${summary.destination}`, 84, 292);

    let source = '';
    if (pet?.imageSheetUrl) {
        const processed = getProcessedSheet(pet.imageSheetUrl);
        if (processed?.promise) await processed.promise.catch(() => null);
        source = processed?.dataUrl || pet.imageSheetUrl;
    } else source = pet?.imageUrl || '';
    const image = await loadImage(source);
    if (image) {
        const cell = pet?.imageSheetUrl ? getPetSpriteCell({ ...pet, anim: 'happy' }) : null;
        if (cell) ctx.drawImage(image, image.width * cell.col / SHEET_COLS, image.height * cell.row / SHEET_ROWS, image.width / SHEET_COLS, image.height / SHEET_ROWS, 270, 330, 540, 540);
        else ctx.drawImage(image, 270, 330, 540, 540);
    } else {
        ctx.font = '180px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🥚', 540, 650);
        ctx.textAlign = 'left';
    }

    const highlights = summary.highlights.length ? summary.highlights : [{ icon: '🧭', title: '远征完成', detail: '这次经历已经写入探索档案' }];
    highlights.forEach((item, index) => {
        const y = 890 + index * 104;
        ctx.fillStyle = 'rgba(255,255,255,.78)';
        ctx.fillRect(84, y, 912, 84);
        ctx.font = '40px sans-serif';
        ctx.fillText(item.icon, 104, y + 57);
        ctx.fillStyle = '#163c3a';
        ctx.font = '900 27px sans-serif';
        ctx.fillText(item.title, 174, y + 34);
        ctx.fillStyle = '#52716d';
        ctx.font = '700 21px sans-serif';
        ctx.fillText(item.detail, 174, y + 64);
    });
    ctx.fillStyle = '#365b57';
    ctx.font = '800 23px sans-serif';
    wrapText(ctx, summary.experience, 84, 1245, 912, 31, 2);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
            const input = document.createElement('textarea');
            input.value = text;
            input.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }
        showToast('分享文案已复制', 'success', 1600);
        return true;
    } catch (_) {
        showToast('复制失败，请稍后重试', 'error', 2200);
        return false;
    }
}

async function saveOrShare(summary, pet) {
    const blob = await drawShareCard(summary, pet);
    if (!blob) return copyText(summary.shareText);
    const file = new File([blob], 'haqi-expedition-memory.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        try { await navigator.share({ title: summary.title, text: summary.shareText, files: [file] }); return true; } catch (_) {}
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 800);
    showToast('成果分享卡已保存', 'success', 1800);
    return true;
}

export function showRewardShareCard(data = {}, actions = {}) {
    ensureStyles();
    document.querySelector('.mh-reward-share-mask')?.remove();
    const summary = buildRewardShareCardSummary(data);
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-reward-share-mask';
    mask.innerHTML = `<div class="modal-card mh-reward-share-modal" role="dialog" aria-modal="true" aria-labelledby="mhRewardShareTitle">
        <section class="mh-reward-share-preview">
            <div class="mh-reward-share-brand">MAGIC HAQI · 哈奇星球</div>
            <div class="mh-reward-share-title" id="mhRewardShareTitle">${escapeHtml(summary.title)}</div>
            <div class="mh-reward-share-route">远征地点 · ${escapeHtml(summary.destination)}</div>
            <div class="mh-reward-share-pet">${petPreviewHtml(data.companion)}</div>
            <div class="mh-reward-share-highlights">${(summary.highlights.length ? summary.highlights : [{ icon: '🧭', title: '远征完成', detail: '这次经历已经写入探索档案' }]).map(highlightHtml).join('')}</div>
            <div class="mh-reward-share-memory">${escapeHtml(summary.experience)}</div>
            <div class="mh-reward-share-footer"><span>伙伴与冒险，每天都有新记忆</span><span>#哈奇星球</span></div>
        </section>
        <div class="mh-reward-share-actions"><button class="btn-secondary" type="button" data-share-action="copy">复制文案</button><button class="btn-primary" type="button" data-share-action="save">保存或分享</button><button class="btn-secondary" type="button" data-share-action="close">关闭</button></div>
    </div>`;
    mask.addEventListener('click', async event => {
        const action = event.target.closest?.('[data-share-action]')?.dataset.shareAction;
        if (!action && event.target !== mask) return;
        if (!action || action === 'close') { mask.remove(); return; }
        if (action === 'copy') await copyText(summary.shareText);
        if (action === 'save') {
            const button = event.target.closest('[data-share-action]');
            button.disabled = true;
            try { if (await saveOrShare(summary, data.companion)) actions.shared?.(summary); } finally { button.disabled = false; }
        }
    });
    document.body.appendChild(mask);
    mask.querySelector('[data-share-action="save"]')?.focus();
    return mask;
}