"""
抖音发布器 (Douyin Publisher)

基于 dy-cli (Youhai020616/douyin, 37 stars) 的抖音视频/图文发布模块。
封装 dy 命令行工具为 Python 接口，供 AI agent 调用。

依赖:
  - pip install dy-cli          (dy CLI 工具)
  - Chrome 浏览器               (Playwright CDP 浏览器自动化)
  - 首次使用需运行 dy login 扫码登录

使用示例:
    from platforms.douyin_publisher import DouyinPublisher

    pub = DouyinPublisher()
    if pub.check_login():
        result = pub.publish_video(
            title="我的第一条AI视频",
            description="这是通过AI agent发布的抖音内容",
            video_path="video.mp4",
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
class DouyinPublishResult:
    """抖音发布结果"""
    success: bool
    post_id: str = ""
    url: str = ""
    message: str = ""
    raw_output: str = ""


class DouyinPublisher:
    """
    抖音发布器

    封装 dy CLI 命令，提供发布/状态查询/登录检查等接口。
    所有操作通过 subprocess 调用 dy 命令。
    """

    def __init__(self, account: str = "default"):
        """
        Args:
            account: dy CLI 账号名（支持多账号），默认 "default"
        """
        self.account = account
        self._cmd = "dy"

    # ------------------------------------------------------------------
    # 基础命令
    # ------------------------------------------------------------------

    def _run(self, args: List[str], timeout: int = 180) -> Tuple[int, str, str]:
        """执行 dy 命令"""
        env = os.environ.copy()
        # 清除可能干扰 dy CLI 的 Python 环境变量
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "PYTHONPATH", "PYTHONHOME"):
            env.pop(key, None)
        # 修复 Rich 库在 Windows 下 GBK 编码崩溃问题
        env["PYTHONIOENCODING"] = "utf-8"

        cmd = [self._cmd] + args
        if self.account != "default":
            cmd.extend(["--account", self.account])

        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout, env=env)
        return result.returncode, result.stdout, result.stderr

    # ------------------------------------------------------------------
    # 登录 & 状态
    # ------------------------------------------------------------------

    def check_login(self) -> bool:
        """检查登录状态"""
        code, stdout, stderr = self._run(["status"], timeout=15)
        return code == 0 and ("已登录" in stdout + stderr or "Logged in" in stdout + stderr)

    def get_status(self) -> Dict:
        """获取完整状态"""
        code, stdout, stderr = self._run(["status"], timeout=15)
        return {
            "account": self.account,
            "logged_in": self.check_login(),
            "raw": (stdout + stderr).strip(),
        }

    def login_interactive(self) -> Tuple[bool, str]:
        """扫码登录（打开浏览器）"""
        code, stdout, stderr = self._run(["login"], timeout=120)
        if code == 0:
            return True, "登录成功"
        return False, stderr.strip() or stdout.strip() or "登录失败"

    # ------------------------------------------------------------------
    # 发布视频
    # ------------------------------------------------------------------

    def publish_video(
        self,
        title: str,
        description: str = "",
        video_path: str = "",
        images: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        visibility: str = "公开",
        schedule: str = "",
        dry_run: bool = False,
    ) -> DouyinPublishResult:
        """
        发布抖音内容（视频或图文）

        Args:
            title: 标题
            description: 描述/正文
            video_path: 视频文件路径 (mp4)
            images: 图片路径列表（图文模式）
            tags: 话题标签
            visibility: "公开" / "仅自己可见" / "好友可见"
            schedule: 定时发布时间 ISO格式
            dry_run: 仅预览

        Returns:
            DouyinPublishResult
        """
        if not title:
            return DouyinPublishResult(success=False, message="标题不能为空")

        args = ["publish", "-t", title]

        if description:
            args.extend(["-c", description])

        if video_path and os.path.exists(video_path):
            args.extend(["-v", video_path])
        elif images:
            for img in images:
                if os.path.exists(img):
                    args.extend(["-i", img])
                else:
                    return DouyinPublishResult(success=False, message=f"图片不存在: {img}")
        else:
            return DouyinPublishResult(success=False, message="需要提供视频文件(-v)或图片(-i)")

        if tags:
            for tag in tags:
                args.extend(["--tags", tag])

        if visibility and visibility != "公开":
            args.extend(["--visibility", visibility])

        if schedule:
            args.extend(["--schedule", schedule])

        if dry_run:
            args.append("--dry-run")

        code, stdout, stderr = self._run(args, timeout=300)
        output = stdout + stderr

        if code == 0:
            return DouyinPublishResult(
                success=True,
                message="发布成功" if not dry_run else "预览模式",
                raw_output=output,
            )
        return DouyinPublishResult(success=False, message=stderr.strip() or output.strip(), raw_output=output)

    def publish_image_post(
        self,
        title: str,
        description: str = "",
        images: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        dry_run: bool = False,
    ) -> DouyinPublishResult:
        """发布图文（便捷方法）"""
        if not images:
            return DouyinPublishResult(success=False, message="图文模式需要至少一张图片")
        return self.publish_video(
            title=title, description=description, images=images, tags=tags, dry_run=dry_run,
        )

    # ------------------------------------------------------------------
    # 搜索 & 下载
    # ------------------------------------------------------------------

    def search(self, keyword: str, max_results: int = 20) -> List[Dict]:
        """搜索抖音视频"""
        code, stdout, stderr = self._run(["search", keyword], timeout=60)
        results = []
        for line in stdout.split("\n"):
            line = line.strip()
            if line and not line.startswith("ℹ") and not line.startswith("---"):
                results.append({"raw": line})
                if len(results) >= max_results:
                    break
        return results

    def download(self, url_or_id: str, output_dir: str = "") -> DouyinPublishResult:
        """下载无水印视频"""
        args = ["dl", url_or_id]
        if output_dir:
            args.extend(["--output", output_dir])
        code, stdout, stderr = self._run(args, timeout=120)
        return DouyinPublishResult(
            success=code == 0,
            message="下载成功" if code == 0 else stderr,
            raw_output=stdout,
        )

    # ------------------------------------------------------------------
    # 热搜 & 互动
    # ------------------------------------------------------------------

    def trending(self, count: int = 50) -> List[Dict]:
        """获取热搜榜"""
        code, stdout, stderr = self._run(["trending", "--count", str(count)], timeout=30)
        results = []
        for line in stdout.split("\n"):
            line = line.strip()
            if line:
                results.append({"raw": line})
        return results

    def comment(self, post_id: str, content: str) -> DouyinPublishResult:
        """评论某条视频（Playwright 浏览器自动化）"""
        code, stdout, stderr = self._run(["comment", post_id, "-c", content], timeout=60)
        return DouyinPublishResult(success=code == 0, message=stdout.strip() or stderr.strip())

    def reply_comment(
        self, post_id: str, reply_text: str, comment_id: str = ""
    ) -> Dict:
        """
        回复评论（在视频下发评论/回复）

        注意：dy CLI 的 comment 命令是发顶级评论，非回复特定楼层。
        如需回复特定评论（二级回复），需 Playwright 浏览器定位到
        具体评论后点击回复按钮，当前 dy CLI 暂不支持。

        Args:
            post_id: 视频 ID 或短索引
            reply_text: 回复内容
            comment_id: （暂未使用，dy CLI 不支持指定楼层回复）

        Returns:
            {"success": bool, "message": str}
        """
        if not self.check_login():
            return {"success": False, "message": "未登录，请先运行 dy login"}
        result = self.comment(post_id, reply_text)
        return {"success": result.success, "message": result.message}

    def reply_batch(
        self, post_id: str, replies: List[Dict], delay_seconds: float = 10.0
    ) -> List[Dict]:
        """
        批量回复（每条间隔10秒防限流）

        Args:
            post_id: 视频 ID
            replies: [{"content": "回复内容"}, ...]
            delay_seconds: 间隔秒数（抖音建议≥10秒）

        Returns:
            [{"success": bool, "message": str}, ...]
        """
        results = []
        for i, r in enumerate(replies):
            if i > 0:
                time.sleep(delay_seconds)
            result = self.reply_comment(
                post_id=post_id,
                reply_text=r.get("content", ""),
            )
            results.append(result)
        return results

    # ------------------------------------------------------------------
    # Agent 集成接口
    # ------------------------------------------------------------------

    def get_agent_state(self) -> Dict:
        """AI agent 可读状态"""
        logged_in = self.check_login()
        return {
            "logged_in": logged_in,
            "account": self.account,
            "ready_to_publish": logged_in,
            "dy_installed": True,
        }

    def agent_publish(
        self,
        title: str,
        description: str = "",
        video_path: str = "",
        image_paths: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict:
        """AI agent 友好的发布接口（返回 dict）"""
        result = self.publish_video(
            title=title, description=description,
            video_path=video_path, images=image_paths, tags=tags,
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
    pub = DouyinPublisher()
    state = pub.get_agent_state()
    print(f"抖音发布器状态: {json.dumps(state, ensure_ascii=False, indent=2)}")

    if state["logged_in"]:
        print("已登录，可以发布内容")
    else:
        print("未登录，请运行: dy login")
        print("或在 Python 中: pub.login_interactive()")
