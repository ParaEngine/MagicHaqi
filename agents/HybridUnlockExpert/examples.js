/**
 * HybridUnlockExpert - 集成示例
 *
 * 混合解锁链路：VIP/SVIP 直接免 → 看激励广告解锁 → 购买 keepwork 会员（天卡/正式会员）解锁。
 * 付费的本质是买真实 keepwork VIP（复用全站 vipPayOrder 支付链路），不是单品订单。
 *
 * 示例 1 适用于沙盒小游戏（haqi_*.html，iframe 内，拿不到 sdk）；
 * 示例 2-4 适用于 MagicHaqi 主应用或自己加载 keepworkSDK 的独立页面。
 */

// ==========================================
// 示例 1: 沙盒小游戏中请求解锁（postMessage 协议）
// ==========================================

const pendingUnlocks = {}; // requestId → { onUnlocked, ackTimer }

/**
 * 请求解锁一个付费点；独立双击打开（无宿主）时 ~1500ms 兜底放行，游戏绝不卡死。
 */
function requestUnlockInMinigame(scene, title, onUnlocked) {
  const requestId = `unlock_${scene}_${Date.now()}`;
  try {
    window.parent.postMessage({ type: 'haqi_request_unlock', requestId, scene, title }, '*');
  } catch (_) {
    onUnlocked('simulated'); // 无宿主环境
    return;
  }
  pendingUnlocks[requestId] = {
    onUnlocked,
    ackTimer: setTimeout(() => {
      delete pendingUnlocks[requestId];
      onUnlocked('simulated');
    }, 1500),
  };
}

// 保持一个长期存在的监听器，按 requestId 匹配回执（禁止用 msg.scene 匹配）
window.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'haqi_vip_status') {
    // { isVip } — VIP 用户可在 UI 上隐藏锁标
    updateVipBadge(!!msg.isVip);
    return;
  }
  const pending = pendingUnlocks[msg.requestId];
  if (!pending) return;
  if (msg.type === 'haqi_unlock_ack') {
    // ack 只表示宿主接手，还没解锁；仅取消 1500ms 本地兜底
    clearTimeout(pending.ackTimer);
    return;
  }
  if (msg.type === 'haqi_unlock_result') {
    // { requestId, ok, unlocked, via: 'vip'|'ad'|'member'|'cancel'|'error' }
    if (msg.ok && msg.unlocked) pending.onUnlocked(msg.via);
    else if (typeof pending.onFailed === 'function') pending.onFailed(msg.via || 'cancel');
    delete pendingUnlocks[msg.requestId];
  }
});

// 关卡按钮：锁定必须可点（禁止 btn.disabled = locked）
// function renderLevelButton(lvl) {
//   const locked = !isLevelUnlocked(lvl.id);
//   btn.textContent = locked ? `${lvl.name} 🔒` : lvl.name;
//   btn.onclick = () => {
//     if (!locked) return startLevel(lvl.id);
//     requestUnlockInMinigame(`level_${lvl.id}`, `解锁第${lvl.id}关`, (via) => {
//       unlockedByAd[lvl.id] = true;
//       startLevel(lvl.id);
//     });
//   };
// }

// 主动查询会员状态 / 打开会员开通窗口
function queryVipStatus() {
  try { window.parent.postMessage({ type: 'haqi_get_vip_status' }, '*'); } catch (_) {}
}
function openVipWindow() {
  try { window.parent.postMessage({ type: 'haqi_open_vip' }, '*'); } catch (_) {}
}

function updateVipBadge(isVip) {
  console.log(isVip ? '👑 VIP 用户，隐藏锁标' : '普通用户');
}

// 用法：
// requestUnlockInMinigame('level_3', '解锁第3关', (via) => startLevel(3));

// ==========================================
// 示例 2: 主应用中的广告解锁（当前主链路）
// ==========================================

/**
 * 一个调用弹出完整选择层：VIP 免 → 看广告 → 开通会员
 */
async function unlockWithAd(scene, title) {
  if (!state.sdk || !state.sdk.ads || typeof state.sdk.ads.requestUnlock !== 'function') {
    showToast('请先登录', 'error');
    return { unlocked: false, via: 'error' };
  }
  // result: { unlocked: boolean, via: 'vip'|'ad'|'member'|'cancel'|'error' }
  return state.sdk.ads.requestUnlock({ scene, title });
}

// 用法：
// const result = await unlockWithAd('hint_3', '获取提示');
// if (result.unlocked) showHint();

// ==========================================
// 示例 3: 真实会员支付（全站 vipPayOrder 链路）
// ==========================================

/**
 * 支付页必须在 keepwork 主站。localhost / CDN / raw 页没有 /p/vb/* 路由。
 * 仅当当前已在 keepwork 主站时才复用 location.origin。
 */
function resolveKeepworkOrigin() {
  const host = (location.hostname || '').toLowerCase();
  if (/(^|\.)keepwork\.com$/.test(host) || /(^|\.)keepwork\.cn$/.test(host)) {
    return location.origin;
  }
  return 'https://keepwork.com';
}

