"""Offline graph and scalar HLSL-field checks; actual UE renders remain required."""
import ast
import hashlib
import math
import re
import types
import unittest

import test_pants_material as graph_fixture

SCRIPT = graph_fixture.SCRIPT
FROZEN_SHA256 = 'f8432d90832305cf0a0dc6a5ad8dcaaa3b54d71298e78f2bd20e12ae0332b56d'


def scalar_field(code):
    """Evaluate the shader's straight-line scalar functions, not a second field."""
    def smoothstep(a, b, value):
        t = max(0., min(1., (value-a)/(b-a)))
        return t*t*(3.-2.*t)

    scope = {'sqrt': math.sqrt, 'exp': math.exp, 'min': min, 'max': max, 'abs': abs,
             'smoothstep': smoothstep, 'step': lambda edge, value: float(value >= edge),
             'lerp': lambda a, b, t: a+(b-a)*t,
             'saturate': lambda value: max(0., min(1., value))}

    def statements(text):
        text = re.sub(r'//[^\n]*', '', text)
        return [re.sub(r'^float\s+', '', ' '.join(item.split()))
                for item in text.split(';') if item.strip()]

    for name, arguments in (('roundedPlane', 'r'), ('ridge', 'distance, width'),
                            ('height', 'p, sleeve')):
        match = re.search(r'float '+name+r'\([^)]*\)\s*\{(.*?)\}', code, re.S)
        if not match:
            raise AssertionError('Scalar shader function inventory changed: '+name)
        program = 'def '+name+'('+arguments+'):\n'
        program += '\n'.join('    '+line for line in statements(match.group(1)))
        exec(compile(program, 'reviewed-jacket-scalar-field', 'exec'), scope)
    mask_text = code[code.index('float edge ='):code.index('float epsilon =')]
    mask_program = compile('\n'.join(statements(mask_text)), 'reviewed-jacket-mask', 'exec')

    def field(u, v, sleeve=False, atlas_row=0):
        panel = types.SimpleNamespace(x=u, y=v)
        values = {**scope, 'panel': panel,
                  'cell': types.SimpleNamespace(x=int(sleeve), y=atlas_row)}
        exec(mask_program, values)
        mask = values['mask']
        sample = lambda x, y: scope['height'](types.SimpleNamespace(x=x, y=y), float(sleeve))
        dx = (sample(u+.002, v)-sample(u-.002, v))/.004
        dy = (sample(u, v+.002)-sample(u, v-.002))/.004
        extra = (-1.45*mask*dx, 1.45*mask*dy)
        scale = min(1., .40/max(math.hypot(*extra), .000001))
        return mask, tuple(x*scale for x in extra), sample(u, v)

    return field


