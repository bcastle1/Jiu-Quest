"""Build the tintable Unreal athlete layers from four pixel-aligned Unreal captures.

The page adds the layers together, each multiplied by a color the player chose:

    picture = base + jacket * giTop + pants * giPants + belt * beltColor

base    black gi, black belt, exactly as captured
jacket  (white gi - black gi) above the jacket hem, gi region only
pants   (white gi - black gi) below the jacket hem, gi region only
belt    neutral belt shading, from (blue belt - black belt)

Usage:
    python tools/build_unreal_athlete_layers.py <Unreal-gi-color-preview folder> [output folder]

The source captures are not in this repository. Their SHA-256 values are pinned
below and in src/unreal/athlete.js, and the script refuses any other files.
Requires Pillow and NumPy. It prints how closely the layers reproduce the real
navy capture, which is the check that the captures really are aligned.
"""
import hashlib
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

SOURCES = {
    "white-front.png": "39566ce057b3b21a65b76cfa97d73af4c4713abf7fbd35cdbd1f55b869150be1",
    "black-front.png": "97c8caaf85b3a86580b9c679860a2d934b258d76432692ef7dd80d3df4ddf090",
    "navy-front.png": "2682e1fbdb4249f91bf84fab4732ad66fccc950e8b516f9b576bc166fb36d280",
    "navy-blue-belt-front.png": "62cdf6e0d1a3c2c52b6049865e81e86a0e38cc37e3839da97f0c0f72e86b9aee",
}
# The athlete inside the 1600 x 1200 capture: left, top, width, height.
CROP = (588, 197, 450, 880)
# Capture rows that bracket the jacket hem, and the torso columns it spans.
HEM_ROWS = (612, 650)
HEM_COLUMNS = (720, 892)
# Capture box that holds the belt and its tails.
BELT_BOX = (690, 495, 905, 650)


def load(folder, name):
    path = pathlib.Path(folder) / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCES[name]:
        raise SystemExit(f"{name} is not the pinned capture ({digest})")
    left, top, width, height = CROP
    pixels = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    return pixels[top:top + height, left:left + width]


def soft(mask, median, blur, grow=0):
    image = Image.fromarray(mask).filter(ImageFilter.MedianFilter(median))
    if grow:
        image = image.filter(ImageFilter.MaxFilter(grow))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(blur))).astype(np.float64) / 255


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    source = sys.argv[1]
    output = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "public/assets/unreal-athlete/athlete-01")
    output.mkdir(parents=True, exist_ok=True)
    white, black, navy, blue_belt = (load(source, name) for name in SOURCES)
    left, top, width, height = CROP

    # Gi region: every channel brightens clearly when the gi turns white. Hair
    # and skin differ between captures only by render noise and are left out.
    delta = np.clip(white - black, 0, 255)
    gi = soft(((delta.min(axis=2) > 18) * 255).astype(np.uint8), median=5, blur=1.1, grow=3)
    delta *= gi[..., None]

    # Jacket hem: the darkest row of the white capture in each torso column.
    rows = slice(HEM_ROWS[0] - top, HEM_ROWS[1] - top)
    luminance = white.mean(axis=2)
    hem = np.median([np.argmin(luminance[rows, column]) + rows.start
                     for column in range(HEM_COLUMNS[0] - left, HEM_COLUMNS[1] - left)])
    above = np.clip((hem + 1.5 - np.arange(height)[:, None]) / 3.0, 0, 1)
    jacket = delta * above[..., None]
    pants = delta * (1 - above)[..., None]

    # Belt: the blue belt's blue channel carries its shading. Scale it so a
    # white belt comes out white, and keep it inside the belt region.
    shade = np.clip(blue_belt - navy, 0, 255)
    x0, y0, x1, y1 = BELT_BOX[0] - left, BELT_BOX[1] - top, BELT_BOX[2] - left, BELT_BOX[3] - top
    region = np.zeros((height, width), np.uint8)
    region[y0:y1, x0:x1] = (shade[y0:y1, x0:x1].max(axis=2) > 28) * 255
    lit = np.percentile(shade[..., 2][region > 0], 97)
    belt_gray = np.clip(shade[..., 2] * (238.0 / lit), 0, 255) * soft(region, median=3, blur=0.9)
    belt = np.repeat(belt_gray[..., None], 3, axis=2)

    for name, pixels, quality in (("base", black, 92), ("jacket", jacket, 90), ("pants", pants, 90), ("belt", belt, 90)):
        image = Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8))
        image.save(output / f"front-{name}.webp", "WEBP", quality=quality, method=6)

    # How well does one color reproduce the real navy capture?
    span = white - black
    clear = span.min(axis=2) > 60
    fit = np.array([np.median(((navy - black) / np.where(span == 0, 1, span))[..., channel][clear]) for channel in range(3)])
    error = np.abs(black + (jacket + pants) * np.clip(fit, 0, 1) - navy)[clear]
    print(json.dumps({
        "crop": list(CROP),
        "hemRow": float(hem),
        "giPixels": int(clear.sum()),
        "beltPixels": int((region > 0).sum()),
        "navyFit": [round(float(value), 4) for value in fit],
        "navyMeanError": round(float(error.mean()), 2),
        "navyP95Error": round(float(np.percentile(error, 95)), 2),
    }, indent=2))


if __name__ == "__main__":
    main()
