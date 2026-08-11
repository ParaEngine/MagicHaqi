# 蛋蛋星球 MagicHaqi —— 技术架构

> 最近一次校准：2026-06-21。本文档已对照实际代码（`js/` 约 58 个文件、~49k 行）重写，
> 与早期版本相比补全了被遗漏的约一半子系统（迷你游戏、剧情、造游戏、百科、星际旅行、
> 星球定居、地形、声音、动画、Agent 层、拍照/明信片/邮箱等），并如实记录了
> 「设计意图」与「当前实现」之间的差异（见 §3 分层与 §13 架构债）。

MagicHaqi 是一款移动优先的 H5 虚拟养成游戏：纯 ES Module + 原生 JS，直接在浏览器运行，
由 KeepworkSDK 提供登录、存储、AI 立绘、AI 对话能力。**没有应用后端** —— 线上网页本身就是 API。

---

## 1. 加载与运行模型

- 入口 `MagicHaqi.html`：仅 CDN 引 Tailwind + 4 个 CSS（`pet/planet/field/cell.css`），
  末尾一段内联 `<script type="module">` 计算 `--mh-app-scale`（视口自适应缩放），然后
  **`await import('./js/app.js')`** —— 整个应用只有这一个静态入口。
- **`app.js` 静态导入**核心层 + 主路径视图（utils/config/state/storage/petTick/dna/i18n/
  pet/petLifecycle/soundManager/agentBridge + login/petList/hatch/home/shop/inventory/profile/
  help/terrainFields/starSettlements 等）。
- **重量级 / 低频视图按需 `import()` 懒加载**（在 `app.js` 内用 promise 缓存）：
  `view_minigames`、`view_mailbox`、`view_email`、`view_story_player`、`view_story_maker`、
  `view_game_maker`、`view_encyclopedia`、`view_dev_console`、`view_chat`、`view_settings`、
  `view_hatching` 等。这是有意的代码分割：避免把数百 KB 的造游戏 / 剧情编辑器塞进首屏。
- 无构建步骤、无测试套件、无 lint。`npm run build` / `vite build` **仅供人工**做 CDN 发布打包
  （`dist/`、`release/`、内容哈希 CDN 目录），开发与验证**绝不**运行。验证方式：浏览器
  直接打开 `MagicHaqi.html`（VS Code Live Preview）。

---

## 2. 目录结构（现状）

