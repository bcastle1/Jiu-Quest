"""Offline graph-contract checks; these do not compile HLSL or prove rendering."""
import ast
import hashlib
from pathlib import Path
import types
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'Content/Python/import_pilot.py'
FROZEN_SHA256 = '08584b75c79a341263c518472da109e6053f50d8be541d1f506578e9e43d5be5'


class Node:
    def __init__(self, kind, index=0):
        self.kind, self.index, self.properties = kind, index, {}

    def set_editor_property(self, name, value):
        self.properties[name] = value

    def get_editor_property(self, name):
        return self.properties[name]

    def get_path_name(self):
        return 'OfflineGraph:%s:%s' % (self.kind, self.index)

    def set_material_function(self, function):
        self.properties['function'] = function
        return True


class Symbols:
    def __getattr__(self, name):
        return name


class PantsMaterialTests(unittest.TestCase):
    def setUp(self):
        self.nodes, self.links, self.properties = [], [], []
        self.tamper = False
        def create(_material, kind):
            result = Node(kind, len(self.nodes)); self.nodes.append(result); return result
        def link(a, output, b, input_name):
            self.links.append((a, output, b, input_name)); return True
        def prop(node, output, target):
            self.properties.append((node, output, target)); return True
        def recompile(_material):
            if self.tamper:
                for node in self.nodes:
                    if node.kind == 'Custom': node.properties['code'] += '// changed after compile'
        sdk = types.SimpleNamespace(
            AssetToolsHelpers=types.SimpleNamespace(get_asset_tools=lambda: types.SimpleNamespace(
                create_asset=lambda *_: Node('Material'))),
            MaterialEditingLibrary=types.SimpleNamespace(create_material_expression=create,
                set_base_material_usage=lambda *_: True, connect_material_expressions=link,
                connect_material_property=prop, layout_material_expressions=lambda *_: None,
                recompile_material=recompile,
                get_material_expression_input_names=lambda node: [item.properties['input_name'] for item in node.properties['inputs']]),
            EditorAssetLibrary=types.SimpleNamespace(save_loaded_asset=lambda *_: None),
            MaterialFactoryNew=lambda: object(), CustomInput=lambda: Node('Input'),
            LinearColor=lambda *values: values, load_asset=lambda path: path,
            Material='Material', MaterialShadingModel=Symbols(), MaterialUsage=Symbols(),
            MaterialProperty=Symbols(), MaterialSamplerType=Symbols(), CustomMaterialOutputType=Symbols())
        for name in ('MakeMaterialAttributes', 'Constant', 'Constant3Vector', 'Multiply', 'TextureSample',
                     'Custom', 'Normalize', 'MaterialFunctionCall', 'TextureCoordinate'):
            setattr(sdk, 'MaterialExpression'+name, name)
        tree = ast.parse(SCRIPT.read_text(encoding='utf-8'))
        selected = [node for node in tree.body if
                    isinstance(node, ast.FunctionDef) and node.name in ('check', 'digest', 'make_material')
                    or isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                    and node.targets[0].id in ('PANTS_NORMAL_CODE', 'PANTS_NORMAL_SHA256',
                                               'JACKET_NORMAL_CODE', 'JACKET_NORMAL_SHA256')]
        self.namespace = {'unreal': sdk, 'hashlib': hashlib, 'REPORT': {'materialGraphs': []}}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(SCRIPT), 'exec'), self.namespace)
        self.spec = {'name': 'JQ_Attacker_GiPants', 'doubleSided': False, 'baseColor': [.7,.7,.7,1.],
                     'roughness': .85, 'metallic': 0., 'colorTexture': None, 'roughnessTexture': None,
                     'normalTexture': {'image': 0, 'uv': 1, 'scale': 1.7}}

    def material(self, name=None):
        spec = {**self.spec, 'name': name or self.spec['name']}
        return self.namespace['make_material'](spec, [{'sha256': 'texture-hash'}], Path('.'),
                                                '/OfflineGraph', {('texture-hash', 'normal'): object()})

    def test_shader_matches_frozen_visually_reviewed_code_and_is_recipe_hashed(self):
        self.assertEqual(self.namespace['PANTS_NORMAL_SHA256'], FROZEN_SHA256)
        self.assertEqual(hashlib.sha256(self.namespace['PANTS_NORMAL_CODE'].encode()).hexdigest(), FROZEN_SHA256)
        tree = ast.parse(SCRIPT.read_text(encoding='utf-8'))
        pipeline = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'glb_with_selected_hair')
        self.assertIn('import_pilot.py', [node.value for node in ast.walk(pipeline) if isinstance(node, ast.Constant)])

    def test_pants_route_keeps_fine_normal_strength_and_uv1_world_basis(self):
        material = self.material()
        custom = next(node for node in self.nodes if node.kind == 'Custom')
        normal = next(node for node in self.nodes if node.kind == 'TextureSample')
        uv = next(node for node in self.nodes if node.kind == 'TextureCoordinate')
        basis = next(node for node in self.nodes if node.kind == 'MaterialFunctionCall')
        normalize = next(node for node in self.nodes if node.kind == 'Normalize')
        self.assertIn((normal, 'RGB', custom, 'FineNormal'), self.links)
        self.assertIn((uv, '', custom, 'AtlasUV'), self.links)
        self.assertIn((uv, '', normal, 'UVs'), self.links)
        self.assertIn((uv, '', basis, 'UVs'), self.links)
        self.assertIn((normalize, '', basis, 'Normal'), self.links)
        self.assertEqual(uv.properties['coordinate_index'], 1)
        self.assertFalse(material.properties['tangent_space_normal'])
        self.assertTrue(any(node.kind == 'Constant3Vector' and node.properties['constant'] == (1.7,1.7,1.,1.) for node in self.nodes))
        self.assertTrue(any(a is basis and output == 'World Space Normal' and pin == 'Normal' for a,output,_b,pin in self.links))
        self.assertFalse(any(pin in ('WorldPositionOffset', 'Displacement') for _a,_o,_b,pin in self.links))
        row = self.namespace['REPORT']['pantsReliefGraphs'][0]
        self.assertEqual(row['readbackSha256'], FROZEN_SHA256)
        self.assertEqual(row['inputs'], ['AtlasUV','FineNormal'])

    def test_other_surfaces_do_not_get_pants_shader_or_pants_metadata(self):
        for name in ('JQ_Attacker_GiTop', 'JQ_Attacker_Belt', 'JQ_Attacker_Skin_Ref_Light'):
            with self.subTest(name=name):
                self.material(name)
                self.assertNotIn('pantsReliefGraphs', self.namespace['REPORT'])
                self.assertIsNone(self.namespace['REPORT']['materialGraphs'][-1]['pantsFoldRelief'])
        self.assertFalse(any(node.properties.get('code') == self.namespace['PANTS_NORMAL_CODE'] for node in self.nodes))

    def test_changed_shader_readback_fails_instead_of_reporting_frozen_match(self):
        self.tamper = True
        with self.assertRaisesRegex(RuntimeError, 'Trouser shader readback changed'):
            self.material()
        self.assertNotIn('pantsReliefGraphs', self.namespace['REPORT'])

    def test_pants_normal_atlas_rejects_a_different_uv_channel(self):
        self.spec['normalTexture']['uv'] = 0
        with self.assertRaisesRegex(RuntimeError, 'Cloth normal atlas must use UV1'):
            self.material()


if __name__ == '__main__':
    unittest.main()
