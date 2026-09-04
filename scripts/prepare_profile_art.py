from pathlib import Path

from PIL import Image


ASSET_DIR = Path(__file__).resolve().parents[1] / "assets"
OUTPUT_DIR = ASSET_DIR / "ui" / "profile"


def save_webp(image: Image.Image, name: str) -> None:
    path = OUTPUT_DIR / name
    image.save(path, "WEBP", lossless=True, method=6)
    alpha_bbox = image.getchannel("A").getbbox()
    print(f"{path.name}: {image.width}x{image.height}, {path.stat().st_size} bytes, alpha={alpha_bbox}")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    pet_frame = Image.open(ASSET_DIR / "cc2.png").convert("RGBA")
    pet_frame.thumbnail((720, 720), Image.Resampling.LANCZOS)
    save_webp(pet_frame, "profile-pet-frame.webp")

    info_frames = Image.open(ASSET_DIR / "cc4.png").convert("RGBA")
    for index, (top, bottom) in enumerate(((0, 267), (267, 544), (544, info_frames.height)), 1):
        save_webp(
            info_frames.crop((0, top, info_frames.width, bottom)),
            f"profile-info-frame-{index}.webp",
        )

    companion_status_frame = Image.open(ASSET_DIR / "cc5.png").convert("RGBA")
    companion_status_frame.thumbnail((720, 720), Image.Resampling.LANCZOS)
    save_webp(companion_status_frame, "profile-companion-status-frame.webp")


if __name__ == "__main__":
    main()