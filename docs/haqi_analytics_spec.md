# 哈奇星球产品埋点与运营看板契约

## 目标

本契约用于哈奇星球邀请测试阶段的数据采集和欧阳运营看板。前端通过 KeepworkSDK 上报匿名产品事件，后端按事件 ID 去重、聚合，并向独立运营页提供只读查询接口。

游戏端事件名称格式：

```text
haqiGame.product.<event_name>
```

当前实现使用 KeepworkSDK 的匿名产品事件接口：

```js
sdk.remoteLog.logAnonymousProductEvent('haqiGame', eventName, properties)
```

SDK 自动生成 `haqiGame.product.<eventName>` 动作名，只接受扁平字符串、有限数值和布尔值，过滤账号、昵称、伙伴名和凭据类字段，并且匿名接口不附加 SDK 登录 token。远端上报失败不会阻塞游戏，事件仍保存在浏览器本地队列中。

## 稳定性规则

1. 已发布事件只增加可选字段，不修改事件名称和原字段语义。
2. 曝光、点击、开始、完成是不同事件，不能互相代替。
3. 完成事件绑定业务真实成功回调，不能用进入页面或按钮点击推测完成。
4. 新流程需要不同语义时新增事件，不复用旧事件承载新含义。
5. 后端以 `eventId` 幂等去重；未知字段应忽略，不能导致整条事件失败。
6. 出现不可兼容升级时新增 `schemaVersion`，旧版本仍按旧口径聚合。

这些规则保证接下来 15～20 天调整首页、美术、流程和新增玩法时，历史指标仍可比较。

## 公共字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `eventId` | string | 页面生成的事件唯一 ID，后端去重键 |
| `eventName` | string | 不含 `haqiGame.product.` 前缀的事件名 |
| `timestamp` | number | 浏览器产生事件的 Unix 毫秒时间 |
| `visitorId` | string | 浏览器本地生成的匿名稳定 ID |
| `sessionId` | string | 每次页面加载生成的新会话 ID |
| `planetId` | string | 当前星球，哈奇星球为 `haqi` |
| `accessMode` | string | `account`、`guest` 或 `anonymous` |
| `viewport` | string | `mobile`、`pad` 或 `desktop` |

所有字符串在游戏端截断至 80 个字符；单条事件最多保留 16 个扁平属性。嵌套对象、数组和非有限数值不会上报。

## 事件字典

### 当前已接入

| 事件 | 触发语义 | 关键字段 |
| --- | --- | --- |
| `session_started` | 游戏完成启动并进入首个视图 | `landingView` |
| `home_mission_viewed` | 首页今日主目标实际展示 | `missionType`、`missionComplete` |
| `home_mission_clicked` | 用户主动点击首页今日主目标 | `missionType`、`careStat` |
| `home_mission_completed` | 今日首页主目标满足真实完成条件 | `missionType` |
| `care_action_started` | 用户从首页目标开始照料 | `careStat`、`source` |
| `town_interaction_completed` | NPC 小镇互动返回完成结果并保存关系进度 | `fieldId`、`npcId`、`interactionId`、`interactionType` |
| `minigame_started` | 小游戏宿主创建一局实际游戏 | `gameId`、`gameType` |
| `minigame_finished` | 小游戏返回有效结算且完成归一化 | `gameId`、`completed`、`passed`、`durationSeconds`、`rewardCoins` |
| `reward_acquired` | 远征重要奖励完成入账和保存；伙伴仅在 `savePet` 成功后记录 | `source`、`rewardType`、`quantity`；伙伴可选 `rareQuantity`、`newSpeciesQuantity` |
| `reward_viewed` | 用户从成果页或背包主动进入奖励后续查看流程 | `source`、`rewardType`；可选 `rewardId`、`quantity`、`action` |
| `reward_placed` | 家园珍宝布局真实保存成功 | `source`、`rewardType`、`rewardId`、`firstPlacement` |
| `reward_share_card_generated` | 成果分享卡完成系统分享或 PNG 下载 | `source`、`rewardType`、`highlightCount` |
| `expedition_started` | 远征参数完成并正式进入远征 | `runId`、`expeditionId`、`onboardingFirstRun` |
| `expedition_finished` | 远征收到有效最终结算 | `runId`、`expeditionId`、`passed`、`onboardingFirstRun` |
| `expedition_history_reviewed` | 用户主动展开某次远征成果详情；同一次远征只记录一次 | `runId` |
| `onboarding_started` | 用户开始新手航线 | `taskId` |
| `onboarding_deferred` | 用户主动稍后处理新手航线 | `taskId` |
| `onboarding_task_completed` | 新手任务真实完成并发奖 | `taskId`、`rewardCoins` |
| `return_route_viewed` | 次日航线展示 | `dayKey` |
| `return_route_started` | 次日航线完成首个步骤 | `dayKey`、`firstStepId` |
| `return_route_step_completed` | 次日航线步骤完成 | `dayKey`、`stepId`、`completedCount` |
| `return_route_completed` | 次日航线全部完成并发奖 | `dayKey`、`rewardCoins` |
| `unlock_requested` | 小游戏请求广告或会员解锁 | `gameId`、`scene` |
| `unlock_finished` | 解锁流程返回结果 | `gameId`、`scene`、`ok`、`method` |
| `vip_payment_opened` | 打开会员支付流程 | `gameId`、`scene`、`planId` |
| `vip_status_verified` | SDK 返回可验证会员状态 | `gameId`、`isVip` |

