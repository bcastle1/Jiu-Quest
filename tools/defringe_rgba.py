"""Replace chroma-contaminated translucent edge RGB with nearby subject color.

This keeps the existing alpha matte while extending opaque foreground colors into
antialiased edge pixels. It is useful after chroma-key extraction because a
semi-transparent magenta/green RGB fringe otherwise becomes visible on dark UI.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def despill_magenta(rgb: np.ndarray, alpha: np.ndarray, iterations: int) -> np.ndarray:
    """Inpaint small opaque magenta-key remnants from nearby subject colors."""

    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    contaminated = (
        (alpha > 5)
        & (red > 40)
        & (blue > 45)
        & ((np.minimum(red, blue) - green) > 10)
        & (red > green * 1.05)
        & (blue > green * 1.08)
    )
    if not contaminated.any():
        return rgb

    full_rgb = rgb
    ys, xs = np.where(contaminated)
    padding = iterations + 2
    y0, y1 = max(0, int(ys.min()) - padding), min(alpha.shape[0], int(ys.max()) + padding + 1)
    x0, x1 = max(0, int(xs.min()) - padding), min(alpha.shape[1], int(xs.max()) + padding + 1)
    rgb = rgb[y0:y1, x0:x1]
    alpha = alpha[y0:y1, x0:x1]
    contaminated = contaminated[y0:y1, x0:x1]

    valid = (alpha > 5) & ~contaminated
    filled = valid.copy()
    for _ in range(iterations):
        pending = contaminated & ~filled
        if not pending.any():
            break

        color_sum = np.zeros_like(rgb)
        neighbor_count = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in (
            (-1, -1), (-1, 0), (-1, 1),
            (0, -1), (0, 1),
            (1, -1), (1, 0), (1, 1),
        ):
            shifted_valid = np.roll(filled, (dy, dx), axis=(0, 1))
            shifted_rgb = np.roll(rgb, (dy, dx), axis=(0, 1))
            if dy < 0:
                shifted_valid[dy:, :] = False
            elif dy > 0:
                shifted_valid[:dy, :] = False
            if dx < 0:
                shifted_valid[:, dx:] = False
            elif dx > 0:
                shifted_valid[:, :dx] = False
            color_sum += shifted_rgb * shifted_valid[..., None]
            neighbor_count += shifted_valid

        fill = pending & (neighbor_count > 0)
        if not fill.any():
            break
        rgb[fill] = color_sum[fill] / neighbor_count[fill, None]
        filled[fill] = True

    residual = contaminated & ~filled
    if residual.any():
        neutral = np.mean(rgb[residual], axis=1, keepdims=True)
        rgb[residual] = np.repeat(neutral, 3, axis=1)
    return full_rgb


def defringe(
    source: Path,
    output: Path,
    opaque_threshold: int,
    iterations: int,
    remove_magenta: bool,
    skip_edge: bool,
) -> None:
    image = Image.open(source).convert("RGBA")
    pixels = np.asarray(image, dtype=np.uint8).copy()
    rgb = pixels[..., :3].astype(np.float32)
    alpha = pixels[..., 3]

    if remove_magenta:
        rgb = despill_magenta(rgb, alpha, iterations)

    edge = (alpha > 0) & (alpha < opaque_threshold)
    valid = alpha >= opaque_threshold

    # Grow trustworthy foreground RGB through the translucent matte. Eight-way
    # averaging keeps thin hair strands smooth and avoids a single-direction seam.
    for _ in range(0 if skip_edge else iterations):
        pending = edge & ~valid
        if not pending.any():
            break

        color_sum = np.zeros_like(rgb)
        neighbor_count = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in (
            (-1, -1),
            (-1, 0),
            (-1, 1),
            (0, -1),
            (0, 1),
            (1, -1),
            (1, 0),
            (1, 1),
        ):
            shifted_valid = np.roll(valid, (dy, dx), axis=(0, 1))
            shifted_rgb = np.roll(rgb, (dy, dx), axis=(0, 1))

            if dy < 0:
                shifted_valid[dy:, :] = False
            elif dy > 0:
                shifted_valid[:dy, :] = False
            if dx < 0:
                shifted_valid[:, dx:] = False
            elif dx > 0:
                shifted_valid[:, :dx] = False

            color_sum += shifted_rgb * shifted_valid[..., None]
            neighbor_count += shifted_valid

        fill = pending & (neighbor_count > 0)
        if not fill.any():
            break
        rgb[fill] = color_sum[fill] / neighbor_count[fill, None]
        valid[fill] = True

    # Any isolated residual edge pixel falls back to neutral black; with its tiny
    # alpha this disappears cleanly on the app's graphite stage instead of glowing.
    rgb[edge & ~valid] = 0
    rgb[alpha == 0] = 0
    pixels[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)

    output.parent.mkdir(parents=True, exist_ok=True)
    result = Image.fromarray(pixels, "RGBA")
    if output.suffix.lower() == ".webp":
        result.save(output, format="WEBP", quality=94, method=4, exact=True)
    else:
        result.save(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="RGBA PNG/WebP source")
    parser.add_argument("--out", type=Path, required=True, help="Output PNG/WebP")
    parser.add_argument(
        "--opaque-threshold",
        type=int,
        default=248,
        help="Alpha value treated as trustworthy foreground color (default: 248)",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=24,
        help="Maximum one-pixel color-growth passes (default: 24)",
    )
    parser.add_argument(
        "--despill-magenta",
        action="store_true",
        help="Inpaint isolated magenta chroma-key remnants before edge defringing",
    )
    parser.add_argument(
        "--skip-edge-defringe",
        action="store_true",
        help="Only run chroma despill; preserve the existing antialiased edge colors",
    )
    args = parser.parse_args()
    defringe(
        args.input,
        args.out,
        args.opaque_threshold,
        args.iterations,
        args.despill_magenta,
        args.skip_edge_defringe,
    )


if __name__ == "__main__":
    main()
