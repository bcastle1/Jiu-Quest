"""Sculpt envelope and original-data preservation, independent of UE rendering."""
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0, str(PROJECT / 'Content/Python'))
from pilot_look import MeshFile, face_offset, cloth_relief, refine_look, dot, rigid_frame


class LookTests(unittest.TestCase):
    def test_face_excludes_eyes_lips_neck_and_hands(self):
        for point in ((0., -.08, 1.64), (.03, -.09, 1.643),
                      (0., -.09, 1.577), (.02, -.09, 1.578),
                      (0., -.04, 1.52), (.65, -.08, 1.58), (0., .06, 1.60)):
            self.assertEqual(face_offset(point), (0., 0., 0.))
        self.assertLess(face_offset((0., -.08, 1.547))[1], -.001)

    def test_compression_excludes_openings_and_trim(self):
        for panel in ('sleeve', 'pants', 'torso', 'trim'):
            for u in (0., .25, .5, .75, 1.):
                for v in (0., .05, .96, 1.):
                    self.assertEqual(cloth_relief(panel, u, v), 0.)
        self.assertEqual(cloth_relief('trim', .5, .5), 0.)
        self.assertGreater(cloth_relief('sleeve', .25, .525), .0008)

    def test_three_clips_preserve_rig_uv_topology_images_and_motion(self):
        for clip in ('standing_stance', 'rear_naked_choke', 'armbar'):
            raw = (ROOT / 'public/animations/bjj' / (clip+'.glb')).read_bytes()
            result, proof = refine_look(raw)
            before, after = MeshFile(raw), MeshFile(result)
            self.assertEqual(before.doc, after.doc)
            self.assertEqual(len(raw), len(result))
            self.assertLessEqual(proof['maximumFaceOffsetMeters'], .0025)
            self.assertLessEqual(proof['maximumClothOffsetMeters'], .0015)
            self.assertEqual(len(proof['changes']), 6)
            self.assertTrue(all(row['verticesMoved'] > 10 for row in proof['changes']))
            allowed = set()
            for node in before.doc['nodes']:
                if node.get('name') not in {f'JQ_{role}_{part}' for role in ('Attacker', 'Defender')
                    for part in ('Body', 'GiJacket', 'GiPantsMesh')}:
                    continue
                for primitive in before.doc['meshes'][node['mesh']]['primitives']:
                    for semantic in ('POSITION', 'NORMAL', 'TANGENT'):
                        index = primitive['attributes'][semantic]
                        accessor, start, stride, fmt = before.layout(index)
                        import struct
                        for i in range(accessor['count']):
                            allowed.update(range(start+i*stride, start+i*stride+struct.calcsize(fmt)))
                    if node['name'].endswith('_Body'):
                        skin = before.doc['skins'][node['skin']]
                        index = next(i for i,j in enumerate(skin['joints']) if before.doc['nodes'][j]['name']=='root')
                        rows, translation = rigid_frame(before.read(skin['inverseBindMatrices'])[index])
                        old, new = (m.read(primitive['attributes']['POSITION']) for m in (before, after))
                        old_n, new_n = (m.read(primitive['attributes']['NORMAL']) for m in (before, after))
                        joints = before.read(primitive['attributes']['JOINTS_0'])
                        weights = before.read(primitive['attributes']['WEIGHTS_0'])
                        seam_normals = {}
                        for i, point in enumerate(old):
                            key = (point, old_n[i], joints[i], weights[i])
                            if key in seam_normals:
                                self.assertLess(sum((a-b)**2 for a,b in zip(new_n[i],seam_normals[key])), 1e-12)
                            seam_normals[key] = new_n[i]
                        protected = 0
                        for a,b in zip(old,new):
                            p = tuple(dot(row,a)+translation[j] for j,row in enumerate(rows))
                            if p[2] >= 1.631 or p[2] <= 1.532 or abs(p[0]) >= .075:
                                self.assertEqual(a,b); protected += 1
                        self.assertGreater(protected, 7000)
            self.assertTrue(all(a == b or i in allowed for i,(a,b) in enumerate(zip(raw,result))))
            self.assertEqual(refine_look(raw)[0], result, 'Sculpt must be deterministic from original bytes')


if __name__ == '__main__':
    unittest.main()
