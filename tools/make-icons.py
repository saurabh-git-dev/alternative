"""Draws the app icons in public/icons/ (the "T" mark from the favicon).

Run from the repo root: python3 tools/make-icons.py  (needs Pillow)
"""
from PIL import Image, ImageDraw

ACCENT = (79, 70, 229, 255)  # #4f46e5, same as the favicon
# The favicon's "T" on its 32×32 grid: M8 8h16v4h-6v14h-4V12H8z
T = [(8, 8), (24, 8), (24, 12), (18, 12), (18, 26), (14, 26), (14, 12), (8, 12)]


def icon(size: int, maskable: bool) -> Image.Image:
    scale = 4  # draw big, then downsample for smooth edges
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # Full-bleed background; the mark shrinks into the 80% safe zone.
        d.rectangle((0, 0, s, s), fill=ACCENT)
        unit, offset = s * 0.7 / 32, s * 0.15
    else:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 8 / 32, fill=ACCENT)
        unit, offset = s / 32, 0
    d.polygon([(offset + x * unit, offset + y * unit) for x, y in T], fill='white')
    return img.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    icon(size, False).save(f'public/icons/icon-{size}.png', optimize=True)
    icon(size, True).save(f'public/icons/maskable-{size}.png', optimize=True)
# iOS ignores the manifest icons and rounds the corners itself.
icon(180, True).convert('RGB').save('public/icons/apple-touch-icon.png', optimize=True)
