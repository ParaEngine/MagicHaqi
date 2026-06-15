# MagicHaqi 内容生产工具使用指南

## 最核心逻辑：一个引擎，多颗星球，多套产品入口

MagicHaqi 的内容架构不是“每做一个产品就复制一套游戏代码”，而是“同一个游戏引擎 + 不同的星球配置 + 不同的 URL 入口”。也就是说，场景、星球、商店物品、宠物角色都可以作为数据配置被加载；用户打开同一个 `MagicHaqi.html`，但只要 URL 参数不同，就可以进入不同星球，看到不同的星球外观、field 地块、背景、商店商品和产品标题。

当前用于指定入口星球的 URL 参数是：

```text
home_planet
```

例如哈奇星球可以这样进入：

```text
MagicHaqi.html?home_planet=haqi
```

这条链接的含义是：

1. 游戏启动后读取 URL 参数 `home_planet=haqi`。
2. 在 `famous-planets/_planet_index.json` 的 `planets` 数组里查找 `id` 为 `haqi` 的星球。
3. 找到后，把哈奇星球的 `planet` 外观、7 个 `fields`、`appTitle`、`shopItemUrl`、默认 zoom 层级等配置应用到当前会话。
4. 如果哈奇星球配置了 `shopItemUrl`，例如 `famous-planets/haqi_shopitems.json`，游戏会在默认商店基础上再合并哈奇星球自己的商店物品。
5. 用户看到的就是“哈奇星球版 MagicHaqi”，而不是普通默认家园。

这个 URL 入口默认是“临时星球入口”：它会让用户本次从指定星球进入，但不会自动把用户永久迁移到这个星球。用户之后仍然可以通过游戏里的星际移民功能正式迁移；正式迁移会写入用户档案，下次不带 URL 参数也会恢复到已迁移星球。

### 用哈奇星球作为独立产品发布

如果要把“哈奇星球”包装成一个独立产品，可以把同一个游戏入口发布成一个固定链接：

```text
MagicHaqi.html?home_planet=haqi
```

然后围绕 `haqi` 这颗星球配置完整内容：

- 在 `famous-planets/_planet_index.json` 里维护 `id: "haqi"` 的星球配置。
- 在 `haqi.appTitle` 中写该产品希望显示的标题，例如“魔法哈奇-抱抱龙”。
- 在 `haqi.fields` 中配置 7 个哈奇主题地块，例如小镇广场、阳光海滩、魔法密林、游乐场、雪山、魔法学院、跳跳农场。
- 在每个 field 的 `background` 中引用哈奇主题场景图。
- 在每个 field 的 `particles` 和 `bgMusic` 中配置对应氛围。
- 如需独立商品体系，在 `haqi.shopItemUrl` 中填 `famous-planets/haqi_shopitems.json`。
- 用 `ShopItemGenerator.html` 维护 `haqi_shopitems.json`，添加哈奇专属家具、房屋、食物或活动道具。
- 如需哈奇专属宠物，用 `FamousPetGenerator.html` 创建宠物，并把宠物加入 `famous-pets/_pet_index.json`。

这样，同一个 MagicHaqi 引擎可以发布成多个产品入口：

```text
MagicHaqi.html?home_planet=haqi
MagicHaqi.html?home_planet=maisi
MagicHaqi.html?home_planet=your_own_ip
```

每个入口都可以有自己的产品名、星球视觉、地块背景、商店商品和运营内容。开发上只维护一套代码；内容生产上只维护不同星球的数据配置。后续如果要做“哈奇星球”“麦思星球”“糖云星球”这样的独立运营版本，优先考虑新增或维护星球配置，而不是复制项目。

### URL 参数和星球配置的对应关系

`home_planet` 参数最终会匹配 `_planet_index.json` 中的星球 `id`。推荐直接使用星球 ID：

```text
?home_planet=haqi
```

运行时也会兼容一些路径写法，例如：

```text
?home_planet=famous-planets/haqi.json
?home_planet=planet_haqi.json
```

但文档、运营链接和产品发布链接都建议统一使用最短、最稳定的 ID 写法：

```text
?home_planet=haqi
```

配置独立产品入口时，最重要的不是 URL 本身，而是保证这个 ID 对应的星球数据完整：星球 entry 要存在，7 个 fields 要完整，图片 URL 要可访问，`shopItemUrl` 指向的商店文件要存在，`appTitle` 要符合该产品的品牌名。

### 星球面向人群配置（audience）

为了让同一套引擎适配不同人群，每颗星球可以在 `_planet_index.json` 的星球 entry 里增加一个 `audience` 对象，用来描述目标用户与养成压力。当前支持以下字段：

```json
"audience": {
  "targetUser": "想零压力陪伴的大人与全年龄玩家",
  "ageRange": "6-99",
  "petPersona": "童趣治愈、永远开心",
  "selfCare": 1
}
```

| 字段 | 含义 | 取值 |
| --- | --- | --- |
| `targetUser` | 目标用户，一句话描述 | 文本 |
| `ageRange` | 适合年龄段（可解析区间） | 文本，格式 `min-max`，例如 `8-12` |
| `petPersona` | 宠物人格基调 | 文本 |
| `selfCare` | 宠物自我照料能力 | `[0,1]` 之间的小数 |

**`selfCare` 行为说明（取值区间 `[0,1]`）**

`selfCare` 是一个连续值，描述这颗星球的宠物有多能照顾自己，直接决定养成数值衰减得有多慢——值越大，需要照料的间隔越长：

| selfCare | 衰减倍率 | 大致照料间隔 | 体验 |
| --- | --- | --- | --- |
| `0`（默认） | 1.000 | ~1 天 | 常规养成，几乎每天都要照料 |
| `0.3` | 0.573 | ~1.7 天 | 偶尔疏忽也没关系 |
| `0.5` | 0.330 | ~3 天 | 几天照料一次 |
| `0.7` | 0.143 | ~7 天 | 大约一周照料一次 |
| `0.9` | 0.025 | ~40 天 | 几乎免照料 |
| `1` | 0.000 | 永不 | 完全自给自足（零压力） |

- 衰减倍率曲线为 `decayMultiplier = (1 - selfCare) ** 1.6`，使「照料间隔 ≈ 1 / 衰减倍率 天」。该倍率同时按比例缩放生病概率（`selfCare` 越大越不容易生病）。
- `selfCare` 取整数 `1` 时为**完全自给自足 / 零压力**：宠物不会饿、不会脏、一直开心，所有养成数值统一锁定在 **80% 左右**，在线 / 离线都不衰减、**永不生病、不会形成创伤**。适合给大人做的轻松陪伴型星球（例如像素乐星）。
- `selfCare` 取 `0`（或缺省）时为常规养成，适合给孩子的养成型星球。

实现位置：

- 配置读取：`view_star_settlements.js` 在切换/恢复星球时，用 `planetSelfCareValue()` 把 `audience.selfCare` 规范化到 `[0,1]` 后写入 `state.settings.starSettlement.selfCare`。
- 行为生效：`petTick.js` 的 `applyDecay` / `applyOfflineDecay` / `maybeRollDailySickness` 调用 `petLifecycle.js` 的 `currentPlanetDecayMultiplier()` 按倍率放慢衰减与降低生病概率；当 `selfCare === 1` 时走 `isCurrentPlanetSelfCare()` 分支，用 `applyPlanetSelfCareStats()` 把数值锁定在 `PLANET_SELF_CARE_STATS`（默认 `{ hunger: 80, mood: 80, clean: 80, bond: 80 }`），并跳过生病 / 创伤。

