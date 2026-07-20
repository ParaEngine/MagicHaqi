"""
Twitter/X 平台收集器
使用 Tweepy 库通过 Twitter API v2 连接
"""

import time
import re
import tweepy
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector


class TwitterCollector(BaseCollector):
    """Twitter/X 评论收集器"""

    platform_name = "twitter"
    platform_display_name = "Twitter / X"
    platform_description = "使用 Twitter API v2 拉取推文评论，需要 Bearer Token"

    def __init__(self, bearer_token: str, wait_on_rate_limit: bool = True, **kwargs):
        super().__init__(**kwargs)
        self.bearer_token = bearer_token
        self.client = tweepy.Client(
            bearer_token=bearer_token,
            wait_on_rate_limit=wait_on_rate_limit
        )

    def validate_config(self) -> bool:
        return bool(self.bearer_token)

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或 ID 中提取推文 ID"""
        url_or_id = url_or_id.strip()
        # 匹配 URL 中的状态 ID
        match = re.search(r'/status/(\d+)', url_or_id)
        if match:
            return match.group(1)
        # 纯数字 ID
        if url_or_id.isdigit():
            return url_or_id
        return url_or_id

    def search_posts(self, keyword: str, max_posts: int = 10) -> List[Dict]:
        """按关键词搜索最近的推文（需要 API v2 权限，最多可搜索最近 7 天内容）"""
        posts = []
        try:
            response = self.client.search_recent_tweets(
                query=keyword,
                max_results=max(10, min(max_posts, 100)),
                tweet_fields=[
                    "id", "text", "created_at", "author_id",
                    "public_metrics", "lang"
                ],
                expansions=["author_id"],
                user_fields=["username", "name", "profile_image_url"]
            )

            if response.data is None:
                print(f"[Twitter] 搜索「{keyword}」未找到结果")
                return posts

            users = {}
            if response.includes and response.includes.get("users"):
                for user in response.includes["users"]:
                    users[user.id] = user

            for tweet in response.data[:max_posts]:
                author = users.get(tweet.author_id)
                public_metrics = getattr(tweet, "public_metrics", {}) or {}

                posts.append({
                    "id": str(tweet.id),
                    "title": "",
                    "content": tweet.text,
                    "author_id": str(tweet.author_id) if tweet.author_id else None,
                    "author_name": author.name if author else None,
                    "author_username": author.username if author else None,
                    "author_avatar": author.profile_image_url if author else None,
                    "created_at": tweet.created_at.isoformat() if tweet.created_at else None,
                    "like_count": public_metrics.get("like_count", 0),
                    "comment_count": public_metrics.get("reply_count", 0),
                    "share_count": public_metrics.get("retweet_count", 0),
                    "view_count": public_metrics.get("impression_count", 0),
                    "platform": self.platform_name,
                    "url": f"https://twitter.com/i/web/status/{tweet.id}",
                })

        except tweepy.TweepyException as e:
            print(f"[Twitter] 搜索「{keyword}」异常: {e}")

        print(f"[Twitter] 搜索「{keyword}」，找到 {len(posts)} 条推文")
        return posts

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取推文信息"""
        tweet_id = self.extract_post_id(post_id)
        try:
            response = self.client.get_tweet(
                id=tweet_id,
                tweet_fields=[
                    "id", "text", "created_at", "author_id",
                    "lang", "source", "public_metrics", "conversation_id"
                ],
                expansions=["author_id"],
                user_fields=["username", "name", "profile_image_url"]
            )

            if response.data is None:
                return None

            tweet = response.data
            users = {}
            if response.includes.get("users"):
                for user in response.includes["users"]:
                    users[user.id] = user

            author = users.get(tweet.author_id)
            public_metrics = getattr(tweet, "public_metrics", {}) or {}

            return {
                "id": str(tweet.id),
                "title": "",
                "content": tweet.text,
                "author_id": str(tweet.author_id) if tweet.author_id else None,
                "author_name": author.name if author else None,
                "author_username": author.username if author else None,
                "author_avatar": author.profile_image_url if author else None,
                "created_at": tweet.created_at.isoformat() if tweet.created_at else None,
                "like_count": public_metrics.get("like_count", 0),
                "comment_count": public_metrics.get("reply_count", 0),
                "share_count": public_metrics.get("retweet_count", 0),
                "view_count": public_metrics.get("impression_count", 0),
                "platform": self.platform_name,
                "url": f"https://twitter.com/i/web/status/{tweet.id}",
            }

        except tweepy.TweepyException as e:
            print(f"[Twitter] 获取推文信息失败: {e}")
            return None

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """拉取推文评论"""
        tweet_id = self.extract_post_id(post_id)
        all_comments = []
        pagination_token = None
        page = 0
        max_results_per_page = 100

        print(f"[Twitter] 开始拉取推文 {tweet_id} 的评论...")

        while True:
            page += 1
            try:
                remaining = None
                if max_comments:
                    remaining = max_comments - len(all_comments)
                    if remaining <= 0:
                        break
                    current_max = min(max_results_per_page, remaining)
                else:
                    current_max = max_results_per_page

                response = self.client.get_tweet(
                    id=tweet_id,
                    tweet_fields=["conversation_id"]
                )

                if response.data is None:
                    print(f"[Twitter] 未找到推文 {tweet_id}")
                    break

                conversation_id = response.data.conversation_id

                replies_response = self.client.search_recent_tweets(
                    query=f"conversation_id:{conversation_id}",
                    max_results=current_max,
                    next_token=pagination_token,
                    tweet_fields=[
                        "id", "text", "created_at", "author_id",
                        "lang", "source", "conversation_id",
                        "in_reply_to_user_id", "public_metrics"
                    ],
                    expansions=["author_id"],
                    user_fields=["username", "name", "profile_image_url"]
                )

                if replies_response.data is None:
                    print(f"[Twitter] 第 {page} 页无更多评论")
                    break

                users = {}
                if replies_response.includes.get("users"):
                    for user in replies_response.includes["users"]:
                        users[user.id] = user

                for reply in replies_response.data:
                    author = users.get(reply.author_id)
                    public_metrics = getattr(reply, "public_metrics", {}) or {}

                    comment = {
                        "id": str(reply.id),
                        "post_id": str(tweet_id),
                        "platform": self.platform_name,
                        "author_id": str(reply.author_id) if reply.author_id else None,
                        "author_username": author.username if author else None,
                        "author_name": author.name if author else None,
                        "author_avatar": author.profile_image_url if author else None,
                        "text": reply.text,
                        "created_at": reply.created_at.isoformat() if reply.created_at else None,
                        "like_count": public_metrics.get("like_count", 0),
                        "reply_count": public_metrics.get("reply_count", 0),
                        "ip_location": None,
                        "platform_data": {
                            "lang": getattr(reply, "lang", None),
                            "source": getattr(reply, "source", None),
                            "in_reply_to_user_id": str(reply.in_reply_to_user_id) if reply.in_reply_to_user_id else None,
                        }
                    }
                    all_comments.append(comment)

                print(f"[Twitter] 第 {page} 页获取 {len(replies_response.data)} 条，累计 {len(all_comments)} 条")

                pagination_token = replies_response.meta.get("next_token")
                if not pagination_token:
                    print("[Twitter] 已拉取全部评论")
                    break

                if max_comments and len(all_comments) >= max_comments:
                    print(f"[Twitter] 已达到最大数量限制 {max_comments}")
                    break

                if page % 5 == 0:
                    time.sleep(1)

            except tweepy.TooManyRequests as e:
                reset_time = e.response.headers.get("x-rate-limit-reset")
                if reset_time:
                    wait_seconds = int(reset_time) - int(time.time()) + 5
                    print(f"[Twitter] 触发限流，等待 {wait_seconds} 秒后重试...")
                    time.sleep(max(wait_seconds, 60))
                else:
                    print("[Twitter] 触发限流，等待 60 秒后重试...")
                    time.sleep(60)
                continue

            except tweepy.TweepyException as e:
                print(f"[Twitter] API 请求错误: {e}")
                break

            except Exception as e:
                print(f"[Twitter] 未知错误: {e}")
                break

        print(f"[Twitter] 共获取 {len(all_comments)} 条评论")
        return all_comments
