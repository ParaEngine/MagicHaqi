"""
百度贴吧 (Baidu Tieba) 采集 & 发布器

基于 aiotieba (lumina37/aiotieba, 649 stars) 的官方 API 封装。
替代旧版 Playwright 爬虫方案，支持评论采集、回复、发帖。

依赖:
  pip install aiotieba

认证:
  设置环境变量 TIEBA_BDUSS=你的BDUSS
  从浏览器 Cookie 中获取: 登录贴吧 → F12 → Application → Cookies → BDUSS

API 文档: https://aiotieba.cc/
"""

import asyncio
import os
import re
import time
from typing import List, Dict, Optional, Tuple

from .base import BaseCollector


class TiebaCollector(BaseCollector):
    """百度贴吧采集 & 发布器（基于 aiotieba）"""

    platform_name = "tieba"
    platform_display_name = "百度贴吧"
    platform_description = "使用 aiotieba 官方 API 拉取评论和发帖回复，需要 BDUSS Cookie"

    def __init__(self, bduss: str = "", **kwargs):
        """
        Args:
            bduss: 贴吧 BDUSS Cookie（优先从环境变量 TIEBA_BDUSS）
        """
        super().__init__(**kwargs)
        self.bduss = bduss or os.getenv("TIEBA_BDUSS", "")
        self._client = None

    # ------------------------------------------------------------------
    # 配置 & 认证
    # ------------------------------------------------------------------

    def validate_config(self) -> bool:
        return bool(self.bduss)

    def _get_client(self):
        """懒加载 aiotieba Client"""
        if self._client is None:
            import aiotieba
            self._client = aiotieba.Client(BDUSS=self.bduss) if self.bduss else aiotieba.Client()
        return self._client

    def _run_async(self, coro_factory, timeout: int = 60):
        """
        同步包装 aiotieba 异步操作。
        aiotieba Client 必须在 async with 上下文中使用。
        coro_factory 是一个接收 client 参数的 async 函数工厂。
        """
        async def _runner():
            client = self._get_client()
            async with client:
                return await coro_factory(client)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, _runner())
                    return future.result(timeout=timeout)
            return asyncio.run(_runner())
        except RuntimeError:
            return asyncio.run(_runner())

    # ------------------------------------------------------------------
    # ID 解析
    # ------------------------------------------------------------------

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或纯数字中提取帖子 tid"""
        if not url_or_id:
            return ""
        m = re.search(r'/p/(\d+)', url_or_id)
        if m:
            return m.group(1)
        m = re.search(r'(\d{5,})', url_or_id)
        return m.group(1) if m else url_or_id.strip()

    @staticmethod
    def extract_forum_name(url_or_name: str) -> str:
        """从 URL 或文本中提取吧名"""
        if not url_or_name:
            return ""
        m = re.search(r'kw=([^&]+)', url_or_name)
        if m:
            from urllib.parse import unquote
            return unquote(m.group(1))
        if not url_or_name.startswith("http"):
            return url_or_name.strip()
        return ""

    # ------------------------------------------------------------------
    # BaseCollector 接口
    # ------------------------------------------------------------------

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取帖子基本信息"""
        tid = self.extract_post_id(post_id)
        if not tid:
            return None

        try:
            c = self._get_client()
            posts = self._run_async(lambda c: c.get_posts(int(tid), pn=1, rn=1))
            title = ""
            for p in posts:
                t = getattr(p, 'title', '') or getattr(p, 'text', '')
                if t:
                    title = t
                    break

            return {
                "id": tid,
                "title": title or f"贴吧帖子 {tid}",
                "content": title or "",
                "author_id": "",
                "author_name": "",
                "author_avatar": "",
                "created_at": "",
                "like_count": 0,
                "comment_count": 0,
                "share_count": 0,
                "view_count": 0,
                "platform": self.platform_name,
                "url": f"https://tieba.baidu.com/p/{tid}",
            }
        except Exception:
            return {
                "id": tid,
                "title": f"贴吧帖子 {tid}",
                "url": f"https://tieba.baidu.com/p/{tid}",
                "platform": self.platform_name,
            }

    def fetch_comments(
        self, post_id: str, max_comments: Optional[int] = None
    ) -> List[Dict]:
        """拉取帖子回复（=评论/楼层）"""
        tid = self.extract_post_id(post_id)
        if not tid:
            return []

        limit = max_comments or 100
        all_posts = []
        pn = 1

        try:
            c = self._get_client()
            while len(all_posts) < limit:
                posts = self._run_async(
                    lambda c, tid=int(tid), pn=pn, rn=min(30, limit - len(all_posts)): c.get_posts(tid, pn=pn, rn=rn)
                )
                count = 0
                for p in posts:
                    text = getattr(p, 'text', '')
                    if not text:
                        continue
                    user_name = '贴吧用户'
                    if hasattr(p, 'user') and p.user:
                        user_name = getattr(p.user, 'name', '贴吧用户') or '贴吧用户'
                    all_posts.append({
                        "id": str(getattr(p, 'pid', '')),
                        "post_id": tid,
                        "platform": self.platform_name,
                        "author_id": str(getattr(p, 'user_id', '')),
                        "author_username": user_name,
                        "author_name": user_name,
                        "author_avatar": "",
                        "text": text,
                        "created_at": "",
                        "like_count": 0,
                        "reply_count": 0,
                        "ip_location": "",
                        "platform_data": {"floor": getattr(p, 'floor', 0)},
                    })
                    count += 1
                if count < 30:
                    break
                pn += 1
        except Exception:
            pass
        return all_posts[:limit]

    def search_posts(self, keyword: str, max_posts: int = 10) -> List[Dict]:
        """搜索贴吧帖子（=获取吧内帖子列表）"""
        forum = self.extract_forum_name(keyword) or keyword
        if not forum:
            return []
        try:
            c = self._get_client()
            threads = self._run_async(lambda c: c.get_threads(forum))
            return [
                {
                    "id": str(getattr(t, 'tid', '')),
                    "title": getattr(t, 'title', '') or getattr(t, 'text', ''),
                    "url": f"https://tieba.baidu.com/p/{getattr(t, 'tid', '')}",
                    "author_name": getattr(getattr(t, 'user', None), 'name', '') if hasattr(t, 'user') and t.user else '',
                    "comment_count": getattr(t, 'reply_num', 0),
                    "platform": self.platform_name,
                }
                for t in threads[:max_posts]
            ]
        except Exception:
            return []

    # ------------------------------------------------------------------
    # 回复 & 发帖
    # ------------------------------------------------------------------

    def reply_comment(
        self, comment_id: str, reply_text: str, post_id: str = ""
    ) -> Dict:
        """回复帖子（=在帖子中发表回复/评论）"""
        tid = self.extract_post_id(post_id) if post_id else self.extract_post_id(comment_id)
        if not tid:
            return {"success": False, "message": "无法识别帖子ID"}
        if not self.bduss:
            return {"success": False, "message": "需要 BDUSS Cookie。设置环境变量 TIEBA_BDUSS"}

        try:
            self._run_async(lambda c: c.add_post(int(tid), reply_text))
            return {"success": True, "message": f"回复成功 (tid={tid})"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def post_thread(
        self, forum_name: str, title: str, content: str
    ) -> Dict:
        """在指定贴吧发新帖"""
        if not self.bduss:
            return {"success": False, "message": "需要 BDUSS Cookie。设置环境变量 TIEBA_BDUSS"}

        forum = self.extract_forum_name(forum_name) or forum_name
        if not forum:
            return {"success": False, "message": "请指定贴吧名称"}

        try:
            fid = self._run_async(lambda c: c.get_fid(forum))
            tid_result = self._run_async(lambda c: c.add_thread(int(fid), title, content))
            return {
                "success": True,
                "message": "发帖成功",
                "tid": str(tid_result),
                "url": f"https://tieba.baidu.com/p/{tid_result}",
            }
        except Exception as e:
            return {"success": False, "message": str(e)}

    def reply_batch(
        self, post_id: str, replies: List[Dict], delay_seconds: float = 3.0
    ) -> List[Dict]:
        """批量回复"""
        results = []
        for i, r in enumerate(replies):
            if i > 0:
                time.sleep(delay_seconds)
            results.append(self.reply_comment(
                comment_id="", reply_text=r.get("content", ""), post_id=post_id,
            ))
        return results

    # ------------------------------------------------------------------
    # Agent 接口
    # ------------------------------------------------------------------

    def test_connection(self) -> Dict:
        """测试连接"""
        if not self.bduss:
            return {
                "success": True,
                "message": "匿名模式 — 可读公开帖子，回复/发帖需设置 TIEBA_BDUSS",
                "user": None,
            }
        try:
            info = self._run_async(lambda c: c.get_self_info())
            name = getattr(info, 'user_name', '') or getattr(info, 'name', '')
            return {"success": True, "message": f"已认证: {name}" if name else "已认证", "user": name or None}
        except Exception as e:
            return {"success": False, "message": f"认证失败: {e}"}

    def get_agent_state(self) -> Dict:
        """AI agent 可读状态"""
        has_auth = bool(self.bduss)
        return {
            "configured": has_auth,
            "bduss_set": has_auth,
            "can_read": True,
            "can_reply": has_auth,
            "can_post": has_auth,
            "ready": True,
        }