```
MagicHaqi/
  MagicHaqi.html            # 唯一入口（Tailwind + 主题 + #app + 单点 import app.js）
  css/  planet.css field.css pet.css cell.css   # 按 zoom 层拆分
  js/
    # —— 核心层 ——
    app.js                  # 编排器：SDK 引导、路由表（21 路由）、全局事件、所有 handler
    state.js                # 单一内存状态源 + mutate/notify/subscribe + 经济入口(addCoins/addBiofuel)
    config.js               # 常量（房间、属性范围、繁殖、商店、4 级 zoomLevels、fields、星球配置）
    storage.js              # PersonalPageStore 适配层（pets/profile/inventory/layouts/memory/log…）
    api.js                  # AI 封装：DNA→prompt、genImage、aiChat、buildPetSystemPrompt
    utils.js                # $, escapeHtml, showToast, confirm, prompt, randId, clamp…
    i18n.js                 # zh-CN/en 文案字典 + t()（≈ 90% 是数据，见 §13-D）
    dna.js                  # DNA 编码/解码/交叉/突变/DNA→外观特征
    generationPrompts.js    # 立绘 / 场景 / 造游戏的 LLM prompt 模板
    soundManager.js         # BGM / SFX / MIDI 合成 / 音频上下文解锁（单例）
    particleEffects.js      # 通用粒子（雨雪、星火、彩纸…）
    planetProgress.js       # 星球里程碑 / 解锁计算 + 游玩时长累计
    # —— 宠物簇 ——
    pet.js                  # 立绘渲染、sprite 动画、互动序列、立绘生成与缓存（2.8k 行）
    petLifecycle.js         # 宠物位置（本星球/放生/哈奇岛/远征）、自托管/保姆/上限
    petTick.js              # 状态衰减 / 阶段成长 / 生病 / 离线追溯（30s tick）
    petInteractions.js      # 喂/洗/睡/摸 动画序列
    petSheetWorker.js       # Web Worker：sprite sheet 去背处理
    # —— 四级 Zoom Dial（见 §6）——
    level_planet.js         # L0 🌌 宇宙：星球经营、设施、天气、拜访、UFO、星象、里程碑
    level_field.js          # L1 🪐 星球地表：陆/水/空生态、户外家具、💩→⛽、地形
    level_pet.js            # L2 🐾 宠物：房间、8×6 装饰网格、漫步、互动按钮
    level_cell.js           # L3 🧬 细胞：体内观察、DNA 食性、蛋阶段许愿
    # —— 视图（≈ 40 个 view_*.js，详见 §5 路由表 + §4 子系统）——
    view_login / view_petList / view_hatch / view_hatching / view_home / view_shop /
    view_inventory / view_profile / view_help / view_settings / view_chat /
    view_minigames / view_game_maker / view_game_maker_settings /
    view_story_list / view_story_maker / view_story_player / view_story_scene_maker /
    view_encyclopedia / view_spacetravel(+spacetravel.js) / view_star_settlements /
    view_terrain_fields(+terrain_field_slots.js) / view_takephoto / view_postcard /
    view_mailbox / view_email / view_dev_console / view_ops_console
    visit_animations.js     # 星际拜访的电影化动画序列
    # —— Agent 层（页面即 API，见 §9）——
    agentBridge.js  agentAudit.js
    wxShare.js              # 微信分享
  agents/                   # pet-master（随包发给玩家的共育 skill）/ haqi-operator（运营 agent）
  minigames/                # 31 个独立 HTML 小游戏 + _minigame_index.json
  pet-story/                # 剧情 JSON + 场景预设
  famous-pets/ famous-planets/  # 内容索引 JSON（由 dev_tools 生成）
  dev_tools/                # 14 个独立 HTML 生成器（宠物/星球/场景/商店/百科/造游戏…）
  miniprogram[-haqi|-maisi|-eggyplanet]/  # 微信小程序壳（指向线上 H5）
  docs/                     # 本目录（architecture/design/dev_guide/userguide/business-plan…）
```

---

## 3. 数据 / 状态 / 事件流 与 分层（意图 vs 现实）

**单一可信源 + mutate 即渲染。** 理想数据流：

```
view_*.js (DOM 事件) ─┬─▶ 回调 → app.js handler ─▶ state.mutate*() ─▶ storage.save()(去抖) ─▶ render(currentView)
                      └─（实际上：部分功能视图直接 import storage.js / 调 sdk，见下）
```

- **`state.js` 是单一内存可信源**：导出 `state` 对象 + `notify()` / `subscribe()` / `setView()` /
  `setCurrentPet()` / `mutatePet()` / `setZoomLevel()` / `addCoins()` / `addBiofuel()` /
  `getActivePlanetWeather()` / `getActivePlanetBuff()` / 拜访模式等。订阅者在每次 `notify()`
  时重渲染当前视图。
- **`app.js` 是编排器**：持有 21 条路由表、SDK 引导、几乎所有 `handle*` 业务 handler。
- **`storage.js` 是唯一持久化适配层**，封装 `sdk.personalPageStore`，写操作内部去抖（~1s）。

### 分层的「设计意图」

> 视图模块只渲染 + 绑定事件，**不**直接读 `storage`、**不**直接调 SDK；通过回调把意图交回
> `app.js`。状态写入只走 `state.js` 的 mutate 函数（含 `addCoins/addBiofuel` 等经济入口）。

### 分层的「当前现实」（如实记录，便于收敛）

这条规则对**核心养成主路径**（home / 互动 / 商店 / 背包 / 喂养）基本成立，但在后来生长出的
**自包含功能视图**上已被普遍突破，属于已知架构债（§13）：

- **~18 个 `view_*.js` 直接 `import './storage.js'`**：minigames、game_maker、story_*、mailbox、
  encyclopedia、spacetravel、star_settlements、terrain_fields、postcard、chat、home、petList…
