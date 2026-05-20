// 宠物明信片渲染：分享弹窗、收件箱和明信片查看页共用。
import { escapeHtml, showToast } from './utils.js';
import { displayPetName } from './dna.js';
import { CONFIG } from './config.js';
import { notify, state } from './state.js';
import { addPostcardRecord, saveUserProfile } from './storage.js';
import { buildEggSvg, getPetSpriteCell, SHEET_COLS, SHEET_ROWS } from './pet.js';

export const POSTCARD_ANIMS = ['idle', 'happy', 'sad', 'sleep'];
export const POSTCARD_TEXTS = ['宠物寻找好友', '寻宠启示', '来我的星球做客吧', '一起认识我的宠物', '星际好友邀请'];

export function defaultPostcardText(pet) {
    const name = displayPetName(pet) || '我的宠物';
    if (pet?.anim === 'sleep') return `${name}正在睡觉，醒来想认识新朋友。`;
    return `${name}正在寻找星际好友，来我的宠物星做客吧。`;
}

export function normalizePostcardLayout(layout, pet = null) {
    if (Array.isArray(layout)) return layout.filter(anim => POSTCARD_ANIMS.includes(anim)).slice(0, 4);
    const raw = String(layout || '').trim();
    if (raw && /[a-z]/i.test(raw)) {
        const list = raw.split(/[,.|_-]+/).filter(anim => POSTCARD_ANIMS.includes(anim));
        if (list.length) return list.slice(0, 4);
    }
    const count = Math.max(1, Math.min(4, Number(raw) || 1));
    const first = pet?.anim === 'sleep' ? 'sleep' : 'idle';
    const rest = POSTCARD_ANIMS.filter(anim => anim !== first);
    return [first, ...rest].slice(0, count);
}

export function serializePostcardLayout(layout, pet = null) {
    return normalizePostcardLayout(layout, pet).join(',');
}

function photoStyle(pet, anim) {
    const previewPet = { ...pet, anim };
    const cell = getPetSpriteCell(previewPet);
    if (!previewPet?.imageSheetUrl || !cell) return '';
    const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    return `background-image:url('${escapeHtml(previewPet.imageSheetUrl)}');background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;background-color:#f8fafc;image-rendering:pixelated`;
}

function photoHtml(pet, anim) {
    const style = photoStyle(pet, anim);
    if (!style) return `<div class="pet-postcard-photo pet-postcard-photo-egg"><div class="pet-postcard-photo-art">${buildEggSvg(pet)}</div></div>`;
    return `<div class="pet-postcard-photo" data-postcard-photo-anim="${escapeHtml(anim)}"><div class="pet-postcard-photo-art" style="${style}"></div></div>`;
}

export function renderPetPostcardHtml(pet, { layout = 1, text = '', interactive = false } = {}) {
    const anims = normalizePostcardLayout(layout, pet);
    const safeText = text || defaultPostcardText(pet);
    const actionAttrs = interactive
        ? ' role="button" tabindex="0" title="点击切换照片" data-postcard-image-toggle="1"'
        : '';
    const textAttrs = interactive
        ? ' role="button" tabindex="0" title="点击切换文字" data-postcard-text-toggle="1"'
        : '';
    const editButton = interactive
        ? '<button class="pet-postcard-edit-btn" data-share-edit-text type="button" title="编辑文字" aria-label="编辑文字">✏️</button>'
        : '';
    return `
        <div class="pet-postcard pet-postcard-count-${anims.length}" data-postcard-layout="${escapeHtml(serializePostcardLayout(anims, pet))}">
            <div class="pet-postcard-stamp">好友邀请</div>
            <div class="pet-postcard-title">${escapeHtml(displayPetName(pet) || '我的宠物')}</div>
            <div class="pet-postcard-photo-grid"${actionAttrs}>
                ${anims.map(anim => photoHtml(pet, anim)).join('')}
            </div>
            <div class="pet-postcard-message" data-postcard-message${textAttrs}>
                ${editButton}
                <span>${escapeHtml(safeText)}</span>
            </div>
        </div>`;
}

export function parsePostcardParams() {
    const url = new URL(window.location.href);
    const postcardFrom = (url.searchParams.get('postcardFrom') || url.searchParams.get('inviteFrom') || '').trim();
    const petId = (url.searchParams.get('petId') || '').trim();
    const layout = (url.searchParams.get('layout') || 'idle').trim();
    const text = (url.searchParams.get('text') || '宠物寻找好友').trim();
    return { fromUsername: postcardFrom, petId, layout, text };
}

