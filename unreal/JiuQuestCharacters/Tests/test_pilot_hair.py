import ast
import copy
import hashlib
import itertools
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import Mock

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0, str(PROJECT / 'Content/Python'))
from pilot_hair import refine_hair, smooth_frames, unit, dot
from pilot_source import select_hair
from pilot_hair_shape import refine_hair_shape


def unpack(raw):
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+size]), raw[28+size:]


def repack(doc, binary):
    encoded = json.dumps(doc,separators=(',',':')).encode()
    encoded += b' ' *((-len(encoded))%4)
    return struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary)) + struct.pack('<II',len(encoded),0x4e4f534a) + encoded + struct.pack('<II',len(binary),0x004e4942) + binary


def floats(doc, binary, index):
    a = doc['accessors'][index]; v = doc['bufferViews'][a['bufferView']]
    width = {'VEC3':3,'VEC4':4}[a['type']]
    offset = v.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from('<'+'f'*width,binary,offset+i*v.get('byteStride',width*4)) for i in range(a['count'])]


class PilotHairTests(unittest.TestCase):
    def test_actual_clips_only_redirect_selected_hair_shading_accessors(self):
        pinned = json.loads((PROJECT/'pilot-assets.json').read_text())
        for clip,style in itertools.product(pinned['clips'], ('Slick','Spikes')):
            with self.subTest(clip=clip['name'],style=style):
                original = (ROOT/clip['source']).read_bytes()
                raw,selection = select_hair(original,style)
                source,source_bin = unpack(original); selected,selected_bin = unpack(raw)
                self.assertEqual(selected_bin,source_bin)
                expected_selection = copy.deepcopy(source)
                self.assertEqual(len(selection['removedMeshAttachments']),8)
                for row in selection['removedMeshAttachments']:
                    expected_selection['nodes'][row['nodeIndex']].pop('mesh')
                    expected_selection['nodes'][row['nodeIndex']].pop('skin')
                self.assertEqual(selected,expected_selection)
                for role in ('Attacker','Defender'):
                    visible = [n['name'] for n in selected['nodes'] if n.get('name','').startswith('JQ_'+role+'_Hair') and 'mesh' in n]
                    self.assertEqual(visible,['JQ_'+role+'_Hair'+style])
                derived,proof = refine_hair(raw,style)
                old,old_bin = unpack(raw); new,new_bin = unpack(derived)
                self.assertEqual(new_bin[:len(old_bin)],old_bin)
                expected = copy.deepcopy(old)
                for row in proof['primitives']:
                    a = new['meshes'][row['mesh']]['primitives'][row['primitive']]['attributes']
                    previous = old['meshes'][row['mesh']]['primitives'][row['primitive']]['attributes']
                    for key in ('NORMAL','TANGENT'):
                        expected['meshes'][row['mesh']]['primitives'][row['primitive']]['attributes'][key] = a[key]
                    normal = floats(new,new_bin,a['NORMAL']); tangent = floats(new,new_bin,a['TANGENT'])
                    old_tangent = floats(old,old_bin,previous['TANGENT'])
                    self.assertEqual([t[3] for t in tangent],[t[3] for t in old_tangent])
                    self.assertLess(max(abs(dot(n,t[:3])) for n,t in zip(normal,tangent)), .0002)
                    self.assertGreater(row['changedNormalVertices'], 0)
                    self.assertEqual(row['capTrianglesPreserved'],152 if style == 'Slick' else 176)
                    self.assertLess(row['maxNormalRotationDegrees'],36. if style == 'Slick' else 37.)
                expected['accessors'] += new['accessors'][len(old['accessors']):]
                expected['bufferViews'] += new['bufferViews'][len(old['bufferViews']):]
                expected['buffers'][0]['byteLength'] = new['buffers'][0]['byteLength']
                self.assertEqual(new, expected)
                self.assertEqual(len(proof['primitives']),2)
                self.assertTrue(proof['applied'])
                self.assertEqual(proof['selectedHair'],style)

    def test_unreviewed_or_mismatched_style_is_rejected(self):
        original = (ROOT/'public/animations/bjj/standing_stance.glb').read_bytes()
        raw,_ = select_hair(original,'Spikes')
        with self.assertRaisesRegex(ValueError,'shading review'):
            refine_hair(raw,'Crew')
        with self.assertRaisesRegex(ValueError,'selected Slick attachment'):
            refine_hair(raw,'Slick')
        with self.assertRaisesRegex(ValueError,'Missing unique Slick attachment'):
            refine_hair_shape(raw)

    def test_default_import_uses_separate_spikes_shape_contract(self):
        # Exercise the actual importer composition without loading Unreal.
        # Independent hand/cloth passes are isolated here; their tests own those
        # deformations. A Slick shape call must fail this Spikes regression.
        script = PROJECT/'Content/Python/import_pilot.py'
        tree = ast.parse(script.read_text())
        functions = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('check','digest','glb_with_selected_hair')]
        identity = lambda raw,*args: (raw,{'isolatedForDispatchTest':True})
        shape = Mock(side_effect=AssertionError('Spikes must not enter the Slick shape pass'))
        from pilot_hair_shape import refine_spikes_shape
        namespace = {'Path':Path,'hashlib':hashlib,'__file__':str(script),
                     'select_hair':select_hair,'refine_hair':refine_hair,
                     'refine_ready_hands':Mock(side_effect=identity),'refine_look':Mock(side_effect=identity),
                     'refine_hair_shape':shape,'refine_spikes_shape':refine_spikes_shape,
                     'refine_gi_body':Mock(side_effect=identity)}
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(script),'exec'),namespace)
        source = ROOT/'public/animations/bjj/standing_stance.glb'
        original = source.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)/'derived.glb'
            proof = namespace['glb_with_selected_hair'](source,destination)
            expected,_ = select_hair(original,'Spikes'); expected,_ = refine_hair(expected,'Spikes')
            shape_source=hashlib.sha256(expected).hexdigest()
            expected,_=refine_spikes_shape(expected)
            self.assertEqual(destination.read_bytes(),expected)
        self.assertEqual(source.read_bytes(),original)
        shape.assert_not_called()
        self.assertEqual(proof['selectedHair'],'Spikes')
        self.assertEqual(proof['selection']['selectedHair'],'Spikes')
        self.assertEqual(proof['hairShading']['selectedHair'],'Spikes')
        self.assertTrue(proof['hairShape']['applied'])
        self.assertEqual(proof['hairShape']['selectedHair'],'Spikes')
        self.assertEqual(proof['hairShape']['sourceSha256'],shape_source)
        self.assertEqual(proof['hairShape']['importSha256'],proof['importSha256'])
        self.assertTrue(proof['hairShape']['originalBinaryPrefixUnchanged'])
        self.assertTrue(proof['hairShape']['otherMeshesRigAndMotionExact'])
        for row in proof['hairShape']['roles']:
            self.assertEqual(row['primaryLockCount'],9)
            self.assertEqual(row['protectedOriginalVertices'],1523)
            self.assertTrue(row['allRootAndTerminalEdgesExact'])
        self.assertEqual(proof['appliedHelpers'],['pilot_source.select_hair','ready_hands.refine_ready_hands',
            'pilot_look.refine_look','pilot_hair.refine_hair','pilot_hair_shape.refine_spikes_shape',
            'pilot_gi_body.refine_gi_body'])
        namespace['refine_gi_body'].assert_called_once_with(expected, 'standing_stance', 'Spikes')
        recipes = ('import_pilot.py','pilot_source.py','ready_hands.py','pilot_look.py','pilot_hair.py','pilot_hair_shape.py','pilot_gi_body.py')
        self.assertEqual(proof['recipeFiles'],{name:hashlib.sha256(script.with_name(name).read_bytes()).hexdigest() for name in recipes})
        # Explicit Slick remains available for the matched baseline comparison.
        shape.side_effect = identity
        with tempfile.TemporaryDirectory() as directory:
            slick_proof = namespace['glb_with_selected_hair'](source,Path(directory)/'slick.glb','Slick')
        expected,_ = select_hair(original,'Slick'); expected,_ = refine_hair(expected,'Slick')
        shape.assert_called_once_with(expected)
        self.assertTrue(slick_proof['hairShape']['applied'])
        self.assertEqual(slick_proof['hairShape']['selectedHair'],'Slick')
        self.assertEqual(slick_proof['appliedHelpers'],proof['appliedHelpers'][:-2]+[
            'pilot_hair_shape.refine_hair_shape','pilot_gi_body.refine_gi_body'])
        namespace['refine_gi_body'].assert_called_with(expected, 'standing_stance', 'Slick')

    def test_only_edge_connected_mild_fans_smooth_and_tangents_follow(self):
        # Two 45-degree side triangles meet along an edge. A third touches only
        # one point and must remain a separate lock; a fourth forms a 90-degree
        # hard edge against the first and must not contaminate its average.
        p = [(0.,0.,0.),(1.,0.,0.),(0.,1.,0.),
             (1.,0.,0.),(0.,0.,0.),(0.,-1.,1.),
             (0.,0.,0.),(-1.,0.,0.),(0.,0.,1.),
             (0.,1.,0.),(1.,0.,0.),(0.,1.,-1.)]
        ns = [(0.,0.,1.)]*3 + [unit((0.,1.,1.))]*3 + [(0.,1.,0.)]*3 + [unit((-1.,-1.,0.))]*3
        ts = [(1.,0.,0.,-1.)]*len(p)
        result,tangent,proof = smooth_frames(p,ns,ts,[(0.,.5)]*len(p),[(0,0,0,0)]*len(p),[(1.,0.,0.,0.)]*len(p),list(range(len(p))))
        self.assertGreater(result[0][1],.1)
        self.assertLess(result[0][1],.7)
        self.assertEqual(result[0],result[4])
        self.assertEqual(result[6:9],ns[6:9])
        self.assertEqual(result[9:],ns[9:])
        self.assertTrue(all(t[3] == -1. for t in tangent))
        self.assertLess(proof['maximumTangentNormalDot'],1e-12)

    def test_cap_disc_normals_and_tangents_remain_exact(self):
        p = [(0.,0.,0.),(1.,0.,0.),(0.,1.,0.), (1.,0.,0.),(0.,0.,0.),(0.,-1.,1.)]
        ns = [(0.,0.,1.)]*3 + [unit((0.,1.,1.))]*3
        ts = [(1.,0.,0.,1.)]*6
        uv = [(.4,.02),(.6,.02),(.5,.04)] + [(0.,.5)]*3
        result,tangent,proof = smooth_frames(p,ns,ts,uv,[(0,0,0,0)]*6,[(1.,0.,0.,0.)]*6,list(range(6)))
        self.assertEqual(result,ns)
        self.assertEqual(tangent,ts)
        self.assertEqual(proof['capTrianglesPreserved'],1)

    def test_shared_role_accessors_are_appended_once(self):
        raw,_ = select_hair((ROOT/'public/animations/bjj/standing_stance.glb').read_bytes())
        doc,binary = unpack(raw)
        nodes = [next(n for n in doc['nodes'] if n.get('name') == 'JQ_'+role+'_HairSlick') for role in ('Attacker','Defender')]
        # Separate meshes can share identical accessors. Keep both primitives
        # but reuse their appended normal/tangent payloads.
        a = doc['meshes'][nodes[0]['mesh']]['primitives'][0]
        b = doc['meshes'][nodes[1]['mesh']]['primitives'][0]
        b['attributes'] = copy.deepcopy(a['attributes']); b['indices'] = a['indices']
        derived,proof = refine_hair(repack(doc,binary))
        new,_ = unpack(derived)
        attrs = [new['meshes'][n['mesh']]['primitives'][0]['attributes'] for n in nodes]
        self.assertEqual(attrs[0]['NORMAL'],attrs[1]['NORMAL'])
        self.assertEqual(attrs[0]['TANGENT'],attrs[1]['TANGENT'])
        self.assertEqual(proof['newAccessorCount'],2)

    def test_normal_mapped_hair_rejects_unreviewed_tangent_contract(self):
        for style in ('Slick','Spikes'):
            with self.subTest(style=style):
                raw,_ = select_hair((ROOT/'public/animations/bjj/standing_stance.glb').read_bytes(),style)
                doc,binary = unpack(raw)
                node = next(n for n in doc['nodes'] if n.get('name') == 'JQ_Attacker_Hair'+style)
                mat = doc['meshes'][node['mesh']]['primitives'][0]['material']
                doc['materials'][mat]['normalTexture'] = {'index':0}
                with self.assertRaisesRegex(ValueError,'normal map'):
                    refine_hair(repack(doc,binary),style)


if __name__ == '__main__':
    unittest.main()
