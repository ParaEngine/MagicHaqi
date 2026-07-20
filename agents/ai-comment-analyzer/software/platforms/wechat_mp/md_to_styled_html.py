#!/usr/bin/env python3
"""
Markdown → WeChat-styled HTML converter with configurable themes.
Produces inline-CSS HTML compatible with WeChat Official Account editor.
"""

import argparse
import json
import os
import re
import sys
import webbrowser
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
THEMES_DIR = SCRIPT_DIR / "themes"
DEFAULT_THEME = "tech-digest"


def load_theme(theme_name: str) -> dict:
    """Load theme configuration and CSS from themes directory."""
    import yaml

    theme_dir = THEMES_DIR / theme_name
    if not theme_dir.exists():
        available = [d.name for d in THEMES_DIR.iterdir() if d.is_dir()]
        raise FileNotFoundError(
            f"Theme '{theme_name}' not found. Available: {', '.join(available)}"
        )

    config_path = theme_dir / "theme.yaml"
    css_path = theme_dir / "theme.css"

    config = {}
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}

    css = ""
    if css_path.exists():
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

    return {"name": theme_name, "config": config, "css": css}


def parse_frontmatter(text: str) -> tuple:
    """Extract YAML frontmatter and body from markdown text."""
    import yaml

    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                meta = yaml.safe_load(parts[1]) or {}
                return meta, parts[2].strip()
            except yaml.YAMLError:
                pass
    return {}, text


