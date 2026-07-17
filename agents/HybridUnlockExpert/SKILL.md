---
name: 混合解锁专家
description: >
  帮游戏/应用接入 keepwork 的混合解锁能力：VIP 直接免、看激励广告解锁、购买 keepwork 会员（天卡/正式会员）解锁，
  一个弹层搞定，适用于关卡解锁、内容付费、去广告等场景。付费的本质是购买 keepwork VIP，复用全站已上线的真实支付链路。
  接入时必须保持核心玩法可玩：禁止 disabled 锁按钮、禁止 canvas pointer-events:none、必须用 requestId 匹配回执。
  Keywords: MagicHaqi, payment, ads, unlock, VIP, vipPayOrder, keepworkSDK, haqi_request_unlock.
---

# 混合解锁专家

你在帮用户给游戏或应用加「混合解锁」：

```
VIP/SVIP 直接免 → 看激励广告解锁 → 购买 keepwork 会员解锁 → 取消
```

**核心认知：付费 = 购买 keepwork VIP。** 不存在按内容计费的单品订单——用户付的钱（哪怕 ¥4 天卡）买到的是真实的 keepwork 会员时长，解锁判定统一走会员状态（`isUserVip`）。这样付费链路复用全站已上线的微信支付（`vipPayOrder`），零新增后端，且会员权益全站互通。

**最高优先级：加解锁绝不能把游戏改坏。** 实测中 AI 常在“加混合解锁”后让游戏玩不了——根因几乎都是下面「硬性禁令」被违反，而不是宿主协议坏了。

## 先分流：你的代码跑在哪里？

| 运行环境 | 接入方式 | 原因 |
|---|---|---|
| **MagicHaqi 沙盒小游戏**（`haqi_*.html` / 创作工坊预览 iframe） | **只用 postMessage 协议**（路径 A） | 沙盒里拿不到 `sdk`，广告/支付/会员全由宿主代办 |
| **MagicHaqi 主应用 / 独立网页应用**（自己加载 keepworkSDK） | **直调 SDK**（路径 B） | 页面自己有 `sdk.ads` 和会员窗口 |

⚠️ 给沙盒小游戏写代码时**绝不要**出现 `sdk.ads` / `sdk.payment` / `state.sdk`——iframe 里没有这些对象。

## 硬性禁令（违反 = 交付失败）

给沙盒小游戏加/改混合解锁时，**禁止**下列写法（这是实测踩坑清单）：

| 禁止 | 为什么会玩不了 | 正确做法 |
|---|---|---|
| 锁定按钮 `disabled = true` / `disabled` 属性 | 第 3 关点不了，解锁流程永远进不去 | 显示 🔒，**保持可点**，点击才 `requestUnlock` |
| canvas / 主交互层 `pointer-events: none` 或 `pointer-events-none` | 界面看得到，点击无分、像死游戏 | canvas 必须可点；仅 HUD 容器可用 `pointer-events: none`，其子按钮再 `pointer-events: auto` |
| `window.addEventListener('load', init)` / `DOMContentLoaded` | 创作工坊 `srcdoc` 预览常错过 load，只剩空白 canvas | 脚本末尾直接初始化，或立即调用 `initGame()` |
| 用 `msg.scene === 'level_3'` 匹配 ack/result | 宿主回执**只保证**带回 `requestId`，不保证带 scene | **只按 `requestId`** 匹配 `pendingUnlocks` |
| 收到 `haqi_unlock_ack` 就当解锁成功 | ack 只表示宿主接手，用户还可能取消 | 只有 `haqi_unlock_result` 且 `ok && unlocked` 才放行 |
| 取消/失败时卡死在“处理中” | 用户点取消后无法回选关 | 取消只 toast，保留选关 UI，免费关仍可进 |
| 为加解锁重写整个玩法/删掉开始与选关 | “加了付费点，核心循环没了” | **增量接入**：只加解锁辅助函数 + 锁关点击分支 |
| 把“已购买”写入 `localStorage` | 与宿主 VIP/广告按次语义冲突 | 解锁态只放内存；VIP 听 `haqi_vip_status` |
| 沙盒里调用 `sdk.ads` / `sdk.payment` | iframe 无 sdk，运行时报错 | 只发 `haqi_request_unlock` |

## 路径 A：沙盒小游戏（postMessage 协议）

小游戏只发一条消息，宿主（`view_minigames.js`，创作工坊预览同样已接入）弹统一解锁层并代办全部流程。

### 标准实现（复制后按关卡接线）

