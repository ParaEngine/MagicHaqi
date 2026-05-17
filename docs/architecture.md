# 魔法哈奇 MagicHaqi —— 技术架构

## 1. 目录结构

```
MagicHaqi/
  MagicHaqi.html          # 入口（Tailwind + 主题 + #app 容器 + SDK 引导）
  css/
    planet.css            # Level 0 宇宙 / 星球经营 / 哈奇岛弹窗样式
    field.css             # Level 1 星球地表 / 天气 / 户外摆放样式
    pet.css               # 宠物 sprite 与通用宠物视觉样式
  js/
    app.js                # 启动、SDK 初始化、路由、全局事件
    config.js             # 常量（房间列表、属性范围、繁殖参数、商店配置、4 级 zoomLevels、fields、cellGame）
    state.js              # 全局内存状态（user, currentPet, currentView, zoomLevel, currentField, planetWeather, planetBuff, planetInfrastructure 等）
    storage.js            # PersonalPageStore 适配层（pets CRUD, memory.md, layouts）
    api.js                # AI 封装：DNA→prompt、genImage 调用、aiChat 包装
    utils.js              # $, escapeHtml, showToast, randId, formatTime
    dna.js                # DNA 编码 / 解码 / 父母交叉 / 突变 / DNA→外观特征
    petTick.js            # 状态衰减 / 阶段升级 / 离线追溯
    i18n.js               # zh-CN 文案 + t() 函数
    icons.js              # 极小型内联 SVG 模板字符串（状态图标）
    level_planet.js       # Level 0 — 🌌 宇宙：星球经营、设施建造、天气、拜访、UFO、星象、里程碑
    level_field.js        # Level 1 — 🪐 星球：陆/水/空 三生态 + poop→⛽ + 户外家具摆放 + 天气承接
    level_pet.js          # Level 2 — 🐾 宠物：经典房间互动 + 8×6 网格装饰 + 漫步
    level_cell.js         # Level 3 — 🧬 细胞：生病时点击坏细胞治疗的迷你游戏
    view_login.js
    view_petList.js
    view_hatch.js
    view_home.js          # 主舞台 + 房间切换 + 装饰模式（最大模块）
    view_shop.js
    view_inventory.js
    view_chat.js          # 文字 + 付费语音入口
    view_profile.js
    view_settings.js
  assets/
    icons/                # SVG 图标（status_*.svg, action_*.svg）
    images/
      rooms/              # 5 张房间背景
      furniture/          # 家具图标占位 PNG（可后续替换）
    audio/
      bgm.mp3
      sfx_click.mp3
      sfx_eat.mp3
    data/
      furniture.json      # 家具定义表
      shop_items.json     # 商店物品
      dna_traits.json     # DNA 字段→中文特征映射
  docs/
    design.md
    architecture.md
    code-plan.md
    qa-report.md
```

## 2. 数据 / 状态 / 事件流

```
DOM (view_*.js) ──事件──▶ state.mutate*()  ──▶ storage.save()  ──▶ PersonalPageStore (debounced)
                                  │
                                  ▼
                          render(currentView)
```

- **state.js** 是单一可信源。导出 `state` 对象 + `setView(name)`、`setCurrentPet(id)`、`mutatePet(fn)`、`subscribe(fn)`。
- 星球经营状态也保存在 `state.js`：`planetWeather`（当前天气及过期时间）、`planetBuff`（每日星象 buff）、`planetVisitors`（最近事件；挖矿与成就领取只作即时提示，不持久化）、`planetActions`（冷却 / 每日标记）、`planetInfrastructure`（设施等级）、`haqiIslandFarewells`（哈奇岛成人礼告别记录）。`getActivePlanetWeather()` / `getActivePlanetBuff()` 负责过滤过期效果。
- **storage.js** 提供 `loadAll() / savePet(pet) / deletePet(id) / loadPetMemory(id) / appendPetMemory(id, text)`，使用 `sdk.personalPageStore`，写操作内部去抖 (1s)。
- **app.js** 持有路由表 `{ login, petList, hatch, home, shop, inventory, chat, profile, settings }`，每个视图调用 `view_*.render(panel, data, callbacks)`。
- **petTick.js** 每 30s tick 一次，离线时按时间差一次性补算。

## 3. KeepworkSDK 表面