- **~11 个 `view_*.js` 直接调 `sdk.*` / `state.sdk.*`**：game_maker（`aiChat`/`copilotTools`/
  `aiGenerators`）、story_maker、minigames、mailbox（`socialFriends`）、postcard、spacetravel、
  email、settings…
- **`level_*.js` 直接写 `state.coins` / `state.biofuel` / `state.planetWeather` 等**，绕过 §state.js
  的经济/状态入口（例如 `level_planet.js spendCost()` 用 `refreshTopbarResources()` 而非 `notify()`）。

**事实结论**：当前**事实上的**分层是「核心薄编排 + 功能视图自治」。后续要么把它收敛回严格分层
（见 §13 的 facade 方案），要么显式承认「功能视图可自治持久化/AI，但必须经由命名的 service 模块
而非散落直连 SDK」。本文档选择**如实标注**，避免文档继续与代码脱节。

---

## 4. 子系统地图（核心养成之外）

| 子系统 | 入口 | 规模 | 集成方式 |
|--------|------|------|----------|
| 迷你游戏 | `view_minigames.js` + `minigames/*.html`(31) + `_minigame_index.json` | 2.5k 行 + 资源 | 路由 `minigames`（懒加载）；iframe `postMessage` 协议（取宠物图/读写 profile/上报奖励）；`handleMinigamePetMessage` / `pushActivePetConfigToFrame` |
| 剧情引擎 | `view_story_maker/player/list/scene_maker.js` + `pet-story/` | 4.6k 行 | 路由 `storyMaker/storyPlayer/storyList`（懒加载）；JSON 存于 PersonalPageStore；可解锁/领养宠物；AI 生成场景背景与粒子 |
| 造游戏（AI vibe-coding）| `view_game_maker.js`(3.5k) + `view_game_maker_settings.js` | 4.5k 行 | 路由 `gameMaker`（懒加载）；`sdk.aiChat`(modId `magichaqi-game-maker`) + copilot 文件工具；会话历史存 IndexedDB；产物存 `pet-games/<id>.html` |
| 百科（动物园领养）| `view_encyclopedia.js` | 385 行 | 路由 `encyclopedia`（懒加载，仅当星球含 `encyclopediaUrl`）；答题解锁领养；进度存 `user/<planetId>.encyclopedia.json` |
| 星际旅行 | `view_spacetravel.js`(1.3k) + `spacetravel.js`(0.8k) | 2.1k 行 | 从 L0 触发；好友/官方元素星球访问、耗燃料、带回元素；`spacetravel.js` 是 L0 的飞行器交通 canvas 动画（Catmull-Rom 路径 + 透视深度）|
| 星球定居（多星球框架）| `view_star_settlements.js` | 573 行 | 路由 `starSettlements`；官方星球迁居 / 自定义家园；`applySettledOfficialPlanetFromProfile` / `applyTemporaryHomePlanetFromUrl`；按星球覆盖商店/地形/引导 |
| 地形场 | `view_terrain_fields.js` + `terrain_field_slots.js` | 648 行 | L1 户外摆放（区别于 L2 室内）；8 种地形（3 基础 + 5 元素，元素地形靠星际访问解锁）；按场景背景/粒子 |
| 拍照 / 明信片 / 邮箱 / 邮件 | `view_takephoto`/`view_postcard`/`view_mailbox`/`view_email.js` | 1.9k 行 | 路由 `postcard/mailbox/email`；canvas 双宠物合影；`sdk.socialFriends`（好友申请/邮件/已读）|
| 声音 | `soundManager.js` | 681 行 | 全局单例；Web Audio；BGM 淡入淡出、SFX、MIDI 合成；首交互解锁 |
| 拜访动画 / 粒子 | `visit_animations.js`(0.9k) + `particleEffects.js` | 1.2k 行 | 星际拜访的出发/到达/归来电影序列；剧情场景复用粒子 |
| 开发 / 运营控制台 | `view_dev_console.js`(1.1k) + `view_ops_console.js` | 1.3k 行 | localhost/开发者模式浮层（改属性/阶段/生病）；`?view=ops` 只读运营面板 |
| Agent 层 | `agentBridge.js` + `agentAudit.js` + `agents/` | 0.4k 行 | 见 §9 |
| 微信 | `wxShare.js` + `miniprogram-*/` | — | 分享；小程序壳指向线上 H5 |
| 内容生成器 | `dev_tools/*.html`(14) | — | 仅人工；产出 `famous-pets/`、`famous-planets/`、场景/商店/百科 JSON |

