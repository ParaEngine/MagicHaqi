// ============================================================================
// view_ops_console.js — 运营控制台（?view=ops）
// 一人公司 / 开发者兜底面板：展示 agent 机读状态、待办照顾信号、审计日志，
// 并可手动触发 agent 命令（用于演示 / 兜底）。遵循「view 只渲染 + 回调」约定。
// ============================================================================
import { $, escapeHtml, showToast } from './utils.js';
import { readRecentAudit } from './agentAudit.js';

function stateMirror() {
    try {
        const node = document.getElementById('mh-agent-state');
        return node ? JSON.parse(node.textContent || '{}') : {};
    } catch (_) {
        return {};
    }
}

function kv(label, value) {
    return `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.06)">
        <span style="color:#64748b">${escapeHtml(label)}</span>
        <span style="font-weight:700;color:#0f172a">${escapeHtml(String(value))}</span>
    </div>`;
}

function renderStateCard(s) {
    const pet = s.currentPet;
    const stats = pet?.stats || {};
    return `<div style="background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:14px">
        <div style="font-weight:800;margin-bottom:8px">📊 Agent State</div>
        ${kv('Logged in', s.loggedIn ? '✅ yes' : '❌ no')}
        ${kv('User', s.user?.username || '-')}
        ${kv('Actor (agent)', s.actor || '-')}
        ${kv('View / Zoom', `${s.view || '-'} / L${s.zoomLevel ?? '-'}`)}
        ${kv('Coins / Biofuel', `${s.coins ?? 0} 🪙 / ${s.biofuel ?? 0} ⛽`)}
        ${kv('Planet', s.planetName || '-')}
        ${pet ? kv('Pet', `${pet.name || pet.id} (${pet.stage || '?'})`) : ''}
        ${pet ? kv('Stats', `🍖${stats.hunger} 😊${stats.mood} 🛁${stats.clean} 💞${stats.bond}`) : ''}
        ${pet ? kv('Agent owner', pet.agentOwner ? `${pet.agentOwner.agentId} (${pet.agentOwner.platform})` : '-') : ''}
    </div>`;
}

function renderTodos(s) {
    const todos = Array.isArray(s.careTodos) ? s.careTodos : [];
    const body = todos.length
        ? todos.map(t => `<li style="padding:3px 0">⚠️ <b>${escapeHtml(t.need)}</b> — ${escapeHtml(t.stat || t.sickness || '')}${t.value != null ? ` (${t.value})` : ''}</li>`).join('')
        : '<li style="color:#16a34a">✅ All good — nothing to do</li>';
    return `<div style="background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:14px">
        <div style="font-weight:800;margin-bottom:8px">🩺 Care To-dos</div>
        <ul style="margin:0;padding-left:18px;font-size:14px">${body}</ul>
    </div>`;
}

function renderAudit(entries) {
    const rows = entries.length
        ? entries.slice().reverse().map(e => `<tr>
            <td style="padding:4px 8px;color:#64748b;white-space:nowrap">${escapeHtml((e.ts || '').slice(5, 19).replace('T', ' '))}</td>
            <td style="padding:4px 8px">${escapeHtml(e.actor || '')}</td>
            <td style="padding:4px 8px;font-weight:700">${escapeHtml(e.cmd || '')}</td>
            <td style="padding:4px 8px">${e.ok ? '✅' : '❌'}</td>
            <td style="padding:4px 8px;color:#475569;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(String(e.result || ''))}</td>
        </tr>`).join('')
        : '<tr><td colspan="5" style="padding:10px;color:#94a3b8">No audit entries yet.</td></tr>';
    return `<div style="background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:14px">
        <div style="font-weight:800;margin-bottom:8px">🧾 Audit Log (recent)</div>
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="text-align:left;color:#64748b;border-bottom:1px solid rgba(0,0,0,0.08)">
                <th style="padding:4px 8px">Time</th><th style="padding:4px 8px">Actor</th>
                <th style="padding:4px 8px">Cmd</th><th style="padding:4px 8px">OK</th><th style="padding:4px 8px">Result</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
    </div>`;
}

function renderCmdRunner() {
    return `<div style="background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:14px">
        <div style="font-weight:800;margin-bottom:8px">⌨️ Run Agent Command</div>
        <textarea id="mhOpsCmd" placeholder='{"cmd":"feed","args":{}}  or  getState' style="width:100%;min-height:64px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;font-size:13px"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-primary" id="mhOpsRun" style="padding:8px 16px">Run</button>
            <button class="btn-secondary" id="mhOpsState" style="padding:8px 16px">getState</button>
            <button class="btn-secondary" id="mhOpsFeed" style="padding:8px 16px">feed</button>
            <button class="btn-secondary" id="mhOpsRefresh" style="padding:8px 16px">↻ Refresh</button>
        </div>
        <pre id="mhOpsResult" style="margin-top:10px;background:#0f172a;color:#a7f3d0;padding:10px;border-radius:8px;font-size:12px;max-height:200px;overflow:auto;white-space:pre-wrap"></pre>
    </div>`;
}

export async function renderOpsConsole(panel, _data, { onBack } = {}) {
    panel.innerHTML = `
        <div class="topbar">
            <button class="btn-icon" id="mhOpsBack" title="Back" style="width:36px;height:36px;font-size:18px">‹</button>
            <span class="font-bold" style="color:var(--text-primary)">🛠️ Ops Console</span>
            <span style="width:36px;height:36px"></span>
        </div>
        <div id="mhOpsBody" style="position:absolute;top:52px;left:0;right:0;bottom:0;overflow-y:auto;padding:16px;background:#f1f5f9">
            <div style="color:#64748b">Loading…</div>
        </div>`;

    const back = $('mhOpsBack');
    if (back) back.onclick = () => onBack?.();

    const body = $('mhOpsBody');

    async function refresh() {
        const s = stateMirror();
        let audit = [];
        try { audit = await readRecentAudit(60); } catch (_) {}
        body.innerHTML =
            renderStateCard(s) +
            renderTodos(s) +
            renderCmdRunner() +
            renderAudit(audit);
        wireRunner();
    }

    async function run(cmdText) {
        const out = $('mhOpsResult');
        if (!window.MagicHaqiAgent?.exec) {
            if (out) out.textContent = 'MagicHaqiAgent not ready';
            return;
        }
        try {
            const res = await window.MagicHaqiAgent.exec(cmdText);
            if (out) out.textContent = JSON.stringify(res, null, 2);
        } catch (e) {
            if (out) out.textContent = 'Error: ' + (e?.message || e);
        }
    }

    function wireRunner() {
        const runBtn = $('mhOpsRun');
        const stateBtn = $('mhOpsState');
        const feedBtn = $('mhOpsFeed');
        const refreshBtn = $('mhOpsRefresh');
        const ta = $('mhOpsCmd');
        if (runBtn) runBtn.onclick = () => run((ta?.value || '').trim() || 'getState');
        if (stateBtn) stateBtn.onclick = () => run('getState');
        if (feedBtn) feedBtn.onclick = async () => { await run('{"cmd":"feed","args":{}}'); showToast('feed sent', 'info', 1000); };
        if (refreshBtn) refreshBtn.onclick = () => refresh();
    }

    await refresh();
}
