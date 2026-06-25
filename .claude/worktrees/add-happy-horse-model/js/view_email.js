// 好友邮件视图：从好友列表选择收件人并发送 KeepWork 邮件。
import { escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { state } from './state.js';

const EMAIL_BODY_MAX_WORDS = 200;

export function normalizeArrayResponse(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.rows)) return result.rows;
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.items)) return result.items;
    return [];
}

export function friendUser(item) {
    return item?.friend || item?.friendUser || item?.user || item?.targetUser || item?.userInfo || item;
}

export function friendName(item) {
    const user = friendUser(item);
    return user?.nickname || user?.displayName || user?.name || user?.username || item?.nickname || item?.username || item?.comment || t('emFriendFallback');
}

export function friendDropdownLabel(item) {
    const user = friendUser(item);
    const nickname = user?.nickname || user?.displayName || user?.name || item?.nickname || item?.comment || '';
    const username = user?.username || item?.username || item?.friendUsername || '';
    if (nickname && username && nickname !== username) return `${nickname}(${username})`;
    return nickname || username || t('emFriendFallback');
}

export function senderName(user) {
    return user?.nickname || user?.displayName || user?.name || user?.username || '';
}

export function friendId(item) {
    const user = friendUser(item);
    return user?.id || user?.userId || user?._id || item?.friendId || item?.userId || item?.targetId || item?.id || '';
}

export function friendUsername(item) {
    const user = friendUser(item);
    return user?.username || item?.username || item?.friendUsername || '';
}

export async function loadFriends() {
    const social = state.sdk?.socialFriends;
    if (!social) return [];
    try {
        const result = social.list ? await social.list() : await social.searchFriends({});
        return normalizeArrayResponse(result);
    } catch (e) {
        console.warn('读取好友列表失败', e);
        return [];
    }
}

function textToHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function formatChineseDate(date = new Date()) {
    return t('lpDate', { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
}

function letterPlainText({ recipientName, body, senderName, dateText }) {
    return t('emLetterGreeting', { name: recipientName, body, sender: senderName, date: dateText });
}

function countEmailWords(text) {
    const tokens = (text || '').trim().match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return tokens ? tokens.length : 0;
}

export function renderEmail(panel, _data = {}, { onBack } = {}) {
    const currentSenderName = senderName(state.user) || senderName(state.sdk?.user) || t('emSenderMe');
    const fixedSubject = t('emSubjectFrom', { name: currentSenderName });
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">${escapeHtml(t('emTitle'))}</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="email-view">
            <div class="email-compose-shell">
                <div class="email-paper-controls">
                    <div class="email-control-field">
                        <label class="email-label" for="mhEmailFriend">${escapeHtml(t('emRecipient'))}</label>
                        <select class="email-paper-input" id="mhEmailFriend" data-email-friend><option value="">${escapeHtml(t('emLoadingFriends'))}</option></select>
                    </div>
                </div>
                <div class="email-paper-card">
                    <div class="email-paper-head">
                        <span class="email-paper-mark">${escapeHtml(t('emPaperMark'))}</span>
                        <span class="email-paper-date" data-email-date>${escapeHtml(formatChineseDate())}</span>
                    </div>
                    <div class="email-letter-greeting">${escapeHtml(t('emGreeting'))}<span data-email-greeting-name>${escapeHtml(t('emGreetingPlaceholder'))}</span>,</div>
                    <div class="email-paper-writing-area">
                        <textarea class="email-paper-textarea" id="mhEmailText" data-email-text maxlength="1800" placeholder="${escapeHtml(t('emWritePlaceholder'))}" spellcheck="false"></textarea>
                    </div>
                    <div class="email-letter-signature">
                        <div>${escapeHtml(t('emFrom'))}<span data-email-sender>${escapeHtml(currentSenderName)}</span></div>
                        <div data-email-sign-date>${escapeHtml(formatChineseDate())}</div>
                    </div>
                </div>
                <div class="email-compose-actions">
                    <span class="email-word-count" data-email-word-count>${escapeHtml(t('emWordCount', { count: 0, max: EMAIL_BODY_MAX_WORDS }))}</span>
                    <button class="btn-primary" data-email-send>${escapeHtml(t('emSend'))}</button>
                </div>
            </div>
        </div>`;
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();
    const select = panel.querySelector('[data-email-friend]');
    const textInput = panel.querySelector('[data-email-text]');
    const greetingName = panel.querySelector('[data-email-greeting-name]');
    const signDate = panel.querySelector('[data-email-sign-date]');
    const wordCount = panel.querySelector('[data-email-word-count]');
    const sendBtn = panel.querySelector('[data-email-send]');
    let friends = [];
    let isSending = false;
    const dateText = signDate?.textContent || formatChineseDate();

    const updateLetterNames = () => {
        const selectedIndex = select.value;
        const friend = selectedIndex === '' ? null : friends[Number(selectedIndex)];
        greetingName.textContent = friend ? friendName(friend) : t('emGreetingPlaceholder');
    };

    const updateWordCount = () => {
        const count = countEmailWords(textInput.value);
        wordCount.textContent = t('emWordCount', { count, max: EMAIL_BODY_MAX_WORDS });
        wordCount.classList.toggle('is-over', count > EMAIL_BODY_MAX_WORDS);
        sendBtn.disabled = isSending || count > EMAIL_BODY_MAX_WORDS;
    };
    textInput.addEventListener('input', updateWordCount);
    select.addEventListener('change', updateLetterNames);
    updateWordCount();

    loadFriends().then(list => {
        friends = list;
        select.innerHTML = friends.length
            ? `<option value="">${escapeHtml(t('emSelectFriend'))}</option>` + friends.map((item, index) => `<option value="${index}">${escapeHtml(friendDropdownLabel(item))}</option>`).join('')
            : `<option value="">${escapeHtml(t('emNoFriends'))}</option>`;
        updateLetterNames();
    });
    sendBtn.onclick = async (e) => {
        const btn = e.currentTarget;
        const selectedIndex = select.value;
        const friend = selectedIndex === '' ? null : friends[Number(selectedIndex)];
        const userId = friendId(friend);
        const username = friendUsername(friend);
        const text = (textInput.value || '').trim();
        const recipientName = friend ? friendName(friend) : t('emGreetingPlaceholder');
        const fullLetterText = letterPlainText({ recipientName, body: text, senderName: currentSenderName, dateText });
        const textWordCount = countEmailWords(text);
        if (!friend) { showToast(t('emPickFriend'), 'error'); return; }
        if (!userId && !username) { showToast(t('emNoAccount'), 'error'); return; }
        if (!text) { showToast(t('emEmptyBody'), 'error'); return; }
        if (textWordCount > EMAIL_BODY_MAX_WORDS) { showToast(t('emTooManyWords', { max: EMAIL_BODY_MAX_WORDS }), 'error'); return; }
        if (!state.sdk?.socialFriends?.sendMail) { showToast(t('emNoMailSdk'), 'error'); return; }
        isSending = true;
        btn.disabled = true;
        try {
            await state.sdk.socialFriends.sendMail({
                toUserId: userId,
                toUsername: username,
                title: fixedSubject,
                subject: fixedSubject,
                content: fullLetterText,
                html: textToHtml(fullLetterText),
            });
            showToast(t('emSent'), 'success');
            onBack?.();
        } catch (err) {
            showToast(t('emSendFailed', { error: (err?.message || err) }), 'error');
        } finally {
            isSending = false;
            updateWordCount();
        }
    };
}
