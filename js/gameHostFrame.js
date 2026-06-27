// gameHostFrame.js — 把自创 / 分享小游戏的 HTML 正文注入 iframe 的统一入口。
//
// 现代内核：直接用 iframe.srcdoc（同源、零额外往返）。
// 微信各端（iOS / PC 内置浏览器、小程序 web-view）对 iframe srcdoc 支持不一致，常渲染为空白，
// 且父页面跨帧 document.write 子文档同样不可靠；唯一在所有内核都可用的方式是：把 iframe.src
// 指向一个真实 URL 的通用宿主页（minigames/_game_host.html，官方游戏走 src 已验证可用），
// 再 postMessage 把游戏 HTML 发给它，由宿主自我重写（同源自身 document.write）。
//
// 握手协议（与 minigames/_game_host.html 对应）：
//   宿主就绪  → 父：{ type:'mhGameHostReady' }
//   父发游戏  → 宿主：{ type:'mhRenderGame', html }
//   宿主渲完  → 父：{ type:'mhGameRendered' }   // 父据此推送宠物配置
//
// 调用方（view_minigames / view_game_maker）：
//   1) 注入：loadGameHtmlIntoFrame(frame, html, { onRendered })
//   2) 在自己的 window 'message' 监听里转交：handleGameHostMessage(frame, e.data)
import { isAnyWechat } from './wxShare.js';

// `import.meta.url + ''` 阻止 Vite 静态分析把父目录树打包进 assets/（同 config.js / view_minigames.js）。
const GAME_HOST_URL = new URL('minigames/_game_host.html', new URL('..', import.meta.url + '')).href;

let _srcdocSupport = null;
function srcdocSupported() {
    if (_srcdocSupport == null) {
        try { _srcdocSupport = 'srcdoc' in document.createElement('iframe'); }
        catch (_) { _srcdocSupport = false; }
    }
    return _srcdocSupport;
}

// 调试开关：在 Chrome 等现代内核上「强制」走宿主页（_game_host.html）真实 URL 路径，
// 而非默认的 srcdoc，便于发布前在桌面浏览器里验证宿主页握手。仅当显式带上
// `?mhForceGameHost=1`（或 localStorage 同名键）时生效，对普通用户零影响；URL 参数命中后
// 也写入 localStorage，保证 SPA 清理 query 后该开关仍然有效。
function isForceGameHost() {
    try {
        const v = new URL(window.location.href).searchParams.get('mhForceGameHost');
        if (v != null && v !== '' && v !== '0' && v !== 'false') {
            try { localStorage.setItem('mhForceGameHost', '1'); } catch (_) {}
            return true;
        }
        if (v === '0' || v === 'false') { try { localStorage.removeItem('mhForceGameHost'); } catch (_) {} return false; }
    } catch (_) {}
    try { return localStorage.getItem('mhForceGameHost') === '1'; } catch (_) { return false; }
}

// 是否可直接用 srcdoc：需内核支持，且不在微信环境（微信各端 srcdoc 表现不可靠，统一走宿主页兜底）。
// 调试强制开关打开时一律返回 false，走宿主页路径。
export function canUseSrcdocForGame() {
    if (isForceGameHost()) return false;
    try { return srcdocSupported() && !isAnyWechat(); }
    catch (_) { return srcdocSupported(); }
}

const pendingHtml = new WeakMap();   // frame -> 等宿主就绪后下发的 HTML
const renderedCbs = new WeakMap();   // frame -> 宿主渲染完成回调

export function loadGameHtmlIntoFrame(frame, html, { onRendered } = {}) {
    if (!frame) return;
    const content = String(html);
    frame.removeAttribute('src');
    if (canUseSrcdocForGame()) {
        pendingHtml.delete(frame);
        renderedCbs.delete(frame);
        frame.srcdoc = content;
        return;
    }
    // 宿主页兜底：配置推送由 mhGameRendered 握手驱动（iframe 的 load 只代表宿主壳就绪，游戏尚未写入）。
    frame.removeAttribute('srcdoc');
    pendingHtml.set(frame, content);
    if (onRendered) renderedCbs.set(frame, onRendered); else renderedCbs.delete(frame);
    // 重新赋值同一 URL 也会触发 iframe 重新加载 → 宿主重新握手，天然支持"强制刷新预览"。
    frame.src = GAME_HOST_URL;
}

// 在调用方的 window 'message' 监听器里转交。返回 true 表示已被宿主握手消费，调用方无需再处理。
export function handleGameHostMessage(frame, msg) {
    if (!frame || !msg) return false;
    if (msg.type === 'mhGameHostReady') {
        const html = pendingHtml.get(frame);
        if (html != null) {
            try { frame.contentWindow?.postMessage({ type: 'mhRenderGame', html }, '*'); } catch (_) {}
            pendingHtml.delete(frame);
        }
        return true;
    }
    if (msg.type === 'mhGameRendered') {
        const cb = renderedCbs.get(frame);
        try { cb?.(); } catch (_) {}
        return true;
    }
    if (msg.type === 'mhGameRenderFailed') return true;
    return false;
}
