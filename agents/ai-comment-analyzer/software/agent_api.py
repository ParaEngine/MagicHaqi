"""
AI回复总结评论 - 智能体接口服务
支持 REST API、MCP、WebSocket、Webhook 等多种智能体通信协议
"""

import os
import asyncio
import json
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager

# 导入核心模块
from database import Database
from platforms.factory import CollectorFactory
from ai_analyzer import AIAnalyzer
from report_generator import ReportGenerator
from reply_manager import ReplyManager

# API 配置
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
API_KEY = os.getenv("API_KEY", "your-secret-api-key-change-me")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"


# ============ API 数据模型 ============

class PlatformRequest(BaseModel):
    """平台请求基础模型"""
    platform: str = Field(..., description="平台名称: twitter, bilibili, xiaohongshu, weibo, douyin")


class FetchCommentsRequest(PlatformRequest):
    """拉取评论请求"""
    post_id: str = Field(..., description="帖子/视频 ID 或链接")
    max_count: Optional[int] = Field(100, description="最大评论数")
    config: Optional[dict] = Field(default_factory=dict, description="平台配置（Cookie等）")


class AnalyzeCommentsRequest(PlatformRequest):
    """分析评论请求"""
    post_id: str = Field(..., description="帖子 ID")


class GenerateReportRequest(PlatformRequest):
    """生成报告请求"""
    post_id: str = Field(..., description="帖子 ID")
    include_deep_analysis: bool = Field(True, description="包含深度分析")


class AutoReplyRequest(PlatformRequest):
    """自动回复请求"""
    post_id: str = Field(..., description="帖子 ID")
    auto_mode: bool = Field(False, description="全自动模式（不需确认）")
    like_threshold: float = Field(3.0, description="点赞阈值百分比")


class TopicSearchRequest(PlatformRequest):
    """主题搜索分析请求"""
    keyword: str = Field(..., description="搜索关键词/主题")
    max_posts: int = Field(10, description="最多抓取帖子数")
    max_comments_per_post: int = Field(50, description="每个帖子最多抓取评论数")
    include_ai_analysis: bool = Field(True, description="是否自动进行 AI 情感/意图分析")
    config: Optional[dict] = Field(default_factory=dict, description="平台配置（Cookie等）")


class WebhookConfig(BaseModel):
    """Webhook 配置"""
    url: str
    events: list[str] = ["analysis_complete", "report_generated", "reply_published"]
    secret: Optional[str] = None


class APIResponse(BaseModel):
    """通用 API 响应"""
    success: bool
    message: str
    data: Optional[dict] = None
    error: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())


# ============ 全局变量 ============

db: Database = None
ai_analyzer: AIAnalyzer = None
report_generator: ReportGenerator = None
reply_manager: ReplyManager = None
connected_websockets: list[WebSocket] = []
webhook_configs: dict[str, WebhookConfig] = {}


# ============ 生命周期 ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global db, ai_analyzer, report_generator, reply_manager

    # 启动时初始化
    print("🚀 初始化智能体接口服务...")
    db = Database("socialecho.db")
    report_generator = ReportGenerator("reports")
    reply_manager = ReplyManager(db)

    print(f"✅ 服务已启动")
    print(f"   端口: {API_PORT}")
    print(f"   API Key: {API_KEY[:8]}...")
    print(f"   调试模式: {DEBUG}")

    yield

    # 关闭时清理
    print("\n🛑 关闭智能体接口服务...")


# ============ FastAPI 应用 ============

