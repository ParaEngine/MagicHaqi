"""
百度贴吧 (Baidu Tieba) 评论收集器
使用贴吧移动端页面拉取帖子楼层回复，公开帖子无需登录
"""

import re
import time
import html as html_mod
import requests
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector


class TiebaCollector(BaseCollector):
    """百度贴吧评论收集器"""

    platform_name = "tieba"
    platform_display_name = "百度贴吧"
    platform_description = "使用贴吧移动端页面拉取帖子楼层回复，公开帖子无需登录"

    BASE_URL = "https://tieba.baidu.com"
    MOBILE_URL = "https://tieba.baidu.com/mo/q/hybrid"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://tieba.baidu.com/",
    }

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        if cookie:
            self.session.headers["Cookie"] = cookie

    def validate_config(self) -> bool:
        return True  # 公开帖子无需登录

    def test_connection(self) -> Dict:
        try:
            r = self.session.get(f"{self.MOBILE_URL}?cmd=msg", timeout=10)
            if r.status_code == 200:
                return {"success": True, "message": "贴吧连接正常（游客模式）", "user": None}
            return {"success": False, "message": f"连接失败: HTTP {r.status_code}"}
        except Exception as e:
            return {"success": False, "message": f"网络错误: {str(e)}"}

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        url_or_id = url_or_id.strip()
        # 匹配贴吧帖子 URL: tieba.baidu.com/p/{tid}
        m = re.search(r'tieba\.baidu\.com/p/(\d+)', url_or_id)
        if m:
            return m.group(1)
        # 纯数字
        m = re.search(r'(\d{5,})', url_or_id)
        if m:
            return m.group(1)
        return url_or_id

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        tid = self.extract_post_id(post_id)
        try:
            r = self.session.get(
                f"{self.MOBILE_URL}",
                params={"cmd": "pb", "pn": 1, "tid": tid},
                timeout=10,
            )
            html_text = r.text

            title_m = re.search(r'<div class="post_title_embed">(.*?)</div>', html_text, re.DOTALL)
            title = html_mod.unescape(title_m.group(1).strip()) if title_m else ""

            author_m = re.search(r'data-field=\'[^\']*"author":"([^"]+)"', html_text)
            author = author_m.group(1) if author_m else ""

            total_page = 1
            tp_m = re.search(r'"total_page":(\d+)', html_text)
            if tp_m:
                total_page = int(tp_m.group(1))

            return {
                "id": tid,
                "title": title,
                "content": title,
                "author_id": "",
                "author_name": author,
                "author_username": author,
                "author_avatar": "",
                "created_at": "",
                "like_count": 0,
                "comment_count": total_page * 10,
                "share_count": 0,
                "view_count": 0,
                "platform": self.platform_name,
                "url": f"{self.BASE_URL}/p/{tid}",
            }
        except Exception as e:
            print(f"[贴吧] 获取帖子信息异常: {e}")
            return None

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        tid = self.extract_post_id(post_id)
        all_comments = []
        page = 1

        if max_comments is None:
            max_comments = 100

        print(f"[贴吧] 开始拉取帖子 {tid} 的回复...")

        while True:
            try:
                r = self.session.get(
                    f"{self.MOBILE_URL}",
                    params={"cmd": "pb", "pn": page, "tid": tid},
                    timeout=10,
                )
                html_text = r.text

                # 提取楼层
                floors = re.findall(
                    r'<li\s+tid="(\d+)"[^>]*data-info="([^"]*)"[^>]*>(.*?)(?=<li\s+tid="|</ul>)',
                    html_text,
                    re.DOTALL,
                )

                if not floors:
                    print(f"[贴吧] 第 {page} 页无回复")
                    break

                for floor in floors:
                    floor_id, data_info, body = floor

                    # 解析用户信息
                    try:
                        info = json.loads(html_mod.unescape(data_info))
                        author = info.get("author", {}).get("name_show", "")
                        author_id = info.get("author", {}).get("id", "")
                    except Exception:
                        author = ""
                        author_id = ""

                    # 提取内容
                    content_m = re.search(r'<div class="content"[^>]*>(.*?)</div>', body, re.DOTALL)
                    content = html_mod.unescape(re.sub(r'<[^>]+>', '', content_m.group(1).strip())) if content_m else ""

                    # 提取时间
                    time_m = re.search(r'<span class="list_item_time">(.*?)</span>', body, re.DOTALL)
                    created = time_m.group(1).strip() if time_m else ""

                    # 头像
                    avatar_m = re.search(r'<div class="list_item_top_avatar">.*?<img[^>]*src="([^"]+)"', body, re.DOTALL)
                    avatar = avatar_m.group(1) if avatar_m else ""

                    # 回复数
                    reply_m = re.search(r'btn_reply["\']?>\s*<span class="btn_icon">(\d+)</span>', body)
                    reply_count = int(reply_m.group(1)) if reply_m else 0

                    comment = {
                        "id": floor_id,
                        "post_id": tid,
                        "platform": self.platform_name,
                        "author_id": author_id,
                        "author_username": author,
                        "author_name": author,
                        "author_avatar": avatar,
                        "text": content[:2000],
                        "created_at": created,
                        "like_count": 0,
                        "reply_count": reply_count,
                        "ip_location": "",
                        "platform_data": {"floor_id": floor_id},
                    }
                    all_comments.append(comment)

                    if max_comments and len(all_comments) >= max_comments:
                        break

                print(f"[贴吧] 第 {page} 页获取 {len(floors)} 条，累计 {len(all_comments)} 条")

                if max_comments and len(all_comments) >= max_comments:
                    break

                if len(floors) < 10:
                    break

                page += 1
                time.sleep(0.5)

            except Exception as e:
                print(f"[贴吧] 拉取回复异常: {e}")
                break

        print(f"[贴吧] 共获取 {len(all_comments)} 条回复")
        return all_comments

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        """
        回复帖子楼层（需要登录 Cookie）

        Args:
            comment_id: 楼层 ID（floor_id）
            reply_text: 回复内容
            post_id: 帖子 tid

        Returns:
            {"success": bool, "message": str}
        """
        if not self.cookie:
            return {
                "success": False,
                "error": "贴吧回复需要登录 Cookie",
                "message": "请在侧边栏配置贴吧 Cookie（需包含 BDUSS）"
            }

        tid = post_id or ""
        try:
            resp = self.session.post(
                f"{self.MOBILE_URL}",
                params={"cmd": "reply"},
                data={
                    "tid": tid,
                    "content": reply_text,
                    "floor_id": comment_id,
                    "vcode": "",
                    "vcode_md5": "",
                },
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://tieba.baidu.com/p/{tid}",
                },
                timeout=15,
            )
            result = resp.json() if resp.text.strip().startswith("{") else {}

            if result.get("no") == 0 or result.get("err_code") == "0":
                print(f"[贴吧] 回复成功: floor_id={comment_id}")
                return {"success": True, "message": "回复成功"}

            err = result.get("error", result.get("errmsg", str(resp.text[:100])))
            print(f"[贴吧] 回复失败: {err}")

            # 常见错误
            if "验证码" in err or "vcode" in err.lower():
                return {"success": False, "error": err, "message": "触发了贴吧验证码，请在浏览器中手动回复一次后重试"}
            if "登录" in err or "BDUSS" in err:
                return {"success": False, "error": err, "message": "Cookie 无效或已过期，请重新获取（需包含 BDUSS）"}

            return {"success": False, "error": err}

        except Exception as e:
            print(f"[贴吧] 回复异常: {e}")
            return {"success": False, "error": str(e)}
