"""
微博 (Weibo) 评论收集器
使用微博 API 拉取微博评论
"""

import re
import time
import requests
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector


class WeiboCollector(BaseCollector):
    """微博评论收集器"""

    platform_name = "weibo"
    platform_display_name = "微博"
    platform_description = "使用微博 API 拉取评论，支持移动端和 PC 端"

    MOBILE_URL = "https://m.weibo.cn"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://m.weibo.cn/",
    }

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        if cookie:
            self.session.headers["Cookie"] = cookie

    def validate_config(self) -> bool:
        return True  # 未登录也能获取部分公开评论

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或 ID 中提取微博 ID"""
        url_or_id = url_or_id.strip()
        # 匹配 status/ 后的 ID
        match = re.search(r'/status/(\d+)', url_or_id)
        if match:
            return match.group(1)
        # 匹配 detail/ 后的 ID
        match = re.search(r'/detail/(\d+)', url_or_id)
        if match:
            return match.group(1)
        # 纯数字
        if url_or_id.isdigit():
            return url_or_id
        return url_or_id

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取微博信息"""
        mid = self.extract_post_id(post_id)

        try:
            resp = self.session.get(
                f"{self.MOBILE_URL}/statuses/show",
                params={"id": mid},
                timeout=10
            )
            data = resp.json()

            if data.get("ok") == 1 and data.get("data"):
                status = data["data"]
                user = status.get("user", {})

                return {
                    "id": str(status.get("mid", status.get("id", mid))),
                    "title": "",
                    "content": status.get("text", ""),
                    "author_id": str(user.get("id", "")),
                    "author_name": user.get("screen_name", ""),
                    "author_username": user.get("screen_name", ""),
                    "author_avatar": user.get("avatar_hd", ""),
                    "created_at": status.get("created_at", ""),
                    "like_count": status.get("attitudes_count", 0),
                    "comment_count": status.get("comments_count", 0),
                    "share_count": status.get("reposts_count", 0),
                    "view_count": 0,
                    "platform": self.platform_name,
                    "url": f"https://m.weibo.cn/status/{status.get('mid', mid)}",
                }

        except Exception as e:
            print(f"[微博] 获取微博信息异常: {e}")

        return {
            "id": mid,
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
            "url": f"https://m.weibo.cn/status/{mid}",
        }

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """拉取微博评论"""
        mid = self.extract_post_id(post_id)
        all_comments = []
        page = 1

        print(f"[微博] 开始拉取微博 {mid} 的评论...")

        while True:
            try:
                resp = self.session.get(
                    f"{self.MOBILE_URL}/comments/hotflow",
                    params={
                        "id": mid,
                        "mid": mid,
                        "max_id_type": 0,
                        "page": page,
                    },
                    timeout=10
                )
                data = resp.json()

                if data.get("ok") != 1:
                    print(f"[微博] 拉取评论失败: {data.get('msg', '未知错误')}")
                    break

                comments_data = data.get("data", {})
                comments_list = comments_data.get("data", [])

                if not comments_list:
                    print(f"[微博] 第 {page} 页无更多评论")
                    break

                for comment in comments_list:
                    user = comment.get("user", {})

                    comment_data = {
                        "id": str(comment.get("id", "")),
                        "post_id": mid,
                        "platform": self.platform_name,
                        "author_id": str(user.get("id", "")),
                        "author_username": user.get("screen_name", ""),
                        "author_name": user.get("screen_name", ""),
                        "author_avatar": user.get("avatar_hd", ""),
                        "text": comment.get("text", ""),
                        "created_at": comment.get("created_at", ""),
                        "like_count": comment.get("like_count", 0),
                        "reply_count": comment.get("total_number", 0),
                        "ip_location": comment.get("source", ""),
                        "platform_data": {
                            "mid": comment.get("mid"),
                            "rootid": comment.get("rootid"),
                            "floor_number": comment.get("floor_number"),
                        }
                    }
                    all_comments.append(comment_data)

                    if max_comments and len(all_comments) >= max_comments:
                        break

                print(f"[微博] 第 {page} 页获取 {len(comments_list)} 条，累计 {len(all_comments)} 条")

                if max_comments and len(all_comments) >= max_comments:
                    print(f"[微博] 已达到最大数量限制 {max_comments}")
                    break

                # 检查是否有下一页
                max_id = comments_data.get("max_id", 0)
                if max_id == 0:
                    print("[微博] 已拉取全部评论")
                    break

                page += 1
                time.sleep(0.8)  # 请求间隔

            except Exception as e:
                print(f"[微博] 拉取评论异常: {e}")
                break

        print(f"[微博] 共获取 {len(all_comments)} 条评论")
        return all_comments
