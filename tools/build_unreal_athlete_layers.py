"""Build the tintable Unreal athlete layers from the pinned front reference passes.

The page adds the layers together, each multiplied by a color the player chose:

    picture = base + jacket * giTop + pants * giPants + belt * beltColor

base    gi-black.png: black gi, black belt, exactly as rendered
jacket  (gi-white - gi-black) above the jacket hem, gi region only
pants   (gi-white - gi-black) below the jacket hem, gi region only
belt    (belt-white - gi-black), belt region only

Use tools/rebuild_athletic_v2_bodies.py to verify the catalog, materialize the
aliases and supply --protected-hem, --protected-hem-report and
--protected-hem-proof. The source SHA-256 values are pinned below and in
src/unreal/athlete.js. The V2 path uses Pillow and NumPy. The legacy adaptive
classifier also requires SciPy.
"""
import argparse
import hashlib
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

SOURCES = {
    "gi-white.png": "0d313620a258884d4a3e527bd93d217993696df3ed876ba61215b7fa45435887",
    "gi-black.png": "25b27b4777c62fc5554ed2619f64b2d8ee9c50ababc2bea285b4f649e6056570",
    "belt-white.png": "cfcd6f89f2dd4ebd8952e06c474af890ec98ff00419a9d609ba97ab5e172bd09",
}
# The athlete inside the 2400 x 3000 render: left, top, width, height.
CROP = (538, 166, 1400, 2738)
# Published layer size. Same proportions as the crop.
SIZE = (900, 1760)
# Render rows that bracket the jacket hem.
HEM_ROWS = (1440, 1570)

# Bounded Athletic V2 evidence, not replacement image-source pins. The report
# binds the original-face reference's camera, pose, CVARs, config and all PNGs.
PROTECTED_HEM_EVIDENCE = {
    "classification": (21950, "9de42ba850fbd04128dbdc50314dbfcc02afc817e6b184eda38bc9164776934d"),
    "report": (55145, "2cbb1e4fdbc4abcf09648d7258bf4569e1b51b5638a4ae9d9aa7abc1ee7399c7"),
    "proof": (5980, "7f41c90ef54a846dca4226640491ec80a4afd91f1388c0f2ae49d6460ea736bf"),
}


def require(value, message):
    if not value:
        raise SystemExit(message)


def checked_evidence(path, kind):
    path = pathlib.Path(path)
    data = path.read_bytes()
    descriptor = {"file": str(path.resolve()), "bytes": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}
    require((descriptor["bytes"], descriptor["sha256"]) == PROTECTED_HEM_EVIDENCE[kind],
            f"Protected hem {kind} is not the reviewed evidence; revalidate applicability")
    return json.loads(data.decode("utf-8-sig")), descriptor


def protected_hem(classification_path, report_path, proof_path):
    classification, classification_file = checked_evidence(classification_path, "classification")
    report, report_file = checked_evidence(report_path, "report")
    proof, proof_file = checked_evidence(proof_path, "proof")
    require(CROP == (538, 166, 1400, 2738) and SIZE == (900, 1760) and HEM_ROWS == (1440, 1570),
            "Protected hem is not applicable to changed front crop, size or search rows")
    require(classification.get("crop") == list(CROP) and classification.get("publishedSize") == list(SIZE)
            and classification.get("hemSearchAbsoluteRenderRows") == list(HEM_ROWS)
            and classification.get("coordinates") == "cropped native front pixels; absolute render row is row + 166",
            "Protected hem coordinate frame differs")
    hem = np.asarray(classification.get("rows"), dtype=np.float64)
    require(hem.shape == (CROP[2],) and np.isfinite(hem).all()
            and np.all((hem >= HEM_ROWS[0] - CROP[1]) & (hem < HEM_ROWS[1] - CROP[1])),
            "Protected hem must contain 1,400 finite cropped-native rows in the reviewed bracket")

    athletic = report.get("athletic", {})
    plan = report.get("plan", {})
    require(report.get("status") == "complete" and report.get("job") == "fc_front"
            and report.get("assetSaves") is False and report.get("pixelsEdited") is False
            and athletic.get("mode") == "candidate"
            and athletic.get("configSha256") == "7ba0ed3be16366e8d15ab5ea14d6a454e11d5bb571b839de54216e547ceff3f4"
            and athletic.get("planSha256") == "131522e8fc472a91a762ab6d59634a295ddf68bb71a1ab5185adfbec1feeb635"
            and plan.get("size") == [2400, 3000] and plan.get("camera") == "front"
            and plan.get("samples") == 64 and len(plan.get("shots", [])) == 3
            and all(shot.get("athleticFace") == "original" for shot in plan["shots"]),
            "Protected hem requires the verified V2 original-face front reference")
    asset = next((row for row in proof.get("assets", []) if row.get("name") == "front-gi"), {})
    replacement = next((row for row in athletic.get("replacements", []) if row.get("part") == "outfit"), {})
    require(proof.get("status") == "offline_geometry_checks_passed_not_rendered"
            and asset.get("checks", {}).get("lowerGarmentAndCuffsExact") is True
            and classification.get("geometryCheck", {}).get("lowerGarmentAndCuffsExact") is True
            and classification.get("geometryCheck", {}).get("protectedSourceVertexZMaximumCm") == 110
            and asset.get("source") and asset.get("target")
            and replacement.get("source") == asset["source"] and replacement.get("target") == asset["target"],
            "Protected hem proof does not preserve this candidate's front outfit and cuffs")
    outputs = report.get("outputs", [])
    expected = {row["pass"] + ".png": row["sha256"] for row in outputs}
    require(len(outputs) == 3 and expected == SOURCES,
            "Protected hem requires explicit fresh V2 source pins in this builder and athlete.js; old passes are refused")
    require(all(row.get("width") == 2400 and row.get("height") == 3000 for row in outputs),
            "Protected hem native output dimensions differ")
    return hem, {"classification": classification_file, "nativeReport": report_file,
                 "geometryProof": proof_file, "source": asset["source"], "target": asset["target"],
                 "nativeSources": {row["pass"] + ".png": {key: row[key] for key in ("bytes", "sha256")} for row in outputs},
                 "baselinePixelsCopied": False, "candidateBaseAndBeltUnchanged": True}