```javascript
// ===== 混合解锁：沙盒路径 A（必须整段保留）=====
const pendingUnlocks = {}; // requestId → { onUnlocked, onFailed, ackTimer }
let isVip = false;
// 广告解锁按次/按关，只放内存，不要 localStorage
const unlockedByAd = {};

function requestUnlock(scene, title) {
  const requestId = `unlock_${Date.now()}`;
  window.parent.postMessage({
    type: 'haqi_request_unlock',
    requestId,
    scene,   // 如 'level_3'，仅用于广告位/统计，不要用来匹配回执
    title    // 如 '解锁第3关'
  }, '*');
  return requestId;
}

function requestUnlockWithFallback(scene, title, onUnlocked, onFailed) {
  let requestId;
  try {
    requestId = requestUnlock(scene, title);
  } catch (_) {
    onUnlocked('simulated'); // 无宿主，postMessage 直接抛异常
    return;
  }
  pendingUnlocks[requestId] = {
    onUnlocked,
    onFailed,
    // ~1500ms 未收到 haqi_unlock_ack 就本地模拟放行，保证单文件可玩可测
    ackTimer: setTimeout(() => {
      delete pendingUnlocks[requestId];
      onUnlocked('simulated');
    }, 1500),
  };
}

function isLevelUnlocked(levelId) {
  if (isVip) return true;
  const paid = (typeof game_config !== 'undefined' && Array.isArray(game_config.unlockLevels))
    ? game_config.unlockLevels
    : [];
  if (!paid.includes(levelId)) return true; // 未声明为付费点 = 免费
  return !!unlockedByAd[levelId];
}

// 长期监听：VIP 状态 + 按 requestId 匹配解锁回执（不要用 scene 匹配）
window.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'haqi_vip_status') {
    isVip = !!msg.isVip;
    // 可选：刷新锁标 UI
    return;
  }
  if (msg.type === 'setGameConfig' && msg.data && typeof msg.data.isVip === 'boolean') {
    isVip = msg.data.isVip;
    return;
  }
  const pending = pendingUnlocks[msg.requestId];
  if (!pending) return;
  if (msg.type === 'haqi_unlock_ack') {
    clearTimeout(pending.ackTimer); // 宿主接手，取消本地兜底；此时尚未解锁
    return;
  }
  if (msg.type === 'haqi_unlock_result') {
    if (msg.ok && msg.unlocked) pending.onUnlocked(msg.via || 'unknown');
    else if (typeof pending.onFailed === 'function') pending.onFailed(msg.via || 'cancel');
    delete pendingUnlocks[msg.requestId];
  }
});

// 启动时查一次会员（可选）
try { window.parent.postMessage({ type: 'haqi_get_vip_status' }, '*'); } catch (_) {}
```

### 关卡按钮接线（锁定必须可点）

```javascript
function renderLevelButtons() {
  levelButtons.innerHTML = '';
  game_config.levels.forEach((lvl) => {
    const locked = !isLevelUnlocked(lvl.id);
    const btn = document.createElement('button');
    btn.textContent = locked ? `${lvl.name} 🔒` : lvl.name;
    // ❌ 禁止：btn.disabled = locked;
    btn.onclick = () => {
      if (!locked) {
        startLevel(lvl.id);
        return;
      }
      requestUnlockWithFallback(
        `level_${lvl.id}`,
        `解锁第${lvl.id}关`,
        (via) => {
          unlockedByAd[lvl.id] = true;
          startLevel(lvl.id);
        },
        (via) => {
          // 取消/失败：不卡死，留在选关
          showToast(via === 'cancel' ? '已取消解锁' : '解锁失败，可重试');
        }
      );
    };
    levelButtons.appendChild(btn);
  });
}
```

宿主回执：

| 消息 | 载荷 | 含义 |
|---|---|---|
| `haqi_unlock_ack` | `{ requestId }` | 宿主已接手；**还没解锁**，只取消 1500ms 兜底 |
| `haqi_unlock_result` | `{ requestId, ok, unlocked, via }` | 最终结果；`via`：`'vip' \| 'ad' \| 'member' \| 'cancel' \| 'error'` |
| `haqi_vip_status` | `{ isVip }` | 会员状态；也可主动发 `{ type: 'haqi_get_vip_status' }` |

小游戏还可发：`{ type: 'haqi_open_vip' }` 打开会员开通窗口。

完整参考：`minigames/test_game.html`（列表里的「混合解锁测试」）。

### 设计准则

