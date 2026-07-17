#!/usr/bin/env python3
"""
微信公众号发布基类。
凭证优先从 Skill 本地 data/credentials.yaml 读取，
若本地未配置则回退到 secrets-vault。
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Optional


SKILL_DIR = Path(__file__).resolve().parent.parent.parent
CREDENTIALS_PATH = SKILL_DIR / "data" / "credentials.yaml"
SECRETS_SCRIPT = os.path.expanduser(
    "~/.cursor/skills/secrets-vault/scripts/get_secret.py"
)


class PublishResult:
    """Standardized publish result."""

    def __init__(self, status, message="", draft_id=None, publish_id=None, url=None):
        self.status = status  # "success", "draft_created", "error"
        self.message = message
        self.draft_id = draft_id
        self.publish_id = publish_id
        self.url = url

    def to_dict(self):
        return {
            k: v for k, v in {
                "status": self.status,
                "message": self.message,
                "draft_id": self.draft_id,
                "publish_id": self.publish_id,
                "url": self.url,
            }.items() if v is not None
        }

    def __str__(self):
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class WeChatPublisherBase:
    """Base class providing workspace I/O and credential access for WeChat publishing."""

    platform_id = "wechat"
    platform_name = "微信公众号"
    IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}

    def __init__(self, workspace_path: str):
        self.workspace_path = Path(workspace_path)
        self.output_dir = self.workspace_path / "Output" / self.platform_id

    def get_credentials(self, namespace: str = "wechat_mp") -> dict:
        """Retrieve credentials with fallback chain:
        1. Skill-local data/credentials.yaml
        2. secrets-vault (legacy fallback)
        """
        creds = self._load_local_credentials(namespace)
        if creds:
            return creds
        return self._load_secrets_vault(namespace)

    @staticmethod
    def _load_local_credentials(namespace: str) -> Optional[dict]:
        """Read credentials from Skill-local YAML config."""
        if not CREDENTIALS_PATH.exists():
            return None
        try:
            import yaml
            with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            section = data.get(namespace, {})
            if section.get("app_id") and section.get("app_secret"):
                return section
            return None
        except Exception:
            return None

    @staticmethod
    def _load_secrets_vault(namespace: str) -> dict:
        """Fallback: retrieve credentials from secrets-vault."""
        try:
            result = subprocess.run(
                ["python3", SECRETS_SCRIPT, namespace],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"secrets-vault error: {result.stderr.strip()}"
                )
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            raise RuntimeError(
                f"Invalid JSON from secrets-vault for namespace '{namespace}'"
            )
        except FileNotFoundError:
            raise RuntimeError(
                "credentials not configured. "
                "Fill data/credentials.yaml or install secrets-vault skill."
            )

    def load_metadata(self) -> dict:
        """Load platform metadata.yaml."""
        meta_path = self.output_dir / "metadata.yaml"
        if not meta_path.exists():
            raise FileNotFoundError(f"metadata.yaml not found at {meta_path}")
        import yaml
        with open(meta_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)

    def load_article_html(self) -> str:
        """Load the HTML article file."""
        html_path = self.output_dir / "article.html"
        if not html_path.exists():
            md_path = self.output_dir / "article.md"
            if md_path.exists():
                raise FileNotFoundError(
                    f"article.html not found (article.md exists — "
                    f"run md_to_styled_html.py first)"
                )
            raise FileNotFoundError(f"No article file found in {self.output_dir}")
        with open(html_path, "r", encoding="utf-8") as f:
            return f.read()

    def get_cover_path(self, metadata: dict) -> Optional[Path]:
        """Resolve cover image path from metadata."""
        cover_info = metadata.get("medias", {}).get("cover", {})
        rel_path = cover_info.get("path")
        if not rel_path:
            return None
        cover = self.output_dir / rel_path
        if cover.exists() and cover.suffix.lower() in self.IMAGE_EXTS:
            return cover
        return None

    def update_metadata(self, publish_record: dict):
        """Append publish record to metadata.yaml."""
        import yaml
        meta_path = self.output_dir / "metadata.yaml"
        meta = self.load_metadata()
        if "publish_records" not in meta:
            meta["publish_records"] = []
        meta["publish_records"].append(publish_record)
        with open(meta_path, "w", encoding="utf-8") as f:
            yaml.dump(meta, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
