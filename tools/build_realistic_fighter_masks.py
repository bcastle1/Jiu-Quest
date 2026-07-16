"""Build CSS-compatible masks for a realistic JiuQuest fighter cutout.

The source image supplies the final silhouette. Existing pose masks supply the
part layout and are resized to the new source before being clipped to that
silhouette. Outputs are white RGBA PNGs whose alpha channel is the mask, which
makes them suitable for ``mask-image`` / ``-webkit-mask-image`` in the app.

Only Pillow is required.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageFilter, ImageOps
except ImportError as exc:  # pragma: no cover - exercised only without Pillow.
    raise SystemExit(
        "Pillow is required. Install it with: python -m pip install Pillow"
    ) from exc


PARTS = ("skin", "jacket", "pants", "belt", "hair")
RESAMPLING = getattr(Image, "Resampling", Image)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create body, skin, jacket, pants, belt, and hair alpha masks for "
            "a new realistic fighter image."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Mask prefixes are paths without the trailing part name or .png extension.

Example (one line):
  python tools/build_realistic_fighter_masks.py --source public/assets/characters/profile-realistic.png --source-mask-prefix public/assets/characters/masks/profile --out-prefix public/assets/characters/masks/profile-realistic --auto-hair

The example reads profile-skin.png, profile-jacket.png, and the other old
part masks, then writes profile-realistic-body.png through
profile-realistic-hair.png.
""",
    )
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="New fighter cutout. Its alpha channel defines the body silhouette.",
    )
    parser.add_argument(
        "--source-mask-prefix",
        required=True,
        type=Path,
        help=(
            "Prefix of the existing aligned masks, without '-skin.png' or "
            "another part suffix."
        ),
    )
    parser.add_argument(
        "--out-prefix",
        required=True,
        type=Path,
        help="Output prefix; '-body.png', '-skin.png', etc. are appended.",
    )
    parser.add_argument(
        "--auto-hair",
        action="store_true",
        help=(
            "Refine the resized hair mask with soft dark-pixel detection in "
            "the upper 28%% of the new source."
        ),
    )
    return parser.parse_args()


def part_path(prefix: Path, part: str) -> Path:
    """Return ``<prefix>-<part>.png`` without changing dotted path names."""

    return Path(f"{prefix}-{part}.png")


def load_source(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"Source image not found: {path}")

    with Image.open(path) as opened:
        return ImageOps.exif_transpose(opened).convert("RGBA")


def image_mask_alpha(image: Image.Image) -> Image.Image:
    """Extract alpha from a CSS mask, with luminance fallback for L/RGB masks."""

    if "A" in image.getbands() or "transparency" in image.info:
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")

        # Some authoring tools export an opaque PNG with the mask in RGB.
        # Prefer that luminance only when the alpha channel carries no mask.
        if alpha.getextrema() == (255, 255):
            luminance = ImageOps.grayscale(rgba)
            if luminance.getextrema() != (255, 255):
                return luminance
        return alpha

    if image.mode in {"1", "L", "I", "F"}:
        return image.convert("L")
    return ImageOps.grayscale(image.convert("RGB"))


def load_resized_mask(path: Path, size: tuple[int, int]) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"Source mask not found: {path}")

    with Image.open(path) as opened:
        oriented = ImageOps.exif_transpose(opened)
        alpha = image_mask_alpha(oriented).copy()

    if alpha.size != size:
        alpha = alpha.resize(size, RESAMPLING.LANCZOS)
    return alpha


def intersect(left: Image.Image, right: Image.Image) -> Image.Image:
    """Multiply two L masks while retaining their antialiased edges."""

    return ImageChops.multiply(left, right)


def soft_darkness(
    luminance: Image.Image,
    *,
    fully_dark_at: int,
    transparent_at: int,
) -> Image.Image:
    """Map luminance to a soft dark-pixel confidence mask."""

    if not 0 <= fully_dark_at < transparent_at <= 255:
        raise ValueError("Invalid soft-darkness thresholds")

    span = transparent_at - fully_dark_at
    table: list[int] = []
    for value in range(256):
        if value <= fully_dark_at:
            weight = 255
        elif value >= transparent_at:
            weight = 0
        else:
            weight = round(255 * (transparent_at - value) / span)
        table.append(weight)
    return luminance.point(table)


def upper_canvas_gate(size: tuple[int, int]) -> Image.Image:
    """Return a full-width mask that softly ends at 28% canvas height."""

    width, height = size
    fade_start = max(0, round(height * 0.25))
    cutoff = max(fade_start + 1, round(height * 0.28))
    column = Image.new("L", (1, height), 0)
    values: list[int] = []

    for y in range(height):
        if y <= fade_start:
            value = 255
        elif y >= cutoff:
            value = 0
        else:
            value = round(255 * (cutoff - y) / (cutoff - fade_start))
        values.append(value)

    column.putdata(values)
    return column.resize((width, height), RESAMPLING.BILINEAR)


