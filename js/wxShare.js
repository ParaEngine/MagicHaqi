/**
 * wxShare.js — 微信环境分享工具
 *
 * - 微信内置浏览器（H5）：加载 JS-SDK，配置 wx.config + wx.updateAppMessageShareData
 * - 微信小程序 web-view：通过 wx.miniProgram.postMessage 向宿主小程序传递分享数据
 * - 非微信环境：不执行任何操作（由调用方自行处理 navigator.share / 剪贴板）
 */

// Keep this module self-contained. The app runs as plain browser ESM, while the
// sibling KeepworkSDK source is TypeScript-only in local development.

function extractMainDomain(hostname) {
    if (
        hostname === 'localhost' ||
        hostname.startsWith('127.') ||
        hostname.startsWith('192.168.') ||
        hostname.trim() === ''
    ) {
        return 'keepwork.com';
    }
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
}

function getApiBaseURL() {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'keepwork.com';
    const domain = extractMainDomain(hostname);
    return `https://api.${domain}/core/v0`;
}

function detectWxEnvironment() {
    if (typeof navigator === 'undefined') {
        return {
            isWeChat: false,
            isMiniProgram: false,
            isWorkWeChat: false,
            isDevTools: false,
            isAnyWeChat: false,
        };
    }

    const userAgent = navigator.userAgent.toLowerCase();
    const isWeChat = /micromessenger/i.test(userAgent);
    const isMiniProgram = /miniprogram/i.test(userAgent);
    const isWorkWeChat = /wxwork/i.test(userAgent);
    const isDevTools = /wechatdevtools/i.test(userAgent);

    return {
        isWeChat,
        isMiniProgram,
        isWorkWeChat,
        isDevTools,
        isAnyWeChat: isWeChat || isMiniProgram || isWorkWeChat,
    };
}

let _wxSdkLoaded = false;
let _wxSdkLoading = null;

async function loadWxSDK() {
    if (_wxSdkLoaded && typeof wx !== 'undefined') return wx;
    if (_wxSdkLoading) return _wxSdkLoading;

    _wxSdkLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
        script.onload = () => {
            if (typeof wx !== 'undefined') {
                _wxSdkLoaded = true;
                resolve(wx);
            } else {
                reject(new Error('wx object not available'));
            }
        };
        script.onerror = () => {
            _wxSdkLoading = null;
            reject(new Error('Failed to load WeChat SDK'));
        };
        document.head.appendChild(script);
    });

    return _wxSdkLoading;
}

async function getSignature(url, options = {}) {
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const nonceStr = options.nonceStr ?? Math.random().toString(36).substring(2);
    const currentUrl = url ?? (typeof window !== 'undefined' ? window.location.href.split('#')[0] : '');
    const platform = options.platform ?? 7;

    const response = await fetch(`${getApiBaseURL()}/wxpublic/signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp, url: currentUrl, noncestr: nonceStr, platform }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get signature: ${response.statusText}`);
    }

    const res = await response.json();
    return { signature: res.signature, timestamp, nonceStr };
}

// ──────────── 环境检测 ────────────

/** 缓存环境检测结果 */
let _envCache = null;

function getEnv() {
    if (!_envCache) _envCache = detectWxEnvironment();
    return _envCache;
}

/** 是否在微信内置浏览器中（非小程序 web-view） */
export function isWechatBrowser() {
    const env = getEnv();
    return env.isWeChat && !env.isMiniProgram;
}

/** 是否在微信小程序的 web-view 中 */
export function isMiniProgramWebView() {
    return getEnv().isMiniProgram;
}

/** 是否在任意微信环境中 */
export function isAnyWechat() {
    return getEnv().isAnyWeChat;
}

// ──────────── H5 微信 JS-SDK 分享 ────────────

let _wxConfigured = false;
let _wxConfiguring = null;

/**
 * 初始化微信 JS-SDK 配置（wx.config）。
 * 只执行一次，后续调用直接返回。
 */
async function ensureWxConfig() {
    if (_wxConfigured) return true;
    if (_wxConfiguring) return _wxConfiguring;

    _wxConfiguring = (async () => {
        try {
            const wxSdk = await loadWxSDK();
            const { signature, timestamp, nonceStr } = await getSignature();

            return new Promise((resolve) => {
                wxSdk.config({
                    debug: false,
                    appId: 'wx7935c49369d421c1',
                    timestamp,
                    nonceStr,
                    signature,
                    jsApiList: [
                        'updateAppMessageShareData',
                        'updateTimelineShareData',
                        'onMenuShareAppMessage',
                        'onMenuShareTimeline',
                    ],
                });
                wxSdk.ready(() => {
                    _wxConfigured = true;
                    resolve(true);
                });
                wxSdk.error(() => {
                    resolve(false);
                });
            });
        } catch (err) {
            console.warn('[wxShare] wx.config 初始化失败:', err);
            return false;
        }
    })();

    const result = await _wxConfiguring;
    _wxConfiguring = null;
    return result;
}

