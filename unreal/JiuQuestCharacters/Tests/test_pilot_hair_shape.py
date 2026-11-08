"""Actual-source topology, interpolation and preservation checks; no renderer."""
import copy
import json
import math
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0,str(PROJECT/'Content/Python'))
from pilot_source import select_hair
from pilot_hair import refine_hair, dot
from pilot_hair_shape import refine_hair_shape, closest
from pilot_look import MeshFile


class HairShapeTests(unittest.TestCase):
    def test_all_three_clips_preserve_original_vertices_motion_and_other_meshes(self):
        for clip in ('standing_stance','rear_naked_choke','armbar'):
            with self.subTest(clip=clip):
                original = (ROOT/'public/animations/bjj'/f'{clip}.glb').read_bytes()
                selected,_ = select_hair(original); raw,_ = refine_hair(selected)
                derived,proof = refine_hair_shape(raw)
                old,new = MeshFile(raw),MeshFile(derived)
                self.assertEqual(derived[new.start:new.start+len(raw)-old.start],raw[old.start:])
                expected = copy.deepcopy(old.doc)
                for row in proof['roles']:
                    a = old.doc['meshes'][row['mesh']]['primitives'][0]
                    b = new.doc['meshes'][row['mesh']]['primitives'][0]
                    expected['meshes'][row['mesh']]['primitives'][0]['attributes'] = b['attributes']
                    expected['meshes'][row['mesh']]['primitives'][0]['indices'] = b['indices']
                    old_values = {k:old.read(v) for k,v in a['attributes'].items()}
                    new_values = {k:new.read(v) for k,v in b['attributes'].items()}
                    count = row['originalVertices']
                    for key in ('POSITION','TEXCOORD_0','JOINTS_0','WEIGHTS_0'):
                        self.assertEqual(new_values[key][:count],old_values[key])
                    self.assertEqual(row['primaryLockCount'],6)
                    self.assertEqual(row['unchangedTriangleCount'],1012)
                    self.assertLessEqual(row['maximumDeviationMeters'],.002000001)
                    self.assertLessEqual(row['maximumUpperRootDeviationMeters'],.001500001)
                    self.assertGreaterEqual(row['minimumScalpClearanceChangeMeters'],-1e-7)
                    self.assertTrue(row['lowerRootAndTerminalEdgesExact'])
                    for js,ws in zip(new_values['JOINTS_0'],new_values['WEIGHTS_0']):
                        self.assertEqual(sum(ws),1.)
                        self.assertEqual(sum(w>0 for w in ws),1)
                    # Find the scalp as the largest connected geometric island,
                    # independently of source vertex order or derivative labels.
                    indices = [x[0] for x in old.read(a['indices'])]
                    positions = old_values['POSITION']; neighbors = {p:set() for p in positions}
                    for k in range(0,len(indices),3):
                        triangle = [positions[i] for i in indices[k:k+3]]
                        for p in triangle: neighbors[p].update(triangle)
                    unseen = set(neighbors); islands = []
                    while unseen:
                        pending = [unseen.pop()]; island = set(pending)
                        while pending:
                            for q in neighbors[pending.pop()]:
                                if q in unseen: unseen.remove(q); island.add(q); pending.append(q)
                        islands.append(island)
                    scalp_positions = max(islands,key=len)
                    self.assertEqual(len(scalp_positions),288)
                    scalp = [i for i,p in enumerate(positions) if p in scalp_positions]
                    self.assertEqual(len(scalp),297)
                    for key in old_values:
                        self.assertEqual([new_values[key][i] for i in scalp],[old_values[key][i] for i in scalp])
                    # New vertices must retain exact affine UV sampling across
                    # source triangle edges, including separate UV seam copies.
                    uv_midpoints = {tuple((old_values['TEXCOORD_0'][i][axis]+old_values['TEXCOORD_0'][j][axis])*.5 for axis in range(2))
                                    for k in range(0,len(indices),3) for i,j in ((indices[k],indices[k+1]),(indices[k+1],indices[k+2]),(indices[k+2],indices[k]))}
                    for uv in new_values['TEXCOORD_0'][count:]:
                        self.assertLess(min(math.dist(uv,candidate) for candidate in uv_midpoints),1e-7)
                expected['accessors'] += new.doc['accessors'][len(old.doc['accessors']):]
                expected['bufferViews'] += new.doc['bufferViews'][len(old.doc['bufferViews']):]
                expected['buffers'][0]['byteLength'] = new.doc['buffers'][0]['byteLength']
                self.assertEqual(new.doc,expected)

    def test_triangle_clearance_projection_handles_face_edge_and_corner(self):
        a,b,c = (0.,0.,0.),(1.,0.,0.),(0.,1.,0.)
        self.assertLess(math.dist(closest((.2,.3,2.),a,b,c),(.2,.3,0.)),1e-12)
        self.assertEqual(closest((.5,-2.,1.),a,b,c),(.5,0.,0.))
        self.assertEqual(closest((-1.,-1.,1.),a,b,c),a)

    def test_repeat_subdivision_rejected_by_structural_inventory(self):
        raw,_ = select_hair((ROOT/'public/animations/bjj/standing_stance.glb').read_bytes())
        raw,_ = refine_hair(raw); result,_ = refine_hair_shape(raw)
        with self.assertRaisesRegex(ValueError,'six primary'):
            refine_hair_shape(result)


if __name__=='__main__': unittest.main()
