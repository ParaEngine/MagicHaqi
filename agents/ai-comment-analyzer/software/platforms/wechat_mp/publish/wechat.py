#!/usr/bin/env python3
"""
微信公众号发布器：认证、图片上传、草稿创建、文章发布。
从 content-publisher 独立复制，避免跨 Skill 耦合。
"""

import json
import re
import time
from pathlib import Path

import requests

from .base import WeChatPublisherBase, PublishResult

API_BASE = "https://api.weixin.qq.com/cgi-bin"


class WeChatPublisher(WeChatPublisherBase):
    """WeChat Official Account publisher using official API.

    Uses wechatpy SDK for authentication and media upload.
    Uses direct HTTP requests for draft/freepublish APIs.
    """

    HTML_ENTITY_REPLACEMENTS = {
        "&ldquo;": "\u201c",
        "&rdquo;": "\u201d",
        "&lsquo;": "\u2018",
        "&rsquo;": "\u2019",
        "&rarr;": "\u2192",
        "&mdash;": "\u2014",
        "&ndash;": "\u2013",
        "&hellip;": "\u2026",
        "&#8220;": "\u201c",
        "&#8221;": "\u201d",
        "&#8216;": "\u2018",
        "&#8217;": "\u2019",
        "&#8594;": "\u2192",
        "&#8212;": "\u2014",
        "&#8211;": "\u2013",
        "&#8230;": "\u2026",
        "&#160;": " ",
        "&nbsp;": " ",
        "&#x201C;": "\u201c",
        "&#x201D;": "\u201d",
        "&#x2018;": "\u2018",
        "&#x2019;": "\u2019",
        "&#x2192;": "\u2192",
        "&#x2014;": "\u2014",
        "&#x2013;": "\u2013",
        "&#x2026;": "\u2026",
        "&#xA0;": " ",
    }

    def __init__(self, workspace_path: str):
        super().__init__(workspace_path)
        self._client = None
        self._access_token = None

    def _ensure_deps(self):
        try:
            from wechatpy import WeChatClient  # noqa: F401
        except ImportError:
            raise RuntimeError(
                "wechatpy not installed. Run: pip install wechatpy cryptography"
            )

    def authenticate(self) -> bool:
        self._ensure_deps()
        from wechatpy import WeChatClient

        creds = self.get_credentials("wechat_mp")
        app_id = creds.get("app_id")
        app_secret = creds.get("app_secret")

        if not app_id or not app_secret:
            raise RuntimeError(
                "wechat_mp credentials incomplete. "
                "Need app_id and app_secret in secrets-vault."
            )

        self._client = WeChatClient(app_id, app_secret)

        try:
            token = self._client.fetch_access_token()
            self._access_token = token.get("access_token")
            return True
        except Exception as e:
            raise RuntimeError(f"WeChat authentication failed: {e}")

    def _api_post(self, path: str, data: dict) -> dict:
        """POST to WeChat API. Must use ensure_ascii=False to preserve CJK."""
        url = f"{API_BASE}/{path}?access_token={self._access_token}"
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        resp = requests.post(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("errcode", 0) != 0:
            raise RuntimeError(
                f"WeChat API error: [{result.get('errcode')}] {result.get('errmsg')}"
            )
        return result

    @staticmethod
    def _truncate_utf8(text: str, max_bytes: int) -> str:
        if not text:
            return text
        encoded = text.encode("utf-8")
        if len(encoded) <= max_bytes:
            return text
        truncated = encoded[:max_bytes]
        return truncated.decode("utf-8", errors="ignore").rstrip()

    @staticmethod
    def _truncate_chars(text: str, max_chars: int) -> str:
        if not text or len(text) <= max_chars:
            return text
        return text[:max_chars]

    def _validate_fields(self, title: str, author: str, digest: str):
        """Validate and truncate fields to WeChat API limits.

        title: <= 64 bytes UTF-8, author: <= 16 chars, digest: <= 120 bytes UTF-8
        """
        new_title = self._truncate_utf8(title, 64)
        new_author = self._truncate_chars(author, 16)
        new_digest = self._truncate_utf8(digest, 120)

        if new_title != title:
            print(f"  ⚠️ 标题截断: {len(title.encode('utf-8'))}B -> 64B")
        if new_author != author:
            print(f"  ⚠️ 作者截断: {len(author)}字 -> 16字")
        if new_digest != digest:
            print(f"  ⚠️ 摘要截断: {len(digest.encode('utf-8'))}B -> 120B")

        return new_title, new_author, new_digest

    def upload_image(self, image_path: Path) -> str:
        """Upload an image to WeChat CDN for article content."""
        if not self._client:
            self.authenticate()
        with open(image_path, "rb") as f:
            result = self._client.media.upload_mass_image(f)
        if isinstance(result, str):
            return result
        elif isinstance(result, dict) and "url" in result:
            return result["url"]
        raise RuntimeError(f"Unexpected uploadimg response: {result}")

    def upload_cover(self, image_path: Path) -> str:
        """Upload a cover image as permanent material. Returns thumb_media_id."""
        if not self._client:
            self.authenticate()
        with open(image_path, "rb") as f:
            result = self._client.material.add("image", f)
        if isinstance(result, dict) and "media_id" in result:
            return result["media_id"]
        raise RuntimeError(f"Unexpected cover upload response: {result}")

    def _upload_external_image(self, url: str) -> str:
        """Download external image and re-upload to WeChat CDN."""
        import io
        from urllib.parse import unquote, urlparse

        if not self._client:
            self.authenticate()

        resp = requests.get(url, timeout=30)
        resp.raise_for_status()

        parsed = urlparse(url)
        filename = unquote(parsed.path.split("/")[-1]) or "image.jpg"

        file_obj = io.BytesIO(resp.content)
        file_obj.name = filename

        result = self._client.media.upload_mass_image(file_obj)
        if isinstance(result, str):
            return result
        elif isinstance(result, dict) and "url" in result:
            return result["url"]
        raise RuntimeError(f"Unexpected uploadimg response: {result}")

    def _replace_images_in_html(self, html: str) -> str:
        """Ensure all images in HTML are hosted on WeChat CDN.

        Handles: mmbiz.qpic.cn (skip), external HTTP (re-upload), local paths (upload).
        """
        img_pattern = re.compile(
            r'<img\s+[^>]*src=["\']([^"\']+)["\']', re.IGNORECASE
        )
        matches = img_pattern.findall(html)
        replaced = 0
        skipped = 0

        for src in matches:
            if "mmbiz.qpic.cn" in src:
                skipped += 1
                continue

            if src.startswith("http://") or src.startswith("https://"):
                try:
                    wx_url = self._upload_external_image(src)
                    html = html.replace(src, wx_url)
                    replaced += 1
                    short_src = src[:60] + "..." if len(src) > 60 else src
                    print(f"  Uploaded: {short_src}")
                    print(f"       -> {wx_url[:60]}...")
                except Exception as e:
                    print(f"  Warning: Failed to upload external image: {e}")
                continue

            local_path = self.output_dir / src
            if local_path.exists():
                try:
                    wx_url = self.upload_image(local_path)
                    html = html.replace(src, wx_url)
                    replaced += 1
                    print(f"  Uploaded: {local_path.name} -> {wx_url[:60]}...")
                except Exception as e:
                    print(f"  Warning: Failed to upload {local_path.name}: {e}")
            else:
                print(f"  Warning: Image not found: {local_path}")

        print(f"  共处理 {replaced} 张图片（跳过 {skipped} 张已在微信 CDN）")
        return html

    def _normalize_html_entities(self, html: str) -> str:
        for entity, char in self.HTML_ENTITY_REPLACEMENTS.items():
            html = html.replace(entity, char)
        return html

    def create_draft(self, title: str, content: str, metadata: dict) -> PublishResult:
        """Create a draft article via POST /cgi-bin/draft/add."""
        if not self._access_token:
            self.authenticate()

        raw_author = metadata.get("author", "")
        raw_digest = metadata.get("digest", "")
        safe_title, safe_author, safe_digest = self._validate_fields(
            title, raw_author, raw_digest
        )

        content = self._normalize_html_entities(content)
        article = {"title": safe_title, "content": content, "digest": safe_digest}
        if safe_author:
            article["author"] = safe_author

        thumb_media_id = metadata.get("thumb_media_id")
        if thumb_media_id:
            article["thumb_media_id"] = thumb_media_id
        if metadata.get("content_source_url"):
            article["content_source_url"] = metadata["content_source_url"]
        if metadata.get("need_open_comment"):
            article["need_open_comment"] = 1

        try:
            result = self._api_post("draft/add", {"articles": [article]})
            media_id = result.get("media_id", "")
            return PublishResult(
                status="draft_created",
                message=f"Draft created successfully. media_id={media_id}",
                draft_id=media_id,
            )
        except Exception as e:
            return PublishResult(status="error", message=f"Failed to create draft: {e}")

    def publish(self, draft_id: str) -> PublishResult:
        """Publish a draft via POST /cgi-bin/freepublish/submit."""
        if not self._access_token:
            self.authenticate()
        try:
            result = self._api_post("freepublish/submit", {"media_id": draft_id})
            publish_id = str(result.get("publish_id", ""))
            return PublishResult(
                status="publishing",
                message=f"Publish submitted. publish_id={publish_id}.",
                publish_id=publish_id,
                draft_id=draft_id,
            )
        except Exception as e:
            return PublishResult(
                status="error", message=f"Failed to publish: {e}", draft_id=draft_id
            )

    def get_status(self, publish_id: str) -> PublishResult:
        """Check publish status via POST /cgi-bin/freepublish/get."""
        if not self._access_token:
            self.authenticate()
        try:
            result = self._api_post("freepublish/get", {"publish_id": publish_id})
            ps = result.get("publish_status", -1)
            if ps == 0:
                items = result.get("article_detail", {}).get("item", [])
                url = items[0].get("article_url", "") if items else ""
                return PublishResult(
                    status="success", message="Published.", publish_id=publish_id, url=url
                )
            elif ps == 1:
                return PublishResult(
                    status="publishing", message="Still publishing.", publish_id=publish_id
                )
            else:
                return PublishResult(
                    status="error",
                    message=f"Publish failed at article index {ps - 2 if ps > 1 else 0}.",
                    publish_id=publish_id,
                )
        except Exception as e:
            return PublishResult(
                status="error", message=f"Failed to get status: {e}", publish_id=publish_id
            )

    def full_publish_flow(self, auto_publish: bool = False) -> PublishResult:
        """Execute the complete publish workflow (6 steps)."""
        print(f"\n{'='*50}")
        print("微信公众号发布流程")
        print(f"{'='*50}\n")

        print("[1/6] 认证中...")
        self.authenticate()
        print("  ✅ 认证成功\n")

        print("[2/6] 加载元数据...")
        meta = self.load_metadata()
        article_meta = meta.get("article", {})
        title = article_meta.get("title", "Untitled")
        digest = article_meta.get("digest", "")
        author = meta.get("author", {}).get("name", "")
        print(f"  标题: {title}")
        print(f"  摘要: {digest}")
        print(f"  作者: {author}\n")

        print("[3/6] 加载 HTML 文章...")
        html = self.load_article_html()
        print(f"  HTML 长度: {len(html)} 字符\n")

        print("[4/6] 上传文章内图片到微信 CDN...")
        html = self._replace_images_in_html(html)
        print("  ✅ 图片处理完成\n")

        print("[5/6] 上传封面并创建草稿...")
        thumb_media_id = None
        cover = self.get_cover_path(meta)
        if cover:
            try:
                thumb_media_id = self.upload_cover(cover)
                print(f"  封面: {cover.name} -> {thumb_media_id[:20]}...")
            except Exception as e:
                print(f"  Warning: 封面上传失败: {e}（将使用默认封面）")
        else:
            print("  ⚠️ 未指定封面，跳过封面上传")

        draft_result = self.create_draft(
            title=title,
            content=html,
            metadata={"digest": digest, "author": author, "thumb_media_id": thumb_media_id},
        )
        print(f"  {draft_result.message}\n")

        if draft_result.status == "error":
            return draft_result

        if auto_publish and draft_result.draft_id:
            print("[6/6] 发布草稿...")
            pub_result = self.publish(draft_result.draft_id)
            print(f"  {pub_result.message}\n")
            self.update_metadata({
                "platform": self.platform_id,
                "action": "published",
                "draft_id": draft_result.draft_id,
                "publish_id": pub_result.publish_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            })
            return pub_result
        else:
            print("[6/6] 草稿已创建，跳过发布（需用户确认）\n")
            self.update_metadata({
                "platform": self.platform_id,
                "action": "draft_created",
                "draft_id": draft_result.draft_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            })
            return draft_result
