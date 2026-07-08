"""
TapTap 评论收集器
使用 TapTap 公开 API 拉取游戏评价与评论
"""

import re
import time
import requests
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector


class TapTapCollector(BaseCollector):
    """TapTap 游戏社区评论收集器"""

    platform_name = "taptap"
    platform_display_name = "TapTap (游戏社区)"
    platform_description = "使用 TapTap 公开 API 拉取游戏评价与评论，无需登录"

    BASE_URL = "https://www.taptap.cn"
    API_BASE = "https://www.taptap.cn/webapiv2"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.taptap.cn/",
        "Accept": "application/json",
    }

    # TapTap 要求的 X-UA 头（Web 端标识，缺失会返回 404）
    XUA = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&LOC=CN&PLT=PC&DS=Android&OS=Windows&OSV=10&DT=PC"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        self.session.headers["X-UA"] = self.XUA
        if cookie:
            self.session.headers["Cookie"] = cookie

    def validate_config(self) -> bool:
        return True  # 无需登录即可获取评论

    def test_connection(self) -> Dict:
        """测试 TapTap 连接"""
        try:
            resp = self.session.get(
                f"{self.API_BASE}/app/v6/detail",
                params={"id": "1", "platform": "android"},
                timeout=10,
            )
            if resp.status_code == 200:
                return {
                    "success": True,
                    "message": "TapTap API 连接正常（游客模式）",
                    "user": None,
                }
            return {
                "success": False,
                "message": f"连接失败: HTTP {resp.status_code}",
            }
        except Exception as e:
            return {"success": False, "message": f"网络错误: {str(e)}"}

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或 ID 中提取 app_id"""
        url_or_id = url_or_id.strip()

        # 匹配 taptap.cn/app/{id} 格式
        m = re.search(r'taptap\.(?:cn|io)/app/(\d+)', url_or_id)
        if m:
            return m.group(1)

        # 匹配纯数字（至少 4 位）
        m = re.search(r'(\d{4,})', url_or_id)
        if m:
            return m.group(1)

        return url_or_id

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取游戏信息"""
        app_id = self.extract_post_id(post_id)

        try:
            resp = self.session.get(
                f"{self.API_BASE}/app/v6/detail",
                params={"id": app_id, "platform": "android"},
                timeout=10,
            )
            data = resp.json()
            app = data.get("data", {}).get("app") or data.get("data", {})

            if not app or not app.get("id"):
                print(f"[TapTap] 获取游戏信息失败: 未找到游戏")
                return None

            stat = app.get("stat", {}) or {}
            rating = stat.get("rating", {}) or {}
            dev = app.get("developer") or {}

            desc = app.get("description", "")
            if isinstance(desc, dict):
                desc = desc.get("text", "")
            return {
                "id": str(app.get("id", "")),
                "title": app.get("title", ""),
                "content": desc if isinstance(desc, str) else str(desc),
                "author_id": str(dev.get("id", "")),
                "author_name": dev.get("name", ""),
                "author_username": "",
                "author_avatar": (app.get("icon") or {}).get("url", ""),
                "created_at": "",
                "like_count": stat.get("fans_count", 0),
                "comment_count": stat.get("review_count", 0),
                "share_count": 0,
                "view_count": stat.get("hits_total", 0),
                "platform": self.platform_name,
                "url": f"{self.BASE_URL}/app/{app_id}",
                "rating": rating.get("score", ""),
            }

        except Exception as e:
            print(f"[TapTap] 获取游戏信息异常: {e}")
            return None

    def search_posts(self, keyword: str, max_posts: int = 10) -> List[Dict]:
        """按关键词搜索游戏"""
        keyword = keyword.strip()
        posts = []

        try:
            resp = self.session.get(
                f"{self.API_BASE}/search/v4/has-param",
                params={
                    "kw": keyword,
                    "type": "app",
                    "page_size": min(max_posts, 20),
                    "from_page": "search",
                },
                timeout=10,
            )
            data = resp.json()

            items = []
            if data.get("data"):
                if isinstance(data["data"], list):
                    items = data["data"]
                elif isinstance(data["data"], dict):
                    items = data["data"].get("list", []) or []

            for item in items[:max_posts]:
                app = item.get("app", item)
                stat = app.get("stat", {}) or {}
                posts.append({
                    "id": str(app.get("id", "")),
                    "title": app.get("title", ""),
                    "content": "",
                    "author_id": "",
                    "author_name": (app.get("developer") or {}).get("name", ""),
                    "author_username": "",
                    "author_avatar": (app.get("icon") or {}).get("url", ""),
                    "created_at": "",
                    "like_count": stat.get("fans_count", 0),
                    "comment_count": stat.get("review_count", 0),
                    "share_count": 0,
                    "view_count": stat.get("hits_total", 0),
                    "platform": self.platform_name,
                    "url": f"{self.BASE_URL}/app/{app.get('id', '')}",
                })

        except Exception as e:
            print(f"[TapTap] 搜索「{keyword}」异常: {e}")

        print(f"[TapTap] 搜索「{keyword}」，找到 {len(posts)} 个游戏")
        return posts

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """
        拉取游戏评价（评论）

        TapTap 评价结构（moment -> review）：
        - moment.review.id / score / contents.text / stage_label
        - moment.author.user.name / avatar
        - moment.device / created_time / stat.ups
        """
        app_id = self.extract_post_id(post_id)
        all_comments = []
        offset = 0
        page_size = 10  # TapTap API 限制单页最大 10 条

        if max_comments is None:
            max_comments = 100

        print(f"[TapTap] 开始拉取游戏 {app_id} 的评价...")

        while True:
            try:
                resp = self.session.get(
                    f"{self.API_BASE}/review/v2/list-by-app",
                    params={
                        "app_id": app_id,
                        "sort": "new",
                        "limit": page_size,
                        "from": offset,
                        "stage_type": "2",
                    },
                    timeout=10,
                )
                data = resp.json()
                page_data = data.get("data") or {}
                items = page_data.get("list") or []
                next_page = page_data.get("next_page", "")
                total = page_data.get("total", 0)

                if not items:
                    print(f"[TapTap] from={offset} 无更多评价")
                    break

                for item in items:
                    moment = item.get("moment", item)
                    review = moment.get("review") or {}
                    if not review.get("id"):
                        continue  # 跳过非评价内容
                    user = (moment.get("author") or {}).get("user") or {}
                    stat = moment.get("stat") or {}

                    comment = {
                        "id": str(review.get("id", moment.get("id_str", ""))),
                        "post_id": app_id,
                        "platform": self.platform_name,
                        "author_id": str(user.get("id", "")),
                        "author_username": user.get("name", ""),
                        "author_name": user.get("name", ""),
                        "author_avatar": user.get("avatar", ""),
                        "text": (review.get("contents") or {}).get("text", ""),
                        "rating": review.get("score", 0),
                        "created_at": datetime.fromtimestamp(moment["created_time"]).isoformat() if moment.get("created_time") else "",
                        "like_count": stat.get("ups", 0),
                        "reply_count": stat.get("comments", 0) or stat.get("comment_count", 0),
                        "ip_location": moment.get("device", ""),
                        "platform_data": {
                            "review_id": review.get("id"),
                            "rating": review.get("score", 0),
                            "stage": review.get("stage_label", ""),
                            "ratings": review.get("ratings", []),
                            "is_spoil": review.get("is_spoil", False),
                        },
                    }
                    all_comments.append(comment)

                    if max_comments and len(all_comments) >= max_comments:
                        break

                review_count = sum(1 for i in items if (i.get("moment", {}).get("review", {}).get("id")))
                print(f"[TapTap] from={offset} 获取 {len(items)} 条（评价 {review_count}），累计 {len(all_comments)}/{total}")

                if max_comments and len(all_comments) >= max_comments:
                    print(f"[TapTap] 已达到最大数量限制 {max_comments}")
                    break

                # 用 next_page 判断是否还有下一页
                if not next_page:
                    print(f"[TapTap] 已拉取全部评价，共 {len(all_comments)} 条")
                    break

                offset += len(items)
                time.sleep(0.5)

            except Exception as e:
                print(f"[TapTap] 拉取评价异常: {e}")
                break

        print(f"[TapTap] 共获取 {len(all_comments)} 条评价")
        return all_comments