---

## 5. 路由表（`app.js` 实际 21 条）

```
login  petList  hatch  hatching  home  shop  inventory  profile  help
chat   minigames  terrainFields  starSettlements  postcard  mailbox  email
storyPlayer  storyMaker  gameMaker  settings  ops  encyclopedia
```

`render()` 按 `state.currentView` 查表执行对应 `renderX(app, data, callbacks)`。`home` 的回调最多：
`onAction / onSwitchRoom / onToggleDecor / onToggleFeed / onPlaceItem / onMoveItem / onRemoveItem /
onFeedItem / onFeedComplete / onNav / onTreatSickness`。其余视图各自传入 `onBack` + 少量业务回调。
懒加载视图（chat / minigames / hatching / story* / gameMaker / settings / email / mailbox / encyclopedia）
经 `renderXRoute` 包装：先 `await import()` 再渲染。

---

## 6. 四级 Zoom Dial（`level_*.js` + `view_home.js`）

`view_home.js` 是主舞台 **orchestrator**：维护 `state.zoomLevel ∈ [0..3]` 与连续相机距离 `cameraZoom`，
监听 滚轮 / 双指捏合 / 拖动，越过某层 `minCamera/maxCamera` 边界即 `setLevel(±1)` 并播放虫洞过渡
（过渡逻辑在 `view_home.js`，不在 level 模块内）。

每个 level 模块导出统一接口：`id`、`index`、`minCamera`/`maxCamera`、`enterFromAbove`/`enterFromInner`、
`stageHtml(pet)`、`dockHtml(pet)`、`bindStage(pet, ctx)`、`bindDock(pet, ctx)`、可选 `onEnter`/`onLeave`/
`onCameraChange`。新增层级：在 `LEVELS = [planetLevel, fieldLevel, petLevel, cellLevel]` 追加 +
在 `CONFIG.zoomLevels` 增加描述项。

| Level | 文件 | 功能 | 关键状态 |
|-------|------|------|----------|
| 0 🌌 宇宙 | `level_planet.js` | 星球经营：设施建造/升级、天气、星际拜访、UFO、星象 buff、里程碑、哈奇岛入口 | `planetName/Weather/Buff/Infrastructure/Actions/Visitors`、`computePlanetProgress()` |
| 1 🪐 星球 | `level_field.js` | 陆/水/空生态切换；户外家具 + 💩→⛽ 生物燃料；承接 L0 天气视觉；地形 | `currentField`、`pet.poops`、`getLayout(pet,'field_'+id)`、`biofuel`、`getActivePlanetWeather()` |
| 2 🐾 宠物 | `level_pet.js` | 5 房间、8×6 装饰网格、宠物 4.5s 随机漫步、5 个互动按钮 | `currentRoom`、`isDecorMode`、`getLayout(pet, roomId)`、`dominantTraits` |
| 3 🧬 细胞 | `level_cell.js` | 体内观察、DNA 食性提示、蛋阶段许愿 | `pet.wishPrompt`、`dnaDietPreference()` |

**星球经营闭环**（`level_planet.js`）：天气塔/天气、航天站/星际拜访、UFO 停机坪、观星台/星象、
里程碑、哈奇岛入口。星象 buff 影响 `petTick.applyDecay()`；雨云天气经 `growRainPlants()` 向
`field_land` 追加植物。

---

## 7. DNA 与繁殖（`dna.js`）

DNA = 12 字符 `[A-Z0-9]`，3 段（外观/属性/特殊）。`decodeDna` 每字符映射到中文特征；
`crossover(a,b)` 按段随机选父母段、每位 ~5% 突变；`dnaToPrompt` 拼 `genImage` prompt。
**DNA 与立绘生成刻意解耦**：DNA 先成功，立绘失败可后补重生。

---

## 8. 持久化模型

PersonalPageStore（workspace `MagicHaqi`），游戏数据不入 localStorage（localStorage 仅存
`magichaqi.lastView` 等 UI 偏好）：

