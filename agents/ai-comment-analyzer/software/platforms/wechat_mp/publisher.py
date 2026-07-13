"""
微信公众号发布器 (WeChat MP Publisher)

基于 topic-to-wechat (mileson/topic-to-wechat) 的发布引擎，
封装微信公众号草稿发布能力为统一 Python 接口。

核心能力:
  - Markdown → 公众号兼容 HTML（内联 CSS）
  - 纯 PIL 封面图生成（5 种风格预设）
  - 图片上传至微信 CDN
  - 创建草稿 / 发布草稿 / 查询状态
  - 2 套内置排版主题 (tech-digest / news-minimal)

依赖:
  pip install wechatpy cryptography mistune pygments pyyaml Pillow requests

使用示例:
    from platforms.wechat_mp import WechatMPPublisher

    pub = WechatMPPublisher(appid="wx_xxx", secret="xxx")
    pub.publish_draft(
        title="文章标题",
        content_md="# 正文内容...",
        author="作者名",
        theme="tech-digest",
        cover_style="gradient",
    )
"""

import os
import sys
import json
import base64
import hashlib
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, field

# 将 wechat_mp 子模块加入路径以支持相对导入
_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))


@dataclass
class WechatPublishResult:
    """微信公众号发布结果"""
    success: bool
    status: str = ""          # success / draft_created / error
    message: str = ""
    draft_id: str = ""        # 草稿 media_id
    publish_id: str = ""      # 发布任务 ID
    url: str = ""             # 发布后的链接
    raw: str = ""

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v}


class WechatMPPublisher:
    """
    微信公众号发布器

    封装 topic-to-wechat 的核心发布逻辑，提供与 xiaohongshu_publisher
    一致的接口风格，方便 AI agent 调用。
    """

    # 封面风格预设
    COVER_STYLES = {
        "gradient": "渐变背景 + 居中卡片",
        "accent-bar": "深色背景 + 左侧装饰条",
        "split": "左侧文字 + 右侧色块",
        "minimal": "渐变背景 + 大标题",
        "geometric": "浅色背景 + 几何装饰",
    }

    def __init__(
        self,
        appid: str = "",
        secret: str = "",
        workspace: str = "",
    ):
        """
        初始化发布器

        Args:
            appid: 微信公众号 AppID（优先从 .env 读取 WECHAT_APPID）
            secret: 微信公众号 AppSecret（优先从 .env 读取 WECHAT_SECRET）
            workspace: 工作目录（用于生成封面等临时文件）
        """
        self.appid = appid or os.getenv("WECHAT_APPID", "")
        self.secret = secret or os.getenv("WECHAT_SECRET", "")
        self.workspace = Path(workspace) if workspace else Path.cwd() / "wechat_output"
        self._client = None
        self._access_token = None
        self._theme_dir = _MODULE_DIR / "themes"

    # ------------------------------------------------------------------
    # 认证
    # ------------------------------------------------------------------

    def authenticate(self) -> bool:
        """认证微信公众号 API"""
        if not self.appid or not self.secret:
            return False

        try:
            from wechatpy import WeChatClient
            self._client = WeChatClient(self.appid, self.secret)
            token = self._client.fetch_access_token()
            self._access_token = token.get("access_token")
            return True
        except ImportError:
            return False
        except Exception as e:
            self._last_error = str(e)
            return False

    def check_config(self) -> Dict:
        """检查配置状态"""
        has_creds = bool(self.appid and self.secret)
        has_deps = False
        try:
            import wechatpy  # noqa: F401
            has_deps = True
        except ImportError:
            pass

        return {
            "configured": has_creds,
            "deps_installed": has_deps,
            "appid": f"{self.appid[:6]}***" if self.appid else "(not set)",
            "theme_dir": str(self._theme_dir),
            "available_themes": self.list_themes(),
        }

    def list_themes(self) -> List[str]:
        """列出可用的排版主题"""
        if not self._theme_dir.exists():
            return []
        return sorted([
            d.name for d in self._theme_dir.iterdir()
            if d.is_dir() and (d / "theme.yaml").exists()
        ])

    # ------------------------------------------------------------------
    # 图片上传
    # ------------------------------------------------------------------

    def upload_image(self, image_path: str) -> Optional[str]:
        """上传图片到微信 CDN，返回图片 URL"""
        if not self._client:
            if not self.authenticate():
                return None

        path = Path(image_path)
        if not path.exists():
            return None

        try:
            with open(path, "rb") as f:
                result = self._client.media.upload_mass_image(f)
            if isinstance(result, str):
                return result
            if isinstance(result, dict) and "url" in result:
                return result["url"]
        except Exception:
            pass
        return None

    def upload_cover(self, image_path: str) -> Optional[str]:
        """上传封面图作为永久素材，返回 thumb_media_id"""
        if not self._client:
            if not self.authenticate():
                return None

        path = Path(image_path)
        if not path.exists():
            return None

        try:
            with open(path, "rb") as f:
                result = self._client.material.add("image", f)
            if isinstance(result, dict) and "media_id" in result:
                return result["media_id"]
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # Markdown → 公众号 HTML
    # ------------------------------------------------------------------

    def markdown_to_html(
        self,
        content: str,
        theme: str = "tech-digest",
        title: str = "",
    ) -> Tuple[str, str]:
        """
        将 Markdown 转换为公众号兼容的 HTML

        Args:
            content: Markdown 正文
            theme: 主题名 (tech-digest / news-minimal)
            title: 文章标题（用于 HTML title）

        Returns:
            (html_content, error_message)
        """
        try:
            # 尝试使用 md_to_styled_html.py 的转换逻辑
            sys.path.insert(0, str(_MODULE_DIR))
            from md_to_styled_html import (
                md_to_html, THEME_DIR, StyledHTMLGenerator
            )

            theme_path = self._theme_dir / theme / "theme.yaml"
            if not theme_path.exists():
                theme = "tech-digest"
                theme_path = self._theme_dir / "tech-digest" / "theme.yaml"

            generator = StyledHTMLGenerator(str(theme_path))
            html = generator.convert(content, title=title or "未命名")
            return html, ""
        except ImportError:
            # 回退: 简单的 markdown 转 HTML
            try:
                import mistune
                html_body = mistune.html(content)
                html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title or 'Untitled'}</title>
