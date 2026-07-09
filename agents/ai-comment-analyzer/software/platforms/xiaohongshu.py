"""
小红书 (Xiaohongshu) 评论收集器
使用小红书 API 拉取笔记评论，需要 Cookie
"""

import re
import time
import requests
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector


class XiaohongshuCollector(BaseCollector):
    """小红书评论收集器"""

    platform_name = "xiaohongshu"
    platform_display_name = "小红书"
    platform_description = "使用小红书 API 拉取笔记评论，需要登录 Cookie"

    BASE_URL = "https://edith.xiaohongshu.com/api/sns/web/v1"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.xiaohongshu.com/",
        "Origin": "https://www.xiaohongshu.com",
    }

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        if cookie:
            self.session.headers["Cookie"] = cookie

    def validate_config(self) -> bool:
        return bool(self.cookie)

    def search_posts(self, keyword: str, max_posts: int = 10) -> List[Dict]:
        """
        按关键词搜索笔记（实验性）

        注：小红书搜索接口要求 x-s/x-t 签名请求头，本项目约定不引入浏览器/JS 执行环境
        来逆向签名算法，因此本方法为尽力而为实现，若小红书风控升级导致失败，
        会返回空列表并打印提示，不影响其他平台功能
        """
        keyword = keyword.strip()
        posts = []
        try:
            resp = self.session.post(
                f"{self.BASE_URL}/search/notes",
                json={
                    "keyword": keyword,
                    "page": 1,
                    "page_size": max_posts,
                    "search_id": "",
                    "sort": "general",
                    "note_type": 0,
                },
                timeout=10
            )
            data = resp.json()

            items = data.get("data", {}).get("items", []) or []
            for item in items[:max_posts]:
                note = item.get("note_card", {}) or {}
                if not note:
                    continue
                user_info = note.get("user", {}) or {}
                interact_info = note.get("interact_info", {}) or {}
                note_id = note.get("note_id", item.get("id", ""))

                posts.append({
                    "id": note_id,
                    "title": note.get("display_title", ""),
                    "content": note.get("desc", ""),
                    "author_id": user_info.get("user_id", ""),
                    "author_name": user_info.get("nickname", ""),
                    "author_username": user_info.get("nickname", ""),
                    "author_avatar": user_info.get("avatar", ""),
                    "created_at": "",
                    "like_count": interact_info.get("liked_count", 0),
                    "comment_count": interact_info.get("comment_count", 0),
                    "share_count": interact_info.get("share_count", 0),
                    "view_count": 0,
                    "platform": self.platform_name,
                    "url": f"https://www.xiaohongshu.com/explore/{note_id}",
                })

        except Exception as e:
            print(f"[小红书] 搜索「{keyword}」异常（该平台搜索接口需要签名，可能已失效）: {e}")

        print(f"[小红书] 搜索「{keyword}」，找到 {len(posts)} 篇笔记")
        return posts

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或 ID 中提取笔记 ID"""
        url_or_id = url_or_id.strip()
        # 匹配 explore/ 后的 ID
        match = re.search(r'/explore/([a-zA-Z0-9]+)', url_or_id)
        if match:
            return match.group(1)
        # 匹配 discovery/item/ 后的 ID
        match = re.search(r'/discovery/item/([a-zA-Z0-9]+)', url_or_id)
        if match:
            return match.group(1)
        return url_or_id

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取笔记信息"""
        note_id = self.extract_post_id(post_id)

        try:
            resp = self.session.get(
                f"{self.BASE_URL}/feed/detail",
                params={"note_id": note_id, "xsec_source": "pc_search"},
                timeout=10
            )
            data = resp.json()

            if data.get("success") and data.get("data"):
                note = data["data"]["items"][0] if data["data"].get("items") else {}
                note_data = note.get("note_card", {})
                user_info = note_data.get("user", {})
                interact_info = note_data.get("interact_info", {})

                return {
                    "id": note_data.get("note_id", note_id),
                    "title": note_data.get("title", ""),
                    "content": note_data.get("desc", ""),
                    "author_id": user_info.get("user_id", ""),
                    "author_name": user_info.get("nickname", ""),
                    "author_username": user_info.get("nickname", ""),
                    "author_avatar": user_info.get("avatar", ""),
                    "created_at": "",
                    "like_count": interact_info.get("liked_count", 0),
                    "comment_count": interact_info.get("comment_count", 0),
                    "share_count": interact_info.get("share_count", 0),
                    "view_count": 0,
                    "platform": self.platform_name,
                    "url": f"https://www.xiaohongshu.com/explore/{note_data.get('note_id', note_id)}",
                }

        except Exception as e:
            print(f"[小红书] 获取笔记信息异常: {e}")

        # 返回基本信息
        return {
            "id": note_id,
            "title": "",
            "content": "",
            "author_id": "",
            "author_name": "",
            "author_username": "",
            "author_avatar": "",
            "created_at": "",
            "like_count": 0,
            "comment_count": 0,
            "share_count": 0,
            "view_count": 0,
            "platform": self.platform_name,
            "url": f"https://www.xiaohongshu.com/explore/{note_id}",
        }

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """拉取笔记评论"""
        note_id = self.extract_post_id(post_id)
        all_comments = []
        cursor = ""

        print(f"[小红书] 开始拉取笔记 {note_id} 的评论...")

        while True:
            try:
                payload = {
                    "note_id": note_id,
                    "cursor": cursor,
                    "top_comment_id": "",
                    "image_formats": ["jpg", "webp", "avif"],
                }

                resp = self.session.post(
                    f"{self.BASE_URL}/comment/page",
                    json=payload,
                    timeout=10
                )
                data = resp.json()

                if not data.get("success"):
                    msg = data.get("msg", "未知错误")
                    print(f"[小红书] 拉取评论失败: {msg}")
                    break

                comments_data = data.get("data", {})
                comments_list = comments_data.get("comments", [])

                if not comments_list:
                    print("[小红书] 无更多评论")
                    break

                for comment in comments_list:
                    user_info = comment.get("user_info", {})
                    like_info = comment.get("like_info", {})

                    comment_data = {
                        "id": comment.get("id", ""),
                        "post_id": note_id,
                        "platform": self.platform_name,
                        "author_id": user_info.get("user_id", ""),
                        "author_username": user_info.get("nickname", ""),
                        "author_name": user_info.get("nickname", ""),
                        "author_avatar": user_info.get("image", ""),
                        "text": comment.get("content", ""),
                        "created_at": datetime.fromtimestamp(comment.get("create_time", 0) / 1000).isoformat() if comment.get("create_time") else None,
                        "like_count": like_info.get("like_count", 0),
                        "reply_count": comment.get("sub_comment_count", 0),
                        "ip_location": comment.get("ip_location", ""),
                        "platform_data": {
                            "status": comment.get("status"),
                            "note_id": note_id,
                        }
                    }
                    all_comments.append(comment_data)

                    if max_comments and len(all_comments) >= max_comments:
                        break

                print(f"[小红书] 获取 {len(comments_list)} 条，累计 {len(all_comments)} 条")

                if max_comments and len(all_comments) >= max_comments:
                    print(f"[小红书] 已达到最大数量限制 {max_comments}")
                    break

                # 检查是否有下一页
                has_more = comments_data.get("has_more", False)
                if not has_more:
                    print("[小红书] 已拉取全部评论")
                    break

                cursor = comments_data.get("cursor", "")
                if not cursor:
                    break

                time.sleep(1)  # 请求间隔

            except Exception as e:
                print(f"[小红书] 拉取评论异常: {e}")
                break

        print(f"[小红书] 共获取 {len(all_comments)} 条评论")
        return all_comments

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        """
        回复评论（需要登录 Cookie）

        Args:
            comment_id: 被回复的评论 ID
            reply_text: 回复内容
            post_id: 笔记 ID（可选，用于关联）

        Returns:
            {"success": bool, "message": str}
        """
        if not self.cookie:
            return {
                "success": False,
                "error": "小红书回复需要登录 Cookie",
                "message": "请在侧边栏配置小红书 Cookie"
            }

        try:
            body = {
                "note_id": post_id or "",
                "content": reply_text,
                "target_comment_id": comment_id,
            }
            resp = self.session.post(
                f"{self.BASE_URL}/comment/post",
                json=body,
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://www.xiaohongshu.com/explore/{post_id}" if post_id else "https://www.xiaohongshu.com/",
                },
                timeout=15,
            )
            result = resp.json()

            if result.get("success"):
                print(f"[小红书] 回复成功: comment_id={comment_id}")
                return {"success": True, "message": "回复成功"}

            err = result.get("msg", "未知错误")
            print(f"[小红书] 回复失败: {err}")
            return {"success": False, "error": err}

        except Exception as e:
            print(f"[小红书] 回复异常: {e}")
            return {"success": False, "error": str(e)}
