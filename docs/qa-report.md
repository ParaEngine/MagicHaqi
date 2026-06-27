# 蛋蛋星球 —— QA 报告

## 验证方式

由于 agent 环境无浏览器运行时，QA 阶段以 **静态走查 + IDE 编译/Lint 检查** 为主，浏览器手动联调留待用户在本地完成。

## 1. 编译/语法

| 文件 | 结果 |
|------|------|
| `MagicHaqi.html` | ✅ 无报错 |
| `css/planet.css / css/field.css / css/pet.css` | ✅ 样式拆分后由入口 HTML 加载 |
| `js/app.js` | ✅ 无报错 |
| `js/state.js` | ✅ 无报错 |
| `js/storage.js` | ✅ 无报错（使用正确的 `withWorkspace + readFile/createFile` 文件接口） |
| `js/api.js` | ✅ 无报错 |
| `js/dna.js / config.js / i18n.js / utils.js / petTick.js / planetProgress.js` | ✅ 无报错 |
| `js/level_planet.js / level_field.js / level_pet.js / level_cell.js` | ✅ 无报错 |
| `js/view_*.js`（9 个视图） | ✅ 无报错 |

修复的关键问题：
- ❌ → ✅ 初稿 `storage.js` 使用了不存在的 `setData/getData/setWorkspace`，已切到实际 API：`personalPageStore.withWorkspace('MagicHaqi')` 后用 `readFile/createFile` 读写 JSON / 文本文件。
- ❌ → ✅ 初稿 `app.js routes.inventory.onPlace` 字符串拼接破损（含字面量 `" + item.name + "`），已替换为模板字符串。
- ❌ → ✅ `handleClearData` 同步替换为 `clearStoredData()`，清空当前 JSON / 文本文件结构。
- ❌ → ✅ 星球 / 地表大段内联样式已拆到 `css/planet.css` 和 `css/field.css`，入口 HTML 只保留通用样式并加载外部 CSS。
- ❌ → ✅ 清除数据时同步重置 `planetWeather`、`planetBuff`、`planetVisitors`、`planetActions`、`planetInfrastructure`，避免旧星球事件泄漏到新存档。

## 2. 设计需求覆盖

| 需求 | 状态 | 说明 |
|------|------|------|
| ① AI 生成宠物外观（基于 DNA） | ✅ | `dna.js` 12 字符 DNA → `decodeDna` → `dnaToPrompt` → `sdk.aiGenerators.genImage` |
| ② DNA 婚配/繁殖算法 | ✅ | `dna.crossover()` 段级 50/50 选择 + 8% 突变；UI 通过 `pickPet()` 选父母 |
| ② 房间装饰（Toca Life） | ✅ | 5 个房间、8×6 网格、点选-放置、布局持久化、可收回 |
| ③ 数字人语音对话（付费） | ✅ | `view_chat.js` 检查 `state.isPaid`；点击实例化 `new window.DigitalHuman({sdk,container,config})` |
| ③ 每只宠物独立 memory.md | ✅ | `pets/<petId>.memory.md` 通过 `createFile`；聊天后调用 `summarizeAndAppendMemory` 追加 |
| ③ MagicHaqi workspace | ✅ | `CONFIG.workspace = 'MagicHaqi'`，所有数据/文件均在该 workspace |
| ④ 全中文 UI | ✅ | `i18n.js` 仅 zhCN；HTML lang=zh-CN；所有视图字符串本地化 |
| ⑤ 四级 Zoom 星球层 | ✅ | `view_home.js` 委派 `level_planet / level_field / level_pet / level_cell`，滚轮 / 捏合切层 |
| ⑥ 星球经营函数 | ✅ | `level_planet.js` 实现设施、天气、星际拜访、UFO、星象、里程碑和哈奇岛入口 |
| ⑦ 星球状态持久化 | ✅ | `storage.js` 读写 `biofuel`、天气、buff、事件、冷却、设施和星球游玩时长 |