def split_gi(delta, hem):
    above = np.clip((hem[None, :] + 2.0 - np.arange(delta.shape[0])[:, None]) / 4.0, 0, 1)
    jacket = delta * above[..., None]
    pants = delta * (1 - above)[..., None]
    require(np.allclose(jacket + pants, delta, rtol=0, atol=1e-12),
            "Hem classification changed the fresh candidate gi light")
    return jacket, pants


def load(folder, name):
    path = pathlib.Path(folder) / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCES[name]:
        raise SystemExit(f"{name} is not the pinned render ({digest})")
    left, top, width, height = CROP
    image = Image.open(path)
    require(image.format == "PNG" and image.size == (2400, 3000), "Expected a full-size native front PNG")
    pixels = np.asarray(image.convert("RGB")).astype(np.float64)
    return pixels[top:top + height, left:left + width]


def soft(mask, median, blur, grow=0):
    image = Image.fromarray(mask).filter(ImageFilter.MedianFilter(median))
    if grow:
        image = image.filter(ImageFilter.MaxFilter(grow))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(blur))).astype(np.float64) / 255


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output", nargs="?", default="public/assets/unreal-athlete/athlete-01")
    parser.add_argument("--protected-hem")
    parser.add_argument("--protected-hem-report")
    parser.add_argument("--protected-hem-proof")
    args = parser.parse_args()
    protected = (args.protected_hem, args.protected_hem_report, args.protected_hem_proof)
    require(all(protected) or not any(protected), "Protected hem requires classification, native report and geometry proof together")
    # Once the pins are switched to Athletic V2, a normal rebuild must not
    # silently re-enable the darkest-row heuristic that split the jacket tip.
    if SOURCES["gi-black.png"] == "25b27b4777c62fc5554ed2619f64b2d8ee9c50ababc2bea285b4f649e6056570":
        require(all(protected), "Athletic V2 requires the protected hem classification, front reference report and geometry proof")
    inherited_hem, protection = protected_hem(*protected) if all(protected) else (None, None)
    source = args.source
    output = pathlib.Path(args.output)
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

    if inherited_hem is not None:
        hem = inherited_hem
        hem_columns = None  # The protected boundary spans all crop columns.
    else:
        from scipy.ndimage import median_filter
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
        hem_columns = [int(columns[steady].min()) + left, int(columns[steady].max()) + left]
    jacket, pants = split_gi(delta, hem)

    report = {"crop": list(CROP), "size": list(SIZE), "hemRows": [round(float(hem.min()) + top, 1), round(float(hem.max()) + top, 1)],
              "hemColumns": hem_columns,
              "giPixels": int((gi > 0.5).sum()), "beltPixels": int((belt_region > 0.5).sum()), "files": {}}
    if protection:
        report["hemProtection"] = {**protection, "freshClothLightConserved": True}
    output.mkdir(parents=True, exist_ok=True)
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
