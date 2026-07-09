"""
百度贴吧 (Baidu Tieba) 评论收集器
使用 Playwright 持久化浏览器 + DOM 抓取。首次使用需手动过验证码，之后复用 profile 无需重复验证。
"""

import re
import time
import os
from typing import List, Dict, Optional

from .base import BaseCollector

PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tieba_profile")


class TiebaCollector(BaseCollector):
    """百度贴吧评论收集器（Playwright 持久化浏览器）"""

    platform_name = "tieba"
    platform_display_name = "百度贴吧"
    platform_description = "持久化浏览器 — 首次手动过验证码，后续自动复用"

    BASE_URL = "https://tieba.baidu.com"
    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie.strip().strip("'").strip('"') if cookie else ""
        self._browser = None
        self._playwright = None
        self._context = None

    def validate_config(self) -> bool:
        return True

    def _ensure_browser(self):
        if self._browser is not None:
            return
        from playwright.sync_api import sync_playwright
        os.makedirs(PROFILE_DIR, exist_ok=True)
        self._playwright = sync_playwright().start()
        self._context = self._playwright.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
            user_agent=self.UA,
            locale="zh-CN",
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        self._context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh']});
            window.chrome = {runtime: {}};
            // 移除 PhantomJS 痕迹
            delete window.__phantomas;
        """)
        # 如果提供了额外 cookie，注入
        if self.cookie:
            cookies_to_add = []
            for item in self.cookie.split(";"):
                item = item.strip()
                if "=" in item:
                    k, v = item.split("=", 1)
                    cookies_to_add.append({"name": k, "value": v, "domain": ".baidu.com", "path": "/"})
            if cookies_to_add:
                self._context.add_cookies(cookies_to_add)

    def _new_page(self):
        self._ensure_browser()
        return self._context.new_page()

    def test_connection(self) -> Dict:
        try:
            self._ensure_browser()
            return {"success": True, "message": "浏览器就绪 — 首次使用请在弹出的浏览器中完成验证码", "user": None}
        except Exception as e:
            return {"success": False, "message": str(e)}

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        m = re.search(r'tieba\.baidu\.com/p/(\d+)', url_or_id or "")
        if m:
            return m.group(1)
        m = re.search(r'(\d{5,})', url_or_id or "")
        return m.group(1) if m else (url_or_id or "")

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        tid = self.extract_post_id(post_id)
        try:
            page = self._new_page()
            page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            title = page.title() or ""
            author = ""
            try:
                author_el = page.locator(".d_name a, .p_author_name, [class*='user_name']").first
                author = author_el.inner_text()
            except Exception:
                pass
            page.close()
            return {
                "id": tid, "title": title, "content": title,
                "url": f"{self.BASE_URL}/p/{tid}",
                "platform": self.platform_name, "author_name": author, "comment_count": 0,
            }
        except Exception as e:
            print(f"[贴吧] 获取帖子信息异常: {e}")
            return {"id": tid, "title": "", "url": f"{self.BASE_URL}/p/{tid}", "platform": self.platform_name}

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        tid = self.extract_post_id(post_id)
        if max_comments is None:
            max_comments = 100
        print(f"[贴吧] 浏览器打开 {self.BASE_URL}/p/{tid} ...")
        try:
            page = self._new_page()
            page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)

            # 等待楼层加载
            try:
                page.wait_for_selector(".l_post, .d_post_content, [class*='post_content']", timeout=15000)
            except Exception:
                print("[贴吧] 等待楼层超时，尝试继续...")
            time.sleep(2)

            # 滚动翻页加载更多楼层
            last_count = 0
            for _ in range(10):
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(1.5)
                # 尝试点击"加载更多"
                try:
                    load_more = page.locator("text=加载更多, .load-more, [class*='load_more']").first
                    if load_more.is_visible():
                        load_more.click()
                        time.sleep(2)
                except Exception:
                    pass
                # 统计当前楼层数
                current = len(page.locator(".l_post, [class*='l_post']").all())
                if current == last_count and current > 0:
                    break
                last_count = current

            # 提取楼层数据
            posts_data = page.evaluate("""
                () => {
                    const result = [];
                    const floors = document.querySelectorAll(
                        '.l_post, .j_l_post, [class*="l_post"]'
                    );
                    floors.forEach(el => {
                        const userNameEl = el.querySelector(
                            '.d_name a, .p_author_name, a[class*="user"], [class*="user_name"]'
                        );
                        const contentEl = el.querySelector(
                            '.d_post_content, [class*="post_content"], .j_d_post_content'
                        );
                        const timeEl = el.querySelector(
                            '.tail-info, [class*="tail_info"], [class*="post_time"]'
                        );
                        const floorEl = el.querySelector(
                            '.tail-info, [class*="floor"]'
                        );
                        const userName = userNameEl ? userNameEl.textContent.trim() : '匿名';
                        const content = contentEl ? contentEl.textContent.trim() : '';
                        const time = timeEl ? timeEl.textContent.trim() : '';
                        if (!content || content.length < 2) return;
                        result.push({ userName, content, time });
                    });
                    // fallback: 如果没有找到 l_post，尝试其他选择器
                    if (result.length === 0) {
                        const allDivs = document.querySelectorAll('.d_post_content, [class*="post_content"]');
                        allDivs.forEach(el => {
                            const content = el.textContent.trim();
                            if (content && content.length > 2) {
                                result.push({ userName: '贴吧用户', content, time: '' });
                            }
                        });
                    }
                    return result;
                }
            """)

            page.close()

            result = []
            for i, p in enumerate(posts_data[:max_comments]):
                result.append({
                    "id": f"tb-{tid}-{i}",
                    "post_id": tid,
                    "platform": self.platform_name,
                    "author_username": p.get("userName", "贴吧用户"),
                    "author_name": p.get("userName", "贴吧用户"),
                    "author_avatar": "",
                    "text": p.get("content", ""),
                    "like_count": 0,
                    "reply_count": 0,
                    "created_at": p.get("time", ""),
                    "ip_location": "",
                    "platform_data": {},
                })
            print(f"[贴吧] 共提取 {len(result)} 条评论")
            return result
        except Exception as e:
            print(f"[贴吧] 抓取异常: {e}")
            return []

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        tid = self.extract_post_id(post_id) if post_id else ""
        try:
            page = self._new_page()
            page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            # 找到回复框
            reply_box = page.locator('[contenteditable="true"], #tb_rich_poster_text, textarea.editor').first
            if reply_box:
                reply_box.click()
                time.sleep(0.5)
                reply_box.fill(reply_text)
                time.sleep(0.5)
                send_btn = page.locator('a:has-text("发表"), button:has-text("发表"), [class*="submit"]').first
                send_btn.click()
                time.sleep(2)
            page.close()
            return {"success": True, "message": "回复已发送"}
        except Exception as e:
            print(f"[贴吧] 回复异常: {e}")
            return {"success": False, "error": str(e)}

    def __del__(self):
        try:
            if self._context:
                self._context.close()
            if self._playwright:
                self._playwright.stop()
        except Exception:
            pass
