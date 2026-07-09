"""
小红书 (Xiaohongshu) 评论收集器
使用 Playwright 同步 API 在独立线程中运行，持久化 profile 绕过反爬。
"""

import re
import time
import os
import threading
from typing import List, Dict, Optional

from .base import BaseCollector

PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "xhs_profile")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

INIT_SCRIPT = """
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh']});
    window.chrome = {runtime: {}};
"""


class XiaohongshuCollector(BaseCollector):
    """小红书评论收集器（独立线程 Playwright）"""

    platform_name = "xiaohongshu"
    platform_display_name = "小红书"
    platform_description = "持久化浏览器 — 首次手动登录/过验证码，后续自动复用"

    BASE_URL = "https://www.xiaohongshu.com"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie.strip().strip("'").strip('"') if cookie else ""
        self.last_error = ""

    def validate_config(self) -> bool:
        return True

    def _run_in_thread(self, func, *args):
        """在独立线程中运行 Playwright，避免 Streamlit asyncio 冲突"""
        result = []
        error = []

        def wrapper():
            try:
                result.append(func(*args))
            except Exception as e:
                error.append(e)

        t = threading.Thread(target=wrapper, daemon=True)
        t.start()
        t.join(timeout=120)
        if error:
            raise error[0]
        return result[0] if result else None

    def _pw_fetch_comments(self, note_id: str, max_comments: int) -> List[Dict]:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            os.makedirs(PROFILE_DIR, exist_ok=True)
            context = pw.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                headless=False,
                viewport={"width": 1920, "height": 1080},
                user_agent=UA,
                locale="zh-CN",
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            context.add_init_script(INIT_SCRIPT)
            if self.cookie:
                for item in self.cookie.split(";"):
                    if "=" in item:
                        k, v = item.strip().split("=", 1)
                        context.add_cookies([{"name": k, "value": v, "domain": ".xiaohongshu.com", "path": "/"}])

            page = context.new_page()
            url = f"{self.BASE_URL}/explore/{note_id}"
            try:
                print(f"[小红书] 浏览器打开 {url} ...")
                page.goto(url, timeout=30000, wait_until="domcontentloaded")
                time.sleep(3)

                # 滚动加载
                last_count = 0
                for _ in range(20):
                    # 提取 + 诊断
                    extracted = page.evaluate("""
                        () => {
                            const debug = {
                                title: document.title,
                                bodyLen: document.body ? document.body.innerText.length : 0,
                                bodySample: document.body ? document.body.innerText.substring(0, 500) : '',
                                totalDivs: document.querySelectorAll('div').length,
                                selectors: {}
                            };
                            ['comment-item', 'parent-comment', 'CommentItem', 'comment',
                             'username', 'nickname', 'user-name', 'avatar',
                             'note-text', 'content', 'comment-content',
                             'like', 'count', '[class*="comment"]', '[class*="user"]',
                             '[class*="nickname"]', '[class*="content"]'].forEach(sel => {
                                try { debug.selectors[sel] = document.querySelectorAll(
                                    sel.includes('[') ? sel : '.' + sel + ', [class*="' + sel + '"]'
                                ).length; }
                                catch(e) { debug.selectors[sel] = 'ERR'; }
                            });

                            const items = document.querySelectorAll(
                                '.comment-item, .parent-comment, [class*="comment-item"], [class*="CommentItem"]'
                            );
                            const result = Array.from(items).map(el => {
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
                            return { result, debug };
                        }
                    """)
                    comments = extracted["result"]
                    debug_info = extracted["debug"]

                    print(f"[小红书] 页面标题: {debug_info.get('title', 'N/A')}")
                    print(f"[小红书] body 文本长度: {debug_info.get('bodyLen', 0)} 字符")
                    sel = debug_info.get('selectors', {})
                    print(f"[小红书] 选择器命中: comment-item={sel.get('comment-item',0)}, "
                          f"username={sel.get('username',0)}, content={sel.get('content',0)}")

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

                print(f"[小红书] 提取到 {len(comments)} 条评论")
                if len(comments) == 0:
                    self.last_error = (
                        f"页面可访问但未匹配到评论。诊断: "
                        f"标题={debug_info.get('title','?')}, "
                        f"body文本={debug_info.get('bodyLen',0)}字符, "
                        f"命中: {sel}。"
                        f"body样本: {debug_info.get('bodySample','')[:200]}"
                    )
                return comments
            finally:
                page.close()
                context.close()

    def _pw_get_post_info(self, note_id: str) -> Dict:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            os.makedirs(PROFILE_DIR, exist_ok=True)
            context = pw.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR, headless=False,
                viewport={"width": 1920, "height": 1080},
                user_agent=UA, locale="zh-CN",
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            page = context.new_page()
            url = f"{self.BASE_URL}/explore/{note_id}"
            try:
                page.goto(url, timeout=30000, wait_until="domcontentloaded")
                time.sleep(3)
                title = page.title() or ""
                author = ""
                try:
                    author = page.locator('[class*="username"], [class*="nickname"]').first.inner_text()
                except Exception:
                    pass
                return {"id": note_id, "title": title, "content": "",
                        "url": url, "platform": self.platform_name,
                        "author_name": author, "comment_count": 0}
            finally:
                page.close()
                context.close()

    def test_connection(self) -> Dict:
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                os.makedirs(PROFILE_DIR, exist_ok=True)
                ctx = pw.chromium.launch_persistent_context(
                    user_data_dir=PROFILE_DIR, headless=False,
                    viewport={"width": 1280, "height": 800},
                )
                ctx.close()
            return {"success": True, "message": "浏览器就绪 — 首次使用请在弹出的浏览器中完成验证码", "user": None}
        except Exception as e:
            return {"success": False, "message": str(e)}

    @staticmethod
    def extract_post_id(url_or_id: str) -> str:
        m = re.search(r'/explore/([a-zA-Z0-9]+)', url_or_id or "")
        if m:
            return m.group(1)
        m = re.search(r'/discovery/item/([a-zA-Z0-9]+)', url_or_id or "")
        return m.group(1) if m else (url_or_id or "")

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        note_id = self.extract_post_id(post_id)
        try:
            return self._run_in_thread(self._pw_get_post_info, note_id)
        except Exception as e:
            print(f"[小红书] get_post_info 异常: {e}")
            url = f"{self.BASE_URL}/explore/{note_id}"
            return {"id": note_id, "title": "", "url": url, "platform": self.platform_name}

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        note_id = self.extract_post_id(post_id)
        if max_comments is None:
            max_comments = 100
        self.last_error = ""

        try:
            comments = self._run_in_thread(self._pw_fetch_comments, note_id, max_comments)
        except Exception as e:
            self.last_error = f"抓取异常: {e}"
            print(f"[小红书] Playwright 异常: {e}")
            return []

        result = []
        for i, c in enumerate(comments[:max_comments]):
            result.append({
                "id": c.get("id") or f"xhs-{note_id}-{i}",
                "post_id": note_id,
                "platform": self.platform_name,
                "author_username": c.get("userName", "小红书用户"),
                "author_name": c.get("userName", "小红书用户"),
                "author_avatar": c.get("avatar", ""),
                "text": c.get("content", ""),
                "like_count": c.get("likeCount", 0),
                "reply_count": 0,
                "created_at": "",
                "ip_location": "",
                "platform_data": {},
            })
        print(f"[小红书] 共返回 {len(result)} 条评论")
        return result

    def reply_comment(self, comment_id: str, reply_text: str, post_id: str = "") -> Dict:
        note_id = self.extract_post_id(post_id) if post_id else ""
        if not self.cookie:
            return {"success": False, "error": "需要登录 Cookie",
                    "message": "请在侧边栏配置小红书 Cookie"}

        def _reply():
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                os.makedirs(PROFILE_DIR, exist_ok=True)
                context = pw.chromium.launch_persistent_context(
                    user_data_dir=PROFILE_DIR, headless=False,
                    viewport={"width": 1920, "height": 1080},
                    user_agent=UA, locale="zh-CN",
                    args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
                )
                context.add_init_script(INIT_SCRIPT)
                if self.cookie:
                    for item in self.cookie.split(";"):
                        if "=" in item:
                            k, v = item.strip().split("=", 1)
                            context.add_cookies([{"name": k, "value": v, "domain": ".xiaohongshu.com", "path": "/"}])
                page = context.new_page()
                try:
                    page.goto(f"{self.BASE_URL}/explore/{note_id}", timeout=30000, wait_until="domcontentloaded")
                    time.sleep(3)
                    reply_box = page.locator('[contenteditable="true"], textarea').first
                    if reply_box.count() > 0:
                        reply_box.fill(reply_text)
                        time.sleep(0.5)
                        send_btn = page.locator('button:has-text("发送"), button:has-text("发布"), [class*="send"]').first
                        if send_btn.count() > 0:
                            send_btn.click()
                            time.sleep(2)
                    return {"success": True, "message": "回复已发送"}
                finally:
                    page.close()
                    context.close()

        try:
            return self._run_in_thread(_reply)
        except Exception as e:
            print(f"[小红书] 回复异常: {e}")
            return {"success": False, "error": str(e)}
