// 邮箱视图：收到的明信片、好友申请、邮件入口。
import { escapeHtml, formatTime, prompt, showToast } from './utils.js';
import { getCurrentPet, state } from './state.js';
import { loadPostcardList } from './storage.js';
import { renderPetPostcardHtml } from './view_postcard.js';
import { showPetSharePanel } from './level_planet.js';

const FRIEND_APPLY_RECENT_DAYS = 14;
const FRIEND_APPLY_RECENT_MS = FRIEND_APPLY_RECENT_DAYS * 24 * 60 * 60 * 1000;
let showAllFriendApplies = false;

function normalizeArrayResponse(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.rows)) return result.rows;
    if (Array.isArray(result?.data?.rows)) return result.data.rows;
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.list)) return result.list;
    if (Array.isArray(result?.items)) return result.items;
    return [];
}

function unwrapMailPayload(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value[0] || {};
    if (Array.isArray(value.data)) return value.data[0] || {};
    if (value.data && typeof value.data === 'object') return value.data;
    if (value.email && typeof value.email === 'object') return value.email;
    if (value.mail && typeof value.mail === 'object') return value.mail;
    return value;
}

function pickMailContent(value) {
    const raw = unwrapMailPayload(value);
    if (!raw || typeof raw !== 'object') return raw || '';
    return [
        raw.content, raw.html, raw.body, raw.text, raw.desc, raw.description,
        raw.details, raw.detail, raw.data?.content, raw.data?.html, raw.data?.body,
        raw.message?.content, raw.message?.html, raw.message?.body,
    ].find(item => item !== undefined && item !== null && item !== '') || '';
}

function normalizeRewardRows(value, fallback = []) {
    const raw = unwrapMailPayload(value);
    const candidates = [raw?.rewards, raw?.receivedRewards, raw?.rewardList, raw?.items, raw?.data?.rewards, fallback].filter(Boolean);
    const rows = [];
    candidates.forEach(candidate => {
        const list = Array.isArray(candidate) ? candidate : (typeof candidate === 'object' ? [candidate] : []);
        list.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = item.gsId || item.gsid || item.id || item.itemId || item.goodsId || item.rewardId;
            const amount = item.amount || item.count || item.num || item.quantity || 1;
            if (id !== undefined && id !== null && id !== '') rows.push({ id, amount });
        });
    });
    return rows;
}

