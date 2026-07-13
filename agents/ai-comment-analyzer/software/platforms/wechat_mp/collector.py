"""
微信公众号评论采集器 (WeChat MP Comment Collector)

基于微信官方评论管理 API，采集公众号文章评论并提供回复能力。

API 文档: https://developers.weixin.qq.com/doc/offiaccount/Comments_management.html

关键 API:
  - POST /cgi-bin/comment/open      开通评论
  - POST /cgi-bin/comment/list      获取评论列表
  - POST /cgi-bin/comment/markelect 精选评论
  - POST /cgi-bin/comment/reply/add 回复评论
  - POST /cgi-bin/comment/delete    删除评论
"""

import json
import os
import re
from typing import List, Dict, Optional, Tuple
from datetime import datetime

import requests

from ..base import BaseCollector

# 微信评论 API 基础路径
API_BASE = "https://api.weixin.qq.com/cgi-bin/comment"


class WechatMPCollector(BaseCollector):
    """微信公众号评论采集器"""

    platform_name = "wechat_mp"
    platform_display_name = "微信公众号"
    platform_description = "使用微信官方评论管理 API 拉取文章评论，需要 AppID + AppSecret"

    def __init__(self, appid: str = "", secret: str = "", **kwargs):
        """
        初始化采集器

        Args:
            appid: 微信公众号 AppID（优先从环境变量 WECHAT_APPID）
            secret: 微信公众号 AppSecret（优先从环境变量 WECHAT_SECRET）
        """
        super().__init__(**kwargs)
        self.appid = appid or os.getenv("WECHAT_APPID", "")
        self.secret = secret or os.getenv("WECHAT_SECRET", "")
        self._access_token: Optional[str] = None
        self._token_expires: float = 0

    # ------------------------------------------------------------------
    # 认证
    # ------------------------------------------------------------------

    def validate_config(self) -> bool:
        """验证配置是否完整"""
        return bool(self.appid and self.secret)

    def _get_access_token(self) -> str:
        """获取或刷新 access_token（带缓存）"""
        import time
        now = time.time()
        if self._access_token and now < self._token_expires:
            return self._access_token

        url = "https://api.weixin.qq.com/cgi-bin/token"
        params = {
            "grant_type": "client_credential",
            "appid": self.appid,
            "secret": self.secret,
        }
        resp = requests.get(url, params=params, timeout=15)
        data = resp.json()

        if "errcode" in data and data["errcode"] != 0:
            raise RuntimeError(
                f"微信认证失败 [{data.get('errcode')}]: {data.get('errmsg')}"
            )

        self._access_token = data["access_token"]
        self._token_expires = now + data.get("expires_in", 7200) - 300  # 提前5分钟刷新
        return self._access_token

    def _api_post(self, path: str, data: dict) -> dict:
        """POST 到微信评论 API"""
        token = self._get_access_token()
        url = f"{API_BASE}/{path}?access_token={token}"
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        resp = requests.post(
            url, data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=30,
        )
        result = resp.json()
        if result.get("errcode", 0) != 0:
            errcode = result.get("errcode")
            errmsg = result.get("errmsg", "unknown")
            # 某些错误可忽略
            if errcode in (88000,):  # 没有评论数据
                return result
            raise RuntimeError(f"微信API错误 [{errcode}]: {errmsg}")
        return result

    # ------------------------------------------------------------------
    # 文章 ID 解析
    # ------------------------------------------------------------------

    @staticmethod
    def extract_article_ids(post_id: str) -> Tuple[str, int]:
        """
        从输入中解析文章标识

        支持格式:
          - "msg_data_id,index" → ("1234567", 1)
          - "https://mp.weixin.qq.com/s/xxx" → 需要额外查询（暂不支持）
          - "1234567,1" → ("1234567", 1)

        Returns:
            (msg_data_id, index)
        """
        post_id = post_id.strip()

        # 逗号分隔格式
        if "," in post_id:
            parts = post_id.split(",")
            return parts[0].strip(), int(parts[1].strip())

        # URL 格式暂不支持直接解析
        # 公众号文章 URL 形如 https://mp.weixin.qq.com/s/xxx
        # 需要通过 msg_data_id 来标识

        # 默认 index=1
        return post_id, 1

    # ------------------------------------------------------------------
    # BaseCollector 接口
    # ------------------------------------------------------------------

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """
        获取文章基本信息

        Args:
            post_id: 文章标识 (msg_data_id,index 或 URL)

        Returns:
            文章信息字典
        """
        msg_data_id, index = self.extract_article_ids(post_id)

        # 先拉取评论以获取总数
        try:
            result = self._api_post("list", {
                "msg_data_id": msg_data_id,
                "index": index,
                "begin": 0,
                "count": 1,
                "type": 0,  # 0=全部
            })
            total = result.get("total", 0)
        except Exception:
            total = 0

        return {
            "id": f"{msg_data_id},{index}",
            "msg_data_id": msg_data_id,
            "index": index,
            "title": f"公众号文章 {msg_data_id}",
            "content": "",
            "author_id": "",
            "author_name": "公众号作者",
            "author_avatar": "",
            "created_at": datetime.now().isoformat(),
            "like_count": 0,
            "comment_count": total,
            "share_count": 0,
            "view_count": 0,
            "platform": self.platform_name,
            "url": "",
        }

    def fetch_comments(
        self, post_id: str, max_comments: Optional[int] = None
    ) -> List[Dict]:
        """
        拉取文章评论

        Args:
            post_id: 文章标识
            max_comments: 最大评论数

        Returns:
            评论列表
        """
        msg_data_id, index = self.extract_article_ids(post_id)
        all_comments: List[Dict] = []
        begin = 0
        count = min(max_comments or 50, 50)  # 微信 API 单次最多50条

        while True:
            try:
                result = self._api_post("list", {
                    "msg_data_id": msg_data_id,
                    "index": index,
                    "begin": begin,
                    "count": count,
                    "type": 0,  # 0=全部评论
                })
            except RuntimeError as e:
                if "88000" in str(e):
                    break  # 没有更多评论
                raise

            comments = result.get("comment", [])
            for c in comments:
                all_comments.append({
                    "id": str(c.get("user_comment_id", "")),
                    "post_id": post_id,
                    "platform": self.platform_name,
                    "author_id": c.get("openid", ""),
                    "author_username": c.get("nickname", "微信用户"),
                    "author_name": c.get("nickname", "微信用户"),
                    "author_avatar": c.get("headimgurl", ""),
                    "text": c.get("content", ""),
                    "created_at": datetime.fromtimestamp(
                        int(c.get("create_time", 0))
                    ).isoformat() if c.get("create_time") else "",
                    "like_count": int(c.get("comment_like_count", 0)),
                    "reply_count": int(c.get("reply_count", 0)),
                    "is_elected": c.get("is_elected", 0) == 1,
                    "ip_location": "",
                    "platform_data": c,
                })

            total = result.get("total", 0)
            begin += count

            if len(comments) < count or begin >= total:
                break
            if max_comments and len(all_comments) >= max_comments:
                break

        return all_comments[:max_comments] if max_comments else all_comments

    def search_posts(self, keyword: str, max_posts: int = 10) -> List[Dict]:
        """公众号不支持按关键词搜索已发布文章，返回空"""
        return []

    # ------------------------------------------------------------------
    # 评论管理
    # ------------------------------------------------------------------

    def open_comment(self, post_id: str) -> bool:
        """
        为文章开通评论

        Args:
            post_id: 文章标识

        Returns:
            是否成功
        """
        msg_data_id, index = self.extract_article_ids(post_id)
        try:
            self._api_post("open", {
                "msg_data_id": msg_data_id,
                "index": index,
            })
            return True
        except Exception:
            return False

    def mark_elected(self, post_id: str, comment_id: str) -> bool:
        """
        精选评论（设为可见）

        Args:
            post_id: 文章标识
            comment_id: 评论 ID (user_comment_id)

        Returns:
            是否成功
        """
        msg_data_id, index = self.extract_article_ids(post_id)
        try:
            self._api_post("markelect", {
                "msg_data_id": msg_data_id,
                "index": index,
                "user_comment_id": int(comment_id),
            })
            return True
        except Exception:
            return False

    def delete_comment(self, post_id: str, comment_id: str) -> bool:
        """
        删除评论

        Args:
            post_id: 文章标识
            comment_id: 评论 ID

        Returns:
            是否成功
        """
        msg_data_id, index = self.extract_article_ids(post_id)
        try:
            self._api_post("delete", {
                "msg_data_id": msg_data_id,
                "index": index,
                "user_comment_id": int(comment_id),
            })
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # 回复评论
    # ------------------------------------------------------------------

    def reply_comment(
        self, post_id: str, comment_id: str, content: str
    ) -> Tuple[bool, str]:
        """
        回复评论

        Args:
            post_id: 文章标识
            comment_id: 评论 ID
            content: 回复内容 (≤140字)

        Returns:
            (是否成功, 消息)
        """
        msg_data_id, index = self.extract_article_ids(post_id)

        # 截断回复内容
        if len(content) > 140:
            content = content[:140]

        try:
            result = self._api_post("reply/add", {
                "msg_data_id": msg_data_id,
                "index": index,
                "user_comment_id": int(comment_id),
                "content": content,
            })
            return True, f"回复成功 (comment_id={comment_id})"
        except Exception as e:
            return False, str(e)

    def reply_batch(
        self, post_id: str, replies: List[Dict],
        delay_seconds: float = 5.0,
    ) -> List[Dict]:
        """
        批量回复评论

        Args:
            post_id: 文章标识
            replies: 回复列表 [{"comment_id": "xxx", "content": "..."}, ...]
            delay_seconds: 每条之间的延迟（秒）

        Returns:
            回复结果列表 [{"comment_id": ..., "success": bool, "message": str}, ...]
        """
        import time
        results = []
        for i, reply in enumerate(replies):
            if i > 0:
                time.sleep(delay_seconds)

            success, msg = self.reply_comment(
                post_id=post_id,
                comment_id=reply["comment_id"],
                content=reply["content"],
            )
            results.append({
                "comment_id": reply["comment_id"],
                "success": success,
                "message": msg,
            })
        return results

    # ------------------------------------------------------------------
    # Agent 集成接口
    # ------------------------------------------------------------------

    def get_agent_state(self) -> Dict:
        """返回可供 AI agent 读取的状态"""
        has_token = False
        try:
            self._get_access_token()
            has_token = True
        except Exception:
            pass

        return {
            "configured": self.validate_config(),
            "authenticated": has_token,
            "platform": self.platform_display_name,
            "ready": self.validate_config() and has_token,
        }
