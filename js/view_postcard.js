// 宠物明信片渲染：分享弹窗、收件箱和明信片查看页共用。
import { escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { displayPetName } from './dna.js';
import { CONFIG } from './config.js';
import { notify, state } from './state.js';
import { addPostcardRecord, saveUserProfile } from './storage.js';
import { buildEggSvg, getPetSpriteCell, getProcessedSheet, SHEET_COLS, SHEET_ROWS } from './pet.js';

export const POSTCARD_ANIMS = ['idle', 'happy', 'sad', 'sleep'];
export function getPostcardTexts() {
    return [t('pcText1'), t('pcText2'), t('pcText3'), t('pcText4'), t('pcText5')];
}
export const POSTCARD_PHOTO_THEMES = [
    { id: 'candy', colors: ['#ffe4f1', '#dff7ff', '#fff3bf', '#e9d5ff'], canvas: [['#ffe4f1', '#dff7ff'], ['#fff7c8', '#ffd6e7'], ['#dff7ff', '#d9f99d'], ['#f5d0fe', '#bae6fd']] },
    { id: 'aurora', colors: ['#ccfbf1', '#dbeafe', '#fef3c7', '#fce7f3'], canvas: [['#ccfbf1', '#dbeafe'], ['#e0f2fe', '#fef3c7'], ['#dcfce7', '#bae6fd'], ['#fce7f3', '#ddd6fe']] },
    { id: 'sunny', colors: ['#fef3c7', '#fed7aa', '#fde68a', '#bbf7d0'], canvas: [['#fef3c7', '#fed7aa'], ['#fff7ed', '#fde68a'], ['#fef9c3', '#bbf7d0'], ['#ffedd5', '#fecdd3']] },
    { id: 'dream', colors: ['#e0e7ff', '#fbcfe8', '#cffafe', '#ede9fe'], canvas: [['#e0e7ff', '#fbcfe8'], ['#cffafe', '#ede9fe'], ['#f5d0fe', '#bae6fd'], ['#ddd6fe', '#fecdd3']] },
    { id: 'garden', colors: ['#dcfce7', '#bbf7d0', '#ecfccb', '#ccfbf1'], canvas: [['#dcfce7', '#bbf7d0'], ['#ecfccb', '#fde68a'], ['#ccfbf1', '#bae6fd'], ['#f0fdf4', '#d9f99d']] },
];
const FAMOUS_PETS_PREFIX = 'famous-pets/';
let famousPetsIndexCache = null;
let famousPetsIndexPromise = null;

export function isFamousPetId(petId) {
    return String(petId || '').trim().startsWith(FAMOUS_PETS_PREFIX);
}

function famousPetLocalId(petId) {
    if (!isFamousPetId(petId)) return '';
    const id = String(petId || '').trim().slice(FAMOUS_PETS_PREFIX.length).replace(/\\/g, '/');
    if (!id || id.includes('..') || id.startsWith('/') || id.endsWith('/')) return '';
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(id)) return '';
    return id;
}

function postcardSourceId(postcard) {
    if (postcard?.fromUsername) return postcard.fromUsername;
    return isFamousPetId(postcard?.petId) ? 'famous-pets' : '';
}

export function postcardSourceLabel(postcard) {
    const source = postcardSourceId(postcard);
    if (source === 'famous-pets') return t('pcFamousPet');
    return source;
}