| 用途 | 调用 |
|------|------|
| 登录 | `sdk.token` 检查 → `sdk.loginWindow.open()` |
| 当前用户 | `await sdk.getCurrentUser()` |
| 持久化 | `sdk.personalPageStore.withWorkspace('MagicHaqi')` 后用 `readFile/createFile/replaceStringInFile` 读写 JSON / 文本文件 |
| AI 立绘 | `sdk.aiGenerators.genImage(prompt, { width:1024, height:1024 })` |
| 文字对话 | `sdk.aiChat.createSession({ systemPrompt, modId:'magichaqi', chatId: petId })` |
| 数字人语音 | `new DigitalHuman({ sdk, container, config:{ avatarUrl, systemPrompt } })` |
| 遥测 | `sdk.remoteLog?.track('event', ...)` |

## 4. 持久化方案

- **PersonalPageStore (workspace=`MagicHaqi`)**:
  - JSON 文件: `pets/<id>.json`, `user/profile.json`, `user/layouts.json`, `user/inventory.json`。
  - 宠物 ID 顺序和当前选中宠物合并保存在 `user/profile.json` 的 `petOrder` / `currentPetId` 字段中。
  - 背包物品与显示顺序保存在 `user/inventory.json` 的有序数组中；旧版 `{ itemId: count }` 背包文件会在加载时兼容。
  - 星球共享状态合并保存在 `user/profile.json`：`biofuel`, `planetWeather`, `planetBuff`, `planetVisitors`（不含挖矿 / 成就领取临时事件）, `planetActions`, `planetInfrastructure`, `planetCreatedAt`, `totalPlayMs`。
  - 文本文件: `pets/<petId>.memory.md`, `pets/<petId>.chat.log`。
- **localStorage**: 仅缓存 `magichaqi.lastView` 等 UI 临时偏好。
- 写操作经 storage.js 内的 debounce 合并；PersonalPageStore 自身 5s 远端同步。

## 5. 视图模块清单

| 模块 | 关键函数 | 回调 |
|------|----------|------|
| `view_login.js` | `renderLogin(panel, _, {onLogin})` | `onLogin` |
| `view_petList.js` | `renderPetList(panel, {pets}, {onSelect, onHatch, onBreed})` | 选中宠物 / 进入孵化 / 繁殖 |
| `view_hatch.js` | `renderHatch(panel, {parents?}, {onCreated, onCancel})` | 创建完成→petList |
| `view_home.js` | `renderHome(panel, {pet}, {onAction, onSwitchRoom, onToggleDecor, onOpenShop, onOpenChat, onOpenProfile})` | 顶部状态栏、底部导航、宠物 sprite、装饰 grid |
| `view_shop.js` | `renderShop(panel, {coins, items}, {onBuy, onBack})` | |
| `view_inventory.js` | `renderInventory(panel, {items}, {onPlace, onBack})` | |
| `view_chat.js` | `renderChat(panel, {pet, isPaid}, {onSend, onStartVoice, onBack})` | 文字流式 + 付费语音 |
| `view_profile.js` | `renderProfile(panel, {pet, memoryText}, {onBack})` | |
| `view_settings.js` | `renderSettings(panel, {settings}, {onChange, onBack})` | |

每个视图模块严格只渲染 + 绑定事件，不直接读 storage / 不直接调 SDK；通过回调把意图交回 `app.js`。

## 6. DNA 算法（dna.js）

- DNA = 12 字符 `[A-Z0-9]`，分 3 组（外观/属性/特殊）。
- `decodeDna(str) → { species, color, eyes, ears, accessory, rarity, ... }`，每段字符 → 索引到 `dna_traits.json` 中的中文特征。
- `crossover(a, b)` 按段随机选父母段拼接，每位 5% 概率突变为新随机字符。
- `dnaToPrompt(dnaTraits)` 拼成 prompt: `"一只 {物种}，{颜色}毛，{眼睛}眼，{耳朵}耳，戴着{配件}，可爱卡通风格，纯色背景，全身像，正面"`。

## 6.5 四级 Zoom Dial 架构（level_*.js）

主舞台 `view_home.js` 是一个 **orchestrator**：维护 `state.zoomLevel ∈ [0..3]` 与连续相机距离 `cameraZoom`，并把渲染/交互完全委派给 4 个 level 模块。

