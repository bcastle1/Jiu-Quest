"""Actual-source preservation and forward-grip checks, without Unreal."""
from pathlib import Path
import json
import math
import struct
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0, str(PROJECT / "Content/Python"))
from ready_hands import refine_ready_hands, _Scene, _angle
from pilot_source import select_hair


class ReadyHandsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "public/animations/bjj/standing_stance.glb").read_bytes()
        cls.result, cls.proof = refine_ready_hands(cls.source, "standing_stance")

    def test_only_allowlisted_rotation_bytes_change(self):
        before, after = _Scene(self.source), _Scene(self.result)
        self.assertEqual(before.doc, after.doc)
        allowed = bytearray(len(self.source))
        self.assertEqual(len(self.proof["changedChannels"]), 64)
        for row in self.proof["changedChannels"]:
            self.assertRegex(row["joint"], r"^(hand_[lr]|(?:index|middle|ring|pinky|thumb)_0[123]_[lr])$")
            start, end, _, _ = before.span(row["accessor"])
            allowed[start:end] = b"\1" * (end-start)
        self.assertTrue(any(a != b for a, b in zip(self.source, self.result)))
        self.assertTrue(all(a == b or allowed[i] for i, (a, b) in enumerate(zip(self.source, self.result))))
        for role in ("Attacker", "Defender"):
            for seconds in (0., .45, .9, 1.35, 1.8):
                a, b = before.pose(seconds), after.pose(seconds)
                for name in ("root", "pelvis", "Head", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r"):
                    node = before.joints[role][name]
                    self.assertEqual(a[node][1], b[node][1], name)
                    if not name.startswith("hand_"):
                        self.assertEqual(a[node][0], b[node][0], name)

    def test_forward_fingers_open_thumb_and_bounded_wrist_swing(self):
        self.assertEqual(self.proof["sampledTimes"], 109)
        self.assertEqual(self.proof["maximumProtectedJointPositionChangeMeters"], 0.)
        for hand in self.proof["hands"]:
            self.assertLessEqual(hand["wristSwingDegrees"], 55.)
            self.assertGreaterEqual(hand["afterPitchDegrees"]["min"], 0.)
            self.assertLessEqual(hand["afterPitchDegrees"]["max"], 6.)
            self.assertGreater(hand["afterForwardDot"]["min"], .98)
            self.assertGreater(hand["thumbIndexTipGapMeters"]["min"], .025)
        scene = _Scene(self.result)
        for row in self.proof["changedChannels"]:
            values = scene.values[row["accessor"]]
            self.assertLess(_angle(values[0], values[-1]), .001, "Standing loop must close")
            for q in values:
                self.assertAlmostEqual(math.sqrt(sum(x*x for x in q)), 1., places=6)

    def test_ground_techniques_are_exact_and_not_parsed_or_reauthored(self):
        for clip in ("rear_naked_choke", "armbar"):
            source = (ROOT / "public/animations/bjj" / (clip+".glb")).read_bytes()
            result, proof = refine_ready_hands(source, clip)
            self.assertIs(result, source)
            self.assertEqual(result, source)
            self.assertEqual(proof["changedChannels"], [])

    def test_composes_after_hair_selection_without_altering_its_json(self):
        selected, _ = select_hair(self.source)
        result, proof = refine_ready_hands(selected, "standing_stance")
        self.assertEqual(_Scene(selected).doc, _Scene(result).doc)
        self.assertEqual(proof["hands"], self.proof["hands"])

    def test_rejects_repeated_application_and_changed_source_inventory(self):
        with self.assertRaisesRegex(ValueError, "already applied"):
            refine_ready_hands(self.result, "standing_stance")
        with self.assertRaisesRegex(ValueError, "Invalid standing GLB"):
            refine_ready_hands(self.source[:-4], "standing_stance")
        scene = _Scene(self.source)
        scene.doc["nodes"][scene.joints["Attacker"]["index_01_l"]]["name"] = "unexpected_joint"
        encoded = json.dumps(scene.doc, separators=(",", ":")).encode()
        encoded += b" " * (-len(encoded) % 4)
        suffix = self.source[scene.binary_start-8:]
        raw = struct.pack("<III", 0x46546C67, 2, 20+len(encoded)+len(suffix))
        raw += struct.pack("<II", len(encoded), 0x4E4F534A)+encoded+suffix
        with self.assertRaisesRegex(ValueError, "Missing finger joint"):
            refine_ready_hands(raw, "standing_stance")


if __name__ == "__main__":
    unittest.main()