app = FastAPI(
    title="AI回复总结评论 - Agent API",
    description="""
## 智能体接口服务

支持多种智能体通信协议：
- **REST API**: 标准 HTTP 接口
- **WebSocket**: 双向实时通信
- **MCP**: Model Context Protocol（现代化智能体通信标准）
- **Webhook**: 事件驱动通知

## 功能

- 📥 拉取多平台评论（Twitter, B站, 小红书, 微博, 抖音）
- 🤖 AI 情感分析、意图识别、摘要生成
- 🔍 深度分析（痛点识别、Bug反馈、改进建议）
- 📄 自动生成分析报告
- 💬 自动回复管理
- 🔔 Webhook 事件通知
- 📡 WebSocket 实时推送

## 认证

所有接口需要在 Header 中添加：
```
X-API-Key: your-api-key
```

## MCP 支持

MCP 协议通过 WebSocket 连接，路径: `/mcp/ws`
    """,
    version="1.0.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ 认证依赖 ============

async def verify_api_key(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    """验证 API Key（从 HTTP Header `X-API-Key` 读取，而非 query 参数）"""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    if x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")
    return True


# ============ 工具函数 ============

def get_ai_analyzer_instance(api_key: str = None) -> Optional[AIAnalyzer]:
    """获取 AI 分析器实例"""
    key = api_key or os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")

    if key:
        return AIAnalyzer(api_key=key, base_url=base_url, model=model)
    return None


def get_platform_collector(platform: str, config: dict = None) -> Optional:
    """获取平台收集器"""
    try:
        config = config or {}
        return CollectorFactory.create(platform, **config)
    except Exception as e:
        print(f"[API] 创建收集器失败: {e}")
        return None


async def send_webhook_notifications(event: str, data: dict):
    """发送 Webhook 通知"""
    for webhook_id, webhook in webhook_configs.items():
        if event in webhook.events:
            try:
                # TODO: 实现 Webhook 发送逻辑
                print(f"[Webhook] 发送通知到 {webhook.url}: {event}")
            except Exception as e:
                print(f"[Webhook] 发送失败: {e}")


async def broadcast_websocket(message: dict):
    """广播 WebSocket 消息"""
    for ws in connected_websockets:
        try:
            await ws.send_json(message)
        except Exception as e:
            print(f"[WebSocket] 广播失败: {e}")


async def run_topic_search_pipeline(
    platform: str,
    keyword: str,
    max_posts: int = 10,
    max_comments_per_post: int = 50,
    include_ai_analysis: bool = True,
    config: Optional[dict] = None,
) -> dict:
    """执行「搜索主题 -> 抓取帖子评论 -> AI分析 -> 生成汇总报告」全流程，供 REST 与 MCP 共用"""
    collector = get_platform_collector(platform, config)
    if not collector:
        return {"success": False, "error": f"不支持的平台: {platform}"}

    posts = collector.search_posts(keyword, max_posts=max_posts)
    if not posts:
        return {"success": False, "error": "未找到相关帖子，请更换关键词，或检查平台配置/登录 Cookie 是否正确"}

    for post in posts:
        db.insert_post(post)

    ai = get_ai_analyzer_instance() if include_ai_analysis else None

    total_comments = 0
    for post in posts:
        pid = post.get("id", "")
        comments = collector.fetch_comments(pid, max_comments=max_comments_per_post)

        if comments:
            for c in comments:
                c["post_id"] = pid
                c["platform"] = platform
            total_comments += db.insert_comments_batch(comments)

        if ai:
            unanalyzed = db.get_unanalyzed_comments(pid, platform)
            analyses = []
            for c in unanalyzed:
                result = ai.analyze_comment(c.get("text", ""))
                if result:
                    analyses.append({
                        "comment_id": c["id"],
                        "platform": platform,
                        "sentiment": result["sentiment"],
                        "intent": result["intent"],
                        "summary": result["summary"],
                        "model": ai.model
                    })
            if analyses:
                db.insert_analyses_batch(analyses)

        await broadcast_websocket({
            "type": "topic_search_progress",
            "platform": platform,
            "keyword": keyword,
            "post_id": pid,
            "comments_count": len(comments) if comments else 0
        })

    report_path = report_generator.generate_topic_report(
        db=db,
        keyword=keyword,
        platform=platform,
        posts_info=posts,
        ai_analyzer=ai,
    )

    with open(report_path, 'r', encoding='utf-8') as f:
        report_content = f.read()

    await send_webhook_notifications("report_generated", {
        "platform": platform,
        "keyword": keyword,
        "report_path": report_path
    })

    return {
        "success": True,
        "keyword": keyword,
        "platform": platform,
        "posts_count": len(posts),
        "posts": posts,
        "comments_count": total_comments,
        "report_path": report_path,
        "report_content": report_content,
    }


# ============ 健康检查 ============

@app.get("/health", tags=["System"])
async def health_check():
    """健康检查"""
    return APIResponse(
        success=True,
        message="Service is healthy",
        data={
            "version": "1.0.0",
            "status": "running",
            "timestamp": datetime.now().isoformat()
        }
    )


@app.get("/", tags=["System"])
async def root():
    """根路径"""
    return {
        "name": "AI回复总结评论 - Agent API",
        "version": "1.0.0",
        "docs": "/docs",
        "mcp_ws": "/mcp/ws"
    }


# ============ 平台管理 ============

@app.post("/api/v1/platforms", response_model=APIResponse, tags=["Platforms"])
async def list_platforms():
    """获取支持的平台列表"""
    platforms = CollectorFactory.get_available_platforms()
    return APIResponse(
        success=True,
        message="获取平台列表成功",
        data={"platforms": platforms}
    )


@app.post("/api/v1/platforms/{platform}/test", response_model=APIResponse, tags=["Platforms"])
async def test_platform_connection(platform: str, config: dict = None, _: bool = Depends(verify_api_key)):
    """测试平台连接"""
    collector = get_platform_collector(platform, config)
    if not collector:
        raise HTTPException(status_code=400, detail=f"不支持的平台: {platform}")

    try:
        result = collector.test_connection()
        return APIResponse(
            success=result.get("success", False),
            message=result.get("message", "测试失败"),
            data=result
        )
    except Exception as e:
        return APIResponse(
            success=False,
            message="连接测试失败",
            error=str(e)
        )


# ============ 评论管理 ============

@app.post("/api/v1/comments/fetch", response_model=APIResponse, tags=["Comments"])
async def fetch_comments(request: FetchCommentsRequest, _: bool = Depends(verify_api_key)):
    """拉取评论"""
    collector = get_platform_collector(request.platform, request.config)
    if not collector:
        raise HTTPException(status_code=400, detail=f"不支持的平台: {request.platform}")

    try:
        # 提取帖子 ID
        post_id = collector.extract_post_id(request.post_id)

        # 获取视频信息
        post_info = collector.get_post_info(post_id)

        # 拉取评论
        comments = collector.fetch_comments(post_id, max_comments=request.max_count)

        # 保存到数据库
        if post_info:
            post_info["platform"] = request.platform
            db.insert_post(post_info)

        for comment in comments:
            comment["post_id"] = post_id
            comment["platform"] = request.platform
        if comments:
            db.insert_comments_batch(comments)

        # 广播 WebSocket
        await broadcast_websocket({
            "type": "comments_fetched",
            "platform": request.platform,
            "post_id": post_id,
            "count": len(comments)
        })

        return APIResponse(
            success=True,
            message=f"成功拉取 {len(comments)} 条评论",
            data={
                "post_id": post_id,
                "post_info": post_info,
                "comments_count": len(comments),
                "comments": comments[:5]  # 只返回前5条作为预览
            }
        )

    except Exception as e:
        return APIResponse(
            success=False,
            message="拉取评论失败",
            error=str(e)
        )


@app.post("/api/v1/comments/{post_id}", response_model=APIResponse, tags=["Comments"])
async def get_comments(post_id: str, request: PlatformRequest, _: bool = Depends(verify_api_key)):
    """获取评论列表"""
    try:
        comments = db.get_comments_by_post(post_id, request.platform)
        return APIResponse(
            success=True,
            message="获取评论成功",
            data={
                "post_id": post_id,
                "count": len(comments),
                "comments": comments
            }
        )
    except Exception as e:
        return APIResponse(
            success=False,
            message="获取评论失败",
            error=str(e)
        )


# ============ AI 分析 ============

@app.post("/api/v1/analyze", response_model=APIResponse, tags=["AI Analysis"])
async def analyze_comments(request: AnalyzeCommentsRequest, _: bool = Depends(verify_api_key)):
    """分析评论"""
    ai = get_ai_analyzer_instance()
    if not ai:
        raise HTTPException(status_code=503, detail="AI 服务未配置")

    try:
        # 获取评论
        comments = db.get_comments_by_post(request.post_id, request.platform)
        if not comments:
            raise HTTPException(status_code=404, detail="未找到评论")

        # 分析评论
        analyses = []
        for i, comment in enumerate(comments):
            result = ai.analyze_comment(comment.get("text", ""))
            if result:
                analyses.append({
                    "comment_id": comment["id"],
                    "platform": request.platform,
                    "sentiment": result["sentiment"],
                    "intent": result["intent"],
                    "summary": result["summary"],
                    "model": ai.model
                })

            # 每10条广播一次进度
            if (i + 1) % 10 == 0:
                await broadcast_websocket({
                    "type": "analysis_progress",
                    "post_id": request.post_id,
                    "progress": (i + 1) / len(comments),
                    "current": i + 1,
                    "total": len(comments)
                })

        # 批量保存
        if analyses:
            db.insert_analyses_batch(analyses)

        # 发送 Webhook
        await send_webhook_notifications("analysis_complete", {
            "post_id": request.post_id,
            "platform": request.platform,
            "analyzed_count": len(analyses)
        })

        # 广播完成
        await broadcast_websocket({
            "type": "analysis_complete",
            "post_id": request.post_id,
            "platform": request.platform,
            "count": len(analyses)
        })

        return APIResponse(
            success=True,
            message=f"成功分析 {len(analyses)} 条评论",
            data={
                "post_id": request.post_id,
                "analyzed_count": len(analyses),
                "sentiment_stats": db.get_sentiment_stats(request.post_id, request.platform),
                "intent_stats": db.get_intent_stats(request.post_id, request.platform)
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        return APIResponse(
            success=False,
            message="分析失败",
            error=str(e)
        )


@app.post("/api/v1/analyze/deep", response_model=APIResponse, tags=["AI Analysis"])
async def deep_analyze(request: AnalyzeCommentsRequest, _: bool = Depends(verify_api_key)):
    """深度分析"""
    ai = get_ai_analyzer_instance()
    if not ai:
        raise HTTPException(status_code=503, detail="AI 服务未配置")

    try:
        # 获取已分析的评论
        comments = db.get_all_comments_with_analysis(request.post_id, request.platform)
        if not comments:
            raise HTTPException(status_code=404, detail="未找到已分析的评论")

        # 深度分析
        insights = ai.analyze_deep_insights(comments, request.platform)

        if not insights:
            raise HTTPException(status_code=500, detail="深度分析失败")

        return APIResponse(
            success=True,
            message="深度分析完成",
            data={
                "post_id": request.post_id,
                "platform": request.platform,
                "insights": insights
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        return APIResponse(
            success=False,
            message="深度分析失败",
            error=str(e)
        )


# ============ 报告生成 ============

@app.post("/api/v1/report/generate", response_model=APIResponse, tags=["Reports"])
async def generate_report(request: GenerateReportRequest, _: bool = Depends(verify_api_key)):
    """生成分析报告"""
    ai = get_ai_analyzer_instance() if request.include_deep_analysis else None

    try:
        # 获取帖子信息
        post_info = db.get_post(request.post_id, request.platform)
        if not post_info:
            raise HTTPException(status_code=404, detail="未找到帖子")

        # 生成报告
        report_path = report_generator.generate_report(
            db=db,
            post_id=request.post_id,
            platform=request.platform,
            post_info=post_info,
            ai_analyzer=ai
        )

        # 发送 Webhook
        await send_webhook_notifications("report_generated", {
            "post_id": request.post_id,
            "platform": request.platform,
            "report_path": report_path
        })

        # 读取报告内容
        with open(report_path, 'r', encoding='utf-8') as f:
            report_content = f.read()

        return APIResponse(
            success=True,
            message="报告生成成功",
            data={
                "post_id": request.post_id,
                "report_path": report_path,
                "report_content": report_content
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        return APIResponse(
            success=False,
            message="报告生成失败",
            error=str(e)
        )


@app.get("/api/v1/reports", response_model=APIResponse, tags=["Reports"])
async def list_reports(_: bool = Depends(verify_api_key)):
    """获取报告列表"""
    try:
        report_dir = "reports"
        if not os.path.exists(report_dir):
            return APIResponse(
                success=True,
                message="暂无报告",
                data={"reports": []}
            )

        reports = [
            {
                "name": f,
                "path": os.path.join(report_dir, f),
                "size": os.path.getsize(os.path.join(report_dir, f)),
                "created": datetime.fromtimestamp(os.path.getctime(os.path.join(report_dir, f))).isoformat()
            }
            for f in os.listdir(report_dir) if f.endswith('.md')
        ]

        reports.sort(key=lambda x: x["created"], reverse=True)

        return APIResponse(
            success=True,
            message="获取报告列表成功",
            data={"reports": reports}
        )

    except Exception as e:
        return APIResponse(
            success=False,
            message="获取报告列表失败",
            error=str(e)
        )


# ============ 主题搜索分析 ============

@app.post("/api/v1/topic/search", response_model=APIResponse, tags=["Topic Search"])
async def search_topic(request: TopicSearchRequest, _: bool = Depends(verify_api_key)):
    """按关键词/主题搜索相关帖子，抓取评论并生成汇总分析报告"""
    try:
        result = await run_topic_search_pipeline(
            platform=request.platform,
            keyword=request.keyword,
            max_posts=request.max_posts,
            max_comments_per_post=request.max_comments_per_post,
            include_ai_analysis=request.include_ai_analysis,
            config=request.config,
        )

        if not result.get("success"):
            return APIResponse(
                success=False,
                message="主题搜索失败",
                error=result.get("error", "未知错误")
            )

        return APIResponse(
            success=True,
            message=f"找到 {result['posts_count']} 个帖子，共拉取 {result['comments_count']} 条评论，报告已生成",
            data=result
        )

    except Exception as e:
        return APIResponse(
            success=False,
            message="主题搜索失败",
            error=str(e)
        )


# ============ 自动回复 ============

@app.post("/api/v1/reply/prepare", response_model=APIResponse, tags=["Auto Reply"])
async def prepare_replies(request: AutoReplyRequest, _: bool = Depends(verify_api_key)):
    """准备自动回复"""
    try:
        # 获取已分析的评论
        analyzed_comments = db.get_all_comments_with_analysis(request.post_id, request.platform)
        if not analyzed_comments:
            raise HTTPException(status_code=404, detail="未找到已分析的评论")

        # 获取帖子点赞数
        post = db.get_post(request.post_id, request.platform)
        post_like_count = post.get("like_count", 0) if post else 0

        # 筛选需要回复的评论
        comments_to_reply = reply_manager.filter_comments_for_reply(
            analyzed_comments,
            post_like_count,
            request.like_threshold
        )

        # 生成回复
        generated = []
        for comment in comments_to_reply:
            reply_text = f"感谢你的反馈！"
            generated.append({
                "comment_id": comment.get("id"),
                "post_id": request.post_id,
                "platform": request.platform,
                "original_comment": comment.get("text", ""),
                "sentiment": comment.get("sentiment", ""),
                "intent": comment.get("intent", ""),
                "generated_reply": reply_text,
                "like_count": comment.get("like_count", 0),
                "reason": comment.get("_reply_reason", "")
            })

        # 保存回复
        if generated:
            reply_manager.save_replies(generated)

        return APIResponse(
            success=True,
            message=f"准备 {len(generated)} 条回复",
            data={
                "post_id": request.post_id,
                "count": len(generated),
                "replies": generated
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        return APIResponse(
            success=False,
            message="准备回复失败",
            error=str(e)
        )


@app.post("/api/v1/reply/publish", response_model=APIResponse, tags=["Auto Reply"])
async def publish_replies(post_id: str, platform: str, _: bool = Depends(verify_api_key)):
    """批量发布回复"""
    try:
        collector = get_platform_collector(platform)
        if not collector:
            raise HTTPException(status_code=400, detail=f"不支持的平台: {platform}")

        pending = db.get_pending_replies(post_id, platform)
        if not pending:
            raise HTTPException(status_code=404, detail="没有待发布的回复")

        # 发布回复
        results = reply_manager.publish_batch_replies(
            pending,
            collector,
            platform,
            interval=60 if platform == "bilibili" else 10
        )

        # 发送 Webhook
        await send_webhook_notifications("reply_published", {
            "post_id": post_id,
            "platform": platform,
            "results": results
        })

        return APIResponse(
            success=True,
            message=f"发布完成",
            data={
                "post_id": post_id,
                "success_count": results.get("success", 0),
                "failed_count": results.get("failed", 0),
                "errors": results.get("errors", [])
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        return APIResponse(
            success=False,
            message="发布回复失败",
            error=str(e)
        )


# ============ Webhook 管理 ============

@app.post("/api/v1/webhooks", response_model=APIResponse, tags=["Webhooks"])
async def register_webhook(webhook: WebhookConfig, _: bool = Depends(verify_api_key)):
    """注册 Webhook"""
    webhook_id = f"wh_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    webhook_configs[webhook_id] = webhook

    return APIResponse(
        success=True,
        message="Webhook 注册成功",
        data={"webhook_id": webhook_id}
    )


@app.delete("/api/v1/webhooks/{webhook_id}", response_model=APIResponse, tags=["Webhooks"])
async def unregister_webhook(webhook_id: str, _: bool = Depends(verify_api_key)):
    """取消注册 Webhook"""
    if webhook_id in webhook_configs:
        del webhook_configs[webhook_id]
        return APIResponse(
            success=True,
            message="Webhook 取消注册成功"
        )
    raise HTTPException(status_code=404, detail="Webhook 不存在")


# ============ WebSocket ============

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 实时通信"""
    await websocket.accept()
    connected_websockets.append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            # 处理消息
            msg_type = message.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "subscribe":
                # 订阅事件
                await websocket.send_json({
                    "type": "subscribed",
                    "events": message.get("events", [])
                })

            elif msg_type == "fetch_comments":
                # 处理拉取评论请求
                post_id = message.get("post_id")
                platform = message.get("platform")

                await websocket.send_json({
                    "type": "status",
                    "message": "开始拉取评论..."
                })

                # TODO: 实现异步评论拉取

            elif msg_type == "analyze":
                # 处理分析请求
                await websocket.send_json({
                    "type": "status",
                    "message": "开始分析评论..."
                })

    except WebSocketDisconnect:
        connected_websockets.remove(websocket)
    except Exception as e:
        print(f"[WebSocket] 错误: {e}")
        connected_websockets.remove(websocket)


# ============ MCP 协议支持 ============

@app.websocket("/mcp/ws")
async def mcp_websocket(websocket: WebSocket):
    """MCP (Model Context Protocol) WebSocket 端点"""
    await websocket.accept()

    try:
        while True:
            # 接收 MCP 请求
            request = await websocket.receive_json()

            # 处理 MCP 请求
            response = await handle_mcp_request(request)

            # 发送响应
            await websocket.send_json(response)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[MCP] 错误: {e}")


async def handle_mcp_request(request: dict) -> dict:
    """处理 MCP 请求"""

    method = request.get("method")
    params = request.get("params", {})

    # MCP 方法路由
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {}
                },
                "serverInfo": {
                    "name": "ai-reply-summary-comments",
                    "version": "1.0.0"
                }
            }
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "tools": [
                    {
                        "name": "fetch_comments",
                        "description": "拉取指定平台的评论",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string", "enum": ["twitter", "bilibili", "xiaohongshu", "weibo", "douyin"]},
                                "post_id": {"type": "string"}
                            },
                            "required": ["platform", "post_id"]
                        }
                    },
                    {
                        "name": "analyze_comments",
                        "description": "使用 AI 分析评论",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string"},
                                "post_id": {"type": "string"}
                            },
                            "required": ["platform", "post_id"]
                        }
                    },
                    {
                        "name": "generate_report",
                        "description": "生成分析报告",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string"},
                                "post_id": {"type": "string"}
                            },
                            "required": ["platform", "post_id"]
                        }
                    },
                    {
                        "name": "deep_analyze",
                        "description": "深度分析评论，提取痛点、Bug、建议、优先级排序",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string"},
                                "post_id": {"type": "string"}
                            },
                            "required": ["platform", "post_id"]
                        }
                    },
                    {
                        "name": "prepare_replies",
                        "description": "准备自动回复内容，筛选需要回复的评论并生成回复草稿",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string"},
                                "post_id": {"type": "string"},
                                "like_threshold": {"type": "number", "description": "点赞阈值百分比，默认3%"}
                            },
                            "required": ["platform", "post_id"]
                        }
                    },
                    {
                        "name": "publish_replies",
                        "description": "批量发布已准备好的回复（需谨慎使用）",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string"},
                                "post_id": {"type": "string"}
                            },
                            "required": ["platform", "post_id"]
                        }
                    },
                    {
                        "name": "list_reports",
                        "description": "获取历史报告列表",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "test_platform",
                        "description": "测试指定平台的连接是否正常",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string", "enum": ["twitter", "bilibili", "xiaohongshu", "weibo", "douyin"]}
                            },
                            "required": ["platform"]
                        }
                    },
                    {
                        "name": "search_topic",
                        "description": "按关键词/主题搜索多个相关帖子，抓取各帖子评论并生成一份汇总分析报告（不需要先知道具体帖子 ID/链接）",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string", "enum": ["twitter", "bilibili", "xiaohongshu", "weibo", "douyin"]},
                                "keyword": {"type": "string", "description": "搜索关键词/主题"},
                                "max_posts": {"type": "number", "description": "最多抓取帖子数，默认 10"},
                                "max_comments_per_post": {"type": "number", "description": "每个帖子最多抓取评论数，默认 50"}
                            },
                            "required": ["platform", "keyword"]
                        }
                    }
                ]
            }
        }

    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        try:
            # 调用对应的工具
            result = await call_mcp_tool(tool_name, arguments)

            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, ensure_ascii=False, indent=2)
                        }
                    ]
                }
            }

        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "error": {
                    "code": -32603,
                    "message": f"工具调用失败: {str(e)}"
                }
            }

    elif method == "resources/list":
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "resources": [
                    {
                        "uri": "ai-reply-summary://posts",
                        "name": "Posts",
                        "description": "所有帖子列表"
                    },
                    {
                        "uri": "ai-reply-summary://reports",
                        "name": "Reports",
                        "description": "所有报告列表"
                    }
                ]
            }
        }

    else:
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "error": {
                "code": -32601,
                "message": f"方法未找到: {method}"
            }
        }


async def call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """调用 MCP 工具"""

    if tool_name == "fetch_comments":
        post_id = arguments["post_id"]
        platform = arguments["platform"]

        collector = get_platform_collector(platform)
        if not collector:
            return {"error": f"不支持的平台: {platform}"}

        post_info = collector.get_post_info(post_id)
        comments = collector.fetch_comments(post_id)

        return {
            "post_info": post_info,
            "comments_count": len(comments),
            "comments": comments[:10]
        }

    elif tool_name == "analyze_comments":
        post_id = arguments["post_id"]
        platform = arguments["platform"]

        ai = get_ai_analyzer_instance()
        if not ai:
            return {"error": "AI 服务未配置"}

        comments = db.get_comments_by_post(post_id, platform)
        analyses = []

        for comment in comments:
            result = ai.analyze_comment(comment.get("text", ""))
            if result:
                analyses.append({
                    "comment_id": comment["id"],
                    **result
                })

        if analyses:
            db.insert_analyses_batch(analyses)

        return {
            "analyzed_count": len(analyses),
            "sentiment_stats": db.get_sentiment_stats(post_id, platform),
            "intent_stats": db.get_intent_stats(post_id, platform)
        }

    elif tool_name == "generate_report":
        post_id = arguments["post_id"]
        platform = arguments["platform"]

        post_info = db.get_post(post_id, platform)
        ai = get_ai_analyzer_instance()

        report_path = report_generator.generate_report(
            db=db,
            post_id=post_id,
            platform=platform,
            post_info=post_info,
            ai_analyzer=ai
        )

        with open(report_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return {
            "report_path": report_path,
            "content": content[:1000] + "..." if len(content) > 1000 else content
        }

    elif tool_name == "deep_analyze":
        post_id = arguments["post_id"]
        platform = arguments["platform"]

        ai = get_ai_analyzer_instance()
        if not ai:
            return {"error": "AI 服务未配置"}

        comments = db.get_all_comments_with_analysis(post_id, platform)
        insights = ai.analyze_deep_insights(comments, platform)

        return insights or {"error": "深度分析失败"}

    elif tool_name == "prepare_replies":
        post_id = arguments["post_id"]
        platform = arguments["platform"]
        like_threshold = arguments.get("like_threshold", 3.0)

        # 获取已分析的评论
        analyzed_comments = db.get_all_comments_with_analysis(post_id, platform)
        if not analyzed_comments:
            return {"error": "未找到已分析的评论，请先进行 AI 分析"}

        # 获取帖子点赞数
        post = db.get_post(post_id, platform)
        post_like_count = post.get("like_count", 0) if post else 0

        # 筛选需要回复的评论
        comments_to_reply = reply_manager.filter_comments_for_reply(
            analyzed_comments,
            post_like_count,
            like_threshold
        )

        # 生成回复（使用模板 + 默认人设）
        generated = []
        for comment in comments_to_reply:
            reply_text = f"感谢你的反馈！我们会认真考虑你的建议。"
            generated.append({
                "comment_id": comment.get("id"),
                "post_id": post_id,
                "platform": platform,
                "original_comment": comment.get("text", ""),
                "sentiment": comment.get("sentiment", ""),
                "intent": comment.get("intent", ""),
                "generated_reply": reply_text,
                "like_count": comment.get("like_count", 0),
                "reason": comment.get("_reply_reason", "")
            })

        # 保存回复
        if generated:
            reply_manager.save_replies(generated)

        return {
            "post_id": post_id,
            "count": len(generated),
            "replies": generated
        }

    elif tool_name == "publish_replies":
        post_id = arguments["post_id"]
        platform = arguments["platform"]

        collector = get_platform_collector(platform)
        if not collector:
            return {"error": f"不支持的平台: {platform}"}

        pending = db.get_pending_replies(post_id, platform)
        if not pending:
            return {"error": "没有待发布的回复"}

        # 发布回复
        results = reply_manager.publish_batch_replies(
            pending,
            collector,
            platform,
            interval=60 if platform == "bilibili" else 10
        )

        return {
            "post_id": post_id,
            "success_count": results.get("success", 0),
            "failed_count": results.get("failed", 0),
            "errors": results.get("errors", [])
        }

    elif tool_name == "list_reports":
        report_dir = "reports"
        if not os.path.exists(report_dir):
            return {"reports": []}

        reports = [
            {
                "name": f,
                "path": os.path.join(report_dir, f),
                "size": os.path.getsize(os.path.join(report_dir, f)),
                "created": datetime.fromtimestamp(os.path.getctime(os.path.join(report_dir, f))).isoformat()
            }
            for f in os.listdir(report_dir) if f.endswith('.md')
        ]

        reports.sort(key=lambda x: x["created"], reverse=True)

        return {"reports": reports}

    elif tool_name == "test_platform":
        platform = arguments["platform"]

        collector = get_platform_collector(platform)
        if not collector:
            return {"success": False, "error": f"不支持的平台: {platform}"}

        try:
            result = collector.test_connection()
            return {
                "platform": platform,
                "success": result.get("success", False),
                "message": result.get("message", ""),
                "details": result
            }
        except Exception as e:
            return {
                "platform": platform,
                "success": False,
                "error": str(e)
            }

    elif tool_name == "search_topic":
        platform = arguments["platform"]
        keyword = arguments["keyword"]
        max_posts = int(arguments.get("max_posts", 10))
        max_comments_per_post = int(arguments.get("max_comments_per_post", 50))

        result = await run_topic_search_pipeline(
            platform=platform,
            keyword=keyword,
            max_posts=max_posts,
            max_comments_per_post=max_comments_per_post,
            include_ai_analysis=True,
        )

        if not result.get("success"):
            return {"error": result.get("error", "主题搜索失败")}

        content = result["report_content"]
        return {
            "posts_count": result["posts_count"],
            "comments_count": result["comments_count"],
            "report_path": result["report_path"],
            "report_content": content[:1000] + "..." if len(content) > 1000 else content
        }

    else:
        raise ValueError(f"未知的工具: {tool_name}")


# ============ 启动服务 ============

def start_server():
    """启动 API 服务"""
    import uvicorn

    print("""
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 AI回复总结评论 - 智能体接口服务                           ║
║                                                               ║
║   📚 API 文档: http://localhost:{port}/docs                  ║
║   🔌 WebSocket: ws://localhost:{port}/ws                      ║
║   🤖 MCP 端点: ws://localhost:{port}/mcp/ws                   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    """.format(port=API_PORT))

    uvicorn.run(
        app,
        host=API_HOST,
        port=API_PORT,
        reload=DEBUG,
        log_level="info"
    )


if __name__ == "__main__":
    start_server()