本文档面向负责维护 MagicHaqi 官方内容的策划、设计和开发同学，详细说明 `dev_tools/` 目录下 4 个内部生成器的使用方式、数据保存位置、字段含义以及它们之间的逻辑关系。

5 个工具分别是：

- `ScenePresetsGenerator.html`：创建和维护故事/星球表面可复用的场景背景预设。
- `FamousPetGenerator.html`：创建和维护官方/稀有宠物角色。
- `FamousPlanetGenerator.html`：创建和维护官方星球，以及星球上的 7 个 field 地块。
- `ShopItemGenerator.html`：创建和维护商店物品、家具、房屋、食物和它们的视觉资源。
- `ZooEncyclopediaMaker.html`：动物园图鉴制作端（给动物园工作人员用），维护动物园星球的真实动物图鉴 JSON。

核心原则：先做可复用素材，再把素材挂到星球和商店里。推荐顺序是：

1. 先用场景工具创建可复用背景。
2. 再用星球工具创建星球，并把场景背景挂到 7 个 fields 上。
3. 再用商店工具维护默认商品或某个星球专属商品。
4. 最后用宠物工具创建官方宠物角色，用于邀请、活动、故事或奖励。

## 一、推荐模型配置

所有工具都依赖 KeepworkSDK 的本地 API Key 配置。打开任意工具后，左侧都有“本地 API Key”按钮，用来配置可用的 Chat 模型和 Image 模型。

推荐模型如下：

| 用途 | 推荐模型 | 适用工具 | 说明 |
| --- | --- | --- | --- |
| 语言模型 / JSON 生成 / SVG 草稿 / 批量结构生成 | GPT5.5 | 星球、商店、场景、宠物中所有文本生成 | 适合严格输出 JSON、理解字段约束和批量规划。 |
| 宠物文生图 | Gemini 3.1 PRO | Famous Pet Generator | 宠物需要稳定的角色一致性、透明底 sprite sheet、4x4 动作阶段网格，建议用更强模型。 |
| 其他文生图 | Gemini 3.1 Flash | Scene Presets Generator、Shop Item Generator 等 | 场景和商品图生成量较大，Flash 更适合高频迭代。 |

使用建议：

- 如果工具里有 Chat 模型下拉框，优先选 GPT5.5。
- 如果是宠物图片模型下拉框，优先选 Gemini 3.1 PRO。
- 如果是场景背景、商店物品 WebP 图片、星球相关非宠物图片，优先选 Gemini 3.1 Flash。
- 如果模型名称在下拉框里略有差异，以本地 API Key 里配置的实际名称为准，但能力选择按上面的策略执行。

## 二、运行和准备

### 1. 启动方式

这些工具都是静态 HTML 页面。可以直接从浏览器打开，也可以在本项目根目录运行本地服务后访问。

推荐使用本地服务或 Live Server，这样相对路径、SDK、模块导入和本地 JSON 读取更稳定。

常用入口：

- `dev_tools/ScenePresetsGenerator.html`
- `dev_tools/FamousPetGenerator.html`
- `dev_tools/FamousPlanetGenerator.html`
- `dev_tools/ShopItemGenerator.html`

### 2. 登录和 Workspace

4 个工具都会加载 KeepworkSDK，并使用 `MagicHaqi` workspace。保存按钮通常会把数据写入 workspace 里的对应文件，同时工具也会优先尝试读取项目本地 JSON 作为回退。

如果页面左上角一直显示 SDK loading，先检查：

- 浏览器能否访问 Keepwork SDK CDN。
- 当前页面是否通过本地服务打开，而不是被浏览器安全策略限制。
- 是否已经登录 Keepwork。
- 本地 API Key 是否配置了需要的 Chat 和 Image 模型。

### 3. CDN 上传权限和配置

场景、宠物和商店物品的正式图片一般会上传到 Keepwork CDN，例如 `maisi/magichaqi/scenes`、`maisi/magichaqi/pet`、`maisi/magichaqi/shopitems`。这些上传能力不是所有账号默认都有权限，需要账号已开通对应 CDN 上传权限，或者由有权限的同学代为上传。

使用工具时注意：

- “上传临时 CDN”“生成后压缩上传 CDN”“CDN folder” 这类选项都依赖当前登录账号的上传权限。
- 如果生成图片成功但 CDN 上传失败，优先检查账号权限和目标 folder 是否正确，不要直接把 `data:image/...` 长期写入正式 JSON。
- 没有上传权限的同学可以先完成结构、prompt、预览和 JSON 编辑，再把图片或导出的结果交给有权限的同学上传，并回填稳定的 CDN URL。
- 正式上线内容应使用可访问的 CDN URL；场景用 `imageUrl`，宠物用 `imageSheetUrl`，商店视觉资源用 `DECO_VISUALS.<itemId>.imageUrl`。

### 4. 文件保存位置总览

| 内容类型 | 主文件/目录 | 说明 |
| --- | --- | --- |
| 场景预设 | `pet-story/presets/scenes.json` | 所有可复用场景背景都在一个 scenes 数组里。 |
| 官方宠物索引 | `famous-pets/_pet_index.json` | 游戏列表读取的轻量索引。 |
| 官方宠物详情 | `famous-pets/<petId>.json` | 每只宠物一份完整 JSON。 |
| 官方星球索引 | `famous-planets/_planet_index.json` | 星球全部保存在 planets 数组里，不再单独生成星球 JSON。 |
| 默认商店物品 | `famous-planets/_default_shopitems.json` | 全局默认商店配置。 |
| 星球专属商店物品 | `famous-planets/<planetId>_shopitems.json` 等 | 由星球的 `shopItemUrl` 指向。 |
| 动物园图鉴 | `famous-planets/<zooId>_encyclopedia.json` | 由星球的 `encyclopediaUrl` 指向，用 `ZooEncyclopediaMaker.html` 维护。 |

## 三、四个工具之间的核心逻辑

### 1. 场景和星球的关系

场景工具生成的是“背景预设”。每个场景有：

- `id`：场景唯一 ID。
- `title`：中文场景名。
- `imageUrl`：背景图 CDN 地址。
- `color`：加载失败或预览用的底色。
- `tags`：筛选和提示词用的标签。
- `particles`：粒子效果。
- `bgMusic`：可选背景音乐。

星球工具会读取 `pet-story/presets/scenes.json`，在编辑 field 时可以选择某个场景预设。选择后，field 的 `background` 会保存：

- `type: "image"`
- `imageUrl`：来自场景。
- `presetId`：来自场景 `id`。
- `title`：来自场景 `title`。
- `color`：来自场景 `color` 或手动设置。

这样做的好处是：场景图可以先批量生产，星球只引用稳定的 CDN 图和 preset ID，不需要每个星球重复生成背景。

### 2. 星球和商店的关系

游戏默认会加载 `famous-planets/_default_shopitems.json`。如果当前官方星球配置了 `shopItemUrl`，游戏会额外读取这个文件，然后用它覆盖或扩展默认商品。

加载规则是：