- `pets/<id>.json` 宠物配置；`pets/<id>.memory.md`（8KB 上限，头部摘要轮转）；`pets/<id>.chat.log`。
- `user/profile.json` 共享状态：`petOrder`、`currentPetId`、`biofuel`、星球经营字段
  （`planetWeather/Buff/Infrastructure/Actions/Visitors/Mining/CreatedAt`、`totalPlayMs`）、
  成就/剧情进度/生涯统计/元素库存/拜访记录等。
- `user/inventory.json`（有序数组，旧 `{itemId:count}` 加载时迁移）、`user/layouts.json`。
- 功能子系统各自的文件：`pet-games/<id>.html`、`pet-stories/…`、`user/<planetId>.encyclopedia.json`、
  地形/场景配置等。
- `agent/audit.log`（agent 写审计）、`agent/ops-*.{json,log}`（运营 agent 状态）。
- 写操作经 storage.js 去抖合并；PersonalPageStore 自身约 5s 远端同步。

---

## 9. Agent 层（页面即 API）

AI 共育 agent 直接驱动**线上站点**而非 REST 后端，三条捷径：KeepWork 登录 REST → URL 导航 →
页内命令桥。

- `agentBridge.js`：`window.MagicHaqiAgent.exec(cmd)` / `getState()`；命令注册表复用既有视图回调 /
  `handleAction` / `storage` / `api`（不新增玩法）。隐藏 DOM 节点 `#mh-agent-cmd`(in) /
  `#mh-agent-result`(out) / `#mh-agent-state`(每次渲染刷新的快照)。
- 深链：`?token=` `?adopt=1` `?agent=<id>`（绑双 owner）`?cmd=<urlencoded>` `?view=ops`。
- `agentAudit.js`：写操作记 `agent/audit.log`。`view_ops_console.js`：`?view=ops` 人工兜底面板。
- `agents/`：`pet-master/`（发给所有玩家的共育 skill）、`haqi-operator/`（开发者 24/7 一人公司运营 agent）。

---

## 10. 聊天 / 数字人

`aiChat.createSession({ systemPrompt: buildPetSystemPrompt(pet, memoryText), modId:'magichaqi',
chatId: pet.id })` 复用历史。每轮结束 `summarizeAndAppendMemory()` 用一次轻量 LLM 产 1–2 行中文要点写入
memory.md（8KB 上限，超出头部摘要轮转）。付费语音：仅当 `state.isPaid` 时显示，点击时实例化全屏
`new DigitalHuman(...)`，离开聊天页 `dh.destroy?.()`。

---

## 11. 复用 / 风格 / 约定

- 复用 AIMovieMaker 视觉规范：CSS 变量主题、`.btn-primary`/`.btn-secondary`/`.modal-input`/
  `.card-flat`/`.toast-*`/`.fade-in`。
- 儿童向暖色：`--accent:#f59e0b`、`--bg-base:#fef3c7`（默认浅色，夜间可选）。
- 所有玩家可见文案走 `i18n.js` 的 `t()`；CSS 按 zoom 层拆分。
- 装饰用「点选物品 → 点格子」而非 HTML5 拖拽，保证移动端可靠。布局存 `[{itemId,x,y,w,h}]`。

---

## 12. 风险与对策

| 风险 | 对策 |
|------|------|
| `genImage` 慢/失败 | spinner + 占位图 + 重试；DNA 与立绘解耦 |
| PersonalPageStore 配额 | memory.md 8KB 上限；图片只存 URL；布局用紧凑数组 |
| 移动端拖拽 | 点选-放置代替 HTML5 drag |
| 数字人资源 | 仅点击时实例化，离开 `destroy` |
| 离线衰减过猛 | 单次 tick 衰减封顶（~24h 等价）|
| 快速切视图的资源泄漏 | 见 §13-E（模块级 dh/计时器/缓存清理不一致）——已知债 |

---

## 13. 架构债登记（按优先级，供后续迭代收敛）

> 由一次全量审计得出，均带 `file:line` 级证据；这里给收敛方向，不在文档里夸大已完成度。

