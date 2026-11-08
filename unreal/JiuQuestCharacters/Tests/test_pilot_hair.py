import copy
import json
import math
from pathlib import Path
import struct
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0, str(PROJECT / 'Content/Python'))
from pilot_hair import refine_hair, smooth_frames, unit, dot
from pilot_source import select_hair


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
        for clip in pinned['clips']:
            with self.subTest(clip=clip['name']):
                raw,_ = select_hair((ROOT/clip['source']).read_bytes())
                derived,proof = refine_hair(raw)
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
                    self.assertEqual(row['capTrianglesPreserved'],152)
                    self.assertLess(row['maxNormalRotationDegrees'],36.)
                expected['accessors'] += new['accessors'][len(old['accessors']):]
                expected['bufferViews'] += new['bufferViews'][len(old['bufferViews']):]
                expected['buffers'][0]['byteLength'] = new['buffers'][0]['byteLength']
                self.assertEqual(new, expected)
                self.assertEqual(len(proof['primitives']),2)

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
        raw,_ = select_hair((ROOT/'public/animations/bjj/standing_stance.glb').read_bytes())
        doc,binary = unpack(raw)
        node = next(n for n in doc['nodes'] if n.get('name') == 'JQ_Attacker_HairSlick')
        mat = doc['meshes'][node['mesh']]['primitives'][0]['material']
        doc['materials'][mat]['normalTexture'] = {'index':0}
        with self.assertRaisesRegex(ValueError,'normal map'):
            refine_hair(repack(doc,binary))


if __name__ == '__main__':
    unittest.main()
