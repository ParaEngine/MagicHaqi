// 好友邮件视图：从好友列表选择收件人并发送 KeepWork 邮件。
import { escapeHtml, showToast } from './utils.js';
import { state } from './state.js';

function normalizeArrayResponse(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.rows)) return result.rows;
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.items)) return result.items;
    return [];
}

function friendUser(item) {
    return item?.friend || item?.friendUser || item?.user || item?.targetUser || item?.userInfo || item;
}

function friendName(item) {
    const user = friendUser(item);
    return user?.username || user?.name || user?.nickname || item?.comment || '好友';
}

function friendEmail(item) {
    const user = friendUser(item);
    return user?.email || item?.email || item?.friendEmail || '';
}

async function loadFriends() {
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

export function renderEmail(panel, _data = {}, { onBack } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhBack" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">发邮件</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div class="email-view">
            <div class="card-flat email-card">
                <label class="email-label">好友</label>
                <select class="modal-input" data-email-friend><option value="">正在读取好友...</option></select>
                <label class="email-label">收件邮箱</label>
                <input class="modal-input" data-email-to placeholder="好友邮箱" inputmode="email">
                <label class="email-label">主题</label>
                <input class="modal-input" data-email-subject maxlength="80" value="来自蛋蛋星球的邮件">
                <label class="email-label">内容</label>
                <textarea class="modal-input" data-email-text maxlength="1000" placeholder="写给好友的话"></textarea>
                <div class="email-actions"><button class="btn-primary" data-email-send>发送</button></div>
            </div>
        </div>`;
    const back = panel.querySelector('#mhBack');
    if (back) back.onclick = () => onBack?.();
    const select = panel.querySelector('[data-email-friend]');
    const toInput = panel.querySelector('[data-email-to]');
    const subjectInput = panel.querySelector('[data-email-subject]');
    const textInput = panel.querySelector('[data-email-text]');
    let friends = [];

    loadFriends().then(list => {
        friends = list;
        select.innerHTML = friends.length
            ? '<option value="">选择好友</option>' + friends.map((item, index) => `<option value="${index}">${escapeHtml(friendName(item))}${friendEmail(item) ? ` · ${escapeHtml(friendEmail(item))}` : ''}</option>`).join('')
            : '<option value="">暂无好友，请先加好友</option>';
    });
    select.onchange = () => {
        const item = friends[Number(select.value)];
        if (item) toInput.value = friendEmail(item) || '';
    };
    panel.querySelector('[data-email-send]').onclick = async (e) => {
        const btn = e.currentTarget;
        const to = (toInput.value || '').trim();
        const subject = (subjectInput.value || '').trim();
        const text = (textInput.value || '').trim();
        if (!to) { showToast('请输入收件邮箱', 'error'); return; }
        if (!text) { showToast('请输入邮件内容', 'error'); return; }
        if (!state.sdk?.socialFriends?.sendEmail) { showToast('当前 SDK 不支持发邮件', 'error'); return; }
        btn.disabled = true;
        try {
            const from = await state.sdk.getUserEmail?.().catch?.(() => '') || undefined;
            await state.sdk.socialFriends.sendEmail({ to, subject: subject || '来自蛋蛋星球的邮件', html: textToHtml(text), from });
            showToast('邮件已发送', 'success');
            onBack?.();
        } catch (err) {
            showToast('发送失败：' + (err?.message || err), 'error');
        } finally {
            btn.disabled = false;
        }
    };
}
