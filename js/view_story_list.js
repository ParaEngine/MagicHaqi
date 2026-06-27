// 故事列表视图：先展示已有故事卡片，第一个卡片用于新建故事。
import { $, confirm as confirmDialog, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { deleteWorkspaceStory, loadWorkspaceStory, loadWorkspaceStoryList, loadWorkspaceStoryRecord } from './storage.js';
import { petArtHtml, scanAndMount } from './pet.js';
import { state } from './state.js';

function storyPetForRecord(record) {
    const actor = record?.coverActor || null;
    const template = actor?.petTemplate || actor?.pet || null;
    if (!template) return null;
    return {
        id: template.id || actor.id || 'story_pet',
        name: template.name || actor.name || t('slDragonName'),
        stage: template.stage || 'adult',
        imageSheetUrl: template.imageSheetUrl || '',
        dna: template.dna || '',
        traits: template.traits || {},
        anim: 'idle',
    };
}

function formatDate(ts) {
    const time = Number(ts) || 0;
    if (!time) return t('slNoTime');
    try {
        const date = new Date(time);
        return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    } catch (_) {
        return t('slNoTime');
    }
}

function renderStoryStats(record) {
    return `
        <div class="mh-story-list-stats">
            <span>${escapeHtml(t('slScenes', { n: Math.max(0, Number(record.sceneCount) || 0) }))}</span>
            <span>${escapeHtml(t('slActors', { n: Math.max(0, Number(record.actorCount) || 0) }))}</span>
            <span>${escapeHtml(t('slLines', { n: Math.max(0, Number(record.lineCount) || 0) }))}</span>
            <span>${escapeHtml(t('slActivities', { n: Math.max(0, Number(record.activityCount) || 0) }))}</span>
        </div>`;
}

function storyShareFilename(path) {
    const clean = String(path || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
    const filename = clean.split('/').pop() || clean;
    return filename || '';
}

function getStoryShareUsername() {
    const direct = state.user?.username || state.sdk?.user?.username;
    if (direct) return Promise.resolve(direct);
    return state.sdk?.getUsername?.().catch?.(() => '') || Promise.resolve('');
}

function buildStoryShareUrl(path, username) {
    const url = new URL('MagicHaqi.html', window.location.href);
    url.searchParams.set('storyFrom', username || '');
    url.searchParams.set('story', storyShareFilename(path));
    return url.href;
}

function storyShareText(title) {
    return t('slShareStory', { title: title || t('slDefaultTitle') });
}

async function copyText(text, okMessage = t('slCopied')) {
    try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
            const input = document.createElement('textarea');
            input.value = text;
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }
        showToast(okMessage, 'success', 1600);
        return true;
    } catch (_) {
        showToast(t('slCopyFailed'), 'error', 2200);
        return false;
    }
}