def render_markdown_to_html(md_text: str, theme: dict) -> str:
    """Convert markdown text to themed HTML string.

    Uses mistune 3.x HTMLRenderer which receives pre-rendered strings.
    """
    import mistune
    from mistune.renderers.html import HTMLRenderer
    from pygments import highlight as pyg_highlight
    from pygments.formatters import HtmlFormatter
    from pygments.lexers import get_lexer_by_name, guess_lexer

    config = theme["config"]
    colors = config.get("colors", {})

    primary = colors.get("primary", "#667eea")
    secondary = colors.get("secondary", "#764ba2")
    accent = colors.get("accent", "#f093fb")
    text_color = colors.get("text", "#2d3748")
    text_secondary = colors.get("text_secondary", "#718096")
    bg_code = colors.get("bg_code", "#1a1a2e")
    bg_code_inline = colors.get("bg_code_inline", "#f0f4f8")
    bg_blockquote = colors.get("bg_blockquote", "#f7fafc")
    link_color = colors.get("link", "#667eea")
    bold_highlight = colors.get("bold_highlight", "#fef3c7")
    heading_colors = colors.get("headings", [primary, secondary, accent])

    typo = config.get("typography", {})
    font_size = typo.get("font_size", 15)
    line_height = typo.get("line_height", 1.85)
    letter_spacing = typo.get("letter_spacing", 0.3)

    section_icons = config.get("section_icons", [
        "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"
    ])

    formatter = HtmlFormatter(
        nowrap=True, style=config.get("code_style", "monokai")
    )

    h2_counter = [0]
    footnotes = []
    footnote_idx = [0]

    class StyledRenderer(HTMLRenderer):

        def text(self, text: str) -> str:
            return text

        def emphasis(self, text: str) -> str:
            return f'<em style="font-style:italic;color:{text_secondary};">{text}</em>'

        def strong(self, text: str) -> str:
            return (
                f'<strong style="font-weight:700;color:{text_color};'
                f'background:linear-gradient(transparent 60%,{bold_highlight} 60%);">'
                f'{text}</strong>'
            )

        def link(self, text: str, url: str, title=None) -> str:
            if url.startswith("http"):
                footnote_idx[0] += 1
                idx = footnote_idx[0]
                footnotes.append((idx, text, url))
                return (
                    f'{text}'
                    f'<sup style="font-size:10px;color:{link_color};'
                    f'vertical-align:super;">[{idx}]</sup>'
                )
            return f'<a style="color:{link_color};text-decoration:none;" href="{url}">{text}</a>'

        def image(self, text: str, url: str, title=None) -> str:
            caption = ""
            if text:
                caption = (
                    f'<figcaption style="font-size:12px;color:{text_secondary};'
                    f'margin-top:6px;">{text}</figcaption>'
                )
            return (
                f'<figure style="margin:20px 0;text-align:center;">'
                f'<img src="{url}" alt="{text}" '
                f'style="max-width:100%;border-radius:8px;" />'
                f'{caption}</figure>'
            )

        def codespan(self, text: str) -> str:
            return (
                f'<code style="background:{bg_code_inline};color:#e53e3e;'
                f'padding:2px 6px;border-radius:4px;font-size:13px;'
                f"font-family:'SF Mono',Menlo,monospace;\">{text}</code>"
            )

        def paragraph(self, text: str) -> str:
            return (
                f'<p style="margin:0 0 18px;font-size:{font_size}px;'
                f'line-height:{line_height};color:{text_color};'
                f'letter-spacing:{letter_spacing}px;text-align:justify;">'
                f'{text}</p>\n'
            )

        def heading(self, text: str, level: int, **attrs) -> str:
            if level == 1:
                return ""

            if level == 2:
                idx = h2_counter[0]
                h2_counter[0] += 1
                icon = section_icons[idx % len(section_icons)] if section_icons else ""
                hcolor = heading_colors[idx % len(heading_colors)] if heading_colors else primary
                return (
                    f'<h2 style="margin:32px 0 16px;padding:0 0 10px;'
                    f'font-size:20px;font-weight:700;color:{hcolor};'
                    f'border-bottom:2px solid {hcolor};line-height:1.4;">'
                    f'{icon} {text}</h2>\n'
                )

            if level == 3:
                return (
                    f'<h3 style="margin:24px 0 12px;font-size:17px;'
                    f'font-weight:600;color:{text_color};line-height:1.4;">'
                    f'▎ {text}</h3>\n'
                )

            return (
                f'<h{level} style="margin:20px 0 10px;font-size:{18-level}px;'
                f'font-weight:600;color:{text_color};">{text}</h{level}>\n'
            )

        def block_code(self, code: str, info=None, **attrs) -> str:
            lang = info.split()[0] if info else ""

            try:
                if lang:
                    lexer = get_lexer_by_name(lang)
                else:
                    lexer = guess_lexer(code)
                highlighted = pyg_highlight(code, lexer, formatter)
            except Exception:
                from html import escape
                highlighted = escape(code)

            lang_label = lang.upper() if lang else "CODE"
            return (
                f'<section style="margin:16px 0;border-radius:8px;overflow:hidden;">'
                f'<div style="background:{bg_code};padding:8px 14px;'
                f"font-size:11px;color:#a0aec0;font-family:'SF Mono',Menlo,monospace;"
                f'letter-spacing:1px;">{lang_label}</div>'
                f'<pre style="background:{bg_code};margin:0;padding:12px 14px 16px;'
                f'overflow-x:auto;font-size:13px;line-height:1.6;'
                f"color:#e2e8f0;font-family:'SF Mono',Menlo,monospace;\">"
                f'{highlighted}</pre></section>\n'
            )

        def block_quote(self, text: str) -> str:
            return (
                f'<blockquote style="margin:16px 0;padding:14px 18px;'
                f'background:{bg_blockquote};border-left:4px solid {link_color};'
                f'border-radius:0 8px 8px 0;font-size:14px;color:{text_secondary};">'
                f'{text}</blockquote>\n'
            )

        def list(self, text: str, ordered: bool, **attrs) -> str:
            tag = "ol" if ordered else "ul"
            list_style = "decimal" if ordered else "disc"
            return (
                f'<{tag} style="margin:12px 0;padding-left:24px;'
                f'list-style-type:{list_style};color:{text_color};'
                f'font-size:{font_size}px;line-height:{line_height};">'
                f'{text}</{tag}>\n'
            )

        def list_item(self, text: str) -> str:
            return f'<li style="margin:6px 0;">{text}</li>\n'

        def thematic_break(self) -> str:
            return (
                f'<hr style="margin:24px auto;border:none;height:1px;'
                f'background:linear-gradient(90deg,transparent,{primary},transparent);" />\n'
            )

        def block_text(self, text: str) -> str:
            return text

        def block_error(self, text: str) -> str:
            return ""

    renderer = StyledRenderer()
    md = mistune.create_markdown(
        renderer=renderer,
        plugins=["table", "strikethrough"],
    )

    def styled_table(r, text):
        return (
            f'<table style="width:100%;border-collapse:collapse;margin:16px 0;'
            f'font-size:14px;">\n{text}</table>\n'
        )

    def styled_table_head(r, text):
        return f"<thead>{text}</thead>\n"

    def styled_table_body(r, text):
        return f"<tbody>{text}</tbody>\n"

    def styled_table_row(r, text):
        return f"<tr>{text}</tr>\n"

    def styled_table_cell(r, text, align=None, head=False):
        align_css = f"text-align:{align};" if align else ""
        if head:
            return (
                f'<th style="padding:10px 12px;background:{primary};'
                f'color:#fff;font-weight:600;border:1px solid #e2e8f0;{align_css}">'
                f'{text}</th>\n'
            )
        return (
            f'<td style="padding:8px 12px;border:1px solid #e2e8f0;{align_css}">'
            f'{text}</td>\n'
        )

    renderer.register("table", styled_table)
    renderer.register("table_head", styled_table_head)
    renderer.register("table_body", styled_table_body)
    renderer.register("table_row", styled_table_row)
    renderer.register("table_cell", styled_table_cell)

    body_html = md(md_text)

    return body_html, footnotes


