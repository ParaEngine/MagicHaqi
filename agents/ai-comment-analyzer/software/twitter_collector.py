"""
Twitter 平台连接模块
使用 Tweepy 库通过 Twitter API v2 连接，拉取特定帖子的评论，
并处理 API 的分页逻辑和限流错误。
"""

import time
import tweepy
from typing import List, Dict, Optional
from datetime import datetime


class TwitterCollector:
    """Twitter 评论收集器"""

    # 每次请求最多获取的评论数（API 限制最大为 100）
    MAX_RESULTS_PER_PAGE = 100

    def __init__(self, bearer_token: str, wait_on_rate_limit: bool = True):
        """
        初始化 Twitter 客户端

        Args:
            bearer_token: Twitter API v2 Bearer Token
            wait_on_rate_limit: 遇到限流时是否自动等待
        """
        self.client = tweepy.Client(
            bearer_token=bearer_token,
            wait_on_rate_limit=wait_on_rate_limit
        )

    def fetch_comments(self, tweet_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """
        拉取指定推文的所有评论（支持分页）

        Args:
            tweet_id: 推文 ID
            max_comments: 可选，限制最多拉取的评论数（None 表示全部拉取）

        Returns:
            评论列表，每条评论为字典格式
        """
        all_comments = []
        pagination_token = None
        page = 0

        print(f"[Twitter] 开始拉取推文 {tweet_id} 的评论...")

        while True:
            page += 1
            try:
                # 计算本次请求的数量
                remaining = None
                if max_comments:
                    remaining = max_comments - len(all_comments)
                    if remaining <= 0:
                        break
                    max_results = min(self.MAX_RESULTS_PER_PAGE, remaining)
                else:
                    max_results = self.MAX_RESULTS_PER_PAGE

                # 请求评论数据
                response = self.client.get_tweet(
                    id=tweet_id,
                    tweet_fields=["conversation_id"]
                )

                if response.data is None:
                    print(f"[Twitter] 未找到推文 {tweet_id}")
                    break

                conversation_id = response.data.conversation_id

                # 获取评论（回复）
                replies_response = self.client.search_recent_tweets(
                    query=f"conversation_id:{conversation_id}",
                    max_results=max_results,
                    next_token=pagination_token,
                    tweet_fields=[
                        "id", "text", "created_at", "author_id",
                        "lang", "source", "conversation_id",
                        "in_reply_to_user_id", "public_metrics"
                    ],
                    expansions=["author_id"],
                    user_fields=["username", "name", "id"]
                )

                if replies_response.data is None:
                    print(f"[Twitter] 第 {page} 页无更多评论")
                    break

                # 构建用户映射
                users = {}
                if replies_response.includes.get("users"):
                    for user in replies_response.includes["users"]:
                        users[user.id] = user

                # 处理当前页的评论
                comments = self._process_replies(
                    replies_response.data,
                    users,
                    tweet_id,
                    conversation_id
                )
                all_comments.extend(comments)

                print(f"[Twitter] 第 {page} 页获取 {len(comments)} 条评论，累计 {len(all_comments)} 条")

                # 检查是否有下一页
                pagination_token = replies_response.meta.get("next_token")
                if not pagination_token:
                    print("[Twitter] 已拉取全部评论")
                    break

                # 检查是否达到最大数量限制
                if max_comments and len(all_comments) >= max_comments:
                    print(f"[Twitter] 已达到最大数量限制 {max_comments}")
                    break

                # 简单的请求间隔，避免触发限流
                if page % 5 == 0:
                    time.sleep(1)

            except tweepy.TooManyRequests as e:
                # 处理限流错误
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

    def _process_replies(
        self,
        replies: List,
        users: Dict,
        tweet_id: str,
        conversation_id: str
    ) -> List[Dict]:
        """
        处理 API 返回的回复数据，转换为统一格式

        Args:
            replies: Tweepy 返回的回复列表
            users: 用户信息映射
            tweet_id: 原始推文 ID
            conversation_id: 会话 ID

        Returns:
            格式化后的评论列表
        """
        comments = []

        for reply in replies:
            # 获取作者信息
            author = users.get(reply.author_id)

            # 获取公共指标（点赞、回复、转发数）
            public_metrics = getattr(reply, "public_metrics", {}) or {}

            comment = {
                "id": str(reply.id),
                "post_id": str(tweet_id),
                "author_id": str(reply.author_id) if reply.author_id else None,
                "author_username": author.username if author else None,
                "author_name": author.name if author else None,
                "text": reply.text,
                "created_at": reply.created_at.isoformat() if reply.created_at else None,
                "like_count": public_metrics.get("like_count", 0),
                "reply_count": public_metrics.get("reply_count", 0),
                "retweet_count": public_metrics.get("retweet_count", 0),
                "in_reply_to_user_id": str(reply.in_reply_to_user_id) if reply.in_reply_to_user_id else None,
                "conversation_id": str(conversation_id),
                "lang": getattr(reply, "lang", None),
                "source": getattr(reply, "source", None),
            }
            comments.append(comment)

        return comments

    def get_tweet_info(self, tweet_id: str) -> Optional[Dict]:
        """
        获取推文基本信息

        Args:
            tweet_id: 推文 ID

        Returns:
            推文信息字典
        """
        try:
            response = self.client.get_tweet(
                id=tweet_id,
                tweet_fields=[
                    "id", "text", "created_at", "author_id",
                    "lang", "source", "public_metrics", "conversation_id"
                ],
                expansions=["author_id"],
                user_fields=["username", "name"]
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
                "text": tweet.text,
                "created_at": tweet.created_at.isoformat() if tweet.created_at else None,
                "author_id": str(tweet.author_id) if tweet.author_id else None,
                "author_username": author.username if author else None,
                "author_name": author.name if author else None,
                "like_count": public_metrics.get("like_count", 0),
                "retweet_count": public_metrics.get("retweet_count", 0),
                "reply_count": public_metrics.get("reply_count", 0),
                "quote_count": public_metrics.get("quote_count", 0),
                "conversation_id": str(tweet.conversation_id) if tweet.conversation_id else None,
                "lang": getattr(tweet, "lang", None),
                "source": getattr(tweet, "source", None),
            }

        except tweepy.TweepyException as e:
            print(f"[Twitter] 获取推文信息失败: {e}")
            return None
