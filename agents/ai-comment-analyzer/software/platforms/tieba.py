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
                # networkidle 等 JS 完全渲染帖子
                page.goto(f"{self.BASE_URL}/p/{tid}", timeout=60000, wait_until="networkidle")
                time.sleep(3)

                # 等待内容区域
                try:
                    page.wait_for_selector("[class*='thread'], [class*='post'], [class*='content']", timeout=20000)
                except Exception:
                    print("[贴吧] 等待内容超时，继续...")
                time.sleep(2)

                # 滚动评论列表容器加载更多（虚拟列表）
                for scroll_i in range(15):
                    # 优先滚动评论区容器
                    try:
                        reply_list = page.locator(".pc-pb-reply-list, .pb-comment-list, [class*='reply-list']").first
                        if reply_list.count() > 0:
                            reply_list.evaluate("el => { el.scrollTop = el.scrollHeight; }")
                            time.sleep(2)
                    except Exception:
                        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        time.sleep(2)
                    # 点击加载更多
                    try:
                        load_more = page.locator("text=加载更多, .load-more, [class*='load_more']").first
                        if load_more.is_visible(timeout=1000):
                            load_more.click()
                            time.sleep(2)
                    except Exception:
                        pass
                    count = len(page.locator(".pb-comment-item, .virtual-list-item").all())
                    print(f"[贴吧] 滚动 {scroll_i+1}: {count} 条可见")

                # JS 提取 + 智能 fallback
                posts_data, debug_info = page.evaluate("""
                    () => {
                        const debug = {
                            title: document.title,
                            bodyLen: document.body ? document.body.innerText.length : 0,
                            bodySample: document.body ? document.body.innerText.substring(0, 500) : '',
                            totalDivs: document.querySelectorAll('div').length,
                            allClasses: [], selectors: {}, contentTraces: [], textBlockCounts: {}
                        };
                        const knownSels = ['l_post','j_l_post','d_post_content','post_content','d_name','p_author_name',
                            'tail-info','card','thread','post','feed','[class*="l_post"]','[class*="post_content"]',
                            '[class*="d_post"]','[class*="content"]','[class*="floor"]','[class*="reply"]',
                            '[class*="card"]','[class*="thread"]'];
                        knownSels.forEach(s => {
                            try { debug.selectors[s] = document.querySelectorAll(s).length; }
                            catch(e) { debug.selectors[s] = 'ERR'; }
                        });
                        const classSet = new Set();
                        document.querySelectorAll('[class]').forEach(el => el.classList.forEach(c => classSet.add(c)));
                        debug.allClasses = Array.from(classSet).slice(0, 200);

                        const result = [];
                        const seenContents = new Set();  // 去重

                        // 策略1: 新版选择器（精确元素）
                        document.querySelectorAll(
                            '.pb-comment-item, .virtual-list-item'
                        ).forEach(el => {
                            // 用户名: 只取 name-info-link （A标签），避免取到徽章
                            const nameLink = el.querySelector('.name-info-link');
                            const userName = nameLink ? nameLink.textContent.trim() : '匿名';
                            // 内容: 只取 comment-content
                            const contentEl = el.querySelector('.comment-content');
                            let content = contentEl ? contentEl.textContent.trim() : '';
                            // 如果 comment-content 没找到，尝试 pb-rich-text
                            if (!content) {
                                const rich = el.querySelector('.pb-rich-text');
                                content = rich ? rich.textContent.trim() : '';
                            }
                            // 时间/楼层: 取左侧描述区域
                            const descEl = el.querySelector('.comment-desc-left');
                            const time = descEl ? descEl.textContent.trim() : '';

                            const key = content.substring(0, 100);
                            if (content.length >= 1 && !seenContents.has(key)) {
                                seenContents.add(key);
                                result.push({userName, content, time});
                            }
                        });
                        // 策略1b: 旧版选择器（带去重）
                        if (result.length === 0) {
                            document.querySelectorAll('.l_post,.j_l_post,[class*="l_post"]').forEach(el => {
                                const ue = el.querySelector('.d_name a,.p_author_name,a[class*="user"]');
                                const ce = el.querySelector('.d_post_content,[class*="post_content"],.j_d_post_content');
                                const te = el.querySelector('.tail-info,[class*="tail_info"]');
                                const c = ce ? ce.textContent.trim() : '';
                                const key = c.substring(0, 80);
                                if (c.length >= 2 && !seenContents.has(key)) {
                                    seenContents.add(key);
                                    result.push({userName: ue?ue.textContent.trim():'匿名', content:c, time:te?te.textContent.trim():''});
                                }
                            });
                        }
                        // 策略2: 智能 fallback（带去重）
                        if (result.length === 0) {
                            const textBlocks = [];
                            document.querySelectorAll('*').forEach(el => {
                                if (el.children.length === 0 && el.textContent.trim().length >= 20) {
                                    const cls = el.className ? el.className.replace(/\\s+/g,'.') : '(no-class)';
                                    const tag = el.tagName.toLowerCase();
                                    const pcls = el.parentElement && el.parentElement.className
                                        ? el.parentElement.className.replace(/\\s+/g,'.') : '';
                                    const key = tag + '.' + cls + ' <- ' + (pcls||'(no-class)');
                                    textBlocks.push({key, text: el.textContent.trim().substring(0,200)});
                                }
                            });
                            const groups = {};
                            textBlocks.forEach(b => { groups[b.key] = (groups[b.key]||0)+1; });
                            debug.textBlockCounts = groups;
                            const sorted = Object.entries(groups).sort((a,b) => b[1]-a[1]);
                            sorted.slice(0, 10).forEach(([k,c]) => debug.contentTraces.push({keyword: c+'x', path: k}));
                            // 取出现最多的路径，去重
                            if (sorted.length>0 && sorted[0][1]>=3) {
                                const bestKey = sorted[0][0];
                                textBlocks.forEach(b => {
                                    if (b.key === bestKey) {
                                        const dkey = b.text.substring(0, 80);
                                        if (!seenContents.has(dkey)) {
                                            seenContents.add(dkey);
                                            result.push({userName:'贴吧用户', content:b.text, time:''});
                                        }
                                    }
                                });
                            }
                        }
                        // 策略3: 关键词追踪
                        if (result.length === 0) {
                            ['贴吧用户','关注','楼主'].forEach(kw => {
                                const all = document.querySelectorAll('*');
                                for (let i=0; i<all.length; i++) {
                                    if (all[i].children.length===0 && all[i].textContent.trim()===kw) {
                                        let path=[], cur=all[i];
                                        for(let d=0; d<5 && cur && cur!==document.body; d++) {
                                            path.push(cur.tagName+(cur.className?'.'+cur.className.replace(/\\s+/g,'.'):'')+(cur.id?'#'+cur.id:''));
                                            cur=cur.parentElement;
                                        }
                                        debug.contentTraces.push({keyword:kw, path:path.join(' > ')});
                                        break;
                                    }
                                }
                            });
                        }
                        return [result, debug];
                    }
                """)

                # 诊断输出
                print(f"[贴吧] 标题: {debug_info.get('title','?')}, body: {debug_info.get('bodyLen',0)}字符, div: {debug_info.get('totalDivs',0)}")
                sel = debug_info.get('selectors',{})
                print(f"[贴吧] 选择器命中: {', '.join(f'{k}={v}' for k,v in sel.items() if v and v!=0)}")
                classes = debug_info.get('allClasses',[])
                if classes: print(f"[贴吧] class({len(classes)}): {', '.join(classes[:30])}")
                traces = debug_info.get('contentTraces',[])
                for t in traces: print(f"[贴吧] 追踪 {t['keyword']}: {t['path'][:200]}")
                print(f"[贴吧] body样本: {debug_info.get('bodySample','')[:200]}")
                print(f"[贴吧] 提取 {len(posts_data)} 条")
                # 打印前 3 条内容样本
                for i, p in enumerate(posts_data[:3]):
                    print(f"[贴吧]   [{i}] user={p.get('userName','?')} content={p.get('content','')[:100]}")

                self.last_error = ""
                if len(posts_data) == 0:
                    trace_str = "; ".join([f"{t['keyword']}:{t['path'][:120]}" for t in traces[:5]]) or "无"
                    self.last_error = (
                        f"页面可访问但未匹配到楼层。标题={debug_info.get('title','?')}, "
                        f"body={debug_info.get('bodyLen',0)}字符, div={debug_info.get('totalDivs',0)}个。"
                        f"文本块分布: {trace_str}"
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
                page.goto(f"{self.BASE_URL}/p/{tid}", timeout=60000, wait_until="networkidle")
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
