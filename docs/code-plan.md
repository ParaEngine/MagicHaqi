# 蛋蛋星球 —— 代码计划与实现摘要

## 实现范围

按 architecture.md 全量实现：入口 HTML + CSS 拆分文件 + 核心 / level / view JS 模块。

## 关键文件清单

- `MagicHaqi.html` — 入口，Tailwind CDN + 暖橙主题 + `#app`，加载 SDK 后 `import('./js/app.js')`
- `css/planet.css` — Level 0 宇宙、星球经营弹窗、设施 SVG、哈奇岛下载弹窗与响应式样式
- `css/field.css` — Level 1 地表生态、天气承接、户外摆放、便便收集与宠物漫步样式
- `js/app.js` — 路由表 + 全局事件 handlers（登录/孵化/繁殖/互动/购买/装饰/导航/清除数据）
- `js/state.js` — 单一状态源 + `subscribe/notify`
- `js/config.js` — 常量（属性衰减、互动效果、阶段、房间、商店物品 16 件）
- `js/i18n.js` — 中文文案 + `t()`
- `js/utils.js` — `$, escapeHtml, showToast, debounce, randId, clamp, confirm` 模态
- `js/dna.js` — 12 字符 DNA、`decodeDna/crossover/dnaToPrompt/dnaRarity`
- `js/storage.js` — PersonalPageStore 适配（`withWorkspace + readFile/createFile`）+ `memory.md/chat.log` 读写
- `js/api.js` — `genPetImage` (sdk.aiGenerators.genImage)、`chatWithPet` (sdk.aiChat.createSession.send)、`summarizeAndAppendMemory`
- `js/petTick.js` — 衰减 / 阶段升级 / 离线追溯 + `setInterval` 周期 tick
- `js/planetProgress.js` — 星球等级、星球天数、游玩时长、哈奇岛解锁条件计算
- `js/level_planet.js` — 宇宙层星球经营：设施、天气、星际拜访、UFO、星象、里程碑、哈奇岛入口
- `js/level_field.js` — 星球地表三生态、户外摆放、生物燃料、天气视觉承接
- `js/view_login.js` 等 9 个视图模块

## 重要决策

1. **PersonalPageStore API 修正**：实际接口使用 `withWorkspace(name)` 后的文件读写能力。MagicHaqi 数据以 JSON / 文本文件存储在 workspace 中。
2. **memory.md 路径**：`pets/<petId>.memory.md`，使用 `createFile(path, content)` 覆盖写。
3. **DigitalHuman 仅在用户点击「语音对话」按钮时实例化**，关闭时调用 `destroy/stop/setActive(false)` 兜底。
4. **付费状态**：默认 false；设置页提供「开发者：VIP 模式」开关，本机切换。
5. **装饰模式**：采用「点选物品 → 点格子放置」交互，避开移动端 HTML5 拖拽兼容问题。
6. **宠物漫步**：通过 4.5s 定时改变 `left/top`，CSS transition 动画。装饰模式下暂停。
7. **宇宙层升级为星球经营入口**：`level_planet.js` 负责设施建造 / 升级和所有 Level 0 行为，避免把经营逻辑散落到 `view_home.js`。
8. **星球状态写入 user profile**：`biofuel`、`planetWeather`、`planetBuff`、`planetVisitors`、`planetActions`、`planetInfrastructure` 与 `planetCreatedAt` / `totalPlayMs` 一起持久化，保证刷新后天气、buff、冷却和设施不丢失。
9. **星球 CSS 拆分**：原入口内联的大段 `planet` / `field` 样式移到 `css/planet.css` 和 `css/field.css`，入口 HTML 仅保留全局主题和通用组件样式。

## 新增星球经营实现摘要

| 模块 | 实现点 |
|------|--------|
| 设施系统 | `weatherTower`、`spaceport`、`ufoPad`、`observatory`，建造 / 升级费用由 `PLANET_INFRASTRUCTURE` 定义，最高 Lv.3 |
| 天气系统 | 雨云 / 晴光 / 季风，使用 `planetWeather.until` 控制过期；天气塔等级改变持续时间和冷却；雨云会给 `field_land` 追加植物 |
| 星际拜访 | 星球 Lv.2 解锁，依赖航天站；消耗生物燃料，奖励金币并提升心情 / 亲密度 |
| UFO 访客 | 星球 Lv.3 解锁，依赖停机坪；每日一次，奖励背包物品，停机坪等级决定数量 |
| 星象校准 | 依赖观星台；每日一次，启用 `planetBuff`，并在 `petTick.applyDecay()` 中影响衰减 / 恢复 |
| 里程碑 | 展示 `computePlanetProgress()` 的等级、下一等级进度、星球天数、宠物数量、成年宠物卫星数和最近事件 |
| 哈奇岛 | `computePlanetProgress().canVisitHaqiIsland` 控制入口锁定；满足条件后弹出下载页面 |

## 已知开放问题

- `aiChat.createSession` 的实际流式回调 API 取决于 SDK 版本；`view_chat` 通过 `onChunk` 回调 + 退化路径 `aiChat.chat()` 兼容两种形态。
- `summarizeAndAppendMemory` 依赖额外一次 LLM 调用，失败被静默捕获，不影响主对话。
- 所有图片均依赖云端 URL；如生成失败，宠物以阶段 emoji 回退展示，不阻塞养成。
- 商店家具图标使用 emoji 占位，无需额外图片资源。
- 未提供 `assets/` 静态资源（emoji 已能覆盖）；如后期需要专属 SVG 可补 `assets/icons/`。
- 星球经营的完整验证依赖浏览器手动操作，尤其是天气过期 / 冷却、每日 UFO / 星象限制、雨云生成地表植物后的布局保存。

## 验收回归点

- 入口 HTML 加载 SDK → 出现登录界面，无 console error。
- 登录成功 → 显示宠物列表（空态）。
- 孵化：随机 DNA → 输入名字 → 点击「AI 生成立绘」→ 等待 → 点确定 → 进入主家。
- 主家：状态条可见、互动按钮生效（属性变化、冷却提示）、房间 Tab 切换、装饰模式可放置背包家具。
- 商店：金币足够时购买 → 进入背包 → 切到家具页 → 进入装饰模式可放置。
- 聊天：发送消息 → 等待流式回复 → 控制台无报错；profile 页可看到追加的 memory。
- 设置：切换 VIP → 聊天页可显示语音入口；点击实例化 DigitalHuman（依赖 SDK 是否暴露 `window.DigitalHuman`）。
- 宇宙层：建造天气塔 / 航天站 / UFO 停机坪 / 观星台后，星球表面出现对应设施图标；资源不足时 toast 提示。
- 天气：召雨 / 晴光 / 季风遵守等级解锁与冷却；宇宙层和地表层都出现天气效果；刷新后未过期天气仍显示。
- 星际拜访：消耗生物燃料，获得金币，宠物心情 / 亲密度提升，最近事件中出现拜访记录。
- UFO：同一天只能领取一次；奖励进入背包；刷新后每日标记不丢失。
- 星象：同一天只能校准一次；buff chip 显示在宇宙层；衰减 tick 会应用 buff 修正。
- 刷新页面：宠物 / 金币 / 布局保留。