export function hasPostcardParams() {
    try {
        const params = parsePostcardParams();
        return !!(params.fromUsername && params.petId);
    } catch (_) {
        return false;
    }
}

function safeIdPart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

async function readRemotePet(fromUsername, petId) {
    if (!fromUsername || !petId || !state.sdk?.personalPageStore?.readFile) return null;
    const path = `//${fromUsername}/edunotes/store/${CONFIG.workspace}/pets/${petId}.json`;
    try {
        const text = await state.sdk.personalPageStore.readFile(path, 1, 99999);
        if (!text) return null;
        const pet = JSON.parse(text);
        if (!pet || typeof pet !== 'object') return null;
        return { ...pet, id: `invite_${safeIdPart(fromUsername)}_${safeIdPart(pet.id || petId)}` };
    } catch (e) {
        console.warn('读取明信片宠物失败', e);
        return null;
    }
}

function fallbackPostcardPet(postcard) {
    return {
        id: `invite_${safeIdPart(postcard.fromUsername)}_${safeIdPart(postcard.petId)}`,
        name: `${postcard.fromUsername || '好友'}的宠物`,
        stage: 'egg',
        anim: 'idle',
        bornAt: Date.now(),
        imageUrl: null,
        imageSheetUrl: null,
    };
}

async function resolveUserId(username) {
    if (!username || !state.sdk?.get) return null;
    const candidates = [
        () => state.sdk.get(`/users/${encodeURIComponent(username)}`),
        () => state.sdk.get('/users/search', { username }),
        () => state.sdk.get('/users', { username }),
    ];
    for (const load of candidates) {
        try {
            const result = await load();
            const user = Array.isArray(result) ? result[0] : (Array.isArray(result?.rows) ? result.rows[0] : result?.user || result);
            const id = user?.id || user?.userId || user?._id;
            if (id) return id;
        } catch (_) {}
    }
    return null;
}

async function applyFriend(fromUsername, text) {
    if (!fromUsername || !state.sdk?.socialFriends?.applyFriend) return 'skipped';
    try {
        const userId = await resolveUserId(fromUsername);
        if (!userId) return 'user-not-found';
        await state.sdk.socialFriends.applyFriend(userId, text || '来自魔法哈奇的宠物好友申请');
        return 'requested';
    } catch (e) {
        const msg = String(e?.message || e || '');
        if (/already|exist|friend|重复|已经/i.test(msg)) return 'already';
        console.warn('好友申请失败', e);
        return 'failed';
    }
}

function friendStatusText(status) {
    if (status === 'requested') return '已发送好友申请';
    if (status === 'already') return '已经是好友';
    if (status === 'user-not-found') return '没有找到这个用户';
    if (status === 'failed') return '好友申请失败，请稍后再试';
    return '暂时无法发送好友申请';
}

function addVisitingPet(postcard, pet) {
    const record = {
        id: `${postcard.fromUsername || 'friend'}:${postcard.petId || pet.id}`,
        from: postcard.fromUsername,
        petId: postcard.petId,
        text: postcard.text,
        layout: postcard.layout,
        acceptedAt: Date.now(),
        friendStatus: '',
        pet,
    };
    const existing = Array.isArray(state.invitedPets) ? state.invitedPets : [];
    state.invitedPets = [record, ...existing.filter(item => item?.id !== record.id)].slice(0, 10);
    state.activeInvitedPet = record;
    state.currentField = 'land';
    state.lastHomeZoomLevel = 1;
    return record;
}

