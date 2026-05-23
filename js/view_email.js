// 好友邮件视图：从好友列表选择收件人并发送 KeepWork 邮件。
import { escapeHtml, showToast } from './utils.js';
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
    return user?.nickname || user?.displayName || user?.name || user?.username || item?.nickname || item?.username || item?.comment || '好友';
}

export function friendDropdownLabel(item) {
    const user = friendUser(item);
    const nickname = user?.nickname || user?.displayName || user?.name || item?.nickname || item?.comment || '';
    const username = user?.username || item?.username || item?.friendUsername || '';
    if (nickname && username && nickname !== username) return `${nickname}(${username})`;
    return nickname || username || '好友';
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
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function letterPlainText({ recipientName, body, senderName, dateText }) {
    return `亲爱的 ${recipientName},\n\n${body}\n\n来自：${senderName}\n${dateText}`;
}

function countEmailWords(text) {
    const tokens = (text || '').trim().match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return tokens ? tokens.length : 0;
}

export function renderEmail(panel, _data = {}, { onBack } = {}) {
    const currentSenderName = senderName(state.user) || senderName(state.sdk?.user) || '我';
    const fixedSubject = `来自${currentSenderName}的信`;
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">发邮件</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="email-view">
            <div class="email-compose-shell">
                <div class="email-paper-controls">
                    <div class="email-control-field">
                        <label class="email-label" for="mhEmailFriend">收信好友</label>
                        <select class="email-paper-input" id="mhEmailFriend" data-email-friend><option value="">正在读取好友...</option></select>
                    </div>
                </div>
                <div class="email-paper-card">
                    <div class="email-paper-head">
                        <span class="email-paper-mark">星球信纸</span>
                        <span class="email-paper-date" data-email-date>${escapeHtml(formatChineseDate())}</span>
                    </div>
                    <div class="email-letter-greeting">亲爱的 <span data-email-greeting-name>XXX</span>,</div>
                    <div class="email-paper-writing-area">
                        <textarea class="email-paper-textarea" id="mhEmailText" data-email-text maxlength="1800" placeholder="把今天想说的话写在这里..." spellcheck="false"></textarea>
                    </div>
                    <div class="email-letter-signature">
                        <div>来自：<span data-email-sender>${escapeHtml(currentSenderName)}</span></div>
                        <div data-email-sign-date>${escapeHtml(formatChineseDate())}</div>
                    </div>
                </div>
                <div class="email-compose-actions">
                    <span class="email-word-count" data-email-word-count>0/${EMAIL_BODY_MAX_WORDS} 词</span>
                    <button class="btn-primary" data-email-send>发送</button>
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
        greetingName.textContent = friend ? friendName(friend) : 'XXX';
    };

    const updateWordCount = () => {
        const count = countEmailWords(textInput.value);
        wordCount.textContent = `${count}/${EMAIL_BODY_MAX_WORDS} 词`;
        wordCount.classList.toggle('is-over', count > EMAIL_BODY_MAX_WORDS);
        sendBtn.disabled = isSending || count > EMAIL_BODY_MAX_WORDS;
    };
    textInput.addEventListener('input', updateWordCount);
    select.addEventListener('change', updateLetterNames);
    updateWordCount();

    loadFriends().then(list => {
        friends = list;
        select.innerHTML = friends.length
            ? '<option value="">选择好友</option>' + friends.map((item, index) => `<option value="${index}">${escapeHtml(friendDropdownLabel(item))}</option>`).join('')
            : '<option value="">暂无好友，请先加好友</option>';
        updateLetterNames();
    });
    sendBtn.onclick = async (e) => {
        const btn = e.currentTarget;
        const selectedIndex = select.value;
        const friend = selectedIndex === '' ? null : friends[Number(selectedIndex)];
        const userId = friendId(friend);
        const username = friendUsername(friend);
        const text = (textInput.value || '').trim();
        const recipientName = friend ? friendName(friend) : 'XXX';
        const fullLetterText = letterPlainText({ recipientName, body: text, senderName: currentSenderName, dateText });
        const textWordCount = countEmailWords(text);
        if (!friend) { showToast('请选择好友', 'error'); return; }
        if (!userId && !username) { showToast('没有找到好友账号信息', 'error'); return; }
        if (!text) { showToast('请输入邮件内容', 'error'); return; }
        if (textWordCount > EMAIL_BODY_MAX_WORDS) { showToast(`邮件正文最多 ${EMAIL_BODY_MAX_WORDS} 词`, 'error'); return; }
        if (!state.sdk?.socialFriends?.sendMail) { showToast('当前 SDK 不支持站内邮件', 'error'); return; }
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
            showToast('邮件已发送', 'success');
            onBack?.();
        } catch (err) {
            showToast('发送失败：' + (err?.message || err), 'error');
        } finally {
            isSending = false;
            updateWordCount();
        }
    };
}