1. 先加载默认商品 `_default_shopitems.json`。
2. 如果星球有 `shopItemUrl`，再加载该文件。
3. `SHOP_ITEMS` 按 `id` 合并：同 id 商品会深度合并，星球文件中的字段覆盖默认字段。
4. `DECO_VISUALS` 也按物品 id 合并：同 id 视觉资源会覆盖或补充默认视觉。
5. 如果星球文件加载失败，就回退到默认商品。

因此，一个星球可以有自己的商品文件，例如：

```json
{
	"id": "haqi",
	"title": "哈奇星球",
	"shopItemUrl": "famous-planets/haqi_shopitems.json"
}
```

也可以简写为：

```json
{
	"id": "haqi",
	"title": "哈奇星球",
	"shopItemUrl": "haqi_shopitems.json"
}
```

运行时代码会把非 URL、非绝对路径的值补成 `famous-planets/<file>`。

### 3. 商店物品和摆放区域的关系

商店物品的 `fields` 决定它能在哪里买、能摆在哪里：

- `indoor`：室内通用家具。
- `outdoor`：户外通用物品。
- `land`：陆地 field 可摆放。
- `water`：水域 field 可摆放。
- `sky`：天空 field 可摆放。
- `fire`、`ice`、`life`、`dark`：特殊 field 类型可摆放。
- `bedroom`、`kitchen`、`bath`、`living`、`garden`：房屋房间内可摆放。

星球 field 的 `typeId` 会影响户外摆放托盘。比如某个 field 的 `typeId` 是 `water`，托盘里会显示玩家已拥有并且 `fields` 包含 `water` 的家具或房屋。

### 4. 宠物和其他内容的关系

宠物工具生成的是官方宠物角色，数据在 `famous-pets/` 下。它与星球和商店没有强绑定关系，但常用于：

- 活动奖励宠物。
- 邀请链接宠物。
- 故事主角或 NPC。
- 官方稀有宠物池。

宠物数据包含 DNA 和 traits。DNA 是由 traits 转出来的稳定编码，游戏里可继续用于显示特征、繁殖、外观说明等系统。

## 四、Scene Presets Generator：创建场景

### 1. 什么时候使用

当你需要一张可复用的背景图时使用这个工具。典型场景包括：

- 星球 field 背景。
- 宠物故事背景。
- 室内房间背景。
- 商店、医院、学校、海滩、森林、游乐场等主题场景。

### 2. 数据保存位置

场景保存到：

```text
pet-story/presets/scenes.json
```

这个文件外层结构通常是：

```json
{
	"version": 1,
	"updatedAt": "2026-05-24",
	"tagPromptHint": "indoor, outdoor, land, sky...",
	"scenes": [
		{
			"id": "forest_glade",
			"title": "森林空地",
			"imageUrl": "https://cdn.keepwork.com/maisi/magichaqi/scenes/forest_glade-xxx.webp",
			"color": "#bbf7d0",
			"tags": ["outdoor", "forest", "land", "spring"],
			"particles": ["petals", "sparkle"],
			"bgMusic": "forest"
		}
	]
}
```

### 3. 页面区域说明

左侧区域：

- 账号与工具：确认 SDK 和登录状态，配置本地 API Key。
- 图片模型：选择图像模型，推荐 Gemini 3.1 Flash。
- 分辨率：默认 `1024x1024`。
- 上传临时 CDN：有上传权限时可开启，生成图会上传到 Keepwork 临时 CDN。
- 生成后压缩上传 CDN：有正式 CDN 上传权限时可开启，工具会压缩并上传到 `maisi/magichaqi/scenes`。
- 参考图：可以输入 URL、上传图片或粘贴剪贴板图片。

中间列表区域：

- 显示 `scenes.json` 里的全部场景。
- 可按 `id`、标题、tags 搜索。
- 可按 tags 和是否有图筛选。
- 可多选后批量生成缺失图片。

右侧编辑区：

- 编辑单个场景的字段。
- 生成图片。
- 预览图片。
- 查看和应用 JSON。
- 保存场景。

### 4. 创建单个场景的步骤

1. 打开 `dev_tools/ScenePresetsGenerator.html`。
2. 确认 SDK 已加载，登录状态正常。
3. 点击“本地 API Key”，确认 Image 模型里有 Gemini 3.1 Flash。
4. 点击“新建”。
5. 填写 `ID`。建议只用英文小写、数字、下划线或连字符，例如 `forest_spring_bridge`。
6. 填写中文标题，例如“春日森林桥”。
7. 填写 `color`，这是备用底色，也会帮助星球 field 预览。
8. 填写 tags。建议至少包含环境类型和用途，例如 `outdoor, forest, land, spring`。
9. 选择粒子效果，例如 `sparkle`、`petals`、`bubbles`、`mist`、`snow`、`embers`。
10. 可选选择 `bgMusic`。
11. 编写场景 prompt。尽量描述画面主体、时间、氛围、前中后景、留白位置。
12. 如有参考图，在左侧添加参考图。
13. 点击生成图片。
14. 检查图片是否满足：明亮、干净、中央可站宠物、没有文字、没有黑边、横向延展感足够。
15. 如不满意，调整 prompt 或参考图后重新生成。
16. 确认后点击“保存场景”。

### 5. 批量生成场景图片

批量适合先由语言模型批量生成场景结构，再补图。

操作方式：

1. 在列表中筛选出需要补图的场景。
2. 勾选目标场景，或使用“全选当前列表”。
3. 点击“生成选中”。
4. 观察批量进度。
5. 中途发现风格不对，可以暂停，再修改 prompt 或模型配置。
6. 批量完成后，用“修复”检查图片体积、格式和 data URL。

### 6. 场景字段详解

`id`：

- 场景唯一 ID。
- 会被星球 field 的 `presetId` 引用。
- 不要随意改已上线场景的 `id`，否则星球引用会失去语义关联。

`title`：

- 中文展示名。
- 星球工具选择场景时会显示它。

`imageUrl`：

- 场景背景图地址。
- 建议使用 CDN WebP URL。
- 不建议长期保留 `data:image/...`，文件会变大且加载慢。

`historyUrls`：

- 历史图片地址。
- 工具内部用于回退和版本选择。
- 导出正式 index 时默认可以移除，避免文件膨胀。

`color`：

- 备用背景色。
- 图片未加载或星球预览时使用。

`tags`：

- 用于筛选、批量生成和提示词组织。
- 建议使用英文标签，例如 `indoor`、`outdoor`、`land`、`water`、`sky`、`spring`、`haqi`。

`particles`：

- 进入场景时的粒子效果。
- 不要自造运行时代码不支持的值。

`bgMusic`：

- 可选背景音乐 key。
- 当前工具提示中常见值包括 `selector`、`square`、`forest`、`farm`、`mountain`、`park`、`playground`、`ship`、`haqiLoop`。

`prompt`：

- 生成图片时使用。
- 正式导出可以移除，但保留在工作稿里有利于后续重生成。

### 7. 场景 Prompt 建议

推荐写法：

```text
明亮童话感的哈奇星球户外森林桥场景，春天，浅绿色草地，彩色小花，木质小桥横跨浅溪，远处有圆润树冠和柔和天空。画面中央保留宠物角色站立空间，不要文字，不要人物，不要黑边，适合手机横版故事播放器。
```

注意事项：

