# AI回复总结评论 智能体接口 API 文档

## 🚀 快速开始

### 1. 启动 API 服务

```bash
cd AI回复总结评论
python agent_api.py
```

服务将启动在 `http://localhost:8000`

### 2. API 文档

启动后访问自动生成的交互式文档：
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### 3. 配置 API Key

```bash
# 在 .env 文件中添加
API_KEY=your-secret-api-key-change-me
```

---

## 🔐 认证

所有 API 请求需要在 Header 中添加：

```http
X-API-Key: your-api-key
```

示例：

```bash
curl -X POST "http://localhost:8000/api/v1/comments/fetch" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"platform": "bilibili", "post_id": "BV1xx411c7mD"}'
```

---

## 📡 接口协议

### 1. REST API

标准 HTTP 请求，最通用。

#### 端点列表

| 方法 | 路径 | 描述 |
|:---:|:---|:---|
| POST | `/api/v1/platforms` | 获取支持的平台列表 |
| POST | `/api/v1/platforms/{platform}/test` | 测试平台连接 |
| POST | `/api/v1/comments/fetch` | 拉取评论 |
| GET | `/api/v1/comments/{post_id}` | 获取评论列表 |
| POST | `/api/v1/analyze` | 分析评论（AI） |
| POST | `/api/v1/analyze/deep` | 深度分析 |
| POST | `/api/v1/report/generate` | 生成报告 |
| GET | `/api/v1/reports` | 获取报告列表 |
| POST | `/api/v1/reply/prepare` | 准备自动回复 |
| POST | `/api/v1/reply/publish` | 批量发布回复 |
| POST | `/api/v1/webhooks` | 注册 Webhook |
| DELETE | `/api/v1/webhooks/{id}` | 取消注册 Webhook |

#### 使用示例

**拉取 B站评论：**

```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/comments/fetch",
    headers={"X-API-Key": "your-api-key"},
    json={
        "platform": "bilibili",
        "post_id": "BV1xx411c7mD",
        "max_count": 100
    }
)

data = response.json()
print(f"成功拉取 {data['data']['comments_count']} 条评论")
```

**分析评论：**

```python
response = requests.post(
    "http://localhost:8000/api/v1/analyze",
    headers={"X-API-Key": "your-api-key"},
    json={
        "platform": "bilibili",
        "post_id": "BV1xx411c7mD"
    }
)

data = response.json()
print(f"情感分布: {data['data']['sentiment_stats']}")
```

**生成报告：**

```python
response = requests.post(
    "http://localhost:8000/api/v1/report/generate",
    headers={"X-API-Key": "your-api-key"},
    json={
        "platform": "bilibili",
        "post_id": "BV1xx411c7mD",
        "include_deep_analysis": True
    }
)

data = response.json()
report_content = data['data']['report_content']
```

---

### 2. WebSocket

双向实时通信。

#### 连接

```python
import websockets
import json

async def main():
    async with websockets.connect("ws://localhost:8000/ws") as ws:
        # 订阅事件
        await ws.send(json.dumps({
            "type": "subscribe",
            "events": ["comments_fetched", "analysis_complete"]
        }))

        # 接收消息
        async for message in ws:
            data = json.loads(message)
            print(f"收到: {data}")

            # 发送 ping
            if data.get("type") == "ping":
                await ws.send(json.dumps({"type": "pong"}))

asyncio.run(main())
```

#### 发送请求

```python
# 拉取评论
await ws.send(json.dumps({
    "type": "fetch_comments",
    "platform": "bilibili",
    "post_id": "BV1xx411c7mD"
}))
```

---

### 3. MCP (Model Context Protocol)

现代化智能体通信标准。

#### MCP 工具列表

| 工具名称 | 描述 | 参数 |
|:---|:---|:---|
| `fetch_comments` | 拉取评论 | `platform`, `post_id` |
| `analyze_comments` | 分析评论 | `platform`, `post_id` |
| `generate_report` | 生成报告 | `platform`, `post_id` |
| `deep_analyze` | 深度分析 | `platform`, `post_id` |

#### MCP 连接示例

```python
import websockets
import json

async def mcp_example():
    async with websockets.connect("ws://localhost:8000/mcp/ws") as ws:
        # 1. 初始化
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }))

        response = await ws.recv_json()
        print(f"初始化响应: {response}")

        # 2. 列出可用工具
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }))

        response = await ws.recv_json()
        tools = response['result']['tools']
        print(f"可用工具: {[t['name'] for t in tools]}")

        # 3. 调用工具
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "fetch_comments",
                "arguments": {
                    "platform": "bilibili",
                    "post_id": "BV1xx411c7mD"
                }
            }
        }))

        response = await ws.recv_json()
        result = response['result']['content'][0]['text']
        data = json.loads(result)
        print(f"拉取结果: {data['comments_count']} 条评论")

asyncio.run(mcp_example())
```

#### MCP 与 OpenAI Agents SDK 集成

