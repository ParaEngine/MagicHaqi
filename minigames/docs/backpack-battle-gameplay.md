# 哈奇快送·背包大乱斗 — 玩法与扩展手册

文件：`minigames/haqi_backpack_battle.html` ｜ 注册 id：`backpack_battle`

> 一句话：拼手速不如拼收纳。在哈奇小镇送外卖，把整条商业街塞进四次元背包，靠**位置羁绊**一键碾压奇葩顾客。
> 品类：纯 2D 网格背包收纳（俄罗斯方块形状 + 旋转）+ 自动回合制肉鸽对战。性能零压力（DOM 面板数值对撞，无满屏碰撞体）。

## 核心循环

1. **商店阶段**：每回合刷新 4 件随机形状道具。买下 → 点亮起的格子放下 → `🔄旋转` 调整朝向。点已放置道具可挪位/卖出。
2. **送单阶段**：点「开始送单 ⚔️」，双方背包内道具按各自冷却条自动触发（攻击/回血/上盾），纯数值对撞看自己的 Build 输出。
3. 赢 → 拿报酬 + 利息，进入下一单（敌人按回合缩放，每 5 单刷 Boss「暴躁的西峙老板」）。输 → 扣心或看广告免罚。3 颗心耗尽即今日打烊。

## 元素系统（严格区分风 / 雷）

| 元素 | 配色 | 机制 | 代表道具 |
|------|------|------|----------|
| **风 wind** | 青绿 | 加速 / 连击：被动光环让**相邻武器攻速**提升；部分风武器有连击概率 | 疾风手里剑（相邻武器攻速+30%）、清风铃（纯辅助+20%） |
| **雷 light** | 亮紫 | 传导 / 爆发：触发时向**周围 8 格**每件道具传导，附加**无视护盾的真实伤害**——围得越密越猛 | 雷霆护身符、特斯拉线圈、暴走电池（相邻雷道具传导+4） |

羁绊在开战瞬间结算：`buildPlayerModules()` 先算每件道具的 8 向邻接表，再吸收相邻光环（haste 降冷却、conductAdd 加传导）。雷电传导在运行时按邻居数实时叠加真实伤害。

## 商业化（与设计方案一一对应）

- **B 端 O2O 神器**（`game_config.merchantItems`）：真实商户产品 = 游戏内神级道具。
  - 麦香晨光法棍 🥖（1×4，每次攻击 +最大生命，越打越肉）；西峙特调 ☕、深圳炸鸡桶 🍗、哈奇奶茶 🧋。
  - 带着商家神器**通关该单**，结算弹出实体兑换券（如「麦香晨光 8 折券」），一键`📲存入微信卡包` → 向父页面发 `haqi_coupon` 事件，形成 O2O 闭环。
- **C 端 IAA 激励视频**（`playRewardedAd()`，当前为模拟占位，向父页面发 `haqi_rewarded_ad`，可接真实广告 SDK）：
  1. 背包塞不下 → 看广告本局背包**永久 +2 格**。
  2. 商店太贵 → 「金主赞助」免费刷新且**必出一件限定神器**。
  3. 送单失败 → 看广告让顾客「消消气」，**免除失败惩罚**。

## AI 量产：写 JSON 即上新

内核读配置即玩，制作人无需碰引擎逻辑。新增一件道具只需往 `game_config.items`（或 `merchantItems`）加一行：

```js
{ id:"sz_chicken", name:"深圳炸鸡桶", emoji:"🍗", rar:"merchant", cost:0,
  shape:"sq", el:"fire", kind:"weapon", dmg:26, cd:2.4,
  brand:"鹏城脆皮炸鸡", coupon:"脆皮炸鸡 买一送一券", desc:"2×2 神级重击。" }
```

字段说明：
- `shape` ∈ `game_config.shapes`（s1/h2/v2/h3/v3/h4/sq/L/T；相对坐标，自带旋转）。
- `el` ∈ `none/wind/light/fire/heal/shield`（决定配色与元素逻辑）。
- `kind` ∈ `weapon/heal/shield/aura`。
- 可选：`aura{target:'weapon'|'all'|'light', haste, conductAdd}`、`conduct`(雷传导基数)、`combo`(连击率)、`onhitMaxHp`、`brand`/`coupon`(B 端券)。

深圳哪家店想推广 → AI 生成体素 emoji + 一行 JSON，第二天就能作为「限定神器」出现在玩家背包商店里。

## 宿主消息协议

`gameLoaded` / `gameStarted` / `gameFinished{earnedPoints, round, coupons}`，并响应 `setGameConfig`。额外业务事件：`haqi_coupon{brand,coupon,item}`、`haqi_rewarded_ad{label}`。

## 已验证

无头引擎冒烟测试 9/9 通过：形状旋转、放置边界/锁格、风光环降冷却、雷传导生效、电池叠加传导、对战正常结束、Boss 排期。
