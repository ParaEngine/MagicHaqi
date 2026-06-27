import { $, escapeHtml } from './utils.js';
import { t } from './i18n.js';

export function renderHelp(panel, _data, { onBack } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhHelpBack" title="${escapeHtml(t('back'))}" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">❔ ${escapeHtml(t('help'))}</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <iframe
            title="${escapeHtml(t('helpIframeTitle'))}"
            src="./docs/userguide.html"
            style="position:absolute;top:52px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 52px);border:0;background:#fff"
        ></iframe>`;

    const back = $('mhHelpBack');
    if (back) back.onclick = () => onBack?.();
}