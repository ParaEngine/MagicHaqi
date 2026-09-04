// VIP 功能门槛弹窗：非会员点击切换宠物 / 加速清理时共用。

import { escapeHtml } from './utils.js';
import { t } from './i18n.js';

/**
 * @param {{
 *   title?: string,
 *   message?: string,
 *   primaryText?: string,
 *   secondaryText?: string|null,
 * }} [options]
 * @returns {Promise<'vip'|'secondary'|'cancel'>}
 */
export function showVipGateDialog(options = {}) {
    const title = options.title || t('vipGateTitle');
    const message = options.message || t('vipGateMessage');
    const primaryText = options.primaryText || t('vipGateBecomeMember');
    const secondaryText = options.secondaryText == null ? null : options.secondaryText;

    return new Promise((resolve) => {
        document.getElementById('mhVipGateMask')?.remove();
        const mask = document.createElement('div');
        mask.id = 'mhVipGateMask';
        mask.className = 'modal-mask mh-vip-gate-mask';
        mask.innerHTML = `
            <div class="modal-card mh-vip-gate-card text-center" role="dialog" aria-modal="true" aria-labelledby="mhVipGateTitle">
                <div class="mh-vip-gate-crown" aria-hidden="true">👑</div>
                <div id="mhVipGateTitle" class="text-base font-bold mb-2" style="color:var(--text-primary)">${escapeHtml(title)}</div>
                <div class="text-sm mb-4" style="color:var(--text-secondary);line-height:1.55">${escapeHtml(message)}</div>
                <div class="flex flex-col gap-2">
                    <button type="button" class="btn-primary" data-act="vip">${escapeHtml(primaryText)}</button>
                    ${secondaryText ? `<button type="button" class="btn-secondary" data-act="secondary">${escapeHtml(secondaryText)}</button>` : ''}
                    <button type="button" class="btn-secondary" data-act="cancel" style="opacity:.85">${escapeHtml(t('vipGateCancel'))}</button>
                </div>
            </div>
        `;
        const done = (value) => {
            mask.remove();
            resolve(value);
        };
        mask.addEventListener('click', (e) => {
            if (e.target === mask) { done('cancel'); return; }
            const act = e.target.closest?.('[data-act]')?.dataset.act;
            if (act === 'vip') done('vip');
            else if (act === 'secondary') done('secondary');
            else if (act === 'cancel') done('cancel');
        });
        document.body.appendChild(mask);
    });
}
