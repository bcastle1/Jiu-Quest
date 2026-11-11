"""Build the tintable Unreal athlete layers from the Pack A color passes.

The page adds the layers together, each multiplied by a color the player chose:

    picture = base + jacket * giTop + pants * giPants + belt * beltColor

base    gi-black.png: black gi, black belt, exactly as rendered
jacket  (gi-white - gi-black) above the jacket hem, gi region only
pants   (gi-white - gi-black) below the jacket hem, gi region only
belt    (belt-white - gi-black), belt region only

Usage:
    python tools/build_unreal_athlete_layers.py <Unreal-render-pack/athlete-01/front> [output folder]

The renders are not in this repository. Their SHA-256 values are pinned below
and in src/unreal/athlete.js, and the script refuses any other files.
Requires Pillow, NumPy and SciPy.
"""
import hashlib
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import median_filter

SOURCES = {
    "gi-white.png": "5204d085df4aa17ba8828c77fc03cdd57b2c0ccbf8bf1ed041e207abf208a8f3",
    "gi-black.png": "86300d214f158de9ab9812e5213710165572993791d3ff7759a278c3bd73f65b",
    "belt-white.png": "c6e5b37046c4ae52bd23fa066820d407d001eb9056edd16c4cff15801ee955f2",
}
# The athlete inside the 2400 x 3000 render: left, top, width, height.
CROP = (538, 166, 1400, 2738)
# Published layer size. Same proportions as the crop.
SIZE = (900, 1760)
# Render rows that bracket the jacket hem.
HEM_ROWS = (1440, 1570)


def load(folder, name):
    path = pathlib.Path(folder) / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCES[name]:
        raise SystemExit(f"{name} is not the pinned render ({digest})")
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
    white, black, belt_white = (load(source, name) for name in SOURCES)
    left, top, width, height = CROP

    # Belt: what changes when only the belt turns white.
    belt_delta = np.clip(belt_white - black, 0, 255)
    belt_region = soft(((belt_delta.min(axis=2) > 14) * 255).astype(np.uint8), median=7, blur=1.6, grow=5)
    belt = belt_delta * belt_region[..., None]

    # Gi region: every channel brightens clearly when the gi turns white. Skin
    # and hair differ between passes only by render noise and are left out.
    delta = np.clip(white - black, 0, 255)
    gi = soft(((delta.min(axis=2) > 14) * 255).astype(np.uint8), median=7, blur=1.8, grow=5)
    delta *= gi[..., None]

    # Jacket hem: under the belt the skirt ends in a shadow line on the pants.
    # In each column take the darkest gi row between the bracketing rows,
    # ignoring the belt and its tails, then smooth the line across columns.
    rows = slice(HEM_ROWS[0] - top, HEM_ROWS[1] - top)
    luminance = white.mean(axis=2)
    usable = (gi[rows] > 0.9) & (belt_region[rows] < 0.05)
    columns = np.flatnonzero(usable.sum(axis=0) > (rows.stop - rows.start) * 0.6)
    found = np.array([np.argmin(np.where(usable[:, column], luminance[rows, column], 1e9)) + rows.start for column in columns]).astype(np.float64)
    smooth = median_filter(found, size=61, mode="nearest")
    # At the tips of the skirt the darkest row is a fold, not the hem. Keep the
    # columns that agree with their neighbours and carry the line flat past them.
    steady = np.abs(found - smooth) <= 8
    steady &= median_filter(steady.astype(np.uint8), size=41, mode="constant") > 0
    hem = np.interp(np.arange(width), columns[steady], smooth[steady])
    above = np.clip((hem[None, :] + 2.0 - np.arange(height)[:, None]) / 4.0, 0, 1)
    jacket = delta * above[..., None]
    pants = delta * (1 - above)[..., None]

    report = {"crop": list(CROP), "size": list(SIZE), "hemRows": [round(float(hem.min()) + top, 1), round(float(hem.max()) + top, 1)],
              "hemColumns": [int(columns[steady].min()) + left, int(columns[steady].max()) + left],
              "giPixels": int((gi > 0.5).sum()), "beltPixels": int((belt_region > 0.5).sum()), "files": {}}
    for name, pixels, quality in (("base", black, 90), ("jacket", jacket, 88), ("pants", pants, 88), ("belt", belt, 88)):
        image = Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS)
        path = output / f"front-{name}.webp"
        image.save(path, "WEBP", quality=quality, method=6)
        data = path.read_bytes()
        report["files"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    # With every color white the layers must give back the white-gi render,
    # apart from the belt, which that render shows in black.
    rebuilt = black + jacket + pants
    clear = gi > 0.98
    report["whiteMeanError"] = round(float(np.abs(rebuilt - white)[clear].mean()), 3)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
