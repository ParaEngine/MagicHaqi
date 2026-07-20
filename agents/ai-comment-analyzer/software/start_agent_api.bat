@echo off
chcp 65001 > nul
title AI回复总结评论 - 智能体接口

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║                                                               ║
echo ║   🚀 AI回复总结评论 - 智能体接口服务                           ║
echo ║                                                               ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

:: 检查 Python
python --version > nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Python，请先安装 Python 3.9+
    pause
    exit /b 1
)

:: 检查依赖
echo 📦 检查依赖项...
pip show fastapi > nul 2>&1
if errorlevel 1 (
    echo 📥 安装 API 服务依赖项...
    pip install -q fastapi uvicorn[standard] pydantic websockets httpx
)

echo ✅ 依赖检查完成
echo.

:: 启动服务
echo 🌟 启动智能体接口服务...
echo.
echo 可用地址:
echo   📚 API 文档: http://localhost:8000/docs
echo   🔌 WebSocket: ws://localhost:8000/ws
echo   🤖 MCP 端点: ws://localhost:8000/mcp/ws
echo.
echo 按 Ctrl+C 停止服务
echo.

python agent_api.py

pause
