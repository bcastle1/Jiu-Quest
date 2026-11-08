import json
from pathlib import Path
import struct
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0, str(PROJECT / "Content/Python"))
from pilot_source import select_hair


def chunks(raw):
    size = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + size]), raw[20 + size:]


class SourceSelectionTests(unittest.TestCase):
    def test_all_three_actual_clips_preserve_every_non_hair_field_and_binary(self):
        pinned = json.loads((PROJECT / "pilot-assets.json").read_text())
        for clip in pinned["clips"]:
            with self.subTest(clip=clip["name"]):
                raw = (ROOT / clip["source"]).read_bytes()
                derived, proof = select_hair(raw)
                old, old_bin = chunks(raw); new, new_bin = chunks(derived)
                self.assertEqual(old_bin, new_bin)
                self.assertEqual(len(proof["removedMeshAttachments"]), 8)
                removed = {p["nodeIndex"] for p in proof["removedMeshAttachments"]}
                for key in old:
                    if key != "nodes": self.assertEqual(old[key], new[key])
                for i, (a, b) in enumerate(zip(old["nodes"], new["nodes"])):
                    expected = {k:v for k,v in a.items() if i not in removed or k not in ("mesh", "skin")}
                    self.assertEqual(expected, b)
                for role in ("Attacker", "Defender"):
                    visible = [n["name"] for n in new["nodes"] if n.get("name", "").startswith(f"JQ_{role}_Hair") and "mesh" in n]
                    self.assertEqual(visible, [f"JQ_{role}_HairSlick"])

    def test_malformed_glb_is_rejected(self):
        with self.assertRaises(ValueError): select_hair(b"bad")

    def test_unknown_style_is_rejected(self):
        with self.assertRaises(ValueError): select_hair(b"", "invented")


if __name__ == "__main__":
    unittest.main()
