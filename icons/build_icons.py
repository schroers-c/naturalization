#!/usr/bin/env python3
"""Regenerate PWA icons at exactly 192×192 and 512×512.

Run with the project venv, e.g. ``~/envs/naturalization/bin/python web/icons/build_icons.py``.

Layout targets Android / maskable icons: content stays inside the central safe circle
(~⅔ of the canvas diameter per adaptive-icon guidelines) so circular and squircle masks
do not clip the Swiss cross or the “passed” mark.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

# Swiss red (aligned with manifest theme_color)
RED = (218, 41, 28, 255)
RED_DEEP = (175, 28, 18, 255)
RED_ACCENT = (240, 72, 56, 255)
WHITE = (255, 255, 255, 255)
HIGHLIGHT = (255, 255, 255, 36)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = cy = (size - 1) / 2.0
    # Outer circle: fills the square to the edges (matches round Android launcher masks).
    r_outer = size / 2.0 - 0.5
    # Keep all foreground inside this radius (Android adaptive safe zone ≈ diameter ⅔).
    r_safe = size * (1.0 / 3.0) * 0.92

    def circle_mask() -> Image.Image:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).ellipse(
            (cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer),
            fill=255,
        )
        return m

    outer_mask = circle_mask()

    # Vertical gradient clipped to circle
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    top = RED_ACCENT[:3]
    bottom = RED_DEEP[:3]
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b, 255))
    _, _, _, ga = grad.split()
    grad.putalpha(ImageChops.multiply(ga, outer_mask))
    img = Image.alpha_composite(img, grad)

    # Top gloss (only inside circle)
    gloss = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gloss)
    gw = int(size * 0.78)
    gh = int(size * 0.34)
    gx0 = (size - gw) // 2
    gy0 = max(1, int(size * 0.04))
    gdraw.ellipse((gx0, gy0, gx0 + gw, gy0 + gh), fill=HIGHLIGHT)
    _, _, _, gga = gloss.split()
    gloss.putalpha(ImageChops.multiply(gga, outer_mask))
    img = Image.alpha_composite(img, gloss)

    draw = ImageDraw.Draw(img)

    # Swiss cross: bar tips stay inside r_safe; diagonal corners of bars also inside.
    arm = max(round(size * 0.145), 7)
    half_arm = arm / 2.0
    half_span = math.sqrt(max(r_safe * r_safe - half_arm * half_arm, 0.0))
    half_span_i = int(half_span)

    ix, iy = int(cx), int(cy)
    v_top = iy - half_span_i
    v_bot = iy + half_span_i
    h_left = ix - half_span_i
    h_right = ix + half_span_i
    corner_r = max(2, arm // 7)

    draw.rounded_rectangle(
        (ix - arm // 2, v_top, ix + arm // 2, v_bot),
        radius=corner_r,
        fill=WHITE,
    )
    draw.rounded_rectangle(
        (h_left, iy - arm // 2, h_right, iy + arm // 2),
        radius=corner_r,
        fill=WHITE,
    )

    # Center “pass” seal — stays well inside safe circle (replaces corner badge).
    # seal_r = max(round(size * 0.105), 6)
    # bx, by = ix, iy
    # draw.ellipse(
    #     (bx - seal_r, by - seal_r, bx + seal_r, by + seal_r),
    #     fill=RED,
    #     outline=WHITE,
    #     width=max(2, round(size * 0.014)),
    # )
    # lw = max(3, round(size * 0.048))
    # x1 = bx - int(seal_r * 0.38)
    # y1 = by + int(seal_r * 0.06)
    # x2 = bx - int(seal_r * 0.06)
    # y2 = by + int(seal_r * 0.34)
    # x3 = bx + int(seal_r * 0.42)
    # y3 = by - int(seal_r * 0.22)
    # draw.line((x1, y1, x2, y2, x3, y3), fill=WHITE, width=lw, joint="curve")

    return img


def main() -> None:
    root = Path(__file__).resolve().parent
    for name, dim in (("icon-192.png", 192), ("icon-512.png", 512)):
        out = draw_icon(dim)
        assert out.size == (dim, dim), out.size
        path = root / name
        out.save(path, format="PNG", optimize=True)
        print(f"Wrote {path} ({dim}×{dim})")


if __name__ == "__main__":
    main()