function cleanupPostcardUrl() {
    try {
        const url = new URL(window.location.href);
        ['postcardFrom', 'inviteFrom', 'petId', 'layout', 'text'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

export function renderPostcard(panel, data = {}, { onBack, onPlay } = {}) {
    const postcard = data?.postcard || parsePostcardParams();
    if (!postcard.fromUsername || !postcard.petId) {
        panel.innerHTML = `
            <div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">明信片</span><span style="width:36px;height:36px"></span></div>
            <div class="invite-view"><div class="card-flat text-center" style="padding:24px;color:var(--text-muted)">明信片链接不完整。</div></div>`;
        const back = document.getElementById('mhBack');
        if (back) back.onclick = () => onBack?.();
        return;
    }

    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">来自 ${escapeHtml(postcard.fromUsername)} 的明信片</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="invite-view mh-postcard-view">
            <div class="invite-card">
                <div class="invite-status" data-postcard-status>正在读取宠物资料...</div>
                <div data-postcard-preview></div>
                <div class="invite-actions mh-postcard-actions">
                    <button class="btn-secondary" data-postcard-friend disabled>加好友</button>
                    <button class="btn-primary" data-postcard-play disabled>一起玩</button>
                </div>
            </div>
        </div>`;
    const back = document.getElementById('mhBack');
    if (back) back.onclick = () => onBack?.();
    const statusEl = panel.querySelector('[data-postcard-status]');
    const previewEl = panel.querySelector('[data-postcard-preview]');
    const friendBtn = panel.querySelector('[data-postcard-friend]');
    const playBtn = panel.querySelector('[data-postcard-play]');

    (async () => {
        const remotePet = await readRemotePet(postcard.fromUsername, postcard.petId);
        const pet = remotePet || fallbackPostcardPet(postcard);
        await addPostcardRecord({ ...postcard, dateReceived: postcard.dateReceived || Date.now() });
        if (previewEl) previewEl.innerHTML = renderPetPostcardHtml(pet, { layout: postcard.layout, text: postcard.text });
        if (statusEl) statusEl.textContent = `${displayPetName(pet)} 正在等你回应`;
        if (friendBtn) friendBtn.disabled = false;
        if (playBtn) playBtn.disabled = false;
        friendBtn.onclick = async () => {
            friendBtn.disabled = true;
            const status = await applyFriend(postcard.fromUsername, postcard.text);
            showToast(friendStatusText(status), status === 'failed' || status === 'user-not-found' ? 'error' : 'success', 1800);
            friendBtn.disabled = false;
        };
        playBtn.onclick = async () => {
            addVisitingPet(postcard, pet);
            await saveUserProfile();
            cleanupPostcardUrl();
            showToast(`${displayPetName(pet)} 来你的星球玩啦`, 'success', 1800);
            notify();
            onPlay?.();
        };
    })().catch((e) => {
        console.error('处理明信片失败', e);
        if (statusEl) statusEl.textContent = '处理明信片失败，请稍后再试。';
    });
}

export async function drawPetPostcardImage(pet, layout, text) {
    const anims = normalizePostcardLayout(layout, pet);
    const message = text || defaultPostcardText(pet);
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1180;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#dff6fb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 54, 54, canvas.width - 108, canvas.height - 108, 34);
    ctx.fill();
    ctx.strokeStyle = '#8bd7ef';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#0f2d4d';
    ctx.font = '800 40px sans-serif';
    ctx.fillText(displayPetName(pet) || '我的宠物', 104, 140);
    ctx.fillStyle = '#fef3c7';
    roundRect(ctx, canvas.width - 250, 92, 144, 48, 14);
    ctx.fill();
    ctx.fillStyle = '#92400e';
    ctx.font = '800 24px sans-serif';
    ctx.fillText('好友邀请', canvas.width - 226, 124);

    let image = null;
    if (pet?.imageSheetUrl) {
        image = await new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = pet.imageSheetUrl;
        });
    }
    const cols = anims.length === 1 ? 1 : 2;
    const rows = anims.length <= 2 ? 1 : 2;
    const gap = 24;
    const x0 = 104;
    const y0 = 180;
    const gridW = canvas.width - 208;
    const gridH = 730;
    const cellW = (gridW - gap * (cols - 1)) / cols;
    const cellH = (gridH - gap * (rows - 1)) / rows;
    anims.forEach((anim, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = x0 + col * (cellW + gap);
        const y = y0 + row * (cellH + gap);
        ctx.fillStyle = ['#f8fafc', '#fff7ed', '#fdf2f8', '#eef2ff'][index % 4];
        roundRect(ctx, x, y, cellW, cellH, 24);
        ctx.fill();
        if (image) {
            const cell = getPetSpriteCell({ ...pet, anim });
            if (cell) ctx.drawImage(image, image.width * cell.col / SHEET_COLS, image.height * cell.row / SHEET_ROWS, image.width / SHEET_COLS, image.height / SHEET_ROWS, x + 24, y + 24, cellW - 48, cellH - 48);
        } else {
            ctx.font = '92px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#92400e';
            ctx.fillText('🥚', x + cellW / 2, y + cellH / 2 + 30);
            ctx.textAlign = 'left';
        }
    });
    ctx.fillStyle = '#17375e';
    ctx.font = '800 34px sans-serif';
    wrapCanvasText(ctx, message, 104, 1000, canvas.width - 208, 46, 3);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const chars = String(text || '').split('');
    let line = '';
    let count = 0;
    for (const char of chars) {
        const test = line + char;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y + count * lineHeight);
            line = char;
            count += 1;
            if (count >= maxLines) return;
        } else line = test;
    }
    if (line && count < maxLines) ctx.fillText(line, x, y + count * lineHeight);
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
