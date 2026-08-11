// 游戏创造工坊「设置」弹窗。
// 由 view_game_maker.js 的设置按钮（⚙ 工具栏按钮）唤起，覆盖在创作面板之上。
//
// 三个标签页：
//   1. 全局：游戏 icon + 标题。
//   2. 游戏配置：从游戏代码里解析 `game_config = {...}`，提供「可视化 / 代码」双视图编辑器
//      （可视化 = 键值行编辑器，代码 = JSON 编辑器）+ 顶部 Save，保存后写回 game.html。
//   3. 美术资源：从游戏代码里解析 `art_assets = [...]`，以网格列出全部资源；顶部「搜索栏 + 新建」，
//      每张卡片右上角 ⋮ 菜单可重命名 / 删除。点击「新建」打开子弹窗，从蛋蛋星球的场景 / 宠物 / 商店道具中
//      多选追加，或打开外部 ArtAssetGenerator.html 生成自定义资源，保存后写回 game.html。
//
// 设计原则：本模块不直接持有创作工坊的状态，而是通过 ctx 提供的 getter/setter 与回调读写，
// 这样既能复用工坊已有的持久化逻辑（persistGame / setPreview），又保持职责单一、便于独立维护。
import { $, escapeHtml, showToast } from './utils.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { CONFIG, SHOP_ITEMS, DECO_VISUALS } from './config.js';
import { displayPetName } from './dna.js';
import { SHEET_COLS, SHEET_ROWS } from './pet.js';

// 外部美术资源生成器（与 view_settings.js 的 openDevTool 同源）。
const ART_GENERATOR_FILE = 'ArtAssetGenerator.html';
function getDevToolUrl(fileName) {
    if (typeof window === 'undefined') return '';
    const origin = 'https://keepwork.com';
    const pagePath = 'maisi/maisi/webgames/MagicHaqi';
    return `${origin}/api/raw/${pagePath}/dev_tools/${fileName}`;
}

// ---------- 代码解析：从 HTML 文本里提取 / 写回声明式数据段 ----------

// 在源码里定位形如 `name = <value>;` 的赋值表达式，返回 { start, end, raw }（含分号）。
// 仅匹配紧跟 `{` 或 `[` 的对象/数组字面量，并通过括号配对找到结束位置（容忍字符串内的括号）。
function locateAssignment(source, name) {
    const text = String(source || '');
    // 匹配 `name =` （允许 var/let/const 前缀与任意空白），其后是 { 或 [。
    const re = new RegExp(`(?:^|[\\n;])\\s*(?:var\\s+|let\\s+|const\\s+)?${name}\\s*=\\s*([\\[{])`, 'm');
    const m = re.exec(text);
    if (!m) return null;
    const openIdx = m.index + m[0].lastIndexOf(m[1]);
    const open = text[openIdx];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = '';
    let escaped = false;
    let i = openIdx;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === inStr) inStr = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) { i++; break; }
        }
    }
    // 吞掉紧随其后的可选分号。
    let end = i;
    while (end < text.length && /\s/.test(text[end])) end++;
    if (text[end] === ';') end++;
    // 赋值表达式真正的开始：从 name 标识符开始（跳过 m[0] 里的前导空白/换行/分号）。
    const assignStart = m.index + m[0].search(new RegExp(`(?:var\\s+|let\\s+|const\\s+)?${name}\\s*=`));
    return { start: assignStart, end, valueStart: openIdx, valueEnd: i };
}