def build_full_html(
    title: str,
    subtitle: str,
    body_html: str,
    footnotes: list,
    theme: dict,
    meta: dict,
) -> str:
    """Assemble complete HTML document with header, body, footnotes."""
    config = theme["config"]
    colors = config.get("colors", {})
    primary = colors.get("primary", "#667eea")
    secondary = colors.get("secondary", "#764ba2")
    text_color = colors.get("text", "#2d3748")
    text_secondary = colors.get("text_secondary", "#718096")
    link_color = colors.get("link", "#667eea")

    header_cfg = config.get("header", {})
    header_style = header_cfg.get("style", "card")
    header_icon = header_cfg.get("icon", "🚀")
    show_date = header_cfg.get("show_date", True)
    highlight_color = header_cfg.get("highlight_color", colors.get("accent", "#e53e3e"))
    category_color = header_cfg.get("category_color", primary)
    border_color = header_cfg.get("border_color", "#e2e8f0")

    from datetime import datetime
    date_str = meta.get("date", datetime.now().strftime("%Y年%m月%d日"))
    category = meta.get("category", header_cfg.get("default_category", ""))
    author = meta.get("author", "")
    source = meta.get("source", "")

    # Apply {{highlight}} markers in title: {{text}} → colored text
    import re as _re
    display_title = title
    if "{{" in display_title:
        display_title = _re.sub(
            r"\{\{(.+?)\}\}",
            f'<span style="color:{highlight_color};">' r"\1" "</span>",
            display_title,
        )

    if header_style == "gradient":
        gradient_start = header_cfg.get("gradient_start", primary)
        gradient_end = header_cfg.get("gradient_end", secondary)
        header_html = (
            f'<section style="background:linear-gradient(135deg,{gradient_start},{gradient_end});'
            f'padding:28px 24px;border-radius:12px;margin-bottom:24px;text-align:center;">'
            f'<div style="font-size:28px;margin-bottom:8px;">{header_icon}</div>'
            f'<h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff;'
            f'line-height:1.4;letter-spacing:0.5px;">{display_title}</h1>'
        )
        if subtitle:
            header_html += (
                f'<p style="margin:0 0 6px;font-size:14px;color:rgba(255,255,255,0.85);'
                f'line-height:1.5;">{subtitle}</p>'
            )
        if show_date:
            header_html += (
                f'<p style="margin:0;font-size:12px;color:rgba(255,255,255,0.7);">'
                f'{date_str}</p>'
            )
        header_html += "</section>\n"
    else:
        # "card" style — white background, category tag, editorial feel
        header_html = (
            f'<section style="border-radius:12px;'
            f'padding:32px 24px 24px;margin-bottom:24px;text-align:center;background:#fff;">'
        )
        if category:
            header_html += (
                f'<p style="margin:0 0 18px;font-size:13px;color:{category_color};'
                f'font-weight:600;letter-spacing:2px;">'
                f'{header_icon} {category}</p>'
            )
        header_html += (
            f'<h1 style="margin:0 0 14px;font-size:24px;font-weight:800;color:{text_color};'
            f'line-height:1.6;letter-spacing:0.5px;">{display_title}</h1>'
        )
        if subtitle:
            header_html += (
                f'<p style="margin:0 0 14px;font-size:14px;color:{text_secondary};'
                f'line-height:1.5;">{subtitle}</p>'
            )
        # Author / source / date line
        info_parts = []
        if author:
            info_parts.append(author)
        if source:
            info_parts.append(source)
        if show_date:
            info_parts.append(date_str)
        if info_parts:
            info_line = " × ".join(info_parts)
            header_html += (
                f'<p style="margin:0;font-size:12px;color:#a0aec0;letter-spacing:0.5px;">'
                f'{info_line}</p>'
            )
        header_html += "</section>\n"

    footnote_html = ""
    if footnotes:
        items = ""
        for idx, label, url in footnotes:
            items += (
                f'<p style="margin:4px 0;font-size:12px;color:{text_secondary};'
                f'word-break:break-all;line-height:1.6;">'
                f'<span style="color:{link_color};">[{idx}]</span> '
                f'{label}: {url}</p>'
            )
        footnote_html = (
            f'<section style="margin-top:32px;padding-top:16px;'
            f'border-top:1px solid #e2e8f0;">'
            f'<p style="font-size:13px;font-weight:600;color:{text_secondary};'
            f'margin-bottom:8px;">📎 参考链接</p>'
            f'{items}</section>\n'
        )

    footer_html = ""
    footer_cfg = config.get("footer", {})
    if footer_cfg.get("enabled", True):
        footer_text = footer_cfg.get("text", "")
        footer_html = (
            f'<section style="margin-top:24px;padding:16px;'
            f'background:#f7fafc;border-radius:8px;text-align:center;">'
            f'<p style="margin:0;font-size:12px;color:{text_secondary};">'
            f'{footer_text if footer_text else "— END —"}</p>'
            f'</section>\n'
        )

    full_html = (
        f'<section style="max-width:677px;margin:0 auto;padding:16px;'
        f'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;'
        f'color:{text_color};background:#fff;">\n'
        f'{header_html}\n'
        f'{body_html}\n'
        f'{footnote_html}\n'
        f'{footer_html}\n'
        f'</section>'
    )

    return full_html