- **A. `app.js` 上帝对象（2838 行）** —— 路由 + SDK 引导 + 登录 + 宠物生命周期 + 装饰/背包 +
  生病 + 商店 + 剧情/迷你游戏管线全塞一处。方向：抽 `petActions.js` / `shopHandler.js` /
  `storyHandler.js`，`app.js` 退回薄路由 + 引导。
- **B. `view_game_maker.js` 上帝文件（3500 行）** —— AI 流式、copilot 文件工具、IndexedDB 历史、
  markdown 渲染、模型选择、UI 混在一个 render。`sdk.aiChat`/`aiGenerators` 双分支 ~90% 重复
  （2707 vs 2738）。方向：抽 `GameMakerSession` + 复用 `StreamAggregator`/`ToolEventRecorder`。
- **C. `view_home.js` 相机/动画的 ~22 个模块级可变量** —— `cameraZoom/visualCameraZoom/
  __cameraAnimFrame/__levelCache(Map)/__dockScrollPositions(Map)…` 散落模块作用域，计时器清理分散。
  方向：抽 `CameraController` / `LevelPreRenderer` 类，render 只委派。
- **D. 分层突破（§3）** —— ~18 个视图直 `import storage.js`、~11 个直调 `sdk.*`。方向：
  建 `storage-facade`（只读再导出 + 写操作收口 app.js 回调）与 `sdk-facade`（归一化错误码、收 SDK
  版本分支），逐步迁移；或显式承认「功能视图自治但必须经命名 service」。
- **E. 经济/复杂状态绕过 `state.js` 入口** —— `level_*.js` 直接写 `state.coins`/`state.biofuel`/
  `state.planetWeather`/`state.planetBuff`/`state.activePetFieldPose`。`state.js` 已有 `addCoins`，
  2026-06-21 已补**对称的 `addBiofuel(n)`**（钳制 >=0 + notify，§state.js:100）作为唯一增减入口。
  **已迁**（2026-06-21）：`view_spacetravel.js` 的 4 处 `biofuel` 扣减改走 `addBiofuel(-fuelCost)`
  并删去其后冗余的 `notify()`（notify 次数与终态不变，行为等价）。
  **仍待办（需运行时验证，未机械改写）**：
  - `level_field.js:2161/2381`：是 `biofuel` 增益，其后紧跟 `playPoopGlitchWind()` / 音效等 DOM 动画，
    `addBiofuel` 注入的 `notify()` 重渲染可能使其后捕获的 DOM 引用失效——需开游戏验证收便便动画后再迁。
  - `level_planet.js:238 spendCost()`：刻意用 `refreshTopbarResources()` 而非 `notify()` 以避免整屏重渲染，
    `addBiofuel` 会引入 `notify()`，改变行为——保持裸写，或为其加一个不 notify 的变体。
  - 同理 `state.coins` 裸写散落 `app.js/level_*/view_hatch/view_petList`，可分批迁到 `addCoins`（同样逐点验证 notify 上下文）。
  同理可补 `setPlanetWeather/Buff`、`setActivePetFieldPose` 等 setter。
- **F. `i18n.js` ~2.5k 行约 90% 是字典数据** —— 方向：外置 `i18n/zh.json`/`en.json` 懒加载，
  `i18n.js` 退回 ~200 行核心逻辑。
- **G. `pet.js`（2.8k）混渲染/动画/立绘生成/缓存** —— 方向：拆 `pet-render` / `pet-cache` /
  `pet-interaction`。
- **H. 各视图重复的 modal/toast/confirm（~269 处调用）** —— 方向：`ModalManager` /
  `NotificationQueue` + `confirmDanger/showError/showSuccess` 高层 helper，统一错误→toast 路径。
- **I. 持久化一致性不清** —— `saveUserProfileDebounced` / `savePetDebounced` /
  `saveFieldScenesDebounced` 散落多处，缺少「哪些 state 变更自动持久化」的明确规则。方向：在
  state.js 标注可持久化字段，mutate 时自动触发对应去抖保存，并在 CLAUDE.md 记录。

---

## 14. 偏离标准技术栈

无构建/无后端是有意为之（页面即 API）。唯二约定：装饰用点选-放置而非 HTML5 拖拽；重量级视图按需
`import()` 懒加载以控首屏体积。
</content>
</invoke>