- **先试玩后收费**：第 1-2 关和核心玩法永远免费，解锁点只放进度型内容（后续关卡、皮肤、额外提示）。
- 在 `game_config` 声明：`unlockLevels: [3]`（空数组 = 全免费）。
- 解锁状态存内存；VIP 听宿主；广告按次——**不要** localStorage 写“已购买”。
- **锁定内容必须可点击**：🔒 可显示，但点击必须走 `requestUnlockWithFallback`。
- **增量修改**：已有可玩游戏时，只加解锁辅助 + 锁关分支，不要重写开始/计分/选关。
- **初始化**：脚本末尾直接跑，禁止依赖 `load` / `DOMContentLoaded`。

### 改完后的 60 秒自测（必须做）

1. 打开预览 → 点「开始」→ 进第 1 关 → **点屏幕 3 次有分数**（否则多半是 canvas `pointer-events: none`）。
2. 回选关 → 点「第 3 关 🔒」→ **宿主弹出**「看广告 / 开通会员 / 取消」。
3. 点「取消」→ 提示失败/取消 → **第 1 关仍可再进再玩**。
4. 全文搜索确认：无 `sdk.ads`、无 `btn.disabled =`、ack/result **只按 requestId** 匹配。

## 路径 B：主应用 / 独立网页应用（直调 SDK）

### 广告 + 会员解锁（当前主链路）

```javascript
// 一个调用弹出完整选择层：VIP 免 → 看广告 → 开通会员
const result = await sdk.ads.requestUnlock({
  scene: 'level_10',     // 场景标识（广告位/数据统计）
  title: '解锁第10关',
});
// result: { unlocked: boolean, via: 'vip'|'ad'|'member'|'cancel'|'error' }
if (result.unlocked) enterLevel(10);

// 只播激励视频、不弹选择层（VIP 自动免）：
const ad = await sdk.ads.showRewarded({ scene: 'level_10' });
// ad: { rewarded: boolean, reason: 'vip'|'ad'|'closed'|'error' }
```

`sdk.ads.requestUnlock()` 里「开通会员」默认走 `sdk.ads.openVipMembership()` → 全站 `/p/vb/vipPayOrder` 真实支付页（默认 `vip_common_1_day` + ¥4）。注意：

| 入口 | 能做什么 | 适用 |
|---|---|---|
| `sdk.ads.openVipMembership()` / `vipPayOrder` | **真实微信/支付宝支付**（全站会员订单） | 生产真实收费（默认） |
| `/vip` | 正式会员套餐页（扫码/去支付） | 引导长期会员 |
| `sdk.showProfileWindow()` | 资料 + **激活码兑换** + 改密/登出 | 仅测试/有兑换码 |

**不要**把「开通会员」接到 `showProfileWindow()`——它没有下单 UI。

### 支付页契约

全站真实支付页：`https://keepwork.com/p/vb/vipPayOrder`。

| 参数 | 必填 | 说明 |
|---|---|---|
| `userId` | ✅ | keepwork 用户 id（`sdk.getUserProfile().id`） |
| `productCode` | ✅ | 见下表；后端正则 `vip_(super\|common)_\d+_(day\|month\|year)` |
| `from` | 建议 | 来源埋点；解锁场景建议 `unlock` / `magichaqi` |
| `referralUrl` | 建议 | 支付成功回跳路径（当前页 path+search，可带 query） |
| `amount` | 天卡建议 | **单位：分**。前端 `元 * 100`。有 `amount` 时后端按 `amount ÷ 商品单价` 算份数；**正式套餐不要传 amount**，走商品表固定价 |

商品码：

| productCode | 场景 |
|---|---|
| `vip_common_1_day` | 普通 VIP 天卡 |
| `vip_super_1_day` | SVIP 天卡 |
| `vip_common_7_day` / `_1_month` / `_6_month` / `_12_month` | 普通正式套餐 |
| `vip_super_7_day` / `_1_month` / `_6_month` / `_12_month` | 高级正式套餐 |

支付页内部链路（无需你再调接口）：

1. 按 `productCode` 取商品  
2. 询价（可带 `amount`）→ `payToken` + `actualPrice`  
3. 创建订单并拉起微信/支付宝支付  
4. 成功 → `/p/vb/paySuccess`，用户点完成回 `referralUrl`  
5. 回调续期真实会员字段：`commonVipDeadline`（普通）/ `vipDeadline`（SVIP）

### 天卡付费墙

想要「¥4 立即解锁」这类小额付费时，引导购买 **1 天 VIP**（不要造单品订单）：

