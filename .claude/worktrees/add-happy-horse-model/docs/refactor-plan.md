# MagicHaqi 重构路线图（god-file 拆分）

> 配套 `architecture.md` §13 架构债。本文件是把最大的几个 god-file 拆成可维护模块的**可执行计划**。
> 全部要求：**行为零变化**、**导入方零改动**（对外导出名/签名不变，必要时用 re-export 聚合）、
> 无构建步骤（原生 ES module，`node --check` 验证语法）、保持 **LF**（本仓库 Edit 易把 LF 翻成 CRLF，
> 改完务必 `grep -c $'\r' <file>` == 0，否则 `sed -i 's/\r$//'`）。每步后跑一遍对应冒烟测试。
> 各文件互不重叠 → 可并行（不同 agent 拥有不同文件，零冲突）。

风险分级与执行顺序建议：**先低风险（i18n）→ 中风险（pet.js、view_home 相机）→ 高风险（game_maker）**。

---

## 0. i18n.js 字典外置 —— 低风险（2026-06-21 执行中）

纯数据搬运，`t()` 仍同步。把 `zhCN` / `enUS` 两个巨型字面量搬到
`js/i18n/zh.js` / `js/i18n/en.js`（`export const`），`i18n.js` 顶部静态 `import` 回来，
`ALBUM_CAPTIONS_BY_LANG` 与全部逻辑/导出（`t/getLang/setLang/toggleLang/onLangChange/itemName/
planetName/localizeFieldName/localizeRoomName/getAlbumCaptions/SUPPORTED_LANGS`）原样保留。
静态 import 在任何代码运行前解析完毕 → 首个同步 `t()` 调用安全，无竞态。约 38 个导入方零改动。
**验收**：`node --check` 三文件；键数与改前基线一致
（`node --input-type=module -e "import('./js/i18n.js').then(m=>console.log(Object.keys(m.zhCN).length,Object.keys(m.enUS).length))"`）；
`m.t('login')` 返回非 key 字符串。i18n.js 应缩约 ~2300 行。

---

## 1. view_home.js 相机/过渡抽取 —— 中风险

把 ~22 个相机/手势/动画模块级可变量与其 RAF/定时器逻辑抽到 **`js/home_camera.js`** 的
`createCameraController(initialZoom, {minCamera, maxCamera})` 工厂里。

- **进控制器**（纯相机/手势状态）：`cameraZoom`、`visualCameraZoom`、`__cameraAnimFrame`、
  `__cameraLastFrameTime`、`__cameraRenderQueued`、`__wheelZoomDelta`、`__wheelZoomFrame`、
  `__cameraGestureActive`、`__cameraIdleReturnTimer`、`__wheelGestureEndTimer`、`__stageZoomWindowCleanup`，
  以及 `animateCameraZoom`、`flushWheelZoom`、`startCameraAnimation`、`stopCameraAnimation`、
  idle-settle 逻辑。
- **留在 view_home**（视图/过渡职责，非相机）：`runZoomTransition` 虫洞过渡、
  `__pendingZoomTransitionTimer`、`__sceneWipe*` canvas 擦除、`__companionMoodTimer`/`__companionMoodPendingTimers`、
  `__zoomBarHideTimer`、`__levelCache`/`__preRenderQueue`/`__dockScrollPositions`、菜单弹窗定时器。
- **控制器 API**：`onWheel(dy)`/`onPinch(from,to)`/`onDrag(dy)`/`setTargetZoom(z,dir)`/`settleToBestZoom()`/
  `startAnimation()`/`stopAnimation()`/`destroy()`；回调 `onRender(vZoom)`、`onLevelCrossing(dir,toLevel)`。
- **生命周期**：每次 `runZoomTransition` 切层时 `destroy()` 旧控制器、DOM 换好后建新控制器；
  `stopHomeWalk()` 里 `controller?.destroy()` 兜底清 RAF/定时器。
- **导出不变**：`renderHome(panel,{pet},callbacks)`、`stopHomeWalk()`（app.js 唯一导入方）。
- **执行顺序**：建空控制器→接 wheel→接 pinch/drag→接 idle-settle→接 boundary 切层→清理旧模块变量。
  每步冒烟：滚轮/捏合/拖动缩放、跨 4 层过渡、停手 2s 回弹、切视图再回 home 无僵尸定时器。

---

## 2. pet.js 拆分 —— 中风险

2.8k 行混了加载/缓存/渲染/睡眠/互动。拆成 3 文件 + `pet.js` 作 **re-export 聚合器**
（19 个导入方全部从 `./pet.js` 取，零改动）。

- **`js/pet-sleep.js`**（~180 行，最先做，零模块状态）：全部睡眠逻辑
  （`startPetSleep/wakePet/isPetSleeping/normalizePetSleepState/...` + 夜间/能量常量）。依赖 config、i18n。