// 安全地把一段对象/数组字面量解析成 JS 值。优先 JSON.parse，失败再退回受限 Function 求值。
function evalLiteral(literal) {
    const raw = String(literal || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    try {
        // 受限求值：仅返回字面量，不暴露任何外部变量。仅用于解析游戏自身的数据段。
        // eslint-disable-next-line no-new-func
        return Function(`"use strict";return (${raw});`)();
    } catch (_) { return null; }
}

// 读取 game_config 对象（不存在时返回 null）。
function readGameConfig(html) {
    const loc = locateAssignment(html, 'game_config');
    if (!loc) return null;
    const literal = String(html).slice(loc.valueStart, loc.valueEnd);
    const value = evalLiteral(literal);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// 读取 art_assets 数组（不存在时返回 null）。
function readArtAssets(html) {
    const loc = locateAssignment(html, 'art_assets');
    if (!loc) return null;
    const literal = String(html).slice(loc.valueStart, loc.valueEnd);
    const value = evalLiteral(literal);
    return Array.isArray(value) ? value : null;
}

// 找到第一个「不带 src 属性」的内联 <script> 标签的起始位置（即游戏主逻辑脚本）。
// 带 src 的脚本（如 CDN 库 Tailwind / Three.js）会被跳过，确保数据段插在它们之后、
// 但在第一段真正的游戏逻辑脚本之前——符合 AGENTS.md 的「数据段在游戏脚本之前」约定。
// 找不到时返回 -1。
function firstInlineScriptStart(text) {
    const re = /<script\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const attrs = m[1] || '';
        // 跳过带 src 的外部脚本（CDN 库等）。
        if (/\bsrc\s*=/i.test(attrs)) continue;
        return m.index;
    }
    return -1;
}

// 把 name 的赋值替换为新的字面量；若不存在则注入一个新的数据 <script>。
// 注入位置：第一个不带 src 的内联 <script> 之前（游戏主逻辑脚本之前），
// 让 game_config / art_assets 在游戏代码读取它们之前就已声明。
function writeAssignment(html, name, valueLiteral) {
    const text = String(html || '');
    const loc = locateAssignment(text, name);
    const replacement = `${name} = ${valueLiteral};`;
    if (loc) {
        return text.slice(0, loc.start) + replacement + text.slice(loc.end);
    }
    // 没有现成的数据段：注入一个新的 <script>，放在第一段内联游戏脚本之前。
    const block = `<script>\n${replacement}\n</script>\n`;
    const inlineIdx = firstInlineScriptStart(text);
    if (inlineIdx >= 0) {
        return text.slice(0, inlineIdx) + block + text.slice(inlineIdx);
    }
    // 兜底：没有任何内联脚本时放到 </body> 前；再没有就追加到末尾。
    const fallback = `\n${block}`;
    if (/<\/body>/i.test(text)) return text.replace(/<\/body>/i, `${fallback}</body>`);
    return text + fallback;
}

// 把 JS 值序列化成易读的字面量（2 空格缩进）。
function stringifyValue(value) {
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

// ---------- 美术资源来源：场景 / 宠物 / 商店道具 ----------

// 场景：来自 CONFIG.fieldDefaultScenes，单图（rows=1, columns=1）。
function listSceneAssets() {
    const scenes = CONFIG?.fieldDefaultScenes || {};
    const seen = new Set();
    const out = [];
    for (const key of Object.keys(scenes)) {
        const s = scenes[key];
        if (!s || !s.imageUrl || seen.has(s.id || s.imageUrl)) continue;
        seen.add(s.id || s.imageUrl);
        out.push({
            id: s.id || `scene_${key}`,
            name: s.title || s.id || key,
            imageUrl: s.imageUrl,
            rows: 1,
            columns: 1,
            isTransparent: false,
            description: `${s.title || s.id || key} scene background`,
        });
    }
    return out;
}

// 宠物：来自 state.pets，使用 4x4 精灵图（imageSheetUrl）。
function listPetAssets() {
    const pets = state?.pets || {};
    const out = [];
    for (const id of Object.keys(pets)) {
        const pet = pets[id];
        if (!pet || !pet.imageSheetUrl) continue; // 蛋阶段或形象未就绪的跳过。
        out.push({
            id: `pet_${pet.id}`,
            name: displayPetName(pet) || pet.id,
            imageUrl: pet.imageSheetUrl,
            rows: SHEET_ROWS,
            columns: SHEET_COLS,
            isTransparent: true,
            description: `${displayPetName(pet) || pet.id} pet sprite sheet (${SHEET_ROWS}x${SHEET_COLS})`,
        });
    }
    return out;
}

// 商店道具：来自 SHOP_ITEMS（+ DECO_VISUALS 回退取图），单图。
function listShopAssets() {
    const items = Array.isArray(SHOP_ITEMS) ? SHOP_ITEMS : [];
    const out = [];
    for (const item of items) {
        if (!item || !item.id) continue;
        const imageUrl = item.imageUrl || DECO_VISUALS?.[item.id]?.imageUrl || '';
        if (!imageUrl) continue;
        out.push({
            id: `item_${item.id}`,
            name: (item.name && (item.name.zh || item.name.en || item.name)) || item.id,
            imageUrl,
            rows: 1,
            columns: 1,
            isTransparent: true,
            description: `${item.id} shop item`,
        });
    }
    return out;
}

const ART_SOURCE_LOADERS = {
    scene: listSceneAssets,
    pet: listPetAssets,
    item: listShopAssets,
};

// ---------- 主入口 ----------

// 打开设置弹窗。
// host: 用于挂载覆盖层的容器（创作面板 panel）。
// ctx: {
//   getName(), setName(v), getIcon(), setIcon(v), getHtml(), setHtml(v),
//   showEmojiDialog(),
//   onApplyMeta()  // 标题/图标变更后回调（刷新工坊顶栏）
//   persistHtml(html)  // 写回 game.html 并预览/持久化；返回 Promise
// }
export function openGameMakerSettings(host, ctx = {}) {
    if (!host) return;
    closeGameMakerSettings(host);

    let activeTab = 'global'; // 'global' | 'config' | 'art'（默认打开全局）

    const overlay = document.createElement('div');
    overlay.className = 'mh-gms-overlay';
    overlay.id = 'mhGmSettings';
    overlay.innerHTML = `
        <style>
            /* 弹层铺满宿主面板（与游戏创作工坊同一容器），始终从顶到底占满，确保底部紧贴面板底。 */
            .mh-gms-overlay { position:absolute; inset:0; z-index:80; display:flex; align-items:stretch; justify-content:center; padding:0; background:rgba(6,18,44,.58); backdrop-filter:blur(6px); }
            /* 设置窗占满整个面板高度；移动端全宽无圆角，宽屏限宽并加圆角但仍占满全高。 */
            .mh-gms-window { position:relative; width:min(560px,100%); height:100%; display:flex; flex-direction:column; border-radius:0; overflow:hidden; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:0; box-shadow:0 18px 48px rgba(0,0,0,.5); color:#e2e8f0; }
            /* 宽屏：限制宽度并加边框圆角，但高度仍占满面板（仅上下留少量内边距）。 */
            @media (min-width: 560px) {
                .mh-gms-overlay { padding:12px; }
                .mh-gms-window { height:100%; border-radius:18px; border:1.5px solid rgba(99,102,241,.36); }
            }
            .mh-gms-head { display:flex; align-items:center; gap:10px; padding:13px 16px; border-bottom:1px solid rgba(148,163,184,.16); flex-shrink:0; }
            .mh-gms-title { flex:1; font-size:16px; font-weight:900; }
            .mh-gms-close { width:32px; height:32px; border:0; border-radius:9px; background:rgba(255,255,255,.08); color:#94a3b8; display:grid; place-items:center; cursor:pointer; font-size:18px; }
            .mh-gms-close:hover { background:rgba(255,255,255,.16); color:#e2e8f0; }
            .mh-gms-tabs { display:flex; gap:4px; padding:8px 12px 0; flex-shrink:0; }
            .mh-gms-tab { flex:1; min-height:40px; border:0; border-bottom:2px solid transparent; background:none; color:#64748b; font-size:14px; font-weight:800; cursor:pointer; border-radius:8px 8px 0 0; }
            .mh-gms-tab.active { color:#a5b4fc; border-bottom-color:#6366f1; background:rgba(99,102,241,.08); }
            .mh-gms-body { flex:1; min-height:0; overflow:auto; padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px)); -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; }
            .mh-gms-pane { display:none; flex-direction:column; gap:14px; }
            .mh-gms-pane.active { display:flex; flex:1; min-height:0; }
            /* 代码视图：占满标签页剩余高度，textarea 自适应填满。 */
            .mh-gms-art-views.mh-gms-code-pane.active { flex:1; min-height:0; }
            .mh-gms-code-pane > .mh-gms-field { flex:1; min-height:0; }
            .mh-gms-code-pane .mh-gms-code { flex:1; min-height:120px; resize:none; height:auto; }
            .mh-gms-field { display:flex; flex-direction:column; gap:6px; }
            .mh-gms-label { font-size:12px; font-weight:800; color:#94a3b8; letter-spacing:.04em; }
            .mh-gms-input, .mh-gms-select { width:100%; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.24); border-radius:10px; color:#e2e8f0; font-size:15px; padding:9px 11px; outline:none; box-sizing:border-box; }
            .mh-gms-input:focus, .mh-gms-select:focus { border-color:#6366f1; }
            /* 下拉展开的选项：强制深底浅字，避免某些系统/浏览器把展开列表渲染成「浅底浅字」而看不清。 */
            .mh-gms-select option { background:#111d38; color:#e2e8f0; }
            .mh-gms-icon-row { display:flex; align-items:center; gap:10px; }
            .mh-gms-icon-btn { width:48px; height:48px; flex:0 0 48px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.06); color:#e2e8f0; border-radius:12px; font-size:24px; display:grid; place-items:center; cursor:pointer; padding:0; }
            .mh-gms-icon-btn:hover { border-color:#6366f1; }
            .mh-gms-btn { border:0; border-radius:10px; padding:10px 14px; font-size:14px; font-weight:800; cursor:pointer; }
            .mh-gms-btn-primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }
            .mh-gms-btn-secondary { background:rgba(255,255,255,.08); color:#cbd5e1; border:1px solid rgba(148,163,184,.24); }
            .mh-gms-btn-secondary:hover { border-color:#6366f1; color:#a5b4fc; }
            .mh-gms-hint { font-size:12px; color:#64748b; line-height:1.5; }
            .mh-gms-code { width:100%; min-height:200px; resize:vertical; background:rgba(0,0,0,.25); border:1px solid rgba(148,163,184,.24); border-radius:10px; color:#e2e8f0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px; line-height:1.5; padding:11px; outline:none; box-sizing:border-box; white-space:pre; }
            .mh-gms-code:focus { border-color:#6366f1; }
            .mh-gms-actions { display:flex; gap:8px; flex-wrap:wrap; }
            .mh-gms-empty { padding:18px; text-align:center; color:#64748b; font-size:13px; border:1px dashed rgba(148,163,184,.24); border-radius:12px; }
            .mh-gms-src-tabs { display:flex; gap:6px; }
            .mh-gms-src-tab { flex:1; min-height:34px; border:1px solid rgba(148,163,184,.24); background:rgba(255,255,255,.04); color:#cbd5e1; border-radius:9px; font-size:13px; font-weight:800; cursor:pointer; }
            .mh-gms-src-tab.active { background:rgba(99,102,241,.18); border-color:#6366f1; color:#a5b4fc; }
            .mh-gms-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
            .mh-gms-card { position:relative; border:1px solid rgba(148,163,184,.22); background:rgba(255,255,255,.04); border-radius:11px; overflow:hidden; cursor:pointer; text-align:left; padding:0; color:#e2e8f0; }
            .mh-gms-card:hover { border-color:#6366f1; }
            .mh-gms-card.selected { border-color:#818cf8; box-shadow:0 0 0 2px rgba(129,140,248,.4); }
            .mh-gms-card-thumb { display:block; width:100%; aspect-ratio:1/1; background-color:#0b1830; }
            .mh-gms-card-sheet { background-repeat:no-repeat; }
            .mh-gms-card-name { padding:5px 7px; font-size:11px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gms-card-check { position:absolute; top:5px; right:5px; width:20px; height:20px; border-radius:50%; background:#6366f1; color:#fff; display:none; align-items:center; justify-content:center; font-size:13px; }
            .mh-gms-card.selected .mh-gms-card-check { display:flex; }
            .mh-gms-current { display:flex; flex-direction:column; gap:6px; }
            .mh-gms-current-list { display:flex; flex-direction:column; gap:6px; }
            .mh-gms-current-item { display:flex; align-items:center; gap:9px; padding:7px 9px; border:1px solid rgba(148,163,184,.18); border-radius:9px; background:rgba(255,255,255,.03); }
            .mh-gms-current-thumb { width:34px; height:34px; flex:0 0 34px; border-radius:7px; background:#0b1830 center/cover no-repeat; }
            .mh-gms-current-meta { flex:1; min-width:0; }
            .mh-gms-current-id { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gms-current-sub { font-size:11px; color:#64748b; }
            .mh-gms-current-del { flex:0 0 auto; border:0; background:none; color:#64748b; font-size:15px; cursor:pointer; padding:6px 8px; border-radius:7px; }
            .mh-gms-current-del:hover { background:rgba(248,113,113,.16); color:#f87171; }
            /* 美术资源：列表 + 搜索栏 + 新建按钮 + 卡片菜单 */
            .mh-gms-art-toolbar { display:flex; align-items:center; gap:8px; flex-shrink:0; }
            .mh-gms-search { flex:1; position:relative; }
            .mh-gms-search input { width:100%; box-sizing:border-box; background:rgba(255,255,255,.06); border:1px solid rgba(148,163,184,.24); border-radius:10px; color:#e2e8f0; font-size:14px; padding:9px 11px 9px 32px; outline:none; }
            .mh-gms-search input:focus { border-color:#6366f1; }
            .mh-gms-search::before { content:'🔍'; position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:12px; opacity:.7; pointer-events:none; }
            .mh-gms-new-btn { flex:0 0 auto; border:0; border-radius:10px; padding:9px 14px; font-size:14px; font-weight:800; cursor:pointer; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; white-space:nowrap; }
            .mh-gms-new-btn:hover { filter:brightness(1.08); }
            /* 移动端默认两列；更宽屏幕下用 auto-fill 自动塞入更多、更小的卡片。 */
            .mh-gms-art-list { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
            @media (min-width: 560px) {
                .mh-gms-art-list { grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; }
            }
            .mh-gms-art-card { position:relative; border:1px solid rgba(148,163,184,.22); background:rgba(255,255,255,.04); border-radius:11px; overflow:hidden; }
            /* 透明棋盘格底：让透明通道 PNG 的边界可见；缩略图用 contain 以保留原始宽高比。 */
            .mh-gms-art-card-thumb { display:block; width:100%; aspect-ratio:1/1; background-color:#0b1830; background-image:linear-gradient(45deg,#1b2a4a 25%,transparent 25%),linear-gradient(-45deg,#1b2a4a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1b2a4a 75%),linear-gradient(-45deg,transparent 75%,#1b2a4a 75%); background-size:16px 16px; background-position:0 0,0 8px,8px -8px,-8px 0; }
            .mh-gms-art-card-name { padding:7px 9px; font-size:12px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .mh-gms-art-card-menu { position:absolute; top:6px; right:6px; width:26px; height:26px; border:0; border-radius:7px; background:rgba(8,16,34,.6); color:#cbd5e1; font-size:16px; line-height:1; cursor:pointer; display:grid; place-items:center; }
            .mh-gms-art-card-menu:hover { background:rgba(8,16,34,.85); color:#fff; }
            .mh-gms-menu-pop { position:absolute; z-index:5; min-width:120px; background:#0b1830; border:1px solid rgba(148,163,184,.3); border-radius:10px; box-shadow:0 12px 30px rgba(0,0,0,.5); padding:5px; display:flex; flex-direction:column; gap:2px; }
            .mh-gms-menu-pop button { display:flex; align-items:center; gap:8px; border:0; background:none; color:#e2e8f0; font-size:13px; font-weight:700; padding:8px 10px; border-radius:7px; cursor:pointer; text-align:left; }
            .mh-gms-menu-pop button:hover { background:rgba(99,102,241,.18); }
            .mh-gms-menu-pop button.danger:hover { background:rgba(248,113,113,.18); color:#f87171; }
            /* 列表 / 代码 视图切换子标签 */
            .mh-gms-art-views { display:none; flex-direction:column; gap:12px; }
            .mh-gms-art-views.active { display:flex; }
            /* 游戏配置：可视化键值编辑器 */
            .mh-gms-kv-list { display:flex; flex-direction:column; gap:8px; }
            .mh-gms-kv-row { display:flex; align-items:center; gap:6px; }
            .mh-gms-kv-row input.mh-gms-kv-key { flex:0 0 34%; min-width:0; }
            .mh-gms-kv-row .mh-gms-kv-val-wrap { flex:1; min-width:0; display:flex; }
            .mh-gms-kv-row .mh-gms-kv-val-wrap input, .mh-gms-kv-row .mh-gms-kv-val-wrap select { width:100%; }
            .mh-gms-kv-type { flex:0 0 76px; }
            .mh-gms-kv-bool { flex:1; display:flex; align-items:center; gap:8px; padding:9px 11px; border:1px solid rgba(148,163,184,.24); border-radius:10px; background:rgba(255,255,255,.06); font-size:14px; color:#e2e8f0; cursor:pointer; }
            .mh-gms-kv-bool input { width:auto; margin:0; accent-color:#6366f1; }
            .mh-gms-kv-del { flex:0 0 auto; border:0; background:none; color:#64748b; font-size:15px; cursor:pointer; padding:8px; border-radius:8px; }
            .mh-gms-kv-del:hover { background:rgba(248,113,113,.16); color:#f87171; }
            /* 新建资源选择器：子弹窗 */
            .mh-gms-picker { position:absolute; inset:0; z-index:90; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(6,18,44,.5); backdrop-filter:blur(4px); }
            .mh-gms-picker-win { width:min(520px,100%); max-height:80vh; display:flex; flex-direction:column; border-radius:16px; overflow:hidden; background:linear-gradient(180deg,#111d38 0%,#0f2747 100%); border:1.5px solid rgba(99,102,241,.4); box-shadow:0 18px 48px rgba(0,0,0,.55); }
            .mh-gms-picker-head { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(148,163,184,.16); flex-shrink:0; }
            .mh-gms-picker-title { flex:1; font-size:15px; font-weight:900; }
            .mh-gms-picker-body { flex:1; min-height:0; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
            .mh-gms-picker-foot { flex-shrink:0; display:flex; gap:8px; padding:12px 14px; border-top:1px solid rgba(148,163,184,.16); }
        </style>
        <div class="mh-gms-window" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('mgGameSettingsTitle'))}">
            <div class="mh-gms-head">
                <span class="mh-gms-title">⚙ ${escapeHtml(t('mgGameSettingsTitle'))}</span>
                <button type="button" class="mh-gms-close" data-mh-gms-close aria-label="${escapeHtml(t('close'))}">×</button>
            </div>
            <div class="mh-gms-tabs">
                <button type="button" class="mh-gms-tab active" data-mh-gms-tab="global">${escapeHtml(t('mgGameSettingsTabGlobal'))}</button>
                <button type="button" class="mh-gms-tab" data-mh-gms-tab="config">${escapeHtml(t('mgGameSettingsTabConfig'))}</button>
                <button type="button" class="mh-gms-tab" data-mh-gms-tab="art">${escapeHtml(t('mgGameSettingsTabArt'))}</button>
            </div>
            <div class="mh-gms-body">
                <div class="mh-gms-pane active" data-mh-gms-pane="global"></div>
                <div class="mh-gms-pane" data-mh-gms-pane="config"></div>
                <div class="mh-gms-pane" data-mh-gms-pane="art"></div>
            </div>
        </div>`;
    host.appendChild(overlay);

    const win = overlay.querySelector('.mh-gms-window');
    const paneGlobal = overlay.querySelector('[data-mh-gms-pane="global"]');
    const paneConfig = overlay.querySelector('[data-mh-gms-pane="config"]');
    const paneArt = overlay.querySelector('[data-mh-gms-pane="art"]');

    // ---------- 全局标签页 ----------
    function renderGlobal() {
        paneGlobal.innerHTML = `
            <div class="mh-gms-field">
                <span class="mh-gms-label">${escapeHtml(t('mgGameSettingsNameLabel'))}</span>
                <div class="mh-gms-icon-row">
                    <button type="button" class="mh-gms-icon-btn" data-mh-gms-icon title="${escapeHtml(t('mgGameIconLabel'))}">${escapeHtml(ctx.getIcon ? (ctx.getIcon() || '🎮') : '🎮')}</button>
                    <input type="text" class="mh-gms-input" data-mh-gms-name maxlength="64" placeholder="${escapeHtml(t('mgGameNamePlaceholder'))}" value="${escapeHtml(ctx.getName ? (ctx.getName() || '') : '')}">
                </div>
            </div>`;

        paneGlobal.querySelector('[data-mh-gms-icon]')?.addEventListener('click', async () => {
            if (ctx.showEmojiDialog) {
                await ctx.showEmojiDialog();
                const iconBtn = paneGlobal.querySelector('[data-mh-gms-icon]');
                if (iconBtn && ctx.getIcon) iconBtn.textContent = ctx.getIcon() || '🎮';
            }
        });
        paneGlobal.querySelector('[data-mh-gms-name]')?.addEventListener('input', (e) => {
            if (ctx.setName) ctx.setName(e.target.value);
            if (ctx.onApplyMeta) ctx.onApplyMeta();
        });
    }

    // ---------- 游戏配置标签页 ----------
    // 与美术资源标签页一致：「可视化 / 代码」双视图 + 顶部 Save。
    //   可视化：键值行编辑器（每行 字段名 + 类型 + 值，可增删）。
    //   代码：game_config 的 JSON 编辑器。
    let configView = 'gui'; // 'gui' | 'code'
    let configRows = null;  // [{ key, type:'string'|'number'|'boolean', value }]，null 表示尚未初始化。
    let configLoaded = false; // 是否已从游戏代码读取过初始配置。

    // 把 game_config 对象拆成可视化行模型。
    function objToConfigRows(obj) {
        const rows = [];
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            for (const key of Object.keys(obj)) {
                const v = obj[key];
                let type = 'string';
                if (typeof v === 'number') type = 'number';
                else if (typeof v === 'boolean') type = 'boolean';
                else if (v != null && typeof v === 'object') type = 'string'; // 复杂值降级为文本（JSON）。
                const value = (type === 'string' && v != null && typeof v === 'object') ? stringifyValue(v) : v;
                rows.push({ key, type, value });
            }
        }
        return rows;
    }

    // 把可视化行模型组装回对象（校验字段名非空、不重复）。返回 { obj } 或 { error }。
    function configRowsToObj(rows) {
        const obj = {};
        const seen = new Set();
        for (const row of rows) {
            const key = String(row.key || '').trim();
            if (!key) return { error: t('mgGameSettingsConfigEmptyKey') };
            if (seen.has(key)) return { error: t('mgGameSettingsConfigDupKey') };
            seen.add(key);
            let value = row.value;
            if (row.type === 'number') {
                const n = Number(value);
                value = Number.isFinite(n) ? n : 0;
            } else if (row.type === 'boolean') {
                value = !!value;
            } else {
                // 文本：若内容本身是合法的 JSON 对象/数组字面量，则保留为结构化值。
                const raw = String(value == null ? '' : value);
                const trimmed = raw.trim();
                if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
                    const parsed = evalLiteral(trimmed);
                    value = parsed != null ? parsed : raw;
                } else {
                    value = raw;
                }
            }
            obj[key] = value;
        }
        return { obj };
    }

    function renderConfig() {
        const html = ctx.getHtml ? (ctx.getHtml() || '') : '';
        const cfg = readGameConfig(html);
        const hasCfg = cfg != null;
        // 首次进入：以游戏代码里的配置初始化行模型（没有则给个示例）。
        if (!configLoaded) {
            configRows = objToConfigRows(hasCfg ? cfg : { difficulty: 'normal' });
            configLoaded = true;
        }

        const codeValue = (() => {
            const built = configRowsToObj(configRows || []);
            return built.error ? stringifyValue(cfgFromRowsBestEffort(configRows)) : stringifyValue(built.obj);
        })();

        const rowsHtml = (configRows && configRows.length)
            ? `<div class="mh-gms-kv-list">${configRows.map((row, i) => renderConfigRow(row, i)).join('')}</div>`
            : `<div class="mh-gms-empty">${escapeHtml(t('mgGameSettingsConfigEmpty'))}</div>`;

        paneConfig.innerHTML = `
            <div class="mh-gms-art-toolbar">
                <span class="mh-gms-label" style="flex:1">${escapeHtml(t('mgGameSettingsConfigLabel'))}</span>
                <button type="button" class="mh-gms-btn mh-gms-btn-primary" data-mh-gms-config-save>${escapeHtml(t('save'))}</button>
            </div>
            <div class="mh-gms-src-tabs">
                <button type="button" class="mh-gms-src-tab${configView === 'gui' ? ' active' : ''}" data-mh-gms-config-view="gui">${escapeHtml(t('mgGameSettingsConfigViewGui'))}</button>
                <button type="button" class="mh-gms-src-tab${configView === 'code' ? ' active' : ''}" data-mh-gms-config-view="code">${escapeHtml(t('mgGameSettingsConfigViewCode'))}</button>
            </div>
            <div class="mh-gms-art-views${configView === 'gui' ? ' active' : ''}" data-mh-gms-config-pane="gui">
                <span class="mh-gms-hint">${escapeHtml(hasCfg ? t('mgGameSettingsConfigGuiHint') : t('mgGameSettingsConfigMissing'))}</span>
                ${rowsHtml}
                <div class="mh-gms-actions">
                    <button type="button" class="mh-gms-btn mh-gms-btn-secondary" data-mh-gms-config-add>${escapeHtml(t('mgGameSettingsConfigAddField'))}</button>
                </div>
            </div>
            <div class="mh-gms-art-views mh-gms-code-pane${configView === 'code' ? ' active' : ''}" data-mh-gms-config-pane="code">
                <div class="mh-gms-field">
                    <span class="mh-gms-hint">${escapeHtml(hasCfg ? t('mgGameSettingsConfigFound') : t('mgGameSettingsConfigMissing'))}</span>
                    <textarea class="mh-gms-code" data-mh-gms-config spellcheck="false">${escapeHtml(codeValue)}</textarea>
                </div>
            </div>`;

        wireConfigEvents();
    }

    // 尽力把行模型转成对象用于代码视图展示（忽略校验错误，跳过空字段名）。
    function cfgFromRowsBestEffort(rows) {
        const obj = {};
        for (const row of (rows || [])) {
            const key = String(row.key || '').trim();
            if (!key) continue;
            let value = row.value;
            if (row.type === 'number') { const n = Number(value); value = Number.isFinite(n) ? n : 0; }
            else if (row.type === 'boolean') value = !!value;
            else value = String(value == null ? '' : value);
            obj[key] = value;
        }
        return obj;
    }

    // 渲染单个键值行。
    function renderConfigRow(row, i) {
        const key = escapeHtml(row.key || '');
        let valueControl;
        if (row.type === 'boolean') {
            valueControl = `<label class="mh-gms-kv-bool"><input type="checkbox" data-mh-gms-config-val="${i}"${row.value ? ' checked' : ''}> ${row.value ? 'true' : 'false'}</label>`;
        } else {
            const inputType = row.type === 'number' ? 'number' : 'text';
            const v = escapeHtml(row.value == null ? '' : String(row.value));
            valueControl = `<span class="mh-gms-kv-val-wrap"><input type="${inputType}" class="mh-gms-input" data-mh-gms-config-val="${i}" placeholder="${escapeHtml(t('mgGameSettingsConfigValPh'))}" value="${v}"></span>`;
        }
        return `<div class="mh-gms-kv-row">
            <input type="text" class="mh-gms-input mh-gms-kv-key" data-mh-gms-config-key="${i}" placeholder="${escapeHtml(t('mgGameSettingsConfigKeyPh'))}" value="${key}">
            <select class="mh-gms-select mh-gms-kv-type" data-mh-gms-config-type="${i}">
                <option value="string"${row.type === 'string' ? ' selected' : ''}>${escapeHtml(t('mgGameSettingsConfigTypeString'))}</option>
                <option value="number"${row.type === 'number' ? ' selected' : ''}>${escapeHtml(t('mgGameSettingsConfigTypeNumber'))}</option>
                <option value="boolean"${row.type === 'boolean' ? ' selected' : ''}>${escapeHtml(t('mgGameSettingsConfigTypeBoolean'))}</option>
            </select>
            ${valueControl}
            <button type="button" class="mh-gms-kv-del" data-mh-gms-config-del="${i}" aria-label="${escapeHtml(t('delete'))}" title="${escapeHtml(t('delete'))}">🗑️</button>
        </div>`;
    }

    // 绑定配置标签页的所有事件。
    function wireConfigEvents() {
        // 视图切换（切换前把当前视图的编辑同步进 configRows，避免丢失）。
        paneConfig.querySelectorAll('[data-mh-gms-config-view]').forEach(btn => btn.addEventListener('click', () => {
            const next = btn.dataset.mhGmsConfigView;
            if (next === configView) return;
            if (configView === 'code') {
                // 离开代码视图：尝试把 JSON 解析进行模型（解析失败则保留原行模型）。
                const ta = paneConfig.querySelector('[data-mh-gms-config]');
                const parsed = evalLiteral(ta ? ta.value : '');
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    configRows = objToConfigRows(parsed);
                }
            }
            // 离开可视化视图无需特殊处理：configRows 已随输入实时更新。
            configView = next;
            renderConfig();
        }));

        // 可视化：字段名输入（保持焦点）。
        paneConfig.querySelectorAll('[data-mh-gms-config-key]').forEach(inp => inp.addEventListener('input', (e) => {
            const i = parseInt(e.target.dataset.mhGmsConfigKey, 10);
            if (configRows[i]) configRows[i].key = e.target.value;
        }));
        // 可视化：值输入（文本 / 数字）。
        paneConfig.querySelectorAll('input[data-mh-gms-config-val]').forEach(inp => inp.addEventListener('input', (e) => {
            const i = parseInt(e.target.dataset.mhGmsConfigVal, 10);
            if (!configRows[i]) return;
            if (configRows[i].type === 'boolean') {
                configRows[i].value = e.target.checked;
                renderConfig(); // 刷新 true/false 文案。
            } else {
                configRows[i].value = e.target.value;
            }
        }));
        // 可视化：类型切换（重渲染以切换控件）。
        paneConfig.querySelectorAll('[data-mh-gms-config-type]').forEach(sel => sel.addEventListener('change', (e) => {
            const i = parseInt(e.target.dataset.mhGmsConfigType, 10);
            if (!configRows[i]) return;
            const prev = configRows[i].type;
            const nextType = e.target.value;
            configRows[i].type = nextType;
            // 类型转换时尽量保留值。
            if (nextType === 'boolean') configRows[i].value = (configRows[i].value === true || configRows[i].value === 'true');
            else if (nextType === 'number') { const n = Number(configRows[i].value); configRows[i].value = Number.isFinite(n) ? n : 0; }
            else if (prev === 'boolean') configRows[i].value = configRows[i].value ? 'true' : 'false';
            renderConfig();
        }));
        // 可视化：删除行。
        paneConfig.querySelectorAll('[data-mh-gms-config-del]').forEach(btn => btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.mhGmsConfigDel, 10);
            if (Number.isNaN(i) || !configRows || i < 0 || i >= configRows.length) return;
            configRows.splice(i, 1);
            renderConfig();
        }));
        // 可视化：添加字段。
        paneConfig.querySelector('[data-mh-gms-config-add]')?.addEventListener('click', () => {
            (configRows = configRows || []).push({ key: '', type: 'string', value: '' });
            renderConfig();
        });

        // 保存：按当前视图取数据 → 校验 → 写回 game_config。
        paneConfig.querySelector('[data-mh-gms-config-save]')?.addEventListener('click', async () => {
            let parsed;
            if (configView === 'code') {
                const ta = paneConfig.querySelector('[data-mh-gms-config]');
                parsed = evalLiteral(ta ? ta.value : '');
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    showToast(t('mgGameSettingsConfigInvalid'), 'error', 2000);
                    return;
                }
                configRows = objToConfigRows(parsed); // 同步回行模型。
            } else {
                const built = configRowsToObj(configRows || []);
                if (built.error) { showToast(built.error, 'error', 2000); return; }
                parsed = built.obj;
            }
            const nextHtml = writeAssignment(ctx.getHtml ? ctx.getHtml() : '', 'game_config', stringifyValue(parsed));
            await applyHtml(nextHtml);
            showToast(t('mgGameSettingsSaved'), 'success', 1400);
            renderConfig();
        });
    }

    // ---------- 美术资源标签页 ----------
    let artSource = 'scene'; // 'scene' | 'pet' | 'item'
    const artSelection = new Set(); // 选中要追加的资源（来自资源库的 id）。

    function currentArtAssets() {
        const html = ctx.getHtml ? (ctx.getHtml() || '') : '';
        return readArtAssets(html) || [];
    }

    let artSearch = ''; // 列表搜索关键词。
    let artView = 'list'; // 美术资源视图：'list'（卡片网格） | 'code'（JSON 代码编辑器）。

    // 棋盘格图层（4 段渐变）。作为内联 background 的底层，让透明 PNG 的边界可见。
    const CHECKER_IMG = 'linear-gradient(45deg,#1b2a4a 25%,transparent 25%),linear-gradient(-45deg,#1b2a4a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1b2a4a 75%),linear-gradient(-45deg,transparent 75%,#1b2a4a 75%)';
    const CHECKER_SIZE = '16px 16px,16px 16px,16px 16px,16px 16px';
    const CHECKER_POS = '0 0,0 8px,8px -8px,-8px 0';

    // 把单个 art_asset 渲染成缩略图内联样式。
    // 图片作为顶层、棋盘格作为底层一起写进 background-image（逗号分层，第一层在最上）：
    //   单图用 contain 保留原始宽高比；精灵图按 行/列 缩放并定位到左上首格。
    function artThumbStyle(a) {
        const url = a && a.imageUrl ? escapeHtml(a.imageUrl) : '';
        if (!url) return ''; // 无图：沿用 CSS 类里的棋盘格底。
        const sheet = (a && ((a.rows || 1) > 1 || (a.columns || 1) > 1));
        const imgLayer = `url(&quot;${url}&quot;)`;
        const imgSize = sheet ? `${(a.columns || 1) * 100}% ${(a.rows || 1) * 100}%` : 'contain';
        const imgPos = sheet ? '0 0' : 'center';
        return `background-image:${imgLayer},${CHECKER_IMG};`
            + `background-repeat:no-repeat,repeat,repeat,repeat,repeat;`
            + `background-size:${imgSize},${CHECKER_SIZE};`
            + `background-position:${imgPos},${CHECKER_POS};`;
    }

    // 选择器卡片缩略图：与 artThumbStyle 同样的分层逻辑（图 + 棋盘格）。
    function thumbStyleFor(asset) {
        return artThumbStyle(asset);
    }

    // 美术资源标签页：顶部「搜索 + 新建」，下方资源卡片网格（每卡片带 ⋮ 菜单：重命名 / 删除）。
    function renderArt() {
        const existing = currentArtAssets();
        const kw = artSearch.trim().toLowerCase();
        const filtered = existing
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => {
                if (!kw) return true;
                const hay = `${(a && a.id) || ''} ${(a && a.description) || ''}`.toLowerCase();
                return hay.includes(kw);
            });

        let listHtml;
        if (!existing.length) {
            listHtml = `<div class="mh-gms-empty">${escapeHtml(t('mgGameSettingsArtListEmpty'))}</div>`;
        } else if (!filtered.length) {
            listHtml = `<div class="mh-gms-empty">${escapeHtml(t('mgGameSettingsArtSearchEmpty'))}</div>`;
        } else {
            listHtml = `<div class="mh-gms-art-list">${filtered.map(({ a, i }) => `
                <div class="mh-gms-art-card" data-mh-gms-art-index="${i}">
                    <span class="mh-gms-art-card-thumb" style="${artThumbStyle(a)}"></span>
                    <button type="button" class="mh-gms-art-card-menu" data-mh-gms-art-menu="${i}" aria-label="${escapeHtml(t('mgGameSettingsArtRename'))}">⋮</button>
                    <span class="mh-gms-art-card-name" title="${escapeHtml((a && a.id) || '')}">${escapeHtml((a && a.id) || '(no id)')}</span>
                </div>`).join('')}</div>`;
        }

        const codeValue = stringifyValue(existing);
        paneArt.innerHTML = `
            <div class="mh-gms-art-toolbar">
                <span class="mh-gms-search">
                    <input type="text" data-mh-gms-art-search placeholder="${escapeHtml(t('mgGameSettingsArtSearchPlaceholder'))}" value="${escapeHtml(artSearch)}">
                </span>
                <button type="button" class="mh-gms-new-btn" data-mh-gms-art-new>${escapeHtml(t('mgGameSettingsArtNew'))}</button>
                <button type="button" class="mh-gms-btn mh-gms-btn-primary" data-mh-gms-art-save>${escapeHtml(t('save'))}</button>
            </div>
            <div class="mh-gms-src-tabs">
                <button type="button" class="mh-gms-src-tab${artView === 'list' ? ' active' : ''}" data-mh-gms-art-view="list">${escapeHtml(t('mgGameSettingsArtViewList'))}</button>
                <button type="button" class="mh-gms-src-tab${artView === 'code' ? ' active' : ''}" data-mh-gms-art-view="code">${escapeHtml(t('mgGameSettingsArtViewCode'))}</button>
            </div>
            <div class="mh-gms-art-views${artView === 'list' ? ' active' : ''}" data-mh-gms-art-pane="list">
                <span class="mh-gms-hint">${escapeHtml(t('mgGameSettingsArtCount', { n: existing.length }))}</span>
                ${listHtml}
            </div>
            <div class="mh-gms-art-views mh-gms-code-pane${artView === 'code' ? ' active' : ''}" data-mh-gms-art-pane="code">
                <div class="mh-gms-field">
                    <span class="mh-gms-label">${escapeHtml(t('mgGameSettingsArtCodeLabel'))}</span>
                    <span class="mh-gms-hint">${escapeHtml(t('mgGameSettingsArtCodeHint'))}</span>
                    <textarea class="mh-gms-code" data-mh-gms-art-code spellcheck="false">${escapeHtml(codeValue)}</textarea>
                </div>
            </div>`;

        // 搜索框：实时过滤（保持焦点与光标位置）。
        const searchEl = paneArt.querySelector('[data-mh-gms-art-search]');
        searchEl?.addEventListener('input', (e) => {
            artSearch = e.target.value;
            const pos = e.target.selectionStart;
            renderArt();
            const next = paneArt.querySelector('[data-mh-gms-art-search]');
            if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (_) {} }
        });
        // 列表 / 代码 视图切换。
        paneArt.querySelectorAll('[data-mh-gms-art-view]').forEach(btn => btn.addEventListener('click', () => {
            artView = btn.dataset.mhGmsArtView;
            renderArt();
        }));
        // 新建：打开资源选择子弹窗。
        paneArt.querySelector('[data-mh-gms-art-new]')?.addEventListener('click', () => openArtPicker());
        // 每张卡片的 ⋮ 菜单：重命名 / 删除。
        paneArt.querySelectorAll('[data-mh-gms-art-menu]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.mhGmsArtMenu, 10);
            openArtCardMenu(btn, idx);
        }));
        // 保存：把代码编辑器里的 JSON 数组写回 art_assets（与 game_config 的保存一致）。
        paneArt.querySelector('[data-mh-gms-art-save]')?.addEventListener('click', async () => {
            const ta = paneArt.querySelector('[data-mh-gms-art-code]');
            const text = ta ? ta.value : '';
            const parsed = evalLiteral(text);
            if (!Array.isArray(parsed)) {
                showToast(t('mgGameSettingsArtCodeInvalid'), 'error', 2000);
                return;
            }
            const nextHtml = writeAssignment(ctx.getHtml ? ctx.getHtml() : '', 'art_assets', stringifyValue(parsed));
            await applyHtml(nextHtml);
            showToast(t('mgGameSettingsSaved'), 'success', 1400);
            renderArt();
        });
    }

    // 卡片右上角 ⋮ 菜单：重命名 / 删除。
    function openArtCardMenu(anchorBtn, idx) {
        // 先移除可能已存在的旧菜单。
        paneArt.querySelectorAll('.mh-gms-menu-pop').forEach(el => el.remove());
        const card = anchorBtn.closest('.mh-gms-art-card');
        if (!card) return;
        const pop = document.createElement('div');
        pop.className = 'mh-gms-menu-pop';
        pop.style.top = '34px';
        pop.style.right = '6px';
        pop.innerHTML = `
            <button type="button" data-mh-gms-menu-rename>✏️ ${escapeHtml(t('mgGameSettingsArtRename'))}</button>
            <button type="button" class="danger" data-mh-gms-menu-delete>🗑️ ${escapeHtml(t('delete'))}</button>`;
        card.appendChild(pop);

        const closeMenu = () => { pop.remove(); document.removeEventListener('click', onDocClick, true); };
        const onDocClick = (e) => { if (!pop.contains(e.target)) closeMenu(); };
        // 延迟挂载，避免立即被本次点击关闭。
        setTimeout(() => document.addEventListener('click', onDocClick, true), 0);

        pop.querySelector('[data-mh-gms-menu-rename]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeMenu();
            await renameArtAsset(idx);
        });
        pop.querySelector('[data-mh-gms-menu-delete]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeMenu();
            await removeArtAsset(idx);
        });
    }

    // 重命名某个 art_asset 的 id。
    async function renameArtAsset(idx) {
        const existing = currentArtAssets();
        if (idx < 0 || idx >= existing.length) return;
        const asset = existing[idx];
        const current = (asset && asset.id) || '';
        // eslint-disable-next-line no-alert
        const input = window.prompt(t('mgGameSettingsArtRenamePrompt'), current);
        if (input == null) return; // 取消。
        const nextId = String(input).trim();
        if (!nextId) { showToast(t('mgGameSettingsArtRenameInvalid'), 'error', 1800); return; }
        if (nextId === current) return;
        if (existing.some((a, i) => i !== idx && a && a.id === nextId)) {
            showToast(t('mgGameSettingsArtRenameDup'), 'error', 1800);
            return;
        }
        existing[idx] = { ...asset, id: nextId };
        const nextHtml = writeAssignment(ctx.getHtml ? ctx.getHtml() : '', 'art_assets', stringifyValue(existing));
        await applyHtml(nextHtml);
        showToast(t('mgGameSettingsArtRenamed'), 'success', 1400);
        renderArt();
    }

    // 删除某个 art_asset。
    async function removeArtAsset(idx) {
        const existing = currentArtAssets();
        if (Number.isNaN(idx) || idx < 0 || idx >= existing.length) return;
        existing.splice(idx, 1);
        const nextHtml = writeAssignment(ctx.getHtml ? ctx.getHtml() : '', 'art_assets', stringifyValue(existing));
        await applyHtml(nextHtml);
        showToast(t('mgGameSettingsArtRemoved'), 'success', 1200);
        renderArt();
    }

    // ---------- 新建资源选择子弹窗 ----------
    // 从蛋蛋星球的场景 / 宠物 / 道具中多选追加；亦可打开外部美术资源生成器。
    function openArtPicker() {
        artSource = 'scene';
        artSelection.clear();

        const picker = document.createElement('div');
        picker.className = 'mh-gms-picker';
        picker.innerHTML = `
            <div class="mh-gms-picker-win" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('mgGameSettingsArtPickerTitle'))}">
                <div class="mh-gms-picker-head">
                    <span class="mh-gms-picker-title">${escapeHtml(t('mgGameSettingsArtPickerTitle'))}</span>
                    <button type="button" class="mh-gms-close" data-mh-gms-picker-close aria-label="${escapeHtml(t('close'))}">×</button>
                </div>
                <div class="mh-gms-picker-body">
                    <div class="mh-gms-src-tabs" data-mh-gms-picker-tabs></div>
                    <div data-mh-gms-picker-grid></div>
                </div>
                <div class="mh-gms-picker-foot">
                    <button type="button" class="mh-gms-btn mh-gms-btn-primary" data-mh-gms-picker-add style="flex:1">${escapeHtml(t('mgGameSettingsArtAdd', { n: 0 }))}</button>
                    <button type="button" class="mh-gms-btn mh-gms-btn-secondary" data-mh-gms-picker-gen>${escapeHtml(t('mgGameSettingsArtGenerator'))}</button>
                </div>
            </div>`;
        win.appendChild(picker);

        const tabsEl = picker.querySelector('[data-mh-gms-picker-tabs]');
        const gridEl = picker.querySelector('[data-mh-gms-picker-grid]');
        const addBtn = picker.querySelector('[data-mh-gms-picker-add]');

        function renderPickerTabs() {
            tabsEl.innerHTML = `
                <button type="button" class="mh-gms-src-tab${artSource === 'scene' ? ' active' : ''}" data-mh-gms-src="scene">${escapeHtml(t('mgGameSettingsArtScenes'))}</button>
                <button type="button" class="mh-gms-src-tab${artSource === 'pet' ? ' active' : ''}" data-mh-gms-src="pet">${escapeHtml(t('mgGameSettingsArtPets'))}</button>
                <button type="button" class="mh-gms-src-tab${artSource === 'item' ? ' active' : ''}" data-mh-gms-src="item">${escapeHtml(t('mgGameSettingsArtItems'))}</button>`;
            tabsEl.querySelectorAll('[data-mh-gms-src]').forEach(btn => btn.addEventListener('click', () => {
                artSource = btn.dataset.mhGmsSrc;
                artSelection.clear();
                renderPickerTabs();
                renderPickerGrid();
            }));
        }

        function renderPickerGrid() {
            const sourceList = (ART_SOURCE_LOADERS[artSource] || (() => []))();
            const existingIds = new Set(currentArtAssets().map(a => a && a.id).filter(Boolean));
            gridEl.innerHTML = sourceList.length
                ? `<div class="mh-gms-grid">${sourceList.map(asset => {
                    const already = existingIds.has(asset.id);
                    const sel = artSelection.has(asset.id);
                    const sheetClass = (asset.rows > 1 || asset.columns > 1) ? ' mh-gms-card-sheet' : '';
                    return `<button type="button" class="mh-gms-card${sel ? ' selected' : ''}" data-mh-gms-pick="${escapeHtml(asset.id)}"${already ? ' data-mh-gms-already="1"' : ''} title="${escapeHtml(asset.name)}${already ? ' · ' + t('mgGameSettingsArtAlready') : ''}">
                        <span class="mh-gms-card-thumb${sheetClass}" style="${thumbStyleFor(asset)}"></span>
                        <span class="mh-gms-card-name">${already ? '✓ ' : ''}${escapeHtml(asset.name)}</span>
                        <span class="mh-gms-card-check">✓</span>
                    </button>`;
                }).join('')}</div>`
                : `<div class="mh-gms-empty">${escapeHtml(t('mgGameSettingsArtSourceEmpty'))}</div>`;
            gridEl.querySelectorAll('[data-mh-gms-pick]').forEach(btn => btn.addEventListener('click', () => {
                const id = btn.dataset.mhGmsPick;
                if (artSelection.has(id)) artSelection.delete(id);
                else artSelection.add(id);
                renderPickerGrid();
                updateAddBtn();
            }));
            updateAddBtn();
        }

        function updateAddBtn() {
            if (!addBtn) return;
            addBtn.textContent = t('mgGameSettingsArtAdd', { n: artSelection.size });
            const off = !artSelection.size;
            addBtn.disabled = off;
            addBtn.style.opacity = off ? '.5' : '';
            addBtn.style.cursor = off ? 'not-allowed' : '';
        }

        const closePicker = () => picker.remove();
        picker.querySelector('[data-mh-gms-picker-close]')?.addEventListener('click', closePicker);
        picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });

        // 追加选中的资源到 art_assets。
        addBtn?.addEventListener('click', async () => {
            if (!artSelection.size) return;
            const sourceList = (ART_SOURCE_LOADERS[artSource] || (() => []))();
            const byId = new Map(sourceList.map(a => [a.id, a]));
            const existing = currentArtAssets();
            const existingIds = new Set(existing.map(a => a && a.id).filter(Boolean));
            const additions = [];
            for (const id of artSelection) {
                const asset = byId.get(id);
                if (!asset || existingIds.has(asset.id)) continue;
                additions.push(normalizeArtAsset(asset));
                existingIds.add(asset.id);
            }
            if (!additions.length) {
                showToast(t('mgGameSettingsArtNothingNew'), 'info', 1600);
                return;
            }
            const next = [...existing, ...additions];
            const nextHtml = writeAssignment(ctx.getHtml ? ctx.getHtml() : '', 'art_assets', stringifyValue(next));
            await applyHtml(nextHtml);
            artSelection.clear();
            showToast(t('mgGameSettingsArtAdded', { n: additions.length }), 'success', 1600);
            closePicker();
            renderArt();
        });

        // 打开外部生成器。
        picker.querySelector('[data-mh-gms-picker-gen]')?.addEventListener('click', () => {
            const url = getDevToolUrl(ART_GENERATOR_FILE);
            const opened = url ? window.open(url, '_blank') : null;
            if (opened) {
                try { opened.opener = null; } catch (_) {}
                showToast(t('mgGameSettingsArtGenOpened'), 'success', 1400);
            } else {
                showToast(t('mgGameSettingsArtGenBlocked'), 'error', 2200);
            }
        });

        renderPickerTabs();
        renderPickerGrid();
    }

    // 把资源库条目规整成 AGENTS.md 规定的 art_assets 字段形状。
    function normalizeArtAsset(asset) {
        return {
            id: asset.id,
            imageUrl: asset.imageUrl,
            rows: Number(asset.rows) || 1,
            columns: Number(asset.columns) || 1,
            isTransparent: !!asset.isTransparent,
            description: asset.description || '',
            imageWidth: Number(asset.imageWidth) || 1024,
            imageHeight: Number(asset.imageHeight) || 1024,
        };
    }

    // 写回 HTML（更新工坊状态 + 预览 + 持久化）。
    async function applyHtml(nextHtml) {
        if (ctx.setHtml) ctx.setHtml(nextHtml);
        if (ctx.persistHtml) await ctx.persistHtml(nextHtml);
    }

    // ---------- 标签切换 ----------
    function switchTab(tab) {
        activeTab = tab;
        overlay.querySelectorAll('[data-mh-gms-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.mhGmsTab === tab));
        overlay.querySelectorAll('[data-mh-gms-pane]').forEach(p => p.classList.toggle('active', p.dataset.mhGmsPane === tab));
        if (tab === 'global') renderGlobal();
        else if (tab === 'config') renderConfig();
        else if (tab === 'art') renderArt();
    }

    overlay.querySelectorAll('[data-mh-gms-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.mhGmsTab)));
    overlay.querySelector('[data-mh-gms-close]')?.addEventListener('click', () => closeGameMakerSettings(host));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGameMakerSettings(host); });
    win?.addEventListener('click', (e) => e.stopPropagation());

    // 初始渲染默认标签页（全局）。
    renderGlobal();
}

export function closeGameMakerSettings(host) {
    (host || document).querySelector?.('#mhGmSettings')?.remove();
}