def build_preview_html(content_html: str) -> str:
    """Wrap content HTML in a full HTML document for browser preview."""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview</title>
<style>
  body {{ margin: 0; padding: 20px; background: #f0f0f0; }}
  .preview-container {{ max-width: 720px; margin: 0 auto; background: #fff;
    padding: 20px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }}
</style>
</head>
<body>
<div class="preview-container">
{content_html}
</div>
</body>
</html>"""


def convert(
    md_path: str,
    theme_name: str = DEFAULT_THEME,
    output_path: str = None,
    preview: bool = False,
) -> dict:
    """Main conversion entry point. Returns result dict."""

    md_file = Path(md_path)
    if not md_file.exists():
        raise FileNotFoundError(f"Markdown file not found: {md_path}")

    with open(md_file, "r", encoding="utf-8") as f:
        raw = f.read()

    meta, body = parse_frontmatter(raw)
    theme = load_theme(theme_name)

    title = meta.get("title", "")
    if not title:
        h1_match = re.match(r"^#\s+(.+)$", body, re.MULTILINE)
        if h1_match:
            title = h1_match.group(1).strip()
            body = body[h1_match.end():].strip()

    subtitle = meta.get("subtitle", "")

    body_html, footnotes = render_markdown_to_html(body, theme)
    full_html = build_full_html(title, subtitle, body_html, footnotes, theme, meta)

    if not output_path:
        output_path = str(md_file.with_suffix(".html"))

    out = Path(output_path)

    if out.suffix == ".html":
        with open(out, "w", encoding="utf-8") as f:
            f.write(full_html)
    else:
        out = out.with_suffix(".html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(full_html)

    result = {
        "title": title,
        "subtitle": subtitle,
        "author": meta.get("author", ""),
        "date": meta.get("date", ""),
        "theme": theme_name,
        "html_path": str(out.resolve()),
        "html_length": len(full_html),
    }

    if preview:
        preview_html = build_preview_html(full_html)
        preview_path = out.with_name(out.stem + "_preview.html")
        with open(preview_path, "w", encoding="utf-8") as f:
            f.write(preview_html)
        webbrowser.open(f"file://{preview_path.resolve()}")
        result["preview_path"] = str(preview_path.resolve())

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert Markdown to WeChat-styled HTML"
    )
    parser.add_argument("input", help="Input Markdown file path")
    parser.add_argument(
        "-t", "--theme", default=DEFAULT_THEME,
        help=f"Theme name (default: {DEFAULT_THEME})"
    )
    parser.add_argument("-o", "--output", help="Output HTML file path")
    parser.add_argument(
        "-p", "--preview", action="store_true",
        help="Open preview in browser"
    )
    parser.add_argument(
        "--list-themes", action="store_true",
        help="List available themes and exit"
    )

    args = parser.parse_args()

    if args.list_themes:
        if THEMES_DIR.exists():
            themes = [d.name for d in THEMES_DIR.iterdir() if d.is_dir()]
            print("Available themes:")
            for t in sorted(themes):
                marker = " (default)" if t == DEFAULT_THEME else ""
                print(f"  - {t}{marker}")
        else:
            print("No themes directory found.")
        sys.exit(0)

    try:
        result = convert(
            args.input,
            theme_name=args.theme,
            output_path=args.output,
            preview=args.preview,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