class JacketMaterialTests(unittest.TestCase):
    def setUp(self):
        self.graph = graph_fixture.PantsMaterialTests()
        self.graph.setUp()
        self.code = self.graph.namespace['JACKET_NORMAL_CODE']
        self.field = scalar_field(self.code)

    def test_frozen_shader_hash_and_existing_normal_limits(self):
        self.assertEqual(self.graph.namespace['JACKET_NORMAL_SHA256'], FROZEN_SHA256)
        self.assertEqual(hashlib.sha256(self.code.encode()).hexdigest(), FROZEN_SHA256)
        self.assertIn('float epsilon = 0.002;', self.code)
        self.assertIn('float2 extra = 1.45 * mask * float2(-dx, dy);', self.code)
        self.assertIn('extra *= min(1.0, 0.40 / max(length(extra), 0.000001));', self.code)
        self.assertIn('return float3(FineNormal.xy + extra, FineNormal.z);', self.code)
        tree = ast.parse(SCRIPT.read_text(encoding='utf-8'))
        pipeline = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == 'glb_with_selected_hair')
        self.assertIn('import_pilot.py', [n.value for n in ast.walk(pipeline)
                                        if isinstance(n, ast.Constant)])

    def test_opening_collar_hem_shoulder_and_cuff_support_stays_zero(self):
        for u in (0., .03, .06, .94, .97, 1.):
            for v in (.3, .43, .6):
                self.assertAlmostEqual(self.field(u, v)[0], 0., places=12)
        for u in (.2, .5, .8):
            for v in (0., .1, .18, .76, .9, 1.):
                self.assertEqual(self.field(u, v)[0], 0.)
        for u in (.12, .25, .4, .7, .9):
            for v in (0., .2, .34, .86, .95, 1.):
                self.assertEqual(self.field(u, v, sleeve=True)[0], 0.)
        for sleeve in (False, True):
            self.assertEqual(self.field(.25, .55, sleeve, atlas_row=1)[0], 0.)

    def test_forward_elbow_support_expands_without_filling_side_gap(self):
        self.assertEqual(self.field(.25, .55, sleeve=True)[0], 1.)
        self.assertEqual(self.field(.70, .55, sleeve=True)[0], 1.)
        self.assertEqual(self.field(.48, .55, sleeve=True)[0], 0.)
        self.assertGreater(math.hypot(*self.field(.25, .55, sleeve=True)[1]), .10)

    def test_back_panel_and_rear_sleeve_match_accepted_field_samples(self):
        # Frozen numeric samples from the previous accepted material. These
        # regions must retain their existing folds while the front is refined.
        samples = [
            (.5, .46, False, (.019641575226127087, .12420270155302533)),
            (.68, .48, False, (.11568870955265198, .03389583674271065)),
            (.7, .52, True, (-.000437702299692182, .0024519488913666036)),
            (.8, .67, True, (.010305153986382242, .07359327616104715))]
        for u, v, sleeve, accepted in samples:
            with self.subTest(u=u, v=v, sleeve=sleeve):
                for value, before in zip(self.field(u, v, sleeve)[1], accepted):
                    self.assertAlmostEqual(value, before, places=12)

    def test_front_tension_fans_are_visible_and_deliberately_unequal(self):
        # Subtract the accepted heights at the mirrored front samples. The
        # authored addition should reach both sides without duplicating them.
        left = self.field(.11, .43)[2] - .0026266894492852706
        right = self.field(.89, .43)[2] - .000000010179583580048131
        self.assertGreater(left, .009)
        self.assertGreater(right, .007)
        self.assertAlmostEqual(right/left, .78, places=12)

    def test_added_field_is_finite_and_capped_across_both_panels(self):
        for sleeve in (False, True):
            peak = 0.
            for iu in range(51):
                for iv in range(51):
                    _, extra, height = self.field(iu/50., iv/50., sleeve)
                    self.assertTrue(all(math.isfinite(x) for x in (*extra, height)))
                    length = math.hypot(*extra)
                    self.assertLessEqual(length, .400000000001)
                    peak = max(peak, length)
            self.assertGreater(peak, .15)

    def test_graph_keeps_weave_strength_roughness_and_world_uv1_basis(self):
        self.graph.spec['doubleSided'] = True
        material = self.graph.material('JQ_Defender_GiTop')
        custom = next(n for n in self.graph.nodes if n.kind == 'Custom')
        normal = next(n for n in self.graph.nodes if n.kind == 'TextureSample')
        uv = next(n for n in self.graph.nodes if n.kind == 'TextureCoordinate')
        basis = next(n for n in self.graph.nodes if n.kind == 'MaterialFunctionCall')
        normalized = next(n for n in self.graph.nodes if n.kind == 'Normalize')
        self.assertEqual(custom.properties['code'], self.code)
        self.assertIn((normal, 'RGB', custom, 'FineNormal'), self.graph.links)
        self.assertIn((uv, '', custom, 'AtlasUV'), self.graph.links)
        self.assertIn((uv, '', normal, 'UVs'), self.graph.links)
        self.assertIn((uv, '', basis, 'UVs'), self.graph.links)
        self.assertIn((normalized, '', basis, 'Normal'), self.graph.links)
        self.assertEqual(uv.properties['coordinate_index'], 1)
        self.assertFalse(material.properties['tangent_space_normal'])
        self.assertTrue(material.properties['two_sided'])
        self.assertTrue(any(n.kind == 'Constant3Vector' and
                            n.properties['constant'] == (1.7, 1.7, 1., 1.)
                            for n in self.graph.nodes))
        self.assertTrue(any(a.kind == 'Constant' and a.properties['r'] == .85
                            and pin == 'Roughness' for a, _o, _b, pin in self.graph.links))
        self.assertFalse(any(pin in ('WorldPositionOffset', 'Displacement')
                             for _a, _o, _b, pin in self.graph.links))
        metadata = self.graph.namespace['REPORT']['materialGraphs'][-1]['jacketFoldRelief']
        self.assertEqual(metadata['shaderSha256'], FROZEN_SHA256)

    def test_six_role_clip_graphs_record_actual_code_readback(self):
        for _clip in ('standing_stance', 'rear_naked_choke', 'armbar'):
            for role in ('Attacker', 'Defender'):
                self.graph.material('JQ_'+role+'_GiTop')
        rows = self.graph.namespace['REPORT']['jacketReliefGraphs']
        self.assertEqual(len(rows), 6)
        self.assertTrue(all(r['actualCodeMatchesFrozenShader'] and
                            r['shaderSha256'] == r['readbackSha256'] == FROZEN_SHA256
                            and r['inputs'] == ['AtlasUV', 'FineNormal'] for r in rows))

    def test_compile_readback_tampering_fails_closed(self):
        self.graph.tamper = True
        with self.assertRaisesRegex(RuntimeError, 'Jacket shader readback changed'):
            self.graph.material('JQ_Attacker_GiTop')
        self.assertNotIn('jacketReliefGraphs', self.graph.namespace['REPORT'])

    def test_wrong_uv_is_still_rejected(self):
        self.graph.spec['normalTexture']['uv'] = 0
        with self.assertRaisesRegex(RuntimeError, 'Cloth normal atlas must use UV1'):
            self.graph.material('JQ_Attacker_GiTop')


if __name__ == '__main__':
    unittest.main()