- 明确“不要文字”，避免图片里出现不可控字样。
- 明确“中央保留宠物站立空间”。
- 不要让画面过暗、过写实或过复杂。
- 星球 field 背景要能容纳家具和宠物，不要主体占满全屏。

## 五、Famous Pet Generator：创建宠物角色

### 1. 什么时候使用

当你需要创建官方宠物、稀有宠物、活动宠物或可通过链接访问的宠物时使用这个工具。

### 2. 数据保存位置

宠物详情保存到：

```text
famous-pets/<petId>.json
```

宠物索引保存到：

```text
famous-pets/_pet_index.json
```

索引只保留轻量字段：

```json
{
	"id": "star_horse_nuomi",
	"name": "糯糯星马",
	"dna": "AACAADAAJAABAADAAA",
	"imageSheetUrl": "https://cdn.keepwork.com/maisi/magichaqi/pet/star_horse_nuomi_xxx.webp",
	"traits": {
		"element": "天空",
		"species": "星鬃小马驹",
		"color": "薰衣草紫渐变色",
		"eyes": "星星眼",
		"accessory": "戴着小皇冠",
		"elementalAttribute": "自然"
	},
	"rarity": 91
}
```

完整宠物文件还会包含 `stage`、`anim`、`wishPrompt`、`historyUrls`、`everAdult` 等工作字段。

### 3. 页面区域说明

左侧区域：

- 账号与工具。
- 图片模型：宠物推荐 Gemini 3.1 PRO。
- 分辨率：默认 `2048x2048`，也可以选 `1024x1024`。
- CDN folder：有上传权限时使用，默认 `maisi/magichaqi/pet`。
- 参考图：用于锁定造型、配色或风格。

中间列表：

- 读取 `famous-pets/_pet_index.json` 和宠物文件。
- 可搜索、选择、批量生成、修复。

右侧编辑器：

- Properties：宠物结构字段。
- Prompt：最终送入图片模型的提示词。
- Sprite sheet 预览。
- JSON 输出和邀请链接。

### 4. 创建单只宠物的步骤

1. 打开 `dev_tools/FamousPetGenerator.html`。
2. 确认登录和本地 API Key。
3. 图片模型选择 Gemini 3.1 PRO。
4. 点击“新建”。
5. 填写 `ID`，例如 `moon_rabbit_ruanruan`。ID 会变成文件名。
6. 填写名称，例如“软软月兔”。
7. 设置稀有度 `rarity`，范围 0 到 100。
8. 设置阶段 `stage`。官方展示宠通常用 `adult`。
9. 设置动作 `anim`，常用 `happy`。
10. 填写血统 `element`：陆地、水系、天空。
11. 填写元素 `elementalAttribute`：自然、火、冰、生命、暗、雷。
12. 填写种类、颜色、眼睛、配饰。
13. 填写核心提示词 `wishPrompt`。
14. 点击“刷新 Prompt”，检查生成提示词是否符合预期。
15. 点击生成图片，得到 4x4 sprite sheet。
16. 检查每格是否干净透明、角色一致、动作和阶段可辨认。
17. 保存宠物 JSON。
18. 点击“更新 index”，同步 `famous-pets/_pet_index.json`。

### 5. 宠物 sprite sheet 规则

宠物图是 4x4 sprite sheet：

- 行代表阶段：`baby`、`teen`、`adult`、`elder`。
- 列代表动作：`idle`、`happy`、`sad`、`sleep`。

工具内部映射是：

```text
stage row: baby=0, teen=1, adult=2, elder=3
anim col: idle=0, happy=1, sad=2, sleep=3
```

生成图片时要特别检查：

- 16 格必须都有角色。
- 角色不能被裁切。
- 背景应为透明或可被工具处理成透明。
- 每格角色大小尽量一致。
- baby 到 elder 可以有成长感，但不能变成完全不同的角色。
- happy、sad、sleep 的状态要可辨认。

### 6. 宠物字段详解

`id`：

- 宠物唯一 ID。
- 文件保存为 `famous-pets/<id>.json`。
- 邀请链接里会使用 `petId=famous-pets/<id>`。

`name`：

- 中文显示名。

`dna`：

- 由 traits 自动生成。
- 不建议手动改，除非你明确知道 DNA 编码规则。

`imageSheetUrl`：

- 4x4 sprite sheet 图片地址。
- 正式内容必须有这个字段。

`traits`：

- 宠物外观和种族特征。
- 包含 `element`、`species`、`color`、`eyes`、`accessory`、`elementalAttribute`。

`rarity`：

- 稀有度。
- 活动宠、生肖宠、限定宠通常设置 80 到 100。

`stage`：

- 当前展示阶段。
- 官方宠常用 `adult`。

`anim`：

- 当前展示动作。
- 邀请链接默认使用这个动作。

`wishPrompt`：

- 生成宠物图时的核心描述。

`historyUrls`：

- 历史图片。
- 方便回退，不进入索引必要字段。

### 7. 宠物 Prompt 建议

好的宠物 prompt 应该包含：

- 物种核心，例如“小月兔”“云朵马”“泡泡龙”。
- 主色和点缀色。
- 眼睛、配饰、尾巴、耳朵等记忆点。
- 儿童向、温暖、干净、可爱。
- 透明底、sprite sheet、一致角色。

示例：

```text
一只儿童向的月绒兔耳小宠物，月光银白毛色，耳尖有淡蓝渐变，冰蓝月牙眼，戴着小小月桂花环。整体柔软圆润、表情亲切、适合 MagicHaqi 养成游戏。需要保持 4x4 sprite sheet 中角色完全一致，透明背景，动作清晰。
```

### 8. 保存和更新 index 的区别

“保存”通常保存当前宠物完整 JSON 文件。

“更新 index”会把当前宠物的轻量字段写入 `famous-pets/_pet_index.json`。

正式上线前必须两步都做：

1. 保存宠物详情。
2. 更新 index。

如果只保存详情但不更新 index，列表或入口可能找不到它。如果只更新 index 但没有详情文件，点击或加载详情时可能失败。

## 六、Famous Planet Generator：创建星球

### 1. 什么时候使用

当你需要创建官方星球、维护星球列表、配置星球外观、设置星球地表 7 个 fields 时使用这个工具。

### 2. 数据保存位置

星球数据保存到：

```text
famous-planets/_planet_index.json
```

外层结构是：

```json
{
	"version": 1,
	"planets": [
		{
			"id": "haqi",
			"title": "哈奇星球",
			"name": "哈奇星球",
			"appTitle": "魔法哈奇-抱抱龙",
			"shopItemUrl": "famous-planets/haqi_shopitems.json",
			"badge": "官方",
			"summary": "海风、魔法帽和小岛传说组成的官方星球。",
			"planet": {
				"readonly": true,
				"hue": 205,
				"bodyBackground": "radial-gradient(...)，...",
				"glowColor": "rgba(14, 165, 233, 0.62)",
				"accentColor": "#facc15"
			},
			"fields": []
		}
	]
}
```

注意：星球工具不会再生成 `famous-planets/<planetId>.json`，星球就是 `_planet_index.json` 里的一个 entry。

### 3. 星球的 7 个 fields

每个官方星球固定 7 个 fields，顺序固定。工具中对应位置是：