<style>body{{max-width:680px;margin:0 auto;padding:16px;font-size:15px;line-height:1.85;color:#2d3748;}}
h1{{color:#667eea}}h2{{color:#e53e3e}}h3{{color:#38a169}}
pre{{background:#1a1a2e;color:#f8f8f2;padding:16px;border-radius:8px;overflow-x:auto}}
code{{background:#edf2f7;padding:2px 6px;border-radius:4px}}
blockquote{{border-left:4px solid #667eea;margin:16px 0;padding:8px 16px;background:#f7fafc}}
img{{max-width:100%}}
</style></head><body>{html_body}</body></html>"""
                return html, ""
            except ImportError:
                return "", "mistune not installed. Run: pip install mistune"

    # ------------------------------------------------------------------
    # 封面生成
    # ------------------------------------------------------------------

    def generate_cover(
        self,
        title: str,
        style: str = "gradient",
        output_path: str = "",
    ) -> Optional[str]:
        """
        生成封面图（900×383）

        Args:
            title: 封面标题文字
            style: 风格 (gradient / accent-bar / split / minimal / geometric)
            output_path: 输出路径（默认 wechat_output/cover.png）

        Returns:
            生成的图片路径，失败返回 None
        """
        if style not in self.COVER_STYLES:
            style = "gradient"

        out = Path(output_path) if output_path else self.workspace / "cover.png"
        out.parent.mkdir(parents=True, exist_ok=True)

        try:
            sys.path.insert(0, str(_MODULE_DIR))
            from generate_cover import CoverGenerator

            gen = CoverGenerator()
            gen.generate(title=title, style=style, output=str(out))
            if out.exists():
                return str(out)
        except ImportError:
            # 回退: 纯 PIL 简单封面生成
            try:
                from PIL import Image, ImageDraw, ImageFont
                img = Image.new("RGB", (900, 383), (102, 126, 234))
                draw = ImageDraw.Draw(img)
                # 简单居中文字
                text = title[:20]
                bbox = draw.textbbox((0, 0), text)
                tw = bbox[2] - bbox[0]
                draw.text(((900 - tw) // 2, 160), text, fill="white")
                img.save(str(out))
                return str(out)
            except ImportError:
                pass
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # 发布草稿
    # ------------------------------------------------------------------

    def _api_post(self, path: str, data: dict) -> dict:
        """POST 到微信 API"""
        import requests
        url = f"https://api.weixin.qq.com/cgi-bin/{path}?access_token={self._access_token}"
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        resp = requests.post(
            url, data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("errcode", 0) != 0:
            raise RuntimeError(
                f"WeChat API error [{result.get('errcode')}]: {result.get('errmsg')}"
            )
        return result

    def create_draft(
        self,
        title: str,
        html_content: str,
        content_source_url: str = "",
        author: str = "",
        digest: str = "",
        thumb_media_id: str = "",
        need_open_comment: int = 0,
    ) -> WechatPublishResult:
        """
        创建公众号草稿

        Args:
            title: 标题（≤64字节 UTF-8）
            html_content: 公众号兼容的 HTML 正文
            content_source_url: 原文链接
            author: 作者名（≤16字）
            digest: 摘要（≤120字节）
            thumb_media_id: 封面素材 media_id
            need_open_comment: 是否开启评论 (0/1)

        Returns:
            WechatPublishResult
        """
        if not self._client:
            if not self.authenticate():
                return WechatPublishResult(
                    success=False,
                    message=f"认证失败: {getattr(self, '_last_error', '请检查 AppID/Secret')}",
                )

        # 截断处理
        title_bytes = title.encode("utf-8")
        if len(title_bytes) > 64:
            title = title_bytes[:64].decode("utf-8", errors="ignore").rstrip()
        if len(author) > 16:
            author = author[:16]
        digest_bytes = digest.encode("utf-8") if digest else b""
        if len(digest_bytes) > 120:
            digest = digest_bytes[:120].decode("utf-8", errors="ignore").rstrip()

        articles = [{
            "title": title,
            "author": author or "AI Assistant",
            "digest": digest or "",
            "content": html_content,
            "content_source_url": content_source_url,
            "thumb_media_id": thumb_media_id,
            "need_open_comment": need_open_comment,
            "only_fans_can_comment": 0,
        }]

        try:
            result = self._api_post("draft/add", {"articles": articles})
            return WechatPublishResult(
                success=True,
                status="draft_created",
                message="草稿创建成功",
                draft_id=result.get("media_id", ""),
                raw=json.dumps(result, ensure_ascii=False),
            )
        except Exception as e:
            return WechatPublishResult(
                success=False,
                message=f"创建草稿失败: {e}",
            )

    def publish_draft(self, media_id: str) -> WechatPublishResult:
        """
        发布草稿（群发，需审核）

        Args:
            media_id: 草稿 media_id

        Returns:
            WechatPublishResult
        """
        if not self._client:
            if not self.authenticate():
                return WechatPublishResult(success=False, message="认证失败")

        try:
            result = self._api_post("freepublish/submit", {"media_id": media_id})
            return WechatPublishResult(
                success=True,
                status="success",
                message="发布任务已提交",
                publish_id=result.get("publish_id", ""),
                raw=json.dumps(result, ensure_ascii=False),
            )
        except Exception as e:
            return WechatPublishResult(success=False, message=f"发布失败: {e}")

    def get_publish_status(self, publish_id: str) -> WechatPublishResult:
        """查询发布任务状态"""
        if not self._client:
            if not self.authenticate():
                return WechatPublishResult(success=False, message="认证失败")

        try:
            result = self._api_post("freepublish/get", {"publish_id": publish_id})
            status_map = {0: "success", 1: "publishing", 2: "failed"}
            pub_status = result.get("publish_status", 1)
            article_detail = result.get("article_detail", {}).get("detail", [{}])
            url = article_detail[0].get("article_url", "") if article_detail else ""

            return WechatPublishResult(
                success=pub_status == 0,
                status=status_map.get(pub_status, "unknown"),
                message=f"发布状态: {status_map.get(pub_status, 'unknown')}",
                publish_id=publish_id,
                url=url,
                raw=json.dumps(result, ensure_ascii=False),
            )
        except Exception as e:
            return WechatPublishResult(success=False, message=f"查询失败: {e}")

    # ------------------------------------------------------------------
    # 一键发布（完整流程）
    # ------------------------------------------------------------------

    def one_click_publish(
        self,
        title: str,
        content_md: str,
        author: str = "",
        digest: str = "",
        theme: str = "tech-digest",
        cover_style: str = "gradient",
        cover_image: str = "",
        content_source_url: str = "",
        auto_publish: bool = False,
    ) -> WechatPublishResult:
        """
        一键发布：Markdown → HTML → 封面 → 上传图片 → 创建草稿 → (可选)发布

        Args:
            title: 文章标题
            content_md: Markdown 正文
            author: 作者名
            digest: 摘要
            theme: 排版主题
            cover_style: 封面风格
            cover_image: 自定义封面图路径（不提供则自动生成）
            content_source_url: 原文链接
            auto_publish: 是否自动发布（默认只创建草稿）

        Returns:
            WechatPublishResult
        """
        # 1. 认证
        if not self._client:
            if not self.authenticate():
                return WechatPublishResult(
                    success=False,
                    message="微信认证失败。请检查 .env 中的 WECHAT_APPID / WECHAT_SECRET，并确认服务器 IP 在白名单中",
                )

        self.workspace.mkdir(parents=True, exist_ok=True)

        # 2. Markdown → HTML
        html, err = self.markdown_to_html(content_md, theme=theme, title=title)
        if err:
            return WechatPublishResult(success=False, message=f"HTML转换失败: {err}")

        # 3. 封面图
        thumb_media_id = ""
        if cover_image and Path(cover_image).exists():
            thumb_media_id = self.upload_cover(cover_image) or ""
        else:
            cover_path = self.generate_cover(title, style=cover_style)
            if cover_path:
                thumb_media_id = self.upload_cover(cover_path) or ""

        # 4. 创建草稿
        result = self.create_draft(
            title=title,
            html_content=html,
            author=author,
            digest=digest or content_md[:100].replace("#", "").strip(),
            thumb_media_id=thumb_media_id,
            content_source_url=content_source_url,
        )

        # 5. 自动发布
        if result.success and auto_publish and result.draft_id:
            pub_result = self.publish_draft(result.draft_id)
            result.publish_id = pub_result.publish_id
            result.status = pub_result.status
            result.message += " → 已提交发布"

        return result

    # ------------------------------------------------------------------
    # Agent 集成接口
    # ------------------------------------------------------------------

    def get_agent_state(self) -> Dict:
        """
        获取可供 AI agent 读取的状态快照
        """
        config = self.check_config()
        return {
            "configured": config["configured"],
            "deps_installed": config["deps_installed"],
            "ready": config["configured"] and config["deps_installed"],
            "appid_hint": config["appid"],
            "themes": config["available_themes"],
            "cover_styles": list(self.COVER_STYLES.keys()),
        }

    def agent_publish(
        self,
        title: str,
        content: str,
        author: str = "",
        theme: str = "tech-digest",
        cover_style: str = "gradient",
    ) -> Dict:
        """
        AI agent 友好的发布接口（返回 JSON 字典）
        """
        result = self.one_click_publish(
            title=title,
            content_md=content,
            author=author,
            theme=theme,
            cover_style=cover_style,
            auto_publish=False,
        )
        return result.to_dict()


# ------------------------------------------------------------------
# 快速测试
# ------------------------------------------------------------------

if __name__ == "__main__":
    pub = WechatMPPublisher()
    state = pub.get_agent_state()
    print(f"配置状态: {json.dumps(state, ensure_ascii=False, indent=2)}")

    if state["ready"]:
        print("\n已就绪，可以发布文章")
    else:
        if not state["configured"]:
            print("\n未配置: 请在 .env 中设置 WECHAT_APPID 和 WECHAT_SECRET")
        if not state["deps_installed"]:
            print("\n缺少依赖: pip install wechatpy cryptography mistune pyyaml Pillow requests")