async function openStorySharePanel({ path, title }) {
    if (!path) return;
    const username = await getStoryShareUsername();
    if (!username) {
        showToast(t('slLoginToShare'), 'error', 2200);
        return;
    }
    document.querySelector('.mh-story-share-mask')?.remove();
    const safeTitle = title || t('slDefaultTitle');
    const url = buildStoryShareUrl(path, username);
    const text = storyShareText(safeTitle);
    const mask = document.createElement('div');
    mask.className = 'modal-mask mh-story-share-mask';
    mask.innerHTML = `
        <div class="modal-card mh-story-share-card">
            <div class="mh-story-share-head">
                <div>
                    <div class="mh-story-share-title">${escapeHtml(t('slShareTitle'))}</div>
                    <div class="mh-story-share-subtitle">${escapeHtml(safeTitle)}</div>
                </div>
                <button type="button" class="mh-story-share-close" data-story-share-close aria-label="关闭">×</button>
            </div>
            <div class="mh-story-share-preview">${escapeHtml(text)}</div>
            <input class="modal-input mh-story-share-link" readonly value="${escapeHtml(url)}" aria-label="分享链接">
            <div class="mh-story-share-actions">
                <button type="button" class="btn-secondary" data-story-share-method="copy">${escapeHtml(t('slCopyLink'))}</button>
                <button type="button" class="btn-secondary" data-story-share-method="wechat">${escapeHtml(t('slWechat'))}</button>
                <button type="button" class="btn-primary" data-story-share-method="system">${escapeHtml(t('slSystemShare'))}</button>
            </div>
        </div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', async (e) => {
        if (e.target === mask || e.target.closest?.('[data-story-share-close]')) { close(); return; }
        const methodBtn = e.target.closest?.('[data-story-share-method]');
        if (!methodBtn) return;
        const method = methodBtn.dataset.storyShareMethod;
        if (method === 'copy') {
            await copyText(url, t('slLinkCopied'));
        } else if (method === 'wechat') {
            await copyText(`${text}\n${url}`, t('slWechatCopied'));
        } else if (method === 'system') {
            if (navigator.share) {
                try { await navigator.share({ title: safeTitle, text, url }); return; } catch (_) {}
            }
            await copyText(`${text}\n${url}`, t('slShareCopied'));
        }
    });
    document.body.appendChild(mask);
}

function renderStoryCard(record) {
    const pet = storyPetForRecord(record);
    return `
        <article class="mh-story-card" data-story-path="${escapeHtml(record.path)}">
            <button type="button" class="mh-story-card-delete" data-story-delete="${escapeHtml(record.path)}" aria-label="${escapeHtml(t('slDeleteStory'))}" title="${escapeHtml(t('slDeleteStory'))}">×</button>
            <div class="mh-story-card-art">
                ${pet ? `<div class="mh-story-card-pet">${petArtHtml(pet, { alt: pet.name || '', extraClass: 'floaty', requireProcessedTexture: false })}</div>` : `<span class="mh-story-card-placeholder">${escapeHtml(t('slStory'))}</span>`}
            </div>
            <div class="mh-story-card-body">
                <div class="mh-story-card-title">${escapeHtml(record.title || t('slDefaultTitle'))}</div>
                <div class="mh-story-card-time">${escapeHtml(formatDate(record.updatedAt))}</div>
                ${renderStoryStats(record)}
                <div class="mh-story-card-actions">
                    <button type="button" class="btn-secondary mh-story-play-btn" data-story-play="${escapeHtml(record.path)}">${escapeHtml(t('slPlay'))}</button>
                    <button type="button" class="btn-secondary" data-story-share="${escapeHtml(record.path)}">${escapeHtml(t('slShare'))}</button>
                    <button type="button" class="btn-primary" data-story-edit="${escapeHtml(record.path)}">${escapeHtml(t('slEdit'))}</button>
                </div>
            </div>
        </article>`;
}

function renderListHtml(records) {
    return `
        <div class="mh-story-list-grid">
            <button type="button" class="mh-story-new-card" id="mhStoryNewCard">
                <span class="mh-story-new-plus">+</span>
                <strong>${escapeHtml(t('slNewStory'))}</strong>
            </button>
            ${records.length ? records.map(renderStoryCard).join('') : '<div class="mh-story-list-empty">还没有保存的故事。新建一个，保存后会出现在这里。</div>'}
        </div>`;
}

function replaceStoryCard(card, record) {
    const template = document.createElement('template');
    template.innerHTML = renderStoryCard(record).trim();
    const nextCard = template.content.firstElementChild;
    if (!nextCard) return card;
    card.replaceWith(nextCard);
    scanAndMount(nextCard);
    return nextCard;
}

function setupVisibleStoryLoading(content, records) {
    if (!content) return;
    const loadedPaths = new Set();
    const loadingPaths = new Set();
    const root = content.closest?.('.mh-story-list-body') || null;

    const loadVisibleCard = async (card) => {
        const path = card?.dataset?.storyPath || '';
        if (!path || loadedPaths.has(path) || loadingPaths.has(path)) return;
        loadingPaths.add(path);
        try {
            const record = await loadWorkspaceStoryRecord(path);
            if (!record) return;
            const currentCard = [...content.querySelectorAll('[data-story-path]')]
                .find(item => item.dataset.storyPath === path);
            if (currentCard) replaceStoryCard(currentCard, record);
            loadedPaths.add(path);
        } catch (e) {
            console.warn('故事摘要加载失败', path, e);
        } finally {
            loadingPaths.delete(path);
        }
    };

    const cards = [...content.querySelectorAll('[data-story-path]')];
    if (!cards.length) return;

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                observer.unobserve(entry.target);
                loadVisibleCard(entry.target);
            });
        }, { root, threshold: 0.01 });
        cards.forEach(card => observer.observe(card));
        return;
    }

    const checkVisibleCards = () => {
        const rootRect = root?.getBoundingClientRect?.() || { top: 0, bottom: window.innerHeight };
        content.querySelectorAll('[data-story-path]').forEach(card => {
            const rect = card.getBoundingClientRect();
            if (rect.bottom > rootRect.top && rect.top < rootRect.bottom) loadVisibleCard(card);
        });
    };
    root?.addEventListener?.('scroll', checkVisibleCards, { passive: true });
    window.addEventListener('resize', checkVisibleCards, { passive: true });
    requestAnimationFrame(checkVisibleCards);
}

export async function renderStoryList(panel, _data = {}, { onBack, onNewStory, onEditStory, onPlayStory } = {}) {
    panel.innerHTML = `
        <style>
            .mh-story-list-root { position:absolute; inset:0; display:flex; flex-direction:column; background:linear-gradient(180deg,#e0f7ff 0%,#bae6fd 48%,#fef3c7 100%); color:var(--text-primary); }
            .mh-story-list-body { flex:1; min-height:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
            .mh-story-list-grid { display:grid; grid-template-columns:1fr; gap:12px; }
            .mh-story-new-card { min-height:144px; border:1.5px dashed rgba(14,165,233,.62); border-radius:16px; background:rgba(255,255,255,.72); color:var(--text-primary); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; padding:14px; text-align:center; }
            .mh-story-new-plus { width:44px; height:44px; border-radius:999px; background:var(--accent); color:white; display:grid; place-items:center; font-size:30px; font-weight:900; line-height:1; box-shadow:0 4px 0 rgba(37,99,235,.25); }
            .mh-story-new-card strong { font-size:16px; font-weight:900; }
            .mh-story-card { position:relative; border:1.5px solid rgba(125,211,252,.78); border-radius:16px; background:rgba(255,255,255,.9); padding:10px; display:grid; grid-template-columns:104px minmax(0,1fr); gap:10px; align-items:stretch; }
            .mh-story-card-delete { position:absolute; top:8px; right:8px; z-index:2; width:26px; height:26px; border-radius:999px; border:1.5px solid rgba(148,163,184,.45); background:rgba(255,255,255,.68); color:rgba(100,116,139,.72); display:grid; place-items:center; padding:0; font-size:18px; font-weight:900; line-height:1; box-shadow:none; }
            @media (hover: hover) and (pointer: fine) {
                .mh-story-card-delete { opacity:.48; transition:opacity .16s ease, color .16s ease, border-color .16s ease, background .16s ease; }
                .mh-story-card:hover .mh-story-card-delete,
                .mh-story-card-delete:focus-visible { opacity:1; background:#fff; border-color:rgba(239,68,68,.62); color:#dc2626; }
            }
            .mh-story-card-art { min-height:126px; border-radius:14px; overflow:hidden; background:radial-gradient(circle at 50% 18%,rgba(255,255,255,.9),transparent 36%),linear-gradient(180deg,#bae6fd,#fef3c7); display:flex; align-items:center; justify-content:center; box-shadow:var(--game-shadow-small); }
            .mh-story-card-pet { width:94px; height:94px; flex:0 0 94px; }
            .mh-story-card-placeholder { color:var(--accent-dark); font-size:18px; font-weight:900; }
            .mh-story-card-body { min-width:0; display:flex; flex-direction:column; gap:7px; padding-right:22px; }
            .mh-story-card-title { color:var(--text-primary); font-size:15px; line-height:1.25; font-weight:900; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
            .mh-story-card-time { color:var(--text-muted); font-size:12px; font-weight:800; }
            .mh-story-list-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
            .mh-story-list-stats span { border-radius:999px; background:#effaff; color:var(--text-secondary); font-size:11px; font-weight:900; padding:5px 6px; text-align:center; white-space:nowrap; }
            .mh-story-card-actions { margin-top:auto; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
            .mh-story-card-actions button { padding:7px 8px; font-size:12px; }
            .mh-story-card-actions .mh-story-play-btn { background:linear-gradient(180deg,rgba(255,255,255,.46),rgba(255,255,255,0) 48%),linear-gradient(180deg,#86efac 0%,#22c55e 100%); border-color:#16a34a; border-bottom-color:#15803d; color:#ffffff; text-shadow:0 1px 0 rgba(20,83,45,.42); box-shadow:0 3px 0 #15803d,inset 0 1px 0 rgba(255,255,255,.62); }
            @media (hover: hover) and (pointer: fine) {
                .mh-story-card-actions .mh-story-play-btn:hover { background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0) 46%),linear-gradient(180deg,#bbf7d0 0%,#16a34a 100%); color:#ffffff; }
            }
            .mh-story-card-actions .mh-story-play-btn:active { box-shadow:0 1px 0 #15803d,inset 0 2px 5px rgba(20,83,45,.22); }
            .mh-story-share-mask { zoom:1 !important; align-items:flex-end; padding:14px 12px max(14px,env(safe-area-inset-bottom)); }
            .mh-story-share-card { width:min(420px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:12px; border-radius:20px 20px 16px 16px; }
            .mh-story-share-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
            .mh-story-share-title { color:var(--text-primary); font-size:18px; font-weight:900; }
            .mh-story-share-subtitle { color:var(--text-secondary); font-size:13px; font-weight:800; margin-top:3px; line-height:1.35; word-break:break-word; }
            .mh-story-share-close { width:34px; height:34px; border-radius:999px; border:1.5px solid var(--border-card); background:#fff; color:var(--text-primary); font-size:22px; line-height:1; display:grid; place-items:center; padding:0; }
            .mh-story-share-preview { border:1.5px solid rgba(14,165,233,.28); border-radius:14px; background:#f8fdff; color:var(--text-primary); padding:10px; font-size:13px; font-weight:900; line-height:1.45; }
            .mh-story-share-link { font-size:12px; color:var(--text-secondary); }
            .mh-story-share-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
            .mh-story-share-actions button { padding:8px 6px; font-size:12px; }
            .mh-story-list-empty { border:1.5px dashed rgba(14,165,233,.38); border-radius:14px; color:var(--text-muted); background:rgba(255,255,255,.54); padding:12px; font-size:13px; line-height:1.45; }
            @media (min-width: 760px) {
                .mh-story-list-body { padding:14px 22px; }
                .mh-story-list-grid { grid-template-columns:repeat(2,minmax(340px,1fr)); gap:20px; }
                .mh-story-new-card { min-height:166px; }
                .mh-story-card { grid-template-columns:116px minmax(0,1fr); gap:14px; padding:12px; }
                .mh-story-card-pet { width:104px; height:104px; flex-basis:104px; }
            }
        </style>
        <div class="mh-story-list-root">
            <div class="topbar">
                <button class="btn-icon" id="mhStoryListBack" style="width:36px;height:36px;font-size:18px">‹</button>
                <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('slStoryMaker'))}</span>
                <span style="width:36px"></span>
            </div>
            <div class="mh-story-list-body">
                <div id="mhStoryListContent"><div class="mh-story-list-empty">正在加载故事...</div></div>
            </div>
        </div>`;

    const back = $('mhStoryListBack');
    if (back) back.onclick = () => onBack?.();

    const content = $('mhStoryListContent');
    let records = [];
    try {
        records = await loadWorkspaceStoryList();
        if (content) content.innerHTML = renderListHtml(records);
        scanAndMount(content || panel);
        setupVisibleStoryLoading(content, records);
    } catch (e) {
        if (content) content.innerHTML = '<div class="mh-story-list-empty">故事列表加载失败。</div>';
        showToast(t('slListLoadFailed', { error: (e?.message || e) }), 'error');
    }

    panel.onclick = async (e) => {
        if (e.target.closest?.('#mhStoryListBack')) return;
        if (e.target.closest?.('#mhStoryNewCard')) { onNewStory?.(); return; }
        const deleteBtn = e.target.closest?.('[data-story-delete]');
        if (deleteBtn) {
            const card = deleteBtn.closest?.('[data-story-path]');
            const path = deleteBtn.dataset.storyDelete || card?.dataset.storyPath || '';
            const title = card?.querySelector?.('.mh-story-card-title')?.textContent?.trim() || t('slThisStory');
            if (!path) return;
            const confirmed = await confirmDialog(t('slDeleteConfirm', { title }), { okText: t('delete'), cancelText: t('cancel') });
            if (!confirmed) return;
            deleteBtn.disabled = true;
            try {
                await deleteWorkspaceStory(path);
                records = records.filter(item => item.path !== path);
                card?.remove();
                if (content && !content.querySelector('[data-story-path]')) content.innerHTML = renderListHtml(records);
                showToast(t('slDeleted'), 'success', 1600);
            } catch (err) {
                deleteBtn.disabled = false;
                showToast(t('slDeleteFailed', { error: (err?.message || err) }), 'error');
            }
            return;
        }
        const shareBtn = e.target.closest?.('[data-story-share]');
        if (shareBtn) {
            const card = shareBtn.closest?.('[data-story-path]');
            await openStorySharePanel({
                path: shareBtn.dataset.storyShare || card?.dataset.storyPath || '',
                title: card?.querySelector?.('.mh-story-card-title')?.textContent?.trim() || '',
            });
            return;
        }
        const editBtn = e.target.closest?.('[data-story-edit]');
        const playBtn = e.target.closest?.('[data-story-play]');
        const card = e.target.closest?.('[data-story-path]');
        const path = editBtn?.dataset.storyEdit || playBtn?.dataset.storyPlay || card?.dataset.storyPath || '';
        if (!path) return;
        try {
            const story = await loadWorkspaceStory(path);
            if (!story) { showToast(t('slStoryMissing'), 'error'); return; }
            if (playBtn) onPlayStory?.(story, path);
            else onEditStory?.(story, path);
        } catch (err) {
            showToast(t('slOpenFailed', { error: (err?.message || err) }), 'error');
        }
    };
}