| 顺序 | 显示位置 | 用途理解 |
| --- | --- | --- |
| 1 | 左耳 | 星球左上区域。 |
| 2 | 左眉 | 常用于水域或海湾。 |
| 3 | 右眉 | 常用于天空、云台。 |
| 4 | 右耳 | 星球右上区域。 |
| 5 | 左胡子 | 星球左下区域。 |
| 6 | 中胡子 | 主地块，常作为主要入口。 |
| 7 | 右胡子 | 星球右下区域。 |

每个 field 有自己的 `typeId`，可选值：

- `land`：陆地。
- `water`：水域。
- `sky`：天空。
- `fire`：火山。
- `ice`：冰湖。
- `life`：神树。
- `dark`：洞穴。

`typeId` 会影响：

- field 的类型图标和语义。
- 户外摆放托盘中可放置的商店物品。
- 设计上这个地块应出现什么商品、背景和粒子。

### 4. 页面区域说明

左侧：

- 账号与 Workspace。
- 操作按钮：刷新、打开、新建星球、复制、下载 index、复制 index。
- 场景预设状态：读取 `pet-story/presets/scenes.json` 后才能选择场景。

中间：

- 官方星球列表。
- 搜索 `id`、`title`、`summary`。
- 保存。

右侧：

- 星球信息。
- Planet 外观。
- Zoom 层级。
- 7 个 Fields。
- 预览和 JSON。

### 5. 创建星球的步骤

1. 打开 `dev_tools/FamousPlanetGenerator.html`。
2. 确认 SDK、登录和场景预设加载成功。
3. 点击“新建星球”。
4. 如果使用 AI 生成星球结构，Chat 模型选择 GPT5.5。
5. 填写或生成星球基础信息。
6. 检查 `ID`。建议用英文小写，例如 `candy_cloud`。
7. 填写 `name` 和 `title`。通常都用中文星球名。
8. 可选填写 `appTitle`，用于该星球下的应用标题覆盖。
9. 如需星球专属商店，填写 `Shop item URL`。
10. 设置 `badge`，默认“官方”。
11. 写 `summary`，一句话说明星球主题。
12. 设置 Planet 外观：hue、glowColor、accentColor、bodyBackground。
13. 设置 Zoom 层级：默认进入 planet/field/pet/cell，是否隐藏 planet 或 cell。
14. 逐个配置 7 个 fields。
15. 在预览区检查星球色调和 field 背景。
16. 点击“刷新 JSON”检查结构。
17. 点击“保存”。

### 6. 星球基础字段详解

`id`：

- 官方星球唯一 ID。
- 用于移民状态、商店加载、列表选择。
- 不要与已有星球重复。

`title`：

- 星球列表里展示的主标题。

`name`：

- 星球名称。
- 通常与 title 一致。

`appTitle`：

- 可选。
- 用于覆盖进入该星球后的应用标题。

`shopItemUrl`：

- 可选。
- 指向星球专属商店文件。
- 支持完整 URL、相对路径或文件名。
- 为空时使用默认商店 `_default_shopitems.json`。

`badge`：

- 星球标签。
- 官方星球通常为“官方”。

`summary`：

- 星球简介。
- 列表和迁移界面会用到。

### 7. Planet 外观字段详解

`planet.readonly`：

- 是否只读。
- 官方星球通常设为 `true`，表示 planet 层官方外观不被玩家随意改写。

`planet.hue`：

- 星球主色相，用于部分视觉效果。

`planet.bodyBackground`：

- 星球球体 CSS background。
- 可以是多个 `radial-gradient` 叠加。
- 建议明亮、有主题色，但不要太暗。

`planet.glowColor`：

- 星球光晕颜色。

`planet.accentColor`：

- 强调色。

`planet.default_zoom_level`：

- 可选。
- 默认进入层级。
- 可选 `planet`、`field`、`pet`、`cell`。
- 如果是默认 `planet`，工具会省略该字段。

`planet.hide_planet`：

- 可选。
- 为 `true` 时隐藏 planet 层。
- 如果隐藏 planet 且默认层级也是 planet，运行时会自动改到 field。

`planet.hide_cell`：

- 可选。
- 为 `true` 时隐藏 cell 层。
- 如果隐藏 cell 且默认层级是 cell，运行时会自动改到 pet。

### 8. Field 字段详解

每个 field 的结构类似：

```json
{
	"name": "阳光海滩",
	"typeId": "water",
	"background": {
		"type": "image",
		"color": "#c4b5fd",
		"title": "彩虹潮汐池",
		"imageUrl": "https://cdn.keepwork.com/maisi/magichaqi/scenes/rainbow_tide_pool-xxx.webp",
		"presetId": "rainbow_tide_pool"
	},
	"particles": ["bubbles"],
	"bgMusic": "park"
}
```

`name`：

- 这个地块在星球上的名字。
- 建议 2 到 6 个中文字，方便 UI 显示。

`typeId`：

- 地块类型。
- 决定摆放规则和主题语义。

`background.type`：

- 有 `imageUrl` 时自动为 `image`。
- 没有 `imageUrl` 时为 `color`。

`background.color`：

- 背景底色或 CSS gradient。
- 即使有图片，也建议保留一个近似色。

`background.title`：

- 背景显示名。
- 如果从场景预设选择，通常等于场景标题。

`background.imageUrl`：

- 场景图地址。
- 推荐来自 Scene Presets Generator。

`background.presetId`：

- 引用的场景预设 ID。
- 便于追踪这张图来自哪个场景。

`particles`：

- 粒子效果数组。

`bgMusic`：

- 可选背景音乐 key。

### 9. 为星球配置专属商店

星球专属商店是通过 `shopItemUrl` 实现的。

推荐步骤：

1. 先在星球工具里确定星球 ID，例如 `candy_cloud`。
2. 打开商店工具。
3. 新建商店文件，建议命名为 `candy_cloud_shopitems.json`。
4. 保存路径应在 `famous-planets/` 下，即 `famous-planets/candy_cloud_shopitems.json`。
5. 在商店工具里添加该星球专属商品。
6. 保存商店文件。
7. 回到星球工具，在 `Shop item URL` 填入 `famous-planets/candy_cloud_shopitems.json` 或 `candy_cloud_shopitems.json`。
8. 保存星球。
9. 进入游戏迁移到该星球，检查商店商品是否已合并加载。

专属商店文件可以只写“差异”。例如：

```json
{
	"SHOP_ITEMS": [
		{
			"id": "candy_cloud_house",
			"name": "糖云小屋",
			"emoji": "🏠",
			"price": 120,
			"type": "house",
			"fields": ["sky"],
			"rooms": ["bedroom", "living"],
			"fieldSize": 1.2,
			"uniqueItem": true
		}
	],
	"DECO_VISUALS": {
		"candy_cloud_house": {
			"w": 0.2,
			"h": 0.24,
			"imageUrl": "https://cdn.keepwork.com/maisi/magichaqi/shopitems/candy_cloud_house_xxx.webp"
		}
	}
}
```

如果专属文件中出现与默认商品相同的 `id`，它会覆盖默认商品的对应字段。比如只想让 `food_cookie` 在某个星球更贵，可以写：

```json
{
	"SHOP_ITEMS": [
		{ "id": "food_cookie", "price": 16 }
	],
	"DECO_VISUALS": {}
}
```

运行时会保留默认 `food_cookie` 的其他字段，只覆盖 price。

### 10. 星球设计检查表

保存前检查：

