"""Builds the player avatars from the source pictures in /avatar (gitignored: the originals stay local).

    python web/scripts/make_avatars.py

Writes web/public/avatars/<index>.webp, 256x256, which Vite copies into the build as /avatars/<index>.webp.

The INDEX is what a phone sends when it joins and what the contract stores for the player, so the
list below is data: append new avatars at the end, never reorder or remove one. The game has five
slots; the last two are still being drawn.

Needs Pillow. SVG sources are rasterised with headless Chrome (set CHROME if it is not at the default
Windows path), because Pillow cannot read SVG.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "avatar"
OUT = ROOT / "web" / "public" / "avatars"
SIZE = 256
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")

# the app's own colours, for sources that come without a background
BACKDROP_TOP = (255, 46, 158)
BACKDROP_BOTTOM = (43, 15, 82)


@dataclass(frozen=True)
class Avatar:
    source: str
    # square crop in the source's own pixels (left, top, right, bottom), centred on the face
    crop: tuple[int, int, int, int]
    # 'cartoon' gives a photo the same drawn feel as the illustrated avatars
    cartoon: bool = False
    note: str = ""


AVATARS: list[Avatar] = [
    Avatar("pinault.jpg", (100, 80, 760, 740), cartoon=True, note="Martin, used with his permission"),
    Avatar("image.png", (240, 0, 960, 720), note="the general, drawn by a friend of the team"),
    Avatar("photo_1_medium.svg", (100, 0, 700, 600), note="traced portrait, drawn by a friend of the team"),
]


def rasterise_svg(path: Path) -> Image.Image:
    """Chrome renders the SVG at its own size on a transparent page."""
    if not Path(CHROME).exists():
        sys.exit(f"cannot rasterise {path.name}: Chrome not found at {CHROME} (set CHROME)")
    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / "svg.png"
        head = path.read_text(encoding="utf-8")[:2000]
        width = int(head.split('width="')[1].split('"')[0])
        height = int(head.split('height="')[1].split('"')[0])
        subprocess.run(
            [
                CHROME,
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                f"--user-data-dir={Path(tmp) / 'profile'}",
                f"--window-size={width},{height}",
                "--default-background-color=00000000",
                f"--screenshot={shot}",
                path.resolve().as_uri(),
            ],
            check=True,
            capture_output=True,
            timeout=60,
        )
        return Image.open(shot).convert("RGBA").copy()


def backdrop(size: tuple[int, int]) -> Image.Image:
    """A vertical magenta-to-purple wash, the lobby's colours."""
    width, height = size
    gradient = Image.new("RGBA", size)
    draw = ImageDraw.Draw(gradient)
    for y in range(height):
        t = y / max(1, height - 1)
        colour = tuple(round(a + (b - a) * t) for a, b in zip(BACKDROP_TOP, BACKDROP_BOTTOM))
        draw.line([(0, y), (width, y)], fill=(*colour, 255))
    return gradient


def cartoon(image: Image.Image) -> Image.Image:
    """The same light pass as the mascot's face (face.ts): smooth, posterise, lift colour and edges."""
    out = image.convert("RGB")
    for _ in range(3):
        out = out.filter(ImageFilter.MedianFilter(3))
    out = out.filter(ImageFilter.SMOOTH)
    out = ImageOps.posterize(out, 5)
    out = ImageEnhance.Color(out).enhance(1.20)
    out = ImageEnhance.Brightness(out).enhance(1.03)
    out = ImageEnhance.Contrast(out).enhance(1.10)
    return ImageEnhance.Sharpness(out).enhance(1.30)


def build(index: int, avatar: Avatar) -> Path:
    path = SOURCES / avatar.source
    if not path.exists():
        sys.exit(f"missing source picture: {path}")
    image = rasterise_svg(path) if path.suffix.lower() == ".svg" else Image.open(path).convert("RGBA")

    left, top, right, bottom = avatar.crop
    if right - left != bottom - top:
        sys.exit(f"{avatar.source}: crop must be square, got {right - left}x{bottom - top}")
    if left < 0 or top < 0 or right > image.width or bottom > image.height:
        sys.exit(f"{avatar.source}: crop {avatar.crop} falls outside the {image.width}x{image.height} picture")
    image = image.crop(avatar.crop).resize((SIZE * 3 // 2, SIZE * 3 // 2), Image.Resampling.LANCZOS)

    # anything transparent sits on the app's own colours instead of turning black
    if image.getextrema()[3][0] < 255:
        image = Image.alpha_composite(backdrop(image.size), image)
    image = cartoon(image) if avatar.cartoon else image.convert("RGB")

    image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{index}.webp"
    image.save(target, "WEBP", quality=82, method=6)
    return target


def main() -> None:
    for index, avatar in enumerate(AVATARS):
        target = build(index, avatar)
        print(f"{index}: {avatar.source:<22} -> {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KiB)  {avatar.note}")


if __name__ == "__main__":
    main()
