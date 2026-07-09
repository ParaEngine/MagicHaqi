"""
小红书 (Xiaohongshu) 评论收集器
使用 Playwright 浏览器渲染页面后从 DOM 提取评论，绕过 API x-s/x-t 签名限制
"""

import re
import time
from typing import List, Dict, Optional

from .base import BaseCollector


class XiaohongshuCollector(BaseCollector):
    """小红书评论收集器（Playwright DOM 抓取）"""

    platform_name = "xiaohongshu"
    platform_display_name = "小红书"
    platform_description = "使用浏览器渲染页面后从 DOM 提取评论，无需 API 签名"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie.strip().strip("'").strip('"') if cookie else ""
        self._browser = None
        self._playwright = None

    def validate_config(self) -> bool:
        return True  # 公开笔记无需登录

    def _get_browser(self):
        """延迟加载 Playwright 浏览器"""
        if self._browser is None:
            from playwright.sync_api import sync_playwright
            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(headless=True)
        return self._browser

    def _new_page(self):
        """创建带 Cookie 的新页面"""
        browser = self._get_browser()
        page = browser.new_page()
        if self.cookie:
            cookies = []
            for item in self.cookie.split(";"):
                item = item.strip()
                if "=" in item:
                    k, v = item.split("=", 1)
                    cookies.append({"name": k.strip(), "value": v.strip(),
                                   "domain": ".xiaohongshu.com", "path": "/"})
            if cookies:
                page.context.add_cookies(cookies)
        return page

    def test_connection(self) -> Dict:
        try:
            self._get_browser()
            return {"success": True, "message": "Playwright 浏览器就绪", "user": None}
        except ImportError:
            return {"success": False, "message": "请安装: pip install playwright && playwright install chromium"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        url_or_id = url_or_id.strip()
        m = re.search(r'/explore/([a-zA-Z0-9]+)', url_or_id)
        if m:
            return m.group(1)
        m = re.search(r'/discovery/item/([a-zA-Z0-9]+)', url_or_id)
        if m:
            return m.group(1)
        return url_or_id

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        note_id = self.extract_post_id(post_id)
        url = f"https://www.xiaohongshu.com/explore/{note_id}"
        try:
            page = self._new_page()
            page.goto(url, timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            title = page.title() or ""
            desc = author = ""
            likes = comments_count = 0
            try:
                title = page.locator('[class*="title"]').first.inner_text() or title
            except Exception:
                pass
            try:
                desc = page.locator('[class*="desc"]').first.inner_text()
            except Exception:
                pass
            try:
                author = page.locator('[class*="username"], [class*="nickname"]').first.inner_text()
            except Exception:
                pass
            try:
                t = page.locator('[class*="like"] span').first.inner_text()
                likes = int(re.sub(r'[^0-9]', '', t)) if t else 0
            except Exception:
                pass
            try:
                t = page.locator('[class*="comment"] span').first.inner_text()
                comments_count = int(re.sub(r'[^0-9]', '', t)) if t else 0
            except Exception:
                pass
            page.close()
            return {
                "id": note_id, "title": title, "content": desc,
                "author_name": author, "author_username": author,
                "like_count": likes, "comment_count": comments_count,
                "share_count": 0, "url": url, "platform": self.platform_name,
            }
        except Exception as e:
            print(f"[小红书] 获取笔记信息异常: {e}")
            return {"id": note_id, "title": "", "content": "", "url": url, "platform": self.platform_name}

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        note_id = self.extract_post_id(post_id)
        url = f"https://www.xiaohongshu.com/explore/{note_id}"
        if max_comments is None:
            max_comments = 100
        print(f"[小红书] 浏览器打开 {url} ...")
        try:
            page = self._new_page()
            page.goto(url, timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            last_count = 0
            for _ in range(20):
                comments = page.evaluate("""
                    () => {
                        const items = document.querySelectorAll(
                            '.comment-item, .parent-comment, [class*="comment-item"], [class*="CommentItem"]'
                        );
                        return Array.from(items).map(el => {
                            const userName = el.querySelector(
                                '.user-name, .nickname, .username, [class*="nickname"], a[href*="/user/"]'
                            )?.textContent?.trim() || '小红书用户';
                            const avatar = el.querySelector('img[class*="avatar"], img')?.src || '';
                            let content = el.querySelector(
                                '.content, .comment-content, .note-text, [class*="content"] span'
                            )?.textContent?.trim() || '';
                            if (!content) {
                                const spans = el.querySelectorAll('span');
                                content = Array.from(spans).map(s => s.textContent.trim()).join(' ').substring(0, 300);
                            }
                            const likeText = el.querySelector('[class*="like"] span, [class*="count"]')?.textContent || '0';
                            const likeCount = parseInt(likeText.replace(/[^0-9]/g, '')) || 0;
                            const id = el.getAttribute('data-comment-id') || el.id || '';
                            if (!content || content.length < 2) return null;
                            return { id, userName, avatar, content, likeCount };
                        }).filter(Boolean);
                    }
                """)
                if len(comments) == last_count and len(comments) > 0:
                    break
                last_count = len(comments)
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(2)
                try:
                    page.locator('text=加载更多').first.click(timeout=2000)
                    time.sleep(2)
                except Exception:
                    pass
            page.close()
            result = []
            for i, c in enumerate(comments[:max_comments]):
                result.append({
                    "id": c["id"] or f"xhs-{note_id}-{i}",
                    "post_id": note_id, "platform": self.platform_name,
                    "author_username": c["userName"], "author_name": c["userName"],
                    "author_avatar": c["avatar"], "text": c["content"],
                    "like_count": c["likeCount"], "reply_count": 0,
                    "created_at": "", "ip_location": "", "platform_data": {},
                })
            print(f"[小红书] 共提取 {len(result)} 条评论")
            return result
        except Exception as e:
            print(f"[小红书] Playwright 抓取异常: {e}")
            return []

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        """回复评论（Playwright，需 Cookie）"""
        if not self.cookie:
            return {"success": False, "error": "需要登录 Cookie",
                    "message": "请在侧边栏配置小红书 Cookie（从 Network 复制完整 Cookie 字符串）"}
        note_id = self.extract_post_id(post_id) if post_id else ""
        try:
            page = self._new_page()
            page.goto(f"https://www.xiaohongshu.com/explore/{note_id}",
                      timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            reply_box = page.locator('[contenteditable="true"], textarea, input[type="text"]').first
            if not reply_box:
                page.close()
                return {"success": False, "error": "未找到回复输入框"}
            reply_box.fill(reply_text)
            time.sleep(0.5)
            send_btn = page.locator('button:has-text("发送"), button:has-text("发布"), [class*="send"], [class*="submit"]').first
            if send_btn:
                send_btn.click()
                time.sleep(2)
            page.close()
            return {"success": True, "message": "回复已发送（浏览器模拟）"}
        except Exception as e:
            print(f"[小红书] 回复异常: {e}")
            return {"success": False, "error": str(e)}

    def __del__(self):
        try:
            if self._browser:
                self._browser.close()
            if self._playwright:
                self._playwright.stop()
        except Exception:
            pass