`reward_acquired`、`reward_viewed`、`reward_placed` 和 `reward_share_card_generated` 分别表示获得、查看、摆放和完成分享卡输出，不可互相替代。伙伴奖励只上报数量、品质汇总和是否发现新物种的数量，不发送玩家自定义伙伴名；分享卡内容可以在本机显示伙伴名，但远端事件只上报成果类型和数量。

未接入事件在看板中应显示“尚未采集”，不能解释为零转化。

## 聚合指标口径

| 指标 | 公式 |
| --- | --- |
| 唯一访客 | 日期范围内 `visitorId` 去重数 |
| 会话 | `session_started.sessionId` 去重数 |
| D1 可观察访客 | 首访日早于查询范围最后一天的访客数 |
| D1 回访访客 | 首访次日存在任意事件的可观察访客数 |
| D1 回访率 | D1 回访访客 / D1 可观察访客 |
| 首页目标点击率 | 点击目标的唯一访客 / 看到目标的唯一访客 |
| 首页目标完成率 | 完成目标的唯一访客 / 看到目标的唯一访客 |
| 远征完成率 | 完成远征的唯一访客 / 开始远征的唯一访客 |

前 15 分钟漏斗以每个访客首次事件为窗口起点，只统计起点后 15 分钟内发生的事件：

1. `session_started`：进入产品。
2. `home_mission_viewed`：看到今日目标。
3. `care_action_started`：开始照料伙伴。
4. `minigame_finished`：完成小镇互动或小游戏。
5. `expedition_started`：开始首次远征。
6. `expedition_finished`：完成首次远征。

## 聚合 API

后端 Event Gateway 已提供：

```http
GET /api/haqi/analytics/operations?startDate=2026-08-26&endDate=2026-09-15
Accept: application/json
X-API-Key: <read-only-key>
```

API key 必须是只读、限本接口、可轮换的运营 key。不要使用管理型 key，不要把 key 放在 URL、Git、静态 HTML 或聊天记录中。

服务部署配置：

| 环境变量 | 说明 |
| --- | --- |
| `HAQI_ANALYTICS_ES_INDEX` | 消费 `haqiGame` 事件的 Elasticsearch 索引或索引模式 |
| `HAQI_ANALYTICS_READ_KEY` | 运营看板专用只读 key |
| `HAQI_ANALYTICS_MAX_EVENTS` | 单次查询安全上限，默认 `100000` |

查询日期按 UTC 自然日计算，首尾日期都包含，最大跨度 31 天。后端分页读取事件并按 `eventId` 去重；超过安全上限时返回 `413`，不会返回被静默截断的指标。未配置索引或 key 时返回 `503`。

Elasticsearch 消费索引需保留 `category`、`action` 和 `data.*`：`category`/`action` 支持精确或前缀查询，`data.timestamp` 可排序，`data.eventId.keyword` 为可排序 keyword，作为同毫秒事件的稳定分页键。

看板仍兼容两种响应；生产接口返回“后端聚合响应”。

### 匿名事件响应

```json
{
  "events": [
    {
      "id": "event-id",
      "name": "session_started",
      "timestamp": 1787673600000,
      "visitorId": "v_anonymous-id",
      "sessionId": "s_session-id",
      "properties": {
        "planetId": "haqi",
        "accessMode": "guest",
        "viewport": "mobile",
        "landingView": "home"
      }
    }
  ]
}
```

### 后端聚合响应

```json
{
  "metrics": {
    "eventCount": 1200,
    "visitorCount": 80,
    "sessionCount": 126,
    "d1": { "eligibleVisitors": 62, "retainedVisitors": 15, "rate": 24.2 },
    "mission": { "viewedVisitors": 75, "clickedVisitors": 56, "completedVisitors": 38, "clickRate": 74.7, "completionRate": 50.7 },
    "expedition": { "startedVisitors": 42, "finishedVisitors": 29, "completionRate": 69.0 },
    "funnel": [],
    "devices": { "mobile": 41, "pad": 9, "desktop": 30 }
  }
}
```

## 看板使用

运营页：`analytics/haqi-operations-dashboard.html`

- “聚合 API”模式通过 `X-API-Key` 请求头读取；key 只保留在当前页面输入框内存中。
- “导入 JSON”模式用于后端尚未上线时验证事件导出或离线数据。
- 支持按日期过滤原始事件，支持导出当前聚合结果为 CSV 或 JSON。
- 页面默认空白，不生成模拟数据，避免把示例误当真实运营结果。

## 下一阶段验收清单

每个新增或优化功能至少检查：

1. 是否复用已有事件语义；如果不是，是否新增事件。
2. 开始和完成是否绑定真实业务节点。
3. 是否只上报匿名、扁平、白名单字段。
4. 远端失败是否不影响游戏和本地记录。
5. 专项测试和 Playwright 是否验证事件只发一次且字段正确。
6. 欧阳看板是否明确区分“零数据”和“尚未采集”。