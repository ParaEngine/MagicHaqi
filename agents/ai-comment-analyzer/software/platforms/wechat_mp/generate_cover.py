#!/usr/bin/env python3
"""
Auto-generate cover images for WeChat articles using HTML/CSS rendering.

Renders styled HTML templates via Playwright (Chromium) to produce high-quality
900×383 (2.35:1) cover images with gradient backgrounds, rounded inner cards,
and modern typography — inspired by xhs-note-creator's card styling approach.

Usage:
  python3 generate_cover.py article.md -o cover.jpg
  python3 generate_cover.py article.md -t news-minimal -o cover.jpg
  python3 generate_cover.py article.md --style accent-bar -o cover.jpg
  python3 generate_cover.py --metadata metadata.yaml -o cover.jpg
  python3 generate_cover.py --list-styles
"""

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
THEMES_DIR = SCRIPT_DIR / "themes"
DEFAULT_THEME = "tech-digest"

COVER_WIDTH = 900
COVER_HEIGHT = 383

STYLE_PRESETS = {
    "gradient": "渐变背景 + 内卡片 + 居中标题",
    "accent-bar": "深色背景 + 左侧强调条 + 左对齐",
    "split": "左文右色块双栏",
    "minimal": "纯渐变背景 + 大号居中标题",
    "geometric": "浅色渐变 + 几何装饰 + 分类标签",
}


def load_theme_colors(theme_name: str) -> dict:
    import yaml

    config_path = THEMES_DIR / theme_name / "theme.yaml"
    if not config_path.exists():
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    return config.get("colors", {})


def get_colors(theme_name: str) -> dict:
    colors = load_theme_colors(theme_name)
    return {
        "primary": colors.get("primary", "#667eea"),
        "secondary": colors.get("secondary", "#764ba2"),
        "accent": colors.get("accent", "#e53e3e"),
        "text": colors.get("text", "#2d3748"),
        "text_secondary": colors.get("text_secondary", "#718096"),
        "bg_code": colors.get("bg_code", "#1a1a2e"),
    }


def dynamic_title_size(title: str) -> int:
    n = len(title)
    if n <= 10:
        return 36
    if n <= 16:
        return 32
    if n <= 24:
        return 28
    if n <= 32:
        return 24
    return 20