- **`js/pet-cache.js`**（~450 行）：宠物加载与去重（`ensurePetLoaded/getPet/getPetAsync/getPetInfo`、
  `_petLoadInFlight`）、sprite sheet 生成与缓存（`getProcessedSheet/generatePetSheet/regeneratePetSheet/
  resetPetSheetImage`、`_processed`、`_rawSheetBlobCache`、`_defaultEggBlobPromise`、`_sheetWorker` 懒初始化）、
  图像 payload（`getPet[Egg]ImagePayload`，供迷你游戏 iframe）。
- **`js/pet-render.js`**（~1700 行）：DOM 挂载与动画
  （`petArtHtml/scanAndMount/mountPetArt/setAnim/setPetAnim/say/sayOnPet/playPetClickFeedback/playPetHappy/
  buildEggSvg/getPetSpriteCell/preloadPetAssets`）、`_animResetTimers`/`_mounted`/`_scanScheduled` 等渲染定时器、
  **RAF 循环 + `subscribe(_scheduleScan)` + MutationObserver 必须留此**（与渲染 tick 耦合）。
- **`js/pet.js`**（~30 行）：`export { ... } from './pet-*.js'` 聚合全部导出
  （含 petLifecycle.js 复用的 `canRecoverEnergyFromSleep/recoverEnergyAfterSleep`）。
- **不可机械搬**：`_sheetWorker`（`import.meta.url` 依赖→改懒初始化函数）、`_mounted`（键为 DOM 元素，
  与 `mountPetArt` 同模块）。冒烟：孵蛋→换宠物（动画重置）→喂养（happy）→入睡→petList 预加载。

---

## 3. view_game_maker.js 拆分 —— 高风险（需充分运行时验证，勿盲改）

3.5k 行 god-file。导出仅 `renderGameMaker` / `disposeGameMaker` 必须不变（app.js 懒加载使用）。
渲染闭包内的 `currentHtml/messages/generating/abortController/...El` **不可外移**（闭包契约）；
只抽**纯函数**与**跨渲染单例状态**。建议 `js/game_maker/` 子目录：

| 模块 | 内容 | 风险 |
|------|------|------|
| `constants.js` | `GAME_MAKER_MOD_ID/MODEL_KEY/...`、`EMOJI_OPTIONS` | 无 |
| `markdown_render.js` | `extractHtml/renderBasicMarkdown[Cached]/toolChipLabel/...` + `_mdCache` | 无（纯） |
| `ui_state.js` | `sessionHasContent/buildPriorHistoryMessages/parseInspireReply/...` | 无（纯） |
| `session_storage.js` | IndexedDB 历史 CRUD + `_localHistoryDB[Promise]` 去重 | 中（事务时序） |
| `model_cache.js` | `loadKeepworkModels/listChatModels/...` + `keepworkModelsCache[Promise]` | 中（SDK 回退） |
| `copilot_tools.js` | `seedFile/readWorkspaceHtml/installSingleFileTools` 改**工厂**注入 sdk/workspace | 中高（闭包） |
| `stream_aggregator.js` | 合并两处 ~90% 重复的流式分支（`session.send`>`aiChat.chat`>`aiGenerators.chat`） | **高（关键路径）** |

**关键**：`onChunk/onMessage/onReasoning` 这类改闭包状态的回调**留在主闭包**，只把「选 SDK 端点 + 发起流式」
抽成 `runStreamingChat({sdk, systemPrompt, priorHistory, userContent, 各回调, abortController, signal,...})`，
两个调用点（造游戏带工具、inspire 不带工具）传不同回调。`session.destroy()` 的 finally 清理、
不同端点取文本的差异（`result.text` vs `choices[0].message.content`）、abort 时序必须逐一对齐。
**执行顺序**：纯函数（constants/markdown/ui_state）→ session_storage → model_cache → copilot_tools →
stream_aggregator（最后、最谨慎）。每步单独提交便于二分回滚；冒烟覆盖：新建/编辑/历史回滚/中止/换模型/图片附件。

---

## 4. 其它已登记债（见 architecture.md §13）

- `app.js` 上帝对象拆 `petActions/shopHandler/storyHandler`。
- 经济/复杂状态裸写收口 `state.js` setter（`addCoins`/`addBiofuel` 已就位；`level_field`/`level_planet`/coins
  各点需逐一验证 notify 上下文后再迁，见 §13-E）。
- 分层 facade（`storage-facade`/`sdk-facade`）收口 ~18 视图直连 storage、~11 直连 sdk。
- modal/toast/confirm（~269 处）统一为 `ModalManager`/`confirmDanger/showError/showSuccess`。
</content>
