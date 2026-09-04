from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
INPUT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "webgames/MagicHaqi/assets/minerals/source/haqi_minerals_6x6.png"
OUTPUT_DIR = ROOT / "webgames/MagicHaqi/assets/minerals"
CONTENT_DIR = ROOT / "webgames/MagicHaqi/content"
CONTENT_FILES = (
    "haqi_minerals_abyssal_echoes.json",
    "haqi_minerals_molten_geocore.json",
    "haqi_minerals_wasteland_punk.json",
    "haqi_minerals_ancient_starcore.json",
)


def find_mineral_boxes(source: Image.Image) -> list[tuple[int, int, int, int]]:
    alpha = np.asarray(source.getchannel("A")) > 8

    def contiguous_ranges(values: np.ndarray) -> list[tuple[int, int]]:
        indices = np.flatnonzero(values)
        groups = np.split(indices, np.where(np.diff(indices) > 1)[0] + 1)
        return [(int(group[0]), int(group[-1]) + 1) for group in groups if group.size]

    row_ranges = contiguous_ranges(alpha.any(axis=1))
    column_ranges = contiguous_ranges(alpha.any(axis=0))
    if len(row_ranges) != 6 or len(column_ranges) != 6:
        raise RuntimeError(f"需要检测到 6 行 x 6 列独立图标，当前为 {len(row_ranges)} 行 x {len(column_ranges)} 列。")

    boxes = [(left, top, right, bottom) for top, bottom in row_ranges for left, right in column_ranges]
    if any(not alpha[top:bottom, left:right].any() for left, top, right, bottom in boxes):
        raise RuntimeError("发现空白图标区间，未生成资源。")
    return boxes


def crop_with_padding(source: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = box
    content_width, content_height = right - left, bottom - top
    canvas = Image.new("RGBA", (max(content_width, content_height) + 64, max(content_width, content_height) + 64))
    icon = source.crop(box)
    offset_x = (canvas.width - icon.width) // 2
    offset_y = (canvas.height - icon.height) // 2
    canvas.alpha_composite(icon, (offset_x, offset_y))
    return canvas.resize((512, 512), Image.Resampling.LANCZOS)


def load_enabled_minerals() -> list[dict[str, str]]:
    packs = [json.loads((CONTENT_DIR / file_name).read_text(encoding="utf-8")) for file_name in CONTENT_FILES]
    minerals = [mineral for pack in packs for mineral in pack.get("minerals", []) if not mineral.get("disabled")]
    if len(minerals) != 36:
        raise RuntimeError(f"需要恰好 36 枚启用矿石，当前为 {len(minerals)} 枚。")
    return minerals


def main() -> None:
    minerals = load_enabled_minerals()
    source = Image.open(INPUT_PATH).convert("RGBA")
    width, height = source.size
    if width != height or width < 6 or height < 6:
        raise RuntimeError(f"源图必须是正方形 6x6 图集，当前为 {width} x {height}。")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    boxes = find_mineral_boxes(source)
    for mineral, box in zip(minerals, boxes):
        output = crop_with_padding(source, box)
        output.save(OUTPUT_DIR / f"{mineral['artKey']}.webp", "WEBP", quality=90, method=2)

    print(f"已按真实透明边界逐个裁切 {len(minerals)} 枚矿石：{width} x {height} -> 36 个 512 x 512 WebP。")


if __name__ == "__main__":
    main()