- `id` 没有重复。
- `name`、`title` 是清楚的中文名。
- `summary` 能说明星球主题。
- 7 个 fields 都存在，顺序没有乱。
- 每个 field 的 `typeId` 与背景主题一致。
- 图片背景都有稳定 CDN URL。
- 粒子效果不要过多，避免画面杂乱。
- 如果配置了 `shopItemUrl`，对应文件确实存在。
- 专属商品的 `fields` 与星球 field 类型匹配。

## 七、Shop Item Generator：创建商店物品

### 1. 什么时候使用

当你需要新增或修改以下内容时使用：

- 食物。
- 玩具。
- 室内家具。
- 户外家具。
- 房屋。
- 星球专属物品。
- 物品对应的 SVG 或 WebP 视觉资源。

### 2. 数据保存位置

默认商店文件：

```text
famous-planets/_default_shopitems.json
```

星球专属商店文件：

```text
famous-planets/<planetId>_shopitems.json
```

文件结构：

```json
{
	"SHOP_ITEMS": [
		{
			"id": "food_apple",
			"name": "红苹果",
			"emoji": "🍎",
			"price": 5,
			"type": "food",
			"foodKind": "vegetables",
			"stat": { "hunger": 15 },
			"trait": "fruitLike"
		}
	],
	"DECO_VISUALS": {
		"food_apple": {
			"w": 0.1,
			"h": 0.1,
			"imageUrl": "https://cdn.keepwork.com/maisi/magichaqi/shopitems/food_apple_xxx.webp"
		}
	}
}
```

### 3. 页面区域说明

左侧：

- 账号与 Workspace。
- Shopitem 文件选择。
- 新建、保存、打开。
- 复制全部 JSON。

中间：

- 商店物品列表。
- 搜索 `id`、名称、category、fields。
- 分类筛选：food、toy、furniture、house。
- field 筛选。
- 批量生成选中 WebP。

右侧：

- 基础信息。
- 数值与食物。
- 放置与房屋。
- 视觉资源。
- AI 生成 JSON / SVG / WebP。
- 输出 JSON。

### 4. 创建默认商品的步骤

1. 打开 `dev_tools/ShopItemGenerator.html`。
2. 选择预设文件 `_default_shopitems.json`。
3. 点击“新建”。
4. 填写物品 ID，例如 `garden_magic_lantern`。
5. 填写中文名称、emoji、价格、类型。
6. 根据类型填写数值、fields、rooms、fieldSize 等。
7. 如果需要 AI 辅助生成结构，Chat 模型选 GPT5.5。
8. 如果需要生成 WebP 图片，Image 模型选 Gemini 3.1 Flash。
9. 检查预览。
10. 点击“加入列表”。
11. 点击“保存”。

### 5. 创建星球专属商品的步骤

1. 打开商店工具。
2. 点击“新建”商店文件。
3. 文件名建议为 `<planetId>_shopitems.json`，例如 `haqi_shopitems.json`。
4. 目标路径会变成 `famous-planets/haqi_shopitems.json`。
5. 保持“仅差异”模式，除非你想导出完整商品表。
6. 添加该星球专属商品。
7. 如果只想覆盖默认商品，使用相同 `id` 并只填要覆盖的字段。
8. 点击“保存”。
9. 回到星球工具，在星球的 `Shop item URL` 填入该文件路径。
10. 保存星球。

### 6. SHOP_ITEMS 字段详解

`id`：

- 物品唯一 ID。
- 同时也是 `DECO_VISUALS` 里的视觉资源 key。
- 默认商品和星球专属商品同 id 会合并。

`name`：

- 中文展示名。

`emoji`：

- 没有视觉资源时的 fallback。

`price`：

- 价格。
- 0 价格可用于默认赠送或远程环境物件。

`type`：

- `food`：食物。
- `toy`：玩具。
- `furniture`：家具。
- `house`：房屋。

`stat`：

- 使用后影响宠物状态。
- 可包含 `hunger`、`mood`、`clean`、`bond`。

`foodKind`：

- 食物类型。
- 可选 `both`、`vegetables`、`meat`。

`trait`：

- 食物影响的进化倾向。
- 例如烤肉可指向 `catLike`，胡萝卜可指向 `rabbitLike`，小鱼干可指向 `fishLike`。

`moodPenalty`：

- 某些成长阶段吃低级食物时的心情惩罚。

`moodPenaltyStages`：

- 惩罚适用阶段。
- 常见 `teen`、`adult`、`elder`。

`fields`：

- 可放置或适用区域。
- 对家具和房屋非常重要。
- 例：`["indoor"]`、`["land"]`、`["water", "land"]`、`["bedroom"]`。

`rooms`：

- 房屋包含的房间。
- 仅 `house` 类型通常需要。
- 可选如 `bedroom`、`kitchen`、`bath`、`living`、`garden`。

`fieldSize`：

- 户外摆放大小。
- 数字越大，占用视觉空间越大。

`zorder`：

- 摆放层级。
- 背景型大物件可用负值，例如火山、冰湖。

`hiddenFromShop`：

- 为 `true` 时不在普通商店显示。
- 可用于默认饲料、活动赠品、系统道具。

`unlimited`：

- 为 `true` 时无需库存数量也可无限使用。

`uniqueItem`：

- 为 `true` 时只能拥有一个。
- 房屋通常应该设置。

`remoteOnly`：

- 为 `true` 时不在商店卖、不参与普通购买。
- 常用于远程星球环境装饰或地块底层物件。

### 7. DECO_VISUALS 字段详解

`DECO_VISUALS` 是一个以物品 id 为 key 的对象。例如：

```json
{
	"land_tent": {
		"w": 0.18,
		"h": 0.22,
		"svg": "<svg ...></svg>"
	}
}
```

字段说明：

`w`：

- 视觉宽度比例。
- 影响室内/户外摆放渲染大小。

`h`：

- 视觉高度比例。

`svg`：

- 内联 SVG。
- 适合简单家具、图标化物件。

`imageUrl`：

- WebP 或其他图片地址。
- 适合房屋、复杂装饰、AI 生成物件。

`historyVisuals`：

- 历史视觉版本。
- 工作时有用，正式导出通常可以移除。

### 8. SVG 和 WebP 如何选择

优先使用 SVG 的情况：

- 简单家具。
- 扁平图形。
- 可用基础形状表达的物件。
- 需要文件轻、加载快、可控。

优先使用 WebP 的情况：

- 房屋。
- 复杂主题物件。
- 需要更丰富材质和光影。
- 想用文生图快速出图。

WebP 生成后工具会尝试创建透明 WebP；有 CDN 上传权限时，可以上传到 `maisi/magichaqi/shopitems`。商店物品 WebP 默认目标很小，工具里最大体积逻辑约为 10KB，因此图片应该简洁、主体清楚、透明背景。

### 9. 放置规则例子

室内家具：

```json
{
	"id": "deco_bookshelf",
	"name": "书架",
	"emoji": "📚",
	"price": 64,
	"type": "furniture",
	"fields": ["indoor"]
}
```

卧室专属家具：

```json
{
	"id": "bed_dream_lamp",
	"name": "梦境灯",
	"emoji": "🌙",
	"price": 36,
	"type": "furniture",
	"fields": ["bedroom"]
}
```

户外陆地家具：