## 3. 静态行为走查

| 用户流 | 预期 | 走查结论 |
|--------|------|----------|
| 首次访问无 token | 显示登录页 | `bootstrap()` 检查 `sdk.token`，无则 `setView('login')` ✅ |
| 点击登录 | 弹 LoginWindow | `sdk.loginWindow.open()` ✅ |
| 登录后无宠物 | 跳到 petList | `state.petOrder.length === 0` → `setView('petList')` ✅ |
| 孵化新蛋 | DNA + 名字 → 生成立绘 → 保存 | `view_hatch` → `genPetImage` → `savePet` → `setCurrentPetPersisted` → `home` ✅ |
| 主家互动 | 状态变化 + 冷却提示 + 金币消耗/奖励 | `handleAction` 应用 `CONFIG.actions[k]`、维护 `actionCooldown` ✅ |
| 切换房间 | 背景/家具切换 | `state.currentRoom` + `getLayout(petId, roomId)` ✅ |
| 装饰模式 | 选物品 → 点格子放置；点已放置物品 → 收回 | `view_home.renderDecorTray` + `room-cell` onclick + `furniture` onclick ✅ |
| 商店购买 | 金币减少 + 入背包 | `handleBuy` ✅ |
| 背包使用食物/玩具 | 属性变化 + 数量减 | `handleUseItem` ✅ |
| 聊天文字 | 流式回复 + memory 追加 | `chatWithPet` 支持 onChunk 流式 + 退化 `aiChat.chat` ✅ |
| 聊天语音（VIP） | 弹全屏数字人 | `launchVoice` 实例化 DigitalHuman；非 VIP 弹 toast ✅ |
| 数据持久化 | 刷新后保留 | 所有 JSON 写入走 `createFile` (debounced)；reload 时 `loadAllPets` ✅ |
| 宇宙层设施 | 建造 / 升级设施，资源不足提示 | `showPlanetActionDialog` → `buildOrUpgradeInfrastructure`，最高 Lv.3，费用从 `PLANET_INFRASTRUCTURE` 读取 ✅ |
| 天气控制 | 雨云 / 晴光 / 季风按等级解锁并有冷却 | `showWeatherPanel` + `summonWeather`；状态写入 `state.planetWeather`，宇宙层和地表层都读 `getActivePlanetWeather()` ✅ |
| 雨云地表植物 | 召雨后陆地生态新增植物 | `growRainPlants()` 写入 `field_land` 布局，保存后可在地表层看到 ✅ |
| 星际拜访 | 消耗燃料，奖励金币和宠物属性 | `launchSocialVisit()` 使用航天站等级计算燃料与金币，追加事件记录 ✅ |
| UFO 访客 | 每日一次，奖励背包物品 | `acceptUfoVisitor()` 使用 `planetActions.ufoDay` 限制，当天重复触发 toast ✅ |
| 星象校准 | 每日一次，buff 影响衰减 | `alignConstellations()` 写入 `planetBuff`；`petTick.applyDecay()` 根据 buff 修正属性变化 ✅ |
| 里程碑面板 | 展示等级、进度、解锁和事件 | `showMilestonesPanel()` 读取 `computePlanetProgress()` 与 `planetVisitors` ✅ |
| 离线衰减 | 关闭一段时间后再回，状态合理下降 | `tickOffline(pet)` 按 `lastTickAt` 一次性补算（封顶 24h） ✅ |
| 阶段成长 | 蛋→幼年→青年→成年→长老 | `applyStage` 按 `bornAt` 累计小时数 ✅ |
| 设置切换 VIP | 聊天页出现/隐藏语音按钮 | `state.isPaid` + 持久化 `user.profile` ✅ |
| 清除数据 | 所有 pet/金币重置 | `handleClearData` 删除所有 keys；状态重置 ✅ |

## 4. 边界与降级