```
view_home.js  (orchestrator)
  ├─ LEVELS = [planetLevel, fieldLevel, petLevel, cellLevel]
  ├─ 监听 滚轮 / 双指捏合 / 拖动 → 调整 cameraZoom
  ├─ 越过 level.minCamera/maxCamera 边界 → setLevel(±1) + 虫洞过渡
  └─ 调用 level.stageHtml / dockHtml / bindStage / bindDock / onEnter / onLeave
```

每个 level 模块导出统一接口对象：

| 字段 | 说明 |
|------|------|
| `id`, `index` | 标识与层级序号（0..3） |
| `minCamera` / `maxCamera` | 相机窗口；越过即切层 |
| `enterFromAbove` / `enterFromInner` | 从外层 / 内层进入时落位的相机距离 |
| `stageHtml(pet)` | 渲染舞台中央内容 |
| `dockHtml(pet)` | 渲染底部 dock 工具条 |
| `bindStage(pet, ctx)` / `bindDock(pet, ctx)` | 挂事件；`ctx` 提供 `zoomIn/zoomOut/dock/callbacks/selectedTrayItem` |
| `onEnter?` / `onLeave?` | 启停定时器（如 pet 漫步、cell 怪物刷新） |
| `onCameraChange?(zoom)` | 相机连续变化时的视觉微调 |

四个 level 概览：

| Level | 文件 | 功能 | 关键状态 / 资源 |
|-------|------|------|-----------------|
| 0 🌌 宇宙 | [level_planet.js](../js/level_planet.js) | 星空 + 单个旋转星球，色调由 `dominantTraits` 决定；星球设施建造 / 升级、天气、星际拜访、UFO、星象、里程碑、哈奇岛入口；放大→进入 field | `state.planetName`、`state.planetWeather`、`state.planetBuff`、`state.planetInfrastructure`、`state.planetActions`、`state.planetVisitors`、`computePlanetProgress()` |
| 1 🪐 星球 | [level_field.js](../js/level_field.js) | 陆 / 水 / 空 三生态切换；显示已摆放户外家具与 💩，点击 💩 收 ⛽；空地放置 dock 已选物品；承接宇宙层天气视觉与地表提示 | `state.currentField`、`pet.poops`、`getLayout(pet, 'field_'+id)`、`state.biofuel`、`getActivePlanetWeather()` |
| 2 🐾 宠物 | [level_pet.js](../js/level_pet.js) | 5 个房间切换、8×6 装饰网格、宠物精灵 4.5s 随机漫步、6 个互动按钮（喂/玩/洗/睡/学/治）、`isSick` 时治疗按钮 pulse 引导切下一层 | `state.currentRoom`、`state.isDecorMode`、`getLayout(pet, roomId)`、`dominantTraits` |
| 3 🧬 细胞 | [level_cell.js](../js/level_cell.js) | 体内场景；按 `CONFIG.cellGame` 在竞技场刷怪，点击恢复 health，达标后自动 zoomOut | `cellGame.targetHits/healPerHit`、`pet.stats.health` |

层间过渡由 `view_home.js` 的「虫洞动画」统一驱动（不在 level 模块内）；level 模块只关注本层渲染与交互。新增层级时：在 `LEVELS` 数组追加、在 `CONFIG.zoomLevels` 增加描述项即可。

### 6.6 星球经营系统（level_planet.js）

`level_planet.js` 目前包含 Level 0 的完整经营闭环：

| 功能 | 解锁 / 前置 | 资源与效果 | 持久化字段 |
|------|-------------|------------|------------|
| 天气塔 / 天气 | 建造 `weatherTower`；雨云 Lv.1、晴光 Lv.2、季风 Lv.4 | 建造 18 金币；天气默认持续 30 分钟、冷却 8 分钟；天气塔升级后持续 +10 分钟、冷却 -2 分钟（最低 4 分钟） | `planetInfrastructure.weatherTower`, `planetWeather`, `planetActions.weatherAt` |
| 航天站 / 星际拜访 | 星球 Lv.2 + 建造 `spaceport` | 默认消耗 3 生物燃料，奖励 6 金币并提升 mood / bond；升级后燃料降低、金币提升 | `planetInfrastructure.spaceport`, `planetVisitors` |
| UFO 停机坪 / UFO 访客 | 星球 Lv.3 + 建造 `ufoPad` | 每天一次；奖励食物 / 家具到背包；设施等级决定奖励份数 | `planetInfrastructure.ufoPad`, `planetActions.ufoDay`, `inventory`, `planetVisitors` |
| 观星台 / 星象校准 | 建造 `observatory` | 每天一次；启用每日星象 buff，升级提高属性倍率 | `planetInfrastructure.observatory`, `planetBuff`, `planetActions.astroDay` |
| 里程碑 | 无 | 展示星球等级、下一等级进度、解锁目标和最近事件 | 只读 `computePlanetProgress()` 与 `planetVisitors` |
| 哈奇岛入口 | 至少 1 只已孵化宠物且星球 Lv.3 | 打开客户端下载弹窗 | 只读 `computePlanetProgress().canVisitHaqiIsland` |

