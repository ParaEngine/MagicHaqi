"""
百度贴吧 (Baidu Tieba) 评论收集器
使用 Playwright 异步 API + asyncio.run() 隔离线程，持久化浏览器 profile 绕过验证码。
"""

import re
import asyncio
import os
from typing import List, Dict, Optional

from .base import BaseCollector

PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tieba_profile")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

INIT_SCRIPT = """
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh']});
    window.chrome = {runtime: {}};
"""


class TiebaCollector(BaseCollector):
    """百度贴吧评论收集器（Playwright 异步 + 持久化 profile）"""

    platform_name = "tieba"
    platform_display_name = "百度贴吧"
    platform_description = "持久化浏览器 — 首次手动过验证码，后续自动复用"

    BASE_URL = "https://tieba.baidu.com"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie.strip().strip("'").strip('"') if cookie else ""

    def validate_config(self) -> bool:
        return True

    # ---------- async core ----------

    async def _async_new_context(self, playwright):
        """创建持久化 context，复用 profile 中的登录态"""
        os.makedirs(PROFILE_DIR, exist_ok=True)
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
            user_agent=UA,
            locale="zh-CN",
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        await context.add_init_script(INIT_SCRIPT)
        if self.cookie:
            cookies_to_add = []
            for item in self.cookie.split(";"):
                item = item.strip()
                if "=" in item:
                    k, v = item.split("=", 1)
                    cookies_to_add.append({"name": k, "value": v, "domain": ".baidu.com", "path": "/"})
            if cookies_to_add:
                await context.add_cookies(cookies_to_add)
        return context

    async def _async_extract_page(self, page):
        """从页面 DOM 提取楼层"""
        try:
            await page.wait_for_selector(".l_post, .d_post_content, [class*='post_content']", timeout=15000)
        except Exception:
            pass
        await asyncio.sleep(2)

        # 滚动加载更多
        last_count = 0
        for _ in range(10):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1.5)
            try:
                load_more = page.locator("text=加载更多, .load-more, [class*='load_more']").first
                if await load_more.is_visible():
                    await load_more.click()
                    await asyncio.sleep(2)
            except Exception:
                pass
            locs = page.locator(".l_post, [class*='l_post']")
            current = await locs.count()
            if current == last_count and current > 0:
                break
            last_count = current

        # JS 提取楼层
        posts_data = await page.evaluate("""
            () => {
                const result = [];
                const floors = document.querySelectorAll('.l_post, .j_l_post, [class*="l_post"]');
                floors.forEach(el => {
                    const userNameEl = el.querySelector('.d_name a, .p_author_name, a[class*="user"]');
                    const contentEl = el.querySelector('.d_post_content, [class*="post_content"], .j_d_post_content');
                    const timeEl = el.querySelector('.tail-info, [class*="tail_info"]');
                    const userName = userNameEl ? userNameEl.textContent.trim() : '匿名';
                    const content = contentEl ? contentEl.textContent.trim() : '';
                    const time = timeEl ? timeEl.textContent.trim() : '';
                    if (!content || content.length < 2) return;
                    result.push({userName, content, time});
                });
                if (result.length === 0) {
                    document.querySelectorAll('.d_post_content, [class*="post_content"]').forEach(el => {
                        const c = el.textContent.trim();
                        if (c && c.length > 2) result.push({userName:'贴吧用户', content:c, time:''});
                    });
                }
                return result;
            }
        """)
        return posts_data

    # ---------- public API (wrapped in asyncio.run) ----------

    def test_connection(self) -> Dict:
        async def _test():
            from playwright.async_api import async_playwright
            pw = await async_playwright().start()
            try:
                ctx = await self._async_new_context(pw)
                await ctx.close()
            finally:
                await pw.stop()
            return {"success": True, "message": "浏览器就绪 — 首次使用请在弹出的浏览器中完成验证码", "user": None}
        try:
            return asyncio.run(_test())
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
        async def _get():
            from playwright.async_api import async_playwright
            pw = await async_playwright().start()
            try:
                ctx = await self._async_new_context(pw)
                page = await ctx.new_page()
                await page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                title = await page.title() or ""
                author = ""
                try:
                    el = page.locator(".d_name a, .p_author_name").first
                    author = await el.inner_text()
                except Exception:
                    pass
                await page.close()
                await ctx.close()
                return {"id": tid, "title": title, "content": title,
                        "url": f"{self.BASE_URL}/p/{tid}",
                        "platform": self.platform_name, "author_name": author, "comment_count": 0}
            finally:
                await pw.stop()
        try:
            return asyncio.run(_get())
        except Exception as e:
            print(f"[贴吧] get_post_info 异常: {e}")
            return {"id": tid, "title": "", "url": f"{self.BASE_URL}/p/{tid}", "platform": self.platform_name}

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        tid = self.extract_post_id(post_id)
        if max_comments is None:
            max_comments = 100
        print(f"[贴吧] 浏览器打开 {self.BASE_URL}/p/{tid} ...")

        async def _fetch():
            from playwright.async_api import async_playwright
            pw = await async_playwright().start()
            try:
                ctx = await self._async_new_context(pw)
                page = await ctx.new_page()
                try:
                    await page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
                    await asyncio.sleep(3)
                    posts_data = await self._async_extract_page(page)
                finally:
                    await page.close()
                    await ctx.close()
                return posts_data
            finally:
                await pw.stop()

        try:
            posts_data = asyncio.run(_fetch())
        except Exception as e:
            print(f"[贴吧] 抓取异常: {e}")
            return []

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

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        tid = self.extract_post_id(post_id) if post_id else ""

        async def _reply():
            from playwright.async_api import async_playwright
            pw = await async_playwright().start()
            try:
                ctx = await self._async_new_context(pw)
                page = await ctx.new_page()
                try:
                    await page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
                    await asyncio.sleep(3)
                    reply_box = page.locator('[contenteditable="true"], #tb_rich_poster_text, textarea.editor').first
                    if await reply_box.count() > 0:
                        await reply_box.click()
                        await asyncio.sleep(0.5)
                        await reply_box.fill(reply_text)
                        await asyncio.sleep(0.5)
                        send_btn = page.locator('a:has-text("发表"), button:has-text("发表"), [class*="submit"]').first
                        if await send_btn.count() > 0:
                            await send_btn.click()
                            await asyncio.sleep(2)
                finally:
                    await page.close()
                    await ctx.close()
                return {"success": True, "message": "回复已发送"}
            finally:
                await pw.stop()

        try:
            return asyncio.run(_reply())
        except Exception as e:
            print(f"[贴吧] 回复异常: {e}")
            return {"success": False, "error": str(e)}