def build_cover_html(
    title: str,
    subtitle: str,
    category: str,
    emoji: str,
    style: str,
    colors: dict,
) -> str:
    W, H = COVER_WIDTH, COVER_HEIGHT
    clean_title = title.replace("{{", "").replace("}}", "")
    title_size = dynamic_title_size(clean_title)

    primary = colors["primary"]
    secondary = colors["secondary"]
    accent = colors["accent"]
    text_color = colors["text"]
    text_secondary = colors["text_secondary"]
    bg_dark = colors["bg_code"]

    FONT_STACK = (
        "'Noto Sans SC','Source Han Sans CN','PingFang SC',"
        "'Microsoft YaHei',-apple-system,sans-serif"
    )

    base_style = f"""
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{ font-family:{FONT_STACK}; width:{W}px; height:{H}px; overflow:hidden; }}
    .cover {{ width:{W}px; height:{H}px; position:relative; overflow:hidden; }}
    """

    if style == "gradient":
        inner_w = int(W * 0.92)
        inner_h = int(H * 0.82)
        inner_left = (W - inner_w) // 2
        inner_top = (H - inner_h) // 2

        style_css = f"""
        .cover {{ background: linear-gradient(135deg, {primary} 0%, {secondary} 100%); }}
        .inner {{
            position:absolute; left:{inner_left}px; top:{inner_top}px;
            width:{inner_w}px; height:{inner_h}px;
            background:#F3F3F3; border-radius:16px;
            display:flex; flex-direction:column; align-items:center; justify-content:center;
            padding:20px 40px;
        }}
        .cat {{
            font-size:12px; font-weight:600; letter-spacing:2px;
            color:{primary}; margin-bottom:10px;
        }}
        .cat-emoji {{ margin-right:4px; }}
        .title {{
            font-weight:900; font-size:{title_size}px; line-height:1.4;
            text-align:center;
            background: linear-gradient(180deg, #111827 0%, #4B5563 100%);
            -webkit-background-clip:text; -webkit-text-fill-color:transparent;
            background-clip:text;
        }}
        .subtitle {{
            font-size:14px; color:#718096; margin-top:8px; text-align:center;
        }}
        """
        body = f"""
        <div class="cover">
            <div class="inner">
                {"<div class='cat'><span class='cat-emoji'>" + emoji + "</span> " + category + "</div>" if category else ""}
                <div class="title">{clean_title}</div>
                {"<div class='subtitle'>" + subtitle + "</div>" if subtitle else ""}
            </div>
        </div>
        """

    elif style == "accent-bar":
        # Chalkboard editorial: dark teal-green textured bg + centered white title + red bar
        accent_bar_h = 8
        accent_bar_w_pct = 55

        style_css = f"""
        .cover {{
            background:
                radial-gradient(ellipse 120% 80% at 30% 40%, rgba(55,85,72,0.4) 0%, transparent 70%),
                radial-gradient(ellipse 100% 90% at 75% 60%, rgba(40,65,55,0.3) 0%, transparent 70%),
                linear-gradient(170deg, #243530 0%, #2a3f38 30%, #2d4a3e 55%, #2b4539 80%, #223330 100%);
        }}

        /* chalkboard grain texture */
        .grain {{
            position:absolute; inset:0; pointer-events:none; opacity:0.06;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
            background-size: 256px 256px;
        }}

        /* subtle vignette */
        .vignette {{
            position:absolute; inset:0; pointer-events:none;
            background: radial-gradient(ellipse 75% 65% at 50% 50%, transparent 50%, rgba(15,25,20,0.45) 100%);
        }}

        .content {{
            position:absolute; inset:0;
            display:flex; flex-direction:column; align-items:center; justify-content:center;
            padding:24px 48px;
        }}

        .cat {{
            font-size:11px; font-weight:500; letter-spacing:3px;
            color:rgba(255,255,255,0.45); text-transform:uppercase;
            margin-bottom:16px;
        }}

        .title {{
            font-weight:900; font-size:{max(title_size + 6, 34)}px; line-height:1.3;
            color:#fff; text-align:center; letter-spacing:1px;
        }}

        .accent-bar {{
            width:{accent_bar_w_pct}%; height:{accent_bar_h}px;
            background:{accent}; margin-top:18px; border-radius:1px;
        }}

        .subtitle {{
            font-size:12px; color:rgba(255,255,255,0.35);
            margin-top:14px; text-align:center; letter-spacing:0.5px; font-weight:300;
        }}
        """
        body = f"""
        <div class="cover">
            <div class="grain"></div>
            <div class="vignette"></div>
            <div class="content">
                {"<div class='cat'>" + category + "</div>" if category else ""}
                <div class="title">{clean_title}</div>
                <div class="accent-bar"></div>
                {"<div class='subtitle'>" + subtitle + "</div>" if subtitle else ""}
            </div>
        </div>
        """

    elif style == "split":
        split_x = int(W * 0.6)
        style_css = f"""
        .cover {{ background:#fff; }}
        .left {{
            position:absolute; left:0; top:0; width:{split_x}px; height:{H}px;
            display:flex; flex-direction:column; justify-content:center;
            padding:40px 40px 40px 48px;
        }}
        .right {{
            position:absolute; left:{split_x}px; top:0; right:0; height:{H}px;
            background: linear-gradient(180deg, {primary} 0%, {secondary} 100%);
        }}
        .right-inner {{
            width:100%; height:100%; display:flex; align-items:center; justify-content:center;
            font-size:64px;
        }}
        .accent-line {{
            position:absolute; left:{split_x}px; bottom:0; right:0; height:5px;
            background:{accent};
        }}
        .cat {{ font-size:12px; font-weight:600; color:{primary}; letter-spacing:2px; margin-bottom:10px; }}
        .title {{
            font-weight:800; font-size:{min(title_size, 30)}px; line-height:1.35; color:{text_color};
        }}
        .subtitle {{ font-size:13px; color:{text_secondary}; margin-top:10px; }}
        """
        body = f"""
        <div class="cover">
            <div class="left">
                {"<div class='cat'>" + category + "</div>" if category else ""}
                <div class="title">{clean_title}</div>
                {"<div class='subtitle'>" + subtitle + "</div>" if subtitle else ""}
            </div>
            <div class="right">
                <div class="right-inner">{emoji if emoji else ""}</div>
            </div>
            <div class="accent-line"></div>
        </div>
        """

    elif style == "minimal":
        style_css = f"""
        .cover {{
            background: linear-gradient(135deg, {primary} 0%, {secondary} 100%);
            display:flex; flex-direction:column; align-items:center; justify-content:center;
            padding:30px 60px;
        }}
        .cat {{
            font-size:12px; font-weight:600; letter-spacing:3px; color:rgba(255,255,255,0.7);
            margin-bottom:14px;
        }}
        .title {{
            font-weight:900; font-size:{title_size + 4}px; line-height:1.35;
            color:#fff; text-align:center;
        }}
        .subtitle {{
            font-size:14px; color:rgba(255,255,255,0.6); margin-top:10px; text-align:center;
        }}
        """
        body = f"""
        <div class="cover">
            {"<div class='cat'>" + emoji + " " + category + "</div>" if category else ""}
            <div class="title">{clean_title}</div>
            {"<div class='subtitle'>" + subtitle + "</div>" if subtitle else ""}
        </div>
        """

    elif style == "geometric":
        inner_w = int(W * 0.92)
        inner_h = int(H * 0.82)
        inner_left = (W - inner_w) // 2
        inner_top = (H - inner_h) // 2

        style_css = f"""
        .cover {{ background: linear-gradient(180deg, #f3f3f3 0%, #f9f9f9 100%); }}
        .deco-top {{ position:absolute; top:0; left:0; right:0; height:5px; background:{accent}; }}
        .deco-bottom {{ position:absolute; bottom:0; left:0; right:0; height:5px; background:{primary}; }}
        .deco-circle1 {{
            position:absolute; top:-30px; right:80px; width:100px; height:100px;
            border-radius:50%; background:{primary}; opacity:0.08;
        }}
        .deco-circle2 {{
            position:absolute; bottom:-20px; left:120px; width:70px; height:70px;
            border-radius:50%; background:{secondary}; opacity:0.1;
        }}
        .deco-circle3 {{
            position:absolute; top:60px; right:200px; width:50px; height:50px;
            border-radius:50%; background:{accent}; opacity:0.06;
        }}
        .inner {{
            position:absolute; left:{inner_left}px; top:{inner_top}px;
            width:{inner_w}px; height:{inner_h}px;
            background:rgba(255,255,255,0.95); border-radius:14px;
            box-shadow:0 4px 20px rgba(0,0,0,0.06);
            display:flex; flex-direction:column; justify-content:center;
            padding:20px 40px;
        }}
        .cat-badge {{
            display:inline-block; background:{primary}; color:#fff;
            font-size:11px; font-weight:600; padding:3px 12px; border-radius:4px;
            letter-spacing:1px; margin-bottom:10px; align-self:flex-start;
        }}
        .title {{
            font-weight:800; font-size:{title_size}px; line-height:1.35; color:{text_color};
        }}
        .subtitle {{ font-size:13px; color:{text_secondary}; margin-top:8px; }}
        """
        body = f"""
        <div class="cover">
            <div class="deco-top"></div>
            <div class="deco-bottom"></div>
            <div class="deco-circle1"></div>
            <div class="deco-circle2"></div>
            <div class="deco-circle3"></div>
            <div class="inner">
                {"<div class='cat-badge'>" + emoji + " " + category + "</div>" if category else ""}
                <div class="title">{clean_title}</div>
                {"<div class='subtitle'>" + subtitle + "</div>" if subtitle else ""}
            </div>
        </div>
        """

    else:
        raise ValueError(f"Unknown style: {style}")

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width={W}, height={H}">
<style>{base_style}{style_css}</style>
</head>
<body>{body}</body>
</html>"""


def auto_select_style(title: str, category: str) -> str:
    title_len = len(title)
    if title_len <= 12:
        return "minimal"
    if category and ("技术" in category or "AI" in category or "科技" in category):
        return "accent-bar"
    if "vs" in title.lower() or "对" in title or "冲突" in title:
        return "split"
    if title_len > 25:
        return "gradient"
    return "geometric"


async def render_html_to_image(html: str, output_path: str):
    from playwright.async_api import async_playwright

    with tempfile.NamedTemporaryFile(
        suffix=".html", mode="w", encoding="utf-8", delete=False
    ) as f:
        f.write(html)
        tmp_path = f.name

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(
                viewport={"width": COVER_WIDTH, "height": COVER_HEIGHT},
                device_scale_factor=2,
            )
            await page.goto(f"file://{tmp_path}")
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(300)

            out = Path(output_path)
            out.parent.mkdir(parents=True, exist_ok=True)
            fmt = "jpeg" if out.suffix.lower() in (".jpg", ".jpeg") else "png"
            await page.screenshot(
                path=str(out), type=fmt, quality=95 if fmt == "jpeg" else None
            )
            await browser.close()
    finally:
        os.unlink(tmp_path)


def generate_cover(
    title: str,
    subtitle: str = "",
    category: str = "",
    emoji: str = "🚀",
    theme_name: str = DEFAULT_THEME,
    style: str = "auto",
    output_path: str = "cover.jpg",
) -> dict:
    colors = get_colors(theme_name)
    if style == "auto":
        style = auto_select_style(title, category)

    html = build_cover_html(title, subtitle, category, emoji, style, colors)
    asyncio.run(render_html_to_image(html, output_path))

    return {
        "style": style,
        "theme": theme_name,
        "size": f"{COVER_WIDTH}x{COVER_HEIGHT}",
        "output_path": str(Path(output_path).resolve()),
        "file_size": os.path.getsize(output_path),
    }


def extract_meta_from_markdown(md_path: str) -> dict:
    import yaml

    with open(md_path, "r", encoding="utf-8") as f:
        raw = f.read()
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            try:
                return yaml.safe_load(parts[1]) or {}
            except Exception:
                pass
    return {}


def extract_meta_from_yaml(yaml_path: str) -> dict:
    import yaml

    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    article = data.get("article", {})
    return {
        "title": article.get("title", ""),
        "subtitle": article.get("subtitle", ""),
        "category": data.get("category", ""),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate cover images for WeChat articles (HTML rendering)"
    )
    parser.add_argument("input", nargs="?", help="Input Markdown file")
    parser.add_argument("--metadata", help="metadata.yaml path")
    parser.add_argument("-t", "--theme", default=DEFAULT_THEME, help="Theme name")
    parser.add_argument(
        "--style",
        default="auto",
        choices=list(STYLE_PRESETS.keys()) + ["auto"],
        help="Visual style preset",
    )
    parser.add_argument("-o", "--output", default="cover.jpg", help="Output image path")
    parser.add_argument("--list-styles", action="store_true", help="List styles and exit")

    args = parser.parse_args()

    if args.list_styles:
        print("Available cover styles:")
        for name, desc in STYLE_PRESETS.items():
            print(f"  - {name}: {desc}")
        print("  - auto: 根据标题长度和分类自动选择")
        sys.exit(0)

    meta = {}
    if args.metadata:
        meta = extract_meta_from_yaml(args.metadata)
    elif args.input:
        meta = extract_meta_from_markdown(args.input)
    else:
        parser.error("Provide an input markdown file or --metadata yaml path")

    title = meta.get("title", "Untitled")
    subtitle = meta.get("subtitle", "")
    category = meta.get("category", "")

    header_cfg = {}
    try:
        import yaml
        theme_yaml = THEMES_DIR / args.theme / "theme.yaml"
        if theme_yaml.exists():
            with open(theme_yaml, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            header_cfg = cfg.get("header", {})
    except Exception:
        pass
    emoji = header_cfg.get("icon", "🚀")

    try:
        result = generate_cover(
            title=title,
            subtitle=subtitle,
            category=category,
            emoji=emoji,
            theme_name=args.theme,
            style=args.style,
            output_path=args.output,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
