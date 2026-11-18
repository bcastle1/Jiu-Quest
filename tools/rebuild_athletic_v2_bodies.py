"""Rebuild the eleven Athletic V2 body layers from the verified native delivery.

Use this from the isolated website checkout:
    python tools/rebuild_athletic_v2_bodies.py <absolute-bundle> <native-task> [--install]

By default the new bodies, front floor outline, reports, receipt and updated source files are staged
under tmp/. --install also installs those exact staged files in this checkout.
Give the printed body-input-receipt.json to the head builder.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FRONT_DIR = Path("public/assets/unreal-athlete/athlete-01")
STANDING_DIR = Path("public/assets/unreal-positions/standing")
FRONT_NAMES = {"gi-white.png": "white", "gi-black.png": "black", "belt-white.png": "beltWhite"}
STANDING_NAMES = {
    "base.png": "base", "lead-gi-white.png": "leadGiWhite", "other-gi-white.png": "otherGiWhite",
    "lead-belt-white.png": "leadBeltWhite", "other-belt-white.png": "otherBeltWhite",
}
FRONT_TOOL = Path("tools/build_unreal_athlete_layers.py")
ATHLETE = Path("src/unreal/athlete.js")
STANDING_DATA = Path("src/unreal/positionStills.data.js")
STANDING_TEST = Path("tests/unrealPositionStills.test.js")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_text(path, value):
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_text(value, encoding="utf-8")


def write_json(path, value):
    write_text(path, json.dumps(value, indent=2) + "\n")


def descriptor(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def run_json(args):
    result = subprocess.run(args, check=True, cwd=ROOT, stdout=subprocess.PIPE, encoding="utf-8")
    return json.loads(result.stdout)


def replace_once(source, pattern, replacement):
    updated, count = re.subn(pattern, lambda _: replacement, source)
    require(count == 1, f"Expected one matching source region, found {count}: {pattern}")
    return updated


def replace_pins(source, passes, quote):
    for alias, row in passes.items():
        prefix = f"{quote}{alias}{quote}: {quote}"
        source = replace_once(source, re.escape(prefix) + "[a-f0-9]{64}" + quote,
                              f"{prefix}{row['sha256']}{quote}")
    return source


def verify_bundle(bundle, task):
    require(bundle.is_absolute(), "Supply the exact absolute native delivery directory.")
    for name in ("heads.json", "layer-passes.json", "custom/catalog/verify_catalog.mjs",
                 "custom/catalog/catalog_contract.mjs"):
        require((bundle / name).is_file(), f"Full catalog file missing: {bundle / name}")
    # Run the exact delivered verifier, after matching it to the native team's
    # copy. Both files are needed because the executable imports the contract.
    for name in ("verify_catalog.mjs", "catalog_contract.mjs"):
        require(descriptor(bundle / "custom/catalog" / name) == descriptor(task / "delivery-tools/catalog" / name),
                f"Delivered catalog verifier differs from the native task: {name}")
    result = run_json(["node", bundle / "custom/catalog/verify_catalog.mjs", bundle])
    require(result.get("status") == "delivered_catalog_verified"
            and (result["front"], result["standing"], result["headChoicesPerScene"]) == (78, 83, 74),
            "Complete delivered 78/83 catalog verification is required.")
    pack = read_json(bundle / "heads.json")
    require(len(pack["runs"]) == 24 and pack["athleticRender"]["configSha256"] ==
            "7ba0ed3be16366e8d15ab5ea14d6a454e11d5bb571b839de54216e547ceff3f4"
            and pack["athleticRender"]["preparationIndexSha256"] ==
            "9df51a17fcbed1eec970ecdafa0c69c0cf18491ae991c1fd5ba64a1c24fc4927",
            "Expected the complete Athletic V2 candidate index and configuration.")
    return pack, read_json(bundle / "layer-passes.json"), result


def materialize(folder, passes, aliases):
    folder.mkdir(parents=True)
    require(passes.keys() == aliases.keys(), f"Wrong native aliases in {folder}")
    for alias, row in passes.items():
        target = folder / alias
        shutil.copyfile(row["file"], target)
        require(descriptor(target) == {key: row[key] for key in ("bytes", "sha256")},
                f"Native image changed during copy: {alias}")


def rebuild(bundle, task, pack, passes, verification, stage):
    aliases = stage / "aliases"
    front = passes["front"]
    materialize(aliases / "front", front, FRONT_NAMES)
    python_tool = replace_pins((ROOT / FRONT_TOOL).read_text(encoding="utf-8"), front, '"')
    write_text(stage / FRONT_TOOL, python_tool)
    front_reference, = [run for run in pack["runs"] if (run["scene"], run["run"]) == ("front", "reference")]
    front_report = run_json([
        sys.executable, stage / FRONT_TOOL, aliases / "front", stage / FRONT_DIR,
        "--protected-hem", task / "review-v2/dean-comparison-v2-with-original/candidate-layers/protected-hem-classification.json",
        "--protected-hem-report", front_reference["report"]["file"],
        "--protected-hem-proof", task / "patches-v1/proposal-report.json",
    ])
    require(front_report["hemProtection"]["freshClothLightConserved"] is True, "Missing protected hem output.")
    write_json(stage / "front-build.json", front_report)

    standing = passes["standing"]
    materialize(aliases / "positions/standing", standing, STANDING_NAMES)
    entries = [{"position": "standing", "pass": Path(alias).stem, "file": f"standing/{alias}",
                "width": 2560, "height": 1440, "bytes": row["bytes"], "sha256": row["sha256"],
                "camera": "side", "sourceClip": "standing_stance/fighter-side.mp4", "sourceFrame": 0,
                "poseReviewed": False} for alias, row in standing.items()]
    write_json(aliases / "positions/positions.json", entries)
    (stage / STANDING_DATA).parent.mkdir(parents=True, exist_ok=True)
    standing_report = run_json(["node", ROOT / "tools/build_unreal_position_layers.mjs", aliases / "positions",
                                "--public", (stage / STANDING_DIR).parent, "--module", stage / STANDING_DATA])
    metrics = standing_report["standing"]
    require(metrics["crop"] == [510, 255, 1620, 1080] and metrics["size"] == [1620, 1080]
            and metrics["cloth"] == {"times": 4, "rise": 0.15} and metrics["quality"] == 96,
            "Standing body-layer settings changed.")
    write_json(stage / "standing-build.json", standing_report)
    # Import the actual module emitted by the standing builder, including its
    # source and output descriptors. tmp/ lives inside the site's ESM package.
    module_url = (stage / STANDING_DATA).as_uri()
    still, = run_json(["node", "--input-type=module", "-e",
                       "console.log(JSON.stringify((await import(process.argv[1])).default))", module_url])

    changed = [FRONT_TOOL, ATHLETE, STANDING_DATA, STANDING_TEST]
    front_files = front_report["files"]
    require(set(front_files) == {"base", "jacket", "pants", "belt"}, "Incomplete front layers")
    require(set(still["files"]) == {"base", "leadJacket", "leadPants", "leadBelt", "otherJacket", "otherPants", "otherBelt"},
            "Incomplete standing layers")
    receipt = {"schema": 1, "nativeSources": {
        "front": {key: front_report["hemProtection"]["nativeSources"][alias]["sha256"] for alias, key in FRONT_NAMES.items()},
        "standing": {key: still["sources"][alias] for alias, key in STANDING_NAMES.items()},
    }, "layers": {}}
    athlete = replace_pins((ROOT / ATHLETE).read_text(encoding="utf-8"), front, "'")
    for name, row in front_files.items():
        relative = FRONT_DIR / f"front-{name}.webp"
        require(descriptor(stage / relative) == row, f"Front output mismatch: {name}")
        changed.append(relative)
        pattern = re.escape(f"{name}: Object.freeze({{ bytes: ") + r"\d+, sha256: '[a-f0-9]{64}' \}\)"
        athlete = replace_once(athlete, pattern, f"{name}: Object.freeze({{ bytes: {row['bytes']}, sha256: '{row['sha256']}' }})")
        if name in ("base", "jacket"):
            receipt["layers"]["/" + relative.relative_to("public").as_posix()] = row
    write_text(stage / ATHLETE, athlete)
    outline = run_json(["node", ROOT / "tools/build_unreal_athlete_floor.mjs", "--silhouette-only", "--out", stage])
    outline_file = FRONT_DIR / "floor/front-silhouette.webp"
    require(descriptor(stage / outline_file) == {key: outline[key] for key in ("bytes", "sha256")},
            "Front floor outline does not match its generated pin.")
    changed.extend((outline_file, Path("src/unreal/athleteFloor.data.js")))
    for name, row in still["files"].items():
        url = still["layers"][name]
        relative = STANDING_DIR / Path(url).name
        require("/" + relative.relative_to("public").as_posix() == url and descriptor(stage / relative) == row,
                f"Standing output mismatch: {name}")
        changed.append(relative)
        if name in ("base", "leadJacket", "otherJacket"):
            receipt["layers"][url] = row

    tests = replace_pins((ROOT / STANDING_TEST).read_text(encoding="utf-8"), standing, "'")
    tests = re.sub(r"  // These five Unreal passes are Claude's renders.*?and only the floor and the lights differ\.\n",
                   "  // These five Athletic V2 reference passes preserve the recorded ready-hand pose and dojo camera.\n",
                   tests, flags=re.S)
    write_text(stage / STANDING_TEST, tests)
    write_json(stage / "body-input-receipt.json", receipt)
    run_json(["node", "--input-type=module", "-e",
              """import { readFileSync } from 'node:fs';
              import { createLayerInput, validateLayerInputReceipt } from './tools/build_unreal_athlete_heads.mjs';
              const json = path => JSON.parse(readFileSync(path, 'utf8'));
              console.log(JSON.stringify(validateLayerInputReceipt(json(process.argv[1]),
                createLayerInput(process.argv[2]).files, json(process.argv[3]))));""",
              bundle / "heads.json", stage / "public", stage / "body-input-receipt.json"])
    write_json(stage / "delivered-verification.json", verification)
    return changed


def install(stage, changed):
    # Every replacement exists and is readable before changing the checkout.
    # Retain the original bytes for recovery if any of the atomic swaps fails.
    backups = stage / "previous"
    for relative in changed:
        dest = backups / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, dest)
    installed = []
    try:
        for relative in changed:
            scratch = stage / "swap.pending"
            shutil.copyfile(stage / relative, scratch)
            os.replace(scratch, ROOT / relative)
            installed.append(relative)
    except BaseException:
        for relative in reversed(installed):
            os.replace(backups / relative, ROOT / relative)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("native_task", type=Path)
    parser.add_argument("--install", action="store_true", help="Install the verified staged output into this checkout.")
    args = parser.parse_args()
    pack, passes, verification = verify_bundle(args.bundle, args.native_task)
    (ROOT / "tmp").mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="athletic-v2-bodies-", dir=ROOT / "tmp"))
    print(f"Staging in {stage}", file=sys.stderr, flush=True)
    changed = rebuild(args.bundle, args.native_task, pack, passes, verification, stage)
    if args.install:
        install(stage, changed)
    print(json.dumps({"stage": str(stage), "receipt": str(stage / "body-input-receipt.json"),
                      "installed": args.install, "bodyLayers": 11}, indent=2))


if __name__ == "__main__":
    main()