```json
{
	"id": "land_market",
	"name": "小商店",
	"emoji": "🏪",
	"price": 64,
	"type": "furniture",
	"fields": ["land"],
	"fieldSize": 1.25
}
```

水陆两用家具：

```json
{
	"id": "water_bridge",
	"name": "小桥",
	"emoji": "🌉",
	"price": 76,
	"type": "furniture",
	"fields": ["water", "land"],
	"fieldSize": 1.4
}
```

房屋：

```json
{
	"id": "sky_cloud_house",
	"name": "云中小屋",
	"emoji": "🏠",
	"price": 96,
	"type": "house",
	"fields": ["sky"],
	"rooms": ["bedroom"],
	"fieldSize": 1.2,
	"uniqueItem": true
}
```

远程环境物件：

```json
{
	"id": "fire_volcano",
	"name": "火山",
	"emoji": "🌋",
	"price": 0,
	"type": "furniture",
	"fields": ["fire"],
	"zorder": -1,
	"remoteOnly": true,
	"fieldSize": 2.4
}
```

### 10. 商店 AI 功能建议

商店工具有几类 AI 辅助：

- 生成物品 JSON：用 GPT5.5。
- 生成 SVG 草稿：用 GPT5.5。
- 生成透明 WebP：用 Gemini 3.1 Flash。
- 批量生成物品：用 GPT5.5 生成结构，再用 Gemini 3.1 Flash 生成图片。

使用 AI 生成商品时，要检查：

- ID 是否符合命名规范。
- type 是否正确。
- food 是否有 stat 和 foodKind。
- furniture/house 是否有 fields。
- house 是否有 rooms 和 uniqueItem。
- visual 的 w/h 是否合理。
- SVG 是否不包含脚本、外链和不安全内容。
- WebP 是否透明、体积小、主体清晰。

## 七点五、Zoo Encyclopedia Maker：动物园图鉴制作端

### 1. 什么时候使用

当你要为某个「动物园星球」（例如深圳动物园星球 `shenzhen_zoo`）维护真实动物图鉴时使用这个工具。它面向动物园工作人员设计：粘贴动物园提供的原始科普资料，AI 自动生成适龄化双语图鉴内容，上传真实照片/叫声/视频到 CDN，最后保存成游戏可直接加载的 JSON。

### 2. 数据保存位置

图鉴数据保存到：

```text
famous-planets/<zooId>_encyclopedia.json
```

例如 `famous-planets/shenzhen_zoo_encyclopedia.json`。星球 entry 通过 `encyclopediaUrl` 字段引用它：

```json
{
	"id": "shenzhen_zoo",
	"title": "深圳动物园星球",
	"encyclopediaUrl": "famous-planets/shenzhen_zoo_encyclopedia.json"
}
```

配置了 `encyclopediaUrl` 的星球，游戏内会出现「📖 图鉴」入口（field dock 和菜单）。玩家阅读图鉴 → 通过 3 道答题 → 解锁领养 `famousPetId` 指定的官方宠物。学习/领养进度存在玩家自己的 `user/<planetId>.encyclopedia.json`。

### 3. 单只动物的字段结构

```json
{
	"id": "south_china_tiger",
	"name": { "zh": "华南虎", "en": "South China Tiger" },
	"emoji": "🐯",
	"photos": ["https://cdn.keepwork.com/maisi/magichaqi/zoo/....webp"],
	"soundUrl": "", "videoUrl": "",
	"facts": { "habitat": {"zh":"","en":""}, "diet": {}, "lifespan": {}, "size": {}, "protection": {} },
	"funFacts": [{ "zh": "", "en": "" }],
	"intro": { "kid": {"zh":"","en":""}, "junior": {"zh":"","en":""} },
	"quiz": [{ "q": {"zh":"","en":""}, "options": [{"zh":"","en":""}], "answer": 0 }],
	"guideTask": { "zh": "", "en": "" },
	"famousPetId": "zodiac_tiger_tangtang",
	"locked": false
}
```

所有文案字段都是 `{zh, en}` 双语对象。`intro.kid` 面向 3-6 岁，`intro.junior` 面向 7-12 岁。`famousPetId` 必须是 `famous-pets/_pet_index.json` 中存在的宠物 id。

### 4. 推荐工作流程

1. 打开 `dev_tools/ZooEncyclopediaMaker.html`，登录 Keepwork，配置本地 API Key（Chat 模型推荐 GPT5.5）。
2. 填写动物园 ID（如 `shenzhen_zoo`），点击「加载」。优先读 workspace，回退本地 JSON。
3. 填写动物园信息和胖虎导游欢迎词。
4. 点「新建动物」，填 ID、中英文名、Emoji。
5. 把动物园提供的原始科普资料粘贴到「原始资料」框，点「AI 生成图鉴内容」。AI 会生成 facts / 分龄介绍 / 趣味知识 / 3 道答题 / 导游任务，全部双语。**生成后必须人工校对科学事实。**
6. 上传真实照片（自动压缩 WebP 上传 CDN `maisi/magichaqi/zoo`）、叫声 mp3、视频 mp4。CDN 配置与商店/宠物生成器共用 qiniu.yaml；未配置时走 Keepwork 临时 CDN。
7. 点「生成卡通宠物 Prompt」，把结果复制到 `FamousPetGenerator.html` 创建对应卡通宠物，再把宠物 id 填回「领养宠物 ID」。
8. 点「保存到 Workspace」。校验提示会列出缺失项（缺中文名 / 缺介绍 / 缺宠物 / 缺答题）。
9. 把新宠物 id 同步加入星球 entry 的 `planet_pets`，用 `MagicHaqi.html?home_planet=<zooId>` 验证全链路。

### 5. 给新动物园复制一颗星球

1. 用 `FamousPlanetGenerator.html` 新建星球 entry（园区主题 fields + 绿色生态外观），在 JSON 中加 `encyclopediaUrl: "famous-planets/<zooId>_encyclopedia.json"`。
2. 用本工具新建 `<zooId>` 图鉴并录入动物。
3. 用 `FamousPetGenerator.html` 创建对应卡通宠物。
4. 发布入口 `MagicHaqi.html?home_planet=<zooId>`。整个过程零代码改动。

## 八、推荐生产流程范例：创建一个新官方星球

假设要创建一个“糖云星球”，完整流程如下。

### 第一步：规划星球主题

先确定：

- 星球 ID：`candy_cloud`。
- 中文名：糖云星球。
- 主题：糖果、云朵、柔和彩虹。
- 主要 field 类型：sky、land、life、water。
- 是否需要专属商店：需要。

### 第二步：创建场景预设

用 Scene Presets Generator 创建 7 个左右场景：

- `candy_cloud_plaza`：糖云广场。
- `marshmallow_sky_bridge`：棉花糖天空桥。
- `rainbow_syrup_lake`：彩虹糖浆湖。
- `cookie_garden`：曲奇花园。
- `candy_workshop_outdoor`：糖果工坊外景。
- `star_sugar_stage`：星糖舞台。
- `soft_cloud_home`：软云小屋。

每个场景都保存到 `scenes.json`，确保有 `imageUrl`。

### 第三步：创建星球

用 Famous Planet Generator：

1. 新建星球。
2. ID 填 `candy_cloud`。
3. name/title 填“糖云星球”。
4. summary 填“漂浮在彩虹糖雾里的柔软星球，适合喜欢甜点和天空冒险的宠物。”
5. Planet 外观用粉色、天蓝、浅黄渐变。
6. 7 个 fields 分别选择刚才创建的场景。
7. `Shop item URL` 先留空，等商店文件创建后再填。
8. 保存星球。

