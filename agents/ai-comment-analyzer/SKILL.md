---
name: ai-comment-analyzer
description: >
  Multi-platform social media comment analysis, AI-powered reply, and publishing
  tool (Xiaohongshu, Douyin, WeChat MP, Tieba). Aggregate comments from Twitter/X,
  Bilibili, Xiaohongshu, Weibo, Douyin, and Tieba; analyze sentiment, intent, and
  quality with OpenAI; generate structured insight reports; automate intelligent
  replies; publish notes to Xiaohongshu via redbook-cli (xhs) CDP; publish videos
  to Douyin via dy-cli CDP; publish articles to WeChat Official Account (公众号)
  via official API; and post/reply on Tieba via aiotieba API. Exposes REST API,
  WebSocket, and MCP endpoint for agent integration. Use when: collect/analyze
  comments, generate reports, auto-reply, publish to Xiaohongshu/Douyin/WeChat/Tieba.
  Keywords: social media comments, sentiment analysis, auto-reply, 小红书发布,
  抖音发布, 公众号发布, 贴吧发帖, Bilibili, Xiaohongshu, Douyin, Weibo, Tieba,
  Twitter, OpenAI, comment aggregator, xhs publish, dy publish, MCP, agent API.
---

# AI Comment Analyzer - Skill Playbook

## Overview

AI Comment Analyzer aggregates comments from 5 platforms (Twitter/X, Bilibili,
Xiaohongshu, Weibo, Douyin), analyzes them with OpenAI, and generates structured
feedback reports with optional AI-powered auto-reply. It has both a Streamlit web
UI and a REST/MCP/WS agent API.

## Entry Points

### Web UI (Streamlit)
```
cd c:/Users/28194/Documents/Magichaqi/agents/ai-comment-analyzer/software
streamlit run app.py --server.port 8502
```
Pages: One-Click, Fetch, Analyze, Negative Filter, Report, Report History, Persona,
Auto-Reply, Settings.

### Agent API (FastAPI)
```
cd c:/Users/28194/Documents/Magichaqi/agents/ai-comment-analyzer/software
python -m uvicorn agent_api:app --host 0.0.0.0 --port 8000
```
- REST: http://localhost:8000/docs
- WebSocket: ws://localhost:8000/ws?api_key=YOUR_KEY
- MCP: ws://localhost:8000/mcp/ws?api_key=YOUR_KEY

## Core Capabilities

### 1. Fetch Comments
- Supports: twitter, bilibili, xiaohongshu, weibo, douyin, tieba, **wechat_mp**
- Platform collectors in platforms/ directory with factory pattern
- Requires platform-specific credentials (Cookie / Bearer Token) in .env
- WeChat MP: uses official comment management API (AppID + Secret)

### 2. AI Analysis
- AIAnalyzer.analyze_comment() -- single comment sentiment + intent + quality score
- AIAnalyzer.analyze_comments_batch() -- parallel batch processing (concurrency controlled)
- AIAnalyzer.analyze_deep_insights() -- aggregate insights: pain points, bug reports,
  improvement suggestions, known issues
- Intent types: praise, complaint, question, suggestion, neutral

### 3. Report Generation
- ReportGenerator.generate_report() -- structured report with up to 8 sections
- Sections: sentiment overview, intent distribution, high-value comments, negative
  comments, key insights, deep analysis, action items, known issues
- Reports saved to reports/ directory as markdown files

### 4. Auto-Reply
- ReplyManager.should_reply() -- decide whether to reply based on sentiment/intent/quality
- ReplyManager.generate_reply_with_ai() -- AI-generated reply with platform style
- ReplyManager.publish_batch_replies() -- batch publish with 60s delay (Bilibili) and
  10 concurrent AI requests max to avoid rate limits