export function defaultPostcardText(pet) {
    const name = displayPetName(pet) || t('pcMyPet');
    if (pet?.anim === 'sleep') return t('pcSleeping', { name });
    return t('pcSeeking', { name });
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

export function normalizePostcardPhotoTheme(theme) {
    const id = String(theme || '').trim();
    return POSTCARD_PHOTO_THEMES.some(item => item.id === id) ? id : POSTCARD_PHOTO_THEMES[0].id;
}

export function randomPostcardPhotoTheme(current = '') {
    const normalized = normalizePostcardPhotoTheme(current);
    const options = POSTCARD_PHOTO_THEMES.filter(item => item.id !== normalized);
    return (options[Math.floor(Math.random() * options.length)] || POSTCARD_PHOTO_THEMES[0]).id;
}

function postcardTheme(theme) {
    const id = normalizePostcardPhotoTheme(theme);
    return POSTCARD_PHOTO_THEMES.find(item => item.id === id) || POSTCARD_PHOTO_THEMES[0];
}

function postcardThemeStyle(theme) {
    const item = postcardTheme(theme);
    return item.colors.map((color, index) => `--pet-postcard-photo-bg-${index + 1}:${color}`).join(';');
}

function processedSheetUrl(pet) {
    if (!pet?.imageSheetUrl) return '';
    const processed = getProcessedSheet(pet.imageSheetUrl);
    return processed?.status === 'loaded' && processed.dataUrl ? processed.dataUrl : '';
}

function photoStyle(pet, anim, imageUrl = processedSheetUrl(pet)) {
    const previewPet = { ...pet, anim };
    const cell = getPetSpriteCell(previewPet);
    if (!imageUrl || !cell) return '';
    const bx = (cell.col * 100 / (SHEET_COLS - 1)).toFixed(3);
    const by = (cell.row * 100 / (SHEET_ROWS - 1)).toFixed(3);
    return `background-image:url('${escapeHtml(imageUrl)}');background-size:${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%;background-position:${bx}% ${by}%;background-repeat:no-repeat;background-color:transparent;image-rendering:pixelated`;
}

function photoHtml(pet, anim) {
    const previewPet = { ...pet, anim };
    const cell = getPetSpriteCell(previewPet);
    if (!cell) return `<div class="pet-postcard-photo pet-postcard-photo-egg"><div class="pet-postcard-photo-art">${buildEggSvg(pet)}</div></div>`;
    const style = photoStyle(pet, anim);
    const pendingClass = style ? '' : ' pet-postcard-photo-pending';
    const sheetAttr = pet?.imageSheetUrl ? ` data-postcard-photo-sheet="${escapeHtml(pet.imageSheetUrl)}"` : '';
    const styleAttr = style ? ` style="${style}"` : '';
    return `<div class="pet-postcard-photo${pendingClass}" data-postcard-photo-anim="${escapeHtml(anim)}"${sheetAttr}><div class="pet-postcard-photo-art"${styleAttr}></div></div>`;
}

export function hydratePetPostcardImages(root, pet, { onUpdate } = {}) {
    if (!root || !pet?.imageSheetUrl) return;
    const processed = getProcessedSheet(pet.imageSheetUrl);
    const apply = () => {
        const imageUrl = processed?.status === 'loaded' && processed.dataUrl ? processed.dataUrl : '';
        if (!imageUrl) return;
        root.querySelectorAll('[data-postcard-photo-anim]').forEach((photo) => {
            if (photo.dataset.postcardPhotoSheet && photo.dataset.postcardPhotoSheet !== pet.imageSheetUrl) return;
            const art = photo.querySelector('.pet-postcard-photo-art');
            if (!art) return;
            const style = photoStyle(pet, photo.dataset.postcardPhotoAnim || 'idle', imageUrl);
            if (!style) return;
            art.setAttribute('style', style);
            photo.classList.remove('pet-postcard-photo-pending');
        });
        onUpdate?.();
    };
    apply();
    processed?.promise?.then(apply).catch(() => {});
}

export function renderPetPostcardHtml(pet, { layout = 1, text = '', interactive = false, photoTheme = '' } = {}) {
    const anims = normalizePostcardLayout(layout, pet);
    const safeText = text || defaultPostcardText(pet);
    const theme = normalizePostcardPhotoTheme(photoTheme);
    const actionAttrs = interactive
        ? ` role="button" tabindex="0" title="${escapeHtml(t('pcSwitchPhoto'))}" data-postcard-image-toggle="1"`
        : '';
    const textAttrs = interactive
        ? ` role="button" tabindex="0" title="${escapeHtml(t('pcSwitchText'))}" data-postcard-text-toggle="1"`
        : '';
    const editButton = interactive
        ? `<button class="pet-postcard-edit-btn" data-share-edit-text type="button" title="${escapeHtml(t('pcEditText'))}" aria-label="${escapeHtml(t('pcEditText'))}">✏️</button>`
        : '';
    return `
        <div class="pet-postcard pet-postcard-count-${anims.length}" data-postcard-layout="${escapeHtml(serializePostcardLayout(anims, pet))}" data-postcard-photo-theme="${escapeHtml(theme)}" style="${postcardThemeStyle(theme)}">
            <div class="pet-postcard-stamp">${escapeHtml(t('pcFriendInvite'))}</div>
            <div class="pet-postcard-title">${escapeHtml(displayPetName(pet) || t('pcMyPet'))}</div>
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
    const text = (url.searchParams.get('text') || t('pcText1')).trim();
    const photoTheme = normalizePostcardPhotoTheme(url.searchParams.get('photoTheme') || url.searchParams.get('theme') || '');
    return { fromUsername: postcardFrom, petId, layout, text, photoTheme };
}

export function hasPostcardParams() {
    try {
        const params = parsePostcardParams();
        return !!(params.petId && (params.fromUsername || isFamousPetId(params.petId)));
    } catch (_) {
        return false;
    }
}

function safeIdPart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

async function readRemotePet(fromUsername, petId) {
    if (isFamousPetId(petId)) return await readFamousPet(petId);
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

function resolveFamousPetAssetUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:https?:|data:|blob:|\/)/i.test(raw)) return raw;
    try { return new URL(raw, baseUrl).href; }
    catch (_) { return raw; }
}

async function readFamousPetText(localId, jsonUrl) {
    try {
        const response = await fetch(jsonUrl.href, { cache: 'no-cache' });
        if (response.ok) return await response.text();
    } catch (_) {}

    const base = state.sdk?.personalPageStore;
    if (!base?.readFile) return '';
    const store = (typeof base.withWorkspace === 'function') ? base.withWorkspace(CONFIG.workspace) : base;
    try { return (await store.readFile(`famous-pets/${localId}.json`, 1, 99999)) || ''; }
    catch (_) {
        try { return (await store.readFile(`famous-pets/${localId}.json`)) || ''; }
        catch (__) { return ''; }
    }
}

async function readFamousPetsIndexText(indexUrl) {
    try {
        const response = await fetch(indexUrl.href, { cache: 'no-cache' });
        if (response.ok) return await response.text();
    } catch (_) {}

    const base = state.sdk?.personalPageStore;
    if (!base?.readFile) return '';
    const store = (typeof base.withWorkspace === 'function') ? base.withWorkspace(CONFIG.workspace) : base;
    try { return (await store.readFile('famous-pets/_pet_index.json', 1, 99999)) || ''; }
    catch (_) {
        try { return (await store.readFile('famous-pets/_pet_index.json')) || ''; }
        catch (__) { return ''; }
    }
}

async function loadFamousPetsIndex(indexUrl) {
    if (Array.isArray(famousPetsIndexCache)) return famousPetsIndexCache;
    if (!famousPetsIndexPromise) {
        famousPetsIndexPromise = (async () => {
            const text = await readFamousPetsIndexText(indexUrl);
            if (!text) return [];
            const data = JSON.parse(text);
            return Array.isArray(data) ? data : (Array.isArray(data?.pets) ? data.pets : []);
        })()
            .then(list => {
                famousPetsIndexCache = list.filter(item => item && typeof item === 'object');
                return famousPetsIndexCache;
            })
            .catch((e) => {
                console.warn('读取明星宠物索引失败', e);
                famousPetsIndexCache = [];
                return famousPetsIndexCache;
            })
            .finally(() => { famousPetsIndexPromise = null; });
    }
    return famousPetsIndexPromise;
}

async function readFamousPetFromIndex(localId, petId) {
    // `import.meta.url + ''` keeps Vite from statically analyzing this URL and
    // emitting a hashed copy of the verbatim-shipped famous-pets file.
    const indexUrl = new URL('../famous-pets/_pet_index.json', import.meta.url + '');
    const list = await loadFamousPetsIndex(indexUrl);
    const entry = list.find(item => String(item?.id || '').trim() === localId);
    if (!entry) return null;
    const id = String(entry.id || localId).trim() || localId;
    return {
        ...entry,
        id: `invite_famous_${safeIdPart(id)}`,
        source: 'famous-pets',
        sourcePetId: petId,
        imageUrl: resolveFamousPetAssetUrl(entry.imageUrl, indexUrl.href) || null,
        imageSheetUrl: resolveFamousPetAssetUrl(entry.imageSheetUrl, indexUrl.href) || null,
    };
}

async function readFamousPet(petId) {
    const localId = famousPetLocalId(petId);
    if (!localId) return null;
    const indexPet = await readFamousPetFromIndex(localId, petId);
    if (indexPet) return indexPet;
    const jsonUrl = new URL(`../famous-pets/${localId}.json`, import.meta.url + '');
    try {
        const text = await readFamousPetText(localId, jsonUrl);
        if (!text) return null;
        const pet = JSON.parse(text);
        if (!pet || typeof pet !== 'object') return null;
        const id = String(pet.id || localId).trim() || localId;
        return {
            ...pet,
            id: `invite_famous_${safeIdPart(id)}`,
            source: 'famous-pets',
            sourcePetId: petId,
            imageUrl: resolveFamousPetAssetUrl(pet.imageUrl, jsonUrl.href) || null,
            imageSheetUrl: resolveFamousPetAssetUrl(pet.imageSheetUrl, jsonUrl.href) || null,
        };
    } catch (e) {
        console.warn('读取明星宠物失败', e);
        return null;
    }
}

function fallbackPostcardPet(postcard) {
    const source = postcardSourceId(postcard) || t('pcFriendFallback');
    return {
        id: `invite_${safeIdPart(source)}_${safeIdPart(postcard.petId)}`,
        name: t('pcFriendPetOf', { name: postcardSourceLabel(postcard) || t('pcFriendFallback') }),
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
        await state.sdk.socialFriends.applyFriend(userId, text || t('pcApplyMessage'));
        return 'requested';
    } catch (e) {
        const msg = String(e?.message || e || '');
        if (/already|exist|friend|重复|已经/i.test(msg)) return 'already';
        console.warn('好友申请失败', e);
        return 'failed';
    }
}

function friendStatusText(status) {
    if (status === 'requested') return t('pcStatusRequested');
    if (status === 'already') return t('pcStatusAlready');
    if (status === 'user-not-found') return t('pcStatusNotFound');
    if (status === 'failed') return t('pcStatusFailed');
    return t('pcStatusUnavailable');
}

function addVisitingPet(postcard, pet) {
    const source = postcardSourceId(postcard);
    const record = {
        id: `${source || 'friend'}:${postcard.petId || pet.id}`,
        from: source,
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
    state.currentField = '1';
    state.lastHomeZoomLevel = 1;
    return record;
}

function cleanupPostcardUrl() {
    try {
        const url = new URL(window.location.href);
        ['postcardFrom', 'inviteFrom', 'petId', 'layout', 'text', 'photoTheme', 'theme'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
}

export function renderPostcard(panel, data = {}, { onBack, onPlay } = {}) {
    const postcard = data?.postcard || parsePostcardParams();
    const isFamousPet = isFamousPetId(postcard.petId);
    const sourceLabel = postcardSourceLabel(postcard);
    if (!postcard.petId || (!postcard.fromUsername && !isFamousPet)) {
        panel.innerHTML = `
            <div class="topbar"><button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button><span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('pcTitle'))}</span><span style="width:36px;height:36px"></span></div>
            <div class="invite-view"><div class="card-flat text-center" style="padding:24px;color:var(--text-muted)">明信片链接不完整。</div></div>`;
        const back = document.getElementById('mhBack');
        if (back) back.onclick = () => onBack?.();
        return;
    }

    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('pcFromTitle', { name: sourceLabel }))}</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="invite-view mh-postcard-view">
            <div class="invite-card">
                <div class="invite-status" data-postcard-status>正在读取宠物资料...</div>
                <div data-postcard-preview></div>
                <div class="invite-actions mh-postcard-actions">
                    <button class="btn-secondary" data-postcard-friend disabled>${escapeHtml(t('pcAddFriend'))}</button>
                    <button class="btn-primary" data-postcard-play disabled>${escapeHtml(t('pcPlayTogether'))}</button>
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
        await addPostcardRecord({ ...postcard, fromUsername: postcardSourceId(postcard), dateReceived: postcard.dateReceived || Date.now() });
        if (previewEl) {
            previewEl.innerHTML = renderPetPostcardHtml(pet, { layout: postcard.layout, text: postcard.text, photoTheme: postcard.photoTheme });
            hydratePetPostcardImages(previewEl, pet);
        }
        if (statusEl) statusEl.textContent = `${displayPetName(pet)} 正在等你回应`;
        if (friendBtn) {
            friendBtn.disabled = isFamousPet;
            if (isFamousPet) friendBtn.textContent = '明星伙伴';
        }
        if (playBtn) playBtn.disabled = false;
        friendBtn.onclick = async () => {
            if (isFamousPet) return;
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
        if (statusEl) statusEl.textContent = t('pcHandleFailed');
    });
}

export async function drawPetPostcardImage(pet, layout, text, photoTheme = '') {
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
    ctx.fillText(displayPetName(pet) || t('pcMyPet'), 104, 140);
    ctx.fillStyle = '#fef3c7';
    roundRect(ctx, canvas.width - 250, 92, 144, 48, 14);
    ctx.fill();
    ctx.fillStyle = '#92400e';
    ctx.font = '800 24px sans-serif';
    ctx.fillText('好友邀请', canvas.width - 226, 124);

    let image = null;
    const processed = pet?.imageSheetUrl ? getProcessedSheet(pet.imageSheetUrl) : null;
    if (processed?.promise) await processed.promise.catch(() => null);
    const sheetUrl = processed?.status === 'loaded' && processed.dataUrl ? processed.dataUrl : '';
    if (sheetUrl) {
        image = await new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = sheetUrl;
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
        const colors = postcardTheme(photoTheme).canvas[index % postcardTheme(photoTheme).canvas.length];
        const bg = ctx.createLinearGradient(x, y, x + cellW, y + cellH);
        bg.addColorStop(0, colors[0]);
        bg.addColorStop(1, colors[1]);
        ctx.fillStyle = bg;
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