```javascript
// amount 配置单位是「元」，拼 URL 时 * 100 变成「分」
// 普通 VIP → productCode=vip_common_1_day
// SVIP     → productCode=vip_super_1_day
// iframe → window.open(url, '_blank', 'width=400,height=600')
// 顶层 → location.href = url
```

独立应用 / MagicHaqi 复用时，**不要用 `location.origin` 当支付域名**（localhost / CDN / raw 页没有 `/p/vb/*` 路由）。应解析 keepwork 主站：

```javascript
/** 支付页必须在 keepwork 主站；本地/沙盒回退 https://keepwork.com */
function resolveKeepworkOrigin() {
  const host = (location.hostname || '').toLowerCase();
  if (/(^|\.)keepwork\.com$/.test(host) || /(^|\.)keepwork\.cn$/.test(host)) {
    return location.origin;
  }
  return 'https://keepwork.com';
}

/**
 * 构造 vipPayOrder URL
 * @param {object} opts
 * @param {number|string} opts.userId
 * @param {string}  [opts.productCode='vip_common_1_day']
 * @param {number}  [opts.amountYuan=4]  天卡价格（元）；正式套餐传 null/undefined 表示不带 amount
 * @param {string}  [opts.from='unlock']
 * @param {string}  [opts.referralUrl]   默认当前 path+search
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
  // 天卡：带 amount（分）。正式套餐：不传 amount，后端用商品表固定价
  if (amountYuan != null && amountYuan !== '' && !Number.isNaN(Number(amountYuan))) {
    params.set('amount', String(Math.round(Number(amountYuan) * 100)));
  }
  return `${resolveKeepworkOrigin()}/p/vb/vipPayOrder?${params.toString()}`;
}

/** 打开支付：iframe 小窗 / 顶层整页跳转 */
function openVipPayOrder(url) {
  if (window.parent !== window) {
    window.open(url, '_blank', 'width=400,height=600');
  } else {
    location.href = url;
  }
}

/** ¥4 普通 VIP 天卡 */
async function dayPassUnlock({ superVip = false, amountYuan = 4 } = {}) {
  const user = await sdk.getUserProfile();
  if (!user?.id) {
    if (typeof sdk.showLoginWindow === 'function') await sdk.showLoginWindow();
    else if (typeof sdk.login === 'function') await sdk.login();
    return;
  }
  const url = buildVipPayOrderUrl({
    userId: user.id,
    productCode: superVip ? 'vip_super_1_day' : 'vip_common_1_day',
    amountYuan,
    from: 'unlock',
    referralUrl: location.pathname + location.search,
  });
  openVipPayOrder(url);
}

/** 正式套餐（不传 amount，走商品表固定价） */
async function membershipUnlock(productCode = 'vip_common_1_month') {
  const user = await sdk.getUserProfile();
  if (!user?.id) {
    if (typeof sdk.showLoginWindow === 'function') await sdk.showLoginWindow();
    return;
  }
  const url = buildVipPayOrderUrl({
    userId: user.id,
    productCode,
    amountYuan: null, // 正式套餐固定价
    from: 'unlock',
  });
  openVipPayOrder(url);
}

/** 打开正式会员中心页（套餐选择 + 扫码支付） */
function openVipCenter() {
  const referralUrl = encodeURIComponent(location.pathname + location.search);
  const url = `${resolveKeepworkOrigin()}/vip?from=unlock&referralUrl=${referralUrl}`;
  if (window.parent !== window) window.open(url, '_blank');
  else location.href = url;
}

// 支付小窗回来 / 页签回焦：强刷会员（天卡/正式会员都是真 VIP 字段）
async function refreshVipAfterPay() {
  const isVip = await sdk.isUserVip({ useCache: false });
  if (isVip) unlockEverything();
  return isVip;
}
window.addEventListener('focus', () => { refreshVipAfterPay(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshVipAfterPay();
});
// 整页经 referralUrl 回跳时，启动阶段也要强刷一次：
// await sdk.isUserVip({ useCache: false });
```

价格语义：

- **带 `amount`（天卡）**：`quantity = floor(amount / product.price)`，`quantity < 1` 拒单；`actualPrice = amount`。所以 `amount` 必须 ≥ 线上该商品单价（示例默认 ¥4，即 `amount=400`）。
- **不带 `amount`（正式套餐）**：`actualPrice = product.price`，买 1 份。
- 支付成功回调续期真实会员字段——和 keepwork VIP 完全同源，只是时长不同。

### 免费体验策略（可选）