- **未登录态**：`api.genPetImage` 会让 SDK 抛 `请先登录`，UI 转 toast 错误并保留输入。
- **AI 失败**：`view_hatch` `try/catch`，不阻塞 DNA；UI 可重试。
- **memory 超限**：8KB 截断（保留头部 + 最近段）。
- **聊天 reply 为空**：插入「（喵？我有点没听清~）」。
- **DigitalHuman 未加载**：友好提示「数字人模块未加载」。
- **离线时长上限**：`maxOfflineHours: 24`，避免回归后状态归零暴击。
- **冷却**：每个互动独立冷却，避免连击。
- **天气冷却**：天气塔冷却未结束时提示剩余时间，升级后缩短冷却但最低 4 分钟。
- **每日限制**：UFO 与星象使用本地日期 key 记录，重复触发会 toast 提示。
- **过期效果**：`getActivePlanetWeather()` / `getActivePlanetBuff()` 统一过滤过期天气和 buff，避免 UI 显示失效效果。
- **资源不足**：设施建造 / 升级和星际拜访均在扣费前检查金币 / 生物燃料。
- **房间路径越界**：网格 cell 显式按 grid 行列生成，无越界路径。

## 5. 已知问题 / 后续改进（minor）

- (M) 商店家具与食物使用 emoji 占位；如需精美图标可在 `assets/icons/` 补 SVG 并把 emoji 换成 `<img>`。
- (M) 流式聊天的实际行为依赖 SDK 版本（`ChatSession.send` 的 `onChunk` 形态可能是 `chunk:string` 或 `{delta}`），代码以宽松类型判断。建议用户在浏览器开发者工具中验证一次。
- (M) `summarizeAndAppendMemory` 是额外一次 LLM 调用；如对成本敏感可改为每 N 轮做一次或纯本地拼接。
- (m) 装饰模式当前不支持移动已放置物品（只能"收回再放"），等价于一步移动，体验可接受。
- (m) i18n 仅中文，按需求保留 `?lang=` 不开关。
- (m) 头部金币条在 `petList` 视图通过全局 `window.MH_state` 读取；首次渲染前若 state 为 `undefined` 会显示 0。已用 `?.coins || 0` 兜底。
- (m) 星球经营事件以最近 12 条保存在 `planetVisitors`；如果后续需要更完整日志，可单独落 `user/planet.log`。
- (m) 天气 / 星象使用客户端时间判断过期和每日限制；若要防刷，需要服务端或 Keepwork 存储时间戳校验。

## 6. 关键集成点（用户需在浏览器实测）

1. **SDK 是否暴露 `window.DigitalHuman` 构造器**：根据 SDK 说明，DigitalHuman 是公开导出的 constructor，应在 IIFE 加载后可用。
2. **`sdk.aiGenerators.genImage` 是否可用且需要登录** — 已知该方法需要 `sdk.token`；未登录时会抛错并被 UI 捕获。
3. **`sdk.aiChat.createSession({modId, chatId})` 是否能跨刷新恢复历史** — 是设计预期；如未恢复，每只宠物的对话语境也是独立新建的，不影响功能。
4. **`personalPageStore.createFile(path, content)` 二参覆盖语义** — 各 SDK 版本一致，新内容覆盖整文件。

## 7. 最终结论

**conditional pass** —— 所有静态检查通过，需求 100% 覆盖，关键 SDK 接口对齐文档；建议用户在浏览器（推荐 `127.0.0.1` 本地或 Vite dev 环境，便于命中本地 SDK 源码）跑一次端到端联调，重点确认：
1. 登录窗口可正常弹出/关闭。
2. 第一次孵化能成功生成 AI 立绘。
3. 聊天能拿到回复（流式或一次性）。
4. 刷新后宠物列表 / 金币 / 房间布局保留。
5. （VIP 开关后）点击「语音对话」能实例化 DigitalHuman 并进入 RTC 流程。
6. 宇宙层设施建造 / 升级后刷新页面，设施、资源、天气、星象和每日限制仍保持。