/**
 * 构造 /p/vb/vipPayOrder URL。
 * - 天卡：传 amountYuan（元），内部 *100 成「分」
 * - 正式套餐：amountYuan 传 null，不带 amount，后端用商品表固定价
 * - productCode 正则：vip_(super|common)_<n>_(day|month|year)
 */
function buildVipPayOrderUrl({
  userId,
  productCode = 'vip_common_1_day',
  amountYuan = 4,
  from = 'unlock',
  referralUrl,
}) {
  const params = new URLSearchParams({
    from: String(from),
    userId: String(userId),
    productCode: String(productCode),
    referralUrl: referralUrl || (location.pathname + location.search),
  });
  if (amountYuan != null && amountYuan !== '' && !Number.isNaN(Number(amountYuan))) {
    params.set('amount', String(Math.round(Number(amountYuan) * 100)));
  }
  return `${resolveKeepworkOrigin()}/p/vb/vipPayOrder?${params.toString()}`;
}

/** 兼容旧名：天卡 URL（amount 单位分） */
function buildDayPassUrl({ userId, amountFen = 400, superVip = false, referralUrl, from = 'unlock' }) {
  return buildVipPayOrderUrl({
    userId,
    productCode: superVip ? 'vip_super_1_day' : 'vip_common_1_day',
    amountYuan: amountFen / 100,
    from,
    referralUrl,
  });
}

/** iframe 小窗 / 顶层跳转 */
function openVipPayOrder(url) {
  if (window.parent !== window) {
    window.open(url, '_blank', 'width=400,height=600');
  } else {
    location.href = url;
  }
}

/**
 * ¥4 普通 VIP 天卡（vip_common_1_day）。
 * 支付回来强刷 isUserVip 即为解锁（当天所有付费点连带解锁）。
 */
async function dayPassUnlock({ superVip = false, amountYuan = 4 } = {}) {
  const sdk = state.sdk;
  if (!sdk || typeof sdk.getUserProfile !== 'function') {
    showToast('SDK 未就绪', 'error');
    return;
  }
  const user = await sdk.getUserProfile();
  if (!user?.id) {
    if (typeof sdk.showLoginWindow === 'function') await sdk.showLoginWindow();
    return;
  }
  openVipPayOrder(buildVipPayOrderUrl({
    userId: user.id,
    productCode: superVip ? 'vip_super_1_day' : 'vip_common_1_day',
    amountYuan,
    from: 'unlock',
    referralUrl: location.pathname + location.search,
  }));
}

/** 正式套餐（不传 amount，走商品表固定价） */
async function membershipUnlock(productCode = 'vip_common_1_month') {
  const sdk = state.sdk;
  const user = await sdk.getUserProfile();
  if (!user?.id) {
    if (typeof sdk.showLoginWindow === 'function') await sdk.showLoginWindow();
    return;
  }
  openVipPayOrder(buildVipPayOrderUrl({
    userId: user.id,
    productCode,
    amountYuan: null,
    from: 'unlock',
  }));
}

/** 正式会员中心页（/vip 套餐选择 + 扫码支付） */
function openVipCenter() {
  const referralUrl = encodeURIComponent(location.pathname + location.search);
  const url = `${resolveKeepworkOrigin()}/vip?from=unlock&referralUrl=${referralUrl}`;
  if (window.parent !== window) window.open(url, '_blank');
  else location.href = url;
}

// 支付小窗回来 / 页签回焦：强刷会员
async function refreshVipAfterPay() {
  if (!state.sdk || typeof state.sdk.isUserVip !== 'function') return false;
  const isVip = await state.sdk.isUserVip({ useCache: false });
  if (isVip) unlockEverything();
  return isVip;
}
window.addEventListener('focus', () => { refreshVipAfterPay(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshVipAfterPay();
});

function unlockEverything() {
  console.log('👑 已是会员，解锁全部付费点');
}

// ==========================================
// 示例 4: 免费体验门槛（每天免费 N 次，超过才弹解锁）
// ==========================================

/**
 * 注意：这只是体验门槛，不是解锁凭证；解锁凭证永远是会员状态或当次广告结果。
 */
function takeFreeQuota(key, dailyLimit) {
  const today = new Date().toISOString().slice(0, 10);
  let data;
  try { data = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { data = {}; }
  if (data.date !== today) data = { date: today, used: 0 };
  if (data.used >= dailyLimit) return false;
  data.used++;
  localStorage.setItem(key, JSON.stringify(data));
  return true;
}

// 用法：
// if (takeFreeQuota('hint_quota', 3)) { showHint(); }
// else { const r = await unlockWithAd('hint_extra', '获取更多提示'); if (r.unlocked) showHint(); }

// ==========================================
// 工具函数（占位，替换为宿主项目的实现）
// ==========================================

function showToast(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// ==========================================
// 导出（供其他模块使用）
// ==========================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    requestUnlockInMinigame,
    queryVipStatus,
    openVipWindow,
    unlockWithAd,
    resolveKeepworkOrigin,
    buildVipPayOrderUrl,
    buildDayPassUrl,
    openVipPayOrder,
    dayPassUnlock,
    membershipUnlock,
    openVipCenter,
    refreshVipAfterPay,
    takeFreeQuota,
  };
}
