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

        # 先访问一次 TapTap，自动获取反爬虫 Cookie（acw_tc 等）
        try:
            self.session.get(f"{self.BASE_URL}/", timeout=5)
        except Exception:
            pass

        if cookie:
            # 只保留 TapTap 相关的 Cookie 名
            TAPTAP_COOKIE_KEYS = {
                "TAPTAP_SESSION", "XSRF-TOKEN", "user_id", "acw_tc",
                "web_app_uuid", "web_app_next_redesign_gray_feature",
                "currentDataSource", "ACCOUNTS_USER_ID", "gid",
                "acw_sc_v2", "_ga", "_ga_",
            }
            for item in cookie.split(";"):
                item = item.strip()
                if "=" in item:
                    key, val = item.split("=", 1)
                    key = key.strip()
                    # 自动跳过百度/头条/微软等第三方 Cookie
                    if key in TAPTAP_COOKIE_KEYS or key.startswith("_ga"):
                        self.session.cookies.set(key, val.strip(), domain=".taptap.cn")

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
                            "moment_id": moment.get("id_str", ""),
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

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        """
        回复评价（需要登录 Cookie）

        使用 TapTap 的 review-comment API。

        Args:
            comment_id: 评价 ID（review_id）
            reply_text: 回复内容
            post_id: 游戏的 app_id（可选）

        Returns:
            {"success": bool, "message": str}
        """
        if not self.cookie:
            return {
                "success": False,
                "error": "未配置 Cookie",
                "message": "请先在侧边栏「🎮 TapTap 配置」中填入登录 Cookie，然后点击「💾 保存到本地」"
            }

        # TapTap 常见错误码 → 用户友好提示
        ERROR_TIPS = {
            "网页已过期": (
                "Cookie 会话已过期。请重新登录 taptap.cn，"
                "获取新的 Cookie 后再试。\n"
                "操作：浏览器打开 taptap.cn → 登录 → F12 → Application → Cookies → 全选复制"
            ),
            "请先登录": (
                "Cookie 无效或未登录。请确认复制的是登录后的完整 Cookie 字符串。"
            ),
            "验证": (
                "触发了 TapTap 验证码。请在浏览器中手动完成验证后，重新获取 Cookie。"
            ),
            "频繁": (
                "操作太频繁，请等待 1-2 分钟后再试。"
            ),
            "csrf": (
                "CSRF 校验失败。Cookie 中可能缺少 csrfToken 字段，请重新获取完整 Cookie。"
            ),
        }

        try:
            # 从 Cookie 中提取 XSRF-TOKEN，作为请求头发送（TapTap CSRF 校验要求）
            xsrf_token = ""
            for c in self.session.cookies:
                if c.name == "XSRF-TOKEN":
                    xsrf_token = c.value
                    break

            headers = {
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{self.BASE_URL}/app/{post_id}/review" if post_id else self.BASE_URL,
            }
            if xsrf_token:
                headers["X-XSRF-TOKEN"] = xsrf_token
                headers["X-CSRF-TOKEN"] = xsrf_token

            resp = self.session.post(
                f"{self.API_BASE}/review-comment/v1/create",
                data={
                    "review_id": comment_id,
                    "contents": reply_text,
                },
                headers=headers,
                timeout=15,
            )

            ct = resp.headers.get("Content-Type", "")
            body = resp.text.strip()

            if "json" in ct:
                result = resp.json()
                data = result.get("data") or {}

                if result.get("success") and not data.get("error"):
                    print(f"[TapTap] 回复成功: review_id={comment_id}")
                    return {"success": True, "message": "回复成功"}

                raw_err = data.get("msg", result.get("msg", ""))
                print(f"[TapTap] 回复失败: {raw_err}")

                # 匹配已知错误，给出友好提示
                for keyword, tip in ERROR_TIPS.items():
                    if keyword in raw_err:
                        return {"success": False, "error": raw_err, "message": tip}

                return {"success": False, "error": raw_err, "message": f"TapTap 返回: {raw_err}"}

            # 非 JSON 响应
            print(f"[TapTap] review-comment/create → {resp.status_code} {ct[:50]}")
            return {
                "success": False,
                "error": f"服务器返回 {resp.status_code} ({ct[:30]})",
                "message": "Cookie 可能无效。请重新登录 taptap.cn 获取新的 Cookie。"
            }

        except Exception as e:
            print(f"[TapTap] 回复异常: {e}")
            return {
                "success": False,
                "error": str(e),
                "message": "网络请求失败，请检查网络后重试"
            }
