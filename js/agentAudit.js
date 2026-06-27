// Agent 运营审计：把 agent（co-parent / haqi-operator）触发的写操作落到
// `agent/audit.log`，追加 + 限长轮转。供 agentBridge 命令接口与运营控制台复用。
//
// 一条审计 = 一行 JSON：{ ts, actor, cmd, args, ok, result, requestId }
import { agentAppendFile, agentReadFile } from './storage.js';

const AUDIT_PATH = 'agent/audit.log';
const AUDIT_MAX_BYTES = 128 * 1024;

// args 摘要：截断过长字符串，避免把整段图片/代码写进审计。
function summarizeArgs(args) {
    try {
        const json = JSON.stringify(args ?? {});
        return json.length > 400 ? json.slice(0, 400) + '…' : json;
    } catch (_) {
        return '[unserializable]';
    }
}

function summarizeResult(result) {
    if (result == null) return '';
    try {
        const json = typeof result === 'string' ? result : JSON.stringify(result);
        return json.length > 300 ? json.slice(0, 300) + '…' : json;
    } catch (_) {
        return '[unserializable]';
    }
}

/**
 * 记录一条 agent 审计。
 * @param {object} entry
 * @param {string} entry.actor    - 触发者：agentId / 'human' / 'human:<username>'
 * @param {string} entry.cmd      - 命令名（feed/clean/adopt…）
 * @param {object} [entry.args]   - 命令参数
 * @param {boolean} entry.ok      - 是否成功
 * @param {*} [entry.result]      - 结果摘要
 * @param {string} [entry.requestId]
 */
export async function recordAudit(entry = {}) {
    const line = {
        ts: new Date().toISOString(),
        actor: String(entry.actor || 'unknown'),
        cmd: String(entry.cmd || ''),
        args: summarizeArgs(entry.args),
        ok: !!entry.ok,
        result: summarizeResult(entry.result),
        requestId: entry.requestId ? String(entry.requestId) : undefined,
    };
    try {
        await agentAppendFile(AUDIT_PATH, JSON.stringify(line) + '\n', AUDIT_MAX_BYTES);
    } catch (e) {
        console.warn('[agentAudit] 写入失败', e);
    }
}

/**
 * 读取最近 N 条审计（供运营控制台展示）。
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function readRecentAudit(limit = 100) {
    const raw = await agentReadFile(AUDIT_PATH);
    if (!raw) return [];
    const lines = raw.split('\n').filter(Boolean);
    const tail = lines.slice(-Math.max(1, limit));
    const out = [];
    for (const l of tail) {
        try { out.push(JSON.parse(l)); } catch (_) { /* 跳过轮转标记行 */ }
    }
    return out;
}