星象 buff 会影响 `petTick.applyDecay()`：贪食之月加快 hunger 衰减并补 mood，花园星座减缓 mood 衰减，明晰星轨缓慢增长 intel，潮汐双月缓慢恢复 clean / health。雨云天气还会通过 `growRainPlants()` 向 `field_land` 布局追加户外植物。

## 7. 装饰模式（view_home.js 内部）

- 房间使用 CSS Grid (8 列 × 6 行)，每格 ≈ `min(48px, 12vw)`。
- 切到装饰模式后，背包条出现在底部，可点选物品 → 点 grid 格子放置；放置后再次点击物品支持移动/删除。
- 布局存为 `[{ itemId, x, y, w, h }]`。
- 宠物 sprite 是绝对定位 `<img>`，使用 CSS transition + `setInterval` 随机改变目标坐标实现"漫步"。

## 8. 聊天 / 数字人

- `aiChat.createSession({ systemPrompt: buildPetSystemPrompt(pet, memoryText), modId:'magichaqi', chatId: pet.id })`，复用历史。
- 每轮回复结束后，调用 `summarizeAndAppendMemory(pet.id, userText, replyText)`：用一次轻量 LLM 调用产出 1–2 行中文要点，`appendPetMemory` 写入 memory.md（限制总长度 8KB，超过则首部摘要轮转）。
- 付费按钮：仅当 `state.user.profile.isPaid === true` 时显示「语音对话」。点击后渲染一个全屏数字人容器并 `new DigitalHuman({ sdk, container, config:{ characterName: pet.name, avatarUrl: pet.imageUrl, systemPrompt } })`，由其内部完成 RTC + TTS。

## 9. 复用 / 风格

- 复用 AIMovieMaker 的视觉规范：CSS 变量主题、`.btn-primary` / `.btn-secondary` / `.modal-input` / `.card-flat` / `.toast-*` / `.fade-in` 动画。
- 主色调改为儿童向暖色：`--accent: #f59e0b`（橙），`--bg-base: #fef3c7`（暖米色，浅色为默认），夜间模式可选。
- 顶部 brand: 「魔法哈奇 🐾」。

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| `genImage` 慢 / 失败 | 显示 spinner + 默认占位图；失败提供"重试"按钮；DNA 生成与外观生成解耦（DNA 先成功，立绘失败可后补） |
| PersonalPageStore 配额 | memory.md 设 8KB 上限；图片只存 URL；家具布局用紧凑数组 |
| 移动端拖拽 | 装饰模式采用「点选 → 点目标格」而非真正拖拽，规避触屏 HTML5 drag 兼容问题 |
| 付费状态来源未定 | 暂用 `user.profile.isPaid` 标志，留一个开发者切换开关在 `view_settings.js`（仅本地） |
| DigitalHuman 资源加载 | 仅在用户点击语音按钮时实例化，离开聊天页时 `dh.destroy?.()` |
| 离线状态衰减过猛 | 单次 tick 衰减额封顶（最大 24h 等价） |

## 11. 里程碑（实现顺序）

1. 入口 HTML + 主题 + SDK 引导 + `#app`。
2. `utils.js` / `state.js` / `config.js` / `i18n.js` / `dna.js` 纯逻辑。
3. `storage.js` + `api.js` 接 SDK。
4. `view_login.js` → `view_petList.js` → `view_hatch.js`（端到端首条流）。
5. `view_home.js`（互动 + 房间 + 装饰）。
6. `view_shop.js` / `view_inventory.js`。
7. `view_chat.js`（文字 → 付费语音）+ memory.md。
8. `view_profile.js` / `view_settings.js`。
9. 资源数据（assets/data + 占位图标）+ 走查。

## 12. 偏离标准技术栈

无重大偏离。仅约定：装饰模式不使用 HTML5 拖拽 API，改为点选-放置以保证移动端体验。
