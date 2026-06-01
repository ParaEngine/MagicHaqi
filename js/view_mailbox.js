// 邮箱视图：收到的明信片、好友申请、邮件入口。
import { escapeHtml, formatTime, prompt, showToast } from './utils.js';
import { t } from './i18n.js';
import { getCurrentPet, state } from './state.js';
import { loadPostcardList } from './storage.js';
import { postcardSourceLabel, renderPetPostcardHtml } from './view_postcard.js';
import { showPetSharePanel } from './level_planet.js';

const FRIEND_APPLY_RECENT_DAYS = 14;
const FRIEND_APPLY_RECENT_MS = FRIEND_APPLY_RECENT_DAYS * 24 * 60 * 60 * 1000;
const MAILBOX_TABS = [
    { id: 'mails', labelKey: 'mbTabMails' },
    { id: 'applies', labelKey: 'mbTabApplies' },
    { id: 'postcards', labelKey: 'mbTabPostcards' },
];
let showAllFriendApplies = false;
let activeMailboxTab = 'mails';

const rejectIconSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 7l10 10M17 7L7 17" />
    </svg>`;
const acceptIconSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>`;

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
    const hasOwn = raw && typeof raw === 'object' ? (key) => Object.prototype.hasOwnProperty.call(raw, key) : () => false;
    const hasExplicitRewardField = ['rewards', 'reward', 'rewardList', 'items', 'receivedRewards'].some(hasOwn);
    const candidates = [raw?.rewards, raw?.reward, raw?.rewardList, raw?.items, raw?.data?.rewards, hasExplicitRewardField ? [] : fallback].filter(Boolean);
    const rows = [];
    candidates.forEach(candidate => {
        const list = Array.isArray(candidate) ? candidate : (typeof candidate === 'object' ? [candidate] : []);
        list.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const goods = item.goods || item.good || item.item || null;
            const id = item.gsId || item.gsid || item.id || item.itemId || item.goodsId || item.rewardId || goods?.gsId || goods?.id;
            const amount = item.amount || item.count || item.num || item.quantity || 1;
            const name = item.name || item.title || goods?.name || '';
            const desc = item.desc || item.description || goods?.desc || goods?.description || '';
            if (id !== undefined && id !== null && id !== '') rows.push({ id, amount, name, desc, goods });
        });
    });
    return rows;
}

function rewardLabel(item) {
    return item.name || t('mbReward', { id: item.id });
}

function rewardTitle(item) {
    return [item.name || t('mbReward', { id: item.id }), item.desc].filter(Boolean).join('：');
}

function firstOwnValue(source, keys, fallback) {
    if (!source || typeof source !== 'object') return fallback;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
    return fallback;
}

