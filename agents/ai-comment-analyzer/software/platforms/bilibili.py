"""
Bilibili (B站) 评论收集器
使用 B 站公开 API 拉取视频评论，需要 SESSDATA Cookie
"""

import re
import time
import requests
from hashlib import md5
from urllib.parse import urlencode
from typing import List, Dict, Optional
from datetime import datetime

from .base import BaseCollector

# WBI 签名混淆密钥索引表（B 站搜索 API 需要签名，不签名会被风控拦截）
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]


class BilibiliCollector(BaseCollector):
    """B站评论收集器"""

    platform_name = "bilibili"
    platform_display_name = "哔哩哔哩 (B站)"
    platform_description = "使用 B 站 API 拉取视频评论，需要 Cookie（SESSDATA）"

    BASE_URL = "https://api.bilibili.com"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com",
        "Origin": "https://www.bilibili.com",
    }

    def __init__(self, sessdata: str = "", bili_jct: str = "", **kwargs):
        super().__init__(**kwargs)
        self.sessdata = sessdata
        self.bili_jct = bili_jct
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        if sessdata:
            self.session.cookies.set("SESSDATA", sessdata, domain=".bilibili.com")
        if bili_jct:
            self.session.cookies.set("bili_jct", bili_jct, domain=".bilibili.com")

    def validate_config(self) -> bool:
        return True  # 未登录也能获取部分评论

    def test_connection(self) -> Dict:
        """
        测试B站连接，获取当前登录用户信息

        Returns:
            {"success": bool, "message": str, "user": dict}
        """
        try:
            # 尝试获取登录用户信息（需要 SESSDATA）
            resp = self.session.get(
                f"{self.BASE_URL}/x/web-interface/nav",
                timeout=10
            )
            result = resp.json()

            if result.get("code") == 0:
                data = result.get("data", {})
                is_login = data.get("isLogin", False)
                uname = data.get("uname", "")

                if is_login:
                    return {
                        "success": True,
                        "message": f"已登录，用户: {uname}",
                        "user": {"name": uname, "mid": data.get("mid", "")}
                    }
                else:
                    return {
                        "success": True,
                        "message": "未登录（游客模式），只能获取公开评论",
                        "user": None
                    }
            else:
                return {
                    "success": False,
                    "message": f"连接失败: {result.get('msg', '未知错误')}",
                    "code": result.get("code")
                }
        except Exception as e:
            return {
                "success": False,
                "message": f"网络错误: {str(e)}"
            }

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        """从 URL 或 ID 中提取视频 BV 号或 aid"""
        url_or_id = url_or_id.strip()
        # 匹配 BV 号
        bv_match = re.search(r'BV[a-zA-Z0-9]+', url_or_id)
        if bv_match:
            return bv_match.group(0)
        # 匹配 av 号
        av_match = re.search(r'av(\d+)', url_or_id, re.IGNORECASE)
        if av_match:
            return f"av{av_match.group(1)}"
        # 纯数字作为 aid
        if url_or_id.isdigit():
            return f"av{url_or_id}"
        return url_or_id

    def _bv_to_aid(self, bvid: str) -> Optional[int]:
        """BV 号转 aid"""
        try:
            resp = self.session.get(
                f"{self.BASE_URL}/x/web-interface/view",
                params={"bvid": bvid},
                timeout=10
            )
            data = resp.json()
            if data.get("code") == 0:
                return data["data"]["aid"]
        except Exception as e:
            print(f"[B站] BV 转 AV 失败: {e}")
        return None

    def _get_wbi_keys(self) -> Optional[tuple]:
        """获取当前 img_key/sub_key（未登录也可获取）"""
        try:
            resp = self.session.get(f"{self.BASE_URL}/x/web-interface/nav", timeout=10)
            wbi_img = resp.json().get("data", {}).get("wbi_img", {})
            img_key = wbi_img["img_url"].rsplit("/", 1)[1].split(".")[0]
            sub_key = wbi_img["sub_url"].rsplit("/", 1)[1].split(".")[0]
            return img_key, sub_key
        except Exception as e:
            print(f"[B站] 获取 WBI 密钥失败: {e}")
            return None

    def _sign_wbi_params(self, params: Dict) -> Optional[Dict]:
        """对请求参数进行 WBI 签名（B 站搜索接口必需）"""
        keys = self._get_wbi_keys()
        if not keys:
            return None
        img_key, sub_key = keys
        mixin_key = "".join(
            (img_key + sub_key)[i] for i in MIXIN_KEY_ENC_TAB
        )[:32]

        signed = dict(params)
        signed["wts"] = round(time.time())
        signed = dict(sorted(signed.items()))
        signed = {k: "".join(c for c in str(v) if c not in "!'()*") for k, v in signed.items()}
        query = urlencode(signed)
        signed["w_rid"] = md5((query + mixin_key).encode()).hexdigest()
        return signed

    @staticmethod
    def _strip_tags(text: str) -> str:
        return re.sub(r'<[^>]+>', '', text or '')

    def search_posts(self, keyword: str, max_posts: int = 10) -> List[Dict]:
        """按关键词搜索相关视频（使用 WBI 签名接口，未登录也可使用）"""
        keyword = keyword.strip()
        posts = []
        try:
            signed_params = self._sign_wbi_params({
                "search_type": "video",
                "keyword": keyword,
            })
            if not signed_params:
                print(f"[B站] 无法获取 WBI 签名，搜索终止")
                return posts

            resp = self.session.get(
                f"{self.BASE_URL}/x/web-interface/wbi/search/type",
                params=signed_params,
                timeout=10
            )
            data = resp.json()

            if data.get("code") != 0:
                print(f"[B站] 搜索失败: {data.get('message')}")
                return posts

            results = data.get("data", {}).get("result", []) or []
            for item in results[:max_posts]:
                if item.get("type") != "video":
                    continue
                bvid = item.get("bvid", "")
                posts.append({
                    "id": bvid,
                    "title": self._strip_tags(item.get("title", "")),
                    "content": self._strip_tags(item.get("description", "")),
                    "author_id": str(item.get("mid", "")),
                    "author_name": item.get("author", ""),
                    "author_username": item.get("author", ""),
                    "author_avatar": item.get("upic", ""),
                    "created_at": datetime.fromtimestamp(item["pubdate"]).isoformat() if item.get("pubdate") else None,
                    "like_count": item.get("like", 0),
                    "comment_count": item.get("review", 0),
                    "share_count": 0,
                    "view_count": item.get("play", 0),
                    "platform": self.platform_name,
                    "url": f"https://www.bilibili.com/video/{bvid}",
                })

        except Exception as e:
            print(f"[B站] 搜索「{keyword}」异常: {e}")

        print(f"[B站] 搜索「{keyword}」，找到 {len(posts)} 个视频")
        return posts

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        """获取视频信息"""
        vid = self.extract_post_id(post_id)

        try:
            params = {}
            if vid.startswith("BV"):
                params["bvid"] = vid
            elif vid.startswith("av"):
                params["aid"] = vid[2:]
            else:
                params["bvid"] = vid

            resp = self.session.get(
                f"{self.BASE_URL}/x/web-interface/view",
                params=params,
                timeout=10
            )
            data = resp.json()

            if data.get("code") != 0:
                print(f"[B站] 获取视频信息失败: {data.get('message')}")
                return None

            video = data["data"]
            stat = video.get("stat", {})

            return {
                "id": video.get("bvid", ""),
                "title": video.get("title", ""),
                "content": video.get("desc", ""),
                "author_id": str(video.get("owner", {}).get("mid", "")),
                "author_name": video.get("owner", {}).get("name", ""),
                "author_username": video.get("owner", {}).get("name", ""),
                "author_avatar": video.get("owner", {}).get("face", ""),
                "created_at": datetime.fromtimestamp(video.get("pubdate", 0)).isoformat() if video.get("pubdate") else None,
                "like_count": stat.get("like", 0),
                "comment_count": stat.get("reply", 0),
                "share_count": stat.get("share", 0),
                "view_count": stat.get("view", 0),
                "platform": self.platform_name,
                "url": f"https://www.bilibili.com/video/{video.get('bvid', '')}",
            }

        except Exception as e:
            print(f"[B站] 获取视频信息异常: {e}")
            return None

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        """拉取视频评论"""
        vid = self.extract_post_id(post_id)
        all_comments = []
        page = 1
        ps = 20

        # 获取 aid
        aid = None
        if vid.startswith("BV"):
            aid = self._bv_to_aid(vid)
        elif vid.startswith("av"):
            aid = int(vid[2:])

        if not aid:
            print("[B站] 无法获取视频 AID")
            return []

        print(f"[B站] 开始拉取视频 {vid} (aid={aid}) 的评论...")

        while True:
            try:
                resp = self.session.get(
                    f"{self.BASE_URL}/x/v2/reply",
                    params={
                        "type": 1,  # 视频评论
                        "oid": aid,
                        "pn": page,
                        "ps": ps,
                        "sort": 1,  # 1=按时间 2=按热度
                    },
                    timeout=10
                )
                data = resp.json()

                if data.get("code") != 0:
                    print(f"[B站] 拉取评论失败: {data.get('message')}")
                    break

                replies = data.get("data", {}).get("replies", [])
                if not replies:
                    print(f"[B站] 第 {page} 页无更多评论")
                    break

                for reply in replies:
                    content = reply.get("content", {})
                    member = reply.get("member", {})

                    comment = {
                        "id": str(reply.get("rpid", "")),
                        "post_id": vid,
                        "platform": self.platform_name,
                        "author_id": str(member.get("mid", "")),
                        "author_username": member.get("uname", ""),
                        "author_name": member.get("uname", ""),
                        "author_avatar": member.get("avatar", ""),
                        "text": content.get("message", ""),
                        "created_at": datetime.fromtimestamp(reply.get("ctime", 0)).isoformat() if reply.get("ctime") else None,
                        "like_count": reply.get("like", 0),
                        "reply_count": reply.get("rcount", 0),
                        "ip_location": content.get("reply_control", {}).get("location", ""),
                        "platform_data": {
                            "rpid": reply.get("rpid"),
                            "root": reply.get("root"),
                            "parent": reply.get("parent"),
                            "level": member.get("level_info", {}).get("current_level"),
                            "vip": member.get("vip", {}).get("vipType", 0),
                        }
                    }
                    all_comments.append(comment)

                    if max_comments and len(all_comments) >= max_comments:
                        break

                print(f"[B站] 第 {page} 页获取 {len(replies)} 条，累计 {len(all_comments)} 条")

                if max_comments and len(all_comments) >= max_comments:
                    print(f"[B站] 已达到最大数量限制 {max_comments}")
                    break

                # 检查是否有下一页
                page_info = data.get("data", {}).get("page", {})
                if page >= page_info.get("count", 0) // ps + 1:
                    print("[B站] 已拉取全部评论")
                    break

                page += 1
                time.sleep(0.5)  # 请求间隔，避免限流

            except Exception as e:
                print(f"[B站] 拉取评论异常: {e}")
                break

        print(f"[B站] 共获取 {len(all_comments)} 条评论")
        return all_comments

    def reply_comment(self, comment_rpid: str, reply_text: str, aid: str = None, bvid: str = None) -> Dict:
        """
        回复评论（B站需要登录）

        Args:
            comment_rpid: 被回复的评论 ID
            reply_text: 回复内容
            aid: 视频的 aid（可选）
            bvid: 视频的 BV号（可选，提供aid时优先）

        Returns:
            {"success": bool, "message": str, "rpid": str}
        """
        if not self.sessdata or not self.bili_jct:
            return {
                "success": False,
                "error": "B站回复需要 SESSDATA 和 bili_jct Cookie",
                "message": "请在侧边栏配置 Cookie"
            }

        # 获取视频 aid
        if not aid:
            if bvid:
                aid = self._bv_to_aid(bvid)
                if not aid:
                    return {"success": False, "error": "无法获取视频 aid"}

        if not aid:
            return {
                "success": False,
                "error": "需要提供视频 aid 或 bvid"
            }

        # 获取 CSRF Token
        csrf = self.bili_jct

        # 构造请求数据
        # oid = 视频的 aid
        # root = 楼层主评论的 rpid
        # parent = 被回复的评论 rpid
        data = {
            "oid": str(aid),       # 视频 aid
            "type": 1,             # 类型 1 = 视频评论
            "message": reply_text,
            "plat": 1,             # 1 = web
            "root": comment_rpid,  # 楼层主评论 rpid
            "parent": comment_rpid,  # 被回复评论 rpid
            "csrf": csrf,
            "csrf_token": csrf,
        }

        try:
            # 添加 headers
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": f"https://www.bilibili.com/video/{bvid}" if bvid else "https://www.bilibili.com/",
                "Origin": "https://www.bilibili.com"
            }

            resp = self.session.post(
                f"{self.BASE_URL}/x/v2/reply/add",
                data=data,
                headers=headers,
                timeout=15
            )
            result = resp.json()

            if result.get("code") == 0:
                # 成功，获取新回复的 rpid
                data_result = result.get("data", {})
                new_rpid = str(data_result.get("rpid", ""))
                print(f"[B站] 回复成功，新评论 rpid: {new_rpid}")
                return {
                    "success": True,
                    "message": "回复成功",
                    "rpid": new_rpid,
                    "data": result.get("data", {})
                }
            else:
                error_msg = result.get("msg", result.get("message", "未知错误"))
                print(f"[B站] 回复失败: code={result.get('code')}, msg={error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "code": result.get("code"),
                    "raw": result
                }

        except Exception as e:
            print(f"[B站] 回复异常: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def reply_to_post(self, oid: str, reply_text: str) -> Dict:
        """
        回复视频（直接评论，不是回复某条评论）

        Args:
            oid: 视频的 aid
            reply_text: 评论内容

        Returns:
            {"success": bool, "message": str}
        """
        if not self.sessdata or not self.bili_jct:
            return {
                "success": False,
                "error": "B站评论需要 SESSDATA 和 bili_jct Cookie"
            }

        csrf = self.bili_jct

        data = {
            "oid": oid,
            "type": 1,
            "message": reply_text,
            "plat": 1,
            "csrf": csrf,
            "csrf_token": csrf,
        }

        try:
            resp = self.session.post(
                f"{self.BASE_URL}/x/v2/reply/add",
                data=data,
                timeout=10
            )
            result = resp.json()

            if result.get("code") == 0:
                return {
                    "success": True,
                    "message": "评论成功",
                    "rpid": str(result.get("data", {}).get("rpid", ""))
                }
            else:
                return {
                    "success": False,
                    "error": result.get("msg", "未知错误")
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
