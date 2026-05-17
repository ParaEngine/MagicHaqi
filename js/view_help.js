import { $, escapeHtml } from './utils.js';

export function renderHelp(panel, _data, { onBack } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhHelpBack" title="返回" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">❔ 帮助</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <iframe
            title="${escapeHtml('蛋蛋星球帮助')}"
            src="./docs/userguide.html"
            style="position:absolute;top:52px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 52px);border:0;background:#fff"
        ></iframe>`;

    const back = $('mhHelpBack');
    if (back) back.onclick = () => onBack?.();
}