# AI Comment Analyzer

Multi-platform social media comment analysis and AI-powered reply tool.

## Features

- Aggregate comments from 6 platforms: Twitter/X, Bilibili, Xiaohongshu, Weibo, Douyin, **TapTap**
- AI-powered sentiment analysis, intent classification, and quality scoring
- Star rating analysis for TapTap game reviews
- Structured feedback reports: pain points, bug reports, improvement suggestions
- Intelligent auto-reply with platform-specific style
- Agent API: REST, WebSocket, and MCP protocol endpoints

## Quick Start

### 1. Install dependencies
```
cd software
pip install -r requirements.txt
```

### 2. Configure credentials
Copy `.env.example` to `.env` and fill in your API keys:
```
OPENAI_API_KEY=sk-...
BILIBILI_SESSDATA=...
BILIBILI_BILI_JCT=...
# ... other platform credentials
```

### TapTap Setup (2 min)
TapTap uses HttpOnly cookies that require manual extraction:
1. Open Edge/Chrome → go to [taptap.cn](https://www.taptap.cn) and **log in**
2. Press `F12` → **Application** tab → **Cookies** → `www.taptap.cn`
3. Find and copy the **Value** of these two cookies:
   - `TAPTAP_SESSION` (your login token, HttpOnly ✓)
   - `XSRF-TOKEN` (CSRF token)
4. Paste them into the sidebar fields in the Web UI → click Save

### 3. Run Web UI
```
streamlit run app.py --server.port 8502
```

### 4. Run Agent API
```
python -m uvicorn agent_api:app --host 0.0.0.0 --port 8000
```
API docs at http://localhost:8000/docs

## Project Structure

```
software/
  app.py              -- Streamlit web UI (9 pages)
  agent_api.py        -- FastAPI agent interface (REST/WS/MCP)
  database.py         -- SQLite database operations
  ai_analyzer.py      -- OpenAI comment analysis
  report_generator.py -- Structured report generation
  reply_manager.py    -- Auto-reply logic
  config_manager.py   -- .env configuration management
  main.py             -- CLI entry point
  ui.py               -- Terminal UI
  twitter_collector.py -- Twitter API v2 collector
  platforms/          -- Platform collectors (factory pattern)
    bilibili.py
    xiaohongshu.py
    weibo.py
    douyin.py
    twitter.py
    taptap.py
    base.py
    factory.py
```

## Agent Integration

The Agent API exposes a Model Context Protocol (MCP) WebSocket endpoint at
`ws://localhost:8000/mcp/ws?api_key=YOUR_KEY`, compatible with Claude Code and
other MCP-enabled agents. See SKILL.md for detailed playbook.

## License

MIT