def build_auto_hair_alpha(
    source: Image.Image,
    source_alpha: Image.Image,
    resized_old_hair: Image.Image,
    non_hair_parts: list[Image.Image],
) -> Image.Image:
    """Build a soft hair mask from dark pixels plus a dark-filtered old mask.

    The unrestricted detector uses a stricter darkness threshold. The old hair
    mask receives a more permissive threshold, allowing dark brown edge detail
    to survive while preventing an old hairstyle from appearing on a bald or
    light-haired source. Known skin and uniform masks suppress dark eyes, brows,
    collars, and gi fabric from the automatic detector.
    """

    luminance = ImageOps.grayscale(source.convert("RGB"))
    top_gate = upper_canvas_gate(source.size)
    visible_top = intersect(source_alpha, top_gate)

    strict_dark = soft_darkness(
        luminance,
        fully_dark_at=68,
        transparent_at=132,
    )
    guided_dark = soft_darkness(
        luminance,
        fully_dark_at=92,
        transparent_at=166,
    )

    exclusion = Image.new("L", source.size, 0)
    for part_alpha in non_hair_parts:
        exclusion = ImageChops.lighter(exclusion, part_alpha)
    auto_allowed = ImageChops.invert(exclusion)

    detected = intersect(strict_dark, visible_top)
    detected = intersect(detected, auto_allowed)

    old_where_dark = intersect(resized_old_hair, guided_dark)
    old_where_dark = intersect(old_where_dark, visible_top)

    combined = ImageChops.lighter(detected, old_where_dark)

    # A small resolution-relative blur smooths luma-threshold stair-stepping.
    # Capping after the blur prevents it from leaking into transparent or
    # clearly light source pixels.
    blur_radius = max(0.55, min(source.size) / 1800.0)
    combined = combined.filter(ImageFilter.GaussianBlur(blur_radius))
    combined = ImageChops.darker(combined, visible_top)
    combined = ImageChops.darker(combined, guided_dark)
    return combined


def rgba_mask(alpha: Image.Image) -> Image.Image:
    """Make an RGBA PNG whose visible white and alpha both describe the mask."""

    result = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    result.putalpha(alpha)
    return result


def save_mask(alpha: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgba_mask(alpha).save(path, format="PNG", optimize=True)


def build_masks(
    source_path: Path,
    source_mask_prefix: Path,
    out_prefix: Path,
    *,
    auto_hair: bool,
) -> list[Path]:
    source = load_source(source_path)
    source_alpha = source.getchannel("A")

    if source_alpha.getextrema() == (255, 255):
        print(
            "warning: source has no transparent pixels; the body mask will "
            "cover the full canvas",
            file=sys.stderr,
        )

    resized_old: dict[str, Image.Image] = {}
    clipped: dict[str, Image.Image] = {}
    for part in PARTS:
        old_alpha = load_resized_mask(
            part_path(source_mask_prefix, part),
            source.size,
        )
        resized_old[part] = old_alpha
        clipped[part] = intersect(old_alpha, source_alpha)

    if auto_hair:
        clipped["hair"] = build_auto_hair_alpha(
            source,
            source_alpha,
            resized_old["hair"],
            [clipped[part] for part in ("skin", "jacket", "pants", "belt")],
        )

    body_no_hair = ImageChops.subtract(source_alpha, clipped["hair"])
    output_alphas = {
        "body": source_alpha,
        "body-no-hair": body_no_hair,
        "body-no-belt": ImageChops.subtract(source_alpha, clipped["belt"]),
        "body-no-hair-no-belt": ImageChops.subtract(body_no_hair, clipped["belt"]),
        **clipped,
    }
    written: list[Path] = []
    for part in ("body", "body-no-hair", "body-no-belt", "body-no-hair-no-belt", *PARTS):
        output_path = part_path(out_prefix, part)
        save_mask(output_alphas[part], output_path)
        written.append(output_path)
    return written


def main() -> None:
    args = parse_args()
    try:
        written = build_masks(
            args.source,
            args.source_mask_prefix,
            args.out_prefix,
            auto_hair=args.auto_hair,
        )
    except (FileNotFoundError, OSError, ValueError) as exc:
        raise SystemExit(f"error: {exc}") from exc

    print(f"Wrote {len(written)} masks:")
    for path in written:
        print(f"  {path}")


if __name__ == "__main__":
    main()
