# 蛋蛋星球 MagicHaqi 🐾

> 🚫🚫🚫 **NEVER NEVER NEVER run `npm run build`.** 🚫🚫🚫
> This app does **NOT** need to be built. It is pure ES Module + Vanilla JS and runs directly in the browser.
> Do **NOT** run `npm run build`, `npm run build 2`, `vite build`, or any bundling/compile command to verify your changes.
> To check your work, just open `MagicHaqi.html` in the browser (Live Preview) — no build, no server, no compile step.
> `npm run build` exists **only** for distribution/CDN packaging by a human, never for development or verification.

一只 AI 生成的专属虚拟宠物 —— 移动端优先 H5 游戏（灵感来自 Tamagotchi Paradise + Toca Life World），基于 [KeepworkSDK](../../../../keepworkSDK)。

## ✨ 特色

1. **🔭 Zoom Dial 四倍率视图** —— 滚轮或滑动在 4 个倍率间切换：
   - **🌌 宇宙**：从宇宙视角看你的哈奇星球（星球色调由宠物主 trait 决定）。
   - **🪐 星球**（Pet Field）：陆 / 水 / 空 三大生态，收集 poop 兑换生物燃料⋹。
   - **🐾 宠物**：经典 5 个房间互动 + 装饰 + 探险。
  - **🧬 细胞**（Cell）：体内观察、DNA 食性提示与蛋阶段许愿。
2. **🥬 特征演化** —— 不同食物增加不同种族 trait 点：烤肉→猫科 🐱 、胡萝卜→兔形 🐰 、小鱼干→鱼形 🐟 ……顶部显示主 trait 徽章。
3. **🧬 AI 生成外观 + DNA 婚配繁殖** —— 12 字符 DNA → 中文特征 → `sdk.aiGenerators.genImage` 生成专属立绘；父母可足段级交叉 + 突变生成子代。
4. **房间 / 星球装饰** —— 8×6 网格点选放置家具；Field 视图可任意坐标摆放。
5. **数字人语音对话**（VIP） —— 用 KeepWork 数字人接口和宠物面对面聊天。
6. **每只宠物独立记忆** —— `pets/<petId>.memory.md` 存于 `MagicHaqi` workspace，AI 持续记得你们的故事。
7. **全中文 UI** · 暖橙儿童向主题 · 离线状态衰减 · 四项养成属性。

## 🚀 运行

直接用浏览器打开 [`MagicHaqi.html`](MagicHaqi.html) 即可。

- 推荐 `127.0.0.1` 或 Vite/Live Server 环境（可命中本地 SDK 源码 `keepworkSDK/index.js`）。
- 首次进入需登录 KeepWork 账号；登录后可孵化第一只Pet。

## 📁 目录结构

```
MagicHaqi/
  MagicHaqi.html          # 入口
  js/
    app.js                # 路由 + 全局事件
    state.js              # 单一状态源（含 zoomLevel / currentField / currentRoom）
    storage.js            # PersonalPageStore 适配
    api.js                # AI 调用封装
    dna.js                # DNA 算法
    petTick.js            # 状态衰减 / 阶段成长 / 是否生病
    soundManager.js       # 音效管理, prefer midi with at least 2 seconds duration.
    config.js / i18n.js / utils.js
    level_planet.js       # 🌌 Level 0 — 宇宙：俯视哈奇星
    level_field.js        # 🪐 Level 1 — 星球：陆/水/空 + poop→⛽ + 户外摆件
    level_pet.js          # 🐾 Level 2 — 宠物：5 房间 + 8×6 装饰 + 5 项互动
    level_cell.js         # 🧬 Level 3 — 细胞：体内观察 + DNA 提示 + 蛋阶段许愿
    view_*.js             # 9 个视图模块（login/petList/hatch/home/shop/inventory/chat/profile/settings）
                          # view_home.js 是 Zoom Dial 的 orchestrator，把 stage/dock 委派给 4 个 level_*.js
  docs/
    design.md             # 产品设计
    architecture.md       # 技术架构
    code-plan.md          # 实现摘要
    qa-report.md          # QA 报告
```

## 🎮 玩法循环

```
登录 → 宠物列表 → 孵化（DNA + AI 立绘） → 主家（4 倍率 Zoom Dial）
                                            ├─ 🌌 宇宙：看哈奇星
                                            ├─ 🪐 星球：陆/水/空 + poop → ⋹
                                            ├─ 🐾 宠物：喂食/玩耍/洗澡/睡觉
                                            │             + 房间切换 + 装饰
                                            ├─ 🧬 细胞：体内观察 / 蛋阶段许愿
                                            ├─ 🛒 商店 / 🎒 背包
                                            ├─ 💬 聊天（文字 + VIP 语音）
                                            └─ 📋 档案（DNA + 记忆）
```

## 🛠 技术栈

- 纯 ES Module + Vanilla JS（无 build）
- Tailwind CSS（CDN）
- KeepworkSDK：`personalPageStore` / `aiGenerators.genImage` / `aiChat` / `loginWindow` / `DigitalHuman`

## 📜 数据持久化

- 用户共享数据：`user/profile.json`（含当前宠物）、`user/inventory.json`、`user/layouts.json`
- 宠物配置：`pets/<petId>.json`
- 宠物文本：`pets/<petId>.memory.md`、`pets/<petId>.chat.log`
- 运营层：`agent/audit.log`（agent 写操作审计）、`agent/ops-*.{json,log}`（运营 agent 状态）
- localStorage 仅缓存 UI 偏好

更多请见 [docs/design.md](docs/design.md) 与 [docs/architecture.md](docs/architecture.md)。

## 🤖 Agent 运营层（页面即 API，无后端）

MagicHaqi 可由 AI agent（co-parent）通过**打开真实网站 + 登录 + URL 导航 + 隐藏命令接口**操作，无需 REST 后端。

- **隐藏命令接口** [`js/agentBridge.js`](js/agentBridge.js)：`window.MagicHaqiAgent.exec(cmd)` / `getState()`；隐藏节点 `#mh-agent-cmd`（入）、`#mh-agent-result`（出）、`#mh-agent-state`（机读状态，随 render 刷新）。命令注册表复用现有 view 回调 / `handleAction` / `storage` / `api`，不改玩法。
- **登录捷径**：KeepWork login REST `POST https://api.keepwork.com/core/v0/users/login` 换 token，再 `MagicHaqi.html?token=<token>` 进入。
- **深链**：`?adopt=1`、`?agent=<id>`（写入 `agentOwner` 双主人）、`?cmd=<urlencoded>`、`?view=ops`。
- **审计** [`js/agentAudit.js`](js/agentAudit.js)：写操作落 `agent/audit.log`。
- **运营控制台** [`js/view_ops_console.js`](js/view_ops_console.js)：`?view=ops`，人工兜底面板。
- **官网** [`site/index.html`](site/index.html)：英文对外站，含领养 CTA 与 agent 接入说明。
- **agent 包** [`agents/`](agents/README.md)：`agents/pet-master/`（装在所有用户电脑的 OpenClaw 宠物管家 skill）、`agents/haqi-operator/`（开发者用的 24h 一人公司运营 agent）。

## Common Pitfalls to Avoid
❌ **NEVER NEVER NEVER run `npm run build`** (or `npm run build 2`, `vite build`, or any bundling/compile command). The app does NOT need to be built. All games run directly in the browser without bundling. Vite is ONLY for distribution packaging by a human — never for development, never for verifying your changes. After editing, just open the HTML file / use Live Preview; do not build.
❌ Don't start a server to test, just live preview in VSCode or open HTML file directly in browser