/**
 * 设置微信 JS-SDK 分享数据。
 * 在微信内置浏览器中调用 wx.updateAppMessageShareData + wx.updateTimelineShareData。
 *
 * @param {object} opts
 * @param {string} opts.title  - 分享标题
 * @param {string} opts.desc   - 分享描述
 * @param {string} opts.url    - 分享链接
 * @param {string} [opts.imgUrl] - 分享图标 URL
 */
export async function setWxShareData({ title, desc, url, imgUrl }) {
    if (!isWechatBrowser()) return false;

    const ok = await ensureWxConfig();
    if (!ok) return false;

    try {
        const wxSdk = await loadWxSDK();
        const shareData = {
            title,
            desc: desc || title,
            link: url,
            imgUrl: imgUrl || '',
        };
        wxSdk.updateAppMessageShareData(shareData);
        wxSdk.updateTimelineShareData({
            title,
            link: url,
            imgUrl: imgUrl || '',
        });
        return true;
    } catch (err) {
        console.warn('[wxShare] 设置分享数据失败:', err);
        return false;
    }
}

// ──────────── 小程序 web-view postMessage ────────────

/**
 * 向宿主微信小程序发送分享数据（通过 web-view postMessage）。
 * 在小程序 web-view 中调用 wx.miniProgram.postMessage。
 *
 * @param {object} data
 * @param {string} data.title  - 分享标题
 * @param {string} data.desc   - 分享描述
 * @param {string} data.url    - 分享链接
 * @param {string} [data.imageUrl] - 分享图片
 */
export function postShareToMiniProgram({ title, desc, url, imageUrl }) {
    if (!isMiniProgramWebView()) return false;

    try {
        if (typeof wx !== 'undefined' && wx.miniProgram && wx.miniProgram.postMessage) {
            wx.miniProgram.postMessage({
                data: {
                    type: 'share',
                    title,
                    desc: desc || title,
                    url,
                    imageUrl: imageUrl || '',
                },
            });
            return true;
        }
    } catch (err) {
        console.warn('[wxShare] postMessage 失败:', err);
    }
    return false;
}

/**
 * 在小程序 web-view 中跳转到宿主小程序的原生分享页。
 *
 * web-view 的 navigateTo 是实时生效的（与 postMessage 不同），分享数据通过 URL query
 * 实时传递，宿主原生页用 onShareAppMessage 读取后，由用户点击原生分享按钮拉起转发面板。
 *
 * @param {object} data
 * @param {string} data.title    - 分享标题
 * @param {string} data.desc     - 分享描述
 * @param {string} [data.gameFrom] - 分享来源用户名（拼进被分享游戏的打开路径）
 * @param {string} [data.game]     - 被分享游戏文件名
 * @param {string} [data.icon]     - 游戏图标（emoji）
 * @param {string} [data.imageUrl] - 分享图片
 * @param {string} [data.msg]      - 分享者自定义留言（拼进落地登录页的 msg 参数）
 * @param {string} [data.page]     - 宿主小程序原生分享页路径
 * @returns {Promise<boolean>} 是否已发起跳转
 */
export async function navigateToSharePage({ title, desc, gameFrom, game, icon, imageUrl, msg, page = '/pages/share/share' }) {
    if (!isMiniProgramWebView()) return false;
    try {
        // wx.miniProgram.* 需要先加载微信 JS-SDK，否则 wx 不存在
        const wxSdk = await loadWxSDK();
        if (wxSdk && wxSdk.miniProgram && wxSdk.miniProgram.navigateTo) {
            // 用 encodeURIComponent 而非 URLSearchParams：后者把空格编码成 '+'，
            // 小程序端 decodeURIComponent 不会把 '+' 还原成空格。
            const pairs = [];
            const add = (k, v) => { if (v) pairs.push(`${k}=${encodeURIComponent(v)}`); };
            add('title', title);
            add('desc', desc);
            add('gameFrom', gameFrom);
            add('game', game);
            add('icon', icon);
            add('imageUrl', imageUrl);
            add('msg', msg);
            wxSdk.miniProgram.navigateTo({ url: `${page}?${pairs.join('&')}` });
            return true;
        }
    } catch (err) {
        console.warn('[wxShare] navigateTo 分享页失败:', err);
    }
    return false;
}

/**
 * 统一分享入口：根据当前环境自动选择分享方式。
 *
 * - 微信小程序 web-view → postMessage 给宿主小程序
 * - 微信内置浏览器 → JS-SDK updateAppMessageShareData（同时返回 true 表示已设置）
 * - 非微信环境 → 返回 false（调用方自行处理）
 *
 * @param {object} shareData
 * @param {string} shareData.title
 * @param {string} shareData.desc
 * @param {string} shareData.url
 * @param {string} [shareData.imgUrl]
 * @returns {Promise<boolean>} 是否已通过微信原生方式处理
 */
export async function wxShare(shareData) {
    if (isMiniProgramWebView()) {
        return postShareToMiniProgram(shareData);
    }
    if (isWechatBrowser()) {
        return setWxShareData(shareData);
    }
    return false;
}
