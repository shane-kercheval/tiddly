#!/usr/bin/env python3
"""Build Chrome Web Store image assets from raw popup screenshots.

Usage:
    cd chrome-extension/store-assets
    uv run --with pillow python build.py

Inputs (src/):
    popup-save.png      — Save tab screenshot
    popup-search.png    — Search tab screenshot

Outputs (out/):
    screenshot-save-1280x800.png
    screenshot-search-1280x800.png
    promo-small-440x280.png
    promo-marquee-1400x560.png
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

# Brand palette (sourced from the frontend landing page styles)
BRAND_ORANGE = (240, 144, 64)         # #f09040
BG_SOFT_TOP = (255, 240, 225)         # #fff0e1 — warmer top-left
BG_SOFT_BOT = (255, 255, 255)         # white — bottom-right
INK = (17, 24, 39)                    # gray-900
INK_MUTED = (75, 85, 99)              # gray-600

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(path, size)


def gradient_bg(w: int, h: int, top_left: tuple, bottom_right: tuple) -> Image.Image:
    """Smooth diagonal gradient via 2x2 bilinear upscale — fast and smooth."""
    mid = tuple((a + b) // 2 for a, b in zip(top_left, bottom_right))
    mini = Image.new("RGB", (2, 2))
    mini.putpixel((0, 0), top_left)
    mini.putpixel((1, 0), mid)
    mini.putpixel((0, 1), mid)
    mini.putpixel((1, 1), bottom_right)
    return mini.resize((w, h), Image.BILINEAR)


def round_corners(img: Image.Image, radius: int) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    img.putalpha(mask)
    return img


def drop_shadow(img: Image.Image, offset=(0, 12), blur: int = 30, alpha: int = 60) -> Image.Image:
    """Return a larger RGBA image with `img` placed over a soft drop shadow."""
    img = img.convert("RGBA")
    w, h = img.size
    pad = blur * 2
    canvas_w = w + 2 * pad
    canvas_h = h + 2 * pad

    alpha_mask = img.split()[3]
    shadow = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    shadow_layer = Image.new("RGBA", (w, h), (0, 0, 0, alpha))
    shadow_layer.putalpha(alpha_mask)
    shadow.paste(shadow_layer, (pad + offset[0], pad + offset[1]), shadow_layer)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))

    shadow.alpha_composite(img, (pad, pad))
    return shadow


def prepared_popup(src_path: Path, target_h: int) -> Image.Image:
    """Load popup screenshot, round corners, add drop shadow, scaled to target_h."""
    img = Image.open(src_path).convert("RGBA")
    scale = target_h / img.height
    target_w = int(img.width * scale)
    img = img.resize((target_w, target_h), Image.LANCZOS)
    img = round_corners(img, 16)
    img = drop_shadow(img, offset=(0, 14), blur=30, alpha=70)
    return img


def compose_screenshot(src_path: Path, title: str, sub: str, out_path: Path) -> None:
    """1280x800: portrait popup on left, caption on right."""
    W, H = 1280, 800
    canvas = gradient_bg(W, H, BG_SOFT_TOP, BG_SOFT_BOT).convert("RGBA")

    popup = prepared_popup(src_path, target_h=640)
    left_zone_center_x = W // 4  # center of left quarter-ish (~320)
    popup_x = left_zone_center_x - popup.width // 2 + 40
    popup_y = (H - popup.height) // 2
    canvas.alpha_composite(popup, (popup_x, popup_y))

    draw = ImageDraw.Draw(canvas)
    title_font = font(56, bold=True)
    sub_font = font(24)
    text_x = 720
    # Measure title to vertically center the whole block
    bbox_title = draw.textbbox((0, 0), title, font=title_font)
    title_h = bbox_title[3] - bbox_title[1]
    block_h = title_h + 24 + 32  # title + gap + sub (approx)
    text_y = (H - block_h) // 2 - 10
    draw.text((text_x, text_y), title, fill=INK, font=title_font)
    draw.text((text_x, text_y + title_h + 24), sub, fill=INK_MUTED, font=sub_font)

    # Accent bar under caption
    bar_y = text_y + title_h + 24 + 64
    draw.rectangle((text_x, bar_y, text_x + 56, bar_y + 5), fill=BRAND_ORANGE)

    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"  wrote {out_path.name}")


def compose_promo_small(out_path: Path) -> None:
    """440x280 marketing tile: logo + tagline, no screenshot."""
    W, H = 440, 280
    canvas = gradient_bg(W, H, BG_SOFT_TOP, (255, 232, 209)).convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    title_font = font(38, bold=True)
    sub_font = font(16)
    draw.text((28, 90), "Tiddly Bookmarks", fill=INK, font=title_font)
    draw.text((28, 150), "Save the web. Find it again.", fill=INK_MUTED, font=sub_font)
    draw.rectangle((28, 210, 80, 215), fill=BRAND_ORANGE)

    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"  wrote {out_path.name}")


def compose_promo_marquee(src_path: Path, out_path: Path) -> None:
    """1400x560 marquee: logo + tagline on left, popup on right."""
    W, H = 1400, 560
    canvas = gradient_bg(W, H, BG_SOFT_TOP, BG_SOFT_BOT).convert("RGBA")

    popup = prepared_popup(src_path, target_h=460)
    popup_x = W - popup.width - 60
    popup_y = (H - popup.height) // 2
    canvas.alpha_composite(popup, (popup_x, popup_y))

    draw = ImageDraw.Draw(canvas)
    title_font = font(72, bold=True)
    sub_font = font(28)
    draw.text((100, 200), "Tiddly Bookmarks", fill=INK, font=title_font)
    draw.text((100, 300), "Save the web. Find it again.", fill=INK_MUTED, font=sub_font)
    draw.rectangle((100, 360, 180, 367), fill=BRAND_ORANGE)

    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"  wrote {out_path.name}")


def main() -> None:
    print("Building Chrome Web Store assets...")
    compose_screenshot(
        SRC / "popup-save.png",
        "Save any page",
        "One click. Title, tags, content — all captured.",
        OUT / "screenshot-save-1280x800.png",
    )
    compose_screenshot(
        SRC / "popup-search.png",
        "Search everything",
        "Full-text search across your whole collection.",
        OUT / "screenshot-search-1280x800.png",
    )
    compose_promo_small(OUT / "promo-small-440x280.png")
    compose_promo_marquee(SRC / "popup-save.png", OUT / "promo-marquee-1400x560.png")
    print("Done. Files in chrome-extension/store-assets/out/")


if __name__ == "__main__":
    main()
