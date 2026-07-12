"""
抖音 (Douyin) 评论收集器
使用抖音 API 拉取视频评论
"""

import re
import time
import requests
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector


class DouyinCollector(BaseCollector):
    """抖音评论收集器"""

    platform_name = "douyin"
    platform_display_name = "抖音"
    platform_description = "使用抖音 API 拉取视频评论，需要登录 Cookie"

    BASE_URL = "https://www.douyin.com/aweme/v1/web"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.douyin.com/",
        "Origin": "https://www.douyin.com",
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
        按关键词搜索视频（实验性）

        注：抖音 Web 搜索接口自 2021 年起要求 X-Bogus/a_bogus 签名参数，
        本项目约定不引入浏览器/JS 执行环境来逆向签名算法，因此本方法为尽力而为实现，
        若抖音风控升级导致失败，会返回空列表并打印提示，不影响其他平台功能
        """
        keyword = keyword.strip()
        posts = []
        try:
            resp = self.session.get(
                f"{self.BASE_URL}/general/search/single/",
                params={
                    "keyword": keyword,
                    "search_channel": "aweme_general",
                    "sort_type": 0,
                    "publish_time": 0,
                    "count": max_posts,
                    "offset": 0,
                },
                timeout=10
            )
            data = resp.json()

            items = data.get("data", []) or []
            for entry in items[:max_posts]:
                aweme = entry.get("aweme_info") or entry.get("aweme") or {}
                if not aweme:
                    continue
                author = aweme.get("author", {}) or {}
                stats = aweme.get("statistics", {}) or {}
                aweme_id = aweme.get("aweme_id", "")

                posts.append({
                    "id": aweme_id,
                    "title": aweme.get("desc", ""),
                    "content": aweme.get("desc", ""),
                    "author_id": str(author.get("uid", "")),
                    "author_name": author.get("nickname", ""),
                    "author_username": author.get("nickname", ""),
                    "author_avatar": (author.get("avatar_thumb", {}) or {}).get("url_list", [""])[0],
                    "created_at": "",
                    "like_count": stats.get("digg_count", 0),
                    "comment_count": stats.get("comment_count", 0),
                    "share_count": stats.get("share_count", 0),
                    "view_count": stats.get("play_count", 0),
                    "platform": self.platform_name,
                    "url": f"https://www.douyin.com/video/{aweme_id}",
                })

        except Exception as e:
            print(f"[抖音] 搜索「{keyword}」异常（该平台搜索接口需要签名，可能已失效）: {e}")

        print(f"[抖音] 搜索「{keyword}」，找到 {len(posts)} 个视频")
        return posts

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或 ID 中提取视频 ID"""
        url_or_id = url_or_id.strip()
        # 匹配 /video/ 后的 ID
        match = re.search(r'/video/(\d+)', url_or_id)
        if match:
            return match.group(1)
        # 匹配 /note/ 后的 ID
        match = re.search(r'/note/(\d+)', url_or_id)
        if match:
            return match.group(1)
        # 纯数字
        if url_or_id.isdigit():
            return url_or_id
        return url_or_id

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取视频信息"""
        aweme_id = self.extract_post_id(post_id)

        try:
            resp = self.session.get(
                f"{self.BASE_URL}/comment/list",
                params={
                    "aweme_id": aweme_id,
                    "cursor": 0,
                    "count": 1,
                    "item_type": 0,
                },
                timeout=10
            )
            data = resp.json()

            comments = data.get("comments", [])
            total = data.get("total", 0)

            return {
                "id": aweme_id,
                "title": "",
                "content": "",
                "author_id": "",
                "author_name": "",
                "author_username": "",
                "author_avatar": "",
                "created_at": "",
                "like_count": 0,
                "comment_count": total,
                "share_count": 0,
                "view_count": 0,
                "platform": self.platform_name,
                "url": f"https://www.douyin.com/video/{aweme_id}",
            }

        except Exception as e:
            print(f"[抖音] 获取视频信息异常: {e}")

        return {
            "id": aweme_id,
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
            "url": f"https://www.douyin.com/video/{aweme_id}",
        }

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """拉取视频评论"""
        aweme_id = self.extract_post_id(post_id)
        all_comments = []
        cursor = 0
        count = 20

        print(f"[抖音] 开始拉取视频 {aweme_id} 的评论...")

        while True:
            try:
                resp = self.session.get(
                    f"{self.BASE_URL}/comment/list",
                    params={
                        "aweme_id": aweme_id,
                        "cursor": cursor,
                        "count": count,
                        "item_type": 0,
                    },
                    timeout=10
                )
                data = resp.json()

                comments_list = data.get("comments", [])

                if not comments_list:
                    print(f"[抖音] 无更多评论 (cursor={cursor})")
                    break

                for comment in comments_list:
                    user = comment.get("user", {})

                    comment_data = {
                        "id": str(comment.get("cid", "")),
                        "post_id": aweme_id,
                        "platform": self.platform_name,
                        "author_id": str(user.get("uid", "")),
                        "author_username": user.get("nickname", ""),
                        "author_name": user.get("nickname", ""),
                        "author_avatar": user.get("avatar_medium", {}).get("url_list", [""])[0] if user.get("avatar_medium") else "",
                        "text": comment.get("text", ""),
                        "created_at": datetime.fromtimestamp(comment.get("create_time", 0)).isoformat() if comment.get("create_time") else None,
                        "like_count": comment.get("digg_count", 0),
                        "reply_count": comment.get("reply_comment_total", 0),
                        "ip_location": comment.get("ip_label", ""),
                        "platform_data": {
                            "cid": comment.get("cid"),
                            "aweme_id": aweme_id,
                            "reply_id": comment.get("reply_id"),
                        }
                    }
                    all_comments.append(comment_data)

                    if max_comments and len(all_comments) >= max_comments:
                        break

                print(f"[抖音] cursor={cursor}，获取 {len(comments_list)} 条，累计 {len(all_comments)} 条")

                if max_comments and len(all_comments) >= max_comments:
                    print(f"[抖音] 已达到最大数量限制 {max_comments}")
                    break

                # 检查是否有下一页
                has_more = data.get("has_more", 0)
                if not has_more:
                    print("[抖音] 已拉取全部评论")
                    break

                cursor = data.get("cursor", cursor + count)
                time.sleep(0.8)  # 请求间隔

            except Exception as e:
                print(f"[抖音] 拉取评论异常: {e}")
                break

        print(f"[抖音] 共获取 {len(all_comments)} 条评论")
        return all_comments