```python
from agents import Agent, function_tool
import websockets
import json

# 创建 MCP WebSocket 工具
@function_tool
def ai-reply-summary_tool(tool_name: str, platform: str, post_id: str):
    """调用 AI回复总结评论 MCP 工具"""

    async def call_mcp():
        async with websockets.connect("ws://localhost:8000/mcp/ws") as ws:
            # 初始化
            await ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize"
            }))
            await ws.recv()

            # 调用工具
            await ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": {"platform": platform, "post_id": post_id}
                }
            }))

            response = await ws.recv_json()
            return response['result']['content'][0]['text']

    return json.loads(asyncio.run(call_mcp()))

# 创建 Agent
agent = Agent(
    name="AI回复总结评论 Analyst",
    instructions="你是一个社交媒体分析专家，可以使用 AI回复总结评论 工具分析评论。",
    tools=[ai-reply-summary_tool]
)

# 使用
result = agent.run("分析 B站视频 BV1xx411c7mD 的评论，生成报告")
```

---

### 4. Webhook

事件驱动通知。

#### 注册 Webhook

```python
response = requests.post(
    "http://localhost:8000/api/v1/webhooks",
    headers={"X-API-Key": "your-api-key"},
    json={
        "url": "https://your-app.com/webhook",
        "events": ["analysis_complete", "report_generated"],
        "secret": "your-webhook-secret"
    }
)

webhook_id = response.json()['data']['webhook_id']
```

#### Webhook 事件

| 事件名 | 描述 | 数据 |
|:---|:---|:---|
| `analysis_complete` | AI 分析完成 | `post_id`, `platform`, `analyzed_count` |
| `report_generated` | 报告生成完成 | `post_id`, `platform`, `report_path` |
| `reply_published` | 回复发布完成 | `post_id`, `platform`, `results` |

#### Webhook 接收示例 (Flask)

```python
from flask import Flask, request, jsonify
import hmac
import hashlib

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    # 验证签名
    signature = request.headers.get('X-Webhook-Signature')
    secret = 'your-webhook-secret'

    expected = hmac.new(
        secret.encode(),
        request.data,
        hashlib.sha256
    ).hexdigest()

    if signature != expected:
        return jsonify({"error": "Invalid signature"}), 401

    # 处理事件
    event = request.json
    event_type = event.get('type')

    if event_type == 'analysis_complete':
        print(f"分析完成: {event['data']}")
    elif event_type == 'report_generated':
        print(f"报告生成: {event['data']}")

    return jsonify({"status": "ok"})

app.run(port=5000)
```

---

## 📊 OpenClow 集成示例

### 场景：OpenClow 调用 AI回复总结评论 分析视频评论

#### 步骤 1: 配置连接

在 OpenClow 中配置 API 端点：
- 地址: `http://your-server:8000`
- API Key: `your-api-key`

#### 步骤 2: 创建工作流

```yaml
# openclow_workflow.yml
name: 评论分析工作流
trigger:
  type: manual

steps:
  - name: fetch_comments
    action: http.request
    config:
      method: POST
      url: http://your-server:8000/api/v1/comments/fetch
      headers:
        X-API-Key: your-api-key
      body:
        platform: bilibili
        post_id: ${input.post_id}
        max_count: 100

  - name: analyze
    action: http.request
    config:
      method: POST
      url: http://your-server:8000/api/v1/analyze
      body:
        platform: bilibili
        post_id: ${input.post_id}

  - name: generate_report
    action: http.request
    config:
      method: POST
      url: http://your-server:8000/api/v1/report/generate
      body:
        platform: bilibili
        post_id: ${input.post_id}
        include_deep_analysis: true

  - name: notify
    action: websocket.send
    config:
      url: ws://openclow-server/ws
      message: |
        评论分析完成！
        报告: ${steps.generate_report.output.report_path}
```

#### 步骤 3: MCP 集成

如果 OpenClow 支持 MCP 协议：

```python
# openclow_mcp_config.json
{
  "mcpServers": {
    "ai-reply-summary": {
      "command": "websocket",
      "args": ["ws://your-server:8000/mcp/ws"]
    }
  }
}
```

在 OpenClow 中直接使用工具：

```
分析 B站视频 BV1xx411c7mD 的评论
→ MCP 调用: tools/call(fetch_comments)
→ MCP 调用: tools/call(analyze_comments)
→ MCP 调用: tools/call(generate_report)
```

---

## 🔧 配置

### 环境变量

```bash
# API 配置
API_HOST=0.0.0.0              # 监听地址
API_PORT=8000                 # 监听端口
API_KEY=your-secret-key       # API 密钥
DEBUG=false                   # 调试模式

# AI 配置（继承主程序配置）
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-3.5-turbo

# 数据库
DB_PATH=ai-reply-summary.db
```

### 启动选项

```bash
# 默认启动
python agent_api.py

# 自定义端口
API_PORT=9000 python agent_api.py

# 调试模式
DEBUG=true python agent_api.py

# 自定义 API Key
API_KEY=my-secret-key python agent_api.py
```

---

## 🛡️ 安全建议

1. **使用强 API Key**: 使用随机字符串，不要使用默认值
2. **限制访问**: 通过防火墙限制只有授权 IP 可以访问 API
3. **HTTPS**: 生产环境建议使用 Nginx 反向代理并启用 HTTPS
4. **速率限制**: 可以添加 `slowapi` 等中间件实现速率限制
5. **Webhook 签名**: 验证 Webhook 签名防止伪造请求

---

## 📝 错误码

| 状态码 | 描述 |
|:---:|:---|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 缺少 API Key |
| 403 | API Key 无效 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 503 | AI 服务未配置 |

---

## 💬 获取帮助

- 📖 API 文档: http://localhost:8000/docs
- 🐛 问题反馈: GitHub Issues
- 📧 联系方式: support@example.com
