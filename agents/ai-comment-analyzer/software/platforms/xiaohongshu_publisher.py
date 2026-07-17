"""
小红书笔记发布器 (Xiaohongshu Note Publisher)

基于 redbook-cli (xhs CLI) 的小红书图文/视频发布模块。
封装 xhs 命令行工具为 Python 接口，供 AI agent 调用。

依赖:
  - pip install redbook-cli     (xhs CLI 工具)
  - Chrome 浏览器               (CDP 浏览器自动化)
  - 首次使用需运行 xhs login --cdp 扫码登录

使用示例:
    from platforms.xiaohongshu_publisher import XiaohongshuPublisher

    pub = XiaohongshuPublisher()
    if pub.check_login():
        result = pub.publish_note(
            title="我的第一条AI笔记",
            content="这是通过AI agent发布的小红书内容",
            images=["photo.jpg"],
            tags=["AI", "自动化"]
        )
"""

import os
import subprocess
import json
import time
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass, field


@dataclass
class PublishResult:
    """发布结果"""
    success: bool
    post_id: str = ""
    url: str = ""
    message: str = ""
    raw_output: str = ""


class XiaohongshuPublisher:
    """
    小红书笔记发布器

    封装 xhs CLI 命令，提供发布/状态查询/登录检查等接口。
    所有操作通过 subprocess 调用 xhs 命令，保持与 CLI 工具一致的行为。
    """

    def __init__(self, account: str = "default"):
        """
        初始化发布器

        Args:
            account: xhs CLI 账号名（支持多账号），默认 "default"
        """
        self.account = account
        self._xhs_cmd = "xhs"

    # ------------------------------------------------------------------
    # 基础命令
    # ------------------------------------------------------------------

    def _run(self, args: List[str], timeout: int = 120) -> Tuple[int, str, str]:
        """
        执行 xhs 命令

        Args:
            args: 命令参数列表（不含 xhs 前缀）
            timeout: 超时秒数

        Returns:
            (returncode, stdout, stderr)
        """
        env = os.environ.copy()
        # 清除可能干扰 xhs CLI 的 Python 和代理环境变量
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "PYTHONPATH", "PYTHONHOME"):
            env.pop(key, None)

        # 修复 Rich 库在 Windows 下 GBK 编码崩溃问题
        env["PYTHONIOENCODING"] = "utf-8"

        cmd = [self._xhs_cmd] + args
        if self.account != "default":
            cmd.extend(["--account", self.account])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            env=env,
        )
        return result.returncode, result.stdout, result.stderr

    # ------------------------------------------------------------------
    # 登录 & 状态
    # ------------------------------------------------------------------

    def check_login(self) -> bool:
        """
        检查 CDP 登录状态

        Returns:
            True 已登录，False 未登录
        """
        code, stdout, stderr = self._run(["status"], timeout=15)
        output = stdout + stderr
        # "CDP: 已登录" 表示成功
        return "CDP: 已登录" in output

    def get_status(self) -> Dict:
        """
        获取完整状态

        Returns:
            {"mcp": "...", "cdp": "...", "account": "..."}
        """
        code, stdout, stderr = self._run(["status"], timeout=15)
        output = stdout + stderr

        status = {"mcp": "unknown", "cdp": "unknown", "account": self.account}
        for line in output.split("\n"):
            line = line.strip()
            if "MCP:" in line:
                status["mcp"] = line.split(":", 1)[1].strip()
            elif "CDP:" in line:
                status["cdp"] = line.split(":", 1)[1].strip()

        return status

    def login_interactive(self) -> Tuple[bool, str]:
        """
        通过 CDP 浏览器扫码登录（交互式，会打开 Chrome 窗口）

        Returns:
            (是否成功, 消息)
        """
        code, stdout, stderr = self._run(["login", "--cdp"], timeout=120)
        output = stdout + stderr

        if "LOGIN_READY" in output or "请扫码" in output:
            return True, "登录页面已打开，请在 Chrome 窗口中扫码登录小红书"
        elif "已登录" in output:
            return True, "已处于登录状态"
        else:
            return False, output.strip() or "登录失败"

    def logout(self) -> bool:
        """退出 CDP 登录"""
        code, stdout, stderr = self._run(["logout", "--engine", "cdp"], timeout=30)
        return code == 0

    # ------------------------------------------------------------------
    # 发布笔记
    # ------------------------------------------------------------------

    def publish_note(
        self,
        title: str,
        content: str,
        images: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        visibility: str = "公开",
        dry_run: bool = False,
    ) -> PublishResult:
        """
        发布图文笔记

        Args:
            title: 笔记标题（最多20字）
            content: 笔记正文
            images: 图片路径列表（jpg/png），至少1张
            tags: 话题标签列表
            visibility: 可见性 - "公开" / "仅自己可见"
            dry_run: 仅预览不发布

        Returns:
            PublishResult
        """
        if not title or not content:
            return PublishResult(
                success=False,
                message="标题和正文不能为空",
            )

        args = ["publish", "-t", title, "-c", content]

        if images:
            for img in images:
                if os.path.exists(img):
                    args.extend(["-i", img])
                else:
                    return PublishResult(
                        success=False,
                        message=f"图片不存在: {img}",
                    )
        else:
            return PublishResult(
                success=False,
                message="小红书图文笔记至少需要一张图片",
            )

        if tags:
            for tag in tags:
                args.extend(["--tags", tag])

        if visibility == "仅自己可见":
            args.append("--visibility")
            args.append("仅自己可见")

        if dry_run:
            args.append("--dry-run")

        code, stdout, stderr = self._run(args, timeout=120)
        output = stdout + stderr

        if code == 0:
            return PublishResult(
                success=True,
                message="发布成功" if not dry_run else "预览模式 — 未实际发布",
                raw_output=output,
            )
        else:
            return PublishResult(
                success=False,
                message=f"发布失败: {stderr.strip() or output.strip()}",
                raw_output=output,
            )

    def publish_video(
        self,
        title: str,
        content: str,
        video_path: str,
        tags: Optional[List[str]] = None,
        visibility: str = "公开",
        dry_run: bool = False,
    ) -> PublishResult:
        """
        发布视频笔记

        Args:
            title: 笔记标题
            content: 笔记正文
            video_path: 视频文件路径 (mp4)
            tags: 话题标签列表
            visibility: 可见性
            dry_run: 仅预览

        Returns:
            PublishResult
        """
        if not os.path.exists(video_path):
            return PublishResult(
                success=False,
                message=f"视频文件不存在: {video_path}",
            )

        args = ["publish", "-t", title, "-c", content, "-v", video_path]

        if tags:
            for tag in tags:
                args.extend(["--tags", tag])

        if visibility == "仅自己可见":
            args.append("--visibility")
            args.append("仅自己可见")

        if dry_run:
            args.append("--dry-run")

        code, stdout, stderr = self._run(args, timeout=180)
        output = stdout + stderr

        if code == 0:
            return PublishResult(
                success=True,
                message="视频发布成功" if not dry_run else "预览模式 — 未实际发布",
                raw_output=output,
            )
        else:
            return PublishResult(
                success=False,
                message=f"视频发布失败: {stderr.strip() or output.strip()}",
                raw_output=output,
            )

    # ------------------------------------------------------------------
    # 搜索
    # ------------------------------------------------------------------

    def search(
        self,
        keyword: str,
        sort: str = "综合",
        note_type: Optional[str] = None,
        max_results: int = 20,
    ) -> List[Dict]:
        """
        搜索笔记

        Args:
            keyword: 搜索关键词
            sort: 排序 - "综合" / "最多点赞" / "最新发布"
            note_type: 类型 - "图文" / "视频"
            max_results: 最大结果数

        Returns:
            笔记列表
        """
        args = ["search", keyword, "--sort", sort]
        if note_type:
            args.extend(["--type", note_type])

        code, stdout, stderr = self._run(args, timeout=60)

        # xhs search 输出是表格，解析较复杂，这里返回原始文本
        # 后续可扩展为结构化解析
        results = []
        for line in stdout.split("\n"):
            line = line.strip()
            if line and not line.startswith("ℹ") and not line.startswith("---"):
                results.append({"raw": line})
                if len(results) >= max_results:
                    break

        return results

    # ------------------------------------------------------------------
    # AI Agent 集成接口
    # ------------------------------------------------------------------

    def get_agent_state(self) -> Dict:
        """
        获取可供 AI agent 读取的状态快照

        Returns:
            {
                "logged_in": bool,
                "account": str,
                "cdp_status": str,
                "ready_to_publish": bool
            }
        """
        status = self.get_status()
        logged_in = status["cdp"] == "已登录"
        return {
            "logged_in": logged_in,
            "account": self.account,
            "cdp_status": status["cdp"],
            "mcp_status": status["mcp"],
            "ready_to_publish": logged_in,
        }

    def agent_publish(
        self,
        title: str,
        content: str,
        image_paths: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict:
        """
        AI agent 友好的发布接口（返回 JSON 字典而非 dataclass）

        Args:
            title: 标题
            content: 正文
            image_paths: 图片路径列表
            tags: 标签列表

        Returns:
            {"success": bool, "message": str, "post_id": str, "url": str}
        """
        result = self.publish_note(
            title=title,
            content=content,
            images=image_paths,
            tags=tags,
        )
        return {
            "success": result.success,
            "message": result.message,
            "post_id": result.post_id,
            "url": result.url,
            "raw": result.raw_output[:500] if result.raw_output else "",
        }


# ------------------------------------------------------------------
# 快速测试
# ------------------------------------------------------------------

if __name__ == "__main__":
    pub = XiaohongshuPublisher()
    state = pub.get_agent_state()
    print(f"登录状态: {state}")

    if state["logged_in"]:
        print("已登录，可以发布笔记")
        # 预览模式测试
        result = pub.publish_note(
            title="测试笔记",
            content="这是一条测试笔记，请忽略",
            tags=["测试"],
            dry_run=True,
        )
        print(f"预览结果: {result}")
    else:
        print("未登录，请先运行: xhs login --cdp")
        print("或在 Python 中调用: pub.login_interactive()")