### 5. Xiaohongshu Publishing (小红书发笔记)
- XiaohongshuPublisher.publish_note() -- publish image notes with title/content/images/tags
- XiaohongshuPublisher.publish_video() -- publish video notes
- XiaohongshuPublisher.check_login() -- verify CDP login status
- XiaohongshuPublisher.get_agent_state() -- agent-friendly status snapshot
- XiaohongshuPublisher.login_interactive() -- open Chrome for QR-code login
- XiaohongshuPublisher.search() -- search notes by keyword
- Powered by [redbook-cli](https://github.com/Youhai020616/xiaohongshu) (xhs CLI)
- Module: `platforms/xiaohongshu_publisher.py`

**Setup (one-time):**
```bash
pip install redbook-cli
xhs login --cdp        # Opens Chrome, scan QR code with Xiaohongshu app
xhs status             # Verify: CDP: 已登录
```

**Usage from Python:**
```python
from platforms.xiaohongshu_publisher import XiaohongshuPublisher

pub = XiaohongshuPublisher()
if pub.check_login():
    result = pub.publish_note(
        title="产品更新 v2.0",
        content="这次更新带来了...",
        images=["screenshot1.jpg", "screenshot2.jpg"],
        tags=["产品更新", "效率工具"],
    )
    print(result.message)
```

**Usage from CLI:**
```bash
xhs publish -t "标题" -c "正文" -i image.jpg --tags AI --tags 工具
xhs publish -t "视频标题" -c "正文" -v video.mp4
xhs search "关键词"
```

### 6. Douyin Publishing (抖音发视频/图文)
- DouyinPublisher.publish_video() — 发布视频/图文，支持定时/标签/可见性
- DouyinPublisher.publish_image_post() — 发布图文（便捷方法）
- DouyinPublisher.check_login() / login_interactive() — 登录状态/扫码登录
- DouyinPublisher.search() / trending() / download() — 搜索/热搜/无水印下载
- Powered by [dy-cli](https://github.com/Youhai020616/douyin) (37 stars)
- Module: `platforms/douyin_publisher.py`

**Setup (one-time):**
```bash
pip install dy-cli
dy login                # QR scan login (Playwright CDP)
dy status               # Verify logged in
```

**Usage from Python:**
```python
from platforms.douyin_publisher import DouyinPublisher

pub = DouyinPublisher()
if pub.check_login():
    pub.publish_video(
        title="产品演示",
        description="新版本功能展示",
        video_path="demo.mp4",
        tags=["科技", "效率工具"],
    )
```

**Usage from CLI:**
```bash
dy publish -t "标题" -v video.mp4 --tags AI --tags 教程
dy publish -t "标题" -i img.jpg -i img2.jpg
dy trending --count 10
dy dl https://v.douyin.com/xxx
```

### 7. WeChat MP Publishing (公众号发文章)
- WechatMPPublisher.one_click_publish() — Markdown → 排版 HTML → 封面 → 公众号草稿箱
- WechatMPPublisher.markdown_to_html() — Markdown 转公众号兼容 HTML（内联 CSS）
- WechatMPPublisher.generate_cover() — 纯 PIL 生成 900×383 封面图（5 种风格）
- WechatMPPublisher.create_draft() / publish_draft() — 创建/发布草稿
- WechatMPPublisher.upload_image() / upload_cover() — 图片上传至微信 CDN
- 2 套内置主题: tech-digest（技术简报）/ news-minimal（极简新闻）
- 5 种封面风格: gradient / accent-bar / split / minimal / geometric
- Powered by [topic-to-wechat](https://github.com/mileson/topic-to-wechat) engine
- Module: `platforms/wechat_mp/`

**Setup (one-time):**
```bash
pip install wechatpy cryptography mistune pyyaml Pillow requests
# 在 .env 中配置:
WECHAT_APPID=wx_your_app_id
WECHAT_SECRET=your_app_secret
# 在公众号后台 → 设置与开发 → IP白名单 中加入当前服务器出口IP
```

**Usage from Python:**
```python
from platforms.wechat_mp import WechatMPPublisher

pub = WechatMPPublisher()  # 自动读取 .env 中的 WECHAT_APPID/SECRET
if pub.check_config()["ready"]:
    result = pub.one_click_publish(
        title="产品更新 v2.0",
        content_md="# 本次更新\n\n## 新功能\n...",
        author="产品团队",
        theme="tech-digest",
        cover_style="gradient",
    )
    print(result.message)  # "草稿创建成功"
```

### 7. Agent API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/comments/fetch | Fetch and store comments |
| POST | /api/comments/analyze | Analyze stored comments |
| POST | /api/report/generate | Generate insight report |
| POST | /api/reply/generate | Generate AI reply for a comment |
| POST | /api/reply/publish | Publish a single reply |
| POST | /api/reply/batch | Batch publish replies |
| GET | /api/posts | List posts in database |
| WS | /ws | Real-time streaming updates |
| WS | /mcp/ws | MCP protocol for Claude/coding agents |

## Configuration (.env)

Required environment variables:
```
OPENAI_API_KEY=sk-...

TWITTER_BEARER_TOKEN=
BILIBILI_SESSDATA=
BILIBILI_BILI_JCT=
XHS_COOKIE=
WEIBO_COOKIE=
DOUYIN_COOKIE=

API_KEY=your-secret-api-key
API_HOST=0.0.0.0
API_PORT=8000
```

## Database

SQLite at socialecho.db (relative to working directory). Tables: comments, analyses,
posts, products, personas, reply_templates, generated_replies, reply_logs, settings.
Each API call creates an independent connection (no cross-thread sharing).

## Key Design Rules

- Batch AI requests: max 10 concurrent to avoid OpenAI 429 errors
- Bilibili reply delay: 60 seconds between batch requests
- All AI responses include platform parameter for platform-specific style
- Configuration persists to .env file

## How to Use This Skill

1. Read the user's request and identify the target platform and post
2. Check credentials -- if .env lacks required platform tokens, tell the user
3. Choose entry point -- Web UI for human use, Agent API for automated/agent use
4. Execute workflow -- fetch -> analyze -> (optional) auto-reply -> report
5. Return results -- report file path, comment summary, or reply count

## 📖 Detailed Usage Guide

See [PUBLISH_GUIDE.md](./PUBLISH_GUIDE.md) for step-by-step tutorials covering:
- Xiaohongshu note publishing (redbook-cli CDP)
- WeChat MP article publishing & comment management
- Tieba post publishing & comment collection
- Environment variable setup checklist
- Troubleshooting common issues

## Platform Publishing Support

| Platform | Comment Fetch | Comment Reply | Publish Notes | Engine |
|----------|:---:|:---:|:---:|--------|
| Xiaohongshu | ✅ | ✅ | ✅ | Playwright CDP (xhs CLI) |
| WeChat MP | ✅ | ✅ | ✅ | Official API (wechatpy) |
| Bilibili | ✅ | ✅ | ❌ | API + Cookie |
| Weibo | ✅ | ❌ | ❌ | API + Cookie |
| Douyin | ✅ | ⚠️ 顶级评论 | ✅ | dy-cli (Playwright CDP) |
| Twitter/X | ✅ | ❌ | ❌ | Tweepy API v2 |
| Tieba | ✅ | ✅ | ✅ | aiotieba API (lumina37/aiotieba) |

## Guardrails

- Never publish replies without user confirmation (unless auto_mode=true)
- Never publish Xiaohongshu notes without user confirmation
- Rate limits are enforced per platform -- do not bypass delays
- API key must be provided for all agent API calls
- xhs CLI requires Chrome and one-time QR-code login (session persists)
