"""
百度贴吧 (Baidu Tieba) 评论收集器
使用 Playwright 同步 API 在独立线程中运行，避免 Streamlit asyncio 冲突。
持久化浏览器 profile 绕过验证码。
"""

import re
import time
import os
import threading
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
    """百度贴吧评论收集器（独立线程 Playwright）"""

    platform_name = "tieba"
    platform_display_name = "百度贴吧"
    platform_description = "持久化浏览器 — 首次手动过验证码，后续自动复用"

    BASE_URL = "https://tieba.baidu.com"

    def __init__(self, cookie: str = "", **kwargs):
        super().__init__(**kwargs)
        self.cookie = cookie.strip().strip("'").strip('"') if cookie else ""
        self.last_error = ""  # 供 UI 展示的诊断信息

    def validate_config(self) -> bool:
        return True

    # ---------- Playwright ops (runs in dedicated thread) ----------

    def _run_in_thread(self, func, *args):
        """在独立线程中运行 Playwright 同步操作，避免 asyncio 冲突"""
        result = []
        error = []

        def wrapper():
            try:
                result.append(func(*args))
            except Exception as e:
                error.append(e)

        t = threading.Thread(target=wrapper, daemon=True)
        t.start()
        t.join(timeout=120)  # 最多等 2 分钟
        if error:
            raise error[0]
        return result[0] if result else None

    def _pw_fetch_comments(self, tid: str, max_comments: int) -> List[Dict]:
        """在独立线程中执行 Playwright 抓取"""
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            os.makedirs(PROFILE_DIR, exist_ok=True)
            context = pw.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                headless=False,
                viewport={"width": 1280, "height": 800},
                user_agent=UA,
                locale="zh-CN",
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            context.add_init_script(INIT_SCRIPT)
            if self.cookie:
                for item in self.cookie.split(";"):
                    if "=" in item:
                        k, v = item.strip().split("=", 1)
                        context.add_cookies([{"name": k, "value": v, "domain": ".baidu.com", "path": "/"}])

            page = context.new_page()
            try:
                print(f"[贴吧] 浏览器打开 {self.BASE_URL}/p/{tid} ...")
                page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
                time.sleep(3)

                try:
                    page.wait_for_selector(".l_post, .d_post_content, [class*='post_content']", timeout=15000)
                except Exception:
                    print("[贴吧] 等待楼层超时，尝试继续...")
                time.sleep(2)

                # 滚动加载更多
                last_count = 0
                for _ in range(10):
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(1.5)
                    try:
                        load_more = page.locator("text=加载更多, .load-more, [class*='load_more']").first
                        if load_more.is_visible():
                            load_more.click()
                            time.sleep(2)
                    except Exception:
                        pass
                    current = len(page.locator(".l_post, [class*='l_post']").all())
                    if current == last_count and current > 0:
                        break
                    last_count = current

                # JS 提取 + 诊断（含 class dump）
                posts_data, debug_info = page.evaluate("""
                    () => {
                        const debug = {
                            title: document.title,
                            bodyLen: document.body ? document.body.innerText.length : 0,
                            bodySample: document.body ? document.body.innerText.substring(0, 500) : '',
                            totalDivs: document.querySelectorAll('div').length,
                            allClasses: [],
                            selectors: {}
                        };
                        // 统计各选择器命中数
                        ['l_post', 'j_l_post', 'd_post_content', 'post_content',
                         'd_name', 'p_author_name', 'tail-info',
                         '[class*="l_post"]', '[class*="post_content"]', '[class*="d_post"]',
                         '[class*="content"]', '[class*="floor"]', '[class*="reply"]'].forEach(sel => {
                            try { debug.selectors[sel] = document.querySelectorAll(sel).length; }
                            catch(e) { debug.selectors[sel] = 'ERR'; }
                        });
                        // 收集页面上所有 div 的 class（去重，最多 200 个）
                        const classSet = new Set();
                        document.querySelectorAll('div[class]').forEach(el => {
                            el.classList.forEach(c => classSet.add(c));
                        });
                        debug.allClasses = Array.from(classSet).slice(0, 200);

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
                        return [result, debug];
                    }
                """)

                # 打印诊断
                print(f"[贴吧] 页面标题: {debug_info.get('title', 'N/A')}")
                print(f"[贴吧] body 文本长度: {debug_info.get('bodyLen', 0)} 字符，总 div: {debug_info.get('totalDivs', 0)}")
                sel = debug_info.get('selectors', {})
                print(f"[贴吧] 选择器: l_post={sel.get('l_post',0)} j_l_post={sel.get('j_l_post',0)} "
                      f"d_post_content={sel.get('d_post_content',0)} post_content={sel.get('post_content',0)} "
                      f"d_name={sel.get('d_name',0)} tail-info={sel.get('tail-info',0)}")
                classes = debug_info.get('allClasses', [])
                if classes:
                    print(f"[贴吧] 页面class列表 (共{len(classes)}个): {', '.join(classes)}")
                print(f"[贴吧] body 样本: {debug_info.get('bodySample', '')[:300]}")
                print(f"[贴吧] 提取到 {len(posts_data)} 条帖子")

                self.last_error = ""
                if len(posts_data) == 0:
                    self.last_error = (
                        f"页面可访问但未匹配到楼层。"
                        f"标题={debug_info.get('title','?')}, "
                        f"body={debug_info.get('bodyLen',0)}字符, "
                        f"div={debug_info.get('totalDivs',0)}个。"
                        f"l_post=0, d_post_content=0。"
                        f"页面CSS类: {', '.join(classes[:30])}..."
                    )
                return posts_data
            finally:
                page.close()
                context.close()

    def _pw_get_post_info(self, tid: str) -> Dict:
        """获取帖子基本信息"""
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            os.makedirs(PROFILE_DIR, exist_ok=True)
            context = pw.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                headless=False,
                viewport={"width": 1280, "height": 800},
                user_agent=UA,
                locale="zh-CN",
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            page = context.new_page()
            try:
                page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
                time.sleep(3)
                title = page.title() or ""
                author = ""
                try:
                    author = page.locator(".d_name a, .p_author_name").first.inner_text()
                except Exception:
                    pass
                return {"id": tid, "title": title, "content": title,
                        "url": f"{self.BASE_URL}/p/{tid}",
                        "platform": self.platform_name, "author_name": author, "comment_count": 0}
            finally:
                page.close()
                context.close()

    def _pw_reply(self, tid: str, reply_text: str) -> Dict:
        """回复帖子"""
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            os.makedirs(PROFILE_DIR, exist_ok=True)
            context = pw.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                headless=False,
                viewport={"width": 1280, "height": 800},
                user_agent=UA,
                locale="zh-CN",
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            page = context.new_page()
            try:
                page.goto(f"{self.BASE_URL}/p/{tid}", timeout=30000, wait_until="domcontentloaded")
                time.sleep(3)
                reply_box = page.locator(
                    '[contenteditable="true"], #tb_rich_poster_text, textarea.editor'
                ).first
                if reply_box.count() > 0:
                    reply_box.click()
                    time.sleep(0.5)
                    reply_box.fill(reply_text)
                    time.sleep(0.5)
                    send_btn = page.locator(
                        'a:has-text("发表"), button:has-text("发表"), [class*="submit"]'
                    ).first
                    if send_btn.count() > 0:
                        send_btn.click()
                        time.sleep(2)
                return {"success": True, "message": "回复已发送"}
            finally:
                page.close()
                context.close()

    # ---------- public API ----------

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
        m = re.search(r'tieba\.baidu\.com/p/(\d+)', url_or_id or "")
        if m:
            return m.group(1)
        m = re.search(r'(\d{5,})', url_or_id or "")
        return m.group(1) if m else (url_or_id or "")

    def get_post_info(self, post_id: str) -> Optional[Dict]:
        tid = self.extract_post_id(post_id)
        try:
            return self._run_in_thread(self._pw_get_post_info, tid)
        except Exception as e:
            print(f"[贴吧] get_post_info 异常: {e}")
            return {"id": tid, "title": "", "url": f"{self.BASE_URL}/p/{tid}", "platform": self.platform_name}

    def fetch_comments(self, post_id: str, max_comments: Optional[int] = None) -> List[Dict]:
        tid = self.extract_post_id(post_id)
        if max_comments is None:
            max_comments = 100
        self.last_error = ""

        try:
            posts_data = self._run_in_thread(self._pw_fetch_comments, tid, max_comments)
        except Exception as e:
            self.last_error = f"抓取异常: {e}"
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
        try:
            return self._run_in_thread(self._pw_reply, tid, reply_text)
        except Exception as e:
            print(f"[贴吧] 回复异常: {e}")
            return {"success": False, "error": str(e)}
