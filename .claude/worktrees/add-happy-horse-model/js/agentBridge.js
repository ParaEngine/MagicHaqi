// ============================================================================
// agentBridge.js — MagicHaqi 隐藏 Agent 命令接口 + 机读状态镜像
// ----------------------------------------------------------------------------
// 让 OpenClaw 等 co-parent agent 像调 REST 一样操作 MagicHaqi：
//   入口：window.MagicHaqiAgent.exec(cmdText)  /  隐藏节点 #mh-agent-cmd
//   出口：window.MagicHaqiAgent.getState()     /  隐藏节点 #mh-agent-result
//   状态：隐藏节点 #mh-agent-state（每次 render 刷新）
//
// 设计原则（见 docs / session plan）：
//   - 纯前端，无后端；命令翻译成真实应用动作，复用 app.js 注入的 handlers。
//   - 不改玩家手玩体验：所有节点 hidden，对人不可见。
//   - 写操作经 agentAudit 落审计。
// ============================================================================
import { state, getCurrentPet } from './state.js';
import { recordAudit } from './agentAudit.js';

const STATE_NODE_ID = 'mh-agent-state';
const CMD_NODE_ID = 'mh-agent-cmd';
const RESULT_NODE_ID = 'mh-agent-result';

// app.js 注入的命令处理器集合（见 initAgentBridge）。
let handlers = {};
// 当前 agent 身份（来自 ?agent= 或 adopt 命令），用于审计 actor。
let currentActor = 'human';

// ---------------------------------------------------------------------------
// 命令注册表：cmd -> async (args) => result
// 每条命令复用 handlers（由 app.js 提供），不直接碰 SDK / 玩法逻辑。
// ---------------------------------------------------------------------------
const COMMANDS = {
    // 只读：返回当前机读状态
    getState: async () => buildState(),

    // 照顾类（映射到 handleAction）
    feed:  async (args) => runAction('feed', args),
    clean: async (args) => runAction('bath', args),   // 内部动作键是 bath
    bath:  async (args) => runAction('bath', args),
    play:  async (args) => runAction('play', args),
    sleep: async (args) => runAction('sleep', args),

    // 对宠物说话（聊天）
    say: async (args) => callHandler('say', args),

    // 领养 / 孵化
    adopt: async (args) => {
        if (args && args.agent) setActor(String(args.agent));
        return callHandler('adopt', args);
    },
    hatch: async (args) => callHandler('hatch', args),

    // 导航
    switchView: async (args) => callHandler('switchView', args),
    switchRoom: async (args) => callHandler('switchRoom', args),

    // 商店 / 物品
    openShop: async (args) => callHandler('openShop', args),
    buy: async (args) => callHandler('buy', args),

    // 分享 / 物料
    share: async (args) => callHandler('share', args),

    // 列出可用命令（自描述，便于 agent 发现能力）
    listCommands: async () => ({ commands: Object.keys(COMMANDS) }),
};

// 调用 app.js 注入的 handler；不存在则报错。
async function callHandler(name, args) {
    const fn = handlers[name];
    if (typeof fn !== 'function') {
        throw new Error(`command "${name}" not supported by this build`);
    }
    return await fn(args || {});
}

// handleAction 封装：返回成功与否 + 最新宠物状态。
async function runAction(actionKey, args) {
    if (typeof handlers.handleAction !== 'function') {
        throw new Error('handleAction not wired');
    }
    const ok = await handlers.handleAction(actionKey, args || {});
    const pet = getCurrentPet();
    return { applied: !!ok, pet: pet ? petSummary(pet) : null };
}

function setActor(actor) {
    currentActor = String(actor || 'human') || 'human';
}

export function getActor() {
    return currentActor;
}

// ---------------------------------------------------------------------------
// 机读状态镜像
// ---------------------------------------------------------------------------
function petSummary(pet) {
    if (!pet) return null;
    const s = pet.stats || {};
    return {
        id: pet.id,
        name: pet.name || '',
        stage: pet.stage || '',
        stats: {
            hunger: Math.round(Number(s.hunger) || 0),
            mood: Math.round(Number(s.mood) || 0),
            clean: Math.round(Number(s.clean) || 0),
            bond: Math.round(Number(s.bond) || 0),
        },
        poops: Array.isArray(pet.poops) ? pet.poops.length : (Number(pet.poops) || 0),
        sick: !!(pet.sickness && pet.sickness.id),
        agentOwner: pet.agentOwner || null,
    };
}

// 待办照顾信号：低于阈值即提示 agent 需要照顾。
function careTodos(pet) {
    if (!pet || !pet.stats) return [];
    const s = pet.stats;
    const todos = [];
    if ((Number(s.hunger) || 0) < 40) todos.push({ need: 'feed', stat: 'hunger', value: Math.round(s.hunger) });
    if ((Number(s.clean) || 0) < 40) todos.push({ need: 'clean', stat: 'clean', value: Math.round(s.clean) });
    if ((Number(s.mood) || 0) < 40) todos.push({ need: 'play', stat: 'mood', value: Math.round(s.mood) });
    if (pet.sickness && pet.sickness.id) todos.push({ need: 'heal', sickness: pet.sickness.id });
    return todos;
}

