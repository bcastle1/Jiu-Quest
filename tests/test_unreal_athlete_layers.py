"""Run with Python unittest; exercises protected-hem rejection and pixel conservation."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

SPEC = importlib.util.spec_from_file_location(
    "athlete_layers", pathlib.Path(__file__).resolve().parents[1] / "tools/build_unreal_athlete_layers.py")
layers = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(layers)


class ProtectedHemTests(unittest.TestCase):
    def setUp(self):
        self.classification = {
            "crop": list(layers.CROP), "publishedSize": list(layers.SIZE),
            "hemSearchAbsoluteRenderRows": list(layers.HEM_ROWS),
            "coordinates": "cropped native front pixels; absolute render row is row + 166",
            "rows": [1334.0] * 1400,
            "geometryCheck": {"lowerGarmentAndCuffsExact": True, "protectedSourceVertexZMaximumCm": 110},
        }
        self.report = {
            "status": "complete", "job": "fc_front", "assetSaves": False, "pixelsEdited": False,
            "plan": {"size": [2400, 3000], "camera": "front", "samples": 64,
                     "shots": [{"athleticFace": "original"} for _ in range(3)]},
            "athletic": {
                "mode": "candidate",
                "configSha256": "7ba0ed3be16366e8d15ab5ea14d6a454e11d5bb571b839de54216e547ceff3f4",
                "planSha256": "131522e8fc472a91a762ab6d59634a295ddf68bb71a1ab5185adfbec1feeb635",
                "replacements": [{"part": "outfit", "source": "test-source", "target": "test-target"}],
            },
            "outputs": [{"pass": name, "bytes": 10, "sha256": str(i) * 64, "width": 2400, "height": 3000}
                        for i, name in enumerate(("gi-white", "gi-black", "belt-white"))],
        }
        self.proof = {"status": "offline_geometry_checks_passed_not_rendered", "assets": [
            {"name": "front-gi", "source": "test-source", "target": "test-target",
             "checks": {"lowerGarmentAndCuffsExact": True}}]}
        self.sources = {row["pass"] + ".png": row["sha256"] for row in self.report["outputs"]}

    def checked(self, _path, kind):
        return {"classification": self.classification, "report": self.report, "proof": self.proof}[kind], {"kind": kind}

    def validate(self):
        with patch.object(layers, "checked_evidence", side_effect=self.checked), patch.object(layers, "SOURCES", self.sources):
            return layers.protected_hem("boundary", "native-report", "geometry-proof")

    def test_only_classification_rows_are_returned(self):
        hem, receipt = self.validate()
        np.testing.assert_array_equal(hem, self.classification["rows"])
        self.assertFalse(receipt["baselinePixelsCopied"])
        self.assertEqual(receipt["nativeSources"]["gi-white.png"]["sha256"], self.sources["gi-white.png"])

    def test_old_source_pins_are_refused(self):
        with patch.object(layers, "checked_evidence", side_effect=self.checked):
            with self.assertRaisesRegex(SystemExit, "fresh V2 source pins"):
                layers.protected_hem("boundary", "native-report", "geometry-proof")

    def test_wrong_frame_and_invalid_rows_are_refused(self):
        original = copy.deepcopy(self.classification)
        for update in ({"crop": [538, 165, 1400, 2738]}, {"rows": [1334.0] * 1399},
                       {"rows": [float("nan")] * 1400}, {"rows": [1500.0] * 1400}):
            with self.subTest(update=list(update)):
                self.classification = {**original, **update}
                with self.assertRaises(SystemExit):
                    self.validate()

    def test_different_outfit_or_lower_garment_proof_is_refused(self):
        self.report["athletic"]["replacements"][0]["target"] = "different-outfit"
        with self.assertRaisesRegex(SystemExit, "front outfit and cuffs"):
            self.validate()
        self.report["athletic"]["replacements"][0]["target"] = "test-target"
        self.proof["assets"][0]["checks"]["lowerGarmentAndCuffsExact"] = False
        with self.assertRaisesRegex(SystemExit, "front outfit and cuffs"):
            self.validate()

    def test_dean_pilot_cannot_replace_original_reference(self):
        self.report["plan"]["shots"][0]["athleticFace"] = "dean"
        with self.assertRaisesRegex(SystemExit, "original-face front reference"):
            self.validate()

    def test_evidence_bytes_cannot_change_after_pinning(self):
        with tempfile.TemporaryDirectory() as folder:
            file = pathlib.Path(folder) / "report.json"
            data = json.dumps(self.report).encode()
            file.write_bytes(data)
            pin = (len(data), hashlib.sha256(data).hexdigest())
            with patch.dict(layers.PROTECTED_HEM_EVIDENCE, {"report": pin}):
                layers.checked_evidence(file, "report")
                self.report["plan"]["camera"] = "side"
                file.write_text(json.dumps(self.report))
                with self.assertRaisesRegex(SystemExit, "not the reviewed evidence"):
                    layers.checked_evidence(file, "report")

    def test_split_conserves_fresh_pixels_without_mutating_inputs(self):
        delta = np.random.default_rng(42).random((9, 5, 3)) * 255
        before = delta.copy()
        jacket, pants = layers.split_gi(delta, np.full(5, 4.0))
        np.testing.assert_array_equal(delta, before)
        np.testing.assert_allclose(jacket + pants, before, rtol=0, atol=1e-12)
        np.testing.assert_array_equal(jacket[0], before[0])
        np.testing.assert_array_equal(pants[-1], before[-1])
        np.testing.assert_array_equal(jacket[4], before[4] * 0.5)


if __name__ == "__main__":
    unittest.main()
