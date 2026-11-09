"""Sculpt envelope and original-data preservation, independent of UE rendering."""
from pathlib import Path
import copy
import hashlib
import math
import struct
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
sys.path.insert(0, str(PROJECT / 'Content/Python'))
from pilot_look import (MeshFile, face_offset, cloth_relief, cloth_offset, refine_look,
                        dot, rigid_frame, panel_at, shoulder_offset, folded_ridge, MAX_CLOTH_OFFSET,
                        MAX_CLOTH_BOUNDS_EXPANSION)


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
        self.assertGreater(cloth_relief('sleeve', .25, .575), .004)

    def test_bend_folds_are_directional_and_resolved_above_old_microrelief(self):
        self.assertGreater(cloth_relief('pants', .5, .405), .005)
        self.assertEqual(cloth_relief('pants', 0., .405), 0.)
        self.assertGreater(cloth_relief('sleeve', .25, .575), .004)
        self.assertLess(abs(cloth_relief('sleeve', .75, .575)), .001)
        # The knee fan slants across the front rather than forming a ring.
        peaks = []
        for u in (.40, .60):
            samples = [(cloth_relief('pants', u, i/1000.), i/1000.) for i in range(330, 480)]
            peaks.append(max(samples)[1])
        self.assertGreater(abs(peaks[0]-peaks[1]), .06)

    def test_folded_planes_have_broad_flanks_and_a_smooth_crest(self):
        # Fold faces should read as cloth planes, without the hard cusp that
        # would create a pinched highlight on the existing sleeve grid.
        width, amount = .06, .01
        points = [folded_ridge(width*r, width, amount) for r in (.2,.4,.6,.8)]
        slopes = [(a-b)/(.2*width) for a,b in zip(points,points[1:])]
        self.assertGreater(min(slopes),.14)
        self.assertLess(max(slopes)/min(slopes),1.15)
        step = 1e-6
        left = (folded_ridge(0.,width,amount)-folded_ridge(-step,width,amount))/step
        right = (folded_ridge(step,width,amount)-folded_ridge(0.,width,amount))/step
        self.assertLess(abs(left-right),.0001)
        for distance in (-.3,.3):
            self.assertEqual(folded_ridge(distance,width,amount),0.)

    def test_trim_openings_and_exposed_skin_bands_remain_fixed(self):
        landmarks = {'upperarm_l':(.212, .0654, 1.4555), 'hand_l':(.7065, .0654, 1.4555),
                     'thigh_l':(.1143, .036, .9712), 'foot_l':(.1143, .0875, .0865)}
        for u in (.0, .25, .5, .75, 1.):
            for v in (.0, .10, .15, .94, .98, 1.):
                self.assertEqual(cloth_offset('sleeve', (.6, .08, 1.49), u, v, landmarks), (0.,0.,0.))
                self.assertEqual(cloth_offset('pants', (.15, .08, .2), u, v, landmarks), (0.,0.,0.))
            self.assertEqual(cloth_offset('trim', (.1, -.1, 1.4), u, .5, landmarks), (0.,0.,0.))
        self.assertEqual(cloth_offset('torso', (.095,-.10,1.45), .09,.8,landmarks), (0.,0.,0.))

    def test_shared_shoulder_field_keeps_overlap_aligned_and_is_locally_injective(self):
        landmarks = {'upperarm_l':(.212,.0654,1.4555),'hand_l':(.7065,.0654,1.4555)}
        for p in ((.15,.03,1.46),(.21,.08,1.53),(.27,-.01,1.50)):
            torso=cloth_offset('torso',p,.20,.90,landmarks)
            sleeve=cloth_offset('sleeve',p,.25,.31,landmarks)
            self.assertEqual(torso,sleeve)
            self.assertEqual(torso,shoulder_offset(p))
        self.assertLess(shoulder_offset((.21,.0654,1.535))[2],-.017)
        for p in ((.08,.05,1.56),(.095,-.10,1.49),(.20,.06,1.42),(.40,.06,1.52)):
            self.assertEqual(shoulder_offset(p),(0.,0.,0.))
        # A continuous positive local Jacobian prevents this shared rest-space
        # warp from folding one overlap surface through the other by itself.
        step=1e-5
        for x in (.12,.14,.18,.26,.31,.34):
            for y in (-.10,.0,.12):
                for z in (1.44,1.48,1.52,1.54):
                    p=(x,y,z);cols=[]
                    for axis in range(3):
                        a=list(p);b=list(p);a[axis]-=step;b[axis]+=step
                        da,db=shoulder_offset(a),shoulder_offset(b)
                        cols.append([(db[k]-da[k])/(2*step)+(1. if k==axis else 0.) for k in range(3)])
                    a,b,c=cols
                    determinant=(a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]))
                    self.assertGreater(determinant,.60)

    def test_three_clips_preserve_rig_uv_topology_images_and_motion(self):
        accepted_regions = hashlib.sha256()
        for clip in ('standing_stance', 'rear_naked_choke', 'armbar'):
            raw = (ROOT / 'public/animations/bjj' / (clip+'.glb')).read_bytes()
            result, proof = refine_look(raw)
            before, after = MeshFile(raw), MeshFile(result)
            expected=copy.deepcopy(before.doc)
            for index in proof['positionBoundsAccessors']:
                stored=after.read(index)
                for key,operation in (('min',min),('max',max)):
                    actual=[operation(p[axis] for p in stored) for axis in range(3)]
                    self.assertEqual(after.doc['accessors'][index][key],actual)
                    expected['accessors'][index][key]=actual
            self.assertEqual(expected, after.doc)
            self.assertTrue(proof['scopedPositionBoundsOnly'])
            self.assertEqual(len(raw)-before.start, len(result)-after.start)
            self.assertLessEqual(proof['maximumFaceOffsetMeters'], .0025)
            self.assertLessEqual(proof['maximumClothOffsetMeters'], MAX_CLOTH_OFFSET)
            self.assertGreater(proof['maximumClothOffsetMeters'], .012)
            self.assertEqual(len(proof['changes']), 6)
            self.assertTrue(all(row['verticesMoved'] > 10 for row in proof['changes']))
            allowed = set()
            for node in before.doc['nodes']:
                if node.get('name') not in {f'JQ_{role}_{part}' for role in ('Attacker', 'Defender')
                    for part in ('Body', 'GiJacket', 'GiPantsMesh')}:
                    continue
                for primitive in before.doc['meshes'][node['mesh']]['primitives']:
                    attributes = primitive['attributes']
                    if node['name'].endswith('_GiPantsMesh'):
                        protected = [p for p,uv in zip(after.read(attributes['POSITION']),
                            before.read(attributes['TEXCOORD_1'])) if panel_at(uv)[2] >= .58]
                        self.assertEqual(len(protected),1713)
                        for point in protected:
                            accepted_regions.update(struct.pack('<3f',*point))
                    else:
                        for semantic in ('POSITION','NORMAL','TANGENT'):
                            for value in after.read(attributes[semantic]):
                                accepted_regions.update(struct.pack('<'+'f'*len(value),*value))
                    for semantic in ('POSITION', 'NORMAL', 'TANGENT'):
                        index = primitive['attributes'][semantic]
                        accessor, start, stride, fmt = before.layout(index)
                        for i in range(accessor['count']):
                            allowed.update(range(start+i*stride, start+i*stride+struct.calcsize(fmt)))
                    skin = before.doc['skins'][node['skin']]
                    index = next(i for i,j in enumerate(skin['joints']) if before.doc['nodes'][j]['name']=='root')
                    rows, translation = rigid_frame(before.read(skin['inverseBindMatrices'])[index])
                    old, new = (m.read(primitive['attributes']['POSITION']) for m in (before, after))
                    old_n, new_n = (m.read(primitive['attributes']['NORMAL']) for m in (before, after))
                    new_t = after.read(primitive['attributes']['TANGENT'])
                    joints = before.read(primitive['attributes']['JOINTS_0'])
                    weights = before.read(primitive['attributes']['WEIGHTS_0'])
                    seam_normals, seam_positions = {}, {}
                    for i, point in enumerate(old):
                        key = (point, old_n[i], joints[i], weights[i])
                        if key in seam_normals:
                            self.assertLess(sum((a-b)**2 for a,b in zip(new_n[i],seam_normals[key])), 1e-12)
                            self.assertLess(math.dist(new[i],seam_positions[key]), 2e-7)
                        seam_normals[key], seam_positions[key] = new_n[i],new[i]
                        if old_n[i] != new_n[i]:
                            self.assertAlmostEqual(dot(new_n[i],new_n[i]),1.,places=6)
                            self.assertLess(abs(dot(new_n[i],new_t[i][:3])),2e-6)
                    if node['name'].endswith('_Body'):
                        protected = 0
                        for a,b in zip(old,new):
                            p = tuple(dot(row,a)+translation[j] for j,row in enumerate(rows))
                            if p[2] >= 1.631 or p[2] <= 1.532 or abs(p[0]) >= .075:
                                self.assertEqual(a,b); protected += 1
                        self.assertGreater(protected, 7000)
                    else:
                        uvs=before.read(primitive['attributes']['TEXCOORD_1'])
                        for a,b,uv in zip(old,new,uvs):
                            panel,u,v=panel_at(uv)
                            p=tuple(dot(row,a)+translation[j] for j,row in enumerate(rows))
                            if (panel=='trim' or (panel=='sleeve' and (v<=.04 or v>=.93))
                                or (panel=='pants' and (v<=.16 or v>=.92))
                                or (panel=='torso' and (v<=.08 or v>=.94 or u<=.045 or u>=.955))):
                                self.assertEqual(a,b)
                            if panel=='pants' and a!=b:
                                self.assertGreater(p[2],.280,'Keep retained ankle skin and cuff overlap clear')
                            if panel=='sleeve' and a!=b:
                                self.assertLess(abs(p[0]),.65,'Keep retained distal forearm and cuff overlap clear')
            for row in proof['changes']:
                if row['part']!='Body':
                    self.assertGreater(row['minimumTriangleAreaRatio'],.65)
                    self.assertGreater(row['minimumTriangleNormalDot'],.85)
                    self.assertLessEqual(row['maximumOriginalBoundsExpansionMeters'],MAX_CLOTH_BOUNDS_EXPANSION)
            self.assertTrue(all(a == b or i+before.start in allowed for i,(a,b) in
                                enumerate(zip(raw[before.start:],result[after.start:]))))
            self.assertEqual(refine_look(raw)[0], result, 'Sculpt must be deterministic from original bytes')
        # Actual accepted 003210 recipe, evaluated on the three pinned sources:
        # complete body/jacket P/N/T plus every upper-pants POSITION at v>=.58.
        # This catches lining crossover in the original inner-thigh overlap
        # even when the new rest-space triangles retain their orientation.
        self.assertEqual(accepted_regions.hexdigest(),
            'd8d04b9bdd5e26b79189bc299e2529739cad2ad6ebcac21ceadf760d6ba7523c')


if __name__ == '__main__':
    unittest.main()
