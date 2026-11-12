"""Build the tintable two-athlete position stills from the Pack D color passes.

Unreal rendered one frozen frame five times: everything black, then each
athlete's gi in white, then each athlete's belt in white. The page adds the
layers together, each multiplied by a color:

    picture = base
            + leadJacket  * lead.giTop   + leadPants  * lead.giPants  + leadBelt  * lead belt color
            + otherJacket * other.giTop  + otherPants * other.giPants + otherBelt * other belt color

"lead" is the athlete on top or in control; in a neutral position it is the
athlete on the left. Unreal colors a whole gi at once, so where a position
lists hem windows below, this script splits each gi into jacket and pants at
the jacket hem. A position without hem windows keeps one gi layer per athlete.

Usage:
    python3 -I tools/build_unreal_position_layers.py <Unreal-render-pack/positions> [--debug <folder>]

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

# What the site shows of each render, and where each jacket hem can be found.
#   crop     left, top, width, height in render pixels, 3:2 like the stage
#   size     published layer size, same proportions as the crop
#   families Arena position families this exact pose pictures
#   hem      per athlete: the render columns and rows that bracket the hem
POSITIONS = {
    "standing": {
        "crop": (370, 110, 1845, 1230),
        "size": (1620, 1080),
        "families": ["standing"],
        "hem": {
            "lead": {"columns": (830, 1100), "rows": (735, 800)},
            "other": {"columns": (1475, 1750), "rows": (715, 790)},
        },
    },
}


def fail(message):
    raise SystemExit(f"build_unreal_position_layers: {message}")


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
            layers[f"{athlete}Belt"] = belt_delta * belt_region[..., None]
            window = settings.get("hem", {}).get(athlete)
            if window:
                line, steady = hem_line(white, gi_region, belt_region, window, width)
                above = np.clip((line[None, :] + 2.0 - np.arange(height)[:, None]) / 4.0, 0, 1).astype(np.float32)
                layers[f"{athlete}Jacket"] = gi_delta * above[..., None]
                layers[f"{athlete}Pants"] = gi_delta * (1 - above)[..., None]
                (first, last) = window["columns"]
                details[athlete] = {"hemRows": [round(float(line[first:last].min()), 1), round(float(line[first:last].max()), 1)], "hemColumns": list(steady)}
                rebuilt = base + layers[f"{athlete}Jacket"] + layers[f"{athlete}Pants"]
            else:
                layers[f"{athlete}Gi"] = gi_delta
                details[athlete] = {}
                rebuilt = base + gi_delta
            clear = gi_region > 0.98
            details[athlete]["giPixels"] = int((gi_region > 0.5).sum())
            details[athlete]["beltPixels"] = int((belt_region > 0.5).sum())
            # With a white gi the layers must give back the white-gi render.
            details[athlete]["whiteMeanError"] = round(float(np.abs(rebuilt - white)[clear].mean()), 3)
            if debug and window:
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
        "// Generated by tools/build_unreal_position_layers.py from the Unreal render pack.\n"
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