### 第四步：创建星球专属商店

用 Shop Item Generator：

1. 新建 shopitem 文件。
2. 文件名使用 `candy_cloud_shopitems.json`。
3. 添加专属物品，例如糖云小屋、彩虹糖灯、棉花糖桌、星糖风车。
4. 对天空地块物品设置 `fields: ["sky"]`。
5. 对陆地物品设置 `fields: ["land"]`。
6. 房屋设置 `type: "house"`、`rooms` 和 `uniqueItem: true`。
7. 保存文件。

### 第五步：把商店挂到星球

回到 Famous Planet Generator：

1. 选中 `candy_cloud`。
2. 在 `Shop item URL` 填：`famous-planets/candy_cloud_shopitems.json`。
3. 保存星球。

### 第六步：测试

进入游戏后检查：

- 星际移民列表能看到糖云星球。
- 迁移后星球名、简介、field 背景正确。
- 进入商店能看到默认商品和糖云专属商品。
- 专属商品购买后能在正确 field 摆放。
- 房屋能进入正确房间。
- 星球刷新后布局和库存仍然正常。

## 九、推荐生产流程范例：创建一个活动宠物

假设要创建一个“糖云布丁龙”。

1. 打开 Famous Pet Generator。
2. 图片模型选 Gemini 3.1 PRO。
3. 新建宠物。
4. ID：`candy_pudding_dragon`。
5. 名称：糖云布丁龙。
6. rarity：95。
7. stage：adult。
8. anim：happy。
9. element：天空。
10. elementalAttribute：生命。
11. species：布丁小龙。
12. color：奶黄色带粉色糖霜渐变。
13. eyes：星星眼。
14. accessory：戴着彩虹糖发夹。
15. wishPrompt：描述它是糖云星球活动限定宠物。
16. 生成 sprite sheet。
17. 检查 16 格一致性。
18. 保存宠物。
19. 更新 index。
20. 用邀请链接测试宠物是否能加载。

## 十、命名规范

### 1. ID 规范

所有 ID 推荐使用：

- 小写英文。
- 数字。
- 下划线 `_`。
- 连字符 `-`。

不要使用中文、空格、特殊符号。

推荐：

```text
forest_glade
candy_cloud
candy_cloud_house
zodiac_dragon_bobo
```

不推荐：

```text
糖云星球
candy cloud house
CandyCloudHouse!
```

### 2. 文件命名

星球专属商店文件推荐：

```text
famous-planets/<planetId>_shopitems.json
```

宠物详情文件由工具自动保存为：

```text
famous-pets/<petId>.json
```

### 3. 场景 tags

建议使用英文标签，便于筛选和提示词复用：

- 空间：`indoor`、`outdoor`。
- 地形：`land`、`water`、`sky`、`forest`、`seaside`、`mountain`。
- 功能：`shop`、`school`、`hospital`、`playground`、`living room`、`bathroom`。
- 氛围：`spring`、`winter`、`night`、`candy`、`haqi`。

## 十一、上线前检查清单

### 场景

- 每个场景都有唯一 `id`。
- 每个正式场景都有 CDN `imageUrl`。
- 图片没有文字、黑边、严重裁切。
- `tags` 能表达场景用途。
- `particles` 使用运行时支持的值。
- 大图已压缩为 WebP。

### 宠物

- 宠物详情文件存在。
- `famous-pets/_pet_index.json` 已更新。
- `imageSheetUrl` 是 CDN URL。
- 4x4 sprite sheet 角色一致。
- DNA 与 traits 已自动生成。
- rarity 合理。

### 星球

- `_planet_index.json` JSON 合法。
- 星球 ID 不重复。
- 7 个 fields 都存在。
- 每个 field 的 typeId 合理。
- 背景图 URL 能访问。
- `shopItemUrl` 如果填写，对应文件能访问。
- 默认 zoom 和隐藏层级设置符合设计。

### 商店

- `SHOP_ITEMS` 是数组。
- `DECO_VISUALS` 是对象。
- 每个 item 都有 id、name、emoji、price、type。
- 需要摆放的物品都有 fields。
- 房屋都有 rooms 和 uniqueItem。
- 不想在商店卖的物品设置 hiddenFromShop 或 remoteOnly。
- 视觉资源 key 与 item id 一致。
- WebP 是透明背景且体积足够小。

## 十二、常见问题

### 1. 星球里看不到专属商品

优先检查：

1. 星球的 `shopItemUrl` 是否填写。
2. 文件路径是否正确。
3. 文件是否在 `famous-planets/` 下。
4. JSON 是否包含 `SHOP_ITEMS`。
5. 商品是否被 `hiddenFromShop` 或 `remoteOnly` 隐藏。
6. 是否已经迁移到该官方星球。
7. 浏览器是否缓存了旧 JSON，刷新页面或加 no-cache 测试。

### 2. 商品买了但不能摆放

检查：

- item 的 `type` 是否是 `furniture` 或 `house`。
- item 的 `fields` 是否包含当前区域。
- 当前星球 field 的 `typeId` 是什么。
- 室内家具是否使用了正确房间 ID。
- 房屋是否有 `rooms`。

### 3. 场景在星球工具里找不到

检查：

- 场景是否已保存到 `pet-story/presets/scenes.json`。
- 场景 JSON 是否合法。
- 星球工具是否点击刷新。
- 页面是否因缓存读取了旧文件。

### 4. 宠物生成后只有一张图，不像 4x4

检查：

- Prompt 是否明确要求 4x4 sprite sheet。
- 图片模型是否选择 Gemini 3.1 PRO。
- 是否提供了过强的单图参考，导致模型忽略网格。
- 重新生成时强化“16 cells、4 rows、4 columns、transparent background、same character”。

### 5. 商店视觉图不显示

检查：

- `DECO_VISUALS` 的 key 是否等于 item id。
- visual 里是否有 `svg` 或 `imageUrl`。
- SVG 是否合法。
- imageUrl 是否能访问。
- item 自身是否也写了冲突的 imageUrl/svg。

### 6. 保存后本地文件没变

这些工具主要通过 KeepworkSDK 写 workspace。项目本地 JSON 和 workspace JSON 可能存在读取优先级差异。若你在本地开发时需要确认最终内容：

- 使用工具的“复制 JSON”或“下载 index”功能保存最终内容。
- 检查 workspace 写入是否成功。
- 重新打开工具，确认它能读取刚保存的内容。
- 游戏运行时通常优先读取项目路径下对应 JSON；发布前要确保项目文件和 workspace 内容一致。

## 十三、维护建议

- 新内容先小批量测试，再批量生成。
- 星球、场景、商店文件改动要一起验证，因为它们互相引用。
- 不要轻易改已上线的 ID；需要重命名时，保留旧 ID 或做迁移方案。
- 专属商店尽量导出差异，减少重复数据。
- 默认商店放通用内容，星球专属商店放主题内容。
- 宠物图要比其他图更严格检查一致性。
- 场景图要保证可承载宠物、家具和 UI，不要做成纯插画海报。
- 每次大批量生成后，使用工具的修复/检查功能清理 data URL、大体积图片和不规范资源。