function buildState() {
    const pet = getCurrentPet();
    return {
        ts: Date.now(),
        loggedIn: !!(state.user && state.sdk?.token) && !state.offlineMode,
        offlineMode: !!state.offlineMode,
        user: state.user ? { id: state.user.id, username: state.user.username || '' } : null,
        actor: currentActor,
        view: state.currentView,
        zoomLevel: state.zoomLevel,
        coins: Math.round(Number(state.coins) || 0),
        biofuel: Math.round(Number(state.biofuel) || 0),
        planetName: state.planetName || '',
        currentPet: petSummary(pet),
        pets: (state.petOrder || []).map(id => petSummary(state.pets[id])).filter(Boolean),
        careTodos: careTodos(pet),
        availableCommands: Object.keys(COMMANDS),
    };
}

function writeStateMirror() {
    const node = document.getElementById(STATE_NODE_ID);
    if (!node) return;
    try {
        node.textContent = JSON.stringify(buildState());
    } catch (e) {
        node.textContent = JSON.stringify({ error: String(e && e.message || e) });
    }
}

function writeResult(result) {
    const node = document.getElementById(RESULT_NODE_ID);
    if (!node) return;
    try {
        node.textContent = JSON.stringify(result);
    } catch (e) {
        node.textContent = JSON.stringify({ ok: false, error: String(e && e.message || e) });
    }
    // 触发一个事件，方便 agent 监听而非轮询。
    try {
        window.dispatchEvent(new CustomEvent('magichaqi:agent-result', { detail: result }));
    } catch (_) {}
}

// ---------------------------------------------------------------------------
// 命令解析：支持 JSON 与简写文本
//   JSON:  {"cmd":"feed","args":{"food":"meat"},"requestId":"r1"}
//   简写:  feed food=meat            /  getState
// ---------------------------------------------------------------------------
function parseCommand(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) throw new Error('empty command');
    if (raw[0] === '{') {
        const obj = JSON.parse(raw);
        return { cmd: String(obj.cmd || ''), args: obj.args || {}, requestId: obj.requestId };
    }
    // 简写：第一个 token 是命令名，其余 key=value 进 args
    const parts = raw.split(/\s+/);
    const cmd = parts.shift();
    const args = {};
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq > 0) args[p.slice(0, eq)] = p.slice(eq + 1);
        else args[p] = true;
    }
    return { cmd, args };
}

/**
 * 执行一条命令文本，返回结构化结果，并回写 #mh-agent-result + 审计。
 * @param {string} cmdText
 * @returns {Promise<object>} { ok, cmd, requestId, result|error, state }
 */
export async function exec(cmdText) {
    let cmd = '', args = {}, requestId;
    try {
        ({ cmd, args, requestId } = parseCommand(cmdText));
    } catch (e) {
        const res = { ok: false, error: 'parse error: ' + (e && e.message || e) };
        writeResult(res);
        return res;
    }

    const fn = COMMANDS[cmd];
    if (!fn) {
        const res = { ok: false, cmd, requestId, error: `unknown command "${cmd}"`, availableCommands: Object.keys(COMMANDS) };
        writeResult(res);
        return res;
    }

    let res;
    try {
        const result = await fn(args);
        res = { ok: true, cmd, requestId, result, state: buildState() };
    } catch (e) {
        res = { ok: false, cmd, requestId, error: String(e && e.message || e) };
    }

    writeResult(res);
    writeStateMirror();

    // 写操作落审计（只读命令 getState/listCommands 跳过）
    if (cmd !== 'getState' && cmd !== 'listCommands') {
        recordAudit({ actor: currentActor, cmd, args, ok: res.ok, result: res.ok ? 'ok' : res.error, requestId });
    }
    return res;
}

// ---------------------------------------------------------------------------
// 初始化：注入隐藏节点、绑定 #mh-agent-cmd、暴露 window.MagicHaqiAgent、订阅状态刷新
// ---------------------------------------------------------------------------
function ensureNodes() {
    if (!document.getElementById(STATE_NODE_ID)) {
        const s = document.createElement('script');
        s.type = 'application/json';
        s.id = STATE_NODE_ID;
        document.body.appendChild(s);
    }
    if (!document.getElementById(RESULT_NODE_ID)) {
        const r = document.createElement('script');
        r.type = 'application/json';
        r.id = RESULT_NODE_ID;
        document.body.appendChild(r);
    }
    if (!document.getElementById(CMD_NODE_ID)) {
        // 隐藏文本输入：agent 可写入命令并派发 input/change 事件触发执行
        const c = document.createElement('textarea');
        c.id = CMD_NODE_ID;
        c.setAttribute('aria-hidden', 'true');
        c.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
        c.addEventListener('change', () => {
            const v = c.value;
            if (v && v.trim()) exec(v);
        });
        document.body.appendChild(c);
    }
}

/**
 * 由 app.js 在 SDK / state 就绪后调用。
 * @param {object} opts
 * @param {object} opts.handlers   - 命令处理器（handleAction / say / adopt / switchView ...）
 * @param {string} [opts.actor]    - 初始 agent 身份（?agent=）
 * @param {function} [opts.subscribe] - state.subscribe，用于 render 后刷新镜像
 */
export function initAgentBridge(opts = {}) {
    handlers = opts.handlers || {};
    if (opts.actor) setActor(opts.actor);
    ensureNodes();
    writeStateMirror();
    if (typeof opts.subscribe === 'function') {
        opts.subscribe(() => writeStateMirror());
    }
    window.MagicHaqiAgent = {
        exec,
        getState: buildState,
        listCommands: () => Object.keys(COMMANDS),
        setActor,
        getActor,
        version: '1.0.0',
    };
    return window.MagicHaqiAgent;
}
