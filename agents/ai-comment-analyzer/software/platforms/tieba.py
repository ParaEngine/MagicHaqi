"""
百度贴吧 (Baidu Tieba) 评论收集器
使用 Playwright 浏览器渲染页面后从 DOM 提取楼层回复
"""

import re
import time
from typing import List, Dict, Optional

from .base import BaseCollector


class TiebaCollector(BaseCollector):
    """百度贴吧评论收集器（Playwright DOM 抓取）"""

    platform_name = "tieba"
    platform_display_name = "百度贴吧"
    platform_description = "使用浏览器渲染页面后从 DOM 提取楼层，无需登录"

    BASE_URL = "https://tieba.baidu.com"
    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie.strip().strip("'").strip('"') if cookie else ""
        self._browser = None
        self._playwright = None

    def validate_config(self) -> bool:
        return True

    def _get_browser(self):
        if self._browser is None:
            from playwright.sync_api import sync_playwright
            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
        return self._browser

    def _new_page(self):
        browser = self._get_browser()
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, user_agent=self.UA, locale="zh-CN")
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        page = context.new_page()
        if self.cookie:
            for item in self.cookie.split(";"):
                if "=" in item:
                    k, v = item.strip().split("=", 1)
                    context.add_cookies([{"name": k, "value": v, "domain": ".baidu.com", "path": "/"}])
        return page

    def test_connection(self) -> Dict:
        try:
            self._get_browser()
            return {"success": True, "message": "Playwright 浏览器就绪", "user": None}
        except Exception as e:
            return {"success": False, "message": str(e)}

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        m = re.search(r'tieba\.baidu\.com/p/(\d+)', url_or_id or "")
        if m: return m.group(1)
        m = re.search(r'(\d{5,})', url_or_id or "")
        return m.group(1) if m else (url_or_id or "")

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        tid = self.extract_post_id(post_id)
        try:
            page = self._new_page()
            page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            title = page.title() or ""
            page.close()
            return {"id": tid, "title": title, "content": title, "url": f"{self.BASE_URL}/p/{tid}",
                    "platform": self.platform_name, "author_name": "", "comment_count": 0}
        except Exception as e:
            print(f"[贴吧] 获取帖子信息异常: {e}")
            return {"id": tid, "title": "", "url": f"{self.BASE_URL}/p/{tid}", "platform": self.platform_name}

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        tid = self.extract_post_id(post_id)
        if max_comments is None: max_comments = 100
        print(f"[贴吧] 浏览器打开 {self.BASE_URL}/p/{tid} ...")
        try:
            page = self._new_page()
            page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            # 等待帖子内容加载
            try:
                page.wait_for_selector('.d_post_content, [class*="post"]', timeout=10000)
            except Exception:
                pass
            time.sleep(1)

            last_count = 0
            for _ in range(20):
                floors = page.evaluate("""
                    () => {
                        const items = document.querySelectorAll('.l_post, [class*="l_post"], .d_post');
                        return Array.from(items).map(el => {
                            const nameEl = el.querySelector('.d_name a, .p_author_name, a[class*="user"]');
                            const contentEl = el.querySelector('.d_post_content, .p_content, [class*="content"]');
                            const timeEl = el.querySelector('.tail-info:last-child, [class*="tail-info"]:last-child');
                            const name = nameEl?.textContent?.trim() || '';
                            const content = contentEl?.textContent?.trim() || '';
                            const time = timeEl?.textContent?.trim() || '';
                            if (!content || content.length < 2) return null;
                            return { name, content, time };
                        }).filter(Boolean);
                    }
                """)
                if len(floors) == last_count and len(floors) > 0:
                    break
                last_count = len(floors)
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(2)
                # 尝试点"下一页"
                try:
                    nxt = page.locator('a:has-text("下一页"), .next, [class*="next"]').first
                    if nxt: nxt.click(); time.sleep(2)
                except Exception:
                    pass
            page.close()
            result = []
            for i, f in enumerate(floors[:max_comments]):
                result.append({
                    "id": f"{tid}-{i}", "post_id": tid, "platform": self.platform_name,
                    "author_username": f["name"], "author_name": f["name"],
                    "author_avatar": "", "text": f["content"], "like_count": 0,
                    "reply_count": 0, "created_at": f["time"], "ip_location": "",
                    "platform_data": {},
                })
            print(f"[贴吧] 共提取 {len(result)} 条楼层")
            return result
        except Exception as e:
            print(f"[贴吧] Playwright 异常: {e}")
            return []

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        if not self.cookie:
            return {"success": False, "error": "需要登录 Cookie（含 BDUSS）",
                    "message": "请在侧边栏配置贴吧 Cookie"}
        try:
            page = self._new_page()
            tid = post_id or ""
            page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            reply_box = page.locator('[contenteditable="true"], textarea').first
            if reply_box:
                reply_box.fill(reply_text)
                time.sleep(0.5)
                send_btn = page.locator('button:has-text("发送"), button:has-text("发表")').first
                if send_btn: send_btn.click(); time.sleep(2)
            page.close()
            return {"success": True, "message": "回复已发送"}
        except Exception as e:
            print(f"[贴吧] 回复异常: {e}")
            return {"success": False, "error": str(e)}

    def __del__(self):
        try:
            if self._browser: self._browser.close()
            if self._playwright: self._playwright.stop()
        except Exception: pass
