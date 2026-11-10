"""Appearance factors are tested without starting Unreal or creating assets."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch


class LocalPreviewMaterialTests(unittest.TestCase):
    def setUp(self):
        self.duplicate = Mock()
        unreal = types.SimpleNamespace(
            LinearColor=lambda r,g,b,a: types.SimpleNamespace(r=r,g=g,b=b,a=a),
            AssetToolsHelpers=types.SimpleNamespace(get_asset_tools=lambda:
                types.SimpleNamespace(duplicate_asset=self.duplicate)))
        path = Path(__file__).resolve().parents[1] / 'Content/Python/local_preview_materials.py'
        spec = importlib.util.spec_from_file_location('local_material_test_subject', path)
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, unreal=unreal):
            spec.loader.exec_module(self.module)

    @staticmethod
    def decode(hex_value):
        values = [int(hex_value[i:i+2], 16)/255 for i in (1,3,5)]
        return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]

    def test_reference_skin_is_a_neutral_factor_not_a_second_skin_tint(self):
        color = self.module.linear_color('#E9B28D', 'skinTone')
        self.assertEqual((color.r,color.g,color.b,color.a), (.82,.82,.82,1.))

    def test_factor_reconstructs_requested_linear_skin_from_baked_reference(self):
        for target in ('#d99b71', '#714832', '#f4d9c5', '#000000'):
            with self.subTest(target=target):
                factor = self.module.linear_color(target, 'skinTone')
                decoded = self.decode(target)
                reference = self.decode('#E9B28D')
                for channel,ref,wanted in zip((factor.r,factor.g,factor.b),reference,decoded):
                    self.assertAlmostEqual(channel*ref,wanted*.82,places=12)

    def test_cloth_uses_existing_color_factor(self):
        color = self.module.linear_color('#ffffff', 'giPants')
        self.assertEqual((color.r,color.g,color.b),(.72,.72,.72))

    def test_unknown_baked_skin_reference_is_rejected_before_asset_mutation(self):
        source = types.SimpleNamespace(get_name=lambda: 'M_JQ_Attacker_Skin_Ref_FFEEDD')
        with self.assertRaisesRegex(RuntimeError, 'Unsupported baked skin reference'):
            self.module.parameter_copy(source, '/Game/LocalTest', 'Copy')
        self.duplicate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
