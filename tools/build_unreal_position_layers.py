"""Build the tintable two-athlete position stills from the Pack D color passes.

Unreal rendered one frozen frame five times: everything black, then each
athlete's gi in white, then each athlete's belt in white. The page adds the
layers together, each multiplied by a color:

    picture = base
            + leadJacket  * lead.giTop   + leadPants  * lead.giPants  + leadBelt  * lead belt color
            + otherJacket * other.giTop  + otherPants * other.giPants + otherBelt * other belt color

"lead" is the athlete on top or in control; in a neutral position it is the
athlete on the left. Unreal colors a whole gi at once, so this script splits
each gi into jacket and pants. A position says how, per athlete, in one of two
ways:

  hem     a window that brackets a level jacket hem. The script finds the hem
          row in each column. This fits an upright athlete, whose jacket ends
          in one line across the hips.
  jacket  an outline traced around the jacket by hand, in render pixels. This
          fits a crouched athlete: the skirt corner hangs beside and below a
          patch of pants, so no single hem row per column separates them.

Both blend jacket into pants over four pixels. A position with neither keeps
one gi layer per athlete. Always look at the --debug pictures (jacket blue,
pants red) before publishing.

Where a belt's edge lies over its athlete's gi, both the gi and the belt pass
add light. The gi layer gives up the excess there, so that with a white gi and
a white belt the layers are never brighter than the two white renders added in
linear light, each only where it is brighter than the base render. That is what
a pixel that is part gi and part belt shows when both are white: no bright rim
along the belt, and no dark line either, which a cap at the brighter of the two
renders left on a light belt over a light gi.

tools/build_unreal_position_layers.mjs is this script's Node twin: the same
arithmetic, the same POSITIONS and the same output files. It is the tool of
record on a machine without Python, and it built the layers published now.
Change both together.

Usage:
    python3 -I tools/build_unreal_position_layers.py <Unreal-render-pack/positions> [--debug <folder>]
    node tools/build_unreal_position_layers.mjs <Unreal-render-pack/positions> [--debug <folder>]

The renders are not in this repository. Each file is checked against the
bytes and SHA-256 that positions.json lists for it, and those hashes are
written into src/unreal/positionStills.data.js for the tests to pin.
Requires Pillow, NumPy and SciPy.
"""
import hashlib
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import median_filter

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "assets" / "unreal-positions"
MODULE = ROOT / "src" / "unreal" / "positionStills.data.js"
PASSES = ("base", "lead-gi-white", "other-gi-white", "lead-belt-white", "other-belt-white")