function normalizeMail(item, fallback = {}) {
    const raw = unwrapMailPayload(item) || {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const id = raw.id || raw.mailId || raw.emailId || base.id || '';
    const title = raw.title || raw.subject || base.title || t('mbMailNum', { id: id || '' }).trim() || t('mbNoSubject');
    const createdAt = raw.createdAt || raw.created_at || raw.createTime || raw.updatedAt || base.createdAt || '';
    const rawRead = raw.read ?? raw.isRead ?? base.read ?? 0;
    const rawRewards = firstOwnValue(raw, ['rewards', 'reward'], base.rewards ?? 0);
    const rawRewardReceived = firstOwnValue(raw, ['receivedRewards', 'rewardReceived', 'rewardsReceived'], base.rewardReceived ?? 0);
    const read = Number(rawRead) === 1 || rawRead === true;
    const rewardReceived = Number(rawRewardReceived) === 1 || rawRewardReceived === true;
    const rewardRows = normalizeRewardRows(raw, base.rewardRows || []);
    const rewards = Number(rawRewards) === 1 || rawRewards === true || rewardRows.length > 0;
    const content = pickMailContent(raw) || base.content || '';
    const username = raw.username || raw.fromUsername || raw.senderUsername || base.username || '';
    const from = raw.from || raw.fromEmail || raw.sender || raw.senderName || raw.fromName || base.from || t('mbSystemMail');
    return { raw, id, title, username, createdAt, read, rewards, rewardRows, rewardReceived, content, from };
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

function applyStatusOf(item) {
    return item?.status ?? item?.applyStatus ?? item?.state ?? item?.processStatus;
}

function isPendingApply(item) {
    const status = applyStatusOf(item);
    if (status === undefined || status === null || status === '') return true;
    const normalized = String(status).trim().toUpperCase();
    return normalized === '1' || normalized === 'PENDING';
}

function timestampOf(item) {
    const raw = item?.createdAt || item?.created_at || item?.createTime || item?.created || item?.updatedAt || item?.updated_at || item?.date || item?.time;
    if (!raw) return 0;
    if (typeof raw === 'number') return raw > 100000000000 ? raw : raw * 1000;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatLocalDate(timestamp = Date.now()) {
    const date = new Date(timestamp || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return t('lpDate', { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
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
    const username = await prompt(t('mbAddFriendTitle'), {
        hint: '输入对方 KeepWork 用户名。',
        placeholder: t('mbFriendUsernamePlaceholder'),
        okText: '发送申请',
        maxLength: 32,
        validate: (value) => value ? '' : '请输入用户名',
    });
    if (!username) return;
    if (!state.sdk?.socialFriends?.applyFriend) {
        showToast(t('mbNoFriendSdk'), 'error');
        return;
    }
    const userId = await resolveUserId(username);
    if (!userId) {
        showToast(t('mbUserNotFound'), 'error');
        return;
    }
    try {
        await state.sdk.socialFriends.applyFriend(userId, t('mbApplyMessage'));
        showToast(t('mbApplySent'), 'success');
    } catch (e) {
        showToast(t('mbSendFailed', { error: (e?.message || e) }), 'error');
    }
}

function postcardCardHtml(item, index) {
    const sourceLabel = postcardSourceLabel(item) || item.fromUsername || t('mbFriendFallback');
    const pet = {
        id: `postcard_${index}`,
        name: `${sourceLabel}的宠物`,
        stage: 'egg',
        anim: 'idle',
        bornAt: item.dateReceived,
    };
    return `
        <button class="mailbox-card mailbox-postcard-card" data-open-postcard="${index}" type="button">
            <div class="mailbox-card-kicker">明信片 · ${escapeHtml(formatTime(item.dateReceived))}</div>
            ${renderPetPostcardHtml(pet, { layout: item.layout, text: item.text, photoTheme: item.photoTheme || item.theme })}
            <div class="mailbox-card-foot">${escapeHtml(t('mbFrom'))}${escapeHtml(sourceLabel)}</div>
        </button>`;
}

function friendApplyCardHtml(item, index) {
    const user = applyFromUser(item);
    const name = userNameOf(user) || t('mbUserNum', { id: item.friendId || item.userId || '' }).trim() || t('mbNewFriend');
    const remark = item.remark || item.message || item.content || t('mbWantFriend');
    const timestamp = timestampOf(item);
    return `
        <div class="mailbox-card mailbox-apply-card mailbox-art-card">
            ${timestamp ? `<div class="mailbox-card-kicker mailbox-card-kicker-time"><i>${escapeHtml(formatTime(timestamp))}</i></div>` : ''}
            <div class="mailbox-title">${escapeHtml(name)}</div>
            <div class="mailbox-text">${escapeHtml(remark)}</div>
            <div class="mailbox-inline-actions">
                <button class="mailbox-icon-btn mailbox-icon-reject" data-reject-apply="${index}" type="button" title="${escapeHtml(t('mbReject'))}" aria-label="${escapeHtml(t('mbReject'))}">${rejectIconSvg}</button>
                <button class="mailbox-icon-btn mailbox-icon-accept" data-accept-apply="${index}" type="button" title="${escapeHtml(t('mbAccept'))}" aria-label="${escapeHtml(t('mbAccept'))}">${acceptIconSvg}</button>
            </div>
        </div>`;
}

function mailCardHtml(item, index = 0) {
    const mail = normalizeMail(item);
    const timestamp = timestampOf({ createdAt: mail.createdAt });
    const mailTypeLabel = mail.username ? `邮件(${mail.username})` : '邮件';
    const readStamp = mail.read
        ? `<div class="mailbox-read-stamp" aria-label="${escapeHtml(t('mbRead'))}">${escapeHtml(t('mbRead'))}</div>`
        : `<div class="mailbox-read-stamp mailbox-unread-stamp" aria-label="${escapeHtml(t('mbUnread'))}">${escapeHtml(t('mbUnread'))}</div>`;
    return `
        <button class="mailbox-card mailbox-mail-card mailbox-art-card${mail.read ? ' is-read' : ' is-unread'}" data-open-mail-index="${index}" type="button">
            <div class="mailbox-card-kicker"><span>${escapeHtml(mailTypeLabel)}</span>${timestamp ? `<i>${escapeHtml(formatTime(timestamp))}</i>` : ''}</div>
            <div class="mailbox-title mailbox-mail-title"><span class="mailbox-avatar">✉️</span>${escapeHtml(mail.title)}</div>
            ${readStamp}
        </button>`;
}

function mailContentText(content) {
    const value = typeof content === 'string' ? content : (content ? JSON.stringify(content, null, 2) : '暂无邮件正文');
    if (!/<([a-z][\w:-]*)(\s|>|\/)/i.test(value)) return value;
    const html = value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.textContent || '暂无邮件正文';
}

function parseMailLetter(content, mail) {
    const text = mailContentText(content).replace(/\r\n?/g, '\n').trim();
    const match = text.match(/^(?:亲爱的|Dear)\s+(.+?),\s*\n+([\s\S]*?)\n+(?:来自：|From:)\s*(.+?)(?:\n+(.+))?$/);
    const fallbackDate = formatLocalDate(timestampOf({ createdAt: mail.createdAt }));
    if (match) {
        return {
            recipient: match[1].trim() || userNameOf(state.user) || t('mbYou'),
            body: match[2].trim() || t('mbNoBody'),
            sender: match[3].trim() || mail.from || t('mbSystemMail'),
            date: (match[4] || '').trim() || fallbackDate,
        };
    }
    return {
        recipient: userNameOf(state.user) || t('mbYou'),
        body: text || t('mbNoBody'),
        sender: mail.from || t('mbSystemMail'),
        date: fallbackDate,
    };
}

function mailContentHtml(content, mail) {
    const letter = parseMailLetter(content, mail);
    return `
        <div class="mailbox-letter-paper">
            <span class="mailbox-letter-watermark">${escapeHtml(t('mbWatermark'))}</span>
            <div class="email-paper-head mailbox-letter-head">
                ${letter.date ? `<span class="email-paper-date">${escapeHtml(letter.date)}</span>` : ''}
            </div>
            <div class="email-letter-greeting">${escapeHtml(t('emGreeting'))}${escapeHtml(letter.recipient)},</div>
            <div class="mailbox-letter-body">${escapeHtml(letter.body).replace(/\n/g, '<br>')}</div>
            <div class="email-letter-signature mailbox-letter-signature">
                <div>${escapeHtml(t('mbFromColon'))}${escapeHtml(letter.sender)}</div>
                ${letter.date ? `<div>${escapeHtml(letter.date)}</div>` : ''}
            </div>
        </div>`;
}

function rewardHtml(mail) {
    if (!mail.rewardRows.length) return mail.rewards ? `<div class="mailbox-mail-rewards">${escapeHtml(t('mbHasReward'))}</div>` : '';
    return `<div class="mailbox-mail-rewards">${mail.rewardRows.map(item => `<span title="${escapeHtml(rewardTitle(item))}">${escapeHtml(rewardLabel(item))} x${escapeHtml(item.amount)}</span>`).join('')}</div>`;
}

function showMailDetailModal(mail, detail = null, { onMarkRead, onDelete } = {}) {
    const data = detail ? normalizeMail(detail, normalizeMail(mail)) : normalizeMail(mail);
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
        <div class="modal-card mailbox-mail-detail-card">
            <div class="mailbox-mail-detail-head">
                <span class="mailbox-mail-detail-icon">${data.read ? '✉️' : '📬'}</span>
                <div>
                    <div class="mailbox-mail-detail-title">${escapeHtml(data.title)}</div>
                </div>
                <button class="mailbox-mail-close" data-mail-close type="button" aria-label="${escapeHtml(t('close'))}">×</button>
            </div>
            ${rewardHtml(data)}
            ${data.rewardReceived ? `<div class="mailbox-claimed-stamp mailbox-claimed-stamp-detail" aria-label="${escapeHtml(t('mbClaimed'))}">${escapeHtml(t('mbClaimed'))}</div>` : ''}
            <div class="mailbox-mail-content">${mailContentHtml(data.content, data)}</div>
            <div class="mailbox-mail-detail-actions">
                <button class="mailbox-mail-action mailbox-mail-action-delete" data-mail-delete type="button">${escapeHtml(t('mbDelete'))}</button>
                <button class="mailbox-mail-action mailbox-mail-action-read" data-mail-mark-read type="button" ${data.read ? 'disabled' : ''}>${data.read ? escapeHtml(t('mbRead')) : escapeHtml(t('mbMarkRead'))}</button>
            </div>
        </div>`;
    mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest?.('[data-mail-close]')) mask.remove();
    });
    const markReadBtn = mask.querySelector('[data-mail-mark-read]');
    if (markReadBtn) markReadBtn.onclick = () => onMarkRead?.(data, { mask, button: markReadBtn });
    const deleteBtn = mask.querySelector('[data-mail-delete]');
    if (deleteBtn) deleteBtn.onclick = () => onDelete?.(data, { mask, button: deleteBtn });
    document.body.appendChild(mask);
}

function markMailObjectRead(item) {
    if (!item || typeof item !== 'object') return;
    item.read = 1;
    item.isRead = 1;
    if (item.raw && typeof item.raw === 'object') {
        item.raw.read = 1;
        item.raw.isRead = 1;
    }
}

function friendApplySectionHtml(applies) {
    if (!applies.length) return mailboxEmptyHtml(t('mbNoApply14'));
    const recentApplies = applies.filter(item => isRecentApply(item));
    const olderApplies = applies.filter(item => !isRecentApply(item));
    const visibleApplies = showAllFriendApplies ? [...recentApplies, ...olderApplies] : recentApplies;
    return `
        <section class="mailbox-friend-section">
            <div class="mailbox-section-head">
                <span>${showAllFriendApplies ? escapeHtml(t('mbAllPending')) : escapeHtml(t('mbRecent14'))}</span>
                <b>${visibleApplies.length}</b>
            </div>
            ${!recentApplies.length && !showAllFriendApplies ? mailboxEmptyHtml(t('mbNoApply14')) : ''}
            <div class="mailbox-friend-row">
                ${visibleApplies.map((item) => friendApplyCardHtml(item, applies.indexOf(item))).join('')}
            </div>
            ${olderApplies.length && !showAllFriendApplies ? `
                <button class="mailbox-history-card" data-mailbox-more-applies type="button">
                    <span>${escapeHtml(t('mbViewMore', { n: olderApplies.length }))}</span>
                </button>` : ''}
        </section>`;
}

function mailboxEmptyHtml(text) {
    return `<div class="card-flat mailbox-empty">${escapeHtml(text)}</div>`;
}

function mailboxTabsHtml({ postcards, applies, mails }) {
    const counts = { mails: mails.length, applies: applies.filter(item => isPendingApply(item) && isRecentApply(item)).length, postcards: postcards.length };
    return MAILBOX_TABS.map(tab => `
        <button class="mailbox-tab${activeMailboxTab === tab.id ? ' is-active' : ''}" data-mailbox-tab="${tab.id}" type="button">
            <span>${escapeHtml(t(tab.labelKey))}</span>${counts[tab.id] ? `<b>${counts[tab.id]}</b>` : ''}
        </button>`).join('');
}

function renderMailboxItems({ postcards, applies, mails }) {
    if (activeMailboxTab === 'applies') {
        return friendApplySectionHtml(applies.filter(isPendingApply));
    }
    if (activeMailboxTab === 'postcards') {
        return postcards.length ? postcards.map(postcardCardHtml).join('') : mailboxEmptyHtml(t('mbNoPostcards'));
    }
    return mails.length ? mails.map(mailCardHtml).join('') : mailboxEmptyHtml(t('mbNoMails'));
}

export function renderMailbox(panel, _data = {}, { onBack, onOpenPostcard, onEmail } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('mbTitle'))}</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="mailbox-view">
            <div class="mailbox-tabs" data-mailbox-tabs>
                ${MAILBOX_TABS.map(tab => `<button class="mailbox-tab${activeMailboxTab === tab.id ? ' is-active' : ''}" data-mailbox-tab="${tab.id}" type="button"><span>${escapeHtml(t(tab.labelKey))}</span></button>`).join('')}
            </div>
            <div class="mailbox-scroll" data-mailbox-list>
                <div class="card-flat" style="color:var(--text-muted);text-align:center">${escapeHtml(t('mbReceiving'))}</div>
            </div>
            <div class="mailbox-actions">
                <button class="btn-secondary" data-mailbox-email>${escapeHtml(t('mbEmail'))}</button>
                <button class="btn-secondary" data-mailbox-add-friend>${escapeHtml(t('mbAddFriend'))}</button>
                <button class="btn-primary" data-mailbox-share>${escapeHtml(t('mbMakePostcard'))}</button>
            </div>
        </div>`;
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();
    panel.querySelector('[data-mailbox-share]').onclick = () => {
        const pet = getCurrentPet();
        if (!pet) { showToast(t('mbSelectPetFirst'), 'info'); return; }
        showPetSharePanel(pet);
    };
    panel.querySelector('[data-mailbox-add-friend]').onclick = () => requestFriendByName();
    panel.querySelector('[data-mailbox-email]').onclick = () => onEmail?.();

    const listEl = panel.querySelector('[data-mailbox-list]');
    const tabsEl = panel.querySelector('[data-mailbox-tabs]');
    const bindTabs = (data, renderCurrentList = null) => {
        tabsEl.innerHTML = mailboxTabsHtml(data);
        tabsEl.querySelectorAll('[data-mailbox-tab]').forEach(btn => {
            btn.onclick = () => {
                activeMailboxTab = btn.dataset.mailboxTab || 'mails';
                bindTabs(data, renderCurrentList);
                renderCurrentList?.();
            };
        });
    };
    bindTabs({ postcards: [], applies: [], mails: [] });

    (async () => {
        const [postcards, applies, mails] = await Promise.all([loadPostcardList(), loadFriendApplies(), loadMails()]);
        const data = { postcards, applies, mails };
        const findMailIndex = (mail) => {
            const mailId = normalizeMail(mail).id;
            return data.mails.findIndex(item => normalizeMail(item).id === mailId);
        };
        const markMailReadLocally = (mail) => {
            const index = findMailIndex(mail);
            markMailObjectRead(index >= 0 ? data.mails[index] : mail);
        };
        const deleteMailLocally = (mail) => {
            const index = findMailIndex(mail);
            if (index >= 0) data.mails.splice(index, 1);
        };
        const renderCurrentList = () => {
            listEl.innerHTML = renderMailboxItems(data);
            const moreBtn = listEl.querySelector('[data-mailbox-more-applies]');
            if (moreBtn) moreBtn.onclick = () => { showAllFriendApplies = true; renderCurrentList(); };
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
                        const detailMail = detail ? normalizeMail(detail, normalizeMail(mail)) : normalizeMail(mail);
                        if (detailMail.read && !normalizeMail(mail).read) {
                            markMailReadLocally(detailMail);
                            bindTabs(data, renderCurrentList);
                            renderCurrentList();
                        }
                        showMailDetailModal(mail, detail, {
                            onMarkRead: async (detailMail, { button }) => {
                                const mailId = normalizeMail(detailMail || mail).id;
                                if (!mailId || !state.sdk?.socialFriends?.setMailRead) {
                                    showToast(t('mbNoMarkSdk'), 'error');
                                    return;
                                }
                                button.disabled = true;
                                try {
                                    await state.sdk.socialFriends.setMailRead({ ids: [mailId] });
                                    markMailReadLocally(detailMail || mail);
                                    bindTabs(data, renderCurrentList);
                                    renderCurrentList();
                                    button.textContent = '已读';
                                    showToast(t('mbMarkedRead'), 'success');
                                } catch (e) {
                                    showToast(t('mbMarkFailed', { error: (e?.message || e) }), 'error');
                                    button.disabled = false;
                                }
                            },
                            onDelete: async (detailMail, { mask, button }) => {
                                const mailId = normalizeMail(detailMail || mail).id;
                                if (!mailId || !state.sdk?.socialFriends?.deleteMail) {
                                    showToast(t('mbNoDeleteSdk'), 'error');
                                    return;
                                }
                                button.disabled = true;
                                try {
                                    await state.sdk.socialFriends.deleteMail({ ids: [mailId] });
                                    deleteMailLocally(detailMail || mail);
                                    bindTabs(data, renderCurrentList);
                                    renderCurrentList();
                                    mask.remove();
                                    showToast(t('mbDeleted'), 'success');
                                } catch (e) {
                                    showToast(t('mbDeleteFailed', { error: (e?.message || e) }), 'error');
                                    button.disabled = false;
                                }
                            },
                        });
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
                    try { await state.sdk.socialFriends.acceptApply(applyId); showToast(t('mbAccepted'), 'success'); renderMailbox(panel, _data, { onBack, onOpenPostcard, onEmail }); }
                    catch (e) { showToast(t('mbHandleFailed', { error: (e?.message || e) }), 'error'); btn.disabled = false; }
                };
            });
            listEl.querySelectorAll('[data-reject-apply]').forEach(btn => {
                btn.onclick = async () => {
                    const item = applies[Number(btn.dataset.rejectApply)];
                    const applyId = applyIdOf(item);
                    if (!applyId || !state.sdk?.socialFriends?.rejectApply) return;
                    btn.disabled = true;
                    try { await state.sdk.socialFriends.rejectApply(applyId); showToast(t('mbRejected'), 'info'); renderMailbox(panel, _data, { onBack, onOpenPostcard, onEmail }); }
                    catch (e) { showToast(t('mbHandleFailed', { error: (e?.message || e) }), 'error'); btn.disabled = false; }
                };
            });
        };
        bindTabs(data, renderCurrentList);
        renderCurrentList();
    })().catch((e) => {
        console.error('邮箱加载失败', e);
        listEl.innerHTML = '<div class="card-flat mailbox-empty">邮箱加载失败，请稍后再试。</div>';
    });
}