function normalizeMail(item, fallback = {}) {
    const raw = unwrapMailPayload(item) || {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const id = raw.id || raw.mailId || raw.emailId || base.id || '';
    const title = raw.title || raw.subject || base.title || `邮件 ${id || ''}`.trim() || '无主题';
    const createdAt = raw.createdAt || raw.created_at || raw.createTime || raw.updatedAt || base.createdAt || '';
    const rawRead = raw.read ?? raw.isRead ?? base.read ?? 0;
    const rawRewards = raw.rewards ?? raw.reward ?? base.rewards ?? 0;
    const read = Number(rawRead) === 1 || rawRead === true;
    const rewardRows = normalizeRewardRows(raw, base.rewardRows || []);
    const rewards = Number(rawRewards) === 1 || rawRewards === true || rewardRows.length > 0;
    const content = pickMailContent(raw) || base.content || '';
    const from = raw.from || raw.fromEmail || raw.sender || raw.senderName || raw.fromName || base.from || '系统邮件';
    return { raw, id, title, createdAt, read, rewards, rewardRows, content, from };
}

function userNameOf(user) {
    return user?.username || user?.name || user?.nickname || user?.displayName || '';
}

function applyIdOf(item) {
    return item?.id || item?.applyId || item?._id;
}

function applyFromUser(item) {
    return item?.user || item?.fromUser || item?.applicant || item?.friend || item?.friendUser || item?.userInfo || item;
}

function timestampOf(item) {
    const raw = item?.createdAt || item?.created_at || item?.createTime || item?.created || item?.updatedAt || item?.updated_at || item?.date || item?.time;
    if (!raw) return 0;
    if (typeof raw === 'number') return raw > 100000000000 ? raw : raw * 1000;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isRecentApply(item, now = Date.now()) {
    const timestamp = timestampOf(item);
    if (!timestamp) return true;
    return now - timestamp <= FRIEND_APPLY_RECENT_MS;
}

async function loadFriendApplies() {
    if (!state.sdk?.socialFriends?.listApplies) return [];
    try {
        const result = await state.sdk.socialFriends.listApplies({ status: 1 });
        return normalizeArrayResponse(result);
    } catch (e) {
        console.warn('读取好友申请失败', e);
        return [];
    }
}

async function loadMails() {
    const social = state.sdk?.socialFriends;
    if (!social?.listMails) return [];
    try { return normalizeArrayResponse(await social.listMails({ page: 1, pageSize: 20 })); }
    catch (e) { console.warn('读取邮件失败', e); return []; }
}

async function readMailDetail(mail) {
    const social = state.sdk?.socialFriends;
    const normalized = normalizeMail(mail);
    if (!normalized.id || !social?.readEmail) return null;
    try { return await social.readEmail(normalized.id); }
    catch (e) { console.warn('读取邮件详情失败', e); return null; }
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

async function requestFriendByName() {
    const username = await prompt('添加好友', {
        hint: '输入对方 KeepWork 用户名。',
        placeholder: '好友用户名',
        okText: '发送申请',
        maxLength: 32,
        validate: (value) => value ? '' : '请输入用户名',
    });
    if (!username) return;
    if (!state.sdk?.socialFriends?.applyFriend) {
        showToast('当前 SDK 不支持好友申请', 'error');
        return;
    }
    const userId = await resolveUserId(username);
    if (!userId) {
        showToast('没有找到这个用户', 'error');
        return;
    }
    try {
        await state.sdk.socialFriends.applyFriend(userId, '来自魔法哈奇的好友申请');
        showToast('好友申请已发送', 'success');
    } catch (e) {
        showToast('发送失败：' + (e?.message || e), 'error');
    }
}

function postcardCardHtml(item, index) {
    const pet = {
        id: `postcard_${index}`,
        name: `${item.fromUsername}的宠物`,
        stage: 'egg',
        anim: 'idle',
        bornAt: item.dateReceived,
    };
    return `
        <button class="mailbox-card mailbox-postcard-card" data-open-postcard="${index}" type="button">
            <div class="mailbox-card-kicker">明信片 · ${escapeHtml(formatTime(item.dateReceived))}</div>
            ${renderPetPostcardHtml(pet, { layout: item.layout, text: item.text })}
            <div class="mailbox-card-foot">来自 ${escapeHtml(item.fromUsername)}</div>
        </button>`;
}

function friendApplyCardHtml(item, index) {
    const user = applyFromUser(item);
    const name = userNameOf(user) || `用户 ${item.friendId || item.userId || ''}`.trim() || '新的好友';
    const remark = item.remark || item.message || item.content || '想和你成为好友';
    const timestamp = timestampOf(item);
    return `
        <div class="mailbox-card mailbox-apply-card mailbox-art-card">
            <div class="mailbox-card-kicker"><span>好友请求</span>${timestamp ? `<i>${escapeHtml(formatTime(timestamp))}</i>` : ''}</div>
            <div class="mailbox-title"><span class="mailbox-avatar">✨</span>${escapeHtml(name)}</div>
            <div class="mailbox-text">${escapeHtml(remark)}</div>
            <div class="mailbox-inline-actions">
                <button class="mailbox-icon-btn mailbox-icon-reject" data-reject-apply="${index}" type="button" title="拒绝" aria-label="拒绝">❌</button>
                <button class="mailbox-icon-btn mailbox-icon-accept" data-accept-apply="${index}" type="button" title="同意" aria-label="同意">✅</button>
            </div>
        </div>`;
}

function mailCardHtml(item, index = 0) {
    const mail = normalizeMail(item);
    const timestamp = timestampOf({ createdAt: mail.createdAt });
    const text = mail.content || (mail.rewards ? '这封邮件包含奖励。' : '点击查看邮件内容。');
    return `
        <button class="mailbox-card mailbox-mail-card mailbox-art-card" data-open-mail-index="${index}" type="button">
            <div class="mailbox-card-kicker"><span>邮件 · ${escapeHtml(mail.from)}</span>${timestamp ? `<i>${escapeHtml(formatTime(timestamp))}</i>` : ''}</div>
            <div class="mailbox-title"><span class="mailbox-avatar">${mail.read ? '✉️' : '📬'}</span>${escapeHtml(mail.title)}</div>
            <div class="mailbox-text">${escapeHtml(String(text).replace(/<[^>]+>/g, '').slice(0, 160))}</div>
            <div class="mailbox-card-foot">${mail.read ? '已读' : '未读'}${mail.rewards ? ' · 有奖励' : ''}${mail.id ? ` · ID ${escapeHtml(mail.id)}` : ''}</div>
        </button>`;
}

function mailContentHtml(content) {
    const value = typeof content === 'string' ? content : (content ? JSON.stringify(content, null, 2) : '暂无邮件正文');
    if (/<([a-z][\w:-]*)(\s|>|\/)/i.test(value)) return value;
    return `<pre class="mailbox-mail-pre">${escapeHtml(value)}</pre>`;
}

function rewardHtml(mail) {
    if (!mail.rewardRows.length) return mail.rewards ? '<div class="mailbox-mail-rewards">有奖励</div>' : '';
    return `<div class="mailbox-mail-rewards">${mail.rewardRows.map(item => `<span>奖励 ${escapeHtml(item.id)} x${escapeHtml(item.amount)}</span>`).join('')}</div>`;
}

function showMailDetailModal(mail, detail = null) {
    const data = detail ? normalizeMail(detail, normalizeMail(mail)) : normalizeMail(mail);
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card mailbox-mail-detail-card">
            <div class="mailbox-mail-detail-head">
                <span class="mailbox-mail-detail-icon">${data.read ? '✉️' : '📬'}</span>
                <div>
                    <div class="mailbox-mail-detail-title">${escapeHtml(data.title)}</div>
                    <div class="mailbox-mail-detail-meta">${escapeHtml(data.from)}${data.createdAt ? ` · ${escapeHtml(formatTime(timestampOf({ createdAt: data.createdAt })) || data.createdAt)}` : ''}${data.id ? ` · ID ${escapeHtml(data.id)}` : ''}</div>
                </div>
                <button class="mailbox-mail-close" data-mail-close type="button" aria-label="关闭">×</button>
            </div>
            ${rewardHtml(data)}
            <div class="mailbox-mail-content">${mailContentHtml(data.content)}</div>
        </div>`;
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-mail-close]')) mask.remove();
    });
    document.body.appendChild(mask);
}

function friendApplySectionHtml(applies) {
    if (!applies.length) return '';
    const recentApplies = applies.filter(item => isRecentApply(item));
    const olderApplies = applies.filter(item => !isRecentApply(item));
    const hasRecent = recentApplies.length > 0;
    const visibleApplies = showAllFriendApplies ? [...recentApplies, ...olderApplies] : recentApplies;
    if (!hasRecent && !showAllFriendApplies) {
        return `
            <button class="mailbox-folder-row" data-mailbox-more-applies type="button">
                <span class="mailbox-folder-icon">📁</span>
                <span class="mailbox-folder-title">好友请求</span>
                <b>${applies.length}</b>
            </button>`;
    }
    return `
        <section class="mailbox-friend-section">
            <div class="mailbox-section-head">
                <span>好友请求</span>
                <b>${visibleApplies.length}${olderApplies.length && !showAllFriendApplies ? ` / ${applies.length}` : ''}</b>
            </div>
            <div class="mailbox-friend-row">
                ${visibleApplies.map((item) => friendApplyCardHtml(item, applies.indexOf(item))).join('')}
                ${olderApplies.length && !showAllFriendApplies ? `
                    <button class="mailbox-history-card" data-mailbox-more-applies type="button">
                        <span>📁</span><b>历史 ${olderApplies.length}</b>
                    </button>` : ''}
            </div>
        </section>`;
}

function renderMailboxItems({ postcards, applies, mails }) {
    if (!postcards.length && !applies.length && !mails.length) {
        return '<div class="card-flat mailbox-empty">这里还没有明信片、好友请求或邮件。</div>';
    }
    return `
        ${friendApplySectionHtml(applies)}
        ${postcards.map(postcardCardHtml).join('')}
        ${mails.map(mailCardHtml).join('')}`;
}

export function renderMailbox(panel, _data = {}, { onBack, onOpenPostcard, onEmail } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">邮箱</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="mailbox-view">
            <div class="mailbox-actions">
                <button class="btn-primary" data-mailbox-share>分享</button>
                <button class="btn-secondary" data-mailbox-add-friend>加好友</button>
                <button class="btn-secondary" data-mailbox-email>发邮件</button>
            </div>
            <div class="mailbox-scroll" data-mailbox-list>
                <div class="card-flat" style="color:var(--text-muted);text-align:center">正在收取邮件...</div>
            </div>
        </div>`;
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();
    panel.querySelector('[data-mailbox-share]').onclick = () => {
        const pet = getCurrentPet();
        if (!pet) { showToast('请先选择宠物', 'info'); return; }
        showPetSharePanel(pet);
    };
    panel.querySelector('[data-mailbox-add-friend]').onclick = () => requestFriendByName();
    panel.querySelector('[data-mailbox-email]').onclick = () => onEmail?.();

    const listEl = panel.querySelector('[data-mailbox-list]');
    (async () => {
        const [postcards, applies, mails] = await Promise.all([loadPostcardList(), loadFriendApplies(), loadMails()]);
        listEl.innerHTML = renderMailboxItems({ postcards, applies, mails });
        const moreBtn = listEl.querySelector('[data-mailbox-more-applies]');
        if (moreBtn) moreBtn.onclick = () => { showAllFriendApplies = true; renderMailbox(panel, _data, { onBack, onOpenPostcard, onEmail }); };
        listEl.querySelectorAll('[data-open-postcard]').forEach(btn => {
            btn.onclick = () => onOpenPostcard?.(postcards[Number(btn.dataset.openPostcard)]);
        });
        listEl.querySelectorAll('[data-open-mail-index]').forEach(btn => {
            btn.onclick = async () => {
                const mail = mails[Number(btn.dataset.openMailIndex)];
                if (!mail) return;
                btn.disabled = true;
                try {
                    const detail = await readMailDetail(mail);
                    showMailDetailModal(mail, detail);
                } finally {
                    btn.disabled = false;
                }
            };
        });
        listEl.querySelectorAll('[data-accept-apply]').forEach(btn => {
            btn.onclick = async () => {
                const item = applies[Number(btn.dataset.acceptApply)];
                const applyId = applyIdOf(item);
                if (!applyId || !state.sdk?.socialFriends?.acceptApply) return;
                btn.disabled = true;
                try { await state.sdk.socialFriends.acceptApply(applyId); showToast('已同意好友请求', 'success'); renderMailbox(panel, _data, { onBack, onOpenPostcard, onEmail }); }
                catch (e) { showToast('处理失败：' + (e?.message || e), 'error'); btn.disabled = false; }
            };
        });
        listEl.querySelectorAll('[data-reject-apply]').forEach(btn => {
            btn.onclick = async () => {
                const item = applies[Number(btn.dataset.rejectApply)];
                const applyId = applyIdOf(item);
                if (!applyId || !state.sdk?.socialFriends?.rejectApply) return;
                btn.disabled = true;
                try { await state.sdk.socialFriends.rejectApply(applyId); showToast('已拒绝好友请求', 'info'); renderMailbox(panel, _data, { onBack, onOpenPostcard, onEmail }); }
                catch (e) { showToast('处理失败：' + (e?.message || e), 'error'); btn.disabled = false; }
            };
        });
    })().catch((e) => {
        console.error('邮箱加载失败', e);
        listEl.innerHTML = '<div class="card-flat mailbox-empty">邮箱加载失败，请稍后再试。</div>';
    });
}