# What the site shows of each render, and where each jacket ends.
#   crop     left, top, width, height in render pixels, 3:2 like the stage
#   size     published layer size, same proportions as the crop
#   families Arena position families this exact pose pictures
#   hem      per athlete: the render columns and rows that bracket a level hem
#   jacket   per athlete: a closed outline around the jacket, as (x, y) pixel
#            centers. Where it runs through background or through the belt it
#            only has to stay clear of the gi; where the jacket meets the pants
#            it follows the edge, in the shadow line under the skirt if there
#            is one.
#
# standing is frame 0 of the crouched standing_stance clip, side camera x=560.
# The crop is one render pixel per published pixel. Both jackets hang over bent
# hips: each skirt ends in a corner that hangs free beside the hip, with pants
# showing between the corner and the belt, so both athletes use an outline.
# (The upright pose this replaced used hem windows: lead columns 830-1100 rows
# 735-800, other columns 1475-1750 rows 715-790, with crop 370, 110, 1845, 1230.)
POSITIONS = {
    "standing": {
        "crop": (510, 255, 1620, 1080),
        "size": (1620, 1080),
        "families": ["standing"],
        "jacket": {
            "lead": [
                # background above and in front of the athlete, then the gap between the sleeve and the thigh
                (700, 300), (1400, 300), (1400, 860), (1100, 860), (1010, 800), (980, 800), (968, 805.5),
                # the top of the near thigh where it crosses the jacket front, right to left
                (960.5, 807.3), (958, 807.6), (954, 804.4), (950, 801), (946, 797.3), (942, 793.3), (938, 789.5), (934, 786), (930, 782.5), (926, 779.3), (922, 778.8),
                # through the end of the belt, then inside the belt to the front edge of the skirt
                (920, 778), (916, 775.6), (912, 773.7), (908, 772), (900, 770), (890, 778), (880, 779), (876.3, 782.5),
                # down the front edge of the skirt, beside the hip
                (874.5, 788), (873.5, 793), (872.7, 796), (871.5, 798), (870.8, 800), (869.5, 802), (869.2, 804), (868, 806), (867, 808), (866.2, 810),
                # the upper edge of the skirt corner, out to its tip
                (868, 811.8), (873.5, 812.3), (890, 815.5), (908, 819), (916, 822.5), (922, 825), (927, 828.5),
                # back along the hem, in the shadow under the skirt
                (924, 830.3), (920, 831.6), (916, 833.4), (912, 835), (908, 836.5), (904, 838.4), (900, 840), (896, 841.3), (892, 842.5), (888, 843.5), (884, 844.5), (880, 845.4), (876, 846), (872, 846.8), (868, 847.3), (864, 847.4), (860, 847.6), (856, 848.6), (852, 848.6), (848, 847.5), (844, 847.4), (840, 847.7), (836, 847.1), (832, 846.5), (828, 845.5), (824, 844.5), (820, 843.8), (816, 842.8), (812, 841.5), (810, 840.6), (808, 839.7),
                # background behind the athlete
                (800, 846), (700, 870),
            ],
            "other": [
                # background above and behind the athlete
                (1250, 300), (1950, 300), (1950, 826), (1818, 819),
                # along the hem, in the shadow under the skirt, right to left
                (1812.5, 814.8), (1810, 816.1), (1808, 817.1), (1804, 818.7), (1800, 820.5), (1796, 822.3), (1792, 823.8), (1788, 825.1), (1784, 826.3), (1780, 827.5), (1776, 828.3), (1772, 829.1), (1768, 829.8), (1764, 830.2), (1760, 830.9), (1756, 831.2), (1752, 831.6), (1748, 831.9), (1744, 832), (1740, 832.2),
                # the skirt corner, then up its front edge to where the flap's crease leaves it
                (1736.5, 833), (1737.8, 830.5), (1738.6, 828), (1739.3, 826), (1740, 824), (1740.8, 822), (1741.7, 820), (1742.5, 818), (1743.2, 816), (1744.2, 814),
                # straight up into the rolled front edge of the skirt, then up it to the belt. The
                # crease that runs on up and right to (1758.8, 801) fades there: a fold in the
                # jacket, which keeps the cloth inside it, not an edge over the pants.
                (1744.2, 796), (1744.1, 792), (1743.2, 788), (1741.5, 784), (1738.7, 780), (1735.6, 776), (1732.5, 772), (1729.7, 768), (1728.7, 765), (1729.7, 762), (1730.8, 759.5), (1731.5, 756),
                # inside the belt to the knot, then the gap between the sleeve and the thigh
                (1735, 748), (1722, 748), (1700, 758), (1680, 766), (1660, 776), (1635, 783), (1590, 790), (1500, 800), (1250, 800),
            ],
        },
    },
}


def fail(message):
    raise SystemExit(f"build_unreal_position_layers: {message}")


def to_linear(value):
    """The sRGB transfer function: 0..255 values to linear light, 0..1."""
    s = value / 255
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def from_linear(light):
    """Linear light back to 0..255 values, clamped."""
    light = np.clip(light, 0, 1)
    return 255 * np.where(light <= 0.0031308, light * 12.92, 1.055 * light ** (1 / 2.4) - 0.055)


def soft(mask, median, blur, grow=0):
    image = Image.fromarray(mask).filter(ImageFilter.MedianFilter(median))
    if grow:
        image = image.filter(ImageFilter.MaxFilter(grow))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32) / 255


def region(delta, median, blur):
    """Where a pass clearly brightens every channel: that gi or that belt."""
    return soft(((delta.min(axis=2) > 14) * 255).astype(np.uint8), median=median, blur=blur, grow=5)


def hem_line(white, gi, belt, window, width):
    """The jacket hem as one row per render column.

    Under the belt the skirt ends in a shadow line on the pants. In each column
    take the darkest gi row inside the window, ignoring the belt and its tails,
    then smooth the line and carry it flat past the columns that disagree.
    """
    (first, last), (top, bottom) = window["columns"], window["rows"]
    rows = slice(top, bottom)
    luminance = white.mean(axis=2)
    usable = (gi[rows] > 0.9) & (belt[rows] < 0.05)
    columns = np.array([column for column in range(first, last) if usable[:, column].sum() > (bottom - top) * 0.6])
    if len(columns) < 40:
        fail(f"too few usable hem columns ({len(columns)}) in {window}")
    found = np.array([np.argmin(np.where(usable[:, column], luminance[rows, column], 1e9)) + top for column in columns]).astype(np.float64)
    smooth = median_filter(found, size=41, mode="nearest")
    steady = np.abs(found - smooth) <= 6
    steady &= median_filter(steady.astype(np.uint8), size=21, mode="constant") > 0
    if steady.sum() < 30:
        fail(f"the hem is not steady enough in {window}")
    line = np.interp(np.arange(width), columns[steady], smooth[steady])
    return line, (int(columns[steady].min()), int(columns[steady].max()))