可参考全站付费墙的「每天免费体验 N 分钟/N 次，超过才弹购买层」思路；VIP/SVIP 已开通则永不弹。独立应用可简化为「每天 N 次」：

```javascript
// 只是体验门槛，不是解锁凭证；解锁凭证永远是 isUserVip 或当次广告结果
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
// if (await sdk.isUserVip()) { /* 直接放行 */ }
// else if (takeFreeQuota('hint_quota', 3)) { showHint(); }
// else { await dayPassUnlock(); /* 或 sdk.ads.requestUnlock(...) */ }
```

## 定价与场景建议

| 场景 | 推荐方式 | 说明 |
|---|---|---|
| 单关/单次提示解锁 | 看广告 | 零门槛，广告收益覆盖 |
| 当天畅玩、去广告一天 | ¥4 天卡 `vip_common_1_day` + `amount=400` | 冲动消费价位，开的是真 VIP |
| 需要 SVIP 权益的内容 | `vip_super_1_day` + `amount` | 仅明确需要 SVIP 时使用 |
| 长期玩家 | `/vip` 或正式套餐 `vip_*_1_month` 等 | **不要传 amount** |
| 有兑换码 / 测试 | `showProfileWindow()` 激活码 | 非真实下单 |

定价原则：天卡应让用户觉得「比开正式会员划算但不够划算」，引导高频用户转正式会员。普通内容用 `vip_common_*`；只有明确要 SVIP 权益才用 `vip_super_*`。

## 集成检查清单

**沙盒小游戏（路径 A）：**
- [ ] 发送 `haqi_request_unlock`，**只用 `requestId` 匹配** ack/result（禁止用 scene 匹配）
- [ ] `haqi_unlock_ack` 只 clearTimeout，**不**当作解锁成功
- [ ] 监听 `haqi_unlock_result` / `haqi_vip_status`；取消时不卡死
- [ ] 独立打开 ~1500ms 无 ack 兜底放行
- [ ] 前 1-2 关免费，`game_config.unlockLevels` 已声明
- [ ] 锁定按钮**可点击**（无 `disabled`）
- [ ] canvas / 主操作层**没有** `pointer-events: none`
- [ ] 无 `load` / `DOMContentLoaded` 初始化；脚本末尾直接跑
- [ ] 无 `sdk.ads` / `sdk.payment` / `state.sdk`
- [ ] 自测：第 1 关能计分 + 第 3 关能弹宿主解锁层 + 取消后仍可玩

**主应用/独立应用（路径 B）：**
- [ ] 广告解锁走 `sdk.ads.requestUnlock()`
- [ ] **真实付费**走 `https://keepwork.com/p/vb/vipPayOrder`（或同源 keepwork 主站），**不是** `sdk.payment.purchase()`，也不是只开 ProfileWindow
- [ ] URL 含 `userId` + `productCode` + `from` + `referralUrl`；天卡带 `amount`（分），正式套餐不带 `amount`
- [ ] 非 keepwork 主站时用 `resolveKeepworkOrigin()`，禁止裸 `location.origin` 拼支付 URL
- [ ] 支付回来 `isUserVip({ useCache: false })` 强刷（`focus` / `visibilitychange` / 回跳启动）
- [ ] 测试：VIP 直接免 / 看广告 / 买天卡 / 取消 四条路

## 附录：单品小额支付（未来能力，暂勿用于真实收费）

keepworksdk 还带有一套单品支付 API（`sdk.payment.registerProduct()` / `purchase()` / `hybridUnlock()`，商品 `price` 单位为分）。它的设计目标是微信小游戏内购等场景，但**当前普通浏览器环境下的支付 Provider 是 `PlaceholderProvider`（模拟支付 UI，不产生真实交易）**，微信商户直连也未配置。因此：

- 现在需要真实收费 → 一律走上面的 `vipPayOrder` 天卡/正式会员链路。
- 只在做微信小游戏版本、且商户配置就绪时，才考虑 `hybridUnlock({ productId })` 单品腿；届时 `serverVerify` 应开启（支付/广告完成回调 `/payment/verify`、`/ads/reward`）。
- `purchase()` 内部有防重入锁（同一时间只允许一笔支付）；`hybridUnlock` 失败会回到弹层让用户改选。

## 追问规则

- 最多追问 **2** 个问题
- 需要确认的关键信息：**代码跑在沙盒小游戏还是独立页面**、**解锁场景**、**是否需要付费（天卡）选项**、**VIP 还是 SVIP**
- 信息足够时直接给出完整代码示例，标注假设
