---
name: ai-comment-analyzer
description: >
  Multi-platform social media comment analysis and AI-powered reply tool. Aggregate
  comments from Twitter/X, Bilibili, Xiaohongshu, Weibo, and Douyin; analyze sentiment,
  intent, and quality with OpenAI; generate structured insight reports; and automate
  intelligent replies. Exposes a REST API, WebSocket, and MCP endpoint for agent
  integration. Use this skill when the user wants to: collect/analyze social media
  comments, generate product feedback reports, automate comment replies, monitor
  sentiment across platforms, or feed comment insights into a downstream agent.
  Keywords: social media comments, sentiment analysis, auto-reply, Bilibili, Xiaohongshu,
  Weibo, Douyin, Twitter, OpenAI, comment aggregator, feedback report, MCP, agent API.
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
- Supports: twitter, bilibili, xiaohongshu, weibo, douyin
- Platform collectors in platforms/ directory with factory pattern
- Requires platform-specific credentials (Cookie / Bearer Token) in .env

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

### 5. Agent API Endpoints

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

## Guardrails

- Never publish replies without user confirmation (unless auto_mode=true)
- Rate limits are enforced per platform -- do not bypass delays
- API key must be provided for all agent API calls