def inside_outline(outline, width, height):
    """How far inside a traced outline each pixel center is, in pixels.

    Negative outside. A pixel is inside when a ray from it to the right crosses
    the outline an odd number of times; the distance is to the nearest edge.
    """
    xs = np.arange(width, dtype=np.float64)[None, :]
    ys = np.arange(height, dtype=np.float64)[:, None]
    inside = np.zeros((height, width), dtype=bool)
    nearest = np.full((height, width), np.inf)
    for (x0, y0), (x1, y1) in zip(outline, outline[1:] + outline[:1]):
        dx, dy = float(x1 - x0), float(y1 - y0)
        if not dx and not dy:
            fail(f"the jacket outline repeats the point {x0}, {y0}")
        if dy:
            inside ^= ((ys >= y0) != (ys >= y1)) & (xs < x0 + (ys - y0) * dx / dy)
        along = np.clip(((xs - x0) * dx + (ys - y0) * dy) / (dx * dx + dy * dy), 0, 1)
        nearest = np.minimum(nearest, np.sqrt((xs - x0 - along * dx) ** 2 + (ys - y0 - along * dy) ** 2))
    return np.where(inside, nearest, -nearest)


def main():
    arguments = sys.argv[1:]
    debug = None
    if "--debug" in arguments:
        index = arguments.index("--debug")
        debug = pathlib.Path(arguments[index + 1])
        del arguments[index:index + 2]
    if len(arguments) != 1:
        raise SystemExit(__doc__)
    source = pathlib.Path(arguments[0])
    manifest = json.loads((source / "positions.json").read_text(encoding="utf-8"))
    listed = {}
    for entry in manifest:
        listed.setdefault(entry["position"], {})[entry["pass"]] = entry

    stills, report = [], {}
    for position, settings in POSITIONS.items():
        entries = listed.get(position)
        if not entries or sorted(entries) != sorted(PASSES):
            fail(f"{position}: positions.json must list exactly {', '.join(PASSES)}")
        renders, sources = {}, {}
        for name in PASSES:
            entry = entries[name]
            if entry["file"] != f"{position}/{name}.png":
                fail(f"{position}/{name}: unexpected file name {entry['file']}")
            data = (source / entry["file"]).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if len(data) != entry["bytes"] or digest != entry["sha256"]:
                fail(f"{entry['file']} does not match positions.json")
            image = Image.open(source / entry["file"])
            if image.size != (entry["width"], entry["height"]):
                fail(f"{entry['file']} is {image.size}, not the listed size")
            renders[name] = np.asarray(image.convert("RGB")).astype(np.float32)
            sources[f"{name}.png"] = digest
        base = renders["base"]
        height, width = base.shape[:2]
        left, top, crop_width, crop_height = settings["crop"]
        if abs(crop_width / crop_height - settings["size"][0] / settings["size"][1]) > 0.002:
            fail(f"{position}: crop and size have different proportions")

        layers = {"base": base}
        details = {}
        for athlete in ("lead", "other"):
            white = renders[f"{athlete}-gi-white"]
            belt_delta = np.clip(renders[f"{athlete}-belt-white"] - base, 0, 255)
            belt_region = region(belt_delta, median=5, blur=1.4)
            gi_delta = np.clip(white - base, 0, 255)
            gi_region = region(gi_delta, median=7, blur=1.8)
            gi_delta *= gi_region[..., None]
            belt = belt_delta * belt_region[..., None]
            # Where the belt's edge lies over the gi both layers add light, and a white belt
            # on a white gi would show a bright rim. Take the excess out of the gi, so that
            # base + gi + belt is never brighter than the two white renders added in linear
            # light (each only where it is brighter than the base, as the layers are).
            belt_white = renders[f"{athlete}-belt-white"]
            dark = to_linear(base)
            both = from_linear(dark + np.maximum(0, to_linear(white) - dark) + np.maximum(0, to_linear(belt_white) - dark))
            excess = gi_delta + belt - (np.maximum(np.maximum(white, belt_white), both) - base)
            trimmed = excess > 0
            gi_delta = np.where(trimmed, np.maximum(0, gi_delta - excess), gi_delta).astype(np.float32)
            layers[f"{athlete}Belt"] = belt
            window = settings.get("hem", {}).get(athlete)
            outline = settings.get("jacket", {}).get(athlete)
            if window and outline:
                fail(f"{position}/{athlete}: give a hem window or a jacket outline, not both")
            if window or outline:
                # The same four-pixel ramp either way: across the hem row, or across the traced outline.
                if outline:
                    above = np.clip(0.5 + inside_outline(outline, width, height) / 4.0, 0, 1).astype(np.float32)
                    details[athlete] = {"outlinePoints": len(outline)}
                else:
                    line, steady = hem_line(white, gi_region, belt_region, window, width)
                    above = np.clip((line[None, :] + 2.0 - np.arange(height)[:, None]) / 4.0, 0, 1).astype(np.float32)
                    (first, last) = window["columns"]
                    details[athlete] = {"hemRows": [round(float(line[first:last].min()), 1), round(float(line[first:last].max()), 1)], "hemColumns": list(steady)}
                layers[f"{athlete}Jacket"] = gi_delta * above[..., None]
                layers[f"{athlete}Pants"] = gi_delta * (1 - above)[..., None]
                rebuilt = base + layers[f"{athlete}Jacket"] + layers[f"{athlete}Pants"]
            else:
                layers[f"{athlete}Gi"] = gi_delta
                details[athlete] = {}
                rebuilt = base + gi_delta
            # Away from the belt, where the trim above takes light out of the gi on purpose.
            clear = (gi_region > 0.98) & (belt_region < 0.02)
            details[athlete]["giPixels"] = int((gi_region > 0.5).sum())
            details[athlete]["beltPixels"] = int((belt_region > 0.5).sum())
            # With a white gi the layers must give back the white-gi render.
            details[athlete]["whiteMeanError"] = round(float(np.abs(rebuilt - white)[clear].mean()), 3)
            details[athlete]["beltOverlapTrimmed"] = int(trimmed.sum())
            if debug and (window or outline):
                debug.mkdir(parents=True, exist_ok=True)
                preview = np.clip(base + layers[f"{athlete}Jacket"] * np.array([0.1, 0.25, 0.9], dtype=np.float32) + layers[f"{athlete}Pants"] * np.array([0.9, 0.2, 0.15], dtype=np.float32) + layers[f"{athlete}Belt"], 0, 255)
                Image.fromarray(preview.astype(np.uint8)).crop((left, top, left + crop_width, top + crop_height)).save(debug / f"{position}-{athlete}-split.png")

        folder = PUBLIC / position
        folder.mkdir(parents=True, exist_ok=True)
        for stale in folder.glob("*.webp"):
            stale.unlink()
        files, urls = {}, {}
        for name, pixels in layers.items():
            file_name = "".join(f"-{letter.lower()}" if letter.isupper() else letter for letter in name) + ".webp"
            image = Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8))
            image = image.crop((left, top, left + crop_width, top + crop_height)).resize(settings["size"], Image.LANCZOS)
            path = folder / file_name
            image.save(path, "WEBP", quality=90 if name == "base" else 88, method=6)
            data = path.read_bytes()
            files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            urls[name] = f"/assets/unreal-positions/{position}/{file_name}"
        first = entries["base"]
        stills.append({
            "position": position,
            "families": settings["families"],
            "width": settings["size"][0],
            "height": settings["size"][1],
            "camera": first["camera"],
            "sourceClip": first.get("sourceClip"),
            "sourceFrame": first.get("sourceFrame"),
            "poseReviewed": all(entry.get("poseReviewed") is True for entry in entries.values()),
            "layers": urls,
            "files": files,
            "sources": sources,
        })
        report[position] = {"crop": list(settings["crop"]), "size": list(settings["size"]), **details,
                            "bytes": sum(item["bytes"] for item in files.values())}

    body = json.dumps(stills, indent=2)
    MODULE.write_text(
        "// Generated by tools/build_unreal_position_layers.mjs (or its twin, the .py) from the Unreal render pack.\n"
        "// Do not edit by hand: run the tool again when the pack changes.\n"
        f"const stills = {body};\n\n"
        "export default Object.freeze(stills.map((still) => Object.freeze({\n"
        "  ...still,\n"
        "  families: Object.freeze(still.families),\n"
        "  layers: Object.freeze(still.layers),\n"
        "  files: Object.freeze(still.files),\n"
        "  sources: Object.freeze(still.sources),\n"
        "})));\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
